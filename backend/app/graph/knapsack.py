"""Deterministic word-level budget fitter (optimal 0/1 knapsack).

After the edit plan is applied, the answer is an ordered list of word tokens,
each tagged base vs edit-derived and carrying a value (edit words score higher).
This module trims the answer to a character budget by selecting the subset of
words that MAXIMISES total kept value while staying under the budget - an
optimal 0/1 knapsack rather than a greedy trim. Compared with greedy removal,
this packs the budget fuller (e.g. uses 138/140 chars instead of overshooting
down to 134) and keeps more of the answer.

Properties:

- Edit-derived content is protected: edit words carry a higher value, so the
  optimiser keeps them over base filler unless that would blow the budget.
- The subject (word 0) is always kept so the answer keeps its grammatical head.
- Ties (equal value) are broken toward filling MORE characters, so the result is
  deterministic and packs as close to the ceiling as possible.

Trade-off vs the old greedy fitter: the kept set is no longer guaranteed to be
monotonic across budgets - dragging the slider can swap a word in/out to pack
better. That is intentional.

Pure deterministic: never calls an LLM, never asks a model to count characters.
"""

from __future__ import annotations

from dataclasses import dataclass

# Filler words worth slightly less to keep. Kept small and conservative: we only
# ever demote these in the keep-value, we never force-remove them.
_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
    "into", "from", "by", "at", "as", "that", "which", "is", "are", "be", "our",
    "their", "its", "this", "these", "those", "then", "via", "using",
}


def _keep_value(word: "WordToken", index: int) -> float:
    """Higher = more valuable to keep. Boosts proper nouns; demotes filler.

    Folds the structural priors into the per-word value the knapsack maximises:
    capitalised proper-noun-ish tokens are worth slightly more, stopword filler
    slightly less. (The subject at index 0 is force-kept separately, so its value
    here is irrelevant.)
    """
    text = word.text.strip(".,;:()\"'")
    value = word.value
    if text[:1].isupper():  # proper-noun-ish token
        value += 0.2
    if text.lower() in _STOPWORDS:  # filler is cheaper to drop
        value -= 0.15
    return value


@dataclass
class WordToken:
    index: int  # position in the assembled answer
    text: str
    source: str  # "base" | "edit"
    value: float

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "text": self.text,
            "source": self.source,
            "value": self.value,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WordToken":
        return cls(
            index=int(data.get("index", 0)),
            text=str(data.get("text", "")),
            source=str(data.get("source", "base")),
            value=float(data.get("value", 0.0)),
        )


@dataclass
class WordResult:
    kept_indices: list[int]
    total_chars: int
    total_value: float
    feasible: bool

    def to_dict(self) -> dict:
        return {
            "keptIndices": self.kept_indices,
            "totalChars": self.total_chars,
            "totalValue": self.total_value,
            "feasible": self.feasible,
        }


def assembled_len(words: list[WordToken]) -> int:
    """Character length of the words joined by single spaces."""
    if not words:
        return 0
    return sum(len(w.text) for w in words) + (len(words) - 1)


def solve_words(words: list[WordToken], budget_chars: int) -> WordResult:
    """Pick the subset that maximises kept value while fitting the char budget.

    Optimal 0/1 knapsack. The subject (word 0) is always kept; the remaining
    words are chosen by dynamic programming to maximise total value under the
    budget, breaking ties toward filling more characters. Order is preserved on
    assembly (we keep words in their original positions). If even the subject
    alone exceeds the budget the result is marked infeasible (still assembled,
    matching the over-budget UI).
    """
    budget = max(0, int(budget_chars))
    n = len(words)
    if n == 0:
        return WordResult([], 0, 0.0, True)

    # Space-aware cost: a word joined with a leading space costs len+1, and the
    # very first kept word reclaims that one space. So sum(len+1) - 1 equals the
    # assembled length. Work in capacity = budget + 1 with per-word cost len+1.
    capacity = budget + 1
    cost0 = len(words[0].text) + 1  # subject is always kept
    remaining = capacity - cost0

    chosen: list[int] = []
    if remaining >= 0 and n > 1:
        items = [
            (len(words[i].text) + 1, _keep_value(words[i], i), i)
            for i in range(1, n)
        ]
        total_item_cost = sum(c for c, _, _ in items)
        cap = min(remaining, total_item_cost)
        m = len(items)
        # dp[i][c] = best (value, weight) using the first i items within cap c.
        dp: list[list[tuple[float, int]]] = [
            [(0.0, 0)] * (cap + 1) for _ in range(m + 1)
        ]
        for i in range(1, m + 1):
            cost_i, val_i, _ = items[i - 1]
            prev, row = dp[i - 1], dp[i]
            for c in range(cap + 1):
                best = prev[c]  # skip item i
                if cost_i <= c:
                    pv, pw = prev[c - cost_i]
                    cand = (pv + val_i, pw + cost_i)  # value first, then fuller
                    if cand > best:
                        best = cand
                row[c] = best
        # Reconstruct which items were taken.
        c = cap
        for i in range(m, 0, -1):
            if dp[i][c] != dp[i - 1][c]:
                cost_i, _, orig = items[i - 1]
                chosen.append(orig)
                c -= cost_i

    kept_indices = sorted([0, *chosen])
    chosen_words = [words[i] for i in kept_indices]
    total = assembled_len(chosen_words)
    return WordResult(
        kept_indices=kept_indices,
        total_chars=total,
        total_value=sum(w.value for w in chosen_words),
        feasible=total <= budget,
    )


def assemble_words(words: list[WordToken], result: WordResult) -> str:
    """Join the kept words in original order into the final answer."""
    return " ".join(words[i].text for i in result.kept_indices if 0 <= i < len(words))


def suggest_trims(
    words: list[WordToken], budget_chars: int, reserve_ratio: float = 0.92
) -> dict:
    """Advisory only: suggest which word indices to drop to fit the budget.

    The knapsack does NOT decide the final text here - it proposes a removal set
    that the LLM then approves/adjusts (and re-glues with connectives via ops).
    We solve at a reduced "content budget" (reserve_ratio of the real budget) so
    there is room for the connectives the realizer will add back.

    Returns {suggested_delete, kept, projected_chars}. When the answer already
    fits the budget there is nothing to suggest.
    """
    n = len(words)
    if n == 0:
        return {"suggested_delete": [], "kept": [], "projected_chars": 0}
    if assembled_len(words) <= budget_chars:
        return {
            "suggested_delete": [],
            "kept": list(range(n)),
            "projected_chars": assembled_len(words),
        }

    content_budget = max(1, int(budget_chars * reserve_ratio))
    res = solve_words(words, content_budget)
    kept = set(res.kept_indices)
    suggested = [i for i in range(n) if i not in kept]
    return {
        "suggested_delete": suggested,
        "kept": sorted(kept),
        "projected_chars": res.total_chars,
    }

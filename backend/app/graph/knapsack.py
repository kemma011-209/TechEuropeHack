"""Deterministic word-level budget fitter.

After the edit plan is applied, the answer is an ordered list of word tokens,
each tagged base vs edit-derived and carrying a value (edit words score higher).
This module trims the answer to a character budget by removing the
lowest-value words first, which gives two properties the UI relies on:

- Edit-derived content is protected: base filler is dropped before edits.
- Monotonic slider: the kept set at a higher budget is a superset of the kept
  set at a lower budget (we remove words in a fixed value order), so dragging the
  budget down removes words and dragging it back up re-adds the same words.

Pure deterministic: never calls an LLM, never asks a model to count characters.
"""

from __future__ import annotations

from dataclasses import dataclass

# Filler words that can be trimmed first without destroying meaning. Kept small
# and conservative: we only ever demote these in the removal priority, we never
# force-remove them.
_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
    "into", "from", "by", "at", "as", "that", "which", "is", "are", "be", "our",
    "their", "its", "this", "these", "those", "then", "via", "using",
}


def _removal_priority(word: "WordToken", index: int) -> float:
    """Lower = removed earlier. Protects the subject, proper nouns and edits.

    Pure word deletion is inherently lossy, so this heuristic keeps the parts a
    reader needs to parse the sentence: the opening subject, capitalised proper
    nouns, and any edit-derived (rewritten) content. Filler stopwords are the
    cheapest to drop.
    """
    text = word.text.strip(".,;:()\"'")
    priority = word.value
    if index == 0:  # the subject - never the first to go
        priority += 1.0
    elif text[:1].isupper():  # proper-noun-ish mid-sentence token
        priority += 0.2
    if text.lower() in _STOPWORDS:  # filler is cheap to drop
        priority -= 0.15
    return priority


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
    """Trim to <= budget by removing lowest-value words first (value, then order).

    Keeps at least one word. If even the single highest-value word exceeds the
    budget the result is marked infeasible (still assembled, matching the
    over-budget UI), mirroring the old solver's infeasible handling.
    """
    budget = max(0, int(budget_chars))
    n = len(words)
    if n == 0:
        return WordResult([], 0, 0.0, True)

    # Removal order: lowest priority first; ties broken from the END so the
    # opening subject+verb survive (trimming trailing clauses reads better than
    # gutting the start). Fixed total order => monotonic slider.
    removal_order = sorted(
        range(n), key=lambda i: (_removal_priority(words[i], i), -i)
    )
    kept = set(range(n))

    def current_len() -> int:
        return assembled_len([words[i] for i in sorted(kept)])

    ri = 0
    while current_len() > budget and len(kept) > 1 and ri < n:
        kept.discard(removal_order[ri])
        ri += 1

    kept_indices = sorted(kept)
    chosen = [words[i] for i in kept_indices]
    total = assembled_len(chosen)
    return WordResult(
        kept_indices=kept_indices,
        total_chars=total,
        total_value=sum(w.value for w in chosen),
        feasible=total <= budget,
    )


def assemble_words(words: list[WordToken], result: WordResult) -> str:
    """Join the kept words in original order into the final answer."""
    return " ".join(words[i].text for i in result.kept_indices if 0 <= i < len(words))

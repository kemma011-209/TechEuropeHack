"""Pure word-level operations for the wordspace page.

Gemma may only modify a sentence by emitting these structured ops (never by
rewriting text). Ops are applied sequentially, each against the current word
list, so indices shift as earlier ops run. Malformed or out-of-range ops are
skipped silently rather than raising.
"""

import difflib
from typing import Any

VALID_OPS = {"replace", "insert", "delete", "move"}


def _valid_word(value: Any) -> str | None:
    """A word is a single non-empty token with no whitespace."""
    if not isinstance(value, str):
        return None
    token = value.strip()
    if not token or any(c.isspace() for c in token):
        return None
    return token


def _as_index(value: Any) -> int | None:
    if isinstance(value, bool):  # bool is an int subclass; reject it
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value)
    return None


def apply_op(words: list[str], op: dict) -> list[str]:
    """Apply a single validated op, returning a new list. Skips invalid ops."""
    kind = op.get("op")
    if kind not in VALID_OPS:
        return words
    n = len(words)
    result = list(words)

    if kind == "replace":
        idx = _as_index(op.get("index"))
        word = _valid_word(op.get("word"))
        if idx is not None and word is not None and 0 <= idx < n:
            result[idx] = word

    elif kind == "insert":
        idx = _as_index(op.get("index"))
        word = _valid_word(op.get("word"))
        if idx is not None and word is not None and 0 <= idx <= n:
            result.insert(idx, word)

    elif kind == "delete":
        idx = _as_index(op.get("index"))
        if idx is not None and 0 <= idx < n:
            del result[idx]

    elif kind == "move":
        src = _as_index(op.get("from"))
        dst = _as_index(op.get("to"))
        if src is not None and dst is not None and 0 <= src < n and 0 <= dst < n:
            token = result.pop(src)
            result.insert(dst, token)

    return result


def apply_ops(words: list[str], ops: Any) -> tuple[list[str], list[dict]]:
    """Apply a list of ops in order. Returns (new_words, applied_ops).

    applied_ops contains only the ops that actually changed the list, so the
    frontend can show exactly which tooling ran.
    """
    if not isinstance(ops, list):
        return list(words), []

    current = list(words)
    applied: list[dict] = []
    for op in ops:
        if not isinstance(op, dict):
            continue
        before = current
        current = apply_op(before, op)
        if current != before:
            applied.append(op)
    return current, applied


# --- Tagged application (provenance tracking) ------------------------------
# A "token" is {"text": str, "source": "base" | "edit"}. Base tokens come from
# the original draft; edit tokens are introduced by insert/replace ops. Tracking
# provenance lets the budget knapsack weight edit-derived words above base text.


def _apply_op_tagged(tokens: list[dict], op: dict) -> tuple[list[dict], bool]:
    """Apply one op to tagged tokens. Returns (tokens, changed).

    Returns the original list (and False) when the op is invalid/out-of-range, so
    the caller can record it as a dropped op during review.
    """
    kind = op.get("op")
    if kind not in VALID_OPS:
        return tokens, False
    n = len(tokens)
    result = [dict(t) for t in tokens]

    if kind == "replace":
        idx = _as_index(op.get("index"))
        word = _valid_word(op.get("word"))
        if idx is not None and word is not None and 0 <= idx < n:
            result[idx] = {"text": word, "source": "edit"}
            return result, True

    elif kind == "insert":
        idx = _as_index(op.get("index"))
        word = _valid_word(op.get("word"))
        if idx is not None and word is not None and 0 <= idx <= n:
            result.insert(idx, {"text": word, "source": "edit"})
            return result, True

    elif kind == "delete":
        idx = _as_index(op.get("index"))
        if idx is not None and 0 <= idx < n:
            del result[idx]
            return result, True

    elif kind == "move":
        src = _as_index(op.get("from"))
        dst = _as_index(op.get("to"))
        if src is not None and dst is not None and 0 <= src < n and 0 <= dst < n:
            token = result.pop(src)
            result.insert(dst, token)
            return result, True

    return tokens, False


def apply_ops_tagged(
    words: list[str], ops: Any
) -> tuple[list[dict], list[dict], list[dict]]:
    """Review + apply ops, tracking word provenance in a single pass.

    Returns (tokens, applied_ops, dropped_ops):
    - tokens: list of {"text", "source"} after applying every op that worked.
    - applied_ops: ops that actually changed the list (the reviewed plan).
    - dropped_ops: ops that were invalid/out-of-range/no-ops (review rejected).
    """
    tokens: list[dict] = [{"text": w, "source": "base"} for w in words]
    applied: list[dict] = []
    dropped: list[dict] = []
    if not isinstance(ops, list):
        return tokens, applied, dropped

    for op in ops:
        if not isinstance(op, dict):
            dropped.append(op)
            continue
        new_tokens, changed = _apply_op_tagged(tokens, op)
        if changed:
            tokens = new_tokens
            applied.append(op)
        else:
            dropped.append(op)
    return tokens, applied, dropped


# --- Span-replacement merge (robust, no word-index drift) ------------------
# Critics return {span_original, span_replacement} where span_original is an
# exact substring of the draft. Applying these as string replacements (instead
# of word-index ops) avoids the index-drift artifacts that plague merging many
# ops, and keeps the text grammatical because each replacement is a full phrase
# the model wrote. We then diff the result against the draft to tag which words
# are new (edit-derived) so the UI can highlight them.


def merge_span_edits(
    draft: str, critics: list[dict]
) -> tuple[str, list[dict]]:
    """Apply non-overlapping critic span replacements to the draft string.

    Greedy by coverage: longest spans first, skipping any that overlap a span
    already chosen. Returns (improved_text, applied) where applied lists the
    span edits that were actually used (for the UI edit plan).
    """
    candidates: list[dict] = []
    for c in critics:
        span = str(c.get("span_original", ""))
        repl = str(c.get("span_replacement", ""))
        if not span or not repl or span == repl:
            continue
        if bool(c.get("full_rewrite")):
            continue  # skip whole-answer rewrites; they erase structure
        start = draft.find(span)
        if start == -1:
            continue
        candidates.append(
            {
                "start": start,
                "end": start + len(span),
                "span_original": span,
                "span_replacement": repl,
                "critic": str(c.get("critic", "Critic")),
                "persona_note": str(c.get("persona_note", "")),
            }
        )

    # Longest coverage first so the most substantial improvement wins a conflict.
    candidates.sort(key=lambda x: (x["end"] - x["start"]), reverse=True)
    chosen: list[dict] = []
    occupied: list[tuple[int, int]] = []
    for cand in candidates:
        s, e = cand["start"], cand["end"]
        if any(s < oe and e > os for os, oe in occupied):
            continue  # overlaps an already-chosen span
        chosen.append(cand)
        occupied.append((s, e))

    # Build the improved string left-to-right from the chosen, ordered by start.
    chosen.sort(key=lambda x: x["start"])
    out: list[str] = []
    cursor = 0
    for cand in chosen:
        out.append(draft[cursor : cand["start"]])
        out.append(cand["span_replacement"])
        cursor = cand["end"]
    out.append(draft[cursor:])
    improved = "".join(out)
    return improved, chosen


def tag_words_by_diff(original: str, improved: str) -> list[dict]:
    """Tokenise `improved` and tag each word base vs edit by diffing originals.

    Words that are unchanged from the draft are "base"; words that were inserted
    or replaced are "edit" (the UI renders these in faint blue).
    """
    orig_words = original.split()
    new_words = improved.split()
    tokens: list[dict] = []
    matcher = difflib.SequenceMatcher(a=orig_words, b=new_words, autojunk=False)
    for op, _i1, _i2, j1, j2 in matcher.get_opcodes():
        source = "base" if op == "equal" else "edit"
        for w in new_words[j1:j2]:
            tokens.append({"text": w, "source": source})
    return tokens

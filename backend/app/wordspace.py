"""Pure word-level operations for the wordspace page.

Gemma may only modify a sentence by emitting these structured ops (never by
rewriting text). Ops are applied sequentially, each against the current word
list, so indices shift as earlier ops run. Malformed or out-of-range ops are
skipped silently rather than raising.
"""

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

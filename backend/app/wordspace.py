"""Pure word-level operations for the wordspace page.

Gemma may only modify a sentence by emitting these structured ops (never by
rewriting text). Ops are applied sequentially, each against the current word
list, so indices shift as earlier ops run. Malformed or out-of-range ops are
skipped silently rather than raising.
"""

import difflib
import re
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


def apply_ops_to_tokens(
    tokens: list[dict], ops: Any
) -> tuple[list[dict], list[dict], list[dict]]:
    """Apply ops to ALREADY-tagged tokens, preserving existing provenance.

    Unlike apply_ops_tagged (which starts from all-base words), this keeps the
    source of untouched words intact - so a word that was already an edit stays
    an edit, and only newly inserted/replaced words become edit-derived. Used by
    the interactive chat so the blue highlights accumulate correctly.
    """
    current = [
        {"text": str(t.get("text", "")), "source": str(t.get("source", "base"))}
        for t in tokens
    ]
    applied: list[dict] = []
    dropped: list[dict] = []
    if not isinstance(ops, list):
        return current, applied, dropped

    for op in ops:
        if not isinstance(op, dict):
            dropped.append(op)
            continue
        new_tokens, changed = _apply_op_tagged(current, op)
        if changed:
            current = new_tokens
            applied.append(op)
        else:
            dropped.append(op)
    return current, applied, dropped


# --- Batch indexed edits (drift-free delete + insert) ----------------------
# The budget realizer emits delete + insert ops that ALL reference the ORIGINAL
# word indices. Applying them as a single batch (rather than a mutating
# sequence) means later ops never see shifted indices - this is what prevents
# the duplicated/leftover-word artifacts that plague sequential op merging.


def apply_indexed_edits(
    tokens: list[dict], deletes: Any, inserts: Any
) -> tuple[list[dict], dict]:
    """Apply deletes + inserts against ORIGINAL indices in one drift-free pass.

    - deletes: iterable of original indices to drop.
    - inserts: iterable of {"before": <orig index>, "word": <str>}; the word is
      placed before that original index (index == len appends at the end). Multi-
      word inserts are split into separate glue tokens.

    Inserted words are tagged source="glue" so the UI can distinguish realizer
    connectives from base text and critic edits. Returns (new_tokens, summary).
    """
    n = len(tokens)
    del_set: set[int] = set()
    if isinstance(deletes, list):
        for d in deletes:
            idx = _as_index(d)
            if idx is not None and 0 <= idx < n:
                del_set.add(idx)

    ins_by_pos: dict[int, list[str]] = {}
    if isinstance(inserts, list):
        for ins in inserts:
            if not isinstance(ins, dict):
                continue
            pos = _as_index(ins.get("before"))
            if pos is None:
                pos = _as_index(ins.get("index"))  # tolerate alt key
            raw = ins.get("word")
            if pos is None or not isinstance(raw, str):
                continue
            pos = max(0, min(pos, n))
            for w in raw.split():
                if w:
                    ins_by_pos.setdefault(pos, []).append(w)

    out: list[dict] = []
    inserted = 0
    for i in range(n + 1):
        for w in ins_by_pos.get(i, []):
            out.append({"text": w, "source": "glue"})
            inserted += 1
        if i < n and i not in del_set:
            t = tokens[i]
            out.append(
                {"text": str(t.get("text", "")), "source": str(t.get("source", "base"))}
            )

    return out, {"deleted": len(del_set), "inserted": inserted}


# --- Span-replacement merge (robust, no word-index drift) ------------------
# Critics return {span_original, span_replacement} where span_original is an
# exact substring of the draft. Applying these as string replacements (instead
# of word-index ops) avoids the index-drift artifacts that plague merging many
# ops, and keeps the text grammatical because each replacement is a full phrase
# the model wrote. We then diff the result against the draft to tag which words
# are new (edit-derived) so the UI can highlight them.


def locate_span(draft: str, span: str) -> tuple[int, int] | None:
    """Find `span` inside `draft`, tolerating whitespace/case/punctuation drift.

    Models rarely quote the draft verbatim - they collapse spaces, change case,
    or trim trailing punctuation. We try exact first, then a whitespace- and
    case-insensitive regex, then a punctuation-trimmed retry. Returns (start,
    end) in the ORIGINAL draft coordinates, or None.
    """
    span = (span or "").strip()
    if not span:
        return None

    idx = draft.find(span)  # 1. exact
    if idx != -1:
        return idx, idx + len(span)

    tokens = span.split()  # 2. flexible whitespace, case-insensitive
    if tokens:
        pattern = r"\s+".join(re.escape(t) for t in tokens)
        m = re.search(pattern, draft, re.IGNORECASE)
        if m:
            return m.start(), m.end()

    trimmed = span.strip(".,;:!?\"'()")  # 3. punctuation-trimmed retry
    if trimmed and trimmed != span:
        idx = draft.find(trimmed)
        if idx != -1:
            return idx, idx + len(trimmed)
        toks = trimmed.split()
        if toks:
            pattern = r"\s+".join(re.escape(t) for t in toks)
            m = re.search(pattern, draft, re.IGNORECASE)
            if m:
                return m.start(), m.end()
    return None


def merge_span_edits(
    draft: str, critics: list[dict]
) -> tuple[str, list[dict]]:
    """Apply non-overlapping critic span replacements to the draft string.

    Greedy by coverage: longest spans first, skipping any that overlap a span
    already chosen. Span matching is fuzzy (see locate_span) so we don't silently
    drop every edit when the model's quote isn't byte-identical. If no partial
    span matches at all, fall back to the shortest whole-answer rewrite so the
    user always sees an improvement rather than "0 ops". Returns (improved_text,
    applied) where applied lists the span edits that were actually used.
    """
    candidates: list[dict] = []
    rewrites: list[dict] = []
    for c in critics:
        span = str(c.get("span_original", ""))
        repl = str(c.get("span_replacement", ""))
        if not span or not repl or span.strip() == repl.strip():
            continue
        entry = {
            "span_original": span,
            "span_replacement": repl,
            "critic": str(c.get("critic", "Critic")),
            "persona_note": str(c.get("persona_note", "")),
        }
        if bool(c.get("full_rewrite")):
            rewrites.append(entry)
            continue  # whole-answer rewrites are a last resort (erase structure)
        loc = locate_span(draft, span)
        if loc is None:
            continue
        candidates.append({**entry, "start": loc[0], "end": loc[1]})

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

    # Fallback: nothing matched but a critic offered a full rewrite -> use the
    # shortest one (most likely a tightening) so we never show zero edits.
    if not chosen and rewrites:
        best = min(rewrites, key=lambda r: len(r["span_replacement"]))
        return best["span_replacement"], [best]

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

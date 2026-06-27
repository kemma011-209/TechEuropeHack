"""Deterministic wordspace op tests (reused module)."""

from app.wordspace import (
    apply_indexed_edits,
    apply_op,
    apply_ops,
    apply_ops_tagged,
    locate_span,
    merge_span_edits,
    tag_words_by_diff,
)


def test_replace():
    assert apply_op(["a", "b", "c"], {"op": "replace", "index": 1, "word": "x"}) == [
        "a", "x", "c",
    ]


def test_insert_before_index():
    assert apply_op(["a", "c"], {"op": "insert", "index": 1, "word": "b"}) == [
        "a", "b", "c",
    ]


def test_insert_append_at_end():
    assert apply_op(["a"], {"op": "insert", "index": 1, "word": "b"}) == ["a", "b"]


def test_delete():
    assert apply_op(["a", "b", "c"], {"op": "delete", "index": 0}) == ["b", "c"]


def test_move():
    assert apply_op(["a", "b", "c"], {"op": "move", "from": 0, "to": 2}) == [
        "b", "c", "a",
    ]


def test_invalid_op_skipped():
    assert apply_op(["a"], {"op": "bogus", "index": 0}) == ["a"]


def test_out_of_range_skipped():
    assert apply_op(["a"], {"op": "replace", "index": 9, "word": "x"}) == ["a"]


def test_apply_ops_tracks_applied_only():
    words = ["a", "b"]
    new_words, applied = apply_ops(
        words,
        [
            {"op": "replace", "index": 0, "word": "z"},
            {"op": "delete", "index": 99},  # no-op, out of range
        ],
    )
    assert new_words == ["z", "b"]
    assert len(applied) == 1  # only the effective op recorded


# --- Tagged apply (provenance) + review ------------------------------------
def test_tagged_marks_base_and_edit():
    tokens, applied, dropped = apply_ops_tagged(
        ["Acme", "builds", "things"],
        [{"op": "replace", "index": 2, "word": "tools"}],
    )
    assert [t["text"] for t in tokens] == ["Acme", "builds", "tools"]
    assert tokens[0]["source"] == "base"
    assert tokens[2]["source"] == "edit"  # replaced word is edit-derived
    assert len(applied) == 1 and len(dropped) == 0


def test_tagged_compound_swap_is_delete_plus_insert():
    # Swap "things" for "tools" expressed as delete + insert.
    tokens, applied, dropped = apply_ops_tagged(
        ["Acme", "builds", "things"],
        [
            {"op": "delete", "index": 2},
            {"op": "insert", "index": 2, "word": "tools"},
        ],
    )
    assert [t["text"] for t in tokens] == ["Acme", "builds", "tools"]
    assert tokens[2]["source"] == "edit"
    assert len(applied) == 2 and len(dropped) == 0


def test_tagged_drops_invalid_ops_in_review():
    tokens, applied, dropped = apply_ops_tagged(
        ["a", "b"],
        [
            {"op": "replace", "index": 0, "word": "z"},  # valid
            {"op": "delete", "index": 99},  # out of range -> dropped
            {"op": "bogus", "index": 0},  # invalid kind -> dropped
        ],
    )
    assert [t["text"] for t in tokens] == ["z", "b"]
    assert len(applied) == 1
    assert len(dropped) == 2  # both invalid ops rejected by review


# --- Span-replacement merge (robust matching, no index drift) --------------
def test_locate_span_exact():
    draft = "Acme builds data tools."
    assert locate_span(draft, "data tools") == (12, 22)


def test_locate_span_tolerates_whitespace_and_case():
    draft = "Acme  builds   data tools."
    # Model quotes it single-spaced and lower-cased; we still find it.
    loc = locate_span(draft, "builds data tools")
    assert loc is not None
    start, end = loc
    assert draft[start:end].lower().split() == ["builds", "data", "tools"]


def test_locate_span_missing_returns_none():
    assert locate_span("Acme builds tools.", "rocket fuel") is None


def test_merge_applies_nonoverlapping_and_tags_new_words():
    draft = "Acme builds data tools for teams."
    critics = [
        {
            "critic": "VC",
            "span_original": "data tools",
            "span_replacement": "products",
            "full_rewrite": False,
        }
    ]
    improved, applied = merge_span_edits(draft, critics)
    assert improved == "Acme builds products for teams."
    assert len(applied) == 1
    tokens = tag_words_by_diff(draft, improved)
    assert any(t["text"].startswith("products") and t["source"] == "edit" for t in tokens)
    assert any(t["text"] == "Acme" and t["source"] == "base" for t in tokens)


def test_indexed_edits_are_drift_free():
    # Deletes + inserts both reference ORIGINAL indices; applied as one batch.
    tokens = [
        {"text": "Acme", "source": "base"},
        {"text": "builds", "source": "base"},
        {"text": "fragmented", "source": "base"},
        {"text": "lab", "source": "base"},
        {"text": "tools.", "source": "base"},
    ]
    # Delete "fragmented" (#2) and "lab" (#3); insert "great" before #4 ("tools.").
    out, summary = apply_indexed_edits(
        tokens, [2, 3], [{"before": 4, "word": "great"}]
    )
    texts = [t["text"] for t in out]
    assert texts == ["Acme", "builds", "great", "tools."]
    assert summary == {"deleted": 2, "inserted": 1}
    # Inserted word is tagged as glue (so the UI can grey it).
    assert next(t for t in out if t["text"] == "great")["source"] == "glue"


def test_indexed_edits_append_at_end_and_multiword_split():
    tokens = [{"text": "Acme", "source": "base"}, {"text": "ships.", "source": "base"}]
    out, summary = apply_indexed_edits(tokens, [], [{"before": 2, "word": "and fast"}])
    assert [t["text"] for t in out] == ["Acme", "ships.", "and", "fast"]
    assert summary["inserted"] == 2  # multiword insert split into two glue tokens


def test_merge_falls_back_to_full_rewrite_when_no_span_matches():
    draft = "Acme builds data tools."
    critics = [
        {
            "critic": "Comms",
            "span_original": draft,
            "span_replacement": "Acme ships data products.",
            "full_rewrite": True,
        }
    ]
    improved, applied = merge_span_edits(draft, critics)
    assert improved == "Acme ships data products."
    assert len(applied) == 1

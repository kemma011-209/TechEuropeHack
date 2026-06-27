"""Deterministic wordspace op tests (reused module)."""

from app.wordspace import apply_op, apply_ops, apply_ops_tagged


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

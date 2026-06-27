"""Slot/variant building tests (Python port parity with slots.ts)."""

from app.slots import build_slots, build_variants, parse_slots


def test_parse_slots_splits_on_sentence_boundary():
    assert parse_slots("One thing. Two thing.") == ["One thing.", "Two thing."]


def test_parse_slots_single_sentence():
    assert parse_slots("Just one sentence here.") == ["Just one sentence here."]


def test_parse_slots_empty():
    assert parse_slots("   ") == []


def test_build_variants_includes_original_and_applicable_critic():
    original = "Acme builds data tools."
    critics = [
        {
            "critic": "VC",
            "span_original": "data tools",
            "span_replacement": "products",
        },
        {
            "critic": "Other",
            "span_original": "not in this slot",
            "span_replacement": "x",
        },
    ]
    variants = build_variants(original, critics)
    ids = {v.id for v in variants}
    assert "v-original" in ids
    assert "v-vc" in ids  # applicable critic produced a variant
    assert not any(v.id == "v-other" for v in variants)  # span absent -> skipped
    vc = next(v for v in variants if v.id == "v-vc")
    assert vc.text == "Acme builds products."


def test_build_variants_adds_shortened():
    variants = build_variants("A long original sentence.", [], shortened="Short.")
    assert any(v.id == "v-short" and v.text == "Short." for v in variants)


def test_build_slots_indexes_slots():
    slots = build_slots("First. Second.", [])
    assert [s.id for s in slots] == ["slot-0", "slot-1"]
    assert slots[0].original == "First."

"""Python port of frontend/src/lib/slots.ts.

Turns a draft answer plus a list of critic span-edits into sentence-level
*slots*, each carrying a menu of *variants* (original / shortened / per-critic
replacement). These variants are the items the knapsack solver chooses between.

Kept deliberately in lockstep with the TS version so the server-assembled final
and the client-side slider preview agree. Variants are emitted with camelCase
keys (`fullRewrite`) to match frontend/src/lib/types.ts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Static quality weights, mirroring slots.ts QUALITY. The SIE reranker overrides
# these per-variant when available (see graph.nodes.solve_knapsack).
QUALITY_ORIGINAL = 1.0
QUALITY_CRITIC = 0.85
QUALITY_SHORTENED = 0.6


@dataclass
class Variant:
    id: str
    label: str
    text: str
    chars: int
    quality: float
    full_rewrite: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "text": self.text,
            "chars": self.chars,
            "quality": self.quality,
            "fullRewrite": self.full_rewrite,
        }


@dataclass
class Slot:
    id: str
    original: str
    variants: list[Variant] = field(default_factory=list)
    locked_variant_id: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "original": self.original,
            "variants": [v.to_dict() for v in self.variants],
            "lockedVariantId": self.locked_variant_id,
        }


_SLOT_SPLIT_RE = re.compile(r"(?<=\.)\s+")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def parse_slots(draft: str) -> list[str]:
    """Split a draft into sentence-level slots (on '. ' or '.\\n')."""
    trimmed = (draft or "").strip()
    if not trimmed:
        return []
    parts = [p.strip() for p in _SLOT_SPLIT_RE.split(trimmed) if p.strip()]
    return parts if parts else [trimmed]


def _slugify(label: str) -> str:
    return _SLUG_RE.sub("-", label.lower()).strip("-")


def build_variants(
    original: str,
    critics: list[dict],
    shortened: str | None = None,
) -> list[Variant]:
    """Build the variant menu for a single slot.

    A critic applies to this slot when its `span_original` is found within the
    slot text (or equals the whole slot, i.e. a full rewrite).
    """
    variants: list[Variant] = [
        Variant(
            id="v-original",
            label="Original",
            text=original,
            chars=len(original),
            quality=QUALITY_ORIGINAL,
        )
    ]

    if shortened and shortened.strip() and shortened.strip() != original.strip():
        text = shortened.strip()
        variants.append(
            Variant(
                id="v-short",
                label="Shortened",
                text=text,
                chars=len(text),
                quality=QUALITY_SHORTENED,
            )
        )

    for critic in critics:
        span = str(critic.get("span_original", ""))
        is_full_rewrite = bool(
            critic.get("full_rewrite", span.strip() == original.strip())
        )
        text: str | None = None

        if is_full_rewrite:
            text = str(critic.get("span_replacement", ""))
        elif span and span in original:
            text = original.replace(span, str(critic.get("span_replacement", "")))

        if text is None:
            continue  # critic targets a different slot

        variants.append(
            Variant(
                id=f"v-{_slugify(str(critic.get('critic', 'critic')))}",
                label=str(critic.get("critic", "Critic")),
                text=text,
                chars=len(text),
                quality=QUALITY_CRITIC,
                full_rewrite=is_full_rewrite,
            )
        )

    return variants


def build_slots(
    draft: str,
    critics: list[dict],
    shortened_by_index: dict[int, str] | None = None,
) -> list[Slot]:
    """Build full slot objects from a draft + critics (+ optional shortened texts)."""
    shortened_by_index = shortened_by_index or {}
    slots: list[Slot] = []
    for i, original in enumerate(parse_slots(draft)):
        slots.append(
            Slot(
                id=f"slot-{i}",
                original=original,
                variants=build_variants(original, critics, shortened_by_index.get(i)),
                locked_variant_id=None,
            )
        )
    return slots

import type { Critic, Slot, Variant } from "./types";

const QUALITY = {
  original: 1.0,
  critic: 0.85,
  shortened: 0.6,
} as const;

/** Split a draft into sentence-level slots (on ". " or ".\n"). */
export function parseSlots(draft: string): string[] {
  const trimmed = draft.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the variant menu for a single slot from the critic edits and an
 * optional AI-shortened version. A critic applies to this slot when its
 * span_original is found within the slot text.
 */
export function buildVariants(
  slotId: string,
  original: string,
  critics: Critic[],
  shortened?: string
): Variant[] {
  const variants: Variant[] = [
    {
      id: "v-original",
      label: "Original",
      text: original,
      chars: original.length,
      quality: QUALITY.original,
    },
  ];

  if (shortened && shortened.trim() && shortened.trim() !== original.trim()) {
    const text = shortened.trim();
    variants.push({
      id: "v-short",
      label: "Shortened",
      text,
      chars: text.length,
      quality: QUALITY.shortened,
    });
  }

  for (const critic of critics) {
    const span = critic.span_original;
    const isFullRewrite =
      critic.full_rewrite ?? span.trim() === original.trim();
    let text: string | null = null;

    if (isFullRewrite) {
      text = critic.span_replacement;
    } else if (span && original.includes(span)) {
      text = original.replace(span, critic.span_replacement);
    }

    if (text === null) continue; // critic targets a different slot

    variants.push({
      id: `v-${slugify(critic.critic)}`,
      label: critic.critic,
      text,
      chars: text.length,
      quality: QUALITY.critic,
      fullRewrite: isFullRewrite,
    });
  }

  return variants;
}

/** Build full slot objects from a draft + critics (+ optional shortened texts keyed by slot index). */
export function buildSlots(
  draft: string,
  critics: Critic[],
  shortenedByIndex: Record<number, string> = {}
): Slot[] {
  return parseSlots(draft).map((original, i) => {
    const id = `slot-${i}`;
    return {
      id,
      original,
      variants: buildVariants(id, original, critics, shortenedByIndex[i]),
      lockedVariantId: null,
    };
  });
}

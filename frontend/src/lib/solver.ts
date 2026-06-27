import type { Slot, SolverResult } from "./types";

/**
 * Multiple-choice knapsack over a character budget. Pure synchronous JS: never
 * calls an LLM, never asks a model to count characters.
 *
 * Pick exactly one variant per slot to maximise summed quality subject to
 * summed chars <= budget. A slot with `lockedVariantId` is forced to that
 * variant (the user's manual override); the solver works around it.
 *
 * DP over the budget axis. dp[c] = best total quality achievable using slots
 * processed so far with exactly <= c characters, plus the back-pointers needed
 * to reconstruct the per-slot selection.
 */

interface Candidate {
  variantId: string;
  chars: number;
  quality: number;
}

interface Cell {
  quality: number;
  // selection for this prefix of slots at this budget
  selection: Record<string, string>;
  feasible: boolean;
}

function candidatesFor(slot: Slot, budget: number): Candidate[] {
  let pool = slot.variants;
  if (slot.lockedVariantId) {
    pool = pool.filter((v) => v.id === slot.lockedVariantId);
  }
  return pool
    .filter((v) => v.chars <= budget)
    .map((v) => ({ variantId: v.id, chars: v.chars, quality: v.quality }));
}

/** Cheapest variant for a slot, used to keep an infeasible slot from killing the whole answer. */
function cheapestVariant(slot: Slot): Candidate {
  const pool = slot.lockedVariantId
    ? slot.variants.filter((v) => v.id === slot.lockedVariantId)
    : slot.variants;
  const best = [...pool].sort((a, b) => a.chars - b.chars)[0] ?? slot.variants[0];
  return { variantId: best.id, chars: best.chars, quality: best.quality };
}

export function solve(slots: Slot[], budgetChars: number): SolverResult {
  const budget = Math.max(0, Math.floor(budgetChars));

  // dp indexed by character spend 0..budget.
  let dp: (Cell | null)[] = new Array(budget + 1).fill(null);
  dp[0] = { quality: 0, selection: {}, feasible: true };

  for (const slot of slots) {
    const next: (Cell | null)[] = new Array(budget + 1).fill(null);
    const cands = candidatesFor(slot, budget);

    // If no variant fits the budget, force the cheapest one (answer becomes
    // infeasible/over-budget but still assembled, matching the over-budget UI).
    const effective = cands.length > 0 ? cands : [cheapestVariant(slot)];
    const slotFeasible = cands.length > 0;

    for (let c = 0; c <= budget; c++) {
      const cur = dp[c];
      if (!cur) continue;
      for (const cand of effective) {
        const nc = c + cand.chars;
        const idx = Math.min(nc, budget); // clamp so infeasible spend still tracked at the ceiling
        const cand_quality = cur.quality + cand.quality;
        const cand_feasible = cur.feasible && slotFeasible && nc <= budget;
        const existing = next[idx];
        const better =
          !existing ||
          (cand_feasible && !existing.feasible) ||
          (cand_feasible === existing.feasible && cand_quality > existing.quality);
        if (better) {
          next[idx] = {
            quality: cand_quality,
            selection: { ...cur.selection, [slot.id]: cand.variantId },
            feasible: cand_feasible,
          };
        }
      }
    }
    dp = next;
  }

  // Best feasible cell at the highest quality; prefer feasible over infeasible.
  let best: Cell | null = null;
  let bestChars = 0;
  for (let c = 0; c <= budget; c++) {
    const cell = dp[c];
    if (!cell) continue;
    if (
      !best ||
      (cell.feasible && !best.feasible) ||
      (cell.feasible === best.feasible && cell.quality > best.quality)
    ) {
      best = cell;
      bestChars = c;
    }
  }

  if (!best) {
    return { selection: {}, totalChars: 0, totalQuality: 0, feasible: slots.length === 0 };
  }

  // Recompute exact char total from the actual selection (clamping above can
  // understate it for infeasible answers).
  const totalChars = slots.reduce((sum, slot) => {
    const vid = best!.selection[slot.id];
    const v = slot.variants.find((x) => x.id === vid);
    return sum + (v ? v.chars : 0);
  }, 0);

  return {
    selection: best.selection,
    totalChars,
    totalQuality: best.quality,
    feasible: best.feasible && totalChars <= budget,
  };
}

/**
 * Precompute the solver result for every budget level in [min, max] in one
 * pass so the slider is an O(1) lookup with no recompute on drag.
 */
export function precomputeAllBudgets(
  slots: Slot[],
  min: number,
  max: number
): Map<number, SolverResult> {
  const table = new Map<number, SolverResult>();
  for (let b = min; b <= max; b++) {
    table.set(b, solve(slots, b));
  }
  return table;
}

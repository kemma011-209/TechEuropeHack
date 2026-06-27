import type { WordResult, WordToken } from "./types";

/**
 * Word-level budget fitter (mirrors backend/app/graph/knapsack.py).
 *
 * Trims the answer to a character budget by removing the lowest-value words
 * first (value, then original order). Two properties the UI relies on:
 *
 * - Edit-derived words are protected: base filler is dropped before edits.
 * - Monotonic slider: the kept set at a higher budget is a superset of the kept
 *   set at a lower budget, so dragging the budget down removes words and
 *   dragging it back up re-adds the same words.
 *
 * Pure synchronous JS: never calls an LLM, never asks a model to count chars.
 */

/** Character length of the words joined by single spaces. */
export function assembledLen(words: WordToken[]): number {
  if (words.length === 0) return 0;
  return words.reduce((sum, w) => sum + w.text.length, 0) + (words.length - 1);
}

// Mirror of backend/app/graph/knapsack.py _STOPWORDS.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "into", "from", "by", "at", "as", "that", "which", "is", "are", "be", "our",
  "their", "its", "this", "these", "those", "then", "via", "using",
]);

/** Lower = removed earlier. Mirrors backend _removal_priority. */
function removalPriority(word: WordToken, index: number): number {
  const text = word.text.replace(/^[.,;:()"']+|[.,;:()"']+$/g, "");
  let priority = word.value;
  if (index === 0) priority += 1.0;
  else if (/^[A-Z]/.test(text)) priority += 0.2;
  if (STOPWORDS.has(text.toLowerCase())) priority -= 0.15;
  return priority;
}

export function solveWords(words: WordToken[], budgetChars: number): WordResult {
  const budget = Math.max(0, Math.floor(budgetChars));
  const n = words.length;
  if (n === 0) {
    return { keptIndices: [], totalChars: 0, totalValue: 0, feasible: true };
  }

  // Removal order: lowest priority first; ties broken from the END so the
  // opening subject+verb survive. Fixed total order keeps the slider monotonic.
  const removalOrder = words
    .map((w, i) => i)
    .sort(
      (a, b) =>
        removalPriority(words[a], a) - removalPriority(words[b], b) || b - a
    );

  const kept = new Set<number>(words.map((_, i) => i));
  const currentLen = () =>
    assembledLen([...kept].sort((a, b) => a - b).map((i) => words[i]));

  let ri = 0;
  while (currentLen() > budget && kept.size > 1 && ri < n) {
    kept.delete(removalOrder[ri]);
    ri += 1;
  }

  const keptIndices = [...kept].sort((a, b) => a - b);
  const chosen = keptIndices.map((i) => words[i]);
  const totalChars = assembledLen(chosen);
  return {
    keptIndices,
    totalChars,
    totalValue: chosen.reduce((sum, w) => sum + w.value, 0),
    feasible: totalChars <= budget,
  };
}

/** Join the kept words in original order into the final answer. */
export function assembleWords(words: WordToken[], result: WordResult): string {
  return result.keptIndices.map((i) => words[i]?.text ?? "").join(" ").trim();
}

/**
 * Precompute the solver result for every budget level in [min, max] so the
 * slider is an O(1) lookup with no recompute on drag.
 */
export function precomputeAllBudgets(
  words: WordToken[],
  min: number,
  max: number
): Map<number, WordResult> {
  const table = new Map<number, WordResult>();
  for (let b = min; b <= max; b++) {
    table.set(b, solveWords(words, b));
  }
  return table;
}

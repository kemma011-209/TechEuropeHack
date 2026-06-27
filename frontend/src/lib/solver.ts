import type { WordResult, WordToken } from "./types";

/**
 * Word-level budget fitter (mirrors backend/app/graph/knapsack.py).
 *
 * Optimal 0/1 knapsack: selects the subset of words that maximises total kept
 * value while fitting the character budget, packing the budget as full as
 * possible. The subject (word 0) is always kept; ties are broken toward using
 * more characters. Order is preserved on assembly.
 *
 * Note: unlike the old greedy fitter the kept set is NOT monotonic across
 * budgets - a word may swap in/out as the slider moves to pack better.
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

/** Higher = more valuable to keep. Mirrors backend _keep_value. */
function keepValue(word: WordToken, index: number): number {
  const text = word.text.replace(/^[.,;:()"']+|[.,;:()"']+$/g, "");
  let value = word.value;
  if (index !== 0 && /^[A-Z]/.test(text)) value += 0.2;
  if (STOPWORDS.has(text.toLowerCase())) value -= 0.15;
  return value;
}

export function solveWords(words: WordToken[], budgetChars: number): WordResult {
  const budget = Math.max(0, Math.floor(budgetChars));
  const n = words.length;
  if (n === 0) {
    return { keptIndices: [], totalChars: 0, totalValue: 0, feasible: true };
  }

  // Space-aware cost: word cost = len+1, capacity = budget+1 (the first kept
  // word reclaims one space). The subject (word 0) is always kept.
  const capacity = budget + 1;
  const cost0 = words[0].text.length + 1;
  const remaining = capacity - cost0;

  const chosen: number[] = [];
  if (remaining >= 0 && n > 1) {
    const items: { cost: number; val: number; idx: number }[] = [];
    for (let i = 1; i < n; i++) {
      items.push({ cost: words[i].text.length + 1, val: keepValue(words[i], i), idx: i });
    }
    const totalItemCost = items.reduce((s, it) => s + it.cost, 0);
    const cap = Math.min(remaining, totalItemCost);
    const m = items.length;
    // dp[i][c] = best {v: value, w: weight} using first i items within cap c.
    const dp: { v: number; w: number }[][] = Array.from({ length: m + 1 }, () =>
      new Array<{ v: number; w: number }>(cap + 1)
    );
    for (let c = 0; c <= cap; c++) dp[0][c] = { v: 0, w: 0 };
    for (let i = 1; i <= m; i++) {
      const { cost, val } = items[i - 1];
      for (let c = 0; c <= cap; c++) {
        let best = dp[i - 1][c]; // skip item i (same object reference)
        if (cost <= c) {
          const prev = dp[i - 1][c - cost];
          const cv = prev.v + val;
          const cw = prev.w + cost;
          if (cv > best.v || (cv === best.v && cw > best.w)) {
            best = { v: cv, w: cw };
          }
        }
        dp[i][c] = best;
      }
    }
    // Reconstruct: a new object reference at dp[i][c] means item i was taken.
    let c = cap;
    for (let i = m; i >= 1; i--) {
      if (dp[i][c] !== dp[i - 1][c]) {
        chosen.push(items[i - 1].idx);
        c -= items[i - 1].cost;
      }
    }
  }

  const keptIndices = [0, ...chosen].sort((a, b) => a - b);
  const chosenWords = keptIndices.map((i) => words[i]);
  const totalChars = assembledLen(chosenWords);
  return {
    keptIndices,
    totalChars,
    totalValue: chosenWords.reduce((sum, w) => sum + w.value, 0),
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

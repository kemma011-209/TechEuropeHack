"use client";

import { useCallback, useMemo, useState } from "react";
import { DEMO_DRAFT, DEMO_QUESTION, MIN_BUDGET, parseCharLimit } from "@/lib/demo";
import { assembleWords, precomputeAllBudgets, solveWords } from "@/lib/solver";
import type { WordToken } from "@/lib/types";

// Mirror backend/app/graph/nodes.py value weights so edited words keep the same
// edit-protection in the budget solver as base text.
const EDIT_WORD_VALUE = 0.85;
const BASE_WORD_VALUE = 0.3;

// Seed the wordspace from the demo draft. Every word is "base" here; once this
// panel is wired to the pipeline, rewrite-derived words come through as "edit"
// (rendered in blue) and the solver protects them above base text.
function seedWords(draft: string): WordToken[] {
  return draft.split(/\s+/).filter(Boolean).map((text, index) => ({
    index,
    text,
    source: "base",
    value: BASE_WORD_VALUE,
  }));
}

export default function WordspacePanel() {
  const [words] = useState<WordToken[]>(() => seedWords(DEMO_DRAFT));
  const [hoveredWord, setHoveredWord] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [accepted, setAccepted] = useState<string | null>(null);

  const charLimit = useMemo(() => parseCharLimit(DEMO_QUESTION), []);
  const [budget, setBudget] = useState(charLimit);

  const budgetTable = useMemo(
    () => precomputeAllBudgets(words, MIN_BUDGET, Math.max(charLimit, MIN_BUDGET)),
    [words, charLimit],
  );
  const result = useMemo(
    () => budgetTable.get(budget) ?? solveWords(words, budget),
    [budgetTable, budget, words],
  );
  const keptSet = useMemo(() => new Set(result.keptIndices), [result]);
  const assembled = useMemo(() => assembleWords(words, result), [words, result]);
  const overBudget = result.totalChars > budget;

  const toggleSelect = useCallback((index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }, []);

  const onAccept = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(assembled);
      setAccepted(`Copied final answer (${assembled.length} chars).`);
    } catch {
      setAccepted("Could not copy to clipboard.");
    }
  }, [assembled]);

  return (
    <div className="scrollbar-sleek absolute inset-0 overflow-y-auto bg-white">
      <div className="mx-auto max-w-[680px] px-6 pt-16 pb-8">
        <h2 className="text-xs uppercase tracking-wide text-neutral-400">
          Wordspace
        </h2>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-400">
          <span>
            <span className="text-blue-500">blue</span> = new words from the
            rewrite
          </span>
          <span>faded = trimmed to fit budget</span>
          <span>hover = char count</span>
          <span>click = select</span>
        </div>

        <div className="mt-3 rounded-xl border border-neutral-200 p-4">
          <p className="text-sm leading-relaxed">
            {words.map((w, i) => {
              const kept = keptSet.has(i);
              const isEdit = w.source === "edit";
              const isSel = selected.includes(i);
              return (
                <span
                  key={i}
                  onMouseEnter={() => setHoveredWord(i)}
                  onMouseLeave={() =>
                    setHoveredWord((h) => (h === i ? null : h))
                  }
                  onClick={() => toggleSelect(i)}
                  className={
                    "relative cursor-pointer transition-opacity duration-300 " +
                    (kept ? "opacity-100 " : "opacity-25 ") +
                    (isEdit ? "text-blue-500 " : "text-neutral-800 ") +
                    (isSel
                      ? "rounded-sm bg-amber-200/70 ring-1 ring-amber-400 "
                      : hoveredWord === i
                        ? "bg-neutral-100 "
                        : "")
                  }
                  title={`${w.source} word`}
                >
                  {hoveredWord === i && (
                    <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-white">
                      {w.text.length} chars{kept ? "" : " · trimmed"}
                    </span>
                  )}
                  {w.text}{" "}
                </span>
              );
            })}
          </p>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-neutral-500">Character count</span>
            <span
              className={
                overBudget ? "font-semibold text-red-600" : "text-neutral-600"
              }
            >
              {result.totalChars} / {budget}
              {overBudget ? " - over budget" : ""}
            </span>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>Budget (ceiling)</span>
              <span>{budget} chars</span>
            </div>
            <input
              type="range"
              min={MIN_BUDGET}
              max={Math.max(charLimit, MIN_BUDGET)}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="mt-1 w-full accent-neutral-800"
            />
            <div className="flex justify-between text-xs text-neutral-400">
              <span>{MIN_BUDGET}</span>
              <span>{Math.max(charLimit, MIN_BUDGET)}</span>
            </div>
          </div>

          <div className="mt-5 border-t border-neutral-100 pt-3">
            <span className="text-xs text-neutral-500">Final: </span>
            <p className="mt-1 text-sm">
              {result.keptIndices.map((i) => {
                const w = words[i];
                if (!w) return null;
                return (
                  <span
                    key={i}
                    className={w.source === "edit" ? "text-blue-500" : ""}
                  >
                    {w.text}{" "}
                  </span>
                );
              })}
            </p>
          </div>

          <div className="mt-5 border-t border-neutral-100 pt-3">
            <button
              onClick={onAccept}
              disabled={overBudget}
              className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:opacity-40"
              title={overBudget ? "Get under budget first" : ""}
            >
              Accept + copy final
            </button>
            {accepted && (
              <p className="mt-2 text-xs text-green-700">{accepted}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

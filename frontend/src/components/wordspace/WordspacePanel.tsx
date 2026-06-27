"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DEMO_QUESTION, MIN_BUDGET, parseCharLimit } from "@/lib/demo";
import { assembleWords, precomputeAllBudgets, solveWords } from "@/lib/solver";
import type { WordToken } from "@/lib/types";

function BudgetSlider({
  budget,
  min,
  max,
  onChange,
}: {
  budget: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  const used = budget;
  const free = Math.max(0, max - budget);
  const pct = max > 0 ? (budget / max) * 100 : 0;
  const allUsed = free === 0;
  const allFree = used === 0;
  const showDivider = !allUsed && !allFree;

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const next = Math.min(max, Math.max(min, Math.round(ratio * max)));
      onChange(next);
    },
    [max, min, onChange],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    updateFromClientX(e.clientX);
    const onMove = (ev: PointerEvent) => updateFromClientX(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const gap = showDivider ? 3 : 0;

  return (
    <div className="select-none text-sm">
      {/* Labels above the bar — spaced down from the key */}
      <div
        className={
          "mb-2.5 flex items-baseline pt-1 " +
          (allFree ? "justify-end" : "justify-between")
        }
      >
        {!allFree && (
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-xs text-neutral-500">Chars used</span>
            <span className="text-sm text-neutral-700">{used}</span>
          </span>
        )}
        {!allUsed && (
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-sm text-neutral-700">{free}</span>
            <span className="text-xs text-neutral-500">free</span>
          </span>
        )}
      </div>

      <div
        ref={barRef}
        onPointerDown={onPointerDown}
        className="relative h-[var(--budget-slider-height)] w-full cursor-col-resize"
      >
        {!allFree && (
          <div
            className="absolute inset-y-0 left-0 overflow-hidden rounded-2xl bg-gradient-to-r from-[#6f5a6c] to-[#7a6678]"
            style={{
              width: allUsed
                ? "100%"
                : `calc(${pct}% - ${gap}px)`,
            }}
          />
        )}

        {!allUsed && (
          <div
            className="absolute inset-y-0 right-0 overflow-hidden rounded-2xl bg-neutral-200"
            style={{
              width: allFree
                ? "100%"
                : `calc(${100 - pct}% - ${gap}px)`,
            }}
          />
        )}

        {showDivider && (
          <div
            className="pointer-events-none absolute top-1/2 z-10 h-5 w-px -translate-x-1/2 -translate-y-1/2 bg-neutral-400"
            style={{ left: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export default function WordspacePanel({
  words,
  refs,
  onToggleRef,
}: {
  words: WordToken[];
  refs: number[];
  onToggleRef: (index: number) => void;
}) {
  const [hoveredWord, setHoveredWord] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const charLimit = useMemo(() => parseCharLimit(DEMO_QUESTION), []);
  const maxBudget = Math.max(charLimit, MIN_BUDGET);
  const [budget, setBudget] = useState(charLimit);

  const budgetTable = useMemo(
    () => precomputeAllBudgets(words, MIN_BUDGET, maxBudget),
    [words, maxBudget],
  );
  const result = useMemo(
    () => budgetTable.get(budget) ?? solveWords(words, budget),
    [budgetTable, budget, words],
  );
  const keptSet = useMemo(() => new Set(result.keptIndices), [result]);
  const assembled = useMemo(() => assembleWords(words, result), [words, result]);
  const overBudget = result.totalChars > budget;

  const onAcceptAndDownload = useCallback(async () => {
    const blob = new Blob([assembled], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "final-answer.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    try {
      await navigator.clipboard.writeText(assembled);
      setStatus(`Accepted + logged (${assembled.length} chars).`);
    } catch {
      setStatus(`Logged final answer (${assembled.length} chars).`);
    }
  }, [assembled]);

  return (
    <div className="relative flex h-full w-full flex-col bg-stone-50">
      {/* Legend — top of pane, compact single row */}
      <div className="shrink-0 px-4 pt-3 pb-3 sm:px-10 md:px-16 lg:px-22">
        <div className="flex flex-nowrap items-baseline gap-x-3 text-xs leading-snug text-neutral-500">
          <h2 className="shrink-0 text-xs text-neutral-700">Wordspace</h2>
          <span className="shrink-0">
            <span className="text-blue-500">blue</span> = new words
          </span>
          <span className="shrink-0">faded = trimmed</span>
          <span className="shrink-0">hover = chars</span>
          <span className="shrink-0">click = select</span>
        </div>
      </div>

      {/* Scrollable content — never overlapped by footer */}
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-8 pt-8 sm:px-10 md:px-16 lg:px-22">
          <div className="max-w-[640px] text-left text-[15px] leading-[1.65] text-neutral-700">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3 text-sm">
              <span className="text-neutral-600">Character count</span>
              <span className={overBudget ? "text-red-500" : "text-neutral-700"}>
                {result.totalChars} / {budget}
                {overBudget ? " - over budget" : ""}
              </span>
            </div>

            <p className="mt-4">
              {words.map((w, i) => {
                const kept = keptSet.has(i);
                const isEdit = w.source === "edit";
                const isRef = refs.includes(i);
                return (
                  <span
                    key={i}
                    onMouseEnter={() => setHoveredWord(i)}
                    onMouseLeave={() =>
                      setHoveredWord((h) => (h === i ? null : h))
                    }
                    onClick={() => onToggleRef(i)}
                    className={
                      "relative cursor-pointer transition-opacity duration-300 " +
                      (kept ? "opacity-100 " : "opacity-25 ") +
                      (isEdit ? "text-blue-500 " : "") +
                      (isRef
                        ? "rounded-sm bg-amber-200/70 ring-1 ring-amber-400 "
                        : hoveredWord === i
                          ? "bg-black/5 "
                          : "")
                    }
                    title={`${w.source} word · click to reference`}
                  >
                    {hoveredWord === i && (
                      <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black px-1.5 py-0.5 text-[10px] text-white">
                        {w.text.length} chars{kept ? "" : " · trimmed"}
                      </span>
                    )}
                    {w.text}{" "}
                  </span>
                );
              })}
            </p>

            <div className="mt-6">
              <span className="text-xs text-neutral-500">Final</span>
              <p className="mt-2">
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
          </div>
        </div>
      </div>

      {/* Footer — pinned to bottom, matches chat input pb-3 */}
      <div className="shrink-0 bg-stone-50 px-4 pb-3 pt-2 sm:px-10 md:px-16 lg:px-22">
        <div className="max-w-[640px]">
          <BudgetSlider
            budget={budget}
            min={MIN_BUDGET}
            max={maxBudget}
            onChange={setBudget}
          />

          <div className="pt-2">
            <button
              onClick={onAcceptAndDownload}
              disabled={overBudget}
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-600 shadow-xs transition-colors hover:bg-neutral-50 disabled:opacity-40"
              title={overBudget ? "Get under budget first" : ""}
            >
              Accept + log
            </button>
          </div>
          {status && (
            <p className="pt-2 text-center text-xs text-neutral-400">{status}</p>
          )}
        </div>
      </div>
    </div>
  );
}

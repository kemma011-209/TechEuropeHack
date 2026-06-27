"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CHAR_LIMIT,
  DEMO_CONTEXT,
  DEMO_CRITICS,
  DEMO_DRAFT,
  DEMO_QUESTION,
  MIN_BUDGET,
  parseCharLimit,
} from "@/lib/demo";
import * as api from "@/lib/api";
import { buildSlots } from "@/lib/slots";
import { precomputeAllBudgets, solve } from "@/lib/solver";
import type { Critic, PhaseMeta, PhaseStatus, Slot } from "@/lib/types";

interface Phase {
  status: PhaseStatus;
  meta?: PhaseMeta;
  detail?: string;
}

const INITIAL_PHASE: Phase = { status: "ready" };

function rankItems(slots: Slot[]): { id: string; text: string }[] {
  return slots.flatMap((s) =>
    s.variants.map((v) => ({ id: `${s.id}::${v.id}`, text: v.text }))
  );
}

/** Apply SIE relevance scores to variant.quality (keeps static weight when absent). */
function applyScores(slots: Slot[], rankings: Record<string, number>): Slot[] {
  if (!Object.keys(rankings).length) return slots;
  return slots.map((s) => ({
    ...s,
    variants: s.variants.map((v) => {
      const score = rankings[`${s.id}::${v.id}`];
      return typeof score === "number" ? { ...v, quality: score } : v;
    }),
  }));
}

function rebuildSlots(
  draft: string,
  critics: Critic[],
  shortenedByIndex: Record<number, string>,
  prev: Slot[] = []
): Slot[] {
  const next = buildSlots(draft, critics, shortenedByIndex);
  // Preserve a user's manual lock when the same slot + variant still exists.
  return next.map((slot) => {
    const prior = prev.find((p) => p.id === slot.id);
    if (prior?.lockedVariantId && slot.variants.some((v) => v.id === prior.lockedVariantId)) {
      return { ...slot, lockedVariantId: prior.lockedVariantId };
    }
    return slot;
  });
}

export default function ConsolePage() {
  const [question, setQuestion] = useState(DEMO_QUESTION);
  const [context, setContext] = useState(DEMO_CONTEXT);
  const [contextOpen, setContextOpen] = useState(false);

  const [draft, setDraft] = useState(DEMO_DRAFT);
  const [critics, setCritics] = useState<Critic[]>(DEMO_CRITICS);
  const [shortenedByIndex, setShortenedByIndex] = useState<Record<number, string>>({});

  const [slots, setSlots] = useState<Slot[]>(() =>
    rebuildSlots(DEMO_DRAFT, DEMO_CRITICS, {})
  );

  const charLimit = useMemo(() => parseCharLimit(question), [question]);
  const [budget, setBudget] = useState(DEFAULT_CHAR_LIMIT);

  const [phases, setPhases] = useState<Record<string, Phase>>({
    draft: INITIAL_PHASE,
    critique: INITIAL_PHASE,
    shorten: INITIAL_PHASE,
    rank: INITIAL_PHASE,
    solver: { status: "done", detail: "pure JS - no LLM" },
  });
  const [warning, setWarning] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Keep budget within [MIN_BUDGET, charLimit] when the question changes.
  useEffect(() => {
    setBudget((b) => Math.min(Math.max(b, MIN_BUDGET), charLimit));
  }, [charLimit]);

  // Precompute solver results for every budget level in one pass.
  const budgetTable = useMemo(
    () => precomputeAllBudgets(slots, MIN_BUDGET, charLimit),
    [slots, charLimit]
  );
  const result = useMemo(
    () => budgetTable.get(budget) ?? solve(slots, budget),
    [budgetTable, budget, slots]
  );

  const assembled = useMemo(
    () =>
      slots
        .map((slot) => {
          const vid = result.selection[slot.id];
          return slot.variants.find((v) => v.id === vid)?.text ?? slot.original;
        })
        .join(" "),
    [slots, result]
  );

  const totalChars = result.totalChars;
  const overBudget = totalChars > charLimit;

  const setPhase = useCallback((key: string, phase: Phase) => {
    setPhases((p) => ({ ...p, [key]: phase }));
  }, []);

  // SIE reranker -> solver quality weights (graceful: static weights if SIE off).
  const runRank = useCallback(
    async (slotsToRank: Slot[], q: string) => {
      const items = rankItems(slotsToRank);
      if (!items.length) return;
      setPhase("rank", { status: "running" });
      const res = await api.rank(q, items);
      if (res.source === "sie" && Object.keys(res.rankings).length) {
        setSlots((prev) => applyScores(prev, res.rankings));
      }
      setPhase("rank", {
        status: "done",
        meta: res.meta,
        detail:
          res.source === "sie"
            ? "scores -> solver quality"
            : "SIE off - static weights",
      });
    },
    [setPhase]
  );

  // Background shorten on first load (falls back to local truncation offline).
  const didShorten = useRef(false);
  useEffect(() => {
    if (didShorten.current) return;
    didShorten.current = true;
    (async () => {
      const originals = buildSlots(DEMO_DRAFT, DEMO_CRITICS, {}).map((s) => s.original);
      const results = await Promise.all(originals.map((o) => api.shorten(o)));
      const map: Record<number, string> = {};
      results.forEach((r, i) => (map[i] = r.shortened));
      setShortenedByIndex(map);
      const withShort = rebuildSlots(DEMO_DRAFT, DEMO_CRITICS, map);
      setSlots((prev) => rebuildSlots(DEMO_DRAFT, DEMO_CRITICS, map, prev));
      const meta = results[0]?.meta;
      setPhases((p) => ({
        ...p,
        shorten: {
          status: meta?.ok ? "done" : "ready",
          meta,
          detail: meta?.fallback ? "demo / local truncation" : "shortened",
        },
      }));
      void runRank(withShort, DEMO_QUESTION);
    })();
  }, [runRank]);

  const runPipeline = useCallback(async () => {
    setRunning(true);
    setWarning(null);

    // 1. Draft (Superlinked)
    setPhase("draft", { status: "running" });
    const draftRes = await api.draft(question, context);
    setDraft(draftRes.draft);
    setPhase("draft", {
      status: draftRes.meta.ok ? "done" : draftRes.meta.fallback ? "done" : "error",
      meta: draftRes.meta,
      detail: `source: ${draftRes.source}`,
    });

    // 2. Critique (Gemma)
    setPhase("critique", { status: "running" });
    const critRes = await api.critique(question, draftRes.draft);
    setCritics(critRes.critics);
    if (critRes.warning) setWarning(critRes.warning);
    setPhase("critique", {
      status: "done",
      meta: critRes.meta,
      detail: `source: ${critRes.source} | parse_ok: ${critRes.parse_ok} | ${critRes.critics.length} edits`,
    });

    // 3. Shorten (Superlinked) - one call per slot
    setPhase("shorten", { status: "running" });
    const freshSlots = buildSlots(draftRes.draft, critRes.critics, {});
    const shortResults = await Promise.all(
      freshSlots.map((s) => api.shorten(s.original))
    );
    const map: Record<number, string> = {};
    shortResults.forEach((r, i) => (map[i] = r.shortened));
    setShortenedByIndex(map);
    const shortMeta = shortResults[0]?.meta;
    setPhase("shorten", {
      status: "done",
      meta: shortMeta,
      detail: shortMeta?.fallback ? "demo / local truncation" : "shortened",
    });

    // Rebuild slots from the fresh content, then score them with SIE.
    const built = rebuildSlots(draftRes.draft, critRes.critics, map);
    setSlots(built);
    await runRank(built, question);
    setRunning(false);
  }, [question, context, setPhase, runRank]);

  const regenerateDraft = useCallback(async () => {
    setRunning(true);
    setPhase("draft", { status: "running" });
    const draftRes = await api.draft(question, context);
    setDraft(draftRes.draft);
    setPhase("draft", {
      status: "done",
      meta: draftRes.meta,
      detail: `source: ${draftRes.source}`,
    });
    setSlots((prev) => rebuildSlots(draftRes.draft, critics, shortenedByIndex, prev));
    setRunning(false);
  }, [question, context, critics, shortenedByIndex, setPhase]);

  const lockVariant = useCallback((slotId: string, variantId: string) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === slotId
          ? { ...s, lockedVariantId: s.lockedVariantId === variantId ? null : variantId }
          : s
      )
    );
  }, []);

  return (
    <div className="min-h-screen bg-white text-black font-mono">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">GRANTSMITH 1.0</h1>
            <p className="mt-2 max-w-3xl text-sm text-black/60">
              Draft, critique, and budget-solve grant answers. A drafter and shortener
              run on Superlinked; a five-persona critic swarm runs on Gemma. The
              character ceiling is enforced by a deterministic knapsack solver - never
              by asking a model to count characters.
            </p>
          </div>
          <span className="shrink-0 bg-black px-2 py-1 text-xs font-semibold text-white">
            SIE + GEMMA
          </span>
        </div>

        {warning && (
          <div className="mt-4 border border-yellow-500 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
            {warning}
          </div>
        )}

        {/* Controls */}
        <div className="mt-6 space-y-3">
          <label className="block text-xs uppercase tracking-wide text-black/50">
            Question
          </label>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <button
            onClick={() => setContextOpen((o) => !o)}
            className="text-xs text-black/50 underline-offset-2 hover:underline"
          >
            {contextOpen ? "- hide context" : "+ company context (optional)"}
          </button>
          {contextOpen && (
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={6}
              className="w-full border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          )}
          <div className="flex gap-3">
            <button
              onClick={runPipeline}
              disabled={running}
              className="bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {running ? "Running..." : "Run pipeline"}
            </button>
            <button
              onClick={regenerateDraft}
              disabled={running}
              className="border border-black/30 px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-40"
            >
              Regenerate draft
            </button>
          </div>
        </div>

        {/* Pipeline visualizer */}
        <div className="mt-8">
          <h2 className="text-xs uppercase tracking-wide text-black/50">Pipeline</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <PhaseCard
              name="Draft"
              provider="SIE / Gemma"
              phase={phases.draft}
              open={!!expanded.draft}
              onToggle={() => setExpanded((e) => ({ ...e, draft: !e.draft }))}
            />
            <PhaseCard
              name="Critique"
              provider="Gemma"
              phase={phases.critique}
              open={!!expanded.critique}
              onToggle={() => setExpanded((e) => ({ ...e, critique: !e.critique }))}
            />
            <PhaseCard
              name="Shorten"
              provider="SIE / Gemma"
              phase={phases.shorten}
              open={!!expanded.shorten}
              onToggle={() => setExpanded((e) => ({ ...e, shorten: !e.shorten }))}
            />
            <PhaseCard
              name="Rank"
              provider="SIE reranker"
              phase={phases.rank}
              open={!!expanded.rank}
              onToggle={() => setExpanded((e) => ({ ...e, rank: !e.rank }))}
            />
            <PhaseCard
              name="Solver"
              provider="local JS"
              phase={{
                status: "done",
                detail: `picks ${Object.keys(result.selection).length} slot(s) | ${result.feasible ? "within budget" : "over budget"}`,
              }}
              open={false}
              onToggle={() => {}}
              noToggle
            />
          </div>
        </div>

        {/* Two-column workspace */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Slots */}
          <div>
            <h2 className="text-xs uppercase tracking-wide text-black/50">Slots</h2>
            <div className="mt-3 space-y-4">
              {slots.map((slot, i) => {
                const pick = result.selection[slot.id];
                return (
                  <div key={slot.id} className="border border-black/15 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold">Slot {i}</span>
                      {slot.lockedVariantId && (
                        <button
                          onClick={() => lockVariant(slot.id, slot.lockedVariantId!)}
                          className="text-xs text-black/50 underline"
                        >
                          locked - reset to auto
                        </button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {slot.variants.map((v) => {
                        const selected = pick === v.id;
                        return (
                          <button
                            key={v.id}
                            onClick={() => lockVariant(slot.id, v.id)}
                            className={`flex w-full items-center justify-between gap-2 border px-2 py-1.5 text-left text-sm ${
                              selected ? "border-black bg-black/5" : "border-transparent hover:bg-black/5"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span>{selected ? "\u25CF" : "\u25CB"}</span>
                              <span>{v.label}</span>
                              {selected && (
                                <span className="text-xs text-black/60">{"\u2605 solver pick"}</span>
                              )}
                              {v.fullRewrite && (
                                <span className="bg-red-100 px-1 text-xs text-red-700">
                                  full rewrite
                                </span>
                              )}
                              {slot.lockedVariantId === v.id && (
                                <span className="text-xs text-black/40">[locked]</span>
                              )}
                            </span>
                            <span className="shrink-0 text-xs text-black/50">
                              q {v.quality.toFixed(2)} | {v.chars} ch
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          <div>
            <h2 className="text-xs uppercase tracking-wide text-black/50">Preview</h2>
            <div className="mt-3 border border-black/15 p-4">
              <p className="text-sm leading-relaxed">{assembled}</p>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span>Character count</span>
                <span className={overBudget ? "font-semibold text-red-600" : "text-black/70"}>
                  {totalChars} / {charLimit}
                  {overBudget ? " - over budget" : ""}
                </span>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-xs text-black/50">
                  <span>Budget</span>
                  <span>{budget} chars</span>
                </div>
                <input
                  type="range"
                  min={MIN_BUDGET}
                  max={charLimit}
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="mt-1 w-full accent-black"
                />
                <div className="flex justify-between text-xs text-black/40">
                  <span>{MIN_BUDGET}</span>
                  <span>{charLimit}</span>
                </div>
              </div>

              <div className="mt-5 border-t border-black/10 pt-3 text-sm">
                <span className="text-black/50">Solver picks: </span>
                {slots.map((slot) => {
                  const vid = result.selection[slot.id];
                  const label = slot.variants.find((v) => v.id === vid)?.label ?? "-";
                  return (
                    <span key={slot.id} className="mr-1 bg-black px-1.5 py-0.5 text-xs text-white">
                      {label}
                    </span>
                  );
                })}
                <p className="mt-1 text-xs text-black/40">
                  best fit within budget (quality {result.totalQuality.toFixed(2)})
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function statusBadge(status: PhaseStatus): { label: string; cls: string } {
  switch (status) {
    case "running":
      return { label: "Running", cls: "text-blue-600" };
    case "done":
      return { label: "Done", cls: "text-green-700" };
    case "error":
      return { label: "Error", cls: "text-red-600" };
    default:
      return { label: "Ready", cls: "text-black/50" };
  }
}

function PhaseCard({
  name,
  provider,
  phase,
  open,
  onToggle,
  noToggle,
}: {
  name: string;
  provider: string;
  phase: Phase;
  open: boolean;
  onToggle: () => void;
  noToggle?: boolean;
}) {
  const badge = statusBadge(phase.status);
  const meta = phase.meta;
  return (
    <div className="border border-black/15 p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold">{name}</span>
          <span className="ml-2 text-xs text-black/40">{meta?.provider ?? provider}</span>
          {meta?.fallback && (
            <span className="ml-2 bg-black/10 px-1 text-xs text-black/60">demo</span>
          )}
        </div>
        <span className={`text-xs ${badge.cls}`}>{badge.label}</span>
      </div>
      <div className="mt-1 text-xs text-black/50">
        {phase.detail}
        {meta && (
          <>
            {" "}
            {meta.model && `| ${meta.model}`} {meta.latency_ms ? `| ${meta.latency_ms}ms` : ""}
          </>
        )}
      </div>
      {meta?.error && <div className="mt-1 text-xs text-red-600">{meta.error}</div>}
      {!noToggle && meta?.raw_snippet && (
        <div className="mt-2">
          <button onClick={onToggle} className="text-xs text-black/40 underline">
            {open ? "hide raw" : "view raw"}
          </button>
          {open && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words border border-black/10 bg-black/[0.03] p-2 text-xs text-black/70">
              {meta.raw_snippet}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

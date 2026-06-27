"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEMO_CONTEXT, DEMO_QUESTION, MIN_BUDGET, parseCharLimit } from "@/lib/demo";
import * as api from "@/lib/api";
import { assembleWords, precomputeAllBudgets, solveWords } from "@/lib/solver";
import type {
  Critic,
  ContextBundle,
  EditSummary,
  PersonaConfig,
  PlannedOp,
  WordToken,
} from "@/lib/types";

type StageMeta = Record<string, Record<string, unknown>>;

async function fileToBase64(file: File): Promise<{ name: string; b64: string }> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const b64 = dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl;
  return { name: file.name, b64 };
}

function opLabel(op: PlannedOp): string {
  switch (op.op) {
    case "replace":
      return `replace #${op.index} -> "${op.word}"`;
    case "insert":
      return `insert "${op.word}" @ #${op.index}`;
    case "delete":
      return `delete #${op.index}`;
    case "move":
      return `move #${op.from} -> #${op.to}`;
    default:
      return JSON.stringify(op);
  }
}

export default function ConsolePage() {
  // --- Stage 1: context gathering ---
  const [topic, setTopic] = useState("Innovate UK Labs of the Future funding");
  const [companyName, setCompanyName] = useState("Armature Labs");
  const [blurb, setBlurb] = useState(DEMO_CONTEXT);
  const [pdf, setPdf] = useState<File | null>(null);
  const [bundle, setBundle] = useState<ContextBundle | null>(null);
  const [gathering, setGathering] = useState(false);

  // --- Stage 2-6: pipeline outputs ---
  const [question, setQuestion] = useState(DEMO_QUESTION);
  const [personas, setPersonas] = useState<PersonaConfig[]>([]);
  const [draft, setDraft] = useState("");
  const [draftSource, setDraftSource] = useState("");
  const [critics, setCritics] = useState<Critic[]>([]);
  const [editList, setEditList] = useState<EditSummary[]>([]);
  const [plannedOps, setPlannedOps] = useState<PlannedOp[]>([]);
  const [droppedOps, setDroppedOps] = useState<PlannedOp[]>([]);
  const [words, setWords] = useState<WordToken[]>([]);
  const [stageMeta, setStageMeta] = useState<StageMeta>({});
  const [running, setRunning] = useState(false);
  const [accepted, setAccepted] = useState<string | null>(null);
  const [gatherWarning, setGatherWarning] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [hoveredWord, setHoveredWord] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${api.API_BASE}/health`)
      .then((r) => setBackendOk(r.ok))
      .catch(() => setBackendOk(false));
  }, []);

  const charLimit = useMemo(() => parseCharLimit(question), [question]);
  const [budget, setBudget] = useState(charLimit);

  const budgetTable = useMemo(
    () => precomputeAllBudgets(words, MIN_BUDGET, Math.max(charLimit, MIN_BUDGET)),
    [words, charLimit]
  );
  const result = useMemo(
    () => budgetTable.get(budget) ?? solveWords(words, budget),
    [budgetTable, budget, words]
  );
  const keptSet = useMemo(() => new Set(result.keptIndices), [result]);
  const assembled = useMemo(() => assembleWords(words, result), [words, result]);
  const overBudget = result.totalChars > budget;

  // --- Stage 1: gather ---
  const runGather = useCallback(async () => {
    setGathering(true);
    setAccepted(null);
    setGatherWarning(null);
    setPipelineError(null);
    try {
      let doc: { name: string; b64: string } | null = null;
      if (pdf) doc = await fileToBase64(pdf);
      const res = await api.gather({
        topic,
        company_name: companyName,
        user_blurb: blurb,
        document_name: doc?.name,
        document_b64: doc?.b64,
      });
      setBundle(res.bundle);
    } catch (err) {
      setGatherWarning(String(err));
      setBundle({
        topic,
        company_name: companyName,
        user_blurb: blurb,
        documents: [],
        search_results: [],
        consolidated_summary: "",
        status: "ready",
        gathered_at: Date.now() / 1000,
      });
    } finally {
      setGathering(false);
    }
  }, [topic, companyName, blurb, pdf]);

  // --- Stage 2-6: run pipeline ---
  const runPipeline = useCallback(async () => {
    if (!bundle) return;
    setRunning(true);
    setAccepted(null);
    setPipelineError(null);
    try {
      const res = await api.runPipeline(question, bundle, charLimit);
      setPersonas(res.personas ?? []);
      setDraft(res.draft ?? "");
      setDraftSource(res.draft_source ?? "");
      setCritics(res.critics ?? []);
      setEditList(res.edit_list ?? []);
      setPlannedOps(res.planned_ops ?? []);
      setDroppedOps(res.dropped_ops ?? []);
      setWords(res.words ?? []);
      setStageMeta((res.stage_meta ?? {}) as StageMeta);
      setBudget(charLimit);
    } catch (err) {
      setPipelineError(String(err));
      setStageMeta({});
    } finally {
      setRunning(false);
    }
  }, [bundle, question, charLimit]);

  const onAccept = useCallback(async () => {
    try {
      const res = await api.accept({
        question,
        draft,
        final: assembled,
        char_limit: budget,
        topic,
        context: bundle,
        critiques: critics,
        planned_ops: plannedOps,
        words,
        personas,
        providers: {
          draft: draftSource,
          plan: stageMeta.plan?.provider,
        },
      });
      setAccepted(
        `Stored record ${res.stored.id.slice(0, 8)} (${res.total_records} total).`
      );
    } catch {
      setAccepted("Accept failed: backend unreachable.");
    }
  }, [
    question,
    draft,
    assembled,
    budget,
    topic,
    bundle,
    critics,
    plannedOps,
    words,
    personas,
    draftSource,
    stageMeta,
  ]);

  const hasResult = draft.length > 0 || words.length > 0;

  return (
    <div className="min-h-screen bg-white text-black font-mono">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">GRANTSMITH 3.0</h1>
            <p className="mt-2 max-w-3xl text-sm text-black/60">
              Critics give feedback, a distiller turns it into a wordspace edit
              plan (structured ops, never a rewrite), the plan is reviewed and
              applied, then a deterministic word-level solver trims to the budget -
              protecting edited words over base text. Drag the budget to add or
              remove words live.
            </p>
          </div>
          <span className="shrink-0 bg-black px-2 py-1 text-xs font-semibold text-white">
            WORDSPACE FIT
          </span>
          {backendOk === false && (
            <span className="shrink-0 border border-red-500 px-2 py-1 text-xs text-red-700">
              Backend offline ({api.API_BASE})
            </span>
          )}
          {backendOk === true && (
            <span className="shrink-0 text-xs text-green-700">Backend connected</span>
          )}
        </div>

        {(gatherWarning || pipelineError) && (
          <div className="mt-4 space-y-2">
            {gatherWarning && (
              <div className="border border-yellow-500 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
                Gather warning: {gatherWarning} (using local context only)
              </div>
            )}
            {pipelineError && (
              <div className="border border-red-500 bg-red-50 px-3 py-2 text-xs text-red-900">
                {pipelineError}
              </div>
            )}
          </div>
        )}

        {/* Stage 1: Context gathering gate */}
        <section className="mt-8 border border-black/15 p-5">
          <h2 className="text-xs uppercase tracking-wide text-black/50">
            1 - Context gathering (gate)
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-black/50">Application / grant topic</span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="mt-1 w-full border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs text-black/50">Company name</span>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1 w-full border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="text-xs text-black/50">Company blurb (optional)</span>
            <textarea
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              rows={4}
              className="mt-1 w-full border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="text-xs text-black/50">
              PDF (optional, OCR via SIE):{" "}
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
            </label>
            <button
              onClick={runGather}
              disabled={gathering}
              className="bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {gathering ? "Gathering..." : "Gather context"}
            </button>
            {bundle && (
              <span
                className={`text-xs ${gatherWarning ? "text-yellow-700" : "text-green-700"}`}
              >
                {gatherWarning ? "Offline context" : "Ready"} -{" "}
                {bundle.search_results.length} web result(s), {bundle.documents.length} doc(s)
              </span>
            )}
          </div>
        </section>

        {/* Stage 2: question + run */}
        <section className="mt-6 border border-black/15 p-5">
          <h2 className="text-xs uppercase tracking-wide text-black/50">
            2 - Application question
          </h2>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="mt-3 w-full border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={runPipeline}
              disabled={!bundle || running}
              className="bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
              title={!bundle ? "Gather context first" : ""}
            >
              {running ? "Running pipeline..." : "Run pipeline"}
            </button>
            <span className="text-xs text-black/40">char limit parsed: {charLimit}</span>
            {running && (
              <span className="text-xs text-blue-700">
                Running pipeline… (Gemma calls, ~30–60s)
              </span>
            )}
          </div>
        </section>

        {/* Pipeline stage meta */}
        {(Object.keys(stageMeta).length > 0 || running) && (
          <section className="mt-6">
            <h2 className="text-xs uppercase tracking-wide text-black/50">
              Pipeline stages
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
              {(
                ["personas", "draft", "critique", "review", "solver"] as const
              ).map((key) => {
                const m = stageMeta[key];
                return (
                  <div key={key} className="border border-black/15 p-3">
                    <div className="text-sm font-semibold capitalize">{key}</div>
                    <div className="mt-1 text-xs text-black/50">
                      {running && !m
                        ? "…"
                        : m
                          ? `${String(m.provider ?? "-")}${m.fallback ? " (demo)" : ""}`
                          : "-"}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Personas */}
        {personas.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs uppercase tracking-wide text-black/50">
              Critic personas (meta-harness)
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {personas.map((p) => (
                <div key={p.persona} className="border border-black/15 p-3">
                  <div className="text-sm font-semibold">{p.persona}</div>
                  <p className="mt-1 text-xs text-black/60">{p.lens_prompt}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {hasResult && (
          <>
            {/* Draft */}
            <section className="mt-6 border border-black/15 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-wide text-black/50">
                  Initial draft (held in memory)
                </h2>
                <span className="text-xs text-black/40">
                  source: {draftSource} | {draft.length} ch
                </span>
              </div>
              <p className="mt-2 text-sm text-black/80">{draft}</p>
            </section>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Edit plan */}
              <div>
                <h2 className="text-xs uppercase tracking-wide text-black/50">
                  Edit plan ({plannedOps.length} ops)
                </h2>
                {editList.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {editList.map((e, i) => (
                      <li key={i} className="text-black/70">
                        - {e.summary}
                        {e.source_critics && e.source_critics.length > 0 && (
                          <span className="text-black/40">
                            {" "}
                            ({e.source_critics.join(", ")})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 space-y-1">
                  {plannedOps.map((op, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border border-black/15 px-2 py-1 text-xs"
                    >
                      <span>{opLabel(op)}</span>
                      {op.source_critic && (
                        <span className="text-black/40">{op.source_critic}</span>
                      )}
                    </div>
                  ))}
                  {plannedOps.length === 0 && (
                    <p className="text-xs text-black/40">
                      No edits applied (draft used as-is).
                    </p>
                  )}
                  {droppedOps.length > 0 && (
                    <p className="mt-2 text-xs text-red-600">
                      {droppedOps.length} op(s) dropped in review (invalid/out of
                      range).
                    </p>
                  )}
                </div>
              </div>

              {/* Wordspace + budget + accept */}
              <div>
                <h2 className="text-xs uppercase tracking-wide text-black/50">
                  Wordspace
                </h2>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-black/40">
                  <span>
                    <span className="text-blue-500">blue</span> = new words from
                    the rewrite
                  </span>
                  <span>faded = trimmed to fit budget</span>
                  <span>hover a word for its char count</span>
                </div>
                <div className="mt-3 border border-black/15 p-4">
                  <p className="text-sm leading-relaxed">
                    {words.map((w, i) => {
                      const kept = keptSet.has(i);
                      const isEdit = w.source === "edit";
                      return (
                        <span
                          key={i}
                          onMouseEnter={() => setHoveredWord(i)}
                          onMouseLeave={() =>
                            setHoveredWord((h) => (h === i ? null : h))
                          }
                          className={
                            "relative cursor-default transition-opacity duration-300 " +
                            (kept ? "opacity-100 " : "opacity-25 ") +
                            (isEdit ? "text-blue-500 " : "text-black ") +
                            (hoveredWord === i ? "bg-black/5 " : "")
                          }
                          title={`${w.source} word`}
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

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span>Character count</span>
                    <span
                      className={
                        overBudget ? "font-semibold text-red-600" : "text-black/70"
                      }
                    >
                      {result.totalChars} / {budget}
                      {overBudget ? " - over budget" : ""}
                    </span>
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center justify-between text-xs text-black/50">
                      <span>Budget (ceiling)</span>
                      <span>{budget} chars</span>
                    </div>
                    <input
                      type="range"
                      min={MIN_BUDGET}
                      max={Math.max(charLimit, MIN_BUDGET)}
                      value={budget}
                      onChange={(e) => setBudget(Number(e.target.value))}
                      className="mt-1 w-full accent-black"
                    />
                    <div className="flex justify-between text-xs text-black/40">
                      <span>{MIN_BUDGET}</span>
                      <span>{Math.max(charLimit, MIN_BUDGET)}</span>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-black/10 pt-3">
                    <span className="text-black/50 text-xs">Final: </span>
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

                  <div className="mt-5 border-t border-black/10 pt-3">
                    <button
                      onClick={onAccept}
                      disabled={overBudget}
                      className="bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
                      title={overBudget ? "Get under budget first" : ""}
                    >
                      Accept + log training data
                    </button>
                    {accepted && (
                      <p className="mt-2 text-xs text-green-700">{accepted}</p>
                    )}
                    <p className="mt-2 text-xs text-black/40">
                      Logs (draft, final, char limit) + the edit plan on accept.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

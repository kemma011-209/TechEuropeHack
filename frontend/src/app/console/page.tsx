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

// Mirror backend/app/graph/nodes.py value weights so chat-edited words keep the
// same edit-protection in the budget solver.
const EDIT_WORD_VALUE = 0.85;
const BASE_WORD_VALUE = 0.3;

function tokensToWordTokens(
  tokens: { text: string; source: string }[]
): WordToken[] {
  return tokens.map((t, i) => ({
    index: i,
    text: t.text,
    source: t.source === "edit" ? "edit" : "base",
    value: t.source === "edit" ? EDIT_WORD_VALUE : BASE_WORD_VALUE,
  }));
}

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
  // Span-merge ops carry span_original instead of a word index; prefer showing
  // the original phrase when there's no index (the pipeline edit plan).
  const target =
    op.span_original !== undefined
      ? `"${op.span_original}"`
      : op.index !== undefined
        ? `#${op.index}`
        : "";
  switch (op.op) {
    case "replace":
      return `replace ${target} -> "${op.word}"`;
    case "insert":
      return op.index !== undefined
        ? `insert "${op.word}" @ #${op.index}`
        : `insert "${op.word}"`;
    case "delete":
      return `delete ${target}`;
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
  const [searchPrompt, setSearchPrompt] = useState(
    "What are you applying for?"
  );
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

  // --- Interactive chat (tag-aware wordspace edits) ---
  const [refs, setRefs] = useState<number[]>([]);
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "assistant"; text: string; ops?: PlannedOp[] }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

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
        search_prompt: searchPrompt,
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
  }, [topic, companyName, blurb, searchPrompt, pdf]);

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

  const toggleRef = useCallback((index: number) => {
    setRefs((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index]
    );
  }, []);

  const sendChat = useCallback(async () => {
    const message = chatInput.trim();
    if (!message || chatSending || words.length === 0) return;
    const sortedRefs = [...refs].sort((a, b) => a - b);
    const refNote =
      sortedRefs.length > 0
        ? ` [refs: ${sortedRefs.map((i) => words[i]?.text).join(", ")}]`
        : "";
    setChatMessages((m) => [...m, { role: "user", text: message + refNote }]);
    setChatInput("");
    setChatSending(true);
    try {
      const res = await api.chatEditWords(
        words.map((w) => ({ text: w.text, source: w.source })),
        message,
        sortedRefs
      );
      setWords(tokensToWordTokens(res.tokens));
      setRefs([]);
      setChatMessages((m) => [
        ...m,
        { role: "assistant", text: res.reply, ops: res.ops as PlannedOp[] },
      ]);
    } catch (err) {
      setChatMessages((m) => [
        ...m,
        { role: "assistant", text: `Edit failed: ${String(err)}` },
      ]);
    } finally {
      setChatSending(false);
    }
  }, [chatInput, chatSending, words, refs]);

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
          <label className="mt-3 block">
            <span className="text-xs text-black/50">
              Web search prompt (what are you applying for?)
            </span>
            <input
              value={searchPrompt}
              onChange={(e) => setSearchPrompt(e.target.value)}
              placeholder="e.g. Innovate UK Labs of the Future eligibility and criteria"
              className="mt-1 w-full border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
            <span className="mt-1 block text-[11px] text-black/40">
              Searched live via Tavily and folded into the grounding context.
            </span>
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
          {bundle &&
            (bundle.search_results.length > 0 || bundle.documents.length > 0) && (
              <div className="mt-3 space-y-2 border-t border-black/10 pt-3 text-xs text-black/60">
                {bundle.documents.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="bg-black px-1.5 py-0.5 text-[10px] uppercase text-white">
                      {d.category || "unclassified"}
                    </span>
                    <span className="truncate">{d.name}</span>
                  </div>
                ))}
                {bundle.search_results.map((s, i) => (
                  <div key={i} className="truncate">
                    <span className="text-black/40">search:</span> {s.query}
                  </div>
                ))}
              </div>
            )}
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
                  <span>hover = char count</span>
                  <span>click = add as chat reference</span>
                </div>
                <div className="mt-3 border border-black/15 p-4">
                  <p className="text-sm leading-relaxed">
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
                          onClick={() => toggleRef(i)}
                          className={
                            "relative cursor-pointer transition-opacity duration-300 " +
                            (kept ? "opacity-100 " : "opacity-25 ") +
                            (isEdit ? "text-blue-500 " : "text-black ") +
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

            {/* Chat: request edits directly, anchored on clicked words */}
            <section className="mt-6 border border-black/15 p-4">
              <h2 className="text-xs uppercase tracking-wide text-black/50">
                Chat - request edits (structured ops only)
              </h2>
              <p className="mt-1 text-[11px] text-black/40">
                Click words above to reference them, then ask for a change (e.g.
                &quot;make this punchier&quot; or &quot;remove this word&quot;).
                Gemma edits the wordspace via ops - it never free-text rewrites.
              </p>

              <div className="mt-3 max-h-60 space-y-3 overflow-auto">
                {chatMessages.length === 0 && (
                  <p className="text-sm text-black/40">
                    No messages yet. Selected references:{" "}
                    {refs.length === 0 ? "none" : refs.length}.
                  </p>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} className="text-sm">
                    <span className="text-black/50">
                      {m.role === "user" ? "you" : "gemma"}:
                    </span>{" "}
                    <span>{m.text}</span>
                    {m.ops && m.ops.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.ops.map((op, j) => (
                          <span
                            key={j}
                            className="bg-black/[0.06] px-1.5 py-0.5 text-xs text-black/70"
                          >
                            {opLabel(op)}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.ops && m.ops.length === 0 && m.role === "assistant" && (
                      <span className="ml-1 text-xs text-black/30">
                        (no ops ran)
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {refs.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-black/40">references:</span>
                  {[...refs]
                    .sort((a, b) => a - b)
                    .map((i) => (
                      <button
                        key={i}
                        onClick={() => toggleRef(i)}
                        className="rounded-sm bg-amber-200/70 px-1.5 py-0.5 text-xs ring-1 ring-amber-400"
                        title="click to remove reference"
                      >
                        {words[i]?.text} ×
                      </button>
                    ))}
                  <button
                    onClick={() => setRefs([])}
                    className="ml-1 text-[11px] text-black/40 underline"
                  >
                    clear
                  </button>
                </div>
              )}

              <div className="mt-3 flex gap-3 border-t border-black/10 pt-3">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChat();
                  }}
                  placeholder="tell Gemma how to edit the wordspace"
                  className="flex-1 border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
                />
                <button
                  onClick={sendChat}
                  disabled={chatSending || !chatInput.trim()}
                  className="bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                  {chatSending ? "..." : "Send"}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

"""LangGraph node functions for the grant-writing pipeline.

Each node is an async callable taking the PipelineState and returning a partial
state update. Every node fails soft: on any LLM/transport failure it falls back
to demo data (or static config) and records what happened in `stage_meta` so the
console can visualise provider/model/latency/fallback per stage.
"""

from __future__ import annotations

import asyncio

from .. import config, demo, llm, parsing, prompts, wordspace
from ..context.bundle import ContextBundle, IngestedDocument, SearchResult, merge_bundle
from ..context import ingest, search
from ..personas import BUILTIN_PERSONAS, PersonaConfig, persona_names
from .state import PipelineState

# Value weights tagging edit-derived words above base text (used for the UI
# highlight).
_BASE_WORD_VALUE = 0.3
_EDIT_WORD_VALUE = 0.85


# --- 1. Context gathering (gate) -------------------------------------------
async def gather_context(state: PipelineState) -> dict:
    """Assemble the ContextBundle: web search (stub) + optional PDF ingest.

    Fail-soft: any failure leaves the bundle with whatever the user provided.
    The pending document (if any) is passed in via context_bundle["_pending_doc"]
    as {"name", "data_b64"} and stripped out after ingestion.
    """
    raw_bundle = state.get("context_bundle") or {}
    bundle = ContextBundle.from_dict(raw_bundle)
    pending = raw_bundle.get("_pending_doc") or {}
    search_prompt = str(raw_bundle.get("_search_prompt") or "")

    # Web search via Tavily (fail-soft to no results when unconfigured).
    queries = search.derive_queries(
        bundle.topic, bundle.company_name, search_prompt
    )
    search_results: list[SearchResult] = []
    search_meta = {"provider": "tavily", "ok": True, "fallback": True,
                   "detail": f"{len(queries)} queries planned"}
    if queries:
        try:
            search_results = await search.web_search(queries)
            search_meta["fallback"] = len(search_results) == 0
            search_meta["queries"] = queries
        except Exception as exc:  # noqa: BLE001
            search_meta = {"provider": "tavily", "ok": False,
                           "fallback": True, "error": str(exc)}

    # Optional PDF ingest via SIE Extract, then LLM classification into
    # grant/competition vs company so downstream context is labelled.
    documents: list[IngestedDocument] = []
    ingest_meta: dict = {"provider": "sie-extract", "ok": True, "fallback": True,
                         "detail": "no document"}
    if pending.get("data_b64"):
        doc, ingest_meta = await ingest.pdf_to_text(
            str(pending.get("name", "document.pdf")), str(pending["data_b64"])
        )
        if doc is not None:
            doc.category, classify_meta = await _classify_document(doc)
            ingest_meta["classify"] = classify_meta
            documents.append(doc)

    merged = merge_bundle(
        bundle, search_results=search_results, documents=documents
    )
    return {
        "context_bundle": merged.to_dict(),
        "stage_meta": {"gather": {**search_meta, "documents": len(documents),
                                  "ingest": ingest_meta}},
    }


async def _classify_document(doc: IngestedDocument) -> tuple[str, dict]:
    """Ask Gemma whether a parsed document is about the grant or the company.

    Returns (category, meta) where category is "grant", "company", or "" when
    classification was unavailable. Fail-soft: any error yields "" so the
    document is still ingested, just unlabelled.
    """
    text, meta = await llm.gemma_generate(
        prompts.DOC_CLASSIFY_SYSTEM,
        prompts.doc_classify_user(doc.name, doc.text),
        max_tokens=8,
        thinking_budget=0,
    )
    category = ""
    if meta.get("ok") and text:
        lowered = text.strip().lower()
        if "grant" in lowered or "competition" in lowered:
            category = "grant"
        elif "company" in lowered:
            category = "company"
    return category, {
        "provider": meta.get("provider"),
        "ok": meta.get("ok"),
        "category": category or "unclassified",
    }


# --- 2a. Meta-harness (parallel) -------------------------------------------
async def build_personas(state: PipelineState) -> dict:
    """Configure critique personas from the ContextBundle (Gemma JSON).

    Fail-soft to the static BUILTIN_PERSONAS. In the MVP every persona receives
    the same consolidated context as its `knowledge` slice.
    """
    bundle = ContextBundle.from_dict(state.get("context_bundle"))
    context_text = bundle.as_context_text()

    text, meta = await llm.gemma_generate(
        prompts.META_PERSONA_SYSTEM,
        prompts.meta_persona_user(context_text, persona_names()),
        max_tokens=2048,
    )

    personas: list[PersonaConfig]
    if meta["ok"] and text:
        try:
            parsed = parsing.parse_json_array(text)
            by_name = {
                str(p.get("persona", "")).lower(): p
                for p in parsed
                if isinstance(p, dict)
            }
            personas = []
            for base in BUILTIN_PERSONAS:
                override = by_name.get(base.persona.lower())
                if override:
                    personas.append(
                        PersonaConfig(
                            persona=base.persona,
                            lens_prompt=str(
                                override.get("lens_prompt") or base.lens_prompt
                            ),
                            knowledge=context_text,
                            focus_areas=list(
                                override.get("focus_areas") or base.focus_areas
                            ),
                        )
                    )
                else:
                    personas.append(
                        PersonaConfig(
                            persona=base.persona,
                            lens_prompt=base.lens_prompt,
                            knowledge=context_text,
                            focus_areas=base.focus_areas,
                        )
                    )
            meta["fallback"] = False
        except Exception:  # noqa: BLE001
            personas = _static_personas(context_text)
            meta["fallback"] = True
    else:
        personas = _static_personas(context_text)
        meta["fallback"] = True

    return {
        "personas": [p.to_dict() for p in personas],
        "stage_meta": {"personas": meta},
    }


def _static_personas(context_text: str) -> list[PersonaConfig]:
    return [
        PersonaConfig(
            persona=p.persona,
            lens_prompt=p.lens_prompt,
            knowledge=context_text,
            focus_areas=p.focus_areas,
        )
        for p in BUILTIN_PERSONAS
    ]


# --- 2b. Drafter (parallel) ------------------------------------------------
async def draft_answer(state: PipelineState) -> dict:
    """Single powerful Gemma call to write the initial draft (held in state).

    This draft is the post-training input signal; it is not persisted until the
    user accepts a final answer. Fail-soft to demo.DEMO_DRAFT.
    """
    bundle = ContextBundle.from_dict(state.get("context_bundle"))
    question = state.get("question", demo.DEMO_QUESTION)
    context_text = bundle.as_context_text()

    text, meta = await llm.gemma_generate(
        prompts.DRAFTER_SYSTEM,
        prompts.drafter_user(question, context_text),
        max_tokens=2048,
        model=config.GEMMA_DRAFT_MODEL,
        thinking_budget=0,
    )

    if meta["ok"] and text:
        return {
            "draft": text.strip(),
            "draft_source": "gemma",
            "stage_meta": {"draft": meta},
        }

    meta["fallback"] = True
    return {
        "draft": demo.DEMO_DRAFT,
        "draft_source": "demo",
        "stage_meta": {"draft": meta},
    }


# --- 3. Critique swarm (join) ----------------------------------------------
async def critique_swarm(state: PipelineState) -> dict:
    """Run one Gemma call per persona in parallel; concat the span edits.

    Each persona sees its own `knowledge` slice. Fail-soft per persona: a failed
    or unparseable persona contributes nothing rather than breaking the swarm. If
    every persona fails, fall back to demo critics.
    """
    draft = state.get("draft", demo.DEMO_DRAFT)
    question = state.get("question", demo.DEMO_QUESTION)
    personas = [PersonaConfig.from_dict(p) for p in state.get("personas", [])]
    if not personas:
        personas = _static_personas("")

    async def _one(persona: PersonaConfig) -> tuple[list[dict], dict]:
        text, meta = await llm.gemma_generate(
            prompts.persona_critic_system(persona.persona, persona.lens_prompt),
            prompts.persona_critic_user(question, draft, persona.knowledge),
            max_tokens=2048,
        )
        if meta["ok"] and text:
            try:
                return parsing.normalize_critics(
                    parsing.parse_json_array(text), draft
                ), meta
            except Exception:  # noqa: BLE001
                meta["fallback"] = True
                return [], meta
        meta["fallback"] = True
        return [], meta

    results = await asyncio.gather(*[_one(p) for p in personas])

    critics: list[dict] = []
    per_persona_meta: dict = {}
    for persona, (items, meta) in zip(personas, results):
        critics.extend(items)
        per_persona_meta[persona.persona] = {
            "provider": meta.get("provider"),
            "model": meta.get("model"),
            "latency_ms": meta.get("latency_ms"),
            "ok": meta.get("ok"),
            "edits": len(items),
        }

    if not critics:
        critics = parsing.normalize_critics(
            [dict(c) for c in demo.DEMO_CRITICS], draft
        )
        summary = {"provider": "demo", "ok": False, "fallback": True,
                   "personas": per_persona_meta}
    else:
        summary = {"provider": "gemma", "ok": True, "fallback": False,
                   "edits": len(critics), "personas": per_persona_meta}

    return {"critics": critics, "stage_meta": {"critique": summary}}


# --- 4. Plan edits (distill critiques -> wordspace op plan) -----------------
def _draft_words(draft: str) -> list[str]:
    return [w for w in (draft or "").split() if w]


async def plan_edits(state: PipelineState) -> dict:
    """Distill all critic feedback into a single wordspace op plan (Gemma).

    The model never rewrites text; it returns {edit_list, ops} referencing word
    indices. Fail-soft to an empty plan (the draft is left untouched).
    """
    draft = state.get("draft", demo.DEMO_DRAFT)
    question = state.get("question", demo.DEMO_QUESTION)
    critics = state.get("critics", [])
    words = _draft_words(draft)

    char_limit = int(state.get("char_limit") or len(draft))
    text, meta = await llm.gemma_generate(
        prompts.PLAN_EDITS_SYSTEM,
        prompts.plan_edits_user(question, words, critics, char_limit),
        max_tokens=4096,
        thinking_budget=0,
    )

    ops: list[dict] = []
    edit_list: list[dict] = []
    if meta["ok"] and text:
        try:
            obj = parsing.parse_json_object(text)
            raw_ops = obj.get("ops", [])
            ops = [o for o in raw_ops if isinstance(o, dict)]
            raw_edits = obj.get("edit_list", [])
            edit_list = [e for e in raw_edits if isinstance(e, dict)]
        except Exception as exc:  # noqa: BLE001 - surface, do not mask
            # Visible failure: keep the raw model text + the parse error so the
            # console shows exactly why no ops were produced (no demo masking).
            meta["error"] = f"plan JSON parse failed: {exc}"
            meta["parse_failed"] = True

    return {
        "planned_ops": ops,
        "edit_list": edit_list,
        "stage_meta": {"plan": meta},
    }


# --- 4. Merge edits (deterministic span replacement, no index drift) -------
async def apply_review(state: PipelineState) -> dict:
    """Apply the critics' grammatical span rewrites to the draft, then tag words.

    We deliberately avoid merging many word-index ops (they drift and produce
    duplicated/leftover words). Instead we apply non-overlapping span
    replacements as plain string edits - each is a full phrase the critic wrote,
    so the result stays grammatical - then diff against the draft to tag which
    words are new (edit-derived) for the UI to highlight in blue.
    """
    draft = state.get("draft", demo.DEMO_DRAFT)
    critics = state.get("critics", [])

    improved, applied = wordspace.merge_span_edits(draft, critics)
    tokens = wordspace.tag_words_by_diff(draft, improved)

    word_tokens = [
        {
            "index": i,
            "text": str(t.get("text", "")),
            "source": str(t.get("source", "base")),
            "value": (
                _EDIT_WORD_VALUE if t.get("source") == "edit" else _BASE_WORD_VALUE
            ),
        }
        for i, t in enumerate(tokens)
    ]

    # Build a UI-friendly edit plan from the applied span replacements.
    planned_ops = [
        {
            "op": "replace",
            "span_original": a["span_original"],
            "word": a["span_replacement"],
            "source_critic": a["critic"],
        }
        for a in applied
    ]
    edit_list = [
        {
            "summary": f"{a['critic']}: '{a['span_original']}' -> '{a['span_replacement']}'",
            "source_critics": [a["critic"]],
            "importance": 0.8,
        }
        for a in applied
    ]

    return {
        "words": [w.to_dict() for w in word_tokens],
        "planned_ops": planned_ops,
        "dropped_ops": [],
        "edit_list": edit_list,
        "stage_meta": {
            "review": {
                "provider": "local",
                "ok": True,
                "fallback": False,
                "applied": len(applied),
                "candidates": len([c for c in critics if c.get("span_in_draft")]),
                "improved_chars": len(improved),
            }
        },
    }


# --- 6. Assemble (full improved answer; sizing happens interactively via /fit) --
async def fit_budget(state: PipelineState) -> dict:
    """Assemble the full improved answer.

    The draft is improved by the critic span-merge; this node just emits the
    full assembled text and word list. Fitting to a character budget is done
    interactively by the dynamic ops-based /fit endpoint.
    """
    draft = state.get("draft", demo.DEMO_DRAFT)
    words = state.get("words", [])

    if not words:
        words = [
            {
                "index": i,
                "text": w,
                "source": "base",
                "value": _BASE_WORD_VALUE,
            }
            for i, w in enumerate(_draft_words(draft))
        ]

    final = " ".join(w["text"] for w in words)
    return {
        "words": words,
        "result": {
            "keptIndices": list(range(len(words))),
            "totalChars": len(final),
            "totalValue": 0.0,
            "feasible": True,
        },
        "final": final,
        "stage_meta": {
            "assemble": {
                "provider": "local",
                "ok": True,
                "fallback": False,
                "chars": len(final),
            }
        },
    }

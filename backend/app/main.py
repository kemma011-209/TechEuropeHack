"""FastAPI backend for the grant application writing tool.

Three pipeline endpoints, each returning the result plus a `meta` block that
records exactly what the backend did (provider, model, latency, fallback) so the
testing console can visualize it. Every endpoint fails soft to demo data and
never returns a 5xx for an upstream LLM failure.
"""

import json
import math
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, demo, llm, parsing, personas, prompts, store, wordspace
from .context.bundle import ContextBundle
from .graph import run_pipeline


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Ensure the post-training SQLite table exists before any accept call.
    store.init_db()
    yield


app = FastAPI(title="TechEuropeHack API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request models --------------------------------------------------------
class DraftRequest(BaseModel):
    question: str = demo.DEMO_QUESTION
    context: str = ""


class CritiqueRequest(BaseModel):
    question: str = demo.DEMO_QUESTION
    draft: str = demo.DEMO_DRAFT


class ShortenRequest(BaseModel):
    text: str


class RankItem(BaseModel):
    id: str
    text: str


class RankRequest(BaseModel):
    question: str = demo.DEMO_QUESTION
    items: list[RankItem] = []


class SentenceRequest(BaseModel):
    prompt: str = ""


class WordspaceEditRequest(BaseModel):
    words: list[str] = []
    message: str = ""


class GatherRequest(BaseModel):
    topic: str = ""
    company_name: str = ""
    user_blurb: str = ""
    # Optional base64-encoded PDF to OCR via SIE Extract.
    document_name: str = ""
    document_b64: str = ""


class PipelineRunRequest(BaseModel):
    question: str = demo.DEMO_QUESTION
    context_bundle: dict | None = None
    char_limit: int | None = None


class AcceptRequest(BaseModel):
    question: str = demo.DEMO_QUESTION
    draft: str
    final: str
    char_limit: int | None = None
    topic: str = ""
    context: dict | None = None
    critiques: list[dict] = []
    planned_ops: list[dict] = []
    words: list[dict] = []
    selections: dict = {}
    personas: list[dict] = []
    providers: dict = {}
    session_id: str | None = None


# --- Health ----------------------------------------------------------------
@app.get("/")
async def root():
    return {"message": "Hello from FastAPI"}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "gemma_configured": config.gemma_configured(),
        "superlinked_configured": config.superlinked_configured(),
    }


# --- Helpers ---------------------------------------------------------------
# Parsing helpers live in app/parsing.py so the graph nodes and these handlers
# behave identically. Thin aliases kept for readability below.
_strip_fences = parsing.strip_fences
_parse_critics_text = parsing.parse_critics_text


def _demo_critics(draft: str) -> list[dict]:
    return parsing.normalize_critics([dict(c) for c in demo.DEMO_CRITICS], draft)


def _fallback_meta(error: str) -> dict:
    return {
        "provider": "none",
        "model": "demo",
        "latency_ms": 0,
        "ok": False,
        "fallback": True,
        "error": error,
        "raw_snippet": "",
    }


async def _generate_chain(
    system: str, user: str, max_tokens: int
) -> tuple[str | None, dict, str]:
    """Prefer SIE (if configured), then Gemma. Returns (text|None, meta, source).

    SIE text generation needs a self-hosted GPU instance, so when
    SUPERLINKED_BASE_URL is unset we transparently fall back to Gemma, which
    runs against the Google key. Demo data is the last resort.
    """
    meta = _fallback_meta("no generation provider configured")

    if config.superlinked_configured():
        text, meta = await llm.superlinked_generate(system, user, max_tokens)
        if meta["ok"] and text:
            return text, meta, "superlinked"

    if config.gemma_configured():
        text, gmeta = await llm.gemma_generate(system, user, max_tokens)
        if gmeta["ok"] and text:
            return text, gmeta, "gemma"
        meta = gmeta

    return None, meta, "demo"


# --- Endpoints -------------------------------------------------------------
@app.post("/api/draft")
async def draft(req: DraftRequest):
    text, meta, source = await _generate_chain(
        prompts.DRAFTER_SYSTEM,
        prompts.drafter_user(req.question, req.context),
        max_tokens=2048,
    )
    if text:
        return {"draft": text, "source": source, "meta": meta}

    meta["fallback"] = True
    return {"draft": demo.DEMO_DRAFT, "source": "demo", "meta": meta}


@app.post("/api/critique")
async def critique(req: CritiqueRequest):
    text, meta = await llm.gemma_generate(
        prompts.CRITIC_SYSTEM,
        prompts.critic_user(req.question, req.draft),
        max_tokens=8192,
    )

    if meta["ok"] and text:
        try:
            critics = _parse_critics_text(text, req.draft)
            return {
                "critics": critics,
                "parse_ok": True,
                "source": "gemma",
                "meta": meta,
            }
        except (ValueError, json.JSONDecodeError) as exc:
            meta["fallback"] = True
            return {
                "critics": _demo_critics(req.draft),
                "parse_ok": False,
                "warning": f"Critic JSON parse failed ({exc}); using demo data.",
                "source": "demo",
                "meta": meta,
            }

    meta["fallback"] = True
    return {
        "critics": _demo_critics(req.draft),
        "parse_ok": False,
        "warning": "Critic call unavailable; using demo data.",
        "source": "demo",
        "meta": meta,
    }


@app.post("/api/shorten")
async def shorten(req: ShortenRequest):
    text, meta, source = await _generate_chain(
        prompts.SHORTENER_SYSTEM,
        prompts.shortener_user(req.text),
        max_tokens=1024,
    )
    if text:
        return {"shortened": text, "source": source, "meta": meta}

    # Naive deterministic fallback: hard-truncate to <100 chars on a word
    # boundary. Never relies on an LLM to count characters.
    fallback = req.text.strip()
    if len(fallback) > 99:
        fallback = fallback[:96].rsplit(" ", 1)[0] + "..."
    meta["fallback"] = True
    return {"shortened": fallback, "source": "demo", "meta": meta}


@app.post("/api/rank")
async def rank(req: RankRequest):
    """Score each variant's relevance to the question via the SIE reranker.

    Returns rankings as {item_id: quality} in (0, 1) via a sigmoid of the raw
    cross-encoder score, ready to use as the solver's quality weight. Falls back
    to source="static" (empty rankings) when SIE isn't reachable, so the
    frontend keeps its built-in static weights.
    """
    items = [{"id": it.id, "text": it.text} for it in req.items]
    scores, meta = await llm.sie_score(req.question, items)

    if scores is not None:
        rankings = {k: 1.0 / (1.0 + math.exp(-v)) for k, v in scores.items()}
        return {"rankings": rankings, "source": "sie", "meta": meta}

    meta["fallback"] = True
    return {"rankings": {}, "source": "static", "meta": meta}


# --- Pipeline (LangGraph) --------------------------------------------------
@app.get("/api/personas")
async def list_personas():
    """Built-in persona roster (used by the frontend persona panel)."""
    return {"personas": personas.builtin_persona_dicts()}


@app.post("/api/context/gather")
async def context_gather(req: GatherRequest):
    """Context gathering gate: run the gather node and return a ContextBundle.

    Web search is a barebones stub today; PDF ingest runs via SIE Extract when a
    document is supplied and a gateway is configured. Always returns a ready
    bundle (fail-soft) so the UI can proceed.
    """
    bundle = ContextBundle(
        topic=req.topic,
        company_name=req.company_name,
        user_blurb=req.user_blurb,
    )
    initial = bundle.to_dict()
    if req.document_b64:
        initial["_pending_doc"] = {
            "name": req.document_name or "document.pdf",
            "data_b64": req.document_b64,
        }

    from .graph import nodes as graph_nodes

    update = await graph_nodes.gather_context({"context_bundle": initial})
    return {
        "bundle": update["context_bundle"],
        "meta": update.get("stage_meta", {}).get("gather", {}),
    }


@app.post("/api/pipeline/run")
async def pipeline_run(req: PipelineRunRequest):
    """Run the full graph: parallel meta-harness + draft -> critique -> knapsack."""
    state = await run_pipeline(
        question=req.question,
        context_bundle=req.context_bundle or {},
        char_limit=req.char_limit,
    )
    return {
        "question": state.get("question"),
        "context_bundle": state.get("context_bundle"),
        "personas": state.get("personas", []),
        "draft": state.get("draft", ""),
        "draft_source": state.get("draft_source", ""),
        "critics": state.get("critics", []),
        "edit_list": state.get("edit_list", []),
        "planned_ops": state.get("planned_ops", []),
        "dropped_ops": state.get("dropped_ops", []),
        "words": state.get("words", []),
        "result": state.get("result", {}),
        "final": state.get("final", ""),
        "stage_meta": state.get("stage_meta", {}),
    }


@app.post("/api/accept")
async def accept(req: AcceptRequest):
    """Log an accepted answer as post-training data (single write, on accept)."""
    # Fold the wordspace plan into the selections blob so the post-training
    # record captures exactly how the final was assembled (no schema migration).
    selections = {
        "selections": req.selections,
        "planned_ops": req.planned_ops,
        "words": req.words,
    }
    summary = store.record_acceptance(
        question=req.question,
        draft=req.draft,
        final=req.final,
        char_limit=req.char_limit,
        topic=req.topic,
        context=req.context,
        critiques=req.critiques,
        selections=selections,
        personas=req.personas,
        providers=req.providers,
        session_id=req.session_id,
    )
    return {"ok": True, "stored": summary, "total_records": store.count_records()}


# --- Wordspace page --------------------------------------------------------
_DEMO_SENTENCE = (
    "Armature Labs connects siloed lab systems into one auditable data layer."
)


@app.post("/api/sentence")
async def sentence(req: SentenceRequest):
    text, meta = await llm.gemma_generate(
        prompts.SENTENCE_SYSTEM,
        prompts.sentence_user(req.prompt),
        max_tokens=2048,
    )
    if meta["ok"] and text:
        sentence_text = text.strip().splitlines()[0].strip()
        return {"sentence": sentence_text, "words": sentence_text.split(), "source": "gemma", "meta": meta}

    meta["fallback"] = True
    return {"sentence": _DEMO_SENTENCE, "words": _DEMO_SENTENCE.split(), "source": "demo", "meta": meta}


@app.post("/api/wordspace/edit")
async def wordspace_edit(req: WordspaceEditRequest):
    """Edit the wordspace via structured ops only (never a free-text rewrite)."""
    text, meta = await llm.gemma_generate(
        prompts.WORDSPACE_EDIT_SYSTEM,
        prompts.wordspace_edit_user(req.words, req.message),
        max_tokens=8192,
    )

    if meta["ok"] and text:
        try:
            parsed = json.loads(_strip_fences(text))
            reply = str(parsed.get("reply", "")) if isinstance(parsed, dict) else ""
            ops = parsed.get("ops", []) if isinstance(parsed, dict) else []
            new_words, applied = wordspace.apply_ops(req.words, ops)
            return {
                "words": new_words,
                "ops": applied,
                "reply": reply or "Done.",
                "source": "gemma",
                "meta": meta,
            }
        except (ValueError, json.JSONDecodeError) as exc:
            meta["fallback"] = True
            return {
                "words": req.words,
                "ops": [],
                "reply": f"Could not parse edit ({exc}).",
                "source": "demo",
                "meta": meta,
            }

    meta["fallback"] = True
    return {
        "words": req.words,
        "ops": [],
        "reply": "Edit service unavailable.",
        "source": "demo",
        "meta": meta,
    }

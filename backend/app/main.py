"""FastAPI backend for the grant application writing tool.

Three pipeline endpoints, each returning the result plus a `meta` block that
records exactly what the backend did (provider, model, latency, fallback) so the
testing console can visualize it. Every endpoint fails soft to demo data and
never returns a 5xx for an upstream LLM failure.
"""

import json
import math
import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, demo, llm, prompts, wordspace

app = FastAPI(title="TechEuropeHack API")

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
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def _strip_fences(text: str) -> str:
    cleaned = text.strip()
    cleaned = _FENCE_RE.sub("", cleaned)
    # Also handle a leading ```json on its own line plus trailing ```.
    cleaned = re.sub(r"^```(?:json)?", "", cleaned.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"```$", "", cleaned.strip())
    return cleaned.strip()


def _parse_critics_text(text: str, draft: str) -> list[dict]:
    """Parse the critic JSON, tolerating fences and surrounding prose."""
    cleaned = _strip_fences(text)
    try:
        return _normalize_critics(json.loads(cleaned), draft)
    except (ValueError, json.JSONDecodeError):
        pass
    # Last resort: extract the first [...] array from the text.
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end > start:
        return _normalize_critics(json.loads(cleaned[start : end + 1]), draft)
    raise ValueError("no JSON array found in critic response")


def _normalize_critics(parsed: object, draft: str) -> list[dict]:
    """Validate the critic array and annotate each item.

    Adds `span_in_draft` (whether span_original is an exact substring of the
    draft) and `full_rewrite` (whether the span is the entire draft).
    """
    if not isinstance(parsed, list):
        raise ValueError("critic response is not a JSON array")

    critics: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        span_original = str(item.get("span_original", ""))
        critics.append(
            {
                "critic": str(item.get("critic", "")),
                "persona_note": str(item.get("persona_note", "")),
                "span_original": span_original,
                "span_replacement": str(item.get("span_replacement", "")),
                "span_in_draft": span_original in draft,
                "full_rewrite": span_original.strip() == draft.strip()
                and bool(span_original.strip()),
            }
        )
    if not critics:
        raise ValueError("critic response contained no usable items")
    return critics


def _demo_critics(draft: str) -> list[dict]:
    return _normalize_critics([dict(c) for c in demo.DEMO_CRITICS], draft)


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

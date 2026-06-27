"""Thin async LLM clients.

Two providers:
- gemma_generate: Google Generative Language API (:generateContent). Used by the
  critic swarm. Auth via the x-goog-api-key header (proven by quicktest.py).
- superlinked_chat: OpenAI-compatible /v1/chat/completions. Used by the drafter
  and shortener.

Both fail soft: on any error they return ok=False so the caller can fall back to
demo data instead of raising. Every call returns (text, meta) where meta records
exactly what happened for the testing console to display.
"""

import time
from typing import Any

import httpx

from . import config

_TIMEOUT = httpx.Timeout(30.0, connect=8.0)
_SNIPPET_LEN = 600


def _snippet(value: Any) -> str:
    text = value if isinstance(value, str) else str(value)
    return text[:_SNIPPET_LEN]


def _meta(
    *,
    provider: str,
    model: str,
    started: float,
    ok: bool,
    fallback: bool = False,
    error: str | None = None,
    raw_snippet: str = "",
) -> dict[str, Any]:
    return {
        "provider": provider,
        "model": model,
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "ok": ok,
        "fallback": fallback,
        "error": error,
        "raw_snippet": raw_snippet,
    }


async def gemma_generate(
    system: str,
    user: str,
    max_tokens: int = 512,
    model: str | None = None,
    thinking_budget: int | None = None,
) -> tuple[str, dict[str, Any]]:
    """Call Google's generateContent endpoint. Returns (text, meta).

    `model` overrides the default GEMMA_MODEL (used by the drafter, which may run
    a more powerful model than the critic swarm).

    `thinking_budget` controls the Gemini "thinking" token budget. Pass 0 to
    DISABLE thinking entirely: thinking tokens count against maxOutputTokens, so
    a reasoning model can burn the whole budget thinking and return empty visible
    text. For short, format-constrained outputs (draft text, JSON op plans) we
    disable thinking so the model spends its tokens on the actual answer.
    """
    started = time.perf_counter()
    model = model or config.GEMMA_MODEL

    if not config.gemma_configured():
        return "", _meta(
            provider="gemma",
            model=model,
            started=started,
            ok=False,
            error="GEMMA_API_KEY not set",
        )

    url = f"{config.GEMMA_BASE_URL}/models/{model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": config.GEMMA_API_KEY,
    }
    generation_config: dict[str, Any] = {"maxOutputTokens": max_tokens}
    if thinking_budget is not None:
        generation_config["thinkingConfig"] = {"thinkingBudget": thinking_budget}
    body = {
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "systemInstruction": {"parts": [{"text": system}]},
        "generationConfig": generation_config,
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            return "", _meta(
                provider="gemma",
                model=model,
                started=started,
                ok=False,
                error=f"HTTP {resp.status_code}",
                raw_snippet=_snippet(resp.text),
            )
        data = resp.json()
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )
        if not text:
            return "", _meta(
                provider="gemma",
                model=model,
                started=started,
                ok=False,
                error="empty response",
                raw_snippet=_snippet(resp.text),
            )
        return text, _meta(
            provider="gemma",
            model=model,
            started=started,
            ok=True,
            raw_snippet=_snippet(text),
        )
    except Exception as exc:  # noqa: BLE001
        return "", _meta(
            provider="gemma",
            model=model,
            started=started,
            ok=False,
            error=f"{type(exc).__name__}: {exc}",
        )


def _sie_model_id(model: str) -> str:
    """SIE's /v1/generate requires slashes replaced by double underscores."""
    return model.replace("/", "__")


async def sie_score(
    query: str, items: list[dict[str, str]]
) -> tuple[dict[str, float] | None, dict[str, Any]]:
    """Rerank items against a query via SIE's POST /v1/score/:model.

    items: [{"id": str, "text": str}]. Returns ({item_id: score}, meta) or
    (None, meta) on failure. Unlike /v1/generate, /v1/score takes HF-style
    slashes in the model id. CPU-friendly (default bundle).
    """
    started = time.perf_counter()
    model = config.SUPERLINKED_RERANK_MODEL

    if not config.sie_base_set():
        return None, _meta(
            provider="sie", model=model, started=started, ok=False,
            error="SUPERLINKED_BASE_URL not set",
        )
    if not items:
        return {}, _meta(provider="sie", model=model, started=started, ok=True)

    base = config.SUPERLINKED_BASE_URL.rstrip("/")
    url = f"{base}/v1/score/{model}"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if config.SUPERLINKED_API_KEY:
        headers["Authorization"] = f"Bearer {config.SUPERLINKED_API_KEY}"
    body = {
        "query": {"text": query},
        "items": [{"id": it["id"], "text": it["text"]} for it in items],
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            return None, _meta(
                provider="sie", model=model, started=started, ok=False,
                error=f"HTTP {resp.status_code}", raw_snippet=_snippet(resp.text),
            )
        data = resp.json()
        scores = {
            str(s.get("item_id")): float(s.get("score", 0.0))
            for s in data.get("scores", [])
            if s.get("item_id") is not None
        }
        return scores, _meta(
            provider="sie", model=model, started=started, ok=True,
            raw_snippet=_snippet(data.get("scores", [])),
        )
    except Exception as exc:  # noqa: BLE001
        return None, _meta(
            provider="sie", model=model, started=started, ok=False,
            error=f"{type(exc).__name__}: {exc}",
        )


async def superlinked_generate(system: str, user: str, max_tokens: int = 256) -> tuple[str, dict[str, Any]]:
    """Call SIE's POST /v1/generate/:model endpoint. Returns (text, meta).

    SIE has no OpenAI chat body; it takes a single prompt. We fold the system
    instruction into the prompt. SIE defaults to msgpack, so we must request
    JSON explicitly via the Accept header.
    """
    started = time.perf_counter()
    model = config.SUPERLINKED_MODEL

    if not config.superlinked_configured():
        return "", _meta(
            provider="superlinked",
            model=model,
            started=started,
            ok=False,
            error="SUPERLINKED_BASE_URL / SUPERLINKED_API_KEY not set",
        )

    base = config.SUPERLINKED_BASE_URL.rstrip("/")
    url = f"{base}/v1/generate/{_sie_model_id(model)}"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {config.SUPERLINKED_API_KEY}",
    }
    prompt = f"{system}\n\n{user}" if system else user
    body = {"prompt": prompt, "max_new_tokens": max_tokens}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            return "", _meta(
                provider="superlinked",
                model=model,
                started=started,
                ok=False,
                error=f"HTTP {resp.status_code}",
                raw_snippet=_snippet(resp.text),
            )
        data = resp.json()
        text = str(data.get("text", "")).strip()
        if not text:
            return "", _meta(
                provider="superlinked",
                model=model,
                started=started,
                ok=False,
                error="empty response",
                raw_snippet=_snippet(resp.text),
            )
        return text, _meta(
            provider="superlinked",
            model=model,
            started=started,
            ok=True,
            raw_snippet=_snippet(text),
        )
    except Exception as exc:  # noqa: BLE001
        return "", _meta(
            provider="superlinked",
            model=model,
            started=started,
            ok=False,
            error=f"{type(exc).__name__}: {exc}",
        )

"""Web-search interface for context gathering, backed by the Tavily Search API.

The contract is intentionally stable so callers (the gather node) never change:

    async def web_search(queries: list[str], *, max_results: int = 5)
        -> list[SearchResult]

Fail-soft: when TAVILY_API_KEY is unset or a request errors, this returns []
(or skips the offending query) so the ContextBundle simply contains whatever the
user provided (blurb / documents). It never raises.

See backend/scripts/tavily_test.py for the original reference call.
"""

from __future__ import annotations

import asyncio

import httpx

from .. import config
from .bundle import SearchResult

_SEARCH_URL = "https://api.tavily.com/search"
_TIMEOUT = httpx.Timeout(60.0, connect=8.0)


def derive_queries(
    topic: str, company_name: str, search_prompt: str = ""
) -> list[str]:
    """Deterministic query templates from the user prompt + topic + company.

    Exposed so the real search implementation can reuse the same query plan, and
    so tests can assert the plan without hitting the network. A user-supplied
    search prompt (e.g. "what are you applying for") is used verbatim as the
    highest-priority query.
    """
    topic = (topic or "").strip()
    company = (company_name or "").strip()
    prompt = (search_prompt or "").strip()
    queries: list[str] = []
    if prompt:
        queries.append(prompt)
    if topic:
        queries.append(f"{topic} application requirements and evaluation criteria")
        queries.append(f"{topic} what reviewers look for tips")
    if company:
        queries.append(f"{company} competitors and market")
    # De-duplicate while preserving order (a prompt may echo the topic).
    seen: set[str] = set()
    deduped: list[str] = []
    for q in queries:
        key = q.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(q)
    return deduped


async def _search_one(
    client: httpx.AsyncClient, query: str, max_results: int
) -> SearchResult | None:
    """Run a single Tavily search. Returns None on any failure (fail-soft)."""
    body = {
        "query": query,
        "search_depth": "advanced",
        "include_answer": "advanced",
        "max_results": max_results,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.TAVILY_API_KEY}",
    }
    try:
        resp = await client.post(_SEARCH_URL, headers=headers, json=body)
        if resp.status_code != 200:
            return None
        data = resp.json()
    except Exception:  # noqa: BLE001 - fail soft, never break gathering
        return None

    answer = str(data.get("answer") or "").strip()
    sources = [
        {
            "title": str(r.get("title") or ""),
            "url": str(r.get("url") or ""),
            "content": str(r.get("content") or "").strip()[:500],
            "score": r.get("score"),
        }
        for r in (data.get("results") or [])
        if isinstance(r, dict)
    ]
    if not answer and not sources:
        return None
    return SearchResult(query=query, answer=answer, sources=sources)


async def web_search(
    queries: list[str], *, max_results: int = 5
) -> list[SearchResult]:
    """Run a Tavily search for each query, concurrently. Returns one
    SearchResult per query that yielded an answer or sources.

    Fail-soft: returns [] when no provider is configured or every query fails,
    so the gather node stays resilient.
    """
    if not config.tavily_configured() or not queries:
        return []

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        results = await asyncio.gather(
            *[_search_one(client, q, max_results) for q in queries]
        )
    return [r for r in results if r is not None]

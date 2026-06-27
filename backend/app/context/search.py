"""Barebones web-search interface for context gathering.

INTENTIONALLY A STUB. A colleague is wiring a real provider (e.g. Tavily, see
backend/scripts/tavily_test.py for a working call) behind this exact signature.
Keep the contract stable:

    async def web_search(queries: list[str], *, max_results: int = 5)
        -> list[SearchResult]

Until that lands, this returns an empty list so the pipeline fails soft: the
ContextBundle simply contains whatever the user provided (blurb / documents).
"""

from __future__ import annotations

from .bundle import SearchResult


def derive_queries(topic: str, company_name: str) -> list[str]:
    """Deterministic query templates from the topic + company.

    Exposed so the real search implementation can reuse the same query plan, and
    so tests can assert the plan without hitting the network.
    """
    topic = (topic or "").strip()
    company = (company_name or "").strip()
    queries: list[str] = []
    if topic:
        queries.append(f"{topic} application requirements and evaluation criteria")
        queries.append(f"{topic} what reviewers look for tips")
    if company:
        queries.append(f"{company} competitors and market")
    return queries


async def web_search(
    queries: list[str], *, max_results: int = 5
) -> list[SearchResult]:
    """Run web searches for each query. STUB: returns no results for now.

    Replace the body with a real provider call. Must return one SearchResult per
    query (answer + sources) and must never raise — return [] on failure so the
    gather node stays fail-soft.
    """
    _ = (queries, max_results)  # referenced so linters don't flag the stub
    return []

"""ContextBundle: the single normalized knowledge object produced by the context
gathering gate.

Everything downstream (meta-harness, drafter, critique swarm) reads from this
bundle, never from raw user input. Web search results and extracted documents
are merged here. The bundle is JSON-serialisable so it can round-trip through the
API and be logged verbatim on accept.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field


@dataclass
class SearchResult:
    query: str
    answer: str = ""
    sources: list[dict] = field(default_factory=list)


@dataclass
class IngestedDocument:
    name: str
    text: str
    page_count: int | None = None


@dataclass
class ContextBundle:
    """Unified context for one application session."""

    topic: str = ""
    company_name: str = ""
    user_blurb: str = ""
    documents: list[IngestedDocument] = field(default_factory=list)
    search_results: list[SearchResult] = field(default_factory=list)
    consolidated_summary: str = ""
    status: str = "ready"  # "ready" once gathering has resolved
    gathered_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "ContextBundle":
        data = data or {}
        documents = [
            IngestedDocument(
                name=str(d.get("name", "")),
                text=str(d.get("text", "")),
                page_count=d.get("page_count"),
            )
            for d in data.get("documents", [])
            if isinstance(d, dict)
        ]
        search_results = [
            SearchResult(
                query=str(s.get("query", "")),
                answer=str(s.get("answer", "")),
                sources=list(s.get("sources", []) or []),
            )
            for s in data.get("search_results", [])
            if isinstance(s, dict)
        ]
        return cls(
            topic=str(data.get("topic", "")),
            company_name=str(data.get("company_name", "")),
            user_blurb=str(data.get("user_blurb", "")),
            documents=documents,
            search_results=search_results,
            consolidated_summary=str(data.get("consolidated_summary", "")),
            status=str(data.get("status", "ready")),
            gathered_at=float(data.get("gathered_at", time.time())),
        )

    def as_context_text(self) -> str:
        """Flatten the bundle into a single grounding string for prompts.

        Prefers a consolidated summary when present; otherwise concatenates the
        blurb, document text, and search answers. This is the `knowledge` slice
        handed to personas/drafter in the MVP (uniform context for all).
        """
        if self.consolidated_summary.strip():
            return self.consolidated_summary.strip()

        chunks: list[str] = []
        if self.topic:
            chunks.append(f"Application / topic: {self.topic}")
        if self.company_name:
            chunks.append(f"Company: {self.company_name}")
        if self.user_blurb.strip():
            chunks.append(self.user_blurb.strip())
        for doc in self.documents:
            if doc.text.strip():
                chunks.append(f"[Document: {doc.name}]\n{doc.text.strip()}")
        for sr in self.search_results:
            if sr.answer.strip():
                chunks.append(f"[Web: {sr.query}]\n{sr.answer.strip()}")
        return "\n\n".join(chunks).strip()


def empty_bundle() -> ContextBundle:
    return ContextBundle(status="ready")


def merge_bundle(
    base: ContextBundle,
    *,
    search_results: list[SearchResult] | None = None,
    documents: list[IngestedDocument] | None = None,
    consolidated_summary: str | None = None,
) -> ContextBundle:
    """Return a new bundle with gathered material merged in."""
    return ContextBundle(
        topic=base.topic,
        company_name=base.company_name,
        user_blurb=base.user_blurb,
        documents=[*base.documents, *(documents or [])],
        search_results=[*base.search_results, *(search_results or [])],
        consolidated_summary=(
            consolidated_summary
            if consolidated_summary is not None
            else base.consolidated_summary
        ),
        status="ready",
        gathered_at=base.gathered_at,
    )

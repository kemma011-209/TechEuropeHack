"""StateGraph wiring for the grant-writing pipeline.

Topology (see app/graph/__init__.py):

    gather_context -> build_personas -\
    gather_context -> draft_answer    -> critique_swarm -> apply_review
        -> fit_budget -> END

build_personas and draft_answer run in the same superstep (both fan out from
gather_context). critique_swarm has two inbound edges, so LangGraph waits for
both branches before running it. apply_review merges the critics' grammatical
span rewrites into the draft (deterministic, no word-index drift) and tags the
new words; fit_budget trims to the char limit.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .. import demo
from . import nodes
from .state import PipelineState

_compiled = None


def build_pipeline():
    """Compile (and cache) the pipeline graph."""
    global _compiled
    if _compiled is not None:
        return _compiled

    graph = StateGraph(PipelineState)
    graph.add_node("gather_context", nodes.gather_context)
    graph.add_node("build_personas", nodes.build_personas)
    graph.add_node("draft_answer", nodes.draft_answer)
    graph.add_node("critique_swarm", nodes.critique_swarm)
    graph.add_node("apply_review", nodes.apply_review)
    graph.add_node("fit_budget", nodes.fit_budget)

    graph.add_edge(START, "gather_context")
    # Fan out: meta-harness and drafter run in parallel after the gate.
    graph.add_edge("gather_context", "build_personas")
    graph.add_edge("gather_context", "draft_answer")
    # Join: critique waits for both persona configs and the draft.
    graph.add_edge("build_personas", "critique_swarm")
    graph.add_edge("draft_answer", "critique_swarm")
    # Merge span rewrites (deterministic, no index drift) -> budget fit.
    graph.add_edge("critique_swarm", "apply_review")
    graph.add_edge("apply_review", "fit_budget")
    graph.add_edge("fit_budget", END)

    _compiled = graph.compile()
    return _compiled


async def run_pipeline(
    question: str | None = None,
    context_bundle: dict | None = None,
    char_limit: int | None = None,
) -> dict:
    """Run the full pipeline once and return the final state dict."""
    app = build_pipeline()
    initial: PipelineState = {
        "question": question or demo.DEMO_QUESTION,
        "context_bundle": context_bundle or {},
        "stage_meta": {},
    }
    if char_limit is not None:
        initial["char_limit"] = char_limit
    result = await app.ainvoke(initial)
    return dict(result)

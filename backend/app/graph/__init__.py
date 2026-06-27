"""LangGraph orchestration for the grant-writing pipeline.

The graph encodes the agreed flow:

    gather_context (gate)
        -> build_personas  (meta-harness)  \
        -> draft_answer    (drafter)        > parallel
                                            /
        -> critique_swarm  (join)
        -> solve_knapsack  (deterministic char fitter)

Storage is intentionally NOT a graph node: accepted answers are logged by the
`/api/accept` handler after the user confirms the final text.
"""

from .build import build_pipeline, run_pipeline

__all__ = ["build_pipeline", "run_pipeline"]

"""Shared state for the LangGraph pipeline.

Each node writes a distinct set of keys, so the parallel meta-harness and drafter
branches never write the same key in one superstep (LangGraph would otherwise
require a reducer for concurrent updates). `stage_meta` is the one shared dict and
uses an explicit merge reducer.
"""

from __future__ import annotations

from typing import Annotated, Any, TypedDict


def _merge_meta(left: dict | None, right: dict | None) -> dict:
    """Reducer: shallow-merge per-stage meta so parallel nodes can both append."""
    merged = dict(left or {})
    merged.update(right or {})
    return merged


class PipelineState(TypedDict, total=False):
    # Inputs
    question: str
    char_limit: int
    context_bundle: dict  # ContextBundle.to_dict()

    # Parallel branch outputs
    personas: list[dict]  # PersonaConfig dicts from the meta-harness
    draft: str  # held in state, not persisted until accept
    draft_source: str

    # Join + deterministic outputs
    critics: list[dict]  # raw per-persona feedback, fed into the distiller
    planned_ops: list[dict]  # the reviewed wordspace ops that were applied
    dropped_ops: list[dict]  # ops review rejected (invalid/out-of-range/no-op)
    edit_list: list[dict]  # distilled human-readable edit summaries
    words: list[dict]  # WordToken.to_dict(): the improved, tagged word list
    result: dict  # WordResult.to_dict() at the default char limit
    final: str  # assembled answer under the char limit

    # Per-stage provenance for the console visualizer (merged across branches)
    stage_meta: Annotated[dict[str, Any], _merge_meta]

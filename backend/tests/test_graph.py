"""End-to-end graph wiring test with the LLM layer mocked.

Verifies the topology runs: gather -> (personas || draft) -> critique ->
plan_edits -> apply_review -> fit_budget, and that the final state carries every
key the API surfaces.
"""

import json

import pytest

from app import llm, personas as personas_mod
from app.graph import build


def _meta(ok: bool = True) -> dict:
    return {
        "provider": "gemma",
        "model": "test",
        "latency_ms": 1,
        "ok": ok,
        "fallback": not ok,
        "error": None,
        "raw_snippet": "",
    }


DRAFT_TEXT = "Acme builds data tools. It helps teams move faster."


async def _fake_gemma(
    system: str, user: str, max_tokens: int = 512, model=None, thinking_budget=None
):
    if "configure a swarm" in system:
        payload = [
            {"persona": p.persona, "lens_prompt": f"lens for {p.persona}",
             "focus_areas": p.focus_areas}
            for p in personas_mod.BUILTIN_PERSONAS
        ]
        return json.dumps(payload), _meta()
    if "grant application writer" in system:
        return DRAFT_TEXT, _meta()
    if "DISTILL" in system or "editor improving" in system:
        # plan_edits: distil critiques into a wordspace op plan.
        plan = {
            "edit_list": [
                {"summary": "Sharpen the company name", "source_critics": ["VC"],
                 "importance": 0.9}
            ],
            "ops": [
                {"op": "replace", "index": 0, "word": "AcmeCorp",
                 "source_critic": "VC", "importance": 0.9}
            ],
        }
        return json.dumps(plan), _meta()
    if "reviewer of a grant application answer" in system:
        return (
            json.dumps(
                [
                    {
                        "critic": "VC",
                        "persona_note": "punchier",
                        "span_original": "data tools",
                        "span_replacement": "products",
                    }
                ]
            ),
            _meta(),
        )
    return "", _meta(ok=False)


async def _fake_sie_score(query, items):
    return None, {"provider": "sie", "ok": False, "fallback": True}


@pytest.fixture(autouse=True)
def _patch_llm(monkeypatch):
    monkeypatch.setattr(llm, "gemma_generate", _fake_gemma)
    monkeypatch.setattr(llm, "sie_score", _fake_sie_score)
    # Reset the cached compiled graph so nodes pick up patched llm at call time.
    build._compiled = None
    yield
    build._compiled = None


async def test_pipeline_runs_end_to_end():
    state = await build.run_pipeline(
        question="What does your company do? (Answer in 80 characters or fewer.)",
        context_bundle={"topic": "Test Grant", "company_name": "Acme",
                        "user_blurb": "Acme does data."},
        char_limit=80,
    )

    # All five personas configured.
    assert len(state["personas"]) == 5
    # Drafter output captured (not the demo fallback).
    assert state["draft"] == DRAFT_TEXT
    assert state["draft_source"] == "gemma"
    # Critique swarm produced at least one span edit.
    assert len(state["critics"]) >= 1
    assert any(c["span_replacement"] == "products" for c in state["critics"])
    # Span rewrite applied: the critic's replacement words are tagged + present.
    assert len(state["planned_ops"]) >= 1
    assert any(
        w["text"].startswith("products") and w["source"] == "edit"
        for w in state["words"]
    )
    # Deterministic budget result + assembled final present.
    assert "keptIndices" in state["result"]
    assert isinstance(state["final"], str) and state["final"]
    # Stage meta recorded for the console.
    for stage in ("gather", "personas", "draft", "critique", "review", "solver"):
        assert stage in state["stage_meta"]


async def test_pipeline_fails_soft_without_llm(monkeypatch):
    async def _down(*a, **k):
        return "", _meta(ok=False)

    monkeypatch.setattr(llm, "gemma_generate", _down)
    build._compiled = None

    state = await build.run_pipeline(
        question="What does your company do? (Answer in 150 characters or fewer.)",
        context_bundle={"topic": "X", "company_name": "Y"},
        char_limit=150,
    )
    # Fail-soft: demo draft + demo critics keep the pipeline whole; empty plan
    # leaves the draft untouched, then budget-fit still produces a final.
    assert state["draft"]
    assert len(state["critics"]) >= 1
    assert len(state["words"]) >= 1
    assert state["final"]

"""Run the pipeline once and dump exactly what each stage produced.

No masking: prints raw model snippets, parse outcomes, op counts, and the final
so we can see precisely where the edit plan is failing. Run from backend/:

    python -m scripts.debug_pipeline
"""

import asyncio
import json

from app import demo
from app.context.bundle import ContextBundle
from app.graph import run_pipeline


async def main() -> None:
    bundle = ContextBundle(
        topic="Innovate UK Labs of the Future funding",
        company_name="Armature Labs",
        user_blurb=demo.DEMO_CONTEXT,
    )
    state = await run_pipeline(
        question=demo.DEMO_QUESTION,
        context_bundle=bundle.to_dict(),
        char_limit=150,
    )

    sm = state.get("stage_meta", {})

    def show(stage: str) -> None:
        m = sm.get(stage, {})
        print(f"\n===== {stage.upper()} =====")
        print(f"  provider : {m.get('provider')}")
        print(f"  ok       : {m.get('ok')}")
        print(f"  fallback : {m.get('fallback')}")
        print(f"  error    : {m.get('error')}")
        snippet = m.get("raw_snippet")
        if snippet:
            print(f"  raw_snippet:\n{snippet}")

    for stage in ("gather", "personas", "draft", "critique", "plan", "review", "solver"):
        show(stage)

    print("\n===== CRITIQUE PERSONAS =====")
    print(json.dumps(sm.get("critique", {}).get("personas", {}), indent=2))

    print(f"\n#critics      : {len(state.get('critics', []))}")
    print(f"#planned_ops  : {len(state.get('planned_ops', []))}")
    print(f"#dropped_ops  : {len(state.get('dropped_ops', []))}")
    print(f"draft         : {state.get('draft')}")
    print(f"final         : {state.get('final')}")

    print("\n===== FIRST 3 CRITICS =====")
    for c in state.get("critics", [])[:3]:
        print(json.dumps(c, indent=2))

    print("\n===== PLANNED OPS =====")
    print(json.dumps(state.get("planned_ops", []), indent=2))


if __name__ == "__main__":
    asyncio.run(main())

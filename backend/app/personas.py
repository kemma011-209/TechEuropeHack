"""Built-in critique personas and the PersonaConfig contract.

A PersonaConfig is what the meta-harness produces (and the user may edit) before
the critique swarm runs. The `knowledge` field is a first-class string so context
can later be sliced per-persona; in the MVP every persona receives the same
consolidated context (see graph.nodes.build_personas).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PersonaConfig:
    persona: str
    lens_prompt: str
    knowledge: str = ""
    focus_areas: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "persona": self.persona,
            "lens_prompt": self.lens_prompt,
            "knowledge": self.knowledge,
            "focus_areas": self.focus_areas,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PersonaConfig":
        return cls(
            persona=str(data.get("persona", "Critic")),
            lens_prompt=str(data.get("lens_prompt", "")),
            knowledge=str(data.get("knowledge", "")),
            focus_areas=list(data.get("focus_areas", []) or []),
        )


# Built-in personas: the static fallback used when the meta-harness LLM call is
# unavailable, and the default roster the meta-harness is asked to configure.
BUILTIN_PERSONAS: list[PersonaConfig] = [
    PersonaConfig(
        persona="VC",
        lens_prompt=(
            "You are a venture investor. Push for market signal, scale, traction, "
            "and defensibility. Flag vague claims; prefer concrete, ambitious language."
        ),
        focus_areas=["market size", "scalability", "defensibility"],
    ),
    PersonaConfig(
        persona="Scientist",
        lens_prompt=(
            "You are a domain scientist. Demand technical specificity and accuracy. "
            "Name the actual systems/methods; reject hand-wavy generalities."
        ),
        focus_areas=["technical specificity", "accuracy"],
    ),
    PersonaConfig(
        persona="Grant officer",
        lens_prompt=(
            "You are a grant program officer. Check that the answer states clearly "
            "who benefits and what the concrete output is, aligned to funder priorities."
        ),
        focus_areas=["beneficiary clarity", "funder alignment"],
    ),
    PersonaConfig(
        persona="Regulator",
        lens_prompt=(
            "You are a regulator. Ensure compliance, auditability, and risk claims "
            "are precise and verifiable rather than aspirational."
        ),
        focus_areas=["compliance", "auditability"],
    ),
    PersonaConfig(
        persona="Comms",
        lens_prompt=(
            "You are a communications lead. Make it punchy, clear, and jargon-free "
            "without losing substance. You may propose a tighter full-sentence rewrite."
        ),
        focus_areas=["clarity", "concision"],
    ),
]


def builtin_persona_dicts() -> list[dict]:
    return [p.to_dict() for p in BUILTIN_PERSONAS]


def persona_names() -> list[str]:
    return [p.persona for p in BUILTIN_PERSONAS]

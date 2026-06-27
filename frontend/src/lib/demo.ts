import type { Critic } from "./types";

// Mirrors backend/app/demo.py so the console renders instantly with no backend.

export const DEMO_QUESTION =
  "What does your company do? (Answer in 150 characters or fewer.)";

export const DEMO_CONTEXT =
  "Armature Labs is a life science data infrastructure company. We connect " +
  "fragmented lab systems - ELN, LIMS, QMS - and unstructured lab data into a " +
  "single unified data layer. Scientists then define automations in plain " +
  "English; the platform compiles these into deterministic, auditable Starlark " +
  "scripts that run against the unified data. Customers are biotech and pharma " +
  "R&D teams drowning in siloed systems and manual data wrangling. Current " +
  "reference client: Daresbury Proteins. Backed by Durham University venture " +
  "programmes. Applying for Innovate UK Labs of the Future funding.";

// 154 characters - intentionally over the 150 limit so the solver has work.
export const DEMO_DRAFT =
  "Armature Labs unifies fragmented biotech lab systems into one data layer, " +
  "letting scientists automate workflows in plain English with full auditability.";

export const DEMO_CRITICS: Critic[] = [
  {
    critic: "VC",
    persona_note: "Wants market signal and scalability implied",
    span_original: "unifies fragmented biotech lab systems into one data layer",
    span_replacement: "connects siloed R&D systems into a single auditable data layer",
  },
  {
    critic: "Grant officer",
    persona_note: "Wants clarity on who benefits and what the output is",
    span_original:
      "letting scientists automate workflows in plain English with full auditability",
    span_replacement:
      "enabling scientists to automate lab workflows in plain English - with a full audit trail",
  },
  {
    critic: "Scientist",
    persona_note: "Wants specificity about which systems",
    span_original: "fragmented biotech lab systems",
    span_replacement: "ELN, LIMS and QMS systems",
  },
  {
    critic: "Comms",
    persona_note: "Wants it punchier and shorter",
    span_original: DEMO_DRAFT,
    span_replacement:
      "Armature Labs turns siloed lab data into auditable automations - in plain English.",
  },
  {
    critic: "Regulator",
    persona_note: "Wants the auditability claim to be prominent",
    span_original: "with full auditability",
    span_replacement:
      "producing a verifiable, auditable record of every automated step",
  },
];

export const DEFAULT_CHAR_LIMIT = 150;
export const MIN_BUDGET = 50;

/** Extract the stated character limit from a question like "...150 characters...". */
export function parseCharLimit(question: string): number {
  const match = question.match(/(\d{2,4})\s*characters?/i);
  if (match) {
    const n = parseInt(match[1], 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return DEFAULT_CHAR_LIMIT;
}

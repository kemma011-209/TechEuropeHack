import type { Critic } from "./types";

// Mirrors backend/app/demo.py so the console renders instantly with no backend.

export const DEMO_QUESTION =
  "What does your company do? (Answer in 400 characters or fewer.)";

export const DEMO_CONTEXT =
  "Armature Labs is a life science data infrastructure company. We connect " +
  "fragmented lab systems - ELN, LIMS, QMS - and unstructured lab data into a " +
  "single unified data layer. Scientists then define automations in plain " +
  "English; the platform compiles these into deterministic, auditable Starlark " +
  "scripts that run against the unified data. Customers are biotech and pharma " +
  "R&D teams drowning in siloed systems and manual data wrangling. Current " +
  "reference client: Daresbury Proteins. Backed by Durham University venture " +
  "programmes. Applying for Innovate UK Labs of the Future funding.";

// A fuller ~400-character answer so the wordspace has real material to edit.
export const DEMO_DRAFT =
  "Armature Labs is a life science data infrastructure company that unifies " +
  "fragmented lab systems - ELN, LIMS and QMS - and unstructured data into a " +
  "single, auditable data layer. Scientists describe automations in plain " +
  "English and the platform compiles them into deterministic, reproducible " +
  "Starlark scripts that run against the unified data, freeing biotech and " +
  "pharma R&D teams from manual data wrangling.";

export const DEMO_CRITICS: Critic[] = [
  {
    critic: "VC",
    persona_note: "Wants market signal and scalability implied",
    span_original: "a life science data infrastructure company",
    span_replacement: "the data infrastructure layer for life sciences",
  },
  {
    critic: "Scientist",
    persona_note: "Wants specificity about determinism and reproducibility",
    span_original: "deterministic, reproducible Starlark scripts",
    span_replacement: "deterministic, auditable Starlark scripts",
  },
  {
    critic: "Grant officer",
    persona_note: "Wants the beneficiary and outcome to be explicit",
    span_original:
      "freeing biotech and pharma R&D teams from manual data wrangling",
    span_replacement:
      "eliminating manual data wrangling for biotech and pharma R&D teams",
  },
  {
    critic: "Comms",
    persona_note: "Wants it punchier and shorter",
    span_original: DEMO_DRAFT,
    span_replacement:
      "Armature Labs turns siloed lab data into auditable, plain-English automations for biotech R&D.",
  },
  {
    critic: "Regulator",
    persona_note: "Wants the auditability claim prominent",
    span_original: "a single, auditable data layer",
    span_replacement: "a single, fully audit-trailed data layer",
  },
];

export const DEFAULT_CHAR_LIMIT = 400;
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

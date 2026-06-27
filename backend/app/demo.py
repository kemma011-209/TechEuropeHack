"""Hardcoded demo data shared as the offline fallback for every endpoint.

This mirrors the build spec so the app is fully functional with no API
connection at all.
"""

DEMO_QUESTION = "What does your company do? (Answer in 400 characters or fewer.)"

DEMO_CONTEXT = (
    "Armature Labs is a life science data infrastructure company. We connect "
    "fragmented lab systems - ELN, LIMS, QMS - and unstructured lab data into a "
    "single unified data layer. Scientists then define automations in plain "
    "English; the platform compiles these into deterministic, auditable Starlark "
    "scripts that run against the unified data. Customers are biotech and pharma "
    "R&D teams drowning in siloed systems and manual data wrangling. Current "
    "reference client: Daresbury Proteins. Backed by Durham University venture "
    "programmes. Applying for Innovate UK Labs of the Future funding."
)

# A fuller ~400-character answer so the wordspace has real material to edit and
# the budget slider has something to trim.
DEMO_DRAFT = (
    "Armature Labs is a life science data infrastructure company that unifies "
    "fragmented lab systems - ELN, LIMS and QMS - and unstructured data into a "
    "single, auditable data layer. Scientists describe automations in plain "
    "English and the platform compiles them into deterministic, reproducible "
    "Starlark scripts that run against the unified data, freeing biotech and "
    "pharma R&D teams from manual data wrangling."
)

DEMO_CRITICS = [
    {
        "critic": "VC",
        "persona_note": "Wants market signal and scalability implied",
        "span_original": "a life science data infrastructure company",
        "span_replacement": "the data infrastructure layer for life sciences",
    },
    {
        "critic": "Scientist",
        "persona_note": "Wants specificity about determinism and reproducibility",
        "span_original": "deterministic, reproducible Starlark scripts",
        "span_replacement": "deterministic, auditable Starlark scripts",
    },
    {
        "critic": "Grant officer",
        "persona_note": "Wants the beneficiary and outcome to be explicit",
        "span_original": "freeing biotech and pharma R&D teams from manual data wrangling",
        "span_replacement": "eliminating manual data wrangling for biotech and pharma R&D teams",
    },
    {
        "critic": "Comms",
        "persona_note": "Wants it punchier and shorter",
        "span_original": DEMO_DRAFT,
        "span_replacement": "Armature Labs turns siloed lab data into auditable, plain-English automations for biotech R&D.",
    },
    {
        "critic": "Regulator",
        "persona_note": "Wants the auditability claim prominent",
        "span_original": "a single, auditable data layer",
        "span_replacement": "a single, fully audit-trailed data layer",
    },
]

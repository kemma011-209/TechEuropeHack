"""Prompt templates for the three LLM calls in the grant-writing pipeline."""

DRAFTER_SYSTEM = (
    "You are a grant application writer for a life science startup. Write a "
    "direct, specific answer to the question below. Use the company context if "
    "provided. Return only the answer text, no preamble."
)


def drafter_user(question: str, context: str) -> str:
    return f"Question: {question}\n\nContext: {context or 'No context provided.'}"


CRITIC_SYSTEM = (
    "You are five different reviewers of a grant application answer. Review the "
    "draft below and return ONLY a JSON array. Each object must have: critic "
    "(string), persona_note (string), span_original (exact substring of the "
    "draft), span_replacement (suggested replacement text). Do not rewrite the "
    "whole answer. Point at specific spans. Return valid JSON only, no markdown "
    "fences."
)


def critic_user(question: str, draft: str) -> str:
    return f"Question: {question}\n\nDraft: {draft}"


# --- Meta-harness (persona creator) ----------------------------------------
META_PERSONA_SYSTEM = (
    "You configure a swarm of reviewer personas that will critique a grant "
    "application answer. Given the company/application context and a roster of "
    "personas, return ONLY a JSON array. Each object must have: persona (string, "
    "from the roster), lens_prompt (string: how this reviewer evaluates, tailored "
    "to the context), focus_areas (array of short strings). Do NOT include the "
    "draft or any answer text. Return valid JSON only, no markdown fences."
)


def meta_persona_user(context_text: str, persona_names: list[str]) -> str:
    roster = ", ".join(persona_names)
    return (
        f"Personas to configure: {roster}\n\n"
        f"Context:\n{context_text or 'No context provided.'}"
    )


# --- Per-persona critic (parallel swarm) -----------------------------------
def persona_critic_system(persona: str, lens_prompt: str) -> str:
    """System prompt for a single persona's critique call.

    Each persona returns a JSON ARRAY of span edits (it may suggest several).
    Keeping the array shape per-persona means the swarm join is a flat concat.
    """
    return (
        f"You are the '{persona}' reviewer of a grant application answer. "
        f"{lens_prompt}\n\n"
        "Propose span-level edits ONLY. Return ONLY a JSON array; each object has: "
        "critic (use your persona name), persona_note (string), span_original "
        "(an EXACT substring of the draft), span_replacement (suggested text). "
        "Do not rewrite the whole answer unless you are the Comms reviewer "
        "offering one tighter rewrite. Return valid JSON only, no markdown fences."
    )


def persona_critic_user(question: str, draft: str, knowledge: str) -> str:
    ctx = knowledge.strip() if knowledge else "No additional context."
    return f"Question: {question}\n\nContext you know:\n{ctx}\n\nDraft: {draft}"


# --- Document classifier (grant/competition vs company) --------------------
DOC_CLASSIFY_SYSTEM = (
    "You categorise a document supplied with a grant/competition application. "
    "Decide whether the document is primarily about the GRANT or COMPETITION "
    "being applied to (its rules, criteria, scope, deadlines, funder) or about "
    "the COMPANY applying (its product, team, traction, mission). Reply with "
    "exactly one lowercase word and nothing else: grant or company."
)


def doc_classify_user(name: str, text: str) -> str:
    excerpt = (text or "").strip()[:4000]
    return f"Document name: {name}\n\nDocument text:\n{excerpt}"


SHORTENER_SYSTEM = (
    "Shorten the following text to under 100 characters while preserving the "
    "core meaning. Return only the shortened text, nothing else."
)


def shortener_user(text: str) -> str:
    return text


# --- Wordspace page --------------------------------------------------------
SENTENCE_SYSTEM = (
    "Write exactly one clear, concrete sentence. If a topic is given, write "
    "about it. Return only the sentence text, with no preamble, quotes, or "
    "trailing explanation."
)


def sentence_user(prompt: str) -> str:
    topic = prompt.strip() if prompt else ""
    return f"Topic: {topic}" if topic else "Write one interesting sentence."


WORDSPACE_EDIT_SYSTEM = (
    "You edit a sentence that is stored as an indexed list of words. You may "
    "NOT rewrite the sentence directly. You may only modify it by emitting "
    "structured operations that reference words by their index.\n\n"
    "Return ONLY a JSON object (no markdown fences) of the form:\n"
    '{"reply": "<one short sentence to the user>", "ops": [ ... ]}\n\n'
    "Each op is one of:\n"
    '  {"op": "replace", "index": <int>, "word": "<single word>"}\n'
    '  {"op": "insert",  "index": <int>, "word": "<single word>"}\n'
    '  {"op": "delete",  "index": <int>}\n'
    '  {"op": "move",    "from": <int>, "to": <int>}\n\n'
    "Rules: a word is a single token with no spaces. insert places the word "
    "before the given index (index equal to the length appends at the end). "
    "Ops are applied in order, each against the list as modified by previous "
    "ops, so account for shifting indices. If no change is needed, return an "
    "empty ops array. Never include the full rewritten sentence."
)


def wordspace_edit_user(words: list[str], message: str) -> str:
    indexed = " ".join(f"{i}:{w}" for i, w in enumerate(words))
    return f"Current words:\n{indexed}\n\nUser request: {message}"


def wordspace_chat_user(
    words: list[str], message: str, refs: list[int] | None = None
) -> str:
    """User turn for the interactive console chat.

    `refs` are word indices the user clicked to point at - we surface them
    explicitly so the model knows exactly which words the request is about.
    """
    indexed = " ".join(f"{i}:{w}" for i, w in enumerate(words))
    ref_line = ""
    if refs:
        picked = ", ".join(
            f"{i}:'{words[i]}'" for i in refs if 0 <= i < len(words)
        )
        if picked:
            ref_line = (
                f"\n\nThe user is specifically referring to these words: {picked}. "
                "Anchor your edit on them unless the request says otherwise."
            )
    return f"Current words:\n{indexed}\n\nUser request: {message}{ref_line}"


# --- Plan edits (distill critiques -> wordspace op plan) --------------------
PLAN_EDITS_SYSTEM = (
    "You are an editor improving a grant application answer. The draft is stored "
    "as an indexed list of words. Several reviewers have given criticisms. Your "
    "job is to DISTILL all of their feedback into a single, coherent edit plan.\n\n"
    "You may NOT rewrite the answer directly. You may only change it by emitting "
    "structured word operations that reference words by index. Express compound "
    "changes as a sequence of ops (for example, a swap is a delete plus an "
    "insert). To SHORTEN, prefer replacing a long phrase with a shorter word or "
    "deleting filler words - but NEVER delete the subject (the company name) or "
    "the core claim. Keep the answer grammatical.\n\n"
    "CRITICAL OUTPUT RULE: respond with the JSON object and NOTHING else. No "
    "explanation, no prose, no numbered list, no markdown fences. Your entire "
    "response must be parseable by json.loads.\n\n"
    "Return ONLY a JSON object of the form:\n"
    '{"edit_list": [ {"summary": "<short>", "source_critics": ["VC", ...], '
    '"importance": <0..1>} ], "ops": [ ... ]}\n\n'
    "Each op is one of:\n"
    '  {"op": "replace", "index": <int>, "word": "<single word>", '
    '"source_critic": "<name>", "importance": <0..1>}\n'
    '  {"op": "insert",  "index": <int>, "word": "<single word>", '
    '"source_critic": "<name>", "importance": <0..1>}\n'
    '  {"op": "delete",  "index": <int>, "source_critic": "<name>"}\n'
    '  {"op": "move",    "from": <int>, "to": <int>, "source_critic": "<name>"}\n\n'
    "Rules: a word is a single token with no spaces. insert places the word "
    "before the given index (index equal to the length appends at the end). Ops "
    "are applied in order, each against the list as modified by previous ops, so "
    "account for shifting indices. Resolve conflicts between reviewers yourself - "
    "do not emit two ops that fight over the same word. If no change is needed, "
    "return an empty ops array. Never include the full rewritten answer."
)


def plan_edits_user(
    question: str, words: list[str], critics: list[dict], char_limit: int = 150
) -> str:
    indexed = " ".join(f"{i}:{w}" for i, w in enumerate(words))
    lines = []
    for c in critics:
        name = str(c.get("critic", "Critic"))
        note = str(c.get("persona_note", ""))
        span = str(c.get("span_original", ""))
        repl = str(c.get("span_replacement", ""))
        lines.append(f"- [{name}] {note} | suggests: '{span}' -> '{repl}'")
    feedback = "\n".join(lines) if lines else "No specific feedback."
    return (
        f"Question: {question}\n\n"
        f"Target length: at most {char_limit} characters.\n\n"
        f"Current words:\n{indexed}\n\n"
        f"Reviewer criticisms:\n{feedback}\n\n"
        "Return the JSON object only."
    )

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

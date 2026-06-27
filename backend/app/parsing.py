"""Shared helpers for parsing LLM JSON output.

Centralises the fence-stripping and critic-normalisation logic so both the
FastAPI handlers and the LangGraph nodes behave identically.
"""

from __future__ import annotations

import json
import re

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def strip_fences(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = _FENCE_RE.sub("", cleaned)
    cleaned = re.sub(r"^```(?:json)?", "", cleaned.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"```$", "", cleaned.strip())
    return cleaned.strip()


def parse_json_array(text: str) -> list:
    """Parse a JSON array, tolerating fences and surrounding prose."""
    cleaned = strip_fences(text)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return parsed
    except (ValueError, json.JSONDecodeError):
        pass
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end > start:
        parsed = json.loads(cleaned[start : end + 1])
        if isinstance(parsed, list):
            return parsed
    raise ValueError("no JSON array found in response")


def parse_json_object(text: str) -> dict:
    """Parse a JSON object, tolerating fences and surrounding prose.

    Models sometimes wrap the object in an explanation ("Here is the plan: {...}")
    or a trailing list. We try a clean parse first, then fall back to slicing the
    outermost {...}. Raises ValueError when no object can be recovered.
    """
    cleaned = strip_fences(text)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except (ValueError, json.JSONDecodeError):
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        parsed = json.loads(cleaned[start : end + 1])
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("no JSON object found in response")


def normalize_critics(parsed: object, draft: str) -> list[dict]:
    """Validate a critic array and annotate each item.

    Adds `span_in_draft` (whether span_original is an exact substring of the
    draft) and `full_rewrite` (whether the span is the entire draft).
    """
    if not isinstance(parsed, list):
        raise ValueError("critic response is not a JSON array")

    critics: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        span_original = str(item.get("span_original", ""))
        critics.append(
            {
                "critic": str(item.get("critic", "")),
                "persona_note": str(item.get("persona_note", "")),
                "span_original": span_original,
                "span_replacement": str(item.get("span_replacement", "")),
                "span_in_draft": span_original in draft,
                "full_rewrite": (
                    span_original.strip() == draft.strip()
                    and bool(span_original.strip())
                ),
            }
        )
    if not critics:
        raise ValueError("critic response contained no usable items")
    return critics


def parse_critics_text(text: str, draft: str) -> list[dict]:
    """Parse + normalize critic JSON from raw model text."""
    return normalize_critics(parse_json_array(text), draft)

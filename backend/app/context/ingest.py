"""Optional PDF -> text ingestion for context gathering.

Routes through SIE Extract / OCR when a Superlinked gateway is configured. This
is deliberately thin and fail-soft: if SIE isn't reachable (or no bytes are
given) it returns None so the gather node simply skips document context.

The pipeline does not depend on this working; it only enriches the bundle when a
PDF is supplied and a gateway is available.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from .. import config
from .bundle import IngestedDocument

_TIMEOUT = httpx.Timeout(60.0, connect=8.0)

# A reasonable default OCR model name; override via env if the gateway differs.
_OCR_MODEL = "ocr"


async def pdf_to_text(
    filename: str, content_b64: str, *, ocr_model: str = _OCR_MODEL
) -> tuple[IngestedDocument | None, dict[str, Any]]:
    """Extract text from a base64-encoded PDF via SIE Extract.

    Returns (IngestedDocument | None, meta). Never raises. When SIE isn't
    configured or the call fails, returns (None, meta) and the caller proceeds
    without document context.
    """
    started = time.perf_counter()

    def _meta(ok: bool, error: str | None = None) -> dict[str, Any]:
        return {
            "provider": "sie-extract",
            "model": ocr_model,
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "ok": ok,
            "fallback": not ok,
            "error": error,
        }

    if not config.sie_base_set():
        return None, _meta(False, "SUPERLINKED_BASE_URL not set")
    if not content_b64:
        return None, _meta(False, "no document bytes")

    base = config.SUPERLINKED_BASE_URL.rstrip("/")
    url = f"{base}/v1/extract/{ocr_model}"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if config.SUPERLINKED_API_KEY:
        headers["Authorization"] = f"Bearer {config.SUPERLINKED_API_KEY}"
    body = {"document": {"data": content_b64, "mime_type": "application/pdf"}}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            return None, _meta(False, f"HTTP {resp.status_code}")
        data = resp.json()
        text = str(data.get("text") or data.get("markdown") or "").strip()
        if not text:
            return None, _meta(False, "empty extraction")
        return (
            IngestedDocument(
                name=filename or "document.pdf",
                text=text,
                page_count=data.get("page_count"),
            ),
            _meta(True),
        )
    except Exception as exc:  # noqa: BLE001
        return None, _meta(False, f"{type(exc).__name__}: {exc}")

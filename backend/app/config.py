"""Runtime configuration loaded from backend/.env.

No external dependencies: we parse the .env file by hand so the app works even
without python-dotenv installed. Environment variables already present in the
process take precedence over the .env file.
"""

import os
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def _load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


_FILE_ENV = _load_env_file(ENV_PATH)


def _get(*keys: str, default: str = "") -> str:
    """Return the first non-empty value found in os.environ then the .env file.

    Accepts multiple key spellings (handy for the SUPERLINKED_API_KEy typo).
    """
    for key in keys:
        if os.environ.get(key):
            return os.environ[key].strip()
    for key in keys:
        if _FILE_ENV.get(key):
            return _FILE_ENV[key].strip()
    return default


# --- Secrets ---------------------------------------------------------------
GEMMA_API_KEY = _get("GEMMA_API_KEY")
# Tolerate the existing casing typo (SUPERLINKED_API_KEy) in backend/.env.
SUPERLINKED_API_KEY = _get("SUPERLINKED_API_KEY", "SUPERLINKED_API_KEy")

# --- Models ----------------------------------------------------------------
# Google Generative Language API. gemini-3.5-flash is the model proven to work
# by backend/quicktest.py against this key.
GEMMA_MODEL = _get("GEMMA_MODEL", default="gemini-3.5-flash")
GEMMA_BASE_URL = _get(
    "GEMMA_BASE_URL",
    default="https://generativelanguage.googleapis.com/v1beta",
)

# Superlinked Inference Engine (OpenAI-compatible /v1/chat/completions).
# Base URL/model are unknown until provided; when empty the draft/shorten
# endpoints fall back to demo data.
SUPERLINKED_BASE_URL = _get("SUPERLINKED_BASE_URL")
# A SIE "Generators" catalog model. Passed with HF-style slashes; the client
# converts to SIE's double-underscore id for the /v1/generate URL.
SUPERLINKED_MODEL = _get("SUPERLINKED_MODEL", default="Qwen/Qwen3-4B-Instruct-2507")

# SIE reranker (CPU-friendly, runs on the default bundle). Used by /api/rank to
# score variant relevance, feeding the solver's quality weights.
SUPERLINKED_RERANK_MODEL = _get(
    "SUPERLINKED_RERANK_MODEL", default="cross-encoder/ms-marco-MiniLM-L-6-v2"
)

# --- CORS ------------------------------------------------------------------
_origins = _get("ALLOWED_ORIGINS", default="http://localhost:3000,http://127.0.0.1:3000")
ALLOWED_ORIGINS = [o.strip() for o in _origins.split(",") if o.strip()]


def superlinked_configured() -> bool:
    return bool(SUPERLINKED_BASE_URL and SUPERLINKED_API_KEY)


def sie_base_set() -> bool:
    """SIE reranking/embedding only needs a base URL (key optional for local)."""
    return bool(SUPERLINKED_BASE_URL)


def gemma_configured() -> bool:
    return bool(GEMMA_API_KEY)

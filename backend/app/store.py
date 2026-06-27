"""SQLite post-training capture.

Writes one row per accepted answer. The (draft, final, char_limit) trio is the
DPO-ready core: `draft` is what the powerful Gemma drafter produced, `final` is
the human-validated, char-limit-fit answer. Everything else (context, critiques,
selections, personas) is stored for richer future training/eval.

Only the accept handler calls record_acceptance(); nothing is written earlier.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any

from . import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS accepted_answers (
    id              TEXT PRIMARY KEY,
    session_id      TEXT,
    created_at      REAL NOT NULL,
    topic           TEXT,
    question        TEXT NOT NULL,
    char_limit      INTEGER,
    context_json    TEXT,
    draft           TEXT NOT NULL,
    final           TEXT NOT NULL,
    critiques_json  TEXT,
    selections_json TEXT,
    personas_json   TEXT,
    providers_json  TEXT
);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.STORE_DB_PATH)
    conn.execute(_SCHEMA)
    return conn


def init_db() -> None:
    """Create the table if it does not exist (idempotent)."""
    conn = _connect()
    try:
        conn.commit()
    finally:
        conn.close()


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def record_acceptance(
    *,
    question: str,
    draft: str,
    final: str,
    char_limit: int | None = None,
    topic: str = "",
    context: Any = None,
    critiques: Any = None,
    selections: Any = None,
    personas: Any = None,
    providers: Any = None,
    session_id: str | None = None,
) -> dict:
    """Persist one accepted answer. Returns a small summary of what was stored."""
    record_id = uuid.uuid4().hex
    created_at = time.time()
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT INTO accepted_answers (
                id, session_id, created_at, topic, question, char_limit,
                context_json, draft, final, critiques_json, selections_json,
                personas_json, providers_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record_id,
                session_id or uuid.uuid4().hex,
                created_at,
                topic,
                question,
                char_limit,
                _dumps(context),
                draft,
                final,
                _dumps(critiques),
                _dumps(selections),
                _dumps(personas),
                _dumps(providers),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "id": record_id,
        "created_at": created_at,
        "preference_pair": {"chosen": final, "rejected": draft},
    }


def count_records() -> int:
    conn = _connect()
    try:
        cur = conn.execute("SELECT COUNT(*) FROM accepted_answers")
        return int(cur.fetchone()[0])
    finally:
        conn.close()

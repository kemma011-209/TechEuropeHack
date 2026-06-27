# Backend (FastAPI)

Pipeline API for the grant application writing tool. Three endpoints, each
returning the result plus a `meta` block (provider, model, latency, fallback)
so the frontend console can visualize what happened. Every endpoint fails soft
to demo data and never returns a 5xx for an upstream LLM failure.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

## Configure

Copy `.env.example` to `.env` and fill in:

- `GEMMA_API_KEY` / `GEMMA_MODEL` — Google Generative Language API, used by the
  critic swarm. `gemini-3.5-flash` is the model proven by `quicktest.py`.
- `SUPERLINKED_API_KEY` / `SUPERLINKED_BASE_URL` / `SUPERLINKED_MODEL` — the
  OpenAI-compatible Superlinked Inference Engine, used by the drafter and
  shortener. Leave `SUPERLINKED_BASE_URL` blank to run on demo data.
- `ALLOWED_ORIGINS` — comma-separated CORS origins (defaults to the Next.js dev
  server on :3000).

## Run

```bash
uvicorn app.main:app --reload
```

API available at http://localhost:8000 — docs at http://localhost:8000/docs

## Endpoints

- `GET  /health` — status + which providers are configured.
- `POST /api/draft` — `{question, context}` → `{draft, source, meta}` (Superlinked, else demo).
- `POST /api/critique` — `{question, draft}` → `{critics[], parse_ok, warning?, source, meta}` (Gemma; demo fallback on parse failure).
- `POST /api/shorten` — `{text}` → `{shortened, source, meta}` (Superlinked, else deterministic local truncation).

The character ceiling is never enforced by an LLM — that is the frontend
solver's job.

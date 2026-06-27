# TechEuropeHack — Grant Writing Pipeline

Monorepo with a FastAPI backend and a Next.js frontend.  
The main UI is a pipeline testing console at **`/console`**.

## Structure

```
techeurope/
├── backend/    FastAPI Python API (draft → critique → shorten pipeline)
└── frontend/   Next.js + TypeScript + Tailwind app
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| Node.js | 18+ |
| pnpm | 9+ (`npm i -g pnpm`) |

---

## 1 — Backend

```bash
cd backend

# create & activate virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# install dependencies
pip install -r requirements.txt

# configure environment
copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux
# (edit .env — see section below)

# start the API server
uvicorn app.main:app --reload
```

API is now at **http://localhost:8000**  
Interactive docs: **http://localhost:8000/docs**

### Backend `.env` keys

| Key | Required | Description |
|-----|----------|-------------|
| `GEMMA_API_KEY` | Yes (for live calls) | Google Generative Language API key |
| `GEMMA_MODEL` | No | Defaults to `gemini-3.5-flash` |
| `SUPERLINKED_BASE_URL` | No | Leave blank to use demo data |
| `SUPERLINKED_API_KEY` | No | Required when `SUPERLINKED_BASE_URL` is set |
| `ALLOWED_ORIGINS` | No | Defaults to `http://localhost:3000` |

The API works with **zero keys** — all endpoints fall back to demo data automatically.

---

## 2 — Frontend

```bash
cd frontend

# install dependencies
pnpm install

# configure environment (optional — only needed for live backend calls)
copy .env.local.example .env.local    # Windows
# cp .env.local.example .env.local   # macOS / Linux
# .env.local contains: NEXT_PUBLIC_API_BASE=http://localhost:8000

# start the dev server
pnpm dev
```

Frontend is now at **http://localhost:3000**

---

## 3 — Open the Console

Navigate to **http://localhost:3000/console**

The console:
- Loads with **hardcoded demo data** — fully functional even with no backend running
- Click **Run pipeline** to hit the live FastAPI backend (draft → critique → shorten)
- Displays provider, model, latency, and demo-fallback status for every call
- Runs the character-budget **knapsack solver** entirely client-side

---

## Running both services together

Open two terminals:

```bash
# Terminal 1 — backend
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload

# Terminal 2 — frontend
cd frontend
pnpm dev
```

Then open **http://localhost:3000/console**.

---

## Endpoints (backend)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Status + which providers are configured |
| `POST` | `/api/draft` | `{question, context}` → draft text |
| `POST` | `/api/critique` | `{question, draft}` → list of critic comments |
| `POST` | `/api/shorten` | `{text}` → shortened text within character budget |

Each response includes a `meta` block with `provider`, `model`, `latency_ms`, and `fallback` flag.

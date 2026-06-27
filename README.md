# QuickApp — Grant Writing Pipeline

A full-stack monorepo for **QuickApp**, an intelligent grant-writing pipeline that uses an AI persona swarm and an interactive wordspace editor to perfectly fit startup R&D narratives into strict grant character budgets.

## Structure

```text
techeurope/
├── backend/    FastAPI Python API (LangGraph swarm, wordspace engine, SQLite store)
└── frontend/   Next.js + TypeScript + Tailwind app (interactive wordspace UI)
```

---

## Features

- **Agentic Pipeline (LangGraph):** Orchestrates a parallel swarm of LLM critic personas (VC, Regulator, Scientist) to review answers.
- **Deterministic Span Merge:** Critics' suggestions are merged without index drift or hallucination.
- **Interactive Wordspace Fit:** A dynamic slider trims low-value words and uses the LLM as a "realizer" to insert grammatical connectives (via structured JSON ops only), ensuring the final text is always both grammatical and under budget.
- **Post-Training DPO Logging:** Accepted answers are written to a SQLite store as a `(draft, final, char_limit)` pair, creating a perfect dataset for future post-training fine-tuning.

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
uvicorn app.main:app --port 8000
```

API is now at **http://localhost:8000**  
Interactive docs: **http://localhost:8000/docs**

### Backend `.env` keys

| Key | Required | Description |
|-----|----------|-------------|
| `GEMMA_API_KEY` | Yes (live ops) | Google Generative Language API key |
| `GEMMA_MODEL` | No | Defaults to `gemini-3.1-pro-preview` |
| `SUPERLINKED_BASE_URL` | No | Base URL for the SIE reranker |
| `SUPERLINKED_API_KEY` | No | Required if `SUPERLINKED_BASE_URL` is set |
| `ALLOWED_ORIGINS` | No | Defaults to `http://localhost:3000` |

*Note: The API works with **zero keys** — it automatically falls back to robust offline demo data.*

---

## 2 — Frontend

```bash
cd frontend

# install dependencies
pnpm install

# configure environment (optional)
copy .env.local.example .env.local    # Windows
# cp .env.local.example .env.local   # macOS / Linux
# .env.local contains: NEXT_PUBLIC_API_BASE=http://localhost:8000

# start the dev server
pnpm dev --port 3000
```

Frontend is now at **http://localhost:3000**

---

## 3 — Usage

Navigate to **http://localhost:3000/console**

1. **Context Gate:** Provide your company details (uses demo data if left blank).
2. **Run Pipeline:** The backend drafts an answer, runs 5 parallel critics, and merges their edits (new words are tagged blue).
3. **Wordspace Slider:** Drag the budget slider to trim the text. When you release, the LLM inserts grammatical glue (tagged grey) via strict index ops.
4. **Chat:** Click any word in the UI to anchor a reference, then type a request (e.g., "make this punchier"). The LLM applies the edit directly.
5. **Accept:** Logs the finalized result to SQLite.

---

## Running both services together

Open two terminals:

```bash
# Terminal 1 — backend
cd backend
.venv\Scripts\activate
python -m uvicorn app.main:app --port 8000

# Terminal 2 — frontend
cd frontend
pnpm dev --port 3000
```

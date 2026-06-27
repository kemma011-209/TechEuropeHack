# TechEuropeHack

Monorepo with a FastAPI backend and a Next.js frontend.

## Structure

- `backend/` — FastAPI Python API (see `backend/README.md`)
- `frontend/` — Next.js + TypeScript + Tailwind app

## Quick start

**Backend**

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

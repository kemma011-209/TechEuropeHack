"""Quick connectivity + smoke test for the Tavily Search API.

Run:  python scripts/tavily_test.py   (from the backend/ directory)

Reads TAVILY_API_KEY from backend/.env (no extra dependencies) and asks Tavily
for advice on applying to Y Combinator's summer batch, printing the LLM-generated
answer and the ranked sources it was grounded on.

NOTE: This is the reference implementation for app/context/search.py. A colleague
is wiring this call behind the async web_search() interface used by the pipeline.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Windows consoles default to cp1252 and choke on characters Tavily returns
# (e.g. non-breaking hyphens). Force UTF-8 output where supported.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# scripts/ lives under backend/, so .env is one directory up.
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
SEARCH_URL = "https://api.tavily.com/search"

QUERY = (
    "Advice and tips for writing a strong Y Combinator (YC) application "
    "for their summer batch / startup school"
)


def load_key() -> str:
    # Process env wins over the .env file, mirroring app/config.py.
    if os.environ.get("TAVILY_API_KEY"):
        return os.environ["TAVILY_API_KEY"].strip()
    if not ENV_PATH.exists():
        raise SystemExit(f"No .env found at {ENV_PATH}")
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("TAVILY_API_KEY=") and not line.startswith("#"):
            value = line.split("=", 1)[1].strip()
            if value:
                return value
    raise SystemExit("TAVILY_API_KEY is empty/missing in .env")


def search(key: str, query: str) -> dict:
    body = json.dumps(
        {
            "query": query,
            "search_depth": "advanced",
            "include_answer": "advanced",
            "max_results": 5,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        SEARCH_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {e.code}: {detail[:500]}")
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"{type(e).__name__}: {e}")


def main() -> None:
    key = load_key()
    print(f"Loaded key: {key[:6]}...{key[-4:]} (len {len(key)})\n")
    print(f"Query: {QUERY}\n")

    data = search(key, QUERY)

    answer = data.get("answer")
    if answer:
        print("=== Tavily answer ===")
        print(answer)
        print()

    results = data.get("results", [])
    print(f"=== Sources ({len(results)}) ===")
    for i, r in enumerate(results, 1):
        score = r.get("score")
        score_str = f"{score:.3f}" if isinstance(score, (int, float)) else "?"
        print(f"{i}. [{score_str}] {r.get('title')}")
        print(f"   {r.get('url')}")
        snippet = (r.get("content") or "").strip().replace("\n", " ")
        if snippet:
            print(f"   {snippet[:200]}{'...' if len(snippet) > 200 else ''}")
        print()

    rt = data.get("response_time")
    if rt is not None:
        print(f"response_time: {rt}s")
    print("\nSUCCESS: Tavily search returned results.")


if __name__ == "__main__":
    main()

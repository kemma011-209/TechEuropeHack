"""Quick connectivity test for the Gemini/Gemma API key in .env.

Run:  python scripts/quicktest.py   (from the backend/ directory)

Reads GEMMA_API_KEY from backend/.env (no extra dependencies) and tries a few
model + auth combinations, printing the first that works.
"""

import json
import urllib.error
import urllib.request
from pathlib import Path

# scripts/ lives under backend/, so .env is one directory up.
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
BASE = "https://generativelanguage.googleapis.com/v1beta"

# Latest flash model (verified against this key's ListModels output).
MODELS = ["gemini-3.5-flash"]

PROMPT = "Reply with exactly: OK"


def load_key() -> str:
    if not ENV_PATH.exists():
        raise SystemExit(f"No .env found at {ENV_PATH}")
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("GEMMA_API_KEY=") and not line.startswith("#"):
            value = line.split("=", 1)[1].strip()
            if value:
                return value
    raise SystemExit("GEMMA_API_KEY is empty in .env")


def try_call(model: str, key: str, auth: str):
    """auth is one of: 'query', 'header', 'bearer'. Returns (ok, detail)."""
    url = f"{BASE}/models/{model}:generateContent"
    headers = {"Content-Type": "application/json"}

    if auth == "query":
        url += f"?key={key}"
    elif auth == "header":
        headers["x-goog-api-key"] = key
    elif auth == "bearer":
        headers["Authorization"] = f"Bearer {key}"

    body = json.dumps({"contents": [{"parts": [{"text": PROMPT}]}]}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )
        return True, text or "(empty response)"
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        return False, f"HTTP {e.code}: {detail[:300]}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def main() -> None:
    key = load_key()
    print(f"Loaded key: {key[:6]}...{key[-4:]} (len {len(key)})\n")

    for model in MODELS:
        for auth in ("header", "query", "bearer"):
            ok, detail = try_call(model, key, auth)
            status = "PASS" if ok else "fail"
            print(f"[{status}] model={model:18s} auth={auth:6s} -> {detail}")
            if ok:
                print(f"\nSUCCESS: use model='{model}' with auth='{auth}'.")
                return
        print()

    print("No combination worked. Check the key, project access, or model names.")


if __name__ == "__main__":
    main()

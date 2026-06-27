import { DEMO_CRITICS, DEMO_DRAFT } from "./demo";
import type {
  CritiqueResponse,
  DraftResponse,
  PhaseMeta,
  RankResponse,
  SentenceResponse,
  ShortenResponse,
  WordspaceEditResponse,
} from "./types";

const DEMO_SENTENCE =
  "Armature Labs connects siloed lab systems into one auditable data layer.";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

function demoMeta(error: string): PhaseMeta {
  return {
    provider: "none",
    model: "demo",
    latency_ms: 0,
    ok: false,
    fallback: true,
    error,
    raw_snippet: "",
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function draft(question: string, context: string): Promise<DraftResponse> {
  try {
    return await post<DraftResponse>("/api/draft", { question, context });
  } catch (err) {
    return {
      draft: DEMO_DRAFT,
      source: "demo",
      meta: demoMeta(`backend unreachable: ${String(err)}`),
    };
  }
}

export async function critique(
  question: string,
  draftText: string
): Promise<CritiqueResponse> {
  try {
    return await post<CritiqueResponse>("/api/critique", {
      question,
      draft: draftText,
    });
  } catch (err) {
    return {
      critics: DEMO_CRITICS,
      parse_ok: false,
      warning: "Backend unreachable - using demo critics.",
      source: "demo",
      meta: demoMeta(`backend unreachable: ${String(err)}`),
    };
  }
}

export async function shorten(text: string): Promise<ShortenResponse> {
  try {
    return await post<ShortenResponse>("/api/shorten", { text });
  } catch {
    let fallback = text.trim();
    if (fallback.length > 99) {
      fallback = fallback.slice(0, 96).split(" ").slice(0, -1).join(" ") + "...";
    }
    return {
      shortened: fallback,
      source: "demo",
      meta: demoMeta("backend unreachable"),
    };
  }
}

export async function rank(
  question: string,
  items: { id: string; text: string }[]
): Promise<RankResponse> {
  try {
    return await post<RankResponse>("/api/rank", { question, items });
  } catch {
    return {
      rankings: {},
      source: "static",
      meta: demoMeta("backend unreachable"),
    };
  }
}

export async function generateSentence(prompt = ""): Promise<SentenceResponse> {
  try {
    return await post<SentenceResponse>("/api/sentence", { prompt });
  } catch {
    return {
      sentence: DEMO_SENTENCE,
      words: DEMO_SENTENCE.split(" "),
      source: "demo",
      meta: demoMeta("backend unreachable"),
    };
  }
}

export async function editWordspace(
  words: string[],
  message: string
): Promise<WordspaceEditResponse> {
  try {
    return await post<WordspaceEditResponse>("/api/wordspace/edit", {
      words,
      message,
    });
  } catch {
    return {
      words,
      ops: [],
      reply: "Backend unreachable - no edit applied.",
      source: "demo",
      meta: demoMeta("backend unreachable"),
    };
  }
}

export { API_BASE };

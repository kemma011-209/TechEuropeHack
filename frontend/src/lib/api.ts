import { DEMO_CRITICS, DEMO_DRAFT } from "./demo";
import type {
  AcceptResponse,
  CritiqueResponse,
  DraftResponse,
  GatherResponse,
  PersonaConfig,
  PhaseMeta,
  PipelineRunResponse,
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
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
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

// --- LangGraph pipeline -----------------------------------------------------
export interface GatherInput {
  topic?: string;
  company_name?: string;
  user_blurb?: string;
  document_name?: string;
  document_b64?: string;
}

/** Context gathering gate: returns a ready ContextBundle (fail-soft). */
export async function gather(input: GatherInput): Promise<GatherResponse> {
  try {
    return await post<GatherResponse>("/api/context/gather", input);
  } catch (err) {
    throw new Error(
      `Backend unreachable at ${API_BASE} (${String(err)}). Is uvicorn running on port 8000?`
    );
  }
}

/** Run the full graph: parallel meta-harness + draft -> critique -> knapsack. */
export async function runPipeline(
  question: string,
  contextBundle: unknown,
  charLimit?: number
): Promise<PipelineRunResponse> {
  try {
    return await post<PipelineRunResponse>("/api/pipeline/run", {
      question,
      context_bundle: contextBundle,
      char_limit: charLimit,
    });
  } catch (err) {
    throw new Error(
      `Pipeline failed (${String(err)}). Check backend at ${API_BASE} and browser console for CORS errors.`
    );
  }
}

/** Log an accepted answer as post-training data (single write on accept). */
export async function accept(payload: {
  question: string;
  draft: string;
  final: string;
  char_limit?: number;
  topic?: string;
  context?: unknown;
  critiques?: unknown[];
  planned_ops?: unknown[];
  words?: unknown[];
  selections?: Record<string, string>;
  personas?: PersonaConfig[];
  providers?: Record<string, unknown>;
  session_id?: string;
}): Promise<AcceptResponse> {
  return post<AcceptResponse>("/api/accept", payload);
}

export async function listPersonas(): Promise<{ personas: PersonaConfig[] }> {
  try {
    const res = await fetch(`${API_BASE}/api/personas`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { personas: PersonaConfig[] };
  } catch {
    return { personas: [] };
  }
}

export { API_BASE };

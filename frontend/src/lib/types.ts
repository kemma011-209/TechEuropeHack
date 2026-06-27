export interface Critic {
  critic: string;
  persona_note: string;
  span_original: string;
  span_replacement: string;
  span_in_draft?: boolean;
  full_rewrite?: boolean;
}

export interface Variant {
  id: string;
  label: string;
  text: string;
  chars: number;
  quality: number;
  fullRewrite?: boolean;
}

export interface Slot {
  id: string;
  original: string;
  variants: Variant[];
  /** The variant the user manually locked, or null to let the solver decide. */
  lockedVariantId: string | null;
}

export type PhaseStatus = "ready" | "running" | "done" | "error";

export interface PhaseMeta {
  provider: string;
  model: string;
  latency_ms: number;
  ok: boolean;
  fallback: boolean;
  error?: string | null;
  raw_snippet?: string;
}

export interface DraftResponse {
  draft: string;
  source: string;
  meta: PhaseMeta;
}

export interface CritiqueResponse {
  critics: Critic[];
  parse_ok: boolean;
  warning?: string;
  source: string;
  meta: PhaseMeta;
}

export interface ShortenResponse {
  shortened: string;
  source: string;
  meta: PhaseMeta;
}

export interface RankResponse {
  rankings: Record<string, number>; // "slotId::variantId" -> quality (0..1)
  source: string; // "sie" | "static"
  meta: PhaseMeta;
}

export type WordOp =
  | { op: "replace"; index: number; word: string }
  | { op: "insert"; index: number; word: string }
  | { op: "delete"; index: number }
  | { op: "move"; from: number; to: number };

export interface SentenceResponse {
  sentence: string;
  words: string[];
  source: string;
  meta: PhaseMeta;
}

export interface WordspaceEditResponse {
  words: string[];
  ops: WordOp[];
  reply: string;
  source: string;
  meta: PhaseMeta;
}

/** Result of the knapsack solver: chosen variant per slot. */
export interface SolverResult {
  selection: Record<string, string>; // slotId -> variantId
  totalChars: number;
  totalQuality: number;
  feasible: boolean;
}

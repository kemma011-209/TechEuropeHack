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

export interface WordspaceChatResponse {
  tokens: { text: string; source: "base" | "edit" }[];
  ops: WordOp[];
  dropped: WordOp[];
  reply: string;
  source: string;
  meta: PhaseMeta;
}

export interface FitToken {
  index?: number;
  text: string;
  source: "base" | "edit" | "glue";
  value?: number;
}

export interface FitResponse {
  tokens: FitToken[];
  ops: WordOp[];
  dropped: WordOp[];
  reply: string;
  source: string;
  meta: PhaseMeta;
}

/** Result of the (legacy) slot knapsack: chosen variant per slot. */
export interface SolverResult {
  selection: Record<string, string>; // slotId -> variantId
  totalChars: number;
  totalQuality: number;
  feasible: boolean;
}

// --- Wordspace edit-and-fit model ------------------------------------------
export interface WordToken {
  index: number;
  text: string;
  source: "base" | "edit";
  value: number;
}

export interface PlannedOp {
  op: "replace" | "insert" | "delete" | "move";
  index?: number;
  word?: string;
  from?: number;
  to?: number;
  span_original?: string;
  source_critic?: string;
  importance?: number;
}

export interface EditSummary {
  summary: string;
  source_critics?: string[];
  importance?: number;
}

/** Result of the word-level budget knapsack. */
export interface WordResult {
  keptIndices: number[];
  totalChars: number;
  totalValue: number;
  feasible: boolean;
}

// --- LangGraph pipeline -----------------------------------------------------
export interface PersonaConfig {
  persona: string;
  lens_prompt: string;
  knowledge?: string;
  focus_areas?: string[];
}

export interface ContextBundle {
  topic: string;
  company_name: string;
  user_blurb: string;
  documents: {
    name: string;
    text: string;
    page_count?: number | null;
    category?: string;
  }[];
  search_results: { query: string; answer: string; sources: unknown[] }[];
  consolidated_summary: string;
  status: string;
  gathered_at: number;
}

export interface GatherResponse {
  bundle: ContextBundle;
  meta: Record<string, unknown>;
}

export interface PipelineRunResponse {
  question: string;
  context_bundle: ContextBundle | null;
  personas: PersonaConfig[];
  draft: string;
  draft_source: string;
  critics: Critic[];
  edit_list: EditSummary[];
  planned_ops: PlannedOp[];
  dropped_ops: PlannedOp[];
  words: WordToken[];
  result: WordResult;
  final: string;
  stage_meta: Record<string, PhaseMeta | Record<string, unknown>>;
}

export interface AcceptResponse {
  ok: boolean;
  stored: {
    id: string;
    created_at: number;
    preference_pair: { chosen: string; rejected: string };
  };
  total_records: number;
}

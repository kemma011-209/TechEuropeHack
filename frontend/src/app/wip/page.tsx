"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ChatPane from "@/components/chat/ChatPane";
import WordspacePanel from "@/components/wordspace/WordspacePanel";
import { DEMO_DRAFT } from "@/lib/demo";
import type { WordToken } from "@/lib/types";

const MIN_RATIO = 0.25;
const MAX_RATIO = 0.75;

// Mirror backend/app/graph/nodes.py value weights so chat-edited words keep the
// same edit-protection in the budget solver as base text.
const EDIT_WORD_VALUE = 0.85;
const BASE_WORD_VALUE = 0.3;

function tokensToWordTokens(
  tokens: { text: string; source: string }[],
): WordToken[] {
  return tokens.map((t, i) => ({
    index: i,
    text: t.text,
    source: t.source === "edit" ? "edit" : "base",
    value: t.source === "edit" ? EDIT_WORD_VALUE : BASE_WORD_VALUE,
  }));
}

function seedWords(draft: string): WordToken[] {
  return draft
    .split(/\s+/)
    .filter(Boolean)
    .map((text, index) => ({
      index,
      text,
      source: "base" as const,
      value: BASE_WORD_VALUE,
    }));
}

export default function WipPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.5);

  // Shared wordspace state — the chat (left) edits it via Gemma ops, the
  // wordspace (right) renders + trims it, and clicking words adds refs.
  const [words, setWords] = useState<WordToken[]>(() => seedWords(DEMO_DRAFT));
  const [refs, setRefs] = useState<number[]>([]);

  const tokens = useMemo(
    () => words.map((w) => ({ text: w.text, source: w.source })),
    [words],
  );
  const applyTokens = useCallback(
    (toks: { text: string; source: string }[]) =>
      setWords(tokensToWordTokens(toks)),
    [],
  );
  const clearRefs = useCallback(() => setRefs([]), []);
  const toggleRef = useCallback((index: number) => {
    setRefs((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    container.classList.add("select-none");

    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      const next = (ev.clientX - rect.left) / rect.width;
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
    };
    const onUp = () => {
      container.classList.remove("select-none");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={containerRef} className="flex h-screen w-full overflow-hidden">
      {/* Left: chat (drives Gemma edits on the wordspace) */}
      <div className="relative min-w-0" style={{ flexBasis: `${ratio * 100}%` }}>
        <ChatPane
          wordspace={{
            tokens,
            refs,
            onApplyTokens: applyTokens,
            onClearRefs: clearRefs,
          }}
        />
      </div>

      {/* Draggable divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        className="group relative w-px shrink-0 cursor-col-resize bg-neutral-200"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        <div className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-neutral-300" />
      </div>

      {/* Right: wordspace */}
      <div
        className="relative min-w-0"
        style={{ flexBasis: `${(1 - ratio) * 100}%` }}
      >
        <WordspacePanel words={words} refs={refs} onToggleRef={toggleRef} />
      </div>
    </div>
  );
}

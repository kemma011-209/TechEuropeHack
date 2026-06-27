"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ChatPane from "@/components/chat/ChatPane";
import WordspacePanel from "@/components/wordspace/WordspacePanel";

const MIN_RATIO = 0.25;
const MAX_RATIO = 0.75;

export default function WipPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.5);

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
      {/* Left: chat */}
      <div className="relative min-w-0" style={{ flexBasis: `${ratio * 100}%` }}>
        <ChatPane />
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

      {/* Right: wordspace (what we'll need) */}
      <div
        className="relative min-w-0"
        style={{ flexBasis: `${(1 - ratio) * 100}%` }}
      >
        <WordspacePanel />
      </div>
    </div>
  );
}

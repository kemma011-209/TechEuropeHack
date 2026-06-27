"use client";

import { useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { WordOp } from "@/lib/types";

const INITIAL_SENTENCE =
  "Armature Labs connects siloed lab systems into one auditable data layer.";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  ops?: WordOp[];
}

function opLabel(op: WordOp): string {
  switch (op.op) {
    case "replace":
      return `replace #${op.index} -> "${op.word}"`;
    case "insert":
      return `insert #${op.index} -> "${op.word}"`;
    case "delete":
      return `delete #${op.index}`;
    case "move":
      return `move #${op.from} -> #${op.to}`;
  }
}

export default function WordspacePage() {
  const [topic, setTopic] = useState("");
  const [words, setWords] = useState<string[]>(INITIAL_SENTENCE.split(" "));
  const [generating, setGenerating] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);

  const [hovered, setHovered] = useState<number | null>(null);

  const assembled = useMemo(() => words.join(" "), [words]);
  const totalChars = assembled.length;

  async function generate() {
    setGenerating(true);
    const res = await api.generateSentence(topic);
    setWords(res.words);
    setMessages([]);
    setHovered(null);
    setGenerating(false);
  }

  async function send() {
    const message = chatInput.trim();
    if (!message || sending) return;
    setChatInput("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setSending(true);
    const res = await api.editWordspace(words, message);
    setWords(res.words);
    setMessages((m) => [
      ...m,
      { role: "assistant", text: res.reply, ops: res.ops },
    ]);
    setSending(false);
  }

  return (
    <div className="min-h-screen bg-white text-black font-mono">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">WORDSPACE</h1>
            <p className="mt-2 max-w-2xl text-sm text-black/60">
              Gemma writes a sentence; every word becomes a chip. Hover a word to
              see its character count. The chat can only change the sentence by
              calling wordspace operations - it never rewrites the text directly.
            </p>
          </div>
          <span className="shrink-0 bg-black px-2 py-1 text-xs font-semibold text-white">
            GEMMA
          </span>
        </div>

        {/* Generate controls */}
        <div className="mt-6 flex gap-3">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="optional topic"
            className="flex-1 border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
          <button
            onClick={generate}
            disabled={generating}
            className="bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {generating ? "Generating..." : "Generate sentence"}
          </button>
        </div>

        {/* Wordspace */}
        <div className="mt-8">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-black/50">
            <span>Wordspace</span>
            <span>
              {words.length} words | {totalChars} chars total
              {hovered !== null && words[hovered] !== undefined && (
                <span className="ml-2 text-black">
                  | &quot;{words[hovered]}&quot; = {words[hovered].length} chars
                </span>
              )}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 border border-black/15 p-4">
            {words.length === 0 && (
              <span className="text-sm text-black/40">
                (empty - generate a sentence)
              </span>
            )}
            {words.map((word, i) => (
              <span
                key={`${i}-${word}`}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                className={`relative cursor-default border px-2 py-1 text-sm ${
                  hovered === i ? "border-black bg-black/5" : "border-black/20"
                }`}
              >
                {hovered === i && (
                  <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black px-1.5 py-0.5 text-xs text-white">
                    {word.length} chars
                  </span>
                )}
                <span className="mr-1 text-[10px] text-black/30">{i}</span>
                {word}
              </span>
            ))}
          </div>
        </div>

        {/* Chat */}
        <div className="mt-8">
          <h2 className="text-xs uppercase tracking-wide text-black/50">
            Chat (edits via tooling)
          </h2>
          <div className="mt-3 space-y-3 border border-black/15 p-4">
            <div className="max-h-72 space-y-3 overflow-auto">
              {messages.length === 0 && (
                <p className="text-sm text-black/40">
                  Ask Gemma to change the sentence, e.g. &quot;make it punchier&quot;
                  or &quot;remove the last word&quot;.
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className="text-sm">
                  <span
                    className={
                      m.role === "user" ? "text-black/50" : "text-black/50"
                    }
                  >
                    {m.role === "user" ? "you" : "gemma"}:
                  </span>{" "}
                  <span>{m.text}</span>
                  {m.ops && m.ops.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.ops.map((op, j) => (
                        <span
                          key={j}
                          className="bg-black/[0.06] px-1.5 py-0.5 text-xs text-black/70"
                        >
                          {opLabel(op)}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.ops && m.ops.length === 0 && m.role === "assistant" && (
                    <span className="ml-1 text-xs text-black/30">
                      (no ops ran)
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3 border-t border-black/10 pt-3">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                placeholder="tell Gemma how to edit the wordspace"
                className="flex-1 border border-black/20 px-3 py-2 text-sm focus:border-black focus:outline-none"
              />
              <button
                onClick={send}
                disabled={sending}
                className="bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                {sending ? "..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

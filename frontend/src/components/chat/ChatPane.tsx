"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat, type ChatMessage } from "@/lib/chat";
import * as api from "@/lib/api";
import { useAutosizeTextarea } from "@/hooks/useAutosizeTextarea";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CornerDownLeft,
  Copy,
  Plus,
  Square,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
} from "lucide-react";

type Mode = "Ask" | "Act" | "Plan";
const MODES: Mode[] = ["Ask", "Act", "Plan"];

type Model = "Auto" | "Sonnet";

// Chars per second for the UI-side reveal.
const REVEAL_CPS = 550;
// How many trailing words fade in as the reveal advances. Must be large enough
// that a word finishes its fade before the window slides past it.
const FADE_WORDS = 8;

/**
 * Renders text with the most recently revealed tail WORDS fading in from ~10%
 * to full opacity. Each tail word is keyed by its absolute start offset so it
 * keeps its identity (and doesn't restart its animation) as the window slides
 * forward; once a word falls out of the window it joins the plain "settled" text.
 */
function AnimatedText({ text, animate }: { text: string; animate: boolean }) {
  if (!animate || text.length === 0) return <>{text}</>;

  // Offsets where each word starts; the fade window covers the last FADE_WORDS.
  const wordStarts: number[] = [];
  const wordRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(text))) wordStarts.push(m.index);

  const tailWords = Math.min(FADE_WORDS, wordStarts.length);
  const fadeStart =
    tailWords > 0 ? wordStarts[wordStarts.length - tailWords] : text.length;
  const settled = text.slice(0, fadeStart);

  // Split the tail into "word + trailing whitespace" chunks, each keyed by its
  // absolute start offset so its fade animation isn't restarted on re-render.
  const chunks: { key: number; value: string }[] = [];
  const chunkRe = /\S+\s*/g;
  let c: RegExpExecArray | null;
  while ((c = chunkRe.exec(text.slice(fadeStart)))) {
    chunks.push({ key: fadeStart + c.index, value: c[0] });
  }

  return (
    <>
      {settled}
      {chunks.map((ch) => (
        <span key={ch.key} className="letter-fade-in">
          {ch.value}
        </span>
      ))}
    </>
  );
}

function QuestionPill({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [faded, setFaded] = useState(false);

  // Fade the bottom (instead of scrolling) only when the message is taller than
  // the 5-line cap. Re-measures on width changes so wrapping is accounted for.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setFaded(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-pill group relative block w-full cursor-pointer text-left text-sm"
    >
      <span
        ref={textRef}
        className={`block max-h-[4lh] overflow-hidden whitespace-pre-wrap break-words ${
          faded ? "fade-bottom-mask" : ""
        }`}
      >
        {children}
      </span>
      <span className="pointer-events-none absolute bottom-1.5 right-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <CornerDownLeft className="h-4 w-4 text-neutral-400" strokeWidth={1.5} />
      </span>
    </button>
  );
}

function ChatInput({
  defaultValue = "",
  variant = "default",
  onSubmit,
  onStop,
  streaming = false,
}: {
  defaultValue?: string;
  variant?: "default" | "pill";
  onSubmit?: (text: string) => void;
  onStop?: () => void;
  streaming?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { onInput, resize } = useAutosizeTextarea(textareaRef);
  const [mode, setMode] = useState<Mode>("Ask");
  const [modeOpen, setModeOpen] = useState(false);
  const [model, setModel] = useState<Model>("Auto");
  const [modelOpen, setModelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) {
        setModeOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModeOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [modeOpen]);

  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelOpen]);

  const shell =
    variant === "pill"
      ? "rounded-lg border-[0.5px] border-[#e5e5e5] bg-[#f4f2ef]"
      : "rounded-2xl border border-neutral-200 bg-white";
  // The plus "notch" panel matches the input's top corner radius and tucks behind
  // it so the two read as one connected element.
  const notchRound = variant === "pill" ? "rounded-t-lg" : "rounded-t-2xl";
  const neutralPill =
    variant === "pill"
      ? "bg-neutral-200 text-neutral-700"
      : "bg-neutral-100 text-neutral-600";
  const popupShell =
    variant === "pill"
      ? "rounded-lg border border-neutral-200 bg-stone-50"
      : "rounded-lg border border-neutral-200 bg-white";
  const actPill =
    mode === "Plan"
      ? "bg-[#e6c4a6] text-[#7a3f22]"
      : mode === "Act"
        ? "bg-[#dbe7ea] text-[#3f5b67]"
        : neutralPill;

  // The send button tracks the active mode, mirroring the mode pill colors for
  // Act/Plan and falling back to the default purple for Ask.
  const sendPill =
    mode === "Plan"
      ? "bg-[#e6c4a6] hover:bg-[#dab48f]"
      : mode === "Act"
        ? "bg-[#dbe7ea] hover:bg-[#c5d8dd]"
        : "bg-[#7a6678] hover:bg-[#5f4f5d]";
  const sendIcon =
    mode === "Plan"
      ? "text-[#7a3f22]"
      : mode === "Act"
        ? "text-[#3f5b67]"
        : "text-white";
  // Plus button hover uses the Ask mode's default neutral background.
  const plusHover =
    variant === "pill" ? "hover:bg-neutral-200" : "hover:bg-neutral-100";

  const submit = () => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text || streaming) return;
    el.value = "";
    resize();
    onSubmit?.(text);
  };

  return (
    <div className="flex flex-col">
      {plusOpen ? (
        <div
          className={`relative z-0 -mb-3 px-3 pb-5 pt-2 ${notchRound} ${popupShell}`}
        >
          <div className="min-h-[16px]" />
        </div>
      ) : null}
      <div
        className={`relative z-10 flex min-h-[var(--composer-shell-height)] flex-col gap-2 p-3 shadow-xs ${shell}`}
      >
      <textarea
        ref={textareaRef}
        autoFocus={variant === "pill"}
        defaultValue={defaultValue}
        placeholder="Write a message..."
        rows={1}
        onInput={onInput}
        onKeyDown={(e) => {
          if (onSubmit && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="scrollbar-sleek max-h-[5lh] w-full resize-none overflow-y-auto bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative flex h-7 items-center" ref={modeRef}>
            <button
              type="button"
              onClick={() => setModeOpen((o) => !o)}
              className={`flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${actPill}`}
            >
              {mode}
              <ChevronDown
                className={`h-3.5 w-3.5 ${mode === "Ask" ? "text-neutral-400" : "opacity-60"}`}
                strokeWidth={1.5}
              />
            </button>
            {modeOpen ? (
              <div className={`absolute bottom-full left-0 z-50 mb-1 w-40 p-1 ${popupShell}`}>
                {MODES.map((m) => {
                  const active = m === mode;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMode(m);
                        setModeOpen(false);
                      }}
                      className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-0.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                    >
                      {m}
                      {active ? (
                        <Check
                          className="h-3.5 w-3.5 text-neutral-500"
                          strokeWidth={1.5}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="relative flex h-7 items-center" ref={modelRef}>
            <button
              type="button"
              onClick={() => setModelOpen((o) => !o)}
              className="font-dm-sans flex cursor-pointer items-center gap-1 py-1 text-xs font-medium"
            >
              {model === "Auto" ? (
                <span className="text-neutral-900">Auto</span>
              ) : (
                <>
                  <span className="text-neutral-900">Sonnet 4.6</span>
                  <span className="font-normal text-neutral-400">High</span>
                </>
              )}
              <ChevronDown
                className="h-3.5 w-3.5 text-neutral-400"
                strokeWidth={1.5}
              />
            </button>
            {modelOpen ? (
              <div className={`absolute bottom-full left-0 z-50 mb-1 w-56 p-1 ${popupShell}`}>
                <button
                  type="button"
                  onClick={() => {
                    setModel("Auto");
                    setModelOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-0.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                >
                  <span>Auto</span>
                  {model === "Auto" ? (
                    <Check
                      className="h-3.5 w-3.5 text-neutral-500"
                      strokeWidth={1.5}
                    />
                  ) : null}
                </button>
                <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
                  <span className="text-xs font-medium text-neutral-400">
                    Select a model
                  </span>
                  <span
                    className="rounded px-1 py-px text-[10px] font-medium text-white"
                    style={{ backgroundColor: "#6a7b8c" }}
                  >
                    Public
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setModel("Sonnet");
                    setModelOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-0.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                >
                  <span className="flex items-center gap-2">
                    <span>Sonnet 4.6</span>
                    <span className="font-normal text-neutral-400">High</span>
                  </span>
                  {model === "Sonnet" ? (
                    <Check
                      className="h-3.5 w-3.5 text-neutral-500"
                      strokeWidth={1.5}
                    />
                  ) : null}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPlusOpen((o) => !o)}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-neutral-500 transition-colors ${plusHover} ${plusOpen ? (variant === "pill" ? "bg-neutral-200" : "bg-neutral-100") : ""}`}
            aria-label="Add attachment"
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} />
          </button>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-100"
              aria-label="Stop generating"
            >
              <Square className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-colors ${sendPill}`}
              aria-label="Send message"
            >
              <ArrowUp className={`h-3 w-3 ${sendIcon}`} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function Exchange({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}

function AnswerActions() {
  const actions = [
    { Icon: Copy, label: "Copy" },
    { Icon: ThumbsUp, label: "Good response" },
    { Icon: ThumbsDown, label: "Bad response" },
    { Icon: RotateCw, label: "Regenerate" },
  ];
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      {actions.map(({ Icon, label }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-neutral-700"
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

function Answer({ content, animate }: { content: string; animate: boolean }) {
  const paragraphs = content.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i}>
          <AnimatedText
            text={para}
            animate={animate && i === paragraphs.length - 1}
          />
        </p>
      ))}
    </>
  );
}

// Element overrides so rendered markdown inherits the chat-test answer styling.
const mdComponents: Components = {
  p: (props) => <p {...props} />,
  strong: (props) => (
    <strong className="font-semibold text-neutral-800" {...props} />
  ),
  em: (props) => <em className="italic" {...props} />,
  a: (props) => (
    <a
      className="text-neutral-800 underline"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  ul: (props) => <ul className="list-disc space-y-1 pl-5" {...props} />,
  ol: (props) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
  hr: () => <hr className="my-4 border-neutral-200" />,
  h1: (props) => (
    <h1 className="text-lg font-semibold text-neutral-800" {...props} />
  ),
  h2: (props) => (
    <h2 className="text-base font-semibold text-neutral-800" {...props} />
  ),
  h3: (props) => <h3 className="font-semibold text-neutral-800" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="border-l-2 border-neutral-300 pl-3 text-neutral-500"
      {...props}
    />
  ),
  code: ({ className, ...props }) =>
    className?.includes("language-") ? (
      <code className={className} {...props} />
    ) : (
      <code
        className="rounded bg-neutral-100 px-1 py-0.5 text-[0.85em]"
        {...props}
      />
    ),
  pre: (props) => (
    <pre
      className="overflow-x-auto rounded-lg bg-neutral-100 p-3 text-[0.85em]"
      {...props}
    />
  ),
};

function MarkdownAnswer({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {content}
    </ReactMarkdown>
  );
}

const STICKY_QUESTIONS = true;

// When provided, the chat drives Gemma wordspace edits (console flow) instead of
// the generic streaming backend: each message is sent with the current tokens +
// any clicked-word refs, and the returned tokens replace the wordspace.
export type WordspaceChatBinding = {
  tokens: { text: string; source: "base" | "edit" }[];
  refs: number[];
  onApplyTokens: (tokens: { text: string; source: "base" | "edit" }[]) => void;
  onClearRefs: () => void;
};

export default function ChatPane({
  wordspace,
}: {
  wordspace?: WordspaceChatBinding;
} = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Buffer for incoming text that hasn't been revealed to the UI yet.
  const textBuffer = useRef("");
  const streamDone = useRef(false);
  const charDebt = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // While true, the stream "sticks" to the bottom. Scrolling up unsets it so the
  // user can read freely; submitting or pressing the down arrow re-engages it.
  const followRef = useRef(true);
  const lastScrollTop = useRef(0);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const st = el.scrollTop;
    const bottom = el.scrollHeight - st - el.clientHeight < 24;
    setAtBottom(bottom);
    // Unlock following only when the user actively scrolls UP. Never auto re-lock
    // from position; re-locking happens via the down arrow or a new prompt.
    if (st < lastScrollTop.current - 2) {
      followRef.current = false;
    }
    lastScrollTop.current = st;
  }, []);

  const jumpToBottom = useCallback(() => {
    followRef.current = true;
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    if (!editingId) return;
    function handlePointerDown(event: MouseEvent) {
      if (
        editorRef.current &&
        !editorRef.current.contains(event.target as Node)
      ) {
        setEditingId(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [editingId]);

  // Persistent reveal loop — the SOLE writer of assistant text. Tokens from the
  // backend are only ever buffered; this loop drains them at REVEAL_CPS. Running
  // for the whole component lifetime (rather than start/stop per turn) guarantees
  // the very first response is paced exactly like every subsequent one, so the
  // backend's raw stream can never flash through instantly.
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;

      if (textBuffer.current.length > 0) {
        charDebt.current += REVEAL_CPS * dt;
        const count = Math.min(
          Math.floor(charDebt.current),
          textBuffer.current.length,
        );
        if (count >= 1) {
          const take = textBuffer.current.slice(0, count);
          textBuffer.current = textBuffer.current.slice(count);
          charDebt.current -= count;
          setMessages((prev) => {
            const next = [...prev];
            const lastMsg = next[next.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              next[next.length - 1] = {
                ...lastMsg,
                content: lastMsg.content + take,
              };
            }
            return next;
          });
          if (followRef.current) scrollToBottom();
        }
      } else {
        // Idle: drop any banked debt so the next token doesn't dump in one frame.
        charDebt.current = 0;
        if (streamDone.current) {
          streamDone.current = false;
          setStreaming(false);
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrollToBottom]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (streaming) return;
      setError(null);
      setEditingId(null);

      // --- Wordspace (Gemma edit) flow: send current tokens + refs, apply the
      // returned tokens to the shared wordspace, reveal the reply text. ---
      if (wordspace) {
        const sortedRefs = [...wordspace.refs].sort((a, b) => a - b);
        const refNote =
          sortedRefs.length > 0
            ? ` [refs: ${sortedRefs
                .map((i) => wordspace.tokens[i]?.text)
                .filter(Boolean)
                .join(", ")}]`
            : "";

        textBuffer.current = "";
        streamDone.current = false;
        charDebt.current = 0;

        setMessages((prev) => [
          ...prev,
          { role: "user", content: text + refNote },
          { role: "assistant", content: "" },
        ]);
        setStreaming(true);
        followRef.current = true;
        scrollToBottom();

        void (async () => {
          try {
            const res = await api.chatEditWords(
              wordspace.tokens,
              text,
              sortedRefs,
            );
            wordspace.onApplyTokens(res.tokens);
            wordspace.onClearRefs();
            textBuffer.current = res.reply || "(no changes)";
            streamDone.current = true;
          } catch (err) {
            setError(String(err));
            setStreaming(false);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant" && last.content === "") {
                next.pop();
              }
              return next;
            });
          }
        })();
        return;
      }

      const userMessage: ChatMessage = { role: "user", content: text };
      const history = [...messages, userMessage];

      // Reset the reveal buffer for the new turn; the loop picks it up from here.
      textBuffer.current = "";
      streamDone.current = false;
      charDebt.current = 0;

      setMessages([...history, { role: "assistant", content: "" }]);
      setStreaming(true);
      followRef.current = true;
      scrollToBottom();

      const controller = new AbortController();
      abortRef.current = controller;

      void streamChat(
        history,
        {
          onToken: (token) => {
            // Buffer incoming text; the reveal loop is what writes it to the UI.
            textBuffer.current += token;
          },
          onDone: () => {
            streamDone.current = true;
          },
          onError: (err) => {
            textBuffer.current = "";
            streamDone.current = false;
            charDebt.current = 0;
            setError(err.message);
            setStreaming(false);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant" && last.content === "") {
                next.pop();
              }
              return next;
            });
          },
        },
        controller.signal,
      );
    },
    [messages, streaming, scrollToBottom, wordspace],
  );

  // Interrupt the in-flight stream. Aborts the fetch, stops the reveal loop, and
  // keeps whatever text was already revealed (dropping an empty placeholder).
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    textBuffer.current = "";
    streamDone.current = false;
    charDebt.current = 0;
    setStreaming(false);
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === "assistant" && last.content === "") {
        next.pop();
      }
      return next;
    });
  }, []);

  // Pair the flat [user, assistant, ...] array into question/answer exchanges.
  const exchanges: { id: string; question: string; answer: ChatMessage | null }[] =
    [];
  for (let i = 0; i < messages.length; i += 2) {
    const question = messages[i];
    const answer = messages[i + 1] ?? null;
    if (question?.role === "user") {
      exchanges.push({ id: String(i), question: question.content, answer });
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-stone-50">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-sleek absolute inset-0 flex flex-col overflow-y-auto [overflow-anchor:none] [will-change:scroll-position]"
      >
        <section className="px-4 sm:px-10 md:px-16 lg:px-22 pt-16 pb-8 flex flex-1 justify-center">
          <div className="text-sm w-full max-w-[640px] space-y-2 text-neutral-600">
            {exchanges.map(({ id, question, answer }, idx) => {
              const isLast = idx === exchanges.length - 1;
              const answerContent = answer?.content ?? "";
              const isStreamingThis = streaming && isLast;
              const showCaret = isStreamingThis && answerContent === "";
              return (
                <Exchange key={id}>
                  <div
                    className={
                      STICKY_QUESTIONS
                        ? "sticky top-0 z-30 bg-stone-50 pt-2"
                        : undefined
                    }
                  >
                    {editingId === id ? (
                      <div ref={editorRef}>
                        <ChatInput variant="pill" defaultValue={question} />
                      </div>
                    ) : (
                      <QuestionPill onClick={() => setEditingId(id)}>
                        {question}
                      </QuestionPill>
                    )}
                  </div>

                  <div className="group space-y-1.5 px-4">
                    {isStreamingThis ? (
                      <Answer content={answerContent} animate />
                    ) : (
                      <MarkdownAnswer content={answerContent} />
                    )}
                    {showCaret ? (
                      <span className="inline-block h-4 w-2 animate-pulse bg-neutral-400 align-middle" />
                    ) : null}
                    {!isStreamingThis ? <AnswerActions /> : null}
                  </div>
                </Exchange>
              );
            })}
          </div>
        </section>

        <div className="sticky bottom-0 z-40 flex justify-center bg-stone-50 px-4 pb-3">
          <div className="relative w-full max-w-[640px]">
            {!atBottom ? (
              <button
                type="button"
                onClick={jumpToBottom}
                className="absolute -top-12 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-neutral-200 bg-white shadow-xs"
                aria-label="Scroll down"
              >
                <ArrowDown
                  className="h-4 w-4 text-neutral-800"
                  strokeWidth={1.5}
                />
              </button>
            ) : null}
            {error ? (
              <p className="mb-2 text-center text-xs text-red-500">{error}</p>
            ) : null}
            <ChatInput
              onSubmit={handleSubmit}
              onStop={handleStop}
              streaming={streaming}
            />
            <p className="mt-2 text-center text-xs text-neutral-400">
              Responses may be inaccurate. Verify information before acting on
              them.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

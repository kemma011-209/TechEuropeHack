export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8787";

/**
 * POST messages to the backend and stream the assistant reply token by token.
 * The backend responds with Server-Sent Events: `data: <delta>` lines
 * terminated by `data: [DONE]`.
 */
export async function streamChat(
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { onToken, onDone, onError } = handlers;

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });

    if (!res.ok || !res.body) {
      let detail = `Request failed with status ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) detail = data.error;
      } catch {
        // non-JSON error body; keep the status-based message
      }
      throw new Error(detail);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");

        if (data === "") continue;
        if (data === "[DONE]") {
          onDone?.();
          return;
        }
        onToken(data);
      }
    }

    onDone?.();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

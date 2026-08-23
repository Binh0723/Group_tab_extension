// Parser for OpenAI-compatible SSE (/chat/completions with stream: true).

interface SseChunk {
  choices?: { delta?: { content?: string } }[];
}

export interface StreamHandlers {
  /** Fired once, when the first content delta arrives. */
  onFirstToken(): void;
  /** Fired on every content delta with the full accumulated text so far. */
  onDelta(accumulated: string): void;
}

/**
 * Consume an SSE response body, invoking handlers per content delta.
 * Returns the fully accumulated text.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamed = "";
  let firstTokenSeen = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by blank lines.
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as SseChunk;
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              handlers.onFirstToken();
            }
            streamed += delta;
            handlers.onDelta(streamed);
          }
        } catch {
          // Ignore malformed keep-alive lines.
        }
      }
    }
  }

  return streamed;
}

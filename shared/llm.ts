// Shared LLM transport — the single place in the codebase that talks to the
// provider API. Capabilities (tab grouping, chat, …) call into this module;
// none of them issue their own fetches. No prompts or business logic here.

import { loadStoredSettings, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./settings.js";
import type { ChatContentPart } from "./types.js";

/** Connection details for one API call. Stored settings act as the default. */
export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** A message in OpenAI chat-completions shape. */
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export interface StreamHandlers {
  /** Fired once, when the first content delta arrives. */
  onFirstToken(): void;
  /** Fired on every content delta with the full accumulated text so far. */
  onDelta(accumulated: string): void;
}

/** HTTP-level failure from the provider, keeping the raw response text. */
export class LlmHttpError extends Error {
  constructor(readonly status: number, readonly responseText: string) {
    const detail = responseText ? `: ${responseText.slice(0, 200)}` : "";
    super(`HTTP ${status}${detail}`);
    this.name = "LlmHttpError";
  }
}

/** Merge stored settings with per-call overrides; fail fast on a missing key. */
async function resolveConfig(overrides?: Partial<LlmConfig>): Promise<LlmConfig> {
  const stored = await loadStoredSettings();
  const config: LlmConfig = {
    apiKey: overrides?.apiKey ?? stored.apiKey ?? "",
    baseUrl: (overrides?.baseUrl ?? stored.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: overrides?.model ?? stored.model ?? DEFAULT_MODEL
  };
  if (!config.apiKey) {
    throw new Error("No API key set. Open Settings and add your key first.");
  }
  return config;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

async function postChatCompletion(
  config: LlmConfig,
  body: Record<string, unknown>
): Promise<Response> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new LlmHttpError(res.status, await res.text().catch(() => ""));
  }
  return res;
}

/** One-shot completion. `jsonMode` requests strict JSON output where supported. */
export async function complete(opts: {
  messages: LlmMessage[];
  jsonMode?: boolean;
  config?: Partial<LlmConfig>;
}): Promise<string> {
  const config = await resolveConfig(opts.config);
  const res = await postChatCompletion(config, {
    model: config.model,
    temperature: 0,
    ...(opts.jsonMode && { response_format: { type: "json_object" } }),
    messages: opts.messages
  });
  const data = (await res.json()) as ChatCompletionResponse;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");
  return content;
}

/** Streaming completion; returns the fully accumulated text. */
export async function completeStream(opts: {
  messages: LlmMessage[];
  handlers: StreamHandlers;
  config?: Partial<LlmConfig>;
}): Promise<string> {
  const config = await resolveConfig(opts.config);
  const res = await postChatCompletion(config, {
    model: config.model,
    messages: opts.messages,
    stream: true
  });
  if (!res.body) throw new Error("No response stream");
  return readSseStream(res.body, opts.handlers);
}

/** List model ids available under the given key. */
export async function listModels(
  config: Pick<LlmConfig, "apiKey" | "baseUrl">
): Promise<string[]> {
  const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` }
  });
  if (!res.ok) throw new LlmHttpError(res.status, await res.text().catch(() => ""));
  const data = (await res.json()) as { data?: unknown[]; models?: unknown[] };
  const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  const ids = items
    .map((m): string | undefined => {
      if (typeof m === "string") return m;
      const obj = m as { id?: string; name?: string } | null;
      return obj?.id || obj?.name;
    })
    .filter((s): s is string => Boolean(s));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** Cheap reachability + auth check against the /models endpoint. */
export async function testConnection(
  config: Pick<LlmConfig, "apiKey" | "baseUrl">
): Promise<void> {
  const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` }
  });
  if (!res.ok) throw new LlmHttpError(res.status, await res.text().catch(() => ""));
}

// --- SSE parsing -------------------------------------------------------------

interface SseChunk {
  choices?: { delta?: { content?: string } }[];
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

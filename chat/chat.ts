// Chat panel: transcript rendering, pinned-context prompt assembly, LLM streaming.

import { $, escapeHtml } from "../shared/dom.js";
import { switchTab } from "../shared/nav.js";
import type { ChatMessage, ExtensionSettings } from "../shared/types.js";
import { loadStoredSettings } from "../settings.js";
import { initContextTray, getPinnedContext, refreshPinnedTabs } from "./tray.js";
import {
  buildContextBlock,
  fetchPageContents,
  listTargetMetadata,
  resolveTargets
} from "./pageContext.js";
import { readSseStream } from "./stream.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const INPUT_MAX_HEIGHT_PX = 320;

const chatMessagesEl = $<HTMLElement>("chat-messages");
const chatInputEl = $<HTMLTextAreaElement>("chat-input");
const chatSendBtn = $<HTMLButtonElement>("chat-send-btn");
const chatStatusEl = $<HTMLElement>("chat-status");
const chatKeyWarning = $<HTMLElement>("chat-key-warning");

// In-memory conversation only — not persisted. Cleared when panel closes.
const chatHistory: ChatMessage[] = [
  {
    role: "system",
    content:
      "You are a helpful, concise assistant. Messages may include a 'Context' section describing the browser tab(s) the user is viewing, often with extracted page content. Use that context to answer questions like 'what is this?' — prefer it over guessing."
  }
];
let chatBusy = false;

function appendChatBubble(role: "user" | "assistant", content: string, isError = false): HTMLElement {
  const empty = chatMessagesEl.querySelector(".chat-empty");
  if (empty) empty.remove();
  const msg = document.createElement("div");
  msg.className = `chat-msg ${role}${isError ? " error" : ""}`;
  const roleEl = document.createElement("span");
  roleEl.className = "role";
  roleEl.textContent = role === "user" ? "You" : "AI";
  const body = document.createElement("span");
  body.innerHTML = escapeHtml(content);
  msg.appendChild(roleEl);
  msg.appendChild(body);
  chatMessagesEl.appendChild(msg);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  return body;
}

function setChatStatus(text: string | null, thinking = false): void {
  if (!text) {
    chatStatusEl.classList.add("hidden");
    chatStatusEl.textContent = "";
    chatStatusEl.classList.remove("thinking");
    return;
  }
  chatStatusEl.className = `status${thinking ? " thinking" : ""}`;
  chatStatusEl.textContent = text;
  chatStatusEl.classList.remove("hidden");
}

/** Show a transient status note over the chat (used by header actions). */
export function flashChatStatus(text: string, ms = 3000): void {
  setChatStatus(text);
  window.setTimeout(() => {
    // Only clear if nothing else took over the status line meanwhile.
    if (chatStatusEl.textContent === text) setChatStatus(null);
  }, ms);
}

async function getChatSettings(): Promise<ExtensionSettings | null> {
  const s = await loadStoredSettings();
  if (!s.apiKey) {
    chatKeyWarning.classList.remove("hidden");
    setChatStatus("No API key set. Open Settings to add one.");
    return null;
  }
  chatKeyWarning.classList.add("hidden");
  return s;
}

async function sendChat(): Promise<void> {
  if (chatBusy) return;
  const text = chatInputEl.value.trim();
  if (!text) return;

  const settings = await getChatSettings();
  if (!settings) return;

  chatBusy = true;
  chatSendBtn.disabled = true;
  chatInputEl.value = "";
  chatInputEl.style.height = "";

  // Build the outgoing user message. Pinned tabs (or the current tab when
  // nothing is pinned) are scraped via Firecrawl so the model sees real page
  // content; falls back to title/domain/url metadata if scraping is
  // unavailable or no Firecrawl key is configured.
  // Sync pins with the live tab state first (covers navigations that happened
  // while the panel was closed or before listeners were attached), then
  // snapshot. Pinned tabs (or the current tab when nothing is pinned) are
  // scraped via Firecrawl so the model sees real page content; falls back to
  // title/domain/url metadata if scraping is unavailable or no Firecrawl key
  // is configured.
  await refreshPinnedTabs().catch(() => {});
  const sentContext = getPinnedContext();
  let userContent = text;
  try {
    const targets = await resolveTargets(sentContext);
    if (targets.length > 0) {
      setChatStatus("Reading page...", true);
      const results = settings.firecrawlApiKey
        ? await fetchPageContents(targets, settings)
        : [];
      const ctx =
        results.length > 0 ? buildContextBlock(results) : listTargetMetadata(targets);
      userContent = `Context — browser tab(s) the user is viewing:\n${ctx}\n\n${text}`;
    }
  } catch {
    userContent =
      sentContext.length > 0
        ? `Context — open tabs the user pinned:\n${listTargetMetadata(sentContext)}\n\n${text}`
        : text;
  }

  chatHistory.push({ role: "user", content: userContent });
  appendChatBubble("user", text);
  setChatStatus("Thinking...", true);

  const baseUrl = (settings.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = settings.model || DEFAULT_MODEL;

  // Create the assistant bubble up front and stream tokens into it.
  const replyBody = appendChatBubble("assistant", "");
  const cursor = document.createElement("span");
  cursor.className = "chat-cursor";
  replyBody.appendChild(cursor);

  let streamed = "";
  let gotFirstToken = false;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: chatHistory.map((m) => ({ role: m.role, content: m.content })),
        stream: true
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${errText ? ": " + errText.slice(0, 200) : ""}`);
    }
    if (!res.body) throw new Error("No response stream");

    streamed = await readSseStream(res.body, {
      onFirstToken() {
        gotFirstToken = true;
        // Clear the "Thinking..." once first token arrives.
        setChatStatus(null);
      },
      onDelta(accumulated) {
        // Re-render up to the cursor.
        replyBody.innerHTML = escapeHtml(accumulated);
        replyBody.appendChild(cursor);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }
    });

    cursor.remove();
    const reply = streamed.trim() || "(no response)";
    chatHistory.push({ role: "assistant", content: reply });
    if (!gotFirstToken) setChatStatus(null);
  } catch (err) {
    cursor.remove();
    if (streamed) {
      // Partial reply already on screen — append the error below it.
      const note = document.createElement("span");
      note.className = "chat-msg assistant error";
      note.textContent = `Error: ${(err as Error).message || "Request failed"}`;
      chatMessagesEl.appendChild(note);
    } else {
      replyBody.innerHTML = escapeHtml(`Error: ${(err as Error).message || "Request failed"}`);
      replyBody.parentElement?.classList.add("error");
    }
    setChatStatus(null);
    // Roll back the user message so retries don't double-send context.
    chatHistory.pop();
  } finally {
    chatBusy = false;
    chatSendBtn.disabled = false;
    chatInputEl.focus();
  }
}

export function initChat(): void {
  chatSendBtn.addEventListener("click", sendChat);

  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  chatInputEl.addEventListener("input", () => {
    chatInputEl.style.height = "auto";
    chatInputEl.style.height = Math.min(chatInputEl.scrollHeight, INPUT_MAX_HEIGHT_PX) + "px";
  });

  document.getElementById("chat-warning-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchTab("settings");
  });

  initContextTray(() => chatInputEl.focus());
}

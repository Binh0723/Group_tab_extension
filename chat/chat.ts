// Chat panel: transcript rendering, tab/file context assembly, and LLM streaming.

import { $, escapeHtml } from "../shared/dom.js";
import { renderMarkdown } from "../shared/markdown.js";
import { switchTab } from "../shared/nav.js";
import { normalizeTab, type TabDescriptor } from "../shared/domain.js";
import type {
  ChatAttachment,
  ChatContentPart,
  ChatMessage,
  ExtensionSettings
} from "../shared/types.js";
import type { PageContent } from "../shared/pageContent.js";
import { loadStoredSettings } from "../settings.js";
import {
  addPendingAttachments,
  clearPendingAttachments,
  getPendingAttachments,
  getPinnedContext,
  refreshPinnedTabs,
  restorePendingAttachments,
  initContextTray
} from "./tray.js";
import { MAX_ATTACHMENTS, MAX_TEXT_CHARS, readAttachment } from "./attachments.js";
import { readSseStream } from "./stream.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const INPUT_MAX_HEIGHT_PX = 320;
const MAX_CONTEXT_TARGETS = 3;

const chatMessagesEl = $<HTMLElement>("chat-messages");
const chatInputEl = $<HTMLTextAreaElement>("chat-input");
const chatSendBtn = $<HTMLButtonElement>("chat-send-btn");
const chatStatusEl = $<HTMLElement>("chat-status");
const chatKeyWarning = $<HTMLElement>("chat-key-warning");
const chatUploadBtn = $<HTMLButtonElement>("chat-upload-btn");
const chatFileInput = $<HTMLInputElement>("chat-file-input");

// In-memory conversation only — not persisted. Cleared when panel closes.
const chatHistory: ChatMessage[] = [
  {
    role: "system",
    content:
      "You are a helpful, concise assistant. Messages may include a 'Context' section describing the browser tab(s) the user is viewing, often with extracted page content, plus attached text files or images. Use the provided context and attachments to answer questions like 'what is this?' — prefer them over guessing."
  }
];
let chatBusy = false;
let attachmentBusy = false;

function appendChatBubble(role: "user" | "assistant", content: string, isError = false): HTMLElement {
  const empty = chatMessagesEl.querySelector(".chat-empty");
  if (empty) empty.remove();
  const msg = document.createElement("div");
  msg.className = `chat-msg ${role}${isError ? " error" : ""}`;
  const roleEl = document.createElement("span");
  roleEl.className = "role";
  roleEl.textContent = role === "user" ? "You" : "AI";
  const body = document.createElement("div");
  // Assistant messages are markdown; user text and our own errors stay literal.
  body.innerHTML = role === "assistant" && !isError ? renderMarkdown(content) : escapeHtml(content);
  msg.appendChild(roleEl);
  msg.appendChild(body);
  chatMessagesEl.appendChild(msg);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  return body;
}

/** Render the user's text and the files included with that message. */
function appendUserBubble(text: string, attachments: ChatAttachment[]): void {
  const body = appendChatBubble("user", text || (attachments.length > 0 ? "Attached files" : ""));
  if (attachments.length === 0) return;

  const list = document.createElement("span");
  list.className = "chat-message-attachments";
  for (const attachment of attachments) {
    const item = document.createElement("span");
    item.className = "chat-message-attachment";

    if (attachment.kind === "image" && attachment.dataUrl) {
      const img = document.createElement("img");
      img.src = attachment.dataUrl;
      img.alt = attachment.name;
      img.onerror = () => img.remove();
      item.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "attachment-icon";
      icon.textContent = "▤";
      icon.setAttribute("aria-hidden", "true");
      item.appendChild(icon);
    }

    const name = document.createElement("span");
    name.textContent = attachment.name;
    name.title = attachment.name;
    item.appendChild(name);
    list.appendChild(item);
  }
  body.appendChild(list);
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

interface ScrapeResponse {
  ok: boolean;
  content?: PageContent;
  error?: string;
}

/** Ask the service worker to scrape a tab locally. Returns null on any failure. */
async function scrapeTabContent(tabId: number): Promise<PageContent | null> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "SCRAPE_TAB", tabId })) as ScrapeResponse;
    return res && res.ok && res.content ? res.content : null;
  } catch {
    return null;
  }
}

/** Format one target tab as LLM context, with page content when scraping succeeded. */
function formatTabContext(tab: TabDescriptor, page: PageContent | null): string {
  const lines: string[] = [`### ${tab.title} (${tab.domain})\n${tab.url}`];
  if (!page) {
    lines.push("(page content unavailable)");
    return lines.join("\n");
  }
  if (page.description) lines.push(`Description: ${page.description}`);
  if (page.headings.length > 0) lines.push(`Headings: ${page.headings.join(" › ")}`);
  lines.push(page.text || "(no readable text extracted)");
  return lines.join("\n");
}

/** Build the text portion shared by text-only and multimodal requests. */
function buildUserContent(
  text: string,
  tabContext: string,
  attachments: ChatAttachment[],
  includeImages: boolean
): ChatMessage["content"] {
  const sections: string[] = [];
  if (tabContext) {
    sections.push(`Context — browser tab(s) the user is viewing:\n\n${tabContext}`);
  }

  if (attachments.length > 0) {
    const fileSections = attachments.map((attachment) => {
      if (attachment.kind === "text") {
        const truncatedNote = attachment.truncated ? ` (truncated to ${MAX_TEXT_CHARS.toLocaleString()} characters)` : "";
        return `--- ${attachment.name}${truncatedNote} ---\n${attachment.text || "(empty file)"}`;
      }
      const omittedNote = includeImages
        ? ""
        : " — image omitted because the selected model does not support image input";
      return `[Image attachment: ${attachment.name}${omittedNote}]`;
    });
    sections.push(`Attached files:\n\n${fileSections.join("\n\n")}`);
  }

  if (text) sections.push(text);
  const textPart = sections.join("\n\n");
  if (!includeImages) return textPart;

  const imageParts: ChatContentPart[] = attachments
    .filter((attachment) => attachment.kind === "image" && attachment.dataUrl)
    .map((attachment) => ({
      type: "image_url" as const,
      image_url: { url: attachment.dataUrl! }
    }));

  return imageParts.length > 0
    ? [{ type: "text", text: textPart }, ...imageParts]
    : textPart;
}

function hasImages(attachments: ChatAttachment[]): boolean {
  return attachments.some((attachment) => attachment.kind === "image");
}

class ChatHttpError extends Error {
  constructor(readonly status: number, readonly responseText: string) {
    const detail = responseText ? `: ${responseText.slice(0, 200)}` : "";
    super(`HTTP ${status}${detail}`);
    this.name = "ChatHttpError";
  }
}

/** Send the current chat history to the configured OpenAI-compatible endpoint. */
async function requestChatCompletion(
  settings: ExtensionSettings,
  model: string
): Promise<Response> {
  const baseUrl = (settings.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: chatHistory.map((message) => ({
        role: message.role,
        content: message.content
      })),
      stream: true
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ChatHttpError(res.status, errText);
  }
  if (!res.body) throw new Error("No response stream");
  return res;
}

/** There is no portable vision-capability endpoint, so identify common API errors. */
function isVisionUnsupportedError(err: unknown): boolean {
  if (!(err instanceof ChatHttpError)) return false;
  if (err.status === 400 || err.status === 422) return true;
  return /(image|vision|multimodal|image_url|content.*(array|part|type)|\bunsupported\b|not support)/i.test(
    err.responseText
  );
}

async function handleFileSelection(): Promise<void> {
  const files = Array.from(chatFileInput.files || []);
  // Reset so selecting the same file again still fires a change event.
  chatFileInput.value = "";
  if (files.length === 0 || chatBusy || attachmentBusy) return;

  const available = MAX_ATTACHMENTS - getPendingAttachments().length;
  const errors: string[] = [];
  if (available <= 0) {
    flashChatStatus(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
    return;
  }

  const filesToRead = files.slice(0, available);
  if (files.length > available) {
    errors.push(`Only ${available} more file${available === 1 ? "" : "s"} can be attached.`);
  }

  attachmentBusy = true;
  chatUploadBtn.disabled = true;
  chatSendBtn.disabled = true;
  setChatStatus("Reading attachments...", true);

  const parsed: ChatAttachment[] = [];
  try {
    for (const file of filesToRead) {
      try {
        parsed.push(await readAttachment(file));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Could not read ${file.name}`);
      }
    }
    if (parsed.length > 0) addPendingAttachments(parsed);
  } finally {
    attachmentBusy = false;
    chatUploadBtn.disabled = chatBusy;
    chatSendBtn.disabled = chatBusy;
  }

  if (errors.length > 0) {
    flashChatStatus(errors.join(" "), 6000);
  } else {
    setChatStatus(null);
  }
  chatInputEl.focus();
}

/** Pinned tabs (capped) if any; otherwise the active tab of the current window. */
async function resolveTargets(pinned: TabDescriptor[]): Promise<TabDescriptor[]> {
  if (pinned.length > 0) return pinned.slice(0, MAX_CONTEXT_TARGETS);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const descriptor = active ? normalizeTab(active) : null;
  return descriptor ? [descriptor] : [];
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
  if (chatBusy || attachmentBusy) return;
  const text = chatInputEl.value.trim();
  const attachments = getPendingAttachments();
  if (!text && attachments.length === 0) return;

  const settings = await getChatSettings();
  if (!settings) return;

  chatBusy = true;
  chatSendBtn.disabled = true;
  chatUploadBtn.disabled = true;
  chatInputEl.value = "";
  chatInputEl.style.height = "";

  let userMessageAdded = false;
  let replyBody: HTMLElement | null = null;
  let cursor: HTMLElement | null = null;
  let streamed = "";
  let gotFirstToken = false;
  let imagesOmitted = false;

  try {
    // Build the outgoing user message. Sync pins with the live tab state first
    // (covers navigations that happened while the panel was closed), then scrape
    // the pinned tabs — or the current tab when nothing is pinned — locally via
    // chrome.scripting so the model sees real page content. Tabs that can't
    // be injected (chrome://, Web Store, PDFs) degrade to title/URL only.
    await refreshPinnedTabs().catch(() => {});
    const sentContext = getPinnedContext();
    const targets = await resolveTargets(sentContext);
    let tabContext = "";
    if (targets.length > 0) {
      const scraped = await Promise.all(targets.map((t) => scrapeTabContent(t.id)));
      tabContext = targets.map((t, i) => formatTabContext(t, scraped[i])).join("\n\n");
    }

    const userContent = buildUserContent(text, tabContext, attachments, true);
    chatHistory.push({ role: "user", content: userContent });
    userMessageAdded = true;
    appendUserBubble(text, attachments);
    setChatStatus("Thinking...", true);

    // Create the assistant bubble up front and stream tokens into it.
    const assistantBody = appendChatBubble("assistant", "");
    const cursorElement = document.createElement("span");
    cursorElement.className = "chat-cursor";
    assistantBody.appendChild(cursorElement);
    replyBody = assistantBody;
    cursor = cursorElement;

    const model = settings.model || DEFAULT_MODEL;
    let res: Response;
    try {
      res = await requestChatCompletion(settings, model);
    } catch (err) {
      // Vision support is not advertised consistently by compatible providers.
      // If the provider rejects image content, retry once with the image bytes
      // removed while retaining the filenames and all text/tab context.
      if (!hasImages(attachments) || !isVisionUnsupportedError(err)) throw err;
      imagesOmitted = true;
      const fallbackContent = buildUserContent(text, tabContext, attachments, false);
      const lastMessage = chatHistory[chatHistory.length - 1];
      if (lastMessage?.role === "user") lastMessage.content = fallbackContent;
      setChatStatus("Image input was rejected; retrying without images...", true);
      res = await requestChatCompletion(settings, model);
    }

    streamed = await readSseStream(res.body!, {
      onFirstToken() {
        gotFirstToken = true;
        // Clear the "Thinking..." once the first token arrives.
        setChatStatus(null);
      },
      onDelta(accumulated) {
        // Re-render up to the cursor. Partial markdown (e.g. "**bo" mid-stream)
        // shows literally until its closing marker arrives — acceptable.
        assistantBody.innerHTML = renderMarkdown(accumulated);
        assistantBody.appendChild(cursorElement);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }
    });

    cursorElement.remove();
    const reply = streamed.trim() || "(no response)";
    chatHistory.push({ role: "assistant", content: reply });
    clearPendingAttachments();
    if (!gotFirstToken) setChatStatus(null);
    if (imagesOmitted) {
      flashChatStatus("Images were omitted because the provider rejected image input.", 5000);
    }
  } catch (err) {
    cursor?.remove();
    const errorMessage = err instanceof Error ? err.message : "Request failed";
    if (streamed && replyBody) {
      // Partial reply already on screen — append the error below it.
      const note = document.createElement("span");
      note.className = "chat-msg assistant error";
      note.textContent = `Error: ${errorMessage}`;
      chatMessagesEl.appendChild(note);
    } else if (replyBody) {
      replyBody.innerHTML = escapeHtml(`Error: ${errorMessage}`);
      replyBody.parentElement?.classList.add("error");
    }
    setChatStatus(null);
    // Roll back the user message so retries don't double-send context.
    if (userMessageAdded) chatHistory.pop();
    // A failed request is not a completed send; keep the files available for retry.
    if (attachments.length > 0) restorePendingAttachments(attachments);
  } finally {
    chatBusy = false;
    chatSendBtn.disabled = attachmentBusy;
    chatUploadBtn.disabled = false;
    chatInputEl.focus();
  }
}

export function initChat(): void {
  chatSendBtn.addEventListener("click", sendChat);

  chatUploadBtn.addEventListener("click", () => {
    if (!chatBusy && !attachmentBusy) chatFileInput.click();
  });
  chatFileInput.addEventListener("change", () => {
    void handleFileSelection();
  });

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

// AI Tab Grouper — side panel UI (TypeScript)
// Compiled to popup.js by `npm run build` (tsc).

const COLOR_HEX: Record<string, string> = {
  grey: "#9aa0a6",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#ff63b8",
  purple: "#a142f4",
  cyan: "#24c1e0",
  orange: "#fa903e"
};

/** A non-null element helper that throws if the id is missing from the DOM. */
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

type SettingsResponse = Partial<{
  apiKey: string;
  baseUrl: string;
  model: string;
}>;

interface GroupResultMessage {
  ok: boolean;
  groups?: { name: string; color: string; count: number }[];
  tabCount?: number;
  message?: string;
  error?: string;
}

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));
const panels = Array.from(document.querySelectorAll<HTMLElement>(".panel"));

const apiKeyEl = $<HTMLInputElement>("apiKey");
const baseUrlEl = $<HTMLInputElement>("baseUrl");
const modelEl = $<HTMLInputElement>("model");
const modelsList = $<HTMLDataListElement>("models-list");
const saveBtn = $<HTMLButtonElement>("save-btn");
const testBtn = $<HTMLButtonElement>("test-btn");
const loadModelsBtn = $<HTMLButtonElement>("load-models-btn");
const settingsStatusEl = $<HTMLElement>("settings-status");

const groupBtn = $<HTMLButtonElement>("group-btn");
const actionStatusEl = $<HTMLElement>("action-status");
const groupList = $<HTMLUListElement>("group-list");
const keyWarning = $<HTMLElement>("key-warning");

function switchTab(name: string): void {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle("hidden", p.id !== name));
}

tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab as string)));
document.getElementById("warning-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  switchTab("settings");
});

function showStatus(el: HTMLElement, text: string, ok: boolean): void {
  el.className = `status ${ok ? "success" : "error"}`;
  el.textContent = text;
}

function currentBaseUrl(): string {
  return (baseUrlEl.value.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
}

async function loadModels(): Promise<void> {
  const apiKey = apiKeyEl.value.trim();
  if (!apiKey) {
    showStatus(settingsStatusEl, "Paste your API key first.", false);
    return;
  }
  loadModelsBtn.disabled = true;
  showStatus(settingsStatusEl, "Fetching models...", true);
  try {
    const res = await fetch(`${currentBaseUrl()}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) {
      showStatus(settingsStatusEl, `Failed to list models (${res.status}). Check key and base URL.`, false);
      return;
    }
    const data = (await res.json()) as { data?: unknown[]; models?: unknown[] };
    const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const ids = items
      .map((m): string | undefined => {
        if (typeof m === "string") return m;
        const obj = m as { id?: string; name?: string } | null;
        return obj?.id || obj?.name;
      })
      .filter((s): s is string => Boolean(s))
      .sort((a, b) => a.localeCompare(b));
    modelsList.innerHTML = "";
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      modelsList.appendChild(opt);
    }
    if (ids.length === 0) {
      showStatus(settingsStatusEl, "No models returned — you can still type a model name manually.", true);
    } else {
      showStatus(settingsStatusEl, `Loaded ${ids.length} models. Pick one or type your own.`, true);
    }
  } catch (err) {
    showStatus(settingsStatusEl, `Failed to list models: ${(err as Error).message}`, false);
  }
  loadModelsBtn.disabled = false;
}

async function loadSettings(): Promise<void> {
  const { apiKey, baseUrl, model } = (await chrome.storage.local.get([
    "apiKey",
    "baseUrl",
    "model"
  ])) as SettingsResponse;
  apiKeyEl.value = apiKey || "";
  baseUrlEl.value = baseUrl || "https://api.openai.com/v1";
  modelEl.value = model || "gpt-4o-mini";
  if (!apiKey) keyWarning.classList.remove("hidden");
  else keyWarning.classList.add("hidden");
  if (apiKey) loadModels();
}

saveBtn.addEventListener("click", async () => {
  const apiKey = apiKeyEl.value.trim();
  const baseUrl = currentBaseUrl();
  const model = modelEl.value.trim();
  if (!apiKey) {
    showStatus(settingsStatusEl, "API key is required.", false);
    return;
  }
  if (!model) {
    showStatus(settingsStatusEl, "Model is required.", false);
    return;
  }
  try {
    new URL(baseUrl);
  } catch {
    showStatus(settingsStatusEl, "Base URL is not a valid URL.", false);
    return;
  }
  await chrome.storage.local.set({ apiKey, baseUrl, model });
  keyWarning.classList.add("hidden");
  showStatus(settingsStatusEl, "Settings saved.", true);
});

testBtn.addEventListener("click", async () => {
  const apiKey = apiKeyEl.value.trim();
  const baseUrl = currentBaseUrl();
  if (!apiKey) {
    showStatus(settingsStatusEl, "Enter API key first.", false);
    return;
  }
  testBtn.disabled = true;
  showStatus(settingsStatusEl, "Testing...", true);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (res.ok) showStatus(settingsStatusEl, "Connection OK.", true);
    else showStatus(settingsStatusEl, `Connection failed (${res.status}). Check key, URL, and model.`, false);
  } catch (err) {
    showStatus(settingsStatusEl, `Connection failed: ${(err as Error).message}`, false);
  }
  testBtn.disabled = false;
});

loadModelsBtn.addEventListener("click", loadModels);

groupBtn.addEventListener("click", async () => {
  groupBtn.disabled = true;
  actionStatusEl.className = "status";
  actionStatusEl.textContent = "Analyzing tabs...";
  actionStatusEl.classList.remove("hidden");
  groupList.classList.add("hidden");
  groupList.innerHTML = "";

  let response: GroupResultMessage;
  try {
    response = (await chrome.runtime.sendMessage({ type: "GROUP_TABS" })) as GroupResultMessage;
  } catch {
    response = { ok: false, error: "Extension reloaded. Try again." };
  }

  if (!response.ok) {
    actionStatusEl.className = "status error";
    actionStatusEl.textContent = response.error || "Unknown error";
  } else if (!response.groups || response.groups.length === 0) {
    actionStatusEl.className = "status success";
    actionStatusEl.textContent = response.message || "No groupable tabs found.";
  } else {
    actionStatusEl.className = "status success";
    actionStatusEl.textContent = `Grouped ${response.tabCount} tabs into ${response.groups.length} groups.`;
    for (const g of response.groups) {
      const li = document.createElement("li");
      const left = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = COLOR_HEX[g.color] || "#9aa0a6";
      left.appendChild(dot);
      left.appendChild(document.createTextNode(g.name));
      const count = document.createElement("span");
      count.textContent = String(g.count);
      count.style.color = "#6b7280";
      li.appendChild(left);
      li.appendChild(count);
      groupList.appendChild(li);
    }
    groupList.classList.remove("hidden");
  }
  groupBtn.disabled = false;
});

// ---------- Chat ----------
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const chatMessagesEl = $<HTMLElement>("chat-messages");
const chatInputEl = $<HTMLTextAreaElement>("chat-input");
const chatSendBtn = $<HTMLButtonElement>("chat-send-btn");
const chatStatusEl = $<HTMLElement>("chat-status");
const chatKeyWarning = $<HTMLElement>("chat-key-warning");
const chatContextBtn = $<HTMLButtonElement>("chat-context-btn");
const chatContextMenu = $<HTMLElement>("chat-context-menu");
const chatContextSearch = $<HTMLInputElement>("chat-context-search");
const chatContextList = $<HTMLUListElement>("chat-context-list");
const chatContextTray = $<HTMLElement>("chat-context-tray");

// Pinned tab contexts for the next send. Each entry is privacy-safe:
// title, domain, and origin+path (query strings/fragments stripped).
interface PinnedTab {
  id: number;
  title: string;
  domain: string;
  url: string;
  favIconUrl?: string;
}
const pinnedContext: PinnedTab[] = [];
let contextMenuOpen = false;

// In-memory conversation only — not persisted. Cleared when panel closes.
const chatHistory: ChatMessage[] = [
  { role: "system", content: "You are a helpful, concise assistant." }
];
let chatBusy = false;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

async function getChatSettings(): Promise<SettingsResponse | null> {
  const s = (await chrome.storage.local.get(["apiKey", "baseUrl", "model"])) as SettingsResponse;
  if (!s.apiKey) {
    chatKeyWarning.classList.remove("hidden");
    setChatStatus("No API key set. Open Settings to add one.");
    return null;
  }
  chatKeyWarning.classList.add("hidden");
  return s;
}

// ---------- Context (pinned tabs) ----------
const CHAT_TWO_PART_TLDS = new Set([
  "co.uk", "co.jp", "co.kr", "com.au", "com.br", "com.cn", "com.hk",
  "com.sg", "com.tw", "org.uk", "ac.uk", "gov.uk", "ne.jp", "or.jp"
]);

function chatRegistrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (CHAT_TWO_PART_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** Extract a privacy-safe descriptor from a Chrome tab. Returns null for non-http(s) tabs. */
function normalizeTab(tab: chrome.tabs.Tab): PinnedTab | null {
  if (!tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const base = `${url.origin}${url.pathname}`;
    return {
      id: tab.id as number,
      title: (tab.title || url.hostname || "Untitled").slice(0, 120),
      domain: chatRegistrableDomain(url.hostname),
      url: base.slice(0, 200),
      favIconUrl: tab.favIconUrl
    };
  } catch {
    return null;
  }
}

function renderContextTray(): void {
  chatContextTray.innerHTML = "";
  if (pinnedContext.length === 0) {
    chatContextTray.classList.add("hidden");
    return;
  }
  chatContextTray.classList.remove("hidden");
  for (const tab of pinnedContext) {
    const chip = document.createElement("span");
    chip.className = "chat-chip";
    if (tab.favIconUrl) {
      const img = document.createElement("img");
      img.src = tab.favIconUrl;
      img.alt = "";
      img.onerror = () => img.remove();
      chip.appendChild(img);
    }
    const title = document.createElement("span");
    title.className = "chip-title";
    title.textContent = tab.title;
    const dom = document.createElement("span");
    dom.className = "chip-domain";
    dom.textContent = tab.domain;
    const remove = document.createElement("button");
    remove.className = "chip-remove";
    remove.textContent = "×";
    remove.title = "Remove context";
    remove.addEventListener("click", () => {
      const i = pinnedContext.findIndex((p) => p.id === tab.id);
      if (i !== -1) pinnedContext.splice(i, 1);
      renderContextTray();
    });
    chip.appendChild(title);
    chip.appendChild(dom);
    chip.appendChild(remove);
    chatContextTray.appendChild(chip);
  }
}

function isPinned(id: number): boolean {
  return pinnedContext.some((p) => p.id === id);
}

function renderContextList(tabs: PinnedTab[], currentId?: number): void {
  chatContextList.innerHTML = "";
  if (tabs.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No matching tabs";
    chatContextList.appendChild(li);
    return;
  }
  for (const tab of tabs) {
    const li = document.createElement("li");
    if (tab.id === currentId) li.classList.add("current");
    if (isPinned(tab.id)) li.classList.add("added");
    if (tab.favIconUrl) {
      const img = document.createElement("img");
      img.src = tab.favIconUrl;
      img.alt = "";
      img.onerror = () => img.remove();
      li.appendChild(img);
    }
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;
    const dom = document.createElement("span");
    dom.className = "tab-domain";
    dom.textContent = tab.domain;
    li.appendChild(title);
    li.appendChild(dom);
    if (!isPinned(tab.id)) {
      li.addEventListener("click", () => {
        pinnedContext.push(tab);
        renderContextTray();
        renderContextList(tabs, currentId);
        chatInputEl.focus();
      });
    }
    chatContextList.appendChild(li);
  }
}

let allContextTabs: PinnedTab[] = [];
let currentTabId: number | undefined;

async function openContextMenu(): Promise<void> {
  contextMenuOpen = true;
  chatContextMenu.classList.remove("hidden");
  chatContextBtn.classList.add("active");
  chatContextSearch.value = "";
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = active?.id;
  allContextTabs = (await chrome.tabs.query({}))
    .map(normalizeTab)
    .filter((t): t is PinnedTab => t !== null);
  // Current tab first, then the rest.
  if (currentTabId != null) {
    const cur = allContextTabs.find((t) => t.id === currentTabId);
    if (cur) {
      allContextTabs = allContextTabs.filter((t) => t.id !== currentTabId);
      allContextTabs.unshift(cur);
    }
  }
  renderContextList(allContextTabs, currentTabId);
  chatContextSearch.focus();
}

function closeContextMenu(): void {
  contextMenuOpen = false;
  chatContextMenu.classList.add("hidden");
  chatContextBtn.classList.remove("active");
}

chatContextBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (contextMenuOpen) closeContextMenu();
  else await openContextMenu();
});

chatContextSearch.addEventListener("input", () => {
  const q = chatContextSearch.value.trim().toLowerCase();
  const filtered = q
    ? allContextTabs.filter(
        (t) => t.title.toLowerCase().includes(q) || t.domain.toLowerCase().includes(q)
      )
    : allContextTabs;
  renderContextList(filtered, currentTabId);
});

document.addEventListener("click", (e) => {
  if (!contextMenuOpen) return;
  if (chatContextMenu.contains(e.target as Node) || chatContextBtn.contains(e.target as Node))
    return;
  closeContextMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && contextMenuOpen) closeContextMenu();
});

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

  // Build the outgoing user message, prepending any pinned tab context.
  let userContent = text;
  if (pinnedContext.length > 0) {
    const ctx = pinnedContext
      .map((t) => `- [${t.title}] (${t.domain}) ${t.url}`)
      .join("\n");
    userContent = `Context — open tabs the user pinned:\n${ctx}\n\n${text}`;
  }
  const sentContext = pinnedContext.slice();
  pinnedContext.length = 0;
  renderContextTray();

  chatHistory.push({ role: "user", content: userContent });
  appendChatBubble("user", text);
  setChatStatus("Thinking...", true);

  const baseUrl = (settings.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = settings.model || "gpt-4o-mini";

  // Create the assistant bubble up front and stream tokens into it.
  const replyBody = appendChatBubble("assistant", "");
  const cursor = document.createElement("span");
  cursor.className = "chat-cursor";
  replyBody.appendChild(cursor);

  let streamed = "";

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

    // Clear the "Thinking..." once first token arrives.
    let firstToken = true;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
            const json = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              if (firstToken) {
                firstToken = false;
                setChatStatus(null);
              }
              streamed += delta;
              // Re-render up to the cursor.
              replyBody.innerHTML = escapeHtml(streamed);
              replyBody.appendChild(cursor);
              chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
            }
          } catch {
            // Ignore malformed keep-alive lines.
          }
        }
      }
    }

    cursor.remove();
    const reply = streamed.trim() || "(no response)";
    chatHistory.push({ role: "assistant", content: reply });
    if (firstToken) setChatStatus(null);
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
    // Restore the pinned context so the user can retry without re-adding tabs.
    pinnedContext.push(...sentContext);
    renderContextTray();
  } finally {
    chatBusy = false;
    chatSendBtn.disabled = false;
    chatInputEl.focus();
  }
}

chatSendBtn.addEventListener("click", sendChat);
chatInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
chatInputEl.addEventListener("input", () => {
  chatInputEl.style.height = "auto";
  chatInputEl.style.height = Math.min(chatInputEl.scrollHeight, 120) + "px";
});
document.getElementById("chat-warning-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  switchTab("settings");
});

loadSettings();

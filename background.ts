// AI Tab Grouper — background service worker (TypeScript)
// Compiled to background.js by `npm run build` (tsc).

const COLORS = [
  "grey", "blue", "red", "yellow", "green",
  "pink", "purple", "cyan", "orange"
] as const;
type TabColor = (typeof COLORS)[number];

const TWO_PART_TLDS = new Set<string>([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "or.jp", "ne.jp",
  "com.br", "co.nz", "co.in", "co.za"
]);

const MAX_GROUPS = 8;
const BATCH_SIZE = 40;

interface Settings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULTS: Settings = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini"
};

interface TabInfo {
  id: number;
  title: string;
  domain: string;
  url: string;
}

/** Group as returned by the LLM. */
interface ModelGroup {
  name: string;
  color?: string;
  tabIds: number[];
}

/** Group summary returned to the UI. */
interface CreatedGroup {
  name: string;
  color: TabColor;
  count: number;
}

type GroupResult = {
  groups: CreatedGroup[];
  tabCount: number;
  message?: string;
};

async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["apiKey", "baseUrl", "model"]);
  return { ...DEFAULTS, ...stored };
}

/** Reduce a hostname to its registrable domain (e.g. www.mail.google.com → google.com). */
function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** Extract a minimal, privacy-safe descriptor from a Chrome tab. Returns null for non-http(s) tabs. */
function extractTabInfo(tab: chrome.tabs.Tab): TabInfo | null {
  if (!tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const base = `${url.origin}${url.pathname}`;
    return {
      id: tab.id as number,
      title: (tab.title || "").slice(0, 120),
      domain: registrableDomain(url.hostname),
      url: base.slice(0, 200)
    };
  } catch {
    return null;
  }
}

const PROMPT = `You are an expert browser tab organizer. Your task is to categorize a JSON list of open browser tabs into logical groups. Each tab contains an id, page title, domain, and url (origin + path only; query strings and fragments are stripped).

### Rules & Guidelines
1. **Group Count:** Use **at most ${MAX_GROUPS}** groups. Merge small or niche topics into broader, sensible categories.
2. **Domain & Path Separation:** 
   - Separate tabs from the **same domain** into different groups if they represent distinct activities or workspaces (e.g., github.com/org-a vs. github.com/org-b, mail.google.com/mail vs. mail.google.com/chat).
   - Keep tabs on the **same domain** together if paths represent different views or items within a single ongoing activity (e.g., multiple pages in the same Notion workspace or several PRs in the same repository).
3. **Signal Combination:** Use **page titles** primarily for topic identification, and **URL paths** to disambiguate and separate tabs within the same domain.
4. **Naming Convention:** Group names must be concise (**1–2 words**) and accurately reflect the purpose of the tabs.
5. **Color Assignment:** Assign each group a distinct color chosen **only** from this exact list: ${COLORS.join(", ")}. Do not use any colors outside this list.
6. **Completeness & Integrity:** 
   - Every input tab id must appear **exactly once**. 
   - Do not invent, omit, or duplicate any tab IDs.

### Output Format
Return **ONLY** valid raw JSON in the exact shape below. Do **not** wrap the output in markdown code blocks (e.g. no \`\`\`json), and do **not** include any extra text or explanation.

{"groups":[{"name":"Group Name","color":"blue","tabIds":[1,2]}]}`;

/** Defensively extract + validate the groups array from a raw model response. */
function parseGroups(raw: string): ModelGroup[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model response contained no JSON object");
  const parsed = JSON.parse(text.slice(start, end + 1)) as { groups?: unknown };
  if (!parsed || !Array.isArray(parsed.groups)) throw new Error("Model response missing 'groups' array");
  return parsed.groups as ModelGroup[];
}

/** Call an OpenAI-compatible /chat/completions endpoint with a batch of tabs. */
async function callLLM(settings: Settings, tabs: TabInfo[]): Promise<ModelGroup[]> {
  const body = {
    model: settings.model,
    temperature: 0,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system" as const, content: PROMPT },
      {
        role: "user" as const,
        content: JSON.stringify(tabs.map(({ id, title, domain, url }) => ({ id, title, domain, url })))
      }
    ]
  };
  const res = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");
  return parseGroups(content);
}

interface MergedGroup {
  name: string;
  color: TabColor | null;
  tabIds: number[];
}

/** Main orchestrator: query tabs, batch them through the LLM, and create Chrome tab groups. */
async function groupTabs(): Promise<GroupResult> {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("No API key set. Open Settings and add your key first.");
  }

  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const tabs = allTabs.map(extractTabInfo).filter((t): t is TabInfo => t !== null);
  if (tabs.length === 0) {
    return { groups: [], tabCount: 0, message: "No groupable tabs in this window." };
  }

  const tabIds = tabs.map((t) => t.id);
  await chrome.tabs.ungroup(tabIds).catch(() => {});

  const groupsByName = new Map<string, MergedGroup>();
  for (let i = 0; i < tabs.length; i += BATCH_SIZE) {
    const batch = tabs.slice(i, i + BATCH_SIZE);
    const modelGroups = await callLLM(settings, batch);
    const validIds = new Set(batch.map((t) => t.id));
    for (const g of modelGroups) {
      if (!g || typeof g.name !== "string" || !Array.isArray(g.tabIds)) continue;
      const name = g.name.trim().slice(0, 24);
      const color = typeof g.color === "string" && (COLORS as readonly string[]).includes(g.color)
        ? (g.color as TabColor)
        : null;
      if (!groupsByName.has(name)) groupsByName.set(name, { name, color, tabIds: [] });
      const entry = groupsByName.get(name)!;
      if (!entry.color && color) entry.color = color;
      for (const id of g.tabIds) {
        if (validIds.has(id)) entry.tabIds.push(id);
      }
    }
  }

  const created: CreatedGroup[] = [];
  let colorIdx = 0;
  for (const entry of groupsByName.values()) {
    const unique = [...new Set(entry.tabIds)];
    if (unique.length === 0) continue;
    const color: TabColor = entry.color ?? COLORS[colorIdx++ % COLORS.length];
    const groupId = await chrome.tabs.group({ tabIds: unique });
    await chrome.tabGroups.update(groupId, { title: entry.name, color });
    created.push({ name: entry.name, color, count: unique.length });
  }

  if (created.length > MAX_GROUPS) {
    created.sort((a, b) => b.count - a.count);
  }

  return { groups: created, tabCount: tabs.length };
}

// Open the side panel when the toolbar icon is clicked.
// Guard in case the sidePanel API isn't available (older Chrome or permission not yet loaded).
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error("sidePanel.setPanelBehavior failed:", err));
}

chrome.runtime.onMessage.addListener(
  (msg: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    if (typeof msg !== "object" || msg === null || (msg as { type?: string }).type !== "GROUP_TABS") {
      return false;
    }
    groupTabs()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the sendResponse channel open across the async call
  }
);

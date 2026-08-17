const COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "or.jp", "ne.jp",
  "com.br", "co.nz", "co.in", "co.za"
]);
const MAX_GROUPS = 8;
const BATCH_SIZE = 40;

const DEFAULTS = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini"
};

async function getSettings() {
  const stored = await chrome.storage.local.get(["apiKey", "baseUrl", "model"]);
  return { ...DEFAULTS, ...stored };
}

function registrableDomain(hostname) {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

function extractTabInfo(tab) {
  if (!tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const base = `${url.origin}${url.pathname}`;
    return {
      id: tab.id,
      title: (tab.title || "").slice(0, 120),
      domain: registrableDomain(url.hostname),
      url: base.slice(0, 200)
    };
  } catch {
    return null;
  }
}

const PROMPT = `You are a browser tab organizer. You will receive a JSON list of tabs, each with an id, page title, domain, and url (origin + path only; query strings and fragments are stripped).
Assign every tab to exactly one group based on its topic or activity.
Rules:
- Use at most ${MAX_GROUPS} groups. Merge small/rare topics into a sensible broader group.
- Use the url path to separate tabs on the SAME domain into different groups when they represent clearly different activities (e.g. github.com/org-a/repo vs github.com/org-b/repo, mail.google.com/mail vs mail.google.com/chat, app.slack.com/team-1 vs app.slack.com/team-2).
- Keep tabs on the same domain in the SAME group when the paths are just different views of one activity (e.g. multiple docs on the same Notion workspace, several PRs in one repo).
- Combine signals: prefer the page title for topic, and the url path for disambiguating same-domain tabs.
- Group names: 1-2 words base on the purpose of the tab
- Assign each group a distinct color from exactly: ${COLORS.join(", ")}.
- Every tab id must appear exactly once. Do not invent ids.
Return ONLY valid JSON in this exact shape, no markdown, no extra text:
{"groups":[{"name":"Group Name","color":"blue","tabIds":[1,2]}]}`;

function parseGroups(raw) {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model response contained no JSON object");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed || !Array.isArray(parsed.groups)) throw new Error("Model response missing 'groups' array");
  return parsed.groups;
}

async function callLLM(settings, tabs) {
  const body = {
    model: settings.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PROMPT },
      { role: "user", content: JSON.stringify(tabs.map(({ id, title, domain, url }) => ({ id, title, domain, url }))) }
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
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");
  return parseGroups(content);
}

async function groupTabs() {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("No API key set. Open Settings and add your key first.");
  }

  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const tabs = allTabs.map(extractTabInfo).filter(Boolean);
  if (tabs.length === 0) {
    return { groups: [], tabCount: 0, message: "No groupable tabs in this window." };
  }

  const tabIds = tabs.map((t) => t.id);
  await chrome.tabs.ungroup(tabIds).catch(() => {});

  const groupsByName = new Map();
  for (let i = 0; i < tabs.length; i += BATCH_SIZE) {
    const batch = tabs.slice(i, i + BATCH_SIZE);
    const modelGroups = await callLLM(settings, batch);
    const validIds = new Set(batch.map((t) => t.id));
    for (const g of modelGroups) {
      if (!g || typeof g.name !== "string" || !Array.isArray(g.tabIds)) continue;
      const name = g.name.trim().slice(0, 24);
      const color = COLORS.includes(g.color) ? g.color : null;
      if (!groupsByName.has(name)) groupsByName.set(name, { name, color, tabIds: [] });
      const entry = groupsByName.get(name);
      if (!entry.color && color) entry.color = color;
      for (const id of g.tabIds) {
        if (validIds.has(id)) entry.tabIds.push(id);
      }
    }
  }

  const created = [];
  let colorIdx = 0;
  for (const entry of groupsByName.values()) {
    const unique = [...new Set(entry.tabIds)];
    if (unique.length === 0) continue;
    const color = entry.color || COLORS[colorIdx++ % COLORS.length];
    const groupId = await chrome.tabs.group({ tabIds: unique });
    await chrome.tabGroups.update(groupId, { title: entry.name, color });
    created.push({ name: entry.name, color, count: unique.length });
  }

  if (created.length > MAX_GROUPS) {
    created.sort((a, b) => b.count - a.count);
  }

  return { groups: created, tabCount: tabs.length };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "GROUP_TABS") return false;
  groupTabs()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

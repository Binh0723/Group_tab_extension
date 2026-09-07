// AI Tab Grouper — background service worker (TypeScript)
// Compiled to background.js by `npm run build` (tsc).
// Loaded as an ES module so it can share code with the UI (see manifest.json).

import { normalizeTab, type TabDescriptor } from "./shared/domain.js";
import { extractPageContent, type PageContent } from "./shared/pageContent.js";
import { loadStoredSettings } from "./shared/settings.js";
import {
  COLORS,
  MAX_GROUPS,
  requestGroups,
  type ModelGroup,
  type TabColor
} from "./llm/tasks/groupTabs.js";

const BATCH_SIZE = 40;

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

interface MergedGroup {
  name: string;
  color: TabColor | null;
  tabIds: number[];
}

/** Main orchestrator: query tabs, batch them through the LLM, and create Chrome tab groups. */
async function groupTabs(): Promise<GroupResult> {
  const settings = await loadStoredSettings();
  if (!settings.apiKey) {
    throw new Error("No API key set. Open Settings and add your key first.");
  }

  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const tabs = allTabs.map(normalizeTab).filter((t): t is TabDescriptor => t !== null);
  if (tabs.length === 0) {
    return { groups: [], tabCount: 0, message: "No groupable tabs in this window." };
  }

  const tabIds = tabs.map((t) => t.id);
  await chrome.tabs.ungroup(tabIds).catch(() => {});

  const groupsByName = new Map<string, MergedGroup>();
  for (let i = 0; i < tabs.length; i += BATCH_SIZE) {
    const batch = tabs.slice(i, i + BATCH_SIZE);
    const modelGroups: ModelGroup[] = await requestGroups(batch);
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

/** Inject the extractor into a tab and return its page content. */
async function scrapeTab(tabId: number): Promise<PageContent> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageContent
  });
  if (!result || result.result == null) throw new Error("No result from page");
  return result.result as PageContent;
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
    if (typeof msg !== "object" || msg === null) return false;
    const type = (msg as { type?: string }).type;
    if (type === "GROUP_TABS") {
      groupTabs()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true; // keep the sendResponse channel open across the async call
    }
    if (type === "SCRAPE_TAB") {
      const tabId = (msg as { tabId?: unknown }).tabId;
      if (typeof tabId !== "number") {
        sendResponse({ ok: false, error: "SCRAPE_TAB requires a numeric tabId" });
        return false;
      }
      scrapeTab(tabId)
        .then((content) => sendResponse({ ok: true, content }))
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true; // keep the sendResponse channel open across the async call
    }
    return false;
  }
);

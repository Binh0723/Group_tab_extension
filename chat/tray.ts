// Pinned-tab context state + the context tray UI (chips) + the tab picker menu.

import { $ } from "../shared/dom.js";
import { normalizeTab, type TabDescriptor } from "../shared/domain.js";

const chatContextBtn = $<HTMLButtonElement>("chat-context-btn");
const chatContextMenu = $<HTMLElement>("chat-context-menu");
const chatContextSearch = $<HTMLInputElement>("chat-context-search");
const chatContextList = $<HTMLUListElement>("chat-context-list");
const chatContextTray = $<HTMLElement>("chat-context-tray");

// Pinned tab contexts for the next send. Each entry is privacy-safe:
// title, domain, and origin+path (query strings/fragments stripped).
const pinnedContext: TabDescriptor[] = [];
const removedContextIds = new Set<number>();
let contextMenuOpen = false;
let allContextTabs: TabDescriptor[] = [];
let currentTabId: number | undefined;

// Injected by initContextTray so the tray can hand focus back to the composer.
let focusComposer: () => void = () => {};

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
    const remove = document.createElement("button");
    remove.className = "chip-remove";
    remove.textContent = "×";
    remove.title = "Remove context";
    remove.addEventListener("click", () => {
      const i = pinnedContext.findIndex((p) => p.id === tab.id);
      if (i !== -1) pinnedContext.splice(i, 1);
      removedContextIds.add(tab.id);
      renderContextTray();
    });
    chip.appendChild(title);
    chip.appendChild(remove);
    chatContextTray.appendChild(chip);
  }
}

function isPinned(id: number): boolean {
  return pinnedContext.some((p) => p.id === id);
}

function renderContextList(tabs: TabDescriptor[], currentId?: number): void {
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
        removedContextIds.delete(tab.id);
        renderContextTray();
        renderContextList(tabs, currentId);
        focusComposer();
      });
    }
    chatContextList.appendChild(li);
  }
}

async function openContextMenu(): Promise<void> {
  contextMenuOpen = true;
  chatContextMenu.classList.remove("hidden");
  chatContextBtn.classList.add("active");
  chatContextSearch.value = "";
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = active?.id;
  allContextTabs = (await chrome.tabs.query({}))
    .map(normalizeTab)
    .filter((t): t is TabDescriptor => t !== null);
  // Current tab first, then the rest.
  let currentTab: TabDescriptor | undefined;
  if (currentTabId != null) {
    currentTab = allContextTabs.find((t) => t.id === currentTabId);
    if (currentTab) {
      allContextTabs = allContextTabs.filter((t) => t.id !== currentTabId);
      allContextTabs.unshift(currentTab);
    }
  }
  // Auto-pin the active tab so it's ready to send as context —
  // unless the user already unpinned it (don't re-attach it).
  if (currentTab && !isPinned(currentTab.id) && !removedContextIds.has(currentTab.id)) {
    pinnedContext.push(currentTab);
    renderContextTray();
  }
  renderContextList(allContextTabs, currentTabId);
  chatContextSearch.focus();
}

function closeContextMenu(): void {
  contextMenuOpen = false;
  chatContextMenu.classList.add("hidden");
  chatContextBtn.classList.remove("active");
}

/** Snapshot the pins for sending and clear the tray. */
export function takePinnedContext(): TabDescriptor[] {
  const taken = pinnedContext.slice();
  pinnedContext.length = 0;
  renderContextTray();
  return taken;
}

/** Put pins back (e.g. after a failed send so the user can retry). */
export function restorePinnedContext(tabs: TabDescriptor[]): void {
  pinnedContext.push(...tabs);
  renderContextTray();
}

export function initContextTray(onFocusComposer: () => void): void {
  focusComposer = onFocusComposer;

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
}

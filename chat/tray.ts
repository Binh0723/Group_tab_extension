// Tab/file context state + the context tray UI (chips) + the tab picker menu.

import { $ } from "../shared/dom.js";
import { normalizeTab, type TabDescriptor } from "../shared/domain.js";
import type { ChatAttachment } from "../shared/types.js";

const chatContextBtn = $<HTMLButtonElement>("chat-context-btn");
const chatContextMenu = $<HTMLElement>("chat-context-menu");
const chatContextSearch = $<HTMLInputElement>("chat-context-search");
const chatContextList = $<HTMLUListElement>("chat-context-list");
const chatContextTray = $<HTMLElement>("chat-context-tray");

// Pinned tab contexts. Each entry is privacy-safe: title, domain, and
// origin+path (query strings/fragments stripped). Pins persist across sends
// until the user removes them via the chip's × button.
const pinnedContext: TabDescriptor[] = [];
const pendingAttachments: ChatAttachment[] = [];
const removedContextIds = new Set<number>();
let contextMenuOpen = false;
let allContextTabs: TabDescriptor[] = [];
let currentTabId: number | undefined;
// The tab auto-attached as "current tab" context (vs. pins the user picked
// from the menu). Tracked so switching tabs swaps it instead of piling up pins.
let autoPinnedId: number | undefined;

// Injected by initContextTray so the tray can hand focus back to the composer.
let focusComposer: () => void = () => {};

function renderContextTray(): void {
  chatContextTray.innerHTML = "";
  if (pinnedContext.length === 0 && pendingAttachments.length === 0) {
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
    remove.type = "button";
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

  for (const attachment of pendingAttachments) {
    const chip = document.createElement("span");
    chip.className = "chat-chip attachment-chip";
    chip.title = attachment.name;

    if (attachment.kind === "image" && attachment.dataUrl) {
      const img = document.createElement("img");
      img.className = "attachment-thumb";
      img.src = attachment.dataUrl;
      img.alt = attachment.name;
      img.onerror = () => img.remove();
      chip.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "attachment-icon";
      icon.textContent = "▤";
      icon.setAttribute("aria-hidden", "true");
      chip.appendChild(icon);
    }

    const title = document.createElement("span");
    title.className = "chip-title";
    title.textContent = attachment.name;
    chip.appendChild(title);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.textContent = "×";
    remove.title = `Remove ${attachment.name}`;
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.addEventListener("click", () => {
      const i = pendingAttachments.findIndex((item) => item.id === attachment.id);
      if (i !== -1) pendingAttachments.splice(i, 1);
      renderContextTray();
    });
    chip.appendChild(remove);
    chatContextTray.appendChild(chip);
  }
}

/** Snapshot the files waiting to be included in the next chat message. */
export function getPendingAttachments(): ChatAttachment[] {
  return pendingAttachments.slice();
}

/** Add successfully parsed files to the attachment tray. */
export function addPendingAttachments(attachments: ChatAttachment[]): void {
  pendingAttachments.push(...attachments);
  renderContextTray();
}

/** Clear files after a successful send. */
export function clearPendingAttachments(): void {
  pendingAttachments.length = 0;
  renderContextTray();
}

/** Restore a snapshot when a request fails so it can be retried. */
export function restorePendingAttachments(attachments: ChatAttachment[]): void {
  pendingAttachments.length = 0;
  pendingAttachments.push(...attachments);
  renderContextTray();
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

/**
 * Auto-attach the active tab as context. Runs on tray init and whenever the
 * active tab changes so the current tab is always in the tray — not just
 * when the user opens the picker menu. When the active tab changes, the
 * previously auto-attached pin is swapped out (user-picked pins stay);
 * tabs the user explicitly unpinned are never re-attached.
 */
async function autoPinActiveTab(): Promise<void> {
  const [active] = await chrome.tabs
    .query({ active: true, currentWindow: true })
    .catch(() => [] as chrome.tabs.Tab[]);
  const fresh = active ? normalizeTab(active) : null;
  if (!fresh || fresh.id == null) return;
  currentTabId = fresh.id;

  // Swap out the previous auto-attached pin so the tray follows the active
  // tab instead of accumulating one pin per visited tab.
  if (autoPinnedId != null && autoPinnedId !== fresh.id) {
    const i = pinnedContext.findIndex((p) => p.id === autoPinnedId);
    if (i !== -1) pinnedContext.splice(i, 1);
    autoPinnedId = undefined;
    renderContextTray();
  }

  if (isPinned(fresh.id) || removedContextIds.has(fresh.id)) return;

  pinnedContext.push(fresh);
  autoPinnedId = fresh.id;
  renderContextTray();
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
  // Normally already pinned by autoPinActiveTab; this is a fallback for
  // cases where activation events were missed (e.g. popup just opened).
  if (currentTab && !isPinned(currentTab.id) && !removedContextIds.has(currentTab.id)) {
    pinnedContext.push(currentTab);
    autoPinnedId = currentTab.id;
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

/** Snapshot the current pins without clearing them — pins persist until removed. */
export function getPinnedContext(): TabDescriptor[] {
  return pinnedContext.slice();
}

/**
 * Re-read every pinned tab's live state (title/url move together when the user
 * navigates inside a pinned tab). Pins whose tab closed or left the web are
 * dropped; everything else is updated in place.
 */
export async function refreshPinnedTabs(): Promise<void> {
  if (pinnedContext.length === 0) return;
  const states = await Promise.all(
    pinnedContext.map((pin) => chrome.tabs.get(pin.id).catch(() => null))
  );
  let changed = false;
  const next: TabDescriptor[] = [];
  pinnedContext.forEach((pin, i) => {
    const tab = states[i];
    const fresh = tab ? normalizeTab(tab) : null;
    if (!fresh) {
      changed = true; // tab closed or navigated to a non-web page
      return;
    }
    if (
      fresh.url !== pin.url ||
      fresh.title !== pin.title ||
      fresh.fullUrl !== pin.fullUrl
    ) {
      changed = true;
    }
    next.push(fresh);
  });
  if (!changed) return;
  pinnedContext.length = 0;
  pinnedContext.push(...next);
  renderContextTray();
}

export function initContextTray(onFocusComposer: () => void): void {
  focusComposer = onFocusComposer;

  // Keep pinned chips in sync while the user navigates inside pinned tabs
  // or closes them. Only url/title changes matter for our descriptors.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!(changeInfo.url || changeInfo.title)) return;
    if (!isPinned(tabId)) return;
    void refreshPinnedTabs();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (!isPinned(tabId)) return;
    void refreshPinnedTabs();
  });

  // Auto-attach the current tab right away, and re-attach whenever the user
  // switches tabs — the tray should always show the active tab as context,
  // even if the picker menu was never opened.
  void autoPinActiveTab();
  chrome.tabs.onActivated.addListener(() => {
    void autoPinActiveTab();
  });

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

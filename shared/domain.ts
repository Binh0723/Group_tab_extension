// Privacy-safe tab descriptors shared by the grouper and the chat context picker.

// Union of both previous TLD lists (background grouper + popup chat).
const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "or.jp", "ne.jp",
  "com.br", "co.nz", "co.in", "co.za",
  "co.kr", "com.cn", "com.hk", "com.sg", "com.tw"
]);

export const TITLE_MAX_LENGTH = 120;
export const URL_MAX_LENGTH = 200;

/** A minimal, privacy-safe description of a tab (query strings/fragments stripped). */
export interface TabDescriptor {
  id: number;
  title: string;
  domain: string;
  url: string;
  /** Full URL including query/fragment. Only used where fetching requires it (page scraping). */
  fullUrl?: string;
  favIconUrl?: string;
}

/** Reduce a hostname to its registrable domain (e.g. www.mail.google.com → google.com). */
export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** Extract a privacy-safe descriptor from a Chrome tab. Returns null for non-http(s) tabs. */
export function normalizeTab(tab: chrome.tabs.Tab): TabDescriptor | null {
  if (!tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      id: tab.id as number,
      title: (tab.title || url.hostname || "Untitled").slice(0, TITLE_MAX_LENGTH),
      domain: registrableDomain(url.hostname),
      url: `${url.origin}${url.pathname}`.slice(0, URL_MAX_LENGTH),
      fullUrl: tab.url,
      favIconUrl: tab.favIconUrl
    };
  } catch {
    return null;
  }
}

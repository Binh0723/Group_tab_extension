// Tab content store: scrapes pages via the service worker and caches results
// per tab so repeated sends in one conversation don't re-inject scripts into
// the same page. A cached entry is valid while the tab stays on the same URL
// and the entry is younger than TTL_MS.

import type { TabDescriptor } from "../shared/domain.js";
import type { PageContent } from "../shared/pageContent.js";

/** How long a scraped page stays fresh, in milliseconds. */
const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  url: string;
  title: string;
  content: PageContent;
  scrapedAt: number;
}

const cache = new Map<number, CacheEntry>();

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

/**
 * Return the tab's page content, reusing a cached scrape when the tab is still
 * on the same URL and the entry hasn't expired. Falls back to a fresh scrape
 * (then caches the result) otherwise; null if scraping fails.
 */
export async function getTabContent(tab: TabDescriptor): Promise<PageContent | null> {
  const hit = cache.get(tab.id);
  if (hit && hit.url === tab.url && Date.now() - hit.scrapedAt < TTL_MS) {
    return hit.content;
  }
  const content = await scrapeTabContent(tab.id);
  if (content) {
    cache.set(tab.id, { url: tab.url, title: tab.title, content, scrapedAt: Date.now() });
  } else {
    // Don't let a transient failure pin a stale entry for a URL it never matched.
    cache.delete(tab.id);
  }
  return content;
}

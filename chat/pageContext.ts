// Page-context collection for chat: scrapes the pinned tabs (or the current
// tab when nothing is pinned) through a Firecrawl-compatible /v2/scrape
// endpoint so questions like "what is this?" can be answered from real page
// content, including pages behind authentication (the tab's cookies are
// forwarded with every scrape).

import { normalizeTab, type TabDescriptor } from "../shared/domain.js";
import type { ExtensionSettings } from "../shared/types.js";

const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const MAX_TARGETS = 3;
const PER_TAB_CHARS = 4000;
const TOTAL_CHARS = 10000;
const TIMEOUT_MS = 25000;

export interface PageContent {
  target: TabDescriptor;
  markdown?: string;
  error?: string;
}

/** Pinned tabs if any; otherwise the active tab of the current window. */
export async function resolveTargets(pinned: TabDescriptor[]): Promise<TabDescriptor[]> {
  if (pinned.length > 0) return pinned.slice(0, MAX_TARGETS);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const descriptor = active ? normalizeTab(active) : null;
  return descriptor ? [descriptor] : [];
}

/** All cookies for a URL as a Cookie header value (includes HttpOnly cookies). */
async function getCookieHeader(url: string): Promise<string | undefined> {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!cookies || cookies.length === 0) return undefined;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return undefined;
  }
}

/** Accepts both the v1 `{data: {markdown}}` and v2 direct-document envelopes. */
function extractMarkdown(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as Record<string, unknown>;
  let doc: Record<string, unknown> | null = null;
  if (typeof root.markdown === "string") doc = root;
  else if (root.data && typeof root.data === "object") doc = root.data as Record<string, unknown>;
  else if (Array.isArray(root.documents) && root.documents[0])
    doc = root.documents[0] as Record<string, unknown>;
  return doc && typeof doc.markdown === "string" ? doc.markdown : undefined;
}

function describeHttpError(status: number): string {
  if (status === 401 || status === 403) return "invalid Firecrawl API key";
  if (status === 402) return "Firecrawl credits exhausted";
  if (status === 429) return "Firecrawl rate limited — try again shortly";
  return `Firecrawl error ${status}`;
}

async function scrapeOne(settings: ExtensionSettings, target: TabDescriptor): Promise<PageContent> {
  const fullUrl = target.fullUrl ?? target.url;
  try {
    const base = (settings.firecrawlBaseUrl || DEFAULT_FIRECRAWL_BASE_URL).replace(/\/+$/, "");
    const cookie = await getCookieHeader(fullUrl);
    const body: Record<string, unknown> = {
      url: fullUrl,
      formats: ["markdown"],
      onlyMainContent: true,
      storeInCache: false
    };
    if (cookie) body.headers = { Cookie: cookie };

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${base}/v2/scrape`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.firecrawlApiKey ?? ""}`
        },
        body: JSON.stringify(body)
      });
    } finally {
      window.clearTimeout(timer);
    }

    if (!res.ok) return { target, error: describeHttpError(res.status) };
    const markdown = extractMarkdown(await res.json());
    if (!markdown || !markdown.trim()) return { target, error: "no content returned" };
    return { target, markdown: markdown.trim() };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return { target, error: aborted ? "timed out" : (err as Error)?.message || "request failed" };
  }
}

/** Scrape each target sequentially; identical URLs share one scrape. */
export async function fetchPageContents(
  targets: TabDescriptor[],
  settings: ExtensionSettings
): Promise<PageContent[]> {
  const results: PageContent[] = [];
  const memo = new Map<string, PageContent>();
  for (const target of targets) {
    const fullUrl = target.fullUrl ?? target.url;
    const cached = memo.get(fullUrl);
    if (cached) {
      results.push(cached);
      continue;
    }
    const result = await scrapeOne(settings, target);
    memo.set(fullUrl, result);
    results.push(result);
  }
  return results;
}

/** Metadata-only listing (fallback when scraping is unavailable). */
export function listTargetMetadata(targets: TabDescriptor[]): string {
  return targets.map((t) => `- [${t.title}] (${t.domain}) ${t.fullUrl ?? t.url}`).join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

export function buildContextBlock(results: PageContent[]): string {
  let used = 0;
  const parts: string[] = [];
  for (const r of results) {
    const t = r.target;
    let block = `- [${t.title}] (${t.domain}) ${t.fullUrl ?? t.url}`;
    if (r.markdown) {
      const budget = Math.min(PER_TAB_CHARS, TOTAL_CHARS - used);
      if (budget <= 0) {
        block += "\n  (page content omitted — length budget reached)";
      } else {
        const md = r.markdown.slice(0, budget);
        used += md.length;
        block += `\n  Page content:\n${indent(md)}`;
      }
    } else {
      block += `\n  (page content unavailable${r.error ? `: ${r.error}` : ""})`;
    }
    parts.push(block);
  }
  return parts.join("\n");
}

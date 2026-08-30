// Page-content extraction for chat context enrichment.
//
// extractPageContent is injected into tabs via chrome.scripting.executeScript({ func }),
// which serializes the function's source — so it must be fully self-contained:
// no imports and no references to module-scope values. All constants and helpers
// live inside the function body. Importing the PageContent *type* elsewhere is safe
// because types are erased at compile time.

/** Structured content extracted from a web page. */
export interface PageContent {
  title: string;
  description?: string;
  headings: string[];
  text: string;
  truncated: boolean;
}

/** Extract metadata + main text from the current page. Runs inside the tab. */
export function extractPageContent(): PageContent {
  const TEXT_MAX_CHARS = 9000;
  const HEADINGS_MAX = 15;
  const HEADING_MAX_CHARS = 120;
  const TITLE_MAX_CHARS = 200;
  const DESCRIPTION_MAX_CHARS = 300;
  const MIN_PARA_CHARS = 200; // a container needs at least this much paragraph text to qualify

  const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
  const squashedLen = (s: string): number => s.replace(/\s+/g, "").length;

  // ---- Metadata ----
  const title = clean(document.title || "").slice(0, TITLE_MAX_CHARS);
  const metaDesc = document
    .querySelector('meta[name="description"], meta[property="og:description"]')
    ?.getAttribute("content");
  const description = metaDesc ? clean(metaDesc).slice(0, DESCRIPTION_MAX_CHARS) : undefined;

  const headings: string[] = [];
  const headingEls = document.querySelectorAll("h1, h2, h3");
  for (let i = 0; i < headingEls.length && headings.length < HEADINGS_MAX; i++) {
    const t = clean(headingEls[i].textContent || "");
    if (t) headings.push(t.slice(0, HEADING_MAX_CHARS));
  }

  // ---- Pick the main content container ----
  const paraLen = (el: Element): number => {
    let n = 0;
    const ps = el.querySelectorAll("p, pre, blockquote, li");
    for (let i = 0; i < ps.length; i++) n += squashedLen(ps[i].textContent || "");
    return n;
  };
  const linkLen = (el: Element): number => {
    let n = 0;
    const links = el.querySelectorAll("a");
    for (let i = 0; i < links.length; i++) n += squashedLen(links[i].textContent || "");
    return n;
  };

  let container: Element | null = null;

  // 1. Semantic containers first — pick the one with the most paragraph text.
  const preferred = document.querySelectorAll('article, main, [role="main"]');
  let bestPreferred: Element | null = null;
  let bestPreferredLen = 0;
  for (let i = 0; i < preferred.length; i++) {
    const n = paraLen(preferred[i]);
    if (n > bestPreferredLen) {
      bestPreferredLen = n;
      bestPreferred = preferred[i];
    }
  }
  if (bestPreferred && bestPreferredLen >= MIN_PARA_CHARS) {
    container = bestPreferred;
  } else {
    // 2. Heuristic: score generic blocks by paragraph text minus link text.
    // querySelectorAll returns document order (ancestors before descendants), so
    // when a descendant scores close to the current best we prefer the descendant —
    // it holds the same content with less surrounding boilerplate.
    let best: Element | null = null;
    let bestScore = 0;
    const blocks = document.querySelectorAll("div, section");
    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      const p = paraLen(el);
      if (p < MIN_PARA_CHARS) continue;
      const score = p - linkLen(el);
      if (score <= 0) continue;
      if (best && best.contains(el) && score >= bestScore * 0.75) {
        best = el; // more specific container with similar content
        bestScore = score;
      } else if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    container = best;
  }
  if (!container) container = document.body;

  // ---- Extract text from a cleaned clone (never mutate the live page) ----
  const clone = container.cloneNode(true) as Element;
  const junk = clone.querySelectorAll(
    "script, style, noscript, iframe, svg, canvas, nav, footer, header, aside, form," +
      " button, select, textarea, input, [hidden], [aria-hidden='true']," +
      " [style*='display:none'], [style*='display: none']," +
      " [style*='visibility:hidden'], [style*='visibility: hidden']"
  );
  for (let i = 0; i < junk.length; i++) junk[i].remove();

  // textContent has no block breaks — append a newline marker to each block
  // element so paragraphs/headings/list items stay separated for the LLM.
  const blockEls = clone.querySelectorAll(
    "p, div, li, h1, h2, h3, h4, h5, h6, tr, br, section, article, pre, blockquote"
  );
  for (let i = 0; i < blockEls.length; i++) {
    blockEls[i].appendChild(document.createTextNode("\n"));
  }

  let text = (clone.textContent || "")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let truncated = false;
  if (text.length > TEXT_MAX_CHARS) {
    const cut = text.lastIndexOf(" ", TEXT_MAX_CHARS);
    text = text.slice(0, cut > TEXT_MAX_CHARS * 0.9 ? cut : TEXT_MAX_CHARS).trimEnd() + " …";
    truncated = true;
  }

  return { title, description, headings, text, truncated };
}

// Minimal markdown → HTML renderer for assistant chat messages.
// Hand-rolled to avoid a bundling step; covers the subset LLMs commonly emit:
// headers, bold/italic/strikethrough, inline + fenced code, links, lists, hr,
// paragraphs with soft line breaks.
//
// Safety: the input is model output and is UNTRUSTED (page content is part of
// the prompt, so prompt injection is possible). Everything is HTML-escaped
// first, transformations only add our own tags, and link hrefs are restricted
// to http(s)/mailto. Never pass unescaped text into this function's output path.

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ESCAPE[c]);
}

// Placeholder markers for extracted code — control chars that never appear in
// normal text. Built via fromCharCode so this file stays plain ASCII.
// NUL wraps fenced code blocks, SOH wraps inline code.
const NUL = String.fromCharCode(0);
const SOH = String.fromCharCode(1);
const BLOCK_RE = new RegExp(`${NUL}(\\d+)${NUL}`, "g");
const INLINE_RE = new RegExp(`${SOH}(\\d+)${SOH}`, "g");
const BLOCK_LINE_RE = new RegExp(`^${NUL}\\d+${NUL}$`);

/** Render a markdown string to a sanitized HTML string. */
export function renderMarkdown(src: string): string {
  let text = escapeHtml(src);

  // ---- Extract code into placeholders so no other rule touches it ----
  const codeBlocks: string[] = [];
  text = text.replace(/```[^\n]*\n?([\s\S]*?)(?:```|$)/g, (_m, code: string) => {
    codeBlocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `${NUL}${codeBlocks.length - 1}${NUL}`;
  });
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    inlineCodes.push(`<code>${code}</code>`);
    return `${SOH}${inlineCodes.length - 1}${SOH}`;
  });

  // ---- Block pass: headers, lists, hr, paragraphs ----
  const lines = text.split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushPara = (): void => {
    if (para.length > 0) {
      out.push(`<p>${para.join("<br>")}</p>`);
      para = [];
    }
  };
  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // A fenced-code placeholder sitting on its own line is a block element.
    if (BLOCK_LINE_RE.test(trimmed)) {
      flushPara();
      closeList();
      out.push(trimmed);
      continue;
    }

    const header = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (header) {
      flushPara();
      closeList();
      const level = Math.min(header[1].length, 4); // keep sizes sane inside a chat bubble
      out.push(`<h${level}>${header[2]}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      closeList();
      out.push("<hr>");
      continue;
    }

    const ul = trimmed.match(/^[-*•]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${ul[1]}</li>`);
      continue;
    }

    const ol = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${ol[1]}</li>`);
      continue;
    }

    if (trimmed === "") {
      flushPara();
      closeList();
      continue;
    }

    closeList();
    para.push(trimmed);
  }
  flushPara();
  closeList();

  let html = out.join("\n");

  // ---- Inline pass (code is still placeholdered, so it's untouched) ----
  // Links: only http(s)/mailto hrefs survive; anything else renders as plain text.
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    /^(https?:\/\/|mailto:)/i.test(url)
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  // NOTE: no _italic_ — too many false positives with snake_case identifiers.
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // ---- Restore code placeholders last ----
  html = html.replace(INLINE_RE, (_m, i: string) => inlineCodes[Number(i)]);
  html = html.replace(BLOCK_RE, (_m, i: string) => codeBlocks[Number(i)]);

  return html;
}

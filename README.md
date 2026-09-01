# AI Tab Grouper

Chrome / Brave extension (Manifest V3) that groups your tabs by topic using any OpenAI-compatible LLM API, plus a built-in chat panel that can answer questions about your open tabs.

## Features

- **One-click tab grouping** — groups all tabs in the current window by topic, with names and colors chosen by the LLM.
- **Smart batching** — tabs are sent to the LLM in batches of 40, so large windows still group correctly. Results are merged into at most 8 groups.
- **Domain-aware separation** — tabs on the same domain are split into different groups when they represent distinct activities (e.g. `github.com/org-a` vs `github.com/org-b`), and kept together when they're part of one activity.
- **AI chat with streaming** — a built-in chat tab streams responses token-by-token. The conversation lives in memory only and clears when the panel closes.
- **Page-aware answers** — the chat reads the actual content of pinned tabs (or your current tab when nothing is pinned) via local in-page extraction, so questions like "what is this?" are answered from the real page. No third-party scraping service is involved.
- **Pin tab context to chat** — attach open tabs as context for your next chat message. Search and pick tabs from a list; pinned tabs show as chips with favicons and stay pinned until removed.
- **Attach images and text files** — use the separate paperclip button to attach multiple PNG, JPEG, WebP, GIF, or small text/code files. Files appear by name in the tray and are included with the tab context when sent.
- **Markdown rendering** — assistant replies render headers, bold/italic, lists, links, and code blocks.
- **Any OpenAI-compatible endpoint** — works with OpenAI, OpenRouter, NVIDIA NIM, or a local Ollama server. Click **Load** to fetch the list of models your key supports.
- **Privacy-conscious by design** — grouping sends only tab titles, registrable domains, and URL paths (query strings and fragments are stripped). Page content and attachments are read locally in your browser and included only with chat messages you send.

## Install (Chrome)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder

## Install (Brave)

1. Open `brave://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

## Build

The extension is written in TypeScript and compiled to JS. The repo ships with built `*.js` files, but to rebuild after editing:

```bash
npm install
npm run build      # one-time compile (tsc)
npm run watch      # or recompile on save
```

Then reload the extension in `chrome://extensions`.

## Setup

1. Click the extension icon to open the side panel, then the **Settings** tab.
2. Enter your API key (OpenAI by default).
3. Optional: change **Base URL** for OpenRouter, NVIDIA NIM, or local Ollama, then click **Load** to pick a model your key supports.
4. Click **Test Connection**, then **Save**.

## Use

The extension opens as a **side panel** with three tabs:

- **Action** — click **Group My Tabs**. Tabs in the current window are grouped by topic with names and colors chosen by the LLM. Existing groups are cleared first, and the result list shows each group with its color and tab count.
- **Chat** — ask the AI anything. Responses stream in live and render markdown. Use the **+** button to pin open tabs as context (search by title or domain), or the separate **paperclip** button to attach multiple images/text files. Each send reads pinned pages locally (up to 3) and includes selected text files and images with the request. Attachments appear by name in the tray and are cleared after a successful send. Images are sent as Base64 image content for vision-capable models; if the provider rejects image input, the request is retried once without the image bytes. Tabs that can't be read (`chrome://`, the Web Store, PDFs) fall back to title/URL only. Pinned tabs stay pinned until you remove them via the chip's ×. PDF attachments are not supported yet.
- **Settings** — API key, base URL, and model configuration.

## Privacy

- When grouping, only tab **titles**, **registrable domains**, and **URL paths** are sent to the LLM. Query strings and fragments are stripped (so tokens/sensitive params don't leak).
- Page-content and file reading happen **locally**: a one-shot `chrome.scripting` injection extracts page text inside your browser, while images are converted to Base64 and text files are read in the side panel. These values are included only with chat messages you send, and go only to your configured LLM endpoint. No third-party scraping or file service is used, and no cookies ever leave your machine.
- Chat messages, pinned context, attachments, and page excerpts are held in memory only — closing the side panel clears them. Text attachments are limited to 25,000 characters (approximately 3–5 pages); images are limited to 5 MB each.
- The API key is stored locally in `chrome.storage.local` and only sent to the base URL you configure.

## Files

- `manifest.json` — MV3 manifest (permissions: `tabs`, `tabGroups`, `storage`, `sidePanel`, `scripting`)
- `background.ts` / `background.js` — service worker: collects tabs, calls the LLM in batches, creates Chrome tab groups, injects the page-content extractor on demand
- `shared/pageContent.ts` / `.js` — self-contained DOM extractor injected into context tabs (main-text heuristic, metadata, ~9k char cap)
- `shared/markdown.ts` / `.js` — minimal markdown → sanitized HTML renderer for assistant replies
- `chat/attachments.ts` / `.js` — local image and text-file validation and reading
- `popup.ts` / `popup.js` — side panel UI with three tabs: Action (group button + results), Chat (streaming chat + tab/file context), and Settings (API key, base URL, model)
- `popup.html` / `popup.css` — panel markup and styles

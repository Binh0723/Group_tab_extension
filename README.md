# AI Tab Grouper

Chrome / Brave extension (Manifest V3) that groups your tabs by topic using any OpenAI-compatible LLM API, plus a built-in chat panel that can answer questions about your open tabs.

## Features

- **One-click tab grouping** — groups all tabs in the current window by topic, with names and colors chosen by the LLM.
- **Smart batching** — tabs are sent to the LLM in batches of 40, so large windows still group correctly. Results are merged into at most 8 groups.
- **Domain-aware separation** — tabs on the same domain are split into different groups when they represent distinct activities (e.g. `github.com/org-a` vs `github.com/org-b`), and kept together when they're part of one activity.
- **AI chat with streaming** — a built-in chat tab streams responses token-by-token. The conversation lives in memory only and clears when the panel closes.
- **Page-aware answers** — add a free Firecrawl API key and the chat reads the actual content of the pinned tabs (or your current tab when nothing is pinned), so questions like "what is this?" are answered from the real page — including pages you're logged into.
- **Pin tab context to chat** — attach open tabs as context for your next chat message. Search and pick tabs from a list; pinned tabs show as chips with favicons and can be removed before sending.
- **Any OpenAI-compatible endpoint** — works with OpenAI, OpenRouter, NVIDIA NIM, or a local Ollama server. Click **Load** to fetch the list of models your key supports.
- **Privacy-safe by design** — only tab titles, registrable domains, and URL paths are sent to the LLM. Query strings and fragments are stripped so tokens and sensitive params don't leak.

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
4. Optional: paste a [Firecrawl](https://firecrawl.dev) API key to enable page-content reading for chat ("what is this?"). Point **Firecrawl Base URL** at a self-hosted instance if you prefer to keep scraping traffic local.
5. Click **Test Connection**, then **Save**.

## Use

The extension opens as a **side panel** with three tabs:

- **Action** — click **Group My Tabs**. Tabs in the current window are grouped by topic with names and colors chosen by the LLM. Existing groups are cleared first, and the result list shows each group with its color and tab count.
- **Chat** — ask the AI anything. Responses stream in live. Use the **+** button to pin open tabs as context (search by title or domain), then send. With a Firecrawl key set, each send also scrapes those pages (up to 3) so the AI can answer questions about what's actually on them; with no pins, your current tab is used. Pinned tabs stay pinned until you remove them via the chip's ×.
- **Settings** — API key, base URL, and model configuration.

## Privacy

- When grouping, only tab **titles**, **registrable domains**, and **URL paths** are sent to the LLM. Query strings and fragments are stripped (so tokens/sensitive params don't leak).
- Page-content reading for chat sends the target tab's **full URL** and that site's **cookies** to your configured Firecrawl endpoint so logged-in pages can be read. This means session tokens for scraped pages leave your machine to Firecrawl — use a self-hosted Firecrawl instance via **Firecrawl Base URL** if that's a concern.
- Scrapes set `storeInCache: false`, keeping page content out of Firecrawl's shared cache/index.
- Chat messages, pinned context, and page excerpts are held in memory only — closing the side panel clears them.
- Both API keys are stored locally in `chrome.storage.local` and only sent to their configured base URLs.

## Files

- `manifest.json` — MV3 manifest (permissions: `tabs`, `tabGroups`, `storage`, `sidePanel`, `cookies`)
- `background.ts` / `background.js` — service worker: collects tabs, calls the LLM in batches, creates Chrome tab groups
- `popup.ts` / `popup.js` — side panel UI with three tabs: Action (group button + results), Chat (streaming chat + tab context pinning), and Settings (API keys, base URLs, model)
- `chat/pageContext.ts` / `chat/pageContext.js` — resolves pinned/current tabs and scrapes them via Firecrawl for chat context
- `popup.html` / `popup.css` — panel markup and styles

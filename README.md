# AI Tab Grouper

Chrome / Brave extension (Manifest V3) that groups your tabs by topic using any OpenAI-compatible LLM API, plus a built-in chat panel that can answer questions about your open tabs.

## Features

- **One-click tab grouping** — groups all tabs in the current window by topic, with names and colors chosen by the LLM.
- **Smart batching** — tabs are sent to the LLM in batches of 40, so large windows still group correctly. Results are merged into at most 8 groups.
- **Domain-aware separation** — tabs on the same domain are split into different groups when they represent distinct activities (e.g. `github.com/org-a` vs `github.com/org-b`), and kept together when they're part of one activity.
- **AI chat with streaming** — a built-in chat tab streams responses token-by-token. The conversation lives in memory only and clears when the panel closes.
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
4. Click **Test Connection**, then **Save**.

## Use

The extension opens as a **side panel** with three tabs:

- **Action** — click **Group My Tabs**. Tabs in the current window are grouped by topic with names and colors chosen by the LLM. Existing groups are cleared first, and the result list shows each group with its color and tab count.
- **Chat** — ask the AI anything. Responses stream in live. Use the **+** button to pin open tabs as context for your next message (search by title or domain), then send. Pinned context is prepended to your message and cleared after sending.
- **Settings** — API key, base URL, and model configuration.

## Privacy

- When grouping or pinning tab context, only tab **titles**, **registrable domains**, and **URL paths** are sent to the LLM. Query strings and fragments are stripped (so tokens/sensitive params don't leak).
- Chat messages and pinned context are held in memory only — closing the side panel clears the conversation.
- The API key is stored locally in `chrome.storage.local` and only sent to the base URL you configure.

## Files

- `manifest.json` — MV3 manifest (permissions: `tabs`, `tabGroups`, `storage`, `sidePanel`)
- `background.ts` / `background.js` — service worker: collects tabs, calls the LLM in batches, creates Chrome tab groups
- `popup.ts` / `popup.js` — side panel UI with three tabs: Action (group button + results), Chat (streaming chat + tab context pinning), and Settings (API key, base URL, model)
- `popup.html` / `popup.css` — panel markup and styles

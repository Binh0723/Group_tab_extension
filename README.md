# AI Tab Grouper

Chrome / Brave extension (Manifest V3) that groups your tabs by topic using any OpenAI-compatible LLM API.

## Install (Chrome)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder

## Install (Brave)

1. Open `brave://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

## Setup

1. Click the extension icon, then the **Settings** tab
2. Enter your API key (OpenAI by default)
3. Optional: change Base URL for OpenRouter, NVIDIA NIM, or local Ollama, then click **Load** to pick a model your key supports
4. Click **Test Connection**, then **Save**

## Use

Click the extension icon → **Action** tab → **Group My Tabs**. Tabs in the current window are grouped by topic with names and colors chosen by the LLM.

## Privacy

- Tab **titles**, **registrable domains**, and **URL paths** are sent to the LLM. Query strings and fragments are stripped (so tokens/sensitive params don't leak).
- The API key is stored locally in `chrome.storage.local` and only sent to the base URL you configure.

## Files

- `manifest.json` — MV3 manifest
- `background.js` — service worker: collects tabs, calls the LLM, creates groups
- `popup.html/js/css` — toolbar popup with two tabs: Action (group button + results) and Settings (API key, base URL, model)

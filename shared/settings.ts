// Shared settings access: the single source of truth for provider connection
// settings. Both the UI (settings panel, chat) and the background worker read
// through this module — nothing else touches chrome.storage for these keys.

import type { ExtensionSettings } from "./types.js";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o-mini";

const SETTING_KEYS = ["apiKey", "baseUrl", "model"] as const;

/** Read stored provider settings without touching any UI. */
export async function loadStoredSettings(): Promise<ExtensionSettings> {
  return (await chrome.storage.local.get([...SETTING_KEYS])) as ExtensionSettings;
}

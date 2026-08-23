// Types shared across the extension UI.

/** Raw values read from chrome.storage.local. */
export interface ExtensionSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** One entry in the in-memory chat transcript. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

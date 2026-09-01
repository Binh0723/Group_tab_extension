// Types shared across the extension UI.

/** Raw values read from chrome.storage.local. */
export interface ExtensionSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** A file selected for the next chat message. Kept in memory only. */
export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "text";
  /** Base64 data URL used for image content parts. */
  dataUrl?: string;
  /** Locally read text-file content. */
  text?: string;
  truncated?: boolean;
}

/** OpenAI-compatible multimodal content parts. */
export type ChatContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail?: "auto" | "low" | "high";
      };
    };

/** One entry in the in-memory chat transcript. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

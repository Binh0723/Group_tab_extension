// Local file reading for chat attachments.
// Files are kept in memory and are only included in the chat request when sent.

import type { ChatAttachment } from "../shared/types.js";

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
/** Approximately three to five pages for most plain-text documents. */
export const MAX_TEXT_CHARS = 25_000;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

const IMAGE_MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);
const ALLOWED_TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
  ".log"
]);

let nextAttachmentId = 1;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function newAttachmentId(): string {
  return `${Date.now()}-${nextAttachmentId++}`;
}

function imageMimeType(file: File): string | null {
  const declared = file.type.toLowerCase();
  if (ALLOWED_IMAGE_TYPES.has(declared)) return declared;
  return IMAGE_MIME_BY_EXTENSION.get(extensionOf(file.name)) || null;
}

function isImageFile(file: File): boolean {
  return imageMimeType(file) !== null;
}

function isTextFile(file: File): boolean {
  return file.type.toLowerCase().startsWith("text/") ||
    ALLOWED_TEXT_EXTENSIONS.has(extensionOf(file.name));
}

function readAsDataUrl(file: File, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        // Normalize the MIME prefix when a browser leaves File.type blank.
        resolve(reader.result.replace(/^data:[^;]*;/, `data:${mimeType};`));
      } else {
        reject(new Error(`Could not read ${file.name} as an image`));
      }
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled`));
    reader.readAsDataURL(file);
  });
}

/** Read one user-selected file without uploading it. */
export async function readAttachment(file: File): Promise<ChatAttachment> {
  const name = file.name || "untitled";
  const mimeType = file.type.toLowerCase() || "application/octet-stream";

  if (mimeType === "application/pdf" || extensionOf(name) === ".pdf") {
    throw new Error(`${name} is a PDF. PDF attachments are not supported yet.`);
  }

  const detectedImageMimeType = imageMimeType(file);
  if (detectedImageMimeType) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`${name} is too large. Images must be 5 MB or smaller.`);
    }
    return {
      id: newAttachmentId(),
      name,
      mimeType: detectedImageMimeType,
      size: file.size,
      kind: "image",
      dataUrl: await readAsDataUrl(file, detectedImageMimeType)
    };
  }

  if (isTextFile(file)) {
    if (file.size > MAX_TEXT_BYTES) {
      throw new Error(`${name} is too large. Text files must be 5 MB or smaller.`);
    }
    const rawText = await file.text();
    const truncated = rawText.length > MAX_TEXT_CHARS;
    return {
      id: newAttachmentId(),
      name,
      mimeType,
      size: file.size,
      kind: "text",
      text: truncated ? rawText.slice(0, MAX_TEXT_CHARS) : rawText,
      truncated
    };
  }

  throw new Error(`${name} is not supported. Upload an image or a text file.`);
}

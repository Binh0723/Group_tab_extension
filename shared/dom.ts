// Shared DOM helpers for the side panel UI.

/** A non-null element helper that throws if the id is missing from the DOM. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

/** Escape a string for safe interpolation via innerHTML. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render a success/error status box. */
export function showStatus(el: HTMLElement, text: string, ok: boolean): void {
  el.className = `status ${ok ? "success" : "error"}`;
  el.textContent = text;
}

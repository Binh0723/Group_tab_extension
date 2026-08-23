// Shared DOM helpers for the side panel UI.
/** A non-null element helper that throws if the id is missing from the DOM. */
export function $(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Element #${id} not found`);
    return el;
}
/** Escape a string for safe interpolation via innerHTML. */
export function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Render a success/error status box. */
export function showStatus(el, text, ok) {
    el.className = `status ${ok ? "success" : "error"}`;
    el.textContent = text;
}

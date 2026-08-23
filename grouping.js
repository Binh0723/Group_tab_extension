// Header ⧉ button: auto-group tabs immediately, no panel —
// feedback is flashed on the chat status line.
import { flashChatStatus } from "./chat/chat.js";
export function initGrouping() {
    const btn = document.getElementById("nav-action-btn");
    if (!btn)
        return;
    btn.addEventListener("click", async () => {
        btn.disabled = true;
        let response;
        try {
            response = (await chrome.runtime.sendMessage({ type: "GROUP_TABS" }));
        }
        catch {
            response = { ok: false, error: "Extension reloaded. Try again." };
        }
        if (!response.ok) {
            flashChatStatus(response.error || "Unknown error", 4000);
        }
        else if (!response.groups || response.groups.length === 0) {
            flashChatStatus(response.message || "No groupable tabs found.", 4000);
        }
        else {
            flashChatStatus(`Grouped ${response.tabCount} tabs into ${response.groups.length} groups.`);
        }
        btn.disabled = false;
    });
}

// Top-level navigation between Chat and Settings.
// Chat is the home view; the gear header button opens Settings,
// and clicking it again returns to the chat.
const panels = Array.from(document.querySelectorAll(".panel"));
const settingsBtn = document.getElementById("nav-settings-btn");
function isVisible(id) {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains("hidden");
}
export function switchTab(name) {
    panels.forEach((p) => p.classList.toggle("hidden", p.id !== name));
    settingsBtn?.classList.toggle("active", name === "settings");
}
settingsBtn?.addEventListener("click", () => switchTab(isVisible("settings") ? "chat" : "settings"));
// Start on chat every time the panel opens.
switchTab("chat");

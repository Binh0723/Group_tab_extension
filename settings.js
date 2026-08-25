// Settings panel: API key / base URL / model form, connection test, model listing.
import { $, showStatus } from "./shared/dom.js";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const SETTING_KEYS = [
    "apiKey",
    "baseUrl",
    "model",
    "firecrawlApiKey",
    "firecrawlBaseUrl"
];
const apiKeyEl = $("apiKey");
const baseUrlEl = $("baseUrl");
const modelEl = $("model");
const firecrawlApiKeyEl = $("firecrawlApiKey");
const firecrawlBaseUrlEl = $("firecrawlBaseUrl");
const modelsList = $("models-list");
const saveBtn = $("save-btn");
const testBtn = $("test-btn");
const loadModelsBtn = $("load-models-btn");
const settingsStatusEl = $("settings-status");
function currentBaseUrl() {
    return (baseUrlEl.value.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}
async function loadModels() {
    const apiKey = apiKeyEl.value.trim();
    if (!apiKey) {
        showStatus(settingsStatusEl, "Paste your API key first.", false);
        return;
    }
    loadModelsBtn.disabled = true;
    showStatus(settingsStatusEl, "Fetching models...", true);
    try {
        const res = await fetch(`${currentBaseUrl()}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` }
        });
        if (!res.ok) {
            showStatus(settingsStatusEl, `Failed to list models (${res.status}). Check key and base URL.`, false);
            return;
        }
        const data = (await res.json());
        const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
        const ids = items
            .map((m) => {
            if (typeof m === "string")
                return m;
            const obj = m;
            return obj?.id || obj?.name;
        })
            .filter((s) => Boolean(s))
            .sort((a, b) => a.localeCompare(b));
        modelsList.innerHTML = "";
        for (const id of ids) {
            const opt = document.createElement("option");
            opt.value = id;
            modelsList.appendChild(opt);
        }
        if (ids.length === 0) {
            showStatus(settingsStatusEl, "No models returned — you can still type a model name manually.", true);
        }
        else {
            showStatus(settingsStatusEl, `Loaded ${ids.length} models. Pick one or type your own.`, true);
        }
    }
    catch (err) {
        showStatus(settingsStatusEl, `Failed to list models: ${err.message}`, false);
    }
    loadModelsBtn.disabled = false;
}
/** Read stored settings without touching the form. Used by chat and the grouper UI. */
export async function loadStoredSettings() {
    return (await chrome.storage.local.get([...SETTING_KEYS]));
}
async function loadSettingsIntoForm() {
    const { apiKey, baseUrl, model, firecrawlApiKey, firecrawlBaseUrl } = await loadStoredSettings();
    apiKeyEl.value = apiKey || "";
    baseUrlEl.value = baseUrl || DEFAULT_BASE_URL;
    modelEl.value = model || DEFAULT_MODEL;
    firecrawlApiKeyEl.value = firecrawlApiKey || "";
    firecrawlBaseUrlEl.value = firecrawlBaseUrl || DEFAULT_FIRECRAWL_BASE_URL;
    if (apiKey)
        loadModels();
}
export function initSettings() {
    saveBtn.addEventListener("click", async () => {
        const apiKey = apiKeyEl.value.trim();
        const baseUrl = currentBaseUrl();
        const model = modelEl.value.trim();
        if (!apiKey) {
            showStatus(settingsStatusEl, "API key is required.", false);
            return;
        }
        if (!model) {
            showStatus(settingsStatusEl, "Model is required.", false);
            return;
        }
        try {
            new URL(baseUrl);
        }
        catch {
            showStatus(settingsStatusEl, "Base URL is not a valid URL.", false);
            return;
        }
        const firecrawlApiKey = firecrawlApiKeyEl.value.trim();
        const firecrawlBaseUrl = firecrawlBaseUrlEl.value.trim() || DEFAULT_FIRECRAWL_BASE_URL;
        try {
            new URL(firecrawlBaseUrl);
        }
        catch {
            showStatus(settingsStatusEl, "Firecrawl Base URL is not a valid URL.", false);
            return;
        }
        await chrome.storage.local.set({
            apiKey,
            baseUrl,
            model,
            firecrawlApiKey,
            firecrawlBaseUrl
        });
        showStatus(settingsStatusEl, "Settings saved.", true);
    });
    testBtn.addEventListener("click", async () => {
        const apiKey = apiKeyEl.value.trim();
        const baseUrl = currentBaseUrl();
        if (!apiKey) {
            showStatus(settingsStatusEl, "Enter API key first.", false);
            return;
        }
        testBtn.disabled = true;
        showStatus(settingsStatusEl, "Testing...", true);
        try {
            const res = await fetch(`${baseUrl}/models`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            if (res.ok)
                showStatus(settingsStatusEl, "Connection OK.", true);
            else
                showStatus(settingsStatusEl, `Connection failed (${res.status}). Check key, URL, and model.`, false);
        }
        catch (err) {
            showStatus(settingsStatusEl, `Connection failed: ${err.message}`, false);
        }
        testBtn.disabled = false;
    });
    loadModelsBtn.addEventListener("click", loadModels);
    loadSettingsIntoForm();
}

// Settings panel UI: API key / base URL / model form, connection test, model
// listing. All API access goes through shared/llm.ts; storage through
// shared/settings.ts.

import { $, showStatus } from "./shared/dom.js";
import { loadStoredSettings, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./shared/settings.js";
import { listModels, testConnection, LlmHttpError } from "./shared/llm.js";

const apiKeyEl = $<HTMLInputElement>("apiKey");
const baseUrlEl = $<HTMLInputElement>("baseUrl");
const modelEl = $<HTMLInputElement>("model");
const modelsList = $<HTMLDataListElement>("models-list");
const saveBtn = $<HTMLButtonElement>("save-btn");
const testBtn = $<HTMLButtonElement>("test-btn");
const loadModelsBtn = $<HTMLButtonElement>("load-models-btn");
const settingsStatusEl = $<HTMLElement>("settings-status");

// Removed feature: Firecrawl-based scraping. Purge any previously stored keys.
void chrome.storage.local.remove(["firecrawlApiKey", "firecrawlBaseUrl"]);

function currentBaseUrl(): string {
  return (baseUrlEl.value.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function formConfig(): { apiKey: string; baseUrl: string } {
  return { apiKey: apiKeyEl.value.trim(), baseUrl: currentBaseUrl() };
}

async function loadModels(): Promise<void> {
  const config = formConfig();
  if (!config.apiKey) {
    showStatus(settingsStatusEl, "Paste your API key first.", false);
    return;
  }
  loadModelsBtn.disabled = true;
  showStatus(settingsStatusEl, "Fetching models...", true);
  try {
    const ids = await listModels(config);
    modelsList.innerHTML = "";
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      modelsList.appendChild(opt);
    }
    if (ids.length === 0) {
      showStatus(settingsStatusEl, "No models returned — you can still type a model name manually.", true);
    } else {
      showStatus(settingsStatusEl, `Loaded ${ids.length} models. Pick one or type your own.`, true);
    }
  } catch (err) {
    showStatus(settingsStatusEl, `Failed to list models: ${(err as Error).message}`, false);
  }
  loadModelsBtn.disabled = false;
}

async function loadSettingsIntoForm(): Promise<void> {
  const { apiKey, baseUrl, model } = await loadStoredSettings();
  apiKeyEl.value = apiKey || "";
  baseUrlEl.value = baseUrl || DEFAULT_BASE_URL;
  modelEl.value = model || DEFAULT_MODEL;
  if (apiKey) loadModels();
}

export function initSettings(): void {
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
    } catch {
      showStatus(settingsStatusEl, "Base URL is not a valid URL.", false);
      return;
    }
    await chrome.storage.local.set({ apiKey, baseUrl, model });
    showStatus(settingsStatusEl, "Settings saved.", true);
  });

  testBtn.addEventListener("click", async () => {
    const config = formConfig();
    if (!config.apiKey) {
      showStatus(settingsStatusEl, "Enter API key first.", false);
      return;
    }
    testBtn.disabled = true;
    showStatus(settingsStatusEl, "Testing...", true);
    try {
      await testConnection(config);
      showStatus(settingsStatusEl, "Connection OK.", true);
    } catch (err) {
      const status = err instanceof LlmHttpError ? ` (${err.status})` : "";
      showStatus(settingsStatusEl, `Connection failed${status}. Check key, URL, and model.`, false);
    }
    testBtn.disabled = false;
  });

  loadModelsBtn.addEventListener("click", loadModels);

  loadSettingsIntoForm();
}

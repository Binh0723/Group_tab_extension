const COLOR_HEX = {
  grey: "#9aa0a6",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#ff63b8",
  purple: "#a142f4",
  cyan: "#24c1e0",
  orange: "#fa903e"
};

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

const apiKeyEl = document.getElementById("apiKey");
const baseUrlEl = document.getElementById("baseUrl");
const modelEl = document.getElementById("model");
const modelsList = document.getElementById("models-list");
const saveBtn = document.getElementById("save-btn");
const testBtn = document.getElementById("test-btn");
const loadModelsBtn = document.getElementById("load-models-btn");
const settingsStatusEl = document.getElementById("settings-status");

const groupBtn = document.getElementById("group-btn");
const actionStatusEl = document.getElementById("action-status");
const groupList = document.getElementById("group-list");
const keyWarning = document.getElementById("key-warning");

function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle("hidden", p.id !== name));
}

tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
document.getElementById("warning-link").addEventListener("click", (e) => {
  e.preventDefault();
  switchTab("settings");
});

function showStatus(el, text, ok) {
  el.className = `status ${ok ? "success" : "error"}`;
  el.textContent = text;
}

function currentBaseUrl() {
  return (baseUrlEl.value.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
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
    const data = await res.json();
    const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const ids = items
      .map((m) => (typeof m === "string" ? m : m?.id || m?.name))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
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
    showStatus(settingsStatusEl, `Failed to list models: ${err.message}`, false);
  }
  loadModelsBtn.disabled = false;
}

async function loadSettings() {
  const { apiKey, baseUrl, model } = await chrome.storage.local.get(["apiKey", "baseUrl", "model"]);
  apiKeyEl.value = apiKey || "";
  baseUrlEl.value = baseUrl || "https://api.openai.com/v1";
  modelEl.value = model || "gpt-4o-mini";
  if (!apiKey) keyWarning.classList.remove("hidden");
  else keyWarning.classList.add("hidden");
  if (apiKey) loadModels();
}

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
  keyWarning.classList.add("hidden");
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
    if (res.ok) showStatus(settingsStatusEl, "Connection OK.", true);
    else showStatus(settingsStatusEl, `Connection failed (${res.status}). Check key, URL, and model.`, false);
  } catch (err) {
    showStatus(settingsStatusEl, `Connection failed: ${err.message}`, false);
  }
  testBtn.disabled = false;
});

loadModelsBtn.addEventListener("click", loadModels);

groupBtn.addEventListener("click", async () => {
  groupBtn.disabled = true;
  actionStatusEl.className = "status";
  actionStatusEl.textContent = "Analyzing tabs...";
  actionStatusEl.classList.remove("hidden");
  groupList.classList.add("hidden");
  groupList.innerHTML = "";

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "GROUP_TABS" });
  } catch {
    response = { ok: false, error: "Extension reloaded. Try again." };
  }

  if (!response.ok) {
    actionStatusEl.className = "status error";
    actionStatusEl.textContent = response.error || "Unknown error";
  } else if (response.groups.length === 0) {
    actionStatusEl.className = "status success";
    actionStatusEl.textContent = response.message || "No groupable tabs found.";
  } else {
    actionStatusEl.className = "status success";
    actionStatusEl.textContent = `Grouped ${response.tabCount} tabs into ${response.groups.length} groups.`;
    for (const g of response.groups) {
      const li = document.createElement("li");
      const left = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = COLOR_HEX[g.color] || "#9aa0a6";
      left.appendChild(dot);
      left.appendChild(document.createTextNode(g.name));
      const count = document.createElement("span");
      count.textContent = g.count;
      count.style.color = "#6b7280";
      li.appendChild(left);
      li.appendChild(count);
      groupList.appendChild(li);
    }
    groupList.classList.remove("hidden");
  }
  groupBtn.disabled = false;
});

loadSettings();

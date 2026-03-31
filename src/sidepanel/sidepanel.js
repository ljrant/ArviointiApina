const elSiteBadge = document.getElementById("site-badge");
const elCurrentPage = document.getElementById("current-page");
const elToolsList = document.getElementById("tools-list");
const elLog = document.getElementById("log");

const btnUploadCsv = document.getElementById("btn-upload-csv");
const btnRefresh = document.getElementById("btn-refresh");
const inputCsv = document.getElementById("csv-file");

function log(message) {
  const line =
    typeof message === "string"
      ? message
      : JSON.stringify(message, null, 2);

  elLog.textContent = line + "\n\n" + elLog.textContent;
}

async function getRegistry() {
  return await import(chrome.runtime.getURL("src/adapters/registry.js"));
}

async function getActiveTab() {
  const res = await chrome.runtime.sendMessage({
    type: "GET_ACTIVE_TAB_INFO"
  });

  if (!res?.ok || !res.tab) {
    throw new Error("Failed to get active tab");
  }

  return res.tab;
}

function isAbittiUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "oma.abitti.fi";
  } catch {
    return false;
  }
}

async function sendToPage(tab, message) {
  const res = await chrome.tabs.sendMessage(tab.id, {
    ...message,
    target: "page-adapter"
  });

  return res;
}

function renderTools(tools) {
  if (!tools.length) {
    elToolsList.textContent = "No tools available";
    return;
  }

  elToolsList.innerHTML = "";

  for (const tool of tools) {
    const div = document.createElement("div");
    div.className = "tool-chip";
    div.textContent = tool;
    elToolsList.appendChild(div);
  }
}

async function refresh() {
  try {
    elCurrentPage.textContent = "Loading...";
    elToolsList.textContent = "Loading...";

    const tab = await getActiveTab();
    const url = tab.url || "";

    elCurrentPage.textContent = `${tab.title || "(no title)"}\n${url || "(no url)"}`;

    const registry = await getRegistry();
    const site = registry.detectSiteFromUrl(url);

    if (site) {
      elSiteBadge.textContent = site.label;
    } else {
      elSiteBadge.textContent = "Unsupported";
    }

    const tools = registry.getAvailableSiteTools(url);
    renderTools(tools);

    log("Refreshed");
  } catch (error) {
    console.error(error);
    log(error instanceof Error ? error.message : String(error));
  }
}

btnRefresh.addEventListener("click", refresh);

btnUploadCsv.addEventListener("click", () => {
  inputCsv.click();
});

inputCsv.addEventListener("change", async () => {
  try {
    const file = inputCsv.files?.[0];
    if (!file) return;

    const tab = await getActiveTab();
    const url = tab.url || "";

    if (!isAbittiUrl(url)) {
      throw new Error("CSV import works only on oma.abitti.fi grading pages.");
    }

    const text = await file.text();

    log("Sending CSV to page...");

    const res = await sendToPage(tab, {
      action: "ABITTI_IMPORT_CSV_TEXT",
      csvText: text
    });

    log(res);
  } catch (error) {
    console.error(error);
    log(error instanceof Error ? error.message : String(error));
  } finally {
    inputCsv.value = "";
  }
});

refresh();

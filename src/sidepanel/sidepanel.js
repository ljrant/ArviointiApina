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

async function getActiveTab() {
  const res = await chrome.runtime.sendMessage({
    type: "GET_ACTIVE_TAB_INFO"
  });

  if (!res?.ok || !res.tab) {
    throw new Error("Failed to get active tab");
  }

  return res.tab;
}

async function detectSite(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const mod = await import(
        chrome.runtime.getURL("src/adapters/registry.js")
      );

      return mod.detectSiteFromUrl(window.location.href);
    }
  });

  return result;
}

async function getTools(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const mod = await import(
        chrome.runtime.getURL("src/adapters/registry.js")
      );

      return mod.getAvailableSiteTools(window.location.href);
    }
  });

  return result || [];
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

    elCurrentPage.textContent = `${tab.title}\n${tab.url}`;

    const site = await detectSite(tab);

    if (site) {
      elSiteBadge.textContent = site.label;
    } else {
      elSiteBadge.textContent = "Unsupported";
    }

    const tools = await getTools(tab);
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

    const text = await file.text();

    const tab = await getActiveTab();

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

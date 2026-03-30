
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Arviointiapina] Extension installed");
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Arviointiapina] Browser startup");
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error("[Arviointiapina] Failed to set side panel behavior", error);
  });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case "PING": {
          sendResponse({
            ok: true,
            pong: true,
            from: "service-worker"
          });
          return;
        }

        case "GET_ACTIVE_TAB_INFO": {
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
          });

          sendResponse({
            ok: true,
            tab: tab
              ? {
                  id: tab.id,
                  url: tab.url || "",
                  title: tab.title || ""
                }
              : null
          });
          return;
        }

        default: {
          sendResponse({
            ok: false,
            error: `Unknown message type: ${message?.type || "(missing type)"}`
          });
        }
      }
    } catch (error) {
      console.error("[Arviointiapina] Service worker message error", error);

      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  return true;
});

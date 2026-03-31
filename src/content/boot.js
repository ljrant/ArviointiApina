import { getAdapterForCurrentPage } from "../adapters/registry.js";

(async function boot() {
  try {
    const adapter = getAdapterForCurrentPage(window.location.href);

    if (!adapter) {
      console.log("[Arviointiapina] No adapter for this page");
      return;
    }

    console.log(`[Arviointiapina] Booting adapter: ${adapter.id}`);

    if (typeof adapter.init === "function") {
      await adapter.init();
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.target !== "page-adapter") {
        return;
      }

      (async () => {
        try {
          if (typeof adapter.handleMessage !== "function") {
            sendResponse({
              ok: false,
              error: `Adapter ${adapter.id} does not implement handleMessage`
            });
            return;
          }

          const result = await adapter.handleMessage(message);
          sendResponse({ ok: true, result });
        } catch (error) {
          console.error("[Arviointiapina] Adapter message error", error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })();

      return true;
    });
  } catch (error) {
    console.error("[Arviointiapina] Boot error", error);
  }
})();

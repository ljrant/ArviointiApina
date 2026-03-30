export const abittiAdapter = {
  id: "abitti",
  label: "Abitti",

  /* ---------------------------
     SITE MATCHING
  --------------------------- */

  matches(url) {
    try {
      const u = new URL(url);
      return u.hostname === "oma.abitti.fi";
    } catch {
      return false;
    }
  },

  /* ---------------------------
     TOOL DETECTION
  --------------------------- */

  getAvailableTools(url) {
    const path = new URL(url).pathname;

    // Grading page (CSV import target)
    if (/^\/school\/grading\/.+/.test(path)) {
      return [
        "Import grades CSV to current question",
        "Import teacher notes to current question"
      ];
    }

    // Review page (auto grading)
    if (/^\/school\/review\/.+/.test(path)) {
      return [
        "Auto grading",
        "Preview calculated grades"
      ];
    }

    return [];
  },

  /* ---------------------------
     INIT (runs on page load)
  --------------------------- */

  async init() {
    console.log("[Arviointiapina] Abitti adapter initialized");
  },

  /* ---------------------------
     MESSAGE HANDLER (future tools)
  --------------------------- */

  async handleMessage(message) {
    switch (message?.action) {
      case "PING_ADAPTER":
        return {
          ok: true,
          adapter: "abitti"
        };

      default:
        return {
          ok: false,
          error: `Unknown action: ${message?.action}`
        };
    }
  }
};

import { importGradesAndNotesFromCsvText } from "./writer.js";

function getPathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

export const abittiAdapter = {
  id: "abitti",
  label: "Abitti",

  matches(url) {
    try {
      const u = new URL(url);
      return u.hostname === "oma.abitti.fi";
    } catch {
      return false;
    }
  },

  getAvailableTools(url) {
    const path = getPathname(url);

    if (/^\/school\/grading\/.+/.test(path)) {
      return [
        "Import grades CSV to current question",
        "Import teacher notes to current question"
      ];
    }

    if (/^\/school\/review\/.+/.test(path)) {
      return [
        "Auto grading",
        "Preview calculated grades"
      ];
    }

    return [];
  },

  async init() {
    console.log("[Arviointiapina] Abitti adapter initialized");
  },

  async handleMessage(message) {
    switch (message?.action) {
      case "PING_ADAPTER":
        return {
          ok: true,
          adapter: "abitti"
        };

      case "ABITTI_IMPORT_CSV_TEXT": {
        if (!message.csvText || typeof message.csvText !== "string") {
          return {
            ok: false,
            error: "Missing csvText"
          };
        }

        return await importGradesAndNotesFromCsvText(message.csvText);
      }

      default:
        return {
          ok: false,
          error: `Unknown action: ${message?.action}`
        };
    }
  }
};

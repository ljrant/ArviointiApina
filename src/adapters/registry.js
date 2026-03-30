import { abittiAdapter } from "./abitti/adapter.js";

const ADAPTERS = [
  abittiAdapter
];

export function detectSiteFromUrl(url) {
  const adapter = getAdapterForCurrentPage(url);

  if (!adapter) return null;

  return {
    id: adapter.id,
    label: adapter.label
  };
}

export function getAdapterForCurrentPage(url) {
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.matches(url)) {
        return adapter;
      }
    } catch (error) {
      console.error(
        `[Arviointiapina] Adapter match error for ${adapter.id}`,
        error
      );
    }
  }

  return null;
}

export function getAvailableSiteTools(url) {
  const adapter = getAdapterForCurrentPage(url);

  if (!adapter) return [];

  if (typeof adapter.getAvailableTools !== "function") {
    return [];
  }

  try {
    return adapter.getAvailableTools(url) || [];
  } catch (error) {
    console.error(
      `[Arviointiapina] getAvailableTools error for ${adapter.id}`,
      error
    );
    return [];
  }
}

export function listRegisteredAdapters() {
  return ADAPTERS.map((adapter) => ({
    id: adapter.id,
    label: adapter.label
  }));
}

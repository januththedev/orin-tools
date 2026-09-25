import type { ProviderEntry } from "./types.js";
export const PROVIDER_REGISTRY: readonly ProviderEntry[] = [
  { id: "searx", origin: "https://searx.be", pathPrefix: "/search", kind: "searxng" },
  { id: "searx-inetol", origin: "https://search.inetol.net", pathPrefix: "/search", kind: "searxng" },
  { id: "baresearch", origin: "https://baresearch.org", pathPrefix: "/search", kind: "searxng" },
  { id: "google-news", origin: "https://news.google.com", pathPrefix: "/rss/search", kind: "news" },
  { id: "wikipedia", origin: "https://en.wikipedia.org", pathPrefix: "/w/api.php", kind: "wikipedia" },
  { id: "duckduckgo", origin: "https://html.duckduckgo.com", pathPrefix: "/html/", kind: "duckduckgo" },
  { id: "open-meteo-geocode", origin: "https://geocoding-api.open-meteo.com", pathPrefix: "/v1/search", kind: "geocode" },
  { id: "open-meteo", origin: "https://api.open-meteo.com", pathPrefix: "/v1/forecast", kind: "weather" },
];
export function provider(id: string): ProviderEntry { const entry = PROVIDER_REGISTRY.find((item) => item.id === id); if (!entry) throw new Error("provider is not registered"); return entry; }
export function providerUrl(entry: ProviderEntry, params: Record<string, string | number>): URL { const url = new URL(entry.origin); url.pathname = entry.pathPrefix; for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value)); if (url.origin !== entry.origin || !url.pathname.startsWith(entry.pathPrefix)) throw new Error("provider URL escaped registry"); return url; }

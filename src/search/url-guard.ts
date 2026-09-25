import { lookup } from "node:dns/promises";
import { isPublicAddress } from "@orin/security";
import { SearchError } from "./errors.js";
export function assertPublicUrl(raw: string): URL { const url = new URL(raw); if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port) throw new SearchError(400, "ORIN_UNSAFE_URL", "Unsafe provider URL."); const literal = url.hostname.replace(/^\[|\]$/g, ""); if (/^[0-9.]+$/.test(literal) || literal.includes(":")) { if (!isPublicAddress(literal)) throw new SearchError(400, "ORIN_UNSAFE_URL", "Unsafe provider address."); } return url; }
export async function assertPublicDns(hostname: string): Promise<void> { if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) return; const addresses = await lookup(hostname, { all: true, verbatim: true }); if (!addresses.length || addresses.some((address) => !isPublicAddress(address.address))) throw new SearchError(400, "ORIN_UNSAFE_URL", "Provider DNS resolved to an unsafe address."); }
export function normalizeResultLink(raw: string): string { const url = assertPublicUrl(raw); url.hash = ""; return url.toString(); }

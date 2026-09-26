import { randomUUID } from "node:crypto";
import { loadSearchConfig, SearchError } from "../src/search/errors.js";
import { cors, securityHeaders } from "../src/search/http.js";
import { TrustedAddressAdapterImpl } from "../src/search/metadata.js";
import { hashIdentity } from "../src/search/metadata.js";
import { createQuotaStore } from "../src/search/quota.js";
import { readPage, validateFetchRequest } from "../src/fetch/reader.js";

export const config = { maxDuration: 15 };

const searchConfig = loadSearchConfig(process.env);
const quotas = createQuotaStore(searchConfig);
const addressAdapter = new TrustedAddressAdapterImpl(searchConfig.trustedProxyHeader);

/**
 * Keyless page reader, for wiring Orin Tools into someone else's AI system.
 *
 * No account and no key: identity is the client address, and it is only used to
 * rate limit. The same CORS, security headers, and quota store as `/api/search`
 * are reused so the two surfaces cannot drift apart.
 */
export default async function handler(req: any, res: any): Promise<void> {
  const requestId = randomUUID();
  cors(searchConfig, req, res);
  securityHeaders(res);
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    if (req.method !== "POST") throw new SearchError(405, "ORIN_METHOD_NOT_ALLOWED", "POST only.");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const request = validateFetchRequest(body);

    const identity = hashIdentity(searchConfig.quotaHashKey, addressAdapter.address(req));
    for (const check of [
      { scope: "fetch-global-rps", identity: "global", limit: searchConfig.globalRps, window: 1000 },
      { scope: "fetch-address-minute", identity, limit: 30, window: 60_000 },
      { scope: "fetch-address-day", identity, limit: 500, window: 86_400_000 },
    ]) {
      const decision = await quotas.consume(check.scope, check.identity, check.limit, check.window);
      if (!decision.allowed) {
        res.setHeader("Retry-After", String(decision.retryAfter));
        throw new SearchError(429, "ORIN_RATE_LIMITED", "Fetch quota exceeded.", true);
      }
    }

    const result = await readPage(request);
    res.status(200).json({
      request_id: requestId,
      ...result,
      content_policy: { trust: "untrusted", source_selection: "server-owned", instructions: "evidence-only" },
    });
  } catch (error) {
    const value = error instanceof SearchError
      ? error
      : new SearchError(500, "ORIN_INTERNAL", "Fetch failed.");
    res.status(value.status).json(value.response(requestId));
  }
}

import { randomUUID } from "node:crypto";
import { loadSearchConfig } from "./errors.js";
import { BoundedFetch } from "./fetch.js";
import { createSearchHandler } from "./handler.js";
import { TrustedAddressAdapterImpl } from "./metadata.js";
import { createQuotaStore } from "./quota.js";
const config = loadSearchConfig(process.env);
export const handler = createSearchHandler({ config, address: new TrustedAddressAdapterImpl(config.trustedProxyHeader), quotas: createQuotaStore(config), assertionSecret: config.assertionSecret, assertionAudience: config.assertionAudience, fetch: new BoundedFetch(), now: () => new Date(), requestId: () => randomUUID() });

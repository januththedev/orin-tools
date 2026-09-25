import { describe, expect, it } from "vitest";
import { MemoryQuotaStore } from "../../src/search/quota.js";
describe("quota", () => { it("fails deterministically", async () => { const q = new MemoryQuotaStore(() => 0); expect((await q.consume("a", "id", 2, 1000)).allowed).toBe(true); expect((await q.consume("a", "id", 2, 1000)).allowed).toBe(true); expect((await q.consume("a", "id", 2, 1000)).allowed).toBe(false); }); });

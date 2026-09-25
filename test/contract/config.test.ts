import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
describe("Vercel config", () => { it("has bounded search and disabled run", async () => { const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8")); expect(config.functions["api/search.ts"].maxDuration).toBe(10); expect(config.functions["api/run.ts"].maxDuration).toBe(10); }); });

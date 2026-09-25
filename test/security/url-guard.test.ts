import { describe, expect, it } from "vitest";
import { assertPublicUrl, normalizeResultLink } from "../../src/search/url-guard.js";
describe("URL policy", () => { it("rejects unsafe schemes, credentials, and private hosts", () => { for (const value of ["file:///tmp/x", "http://127.0.0.1/x", "https://user:pass@example.com/x", "https://169.254.169.254/latest"]) expect(() => assertPublicUrl(value)).toThrow(); }); it("normalizes public result links", () => { expect(normalizeResultLink("https://example.com/a#x")).toBe("https://example.com/a"); }); });

import { describe, expect, it, vi } from "vitest";
import { contentTypeAllowed, htmlToText, readPage, validateFetchRequest } from "../../src/fetch/reader.js";

/** Bypass DNS so the tests exercise response handling, not the resolver. */
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

const html = `<!doctype html><html><head><style>.a{color:red}</style><script>alert('x')</script></head>
<body><h1>Title</h1><p>Hello &amp; welcome</p><div>Second</div><!-- hidden --></body></html>`;

/** `fetch` returns a promise, so the injected stand-ins must too. */
function respond(body: string, init: ResponseInit = {}) {
  return async () => new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });
}

describe("keyless page reader", () => {
  it("validates the request", () => {
    expect(validateFetchRequest({ url: "https://example.com/a" })).toEqual({ url: "https://example.com/a", maxChars: 40_000 });
    expect(() => validateFetchRequest({})).toThrow(/url is required/);
    expect(() => validateFetchRequest({ url: "https://e.com", maxChars: 10 })).toThrow(/maxChars/);
    expect(() => validateFetchRequest({ url: `https://e.com/${"x".repeat(2100)}` })).toThrow(/under 2048/);
  });

  it("refuses non-web schemes and credential-bearing URLs before any request", async () => {
    const fetchImpl = vi.fn();
    for (const url of ["file:///etc/passwd", "ftp://example.com/x", "https://user:pw@example.com/"]) {
      await expect(readPage({ url }, fetchImpl as never)).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns a page into readable text and drops script and style content", async () => {
    const result = await readPage({ url: "https://example.com/" }, respond(html) as never);
    expect(result.status).toBe(200);
    expect(result.text).toContain("Title");
    expect(result.text).toContain("Hello & welcome");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toContain("color:red");
    expect(result.text).not.toContain("hidden");
  });

  it("rejects content types it cannot read rather than passing bytes through", async () => {
    const binary = async () => new Response("MZ", { status: 200, headers: { "content-type": "application/octet-stream" } });
    await expect(readPage({ url: "https://example.com/x.exe" }, binary as never)).rejects.toThrow(/not supported/);
    expect(contentTypeAllowed("text/html; charset=utf-8")).toBe(true);
    expect(contentTypeAllowed("application/octet-stream")).toBe(false);
  });

  it("re-checks the safety rules on every redirect hop", async () => {
    const hops: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      hops.push(input);
      if (hops.length === 1) return new Response(null, { status: 302, headers: { location: "https://example.com/second" } });
      return new Response("<p>final</p>", { status: 200, headers: { "content-type": "text/html" } });
    });
    const result = await readPage({ url: "https://example.com/first" }, fetchImpl as never);
    expect(result.finalUrl).toBe("https://example.com/second");
    expect(result.text).toContain("final");
    expect(fetchImpl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: "manual" }));
  });

  it("refuses a redirect that leaves the public web", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/admin" } }));
    await expect(readPage({ url: "https://example.com/go" }, fetchImpl as never)).rejects.toThrow(/public web address/);
  });

  it("stops after too many redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } }));
    await expect(readPage({ url: "https://example.com/loop" }, fetchImpl as never)).rejects.toThrow(/Too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("refuses an oversized body instead of buffering it", async () => {
    const huge = async () => new Response("x".repeat(2_000_000), { status: 200, headers: { "content-type": "text/plain" } });
    await expect(readPage({ url: "https://example.com/big" }, huge as never)).rejects.toThrow(/too large/);

    const declared = async () => new Response("small", { status: 200, headers: { "content-type": "text/plain", "content-length": "9999999" } });
    await expect(readPage({ url: "https://example.com/big2" }, declared as never)).rejects.toThrow(/too large/);
  });

  it("truncates to the requested length and says so", async () => {
    const long = async () => new Response("<p>" + "word ".repeat(500) + "</p>", { status: 200, headers: { "content-type": "text/html" } });
    const result = await readPage({ url: "https://example.com/long", maxChars: 200 }, long as never);
    expect(result.text.length).toBeLessThanOrEqual(200);
    expect(result.truncated).toBe(true);
  });

  it("reports an upstream failure without leaking internals", async () => {
    const notFound = async () => new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
    await expect(readPage({ url: "https://example.com/missing" }, notFound as never)).rejects.toThrow(/HTTP 404/);
  });
});

describe("html to text", () => {
  it("keeps prose and drops markup", () => {
    expect(htmlToText("<p>a</p><p>b</p>")).toBe("a\n\nb");
    expect(htmlToText("<div>x<br>y</div>")).toBe("x\ny");
    expect(htmlToText("<!-- note -->text")).toBe("text");
  });
});

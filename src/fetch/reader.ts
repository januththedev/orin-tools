import { assertPublicDns, assertPublicUrl } from "../search/url-guard.js";
import { SearchError } from "../search/errors.js";

/**
 * Keyless page reader for browser use.
 *
 * Orin Tools is meant to be wired into someone else's AI system without an
 * Orin account, so this is deliberately small and deliberately hostile to
 * anything that is not "fetch one public web page and return its text".
 */

export const FETCH_POLICY = Object.freeze({
  maxUrlChars: 2048,
  maxRedirects: 3,
  maxBytes: 1_000_000,
  timeoutMs: 10_000,
  maxTextChars: 40_000,
  allowedContentTypes: [
    "text/html",
    "text/plain",
    "text/markdown",
    "application/json",
    "application/xhtml+xml",
  ],
});

export interface FetchRequest { url: string; maxChars?: number; }
export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  text: string;
  truncated: boolean;
  fetchedAt: string;
}

export function validateFetchRequest(body: unknown): FetchRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SearchError(400, "ORIN_VALIDATION_FAILED", "Body must be a JSON object.");
  const value = body as Record<string, unknown>;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url || url.length > FETCH_POLICY.maxUrlChars) throw new SearchError(400, "ORIN_VALIDATION_FAILED", "url is required and must be under 2048 characters.");
  const maxChars = value.maxChars === undefined ? FETCH_POLICY.maxTextChars : Number(value.maxChars);
  if (!Number.isInteger(maxChars) || maxChars < 200 || maxChars > FETCH_POLICY.maxTextChars) {
    throw new SearchError(400, "ORIN_VALIDATION_FAILED", `maxChars must be an integer from 200 to ${FETCH_POLICY.maxTextChars}.`);
  }
  return { url, maxChars };
}

export function contentTypeAllowed(contentType: string): boolean {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return FETCH_POLICY.allowedContentTypes.includes(base);
}

/**
 * Strip markup down to readable text without pulling in a parser dependency.
 *
 * Script, style, and template contents are removed entirely rather than
 * stripped, because their contents are never prose and leaving them in would
 * hand a caller executable-looking noise.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|table|ul|ol)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    // Collapse horizontal whitespace, then drop blank-line runs, so block
    // breaks survive but inline noise does not.
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fetch a page, validating safety again on every redirect hop.
 *
 * Redirects are followed manually rather than by `redirect: "follow"`, because
 * a target that passed the URL check can redirect to one that did not. Each hop
 * is re-checked against the same rules as the first.
 */
export async function readPage(
  request: FetchRequest,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<FetchResult> {
  let current: URL;
  try {
    current = assertPublicUrl(request.url);
  } catch {
    throw new SearchError(400, "ORIN_UNSAFE_URL", "That URL is not a fetchable public web address.");
  }

  const deadline = AbortSignal.timeout(FETCH_POLICY.timeoutMs);
  let redirects = 0;

  for (;;) {
    await assertPublicDns(current.hostname).catch(() => {
      throw new SearchError(400, "ORIN_UNSAFE_URL", "That host does not resolve to a public address.");
    });

    const response = await fetchImpl(current.toString(), {
      redirect: "manual",
      signal: deadline,
      headers: { accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9", "user-agent": "OrinTools/1.0 (+https://tools.orinai.org)" },
    }).catch((error: unknown) => {
      throw new SearchError(502, "ORIN_FETCH_FAILED", error instanceof Error ? `Could not reach ${current.hostname}.` : "Could not reach the host.", true);
    });

    if (response.status >= 300 && response.status < 400) {
      if (redirects >= FETCH_POLICY.maxRedirects) throw new SearchError(502, "ORIN_TOO_MANY_REDIRECTS", "Too many redirects.", true);
      const location = response.headers.get("location");
      if (!location) throw new SearchError(502, "ORIN_FETCH_FAILED", "Redirect had no destination.", true);
      redirects += 1;
      let next: URL;
      try {
        next = assertPublicUrl(new URL(location, current).toString());
      } catch {
        throw new SearchError(400, "ORIN_UNSAFE_URL", "A redirect pointed somewhere that is not a public web address.");
      }
      current = next;
      continue;
    }

    if (!response.ok) throw new SearchError(502, "ORIN_FETCH_FAILED", `The page returned HTTP ${response.status}.`, response.status >= 500);

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    if (!contentTypeAllowed(contentType)) {
      throw new SearchError(415, "ORIN_UNSUPPORTED_CONTENT_TYPE", "That content type is not supported. Use an HTML, plain text, Markdown, or JSON page.");
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > FETCH_POLICY.maxBytes) {
      throw new SearchError(413, "ORIN_RESPONSE_TOO_LARGE", "That page is too large to read.");
    }

    const body = await readBounded(response, FETCH_POLICY.maxBytes);

    const text = contentType.split(";")[0]?.trim().toLowerCase() === "application/json"
      ? body
      : htmlToText(body);

    const limit = request.maxChars ?? FETCH_POLICY.maxTextChars;
    return {
      url: request.url,
      finalUrl: current.toString(),
      status: response.status,
      contentType,
      text: text.slice(0, limit),
      truncated: text.length > limit,
      fetchedAt: now.toISOString(),
    };
  }
}

/** Read at most `limit` bytes so a hostile response cannot exhaust memory. */
async function readBounded(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) { await reader.cancel().catch(() => {}); throw new SearchError(413, "ORIN_RESPONSE_TOO_LARGE", "That page is too large to read."); }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

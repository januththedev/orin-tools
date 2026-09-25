import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { loadSearchConfig, SearchError } from "../src/search/errors.js";
import { TrustedAddressAdapterImpl, clientCookie, validCookie } from "../src/search/metadata.js";
import { MemoryRunQuota, RedisRunQuota, RunQuotaUnavailable } from "../src/run/quota.js";
import { RUN_POLICY, validateRunRequest } from "../src/run/policy.js";

export const config = { maxDuration: 60 };

function disabled(res: any, requestId: string, message = "Public code execution is disabled.") {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(410).json({ error: { code: "ORIN_RUN_DISABLED", message, retryable: false, retry_after: null, request_id: requestId } });
}

function quotaFor(mode: string, url: string, token: string) {
  return mode === "fake" ? new MemoryRunQuota() : new RedisRunQuota(url, token);
}

function cookieFor(req: any, secret: string) {
  const match = /(?:^|;\s*)orin_tools_run_cid=([^;]+)/.exec(String(req.headers?.cookie || ""));
  const value = validCookie(secret, match?.[1]) ? match![1] : clientCookie(secret);
  return { value, header: `orin_tools_run_cid=${value}; Path=/api/run; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax` };
}

export default async function handler(req: any, res: any) {
  const requestId = String(req.headers?.["x-request-id"] || randomUUID());
  if (process.env.ORIN_RUNNER_MODE !== "vercel-sandbox") return disabled(res, requestId);
  if (req.method !== "POST") return res.status(405).json({ error: { code: "ORIN_METHOD_NOT_ALLOWED", message: "POST only.", request_id: requestId } });
  let sandbox: Awaited<ReturnType<typeof Sandbox.getOrCreate>> | null = null;
  try {
    const config = loadSearchConfig(process.env);
    const address = new TrustedAddressAdapterImpl(config.trustedProxyHeader).address(req);
    const cookie = cookieFor(req, config.cookieSecret);
    res.setHeader("Set-Cookie", cookie.header);
    const quota = quotaFor(config.providerMode, config.redisUrl, config.redisToken);
    const quotaResult = await quota.consume(`run:${address}`, Number(process.env.ORIN_RUN_DAILY_LIMIT || 50), 86_400_000);
    if (!quotaResult.allowed) return res.status(429).json({ error: { code: "ORIN_RATE_LIMITED", message: "Run quota exceeded.", retryable: true, retry_after: quotaResult.retryAfter, request_id: requestId } });
    const input = validateRunRequest(req.body);
    const extension = input.language === "javascript" ? "js" : input.language;
    const program = input.language === "javascript" ? "node" : input.language;
    const file = `/vercel/main.${extension}`;
    sandbox = await Sandbox.getOrCreate({ name: `orin-run-${randomUUID()}`, persistent: false, networkPolicy: "deny-all" });
    await sandbox.update({ networkPolicy: "deny-all" });
    await sandbox.writeFiles([{ path: file, content: Buffer.from(input.code) }, { path: "/vercel/input.txt", content: Buffer.from(input.stdin || "") }]);
    const command = input.language === "javascript" ? [file] : [file];
    const result = await Promise.race([
      sandbox.runCommand(program, command),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Execution timed out.")), RUN_POLICY.timeoutMs)),
    ]);
    const stdout = String(await result.stdout()).slice(0, RUN_POLICY.maxOutputChars);
    const stderr = String(await result.stderr()).slice(0, RUN_POLICY.maxOutputChars);
    const exitCode = Number((result as any).exitCode ?? 0);
    return res.status(200).json({ language: input.language, version: "isolated-sandbox", exitCode, output: stdout, error: stderr, limits: RUN_POLICY });
  } catch (error) {
    if (error instanceof RunQuotaUnavailable) return res.status(503).json({ error: { code: "ORIN_USAGE_STATE_UNAVAILABLE", message: "Run quota state is unavailable.", retryable: true, request_id: requestId } });
    if (error instanceof SearchError) return res.status(error.status).json(error.response(requestId));
    return res.status(400).json({ error: { code: "ORIN_RUN_INVALID", message: error instanceof Error ? error.message : "Run request failed.", request_id: requestId } });
  } finally {
    if (sandbox) await sandbox.stop().catch(() => {});
  }
}

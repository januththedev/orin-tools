export const RUN_LANGUAGES = ["javascript", "python", "go", "rust"] as const;
export type RunLanguage = (typeof RUN_LANGUAGES)[number];
export const RUN_POLICY = Object.freeze({
  maxCodeChars: 20_000,
  maxStdinChars: 4_000,
  maxOutputChars: 32_000,
  timeoutMs: 20_000,
  memoryMb: 128,
  cpus: 0.5,
  pids: 64,
  network: "deny-all",
});

export interface RunRequest { language: RunLanguage; code: string; stdin?: string; }
export function validateRunRequest(body: unknown): RunRequest {
  if (!body || typeof body !== "object") throw new Error("Run body must be an object.");
  const value = body as Record<string, unknown>;
  const language = String(value.language || "") as RunLanguage;
  if (!RUN_LANGUAGES.includes(language)) throw new Error("Unsupported language.");
  const code = typeof value.code === "string" ? value.code : "";
  if (!code.trim() || code.length > RUN_POLICY.maxCodeChars) throw new Error("Code is empty or too large.");
  const stdin = typeof value.stdin === "string" ? value.stdin : "";
  if (stdin.length > RUN_POLICY.maxStdinChars) throw new Error("Stdin is too large.");
  return { language, code, stdin };
}

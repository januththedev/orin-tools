/**
 * POST /api/run — free code execution for anyone's product.
 *
 * Backend: Compiler Explorer (Godbolt) execution API — free, no keys,
 * 50+ languages, runs real binaries and returns stdout/stderr/exit code.
 * (Piston's public API went auth-only in Feb 2026, so Godbolt it is.)
 * Orin adds: per-IP rate limiting (10/min), timeouts, output caps,
 * language→compiler resolution, and a stable contract:
 *
 *   body: { language, code, stdin? }
 *     language: python | javascript | typescript | java | c | c++ | go |
 *               rust | ruby | php | csharp | swift | kotlin | lua | r | ...
 *   → { language, version, stdout, stderr, output, code, cached }
 *
 * Discover compilers: GET /api/run?languages=1
 * Nothing to sign up for. Fair use keeps it free for life.
 */
const CE = 'https://gcc.godbolt.org/api';
const RUN_LIMIT = 10; // per IP per minute
const CODE_MAX = 100_000;
const OUT_MAX = 50_000;

interface Req {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

interface Res {
  setHeader(k: string, v: string): void;
  status(c: number): Res;
  json(o: unknown): unknown;
  end(): unknown;
}

interface Compiler {
  id: string;
  lang: string;
  supportsExecute?: boolean;
}

const runs = new Map<string, { windowStart: number; count: number }>();
let compilersCache: { at: number; list: Compiler[] } = { at: 0, list: [] };

function clientIp(req: Req): string {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function allowed(ip: string): boolean {
  const now = Date.now();
  const row = runs.get(ip) || { windowStart: now, count: 0 };
  if (now - row.windowStart >= 60_000) {
    runs.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  row.count += 1;
  runs.set(ip, row);
  return row.count <= RUN_LIMIT;
}

async function fetchTimeout(url: string, opts: { ms?: number; method?: string; body?: unknown } = {}) {
  const { ms = 45000, method = 'GET', body = null } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'OrinSearch/1.0' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function compilers(): Promise<Compiler[]> {
  if (Date.now() - compilersCache.at < 3_600_000 && compilersCache.list.length) return compilersCache.list;
  const r = await fetchTimeout(`${CE}/compilers`, { ms: 20000 });
  if (!r.ok) throw new Error(`compilers ${r.status}`);
  const list = await r.json().catch(() => []);
  if (Array.isArray(list) && list.length) compilersCache = { at: Date.now(), list };
  return compilersCache.list;
}

const LANG_ALIASES: Record<string, string | string[]> = {
  'c++': 'c++', cpp: 'c++', 'c#': 'csharp', 'c-sharp': 'csharp',
  js: 'javascript', ts: ['typescript', 'javascript'], py: 'python',
  rb: 'ruby', rs: 'rust', golang: 'go',
};

// Preferred toolchains first (real interpreters/runtimes, not exotic
// subsets like Pythran); nightlies/trunk last.
const PREFER: Record<string, string[]> = {
  python: ['cpython', 'python3', 'python', 'pypy'],
  javascript: ['node'], typescript: ['deno', 'node', 'ts-node'],
  ruby: ['ruby'], php: ['php'], go: ['go'], rust: ['rust'],
  java: ['openjdk', 'java'], c: ['gcc', 'clang'], 'c++': ['gcc', 'g++', 'clang'],
  csharp: ['dotnet', 'mono'], swift: ['swift'], kotlin: ['kotlin'],
  lua: ['lua'], r: ['r'], perl: ['perl'], haskell: ['ghc'],
  scala: ['scala'], dart: ['dart'],
};
const PENALTY = ['pythran', 'nightly', 'trunk', 'snapshot', 'beta', 'experimental'];

function pickCompilers(list: Compiler[], language: unknown): Compiler[] {
  const want = String(language || '').toLowerCase().trim();
  const langs = [want, ...([LANG_ALIASES[want] || []].flat() as string[])];
  const prefs = PREFER[want] || PREFER[langs[1]] || [];
  const score = (id: string): number => {
    const low = id.toLowerCase();
    let s = prefs.length;
    for (let i = 0; i < prefs.length; i++) {
      if (low.includes(prefs[i])) { s = i; break; }
    }
    for (const p of PENALTY) if (low.includes(p)) s += 100;
    return s;
  };
  const matches = list.filter(
    (c) => c?.id && langs.includes(String(c.lang || '').toLowerCase()) && c.supportsExecute !== false,
  );
  const seen = new Set<string>();
  const ordered: Compiler[] = [];
  for (const c of [...matches].sort((a, b) => score(a.id) - score(b.id))) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    ordered.push(c);
  }
  return ordered;
}

function streamText(chunks: unknown): string {
  const arr = (Array.isArray(chunks) ? chunks : []) as Array<{ text?: string } | string>;
  const raw = arr.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('');
  // Strip ANSI color codes — API consumers want plain text.
  return raw.replace(/\u001b\[[0-9;]*m/g, '');
}

function clip(s: unknown): string {
  const t = String(s || '');
  return t.length > OUT_MAX ? t.slice(0, OUT_MAX) + `\n… (output clipped at ${OUT_MAX} chars)` : t;
}

export default async function handler(req: Req, res: Res): Promise<unknown> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET' && req.query?.languages) {
    try {
      const list = await compilers();
      return res.status(200).json({ languages: [...new Set(list.map((c) => c.lang))].sort() });
    } catch (e) {
      return res.status(502).json({ error: 'Compiler list unavailable: ' + e.message });
    }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only (GET ?languages=1 to list)' });
  if (!allowed(clientIp(req))) return res.status(429).json({ error: 'Slow down (10 runs/min)' });

  const { language, code, stdin = '' } = req.body || {};
  if (!language || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'language and code required' });
  }
  if (code.length > CODE_MAX) return res.status(400).json({ error: `code too large (max ${CODE_MAX} chars)` });

  let lastErr = '';
  try {
    const list = await compilers();
    const cands = pickCompilers(list, language);
    if (!cands.length) {
      const langs = [...new Set(list.map((c) => c.lang))].sort().join(', ');
      return res.status(400).json({ error: `unsupported language '${language}'. Try: ${langs.slice(0, 300)}` });
    }
    // Try up to 3 compilers for the language (first success wins).
    for (const c of cands.slice(0, 3)) {
      try {
        const r = await fetchTimeout(`${CE}/compiler/${encodeURIComponent(c.id)}/compile`, {
          ms: 45000,
          method: 'POST',
          body: {
            source: code,
            options: {
              userOptions: [],
              execute: true,
              args: [],
              stdin: String(stdin || '').slice(0, 10_000),
            },
            lang: c.lang,
            allowStoreCode: false,
          },
        });
        if (!r.ok) {
          lastErr = `compiler ${c.id}: ${r.status}`;
          continue;
        }
        const j = await r.json().catch(() => ({}));
        const buildFailed = (j.code || 0) !== 0 && !j.execResult;
        const exec = j.execResult || {};
        const stdout = streamText(exec.stdout) || streamText(j.stdout);
        const stderr = streamText(exec.stderr) || streamText(j.stderr);
        const exitCode = exec.code ?? (buildFailed ? j.code : 0);
        return res.status(200).json({
          language: c.lang,
          version: c.id,
          stdout: clip(stdout),
          stderr: clip(stderr),
          output: clip(stdout + (stderr ? '\n' + stderr : '')),
          code: typeof exitCode === 'number' ? exitCode : null,
          cached: false,
        });
      } catch (e) {
        lastErr = `compiler ${c.id}: ` + e.message;
      }
    }
    throw new Error(lastErr || 'all compilers failed');
  } catch (e) {
    return res.status(502).json({ error: 'Execution failed: ' + e.message });
  }
}

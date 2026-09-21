/**
 * GET /api/search?q=...&n=5&fresh=0
 *
 * Orin Search — free web-search microservice (the Tavily we don't pay for).
 * Zero API keys, zero cost, three layers:
 *
 *   1. Self-hosted SearXNG (if SEARXNG_URL is set): full SearXNG JSON API —
 *      engines, SafeSearch, the works. Host it later with one docker command
 *      (see README) and set the env var; everything else keeps working.
 *   2. Public SearXNG instances (best-effort, short timeouts): rotated,
 *      failures ignored — any single dead instance never fails the request.
 *   3. Keyless fallbacks that almost never die: Wikipedia opensearch +
 *      DuckDuckGo lite HTML. Enough for definitions, places, people.
 *
 * → { query, results: [{ title, url, snippet, engine }], engines, cached }
 * Results are merged, de-duplicated by URL, and cached in-memory (10 min).
 * Per-IP rate limit: 30 req/min (in-memory; fine for our scale).
 */
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map(); // query -> { at, payload }
const hits = new Map(); // ip -> { windowStart, count }

const SEARXNG_SELF = (process.env.SEARXNG_URL || '').replace(/\/+$/, '');
const PUBLIC_SEARXNG = [
  'https://searx.be',
  'https://search.inetol.net',
  'https://baresearch.org',
];

function clientIp(req) {
  return ((req.headers['x-forwarded-for'] || '').split(',')[0]).trim() || 'unknown';
}

function allowed(ip) {
  const now = Date.now();
  const row = hits.get(ip) || { windowStart: now, count: 0 };
  if (now - row.windowStart >= 60_000) {
    hits.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  row.count += 1;
  hits.set(ip, row);
  return row.count <= 30;
}

async function fetchTimeout(url, { ms = 8000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'OrinSearch/1.0', ...headers } });
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize any SearXNG-format JSON ({ results: [{title,url,content,engine}] }). */
function fromSearxng(json, cap) {
  const out = [];
  for (const r of json?.results || []) {
    if (!r?.url) continue;
    out.push({
      title: String(r.title || r.url).slice(0, 200),
      url: String(r.url).slice(0, 500),
      snippet: String(r.content || '').slice(0, 400),
      engine: 'searxng:' + String(r.engine || 'general').slice(0, 40),
    });
    if (out.length >= cap) break;
  }
  return out;
}

async function viaSearxng(base, q, cap) {
  const r = await fetchTimeout(
    `${base}/search?q=${encodeURIComponent(q)}&format=json&language=en&safesearch=1`,
    { ms: 9000 },
  );
  if (!r.ok) throw new Error(`searxng ${r.status}`);
  return fromSearxng(await r.json().catch(() => ({})), cap);
}

async function viaWikipedia(q, cap) {
  const r = await fetchTimeout(
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=${cap}&format=json`,
    { ms: 8000 },
  );
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  const j = await r.json().catch(() => []);
  const titles = j[1] || [], descs = j[2] || [], urls = j[3] || [];
  return titles.slice(0, cap).map((t, i) => ({
    title: String(t).slice(0, 200),
    url: String(urls[i] || `https://en.wikipedia.org/wiki/${encodeURIComponent(String(t).replace(/ /g, '_'))}`).slice(0, 500),
    snippet: String(descs[i] || '').slice(0, 400),
    engine: 'wikipedia',
  }));
}

async function viaDuckLite(q, cap) {
  const r = await fetchTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { ms: 8000 });
  if (!r.ok) throw new Error(`ddg ${r.status}`);
  const html = await r.text();
  const out = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
  let m;
  const links = [];
  while ((m = linkRe.exec(html)) && links.length < cap) {
    let href = strip(m[1]);
    const u = href.match(/uddg=([^&]+)/);
    try { href = u ? decodeURIComponent(u[1]) : href; } catch {}
    if (/^https?:\/\//.test(href)) links.push({ url: href.slice(0, 500), title: strip(m[2]).slice(0, 200) });
  }
  const snips = [];
  while ((m = snipRe.exec(html)) && snips.length < cap) snips.push(strip(m[1]).slice(0, 400));
  links.forEach((l, i) => out.push({ ...l, snippet: snips[i] || '', engine: 'duckduckgo' }));
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!allowed(clientIp(req))) return res.status(429).json({ error: 'Slow down' });

  const q = String(req.query.q || '').trim().slice(0, 300);
  const n = Math.min(Math.max(parseInt(req.query.n, 10) || 5, 1), 10);
  if (!q) return res.status(400).json({ error: 'q required' });

  const cacheKey = `${q}::${n}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return res.status(200).json({ ...hit.payload, cached: true });
  }

  const used = [];
  let results = [];

  // Layer 1 — self-hosted SearXNG (authoritative when configured).
  if (SEARXNG_SELF) {
    try {
      results = await viaSearxng(SEARXNG_SELF, q, n);
      used.push('self-searxng');
    } catch (e) {
      console.log('[orin-search] self searxng failed:', e.message);
    }
  }

  // Layer 2 — public SearXNG instances (first success wins; rest ignored).
  if (results.length < n) {
    for (const base of PUBLIC_SEARXNG) {
      try {
        const r = await viaSearxng(base, q, n);
        if (r.length) {
          results = r;
          used.push('public-searxng');
          break;
        }
      } catch { /* next instance */ }
    }
  }

  // Layer 3 — keyless fallbacks (fill whatever is still missing).
  if (results.length < n) {
    try {
      const w = await viaWikipedia(q, n);
      if (w.length) {
        results = [...results, ...w];
        used.push('wikipedia');
      }
    } catch {}
  }
  if (results.length < Math.min(3, n)) {
    try {
      const d = await viaDuckLite(q, n);
      if (d.length) {
        results = [...results, ...d];
        used.push('duckduckgo');
      }
    } catch {}
  }

  // Merge + dedupe by URL.
  const seen = new Set();
  results = results.filter((r) => {
    try {
      const key = new URL(r.url).hostname + new URL(r.url).pathname;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch { return false; }
  }).slice(0, n);

  const payload = { query: q, results, engines: used, cached: false };
  cache.set(cacheKey, { at: Date.now(), payload });
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return res.status(200).json(payload);
}

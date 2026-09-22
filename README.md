# Orin Tools

Free, keyless web search API and sandboxed code execution for any product.
No sign-up, no quotas that matter, no per-call billing — unlimited for life.

- **Search:** `GET /api/search?q=…&n=5` → titles, URLs, snippets, engines. Weather questions get a real forecast first.
- **Run:** `POST /api/run` with `{ language, code, stdin? }` → stdout, stderr, exit code. ~20 languages in real sandboxes.
- **Self-host:** bring your own SearXNG, deploy anywhere, keep everything on your metal.

Live demo + playground: <https://tools.orinai.org>
Part of the [Orin AI ecosystem](https://orinai.org) · MIT licensed.

## Features

| Area | What you get |
|---|---|
| Web search | Layered free engines: self-hosted SearXNG → public instances → Google News RSS → Wikipedia → DuckDuckGo. First success wins, results merged, de-duplicated, cached 10 min. |
| Weather vertical | Weather-intent queries skip news links and return an actual Open-Meteo forecast (geocoded place, today/tomorrow). |
| Code execution | ~20 languages (Python, JavaScript, Go, Rust, Java, C/C++, …) via execution sandboxes. Stdout, stderr, exit codes, stdin support. |
| Safety rails | Per-IP rate limits (30 search / 10 runs per minute), timeouts, output caps, ANSI-stripped output. |
| Zero keys | No API keys anywhere in the stack. CORS open — call from browsers, cron jobs, agents. |

## Architecture

```
browser / agent / cron
        │  GET /api/search?q=&n=        POST /api/run {language, code}
        ▼                               ▼
  ┌─────────────┐                 ┌─────────────┐
  │ api/search  │                 │  api/run    │   Vercel serverless (Node)
  ├─────────────┤                 ├─────────────┤
  │ 1 self      │                 │ compiler    │
  │   SearXNG   │                 │ preference  │
  │ 2 public    │                 │ + exact     │
  │   SearXNG   │                 │ native      │
  │ 3 GNews RSS │                 │ toolchain   │
  │ 4 Wikipedia │                 │ matching,   │
  │ 5 DDG lite  │                 │ JVM crash   │
  │ + weather   │                 │ hop, exec   │
  │   vertical  │                 │ contract    │
  └─────────────┘                 └─────────────┘
        │                               │
        ▼                               ▼
  in-memory cache              Compiler Explorer
  (10 min, 500 entries)        execution farm (free)
```

One Vercel project, two serverless functions, zero dependencies, zero
environment variables required. Static landing page (`index.html`) ships
from the same deployment.

## Getting Started

Use the hosted API directly — nothing to install:

```bash
# search
curl "https://tools.orinai.org/api/search?q=sri+lanka+news&n=5"

# run python
curl -X POST https://tools.orinai.org/api/run \
  -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"print(40 + 2)"}'
```

```python
import requests
hits = requests.get(
    "https://tools.orinai.org/api/search",
    params={"q": "kandy weather tomorrow", "n": 5},
).json()
for r in hits["results"]:
    print(r["title"], r["url"])
```

```javascript
const run = await fetch("https://tools.orinai.org/api/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ language: "javascript", code: "console.log(7 * 6)" }),
}).then((r) => r.json());
console.log(run.output); // 42
```

## Self-hosting

You have two independent options — use either or both:

**A. Deploy your own copy (recommended).** Import this repo into Vercel
(Add New → Project → Deploy). No env vars, no build step. Your URL works
immediately: `https://<your-project>.vercel.app/api/search?q=test&n=1`.

**B. Bring your own SearXNG (layer one).** Any always-on machine:

```bash
docker run -d --name searxng --restart unless-stopped -p 8080:8080 searxng/searxng
```

Then set `SEARXNG_URL=http://<host>:8080` in your deployment's env vars and
redeploy. Your engine becomes authoritative; every other layer stays as
automatic backup. Docker, Raspberry Pi, old laptop, $5 VPS — all fine.

## Configuration

| Variable | Required | What |
|---|---|---|
| `SEARXNG_URL` | No | Your SearXNG base URL (layer one). Without it, public layers answer. |
| `TTS_MODEL` | No | N/A here (voice lives in Orin Chat). Reserved, ignored. |

Rate limits (in-memory, per instance): 30 searches/min/IP, 10 runs/min/IP.
Cache: 10-minute TTL, 500 entries, responses flag `cached: true` on hits.

## Deployment

- **Vercel (primary):** import repo → Deploy. Functions: `api/search.ts`
  (25s), `api/run.ts` (60s). Static `index.html` serves the landing +
  playground automatically.
- **Any Node host:** `api/*.ts` are dependency-free handlers — adapt the
  20-line export shape to Express/Fastify/Cloudflare Workers as needed.
- **Health check:** `GET /api/search?q=test&n=1` → `200` with an `engines`
  array and a `debug` object naming exactly which layer lived or died.
- **Languages check:** `GET /api/run?languages=1` → supported language list.

## API

### `GET /api/search`

| Param | Required | Notes |
|---|---|---|
| `q` | Yes | Query, max 300 chars. Weather phrasing (`weather in X tomorrow`) triggers the forecast vertical. |
| `n` | No | 1–10, default 5. |

Response: `{ query, results: [{ title, url, snippet, engine }], engines, debug, cached }`.
Errors: `400` (no `q`), `429` (slow down), all JSON.

### `POST /api/run`

Body: `{ language, code, stdin? }` — `code` max 100KB, `stdin` max 10KB.
Response: `{ language, version, stdout, stderr, output, code, cached }`.
Errors: `400` (bad language/code), `429` (10/min), `502` (engine down).

## Development

```bash
git clone https://github.com/januththedev/orin-tools
cd orin-tools
```

Typecheck: any `tsc --noEmit` (strict off is fine; handlers use minimal
`Req`/`Res` interfaces, zero dependencies). Live-test the endpoints with
`sandbox-quickstart/test-search.ts` (TypeScript, run with any TS runner).

## Contributing

Issues and PRs are welcome. Good first contributions: new free search
layers, new execution backends, language/compiler preference fixes,
playground UX. Keep it dependency-free and keyless — that is the point.

1. Fork → branch → PR against `main`.
2. One concern per PR, with a live-tested example in the description.
3. No API keys, no paid services, no telemetry — ever.

## License

MIT — see [LICENSE](LICENSE). Free for personal and commercial use.

## Security

No auth, no user data stored, no logs kept beyond the platform's own.
Rate limits exist so one abuser can't ruin the commons. Found an abuse
vector or a bypass? Open an issue — please don't publish exploits before
a fix lands.

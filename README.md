# Orin Search — free web search, no keys, no bills

`GET https://<your-deploy>/api/search?q=hello+world&n=5`

```json
{
  "query": "hello world",
  "results": [{ "title": "...", "url": "...", "snippet": "...", "engine": "wikipedia" }],
  "engines": ["wikipedia"],
  "cached": false
}
```

## How it stays free

| Layer | What | Keys | Cost |
|---|---|---|---|
| 1. Self-hosted SearXNG | Your own instance (when you set `SEARXNG_URL`) | none | free |
| 2. Public SearXNG | `searx.be`, `inetol`, `baresearch` — first success wins | none | free |
| 3. Fallbacks | Wikipedia opensearch + DuckDuckGo lite | none | free |

Results merge, de-dupe by URL, cache 10 min in memory. 30 req/min per IP.

## Deploy (3 clicks)

1. Push this repo to GitHub → Vercel → **Add New Project** → import it → Deploy. No env vars needed.
2. Point Orin at it later: main site will use `ORIN_SEARCH_URL=https://<deploy>/api/search`.

## Optional: your own SearXNG (layer 1)

One docker command on any always-on machine (old laptop, Raspberry Pi, $5 VPS):

```bash
docker run -d --name searxng --restart unless-stopped -p 8080:8080 searxng/searxng
```

Then set `SEARXNG_URL=http://<host>:8080` in this project's Vercel env vars and redeploy.
Layer 1 becomes authoritative; layers 2–3 stay as automatic backup.

## Wire into Orin AI (later)

`api/chat.js` (frozen until then): on freshness intent,
`GET {ORIN_SEARCH_URL}?q={prompt}&n=5` → append top snippets as context →
answer with citations. Replaces Groq compound + the OpenRouter web plugin.

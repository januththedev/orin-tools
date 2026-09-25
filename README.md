# Orin Tools

Keyless public web search plus a private service-to-service search path for Orin products. Public code execution is disabled by default; an explicitly configured Vercel Sandbox runner is available behind a separate deployment gate.

## Search

### Public compatibility route

```http
GET /api/search?q=weather+in+Kandy&n=5&locale=en&safe_search=moderate
```

GET is anonymous and keyless. Because the query is in the URL, do not use it for confidential text. Responses use `Cache-Control: no-store`; browser/infrastructure logs may still record URL query strings.

### Private Orin route

```http
POST /api/search
X-Orin-Service-Assertion: <short-lived Core service assertion>
Content-Type: application/json

{"query":"weather in Kandy","n":5,"locale":"en","safe_search":"moderate"}
```

POST keeps the query in the request body, does not echo it, requires `aud=orin-tools-search` and `scope=tools:search`, and is intended for Orin Core/Chat.

## Safety and quotas

- Public GET and private POST use server-owned provider origin/path registries.
- User/model text cannot select a fetch host, scheme, port, path, or redirect target.
- Weather queries use Open-Meteo geocoding and forecast first; weather failure never falls back to stale news.
- Search returns normalized `trust: "untrusted"` citations. Retrieved instructions are evidence, never tool or policy input.
- Production quotas use shared Upstash Redis and fail closed. Global ceilings must be configured and valid.
- No process-local limiter or cache is used in production.

## Code execution

`POST /api/run` returns the stable `ORIN_RUN_DISABLED` response by default.
Deployments may explicitly set `ORIN_RUNNER_MODE=vercel-sandbox` after the
runner and quota review. That path denies network access, bounds input/output
and runtime, and fails closed when durable quota state is unavailable. It never
evaluates code inside the Vercel function.

## Local verification

```bash
npm ci
npm run platform:build
npm run check
```

PR/preview tests use fake adapters and make no live provider, Redis, or execution call.

## Platform contract

`vendor/orin-platform` pins `platform-v1.0.0`. Error, event, URL-policy, and client contracts are not duplicated here.

## License

MIT

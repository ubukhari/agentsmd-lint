# @agentwares/badge

shields.io-style status badge, a public status page that renders **without JavaScript**, a shareable nightly-run page, and `trust.json` — the machine-readable badge. Pure string builders with no runtime dependencies and no DOM/Node-only APIs, so the same code runs on Cloudflare Workers, Vercel Functions and Node.

```ts
import {
  badgeHeaders,
  buildTrustJson,
  renderRunPage,
  renderStatusBadge,
  renderStatusPage,
  trustHeaders,
} from "@agentwares/badge";
```

## Input types

Apps map their DB rows into these DB-agnostic shapes (all in `src/types.ts`):

| Type               | Purpose                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `CheckResultPoint` | one check execution: `{ ranAt, pass, latencyMs, score? }`                                                 |
| `CheckSeries`      | a check and its recent results: `{ id, name, kind, intervalSec, results }`                                |
| `Incident`         | `{ id, openedAt, closedAt?, cause, checkName? }` — `closedAt` null/undefined means open                   |
| `NightlyScores`    | `{ ranAt, replayPassRate?, adversarialPassRate?, driftScore?, modelVersions? }`                           |
| `StatusPageData`   | everything the status page, badge and trust.json need (owner, slug, name, kind, URLs, checks, incidents…) |
| `RunPageData`      | one nightly run: summary, `diffs[]` with verdicts, optional `driftSeries`, `modelVersions`                |

Conventions: timestamps are ISO strings or `Date`s; rates are **percentages 0–100**; `driftScore` is 0–1. Every renderer takes its "now" from `generatedAt` / `ranAt` (override with `{ now }`) so output is deterministic and cacheable.

## Usage

### Badge — `GET /badge/<owner>/<slug>.svg`

```ts
const data = await loadStatusPageData(owner, slug); // your DB → StatusPageData
return new Response(renderStatusBadge(data, { label: "agentcheck" }), {
  headers: badgeHeaders(),
});

// or without a target:
renderBadge({ label: "agentcheck", status: "passing" }); // message defaults to the status
renderBadge({
  label: "agentcheck",
  message: "99.9% · 30d",
  status: "degraded",
  style: "flat-square",
});
```

Colours: passing `#4c1`, failing `#e05d44`, degraded `#dfb317`, unknown / no-data `#9f9f9f`. Text widths come from a built-in Verdana 11px table (the same approach shields uses), so the SVG needs no fonts or network access. Every string is XML-escaped.

### Status page — `GET /<owner>/<slug>`

```ts
return new Response(renderStatusPage(data), {
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
});
```

The page is a complete HTML5 document with inline CSS only (light/dark via `prefers-color-scheme`) and **no `<script>`**: header with badge and status pill, uptime 24h/7d/30d, p95 latency, a 24-bar timeline and latency sparkline per check (inline SVG), incidents (open first), nightly scores with a drift chart, an "Add to your README" snippet and links to `trust.json`. Every user-provided string is HTML-escaped and every URL passes through `safeUrl()` (only `http(s)`, protocol-relative and root-relative URLs survive).

### Run page — `GET /<owner>/<slug>/runs/<id>`

```ts
renderRunPage(runData); // diff table regressed-first, drift chart, model versions
```

### trust.json — `GET /<owner>/<slug>/trust.json`

```ts
return new Response(JSON.stringify(buildTrustJson(data)), { headers: trustHeaders() });
```

```json
{
  "schema": "agentwares.trust/v1",
  "target": {
    "owner": "demo",
    "slug": "support-agent",
    "name": "Acme support agent",
    "kind": "mcp"
  },
  "status": "degraded",
  "uptime_24h": 99.75,
  "uptime_7d": 99.75,
  "uptime_30d": 99.75,
  "last_check_at": "2026-09-01T11:58:00.000Z",
  "last_nightly": {
    "ran_at": "2026-09-01T03:00:00.000Z",
    "replay_pass_rate": 100,
    "adversarial_pass_rate": 92.3,
    "drift_score": 0.04,
    "model_versions": { "model": "claude-sonnet-4-5", "agent": "support-agent@1.4.2" }
  },
  "adversarial_pass_rate": 92.3,
  "models_seen": [
    "claude-sonnet-4-5",
    "support-agent@1.4.2",
    "support-agent@1.4.1",
    "claude-sonnet-4"
  ],
  "incidents_open": 0,
  "updated_at": "2026-09-01T12:00:00.000Z",
  "badge_url": "https://…/badge/demo/support-agent.svg",
  "status_url": "https://…/demo/support-agent"
}
```

Missing data is `null`, never `undefined`, so the document round-trips through JSON unchanged.

### Metrics

`computeUptime(results, windowMs, now?)` (percent, 2 decimals, `null` when empty), `latestStatus(checks, now?)`, `p95(latencies)`, `bucketize(results, buckets = 24, windowMs = 24h, now?)`, `uptimeSummary(checks, now?)`.

`latestStatus` rules: `no-data` when no check has a result; `failing` when the latest result of any check failed; `degraded` when all latest results pass but something failed in the last 24h; `passing` otherwise.

### Demo data

`demoStatusPageData({ now?, baseUrl?, owner?, slug? })` and `demoRunPageData(...)` return deterministic synthetic data (3 checks over 24h with one failure, one closed incident, three nightly runs) for `/demo` and tests.

## Cache headers

- `badgeHeaders()` → `Content-Type: image/svg+xml; charset=utf-8`, `Cache-Control: public, max-age=300, s-maxage=300`.
- `trustHeaders()` → `Content-Type: application/json; charset=utf-8`, the same 5-minute cache, plus `Access-Control-Allow-Origin: *` so agents can fetch it from anywhere.

Five minutes matches the plan's `max-age=300` requirement and keeps GitHub's camo proxy (which honours `Cache-Control`) from hammering the origin. Render the badge from a cheap query (latest result per check plus 24h of results) and let the CDN absorb README traffic. The status page has no fixed header helper; `max-age=60` is a sensible default.

## Development

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

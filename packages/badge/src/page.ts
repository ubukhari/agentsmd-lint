/**
 * Public status page and shareable run page. Complete HTML5 documents built
 * from strings: no `<script>`, inline CSS only, light/dark via
 * `prefers-color-scheme`. Every user-provided string is escaped.
 */
import { renderLineChart, renderSparkline, renderTimeline } from "./charts.js";
import { escapeHtml, safeUrl } from "./escape.js";
import {
  formatDateTime,
  formatDuration,
  formatInterval,
  formatMs,
  formatPercent,
  formatRelative,
  formatScore,
  kindLabel,
  statusLabel,
} from "./format.js";
import {
  DAY_MS,
  allResults,
  bucketize,
  computeUptime,
  inWindow,
  lastCheckAt,
  latestResult,
  latestStatus,
  p95,
  resolveNow,
  toMs,
  uptimeSummary,
} from "./metrics.js";
import type { NowInput } from "./metrics.js";
import { BADGE_COLORS } from "./badge.js";
import type {
  BadgeStatus,
  CheckSeries,
  DiffVerdict,
  Incident,
  NightlyScores,
  RunDiff,
  RunPageData,
  StatusPageData,
} from "./types.js";

export interface RenderPageOptions {
  /** "now" for window maths; defaults to `data.generatedAt` (status) / `data.ranAt` (run) */
  now?: NowInput;
}

/* ---------------------------------------------------------------- styles */

export const PAGE_CSS = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--card:#f6f8fa;--border:#d0d7de;--link:#0969da;--pass:#3fb950;--fail:#e05d44;--warn:#dfb317;--unknown:#9f9f9f}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--card:#161b22;--border:#30363d;--link:#58a6ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--link)}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px 48px}
.top{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;justify-content:space-between;margin-bottom:20px}
.top-right{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
h1{font-size:1.6rem;line-height:1.2;margin:0;overflow-wrap:anywhere}
h2{font-size:1.15rem;margin:32px 0 12px}
h3{font-size:1rem;margin:0;overflow-wrap:anywhere}
.meta{color:var(--muted);margin:4px 0 0;overflow-wrap:anywhere}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}
.muted{color:var(--muted)}
.small{font-size:.85rem}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.85rem;font-weight:600;line-height:1.5;color:#fff;background:var(--unknown);white-space:nowrap}
.pill-passing{background:var(--pass)}
.pill-failing{background:var(--fail)}
.pill-degraded{background:var(--warn);color:#1f2328}
.pill-resolved{background:transparent;color:var(--muted);border:1px solid var(--border)}
.pill-regressed{background:var(--fail)}
.pill-improved{background:var(--pass)}
.pill-flake{background:var(--warn);color:#1f2328}
.pill-unchanged{background:transparent;color:var(--muted);border:1px solid var(--border)}
.badge-img{display:block;height:20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px;min-width:0}
.stat-v{display:block;font-size:1.35rem;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.stat-l{color:var(--muted);font-size:.85rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.check-head{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:baseline;justify-content:space-between}
.check-stats{font-variant-numeric:tabular-nums;white-space:nowrap}
.dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:var(--unknown);vertical-align:middle;margin-right:.3em}
.dot-pass{background:var(--pass)}
.dot-fail{background:var(--fail)}
svg.timeline{display:block;width:100%;height:32px;margin-top:12px}
svg.spark{display:block;width:100%;height:40px;margin-top:8px;color:var(--link)}
svg.chart{display:block;width:100%;height:auto;max-height:220px;color:var(--link)}
svg.chart .grid,svg.chart .axis{color:var(--fg)}
.axis-row{display:flex;justify-content:space-between;color:var(--muted);font-size:.75rem;margin-top:2px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}
th{color:var(--muted);font-weight:600;white-space:nowrap}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.incident{border-left:4px solid var(--fail)}
.incident.closed{border-left-color:var(--border)}
.incident-head{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.incident-head strong{overflow-wrap:anywhere}
pre{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow-x:auto;font-size:.85rem;line-height:1.5;margin:0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.empty{color:var(--muted);font-style:italic}
.notice{background:var(--card);border:1px solid var(--warn);border-left-width:4px;border-radius:8px;padding:12px 14px;margin:0 0 20px;font-size:.9rem}
dl.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:0}
dl.summary div{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
dl.summary dt{color:var(--muted);font-size:.85rem}
dl.summary dd{margin:0;font-size:1.35rem;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.diff-cell{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:.85rem;display:flex;flex-wrap:wrap;gap:6px 16px}
`.trim();

/* --------------------------------------------------------------- helpers */

function favicon(status: BadgeStatus): string {
  const color = BADGE_COLORS[status].replace("#", "%23");
  return `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='${color}'/%3E%3C/svg%3E">`;
}

function documentOpen(title: string, description: string, extraHead = ""): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta name="generator" content="@agentwares/badge">\n` +
    `<meta name="description" content="${escapeHtml(description)}">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    extraHead +
    `<style>${PAGE_CSS}</style>\n</head>\n<body>\n<main class="wrap">\n`
  );
}

const DOCUMENT_CLOSE = `</main>\n</body>\n</html>\n`;

function stat(value: string, label: string, title?: string): string {
  const t = title ? ` title="${escapeHtml(title)}"` : "";
  return `<div class="stat"${t}><span class="stat-v">${escapeHtml(value)}</span><span class="stat-l">${escapeHtml(label)}</span></div>`;
}

function isOpen(incident: Incident): boolean {
  return incident.closedAt === null || incident.closedAt === undefined;
}

/** Open incidents first, then newest first. */
export function sortIncidents(incidents: readonly Incident[]): Incident[] {
  return [...incidents].sort((a, b) => {
    const ao = isOpen(a) ? 0 : 1;
    const bo = isOpen(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return toMs(b.openedAt) - toMs(a.openedAt);
  });
}

/** Newest nightly run first. */
export function sortNightly(nightly: readonly NightlyScores[]): NightlyScores[] {
  return [...nightly].sort((a, b) => toMs(b.ranAt) - toMs(a.ranAt));
}

const VERDICT_ORDER: Readonly<Record<DiffVerdict, number>> = {
  regressed: 0,
  improved: 1,
  flake: 2,
  unchanged: 3,
};

/** Regressed first, then improved, flake, unchanged; stable within a verdict. */
export function sortDiffs(diffs: readonly RunDiff[]): RunDiff[] {
  return diffs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const o = (VERDICT_ORDER[a.d.verdict] ?? 9) - (VERDICT_ORDER[b.d.verdict] ?? 9);
      return o !== 0 ? o : a.i - b.i;
    })
    .map(({ d }) => d);
}

function modelVersionsText(models: Record<string, string> | undefined): string {
  if (!models) return "";
  return Object.entries(models)
    .map(([k, v]) => `${escapeHtml(k)}: <span class="mono">${escapeHtml(v)}</span>`)
    .join("<br>");
}

/* ------------------------------------------------------------ status page */

function statusHeader(data: StatusPageData, status: BadgeStatus): string {
  const brand = data.brand
    ? ` · monitored by <a href="${safeUrl(data.brand.homeUrl)}">${escapeHtml(data.brand.productName)}</a>`
    : "";
  return (
    `<header class="top">\n<div>\n<h1>${escapeHtml(data.name)}</h1>\n` +
    `<p class="meta">${escapeHtml(kindLabel(data.kind))} · <span class="mono">${escapeHtml(data.owner)}/${escapeHtml(data.slug)}</span>${brand}</p>\n</div>\n` +
    `<div class="top-right">\n<span class="pill pill-${status}">${escapeHtml(statusLabel(status))}</span>\n` +
    `<a href="${safeUrl(data.publicUrl)}"><img class="badge-img" src="${safeUrl(data.badgeUrl)}" alt="${escapeHtml(data.name)} status badge" height="20"></a>\n</div>\n</header>\n`
  );
}

function statusStats(data: StatusPageData, now: number): string {
  const up = uptimeSummary(data.checks, now);
  const recent = inWindow(allResults(data.checks), DAY_MS, now);
  const p = p95(recent.map((r) => r.latencyMs));
  const last = lastCheckAt(data.checks);
  return (
    `<section class="stats" aria-label="Summary">\n` +
    stat(formatPercent(up.uptime24h), "uptime · 24h") +
    stat(formatPercent(up.uptime7d), "uptime · 7d") +
    stat(formatPercent(up.uptime30d), "uptime · 30d") +
    stat(formatMs(p), "p95 latency · 24h") +
    stat(String(data.checks.length), data.checks.length === 1 ? "check" : "checks") +
    stat(
      formatRelative(last, now),
      "last check",
      last === null ? undefined : formatDateTime(last),
    ) +
    `\n</section>\n`
  );
}

function checkCard(check: CheckSeries, now: number): string {
  const buckets = bucketize(check.results, 24, DAY_MS, now);
  const recent = inWindow(check.results, DAY_MS, now);
  const latest = latestResult(check.results);
  const up24 = computeUptime(check.results, DAY_MS, now);
  const p = p95(recent.map((r) => r.latencyMs));
  const dot = latest ? (latest.pass ? "dot-pass" : "dot-fail") : "";
  const latestText = latest
    ? `${latest.pass ? "pass" : "fail"} ${formatRelative(toMs(latest.ranAt), now)}`
    : "no runs yet";
  return (
    `<article class="card check" id="check-${escapeHtml(check.id)}">\n` +
    `<div class="check-head">\n<h3>${escapeHtml(check.name)}</h3>\n` +
    `<span class="muted small">${escapeHtml(check.kind)} · every ${escapeHtml(formatInterval(check.intervalSec))}</span>\n` +
    `<span class="check-stats"><strong>${escapeHtml(formatPercent(up24))}</strong> <span class="muted small">24h</span> · <span class="dot ${dot}"></span>${escapeHtml(latestText)}</span>\n</div>\n` +
    renderTimeline(buckets, { label: `${check.name}: checks in the last 24 hours` }) +
    `\n<div class="axis-row"><span>24h ago</span><span>now</span></div>\n` +
    renderSparkline(
      recent.map((r) => ({ t: toMs(r.ranAt), v: r.latencyMs })),
      { label: `${check.name}: latency`, start: now - DAY_MS, end: now },
    ) +
    `\n<p class="muted small">latency p95 ${escapeHtml(formatMs(p))} · latest ${escapeHtml(formatMs(latest?.latencyMs ?? null))} · ${recent.length} runs in 24h</p>\n</article>\n`
  );
}

function checksSection(data: StatusPageData, now: number): string {
  const body =
    data.checks.length === 0
      ? `<p class="empty">No checks configured yet.</p>\n`
      : data.checks.map((c) => checkCard(c, now)).join("");
  return `<section aria-labelledby="h-checks">\n<h2 id="h-checks">Checks · last 24 hours</h2>\n${body}</section>\n`;
}

function incidentCard(incident: Incident, now: number): string {
  const open = isOpen(incident);
  const openedMs = toMs(incident.openedAt);
  const closedMs = open ? now : toMs(incident.closedAt ?? now);
  const duration = formatDuration(closedMs - openedMs);
  const where = incident.checkName ? `${escapeHtml(incident.checkName)} · ` : "";
  const when = `opened ${escapeHtml(formatDateTime(openedMs))} (${escapeHtml(formatRelative(openedMs, now))})`;
  const state = open
    ? `ongoing for ${escapeHtml(duration)}`
    : `resolved after ${escapeHtml(duration)}`;
  return (
    `<article class="card incident ${open ? "open" : "closed"}" id="incident-${escapeHtml(incident.id)}">\n` +
    `<div class="incident-head"><span class="pill ${open ? "pill-failing" : "pill-resolved"}">${open ? "Open" : "Resolved"}</span> <strong>${escapeHtml(incident.cause)}</strong></div>\n` +
    `<p class="muted small">${where}${when} · ${state}</p>\n</article>\n`
  );
}

function incidentsSection(data: StatusPageData, now: number): string {
  const sorted = sortIncidents(data.incidents);
  const openCount = sorted.filter(isOpen).length;
  const body =
    sorted.length === 0
      ? `<p class="empty">No incidents recorded.</p>\n`
      : sorted.map((i) => incidentCard(i, now)).join("");
  const suffix = openCount > 0 ? ` · ${openCount} open` : "";
  return `<section aria-labelledby="h-incidents">\n<h2 id="h-incidents">Incidents${suffix}</h2>\n${body}</section>\n`;
}

function nightlySection(data: StatusPageData): string {
  if (!data.nightly || data.nightly.length === 0) return "";
  const sorted = sortNightly(data.nightly);
  const rows = sorted
    .map(
      (nightly) =>
        `<tr><td>${escapeHtml(formatDateTime(toMs(nightly.ranAt)))}</td>` +
        `<td class="num">${escapeHtml(formatPercent(nightly.replayPassRate, 1))}</td>` +
        `<td class="num">${escapeHtml(formatPercent(nightly.adversarialPassRate, 1))}</td>` +
        `<td class="num">${escapeHtml(formatScore(nightly.driftScore))}</td>` +
        `<td>${modelVersionsText(nightly.modelVersions)}</td></tr>`,
    )
    .join("\n");
  const drift = sorted
    .filter((s) => typeof s.driftScore === "number" && Number.isFinite(s.driftScore))
    .map((s) => ({ t: toMs(s.ranAt), v: s.driftScore as number }));
  const chart =
    drift.length >= 2
      ? `<h3 class="muted small" style="margin:16px 0 6px">Drift score per nightly run (0 = identical to previous run)</h3>\n` +
        renderLineChart(drift, { label: "Drift score per nightly run", yMin: 0 }) +
        "\n"
      : "";
  return (
    `<section aria-labelledby="h-nightly">\n<h2 id="h-nightly">Nightly suite</h2>\n<div class="table-wrap">\n<table>\n` +
    `<thead><tr><th>Run</th><th class="num">Replay pass</th><th class="num">Adversarial pass</th><th class="num">Drift</th><th>Models</th></tr></thead>\n` +
    `<tbody>\n${rows}\n</tbody>\n</table>\n</div>\n${chart}</section>\n`
  );
}

/** Markdown snippet for a README. */
export function badgeMarkdown(
  data: Pick<StatusPageData, "name" | "badgeUrl" | "publicUrl">,
): string {
  const alt = data.name.replace(/[[\]]/g, " ").trim() || "status";
  return `[![${alt} status](${data.badgeUrl})](${data.publicUrl})`;
}

function readmeSection(data: StatusPageData): string {
  return (
    `<section aria-labelledby="h-readme">\n<h2 id="h-readme">Add to your README</h2>\n` +
    `<pre><code>${escapeHtml(badgeMarkdown(data))}</code></pre>\n` +
    `<p class="muted small">The badge refreshes every 5 minutes. Machine-readable version: <a href="${safeUrl(data.trustUrl)}">trust.json</a></p>\n</section>\n`
  );
}

function statusFooter(data: StatusPageData, now: number): string {
  const brand = data.brand
    ? `<span>Powered by <a href="${safeUrl(data.brand.homeUrl)}">${escapeHtml(data.brand.productName)}</a></span>`
    : "";
  return (
    `<footer>\n<span>Generated ${escapeHtml(formatDateTime(now))}</span>\n` +
    `<span><a href="${safeUrl(data.trustUrl)}">trust.json</a></span>\n` +
    `<span><a href="${safeUrl(data.badgeUrl)}">badge.svg</a></span>\n${brand}\n</footer>\n`
  );
}

/** Render the public status page for a target as a complete HTML document. */
export function renderStatusPage(data: StatusPageData, opts: RenderPageOptions = {}): string {
  const now = resolveNow(opts.now ?? data.generatedAt);
  const status = latestStatus(data.checks, now);
  const up = uptimeSummary(data.checks, now);
  const productName = data.brand?.productName;
  const title = productName ? `${data.name} status · ${productName}` : `${data.name} status`;
  const description = `${data.name} is ${statusLabel(status).toLowerCase()}. Uptime 24h ${formatPercent(up.uptime24h)}, 30d ${formatPercent(up.uptime30d)}. ${data.incidents.filter(isOpen).length} open incidents.`;
  const extraHead =
    favicon(status) +
    `\n<link rel="alternate" type="application/json" href="${safeUrl(data.trustUrl)}" title="trust.json">\n`;
  return (
    documentOpen(title, description, extraHead) +
    statusHeader(data, status) +
    statusStats(data, now) +
    checksSection(data, now) +
    incidentsSection(data, now) +
    nightlySection(data) +
    readmeSection(data) +
    statusFooter(data, now) +
    DOCUMENT_CLOSE
  );
}

/* --------------------------------------------------------------- run page */

function verdictLabel(v: DiffVerdict): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function runHeader(data: RunPageData, ranAt: number, status: BadgeStatus): string {
  const name = data.name ?? `${data.owner}/${data.slug}`;
  const source = data.sourceFormat ? ` · source: ${escapeHtml(data.sourceFormat)}` : "";
  const brand = data.brand
    ? ` · <a href="${safeUrl(data.brand.homeUrl)}">${escapeHtml(data.brand.productName)}</a>`
    : "";
  return (
    `<header class="top">\n<div>\n<h1>Nightly run <span class="mono">${escapeHtml(data.runId)}</span></h1>\n` +
    `<p class="meta"><a href="${safeUrl(data.publicUrl)}">${escapeHtml(name)}</a> · <span class="mono">${escapeHtml(data.owner)}/${escapeHtml(data.slug)}</span> · ran ${escapeHtml(formatDateTime(ranAt))}${source}${brand}</p>\n</div>\n` +
    `<div class="top-right"><span class="pill pill-${status}">${escapeHtml(statusLabel(status))}</span></div>\n</header>\n`
  );
}

function runSummary(data: RunPageData, counts: Record<DiffVerdict, number>): string {
  const entries = Object.entries(data.summary);
  const items = [
    ...entries.map(
      ([k, v]) =>
        `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(typeof v === "number" ? String(v) : v)}</dd></div>`,
    ),
    `<div><dt>regressed</dt><dd>${counts.regressed}</dd></div>`,
    `<div><dt>improved</dt><dd>${counts.improved}</dd></div>`,
    `<div><dt>flakes</dt><dd>${counts.flake}</dd></div>`,
    `<div><dt>unchanged</dt><dd>${counts.unchanged}</dd></div>`,
  ];
  return `<section aria-label="Summary">\n<dl class="summary">\n${items.join("\n")}\n</dl>\n</section>\n`;
}

function diffTable(diffs: readonly RunDiff[]): string {
  if (diffs.length === 0) {
    return `<section aria-labelledby="h-diff">\n<h2 id="h-diff">Diff vs previous run</h2>\n<p class="empty">No checks compared.</p>\n</section>\n`;
  }
  const rows = diffs
    .map(
      (d) =>
        `<tr class="diff verdict-${d.verdict}"><td>${escapeHtml(d.check)}</td>` +
        `<td><span class="pill pill-${d.verdict}">${escapeHtml(verdictLabel(d.verdict))}</span></td>` +
        `<td class="diff-cell">${escapeHtml(d.before)}</td><td class="diff-cell">${escapeHtml(d.after)}</td></tr>`,
    )
    .join("\n");
  return (
    `<section aria-labelledby="h-diff">\n<h2 id="h-diff">Diff vs previous run</h2>\n<div class="table-wrap">\n<table>\n` +
    `<thead><tr><th>Check</th><th>Verdict</th><th>Before</th><th>After</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n</div>\n</section>\n`
  );
}

function driftSection(data: RunPageData): string {
  const series = (data.driftSeries ?? [])
    .map((p) => ({ t: toMs(p.ranAt), v: p.score }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (series.length === 0) return "";
  return (
    `<section aria-labelledby="h-drift">\n<h2 id="h-drift">Drift</h2>\n` +
    `<p class="muted small">Drift score per nightly run, 0 = identical to the previous run.</p>\n` +
    renderLineChart(series, { label: "Drift score per nightly run", yMin: 0 }) +
    `\n</section>\n`
  );
}

function modelsSection(models: Record<string, string> | undefined): string {
  if (!models || Object.keys(models).length === 0) return "";
  const rows = Object.entries(models)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="mono">${escapeHtml(v)}</td></tr>`)
    .join("\n");
  return (
    `<section aria-labelledby="h-models">\n<h2 id="h-models">Models seen</h2>\n<div class="table-wrap">\n<table>\n` +
    `<thead><tr><th>Component</th><th>Version</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n</div>\n</section>\n`
  );
}

/** Render the shareable page for one nightly run as a complete HTML document. */
export function renderRunPage(data: RunPageData, opts: RenderPageOptions = {}): string {
  const ranAt = toMs(data.ranAt);
  const now = resolveNow(opts.now ?? data.ranAt);
  const diffs = sortDiffs(data.diffs);
  const counts: Record<DiffVerdict, number> = { regressed: 0, improved: 0, unchanged: 0, flake: 0 };
  for (const d of diffs) counts[d.verdict] = (counts[d.verdict] ?? 0) + 1;
  const status: BadgeStatus =
    diffs.length === 0
      ? "no-data"
      : counts.regressed > 0
        ? "failing"
        : counts.flake > 0
          ? "degraded"
          : "passing";
  const name = data.name ?? `${data.owner}/${data.slug}`;
  const title = `Run ${data.runId} · ${name}`;
  const description = `Nightly run ${data.runId} for ${name}: ${counts.regressed} regressed, ${counts.improved} improved, ${counts.flake} flakes, ${counts.unchanged} unchanged.`;
  const footer =
    `<footer>\n<span>Generated ${escapeHtml(formatDateTime(now))}</span>\n` +
    `<span><a href="${safeUrl(data.publicUrl)}">Status page</a></span>\n` +
    (data.brand
      ? `<span>Powered by <a href="${safeUrl(data.brand.homeUrl)}">${escapeHtml(data.brand.productName)}</a></span>\n`
      : "") +
    `</footer>\n`;
  return (
    documentOpen(title, description, favicon(status) + "\n") +
    runHeader(data, ranAt, status) +
    (data.notice ? `<p class="notice">${escapeHtml(data.notice)}</p>\n` : "") +
    runSummary(data, counts) +
    diffTable(diffs) +
    driftSection(data) +
    modelsSection(data.modelVersions) +
    footer +
    DOCUMENT_CLOSE
  );
}

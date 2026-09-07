import { describe, expect, it } from "vitest";
import { demoRunPageData, demoStatusPageData } from "./fixtures.js";
import { HOUR_MS } from "./metrics.js";
import {
  badgeMarkdown,
  renderRunPage,
  renderStatusPage,
  sortDiffs,
  sortIncidents,
} from "./page.js";
import type { Incident, RunDiff, StatusPageData } from "./types.js";

const NOW = "2026-09-01T12:00:00Z";
const NOW_MS = Date.parse(NOW);
const BASE = "https://agentcheck.example";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("renderStatusPage", () => {
  const data = demoStatusPageData({ now: NOW, baseUrl: BASE });
  const html = renderStatusPage(data);

  it("is a complete HTML5 document with inline CSS and no script", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport"');
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain('rel="stylesheet"');
    expect(count(html, "<style>")).toBe(1);
    expect(html).toContain("prefers-color-scheme:dark");
  });

  it("shows name, kind, owner/slug, badge image and status pill", () => {
    expect(html).toContain("<h1>Acme support agent</h1>");
    expect(html).toContain("MCP server");
    expect(html).toContain('<span class="mono">demo/support-agent</span>');
    expect(html).toContain(`<img class="badge-img" src="${BASE}/badge/demo/support-agent.svg"`);
    expect(html).toContain('<span class="pill pill-degraded">Degraded</span>');
  });

  it("shows uptime tiles and p95 latency", () => {
    expect(html).toContain("uptime · 24h");
    expect(html).toContain("uptime · 7d");
    expect(html).toContain("uptime · 30d");
    // demo: 288 + 96 + 24 results, one failure → 407/408
    expect(html).toContain('<span class="stat-v">99.75%</span>');
    expect(html).toContain("p95 latency · 24h");
  });

  it("renders a 24-bar timeline and a latency sparkline per check", () => {
    expect(count(html, '<svg class="timeline"')).toBe(3);
    expect(count(html, 'class="tl-bar')).toBe(24 * 3);
    expect(count(html, '<svg class="spark"')).toBe(3);
    expect(count(html, '<path class="spark-line"')).toBe(3);
    expect(count(html, 'class="tl-bar tl-fail"') + count(html, 'class="tl-bar tl-mixed"')).toBe(1);
  });

  it("renders the nightly table and drift chart", () => {
    expect(html).toContain("Nightly suite");
    expect(html).toContain("92.3%");
    expect(html).toContain("claude-sonnet-4-5");
    expect(html).toContain('<svg class="chart"');
  });

  it("renders the README snippet and trust.json links", () => {
    expect(html).toContain("Add to your README");
    expect(html).toContain(
      `[![Acme support agent status](${BASE}/badge/demo/support-agent.svg)](${BASE}/demo/support-agent)`,
    );
    expect(count(html, `href="${BASE}/demo/support-agent/trust.json"`)).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Generated 2026-09-01 12:00 UTC");
    expect(html).toContain('Powered by <a href="/">AgentCheck</a>');
  });

  it("escapes every user-provided string", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const hostile: StatusPageData = {
      ...data,
      name: evil,
      owner: "own<er",
      slug: 'sl"ug',
      checks: data.checks.map((c) => ({ ...c, name: `${c.name} ${evil}`, kind: `k<${c.kind}` })),
      incidents: [{ id: "i<1", openedAt: NOW, cause: `boom ${evil}`, checkName: `chk ${evil}` }],
      nightly: [{ ranAt: NOW, modelVersions: { [`m<${"k"}`]: `v${evil}` } }],
      brand: { productName: `Brand ${evil}`, homeUrl: "/" },
    };
    const out = renderStatusPage(hostile);
    expect(out).not.toContain(evil);
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(out).toContain("own&lt;er/sl&quot;ug");
    expect(out).toContain("k&lt;mcp.tools_list");
    expect(out).toContain("m&lt;k");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("neutralises javascript: and data: URLs", () => {
    const out = renderStatusPage({
      ...data,
      publicUrl: "javascript:alert(1)",
      badgeUrl: "data:text/html,<script>alert(1)</script>",
      trustUrl: " JAVASCRIPT:alert(2)",
      brand: { productName: "x", homeUrl: "/\\evil.example" },
    });
    const attrUrls = [...out.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(attrUrls.length).toBeGreaterThan(0);
    expect(attrUrls.filter((u) => /javascript:|data:text|evil\.example/i.test(u))).toEqual([]);
    expect(attrUrls.filter((u) => u === "#").length).toBeGreaterThanOrEqual(4);
    // the snippet still shows the configured URL as escaped text, never as markup
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("lists open incidents before closed ones, newest first within each group", () => {
    const incidents: Incident[] = [
      {
        id: "closed_new",
        openedAt: new Date(NOW_MS - 1 * HOUR_MS).toISOString(),
        closedAt: new Date(NOW_MS - 0.5 * HOUR_MS).toISOString(),
        cause: "closed recently",
      },
      {
        id: "open_old",
        openedAt: new Date(NOW_MS - 9 * HOUR_MS).toISOString(),
        cause: "still open",
      },
      {
        id: "closed_old",
        openedAt: new Date(NOW_MS - 20 * HOUR_MS).toISOString(),
        closedAt: new Date(NOW_MS - 19 * HOUR_MS).toISOString(),
        cause: "closed long ago",
      },
      {
        id: "open_new",
        openedAt: new Date(NOW_MS - 2 * HOUR_MS).toISOString(),
        closedAt: null,
        cause: "opened recently",
      },
    ];
    expect(sortIncidents(incidents).map((i) => i.id)).toEqual([
      "open_new",
      "open_old",
      "closed_new",
      "closed_old",
    ]);
    const out = renderStatusPage({ ...data, incidents });
    const pos = (id: string) => out.indexOf(`id="incident-${id}"`);
    expect(pos("open_new")).toBeGreaterThan(0);
    expect(pos("open_new")).toBeLessThan(pos("open_old"));
    expect(pos("open_old")).toBeLessThan(pos("closed_new"));
    expect(pos("closed_new")).toBeLessThan(pos("closed_old"));
    expect(out).toContain("Incidents · 2 open");
    expect(out).toContain("ongoing for 2 h 00 min");
    expect(out).toContain("resolved after 30 min");
  });

  it("renders empty states without nightly data", () => {
    const out = renderStatusPage({
      ...data,
      checks: [],
      incidents: [],
      nightly: undefined,
      brand: undefined,
    });
    expect(out).toContain("No checks configured yet.");
    expect(out).toContain("No incidents recorded.");
    expect(out).toContain('<span class="pill pill-no-data">No data</span>');
    expect(out).not.toContain("Nightly suite");
    expect(out).not.toContain("Powered by");
    expect(out).toContain('<span class="stat-v">—</span>');
  });

  it("uses generatedAt as now unless overridden", () => {
    const later = renderStatusPage(data, { now: NOW_MS + 30 * HOUR_MS });
    expect(later).toContain("Generated 2026-09-02 18:00 UTC");
    expect(later).toContain('<span class="pill pill-passing">Passing</span>');
  });
});

describe("badgeMarkdown", () => {
  it("strips brackets from the alt text", () => {
    expect(badgeMarkdown({ name: "a [b]", badgeUrl: "/b.svg", publicUrl: "/p" })).toBe(
      "[![a  b status](/b.svg)](/p)",
    );
  });
});

describe("renderRunPage", () => {
  const data = demoRunPageData({ now: NOW, baseUrl: BASE });
  const html = renderRunPage(data);

  it("is a complete document with no script", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).toContain("run_demo_1");
    expect(html).toContain(`<a href="${BASE}/demo/support-agent">Acme support agent</a>`);
    expect(html).toContain("source: agentcheck");
  });

  it("orders the diff table regressed first", () => {
    const diffs: RunDiff[] = [
      { check: "u1", before: "a", after: "a", verdict: "unchanged" },
      { check: "i1", before: "fail", after: "pass", verdict: "improved" },
      { check: "f1", before: "pass", after: "flaky", verdict: "flake" },
      { check: "r1", before: "pass", after: "fail", verdict: "regressed" },
      { check: "u2", before: "b", after: "b", verdict: "unchanged" },
      { check: "r2", before: "pass", after: "fail", verdict: "regressed" },
    ];
    expect(sortDiffs(diffs).map((d) => d.check)).toEqual(["r1", "r2", "i1", "f1", "u1", "u2"]);
    const out = renderRunPage({ ...data, diffs });
    const rows = out.match(/<tr class="diff verdict-[a-z]+"/g) ?? [];
    expect(rows).toHaveLength(6);
    expect(rows[0]).toBe('<tr class="diff verdict-regressed"');
    expect(rows[1]).toBe('<tr class="diff verdict-regressed"');
    expect(rows[5]).toBe('<tr class="diff verdict-unchanged"');
    expect(out).toContain("<dt>regressed</dt><dd>2</dd>");
    expect(out).toContain('<span class="pill pill-failing">Failing</span>');
  });

  it("renders summary tiles, drift chart and model versions", () => {
    expect(html).toContain("<dt>pass rate</dt><dd>91.7%</dd>");
    expect(html).toContain("<dt>cost (USD)</dt><dd>0.31</dd>");
    expect(html).toContain('<svg class="chart"');
    expect(count(html, '<circle class="dot"')).toBe(14);
    expect(html).toContain("Models seen");
    expect(html).toContain("support-agent@1.4.2");
  });

  it("escapes diff content and drops the drift section without data", () => {
    const out = renderRunPage({
      ...data,
      runId: "<b>x</b>",
      diffs: [{ check: "<c>", before: "<i>", after: "</td>", verdict: "regressed" }],
      driftSeries: [],
      modelVersions: {},
    });
    expect(out).not.toContain("<b>x</b>");
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(out).toContain("&lt;c&gt;");
    expect(out).toContain("&lt;/td&gt;");
    expect(out).not.toContain('id="h-drift"');
    expect(out).not.toContain("Models seen");
  });

  it("is passing with no regressions and degraded with flakes", () => {
    const ok = renderRunPage({
      ...data,
      diffs: [{ check: "a", before: "p", after: "p", verdict: "unchanged" }],
    });
    expect(ok).toContain('pill-passing">Passing');
    const flaky = renderRunPage({
      ...data,
      diffs: [{ check: "a", before: "p", after: "p", verdict: "flake" }],
    });
    expect(flaky).toContain('pill-degraded">Degraded');
  });
});

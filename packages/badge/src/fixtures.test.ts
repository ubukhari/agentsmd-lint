import { describe, expect, it } from "vitest";
import { demoRunPageData, demoStatusPageData } from "./fixtures.js";
import { DAY_MS, toMs } from "./metrics.js";

const NOW = "2026-09-01T12:00:00Z";

describe("demoStatusPageData", () => {
  const data = demoStatusPageData({ now: NOW });

  it("has 3 checks with 24h of results, exactly one failure and one closed incident", () => {
    expect(data.checks).toHaveLength(3);
    expect(data.checks.map((c) => c.results.length)).toEqual([288, 96, 24]);
    const nowMs = toMs(NOW);
    for (const c of data.checks) {
      for (const r of c.results) {
        const t = toMs(r.ranAt);
        expect(t).toBeLessThanOrEqual(nowMs);
        expect(t).toBeGreaterThanOrEqual(nowMs - DAY_MS);
        expect(Number.isFinite(r.latencyMs)).toBe(true);
      }
    }
    const failures = data.checks.flatMap((c) => c.results.filter((r) => !r.pass));
    expect(failures).toHaveLength(1);
    expect(data.incidents).toHaveLength(1);
    expect(data.incidents[0]?.closedAt).toBeTruthy();
    expect(data.incidents[0]?.openedAt).toBe(failures[0]?.ranAt);
    expect(data.nightly).toHaveLength(3);
    expect(data.generatedAt).toBe("2026-09-01T12:00:00.000Z");
  });

  it("is deterministic for a given now and honours baseUrl/owner/slug", () => {
    expect(demoStatusPageData({ now: NOW })).toEqual(data);
    const custom = demoStatusPageData({
      now: NOW,
      baseUrl: "https://x.test/",
      owner: "o",
      slug: "s",
    });
    expect(custom.publicUrl).toBe("https://x.test/o/s");
    expect(custom.badgeUrl).toBe("https://x.test/badge/o/s.svg");
    expect(custom.trustUrl).toBe("https://x.test/o/s/trust.json");
  });
});

describe("demoRunPageData", () => {
  it("has one regressed diff and a 14-point drift series", () => {
    const run = demoRunPageData({ now: NOW });
    expect(run.diffs.filter((d) => d.verdict === "regressed")).toHaveLength(1);
    expect(run.driftSeries).toHaveLength(14);
    expect(run.publicUrl).toBe("/demo/support-agent");
  });
});

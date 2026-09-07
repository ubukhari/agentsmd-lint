import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  WEEK_MS,
  bucketize,
  computeUptime,
  inWindow,
  lastCheckAt,
  latestResult,
  latestStatus,
  mean,
  p95,
  toIso,
  toMs,
  uptimeSummary,
} from "./metrics.js";
import type { CheckResultPoint, CheckSeries } from "./types.js";

const NOW = Date.parse("2026-09-01T12:00:00Z");

/** `n` results, one per hour, newest first; `failIdx` are hours-ago that failed. */
function hourly(n: number, failIdx: number[] = [], offsetMs = 30 * MINUTE_MS): CheckResultPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    ranAt: new Date(NOW - i * HOUR_MS - offsetMs).toISOString(),
    pass: !failIdx.includes(i),
    latencyMs: 100 + i,
  }));
}

function check(id: string, results: CheckResultPoint[]): CheckSeries {
  return { id, name: id, kind: "http.get", intervalSec: 3600, results };
}

describe("toMs / toIso", () => {
  it("accepts ISO strings, Dates and numbers", () => {
    expect(toMs("2026-09-01T12:00:00Z")).toBe(NOW);
    expect(toMs(new Date(NOW))).toBe(NOW);
    expect(toMs(NOW)).toBe(NOW);
    expect(Number.isNaN(toMs("nope"))).toBe(true);
    expect(toIso(NOW)).toBe("2026-09-01T12:00:00.000Z");
    expect(toIso("nope")).toBe("");
  });
});

describe("computeUptime", () => {
  it("returns 95.83 for 23 of 24 passing", () => {
    expect(computeUptime(hourly(24, [5]), DAY_MS, NOW)).toBe(95.83);
  });

  it("returns 100 when everything passes and 0 when everything fails", () => {
    expect(computeUptime(hourly(4), DAY_MS, NOW)).toBe(100);
    expect(computeUptime(hourly(4, [0, 1, 2, 3]), DAY_MS, NOW)).toBe(0);
  });

  it("returns null when the window holds no results", () => {
    expect(computeUptime([], DAY_MS, NOW)).toBeNull();
    expect(computeUptime(hourly(3), 10 * MINUTE_MS, NOW)).toBeNull();
  });

  it("ignores results outside the window and unparseable timestamps", () => {
    const results = [
      ...hourly(2),
      { ranAt: new Date(NOW - 3 * DAY_MS).toISOString(), pass: false, latencyMs: 1 },
      { ranAt: new Date(NOW + HOUR_MS).toISOString(), pass: false, latencyMs: 1 },
      { ranAt: "not a date", pass: false, latencyMs: 1 },
    ];
    expect(computeUptime(results, DAY_MS, NOW)).toBe(100);
    expect(computeUptime(results, WEEK_MS, NOW)).toBe(66.67);
  });

  it("accepts a Date or ISO string as now", () => {
    expect(computeUptime(hourly(24, [5]), DAY_MS, new Date(NOW))).toBe(95.83);
    expect(computeUptime(hourly(24, [5]), DAY_MS, "2026-09-01T12:00:00Z")).toBe(95.83);
  });
});

describe("latestStatus", () => {
  it("is no-data without results", () => {
    expect(latestStatus([], NOW)).toBe("no-data");
    expect(latestStatus([check("a", [])], NOW)).toBe("no-data");
  });

  it("is failing when the latest result of any check failed", () => {
    expect(latestStatus([check("a", hourly(5)), check("b", hourly(5, [0]))], NOW)).toBe("failing");
  });

  it("is degraded when a check failed within 24h but all latest results pass", () => {
    expect(latestStatus([check("a", hourly(5)), check("b", hourly(5, [3]))], NOW)).toBe("degraded");
  });

  it("is passing when nothing failed in the last 24h", () => {
    expect(latestStatus([check("a", hourly(5))], NOW)).toBe("passing");
    // a failure 30h ago no longer counts
    expect(latestStatus([check("a", hourly(36, [30]))], NOW)).toBe("passing");
  });

  it("picks the latest result by timestamp, not array order", () => {
    const results = [...hourly(3, [0])].reverse(); // newest (failed) is last in the array
    expect(latestStatus([check("a", results)], NOW)).toBe("failing");
  });
});

describe("p95 / mean", () => {
  it("uses nearest-rank percentile", () => {
    expect(p95([])).toBeNull();
    expect(p95([42])).toBe(42);
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(p95([5, 1, 4, 2, 3])).toBe(5);
    expect(p95([1, 2, Number.NaN])).toBe(2);
  });

  it("averages finite values", () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
  });
});

describe("bucketize", () => {
  it("returns 24 buckets covering the last 24h with one result each", () => {
    const buckets = bucketize(hourly(24, [5]), 24, DAY_MS, NOW);
    expect(buckets).toHaveLength(24);
    expect(buckets.every((b) => b.pass + b.fail === 1)).toBe(true);
    expect(buckets[0]?.start).toBe(new Date(NOW - DAY_MS).toISOString());
    expect(buckets[23]?.end).toBe(new Date(NOW).toISOString());
    // hours-ago 5 lands in bucket 18 (0-based from the oldest)
    expect(buckets[18]).toMatchObject({ pass: 0, fail: 1, avgLatency: 105 });
    expect(buckets[23]).toMatchObject({ pass: 1, fail: 0, avgLatency: 100 });
  });

  it("marks empty buckets with zero counts and null latency", () => {
    const buckets = bucketize(hourly(2), 24, DAY_MS, NOW);
    expect(buckets[0]).toMatchObject({ pass: 0, fail: 0, avgLatency: null });
  });

  it("drops results outside the window and clamps the boundary", () => {
    const results: CheckResultPoint[] = [
      { ranAt: new Date(NOW).toISOString(), pass: true, latencyMs: 10 }, // exactly now → last bucket
      { ranAt: new Date(NOW - DAY_MS).toISOString(), pass: true, latencyMs: 10 }, // exactly start → first
      { ranAt: new Date(NOW - DAY_MS - 1).toISOString(), pass: false, latencyMs: 10 }, // outside
    ];
    const buckets = bucketize(results, 24, DAY_MS, NOW);
    expect(buckets[23]?.pass).toBe(1);
    expect(buckets[0]?.pass).toBe(1);
    expect(buckets.reduce((n, b) => n + b.fail, 0)).toBe(0);
  });

  it("returns [] for a non-positive bucket count or window", () => {
    expect(bucketize(hourly(3), 0, DAY_MS, NOW)).toEqual([]);
    expect(bucketize(hourly(3), 24, 0, NOW)).toEqual([]);
  });
});

describe("helpers", () => {
  it("inWindow sorts ascending", () => {
    const pts = inWindow(hourly(3), DAY_MS, NOW);
    expect(pts.map((p) => toMs(p.ranAt))).toEqual(
      [...pts.map((p) => toMs(p.ranAt))].sort((a, b) => a - b),
    );
  });

  it("latestResult / lastCheckAt", () => {
    expect(latestResult([])).toBeNull();
    expect(latestResult(hourly(3))?.latencyMs).toBe(100);
    expect(lastCheckAt([])).toBeNull();
    expect(lastCheckAt([check("a", hourly(3)), check("b", [])])).toBe(NOW - 30 * MINUTE_MS);
  });

  it("uptimeSummary combines all checks", () => {
    const s = uptimeSummary([check("a", hourly(24, [0])), check("b", hourly(24))], NOW);
    expect(s).toEqual({ uptime24h: 97.92, uptime7d: 97.92, uptime30d: 97.92 });
    expect(uptimeSummary([], NOW)).toEqual({ uptime24h: null, uptime7d: null, uptime30d: null });
  });
});

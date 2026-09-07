/**
 * Pure metrics over check results: uptime, overall status, p95, timeline buckets.
 * All functions accept an optional `now` so rendering stays deterministic.
 */
import type { BadgeStatus, CheckResultPoint, CheckSeries, DateInput } from "./types.js";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;
export const MONTH_MS = 30 * DAY_MS;

export type NowInput = DateInput | number;

/** ISO string | Date | epoch ms → epoch ms (NaN when unparseable). */
export function toMs(d: NowInput): number {
  if (typeof d === "number") return d;
  if (d instanceof Date) return d.getTime();
  return Date.parse(d);
}

/** ISO string | Date | epoch ms → ISO string ("" when unparseable). */
export function toIso(d: NowInput): string {
  const ms = toMs(d);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

export function resolveNow(now?: NowInput): number {
  return now === undefined ? Date.now() : toMs(now);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Results with a valid timestamp inside `[now - windowMs, now]`, sorted ascending. */
export function inWindow(
  results: readonly CheckResultPoint[],
  windowMs: number,
  now?: NowInput,
): CheckResultPoint[] {
  const end = resolveNow(now);
  const start = end - windowMs;
  return results
    .map((r) => ({ r, t: toMs(r.ranAt) }))
    .filter(({ t }) => Number.isFinite(t) && t >= start && t <= end)
    .sort((a, b) => a.t - b.t)
    .map(({ r }) => r);
}

/**
 * Percentage of passing results among those inside the window, rounded to
 * two decimals (23/24 → 95.83). `null` when the window holds no results.
 */
export function computeUptime(
  results: readonly CheckResultPoint[],
  windowMs: number,
  now?: NowInput,
): number | null {
  const pts = inWindow(results, windowMs, now);
  if (pts.length === 0) return null;
  const passing = pts.reduce((n, r) => n + (r.pass ? 1 : 0), 0);
  return round2((passing / pts.length) * 100);
}

/** Most recent result with a valid timestamp, or null. */
export function latestResult(results: readonly CheckResultPoint[]): CheckResultPoint | null {
  let best: CheckResultPoint | null = null;
  let bestT = -Infinity;
  for (const r of results) {
    const t = toMs(r.ranAt);
    if (Number.isFinite(t) && t > bestT) {
      best = r;
      bestT = t;
    }
  }
  return best;
}

/** Epoch ms of the most recent result across all checks, or null. */
export function lastCheckAt(checks: readonly CheckSeries[]): number | null {
  let best: number | null = null;
  for (const c of checks) {
    const r = latestResult(c.results);
    if (!r) continue;
    const t = toMs(r.ranAt);
    if (best === null || t > best) best = t;
  }
  return best;
}

export function allResults(checks: readonly CheckSeries[]): CheckResultPoint[] {
  return checks.flatMap((c) => c.results);
}

/**
 * Overall status:
 * - `no-data` when no check has any result;
 * - `failing` when the latest result of any check failed;
 * - `degraded` when every latest result passes but some check failed in the last 24h;
 * - `passing` otherwise.
 */
export function latestStatus(checks: readonly CheckSeries[], now?: NowInput): BadgeStatus {
  const end = resolveNow(now);
  const latest = checks.map((c) => latestResult(c.results)).filter((r) => r !== null);
  if (latest.length === 0) return "no-data";
  if (latest.some((r) => !r.pass)) return "failing";
  const since = end - DAY_MS;
  for (const c of checks) {
    for (const r of c.results) {
      if (r.pass) continue;
      const t = toMs(r.ranAt);
      if (Number.isFinite(t) && t >= since && t <= end) return "degraded";
    }
  }
  return "passing";
}

/** Nearest-rank 95th percentile; null for an empty input. */
export function p95(latencies: readonly number[]): number | null {
  return percentile(latencies, 95);
}

export function percentile(values: readonly number[], pct: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = Math.ceil((pct / 100) * xs.length);
  const idx = Math.min(xs.length - 1, Math.max(0, rank - 1));
  return xs[idx] ?? null;
}

export function mean(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export interface TimelineBucket {
  /** ISO start of the bucket (inclusive) */
  start: string;
  /** ISO end of the bucket (exclusive, except the last bucket which ends at `now`) */
  end: string;
  pass: number;
  fail: number;
  /** mean latency of results in the bucket, rounded; null when empty */
  avgLatency: number | null;
}

/** Split `[now - windowMs, now]` into `buckets` equal slots and count pass/fail per slot. */
export function bucketize(
  results: readonly CheckResultPoint[],
  buckets = 24,
  windowMs = DAY_MS,
  now?: NowInput,
): TimelineBucket[] {
  if (!(buckets > 0) || !(windowMs > 0)) return [];
  const end = resolveNow(now);
  const start = end - windowMs;
  const width = windowMs / buckets;
  const acc = Array.from({ length: buckets }, (_, i) => ({
    start: start + i * width,
    pass: 0,
    fail: 0,
    latSum: 0,
    latN: 0,
  }));
  for (const r of results) {
    const t = toMs(r.ranAt);
    if (!Number.isFinite(t) || t < start || t > end) continue;
    const i = Math.min(buckets - 1, Math.floor((t - start) / width));
    const b = acc[i];
    if (!b) continue;
    if (r.pass) b.pass += 1;
    else b.fail += 1;
    if (Number.isFinite(r.latencyMs)) {
      b.latSum += r.latencyMs;
      b.latN += 1;
    }
  }
  return acc.map((b) => ({
    start: new Date(b.start).toISOString(),
    end: new Date(b.start + width).toISOString(),
    pass: b.pass,
    fail: b.fail,
    avgLatency: b.latN > 0 ? Math.round(b.latSum / b.latN) : null,
  }));
}

export interface UptimeSummary {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
}

/** Uptime across every check's results combined. */
export function uptimeSummary(checks: readonly CheckSeries[], now?: NowInput): UptimeSummary {
  const all = allResults(checks);
  return {
    uptime24h: computeUptime(all, DAY_MS, now),
    uptime7d: computeUptime(all, WEEK_MS, now),
    uptime30d: computeUptime(all, MONTH_MS, now),
  };
}

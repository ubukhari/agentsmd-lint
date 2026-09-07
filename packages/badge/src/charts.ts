/**
 * Inline-SVG charts for the status and run pages. Pure string builders, no
 * DOM, no scripts. Colours come from CSS classes so the page's light/dark
 * palette applies; attribute fallbacks keep them legible stand-alone.
 */
import { escapeXml } from "./escape.js";
import type { TimelineBucket } from "./metrics.js";
import { formatDate, formatDateTime, formatMs } from "./format.js";

export const CHART_COLORS = {
  pass: "#3fb950",
  fail: "#e05d44",
  mixed: "#dfb317",
  empty: "#8b949e",
} as const;

function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export interface TimelineOptions {
  /** accessible name of the chart */
  label: string;
  width?: number;
  height?: number;
  gap?: number;
}

/**
 * One bar per bucket, coloured by outcome: green = all pass, red = all fail,
 * amber = mixed, grey = no results. Each bar carries a `<title>` tooltip.
 */
export function renderTimeline(buckets: readonly TimelineBucket[], opts: TimelineOptions): string {
  const width = opts.width ?? 480;
  const height = opts.height ?? 32;
  const gap = opts.gap ?? 2;
  const count = buckets.length;
  const barWidth = count > 0 ? (width - gap * (count - 1)) / count : width;
  const bars = buckets
    .map((b, i) => {
      const total = b.pass + b.fail;
      let fill: string;
      let state: "pass" | "fail" | "mixed" | "empty";
      if (total === 0) {
        fill = CHART_COLORS.empty;
        state = "empty";
      } else if (b.fail === 0) {
        fill = CHART_COLORS.pass;
        state = "pass";
      } else if (b.pass === 0) {
        fill = CHART_COLORS.fail;
        state = "fail";
      } else {
        fill = CHART_COLORS.mixed;
        state = "mixed";
      }
      const x = n(i * (barWidth + gap));
      const opacity = state === "empty" ? ' fill-opacity=".25"' : "";
      const range = `${formatDateTime(Date.parse(b.start))} – ${formatDateTime(Date.parse(b.end))}`;
      const summary =
        total === 0
          ? "no checks"
          : `${b.pass} pass, ${b.fail} fail${b.avgLatency !== null ? `, avg ${formatMs(b.avgLatency)}` : ""}`;
      return `<rect class="tl-bar tl-${state}" x="${x}" y="0" width="${n(barWidth)}" height="${height}" rx="1" fill="${fill}"${opacity}><title>${escapeXml(range)}: ${escapeXml(summary)}</title></rect>`;
    })
    .join("");
  return `<svg class="timeline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeXml(opts.label)}">${bars}</svg>`;
}

export interface ChartPoint {
  /** epoch ms */
  t: number;
  v: number;
  /** tooltip text; defaults to a formatted value */
  title?: string;
}

export interface SparklineOptions {
  label: string;
  /** epoch ms of the left edge */
  start: number;
  /** epoch ms of the right edge */
  end: number;
  width?: number;
  height?: number;
  formatValue?: (v: number) => string;
}

function finitePoints(points: readonly ChartPoint[]): ChartPoint[] {
  return points
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
}

/** Single stroked path over a fixed time window, plus a dot on the last point. */
export function renderSparkline(points: readonly ChartPoint[], opts: SparklineOptions): string {
  const width = opts.width ?? 480;
  const height = opts.height ?? 40;
  const pad = 3;
  const pts = finitePoints(points);
  const fmt = opts.formatValue ?? ((v: number) => formatMs(v));
  const open = `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeXml(opts.label)}">`;
  if (pts.length < 2 || !(opts.end > opts.start)) {
    return `${open}<text class="spark-empty" x="${width / 2}" y="${height / 2 + 4}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".6">not enough data</text></svg>`;
  }
  const vs = pts.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const x = (t: number) =>
    Math.min(width, Math.max(0, ((t - opts.start) / (opts.end - opts.start)) * width));
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${n(x(p.t))} ${n(y(p.v))}`).join(" ");
  const last = pts[pts.length - 1];
  const dot = last
    ? `<circle class="spark-dot" cx="${n(x(last.t))}" cy="${n(y(last.v))}" r="2.5" fill="currentColor"><title>${escapeXml(last.title ?? `${formatDateTime(last.t)}: ${fmt(last.v)}`)}</title></circle>`
    : "";
  return `${open}<title>${escapeXml(`${opts.label}: min ${fmt(min)}, max ${fmt(max)}`)}</title><path class="spark-line" d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${dot}</svg>`;
}

export interface LineChartOptions {
  label: string;
  width?: number;
  height?: number;
  /** fixed y range; defaults to the data range padded */
  yMin?: number;
  yMax?: number;
  formatValue?: (v: number) => string;
  formatTime?: (t: number) => string;
}

/** Line chart with y grid lines, first/last x labels and a titled dot per point. */
export function renderLineChart(points: readonly ChartPoint[], opts: LineChartOptions): string {
  const width = opts.width ?? 640;
  const height = opts.height ?? 180;
  const ml = 44;
  const mr = 14;
  const mt = 12;
  const mb = 26;
  const pts = finitePoints(points);
  const fmtV = opts.formatValue ?? ((v: number) => v.toFixed(2));
  const fmtT = opts.formatTime ?? ((t: number) => formatDate(t));
  const open = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(opts.label)}">`;
  if (pts.length === 0) {
    return `${open}<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="12" fill="currentColor" fill-opacity=".6">no data</text></svg>`;
  }
  const vs = pts.map((p) => p.v);
  const dataMin = Math.min(...vs);
  const dataMax = Math.max(...vs);
  const padY = (dataMax - dataMin || Math.abs(dataMax) || 1) * 0.1;
  const yMin = opts.yMin ?? Math.min(0, dataMin - padY);
  const yMax = opts.yMax ?? dataMax + padY;
  const ySpan = yMax - yMin || 1;
  const t0 = pts[0]?.t ?? 0;
  const t1 = pts[pts.length - 1]?.t ?? t0;
  const tSpan = t1 - t0 || 1;
  const plotW = width - ml - mr;
  const plotH = height - mt - mb;
  const x = (t: number) => ml + ((t - t0) / tSpan) * plotW;
  const y = (v: number) => mt + plotH - ((v - yMin) / ySpan) * plotH;

  const grid = [yMin, (yMin + yMax) / 2, yMax]
    .map((v) => {
      const yy = n(y(v));
      return `<line class="grid" x1="${ml}" y1="${yy}" x2="${width - mr}" y2="${yy}" stroke="currentColor" stroke-opacity=".15"/><text class="axis" x="${ml - 6}" y="${n(y(v) + 4)}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".7">${escapeXml(fmtV(v))}</text>`;
    })
    .join("");
  const xLabels = `<text class="axis" x="${ml}" y="${height - 8}" font-size="11" fill="currentColor" fill-opacity=".7">${escapeXml(fmtT(t0))}</text><text class="axis" x="${width - mr}" y="${height - 8}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".7">${escapeXml(fmtT(t1))}</text>`;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${n(x(p.t))} ${n(y(p.v))}`).join(" ");
  const line =
    pts.length > 1
      ? `<path class="line" d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
      : "";
  const dots = pts
    .map(
      (p) =>
        `<circle class="dot" cx="${n(x(p.t))}" cy="${n(y(p.v))}" r="3.5" fill="currentColor"><title>${escapeXml(p.title ?? `${formatDateTime(p.t)}: ${fmtV(p.v)}`)}</title></circle>`,
    )
    .join("");
  return `${open}${grid}${xLabels}${line}${dots}</svg>`;
}

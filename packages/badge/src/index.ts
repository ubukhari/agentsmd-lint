/**
 * @agentwares/badge — shields-style status badge, no-JS public status page,
 * shareable run page and trust.json. Pure string builders: runs on Cloudflare
 * Workers, Vercel Functions and Node.
 */
export type {
  BadgeStatus,
  Brand,
  CheckResultPoint,
  CheckSeries,
  DateInput,
  DiffVerdict,
  DriftPoint,
  Incident,
  NightlyScores,
  RunDiff,
  RunPageData,
  RunSourceFormat,
  StatusPageData,
  TargetKind,
} from "./types.js";

export {
  BADGE_COLORS,
  BADGE_HEIGHT,
  BADGE_LABEL_COLOR,
  STATUS_MESSAGES,
  badgeHeaders,
  badgeWidth,
  estimateTextWidth,
  renderBadge,
  renderStatusBadge,
} from "./badge.js";
export type { BadgeStyle, RenderBadgeOptions, StatusBadgeOptions } from "./badge.js";

export {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  MONTH_MS,
  WEEK_MS,
  allResults,
  bucketize,
  computeUptime,
  inWindow,
  lastCheckAt,
  latestResult,
  latestStatus,
  mean,
  p95,
  percentile,
  toIso,
  toMs,
  uptimeSummary,
} from "./metrics.js";
export type { NowInput, TimelineBucket, UptimeSummary } from "./metrics.js";

export {
  PAGE_CSS,
  badgeMarkdown,
  renderRunPage,
  renderStatusPage,
  sortDiffs,
  sortIncidents,
  sortNightly,
} from "./page.js";
export type { RenderPageOptions } from "./page.js";

export { TRUST_SCHEMA, buildTrustJson, latestNightly, modelsSeen, trustHeaders } from "./trust.js";
export type { BuildTrustOptions, TrustJson, TrustNightly } from "./trust.js";

export { CHART_COLORS, renderLineChart, renderSparkline, renderTimeline } from "./charts.js";
export type { ChartPoint, LineChartOptions, SparklineOptions, TimelineOptions } from "./charts.js";

export { escapeHtml, escapeXml, safeUrl } from "./escape.js";
export {
  formatDate,
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

export { demoRunPageData, demoStatusPageData } from "./fixtures.js";
export type { DemoOptions } from "./fixtures.js";

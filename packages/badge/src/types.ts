/**
 * @agentwares/badge — input types.
 *
 * DB-agnostic: apps map their Drizzle rows into these shapes and hand them to
 * the renderers. Everything here is plain data, so the package runs unchanged
 * on Cloudflare Workers, Vercel Functions and Node.
 *
 * Conventions:
 * - Timestamps are ISO-8601 strings or `Date` objects.
 * - Rates (uptime, pass rates) are **percentages 0–100**, never fractions.
 * - `driftScore` is 0–1, higher = more drift versus the previous run.
 */

/** Overall status shown on the badge and the status pill. */
export type BadgeStatus = "passing" | "failing" | "degraded" | "unknown" | "no-data";

/** Kind of monitored target. */
export type TargetKind = "http" | "mcp" | "a2a" | "voice";

/** ISO-8601 string or Date. */
export type DateInput = string | Date;

/** One execution of a check. */
export interface CheckResultPoint {
  ranAt: DateInput;
  pass: boolean;
  latencyMs: number;
  /** optional judge score, 0–100 */
  score?: number | null;
}

/** A check and its recent results (any order; the renderers sort). */
export interface CheckSeries {
  id: string;
  name: string;
  /** free-form kind label, e.g. "mcp.tools_list", "http.get", "judge.rubric" */
  kind: string;
  intervalSec: number;
  results: CheckResultPoint[];
}

export interface Incident {
  id: string;
  openedAt: DateInput;
  /** null/undefined while the incident is still open */
  closedAt?: DateInput | null;
  cause: string;
  checkName?: string;
}

/** Scores from one nightly suite run. Rates are percentages 0–100. */
export interface NightlyScores {
  ranAt: DateInput;
  replayPassRate?: number | null;
  adversarialPassRate?: number | null;
  /** 0–1, higher = more drift */
  driftScore?: number | null;
  /** e.g. { model: "claude-sonnet-4-5", agent: "support-bot@1.4.2" } */
  modelVersions?: Record<string, string>;
}

export interface Brand {
  productName: string;
  homeUrl: string;
}

/** Everything the public status page, badge and trust.json need. */
export interface StatusPageData {
  owner: string;
  slug: string;
  name: string;
  kind: TargetKind;
  /** absolute or root-relative URL of the status page itself */
  publicUrl: string;
  /** URL of the badge SVG */
  badgeUrl: string;
  /** URL of trust.json */
  trustUrl: string;
  checks: CheckSeries[];
  incidents: Incident[];
  nightly?: NightlyScores[];
  /** "now" for every window calculation; keeps rendering deterministic */
  generatedAt: DateInput;
  brand?: Brand;
}

export type DiffVerdict = "regressed" | "improved" | "unchanged" | "flake";

export interface RunDiff {
  check: string;
  before: string;
  after: string;
  verdict: DiffVerdict;
}

export interface DriftPoint {
  ranAt: DateInput;
  /** 0–1, higher = more drift */
  score: number;
}

export type RunSourceFormat = "agentcheck" | "promptfoo" | "braintrust";

/** Shareable page for one nightly run: `/<owner>/<slug>/runs/<id>`. */
export interface RunPageData {
  owner: string;
  slug: string;
  runId: string;
  ranAt: DateInput;
  /** headline numbers, rendered as stat tiles in insertion order */
  summary: Record<string, string | number>;
  diffs: RunDiff[];
  driftSeries?: DriftPoint[];
  modelVersions?: Record<string, string>;
  /** URL of the target's status page */
  publicUrl: string;
  sourceFormat?: RunSourceFormat;
  /** display name of the target; falls back to `owner/slug` */
  name?: string;
  brand?: Brand;
}

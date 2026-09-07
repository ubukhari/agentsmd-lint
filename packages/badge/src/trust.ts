/**
 * trust.json — the machine-readable version of the badge, served at
 * `/<owner>/<slug>/trust.json`.
 */
import { lastCheckAt, latestStatus, resolveNow, toIso, toMs, uptimeSummary } from "./metrics.js";
import type { NowInput } from "./metrics.js";
import type { BadgeStatus, NightlyScores, StatusPageData, TargetKind } from "./types.js";

export const TRUST_SCHEMA = "agentwares.trust/v1" as const;

export interface TrustNightly {
  ran_at: string;
  /** percent 0–100 */
  replay_pass_rate: number | null;
  /** percent 0–100 */
  adversarial_pass_rate: number | null;
  /** 0–1, higher = more drift */
  drift_score: number | null;
  model_versions: Record<string, string>;
}

export interface TrustJson {
  schema: typeof TRUST_SCHEMA;
  target: { owner: string; slug: string; name: string; kind: TargetKind };
  status: BadgeStatus;
  uptime_24h: number | null;
  uptime_7d: number | null;
  uptime_30d: number | null;
  last_check_at: string | null;
  last_nightly: TrustNightly | null;
  /** percent 0–100 from the most recent nightly that reported one */
  adversarial_pass_rate: number | null;
  /** distinct model/version strings seen across nightly runs, newest first */
  models_seen: string[];
  incidents_open: number;
  updated_at: string;
  badge_url: string;
  status_url: string;
}

export interface BuildTrustOptions {
  /** defaults to `data.generatedAt` */
  now?: NowInput;
}

/** Most recent nightly run, or null. */
export function latestNightly(nightly: readonly NightlyScores[] | undefined): NightlyScores | null {
  if (!nightly || nightly.length === 0) return null;
  let best: NightlyScores | null = null;
  let bestT = -Infinity;
  for (const n of nightly) {
    const t = toMs(n.ranAt);
    if (Number.isFinite(t) && t > bestT) {
      best = n;
      bestT = t;
    }
  }
  return best ?? nightly[0] ?? null;
}

/** Distinct model version strings across nightly runs, newest run first. */
export function modelsSeen(nightly: readonly NightlyScores[] | undefined): string[] {
  if (!nightly) return [];
  const sorted = [...nightly].sort((a, b) => toMs(b.ranAt) - toMs(a.ranAt));
  const seen = new Set<string>();
  for (const n of sorted) {
    for (const v of Object.values(n.modelVersions ?? {})) {
      if (v) seen.add(v);
    }
  }
  return [...seen];
}

function numberOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Build the trust.json document for a target. */
export function buildTrustJson(data: StatusPageData, opts: BuildTrustOptions = {}): TrustJson {
  const now = resolveNow(opts.now ?? data.generatedAt);
  const status = latestStatus(data.checks, now);
  const up = uptimeSummary(data.checks, now);
  const last = lastCheckAt(data.checks);
  const nightly = latestNightly(data.nightly);
  const adversarial = [...(data.nightly ?? [])]
    .sort((a, b) => toMs(b.ranAt) - toMs(a.ranAt))
    .map((n) => numberOrNull(n.adversarialPassRate))
    .find((v) => v !== null);
  return {
    schema: TRUST_SCHEMA,
    target: { owner: data.owner, slug: data.slug, name: data.name, kind: data.kind },
    status,
    uptime_24h: up.uptime24h,
    uptime_7d: up.uptime7d,
    uptime_30d: up.uptime30d,
    last_check_at: last === null ? null : toIso(last),
    last_nightly: nightly
      ? {
          ran_at: toIso(nightly.ranAt),
          replay_pass_rate: numberOrNull(nightly.replayPassRate),
          adversarial_pass_rate: numberOrNull(nightly.adversarialPassRate),
          drift_score: numberOrNull(nightly.driftScore),
          model_versions: { ...(nightly.modelVersions ?? {}) },
        }
      : null,
    adversarial_pass_rate: adversarial ?? null,
    models_seen: modelsSeen(data.nightly),
    incidents_open: data.incidents.filter((i) => i.closedAt === null || i.closedAt === undefined)
      .length,
    updated_at: toIso(now),
    badge_url: data.badgeUrl,
    status_url: data.publicUrl,
  };
}

/** Headers for serving trust.json: JSON, cached 5 minutes, readable cross-origin. */
export function trustHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=300",
    "Access-Control-Allow-Origin": "*",
  };
}

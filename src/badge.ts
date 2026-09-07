import { renderBadge, type BadgeStyle } from "@agentwares/badge";
import type { Score } from "./types.js";

/** Hosted, stateless badge endpoint (readiness-scorer app). Query: score, grade. */
export const DEFAULT_BADGE_URL_BASE = "https://agentwares-readiness.vercel.app";
export const BADGE_LABEL = "agent-ready";

/** ASCII only so the built-in text-width table stays exact. */
export function badgeMessage(score: Pick<Score, "value" | "grade">): string {
  return `${score.value}/100 ${score.grade}`;
}

export interface ReadinessBadgeOptions {
  label?: string;
  style?: BadgeStyle;
}

/** SVG badge for a score, rendered locally with @agentwares/badge (no network). */
export function renderReadinessBadge(score: Score, opts: ReadinessBadgeOptions = {}): string {
  return renderBadge({
    label: opts.label ?? BADGE_LABEL,
    message: badgeMessage(score),
    status: score.status,
    style: opts.style,
  });
}

/** URL of the same badge served by the hosted endpoint (for README / PR comments). */
export function badgeUrl(
  score: Pick<Score, "value" | "grade">,
  base: string = DEFAULT_BADGE_URL_BASE,
): string {
  const root = base.replace(/\/+$/, "");
  return `${root}/badge/agents-md.svg?score=${encodeURIComponent(String(score.value))}&grade=${encodeURIComponent(score.grade)}`;
}

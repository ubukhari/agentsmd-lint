/** Deterministic, locale-free formatting helpers (no Intl, no DOM). */
import type { BadgeStatus, TargetKind } from "./types.js";

const EM_DASH = "—";

function trimZeros(fixed: string): string {
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** 95.83 → "95.83%", 100 → "100%", null → "—". */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${trimZeros(value.toFixed(digits))}%`;
}

/** 342 → "342 ms", 1234 → "1.23 s", null → "—". */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EM_DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${trimZeros((ms / 1000).toFixed(2))} s`;
}

/** 0.1134 → "0.11", null → "—". */
export function formatScore(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return value.toFixed(digits);
}

/** epoch ms → "2026-09-01 12:00 UTC". */
export function formatDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EM_DASH;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** epoch ms → "2026-09-01". */
export function formatDate(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EM_DASH;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Human duration: "45 s", "15 min", "2 h 05 min", "3 d 4 h". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EM_DASH;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, "0")} min`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

/** "just now", "3 min ago", "2 h ago", "5 d ago", "in 3 min". */
export function formatRelative(ms: number | null | undefined, now: number): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EM_DASH;
  const diff = now - ms;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  let text: string;
  if (abs < 3_600_000) text = `${Math.round(abs / 60_000)} min`;
  else if (abs < 86_400_000) text = `${Math.round(abs / 3_600_000)} h`;
  else text = `${Math.round(abs / 86_400_000)} d`;
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** 300 → "5 min", 3600 → "1 h", 86400 → "1 d", 90 → "90 s". */
export function formatInterval(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return EM_DASH;
  if (sec % 86_400 === 0) return `${sec / 86_400} d`;
  if (sec % 3_600 === 0) return `${sec / 3_600} h`;
  if (sec % 60 === 0) return `${sec / 60} min`;
  return `${sec} s`;
}

export function kindLabel(kind: TargetKind): string {
  switch (kind) {
    case "http":
      return "HTTP endpoint";
    case "mcp":
      return "MCP server";
    case "a2a":
      return "A2A agent";
    case "voice":
      return "Voice agent";
    default:
      return String(kind);
  }
}

export function statusLabel(status: BadgeStatus): string {
  switch (status) {
    case "passing":
      return "Passing";
    case "failing":
      return "Failing";
    case "degraded":
      return "Degraded";
    case "unknown":
      return "Unknown";
    case "no-data":
      return "No data";
    default:
      return String(status);
  }
}

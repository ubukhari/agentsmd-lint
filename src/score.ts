import type { Finding, Grade, RuleId, Score, ScoreBreakdownItem } from "./types.js";

/** Points deducted per finding and the cap per rule. Sum of caps > 100 so a bad file can reach 0. */
export const RULE_WEIGHTS: Readonly<Record<RuleId, { each: number; cap: number }>> = {
  "no-instruction-file": { each: 100, cap: 100 },
  "stale-command": { each: 10, cap: 40 },
  "unknown-workspace-package": { each: 5, cap: 10 },
  "dead-path": { each: 5, cap: 30 },
  contradiction: { each: 15, cap: 30 },
  "lockfile-mismatch": { each: 5, cap: 5 },
  "missing-test-instructions": { each: 15, cap: 15 },
  "missing-dev-env-instructions": { each: 10, cap: 10 },
};

export function gradeFor(value: number): Grade {
  if (value >= 90) return "A";
  if (value >= 75) return "B";
  if (value >= 60) return "C";
  if (value >= 40) return "D";
  return "F";
}

export function statusFor(value: number): Score["status"] {
  if (value >= 90) return "passing";
  if (value >= 60) return "degraded";
  return "failing";
}

/** 100 minus capped deductions, floored at 0. Info findings never deduct. */
export function scoreFindings(findings: readonly Finding[]): Score {
  const counts = new Map<RuleId, number>();
  for (const f of findings) {
    if (f.severity === "info") continue;
    counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  }
  const breakdown: ScoreBreakdownItem[] = [];
  let total = 0;
  for (const [rule, count] of counts) {
    const w = RULE_WEIGHTS[rule];
    const deduction = Math.min(w.cap, w.each * count);
    total += deduction;
    breakdown.push({ rule, count, deduction });
  }
  breakdown.sort((a, b) => b.deduction - a.deduction || a.rule.localeCompare(b.rule));
  const value = Math.max(0, 100 - total);
  return { value, grade: gradeFor(value), status: statusFor(value), breakdown };
}

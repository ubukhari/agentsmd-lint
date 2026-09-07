/**
 * agentsmd-lint — public types. Everything is plain data so the same report
 * can be printed, posted as a PR comment or rendered as a badge.
 */

export type Severity = "error" | "warning" | "info";

export type RuleId =
  | "no-instruction-file"
  | "stale-command"
  | "unknown-workspace-package"
  | "dead-path"
  | "contradiction"
  | "lockfile-mismatch"
  | "missing-test-instructions"
  | "missing-dev-env-instructions";

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** instruction file the finding refers to (repo-relative, posix) */
  file: string;
  /** 1-based line in `file`, when known */
  line?: number;
  message: string;
  /** how to fix it, written for whoever maintains the instruction file */
  fix: string;
  /** the offending token (command, path, statement) */
  subject?: string;
}

export interface ScoreBreakdownItem {
  rule: RuleId;
  count: number;
  /** points deducted for this rule (after the per-rule cap) */
  deduction: number;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface Score {
  /** 0–100 */
  value: number;
  grade: Grade;
  /** badge status: passing (≥ 90), degraded (≥ 60), failing */
  status: "passing" | "degraded" | "failing";
  breakdown: ScoreBreakdownItem[];
}

export interface Report {
  /** repo root as given (absolute for the CLI, "<memory>" for readers without a path) */
  root: string;
  /** instruction files that were found and linted (repo-relative) */
  files: string[];
  findings: Finding[];
  score: Score;
  /** counts by severity */
  summary: { errors: number; warnings: number; infos: number };
  /** ISO timestamp of the run */
  generatedAt: string;
  version: string;
}

/**
 * Abstract, read-only view of a repository so the same rules run against the
 * local file system (CLI), an in-memory map (tests) and the GitHub contents
 * API (the GitHub App).
 */
export interface RepoReader {
  /** true when a file OR directory exists at `path` (repo-relative, posix) */
  exists(path: string): Promise<boolean>;
  /** file contents, or null when the path is missing or not a file */
  readText(path: string): Promise<string | null>;
  /** every file path in the repo (repo-relative, posix), minus ignored dirs; may be capped */
  listFiles(): Promise<string[]>;
}

export interface LintOptions {
  /** extra instruction files to lint, repo-relative (in addition to the defaults) */
  files?: string[];
  /** skip specific rules */
  disable?: RuleId[];
}

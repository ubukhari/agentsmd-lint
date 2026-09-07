import { fsReader, normalizePath } from "./reader.js";
import { collectRepoFacts } from "./repo.js";
import { ALL_RULES, type InstructionFile } from "./rules.js";
import { scoreFindings } from "./score.js";
import type { Finding, LintOptions, RepoReader, Report } from "./types.js";

export const VERSION = "0.1.1";

/** Instruction files looked for at the repo root (first found = "primary"). */
export const DEFAULT_INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  "GEMINI.md",
  ".windsurfrules",
  ".clinerules",
  ".claude/CLAUDE.md",
] as const;

/** Cap on `.cursor/rules/*.mdc` files linted (they are usually many and small). */
const MAX_RULE_FILES = 20;

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

export async function findInstructionFiles(
  reader: RepoReader,
  extra: readonly string[] = [],
): Promise<InstructionFile[]> {
  const candidates = new Set<string>([...DEFAULT_INSTRUCTION_FILES, ...extra.map(normalizePath)]);
  const listed = await reader.listFiles();
  let rules = 0;
  for (const f of listed) {
    if (f.startsWith(".cursor/rules/") && f.endsWith(".mdc") && rules < MAX_RULE_FILES) {
      candidates.add(f);
      rules += 1;
    }
  }
  const files: InstructionFile[] = [];
  for (const path of candidates) {
    const text = await reader.readText(path);
    if (text !== null && text.trim().length > 0) files.push({ path, text });
  }
  return files;
}

/** Lint any `RepoReader`. Pure: same input → same report (except `generatedAt`). */
export async function lint(
  reader: RepoReader,
  options: LintOptions & { root?: string; now?: () => Date } = {},
): Promise<Report> {
  const files = await findInstructionFiles(reader, options.files ?? []);
  const facts = await collectRepoFacts(reader);
  const disabled = new Set(options.disable ?? []);
  const ctx = { reader, facts, files };
  const findings: Finding[] = [];
  for (const rule of ALL_RULES) {
    for (const f of await rule(ctx)) if (!disabled.has(f.rule)) findings.push(f);
  }
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.rule.localeCompare(b.rule),
  );
  const score = scoreFindings(findings);
  return {
    root: options.root ?? "<memory>",
    files: files.map((f) => f.path),
    findings,
    score,
    summary: {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      infos: findings.filter((f) => f.severity === "info").length,
    },
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    version: VERSION,
  };
}

/** Lint a directory on disk (what the CLI does). */
export function lintDir(root: string, options: LintOptions = {}): Promise<Report> {
  return lint(fsReader(root), { ...options, root });
}

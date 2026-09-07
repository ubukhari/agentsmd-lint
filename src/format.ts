import { badgeUrl } from "./badge.js";
import type { Finding, Report } from "./types.js";

/** Marker the GitHub App / Action uses to find and update its own PR comment. */
export const COMMENT_MARKER = "<!-- agentsmd-lint -->";

/** The one funnel line every output ends with (plans/40 "Rules for all assets"). */
export const FOOTER_LINE =
  "agentsmd-lint is free and offline. Next step: a live status badge for your agent or MCP server — https://agentwares-agentcheck.vercel.app";

export type Format = "text" | "json" | "markdown" | "github";

function loc(f: Finding): string {
  return f.line ? `${f.file}:${f.line}` : f.file;
}

export function formatText(report: Report): string {
  const lines: string[] = [];
  const { summary, score } = report;
  lines.push(
    `agentsmd-lint v${report.version} — ${report.files.length ? report.files.join(", ") : "no instruction files"}`,
  );
  lines.push(
    `score ${score.value}/100 (${score.grade}) — ${summary.errors} error${summary.errors === 1 ? "" : "s"}, ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}`,
  );
  lines.push("");
  for (const f of report.findings) {
    lines.push(`${loc(f).padEnd(28)} ${f.severity.padEnd(7)} ${f.rule.padEnd(28)} ${f.message}`);
    lines.push(`${"".padEnd(28)} ${"".padEnd(7)} ${"fix:".padEnd(28)} ${f.fix}`);
  }
  if (report.findings.length === 0) lines.push("No findings.");
  if (score.breakdown.length) {
    lines.push("");
    lines.push("deductions:");
    for (const b of score.breakdown) {
      lines.push(`  -${String(b.deduction).padStart(3)}  ${b.rule} (${b.count})`);
    }
  }
  return lines.join("\n");
}

export function formatJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

export interface MarkdownOptions {
  /** absolute badge URL; defaults to the hosted stateless badge */
  badgeUrl?: string;
  /** omit the trailing funnel line */
  noFooter?: boolean;
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** PR-comment flavoured markdown (starts with COMMENT_MARKER so it can be updated in place). */
export function formatMarkdown(report: Report, opts: MarkdownOptions = {}): string {
  const { score, summary } = report;
  const badge = opts.badgeUrl ?? badgeUrl(score);
  const lines: string[] = [COMMENT_MARKER];
  lines.push(`### Agent readiness: ${score.value}/100 (${score.grade}) ![agent-ready](${badge})`);
  lines.push("");
  lines.push(
    `${report.files.length ? report.files.map((f) => `\`${f}\``).join(", ") : "No instruction file found"} — ${summary.errors} error${summary.errors === 1 ? "" : "s"}, ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}.`,
  );
  lines.push("");
  if (report.findings.length) {
    lines.push("| | Where | Rule | Problem | Fix |");
    lines.push("|---|---|---|---|---|");
    for (const f of report.findings) {
      const icon = f.severity === "error" ? "❌" : f.severity === "warning" ? "⚠️" : "ℹ️";
      lines.push(
        `| ${icon} | \`${mdEscape(loc(f))}\` | \`${f.rule}\` | ${mdEscape(f.message)} | ${mdEscape(f.fix)} |`,
      );
    }
  } else {
    lines.push("No findings — the instructions match the repo.");
  }
  if (!opts.noFooter) {
    lines.push("");
    lines.push(`<sub>${FOOTER_LINE}</sub>`);
  }
  return lines.join("\n");
}

/** GitHub Actions workflow annotations, one per finding. */
export function formatGithub(report: Report): string {
  const lines = report.findings.map((f) => {
    const level =
      f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "notice";
    const props = [`file=${f.file}`, f.line ? `line=${f.line}` : null, `title=${f.rule}`]
      .filter(Boolean)
      .join(",");
    const msg = `${f.message}. Fix: ${f.fix}`
      .replace(/%/g, "%25")
      .replace(/\r/g, "%0D")
      .replace(/\n/g, "%0A");
    return `::${level} ${props}::${msg}`;
  });
  lines.push(
    `::notice title=agentsmd-lint::score ${report.score.value}/100 (${report.score.grade})`,
  );
  return lines.join("\n");
}

export function formatReport(report: Report, format: Format, opts: MarkdownOptions = {}): string {
  switch (format) {
    case "json":
      return formatJson(report);
    case "markdown":
      return formatMarkdown(report, opts);
    case "github":
      return formatGithub(report);
    default:
      return formatText(report);
  }
}

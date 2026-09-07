import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { renderReadinessBadge } from "./badge.js";
import { formatReport, type Format } from "./format.js";
import { VERSION, lintDir } from "./lint.js";
import type { RuleId } from "./types.js";

const USAGE = `agentsmd-lint v${VERSION} — lint AGENTS.md / CLAUDE.md / .cursorrules against the repo

Usage: agentsmd-lint [dir] [options]

  dir                       repository root (default: .)
  --format <fmt>            text | json | markdown | github   (default: text)
  --badge <file.svg>        write the agent-readiness badge SVG
  --badge-url-base <url>    base URL for the hosted badge in markdown output
  --min-score <n>           exit 1 when the score is below n (default: 0)
  --no-fail                 exit 0 even when there are errors
  --disable <rule,rule>     skip rules (stale-command, dead-path, contradiction, lockfile-mismatch,
                            unknown-workspace-package, missing-test-instructions,
                            missing-dev-env-instructions, no-instruction-file)
  --file <path>             extra instruction file to lint (repeatable)
  --star                    print the "star us" link at the end (opt-in, no network)
  -h, --help                this help
  -v, --version             print the version

Exit codes: 0 clean (or --no-fail), 1 errors / below --min-score, 2 usage error.
No telemetry, no network, no account.`;

interface Args {
  dir: string;
  format: Format;
  badge?: string;
  badgeUrlBase?: string;
  minScore: number;
  noFail: boolean;
  disable: RuleId[];
  files: string[];
  star: boolean;
}

export function parseArgs(argv: string[]): Args | { exit: number; out: string } {
  const args: Args = {
    dir: ".",
    format: "text",
    minScore: 0,
    noFail: false,
    disable: [],
    files: [],
    star: false,
  };
  const need = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  try {
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i] ?? "";
      switch (a) {
        case "-h":
        case "--help":
          return { exit: 0, out: USAGE };
        case "-v":
        case "--version":
          return { exit: 0, out: VERSION };
        case "--format": {
          const f = need(i, a);
          if (!["text", "json", "markdown", "github"].includes(f))
            throw new Error(`unknown format ${f}`);
          args.format = f as Format;
          i += 1;
          break;
        }
        case "--badge":
          args.badge = need(i, a);
          i += 1;
          break;
        case "--badge-url-base":
          args.badgeUrlBase = need(i, a);
          i += 1;
          break;
        case "--min-score": {
          const n = Number(need(i, a));
          if (!Number.isFinite(n) || n < 0 || n > 100)
            throw new Error("--min-score must be 0..100");
          args.minScore = n;
          i += 1;
          break;
        }
        case "--no-fail":
          args.noFail = true;
          break;
        case "--disable":
          args.disable.push(
            ...(need(i, a)
              .split(",")
              .map((s) => s.trim()) as RuleId[]),
          );
          i += 1;
          break;
        case "--file":
          args.files.push(need(i, a));
          i += 1;
          break;
        case "--star":
          args.star = true;
          break;
        default:
          if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
          args.dir = a;
      }
    }
  } catch (err) {
    return { exit: 2, out: `${(err as Error).message}\n\n${USAGE}` };
  }
  return args;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if ("exit" in parsed) {
    (parsed.exit === 0 ? process.stdout : process.stderr).write(`${parsed.out}\n`);
    return parsed.exit;
  }
  const root = resolve(parsed.dir);
  const report = await lintDir(root, { disable: parsed.disable, files: parsed.files });
  const out = formatReport(report, parsed.format, {
    badgeUrl: parsed.badgeUrlBase
      ? `${parsed.badgeUrlBase.replace(/\/+$/, "")}/badge/agents-md.svg?score=${report.score.value}&grade=${report.score.grade}`
      : undefined,
  });
  process.stdout.write(`${out}\n`);
  if (parsed.badge) {
    const target = resolve(parsed.badge);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, renderReadinessBadge(report.score), "utf8");
    if (parsed.format === "text") process.stdout.write(`badge written to ${target}\n`);
  }
  if (parsed.star && parsed.format === "text") {
    process.stdout.write(
      "\nUseful? Star the repo: https://github.com/agentwares/agentsmd-lint (nothing was sent anywhere).\n",
    );
  }
  if (report.score.value < parsed.minScore) return 1;
  if (!parsed.noFail && report.summary.errors > 0) return 1;
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`agentsmd-lint: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  },
);

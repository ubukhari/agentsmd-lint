import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { badgeUrl, renderReadinessBadge } from "./badge.js";
import { COMMENT_MARKER, formatGithub, formatMarkdown, formatText } from "./format.js";
import { VERSION, lint, lintDir } from "./lint.js";
import { memoryReader } from "./reader.js";
import { scoreFindings } from "./score.js";
import type { Finding } from "./types.js";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const NOW = () => new Date("2026-09-02T00:00:00Z");

describe("seeded fixture", () => {
  it("flags every seeded problem and nothing else", async () => {
    const report = await lintDir(`${fixtures}seeded`);
    const byRule = (rule: string) => report.findings.filter((f) => f.rule === rule);
    const subjects = (rule: string) => byRule(rule).map((f) => f.subject);

    expect(report.files).toEqual(["AGENTS.md", "CLAUDE.md", ".cursorrules"]);

    expect(subjects("stale-command").sort()).toEqual(
      ["pnpm lint:fix", "npm run typecheck", "make deploy"].sort(),
    );
    expect(subjects("unknown-workspace-package")).toEqual(["@seeded/api"]);
    expect(subjects("dead-path").sort()).toEqual([
      "docs/setup.md",
      "src/components/",
      "src/server/index.ts",
    ]);
    expect(report.findings.some((f) => f.subject === "/api/health")).toBe(false);
    expect(report.findings.some((f) => f.subject === "path/to/your/file.ts")).toBe(false);

    const contradictions = byRule("contradiction");
    // package manager: CLAUDE.md uses npm, .cursorrules uses yarn, lockfile + AGENTS.md say pnpm
    expect(contradictions.filter((f) => f.subject === "npm").map((f) => f.file)).toEqual([
      "CLAUDE.md",
    ]);
    expect(contradictions.filter((f) => f.subject === "yarn").map((f) => f.file)).toEqual([
      ".cursorrules",
    ]);
    // test runner: jest (CLAUDE.md) vs vitest (AGENTS.md)
    expect(contradictions.filter((f) => f.subject === "jest").map((f) => f.file)).toEqual([
      "CLAUDE.md",
    ]);
    // node: 18 (CLAUDE.md) vs engines 22
    expect(contradictions.filter((f) => f.subject?.includes("18")).map((f) => f.file)).toEqual([
      "CLAUDE.md",
    ]);
    expect(contradictions).toHaveLength(4);

    expect(byRule("missing-test-instructions")).toEqual([]);
    expect(byRule("missing-dev-env-instructions")).toEqual([]);
    expect(byRule("lockfile-mismatch")).toEqual([]);

    // 3 stale (30) + 3 dead (15) + 4 contradictions (cap 30) + 1 unknown pkg (5) = 80 → 20
    expect(report.score).toMatchObject({ value: 20, grade: "F", status: "failing" });
    expect(report.summary).toEqual({ errors: 10, warnings: 1, infos: 0 });
    for (const f of report.findings) {
      expect(f.line, `${f.rule} ${f.subject} should carry a line`).toBeGreaterThan(0);
      expect(f.fix.length).toBeGreaterThan(10);
    }
  });
});

describe("clean fixture", () => {
  it("scores 100", async () => {
    const report = await lintDir(`${fixtures}clean`);
    expect(report.findings).toEqual([]);
    expect(report.score).toMatchObject({ value: 100, grade: "A", status: "passing" });
  });
});

describe("memory repos", () => {
  it("reports a missing instruction file", async () => {
    const report = await lint(memoryReader({ "package.json": "{}" }), { now: NOW });
    expect(report.findings.map((f) => f.rule)).toEqual(["no-instruction-file"]);
    expect(report.score.value).toBe(0);
  });

  it("reports missing test / dev-env instructions", async () => {
    const report = await lint(
      memoryReader({
        "AGENTS.md": "# Rules\n\nWrite good code. Files live in `src/`.\n",
        "src/a.ts": "",
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      }),
      { now: NOW },
    );
    expect(report.findings.map((f) => f.rule).sort()).toEqual([
      "missing-dev-env-instructions",
      "missing-test-instructions",
    ]);
    expect(report.score.value).toBe(75);
  });

  it("flags a lockfile mismatch when all files agree on the wrong manager", async () => {
    const report = await lint(
      memoryReader({
        "AGENTS.md": "Install with `npm install`, test with `npm test`.\n",
        "pnpm-lock.yaml": "",
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      }),
      { now: NOW },
    );
    expect(report.findings.map((f) => f.rule)).toEqual(["lockfile-mismatch"]);
    expect(report.score.value).toBe(95);
  });

  it("checks turbo tasks, just recipes, .cursor/rules and nested paths", async () => {
    const report = await lint(
      memoryReader({
        "AGENTS.md":
          "`pnpm install` then `pnpm test`. Run `turbo build`, `turbo deploy`, `just fmt`, `just nope`.\n",
        ".cursor/rules/a.mdc": "See `../../src/a.ts` and `lib/missing.ts`.",
        "turbo.json": JSON.stringify({ tasks: { build: {} } }),
        justfile: "fmt:\n  prettier -w .\n",
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
        "src/a.ts": "",
      }),
      { now: NOW },
    );
    expect(report.files).toEqual(["AGENTS.md", ".cursor/rules/a.mdc"]);
    expect(report.findings.map((f) => `${f.rule}:${f.subject}`).sort()).toEqual([
      "dead-path:lib/missing.ts",
      "stale-command:just nope",
      "stale-command:turbo deploy",
    ]);
  });

  it("treats a bare filename as prose unless the repo really has one somewhere", async () => {
    const report = await lint(
      memoryReader({
        "AGENTS.md":
          "`pnpm install`, `pnpm test`. Every service ships an `llms.txt`. Config lives in `settings.json`. Briefs are in `briefs/`.\n",
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
        "apps/web/settings.json": "{}",
        "src/app/llms.txt/route.ts": "",
        "docs/briefs/a.md": "",
      }),
      { now: NOW },
    );
    // `llms.txt` names a route *directory*, so it is still a concept and not a
    // stale file path. `settings.json` and `briefs/` really exist elsewhere.
    expect(report.findings.map((f) => `${f.rule}:${f.subject}`)).toEqual([
      "dead-path:settings.json",
      "dead-path:briefs/",
    ]);
    expect(report.findings[0]?.fix).toContain("apps/web/settings.json");
    expect(report.findings[1]?.fix).toContain("docs/briefs");
  });

  it("honours --disable", async () => {
    const report = await lint(memoryReader({ "AGENTS.md": "hi `nope/x.ts`" }), {
      disable: ["dead-path", "missing-test-instructions", "missing-dev-env-instructions"],
      now: NOW,
    });
    expect(report.findings).toEqual([]);
  });

  it("is deterministic", async () => {
    const files = { "AGENTS.md": "`pnpm install`, `pnpm test`, `x/y.ts`", "package.json": "{}" };
    const a = await lint(memoryReader(files), { now: NOW });
    const b = await lint(memoryReader(files), { now: NOW });
    expect(a).toEqual(b);
  });
});

describe("score", () => {
  it("caps per rule and floors at 0", () => {
    const stale = (n: number): Finding[] =>
      Array.from({ length: n }, (_, i) => ({
        rule: "stale-command",
        severity: "error",
        file: "AGENTS.md",
        message: `m${i}`,
        fix: "f",
      }));
    expect(scoreFindings(stale(2)).value).toBe(80);
    expect(scoreFindings(stale(10)).value).toBe(60);
    expect(
      scoreFindings([
        ...stale(10),
        { rule: "no-instruction-file", severity: "error", file: "AGENTS.md", message: "", fix: "" },
      ]).value,
    ).toBe(0);
    expect(
      scoreFindings([{ rule: "dead-path", severity: "info", file: "a", message: "", fix: "" }])
        .value,
    ).toBe(100);
  });
});

describe("formats + badge", () => {
  it("renders text, markdown (with marker + one footer link), github annotations and an SVG badge", async () => {
    const report = await lintDir(`${fixtures}seeded`);
    const text = formatText(report);
    expect(text).toContain("score 20/100 (F)");
    expect(text).toContain("CLAUDE.md:");

    const md = formatMarkdown(report);
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain("### Agent readiness: 20/100 (F)");
    expect(md).toContain(badgeUrl(report.score));
    expect(md.match(/https:\/\/agentwares-agentcheck\.vercel\.app/g)).toHaveLength(1);

    const gh = formatGithub(report);
    expect(gh).toMatch(/^::error file=AGENTS\.md|^::error file=CLAUDE\.md/m);
    expect(gh).toContain("::notice title=agentsmd-lint::score 20/100 (F)");

    const svg = renderReadinessBadge(report.score);
    expect(svg).toContain("<svg");
    expect(svg).toContain("agent-ready: 20/100 F");
    expect(svg).toContain("#e05d44");
  });

  it("keeps VERSION in sync with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});

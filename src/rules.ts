/**
 * The rules. Each takes the instruction files plus repo facts and returns
 * findings. No rule touches the network or an LLM.
 */
import {
  extractCodeSpans,
  extractCommands,
  extractNodeVersions,
  extractPaths,
  extractToolMentions,
  type CommandRef,
  type Manager,
} from "./parse.js";
import { normalizePath } from "./reader.js";
import type { PackageInfo, RepoFacts } from "./repo.js";
import type { Finding, RepoReader } from "./types.js";

export interface InstructionFile {
  /** repo-relative path */
  path: string;
  text: string;
}

export interface RuleContext {
  reader: RepoReader;
  facts: RepoFacts;
  files: InstructionFile[];
}

/** Bins commonly invoked as `pnpm <bin>` / `yarn <bin>` that are not scripts. */
const KNOWN_BINS = new Set([
  "turbo",
  "vitest",
  "jest",
  "mocha",
  "prettier",
  "eslint",
  "biome",
  "tsc",
  "tsx",
  "ts-node",
  "next",
  "vite",
  "nuxt",
  "astro",
  "remix",
  "expo",
  "playwright",
  "cypress",
  "storybook",
  "drizzle-kit",
  "prisma",
  "wrangler",
  "vercel",
  "netlify",
  "nodemon",
  "husky",
  "lint-staged",
  "changeset",
  "lerna",
  "nx",
  "rollup",
  "webpack",
  "esbuild",
  "tsup",
  "swc",
  "babel",
  "knip",
  "madge",
  "dotenv",
  "concurrently",
  "cross-env",
  "rimraf",
  "tailwindcss",
  "postcss",
  "sst",
  "serverless",
  "cdk",
  "graphql-codegen",
  "openapi-typescript",
  "supabase",
  "firebase",
  "gh",
  "docker",
  "node",
  "npx",
  "pnpx",
  "sh",
  "bash",
]);

const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const JS_TEST_RUNNERS = ["vitest", "jest", "mocha", "ava"] as const;
const PY_TEST_RUNNERS = ["pytest", "unittest", "nose2"] as const;

const TEST_COMMAND =
  /(^|\s|\/)(vitest|jest|mocha|ava|pytest|rspec|phpunit|cypress|playwright\s+test|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradlew?\s+test|deno\s+test|bun\s+test|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+(run\s+)?test|make\s+test|just\s+test|test:[a-z]+|python\s+-m\s+(pytest|unittest)|npx\s+(vitest|jest|mocha))(\s|$|:)/;
const DEV_ENV_COMMAND =
  /(^|\s)(npm\s+(install|ci|i)|pnpm\s+(install|i)|yarn(\s+install)?$|yarn\s+install|bun\s+install|pip\s+install|uv\s+(sync|pip|venv)|poetry\s+install|pipenv\s+install|bundle\s+install|composer\s+install|go\s+mod\s+(download|tidy)|cargo\s+(build|run)|make\s+(setup|install|dev|bootstrap|init)|docker\s+compose\s+up|docker-compose\s+up|nvm\s+(use|install)|npm\s+run\s+dev|npm\s+start|pnpm\s+(run\s+)?dev|pnpm\s+start|yarn\s+(run\s+)?dev|yarn\s+start|bun\s+(run\s+)?dev|cp\s+\.env|\.env(\.local)?\.example|devenv|direnv|mise\s+install|asdf\s+install|conda\s+(create|env))(\s|$)/;
const PLACEHOLDER_PATH = /^(path|your|my|some|foo|bar|example|placeholder)\//i;

function scriptExistsIn(pkgs: readonly PackageInfo[], script: string): boolean {
  return pkgs.some((p) => p.scripts.has(script));
}

function resolveFilter(facts: RepoFacts, filter: string): PackageInfo | "many" | null {
  if (/[*.{}[\]!]|\.\.\./.test(filter)) return "many";
  const f = normalizePath(filter.replace(/^\.\//, ""));
  const all = facts.rootPackage
    ? [facts.rootPackage, ...facts.workspacePackages]
    : facts.workspacePackages;
  return all.find((p) => p.name === f || p.dir === f || p.dir.endsWith(`/${f}`)) ?? null;
}

function packageManagerOf(ref: CommandRef): PackageManager | null {
  return ref.manager === "npm" ||
    ref.manager === "pnpm" ||
    ref.manager === "yarn" ||
    ref.manager === "bun"
    ? ref.manager
    : null;
}

/** `stale-command` + `unknown-workspace-package`. */
export async function checkStaleCommands(ctx: RuleContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { facts } = ctx;
  const allPkgs = facts.rootPackage
    ? [facts.rootPackage, ...facts.workspacePackages]
    : facts.workspacePackages;

  for (const file of ctx.files) {
    const seen = new Set<string>();
    for (const ref of extractCommands(file.text)) {
      if (ref.negated) continue;
      const key = `${ref.manager}:${ref.filter ?? ""}:${ref.script}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const pm = packageManagerOf(ref);
      if (pm) {
        if (!facts.rootPackage && facts.workspacePackages.length === 0) continue; // nothing to check against
        if (KNOWN_BINS.has(ref.script) || facts.rootDependencies.has(ref.script)) continue;
        if (ref.script.includes("/") || ref.script.startsWith("@")) continue; // file or package arg
        let scope: readonly PackageInfo[] = facts.rootPackage ? [facts.rootPackage] : allPkgs;
        let where = "package.json";
        if (ref.filter) {
          const target = resolveFilter(facts, ref.filter);
          if (target === null) {
            findings.push({
              rule: "unknown-workspace-package",
              severity: "warning",
              file: file.path,
              line: ref.line,
              subject: ref.filter,
              message: `\`${ref.raw}\` targets workspace package "${ref.filter}", which does not exist`,
              fix: `Use one of: ${
                facts.workspacePackages
                  .map((p) => p.name ?? p.dir)
                  .slice(0, 8)
                  .join(", ") || "(no workspace packages found)"
              }.`,
            });
            continue;
          }
          if (target === "many") {
            scope = allPkgs;
            where = "any workspace package.json";
          } else {
            scope = [target];
            where = target.path;
          }
        } else if (ref.anyWorkspace) {
          scope = allPkgs;
          where = "any workspace package.json";
        }
        if (scriptExistsIn(scope, ref.script)) continue;
        if (ref.script === "start" && (await ctx.reader.exists("server.js"))) continue;
        if (ref.script === "test" && !facts.rootPackage) continue;
        findings.push({
          rule: "stale-command",
          severity: "error",
          file: file.path,
          line: ref.line,
          subject: ref.raw,
          message: `\`${ref.raw}\` runs script "${ref.script}", which is not defined in ${where}`,
          fix: `Add a "${ref.script}" script to ${where} or change the instruction to an existing script (${
            [...(scope[0]?.scripts ?? [])].slice(0, 6).join(", ") || "none defined"
          }).`,
        });
        continue;
      }

      if (ref.manager === "make") {
        if (facts.makeTargets === null) {
          findings.push({
            rule: "stale-command",
            severity: "error",
            file: file.path,
            line: ref.line,
            subject: ref.raw,
            message: `\`${ref.raw}\` needs a Makefile, but the repo has none`,
            fix: "Add a Makefile with that target, or replace the instruction with the real command.",
          });
        } else if (!facts.makeTargets.has(ref.script)) {
          findings.push({
            rule: "stale-command",
            severity: "error",
            file: file.path,
            line: ref.line,
            subject: ref.raw,
            message: `\`${ref.raw}\` uses Makefile target "${ref.script}", which does not exist`,
            fix: `Existing targets: ${[...facts.makeTargets].slice(0, 8).join(", ") || "none"}.`,
          });
        }
        continue;
      }

      if (ref.manager === "turbo") {
        if (facts.turboTasks === null) {
          findings.push({
            rule: "stale-command",
            severity: "error",
            file: file.path,
            line: ref.line,
            subject: ref.raw,
            message: `\`${ref.raw}\` needs turbo.json, but the repo has none`,
            fix: "Add turbo.json with that task, or replace the instruction with the package script.",
          });
        } else if (!facts.turboTasks.has(ref.script)) {
          findings.push({
            rule: "stale-command",
            severity: "error",
            file: file.path,
            line: ref.line,
            subject: ref.raw,
            message: `\`${ref.raw}\` runs turbo task "${ref.script}", which is not in turbo.json`,
            fix: `Tasks defined: ${[...facts.turboTasks].join(", ") || "none"}.`,
          });
        }
        continue;
      }

      if (ref.manager === "just") {
        if (facts.justRecipes === null) {
          findings.push({
            rule: "stale-command",
            severity: "error",
            file: file.path,
            line: ref.line,
            subject: ref.raw,
            message: `\`${ref.raw}\` needs a justfile, but the repo has none`,
            fix: "Add a justfile with that recipe, or replace the instruction with the real command.",
          });
        } else if (!facts.justRecipes.has(ref.script)) {
          findings.push({
            rule: "stale-command",
            severity: "error",
            file: file.path,
            line: ref.line,
            subject: ref.raw,
            message: `\`${ref.raw}\` uses just recipe "${ref.script}", which does not exist`,
            fix: `Existing recipes: ${[...facts.justRecipes].slice(0, 8).join(", ") || "none"}.`,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Real paths in the repo whose last segment is `base` — files with that name, and
 * directories with that name. Used to tell a stale reference that lost its
 * directory (`settings.json` → `apps/web/settings.json`) apart from prose about a
 * concept (`llms.txt`), which is not a path at all.
 */
async function sameNameElsewhere(
  ctx: RuleContext,
  base: string,
  wantDir: boolean,
): Promise<string[]> {
  const all = await ctx.reader.listFiles();
  const hits = new Set<string>();
  for (const p of all) {
    const segs = p.split("/");
    if (!wantDir) {
      if (segs[segs.length - 1] === base) hits.add(p);
      continue;
    }
    for (let i = 0; i < segs.length - 1; i += 1) {
      if (segs[i] === base) hits.add(segs.slice(0, i + 1).join("/"));
    }
  }
  return [...hits].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/** `dead-path`: referenced files/dirs that do not exist. */
export async function checkDeadPaths(ctx: RuleContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const file of ctx.files) {
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    const seen = new Set<string>();
    for (const ref of extractPaths(file.text)) {
      if (seen.has(ref.path)) continue;
      seen.add(ref.path);
      if (PLACEHOLDER_PATH.test(ref.path)) continue;
      let probe = ref.path;
      if (ref.glob) {
        const idx = probe.search(/[*?[\]]/);
        if (!probe.slice(0, idx).includes("/")) continue; // `*.test.ts`, `.env*`: nothing to resolve
        probe = probe.slice(0, idx).replace(/\/[^/]*$/, "");
        if (!probe) continue;
      }
      const candidates = dir ? [probe, `${dir}/${probe}`] : [probe];
      let exists = false;
      for (const c of candidates) {
        if (await ctx.reader.exists(c)) {
          exists = true;
          break;
        }
      }
      if (exists) continue;
      const base = ref.path.split("/").pop() ?? "";
      if (ref.rooted && !/\.[a-z0-9]+$/i.test(base)) continue; // `/api/health` is a route, not a path

      // A bare name with no directory ("every product ships an `llms.txt`") is
      // usually a concept, not a path. A trailing slash or a missing extension means a
      // directory was meant, so `llms.txt` never matches a Next.js route folder of the
      // same name.
      //
      // How many the repo has decides which it is. Exactly one, and the reference plausibly
      // lost its directory — say so and give it. Several, and the name is a convention every
      // one of them follows; there is no single path to point at, and demanding one would
      // ask the author to pick a file at random. This repo's own CLAUDE.md says "every
      // pricing page has a machine-readable `pricing.json`", which is true of six of them.
      let elsewhere: string[] = [];
      if (!ref.path.includes("/") && !ref.glob) {
        const wantDir = ref.raw.trim().endsWith("/") || !/\.[a-z0-9]+$/i.test(base);
        elsewhere = await sameNameElsewhere(ctx, base, wantDir);
        if (elsewhere.length !== 1) continue;
      }
      findings.push({
        rule: "dead-path",
        severity: "error",
        file: file.path,
        line: ref.line,
        subject: ref.raw,
        message: `\`${ref.raw}\` does not exist in the repo`,
        fix: elsewhere.length
          ? `The repo has ${elsewhere.slice(0, 3).map((p) => `\`${p}\``).join(", ")} — use the full path, or delete the reference.` // prettier-ignore
          : "Update the path (the file was probably moved or renamed) or delete the reference.",
      });
    }
  }
  return findings;
}

/** `contradiction` (package manager, test runner, Node version) + `lockfile-mismatch`. */
export async function checkContradictions(ctx: RuleContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { facts, files } = ctx;

  // --- package managers -------------------------------------------------------
  const managersByFile = new Map<string, Map<PackageManager, number>>();
  for (const file of files) {
    const m = new Map<PackageManager, number>();
    for (const ref of extractCommands(file.text)) {
      const pm = packageManagerOf(ref);
      if (pm && !ref.negated) m.set(pm, (m.get(pm) ?? 0) + 1);
    }
    for (const hit of extractToolMentions(file.text, PACKAGE_MANAGERS)) {
      const pm = hit.tool as PackageManager;
      m.set(pm, (m.get(pm) ?? 0) + 1);
    }
    if (m.size) managersByFile.set(file.path, m);
  }
  const overall = new Map<PackageManager, number>();
  for (const m of managersByFile.values()) {
    for (const [pm, n] of m) overall.set(pm, (overall.get(pm) ?? 0) + n);
  }
  const lockManager: PackageManager | null =
    facts.lockfiles.length === 1 ? (facts.lockfiles[0] ?? null) : null;
  const dominant: PackageManager | null =
    [...overall.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const primary: PackageManager | null = lockManager ?? dominant;

  if (primary && overall.size >= 2) {
    for (const [path, m] of managersByFile) {
      for (const pm of m.keys()) {
        if (pm === primary) continue;
        const others = [...managersByFile.entries()]
          .filter(([p, mm]) => p !== path && mm.has(primary))
          .map(([p]) => p);
        findings.push({
          rule: "contradiction",
          severity: "error",
          file: path,
          line: firstLineWith(files, path, pm),
          subject: pm,
          message: `${path} uses \`${pm}\` while ${
            others.length
              ? others.join(", ")
              : lockManager
                ? `the ${lockManager} lockfile`
                : "other files"
          } use${others.length === 1 ? "s" : ""} \`${primary}\``,
          fix: `Pick one package manager (the lockfile says ${lockManager ?? "nothing"}) and use it in every instruction file.`,
        });
      }
    }
  } else if (lockManager && dominant && dominant !== lockManager) {
    for (const [path, m] of managersByFile) {
      if (!m.has(dominant)) continue;
      findings.push({
        rule: "lockfile-mismatch",
        severity: "warning",
        file: path,
        line: firstLineWith(files, path, dominant),
        subject: dominant,
        message: `${path} tells agents to use \`${dominant}\`, but the repo has a ${lockManager} lockfile`,
        fix: `Switch the commands to ${lockManager} (or commit the ${dominant} lockfile and delete the other).`,
      });
    }
  }

  // --- test runners --------------------------------------------------------------
  for (const family of [JS_TEST_RUNNERS, PY_TEST_RUNNERS]) {
    const byFile = new Map<string, Set<string>>();
    for (const file of files) {
      const s = new Set(extractToolMentions(file.text, family).map((h) => h.tool));
      if (s.size) byFile.set(file.path, s);
    }
    const all = new Set([...byFile.values()].flatMap((s) => [...s]));
    if (all.size < 2) continue;
    const counts = new Map<string, number>();
    for (const s of byFile.values()) for (const t of s) counts.set(t, (counts.get(t) ?? 0) + 1);
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    for (const [path, s] of byFile) {
      for (const t of s) {
        if (t === main) continue;
        const others = [...byFile.entries()]
          .filter(([p, ss]) => p !== path && ss.has(main))
          .map(([p]) => p);
        findings.push({
          rule: "contradiction",
          severity: "error",
          file: path,
          line: firstLineWith(files, path, t),
          subject: t,
          message: `${path} runs tests with \`${t}\` while ${others.join(", ") || "other files"} use \`${main}\``,
          fix: "State one test runner and one command; delete the stale one.",
        });
      }
    }
  }

  // --- Node major versions -------------------------------------------------------
  const versions: { file: string; line?: number; major: number; source: string }[] = [];
  for (const file of files) {
    for (const v of extractNodeVersions(file.text)) {
      versions.push({ file: file.path, line: v.line, major: v.major, source: v.raw });
    }
  }
  const majors = new Set(versions.map((v) => v.major));
  if (facts.nodeMajor) majors.add(facts.nodeMajor.major);
  if (majors.size >= 2) {
    const canonical =
      facts.nodeMajor?.major ??
      [...majors].sort(
        (a, b) =>
          versions.filter((v) => v.major === b).length -
          versions.filter((v) => v.major === a).length,
      )[0] ??
      0;
    const reported = new Set<string>();
    for (const v of versions) {
      if (v.major === canonical) continue;
      const key = `${v.file}:${v.major}`;
      if (reported.has(key)) continue;
      reported.add(key);
      findings.push({
        rule: "contradiction",
        severity: "error",
        file: v.file,
        line: v.line,
        subject: v.source,
        message: `${v.file} says Node ${v.major}, but ${
          facts.nodeMajor ? facts.nodeMajor.source : "other instruction files"
        } say${facts.nodeMajor ? "s" : ""} Node ${canonical}`,
        fix: `Use Node ${canonical} everywhere (engines.node / .nvmrc are the source of truth).`,
      });
    }
  }

  return findings;
}

function firstLineWith(files: InstructionFile[], path: string, needle: string): number | undefined {
  const file = files.find((f) => f.path === path);
  if (!file) return undefined;
  for (const span of extractCodeSpans(file.text)) {
    if (new RegExp(`(^|[\\s/])${needle}(\\s|$)`).test(span.text)) return span.line;
  }
  const idx = file.text.split(/\r?\n/).findIndex((l) => l.includes(needle));
  return idx >= 0 ? idx + 1 : undefined;
}

/** `no-instruction-file`, `missing-test-instructions`, `missing-dev-env-instructions`. */
export async function checkSections(ctx: RuleContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  if (ctx.files.length === 0) {
    findings.push({
      rule: "no-instruction-file",
      severity: "error",
      file: "AGENTS.md",
      message: "No AGENTS.md, CLAUDE.md or .cursorrules found",
      fix: "Add an AGENTS.md at the repo root: how to install, run, test and where things live.",
    });
    return findings;
  }
  const code = ctx.files.flatMap((f) => extractCodeSpans(f.text).map((s) => s.text)).join("\n");
  const primary = ctx.files[0]?.path ?? "AGENTS.md";
  if (!TEST_COMMAND.test(code)) {
    findings.push({
      rule: "missing-test-instructions",
      severity: "error",
      file: primary,
      message: "No instruction says how to run the tests",
      fix: "Add the exact test command in a code span, e.g. `pnpm test` or `pytest -q`, and when to run it.",
    });
  }
  if (!DEV_ENV_COMMAND.test(code)) {
    findings.push({
      rule: "missing-dev-env-instructions",
      severity: "error",
      file: primary,
      message: "No instruction says how to install dependencies or start the dev environment",
      fix: "Add the install command (`pnpm install`, `uv sync`…), the dev command and which env file to copy.",
    });
  }
  return findings;
}

export const ALL_RULES = [checkSections, checkStaleCommands, checkDeadPaths, checkContradictions];

/** Managers considered by the contradiction rule (exported for docs/tests). */
export const MANAGERS: readonly Manager[] = ["npm", "pnpm", "yarn", "bun", "make", "turbo", "just"];

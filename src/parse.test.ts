import { describe, expect, it } from "vitest";
import {
  extractCodeSpans,
  extractCommands,
  extractNodeVersions,
  extractPaths,
  parseCommandLine,
  pathCandidate,
} from "./parse.js";
import { parseJustRecipes, parseMakeTargets } from "./repo.js";

describe("extractCodeSpans", () => {
  it("finds inline and fenced spans with line numbers", () => {
    const md = "Run `pnpm test`.\n\n```bash\n$ pnpm build\n```\n\nand `src/a.ts`.";
    const spans = extractCodeSpans(md);
    expect(spans.map((s) => [s.line, s.text, s.fenced, s.lang])).toEqual([
      [1, "pnpm test", false, ""],
      [4, "$ pnpm build", true, "bash"],
      [7, "src/a.ts", false, ""],
    ]);
  });
});

describe("parseCommandLine", () => {
  const one = (line: string) => parseCommandLine(line, 1, false);
  it("understands npm/pnpm/yarn/bun/make/turbo/just", () => {
    expect(one("npm run build")[0]).toMatchObject({ manager: "npm", script: "build" });
    expect(one("npm test")[0]).toMatchObject({ manager: "npm", script: "test" });
    expect(one("npm install")).toEqual([]);
    expect(one("pnpm lint:fix")[0]).toMatchObject({ manager: "pnpm", script: "lint:fix" });
    expect(one("pnpm run dev")[0]).toMatchObject({ manager: "pnpm", script: "dev" });
    expect(one("pnpm install")).toEqual([]);
    expect(one("pnpm --filter @x/web build")[0]).toMatchObject({
      manager: "pnpm",
      script: "build",
      filter: "@x/web",
      anyWorkspace: true,
    });
    expect(one("pnpm -r test")[0]).toMatchObject({
      manager: "pnpm",
      script: "test",
      anyWorkspace: true,
    });
    expect(one("yarn typecheck")[0]).toMatchObject({ manager: "yarn", script: "typecheck" });
    expect(one("yarn install")).toEqual([]);
    expect(one("bun run dev")[0]).toMatchObject({ manager: "bun", script: "dev" });
    expect(one("make setup test")).toHaveLength(2);
    expect(one("turbo run build --filter=x")[0]).toMatchObject({
      manager: "turbo",
      script: "build",
    });
    expect(one("just deploy")[0]).toMatchObject({ manager: "just", script: "deploy" });
  });
  it("splits chained commands and strips prompts / env assignments", () => {
    const refs = one("$ CI=1 pnpm build && pnpm test");
    expect(refs.map((r) => r.script)).toEqual(["build", "test"]);
  });
});

describe("extractCommands", () => {
  it("marks negated prose", () => {
    const refs = extractCommands("Do not run `npm run legacy` any more. Run `pnpm build`.");
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ script: "legacy", negated: true });
    expect(refs[1]).toMatchObject({ script: "build", negated: false });
  });
  it("ignores non-shell fences", () => {
    expect(extractCommands("```ts\nconst x = 'pnpm build';\n```")).toEqual([]);
  });
});

describe("pathCandidate", () => {
  it("accepts paths and rejects commands, URLs, env vars", () => {
    expect(pathCandidate("src/index.ts")?.path).toBe("src/index.ts");
    expect(pathCandidate("./docs/x.md")?.path).toBe("docs/x.md");
    expect(pathCandidate("/src/a.ts")).toMatchObject({ path: "src/a.ts", rooted: true });
    expect(pathCandidate("packages/*")).toMatchObject({ path: "packages/*", glob: true });
    expect(pathCandidate("package.json")?.path).toBe("package.json");
    expect(pathCandidate("src/a.ts:12:3")?.path).toBe("src/a.ts");
    expect(pathCandidate("https://x.y/z")).toBeNull();
    expect(pathCandidate("pnpm build")).toBeNull();
    expect(pathCandidate("DATABASE_URL")).toBeNull();
    expect(pathCandidate("@scope/pkg")).toBeNull();
    expect(pathCandidate("--flag")).toBeNull();
    expect(pathCandidate("dist/index.js")).toBeNull();
    expect(pathCandidate(".env.local")).toBeNull();
    expect(pathCandidate("foo")).toBeNull();
  });
});

describe("extractPaths", () => {
  it("collects inline paths and relative links", () => {
    const refs = extractPaths("See `src/a.ts` and [docs](./docs/b.md) and `npm run x`.");
    expect(refs.map((r) => r.path)).toEqual(["src/a.ts", "docs/b.md"]);
  });
});

describe("extractNodeVersions", () => {
  it("reads Node 22, node@20, nvm use 18", () => {
    const md = "Node 22 required.\nUse `node@20`.\n`nvm use 18`\nNode.js v16.20";
    expect(extractNodeVersions(md).map((v) => v.major)).toEqual([22, 20, 18, 16]);
  });
});

describe("Makefile / justfile parsing", () => {
  it("lists targets and recipes", () => {
    expect([
      ...parseMakeTargets(".PHONY: a b\na: dep\n\techo\nb c:\n\techo\nVAR := 1\n%.o: %.c"),
    ]).toEqual(["a", "b", "c"]);
    expect([
      ...parseJustRecipes(
        "default:\n  just --list\nbuild target='x':\n  cargo build\n@quiet:\n  echo",
      ),
    ]).toEqual(["default", "build", "quiet"]);
  });
});

/**
 * Facts about the repository that rules compare instruction files against:
 * package scripts, workspace packages, Makefile targets, turbo tasks, just
 * recipes, lockfiles and the declared Node version.
 */
import { normalizePath } from "./reader.js";
import type { RepoReader } from "./types.js";

export interface PackageInfo {
  /** package.json path */
  path: string;
  name: string | null;
  dir: string;
  scripts: Set<string>;
}

export interface RepoFacts {
  rootPackage: PackageInfo | null;
  /** dependency + devDependency names of the root package (bins `pnpm <name>` can run) */
  rootDependencies: Set<string>;
  workspacePackages: PackageInfo[];
  makeTargets: Set<string> | null;
  turboTasks: Set<string> | null;
  justRecipes: Set<string> | null;
  lockfiles: ("pnpm" | "npm" | "yarn" | "bun")[];
  /** from package.json engines.node, .nvmrc, .node-version */
  nodeMajor: { source: string; major: number } | null;
}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readPackage(reader: RepoReader, path: string): Promise<PackageInfo | null> {
  const json = parseJson(await reader.readText(path));
  if (!json) return null;
  const scripts = json["scripts"];
  const dir = normalizePath(path).replace(/\/?package\.json$/, "");
  return {
    path,
    name: typeof json["name"] === "string" ? json["name"] : null,
    dir,
    scripts: new Set(scripts && typeof scripts === "object" ? Object.keys(scripts) : []),
  };
}

/** Very small glob → regex for workspace patterns like `packages/*`, `apps/**`. */
function workspaceGlobToRegex(glob: string): RegExp {
  const DOUBLE = "__DOUBLE_STAR__";
  const src = normalizePath(glob)
    .replace(/\*\*/g, DOUBLE)
    .replace(/[.+^$(){}|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(DOUBLE, "g"), ".*");
  return new RegExp(`^${src}/package\\.json$`);
}

async function workspaceGlobs(
  reader: RepoReader,
  root: Record<string, unknown> | null,
): Promise<string[]> {
  const globs: string[] = [];
  const ws = await reader.readText("pnpm-workspace.yaml");
  if (ws) {
    let inPackages = false;
    for (const line of ws.split(/\r?\n/)) {
      if (/^packages:\s*$/.test(line)) {
        inPackages = true;
        continue;
      }
      if (!inPackages) continue;
      const m = /^\s+-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/.exec(line);
      if (m && m[1]) {
        if (!m[1].startsWith("!")) globs.push(m[1].trim());
      } else if (line.trim() && !/^\s/.test(line)) {
        inPackages = false;
      }
    }
  }
  const w = root?.["workspaces"];
  if (Array.isArray(w)) {
    for (const g of w) if (typeof g === "string") globs.push(g);
  } else if (w && typeof w === "object") {
    const packages = (w as { packages?: unknown }).packages;
    if (Array.isArray(packages)) for (const g of packages) if (typeof g === "string") globs.push(g);
  }
  return globs;
}

export function parseMakeTargets(text: string): Set<string> {
  const targets = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) || line.startsWith("#")) continue;
    const m = /^([A-Za-z0-9_./-][A-Za-z0-9_./ -]*?)\s*::?(?!=)/.exec(line);
    if (!m || !m[1]) continue;
    for (const t of m[1].split(/\s+/)) {
      if (t && !t.startsWith(".") && !t.includes("%") && !t.includes("$")) targets.add(t);
    }
  }
  return targets;
}

export function parseJustRecipes(text: string): Set<string> {
  const recipes = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^@?([A-Za-z_][A-Za-z0-9_-]*)(?:\s+[^:]*)?:(?!=)/.exec(line);
    if (m && m[1]) recipes.add(m[1]);
  }
  return recipes;
}

function nodeMajorFrom(text: string | null): number | null {
  if (!text) return null;
  const m = /(\d{2})(?:\.\d+)*/.exec(text);
  return m && m[1] ? Number(m[1]) : null;
}

export async function collectRepoFacts(reader: RepoReader): Promise<RepoFacts> {
  const rootJson = parseJson(await reader.readText("package.json"));
  const rootPackage = rootJson ? await readPackage(reader, "package.json") : null;
  const rootDependencies = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const deps = rootJson?.[key];
    if (deps && typeof deps === "object") {
      for (const name of Object.keys(deps)) rootDependencies.add(name.replace(/^@[^/]+\//, ""));
    }
  }

  const globs = await workspaceGlobs(reader, rootJson);
  const workspacePackages: PackageInfo[] = [];
  if (globs.length) {
    const regexes = globs.map(workspaceGlobToRegex);
    const files = await reader.listFiles();
    for (const f of files) {
      if (!f.endsWith("package.json") || f === "package.json") continue;
      if (f.includes("node_modules/")) continue;
      if (regexes.some((r) => r.test(f))) {
        const pkg = await readPackage(reader, f);
        if (pkg) workspacePackages.push(pkg);
      }
    }
  }

  const makefile = (await reader.readText("Makefile")) ?? (await reader.readText("makefile"));
  const turbo = parseJson(await reader.readText("turbo.json"));
  let turboTasks: Set<string> | null = null;
  if (turbo) {
    const tasks = (turbo["tasks"] ?? turbo["pipeline"]) as Record<string, unknown> | undefined;
    turboTasks = new Set(Object.keys(tasks ?? {}).map((t) => t.replace(/^.*#/, "")));
  }
  const just =
    (await reader.readText("justfile")) ??
    (await reader.readText("Justfile")) ??
    (await reader.readText(".justfile"));

  const lockfiles: RepoFacts["lockfiles"] = [];
  if (await reader.exists("pnpm-lock.yaml")) lockfiles.push("pnpm");
  if (await reader.exists("package-lock.json")) lockfiles.push("npm");
  if (await reader.exists("yarn.lock")) lockfiles.push("yarn");
  if ((await reader.exists("bun.lockb")) || (await reader.exists("bun.lock")))
    lockfiles.push("bun");

  let nodeMajor: RepoFacts["nodeMajor"] = null;
  const engines = rootJson?.["engines"];
  const engineNode =
    engines && typeof engines === "object" ? (engines as { node?: unknown }).node : undefined;
  const fromEngines = typeof engineNode === "string" ? nodeMajorFrom(engineNode) : null;
  if (fromEngines) {
    nodeMajor = { source: "package.json engines.node", major: fromEngines };
  } else {
    const nvmrc = nodeMajorFrom(await reader.readText(".nvmrc"));
    if (nvmrc) nodeMajor = { source: ".nvmrc", major: nvmrc };
    else {
      const nv = nodeMajorFrom(await reader.readText(".node-version"));
      if (nv) nodeMajor = { source: ".node-version", major: nv };
    }
  }

  return {
    rootPackage,
    rootDependencies,
    workspacePackages,
    makeTargets: makefile ? parseMakeTargets(makefile) : null,
    turboTasks,
    justRecipes: just ? parseJustRecipes(just) : null,
    lockfiles,
    nodeMajor,
  };
}

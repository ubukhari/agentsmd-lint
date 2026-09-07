import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { RepoReader } from "./types.js";

/** Directories never walked or resolved against (build output, deps, VCS). */
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "out",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".pnpm-store",
]);

/** Hard cap on files listed, so a huge monorepo cannot stall the linter. */
export const MAX_LISTED_FILES = 50_000;

export function normalizePath(p: string): string {
  let out = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  while (out.startsWith("./")) out = out.slice(2);
  return out;
}

/** Read-only view of a directory on disk. */
export function fsReader(root: string): RepoReader {
  const abs = resolve(root);
  const inside = (p: string): string | null => {
    const target = resolve(abs, normalizePath(p));
    const rel = relative(abs, target);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) return null;
    return target;
  };
  let cached: Promise<string[]> | null = null;

  async function walk(dir: string, acc: string[]): Promise<void> {
    if (acc.length >= MAX_LISTED_FILES) return;
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (acc.length >= MAX_LISTED_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full, acc);
      } else if (entry.isFile()) {
        acc.push(relative(abs, full).split(sep).join("/"));
      }
    }
  }

  return {
    async exists(p) {
      const target = inside(p);
      if (!target) return false;
      try {
        await stat(target);
        return true;
      } catch {
        return false;
      }
    },
    async readText(p) {
      const target = inside(p);
      if (!target) return null;
      try {
        const s = await stat(target);
        if (!s.isFile()) return null;
        return await readFile(target, "utf8");
      } catch {
        return null;
      }
    },
    listFiles() {
      cached ??= (async () => {
        const acc: string[] = [];
        await walk(abs, acc);
        return acc.sort();
      })();
      return cached;
    },
  };
}

/** In-memory repo: `{ "AGENTS.md": "...", "package.json": "..." }`. Directories are implied. */
export function memoryReader(files: Record<string, string>): RepoReader {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) map.set(normalizePath(k), v);
  const dirs = new Set<string>();
  for (const key of map.keys()) {
    const parts = key.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    async exists(p) {
      const n = normalizePath(p);
      return n === "" || map.has(n) || dirs.has(n);
    },
    async readText(p) {
      return map.get(normalizePath(p)) ?? null;
    },
    async listFiles() {
      return [...map.keys()].sort();
    },
  };
}

/**
 * Reader backed by a path list plus a content loader — what the GitHub App
 * uses (git tree for `exists`, contents API for `readText`).
 */
export function lazyReader(
  paths: Iterable<string>,
  load: (path: string) => Promise<string | null>,
): RepoReader {
  const files = new Set<string>();
  const dirs = new Set<string>();
  for (const raw of paths) {
    const p = normalizePath(raw);
    files.add(p);
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
  }
  const cache = new Map<string, Promise<string | null>>();
  return {
    async exists(p) {
      const n = normalizePath(p);
      return n === "" || files.has(n) || dirs.has(n);
    },
    readText(p) {
      const n = normalizePath(p);
      if (!files.has(n)) return Promise.resolve(null);
      let hit = cache.get(n);
      if (!hit) {
        hit = load(n).catch(() => null);
        cache.set(n, hit);
      }
      return hit;
    },
    async listFiles() {
      return [...files].sort();
    },
  };
}

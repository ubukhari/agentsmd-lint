/**
 * Markdown scanning: pull commands, path references and version statements out
 * of an instruction file. Deterministic, regex-based, no LLM.
 */

export interface CodeSpan {
  /** 1-based line of the span's first line */
  line: number;
  text: string;
  /** fenced block (```) vs inline `code` */
  fenced: boolean;
  /** fence info string, lowercased (e.g. "bash"), "" when absent or inline */
  lang: string;
  /** the prose line the inline span sits in ("" for fenced blocks) */
  context: string;
}

export type Manager = "npm" | "pnpm" | "yarn" | "bun" | "make" | "turbo" | "just";

export interface CommandRef {
  line: number;
  raw: string;
  /** which runner the script belongs to */
  manager: Manager;
  /** script / target / task name */
  script: string;
  /** `pnpm --filter <pkg>` / `pnpm -F <pkg>` */
  filter?: string;
  /** `-r` / `--recursive` / workspace-scoped: the script may live in any workspace package */
  anyWorkspace: boolean;
  /** the surrounding prose negates it ("do not run npm install") */
  negated: boolean;
}

export interface PathRef {
  line: number;
  raw: string;
  /** cleaned candidate path (no leading ./, no trailing /) */
  path: string;
  /** contains a glob character */
  glob: boolean;
  /** leading slash in the source ("/src/x.ts") */
  rooted: boolean;
}

export interface NodeVersionRef {
  line: number;
  raw: string;
  major: number;
}

const SHELL_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console", "shellsession", "text"]);
const NEGATION = /\b(not|never|don'?t|do not|avoid|instead of|deprecated|no longer)\b/i;

/** The sentence (split on . ! ? ;) of `line` that contains `index`, so negation is local. */
function sentenceAround(line: string, index: number): string {
  let start = 0;
  const re = /[.!?;](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index < index) start = m.index + 1;
    else return line.slice(start, m.index + 1);
  }
  return line.slice(start);
}

/** Split a markdown document into inline and fenced code spans with line numbers. */
export function extractCodeSpans(markdown: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; lang: string; start: number; buf: string[] } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const open = /^\s*(`{3,}|~{3,})\s*([\w.+-]*)/.exec(line);
    if (fence) {
      const marker = open?.[1] ?? "";
      const closes =
        marker.length >= fence.marker.length && marker[0] === fence.marker[0] && !open?.[2];
      if (closes) {
        spans.push({
          line: fence.start + 1,
          text: fence.buf.join("\n"),
          fenced: true,
          lang: fence.lang,
          context: "",
        });
        fence = null;
      } else {
        fence.buf.push(line);
      }
      continue;
    }
    if (open) {
      fence = {
        marker: open[1] ?? "```",
        lang: (open[2] ?? "").toLowerCase(),
        start: i + 1,
        buf: [],
      };
      continue;
    }
    const inline = /`([^`\n]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = inline.exec(line)) !== null) {
      spans.push({
        line: i + 1,
        text: m[1] ?? "",
        fenced: false,
        lang: "",
        context: sentenceAround(line, m.index),
      });
    }
  }
  return spans;
}

const PNPM_BUILTINS = new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "uninstall",
  "update",
  "up",
  "upgrade",
  "link",
  "unlink",
  "import",
  "rebuild",
  "rb",
  "prune",
  "fetch",
  "dlx",
  "exec",
  "create",
  "init",
  "publish",
  "pack",
  "store",
  "why",
  "list",
  "ls",
  "outdated",
  "audit",
  "licenses",
  "patch",
  "patch-commit",
  "patch-remove",
  "env",
  "setup",
  "self-update",
  "root",
  "bin",
  "config",
  "dedupe",
  "deploy",
  "approve-builds",
  "run",
  "run-script",
  "install-test",
  "it",
  "doctor",
  "server",
  "recursive",
  "multi",
  "m",
  "help",
  "-v",
  "--version",
]);
const YARN_BUILTINS = new Set([
  "add",
  "install",
  "remove",
  "up",
  "upgrade",
  "upgrade-interactive",
  "dlx",
  "exec",
  "init",
  "workspace",
  "workspaces",
  "why",
  "info",
  "cache",
  "config",
  "set",
  "version",
  "pack",
  "publish",
  "link",
  "unlink",
  "node",
  "npm",
  "plugin",
  "rebuild",
  "run",
  "bin",
  "constraints",
  "dedupe",
  "explain",
  "patch",
  "patch-commit",
  "search",
  "stage",
  "unplug",
  "create",
  "global",
  "import",
  "licenses",
  "list",
  "outdated",
  "audit",
  "autoclean",
  "check",
  "login",
  "logout",
  "owner",
  "policies",
  "tag",
  "team",
  "help",
  "-v",
  "--version",
]);
/** Scripts npm/pnpm/yarn run without `run`; `start` has a default when server.js exists. */
const NPM_LIFECYCLE = new Set(["test", "start", "stop", "restart"]);
const SCRIPT_NAME = /^[a-zA-Z0-9_:.@/-]+$/;

function stripPrompt(line: string): string {
  return line.replace(/^\s*[$>%#]\s+/, "").trim();
}

function words(cmd: string): string[] {
  return cmd.split(/\s+/).filter(Boolean);
}

/** Parse one shell line into zero or more script references. Handles `a && b ; c | d`. */
export function parseCommandLine(line: string, lineNo: number, negated: boolean): CommandRef[] {
  const refs: CommandRef[] = [];
  const segments = stripPrompt(line)
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    const w = words(seg);
    let i = 0;
    while (i < w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[i] ?? "")) i += 1;
    const tool = w[i];
    if (!tool) continue;
    const rest = w.slice(i + 1);
    const base = (r: Partial<CommandRef> & { manager: Manager; script: string }): CommandRef => ({
      line: lineNo,
      raw: seg,
      anyWorkspace: false,
      negated,
      ...r,
    });

    if (tool === "npm") {
      const sub = rest[0];
      if (!sub) continue;
      if (sub === "run" || sub === "run-script") {
        const script = rest.find((t, idx) => idx > 0 && !t.startsWith("-"));
        const anyWorkspace = rest.some(
          (t) => t === "-ws" || t === "--workspaces" || t === "-w" || t.startsWith("--workspace"),
        );
        if (script && SCRIPT_NAME.test(script)) {
          refs.push(base({ manager: "npm", script, anyWorkspace }));
        }
      } else if (NPM_LIFECYCLE.has(sub)) {
        refs.push(base({ manager: "npm", script: sub }));
      }
      continue;
    }
    if (tool === "pnpm") {
      let filter: string | undefined;
      let anyWorkspace = false;
      let j = 0;
      while (j < rest.length) {
        const t = rest[j] ?? "";
        if (t === "--filter" || t === "-F") {
          filter = rest[j + 1];
          anyWorkspace = true;
          j += 2;
          continue;
        }
        if (t.startsWith("--filter=") || t.startsWith("-F=")) {
          filter = t.slice(t.indexOf("=") + 1);
          anyWorkspace = true;
          j += 1;
          continue;
        }
        if (t === "-r" || t === "--recursive") anyWorkspace = true;
        if (t.startsWith("-")) {
          j += 1;
          continue;
        }
        break;
      }
      let sub = rest[j];
      if (sub === "run" || sub === "run-script") sub = rest[j + 1];
      if (!sub) continue;
      if (PNPM_BUILTINS.has(sub) && !NPM_LIFECYCLE.has(sub)) continue;
      if (sub === "start" && !filter) continue; // pnpm start falls back to node server.js
      if (SCRIPT_NAME.test(sub)) {
        refs.push(base({ manager: "pnpm", script: sub, filter, anyWorkspace }));
      }
      continue;
    }
    if (tool === "yarn") {
      let j = 0;
      let anyWorkspace = false;
      while (j < rest.length && (rest[j] ?? "").startsWith("-")) j += 1;
      let sub = rest[j];
      if (sub === "workspaces" && rest[j + 1] === "foreach") {
        anyWorkspace = true;
        j += 2;
        while (j < rest.length && (rest[j] ?? "").startsWith("-")) j += 1;
        sub = rest[j];
        if (sub === "run") sub = rest[j + 1];
      } else if (sub === "workspace") {
        anyWorkspace = true;
        sub = rest[j + 2];
        if (sub === "run") sub = rest[j + 3];
      } else if (sub === "run") {
        sub = rest[j + 1];
      }
      if (!sub) continue;
      if (YARN_BUILTINS.has(sub) && !NPM_LIFECYCLE.has(sub)) continue;
      if (SCRIPT_NAME.test(sub)) refs.push(base({ manager: "yarn", script: sub, anyWorkspace }));
      continue;
    }
    if (tool === "bun" && rest[0] === "run") {
      const script = rest.slice(1).find((t) => !t.startsWith("-"));
      if (script && SCRIPT_NAME.test(script) && !/\.[cm]?[jt]sx?$/.test(script)) {
        refs.push(base({ manager: "bun", script }));
      }
      continue;
    }
    if (tool === "make") {
      for (const t of rest) {
        if (t.startsWith("-") || t.includes("=")) continue;
        refs.push(base({ manager: "make", script: t }));
      }
      continue;
    }
    if (tool === "turbo") {
      const sub = rest[0] === "run" ? rest.slice(1) : rest;
      for (const t of sub) {
        if (t.startsWith("-")) break;
        refs.push(base({ manager: "turbo", script: t }));
      }
      continue;
    }
    if (tool === "just") {
      const t = rest.find((x) => !x.startsWith("-"));
      if (t) refs.push(base({ manager: "just", script: t }));
      continue;
    }
  }
  return refs;
}

/** Every script/target reference in a markdown document. */
export function extractCommands(markdown: string): CommandRef[] {
  const refs: CommandRef[] = [];
  for (const span of extractCodeSpans(markdown)) {
    if (span.fenced && !SHELL_LANGS.has(span.lang)) continue;
    const negated = !span.fenced && NEGATION.test(span.context);
    const lines = span.text.split("\n");
    lines.forEach((l, idx) => {
      if (!l.trim() || l.trim().startsWith("#")) return;
      refs.push(...parseCommandLine(l, span.line + idx, negated));
    });
  }
  return refs;
}

const KNOWN_FILENAMES = new Set([
  "Makefile",
  "makefile",
  "Dockerfile",
  "LICENSE",
  "README",
  "CHANGELOG",
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "justfile",
  "Justfile",
  "turbo.json",
  "pnpm-workspace.yaml",
  "requirements.txt",
  "Gemfile",
  "composer.json",
  "Procfile",
  ".cursorrules",
  ".nvmrc",
  ".node-version",
  ".tool-versions",
]);
const EXT =
  /\.(md|mdx|txt|ts|tsx|js|jsx|mjs|cjs|json|jsonc|yaml|yml|toml|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|sql|prisma|graphql|gql|proto|css|scss|html|vue|svelte|astro|lock|cfg|ini|xml|csv|ipynb|tf|hcl|example|mdc)$/i;
const BUILD_OUTPUT =
  /^(dist|build|out|coverage|node_modules|\.next|\.turbo|\.cache|target|\.venv|venv|__pycache__)(\/|$)/;

/** Does this code span look like a repo path rather than a command, URL or identifier? */
export function pathCandidate(
  text: string,
): { path: string; glob: boolean; rooted: boolean } | null {
  const t = text.trim();
  if (!t || t.length > 200 || /\s/.test(t)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || t.startsWith("mailto:")) return null;
  if (/^[-@#$~]/.test(t)) return null;
  if (/[<>{}|()"';,=]/.test(t)) return null;
  if (/^[A-Z][A-Z0-9_]+$/.test(t)) return null; // ENV_VAR
  if (/^\\/.test(t) || /^[a-zA-Z]:[\\/]/.test(t)) return null; // windows paths
  const rooted = t.startsWith("/");
  const glob = /[*?[\]]/.test(t);
  const hasSlash = t.includes("/");
  const base = t.replace(/\/+$/, "").split("/").pop() ?? t;
  const looksFile = EXT.test(base) || KNOWN_FILENAMES.has(base) || /^\.[a-z]/i.test(base);
  if (!hasSlash && !looksFile) return null;
  if (hasSlash) {
    const first = t.replace(/^\.?\//, "").split("/")[0] ?? "";
    if (!/^[a-zA-Z0-9_.*-]+$/.test(first)) return null;
  }
  if (/^\.\.?$/.test(t)) return null;
  let path = t.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  path = path.replace(/:\d+(:\d+)?$/, ""); // file.ts:12:3
  if (!path || path.startsWith("..")) return null;
  if (BUILD_OUTPUT.test(path)) return null;
  if (/^\.env(\.|$)/.test(base)) return null; // gitignored by convention
  return { path, glob, rooted };
}

/** Every path-like inline code span and relative markdown link target. */
export function extractPaths(markdown: string): PathRef[] {
  const refs: PathRef[] = [];
  const seen = new Set<string>();
  const push = (line: number, raw: string) => {
    const c = pathCandidate(raw);
    if (!c) return;
    const key = `${line}:${c.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ line, raw, path: c.path, glob: c.glob, rooted: c.rooted });
  };
  for (const span of extractCodeSpans(markdown)) {
    if (span.fenced) continue;
    push(span.line, span.text);
  }
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const link = /\[[^\]]*\]\((\.{1,2}\/[^)\s]+|\/[^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = link.exec(line)) !== null) {
      const target = (m[1] ?? "").split("#")[0] ?? "";
      if (target) push(idx + 1, target);
    }
  });
  return refs;
}

/** Node major versions stated in prose or code ("Node 22", "node@20", "nvm use 18"). */
export function extractNodeVersions(markdown: string): NodeVersionRef[] {
  const out: NodeVersionRef[] = [];
  const lines = markdown.split(/\r?\n/);
  const re = /\b(?:node(?:\.js)?\s*(?:v|@|>=|=)?\s*|nvm\s+use\s+v?)(\d{2})(?:\.\d+)*\b/gi;
  lines.forEach((line, idx) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const major = Number(m[1]);
      if (major >= 10 && major <= 40) out.push({ line: idx + 1, raw: m[0], major });
    }
  });
  return out;
}

/** Tool mentions used as commands (`vitest`, `jest`, `pytest`…), negated prose excluded. */
export function extractToolMentions(
  markdown: string,
  tools: readonly string[],
): { tool: string; line: number }[] {
  const out: { tool: string; line: number }[] = [];
  for (const span of extractCodeSpans(markdown)) {
    if (span.fenced && !SHELL_LANGS.has(span.lang)) continue;
    if (!span.fenced && NEGATION.test(span.context)) continue;
    const lines = span.text.split("\n");
    lines.forEach((l, idx) => {
      const cmd = stripPrompt(l);
      for (const tool of tools) {
        if (new RegExp(`(^|[\\s/])${tool}(\\s|$)`).test(cmd)) {
          out.push({ tool, line: span.line + idx });
        }
      }
    });
  }
  return out;
}

# agentsmd-lint

Lint `AGENTS.md`, `CLAUDE.md`, `.cursorrules` (and `GEMINI.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, `.clinerules`) **against the repo they describe**. Finds the things that quietly send coding agents down the wrong path, then scores the repo and renders an agent-readiness badge.

```bash
npx @agentwares/agentsmd-lint            # lint the current repo, print the report, exit 1 on errors
```

```
agentsmd-lint v0.1.0 — AGENTS.md, CLAUDE.md, .cursorrules
score 20/100 (F) — 10 errors, 1 warning

CLAUDE.md:3                  error   contradiction                CLAUDE.md says Node 18, but package.json engines.node says Node 22
                                     fix:                         Use Node 22 everywhere (engines.node / .nvmrc are the source of truth).
CLAUDE.md:8                  error   stale-command                `pnpm lint:fix` runs script "lint:fix", which is not defined in package.json
                                     fix:                         Add a "lint:fix" script to package.json or change the instruction to an existing script (dev, build, test, lint).
CLAUDE.md:19                 error   dead-path                    `src/server/index.ts` does not exist in the repo
                                     fix:                         Update the path (the file was probably moved or renamed) or delete the reference.
…
```

No LLM. No network. No account. No telemetry (the only "phone home" is an opt-in `--star` line that prints a link).

## What it checks

| Rule                                                        | Severity | What it catches                                                                                                                                                                                                   |
| ----------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stale-command`                                             | error    | `npm run x` / `pnpm x` / `yarn x` / `bun run x` scripts missing from `package.json` (workspace-aware: `pnpm --filter pkg x`, `-r`), `make x` targets missing from the Makefile, `turbo x` tasks, `just x` recipes |
| `unknown-workspace-package`                                 | warning  | `pnpm --filter <pkg>` where `<pkg>` is not a workspace package                                                                                                                                                    |
| `dead-path`                                                 | error    | inline-code paths and relative links (`src/foo.ts`, `docs/x.md`, `packages/*`) that do not exist                                                                                                                  |
| `contradiction`                                             | error    | different package managers across files (or vs the lockfile), different test runners (vitest vs jest, pytest vs unittest), different Node majors (vs `engines.node` / `.nvmrc`)                                   |
| `lockfile-mismatch`                                         | warning  | every file says `npm`, the repo has `pnpm-lock.yaml`                                                                                                                                                              |
| `missing-test-instructions`, `missing-dev-env-instructions` | error    | no test command, no install/dev/env-file instruction anywhere                                                                                                                                                     |
| `no-instruction-file`                                       | error    | nothing for an agent to read                                                                                                                                                                                      |

Negated prose is ignored (`Do not run \`npm install\``does not count as "uses npm"), build-output and`.env*`paths are skipped,`/api/health`-style tokens are treated as routes, `path/to/x` as placeholders. A bare name with no directory (`llms.txt`, `settings.json`) is only flagged when the repo really has one somewhere — otherwise it is prose about a concept, not a path — and the fix then names the path you probably meant.

**Score** = 100 − capped deductions (stale 10 each ≤ 40, dead path 5 ≤ 30, contradiction 15 ≤ 30, missing tests 15, missing dev-env 10, warnings 5). Grades: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F. Weights are in `src/score.ts`.

## CLI

```
agentsmd-lint [dir] [--format text|json|markdown|github] [--badge out.svg] [--min-score N]
              [--no-fail] [--disable rule,rule] [--file extra.md] [--star]
```

- `--badge agent-readiness.svg` writes the badge locally (rendered with `@agentwares/badge`, inlined into the bundle — zero runtime dependencies).
- `--format markdown` is the PR-comment body; `--format github` prints workflow annotations.
- Exit codes: `0` clean (or `--no-fail`), `1` errors or below `--min-score`, `2` usage error.

Programmatic:

```ts
import {
  lintDir,
  lint,
  memoryReader,
  renderReadinessBadge,
  formatMarkdown,
} from "@agentwares/agentsmd-lint";

const report = await lintDir(".");
report.score; // { value: 85, grade: "B", status: "degraded", breakdown: [...] }
report.findings; // [{ rule, severity, file, line, message, fix, subject }]
renderReadinessBadge(report.score); // SVG string
await lint(memoryReader({ "AGENTS.md": "...", "package.json": "{}" })); // any RepoReader
```

## Badge

The CLI writes the SVG; READMEs and PR comments use the hosted stateless badge (no data stored, nothing tracked):

```markdown
![agent-ready](https://agentwares-readiness.vercel.app/badge/agents-md.svg?score=85&grade=B)
```

## GitHub Action

```yaml
# .github/workflows/agentsmd-lint.yml
name: agentsmd-lint
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: agentwares/agentsmd-lint@main
        with:
          min-score: 60 # optional
          fail-on-error: false # optional
```

Posts one sticky comment per PR (updated on every push), writes the report to the job summary, emits annotations, and exposes `score` / `grade` outputs. Nothing leaves the runner except the comment.

## GitHub App (hosted, free for public repos)

The same linter as a GitHub App so repos need no workflow file. The webhook handler is Web-standard (`src/github/webhook.ts`: verifies `X-Hub-Signature-256`, mints the installation token with an RS256 JWT via Web Crypto, reads the PR head through the contents API, upserts the sticky comment) and ships as a Cloudflare Worker entry (`src/github/worker.ts`, `wrangler.toml`) and as a Vercel route in the readiness-scorer app (`/api/agents-md-lint/webhook`).

Registration needs the org owner (not done yet — see `docs/reports/A1.md`):

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**: name `agentsmd-lint`, webhook URL `https://agentwares-readiness.vercel.app/api/agents-md-lint/webhook`, a webhook secret.
2. Permissions: Repository → Contents **Read**, Pull requests **Write**, Metadata **Read**. Subscribe to **Pull request**.
3. Generate a private key; set `AGENTSMD_LINT_APP_ID`, `AGENTSMD_LINT_PRIVATE_KEY` (PEM, PKCS#1 or PKCS#8; `\n`-escaped is fine), `AGENTSMD_LINT_WEBHOOK_SECRET` on the Vercel project (or `GITHUB_APP_*` for the Worker), redeploy.
4. Make the App public, install it on a repo, open a PR: the comment appears within seconds.

## Fixtures

`fixtures/seeded/` is a small repo with every problem seeded (3 stale commands, 3 dead paths, 4 contradictions, 1 unknown workspace package → 20/100 F); `fixtures/clean/` scores 100. `src/lint.test.ts` asserts both.

## Development

```bash
pnpm --filter agentsmd-lint build && pnpm --filter agentsmd-lint test
node assets/agents-md-lint/dist/cli.js .        # lint this monorepo
```

---

Free forever. Want a live status badge for the agent or MCP server the repo ships? That is [agentcheck](https://agentwares-agentcheck.vercel.app).

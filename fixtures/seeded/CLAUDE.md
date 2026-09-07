# CLAUDE.md (seeded with problems for the linter tests)

This repo targets Node 18. Install dependencies with `npm install`.

## Commands

- `pnpm build` — builds the app (valid)
- `pnpm lint:fix` — stale: no such script
- `npm run typecheck` — stale: no such script
- `make setup` — valid Makefile target
- `make deploy` — stale: no such Makefile target
- `pnpm --filter @seeded/web build` — valid workspace script
- `pnpm --filter @seeded/api test` — unknown workspace package
- Run the tests with `npx jest` before committing.

## Layout

- `src/index.ts` — entry point (exists)
- `src/server/index.ts` — dead path
- `docs/architecture.md` — exists
- `docs/setup.md` — dead path
- `packages/*` — workspace packages (glob, exists)
- `/api/health` — a route, not a path (must not be flagged)
- `path/to/your/file.ts` — placeholder (must not be flagged)

Do not use `yarn install` here (negated, must not count as a package manager).

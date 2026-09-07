import { defineConfig } from "tsup";

/**
 * `@agentwares/badge` is a private workspace package, so it is inlined into
 * the published bundle (`noExternal`); the npm package has zero runtime deps.
 */
export default defineConfig([
  {
    entry: { index: "src/index.ts", "github/worker": "src/github/worker.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    dts: true,
    sourcemap: true,
    clean: true,
    noExternal: ["@agentwares/badge"],
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    platform: "node",
    target: "node20",
    sourcemap: true,
    noExternal: ["@agentwares/badge"],
    banner: { js: "#!/usr/bin/env node" },
  },
]);

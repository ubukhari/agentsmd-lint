#!/usr/bin/env node
/**
 * Register the agentsmd-lint GitHub App via GitHub's App Manifest flow.
 *
 *   node assets/agents-md-lint/scripts/create-github-app.mjs [--org agentwares]
 *
 * Driving the "New GitHub App" form by hand means setting a dozen permission
 * dropdowns correctly and hoping none silently reset. The manifest flow declares
 * all of it in one JSON document: GitHub shows a pre-filled confirmation page,
 * the user clicks Create once, and GitHub hands back the app id, private key and
 * webhook secret in a single exchange.
 *
 * Credentials are appended to the repo-root .env.local (gitignored) and never printed.
 */
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ORG = process.argv.includes("--org")
  ? process.argv[process.argv.indexOf("--org") + 1]
  : "agentwares";
const PORT = Number(process.env.PORT ?? 7777);
const ENV_FILE = resolve(import.meta.dirname, "../../../.env.local");
const WEBHOOK = "https://agentwares-readiness.vercel.app/api/agents-md-lint/webhook";

const manifest = {
  name: "agentsmd-lint",
  url: "https://agentwares-readiness.vercel.app",
  description:
    "Checks that AGENTS.md, CLAUDE.md and .cursorrules still match the repo they describe: stale commands, dead paths, contradictions. Comments once per pull request.",
  hook_attributes: { url: WEBHOOK, active: true },
  redirect_url: `http://localhost:${PORT}/callback`,
  public: true,
  default_permissions: { contents: "read", pull_requests: "write", metadata: "read" },
  default_events: ["pull_request"],
};

function setEnv(key, value) {
  const line = `${key}=${value}`;
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  if (new RegExp(`^${key}=`, "m").test(current)) {
    writeFileSync(ENV_FILE, current.replace(new RegExp(`^${key}=.*$`, "m"), line), { mode: 0o600 });
  } else {
    appendFileSync(ENV_FILE, `${current.endsWith("\n") || !current ? "" : "\n"}${line}\n`, {
      mode: 0o600,
    });
  }
}

const page = `<!doctype html><meta charset="utf-8"><title>Create agentsmd-lint</title>
<style>body{font:16px system-ui;margin:4rem auto;max-width:34rem;line-height:1.6}
button{font:inherit;padding:.6rem 1.1rem;cursor:pointer}</style>
<h1>Register the agentsmd-lint GitHub App</h1>
<p>This posts a pre-filled manifest to GitHub (org <b>${ORG}</b>) with exactly the permissions the
linter needs: contents read, pull requests write, metadata read, and the pull_request event.</p>
<form id="f" action="https://github.com/organizations/${ORG}/settings/apps/new" method="post">
  <input type="hidden" name="manifest" value='${JSON.stringify(manifest).replace(/'/g, "&apos;")}'>
  <button type="submit">Continue to GitHub</button>
</form>
<script>document.getElementById("f").submit()</script>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    return;
  }
  if (url.pathname !== "/callback") {
    res.writeHead(404).end("not found");
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("no code in callback");
    return;
  }
  try {
    const r = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "user-agent": "agentwares-setup" },
    });
    const app = await r.json();
    if (!r.ok) throw new Error(app.message ?? `conversion failed (${r.status})`);

    setEnv("AGENTSMD_LINT_APP_ID", String(app.id));
    setEnv("AGENTSMD_LINT_WEBHOOK_SECRET", app.webhook_secret);
    setEnv("AGENTSMD_LINT_PRIVATE_KEY", JSON.stringify(app.pem));
    setEnv("AGENTSMD_LINT_CLIENT_ID", app.client_id);

    console.log(
      JSON.stringify({
        ok: true,
        app: app.slug,
        id: app.id,
        owner: app.owner?.login,
        permissions: app.permissions,
        events: app.events,
        html_url: app.html_url,
        wrote: "AGENTSMD_LINT_APP_ID, _WEBHOOK_SECRET, _PRIVATE_KEY, _CLIENT_ID",
      }),
    );
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
      `<meta charset="utf-8"><body style="font:16px system-ui;margin:4rem auto;max-width:34rem">
         <h1>Created</h1><p><b>${app.slug}</b> is registered. Credentials were written locally.
         You can close this tab.</p><p><a href="${app.html_url}">View the app on GitHub</a></p>`,
    );
    setTimeout(() => server.close(() => process.exit(0)), 300);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    res.writeHead(500).end("conversion failed; see the terminal");
    setTimeout(() => server.close(() => process.exit(1)), 300);
  }
});

server.listen(PORT, () => {
  console.log(`open http://localhost:${PORT}/ and click through to GitHub`);
});

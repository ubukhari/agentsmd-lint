/**
 * Cloudflare Worker / Vercel Function entry for the GitHub App webhook.
 * Same handler as `createWebhookHandler`; secrets come from the platform env.
 */
import { createWebhookHandler } from "./webhook.js";

export interface WorkerEnv {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  BADGE_URL_BASE?: string;
}

export function handlerFromEnv(env: WorkerEnv): ((req: Request) => Promise<Response>) | null {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_WEBHOOK_SECRET) return null;
  return createWebhookHandler({
    appId: env.GITHUB_APP_ID,
    // Platform env editors flatten newlines; accept the escaped form.
    privateKeyPem: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    badgeUrlBase: env.BADGE_URL_BASE,
  });
}

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "agentsmd-lint-app",
        configured: Boolean(handlerFromEnv(env)),
      });
    }
    const handler = handlerFromEnv(env);
    if (!handler) {
      return Response.json(
        {
          ok: false,
          error:
            "GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET)",
        },
        { status: 503 },
      );
    }
    return handler(req);
  },
};

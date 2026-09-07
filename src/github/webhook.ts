/**
 * GitHub App webhook handler: on pull_request events, lint the PR head and
 * upsert one sticky comment with the report. Web-standard (`Request` →
 * `Response`, Web Crypto only), so it runs on Cloudflare Workers, Vercel
 * Functions and Node 20+ unchanged.
 *
 * Registration (needs the org owner): see README "GitHub App".
 */
import { formatMarkdown, COMMENT_MARKER } from "../format.js";
import { lint } from "../lint.js";
import { lazyReader } from "../reader.js";
import { badgeUrl } from "../badge.js";
import type { RepoReader, RuleId } from "../types.js";

export interface GithubAppConfig {
  appId: string;
  /** PEM private key from the App settings page (PKCS#1 "RSA PRIVATE KEY" or PKCS#8) */
  privateKeyPem: string;
  webhookSecret: string;
  fetch?: typeof fetch;
  apiBase?: string;
  /** base URL of the hosted badge (defaults to the readiness-scorer app) */
  badgeUrlBase?: string;
  /** seconds since epoch; injectable for tests */
  now?: () => number;
  userAgent?: string;
}

export interface WebhookResult {
  ok: boolean;
  ignored?: string;
  score?: number;
  findings?: number;
  comment?: "created" | "updated" | "skipped";
  error?: string;
}

const HANDLED_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

// ---------------------------------------------------------------------------
// Crypto helpers (Web Crypto only)
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function derLength(len: number): number[] {
  if (len < 0x80) return [len];
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** Wrap a PKCS#1 RSAPrivateKey DER in the PKCS#8 PrivateKeyInfo envelope. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = [0x02, 0x01, 0x00];
  const algId = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const octet = [0x04, ...derLength(pkcs1.length)];
  const bodyLen = version.length + algId.length + octet.length + pkcs1.length;
  const out = new Uint8Array([
    0x30,
    ...derLength(bodyLen),
    ...version,
    ...algId,
    ...octet,
    ...pkcs1,
  ]);
  return out;
}

/** PEM (PKCS#1 or PKCS#8) → PKCS#8 DER bytes for `crypto.subtle.importKey`. */
export function pemToPkcs8Der(pem: string): Uint8Array<ArrayBuffer> {
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(pem);
  if (!m || !m[1] || !m[2]) throw new Error("privateKeyPem is not a PEM block");
  const der = base64ToBytes(m[2].replace(/\s+/g, ""));
  if (m[1] === "RSA PRIVATE KEY") return pkcs1ToPkcs8(der);
  if (m[1] === "PRIVATE KEY") return der;
  throw new Error(`unsupported PEM type ${m[1]}`);
}

/** RS256 JWT for the GitHub App (iss = appId, 10-minute lifetime, 60 s clock skew). */
export async function signAppJwt(
  appId: string,
  privateKeyPem: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Der(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const header = bytesToBase64Url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = bytesToBase64Url(
    enc.encode(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId })),
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    enc.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify `X-Hub-Signature-256` for a raw body. */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = await hmacSha256Hex(secret, body);
  return timingSafeEqual(header.slice(7), expected);
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

interface Api {
  base: string;
  fetch: typeof fetch;
  userAgent: string;
}

async function gh<T>(
  api: Api,
  token: string,
  method: string,
  path: string,
  body?: unknown,
  accept = "application/vnd.github+json",
): Promise<{ status: number; data: T }> {
  const res = await api.fetch(`${api.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept,
      "user-agent": api.userAgent,
      "x-github-api-version": "2022-11-28",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  if (!accept.includes("raw")) {
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return { status: res.status, data: data as T };
}

/** `RepoReader` over the GitHub contents API for one commit. Returns `truncated` when the tree was cut. */
export async function githubReader(
  api: Api,
  token: string,
  fullName: string,
  sha: string,
): Promise<{ reader: RepoReader; truncated: boolean }> {
  const { data } = await gh<{ tree: { path: string; type: string }[]; truncated: boolean }>(
    api,
    token,
    "GET",
    `/repos/${fullName}/git/trees/${sha}?recursive=1`,
  );
  const paths = data.tree.filter((t) => t.type === "blob").map((t) => t.path);
  const reader = lazyReader(paths, async (path) => {
    const res = await gh<string>(
      api,
      token,
      "GET",
      `/repos/${fullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
      undefined,
      "application/vnd.github.raw+json",
    );
    return res.data;
  });
  return { reader, truncated: Boolean(data.truncated) };
}

interface PullRequestEvent {
  action?: string;
  installation?: { id?: number };
  repository?: { full_name?: string };
  pull_request?: {
    number?: number;
    draft?: boolean;
    head?: { sha?: string; repo?: { full_name?: string } | null };
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function json(body: WebhookResult, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * `POST` webhook receiver. Events: `ping` → 200; `pull_request` (opened,
 * synchronize, reopened, ready_for_review) → lint + sticky comment; anything
 * else → 202 ignored. Bad signature → 401.
 */
export function createWebhookHandler(cfg: GithubAppConfig): (req: Request) => Promise<Response> {
  const api: Api = {
    base: (cfg.apiBase ?? "https://api.github.com").replace(/\/+$/, ""),
    fetch: cfg.fetch ?? globalThis.fetch,
    userAgent: cfg.userAgent ?? "agentsmd-lint-app",
  };
  const now = cfg.now ?? (() => Math.floor(Date.now() / 1000));

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
    const body = await req.text();
    const valid = await verifyWebhookSignature(
      cfg.webhookSecret,
      body,
      req.headers.get("x-hub-signature-256"),
    );
    if (!valid) return json({ ok: false, error: "bad signature" }, 401);

    const event = req.headers.get("x-github-event") ?? "";
    if (event === "ping") return json({ ok: true, ignored: "ping" });
    if (event !== "pull_request") return json({ ok: true, ignored: event }, 202);

    let payload: PullRequestEvent;
    try {
      payload = JSON.parse(body) as PullRequestEvent;
    } catch {
      return json({ ok: false, error: "invalid JSON" }, 400);
    }
    const action = payload.action ?? "";
    if (!HANDLED_ACTIONS.has(action))
      return json({ ok: true, ignored: `pull_request.${action}` }, 202);
    if (payload.pull_request?.draft && action !== "ready_for_review") {
      return json({ ok: true, ignored: "draft" }, 202);
    }
    const installationId = payload.installation?.id;
    const baseRepo = payload.repository?.full_name;
    const number = payload.pull_request?.number;
    const sha = payload.pull_request?.head?.sha;
    const headRepo = payload.pull_request?.head?.repo?.full_name ?? baseRepo;
    if (!installationId || !baseRepo || !number || !sha || !headRepo) {
      return json(
        { ok: false, error: "payload missing installation/repository/pull_request fields" },
        400,
      );
    }

    try {
      const jwt = await signAppJwt(cfg.appId, cfg.privateKeyPem, now());
      const tokenRes = await gh<{ token: string }>(
        api,
        jwt,
        "POST",
        `/app/installations/${installationId}/access_tokens`,
        {},
      );
      const token = tokenRes.data.token;

      const { reader, truncated } = await githubReader(api, token, headRepo, sha);
      const disable: RuleId[] = truncated ? ["dead-path"] : [];
      const report = await lint(reader, { root: `${headRepo}@${sha.slice(0, 7)}`, disable });
      const markdown = formatMarkdown(report, {
        badgeUrl: badgeUrl(report.score, cfg.badgeUrlBase),
      });

      const comments = await gh<{ id: number; body?: string }[]>(
        api,
        token,
        "GET",
        `/repos/${baseRepo}/issues/${number}/comments?per_page=100`,
      );
      const mine = comments.data.find(
        (c) => typeof c.body === "string" && c.body.includes(COMMENT_MARKER),
      );
      let comment: WebhookResult["comment"];
      if (mine) {
        await gh(api, token, "PATCH", `/repos/${baseRepo}/issues/comments/${mine.id}`, {
          body: markdown,
        });
        comment = "updated";
      } else {
        await gh(api, token, "POST", `/repos/${baseRepo}/issues/${number}/comments`, {
          body: markdown,
        });
        comment = "created";
      }
      return json({
        ok: true,
        score: report.score.value,
        findings: report.findings.length,
        comment,
      });
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  };
}

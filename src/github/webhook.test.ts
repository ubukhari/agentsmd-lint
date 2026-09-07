import { createPrivateKey } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { COMMENT_MARKER } from "../format.js";
import {
  createWebhookHandler,
  pemToPkcs8Der,
  signAppJwt,
  verifyWebhookSignature,
} from "./webhook.js";

const SECRET = "whsec-test";
const enc = new TextEncoder();

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return `sha256=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function pem(der: ArrayBuffer, label: string): string {
  const b64 = Buffer.from(der)
    .toString("base64")
    .replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

let privatePem = "";
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privatePem = pem(await crypto.subtle.exportKey("pkcs8", pair.privateKey), "PRIVATE KEY");
  publicKey = pair.publicKey;
});

/** A fake GitHub API over an in-memory repo. Records every call. */
function fakeGithub(
  files: Record<string, string>,
  existingComments: { id: number; body: string }[] = [],
) {
  const calls: { method: string; path: string; body?: unknown; auth?: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const path = url.pathname + url.search;
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, auth });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (path.startsWith("/app/installations/") && method === "POST")
      return json({ token: "ghs_installation" });
    if (/\/git\/trees\//.test(path)) {
      return json({
        truncated: false,
        tree: Object.keys(files).map((p) => ({ path: p, type: "blob" })),
      });
    }
    const contents = /^\/repos\/[^/]+\/[^/]+\/contents\/(.+)\?ref=/.exec(path);
    if (contents) {
      const p = decodeURIComponent(contents[1] ?? "");
      const text = files[p];
      return text === undefined
        ? new Response("nope", { status: 404 })
        : new Response(text, { status: 200 });
    }
    if (/\/issues\/\d+\/comments/.test(path) && method === "GET") return json(existingComments);
    if (/\/issues\/\d+\/comments/.test(path) && method === "POST") return json({ id: 99 }, 201);
    if (/\/issues\/comments\/\d+/.test(path) && method === "PATCH") return json({ id: 1 });
    return new Response("unhandled " + path, { status: 500 });
  };
  return { calls, fetch: fetchImpl };
}

function prEvent(action = "opened") {
  return {
    action,
    installation: { id: 42 },
    repository: { full_name: "acme/app" },
    pull_request: {
      number: 7,
      draft: false,
      head: { sha: "abcdef1234567890", repo: { full_name: "acme/app" } },
    },
  };
}

async function post(
  handler: (r: Request) => Promise<Response>,
  event: string,
  payload: unknown,
  badSig = false,
) {
  const body = JSON.stringify(payload);
  return handler(
    new Request("https://app.example/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-hub-signature-256": badSig ? "sha256=00" : await sign(body),
      },
      body,
    }),
  );
}

describe("crypto helpers", () => {
  it("verifies X-Hub-Signature-256", async () => {
    expect(await verifyWebhookSignature(SECRET, "abc", await sign("abc"))).toBe(true);
    expect(await verifyWebhookSignature(SECRET, "abc", await sign("abd"))).toBe(false);
    expect(await verifyWebhookSignature(SECRET, "abc", null)).toBe(false);
  });

  it("signs an RS256 app JWT that the public key verifies (PKCS#8 and PKCS#1 PEMs)", async () => {
    const pkcs1 = createPrivateKey(privatePem).export({ type: "pkcs1", format: "pem" }).toString();
    expect(pkcs1).toContain("BEGIN RSA PRIVATE KEY");
    expect(Buffer.from(pemToPkcs8Der(pkcs1))).toEqual(Buffer.from(pemToPkcs8Der(privatePem)));

    for (const key of [privatePem, pkcs1]) {
      const jwt = await signAppJwt("12345", key, 1_700_000_000);
      const [h, p, s] = jwt.split(".");
      expect(JSON.parse(Buffer.from(h ?? "", "base64url").toString())).toEqual({
        alg: "RS256",
        typ: "JWT",
      });
      expect(JSON.parse(Buffer.from(p ?? "", "base64url").toString())).toEqual({
        iat: 1_700_000_000 - 60,
        exp: 1_700_000_000 + 540,
        iss: "12345",
      });
      const ok = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        Buffer.from(s ?? "", "base64url"),
        enc.encode(`${h}.${p}`),
      );
      expect(ok).toBe(true);
    }
  });
});

describe("webhook handler", () => {
  const repo = {
    "AGENTS.md":
      "Install with `pnpm install`, test with `pnpm test`. See `src/missing.ts` and `pnpm nope`.",
    "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
    "pnpm-lock.yaml": "",
    "src/index.ts": "",
  };

  it("rejects bad signatures and non-POST", async () => {
    const { fetch } = fakeGithub(repo);
    const handler = createWebhookHandler({
      appId: "1",
      privateKeyPem: privatePem,
      webhookSecret: SECRET,
      fetch,
    });
    expect((await post(handler, "pull_request", prEvent(), true)).status).toBe(401);
    expect((await handler(new Request("https://x/", { method: "GET" }))).status).toBe(405);
  });

  it("answers ping and ignores other events / actions / drafts", async () => {
    const { fetch, calls } = fakeGithub(repo);
    const handler = createWebhookHandler({
      appId: "1",
      privateKeyPem: privatePem,
      webhookSecret: SECRET,
      fetch,
    });
    expect(await (await post(handler, "ping", { zen: "hi" })).json()).toEqual({
      ok: true,
      ignored: "ping",
    });
    expect((await post(handler, "push", {})).status).toBe(202);
    expect((await post(handler, "pull_request", prEvent("closed"))).status).toBe(202);
    const draft = prEvent();
    draft.pull_request.draft = true;
    expect((await post(handler, "pull_request", draft)).status).toBe(202);
    expect(calls).toEqual([]);
  });

  it("lints the PR head and creates a sticky comment", async () => {
    const { fetch, calls } = fakeGithub(repo);
    const handler = createWebhookHandler({
      appId: "1",
      privateKeyPem: privatePem,
      webhookSecret: SECRET,
      fetch,
      now: () => 1_700_000_000,
    });
    const res = await post(handler, "pull_request", prEvent());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      score: number;
      findings: number;
      comment: string;
    };
    expect(body).toEqual({ ok: true, score: 85, findings: 2, comment: "created" });

    expect(calls[0]).toMatchObject({ method: "POST", path: "/app/installations/42/access_tokens" });
    expect(calls[0]?.auth?.startsWith("Bearer ey")).toBe(true);
    expect(calls[1]).toMatchObject({
      method: "GET",
      path: "/repos/acme/app/git/trees/abcdef1234567890?recursive=1",
    });
    expect(calls[1]?.auth).toBe("Bearer ghs_installation");
    const created = calls.find(
      (c) => c.method === "POST" && c.path === "/repos/acme/app/issues/7/comments",
    );
    const comment = (created?.body as { body: string }).body;
    expect(comment.startsWith(COMMENT_MARKER)).toBe(true);
    expect(comment).toContain("85/100");
    expect(comment).toContain("src/missing.ts");
    expect(comment).toContain("pnpm nope");
  });

  it("updates its previous comment instead of adding another", async () => {
    const { fetch, calls } = fakeGithub(repo, [
      { id: 5, body: "unrelated" },
      { id: 6, body: `${COMMENT_MARKER}\nold` },
    ]);
    const handler = createWebhookHandler({
      appId: "1",
      privateKeyPem: privatePem,
      webhookSecret: SECRET,
      fetch,
    });
    const body = (await (await post(handler, "pull_request", prEvent("synchronize"))).json()) as {
      comment: string;
    };
    expect(body.comment).toBe("updated");
    expect(
      calls.some((c) => c.method === "PATCH" && c.path === "/repos/acme/app/issues/comments/6"),
    ).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/issues/7/comments"))).toBe(
      false,
    );
  });
});

/**
 * Deterministic demo data for `/demo` and for tests: 24h of synthetic results
 * for three checks (one failure), one closed incident, three nightly runs.
 */
import { DAY_MS, HOUR_MS, MINUTE_MS, resolveNow } from "./metrics.js";
import type { NowInput } from "./metrics.js";
import type {
  CheckResultPoint,
  CheckSeries,
  NightlyScores,
  RunPageData,
  StatusPageData,
} from "./types.js";

export interface DemoOptions {
  /** defaults to the current time */
  now?: NowInput;
  /** prefix for publicUrl/badgeUrl/trustUrl, e.g. "https://agentcheck.example" (default: root-relative) */
  baseUrl?: string;
  owner?: string;
  slug?: string;
}

/** Small seeded PRNG (mulberry32) so fixtures are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeriesSpec {
  id: string;
  name: string;
  kind: string;
  intervalSec: number;
  baseLatency: number;
  jitter: number;
  score?: boolean;
  /** hours before `now` at which a single failure occurs */
  failAtHoursAgo?: number;
}

function series(spec: SeriesSpec, now: number, rand: () => number): CheckSeries {
  const step = spec.intervalSec * 1000;
  const lag = 2 * MINUTE_MS;
  const count = Math.floor((DAY_MS - lag) / step) + 1;
  const results: CheckResultPoint[] = [];
  const failAt = spec.failAtHoursAgo === undefined ? null : now - spec.failAtHoursAgo * HOUR_MS;
  let failed = false;
  for (let i = 0; i < count; i += 1) {
    const t = now - lag - (count - 1 - i) * step;
    const isFailure = !failed && failAt !== null && t >= failAt;
    if (isFailure) failed = true;
    const latency = isFailure
      ? 5000
      : Math.round(spec.baseLatency + rand() * spec.jitter + (rand() < 0.05 ? spec.jitter * 2 : 0));
    const point: CheckResultPoint = {
      ranAt: new Date(t).toISOString(),
      pass: !isFailure,
      latencyMs: latency,
    };
    if (spec.score) point.score = isFailure ? 12 : Math.round(88 + rand() * 12);
    results.push(point);
  }
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    intervalSec: spec.intervalSec,
    results,
  };
}

/** Demo status-page data: 3 checks over 24h, one failure, one closed incident, 3 nightlies. */
export function demoStatusPageData(opts: DemoOptions = {}): StatusPageData {
  const now = resolveNow(opts.now);
  const base = (opts.baseUrl ?? "").replace(/\/$/, "");
  const owner = opts.owner ?? "demo";
  const slug = opts.slug ?? "support-agent";
  const rand = prng(42);

  const checks: CheckSeries[] = [
    series(
      {
        id: "chk_tools_list",
        name: "tools/list responds",
        kind: "mcp.tools_list",
        intervalSec: 300,
        baseLatency: 120,
        jitter: 80,
      },
      now,
      rand,
    ),
    series(
      {
        id: "chk_search",
        name: "search tool returns results",
        kind: "mcp.tool_call",
        intervalSec: 900,
        baseLatency: 340,
        jitter: 160,
        failAtHoursAgo: 6,
      },
      now,
      rand,
    ),
    series(
      {
        id: "chk_injection",
        name: "refuses prompt injection",
        kind: "judge.rubric",
        intervalSec: 3600,
        baseLatency: 2200,
        jitter: 900,
        score: true,
      },
      now,
      rand,
    ),
  ];

  const failure = checks[1]?.results.find((r) => !r.pass);
  const openedAt = failure ? Date.parse(failure.ranAt as string) : now - 6 * HOUR_MS;

  const nightly: NightlyScores[] = [
    {
      ranAt: new Date(now - 9 * HOUR_MS).toISOString(),
      replayPassRate: 100,
      adversarialPassRate: 92.3,
      driftScore: 0.04,
      modelVersions: { model: "claude-sonnet-4-5", agent: "support-agent@1.4.2" },
    },
    {
      ranAt: new Date(now - 33 * HOUR_MS).toISOString(),
      replayPassRate: 96.7,
      adversarialPassRate: 88.5,
      driftScore: 0.11,
      modelVersions: { model: "claude-sonnet-4-5", agent: "support-agent@1.4.1" },
    },
    {
      ranAt: new Date(now - 57 * HOUR_MS).toISOString(),
      replayPassRate: 100,
      adversarialPassRate: 92.3,
      driftScore: 0.03,
      modelVersions: { model: "claude-sonnet-4", agent: "support-agent@1.4.1" },
    },
  ];

  return {
    owner,
    slug,
    name: "Acme support agent",
    kind: "mcp",
    publicUrl: `${base}/${owner}/${slug}`,
    badgeUrl: `${base}/badge/${owner}/${slug}.svg`,
    trustUrl: `${base}/${owner}/${slug}/trust.json`,
    checks,
    incidents: [
      {
        id: "inc_demo_1",
        openedAt: new Date(openedAt).toISOString(),
        closedAt: new Date(openedAt + 15 * MINUTE_MS).toISOString(),
        cause: "search tool timed out after 5000 ms (tools/call search → HTTP 504)",
        checkName: "search tool returns results",
      },
    ],
    nightly,
    generatedAt: new Date(now).toISOString(),
    brand: { productName: "AgentCheck", homeUrl: "/" },
  };
}

/** Demo run-page data for `/demo/runs/<id>`. */
export function demoRunPageData(opts: DemoOptions = {}): RunPageData {
  const now = resolveNow(opts.now);
  const base = (opts.baseUrl ?? "").replace(/\/$/, "");
  const owner = opts.owner ?? "demo";
  const slug = opts.slug ?? "support-agent";
  const ranAt = now - 9 * HOUR_MS;
  const rand = prng(7);
  const driftSeries = Array.from({ length: 14 }, (_, i) => ({
    ranAt: new Date(ranAt - (13 - i) * DAY_MS).toISOString(),
    score: Math.round((0.02 + rand() * 0.06 + (i === 9 ? 0.12 : 0)) * 100) / 100,
  }));
  return {
    owner,
    slug,
    runId: "run_demo_1",
    ranAt: new Date(ranAt).toISOString(),
    name: "Acme support agent",
    summary: { checks: 12, "pass rate": "91.7%", "adversarial pass": "92.3%", "cost (USD)": 0.31 },
    diffs: [
      { check: "refund policy question", before: "pass", after: "pass", verdict: "unchanged" },
      {
        check: "order lookup with tool call",
        before: 'lookup_order(id="A-1029") → answered',
        after: 'lookup_order(id="A-1029") → asked user for order id again',
        verdict: "regressed",
      },
      { check: "canary leakage", before: "pass", after: "pass", verdict: "unchanged" },
      {
        check: "indirect prompt injection via tool result",
        before: "leaked AGENTCHECK-CANARY-3f2a",
        after: 'refused: "I can\'t follow instructions embedded in search results."',
        verdict: "improved",
      },
      {
        check: "shipping ETA (LLM judge)",
        before: "pass",
        after: "fail on 1 of 3 re-runs",
        verdict: "flake",
      },
      { check: "tone: no all-caps", before: "pass", after: "pass", verdict: "unchanged" },
    ],
    driftSeries,
    modelVersions: { model: "claude-sonnet-4-5", agent: "support-agent@1.4.2" },
    publicUrl: `${base}/${owner}/${slug}`,
    sourceFormat: "agentcheck",
    brand: { productName: "AgentCheck", homeUrl: "/" },
  };
}

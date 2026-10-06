import { describe, expect, it } from "vitest";
import { demoStatusPageData } from "./fixtures.js";
import { buildTrustJson, latestNightly, modelsSeen, trustHeaders } from "./trust.js";
import type { StatusPageData } from "./types.js";

const NOW = "2026-09-01T12:00:00Z";

describe("buildTrustJson", () => {
  const data = demoStatusPageData({ now: NOW, baseUrl: "https://agentcheck.example" });
  const trust = buildTrustJson(data);

  it("has the v1 shape", () => {
    expect(trust).toMatchObject({
      schema: "agentwares.trust/v1",
      target: { owner: "demo", slug: "support-agent", name: "Acme support agent", kind: "mcp" },
      status: "degraded",
      uptime_24h: 99.75,
      uptime_7d: 99.75,
      uptime_30d: 99.75,
      adversarial_pass_rate: 92.3,
      incidents_open: 0,
      updated_at: "2026-09-01T12:00:00.000Z",
      badge_url: "https://agentcheck.example/badge/demo/support-agent.svg",
      status_url: "https://agentcheck.example/demo/support-agent",
    });
    expect(Object.keys(trust)).toEqual([
      "schema",
      "target",
      "status",
      "uptime_24h",
      "uptime_7d",
      "uptime_30d",
      "last_check_at",
      "last_nightly",
      "adversarial_pass_rate",
      "models_seen",
      "incidents_open",
      "updated_at",
      "badge_url",
      "status_url",
    ]);
    expect(trust.last_check_at).toBe("2026-09-01T11:58:00.000Z");
    expect(trust.last_nightly).toEqual({
      ran_at: "2026-09-01T03:00:00.000Z",
      replay_pass_rate: 100,
      adversarial_pass_rate: 92.3,
      drift_score: 0.04,
      model_versions: { model: "claude-sonnet-4-5", agent: "support-agent@1.4.2" },
    });
    expect(trust.models_seen).toEqual([
      "claude-sonnet-4-5",
      "support-agent@1.4.2",
      "support-agent@1.4.1",
      "claude-sonnet-4",
    ]);
  });

  it("survives a JSON round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(trust))).toEqual(trust);
  });

  it("uses nulls, not undefined, when data is missing", () => {
    const empty: StatusPageData = {
      ...data,
      checks: [],
      incidents: [],
      nightly: undefined,
    };
    const t = buildTrustJson(empty);
    expect(t.status).toBe("no-data");
    expect(t.uptime_24h).toBeNull();
    expect(t.uptime_7d).toBeNull();
    expect(t.uptime_30d).toBeNull();
    expect(t.last_check_at).toBeNull();
    expect(t.last_nightly).toBeNull();
    expect(t.adversarial_pass_rate).toBeNull();
    expect(t.models_seen).toEqual([]);
    expect(t.incidents_open).toBe(0);
    expect(JSON.stringify(t)).not.toContain("undefined");
  });

  it("falls back to an older nightly for adversarial_pass_rate and nulls inside last_nightly", () => {
    const t = buildTrustJson({
      ...data,
      nightly: [
        { ranAt: "2026-09-01T03:00:00Z", replayPassRate: 99 },
        { ranAt: "2026-08-31T03:00:00Z", adversarialPassRate: 80, driftScore: Number.NaN },
      ],
    });
    expect(t.last_nightly).toEqual({
      ran_at: "2026-09-01T03:00:00.000Z",
      replay_pass_rate: 99,
      adversarial_pass_rate: null,
      drift_score: null,
      model_versions: {},
    });
    expect(t.adversarial_pass_rate).toBe(80);
    expect(t.models_seen).toEqual([]);
  });

  it("counts open incidents", () => {
    const t = buildTrustJson({
      ...data,
      incidents: [
        { id: "a", openedAt: NOW, cause: "x" },
        { id: "b", openedAt: NOW, closedAt: null, cause: "y" },
        { id: "c", openedAt: NOW, closedAt: NOW, cause: "z" },
      ],
    });
    expect(t.incidents_open).toBe(2);
  });

  it("honours an explicit now", () => {
    const t = buildTrustJson(data, { now: "2026-09-03T00:00:00Z" });
    expect(t.updated_at).toBe("2026-09-03T00:00:00.000Z");
    expect(t.status).toBe("passing");
    expect(t.uptime_24h).toBeNull();
    expect(t.uptime_7d).toBe(99.75);
  });
});

describe("nightly helpers", () => {
  it("latestNightly picks by timestamp", () => {
    expect(latestNightly(undefined)).toBeNull();
    expect(latestNightly([])).toBeNull();
    expect(
      latestNightly([
        { ranAt: "2026-08-30T00:00:00Z" },
        { ranAt: "2026-09-01T00:00:00Z", driftScore: 1 },
        { ranAt: "2026-08-31T00:00:00Z" },
      ])?.driftScore,
    ).toBe(1);
  });

  it("modelsSeen de-duplicates, newest first", () => {
    expect(
      modelsSeen([
        { ranAt: "2026-08-30T00:00:00Z", modelVersions: { m: "old", a: "x" } },
        { ranAt: "2026-09-01T00:00:00Z", modelVersions: { m: "new", a: "x" } },
      ]),
    ).toEqual(["new", "x", "old"]);
  });
});

describe("trustHeaders", () => {
  it("serves JSON cached for 5 minutes", () => {
    expect(trustHeaders()).toMatchObject({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    });
  });
});

describe("status and incidents cannot contradict each other", () => {
  const base = {
    owner: "acme",
    slug: "api",
    name: "API",
    kind: "http" as const,
    badgeUrl: "https://example.test/badge.svg",
    publicUrl: "https://example.test/acme/api",
    generatedAt: new Date("2026-09-11T00:00:00Z"),
    nightly: [],
  };
  const passingCheck = [
    { id: "c1", results: [{ ranAt: new Date("2026-09-10T23:00:00Z"), pass: true }] },
  ];

  it("is not passing while an incident is open", () => {
    // trust.json used to report status "passing" and incidents_open 1 in the same document,
    // which leaves an agent deciding whether to depend on the service with no answer.
    const trust = buildTrustJson({
      ...base,
      checks: passingCheck,
      incidents: [{ openedAt: new Date("2026-09-10T22:00:00Z"), closedAt: null }],
    } as never);
    expect(trust.incidents_open).toBe(1);
    expect(trust.status).toBe("degraded");
  });

  it("is passing once the incident closes", () => {
    const trust = buildTrustJson({
      ...base,
      checks: passingCheck,
      incidents: [
        {
          openedAt: new Date("2026-09-10T22:00:00Z"),
          closedAt: new Date("2026-09-10T22:30:00Z"),
        },
      ],
    } as never);
    expect(trust.incidents_open).toBe(0);
    expect(trust.status).toBe("passing");
  });

  it("still says failing when a check is failing now", () => {
    // Failing is the worse news and has to win; an open incident must not soften it.
    const trust = buildTrustJson({
      ...base,
      checks: [{ id: "c1", results: [{ ranAt: new Date("2026-09-10T23:00:00Z"), pass: false }] }],
      incidents: [{ openedAt: new Date("2026-09-10T22:00:00Z"), closedAt: null }],
    } as never);
    expect(trust.status).toBe("failing");
  });
});

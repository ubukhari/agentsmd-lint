import { describe, expect, it } from "vitest";
import {
  BADGE_COLORS,
  badgeHeaders,
  badgeWidth,
  estimateTextWidth,
  renderBadge,
  renderStatusBadge,
} from "./badge.js";
import { demoStatusPageData } from "./fixtures.js";
import type { BadgeStatus } from "./types.js";

const STATUSES: BadgeStatus[] = ["passing", "failing", "degraded", "unknown", "no-data"];

function widthOf(svg: string): number {
  const m = /<svg[^>]*\swidth="(\d+)"/.exec(svg);
  return Number(m?.[1]);
}

describe("renderBadge", () => {
  it("renders well-formed SVG with xmlns, title and aria-label", () => {
    const svg = renderBadge({ label: "agentcheck", status: "passing" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<title>agentcheck: passing</title>");
    expect(svg).toContain('aria-label="agentcheck: passing"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('height="20"');
  });

  it("makes no external requests (no URLs other than the SVG namespaces)", () => {
    const svg = renderBadge({ label: "agentcheck", status: "passing" });
    const urls = svg.match(/https?:\/\/[^\s"']+/g) ?? [];
    expect(urls.every((u) => u.startsWith("http://www.w3.org/"))).toBe(true);
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("<script");
  });

  it("escapes label and message", () => {
    const svg = renderBadge({ label: "a<b&c", message: '"x" <script>', status: "failing" });
    expect(svg).toContain("a&lt;b&amp;c");
    expect(svg).toContain("&quot;x&quot; &lt;script&gt;");
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("a<b&c");
  });

  it("width grows with text length", () => {
    const short = renderBadge({ label: "build", message: "ok", status: "passing" });
    const long = renderBadge({
      label: "build",
      message: "passing since tuesday",
      status: "passing",
    });
    const longer = renderBadge({
      label: "a much longer label",
      message: "passing since tuesday",
      status: "passing",
    });
    expect(widthOf(short)).toBeGreaterThan(0);
    expect(widthOf(long)).toBeGreaterThan(widthOf(short));
    expect(widthOf(longer)).toBeGreaterThan(widthOf(long));
  });

  it("reports the same width via badgeWidth()", () => {
    expect(badgeWidth("build", "passing")).toBe(
      widthOf(renderBadge({ label: "build", message: "passing", status: "passing" })),
    );
  });

  it.each(STATUSES)("colours the right side for %s", (status) => {
    const svg = renderBadge({ label: "agentcheck", status });
    expect(svg).toContain(`fill="${BADGE_COLORS[status]}"`);
    expect(svg).toContain('fill="#555"');
  });

  it("uses the expected shields colours", () => {
    expect(BADGE_COLORS).toEqual({
      passing: "#4c1",
      failing: "#e05d44",
      degraded: "#dfb317",
      unknown: "#9f9f9f",
      "no-data": "#9f9f9f",
    });
  });

  it("defaults the message from the status", () => {
    expect(renderBadge({ label: "x", status: "no-data" })).toContain(">no data</text>");
    expect(renderBadge({ label: "x", status: "degraded" })).toContain(">degraded</text>");
  });

  it("renders a message-only badge when the label is empty", () => {
    const svg = renderBadge({ label: "", message: "passing", status: "passing" });
    expect(svg).toContain("<title>passing</title>");
    expect(svg).not.toContain('fill="#555"');
    expect(widthOf(svg)).toBe(badgeWidth("", "passing"));
  });

  it("flat-square omits the gradient and rounded clip", () => {
    const flat = renderBadge({ label: "x", status: "passing" });
    const square = renderBadge({ label: "x", status: "passing", style: "flat-square" });
    expect(flat).toContain("<linearGradient");
    expect(flat).toContain('rx="3"');
    expect(square).not.toContain("<linearGradient");
    expect(square).not.toContain('rx="3"');
  });

  it("uses distinct clipPath/gradient ids per badge so inlined badges do not clip each other", () => {
    const a = renderBadge({ label: "agentcheck", status: "passing" });
    const b = renderBadge({ label: "agentcheck", status: "degraded" });
    const idsOf = (svg: string) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(idsOf(a)).toHaveLength(2);
    expect(idsOf(a)).not.toEqual(idsOf(b));
    for (const id of idsOf(a)) expect(a).toContain(`url(#${id})`);
    // deterministic, so cached output is stable
    expect(renderBadge({ label: "agentcheck", status: "passing" })).toBe(a);
  });

  it("estimates wider glyphs as wider", () => {
    expect(estimateTextWidth("mmm")).toBeGreaterThan(estimateTextWidth("iii"));
    expect(estimateTextWidth("")).toBe(0);
    expect(estimateTextWidth("日本")).toBeGreaterThan(0);
  });
});

describe("renderStatusBadge", () => {
  it("derives the status from the checks", () => {
    const data = demoStatusPageData({ now: "2026-09-01T12:00:00Z" });
    const svg = renderStatusBadge(data);
    expect(svg).toContain("<title>Acme support agent: degraded</title>");
    expect(svg).toContain(`fill="${BADGE_COLORS.degraded}"`);
    expect(renderStatusBadge(data, { label: "agentcheck" })).toContain("agentcheck: degraded");
  });
});

describe("badgeHeaders", () => {
  it("serves SVG cached for 5 minutes", () => {
    expect(badgeHeaders()).toEqual({
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    });
  });
});

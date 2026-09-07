/**
 * shields.io-style "flat" badge, rendered to an SVG string with no external
 * fonts or requests. Text widths are estimated from a built-in Verdana 11px
 * width table, the same approach shields uses.
 */
import { escapeXml } from "./escape.js";
import { latestStatus } from "./metrics.js";
import type { NowInput } from "./metrics.js";
import type { BadgeStatus, StatusPageData } from "./types.js";

export type BadgeStyle = "flat" | "flat-square";

export interface RenderBadgeOptions {
  /** left-hand text; empty string renders a message-only badge */
  label: string;
  /** right-hand text; defaults to the status wording */
  message?: string;
  status: BadgeStatus;
  style?: BadgeStyle;
  /** override the right-hand colour (any CSS colour); defaults to the status colour */
  color?: string;
  /** override the left-hand colour; defaults to shields grey */
  labelColor?: string;
}

export const BADGE_HEIGHT = 20;
export const BADGE_LABEL_COLOR = "#555";

export const BADGE_COLORS: Readonly<Record<BadgeStatus, string>> = {
  passing: "#4c1",
  failing: "#e05d44",
  degraded: "#dfb317",
  unknown: "#9f9f9f",
  "no-data": "#9f9f9f",
};

export const STATUS_MESSAGES: Readonly<Record<BadgeStatus, string>> = {
  passing: "passing",
  failing: "failing",
  degraded: "degraded",
  unknown: "unknown",
  "no-data": "no data",
};

/**
 * Advance widths (px) of Verdana at 11px for ASCII 0x20–0x7E, in code-point
 * order: space and punctuation `! " # $ % & ' ( ) * + , - . /`, digits `0-9`,
 * `: ; < = > ? @`, `A-Z`, `[ \ ] ^ _ \``, `a-z`, `{ | } ~`. Non-ASCII characters
 * fall back to FALLBACK_CHAR_WIDTH.
 */
const CHAR_WIDTHS: readonly number[] = [
  3.87, 4.33, 5.05, 9.0, 6.99, 11.84, 7.99, 2.95, 4.99, 4.99, 6.99, 9.0, 4.0, 4.99, 4.0, 4.99, 6.99,
  6.99, 6.99, 6.99, 6.99, 6.99, 6.99, 6.99, 6.99, 6.99, 4.99, 4.99, 9.0, 9.0, 9.0, 5.99, 11.0, 7.52,
  7.54, 7.68, 8.48, 6.96, 6.33, 8.53, 8.27, 4.63, 5.01, 7.62, 6.13, 9.27, 8.23, 8.66, 6.64, 8.66,
  7.65, 7.52, 6.78, 8.05, 7.52, 10.88, 7.54, 6.77, 7.54, 4.99, 4.99, 4.99, 9.0, 6.99, 6.99, 6.61,
  6.85, 5.73, 6.85, 6.55, 3.87, 6.85, 6.96, 3.02, 3.78, 6.51, 3.02, 10.7, 6.96, 6.67, 6.85, 6.85,
  4.69, 5.73, 4.34, 6.96, 6.51, 9.0, 6.51, 6.51, 5.78, 6.98, 4.99, 6.98, 9.0,
];
const FALLBACK_CHAR_WIDTH = 7;
const HORIZONTAL_PADDING = 5;

/** Estimated rendered width of `text` in Verdana 11px. */
export function estimateTextWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32) continue;
    width += CHAR_WIDTHS[code - 32] ?? FALLBACK_CHAR_WIDTH;
  }
  return width;
}

/** shields rounds text widths up to an odd integer so centred text stays crisp. */
function preferredWidth(text: string): number {
  if (text.length === 0) return 0;
  const w = Math.floor(estimateTextWidth(text));
  return w % 2 === 0 ? w + 1 : w;
}

/** Perceived brightness 0–1 of a hex colour (shields' formula); 1 for non-hex. */
function brightness(color: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m || !m[1]) return 0;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 255000;
}

/**
 * Short deterministic id suffix so several badges inlined in one HTML document
 * do not share `clipPath`/`gradient` ids (a shared id would clip every badge to
 * the first one's width).
 */
function idSuffix(...parts: string[]): string {
  let h = 5381;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) h = (h * 33) ^ part.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function textColors(background: string): { text: string; shadow: string } {
  return brightness(background) <= 0.69
    ? { text: "#fff", shadow: "#010101" }
    : { text: "#333", shadow: "#ccc" };
}

/** Total badge width for the given texts (useful for `<img width>`). */
export function badgeWidth(label: string, message: string): number {
  const left = label.length > 0 ? preferredWidth(label) + 2 * HORIZONTAL_PADDING : 0;
  const right = preferredWidth(message) + 2 * HORIZONTAL_PADDING;
  return left + right;
}

/** Render a shields.io-style badge as an SVG string. */
export function renderBadge(opts: RenderBadgeOptions): string {
  const label = opts.label;
  const message = opts.message ?? STATUS_MESSAGES[opts.status];
  const style: BadgeStyle = opts.style ?? "flat";
  const color = opts.color ?? BADGE_COLORS[opts.status];
  const labelColor = opts.labelColor ?? BADGE_LABEL_COLOR;
  const hasLabel = label.length > 0;

  const labelTextWidth = hasLabel ? preferredWidth(label) : 0;
  const messageTextWidth = preferredWidth(message);
  const leftWidth = hasLabel ? labelTextWidth + 2 * HORIZONTAL_PADDING : 0;
  const rightWidth = messageTextWidth + 2 * HORIZONTAL_PADDING;
  const width = leftWidth + rightWidth;
  const h = BADGE_HEIGHT;

  const accessible = hasLabel ? `${label}: ${message}` : message;
  const esc = escapeXml;
  const labelX = Math.round((leftWidth / 2) * 10);
  const messageX = Math.round((leftWidth + rightWidth / 2) * 10);
  const labelText = textColors(labelColor);
  const messageText = textColors(color);
  const rounded = style === "flat";
  const uid = idSuffix(label, message, color, labelColor);
  const gradientId = `s${uid}`;
  const clipId = `r${uid}`;

  const gradient = rounded
    ? `<linearGradient id="${gradientId}" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`
    : "";
  const clip = rounded
    ? `<clipPath id="${clipId}"><rect width="${width}" height="${h}" rx="3" fill="#fff"/></clipPath>`
    : "";
  const shine = rounded ? `<rect width="${width}" height="${h}" fill="url(#${gradientId})"/>` : "";
  const groupOpen = rounded ? `<g clip-path="url(#${clipId})">` : `<g>`;

  const labelTexts = hasLabel
    ? `<text aria-hidden="true" x="${labelX}" y="150" fill="${esc(labelText.shadow)}" fill-opacity=".3" transform="scale(.1)" textLength="${labelTextWidth * 10}">${esc(label)}</text><text x="${labelX}" y="140" transform="scale(.1)" fill="${esc(labelText.text)}" textLength="${labelTextWidth * 10}">${esc(label)}</text>`
    : "";
  const messageTexts = `<text aria-hidden="true" x="${messageX}" y="150" fill="${esc(messageText.shadow)}" fill-opacity=".3" transform="scale(.1)" textLength="${messageTextWidth * 10}">${esc(message)}</text><text x="${messageX}" y="140" transform="scale(.1)" fill="${esc(messageText.text)}" textLength="${messageTextWidth * 10}">${esc(message)}</text>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${h}" role="img" aria-label="${esc(accessible)}">` +
    `<title>${esc(accessible)}</title>` +
    gradient +
    clip +
    groupOpen +
    (hasLabel ? `<rect width="${leftWidth}" height="${h}" fill="${esc(labelColor)}"/>` : "") +
    `<rect x="${leftWidth}" width="${rightWidth}" height="${h}" fill="${esc(color)}"/>` +
    shine +
    `</g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">` +
    labelTexts +
    messageTexts +
    `</g></svg>`
  );
}

export interface StatusBadgeOptions {
  /** defaults to the target name */
  label?: string;
  /** defaults to the status wording */
  message?: string;
  style?: BadgeStyle;
  /** defaults to `data.generatedAt` */
  now?: NowInput;
}

/** Badge for a target: status derived from its checks. */
export function renderStatusBadge(data: StatusPageData, opts: StatusBadgeOptions = {}): string {
  const status = latestStatus(data.checks, opts.now ?? data.generatedAt);
  return renderBadge({
    label: opts.label ?? data.name,
    message: opts.message,
    status,
    style: opts.style,
  });
}

/** Headers for serving the badge: SVG, cached 5 minutes at the edge and in browsers. */
export function badgeHeaders(): Record<string, string> {
  return {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };
}

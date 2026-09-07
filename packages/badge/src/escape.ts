/** HTML/SVG escaping. Every user-provided string goes through one of these. */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for use in HTML text nodes and quoted attributes. */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Same five entities are valid XML, so SVG uses the same function. */
export const escapeXml = escapeHtml;

/**
 * Escape a URL for `href`/`src`. Only http(s), protocol-relative and
 * root/fragment-relative URLs are allowed; anything else (javascript:, data:,
 * backslash tricks) becomes `#`.
 */
export function safeUrl(url: string | null | undefined): string {
  if (!url) return "#";
  const trimmed = url.trim();
  if (trimmed.includes("\\")) return "#";
  if (/^https?:\/\//i.test(trimmed) || /^\/\/[^/]/.test(trimmed) || /^[/#.?]/.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return "#";
}

/**
 * TinyMCE renders HTML and ignores raw "\n", so legacy plain-text notes
 * collapse into one paragraph. If content has NO HTML tags, treat it as
 * legacy plain text: HTML-escape it, then convert newlines to <br>.
 * Real rich-text content (any tag) passes through untouched.
 */
export function noteContentToHtml(content: string): string {
  if (!content) return "";
  if (/<[a-z][a-z0-9]*(\s|>|\/)/i.test(content)) return content; // already HTML
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * Strip HTML tags + decode the few entities TinyMCE emits, for plain-text
 * search over rich note content. Not for rendering — search/preview only.
 */
export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

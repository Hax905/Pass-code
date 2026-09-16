/**
 * Only allows redirects to paths on this site. Rejects absolute URLs and
 * protocol-relative ones like `//evil.example` or `/\evil.example`.
 */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : fallback;
}

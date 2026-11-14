/**
 * Where to go after signing in: only a path on this site. `next` comes from a query string or a form field, so it is
 * attacker-controlled. A plain prefix check ("starts with / but not //") is not enough: browsers strip tabs and
 * newlines from URLs and treat "\" like "/", so "/\t/evil.example" or "/\evil.example" would leave the site. Pure.
 */
export function sameSitePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  // No control characters, spaces-as-control, or backslashes anywhere.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  if (value.startsWith("//")) return null;
  try {
    const base = "https://same-site.invalid";
    const url = new URL(value, base);
    return url.origin === base ? value : null;
  } catch {
    return null;
  }
}

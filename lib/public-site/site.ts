/** The public site's address and wording shared by the landing page, Learn metadata, robots.txt and the sitemap. */

export const SITE_NAME = "DearPolicy";
export const SITE_DESCRIPTION =
  "Upload your family's insurance documents, link each one to the right person, and ask plain questions. Answers show the page they came from.";

/** The address search engines and shared links should use. NEXT_PUBLIC_SITE_URL wins (set it when a custom domain is
 * wired up); then Vercel's production domain; then the current Vercel address. Never ends with a slash. */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const pick = (v?: string) => v?.trim() || "";
  const explicit = pick(env.NEXT_PUBLIC_SITE_URL);
  const vercel = pick(env.VERCEL_PROJECT_PRODUCTION_URL);
  const raw = explicit || (vercel ? `https://${vercel}` : "https://dearpolicy-mvp.vercel.app");
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return "https://dearpolicy-mvp.vercel.app";
  }
}

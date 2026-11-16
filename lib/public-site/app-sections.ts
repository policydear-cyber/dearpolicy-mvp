/** The first path segment of every page in app/ (scripts/public-site/auth-boundary-test.ts keeps this list in step
 * with the folders on disk). A signed-out visit under one of these goes to sign-in as before; any other address
 * names no page at all, so middleware lets it through to the ordinary "page not found" instead of asking the
 * visitor to sign in for a page that doesn't exist. Nothing under /api/ is ever decided by this list. */
export const APP_SECTIONS: ReadonlySet<string> = new Set([
  "chat", "claims", "coverage", "family", "household", "invite", "learn", "ledger", "login", "operator", "policies",
  "privacy", "records", "reset-password", "reviewer", "schedule", "signup", "update-password", "usage", "welcome",
]);

export function isAppSection(pathname: string): boolean {
  const first = pathname.split("/")[1] ?? "";
  // Case and encoding are not normalised: "/Policies" or "/%70olicies" is not a page either, and Next.js answers
  // those with "page not found" too, so letting them through opens nothing.
  return APP_SECTIONS.has(first);
}

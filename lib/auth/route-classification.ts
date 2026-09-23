/**
 * The fixed vocabulary every app/api/**\/route.ts must classify itself
 * with, via a top-level `export const ROUTE_AUTH = "..." as const;`
 * statement. scripts/route-inventory-regressions.ts statically scans every
 * route file for this export and fails the moment a new route is added
 * without one -- so "what does this endpoint require?" is always answered
 * in the file itself, not left to be inferred from what it happens to do
 * with the identity it's given.
 *
 *  - "public": no authentication required (signup/signin/health/etc).
 *  - "authenticated": any signed-in user, no household membership implied
 *    (signout, update-password -- acting on the caller's own session).
 *  - "household-member": signed-in AND a current member of the household
 *    being acted on (the large majority of the app's data routes).
 *  - "household-owner": signed-in AND the owner of the household being
 *    acted on (membership management, household deletion/rename).
 *  - "internal": not reachable from a browser session at all -- a job
 *    runner or webhook, authorized by its own mechanism (a signed
 *    webhook secret, an internal-only network boundary), never a user
 *    session or household membership check.
 */
export const ROUTE_AUTH_VALUES = ["public", "authenticated", "household-member", "household-owner", "internal"] as const;

export type RouteAuthValue = (typeof ROUTE_AUTH_VALUES)[number];

/**
 * The one place every protected API route should resolve "who is making
 * this request, and which household are they acting as" -- replacing the
 * client-controlled/fixed-dev-account pattern (lib/db/client.ts's
 * devAccountId()) route-by-route as each route migrates (see the "API
 * authorization audit" section of the PR description for the full
 * inventory and migration status).
 *
 * A route handler that needs a signed-in household member should do:
 *
 *   export async function GET(request: NextRequest) {
 *     const ctx = await requireHouseholdContext(request);
 *     // ctx.userId, ctx.householdId are both server-resolved -- NEVER take
 *     // either from a client-supplied body/query/header field.
 *     return createUserSupabaseClient(ctx.userId, async (client) => { ... });
 *   }
 *
 * and catch failures with routeErrorResponse() (below) so every route
 * returns the same shape of 401/403/404 for the same failure, rather than
 * each route inventing its own.
 *
 * ## Why this takes a NextRequest instead of reading next/headers' cookies()
 *
 * next/headers' cookies() only works inside Next's own App Router request
 * dispatch (it reads an AsyncLocalStorage-backed "work unit store" that
 * Next itself sets up around a Route Handler invocation) -- calling it from
 * anywhere else, including a script that imports a route handler's
 * exported GET/POST and calls it directly the way an HTTP-level regression
 * suite needs to, throws "`cookies` was called outside a request scope".
 * NextRequest (what Next.js actually passes as a Route Handler's first
 * argument at runtime, real HTTP request or not) exposes the same Cookie
 * header directly via its own `.cookies` reader, with no ambient storage
 * required -- so reading the household-selection cookie from the request
 * object a route handler already receives, instead of from next/headers,
 * is what makes these routes callable both by real HTTP traffic and by a
 * script that constructs its own NextRequest.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthenticatedError, StaleAuthenticationError, type SessionUser } from "@/lib/auth/session";
import { recordErrorEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { resolveActiveHouseholdId, ForbiddenError, NotFoundError, ConflictError, NotHouseholdOwnerError } from "@/lib/household/repo";

/** The active-household cookie set by POST /api/household/switch. Plain
 * (non-httpOnly) is fine -- it names which household the UI is currently
 * showing, not a credential; resolveActiveHouseholdId() below always
 * re-verifies real membership server-side before trusting it, so a forged
 * or stale cookie value can, at worst, fall back to the caller's own first
 * household, never grant access to someone else's. */
export const ACTIVE_HOUSEHOLD_COOKIE = "dp_household";

export class NoHouseholdError extends Error {}

export type HouseholdContext = { userId: string; householdId: string; user: SessionUser };

/** Resolves the signed-in user and their active household for this
 * request, in one call, every protected route can rely on:
 *  1. Authenticates (throws UnauthenticatedError if not signed in).
 *  2. Reads the requested household id from the request's own cookie --
 *     NEVER from a body, query string, or header, which a client could set
 *     to any value.
 *  3. Verifies the caller is a genuine current member of that household
 *     (resolveActiveHouseholdId() re-checks membership server-side on
 *     every call; a removed or never-a-member caller cannot use a stale
 *     cookie to keep pointing at a household they don't belong to).
 *  4. Falls back to the caller's own oldest household if the cookie is
 *     missing/stale, or throws NoHouseholdError if they have none. */
export async function requireHouseholdContext(request: NextRequest): Promise<HouseholdContext> {
  const user = await requireCurrentUser();
  const requested = request.cookies.get(ACTIVE_HOUSEHOLD_COOKIE)?.value ?? null;
  const householdId = await resolveActiveHouseholdId(user.id, requested);
  if (!householdId) {
    throw new NoHouseholdError("This account has no household yet.");
  }
  return { userId: user.id, householdId, user };
}

/** Maps every error class the authorization/household layer can throw to
 * the response a route should return. A foreign or forbidden object and a
 * genuinely missing one deliberately produce the SAME 404 here (per the
 * "return indistinguishable not-found/unauthorized responses for foreign
 * objects" requirement) -- callers must not use ForbiddenError to leak
 * that an object exists but belongs to someone else.
 *
 * Anything NOT one of the recognized authorization/household error classes
 * (a database connectivity failure, an unexpected driver error, a bug) is
 * deliberately NOT rethrown here: every other route in this codebase
 * returns a generic `{ error: "Database error" }, 500` JSON body for an
 * unexpected failure, and this is the single place that convention is
 * defined for every route built on requireHouseholdContext(). Rethrowing
 * would hand the error to Next.js's default Route Handler error boundary,
 * which returns an HTML error page (or, in some configurations, a raw
 * stack trace) instead of the JSON body every API consumer expects --
 * exactly the "never record ... raw stack traces in client responses"
 * requirement this repo is building toward for observability. The real
 * error is still whatever the caller's own logging/observability layer
 * captures upstream of this function; this function only decides what the
 * HTTP response looks like. */
/** Checkpoint 9: the optional second argument lets a route pass its own
 * request/route name through so the resulting event is attributable
 * (`route`) and correlated (`correlationId`, resolved from the incoming
 * `x-correlation-id` header under lib/telemetry/correlation.ts's strict
 * rule -- the same value middleware.ts independently resolves and returns
 * in every response header, so a caller can match the two up even though
 * they're computed twice on the request's way through). Both existing and
 * new call sites work: `routeErrorResponse(error)` alone still returns
 * the exact same response body/status as before -- this is additive
 * telemetry, never a change to what a client receives. Recording is
 * fire-and-forget (never awaited): recordErrorEvent() is itself failure-
 * isolated and time-bounded (lib/telemetry/index.ts), so this can never
 * slow down or fail the actual HTTP response. */
export function routeErrorResponse(error: unknown, context: { request?: NextRequest; route?: string } = {}): NextResponse {
  const correlationId = resolveCorrelationId(context.request?.headers.get("x-correlation-id"));
  void recordErrorEvent({ name: "route.error", correlationId, route: context.route ?? context.request?.nextUrl?.pathname ?? null, error });

  if (error instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (error instanceof StaleAuthenticationError) {
    return NextResponse.json({ error: "Please sign in again to confirm it's you before continuing." }, { status: 401 });
  }
  if (error instanceof NoHouseholdError) {
    return NextResponse.json({ error: "No household" }, { status: 404 });
  }
  if (error instanceof ForbiddenError || error instanceof NotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (error instanceof NotHouseholdOwnerError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ error: "Database error" }, { status: 500 });
}

/**
 * Static audit, not a live-request test: every app/api/**\/route.ts must
 * declare `export const ROUTE_AUTH = "..." as const;` (see
 * lib/auth/route-classification.ts for the vocabulary). This is
 * deliberately a source-text scan rather than a dynamic import of each
 * route module -- importing 40 Route Handler modules (several of which
 * construct rate limiters, AI provider clients, and Pinecone/DB clients at
 * module scope) would require a fully configured environment to even load
 * without throwing, which is exactly the kind of environment-shaped
 * flakiness a source-level classification check should NOT depend on. What
 * this proves is real: every route file textually carries an explicit,
 * valid classification, and a newly added route with none is caught here,
 * every run, with no environment required.
 *
 * This is intentionally NOT a proof that a route's *implementation*
 * matches its declared classification in full (e.g. that a
 * "household-owner" route actually enforces owner-only access at the
 * Postgres RLS level, or that a household-member route's business logic
 * is scoped correctly) -- that is what each route's own request-level
 * tests, and scripts/authz-http-regressions.ts's HTTP-level scenarios
 * against the shared requireHouseholdContext()/routeErrorResponse()
 * mechanism, are for. This file adds two narrower, still purely
 * source-text checks that ARE reliable at this level and catch a real
 * mistake at review/CI time rather than only in a runtime test:
 *
 *  1. Every "household-member" or "household-owner" route must actually
 *     call requireHouseholdContext() somewhere in its source -- a route
 *     that declares itself household-scoped but never resolves a
 *     household id is very likely still reading identity from a
 *     client-supplied field, a leftover devAccountId() (already banned
 *     separately by scripts/import-boundary-regressions.ts), or nothing
 *     at all.
 *
 *  2. A "public" route must never call requireHouseholdContext() at all
 *     (there is no household to require before anyone is authenticated),
 *     and if it imports from lib/household/repo -- the household
 *     repository, whose other functions all assume the caller is already
 *     a verified member -- the ONLY name it may import from there is
 *     ensureDefaultHousehold(), the one function in that module designed
 *     to run before any household_members row exists (see its own doc
 *     comment). Today that is exactly what app/api/auth/{signup,signin,
 *     callback}/route.ts do (provisioning a brand-new user's first
 *     household), and nothing else -- this check locks that specific,
 *     narrow exception in by name rather than allowing "public route
 *     touches household data" in general.
 *
 *  3. Internal-reviewer routes. Every "internal-reviewer" route must call
 *     the central reviewer boundary (requireAssignedClaimReviewer() or
 *     requireActiveClaimReviewer() from lib/claims/reviewers/boundary.ts)
 *     and must never call requireHouseholdContext() -- reviewer access
 *     comes from an assignment, never household membership. Conversely,
 *     every route under app/api/reviewer/ and every route that records a
 *     policy-definition decision (confirm*Match / recordReviewerDefinition
 *     Decision) must be classified "internal-reviewer", so no household
 *     route can quietly regain the ability to record one.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ROUTE_AUTH_VALUES } from "../lib/auth/route-classification";

async function findRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findRouteFiles(full)));
    } else if (entry.name === "route.ts") {
      files.push(full);
    }
  }
  return files;
}

const CLASSIFICATION_PATTERN = /export const ROUTE_AUTH\s*=\s*"([a-z-]+)"\s*as const\s*;/;
const HOUSEHOLD_REPO_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\/lib\/household\/repo["']/g;

export interface RouteInventoryResult {
  routeFiles: string[];
  unclassified: string[];
  invalid: { file: string; value: string }[];
  byClass: Record<string, number>;
  missingHouseholdContext: string[];
  publicRouteViolations: { file: string; reason: string }[];
  reviewerRouteViolations: { file: string; reason: string }[];
}

/** The classification scan itself, with no assertions and no console
 * output -- exported so scripts/launch-check.ts can run the exact same
 * scan and report its own result, rather than re-implementing the regex
 * logic a second time or shelling out to this script as a subprocess.
 * main() below is the only other caller, and turns this result into the
 * hard assert()s this file is run as a regression suite for. */
export async function classifyRoutes(): Promise<RouteInventoryResult> {
  const apiDir = path.resolve("app/api");
  const routeFiles = await findRouteFiles(apiDir);

  const unclassified: string[] = [];
  const invalid: { file: string; value: string }[] = [];
  const byClass: Record<string, number> = {};
  const missingHouseholdContext: string[] = [];
  const publicRouteViolations: { file: string; reason: string }[] = [];
  const reviewerRouteViolations: { file: string; reason: string }[] = [];

  for (const file of routeFiles) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(process.cwd(), file);
    const match = text.match(CLASSIFICATION_PATTERN);
    if (!match) {
      unclassified.push(relative);
      continue;
    }
    const value = match[1];
    if (!(ROUTE_AUTH_VALUES as readonly string[]).includes(value)) {
      invalid.push({ file: relative, value });
      continue;
    }
    byClass[value] = (byClass[value] ?? 0) + 1;

    const callsRequireHouseholdContext = /requireHouseholdContext\s*\(/.test(text);
    const callsReviewerBoundary = /\b(requireAssignedClaimReviewer|requireActiveClaimReviewer)\s*\(/.test(text);
    const recordsDefinitionDecision = /\b(confirmCauseDefinitionMatch|confirmCIDefinitionMatch|confirmDisabilityDefinitionMatch|confirmTravelDeathMatch|recordReviewerDefinitionDecision)\s*\(/.test(text);

    if (value === "internal-reviewer") {
      if (!callsReviewerBoundary) reviewerRouteViolations.push({ file: relative, reason: "is internal-reviewer but never calls requireAssignedClaimReviewer()/requireActiveClaimReviewer()" });
      if (callsRequireHouseholdContext) reviewerRouteViolations.push({ file: relative, reason: "is internal-reviewer but calls requireHouseholdContext() -- reviewer access must never come from household membership" });
    } else {
      if (/^app\/api\/reviewer\//.test(relative.split(path.sep).join("/"))) reviewerRouteViolations.push({ file: relative, reason: `is under app/api/reviewer/ but classified "${value}" instead of "internal-reviewer"` });
      if (recordsDefinitionDecision) reviewerRouteViolations.push({ file: relative, reason: `records a policy-definition decision but is classified "${value}" instead of "internal-reviewer"` });
    }

    if (value === "household-member" || value === "household-owner") {
      if (!callsRequireHouseholdContext) missingHouseholdContext.push(relative);
    }

    if (value === "public") {
      if (callsRequireHouseholdContext) {
        publicRouteViolations.push({ file: relative, reason: "calls requireHouseholdContext(), which a public (pre-authentication) route should never need" });
      }
      for (const importMatch of text.matchAll(HOUSEHOLD_REPO_IMPORT)) {
        const names = importMatch[1]
          .split(",")
          .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
          .filter(Boolean);
        const disallowed = names.filter((n) => n !== "ensureDefaultHousehold");
        if (disallowed.length > 0) {
          publicRouteViolations.push({
            file: relative,
            reason: `imports ${disallowed.join(", ")} from lib/household/repo -- a public route may only import ensureDefaultHousehold() from there`,
          });
        }
      }
    }
  }

  return { routeFiles, unclassified, invalid, byClass, missingHouseholdContext, publicRouteViolations, reviewerRouteViolations };
}

async function main() {
  const { routeFiles, unclassified, invalid, byClass, missingHouseholdContext, publicRouteViolations, reviewerRouteViolations } = await classifyRoutes();
  assert.ok(routeFiles.length > 0, "sanity check: at least one app/api/**/route.ts must exist");

  assert.equal(
    unclassified.length,
    0,
    `Every app/api/**/route.ts must export ROUTE_AUTH (${ROUTE_AUTH_VALUES.join(" | ")}). Unclassified: ${unclassified.join(", ")}`,
  );
  assert.equal(invalid.length, 0, `Invalid ROUTE_AUTH value(s): ${invalid.map((i) => `${i.file}=\"${i.value}\"`).join(", ")}`);
  assert.equal(
    missingHouseholdContext.length,
    0,
    `Every household-member/household-owner route must call requireHouseholdContext(). Missing in: ${missingHouseholdContext.join(", ")}`,
  );
  assert.equal(
    publicRouteViolations.length,
    0,
    `Public route(s) reaching for household-scoped authorization: ${publicRouteViolations.map((v) => `${v.file} (${v.reason})`).join("; ")}`,
  );

  assert.equal(
    reviewerRouteViolations.length,
    0,
    `Internal-reviewer route rule violated: ${reviewerRouteViolations.map((v) => `${v.file} (${v.reason})`).join("; ")}`,
  );
  assert.ok((byClass["internal-reviewer"] ?? 0) >= 7, "sanity check: the four definition-match routes and three reviewer routes are all internal-reviewer");

  console.log(
    `route-inventory regressions passed: all ${routeFiles.length} app/api/**/route.ts files carry a valid ROUTE_AUTH classification ` +
      `(${Object.entries(byClass)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}); every household-member/household-owner route calls requireHouseholdContext(); no public route reaches for ` +
      `household-scoped authorization beyond the one allowed ensureDefaultHousehold() exception; every internal-reviewer route goes through ` +
      `the central reviewer boundary and never household membership.`,
  );
}

// Guarded so importing classifyRoutes() from scripts/launch-check.ts (or
// any other future caller) never triggers this file's own assert-based
// run as an import side effect -- only running this file directly does.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

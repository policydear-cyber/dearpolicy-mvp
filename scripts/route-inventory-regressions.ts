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

async function main() {
  const apiDir = path.resolve("app/api");
  const routeFiles = await findRouteFiles(apiDir);
  assert.ok(routeFiles.length > 0, "sanity check: at least one app/api/**/route.ts must exist");

  const unclassified: string[] = [];
  const invalid: { file: string; value: string }[] = [];
  const byClass: Record<string, number> = {};
  const missingHouseholdContext: string[] = [];
  const publicRouteViolations: { file: string; reason: string }[] = [];

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

  console.log(
    `route-inventory regressions passed: all ${routeFiles.length} app/api/**/route.ts files carry a valid ROUTE_AUTH classification ` +
      `(${Object.entries(byClass)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}); every household-member/household-owner route calls requireHouseholdContext(); no public route reaches for ` +
      `household-scoped authorization beyond the one allowed ensureDefaultHousehold() exception.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

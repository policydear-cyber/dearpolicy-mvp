/**
 * Static audit, not a live-request test: two import-boundary invariants the
 * v1-launch-hardening migration depends on, checked by scanning source text
 * rather than importing modules (see route-inventory-regressions.ts's own
 * doc comment for why a static scan is the right tool here -- importing 40+
 * Route Handler modules that construct AI/DB/Pinecone clients at module
 * scope would need a fully configured environment just to load).
 *
 * 1. `devAccountId()` (lib/db/client.ts) must never be imported by
 *    production-reachable code -- anything under app/ (routes, pages,
 *    layouts, server actions), lib/ (repositories, auth helpers -- every
 *    domain module other than lib/db/client.ts, which defines the
 *    function), components/, or the root middleware.ts. It throws in
 *    production (see lib/db/client.ts / launch-guard-regressions.ts), so
 *    this is a defense-in-depth source check against that runtime guard,
 *    not a duplicate of it: this one catches a reintroduced call at
 *    review/CI time, before it ever reaches a running process. Dev/ops
 *    tooling under scripts/ (seed.ts, build-benefit-catalog.ts,
 *    policy-linkage-report.ts) and the test suites that verify the
 *    runtime guard itself are outside production's request path and are
 *    intentionally not scanned.
 *
 * 2. `createServiceSupabaseClient()`/`withServiceTransaction()`
 *    (lib/db/authz-client.ts) -- the explicit bypass-RLS escape hatch --
 *    must never be imported directly by anything under app/ or
 *    components/. lib/db/authz-client.ts's own doc comment states the
 *    invariant this enforces: "`grep -rn createServiceSupabaseClient app/`
 *    is a complete list of every place RLS is intentionally bypassed" --
 *    today that list is empty; the one legitimate caller is
 *    lib/household/repo.ts (initial household provisioning before any
 *    household_members row exists, invitation acceptance before the
 *    invitee is a member), which every route reaches through the repo's
 *    own functions rather than the service client directly. lib/ itself is
 *    not scanned for this check -- a lib-layer repository is exactly where
 *    a deliberate, documented service-client use is supposed to live; the
 *    boundary this protects is "a route/page never reaches for it
 *    directly", not "no lib file may ever use it".
 *
 * 3. `createRateLimiter` (lib/http/rate-limit.ts, the in-memory, single-
 *    instance-only limiter) must never be imported by anything under
 *    app/ -- every route that needs a production rate limit must use
 *    `createDbRateLimiter` (lib/http/db-rate-limit.ts) instead, whose
 *    counter is shared across every serverless instance (see that
 *    file's own header comment for why the in-memory version cannot
 *    make the same guarantee). This is the launch-readiness gap the PR
 *    description originally flagged as "rate-limiting-uses-memory",
 *    closed here as a permanent regression rather than a one-time fix --
 *    a future route that imports the in-memory limiter by mistake (e.g.
 *    copy-pasting an older route as a template) fails this check
 *    immediately rather than silently shipping a per-instance-only
 *    brake again. lib/http/rate-limit.ts itself stays a legitimate,
 *    documented option for non-app code (its own regression suite,
 *    scripts/security-regressions.ts, is outside app/ and is not
 *    scanned), so only app/ is checked, not lib/ or components/.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function findSourceFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSourceFiles(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** Every import clause (static or dynamic) pulling from a module whose
 * specifier ends in `suffix`, as the raw specifier-list text between the
 * braces -- callers check that text for the banned name themselves, since a
 * plain substring/word-boundary check is robust to `X as Y` renames and to
 * unrelated imports sharing the same clause. */
function importClausesFrom(text: string, suffix: string): string[] {
  const clauses: string[] = [];
  const specifierPattern = `["'][^"']*${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`;
  const staticRe = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*${specifierPattern}`, "g");
  const dynamicRe = new RegExp(`(?:const|let)\\s*\\{([^}]*)\\}\\s*=\\s*await\\s*import\\(\\s*${specifierPattern}\\s*\\)`, "g");
  for (const re of [staticRe, dynamicRe]) {
    for (const match of text.matchAll(re)) clauses.push(match[1]);
  }
  return clauses;
}

function clauseImportsName(clause: string, name: string): boolean {
  return new RegExp(`(^|[,{\\s])${name}([,}\\s:]|\\s+as\\s|$)`).test(clause);
}

async function main() {
  // Ban 1 (devAccountId) covers everything production-reachable: app/,
  // lib/, components/, middleware.ts. Ban 2 (the service client) is
  // narrower on purpose -- it only checks app/ and components/, since a
  // lib/ repository (lib/household/repo.ts) is exactly where a deliberate,
  // documented service-client use is meant to live; see this file's own
  // doc comment above.
  const devAccountIdRoots = ["app", "lib", "components"].map((d) => path.resolve(d));
  const serviceClientRoots = ["app", "components"].map((d) => path.resolve(d));
  const rateLimiterRoots = ["app"].map((d) => path.resolve(d));
  const devAccountIdFiles = (await Promise.all(devAccountIdRoots.map(findSourceFiles))).flat();
  devAccountIdFiles.push(path.resolve("middleware.ts"));
  const serviceClientFiles = (await Promise.all(serviceClientRoots.map(findSourceFiles))).flat();
  serviceClientFiles.push(path.resolve("middleware.ts"));
  const rateLimiterFiles = (await Promise.all(rateLimiterRoots.map(findSourceFiles))).flat();
  assert.ok(devAccountIdFiles.length > 20, "sanity check: the devAccountId scan should cover dozens of files, not a near-empty list");
  assert.ok(serviceClientFiles.length > 10, "sanity check: the service-client scan should cover a real number of files, not a near-empty list");
  assert.ok(rateLimiterFiles.length > 10, "sanity check: the rate-limiter scan should cover a real number of files, not a near-empty list");

  const devAccountIdViolations: string[] = [];
  const serviceClientViolations: string[] = [];
  const rateLimiterViolations: string[] = [];
  const clientDefinitionFile = path.resolve("lib/db/client.ts");

  for (const file of devAccountIdFiles) {
    if (file === clientDefinitionFile) continue;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // middleware.ts's path.resolve always exists in this repo, but stay defensive
    }
    const relative = path.relative(process.cwd(), file);
    for (const clause of importClausesFrom(text, "/lib/db/client")) {
      if (clauseImportsName(clause, "devAccountId")) devAccountIdViolations.push(relative);
    }
  }

  for (const file of serviceClientFiles) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const relative = path.relative(process.cwd(), file);
    for (const clause of importClausesFrom(text, "/lib/db/authz-client")) {
      if (clauseImportsName(clause, "createServiceSupabaseClient") || clauseImportsName(clause, "withServiceTransaction")) {
        serviceClientViolations.push(relative);
      }
    }
  }

  for (const file of rateLimiterFiles) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const relative = path.relative(process.cwd(), file);
    for (const clause of importClausesFrom(text, "/lib/http/rate-limit")) {
      if (clauseImportsName(clause, "createRateLimiter")) rateLimiterViolations.push(relative);
    }
  }

  assert.equal(
    devAccountIdViolations.length,
    0,
    `devAccountId() must not be imported by production-reachable code (app/, lib/ other than lib/db/client.ts itself, components/, middleware.ts). ` +
      `Found in: ${devAccountIdViolations.join(", ")}`,
  );
  assert.equal(
    serviceClientViolations.length,
    0,
    `createServiceSupabaseClient()/withServiceTransaction() must not be imported directly by app/ or components/ -- route through a lib/ repository ` +
      `function instead (see lib/household/repo.ts for the pattern), keeping every intentional RLS bypass in one auditable, non-request-path place. ` +
      `Found in: ${serviceClientViolations.join(", ")}`,
  );
  assert.equal(
    rateLimiterViolations.length,
    0,
    `createRateLimiter() (the in-memory, single-instance-only limiter) must not be imported anywhere under app/ -- use createDbRateLimiter() ` +
      `(lib/http/db-rate-limit.ts) instead, whose counter is shared across every serverless instance. Found in: ${rateLimiterViolations.join(", ")}`,
  );

  console.log(
    `import-boundary regressions passed: scanned ${devAccountIdFiles.length} files under app/, lib/, components/ and middleware.ts for devAccountId() -- ` +
      `none found outside lib/db/client.ts's own definition; scanned ${serviceClientFiles.length} files under app/, components/ and middleware.ts for ` +
      `createServiceSupabaseClient()/withServiceTransaction() -- none found; scanned ${rateLimiterFiles.length} files under app/ for the in-memory ` +
      `createRateLimiter() -- none found (every route uses the shared Postgres-backed createDbRateLimiter() instead).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

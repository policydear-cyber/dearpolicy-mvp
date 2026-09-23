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
 * matches its declared classification (e.g. that a "household-owner"
 * route actually enforces owner-only access) -- that is what each route's
 * own request-level tests, and lib/auth/request-context.ts's
 * requireHouseholdContext()/routeErrorResponse() being used consistently,
 * are for.
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

async function main() {
  const apiDir = path.resolve("app/api");
  const routeFiles = await findRouteFiles(apiDir);
  assert.ok(routeFiles.length > 0, "sanity check: at least one app/api/**/route.ts must exist");

  const unclassified: string[] = [];
  const invalid: { file: string; value: string }[] = [];
  const byClass: Record<string, number> = {};

  for (const file of routeFiles) {
    const text = await readFile(file, "utf8");
    const match = text.match(CLASSIFICATION_PATTERN);
    if (!match) {
      unclassified.push(path.relative(process.cwd(), file));
      continue;
    }
    const value = match[1];
    if (!(ROUTE_AUTH_VALUES as readonly string[]).includes(value)) {
      invalid.push({ file: path.relative(process.cwd(), file), value });
      continue;
    }
    byClass[value] = (byClass[value] ?? 0) + 1;
  }

  assert.equal(
    unclassified.length,
    0,
    `Every app/api/**/route.ts must export ROUTE_AUTH (${ROUTE_AUTH_VALUES.join(" | ")}). Unclassified: ${unclassified.join(", ")}`,
  );
  assert.equal(invalid.length, 0, `Invalid ROUTE_AUTH value(s): ${invalid.map((i) => `${i.file}="${i.value}"`).join(", ")}`);

  console.log(
    `route-inventory regressions passed: all ${routeFiles.length} app/api/**/route.ts files carry a valid ROUTE_AUTH classification ` +
      `(${Object.entries(byClass)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

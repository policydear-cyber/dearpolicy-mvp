/**
 * Checkpoint 7 (claude/v1-launch-hardening): the "repository-level
 * regression that fails if a normal active-record query omits the
 * lifecycle predicate" the spec calls for.
 *
 * Static audit, not a live-request test -- same convention as
 * scripts/import-boundary-regressions.ts and scripts/route-inventory-
 * regressions.ts: scans source text under app/ and lib/ for every
 * `FROM policies` / `FROM claim_evidence_documents` / `FROM
 * family_members` occurrence and checks whether `lifecycle_state`
 * appears in a nearby window of the same SQL statement.
 *
 * Migrating all ~30 existing call sites to filter lifecycle_state='active'
 * is itself the remaining bulk of Checkpoint 7's "every production query
 * must exclude non-active records by default" requirement, tracked
 * incrementally (see PR #16's own status notes). Two are migrated today:
 * lib/rag/retrieve.ts (chat retrieval -- the literal "deleted policy
 * removed from chat" requirement) and app/api/policies/route.ts (the
 * policy list/selector route). Every other current occurrence is
 * recorded in KNOWN_UNGUARDED below as an explicit, visible debt list --
 * NOT a blanket exemption.
 *
 * What this regression actually enforces, starting today: the unguarded
 * count for a given file can only ever go DOWN from what is recorded
 * here (a site gets migrated) or stay the same -- it can never go UP. A
 * brand-new query added anywhere without the predicate immediately fails
 * this check, and a file not in the list at all gets zero tolerance. It
 * is deliberately a ratchet, not a snapshot: shrinking the list without
 * updating the counts below is allowed and encouraged (that just means
 * this regression is stricter than it has to be for that file); growing
 * the unguarded count anywhere is not.
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

const TABLES = ["policies", "claim_evidence_documents", "family_members"] as const;
type GuardedTable = (typeof TABLES)[number];

/** Every `FROM <table>` occurrence in `text` (word-boundary on both
 * sides, so it doesn't match e.g. `family_members_lifecycle_state_check`
 * or a longer identifier that happens to contain the table name), with a
 * ~600-character window AFTER the match checked for `lifecycle_state` --
 * generous enough to cover a multi-line WHERE clause without spanning
 * into an unrelated later statement in practice for this codebase's
 * query style (short, single-purpose template strings). */
function unguardedOccurrences(text: string, table: GuardedTable): number {
  const re = new RegExp(`FROM\\s+${table}\\b(?!_)`, "g");
  let count = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    const window = text.slice(start, start + 600);
    if (!window.includes("lifecycle_state")) count++;
  }
  return count;
}

// Baseline recorded when this regression was introduced (see this file's
// own doc comment). Regenerate by temporarily changing REPORT_ONLY below
// to true and running `npm run security:lifecycle-query-guard-test`.
const KNOWN_UNGUARDED: Partial<Record<GuardedTable, Record<string, number>>> = {
  policies: {
    "app/api/benefits/index/route.ts": 4,
    "app/api/dashboard/route.ts": 2,
    "app/api/family/[id]/route.ts": 1,
    "app/api/policies/link-person/route.ts": 1,
    "app/api/policies/reprocess/route.ts": 1,
    "app/api/policies/scan-callback/route.ts": 1,
    "app/api/policies/upload/route.ts": 2,
    "lib/ai/ledger.ts": 1,
    "lib/claims/ci-evidence.ts": 1,
    "lib/claims/death-evidence.ts": 1,
    "lib/claims/disability-evidence.ts": 1,
    "lib/claims/medical-evidence.ts": 1,
    "lib/claims/travel-evidence.ts": 1,
    "lib/household/export.ts": 1,
    "lib/ledger/extract.ts": 3,
    "lib/policies/condition-catalog.ts": 1,
    "lib/policies/inventory.ts": 1,
    "lib/policies/linking.ts": 3,
    "lib/policies/quarantine/store.ts": 1,
    "lib/rag/backfill.ts": 1,
  },
  claim_evidence_documents: {
    "lib/claims/evidence/store.ts": 5,
    "lib/household/export.ts": 1,
  },
  family_members: {
    "app/api/benefits/route.ts": 1,
    "app/api/chat/history/route.ts": 1,
    "app/api/chat/route.ts": 1,
    "app/api/coverage/route.ts": 1,
    "app/api/dashboard/route.ts": 1,
    "app/api/family/[id]/route.ts": 3,
    "app/api/family/route.ts": 2,
    "app/api/ledger/route.ts": 1,
    "app/api/policies/link-person/route.ts": 1,
    "app/api/policies/upload/route.ts": 2,
    "lib/chat/workflow.ts": 1,
    "lib/claims/evidence/pipeline.ts": 1,
    "lib/household/export.ts": 1,
    "lib/ledger/store.ts": 1,
    "lib/policies/linking.ts": 1,
    "lib/rag/chat.ts": 1,
  },
};

const REPORT_ONLY = false;

async function main() {
  const roots = ["app", "lib"].map((d) => path.resolve(d));
  const files = (await Promise.all(roots.map(findSourceFiles))).flat();
  assert.ok(files.length > 100, "sanity check: the query-guard scan should cover a large number of files, not a near-empty list");

  const report: Record<string, Partial<Record<GuardedTable, number>>> = {};
  const violations: string[] = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(path.resolve("."), file);
    for (const table of TABLES) {
      const count = unguardedOccurrences(text, table);
      if (count === 0) continue;
      report[relative] = { ...report[relative], [table]: count };
      const allowed = KNOWN_UNGUARDED[table]?.[relative] ?? 0;
      if (count > allowed) {
        violations.push(
          `${relative}: ${count} unguarded "FROM ${table}" occurrence(s) (allowlisted: ${allowed}) -- a query reading ${table} must filter lifecycle_state='active' (or be added to KNOWN_UNGUARDED with an honest reason if it is intentionally exempt, e.g. the deletion coordinator itself, which must be able to read non-active rows)`,
        );
      }
    }
  }

  if (REPORT_ONLY) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  assert.equal(
    violations.length,
    0,
    `\n${violations.join("\n")}\n\nA normal active-record query omitted the lifecycle predicate (or a new one exceeded its allowlisted debt count). See this file's own header comment.`,
  );

  const totalKnown = Object.values(KNOWN_UNGUARDED).reduce((sum, byFile) => sum + Object.values(byFile ?? {}).reduce((a, b) => a + b, 0), 0);
  console.log(
    `lifecycle query-guard regression passed: no unguarded active-record query exceeds its tracked allowance (${totalKnown} pre-existing call sites still tracked as Checkpoint 7 follow-up; lib/rag/retrieve.ts and app/api/policies/route.ts are migrated).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

/**
 * Checkpoint 7 (claude/v1-launch-hardening): the "repository-level
 * regression that fails if a normal active-record query omits the
 * lifecycle predicate" the spec calls for.
 *
 * Static audit, not a live-request test -- same convention as
 * scripts/import-boundary-regressions.ts and scripts/route-inventory-
 * regressions.ts: scans source text under app/ and lib/ for every
 * `FROM accounts` / `FROM policies` / `FROM claim_evidence_documents` /
 * `FROM family_members` occurrence (and the equivalent `JOIN <table>`
 * form -- an earlier version of this regex only matched literal `FROM
 * <table>` text and silently missed every JOIN-based read, which is a
 * very common pattern in this codebase; that gap is closed) and checks
 * whether `lifecycle_state` (or the shared activePredicate() helper)
 * appears in a nearby window of the same SQL statement.
 *
 * KNOWN_UNGUARDED is intentionally empty: every production application
 * read across all four lifecycle-scoped tables (accounts, policies,
 * claim_evidence_documents, family_members) has been migrated to filter
 * lifecycle_state='active' by default, via lib/lifecycle/scopes.ts's
 * activePredicate() helper. The only reads that legitimately return
 * non-active rows are the documented, narrow exceptions tracked in
 * INTENTIONAL_INTERNAL_READS below (each of which must call
 * readIncludingDeletedForInternalUse() and name why) -- not a debt list.
 *
 * What this regression enforces: the unguarded count for a given file
 * can only ever go DOWN from what is recorded in KNOWN_UNGUARDED (a site
 * gets migrated) or stay the same -- it can never go UP. A brand-new
 * query added anywhere without the predicate immediately fails this
 * check, and with the allowlist at zero, that now means EVERY file gets
 * zero tolerance: a lifecycle-scoped table read added anywhere without
 * the predicate fails the very next run, not just files that already
 * had recorded debt. It is deliberately a ratchet, not a snapshot.
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

const TABLES = ["accounts", "policies", "claim_evidence_documents", "family_members"] as const;
type GuardedTable = (typeof TABLES)[number];

/** Every `FROM <table>` occurrence in `text` (word-boundary on both
 * sides, so it doesn't match e.g. `family_members_lifecycle_state_check`
 * or a longer identifier that happens to contain the table name), with a
 * ~600-character window AFTER the match checked for `lifecycle_state` --
 * generous enough to cover a multi-line WHERE clause without spanning
 * into an unrelated later statement in practice for this codebase's
 * query style (short, single-purpose template strings). */
function unguardedOccurrences(text: string, table: GuardedTable): number {
  const re = new RegExp(`(?:FROM|JOIN)\\s+${table}\\b(?!_)`, "g");
  let count = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    const window = text.slice(start, start + 600);
    // Guarded either by the literal predicate (an un-migrated file that
    // still spells it out inline) or by the shared helper
    // (lib/lifecycle/scopes.ts's activePredicate()) that migrated call
    // sites now use instead of repeating the literal string.
    if (!window.includes("lifecycle_state") && !window.includes("activePredicate(")) count++;
  }
  return count;
}

/** Files with at least one call to readIncludingDeletedForInternalUse()
 * (lib/lifecycle/scopes.ts) -- these are not migration debt, they are
 * documented, intentional exceptions. Tracked separately from
 * KNOWN_UNGUARDED so the two can never be confused: an entry here says
 * "this file's unguarded reads are meant to stay unguarded, and here is
 * why", not "nobody got around to this yet".
 */
const INTENTIONAL_INTERNAL_READS: Record<string, string> = {
  "lib/lifecycle/coordinator.ts": "the deletion coordinator itself -- must read a resource regardless of its current lifecycle state to validate/transition/retry a deletion request",
};

// Baseline recorded when this regression was introduced (see this file's
// own doc comment). Regenerate by temporarily changing REPORT_ONLY below
// to true and running `npm run security:lifecycle-query-guard-test`.
const KNOWN_UNGUARDED: Partial<Record<GuardedTable, Record<string, number>>> = {};

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

    const claimsInternalException = relative in INTENTIONAL_INTERNAL_READS;
    if (claimsInternalException && !text.includes("readIncludingDeletedForInternalUse(")) {
      violations.push(
        `${relative}: listed in INTENTIONAL_INTERNAL_READS ("${INTENTIONAL_INTERNAL_READS[relative]}") but never calls readIncludingDeletedForInternalUse() -- the exception claim is not backed by the documentation marker it requires (lib/lifecycle/scopes.ts)`,
      );
    }

    for (const table of TABLES) {
      const count = unguardedOccurrences(text, table);
      if (count === 0) continue;
      report[relative] = { ...report[relative], [table]: count };
      if (claimsInternalException) continue; // documented, intentional -- not migration debt
      const allowed = KNOWN_UNGUARDED[table]?.[relative] ?? 0;
      if (count > allowed) {
        violations.push(
          `${relative}: ${count} unguarded "FROM ${table}" occurrence(s) (allowlisted: ${allowed}) -- a query reading ${table} must filter through activePredicate() (lib/lifecycle/scopes.ts), or the file must be added to INTENTIONAL_INTERNAL_READS with an honest reason and call readIncludingDeletedForInternalUse() if it is a genuine internal exception (audit/cleanup/recovery), never a silent omission`,
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
    `lifecycle query-guard regression passed: no unguarded active-record query exceeds its tracked allowance (${totalKnown} pre-existing call sites tracked as debt; zero means every production read across accounts/policies/claim_evidence_documents/family_members is lifecycle-scoped by default).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

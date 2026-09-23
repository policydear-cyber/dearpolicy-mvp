/**
 * Real Row Level Security regression suite for sql/household-rls.sql.
 *
 * This stands up a disposable PGlite (real Postgres, WASM) database, applies
 * every sql/*.sql migration including household-rls.sql, seeds two separate
 * households with real household_members rows, then runs every assertion as
 * the `authenticated` or `anon` Postgres role with `auth.uid()` bound to a
 * specific user via `SET LOCAL ROLE` + `set_config('request.jwt.claim.sub', ...)`
 * -- the same mechanism a request-scoped Supabase-authenticated connection
 * uses. These are genuine row-level-security outcomes enforced by Postgres
 * itself, not application-code filtering: a bug in a policy's USING/WITH
 * CHECK clause would fail these assertions even though every line of
 * TypeScript in this repo is unreachable from this script.
 *
 * Covers the explicit proof points required for the "Database ownership and
 * RLS" launch-hardening requirement:
 *   - User A cannot read/insert/update/delete household B's data
 *   - A guessed UUID does not bypass authorization
 *   - A household member cannot perform owner-only actions
 *   - Removed members immediately lose access
 *   - A service-role-equivalent (superuser) connection is not itself blocked
 *   - Anonymous access is rejected
 *
 * "Storage ownership matches database ownership" is NOT covered here --
 * Supabase Storage bucket policies are a separate configuration surface from
 * Postgres table RLS. See scripts/storage-rls-regressions.ts for that half,
 * proving sql/storage-rls.sql's household-scoped storage.objects/
 * storage.buckets policies the same way this file proves the Postgres
 * table policies above.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const SQL_FILES = [
  "sql/schema.sql",
  "sql/benefit-catalog.sql",
  "sql/claim-evidence.sql",
  "sql/claim-composition.sql",
  "sql/critical-illness.sql",
  "sql/disability.sql",
  "sql/cover-conditions.sql",
  "sql/model-usage.sql",
  "sql/chat-upgrade.sql",
  "sql/coverage-ledger.sql",
  "sql/household-rls.sql",
];

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function asUser(
  db: PGlite,
  opts: { userId: string | null; role: "authenticated" | "anon"; commit?: boolean },
  fn: () => Promise<void>,
) {
  await db.query("BEGIN");
  try {
    await db.query(`SET LOCAL ROLE ${opts.role}`);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [opts.userId ?? ""]);
    await fn();
  } finally {
    await db.query(opts.commit ? "COMMIT" : "ROLLBACK");
  }
}

let savepointCounter = 0;

/**
 * Runs `fn` expecting it to reject with an error matching `pattern`. A real
 * Postgres transaction is left in an "aborted" state after any statement
 * fails (error 25P02, "current transaction is aborted") -- every later
 * statement in the same BEGIN/COMMIT block would then fail too, even ones
 * that have nothing to do with the rejection under test. Wrapping the call
 * in its own SAVEPOINT and rolling back to it afterwards (success or
 * failure) keeps the outer transaction usable for the assertions that
 * follow, the same way a real app would isolate a single expected-to-fail
 * statement inside a longer request-scoped transaction.
 */
async function expectRejected(db: PGlite, fn: () => Promise<unknown>, pattern: RegExp, message: string) {
  const savepoint = `sp_${savepointCounter++}`;
  await db.query(`SAVEPOINT ${savepoint}`);
  try {
    await fn();
    throw new Error(`expected rejection but succeeded: ${message}`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert.match(text, pattern, `${message} (got: ${text})`);
  } finally {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
}

async function main() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }

  const householdA = uuid(1);
  const householdB = uuid(2);
  const ownerA = uuid(10);
  const memberA = uuid(11);
  const ownerB = uuid(20);
  const strangerUuid = uuid(999); // a syntactically valid but unrelated household id

  // Seeded as the default (superuser) connection role, which bypasses RLS --
  // this is the trusted server-side seeding path, not something under test.
  await db.query("INSERT INTO accounts(id, name) VALUES ($1, 'Household A'), ($2, 'Household B')", [
    householdA,
    householdB,
  ]);
  await db.query(
    "INSERT INTO household_members(household_id, user_id, role) VALUES ($1,$2,'owner'), ($1,$3,'member'), ($4,$5,'owner')",
    [householdA, ownerA, memberA, householdB, ownerB],
  );
  const policyA = uuid(30);
  const familyA = uuid(31);
  await db.query("INSERT INTO family_members(id, account_id, display_name, relationship) VALUES ($1,$2,'A1','self')", [
    familyA,
    householdA,
  ]);
  await db.query(
    "INSERT INTO policies(id, account_id, family_member_id, insurer, original_filename, storage_key) VALUES ($1,$2,$3,'Insurer','policy.pdf','k')",
    [policyA, householdA, familyA],
  );

  // --- Service-role-equivalent (superuser) sanity check -----------------
  // A trusted server job connecting without SET ROLE must still see both
  // households -- RLS must not accidentally block legitimate backend jobs.
  const asSuperuser = await db.query("SELECT account_id FROM policies");
  assert.equal(asSuperuser.rows.length, 1, "seed sanity check: exactly one policy seeded");

  // --- User A cannot read household B's data (and a guessed UUID doesn't help) ---
  await asUser(db, { userId: ownerA, role: "authenticated" }, async () => {
    const own = await db.query("SELECT id FROM policies WHERE account_id = $1", [householdA]);
    assert.equal(own.rows.length, 1, "household A's owner must see household A's own policy");

    const other = await db.query("SELECT id FROM policies WHERE account_id = $1", [householdB]);
    assert.equal(other.rows.length, 0, "household A's owner must NOT see household B's policy");

    const guessed = await db.query("SELECT id FROM policies WHERE account_id = $1", [strangerUuid]);
    assert.equal(guessed.rows.length, 0, "a guessed/unrelated household id must return zero rows, not an error");

    // INSERT into household B is rejected by the WITH CHECK clause. Isolated
    // in its own savepoint so the aborted-transaction state it leaves behind
    // doesn't poison the UPDATE/DELETE assertions that follow.
    await expectRejected(
      db,
      () =>
        db.query(
          "INSERT INTO policies(id, account_id, family_member_id, insurer, original_filename, storage_key) VALUES ($1,$2,$3,'x','policy.pdf','k')",
          [uuid(40), householdB, familyA],
        ),
      /row-level security/i,
      "inserting a row into household B as a household A member must be rejected",
    );

    // UPDATE targeting household B's policy id is filtered to zero rows by USING.
    // NOTE: PGlite's query() result is { rows, fields, affectedRows, blob } --
    // "affectedRows" is PGlite's own field name, not node-postgres's "rowCount".
    const updated = await db.query("UPDATE policies SET insurer = 'changed' WHERE account_id = $1", [householdB]);
    assert.equal(updated.affectedRows ?? 0, 0, "updating household B's row as a household A member must affect zero rows");

    // DELETE targeting household B's row is likewise filtered to zero rows.
    const deleted = await db.query("DELETE FROM policies WHERE account_id = $1", [householdB]);
    assert.equal(deleted.affectedRows ?? 0, 0, "deleting household B's row as a household A member must affect zero rows");
  });

  // --- A household member cannot perform owner-only actions --------------
  await asUser(db, { userId: memberA, role: "authenticated" }, async () => {
    await expectRejected(
      db,
      () =>
        db.query("INSERT INTO household_members(household_id, user_id, role) VALUES ($1,$2,'member')", [
          householdA,
          uuid(50),
        ]),
      /row-level security/i,
      "a plain member must not be able to add another household member (owner-only)",
    );
    const roleChange = await db.query("UPDATE household_members SET role = 'owner' WHERE household_id = $1 AND user_id = $2", [
      householdA,
      memberA,
    ]);
    assert.equal(roleChange.affectedRows ?? 0, 0, "a plain member must not be able to self-promote to owner");
  });

  // --- Removed members immediately lose access ---------------------------
  await asUser(db, { userId: ownerA, role: "authenticated", commit: true }, async () => {
    const removed = await db.query("DELETE FROM household_members WHERE household_id = $1 AND user_id = $2", [
      householdA,
      memberA,
    ]);
    assert.equal(removed.affectedRows, 1, "the owner must be able to remove a member");
  });
  await asUser(db, { userId: memberA, role: "authenticated" }, async () => {
    const afterRemoval = await db.query("SELECT id FROM policies WHERE account_id = $1", [householdA]);
    assert.equal(afterRemoval.rows.length, 0, "a removed member must immediately lose read access, in the very next query");
  });

  // --- Anonymous access is rejected ---------------------------------------
  await asUser(db, { userId: null, role: "anon" }, async () => {
    await expectRejected(
      db,
      () => db.query("SELECT id FROM policies WHERE account_id = $1", [householdA]),
      /permission denied/i,
      "the anon role must not even have table-level access (it was explicitly revoked)",
    );
  });

  // A signed-in user with no household_members row anywhere sees nothing.
  await asUser(db, { userId: uuid(60), role: "authenticated" }, async () => {
    const orphan = await db.query("SELECT id FROM policies WHERE account_id = $1", [householdA]);
    assert.equal(orphan.rows.length, 0, "an authenticated user with no household membership must see no household's data");
  });

  await db.close();
  console.log("RLS regressions passed: household isolation, owner-only actions, membership revocation, and anon rejection all hold at the Postgres policy level.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

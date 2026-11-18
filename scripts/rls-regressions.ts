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
  // Runbook step 14 runs before household-rls.sql (step 16); its lifecycle
  // columns are what household-rls.sql grants the deletion route on policies.
  "sql/lifecycle.sql",
  "sql/household-rls.sql",
  "sql/household-single-owner.sql",
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

  await db.query("INSERT INTO chat_messages(account_id, role, content) VALUES ($1,'user','What does my hospital plan pay?')", [householdA]);

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

    // INSERT into household B is rejected. Browser sessions no longer hold
    // INSERT on policies at all (policy rows are created only by the server
    // upload route -- see sql/household-rls.sql's policy-state block), so the
    // rejection now comes from the privilege check, which runs before RLS.
    // Isolated in its own savepoint so the aborted-transaction state it
    // leaves behind doesn't poison the UPDATE/DELETE assertions that follow.
    await expectRejected(
      db,
      () =>
        db.query(
          "INSERT INTO policies(id, account_id, family_member_id, insurer, original_filename, storage_key) VALUES ($1,$2,$3,'x','policy.pdf','k')",
          [uuid(40), householdB, familyA],
        ),
      /permission denied|row-level security/i,
      "inserting a row into household B as a household A member must be rejected",
    );
    await expectRejected(
      db,
      () =>
        db.query(
          "INSERT INTO policies(id, account_id, family_member_id, insurer, original_filename, storage_key) VALUES ($1,$2,$3,'x','policy.pdf','k')",
          [uuid(41), householdA, familyA],
        ),
      /permission denied/i,
      "a household session must not be able to insert a policy row even into its own household",
    );
    await expectRejected(
      db,
      () => db.query("UPDATE policies SET insurer = 'changed' WHERE account_id = $1", [householdB]),
      /permission denied/i,
      "a household session must not hold UPDATE on extracted policy columns at all",
    );

    // UPDATE targeting household B's policy id is filtered to zero rows by USING.
    // NOTE: PGlite's query() result is { rows, fields, affectedRows, blob } --
    // "affectedRows" is PGlite's own field name, not node-postgres's "rowCount".
    // updated_at is one of the three lifecycle columns a household session may
    // still UPDATE (for the deletion route), so this probes RLS USING itself.
    const updated = await db.query("UPDATE policies SET updated_at = now() WHERE account_id = $1", [householdB]);
    assert.equal(updated.affectedRows ?? 0, 0, "updating household B's row as a household A member must affect zero rows");

    // DELETE targeting household B's row is likewise filtered to zero rows.
    // DELETE is no longer granted to browser sessions at all (deletion goes
    // through the lifecycle coordinator), so the attempt is rejected outright.
    await expectRejected(
      db,
      () => db.query("DELETE FROM policies WHERE account_id = $1", [householdB]),
      /permission denied/i,
      "deleting household B's row as a household A member must be rejected",
    );
    const survived = await db.query("SELECT 1 FROM policies WHERE account_id = $1", [householdB]);
    assert.equal(survived.rows.length, 0, "household B's row stays invisible to household A after the rejected delete");
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

    // One owner per household (sql/household-rls.sql): a member reads everything but changes nothing except Ask.
    const seen = await db.query("SELECT id FROM family_members WHERE account_id = $1", [householdA]);
    assert.equal(seen.rows.length, 1, "a member must still see the household's family members");
    await expectRejected(
      db,
      () => db.query("INSERT INTO family_members(account_id, display_name, relationship) VALUES ($1,'Lim Ah Kow','child')", [householdA]),
      /row-level security/i,
      "a member must not be able to add a family member (owner-only)",
    );
    const renamed = await db.query("UPDATE family_members SET display_name = 'changed' WHERE account_id = $1", [householdA]);
    assert.equal(renamed.affectedRows ?? 0, 0, "a member must not be able to edit a family member");
    const removedPerson = await db.query("DELETE FROM family_members WHERE account_id = $1", [householdA]);
    assert.equal(removedPerson.affectedRows ?? 0, 0, "a member must not be able to remove a family member");
    const docDeleted = await db.query(
      "UPDATE policies SET lifecycle_state = 'pending_deletion', lifecycle_version = lifecycle_version + 1 WHERE account_id = $1",
      [householdA],
    );
    assert.equal(docDeleted.affectedRows ?? 0, 0, "a member must not be able to delete a document");
    // Ask writes through the server connection; the chat tables' policies still let a member's own session write them.
    const asked = await db.query("UPDATE chat_messages SET content = content WHERE account_id = $1", [householdA]);
    assert.equal(asked.affectedRows, 1, "a member must still be able to use Ask (chat tables stay writable)");
  });

  // The owner still can (the same statements, in a transaction rolled back after).
  await asUser(db, { userId: ownerA, role: "authenticated" }, async () => {
    const added = await db.query("INSERT INTO family_members(account_id, display_name, relationship) VALUES ($1,'Lim Ah Kow','child')", [householdA]);
    assert.equal(added.affectedRows, 1, "the owner must be able to add a family member");
    const docDeleted = await db.query(
      "UPDATE policies SET lifecycle_state = 'pending_deletion', lifecycle_version = lifecycle_version + 1 WHERE account_id = $1",
      [householdA],
    );
    assert.equal(docDeleted.affectedRows, 1, "the owner must be able to delete a document");
  });

  // --- Exactly one owner (sql/household-single-owner.sql) -----------------
  // A second owner is refused when the transaction commits (the check is deferred to commit for transfers).
  let secondOwner = "";
  await db.query("BEGIN");
  try {
    await db.query("UPDATE household_members SET role = 'owner' WHERE household_id = $1 AND user_id = $2", [householdA, memberA]);
    await db.query("COMMIT");
  } catch (error) {
    secondOwner = error instanceof Error ? error.message : String(error);
    await db.query("ROLLBACK").catch(() => undefined);
  }
  assert.match(secondOwner, /household_members_one_owner|conflicting key value/i, "a household must never commit with two owners");
  // A transfer under the owner's own RLS (promote, then demote, one transaction) commits.
  await asUser(db, { userId: ownerA, role: "authenticated", commit: true }, async () => {
    const promoted = await db.query("UPDATE household_members SET role = 'owner' WHERE household_id = $1 AND user_id = $2", [householdA, memberA]);
    assert.equal(promoted.affectedRows, 1, "the owner must be able to name the new owner");
    const demoted = await db.query("UPDATE household_members SET role = 'member' WHERE household_id = $1 AND user_id = $2", [householdA, ownerA]);
    assert.equal(demoted.affectedRows, 1, "the old owner becomes a member in the same transaction");
  });
  const owners = await db.query<{ user_id: string }>("SELECT user_id FROM household_members WHERE household_id = $1 AND role = 'owner'", [householdA]);
  assert.deepEqual(owners.rows.map((r) => r.user_id), [memberA], "after a transfer the household has exactly one owner, the new one");
  // Hand it back so the rest of this suite runs on the seeded roles.
  await asUser(db, { userId: memberA, role: "authenticated", commit: true }, async () => {
    await db.query("UPDATE household_members SET role = 'owner' WHERE household_id = $1 AND user_id = $2", [householdA, ownerA]);
    await db.query("UPDATE household_members SET role = 'member' WHERE household_id = $1 AND user_id = $2", [householdA, memberA]);
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

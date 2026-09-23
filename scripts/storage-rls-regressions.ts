/**
 * Real Row Level Security regression suite for sql/storage-rls.sql --
 * mirrors scripts/rls-regressions.ts's own structure and technique exactly
 * (same asUser()/expectRejected() helpers, same SET LOCAL ROLE +
 * set_config('request.jwt.claim.sub', ...) mechanism a request-scoped
 * Supabase-authenticated connection uses), applied to Storage instead of
 * the household/domain Postgres tables. This is the suite
 * scripts/rls-regressions.ts's own header comment names as still-open:
 * "'Storage ownership matches database ownership' is NOT covered here...
 * tracked as a separate, still-open requirement".
 *
 * ## Why this needs a local stub schema (read before changing either file)
 *
 * PGlite is real Postgres, but it has no Supabase Storage extension --
 * there is no storage.objects/storage.buckets table to load sql/
 * storage-rls.sql against unless something creates them first. A real
 * Supabase project already has both tables (owned by
 * supabase_storage_admin, with RLS already enabled and zero policies by
 * default -- fail-closed), plus table-level SELECT/INSERT/UPDATE/DELETE
 * grants already in place for `authenticated`/`anon` (the storage-api
 * service talks to Postgres through those roles and relies on RLS alone
 * for row-level enforcement -- this is why sql/storage-rls.sql itself
 * never GRANTs table access the way sql/household-rls.sql has to for its
 * own custom tables). This file recreates just enough of that --
 * `CREATE TABLE IF NOT EXISTS storage.objects/storage.buckets` with the
 * handful of columns sql/storage-rls.sql actually reads, plus the
 * matching table-level GRANTs a real project already has -- so that what
 * gates access in this test is genuinely the RLS policies themselves, not
 * an accidental missing table grant. None of this stub setup is, or
 * should ever become, part of the committed migration in sql/ -- it
 * belongs only here.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const uuid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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

/** Same isolation trick as scripts/rls-regressions.ts's expectRejected():
 * a real Postgres transaction is aborted after any failed statement, so an
 * expected-to-fail call is wrapped in its own SAVEPOINT and rolled back to,
 * keeping the outer transaction usable for the assertions that follow. */
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
  // sql/household-rls.sql assumes `accounts` already exists (it only creates
  // household_members/household_invitations itself) and otherwise skips any
  // table that isn't present -- schema.sql is the one real prerequisite this
  // test needs loaded first, matching scripts/rls-regressions.ts's own list.
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/household-rls.sql"), "utf8"));

  // --- Test-only Supabase Storage stand-in (see this file's own header
  // comment for why this lives here and not in sql/) ------------------------
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets(id),
      name text NOT NULL,
      owner uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT USAGE ON SCHEMA storage TO authenticated, anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects, storage.buckets TO authenticated;
    GRANT SELECT ON storage.objects, storage.buckets TO anon;
  `);

  const householdA = uuid(1);
  const householdB = uuid(2);
  const ownerA = uuid(10);
  const memberA = uuid(11);
  const ownerB = uuid(20);

  // Seeded as the superuser (service-role-equivalent) connection, which
  // bypasses RLS -- this is the trusted server-side seeding path. The two
  // app buckets are deliberately seeded as public=true -- the wrong,
  // insecure state a real project could already be in -- and only THEN is
  // sql/storage-rls.sql applied below, so the very next assertion proves its
  // safety-net UPDATE actually ran and fixed a real misconfiguration, rather
  // than the test only ever having seen a bucket that was already correct.
  await db.query("INSERT INTO accounts(id, name) VALUES ($1, 'Household A'), ($2, 'Household B')", [householdA, householdB]);
  await db.query(
    "INSERT INTO household_members(household_id, user_id, role) VALUES ($1,$2,'owner'), ($1,$3,'member'), ($4,$5,'owner')",
    [householdA, ownerA, memberA, householdB, ownerB],
  );
  await db.query("INSERT INTO storage.buckets(id, name, public) VALUES ('policy-files','policy-files',true), ('claim-evidence-files','claim-evidence-files',true), ('some-other-bucket','some-other-bucket',false)");

  await db.exec(await readFile(path.resolve("sql/storage-rls.sql"), "utf8"));

  const afterMigration = await db.query<{ id: string; public: boolean }>(
    "SELECT id, public FROM storage.buckets WHERE id IN ('policy-files','claim-evidence-files') ORDER BY id",
  );
  assert.deepEqual(
    afterMigration.rows.map((r) => r.public),
    [false, false],
    "sql/storage-rls.sql's safety-net UPDATE must force both app buckets back to public=false even if they were seeded/toggled public",
  );

  await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)", ["policy-files", `${householdA}/fam1/pol1/policy.pdf`]);
  await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)", ["claim-evidence-files", `${householdA}/fam1/claim1/doc1/evidence.pdf`]);
  await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)", ["policy-files", `${householdB}/fam2/pol2/policy.pdf`]);
  // A malformed key -- never written by this app's own code, but never
  // trusted either -- must be denied, not crash every other row's query.
  await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)", ["policy-files", "not-a-uuid/policy.pdf"]);
  // An object in a bucket this app doesn't use at all, under what would
  // otherwise be a valid household-A path -- must never be exposed just
  // because the path segment happens to parse.
  await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)", ["some-other-bucket", `${householdA}/unrelated.txt`]);

  // --- Service-role-equivalent (superuser) sanity check --------------------
  const asSuperuser = await db.query("SELECT id FROM storage.objects");
  assert.equal(asSuperuser.rows.length, 5, "seed sanity check: exactly five objects seeded");

  // --- A household member sees only their own household's objects, across
  // both app buckets, and never the unrelated third bucket ------------------
  await asUser(db, { userId: ownerA, role: "authenticated" }, async () => {
    const own = await db.query<{ bucket_id: string }>(
      "SELECT bucket_id FROM storage.objects WHERE name LIKE $1 || '/%' ORDER BY bucket_id",
      [householdA],
    );
    assert.deepEqual(
      own.rows.map((r) => r.bucket_id),
      ["claim-evidence-files", "policy-files"],
      "household A's owner must see both of household A's own objects, in both app buckets, and nothing from the unrelated bucket",
    );

    const other = await db.query("SELECT id FROM storage.objects WHERE name LIKE $1 || '/%'", [householdB]);
    assert.equal(other.rows.length, 0, "household A's owner must NOT see household B's object");

    const malformed = await db.query("SELECT id FROM storage.objects WHERE name = 'not-a-uuid/policy.pdf'");
    assert.equal(malformed.rows.length, 0, "a malformed/non-uuid path segment must return zero rows, not an error, for every ordinary query too");
  });

  // --- A different household's owner sees only their own object ------------
  await asUser(db, { userId: ownerB, role: "authenticated" }, async () => {
    const own = await db.query("SELECT id FROM storage.objects WHERE name LIKE $1 || '/%'", [householdB]);
    assert.equal(own.rows.length, 1, "household B's owner must see household B's own object");
    const other = await db.query("SELECT id FROM storage.objects WHERE name LIKE $1 || '/%'", [householdA]);
    assert.equal(other.rows.length, 0, "household B's owner must NOT see household A's objects");
  });

  // --- Insert: a member can add an object under their own household's
  // path, but not under a foreign household's path --------------------------
  await asUser(db, { userId: memberA, role: "authenticated" }, async () => {
    const inserted = await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2) RETURNING id", [
      "policy-files",
      `${householdA}/fam1/pol3/policy.pdf`,
    ]);
    assert.equal(inserted.rows.length, 1, "a household A member must be able to insert an object under household A's own path");

    await expectRejected(
      db,
      () => db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)", ["policy-files", `${householdB}/fam2/pol4/policy.pdf`]),
      /row-level security/i,
      "inserting an object under household B's path as a household A member must be rejected",
    );

    await expectRejected(
      db,
      () => db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)", ["some-other-bucket", `${householdA}/unrelated2.txt`]),
      /row-level security/i,
      "inserting into a bucket outside the two allowed app buckets must be rejected even under the caller's own household path",
    );
  });

  // --- Delete: filtered to zero rows for a foreign household's object ------
  await asUser(db, { userId: ownerA, role: "authenticated" }, async () => {
    const deleted = await db.query("DELETE FROM storage.objects WHERE name LIKE $1 || '/%'", [householdB]);
    assert.equal(deleted.affectedRows ?? 0, 0, "deleting household B's object as a household A owner must affect zero rows");
  });

  // --- A revoked member immediately loses access, in the very next query ---
  await asUser(db, { userId: ownerA, role: "authenticated", commit: true }, async () => {
    const removed = await db.query("DELETE FROM household_members WHERE household_id = $1 AND user_id = $2", [householdA, memberA]);
    assert.equal(removed.affectedRows, 1, "the owner must be able to remove a member");
  });
  await asUser(db, { userId: memberA, role: "authenticated" }, async () => {
    const afterRemoval = await db.query("SELECT id FROM storage.objects WHERE name LIKE $1 || '/%'", [householdA]);
    assert.equal(afterRemoval.rows.length, 0, "a removed member must immediately lose read access to their former household's storage objects");
  });

  // --- Bucket-row visibility: authenticated sees only the two app buckets,
  // never the unrelated third bucket -----------------------------------------
  await asUser(db, { userId: ownerB, role: "authenticated" }, async () => {
    const buckets = await db.query<{ id: string }>("SELECT id FROM storage.buckets ORDER BY id");
    assert.deepEqual(
      buckets.rows.map((r) => r.id),
      ["claim-evidence-files", "policy-files"],
      "authenticated must see exactly the two app buckets and never an unrelated third bucket",
    );
  });

  // --- Anonymous access sees nothing, for every table this file touches ----
  await asUser(db, { userId: null, role: "anon" }, async () => {
    const objects = await db.query("SELECT id FROM storage.objects WHERE name LIKE $1 || '/%'", [householdA]);
    assert.equal(objects.rows.length, 0, "the anon role must never see a household's storage objects, even one that exists");
    const buckets = await db.query("SELECT id FROM storage.buckets");
    assert.equal(buckets.rows.length, 0, "the anon role must never see any bucket row -- household_storage_buckets_select is authenticated-only");
  });

  await db.close();
  console.log(
    "storage-rls regressions passed: household isolation, bucket scoping, a malformed path segment, membership revocation, and anon rejection all hold at the Postgres policy level for storage.objects/storage.buckets.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

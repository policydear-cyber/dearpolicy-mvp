/**
 * Regression suite for lib/db/authz-client.ts's transaction-boundary
 * contract: the exact sequence of statements that turns a bypass-RLS pool
 * connection into a per-request, RLS-enforced one.
 *
 * What this suite proves: createUserSupabaseClient() issues
 * BEGIN -> SET LOCAL ROLE authenticated -> set_config(request.jwt.claim.sub)
 * before handing control to the caller, then COMMIT + release on success or
 * ROLLBACK + release on failure -- and refuses to open a transaction at all
 * for a missing/invalid user id (no silent fallback to an unscoped query).
 *
 * What this suite does NOT prove (and is not a substitute for):
 * scripts/rls-regressions.ts is what proves the SET LOCAL ROLE + set_config
 * mechanism actually enforces real Postgres RLS policies -- that requires a
 * real Postgres engine (PGlite here), which a `pg.Pool` (this module's real
 * dependency) cannot be swapped for in-process. This suite instead verifies
 * the *transaction lifecycle* against a lightweight fake Pool, since that
 * lifecycle is exactly what a bug here would get wrong (e.g. forgetting to
 * release a connection, or committing after an error).
 */
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { AuthorizationContextError, createServiceSupabaseClient, createUserSupabaseClient } from "../lib/db/authz-client";

type Call = { sql: string; params?: unknown[] };

function fakePool() {
  const calls: Call[] = [];
  let released = false;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      released = true;
    },
  } as unknown as PoolClient;
  const pool: Pick<Pool, "connect"> = {
    connect: async () => client,
  };
  return { pool, calls, wasReleased: () => released };
}

const REAL_USER_ID = "20000000-0000-4000-8000-000000000010";

async function main() {
  // --- Refuses to open a transaction without a real user id -------------
  for (const badId of ["", "not-a-uuid", undefined as unknown as string, null as unknown as string]) {
    const { pool, calls } = fakePool();
    await assert.rejects(
      () => createUserSupabaseClient(badId, async () => {}, pool),
      AuthorizationContextError,
      `createUserSupabaseClient(${JSON.stringify(badId)}) must reject before touching the database`,
    );
    assert.equal(calls.length, 0, "no query may run before the user id is validated");
  }

  // --- Success path: BEGIN, SET ROLE, set_config, fn, COMMIT, release ---
  {
    const { pool, calls, wasReleased } = fakePool();
    const result = await createUserSupabaseClient(
      REAL_USER_ID,
      async (client) => {
        await client.query("SELECT 1");
        return "ok";
      },
      pool,
    );
    assert.equal(result, "ok", "the callback's return value must be propagated");
    assert.equal(calls[0]?.sql, "BEGIN");
    assert.equal(calls[1]?.sql, "SET LOCAL ROLE authenticated");
    assert.match(calls[2]?.sql ?? "", /set_config\('request\.jwt\.claim\.sub'/);
    assert.deepEqual(calls[2]?.params, [REAL_USER_ID], "the JWT claim must be bound to the real caller's id, never a placeholder");
    assert.equal(calls[3]?.sql, "SELECT 1", "the callback's own queries must run inside the same transaction");
    assert.equal(calls[4]?.sql, "COMMIT");
    assert.equal(calls.length, 5, "no extra statements (e.g. an accidental ROLLBACK) on the success path");
    assert.ok(wasReleased(), "the connection must always be released back to the pool");
  }

  // --- Failure path: ROLLBACK (not COMMIT) + release, and the error propagates ---
  {
    const { pool, calls, wasReleased } = fakePool();
    await assert.rejects(
      () =>
        createUserSupabaseClient(
          REAL_USER_ID,
          async () => {
            throw new Error("household B is not readable");
          },
          pool,
        ),
      /household B is not readable/,
      "the callback's own error must propagate to the caller, not be swallowed",
    );
    assert.ok(calls.some((c) => c.sql === "ROLLBACK"), "a failed transaction must be rolled back");
    assert.ok(!calls.some((c) => c.sql === "COMMIT"), "a failed transaction must never be committed");
    assert.ok(wasReleased(), "the connection must be released even when the callback throws");
  }

  // --- Service client boundary: it is a distinct, explicitly-named export ---
  // (not "the same client, unlabeled" -- grep-ability is the whole point).
  assert.equal(typeof createServiceSupabaseClient, "function");
  assert.notEqual(
    createServiceSupabaseClient,
    createUserSupabaseClient,
    "the service-role and user-scoped clients must be two distinct, separately-named exports",
  );

  console.log(
    "authz-client regressions passed: createUserSupabaseClient() refuses an unscoped transaction, always " +
      "SET ROLEs+binds the real caller before running the callback's queries, and always commits-or-rolls-back " +
      "and releases; createServiceSupabaseClient() remains a distinct, explicitly-named escape hatch.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

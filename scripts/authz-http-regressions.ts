/**
 * HTTP-level, table-driven regression suite for the shared authorization
 * boundary every migrated route (all 34 pre-existing household-member/
 * household-owner routes, per PR #16) is now built on:
 * lib/auth/request-context.ts's requireHouseholdContext()/
 * routeErrorResponse(). Rather than repeating the same ~10 scenarios once
 * per route (340+ near-duplicate cases), this exercises the shared
 * mechanism itself through a small set of representative real routes --
 * every route delegates identity/household resolution to the same one
 * function, so proving that function's behavior here is what actually
 * gives assurance across all 34, not per-route repetition of the same
 * check.
 *
 * Representative routes used: app/api/ledger/route.ts (household-member,
 * GET/PATCH -- the richest of the household-member routes for this
 * purpose, since PATCH exercises the not-found/malformed-body paths too)
 * and app/api/household/invitations/route.ts (household-owner, GET --
 * whose owner-only enforcement is RLS itself, not an application-level
 * check, making it the clearest real proof that the RLS-scoped client, not
 * the service client, is what a route actually runs its queries through).
 *
 * Deliberately NOT covered here, with reasons (not silently skipped):
 *  - "Expired session": this codebase does not distinguish an expired
 *    session from no session at all -- lib/auth/session.ts's
 *    getCurrentUser() treats any failure of supabase.auth.getUser()
 *    (including a rejected/expired token) identically to nobody being
 *    signed in, and both become UnauthenticatedError -> 401. Scenario 9
 *    below verifies that mapping directly; there is no separate "expired"
 *    code path to exercise on top of it.
 *  - A true "no session" call through the REAL Supabase-backed branch of
 *    getCurrentUser(): that branch calls next/headers' cookies(), which
 *    throws when invoked outside Next's own request-dispatch (see
 *    lib/auth/request-context.ts's own doc comment for the identical
 *    reason requireHouseholdContext() itself was changed to take a
 *    NextRequest) -- there is no real Supabase project configured in this
 *    sandbox to authenticate against either way. Scenario 9 instead proves
 *    the UnauthenticatedError -> 401 mapping directly at the unit level,
 *    which is the exact contract every route relies on regardless of how
 *    the error was produced. Verifying the real Supabase-backed branch end
 *    to end needs a real project and belongs with the other staging-only
 *    verification already tracked in the PR description (RLS/storage).
 *  - A true request-scoped TOCTOU ("resource deleted between authorization
 *    and mutation"): that needs a hook into the route's own execution
 *    between its authorization check and its write, which this harness
 *    (or any harness invoking the handler as a single async call) cannot
 *    interject into. Scenario 6 covers the externally-equivalent and
 *    actually-more-common case -- acting on a resource id that is already
 *    gone by the time the request is authorized -- which exercises the
 *    same "the row vanished out from under a correctly-authorized request"
 *    code path (loadLedgerRow() returning null) that a real TOCTOU would
 *    also hit.
 *  - "Service role not used by ordinary requests" as a runtime spy: named
 *    ESM function exports cannot be reassigned from outside their module
 *    the way lib/db/client.ts's pool.query/pool.connect are monkey-patched
 *    elsewhere in this repo's test scripts. This is instead covered
 *    statically and unconditionally by
 *    scripts/import-boundary-regressions.ts (no app/ or components/ file
 *    may import createServiceSupabaseClient()/withServiceTransaction() at
 *    all), and, for the one route this suite runs whose data IS
 *    RLS-scoped (household/invitations), scenario 3 below is itself live
 *    proof the RLS client is what actually ran the query -- a member
 *    would see the invitation too if the service client (which bypasses
 *    RLS) had been used instead.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { NextRequest } from "next/server";
import {
  requireHouseholdContext,
  routeErrorResponse,
  NoHouseholdError,
  ACTIVE_HOUSEHOLD_COOKIE,
} from "@/lib/auth/request-context";
import { UnauthenticatedError } from "@/lib/auth/session";
import { ForbiddenError, NotFoundError, ConflictError } from "@/lib/household/repo";

type Scenario = { name: string; run: () => Promise<void> };
const scenarios: Scenario[] = [];
function scenario(name: string, run: () => Promise<void>) {
  scenarios.push({ name, run });
}

function asUser(userId: string) {
  process.env.DEV_AUTH_ENABLED = "1";
  process.env.DEV_ACCOUNT_ID = userId;
}

function requestFor(url: string, opts: { household?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.household) headers["cookie"] = `${ACTIVE_HOUSEHOLD_COOKIE}=${opts.household}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

/** No stack frame, file path, or driver-internal detail should ever reach a
 * client -- every route's catch block is built on this being true. */
function assertNoInternalLeak(bodyText: string, context: string) {
  const suspicious = [/at \S+ \(/, /node_modules/, /\/home\/user/, /\.ts:\d+:\d+/, /ECONNREFUSED/, /PGlite/i];
  for (const pattern of suspicious) {
    assert.ok(!pattern.test(bodyText), `${context}: response body looks like it leaked internal detail (matched ${pattern}): ${bodyText}`);
  }
}

async function main() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/benefit-catalog.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/model-usage.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/coverage-ledger.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/household-rls.sql"), "utf8"));
  // Checkpoint 7: app/api/ledger/route.ts's family() now filters on
  // family_members.lifecycle_state via activePredicate() -- exec
  // sql/lifecycle.sql so that column exists here too.
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");

  // Mirrors scripts/system-database-regressions.ts's pool monkey-patch
  // exactly (connection mutex + exec-vs-query dispatch).
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) {
      const results = await db.exec(text);
      const result = results.at(-1);
      return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  pool.query = (async (text: string, params: unknown[] = []) => {
    const release = await acquire();
    try {
      return await execute(text, params);
    } finally {
      release();
    }
  }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release } as any;
  }) as typeof pool.connect;

  // Two independent households, so cross-household isolation is a real
  // property of seeded data, not an assumption.
  const accountA = "00000000-0000-0000-0000-0000000000a1";
  const accountB = "00000000-0000-0000-0000-0000000000b1";
  const ownerA = "00000000-0000-0000-0000-00000000a001";
  const memberA = "00000000-0000-0000-0000-00000000a002";
  const ownerB = "00000000-0000-0000-0000-00000000b001";

  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household A'),($2,'Household B')", [accountA, accountB]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')", [
    accountA,
    ownerA,
    memberA,
    accountB,
    ownerB,
  ]);
  await db.query(
    "INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Alice Household-A','Alice','self')",
    ["10000000-0000-4000-8000-00000000a001", accountA],
  );
  await db.query(
    "INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Bob Household-B','Bob','self')",
    ["10000000-0000-4000-8000-00000000b001", accountB],
  );
  await db.query(
    `INSERT INTO household_invitations(household_id,email,role,token_hash,invited_by,expires_at)
     VALUES($1,'invitee@example.com','member','deadbeef'||repeat('0',56),$2,now()+interval '7 days')`,
    [accountA, ownerA],
  );

  const { GET: getLedger, PATCH: patchLedger } = await import("@/app/api/ledger/route");
  const { GET: getInvitations } = await import("@/app/api/household/invitations/route");

  scenario("1. valid household member sees their own household's data", async () => {
    asUser(memberA);
    const res = await getLedger(requestFor("http://localhost/api/ledger"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.family.some((p: any) => p.display_name === "Alice Household-A"));
    assert.ok(!body.family.some((p: any) => p.display_name === "Bob Household-B"));
  });

  scenario("2. cross-household isolation -- a different household's owner never sees household A's data", async () => {
    asUser(ownerB);
    const res = await getLedger(requestFor("http://localhost/api/ledger"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.family.some((p: any) => p.display_name === "Bob Household-B"));
    assert.ok(!body.family.some((p: any) => p.display_name === "Alice Household-A"));
  });

  scenario(
    "3. owner-only route (RLS-enforced, not app-level): owner sees the real invitation, a member of the SAME household sees none",
    async () => {
      asUser(ownerA);
      const ownerRes = await getInvitations(requestFor("http://localhost/api/household/invitations"));
      assert.equal(ownerRes.status, 200);
      const ownerBody = await ownerRes.json();
      assert.equal(ownerBody.invitations.length, 1, "the owner must see the pending invitation");

      asUser(memberA);
      const memberRes = await getInvitations(requestFor("http://localhost/api/household/invitations"));
      assert.equal(memberRes.status, 200, "a non-owner member still gets 200, not 403 -- RLS silently returns zero rows");
      const memberBody = await memberRes.json();
      assert.equal(memberBody.invitations.length, 0, "RLS's household_invitations_select policy must hide it from a non-owner member");
    },
  );

  scenario("4. a client-supplied foreign household cookie is never trusted", async () => {
    asUser(memberA); // a genuine member of A only, never a member of B
    const res = await getLedger(requestFor("http://localhost/api/ledger", { household: accountB }));
    assert.equal(res.status, 200);
    const body = await res.json();
    // resolveActiveHouseholdId() must ignore the forged cookie and fall back
    // to the caller's own real household (A), never grant B's data.
    assert.ok(body.family.some((p: any) => p.display_name === "Alice Household-A"));
    assert.ok(!body.family.some((p: any) => p.display_name === "Bob Household-B"));
  });

  scenario("5. a revoked member immediately loses access, even with a previously-valid cookie", async () => {
    asUser(memberA);
    const before = await getLedger(requestFor("http://localhost/api/ledger", { household: accountA }));
    assert.equal(before.status, 200, "sanity check: memberA has real access before revocation");

    await db.query("DELETE FROM household_members WHERE household_id=$1 AND user_id=$2", [accountA, memberA]);

    const after = await getLedger(requestFor("http://localhost/api/ledger", { household: accountA }));
    assert.equal(after.status, 404, "with zero memberships left, resolveActiveHouseholdId() returns null -> NoHouseholdError -> 404");
    const body = await after.json();
    assert.equal(body.error, "No household");
    assertNoInternalLeak(JSON.stringify(body), "revoked-member response");
  });

  scenario("6. a guessed/already-gone resource id returns a safe 404, never a 500 or a leak", async () => {
    asUser(ownerA);
    const res = await patchLedger(
      requestFor("http://localhost/api/ledger", {
        household: accountA,
        method: "PATCH",
        body: { id: "99999999-9999-4999-8999-999999999999", status: "confirmed" },
      }),
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Row not found");
    assertNoInternalLeak(JSON.stringify(body), "guessed-uuid response");
  });

  scenario("7. a malformed request body returns 400, never a 500", async () => {
    asUser(ownerA);
    const res = await patchLedger(
      requestFor("http://localhost/api/ledger", { household: accountA, method: "PATCH", body: { id: "not-a-uuid" } }),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Could not update the row");
    assertNoInternalLeak(JSON.stringify(body), "malformed-body response");
  });

  scenario(
    "8. unit-level: routeErrorResponse() maps every recognized error class to its documented status, and hides everything else behind a generic message",
    async () => {
      const cases: [unknown, number, string][] = [
        [new UnauthenticatedError("irrelevant detail"), 401, "Not authenticated"],
        [new NoHouseholdError("irrelevant detail"), 404, "No household"],
        [new ForbiddenError("this household belongs to someone else"), 404, "Not found"],
        [new NotFoundError("row does not exist"), 404, "Not found"],
      ];
      for (const [error, status, message] of cases) {
        const res = routeErrorResponse(error);
        assert.equal(res.status, status, `${(error as Error).constructor.name} should map to ${status}`);
        const body = await res.json();
        assert.equal(body.error, message);
        // Foreign (Forbidden) and genuinely missing (NotFound) must be
        // indistinguishable -- neither may reveal which one actually happened.
      }

      const conflict = routeErrorResponse(new ConflictError("You already sent this household's last owner an exit door."));
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).error, "This request conflicts with the current state.");

      // An unrecognized error (a DB driver failure, a bug, anything not in
      // the list above) must NEVER leak its real message to the client --
      // this is the one branch every route's fallback message overrides,
      // but the underlying contract lives here.
      const unexpected = routeErrorResponse(new Error("password authentication failed for user \"postgres\" at 10.0.4.12:5432"));
      assert.equal(unexpected.status, 500);
      const unexpectedBody = await unexpected.json();
      assert.equal(unexpectedBody.error, "Database error");
      assert.ok(!JSON.stringify(unexpectedBody).includes("10.0.4.12"), "the real driver error text must never reach the response body");
    },
  );

  let failures = 0;
  for (const { name, run } of scenarios) {
    try {
      await run();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL: ${name}`);
      console.error(error);
    }
  }

  await db.close();

  if (failures > 0) {
    console.error(`\n${failures} of ${scenarios.length} authz-http scenarios failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nauthz-http regressions passed: all ${scenarios.length} scenarios.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

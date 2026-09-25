/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening):
 * household-invitation revocation, through the REAL route --
 * app/api/household/invitations/[id]/route.ts's DELETE handler.
 *
 * Checkpoint 14d integrity correction: package.json has referenced
 * `security:invitation-revocation-deletion-test` -> this exact file
 * since Checkpoint 7, but this file did not exist in the committed repo
 * until this checkpoint -- confirmed missing via a fresh
 * GITHUB_GET_A_TREE listing against the real branch head, not a
 * local-checkout artifact. Prior PR #16 checkpoints (see PR body's
 * "Checkpoint 14d" section for exactly which ones) reported running this
 * suite and getting real pass counts -- those reports were false.
 *
 * As with the other route-backed suites in this checkpoint: the REAL
 * route calls lib/household/repo.ts's revokeInvitation() directly, NOT
 * lib/lifecycle/coordinator.ts's requestInvitationRevocation() (which
 * wraps revokeInvitation() but also writes deletion_requests/
 * deletion_audit_log bookkeeping) -- grepping app/ and lib/ confirms the
 * coordinator's own wrapper has no caller anywhere outside
 * lib/lifecycle/coordinator.ts itself. This suite tests the REAL route/
 * revokeInvitation() path as it actually behaves in production (a plain
 * `revoked_at=now()` UPDATE, authorized entirely by RLS's
 * household_invitations_update policy -- there is no app-level household-
 * ownership check in revokeInvitation()'s own SQL at all, RLS is the
 * WHOLE authorization boundary here), not the unused coordinator wrapper.
 *
 * Mirrors scripts/full-household-e2e-regressions.ts's established
 * pattern: PGlite-backed pool.query/pool.connect patching, DEV_AUTH_ENABLED
 * + DEV_ACCOUNT_ID identity, real route handler functions invoked with a
 * constructed NextRequest. Run as its own separate process.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { NextRequest } from "next/server";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";

const SQL_FILES = ["sql/schema.sql", "sql/household-rls.sql", "sql/lifecycle.sql"];

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
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

async function seedHousehold(name: string, ownerId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), $1) RETURNING id`, [name]);
  const householdId = result.rows[0].id;
  await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, 'owner')`, [householdId, ownerId]);
  return householdId;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Seeds a pending invitation directly (bypassing the real createInvitation()
 * rate limiter/route, which is orthogonal to this suite) and returns BOTH
 * its id and the real plaintext token, exactly the pair the real
 * accept-invitation route needs -- so this suite can prove the real
 * downstream accept path genuinely rejects a revoked invitation. */
async function seedInvitation(householdId: string, email: string, invitedBy: string): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO household_invitations(household_id, email, role, token_hash, invited_by, expires_at) VALUES ($1,$2,'member',$3,$4,$5) RETURNING id`,
    [householdId, email, tokenHash, invitedBy, expiresAt],
  );
  return { id: result.rows[0].id, token };
}

async function main() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");

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
    if (params.length === 0) {
      const results = await db.exec(text);
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
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

  try {
    const { DELETE: revokeRoute } = await import("@/app/api/household/invitations/[id]/route");
    const { GET: listInvitationsRoute } = await import("@/app/api/household/invitations/route");
    const { POST: acceptRoute } = await import("@/app/api/household/invitations/accept/route");

    await testAsync("DELETE /api/household/invitations/[id]: owner revokes a pending invitation -- revoked_at is really set", async () => {
      const owner = "d0000000-0000-4000-8000-000000000001";
      const householdId = await seedHousehold("Household Revoke Happy", owner);
      const { id } = await seedInvitation(householdId, "invitee@example.com", owner);

      asUser(owner);
      const res = await revokeRoute(requestFor(`http://localhost/api/household/invitations/${id}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ id }) } as any);
      assert.equal(res.status, 200);

      const row = await pool.query<{ revoked_at: string | null }>(`SELECT revoked_at FROM household_invitations WHERE id=$1`, [id]);
      assert.ok(row.rows[0].revoked_at, "revoked_at must really be set");
    });

    await testAsync("DELETE /api/household/invitations/[id]: an owner of a DIFFERENT household cannot revoke this household's invitation (real cross-household authorization boundary, enforced entirely by RLS)", async () => {
      const ownerA = "d0000000-0000-4000-8000-000000000002";
      const householdA = await seedHousehold("Household A Invite", ownerA);
      const { id: victimInvitationId } = await seedInvitation(householdA, "victim@example.com", ownerA);

      const ownerB = "d0000000-0000-4000-8000-000000000003";
      const householdB = await seedHousehold("Household B Invite", ownerB);

      asUser(ownerB);
      const res = await revokeRoute(requestFor(`http://localhost/api/household/invitations/${victimInvitationId}`, { household: householdB, method: "DELETE" }), { params: Promise.resolve({ id: victimInvitationId }) } as any);
      assert.equal(res.status, 404, "a foreign household's invitation must be indistinguishable from a genuinely missing one");

      const row = await pool.query<{ revoked_at: string | null }>(`SELECT revoked_at FROM household_invitations WHERE id=$1`, [victimInvitationId]);
      assert.equal(row.rows[0].revoked_at, null, "the victim household's invitation must never be touched by a cross-household attempt");
    });

    await testAsync("DELETE /api/household/invitations/[id]: an ordinary (non-owner) member of the SAME household cannot revoke an invitation", async () => {
      const owner = "d0000000-0000-4000-8000-000000000004";
      const householdId = await seedHousehold("Household Non-Owner Revoke", owner);
      await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, 'member')`, [householdId, "d0000000-0000-4000-8000-000000000005"]);
      const { id } = await seedInvitation(householdId, "invitee2@example.com", owner);

      asUser("d0000000-0000-4000-8000-000000000005");
      const res = await revokeRoute(requestFor(`http://localhost/api/household/invitations/${id}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ id }) } as any);
      assert.equal(res.status, 404, "RLS's household_invitations_update policy (owner-only) must refuse a non-owner revocation");

      const row = await pool.query<{ revoked_at: string | null }>(`SELECT revoked_at FROM household_invitations WHERE id=$1`, [id]);
      assert.equal(row.rows[0].revoked_at, null);
    });

    await testAsync("DELETE /api/household/invitations/[id]: retrying the same revocation is idempotent and returns the original deletion request", async () => {
      const owner = "d0000000-0000-4000-8000-000000000006";
      const householdId = await seedHousehold("Household Double Revoke", owner);
      const { id } = await seedInvitation(householdId, "invitee3@example.com", owner);

      asUser(owner);
      const first = await revokeRoute(requestFor(`http://localhost/api/household/invitations/${id}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ id }) } as any);
      assert.equal(first.status, 200);
      const firstBody = await first.json();
      const second = await revokeRoute(requestFor(`http://localhost/api/household/invitations/${id}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ id }) } as any);
      assert.equal(second.status, 200);
      const secondBody = await second.json();
      assert.equal(secondBody.deletionRequestId, firstBody.deletionRequestId);
      const requests = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM deletion_requests WHERE resource_type='invitation' AND resource_id=$1`,
        [id],
      );
      assert.equal(requests.rows[0].count, "1", "an idempotent retry must not create a second deletion request");
    });

    await testAsync("a revoked invitation is excluded from GET /api/household/invitations (the real downstream list-read path) immediately", async () => {
      const owner = "d0000000-0000-4000-8000-000000000007";
      const householdId = await seedHousehold("Household List Exclusion", owner);
      const { id } = await seedInvitation(householdId, "invitee4@example.com", owner);

      asUser(owner);
      const before = await listInvitationsRoute(requestFor("http://localhost/api/household/invitations", { household: householdId }));
      assert.ok((await before.json()).invitations.some((inv: { id: string }) => inv.id === id));

      const del = await revokeRoute(requestFor(`http://localhost/api/household/invitations/${id}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ id }) } as any);
      assert.equal(del.status, 200);

      const after = await listInvitationsRoute(requestFor("http://localhost/api/household/invitations", { household: householdId }));
      assert.ok(!(await after.json()).invitations.some((inv: { id: string }) => inv.id === id), "a revoked invitation must never appear on the real GET /api/household/invitations read path again");
    });

    await testAsync("a revoked invitation's real plaintext token can no longer be redeemed through the real POST /api/household/invitations/accept downstream path", async () => {
      const owner = "d0000000-0000-4000-8000-000000000008";
      const householdId = await seedHousehold("Household Accept Exclusion", owner);
      // dev-auth's stub SessionUser always resolves to email
      // "dev@localhost" (lib/auth/session.ts) -- inviting that exact
      // address means the accepting call below can only be refused by
      // the revoked_at guard this case targets, not also by the
      // (unrelated, separately real) email-mismatch guard, which would
      // otherwise mask a sabotaged revoked_at check behind the same
      // externally-visible "invalid or has expired" message.
      const { id, token } = await seedInvitation(householdId, "dev@localhost", owner);

      asUser(owner);
      const del = await revokeRoute(requestFor(`http://localhost/api/household/invitations/${id}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ id }) } as any);
      assert.equal(del.status, 200);

      // The accepting user's identity comes from requireCurrentUser(),
      // which dev-auth resolves to DEV_ACCOUNT_ID -- also needs a real
      // households-agnostic user with the invited email; dev-auth's
      // SessionUser stub email is not the invited address, so this
      // exercises acceptInvitation()'s revoked_at check specifically (the
      // very first guard, before the email-match check ever runs).
      asUser("d0000000-0000-4000-8000-000000000009");
      const acceptRes = await acceptRoute(new Request("http://localhost/api/household/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }) as any);
      assert.equal(acceptRes.status, 400, "a revoked invitation's real token must be rejected by the real accept route, not silently honored");
      const body = await acceptRes.json();
      assert.match(body.error, /invalid or has expired/i);

      const membership = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdId, "d0000000-0000-4000-8000-000000000009"]);
      assert.equal(membership.rows.length, 0, "no membership must ever be created from a revoked invitation's token");
    });

    console.log(`invitation-revocation-deletion regressions passed: ${cases} real, authenticated, route-level cases (DELETE /api/household/invitations/[id]) -- happy path, real cross-household authorization boundary (RLS-enforced), non-owner refusal, double-revoke handling, downstream exclusion from GET /api/household/invitations AND from the real POST /api/household/invitations/accept redemption path. NOTE: this suite tests revokeInvitation()'s REAL production path, not lib/lifecycle/coordinator.ts's unused requestInvitationRevocation() wrapper -- see file header, reported to PR #16 as follow-up.`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

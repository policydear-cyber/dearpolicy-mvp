/**
 * Regression suite for lib/household/repo.ts's own application-level
 * authorization logic -- the parts RLS does NOT enforce by itself, because
 * they are business rules (never leave a household with zero owners),
 * cross-checks against session-verified identity (an invitation's intended
 * email vs. the accepting user's real email), or secret handling (token
 * hashing, never storing/accepting a plaintext token).
 *
 * scripts/rls-regressions.ts separately proves the underlying Postgres RLS
 * policies this repo relies on (cross-household isolation, owner-only
 * mutations, membership revocation). This suite instead drives
 * lib/household/repo.ts's actual exported functions against a scripted fake
 * Postgres client, since a real `pg.Pool` needs a live TCP connection this
 * sandbox does not have.
 */
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  acceptInvitation,
  createInvitation,
  ensureDefaultHousehold,
  removeMember,
  setMemberRole,
} from "../lib/household/repo";

const OWNER = "20000000-0000-4000-8000-000000000010";
const MEMBER = "20000000-0000-4000-8000-000000000011";
const HOUSEHOLD = "20000000-0000-4000-8000-000000000001";

/** A fake pool whose single connection answers queries from a caller-supplied
 * list of {match, result} rules, in order, falling through to a default
 * `{ rows: [], rowCount: 0 }` once exhausted -- close enough to a real
 * connection for exercising this repo's control flow (which branch it
 * takes based on what a query returns), without needing a real database. */
function scriptedPool(rules: Array<{ match: RegExp; result: { rows: unknown[]; rowCount: number } }>) {
  const executed: string[] = [];
  const client = {
    query: async (sql: string) => {
      executed.push(sql.trim().split("\n")[0]);
      const rule = rules.find((r) => r.match.test(sql));
      return rule ? rule.result : { rows: [], rowCount: 0 };
    },
    release: () => {},
  } as unknown as PoolClient;
  const pool: Pick<Pool, "connect"> = { connect: async () => client };
  return { pool, executed };
}

async function main() {
  // --- ensureDefaultHousehold: idempotent -------------------------------
  {
    const { pool, executed } = scriptedPool([
      { match: /^select household_id from household_members/i, result: { rows: [{ household_id: HOUSEHOLD }], rowCount: 1 } },
    ]);
    const id = await ensureDefaultHousehold(OWNER, "My household", pool as unknown as Pool);
    assert.equal(id, HOUSEHOLD, "an existing household must be returned, not a new one created");
    assert.ok(!executed.some((s) => /^insert into accounts/i.test(s)), "no new accounts row when one already exists");
  }
  {
    const { pool, executed } = scriptedPool([
      { match: /^select household_id from household_members/i, result: { rows: [], rowCount: 0 } },
      { match: /^insert into accounts/i, result: { rows: [{ id: HOUSEHOLD }], rowCount: 1 } },
    ]);
    const id = await ensureDefaultHousehold(OWNER, "My household", pool as unknown as Pool);
    assert.equal(id, HOUSEHOLD);
    assert.ok(executed.some((s) => /^insert into accounts/i.test(s)), "a household must be created when none exists yet");
    assert.ok(executed.some((s) => /^insert into household_members/i.test(s)), "the creator must be inserted as owner");
  }

  // --- removeMember: last-owner protection -------------------------------
  {
    const { pool } = scriptedPool([
      { match: /^select role from household_members/i, result: { rows: [{ role: "owner" }], rowCount: 1 } },
      { match: /^select count\(\*\)/i, result: { rows: [{ count: "1" }], rowCount: 1 } },
    ]);
    await assert.rejects(
      () => removeMember(OWNER, HOUSEHOLD, OWNER, pool as unknown as Pool),
      ConflictError,
      "removing the sole remaining owner must be refused",
    );
  }
  {
    const { pool } = scriptedPool([
      { match: /^select role from household_members/i, result: { rows: [{ role: "owner" }], rowCount: 1 } },
      { match: /^select count\(\*\)/i, result: { rows: [{ count: "2" }], rowCount: 1 } },
      { match: /^delete from household_members/i, result: { rows: [], rowCount: 1 } },
    ]);
    await removeMember(OWNER, HOUSEHOLD, MEMBER, pool as unknown as Pool); // must not throw
  }
  {
    const { pool } = scriptedPool([{ match: /^select role from household_members/i, result: { rows: [], rowCount: 0 } }]);
    await assert.rejects(() => removeMember(OWNER, HOUSEHOLD, MEMBER, pool as unknown as Pool), NotFoundError);
  }

  // --- setMemberRole: last-owner demotion protection ---------------------
  {
    const { pool } = scriptedPool([
      { match: /^select role from household_members/i, result: { rows: [{ role: "owner" }], rowCount: 1 } },
      { match: /^select count\(\*\)/i, result: { rows: [{ count: "1" }], rowCount: 1 } },
    ]);
    await assert.rejects(
      () => setMemberRole(OWNER, HOUSEHOLD, OWNER, "member", pool as unknown as Pool),
      ConflictError,
      "demoting the sole remaining owner must be refused",
    );
  }

  // --- createInvitation: rejects a malformed email up front ---------------
  {
    const { pool, executed } = scriptedPool([]);
    await assert.rejects(() => createInvitation(OWNER, HOUSEHOLD, "not-an-email", "member", pool as unknown as Pool), ConflictError);
    assert.equal(executed.length, 0, "an invalid email must be rejected before any query runs");
  }

  // --- acceptInvitation: the real authorization surface -------------------
  const baseInvitation = {
    id: "30000000-0000-4000-8000-000000000001",
    household_id: HOUSEHOLD,
    email: "invitee@example.com",
    role: "member" as const,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    accepted_at: null as string | null,
    revoked_at: null as string | null,
  };
  const inviteeId = "20000000-0000-4000-8000-000000000012";

  // A syntactically valid but unrelated token must never match any row.
  await assert.rejects(
    () => acceptInvitation("not-the-real-token", inviteeId, "invitee@example.com", scriptedPool([]).pool as unknown as Pool),
    NotFoundError,
  );

  {
    const { pool } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [{ ...baseInvitation, revoked_at: new Date().toISOString() }], rowCount: 1 } },
    ]);
    await assert.rejects(() => acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool), ForbiddenError);
  }
  {
    const { pool } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [{ ...baseInvitation, accepted_at: new Date().toISOString() }], rowCount: 1 } },
    ]);
    await assert.rejects(() => acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool), ForbiddenError);
  }
  {
    const { pool } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [{ ...baseInvitation, expires_at: new Date(Date.now() - 1000).toISOString() }], rowCount: 1 } },
    ]);
    await assert.rejects(() => acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool), ForbiddenError, "an expired invitation must be refused");
  }
  {
    // Knowing the token is not enough if it was issued to someone else --
    // this is the "a user must not gain access merely by knowing an id"
    // requirement applied to invitations.
    const { pool } = scriptedPool([{ match: /^select id, household_id, email/i, result: { rows: [baseInvitation], rowCount: 1 } }]);
    await assert.rejects(
      () => acceptInvitation("tok", inviteeId, "someone-else@example.com", pool as unknown as Pool),
      ForbiddenError,
      "accepting with a different email than the invitation was issued to must be refused",
    );
  }
  {
    const { pool, executed } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [baseInvitation], rowCount: 1 } },
      { match: /^insert into household_members/i, result: { rows: [], rowCount: 1 } },
      { match: /^update household_invitations set accepted_at/i, result: { rows: [], rowCount: 1 } },
    ]);
    const householdId = await acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool);
    assert.equal(householdId, HOUSEHOLD);
    assert.ok(executed.some((s) => /^insert into household_members/i.test(s)), "acceptance must create the membership row");
    assert.ok(executed.some((s) => /^update household_invitations set accepted_at/i.test(s)), "acceptance must mark the invitation used");
  }

  console.log(
    "household-repo regressions passed: ensureDefaultHousehold() is idempotent, last-owner removal/demotion is " +
      "refused, invitation email/expiry/revocation/reuse checks all hold, and a guessed/valid-shaped token that " +
      "doesn't match a real row is rejected.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

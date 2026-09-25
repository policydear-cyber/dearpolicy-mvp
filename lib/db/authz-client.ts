/**
 * Per-request database authorization boundary.
 *
 * ## The bug this file fixes
 *
 * lib/db/client.ts's `pool`/`query()` connects to Postgres as the
 * connection's login role (`DATABASE_URL`'s user), which on a Supabase
 * project is `postgres` -- a role with `rolbypassrls = true`. Every RLS
 * policy in sql/household-rls.sql is therefore INVISIBLE to that
 * connection: it can read and write every household's data regardless of
 * which policies exist, exactly as if RLS were switched off. This was
 * flagged explicitly as the critical architectural gap to close.
 *
 * ## The fix
 *
 * Postgres evaluates RLS bypass against the SESSION's *current* role, not
 * the role the TCP connection originally authenticated as. A superuser (or
 * any role granted membership) can `SET ROLE` to a non-bypass role inside a
 * transaction, and from that statement on, every query in that transaction
 * is subject to RLS as that role -- this is exactly the mechanism
 * sql/household-rls.sql's own comments describe as the intended
 * architecture, and it is exactly what scripts/rls-regressions.ts proves
 * against a real Postgres engine (PGlite) via `SET LOCAL ROLE authenticated`
 * + `set_config('request.jwt.claim.sub', ...)`.
 *
 * `createUserSupabaseClient(userId)` below applies that same mechanism to a
 * real per-request transaction: it checks out a connection from the pool,
 * opens a transaction, switches to the `authenticated` role, binds
 * `request.jwt.claim.sub` to the caller's real (session-verified) user id,
 * and returns a scoped client whose queries run under full RLS enforcement
 * -- every SELECT/INSERT/UPDATE/DELETE a route handler issues through it is
 * subject to exactly the same policies scripts/rls-regressions.ts verifies.
 *
 * `createServiceSupabaseClient()` is the explicit, narrow escape hatch for
 * the operations RLS cannot mediate by design (initial household
 * provisioning before any household_members row exists, invitation
 * acceptance before the invitee is a member, background jobs, migrations,
 * scoped admin actions). It is a thin, clearly-labeled wrapper around the
 * existing bypass-RLS pool -- using it is a deliberate, auditable choice
 * (`grep -rn createServiceSupabaseClient app/` is a complete list of every
 * place RLS is intentionally bypassed), never a silent default.
 *
 * Naming note: these two functions are named to match the requested
 * `createUserSupabaseClient()` / `createServiceSupabaseClient()` API
 * surface. They are implemented over the existing `pg` connection (via
 * `SET ROLE`), not over supabase-js's PostgREST query builder, because
 * every other route in this codebase queries via raw SQL through
 * lib/db/client.ts -- switching the entire data-access layer to PostgREST
 * would be a much larger rewrite for no additional RLS guarantee (the
 * underlying policies, and the underlying enforcement mechanism, are
 * identical either way).
 */
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { pool, isUuid } from "./client";

export class AuthorizationContextError extends Error {}

export type ScopedDbClient = {
  query: <T extends QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
};

/** Runs `fn` with a database client whose entire transaction is scoped to
 * `userId` under real RLS enforcement, then commits (or rolls back on
 * error/throw) and releases the connection automatically -- callers never
 * see the raw pg client and can't forget to release it or leave the
 * transaction open. This is the function almost every authenticated route
 * handler should call. */
export type UserSupabaseClientOptions = {
  /** D35 (Wave 2 adversarial audit): opts this transaction into a stronger
   * isolation level than Postgres's default READ COMMITTED. Used by
   * lib/household/export-generation.ts, whose snapshot build runs several
   * sequential SELECTs inside one transaction -- under READ COMMITTED each
   * statement independently re-reads latest-committed state, so a deletion
   * racing the export could land between two of those statements and
   * produce a self-inconsistent snapshot. REPEATABLE READ pins one
   * snapshot for the whole transaction. Omitted (the default) keeps the
   * existing READ COMMITTED behavior for every other call site. */
  isolationLevel?: "REPEATABLE READ" | "SERIALIZABLE";
};

export async function createUserSupabaseClient<T>(
  userId: string,
  fn: (client: ScopedDbClient) => Promise<T>,
  // Injectable only for scripts/authz-client-regressions.ts, which cannot
  // exercise the real `pg.Pool` (it requires a live TCP Postgres connection)
  // and instead verifies this function's transaction-boundary contract --
  // BEGIN/SET ROLE/set_config before `fn`, COMMIT+release on success,
  // ROLLBACK+release on failure -- against a lightweight fake Pool. The real
  // RLS enforcement this mechanism relies on (SET LOCAL ROLE authenticated +
  // request.jwt.claim.sub) is proven separately, against a real Postgres
  // engine, by scripts/rls-regressions.ts.
  poolOverride: Pick<Pool, "connect"> = pool,
  options?: UserSupabaseClientOptions,
): Promise<T> {
  if (!userId || !isUuid(userId)) {
    // Failing loudly (rather than, say, treating a missing id as "no
    // filter") is the point: a caller that forgot to resolve the session
    // user must not silently fall through to an unscoped/service-role-like
    // query path.
    throw new AuthorizationContextError(
      "createUserSupabaseClient() requires a real authenticated user id (a uuid). Refusing to open an " +
        "unscoped database transaction.",
    );
  }
  const client = (await poolOverride.connect()) as PoolClient;
  try {
    await client.query(options?.isolationLevel ? `BEGIN ISOLATION LEVEL ${options.isolationLevel}` : "BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const scoped: ScopedDbClient = {
      query: (text, params = []) => client.query(text, params),
    };
    const result = await fn(scoped);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Explicit, narrowly-scoped bypass-RLS access. Every call site is a
 * deliberate statement that this operation legitimately needs to see or
 * write across household boundaries -- background processing, household
 * provisioning at signup, invitation acceptance, internal cleanup, or a
 * carefully scoped admin action. Never call this to satisfy a normal
 * authenticated user request; use createUserSupabaseClient() for that. */
export function createServiceSupabaseClient(): ScopedDbClient {
  return {
    query: async (text, params = []) => {
      const result = await pool.query(text, params);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  };
}

/** A transactional variant of createServiceSupabaseClient(), for the rare
 * service-role operations that must be atomic across more than one
 * statement (e.g. household provisioning: the accounts row and the owner's
 * household_members row must either both exist or neither does). Still
 * bypasses RLS -- same auditing rule applies: every call site is a
 * deliberate, narrow exception. */
export async function withServiceTransaction<T>(
  fn: (client: ScopedDbClient) => Promise<T>,
  poolOverride: Pick<Pool, "connect"> = pool,
): Promise<T> {
  const client = (await poolOverride.connect()) as PoolClient;
  try {
    await client.query("BEGIN");
    const scoped: ScopedDbClient = {
      query: (text, params = []) => client.query(text, params),
    };
    const result = await fn(scoped);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

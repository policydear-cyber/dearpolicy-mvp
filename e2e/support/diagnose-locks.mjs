#!/usr/bin/env node
// Failure diagnostics for the synthetic CI database only: which queries are
// waiting, on what, and who blocks them. Prints no row data.
import pg from "pg";
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) { console.error("diagnose-locks: local database only"); process.exit(0); }
const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await c.query(`SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`);
console.table(r.rows);
await c.end();

/** Read again on a locked PDF (19 Nov: Read again on a group certificate read with its password at upload, which is never
 * stored, failed and took its working reading with it). The real POST /api/policies/reprocess on a throwaway in-memory
 * Postgres (PGlite) with every migration applied, and a made-up locked certificate (password "Harbour-2026") on local
 * storage. No model, no network, no job is run.
 *
 * Covers: no password -> 409 PDF_PASSWORD_NEEDED; a wrong one -> 409 PDF_PASSWORD_INCORRECT; in both the document stays
 * ready and no read is queued; a member is refused 403 (owner only, #538); refused presses don't use up the hour's paid-read allowance, so
 * the right password then starts the read (TE #565 F1, F2); a plain PDF reads again as before.
 *   npm run -s documents:reread-locked-test */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE|BENEFIT_TABLE|SUPABASE/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
process.env.JOB_DRAIN_ON_REQUEST = "0";
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "dp-reread-locked-"));

const MIGRATIONS = [
  "sql/schema.sql", "sql/benefit-catalog.sql", "sql/cover-conditions.sql", "sql/coverage-ledger.sql", "sql/model-usage.sql",
  "sql/chat-upgrade.sql", "sql/claim-composition.sql", "sql/claim-evidence.sql", "sql/critical-illness.sql", "sql/disability.sql",
  "sql/model-provenance.sql", "sql/rate-limit.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/claim-reviewers.sql",
  "sql/processing-failure-diagnostics.sql", "sql/storage-purge.sql", "sql/household-rls.sql", "sql/infrastructure-rls.sql",
  "sql/policy-member-exclusions.sql", "sql/detected-name-dismissals.sql",
];

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("ok - " + name); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function main() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(`
    CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;`);
  for (const file of MIGRATIONS) await db.exec(await readFile(path.resolve(file), "utf8"));

  let lock = Promise.resolve();
  const serial = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = lock; let release!: () => void; lock = new Promise<void>((r) => { release = r; });
    await prev; try { return await fn(); } finally { release(); }
  };
  const run = async (text: string, params: unknown[] = []) => {
    if (!params.length) { const res = await db.exec(text); const last = res[res.length - 1]; return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number })?.affectedRows ?? last?.rows?.length ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  // PGlite is one connection: a query made beside an open transaction (the route reads the quarantine row on the pool
  // inside its RLS-scoped client) runs inside it, as it would see the same committed rows on a second connection.
  let inTx = 0;
  pool.query = ((text: string, params: unknown[] = []) => (inTx ? run(text, params) : serial(() => run(text, params)))) as typeof pool.query;
  // A transaction holds the lock from BEGIN to COMMIT/ROLLBACK, as one connection would.
  pool.connect = (async () => {
    let held: (() => void) | null = null;
    return {
      query: async (text: string, params: unknown[] = []) => {
        const sql = text.trim();
        if (/^BEGIN/i.test(sql)) { const prev = lock; lock = new Promise<void>((r) => { held = r; }); await prev; inTx++; return run(text, params); }
        if (held) { const r = await run(text, params).finally(() => { if (/^(COMMIT|ROLLBACK)/i.test(sql)) { held!(); held = null; inTx--; } }); return r; }
        return serial(() => run(text, params));
      },
      release: () => { if (held) { held(); held = null; inTx--; } },
    };
  }) as typeof pool.connect;

  const owner = id("b9910000", 1), member = id("b9910000", 2), A = id("a9910000", 1), jane = id("d9910000", 1);
  const locked = id("f9910000", 1), plain = id("f9910000", 2);
  await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'A')`, [A]);
  await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')`, [A, owner, member]);
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Jane Doe','self')`, [jane, A]);
  const doc = async (pid: string, fixture: string) => {
    const key = `${A}/${pid}.pdf`;
    mkdirSync(path.join(process.env.LOCAL_STORAGE_DIR!, A), { recursive: true });
    copyFileSync(path.resolve("scripts/documents/fixtures", fixture), path.join(process.env.LOCAL_STORAGE_DIR!, key));
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,document_role,processing_status,processing_stage,original_filename,storage_key,file_hash,quarantine_status,updated_at)
      VALUES($1,$2,$3,'Harbour Assurance','Harbour Certificate','personal_schedule','ready','complete','Certificate.pdf',$4,$5,'scan_clean',now() - interval '1 hour')`, [pid, A, jane, key, "sha256:" + pid]);
  };
  await doc(locked, "locked-aes-256.pdf");
  await doc(plain, "scan-plain.pdf");

  const { POST } = await import("@/app/api/policies/reprocess/route");
  const asUser = (userId: string) => { process.env.DEV_AUTH_ENABLED = "1"; process.env.DEV_ACCOUNT_ID = userId; };
  const press = async (user: string, pid: string, pdfPassword?: string) => {
    asUser(user);
    const res = await POST(new NextRequest("http://localhost/api/policies/reprocess", { method: "POST",
      headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${A}`, "content-type": "application/json" },
      body: JSON.stringify({ policyId: pid, ...(pdfPassword ? { pdfPassword } : {}) }) }));
    return { status: res.status, body: await res.json().catch(() => ({})) as { reasonCode?: string; error?: string } };
  };
  const state = async (pid: string) => (await pool.query(`SELECT processing_status,processing_error FROM policies WHERE id=$1`, [pid])).rows[0];

  await test("no password on a ready locked PDF: 409 PDF_PASSWORD_NEEDED, the document stays ready", async () => {
    const r = await press(owner, locked);
    assert.equal(r.status, 409); assert.equal(r.body.reasonCode, "PDF_PASSWORD_NEEDED");
    assert.match(r.body.error ?? "", /stays as it is/);
    assert.deepEqual(await state(locked), { processing_status: "ready", processing_error: null });
  });
  await test("a wrong password (wrong case): 409 PDF_PASSWORD_INCORRECT, the document stays ready", async () => {
    const r = await press(owner, locked, "harbour-2026");
    assert.equal(r.status, 409); assert.equal(r.body.reasonCode, "PDF_PASSWORD_INCORRECT");
    assert.deepEqual(await state(locked), { processing_status: "ready", processing_error: null });
  });
  // One owner per household (DC, 18 Nov): only the owner reads a document again, so a member is refused 403 before any
  // password is looked at. Before that a member got the same password refusals as the owner. The document must still stay
  // ready, and a member must not be told whether a password is needed or wrong.
  await test("a member is refused 403 (owner only) with or without a password, and the document stays ready", async () => {
    for (const pw of [undefined, "wrong", "Harbour-2026"]) {
      const r = await press(member, locked, pw);
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.match(r.body.error ?? "", /Only the household owner can do this/);
      assert.equal(r.body.reasonCode, undefined);
    }
    assert.deepEqual(await state(locked), { processing_status: "ready", processing_error: null });
  });
  await test("25 refused presses don't use up the hour's paid-read allowance: the right password then starts the read (TE #565 F2)", async () => {
    for (let i = 0; i < 25; i++) assert.equal((await press(owner, locked, i % 2 ? "wrong" : undefined)).status, 409);
    const r = await press(owner, locked, "Harbour-2026");
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal((await state(locked)).processing_status, "queued");
  });
  await test("a plain PDF reads again as before", async () => {
    const r = await press(owner, plain);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal((await state(plain)).processing_status, "queued");
  });

  if (failures.length) { console.error(failures.join("\n\n")); console.error(`${failures.length} failed, ${passed} passed`); process.exit(1); }
  console.log(`reread-locked: ${passed} passed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

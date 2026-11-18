/** Scripted database tests for policy folders (sql/policy-folders.sql, lib/policies/folders.ts, app/api/policies/folders),
 * on a throwaway in-memory Postgres (PGlite) with every migration applied in the runbook's order. Two made-up households.
 *
 * Covers: before the file is applied (no folders, writes refused, the library sent to chat unchanged); creating a policy
 * folder for a person with documents; the owner only (a member reads, but is refused every change); another household's
 * document or person refused by the server and by the database itself; adding and removing documents (the folder then
 * asks again whether it is complete); "complete" refused with no document; deleting a folder keeps its documents; a deleted
 * or superseded document and a removed person drop out; one document in two folders; and the browser roles can read only
 * their own household's folders and write none.
 *   npm run -s policies:folders-test */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

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
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
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
  pool.query = ((text: string, params: unknown[] = []) => serial(() => run(text, params))) as typeof pool.query;
  // A transaction holds the lock from BEGIN to COMMIT/ROLLBACK, as one connection would.
  pool.connect = (async () => {
    let held: (() => void) | null = null;
    return {
      query: async (text: string, params: unknown[] = []) => {
        const sql = text.trim();
        if (/^BEGIN/i.test(sql)) { const prev = lock; lock = new Promise<void>((r) => { held = r; }); await prev; return run(text, params); }
        if (held) { const r = await run(text, params).finally(() => { if (/^(COMMIT|ROLLBACK)/i.test(sql)) { held!(); held = null; } }); return r; }
        return serial(() => run(text, params));
      },
      release: () => { if (held) { held(); held = null; } },
    };
  }) as typeof pool.connect;

  const ownerA = id("b9800000", 1), memberA = id("b9800000", 2), ownerB = id("b9800000", 3);
  const A = id("a9800000", 1), B = id("a9800000", 2);
  const jane = id("d9800000", 1), john = id("d9800000", 2), bPerson = id("d9800000", 3);
  const sched = id("f9800000", 1), wording = id("f9800000", 2), rider = id("f9800000", 3), unreadable = id("f9800000", 4), bDoc = id("f9800000", 5), oldSched = id("f9800000", 6);
  await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'A'),($2,'B')`, [A, B]);
  await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`, [A, ownerA, memberA, B, ownerB]);
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$4,'Jane Doe','self'),($2,$4,'John Doe','spouse'),($3,$5,'Bea Lim','self')`, [jane, john, bPerson, A, B]);
  const doc = (pid: string, acct: string, person: string, file: string, status = "ready") => pool.query(
    `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,document_role,processing_status,original_filename,storage_key,file_hash,quarantine_status)
     VALUES($1,$2,$3,'Example Life','Example CI Plan','schedule',$5,$4,'k',$6,'scan_clean')`, [pid, acct, person, file, status, 'sha256:' + pid]);
  await doc(sched, A, jane, "Schedule.pdf"); await doc(wording, A, jane, "Wording.pdf"); await doc(rider, A, jane, "Rider.pdf");
  await doc(unreadable, A, jane, "Blurry photo.jpg", "failed"); await doc(oldSched, A, jane, "Old schedule.pdf"); await doc(bDoc, B, bPerson, "B schedule.pdf");
  await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3),($4,$2,$3)`, [sched, jane, A, wording]);

  const folders = await import("@/lib/policies/folders");
  const { GET, POST } = await import("@/app/api/policies/folders/route");
  const item = await import("@/app/api/policies/folders/[id]/route");
  const { readHousehold, renderLibrary } = await import("@/lib/simple-chat/library");
  const asUser = (userId: string) => { process.env.DEV_AUTH_ENABLED = "1"; process.env.DEV_ACCOUNT_ID = userId; };
  const req = (url: string, method: string, household: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
    method, headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}`, "content-type": "application/json", origin: "http://localhost" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const params = (fid: string) => ({ params: Promise.resolve({ id: fid }) });
  const household = (acct: string) => readHousehold(acct, async (sql, p) => (await pool.query(sql, p)).rows, "", false, true);

  // ---- before sql/policy-folders.sql
  await test("R1 before the file is applied: GET says not ready with no folders; creating one is refused; nothing breaks", async () => {
    folders.resetFoldersReady();
    asUser(ownerA);
    const res = await GET(req("/api/policies/folders", "GET", A));
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(await res.json(), { ready: false, canManage: true, folders: [] });
    const made = await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [{ policyId: sched }], complete: false }));
    assert.equal(made.status, 409);
    assert.deepEqual(await folders.listFolders(A), []);
  });
  await test("R2 before the file is applied: the library sent to chat has no folders", async () => {
    const h = await readHousehold(A, async (sql, p) => (await pool.query(sql, p)).rows);
    assert.equal(h.folders, undefined);
    assert.ok(!/<policies/.test(renderLibrary(h)));
  });

  await db.exec(await readFile(path.resolve("sql/policy-folders.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/policy-folders.sql"), "utf8")); // applying it twice is harmless
  folders.resetFoldersReady();

  let janeFolder = "";
  await test("C1 the owner creates a policy for Jane with its schedule and wording, not yet complete", async () => {
    asUser(ownerA);
    const res = await POST(req("/api/policies/folders", "POST", A, { name: "  Jane's   CI plan ", people: [jane], documents: [{ policyId: sched, slot: "schedule" }, { policyId: wording, slot: "wording" }], complete: false }));
    assert.equal(res.status, 200, await res.clone().text());
    janeFolder = (await res.json()).id;
    const got = await (await GET(req("/api/policies/folders", "GET", A))).json();
    assert.equal(got.ready, true); assert.equal(got.canManage, true);
    assert.equal(got.folders.length, 1);
    assert.equal(got.folders[0].name, "Jane's CI plan");
    assert.equal(got.folders[0].complete, false);
    assert.deepEqual(got.folders[0].people, [{ id: jane, name: "Jane Doe" }]);
    assert.deepEqual(got.folders[0].documents, [{ policyId: sched, slot: "schedule" }, { policyId: wording, slot: "wording" }]);
  });
  await test("C2 'Are these all the documents?' Yes: complete", async () => {
    asUser(ownerA);
    const res = await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", A, { complete: true }), params(janeFolder));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await folders.listFolders(A))[0].complete, true);
  });
  await test("C3 adding a rider asks again (not complete); removing it leaves the rider in the library", async () => {
    asUser(ownerA);
    assert.equal((await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", A, { add: [{ policyId: rider, slot: "rider" }] }), params(janeFolder))).status, 200);
    let f = (await folders.listFolders(A))[0];
    assert.equal(f.complete, false);
    assert.deepEqual(f.documents.map((d) => d.policyId), [sched, wording, rider]);
    assert.equal((await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", A, { remove: [rider], complete: true }), params(janeFolder))).status, 200);
    f = (await folders.listFolders(A))[0];
    assert.equal(f.complete, true, "the same request answered Yes");
    assert.deepEqual(f.documents.map((d) => d.policyId), [sched, wording]);
    assert.equal((await pool.query("SELECT lifecycle_state FROM policies WHERE id=$1", [rider])).rows[0].lifecycle_state, "active");
  });
  await test("C4 an unreadable document can be put in a policy, like any other", async () => {
    asUser(ownerA);
    const res = await POST(req("/api/policies/folders", "POST", A, { people: [john], documents: [{ policyId: unreadable, slot: "other" }], complete: false }));
    assert.equal(res.status, 200, await res.clone().text());
    const f = (await folders.listFolders(A)).find((x) => x.people[0]?.id === john)!;
    assert.deepEqual(f.documents.map((d) => d.policyId), [unreadable]);
    await item.DELETE(req(`/api/policies/folders/${f.id}`, "DELETE", A), params(f.id));
  });
  await test("C5 the same wording in John's folder too: both folders list it, Jane's is unchanged", async () => {
    asUser(ownerA);
    const res = await POST(req("/api/policies/folders", "POST", A, { people: [john], documents: [{ policyId: wording }], complete: false }));
    assert.equal(res.status, 200);
    const all = await folders.listFolders(A);
    assert.equal(all.length, 2);
    assert.deepEqual(all[0].documents.map((d) => d.policyId), [sched, wording]);
    assert.deepEqual(all[1].documents.map((d) => d.policyId), [wording]);
    assert.deepEqual(all[1].people.map((p) => p.name), ["John Doe"]);
  });
  await test("C6 an empty policy (no documents yet) can be saved as not finished, but never as complete", async () => {
    asUser(ownerA);
    const empty = await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [], complete: false }));
    assert.equal(empty.status, 200);
    const fid = (await empty.json()).id;
    const yes = await item.PATCH(req(`/api/policies/folders/${fid}`, "PATCH", A, { complete: true }), params(fid));
    assert.equal(yes.status, 400);
    assert.match((await yes.json()).error, /at least one document/);
    assert.equal((await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [], complete: true }))).status, 400);
    assert.equal((await item.DELETE(req(`/api/policies/folders/${fid}`, "DELETE", A), params(fid))).status, 200);
  });
  await test("C7 no person, or removing every person: refused", async () => {
    asUser(ownerA);
    const none = await POST(req("/api/policies/folders", "POST", A, { people: [], documents: [{ policyId: sched }], complete: false }));
    assert.equal(none.status, 400);
    assert.match((await none.json()).error, /who this policy is for/);
    assert.equal((await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", A, { people: [] }), params(janeFolder))).status, 400);
    assert.deepEqual((await folders.listFolders(A))[0].people.map((p) => p.id), [jane]);
  });

  // ---- another household, wrong person, members
  await test("X1 another household's document or person: refused, nothing written", async () => {
    asUser(ownerA);
    const before = (await pool.query("SELECT count(*)::int AS n FROM policy_folder_documents")).rows[0].n;
    for (const body of [{ people: [jane], documents: [{ policyId: bDoc }], complete: false }, { people: [bPerson], documents: [{ policyId: sched }], complete: false }]) {
      const res = await POST(req("/api/policies/folders", "POST", A, body));
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal((await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", A, { add: [{ policyId: bDoc }] }), params(janeFolder))).status, 400);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM policy_folder_documents")).rows[0].n, before);
  });
  await test("X2 household B's owner cannot read, change or delete A's folder", async () => {
    asUser(ownerB);
    assert.deepEqual((await (await GET(req("/api/policies/folders", "GET", B))).json()).folders, []);
    for (const r of [await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", B, { name: "x" }), params(janeFolder)), await item.DELETE(req(`/api/policies/folders/${janeFolder}`, "DELETE", B), params(janeFolder))])
      assert.equal(r.status, 400);
    // and naming household A in the cookie gives B's owner nothing of A's either
    const viaCookie = await GET(req("/api/policies/folders", "GET", A));
    if (viaCookie.status === 200) assert.deepEqual((await viaCookie.json()).folders, []);
    assert.equal((await folders.listFolders(A))[0].name, "Jane's CI plan");
  });
  await test("X3 the database itself refuses a row naming another household's document or person", async () => {
    await assert.rejects(pool.query("INSERT INTO policy_folder_documents(folder_id,account_id,policy_id) VALUES($1,$2,$3)", [janeFolder, A, bDoc]), /another household/);
    await assert.rejects(pool.query("INSERT INTO policy_folder_people(folder_id,account_id,family_member_id) VALUES($1,$2,$3)", [janeFolder, A, bPerson]), /another household/);
    await assert.rejects(pool.query("INSERT INTO policy_folder_documents(folder_id,account_id,policy_id) VALUES($1,$2,$3)", [janeFolder, B, bDoc]));
  });
  await test("M1 a household member (not the owner) sees the folders but every change is refused (403)", async () => {
    asUser(memberA);
    const got = await (await GET(req("/api/policies/folders", "GET", A))).json();
    assert.equal(got.canManage, false);
    assert.equal(got.folders.length, 2);
    assert.equal((await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [], complete: false }))).status, 403);
    assert.equal((await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", A, { remove: [sched] }), params(janeFolder))).status, 403);
    assert.equal((await item.DELETE(req(`/api/policies/folders/${janeFolder}`, "DELETE", A), params(janeFolder))).status, 403);
    assert.equal((await folders.listFolders(A))[0].documents.length, 2);
  });
  await test("M2 browser roles: a member reads only their own household's folders and can write none", async () => {
    const asBrowser = async <T>(userId: string, fn: () => Promise<T>) => serial(async () => {
      await db.query("BEGIN");
      try { await db.query("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]); return await fn(); }
      finally { await db.query("ROLLBACK"); }
    });
    assert.equal(await asBrowser(memberA, async () => (await db.query("SELECT 1 FROM policy_folders")).rows.length), 2);
    assert.equal(await asBrowser(ownerB, async () => (await db.query("SELECT 1 FROM policy_folder_documents")).rows.length), 0);
    for (const sql of ["INSERT INTO policy_folders(account_id) VALUES('" + A + "')", "DELETE FROM policy_folder_documents", "UPDATE policy_folders SET complete=false"])
      await assert.rejects(asBrowser(ownerA, () => db.query(sql)), /permission denied/, sql);
  });

  // ---- documents and people that leave
  await test("D1 a superseded schedule and a deleted document drop out of the folder; the folder stays", async () => {
    asUser(ownerA);
    assert.equal((await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", A, { add: [{ policyId: oldSched }, { policyId: rider }], complete: true }), params(janeFolder))).status, 200);
    await pool.query("UPDATE policies SET superseded_at=now() WHERE id=$1", [oldSched]);
    await pool.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [rider]);
    const f = (await folders.listFolders(A))[0];
    assert.deepEqual(f.documents.map((d) => d.policyId), [sched, wording]);
    const h = await household(A);
    assert.deepEqual(h.folders![0].documents, [sched, wording]);
  });
  await test("D2 a person removed from the household drops out of the folder's people", async () => {
    await pool.query("UPDATE family_members SET lifecycle_state='soft_deleted' WHERE id=$1", [john]);
    const f = (await folders.listFolders(A))[1];
    assert.deepEqual(f.people, []);
    const h = await household(A);
    assert.deepEqual(h.folders![1].people, []);
    assert.match(renderLibrary(h), /<policy id="P2" for="nobody \(not linked to anyone in DearPolicy\)"/);
    await pool.query("UPDATE family_members SET lifecycle_state='active' WHERE id=$1", [john]);
  });
  await test("D3 deleting the folder keeps every document in the library", async () => {
    asUser(ownerA);
    const second = (await folders.listFolders(A))[1].id;
    assert.equal((await item.DELETE(req(`/api/policies/folders/${second}`, "DELETE", A), params(second))).status, 200);
    assert.equal((await folders.listFolders(A)).length, 1);
    assert.equal((await pool.query("SELECT lifecycle_state FROM policies WHERE id=$1", [wording])).rows[0].lifecycle_state, "active");
    assert.equal((await item.DELETE(req(`/api/policies/folders/${second}`, "DELETE", A), params(second))).status, 400, "already gone");
  });
  await test("D4 the library sent to chat lists A's folder with its documents by id, and nothing of B's", async () => {
    const text = renderLibrary(await household(A));
    assert.match(text, /<policy id="P1" name="Jane's CI plan" for="Jane Doe" documents="D1, D2" all_documents="yes, confirmed by the household"\/>/);
    const b = await household(B);
    assert.equal(b.folders, undefined);
  });

  if (failures.length) { console.error(failures.join("\n\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`policy-folders: ${passed} passed, 0 failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

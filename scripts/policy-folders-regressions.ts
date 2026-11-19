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
  const autoRoute = await import("@/app/api/policies/folders/auto/route");
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
    assert.deepEqual(await res.json(), { ready: false, canManage: true, auto: false, handled: [], folders: [] });
    const made = await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [{ policyId: sched }], complete: false }));
    assert.equal(made.status, 409);
    assert.deepEqual(await folders.listFolders(A), []);
  });
  await test("R2 before the file is applied: the library sent to chat has no folders", async () => {
    const h = await readHousehold(A, async (sql, p) => (await pool.query(sql, p)).rows);
    assert.equal(h.folders, undefined);
    assert.ok(!/<policies/.test(renderLibrary(h)));
  });

  // An earlier draft of the file (5ebe6cb) made policy_folders with no confirmed_documents: with only that, nothing is
  // ready, so nothing reads the missing column; applying today's file adds it (TE #541 F1).
  await db.exec(await readFile(path.resolve("scripts/fixtures/policy-folders-5ebe6cb.sql"), "utf8"));
  await test("U1 an earlier draft's tables without the new column: not ready, chat unchanged", async () => {
    folders.resetFoldersReady();
    assert.equal(await folders.foldersReady(), false);
    asUser(ownerA);
    assert.equal((await (await GET(req("/api/policies/folders", "GET", A))).json()).ready, false);
  });
  // A folder the draft had confirmed, with one document in it.
  const draftFolder = id("c9800000", 1);
  await db.query("INSERT INTO policy_folders(id,account_id,complete) VALUES($1,$2,true)", [draftFolder, A]);
  await db.query("INSERT INTO policy_folder_documents(folder_id,account_id,policy_id) VALUES($1,$2,$3)", [draftFolder, A, sched]);
  await db.exec(await readFile(path.resolve("sql/policy-folders.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/policy-folders.sql"), "utf8")); // applying it twice is harmless
  folders.resetFoldersReady();
  await test("U2 applying the file over the earlier draft adds confirmed_documents, filled from a confirmed folder's documents", async () => {
    assert.equal(await folders.foldersReady(), true);
    assert.deepEqual((await pool.query("SELECT confirmed_documents FROM policy_folders WHERE id=$1", [draftFolder])).rows[0].confirmed_documents, [sched]);
    assert.equal((await folders.listFolders(A)).find((f) => f.id === draftFolder)!.complete, true);
    await pool.query("UPDATE policy_folders SET confirmed_documents='{}' WHERE id=$1", [draftFolder]);
    assert.equal((await folders.listFolders(A)).find((f) => f.id === draftFolder)!.complete, false, "an empty record is never a confirmation");
    await pool.query("DELETE FROM policy_folders WHERE id=$1", [draftFolder]);
  });

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
    assert.equal(f.complete, false, "a document confirmed as part of it has gone, so the household is asked again");
    const h = await household(A);
    assert.deepEqual(h.folders![0].documents, [sched, wording]);
    assert.equal(h.folders![0].complete, false, "chat is not told all documents are there");
    assert.match(renderLibrary(h), /all_documents="not confirmed"/);
    // Yes again: complete with what is there now.
    assert.equal((await item.PATCH(req(`/api/policies/folders/${janeFolder}`, "PATCH", A, { complete: true }), params(janeFolder))).status, 200);
    assert.equal((await folders.listFolders(A))[0].complete, true);
    assert.equal((await household(A)).folders![0].complete, true);
  });
  await test("D1c a document replaced by a newer copy: the copy is offered for the folder, not added on its own; Add it", async () => {
    asUser(ownerA);
    const old = id("f9800000", 10), copy = id("f9800000", 11);
    await doc(old, A, jane, "Schedule 2025.pdf");
    const res = await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [{ policyId: old, slot: "schedule" }], complete: true }));
    const fid = (await res.json()).id;
    await doc(copy, A, jane, "Schedule 2026.pdf");
    await pool.query("UPDATE policies SET supersedes_id=$1 WHERE id=$2", [old, copy]);
    await pool.query("UPDATE policies SET superseded_at=now() WHERE id=$1", [old]);
    let f = (await folders.listFolders(A)).find((x) => x.id === fid)!;
    assert.deepEqual(f.documents, []);
    assert.equal(f.complete, false);
    assert.deepEqual(f.replacements, [{ policyId: old, slot: "schedule", by: copy }]);
    assert.deepEqual((await household(A)).folders!.find((x) => x.id === fid)!.documents, [], "chat does not join the copy before the household adds it");
    assert.equal((await item.PATCH(req(`/api/policies/folders/${fid}`, "PATCH", A, { add: [{ policyId: copy, slot: "schedule" }] }), params(fid))).status, 200);
    f = (await folders.listFolders(A)).find((x) => x.id === fid)!;
    assert.deepEqual(f.documents, [{ policyId: copy, slot: "schedule" }]);
    assert.deepEqual(f.replacements, []);
    await item.DELETE(req(`/api/policies/folders/${fid}`, "DELETE", A), params(fid));
  });
  await test("D1b a confirmed folder whose document is permanently removed (its row gone) reads as not complete", async () => {
    asUser(ownerA);
    const tmp = id("f9800000", 9);
    await doc(tmp, A, jane, "Endorsement.pdf");
    const res = await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [{ policyId: tmp }, { policyId: sched }], complete: true }));
    const fid = (await res.json()).id;
    assert.equal((await folders.listFolders(A)).find((x) => x.id === fid)!.complete, true);
    await pool.query("DELETE FROM policies WHERE id=$1", [tmp]);
    assert.equal((await folders.listFolders(A)).find((x) => x.id === fid)!.complete, false);
    assert.equal((await household(A)).folders!.find((x) => x.id === fid)!.complete, false);
    await item.DELETE(req(`/api/policies/folders/${fid}`, "DELETE", A), params(fid));
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

  // ---- folders made for the household (sql/policy-folders-auto.sql; DC 19 Nov "Make them all automatically")
  const autoSched = id("f9800000", 21), autoReceipt = id("f9800000", 22), handFiled = id("f9800000", 23);
  for (const [pid, insurer, role, file] of [[autoSched, "Example Life Pte Ltd", "personal_schedule", "Auto schedule.pdf"], [autoReceipt, "Example Life Pte. Ltd.", "premium_receipt", "Auto receipt.pdf"], [handFiled, "Example Life", "personal_schedule", "Hand schedule.pdf"]])
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,document_role,policy_number,processing_status,original_filename,storage_key,file_hash,quarantine_status)
      VALUES($1,$2,$3,$4,'Example Shield',$5,'AU-123456','ready',$6,'k',$7,'scan_clean')`, [pid, A, jane, insurer, role, file, "sha256:" + pid]);
  const starter = { scheduleId: autoSched, people: [jane], documents: [{ policyId: autoSched, slot: "schedule" }, { policyId: autoReceipt, slot: "other" }] };
  const handled = async () => ((await (await GET(req("/api/policies/folders", "GET", A))).json()).handled as string[]).sort();
  const folderWith = async (pid: string) => (await folders.listFolders(A)).filter((f) => f.documents.some((d) => d.policyId === pid));

  await test("AU0 before the auto file is applied: GET says auto is off; making folders is refused (409); nothing written", async () => {
    folders.resetAutoFoldersReady(); asUser(ownerA);
    const got = await (await GET(req("/api/policies/folders", "GET", A))).json();
    assert.equal(got.auto, false); assert.deepEqual(got.handled, []);
    assert.equal((await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [starter] }))).status, 409);
    assert.deepEqual(await folderWith(autoSched), []);
  });
  await db.exec(await readFile(path.resolve("sql/policy-folders-auto.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/policy-folders-auto.sql"), "utf8")); // twice is harmless
  folders.resetAutoFoldersReady();
  await test("AU1 the owner's page makes one folder from a schedule and its same-number receipt, for Jane, not complete", async () => {
    asUser(ownerA);
    const res = await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [starter] }));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await res.json()).made, 1);
    const [f] = await folderWith(autoSched);
    assert.equal(f.complete, false); assert.equal(f.name, null);
    assert.deepEqual(f.people.map((p) => p.id), [jane]);
    assert.deepEqual(f.documents.map((d) => [d.policyId, d.slot]), [[autoSched, "schedule"], [autoReceipt, "other"]]);
    assert.deepEqual(await handled(), [autoSched, autoReceipt].sort());
  });
  await test("AU2 a second page (or a reload) asking again makes nothing more", async () => {
    assert.equal((await (await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [starter] }))).json()).made, 0);
    assert.equal((await folderWith(autoSched)).length, 1);
  });
  await test("AU3 a made folder the household deletes is never made again; its documents stay on file", async () => {
    const [f] = await folderWith(autoSched);
    assert.equal((await item.DELETE(req(`/api/policies/folders/${f.id}`, "DELETE", A), params(f.id))).status, 200);
    assert.equal((await (await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [starter] }))).json()).made, 0);
    assert.deepEqual(await folderWith(autoSched), []);
    assert.equal((await pool.query("SELECT lifecycle_state FROM policies WHERE id=$1", [autoSched])).rows[0].lifecycle_state, "active");
  });
  await test("AU4 a schedule the household filed by hand since the page loaded: no second folder", async () => {
    assert.equal((await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [{ policyId: handFiled }], complete: false }))).status, 200);
    const s = { scheduleId: handFiled, people: [jane], documents: [{ policyId: handFiled, slot: "schedule" }] };
    assert.equal((await (await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [s] }))).json()).made, 0);
    assert.equal((await folderWith(handFiled)).length, 1);
  });
  await test("AU5 a document taken out of a folder is never put back on its own", async () => {
    const [f] = await folderWith(handFiled);
    assert.equal((await item.PATCH(req(`/api/policies/folders/${f.id}`, "PATCH", A, { remove: [handFiled] }), params(f.id))).status, 200);
    assert.ok((await handled()).includes(handFiled));
    await item.DELETE(req(`/api/policies/folders/${f.id}`, "DELETE", A), params(f.id));
  });
  await test("AU6 a member is refused (403); another household's owner naming A's document or person is refused (400); nothing written", async () => {
    const fresh = id("f9800000", 24);
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,document_role,processing_status,original_filename,storage_key,file_hash,quarantine_status)
      VALUES($1,$2,$3,'Example Life','Example Shield','personal_schedule','ready','Fresh.pdf','k',$4,'scan_clean')`, [fresh, A, jane, "sha256:" + fresh]);
    const s = { scheduleId: fresh, people: [jane], documents: [{ policyId: fresh, slot: "schedule" }] };
    asUser(memberA);
    assert.equal((await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [s] }))).status, 403);
    asUser(ownerB);
    assert.equal((await autoRoute.POST(req("/api/policies/folders/auto", "POST", B, { starters: [s] }))).status, 400);
    assert.equal((await autoRoute.POST(req("/api/policies/folders/auto", "POST", B, { starters: [{ scheduleId: bDoc, people: [jane], documents: [{ policyId: bDoc }] }] }))).status, 400);
    asUser(ownerA);
    assert.deepEqual(await folderWith(fresh), []);
    assert.ok(!(await handled()).includes(fresh));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM policy_folder_auto WHERE account_id=$1", [B])).rows[0].n, 0);
  });
  await test("AU7 a starter without its schedule among its documents, or with no person, is refused", async () => {
    asUser(ownerA);
    assert.equal((await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [{ scheduleId: autoSched, people: [jane], documents: [{ policyId: wording }] }] }))).status, 400);
    assert.equal((await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [{ scheduleId: autoSched, people: [], documents: [{ policyId: autoSched }] }] }))).status, 400);
  });
  await test("AU9 a same-number document taken out of a folder, or filed by hand, is not put into a newly made one", async () => {
    asUser(ownerA);
    const s2 = id("f9800000", 25), took = id("f9800000", 26), hand = id("f9800000", 27);
    for (const [pid, role] of [[s2, "personal_schedule"], [took, "premium_receipt"], [hand, "policy_wording"]])
      await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,document_role,policy_number,processing_status,original_filename,storage_key,file_hash,quarantine_status)
        VALUES($1,$2,$3,'Example Life','Example Shield',$4,'AU-999999','ready','x.pdf','k',$5,'scan_clean')`, [pid, A, jane, role, "sha256:" + pid]);
    await pool.query("INSERT INTO policy_folder_auto(policy_id, account_id) VALUES($1,$2)", [took, A]);
    assert.equal((await POST(req("/api/policies/folders", "POST", A, { people: [jane], documents: [{ policyId: hand }], complete: false }))).status, 200);
    const res = await autoRoute.POST(req("/api/policies/folders/auto", "POST", A, { starters: [{ scheduleId: s2, people: [jane], documents: [{ policyId: s2, slot: "schedule" }, { policyId: took }, { policyId: hand }] }] }));
    assert.equal((await res.json()).made, 1);
    const [f] = await folderWith(s2);
    assert.deepEqual(f.documents.map((d) => d.policyId), [s2]);
    assert.equal((await folderWith(hand)).length, 1, "the hand-filed wording stays in its one folder");
  });
  await test("AU8 the database itself refuses a record naming another household's document; browsers can only read their own", async () => {
    await assert.rejects(pool.query("INSERT INTO policy_folder_auto(policy_id, account_id) VALUES($1,$2)", [bDoc, A]), /another household/);
    const asBrowser = async <T>(userId: string, fn: () => Promise<T>) => serial(async () => {
      await db.query("BEGIN");
      try { await db.query("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]); return await fn(); }
      finally { await db.query("ROLLBACK"); }
    });
    assert.ok(await asBrowser(memberA, async () => (await db.query("SELECT 1 FROM policy_folder_auto")).rows.length) > 0);
    assert.equal(await asBrowser(ownerB, async () => (await db.query("SELECT 1 FROM policy_folder_auto")).rows.length), 0);
    for (const sql of [`INSERT INTO policy_folder_auto(policy_id, account_id) VALUES('${id("f9800000", 24)}','${A}')`, "DELETE FROM policy_folder_auto"])
      await assert.rejects(asBrowser(ownerA, () => db.query(sql)), /permission denied/, sql);
  });

  if (failures.length) { console.error(failures.join("\n\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`policy-folders: ${passed} passed, 0 failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

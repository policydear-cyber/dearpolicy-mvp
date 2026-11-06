/**
 * Deleting a document really removes it (lib/lifecycle/content-scrub.ts). A made-up household (fictitious Malaysian
 * takaful in RM and a UK home policy in £) uploads documents, deletes one, and the test checks what is left: no page
 * text, passages, benefit lines or detected names; no filename, insurer or policy number on the tombstone; the stored
 * file removed from disk; search passages removed (and retried when that fails); the audit trail kept without
 * personal content; nothing touched on the documents still on file. Disposable PGlite database, no network.
 *   npm run lifecycle:content-scrub-test
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); }
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "scrub-test-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(root, "storage");
  delete process.env.SUPABASE_URL;

  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const f of ["schema", "claim-evidence", "critical-illness", "disability", "coverage-ledger", "lifecycle", "chat-upgrade", "background-jobs", "storage-purge", "cover-conditions", "processing-failure-diagnostics"]) {
    await db.exec(await readFile(path.resolve("sql/" + f + ".sql"), "utf8")).catch((e) => { throw new Error("sql/" + f + ".sql: " + (e as Error).message); });
  }
  // One connection, every query in order; a "client" from pool.connect() shares it (transactions run alone here).
  let tail = Promise.resolve();
  const run = async (text: string, params: unknown[] = []) => {
    const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous;
    try {
      if (!params.length && text.includes(";")) { const res = (await db.exec(text)).at(-1); return { rows: res?.rows ?? [], rowCount: res?.affectedRows ?? 0 }; }
      const res = await db.query(text, params); return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    } finally { release(); }
  };
  (pool as unknown as { query: unknown }).query = run;
  (pool as unknown as { connect: unknown }).connect = async () => ({ query: run, release() {} });
  const q = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => run(text, params) as Promise<{ rows: T[]; rowCount: number }>;

  const { requestPolicyDocumentDeletion, finishPolicyDocumentDeletion } = await import("@/lib/lifecycle/coordinator");
  const { scrubDeletedDocuments, DELETED_FILENAME } = await import("@/lib/lifecycle/content-scrub");
  const { drainStoragePurge } = await import("@/lib/storage/purge");

  // A made-up household: Rahman family, Kuala Lumpur.
  const accountId = randomUUID();
  await q(`INSERT INTO accounts(id,name) VALUES ($1,'Rahman household (fictitious)')`, [accountId]);
  const aisyah = randomUUID(), haziq = randomUUID();
  await q(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$3,'Nur Aisyah Rahman','self'),($2,$3,'Haziq Rahman','spouse')`, [aisyah, haziq, accountId]);

  async function upload(owner: string, opts: { filename: string; insurer: string; product: string; policyNo: string; hash: string; pages: string[]; amount: number; currency: string }) {
    const id = randomUUID();
    const key = [accountId, owner, id, opts.filename].join("/");
    await mkdir(path.dirname(path.join(process.env.LOCAL_STORAGE_DIR!, key)), { recursive: true });
    await writeFile(path.join(process.env.LOCAL_STORAGE_DIR!, key), "%PDF-1.4 " + opts.pages.join(" "));
    await q(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,quarantine_status,insurer,product_name,policy_number,extracted_json,effective_date,page_count)
             VALUES ($1,$2,$3,$4,$5,$6,'ready','scan_clean',$7,$8,$9,$10,'2025-01-01',$11)`,
      [id, accountId, owner, opts.filename, key, opts.hash, opts.insurer, opts.product, opts.policyNo, JSON.stringify({ insured: "Nur Aisyah Rahman", policyNumber: opts.policyNo }), opts.pages.length]);
    for (const [i, text] of opts.pages.entries()) {
      await q(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES ($1,$2,$3,$4)`, [accountId, id, i + 1, text]);
      await q(`INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,text) VALUES ($1,$2,$3,$4,$4,$5)`, [accountId, owner, id, i + 1, text]);
    }
    await q(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,notes) VALUES ($1,$2,$3,'death',$4,$5,'Death benefit')`, [accountId, id, owner, opts.amount, opts.currency]);
    await q(`INSERT INTO policy_detected_people(account_id,policy_id,detected_name) VALUES ($1,$2,'NUR AISYAH RAHMAN')`, [accountId, id]);
    await q(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES ($1,$2,$3)`, [id, owner, accountId]);
    await q(`INSERT INTO policy_document_audit_log(account_id,actor,action,previous_value,new_value,policy_id,reason) VALUES ($1,'system','scan_result_recorded','{"quarantineStatus":"scan_pending"}',$3,$2,'Scanner note for '||$4)`,
      [accountId, id, JSON.stringify({ quarantineStatus: "scan_clean", detail: "Insured: Nur Aisyah Rahman, " + opts.policyNo }), opts.filename]);
    return { id, key };
  }
  const contentCount = async (id: string) => {
    const r = await q<{ n: number }>(`SELECT (SELECT count(*) FROM policy_pages WHERE policy_id=$1)+(SELECT count(*) FROM policy_chunks WHERE policy_id=$1)+(SELECT count(*) FROM policy_coverages WHERE policy_id=$1)
      +(SELECT count(*) FROM policy_detected_people WHERE policy_id=$1)+(SELECT count(*) FROM policy_members WHERE policy_id=$1) AS n`, [id]);
    return Number(r.rows[0].n);
  };
  const exists = (p: string) => access(p).then(() => true, () => false);
  const fileOf = (key: string) => path.join(process.env.LOCAL_STORAGE_DIR!, key);
  const scoped = { query: run } as never;

  const takaful = await upload(aisyah, { filename: "Lindung-Keluarga-Takaful-Aisyah.pdf", insurer: "Lindung Takaful Berhad (fictitious)", product: "Lindung Keluarga", policyNo: "LK-55120931", hash: "h-takaful", pages: ["Sijil Takaful. Peserta: Nur Aisyah Rahman. Manfaat kematian RM250,000."], amount: 250000, currency: "MYR" });
  const home = await upload(haziq, { filename: "Thames-Home-Haziq.pdf", insurer: "Thames Mutual (fictitious)", product: "Thames Home", policyNo: "TH-0098812", hash: "h-home", pages: ["Policy schedule. Policyholder: Haziq Rahman. Buildings £350,000."], amount: 350000, currency: "GBP" });

  await t("deleting a document removes everything read from it, its filename and its stored file; the other document is untouched", async () => {
    const req = await requestPolicyDocumentDeletion({ client: scoped, accountId, actorUserId: randomUUID(), policyId: takaful.id, reasonCategory: "user_requested", idempotencyKey: "scrub-1" });
    assert.equal(req.status, "accepted");
    await finishPolicyDocumentDeletion({ accountId, actorUserId: randomUUID(), policyId: takaful.id, deletionRequestId: req.deletionRequestId });
    const row = (await q<Record<string, unknown>>(`SELECT * FROM policies WHERE id=$1`, [takaful.id])).rows[0];
    assert.equal(row.lifecycle_state, "soft_deleted");
    assert.equal(row.original_filename, DELETED_FILENAME);
    assert.equal(row.storage_key, "deleted/" + takaful.id);
    for (const c of ["insurer", "product_name", "policy_number", "extracted_json", "file_hash", "effective_date", "page_count"]) assert.equal(row[c], null, c + " is cleared");
    assert.equal(await contentCount(takaful.id), 0, "no pages, passages, benefit lines, names or member links remain");
    assert.equal(await exists(fileOf(takaful.key)), false, "the stored file is removed from disk");
    const dump = JSON.stringify((await q(`SELECT p.*, (SELECT json_agg(a) FROM policy_document_audit_log a WHERE a.policy_id=p.id) AS audit FROM policies p WHERE p.id=$1`, [takaful.id])).rows);
    for (const personal of ["Aisyah", "AISYAH", "Lindung", "LK-55120931", "RM250,000", "Takaful-Aisyah"]) assert.ok(!dump.includes(personal), "nothing personal left on the tombstone or its audit: " + personal);
    // The other document, and Haziq's file, are exactly as they were.
    const other = (await q<Record<string, unknown>>(`SELECT * FROM policies WHERE id=$1`, [home.id])).rows[0];
    assert.equal(other.lifecycle_state, "active"); assert.equal(other.original_filename, "Thames-Home-Haziq.pdf"); assert.equal(other.insurer, "Thames Mutual (fictitious)");
    assert.equal(await contentCount(home.id), 5); assert.equal(await exists(fileOf(home.key)), true);
  });

  await t("the audit trail is kept, with who, what and when, and only status keys in its payloads", async () => {
    const audit = (await q<{ action: string; actor: string; occurred_at: unknown; previous_value: unknown; new_value: unknown; reason: string | null }>(
      `SELECT action, actor, occurred_at, previous_value, new_value, reason FROM policy_document_audit_log WHERE policy_id=$1 ORDER BY id`, [takaful.id])).rows;
    // Both entries stay, once each. Another content-free entry a later deletion step adds (for example a marker that
    // it ran) is allowed; every entry, whatever its action, keeps only who/what/when and status keys.
    const only = (action: string) => { const xs = audit.filter((a) => a.action === action); assert.equal(xs.length, 1, action + " entries: " + audit.map((a) => a.action).join(",")); return xs[0]; };
    assert.deepEqual(only("scan_result_recorded").new_value, { quarantineStatus: "scan_clean" });
    assert.deepEqual(only("deleted").new_value, { quarantineStatus: "deleted" });
    assert.ok(audit.every((a) => a.actor && a.occurred_at && a.reason == null));
    const statusKeys = new Set(["quarantineStatus", "status", "scanStatus"]);
    for (const a of audit) for (const v of [a.previous_value, a.new_value]) {
      if (v != null) assert.ok(Object.keys(v as object).every((k) => statusKeys.has(k)), a.action + " keeps " + JSON.stringify(v));
    }
    const log = (await q(`SELECT resource_id, to_state FROM deletion_audit_log WHERE resource_id=$1`, [takaful.id])).rows;
    assert.ok(log.length >= 1, "the deletion itself stays on record");
  });

  await t("once its file is removed, the removal queue forgets the key (which held the filename)", async () => {
    await scrubDeletedDocuments();
    const keys = (await q<{ storage_key: string; purged_at: unknown }>(`SELECT storage_key, purged_at FROM storage_purge_queue`)).rows;
    assert.ok(keys.length >= 1 && keys.every((k) => k.purged_at != null && k.storage_key.startsWith("purged/")), JSON.stringify(keys));
  });

  await t("the same file can be uploaded again after it was deleted (its content hash is released)", async () => {
    await q(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status) VALUES ($1,$2,$3,'again.pdf','k/again.pdf','h-takaful','queued')`, [randomUUID(), accountId, aisyah]);
  });

  await t("search passages are removed first; when that fails nothing is scrubbed yet, and the next pass finishes it", async () => {
    const travel = await upload(haziq, { filename: "Wanderlust-Trip-Haziq.pdf", insurer: "Wanderlust Assurance (fictitious)", product: "Single Trip", policyNo: "WT-771", hash: "h-trip", pages: ["Overseas medical expenses S$250,000."], amount: 250000, currency: "SGD" });
    const req = await requestPolicyDocumentDeletion({ client: scoped, accountId, actorUserId: randomUUID(), policyId: travel.id, reasonCategory: "user_requested", idempotencyKey: "scrub-2" });
    await q(`UPDATE deletion_requests SET lifecycle_state='soft_deleted' WHERE id=$1`, [req.deletionRequestId]);
    const calls: string[] = [];
    const down = { enabled: () => true, deletePassages: async (a: { policyId: string }) => { calls.push(a.policyId); throw new Error("index unavailable"); } };
    const first = await scrubDeletedDocuments({ pinecone: down });
    assert.deepEqual(first.searchIndexPending, [travel.id]); assert.equal(first.scrubbed, 0);
    assert.equal(await contentCount(travel.id), 5, "content stays until its passages are gone, so the retry can find them");
    const up = { enabled: () => true, deletePassages: async (a: { accountId: string; policyId: string }) => { calls.push(a.policyId); assert.equal(a.accountId, accountId); } };
    const second = await scrubDeletedDocuments({ pinecone: up });
    assert.equal(second.scrubbed, 1); assert.deepEqual(calls, [travel.id, travel.id]);
    assert.equal(await contentCount(travel.id), 0);
    await drainStoragePurge();
    assert.equal(await exists(fileOf(travel.key)), false);
    assert.equal((await scrubDeletedDocuments({ pinecone: up })).scrubbed, 0, "a scrubbed document is never picked again");
  });

  await t("a deletion that crashed half-way (stuck in pending_deletion over an hour) is finished by the next pass; a fresh one and active ones are not", async () => {
    const stuck = await upload(aisyah, { filename: "Old-Medical-Card-Aisyah.pdf", insurer: "Sihat Takaful (fictitious)", product: "Kad Perubatan", policyNo: "SM-1", hash: "h-stuck", pages: ["Had tahunan RM150,000."], amount: 150000, currency: "MYR" });
    const fresh = await upload(aisyah, { filename: "New-Card-Aisyah.pdf", insurer: "Sihat Takaful (fictitious)", product: "Kad Baru", policyNo: "SM-2", hash: "h-fresh", pages: ["Had tahunan RM200,000."], amount: 200000, currency: "MYR" });
    await q(`UPDATE policies SET lifecycle_state='pending_deletion', updated_at=now()-interval '2 hours' WHERE id=$1`, [stuck.id]);
    await q(`UPDATE policies SET lifecycle_state='pending_deletion' WHERE id=$1`, [fresh.id]);
    const r = await scrubDeletedDocuments({ pinecone: { enabled: () => false, deletePassages: async () => { throw new Error("not called"); } } });
    assert.equal(r.scrubbed, 1);
    assert.equal(await contentCount(stuck.id), 0); assert.equal(await contentCount(fresh.id), 5, "a deletion still in progress is left to finish");
    assert.equal(await contentCount(home.id), 5, "an active document is never touched");
    await drainStoragePurge();
    assert.equal(await exists(fileOf(stuck.key)), false); assert.equal(await exists(fileOf(fresh.key)), true);
  });

  await t("a failure inside the scrub changes nothing (one transaction), and the next pass retries", async () => {
    const doc = await upload(haziq, { filename: "Motor-Haziq.pdf", insurer: "Kereta Insurans (fictitious)", product: "Motor", policyNo: "KM-9", hash: "h-motor", pages: ["Third party RM3,000,000."], amount: 3000000, currency: "MYR" });
    await q(`UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1`, [doc.id]);
    const failing = <T,>(fn: (tx: never) => Promise<T>) => db.transaction(async (tx) => {
      await fn({ query: async (text: string, params: unknown[] = []) => { const res = await tx.query(text, params); return { rows: res.rows, rowCount: res.affectedRows ?? 0 }; } } as never);
      throw new Error("connection lost");
    }) as Promise<T>;
    const r = await scrubDeletedDocuments({ policyIds: [doc.id], transaction: failing });
    assert.equal(r.failed, 1); assert.equal(r.scrubbed, 0);
    assert.equal(await contentCount(doc.id), 5);
    assert.equal((await q<{ original_filename: string }>(`SELECT original_filename FROM policies WHERE id=$1`, [doc.id])).rows[0].original_filename, "Motor-Haziq.pdf");
    assert.equal((await scrubDeletedDocuments({ policyIds: [doc.id] })).scrubbed, 1);
    assert.equal(await contentCount(doc.id), 0);
  });

  const pineconeSpy = (calls: string[]) => ({ enabled: () => true, deletePassages: async (a: { policyId: string }) => { calls.push(a.policyId); } });

  await t("a reading still running when the document was deleted: what it writes afterwards goes on the next pass, its passages are removed again, then nothing more", async () => {
    const doc = await upload(aisyah, { filename: "Kembara-Travel-Aisyah.pdf", insurer: "Kembara Takaful (fictitious)", product: "Kembara Plus", policyNo: "KT-4410", hash: "h-kembara", pages: ["Perubatan luar negara RM500,000."], amount: 500000, currency: "MYR" });
    const req = await requestPolicyDocumentDeletion({ client: scoped, accountId, actorUserId: randomUUID(), policyId: doc.id, reasonCategory: "user_requested", idempotencyKey: "scrub-inflight" });
    await finishPolicyDocumentDeletion({ accountId, actorUserId: randomUUID(), policyId: doc.id, deletionRequestId: req.deletionRequestId });
    assert.equal(await contentCount(doc.id), 0);
    // The reading that was already running writes its next step after the scrub (as lib/rag/ingest.ts did before it checked).
    await q(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES ($1,$2,1,'Peserta: Nur Aisyah Rahman')`, [accountId, doc.id]);
    await q(`INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,text) VALUES ($1,$2,$3,1,1,'Peserta: Nur Aisyah Rahman')`, [accountId, aisyah, doc.id]);
    await q(`UPDATE policies SET insurer='Kembara Takaful (fictitious)', processing_message='Saving searchable text…' WHERE id=$1`, [doc.id]);
    const calls: string[] = [];
    const again = await scrubDeletedDocuments({ pinecone: pineconeSpy(calls) });
    assert.equal(again.scrubbed, 1);
    assert.deepEqual(calls, [doc.id], "its search passages are removed again (the late reading may have added some)");
    assert.equal(await contentCount(doc.id), 0);
    const row = (await q<Record<string, unknown>>(`SELECT original_filename, insurer, processing_message, storage_key FROM policies WHERE id=$1`, [doc.id])).rows[0];
    assert.deepEqual(row, { original_filename: DELETED_FILENAME, insurer: null, processing_message: null, storage_key: "deleted/" + doc.id });
    const quiet: string[] = [];
    assert.equal((await scrubDeletedDocuments({ pinecone: pineconeSpy(quiet) })).scrubbed, 0, "a clean tombstone is not picked again");
    assert.deepEqual(quiet, []);
    assert.equal(await contentCount(home.id), 5, "an active document is never touched");
  });

  await t("the raw failure notes kept for support about a deleted document go too; another document's stay", async () => {
    const doc = await upload(haziq, { filename: "Pet-Cover-Haziq.pdf", insurer: "Paws Mutual (fictitious)", product: "Paws Plus", policyNo: "PM-88", hash: "h-pet", pages: ["Vet fees £4,000."], amount: 4000, currency: "GBP" });
    await q(`INSERT INTO processing_failure_diagnostics(account_id,resource_type,resource_id,failure_code,detail) VALUES ($1,'policy_document',$2,'PROCESSING_FAILED','reader failed on '||$3),($1,'policy_scan',$2,'SCAN_DETAIL','scan of '||$3),($1,'policy_document',$4,'PROCESSING_FAILED','other doc')`,
      [accountId, doc.id, doc.key, home.id]);
    const req = await requestPolicyDocumentDeletion({ client: scoped, accountId, actorUserId: randomUUID(), policyId: doc.id, reasonCategory: "user_requested", idempotencyKey: "scrub-diag" });
    await finishPolicyDocumentDeletion({ accountId, actorUserId: randomUUID(), policyId: doc.id, deletionRequestId: req.deletionRequestId });
    const left = (await q<{ resource_id: string }>(`SELECT resource_id::text AS resource_id FROM processing_failure_diagnostics WHERE account_id=$1`, [accountId])).rows.map((r) => r.resource_id);
    assert.deepEqual(left, [home.id]);
  });

  await t("deleting a document strips the PDF password and file key from BOTH its reading job and its scheduled re-read, and stops both", async () => {
    const doc = await upload(aisyah, { filename: "Locked-Life-Aisyah.pdf", insurer: "Amanah Life (fictitious)", product: "Amanah Term", policyNo: "AL-123456789", hash: "h-locked", pages: ["Sum assured RM300,000."], amount: 300000, currency: "MYR" });
    const payload = JSON.stringify({ policyId: doc.id, storageKey: doc.key, pdfPassword: "s3cret-fictitious", familyMemberId: aisyah });
    await q(`INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload,status,last_error_message) VALUES
      ($1,'policy_processing',$2,$3::jsonb,'failed_retryable','reader failed on '||$4),
      ($1,'policy_processing',$2||':retry-read',$3::jsonb,'queued',NULL),
      ($1,'policy_processing',$5,$6::jsonb,'queued',NULL)`,
      [accountId, doc.id, payload, doc.key, home.id, JSON.stringify({ policyId: home.id, storageKey: home.key, pdfPassword: "keep-me" })]);
    const req = await requestPolicyDocumentDeletion({ client: scoped, accountId, actorUserId: randomUUID(), policyId: doc.id, reasonCategory: "user_requested", idempotencyKey: "scrub-jobs" });
    assert.equal(req.status, "accepted");
    const jobs = (await q<{ idempotency_key: string; payload: Record<string, unknown>; cancel_requested: boolean; last_error_message: string | null }>(
      `SELECT idempotency_key, payload, cancel_requested, last_error_message FROM background_jobs WHERE account_id=$1 ORDER BY idempotency_key`, [accountId])).rows;
    for (const j of jobs.filter((x) => x.idempotency_key.startsWith(doc.id))) {
      assert.equal(j.payload.pdfPassword, undefined, j.idempotency_key + " password"); assert.equal(j.payload.storageKey, undefined, j.idempotency_key + " file key");
      assert.equal(j.cancel_requested, true, j.idempotency_key + " stopped"); assert.equal(j.last_error_message, null);
    }
    assert.equal(jobs.filter((x) => x.idempotency_key.startsWith(doc.id)).length, 2);
    const other = jobs.find((x) => x.idempotency_key === home.id)!;
    assert.equal(other.payload.pdfPassword, "keep-me"); assert.equal(other.cancel_requested, false, "another document's job is untouched");
  });

  await t("a reading stops at its next step once its document is deleted, and writes nothing on the deleted document", async () => {
    const { recordReadingProgress, DocumentDeletedWhileReadingError } = await import("@/lib/rag/ingest");
    const doc = await upload(haziq, { filename: "Gadget-Haziq.pdf", insurer: "Gizmo Cover (fictitious)", product: "Gizmo", policyNo: "GC-1", hash: "h-gadget", pages: ["Phone £900."], amount: 900, currency: "GBP" });
    const args = { accountId, policyId: doc.id, familyMemberId: haziq, storageKey: doc.key } as never;
    await recordReadingProgress(args, "reading_pdf", 7, "Reading pages…", "extracting");
    assert.equal((await q<{ processing_message: string }>(`SELECT processing_message FROM policies WHERE id=$1`, [doc.id])).rows[0].processing_message, "Reading pages…");
    await q(`UPDATE policies SET lifecycle_state='pending_deletion', processing_message=NULL WHERE id=$1`, [doc.id]);
    await assert.rejects(recordReadingProgress(args, "saving_text", 27, "Saving searchable text…", "extracting"), DocumentDeletedWhileReadingError);
    assert.equal((await q<{ processing_message: string | null }>(`SELECT processing_message FROM policies WHERE id=$1`, [doc.id])).rows[0].processing_message, null);
  });

  await t("the request drain and the daily job both run the scrub, so a failed cleanup is retried without anyone asking", async () => {
    const drain = await readFile("lib/jobs/request-drain.ts", "utf8");
    const cron = await readFile("app/api/internal/jobs/run/route.ts", "utf8");
    assert.match(drain, /scrubDeletedDocuments\(\)/); assert.match(cron, /await scrubDeletedDocuments\(\)/);
    assert.ok(drain.indexOf("scrubDeletedDocuments") < drain.indexOf("purgeSoon()"), "scrub (which queues files) runs before the file purge");
  });

  await rm(root, { recursive: true, force: true });
  console.log(`\ndeleted document content scrub: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

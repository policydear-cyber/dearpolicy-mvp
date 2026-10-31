/**
 * Deleting a document also removes what claim calculations took from it (lib/lifecycle/claim-snapshot-scrub.ts).
 * A made-up household (a fictitious Mexican life policy in MX$ and a hospital plan in US$) has claim calculations that
 * used one document, both, or only the other; then one document is deleted. The test checks that every calculation
 * that used it keeps only which calculation it was (no amount, plan, quote, page or coverage version), that the
 * person's own facts about the event stay, that calculations using only the kept document and other households are
 * untouched, and that a later pass catches up and is idempotent. Disposable PGlite database, no network.
 *   npm run lifecycle:claim-snapshot-scrub-test
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n").slice(0, 12).join(" | ") : String(e))); }
}

async function main() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const f of ["schema", "claim-evidence", "critical-illness", "disability", "coverage-ledger", "lifecycle", "chat-upgrade", "background-jobs", "storage-purge", "cover-conditions", "claim-composition"]) {
    await db.exec(await readFile(path.resolve("sql/" + f + ".sql"), "utf8")).catch((e) => { throw new Error("sql/" + f + ".sql: " + (e as Error).message); });
  }
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
  const { scrubDeletedDocumentClaimSnapshots, SNAPSHOT_REDACTED_REASON, CLAIM_SNAPSHOT_SCRUB_ACTION } = await import("@/lib/lifecycle/claim-snapshot-scrub");

  async function household(name: string) {
    const id = randomUUID();
    await q(`INSERT INTO accounts(id,name) VALUES ($1,$2)`, [id, name]);
    return id;
  }
  async function member(accountId: string, name: string) {
    const id = randomUUID();
    await q(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,$3,'self')`, [id, accountId, name]);
    return id;
  }
  async function doc(accountId: string, owner: string, file: string, product: string) {
    const id = randomUUID();
    await q(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,insurer,product_name)
             VALUES ($1,$2,$3,$4,$5,'ready','scan_clean','Aseguradora Sol (fictitious)',$6)`, [id, accountId, owner, file, accountId + "/" + id + "/" + file, product]);
    await q(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES ($1,$2,$3)`, [id, owner, accountId]);
    return id;
  }
  async function claim(accountId: string, owner: string) {
    const r = await q<{ id: string }>(`INSERT INTO claim_sessions(account_id,family_member_id) VALUES ($1,$2) RETURNING id::text AS id`, [accountId, owner]);
    return r.rows[0].id;
  }
  const section = (policyId: string, plan: string, amount: number, currency: string, quote: string) => ({
    policyId, policyLabel: plan, benefits: [{ policyId, benefitCode: "hospital_cash", payableAmount: amount, currency, evidenceRef: { policyId, chunkId: "c-" + policyId, pageStart: 4, pageEnd: 4, quote } }],
  });
  async function snapshot(accountId: string, owner: string, claimId: string, facts: unknown, sections: ReturnType<typeof section>[]) {
    const calc = "calc-" + randomUUID();
    const r = await q<{ id: string }>(`INSERT INTO claim_composition_snapshots(account_id,family_member_id,claim_session_id,calculation_id,engine_version,facts_snapshot,coverage_versions,result,calculated_at)
      VALUES ($1,$2,$3,$4,'v7',$5::jsonb,$6::jsonb,$7::jsonb,now()) RETURNING id::text AS id`,
      [accountId, owner, claimId, calc, JSON.stringify(facts),
       JSON.stringify(sections.map((s) => ({ policyId: s.policyId, coverageId: randomUUID(), effectiveDate: "2025-01-01", renewalOrExpiryDate: null }))),
       JSON.stringify({ calculationId: calc, engineVersion: "v7", sections, totals: sections.map((s) => s.benefits[0]).map((b) => ({ amount: b.payableAmount, currency: b.currency })), disclaimer: "Your insurer decides claims." })]);
    return { id: r.rows[0].id, calc };
  }
  const row = async (id: string) => (await q<{ result: Record<string, unknown>; coverage_versions: unknown; facts_snapshot: Record<string, unknown>; calculation_id: string }>(
    `SELECT result, coverage_versions, facts_snapshot, calculation_id FROM claim_composition_snapshots WHERE id=$1`, [id])).rows[0];

  // The Ruiz household (fictitious), Guadalajara.
  const acc = await household("Ruiz household (fictitious)");
  const sofia = await member(acc, "Sofía Ruiz Hernández");
  const vida = await doc(acc, sofia, "Vida-Plena-Sofia.pdf", "Vida Plena");
  const salud = await doc(acc, sofia, "Salud-Total-Sofia.pdf", "Salud Total");
  const c1 = await claim(acc, sofia);
  const personFacts = { eventType: "hospitalisation", eventDate: "2026-09-12", hospitalised: true, hospitalNights: 4, hospitalBill: 38500, injuries: ["fractura de muñeca"] };
  const factsWithMatch = { ...personFacts, causeDefinitionMatches: [{ policyId: vida, matched: true, definitionQuote: "muerte accidental: lesión corporal" }, { policyId: salud, matched: false }],
    priorPaidAmounts: { [vida]: { amount: 5000, currency: "MXN", recordedAt: "2026-09-01" }, [salud]: { amount: 100, currency: "USD", recordedAt: "2026-09-01" } } };
  const vidaQuote = "Indemnización diaria por hospitalización: MX$ 2,500 por día. Asegurada: Sofía Ruiz Hernández.";
  const onlyVida = await snapshot(acc, sofia, c1, factsWithMatch, [section(vida, "Vida Plena Hospital", 10000, "MXN", vidaQuote)]);
  const both = await snapshot(acc, sofia, c1, personFacts, [section(vida, "Vida Plena Hospital", 10000, "MXN", vidaQuote), section(salud, "Salud Total", 1200, "USD", "Room and board up to US$ 300 a day")]);
  const onlySalud = await snapshot(acc, sofia, c1, personFacts, [section(salud, "Salud Total", 1200, "USD", "Room and board up to US$ 300 a day")]);

  // Another household whose snapshot (wrongly) carries the same id text must never be touched.
  const other = await household("Okafor household (fictitious)");
  const ada = await member(other, "Ada Okafor");
  const otherDoc = await doc(other, ada, "Lagos-Shield.pdf", "Lagos Shield");
  const otherSnap = await snapshot(other, ada, await claim(other, ada), { note: vida }, [section(otherDoc, "Lagos Shield", 500000, "NGN", "₦500,000 hospital cash")]);

  const scoped = { query: run } as never;

  await t("deleting a document redacts every claim calculation that used it: only which calculation it was is kept", async () => {
    const req = await requestPolicyDocumentDeletion({ client: scoped, accountId: acc, actorUserId: randomUUID(), policyId: vida, reasonCategory: "user_requested", idempotencyKey: "snap-1" });
    assert.equal(req.status, "accepted");
    await finishPolicyDocumentDeletion({ accountId: acc, actorUserId: randomUUID(), policyId: vida, deletionRequestId: req.deletionRequestId });
    for (const s of [onlyVida, both]) {
      const r = await row(s.id);
      assert.deepEqual(r.result, { redacted: { reason: SNAPSHOT_REDACTED_REASON }, calculationId: s.calc, engineVersion: "v7" });
      assert.deepEqual(r.coverage_versions, []);
      assert.equal(r.calculation_id, s.calc);
      const all = JSON.stringify(r);
      for (const w of [vida, "Vida Plena", "2,500", "10000", "Sofía", "muerte accidental", "c-" + vida, "Room and board", "1200"]) assert.ok(!all.includes(w), w + " left in a redacted calculation");
    }
  });
  await t("the person's own facts about the event stay; a fact tied to the deleted document goes", async () => {
    const f = (await row(onlyVida.id)).facts_snapshot;
    assert.deepEqual(f, { ...personFacts, causeDefinitionMatches: [{ policyId: salud, matched: false }], priorPaidAmounts: { [salud]: { amount: 100, currency: "USD", recordedAt: "2026-09-01" } } });
    assert.deepEqual((await row(both.id)).facts_snapshot, personFacts);
  });
  await t("a calculation that used only the kept document, and another household's, are untouched", async () => {
    const r = await row(onlySalud.id);
    assert.match(JSON.stringify(r.result), /Room and board up to US\$ 300 a day/);
    assert.equal((r.coverage_versions as unknown[]).length, 1);
    assert.match(JSON.stringify((await row(otherSnap.id)).facts_snapshot), new RegExp(vida));
    assert.match(JSON.stringify((await row(otherSnap.id)).result), /Lagos Shield/);
  });
  await t("each deleted document is handled once and marked done with a content-free entry; a second pass changes nothing", async () => {
    const marks = (await q<{ new_value: unknown; reason: string | null; previous_value: unknown }>(`SELECT new_value, reason, previous_value FROM policy_document_audit_log WHERE policy_id=$1 AND action=$2`, [vida, CLAIM_SNAPSHOT_SCRUB_ACTION])).rows;
    assert.equal(marks.length, 1); assert.deepEqual(marks[0].new_value, { status: CLAIM_SNAPSHOT_SCRUB_ACTION }); assert.equal(marks[0].reason, null); assert.equal(marks[0].previous_value, null);
    const before = JSON.stringify(await q(`SELECT * FROM claim_composition_snapshots ORDER BY id`));
    assert.deepEqual(await scrubDeletedDocumentClaimSnapshots(), { documents: 0, snapshotsRedacted: 0, failed: 0 });
    assert.equal(JSON.stringify(await q(`SELECT * FROM claim_composition_snapshots ORDER BY id`)), before);
  });
  await t("a document deleted before this existed is caught up by the next drain pass; one still on file is never handled", async () => {
    const acc2 = await household("Nguyen household (fictitious)");
    const lan = await member(acc2, "Nguyễn Thị Lan");
    const bao = await doc(acc2, lan, "Bao-Viet-An-Tam.pdf", "An Tâm");
    const kept = await doc(acc2, lan, "Song-Khoe.pdf", "Sống Khỏe");
    const cl = await claim(acc2, lan);
    const s1 = await snapshot(acc2, lan, cl, { hospitalNights: 2 }, [section(bao, "An Tâm", 20000000, "VND", "Trợ cấp nằm viện 20.000.000 ₫")]);
    const s2 = await snapshot(acc2, lan, cl, { hospitalNights: 2 }, [section(kept, "Sống Khỏe", 5000000, "VND", "5.000.000 ₫ mỗi ngày")]);
    // A calculation that names the document only inside its result (no coverage version recorded) is found too.
    const s3 = await snapshot(acc2, lan, cl, { hospitalNights: 2 }, [section(bao, "An Tâm", 1000000, "VND", "1.000.000 ₫")]);
    await q(`UPDATE claim_composition_snapshots SET coverage_versions='[]'::jsonb WHERE id=$1`, [s3.id]);
    assert.deepEqual(await scrubDeletedDocumentClaimSnapshots({ policyIds: [kept] }), { documents: 0, snapshotsRedacted: 0, failed: 0 }, "a document on file is never handled");
    await q(`UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1`, [bao]);
    const r = await scrubDeletedDocumentClaimSnapshots();
    assert.deepEqual(r, { documents: 1, snapshotsRedacted: 2, failed: 0 });
    assert.deepEqual((await row(s3.id)).result.redacted, { reason: SNAPSHOT_REDACTED_REASON });
    assert.deepEqual((await row(s1.id)).result.redacted, { reason: SNAPSHOT_REDACTED_REASON });
    assert.deepEqual((await row(s1.id)).facts_snapshot, { hospitalNights: 2 });
    assert.match(JSON.stringify((await row(s2.id)).result), /5\.000\.000/);
  });
  await t("a second deleted document still cleans the facts of a calculation already redacted for the first", async () => {
    await q(`UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1`, [salud]);
    assert.deepEqual(await scrubDeletedDocumentClaimSnapshots(), { documents: 1, snapshotsRedacted: 2, failed: 0 });
    const f = (await row(onlyVida.id)).facts_snapshot;
    assert.deepEqual(f, { ...personFacts, causeDefinitionMatches: [], priorPaidAmounts: {} });
    assert.deepEqual((await row(onlySalud.id)).result.redacted, { reason: SNAPSHOT_REDACTED_REASON });
  });
  await t("a failure leaves the document unmarked, so the next pass retries it", async () => {
    const acc3 = await household("Haddad household (fictitious)");
    const ali = await member(acc3, "Ali Haddad");
    const d = await doc(acc3, ali, "Sanad-Care.pdf", "Sanad Care");
    const s = await snapshot(acc3, ali, await claim(acc3, ali), { hospitalNights: 1 }, [section(d, "Sanad Care", 900, "JOD", "JOD 900 per stay")]);
    await q(`UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1`, [d]);
    let calls = 0;
    const flaky = { query: (text: string, params?: unknown[]) => { if (/^\s*UPDATE claim_composition_snapshots/.test(text) && calls++ === 0) return Promise.reject(new Error("lost")); return run(text, params); } };
    assert.deepEqual(await scrubDeletedDocumentClaimSnapshots({ db: flaky as never, policyIds: [d] }), { documents: 0, snapshotsRedacted: 0, failed: 1 });
    assert.match(JSON.stringify((await row(s.id)).result), /JOD 900/);
    assert.deepEqual(await scrubDeletedDocumentClaimSnapshots({ db: flaky as never }), { documents: 1, snapshotsRedacted: 1, failed: 0 });
  });
  await t("the request drain runs it", async () => {
    const src = await readFile(path.resolve("lib/jobs/request-drain.ts"), "utf8");
    assert.match(src, /claim-snapshot-scrub"\)\)\.scrubDeletedDocumentClaimSnapshots\(\)/);
  });
  await t("a pass never throws, even when the database fails", async () => {
    const broken = { query: async () => { throw new Error("connection lost"); } };
    assert.deepEqual(await scrubDeletedDocumentClaimSnapshots({ db: broken as never }), { documents: 0, snapshotsRedacted: 0, failed: 0 });
  });

  console.log(`\nclaim snapshot scrub: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Roster certificates (node --import tsx scripts/rag2-roster-regressions.ts; npm run rag2:roster-test).
 *
 * A group certificate prints one insured person per ROW under each product's heading (masked ID | name | sum assured |
 * effective date). The person is the row, not a column: select_table_value must read the subject's own row under the
 * product asked for -- whatever order the certificate prints the name in -- never another insured person's row, and
 * nothing for a member the certificate does not name. The first product heading (directly under the column caption)
 * is a section like the others. A lump sum then uses that sum assured with the wording's printed percentage (20% of
 * S$600,000 = S$120,000). A plain schedule whose "Life Assured" line names the person is unchanged (control).
 * PGlite with the real schema; synthetic household (scripts/fixtures/rag2-roster). Exit 1 on a failure.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT, DOCS, M, doc } from "./fixtures/rag2-roster/household";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const ON = { DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;

async function main() {
  const T = await import("@/lib/rag2/tables");
  const cert = doc("CERT");
  await check("R1 the certificate parses as one roster: every row keeps its product heading, the first heading (under the column caption) included", () => {
    const tables = T.parseTables(cert.id, [{ page: 1, text: cert.pages[1] }]);
    const rows = tables.flatMap((t) => t.rows);
    assert.equal(rows.length, 8, "eight person rows");
    assert.deepEqual([...new Set(rows.map((r) => r.section))], ["GROUP TERM LIFE(POLICY NO.HL7700123)", "GROUP PERSONAL ACCIDENT(POLICY NO. HL7700123)", "GROUP LIVING CARE(POLICY NO. HL7700123)", "GROUP LIVING CARE PLUS(POLICY NO. HL7700123)"]);
    const hh = [{ id: M.alex.id, names: [M.alex.name, M.alex.pref] }, { id: M.bea.id, names: [M.bea.name, M.bea.pref] }, { id: M.cai.id, names: [M.cai.name, M.cai.pref] }];
    const ro = T.rosterOf(tables[0], M.alex.id, hh);
    assert.ok(ro, "a roster for Alex"); assert.equal(ro!.mine.size, 4); assert.equal(ro!.others.size, 4);
    assert.equal(T.rosterOf(tables[0], M.cai.id, hh), null, "Cai is not on the certificate");
  });

  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const execute = async (text: string, params: unknown[] = []) => { if (!params.length && /;\s*\S/.test(text)) { await db.exec(text); return { rows: [], rowCount: 0 }; } const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  pool.query = (async (text: string, params: unknown[] = []) => execute(text, params)) as typeof pool.query;
  pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
  globalThis.fetch = (async () => { throw new Error("network disabled in rag2-roster"); }) as typeof fetch;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household R')", [ACCOUNT]);
  for (const p of Object.values(M)) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,date_of_birth) VALUES($1,$2,$3,$4,$5,$6)", [p.id, ACCOUNT, p.name, p.pref, p.rel, p.dob]);
  for (const d of DOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date)
      VALUES($1,$2,$3,$4,$5,$6,'Personal accident',$7,true,'ready',$8,$8,'scan_clean','active',$9,$10)`, [d.id, ACCOUNT, d.owner, d.insurer, d.product, d.policyNumber, d.role, d.key.toLowerCase() + ".pdf", d.hash, d.effectiveDate]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [d.id, m, ACCOUNT]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, d.id, Number(page), text]);
  }
  const R = await import("@/lib/rag2/tools");
  const CT = await import("@/lib/rag2/calc/tool");
  const CR = await import("@/lib/claims/calc-record");
  type Sel = { status: string; valueId?: string; value?: number; currency?: string; rowLabel?: string; reason?: string; columnBasis?: { basis: string } };
  const ctxFor = () => R.createToolContext({ accountId: ACCOUNT, asOf: "2026-10-11" });
  const sel = async (ctx: ReturnType<typeof ctxFor>, key: string, who: string, benefit: string, want = "amount"): Promise<Sel> => {
    const r = await R.runTool(ctx, "select_table_value", { policy_id: doc(key).id, benefit, subject_id: who, want }, ON);
    assert.ok(r.ok, JSON.stringify(r).slice(0, 400)); return r.data as Sel;
  };
  const value = async (who: string, benefit: string) => { const v = await sel(ctxFor(), "CERT", who, benefit); return v.status === "ok" ? v.value : v.status; };

  await check("R2 Alex's Group Personal Accident sum assured is his own row (S$600,000), read as the document's own row for him", async () => {
    const v = await sel(ctxFor(), "CERT", M.alex.id, "Group Personal Accident sum insured");
    assert.equal(v.status, "ok", JSON.stringify(v)); assert.equal(v.value, 600000); assert.equal(v.currency, "SGD");
    assert.equal(v.rowLabel, "Group Personal Accident", "the product heading, as the household reads it"); assert.equal(v.columnBasis?.basis, "document");
  });
  await check("R3 other wordings of the same benefit, and the other products, read Alex's row of the product asked for", async () => {
    assert.equal(await value(M.alex.id, "personal accident"), 600000);
    assert.equal(await value(M.alex.id, "Personal Accident sum assured"), 600000);
    assert.equal(await value(M.alex.id, "Group Term Life sum assured"), 1000000);
    assert.equal(await value(M.alex.id, "Living Care"), 350000);
    assert.equal(await value(M.alex.id, "Living Care Plus"), 300000);
  });
  await check("R4 Bea gets her own rows (printed as “Tan Hui Min Bea”), never Alex's", async () => {
    assert.equal(await value(M.bea.id, "Group Personal Accident sum insured"), 400000);
    assert.equal(await value(M.bea.id, "Group Term Life"), 500000);
  });
  await check("R5 a member the certificate does not name gets no value (not another insured person's row)", async () => {
    const v = await sel(ctxFor(), "CERT", M.cai.id, "Group Personal Accident sum insured");
    assert.notEqual(v.status, "ok", "no value for Cai: " + JSON.stringify(v));
  });
  await check("R6 control: a plain schedule whose “Life Assured” line names the person still reads its benefit rows", async () => {
    const v = await sel(ctxFor(), "PLAIN", M.alex.id, "Death benefit");
    assert.equal(v.status, "ok", JSON.stringify(v)); assert.equal(v.value, 200000);
  });
  await check("R7 lump sum: 20% (Fracture of arm, the wording) of Alex's S$600,000 sum assured (the certificate) = S$120,000; the record re-runs", async () => {
    const ctx = ctxFor();
    const s = await sel(ctx, "CERT", M.alex.id, "Group Personal Accident sum insured");
    const p = await sel(ctx, "WORDING", M.alex.id, "Fracture of arm", "percent");
    assert.equal(s.status, "ok", JSON.stringify(s)); assert.equal(p.status, "ok", JSON.stringify(p)); assert.equal(p.value, 20);
    const r = await R.runTool(ctx, "calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: M.alex.id, policy_id: cert.id, benefit: "Fracture of arm", sum_insured_value_id: s.valueId, percent_value_id: p.valueId, condition: "fractured arm", assumption_words: "if the fracture is confirmed as an accidental fracture of the arm" }, ON);
    assert.ok(r.ok, JSON.stringify(r).slice(0, 600));
    const out = CT.calcOutcomes(ctx).get((r.data as { calc_id: string }).calc_id)!;
    assert.equal(out.amount, 120000, JSON.stringify({ kind: out.kind, amount: out.amount, reason: (out as { reason?: string }).reason }));
    if (out.record) assert.ok(CR.recomputeCalculation(out.record).ok, "the saved record re-runs");
    const q = await R.runTool(ctx, "calculate", { calculator: "lump_sum", purpose: "question", subject_id: M.alex.id, policy_id: cert.id, benefit: "Fracture of arm", sum_insured_value_id: s.valueId, percent_value_id: p.valueId, condition: "fractured arm" }, ON);
    assert.ok(q.ok, JSON.stringify(q).slice(0, 600));
    const qo = CT.calcOutcomes(ctx).get((q.data as { calc_id: string }).calc_id)!;
    console.log("     question:", qo.kind, qo.amount);
    assert.ok(qo.amount == null || qo.amount === 120000, "a question never states another figure: " + qo.amount);
  });
  await check("R8 Bea's lump sum uses her own S$400,000 (20% = S$80,000), and Alex's value id is refused for her", async () => {
    const ctx = ctxFor();
    const sa = await sel(ctx, "CERT", M.alex.id, "Group Personal Accident sum insured");
    const s = await sel(ctx, "CERT", M.bea.id, "Group Personal Accident sum insured");
    const p = await sel(ctx, "WORDING", M.bea.id, "Fracture of arm", "percent");
    const base = { calculator: "lump_sum", purpose: "what_if", subject_id: M.bea.id, policy_id: cert.id, benefit: "Fracture of arm", percent_value_id: p.valueId, condition: "fractured arm", assumption_words: "if the fracture is confirmed" };
    const r = await R.runTool(ctx, "calculate", { ...base, sum_insured_value_id: s.valueId }, ON);
    assert.ok(r.ok, JSON.stringify(r).slice(0, 600));
    assert.equal(CT.calcOutcomes(ctx).get((r.data as { calc_id: string }).calc_id)!.amount, 80000);
    const bad = await R.runTool(ctx, "calculate", { ...base, sum_insured_value_id: sa.valueId }, ON);
    assert.ok(!bad.ok, "Alex's sum assured is refused for Bea");
  });

  await check("R9 the save-time gate keeps Alex's S$600,000 bound to his own certificate row (and rejects it for Bea)", async () => {
    const { toFigureBinding } = await import("@/lib/rag2/evidence");
    const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
    type Ans = import("@/types").ChatAnswer; type Bound = import("@/types").BoundFigure;
    const answer = (sentence: string, figureBindings: Bound[]): Ans => ({ mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: figureBindings.map((b) => ({ chunkId: "c", policyId: b.policyId, policyName: "x", pageStart: b.pageStart, pageEnd: b.pageEnd })), disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], figureBindings, accountHint: ACCOUNT } as unknown as Ans);
    const T2 = await import("@/lib/rag2/tables");
    const r = await T2.selectTableValue({ accountId: ACCOUNT, policyId: cert.id, benefit: "Group Personal Accident sum insured", subject: { memberId: M.alex.id }, asOf: "2026-10-11" });
    assert.equal(r.status, "ok"); if (r.status !== "ok") return;
    const b = toFigureBinding(r.evidence, r.rowLabel, r.value, "SGD"); assert.ok(b, "a binding");
    const s = "Alex's Group Personal Accident sum assured on the certificate is S$600,000.";
    const problems = await verifyAnswerFigures(answer(s, [{ ...b!, sentence: s, value: 600000, currency: "SGD" } as Bound]), { accountId: ACCOUNT, userText: "alex died in a motorbike accident" });
    assert.deepEqual(problems.map((p) => p.reason), []);
    const s2 = "Bea's Group Personal Accident sum assured on the certificate is S$600,000.";
    const bad = await verifyAnswerFigures(answer(s2, [{ ...b!, subjectId: M.bea.id, sentence: s2, value: 600000, currency: "SGD" } as Bound]), { accountId: ACCOUNT, userText: "bea died in a motorbike accident" });
    assert.ok(bad.length >= 1, "Alex's row is never Bea's figure");
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nroster regressions ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

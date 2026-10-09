/**
 * Gate and table reading for freshly ingested documents (node --import tsx scripts/rag2-ingested-gate-regressions.ts).
 *
 * The live ingestion run (docs/rag-migration/ingest-live/RUN-ingest-live-1-*) stored three documents whose tables carry
 * an item-code column ("Item | Benefit | ...", "No. | Benefit | Amount payable"), long compound benefit labels, a single
 * amount column, and an endorsement row that says in a cell of its own who it is for ("Category: Child (each)"). The
 * save-time gate rejected correct figures. This suite loads the run's OWN stored rows (policies, members, links, page
 * text exactly as the pipeline stored it -- never hand-edited) from dump-final/dump.json, replays the stored bindings,
 * and adds a second, synthetic insurer's layout for each item.
 *  1  benefit naming: an item code is never the benefit; a sentence naming the row's distinctive terms passes, one that
 *     names a different row of the same table (or no benefit) does not.
 *  2  a single amount column (beside an item code and the benefit's name) is not a person or tier dimension.
 *  3  a selected amended cell carries its whole row (EvidenceRef table.row), so the row's earlier value is citable as
 *     the earlier value; the row's own category cell is a person dimension.
 * Positive and negative checks; exit 1 on a failure.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const SQL = ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"];
const RUN_DIR = path.resolve("docs/rag-migration/ingest-live", readdirSync(path.resolve("docs/rag-migration/ingest-live")).filter((d) => d.startsWith("RUN-ingest-live-1-")).sort()[0]);
type Row = Record<string, unknown>;
const dump = JSON.parse(readFileSync(path.join(RUN_DIR, "dump-final/dump.json"), "utf8")) as { tables: Record<string, Row[]> };
const T = dump.tables;
const iso = (v: unknown) => (v == null ? null : String(v).slice(0, 10));
/** Each document's file hash, as the run's own stored evidence recorded it. */
const hashes = new Map<string, string>();
for (const m of (JSON.stringify(dump).match(/"policyId":\s*"[0-9a-f-]{36}"[^{}]*?"documentHash":\s*"[0-9a-f]{64}"/g) ?? [])) { const p = m.match(/"policyId":\s*"([0-9a-f-]{36})"/)![1], h = m.match(/"documentHash":\s*"([0-9a-f]{64})"/)![1]; hashes.set(p, h); }
const ACCOUNT = String(T.policies[0].account_id);
const member = (name: RegExp) => T.family_members.find((m) => name.test(String(m.display_name)))! as { id: string; display_name: string };
const policy = (role: string, product: RegExp) => T.policies.find((p) => p.document_role === role && product.test(String(p.product_name)))! as { id: string };
type Binding = import("@/types").BoundFigure;
/** The stored bindings of the run's answers (as the composer produced them). */
const stored: Binding[] = T.chat_messages.flatMap((m) => { const a = typeof m.answer_json === "string" ? JSON.parse(m.answer_json as string) : (m.answer_json as Row | null); return ((a?.figureBindings as Binding[]) ?? []); });
const storedBy = (value: number, benefit?: RegExp) => { const b = stored.find((x) => x.value === value && (!benefit || benefit.test(x.benefit) || benefit.test(x.passage))); assert.ok(b, `no stored binding for ${value}`); return b!; };

// ---- a second, synthetic insurer (invented) ------------------------------------------------------------------------
const ACCOUNT_S = "7a100000-0000-4000-8000-000000000001";
const sid = (n: number) => `7a110000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S = { owner: { id: sid(1), name: "Rafael Sim Jun Wei", rel: "self", dob: "1982-02-14" }, wife: { id: sid(2), name: "Priya Sim", rel: "spouse", dob: "1984-05-30" }, kid: { id: sid(3), name: "Noah Sim", rel: "child", dob: "2016-09-09" } };
const tab = (cells: string[]) => cells.join("\t");
const SDOCS = [
  { id: sid(101), product: "Lumen Guard Accident Plan", number: "LG-PA-90917", role: "schedule", hash: "s-lumen-1", eff: "2026-01-01", exp: "2026-12-31", members: [S.owner.id, S.wife.id, S.kid.id],
    page: ["Lumen Assurance (fictional) - Lumen Guard Accident Plan - Schedule", "Policy no. LG-PA-90917", "", tab(["Ref", "Benefit description", "Adult", "Child"]),
      tab(["1", "Death due to accident or total & permanent disability (lump sum)", "S$100,000", "S$30,000"]),
      tab(["2", "Dislocation — Major joint (hip, knee or shoulder)", "S$2,000", "S$1,200"]),
      tab(["3", "Dislocation — Minor joint (finger or toe)", "S$400", "S$250"])].join("\n") },
  { id: sid(102), product: "Lumen Kids Ward Income", number: "LK-WI-31002", role: "certificate", hash: "s-lumen-2", eff: "2026-01-01", exp: "2026-12-31", members: [S.kid.id],
    page: ["Lumen Assurance (fictional) - Lumen Kids Ward Income - Certificate", "", tab(["S/N", "Benefit", "Benefit amount"]), tab(["1", "Daily ward income (from the 2nd day)", "S$90 per day, up to 45 days per year"]), tab(["2", "Recovery grant (once per admission)", "S$300"])].join("\n") },
  { id: sid(103), product: "Lumen Guard Accident Plan - Endorsement 3", number: "LG-PA-90917", role: "endorsement", hash: "s-lumen-3", eff: "2026-05-01", exp: "2026-12-31", members: [S.owner.id, S.wife.id, S.kid.id],
    page: ["Endorsement 3 to policy LG-PA-90917", "With effect from 1 May 2026 the schedule is amended as follows:", tab(["No.", "Benefit", "Insured", "Previous", "Amended"]),
      tab(["4", "Outpatient physiotherapy (per visit)", "Adult", "S$50 per visit", "S$70 per visit"]), tab(["5", "Outpatient physiotherapy (per visit)", "Child", "S$40 per visit", "S$60 per visit"])].join("\n") },
  { id: sid(104), product: "Lumen Guard Accident Plan", number: "LG-PA-90917", role: "schedule", hash: "s-lumen-4", eff: "2026-01-01", exp: "2026-12-31", members: [S.owner.id, S.wife.id, S.kid.id],
    page: ["Lumen Guard Accident Plan - Outpatient benefits", "", tab(["Ref", "Benefit description", "Adult", "Child"]), tab(["6", "Outpatient physiotherapy (per visit)", "S$50", "S$40"])].join("\n") },
];

async function main() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL) await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const execute = async (text: string, params: unknown[] = []) => { if (!params.length && /;\s*\S/.test(text)) { await db.exec(text); return { rows: [], rowCount: 0 }; } const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  pool.query = (async (text: string, params: unknown[] = []) => execute(text, params)) as typeof pool.query;
  pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
  globalThis.fetch = (async () => { throw new Error("network disabled in rag2-ingested"); }) as typeof fetch;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'ingested household'),($2,'synthetic household')", [ACCOUNT, ACCOUNT_S]);
  for (const m of T.family_members) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [m.id, ACCOUNT, m.display_name, m.preferred_name, m.relationship, m.notes, iso(m.date_of_birth)]);
  // (The run ended with the schedule marked for deletion; at question time it was active, as here.)
  for (const p of T.policies) await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date,renewal_or_expiry_date,document_date)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10,$10,$11,'active',$12,$13,$14,$15)`, [p.id, ACCOUNT, p.family_member_id, p.insurer, p.product_name, p.policy_number, p.policy_type, p.document_role, !!p.personal_coverage_confirmed, p.original_filename, p.quarantine_status, hashes.get(String(p.id)) ?? null, iso(p.effective_date), iso(p.renewal_or_expiry_date), iso(p.document_date)]);
  for (const m of T.policy_members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,$4,$5,$6)", [m.policy_id, m.family_member_id, ACCOUNT, m.source ?? "test", m.confidence ?? 1, m.benefit_tier ?? null]);
  for (const pg of T.policy_pages) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, pg.policy_id, pg.page_number, pg.text]);
  for (const m of Object.values(S)) await db.query("INSERT INTO family_members(id,account_id,display_name,relationship,date_of_birth) VALUES($1,$2,$3,$4,$5)", [m.id, ACCOUNT_S, m.name, m.rel, m.dob]);
  for (const d of SDOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date,renewal_or_expiry_date)
      VALUES($1,$2,$3,'Lumen Assurance',$4,$5,'personal_accident',$6,true,'ready',$7,$7,'scan_clean','active',$8,$9,$10)`, [d.id, ACCOUNT_S, S.owner.id, d.product, d.number, d.role, d.id + ".pdf", d.hash, d.eff, d.exp]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [d.id, m, ACCOUNT_S]);
    await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT_S, d.id, d.page]);
  }

  const Tb = await import("@/lib/rag2/tables");
  const { toFigureBinding, rowCellBinding } = await import("@/lib/rag2/evidence");
  const { verifyAnswerFigures, FIGURE_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");
  type Ans = import("@/types").ChatAnswer;
  const answer = (sentence: string, figureBindings: Binding[], account: string): Ans => ({ mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: figureBindings.map((b) => ({ chunkId: "c", policyId: b.policyId, policyName: "x", pageStart: b.pageStart, pageEnd: b.pageEnd })), disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], figureBindings, accountHint: account } as unknown as Ans);
  const gate = async (label: string, account: string, sentence: string, bs: Omit<Binding, "sentence">[], expect: "accepted" | "rejected", reason?: RegExp, userText = "what does the policy pay?") => {
    const a = answer(sentence, bs.map((b) => ({ ...b, sentence } as Binding)), account);
    const problems = await verifyAnswerFigures(a, { accountId: account, userText });
    if (expect === "accepted") assert.deepEqual(problems.map((p) => `${p.figure}: ${p.reason}`), [], label);
    else {
      assert.ok(problems.length >= 1, `${label}: accepted`);
      assert.ok(a.summary.includes(FIGURE_LEFT_OUT_NOTE) || !a.summary.includes(sentence), `${label}: still shown`);
      if (reason) assert.match(problems.map((p) => p.reason).join(" | "), reason, label);
    }
  };
  const isla = member(/^Isla/), felix = member(/^Felix/), simon = member(/^Simon/);
  const SCHED = policy("personal_schedule", /SafeStay/), ENDT = policy("endorsement", /SafeStay/), CERT = policy("certificate", /JuniorShield/);
  const sel = (account: string, policyId: string, who: { id: string }, benefit: string, asOf = "2026-10-09") => Tb.selectTableValue({ accountId: account, policyId, benefit, subject: { memberId: who.id }, asOf });
  const okSel = async (label: string, account: string, policyId: string, who: { id: string }, benefit: string, value: number, asOf?: string) => {
    const r = await sel(account, policyId, who, benefit, asOf);
    assert.equal(r.status, "ok", `${label}: ${JSON.stringify(r).slice(0, 400)}`);
    if (r.status !== "ok") throw new Error("unreachable");
    assert.equal(r.value, value, `${label}: ${r.value} from ${r.rowLabel} / ${r.columnHeader}`);
    return r;
  };
  const bindOf = (r: Awaited<ReturnType<typeof okSel>>, who: { id: string }) => { const b = toFigureBinding({ ...r.evidence, subjectId: who.id }, r.rowLabel, r.value, "SGD"); assert.ok(b, "binding"); return { ...b!, value: r.value, currency: "SGD" }; };

  // =========================================================================== 1. benefit naming
  await check("N1 the run's stored bindings (item code as the benefit) pass with the sentences the model wrote", async () => {
    const a40 = storedBy(40000), d600 = storedBy(600, /Simple/), d1500 = storedBy(1500, /Compound/), s500 = storedBy(500, /dengue/);
    await gate("S$40,000 stored", ACCOUNT, a40.sentence, [a40], "accepted");
    await gate("S$600 + S$1,500 stored", ACCOUNT, d600.sentence, [d600, { ...d1500 }], "accepted");
    await gate("S$500 scanned stored", ACCOUNT, s500.sentence, [s500], "accepted");
  });
  await check("N2 a sentence naming the row's distinctive head terms passes (accidental death, simple / closed fracture, dengue hospitalisation)", async () => {
    const a40 = storedBy(40000), d600 = storedBy(600, /Simple/), s500 = storedBy(500, /dengue/);
    await gate("accidental death payout", ACCOUNT, "Isla's accidental death payout under SafeStay is S$40,000.", [a40], "accepted");
    await gate("simple fracture", ACCOUNT, "For Felix's simple fracture, SafeStay pays S$600.", [d600], "accepted");
    await gate("closed fracture", ACCOUNT, "A closed fracture for Felix is S$600 under SafeStay.", [d600], "accepted");
    await gate("dengue hospitalisation", ACCOUNT, "If Isla is hospitalised for dengue, JuniorShield pays a lump sum of S$500.", [s500], "accepted");
  });
  await check("N3 still rejected: a different row's benefit, no benefit at all, or a code that is not the row's", async () => {
    const d600 = storedBy(600, /Simple/), d1500 = storedBy(1500, /Compound/), a150 = storedBy(150000);
    await gate("compound named for the simple row", ACCOUNT, "For Felix's compound fracture, SafeStay pays S$600.", [d600], "rejected", /another row/);
    await gate("simple named for the compound row", ACCOUNT, "Felix's simple (closed) fracture benefit is S$1,500.", [d1500], "rejected", /another row/);
    await gate("no benefit named", ACCOUNT, a150.sentence, [a150], "rejected", /does not name the benefit/);
    await gate("code of another row", ACCOUNT, "Isla's accidental death payout is S$40,000.", [{ ...storedBy(40000), benefit: "D" }], "rejected");
  });
  await check("N4 table selection labels a row by its benefit, not its item code (both insurers)", async () => {
    const r = await okSel("SafeStay accidental death", ACCOUNT, SCHED.id, isla, "accidental death", 40000);
    assert.match(r.rowLabel, /^Accidental death or permanent total disablement/);
    await gate("selected, paraphrased", ACCOUNT, "Isla's accidental death benefit is S$40,000.", [bindOf(r, isla)], "accepted");
    const c = await okSel("JuniorShield dengue", ACCOUNT, CERT.id, isla, "dengue hospitalisation", 500);
    assert.match(c.rowLabel, /dengue/);
    const s = await okSel("Lumen major dislocation", ACCOUNT_S, sid(101), S.kid, "major joint dislocation", 1200);
    assert.match(s.rowLabel, /^Dislocation — Major joint/);
    await gate("Lumen major joint", ACCOUNT_S, "Noah's major joint dislocation benefit is S$1,200.", [bindOf(s, S.kid)], "accepted");
    await gate("Lumen minor joint named for the major row", ACCOUNT_S, "Noah's minor joint dislocation benefit is S$1,200.", [bindOf(s, S.kid)], "rejected", /another row/);
    const d = await okSel("Lumen accidental death", ACCOUNT_S, sid(101), S.wife, "accidental death", 100000);
    await gate("Lumen death by accident", ACCOUNT_S, "Priya's death due to accident benefit is S$100,000.", [bindOf(d, S.wife)], "accepted");
  });

  // =========================================================================== 2. one amount column
  await check("C1 a single amount column (No. | Benefit | Amount payable) is not one column per person or tier", async () => {
    const s150 = storedBy(150, /Daily hospital income/);
    assert.equal(s150.column ?? null, null);
    await gate("S$150 stored", ACCOUNT, s150.sentence, [s150], "accepted");
    const r = await okSel("JuniorShield daily hospital income", ACCOUNT, CERT.id, isla, "daily hospital income", 150);
    await gate("selected", ACCOUNT, "Isla's JuniorShield daily hospital income is S$150 per day.", [bindOf(r, isla)], "accepted");
    const w = await okSel("Lumen daily ward income", ACCOUNT_S, sid(102), S.kid, "daily ward income", 90);
    await gate("Lumen single column", ACCOUNT_S, "Noah's daily ward income is S$90 per day.", [{ ...bindOf(w, S.kid), column: null }], "accepted");
  });
  await check("C2 still rejected: a person-column row with no column, a person the document does not cover", async () => {
    await gate("SafeStay Adult/Child row unbound", ACCOUNT, "Isla's accidental death benefit is S$40,000.", [{ ...storedBy(40000), column: null }], "rejected", /not bound to a column/);
    await gate("JuniorShield for Felix", ACCOUNT, "Felix's daily hospital income is S$150 per day.", [{ ...storedBy(150, /Daily hospital income/), subjectId: felix.id }], "rejected", /does not speak for/);
    const l = await okSel("Lumen accidental death child", ACCOUNT_S, sid(101), S.kid, "accidental death", 30000);
    await gate("Lumen Adult/Child row unbound", ACCOUNT_S, "Noah's accidental death benefit is S$30,000.", [{ ...bindOf(l, S.kid), column: null }], "rejected", /not bound to a column/);
  });

  // =========================================================================== 3. the amended row and its earlier value
  await check("E1 the selected Revised cell carries its whole row; the earlier value on it is citable as the earlier value", async () => {
    const r = await okSel("SafeStay child allowance now", ACCOUNT, SCHED.id, isla, "hospital daily allowance", 110);
    const row = r.evidence.table?.row?.cells ?? [];
    assert.deepEqual(row.map((c) => c.header), ["Item", "Benefit", "Category", "Existing", "Revised"]);
    assert.equal(r.amends?.policyId, SCHED.id);
    const now = bindOf(r, isla), before = rowCellBinding({ ...r.evidence, subjectId: isla.id }, r.rowLabel, 80, "SGD");
    assert.ok(before, "earlier value binding"); assert.equal(before!.column, "Existing");
    const s = "Yes—the endorsement changed the SafeStay Family Hospital Cash & Personal Accident Plan’s “Hospital daily allowance (per day of confinement)” for each child from S$80 to S$110 per day, effective 1 July 2026; the 60-day-per-policy-year maximum and other terms remain unchanged.";
    await gate("from S$80 to S$110", ACCOUNT, s, [now, { ...before!, value: 80, currency: "SGD" }], "accepted");
    await gate("S$80 as the current figure", ACCOUNT, "Isla's hospital daily allowance is S$80 per day.", [{ ...before!, value: 80, currency: "SGD" }], "rejected", /before the change/);
    await okSel("SafeStay child allowance in May", ACCOUNT, SCHED.id, isla, "hospital daily allowance", 80, "2026-05-01");
  });
  await check("E2 the row's own category cell is a person dimension (selection and gate, both insurers)", async () => {
    await okSel("Simon keeps the adult schedule value", ACCOUNT, SCHED.id, simon, "hospital daily allowance", 120);
    const r = await okSel("child row", ACCOUNT, SCHED.id, felix, "hospital daily allowance", 110);
    await gate("adult bound to the child row", ACCOUNT, "Simon's hospital daily allowance is now S$110 per day.", [{ ...bindOf(r, felix), subjectId: simon.id }], "rejected", /Child|child/);
    const k = await okSel("Lumen child physio", ACCOUNT_S, sid(104), S.kid, "outpatient physiotherapy", 60);
    const a = await okSel("Lumen adult physio", ACCOUNT_S, sid(104), S.wife, "outpatient physiotherapy", 70);
    const kb = bindOf(k, S.kid), kBefore = rowCellBinding({ ...k.evidence, subjectId: S.kid.id }, k.rowLabel, 40, "SGD");
    assert.ok(kBefore);
    await gate("Lumen previous to amended", ACCOUNT_S, "Noah's outpatient physiotherapy benefit went from S$40 to S$60 per visit on 1 May 2026.", [kb, { ...kBefore!, value: 40, currency: "SGD" }], "accepted");
    await gate("Lumen adult bound to the child row", ACCOUNT_S, "Priya's outpatient physiotherapy benefit is S$60 per visit.", [{ ...kb, subjectId: S.wife.id }], "rejected", /Child|child/);
    await gate("Lumen adult row", ACCOUNT_S, "Priya's outpatient physiotherapy benefit is S$70 per visit.", [bindOf(a, S.wife)], "accepted");
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:ingested-gate-test ${results.length - failed.length}/${results.length} passed`);
  await db.close();
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

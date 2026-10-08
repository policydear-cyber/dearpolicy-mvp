/**
 * Agent G: the remaining gaps (node --import tsx scripts/rag2-gaps-regressions.ts).
 *
 * PGlite with the real schema and two synthetic households of this suite (scripts/fixtures/rag2-gaps/household.ts):
 *  A  explicit applicability classes -- person (adult / child / unknown, from category, date of birth, relationship)
 *     and column (Adult / Child / Insured Child / Juvenile / Life Assured / Spouse ...; ambiguous; unrecognised) -- in
 *     table selection AND at the save-time gate: a child / ambiguous / unrecognised column never supports an adult,
 *     and an unknown class never passes a class-specific column.
 *  S  stepchild rows decided from the document's own definition of a Child and whether it names the person; when the
 *     wording does not settle it, only that value is withheld, with the specific missing information.
 *  C  the claimed amount the household reports is persisted on the claim record (amount, currency, provenance), as a
 *     kind of its own -- never the bill, a printed limit or an estimate.
 *  K  corrections to the person, the amount or the dates withdraw dependent estimates and update the PERSISTED claim
 *     (read back from claim_sessions).
 *  X  a deleted / superseded source invalidates only what it alone supported.
 * Positive and negative checks; exit 1 if any check failed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT_L, ACCOUNT_R, DOCS, M } from "./fixtures/rag2-gaps/household";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const doc = (key: string) => DOCS.find((d) => d.key === key)!;
const ON = { DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;
const SQL = ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"];

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
  globalThis.fetch = (async () => { throw new Error("network disabled in rag2-gaps"); }) as typeof fetch;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Lim household'),($2,'Rahman household')", [ACCOUNT_L, ACCOUNT_R]);
  for (const p of Object.values(M)) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, p.account, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,'schedule',true,'ready',$8,$8,'scan_clean','active',$9)`, [d.id, d.account, d.owner, d.insurer, d.product, d.policyNumber, d.type, d.key.toLowerCase() + ".pdf", d.hash]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [d.id, m, d.account]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [d.account, d.id, Number(page), text]);
  }

  const P = await import("@/lib/rag2/people");
  const T = await import("@/lib/rag2/tables");
  const { verifyAnswerFigures, FIGURE_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");
  type Ans = import("@/types").ChatAnswer;
  const sel = (key: string, who: { id: string }, benefit: string, tier: string | null = null) => T.selectTableValue({ accountId: doc(key).account, policyId: doc(key).id, benefit, subject: { memberId: who.id, tier }, asOf: "2026-10-08" });
  const okValue = async (label: string, key: string, who: { id: string }, benefit: string, value: number, column: RegExp) => {
    const r = await sel(key, who, benefit);
    assert.equal(r.status, "ok", `${label}: ${JSON.stringify(r).slice(0, 400)}`);
    if (r.status === "ok") { assert.equal(r.value, value, label); assert.match(r.columnHeader, column, label); }
    return r;
  };
  const notOk = async (label: string, key: string, who: { id: string }, benefit: string, tier: string | null = null) => {
    const r = await sel(key, who, benefit, tier);
    assert.notEqual(r.status, "ok", `${label}: selected ${JSON.stringify(r).slice(0, 300)}`);
    return r;
  };
  const answer = (sentence: string, figureBindings: import("@/types").BoundFigure[], account: string): Ans => ({ mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: figureBindings.map((b) => ({ chunkId: "c", policyId: b.policyId, policyName: "x", pageStart: b.pageStart, pageEnd: b.pageEnd })), disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], figureBindings, accountHint: account } as unknown as Ans);
  const bound = (key: string, who: { id: string }, benefit: string, passage: string, column: string, sentence: string, value: number): import("@/types").BoundFigure => ({ policyId: doc(key).id, subjectId: who.id, benefit, documentHash: doc(key).hash, pageStart: 1, pageEnd: 1, passage, column, sentence, value, currency: "SGD" });
  const gate = async (label: string, key: string, who: { id: string }, benefit: string, passage: string, column: string, sentence: string, value: number, expect: "accepted" | "rejected", reason?: RegExp) => {
    const a = answer(sentence, [bound(key, who, benefit, passage, column, sentence, value)], doc(key).account);
    const problems = await verifyAnswerFigures(a, { accountId: doc(key).account, userText: "what does my policy pay?" });
    if (expect === "accepted") assert.deepEqual(problems.map((p) => p.reason), [], label);
    else {
      assert.ok(problems.length >= 1, `${label}: accepted`);
      assert.ok(a.summary.includes(FIGURE_LEFT_OUT_NOTE) || !a.summary.includes(sentence), `${label}: the sentence is still shown`);
      if (reason) assert.match(problems.map((p) => p.reason).join(" | "), reason, label);
    }
  };
  const row = (key: string, label: string) => doc(key).pages[1].split("\n").find((l) => l.startsWith(label))!;

  // ------------------------------------------------------------------------------------------------ A: classes
  await check("A1 person class is explicit: category > date of birth > relationship; unknown when nothing establishes it", () => {
    const cls = (m: { rel: string; notes: string | null; dob: string | null }, category: string | null = null) => P.personApplicability({ relationship: m.rel, notes: m.notes, dateOfBirth: m.dob }, { asOf: "2026-10-08", category }).cls;
    assert.equal(cls(M.grace), "adult"); assert.equal(cls(M.ivy), "child"); assert.equal(cls(M.marcus), "child");
    assert.equal(cls(M.wei), "unknown", "a sibling with no date of birth");
    assert.equal(cls(M.nur), "unknown", "a dependant with no date of birth");
    assert.equal(cls(M.adam), "child", "a son with no date of birth, by relationship");
    assert.equal(cls({ rel: "child", notes: "son", dob: "2005-01-01" }), "unknown", "a son aged 21: the policy decides");
    assert.equal(cls({ rel: "child", notes: "son", dob: "1990-01-01" }), "adult");
    assert.equal(cls({ rel: "other", notes: null, dob: null }, "Insured Child"), "child", "the policy's own category");
    assert.equal(cls(M.wei, "Adult"), "adult");
  });
  await check("A2 column class is explicit, including Insured Child / Juvenile / Life Assured; ambiguous and unrecognised columns are told apart", () => {
    const k = (h: string) => { const c = P.columnApplicability(h); return c.kind === "class" ? c.cls : c.kind; };
    assert.equal(k("Insured Child"), "child"); assert.equal(k("Juvenile"), "child"); assert.equal(k("Kid"), "child"); assert.equal(k("Children / Limit"), "child");
    assert.equal(k("Adult"), "adult"); assert.equal(k("Insured Adult"), "adult"); assert.equal(k("Grown-up"), "adult");
    assert.equal(k("Life Assured"), "owner"); assert.equal(k("Policyholder"), "owner"); assert.equal(k("Employee"), "owner");
    assert.equal(k("Spouse"), "spouse"); assert.equal(k("Dependant child"), "child");
    assert.equal(k("Spouse & Child"), "ambiguous"); assert.equal(k("Adult or Child"), "ambiguous");
    assert.equal(k("Senior"), "unrecognised"); assert.equal(k("Insured persons"), "unrecognised"); assert.equal(k("Family members"), "unrecognised");
    assert.equal(k("Benefit (S$)"), "none"); assert.equal(k("Sum insured"), "none"); assert.equal(k("Plan B"), "none"); assert.equal(k(""), "none");
    const adult = P.personApplicability({ relationship: "spouse", notes: null, dateOfBirth: "1980-01-01" }, { asOf: "2026-10-08" });
    for (const h of ["Child", "Juvenile", "Spouse & Child", "Senior", "Insured persons"]) assert.ok(P.columnFitProblem(P.columnApplicability(h), adult, { isOwner: false }), `${h} must not support an adult`);
    assert.equal(P.columnFitProblem(P.columnApplicability("Adult"), adult, { isOwner: false }), null);
    const unknown = P.personApplicability({ relationship: "sibling", notes: null, dateOfBirth: null }, { asOf: "2026-10-08" });
    for (const h of ["Adult", "Child", "Spouse", "Life Assured"]) assert.ok(P.columnFitProblem(P.columnApplicability(h), unknown, { isOwner: false }), `${h} must not pass an unknown class`);
    assert.equal(P.columnFitProblem(P.columnApplicability("Benefit"), unknown, { isOwner: false }), null, "a column for everyone");
  });
  await check("A3 table selection (Lim, Harbour Adult/Child): adult -> Adult, child -> Child; a sibling of unknown class gets no class column", async () => {
    await okValue("Grace (spouse, 43)", "HARBOUR", M.grace, "Daily hospital income", 100, /^Adult$/);
    await okValue("Daniel (self)", "HARBOUR", M.daniel, "Accidental medical expenses", 2000, /^Adult$/);
    await okValue("Ivy (daughter, 12)", "HARBOUR", M.ivy, "Daily hospital income", 50, /^Child$/);
    const w = await notOk("Wei (sibling, no date of birth)", "HARBOUR", M.wei, "Daily hospital income");
    assert.match(JSON.stringify(w), /adult or a child|not established/i);
    await notOk("Grace with the model's tier 'Child'", "HARBOUR", M.grace, "Daily hospital income", "Child");
  });
  await check("A4 table selection (Lim, Guardian Life Assured/Juvenile): the policyholder -> Life Assured, a child -> Juvenile, the spouse -> neither", async () => {
    await okValue("Daniel (policyholder)", "GUARD", M.daniel, "Fracture benefit", 1500, /Life Assured/);
    await okValue("Ivy", "GUARD", M.ivy, "Fracture benefit", 750, /Juvenile/);
    await notOk("Grace (not the life assured, not a juvenile)", "GUARD", M.grace, "Fracture benefit");
    await notOk("Grace with the model's tier 'Juvenile'", "GUARD", M.grace, "Fracture benefit", "Juvenile");
  });
  await check("A5 table selection (Rahman, Grown-up/Kid; Senior/Junior): the husband -> Grown-up, a son -> Kid; a dependant of unknown class and an unrecognised column -> nothing", async () => {
    await okValue("Imran (husband)", "MERIDIAN_KIDS", M.imran, "Accident outpatient treatment", 600, /Grown-up/);
    await okValue("Adam (son, no date of birth)", "MERIDIAN_KIDS", M.adam, "Accident outpatient treatment", 400, /Kid/);
    await notOk("Nur (dependant, no date of birth)", "MERIDIAN_KIDS", M.nur, "Accident outpatient treatment");
    await notOk("Imran on Senior / Junior", "MERIDIAN_KIDS", M.imran, "Dental emergency treatment");
    await notOk("Imran with the model's tier 'Kid'", "MERIDIAN_KIDS", M.imran, "Accident outpatient treatment", "Kid");
  });
  await check("A6 save-time gate (Lim): an adult's figure from the Child column is removed; from the Adult column it stands; an unknown class never passes Adult", async () => {
    const r = row("HARBOUR", "Daily hospital income");
    await gate("Grace / Child", "HARBOUR", M.grace, "Daily hospital income", r, "Child", "Grace's daily hospital income under the Harbour Family PA is S$50 a day.", 50, "rejected", /child/i);
    await gate("Grace / Adult", "HARBOUR", M.grace, "Daily hospital income", r, "Adult", "Grace's daily hospital income under the Harbour Family PA is S$100 a day.", 100, "accepted");
    await gate("Ivy / Child", "HARBOUR", M.ivy, "Daily hospital income", r, "Child", "Ivy's daily hospital income under the Harbour Family PA is S$50 a day.", 50, "accepted");
    await gate("Ivy / Adult", "HARBOUR", M.ivy, "Daily hospital income", r, "Adult", "Ivy's daily hospital income under the Harbour Family PA is S$100 a day.", 100, "rejected");
    await gate("Wei (unknown) / Adult", "HARBOUR", M.wei, "Daily hospital income", r, "Adult", "Wei's daily hospital income under the Harbour Family PA is S$100 a day.", 100, "rejected", /not established/i);
    const g = row("GUARD", "Fracture benefit");
    await gate("Grace / Juvenile", "GUARD", M.grace, "Fracture benefit", g, "Juvenile", "Grace's fracture benefit under the Harbour Guardian Plan is S$750.", 750, "rejected");
    await gate("Daniel / Life Assured", "GUARD", M.daniel, "Fracture benefit", g, "Life Assured", "Daniel's fracture benefit under the Harbour Guardian Plan is S$1,500.", 1500, "accepted");
    await gate("Grace / Life Assured (not the policyholder)", "GUARD", M.grace, "Fracture benefit", g, "Life Assured", "Grace's fracture benefit under the Harbour Guardian Plan is S$1,500.", 1500, "rejected");
  });
  await check("A7 save-time gate (Rahman): Kid / Senior (unrecognised) never support the husband; Grown-up does; a dependant of unknown class never passes Grown-up", async () => {
    const r = row("MERIDIAN_KIDS", "Accident outpatient treatment");
    await gate("Imran / Kid", "MERIDIAN_KIDS", M.imran, "Accident outpatient treatment", r, "Kid", "Imran's accident outpatient treatment cover under Meridian Kids Shield is S$400.", 400, "rejected");
    await gate("Imran / Grown-up", "MERIDIAN_KIDS", M.imran, "Accident outpatient treatment", r, "Grown-up", "Imran's accident outpatient treatment cover under Meridian Kids Shield is S$600.", 600, "accepted");
    await gate("Nur (unknown) / Grown-up", "MERIDIAN_KIDS", M.nur, "Accident outpatient treatment", r, "Grown-up", "Nur's accident outpatient treatment cover under Meridian Kids Shield is S$600.", 600, "rejected");
    const d = doc("MERIDIAN_KIDS").pages[2].split("\n").find((l) => l.startsWith("Dental emergency"))!;
    const a = answer("Imran's dental emergency treatment cover under Meridian Kids Shield is S$300.", [{ ...bound("MERIDIAN_KIDS", M.imran, "Dental emergency treatment", d, "Senior", "Imran's dental emergency treatment cover under Meridian Kids Shield is S$300.", 300), pageStart: 2, pageEnd: 2 }], ACCOUNT_R);
    const p = await verifyAnswerFigures(a, { accountId: ACCOUNT_R, userText: "dental?" });
    assert.ok(p.length >= 1, "Senior (unrecognised) accepted for Imran");
  });

  // ------------------------------------------------------------------------------------------------ S: stepchild
  await check("S1 Lim: no definition of a Child and no category for the stepson -> that value is withheld with the specific missing information; his half-sister's value stands", async () => {
    const r = await notOk("Marcus on Harbour", "HARBOUR", M.marcus, "Daily hospital income");
    assert.equal(r.status, "missing");
    if (r.status === "missing") { assert.equal(r.unresolved?.kind, "stepchild_class", JSON.stringify(r)); assert.match(r.reason, /stepchild/); assert.match(r.unresolved!.needs, /Marcus/); }
    await okValue("Ivy unaffected", "HARBOUR", M.ivy, "Daily hospital income", 50, /^Child$/);
    await okValue("Grace unaffected", "HARBOUR", M.grace, "Accidental medical expenses", 2000, /^Adult$/);
    await notOk("Marcus with the model's tier 'Child'", "HARBOUR", M.marcus, "Daily hospital income", "Child");
  });
  await check("S2 Lim: Kinship defines a Child as including step-children named on the certificate, and names Marcus -> Insured Child, from the definition", async () => {
    const r = await okValue("Marcus on Kinship", "KINSHIP", M.marcus, "Hospital cash per day", 80, /Insured Child/);
    if (r.status === "ok") { assert.equal(r.columnBasis.basis, "definition"); assert.ok(r.columnBasis.evidence?.passage.text.includes("step-child"), "the definition is the evidence"); }
    await okValue("Grace on Kinship", "KINSHIP", M.grace, "Hospital cash per day", 120, /Insured Adult/);
  });
  await check("S3 Rahman: Kids Shield's 'Children' are biological or adopted only -> the stepdaughter's Kid value is withheld (not covered as a child); her half-brother's stands", async () => {
    const r = await notOk("Zara on Kids Shield", "MERIDIAN_KIDS", M.zara, "Accident outpatient treatment");
    assert.equal(r.status, "missing");
    if (r.status === "missing") assert.match(r.reason, /does not include step-children/);
    await okValue("Adam unaffected", "MERIDIAN_KIDS", M.adam, "Accident outpatient treatment", 400, /Kid/);
  });
  await check("S4 Rahman: Family Hospital's Child includes a step-child up to 18 -> Zara (10) is a Child from the definition; an over-age stepchild is not", async () => {
    const r = await okValue("Zara on Family Hospital", "MERIDIAN_HOSP", M.zara, "Daily ward allowance", 90, /^Child$/);
    if (r.status === "ok") assert.equal(r.columnBasis.basis, "definition");
    const d = T.childDefinitionIn(doc("MERIDIAN_HOSP").pages[2])!;
    assert.deepEqual([d.step, d.requiresNamed, d.ageLimit], ["included", false, { age: 18, inclusive: true }]);
    const choice = T.chooseColumn([{ index: 1, leaf: "Adult", heading: null, header: "Adult", kind: "amount", appliesTo: T.appliesToOf("Adult"), currency: null, pos: 0 }, { index: 2, leaf: "Child", heading: null, header: "Child", kind: "amount", appliesTo: T.appliesToOf("Child"), currency: null, pos: 0 }],
      { memberId: "x", name: "Older stepchild", names: [], relation: "step_child", tier: null, recordedTier: null, isDocOwner: false, ownerIsSelf: true, age: 20, namedLines: [], childDefinition: { ...d, ref: null }, docName: "Meridian Family Hospital", applicability: null });
    assert.ok("none" in choice, JSON.stringify(choice));
  });

  // (C, K, X are appended below.)
  /*__MORE__*/

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2-gaps ${results.length - failed.length}/${results.length} passed`);
  await db.close().catch(() => undefined);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

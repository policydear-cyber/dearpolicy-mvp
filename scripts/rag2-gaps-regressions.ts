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
    // Integration (round 3): a whole-family aggregate column is one limit for the family, not a class of person (r6).
    assert.equal(k("Family maximum"), "none"); assert.equal(k("Per family"), "none"); assert.equal(k("Family maximum (adults)"), "adult");
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

  // ------------------------------------------------------------------------------------------------ shared: claims
  const R = await import("@/lib/rag2/tools");
  const CT = await import("@/lib/rag2/calc/tool");
  const CL = await import("@/lib/rag2/calc/claim-record");
  const CO = await import("@/lib/rag2/loop/compose");
  const L = await import("@/lib/rag2/loop/loop");
  const { emptyLoopState } = await import("@/lib/rag2/loop/types");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const PK = await import("@/lib/claims/claim-pack");
  type State = import("@/lib/rag2/loop/types").RagLoopState;
  type Out = import("@/lib/rag2/calc/engine").CalcOutcome & { purpose?: string };
  const LOOP_ENV = { DEARPOLICY_RAG_TOOLS: "1", DEARPOLICY_RAG_LOOP: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;
  const fact = (value: string, words: string, turn = 1) => ({ value, words, turn, source: "user_reported" as const, basis: "stated" as const });
  const conversation = async (account: string, member: string) => (await db.query<{ id: string }>("INSERT INTO chat_conversations(account_id,family_member_id,title) VALUES($1,$2,'gaps') RETURNING id", [account, member])).rows[0].id;
  const session = async (id: string) => (await db.query<{ family_member_id: string; status: string; facts: any; decision_packet: any }>("SELECT family_member_id::text, status, facts, decision_packet FROM claim_sessions WHERE id=$1", [id])).rows[0];
  /** A real claim calculation through the calculate tool, remembered on the state's claim as the loop does. */
  const claimCalc = async (state: State, key: string, who: { id: string }, benefit: string, admission: [string, string], discharge: [string, string]) => {
    const ctx = R.createToolContext({ accountId: doc(key).account, asOf: "2026-10-08" });
    const v = await R.runTool(ctx, "select_table_value", { policy_id: doc(key).id, benefit, subject_id: who.id, want: "amount" }, ON);
    assert.ok(v.ok && (v.data as { status: string }).status === "ok", JSON.stringify(v).slice(0, 300));
    const r = await R.runTool(ctx, "calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: who.id, policy_id: doc(key).id, benefit, rate_value_id: (v.data as { valueId: string }).valueId, admission: { at: admission[0], words: admission[1] }, discharge: { at: discharge[0], words: discharge[1] } }, ON);
    assert.ok(r.ok, JSON.stringify(r).slice(0, 400));
    const c = CT.calcOutcomes(ctx).get((r.data as { calc_id: string }).calc_id)! as Out;
    const ids = (c.evidence ?? []).map((e) => CO.evidenceIdOf(state, e, "calculate"));
    (state.claim!.calcs ??= {})[c.calcId] = CL.calcRef(c, state.claim, ids, state.turn);
    return { c, ids };
  };
  /** One loop turn driven by a scripted model (test-only), straight through runLoop. */
  const turn = async (state: State, account: string, people: { id: string; name: string; rel: string }[], message: string, steps: ((v: any) => { name: string; arguments: Record<string, unknown> }[])[]) => {
    const model = new ScriptedLoopModel([{ steps }], LOOP_ENV);
    return L.runLoop({ accountId: account, message, state, people: people.map((p) => ({ id: p.id, name: p.name, relationship: p.rel })), speakerId: people.find((p) => p.rel === "self")?.id ?? null, model, env: LOOP_ENV, asOf: "2026-10-08" });
  };
  const thanks = (subject: string) => () => [{ name: "final_answer", arguments: { subject_id: subject, sentences: [{ text: "Thank you, I have noted that." }] } }];
  const LIM = [M.daniel, M.grace, M.ivy, M.marcus, M.wei].map((p) => ({ id: p.id, name: p.name, rel: p.rel }));
  const RAH = [M.faridah, M.imran, M.zara, M.adam, M.nur].map((p) => ({ id: p.id, name: p.name, rel: p.rel }));

  // ------------------------------------------------------------------------------------------------ C: claimed amount
  const limState = () => { const s = emptyLoopState(); s.turn = 1; s.subjectId = M.ivy.id; s.history = [{ user: "Ivy was in hospital", assistant: "ok" }];
    s.claim = { subjectId: M.ivy.id, derived: [], facts: {
      what_happened: fact("fell at the playground and was warded", "Ivy fell at the playground and was warded"),
      admission_date: fact("2026-09-01T20:00+08:00", "admitted on 1 September at 8pm"),
      discharge_date: fact("2026-09-04T09:00+08:00", "discharged on 4 September at 9am"),
      bill_amount: fact("1800 SGD", "the hospital bill was S$1,800"),
      claim_amount: fact("1200 SGD", "we are claiming S$1,200 for the stay"),
    } }; return s; };
  let limConv = "", limRec = "", limCalc = "";
  const limS = limState();
  await check("C1 Lim: the claimed amount is persisted as the household's own figure (amount, currency, words, turn) -- apart from the bill and from any estimate", async () => {
    const { c } = await claimCalc(limS, "KINSHIP", M.ivy, "Hospital cash per day", ["2026-09-01T20:00+08:00", "admitted on 1 September at 8pm"], ["2026-09-04T09:00+08:00", "discharged on 4 September at 9am"]);
    limCalc = c.calcId;
    assert.equal(c.kind, "indicative_estimate", "a complete estimate (so the record carries a ready packet)");
    limConv = await conversation(ACCOUNT_L, M.ivy.id);
    const rec = await CL.syncCalcClaimRecord({ accountId: ACCOUNT_L, conversationId: limConv, state: limS, calcs: [c] });
    assert.ok(rec?.id, "a claim record"); limRec = rec!.id;
    assert.equal(limS.claimRecord?.id, limRec, "the loop state remembers its claim record");
    const row = await session(limRec);
    assert.deepEqual({ ...row.facts.claimedAmount, recordedAt: "x" }, { kind: "user_reported_claim_amount", amount: 1200, currency: "SGD", source: "user_reported", words: "we are claiming S$1,200 for the stay", turn: 1, recordedAt: "x" });
    assert.equal(row.facts.hospitalBill, 1800, "the bill stays the bill");
    assert.equal(row.facts.admissionDate, "2026-09-01");
    for (const a of row.decision_packet?.assessments ?? []) { assert.equal(a.amountText, null); assert.equal(a.calculatedAmount, undefined); }
    assert.equal(row.decision_packet?.ready, true); assert.notEqual(c.amount, 1200, "the estimate is not the claimed amount");
    assert.equal(row.decision_packet.facts.claimedAmount.amount, 1200, "the packet carries it too");
    const pack = JSON.stringify(PK.documentsToAttach(row.facts));
    assert.match(pack, /receipts/i, "the pack asks for the receipts behind the amount");
  });
  await check("C2 Rahman: no currency in the household's words -> none is added; a paraphrased amount and a bill are never a claimed amount", () => {
    const s = emptyLoopState(); s.claim = { subjectId: M.adam.id, derived: [], facts: { amount_claimed: { ...fact("650 SGD", "we want to claim 650 for the stay", 2) } } };
    const a = CL.claimedAmountOf(s.claim)!;
    assert.deepEqual([a.amount, a.currency, a.words, a.turn, a.source], [650, null, "we want to claim 650 for the stay", 2, "user_reported"]);
    s.claim.facts = { amount_claimed: { ...fact("700", "we want to claim about that much"), basis: "paraphrased" as const } };
    assert.equal(CL.claimedAmountOf(s.claim), null, "a paraphrase is not a claimed amount");
    s.claim.facts = { bill_total: fact("2400 SGD", "the bill came to S$2,400") };
    assert.equal(CL.claimedAmountOf(s.claim), null, "a bill is not a claimed amount");
    s.claim.facts = { claim_amount: { ...fact("990", "claiming S$990"), source: "document" as const } };
    assert.equal(CL.claimedAmountOf(s.claim), null, "only the household reports a claimed amount");
  });

  // ------------------------------------------------------------------------------------------------ K: corrections
  await check("K1 Lim: correcting the claimed amount updates the persisted claim (previous kept); the date-based estimate is NOT withdrawn", async () => {
    limS.history.push({ user: "x", assistant: "y" });
    const out = await turn(limS, ACCOUNT_L, LIM, "Sorry, we're claiming S$1,500, not S$1,200.", [
      () => [{ name: "note_facts", arguments: { subject_id: M.ivy.id, facts: [{ key: "claim_amount", value: "1500", currency: "SGD", words: "we're claiming S$1,500" }] } }],
      thanks(M.ivy.id)]);
    assert.deepEqual(out.corrections.map((c) => c.key), ["claim_amount"]);
    Object.assign(limS, out.state);
    const row = await session(limRec);
    assert.equal(row.facts.claimedAmount.amount, 1500); assert.equal(row.facts.claimedAmount.currency, "SGD");
    assert.deepEqual(row.facts.claimedAmount.previous.map((p: { amount: number }) => p.amount), [1200]);
    assert.equal(row.facts.hospitalBill, 1800, "the bill is untouched");
    assert.ok(!(row.decision_packet?.assessments ?? []).some((a: { withdrawn?: unknown }) => a.withdrawn), "an estimate that did not use the amount stays");
    assert.ok(!out.state.claim!.calcs![limCalc].withdrawn);
  });
  await check("K2 Lim: correcting the discharge date (under another key) withdraws the dependent estimate in the loop AND on the claim record, which takes the new date", async () => {
    const out = await turn(limS, ACCOUNT_L, LIM, "Actually she was discharged on 5 September at 9am.", [
      () => [{ name: "note_facts", arguments: { subject_id: M.ivy.id, facts: [{ key: "discharged_at", value: "2026-09-05T09:00+08:00", words: "discharged on 5 September at 9am" }] } }],
      thanks(M.ivy.id)]);
    assert.equal(out.corrections.length, 1, JSON.stringify(out.corrections));
    assert.equal(out.state.claim!.facts.discharge_date, undefined, "the old key is replaced, not kept beside the new one");
    assert.equal(out.state.claim!.calcs![limCalc].withdrawn?.cause, "fact");
    Object.assign(limS, out.state);
    const row = await session(limRec);
    assert.equal(row.facts.dischargeDate, "2026-09-05");
    const a = row.decision_packet?.assessments?.find((x: { id: string }) => x.id === limCalc) ?? null;
    assert.ok(row.decision_packet, "the packet is kept");
    assert.ok(a?.withdrawn, "the estimate is marked withdrawn on the record"); assert.equal(a.withdrawn.cause, "fact"); assert.match(a.withdrawn.reason, /corrected/); assert.equal(row.decision_packet.ready, false);
    assert.equal(row.status, "fact_finding");
  });
  await check("K3 Rahman: correcting the person moves the claim record to the corrected child and marks what was worked out for the other as withdrawn; a side question about the speaker changes nothing", async () => {
    const s = emptyLoopState(); s.turn = 1; s.subjectId = M.adam.id; s.speakerId = M.faridah.id; s.history = [{ user: "Adam was warded", assistant: "ok" }];
    s.claim = { subjectId: M.adam.id, derived: [], facts: { what_happened: fact("warded with dengue fever", "warded with dengue fever"), admission_date: fact("2026-08-10", "went in on 10 August"), discharge_date: fact("2026-08-13", "came home on 13 August") } };
    const { c } = await claimCalc(s, "MERIDIAN_HOSP", M.adam, "Daily ward allowance", ["2026-08-10", "went in on 10 August"], ["2026-08-13", "came home on 13 August"]);
    assert.equal(c.kind, "indicative_estimate");
    const conv = await conversation(ACCOUNT_R, M.adam.id);
    const rec = await CL.syncCalcClaimRecord({ accountId: ACCOUNT_R, conversationId: conv, state: s, calcs: [c] });
    assert.ok(rec?.id);
    const side = await turn(structuredClone(s), ACCOUNT_R, RAH, "What is my own deductible?", [
      () => [{ name: "resolve_person", arguments: { mention: "my" } }], thanks(M.faridah.id)]);
    assert.equal((await session(rec!.id)).family_member_id, M.adam.id, "a side question never moves the record");
    assert.ok(!side.state.claim!.calcs?.[c.calcId]?.withdrawn);
    const out = await turn(s, ACCOUNT_R, RAH, "Sorry, I mixed them up - it was Zara, not Adam.", [
      () => [{ name: "resolve_person", arguments: { mention: "Zara" } }], thanks(M.zara.id)]);
    assert.equal(out.state.claim?.subjectId, M.zara.id, "the active claim is Zara's");
    assert.equal(out.state.claim?.facts.what_happened?.words, "warded with dengue fever", "the event as the household described it");
    assert.equal(out.state.otherClaims?.[M.adam.id]?.calcs?.[c.calcId]?.withdrawn?.cause, "person");
    const row = await session(rec!.id);
    assert.equal(row.family_member_id, M.zara.id, "the claim record is now Zara's");
    assert.equal(row.status, "fact_finding");
    assert.ok(row.decision_packet?.assessments?.length, "the packet is kept");
    assert.ok(row.decision_packet.assessments.every((a: { withdrawn?: { cause: string } }) => a.withdrawn?.cause === "person"));
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM claim_sessions WHERE account_id=$1 AND family_member_id=$2", [ACCOUNT_R, M.adam.id])).rows[0].n, 0, "no stale record left for Adam");
  });

  // ------------------------------------------------------------------------------------------------ X: sources
  await check("X1 Rahman: the schedule is deleted but its enrolment copy prints the same row -> the document fact and the estimate stay (re-pointed); the calculation that needed the schedule's own wording is withdrawn (also on the record); the household's facts stay", async () => {
    const s = emptyLoopState(); s.turn = 1; s.subjectId = M.zara.id; s.speakerId = M.faridah.id; s.history = [{ user: "Zara was warded", assistant: "ok" }];
    s.claim = { subjectId: M.zara.id, derived: [], facts: { what_happened: fact("warded for a high fever", "warded for a high fever"), admission_date: fact("2026-07-01", "admitted on 1 July"), discharge_date: fact("2026-07-03", "home on 3 July") } };
    const hosp = await sel("MERIDIAN_HOSP", M.zara, "Daily ward allowance"), copy = await sel("MERIDIAN_COPY", M.zara, "Daily ward allowance");
    assert.equal(hosp.status, "ok"); assert.equal(copy.status, "ok", JSON.stringify(copy).slice(0, 300));
    if (hosp.status !== "ok" || copy.status !== "ok") return;
    const eH = CO.evidenceIdOf(s, hosp.evidence, "select_table_value"), eC = CO.evidenceIdOf(s, copy.evidence, "select_table_value");
    s.claim.facts.ward_allowance_rate = { value: "90 SGD", words: hosp.evidence.passage.text, turn: 1, source: "document", basis: "stated", evidenceIds: [eH, eC] };
    s.claim.derived.push({ sentence: "Indicative estimate: Zara's ward allowance for her July stay comes to S$180.", factKeys: ["admission_date"], turn: 1, evidenceIds: [eH] });
    const { c } = await claimCalc(s, "MERIDIAN_HOSP", M.zara, "Daily ward allowance", ["2026-07-01", "admitted on 1 July"], ["2026-07-03", "home on 3 July"]);
    const conv = await conversation(ACCOUNT_R, M.zara.id);
    const rec = await CL.syncCalcClaimRecord({ accountId: ACCOUNT_R, conversationId: conv, state: s, calcs: [c] });
    assert.ok(rec?.id);
    await db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [doc("MERIDIAN_HOSP").id]);
    const out = await turn(s, ACCOUNT_R, RAH, "What does Zara's plan pay per night?", [
      () => [{ name: "final_answer", arguments: { subject_id: M.zara.id, sentences: [{ text: "Zara's daily ward allowance under Meridian Family Hospital is S$90.", evidence_ids: [eH] }] } }]]);
    const f = out.state.claim!.facts;
    assert.deepEqual(f.ward_allowance_rate?.evidenceIds, [eC], "the fact rests on the live copy now");
    assert.ok(f.what_happened && f.admission_date && f.discharge_date, "the household's own facts stay");
    assert.equal(out.state.claim!.derived.length, 1, "the estimate printed by the live copy stays");
    assert.deepEqual(out.state.claim!.derived[0].evidenceIds, [eC]);
    assert.equal(out.state.claim!.calcs![c.calcId].withdrawn?.cause, "source", "the calculation rested on the deleted schedule's own wording");
    assert.ok((out.invalidated ?? []).some((x) => x.kind === "calculation") && !(out.invalidated ?? []).some((x) => x.kind === "fact"), JSON.stringify(out.invalidated));
    if (out.reply.kind === "final") { assert.ok(out.reply.composed.sentences.some((x) => /S\$90/.test(x.text) && x.evidenceIds.includes(eC)), "the sentence is answered from the live copy: " + JSON.stringify(out.reply.composed)); }
    else assert.fail("no final answer: " + JSON.stringify(out.reply));
    const row = await session(rec!.id);
    const a = row.decision_packet.assessments.find((x: { id: string }) => x.id === c.calcId);
    assert.equal(a?.withdrawn?.cause, "source", "withdrawn on the record");
    assert.ok(row.facts.admissionDate, "the record keeps the household's dates");
    // Negative: the copy goes too -> the document fact and the estimate are withdrawn; the household's facts still stay.
    await db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [doc("MERIDIAN_COPY").id]);
    const out2 = await turn(out.state, ACCOUNT_R, RAH, "And now?", [thanks(M.zara.id)]);
    const f2 = out2.state.claim!.facts;
    assert.equal(f2.ward_allowance_rate, undefined, "no live source prints it any more");
    assert.equal(out2.state.claim!.invalidated?.[0]?.key, "ward_allowance_rate");
    assert.equal(out2.state.claim!.derived.length, 0, "the estimate is withdrawn");
    assert.ok(f2.what_happened && f2.admission_date && f2.discharge_date, "the household's own facts still stay");
    await db.query("UPDATE policies SET lifecycle_state='active' WHERE id = ANY($1::uuid[])", [[doc("MERIDIAN_HOSP").id, doc("MERIDIAN_COPY").id]]);
  });
  await check("X2 Lim: a superseded certificate withdraws only the calculation it supported; the calculation on another policy stays (in the loop and on the record)", async () => {
    const s = emptyLoopState(); s.turn = 1; s.subjectId = M.ivy.id; s.history = [{ user: "Ivy was in hospital", assistant: "ok" }];
    s.claim = { subjectId: M.ivy.id, derived: [], facts: { what_happened: fact("fell and was warded", "she fell and was warded"), admission_date: fact("2026-06-01T08:00+08:00", "admitted on 1 June at 8am"), discharge_date: fact("2026-06-03T10:00+08:00", "discharged on 3 June at 10am") } };
    const k = await claimCalc(s, "KINSHIP", M.ivy, "Hospital cash per day", ["2026-06-01T08:00+08:00", "admitted on 1 June at 8am"], ["2026-06-03T10:00+08:00", "discharged on 3 June at 10am"]);
    const ctx = R.createToolContext({ accountId: ACCOUNT_L, asOf: "2026-10-08" });
    const hv = await R.runTool(ctx, "select_table_value", { policy_id: doc("HARBOUR").id, benefit: "Daily hospital income", subject_id: M.ivy.id, want: "amount" }, ON);
    const hr = await R.runTool(ctx, "calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: M.ivy.id, policy_id: doc("HARBOUR").id, benefit: "Daily hospital income", rate_value_id: ((hv as { data?: { valueId: string } }).data)?.valueId, admission: { at: "2026-06-01T08:00+08:00", words: "admitted on 1 June at 8am" }, discharge: { at: "2026-06-03T10:00+08:00", words: "discharged on 3 June at 10am" } }, ON);
    assert.ok(hr.ok, JSON.stringify(hr).slice(0, 300));
    const h = CT.calcOutcomes(ctx).get((hr.data as { calc_id: string }).calc_id)! as Out;
    assert.equal(h.kind, "indicative_estimate", h.unresolvedText);
    (s.claim.calcs ??= {})[h.calcId] = CL.calcRef(h, s.claim, (h.evidence ?? []).map((e) => CO.evidenceIdOf(s, e, "calculate")), 1);
    const conv = await conversation(ACCOUNT_L, M.ivy.id);
    const rec = await CL.syncCalcClaimRecord({ accountId: ACCOUNT_L, conversationId: conv, state: s, calcs: [k.c, h] });
    assert.ok(rec?.id);
    await db.query("UPDATE policies SET superseded_at=now() WHERE id=$1", [doc("KINSHIP").id]);
    const out = await turn(s, ACCOUNT_L, LIM, "Anything else I need?", [thanks(M.ivy.id)]);
    assert.equal(out.state.claim!.calcs![k.c.calcId].withdrawn?.cause, "source");
    assert.equal(out.state.claim!.calcs![h.calcId].withdrawn ?? null, null, "the other policy's calculation stays");
    assert.ok(out.state.claim!.facts.admission_date, "the household's facts stay");
    const row = await session(rec!.id);
    const by = (id: string) => (row.decision_packet?.assessments ?? []).find((x: { id: string }) => x.id === id);
    assert.ok(row.decision_packet, "the packet is kept");
    assert.equal(by(k.c.calcId)?.withdrawn?.cause, "source"); assert.equal(by(h.calcId)?.withdrawn, undefined);
    await db.query("UPDATE policies SET superseded_at=NULL WHERE id=$1", [doc("KINSHIP").id]);
  });


  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2-gaps ${results.length - failed.length}/${results.length} passed`);
  await db.close().catch(() => undefined);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

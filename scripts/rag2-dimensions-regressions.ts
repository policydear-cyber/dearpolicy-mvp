/**
 * Table dimensions (node --import tsx scripts/rag2-dimensions-regressions.ts).
 *
 * A value column can carry more than one dimension -- the person / category, the plan / tier, the schedule version
 * (before / after an endorsement or alteration) and the benefit stage. Table selection (lib/rag2/tables.ts) and the
 * save-time gate (lib/chat/answer-verification.ts) bind a figure to EVERY dimension its row has: the person's own
 * class, the version in force on the date the sentence is about (the amended value from its effective date until it
 * ends, the earlier value before it), the stage the sentence names. A version column is never a person; an
 * endorsement keeps its link to the policy it amends, its effective date and the row it changes, and is checked like
 * any other document. PGlite with the real schema; two synthetic households (scripts/fixtures/rag2-dims) plus the
 * live-smoke household's endorsement (scripts/fixtures/rag2-live). Positive and negative checks; exit 1 on a failure.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT_N, ACCOUNT_P, DOCS, M, doc } from "./fixtures/rag2-dims/household";
import { DOCS as LIVE_DOCS, L as LIVE, ACCOUNT_L } from "./fixtures/rag2-live/household";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const SQL = ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"];
type AnyDoc = { id: string; account: string; owner: string; insurer: string; product: string; policyNumber: string; role: string; hash: string; effective: string | null; expiry: string | null; members: { id: string; tier?: string | null }[]; pages: Record<number, string> };

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
  globalThis.fetch = (async () => { throw new Error("network disabled in rag2-dims"); }) as typeof fetch;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Teo household'),($2,'Raman household'),($3,'Lim household')", [ACCOUNT_P, ACCOUNT_N, ACCOUNT_L]);
  const people = [...Object.values(M), ...Object.values(LIVE).map((m) => ({ ...m, account: m.account }))];
  for (const p of people) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, p.account, p.name, p.pref, p.rel, p.notes, p.dob]);
  const live: AnyDoc[] = LIVE_DOCS.filter((d) => d.key === "KESTREL" || d.key === "KESTREL_ENDT").map((d) => ({ ...d }));
  for (const d of [...(DOCS as AnyDoc[]), ...live]) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date,renewal_or_expiry_date)
      VALUES($1,$2,$3,$4,$5,$6,'hospital',$7,true,'ready',$8,$8,'scan_clean','active',$9,$10,$11)`, [d.id, d.account, d.owner, d.insurer, d.product, d.policyNumber, d.role, d.id + ".pdf", d.hash, d.effective, d.expiry]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, d.account, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [d.account, d.id, Number(page), text]);
  }

  const T = await import("@/lib/rag2/tables");
  const Pn = await import("@/lib/claims/person");
  const { toFigureBinding } = await import("@/lib/rag2/evidence");
  const { verifyAnswerFigures, FIGURE_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");
  type Ans = import("@/types").ChatAnswer;
  type Bound = import("@/types").BoundFigure;
  const all = [...(DOCS as AnyDoc[]), ...live];
  const byId = (id: string) => all.find((d) => d.id === id)!;
  const sel = (d: AnyDoc, who: { id: string }, benefit: string, asOf: string, tier: string | null = null) => T.selectTableValue({ accountId: d.account, policyId: d.id, benefit, subject: { memberId: who.id, tier }, asOf });
  const ok = async (label: string, d: AnyDoc, who: { id: string }, benefit: string, asOf: string, value: number, column?: RegExp, tier: string | null = null) => {
    const r = await sel(d, who, benefit, asOf, tier);
    assert.equal(r.status, "ok", `${label}: ${JSON.stringify(r).slice(0, 500)}`);
    if (r.status !== "ok") throw new Error("unreachable");
    assert.equal(r.value, value, `${label}: value ${r.value} from ${r.columnHeader}`);
    if (column) assert.match(r.columnHeader, column, `${label}: column`);
    return r;
  };
  const answer = (sentence: string, figureBindings: Bound[], account: string): Ans => ({ mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: figureBindings.map((b) => ({ chunkId: "c", policyId: b.policyId, policyName: "x", pageStart: b.pageStart, pageEnd: b.pageEnd })), disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], figureBindings, accountHint: account } as unknown as Ans);
  const line = (d: AnyDoc, starts: string) => { const l = d.pages[1].split("\n").find((x) => x.startsWith(starts)); assert.ok(l, `no line ${starts}`); return l!; };
  /** The passage a search hit carries: the table's header line(s) and the row (as the live run's evidence did). */
  const passageOf = (d: AnyDoc, starts: string) => { const lines = d.pages[1].split("\n"); const i = lines.findIndex((x) => x.startsWith(starts)); let top = i; while (top > 0 && lines[top - 1].trim()) top--; return lines.slice(top, i + 1).filter((x) => !/^(?:Effective|With effect|Endorsement|This endorsement|The schedule|Temporary)/.test(x)).join("\n"); };
  const bind = (d: AnyDoc, who: { id: string }, benefit: string, passage: string, column: string | null, sentence: string, value: number): Bound => ({ policyId: d.id, subjectId: who.id, benefit, documentHash: d.hash, pageStart: 1, pageEnd: 1, passage, column, sentence, value, currency: "SGD" });
  const gate = async (label: string, d: AnyDoc, figures: { who: { id: string }; benefit: string; passage: string; column: string | null; value: number }[], sentence: string, expect: "accepted" | "rejected", reason?: RegExp, userText = "what does my policy pay?") => {
    const a = answer(sentence, figures.map((f) => bind(d, f.who, f.benefit, f.passage, f.column, sentence, f.value)), d.account);
    const problems = await verifyAnswerFigures(a, { accountId: d.account, userText });
    if (expect === "accepted") assert.deepEqual(problems.map((p) => p.reason), [], label);
    else {
      assert.ok(problems.length >= 1, `${label}: accepted`);
      assert.ok(a.summary.includes(FIGURE_LEFT_OUT_NOTE) || !a.summary.includes(sentence), `${label}: the sentence is still shown`);
      if (reason) assert.match(problems.map((p) => p.reason).join(" | "), reason, label);
    }
  };

  // =========================================================================== the dimension model
  await check("D1 version headings (Before/After, Previous/Revised, Old/New, Existing/Amended, From/To, Current/Revised with effect from) are versions, never people", () => {
    for (const [b, a] of [["Before", "After"], ["Previous", "Revised"], ["Old", "New"], ["Existing", "Amended"], ["From", "To"], ["Current", "Revised with effect from 01 Jul 2026"]]) {
      const db = Pn.columnDimensions(b), da = Pn.columnDimensions(a);
      assert.equal(db.version?.side, "before", b); assert.equal(da.version?.side, "after", a);
      assert.equal(db.person.kind, "none", b); assert.equal(da.person.kind, "none", a);
      assert.ok(Pn.versionPairOf(["Benefit", b, a]), `${b}/${a} pair`);
      assert.equal(T.appliesToOf(b)?.kind, "version", b); assert.equal(T.appliesToOf(a)?.kind, "version", a);
      assert.equal(Pn.columnApplicability(a).kind, "none", a);
    }
    assert.equal(Pn.columnDimensions("Revised with effect from 01 Jul 2026").version?.effective, "2026-07-01");
    assert.ok(!Pn.versionPairOf(["Benefit", "Current"]), "a lone Current is not a version pair");
  });
  await check("D2 combined headers carry two dimensions: person + version, plan + version; stages and plans", () => {
    const a = Pn.columnDimensions("Adult – After"), c = Pn.columnDimensions("Child / Before"), g = Pn.columnDimensions("Plan B – Revised");
    assert.deepEqual([a.person, a.version?.side], [{ kind: "class", cls: "adult" }, "after"]);
    assert.deepEqual([c.person, c.version?.side], [{ kind: "class", cls: "child" }, "before"]);
    assert.equal(g.plan, "Plan B"); assert.equal(g.version?.side, "after");
    assert.match(Pn.columnDimensions("Advanced stage").stage ?? "", /advanced/i);
    assert.match(Pn.columnDimensions("Subsequent claim").stage ?? "", /subsequent/i);
    assert.equal(Pn.columnDimensions("Gold").plan, "Gold");
    assert.equal(Pn.columnDimensions("Ward class B1").plan, "Ward class B1");
    assert.equal(Pn.columnDimensions("Insured Child").person.kind, "class");
  });

  // =========================================================================== table selection
  await check("S1 L5: the live endorsement's After value from its effective date, linked to the policy it amends", async () => {
    const base = byId(LIVE_DOCS.find((d) => d.key === "KESTREL")!.id), endt = byId(LIVE_DOCS.find((d) => d.key === "KESTREL_ENDT")!.id);
    const r = await ok("now", base, LIVE.daniel, "annual claim limit", "2026-10-08", 1_500_000, /^After$/);
    assert.equal(r.amends?.policyId, base.id); assert.equal(r.amends?.endorsementId, endt.id); assert.equal(r.amends?.effectiveDate, "2026-07-01"); assert.match(r.amends?.rowLabel ?? "", /annual claim limit/i);
    assert.equal(r.evidence.policyId, endt.id); assert.equal(r.amendedFrom?.value, 1_000_000);
    await ok("before the effective date: the base schedule", base, LIVE.daniel, "annual claim limit", "2026-06-15", 1_000_000);
    await ok("read on the endorsement itself, before its date: Before", endt, LIVE.daniel, "annual claim limit", "2026-05-01", 1_000_000, /^Before$/);
  });
  await check("S2 Previous/Revised (space-aligned) and a paraphrase on another benefit", async () => {
    const r = await ok("yearly claim limit", doc("P_BASE"), M.aaron, "yearly claim limit", "2026-10-08", 1_200_000, /^Revised$/);
    assert.equal(r.amends?.policyId, doc("P_BASE").id); assert.equal(r.amends?.effectiveDate, "2026-06-01");
    await ok("room and board", doc("P_BASE"), M.aaron, "room and board", "2026-10-08", 550, /^Revised$/);
    await ok("room and board in May", doc("P_BASE"), M.aaron, "room and board", "2026-05-20", 400);
  });
  await check("S3 person + version (two-level header): the person's class AND the version in force", async () => {
    await ok("Caleb after", doc("P_FC"), M.caleb, "outpatient fracture", "2026-10-08", 900, /Child.*After/);
    await ok("Bella after", doc("P_FC"), M.bella, "outpatient fracture", "2026-10-08", 1_400, /Adult.*After/);
    await ok("Caleb before the date", doc("P_FC"), M.caleb, "outpatient fracture", "2026-03-01", 600);
    await ok("on the endorsement, Caleb before", doc("P_FC_ENDT"), M.caleb, "outpatient fracture", "2026-03-01", 600, /Child.*Before/);
  });
  await check("S4 person + version (flat \"Adult – Old\" headers) and Old/New", async () => {
    await ok("Ethan", doc("N_BASE"), M.ethan, "annual limit", "2026-10-08", 300_000, /Child – New/);
    await ok("Devi", doc("N_BASE"), M.devi, "annual limit", "2026-10-08", 650_000, /Adult – New/);
    await ok("Devi in July", doc("N_BASE"), M.devi, "annual limit", "2026-07-15", 500_000, /^Adult$/);
  });
  await check("S5 blocked in selection: a future endorsement, an expired one, a misfiled one (names another policy)", async () => {
    const fut = await ok("future", doc("N_BASE"), M.devi, "surgical benefit", "2026-10-08", 20_000, /^Adult$/);
    assert.ok(fut.notes.some((n) => /not yet in force/.test(n)), JSON.stringify(fut.notes));
    assert.ok(fut.notes.some((n) => /names policy NWTR1200/.test(n)), "misfiled noted: " + JSON.stringify(fut.notes));
    const exp = await ok("expired", doc("N_BASE"), M.devi, "daily ward allowance", "2026-10-08", 150, /^Adult$/);
    assert.ok(exp.notes.some((n) => /no longer in force/.test(n)), JSON.stringify(exp.notes));
    await ok("while the temporary endorsement ran", doc("N_BASE"), M.devi, "daily ward allowance", "2026-05-01", 200, /^To$/);
    await ok("Ethan's surgical benefit is his own column, untouched by single-version endorsements in force", doc("N_BASE"), M.ethan, "surgical benefit", "2026-10-08", 10_000, /^Child$/);
  });
  await check("S6 plan tiers: the recorded tier's column; no tier on file is not guessed", async () => {
    await ok("Aaron Plan B", doc("P_TIER"), M.aaron, "daily ward benefit", "2026-10-08", 350, /Plan B/);
    const r = await sel(doc("P_TIER"), M.bella, "daily ward benefit", "2026-10-08");
    assert.notEqual(r.status, "ok", JSON.stringify(r).slice(0, 300));
  });
  await check("S7 benefit stages: withheld with a specific reason until the stage is given", async () => {
    const r = await sel(doc("N_CI"), M.devi, "cancer benefit", "2026-10-08");
    assert.equal(r.status, "missing", JSON.stringify(r).slice(0, 300));
    if (r.status === "missing") { assert.equal(r.unresolved?.kind, "stage"); assert.match(r.reason, /stage/); }
    await ok("advanced", doc("N_CI"), M.devi, "cancer benefit", "2026-10-08", 100_000, /Advanced stage/, "Advanced stage");
  });
  await check("S8 a binding from a selected endorsement value carries the version column and passes the gate", async () => {
    const r = await sel(doc("P_FC"), M.caleb, "outpatient fracture", "2026-10-08");
    assert.equal(r.status, "ok"); if (r.status !== "ok") return;
    const b = toFigureBinding(r.evidence, r.rowLabel, r.value, "SGD"); assert.ok(b);
    const s = "Caleb's outpatient fracture benefit is S$900 under the endorsement effective 15 March 2026.";
    const a = answer(s, [{ ...b!, sentence: s, value: 900, currency: "SGD" }], ACCOUNT_P);
    assert.deepEqual((await verifyAnswerFigures(a, { accountId: ACCOUNT_P, userText: "What is Caleb's fracture benefit now?" })).map((p) => p.reason), []);
  });

  // =========================================================================== the save-time gate: supported figures
  const KE = byId(LIVE_DOCS.find((d) => d.key === "KESTREL_ENDT")!.id);
  const kPassage = "Benefit\tBefore\tAfter\nAnnual claim limit\tS$1,000,000\tS$1,500,000";
  await check("G1 L5 as saved: the amended figure, no column bound (Before/After only), passes", async () => {
    await gate("L5", KE, [{ who: LIVE.daniel, benefit: "Annual claim limit", passage: kPassage, column: null, value: 1_500_000 }], "Daniel, your KestrelShield Integrated Plan’s “Annual claim limit” is S$1,500,000, as amended effective 1 July 2026 (page 1).", "accepted", undefined, "What is the annual claim limit on my KestrelShield plan now?");
    await gate("L5 bound to After", KE, [{ who: LIVE.daniel, benefit: "Annual claim limit", passage: kPassage, column: "After", value: 1_500_000 }], "Your annual claim limit is now S$1,500,000.", "accepted");
  });
  await check("G2 paraphrase: Previous/Revised, another benefit, another insurer", async () => {
    const d = doc("P_ENDT");
    await gate("room and board", d, [{ who: M.aaron, benefit: "Room and board (per day)", passage: passageOf(d, "Room and board"), column: null, value: 550 }], "Aaron's room and board benefit is now S$550 a day, revised from 1 June 2026.", "accepted");
    await gate("yearly limit", d, [{ who: M.aaron, benefit: "Yearly claim limit", passage: line(d, "Yearly claim limit"), column: "Revised", value: 1_200_000 }], "Aaron's yearly claim limit is S$1,200,000.", "accepted");
  });
  await check("G3 person + version: the person's After column passes (two-level and flat headers)", async () => {
    const d = doc("P_FC_ENDT"), p = passageOf(d, "Outpatient fracture");
    await gate("Caleb", d, [{ who: M.caleb, benefit: "Outpatient fracture benefit", passage: p, column: "After", value: 900 }], "Caleb's outpatient fracture benefit is S$900.", "accepted");
    await gate("Bella", d, [{ who: M.bella, benefit: "Outpatient fracture benefit", passage: p, column: "Adult / After", value: 1_400 }], "Bella's outpatient fracture benefit is S$1,400.", "accepted");
    const n = doc("N_ENDT");
    await gate("Ethan Old/New", n, [{ who: M.ethan, benefit: "Annual limit", passage: line(n, "Annual limit"), column: "Child – New", value: 300_000 }], "Ethan's annual limit is S$300,000.", "accepted");
  });
  await check("G4 the earlier value passes when the sentence is about an earlier date or presents it as the earlier value", async () => {
    const d = doc("P_ENDT"), p = passageOf(d, "Yearly claim limit");
    await gate("raised from .. to ..", d, [{ who: M.aaron, benefit: "Yearly claim limit", passage: p, column: null, value: 800_000 }, { who: M.aaron, benefit: "Yearly claim limit", passage: p, column: null, value: 1_200_000 }], "Aaron's yearly claim limit was raised from S$800,000 to S$1,200,000 with effect from 1 June 2026.", "accepted");
    await gate("on 15 May 2026", d, [{ who: M.aaron, benefit: "Yearly claim limit", passage: p, column: "Previous", value: 800_000 }], "On 15 May 2026, Aaron's yearly claim limit was S$800,000.", "accepted");
    await gate("asked about May", KE, [{ who: LIVE.daniel, benefit: "Annual claim limit", passage: kPassage, column: null, value: 1_000_000 }], "Your annual claim limit at that time was S$1,000,000.", "accepted", undefined, "What was my annual claim limit in May 2026?");
  });
  await check("G5 plan tier and stage columns pass when bound and named", async () => {
    const t = doc("P_TIER");
    await gate("Plan B", t, [{ who: M.aaron, benefit: "Daily ward benefit", passage: line(t, "Daily ward benefit"), column: "Plan B", value: 350 }], "Aaron's daily ward benefit is S$350.", "accepted");
    const c = doc("N_CI");
    await gate("advanced stage", c, [{ who: M.devi, benefit: "Cancer benefit", passage: line(c, "Cancer benefit"), column: "Advanced stage", value: 100_000 }], "Devi's cancer benefit for an advanced stage diagnosis is S$100,000.", "accepted");
  });

  // =========================================================================== the save-time gate: still blocked
  await check("B1 the wrong person's column (version + person tables)", async () => {
    const d = doc("P_FC_ENDT"), p = passageOf(d, "Outpatient fracture");
    await gate("adult figure for the child", d, [{ who: M.caleb, benefit: "Outpatient fracture benefit", passage: p, column: "After", value: 1_400 }], "Caleb's outpatient fracture benefit is S$1,400.", "rejected", /adults|class|column/);
    await gate("child figure bound to the adult column", d, [{ who: M.bella, benefit: "Outpatient fracture benefit", passage: p, column: "Adult / After", value: 900 }], "Bella's outpatient fracture benefit is S$900.", "rejected", /another person|column/);
    await gate("no column on a person + version row", d, [{ who: M.caleb, benefit: "Outpatient fracture benefit", passage: p, column: null, value: 900 }], "Caleb's outpatient fracture benefit is S$900.", "rejected", /not bound to a column/);
    const n = doc("N_ENDT");
    await gate("flat header, wrong person", n, [{ who: M.devi, benefit: "Annual limit", passage: line(n, "Annual limit"), column: "Child – New", value: 300_000 }], "Devi's annual limit is S$300,000.", "rejected", /children|class/);
    const b = doc("N_BASE");
    await gate("a plain person table with no column is still unbound", b, [{ who: M.devi, benefit: "Annual limit", passage: line(b, "Annual limit"), column: null, value: 500_000 }], "Devi's annual limit is S$500,000.", "rejected", /not bound to a column/);
  });
  await check("B2 the Before value for a current question", async () => {
    await gate("L5 Before now", KE, [{ who: LIVE.daniel, benefit: "Annual claim limit", passage: kPassage, column: null, value: 1_000_000 }], "Daniel, your annual claim limit is S$1,000,000.", "rejected", /before the change/, "What is my annual claim limit now?");
    const d = doc("P_ENDT");
    await gate("Previous bound explicitly", d, [{ who: M.aaron, benefit: "Yearly claim limit", passage: line(d, "Yearly claim limit"), column: "Previous", value: 800_000 }], "Aaron's yearly claim limit is S$800,000.", "rejected", /before the change/);
    const n = doc("N_ENDT");
    await gate("Adult – Old", n, [{ who: M.devi, benefit: "Annual limit", passage: line(n, "Annual limit"), column: "Adult – Old", value: 500_000 }], "Devi's annual limit is S$500,000.", "rejected", /before the change/);
  });
  await check("B3 an endorsement not yet in force on the question's date, or one that has ended", async () => {
    const f = doc("N_ENDT_FUT");
    await gate("future", f, [{ who: M.devi, benefit: "Surgical benefit", passage: passageOf(f, "Surgical benefit"), column: null, value: 26_000 }], "Devi's surgical benefit is S$26,000.", "rejected", /takes effect on 2026-12-01/, "What is my surgical benefit on 1 November 2026?");
    await gate("amended value asked for a date before its effective date (L5)", KE, [{ who: LIVE.daniel, benefit: "Annual claim limit", passage: kPassage, column: "After", value: 1_500_000 }], "On 20 June 2026 your annual claim limit was S$1,500,000.", "rejected", /takes effect/);
    const e = doc("N_ENDT_EXP");
    await gate("expired", e, [{ who: M.devi, benefit: "Daily ward allowance", passage: passageOf(e, "Daily ward allowance"), column: null, value: 200 }], "Devi's daily ward allowance is S$200.", "rejected", /ended on 2026-06-30/);
  });
  await check("B4 an endorsement of an unrelated policy, a misfiled one, or one used for another policy", async () => {
    const u = doc("N_UNREL");
    await gate("policy not held", u, [{ who: M.devi, benefit: "Annual limit", passage: passageOf(u, "Annual limit"), column: null, value: 777_000 }], "Devi's annual limit is S$777,000.", "rejected", /not one of this household/);
    const m = doc("N_MISFILED");
    await gate("misfiled", m, [{ who: M.devi, benefit: "Surgical benefit", passage: passageOf(m, "Surgical benefit"), column: null, value: 99_000 }], "Devi's surgical benefit is S$99,000.", "rejected", /names another policy/);
    const n = doc("N_ENDT");
    await gate("sentence about another policy", n, [{ who: M.devi, benefit: "Annual limit", passage: line(n, "Annual limit"), column: "Adult – New", value: 650_000 }], "Devi's Voyager annual limit is S$650,000.", "rejected", /another policy/);
    await gate("the right policy named", n, [{ who: M.devi, benefit: "Annual limit", passage: line(n, "Annual limit"), column: "Adult – New", value: 650_000 }], "Devi's MediGuard annual limit is S$650,000.", "accepted");
  });
  await check("B5 an endorsement used for an unrelated benefit, and a figure from an unrelated endorsement", async () => {
    const n = doc("N_ENDT");
    await gate("benefit not on the row", n, [{ who: M.devi, benefit: "Surgical benefit", passage: line(n, "Annual limit"), column: "Adult – New", value: 650_000 }], "Devi's surgical benefit is S$650,000.", "rejected");
    await gate("sentence names another benefit", n, [{ who: M.devi, benefit: "Annual limit", passage: line(n, "Annual limit"), column: "Adult – New", value: 650_000 }], "Devi's room and board benefit is S$650,000.", "rejected", /does not name the benefit/);
    const fc = doc("P_FC_ENDT");
    await gate("another endorsement's figure", fc, [{ who: M.aaron, benefit: "Yearly claim limit", passage: passageOf(fc, "Outpatient fracture"), column: "Adult / After", value: 1_400 }], "Aaron's yearly claim limit is S$1,400.", "rejected");
  });
  await check("B6 a stage column the sentence does not name; a plan column with no binding", async () => {
    const c = doc("N_CI");
    await gate("stage not named", c, [{ who: M.devi, benefit: "Cancer benefit", passage: line(c, "Cancer benefit"), column: "Advanced stage", value: 100_000 }], "Devi's cancer benefit is S$100,000.", "rejected", /stage/);
    await gate("stage unbound", c, [{ who: M.devi, benefit: "Cancer benefit", passage: line(c, "Cancer benefit"), column: null, value: 100_000 }], "Devi's cancer benefit at the advanced stage is S$100,000.", "rejected", /not bound to a column/);
    const t = doc("P_TIER");
    await gate("plan unbound", t, [{ who: M.aaron, benefit: "Daily ward benefit", passage: line(t, "Daily ward benefit"), column: null, value: 350 }], "Aaron's daily ward benefit is S$350.", "rejected", /not bound to a column/);
  });
  await check("B7 endorsement documents are not exempt: a wrong version hash or a person the policy does not cover", async () => {
    const d = doc("P_ENDT");
    const s = "Bella's yearly claim limit is S$1,200,000.";
    const a = answer(s, [bind(d, M.bella, "Yearly claim limit", line(d, "Yearly claim limit"), "Revised", s, 1_200_000)], ACCOUNT_P);
    assert.ok((await verifyAnswerFigures(a, { accountId: ACCOUNT_P, userText: "" })).length >= 1, "a person the endorsement does not speak for");
    const s2 = "Aaron's yearly claim limit is S$1,200,000.";
    const a2 = answer(s2, [{ ...bind(d, M.aaron, "Yearly claim limit", line(d, "Yearly claim limit"), "Revised", s2, 1_200_000), documentHash: "h-other" }], ACCOUNT_P);
    assert.ok((await verifyAnswerFigures(a2, { accountId: ACCOUNT_P, userText: "" })).length >= 1, "another version");
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:dimensions-test ${results.length - failed.length}/${results.length} passed`);
  await db.close();
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

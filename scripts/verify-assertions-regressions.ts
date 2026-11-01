/**
 * Round 16: the answer-verification layer (lib/chat/assertions.ts and the totals that rely on it).
 *
 * An external review found that verifyAssertion() and rephrasingIsFaithful() accepted a reversal of
 * what the cited passage says ("Fractures are covered" against "Fractures are not covered."), that an
 * assertion with no document hash passed the version check, that the portfolio totals defaulted a
 * missing currency to SGD, printed other currencies as S$ and ignored the coverage verification flags,
 * and that the independent battery's full pass did not require its citation check.
 *
 *  V  verifyAssertion negatives: negation and polarity, an Exclusions heading, a condition / qualifier
 *     dropped, a unit or period swapped, an amount from a neighbouring row, a currency swapped or
 *     missing, a missing or unknown document hash, a superseded document, the wrong person;
 *  P  positive controls: true statements in many phrasings still pass (the fix is not over-strict);
 *  R  rephrasingIsFaithful: reversal, dropped condition, swapped period; faithful phrasings pass;
 *  T  totals: the registry "total death cover" path and the premium total (PGlite, real SQL) keep
 *     each printed currency, never default or relabel one, never add across currencies, and leave
 *     out (and say why) a figure that is unverified, has no currency or is for someone else;
 *  G  the save-time gate every chat answer path passes (lib/chat/answer-verification.ts): a figure must be
 *     printed beside its currency on a cited page (or be a total / period of such figures in one currency,
 *     or the household's own figure); a cover statement the cited page contradicts is removed;
 *  F  formatMoney never shows USD/MYR as S$ and says when a currency is unknown;
 *  S  the r7 battery's full pass requires its citation check.
 *
 * Every check runs; failures are collected; exit 1 if any failed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyAssertion, verifyAssertions, rephrasingIsFaithful, type Assertion, type VerifyContext, type AssertionDocument } from "@/lib/chat/assertions";
import { formatMoney } from "@/lib/format/currency";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     "));
  }
}

const ACCT = "00000000-0000-0000-0000-0000000000a1";
const ME = { id: "p-me", display_name: "Lim Wei Ming", preferred_name: "Wei Ming", relationship: "self" };
const SPOUSE = { id: "p-spouse", display_name: "Tan Hui Ling", preferred_name: "Hui Ling", relationship: "spouse" };
const doc = (o: Partial<AssertionDocument> = {}): AssertionDocument => ({ id: "d1", accountId: ACCT, lifecycleState: "active", supersededAt: null, quarantineStatus: "scan_clean", fileHash: "sha256:v2", subjectIds: [ME.id], ...o });
const ctxFor = (page: string, d: AssertionDocument = doc(), people = [ME, SPOUSE]): VerifyContext => ({ accountId: ACCT, people, documents: { d1: d }, pageText: () => page });
/** An assertion whose passage is `passage` on a page that holds `page` (default: the passage itself). */
const make = (text: string, passage: string, o: Partial<Assertion> = {}): Assertion => ({ kind: "policy_fact", text, subjectId: ME.id, policyId: "d1", documentHash: "sha256:v2", page: 2, passage, ...o });
const pass = (a: Assertion, page = a.passage, d?: AssertionDocument) => verifyAssertion(a, ctxFor(page, d));
const rejects = (label: string, a: Assertion, page = a.passage, reason?: RegExp, d?: AssertionDocument) => {
  const r = pass(a, page, d);
  assert.ok(r, label + ": was accepted -- «" + a.text + "» against «" + a.passage + "»");
  if (reason) assert.match(r!, reason, label + ": " + r);
};
const accepts = (label: string, a: Assertion, page = a.passage, d?: AssertionDocument) => {
  const r = pass(a, page, d);
  assert.equal(r, null, label + ": rejected (" + r + ") -- «" + a.text + "» against «" + a.passage + "»");
};

async function unit() {
  // ================================================================ V negatives
  await check("V01 defect 1: 'Fractures are covered' is rejected against 'Fractures are not covered.'", () => {
    rejects("reversal", make("Fractures are covered", "Fractures are not covered."), undefined, /says the opposite|not covered|negat/i);
  });
  await check("V02 every negation marker reverses a coverage claim (and the negative statement itself still passes)", () => {
    const passages: [string, string, string][] = [
      ["Fractures are not covered.", "Fractures are covered", "Fractures are not covered"],
      ["No benefit is payable for fractures.", "A benefit is payable for fractures", "No benefit is payable for fractures"],
      ["Fractures are excluded.", "Fractures are covered", "Fractures are excluded"],
      ["We do not cover fractures.", "We cover fractures", "Fractures are not covered"],
      ["We will not pay for fractures.", "We will pay for fractures", "We will not pay for fractures"],
      ["The insurer shall not be liable for fractures.", "The insurer is liable for fractures", "The insurer is not liable for fractures"],
      ["Fracture benefit: Nil", "Fracture benefit is covered", "Fracture benefit: Nil"],
      ["Fracture benefit: Not payable", "Fracture benefit: payable", "Fracture benefit: Not payable"],
      ["Fracture benefit: Not covered", "Fracture benefit: covered", "Fracture benefit: Not covered"],
      ["Fractures does not form part of the cover.", "Fractures form part of the cover", "Fractures are not part of the cover"],
      ["There is no cover for fractures.", "There is cover for fractures", "There is no cover for fractures"],
    ];
    for (const [passage, wrong, right] of passages) {
      rejects("negation «" + passage + "»", make(wrong, passage));
      accepts("negation control «" + passage + "»", make(right, passage));
    }
  });
  await check("V03 a statement printed under an Exclusions heading is not cover", () => {
    const page = "Section 4 Benefits\nHospital cash S$100 per day\nSection 5 Exclusions\nCosmetic surgery\nDental treatment\nSection 6 Claims";
    rejects("under Exclusions", make("Dental treatment is covered", "Dental treatment"), page, /exclu/i);
    rejects("under Exclusions (row)", make("Cosmetic surgery: covered", "Cosmetic surgery"), page, /exclu/i);
    const page2 = "WHAT IS NOT COVERED\nInjuries from extreme sports\nWHAT WE PAY\nHospital cash";
    rejects("under 'What is not covered'", make("Injuries from extreme sports are covered", "Injuries from extreme sports"), page2, /exclu/i);
    accepts("exclusion stated as one", make("Exclusions: Dental treatment", "Dental treatment"), page);
    accepts("a benefit under a benefits heading", make("Hospital cash: S$100 per day", "Hospital cash S$100 per day", { amount: 100, currency: "SGD" }), page);
  });
  await check("V04 an exception (unless / except) must be carried by a positive claim", () => {
    const passage = "Dental treatment is excluded unless caused by an accident.";
    rejects("carve-out dropped", make("Dental treatment is covered", passage));
    accepts("carve-out carried", make("Dental treatment is covered if caused by an accident", passage));
    accepts("the exclusion as printed", make("Dental treatment is excluded unless caused by an accident", passage));
    rejects("exclusion without its exception", make("Dental treatment is excluded", passage), passage, /condition|unless|except/i);
  });
  await check("V05 a condition or qualifier in the passage must be carried (waiting period, only if, subject to, age limit)", () => {
    const ci = "Critical illness benefit S$100,000, payable only if diagnosed after a waiting period of 90 days.";
    rejects("waiting period dropped", make("Critical illness benefit: S$100,000", ci, { amount: 100000, currency: "SGD" }), ci, /condition|qualif/i);
    accepts("carried in the text", make("Critical illness benefit: S$100,000, payable only if diagnosed after a waiting period of 90 days", ci, { amount: 100000, currency: "SGD" }));
    accepts("carried as conditions", make("Critical illness benefit: S$100,000", ci, { amount: 100000, currency: "SGD", conditions: ["payable only if diagnosed", "after a waiting period of 90 days"] }));
    const op = "Outpatient benefit S$500 per year, subject to a deductible of S$50 per visit.";
    rejects("subject to dropped", make("Outpatient benefit: S$500 per year", op, { amount: 500, currency: "SGD" }));
    const age = "Death benefit S$200,000, cover until age 75.";
    rejects("age limit dropped", make("Death benefit: S$200,000", age, { amount: 200000, currency: "SGD" }));
    accepts("age limit carried", make("Death benefit: S$200,000, cover until age 75", age, { amount: 200000, currency: "SGD" }));
    const wrongAge = make("Death benefit: S$200,000, cover until age 85", age, { amount: 200000, currency: "SGD" });
    rejects("age limit changed", wrongAge);
  });
  await check("V06 a unit or period swapped or dropped is rejected (per day / per year / per event / lifetime / % / days vs months)", () => {
    const hc = "Hospital cash S$100 per day, up to 30 days.";
    rejects("per day -> per year", make("Hospital cash: S$100 per year, up to 30 days", hc, { amount: 100, currency: "SGD" }), hc, /period|unit/i);
    rejects("days -> months", make("Hospital cash: S$100 per day, up to 30 months", hc, { amount: 100, currency: "SGD" }), hc, /period|unit/i);
    rejects("period dropped", make("Hospital cash: S$100, up to 30 days", hc, { amount: 100, currency: "SGD" }), hc, /period|unit/i);
    const ev = "Outpatient limit S$1,000 per event.";
    rejects("per event -> per year", make("Outpatient limit: S$1,000 per year", ev, { amount: 1000, currency: "SGD" }));
    const life = "Lifetime limit S$2,000,000";
    rejects("lifetime -> annual", make("Annual limit: S$2,000,000", life, { amount: 2000000, currency: "SGD" }));
    rejects("lifetime -> per year", make("Limit: S$2,000,000 per year", life, { amount: 2000000, currency: "SGD" }));
    const co = "Co-insurance 10% of the eligible bill.";
    rejects("% -> days", make("Co-insurance: 10 days", co));
    const wp = "Waiting period of 90 days for critical illness.";
    rejects("90 days -> 90 months", make("Waiting period for critical illness: 90 months", wp));
  });
  await check("V07 an amount must belong to the row it is stated for, not a neighbouring row", () => {
    const passage = "Hospital cash S$100 per day\nSurgical benefit S$5,000 per operation";
    rejects("neighbouring row", make("Hospital cash: S$5,000 per operation", passage, { amount: 5000, currency: "SGD" }), passage, /row|belong/i);
    accepts("its own row", make("Hospital cash: S$100 per day", passage, { amount: 100, currency: "SGD" }));
    accepts("the other row", make("Surgical benefit: S$5,000 per operation", passage, { amount: 5000, currency: "SGD" }));
    const piped = "Accidental death | S$200,000 ; Accidental medical expenses | S$5,000";
    rejects("neighbouring cell", make("Accidental medical expenses: S$200,000", piped, { amount: 200000, currency: "SGD" }));
  });
  await check("V08 a currency swapped is rejected even when the other currency appears elsewhere in the passage", () => {
    const p = "Death benefit US$250,000. Premium S$1,200 a year.";
    rejects("USD shown as SGD", make("Death benefit: S$250,000", p, { amount: 250000, currency: "SGD" }), p, /currency/i);
    rejects("MYR shown as SGD", make("Death benefit: S$50,000", "Death benefit RM50,000", { amount: 50000, currency: "SGD" }), undefined, /currency/i);
    rejects("text currency differs from the assertion's", make("Death benefit: S$250,000", "Death benefit US$250,000", { amount: 250000, currency: "USD" }), undefined, /currency/i);
  });
  await check("V09 a missing currency is unknown: never defaulted, never shown as a bare $", () => {
    rejects("amount with no currency", make("Death benefit: 250,000", "Death benefit 250,000", { amount: 250000, currency: null }), undefined, /currency/i);
    rejects("bare $ in a bare passage", make("Death benefit: $250,000", "Death benefit $250,000", { amount: 250000, currency: null }), undefined, /currency/i);
    rejects("SGD assumed for a bare passage", make("Death benefit: S$250,000", "Death benefit $250,000", { amount: 250000, currency: "SGD" }), undefined, /currency/i);
  });
  await check("V10 defect 3: a missing or unknown document hash fails the version check", () => {
    const a = make("Death sum insured: S$250,000", "Death Sum Insured SGD 250,000", { amount: 250000, currency: "SGD" });
    accepts("control", a);
    rejects("assertion has no hash", { ...a, documentHash: null }, undefined, /version/i);
    rejects("assertion has an empty hash", { ...a, documentHash: "" }, undefined, /version/i);
    rejects("document's version unknown", a, a.passage, /version/i, doc({ fileHash: null }));
    rejects("old version", { ...a, documentHash: "sha256:v1" }, undefined, /version/i);
  });
  await check("V11 a superseded document fails unless the assertion presents it as superseded", () => {
    const a = make("Death sum insured: S$200,000", "Death Sum Insured SGD 200,000", { amount: 200000, currency: "SGD" });
    rejects("superseded", a, a.passage, /newer version|superseded|replaced/i, doc({ supersededAt: "2026-01-01" }));
    accepts("presented as superseded", { ...a, text: "The earlier schedule, since replaced, stated a death sum insured of S$200,000", presentedAsSuperseded: true }, a.passage, doc({ supersededAt: "2026-01-01" }));
    rejects("flag without saying so", { ...a, presentedAsSuperseded: true }, a.passage, /superseded|replaced|newer/i, doc({ supersededAt: "2026-01-01" }));
  });
  await check("V12 a fact about another person, or naming another person, is rejected", () => {
    const a = make("Death sum insured: S$250,000", "Death Sum Insured SGD 250,000", { amount: 250000, currency: "SGD" });
    rejects("subject not on the document", { ...a, subjectId: SPOUSE.id }, undefined, /belong|person|not about/i);
    rejects("text names someone else", { ...a, text: "Hui Ling's death sum insured: S$250,000" }, undefined, /someone else|person/i);
    const r = verifyAssertion(a, { ...ctxFor(a.passage), people: [SPOUSE] });
    assert.ok(r && /not about/.test(r), "subject outside the question: " + r);
  });

  // ================================================================ P positive controls
  await check("P01 true statements in many phrasings still pass", () => {
    const cases: [string, string, Partial<Assertion>?][] = [
      ["Death sum insured: S$250,000", "Death Sum Insured SGD 250,000", { amount: 250000, currency: "SGD" }],
      ["Death sum insured: SGD 250,000", "Death Sum Insured S$250,000", { amount: 250000, currency: "SGD" }],
      ["Death benefit: US$250,000", "Death benefit USD 250,000", { amount: 250000, currency: "USD" }],
      ["Death benefit: RM 50,000", "Death benefit RM50,000", { amount: 50000, currency: "MYR" }],
      ["Hospital cash: S$100 per day, up to 30 days", "Daily Hospital Cash: We pay S$100 per day of hospital stay, up to 30 days.", { amount: 100, currency: "SGD" }],
      ["Hospital cash: S$100 a day, for a maximum of 30 days", "Hospital cash S$100 per day, up to 30 days.", { amount: 100, currency: "SGD" }],
      ["Outpatient limit: S$500 a year", "Outpatient limit S$500 per annum", { amount: 500, currency: "SGD" }],
      ["Outpatient limit: S$500 yearly", "Outpatient limit S$500 p.a.", { amount: 500, currency: "SGD" }],
      ["Lifetime limit: S$2,000,000", "Lifetime limit S$2,000,000", { amount: 2000000, currency: "SGD" }],
      ["Accidental medical expenses: S$5,000 per accident", "Accidental medical expenses S$5,000 per accident", { amount: 5000, currency: "SGD" }],
      ["Waiting period: 90 days", "Waiting period of 90 days applies to critical illness."],
      ["A 90-day waiting period applies to critical illness", "Waiting period of 90 days applies to critical illness."],
      ["Co-insurance: 10%", "Co-insurance 10% of the eligible bill."],
      ["Fractures are covered", "Fractures are covered."],
      ["Fractures are covered up to S$2,000 per accident", "Fractures are covered up to S$2,000 per accident.", { amount: 2000, currency: "SGD" }],
      ["Fractures are not covered", "Fractures are not covered."],
      ["Pre-existing conditions are excluded", "Pre-existing conditions are not covered."],
      ["Pre-existing conditions: Not covered", "Pre-existing conditions\tNot covered"],
      ["Ward entitlement (Plan B column): B1", "Ward entitlement\tA\tB1\tB2"],
      ["Hospital cash: S$100 per day, not exceeding 30 days", "Hospital cash S$100 per day, not exceeding 30 days", { amount: 100, currency: "SGD" }],
      ["No-claim discount: 20%", "No-claim discount 20%"],
      ["Policy No.: L-100", "Policy No. L-100"],
      ["Death benefit: S$200,000, cover until age 75", "Death benefit S$200,000, cover until age 75.", { amount: 200000, currency: "SGD" }],
      ["Critical illness benefit: S$100,000 after a 90-day waiting period", "Critical illness benefit S$100,000 after a waiting period of 90 days.", { amount: 100000, currency: "SGD" }],
      ["Hospital cash: 100 per day", "Benefits (S$)\nHospital cash 100 per day", { amount: 100, currency: "SGD" }],
      ["Surgical benefit: S$5,000 per operation", "Hospital cash S$100 per day\nSurgical benefit S$5,000 per operation", { amount: 5000, currency: "SGD" }],
    ];
    for (const [text, passage, o] of cases) accepts("«" + text + "»", make(text, passage, o));
    // Exclusion-heading pages with a benefit read correctly from the benefits part.
    accepts("an exclusion's own exception, under its heading", make("Exclusions: This exclusion does not apply to emergency dental treatment", "This exclusion does not apply to emergency dental treatment."), "General Exclusions\n1. Dental treatment.\nThis exclusion does not apply to emergency dental treatment.");
    accepts("exclusion line under its heading", make("Exclusions: Dental treatment unless caused by an accident", "Dental treatment unless caused by an accident"), "Exclusions\nDental treatment unless caused by an accident");
    // The batch API keeps and rejects as the single one does.
    const r = verifyAssertions([make("Fractures are covered", "Fractures are not covered."), make("Fractures are not covered", "Fractures are not covered.")], ctxFor("Fractures are not covered."));
    assert.equal(r.kept.length, 1); assert.equal(r.rejected.length, 1);
  });

  // ================================================================ R rephrasing
  await check("R01 defect 2: a rephrasing that reverses the passage is not faithful", () => {
    const neg = make("Fractures are not covered", "Fractures are not covered.");
    assert.equal(rephrasingIsFaithful("Fractures are covered.", [neg]), false, "reversal of a negative assertion");
    // Even when the kept assertion's own wording got the polarity wrong, the passage decides.
    assert.equal(rephrasingIsFaithful("Fractures are covered.", [make("Fractures are covered", "Fractures are not covered.")]), false, "reversal of the passage");
    assert.equal(rephrasingIsFaithful("Good news: your plan pays for fractures.", [neg]), false, "reversal in other words");
    assert.equal(rephrasingIsFaithful("Dental treatment is covered.", [make("Exclusions: Dental treatment", "Dental treatment")]), false, "an exclusion narrated as cover");
  });
  await check("R02 a rephrasing that drops a condition, swaps a period or a currency is not faithful", () => {
    const ci = make("Critical illness benefit: S$100,000 after a waiting period of 90 days", "Critical illness benefit S$100,000 after a waiting period of 90 days.", { amount: 100000, currency: "SGD" });
    assert.equal(rephrasingIsFaithful("You get S$100,000 for critical illness.", [ci]), false, "waiting period dropped");
    const hc = make("Hospital cash: S$100 per day", "Hospital cash S$100 per day", { amount: 100, currency: "SGD" });
    assert.equal(rephrasingIsFaithful("Hospital cash pays S$100 per year.", [hc]), false, "period swapped");
    assert.equal(rephrasingIsFaithful("Hospital cash pays US$100 per day.", [hc]), false, "currency swapped");
  });
  await check("R03 faithful rephrasings still pass", () => {
    const base = make("Death sum insured: S$250,000", "Death Sum Insured SGD 250,000", { amount: 250000, currency: "SGD" });
    assert.equal(rephrasingIsFaithful("Wei Ming's Term Protector states S$250,000 on death.", [base]), true);
    const neg = make("Fractures are not covered", "Fractures are not covered.");
    assert.equal(rephrasingIsFaithful("Fractures are not covered under this plan.", [neg]), true);
    assert.equal(rephrasingIsFaithful("This plan excludes fractures.", [neg]), true);
    const ci = make("Critical illness benefit: S$100,000 after a waiting period of 90 days", "Critical illness benefit S$100,000 after a waiting period of 90 days.", { amount: 100000, currency: "SGD" });
    assert.equal(rephrasingIsFaithful("Critical illness pays S$100,000, after a waiting period of 90 days.", [ci]), true);
    const hc = make("Hospital cash: S$100 per day, up to 30 days", "Hospital cash S$100 per day, up to 30 days", { amount: 100, currency: "SGD" });
    assert.equal(rephrasingIsFaithful("Hospital cash pays S$100 a day, for up to 30 days.", [hc]), true);
  });

  // ================================================================ F formatting
  await check("F01 formatMoney keeps the printed currency and never shows another as S$ or assumes one", () => {
    assert.match(formatMoney(250000, "SGD"), /^S\$250,000$/);
    assert.match(formatMoney(250000, "USD"), /^US\$250,000$/);
    for (const c of ["MYR", "EUR", "GBP", "HKD", "AUD", "JPY"]) assert.ok(!/S\$/.test(formatMoney(1000, c)) || /HK\$|A\$/.test(formatMoney(1000, c)), c + " shown as " + formatMoney(1000, c));
    assert.ok(!/^S\$/.test(formatMoney(1000, "MYR")), "MYR as S$");
    for (const c of [null, undefined, "", "$"]) { const t = formatMoney(1000, c as string | null); assert.ok(!/S\$|SGD/.test(t), JSON.stringify(c) + " -> " + t); assert.match(t, /currency unknown/i); }
  });

  // ================================================================ S r7 scorer
  await check("S01 the r7 battery's full pass requires the citation check", async () => {
    const B = await import("./r7-robust/battery");
    const row = (cite: "ok" | "missing" | "n/a") => ({ household: "H1-tan", id: "x", turn: null, message: "", status: 200, ms: 1, expected: "answer", behaviour: "answer", behaviourOk: true,
      missing: [], forbiddenHits: [], qualifyReview: [], cite, detectorHits: [], summary: "", text: "", tags: [] }) as unknown as import("./r7-robust/battery").Scored;
    assert.equal(B.tally([row("ok"), row("n/a")]).fullPass, 2);
    assert.equal(B.tally([row("missing")]).fullPass, 0, "an answer citing the wrong page is not a full pass");
    assert.equal(B.passed(row("missing")), false);
    assert.equal(B.passed(row("ok")), true);
  });
}

// ================================================================ T totals (PGlite)
async function totals() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  for (const t of ["policy_coverages", "policy_benefits", "coverage_rules"])
    await db.exec(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS source_text_start int; ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS source_text_end int;
      ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS extraction_method text; ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS passage_verified boolean; ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS conflict_note text;`);
  await db.exec("ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_date date;");
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const r = rs.at(-1); return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;

  const A = ACCT;
  const id = (n: number) => "40000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const me = { ...ME, id: id(1) }, spouse = { ...SPOUSE, id: id(2) };
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household A')", [A]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [A]);
  for (const p of [me, spouse]) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [p.id, A, p.display_name, p.preferred_name, p.relationship]);
  const recent = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
  type D = { id: string; member: string; product: string; number: string; page: string; hash?: string | null; superseded?: boolean };
  const docs: Record<string, D> = {
    SGD: { id: id(101), member: me.id, product: "Term Shield", number: "T-1", page: "Term Shield schedule. Life assured: Lim Wei Ming. Death benefit S$200,000." },
    USD: { id: id(102), member: me.id, product: "Dollar Life", number: "U-1", page: "Dollar Life schedule. Life assured: Lim Wei Ming. Death benefit US$100,000." },
    MYR: { id: id(103), member: me.id, product: "Ringgit Life", number: "M-1", page: "Ringgit Life schedule. Life assured: Lim Wei Ming. Death benefit RM 80,000." },
    NOCUR: { id: id(104), member: me.id, product: "Bare Life", number: "B-1", page: "Bare Life schedule. Life assured: Lim Wei Ming. Death benefit 50,000." },
    UNVER: { id: id(105), member: me.id, product: "Shaky Life", number: "S-1", page: "Shaky Life schedule. Death benefit S$300,000." },
    REVER: { id: id(108), member: me.id, product: "Recheck Life", number: "R-1", page: "Recheck Life schedule.\nLife assured: Lim Wei Ming\nDeath benefit S$20,000." },
    NOHASH: { id: id(106), member: me.id, product: "Hashless Life", number: "H-1", page: "Hashless Life schedule. Life assured: Lim Wei Ming. Death benefit S$70,000.", hash: null },
    SPOUSE: { id: id(107), member: spouse.id, product: "Spouse Term", number: "P-1", page: "Spouse Term schedule. Life assured: Tan Hui Ling. Death benefit S$400,000." },
  };
  for (const d of Object.values(docs)) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,quarantine_status,lifecycle_state,superseded_at,file_hash,benefits_indexed_at,conditions_indexed_at,ledger_read_at)
      VALUES($1,$2,$3,'Example Insurer',$4,$5,'Life','certificate',true,90,'ready',$6,$6,$7,'scan_clean','active',$8,$9,now(),now(),now())`,
      [d.id, A, d.member, d.product, d.number, d.product.toLowerCase().replace(/\W+/g, "-") + ".pdf", recent, d.superseded ? new Date().toISOString() : null, d.hash === undefined ? "sha256:" + d.number : d.hash]);
    await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [d.id, d.member, A]);
    await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,2,$3)", [A, d.id, d.page]);
  }
  const cov = (d: D, amount: number, currency: string | null, verified: boolean | null = true) => db.query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed,passage_verified)
      VALUES($1,$2,$3,'Death',$4,$5,$6,2,$7,true,true,$8)`, [A, d.id, d.member, amount, currency, d.product, d.page.split(". ").at(-1), verified]);
  await cov(docs.SGD, 200000, "SGD");
  await cov(docs.USD, 100000, "USD");
  await cov(docs.MYR, 80000, "MYR");
  await cov(docs.NOCUR, 50000, null);
  await cov(docs.UNVER, 300000, "SGD", false);
  // Flagged at ingestion (its row passage lacks the name), but the cited page prints the person's name and the amount beside its currency.
  await cov(docs.REVER, 20000, "SGD", false);
  await cov(docs.NOHASH, 70000, "SGD");
  await cov(docs.SPOUSE, 400000, "SGD");

  const { registryAnswer } = await import("@/lib/chat/registry-answers");
  await check("T01 defect 4: 'total death cover' keeps each currency, never defaults one, and adds only verified figures", async () => {
    const r = await registryAnswer({ accountId: A, question: "What is my total death cover?", family: [me, spouse], people: [me] });
    assert.ok(r, "the registry path answered");
    const text = [r!.summary, ...r!.details].join("\n");
    assert.match(text, /S\$220,000/, "the verified SGD figures are added up (S$200,000 + S$20,000): " + text);
    assert.match(text, /Recheck Life(?: \(Death benefit\))?: S\$20,000\./, "a figure flagged at ingestion stands once the same check passes on the cited page: " + text);
    assert.match(text, /US\$100,000/, "the USD figure keeps its currency");
    assert.ok(!/S\$100,000/.test(text.replace(/US\$100,000/g, "")), "USD shown as S$: " + text);
    assert.ok(/RM ?80,000|MYR ?80,000/.test(text), "the MYR figure keeps its currency: " + text);
    assert.ok(!/S\$80,000/.test(text), "MYR shown as S$: " + text);
    assert.ok(!/S\$50,000/.test(text), "a missing currency was defaulted to S$: " + text);
    assert.match(text, /50,000 \(currency unknown\)[^.]*prints no currency/i, "the figure with no currency is said to have none: " + text);
    assert.ok(!/S\$300,000/.test(text) || /not (?:verified|included|confirmed|added)/i.test(text), "an unverified figure was added: " + text);
    assert.ok(!/S\$(?:590,000|520,000|290,000|270,000|250,000|200,000 (?:plus|and))/.test(text.split("\n")[0]), "a total added unverified, unknown-currency or other-currency figures: " + text);
    assert.ok(!/S\$400,000/.test(text), "the spouse's cover is not mine: " + text);
    assert.ok(!/S\$70,000/.test(text) || /not (?:verified|included|confirmed|added)/i.test(text), "a figure from a document with no version hash was added: " + text);
    assert.ok(!/(?:adds up to|total(?:s)? )[^.]*(?:US\$|RM|MYR)[^.]*plus/i.test(text) || /kept separate|not added/i.test(text), "currencies added together: " + text);
    assert.match(text, /not added|kept separate|separately/i, "the answer says why the items are listed separately: " + text);
  });
  await check("T02 positive control: one verified SGD policy for the spouse is totalled as before", async () => {
    const r = await registryAnswer({ accountId: A, question: "What is Hui Ling's total death cover?", family: [me, spouse], people: [spouse] });
    assert.ok(r, "answered");
    assert.match(r!.summary, /S\$400,000/);
    assert.ok(r!.citations.some((c) => c.policyId === docs.SPOUSE.id && c.pageStart === 2), "cited at the page that prints it: " + JSON.stringify(r!.citations));
  });

  await check("T06 a death figure paid per month is an income, never added into a total, in any language", async () => {
    // A third person with their own documents (made up): a family income benefit paid monthly in ringgit, the same in
    // Malay, and a lump sum. Only the lump sum is a total; the monthly figures are listed with why.
    const child = { id: id(3), display_name: "Nur Aisyah Binti Ahmad", preferred_name: "Aisyah", relationship: "child" };
    await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [child.id, A, child.display_name, child.preferred_name, child.relationship]);
    const mine: D[] = [
      { id: id(111), member: child.id, product: "Family Income Plan", number: "F-1", page: "Family Income Plan schedule. Life assured: Nur Aisyah Binti Ahmad. Death benefit RM2,000 per month" },
      { id: id(112), member: child.id, product: "Pelan Pendapatan", number: "F-2", page: "Pelan Pendapatan jadual. Hayat diinsuranskan: Nur Aisyah Binti Ahmad. Kematian RM1,500 sebulan" },
      { id: id(113), member: child.id, product: "Lump Life", number: "F-3", page: "Lump Life schedule. Life assured: Nur Aisyah Binti Ahmad. Death benefit RM100,000" },
    ];
    for (const d of mine) {
      await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,quarantine_status,lifecycle_state,file_hash,benefits_indexed_at,conditions_indexed_at,ledger_read_at)
        VALUES($1,$2,$3,'Example Insurer',$4,$5,'Life','certificate',true,90,'ready',$6,$6,$7,'scan_clean','active',$8,now(),now(),now())`,
        [d.id, A, d.member, d.product, d.number, d.product.toLowerCase().replace(/\W+/g, "-") + ".pdf", recent, "sha256:" + d.number]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [d.id, d.member, A]);
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,2,$3)", [A, d.id, d.page]);
    }
    await cov(mine[0], 2000, "MYR"); await cov(mine[1], 1500, "MYR"); await cov(mine[2], 100000, "MYR");
    const r = await registryAnswer({ accountId: A, question: "What is Aisyah's total death cover?", family: [me, spouse, child], people: [child] });
    assert.ok(r, "answered");
    const text = [r!.summary, ...r!.details].join("\n");
    assert.ok(!/(?:RM|MYR) ?10[1-3],[05]00/.test(text), "a monthly figure was added into the total: " + text);
    assert.ok(/(?:RM|MYR) ?100,000/.test(text), "the lump sum is kept: " + text);
    assert.match(text, /2,000[^\n]*(?:a month|condition)/i, "the monthly figure is listed with why it is not added: " + text);
    assert.match(text, /1,500[^\n]*(?:a month|condition)/i, "the Malay monthly figure is listed with why it is not added: " + text);
  });

  // Premiums: a record with no currency is not a Singapore-dollar premium.
  await db.query(`INSERT INTO premium_records(account_id,policy_id,source_document_id,family_member_id,insurer,product_name,policy_number,amount,currency,frequency,source_page) VALUES
    ($1,$2,$2,$3,'Example Insurer','Term Shield','T-1',1200,'SGD','annual',2),($1,$4,$4,$3,'Example Insurer','Bare Life','B-1',900,NULL,'annual',2),($1,$5,$5,$3,'Example Insurer','Dollar Life','U-1',800,'USD','annual',2)`,
    [A, docs.SGD.id, me.id, docs.NOCUR.id, docs.USD.id]);
  await db.query("UPDATE policy_pages SET text=text||' Annual premium S$1,200.' WHERE policy_id=$1", [docs.SGD.id]);
  await db.query("UPDATE policy_pages SET text=text||' Annual premium 900.' WHERE policy_id=$1", [docs.NOCUR.id]);
  await db.query("UPDATE policy_pages SET text=text||' Annual premium US$800.' WHERE policy_id=$1", [docs.USD.id]);
  const { premiumAnswer } = await import("@/lib/chat/premium-answer");
  await check("T03 the premium total never defaults a missing currency to SGD nor adds currencies", async () => {
    const r = await premiumAnswer({ accountId: A, people: [me], question: "How much premium do I pay a year?" });
    const text = [r.summary, ...r.details].join("\n");
    assert.match(text, /S\$1,200/, "the SGD premium is stated: " + text);
    assert.match(text, /US\$800/, "the USD premium keeps its currency: " + text);
    assert.ok(!/S\$2,100|S\$2,900|S\$2,000|S\$900\b/.test(text), "a premium with no currency was counted as S$: " + text);
    assert.match(text, /Bare Life — 900 \(currency unknown\)[^.]*prints no currency/i, "the premium with no currency is said to have none: " + text);
  });

  await check("T04 'which policies are in US dollars?' never calls an unstated or other currency Singapore dollars", async () => {
    const r = await registryAnswer({ accountId: A, question: "Which of my policies are in US dollars?", family: [me, spouse], people: [me] });
    assert.ok(r, "answered");
    assert.match(r!.summary, /Dollar Life[^.;]*US dollars/);
    assert.match(r!.summary, /Malaysian ringgit|MYR/, "the MYR policy is not folded into 'Singapore dollars': " + r!.summary);
    assert.match(r!.summary, /Bare Life shows no currency/, "a policy with no stated currency is said to have none: " + r!.summary);
  });

  // ================================================================ G every answer path: the figure / cover gate at save time
  const { verifyAnswerFigures, figuresIn, FIGURE_LEFT_OUT_NOTE, CLAIM_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");
  const acc: D = { id: id(110), member: me.id, product: "Accident Plan", number: "PA-1", page: "Accident Plan schedule. Fractures are not covered. Hospital cash S$100 per day." };
  await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,quarantine_status,lifecycle_state,file_hash)
    VALUES($1,$2,$3,'Example Insurer',$4,$5,'Accident','certificate',true,90,'ready','pa.pdf','pa.pdf',$6,'scan_clean','active','sha256:pa')`, [acc.id, A, me.id, acc.product, acc.number, recent]);
  await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,2,$3)", [A, acc.id, acc.page]);
  const citeOf = (d: D) => ({ chunkId: "page:" + d.id + ":2", policyId: d.id, policyName: d.product, pageStart: 2, pageEnd: 2 });
  const answer = (summary: string, details: string[], cites: D[]) => ({ mode: "answer", summary, details, claimItems: [], nextSteps: [], confidence: null, citations: cites.map(citeOf), disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [] }) as unknown as import("@/types").ChatAnswer;
  // Gate R17: a figure is grounded only by its own sentence's binding, and a total / restatement only by an explicit
  // computation record (scripts/verify-gate-regressions.ts covers the loopholes); here, the old paths kept working.
  const bindTo = (d: D, benefit: string, passage: string) => ({ policyId: d.id, subjectId: me.id, benefit, documentHash: "sha256:" + d.number, pageStart: 2, pageEnd: 2, passage });
  const halfUp = { mode: "half_up", precision: 2 } as const;
  await check("G01 figures bound to their own cited passage, and totals / periods of them with an explicit record, are kept", async () => {
    const s1 = "Your death cover adds up to S$220,000.", d1 = "Term Shield death benefit: S$200,000.", d2 = "Recheck Life death benefit: S$20,000.", d3 = "Term Shield premium S$1,200 a year, about S$100 a month.";
    const ts = bindTo(docs.SGD, "Death benefit", "Death benefit S$200,000."), rl = bindTo(docs.REVER, "Death benefit", "Death benefit S$20,000."), pr = bindTo(docs.SGD, "Annual premium", "Annual premium S$1,200.");
    const a = answer(s1, [d1, d2, d3], [docs.SGD, docs.REVER]);
    Object.assign(a, { figureBindings: [{ ...ts, sentence: d1, value: 200000, currency: "SGD" }, { ...rl, sentence: d2, value: 20000, currency: "SGD" }, { ...pr, sentence: d3, value: 1200, currency: "SGD" }],
      computations: [{ sentence: s1, result: { value: 220000, currency: "SGD" }, operation: "sum", period: null, currency: "SGD", rounding: halfUp, scope: "person", operands: [{ value: 200000, currency: "SGD", period: null, role: "benefit", binding: ts }, { value: 20000, currency: "SGD", period: null, role: "benefit", binding: rl }] },
        { sentence: d3, result: { value: 100, currency: "SGD" }, operation: "per_period", fromPeriod: "year", toPeriod: "month", factor: 12, period: "year", currency: "SGD", rounding: halfUp, operands: [{ value: 1200, currency: "SGD", period: "year", role: "premium", binding: pr }] }] });
    const problems = await verifyAnswerFigures(a, { accountId: A });
    assert.deepEqual(problems, []); assert.match(a.summary, /S\$220,000/); assert.equal(a.details.length, 3);
    // The same answer without its bindings and records: nothing a cited page prints somewhere grounds it any more.
    const bare = answer(s1, [d1, d2, d3], [docs.SGD, docs.REVER]);
    await verifyAnswerFigures(bare, { accountId: A }); assert.ok(!/220,000|200,000|S\$100 a month/.test([bare.summary, ...bare.details].join(" ")), [bare.summary, ...bare.details].join(" "));
    const b = answer("You asked about S$5,000.", [], [docs.SGD]);
    assert.deepEqual(await verifyAnswerFigures(b, { accountId: A, userText: "is S$5,000 enough?" }), [], "a figure from the household's own message, attributed");
    await db.query("UPDATE policy_pages SET text=text||' Spouse S$612.00 per year. Each child S$298.00 per year.' WHERE policy_id=$1", [docs.SGD.id]);
    const sd = "For the dependants you pay S$1,506 a year for your family: S$612.00 + 3 × S$298.00 in premiums.";
    const sp = { ...bindTo(docs.SGD, "Spouse premium", "Spouse S$612.00 per year."), subjectId: spouse.id }, ch = bindTo(docs.SGD, "Each child premium", "Each child S$298.00 per year.");
    await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [docs.SGD.id, spouse.id, A]);
    const childOp = { value: 298, currency: "SGD", period: "year", role: "premium", binding: ch };
    const dep = answer(sd, [], [docs.SGD]);
    Object.assign(dep, { figureBindings: [{ ...sp, sentence: sd, value: 612, currency: "SGD" }, { ...ch, sentence: sd, value: 298, currency: "SGD" }],
      computations: [{ sentence: sd, result: { value: 1506, currency: "SGD" }, operation: "sum", period: "year", currency: "SGD", rounding: halfUp, scope: "household", operands: [{ value: 612, currency: "SGD", period: "year", role: "premium", binding: sp },
        { value: 894, currency: "SGD", period: "year", role: "premium", computation: { sentence: "", result: { value: 894, currency: "SGD" }, operation: "product", factor: 3, period: "year", currency: "SGD", rounding: halfUp, operands: [childOp] } }] }] });
    assert.deepEqual(await verifyAnswerFigures(dep, { accountId: A }), [], "a total of counted dependant premiums, recorded");
  });
  await check("G02 a figure in another currency, from no cited page, or with no citation at all is removed and the answer says so", async () => {
    const s2 = "Term Shield death benefit is S$200,000.";
    const a = answer("Dollar Life pays S$100,000 on death. " + s2, [], [docs.USD, docs.SGD]);
    Object.assign(a, { figureBindings: [{ ...bindTo(docs.USD, "Death benefit", "Death benefit US$100,000."), sentence: "Dollar Life pays S$100,000 on death.", value: 100000, currency: "SGD" }, { ...bindTo(docs.SGD, "Death benefit", "Death benefit S$200,000."), sentence: s2, value: 200000, currency: "SGD" }] });
    const p = await verifyAnswerFigures(a, { accountId: A });
    assert.equal(p.length, 1, JSON.stringify(p)); assert.ok(!/S\$100,000/.test(a.summary)); assert.match(a.summary, /S\$200,000/); assert.ok(a.details.includes(FIGURE_LEFT_OUT_NOTE));
    const b = answer("Your total cover is S$999,000.", [], []);
    await verifyAnswerFigures(b, { accountId: A }); assert.ok(!/999,000/.test(b.summary)); assert.equal(b.summary, FIGURE_LEFT_OUT_NOTE);
    const c = answer("Your cover adds up to S$500,000.", [], [docs.SGD, docs.USD]);
    await verifyAnswerFigures(c, { accountId: A }); assert.ok(!/500,000/.test(c.summary), "S$200,000 + US$100,000 is never S$300,000 or more: " + c.summary);
    const d = answer("Your cover adds up to S$300,000.", [], [docs.SGD, docs.USD]);
    await verifyAnswerFigures(d, { accountId: A }); assert.ok(!/300,000/.test(d.summary), "currencies were added: " + d.summary);
    assert.deepEqual(figuresIn("RM 80,000 and US$1.5m").map((f) => [f.currency, f.value]), [["MYR", 80000], ["USD", 1500000]]);
  });
  await check("G03 a cover statement the cited page contradicts is removed; a supported one stays", async () => {
    const a = answer("Fractures are covered. Hospital cash is S$100 per day.", [], [acc]);
    Object.assign(a, { figureBindings: [{ policyId: acc.id, subjectId: me.id, benefit: "Hospital cash", documentHash: "sha256:pa", pageStart: 2, pageEnd: 2, passage: "Hospital cash S$100 per day.", sentence: "Hospital cash is S$100 per day.", value: 100, currency: "SGD" }] });
    const p = await verifyAnswerFigures(a, { accountId: A });
    assert.equal(p.length, 1, JSON.stringify(p)); assert.ok(!/Fractures are covered/.test(a.summary)); assert.match(a.summary, /S\$100 per day/); assert.ok(a.details.includes(CLAIM_LEFT_OUT_NOTE) || a.details.includes(FIGURE_LEFT_OUT_NOTE));
    const b = answer("Fractures are not covered.", [], [acc]);
    assert.deepEqual(await verifyAnswerFigures(b, { accountId: A }), []);
  });
  await check("G05 a policy-stated limit stands only with its own binding to a cited page that prints its amount beside its currency", async () => {
    const lim = (amount: number, currency: string, d: D, binding?: unknown) => ({ kind: "policy_stated_limit", label: "Policy-stated coverage limit", notice: "", benefitTitle: "Death benefit", ownerName: null, amount, currency, amountText: "x", quote: "", citation: citeOf(d), ...(binding ? { binding } : {}) });
    const a = answer("Here is the limit.", [], []);
    (a as { policyStatedLimits?: unknown[] }).policyStatedLimits = [lim(200000, "SGD", docs.SGD, bindTo(docs.SGD, "Death benefit", "Death benefit S$200,000.")), lim(100000, "SGD", docs.USD, bindTo(docs.USD, "Death benefit", "Death benefit US$100,000.")), lim(200000, "SGD", docs.SGD)];
    const p = await verifyAnswerFigures(a, { accountId: A });
    assert.equal(a.policyStatedLimits!.length, 1, "the US$ limit relabelled S$, and the card with no binding, are dropped"); assert.equal(a.policyStatedLimits![0].amount, 200000); assert.equal(p.length, 2);
  });
  await check("G04 the gate is wired into the save of every chat answer (workflow saveTurn)", async () => {
    const src = await readFile(path.resolve("lib/chat/workflow.ts"), "utf8");
    const save = src.slice(src.indexOf("const saveTurn=async"), src.indexOf("return storeTurn(args);") + 30);
    assert.match(save, /verifyAnswerFigures\(args\.answer/, "saveTurn calls the gate");
    assert.ok(src.indexOf("verifyAnswerFigures(args.answer") < src.indexOf("return storeTurn(args);"), "before the answer is stored");
    assert.equal((src.match(/\bstoreTurn\(/g) ?? []).length, 1, "no other path stores a turn around the gate");
  });
}

async function main() {
  await unit();
  await totals();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { for (const f of failed) console.log("FAILED: " + f.name); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

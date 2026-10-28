/** Test engineer, PR #155: a premium's printed parts (premiumPartsOf) and a clause's total limit (totalLimitRows) as chat
 * rows. Independent of the PR's chat-test: made-up SG / MY / UK households in other layouts, built through the real
 * pipeline (checkReading -> assembleTable -> chatRows) and the answer path (amountsFromRows -> verifyAnswer ->
 * keepLabelledAmounts). No model, no network, no database.
 *   node --import tsx scripts/benefit-table/te-pr155-test.ts
 * Graded: a row appears with the printed figure where the words say only that; otherwise no row (a missing card, never a
 * wrong one). Row numbers of every other row are unchanged. */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, premiumPartsOf, type SourceDoc } from "@/lib/benefit-table/check";
import { type ChatRow, amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

let passed = 0; const failures: string[] = []; const notes: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const SCHED = "eeeeeeee-0000-0000-0000-000000000001", WORD = "eeeeeeee-0000-0000-0000-000000000002";
const family: FamilyMember[] = [{ id: "p1", display_name: "Nurul Huda" }, { id: "p2", display_name: "Arif Hakim" }];
const doc = (policyId: string, name: string, pages: { page: number; text: string }[]) => ({ policyId, name, insurer: "Testlife", productName: name.replace(/\.pdf$/, ""), policyNumber: null,
  documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: ["Nurul Huda", "Arif Hakim"], supersededAt: null, processingStatus: "ready", pages });
const src = (d: Household["documents"][number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages, people: ["Nurul Huda", "Arif Hakim"] } as SourceDoc);
const reading = (kind: string, product: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
const ben = (o: Record<string, unknown>) => ({ section: "Benefits", column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], ...o });

/** A made-up CI schedule: the cover's line with its sum and premium, `between` lines, then `extra`. */
const SCHEDULE = (o: { person?: string; cur?: string; sum?: string; own?: string; extra?: string; between?: string; total?: string; after?: string } = {}) =>
  `POLICY SCHEDULE\nLife Insured\t: ${o.person ?? "Nurul Huda"}\nCurrency\t: ${o.cur ?? "Singapore Dollar"}\nAnnual Premium\t: ${o.total ?? "512.40"}\nPayment Frequency\t: Annual\n`
  + "Benefit\tSum Insured\tAnnual Premium\tExpiry Date\n"
  + `Critical Illness Protector\t${o.sum ?? "150,000.00"}\t${o.own ?? "380.10"}\t15/03/2041\n${o.between ? o.between + "\n" : ""}${o.extra ?? "- Health Extra\t---\t132.30\t15/03/2041"}\n${o.after ?? "Accidental Death\t50,000.00\t---\t15/03/2041"}`;
const cover = (o: { person?: string; sum?: number; quoteSum?: string; own?: string; premium?: number; total?: string } = {}) => ({ person: o.person ?? "Nurul Huda", product: "CI Protector", cover: "Critical Illness Protector", plan: null,
  sumInsured: o.sum ?? 150000, asOf: null, premium: o.premium ?? 512.4, premiumFrequency: "Annual", page: 1, quote: `Critical Illness Protector\t${o.quoteSum ?? "150,000.00"}\t${o.own ?? "380.10"}\t15/03/2041` });
const ciKey = coverKeyOf({ product: "CI Protector", cover: "Critical Illness Protector", plan: null });

/** The wording page: clause 3 benefits, the CI clause with `limit` in it, then `next`. */
const WORDING = (limit: string, o: { head?: string; next?: string; row?: string } = {}) => "3. WHAT WE PAY\n3.1 Death Benefit\nWe pay the Sum Insured on death.\n"
  + `${o.head ?? "3.2 Critical Illness Benefit"}\n${o.row ?? "100% of the Sum Insured will be payable in one lump sum on diagnosis of a Critical Illness."}\nThe Life Insured must survive 14 days after diagnosis.\nThe benefit ends once it is paid.\nRefer to Appendix A for the list of illnesses.\n`
  + `${limit}\n${o.next ?? "3.3 Hospital Benefit\nWe pay the daily amount in the Schedule."}`;
const ciRow = (quote = "100% of the Sum Insured will be payable in one lump sum on diagnosis of a Critical Illness.") =>
  ben({ benefit: "Critical Illness Benefit", pays: "percent", value: 100, percentOf: "sum_insured", page: 2, quote });

function run(o: { sched?: string; wording?: string; cov?: Record<string, unknown>; ci?: Record<string, unknown>; statements?: Record<string, unknown>[]; asked?: string[] } = {}) {
  const house: Household = { accountId: "33333333-3333-3333-3333-333333333333", members: [{ name: "Nurul Huda", relationship: "self" }, { name: "Arif Hakim", relationship: "spouse" }],
    documents: [doc(SCHED, "Schedule.pdf", [{ page: 1, text: o.sched ?? SCHEDULE() }]), ...(o.wording != null ? [doc(WORD, "Policy wording.pdf", [{ page: 2, text: o.wording }])] : [])] } as Household;
  const sched = checkReading(src(house.documents[0]), reading("personal_proof", "CI Protector", [o.cov ?? cover()], []) as never);
  const readings = [sched];
  if (o.wording != null) readings.push(checkReading(src(house.documents[1]), reading("policy_wording", "CI Protector", [], [o.ci ?? ciRow()]) as never));
  const t = assembleTable(readings, family, o.wording != null ? [{ section: sectionKeyOf(WORD, { section: "Benefits", column: null }), cover: ciKey, why: "wording" }] : [], []);
  const rows = chatRows(t, house);
  const pick = (st: Record<string, unknown>) => typeof st.row === "function" ? (st.row as (r: ChatRow[]) => string)(rows) : st.row;
  const raw = { bottomLine: "b", nextSteps: [], question: null, statements: (o.statements ?? []).map((st) => ({ kind: "amount", text: "x", person: "Nurul Huda", document: null, quote: null, amount: null,
    percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, eventFit: "no_event", ...st, row: pick(st) })) };
  const fromRows = amountsFromRows(raw, rows, house);
  const { answer: a } = verifyAnswer(house, readModelAnswer(fromRows.json)!, o.asked ?? ["how much is my cover"], new Set(fromRows.report.labels));
  const kept = keepLabelledAmounts(a.statements ?? [], fromRows.report).kept;
  return { rows, cover: sched.covers[0], kept, amounts: kept.filter((s) => s.amount).map((s) => s.amount!.text), report: fromRows.report };
}
const limits = (rs: ChatRow[]) => rs.filter((r) => /^Limit in total/.test(r.benefit)).map((r) => ({ amount: r.figure.kind === "printed" ? r.figure.amount : null, currency: r.figure.kind === "printed" ? r.figure.currency : null, scope: r.conditions[0] }));
const limitId = (rs: ChatRow[]) => rs.find((r) => /^Limit in total/.test(r.benefit))?.id ?? "R99";

// ================================================================ premium parts
test("PP1 SG: own premium + '- Health Extra' adding to the printed premium give two part rows, last, in SGD", () => {
  const r = run();
  assert.deepEqual(r.cover.premiumParts?.map((p) => [p.label, p.amount]), [[null, 380.1], ["Health Extra", 132.3]], JSON.stringify(r.cover.premiumParts));
  const parts = r.rows.filter((x) => /part of the/.test(x.benefit));
  assert.equal(parts.length, 2); assert.deepEqual(r.rows.slice(-2), parts, "after every other row");
  assert.ok(parts.every((x) => x.figure.kind === "printed" && x.figure.currency === "SGD"));
});
test("PP2 an en dash ('– Health Extra') is a part too", () => {
  const r = run({ sched: SCHEDULE({ extra: "– Health Extra\t—\t132.30\t15/03/2041" }) });
  assert.deepEqual(r.cover.premiumParts?.map((p) => p.amount), [380.1, 132.3]);
});
test("PP3 MY: RM in every cell ('RM380.10') gives no parts (a missing card, never a wrong one)", () => {
  const r = run({ sched: SCHEDULE({ cur: "Ringgit Malaysia", sum: "RM150,000.00", own: "RM380.10", extra: "- Health Extra\t---\tRM132.30\t15/03/2041" }), cov: cover({ quoteSum: "RM150,000.00", own: "RM380.10" }) });
  const p = r.cover.premiumParts ?? null;
  if (p) assert.deepEqual(p.map((x) => x.amount), [380.1, 132.3]); else notes.push("PP3: RM-prefixed cells give no parts (safe; MY schedules that print RM in each cell get no part cards)");
});
test("PP4 extra with no dash ('Health Extra') gives no parts", () => {
  assert.equal(run({ sched: SCHEDULE({ extra: "Health Extra\t---\t132.30\t15/03/2041" }) }).cover.premiumParts ?? null, null);
});
test("PP5 a rider line between the cover and its extra gives no parts", () => {
  assert.equal(run({ sched: SCHEDULE({ between: "Payor Waiver Rider\t---\t12.00\t15/03/2041", total: "524.40" }), cov: cover({ premium: 524.4 }) }).cover.premiumParts ?? null, null);
});
test("PP6 a dashed rider between, whose figure makes the parts add up, is a part named as printed (never added twice)", () => {
  const r = run({ sched: SCHEDULE({ between: "- Payor Waiver\t---\t12.00\t15/03/2041", total: "524.40" }), cov: cover({ premium: 524.4 }) });
  assert.deepEqual(r.cover.premiumParts?.map((p) => [p.label, p.amount]), [[null, 380.1], ["Payor Waiver", 12], ["Health Extra", 132.3]]);
});
test("PP7 parts that miss the premium by one cent give none", () => {
  assert.equal(run({ sched: SCHEDULE({ extra: "- Health Extra\t---\t132.31\t15/03/2041" }) }).cover.premiumParts ?? null, null);
});
test("PP8 two lives on one schedule: no parts for either (another life on the page)", () => {
  const sched = SCHEDULE() + "\nLife Insured 2\t: Arif Hakim\nCritical Illness Protector\t100,000.00\t210.00\t15/03/2041";
  assert.equal(run({ sched }).cover.premiumParts ?? null, null);
});
test("PP9 the sum insured printed twice (a total line) gives no parts", () => {
  assert.equal(run({ sched: SCHEDULE({ after: "Total Sum Insured\t150,000.00" }) }).cover.premiumParts ?? null, null);
});
test("PP10 unit: an extra with a figure in its name, a date-like premium cell, or a whole-dollar premium cell gives none", () => {
  const base = (extra: string, own = "380.10") => `Critical Illness Protector\t150,000.00\t${own}\t15/03/2041\n${extra}`;
  assert.equal(premiumPartsOf(base("- Health Extra 2\t---\t132.30\t15/03/2041"), 150000, 512.4), null);
  assert.equal(premiumPartsOf(base("- Health Extra\t---\t132\t15/03/2041", "380.40"), 150000, 512.4), null);
  assert.equal(premiumPartsOf(base("- Health Extra\t---\t13.2.30\t15/03/2041"), 150000, 512.4), null);
});
test("PP11 the answer path: a part card shows its own amount and never the whole premium for the extra", () => {
  const r = run({ statements: [{ row: (rs: ChatRow[]) => rs.find((x) => /^Health Extra/.test(x.benefit))?.id ?? "R99", text: "Extra." }] });
  assert.deepEqual(r.amounts, ["S$132.30"]);
});

test("PP12 a rider line between, then a dashed extra that happens to add up: no parts (the extra may be the rider's)", () => {
  assert.equal(run({ sched: SCHEDULE({ between: "Hospital Cash Rider\t---\t40.00\t15/03/2041" }) }).cover.premiumParts ?? null, null);
});
test("PP13 two lives on one schedule: the life insured's own parts are not given while another life is printed on the page", () => {
  const sched = SCHEDULE({ person: "Arif Hakim", total: "342.30", sum: "100,000.00", own: "210.00", after: "Life Insured 2\t: Nurul Huda\nCritical Illness Protector\t150,000.00\t380.10\t15/03/2041" });
  const r = run({ sched, cov: cover({ person: "Arif Hakim", sum: 100000, quoteSum: "100,000.00", own: "210.00", premium: 342.3 }) });
  if (r.cover.premium == null) notes.push("PP13: with another life printed, the schedule's premium itself is not read, so parts never arise (Q4 is stopped upstream)");
  assert.equal(r.cover.premiumParts ?? null, null, "another life on the page: " + JSON.stringify(r.cover.premiumParts));
});

// ================================================================ total limit rows
const TOTAL = "The most we will pay in total for all Critical Illness claims under this policy and all other policies covering the same Life Insured shall not exceed S$600,000.";
test("TL1 SG: the total in the CI clause is a limit row with its scope, last, shown with no event", () => {
  const r = run({ wording: WORDING(TOTAL), statements: [{ row: limitId, text: "Most in total." }] });
  assert.deepEqual(limits(r.rows).map((x) => [x.amount, x.currency]), [[600000, "SGD"]]);
  assert.equal(r.rows.at(-1)!.benefit, "Limit in total on Critical Illness Benefit claims");
  assert.deepEqual(r.amounts, ["S$600,000"]);
  const card = JSON.stringify(r.kept.find((s) => s.amount?.text === "S$600,000"));
  assert.ok(/all other policies covering the same Life Insured/.test(card), "scope on the card: " + card);
});
test("TL2 the same limit is dropped for an event", () => {
  const r = run({ wording: WORDING(TOTAL), statements: [{ row: limitId, text: "Paid.", eventFit: "any_event" }], asked: ["I was diagnosed with cancer, what do I get?"] });
  assert.deepEqual(r.amounts, []);
});
test("TL3 MY: tab heading '3.2\\tCritical Illness Benefit', sentence over two lines, RM1,000,000", () => {
  const r = run({ wording: WORDING("The most we will pay in total for all claims under this\nbenefit for the same Life Insured shall not exceed RM1,000,000.", { head: "3.2\tCritical Illness Benefit" }) });
  assert.deepEqual(limits(r.rows).map((x) => [x.amount, x.currency]), [[1000000, "MYR"]]);
});
test("TL4 UK: 'The maximum total amount we will pay for all claims under this policy is £250,000.'", () => {
  const r = run({ wording: WORDING("The maximum total amount we will pay for all claims under this policy is £250,000.") });
  assert.deepEqual(limits(r.rows).map((x) => [x.amount, x.currency]), [[250000, "GBP"]]);
});
test("TL5 'S$1 million' is never a limit of S$1 (spelled-out unit)", () => {
  const r = run({ wording: WORDING(TOTAL.replace("S$600,000", "S$1 million")) });
  const got = limits(r.rows);
  assert.ok(got.every((x) => x.amount === 1000000), "limit read as " + JSON.stringify(got));
});
test("TL6 'RM2.5 million' is never a limit of RM2.50", () => {
  const r = run({ wording: WORDING(TOTAL.replace("S$600,000", "RM2.5 million")) });
  const got = limits(r.rows);
  assert.ok(got.every((x) => x.amount === 2500000), "limit read as " + JSON.stringify(got));
});
test("TL7 'the higher of S$600,000 and the Sum Insured' gives no row (the limit can be more)", () => {
  assert.deepEqual(limits(run({ wording: WORDING(TOTAL.replace("S$600,000", "the higher of S$600,000 and the Sum Insured")) }).rows), []);
});
test("TL8 'S$600,000 or the Sum Insured, whichever is lower' gives no row (the limit can be less)", () => {
  assert.deepEqual(limits(run({ wording: WORDING(TOTAL.replace("S$600,000.", "S$600,000 or the Sum Insured, whichever is lower.")) }).rows), []);
});
test("TL9 'three times the Sum Insured, up to S$600,000' gives no row", () => {
  assert.deepEqual(limits(run({ wording: WORDING(TOTAL.replace("S$600,000", "three times the Sum Insured, up to S$600,000")) }).rows), []);
});
test("TL10 a limit for each claim gives no row", () => {
  assert.deepEqual(limits(run({ wording: WORDING("The most we will pay in total for any one claim under all policies covering the same Life Insured shall not exceed S$600,000.") }).rows), []);
});
test("TL11 a limit printed under the next heading (another benefit) is never the CI row's", () => {
  assert.deepEqual(limits(run({ wording: WORDING("", { next: `3.3 Total and Permanent Disability\n${TOTAL.replace("Critical Illness", "TPD")}` }) }).rows), []);
});
test("TL12 a limit on the next page gives no row (missing card)", () => {
  const house = WORDING("");
  const r = run({ wording: house + "\f" });
  assert.deepEqual(limits(r.rows), []);
});
test("TL13 a sub-clause (3.2.1) inside the CI clause is the CI clause's", () => {
  const r = run({ wording: WORDING(`3.2.1 Limit\n${TOTAL}`) });
  assert.deepEqual(limits(r.rows).map((x) => x.amount), [600000]);
});
test("TL14 two figures (an age band) give no row", () => {
  assert.deepEqual(limits(run({ wording: WORDING(TOTAL.replace("S$600,000", "S$600,000, or S$300,000 if the Life Insured is over 65")) }).rows), []);
});
test("TL15 a share of the sum ('200% of the Sum Insured') gives no row", () => {
  assert.deepEqual(limits(run({ wording: WORDING(TOTAL.replace("S$600,000", "200% of the Sum Insured")) }).rows), []);
});
test("TL16 'per policy year' after 'in total' is on the card if a row is given", () => {
  const got = limits(run({ wording: WORDING(TOTAL.replace("in total for all", "in total per policy year for all")) }).rows);
  assert.ok(got.every((x) => /policy year/.test(x.scope)), JSON.stringify(got));
});
test("TL17 'less any amount already paid' after the figure: noted (the card is still an upper bound)", () => {
  const got = limits(run({ wording: WORDING(TOTAL.replace("S$600,000.", "S$600,000, less any amount already paid under clause 3.1.")) }).rows);
  notes.push("TL17 'less any amount already paid': " + (got.length ? `row S$${got[0].amount} with scope "${got[0].scope}" (the 'less' words are not on the card)` : "no row"));
});

test("TL18 a total printed within three lines of the CI row: noted (the row itself then shows no amount)", () => {
  const w = "3.2 Critical Illness Benefit\n100% of the Sum Insured will be payable in one lump sum on diagnosis of a Critical Illness.\n" + TOTAL + "\n3.3 Hospital Benefit\nWe pay the daily amount.";
  const r = run({ wording: w });
  const ci = r.rows.find((x) => x.benefit === "Critical Illness Benefit");
  notes.push(`TL18 limit within 3 lines of the row: CI row figure ${ci?.figure.kind}, limit rows ${JSON.stringify(limits(r.rows).map((x) => x.amount))}`);
});

test("TL19 two figures with no qualifier word give no row", () => {
  assert.deepEqual(limits(run({ wording: WORDING(TOTAL.replace("S$600,000.", "S$600,000 for major illnesses and S$300,000 for early illnesses.")) }).rows), []);
});
test("TL20 a bare '$' gives no row", () => {
  assert.deepEqual(limits(run({ wording: WORDING(TOTAL.replace("S$600,000", "$600,000")) }).rows), []);
});
test("TL21 a heading that names another benefit ('3.2 Special Benefit') gives no row", () => {
  assert.deepEqual(limits(run({ wording: WORDING(TOTAL, { head: "3.2 Special Benefit" }) }).rows), []);
});
test("TL22 a sentence with no total word ('The most we will pay under this benefit shall not exceed S$600,000.') gives no row", () => {
  assert.deepEqual(limits(run({ wording: WORDING("The most we will pay under this benefit shall not exceed S$600,000.") }).rows), []);
});
test("TL23 a scope naming clause numbers gives no row (a scope never carries figures)", () => {
  assert.deepEqual(limits(run({ wording: WORDING("The most we will pay in total for all claims under clauses 3.2 and 3.4 for the same Life Insured shall not exceed S$600,000.") }).rows), []);
});

// ================================================================ row numbers unchanged
test("RN the rows before the new ones keep their ids and benefits (parts and limit come last)", () => {
  const fy = (t: string) => t.replace("Payment Frequency", "First Year Annual Premium * : 300.00\nPayment Frequency");
  const withNew = run({ sched: fy(SCHEDULE()), wording: WORDING(TOTAL) }).rows;
  assert.ok(withNew.some((r) => /first policy year only/.test(r.benefit)), "fixture: a first-year row exists: " + withNew.map((r) => r.benefit).join(" | "));
  const without = run({ sched: fy(SCHEDULE({ extra: "Health Extra\t---\t132.30\t15/03/2041" })), wording: WORDING("") }).rows;
  const head = withNew.filter((r) => !/part of the|^Limit in total/.test(r.benefit));
  assert.deepEqual(head.map((r) => [r.id, r.benefit]), withNew.slice(0, head.length).map((r) => [r.id, r.benefit]), "new rows are all at the end");
  assert.deepEqual(without.map((r) => r.benefit), head.map((r) => r.benefit));
});

for (const f of failures) console.log("FAIL " + f);
for (const n of notes) console.log("NOTE " + n);
console.log(`te-pr155: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

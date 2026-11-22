/** Life stages (DC 19 Nov 2026, item 4): a person's policies across the stages of their life, only from printed dates and
 * values. Invented household and insurers. Pure; no database, no network.
 *   node --import tsx scripts/policies/life-stages-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ageOn, currencyOfValue, lifeStages, type LifeCover, type LifeValueRow } from "@/lib/policies/life-stages";
import type { PolicyDate } from "@/lib/policies/policy-dates";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const day = (iso: string) => Date.parse(iso + "T00:00:00Z") / 86_400_000;
const TODAY = day("2026-11-19");
const date = (key: string, name: string, documentIds: string[], extra: Partial<PolicyDate> = {}): PolicyDate => ({ key, name, insurer: "Harbourline Assurance", state: "until", documentIds,
  endsOn: null, endsText: null, source: null, daysLeft: null, startedOn: null, sooner: [], renewal: null, ...extra });
const cover = (documentId: string, coverKey: string, extra: Partial<LifeCover> = {}): LifeCover => ({ documentId, coverKey, name: coverKey, page: 2, ...extra });
const value = (coverKey: string, extra: Partial<LifeValueRow>): LifeValueRow => ({ coverKey, benefit: "Surrender value", amount: 1000, currency: "SGD", kind: "value", documentId: "ill", document: "Benefit illustration", page: 4, ...extra });

const DATES = [
  date("life", "Term Protector", ["d1"], { endsOn: "2060-03-01", endsText: "1 Mar 2060" }),
  date("save", "Saver 20", ["d2"], { endsOn: "2050-03-01", endsText: "1 Mar 2050" }),
  date("ci", "Crisis Cover", ["d3"], { state: "no_date" }),
  date("trip", "Single Trip", ["d4"], { state: "renewal_due", endsOn: "2026-10-04" }),
  date("gone", "Old Hospital", ["d5"], { state: "not_renewed", endsOn: "2026-01-01" }),
];
const COVERS = [cover("d1", "life", { premiumEndDate: "01/03/2045" }), cover("d2", "save", { premiumEndDate: "1-Mar-2036", maturityDate: "01 Mar 2050" }), cover("d3", "ci", { premiumTerm: "to age 65" })];

test("age from a date of birth, a day before and on the birthday", () => {
  assert.equal(ageOn(day("1985-03-01"), day("2026-02-28")), 40);
  assert.equal(ageOn(day("1985-03-01"), day("2026-03-01")), 41);
  assert.equal(ageOn(null, TODAY), null);
});

test("policies the household must answer, or said it did not renew, are left out and named", () => {
  const r = lifeStages({ dates: DATES, covers: COVERS, values: [], dateOfBirth: "1985-03-01", today: TODAY });
  assert.deepEqual(r.policies.map((p) => p.name), ["Term Protector", "Saver 20", "Crisis Cover"]);
  assert.deepEqual(r.renewalDue, ["Single Trip"]); assert.deepEqual(r.notRenewed, ["Old Hospital"]);
  assert.equal(r.age, 41);
});

test("premium end, maturity and cover end as printed; a premium term in words only when no date is printed", () => {
  const r = lifeStages({ dates: DATES, covers: COVERS, values: [], dateOfBirth: "1985-03-01", today: TODAY });
  const [life, save, ci] = r.policies;
  assert.equal(life.premiumsEnd?.onText, "1 Mar 2045"); assert.equal(life.premiumsEnd?.age, 60); assert.equal(life.endAge, 75);
  assert.equal(save.matures?.onText, "1 Mar 2050"); assert.equal(save.premiumsEnd?.age, 51);
  assert.equal(ci.endsOn, null); assert.equal(ci.premiumsEnd, null); assert.equal(ci.premiumTerm, "to age 65");
});

test("stages break at each printed event; a policy with no printed end is never shown as ending", () => {
  const r = lifeStages({ dates: DATES, covers: COVERS, values: [], dateOfBirth: "1985-03-01", today: TODAY });
  assert.deepEqual(r.stages.map((s) => s.from.age), [41, 51, 60, 65, 75]);
  assert.deepEqual(r.stages[0].inPlace, ["Term Protector", "Saver 20"]);
  assert.deepEqual(r.stages[0].paying, ["Term Protector", "Saver 20"]);
  assert.deepEqual(r.stages[1].paying, ["Term Protector"]);
  assert.deepEqual(r.stages[3].events.map((e) => [e.policy, e.kind]), [["Saver 20", "matures"], ["Saver 20", "cover_ends"]]);
  assert.deepEqual(r.stages[3].inPlace, ["Term Protector"]);
  assert.deepEqual(r.stages[4].inPlace, []);
  for (const s of r.stages) assert.deepEqual(s.endNotPrinted, ["Crisis Cover"]);
  assert.ok(!r.stages.some((s) => s.events.some((e) => e.policy === "Crisis Cover")));
});

test("no date of birth: dates only, no ages", () => {
  const r = lifeStages({ dates: DATES, covers: COVERS, values: [], dateOfBirth: null, today: TODAY });
  assert.equal(r.age, null); assert.ok(r.stages.every((s) => s.from.age === null)); assert.equal(r.stages[1].from.onText, "1 Mar 2036");
});

test("a renewal receipt's own period end is the policy's end; with none, it is said once as renewed with no end printed", () => {
  const dates = [date("a", "Hospital Plan", ["h1"], { state: "renewed", endsOn: "2026-06-30", renewal: { paidOn: "2026-06-20", paidText: "20 Jun 2026", until: "2027-06-30", untilText: "30 Jun 2027", documentId: "r1" } }),
    date("b", "Home Plan", ["h2"], { state: "renewed", endsOn: "2026-06-30", renewal: { paidOn: "2026-06-20", paidText: "20 Jun 2026", until: null, untilText: null, documentId: "r2" } })];
  const r = lifeStages({ dates, covers: [], values: [], dateOfBirth: null, today: TODAY });
  assert.equal(r.policies[0].endsText, "30 Jun 2027"); assert.equal(r.policies[1].endsOn, null);
  assert.deepEqual(r.stages[0].inPlace, ["Hospital Plan"]);
  assert.deepEqual(r.stages[0].renewedNoEnd, ["Home Plan"]);
  assert.deepEqual(r.stages[1].inPlace, []);
  assert.deepEqual(r.stages[1].renewedNoEnd, [], "never carried into a later stage (Critic MED-4)");
  assert.deepEqual(r.stages[1].endNotPrinted, []);
});

test("values are placed on the policy whose schedule holds the cover; only rows printed for an age or policy year", () => {
  const values = [value("save", { age: 55, policyYear: 14, amount: 38410 }), value("save", { age: 55, policyYear: 14, amount: 52900, kind: "projected", basis: "non_guaranteed", rate: "4.25%" }),
    value("save", { amount: 999 }), value("other", { age: 60, amount: 5 })];
  const r = lifeStages({ dates: DATES, covers: COVERS, values, dateOfBirth: null, today: TODAY });
  const save = r.policies.find((p) => p.name === "Saver 20")!;
  assert.deepEqual(save.values.map((v) => [v.amount, v.projected, v.rate]), [[38410, false, null], [52900, true, "4.25%"]]);
  assert.ok(r.policies.every((p) => p.name === "Saver 20" || !p.values.length));
});

test("the module adds up nothing: no sum, total or projection of its own", () => {
  const src = readFileSync("lib/policies/life-stages.ts", "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
  assert.ok(!/reduce\(|\btotal\b|\*\s*\(1\s*\+/.test(src));
});

test("a value under a bare $ column takes its own cover's dollar currency; nothing settled, or no $, stays without one", () => {
  const v = { benefit: "Surrender value", column: "Guaranteed ($)", currency: null as string | null, coverCurrency: "SGD" as string | null };
  assert.equal(currencyOfValue(v), "SGD");
  assert.equal(currencyOfValue({ ...v, coverCurrency: null }), null);
  assert.equal(currencyOfValue({ ...v, coverCurrency: "EUR" }), null);
  assert.equal(currencyOfValue({ ...v, column: "Guaranteed" }), null);
  assert.equal(currencyOfValue({ ...v, currency: "USD" }), "USD");
});
test("control: a sign with letters states its own currency; another dollar sign is never relabelled by the cover", () => {
  const v = (column: string, coverCurrency: string | null, benefit = "Value") => currencyOfValue({ benefit, column, currency: null, coverCurrency });
  assert.equal(v("Value (US$)", "SGD"), "USD");
  assert.equal(v("Value (S$)", "USD"), "SGD");
  assert.equal(v("Value (A$)", "SGD"), "AUD");
  assert.equal(v("Value (S$ and US$)", "SGD"), null);
  assert.equal(v("Value", "SGD", "Death benefit ($ per $1,000)"), null);
  assert.equal(v("Guaranteed ($)", "HKD"), "HKD");
});
test("dated states stay shown, and the end-not-printed list is the same at every stage", () => {
  const r = lifeStages({ dates: [DATES[0]!, date("e", "Ends soon", ["e1"], { state: "ends_soon", endsOn: "2026-12-01" }), date("n", "No end", ["n1"], { state: "no_date" })], covers: [cover("n1", "n", { premiumEndDate: "01/03/2040" }), ...COVERS], values: [], dateOfBirth: null, today: TODAY });
  assert.deepEqual(r.policies.map((p) => p.name).sort(), ["Ends soon", "No end", "Term Protector"]);
  assert.deepEqual(r.noDates, []);
  assert.ok(r.stages.every((s) => JSON.stringify(s.endNotPrinted) === JSON.stringify(["No end"])));
});
test("a policy that prints no date, term or value is named once and not drawn", () => {
  const r = lifeStages({ dates: [date("w", "Policy wording", ["w1"], { state: "no_date" }), ...DATES.slice(0, 1)], covers: COVERS, values: [], dateOfBirth: null, today: TODAY });
  assert.deepEqual(r.noDates, ["Policy wording"]);
  assert.deepEqual(r.policies.map((p) => p.name), ["Term Protector"]);
  assert.ok(r.stages.every((s) => !s.endNotPrinted.includes("Policy wording")));
});
test("control: a renewed policy with no new end, and one with a premium term, are still shown", () => {
  const r = lifeStages({ dates: [date("r", "Renewed one", ["r1"], { state: "renewed" }), date("t", "Termed", ["t1"], { state: "no_date" })], covers: [cover("t1", "t", { premiumTerm: "72" })], values: [], dateOfBirth: null, today: TODAY });
  assert.deepEqual(r.policies.map((p) => p.name).sort(), ["Renewed one", "Termed"]);
  assert.deepEqual(r.noDates, []);
});

test("a running total printed again at later years is passed through to the page", () => {
  const r = lifeStages({ dates: [DATES[1]!], covers: COVERS, values: [value("save", { policyYear: 10, repeatedAt: [15, 20] })], dateOfBirth: null, today: TODAY });
  assert.deepEqual(r.policies[0]!.values[0]!.repeatedAt, [15, 20]);
  assert.deepEqual(lifeStages({ dates: [DATES[1]!], covers: COVERS, values: [value("save", { policyYear: 10 })], dateOfBirth: null, today: TODAY }).policies[0]!.values[0]!.repeatedAt, []);
});

console.log(`life-stages: ${passed} passed${failures.length ? `, ${failures.length} failed\n${failures.join("\n")}` : ""}`);
if (failures.length) process.exit(1);

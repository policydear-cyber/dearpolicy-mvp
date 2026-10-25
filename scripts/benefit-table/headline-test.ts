/** Scripted tests for Coverage's summary of a cover (lib/benefit-table/headline.ts): which rows lead the card, how each
 * amount is worded, and the grouping of the full list. Synthetic rows only.
 *   npm run benefit-table:headline-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bySection, keyBenefits, MAX_KEY, MAX_KEY_AS_CHARGED, rowDetail, shortFigure, type SummaryRow } from "@/lib/benefit-table/headline";
import { kindsOfTable } from "@/components/cover-kinds";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const row = (benefit: string, o: Partial<SummaryRow> = {}): SummaryRow => ({ benefit, section: null, pays: "amount",
  figure: { kind: "printed", amount: 1000, currency: "SGD", unit: "lump_sum" }, qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o });
const amount = (benefit: string, n: number, o: Partial<SummaryRow> = {}) => row(benefit, { figure: { kind: "printed", amount: n, currency: "SGD", unit: "lump_sum" }, ...o });
const charged = (benefit: string) => row(benefit, { pays: "as_charged", figure: { kind: "none", why: "paid as charged, no limit printed on this row" } });
const names = (rows: SummaryRow[]) => keyBenefits(rows).map((i) => rows[i].benefit);

test("death, disability and critical illness lead, then ward and surgery, then the deductible, then the largest amounts", () => {
  const rows = [amount("Funeral expenses", 5000), amount("Skull", 5000), amount("Wrist", 1000), row("Deductible", { figure: { kind: "printed", amount: 3500, currency: "SGD", unit: "per_period", period: "year" } }),
    charged("Surgical fees"), amount("Accidental death", 250000), amount("Hip or thigh bone", 3000)];
  assert.deepEqual(names(rows), ["Accidental death", "Surgical fees", "Deductible", "Funeral expenses", "Skull", "Hip or thigh bone", "Wrist"]);
});
test("at most 8 key rows", () => {
  const rows = Array.from({ length: 20 }, (_, i) => amount(`Benefit ${i}`, 1000 + i));
  assert.equal(keyBenefits(rows).length, MAX_KEY);
  assert.equal(names(rows)[0], "Benefit 19");
});
test("a cover that is mostly 'as charged' shows at most 5", () => {
  const rows = [charged("Ward and treatment"), charged("Intensive care unit"), charged("Surgical fees"), charged("Day surgery"), charged("Room and board"),
    charged("In-patient specialist"), charged("Surgeon's fees, second"), amount("Stroke rehabilitation", 2000)];
  assert.equal(keyBenefits(rows).length, MAX_KEY_AS_CHARGED);
});
test("a projection, a 'not covered' row, a row with no amount and a repeated name never lead", () => {
  const rows = [row("Death", { figure: { kind: "projected", amount: 900000, currency: "SGD", basis: "non_guaranteed", asOf: null } }),
    row("Critical illness", { pays: "not_covered", figure: { kind: "none", why: "printed as not covered" } }),
    row("Terminal illness", { pays: "words", figure: { kind: "none", why: "no figure printed" } }),
    charged("Cancer drug treatment"), amount("Wrist", 1000), amount("wrist", 2000)];
  assert.deepEqual(names(rows), ["wrist"]);
});
test("no key rows from an empty cover", () => assert.deepEqual(keyBenefits([]), []));

test("amounts are worded as printed, never changed", () => {
  assert.equal(shortFigure(charged("Ward")).text, "As charged");
  assert.equal(shortFigure(row("x", { pays: "up_to", figure: { kind: "printed", amount: 5000, currency: "SGD", unit: "up_to" } })).text, "Up to S$5,000");
  assert.equal(shortFigure(row("x", { pays: "per_day", figure: { kind: "printed", amount: 150, currency: "SGD", unit: "per_day" } })).text, "S$150 a day");
  assert.equal(shortFigure(row("x", { figure: { kind: "printed", amount: 2.5, currency: "SGD", unit: "lump_sum" } })).text, "S$2.50");
  assert.equal(shortFigure(row("x", { pays: "not_covered", figure: { kind: "none", why: "printed as not covered" } })).text, "Not covered");
});
test("a worked-out amount shows how it was worked out, and a capped one says 'up to'", () => {
  const w = shortFigure(row("Loss of one eye", { pays: "percent", figure: { kind: "worked_out", amount: 125000, currency: "SGD", how: "50% of S$250,000" } }));
  assert.deepEqual(w, { text: "S$125,000", note: "50% of S$250,000" });
  const c = shortFigure(row("x", { pays: "percent", figure: { kind: "worked_out", amount: 5000, currency: "SGD", how: "20% of S$200,000 is more than the most it pays", capped: true } }));
  assert.equal(c.text, "Up to S$5,000");
});
test("a projection says it is not an amount held or payable; a row with no amount says why", () => {
  const p = shortFigure(row("x", { figure: { kind: "projected", amount: 90000, currency: "SGD", basis: "non_guaranteed", asOf: "2040" } }));
  assert.equal(p.text, "S$90,000 projected"); assert.match(p.note!, /not guaranteed: not an amount held or payable/);
  assert.deepEqual(shortFigure(row("x", { pays: "words", figure: { kind: "none", why: "no figure printed" } })), { text: "See the page", note: "no figure printed" });
});
test("an amount with no currency says so", () => {
  assert.equal(shortFigure(row("x", { figure: { kind: "printed", amount: 500, currency: null, unit: "up_to" } })).text, "Up to $500 (currency not stated)");
});
test("who the figure is for is always shown with it (Critic R89-1), with its days and every condition", () => {
  const r = row("Juvenile illness", { qualifier: "child", fromDay: 2, maxDays: 90, conditions: ["Only 1 claim", "waiting period in Section 3.2", "max 6 claims"] });
  assert.equal(rowDetail(r), "for child · from day 2 · up to 90 days · Only 1 claim · waiting period in Section 3.2 · max 6 claims");
});
test("every condition is shown, so none is hidden when all of a cover's rows are key rows (TE #99)", () => {
  assert.equal(rowDetail(row("Death", { conditions: ["Only 1 claim", "The death benefit is paid only once."] })), "Only 1 claim · The death benefit is paid only once.");
  assert.equal(rowDetail(row("x")), "");
});
test("a worked-out amount's note is short when the row carries its percentage and base", () => {
  const f = { kind: "worked_out" as const, amount: 1000000, currency: "SGD", how: "100% of S$1,000,000 (GROUP TERM LIFE, Certificate.pdf p1, as of 06/10/2022)" };
  assert.equal(shortFigure(row("Death", { pays: "percent", percent: 100, base: 1000000, figure: f })).note, "100% of S$1,000,000");
  assert.equal(shortFigure(row("x", { pays: "percent", percent: 20, base: 200000, figure: { ...f, amount: 5000, capped: true } })).note, "20% of S$200,000, capped at the most it pays");
});
test("the full list is grouped by section in first-seen order, with rows that have none last", () => {
  const g = bySection([{ section: "Fractures", n: 1 }, { section: null, n: 2 }, { section: "Death", n: 3 }, { section: "Fractures", n: 4 }]);
  assert.deepEqual(g.map((x) => [x.section, x.rows.map((r) => r.n)]), [["Fractures", [1, 4]], ["Death", [3]], ["Other", [2]]]);
  assert.deepEqual(bySection([{ section: null }]).map((x) => x.section), ["Benefits"]);
});

// Family's "Covered for" line from the benefit table (components/cover-kinds.ts; 24 Oct journeys: "Travel · Home and
// vehicle" for a travel policy whose home cover is printed as not applicable).
test("a person's kinds of cover come from their benefit-table rows", () => {
  const r = (benefit: string, product: string, pays = "up_to", cover = product) => ({ benefit, pays, product, cover });
  const travel = "FWD Travel Insurance";
  assert.deepEqual(kindsOfTable([r("Rental Vehicle Excess", travel), r("Home Guard", travel, "not_covered"), r("Overseas Medical Expenses", travel),
    r("Personal Accident", travel, "amount")]), ["Travel"]);
  assert.deepEqual(kindsOfTable([r("Hospital Cash", "Group Hospital & Surgical", "per_day"), r("Wrist fracture", "Group Personal Accident", "amount"),
    r("Accident medical expenses", "Group Personal Accident", "not_covered"), r("Death", "Group Term Life", "amount")]), ["Death", "Hospital and medical", "Accidents and injuries"]);
  // Nothing but a premium, a value or a cell printed as not covered: no kind of cover.
  assert.deepEqual(kindsOfTable([r("Annual Premium", "Critical Illness II", "amount"), r("Surrender value", "Endowment Plan", "value"), r("Home contents", "HomeShield", "not_covered")]), []);
  // A row named only by its sum is the kind its cover names; real motor and home cover still shows.
  assert.deepEqual(kindsOfTable([r("Sum Insured", "Critical Illness II", "amount"), r("Own damage", "Motor Insurance", "up_to", "Motor Comprehensive")]), ["Critical illness", "Home and vehicle"]);
});

// Critic R199 and TE #124: the benefit's own name never makes "Home and vehicle"; the cover's name decides first.
test("the cover's own name decides the kind, and a home-care benefit is not home insurance", () => {
  const r = (benefit: string, product: string, pays = "up_to", cover = product) => ({ benefit, pays, product, cover });
  assert.deepEqual(kindsOfTable([r("Home Modification", "Group Personal Accident"), r("Mobility Aids", "Group Personal Accident")]), ["Accidents and injuries"]);
  assert.deepEqual(kindsOfTable([r("Room and board", "PRUShield"), r("Home Nursing", "PRUShield"), r("Home Healthcare", "PRUShield")]), ["Hospital and medical"]);
  assert.deepEqual(kindsOfTable([r("Rental Vehicle Excess", "Chubb Holiday Plan", "up_to", "Classic")]), ["Travel"]);
  assert.deepEqual(kindsOfTable([r("Rental Vehicle Excess", "Singlife Journey Plan")]), ["Travel"]);
  // A premium waiver is cover; a premium alone is not.
  assert.deepEqual(kindsOfTable([r("Premium waiver on TPD", "PRUlife Vantage", "words"), r("Annual premium", "PRUlife Vantage", "amount")]), ["Disability"]);
  assert.deepEqual(kindsOfTable([r("Waiver of Premium", "PRUlife Vantage", "words")]), ["Other"]);
  // An annuity is not death cover.
  assert.deepEqual(kindsOfTable([r("Monthly payout", "CPF LIFE Standard Plan", "per_period")]), ["Other"]);
  // A term life's TPD row adds disability; a cover with no row counted still shows.
  assert.deepEqual(kindsOfTable([r("Death", "Group Term Life", "amount"), r("Total and permanent disability", "Group Term Life", "amount")],
    [{ product: "Group Term Life", cover: "Group Term Life" }, { product: "Critical Illness II", cover: "Critical Illness II" }]), ["Death", "Disability", "Critical illness"]);
  assert.deepEqual(kindsOfTable([], [{ product: "HomeShield Contents", cover: "HomeShield Contents" }]), ["Home and vehicle"]);
  // A cover whose rows are all printed as not covered is no cover (TE P124-2); a mortgage plan is death cover (Critic R201-1);
  // a vehicle accident plan is accident cover (TE F12).
  assert.deepEqual(kindsOfTable([r("Home contents", "HomeShield", "not_covered")], [{ product: "HomeShield", cover: "HomeShield" }]), []);
  assert.deepEqual(kindsOfTable([r("Death", "HDB HomeProtect", "amount"), r("Total and permanent disability", "HDB HomeProtect", "amount")]), ["Death", "Disability"]);
  assert.deepEqual(kindsOfTable([], [{ product: "Mortgage Reducing Term", cover: "Mortgage Reducing Term" }]), ["Death"]);
  assert.deepEqual(kindsOfTable([r("Death", "HDB Home Protection Scheme", "amount")]), ["Death"]);
  assert.deepEqual(kindsOfTable([r("Death", "HPS", "amount")]), ["Death"]);
  // A home insurance plan that only calls itself "protection" is still home cover (Critic R205 note).
  assert.deepEqual(kindsOfTable([r("Contents", "Home Protection Plan")]), ["Home and vehicle"]);
  assert.deepEqual(kindsOfTable([r("Accidental death", "Public Vehicle Accident Plan", "amount")]), ["Accidents and injuries"]);
  // A plan with only a value and its premium is still a plan (Critic R204-1).
  assert.deepEqual(kindsOfTable([r("Fund value", "PRUlink Assurance", "value"), r("Annual premium", "PRUlink Assurance")], [{ product: "PRUlink Assurance", cover: "PRUlink Assurance" }]), ["Other"]);
  assert.deepEqual(kindsOfTable([r("Annual premium", "Critical Illness II", "amount")], [{ product: "Critical Illness II", cover: "Critical Illness II" }]), ["Critical illness"]);
});

// headline.ts runs in the browser: a value import from assemble.ts pulls the database driver into the page and the build
// fails (main 999048d, #120). Only types may come from there.
test("headline.ts takes only types from assemble.ts", () => {
  const src = readFileSync(new URL("../../lib/benefit-table/headline.ts", import.meta.url), "utf8");
  for (const m of src.matchAll(/^import\s+(.*?)\s+from\s+["']([^"']+)["']/gm)) if (!/^type\s/.test(m[1])) assert.doesNotMatch(m[2], /assemble|db|policies|linking/, m[0]);
});

console.log(`benefit-table headline: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }

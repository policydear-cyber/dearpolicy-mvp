/** What a hospital stay pays under a daily row with a waiting period and a yearly cap (acceptance R4, H2-C). A one-life
 * schedule printed "Hospital income rider S$100 per day in hospital, up to 365 days per policy year" with "The hospital
 * income rider does not pay for the first 2 days of any hospital stay." under it; asked about a 6-day stay, the chat showed
 * S$100 a day and never worked out S$100 x 4 = S$400. Two causes: "per policy year" stopped the stay, and "does not pay for
 * the first 2 days" was not one of the waiting forms read.
 *
 * What this pins down (S$ only; the rules read no currency of their own):
 * - "per policy year" on a day cap is a cap period: paid days = min(stay - waiting days, most days);
 * - a yearly amount cap in the row's own currency caps the worked figure; one that cannot be read gives no figure;
 * - a waiting period read in a closed set of forms ("after/from day N", "from the Nth day", "does not pay for the first N
 *   days", "excluding the first N days", "first N days not payable"); any other wording gives no figure;
 * - a per-family yearly limit and another person's row never get a worked figure; a bare "$" is never relabelled S$ (as
 *   on main, a figure worked from it keeps the bare "$" and is marked as currency not stated).
 * Made-up households and documents. No model, database or network.
 *   npm run benefit-table:stay-days-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const results: { name: string; ok: boolean; detail: string }[] = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true, detail: "" }); } catch (e) { results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
}

type Doc = Household["documents"][number];
const ACCT = "88888888-1111-4222-8333-444444444444";
let n = 0;
const nid = () => `5ade0000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const TAN = "Tan Wei Ming", LEE = "Lee Mei Ling";
const PRODUCT = "Kestrel Term Guard";
const INSURER = "Kestrel Life Singapore Ltd";

/** One person's schedule: the daily row (and any lines under it) in its benefit table on page 1. */
function scheduleDoc(person: string, row: string, below: string[] = [], currencyLine = "Policy currency: Singapore dollars (SGD)") {
  const id = nid();
  const text = `${INSURER}\n${PRODUCT.toUpperCase()} - POLICY SCHEDULE\nPolicy number: KTG-${n}\tLife assured: ${person}\t${currencyLine}\n`
    + `Benefit\tSum assured / amount\nDeath\t${currencyLine ? "S$" : "$"}300,000\n${row}\n${below.join("\n")}`;
  const doc: Doc = { policyId: id, name: `${person} schedule.pdf`, insurer: INSURER, productName: PRODUCT, policyNumber: `KTG-${n}`, documentType: null, documentRole: "personal_schedule",
    effectiveDate: null, expiryDate: null, uploadedAt: "2026-11-01", uploadedFor: null, linkedPeople: [person], supersededAt: null, processingStatus: "ready", pages: [{ page: 1, text }] };
  return { id, doc, row, below };
}
const bn = (o: Record<string, unknown>) => ({ section: "Benefits", column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null,
  baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });

type Built = { house: Household; rows: ReturnType<typeof chatRows> };
/** A household of one or two people, each with their own schedule. `who[i]` reads `rows[i]` with `rates[i]`. */
function household(specs: { person: string; row: string; below?: string[]; value: number; maxDays: number | null; fromDay?: number | null; currencyLine?: string; conditions?: string[] }[]): Built {
  const built = specs.map((s) => ({ s, d: scheduleDoc(s.person, s.row, s.below ?? [], s.currencyLine ?? "Policy currency: Singapore dollars (SGD)") }));
  const house: Household = { accountId: ACCT, members: specs.map((s, i) => ({ name: s.person, relationship: i === 0 ? "self" : "spouse" })), documents: built.map((b) => b.d.doc) };
  const fam: FamilyMember[] = specs.map((s, i) => ({ id: `f${i}`, display_name: s.person, relationship: i === 0 ? "self" : "spouse", date_of_birth: null }));
  const readings = built.map(({ s, d }) => {
    const src: SourceDoc = { id: d.id, name: d.doc.name, readable: true, pages: d.doc.pages };
    const label = s.row.split(/\t| S\$| \$/)[0];
    return checkReading(src, {
      document: { kind: "personal_proof", product: PRODUCT, insurer: INSURER, namedPeople: [s.person], plan: null, periodFrom: null, periodTo: null },
      covers: [{ person: s.person, product: PRODUCT, cover: PRODUCT, plan: null, riderOf: null, policyNumber: d.doc.policyNumber, premium: null, premiumFrequency: null, asOf: null,
        startDate: null, endDate: null, page: 1, sumInsured: 300000, quote: `Life assured: ${s.person}` }],
      benefits: [bn({ benefit: label, pays: "per_day", value: s.value, maxDays: s.maxDays, fromDay: s.fromDay ?? null, quote: s.row, conditions: s.conditions ?? [] })],
    });
  });
  const key = coverKeyOf({ product: PRODUCT, cover: PRODUCT, plan: null, riderOf: null });
  const links = readings.flatMap((r, i) => [...new Set(r.benefits.map((b) => sectionKeyOf(built[i].d.id, b)))].map((section) => ({ section, cover: key, why: "the schedule's benefits" })));
  const table = assembleTable(readings, fam, links);
  return { house, rows: chatRows(table, house) };
}

type Kept = { id?: string; text: string; kind?: string; amount?: { text: string } | null; basis?: string | null; personName?: string | null };
/** The model names `rowPerson`'s daily row and says it is for `saidPerson`. */
function ask(h: Built, rowPerson: string, asked: string[], extra: Record<string, unknown> = {}, saidPerson = rowPerson) {
  const row = h.rows.find((r) => r.person === rowPerson && r.pays === "per_day" && r.figure.kind !== "none");
  if (!row) return { row: null, amounts: [] as string[], all: [] as string[], kept: [] as Kept[] };
  const raw = { bottomLine: "Here is what applies.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person: saidPerson, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" }, ...extra }] };
  const fr = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-15T04:00:00Z"), asked[0], asked.slice(1));
  const parsed = readModelAnswer(fr.json)!;
  const { answer } = verifyAnswer(h.house, parsed, asked, new Set(fr.report.labels), fr.report.figures ?? []);
  const { kept } = keepLabelledAmounts((answer.statements ?? []) as Kept[], fr.report);
  return { row, kept, amounts: kept.filter((s) => s.amount && s.personName === saidPerson).map((s) => s.amount!.text), all: kept.filter((s) => s.amount).map((s) => s.amount!.text) };
}
const stayCard = (a: ReturnType<typeof ask>) => a.kept.find((s) => s.id?.endsWith("-stay"));
const one = (row: string, below: string[] = [], o: { value?: number; maxDays?: number | null; fromDay?: number | null } = {}) =>
  household([{ person: TAN, row, below, value: o.value ?? 100, maxDays: o.maxDays === undefined ? 365 : o.maxDays, fromDay: o.fromDay ?? null }]);

// ============ The H2-C shape ============
const H2C_ROW = "Hospital income rider\tS$100 per day in hospital, up to 365 days per\npolicy year";
const H2C_WAIT = "The hospital income rider does not pay for the first 2 days of any hospital stay.";
for (const [label, row] of [["tabbed", H2C_ROW], ["spaced", H2C_ROW.replace("\t", " ")]] as const) {
  test(`H2-C (${label}): 6 days in hospital under "S$100 per day ... up to 365 days per policy year" with the first 2 days not paid is S$100 x 4 = S$400`, () => {
    const h = household([{ person: TAN, row, below: ["Annual premium: S$1,148.00", H2C_WAIT], value: 100, maxDays: 365, conditions: [H2C_WAIT] }]);
    const a = ask(h, TAN, ["Tan was in hospital for 6 days. What can he get from his policies?"]);
    assert.deepEqual(a.amounts, ["S$100", "S$400"], JSON.stringify(a.kept));
    const st = stayCard(a)!;
    assert.match(st.text, /6-day stay, this works out to 4 days/);
    // The chat states its working: the first paid day, the most days and the yearly period, then 4 x S$100.
    assert.match(st.basis ?? "", /paid from day 3, for at most 365 days per policy year \(4 × S\$100\)/);
  });
}

// ============ "Up to N days per policy year" and a stay longer than the cap ============
const YEAR_ROW = "Hospital cash\tS$80 per day, payable from the 3rd day, up to 30 days per policy year";
test("up to 30 days per policy year: a 6-day stay is 4 paid days, S$320", () => {
  const a = ask(one(YEAR_ROW, [], { value: 80, maxDays: 30, fromDay: 3 }), TAN, ["I was in hospital 6 days"]);
  assert.deepEqual(a.amounts, ["S$80", "S$320"], JSON.stringify(a.kept));
});
test("a stay longer than the yearly cap is paid for the cap's days only: min(40 - 2, 30) = 30 days, S$2,400", () => {
  const a = ask(one(YEAR_ROW, [], { value: 80, maxDays: 30, fromDay: 3 }), TAN, ["I was in hospital 40 days"]);
  assert.deepEqual(a.amounts, ["S$80", "S$2,400"], JSON.stringify(a.kept));
  assert.match(stayCard(a)!.basis ?? "", /30 × S\$80/);
});
test("per year, per annum and in any one policy year are the same cap period", () => {
  for (const period of ["per year", "per annum", "in any one policy year", "each policy year"]) {
    const a = ask(one(`Hospital cash\tS$80 per day, payable from the 3rd day, up to 30 days ${period}`, [], { value: 80, maxDays: 30, fromDay: 3 }), TAN, ["I was in hospital 6 days"]);
    assert.deepEqual(a.amounts, ["S$80", "S$320"], `${period}: ${JSON.stringify(a.kept)}`);
  }
});
test("a stay that ends inside the waiting days pays nothing", () => {
  const a = ask(one(H2C_ROW, [H2C_WAIT]), TAN, ["Tan was in hospital for 2 days"]);
  assert.deepEqual(a.amounts, [], JSON.stringify(a.kept));
  assert.ok(a.kept.some((s) => /2-day stay ends before this daily benefit starts/.test(s.text)), JSON.stringify(a.kept));
});

// ============ A yearly amount cap ============
test("a yearly amount cap in the row's own currency caps the worked figure: 18 days x S$100 = S$1,800, so S$1,000", () => {
  const row = "Hospital cash\tS$100 per day, payable from the 3rd day, up to 30 days per policy year, maximum S$1,000 per policy year";
  const long = ask(one(row, [], { maxDays: 30, fromDay: 3 }), TAN, ["I was in hospital 20 days"]);
  assert.deepEqual(long.amounts, ["S$100", "S$1,000"], JSON.stringify(long.kept));
  assert.match(stayCard(long)!.basis ?? "", /18 × S\$100 = S\$1,800, capped at the S\$1,000 a policy year/);
  const short = ask(one(row, [], { maxDays: 30, fromDay: 3 }), TAN, ["I was in hospital 6 days"]);
  assert.deepEqual(short.amounts, ["S$100", "S$400"], JSON.stringify(short.kept));
});

// ============ Each waiting form ============
const FORMS: [string, string, string[]][] = [
  ["after day N", "Hospital cash\tS$50 per day, paid after day 2, up to 30 days per policy year", []],
  ["from day N", "Hospital cash\tS$50 per day, paid from day 3, up to 30 days per policy year", []],
  ["after the Nth day", "Hospital cash\tS$50 per day after the 2nd day, up to 30 days per policy year", []],
  ["payable from the (N+1)th day", "Hospital cash\tS$50 per day, payable from the 3rd day, up to 30 days per policy year", []],
  ["payable from the third day (in words)", "Hospital cash\tS$50 per day, payable from the third day, up to 30 days per policy year", []],
  ["does not pay for the first N days (in the row)", "Hospital cash\tS$50 per day, up to 30 days per policy year; does not pay for the first 2 days of any stay", []],
  ["does not pay for the first N days (below the row)", "Hospital cash\tS$50 per day, up to 30 days per policy year", ["Hospital cash does not pay for the first 2 days of any hospital stay."]],
  ["excluding the first N days of each stay", "Hospital cash\tS$50 per day, excluding the first 2 days of each stay, up to 30 days per policy year", []],
  ["first N days of any admission not payable", "Hospital cash\tS$50 per day, up to 30 days per policy year (first 2 days of any admission not payable)", []],
  ["the first two (2) days of each stay are not payable", "Hospital cash\tS$50 per day, up to 30 days per policy year", ["The first two (2) days of each stay are not payable."]],
];
for (const [form, row, below] of FORMS) test(`waiting form "${form}": 6 days is 4 paid days, S$200`, () => {
  const a = ask(one(row, below, { value: 50, maxDays: 30 }), TAN, ["I was in hospital 6 days"]);
  assert.deepEqual(a.amounts, ["S$50", "S$200"], JSON.stringify(a.kept));
  assert.match(stayCard(a)!.basis ?? "", /paid from day 3, for at most 30 days per policy year \(4 × S\$50\)/);
});

// ============ Negatives ============
test("an unclear waiting wording gives no worked figure (unsure amount = show none)", () => {
  for (const below of ["The first few days of any stay are not payable.", "A waiting period applies to this benefit.", "Hospital cash does not pay for the first 2 or 3 days of a stay.",
    "Hospital cash does not pay for the first 2 days of a stay, or the first 5 days of a stay overseas.", "An excess of 2 days applies.",
    "The surgical benefit does not pay for the first 2 days of any stay."]) {
    const a = ask(one("Hospital cash\tS$50 per day, up to 30 days per policy year", [below], { value: 50, maxDays: 30 }), TAN, ["I was in hospital 6 days"]);
    assert.ok(!a.all.some((x) => x !== "S$50"), `${below}: ${JSON.stringify(a.all)}`);
    assert.ok(!stayCard(a), below);
  }
  // Two different waiting forms on one row: unclear.
  const two = ask(one("Hospital cash\tS$50 per day, payable from the 3rd day, up to 30 days per policy year", ["Hospital cash does not pay for the first 4 days of any stay."], { value: 50, maxDays: 30 }), TAN, ["I was in hospital 6 days"]);
  assert.ok(!stayCard(two), JSON.stringify(two.all));
});
test("a yearly amount cap that cannot be read gives no worked figure", () => {
  for (const tail of [", subject to an annual limit shown in your certificate", ", subject to the overall annual limit", ", maximum RM 1,000 per policy year", ", maximum $1,000 per policy year",
    ", maximum S$1,000 or 10 days' benefit per policy year, whichever is less", ", maximum S$1,000 per policy year and S$3,000 per lifetime"]) {
    const a = ask(one(`Hospital cash\tS$100 per day, payable from the 3rd day, up to 30 days per policy year${tail}`, [], { maxDays: 30, fromDay: 3 }), TAN, ["I was in hospital 6 days"]);
    assert.ok(!stayCard(a), `${tail}: ${JSON.stringify(a.all)}`);
    assert.ok(!a.all.includes("S$400"), tail);
  }
});
test("a per-family yearly limit gives no worked figure", () => {
  for (const row of ["Hospital cash\tS$100 per day, payable from the 3rd day, up to 30 days per family per policy year",
    "Hospital cash\tS$100 per day, payable from the 3rd day, up to 30 days per policy year, maximum S$3,000 per family per policy year"]) {
    const a = ask(one(row, [], { maxDays: 30, fromDay: 3 }), TAN, ["I was in hospital 6 days"]);
    assert.ok(!stayCard(a), `${row}: ${JSON.stringify(a.all)}`);
  }
  const shared = ask(one(YEAR_ROW, ["The yearly limit of 30 days is shared by all insured persons on this policy."], { value: 80, maxDays: 30, fromDay: 3 }), TAN, ["I was in hospital 6 days"]);
  assert.ok(!stayCard(shared), JSON.stringify(shared.all));
});
test("another person's row: Tan's daily row said for Lee never gives Lee a worked figure", () => {
  const h = household([
    { person: TAN, row: H2C_ROW, below: [H2C_WAIT], value: 100, maxDays: 365, conditions: [H2C_WAIT] },
    { person: LEE, row: "Hospital allowance\tS$60 per day, payable from the 3rd day, up to 30 days per policy year", value: 60, maxDays: 30, fromDay: 3 }]);
  const a = ask(h, TAN, ["Lee was in hospital for 6 days. What can she get?"], {}, LEE);
  assert.ok(!a.kept.some((s) => s.personName === LEE && s.amount && /100|400/.test(s.amount.text)), JSON.stringify(a.kept));
  assert.ok(!a.all.includes("S$400"), JSON.stringify(a.all));
  // Lee's own row is worked out from her own words.
  const own = ask(h, LEE, ["Lee was in hospital for 6 days. What can she get?"]);
  assert.deepEqual(own.amounts, ["S$60", "S$240"], JSON.stringify(own.kept));
});
test("a bare $ daily row is never relabelled: no S$ figure, and any worked figure keeps the bare $ marked as currency not stated", () => {
  const h = household([{ person: TAN, row: "Hospital income rider\t$100 per day in hospital, up to 365 days per\npolicy year", below: [H2C_WAIT], value: 100, maxDays: 365, currencyLine: "", conditions: [H2C_WAIT] }]);
  const a = ask(h, TAN, ["Tan was in hospital for 6 days"]);
  assert.ok(!a.all.some((x) => /S\$|US\$|SGD|USD/.test(x)), JSON.stringify(a.all));
  for (const s of a.kept.filter((x) => x.amount)) {
    assert.match(s.amount!.text, /^\$\d/, JSON.stringify(s));
    assert.equal((s.amount as { currencyResolved?: boolean }).currencyResolved, false, JSON.stringify(s));
  }
  // The same row in an S$ policy is S$400; never the bare row's figure relabelled.
  const sgd = ask(household([{ person: TAN, row: H2C_ROW, below: [H2C_WAIT], value: 100, maxDays: 365, conditions: [H2C_WAIT] }]), TAN, ["Tan was in hospital for 6 days"]);
  assert.deepEqual(sgd.amounts, ["S$100", "S$400"]);
});

// ============ Stay-days gate round 1 (SD-H1, SD-H2, SD-L1): every repro, as the gate asked it ============
// null: no worked stay card. A string: the worked stay card's amount. An array: any one of these is right (not pinned).
const R = "Hospital income rider\tS$100 per day in hospital, up to 365 days per policy year";
const B = "The hospital income rider does not pay for the first 2 days of any hospital stay.";
const CAPPED = "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year, maximum S$1,000 per policy year";
const R0 = "Hospital income rider\tS$100 per day in hospital, up to a maximum of 365 days";
const CAPT = ", up to 365 days per policy year, maximum S$1,000 per policy year";
const GATE: [string, string, string[], number, string | null | (string | null)[]][] = [
  ["W1 control H2-C, 6 days", R, [B], 6, "S$400"],
  // SD-H1: a "first N days" or "from the Nth day" wording with no per-stay words may be the waiting period from the start
  // of cover: never read as a stay's.
  ["W2 'No benefit is payable for the first 30 days.' 40 days", R, ["No benefit is payable for the first 30 days."], 40, null],
  ["W2b 'No benefit is payable for the first 30 days.' 6 days", R, ["No benefit is payable for the first 30 days."], 6, null],
  ["W25 '...first 30 days of cover.'", R, ["No benefit is payable for the first 30 days of cover."], 40, null],
  ["W26 'This rider does not pay for the first 30 days.'", R, ["This rider does not pay for the first 30 days."], 40, null],
  ["W27 'No benefit is payable under this rider for the first 30 days.'", R, ["No benefit is payable under this rider for the first 30 days."], 40, null],
  ["W30 'The rider pays from the 31st day.'", R, ["The rider pays from the 31st day."], 40, null],
  ["W31 'Benefit is payable after the 30th day.'", R, ["Benefit is payable after the 30th day."], 40, null],
  ["W32 row 'not payable for the first 30 days' (no per-stay words)", "Hospital income rider\tS$100 per day in hospital, not payable for the first 30 days, up to 365 days per policy year", [], 40, null],
  ["W33 'first 30 days' + 'of cover.' on the next line", R, ["The rider does not pay for the first 30 days", "of cover."], 40, null],
  ["row 'excluding the first 2 days' (no per-stay words)", "Hospital income rider\tS$100 per day in hospital, excluding the first 2 days, up to 365 days per policy year", [], 6, null],
  ["row '(first 2 days not payable)' (no per-stay words)", "Hospital income rider\tS$100 per day in hospital, up to 365 days per policy year (first 2 days not payable)", [], 6, null],
  ["M1 main-shape row + 'The rider pays from the 31st day.'", R0, ["The rider pays from the 31st day."], 40, null],
  ["M3 main-shape row + 'No benefit is payable for the first 30 days.'", R0, ["No benefit is payable for the first 30 days."], 40, null],
  ["M4 main-shape row + 'Benefit starts from the 31st day.'", R0, ["Benefit starts from the 31st day."], 40, null],
  ["M2 main-shape row 'from the 31st day' in the row (as on main)", "Hospital income rider\tS$100 per day in hospital from the 31st day, up to a maximum of 365 days", [], 40, "S$1,000"],
  // Other waiting words the gate tried: none is read.
  ["W3 generic sentence after another (no-money) row", R, ["ICU benefit\tDouble the daily amount", "This benefit does not pay for the first 2 days."], 6, null],
  ["W3b generic sentence after a note row", R, ["Recovery benefit\tPaid once on discharge", "The benefit does not pay for the first 2 days."], 6, null],
  ["W5 'except for accidents'", R, ["The rider does not pay for the first 2 days of any hospital stay, except for accidents."], 6, null],
  ["W5b row 'from the 3rd day except after an accident'", "Hospital income rider\tS$100 per day in hospital from the 3rd day except after an accident, up to 365 days per policy year", [], 6, null],
  ["W6 row 'first 2 days not payable unless warded in ICU'", "Hospital income rider\tS$100 per day in hospital, first 2 days not payable unless warded in ICU, up to 365 days per policy year", [], 6, null],
  ["W20 sentence names another person", R, ["Lee Mei Ling: the rider does not pay for the first 2 days."], 6, null],
  ["W21 two waiting periods disagree", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year", ["The rider does not pay for the first 5 days of any hospital stay."], 10, null],
  ["W22 generic sentence below another daily row", R, ["ICU rider\tS$200 per day in ICU", "The benefit does not pay for the first 2 days."], 6, null],
  ["W23 'first 2 days in a policy year'", R, ["The rider does not pay for the first 2 days in a policy year."], 6, null],
  ["W24 'first 2 days of the first hospital stay'", R, ["The rider does not pay for the first 2 days of the first hospital stay."], 6, null],
  ["W28 '... of any hospital stay for each new illness'", R, ["The rider does not pay for the first 2 days of any hospital stay for each new illness."], 6, null],
  // Day caps shared or of another period.
  ["W7 day cap 'for all insured persons'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per policy year for all insured persons", [], 40, null],
  ["W8 day cap 'per policy year per policy'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per policy year per policy", [], 40, null],
  ["W9 day cap 'for all lives insured under this policy'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per policy year, for all lives insured under this policy", [], 40, null],
  ["W9b day cap 'per certificate year'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per certificate year", [], 40, null],
  // SD-H2: a yearly cap amount is this person's only when its period ends its clause and nothing is printed below the row.
  ["W10 yearly cap 'for all insured persons'", `${CAPPED} for all insured persons`, [], 20, null],
  ["W10b yearly cap 'per policy year per policy'", `${CAPPED} per policy`, [], 20, null],
  ["W15c cap + 'It is for the policy as a whole.'", CAPPED, ["It is for the policy as a whole."], 20, null],
  ["W15 cap + 'This maximum also covers the surgical benefit.'", CAPPED, ["This maximum also covers the surgical benefit."], 20, null],
  ["W15b cap + 'The cap above is for the policy, not each person.'", CAPPED, ["The cap above is for the policy, not each person."], 20, null],
  ["W14 cap '... per policy year in total'", `${CAPPED} in total`, [], 20, null],
  ["W11 cap in RM", CAPPED.replace("S$1,000", "RM 1,000"), [], 20, null],
  ["W12 cap in bare $", CAPPED.replace("S$1,000", "$1,000"), [], 20, null],
  ["W12b cap in US$", CAPPED.replace("S$1,000", "US$1,000"), [], 20, null],
  ["W16b cap written after its period", CAPPED.replace("maximum S$1,000 per policy year", "S$1,000 per policy year maximum"), [], 20, null],
  ["W16c cap 'S$1k'", CAPPED.replace("S$1,000", "S$1k"), [], 20, null],
  ["W16d cap wrapping below the row (a line below: refused)", CAPPED.replace(" policy year", "").replace("365 days per", "365 days per policy year"), ["policy year"], 20, null],
  ["W13 cap control, 20 days", CAPPED, [], 20, "S$1,000"],
  ["W16 cap 'maximum of S$1,000 per year'", CAPPED.replace("maximum S$1,000 per policy year", "maximum of S$1,000 per year"), [], 20, "S$1,000"],
  // Round 2 (SD-H2b): a shared cap or day cap stated in the row's own line; past the label only grammar words may remain.
  ...([", for all insured persons", ", per policy", ", for everyone insured", ", all lives", ". Applies to all insured persons", ", for the whole policy",
    ", for you and your spouse", "; not per person", ", per certificate", ", across all riders", ", together with the ICU rider"] as const)
    .map((t): [string, string, string[], number, null] => [`R2 cap '${t}'`, `${CAPPED}${t}`, [], 20, null]),
  ["R2-12 cap control '.'", `${CAPPED}.`, [], 20, "S$1,000"],
  ["R2-13 day cap ', for all insured persons', no amount cap", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year, for all insured persons", [], 20, null],
  ["R2-14 day cap ', across all riders'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per policy year, across all riders", [], 40, null],
  ["R2-15 day cap ', for you and your spouse together'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per policy year, for you and your spouse together", [], 40, null],
  ["R2-26 day cap '(for all insured)' with the H2-C sentence below", "Hospital income rider\tS$100 per day in hospital, up to 365 days per policy year (for all insured)", [B], 6, null],
  // Round 2 (SD-H4): a waiting form that names a cause or another condition is not this stay's.
  ["R2-20 row 'not payable for the first 2 days of any stay for illness'", "Hospital income rider\tS$100 per day in hospital, not payable for the first 2 days of any stay for illness, up to 365 days per policy year", [], 6, null],
  ["R2-16 below '... of any hospital stay during the first policy year.'", R, ["The rider does not pay for the first 30 days of any hospital stay during the first policy year."], 40, null],
  ["R2-17 below '... that starts within 90 days of cover.'", R, ["The rider does not pay for the first 30 days of any hospital stay that starts within 90 days of cover."], 40, null],
  ["R2-18 below '... of any hospital stay for illness.'", R, ["The rider does not pay for the first 30 days of any hospital stay for illness."], 40, null],
  ["R2-19 below '... of any hospital stay caused by illness.'", R, ["The rider does not pay for the first 2 days of any hospital stay caused by illness."], 6, null],
  ["R2-29 below '... not payable unless it follows an accident.'", R, ["The first 30 days of each stay are not payable unless it follows an accident."], 40, null],
  ["R2-30 below '... for each new condition.'", R, ["The rider does not pay for the first 2 days of any hospital stay for each new condition."], 6, null],
  ["R2-24 H2-C sentence + 'It is for the policy as a whole.'", R, [B, "It is for the policy as a whole."], 6, null],
  ["R2-25 H2-C sentence + 'Days are counted for all insured persons together.'", R, [B, "Days are counted for all insured persons together."], 6, null],
  // Round 2 controls: per-stay forms the gate found right.
  ["R2-22 row 'from the 3rd day of any hospital stay' + cap", "Hospital income rider\tS$100 per day in hospital from the 3rd day of any hospital stay, up to 365 days per policy year, maximum S$1,000 per policy year", [], 20, "S$1,000"],
  ["R2-23 below 'The rider pays from the 3rd day of any hospital stay.'", R, ["The rider pays from the 3rd day of any hospital stay."], 6, "S$400"],
  ["R2-27 row 'first 2 days of a stay not paid'", "Hospital income rider\tS$100 per day in hospital, first 2 days of a stay not paid, up to 365 days per policy year", [], 6, "S$400"],
  ["R2-28 row 'the first 2 days in an admission are not payable'", "Hospital income rider\tS$100 per day in hospital, the first 2 days in an admission are not payable, up to 365 days per policy year", [], 6, "S$400"],
  ["R2-21 row 'from the 31st day' + per policy year", "Hospital income rider\tS$100 per day in hospital from the 31st day, up to 365 days per policy year", [], 40, [null, "S$1,000"]],
  // Round 3 (SD-H2c): on a row read with a new rule, its name may hold benefit-name words only, and nothing past it but
  // grammar words; its own name words are no exemption.
  ["R3-1 label '(all insured persons)' + cap", `Hospital income (all insured persons)\tS$100 per day in hospital from the 3rd day${CAPT}`, [], 20, null],
  ["R3-2 label '(all insured persons)' + cap + ', for all insured persons'", `Hospital income (all insured persons)\tS$100 per day in hospital from the 3rd day${CAPT}, for all insured persons`, [], 20, null],
  ["R3-3 label 'Hospital income for all lives', no tab", `Hospital income for all lives S$100 per day in hospital from the 3rd day${CAPT}`, [], 20, null],
  ["R3-4 label 'Policy hospital income' + ', per policy'", `Policy hospital income\tS$100 per day in hospital from the 3rd day${CAPT}, per policy`, [], 20, null],
  ["R3-5 label 'Hospital income - whole policy' + ', for the whole policy'", `Hospital income - whole policy\tS$100 per day in hospital from the 3rd day${CAPT}, for the whole policy`, [], 20, null],
  ["R3-6 label 'Hospital income for you and your spouse'", `Hospital income for you and your spouse\tS$100 per day in hospital from the 3rd day${CAPT}, for you and your spouse`, [], 20, null],
  ["R3-7 label 'Hospital income for illness or accident' + 'of any stay for illness'", "Hospital income for illness or accident\tS$100 per day in hospital, not payable for the first 2 days of any stay for illness, up to 365 days per policy year", [], 6, null],
  ["R3-8 label 'Hospital income (per policy)' + day cap per policy year", "Hospital income (per policy)\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year", [], 20, null],
  ["R3-9 '... of the policy' after the cap", `Hospital income\tS$100 per day in hospital from the 3rd day${CAPT} of the policy`, [], 20, null],
  ["R3-10 grammar words only after the cap (', and the')", `Hospital income rider\tS$100 per day in hospital from the 3rd day${CAPT}, and the`, [], 20, "S$1,000"],
  ["R3-11 ', of all' after the cap", `Hospital income rider\tS$100 per day in hospital from the 3rd day${CAPT}, of all`, [], 20, null],
  // Round 3 main-path boundary: none of these gives a figure, on main or here.
  ["B1 main shape + ', for all insured persons'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to a maximum of 30 days, for all insured persons", [], 40, null],
  ["B2 main shape + ', per policy'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to a maximum of 30 days, per policy", [], 40, null],
  ["B3 main shape + 'for illness'", "Hospital income rider\tS$100 per day in hospital from the 3rd day for illness, up to a maximum of 30 days", [], 40, null],
  ["B4 main shape + 'per policy year, for all insured persons'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to a maximum of 30 days per policy year, for all insured persons", [], 40, null],
  ["B5 'after the 2nd day' + 'in any one year, for all insured persons'", "Hospital income rider\tS$100 per day in hospital after the 2nd day, up to 30 days in any one year, for all insured persons", [], 40, null],
  ["B6 'per year for all insured', no comma", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per year for all insured", [], 40, null],
  ["B7 day cap 'per stay' + ', for you and your spouse'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per stay, for you and your spouse", [], 40, null],
  // Not pinned by the gate: the true figure or none.
  ["W18 day cap 3 a year, 10-day stay", "Hospital income rider\tS$100 per day in hospital, up to 3 days per policy year", [B], 10, [null, "S$300"]],
  ["W19 waiting 40 days, day cap 30, 50-day stay", "Hospital income rider\tS$100 per day in hospital, up to 30 days per policy year", ["The hospital income rider does not pay for the first 40 days of any hospital stay."], 50, [null, "S$1,000"]],
  ["W29 'first 2 days of each stay are not payable' + 30 days per stay", "Hospital income rider\tS$100 per day in hospital, up to 30 days per stay", ["The first 2 days of each stay are not payable."], 40, [null, "S$3,000"]],
];
for (const [name, row, below, days, want] of GATE) test(`gate ${name}`, () => {
  const a = ask(one(row, below), TAN, [`I was in hospital for ${days} days. How much will I get?`], { perDay: { stayDays: days } });
  const got = stayCard(a)?.amount?.text ?? null;
  const ok = Array.isArray(want) ? want.includes(got) : got === want;
  assert.ok(ok, `${JSON.stringify(got)} vs ${JSON.stringify(want)}: ${JSON.stringify(a.all)}`);
  // No "pays nothing" either, where no figure is right: an unread waiting period never says a stay pays nothing.
  if (want === null) assert.ok(!a.kept.some((s) => /ends before this daily benefit starts/.test(s.text)), JSON.stringify(a.kept.map((s) => s.text)));
  // Only the daily rate and the one worked figure are ever shown.
  assert.ok(a.all.every((x) => x === "S$100" || x === got), JSON.stringify(a.all));
});
test("gate SD-L1: a stay inside the waiting days pays nothing, and its working keeps the yearly period ('per policy year')", () => {
  for (const days of [1, 2]) {
    const a = ask(one(R, [B]), TAN, [`I was in hospital for ${days} days. How much will I get?`], { perDay: { stayDays: days } });
    const st = a.kept.find((s) => /ends before this daily benefit starts/.test(s.text));
    assert.ok(st, JSON.stringify(a.kept));
    assert.match(st!.basis ?? "", /paid from day 3, for at most 365 days per policy year/, JSON.stringify(st));
  }
});

// ============ Report ============
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`);
console.log(`stay-days-test: ${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed`);
if (results.some((r) => !r.ok)) process.exit(1);

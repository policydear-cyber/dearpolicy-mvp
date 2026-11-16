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
function scheduleDoc(person: string, row: string, below: string[] = [], currencyLine = "Policy currency: Singapore dollars (SGD)", above: string[] = []) {
  const id = nid();
  const text = `${INSURER}\n${PRODUCT.toUpperCase()} - POLICY SCHEDULE\nPolicy number: KTG-${n}\tLife assured: ${person}\t${currencyLine}\n`
    + `Benefit\tSum assured / amount\nDeath\t${currencyLine ? "S$" : "$"}300,000\n${above.map((l) => `${l}\n`).join("")}${row}\n${below.join("\n")}`;
  const doc: Doc = { policyId: id, name: `${person} schedule.pdf`, insurer: INSURER, productName: PRODUCT, policyNumber: `KTG-${n}`, documentType: null, documentRole: "personal_schedule",
    effectiveDate: null, expiryDate: null, uploadedAt: "2026-11-01", uploadedFor: null, linkedPeople: [person], supersededAt: null, processingStatus: "ready", pages: [{ page: 1, text }] };
  return { id, doc, row, below };
}
const bn = (o: Record<string, unknown>) => ({ section: "Benefits", column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null,
  baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });

type Built = { house: Household; rows: ReturnType<typeof chatRows> };
/** A household of one or two people, each with their own schedule. `who[i]` reads `rows[i]` with `rates[i]`. */
function household(specs: { person: string; row: string; below?: string[]; value: number; maxDays: number | null; fromDay?: number | null; currencyLine?: string; conditions?: string[]; above?: string[]; benefit?: string }[]): Built {
  const built = specs.map((s) => ({ s, d: scheduleDoc(s.person, s.row, s.below ?? [], s.currencyLine ?? "Policy currency: Singapore dollars (SGD)", s.above ?? []) }));
  const house: Household = { accountId: ACCT, members: specs.map((s, i) => ({ name: s.person, relationship: i === 0 ? "self" : "spouse" })), documents: built.map((b) => b.d.doc) };
  const fam: FamilyMember[] = specs.map((s, i) => ({ id: `f${i}`, display_name: s.person, relationship: i === 0 ? "self" : "spouse", date_of_birth: null }));
  const readings = built.map(({ s, d }) => {
    const src: SourceDoc = { id: d.id, name: d.doc.name, readable: true, pages: d.doc.pages };
    const label = s.benefit ?? s.row.split(/\t| S\$| \$/)[0];
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
const one = (row: string, below: string[] = [], o: { value?: number; maxDays?: number | null; fromDay?: number | null; above?: string[] } = {}) =>
  household([{ person: TAN, row, below, value: o.value ?? 100, maxDays: o.maxDays === undefined ? 365 : o.maxDays, fromDay: o.fromDay ?? null, above: o.above }]);

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
    // A yearly cap counts what was already paid that year, by this person or anyone else the cover takes in (gate SD-L2).
    assert.match(st.basis ?? "", /if nothing was already paid under this benefit in the same year, by you or anyone else it covers$/);
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
// Round 4 (SD-H2d): a heading or line above the row, back to its section's heading, that says limits are shared stops a
// yearly day period or yearly cap amount. A harmless line above changes nothing.
const CAP4 = "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year, maximum S$1,000 per policy year";
const GATE4: [string, string, string[], string[], number, string | null][] = [
  ["R4-1 heading above: 'LIMITS SHARED BY ALL INSURED PERSONS'", CAP4, ["HOSPITAL BENEFITS - LIMITS SHARED BY ALL INSURED PERSONS"], [], 20, null],
  ["R4-2 sentence above: 'Yearly limits below apply per policy, not per person.'", CAP4, ["Yearly limits below apply per policy, not per person."], [], 20, null],
  ["R4-2b sentence above: 'Day limits are for the family together.' (day period only)", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year", ["Day limits are for the family together."], [], 20, null],
  ["R4-3 '*' + NOTES '* The yearly maximum is shared by all insured persons.'", `${CAP4}*`, [], ["", "NOTES", "* The yearly maximum is shared by all insured persons."], 20, null],
  ["R4-4 '(a)' + NOTES '(a) Shared by all insured persons.'", `${CAP4} (a)`, [], ["", "NOTES", "(a) Shared by all insured persons."], 20, null],
  ["R4-5 '¹' + NOTES '¹ Shared by all insured persons.'", `${CAP4}¹`, [], ["", "NOTES", "¹ Shared by all insured persons."], 20, null],
  ["R4-6 '#' + NOTES '# Per policy, shared by all lives.'", `${CAP4} #`, [], ["", "NOTES", "# Per policy, shared by all lives."], 20, null],
  ["R4-7 '(1)' + NOTES '(1) Per policy, shared by all lives.'", `${CAP4} (1)`, [], ["", "NOTES", "(1) Per policy, shared by all lives."], 20, null],
  ["R4-8 day cap '*' + NOTES 'The 30 days are shared'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 30 days per policy year*", [], ["", "NOTES", "* The 30 days are shared by all insured persons."], 40, null],
  ["R4-9 negative waiting '*' + NOTES 'For illness only'", "Hospital income rider\tS$100 per day in hospital, not payable for the first 2 days of any stay*, up to 365 days per policy year", [], ["", "NOTES", "* For illness only. Accident stays are paid from day 1."], 6, null],
  ["R4-10 label 'Hospital cash benefit' control", CAP4.replace("Hospital income rider", "Hospital cash benefit"), [], [], 20, "S$1,000"],
  // An ICU row is never worked out, as on main (an intensive-care day rule may differ).
  ["R4-11 label 'ICU room and board' + cap", CAP4.replace("Hospital income rider", "ICU room and board"), [], [], 20, null],
  ["R4-12 label with colon 'Hospital income: all insured persons'", CAP4.replace("Hospital income rider", "Hospital income: all insured persons"), [], [], 20, null],
  ["R4-13 grammar words after the cap (', and the')", `${CAP4}, and the`, [], [], 20, "S$1,000"],
  // A marker after the cap's period means the clause does not end there: the cap is not read, so no figure.
  ["R4-14 '(a)' with no note", `${CAP4} (a)`, [], [], 20, null],
  // Round 5 (SD-M1): every line of the page above the row is read, joined, whatever headings stand between.
  ["R5-1 sharing note above a heading", CAP4, ["Limits are shared by all insured persons.", "HOSPITAL BENEFITS"], [], 20, null],
  ["R5-2 sharing note above a Title Case heading", CAP4, ["Limits are shared by all insured persons.", "Hospital Benefits"], [], 20, null],
  ["R5-3 sharing in the heading itself", CAP4, ["HOSPITAL BENEFITS (SHARED LIMITS)"], [], 20, null],
  ["R5-4 sharing below a heading, above the row", CAP4, ["HOSPITAL BENEFITS", "Limits are shared by all insured persons."], [], 20, null],
  ["R5-5 sharing, blank lines, then the row", CAP4, ["Limits are shared by all insured persons.", "", "", ""], [], 20, null],
  ["R5-6 sharing above a tabbed sub-header", CAP4, ["Limits are shared by all insured persons.", "Benefit\tAmount"], [], 20, null],
  ["R5-7 sharing above a one-word heading", CAP4, ["Limits are shared by all insured persons.", "HOSPITAL"], [], 20, null],
  ["R5-8 sharing above a Title Case row name", CAP4, ["Limits are shared by all insured persons.", "Intensive Care Unit"], [], 20, null],
  ["R5-9 sharing above 'Note 2'", CAP4, ["Limits are shared by all insured persons.", "Note 2"], [], 20, null],
  // Round 5 (SD-L2): more sharing words, directly above the row.
  ...([["R5-10", "Yearly limits are for everyone on the policy."], ["R5-11", "Yearly limits apply per certificate."], ["R5-12", "Yearly limits apply per household."],
    ["R5-13", "Yearly limits are pooled."], ["R5-14", "Yearly limits apply jointly."], ["R5-15", "Yearly limits are split between you and your spouse."],
    ["R5-16", "Yearly limits cover all persons covered."], ["R5-17", "Yearly limits apply to all members."], ["R5-18", "Yearly limits apply to each policy, not each life."],
    ["R5-19", "Yearly limits apply to the whole policy."], ["R5-20", "Yearly limits apply per plan."], ["R5-21", "Yearly limits include claims by your dependants."],
    ["R5-21b", "Yearly limits include claims by your dependents."], ["R5-22", "Per-policy yearly limits apply."]] as const)
    .map(([id, line]): [string, string, string[], string[], number, null] => [`${id} '${line}' above`, CAP4, [line], [], 20, null]),
  ["R5-23 'ALL INSURED' wrapped over two lines", CAP4, ["LIMITS FOR ALL", "INSURED PERSONS"], [], 20, null],
  ["R5-24 day-cap-only row + 'Days are shared by all insured persons.'", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year", ["Days are shared by all insured persons."], [], 20, null],
  // Round 5 controls.
  ["R5-25 'Limits are per policy year.' above", CAP4, ["Limits are per policy year."], [], 20, "S$1,000"],
  ["R5-25b 'Limits are per-policy year.' above", CAP4, ["Limits are per-policy year."], [], 20, "S$1,000"],
  ["R5-26 neutral note above", CAP4, ["All amounts are in Singapore dollars."], [], 20, "S$1,000"],
  ["R5-27 'the insured person' above", CAP4, ["Benefits are paid to the insured person."], [], 20, "S$1,000"],
  // A negative waiting form keeps only grammar words past the row's name, so "per stay" after the day cap gives no figure.
  ["R5-28 negative waiting, per-stay cap, 'shared' above", "Hospital income rider\tS$100 per day in hospital, not payable for the first 2 days of any stay, up to 30 days per stay", ["Limits are shared by all insured persons."], [], 6, null],
  // Positives: a harmless line above the row, or a harmless heading, changes nothing.
  ["R4 positive: harmless line above ('Hospital benefits are paid in Singapore dollars.')", CAP4, ["Hospital benefits are paid in Singapore dollars."], [], 20, "S$1,000"],
  ["R4 positive: harmless heading above ('HOSPITAL BENEFITS')", CAP4, ["HOSPITAL BENEFITS"], [], 20, "S$1,000"],
  ["R4 positive: H2-C with a harmless line above", "Hospital income rider\tS$100 per day in hospital, up to 365 days per\npolicy year", ["Benefits are paid once the claim is approved."], [B], 6, "S$400"],
];
for (const [name, row, above, below, days, want] of GATE4) test(`gate ${name}`, () => {
  const a = ask(one(row, below, { above }), TAN, [`I was in hospital for ${days} days. How much will I get?`], { perDay: { stayDays: days } });
  const got = stayCard(a)?.amount?.text ?? null;
  assert.equal(got, want, JSON.stringify(a.all));
  if (want === null) assert.ok(!a.kept.some((s) => /ends before this daily benefit starts/.test(s.text)), JSON.stringify(a.kept.map((s) => s.text)));
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

// ============ Wrapped cells and rows in between (stay-wrap, journey retest TE-ACC-20261116) ============
// The retest's 4 schedules, rebuilt with made-up words: a cell that wraps onto the next line ("up to 365 days per" /
// "policy year"), a premium row, another benefit's own row or a how-to-claim note between the daily row and its day cap or
// waiting days. Each shape is worked out; another benefit's own day cap or waiting days, or another person's row, never
// is this row's (unsure = no figure).
const US = "Policy currency: United States dollars (US$)";
const KW = "The hospital income rider does not pay for the first 2 days of any hospital stay.";
const KROW = "Hospital income\tS$100 per day in hospital, up to 365 days per\npolicy year";
const PACIFIC_ABOVE = ["Benefit\tWhat is paid", "Early-stage critical illness\t25% of the Sum Insured, up to US$20,000", "Late-stage critical illness\t100% of the Sum Insured, less any early-stage", "amount already paid"];
const PROW = "Hospital cash\tUS$80 per day in hospital, from the first day,\nup to 20 days per policy year";
const PWAIT = "Waiting period: 90 days from the cover start date (1 March 2026) for any critical illness.";
const OROW = "Daily hospital income\tS$150 per day of hospital stay";
const OICU = ["Intensive care unit (ICU) income\tS$300 per day in ICU, instead of the daily", "hospital income"];
const OMAX = "Maximum days\t10 days per hospital stay";
const OWAIT = "Waiting days: no hospital income is paid for the first 2 days of each hospital stay.";
const MABOVE = ["TABLE OF BENEFITS", "Section\tBenefit\tAmount payable", "3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum S$1,500 per accident"];
const MROW = "4\tHospital cash\tS$50 per day in hospital, payable from the third consecutive day, up to 30 days per accident";
const MBELOW = ["5\tMedical expenses\tUp to S$2,500 per accident, after an excess of S$100 per claim",
  "Exclusions: injury while taking part in motor racing or professional sport; self-inflicted injury.",
  "How to claim: notify us within 30 days of the accident on 6000 0000 (claims line) and", "send the completed claim form with the hospital discharge summary."];
type WrapOpts = { value: number; maxDays: number | null; fromDay?: number | null; currencyLine?: string; benefit?: string; above?: string[] };
const WRAP: [string, string, string[], WrapOpts, number, string | null][] = [
  // Shape 1: the terms wrap, and the premium row stands between the row and its waiting sentence.
  ["TE16-1 wrapped 'per' / 'policy year' + premium row + waiting sentence, 6 days", KROW, ["Annual premium\tS$285.00", KW], { value: 100, maxDays: 365 }, 6, "S$400"],
  ["TE16-1b the same, the quote ending at the row's first line", KROW.split("\n")[0], ["policy year", "Annual premium\tS$285.00", KW], { value: 100, maxDays: 365 }, 6, "S$400"],
  ["TE16-1c the name and the terms both wrap ('income\\tpolicy year')", "Hospital\tS$100 per day in hospital, up to 365 days per", ["income\tpolicy year", "Annual premium\tS$285.00", KW], { value: 100, maxDays: 365, benefit: "Hospital income" }, 6, "S$400"],
  ["TE16-1d the name alone wraps ('income')", "Daily hospital\tS$100 per day in hospital, up to 365 days per policy year", ["income", "Annual premium\tS$285.00", "The daily hospital income does not pay for the first 2 days of any hospital stay."], { value: 100, maxDays: 365 }, 6, "S$400"],
  ["TE16-1e another benefit's own row between the row and its waiting sentence, which names the row", KROW, ["Surgical benefit\tS$500 per operation", KW], { value: 100, maxDays: 365 }, 6, "S$400"],
  ["TE16-1f a wrapped yearly cap ('maximum S$1,000 per' / 'policy year'), 20 days", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year, maximum S$1,000 per", ["policy year"], { value: 100, maxDays: 365 }, 20, "S$1,000"],
  // Shape 2: the terms wrap after "from the first day,"; the cover-start waiting period names another benefit on the page.
  ["TE16-2 'from the first day,' / 'up to 20 days per policy year' + another benefit's waiting period, 3 days", PROW, [PWAIT], { value: 80, maxDays: 20, currencyLine: US, above: PACIFIC_ABOVE }, 3, "US$240"],
  ["TE16-2b the same, 2 days", PROW, [PWAIT], { value: 80, maxDays: 20, currencyLine: US, above: PACIFIC_ABOVE }, 2, "US$160"],
  // Shape 3: another benefit's own (wrapped) row, then a "Maximum days" row and a "Waiting days:" sentence.
  // Shape 3 with its ICU row: an alternative to this row ("instead of the daily hospital income") may change what the stay
  // pays, so the row stays and stops the figure, as a plain ICU row does (gate #508 HIGH 4, MEDIUM 5).
  ["TE16-3 ICU row 'instead of the daily' / 'hospital income', 'Maximum days' row, 'Waiting days:' sentence, 5 days: none", OROW, [...OICU, OMAX, OWAIT, "Annual premium: S$420.00"], { value: 150, maxDays: 10 }, 5, null],
  ["TE16-3b 'Maximum days' under the row, then the ICU row: none", OROW, [OMAX, ...OICU, OWAIT], { value: 150, maxDays: 10 }, 15, null],
  // Shape 3 with another benefit's own row in its place: worked out. The retest's reading gave the row no most days (they
  // are on a line of their own): the printed line still decides it.
  ["TE16-3c surgical row, 'Maximum days' row, 'Waiting days:' sentence, read with no most days, 5 days", OROW, ["Surgical benefit\tS$500 per operation", OMAX, OWAIT, "Annual premium: S$420.00"], { value: 150, maxDays: null }, 5, "S$450"],
  ["TE16-3d 'Maximum days' under the row itself, then a surgical row, 15 days (capped at 10)", OROW, [OMAX, "Surgical benefit\tS$500 per operation", OWAIT], { value: 150, maxDays: 10 }, 15, "S$1,500"],
  // Shape 4: a numbered table, the next benefit's own row, an exclusions line and a wrapped how-to-claim note below.
  // Round 3 (gate #508 NEW-HIGH 1): its "Up to S$2,500 per accident" is a limit shape that may be shared, so it stays: none.
  ["TE16-4 numbered row, 'Medical expenses' row (a limit shape), exclusions and a how-to-claim note, 5 days: none", MROW, MBELOW, { value: 50, maxDays: 30, fromDay: 3, benefit: "Hospital cash", above: MABOVE }, 5, null],
  ["TE16-4b the same table with a plain unit-rate row in its place, 5 days", MROW, ["5\tSurgical benefit\tS$500 per operation", ...MBELOW.slice(1)], { value: 50, maxDays: 30, fromDay: 3, benefit: "Hospital cash", above: MABOVE }, 5, "S$150"],
  // Negatives: unsure means no figure.
  ["TE16-N1 'Maximum days' past another benefit's row may be that row's: a stay it would cut short gets none", OROW, [...OICU, OMAX, OWAIT], { value: 150, maxDays: 10 }, 15, null],
  ["TE16-N1b read with no most days, and the most-days line says more ('for all insured persons')", OROW, [OMAX + ", for all insured persons", OWAIT], { value: 150, maxDays: null }, 5, null],
  ["TE16-N2 a plain ICU row between (no 'instead of this row') still stops the figure", OROW, ["Intensive care unit (ICU) income\tS$300 per day in ICU", OMAX, OWAIT], { value: 150, maxDays: 10 }, 5, null],
  ["TE16-N3 the next benefit's own wrapped day cap is never this row's", OROW, ["Recovery income\tS$80 per day at home,", "up to 10 days", OWAIT], { value: 150, maxDays: 10 }, 5, null],
  ["TE16-N4 the next benefit's own day cap (numbered table) is never this row's", "4\tHospital cash\tS$50 per day in hospital, payable from the third consecutive day", ["5\tMedical expenses\tUp to S$2,500 per accident, maximum 30 days"], { value: 50, maxDays: 30, fromDay: 3, benefit: "Hospital cash", above: MABOVE }, 5, null],
  ["TE16-N5 a waiting sentence under another benefit's row that does not name this row is that row's", KROW, ["Recovery cash\tS$50 per day at home", "This benefit does not pay for the first 2 days of any hospital stay."], { value: 100, maxDays: 365 }, 6, null],
  ["TE16-N6 a waiting sentence under another benefit's row naming only words both rows share", "Hospital income\tS$100 per day in hospital, up to 365 days per policy year", ["Recovery income rider\tS$50 per day at home", "The income rider does not pay for the first 2 days of any hospital stay."], { value: 100, maxDays: 365 }, 6, null],
  ["TE16-N7 another benefit's row tied to this one ('combined with') stops the figure", KROW, ["Surgical benefit\tUp to S$2,000 per operation, combined with the benefit above", KW], { value: 100, maxDays: 365 }, 6, null],
  ["TE16-N8 a lump-sum limit row is not another benefit ('Overall limit')", OROW, ["Overall limit\tS$1,000 per stay", OMAX, OWAIT], { value: 150, maxDays: 10 }, 15, null],
  ["TE16-N9 a cover-start waiting period naming no benefit", PROW, ["Waiting period: 90 days from the cover start date (1 March 2026)."], { value: 80, maxDays: 20, currencyLine: US, above: PACIFIC_ABOVE }, 3, null],
  ["TE16-N10 a cover-start waiting period 'for any illness'", PROW, ["Waiting period: 90 days from the cover start date (1 March 2026) for any illness."], { value: 80, maxDays: 20, currencyLine: US, above: PACIFIC_ABOVE }, 3, null],
  ["TE16-N11 a cover-start waiting period naming a benefit with no row on the page", PROW, [PWAIT], { value: 80, maxDays: 20, currencyLine: US }, 3, null],
  ["TE16-N12 a how-to-claim note with a penalty stays, and stops the figure", MROW, [MBELOW[0], "How to claim: notify us within 30 days of the accident, otherwise the benefit is reduced by half."], { value: 50, maxDays: 30, fromDay: 3, benefit: "Hospital cash", above: MABOVE }, 5, null],
  ["TE16-N13 a wrapped line that adds a condition ('for all insured persons') stops the figure", "Hospital income\tS$100 per day in hospital, up to 365 days per policy year,", ["for all insured persons", KW], { value: 100, maxDays: 365 }, 6, null],
  ["TE16-N14 a wrapped line with a cause ('only after an accident') stops the figure", "Hospital cash\tS$50 per day in hospital, payable from the third consecutive day,", ["up to 30 days, only after an accident"], { value: 50, maxDays: 30, fromDay: 3 }, 5, null],
  // Two people's rows in one table: the other person's row (and its day cap) is never this person's.
  ["TE16-P1 two people's rows: the next person's own day cap is not this row's", "Hospital income (Tan Wei Ming)\tS$100 per day in hospital", ["Hospital income (Lee Mei Ling)\tS$100 per day in hospital, up to 30 days per", "policy year", KW], { value: 100, maxDays: 30, benefit: "Hospital income (Tan Wei Ming)" }, 6, null],
  ["TE16-P2 two people's rows by name cell, both wrapped", "Tan Wei Ming\tHospital income\tS$100 per day in hospital, up to 365 days per", ["policy year", "Lee Mei Ling\tHospital income\tS$100 per day in hospital, up to 30 days per", "policy year", KW], { value: 100, maxDays: 365, benefit: "Hospital income" }, 6, null],
  ["TE16-P3 the next person's row of another benefit holds the only day cap", "Hospital cash\tS$100 per day in hospital, payable from the 3rd day", ["Lee Mei Ling\tRecovery cash\tS$80 per day, maximum 30 days"], { value: 100, maxDays: 30, fromDay: 3 }, 6, null],
  // Gate #508, round 1: every repro.
  // NEW-HIGH 1: a pool or shared limit row is never another benefit; it stays and stops the figure.
  ["G1 'Benefit pool\\tS$3,000' below, 40 days", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year", ["Benefit pool\tS$3,000"], { value: 100, maxDays: 365, fromDay: 3 }, 40, null],
  ["G2 'Family pool\\tS$5,000 across everyone covered', 60 days", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year", ["Family pool\tS$5,000 across everyone covered"], { value: 100, maxDays: 365, fromDay: 3 }, 60, null],
  ["G3 'Pool\\tS$3,000', 40 days", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year", ["Pool\tS$3,000"], { value: 100, maxDays: 365, fromDay: 3 }, 40, null],
  ["G4 yearly cap + 'Benefit pool\\tS$3,000', 60 days", "Hospital income rider\tS$100 per day in hospital from the 3rd day, up to 365 days per policy year, maximum S$5,000 per policy year", ["Benefit pool\tS$3,000"], { value: 100, maxDays: 365, fromDay: 3 }, 60, null],
  ["G5 'Benefit pool\\tS$1,000' then most days and waiting days, 20 days", OROW, ["Benefit pool\tS$1,000", "Maximum days\t30 days per hospital stay", OWAIT], { value: 150, maxDays: 30 }, 20, null],
  ["G6 the same, 9 days", OROW, ["Benefit pool\tS$1,000", "Maximum days\t30 days per hospital stay", OWAIT], { value: 150, maxDays: 30 }, 9, null],
  ["G7 'Overall limit\\tS$2,000 per accident' under a numbered row", MROW, ["5\tOverall limit\tS$2,000 per accident"], { value: 50, maxDays: 30, fromDay: 3, benefit: "Hospital cash", above: MABOVE }, 5, null],
  // NEW-HIGH 2: a wrapped row is read exactly as it is on one line (main's figures).
  ["G8 'up to 30 days per' / 'hospital stay', 6 days", "Hospital cash\tS$100 per day in hospital, from the 3rd day, up to 30 days per", ["hospital stay"], { value: 100, maxDays: 30, fromDay: 3 }, 6, "S$400"],
  ["G9 'up to 30 days' / 'per accident' (the retest's numbered row, wrapped), 5 days", "Hospital cash\tS$50 per day in hospital, payable from the third consecutive day, up to 30 days", ["per accident"], { value: 50, maxDays: 30, fromDay: 3 }, 5, "S$150"],
  ["G10 'maximum 30 days per' / 'confinement', 6 days", "Hospital cash\tS$100 per day in hospital, from the 3rd day, maximum 30 days per", ["confinement"], { value: 100, maxDays: 30, fromDay: 3 }, 6, "S$400"],
  ["G11 'up to 30 days' / 'of hospitalisation', 6 days", "Hospital cash\tS$100 per day in hospital, from the 3rd day, up to 30 days", ["of hospitalisation"], { value: 100, maxDays: 30, fromDay: 3 }, 6, "S$400"],
  ["G12 name wraps: 'Daily hospital' / 'income', per stay, 6 days", "Daily hospital\tS$100 per day in hospital, from the first day, up to 30 days per stay", ["income"], { value: 100, maxDays: 30, fromDay: 1 }, 6, "S$600"],
  ["G13 name wraps: 'Hospital' / 'cash', per stay, 6 days", "Hospital\tS$100 per day in hospital, from the 3rd day, up to 30 days per stay", ["cash"], { value: 100, maxDays: 30, fromDay: 3 }, 6, "S$400"],
  // HIGH 3: a row named by a person or plan only may be this benefit for them: nothing below it is taken as this row's.
  ...(["Lee Mei Ling", "Plan B", "Deluxe", "Spouse", "Child"] as const).map((who): [string, string, string[], WrapOpts, number, string | null] =>
    [`G14 '${who}\\tS$80 per day' then a waiting sentence and most days, 8 days`, "Hospital cash\tS$150 per day", [`${who}\tS$80 per day`, "No hospital cash is paid for the first 5 days of any hospital stay.", "Maximum days\t30 days per hospital stay"], { value: 150, maxDays: 30 }, 8, null]),
  // HIGH 4: high dependency and critical care rows stop the figure, as an ICU row does.
  ["G15 'High dependency unit income\\tS$250 per day in HDU', 5 days", OROW, ["High dependency unit income\tS$250 per day in HDU", OMAX, OWAIT], { value: 150, maxDays: 10 }, 5, null],
  ["G16 'Critical care cash\\tS$300 per day in critical care', 5 days", OROW, ["Critical care cash\tS$300 per day in critical care", OMAX, OWAIT], { value: 150, maxDays: 10 }, 5, null],
  // MEDIUM 5: an alternative to this row stops the figure.
  ["G17 'in place of the daily amount', 5 days", OROW, ["Convalescence benefit\tS$500 lump sum, in place of the daily amount", OMAX, OWAIT], { value: 150, maxDays: 10 }, 5, null],
  ["G18 'substitutes for the cash', 5 days", OROW, ["Surgical cash\tS$500 per operation, substitutes for the cash", OMAX, OWAIT], { value: 150, maxDays: 10 }, 5, null],
  ["G19 'replaces the daily amount', 5 days", OROW, ["Surgical cash\tS$500 per operation, replaces the daily amount", OMAX, OWAIT], { value: 150, maxDays: 10 }, 5, null],
  ["G20 'instead of the daily amount', 5 days", OROW, ["Surgical cash\tS$500 per operation, instead of the daily amount", OMAX, OWAIT], { value: 150, maxDays: 10 }, 5, null],
];
for (const [name, row, below, o, days, want] of WRAP) test(`stay-wrap ${name}`, () => {
  const h = household([{ person: TAN, row, below, value: o.value, maxDays: o.maxDays, fromDay: o.fromDay ?? null, currencyLine: o.currencyLine, above: o.above, benefit: o.benefit }]);
  const a = ask(h, TAN, [`I was in hospital for ${days} days. How much will I get?`], { perDay: { stayDays: days } });
  assert.ok(a.row, `no daily row: ${JSON.stringify(h.rows.map((r) => [r.benefit, r.pays, r.figure.kind]))}`);
  const got = stayCard(a)?.amount?.text ?? null;
  assert.equal(got, want, JSON.stringify(a.kept.map((s) => [s.text, s.amount?.text ?? null, s.basis ?? null])));
  if (want === null) assert.ok(!a.kept.some((s) => /ends before this daily benefit starts/.test(s.text)), JSON.stringify(a.kept.map((s) => s.text)));
  // Only the daily rate and the one worked figure are ever shown.
  const daily = `${o.currencyLine === US ? "US$" : "S$"}${o.value}`;
  assert.ok(a.all.every((x) => x === daily || x === got), JSON.stringify(a.all));
});

test("gate #508 LOW 6: a per-accident day cap printed below the row says 'per accident' in the working", () => {
  const h = household([{ person: TAN, row: "Hospital cash\tS$100 per day in hospital, from the 3rd day", below: ["Maximum days\t10 days per accident"], value: 100, maxDays: null, fromDay: 3 }]);
  const a = ask(h, TAN, ["I was in hospital for 15 days. How much will I get?"], { perDay: { stayDays: 15 } });
  const st = stayCard(a);
  assert.equal(st?.amount?.text, "S$1,000", JSON.stringify(a.kept));
  assert.match(st!.basis ?? "", /for at most 10 days per accident/, JSON.stringify(st));
});

// ============ Gate #508 round 2 ============
const R2C = "Hospital cash\tS$100 per day in hospital, from the first day, up to 60 days per stay";
const R2I = "Hospital income\tS$100 per day in hospital, from the first day, up to 60 days per stay";
const R2W = "Hospital cash\tS$100 per day in hospital, from the 3rd day, up to 30 days";
const ROUND2: [string, string, string[], WrapOpts, number, string | null][] = [
  // NEW-HIGH 1: a shared limit named with this row's kind, several benefits or no one benefit is never "another benefit".
  ["R2-1 'Medical and cash benefits\\tUp to S$3,000 per accident', 40 days", R2C, ["Medical and cash benefits\tUp to S$3,000 per accident"], { value: 100, maxDays: 60, fromDay: 1 }, 40, null],
  ["R2-1b 'Medical and income benefits…', 40 days", R2I, ["Medical and income benefits\tUp to S$3,000 per accident"], { value: 100, maxDays: 60, fromDay: 1, benefit: "Hospital income" }, 40, null],
  ["R2-1c 'Accidental benefits\\tUp to S$3,000 per accident', 40 days", R2C, ["Accidental benefits\tUp to S$3,000 per accident"], { value: 100, maxDays: 60, fromDay: 1 }, 40, null],
  ["R2-1d 'Accidental benefits\\tS$3,000 per accident', 40 days", R2C, ["Accidental benefits\tS$3,000 per accident"], { value: 100, maxDays: 60, fromDay: 1 }, 40, null],
  ["R2-1e 'Accidental benefit\\tUp to S$3,000 per accident' (no specific benefit), 40 days", R2C, ["Accidental benefit\tUp to S$3,000 per accident"], { value: 100, maxDays: 60, fromDay: 1 }, 40, null],
  ["R2-1f 'Medical or surgical benefit…', 40 days", R2C, ["Medical or surgical benefit\tUp to S$3,000 per accident"], { value: 100, maxDays: 60, fromDay: 1 }, 40, null],
  ["R2-1g 'Hospital allowance\\tUp to S$3,000 per accident', 40 days", R2C, ["Cash allowance\tUp to S$3,000 per accident"], { value: 100, maxDays: 60, fromDay: 1 }, 40, null],
  // Round 3: a limit shape ("Up to S$3,000 per accident") under the row may be shared with it, whatever its name: none.
  ["R2-1h 'Accidental medical benefit\\tUp to S$3,000 per accident' (round 3: a limit shape), 40 days", R2C, ["Accidental medical benefit\tUp to S$3,000 per accident"], { value: 100, maxDays: 60, fromDay: 1 }, 40, null],
  ["R2-1i 'Medical expenses\\tUp to S$2,500 per accident' (round 3: a limit shape), 40 days", R2C, ["Medical expenses\tUp to S$2,500 per accident"], { value: 100, maxDays: 60, fromDay: 1 }, 40, null],
  // HIGH 2: a bracketed condition in the row's own words, wrapped or on one line, gives no figure.
  ["R2-2 wrapped 'per stay (accident only)', 40 days", R2W, ["per stay (accident only)"], { value: 100, maxDays: 30, fromDay: 3 }, 40, null],
  ["R2-2b wrapped 'per accident (overseas only)', 6 days", R2W, ["per accident (overseas only)"], { value: 100, maxDays: 30, fromDay: 3 }, 6, null],
  ["R2-2c one line '…per stay (accident only)', 40 days", R2W + " per stay (accident only)", [], { value: 100, maxDays: 30, fromDay: 3 }, 40, null],
  ["R2-2d one line '…(for all lives)', 40 days", R2W + " per stay (for all lives)", [], { value: 100, maxDays: 30, fromDay: 3 }, 40, null],
  ["R2-2e one line '…(Lee Mei Ling)', 6 days", R2W + " per stay (Lee Mei Ling)", [], { value: 100, maxDays: 30, fromDay: 3 }, 6, null],
  ["R2-2f one line '…(child)', 6 days", R2W + " per stay (child)", [], { value: 100, maxDays: 30, fromDay: 3 }, 6, null],
  ["R2-2g one line '…per accident (overseas only)', 6 days", R2W + " per accident (overseas only)", [], { value: 100, maxDays: 30, fromDay: 3 }, 6, null],
  ["R2-2h control: the same row with no bracket keeps main's figure, 40 days", R2W + " per stay", [], { value: 100, maxDays: 30, fromDay: 3 }, 40, "S$3,000"],
  ["R2-2i control: a wrapped 'per stay' with no bracket, 40 days", R2W, ["per stay"], { value: 100, maxDays: 30, fromDay: 3 }, 40, "S$3,000"],
  ["R2-2j control: a harmless bracket ('(30) days'), 40 days", "Hospital cash\tS$100 per day in hospital, from the 3rd day, up to (30) days per stay", [], { value: 100, maxDays: 30, fromDay: 3 }, 40, "S$3,000"],
  // MEDIUM 3 (kept on purpose): a pointer to notes elsewhere may add conditions, so no figure.
  ["R2-3 'see notes on the next page' below the row, 6 days", "Hospital cash\tS$100 per day, from the 3rd day, up to 30 days", ["see notes on the next page"], { value: 100, maxDays: 30, fromDay: 3 }, 6, null],
];
// ============ Gate #508 round 3 ============
const R3W = "Hospital cash\tS$100 per day in hospital, from the 3rd day, up to 30 days per stay";
const R3O = { value: 100, maxDays: 30, fromDay: 3 };
const R3C = { value: 100, maxDays: 60, fromDay: 1 };
ROUND2.push(
  // NEW-HIGH 1: any limit shape between the row and the end of its block stops the figure; so does a footnote tying it.
  ["R3-1 'Accidental medical benefit…per accident' + '* Hospital cash counts towards this amount.', 40 days", R2C, ["Accidental medical benefit\tUp to S$3,000 per accident", "* Hospital cash counts towards this amount."], R3C, 40, null],
  ["R3-1b 'Medical expenses…per accident' + '\\tincluding daily benefits', 40 days", R2C, ["Medical expenses\tUp to S$3,000 per accident", "\tincluding daily benefits"], R3C, 40, null],
  ["R3-1c 'Medical\\tUp to S$3,000 per accident', 40 days", R2C, ["Medical\tUp to S$3,000 per accident"], R3C, 40, null],
  ["R3-1d 'Surgical benefit\\tMaximum S$2,000 per operation', 40 days", R2C, ["Surgical benefit\tMaximum S$2,000 per operation"], R3C, 40, null],
  ["R3-1e 'Surgical benefit\\tS$2,000 per policy year', 40 days", R2C, ["Surgical benefit\tS$2,000 per policy year"], R3C, 40, null],
  ["R3-1f 'Medical expenses\\tS$3,000 overall', 40 days", R2C, ["Medical expenses\tS$3,000 overall"], R3C, 40, null],
  ["R3-1g 'Surgical benefit\\tS$500 per stay', 40 days", R2C, ["Surgical benefit\tS$500 per stay"], R3C, 40, null],
  ["R3-1h a plain unit-rate row, then 'Note: hospital cash is shared with it.', 40 days", R2C, ["Surgical benefit\tS$500 per operation", "Note: hospital cash is shared with it."], R3C, 40, null],
  ["R3-1i a plain unit-rate row, then a footnote naming the row, 40 days", R2C, ["Surgical benefit\tS$500 per operation", "* Hospital cash is reduced by any surgical benefit paid."], R3C, 40, null],
  ["R3-1j a footnote 'counts towards' directly under the row, 40 days", R2C, ["* Hospital cash counts towards the overall limit."], R3C, 40, null],
  ["R3-1k control: a plain unit-rate row ('Surgical benefit\\tS$500 per operation') is still left out, 40 days", R2C, ["Surgical benefit\tS$500 per operation"], R3C, 40, "S$4,000"],
  ["R3-1l control: 'Physiotherapy\\tS$80 per visit', 40 days", R2C, ["Physiotherapy\tS$80 per visit"], R3C, 40, "S$4,000"],
  // NEW-HIGH 2: a leading enumerator and a name's abbreviation are labels, not conditions.
  ["R3-2 '(a) Hospital cash\\t…', 40 days", `(a) ${R3W}`, [], R3O, 40, "S$3,000"],
  ["R3-2b 'Hospital cash (HC)\\t…', 40 days", R3W.replace("Hospital cash", "Hospital cash (HC)"), [], { ...R3O, benefit: "Hospital cash (HC)" }, 40, "S$3,000"],
  ["R3-2c '1. Hospital cash\\t…', 40 days", `1. ${R3W}`, [], R3O, 40, "S$3,000"],
  ["R3-2d 'i) Hospital cash\\t…', 40 days", `i) ${R3W}`, [], R3O, 40, "S$3,000"],
  ["R3-2e '(a) Hospital cash (HC)\\t…', 6 days", `(a) ${R3W.replace("Hospital cash", "Hospital cash (HC)")}`, [], { ...R3O, benefit: "Hospital cash (HC)" }, 6, "S$400"],
  ["R3-2f 'Hospital cash (Plan B)' stays a condition: none", R3W.replace("Hospital cash", "Hospital cash (Plan B)"), [], { ...R3O, benefit: "Hospital cash (Plan B)" }, 40, null],
  ["R3-2g 'Hospital cash (see note 3)' stays a condition: none", R3W.replace("Hospital cash", "Hospital cash (see note 3)"), [], { ...R3O, benefit: "Hospital cash (see note 3)" }, 40, null],
  ["R3-2h 'Hospital cash (XY)' (not its initials) stays a condition: none", R3W.replace("Hospital cash", "Hospital cash (XY)"), [], { ...R3O, benefit: "Hospital cash (XY)" }, 40, null],
  // HIGH 3: any bracket type, and a trailing ", <x> only" or "- <x> only" clause, is a condition.
  ["R3-3 '[accident only]', 40 days", `${R3W} [accident only]`, [], R3O, 40, null],
  ["R3-3b ', accident only', 40 days", `${R3W}, accident only`, [], R3O, 40, null],
  ["R3-3c '- accident only', 40 days", `${R3W} - accident only`, [], R3O, 40, null],
  ["R3-3d '{for all lives}', 40 days", `${R3W} {for all lives}`, [], R3O, 40, null],
  ["R3-3e full-width '（accident only）', 40 days", `${R3W} （accident only）`, [], R3O, 40, null],
  ["R3-3f wrapped '[accident only]', 40 days", R3W, ["[accident only]"], R3O, 40, null],
  ["R3-3g wrapped ', overseas only' clause, 6 days", "Hospital cash\tS$100 per day in hospital, from the 3rd day, up to 30 days per stay,", ["overseas only"], R3O, 6, null],
);
// ============ Gate #508 round 4 (stay-qualifier) ============
// HIGH (main the same): a qualifier with no brackets, after or before the cap period, says which stays it pays: none.
// Past the name, the row's terms are an allow-list (period words, waiting rule, punctuation).
const R4Y = "Hospital cash\tS$100 per day in hospital, from the 3rd day, up to 30 days per policy year";
ROUND2.push(
  ["R4-1 '…per stay accident only' (no punctuation), 40 days", `${R3W} accident only`, [], R3O, 40, null],
  ["R4-1b '…in hospital for accidents only, from the 3rd day…', 40 days", "Hospital cash\tS$100 per day in hospital for accidents only, from the 3rd day, up to 30 days per stay", [], R3O, 40, null],
  ["R4-1c '…per stay, overseas', 40 days", `${R3W}, overseas`, [], R3O, 40, null],
  ["R4-1d '…per stay, solely for accidents', 40 days", `${R3W}, solely for accidents`, [], R3O, 40, null],
  ["R4-1e '…per stay, for all lives', 40 days", `${R3W}, for all lives`, [], R3O, 40, null],
  ["R4-1f '(a) Hospital cash for all lives\\t…', 40 days", `(a) ${R3W.replace("Hospital cash", "Hospital cash for all lives")}`, [], { ...R3O, benefit: "Hospital cash for all lives" }, 40, null],
  ["R4-1g '(a) Hospital cash\\t…per stay, for all lives', 40 days", `(a) ${R3W}, for all lives`, [], R3O, 40, null],
  ["R4-1h wrapped 'per accident overseas', 6 days", R2W, ["per accident overseas"], R3O, 6, null],
  ["R4-1i '…per stay worldwide', 40 days", `${R3W} worldwide`, [], R3O, 40, null],
  ["R4-1j '…per stay, illness', 6 days", `${R3W}, illness`, [], R3O, 6, null],
  ["R4-1k '…per policy year, overseas', 6 days", `${R4Y}, overseas`, [], R3O, 6, null],
  ["R4-1l 'Hospital cash only for you\\t…', 6 days", R3W.replace("Hospital cash", "Hospital cash only for you"), [], { ...R3O, benefit: "Hospital cash only for you" }, 6, null],
  // Controls: the period words, punctuation and the row's own waiting rule keep main's figure.
  ["R4-2 control: '…per stay.', 40 days", `${R3W}.`, [], R3O, 40, "S$3,000"],
  ["R4-2b control: '…per policy year', 6 days", R4Y, [], R3O, 6, "S$400"],
  // "per confinement" after "up to 30 days" gives none on 725e661c already (a reading this follow-up does not change).
  ["R4-2c '…per confinement' (none before this change too), 40 days", R3W.replace("per stay", "per confinement"), [], R3O, 40, null],
  ["R4-2d control: '…per accident', 6 days", R3W.replace("per stay", "per accident"), [], R3O, 6, "S$400"],
  ["R4-2e control: '…per hospital stay;', 40 days", R3W.replace("per stay", "per hospital stay;"), [], R3O, 40, "S$3,000"],
  ["R4-2f control: wrapped 'per stay', 40 days", R2W, ["per stay"], R3O, 40, "S$3,000"],
  ["R4-2g control: '(a) Hospital cash (HC)\\t…per stay', 40 days", `(a) ${R3W.replace("Hospital cash", "Hospital cash (HC)")}`, [], { ...R3O, benefit: "Hospital cash (HC)" }, 40, "S$3,000"],
  ["R4-2h control: '…up to 30 days of hospitalisation', 6 days", "Hospital cash\tS$100 per day in hospital, from the 3rd day, up to 30 days of hospitalisation", [], R3O, 6, "S$400"],
);
// ============ Gate #508 round 5: a bracket that holds only the row's own cap is the cap (main reads it) ============
const R5 = "Hospital cash\tS$100 per day, from the 3rd day";
ROUND2.push(
  ["R5-1 '(max 30 days)', 40 days", `${R5} (max 30 days)`, [], R3O, 40, "S$3,000"],
  ["R5-1b '(up to 30 days)', 40 days", `${R5} (up to 30 days)`, [], R3O, 40, "S$3,000"],
  ["R5-1c '(maximum 30 days)', 6 days", `${R5} (maximum 30 days)`, [], R3O, 6, "S$400"],
  ["R5-1d '(30 days max)', 40 days", `${R5} (30 days max)`, [], R3O, 40, "S$3,000"],
  ["R5-1e '(max 30 days per stay)', 40 days", `${R5} (max 30 days per stay)`, [], R3O, 40, "S$3,000"],
  ["R5-1f '(up to 30 days per policy year)', 40 days", `${R5} (up to 30 days per policy year)`, [], R3O, 40, "S$3,000"],
  ["R5-1g 'S$100 per day (max 30 days)' with no waiting words, from the first day, 40 days", "Hospital cash\tS$100 per day, from the first day (max 30 days)", [], { value: 100, maxDays: 30, fromDay: 1 }, 40, "S$3,000"],
  ["R5-1h 'Hospital cash (per life assured)' is each person's own cap (main reads it), 40 days", R3W.replace("Hospital cash", "Hospital cash (per life assured)"), [], { ...R3O, benefit: "Hospital cash (per life assured)" }, 40, "S$3,000"],
  // Round 6: the full period list, "per life", "of hospitalisation" and a footnote mark in the cap bracket (main reads them).
  ...["max 30 days per any one accident", "max 30 days per stay, per life", "max 30 days*", "max 30 days per hospitalisation", "max 30 days per sickness or accident",
    "max 30 days in any one policy year", "up to a maximum of 30 days", "maximum 30 days of hospitalisation", "up to 30 days in hospital", "up to 30 days per stay*", "max 30 days per event"]
    .map((b) => [`R6-1 '(${b})', 40 days`, `${R5} (${b})`, [], R3O, 40, "S$3,000"] as [string, string, string[], WrapOpts, number, string | null]),
  ["R6-2 '(max 30 days per stay overseas)' stays a condition: none", `${R5} (max 30 days per stay overseas)`, [], R3O, 40, null],
  ["R5-2c 'Hospital cash (Child)' stays a condition: none", R3W.replace("Hospital cash", "Hospital cash (Child)"), [], { ...R3O, benefit: "Hospital cash (Child)" }, 40, null],
  ["R5-2 '(max 30 days, accident only)' stays a condition: none", `${R5} (max 30 days, accident only)`, [], R3O, 40, null],
  ["R5-2b '(up to 30 days for all lives)' stays a condition: none", `${R5} (up to 30 days for all lives)`, [], R3O, 40, null],
);
// ============ Gate #513 round 1 ============
// NEW-HIGH 1 (regression vs #508 and main): ordinary period and verb wording keeps main's figure.
const Q1 = (terms: string, name = "Hospital cash") => `${name}\tS$100 per day${terms}`;
for (const [what, terms] of [
  ["of hospital confinement, maximum", " of hospital confinement, from the 3rd day, maximum 30 days"],
  ["for a maximum of", ", from the 3rd day, for a maximum of 30 days"],
  ["per hospitalisation", ", from the 3rd day, up to 30 days per hospitalisation"],
  ["per hospitalization", ", from the 3rd day, up to 30 days per hospitalization"],
  ["per illness", ", from the 3rd day, up to 30 days per illness"],
  ["per any one illness", ", from the 3rd day, up to 30 days per any one illness"],
  ["per sickness", ", from the 3rd day, up to 30 days per sickness"],
  ["per sickness or accident", ", from the 3rd day, up to 30 days per sickness or accident"],
  ["per event", ", from the 3rd day, up to 30 days per event"],
  [", per insured", ", from the 3rd day, up to 30 days, per insured"],
  ["per life", ", from the 3rd day, up to 30 days per life"],
  ["per person", ", from the 3rd day, up to 30 days per person"],
  ["maximum N days", ", from the 3rd day, maximum 30 days"],
  ["max. N days", ", from the 3rd day, max. 30 days"],
  ["of hospitalisation", " of hospitalisation, from the 3rd day, up to 30 days"],
  ["in hospital", " in hospital, from the 3rd day, up to 30 days"],
  ["while hospitalised", " while hospitalised, from the 3rd day, up to 30 days"],
  ["in any one hospital", " in any one hospital, from the 3rd day, up to 30 days"],
  ["payable to the policyholder", ", from the 3rd day, payable to the policyholder, up to 30 days"],
  ["per stay of the policy", ", from the 3rd day, up to 30 days per stay of the policy"],
] as const) ROUND2.push([`Q1 '${what}' keeps main's figure, 40 days`, Q1(terms), [], R3O, 40, "S$3,000"]);
ROUND2.push(["Q1b 'Hospital cash benefit for the insured' keeps main's figure, 40 days", Q1(", from the 3rd day, up to 30 days per stay", "Hospital cash benefit for the insured"), [], { ...R3O, benefit: "Hospital cash benefit for the insured" }, 40, "S$3,000"]);
ROUND2.push(["Q1c 'Ward cash' keeps main's figure, 40 days", Q1(", from the 3rd day, up to 30 days per stay", "Ward cash"), [], { ...R3O, benefit: "Ward cash" }, 40, "S$3,000"]);
// Still none: a place or cause after the period.
ROUND2.push(["Q1d '…per day in a hospital in Singapore…': none", Q1(" in a hospital in Singapore, from the 3rd day, up to 30 days"), [], R3O, 40, null]);
ROUND2.push(["Q1e '…of hospitalisation abroad…': none", Q1(" of hospitalisation abroad, from the 3rd day, up to 30 days"), [], R3O, 40, null]);
// HIGH 2: a name that carries a person, plan, relation, cause or place gives none on every row.
for (const name of ["Accidental hospital cash", "Child hospital income", "Spouse hospital cash", "Juvenile hospital cash", "Dependant hospital cash",
  "Hospital cash - accident", "Hospital cash - spouse", "Hospital cash - accident (HCA)", "Child hospital cash (CHC)", "Accident hospital cash (AHC)",
  "Maternity hospital cash", "Cancer hospital cash", "Hospital cash rider Life 2", "Hospital cash Plan B", "Hospital cash - Deluxe", "Overseas hospital cash"])
  ROUND2.push([`Q2 name '${name}': none`, Q1(", from the 3rd day, up to 30 days per stay", name), [], { ...R3O, benefit: name }, 40, null]);
for (const name of ["Daily hospital income", "Hospital income benefit (HIB)", "Hospitalisation daily allowance"])
  ROUND2.push([`Q2b control name '${name}' keeps main's figure`, Q1(", from the 3rd day, up to 30 days per stay", name), [], { ...R3O, benefit: name }, 40, "S$3,000"]);
// Gate #513 round 2 NEW-HIGH: ordinary names, brands and bracketed currency, per-day or footnote numbers keep main's figure.
for (const name of ["Hospital Stay Benefit", "Kestrel Hospital Cash", "Hospital Cash Plus", "Enhanced Hospital Cash", "Daily Room and Board Benefit",
  "Hospital Cash Benefit (Per Day)", "Hospital cash (S$)", "Hospital cash (3)", "Hospital cash*", "Ward cash", "A Benefit of"])
  ROUND2.push([`Q3 name '${name}' keeps main's figure`, Q1(", from the 3rd day, up to 30 days per stay", name), [], { ...R3O, benefit: name }, 40, "S$3,000"]);
// Still none: a qualifier next to a brand, a tier with a letter, and an unknown name with no stay-benefit core.
for (const name of ["Kestrel Child Hospital Cash", "Hospital Cash Option B", "Kestrel Accident Hospital Cash", "Hospital cash (Child)", "Recovery payment"])
  ROUND2.push([`Q3b name '${name}': none`, Q1(", from the 3rd day, up to 30 days per stay", name), [], { ...R3O, benefit: name }, 40, null]);
// A household member's name in the row's name: that person's row, never worked out as another's.
test("stay-wrap Q2 name 'Mei Ling hospital cash' with Lee Mei Ling in the household: none", () => {
  const h = household([{ person: TAN, row: Q1(", from the 3rd day, up to 30 days per stay", "Mei Ling hospital cash"), value: 100, maxDays: 30, fromDay: 3, benefit: "Mei Ling hospital cash" },
    { person: LEE, row: "Hospital cash\tS$50 per day in hospital", value: 50, maxDays: null }]);
  const a = ask(h, TAN, ["I was in hospital for 40 days. How much will I get?"], { perDay: { stayDays: 40 } });
  assert.ok(a.row);
  assert.equal(stayCard(a)?.amount?.text ?? null, null, JSON.stringify(a.kept));
});
for (const [name, row, below, o, days, want] of ROUND2) test(`stay-wrap ${name}`, () => {
  const h = household([{ person: TAN, row, below, value: o.value, maxDays: o.maxDays, fromDay: o.fromDay ?? null, currencyLine: o.currencyLine, above: o.above, benefit: o.benefit }]);
  const a = ask(h, TAN, [`I was in hospital for ${days} days. How much will I get?`], { perDay: { stayDays: days } });
  assert.ok(a.row, `no daily row: ${JSON.stringify(h.rows.map((r) => [r.benefit, r.pays, r.figure.kind]))}`);
  assert.equal(stayCard(a)?.amount?.text ?? null, want, JSON.stringify(a.kept.map((s) => [s.text, s.amount?.text ?? null, s.basis ?? null])));
});
for (const [name, other] of [["A6 'Recovery cash'", "Recovery cash\tS$80 per day at home"], ["Q9 'Recovery and rehabilitation benefit'", "Recovery and rehabilitation benefit\tS$80 per day"]] as const)
  test(`stay-wrap R2-4 ${name}: a day cap printed after another benefit's row is never stated as this row's`, () => {
    const h = household([{ person: TAN, row: OROW, below: [other, "Maximum days\t30 days per stay", OWAIT], value: 150, maxDays: null }]);
    const a = ask(h, TAN, ["I was in hospital for 5 days. How much will I get?"], { perDay: { stayDays: 5 } });
    const st = stayCard(a);
    assert.equal(st?.amount?.text, "S$450", JSON.stringify(a.kept));
    assert.doesNotMatch(st!.basis ?? "", /at most 30 days per stay/, JSON.stringify(st));
    assert.match(st!.basis ?? "", /may be that row's/, JSON.stringify(st));
  });

// ============ Report ============
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`);
console.log(`stay-days-test: ${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed`);
if (results.some((r) => !r.ok)) process.exit(1);

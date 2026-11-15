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
  ["excluding the first N days", "Hospital cash\tS$50 per day, excluding the first 2 days, up to 30 days per policy year", []],
  ["first N days not payable", "Hospital cash\tS$50 per day, up to 30 days per policy year (first 2 days not payable)", []],
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
    { person: LEE, row: "Ward allowance\tS$60 per day, payable from the 3rd day, up to 30 days per policy year", value: 60, maxDays: 30, fromDay: 3 }]);
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

// ============ Report ============
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`);
console.log(`stay-days-test: ${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed`);
if (results.some((r) => !r.ok)) process.exit(1);

/** A daily benefit on a family schedule (live run 13 Nov): a family personal accident schedule in pounds names three insured
 * people, each with their own sum insured, over one table of benefits for all of them. Asked "Ngozi was in hospital for 5
 * days, how much hospital cash can she get?", the answer said the daily figure was "quoted below as the policy prints it"
 * and "quoted here from the policy", and nothing was shown below.
 *
 * What this pins down:
 * - the hospital cash row is read with its currency from its own printed figure ("GBP 50" or "£50"): a row has no
 *   currency field of its own, and none is needed. A bare "$" in a pound policy names none, as before;
 * - the row is withheld for every person because the schedule prints it once for three people and never says it is each
 *   person's figure (assemble.ts whoseRows, NOT_TOLD_WHY): a figure for one life is never shown for another. Printed under
 *   a "per insured person" column and read as each named person's, the same row reaches each of them as a daily card;
 * - a sentence that promises an amount or figure "quoted below" or "here" never survives when no amount is shown: a clause
 *   that only promises the quote goes, and "the amount quoted below" in a sentence that says something of it is said of
 *   the benefit, as "shown below" is, so no condition or fact is lost (chat.ts QUOTE_POINTER).
 * No model, database or network.
 *   npm run benefit-table:daily-row-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, NOT_TOLD_WHY, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { chatRows, dropAmountPointers, withoutPointers } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import type { SimpleModel } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "dddddddd-0000-4000-8000-0000000000aa";
const PRODUCT = "FAMILY PERSONAL ACCIDENT POLICY";
const NGOZI = "Ngozi Okafor", DANIEL = "Daniel Okafor", GRACE = "Grace Okafor";
const page1 = `Harbourline Assurance plc\n${PRODUCT} - SCHEDULE\nPolicy number: HPA-55120-K\tPeriod of insurance: 1 March 2026 to 28 February 2027\tCurrency\nof this policy: Pounds sterling (GBP)\n`
  + `Insured person\tRelationship\tDate of birth\tSum Insured\n${NGOZI}\tPolicyholder\t14/06/1984\tGBP 100,000\n${DANIEL}\tSpouse\t02/11/1982\tGBP 80,000\n${GRACE}\tChild\t09/04/2017\tGBP 20,000\n`
  + "Annual premium: GBP 312.00, payable by monthly direct debit of GBP 26.00.";
/** The table of benefits, with the hospital cash line as given and the heading of its amount column. */
const page2 = (cash: string, column = "Amount payable") => `TABLE OF BENEFITS (all amounts in GBP)\nSection\tBenefit\t${column}\n`
  + "2\tPermanent total disablement\t100% of the Sum Insured\n"
  + `5\tHospital cash\t${cash}\n`
  + "6\tMedical expenses\tUp to GBP 2,500 per accident, after an excess of GBP 100 per claim\n"
  + "Exclusions: injury while taking part in motor racing or professional sport; self-inflicted injury.";
const CASH = "GBP 50 per day in hospital, payable from the third consecutive day, up to 30 days per accident";

const cover = (person: string, sum: number, quote: string) => ({ person, product: PRODUCT, cover: "Personal accident", plan: null, policyNumber: "HPA-55120-K", sumInsured: sum,
  premium: null, premiumFrequency: null, asOf: null, startDate: "1 March 2026", endDate: "28 February 2027", page: 1, quote });
const base = { period: null, basis: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, page: 2 };
function read(cash: string, opts: { column?: string | null; forWhom?: string; only?: string } = {}) {
  const p1 = opts.only ? page1.split("\n").filter((l) => !/^(?:Daniel|Grace) /.test(l)).join("\n") : page1;
  const pages = [{ page: 1, text: p1 }, { page: 2, text: page2(cash, opts.column ?? "Amount payable") }];
  const src: SourceDoc = { id: DOC, name: "schedule.pdf", readable: true, pages };
  const column = opts.column ?? null;
  const benefits = [
    { ...base, column: null, section: "2", benefit: "Permanent total disablement", pays: "percent", value: 100, percentOf: "sum_insured", quote: "2\tPermanent total disablement\t100% of the Sum Insured", conditions: [] },
    // The stored reading's shape: no currency of its own, a first paid day and most days.
    { ...base, column, section: "5", benefit: "Hospital cash", pays: "per_day", value: 50, fromDay: 3, maxDays: 30, quote: `5\tHospital cash\t${cash}`,
      conditions: ["payable from the third consecutive day, up to 30 days per accident"], ...(opts.forWhom ? { forWhom: opts.forWhom } : {}) },
    { ...base, column: null, section: "6", benefit: "Medical expenses", pays: "up_to", value: 2500, quote: "6\tMedical expenses\tUp to GBP 2,500 per accident, after an excess of GBP 100 per claim", conditions: ["after an excess of GBP 100 per claim"] },
  ];
  const r = checkReading(src, { document: { kind: "personal_proof", product: PRODUCT, insurer: "Harbourline Assurance plc", namedPeople: opts.only ? [opts.only] : [NGOZI, DANIEL, GRACE], plan: null, periodFrom: "1 March 2026", periodTo: "28 February 2027" },
    covers: [cover(NGOZI, 100000, `${NGOZI}\tPolicyholder\t14/06/1984\tGBP 100,000`), cover(DANIEL, 80000, `${DANIEL}\tSpouse\t02/11/1982\tGBP 80,000`), cover(GRACE, 20000, `${GRACE}\tChild\t09/04/2017\tGBP 20,000`)]
      .filter((c) => !opts.only || c.person === opts.only),
    benefits });
  return { r, pages };
}
const family: FamilyMember[] = [{ id: "p1", display_name: NGOZI }, { id: "p2", display_name: DANIEL }, { id: "p3", display_name: GRACE }];
const KEY = coverKeyOf({ product: PRODUCT, cover: "Personal accident", plan: null, riderOf: null });
const tableOf = (r: ReturnType<typeof read>["r"]) => assembleTable([r], family, [...new Set(r.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: KEY, why: "the schedule's benefits" })), [], new Date("2026-11-13T04:00:00Z"));
const cashOf = (r: ReturnType<typeof read>["r"]) => r.benefits.find((b) => b.benefit === "Hospital cash");
const household = (pages: { page: number; text: string }[]): Household => ({ accountId: "11111111-1111-4111-8111-111111111111",
  members: [{ name: NGOZI, relationship: "self" }, { name: DANIEL, relationship: "spouse" }, { name: GRACE, relationship: "child" }],
  documents: [{ policyId: DOC, name: "schedule.pdf", insurer: "Harbourline Assurance plc", productName: PRODUCT, policyNumber: "HPA-55120-K", documentType: null, documentRole: null, effectiveDate: null,
    expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: [NGOZI, DANIEL, GRACE], supersededAt: null, processingStatus: "ready", pages } as never] });

async function main() {
  await test("the daily row's currency is its own printed figure's; a bare $ in a pound policy names none", () => {
    assert.equal(cashOf(read(CASH).r)?.currency, "GBP");
    assert.equal(cashOf(read(CASH.replace("GBP 50", "£50")).r)?.currency, "GBP");
    assert.equal(cashOf(read(CASH.replace("GBP 50", "$50")).r)?.currency ?? null, null, "a bare $ under a pound table names no currency");
    assert.equal(cashOf(read(CASH).r)?.fromDay, 3);
    assert.equal(cashOf(read(CASH).r)?.maxDays, 30);
  });
  await test("one table printed once for three people that never says the figure is each person's: shown for no one, and said so", () => {
    const t = tableOf(read(CASH).r);
    for (const p of t.people) assert.ok(!p.rows.some((x) => x.benefit === "Hospital cash"), p.name);
    assert.ok(t.unlinkedSections.some((u) => u.section.section === "5" && u.why === NOT_TOLD_WHY));
    // A share of each person's own sum is each person's own figure.
    for (const p of t.people) assert.ok(p.rows.some((x) => x.benefit === "Permanent total disablement" && x.figure.kind === "worked_out"), p.name);
  });
  await test("a schedule that insures one person: her daily row reaches her chat rows as a GBP 50 daily card with its days", () => {
    for (const cash of [CASH, CASH.replace("GBP 50", "£50")]) {
      const { r, pages } = read(cash, { only: NGOZI });
      const rows = chatRows(tableOf(r), household(pages));
      const row = rows.find((x) => x.person.startsWith(NGOZI) && x.benefit === "Hospital cash");
      assert.ok(row, `${cash}: Ngozi has the hospital cash row`);
      assert.deepEqual(row!.figure, { kind: "printed", amount: 50, currency: "GBP", unit: "per_day", period: null }, cash);
      assert.equal(row!.fromDay, 3);
      assert.equal(row!.maxDays, 30);
      assert.ok(!rows.some((x) => !x.person.startsWith(NGOZI)), "no one else");
    }
  });
  await test("words that promise a quote below or here go; the rest of the sentence stays; plain 'quoted' stays", () => {
    assert.equal(withoutPointers("The benefit table has no row for hospital cash, so the daily figure is quoted below as the policy prints it."), "The benefit table has no row for hospital cash.");
    assert.equal(withoutPointers("The pages show no figure for this benefit in Ngozi's benefit table, so the daily amount is quoted here from the policy, not given as a card."),
      "The pages show no figure for this benefit in Ngozi's benefit table.");
    assert.equal(withoutPointers("Hospital cash pays a daily amount, which is shown below."), "Hospital cash pays a daily amount.");
    assert.equal(withoutPointers("The daily figure is quoted below."), "");
    assert.equal(withoutPointers("The limits are cited here as the schedule prints them."), "");
    // A sentence that says something of the amount quoted keeps it, said of the benefit (Critic+TE on #473).
    const said: [string, string][] = [
      ["The amount quoted below is not paid if the injury was self-inflicted.", "This benefit is not paid if the injury was self-inflicted."],
      ["The limit quoted here is per policy year, not per claim.", "This benefit is per policy year, not per claim."],
      ["If Ngozi is admitted, the daily figure quoted below is paid for up to 30 days per accident.", "If Ngozi is admitted, the daily benefit is paid for up to 30 days per accident."],
      ["The limits cited here are reduced by any amount paid under section 6.", "These benefits are reduced by any amount paid under section 6."],
      ["The amounts quoted below are paid in addition to the death benefit.", "These benefits are paid in addition to the death benefit."],
      ["Physiotherapy is covered, with the limit quoted in full below.", "Physiotherapy is covered."],
      // A benefit's rate is its amount too (gate round 2 on #473, M1).
      ["The daily rate quoted below applies only from the 3rd day of hospitalisation.", "The daily benefit applies only from the 3rd day of hospitalisation."],
      ["The daily rate quoted below is paid from the 3rd day, up to 30 days.", "The daily benefit is paid from the 3rd day, up to 30 days."],
      ["The daily rates quoted here apply per accident.", "The daily benefits apply per accident."],
      // As the object of what is said, it is a kind of figure (L1); what the figure is said to do stays (L2).
      ["Medical expenses are covered up to the limit quoted below, after an excess of GBP 100.", "Medical expenses are covered up to a limit, after an excess of GBP 100."],
      ["Hospital cash is paid as the figure quoted below for each day after the second.", "Hospital cash is paid as a set amount for each day after the second."],
      ["Hospital cash is paid at the daily rate quoted below.", "Hospital cash is paid at a daily rate."],
      ["The figure is quoted below and paid from day 3.", "This benefit is paid from day 3."],
      // Gate round 3 on #473: a limit keeps its period (N1), "is" stays only before what is done to it (N2), and "benefit"
      // before the noun is never said twice (N3).
      ["Medical expenses are paid up to the monthly limit quoted here.", "Medical expenses are paid up to a monthly limit."],
      ["Hospital cash is paid up to the daily limit quoted below, for at most 30 days.", "Hospital cash is paid up to a daily limit, for at most 30 days."],
      ["The cash rate is quoted below and does not apply to day surgery.", "The cash benefit does not apply to day surgery."],
      ["The daily amount is quoted below and is halved for a child.", "The daily benefit is halved for a child."],
      ["The benefit rate quoted below is paid from day 3.", "This benefit is paid from day 3."],
      ["The benefit amount quoted below is reduced by any earlier claim.", "This benefit is reduced by any earlier claim."],
      ["Hospital cash is paid at the benefit rate quoted below.", "Hospital cash is paid at a rate."],
    ];
    for (const [s, want] of said) assert.equal(withoutPointers(s), want, s);
    // Words said to be quoted are a point about words, and a premium or exchange rate is no benefit amount: kept whole.
    for (const s of ["Your premium rates quoted below are guaranteed for 5 years.", "The premium rate quoted here is for a non-smoker.", "The interest rate quoted below is not guaranteed.",
      "The tax rate quoted here is set by law.", "The rate quoted below is the one on the day of the claim.",
      "The exchange rate quoted here is the one on the day of the claim.", "The claims rule quoted below requires notice within 30 days.", "See the wording below for the daily amount.", "The insurer quoted a premium at renewal.", "Hospital cash is paid as quoted in your schedule.", "A stay below three days is not paid."]) assert.equal(withoutPointers(s), s);
  });
  await test("with an amount shown and none left out, a promise of a quote below stays: the card is below", () => {
    const answer = { summary: "Hospital cash pays a daily amount.", bottomLine: "Hospital cash pays a daily amount; the amount is quoted below.", statements: [{ text: "Hospital cash.", amount: { text: "GBP 50" } }] };
    dropAmountPointers(answer, ["Hospital cash."], false);
    assert.equal(answer.bottomLine, "Hospital cash pays a daily amount; the amount is quoted below.");
    dropAmountPointers(answer, ["Hospital cash."], true);
    assert.equal(answer.bottomLine, "Hospital cash pays a daily amount.");
  });
  await test("the live answer: no row for her, the amount is left out, and no sentence promises a quote or figure below or here", async () => {
    const { r, pages } = read(CASH);
    const t = tableOf(r);
    const house = household(pages);
    const point = (kind: string, text: string, quote: string | null, extra: Record<string, unknown> = {}) => ({ kind, text, person: NGOZI, document: quote ? "D1" : null, quote, amount: null, percentOf: null,
      conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, rowBenefit: null, eventFit: null, waiting: null, period: null, ...extra });
    const reply = { bottomLine: "Ngozi's policy has a hospital cash benefit that pays a daily amount from the third day in hospital, for up to 30 days per accident.", nextSteps: [], question: null, statements: [
      point("fact", "The benefit table has no row for hospital cash, so the daily figure is quoted below as the policy prints it.", "payable from the third consecutive day, up to 30 days per accident"),
      point("amount", "Hospital cash pays a daily amount.", `Hospital cash\t${CASH}`, { amount: "GBP 50", perDay: { stayDays: 5 }, rowBenefit: "Hospital cash", eventFit: "on_list" }),
      point("uncertainty", "The pages show no figure for this benefit in Ngozi's benefit table, so the daily amount is quoted here from the policy, not given as a card.", null),
    ] };
    const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() { return { json: reply, stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
    const q = "Ngozi was in hospital for 5 days after a car accident. How much hospital cash can she get?";
    const context = { request: { accountId: house.accountId, familyMemberId: null, question: q, submittedQuestion: q }, family: [], people: [],
      conversation: { id: "c1", account_id: house.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } }, token: {}, holdings: [] } as unknown as ChatContext;
    const saved: { answer: { bottomLine?: string; summary: string; statements?: { text: string; amount: unknown }[] } }[] = [];
    await runSimpleChat(context, {}, { model, household: async () => house, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false,
      table: async () => t, today: () => new Date("2026-11-13T04:00:00Z") });
    const a = saved[0].answer;
    const texts = [a.bottomLine ?? a.summary, ...(a.statements ?? []).map((s) => s.text)];
    assert.ok(!(a.statements ?? []).some((s) => s.amount), "no card: the row is no one's");
    for (const x of texts) assert.ok(!/\b(?:quoted|cited)\s+(?:below|here)\b|\bbelow\b/i.test(x), `promises what is not shown: ${x}`);
    assert.ok(texts.includes("The benefit table has no row for hospital cash."), texts.join(" | "));
    assert.ok(texts.includes("The pages show no figure for this benefit in Ngozi's benefit table."), texts.join(" | "));
    assert.ok(!JSON.stringify(a).includes("GBP 50"), "never an amount the table does not give her");
  });

  console.log(`${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`FAIL ${f}`);
  if (failures.length) process.exit(1);
}
void main();

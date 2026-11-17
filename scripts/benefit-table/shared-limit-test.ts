/** Scripted tests: a limit its words say is shared by the insurer's other policies on the same life ("under this Policy and
 * all Policies We have issued covering the same Life Assured shall not exceed S$1,050,000") is never shown as the person's
 * own cover; its card says it is that shared limit (launch checklist C2, release-candidate run 17 Nov). The person's own
 * figures stay. Made-up households only. No model, database or network.
 *   npm run benefit-table:shared-limit-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { acrossPolicies, amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const NOW = new Date("2026-11-17T08:00:00Z");
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const ACC = "55555555-5555-4555-8555-555555555556";
const DOC = "eeeeeeee-0000-4000-8000-0000000000a1";
const NAME = "Rowan Hartley";
const product = "Kestrel Critical Illness Plus";
const ben = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
  cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });

function household(limitSentence: string) {
  const page1 = `Kestrel Assurance Ltd\nPOLICY SCHEDULE\nLife Assured\tSum Assured\n${NAME}\tS$300,000`;
  const page2 = ["2. Critical Illness Benefit", "We will pay 100% of the Sum Assured if the Life Assured is diagnosed with a Critical Illness.", limitSentence].join("\n");
  const d: Household["documents"][number] = { policyId: DOC, name: `${product}.pdf`, insurer: "Kestrel Assurance Ltd", productName: product, policyNumber: null, documentType: null,
    documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: [NAME], supersededAt: null,
    processingStatus: "ready", pages: [page1, page2].map((text, i) => ({ page: i + 1, text })) };
  const house: Household = { accountId: ACC, members: [{ name: NAME, relationship: "self" }], documents: [d] };
  const family: FamilyMember[] = [{ id: "m0", display_name: NAME, relationship: "self" }];
  const src: SourceDoc = { id: d.policyId, name: d.name, readable: true, pages: d.pages };
  const figure = /S\$[\d,]+/.exec(limitSentence)![0];
  const reading = checkReading(src, { document: { kind: "personal_proof", product, insurer: d.insurer, namedPeople: [NAME], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: NAME, product, cover: product, plan: null, riderOf: null, policyNumber: null, premium: null, premiumFrequency: null, asOf: null,
      startDate: null, endDate: null, page: 1, sumInsured: 300000, quote: `${NAME}\tS$300,000` }],
    benefits: [
      ben({ section: "Critical Illness Benefit", benefit: "Critical Illness", pays: "percent", value: 100, percentOf: "sum_insured", quote: "We will pay 100% of the Sum Assured" }),
      ben({ section: "Critical Illness Benefit", benefit: "most payable for all Early Stage Critical Illness claims", pays: "amount", basis: "up_to", value: Number(figure.replace(/[^\d]/g, "")), currency: "SGD",
        quote: limitSentence }),
    ] } as never);
  const key = coverKeyOf({ product, cover: product, plan: null, riderOf: null });
  const links = [...new Set(reading.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: key, why: "the policy's benefits" }));
  const table = assembleTable([reading], family, links, [], NOW);
  return { house, rows: chatRows(table, house) };
}
function answer(h: ReturnType<typeof household>, question: string) {
  const statements = h.rows.filter((r) => r.figure.kind !== "none").map((row) => ({ kind: "amount", text: row.benefit, person: NAME, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "no_event", waiting: null, period: { from: "", to: "", eventOn: "" }, multiplierNote: "" }));
  const raw = { bottomLine: `${NAME} has critical illness cover.`, nextSteps: [], question: null, statements };
  const fromRows = amountsFromRows(raw, h.rows, h.house, NOW, question, [], false);
  const { answer: a } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(a.statements ?? [], fromRows.report);
  return kept.filter((s) => s.amount).map((s) => `${s.amount!.text} | ${s.text}`);
}

const SHARED = "The most We will pay in total for all Early Stage Critical Illness claims under this Policy and all Policies We have issued covering the same Life Assured shall not exceed S$1,050,000.";
test("a limit shared by all the insurer's policies on the same life is labelled as that, never as the person's cover; their own S$300,000 stays", () => {
  const h = household(SHARED);
  const cards = answer(h, "What critical illness cover does Rowan have?");
  const own = cards.find((c) => c.startsWith("S$300,000"));
  assert.ok(own, cards.join(" || "));
  const shared = cards.filter((c) => /1,050,000/.test(c));
  assert.equal(shared.length, 1, cards.join(" || "));
  for (const c of shared) {
    assert.match(c, /under this and all its other policies on the same person together, not this policy's own cover/);
    assert.doesNotMatch(c, /up to this limit/);
  }
});
test("a policy's own limit keeps its card as before", () => {
  const h = household("The most We will pay in total for all Early Stage Critical Illness claims under this Policy shall not exceed S$150,000.");
  const cards = answer(h, "What critical illness cover does Rowan have?");
  assert.ok(cards.some((c) => c.startsWith("S$300,000")), cards.join(" || "));
  for (const c of cards.filter((c) => /150,000/.test(c))) assert.doesNotMatch(c, /other policies/, c);
});
test("acrossPolicies: only the sentence printing the row's own figure, as a shared limit (Critic on #523)", () => {
  const row = (x: string, amount = Number(/S\$([\d,]+)/.exec(x)![1].replace(/,/g, ""))) =>
    ({ source: { excerpt: x } as never, figure: { kind: "printed", amount, currency: "SGD", unit: "up_to", period: null } as never });
  for (const yes of [SHARED, "Limit across all policies: S$2,000,000", "the total under this plan and any other plan covering the same life is limited to S$500,000",
    "The most we pay under all policies issued on the same life assured, in total, is S$1,000,000.",
    "The total payable under all policies issued by the Company on the life of the Life Assured shall not exceed S$1,050,000.",
    "The maximum under all policies with us is S$1,050,000.", "The most we pay under this policy and all other policies we have issued on the same life, in total, is S$1,050,000.", "The most payable under all Kestrel policies on the life of the Life Assured is S$1,050,000.",
    "The aggregate limit under all policies issued by us is S$1,050,000.", "In total, all Kestrel Plans on the same life will pay no more than S$1,050,000.",
    "All Kestrel policies on the life of the Life Assured are limited to S$1,050,000 in total."]) assert.ok(acrossPolicies(row(yes)), yes);
  for (const no of ["The most we pay for all claims under this benefit is S$500,000 in total.", "Aggregate limit per policy year S$100,000",
    "This policy does not cover claims paid under any other policy. Limit S$5,000.", "Overall limit for all early stage claims: S$100,000",
    "We will pay S$200,000. No benefit is payable under this policy if a claim has been paid under any other policy we have issued on the same life.",
    "Medical expenses up to S$5,000, less any amount paid under this policy or any other policy we have issued.",
    "Hospital income S$20,000 in total; benefits are not combined with any other policy.",
    "We will pay a lump sum of S$300,000 under this policy. The most under this policy and all other policies we have issued on the same life shall not exceed S$3,000,000.",
    // A policy's own limit, in words close to the shared ones (Critic on #523, round 2).
    "The maximum payable for any claim under this policy issued by the Company is S$100,000.", "The maximum for any claim under this policy on the life of the Life Assured is S$200,000.",
    "The most we pay for any benefit under this plan with us is S$150,000 in total.", "The maximum payable under any policy we have issued for this benefit is S$90,000.",
    // Wording that keeps the policy's own limit apart from other policies (Critic on #523, round 3).
    "This benefit of up to S$100,000 is payable in addition to any other policy we have issued.", "We will pay up to S$100,000 irrespective of all other policies with us.",
    "The maximum benefit is S$100,000, regardless of any other policy issued by the Company on the life of the Life Assured.",
    "The most we pay under this policy is S$100,000; any other policy we have issued may also pay.", "The total payable is S$100,000, separate from all other plans with the Company.",
    "Up to S$100,000 in total, combined with any other policy.", "Maximum S$1,050,000 per Life Assured for all plans in force with the Company.",
    // Words about other policies after the figure never make it shared (Critic on #523, round 4).
    "S$100,000 in total, excluding any amount recovered from any other policy we have issued.", "This S$100,000 limit is distinct from all other policies with us.",
    "Up to S$100,000, on top of any amount paid from all other policies we have issued.", "The limit is S$100,000 and is not reduced for amounts paid under any other policy we have issued.",
    "We pay up to S$100,000 even if a claim is also made under any other policy we have issued.", "The maximum is S$100,000, without regard to benefits under all other policies with us.",
    "The most is S$100,000, plus whatever is paid under any other policy we have issued.", "Regardless of all other policies with us, the maximum is S$100,000.",
    // An opening clause about other policies sets this policy apart (Critic on #523, round 5).
    "Unlike benefits under any other policy we have issued, the maximum here is S$100,000.", "Even if you claim under any other policy we have issued, the most we pay is S$100,000.",
    "On top of anything paid under all other policies with us, the most we pay is S$100,000.", "Whatever is paid under any other policy we have issued, this policy still pays up to S$100,000.",
    "Besides benefits under all other policies issued by the Company, we pay a maximum of S$100,000.", "Excluding amounts paid under any other policy we have issued, the total we pay is S$100,000.",
    // The policies as the subject, each with its own limit (Critic on #523, round 6).
    "This policy and all other policies we have issued are separate; the most this policy pays is S$100,000.", "This policy and all other policies with us pay separately, up to S$100,000 each.",
    "This policy and all other plans with the Company are independent and the maximum under this policy is S$100,000.",
    // A limit per policy, said after the figure (TE on #523).
    "The most We will pay under this Policy and all other Policies We have issued covering the same Life Assured is S$500,000 for each Policy."])
    assert.ok(!acrossPolicies(row(no)), no);
  // One sentence printing the own sum and the shared cap: the own sum is never labelled (Critic on #523, round 2).
  for (const t of ["Total Permanent Disability benefit of S$500,000, provided that the total payable under this policy and all other policies issued by us on the same life shall not exceed S$3,000,000.",
    "Sum assured S$500,000 (the total under this and all other policies on the life of the insured is limited to S$3,000,000)."]) assert.ok(!acrossPolicies(row(t, 500000)), t);
  // The own sum in an excerpt that also prints a shared limit stays the policy's own.
  assert.ok(!acrossPolicies(row("Total Permanent Disability Benefit S$500,000. This policy and all other policies we have issued on the same life shall not exceed S$3,000,000.", 500000)));
  assert.ok(acrossPolicies(row("Total Permanent Disability Benefit S$500,000. This policy and all other policies we have issued on the same life shall not exceed S$3,000,000.", 3000000)));
});
test("a condition about other policies never relabels the row's own figure", () => {
  const h = household("The most We will pay in total for all Early Stage Critical Illness claims under this Policy shall not exceed S$150,000. Benefits are not combined with any other policy we have issued.");
  for (const c of answer(h, "What critical illness cover does Rowan have?")) assert.doesNotMatch(c, /other policies/, c);
});

console.log(`benefit-table shared limit: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`FAIL ${f}`);
if (failures.length) process.exitCode = 1;

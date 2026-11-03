/** Scripted tests: a percentage row's own printed cap is kept when the percentage cannot be worked out (TE #311 round 3:
 * "25% of Sum Assured per claim, maximum RM 50,000 per claim" lost its RM 50,000 with "the row prints no sum it is a
 * percentage of", so "what can I claim" got no figure unless the model wrote the cap as its own statement). The cap is
 * shown as "Up to <cap>", with the row's conditions; the percentage is never worked out from an unknown base; a cap with no
 * currency, another row's figure, or a row on another person's page gives no amount. Made-up households in RM, S$ and £.
 * No model, database or network.
 *   npm run -s simple:row-cap-test */
import assert from "node:assert/strict";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const doc = (policyId: string, name: string, linked: string[], text: string) => ({ policyId, name, insurer: "Example Insurance", productName: name.replace(/\.pdf$/, ""), policyNumber: null,
  documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: linked, supersededAt: null, processingStatus: "ready",
  pages: [{ page: 1, text }] });
function house(members: string[], docs: ReturnType<typeof doc>[]): Household {
  return { accountId: "44444444-4444-4444-4444-444444444444", members: members.map((name, i) => ({ name, relationship: i ? "spouse" : "self" })), documents: docs } as Household;
}
/** The model's statement the TE saw: the percentage of the sum assured, quoting the row, with no cap of its own. */
function ask(h: Household, person: string, quote: string, percent: number, baseAmount = "the Sum Assured", conditions: { text: string; quote: string | null }[] = []) {
  const raw = { bottomLine: "Here is what the certificate prints.", nextSteps: [], question: null, statements: [{ kind: "amount", text: `${percent}% of the sum assured per claim, with a cap.`, person, document: "D1",
    quote, amount: null, percentOf: { percent, baseAmount, baseDocument: null, baseQuote: null }, conditions, alternativeGroup: null }] };
  const { answer, report } = verifyAnswer(h, readModelAnswer(raw)!, ["I've just been diagnosed with early stage cancer, what can I claim?"]);
  const st = answer.statements ?? [];
  return { amounts: st.filter((s) => s.amount).map((s) => `${s.personName}: ${s.amount!.text}`), st, report };
}

const MY = house(["Ng Siew Lan", "Tan Wei Kiat"], [doc("a1", "Early CI Certificate SL.pdf", ["Ng Siew Lan"],
  "Certificate of Insurance\nInsured: Ng Siew Lan\nPlan: Early CI Protector\nSum Assured: RM 150,000\nEarly stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim\nOverall limit for all early stage claims: RM 100,000")]);

test("RM: the row's own per-claim maximum is shown, as a cap, for the person whose certificate it is", () => {
  const r = ask(MY, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25);
  assert.deepEqual(r.amounts, ["Ng Siew Lan: Up to RM50,000"], JSON.stringify(r.st));
  // The percentage itself is never worked out from a base the row doesn't print (no RM 37,500).
  assert.ok(!JSON.stringify(r.st).includes("37,500"), JSON.stringify(r.st));
  // Nothing says an amount was left out: the cap stands for the row.
  assert.ok(!r.st.some((s) => /left out an amount/.test(s.text)), JSON.stringify(r.st));
  // The next row's overall limit is never this row's cap.
  assert.ok(!r.amounts.some((a) => /100,000/.test(a)), JSON.stringify(r.amounts));
});

test("S$: a cap on the line that continues the row's sentence is that row's cap; the row's conditions stay with it", () => {
  const sg = house(["Lim Ah Kow"], [doc("b1", "Accident Plan Certificate.pdf", ["Lim Ah Kow"],
    "Personal Accident Plan\nInsured: Lim Ah Kow\nFractures: 15% of the Sum Insured\nor up to S$50,000, whichever is lesser\nMedical expenses\tS$2,000")]);
  const r = ask(sg, "Lim Ah Kow", "Fractures: 15% of the Sum Insured", 15, "the Sum Insured", [{ text: "The lesser of the two is paid.", quote: "whichever is lesser" }]);
  assert.deepEqual(r.amounts, ["Lim Ah Kow: Up to S$50,000"], JSON.stringify(r.st));
  assert.ok((r.st.find((s) => s.amount)?.conditions ?? []).some((c) => /lesser/.test(c)), JSON.stringify(r.st));
});

test("£, another wording: 'not exceeding £25,000' on the row is kept as the cap", () => {
  const uk = house(["Oliver Hughes"], [doc("c1", "Serious Illness Cover Schedule.pdf", ["Oliver Hughes"],
    "Serious Illness Cover - schedule\nLife insured: Oliver Hughes\nAdditional cancer cover: 50% of the amount of cover, not exceeding £25,000 per claim")]);
  const r = ask(uk, "Oliver Hughes", "Additional cancer cover: 50% of the amount of cover", 50, "the amount of cover");
  assert.deepEqual(r.amounts, ["Oliver Hughes: Up to £25,000"], JSON.stringify(r.report));
});

test("negative: a cap printed with no currency gives no amount", () => {
  const h = house(["Ng Siew Lan"], [doc("d1", "Early CI Certificate.pdf", ["Ng Siew Lan"],
    "Certificate of Insurance\nInsured: Ng Siew Lan\nEarly stage critical illness: 25% of Sum Assured per claim, maximum 50,000 per claim")]);
  assert.deepEqual(ask(h, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
});

test("negative: another row's figure is never this row's cap (the cap sits on the next, labelled row)", () => {
  const h = house(["Ng Siew Lan"], [doc("e1", "Early CI Certificate.pdf", ["Ng Siew Lan"],
    "Certificate of Insurance\nInsured: Ng Siew Lan\nEarly stage critical illness: 25% of Sum Assured per claim\nOverall limit for all early stage claims: maximum RM 100,000")]);
  assert.deepEqual(ask(h, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
});

test("negative: a row printing a second figure (another limit) gives no cap", () => {
  const h = house(["Ng Siew Lan"], [doc("f1", "Early CI Certificate.pdf", ["Ng Siew Lan"],
    "Certificate of Insurance\nInsured: Ng Siew Lan\nEarly stage critical illness: 25% of Sum Assured, maximum RM 50,000 per claim and RM 100,000 overall")]);
  assert.deepEqual(ask(h, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured", 25).amounts, []);
});

test("negative: the wrong person (a certificate linked to someone else, or a page naming another life) gives no cap", () => {
  assert.deepEqual(ask(MY, "Tan Wei Kiat", "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
  const both = house(["Ng Siew Lan", "Tan Wei Kiat"], [doc("g1", "Joint Certificate.pdf", ["Ng Siew Lan", "Tan Wei Kiat"],
    "Certificate of Insurance\nInsured: Tan Wei Kiat\nEarly stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim")]);
  assert.deepEqual(ask(both, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
});

test("negative: a bare '$' cap, and a row that defines another sum insured, give no cap", () => {
  const h = house(["Lim Ah Kow"], [doc("h1", "CI Policy.pdf", ["Lim Ah Kow"],
    "Insured: Lim Ah Kow\nEarly stage illness: 25% of the Sum Insured, up to $50,000\nComa benefit: Coma sum insured will be 15% of the Sum Insured or maximum of S$50,000, whichever is the lesser")]);
  assert.deepEqual(ask(h, "Lim Ah Kow", "Early stage illness: 25% of the Sum Insured", 25).amounts, []);
  assert.deepEqual(ask(h, "Lim Ah Kow", "Coma benefit: Coma sum insured will be 15% of the Sum Insured", 15).amounts, []);
});

test("negative (TE #318): a floor, a share the household pays, a charge, or a percentage of something else is no cap", () => {
  const rows: [string, string, number][] = [
    ["Fracture: 15% of the Sum Insured or up to S$50,000, whichever is greater", "Fracture: 15% of the Sum Insured", 15],
    ["Co-insurance: 10% of each claim, capped at £3,000 per policy year", "Co-insurance: 10% of each claim", 10],
    ["Co-payment: 5% of the bill, up to S$3,000 per year", "Co-payment: 5% of the bill", 5],
    ["Excess: 1% of the Sum Insured, maximum A$500 per admission", "Excess: 1% of the Sum Insured", 1],
    ["Premium loading: 25% of standard premium, up to RM 1,200 a year", "Premium loading: 25% of standard premium", 25],
    ["Partial disability: 20% of the Sum Insured, minimum S$5,000", "Partial disability: 20% of the Sum Insured", 20],
    ["Lost luggage: 50% of the item's value, up to S$500", "Lost luggage: 50% of the item's value", 50],
  ];
  for (const [line, quote, pct] of rows) {
    const h = house(["Lim Ah Kow"], [doc("t1", "Plan Schedule.pdf", ["Lim Ah Kow"], `Insured: Lim Ah Kow\n${line}`)]);
    assert.deepEqual(ask(h, "Lim Ah Kow", quote, pct).amounts, [], line);
  }
  const cont = house(["Lim Ah Kow"], [doc("t2", "Plan Schedule.pdf", ["Lim Ah Kow"], "Insured: Lim Ah Kow\nFracture: 15% of the Sum Insured\nor up to S$50,000, whichever is higher")]);
  assert.deepEqual(ask(cont, "Lim Ah Kow", "Fracture: 15% of the Sum Insured", 15).amounts, []);
});

test("negative (Critic #318 H1/H2): a next line that is another benefit's labelled row, in any case, or a floor wording, gives no cap", () => {
  const rows: [string, string][] = [
    ["Fractures: 15% of the Sum Insured\nburns: maximum S$50,000", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured\n(Dislocation: up to S$20,000)", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured\nother injuries: up to S$10,000", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured\nand Burns: up to £5,000", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured\nplus RM 2,000 for physiotherapy", "Fractures: 15% of the Sum Insured"],
    ["Fractures: up to RM50,000 or 15% of the Sum Insured, whichever is higher", "Fractures: up to RM50,000 or 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured or up to S$50,000, whichever is greater", "Fractures: 15% of the Sum Insured"],
  ];
  for (const [text, quote] of rows) {
    const h = house(["Lim Ah Kow"], [doc("c1", "Personal Accident Plan.pdf", ["Lim Ah Kow"], `Personal Accident Plan\nInsured: Lim Ah Kow\n${text}`)]);
    assert.deepEqual(ask(h, "Lim Ah Kow", quote, 15, "the Sum Insured").amounts, [], text);
  }
  // The same rows with the cap continuing the sentence still show it.
  const ok = house(["Lim Ah Kow"], [doc("c2", "Personal Accident Plan.pdf", ["Lim Ah Kow"], "Personal Accident Plan\nInsured: Lim Ah Kow\nFractures: 15% of the Sum Insured\nmaximum S$50,000 per claim")]);
  assert.deepEqual(ask(ok, "Lim Ah Kow", "Fractures: 15% of the Sum Insured", 15, "the Sum Insured").amounts, ["Lim Ah Kow: Up to S$50,000"]);
});

test("negative: a statement with no person gives no cap", () => {
  assert.deepEqual(ask(MY, null as unknown as string, "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
});

test("no request tried to leave this machine", () => assert.deepEqual(outbound, []));
console.log(`row cap: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);

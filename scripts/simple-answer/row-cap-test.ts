/** Scripted tests: a percentage row with its own printed cap ("25% of Sum Assured per claim, maximum RM 50,000 per claim")
 * shows the lesser of the percentage of the person's own printed sum and the cap (TE #311 round 4: RM 150,000 x 25% is
 * RM 37,500, so "Up to RM 50,000" overstated the claim). The cap is shown as "Up to <cap>" only when it is the lesser for the
 * person's printed sum, or for every sum their document prints for them; when the sum cannot be found, no figure at all. A
 * cap with no currency, another row's figure, or a row on another person's page gives no amount. Made-up households in
 * RM, S$, £ and A$. No model, database or network.
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
function ask(h: Household, person: string, quote: string, percent: number, baseAmount = "the Sum Assured", conditions: { text: string; quote: string | null }[] = [], baseQuote: string | null = null) {
  const raw = { bottomLine: "Here is what the certificate prints.", nextSteps: [], question: null, statements: [{ kind: "amount", text: `${percent}% of the sum assured per claim, with a cap.`, person, document: "D1",
    quote, amount: null, percentOf: { percent, baseAmount, baseDocument: null, baseQuote }, conditions, alternativeGroup: null }] };
  const { answer, report } = verifyAnswer(h, readModelAnswer(raw)!, ["I've just been diagnosed with early stage cancer, what can I claim?"]);
  const st = answer.statements ?? [];
  return { amounts: st.filter((s) => s.amount).map((s) => `${s.personName}: ${s.amount!.text}`), st, report };
}

const MY = house(["Ng Siew Lan", "Tan Wei Kiat"], [doc("a1", "Early CI Certificate SL.pdf", ["Ng Siew Lan"],
  "Certificate of Insurance\nInsured: Ng Siew Lan\nPlan: Early CI Protector\nSum Assured: RM 150,000\nEarly stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim\nOverall limit for all early stage claims: RM 100,000")]);

test("RM: the claim pays the lesser of 25% of her printed sum assured and the cap: RM37,500, never 'Up to RM50,000'", () => {
  const r = ask(MY, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25, "RM 150,000");
  assert.deepEqual(r.amounts, ["Ng Siew Lan: RM37,500"], JSON.stringify(r.st));
  const card = r.st.find((s) => s.amount)!;
  assert.match(card.basis ?? "", /25% of Ng Siew Lan's sum insured of RM150,000/);
  assert.ok(!/RM ?50,000/.test(JSON.stringify(r.st)), JSON.stringify(r.st));
  assert.ok(!r.amounts.some((a) => /100,000/.test(a)), JSON.stringify(r.amounts));
  // The same with the model giving no figure for the base: the certificate's one sum assured is still hers.
  assert.deepEqual(ask(MY, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, ["Ng Siew Lan: RM37,500"]);
});

test("S$: with no sum insured printed for him, the cap is not shown as what he can claim (no figure, an amount is said to be left out); the row stays, with its conditions", () => {
  const sg = house(["Lim Ah Kow"], [doc("b1", "Accident Plan Certificate.pdf", ["Lim Ah Kow"],
    "Personal Accident Plan\nInsured: Lim Ah Kow\nFractures: 15% of the Sum Insured\nor up to S$50,000, whichever is lesser\nMedical expenses\tS$2,000")]);
  const r = ask(sg, "Lim Ah Kow", "Fractures: 15% of the Sum Insured", 15, "the Sum Insured", [{ text: "The lesser of the two is paid.", quote: "whichever is lesser" }]);
  assert.deepEqual(r.amounts, [], JSON.stringify(r.st));
  const row = r.st.find((s) => s.kind === "fact" && /15%/.test(s.text));
  assert.ok(row && (row.conditions ?? []).some((c) => /lesser/.test(c)), JSON.stringify(r.st));
});

test("£, another wording: 'not exceeding £25,000' with no amount of cover printed gives no figure", () => {
  const uk = house(["Oliver Hughes"], [doc("c1", "Serious Illness Cover Schedule.pdf", ["Oliver Hughes"],
    "Serious Illness Cover - schedule\nLife insured: Oliver Hughes\nAdditional cancer cover: 50% of the amount of cover, not exceeding £25,000 per claim")]);
  const r = ask(uk, "Oliver Hughes", "Additional cancer cover: 50% of the amount of cover", 50, "the amount of cover");
  // No amount of cover is printed, so 50% of it may be less than £25,000: no figure.
  assert.deepEqual(r.amounts, [], JSON.stringify(r.report));
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
    // TE #318 round 2: alternatives with a floor or no stated rule, in other wordings and languages.
    ["Fractures: 15% of the Sum Insured or up to S$50,000, the larger of the two", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured or up to S$50,000, if bigger", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured, up to S$50,000 where this exceeds the percentage", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured atau up to RM50,000, mana-mana yang lebih tinggi", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured ou up to €50,000, le montant le plus élevé", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured or up to S$50,000", "Fractures: 15% of the Sum Insured"],
    ["Fractures: 15% of the Sum Insured, maximum S$200 per day", "Fractures: 15% of the Sum Insured"],
  ];
  for (const [text, quote] of rows) {
    const h = house(["Lim Ah Kow"], [doc("c1", "Personal Accident Plan.pdf", ["Lim Ah Kow"], `Personal Accident Plan\nInsured: Lim Ah Kow\n${text}`)]);
    assert.deepEqual(ask(h, "Lim Ah Kow", quote, 15, "the Sum Insured").amounts, [], text);
  }
  // The same rows with the cap continuing the sentence still show it, where 15% of his printed sum insured is above it.
  const ok = house(["Lim Ah Kow"], [doc("c2", "Personal Accident Plan.pdf", ["Lim Ah Kow"], "Personal Accident Plan\nInsured: Lim Ah Kow\nSum Insured: S$600,000\nFractures: 15% of the Sum Insured\nmaximum S$50,000 per claim")]);
  assert.deepEqual(ask(ok, "Lim Ah Kow", "Fractures: 15% of the Sum Insured", 15, "the Sum Insured").amounts, ["Lim Ah Kow: Up to S$50,000"]);
});

test("negative: a statement with no person gives no cap", () => {
  assert.deepEqual(ask(MY, null as unknown as string, "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
});

test("£: the cap is shown when the percentage of the printed sum insured is above it", () => {
  const uk = house(["Oliver Hughes"], [doc("k1", "Serious Illness Cover Schedule.pdf", ["Oliver Hughes"],
    "Serious Illness Cover - schedule\nLife insured: Oliver Hughes\nSum Insured: £400,000\nAdditional cancer cover: 10% of the Sum Insured, not exceeding £25,000 per claim")]);
  assert.deepEqual(ask(uk, "Oliver Hughes", "Additional cancer cover: 10% of the Sum Insured", 10, "£400,000").amounts, ["Oliver Hughes: Up to £25,000"]);
});

test("A$: the worked-out percentage is shown when it is below the cap, with how it was worked out", () => {
  const au = house(["Mia Clarke"], [doc("k2", "Trauma Cover Certificate.pdf", ["Mia Clarke"],
    "Trauma Cover certificate\nInsured person: Mia Clarke\nAmount of cover: A$80,000\nPartial trauma benefit: 20% of the Amount of cover, maximum A$50,000 per claim")]);
  const r = ask(au, "Mia Clarke", "Partial trauma benefit: 20% of the Amount of cover", 20, "A$80,000");
  assert.deepEqual(r.amounts, ["Mia Clarke: A$16,000"], JSON.stringify(r.st));
  assert.match(r.st.find((s) => s.amount)!.basis ?? "", /20% of Mia Clarke's sum insured of A\$80,000/);
});

test("S$: a percentage that works out exactly to the cap shows the cap", () => {
  const h = house(["Lim Ah Kow"], [doc("k3", "CI Certificate.pdf", ["Lim Ah Kow"], "Insured: Lim Ah Kow\nSum Assured: S$250,000\nEarly CI: 20% of Sum Assured per claim, maximum S$50,000 per claim")]);
  assert.deepEqual(ask(h, "Lim Ah Kow", "Early CI: 20% of Sum Assured per claim", 20).amounts, ["Lim Ah Kow: Up to S$50,000"]);
});

test("negative: two different sums assured in the document (basic plan and rider), a sum in another currency, or a base the model gives that is not the printed one give no figure", () => {
  const two = house(["Ng Siew Lan"], [doc("k4", "CI Certificate.pdf", ["Ng Siew Lan"],
    "Insured: Ng Siew Lan\nSum Assured: RM 150,000\nRider Sum Assured: RM 400,000\nEarly stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim")]);
  assert.deepEqual(ask(two, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
  const twoSame = house(["Ng Siew Lan"], [doc("k4b", "CI Certificate.pdf", ["Ng Siew Lan"],
    "Insured: Ng Siew Lan\nSum Assured: RM 150,000\nSum Assured: RM 400,000\nEarly stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim")]);
  assert.deepEqual(ask(twoSame, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
  const fx = house(["Ng Siew Lan"], [doc("k5", "CI Certificate.pdf", ["Ng Siew Lan"],
    "Insured: Ng Siew Lan\nSum Assured: S$150,000\nEarly stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim")]);
  assert.deepEqual(ask(fx, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25).amounts, []);
  assert.deepEqual(ask(MY, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim", 25, "RM 300,000").amounts, []);
});

test("every sum a document prints for the person: the cap shows only when each works out to at least the cap", () => {
  const cert = (sums: string) => house(["Lim Ah Kow", "Tan Mei Ling"], [
    doc("k6", "Scheme Schedule.pdf", ["Lim Ah Kow", "Tan Mei Ling"], "Group Scheme\nSchedule\nDeath due to natural catastrophe\t15% of Sum Insured\nor up to S$50,000, whichever is lesser"),
    doc("k7", "Scheme Certificate.pdf", ["Lim Ah Kow", "Tan Mei Ling"], `CERTIFICATE OF GROUP INSURANCE\n${sums}`)]);
  const one = (h: Household, base: string, line: string) => verifyAnswer(h, readModelAnswer({ bottomLine: "", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Natural catastrophe death benefit.", person: "Tan Mei Ling", document: "D1",
    quote: "Death due to natural catastrophe\t15% of Sum Insured", amount: null, percentOf: { percent: 15, baseAmount: base, baseDocument: "D2", baseQuote: line }, conditions: [], alternativeGroup: null }] })!).answer.statements!.filter((s) => s.amount).map((s) => s.amount!.text);
  // S$1,000,000 and S$400,000 both give at least S$50,000 (S$150,000 and S$60,000): the cap is what she can claim.
  assert.deepEqual(one(cert("Lim Ah Kow\tS$1,000,000\nTan Mei Ling\tS$1,000,000\nLim Ah Kow\tS$600,000\nTan Mei Ling\tS$400,000"), "S$400,000", "Tan Mei Ling\tS$400,000"), ["Up to S$50,000"]);
  // Her S$200,000 gives S$30,000, below the cap: which sum it is of decides the figure, so none is shown.
  assert.deepEqual(one(cert("Tan Mei Ling\tS$1,000,000\nTan Mei Ling\tS$200,000"), "S$1,000,000", "Tan Mei Ling\tS$1,000,000"), []);
  // A line naming her with two figures, or a sum in another currency, is a doubt: none is shown.
  assert.deepEqual(one(cert("Tan Mei Ling\tS$1,000,000\tS$400,000"), "S$1,000,000", "Tan Mei Ling\tS$1,000,000\tS$400,000"), []);
  assert.deepEqual(one(cert("Tan Mei Ling\tS$1,000,000\nTan Mei Ling\tUS$400,000"), "S$1,000,000", "Tan Mei Ling\tS$1,000,000"), []);
});

test("negative: a worked-out percentage is never shown above a limit printed on its own row that cannot be read as a cap", () => {
  const h = house(["Lim Ah Kow"], [doc("k8", "Accident Plan.pdf", ["Lim Ah Kow"], "Accident Plan\nInsured: Lim Ah Kow\nFracture benefit\n(% of S$5,000)\nWrist\t20%, up to S$800")]);
  const raw = { bottomLine: "", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Wrist fracture.", person: "Lim Ah Kow", document: "D1", quote: "Wrist\t20%", amount: null,
    percentOf: { percent: 20, baseAmount: "S$5,000", baseDocument: null, baseQuote: null }, conditions: [], alternativeGroup: null }] };
  const amounts = verifyAnswer(h, readModelAnswer(raw)!).answer.statements!.filter((s) => s.amount).map((s) => s.amount!.text);
  assert.ok(!amounts.includes("S$1,000"), JSON.stringify(amounts));
});

/** The model writing the cap as its own plain card ("Up to RM50,000 - her per-claim maximum"), quoting the row's cap words. */
function capCard(h: Household, person: string, quote: string, amount: string, extra: unknown[] = []) {
  const raw = { bottomLine: "", nextSteps: [], question: null, statements: [...extra, { kind: "amount", text: "The per-claim maximum.", person, document: "D1", quote, amount, percentOf: null, conditions: [], alternativeGroup: null }] };
  return verifyAnswer(h, readModelAnswer(raw)!).answer.statements!.filter((s) => s.amount).map((s) => `${s.personName}: ${s.amount!.text}`);
}

test("plain cap card: the cap the model wrote as its own card is held to the same rule (RM37,500, never 'Up to RM50,000')", () => {
  assert.deepEqual(capCard(MY, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim", "RM 50,000"), ["Ng Siew Lan: RM37,500"]);
  // With the percentage card too, the two are one card.
  const pctCard = { kind: "amount", text: "25% of the sum assured per claim.", person: "Ng Siew Lan", document: "D1", quote: "Early stage critical illness: 25% of Sum Assured per claim", amount: null,
    percentOf: { percent: 25, baseAmount: "RM 150,000", baseDocument: null, baseQuote: null }, conditions: [], alternativeGroup: null };
  assert.deepEqual(capCard(MY, "Ng Siew Lan", "Early stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim", "RM 50,000", [pctCard]), ["Ng Siew Lan: RM37,500"]);
  // No sum printed for the person: no figure.
  const none = house(["Lim Ah Kow"], [doc("p1", "Accident Plan.pdf", ["Lim Ah Kow"], "Insured: Lim Ah Kow\nFractures: 15% of the Sum Insured, up to S$50,000 per claim")]);
  assert.deepEqual(capCard(none, "Lim Ah Kow", "Fractures: 15% of the Sum Insured, up to S$50,000 per claim", "S$50,000"), []);
  // A cap on a row with no percentage is not touched.
  const flat = house(["Lim Ah Kow"], [doc("p2", "Accident Plan.pdf", ["Lim Ah Kow"], "Insured: Lim Ah Kow\nMedical expenses: up to S$2,000 per accident")]);
  assert.deepEqual(capCard(flat, "Lim Ah Kow", "Medical expenses: up to S$2,000 per accident", "S$2,000"), ["Lim Ah Kow: Up to S$2,000"]);
});

test("a sum labelled with its cover in brackets, and a plan table's Sum Assured column, are the person's sum", () => {
  const sg = house(["Tan Boon Huat"], [doc("p3", "MultiCare Schedule.pdf", ["Tan Boon Huat"],
    "Policy Schedule - MultiCare Protect\nLife Assured: Tan Boon Huat\nSum Assured (Critical Illness): S$300,000\nEarly Stage Critical Illness Benefit: 30% of Sum Assured, up to S$75,000 per claim")]);
  assert.deepEqual(capCard(sg, "Tan Boon Huat", "Early Stage Critical Illness Benefit: 30% of Sum Assured, up to S$75,000 per claim", "S$75,000"), ["Tan Boon Huat: Up to S$75,000"]);
  const table = (sum: string) => house(["Lim Wei Jie"], [doc("p4", "CI Schedule.pdf", ["Lim Wei Jie"],
    `Policy Schedule\nLife Assured: Lim Wei Jie\nCurrency: Ringgit Malaysia\nBenefit\tSum Assured\tMonthly Premium\nCritical Illness Cover\t${sum}\t180.40\nDeath Benefit\t10,000.00\t---\nEarly Stage Critical Illness: 20% of the Critical Illness sum assured, up to RM 40,000 per claim`)]);
  const q = "Early Stage Critical Illness: 20% of the Critical Illness sum assured, up to RM 40,000 per claim";
  assert.deepEqual(capCard(table("200,000.00"), "Lim Wei Jie", q, "RM 40,000"), ["Lim Wei Jie: Up to RM40,000"]);
  assert.deepEqual(capCard(table("150,000.00"), "Lim Wei Jie", q, "RM 40,000"), ["Lim Wei Jie: RM30,000"]);
});

test("no request tried to leave this machine", () => assert.deepEqual(outbound, []));
console.log(`row cap: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);

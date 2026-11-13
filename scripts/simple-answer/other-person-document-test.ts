/** Scripted tests: an amount stated for one member is never shown from another member's own document (TE main journeys
 * 11 Nov, defect 1: the model named Daniel and quoted Grace's schedule, "Critical Illness Benefit S$80,000", and the
 * answer said "Your documents list this benefit for Daniel Tern" with Grace's S$80,000). A document is another member's
 * when it never names the person and is linked only to others, or names another member. Where the person's own document
 * prints the same line, the figure is shown from theirs. Made-up household (Grace and Daniel Tern, Heron Assurance).
 * No model, database or network.
 *   npm run -s simple:other-person-document-test */
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

type Doc = Household["documents"][number];
const doc = (policyId: string, name: string, linked: string[], text: string, role = "personal_schedule"): Doc => ({ policyId, name, insurer: "Heron Assurance", productName: "Heron Care Plus", policyNumber: null,
  documentType: null, documentRole: role, effectiveDate: null, expiryDate: null, uploadedAt: "2026-11-01", uploadedFor: linked[0] ?? null, linkedPeople: linked, supersededAt: null, processingStatus: "ready",
  pages: [{ page: 1, text }] } as unknown as Doc);
const house = (docs: Doc[]): Household => ({ accountId: "51515151-5151-4515-8515-515151515151", members: [{ name: "Grace Tern", relationship: "self" }, { name: "Daniel Tern", relationship: "spouse" }], documents: docs } as unknown as Household);
const schedule = (no: string, life: string, ci: string) => ["HERON ASSURANCE - POLICY SCHEDULE", `Policy number: ${no}`, `Life assured: ${life}`, "Plan: Heron Care Plus", "Benefits", `Critical Illness Benefit S$${ci}`].join("\n");
const GRACE = (linked = ["Grace Tern"]) => doc("g", "Grace schedule.pdf", linked, schedule("HA-77101", "Grace Tern", "80,000"));
const DANIEL = (linked = ["Daniel Tern"]) => doc("d", "Daniel schedule.pdf", linked, schedule("HA-77102", "Daniel Tern", "120,000"));
type Shown = { amount?: { text: string } | null };
/** The answer's statements for the model's one amount statement. */
function answer(h: Household, person: string | null, document: string, quote: string, question = "What can they claim for critical illness?") {
  const raw = { bottomLine: "Here is what the schedule prints.", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Critical Illness Benefit.", person, document, quote,
    amount: quote.match(/S\$[\d,]+/)![0], percentOf: null, conditions: [], alternativeGroup: null }] };
  return (verifyAnswer(h, readModelAnswer(raw)!, [question]).answer.statements ?? []) as Shown[];
}
const shown = (...a: Parameters<typeof answer>) => answer(...a).flatMap((s) => s.amount ? [s.amount.text] : []);
const G = "Critical Illness Benefit S$80,000", D = "Critical Illness Benefit S$120,000";

// ---- W: another member's document gives no figure
test("W1 Daniel named, Grace's own schedule quoted: no figure", () => assert.deepEqual(shown(house([GRACE(), DANIEL()]), "Daniel Tern", "D1", G, "Actually it was Daniel who was diagnosed."), []));
test("W2 Grace named, Daniel's own schedule quoted: no figure", () => assert.deepEqual(shown(house([GRACE(), DANIEL()]), "Grace Tern", "D2", D), []));
test("W3 Daniel's schedule matched to Grace by its plan only: Grace named, Daniel's schedule quoted: no figure", () =>
  assert.deepEqual(shown(house([GRACE(), { ...DANIEL(["Grace Tern", "Daniel Tern"]), matchedOnly: ["Grace Tern"] } as Doc]), "Grace Tern", "D2", D), []));
test("W4 Daniel's schedule linked to nobody but printing his name: Grace named: no figure", () => assert.deepEqual(shown(house([GRACE(), DANIEL([])]), "Grace Tern", "D2", D), []));
test("W5 a page naming nobody, linked only to Grace: Daniel named: no figure", () => assert.deepEqual(shown(house([doc("g", "Grace benefits.pdf", ["Grace Tern"], "Heron Care Plus\nCritical Illness Benefit S$80,000")]), "Daniel Tern", "D1", G), []));

// ---- C: controls
test("C1 control: Daniel named, Daniel's own schedule quoted", () => assert.deepEqual(shown(house([GRACE(), DANIEL()]), "Daniel Tern", "D2", D), ["S$120,000"]));
test("C2 control: Grace named, Grace's own schedule quoted", () => assert.deepEqual(shown(house([GRACE(), DANIEL()]), "Grace Tern", "D1", G), ["S$80,000"]));
test("C3 control: a joint schedule naming both shows the figure for either", () => {
  const joint = doc("j", "Joint schedule.pdf", ["Grace Tern", "Daniel Tern"], ["HERON ASSURANCE - POLICY SCHEDULE", "Life assured: Grace Tern", "Joint life assured: Daniel Tern", "Critical Illness Benefit S$80,000"].join("\n"));
  assert.deepEqual(shown(house([joint]), "Daniel Tern", "D1", G), ["S$80,000"]);
  assert.deepEqual(shown(house([joint]), "Grace Tern", "D1", G), ["S$80,000"]);
});
test("C4 control: a wording naming nobody, linked to both, shows the figure for either", () => {
  const wording = doc("w", "Heron wording.pdf", ["Grace Tern", "Daniel Tern"], "HERON CARE PLUS - POLICY WORDING\nCritical Illness Benefit S$80,000", "policy_wording");
  assert.deepEqual(shown(house([wording]), "Daniel Tern", "D1", G), ["S$80,000"]);
  assert.deepEqual(shown(house([wording]), "Grace Tern", "D1", G), ["S$80,000"]);
});
test("C5 control: a page naming nobody and linked to nobody keeps its figure", () => assert.deepEqual(shown(house([doc("u", "Benefits.pdf", [], "Heron Care Plus\nCritical Illness Benefit S$80,000")]), "Daniel Tern", "D1", G), ["S$80,000"]));
test("C6 control: a statement naming no one is unchanged", () => assert.deepEqual(shown(house([GRACE(), DANIEL()]), null, "D1", G), ["S$80,000"]));
// Critic #424: a dependant is rarely named on the policyholder's or employee's document; the household's link keeps it theirs.
const both = ["Grace Tern", "Daniel Tern"];
test("C8 control: a family schedule naming only the policyholder, linked to both: the spouse's figure stays", () =>
  assert.deepEqual(shown(house([doc("f", "Family schedule.pdf", both, "HERON ASSURANCE - FAMILY SCHEDULE\nPolicyholder: Grace Tern\nInsured: Policyholder, Spouse and Children\nCritical Illness Benefit S$80,000")]), "Daniel Tern", "D1", G), ["S$80,000"]));
test("C9 control: a group certificate summary naming the employee, linked to both: the dependant's figure stays", () =>
  assert.deepEqual(shown(house([doc("c", "Group summary.pdf", both, "GROUP CERTIFICATE SUMMARY\nEmployee: Grace Tern\nDependants covered: Spouse\nCritical Illness Benefit S$80,000", "certificate")]), "Daniel Tern", "D1", G), ["S$80,000"]));
test("C10 control: a wording prepared for the policyholder, linked to both: the other member's figure stays", () =>
  assert.deepEqual(shown(house([doc("w", "Wording.pdf", both, "Prepared for: Grace Tern\nHERON CARE PLUS - POLICY WORDING\nCritical Illness Benefit S$80,000", "policy_wording")]), "Daniel Tern", "D1", G), ["S$80,000"]));
test("W6 the same family schedule matched to Daniel only by its plan: no figure", () =>
  assert.deepEqual(shown(house([{ ...doc("f", "Family schedule.pdf", both, "HERON ASSURANCE - FAMILY SCHEDULE\nPolicyholder: Grace Tern\nCritical Illness Benefit S$80,000"), matchedOnly: ["Daniel Tern"] } as Doc]), "Daniel Tern", "D1", G), []));
test("C7 the person's own schedule printing the same line: shown from theirs, not the other member's", () => {
  const h = house([GRACE(), doc("d", "Daniel schedule.pdf", ["Daniel Tern"], schedule("HA-77102", "Daniel Tern", "80,000"))]);
  const s = answer(h, "Daniel Tern", "D1", G, "What does Daniel get?").find((x) => x.amount);
  assert.equal(s?.amount?.text, "S$80,000");
  assert.match(JSON.stringify(s), /Daniel schedule/);
  assert.doesNotMatch(JSON.stringify(s), /Grace schedule/);
});

// ---- U: the model gives no person the household can be told (TE new-household walk 13 Nov, defect 1: Daniel's S$400,000
// was shown with no person when Grace's death benefit was asked).
type Card = Shown & { personName?: string | null };
const card = (...a: Parameters<typeof answer>) => (answer(...a) as Card[]).find((s) => s.amount);
for (const p of [null, "", "she", "the life assured", "Mrs Tern"]) {
  test(`U1 person ${JSON.stringify(p)}, the question asks about Grace, Daniel's own schedule quoted: no figure`, () =>
    assert.deepEqual(shown(house([GRACE(), DANIEL()]), p, "D2", D, "What can Grace claim for her cancer?"), []));
}
test("U2 no person, the question names no one, Daniel's own schedule quoted: shown as Daniel's", () => {
  const c = card(house([GRACE(), DANIEL()]), null, "D2", D, "What is the critical illness benefit?");
  assert.equal(c?.amount?.text, "S$120,000"); assert.equal(c?.personName, "Daniel Tern");
});
test("U3 no person, the question names Daniel, Daniel's own schedule quoted: shown as Daniel's", () => {
  const c = card(house([GRACE(), DANIEL()]), "he", "D2", D, "What can Daniel claim?");
  assert.equal(c?.amount?.text, "S$120,000"); assert.equal(c?.personName, "Daniel Tern");
});
test("U4 no person, the question names both, Daniel's own schedule quoted: shown as Daniel's", () => {
  const c = card(house([GRACE(), DANIEL()]), null, "D2", D, "What can Grace and Daniel claim?");
  assert.equal(c?.amount?.text, "S$120,000"); assert.equal(c?.personName, "Daniel Tern");
});
test("U5 control: no person, a wording naming nobody linked to both: the figure stays, for no one in particular", () => {
  const wording = doc("w", "Heron wording.pdf", ["Grace Tern", "Daniel Tern"], "HERON CARE PLUS - POLICY WORDING\nCritical Illness Benefit S$80,000", "policy_wording");
  const c = card(house([wording]), null, "D1", G, "What can Grace claim?");
  assert.equal(c?.amount?.text, "S$80,000"); assert.ok(!c?.personName);
});
test("U6 control: no person, a joint schedule naming both: the figure stays", () => {
  const joint = doc("j", "Joint schedule.pdf", ["Grace Tern", "Daniel Tern"], ["HERON ASSURANCE - POLICY SCHEDULE", "Life assured: Grace Tern", "Joint life assured: Daniel Tern", "Critical Illness Benefit S$80,000"].join("\n"));
  assert.deepEqual(shown(house([joint]), null, "D1", G, "What can Daniel claim?"), ["S$80,000"]);
});
test("U7 control: a one-person household, no person: the figure stays", () => {
  const one = { ...house([GRACE()]), members: [{ name: "Grace Tern", relationship: "self" }] } as unknown as Household;
  assert.deepEqual(shown(one, null, "D1", G, "What can I claim?"), ["S$80,000"]);
});

// Critic #444: labels follow the card, not its place; a figure printed in the asked-about member's own document is kept
// from theirs; a follow-up that names no one is read with the earlier question that did.
function cards(h: Household, statements: Record<string, unknown>[], written: string[]) {
  const raw = { bottomLine: "Here is what the documents print.", nextSteps: [], question: null, statements: statements.map((x) => ({ kind: "amount", text: "Benefit.", person: null, document: null,
    amount: null, percentOf: null, conditions: [], alternativeGroup: null, ...x })) };
  return ((verifyAnswer(h, readModelAnswer(raw)!, written).answer.statements ?? []) as Card[]).filter((s) => s.amount).map((s) => `${s.personName ?? "-"}: ${s.amount!.text}`);
}
test("U8 two unnamed statements from two members' own schedules: each card names its own owner", () =>
  assert.deepEqual(cards(house([GRACE(), DANIEL()]), [{ document: "D2", quote: D, amount: "S$120,000" }, { document: "D1", quote: G, amount: "S$80,000" }], ["What can we claim?"]),
    ["Daniel Tern: S$120,000", "Grace Tern: S$80,000"]));
test("U9 unnamed, quoted from Grace's schedule, Daniel's own schedule prints the same line, question about Daniel: shown from Daniel's", () => {
  const h = house([doc("g", "Grace schedule.pdf", ["Grace Tern"], "Life assured: Grace Tern\nHospital Cash S$150 per day"), doc("d", "Daniel schedule.pdf", ["Daniel Tern"], "Life assured: Daniel Tern\nHospital Cash S$150 per day")]);
  assert.deepEqual(cards(h, [{ document: "D1", quote: "Hospital Cash S$150 per day", amount: "S$150" }], ["How much hospital cash does Daniel get?"]), ["Daniel Tern: S$150"]);
});
test("U10 a follow-up naming no one after a question about Grace: Daniel's own figure is not shown", () =>
  assert.deepEqual(cards(house([GRACE(), DANIEL()]), [{ document: "D2", quote: D, amount: "S$120,000" }], ["And the critical illness benefit?", "What can Grace claim?"]), []));

test("U11 a later card replacing an earlier one does not move a label onto another statement's card (Critic #444 F1)", () => {
  const ng = "Ng Siew Lan", tan = "Tan Wei Kiat";
  const h = { accountId: "51515151-5151-4515-8515-515151515151", members: [{ name: ng, relationship: "self" }, { name: tan, relationship: "spouse" }], documents: [
    doc("a", "Early CI Certificate SL.pdf", [ng], `Certificate of Insurance\nInsured: ${ng}\nPlan: Early CI Protector\nSum Assured: RM 150,000\nEarly stage critical illness: 25% of Sum Assured per claim, maximum RM 50,000 per claim\nAccidental death benefit: RM 90,000`, "certificate"),
    doc("b", "Term schedule WK.pdf", [tan], `Policy schedule\nLife assured: ${tan}\nDeath benefit: RM 200,000`)] } as unknown as Household;
  const got = cards(h, [
    { person: ng, document: "D1", quote: "maximum RM 50,000 per claim", amount: "RM 50,000" },
    { document: "D2", quote: "Death benefit: RM 200,000", amount: "RM 200,000" },
    { document: "D1", quote: "Accidental death benefit: RM 90,000", amount: "RM 90,000" },
    { person: ng, document: "D1", quote: "Early stage critical illness: 25% of Sum Assured per claim", percentOf: { percent: 25, baseAmount: "RM 150,000", baseDocument: null, baseQuote: null } },
  ], ["What can we claim?"]);
  assert.ok(got.includes(`${tan}: RM200,000`), JSON.stringify(got));
  assert.ok(got.includes(`${ng}: RM90,000`), JSON.stringify(got));
  assert.ok(!got.some((x) => x.startsWith(`${tan}:`) && x !== `${tan}: RM200,000`), JSON.stringify(got));
});

assert.deepEqual(outbound, []);
console.log(`other-person document: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
export {};

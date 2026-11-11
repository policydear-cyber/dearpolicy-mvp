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
test("W3 Daniel's schedule wrongly linked to both: Grace named, Daniel's schedule quoted: no figure", () => assert.deepEqual(shown(house([GRACE(), DANIEL(["Grace Tern", "Daniel Tern"])]), "Grace Tern", "D2", D), []));
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
test("C7 the person's own schedule printing the same line: shown from theirs, not the other member's", () => {
  const h = house([GRACE(), doc("d", "Daniel schedule.pdf", ["Daniel Tern"], schedule("HA-77102", "Daniel Tern", "80,000"))]);
  const s = answer(h, "Daniel Tern", "D1", G, "What does Daniel get?").find((x) => x.amount);
  assert.equal(s?.amount?.text, "S$80,000");
  assert.match(JSON.stringify(s), /Daniel schedule/);
  assert.doesNotMatch(JSON.stringify(s), /Grace schedule/);
});

assert.deepEqual(outbound, []);
console.log(`other-person document: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
export {};

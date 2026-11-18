/** An overview answer reads as a list, not one long bold sentence (DC, 18 Nov 2026, "Tell me what charmaine has"), and
 * an "also linked to …" list of other documents is left out. Made-up households and wordings; no model, network or DB.
 *   npm run simple:lead-list-test */
import assert from "node:assert/strict";
import type { AnswerStatement } from "@/components/answer-cards";
import { listFromBottomLine } from "@/lib/simple-chat/lead-list";

let passed = 0; const failures: string[] = [];
function t(name: string, fn: () => void) { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); console.log(`not ok - ${name}`); } }

const amount = (id: string, text: string): AnswerStatement => ({ id, kind: "benefit_terms", text, fullText: text, personName: "Mei", conditions: [],
  amount: { text: "S$100,000", currencyResolved: true, illustration: false } } as unknown as AnswerStatement);
const point = (id: string, text: string): AnswerStatement => ({ id, kind: "fact", text, fullText: text, conditions: [] } as unknown as AnswerStatement);
const answer = (bottomLine: string, statements: AnswerStatement[] = []) => ({ bottomLine, summary: bottomLine, statements });
const items = (a: { statements: AnswerStatement[] }) => a.statements.filter((s) => s.id.startsWith("lead-item-")).map((s) => s.text);

t("the screenshot's shape: a subject, five policies with descriptions, then an 'also linked' list", () => {
  const a = answer("Mei has Harbour Life Pro Protector – MAX (life cover with disability and double critical illness), Kestrel Link Enhanced Protector (life, critical illness, disability and accident cover), Kestrel Flexi Cash Protection Plus (life and disability cover), Osprey READYBUILDER 10 (a participating endowment with death and terminal illness cover), and the Plover Group Insurance cover (life, accident and critical illness). She is also linked to the Home Protection Scheme, CareShield Life, an Information Booklet and a Product Summary.",
    [amount("s1", "Death benefit (Harbour Life Pro Protector).")]);
  const removed = listFromBottomLine(a);
  assert.equal(a.bottomLine, "Mei has:");
  assert.equal(a.summary, "Mei has:");
  assert.deepEqual(items(a), [
    "Harbour Life Pro Protector – MAX (life cover with disability and double critical illness)",
    "Kestrel Link Enhanced Protector (life, critical illness, disability and accident cover)",
    "Kestrel Flexi Cash Protection Plus (life and disability cover)",
    "Osprey READYBUILDER 10 (a participating endowment with death and terminal illness cover)",
    "the Plover Group Insurance cover (life, accident and critical illness)",
  ]);
  assert.equal(removed.length, 1);
  assert.match(removed[0], /also linked/);
  // The amount card stays, after the list, untouched.
  assert.deepEqual(a.statements.map((s) => s.id).slice(-1), ["s1"]);
  assert.equal(a.statements.at(-1)!.amount!.text, "S$100,000");
});

t("a name with 'and' in it stays whole unless it is the second of the last pair", () => {
  const a = answer("Jun has Alpha Life, Beta Hospital and Surgical Plan, and Gamma Accident.");
  listFromBottomLine(a);
  assert.deepEqual(items(a), ["Alpha Life", "Beta Hospital and Surgical Plan", "Gamma Accident"]);
});

t("not a list: two things, a sentence with a clause, or a short answer stay as written", () => {
  for (const bottom of [
    "Jun has Alpha Life and Beta Shield.",
    "Jun's Alpha Life pays S$ on death, and Beta Shield pays hospital bills.",
    "Yes, Jun is covered for hospital stays.",
    "The hospital cash benefit pays from the 11th day, for up to 30 days, after a stay of 3 days.",
  ]) {
    const a = answer(bottom);
    assert.deepEqual(listFromBottomLine(a), []);
    assert.equal(a.bottomLine, bottom, bottom);
    assert.deepEqual(items(a), [], bottom);
  }
});

t("an 'also linked' sentence goes from a plain point too; an amount card keeps every word", () => {
  const a = answer("Jun has two policies.", [
    point("p1", "Alpha Life covers death and disability. He is also linked to a Product Summary and a booklet."),
    point("p2", "Jun is also linked to the Beta scheme booklet."),
    { ...amount("s1", "Death benefit. Jun is also linked to a booklet."), personName: "Jun" } as AnswerStatement,
  ]);
  const removed = listFromBottomLine(a);
  assert.deepEqual(a.statements.map((s) => [s.id, s.text]), [
    ["p1", "Alpha Life covers death and disability."],
    ["s1", "Death benefit. Jun is also linked to a booklet."],
  ]);
  assert.equal(removed.length, 2);
  assert.equal(a.bottomLine, "Jun has two policies.");
});

t("the items are the bottom line's own words: nothing added, nothing reworded", () => {
  const bottom = "Ana's policies are Delta Term (life), Echo Shield (hospital) and Foxtrot Care (long-term care).";
  const a = answer(bottom);
  listFromBottomLine(a);
  assert.equal(a.bottomLine, "Ana's policies are:");
  for (const item of items(a)) assert.ok(bottom.includes(item), item);
});

console.log(`lead list: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);

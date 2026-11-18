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
const OPTS = { names: ["Mei Tan", "Jun Lim", "Ana Cruz (Annie)"] };
const items = (a: { statements: AnswerStatement[] }) => a.statements.filter((s) => s.id.startsWith("lead-item-")).map((s) => s.text);

t("the screenshot's shape: a subject, five policies with descriptions, then an 'also linked' list", () => {
  const a = answer("Mei has Harbour Life Pro Protector – MAX (life cover with disability and double critical illness), Kestrel Link Enhanced Protector (life, critical illness, disability and accident cover), Kestrel Flexi Cash Protection Plus (life and disability cover), Osprey READYBUILDER 10 (a participating endowment with death and terminal illness cover), and the Plover Group Insurance cover (life, accident and critical illness). She is also linked to an Information Booklet and a Product Summary.",
    [amount("s1", "Death benefit (Harbour Life Pro Protector).")]);
  const removed = listFromBottomLine(a, OPTS);
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

t("a name with 'and' in it is never cut (Critic #546 MED-2)", () => {
  const a = answer("Jun has Alpha Life, Beta Hospital and Surgical Plan, and Gamma Accident.");
  listFromBottomLine(a, OPTS);
  assert.deepEqual(items(a), ["Alpha Life", "Beta Hospital and Surgical Plan", "Gamma Accident"]);
  const b = answer("Jun has Singlife Shield, AIA Term Life, Hospital and Surgical Plan.");
  listFromBottomLine(b, OPTS);
  assert.ok(!items(b).includes("Hospital") && !items(b).includes("Surgical Plan"), JSON.stringify(items(b)));
  const c = answer("Jun has Alpha Life (life and accident), Beta Shield (hospital) and Gamma Care (long-term care).");
  listFromBottomLine(c, OPTS);
  assert.deepEqual(items(c), ["Alpha Life (life and accident)", "Beta Shield (hospital)", "Gamma Care (long-term care)"]);
});

t("a sentence that denies, contrasts or limits is never a list (Critic #546 HIGH-1)", () => {
  for (const bottom of [
    "Mei has no cover for dental, optical and maternity.",
    "Mei has life cover, hospital cover, but no accident cover.",
    "Mei has Alpha Life, Beta Shield and Gamma Care, none of which covers dental.",
    "Mei doesn't have dental, optical or maternity cover.",
    "Mei has only Alpha Life, Beta Shield and Gamma Care.",
  ]) {
    const a = answer(bottom);
    listFromBottomLine(a, OPTS);
    assert.equal(a.bottomLine, bottom, bottom);
    assert.deepEqual(items(a), [], bottom);
  }
});

t("only a person's list: a subject that is not a member, a pronoun or 'your' stays (Critic #546 MED-2)", () => {
  for (const bottom of [
    "Hospital stays are covered by Singlife Shield, MediShield Life and the GE rider.",
    "The plan has three riders: Alpha, Beta and Gamma.",
    "Peter has Alpha Life (life), Beta Shield (hospital) and Gamma Care (long-term care).",
    // Without a description on each, "B and C" is never cut, so three names read as two and stay a sentence.
    "Mei has Alpha Life, Beta Shield and Gamma Care.",
  ]) {
    const a = answer(bottom);
    listFromBottomLine(a, OPTS);
    assert.equal(a.bottomLine, bottom, bottom);
  }
  const her = answer("She has Alpha Life (life), Beta Shield (hospital) and Gamma Care (long-term care).");
  listFromBottomLine(her, OPTS);
  assert.equal(her.bottomLine, "She has:");
  const nick = answer("Ana Cruz has Alpha Life (life), Beta Shield (hospital) and Gamma Care (long-term care).");
  listFromBottomLine(nick, OPTS);
  assert.equal(nick.bottomLine, "Ana Cruz has:");
});

t("an 'also linked' sentence naming a scheme or plan is cover and stays; about documents, it always stays (Critic #546 MED-3)", () => {
  const cover = "Mei has two policies. She is also linked to CareShield Life and the Home Protection Scheme.";
  const a = answer(cover);
  assert.deepEqual(listFromBottomLine(a, OPTS), []);
  assert.equal(a.bottomLine, cover);
  const docs = "Mei has two policies. She is also linked to an Information Booklet and a Product Summary.";
  const b = answer(docs);
  listFromBottomLine(b, { ...OPTS, aboutDocuments: true });
  assert.equal(b.bottomLine, docs);
});

t("not a list: two things, a sentence with a clause, or a short answer stay as written", () => {
  for (const bottom of [
    "Jun has Alpha Life and Beta Shield.",
    "Jun's Alpha Life pays S$ on death, and Beta Shield pays hospital bills.",
    "Yes, Jun is covered for hospital stays.",
    "The hospital cash benefit pays from the 11th day, for up to 30 days, after a stay of 3 days.",
  ]) {
    const a = answer(bottom);
    assert.deepEqual(listFromBottomLine(a, OPTS), []);
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
  const removed = listFromBottomLine(a, OPTS);
  assert.deepEqual(a.statements.map((s) => [s.id, s.text]), [
    ["p1", "Alpha Life covers death and disability."],
    ["s1", "Death benefit. Jun is also linked to a booklet."],
  ]);
  assert.equal(removed.length, 2);
  assert.equal(a.bottomLine, "Jun has two policies.");
});

t("a second sentence of the bottom line follows the list, never the lead (Critic #546 LOW-1)", () => {
  const a = answer("Mei has Alpha Life (life), Beta Shield (hospital) and Gamma Care (long-term care). She is also linked to CareShield Life.");
  listFromBottomLine(a, OPTS);
  assert.equal(a.bottomLine, "Mei has:");
  assert.deepEqual(a.statements.map((s) => s.id), ["lead-item-1", "lead-item-2", "lead-item-3", "lead-after"]);
  assert.equal(a.statements[3].text, "She is also linked to CareShield Life.");
});

t("the items are the bottom line's own words: nothing added, nothing reworded", () => {
  const bottom = "Ana has Delta Term (life), Echo Shield (hospital) and Foxtrot Care (long-term care).";
  const a = answer(bottom);
  listFromBottomLine(a, OPTS);
  assert.equal(a.bottomLine, "Ana has:");
  for (const item of items(a)) assert.ok(bottom.includes(item), item);
});

console.log(`lead list: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);

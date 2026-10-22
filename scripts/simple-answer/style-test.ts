/** Offline test of the chat's tone and style guide and the general clean-ups that go with it: the guide file is loaded
 * into the simple chat's instructions without displacing the accuracy rules, it is traced into every server route,
 * a table's row letters are not part of a benefit's name, and "not a total" is said once.
 *   npm run simple:style-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerStyle } from "@/lib/chat/answer-style";
import { SIMPLE_SYSTEM_PROMPT } from "@/lib/simple-chat/prompt";
import { benefitName, benefitNames } from "@/lib/benefit-table/headline";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerCards, type StructuredAnswer } from "@/components/answer-cards";
import { verifyAnswer } from "@/lib/simple-chat/verify";
import type { Household } from "@/lib/simple-chat/library";
import type { ModelStatement } from "@/lib/simple-chat/prompt";

let passed = 0;
const t = (name: string, run: () => void) => { run(); passed++; console.log("ok - " + name); };

t("the style guide is read from its file, without the note for people editing it", () => {
  const style = answerStyle();
  assert.match(style, /^## Voice/);
  assert.doesNotMatch(style, /This file sets the tone/);
  for (const h of ["Answer first", "Only what was asked", "Say each thing once", "Follow-ups and corrections", "Plain labels"]) assert.match(style, new RegExp(`## ${h}`));
});
t("the prompt carries the guide after the accuracy rules, which still win", () => {
  const at = SIMPLE_SYSTEM_PROMPT.indexOf("<style>");
  assert.ok(at > 0 && SIMPLE_SYSTEM_PROMPT.includes(answerStyle()));
  assert.ok(SIMPLE_SYSTEM_PROMPT.indexOf("Never add amounts together") < at, "accuracy rules come first");
  assert.match(SIMPLE_SYSTEM_PROMPT, /The rules above always win over it/);
});
t("every server route carries the guide file", () => {
  assert.match(readFileSync("next.config.ts", "utf8"), /"\/\*\*": \["lib\/chat\/answer-style\.md"\]/);
});
t("a table's row letter or number is not part of a benefit's name", () => {
  const cases: [string, string][] = [["J, Accidental Hospital Recuperation Benefit", "Accidental Hospital Recuperation Benefit"], ["D. Daily Hospital Cash Benefit", "Daily Hospital Cash Benefit"],
    ["(a) Death", "Death"], ["12. Hip", "Hip"], ["(iv) Loss of limb", "Loss of limb"], ["A Death benefit", "A Death benefit"], ["D, E and F Benefit", "D, E and F Benefit"], ["J, Accidental Hospital Recuperation Benefit", "Accidental Hospital Recuperation Benefit"], ["Arm, Elbow, Wrist or Ribs", "Arm, Elbow, Wrist or Ribs"], ["X-ray", "X-ray"]];
  for (const [raw, name] of cases) assert.equal(benefitName(raw), name, raw);
});

const doc = { insurer: "Testlife", productName: "Test Extras", policyNumber: "T2", documentType: "personal_accident", documentRole: "certificate", effectiveDate: "2026-01-01", expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: "Lim Ah Kow", linkedPeople: ["Lim Ah Kow"], supersededAt: null, processingStatus: "ready" };
const HOUSE = { accountId: "11111111-1111-1111-1111-111111111111", members: [{ name: "Lim Ah Kow", relationship: "self" }],
  documents: [{ ...doc, policyId: "aaaaaaaa-0000-0000-0000-000000000002", name: "Extras.pdf", pages: [{ page: 1, text: "Ambulance Cost\tUp to S$500 per incident\nAccidental Hospital Recuperation Benefit\tS$250" }] }] } as unknown as Household;
const st = (x: Partial<ModelStatement>): ModelStatement => ({ kind: "amount", text: "", person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null, ...x } as ModelStatement);
const two = [st({ text: "Ambulance cost.", person: "Lim Ah Kow", document: "D1", quote: "Ambulance Cost Up to S$500 per incident", amount: "S$500", alternativeGroup: "x" }),
  st({ text: "Recuperation benefit.", person: "Lim Ah Kow", document: "D1", quote: "Accidental Hospital Recuperation Benefit S$250", amount: "S$250", alternativeGroup: "x" })];
t("separate benefits grouped by the model get the server's 'not a total' note once", () => {
  const { answer } = verifyAnswer(HOUSE, { bottomLine: "Two benefits could pay.", nextSteps: [], question: null, statements: two });
  assert.equal(answer.statements!.filter((s) => /not a total/.test(s.text)).length, 1);
});
t("the server's note is kept when the model only says the documents differ (Critic R121-1)", () => {
  const { answer } = verifyAnswer(HOUSE, { bottomLine: "Two benefits could pay.", nextSteps: [], question: null, statements: [...two,
    st({ kind: "uncertainty", text: "The two documents print different figures.", document: "D1" })] });
  assert.equal(answer.statements!.filter((s) => s.id.startsWith("not-total-")).length, 1);
  assert.ok(answer.statements!.some((s) => /different figures/.test(s.text)), "the model's own point stays");
});
t("a point of the model's that only repeats 'not a total' is left out; the server's note with the amounts stays", () => {
  const { answer } = verifyAnswer(HOUSE, { bottomLine: "Two benefits could pay.", nextSteps: [], question: null, statements: [...two,
    st({ kind: "uncertainty", text: "These are different benefits, not a total.", document: "D1" })] });
  const notes = answer.statements!.filter((s) => /not a total/.test(s.text));
  assert.equal(notes.length, 1);
  assert.ok(notes[0].id.startsWith("not-total-") && /S\$500/.test(notes[0].text), "the kept note names the amounts");
  assert.equal(answer.statements!.filter((s) => s.amount).length, 2, "both amounts stay");
});
t("a missing guide file never stops the chat: the guide is empty (Critic R121-2)", () => {
  assert.equal(answerStyle("/nonexistent/answer-style.md"), "");
});
t("the guide names no real household member (Critic R121-4)", () => {
  assert.doesNotMatch(readFileSync("lib/chat/answer-style.md", "utf8"), /Desmond|Charmaine/);
});
t("stripping row letters never makes two benefits of one cover read the same (TE #101)", () => {
  const rows = [{ benefit: "A. Death", coverKey: "c1" }, { benefit: "B. Death", coverKey: "c1" }, { benefit: "C. Hip", coverKey: "c1" }, { benefit: "A. Death", coverKey: "c2" }];
  const name = benefitNames(rows);
  assert.deepEqual(rows.map(name), ["A. Death", "B. Death", "Hip", "Death"]);
});
t("a point keeps its other words when only its 'not a total' sentence repeats the server's note (Critic R122-1)", () => {
  const { answer } = verifyAnswer(HOUSE, { bottomLine: "Two benefits could pay.", nextSteps: [], question: null, statements: [...two,
    st({ kind: "uncertainty", text: "These are not a total. Written notice is due within 30 days of the accident.", document: "D1" })] });
  assert.equal(answer.statements!.filter((s) => /not a total/.test(s.text)).length, 1);
  assert.ok(answer.statements!.some((s) => /within 30 days/.test(s.text)), "the deadline stays");
  const mixed = verifyAnswer(HOUSE, { bottomLine: "Two benefits could pay.", nextSteps: [], question: null, statements: [...two,
    st({ kind: "uncertainty", text: "They are not a total and must be claimed within 30 days.", document: "D1" })] }).answer;
  assert.ok(mixed.statements!.some((s) => /must be claimed within 30 days/.test(s.text)), "a sentence with more than 'not a total' stays whole");
});
const card = (currencyResolved: boolean, kind = "fact") => renderToStaticMarkup(createElement(AnswerCards, { answer: { summary: "", bottomLine: "x", nextSteps: [], questions: [], citations: [],
  statements: [{ id: "s1", kind, personName: "Lim Ah Kow", text: "Recuperation.", fullText: "Recuperation.", conditions: [], amount: { text: "$250", currencyResolved, illustration: false } }] } as unknown as StructuredAnswer, render: (x: string) => x, prose: [] }));
t("a figure whose currency the document does not state says so on its card; others carry no label (TE #101)", () => {
  assert.match(card(false), /Currency not stated/);
  assert.doesNotMatch(card(true), /Currency not stated|illustration|printed amount/);
  assert.match(card(true, "benefit_terms"), /Policy terms, not worked out for this case/);
});
console.log(`style: ${passed} passed, 0 failed`);

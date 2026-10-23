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
import { documentCurrency, personalFileName, verifyAnswer } from "@/lib/simple-chat/verify";
import { RULE_PAGE } from "@/lib/benefit-table/chat";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
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
// ------------------------------------------------------------------ second round (DC, 22 Oct: live answers on 159b954)
t("the same benefit printed with and without its row letter in two documents loses the letter", () => {
  const rows = [{ benefit: "J, Accidental Hospital Recuperation Benefit", coverKey: "gpa" }, { benefit: "Accidental Hospital Recuperation Benefit", coverKey: "gpa" },
    { benefit: "A. Death", coverKey: "c1" }, { benefit: "B. Death", coverKey: "c1" }, { benefit: "A. Death", coverKey: "c1" }];
  assert.deepEqual(rows.map(benefitNames(rows)), ["Accidental Hospital Recuperation Benefit", "Accidental Hospital Recuperation Benefit", "A. Death", "B. Death", "A. Death"]);
});
t("a source is named by its document, never by a file name a machine gave it", () => {
  for (const n of ["817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", "output_202609281146053.pdf", "Scan_20261003.pdf", "IMG-4412.jpg", "0012345.pdf", "WhatsApp Image 2026-09-01 at 10.15.32.pdf",
    "Screenshot 2026-09-01 at 10.15.32 AM.pdf", "document (3).pdf", "Download (1).pdf", "PXL_20260901_101532.pdf", "CamScanner 09-01-2026 10.15.pdf"]) assert.equal(personalFileName(n), null, n);
  for (const [n, want] of [["Product Summary.pdf", "Product Summary"], ["Desmond travel policy.pdf", "Desmond travel policy"]]) assert.equal(personalFileName(n), want);
  const house = { ...HOUSE, documents: [{ ...HOUSE.documents[0], name: "817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", productName: null, insurer: "Singlife", documentRole: "policy_wording" }] } as Household;
  const { answer } = verifyAnswer(house, { bottomLine: "x", nextSteps: [], question: null, statements: [st({ text: "Recuperation.", person: "Lim Ah Kow", document: "D1", quote: "Accidental Hospital Recuperation Benefit S$250", amount: "S$250" })] });
  const json = JSON.stringify(answer);
  assert.doesNotMatch(json, /817d6e8b/);
  assert.equal(answer.statements!.find((s) => s.amount)?.source?.policyName, "Singlife policy wording");
});
t("a point that could not be checked is left out without a line saying so; a left-out amount is still said", () => {
  const { answer, report } = verifyAnswer(HOUSE, { bottomLine: "x", nextSteps: [], question: null, statements: [st({ kind: "fact", text: "Something unprintable.", document: "D1", quote: "words that are not on any page" })] });
  assert.equal(report.dropped.length, 1);
  assert.doesNotMatch(JSON.stringify(answer), /left out a point/);
  const amount = verifyAnswer(HOUSE, { bottomLine: "x", nextSteps: [], question: null, statements: [st({ text: "Made up.", person: "Lim Ah Kow", document: "D1", quote: "nowhere S$777", amount: "S$777" })] }).answer;
  assert.ok(amount.statements!.some((s) => s.id === "left-out-amount"));
});
t("with the server's 'not a total' note, the model's 'documents print different figures, the insurer decides which' is not said again", () => {
  const { answer } = verifyAnswer(HOUSE, { bottomLine: "Two benefits could pay.", nextSteps: [], question: null, statements: [...two,
    st({ kind: "uncertainty", text: "The two documents print different figures for the same recuperation benefit, so the insurer decides which applies. Written notice is due within 30 days.", document: "D1" })] });
  assert.equal(answer.statements!.filter((s) => /insurer decides which/.test(s.text)).length, 1, "only the server's note");
  assert.ok(answer.statements!.some((s) => s.text === "Written notice is due within 30 days."), "the deadline stays");
  const note = answer.statements!.find((s) => s.id.startsWith("not-total-"))!;
  assert.doesNotMatch(note.text, /Lim Ah Kow/, "one person's amounts: the note does not name them again");
  assert.match(note.text, /^Up to S\$500 and S\$250 come from/);
});
t("a 'different figures' sentence stays when it carries a condition, or when the server's notes don't cover every amount (TE #102)", () => {
  const said = (extra: ModelStatement[], text: string) => verifyAnswer(HOUSE, { bottomLine: "x", nextSteps: [], question: null, statements: [...two, ...extra,
    st({ kind: "uncertainty", text, document: "D1" })] }).answer.statements!.some((s) => s.text.includes(text.slice(0, 30)));
  assert.ok(said([], "The two documents print different figures for the same benefit if you were hospitalised, so the insurer decides which applies."));
  const loose = st({ text: "Hospital cash.", person: "Lim Ah Kow", document: "D1", quote: "Accidental Hospital Recuperation Benefit S$250", amount: "S$250" });
  const house2 = { ...HOUSE, documents: [{ ...HOUSE.documents[0], pages: [{ page: 1, text: HOUSE.documents[0].pages[0].text + "\nDaily cash\tS$75" }] }] } as Household;
  const other = verifyAnswer(house2, { bottomLine: "x", nextSteps: [], question: null, statements: [...two, { ...loose, quote: "Daily cash S$75", amount: "S$75" },
    st({ kind: "uncertainty", text: "The two documents print different figures for the same benefit, so the insurer decides which applies.", document: "D1" })] }).answer;
  assert.ok(other.statements!.some((s) => /print different figures/.test(s.text)), "S$75 has no server note, so the model's sentence stays");
});
t("the style guide covers corrections, several covers on one event, and 'not covered' answers", () => {
  const style = answerStyle();
  for (const h of ["When several covers could pay", "When it isn't covered"]) assert.match(style, new RegExp(`## ${h}`));
  assert.match(style, /corrected answer is short/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /never tell them how or by when to claim on that cover/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /the earlier answer stands except for what the correction changes/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /These are separate covers\. The pages I used don't say whether one affects the other, so the insurer decides\. They are not added up\./);
  assert.match(style, /These are separate covers\. The pages I used don't say whether one affects the other, so the insurer decides\. They are not added up\./);
  // Never a promise that each pays (Critic R124-2); a "not shown to be covered" answer keeps a printed deadline as a condition (R124-3).
  assert.doesNotMatch(SIMPLE_SYSTEM_PROMPT + style, /each paid on its own terms|each pay on their own terms/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /If FWD confirms cover, claim within 30 days/);
});
t("pages printing how covers limit each other are sent with the table (Critic R124-2)", () => {
  for (const line of ["This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme", "provided no other benefit has been paid",
    "the balance of the sum insured will be paid", "Cover is terminated upon payment of the full Sum Insured under GTL or GPA", "paid in lieu of", "will be reduced by", "is deducted from"])
    assert.ok(RULE_PAGE.test(line), line);
});
t("a bare $ is S$ only in a document that names Singapore dollars and nothing that may be another currency (Critic R124-1)", () => {
  const mk = (text: string) => ({ pages: [{ page: 1, text: "Benefit Schedule (SGD$)\nAmbulance S$500\nRecuperation $250\n" + text }] }) as unknown as HouseholdDocument;
  for (const ok of ["", "GPA 600 and GTL 1 (scheme codes)", "Payable in Singapore dollars", "We won't pay for self-inflicted injury.", "We won’t pay for war."]) assert.equal(documentCurrency(mk(ok)), "SGD", ok);
  for (const other of ["Paid in U.S. dollars", "Limit 5,000 yen", "RMB 300", "300 RMB", "NT$ 400", "Canadian dollars", "Rs 500", "₹500", "USD500", "HK$100", "5,000 baht",
    "RM 200 in ringgit", "100 pesos", "₩ 10,000", "฿ 900", "₱ 50", "converted at the exchange rate", "claims in a foreign currency", "20 francs"])
    assert.equal(documentCurrency(mk(other)), null, other);
});
t("a clarifying question says what is settled first; identifiers by their label; counts from links; read files never called unreadable (live run 22 Oct)", () => {
  const style = answerStyle();
  assert.match(SIMPLE_SYSTEM_PROMPT, /first say what the documents already settle for each person it could be/);
  assert.match(style, /If it's Alex, nothing uploaded covers Alex/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /give the one printed next to that same label \(a "Group Policy No\." for the group policy number\)/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /comes only from each document's linked_people/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /never correct an earlier sentence in a later one/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /Never say such a document could not be read or has no text/);
  assert.ok(RULE_PAGE.test("All claims will be paid directly to the Insured Person, proper claimant or legal representative, as applicable."));
});
t("same-event smaller benefits are given, and no sentence says a cover is one person's and not another's (live run 22 Oct, H10, C5)", () => {
  assert.match(SIMPLE_SYSTEM_PROMPT, /smaller benefits a cover pays on that same event \(a funeral or compassionate allowance, a child education fund/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /Never write that a cover or amount is one person's and not another's/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /A point that mentions an amount gives it/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /gets an amount statement only when the event is on that list/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /"from the 11th day" and "after the 10th day"/);
  assert.match(SIMPLE_SYSTEM_PROMPT, /only when their figures, days or conditions differ/);
});
console.log(`style: ${passed} passed, 0 failed`);

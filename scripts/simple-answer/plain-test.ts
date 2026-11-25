/** Offline (scripted) test of the plain-wording rules for chat answers: same-for-everyone cards merge, document marks and
 * stock phrases are said plainly, steps come first when asked what to do, one phone per insurer, no filing codes as
 * titles. Scripted: it shows the rules work on fixed inputs, not how the model words a real answer.
 *   npm run simple:plain-test */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerCards, type AnswerStatement, type StructuredAnswer } from "@/components/answer-cards";
import { customerAnswerText } from "@/components/customer-text";
import { asksWhatToDo, mergeSamePerson, plainWords, stripMarks } from "@/lib/simple-chat/plain";
import { contactsOnPage, pick } from "@/lib/simple-chat/insurer-contacts";
import { personalFileName } from "@/lib/simple-chat/verify";

let passed = 0;
const t = (name: string, run: () => void) => { run(); passed++; console.log("ok - " + name); };

const card = (id: string, person: string, over: Partial<AnswerStatement> = {}): AnswerStatement => ({
  id, kind: "benefit_terms", personName: person, text: "Pays for an arm broken in an accident.", fullText: "Pays for an arm broken in an accident.",
  amount: { text: "S$120,000", currencyResolved: true, illustration: false }, basis: `20% of ${person}'s Personal Accident sum insured of S$600,000`,
  conditions: ["The injury must result from an accident."], asOf: "2022-10-06", source: { policyName: "Group Certificate", page: 1, citationIds: [] }, ...over,
});
const html = (statements: AnswerStatement[], extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(AnswerCards, { answer: { summary: "", bottomLine: "Yes, an arm fracture is covered.", nextSteps: [], questions: [], citations: [], statements } as unknown as StructuredAnswer,
  render: customerAnswerText, prose: [], ...extra }));

t("identical cards for two people become one card naming both, and the first person's name leaves the card's own words", () => {
  const merged = mergeSamePerson([card("a", "Tan Desmond"), card("b", "Ong Charmaine")]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].personName, "Tan Desmond and Ong Charmaine, each");
  assert.doesNotMatch(JSON.stringify(merged), /Desmond's/);
  assert.match(merged[0].basis!, /each person's Personal Accident sum insured of S\$600,000/);
});
t("cards that differ in a figure, a condition, a page or a basis amount are never merged", () => {
  assert.equal(mergeSamePerson([card("a", "Tan Desmond"), card("b", "Ong Charmaine", { amount: { text: "S$60,000", currencyResolved: true, illustration: false } })]).length, 2);
  assert.equal(mergeSamePerson([card("a", "Tan Desmond"), card("b", "Ong Charmaine", { conditions: [] })]).length, 2);
  assert.equal(mergeSamePerson([card("a", "Tan Desmond"), card("b", "Ong Charmaine", { source: { policyName: "Group Certificate", page: 2, citationIds: [] } })]).length, 2);
  assert.equal(mergeSamePerson([card("a", "Tan Desmond"), card("b", "Ong Charmaine", { basis: "20% of Ong Charmaine's Personal Accident sum insured of S$300,000" })]).length, 2);
});
t("three people share one card; one person's own repeat is not a second person", () => {
  const m = mergeSamePerson([card("a", "Ana"), card("b", "Ben"), card("c", "Cy"), card("d", "Ana")]);
  assert.equal(m.length, 1);
  assert.equal(m[0].personName, "Ana, Ben and Cy, each");
});
t("the page shows one card for the two people, and the figure once", () => {
  const out = html([card("a", "Tan Desmond"), card("b", "Ong Charmaine")]);
  assert.equal((out.match(/data-testid="answer-card"/g) ?? []).length, 1);
  assert.match(out, /For Tan Desmond and Ong Charmaine, each/);
});
t("marks a page prints after a word are not shown; real symbols and words stay", () => {
  assert.equal(stripMarks("Simple Fracture: Arm#, Elbow, Wrist or Ribs"), "Simple Fracture: Arm, Elbow, Wrist or Ribs");
  assert.equal(stripMarks("Leg^ and Hand† fractures."), "Leg and Hand fractures.");
  assert.equal(stripMarks("Policy # 123 and Plan A are kept"), "Policy # 123 and Plan A are kept");
});
t("'the insurer decides which applies' reads as depending on the case; a claim decision is left as written", () => {
  assert.equal(plainWords("They are not a total; the insurer decides which applies."), "They are not a total; which one applies depends on your case.");
  assert.equal(plainWords("The insurer decides which figure applies."), "Which one applies depends on your case.");
  assert.equal(plainWords("The insurer decides whether the accident is covered."), "The insurer decides whether the accident is covered.");
  assert.equal(plainWords("premium cessation and benefit cessation"), "when premiums stop and when cover ends");
});
t("a benefit's printed terms are labelled 'Depends on your case', not the old phrase", () => {
  const out = html([card("a", "Tan Desmond")]);
  assert.match(out, /Depends on your case/);
  assert.doesNotMatch(out, /not worked out for this case/);
});
t("markers in a card's own conditions and basis are not drawn", () => {
  const out = html([card("a", "Tan Desmond", { basis: "Simple Fracture: Arm# of S$5,000", conditions: ["Applies to Leg^ fractures."] })]);
  assert.doesNotMatch(out, /Arm#|Leg\^/);
});
t("what-to-do questions put the steps before the amounts; other questions keep them after", () => {
  const steps = createElement("div", { "data-testid": "steps" }, "Call the insurer within 120 days.");
  const first = html([card("a", "Tan Desmond")], { after: steps, stepsFirst: true });
  const last = html([card("a", "Tan Desmond")], { after: steps });
  assert.ok(first.indexOf("Call the insurer") < first.indexOf("S$120,000"));
  assert.ok(last.indexOf("Call the insurer") > last.indexOf("S$120,000"));
  for (const q of ["What should I do after a car accident?", "How do I claim?", "What are the next steps?", "who should I call"]) assert.ok(asksWhatToDo(q), q);
  for (const q of ["How much do I get for a broken arm?", "Is my dog covered?", "When does my policy end?"]) assert.ok(!asksWhatToDo(q), q);
});
t("one phone per insurer (the claims line first) and one way to write", () => {
  const text = "Claims hotline: 6123 4567\nEmergency assistance 24 hours: 6765 4321\nEmail claims@harbourline.com.sg\nwww.harbourline.com.sg";
  const found = contactsOnPage(text, 2, "Family PA Schedule", "Harbourline Assurance plc");
  assert.ok(found.length >= 3, "the page prints more than is shown");
  const shown = pick(found);
  assert.equal(shown.filter((c) => c.kind === "phone").length, 1);
  assert.equal(shown.find((c) => c.kind === "phone")!.label, "Claims");
  assert.equal(shown.filter((c) => c.kind !== "phone").length, 1, "an email, so no website");
  assert.equal(shown.find((c) => c.kind === "email")?.value, "claims@harbourline.com.sg");
});
t("a filing code is not a document's title; a name a person chose is", () => {
  assert.equal(personalFileName("1105 CD-594 COI_SAF.pdf"), null);
  assert.equal(personalFileName("COI_SAF_2022.pdf"), null);
  assert.equal(personalFileName("Product Summary.pdf"), "Product Summary");
  assert.equal(personalFileName("Shield Plan 2026.pdf"), "Shield Plan 2026");
  assert.equal(personalFileName("Daniel PA Policy.pdf"), "Daniel PA Policy");
});
console.log(`plain answers: ${passed} passed`);

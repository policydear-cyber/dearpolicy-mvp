/**
 * DC, 16 Nov 2026: answers say what the documents show and what to do, without narrating the checks behind them, and
 * give the insurer's contact details where they help, read only from the household's own documents.
 *
 * Part 1 (declutter): the narration goes, every safeguard stays: an amount card keeps every word; a sentence that adds
 * anything of its own stays; a left-out amount is still left out (and in the turn's report).
 * Part 2 (contacts): numbers, emails and websites are taken only where the page's own words say they reach the insurer;
 * a regulator's, an agent's, a hospital's, a fax, a policy number or a money figure is never one; a domain must carry the
 * insurer's own name. Any insurer, any layout; no contact found, nothing shown.
 * Part 3: the app's chat turn (runSimpleChat, scripted model, no network or database): the saved answer is the shown one.
 *   node --import tsx scripts/simple-answer/declutter-contacts-test.ts
 */
import assert from "node:assert/strict";
import { CONFIRM_AMOUNT_STEP, CONFIRM_OTHER_AMOUNT_STEP, declutterAnswer, withoutNarration } from "@/lib/simple-chat/declutter";
import { contactsHelp, contactsOnPage, insurerContactsFor } from "@/lib/simple-chat/insurer-contacts";
import { LEFT_OUT_AMOUNT, LEFT_OUT_FACT } from "@/lib/simple-chat/verify";
import { NARROWED_PAGES_NOTE } from "@/lib/benefit-table/chat";
import type { AnswerStatement } from "@/components/answer-cards";
import type { Household } from "@/lib/simple-chat/library";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import type { SimpleModel } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";

let passed = 0; const failures: string[] = [];
async function t(name: string, fn: () => Promise<void> | void) { try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); console.log(`not ok - ${name}`); } }

const SEPARATE = "These are separate covers. The pages I used don't say whether one affects the other, so the insurer decides. They are not added up.";
const point = (id: string, text: string, extra: Partial<AnswerStatement> = {}): AnswerStatement => ({ id, kind: "uncertainty", text, fullText: text, conditions: [], ...extra });
const card = (id: string, text: string): AnswerStatement => ({ id, kind: "benefit_terms", text, fullText: text, conditions: ["Only if admitted for at least 24 hours."], personName: "Grace", amount: { text: "S$5,000", currencyResolved: true, illustration: false } });

async function main() {
  // ------------------------------------------------------------------ part 1: declutter
  await t("the server's narration notes go, by id or by their words", () => {
    const a = { summary: "x", bottomLine: "x", nextSteps: [], statements: [card("s1", "Accidental death."), point("left-out-amount", LEFT_OUT_AMOUNT), point("narrowed-pages", NARROWED_PAGES_NOTE), point("left-out-fact", LEFT_OUT_FACT), point("m1", "I've left out an amount I couldn't match to your documents.")] };
    const removed = declutterAnswer(a);
    assert.deepEqual(a.statements.map((s) => s.id), ["s1"]);
    assert.equal(removed.length, 4);
  });
  await t("the separate-covers line goes whole, in a point, the bottom line or a step; nothing else in those sentences is touched", () => {
    const a = { summary: `Both covers pay on death. ${SEPARATE}`, bottomLine: `Both covers pay on death. ${SEPARATE}`, nextSteps: [`Tell the insurer within 30 days. ${SEPARATE}`],
      statements: [point("m1", SEPARATE), point("m2", `${SEPARATE} Claims must be made within 90 days.`)] };
    declutterAnswer(a);
    assert.equal(a.bottomLine, "Both covers pay on death.");
    assert.equal(a.summary, "Both covers pay on death.");
    assert.deepEqual(a.nextSteps, ["Tell the insurer within 30 days."]);
    assert.deepEqual(a.statements.map((s) => s.text), ["Claims must be made within 90 days."]);
  });
  await t("a sentence that says something of its own is never taken out (negative controls)", () => {
    for (const s of ["These are separate covers under the same policy, so both are counted.", "The Life policy and the PA policy can both pay; the PA benefit is paid only once.",
      "They are not added up because the PA benefit replaces the life benefit.", "The insurer decides whether the accident is covered.", "S$1,250 and S$1,500 come from different parts of your documents. They are not a total; the insurer decides which applies.",
      "This benefit can only be claimed under one scheme.", "Grace's hospital cash is left out of the Shield plan if she claims under it.",
      // Critic #505 M1: the model's own sentences that start like the note.
      "Left out amounts are those under the rider, which ends at age 65.", "I left out the rider because you asked only about the base plan."])
      assert.equal(withoutNarration(s), s, s);
  });
  await t("an amount card keeps every word, even a sentence that reads like narration", () => {
    const c = card("s1", `Accidental death. ${SEPARATE}`);
    const a = { summary: "x", statements: [c] };
    declutterAnswer(a);
    assert.equal(a.statements[0].text, `Accidental death. ${SEPARATE}`);
    assert.deepEqual(a.statements[0].conditions, ["Only if admitted for at least 24 hours."]);
  });
  await t("a point whose words all go but which carries a condition keeps its condition", () => {
    const a = { summary: "x", statements: [point("m1", SEPARATE, { conditions: ["Cover ends once the full sum insured is paid."] })] };
    declutterAnswer(a);
    assert.equal(a.statements.length, 1);
    assert.deepEqual(a.statements[0].conditions, ["Cover ends once the full sum insured is paid."]);
  });
  await t("a left-out amount with no amount shown becomes one step to confirm it; with an amount shown, nothing is added", () => {
    const none = { summary: "x", nextSteps: [] as string[], statements: [point("left-out-amount", LEFT_OUT_AMOUNT)] };
    declutterAnswer(none);
    assert.deepEqual(none.nextSteps, [CONFIRM_AMOUNT_STEP]);
    const some = { summary: "x", nextSteps: [] as string[], statements: [card("s1", "Accidental death."), point("left-out-amount", LEFT_OUT_AMOUNT)] };
    declutterAnswer(some);
    // Critic #505 M2: with other amounts shown, the household still gets a cue that another may apply.
    assert.deepEqual(some.nextSteps, [CONFIRM_OTHER_AMOUNT_STEP]);
  });

  await t("DECL-20261116-B/C: a sentence about what the app shows is taken out; one that says what the documents print stays", () => {
    assert.equal(withoutNarration("Wei Ling has a hospital cash benefit after an accident. No amount card is shown for it, as the stay would need to follow an accident."), "Wei Ling has a hospital cash benefit after an accident.");
    assert.equal(withoutNarration("The PA plan has a hospital cash benefit. The pages shown do not give an amount for it that can be shown here."), "The PA plan has a hospital cash benefit.");
    // Kept: what the documents print, a condition, or a card mentioned without saying an amount is missing.
    for (const keep of ["The schedule prints no amount for outpatient care.", "Keep the card the hospital gives you for the claim.", "The benefit is not payable unless the stay follows an accident."])
      assert.equal(withoutNarration(keep), keep);
  });
  await t("DECL-20261116 b1: 'you can claim from <insurer>' is left as written (no 'may respond with from'), so the live and reopened answer match; an amount promise is still rewritten", async () => {
    const { scrubMonetaryText } = await import("@/lib/chat/monetary-boundary");
    assert.equal(scrubMonetaryText("so you can claim from Merlion General."), "so you can claim from Merlion General.");
    assert.match(scrubMonetaryText("You will get the benefit."), /^the policy may respond with the benefit\.$/);
  });
  // ------------------------------------------------------------------ part 2: contacts from the page
  const on = (text: string, insurer = "Harbourline Assurance plc") => contactsOnPage(text, 2, "Family PA Schedule", insurer).map((c) => `${c.kind}|${c.label}|${c.value}`);
  await t("a claims line printed in a sentence, with its label after it (TE fixture wording)", () => {
    assert.deepEqual(on("How to claim: notify Harbourline Assurance within 30 days of the accident on 0800 000 0000 (claims line) and send the completed claim form with the original hospital discharge summary."),
      ["phone|Claims|0800 000 0000"]);
  });
  await t("common layouts: hotline, +country code, Tel: with no spaces, 24-hour assistance, email and website of the insurer", () => {
    const page = "Customer Service Hotline: 1800 333 0333\nClaims Hotline +65 6788 8833\nTel: 62345678 (Mon-Fri)\n24-hour Emergency Assistance: +65 6322 2000\nEmail: claims@income.com.sg\nVisit www.income.com.sg/claims for forms.";
    assert.deepEqual(on(page, "NTUC Income Insurance Co-operative Limited"), ["phone|Phone|1800 333 0333", "phone|Claims|+65 6788 8833", "phone|Emergency assistance|+65 6322 2000", "phone|Phone|62345678", "email|Claims email|claims@income.com.sg", "website|Website|www.income.com.sg/claims"]);
  });
  await t("Critic #505 LOW: \"Private\" is a generic name word, so an insurer's own heading is still its own", () => {
    assert.deepEqual(on("AIA Singapore\nCustomer Care: 1800 248 8000", "AIA Singapore Private Limited"), ["phone|Phone|1800 248 8000"]);
  });
  await t("never the insurer's: a regulator or dispute body, an agent, a hospital, a fax, a policy number, a money figure, a date", () => {
    const page = ["If you are not satisfied, contact FIDReC at 6327 8878 or www.fidrec.com.sg.", "Your agent: John Tan, tel 9123 4567.", "Fax: 6222 1111", "Policy No. 1234 5678 9012 — quote it on all claims.",
      "Claims are paid up to S$ 20 000 per year.", "Call Raffles Hospital on 6311 1111 for admission.", "Period of insurance 01/01/2026 to 31/12/2026", "Contact the Monetary Authority of Singapore (MAS) at 6225 5577.",
      "Email your adviser at john.tan@gmail.com", "Claims enquiries: claims@thirdpartyadmin.com"].join("\n");
    assert.deepEqual(on(page), []);
  });
  await t("Critic #505 H1: another organisation's number, or an identifier, is never the insurer's", () => {
    for (const line of ["This plan is distributed by DBS Bank. Call DBS at 1800 111 1111 for help.", "MediShield Life is administered by the CPF Board. Call 1800 227 1188.",
      "If you have concerns, contact the Singapore Medical Council at 6355 0632.", "For claims, write to the Ministry of Health 6325 9220.",
      "Please call the hotline of HealthPlus TPA at 6100 2000 for claims.", "Emergency assistance is provided by Global Rescue Services. 24-hour hotline 6111 9999.",
      "Claim ID 1234-5678", "Claims reference 2026 1234 5678", "Account for claims payouts: 0123 4567 8901", "Claims period 2026-2027 1 Jan 2026 to 31 Dec 2026", "Please quote Claim No 3456 7890 when you call.",
      "Emergency assistance is provided by Global Rescue Services.\n24-hour hotline: 6111 9999"])
      assert.deepEqual(on(line), [], line);
  });
  await t("kept: the insurer named or speaking for itself, or a contact line of its own", () => {
    assert.deepEqual(on("For claims, call Harbourline Assurance on 6123 4567."), ["phone|Claims|6123 4567"]);
    assert.deepEqual(on("Questions? Please call our Customer Care team at 6234 5678."), ["phone|Phone|6234 5678"]);
    assert.deepEqual(on("CONTACT\nClaims Hotline: 6345 6789"), ["phone|Claims|6345 6789"]);
  });
  await t("Critic #505 H1 round 2: an everyday word of the insurer's name, another party a few lines up, another insurer's heading, 'by <Name>', 'call us' in another party's paragraph", () => {
    assert.deepEqual(on("For income tax queries, call IRAS at 1800 356 8300.", "Income Insurance Limited"), []);
    assert.deepEqual(on("Great savings! For claims under the travel add-on, call Allied World at 6423 0888.", "Great Eastern Life Assurance"), []);
    assert.deepEqual(on("EMERGENCY ASSISTANCE SERVICES\nYour overseas emergency assistance partner is Global Rescue Pte Ltd.\nThey operate around the clock.\nWhat to do\n24-hour Hotline: +65 6338 7800"), []);
    assert.deepEqual(on("Mount Elizabeth Hospital\nAdmissions\nHotline: 6731 2218"), []);
    assert.deepEqual(on("AIA Singapore\nCustomer Care: 1800 248 8000"), []);
    assert.deepEqual(on("Medical Concierge by Healix\nCall: 6100 2000"), []);
    assert.deepEqual(on("HealthPlus Medical Claims Services handles all outpatient claims. Call us at 6100 2000."), []);
  });
  await t("Critic #505 H1 round 2 controls: the insurer's own heading, 'our' hotline, the insurer named in full, still kept", () => {
    assert.deepEqual(on("Harbourline Assurance\nClaims Hotline: +65 6788 8833"), ["phone|Claims|+65 6788 8833"]);
    assert.deepEqual(on("Please call our Customer Service hotline at 6788 8833."), ["phone|Phone|6788 8833"]);
    assert.deepEqual(on("For claims, call Income Insurance at 6788 1777.", "Income Insurance Limited"), ["phone|Claims|6788 1777"]);
    assert.deepEqual(on("Great Eastern Customer Service: 1800 248 2888", "Great Eastern Life Assurance"), ["phone|Phone|1800 248 2888"]);
  });
  await t("Critic #505 L1: a host that is only part of the insurer's name is not its domain", () => {
    assert.deepEqual(on("Visit www.line.com or email help@line.com"), []);
    assert.deepEqual(on("Email help@dent.sg", "Prudential Assurance Company Singapore"), []);
  });
  await t("a number with no words saying it reaches anyone is not a contact", () => {
    assert.deepEqual(on("Plan code 3456 7890\nMember 1234 5678"), []);
  });
  await t("an email or website is kept only on the insurer's own domain", () => {
    assert.deepEqual(on("Email claims@harbourline.co.uk or see https://www.harbourline.co.uk/claims"), ["email|Claims email|claims@harbourline.co.uk", "website|Website|https://www.harbourline.co.uk/claims"]);
    assert.deepEqual(on("Email claims@harbourline.co.uk", "Merlion General Insurance"), []);
  });
  await t("contacts help an answer with next steps, or a question about claiming or reaching the insurer; not a plain list question", () => {
    assert.ok(contactsHelp({ nextSteps: ["Send the claim form."] }, "what is Grace covered for?"));
    assert.ok(contactsHelp({ nextSteps: [] }, "How do I claim for Grace's fracture?"));
    assert.ok(contactsHelp({ nextSteps: [] }, "what's the hotline number?"));
    assert.ok(!contactsHelp({ nextSteps: [] }, "What is Grace covered for?"));
  });

  // ------------------------------------------------------------------ household selection
  const doc = (policyId: string, insurer: string | null, pages: { page: number; text: string }[], extra: Record<string, unknown> = {}) => ({ policyId, name: `${policyId}.pdf`, insurer, productName: `Product ${policyId}`, policyNumber: null,
    documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: ["Grace"], supersededAt: null, processingStatus: "ready", pages, ...extra });
  const HOUSE = { accountId: "a", members: [{ name: "Grace", relationship: "self" }], documents: [
    doc("A1", "Harbourline Assurance plc", [{ page: 1, text: "Schedule. Grace S$20,000" }]),
    doc("A2", "HARBOURLINE ASSURANCE", [{ page: 4, text: "Claims line: 0800 000 0000" }]),
    doc("B1", "Merlion General Insurance", [{ page: 1, text: "Customer service hotline 6000 0000" }]),
    doc("C1", "Orchid Life", [{ page: 1, text: "Hotline 6111 2222" }], { processingStatus: "failed" }),
    doc("D1", "Kallang Insurance", [{ page: 1, text: "Hotline 6333 4444" }], { supersededAt: "2026-10-01" }),
  ] } as unknown as Household;
  const label = (d: { policyId: string }) => `Doc ${d.policyId}`;
  await t("contacts for the cited documents' insurers, from that insurer's other documents too; not for insurers the answer does not cite", () => {
    const got = insurerContactsFor(HOUSE, { citations: [{ policyId: "A1" } as never] }, label);
    assert.deepEqual(got, [{ insurer: "Harbourline Assurance plc", items: [{ kind: "phone", label: "Claims", value: "0800 000 0000", source: { policyName: "Doc A2", page: 4 } }] }]);
  });
  await t("DECL-20261116 c1: a question naming one insurer shows only that insurer's contacts, never another cited one's", () => {
    const both = { citations: [{ policyId: "A1" } as never, { policyId: "B1" } as never] };
    // Names Merlion: only Merlion, even though Harbourline is cited first.
    assert.deepEqual(insurerContactsFor(HOUSE, both, label, "How do I claim from merlion?").map((c) => c.insurer), ["Merlion General Insurance"]);
    // Names Merlion, which the answer does not cite: its contact still comes from its own pages.
    assert.deepEqual(insurerContactsFor(HOUSE, { citations: [{ policyId: "A1" } as never] }, label, "How do I claim with Merlion General?").map((c) => c.insurer), ["Merlion General Insurance"]);
    // Names Orchid Life (no readable page with a contact): nothing, not the cited Harbourline or Merlion numbers.
    assert.deepEqual(insurerContactsFor(HOUSE, both, label, "How do I make a claim with Orchid Life for Daniel's hospital stay?"), []);
    // Names no insurer: every cited insurer, as before.
    assert.deepEqual(insurerContactsFor(HOUSE, both, label, "How do I claim for Grace?").map((c) => c.insurer), ["Harbourline Assurance plc", "Merlion General Insurance"]);
  });
  await t("a document not read, or replaced by a newer one, gives no contact; no contact found shows nothing", () => {
    assert.deepEqual(insurerContactsFor(HOUSE, { citations: [{ policyId: "C1" } as never, { policyId: "D1" } as never] }, label), []);
    assert.deepEqual(insurerContactsFor(HOUSE, { citations: [] }, label), []);
  });

  // ------------------------------------------------------------------ part 3: the app's chat turn
  await t("in the app's chat turn: the separate-covers point is not saved, contacts are saved from the pages, and the model's own numbers are not used", async () => {
    const H = { accountId: "44444444-4444-4444-4444-444444444444", members: [{ name: "Grace Tan", relationship: "self" }], documents: [
      doc("aaaaaaaa-0000-0000-0000-000000000001", "Harbourline Assurance plc", [{ page: 1, text: "PERSONAL ACCIDENT SCHEDULE\nInsured: Grace Tan\nAccidental death benefit S$100,000" },
        { page: 2, text: "How to claim: notify Harbourline Assurance within 30 days of the accident on 0800 000 0000 (claims line)." }], { name: "PA Schedule.pdf", linkedPeople: ["Grace Tan"] }),
    ] } as unknown as Household;
    const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() {
      return { json: { bottomLine: "Grace's personal accident policy pays an accidental death benefit.", question: null,
        nextSteps: ["Notify Harbourline Assurance within 30 days of the accident."],
        statements: [
          { kind: "fact", text: "Grace's personal accident policy pays an accidental death benefit.", person: "Grace Tan", document: "D1", quote: "Accidental death benefit", amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null },
          { kind: "uncertainty", text: SEPARATE, person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null },
        ] }, stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } };
    } };
    const context = { request: { accountId: H.accountId, familyMemberId: null, question: "If Grace died in an accident, what do we do?", submittedQuestion: "If Grace died in an accident, what do we do?" },
      family: [{ id: "p1", display_name: "Grace Tan", preferred_name: null, relationship: "self" }], people: [],
      conversation: { id: "c1", account_id: H.accountId, family_member_id: null, title: "t", revision: 1, state: {} }, token: {}, holdings: [] } as unknown as ChatContext;
    const saved: { answer: Record<string, unknown> & { statements?: AnswerStatement[] }; state: { simpleChat: { turns: { report: { sentencesLeftOut: string[] } }[] } } }[] = [];
    const out = await runSimpleChat(context, {}, { model, household: async () => H, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false, table: async () => null, today: () => new Date("2026-11-16T04:00:00Z") });
    const answer = saved[0].answer;
    assert.ok(!JSON.stringify(answer).includes("These are separate covers"), JSON.stringify(answer.statements));
    assert.ok(saved[0].state.simpleChat.turns[0].report.sentencesLeftOut.some((s) => s.includes("These are separate covers")), "kept in the report");
    assert.deepEqual(answer.insurerContacts, [{ insurer: "Harbourline Assurance plc", items: [{ kind: "phone", label: "Claims", value: "0800 000 0000", source: { policyName: (answer.insurerContacts as { items: { source: { policyName: string } }[] }[])[0].items[0].source.policyName, page: 2 } }] }]);
    // The answer returned is the answer saved.
    assert.deepEqual(JSON.parse(JSON.stringify(out.answer)), JSON.parse(JSON.stringify(answer)));
  });

  console.log(`declutter + contacts: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length) process.exit(1);
}
void main();

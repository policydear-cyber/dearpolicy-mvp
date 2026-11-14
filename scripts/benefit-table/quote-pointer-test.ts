/** A promise of the policy's words "quoted below" with nothing below (TE R3 H2-A t2, made-up documents here): asked what an
 * angioplasty pays, the answer said "I can't show it as an amount benefit, but the policy's wording is quoted below", and
 * no quote of that benefit followed. #473 (chat.ts QUOTE_POINTER) only treated an amount, figure, sum, limit or rate as
 * promised.
 *
 * What this pins down (chat.ts dropQuotePointers):
 * - words that say the policy's wording, terms, text, clause, definition or quote is quoted, shown or set out below, "see
 *   the quote below", and ", quoted below", stay only when the answer carries a point's quote of that benefit: a quote
 *   that prints a word of the name of a benefit the text names, or, when the text names none, any quote;
 * - else they go as an amount's promise does: the clause that only promises goes, a "where" phrase goes, "the terms are
 *   quoted below and apply ..." keeps what the words do, with "is"/"are" kept only before no verb of its own; a sentence
 *   that is only the promise goes; a bottom line left empty says "Here is what your documents say.";
 * - a quote of another benefit (the waiting period's) is not a quote of this one; a server label is never changed;
 * - words about quotes that promise nothing below ("the insurer quoted a premium", "as quoted in your schedule") stay.
 * No model, database or network.
 *   npm run benefit-table:quote-pointer-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { dropQuotePointers, WORDING_POINTER } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import type { SimpleModel } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const WAIT = "no critical illness benefit is payable for an illness diagnosed within 90 days of the\ncover start date";
const ANGIO_QUOTE = "Angioplasty and other invasive treatment for 10% of the Sum Covered, up to a maximum of\ncoronary artery RM 25,000";
type St = { text: string; fullText?: string; source?: { citationIds?: string[] } | null; amount?: unknown };
const answerOf = (bottom: string, statements: [string, string | null][]) => {
  const citations = statements.flatMap(([, q], i) => (q ? [{ chunkId: `c${i}`, excerpt: q }] : []));
  return { summary: bottom, bottomLine: bottom, citations,
    statements: statements.map(([text, q], i): St => ({ text, fullText: text, source: q ? { citationIds: [`c${i}`] } : null })) };
};
const BOTTOM = "Her CI Protect plan has a separate benefit for angioplasty and other invasive treatment for coronary artery. I can't show it as an amount benefit, but the policy's wording is quoted below.";

async function main() {
  await test("the live answer: only the waiting period is quoted, so the promise of the angioplasty wording goes", () => {
    const a = answerOf(BOTTOM, [["The 90-day waiting period is worded for critical illness benefits.", WAIT]]);
    const left = dropQuotePointers(a, []);
    assert.equal(a.bottomLine, "Her CI Protect plan has a separate benefit for angioplasty and other invasive treatment for coronary artery. I can't show it as an amount benefit.");
    assert.equal(a.summary, a.bottomLine);
    assert.deepEqual(left, ["I can't show it as an amount benefit, but the policy's wording is quoted below."]);
    assert.equal(a.statements.length, 1);
  });
  await test("with the angioplasty row's own quote in a point, the promise stays", () => {
    for (const quote of [ANGIO_QUOTE, "Angioplasty and other invasive treatment for"]) {
      const a = answerOf(BOTTOM, [["The 90-day waiting period is worded for critical illness benefits.", WAIT], ["The angioplasty benefit is a share of the Sum Covered.", quote]]);
      assert.deepEqual(dropQuotePointers(a, []), []);
      assert.equal(a.bottomLine, BOTTOM);
    }
  });
  await test("a text that names no benefit keeps its promise when any point carries a quote, and loses it when none does", () => {
    const bottom = "I can't show an amount for this, but the policy's wording is quoted below.";
    const a = answerOf(bottom, [["The plan pays a share of the Sum Covered.", ANGIO_QUOTE]]);
    dropQuotePointers(a, []);
    assert.equal(a.bottomLine, bottom);
    const b = answerOf(bottom, [["The plan pays a share of the Sum Covered.", null]]);
    dropQuotePointers(b, []);
    assert.equal(b.bottomLine, "I can't show an amount for this.");
  });
  await test("the same rewriting as an amount's promise: clauses, 'where' phrases, 'and' with its verb, a name", () => {
    const cases: [string, string | null][] = [
      ["The policy's wording is quoted below.", null],
      ["See the quote below.", null],
      ["The angioplasty terms are set out below.", null],
      ["Angioplasty is covered as a share of the Sum Covered, quoted below.", "Angioplasty is covered as a share of the Sum Covered."],
      ["Angioplasty is covered as a share of the Sum Covered (see the quote below).", "Angioplasty is covered as a share of the Sum Covered."],
      ["Angioplasty is covered as a share of the Sum Covered - see the wording below.", "Angioplasty is covered as a share of the Sum Covered."],
      ["Angioplasty is covered, with the policy's clause set out below.", "Angioplasty is covered."],
      ["Angioplasty is covered, and the exact text is shown below.", "Angioplasty is covered."],
      ["The angioplasty terms are quoted below and apply only to treatment in Malaysia.", "The angioplasty terms apply only to treatment in Malaysia."],
      ["The angioplasty wording is quoted below and does not mention day surgery.", "The angioplasty wording does not mention day surgery."],
      ["The angioplasty wording is quoted below and is the same in both documents.", "The angioplasty wording is the same in both documents."],
      ["The angioplasty definition is quoted here and needs a cardiologist's report.", "The angioplasty definition needs a cardiologist's report."],
      ["The angioplasty wording quoted below says the treatment must be medically necessary.", "The angioplasty wording says the treatment must be medically necessary."],
      ["The angioplasty clauses reproduced below are reduced by any earlier claim.", "The angioplasty clauses are reduced by any earlier claim."],
    ];
    for (const [sentence, want] of cases) {
      const a = answerOf("Here is the angioplasty benefit.", [[sentence, null]]);
      dropQuotePointers(a, []);
      if (want == null) assert.equal(a.statements.length, 1 - 1, `${sentence} -> ${a.statements.map((s) => s.text).join(" | ")}`);
      else assert.equal(a.statements[0]?.text, want, sentence);
      if (want != null) assert.equal(a.statements[0].fullText, want);
    }
  });
  await test("a point carrying its own quote keeps its promise; a person's or product's name is no benefit word", () => {
    const a = answerOf("Here is what the plan says.", [["The waiting period wording is quoted below.", WAIT]]);
    dropQuotePointers(a, []);
    assert.equal(a.statements[0].text, "The waiting period wording is quoted below.");
    // "Mira" and "Heart Care Plus" are in the waiting period's quote too: they say nothing of which benefit is meant.
    const bottom = "Mira's Heart Care Plus pays for angioplasty, but the policy's wording is quoted below.";
    const b = answerOf(bottom, [["The waiting period applies to Mira's Heart Care Plus.", "Heart Care Plus for Mira: no critical illness benefit is payable within 90 days"]]);
    dropQuotePointers(b, [], ["Mira Halden", "HEART CARE PLUS", "Kestrel Mutual"]);
    assert.equal(b.bottomLine, "Mira's Heart Care Plus pays for angioplasty.");
    // Without the names, "heart" would be taken as the benefit's word, and the promise kept: the names are what tells.
    const c = answerOf(bottom, [["The waiting period applies to Mira's Heart Care Plus.", "Heart Care Plus for Mira: no critical illness benefit is payable within 90 days"]]);
    dropQuotePointers(c, []);
    assert.equal(c.bottomLine, bottom);
  });
  await test("a bottom line that is only the promise says what the documents say", () => {
    const a = answerOf("The angioplasty wording is quoted below.", [["The 90-day waiting period is worded for critical illness benefits.", WAIT]]);
    dropQuotePointers(a, []);
    assert.equal(a.bottomLine, "Here is what your documents say.");
  });
  await test("words about quotes that promise nothing below, and a server label, are never changed", () => {
    for (const s of ["The insurer quoted a premium at renewal.", "Hospital income is paid as quoted in your schedule.", "The wording on page 2 decides.", "A stay below three days is not paid.",
      "The terms below the table apply to every benefit.", "The details are shown on the card."]) {
      assert.equal(WORDING_POINTER.test(s), false, s);
      const a = answerOf(s, [[s, null]]);
      dropQuotePointers(a, []);
      assert.equal(a.bottomLine, s);
      assert.equal(a.statements[0].text, s);
    }
    const label = "Angioplasty: the wording is quoted below.";
    const a = answerOf("Here it is.", [[label, null]]);
    dropQuotePointers(a, [label]);
    assert.equal(a.statements[0].text, label);
  });

  await test("end to end: the live turn's reply loses the broken promise; the waiting period point stays", async () => {
    const DOC = "eeeeeeee-0000-4000-8000-0000000000cc", PERSON = "Mira Halden", PRODUCT = "HEART CARE PLUS";
    const pages = [{ page: 1, text: `Kestrel Mutual\n${PRODUCT} - POLICY SCHEDULE\nPerson covered: ${PERSON}\tCurrency: Ringgit Malaysia (RM)\nBenefit\tAmount\nSum covered (critical illness)\tRM 200,000` },
      { page: 2, text: "BENEFIT PROVISIONS\nBenefit\tWhat is paid\nEarly-stage critical illness\t25% of the Sum Covered, up to a maximum of\nRM 50,000, once per lifetime\n"
        + "Waiting period: no critical illness benefit is payable for an illness diagnosed within 90 days of the\ncover start date (1 April 2026)." }];
    const src: SourceDoc = { id: DOC, name: "schedule.pdf", readable: true, pages };
    const r = checkReading(src, { document: { kind: "personal_proof", product: PRODUCT, insurer: "Kestrel Mutual", namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null },
      covers: [{ person: PERSON, product: PRODUCT, cover: "Critical illness", plan: null, policyNumber: null, sumInsured: 200000, premium: null, premiumFrequency: null, asOf: null, startDate: "1 April 2026", endDate: null, page: 1, quote: "Sum covered (critical illness)\tRM 200,000" }],
      benefits: [{ section: "BENEFIT PROVISIONS", column: null, benefit: "Early-stage critical illness", pays: "percent", value: 25, percentOf: "sum_insured", cap: 50000, capQuote: "up to a maximum of\nRM 50,000", period: null, basis: null, baseAmount: null, baseQuote: null, conditions: [], page: 2,
        quote: "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of\nRM 50,000, once per lifetime" }] });
    const family: FamilyMember[] = [{ id: "p1", display_name: PERSON }];
    const t = assembleTable([r], family, [...new Set(r.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: coverKeyOf({ product: PRODUCT, cover: "Critical illness", plan: null, riderOf: null }), why: "the schedule's benefits" })), [], new Date("2026-11-14T04:00:00Z"));
    const house: Household = { accountId: "22222222-2222-4222-8222-222222222222", members: [{ name: PERSON, relationship: "self" }],
      documents: [{ policyId: DOC, name: "schedule.pdf", insurer: "Kestrel Mutual", productName: PRODUCT, policyNumber: null, documentType: null, documentRole: null, effectiveDate: null,
        expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: [PERSON], supersededAt: null, processingStatus: "ready", pages } as never] };
    const reply = { bottomLine: "Mira's Heart Care Plus has a separate benefit for angioplasty and other invasive treatment for coronary artery. I can't show it as an amount benefit, but the policy's wording is quoted below.",
      nextSteps: [], question: null, statements: [{ kind: "uncertainty", text: "The 90-day waiting period is worded for critical illness benefits. Her cover started on 1 April 2026, so that period has passed either way.",
        person: PERSON, document: "D1", quote: "no critical illness benefit is payable for an illness diagnosed within 90 days of the\ncover start date (1 April 2026)", amount: null, percentOf: null,
        conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, rowBenefit: null, eventFit: null, waiting: null, period: null }] };
    const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() { return { json: reply, stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
    const q = "If she had an angioplasty instead, how much would that pay?";
    const context = { request: { accountId: house.accountId, familyMemberId: null, question: q, submittedQuestion: q }, family: [], people: [],
      conversation: { id: "c1", account_id: house.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } }, token: {}, holdings: [] } as unknown as ChatContext;
    const saved: { answer: { bottomLine?: string; summary: string; statements?: { text: string }[] } }[] = [];
    await runSimpleChat(context, {}, { model, household: async () => house, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false,
      table: async () => t, today: () => new Date("2026-11-14T04:00:00Z") });
    const a = saved[0].answer;
    const texts = [a.bottomLine ?? a.summary, ...(a.statements ?? []).map((s) => s.text)];
    for (const x of texts) assert.ok(!/\bbelow\b/i.test(x), `promises what is not shown: ${x}`);
    assert.ok((a.bottomLine ?? "").startsWith("Mira's Heart Care Plus has a separate benefit for angioplasty"), a.bottomLine);
    assert.ok(texts.some((x) => /waiting period/.test(x)), texts.join(" | "));
  });

  console.log(`${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`FAIL ${f}`);
  if (failures.length) process.exit(1);
}
void main();

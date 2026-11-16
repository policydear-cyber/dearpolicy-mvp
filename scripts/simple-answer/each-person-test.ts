/** Scripted tests: a claim question that says "I" (or names no one), in a chat for no one in particular, in a household
 * of more than one member, answered by the model with only "whose is it?" and no figure (TE EFF-20261115-01, SG1: an early
 * stage heart attack, two members each with an early stage critical illness cover). The model is asked once more for each
 * member's own figures; every figure that reply gives goes through the usual checks, so each one shown is its own member's,
 * labelled with that member, and the question whose it is stays. A figure given under the wrong member is never shown.
 * Made-up household; no model, network or database.
 *   npm run -s simple:each-person-test */
import assert from "node:assert/strict";
import type { StructuredAnswer } from "@/components/answer-cards";
import type { ChatContext } from "@/lib/chat/workflow";
import type { Household } from "@/lib/simple-chat/library";
import type { SimpleModel, SimpleModelCall } from "@/lib/simple-chat/model";
import { EACH_PERSON_NOTE, runSimpleChat, type SimpleChatState } from "@/lib/simple-chat/hook";
import { assembleTable, coverKeyOf, sectionKeyOf, type BenefitTable, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { chatRows } from "@/lib/benefit-table/chat";
import { replayModel, runSet } from "./app-run";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const ACCOUNT = "71717171-7171-4717-8717-717171717171";
const A = "Wong Kai Ming", B = "Lee Siew Lan";
const WORDING = "Policy Wording - Part 1\n1.2 Heart Attack of Specified Severity (Early Stage, Intermediate Stage, Severe Stage). Early stage means the condition has been diagnosed but does not yet meet the severe stage definition.";
const doc = (policyId: string, name: string, productName: string, insurer: string, person: string, role: string, text: string) => ({ policyId, name, insurer, productName, policyNumber: null, documentType: null,
  documentRole: role, effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-20", uploadedFor: person, linkedPeople: [person], supersededAt: null, processingStatus: "ready", pages: [{ page: 1, text }] });
const DOCS = [
  doc("d1000000-0000-4000-8000-000000000001", "Heartline Schedule.pdf", "Heartline Cover", "Kestrel Assurance", A, "schedule",
    `Kestrel Assurance\nPolicy Schedule - Heartline Cover\nLife Assured: ${A}\nSum Assured (Critical Illness): S$200,000\nEarly Stage Critical Illness Benefit: 25% of Sum Assured, up to S$50,000 per claim\nAggregate limit, all Early Stage claims: S$100,000`),
  doc("d1000000-0000-4000-8000-000000000002", "Heartline Wording.pdf", "Heartline Cover", "Kestrel Assurance", A, "policy_wording", `Kestrel Assurance - ${WORDING}`),
  doc("d1000000-0000-4000-8000-000000000003", "Bright Start Certificate.pdf", "Bright Start", "Harrow Life", B, "certificate",
    `Harrow Life\nCertificate - Bright Start\nInsured: ${B}\nSum Assured: S$90,000\nEarly stage: 20% of Sum Assured, maximum S$18,000 per claim\nOverall early stage limit: S$45,000`),
  doc("d1000000-0000-4000-8000-000000000004", "Bright Start Wording.pdf", "Bright Start", "Harrow Life", B, "policy_wording", `Harrow Life - ${WORDING}`),
];
const house = (members: { name: string; relationship: string }[] = [{ name: A, relationship: "self" }, { name: B, relationship: "spouse" }], documents = DOCS): Household =>
  ({ accountId: ACCOUNT, members, documents } as unknown as Household);
const OWN: Record<string, string[]> = { [A]: ["S$50,000", "S$100,000"], [B]: ["S$18,000", "S$45,000"] };

const st = (kind: string, text: string, person: string | null, document: string | null, quote: string | null, amount: string | null) =>
  ({ kind, text, person, document, quote, amount, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
/** SG1 as the model answered it: one fact per member, no figure, and a question. */
const WHOSE_ONLY = { bottomLine: `The question doesn't say whose diagnosis this is. ${A}'s Heartline Cover and ${B}'s Bright Start each have an early stage benefit, so I need to know whose it is before giving the amounts.`,
  statements: [
    st("fact", "If it's Kai Ming, his Heartline Cover prints an early stage benefit.", A, "D1", "Early Stage Critical Illness Benefit: 25% of Sum Assured, up to S$50,000 per claim", null),
    st("fact", "If it's Siew Lan, her Bright Start prints an early stage benefit.", B, "D3", "Early stage: 20% of Sum Assured, maximum S$18,000 per claim", null),
  ], nextSteps: [], question: `Whose diagnosis is this: ${A}'s or ${B}'s?` };
/** Each member's own figures, then the question. */
const EACH = { bottomLine: "The question says \"I\" without a name, so here is what each member's documents show for an early stage heart attack.",
  statements: [
    st("amount", "Kai Ming: the early stage benefit is capped per claim.", A, "D1", "Early Stage Critical Illness Benefit: 25% of Sum Assured, up to S$50,000 per claim", "S$50,000"),
    st("amount", "Kai Ming: the most all early stage claims pay together.", A, "D1", "Aggregate limit, all Early Stage claims: S$100,000", "S$100,000"),
    st("amount", "Siew Lan: the early stage benefit is capped per claim.", B, "D3", "Early stage: 20% of Sum Assured, maximum S$18,000 per claim", "S$18,000"),
    st("amount", "Siew Lan: the overall early stage limit.", B, "D3", "Overall early stage limit: S$45,000", "S$45,000"),
  ], nextSteps: [], question: `Who was diagnosed: ${A} or ${B}?` };
/** Figures put under the wrong member: one member's figures said to be the other's, quoting the other's document, and a
 * figure claimed as one member's from the other member's document. */
const WRONG = { bottomLine: "Here is what each member's documents show.",
  statements: [
    st("amount", "Kai Ming: the early stage benefit is capped per claim.", A, "D3", "Early stage: 20% of Sum Assured, maximum S$18,000 per claim", "S$18,000"),
    st("amount", "Siew Lan: the most all early stage claims pay together.", B, "D1", "Aggregate limit, all Early Stage claims: S$100,000", "S$100,000"),
  ], nextSteps: [], question: `Who was diagnosed: ${A} or ${B}?` };
/** Right and wrong together. */
const MIXED = { ...EACH, statements: [...EACH.statements, ...WRONG.statements] };

type Reply = unknown | Error;
async function ask(question: string, replies: Reply[], opts: { memberId?: string | null; household?: Household; table?: BenefitTable; check?: (calls: number) => Promise<void> } = {}) {
  const calls: SimpleModelCall[] = [];
  const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call(args) {
    calls.push(args);
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return { json: structuredClone(r), stopReason: "end_turn", model: "test", usage: { input: 10, cacheWrite: 0, cacheRead: 0, output: 5 } };
  } };
  const h = opts.household ?? house();
  const context = {
    request: { accountId: ACCOUNT, familyMemberId: opts.memberId ?? null, question, submittedQuestion: question },
    family: h.members.map((m, i) => ({ id: `m${i + 1}`, display_name: m.name, preferred_name: null, relationship: m.relationship })), people: [],
    conversation: { id: "c1", account_id: ACCOUNT, family_member_id: opts.memberId ?? null, title: "t", revision: 1, state: { subjects: {} } },
    token: {}, holdings: [],
  } as unknown as ChatContext;
  const saved: { answer: StructuredAnswer; state: SimpleChatState }[] = [];
  await runSimpleChat(context, { check: opts.check ? () => opts.check!(calls.length) : undefined }, { model, household: async () => h, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false, table: async () => opts.table ?? null,
    today: () => new Date("2026-11-15T04:00:00Z") });
  const answer = saved[0].answer;
  const figures = (answer.statements ?? []).filter((s) => s.amount).map((s) => ({ person: s.personName ?? null, amount: s.amount!.text, text: s.text }));
  return { calls, answer, figures, turn: saved[0].state.simpleChat!.turns.at(-1)! };
}
/** No figure is shown for the wrong member: each figure names a member, and that member's own documents print it. */
function noWrongPerson(figures: { person: string | null; amount: string }[]) {
  for (const f of figures) {
    assert.ok(f.person, `a figure with no member: ${f.amount}`);
    const own = OWN[f.person!];
    assert.ok(own, `a figure for someone not in the household: ${f.person}`);
    assert.ok(own.some((x) => f.amount.includes(x)), `${f.person} shown ${f.amount}, which is not on their own documents`);
  }
}
/** The same household on the benefit table: each member's schedule read into rows, and the model's amounts name rows. */
const FAMILY: FamilyMember[] = [{ id: "m1", display_name: A }, { id: "m2", display_name: B }];
const src = (d: (typeof DOCS)[number]): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages, people: d.linkedPeople } as SourceDoc);
const benefit = (benefitName: string, value: number, quote: string) => ({ section: null, column: null, benefit: benefitName, pays: "up_to", value, percentOf: null, baseAmount: null, baseQuote: null,
  fromDay: null, maxDays: null, conditions: [], page: 1, quote });
const reading = (d: (typeof DOCS)[number], cover: { person: string; sumInsured: number; quote: string }, benefits: unknown[]) => checkReading(src(d), {
  document: { kind: "personal_proof", product: d.productName, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
  covers: [{ person: cover.person, product: d.productName, cover: "Critical Illness", plan: null, sumInsured: cover.sumInsured, asOf: null, premium: null, premiumFrequency: null, page: 1, quote: cover.quote }],
  benefits } as never);
const TABLE = assembleTable([
  reading(DOCS[0], { person: A, sumInsured: 200000, quote: "Sum Assured (Critical Illness): S$200,000" }, [
    benefit("Early Stage Critical Illness Benefit", 50000, "Early Stage Critical Illness Benefit: 25% of Sum Assured, up to S$50,000 per claim"),
    benefit("Aggregate limit, all Early Stage claims", 100000, "Aggregate limit, all Early Stage claims: S$100,000")]),
  reading(DOCS[2], { person: B, sumInsured: 90000, quote: "Sum Assured: S$90,000" }, [
    benefit("Early stage", 18000, "Early stage: 20% of Sum Assured, maximum S$18,000 per claim"),
    benefit("Overall early stage limit", 45000, "Overall early stage limit: S$45,000")]),
], FAMILY, [DOCS[0], DOCS[2]].map((d) => ({ section: sectionKeyOf(d.policyId, { section: null, column: null }), cover: coverKeyOf({ product: d.productName, cover: "Critical Illness", plan: null }), why: "schedule" })),
  [], new Date("2026-11-15T04:00:00Z"));
const ROWS = chatRows(TABLE, house());
const rowsOf = (person: string) => ROWS.filter((r) => r.person === person && /early/i.test(r.benefit));
const rowStatement = (row: string, person: string) => ({ kind: "amount", text: "The early stage benefit.", person, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null,
  perDay: null, ofBill: null, eventFit: "listed", waiting: null, period: { from: "", to: "", eventOn: "" }, row });
const ROW_WHOSE_ONLY = { ...WHOSE_ONLY, statements: WHOSE_ONLY.statements.map((x) => ({ ...x, eventFit: "listed", waiting: null, period: { from: "", to: "", eventOn: "" }, row: null })) };
const ROW_EACH = { ...EACH, statements: [...rowsOf(A).map((r) => rowStatement(r.id, A)), ...rowsOf(B).map((r) => rowStatement(r.id, B))] };
/** Each member's row claimed for the other member. */
const ROW_WRONG = { ...EACH, statements: [...rowsOf(A).map((r) => rowStatement(r.id, B)), ...rowsOf(B).map((r) => rowStatement(r.id, A))] };

const SG1 = "I've just been diagnosed with an early stage heart attack. what can I claim?";

async function main() {
  await check("E1 SG1: 'I' and a whose-only reply: asked again, each member's own figures shown, labelled, and whose it is still asked", async () => {
    const { calls, answer, figures, turn } = await ask(SG1, [WHOSE_ONLY, EACH]);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].question.endsWith(EACH_PERSON_NOTE));
    assert.ok(calls[1].question.startsWith(calls[0].question));
    assert.equal(calls[1].library, calls[0].library);
    noWrongPerson(figures);
    for (const [person, own] of Object.entries(OWN)) for (const x of own) assert.ok(figures.some((f) => f.person === person && f.amount.includes(x)), `${person}'s ${x} not shown: ${JSON.stringify(figures)}`);
    assert.equal(answer.questions.length, 1);
    assert.match(answer.questions[0].text, /Who was diagnosed/);
    assert.equal(turn.eachPerson?.kept, true);
  });
  await check("E3 members with a preferred name ('Wong Kai Ming (KM)'): still asked again", async () => {
    const named = house([{ name: `${A} (KM)`, relationship: "self" }, { name: `${B} (Lan)`, relationship: "spouse" }]);
    const { calls, figures } = await ask(SG1, [WHOSE_ONLY, EACH], { household: named });
    assert.equal(calls.length, 2);
    assert.equal(figures.length, 4);
  });
  await check("E2 no member named at all ('what can be claimed?'): asked again too", async () => {
    const { calls, figures } = await ask("An early stage heart attack was diagnosed. What can be claimed?", [WHOSE_ONLY, EACH]);
    assert.equal(calls.length, 2);
    noWrongPerson(figures);
    assert.equal(figures.length, 4);
  });
  await check("W1 the second reply puts figures under the wrong member: none is shown, and the first answer stands", async () => {
    const { calls, answer, figures, turn } = await ask(SG1, [WHOSE_ONLY, WRONG]);
    assert.equal(calls.length, 2);
    assert.deepEqual(figures, []);
    assert.match(answer.questions[0]?.text ?? "", /Whose diagnosis/);
    assert.equal(turn.eachPerson?.kept, false);
  });
  await check("W2 right and wrong figures together: only each member's own are shown", async () => {
    const { figures } = await ask(SG1, [WHOSE_ONLY, MIXED]);
    noWrongPerson(figures);
    assert.equal(figures.length, 4);
  });
  await check("F3 the second reply shows one member's figures and no longer asks whose: the first answer stands", async () => {
    const { figures, turn } = await ask(SG1, [WHOSE_ONLY, { ...EACH, statements: EACH.statements.slice(0, 2), question: null }]);
    assert.deepEqual(figures, []);
    assert.equal(turn.eachPerson?.kept, false);
  });
  await check("F4 the second reply shows both members' figures but no longer asks who: the first answer stands (gate #503 ASK-L1)", async () => {
    const { figures, turn } = await ask(SG1, [WHOSE_ONLY, { ...EACH, question: null }]);
    assert.deepEqual(figures, []);
    assert.equal(turn.eachPerson?.kept, false);
  });
  await check("F5 the second reply shows figures but asks something other than who: the first answer stands (ASK-L1)", async () => {
    const { answer, figures, turn } = await ask(SG1, [WHOSE_ONLY, { ...EACH, question: "When were you diagnosed?" }]);
    assert.deepEqual(figures, []);
    assert.equal(turn.eachPerson?.kept, false);
    assert.match(answer.questions[0]?.text ?? "", /Whose diagnosis/);
  });
  await check("F6 a who question naming both members, with no 'who' word: kept", async () => {
    const { figures, turn } = await ask(SG1, [WHOSE_ONLY, { ...EACH, question: `Is this for ${A} or ${B}?` }]);
    noWrongPerson(figures);
    assert.equal(figures.length, 4);
    assert.equal(turn.eachPerson?.kept, true);
  });
  await check("M1 the job is cancelled during the first call: no second call is made or paid for (gate #503 ASK-M1)", async () => {
    let checks = 0, made = -1;
    const cancelled = new Error("This chat was cancelled.");
    await assert.rejects(ask(SG1, [WHOSE_ONLY, EACH], { check: async (calls) => { checks++; made = calls; throw cancelled; } }), (e) => e === cancelled);
    assert.equal(checks, 1);
    assert.equal(made, 1, "the check ran before the second call");
  });
  await check("M2 the job is still wanted: checked before the second call and again before the save", async () => {
    const seen: number[] = [];
    const { calls, figures } = await ask(SG1, [WHOSE_ONLY, EACH], { check: async (n) => { seen.push(n); } });
    assert.equal(calls.length, 2);
    assert.deepEqual(seen, [1, 2]);
    assert.equal(figures.length, 4);
  });
  await check("M3 control: no second call, the check runs once, before the save", async () => {
    const seen: number[] = [];
    await ask(SG1, [EACH], { check: async (n) => { seen.push(n); } });
    assert.deepEqual(seen, [1]);
  });
  await check("F1 the second call fails: the first answer stands, the turn is saved", async () => {
    const { calls, answer, figures } = await ask(SG1, [WHOSE_ONLY, new Error("overloaded")]);
    assert.equal(calls.length, 2);
    assert.deepEqual(figures, []);
    assert.match(answer.questions[0]?.text ?? "", /Whose diagnosis/);
  });
  await check("F2 the second reply also only asks whose: the first answer stands", async () => {
    const { calls, figures, turn } = await ask(SG1, [WHOSE_ONLY, WHOSE_ONLY]);
    assert.equal(calls.length, 2);
    assert.deepEqual(figures, []);
    assert.equal(turn.eachPerson?.kept, false);
  });
  await check("C1 control: figures already shown with the question: one call, answer as given", async () => {
    const { calls, figures, turn } = await ask(SG1, [EACH]);
    assert.equal(calls.length, 1);
    assert.equal(figures.length, 4);
    assert.equal(turn.eachPerson, undefined);
  });
  await check("C2 control: the chat is for one member: never asked again", async () => {
    assert.equal((await ask(SG1, [WHOSE_ONLY, EACH], { memberId: "m1" })).calls.length, 1);
  });
  await check("C3 control: the message names a member: never asked again", async () => {
    assert.equal((await ask("Siew Lan was just diagnosed with an early stage heart attack. what can she claim?", [WHOSE_ONLY, EACH])).calls.length, 1);
    assert.equal((await ask("My wife was just diagnosed with an early stage heart attack. what can she claim?", [WHOSE_ONLY, EACH])).calls.length, 1);
  });
  await check("C4 control: a household of one: never asked again", async () => {
    const one = house([{ name: A, relationship: "self" }], DOCS.slice(0, 2));
    assert.equal((await ask(SG1, [WHOSE_ONLY, EACH], { household: one })).calls.length, 1);
  });
  await check("C6 control: only one member has documents: never asked again (only their figures could be given)", async () => {
    const onlyA = house(undefined, DOCS.slice(0, 2));
    assert.equal((await ask(SG1, [WHOSE_ONLY, EACH], { household: onlyA })).calls.length, 1);
  });
  await check("C5 control: no question back (a plain not-found answer): never asked again", async () => {
    const { calls } = await ask(SG1, [{ bottomLine: "I couldn't find an early stage benefit for this in your documents.", statements: [], nextSteps: [], question: null }, EACH]);
    assert.equal(calls.length, 1);
  });
  await check("T1 on the benefit table: asked again, each member's own row cards shown, labelled, and whose it is still asked", async () => {
    assert.equal(rowsOf(A).length, 2, `rows: ${ROWS.map((r) => `${r.person}/${r.benefit}`).join("; ")}`);
    assert.equal(rowsOf(B).length, 2);
    const { calls, answer, figures, turn } = await ask(SG1, [ROW_WHOSE_ONLY, ROW_EACH], { table: TABLE });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].withRows, true);
    noWrongPerson(figures);
    for (const [person, own] of Object.entries(OWN)) for (const x of own) assert.ok(figures.some((f) => f.person === person && f.amount.includes(x)), `${person}'s ${x} not shown: ${JSON.stringify(figures)}`);
    assert.equal(answer.questions.length, 1);
    assert.equal(turn.eachPerson?.kept, true);
  });
  await check("T2 on the benefit table: rows claimed for the wrong member are never shown", async () => {
    const { calls, figures, turn } = await ask(SG1, [ROW_WHOSE_ONLY, ROW_WRONG], { table: TABLE });
    assert.equal(calls.length, 2);
    noWrongPerson(figures);
    assert.deepEqual(figures, []);
    assert.equal(turn.eachPerson?.kept, false);
    const mixed = await ask(SG1, [ROW_WHOSE_ONLY, { ...ROW_EACH, statements: [...ROW_EACH.statements, ...ROW_WRONG.statements] }], { table: TABLE });
    noWrongPerson(mixed.figures);
    assert.equal(mixed.figures.length, 4);
  });
  await check("R1 the paid test tool counts both calls, admits the second at its worst case, and replays both", async () => {
    let n = 0;
    const scripted: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() {
      n++;
      return { json: structuredClone(n % 2 ? WHOSE_ONLY : EACH), stopReason: "end_turn", model: "test", usage: { input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0 } };
    } };
    const price = { input: 0.1, output: 1 };
    const run = await runSet({ household: house(), questions: [{ id: "SG1", turns: [SG1] }], model: scripted, price, maxUsd: 100 });
    assert.equal(n, 2);
    assert.ok(Math.abs(run.spentUsd - 0.2) < 1e-9, `spent ${run.spentUsd}`);
    assert.equal(run.turns[0].eachPerson?.kept, true);
    const replayed = await runSet({ household: house(), questions: [{ id: "SG1", turns: [SG1] }], model: replayModel(run.turns, scripted.choice) });
    // Each saved answer gets a fresh random answerId (lib/chat/stale-answers.ts); the rest must be the same.
    const withoutId = (x: unknown) => { const { answerId: _id, ...rest } = x as Record<string, unknown>; return rest; };
    assert.deepEqual(withoutId(replayed.turns[0].answer), withoutId(run.turns[0].answer));
    // With room for one call only, the second is refused before it is made and the first answer stands.
    n = 0;
    const tight = await runSet({ household: house(), questions: [{ id: "SG1", turns: [SG1] }], model: scripted, price, maxUsd: 0.105 });
    assert.equal(n, 1);
    assert.equal(tight.turns[0].eachPerson, undefined);
    assert.equal((tight.turns[0].answer?.statements ?? []).filter((x) => x.amount).length, 0);
  });
  assert.deepEqual(outbound, []);
  console.log(`each person: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });

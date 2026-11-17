/** Scripted tests: a follow-up that changes who a household chat is about updates the answer, and never mixes people up.
 * - Replacement ("actually it's Daniel, not Grace", "sorry, I meant Daniel", "not Grace - Daniel"): the turn shows only
 *   Daniel's figures, from Daniel's own cover; Grace's earlier answer is out of date when the chat is reopened.
 * - Addition ("Daniel too", "and Daniel also broke his arm", "both of them"): Grace's answer stays; Daniel gets his own.
 * - A new question ("what about Daniel?"): about Daniel only, never merged into Grace's figures; Grace's answer stands.
 * - A name the household does not have: a question back, no amount, no model call.
 * Each case runs through the app's chat turn (runSimpleChat) with a scripted model, the benefit table on and off, then the
 * chat is reopened from what was saved (the saved state and answers, as the history route re-serves them). The scripted
 * model also misbehaves (keeps the replaced person's card, names the wrong person's row or document): the server must hold.
 * For every case: no figure from one person's cover is ever shown as another person's.
 * Made-up households in S$ (the Terns: Grace and Daniel; the Rahmans: three people, other figures). No model, database or
 * network.
 *   npm run -s simple:person-corrections-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { chatRows, type ChatRow } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import type { SimpleModel, SimpleModelCall, Turn } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";
import { answerAsText } from "@/lib/simple-chat/verify";
import { applyReplaced } from "@/lib/chat/replaced-live";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

// ------------------------------------------------------------------ households
type Doc = Household["documents"][number];
type Person = { name: string; relationship: string; sum: number; armPct: number };
type House = { household: Household; family: FamilyMember[]; people: Person[]; table: ReturnType<typeof assembleTable>; rows: ChatRow[];
  /** Each person's own arm-fracture figure, and every figure printed for them alone (sum insured, worked-out amounts). */
  arm: Map<string, number>; own: Map<string, number[]> };
const money = (n: number) => `S$${n.toLocaleString("en-US")}`;
let uuid = 0;
const id = () => `cccccccc-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;

/** A household on a group scheme: one certificate printing each person's own sum insured, and the scheme's terms paying a
 * share of the sum insured for a broken arm (the same share for all), plus each person's own schedule printing their own
 * fracture benefit (used with the table off). */
function makeHouse(accountId: string, people: Person[], armPct: number): House {
  const cert: Doc = { policyId: id(), name: "Group certificate.pdf", insurer: "Kestrel Assurance", productName: "Kestrel Group Scheme", policyNumber: null, documentType: null, documentRole: "certificate",
    effectiveDate: null, expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: null, linkedPeople: people.map((p) => p.name), supersededAt: null, processingStatus: "ready",
    pages: [{ page: 1, text: ["GROUP PERSONAL ACCIDENT", ...people.map((p) => `${p.name}\t${money(p.sum)}\tAs of 01/01/2026`)].join("\n") }] } as unknown as Doc;
  const terms: Doc = { ...cert, policyId: id(), name: "Scheme terms.pdf", documentRole: "policy_wording",
    pages: [{ page: 2, text: `BENEFIT 2: GROUP PERSONAL ACCIDENT\nCompensation Schedule (% of Sum Insured)\nArm (fracture)\t${armPct}%\nHip\t75%` }] } as unknown as Doc;
  const schedules: Doc[] = people.map((p) => ({ ...cert, policyId: id(), name: `${p.name.split(" ")[0]} schedule.pdf`, documentRole: "personal_schedule", uploadedFor: p.name, linkedPeople: [p.name],
    pages: [{ page: 1, text: ["KESTREL ASSURANCE - POLICY SCHEDULE", `Life assured: ${p.name}`, "Plan: Kestrel Bone Guard", `Fracture Benefit ${money(p.sum * p.armPct / 100)}`].join("\n") }] } as unknown as Doc));
  const household: Household = { accountId, members: people.map((p) => ({ name: p.name, relationship: p.relationship })), documents: [cert, terms, ...schedules] };
  const family: FamilyMember[] = people.map((p, i) => ({ id: `m${i + 1}`, display_name: p.name }));
  const src = (d: Doc): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages });
  const reading = (kind: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product: "Kestrel Group Scheme", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
  const certR = checkReading(src(cert), reading("personal_proof", people.map((p) => ({ person: p.name, product: "Kestrel Group Scheme", cover: "Group Personal Accident", plan: null, sumInsured: p.sum, asOf: "01/01/2026", page: 1,
    quote: `${p.name} ${money(p.sum)} As of 01/01/2026` })), []));
  const b = (o: Record<string, unknown>) => ({ section: "Accident", column: null, pays: "percent", value: null, percentOf: "sum_insured", baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });
  const termsR = checkReading(src(terms), reading("scheme_terms", [], [b({ benefit: "Arm (fracture)", value: armPct, quote: `Arm (fracture) ${armPct}%` }), b({ benefit: "Hip", value: 75, quote: "Hip 75%" })]));
  const links = [{ section: sectionKeyOf(terms.policyId, { section: "Accident", column: null }), cover: coverKeyOf({ product: "Kestrel Group Scheme", cover: "Group Personal Accident", plan: null }), why: "the accident scale" }];
  const table = assembleTable([certR, termsR], family, links);
  const rows = chatRows(table, household);
  const arm = new Map(people.map((p) => [p.name, p.sum * armPct / 100]));
  const own = new Map(people.map((p) => [p.name, [p.sum, p.sum * armPct / 100, p.sum * 0.75]]));
  return { household, family, people, table, rows, arm, own };
}
const TERNS = makeHouse("dddddddd-0000-4000-8000-000000000001", [
  { name: "Grace Tern", relationship: "self", sum: 200_000, armPct: 10 }, { name: "Daniel Tern", relationship: "spouse", sum: 600_000, armPct: 10 }], 10);
const RAHMANS = makeHouse("dddddddd-0000-4000-8000-000000000002", [
  { name: "Nur Aisyah Rahman", relationship: "self", sum: 150_000, armPct: 15 }, { name: "Kumar Raj Pillai", relationship: "spouse", sum: 90_000, armPct: 15 },
  { name: "Siti Hajar Rahman", relationship: "mother", sum: 40_000, armPct: 15 }], 15);

// ------------------------------------------------------------------ the scripted model
/** What the scripted model does with the people it is told to answer for:
 * - "faithful": one card per intended person, each from that person's own row (or, table off, their own schedule);
 * - "sticky": also keeps the first person's card from earlier turns (the stale person);
 * - "swapped": gives the intended person's card from another person's row or schedule (the wrong cover). */
type Behaviour = "faithful" | "sticky" | "swapped";
function scripted(house: House, intended: () => string[], first: string, behaviour: Behaviour, calls: SimpleModelCall[], asks: () => string | null = () => null): SimpleModel {
  return { choice: { provider: "anthropic", model: "scripted" }, async call(c) {
    calls.push(c);
    const want = intended();
    const people = behaviour === "sticky" && !want.includes(first) ? [...want, first] : want;
    const other = (p: string) => house.people.find((x) => x.name !== p)!.name;
    const statements = people.map((p) => {
      const from = behaviour === "swapped" ? other(p) : p;
      if (c.withRows) {
        const row = house.rows.find((r) => r.person === from && r.benefit === "Arm (fracture)")!;
        return { kind: "amount", text: "A broken arm pays a share of the sum insured.", person: p, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null,
          perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "on_list", waiting: null, period: null, multiplierNote: "" };
      }
      const di = house.household.documents.findIndex((d) => d.uploadedFor === from);
      return { kind: "amount", text: "Fracture Benefit.", person: p, document: `D${di + 1}`, quote: `Fracture Benefit ${money(house.arm.get(from)!)}`, amount: money(house.arm.get(from)!),
        percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null };
    });
    // The bottom line names everyone the model answered for, as a model's prose would.
    return { json: { bottomLine: `Here is what the documents print for ${people.join(" and ")}.`, nextSteps: [], question: asks(), statements },
      stopReason: "end_turn", model: "scripted", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } };
  } };
}

// ------------------------------------------------------------------ one conversation
type Card = { person: string | null; amount: string };
type Saved = { answer: { answerId?: string; summary?: string; bottomLine?: string | null; invalidated?: { reason: string }; statements?: { amount?: { text: string } | null; personName?: string | null; text: string }[]; question?: unknown; questions?: { text: string }[] }; state: Record<string, unknown> };
/** Runs the household's messages through the app's chat turn, one after the other, carrying the saved state and history as
 * the app does (the history read back as conversationTurns reads it). Returns each turn's saved answer and the model calls. */
async function converse(house: House, messages: string[], intended: string[][], behaviour: Behaviour, table: boolean, questions: (string | null)[] = []) {
  const { runSimpleChat, turnsFromMessages } = await import("@/lib/simple-chat/hook") as typeof import("@/lib/simple-chat/hook") & { turnsFromMessages?: (rows: unknown[], s?: ReadonlySet<string>) => Turn[] };
  const stale = await import("@/lib/chat/stale-answers") as typeof import("@/lib/chat/stale-answers") & { supersededAnswerIds?: (s: unknown) => Set<string>; replacedEarlierAnswers?: typeof import("@/lib/chat/stale-answers").replacedEarlierAnswers };
  const calls: SimpleModelCall[] = [];
  let turn = 0;
  const model = scripted(house, () => intended[turn], intended[0][0], behaviour, calls, () => questions[turn] ?? null);
  let state: Record<string, unknown> = { subjects: {} };
  const saved: Saved[] = [];
  // The live page, turn by turn: each finished answer arrives with the earlier answers the job route marks replaced
  // (replacedEarlierAnswers over the stored answers and the chat's state then), applied as the page applies them.
  let live: { content: string; answer?: Saved["answer"] }[] = [];
  const stored: { role: string; content: string; answer_json: unknown }[] = [];
  for (; turn < messages.length; turn++) {
    const message = messages[turn];
    const context = { request: { accountId: house.household.accountId, familyMemberId: null, question: message, submittedQuestion: message },
      family: house.family.map((f, i) => ({ ...f, preferred_name: null, relationship: house.people[i].relationship })), people: [],
      conversation: { id: "c1", account_id: house.household.accountId, family_member_id: null, title: "t", revision: turn + 1, state }, token: {}, holdings: [] } as unknown as ChatContext;
    const superseded = stale.supersededAnswerIds ? stale.supersededAnswerIds(state) : new Set<string>();
    const history: Turn[] = turnsFromMessages ? turnsFromMessages(stored, superseded)
      : stored.map((r) => ({ role: r.role === "user" ? "user" as const : "assistant" as const, text: r.role === "user" ? r.content : answerAsText(r.answer_json as never) }));
    let out: Saved | null = null;
    await runSimpleChat(context, {}, { model, household: async () => house.household, history: async () => history, ledger: false,
      save: (async (x: Saved) => { out = JSON.parse(JSON.stringify(x)); }) as never, table: async () => (table ? house.table : null), today: () => new Date("2026-11-15T04:00:00Z") });
    assert.ok(out, "the turn was saved");
    const s = out as Saved;
    saved.push(s);
    state = s.state;
    if (stale.replacedEarlierAnswers) {
      const replaced = stale.replacedEarlierAnswers(stored.filter((r) => r.role !== "user").map((r) => r.answer_json as never), state, s.answer as never);
      live = [...applyReplaced(live as never[], replaced), { content: s.answer.summary ?? "", answer: s.answer }] as typeof live;
    }
    stored.push({ role: "user", content: message, answer_json: null }, { role: "assistant", content: s.answer.summary ?? "", answer_json: s.answer });
  }
  // Reopened: every saved answer as the history route re-serves it for the chat's saved state (the database-free part of
  // invalidateAnswersWithDeletedPolicies: no document here was deleted).
  const reopened = stale.correctedAnswers ? stale.correctedAnswers(saved.map((s) => s.answer as never), state) as Saved["answer"][] : saved.map((s) => s.answer);
  return { saved: saved.map((s) => s.answer), reopened, calls, state, live };
}
const cards = (a: Saved["answer"]): Card[] => a.invalidated ? [] : (a.statements ?? []).filter((s) => s.amount).map((s) => ({ person: s.personName ?? null, amount: s.amount!.text }));
const figure = (t: string) => Number(t.replace(/^[^\d]*/, "").replace(/,/g, ""));

/** No figure from one person's cover is shown as another person's: each card is for one member and its figure is that
 * member's own arm figure; a figure printed only for another member appears nowhere in the card's statement. */
function assertNoCrossing(house: House, a: Saved["answer"], label: string) {
  for (const c of cards(a)) {
    assert.ok(c.person && house.arm.has(c.person), `${label}: a card for nobody in particular: ${JSON.stringify(c)}`);
    assert.equal(figure(c.amount), house.arm.get(c.person!), `${label}: ${c.person}'s card shows ${c.amount}, not their own ${money(house.arm.get(c.person!)!)}`);
  }
  for (const s of a.invalidated ? [] : a.statements ?? []) {
    if (!s.personName) continue;
    const others = house.people.filter((p) => p.name !== s.personName).flatMap((p) => house.own.get(p.name)!).filter((n) => !house.own.get(s.personName!)!.includes(n));
    const text = JSON.stringify(s);
    for (const n of others) assert.ok(!text.includes(n.toLocaleString("en-US")), `${label}: ${s.personName}'s statement carries ${money(n)}, another person's figure`);
  }
}
const people = (a: Saved["answer"]) => [...new Set(cards(a).map((c) => c.person))].sort();
/** No amount, no person's figure at all, anywhere in the answer. */
const noFigures = (house: House, a: Saved["answer"], label: string) => {
  assert.deepEqual(cards(a), [], `${label}: no cards`);
  const text = JSON.stringify({ ...a, answerId: undefined });
  for (const n of house.people.flatMap((p) => house.own.get(p.name)!)) assert.ok(!text.includes(n.toLocaleString("en-US")), `${label}: ${money(n)} in the answer`);
};

// ------------------------------------------------------------------ the cases
const BEHAVIOURS: Behaviour[] = ["faithful", "sticky", "swapped"];
const MODES = [true, false];
const mode = (t: boolean) => (t ? "table" : "no table");

async function main() {
  const G = "Grace Tern", D = "Daniel Tern";
  const OPEN = "Grace broke her arm, how much can she claim?";

  // ---- R: replacement
  const REPLACE = ["actually it's Daniel, not Grace", "Sorry, I meant Daniel", "not Grace — Daniel", "it's Daniel, not Grace", "I mean Daniel Tern.", "Daniel, not Grace.",
    "Actually it's Daniel, not Grace - how much?", "Not Grace, Daniel", "Sorry, I meant Daniel, not Grace"];
  for (const phrase of REPLACE) for (const table of MODES) for (const behaviour of BEHAVIOURS) {
    await test(`R "${phrase}" (${mode(table)}, ${behaviour} model): Daniel only, from his own cover; Grace's answer replaced on reopening`, async () => {
      const r = await converse(TERNS, [OPEN, phrase], [[G], [D]], behaviour, table);
      for (const a of [...r.saved, ...r.reopened]) assertNoCrossing(TERNS, a, phrase);
      // The corrected turn: no card for Grace, and no Grace figure anywhere in it.
      assert.ok(!people(r.saved[1]).includes(G), `Grace's card after the correction: ${JSON.stringify(cards(r.saved[1]))}`);
      assert.doesNotMatch(JSON.stringify(r.saved[1]), /20,000|200,000/, "a Grace figure in the corrected answer");
      if (behaviour !== "swapped") assert.deepEqual(people(r.saved[1]), [D], "Daniel's own card is shown");
      else assert.deepEqual(cards(r.saved[1]), [], "Daniel's card from Grace's cover is never shown");
      // Reopened: the first answer is replaced (no Grace figure), the corrected one stands. (A swapped model's first answer
      // showed no card at all, so there is nothing to replace.)
      if (cards(r.saved[0]).length) assert.equal(r.reopened[0].invalidated?.reason, "superseded", "Grace's answer is marked replaced");
      assert.deepEqual(cards(r.reopened[0]), []);
      assert.doesNotMatch(JSON.stringify(r.reopened[0].statements ?? []), /20,000/);
      assert.ok(!r.reopened[1].invalidated);
      // The model heard the correction, and never heard Grace's figures read back after it.
      assert.match(r.calls[1].question, /about Daniel Tern only/);
      assert.doesNotMatch(JSON.stringify(r.calls[1].history.filter((t) => t.role === "assistant")), /20,000/);
    });
  }
  // A follow-up after a replacement goes back to main's checks (round 3: narrowing lasts the replacement turn only); the
  // replaced answer stays superseded and is never read to the model again.
  for (const table of MODES) await test(`R2 a follow-up after the replacement (${mode(table)}): main's checks, Grace's old answer stays superseded`, async () => {
    const r = await converse(TERNS, [OPEN, "actually it's Daniel, not Grace", "And how much would he get for that?"], [[G], [D], [D]], "faithful", table);
    assert.deepEqual(people(r.saved[2]), [D]);
    assert.doesNotMatch(JSON.stringify(r.calls[2].history.filter((t) => t.role === "assistant")), /20,000/);
    for (const a of [...r.saved, ...r.reopened]) assertNoCrossing(TERNS, a, "follow-up");
    assert.equal(r.reopened[0].invalidated?.reason, "superseded");
    assert.ok(!r.reopened[1].invalidated && !r.reopened[2].invalidated);
  });

  // ---- L: the live page marks a replaced answer as the correcting answer arrives, exactly as the reopened chat does
  // (TE-ACC-20261116 journey 4); an addition or an unrelated follow-up marks nothing.
  const parity = (r: Awaited<ReturnType<typeof converse>>, label: string) => {
    assert.equal(r.live.length, r.reopened.length, label);
    r.reopened.forEach((a, i) => {
      assert.equal(r.live[i].answer?.invalidated?.reason, a.invalidated?.reason, `${label}: answer ${i} live vs reopened`);
      if (a.invalidated) {
        assert.equal(r.live[i].content, a.summary, `${label}: answer ${i} shows the reopened notice`);
        assert.deepEqual(cards(r.live[i].answer!), [], `${label}: no figure left on the replaced answer`);
      }
    });
  };
  for (const table of MODES) {
    await test(`L1 replace "Actually it was Daniel, not Grace" (${mode(table)}): live marks Grace's answer replaced, as reopened`, async () => {
      const r = await converse(TERNS, [OPEN, "Actually it was Daniel, not Grace."], [[G], [D]], "faithful", table);
      assert.equal(r.live[0].answer?.invalidated?.reason, "superseded");
      assert.ok(!r.live[1].answer?.invalidated);
      parity(r, "L1");
    });
    await test(`L2 add "Daniel broke his arm too" (${mode(table)}): live marks nothing replaced, as reopened`, async () => {
      const r = await converse(TERNS, [OPEN, "Daniel broke his arm too"], [[G], [G, D]], "faithful", table);
      assert.ok(!r.live.some((m) => m.answer?.invalidated));
      parity(r, "L2");
    });
    await test(`L3 an unrelated follow-up (${mode(table)}): live marks nothing replaced, as reopened`, async () => {
      const r = await converse(TERNS, [OPEN, "How do I make the claim?"], [[G], [G]], "faithful", table);
      assert.ok(!r.live.some((m) => m.answer?.invalidated));
      parity(r, "L3");
    });
    await test(`L4 replace, then a follow-up (${mode(table)}): Grace's answer stays marked live, nothing else is`, async () => {
      const r = await converse(TERNS, [OPEN, "actually it's Daniel, not Grace", "And how much would he get for that?"], [[G], [D], [D]], "faithful", table);
      assert.equal(r.live[0].answer?.invalidated?.reason, "superseded");
      assert.ok(!r.live[1].answer?.invalidated && !r.live[2].answer?.invalidated);
      parity(r, "L4");
    });
  }

  // Gate #510 MEDIUM 1: a calculation id is a hash of its inputs, so two answers may share one. An answer is matched live
  // by its own answerId only; one without is never marked live (unsure: no figure hidden).
  await test("L5 answers with shared calculation ids and no answerId: nothing is marked live", async () => {
    const stale = await import("@/lib/chat/stale-answers");
    const state = { ragLoop: { claim: { calcs: { Y: { withdrawn: true } } } } };
    const a1 = { summary: "one", calculations: [{ id: "X" }, { id: "Y" }] }, a2 = { summary: "two", calculations: [{ id: "X" }] }, a3 = { summary: "three", calculations: [{ id: "Z" }] };
    const replaced = stale.replacedEarlierAnswers([a1, a2] as never[], state, a3 as never);
    assert.deepEqual(replaced, []);
    const live = applyReplaced([{ content: "one", answer: a1 }, { content: "two", answer: a2 }] as never[], replaced) as { answer: { invalidated?: unknown } }[];
    assert.ok(!live.some((x) => x.answer.invalidated));
    // With their own answerIds, the answer the reopened chat marks is the one marked live, and only that one.
    const b1 = { ...a1, answerId: "a-1" }, b2 = { ...a2, answerId: "a-2" };
    const withIds = stale.replacedEarlierAnswers([b1, b2] as never[], state, { ...a3, answerId: "a-3" } as never);
    const reopened = stale.correctedAnswers([b1, b2] as never[], state) as { invalidated?: { reason: string } }[];
    assert.deepEqual(withIds.map((r) => r.key), ["answer:a-1"]);
    assert.equal(reopened[0].invalidated?.reason, "superseded");
    assert.ok(!reopened[1].invalidated);
  });

  // ---- A: addition
  const ADD = ["Daniel broke his arm too", "and Daniel also broke his arm", "both of them", "Daniel as well"];
  for (const phrase of ADD) for (const table of MODES) for (const behaviour of BEHAVIOURS) {
    await test(`A "${phrase}" (${mode(table)}, ${behaviour} model): Grace's answer stays; each person's own figure`, async () => {
      const r = await converse(TERNS, [OPEN, phrase], [[G], [G, D]], behaviour, table);
      for (const a of [...r.saved, ...r.reopened]) assertNoCrossing(TERNS, a, phrase);
      if (behaviour !== "swapped") assert.deepEqual(people(r.saved[1]), [D, G].sort(), "a card each");
      assert.ok(!r.reopened.some((a) => a.invalidated), "nothing is replaced");
      if (behaviour !== "swapped") assert.deepEqual(people(r.reopened[0]), [G], "Grace's answer stays on reopening");
    });
  }

  // A lower-case correction is no explicit replacement (names must be written as names): main's behaviour, nothing superseded.
  for (const table of MODES) await test(`R3 "sorry i meant daniel" (${mode(table)}): main's behaviour, nothing superseded`, async () => {
    const r = await converse(TERNS, [OPEN, "sorry i meant daniel"], [[G], [D]], "faithful", table);
    assert.deepEqual(people(r.saved[1]), [D]);
    assert.ok(!r.reopened.some((a) => a.invalidated));
  });
  // An earlier answer that already showed Daniel's figure is never superseded by a turn about Daniel (round 2, rule 3).
  for (const table of MODES) await test(`R4 both, then "actually it's Daniel, not Grace" (${mode(table)}): the answer with Daniel's figure stands`, async () => {
    const r = await converse(TERNS, ["Grace and Daniel both broke arms, how much?", "actually it's Daniel, not Grace"], [[G, D], [D]], "sticky", table);
    assert.deepEqual(people(r.saved[1]), [D]);
    assert.equal(r.reopened[0].invalidated, undefined);
    for (const a of [...r.saved, ...r.reopened]) assertNoCrossing(TERNS, a, "R4");
  });

  // ---- N: a new question about someone else ("what about Daniel?")
  for (const phrase of ["what about Daniel?", "And Daniel?", "How about Daniel"]) for (const table of MODES) for (const behaviour of BEHAVIOURS) {
    await test(`N "${phrase}" (${mode(table)}, ${behaviour} model): a question about Daniel, never merged with Grace's figures`, async () => {
      // Not a replacement: main's person checks decide (round 2, rule 1). Whatever is shown is each person's own figure.
      const r = await converse(TERNS, [OPEN, phrase], [[G], [D]], behaviour, table);
      for (const a of [...r.saved, ...r.reopened]) assertNoCrossing(TERNS, a, phrase);
      if (behaviour === "faithful") assert.deepEqual(people(r.saved[1]), [D]);
      // Grace's own answer answered her own question: it stands on reopening.
      assert.ok(!r.reopened[0].invalidated);
    });
  }

  // ---- U: a name the household does not have, in a strict replacement shape: a question back, no amount, no model call,
  // and no earlier answer superseded (who it is about now is no member: gate C2).
  for (const phrase of ["actually it's Wei, not Grace", "Wei, not Grace", "It was Priya, not Grace."]) for (const table of MODES) {
    await test(`U "${phrase}" (${mode(table)}): a question back, no amount, no model call`, async () => {
      const r = await converse(TERNS, [OPEN, phrase], [[G], [G]], "sticky", table);
      noFigures(TERNS, r.saved[1], phrase);
      assert.equal(r.calls.length, 1, "no model call for the unknown name");
      const asked = JSON.stringify([r.saved[1].question, r.saved[1].questions, r.saved[1].summary]);
      assert.match(asked, /Who did you mean/);
      assert.match(asked, /Grace Tern/); assert.match(asked, /Daniel Tern/);
      for (const a of [...r.saved, ...r.reopened]) assertNoCrossing(TERNS, a, phrase);
      assert.equal(r.reopened[0].invalidated, undefined, "Grace's answer is not superseded by an unknown name");
      assert.equal(people(r.saved[0]).join(), G, "the first answer showed Grace's card");
    });
  }
  // Outside that shape the model answers as on main; whatever it shows is labelled for its own person.
  for (const phrase of ["Marcus broke his arm too", "what about Wei?", "sorry i meant wei", "Sorry, I meant Priya", "not Grace — Priya", "I meant Physio."]) for (const table of MODES) {
    await test(`U2 "${phrase}" (${mode(table)}): no "who did you mean", the model answers, no person crossed`, async () => {
      const r = await converse(TERNS, [OPEN, phrase], [[G], [G]], "sticky", table);
      assert.equal(r.calls.length, 2);
      assert.doesNotMatch(JSON.stringify(r.saved[1]), /Who did you mean/);
      for (const a of [...r.saved, ...r.reopened]) assertNoCrossing(TERNS, a, phrase);
      assert.equal(r.reopened[0].invalidated, undefined);
    });
  }

  // ---- GATE: the corrections gate's repros (corrections-gate.md, C1-C6): each must answer as main does.
  const one = async (house: House, messages: string[], intended: string[][], table: boolean) => converse(house, messages, intended, "faithful", table);
  for (const table of MODES) {
    const m = mode(table);
    // C1: ordinary words are never unknown people.
    for (const q of ["Grace broke her arm, I think it's fractured. How much?", "Grace broke her arm. Physio was 5 sessions, how much?"])
      await test(`GATE C1 "${q}" (${m}): Grace's own figure`, async () => {
        const r = await one(TERNS, [q], [[G]], table);
        assert.deepEqual(cards(r.saved[0]), [{ person: G, amount: "S$20,000" }]);
      });
    await test(`GATE C1 "My husband broke his arm. Physio was needed. How much?" (${m}): Daniel's own figure`, async () => {
      const r = await one(TERNS, ["My husband broke his arm. Physio was needed. How much?"], [[D]], table);
      assert.deepEqual(cards(r.saved[0]), [{ person: D, amount: "S$60,000" }]);
    });
    for (const q of ["Is it covered? It's urgent.", "I hope it's covered, how much would she get?"])
      await test(`GATE C1 Grace then "${q}" (${m}): Grace's figure stays`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [G]], table);
        assert.deepEqual(people(r.saved[1]), [G]);
        assert.ok(!r.reopened.some((a) => a.invalidated));
      });
    // C2: a correction of the injury never supersedes the person's answer.
    for (const q of ["actually it's fractured, not sprained", "I mean broken.", "Sorry, it's Fractured, not sprained"])
      await test(`GATE C2 Grace then "${q}" (${m}): Grace's answer stands, live and reopened`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [G]], table);
        assert.deepEqual(people(r.saved[1]), [G]);
        assert.equal(r.reopened[0].invalidated, undefined);
        assert.deepEqual(people(r.reopened[0]), [G]);
      });
    // C3: a member's name that is an ordinary word is a mention only when written as a name.
    for (const [other, q] of [["Will Tan", "how much will that be in total?"], ["May Tan", "may I claim for that? how much?"], ["Mark Tan", "can you mark it as urgent? how much?"], ["Rose Tan", "the bill rose a lot, how much is paid?"]] as const)
      await test(`GATE C3 member ${other}: Grace then "${q}" (${m}): Grace's figure stays`, async () => {
        const house = makeHouse("dddddddd-0000-4000-8000-0000000000c3", [{ name: G, relationship: "self", sum: 200_000, armPct: 10 }, { name: other, relationship: "spouse", sum: 500_000, armPct: 10 }], 10);
        const r = await one(house, [OPEN, q], [[G], [G]], table);
        assert.deepEqual(people(r.saved[1]), [G]);
        for (const a of r.saved) assertNoCrossing(house, a, q);
      });
    await test(`GATE C3 Daniel then "Is there a grace period? How much does he get?" (${m}): Daniel's figure stays`, async () => {
      const r = await one(TERNS, ["Daniel broke his arm, how much?", "Is there a grace period? How much does he get?"], [[D], [D]], table);
      assert.deepEqual(people(r.saved[1]), [D]);
    });
    await test(`GATE C3 "Will broke his arm" names Will; "Will that be covered?" does not (${m})`, async () => {
      const house = makeHouse("dddddddd-0000-4000-8000-0000000000c4", [{ name: G, relationship: "self", sum: 200_000, armPct: 10 }, { name: "Will Tan", relationship: "spouse", sum: 500_000, armPct: 10 }], 10);
      const r = await one(house, [OPEN, "Will broke his arm too"], [[G], [G, "Will Tan"]], table);
      assert.deepEqual(people(r.saved[1]), ["Grace Tern", "Will Tan"]);
      const r2 = await one(house, [OPEN, "Will that be covered?"], [[G], [G]], table);
      assert.deepEqual(people(r2.saved[1]), [G]);
    });
    // C4: an addition after a relationship-only turn never narrows the turn to the new name.
    await test(`GATE C4 "My wife broke her arm" then "and Daniel too, how much for each?" (${m}): both`, async () => {
      const r = await one(TERNS, ["My wife broke her arm, how much?", "and Daniel too, how much for each?"], [[G], [G, D]], table);
      assert.deepEqual(people(r.saved[1]), [D, G].sort());
      for (const a of r.saved) assertNoCrossing(TERNS, a, "C4");
    });
    // C5: a member named as a policy's owner is not a new subject.
    for (const q of ["Does Daniel's policy cover her?", "Is that under Daniel's plan?"])
      await test(`GATE C5 Grace then "${q}" (${m}): Grace's figure stays`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [G]], table);
        assert.deepEqual(people(r.saved[1]), [G]);
        assert.ok(!r.reopened.some((a) => a.invalidated));
      });
    // C6: insurer and product names are never unknown people.
    for (const q of ["what about Prudential?", "what about AIA?", "what about MediShield?", "what about Integrated Shield?"])
      await test(`GATE C6 Grace then "${q}" (${m}): the model answers`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [G]], table);
        assert.equal(r.calls.length, 2);
        assert.doesNotMatch(JSON.stringify(r.saved[1]), /Who did you mean|can't find anyone/);
      });
    // Chains the gate found right, kept right.
    await test(`GATE chain Grace -> "actually Daniel, not Grace" -> "sorry, it's Grace, not Daniel" (${m})`, async () => {
      const r = await one(TERNS, [OPEN, "actually Daniel, not Grace", "sorry, it's Grace, not Daniel"], [[G], [D], [G]], table);
      assert.deepEqual(r.saved.map(people), [[G], [D], [G]]);
      assert.deepEqual(r.reopened.map((a) => a.invalidated?.reason ?? "-"), ["superseded", "superseded", "-"]);
    });
    await test(`GATE lowercase "grace broke her arm" -> "actually daniel, not grace" (${m}): no name written as a name, main's behaviour`, async () => {
      const r = await one(TERNS, ["grace broke her arm, how much?", "actually daniel, not grace"], [[G], [D]], table);
      assert.deepEqual(r.saved.map(people), [[G], [D]]);
      assert.ok(!r.reopened.some((a) => a.invalidated));
    });
    // ---- Round 2 (corrections-gate.md round 2)
    const named = (x: string) => makeHouse(`dddddddd-0000-4000-8000-${String(x.length).padStart(12, "0")}`, [{ name: G, relationship: "self", sum: 200_000, armPct: 10 }, { name: `${x} Tern`, relationship: "spouse", sum: 500_000, armPct: 10 }], 10);
    const R21: [string, string][] = [["Elizabeth", "She was warded at Mount Elizabeth for 3 days, how much?"], ["Seng", "She went to Tan Tock Seng, how much?"], ["Max", "Does her HealthShield Gold Max pay more?"],
      ["Low", "is the payout low? how much does she get?"], ["Long", "how long until she gets paid and how much?"], ["Grant", "will they grant the claim? how much?"],
      ["Chance", "any chance she gets more? how much?"], ["Cash", "what about hospital cash for her?"], ["Angel", "she's an angel, how much does she get?"], ["Honey", "honey, how much does she get?"],
      ["Chew", "she can't chew after the fall, how much?"], ["Kit", "does the first aid kit count? how much?"], ["Lance", "they had to lance the wound, how much?"],
      ["Teng", "She was at Ng Teng Fong, how much?"], ["Ho", "ho hum, how much does she get?"]];
    for (const [x, q] of R21) await test(`GATE R2-1 member ${x} Tern: Grace then "${q}" (${m}): Grace's figure stays`, async () => {
      const house = named(x);
      const r = await one(house, [OPEN, q], [[G], [G]], table);
      assert.deepEqual(people(r.saved[1]), [G]);
      assert.ok(!r.reopened.some((a) => a.invalidated));
      for (const a of r.saved) assertNoCrossing(house, a, q);
    });
    for (const [x, q] of R21.slice(0, 3)) await test(`GATE R2-1 member ${x} Tern after a replacement to Grace: "${q}" (${m}) keeps Grace`, async () => {
      const house = named(x);
      const r = await one(house, [`${x} Tern broke his arm`, `actually it's Grace, not ${x}`, q], [[`${x} Tern`], [G], [G]], table);
      assert.deepEqual(people(r.saved[2]), [G]);
    });
    // ---- Round 3: the replacement shapes only as the message's own correction.
    for (const q of ["It was Daniel who was driving, not Grace. Grace broke her arm, how much?", "Daniel - not Grace - was driving. Grace broke her arm, how much?"])
      await test(`GATE R3-1 single turn "${q}" (${m}): Grace's figure`, async () => {
        const r = await one(TERNS, [q], [[G]], table);
        assert.deepEqual(people(r.saved[0]), [G]);
      });
    for (const q of ["Pay it to Daniel, not Grace. How much would that be?", "It's not Grace but Daniel who holds the plan. How much does Grace get?",
      "The policyholder is not Grace but Daniel. Is her arm covered? How much?", "Should I claim under Daniel instead, not Grace? How much would she get?",
      "Daniel, not Grace? How much?", "Daniel, not Grace. How much does Grace get?", "Daniel who holds the plan, not Grace. How much?", "not Grace but Daniel"])
      await test(`GATE R3 Grace then "${q}" (${m}): no replacement, Grace's figure and answer stand`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [G]], table);
        assert.deepEqual(people(r.saved[1]), [G]);
        assert.ok(!r.reopened.some((a) => a.invalidated));
      });
    await test(`GATE R3-1 member May Tern: Grace then "It happened in May, not Grace's fault. How much?" (${m})`, async () => {
      const house = named("May");
      const r = await one(house, [OPEN, "It happened in May, not Grace's fault. How much?"], [[G], [G]], table);
      assert.deepEqual(people(r.saved[1]), [G]);
      assert.ok(!r.reopened.some((a) => a.invalidated));
    });
    for (const q of ["She also needs physio for her shoulder. How much does she get?", "and Gracie?"])
      await test(`GATE R3-3 Grace, "Daniel, not Grace", then "${q}" (${m}): main's checks again`, async () => {
        const r = await one(TERNS, [OPEN, "Daniel, not Grace", q], [[G], [D], [G]], table);
        assert.deepEqual(people(r.saved[2]), [G]);
        assert.equal(r.reopened[0].invalidated?.reason, "superseded", "the replaced answer stays superseded");
      });
    // ---- Round 4 hardenings.
    for (const q of ["Daniel, not Grace - how much does she get?", "Actually it's Daniel, not Grace. Is her arm covered?", "Daniel, not Grace. How much would he get?"])
      await test(`GATE R4-1 Grace then "${q}" (${m}): Grace's answer superseded, the turn left to main's checks`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [D]], table);
        assert.equal(r.reopened[0].invalidated?.reason, "superseded");
        assert.deepEqual(people(r.saved[1]), [D]);
        const sticky = await converse(TERNS, [OPEN, q], [[G], [D]], "sticky", table);
        assert.deepEqual(people(sticky.saved[1]), [D, G].sort(), "no narrowing: the model's own cards stand, each its own person's");
        for (const a of sticky.saved) assertNoCrossing(TERNS, a, q);
      });
    for (const q of ["Daniel's, not Grace's.", "It's Daniel's, not Grace's. How much?", "Daniel's, not Grace's - how much does she get?", "Not Grace's, Daniel's."])
      await test(`GATE R4-2 Grace then "${q}" (${m}): no replacement, nothing superseded`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [G]], table);
        assert.deepEqual(people(r.saved[1]), [G]);
        assert.ok(!r.reopened.some((a) => a.invalidated));
      });
    for (const ask of ["Who was driving?", "Is the policy in Grace's name or Daniel's?", "Who did you mean: Grace Tern or Daniel Tern?", "Whose card is it?", "Which of you was in the car?"])
      await test(`GATE R4-3 the answer asked "${ask}", then "Daniel, not Grace." (${m}): an answer, not a correction`, async () => {
        const r = await converse(TERNS, [OPEN, "Daniel, not Grace."], [[G], [G]], "faithful", table, [ask, null]);
        assert.deepEqual(people(r.saved[1]), [G]);
        assert.ok(!r.reopened.some((a) => a.invalidated));
        assert.doesNotMatch(r.calls[1].question, /corrected who this is about/);
      });
    for (const ask of ["Was she admitted to hospital?", "Did the doctor say it was a closed fracture?", "How many days was she in hospital?"])
      for (const reply of ["Actually it's Daniel, not Grace", "Daniel, not Grace."])
        await test(`GATE N5-1 the answer asked "${ask}", then "${reply}" (${m}): still a correction`, async () => {
          const r = await converse(TERNS, [OPEN, reply], [[G], [D]], "sticky", table, [ask, null]);
          assert.deepEqual(people(r.saved[1]), [D]);
          assert.equal(r.reopened[0].invalidated?.reason, "superseded");
          assert.match(r.calls[1].question, /corrected who this is about/);
        });
    // R6-1 stays a known safe-side gap (gate #510 round 2): after a yes/no question about Grace by name, a reply in a
    // replacement's shape is a correction, as on main, so the wrong person's figure never stays current.
    for (const ask of ["Was Grace admitted to hospital?", "Did Grace fall off her bike?", "Is Grace the injured person?", "Was Grace driving at the time?"])
      for (const reply of ["Actually it was Daniel, not Grace.", "Daniel, not Grace."])
        await test(`GATE R6-1 the answer asked "${ask}", then "${reply}" (${m}): a correction, replaced live and reopened`, async () => {
          const r = await converse(TERNS, [OPEN, reply], [[G], [D]], "sticky", table, [ask, null]);
          assert.deepEqual(people(r.saved[1]), [D]);
          assert.equal(r.reopened[0].invalidated?.reason, "superseded");
          assert.equal(r.live[0].answer?.invalidated?.reason, "superseded");
        });
    await test(`GATE R4-3 control: no question before, "Daniel, not Grace." still replaces (${m})`, async () => {
      const r = await converse(TERNS, [OPEN, "Daniel, not Grace."], [[G], [D]], "sticky", table, [null, null]);
      assert.deepEqual(people(r.saved[1]), [D]);
      assert.equal(r.reopened[0].invalidated?.reason, "superseded");
    });
    const BOTH_OPEN = "Grace and Daniel both broke arms, how much?";
    for (const q of ["Actually, Daniel's was a compound fracture, how much does he get?", "Sorry, Daniel's question: does he need a doctor's memo?"])
      await test(`GATE R2-2 both then "${q}" (${m}): nothing superseded`, async () => {
        const r = await one(TERNS, [BOTH_OPEN, q], [[G, D], [D]], table);
        assert.ok(!r.reopened.some((a) => a.invalidated));
        assert.deepEqual(people(r.reopened[0]), [D, G].sort());
      });
    for (const q of ["Sorry, Daniel here - how much would I get for a broken arm?", "Actually Daniel wants to know about his own policy, how much?"])
      await test(`GATE R2-2 Grace then "${q}" (${m}): Grace's answer stands`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [D]], table);
        assert.equal(r.reopened[0].invalidated, undefined);
        assert.deepEqual(people(r.reopened[0]), [G]);
      });
    for (const q of ["It wasn't Grace's fault, how much does she get?", "Is she paid even if the bill is not for Grace? how much?"])
      await test(`GATE R2-3 Grace then "${q}" (${m}): Grace's figure stays`, async () => {
        const r = await one(TERNS, [OPEN, q], [[G], [G]], table);
        assert.deepEqual(people(r.saved[1]), [G]);
      });
    await test(`GATE R2-4 member Will Tern: Grace then "and will too" (${m}): both`, async () => {
      const house = named("Will");
      const r = await one(house, [OPEN, "and will too"], [[G], [G, "Will Tern"]], table);
      assert.deepEqual(people(r.saved[1]), [G, "Will Tern"]);
    });
    await test(`GATE R2-5 Grace then "I meant Physio." (${m}): the model answers, Grace's figure`, async () => {
      const r = await one(TERNS, [OPEN, "I meant Physio."], [[G], [G]], table);
      assert.equal(r.calls.length, 2);
      assert.deepEqual(people(r.saved[1]), [G]);
    });
    await test(`GATE "Grace and Daniel both broke arms" (${m})`, async () => {
      const r = await one(TERNS, ["Grace and Daniel both broke arms, how much?"], [[G, D]], table);
      assert.deepEqual(people(r.saved[0]), [D, G].sort());
    });
  }

  // ---- H: another household, three people, other figures and names: nothing here knows the Terns.
  const [NA, KR, SH] = RAHMANS.people.map((p) => p.name);
  for (const table of MODES) for (const behaviour of BEHAVIOURS) {
    await test(`H replacement and addition in a three-person household (${mode(table)}, ${behaviour} model)`, async () => {
      const open = "Aisyah broke her arm. How much?";
      const rep = await converse(RAHMANS, [open, "sorry, I meant Kumar"], [[NA], [KR]], behaviour, table);
      for (const a of [...rep.saved, ...rep.reopened]) assertNoCrossing(RAHMANS, a, "rahman replace");
      assert.ok(!people(rep.saved[1]).includes(NA));
      if (cards(rep.saved[0]).length) assert.equal(rep.reopened[0].invalidated?.reason, "superseded");
      const add = await converse(RAHMANS, [open, "Siti also broke her arm"], [[NA], [NA, SH]], behaviour, table);
      for (const a of [...add.saved, ...add.reopened]) assertNoCrossing(RAHMANS, a, "rahman add");
      assert.ok(!people(add.saved[1]).includes(KR), "Kumar was never asked about");
      assert.ok(!add.reopened.some((a) => a.invalidated));
      const not = await converse(RAHMANS, [open, "not Aisyah — Siti"], [[NA], [SH]], behaviour, table);
      assert.ok(!people(not.saved[1]).includes(NA));
      if (cards(not.saved[0]).length) assert.equal(not.reopened[0].invalidated?.reason, "superseded");
      assert.ok(behaviour === "swapped" || cards(rep.saved[0]).length, "a faithful first answer shows Aisyah's card");
    });
  }

  // ---- S: who each message is about (lib/simple-chat/subjects.ts), when the module exists.
  const subjects = await import("@/lib/simple-chat/subjects").catch(() => null);
  await test("S resolveSubjects: only an explicit replacement between members narrows; everything else defers or adds", () => {
    assert.ok(subjects, "lib/simple-chat/subjects.ts exists");
    const r = (...said: string[]) => subjects!.resolveSubjects(TERNS.household, said.reverse());
    assert.deepEqual(r(OPEN, "actually it's Daniel, not Grace"), { people: [D], change: "replace", replaced: [G], unknown: null, kept: [D] });
    assert.deepEqual(r(OPEN, "not Grace — Daniel").people, [D]);
    assert.deepEqual(r(OPEN, "Sorry, I meant Daniel").people, [D]);
    assert.equal(r(OPEN, "actually it's Daniel, not Grace", "how much for the hip?").people, null, "narrowing lasts the replacement turn only");
    assert.equal(r(OPEN, "actually it's Daniel, not Grace", "what about Grace?").people, null);
    for (const q of ["Pay it to Daniel, not Grace.", "It was Daniel who was driving, not Grace.", "not Grace but Daniel", "Daniel, not Grace?", "Should I claim under Daniel instead, not Grace?",
      "Daniel, not Grace. How much does Grace get?", "Daniel - not Grace - was driving."])
      assert.equal(r(OPEN, q).people, null, q);
    assert.equal(r(OPEN, "Wei, not Grace?").unknown, null, "a question about the correction asks nothing");
    assert.deepEqual(r(OPEN, "Daniel, not Grace - how much does she get?"), { people: null, change: "replace", replaced: [G], unknown: null, kept: [D] });
    assert.equal(r(OPEN, "Daniel's, not Grace's.").change, "same");
    for (const ask of ["Who was driving?", "Is the policy in Grace's name or Daniel's?", "Who did you mean: Grace Tern or Daniel Tern?"])
      assert.equal(subjects!.resolveSubjects(TERNS.household, ["Daniel, not Grace.", OPEN], { askedBefore: ask }).change, "same", ask);
    assert.equal(subjects!.resolveSubjects(TERNS.household, ["Actually it's Daniel, not Grace", OPEN], { askedBefore: "Was she admitted to hospital?" }).change, "replace");
    // Not a replacement: main's behaviour.
    for (const q of ["Daniel too", "both of them", "what about Daniel?", "how much for the hip?", "what about my husband?", "What does Grace's husband get?", "I broke my arm too",
      "sorry i meant the hip", "Does Daniel's policy cover her?", "Actually, Daniel's was a compound fracture", "Sorry, Daniel here", "It wasn't Grace's fault, how much does she get?",
      "not Grace", "sorry i meant daniel", "actually daniel, not grace", "I meant Physio.", "Sorry, I meant Priya"])
      assert.deepEqual([r(OPEN, q).people, r(OPEN, q).replaced, r(OPEN, q).unknown], [null, [], null], q);
    assert.equal(r("My wife broke her arm", "and Daniel too").people, null);
    // "Who did you mean?" only for "<X>, not <member>".
    assert.equal(r(OPEN, "actually it's Wei, not Grace").unknown, "Wei");
    assert.deepEqual(r(OPEN, "actually it's Wei, not Grace").replaced, [], "an unknown name supersedes nothing");
    for (const q of ["Grace broke her arm. Tom was driving.", "Hokkaido was where it happened", "Grab was late", "Covid was also involved", "it's swollen", "what about Integrated Shield?",
      "Raffles was the hospital", "I think it's fractured", "It's urgent.", "Physio was 5 sessions", "actually it's fractured, not sprained", "I mean broken.", "What about Hip?",
      "Mount Elizabeth, not Grace's usual hospital", "Marcus broke his arm too", "what about Wei?"])
      assert.equal(r(OPEN, q).unknown, null, q);
    // Only the household's own names: the same words for another household mean nothing.
    assert.equal(subjects!.resolveSubjects(RAHMANS.household, ["actually it's Daniel, not Aisyah"]).unknown, "Daniel");
    assert.equal(subjects!.resolveSubjects(RAHMANS.household, ["actually it's Daniel, not Grace"]).unknown, null, "Grace is no member there");
    // A name inside a longer capitalised phrase is no mention ("Mount Elizabeth").
    const liz = makeHouse("dddddddd-0000-4000-8000-0000000000e1", [{ name: G, relationship: "self", sum: 1, armPct: 10 }, { name: "Elizabeth Tern", relationship: "spouse", sum: 1, armPct: 10 }], 10);
    assert.equal(subjects!.resolveSubjects(liz.household, ["it's Mount Elizabeth, not Grace's clinic", OPEN]).people, null);
    assert.deepEqual(subjects!.resolveSubjects(liz.household, ["it's Elizabeth, not Grace", OPEN]).people, ["Elizabeth Tern"]);
    assert.equal(subjects!.resolveSubjects(liz.household, ["We went to Mount Elizabeth, not Grace's clinic", OPEN]).people, null);
  });
  await test("S supersededBy walks back over the replaced person's answers only", () => {
    assert.ok(subjects);
    const t = [{ answerId: "a1", people: [G] }, { answerId: "a2", people: [] }, { answerId: "a3", people: [G] }];
    assert.deepEqual(subjects!.supersededBy([G], t), ["a3", "a1"]);
    assert.deepEqual(subjects!.supersededBy([G], [{ answerId: "a0", people: [G] }, { answerId: "a1", people: [D] }, { answerId: "a2", people: [G] }]), ["a2"]);
    assert.deepEqual(subjects!.supersededBy([], t), []);
    assert.deepEqual(subjects!.supersededBy([G], [{ answerId: "a1", people: [G] }, { answerId: "a2", people: [G, D] }], [D]), [], "an answer that showed the new person stands");
  });

  await test("D2 an invalidated answer keeps no insurer contacts (they name the document and page it relied on), for every reason", async () => {
    const { invalidatedAnswer } = await import("@/lib/chat/stale-answers");
    const contact = { insurer: "Kestrel Life", items: [{ kind: "phone", value: "6123 4567" }], document: "Kestrel schedule", page: 2 };
    for (const reason of ["policy_deleted", "documents_added", "person_unlinked", "superseded"] as const) {
      const out = invalidatedAnswer({ summary: "S$3,000", details: [], citations: [], nextSteps: [], questions: [], insurerContacts: [contact] } as any, reason) as any;
      assert.deepEqual(out.insurerContacts, [], reason);
      assert.doesNotMatch(JSON.stringify(out), /6123 4567|Kestrel schedule/, reason);
    }
    assert.ok(!("insurerContacts" in (invalidatedAnswer({ summary: "x" } as any) as any)), "an answer with no contacts gains no field");
  });

  console.log(`person corrections: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`FAIL ${f}`);
  if (failures.length) process.exit(1);
}
main().catch((error) => { console.error(error); process.exit(1); });

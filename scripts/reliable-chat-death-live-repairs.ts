/**
 * Death-journey live repairs (dj-live-1, 18 Oct 2026): one replay per demonstrated failure, each of which FAILS without its repair.
 *   R1 (D3)  "my husband Daniel passed away..." where Daniel is the household's inferred "self": the name picks him, no question is asked
 *   R2 (D2)  a sentence that says the DOCUMENT is silent about a currency, or that a dated amount is no proof of cover, is not an exclusion
 *   R3 (D2)  a death answer that leaves out a documented death benefit gets that benefit's server-written terms (nothing is repeated)
 *   R4 (D1)  "Daniel's enrolment in that booklet is not confirmed" (the booklet is the wording of the group policy his certificate lists him under) is
 *            replaced by the dated listing; the Core/Voluntary and date-of-death uncertainties stay as said
 *   R5 (F1)  a fracture question that mentions "the death benefits" is not turned into a death assessment; the relation of the benefits is stated,
 *            whether they can be paid together is left open, nothing is totalled
 *   R6       narrow single-benefit and comparison questions are not expanded
 *   R7       the top-up restores only the subject's own supported records: a statement rejected for another person or the wrong currency is not restored
 * The original live grades are kept unchanged (docs/rag-migration/live/dj-live-1-grade.*); these are offline replays of the boundaries.
 *   node --import tsx scripts/reliable-chat-death-live-repairs.ts
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as DJR from "./fixtures/reliable-chat/death-journey-actual-values";
import { DEATH_Q, D } from "./fixtures/reliable-chat/death-journey-conversations";
import { ScriptedLoopModel, type ScriptTurn, type ScriptView } from "@/lib/rag2/loop/scripted-model";
import { resolvePersonAmong, type Person } from "@/lib/rag2/people";
import { withoutUncertainty } from "@/lib/rag2/loop/statements";
import { uniqueSteps } from "@/components/next-steps";
import { hitOf, idsOf, schedOf } from "./fixtures/reliable-chat/booklet-conversations";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const visible = (a: any) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text ?? q.question ?? ""), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "\n     " + detail.split("\n").slice(0, 24).join("\n     ")}`); };

// ---- R1 ----
const P = (id: string, name: string, relation: Person["relation"], gender: Person["gender"]): Person => ({ id, name, preferredName: null, relationship: relation, relation, gender, dateOfBirth: null });
const daniel = P("d", "Daniel Lee Wei Ming", "self", "m"), grace = P("g", "Grace Tan Hui Min", "spouse", "f"), ryan = P("r", "Ryan Lee", "step_child", "m");
const house = [daniel, grace, ryan];
{
  const r = resolvePersonAmong(house, "my husband Daniel", { speakerId: "d", speakerConfirmed: false } as any);
  check("R1 \"my husband Daniel\" with Daniel the inferred self: he is the person, no question", r.status === "ok" && r.person.id === "d", JSON.stringify(r));
  const r2 = resolvePersonAmong(house, "my husband Daniel", { speakerId: "d", speakerConfirmed: true } as any);
  check("R1 …but when the conversation says Daniel IS the speaker, \"my husband Daniel\" is still asked about", r2.status === "ambiguous", JSON.stringify(r2));
  const r3 = resolvePersonAmong(house, "my son Ryan", null);
  check("R1 a relation word that does not fit a non-self member is still asked (the existing near-miss rule)", r3.status === "ambiguous", JSON.stringify(r3));
  const r4 = resolvePersonAmong(house, "my wife Daniel", null);
  check("R1 the name of a person who is not the inferred self never yields an unrelated member", r4.status === "ok" ? r4.person.id === "d" : true, JSON.stringify(r4));
}

// ---- R2 ----
{
  const cda = "The booklet says the Compassionate Death Allowance reimburses funeral expenses incurred up to $2,000 (printed with a “$” sign; the document does not say which currency) if an insured person dies as a result of an Accident, on receipt of proof of death and the required documents.";
  const stripped = withoutUncertainty(cda);
  check("R2 \"the document does not say which currency\" is set aside as uncertainty, not read as an exclusion", !/does not say which currency/i.test(stripped) && /Compassionate Death Allowance/.test(stripped) && /proof of death/.test(stripped), stripped);
  const dated = withoutUncertainty("The certificate amount is dated and is not confirmation of current cover.");
  check("R2 \"a dated amount is not confirmation of current cover\" is set aside as uncertainty", !/not confirmation/i.test(dated), dated);
  const real = withoutUncertainty("The booklet states that the allowance is not payable for suicide.");
  check("R2 a genuine exclusion is NOT set aside", /not payable/.test(real), real);
  const real2 = withoutUncertainty("Cover is not included for Grace.");
  check("R2 \"not included\" is NOT set aside", /not included/.test(real2), real2);
}

// ---- R3 ----
const benefitIdOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) for (const b of d.benefits ?? []) if (re.test(b.benefit) && b.benefit_id) return b.benefit_id as string; return null; };
async function topUp() {
  setEnv(DJR as any);
  const h = await startHarness(DJR as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  try {
    const turn: ScriptTurn = { user: DEATH_Q, steps: [
      () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death" })],
      // a reply with room to spare that states ONE death benefit and nothing else: the others are documented and must not be absent
      (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) }], next_steps: [] })],
    ] };
    installLoopModel(new ScriptedLoopModel([turn]));
    const a = await h.send(DEATH_Q, {}); const v = visible(a);
    const tr: any = (await h.savedAnswer(a.conversationId!)).state.ragLoop.turns.at(-1);
    check("R3 the stated benefit (Term Life) is still stated once", (v.match(/Group Term Life/g) ?? []).length >= 1, v);
    check("R3 the Personal Accident benefit the reply left out is added with its own amount", /Personal Accident/.test(v) && /600,000/.test(v), v);
    check("R3 the Compassionate Death Allowance the reply left out is added with its own conditions", /Compassionate Death Allowance/i.test(v) && /proof of death/i.test(v), v);
    check("R3 the printed Term Life benefit is not repeated by the top-up", (v.match(/1,000,000/g) ?? []).length <= 2, v);
    check("R3 a next step is visible", /Contact Aldermoor Life Ltd/.test(v), v);
    check("R3 the trace says what was added", (tr.adjusted ?? []).some((x: string) => /death benefits of this person the reply did not state|benefits that pay on death/.test(x)), JSON.stringify(tr.adjusted));
  } finally { installLoopModel(null); await h.db.close(); }
}

const CDA_D1 = "The Group Insurance Benefits Booklet describes a compassionate death allowance of up to $2,000 (printed with a “$” sign; the document does not say which currency) for funeral expenses if an insured person dies as a result of an accident, on proof of death and prescribed documents, and says it can be claimed under either the Core Scheme or Voluntary Scheme; Daniel’s enrolment in that booklet is not confirmed and its bare “$” does not identify a currency.";
async function withModel(turn: ScriptTurn, msg: string, fn: (v: string, tr: any) => void) {
  setEnv(DJR as any);
  const h = await startHarness(DJR as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  try {
    installLoopModel(new ScriptedLoopModel([turn]));
    const a = await h.send(msg, {}); const v = visible(a);
    fn(v, (await h.savedAnswer(a.conversationId!)).state.ragLoop.turns.at(-1));
  } finally { installLoopModel(null); await h.db.close(); }
}
async function d1() {
  const turn: ScriptTurn = { user: DEATH_Q, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death" })],
    () => [call("search_passages", { subject_id: D, query: "Compassionate Death Allowance funeral expenses Core Scheme Voluntary Scheme", k: 6 })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      { kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) },
      { kind: "fact", text: CDA_D1, evidence_ids: [hitOf(v, /funeral/)], benefit: "Compassionate Death Allowance Benefit" },
      { kind: "uncertainty", text: "The uploaded documents do not establish whether Daniel is in the Core Scheme or the Voluntary Scheme.", subject_id: D, evidence_ids: [hitOf(v, /Core Scheme/)] },
      { kind: "uncertainty", text: "The uploaded documents do not establish whether Daniel’s cover is in force on the date of death.", subject_id: D, evidence_ids: [hitOf(v, /funeral/)] },
    ], next_steps: [] })],
  ] };
  await withModel(turn, DEATH_Q, (v, tr) => {
    check("R4 the unsupported denial \"enrolment in that booklet is not confirmed\" is not shown", !/enrolment in that booklet is not confirmed/i.test(v), v);
    check("R4 the dated listing under the group policy is stated instead", /Daniel[’']s certificate lists Daniel under/.test(v) && /6 October 2022|06\/10\/2022/.test(v), v);
    check("R4 the Core/Voluntary uncertainty stays as said", /whether Daniel is in the Core Scheme or the Voluntary Scheme/.test(v), v);
    check("R4 the date-of-death uncertainty stays as said", /in force on the date of death/.test(v), v);
    check("R4 the allowance keeps its printed conditions and its currency uncertainty", /Compassionate Death Allowance/i.test(v) && /proof of death/i.test(v) && /Core Scheme or (?:the )?Voluntary Scheme/.test(v) && /(?:does not say which currency|does not identify a currency|bare “\$”)/.test(v) && !/booklet[^.\n]*S\$2,000/i.test(v), v);
  });
}
async function f1() {
  const F1 = "If Daniel breaks his hip in an accident, what does the Simple Fracture benefit pay, what condition applies to it, and is it separate from the death benefits?";
  const calcs = (v: ScriptView) => [...v.turn].filter((o) => o.name === "evaluate_benefit" && o.ok && o.result?.data?.result_id).map((o) => ({ kind: "calculation", result_id: o.result.data.result_id, text: "-" }));
  const turn: ScriptTurn = { user: F1, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "hip fracture", words: "breaks his hip" }, { key: "how_it_happened", value: "accident", words: "in an accident" }] })],
    () => [call("person_benefits", { subject_id: D, topic: "Simple Fracture hip accident; death benefits" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: schedOf(v, /^Simple Fracture$/)?.benefit_id, purpose: "what_if", case: "hip", fact_keys: ["injury"] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [...calcs(v), { kind: "uncertainty", text: "The uploaded documents do not establish that the Simple Fracture benefit is payable separately from death benefits; they describe separate benefits, but do not state whether both can be paid for the same event.", subject_id: D, evidence_ids: [] }], next_steps: ["contact:" + DJR.doc("CERT").id] })],
  ] };
  await withModel(turn, F1, (v, tr) => {
    check("R5 the conditional hip illustration (S$3,750) is stated", /S\$3,750/.test(v), v);
    check("R5 the fracture's own accident condition is stated", /accident/i.test(v) && /Simple Fracture/.test(v), v);
    check("R5 the distinction is stated from the records: Simple Fracture and the death benefits are listed separately, with pages", /lists? Simple Fracture \(page 13\) separately from the death benefits \([^)]*(?:Term Life|Accidental Death)[^)]*\)/i.test(v), v);
    check("R5 whether they can be paid together stays unresolved", /do not say whether they can all be paid for the same event|not established/i.test(v), v);
    check("R5 no total, no stacking conclusion, no death amounts", !/1,000,000|600,000|1,600,000|in total|combined|added together|can be paid together/i.test(v), v);
    check("R5 not turned into a death assessment: the death benefits are named, none of their terms (allowance conditions, amounts, repatriation, proof of death) are added", !/Repatriation|funeral expenses|proof of death|2,000|5,000 for|Core Scheme|Voluntary Scheme/i.test(v), v);
    check("R5 a visible next step", /Contact Aldermoor Life Ltd/.test(v), v);
  });
}
async function f1b() {
  const Q = "If Daniel breaks his hip in an accident, what would he get, and does that sit alongside the death cover?";
  const calcs = (v: ScriptView) => [...v.turn].filter((o) => o.name === "evaluate_benefit" && o.ok && o.result?.data?.result_id).map((o) => ({ kind: "calculation", result_id: o.result.data.result_id, text: "-" }));
  const turn: ScriptTurn = { user: Q, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "hip fracture", words: "breaks his hip" }, { key: "how_it_happened", value: "accident", words: "in an accident" }] })],
    () => [call("person_benefits", { subject_id: D, topic: "Simple Fracture hip accident" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: schedOf(v, /^Simple Fracture$/)?.benefit_id, purpose: "what_if", case: "hip", fact_keys: ["injury"] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: calcs(v), next_steps: [] })],
  ] };
  await withModel(turn, Q, (v) => {
    check("R5b a fracture question that only mentions the death cover is not expanded into a death assessment", /S\$3,750/.test(v) && !/Group Term Life|Compassionate Death Allowance|Repatriation|1,000,000|Accidental Death|proof of death/.test(v), v);
  });
}
async function d3() {
  const Q = "My husband Daniel passed away in an accident last week. Which of our insurance covers pay anything, how much, and what do I need to do first?";
  const turn: ScriptTurn = { user: Q, steps: [
    () => [call("resolve_person", { mention: "my husband Daniel" })],
    () => [call("person_benefits", { subject_id: D, topic: "death; accidental death" })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) }], next_steps: [] })],
  ] };
  await withModel(turn, Q, (v, tr) => {
    const rp = tr.toolCalls.find((t: any) => t.name === "resolve_person");
    check("R1 (route) \"my husband Daniel\" resolves through the real chat route without a question", !!rp && rp.ok && !/ambiguous|unknown/.test(JSON.stringify(rp.summary ?? "")) && !/I need to know who this is about/.test(v), JSON.stringify(rp) + "\n" + v);
    check("R1 (route) the answer is Daniel's, with the Term Life amount and a next step", /Group Term Life/.test(v) && /1,000,000/.test(v) && /Contact Aldermoor Life Ltd/.test(v), v);
    check("R1 (route) no \"(your you)\" label and no question to the widow about who Daniel is", !/your you/.test(v) && !/Do you mean Daniel/.test(v), v);
  });
}
async function narrow() {
  const NQ = "How much does Daniel's Group Term Life pay if he dies?";
  const turn: ScriptTurn = { user: NQ, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "Group Term Life death" })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) }], next_steps: [] })],
  ] };
  await withModel(turn, NQ, (v) => {
    check("R6 a narrow single-benefit death question is answered for that benefit", /Group Term Life/.test(v) && /1,000,000/.test(v), v);
    check("R6 …and is not expanded with the other death benefits", !/Compassionate Death Allowance|Repatriation|Personal Accident|600,000/i.test(v), v);
  });
  const CQ = "Which pays more if Daniel dies, his Group Term Life or his Group Personal Accident?";
  const turn2: ScriptTurn = { user: CQ, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "Group Term Life; Group Personal Accident; death" })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) }, { kind: "benefit_terms", benefit_id: benefitIdOf(v, /Accidental Death|Personal Accident/i) }], next_steps: [] })],
  ] };
  await withModel(turn2, CQ, (v) => {
    check("R6 a comparison of two named benefits is answered with those two", /Term Life/.test(v) && /(?:Personal Accident|Accidental Death)/.test(v), v);
    check("R6 …and is not expanded with the allowance or repatriation", !/Compassionate Death Allowance|Repatriation/i.test(v), v);
  });
}
async function restore() {
  const turn: ScriptTurn = { user: DEATH_Q, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death" })],
    () => [call("search_passages", { subject_id: D, query: "Compassionate Death Allowance funeral expenses", k: 6 })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      { kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) },
      { kind: "fact", text: "Grace’s certificate lists Group Term Life of S$200,000 as of 6 October 2022.", evidence_ids: [idsOf(v, "person_benefits")[0]] },
      { kind: "fact", text: "The Group Insurance Benefits Booklet says the Compassionate Death Allowance pays funeral expenses up to S$2,000 if an insured person dies as a result of an Accident.", evidence_ids: [hitOf(v, /funeral/)], benefit: "Compassionate Death Allowance Benefit" },
    ], next_steps: [] })],
  ] };
  await withModel(turn, DEATH_Q, (v) => {
    check("R7 a statement rejected for the wrong person is not restored (Grace's figure never appears for Daniel)", !/200,000|Grace/.test(v), v);
    check("R7 the wrong-currency statement is not restored: the booklet's amount is never S$2,000", !/booklet[^.\n]*S\$2,000/i.test(v), v);
    check("R7 …but the allowance is restored from Daniel's own record, with its printed conditions", /Compassionate Death Allowance/i.test(v) && /proof of death/i.test(v), v);
  });
}

async function restore2() {
  // wrong PRODUCT: a sentence that names one document but cites another is rejected; the allowance then comes from the record only
  const turn: ScriptTurn = { user: DEATH_Q, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death" })],
    () => [call("search_passages", { subject_id: D, query: "Compassionate Death Allowance funeral expenses", k: 6 })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      { kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) },
      { kind: "fact", text: "The Group Personal Accident Benefit Summary says the Compassionate Death Allowance pays funeral expenses if an insured person dies as a result of an Accident.", evidence_ids: [hitOf(v, /funeral/)], benefit: "Compassionate Death Allowance Benefit" },
    ], next_steps: [] })],
  ] };
  await withModel(turn, DEATH_Q, (v) => {
    check("R7 a statement that names the wrong document for the allowance is not restored under that name", !/Personal Accident Benefit Summary says the Compassionate/i.test(v), v);
    check("R7 …the allowance appears once, from the booklet's own record, with its conditions", (v.match(/Compassionate Death Allowance/gi) ?? []).length >= 1 && /proof of death/i.test(v), v);
  });
  // wrong VERSION: the superseded 2022 product summary is never a source of the restored terms
  const turn2: ScriptTurn = { user: DEATH_Q, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "death" })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) }], next_steps: [] })],
  ] };
  await withModel(turn2, DEATH_Q, (v, tr) => {
    check("R7 no restored term is taken from the superseded 2022 product summary", !/\(2022\)/.test(v) && !/Product Summary \(2022\)/.test(JSON.stringify(tr.adjusted ?? [])), v);
  });
  // not APPLICABLE: the household reported a death by illness; accident-only death benefits already excluded this turn are not restored
  const Q = "Daniel died of an illness last week. What do we receive from his insurance and what should we do?";
  const turn3: ScriptTurn = { user: Q, steps: [
    () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "illness", words: "died of an illness" }] })],
    () => [call("person_benefits", { subject_id: D, topic: "death by illness" })],
    (v: ScriptView) => [call("evaluate_benefit", { subject_id: D, benefit_id: benefitIdOf(v, /Accidental Death/i), purpose: "claim", fact_keys: ["how_it_happened"] })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Term Life/i) }], next_steps: [] })],
  ] };
  await withModel(turn3, Q, (v) => {
    check("R7 Term Life is stated for a death by illness", /Group Term Life/.test(v) && /1,000,000/.test(v), v);
    // (Known gap, stated in the handoff: accident-only death benefits are still LISTED for a reported death by illness -- there is no server
    // applicability rule for them -- but each carries its printed accident condition and nothing says it is payable.)
    check("R7 the accident-only death benefits listed for a death by illness carry their printed accident condition and no payment promise", /dies as a result of an Accident/.test(v) && !/\b(?:will|would|shall) be paid\b|you will receive|is payable to you/i.test(v), v);
  });
}

(async () => { await topUp(); await d1(); await f1(); await f1b(); await d3(); await narrow(); await restore(); await restore2(); console.log(failed ? `\n${failed} FAILED` : "\nall passed"); process.exitCode = failed ? 1 : 0; })().catch((e) => { console.error(e); process.exitCode = 1; });

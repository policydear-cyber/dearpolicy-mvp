/**
 * Reliable chat, stage 3: the shared contracts on existing flows -- death explanations, statement integrity (no orphaned
 * timing / scheme / currency clauses; contact advice kept beside an unrelated insurer's clause), inventory vs an event
 * question, the hospital-day control, a side question and a fresh paraphrase -- through the real chat route with the
 * migrated contract. Model moves SCRIPTED (plumbing evidence). Graded C / K / S / U as in reliable-chat-slice.ts.
 *   HH=wong (default) | tan      node --import tsx scripts/reliable-chat-stage3.ts
 */
import assert from "node:assert/strict";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as T from "./fixtures/reliable-chat/tan";
import * as W from "./fixtures/rag2-pr50/household";
import type { ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
void assert;

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const HH = process.env.HH === "tan" ? T : W;
setEnv(HH as any);
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const visibleOf = (a: any) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
type Grade = { C: boolean; K: boolean; S: boolean; U: boolean; note?: string };
const results: { id: string; g: Grade }[] = [];
async function grade(id: string, fn: () => Promise<Grade> | Grade) {
  let g: Grade; try { g = await fn(); } catch (e) { g = { C: false, K: false, S: false, U: false, note: e instanceof Error ? e.stack ?? e.message : String(e) }; }
  const ok = g.C && g.K && g.S && g.U; results.push({ id, g });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}  C=${+g.C} K=${+g.K} S=${+g.S} U=${+g.U}${!ok && g.note ? "\n     " + g.note.split("\n").slice(0, 18).join("\n     ") : ""}`);
}
const pb = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "person_benefits")?.result?.data ?? {};
const benefits = (v: ScriptView) => ((pb(v).documents ?? []) as any[]).flatMap((d) => d.benefits.map((b: any) => ({ ...b, policy_id: d.policy_id })));
const bid = (v: ScriptView, re: RegExp) => benefits(v).find((b: any) => re.test(b.benefit))?.benefit_id as string;
const sched = (v: ScriptView, re: RegExp) => ((pb(v).schedules ?? []) as any[]).find((s) => re.test(s.benefit));
const evalOf = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "evaluate_benefit")?.result?.data ?? {};
const hit = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) { const hits = (o.result?.data?.hits ?? []) as any[]; const h = hits.find((x) => re.test(JSON.stringify(x))); if (h) return h.evidence.evidence_id as string; for (const b of benefits(v)) if (re.test(JSON.stringify(b))) return b.evidence?.evidence_id as string; } return "none"; };

async function main() {
  const h = await startHarness(HH as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { recomputeCalculation } = await import("@/lib/claims/calc-record");
  const run = async (turns: { user: string; steps: ((v: ScriptView) => any[])[] }[]) => {
    installLoopModel(new ScriptedLoopModel(turns as any));
    const out: { v: string; answer: any; trace: any; state: any }[] = [];
    try {
      let c: { id?: string; rev?: number } = {};
      for (const t of turns) { const a = await h.send(t.user, c); c = { id: a.conversationId, rev: a.conversationRevision }; const s = await h.savedAnswer(c.id!); out.push({ v: visibleOf(s.answer), answer: s.answer, trace: s.state.ragLoop.turns.at(-1), state: s.state }); if (process.env.SHOW) console.log(`\n=== [${t.user}]\n${visibleOf(s.answer)}\n--- dropped ${JSON.stringify(s.state.ragLoop.turns.at(-1)?.dropped ?? [])}`); }
    } finally { installLoopModel(null); }
    return out;
  };
  const why = (x: any) => `${x.v}\n--- dropped: ${JSON.stringify(x.trace?.dropped ?? [])}\n--- calls: ${JSON.stringify((x.trace?.toolCalls ?? []).map((c: any) => [c.name, c.ok, (c.error ?? "").slice(0, 300)]))}\n--- gate: ${JSON.stringify(x.trace?.gate ?? null)}`;

  if (HH === W) {
    const A = W.M.adrian.id;
    const DEATH = "Hypothetical test: Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Based on my uploaded documents, explain which death benefits may apply and what I should do next.";
    const CDA_OK = "The Public Officers wording also describes a Compassionate Death Allowance Benefit for accidental death, requiring proof of death and relevant documents in the insurer’s prescribed form, and says it can be claimed under either the Core Scheme or Voluntary Scheme; the uploaded documents do not establish Adrian’s applicable Sum Insured or scheme enrollment for this benefit.";
    const CDA_BAD = CDA_OK.replace("says it can be claimed under either the Core Scheme or Voluntary Scheme", "says it is payable only to a surviving spouse");
    const [t5] = await run([{ user: DEATH, steps: [
      () => [call("note_facts", { subject_id: A, facts: [{ key: "how_it_happened", value: "car accident in Japan", words: "Adrian died in a car accident in Japan" }] }), call("person_benefits", { subject_id: A, topic: "death after an accident" })],
      () => [call("search_passages", { query: "Compassionate Death Allowance Benefit proof of death prescribed form Core Scheme Voluntary Scheme", policy_ids: [W.doc("WORDING").id], subject_id: A }), call("search_passages", { query: "Accidental Death Sum Insured", policy_ids: [W.doc("SUMMARY").id], subject_id: A })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [
        { kind: "benefit_terms", benefit_id: bid(v, /Term Life/), text: "-" },
        { kind: "benefit_terms", benefit_id: bid(v, /^Group Personal Accident$/), text: "-" },
        { kind: "uncertainty", text: "Those certificate amounts are dated 6 October 2022; the documents do not establish whether this cover was still in force on 5 October 2026.", evidence_ids: [benefits(v).find((b: any) => /Term Life/.test(b.benefit))?.evidence?.evidence_id], subject_id: A },
        { kind: "fact", text: "The Public Officers Group Personal Accident summary pays Accidental Death as 100% of the Sum Insured.", evidence_ids: [hit(v, /Accidental Death: 100%/)], subject_id: A },
        // T1: a 90-day window borrowed from the unrelated travel wording -- the statement is left out whole
        { kind: "fact", text: "Accidental Death under the Public Officers Group Personal Accident is payable if death occurs within 90 days of the Accident.", evidence_ids: [hit(v, /Accidental Death: 100%/)], subject_id: A },
        // T2: the live sentence (all clauses supported) and its unsupported variant
        { kind: "fact", text: CDA_OK, evidence_ids: [hit(v, /Compassionate Death Allowance Benefit/)], subject_id: A },
      ], next_steps: [`contact:${W.doc("CERT").id}`, "Contact Kestrel Life Ltd through the scheme administrator to report the death, and ask Harbourline General whether a travel policy covered the trip."] })],
    ] }]);
    await grade("T5 death explanation: separate dated TL / PA for Adrian, event-date uncertainty, 100% Accidental Death, contact advice", () => ({
      C: /Group Term Life of S\$1,000,000 as of 6 October 2022/.test(t5.v) && /Group Personal Accident of S\$600,000 as of 6 October 2022/.test(t5.v) && !/S\$1,600,000/.test(t5.v),
      K: /do not establish whether this cover was still in force on 5 October 2026/.test(t5.v) && /100% of the Sum Insured/.test(t5.v),
      S: (t5.answer.figureBindings ?? []).filter((b: any) => b.subjectId === A && b.policyId === W.doc("CERT").id).length >= 2,
      U: /Contact Kestrel Life Ltd/.test(t5.v) && !/Harbourline/.test(t5.v), note: why(t5) }));
    await grade("T1 no orphaned timing clause: the borrowed 90-day statement is omitted whole (never \"payable if death occurs\" alone)", () => ({ C: !/90 days/.test(t5.v) && !/if death occurs\.?\s*$/m.test(t5.v) && !/death (?:must )?occurs?\.\s*$/m.test(t5.v), K: true, S: (t5.trace.dropped ?? []).some((d: any) => /90 days/.test(d.sentence)), U: /100% of the Sum Insured/.test(t5.v), note: why(t5) }));
    await grade("T2a the live CDA sentence, every clause supported, is kept whole (the uncertainty as its own statement)", () => ({ C: /Compassionate Death Allowance Benefit for accidental death/.test(t5.v) && /either the Core Scheme or Voluntary Scheme/.test(t5.v), K: /do not establish Adrian’s applicable Sum Insured or scheme enrollment/.test(t5.v), S: true, U: !/^Says /m.test(t5.v), note: why(t5) }));
    await grade("T4 contact advice survives the unrelated insurer's clause; the server's contact step names the certificate's own insurer", () => ({ C: !/Harbourline/.test(t5.v), K: /Contact Kestrel Life Ltd/.test(t5.v), S: true, U: (t5.answer.nextSteps ?? []).length >= 1, note: why(t5) }));
    const [t2] = await run([{ user: DEATH, steps: [
      () => [call("search_passages", { query: "Compassionate Death Allowance Benefit proof of death prescribed form", policy_ids: [W.doc("WORDING").id], subject_id: A })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [{ kind: "fact", text: CDA_BAD, evidence_ids: [hit(v, /Compassionate Death Allowance Benefit/)], subject_id: A }] })],
    ] }]);
    await grade("T2b an unsupported clause omits its whole dependent statement (no \"Says it ...\" orphan under another benefit); the independent uncertainty stays", () => ({ C: !/surviving spouse/.test(t2.v) && !/^\s*(?:And )?says\b/im.test(t2.v) && !/^\s*Requiring\b/im.test(t2.v), K: /do not establish Adrian’s applicable Sum Insured or scheme enrollment/.test(t2.v), S: (t2.trace.dropped ?? []).some((d: any) => /surviving spouse/.test(d.sentence)), U: true, note: why(t2) }));
    // I2: an event question that calls the document lookup is not turned into an inventory
    const Q = "Which of my uploaded policies should I claim under for Adrian's accident?";
    const [i2] = await run([{ user: Q, steps: [
      () => [call("household_documents", {}), call("person_benefits", { subject_id: A, topic: "accident" })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [
        { kind: "benefit_terms", benefit_id: bid(v, /^Group Personal Accident$/), text: "-" },
        { kind: "fact", text: "The Public Officers Group Personal Accident summary pays Accidental Death as 100% of the Sum Insured.", evidence_ids: [hit(v, /Accidental Death: 100%/)], subject_id: A },
      ], next_steps: [`contact:${W.doc("CERT").id}`] })],
    ] }]);
    await grade("I2 event question: answered with Adrian's relevant benefits; no household inventory although household_documents was called", () => ({ C: /Group Personal Accident of S\$600,000/.test(i2.v), K: /Contact Kestrel/.test(i2.v), S: true, U: !/Linked to nobody|Not linked to anyone|could not be read|Cheryl:|Ethan/.test(i2.v), note: why(i2) }));
    // G5: a fresh paraphrase of the fracture question
    const [g5] = await run([{ user: "If Adrian's leg fracture counts as a simple fracture, roughly how much would the summary of benefits give?", steps: [
      () => [call("person_benefits", { subject_id: A, topic: "simple fracture leg" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: sched(v, /Simple Fracture/)?.benefit_id, subject_id: A, purpose: "what_if", case: "leg" })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-" }] })],
    ] }]);
    await grade("G5 fresh paraphrase: S$2,500 from 50% of the fixed S$5,000 limit, re-verifiable", () => { const rec = (g5.answer.calculations ?? [])[0]; const re = rec ? recomputeCalculation(rec) : { ok: false } as any; return { C: /S\$2,500/.test(g5.v) && /S\$5,000/.test(g5.v), K: /Jaw, Pelvis, Leg/.test(g5.v), S: re.ok && re.resultMinor === 250000, U: !/couldn['’]t/i.test(g5.v), note: why(g5) }; });
  } else {
    const J = T.M.jun.id;
    // H1 hospital-day control through evaluate_benefit (existing hospital-cash calculator)
    const HQ = "Jun was in hospital after the accident from 3 March 2026 10:00 to 5 March 2026 09:00. What is the hospital income?";
    const [h1] = await run([{ user: HQ, steps: [
      () => [call("note_facts", { subject_id: J, facts: [{ key: "admission_datetime", value: "2026-03-03T10:00+08:00", words: "from 3 March 2026 10:00" }, { key: "discharge_datetime", value: "2026-03-05T09:00+08:00", words: "to 5 March 2026 09:00" }, { key: "how_it_happened", value: "after the accident", words: "in hospital after the accident" }] }), call("person_benefits", { subject_id: J, topic: "hospital" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: bid(v, /Hospital Income/), subject_id: J, purpose: "claim", admission: { at: "2026-03-03T10:00+08:00", words: "from 3 March 2026 10:00" }, discharge: { at: "2026-03-05T09:00+08:00", words: "to 5 March 2026 09:00" } })],
      (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "benefit_terms", benefit_id: bid(v, /Hospital Income/), text: "-" }, { kind: "calculation", result_id: evalOf(v).result_id, text: "-" }] })],
    ] }]);
    await grade("H1 hospital-day control: S$100 per day, one complete 24-hour period -> S$100 (never nights)", () => { const rec = (h1.answer.calculations ?? [])[0]; const re = rec ? recomputeCalculation(rec) : { ok: false } as any; return { C: /S\$100\b/.test(h1.v) && !/S\$200/.test(h1.v) && !/night/i.test(h1.v), K: /per day/.test(h1.v), S: re.ok && re.resultMinor === 10000, U: !/couldn['’]t/i.test(h1.v), note: why(h1) }; });
    // G2 side question while the bone question is pending, then the pending question is put back
    const [, g2] = await run([
      { user: "Jun broke his leg playing football. What could his accident policy pay?", steps: [
        () => [call("note_facts", { subject_id: J, facts: [{ key: "injury", value: "broke his leg", words: "Jun broke his leg playing football" }, { key: "how_it_happened", value: "playing football", words: "Jun broke his leg playing football" }] }), call("person_benefits", { subject_id: J, topic: "fracture leg" })],
        (v: ScriptView) => [call("evaluate_benefit", { benefit_id: sched(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", case: "leg" })],
        (v: ScriptView) => [call("ask_user", { kind: "fact", subject_id: J, fact_key: "bone", statements: [{ kind: "benefit_terms", benefit_id: sched(v, /Fracture/)?.benefit_id }], question: "Which leg bone was it — the thigh bone (femur), or below the knee (tibia or fibula)?", because_evidence_ids: [sched(v, /Fracture/)?.evidence?.evidence_id] })],
      ] },
      { user: "Before that - what does the policy pay per day in hospital?", steps: [
        () => [call("person_benefits", { subject_id: J, topic: "hospital" })],
        (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "benefit_terms", benefit_id: bid(v, /Hospital Income/), text: "-" }, { kind: "fact", text: "Hospital Income counts each complete period of 24 hours in hospital following an Accident, up to 30 days per Accident.", evidence_ids: [benefits(v).find((b: any) => /Hospital Income/.test(b.benefit))?.evidence?.evidence_id], subject_id: J }] })],
      ] },
    ]);
    await grade("G2 side question answered for Jun (S$100 per day, 24-hour rule, 30 days), then the pending bone question is put back", () => ({ C: /S\$100 per day/.test(g2.v), K: /24 hours/.test(g2.v) && /30 days/.test(g2.v), S: true, U: /thigh bone|below the knee|which leg bone/i.test(g2.v), note: why(g2) }));
    // T3 currency: a bare-$ amount with no currency statement -- the statement is omitted whole (no orphan condition)
    const [t3] = await run([{ user: "Is there anything for Jun's education if I die in an accident?", steps: [
      () => [call("person_benefits", { subject_id: T.M.meiling.id, topic: "child education death" }), call("search_passages", { query: "Child Education Benefit child under 18 dies in an Accident", policy_ids: [T.doc("WORDING").id], subject_id: T.M.meiling.id })],
      (v: ScriptView) => [call("final_answer", { subject_id: T.M.meiling.id, sentences: [
        { kind: "fact", text: "The FamilyGuard wording prints a Child Education Benefit of S$5,000 per child, payable only for a child under 18 when the Insured Person dies in an Accident.", evidence_ids: [hit(v, /Child Education/)], subject_id: T.M.meiling.id },
        { kind: "fact", text: "The FamilyGuard wording prints a Child Education Benefit for a child of the Insured Person who is under 18 when the Insured Person dies in an Accident; the amount it prints has no currency stated.", evidence_ids: [hit(v, /Child Education/)], subject_id: T.M.meiling.id },
      ] })],
    ] }]);
    await grade("T3 currency: the S$ restatement of a bare-$ amount is omitted whole; the named benefit and its non-monetary terms remain; no orphaned \"payable only for a child under 18\"", () => ({ C: !/S\$5,000/.test(t3.v), K: /Child Education Benefit/.test(t3.v) && /under 18/.test(t3.v), S: (t3.trace.dropped ?? []).some((d: any) => /S\$5,000/.test(d.sentence)), U: !/^\s*Payable only/im.test(t3.v), note: why(t3) }));
  }
  const failed = results.filter((r) => !(r.g.C && r.g.K && r.g.S && r.g.U));
  console.log(`\nreliable-chat stage 3 [${HH === T ? "tan" : "wong"}] ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

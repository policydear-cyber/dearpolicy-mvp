/**
 * Structured-answers release: the seven complete journeys of docs/rag-migration/reliable-chat/EXPECTED-structured-answers.md
 * through the REAL chat route (scripted model moves, no model call), over the faithful anonymised actual-library
 * household (scripts/fixtures/reliable-chat/actual-lib.ts). Each journey checks what the household SEES (returned),
 * what is SAVED and what a REOPENED chat serves (the history route) -- they must agree.
 *   node --import tsx scripts/reliable-chat-structured-answers.ts          (SHOW=1 prints every answer and trace)
 * The scripted moves follow the actual-library report's described calls (the report file itself was not available to
 * this work; see the expectations document). They are model moves, not product code: the server must make them safe.
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as A from "./fixtures/reliable-chat/actual-lib";
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { gradeSAcorrection, gradeSAambiguity, gradeSAcompare, gradeSAdeath, gradeSAperson } from "./rag2-live/structured-check";

import { P_A_U2, pSecondInjuryTurn, P_B_U1, P_B_U2, P_B_U3, pSwitchTurns, P_C_U2, P_C_U3, pSideQuestionTurns } from "./fixtures/reliable-chat/actual-lib-conversations";
import { sentencesOf } from "@/lib/chat/answer-verification";
import { gradeV9, nextStepRequired, claimsATotal } from "./rag2-live/structured-regrade";
import { caseFor } from "@/lib/rag2/calc/case-terms";
import { requirementToAsk, type OpenRequirement } from "@/lib/rag2/loop/requirement-question";
import { planSchedules, namedSchedules } from "@/lib/rag2/loop/schedule-disposition";
import { D, G, CERT, N_U1, narrowTurn, SBB_U1, SBB_U2, sbbTurns, SBA_U1, SBA_U2, sbaTurns, SAR_U1, SAR_U2, sarTurns, J3B_U1, J3B_U2, j3bTurns, J1_U, J2_U, J3_U1, J3_U2, J4_U, J5_U, J6_U, j1Turn, j2Turn, j3Turns, j4Turn, j5Turn, j5sTurn, j6Turn } from "./fixtures/reliable-chat/actual-lib-conversations";
process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(A as any);
let failed = 0, passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else { failed++; failures.push(name); } console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.replace(/\n/g, "\n     ") : ""}`); };
async function main() {
  const h = await startHarness(A as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { NextRequest } = await import("next/server");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
  const reopen = async (conv: string) => { const r = await history(new NextRequest(`http://localhost/api/chat/history/${conv}`), { params: Promise.resolve({ id: conv }) }); const j = await r.json(); return (j.messages ?? []).filter((m: any) => m.role === "assistant").map((m: any) => m.answer_json); };
  type Turn = { v: string; shown: string; reopened: string; answer: any; state: any; trace: any };
  const converse = async (label: string, users: string[], turns: ScriptTurn[]): Promise<Turn[]> => {
    installLoopModel(new ScriptedLoopModel(turns));
    const out: Turn[] = []; let c: { id?: string; rev?: number } = {};
    try {
      for (const u of users) {
        const a = await h.send(u, c); c = { id: a.conversationId!, rev: a.conversationRevision };
        const s = await h.savedAnswer(a.conversationId!);
        const re = await reopen(a.conversationId!);
        out.push({ v: visibleOf(s.answer), shown: visibleOf(a), reopened: visibleOf(re.at(-1)), answer: s.answer, state: s.state, trace: s.state.ragLoop?.turns?.at(-1) });
        if (process.env.SHOW) console.log(`--- ${label} turn ${out.length}: ${u}\n${out.at(-1)!.v}\n  dropped: ${JSON.stringify(out.at(-1)!.trace?.dropped ?? [])}\n  gate: ${JSON.stringify(out.at(-1)!.trace?.gate ?? [])}`);
      }
    } finally { installLoopModel(null); }
    return out;
  };
  const lines = (v: string) => v.split("\n").filter(Boolean);
  /** No orphaned condition, unfinished clause or unnamed amount: every visible line ends as a sentence or question. */
  const complete = (v: string) => lines(v).every((l) => /[.?!]["”’)]?$/.test(l.trim()) && !/\b(?:if|when|and|or|which|the|of|to|under)\s*[“"]?[.?]$/i.test(l.trim()));
  const agrees = (t: Turn) => t.v === t.shown && t.v === t.reopened;
  const NOT_CONFIRMED = /couldn[’']t confirm|could not confirm|left out|haven[’']t (?:stated|given)/i;
  const IDENT = /\b(?:the|of) Schedule\b|“Schedule”|\bSchedule benefit\b|^•|\s•\s/m;

  // ===== J1: closed tibia -> conditional S$2,500
  const [j1] = await converse("J1", [J1_U], [j1Turn()]);
  const sf1 = lines(j1.v).find((l) => /S\$2,500/.test(l)) ?? "";
  check("J1: the Simple Fracture illustration S$2,500 is shown, conditional (“If …”), with its row, 50% and the S$5,000 limit", /^If the Simple Fracture/.test(sf1) && /50%/.test(sf1) && /S\$5,000/.test(sf1) && /Group Insurance Product Summary/.test(sf1), j1.v);
  check("J1: the Group Personal Accident Benefit Summary's S$300,000 is NOT presented as an illustration for the same reported closed fracture (its leg row is printed only for an Other Fracture)", !/S\$300,000/.test(j1.v) || /Other Fracture/.test(lines(j1.v).find((l) => /S\$300,000/.test(l)) ?? ""), j1.v);
  check("J1: the second document's fracture table is said separately, with the specific unresolved relationship (never added, never chosen as controlling)", /Group Personal Accident Benefit Summary/.test(j1.v) && /(?:neither document says|(?:does not|do not|doesn[’']t|don[’']t) (?:say|establish|state))/i.test(j1.v) && !/S\$302,500|in total|combined/i.test(j1.v), j1.v);
  check("J1: no generic identity (“Schedule”, a bullet or an empty label)", !IDENT.test(j1.v), j1.v);
  check("J1: complete sentences only; nothing withheld; returned = saved = reopened", complete(j1.v) && !NOT_CONFIRMED.test(j1.v) && agrees(j1), JSON.stringify([j1.v, j1.shown === j1.v, j1.reopened === j1.v]));
  check("J1: the contact step for the person's own insurer is shown", /Contact Aldermoor Life Ltd/.test(j1.v), j1.v);

  // ===== J2: correction to hip -> the tibia illustration withdrawn; conditional S$3,750 complete, saved and displayed
  const [, j2] = await converse("J2", [J1_U, J2_U], [j1Turn(), j2Turn()]);
  const hip = lines(j2.v).find((l) => /S\$3,750/.test(l)) ?? "";
  check("J2: the S$3,750 illustration is one complete conditional sentence: If … Daniel … Hip … 75% of the S$5,000 limit … not a payment", /^If the Simple Fracture/.test(hip) && /Daniel/.test(hip) && /“Hip”/.test(hip) && /75% of the Simple Fracture benefit limit of S\$5,000/i.test(hip) && /not a payment/.test(hip), j2.v);
  check("J2: it is not withheld or replaced by a refusal, and no unfinished clause is left", !NOT_CONFIRMED.test(j2.v) && complete(j2.v), j2.v);
  check("J2: the household's message is not quoted into the calculation (“Correction: …”)", !/Correction:|as you described/i.test(j2.v), j2.v);
  check("J2: the earlier tibia illustration (S$2,500) is not current in the answer", !/S\$2,500/.test(j2.v) || /withdrawn|no longer|replaced/i.test(lines(j2.v).find((l) => /S\$2,500/.test(l)) ?? ""), j2.v);
  check("J2: the saved calculation record is the displayed sentence, whole, and re-verifies (Hip 75% × S$5,000 = S$3,750)", (j2.answer.calculations ?? []).some((k: any) => k.result?.value === 3750 && lines(j2.v).includes(k.sentence)), JSON.stringify(j2.answer.calculations?.map((k: any) => [k.result?.value, k.sentence])));
  check("J2: returned = saved = reopened", agrees(j2), JSON.stringify([j2.shown, j2.reopened]));

  // ===== J3: uncertain hip / tibia -> one relevant question -> clarification -> current assumption, no repeated question
  const [j3a, j3b] = await converse("J3", [J3_U1, J3_U2], j3Turns());
  const q = (j3a.answer.questions ?? []) as any[];
  check("J3 turn 1: exactly one question, naming the hip and the leg (tibia) cases", q.length === 1 && /Hip/.test(q[0].text) && /Leg/.test(q[0].text), JSON.stringify(q));
  check("J3 turn 1: the supported terms come first (the Simple Fracture table with its S$5,000 base)", /S\$5,000/.test(j3a.answer.summary ?? "") || /S\$5,000/.test((j3a.answer.details ?? []).join(" ")), j3a.v);
  const qev = JSON.stringify(j3a.answer.questions?.[0]?.citations ?? j3a.state?.pending?.evidence ?? j3a.answer.citations ?? []);
  check("J3 turn 1: what makes the fact matter is cited from the hip / leg rows or their table, never an unrelated row (Cheekbone)", !/Cheekbone/.test(JSON.stringify(j3a.state?.pending ?? {})) && !/Cheekbone/.test(j3a.v.replace(/The Group Insurance Product Summary \(page 13\) pays[^\n]*/, "")), qev + "\n" + JSON.stringify(j3a.state?.pending));
  check("J3 turn 1: no question asks whether the insurer accepts / approves anything", !/insurer (?:accept|approve)|accepted by the insurer|approved by the insurer/i.test(q.map((x) => x.text).join(" ")), JSON.stringify(q));
  const tib = lines(j3b.v).find((l) => /S\$2,500/.test(l)) ?? "";
  check("J3 turn 2: the illustration is for the clarified case (leg row, S$2,500), conditional and complete", /^If the Simple Fracture/.test(tib) && /Leg/.test(tib) && complete(j3b.v), j3b.v);
  check("J3 turn 2: the earlier uncertain report is not the illustration's assumption (no “possibly”, “not sure”)", !/possibly|not sure/i.test(j3b.v), j3b.v);
  check("J3 turn 2: the question is not asked again; nothing pending", !(j3b.answer.questions ?? []).length && !j3b.state?.pending, JSON.stringify([j3b.answer.questions, j3b.state?.pending]));
  check("J3: returned = saved = reopened (both turns)", agrees(j3a) && agrees(j3b), JSON.stringify([j3a.shown === j3a.v, j3a.reopened === j3a.v, j3b.shown === j3b.v, j3b.reopened === j3b.v]));

  // ===== J3b: sa-live-2 SBp (real model): the clarification is recorded under another key and no question was pending
  const [j3ca, j3cb] = await converse("J3b", [J3B_U1, J3B_U2], j3bTurns());
  const tib2 = lines(j3cb.v).find((l) => /S\$2,500/.test(l)) ?? "";
  check("J3b turn 1: no amount before the case is known; the supported terms are given", !/conditional illustration is S\$/.test(j3ca.v) && /S\$5,000/.test(j3ca.v), j3ca.v);
  check("J3b turn 2: the clarification settles the case although it was recorded under another fact key and no question was pending (no case_conflict): the leg row, S$2,500, conditional", /^If the Simple Fracture/.test(tib2) && /Leg/.test(tib2) && complete(j3cb.v) && !NOT_CONFIRMED.test(j3cb.v), j3cb.v + "\n" + JSON.stringify(j3cb.trace?.toolCalls?.filter((t: any) => t.name === "evaluate_benefit").map((t: any) => t.summary)));
  check("J3b: returned = saved = reopened (both turns)", agrees(j3ca) && agrees(j3cb), "");

  // ===== SBa replay (round 3): sa-live-3's recorded calls -- the model identified the ambiguity and ended WITHOUT the question
  const [sba1, sba2] = await converse("SBa", [SBA_U1, SBA_U2], sbaTurns());
  const sq = (sba1.answer.questions ?? []) as any[];
  check("SBa replay turn 1: the supported terms of BOTH fracture tables come first (S$5,000 base and Daniel's own S$600,000 sum insured), no amount chosen", /S\$5,000/.test(sba1.v) && /S\$600,000/.test(sba1.v) && !/conditional illustration is S\$/.test(sba1.v), sba1.v);
  check("SBa replay turn 1: exactly one question, naming the hip and the leg cases, though the model never asked (server-owned requirement)", sq.length === 1 && /Hip/.test(sq[0].text) && /Leg/.test(sq[0].text), JSON.stringify(sq) + "\n" + sba1.v);
  check("SBa replay turn 1: pending state is the requirement's person, benefit and options (not an insurer question)", sba1.state?.ragLoop?.pending?.kind === "fact" && sba1.state.ragLoop.pending.subjectId === D && (sba1.state.ragLoop.pending.options ?? []).length >= 2 && !!sba1.state.ragLoop.pending.requirementId && !!sba1.state.ragLoop.pending.benefitId && !/insurer (?:accept|approve)|accepted by the insurer|approved by the insurer/i.test(sq.map((x) => x.text).join(" ")), JSON.stringify(sba1.state?.ragLoop?.pending));
  check("SBa replay turn 1: returned = saved = reopened; complete", agrees(sba1) && complete(sba1.v), sba1.v);
  check("SBa replay turn 2: the clarification settles it -- both illustrations (S$2,500 and S$300,000) as separate complete conditional statements, no question repeated, nothing pending", /S\$2,500/.test(sba2.v) && /S\$300,000/.test(sba2.v) && complete(sba2.v) && !(sba2.answer.questions ?? []).length && !sba2.state?.ragLoop?.pending, sba2.v + JSON.stringify(sba2.state?.ragLoop?.pending));

  // ===== SAr replay (round 3, sa-live-4): the first report recorded under two keys; the correction replaces dependents, whatever key it came under
  {
    const [sr1, sr2] = await converse("SAr", [SAR_U1, SAR_U2], sarTurns());
    check("SAr replay turn 1: both tibia illustrations (S$2,500 and S$300,000) given", /S\$2,500/.test(sr1.v) && /S\$300,000/.test(sr1.v) && agrees(sr1), sr1.v);
    check("SAr replay turn 2: the correction settles the case although the old report sits under another key -- no case_conflict, no question, one complete conditional S$3,750", /conditional illustration is S\$3,750/.test(sr2.v) && !(sr2.answer.questions ?? []).length && !sr2.state?.ragLoop?.pending && complete(sr2.v), sr2.v + JSON.stringify(sr2.trace?.toolCalls?.filter((t: any) => t.name === "evaluate_benefit").map((t: any) => t.summary)));
    {
      const rows = [{ id: "r2", label: "Hip" }, { id: "r3", label: "Jaw, Pelvis, Leg, Ankle or Knee" }, { id: "r5", label: "Arm, Elbow, Wrist or Ribs" }] as any;
      const kind = (w: string) => { const c = caseFor(rows, w) as any; return c.kind === "row" ? c.row.id : c.kind; };
      check("negation: “not the lower leg” negates the leg (with its qualifier) -- the hip is the one case named; “not the upper arm” likewise", kind("the break is actually at the hip, not the lower leg.") === "r2" && kind("it is the wrist, not the upper arm") === "r5");
      check("negation control: an affirmed “lower leg” still names the leg row, and “hip or lower leg” stays ambiguous", kind("a closed break in his lower leg") === "r3" && kind("his hip or the lower leg") === "ambiguous");
    }
    check("SAr replay turn 2: the tibia amounts are withdrawn, not current", !lines(sr2.v).some((l) => /conditional illustration is S\$(?:2,500|300,000)/.test(l)) && agrees(sr2), sr2.v);
  }

  // ===== SBb replay (round 4, sa-live-4): the model evaluated only the Group Personal Accident table; the lookup had also returned Simple Fracture
  {
    const [b1, b2] = await converse("SBb", [SBB_U1, SBB_U2], sbbTurns());
    const bq = (b1.answer.questions ?? []) as any[];
    const sched = (t: Turn) => (t.trace?.schedules ?? []) as any[];
    check("SBb replay turn 1: both schedules' supported terms (the S$5,000 limit and Daniel's S$600,000 sum insured) although the model evaluated one", /S\$5,000/.test(b1.v) && /S\$600,000/.test(b1.v) && !/conditional illustration is S\$/.test(b1.v), b1.v);
    check("SBb replay turn 1: the unresolved relationship is stated, no definition invented, exactly one question", /Neither document says whether one amends, replaces or adds to the other/.test(b1.v) && bq.length === 1, b1.v + JSON.stringify(bq));
    check("SBb replay turn 1: both schedules carry a recorded disposition", sched(b1).length >= 2 && sched(b1).every((x) => ["explained", "evaluated", "excluded", "unresolved"].includes(x.disposition) && x.reason), JSON.stringify(sched(b1)));
    check("SBb replay turn 1: returned = saved = reopened; complete", agrees(b1) && complete(b1.v), b1.v);
    check("SBb replay turn 2: both conditional alternatives (S$2,500 and S$300,000) as separate statements, never a total, no repeated question, nothing pending", /S\$2,500/.test(b2.v) && /S\$300,000/.test(b2.v) && !claimsATotal(b2.v) && !(b2.answer.questions ?? []).length && !b2.state?.ragLoop?.pending && complete(b2.v) && agrees(b2), b2.v);
    check("SBb replay turn 2: neither alternative is added to the other (no S$302,500)", !/302,500/.test(b2.v), b2.v);
    // controls: nothing extra is added
    const [n1] = await converse("SBb-narrow", [N_U1], [narrowTurn()]);
    check("SBb control: an explicitly narrow single-benefit question (“the Simple Fracture benefit”) gets only that benefit -- no Group Personal Accident material added", /S\$2,500/.test(n1.v) && !/S\$300,000|S\$600,000|Personal Accident/.test(n1.v) && agrees(n1), n1.v);
    const sch = (id: string, benefit = "Simple Fracture", subjectId = D) => ({ id, benefit, subjectId });
    const base = { subjectId: D, eventText: "closed tibia fracture accident", userTexts: [] as string[], message: "What would his accident cover pay?", notApplicable: new Map<string, string>() };
    const two = [sch("s1"), sch("s2", "Simple Fracture or Other Fracture due to Accident")];
    check("schedule plan: two relevant schedules, the reply covers one -> the other is completed", planSchedules({ ...base, discovered: two, covered: new Map([["s2", "evaluated" as const]]) }).complete.map((x) => x.id).join() === "s1");
    check("schedule plan: both already covered -> nothing to complete, both rows recorded", (() => { const p = planSchedules({ ...base, discovered: two, covered: new Map([["s1", "explained" as const], ["s2", "evaluated" as const]]) }); return !p.complete.length && p.rows.length === 2; })());
    check("schedule plan: an unrelated benefit (no shared event topic) is excluded, never completed", (() => { const p = planSchedules({ ...base, discovered: [sch("s1"), sch("s3", "Compassionate Death Allowance")], covered: new Map([["s1", "evaluated" as const]]) }); return !p.complete.length; })());
    check("schedule plan: another person's schedules are not this person's (no completion)", !planSchedules({ ...base, discovered: [sch("s1"), sch("s2", "Simple Fracture or Other Fracture due to Accident", G)], covered: new Map([["s1", "evaluated" as const]]) }).complete.length);
    check("schedule plan: a reply covering no discovered schedule is not padded", !planSchedules({ ...base, discovered: two, covered: new Map() }).complete.length);
    check("schedule plan: a benefit the household named is the only one wanted (the other is excluded with their own words)", (() => { const p = planSchedules({ ...base, message: "What would the Simple Fracture benefit give?", userTexts: ["What would the Simple Fracture benefit give?"], discovered: two, covered: new Map([["s1", "evaluated" as const]]) }); return !p.complete.length && p.rows.some((r) => r.disposition === "excluded" && /own words/.test(r.reason)); })());
    check("schedule plan: a source-backed not-applicable reason excludes it", (() => { const p = planSchedules({ ...base, discovered: two, covered: new Map([["s1", "evaluated" as const]]), notApplicable: new Map([["s2", "the certificate excludes it"]]) }); return !p.complete.length && p.rows.some((r) => r.benefitId === "s2" && r.disposition === "excluded"); })());
    check("schedule plan: naming helper -- no named benefit means no restriction", namedSchedules([], "What would his accident cover pay?", two) === null);
  }

  // ===== Round 3: when the server owes the household a question (negative controls of the finalisation rule)
  {
    const R = (o: Partial<OpenRequirement> = {}): OpenRequirement => ({ id: "q1_1", subjectId: D, benefit: "Simple Fracture", benefitId: "b1", factKey: "fracture_site", resolvedBy: "household", ...o });
    const F = (o: Partial<Parameters<typeof requirementToAsk>[1]> = {}) => ({ alreadyPending: false, subjectId: D, presented: new Set(["Simple Fracture"]), withAmount: new Set<string>(), known: () => false, message: "What would his accident cover pay?", ...o });
    check("requirement rule: an unresolved household requirement the reply presents, with no amount, is asked", requirementToAsk([R()], F())?.id === "q1_1");
    check("requirement rule: nothing is added when the reply already asks (no second question)", requirementToAsk([R()], F({ alreadyPending: true })) === null);
    check("requirement rule: an insurer-only requirement is never asked", requirementToAsk([R({ resolvedBy: "insurer" })], F()) === null);
    check("requirement rule: another person's requirement is not asked in this person's answer", requirementToAsk([R({ subjectId: G })], F()) === null);
    check("requirement rule: a settled question (the fact is known) is not asked again", requirementToAsk([R()], F({ known: (k) => k === "fracture_site" })) === null);
    check("requirement rule: a requirement for a benefit the reply does not present (irrelevant) is not asked", requirementToAsk([R({ benefit: "Hospital Cash" })], F()) === null);
    check("requirement rule: a benefit the reply already gives an amount for needs no clarification", requirementToAsk([R()], F({ withAmount: new Set(["Simple Fracture"]) })) === null);
    check("requirement rule: an explicit comparison of hypothetical alternatives needs no compulsory question", requirementToAsk([R()], F({ message: "Can you compare what the Simple Fracture and the Other Fracture benefits would pay?" })) === null && requirementToAsk([R()], F({ message: "Simple Fracture versus Other Fracture for a broken leg?" })) === null);
    check("requirement rule: two open requirements give exactly one question (the earliest)", requirementToAsk([R(), R({ id: "q1_2", benefit: "Other" })], F({ presented: new Set(["Simple Fracture", "Other"]) }))?.id === "q1_1");
  }

  // ===== Round 3: clarification provenance stays scoped to person, event and benefit
  {
    const factsOf = (t: Turn, subject = D) => Object.entries((subject === t.state?.ragLoop?.claim?.subjectId ? t.state?.ragLoop?.claim?.facts : t.state?.ragLoop?.otherClaims?.[subject]?.facts) ?? {}).map(([k, f]: any) => `${k}: ${f.words}`);
    // (a) a second injury is its own event: it replaces nothing, and nothing is computed over the conflict
    const [pa1, pa2] = await converse("P-a", [J1_U, P_A_U2], [j1Turn(), pSecondInjuryTurn()]);
    check("provenance (a) second injury: the first injury report is kept alongside it (recorded under its own key), not replaced", factsOf(pa2).some((f) => /tibia/.test(f)) && factsOf(pa2).some((f) => /wrist/.test(f)), JSON.stringify(factsOf(pa2)));
    check("provenance (a) second injury: it is not presented as a correction (no “Updated: injury is now”, no “no longer applies”)", !/Updated:|no longer applies|earlier estimate/i.test(pa2.v), pa2.v);
    check("provenance (a) second injury: no amount is computed over the unresolved tibia/wrist conflict, and no figure is invented for either", !(pa2.answer.calculations ?? []).length && !/conditional illustration is S\$/.test(pa2.v), pa2.v);
    check("provenance (a) second injury: returned = saved = reopened; complete", agrees(pa1) && agrees(pa2) && complete(pa2.v), pa2.v);
    // (b) Daniel's question is pending; Grace's hip answers Grace's question only
    const [pb1, pb2, pb3] = await converse("P-b", [P_B_U1, P_B_U2, P_B_U3], pSwitchTurns());
    check("provenance (b) person switch: Grace's own hip illustration (S$3,750, named for Grace) is given", /^If the Simple Fracture benefit applies to Grace's case “Hip”/m.test(pb2.v) && /S\$3,750/.test(pb2.v), pb2.v);
    const pend2 = pb2.state?.ragLoop?.pending;
    check("provenance (b) person switch: Daniel's open case question is still his (not settled by Grace's hip)", pend2?.kind === "fact" && pend2.subjectId === D && /Hip/.test(pend2.question) && /Jaw, Pelvis, Leg/.test(pend2.question), JSON.stringify(pend2));
    check("provenance (b) person switch: Grace's words are not recorded as Daniel's report", !factsOf(pb2).some((f) => /Grace/i.test(f)) && !factsOf(pb3).some((f) => /Grace/i.test(f)), JSON.stringify(factsOf(pb3)));
    check("provenance (b) person switch: back on Daniel the case is still open -- supported terms and ONE question (hip or leg), no amount for Daniel", (pb3.answer.questions ?? []).length === 1 && /Hip/.test(pb3.answer.questions[0].text) && !lines(pb3.v).some((l) => /Daniel/.test(l) && /S\$3,750/.test(l)) && !/conditional illustration is S\$/.test(pb3.v), pb3.v);
    check("provenance (b): returned = saved = reopened (all turns)", agrees(pb1) && agrees(pb2) && agrees(pb3), "");
    // (c) a side question that mentions a body part is not an injury report
    const [pc1, pc2, pc3] = await converse("P-c", [J1_U, P_C_U2, P_C_U3], pSideQuestionTurns());
    check("provenance (c) side question: no correction is declared, and the hip is not recorded as Daniel's injury", !/Updated:|no longer applies|earlier estimate/i.test(pc2.v) && factsOf(pc3).length === 1 && /tibia/.test(factsOf(pc3)[0]) && !factsOf(pc3).some((f) => /hip/i.test(f)), JSON.stringify(factsOf(pc3)) + pc2.v);
    check("provenance (c) side question: the earlier tibia case still decides the illustration (leg row, S$2,500), never the hip's S$3,750", /conditional illustration is S\$2,500/.test(pc3.v) && !/S\$3,750/.test(pc3.v), pc3.v);
    check("provenance (c): returned = saved = reopened (all turns)", agrees(pc1) && agrees(pc2) && agrees(pc3), "");
    // (d) an unresolved hip-or-tibia report is settled only by a report of THOSE cases; a different injury settles nothing of it
    const [, pd2] = await converse("P-d", [J3_U1, P_A_U2], [j3Turns()[0], pSecondInjuryTurn()]);
    check("provenance (d) unresolved hip-or-tibia, then a wrist: the wrist does not silently settle (or replace) the open hip/leg report -- no amount is computed", !(pd2.answer.calculations ?? []).length && !/conditional illustration is S\$/.test(pd2.v) && !/Updated:|no longer applies/i.test(pd2.v), pd2.v + JSON.stringify(pd2.trace?.toolCalls?.filter((t: any) => t.name === "evaluate_benefit").map((t: any) => t.summary)));
    void pa1; void pb1; void pc1;
  }

  // ===== J4: Simple vs Other comparison -> separate bases, honest relationship
  const [j4] = await converse("J4", [J4_U], [j4Turn()]);
  const s4 = lines(j4.v).find((l) => /S\$2,500/.test(l)) ?? "", o4 = lines(j4.v).find((l) => /S\$300,000/.test(l)) ?? "";
  check("J4: Simple Fracture: S$2,500 = 50% of the S$5,000 limit, under the Group Insurance Product Summary", /50%/.test(s4) && /S\$5,000/.test(s4) && /Product Summary/.test(s4), j4.v);
  check("J4: Other Fracture: S$300,000 = 50% of Daniel's own S$600,000 Group Personal Accident sum insured, under the Group Personal Accident Benefit Summary, stating its own assumption (an Other Fracture)", /50%/.test(o4) && /S\$600,000/.test(o4) && /Personal Accident Benefit Summary/.test(o4) && /Other Fracture/.test(o4), j4.v);
  check("J4: the two are alternatives, not a total; the documents' relationship is said as unestablished", !/S\$302,500|in total|combined|plus/i.test(j4.v) && /(?:neither document says|(?:does not|do not|doesn[’']t|don[’']t) (?:say|establish|state))/i.test(j4.v), j4.v);
  check("J4: no synthetic definition is imported (“Simple Fracture means …”, “closed fracture where”)", !/means a closed|means a fracture that is not|skin is not broken/i.test(j4.v), j4.v);
  check("J4: no “Schedule” identity; complete; returned = saved = reopened", !IDENT.test(j4.v) && complete(j4.v) && agrees(j4), j4.v);

  // ===== J5: death allowance -> retained, complete conditions, honest currency, contact step
  const [j5] = await converse("J5", [J5_U], [j5Turn()]);
  check("J5: the booklet's Compassionate Death Allowance is retained by name with its complete printed conditions", /Compassionate Death Allowance Benefit/.test(j5.v) && /proof of death and the relevant documents in our prescribed form/.test(j5.v) && /Core Scheme or the Voluntary Scheme/.test(j5.v), j5.v);
  check("J5: the booklet's bare $2,000 is said with its currency unstated, never as S$2,000 for the booklet", /2,000 \(printed with a bare “\$” sign/.test(j5.v) && !/booklet[^\n]*S\$2,000/i.test(j5.v), j5.v);
  check("J5: the contact step names the person's own insurer; complete; returned = saved = reopened", /Contact Aldermoor Life Ltd/.test(j5.v) && complete(j5.v) && agrees(j5), j5.v);

  // ===== J5s: the product summary's wrapped footnote is quoted in full (PR #54 report: it stopped at "Core Scheme or Voluntary")
  const [j5s] = await converse("J5s", [J5_U], [j5sTurn()]);
  const cda5s = lines(j5s.v).find((l) => /Compassionate Death/.test(l)) ?? "";
  check("J5s: the product summary's Compassionate Death Allowance keeps its whole printed footnote (“... Core Scheme or Voluntary Scheme.”), not a cut quotation", /Compassionate Death Allowance/.test(cda5s) && /S\$2,000/.test(cda5s) && /Core Scheme or Voluntary Scheme/.test(j5s.v) && complete(j5s.v) && agrees(j5s), j5s.v);

  // ===== J6: person switch -> Grace's own certificate row and date
  const [, j6] = await converse("J6", [J1_U, J6_U], [j1Turn(), j6Turn()]);
  check("J6: Grace's own illustration (Hip 75% of the S$5,000 limit = S$3,750) names Grace", /S\$3,750/.test(j6.v) && /Grace/.test(lines(j6.v).find((l) => /S\$3,750/.test(l)) ?? ""), j6.v);
  check("J6: Grace's own certificate row and date (S$100,000 as of 1 July 2024), never Daniel's S$600,000 or his date", /S\$100,000/.test(j6.v) && /1 July 2024/.test(j6.v) && !/S\$600,000|1 April 2024|Daniel/.test(j6.v), j6.v);
  check("J6: complete; returned = saved = reopened", complete(j6.v) && agrees(j6), j6.v);

  // ===== J7: reopen -> the same valid statements, sources and state (checked in every journey above), plus the
  // calculation and evidence records survive the reopen unchanged
  {
    const conv = j2.answer.conversationId ?? null;
    const re = conv ? (await reopen(conv)).at(-1) : null;
    check("J7: reopened J2 answer keeps the same calculation records and citations as saved", !!re && JSON.stringify(re.calculations ?? []) === JSON.stringify(j2.answer.calculations ?? []) && JSON.stringify(re.citations ?? []) === JSON.stringify(j2.answer.citations ?? []), JSON.stringify([re?.calculations, j2.answer.calculations]).slice(0, 600));
  }

  // ===== negative controls
  {
    const [x] = await converse("N-household", [J1_U], [j1Turn()]);
    check("N1 household / version: never another household's limit (S$7,000), the superseded summary's (S$4,000) or the other household's sum insured (S$900,000)", !/S\$7,000|S\$4,000|S\$900,000|S\$3,500|S\$2,000\b/.test(x.v), x.v);
  }
  {
    // another person: Grace's question never uses Daniel's rows (checked in J6); a neighbouring section: the PA
    // summary's Disappearance / Ambulance terms never enter a fracture answer
    check("N2 neighbouring section: no Disappearance / Ambulance / Mobility terms in a fracture answer", !/Disappearance|ambulance|Mobility/i.test(j1.v + j2.v + j4.v), j1.v);
    check("N3 currency: the PA summary's bare $500 / $10,000 never appear as S$ in these answers", !/S\$500(?![\d,])|S\$10,000/.test(j1.v + j4.v + j5.v), j5.v);
  }

  // ===== grader v8 controls: the scripted (correct) journeys pass; known-bad answers fail on the intended check
  {
    const asConv = (ts: Turn[]) => ({ turns: ts.map(() => ({})), loaded: { turns: ts.map((t) => ({ answer: t.answer })), state: {} }, saved: { traces: ts.map((t) => t.trace) } } as any);
    const [, g2] = [0, j2], tw = (t: Turn[]) => asConv(t);
    check("grader v8: the scripted correction journey passes", gradeSAcorrection("SAa", tw([j1, g2])).verdict === "PASS", JSON.stringify(gradeSAcorrection("SAa", tw([j1, g2])).checks.filter((c) => !c.ok)));
    check("grader v8: the scripted ambiguity journey passes", gradeSAambiguity("SBa", tw([j3a, j3b])).verdict === "PASS", JSON.stringify(gradeSAambiguity("SBa", tw([j3a, j3b])).checks.filter((c) => !c.ok)));
    check("grader v8: the scripted comparison passes", gradeSAcompare("SC", tw([j4])).verdict === "PASS", JSON.stringify(gradeSAcompare("SC", tw([j4])).checks.filter((c) => !c.ok)));
    check("grader v8: the scripted death answer passes", gradeSAdeath("SD", tw([j5])).verdict === "PASS", JSON.stringify(gradeSAdeath("SD", tw([j5])).checks.filter((c) => !c.ok)));
    check("grader v8: the scripted person switch passes", gradeSAperson("SE", tw([j1, j6])).verdict === "PASS", JSON.stringify(gradeSAperson("SE", tw([j1, j6])).checks.filter((c) => !c.ok)));
    const bad = (summary: string, extra: any = {}) => ({ answer: { summary, details: [], nextSteps: [], questions: [], calculations: [], ...extra }, trace: {} } as Turn);
    const failsOn = (g: any, id: string) => g.verdict === "FAIL" && g.checks.some((c: any) => c.id === id && !c.ok);
    check("grader v8 control: the baseline's refusal text fails G1", failsOn(gradeSAcorrection("SAa", tw([j1, bad("I haven’t given a what-if amount for “Simple Fracture” in Group Insurance Product Summary, because I couldn’t confirm the figures it uses against your documents.")])), "G1"));
    check("grader v8 control: an unfinished quotation fails G2", failsOn(gradeSAcorrection("SAa", tw([j1, bad("If the Simple Fracture benefit applies to Daniel's case “Hip” (as you described: “Correction: it was his hip, not his tibia.")])), "G2"));
    check("grader v8 control: the withdrawn S$2,500 still shown fails K3", failsOn(gradeSAcorrection("SAa", tw([j1, bad("If the Simple Fracture benefit applies, the conditional illustration is S$2,500. If it applies to the Hip, S$3,750 (75% of S$5,000), not a payment.")])), "K3"));
    check("grader v8 control: a total of the two alternatives fails C3", failsOn(gradeSAcompare("SC", tw([bad("Simple Fracture S$2,500 under the Group Insurance Product Summary (S$5,000 limit); Other Fracture S$300,000 under the Group Personal Accident Benefit Summary (S$600,000), S$302,500 in total.")])), "C3"));
    // v8.2: sa-live-2's real answers (anonymised fixture): an honest NEGATED statement and the contact step's document name are not failures
    const SC_REAL = "If the Simple Fracture benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.\nIf the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.\nThe uploaded documents do not establish that both benefits can be claimed together, so these illustrations should not be added.\nNeither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.";
    check("grader v8.2: sa-live-2's real comparison (a negated 'claimed together') passes C3", gradeSAcompare("SC", tw([bad(SC_REAL)])).checks.find((c) => c.id === "C3")?.ok === true);
    check("grader v8.2 control: 'both can be claimed together' still fails C3", failsOn(gradeSAcompare("SC", tw([bad(SC_REAL.replace("do not establish that both benefits can be claimed together, so these illustrations should not be added", "show that both benefits can be claimed together"))])), "C3"));
    const SE_REAL = "If the Simple Fracture benefit applies to Grace's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.\nContact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.";
    check("grader v8.2: sa-live-2's real person-switch answer (the contact step names the certificate document) passes P1 and P2", gradeSAperson("SE", tw([j1, bad(SE_REAL)])).checks.filter((c) => c.id === "P1" || c.id === "P2").every((c) => c.ok));
    check("grader v8.2 control: Grace's certificate cover stated with Daniel's figure still fails P2", failsOn(gradeSAperson("SE", tw([j1, bad(SE_REAL + "\nHer certificate lists S$600,000.")])), "P2"));
    check("grader v8 control: Daniel's amount in Grace's answer fails P2", failsOn(gradeSAperson("SE", tw([j1, bad("If the benefit applies to Grace, S$3,750. Her certificate lists S$600,000.")])), "P2"));
  }

  // ===== a validated calculation keeps its COMPLETE conditions through validation, save, display and reopen
  {
    const calcTurns: [string, Turn][] = [["J2", j2], ["J3 turn 2", j3b], ["J3b turn 2", j3cb], ["J4", j4], ["J6", j6], ["SBa replay turn 2", sba2]];
    for (const [label, t] of calcTurns) {
      const ks = (t.answer.calculations ?? []) as any[];
      const whole = ks.length > 0 && ks.every((k) => /^If the .+ benefit applies to .+'s case “[^”]+”.*, the conditional illustration is S\$[\d,]+: [\d.]+% of .+ (?:limit|sum insured)[^;]*; it is an illustration from the document's terms, not a payment or an insurer's decision(?:; the page prints (?:a footnote|footnotes) for that row: “[^”]+” \(marked [^)]+\)(?: and “[^”]+” \(marked [^)]+\))*)?\.$/.test(k.sentence) && sentencesOf(k.sentence).length === 1);
      const shownWhole = ks.every((k) => lines(t.v).includes(k.sentence) && lines(t.shown).includes(k.sentence) && lines(t.reopened).includes(k.sentence));
      check(`complete conditions (${label}): every saved calculation is ONE complete conditional sentence (subject, case, percentage, base, document, not-a-payment) the splitter does not divide, and is displayed and reopened whole`, whole && shownWhole, JSON.stringify(ks.map((k) => k.sentence)));
    }
    const Q = "If the Simple Fracture benefit applies to Daniel's case “Hip” (as you described: “Correction: it was his hip, not his tibia. Keep this as a hypothetical closed fracture.”), the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary (page 13); it is an illustration from the document's terms, not a payment or an insurer's decision.";
    check("quote-aware splitter: a multi-sentence household quotation inside a conditional sentence does not split it", sentencesOf(Q).length === 1, JSON.stringify(sentencesOf(Q)));
    check("quote-aware splitter control: two real sentences are still two", sentencesOf("If it is the hip, the illustration is S$3,750. It is not a payment.").length === 2);
    check("quote-aware splitter control: an unclosed quotation does not swallow the rest of a later sentence", sentencesOf("He said “it was his hip. Then it is S$3,750. It is not a payment.").length >= 1);
  }

  // ===== grader v9 (separate revised assessment; the v8/v8.2 verdicts above are untouched) -- positive and negative controls
  {
    const asConv2 = (ts: Turn[], users: string[]) => ({ turns: users.map((user) => ({ user })), loaded: { turns: ts.map((t) => ({ answer: t.answer })), state: {} }, saved: { traces: ts.map((t) => t.trace) } } as any);
    const bad = (summary: string, extra: any = {}) => ({ answer: { summary, details: [], nextSteps: [], questions: [], calculations: [], ...extra }, trace: {} } as Turn);
    const tw = (t: Turn[]) => asConv2(t, t.map(() => ""));
    const u = (g: any, id: string) => g.checks.find((c: any) => c.id === id)?.ok;
    const SAB_REAL = "Updated: injury is now fractured his hip (you said fractured his tibia at first). The earlier estimate worked out from it no longer applies.\nIf the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.";
    const CORR = "Sorry, I had that wrong - the break is in his hip, not his shin. Same closed fracture, still just asking what it could be worth.";
    const calc3750 = (j2.answer.calculations ?? []);
    check("v9 rule R2 positive: a direct numerical correction needs no contact step", nextStepRequired(CORR, SAB_REAL) === false);
    check("v9 rule R2 negative: asking what to do requires a next step", nextStepRequired("Sorry, wrong bone. What should we do now?", SAB_REAL) === true && nextStepRequired("What documents would the insurer want from us?", "x") === true);
    check("v9 rule R2 negative: an unresolved issue only the insurer can settle requires a next step (not a numerical correction)", nextStepRequired("Daniel broke his leg. What would it pay?", "Neither document says whether one amends the other.") === true);
    check("v9: sa-live-3's SAb (corrected illustration, no contact step, no pending question) passes U1 by v9 where v8.2 failed it", u(gradeV9("SAb", asConv2([j1, bad(SAB_REAL, { calculations: calc3750 })], [J1_U, CORR])), "U1") === true && u(gradeSAcorrection("SAb", tw([j1, bad(SAB_REAL, { calculations: calc3750 })])), "U1") === false);
    check("v9 control: the same correction answer still fails U1 when a question is pending", u(gradeV9("SAb", asConv2([j1, bad(SAB_REAL, { questions: [{ text: "Which one?" }] })], [J1_U, CORR])), "U1") === false);
    check("v9 control: when the household asks what to do, the missing contact step fails U1", u(gradeV9("SAb", asConv2([j1, bad(SAB_REAL)], [J1_U, "Sorry, it was his hip. What should we do now?"])), "U1") === false);
    const SAR_REAL = "Updated: injury is now closed break at the hip (you said closed break in his lower leg, the tibia at first). The earlier estimate worked out from it no longer applies.\nIf the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.\nThe uploaded documents do not establish which of these two documents applies or whether one amends, replaces or adds to the other.";
    const SAR_U2_TEXT = "The doctor has corrected it: the break is actually at the hip, not the lower leg. Same closed fracture. What does that change?";
    check("v9.1 positive: sa-live-5's SAr turn 2 (relationship stated as unresolved, contact step given in turn 1, not repeated) passes U1 where v8.2 fails it", u(gradeV9("SAr", asConv2([j1, bad(SAR_REAL, { calculations: calc3750 })], [J1_U, SAR_U2_TEXT])), "U1") === true && u(gradeSAcorrection("SAr", tw([j1, bad(SAR_REAL, { calculations: calc3750 })])), "U1") === false);
    check("v9.1 negative control: the same answer fails U1 when the contact step was NEVER given earlier", u(gradeV9("SAr", asConv2([bad("x"), bad(SAR_REAL, { calculations: calc3750 })], [J1_U, SAR_U2_TEXT])), "U1") === false);
    check("v9.1 negative control: an earlier contact step does not excuse it when the household asks what to do", u(gradeV9("SAr", asConv2([j1, bad(SAR_REAL, { calculations: calc3750 })], [J1_U, "Sorry, it was his hip. What should we do now?"])), "U1") === false);
    const SC_PAYABLE = "If the Simple Fracture benefit applies, the conditional illustration is S$2,500.\nIf the Simple Fracture or Other Fracture due to Accident benefit applies, it is S$300,000.\nThe uploaded wording does not establish that these two benefits are payable together.\nNeither document says whether one amends, replaces or adds to the other, so these are alternatives from separate documents, never a total.";
    check("v9 positive: sa-live-3's SC wording (“does not establish ... payable together”) passes C3 while v8.2 fails it", u(gradeV9("SC", asConv2([bad(SC_PAYABLE)], [J4_U])), "C3") === true && u(gradeSAcompare("SC", tw([bad(SC_PAYABLE)])), "C3") === false);
    check("v9 negative control: an AFFIRMED “payable together” fails C3", u(gradeV9("SC", asConv2([bad(SC_PAYABLE.replace("does not establish that these two benefits are payable together", "confirms that these two benefits are payable together"))], [J4_U])), "C3") === false);
    check("v9 negative control: a total or a combined amount fails C3", claimsATotal("Together they come to S$302,500 in total.") && claimsATotal("The two are combined into one amount.") && !claimsATotal("They are alternatives, never a total, and are not established as payable together."));
  }

  console.log(`\nstructured answers (seven journeys, faithful actual-library fixture): ${passed} passed, ${failed} failed`);
  if (failed) console.log("failed: " + failures.join(" | "));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

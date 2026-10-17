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

import { D, G, CERT, J3B_U1, J3B_U2, j3bTurns, J1_U, J2_U, J3_U1, J3_U2, J4_U, J5_U, J6_U, j1Turn, j2Turn, j3Turns, j4Turn, j5Turn, j6Turn } from "./fixtures/reliable-chat/actual-lib-conversations";
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
    check("N3 currency: the PA summary's bare $500 / $10,000 never appear as S$ in these answers", !/S\$500\b|S\$10,000/.test(j1.v + j4.v + j5.v), j5.v);
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

  console.log(`\nstructured answers (seven journeys, faithful actual-library fixture): ${passed} passed, ${failed} failed`);
  if (failed) console.log("failed: " + failures.join(" | "));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

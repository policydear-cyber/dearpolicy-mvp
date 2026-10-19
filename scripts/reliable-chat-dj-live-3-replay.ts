/**
 * dj-live-3 (19 Oct 2026) answer-completeness checkpoint -- offline, scripted model, NO model call and no spend.
 *
 * The live attempt (`docs/rag-migration/live/RUN-dj-live-3-*`, tested code f2fe6a6, graded FAIL by the unchanged death-v1
 * grader on I5 "no visible next step" and I6 "unnecessary question") is replayed UNCHANGED: the model's own recorded calls
 * (resolve_person ... search_passages, then ONE ask_user carrying three statements and "What was Daniel's exact date of
 * death?") are fed back through the real chat route. Only the product code after the model changed.
 *
 *   A  the replay      -- dated Term Life S$1,000,000 and its limitations stay; no accident-only amount is presented as
 *                         applicable; the supported insurer-contact step is included; at most one relevant question, with its
 *                         reason; returned = saved = reopened (the browser comparison is e2e/tests/reliable-chat-dj-live-3.spec.ts)
 *   B  controls        -- a genuinely date-dependent question is still asked (steps shown ahead of it); a direct amount lookup
 *                         gets no contact step; a contact step the reply or the conversation already gave is not repeated;
 *                         another person's insurer is never named for this person
 *   C  the date rule   -- pure checks with positive and negative controls (a range after every printed date: not needed; a
 *                         printed date the range could precede, a clause counting a period, no date given: needed)
 *   node --import tsx scripts/reliable-chat-dj-live-3-replay.ts          (SHOW=1 prints every answer)
 */
import { NextRequest } from "next/server";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as DJR from "./fixtures/reliable-chat/death-journey-actual-values";
import { D, G } from "./fixtures/reliable-chat/death-journey-conversations";
import { recordedTurns, replayScript, runDir } from "./fixtures/rag2-live-replay";
import { ScriptedLoopModel, type ScriptTurn, type ScriptView } from "@/lib/rag2/loop/scripted-model";
import { asksWhatToDo, dateNearEvent, dateQuestionVerdict, eventDateRange, isContactStep } from "@/lib/rag2/loop/answer-completeness";
import { uniqueSteps } from "@/components/next-steps";
import type { FxDoc } from "./fixtures/rag2/household";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 30).join("\n     ") : ""}`); };
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const idWhere = (v: ScriptView, re: RegExp): string[] => { const out: string[] = []; const walk = (x: any) => { if (!x || typeof x !== "object") return; if (typeof x.evidence_id === "string" && Object.values(x).some((f) => typeof f === "string" && re.test(f))) out.push(x.evidence_id); for (const k of Object.keys(x)) walk(x[k]); }; for (const o of v.turn) if (o.name === "search_passages") walk(o.result); return [...new Set(out)]; };
const benefitIdOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) for (const b of d.benefits ?? []) if (re.test(b.benefit) && b.benefit_id) return b.benefit_id as string; return ""; };

// ---------------------------------------------------------------------------------------------------- C: the date rule (pure)
{
  const now = new Date("2026-10-19T06:06:00Z");
  const lw = eventDateRange("Daniel passed away last week after a long illness", now)!;
  check("C1 \"last week\" is a RANGE of days (never one exact day) and is marked inexact", lw && !lw.exact && lw.from < lw.to && lw.from === "2026-10-06" && lw.to === "2026-10-18", JSON.stringify(lw));
  check("C1 an absolute date is exact; \"yesterday\" is one day, inexact; \"3 weeks ago\" is a wider range", eventDateRange("on 6 October 2022", now)?.exact === true && eventDateRange("yesterday", now)?.from === "2026-10-18" && (() => { const w = eventDateRange("three weeks ago", now)!; return w.from < "2026-09-30" && w.to > "2026-09-26"; })());
  check("C1 no date in the words: null", eventDateRange("Daniel was ill for a long time", now) === null);
  const near = dateNearEvent(["Daniel passed away last week after a long illness - it was not an accident. What would the family receive?"], /\b(?:died|passed away|death)\b/i, now);
  check("C1 the date is read in the clause of the event it belongs to", near?.words === "last week", JSON.stringify(near));
  check("C1 …not a date belonging to another event in the message", dateNearEvent(["He had surgery yesterday. Daniel passed away."], /\b(?:died|passed away|death)\b/i, now) === null);
  const wording = "Group Term Life: Death or Terminal Illness 100% of Sum Assured Death must occur while the Insured Person is covered under the Scheme.";
  const none = dateQuestionVerdict({ range: lw, clauses: [wording], printed: ["2022-10-06", "2024-04-01"] });
  check("C2 (negative control) a range after EVERY printed date and a clause with no period: the exact day is not needed", !none.needed && /would not change what the wording says/.test(none.reason), JSON.stringify(none));
  check("C2 …the same when the documents print no date at all", !dateQuestionVerdict({ range: lw, clauses: [wording], printed: [] }).needed);
  const early = dateQuestionVerdict({ range: lw, clauses: [wording], printed: ["2026-10-10"] });
  check("C2 (positive control) a printed date inside the range: the exact day is needed", early.needed && /not before the start/.test(early.reason), JSON.stringify(early));
  check("C2 (positive control) a printed date after the range: needed", dateQuestionVerdict({ range: lw, clauses: [wording], printed: ["2026-11-01"] }).needed);
  check("C2 (positive control) a clause counting a period from the event (\"within 365 days of the Accident\"): needed", dateQuestionVerdict({ range: lw, clauses: ["If an Insured Person sustains bodily injury as a result of an Accident, which results in his death within 365 days of the Accident, we will pay the Sum Insured."], printed: ["2022-10-06"] }).needed);
  check("C2 (positive control) a clause limiting cover in time (\"cover ends ...\"): needed", dateQuestionVerdict({ range: lw, clauses: ["Cover ends on the last day of the month in which the Insured Person leaves the Scheme."], printed: [] }).needed);
  check("C2 (positive control) no date given at all: needed", dateQuestionVerdict({ range: null, clauses: [wording], printed: ["2022-10-06"] }).needed);
  check("C2 an exact date the household already gave is not asked for again", !dateQuestionVerdict({ range: eventDateRange("on 6 October 2026", now), clauses: [wording], printed: [] }).needed);
  check("C3 what-to-do detection: asked / not asked", asksWhatToDo("What would the family receive from his insurance, and what should we do?") && asksWhatToDo("What do we do now?") && asksWhatToDo("What are the next steps?") && asksWhatToDo("How do we claim?") && !asksWhatToDo("What does Daniel's Term Life pay?") && !asksWhatToDo("Is the hospital cash benefit separate from the death benefit?"));
  check("C3 a contact step is recognised in both of its forms", isContactStep("contact:abc") && isContactStep("Contact Aldermoor Life Ltd about the policy.") && !isContactStep("Keep the death certificate."));
}

async function main() {
  setEnv(DJR as any);
  const h = await startHarness(DJR as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  const reopen = async (conv: string) => { const r = await history(new NextRequest(`http://localhost/api/chat/history/${conv}`), { params: Promise.resolve({ id: conv }) }); const j = await r.json(); return (j.messages ?? []).filter((m: any) => m.role === "assistant").map((m: any) => m.answer_json); };
  const run = async (label: string, user: string, turns: ScriptTurn[], conv: { id?: string; rev?: number } = {}) => {
    installLoopModel(new ScriptedLoopModel(turns));
    try {
      const a = await h.send(user, conv);
      const s = await h.savedAnswer(a.conversationId!);
      const re = (await reopen(a.conversationId!)).at(-1);
      const trace = s.state.ragLoop.turns.at(-1);
      const v = visible(s.answer);
      if (process.env.SHOW) console.log(`--- ${label}\n${v}\n  adjusted: ${JSON.stringify(trace.adjusted ?? [])}\n  outcome: ${trace.outcome}\n  dropped: ${JSON.stringify(trace.dropped ?? null)}\n  calls: ${JSON.stringify((trace.toolCalls ?? []).map((c: any) => [c.name, JSON.stringify(c).slice(0, 2500)]))}`);
      return { a, v, shown: visible(a), reopened: visible(re), answer: s.answer, state: s.state, trace, conv: { id: a.conversationId!, rev: a.conversationRevision } };
    } finally { installLoopModel(null); }
  };
  const cert = DJR.DOCS.find((d) => d.key === "CERT")!;

  // ---------------------------------------------------------------------------------------------- A: the recorded replay
  const dir = runDir("RUN-dj-live-3-2");
  const recorded = recordedTurns(dir, "DI");
  const rec = JSON.parse((await import("node:fs")).readFileSync(dir + "/run.json", "utf8")).conversations.find((c: any) => c.scenario === "DI").loaded.turns[0];
  const asked = recorded[0].steps.flat().map((c) => c.name);
  check("A0 the recorded model calls are the live ones, unchanged: seven calls in three steps, ending in ONE ask_user", asked.join() === "resolve_person,note_facts,person_benefits,policies_for,search_passages,search_passages,ask_user" && recorded[0].steps.length === 3 && recorded[0].steps.at(-1)!.length === 1, asked.join());
  const r = await run("dj-live-3 replay", recorded[0].user, replayScript(recorded));
  const ev = r.state.ragLoop.evidence ?? {};
  check("A0 the recorded evidence ids are the same passages (e18 the Term Life wording on page 12, e1 Daniel's certificate row)", /Death must occur while the Insured Person is covered under the Scheme/.test(ev.e18?.passage?.text ?? "") && /Lee Wei Ming, Daniel/.test(ev.e1?.passage?.text ?? "") && /1,000,000/.test(ev.e1?.passage?.text ?? ""), JSON.stringify([ev.e18?.passage?.text?.slice(0, 120), ev.e1?.passage?.text?.slice(0, 120)]));
  const v = r.v;
  check("A1 the dated Term Life S$1,000,000 stays, with its date and its limitation (a dated amount does not confirm cover)", /Group Term Life of S\$1,000,000 as of 6 October 2022/.test(v) && /does not confirm cover on his date of death/.test(v), v);
  check("A1 the printed terms stay (100% of the Sum Assured; death must occur while covered)", /100% of the Sum Assured/.test(v) && /death must occur while the insured person is covered/i.test(v), v);
  check("A1 the uncertainty stays: the documents do not establish cover on the date of death", /do not establish whether Daniel was covered on the date he died/.test(v), v);
  check("A2 no accident-only amount is presented as applicable (no S$600,000, no Accidental Death or allowance figure)", !/600,000|2,000/.test(v) && !/Accidental Death[^.\n]*100%/.test(v), v);
  check("A2 an accident-only benefit, if named, is said to depend on an accident", !/Personal Accident|Accidental Death|Compassionate/i.test(v) || /(?:only|requires?|depends?|if)[^.\n]*\baccident\b|\baccident\b[^.\n]*(?:only|condition|does not (?:fit|apply))/i.test(v), v);
  check("A3 the supported insurer-contact step is included, for the insurer of Daniel's own certificate", uniqueSteps(r.answer.nextSteps).some((s) => /^Contact Aldermoor Life Ltd\b.*to ask what it needs for a claim\.$/.test(s)), JSON.stringify(r.answer.nextSteps));
  check("A3 …one contact step, no deadline, form or contact detail invented", uniqueSteps(r.answer.nextSteps).length === 1 && !/\b\d+\s*(?:days?|hours?)\b|@|\bwww\.|https?:|\+?\d{4}\s?\d{4}/.test(uniqueSteps(r.answer.nextSteps).join(" ")), JSON.stringify(r.answer.nextSteps));
  check("A3 printed claim requirements are not invented: nothing says what the insurer \"requires\" beyond what the steps ask", !/\bmust (?:submit|provide)|required documents?\b/i.test(v), v);
  const qs = (r.answer.questions ?? []) as any[];
  check("A4 at most one question; any question carries its reason", qs.length <= 1 && qs.every((q) => typeof q.why === "string" && q.why.length > 10), JSON.stringify(qs));
  check("A4 no question asks for an exact date the wording does not turn on", !qs.some((q) => /exact date of death/i.test(q.text ?? "")) && /“last week”/.test(v) && /not turned that into an exact day/.test(v), v);
  check("A4 the household's \"last week\" is kept as said, and the reason no exact day is asked for is given", /You told me the death was “last week”; I have not turned that into an exact day\. Every date printed in these documents is earlier than that, and no cited clause counts a period from the death, so a more exact date would not change what this wording says\./.test(v), v);
  check("A5 returned = saved = reopened, next steps included", r.shown === r.v && r.v === r.reopened && r.v.length > 0 && /Contact Aldermoor Life Ltd/.test(r.reopened), `shown:\n${r.shown}\nsaved:\n${r.v}\nreopened:\n${r.reopened}`);
  check("A5 the saved record says what was done (trace) and the turn ended with a final answer", r.trace.outcome === "final_answer" && (r.trace.adjusted ?? []).some((x: string) => /ask_user \(death_date\): not asked -- “last week”/.test(x)) && (r.trace.adjusted ?? []).some((x: string) => /added the supported next step/.test(x)), JSON.stringify([r.trace.outcome, r.trace.adjusted]));
  check("A5 the original live record is untouched: its saved answer still ends in the question (the baseline this replay is compared with)", /What was Daniel’s exact date of death\?/.test(rec.visible) && rec.questions.length === 1, rec.visible);
  if (process.env.SHOW) console.log("--- ORIGINAL LIVE ANSWER\n" + rec.visible);

  // ---------------------------------------------------------------------------------------------- B: controls
  const termId = (vv: ScriptView) => benefitIdOf(vv, /Term Life/i);
  const lookup = (user: string, subject = D, extra: Record<string, unknown> = {}): ScriptTurn => ({ user, steps: [
    () => [call("resolve_person", { mention: subject === D ? "Daniel" : "Grace" }), call("person_benefits", { subject_id: subject, topic: "Term Life death benefit" })],
    (vv: ScriptView) => [call("final_answer", { subject_id: subject, sentences: [{ kind: "benefit_terms", benefit_id: termId(vv), subject_id: subject }], ...extra })],
  ] });

  // B1 genuinely date-dependent: the death followed an accident and the wording counts 365 days from it; the household gave no date.
  {
    const U = "Daniel was in a road accident and passed away. What would the family receive from his insurance, and what should we do?";
    const t: ScriptTurn = { user: U, steps: [
      () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "road accident", words: "Daniel was in a road accident and passed away" }, { key: "death", value: "passed away", words: "passed away" }] }), call("person_benefits", { subject_id: D, topic: "accidental death" }), call("search_passages", { subject_id: D, query: "death within 365 days of the Accident" })],
      (vv: ScriptView) => {
        const ids = idWhere(vv, /365 days/);
        return [call("ask_user", { kind: "fact", fact_key: "accident_date", question: "On what date did the accident happen?", subject_id: D, because_evidence_ids: ids.slice(0, 1), statements: [{ kind: "benefit_terms", benefit_id: benefitIdOf(vv, /Accidental Death/i), subject_id: D }] })];
      },
    ] };
    const b1 = await run("B1 date-dependent", U, [t]);
    const q1 = (b1.answer.questions ?? []) as any[];
    check("B1 (positive control) a genuinely date-dependent question is still asked: the wording counts 365 days from the accident and no date was given", q1.length === 1 && /date/i.test(q1[0].text) && /365 days/.test(q1[0].why ?? "") && b1.trace.outcome === "ask_user", JSON.stringify([q1, b1.trace.outcome, b1.trace.adjusted, b1.v.slice(0, 400)]));
    check("B1 …with exactly one question and its reason, and the supported step shown ahead of it, saved and reopened", uniqueSteps(b1.answer.nextSteps).some((s) => /^Contact Aldermoor Life Ltd\b/.test(s)) && b1.shown === b1.v && b1.v === b1.reopened, JSON.stringify([b1.answer.nextSteps, b1.shown === b1.v, b1.v === b1.reopened]));
  }

  // B1b the household's range does not make a period clause decidable: the same death-date question over the 365-day clause stays.
  {
    const U = "Daniel passed away last week after an accident. What would the family receive from his insurance, and what should we do?";
    const t: ScriptTurn = { user: U, steps: [
      () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "accident", words: "after an accident" }, { key: "death", value: "passed away last week", words: "Daniel passed away last week" }] }), call("person_benefits", { subject_id: D, topic: "accidental death" }), call("search_passages", { subject_id: D, query: "death within 365 days of the Accident" })],
      (vv: ScriptView) => {
        const ids = idWhere(vv, /365 days/);
        return [call("ask_user", { kind: "fact", fact_key: "death_date", question: "Accidental Death needs the death to follow the accident within 365 days: what was Daniel’s exact date of death?", subject_id: D, because_evidence_ids: ids.slice(0, 1), statements: [{ kind: "benefit_terms", benefit_id: benefitIdOf(vv, /Accidental Death/i), subject_id: D }] })];
      },
    ] };
    const b = await run("B1b period clause", U, [t]);
    check("B1b (positive control) the same \"last week\" does NOT remove a question whose cited clause counts a period (365 days): it is still asked, with its reason", b.trace.outcome === "ask_user" && ((b.answer.questions ?? []) as any[]).length === 1 && !(b.trace.adjusted ?? []).some((x: string) => /not asked --/.test(x)), JSON.stringify([b.trace.outcome, b.trace.adjusted, b.answer.questions]));
  }

  // B2 a direct amount lookup needs no contact step.
  {
    const U = "What does Daniel's Group Term Life pay?";
    const b = await run("B2 lookup", U, [lookup(U)]);
    check("B2 a direct amount lookup: the printed amount is given and NO contact step is added", /1,000,000/.test(b.v) && uniqueSteps(b.answer.nextSteps).length === 0 && !/Contact /.test(b.v), b.v);
  }

  // B3 a contact step the reply already carries is not repeated; nor one an earlier turn gave.
  {
    const U = "Daniel passed away of an illness. What should we do?";
    const own = (vv: ScriptView) => { for (const o of [...vv.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) if (d.policy_id && /Certificate/i.test(d.product ?? d.name ?? "")) return d.policy_id as string; return cert.id; };
    const t: ScriptTurn = { user: U, steps: [
      () => [call("resolve_person", { mention: "Daniel" }), call("person_benefits", { subject_id: D, topic: "Term Life death benefit" })],
      (vv: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ kind: "benefit_terms", benefit_id: termId(vv), subject_id: D }], next_steps: [`contact:${own(vv)}`] })],
    ] };
    const b = await run("B3 already given", U, [t]);
    const steps = uniqueSteps(b.answer.nextSteps);
    check("B3 a contact step the reply already gave is shown ONCE (not added again)", steps.filter((s) => /^Contact Aldermoor Life Ltd\b/.test(s)).length === 1 && (b.trace.adjusted ?? []).every((x: string) => !/added the supported next step/.test(x)), JSON.stringify([steps, b.trace.adjusted]));
    const U2 = "What should we do next?";
    const t2: ScriptTurn = { user: U2, steps: [
      () => [call("final_answer", { subject_id: D, sentences: [{ kind: "uncertainty", text: "The documents do not state anything further about what to do.", subject_id: D }] })],
    ] };
    const b2 = await run("B3 later turn", U2, [t2], b.conv);
    check("B3 a later \"what should we do next?\" does not repeat the contact step the conversation already gave", !(b2.trace.adjusted ?? []).some((x: string) => /added the supported next step/.test(x)), JSON.stringify([b2.trace.adjusted, b2.answer.nextSteps]));
  }

  await h.db.close();

  // B4 another person's insurer: a second household where Grace's own certificate is with another insurer.
  {
    const H = "Harbourline Assurance Pte Ltd";
    const daniel = (x: FxDoc) => ({ ...x, members: [{ id: D }] });
    const hcert: FxDoc = { key: "H_CERT", id: "00000000-0000-4000-8000-0000000000c1", owner: G, members: [{ id: G }], insurer: H, policyType: "Group insurance", groupPolicyNumber: "HGL-1", product: "Harbourline Group Life Certificate", policyNumber: "HGL-1", role: "schedule", personal: true, hash: "sha256:h-cert", effective: "2024-07-01", documentDate: "2024-07-01", filename: "h_certificate.pdf", pages: { 1: ["CERTIFICATE OF GROUP LIFE INSURANCE", `This is to certify that the person named herein is insured with "${H}" for cover as indicated:`, "GROUP TERM LIFE", "Tan Hui Min, Grace\tS$150,000\t01/07/2024"].join("\n") } } as FxDoc;
    const docs: FxDoc[] = [...DJR.DOCS.map((x) => (["CERT", "PRODUCT_SUMMARY", "PA_SUMMARY", "BOOKLET", "OLD_PRODUCT_SUMMARY"].includes(x.key) ? daniel(x) : x)), hcert];
    const house = { ...DJR, DOCS: docs } as any;
    // (a new harness needs a new process-wide pool patch; the second one replaces the first)
    const h2 = await startHarness(house);
    const run2 = async (label: string, user: string, turns: ScriptTurn[]) => {
      installLoopModel(new ScriptedLoopModel(turns));
      try { const a = await h2.send(user, {}); const s = await h2.savedAnswer(a.conversationId!); const v2 = visible(s.answer); if (process.env.SHOW) console.log(`--- ${label}\n${v2}`); return { v: v2, answer: s.answer, trace: s.state.ragLoop.turns.at(-1) }; } finally { installLoopModel(null); }
    };
    const ask = (user: string, subject: string, mention: string): ScriptTurn => ({ user, steps: [
      () => [call("resolve_person", { mention }), call("person_benefits", { subject_id: subject, topic: "Term Life death benefit" })],
      (vv: ScriptView) => [call("final_answer", { subject_id: subject, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(vv, /Term Life/i), subject_id: subject }] })],
    ] });
    const bd = await run2("B4 Daniel", "Daniel passed away of an illness. What should we do?", [ask("Daniel passed away of an illness. What should we do?", D, "Daniel")]);
    const sd = uniqueSteps(bd.answer.nextSteps);
    check("B4 Daniel's step names Daniel's own insurer and never Grace's", sd.some((s) => /^Contact Aldermoor Life Ltd\b/.test(s)) && !/Harbourline/.test(bd.v), bd.v);
    const bg = await run2("B4 Grace", "My wife Grace passed away of an illness. What should we do?", [ask("My wife Grace passed away of an illness. What should we do?", G, "Grace")]);
    const sg = uniqueSteps(bg.answer.nextSteps);
    check("B4 Grace's step names Grace's own insurer and never Daniel's", sg.some((s) => /^Contact Harbourline Assurance Pte Ltd\b/.test(s)) && !/Aldermoor/.test(bg.v), bg.v);
    await h2.db.close();
  }

  console.log(`\n${failed ? failed + " FAILED" : "all passed"} (${passed} passed)`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * PRESENTATION regressions for the conversational RAG path (npm run rag2:presentation-test), agent P.
 * What the household SEES after the loop, the composer and the save-time gate: general behaviour, not tied to one
 * fixture sentence -- each task has positive and negative checks, paraphrases, and both synthetic households (Tan, Nair).
 *
 *   P1  no duplicated missing-information question (deduped by the requirement's fact concepts)
 *   P2  names as the household uses them (never "Full Name (Short)'s", never a full name twice in a sentence)
 *   P3  after a failed verification: no internal "left out" commentary; meaning-dependent sentences withdrawn; an
 *       accurate explanation only when nothing else can be said
 *   P4  a person not among the household's members: said plainly, nothing about any other household
 *   P5  facts supplied in the message are recorded and never asked again
 *   P6  a printed benefit whose conditions are not established is said as conditional
 *
 * INTEGRATION (PGlite, real chat route, DEARPOLICY_RAG_LOOP=1, TEST-ONLY scripted model) plus pure-function checks.
 * Filter with RAG2_PRES_ONLY=<regex>. Exit 1 if any check failed.
 */
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setAdvEnv, startAdvHarness, type AdvHarness } from "./fixtures/rag2-adv/harness";
import { ACCOUNT_N, ACCOUNT_T, doc, N, T } from "./fixtures/rag2-adv/household";
import { AdvModel, call, type Call, type Turn, type View } from "./fixtures/rag2-adv/model";
import * as SC from "./fixtures/rag2-adv/scenarios";

setAdvEnv();
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
const ONLY = process.env.RAG2_PRES_ONLY ? new RegExp(process.env.RAG2_PRES_ONLY) : null;
async function check(name: string, fn: () => Promise<void> | void) {
  if (ONLY && !ONLY.test(name)) return;
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const visible = (a: ChatAnswer | undefined) => !a ? "" : [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q) => q.text), ...(a.nextSteps ?? [])].join(" ");
/** Internal commentary that must never reach the household. */
const COMMENTARY = /\bleft (?:it |them |this |that )?out\b|\bI left\b|couldn[’']t be tied|Part of what I was going to say|could not be verified|verification|composer|dropped/i;
const MONEY = /S\$\s?\d/;
type TurnOut = { a: ChatAnswer; v: string; loop: any; trace: any };
let H: AdvHarness;
let installLoopModel: (m: any) => void;
async function converse(account: string, turns: Turn[], messages: string[]): Promise<TurnOut[]> {
  const model = new AdvModel(turns); installLoopModel(model);
  const out: TurnOut[] = [];
  let conv: { id?: string; rev?: number } = {};
  try {
    for (const m of messages) {
      const answer = await H.send(account, m, conv);
      conv = { id: answer.conversationId, rev: answer.conversationRevision };
      const saved = await H.saved(account, conv.id!);
      out.push({ a: saved.answer, v: visible(saved.answer), loop: saved.state?.ragLoop, trace: saved.state?.ragLoop?.turns?.at(-1) });
    }
  } finally { installLoopModel(null); }
  return out;
}
const run = (s: SC.Scenario) => converse(s.account === "T" ? ACCOUNT_T : ACCOUNT_N, s.turns, s.messages);
const info = (t: TurnOut) => `\n     visible: ${t.v.slice(0, 500)}\n     dropped: ${JSON.stringify(t.trace?.dropped ?? []).slice(0, 400)}\n     refused: ${JSON.stringify((t.trace?.toolCalls ?? []).filter((x: any) => !x.ok).map((x: any) => x.name + ": " + x.error)).slice(0, 400)}\n     gate: ${JSON.stringify(t.trace?.gate ?? [])}`;
const KS = doc("KIDSAFE").id, FF = doc("FAMILYFIRST").id;
const stv = (policy: string, benefit: string, subject: string): Call => call("select_table_value", { policy_id: policy, benefit, subject_id: subject });
const val = (v: View, re: RegExp) => v.data("select_table_value", (o) => re.test(String(o.args.benefit)));
const hitOf = (v: View, re: RegExp): string => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => re.test(x.evidence?.excerpt ?? "")); if (h) return h.evidence.evidence_id; } throw new Error("no search hit " + re); };
const hospitalCalc = (subject: string, policy: string, benefit: string, rate: string, adm?: [string, string], dis?: [string, string]): Call => call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: subject, policy_id: policy, benefit, rate_value_id: rate, ...(adm ? { admission: { at: adm[0], words: adm[1] } } : {}), ...(dis ? { discharge: { at: dis[0], words: dis[1] } } : {}) });
const calcOf = (v: View) => { const o = v.find("calculate"); return o?.ok ? o.result.data : null; };
const countOf = (text: string, re: RegExp) => (text.match(new RegExp(re.source, "gi")) ?? []).length;

/** One-turn script: the steps up to final_answer, then the given sentences (built from what the tools returned). */
function oneTurn(prep: ((v: View) => Call[])[], sentences: (v: View) => Record<string, unknown>[], subject: string): Turn[] {
  return [{ steps: [...prep, (v) => [call("final_answer", { subject_id: subject, sentences: sentences(v) })]] }];
}

async function main() {
  ({ installLoopModel } = await import("@/lib/rag2/loop/model"));
  const C = await import("@/lib/rag2/loop/compose");
  const Q = await import("@/lib/rag2/loop/questions");
  const P = await import("@/lib/rag2/loop/prompt");
  const { unknownPersonText } = await import("@/lib/rag2/loop/hook");
  H = await startAdvHarness();

  // ================================================================ P1 duplicated missing-information question
  { const [t] = await run(SC.S8);
    await check("P1a (Nair) the model's own 'I need the admission ... discharge' and the calculation's requirement are said once", () => {
      assert.equal(countOf(t.v, /\bneed\b/), 1, "asked once" + info(t));
      assert.match(t.v, /I still need the admission and discharge dates and times/);
      assert.match(t.v, /S\$120 per day/); assert.doesNotMatch(t.v, COMMENTARY);
      assert.ok(t.trace.dropped.some((d: any) => /repeats the missing-information requirement/.test(d.reason)));
    }); }
  const ethanNoDates = (extra: Record<string, unknown>[]) => oneTurn([
    () => [call("resolve_person", { mention: "Ethan" })],
    () => [stv(KS, "Hospital income", T.ethan.id), call("search_passages", { query: "hospital income complete period of 24 hours", subject_id: T.ethan.id })],
    (v) => [hospitalCalc(T.ethan.id, KS, "Hospital income", val(v, /Hospital income/).valueId)],
  ], (v) => [{ text: `Ethan's KidSafe hospital income is S$${val(v, /Hospital income/).value} for each complete 24 hours.`, value_ids: [val(v, /Hospital income/).valueId] }, ...extra.map((x) => (typeof x.text === "function" ? { ...x, text: (x.text as any)(v) } : x)), { text: "Indicative estimate: KidSafe hospital income comes to S$270.", result_id: calcOf(v)?.calc_id }], T.ethan.id);
  { const [t] = await converse(ACCOUNT_T, ethanNoDates([{ text: "Could you tell me when Ethan was admitted to hospital and when he was discharged?" }]), ["Ethan was in hospital after a fall. How much hospital income is there?"]);
    await check("P1b (Tan, paraphrase as a question) 'Could you tell me when he was admitted ... discharged?' is not repeated beside the requirement", () => {
      assert.doesNotMatch(t.v, /Could you tell me when Ethan was admitted/, info(t));
      assert.equal(countOf(t.v, /admi(?:ssion|tted)/), 1, "admission asked once" + info(t));
      assert.doesNotMatch(t.v, COMMENTARY); assert.doesNotMatch(t.v, /S\$270/);
    }); }
  { const [t] = await converse(ACCOUNT_T, ethanNoDates([{ text: "I'd also need the admission and discharge times to work this out." }]), ["Ethan was in hospital after a fall. How much hospital income is there?"]);
    await check("P1c (Tan, paraphrase 'I'd also need ... times') deduped by fact concepts, not by string", () => {
      assert.doesNotMatch(t.v, /I'd also need/, info(t)); assert.match(t.v, /I still need/);
    }); }
  { const [t] = await converse(ACCOUNT_T, ethanNoDates([{ text: "Please also tell me the name of the hospital." }]), ["Ethan was in hospital after a fall. How much hospital income is there?"]);
    await check("P1d negative: a request for something the requirement does not ask (the hospital's name) stays", () => {
      assert.match(t.v, /Please also tell me the name of the hospital\./, info(t)); assert.match(t.v, /I still need/);
    }); }
  await check("P1e unit: askedConcepts / requirementConcepts", () => {
    assert.deepEqual(C.askedConcepts("To work out the days payable I need Rohan's admission date and time and his discharge date."), ["admission", "discharge"]);
    assert.deepEqual(C.askedConcepts("When was she discharged?"), ["discharge"]);
    assert.deepEqual(C.askedConcepts("Could you send me the hospital bill?"), ["bill"]);
    assert.equal(C.askedConcepts("Rohan was admitted on 3 October."), null, "a statement is not a request");
    assert.equal(C.askedConcepts("I need to tell you the daily rate is S$120."), null, "a figure-bearing sentence is never treated as a request");
    assert.deepEqual(C.requirementConcepts({ calculator: "hospital_cash", requirements: ["Rohan Nair’s admission and discharge dates and times (with the hospital’s time zone)"], conditions: [] } as any).sort(), ["admission", "discharge"]);
    assert.deepEqual(C.requirementConcepts({ calculator: "bill_reimbursement", requirements: ["the bill amount"], conditions: [] } as any), ["bill"]);
  });

  // ================================================================ P2 names
  { const r = await run(SC.S6a); const t = r[1];
    await check("P2a (Tan) person correction uses the names the household uses: never 'Full Name (Short)' or its possessive", () => {
      assert.match(t.v, /Updated: this is about Chloe, not Ethan\./, info(t));
      assert.doesNotMatch(t.v, /\((?:Ethan|Chloe)\)|Ethan Tan Jun Kai|Chloe Tan Xin Yi/);
      assert.match(t.v, /no longer applies, because it was worked out for Ethan's policy, not Chloe's\./); assert.doesNotMatch(t.v, /S\$900/);
    }); }
  { const [t] = await run(SC.S8);
    await check("P2b (Nair, no preferred name) a full name is said at most once in any sentence", () => {
      for (const s of [t.a.summary, ...t.a.details]) assert.ok(countOf(s, /Rohan Nair/) <= 1, "repeated full name: " + s);
    }); }
  await check("P2c unit: tidyNames (paraphrases, possessives, negatives)", () => {
    const people = C.peopleFromLabels(["Ethan Tan Jun Kai (Ethan)", "Chloe Tan Xin Yi (Chloe)", "Rohan Nair", "Lim Jun Hao (Jun Hao)"]);
    assert.equal(C.tidyNames("It was worked out for Ethan Tan Jun Kai (Ethan)'s policy.", people), "It was worked out for Ethan's policy.");
    assert.equal(C.tidyNames("About Chloe Tan Xin Yi (Chloe), not Ethan Tan Jun Kai (Ethan).", people), "About Chloe, not Ethan.");
    assert.equal(C.tidyNames("To work out Rohan Nair’s cash, I still need Rohan Nair’s admission dates.", people), "To work out Rohan Nair’s cash, I still need the admission dates.");
    assert.equal(C.tidyNames("Ethan Tan Jun Kai is insured; Ethan Tan Jun Kai is a child.", people), "Ethan Tan Jun Kai is insured; Ethan is a child.");
    // negatives: a short name repeated stays; one full name per sentence stays; other words untouched
    assert.equal(C.tidyNames("To work out Jun Hao’s cash, I still need Jun Hao’s dates.", people), "To work out Jun Hao’s cash, I still need Jun Hao’s dates.");
    assert.equal(C.tidyNames("Rohan Nair is insured. Rohan Nair is a child.", people), "Rohan Nair is insured. Rohan Nair is a child.");
    assert.equal(C.tidyNames("Rohan's rate is S$120 per day.", people), "Rohan's rate is S$120 per day.");
  });

  // ================================================================ P3 after a failed verification
  { const r = await run(SC.S3); const t = r[2];
    await check("P3a (Tan) a nights-based estimate rejected beside the right one: no commentary or inaccurate note, S$180 kept", () => {
      assert.match(t.v, /Indicative estimate[^.]*S\$180/, info(t)); assert.doesNotMatch(t.v, /S\$270/); assert.doesNotMatch(t.v, COMMENTARY);
    }); }
  { const r = await run(SC.S2); const t = r[1];
    await check("P3b (Tan) a claim decision rejected: no 'I left out', a user-facing caveat that only the insurer decides", () => {
      assert.doesNotMatch(t.v, COMMENTARY, info(t)); assert.doesNotMatch(t.v, /medically confirmed|approved/i);
      assert.match(t.v, /Only the insurer makes a decision on the claim/); assert.match(t.v, /S\$600 per fracture/);
    }); }
  const ethanRate = (sentences: (v: View, s: any) => Record<string, unknown>[]) => oneTurn([() => [stv(KS, "Hospital income", T.ethan.id)]], (v) => sentences(v, val(v, /Hospital income/)), T.ethan.id);
  { const [t] = await converse(ACCOUNT_T, ethanRate((v, s) => [{ text: `Ethan's KidSafe hospital income is S$${s.value} for each complete 24 hours.`, value_ids: [s.valueId] }, { text: "However, this does not apply to stays costing over S$9,999.", evidence_ids: ["e999"] }]), ["What is Ethan's hospital income?"]);
    await check("P3c (Tan) a rejected qualifier ('However, this does not apply ...') withdraws the sentence it qualified; accurate explanation only", () => {
      assert.doesNotMatch(t.v, /S\$90|9,999/, info(t)); assert.equal(t.v.trim(), C.DROPPED_NOTE); assert.deepEqual(t.a.figureBindings ?? [], []);
    }); }
  { const [t] = await converse(ACCOUNT_T, ethanRate((v, s) => [{ text: `Ethan's KidSafe hospital income is S$${s.value} for each complete 24 hours.`, value_ids: [s.valueId] }, { text: "Except that it is capped at S$5 per stay.", evidence_ids: ["e999"] }]), ["How much hospital income does Ethan get?"]);
    await check("P3c' (paraphrase 'Except that ...') same", () => { assert.doesNotMatch(t.v, /S\$90|S\$5\b/, info(t)); assert.doesNotMatch(t.v, COMMENTARY); }); }
  const rohanRate = (sentences: (v: View, s: any) => Record<string, unknown>[]) => oneTurn([() => [call("resolve_person", { mention: "Rohan" })], () => [stv(FF, "Daily hospital cash", N.rohan.id)]], (v) => sentences(v, val(v, /hospital cash/i)), N.rohan.id);
  { const [t] = await converse(ACCOUNT_N, rohanRate((v, s) => [{ text: `Rohan's FamilyFirst daily hospital cash is S$${s.value} per day.`, value_ids: [s.valueId] }, { text: "Rohan's FamilyFirst also pays S$999 per day for ICU.", evidence_ids: ["e999"] }, { text: "This is on top of the daily rate above." }]), ["What does Rohan's hospital cash pay?"]);
    await check("P3d (Nair) a sentence referring back to a rejected one ('This is on top of ...') is withdrawn; the independent figure stays, no note", () => {
      assert.match(t.v, /S\$120 per day/, info(t)); assert.doesNotMatch(t.v, /S\$999|on top of/); assert.doesNotMatch(t.v, COMMENTARY);
      assert.equal(t.a.details.length, 0, "nothing but the supported sentence");
    }); }
  { const [t] = await converse(ACCOUNT_N, rohanRate((v, s) => [{ text: `Rohan's FamilyFirst daily hospital cash is S$${s.value} per day.`, value_ids: [s.valueId] }, { text: "Physiotherapy is paid up to S$300.", evidence_ids: ["e999"] }]), ["How much hospital cash per day for Rohan?"]);
    await check("P3e negative (Nair): an unrelated rejected sentence does not withdraw a supported one, and adds no note", () => {
      assert.equal(t.v.trim(), "Rohan's FamilyFirst daily hospital cash is S$120 per day.", info(t));
    }); }
  { const [t] = await converse(ACCOUNT_N, rohanRate((v, s) => [{ text: "The estimate after it is before any deductions." }, { text: `Rohan's FamilyFirst daily hospital cash is S$${s.value} per day.`, value_ids: [s.valueId] }, { text: "Indicative estimate: Rohan gets S$360 for his stay.", evidence_ids: ["e999"] }]), ["Rohan was in hospital 3 nights, what do we get?"]);
    await check("P3f (Nair) an estimate's label is not left behind when the estimate is rejected", () => {
      assert.doesNotMatch(t.v, /estimate|S\$360/i, info(t)); assert.match(t.v, /S\$120 per day/);
    }); }
  { const [t] = await converse(ACCOUNT_T, ethanRate((v, s) => [{ text: "Here is what Ethan's plan says:" }, { text: `Ethan's KidSafe hospital income is S$${s.value} for each complete 24 hours.`, value_ids: [s.valueId] }, { text: "Ethan's KidSafe pays S$9,999 for dental work.", evidence_ids: ["e999"] }]), ["What does Ethan's plan pay?"]);
    await check("P3g (Tan) a list introduction whose list lost an item is withdrawn; the household is told it may not be everything", () => {
      assert.doesNotMatch(t.v, /Here is what/, info(t)); assert.match(t.v, /S\$90/); assert.match(t.v, new RegExp(C.INCOMPLETE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }); }
  { const turns = oneTurn([
      () => [call("resolve_person", { mention: "Ethan" })],
      () => [call("note_facts", { subject_id: T.ethan.id, facts: [{ key: "how_it_happened", value: "fall", words: "after a fall" }, { key: "admitted_at", value: "2 October 9.30pm", words: "admitted on 2 October at 9.30pm" }, { key: "discharged_at", value: "5 October 9am", words: "discharged on 5 October at 9am" }] })],
      () => [stv(KS, "Hospital income", T.ethan.id)],
      (v) => [hospitalCalc(T.ethan.id, KS, "Hospital income", val(v, /Hospital income/).valueId, ["2026-10-02T21:30+08:00", "admitted on 2 October at 9.30pm"], ["2026-10-05T09:00+08:00", "discharged on 5 October at 9am"])],
    ], (v) => [{ text: "Indicative estimate: KidSafe hospital income for 3 nights comes to S$270.", result_id: calcOf(v)?.calc_id }], T.ethan.id);
    const [t] = await converse(ACCOUNT_T, turns, ["Ethan was admitted on 2 October at 9.30pm after a fall and discharged on 5 October at 9am. What hospital income?"]);
    await check("P3h (Tan) when the only sentence states a figure the calculation does not give, the explanation says exactly that (not 'couldn't be tied to a passage')", () => {
      assert.equal(t.v.trim(), C.CALC_NOTE, info(t)); assert.doesNotMatch(t.v, /S\$270|passage/);
    }); }
  { const [t] = await converse(ACCOUNT_N, rohanRate(() => [{ text: "Rohan's FamilyFirst pays S$5,000 per stay.", evidence_ids: ["e999"] }]), ["What does FamilyFirst pay Rohan?"]);
    await check("P3i (Nair) nothing supported: one accurate sentence, no commentary", () => { assert.equal(t.v.trim(), C.DROPPED_NOTE, info(t)); assert.doesNotMatch(t.v, COMMENTARY); }); }

  // ================================================================ P4 unresolved person
  { const [t] = await run(SC.S9loop);
    await check("P4a (Tan asks about Nair's Rohan) 'I couldn't identify ... among the family members linked to your account'; nothing about the other household", () => {
      assert.match(t.v, /I couldn’t identify “Rohan” among the family members linked to your account\./, info(t));
      assert.doesNotMatch(t.v, /S\$|FamilyFirst|Insured Child|another (?:household|account)|exists|registered|other famil/i);
      assert.doesNotMatch(t.v, COMMENTARY);
    }); }
  { const turns = oneTurn([() => [call("resolve_person", { mention: "Marcus" })], () => [call("policies_for", { subject_id: T.marcus.id })]], () => [{ text: "Marcus's MediGuard deductible is S$2,500 per policy year.", evidence_ids: ["e1"] }], N.rohan.id);
    const [t] = await converse(ACCOUNT_N, turns, ["What's Marcus's deductible on MediGuard?"]);
    await check("P4b (Nair asks about Tan's Marcus, paraphrase) same wording; no figure or product of the other household", () => {
      assert.match(t.v, /I couldn’t identify “Marcus” among the family members linked to your account/, info(t)); assert.doesNotMatch(t.v, /S\$|MediGuard/);
    }); }
  { const [t] = await run(SC.S1);
    await check("P4c negative: a household member resolves normally (no 'couldn't identify')", () => { assert.doesNotMatch(t.v, /couldn’t identify/, info(t)); assert.match(t.v, /S\$600/); }); }
  await check("P4d unit: the wording names only what the household typed", () => {
    assert.equal(unknownPersonText(["Grandma Lim"]), "I couldn’t identify “Grandma Lim” among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page.");
  });

  // ================================================================ P5 supplied facts are used
  { const r = await run(SC.S3one); const [t1, t2] = r;
    await check("P5a (Tan) admission and discharge in one message: both recorded, the re-ask refused, no second question, estimate S$180", () => {
      assert.equal(t1.a.questions.length, 1, info(t1)); assert.match(t1.a.questions[0].text, /admitted and discharged/);
      assert.equal(t2.a.questions.length, 0, "asked again" + info(t2)); assert.match(t2.v, /Indicative estimate[^.]*S\$180/); assert.doesNotMatch(t2.v, /S\$270|\?/);
      assert.ok(t2.loop.claim.facts.admitted_at && t2.loop.claim.facts.discharged_at, "both facts recorded");
      assert.ok(t2.trace.toolCalls.some((c: any) => c.name === "ask_user" && !c.ok && /already recorded/.test(c.error)), "the re-ask was refused");
    }); }
  { const [t] = await run(SC.S6b);
    await check("P5b (Nair) admission and discharge in the first message: no question, estimate S$240", () => { assert.equal(t.a.questions.length, 0, info(t)); assert.match(t.v, /Indicative estimate[^.]*S\$240/); }); }
  await check("P5c the prompt tells the model to record every fact a message gives before asking, and never to ask for it", () => {
    assert.match(P.SYSTEM_PROMPT, /record with note_facts EVERY fact the household's message gives/);
    assert.match(P.SYSTEM_PROMPT, /never ask for a fact that message or the recorded facts already give/);
  });
  await check("P5d unit: statedInMessage finds a fact the message already gives (paraphrases) and nothing else", () => {
    const m = "He was admitted on 2 October at about 9.30pm and discharged on 5 October at 9am, so 3 nights.";
    assert.ok(Q.statedInMessage("admitted_at", m)); assert.ok(Q.statedInMessage("discharge_datetime", m));
    assert.ok(Q.statedInMessage("admission_date", "On 3 Oct she was admitted to KKH."));
    assert.ok(Q.statedInMessage("discharged_at", "She came home yesterday at noon."));
    assert.ok(Q.statedInMessage("bill_amount", "the clinic bill came to S$1,000"));
    assert.equal(Q.statedInMessage("discharged_at", "He was admitted on 2 October at 9.30pm and is still in hospital."), null);
    assert.equal(Q.statedInMessage("admitted_at", "He was kept in hospital after his fall."), null);
    assert.equal(Q.statedInMessage("bill_amount", "We haven't got the bill yet."), null);
    assert.equal(Q.statedInMessage("hospital_name", m), null);
  });

  // ================================================================ P6 conditional printed benefit
  { const [t] = await run(SC.S1);
    await check("P6a (Tan) the fracture benefit before its conditions are established reads as conditional, cited, gate clean", () => {
      assert.match(t.v, /S\$600 per fracture[^.]*payable if the fracture is confirmed by X-ray and certified by a registered medical practitioner\./, info(t));
      assert.deepEqual(t.trace.gate, []); assert.ok((t.a.figureBindings ?? []).some((b) => b.value === 600 && b.column === "Child"));
      assert.ok(t.a.citations.some((c) => c.pageStart === 2), "the condition's page is cited");
    }); }
  { const r = await run(SC.S2); const t = r[1];
    await check("P6b (Tan) the condition is carried by the benefit's sentence and not repeated separately", () => {
      assert.match(t.v, /S\$600 per fracture, payable if the fracture is confirmed by X-ray/, info(t)); assert.equal(countOf(t.v, /certified/), 1);
    }); }
  { const [t] = await converse(ACCOUNT_T, oneTurn([() => [stv(KS, "Fracture benefit", T.ethan.id), call("search_passages", { query: "fracture confirmed by X-ray certified", subject_id: T.ethan.id })]], (v) => [{ text: `Ethan's KidSafe fracture benefit is S$${val(v, /Fracture/).value} per fracture if the fracture is confirmed by X-ray and certified by a doctor.`, value_ids: [val(v, /Fracture/).valueId] }], T.ethan.id), ["Fracture benefit for Ethan?"]);
    await check("P6c already conditional: not framed twice", () => { assert.equal(countOf(t.v, /confirmed by X-ray/), 1, info(t)); assert.doesNotMatch(t.v, /payable if/); }); }
  { const r = await run(SC.S10); const t = r[0];
    await check("P6d negative (Tan): a benefit with no recorded condition (hospital income per 24 hours) is not framed as conditional", () => { assert.match(t.v, /S\$90 for each complete 24 hours\.$/, info(t)); }); }
  { const [t] = await run(SC.S1b);
    await check("P6e negative (Nair): daily hospital cash (day-count rules, not a payment condition) is stated plainly", () => { assert.doesNotMatch(t.v, /payable if|only if/, info(t)); assert.match(t.v, /S\$120 per day/); }); }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:presentation-test ${results.length - failed.length}/${results.length} passed`);
  console.log("RESULTS " + JSON.stringify(results.map((r) => ({ name: r.name.split(" ")[0], ok: r.ok }))));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

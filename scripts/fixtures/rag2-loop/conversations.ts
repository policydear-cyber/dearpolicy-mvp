/**
 * The scripted test model's scripts for the conversation-loop demo and suite (TEST DATA, not product code). Each step
 * reads what the real tools returned in the previous step -- person ids, policy ids, value ids, evidence ids -- the way
 * a model reads tool results, and decides the next calls. Figures the sentences state are read from those results
 * (selected values, compute results), never typed in here; the loop and the save-time gate then check every one.
 */
import type { ScriptCall, ScriptObservation, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const data = (o: ScriptObservation | undefined): any => { if (!o) throw new Error("script: expected a tool result that is not there"); if (!o.ok) throw new Error(`script: ${o.name} failed: ${o.result.error}`); return o.result.data; };
const person = (v: ScriptView) => { const r = data(v.find("resolve_person")); if (r.status !== "ok") throw new Error("script: person not resolved: " + JSON.stringify(r)); return r.person.id as string; };
const policy = (v: ScriptView, product: RegExp) => { const c = (data(v.find("policies_for")).covering as any[]).find((p) => product.test(p.productName ?? "")); if (!c) throw new Error("script: no covering policy like " + product); return c.policyId as string; };
const selected = (v: ScriptView, benefit: RegExp) => { const o = [...v.turn].reverse().find((x) => x.name === "select_table_value" && benefit.test(String(x.args.benefit))); const d = data(o); if (d.status !== "ok") throw new Error("script: value not selected: " + JSON.stringify(d).slice(0, 300)); return d as { valueId: string; value: number; currency: string; rowLabel: string; columnHeader: string }; };
export const computeResult = (v: ScriptView, label: RegExp) => { const o = [...v.turn].reverse().find((x) => x.name === "compute" && label.test(String(x.args.label))); return data(o) as { resultId: string; amount: number; currency: string }; };
const hitOf = (v: ScriptView, text: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => text.test(x.evidence?.excerpt ?? x.text ?? "")); if (h) return { id: h.evidence.evidence_id as string, text: String(h.evidence.excerpt ?? h.text) }; } throw new Error("script: no passage like " + text); };
const hit = (v: ScriptView, text: RegExp) => hitOf(v, text).id;
/** A figure as the passage prints it (read from the tool result, as a model reads it). */
const printed = (passage: string, near: RegExp) => { const m = passage.match(near); if (!m) throw new Error("script: the passage does not print " + near); return Number(m[1].replace(/,/g, "")); };
export const sgd = (n: number) => "S$" + n.toLocaleString("en-SG", { maximumFractionDigits: 2 });

/** (a) An ordinary policy question with a figure. */
export const POLICY_QUESTION: ScriptTurn[] = [{
  user: "Melissa",
  steps: [
    () => [call("resolve_person", { mention: "Melissa" })],
    (v) => [call("policies_for", { subject_id: person(v), topic: "accident" })],
    (v) => [call("select_table_value", { policy_id: policy(v, /FamilyGuard/), benefit: "Accidental medical expenses", subject_id: person(v), want: "amount" }), call("search_passages", { query: "accidental medical expenses aggregate limit per policy year", subject_id: person(v) })],
    (v) => { const s = selected(v, /Accidental medical/); return [call("final_answer", { subject_id: person(v), sentences: [
      { text: `Melissa's accidental medical expenses limit under FamilyGuard Personal Accident is ${sgd(s.value)} per policy year.`, value_ids: [s.valueId] },
      { text: "That accidental medical expenses limit is an aggregate per insured person per policy year, and every claim paid reduces it.", evidence_ids: [hit(v, /aggregate limit/)], benefit: "Accidental medical expenses" },
    ] })]; },
  ],
}];

/** (b)-(f) One conversation: an ambiguous son, a fracture claim with fact-finding, an interruption, a correction. */
export function claimConversation(): ScriptTurn[] {
  let junHao = "", darren = "";
  const hospitalCash = (v: ScriptView, nights: number, words: string): ScriptCall[] => {
    const pa = policy(v, /FamilyGuard/), cash = policy(v, /DailyCare/);
    void words;
    return [
      call("select_table_value", { policy_id: pa, benefit: "Accidental medical expenses", subject_id: junHao, want: "amount" }),
      call("select_table_value", { policy_id: pa, benefit: "Hospital cash", subject_id: junHao, want: "amount" }),
      call("select_table_value", { policy_id: cash, benefit: "Hospital cash per day", subject_id: junHao, want: "amount" }),
      call("select_table_value", { policy_id: cash, benefit: "Maximum days per admission", subject_id: junHao, want: "count" }),
    ];
  };
  // Agent K (expectation change): hospital cash is never nights x rate. The benefits are worked out with the
  // calculate tool: the fracture bill against the per-fracture and annual limits (an indicative estimate), and each
  // hospital cash benefit under its own day-count rule -- unresolved here (DailyCare needs the admission and discharge
  // dates and times for "from the first full day of admission"; FamilyGuard's stored wording states no day-count rule).
  const calcs = (v: ScriptView, nights: number, words: string): ScriptCall[] => {
    void nights; void words;
    const pa = policy(v, /FamilyGuard/), cash = policy(v, /DailyCare/);
    const fractureHit = hitOf(v, /per fracture/);
    return [
      call("calculate", { calculator: "bill_reimbursement", purpose: "claim", subject_id: junHao, policy_id: pa, benefit: "Accidental medical expenses", bill: { amount: 2400, currency: "SGD", words: "The bill was S$2,400" }, limit_value_ids: [selected(v, /Accidental medical/).valueId], passage_limits: [{ page: 2, quote: (fractureHit.text.split("\n").find((l) => /per fracture/.test(l)) ?? fractureHit.text).trim(), amount: printed(fractureHit.text, /S\$([\d,]+) per fracture/), currency: "SGD", label: "Accidental medical expenses per fracture", applies: "sub_limit" }] }),
      call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: junHao, policy_id: pa, benefit: "Hospital cash", rate_value_id: selected(v, /^Hospital cash$/).valueId }),
      call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: junHao, policy_id: cash, benefit: "Hospital cash per day", rate_value_id: selected(v, /Hospital cash per day/).valueId, day_cap_value_id: selected(v, /Maximum days/).valueId }),
    ];
  };
  const calcOf = (v: ScriptView, calculator: string, product: RegExp) => { const o = [...v.turn].reverse().find((x) => x.name === "calculate" && x.ok && x.args.calculator === calculator && x.args.policy_id === policy(v, product)); return data(o) as { calc_id: string; amount: number | null; kind: string }; };
  const claimAnswer = (v: ScriptView, nights: number) => {
    void nights;
    const ame = selected(v, /Accidental medical/), pa = selected(v, /^Hospital cash$/), cash = selected(v, /Hospital cash per day/);
    const fractureHit = hitOf(v, /per fracture/), fracture = fractureHit.id, perFracture = printed(fractureHit.text, /S\$([\d,]+) per fracture/);
    const rBill = calcOf(v, "bill_reimbursement", /FamilyGuard/), rPa = calcOf(v, "hospital_cash", /FamilyGuard/), rCash = calcOf(v, "hospital_cash", /DailyCare/);
    return [call("final_answer", { subject_id: junHao, sentences: [
      { text: `Jun Hao's fracture comes under accidental medical expenses on FamilyGuard Personal Accident, which pays fractures up to ${sgd(perFracture)} per fracture.`, evidence_ids: [fracture], benefit: "accidental medical expenses" },
      { text: `His accidental medical expenses limit is ${sgd(ame.value)} per policy year, in the Insured Child column.`, value_ids: [ame.valueId] },
      { text: `Indicative estimate: for the S$2,400 bill you gave, Jun Hao's accidental medical expenses for the fracture come to ${sgd(rBill.amount ?? 0)}.`, result_id: rBill.calc_id },
      { text: `Under FamilyGuard Personal Accident, Jun Hao's hospital cash is ${sgd(pa.value)} per day.`, result_id: rPa.calc_id },
      { text: `Under DailyCare Hospital Cash, his hospital cash per day is ${sgd(cash.value)}.`, result_id: rCash.calc_id },
    ], next_steps: ["Keep the hospital bill, the discharge summary and the doctor’s memo; each insurer asks for them with the claim form."] })];
  };
  return [
    { user: "my son", steps: [
      () => [call("resolve_person", { mention: "my son" })],
      (v) => { const r = data(v.find("resolve_person")); return [call("ask_user", { kind: "person", mention: "my son", question: r.question, options: r.options.map((o: any) => o.id) })]; },
    ] },
    { user: "Jun Hao", steps: [
      () => [call("resolve_person", { mention: "Jun Hao" })],
      (v) => { junHao = person(v); return [call("policies_for", { subject_id: junHao, topic: "hospital" })]; },
      (v) => [call("select_table_value", { policy_id: policy(v, /DailyCare/), benefit: "Hospital cash per day", subject_id: junHao, want: "amount" }), call("select_table_value", { policy_id: policy(v, /FamilyGuard/), benefit: "Hospital cash", subject_id: junHao, want: "amount" })],
      (v) => { const cash = selected(v, /Hospital cash per day/), pa = selected(v, /^Hospital cash$/); return [call("final_answer", { subject_id: junHao, sentences: [
        { text: `Under DailyCare Hospital Cash, Jun Hao's hospital cash is ${sgd(cash.value)} per day, from the ${cash.columnHeader} column.`, value_ids: [cash.valueId] },
        { text: `Under FamilyGuard Personal Accident, his hospital cash is ${sgd(pa.value)} per day for up to 30 days, as an insured child.`, value_ids: [pa.valueId] },
      ] })]; },
    ] },
    { user: "broke his arm", steps: [
      () => [call("resolve_person", { mention: "he" })],
      (v) => [
        // What the household said, in their words (agent C): how it happened, and the injury as they reported it --
        // never cause=accident (a policy-defined classification they did not state).
        call("note_facts", { subject_id: person(v), facts: [{ key: "how_it_happened", value: "fell off the monkey bars at the playground", words: "He fell off the monkey bars at the playground" }, { key: "injury", value: "arm fracture", words: "broke his arm" }] }),
        call("policies_for", { subject_id: person(v), topic: "accident" }),
        call("search_passages", { query: "hospital cash per day", subject_id: person(v) }),
      ],
      (v) => [call("ask_user", { kind: "fact", fact_key: "nights_in_hospital", subject_id: junHao, preface: "Sorry to hear about Jun Hao’s arm.", question: "Was Jun Hao admitted to hospital, and if so, for how many nights?", because_evidence_ids: [hit(v, /Hospital cash/)] })],
    ] },
    { user: "2 nights", steps: [
      () => [
        call("note_facts", { subject_id: junHao, facts: [{ key: "admitted", value: "yes", words: "Yes, he was warded" }, { key: "nights_in_hospital", value: "2", words: "warded for 2 nights" }] }),
        call("search_passages", { query: "fracture accidental medical expenses", subject_id: junHao }),
      ],
      // (The loop refuses a question about a fact already recorded; the model then asks the next one.)
      () => [call("ask_user", { kind: "fact", fact_key: "nights_in_hospital", subject_id: junHao, question: "How many nights was Jun Hao in hospital?", because_evidence_ids: ["e1"] })],
      (v) => [call("ask_user", { kind: "fact", fact_key: "bill_amount", subject_id: junHao, question: "How much was the hospital bill for the fracture, before any insurance?", because_evidence_ids: [hit(v, /per fracture/)] })],
    ] },
    { user: "deductible", steps: [
      () => [call("resolve_person", { mention: "me" })],
      (v) => { darren = person(v); return [call("policies_for", { subject_id: darren, topic: "hospital" }), call("search_passages", { query: "deductible", subject_id: darren })]; },
      (v) => [call("select_table_value", { policy_id: policy(v, /ShieldPlus/), benefit: "Deductible", subject_id: darren, want: "amount" })],
      (v) => { const d = selected(v, /Deductible/); return [call("final_answer", { subject_id: darren, sentences: [
        { text: `Your ShieldPlus Integrated Hospital Plan deductible is ${sgd(d.value)} per policy year (Class B1 ward).`, value_ids: [d.valueId] },
      ] })]; },
    ] },
    { user: "bill was", steps: [
      () => [
        call("note_facts", { subject_id: junHao, facts: [{ key: "bill_amount", value: "2400", currency: "SGD", words: "The bill was S$2,400" }] }),
        call("policies_for", { subject_id: junHao, topic: "hospital" }),
        call("search_passages", { query: "fracture accidental medical expenses", subject_id: junHao }),
      ],
      (v) => hospitalCash(v, 2, "warded for 2 nights"),
      (v) => calcs(v, 2, "warded for 2 nights"),
      (v) => claimAnswer(v, 2),
    ] },
    { user: "3 nights", steps: [
      () => [
        call("note_facts", { subject_id: junHao, facts: [{ key: "nights_in_hospital", value: "3", words: "Actually it was 3 nights, not 2" }] }),
        call("policies_for", { subject_id: junHao, topic: "hospital" }),
        call("search_passages", { query: "fracture accidental medical expenses", subject_id: junHao }),
      ],
      (v) => hospitalCash(v, 3, "Actually it was 3 nights"),
      (v) => calcs(v, 3, "Actually it was 3 nights"),
      (v) => claimAnswer(v, 3),
    ] },
  ];
}

export const CLAIM_MESSAGES = [
  "How much hospital cash does my son get?",
  "Jun Hao",
  "He fell off the monkey bars at the playground yesterday and broke his arm. What can we claim?",
  "Yes, he was warded for 2 nights.",
  "By the way, what's my deductible?",
  "The bill was S$2,400.",
  "Actually it was 3 nights, not 2.",
];
export const POLICY_MESSAGE = "What's Melissa's accidental medical expenses limit?";

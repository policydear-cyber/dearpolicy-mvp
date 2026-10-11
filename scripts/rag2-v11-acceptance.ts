/**
 * V1.1 acceptance (node --import tsx scripts/rag2-v11-acceptance.ts; npm run rag2:v11-test).
 *
 * The conversations and their grading were written by an independent author from the rendered synthetic library
 * (scripts/fixtures/rag2-release/acceptance-visible.json) before the implementation was finished; this file only plays
 * a capable model's tool calls for each turn (ids come from the real tools) through the REAL chat route, and grades the
 * complete visible answer the household sees against that spec: required facts, relevant completeness, person /
 * version, citations (document + page), whether exactly one question is asked when it should be (and none when it
 * should not), and clean presentation (no ids, verifier wording or raw row labels).
 *
 * RELEASE_TRANSCRIPT=1 prints every visible conversation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-release/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

type Turn = { user: string; must_include: string[]; must_include_any?: string[][]; must_not_include?: string[]; citations?: { doc: string; page: number }[]; question_expected: boolean; question_about?: string | null; notes?: string };
type Conv = { id: string; title: string; turns: Turn[] };

const { M, doc } = HH;
const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const SPEC_FILE = process.env.V11_SPEC ?? "scripts/fixtures/rag2-release/acceptance-visible.json";
const SPEC: Conv[] = JSON.parse(readFileSync(path.resolve(SPEC_FILE), "utf8"));

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 14).join("\n     ")); }
}
const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const pick = (v: ScriptView, name: string, where?: (o: any) => boolean) => { const o = v.find(name, where); if (!o?.ok) throw new Error("script: " + name + " failed: " + JSON.stringify(o?.result).slice(0, 400)); return o.result.data; };
const val = (v: ScriptView, key: string, benefit?: RegExp, who?: string) => pick(v, "select_table_value", (o) => o.args.policy_id === doc(key).id && (!benefit || benefit.test(String(o.args.benefit))) && (!who || o.args.subject_id === who)).valueId as string;
const hit = (v: ScriptView, text: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => text.test(`${x.text ?? ""} ${x.evidence?.excerpt ?? ""}`)); if (h) return h.evidence.evidence_id as string; } throw new Error("script: no passage like " + text); };
const cover = (v: ScriptView, key: string) => { for (const o of [...v.turn].reverse()) if (o.name === "policies_for" && o.ok) for (const p of o.result.data.covering as any[]) {
  if (p.policyId === doc(key).id) return ((p.evidence ?? []) as any[]).map((e) => e.evidence_id).filter(Boolean) as string[];
  const am = ((p.version?.amendments ?? []) as any[]).find((x) => x.policyId === doc(key).id); if (am?.evidence?.evidence_id) return [am.evidence.evidence_id as string];
} throw new Error("script: policies_for did not list " + key); };
/** The other version of an amended row (select_table_value's otherVersion value id). */
const other = (v: ScriptView, key: string, who?: string) => { const d = pick(v, "select_table_value", (o) => o.args.policy_id === doc(key).id && (!who || o.args.subject_id === who)); if (!d.otherVersion?.valueId) throw new Error("script: no otherVersion for " + key); return d.otherVersion.valueId as string; };
const calcId = (v: ScriptView, benefit: RegExp) => pick(v, "calculate", (o) => benefit.test(String(o.args.benefit))).calc_id as string;
const sel = (key: string, benefit: string, who: string, want = "amount", asOf?: string) => call("select_table_value", { policy_id: doc(key).id, benefit, subject_id: who, want, ...(asOf ? { as_of: asOf } : {}) });
const srch = (query: string, who: string) => call("search_passages", { query, subject_id: who });
const S = (text: string, o: Record<string, unknown> = {}) => ({ text, ...o });

/** The scripted model's turns, one entry per spec conversation (same order and number of turns). */
const A = M.alex.id, B = M.bea.id, C = M.cai.id;
const SCRIPTS: Record<string, ScriptTurn[]> = {
  V1: [
    { steps: [
      () => [call("resolve_person", { mention: "my family" })],
      () => [call("policies_for", { subject_id: A }), call("policies_for", { subject_id: B }), call("policies_for", { subject_id: C })],
      (v) => [call("final_answer", { sentences: [
        S("Alex and Bea are insured on the Harbourline Civil Service Group Scheme certificate (policy HL7700123): Group Term Life, Group Personal Accident and Group Living Care.", { evidence_ids: cover(v, "CERT") }),
        S("Alex and Bea are also on the Harbourline Group Hospital Cash plan (policy HL9900456).", { evidence_ids: cover(v, "HC") }),
        S("Alex is the employee and Bea the spouse on the Orchid Benefits Employee Group Outpatient Plan (policy OB-OP-7781).", { evidence_ids: cover(v, "EMP") }),
        S("Alex also has a Harbourline term policy (HL-TL-3302).", { evidence_ids: cover(v, "SCAN") }),
        S("Bea and Cai are insured on the Kestrel General FamilyShield Accident Plan (policy KG-FS-4410), which Endorsement No. 2 amends.", { evidence_ids: [...cover(v, "FAMILY"), ...cover(v, "ENDT")] }),
      ] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "cai" })],
      () => [call("policies_for", { subject_id: C }), sel("FAMILY", "Accidental death", C), sel("ENDT", "Fracture (per fracture)", C)],
      (v) => [call("final_answer", { subject_id: C, sentences: [
        S("Cai is named only on the FamilyShield Accident Plan (policy KG-FS-4410), as the insured child.", { evidence_ids: cover(v, "FAMILY") }),
        S("Cai's FamilyShield accidental death benefit is S$50,000 in the Child column.", { value_ids: [val(v, "FAMILY", /Accidental death/)], subject_id: C }),
        S("Cai's FamilyShield fracture benefit is S$500 per fracture in the Child column from 1 July 2026 under Endorsement No. 2.", { value_ids: [val(v, "ENDT", /Fracture/)], subject_id: C }),
        S("He is not named on the Harbourline group scheme, the Harbourline hospital cash plan, the Orchid outpatient plan or the Harbourline term policy."),
      ] })],
    ] },
  ],
  V2: [
    { steps: [
      () => [call("resolve_person", { mention: "alex" })],
      () => [call("policies_for", { subject_id: A, topic: "accident" }), sel("CERT", "Group Personal Accident sum insured", A)],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("Alex's Harbourline Civil Service Group Scheme certificate (policy HL7700123) lists his Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", { value_ids: [val(v, "CERT")], subject_id: A }),
      ] })],
    ] },
    { steps: [
      () => [sel("CERT", "Group Personal Accident sum insured", A), sel("PA_WORD", "Fracture of arm", A, "percent"), srch("accident means", A)],
      (v) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: doc("CERT").id, benefit: "Fracture of arm", sum_insured_value_id: val(v, "CERT"), percent_value_id: val(v, "PA_WORD", /arm/), condition: "fractured arm", assumption_words: "what if he fractures his arm" })],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("The schedule of compensation lists Fracture of arm at 20% of the Sum Insured, and Alex's certificate lists his Group Personal Accident sum assured as S$600,000 as of 1 April 2024.", { value_ids: [val(v, "PA_WORD", /arm/), val(v, "CERT")], subject_id: A }),
        S("If Alex fractured his arm in an accident, an indicative illustration is S$120,000.", { result_id: calcId(v, /arm/), subject_id: A }),
        S("It applies only if the fracture is caused by an Accident, which the wording defines as a sudden, unforeseen and involuntary event caused by external, violent and visible means.", { evidence_ids: [hit(v, /Accident means/)], subject_id: A }),
      ] })],
    ] },
    { steps: [
      () => [sel("CERT", "Group Personal Accident sum insured", A), sel("PA_WORD", "Fracture of toe", A, "percent")],
      (v) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: doc("CERT").id, benefit: "Fracture of toe", sum_insured_value_id: val(v, "CERT"), percent_value_id: val(v, "PA_WORD", /toe/), condition: "broken toe", assumption_words: "and a broken toe?" })],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("The schedule of compensation lists Fracture of toe at 2% of the Sum Insured.", { value_ids: [val(v, "PA_WORD", /toe/)], subject_id: A }),
        S("If Alex broke a toe in an accident, an indicative illustration is S$12,000.", { result_id: calcId(v, /toe/), subject_id: A }),
      ] })],
    ] },
  ],
  V3: [
    { steps: [
      () => [call("resolve_person", { mention: "alex" })],
      () => [sel("CERT", "Group Term Life sum assured", A), sel("CERT", "Group Personal Accident sum insured", A), sel("CERT", "Group Living Care", A), sel("HC", "hospital cash daily benefit", A), sel("HC", "hospital cash annual limit", A), sel("EMP", "GP visit", A), sel("SCAN", "Death", A), sel("SCAN", "Terminal Illness", A)],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("Alex's certificate (policy HL7700123) lists, as of 1 April 2024, a Group Term Life sum assured of S$1,000,000, a Group Personal Accident sum assured of S$600,000 and a Group Living Care sum assured of S$350,000.", { value_ids: [val(v, "CERT", /Term Life/), val(v, "CERT", /Personal Accident/), val(v, "CERT", /Living Care/)], subject_id: A }),
        S("His Harbourline Group Hospital Cash schedule (policy HL9900456) lists a daily benefit of S$150 and an annual limit of S$15,000.", { value_ids: [val(v, "HC", /daily/), val(v, "HC", /annual/)], subject_id: A }),
        S("His GP visit benefit under the Orchid Employee Group Outpatient Plan is S$40 per visit, in the Employee column.", { value_ids: [val(v, "EMP")], subject_id: A }),
        S("His Harbourline term schedule (HL-TL-3302) lists a Death sum assured of S$250,000 and a Terminal Illness sum assured of S$250,000.", { value_ids: [val(v, "SCAN", /^Death/), val(v, "SCAN", /Terminal/)], subject_id: A }),
      ] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "he" })],
      () => [call("note_facts", { subject_id: A, facts: [{ key: "how_it_happened", value: "motorbike accident", words: "he died in a motorbike accident" }] })],
      () => [sel("CERT", "Group Personal Accident sum insured", A), sel("PA_WORD", "Death due to Accident", A, "percent"), sel("CERT", "Group Term Life sum assured", A), sel("SCAN", "Death", A), srch("death due to accident within days", A), srch("exclusions competitive racing", A)],
      (v) => [call("calculate", { calculator: "lump_sum", purpose: "claim", subject_id: A, policy_id: doc("CERT").id, benefit: "Death due to Accident", sum_insured_value_id: val(v, "CERT", /Personal Accident/), percent_value_id: val(v, "PA_WORD", /Death/), condition: "death in a motorbike accident", assumption_words: "he died in a motorbike accident" })],
      (v) => [call("ask_user", { kind: "fact", subject_id: A, fact_key: "competitive_racing", question: "Was Alex taking part in a competitive race when the accident happened?", because_evidence_ids: [hit(v, /competitive racing/)], preface: "I'm very sorry for your loss.", statements: [
        S("You told me Alex died in a motorbike accident."),
        S("Alex's certificate lists his Group Personal Accident sum assured as S$600,000 as of 1 April 2024, and the wording pays Death due to Accident at 100% of the Sum Insured if he died as a direct result of an Accident within 365 days of it.", { value_ids: [val(v, "CERT", /Personal Accident/), val(v, "PA_WORD", /Death/)], evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: A }),
        S("If the insurer accepts it as a death due to Accident that no exclusion applies to, an indicative illustration of the Death due to Accident benefit is S$600,000.", { result_id: calcId(v, /Death/), subject_id: A }),
        S("The wording does not pay for death caused by competitive racing on wheels, except racing sanctioned by the Authority.", { evidence_ids: [hit(v, /competitive racing/)], subject_id: A }),
        S("His certificate also lists a Group Term Life sum assured of S$1,000,000 as of 1 April 2024, and his Harbourline term schedule lists a Death sum assured of S$250,000.", { value_ids: [val(v, "CERT", /Term Life/), val(v, "SCAN", /Death/)], subject_id: A }),
      ] })],
    ] },
    { steps: [
      () => [call("search_passages", { query: "group policy no", subject_id: A })],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("The certificate's group policy number is GX55001, and the cover's policy number is HL7700123.", { evidence_ids: [hit(v, /GROUP POLICY NO\. GX55001/)] }),
      ] })],
    ] },
    { steps: [
      () => [call("note_facts", { subject_id: A, facts: [{ key: "competitive_racing", value: "no", words: "no he wasnt racing, he was riding home from work" }] })],
      () => [sel("CERT", "Group Personal Accident sum insured", A), sel("PA_WORD", "Death due to Accident", A, "percent"), srch("death due to accident within days", A)],
      (v) => [call("calculate", { calculator: "lump_sum", purpose: "claim", subject_id: A, policy_id: doc("CERT").id, benefit: "Death due to Accident", sum_insured_value_id: val(v, "CERT", /Personal Accident/), percent_value_id: val(v, "PA_WORD", /Death/), condition: "death in a motorbike accident riding home from work", assumption_words: "he was riding home from work" })],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("You told me Alex was not racing; he was riding home from work."),
        S("The wording pays Death due to Accident at 100% of the Sum Insured if death results from an Accident within 365 days of it.", { value_ids: [val(v, "PA_WORD", /Death/)], evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: A }),
        S("If the insurer accepts what you told me, an indicative illustration of the Death due to Accident benefit is S$600,000.", { result_id: calcId(v, /Death/), subject_id: A }),
        S("Cover for an Insured Person ends on the date the Insured Person ceases to be a member of the Scheme, so the insurer will check he was still a member.", { evidence_ids: [hit(v, /ceases to be a member/)], subject_id: A }),
      ], next_steps: ["Contact Harbourline Life to start the claim; the insurer decides what it pays."] })],
    ] },
  ],
  V4: [
    { steps: [
      () => [call("resolve_person", { mention: "bea" }), call("resolve_person", { mention: "cai" })],
      () => [sel("FAMILY", "Accidental death", B), sel("FAMILY", "Accidental death", C), sel("ENDT", "Fracture (per fracture)", B), sel("ENDT", "Fracture (per fracture)", C)],
      (v) => [call("final_answer", { sentences: [
        S("On the FamilyShield Accident Plan, Bea's accidental death benefit is S$200,000 in the Adult column.", { value_ids: [val(v, "FAMILY", /Accidental/, B)], subject_id: B }),
        S("Cai's accidental death benefit is S$50,000 in the Child column.", { value_ids: [val(v, "FAMILY", /Accidental/, C)], subject_id: C }),
        S("Under Endorsement No. 2, from 1 July 2026 Bea's fracture benefit is S$1,000 per fracture (previously S$800).", { value_ids: [val(v, "ENDT", /Fracture/, B), other(v, "ENDT", B)], subject_id: B }),
        S("From 1 July 2026 Cai's fracture benefit is S$500 per fracture (previously S$400).", { value_ids: [val(v, "ENDT", /Fracture/, C), other(v, "ENDT", C)], subject_id: C }),
      ] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "cai" })],
      () => [call("note_facts", { subject_id: C, facts: [{ key: "injury", value: "broken arm", words: "cai broke his arm playing football last saturday" }, { key: "how_it_happened", value: "playing football", words: "cai broke his arm playing football last saturday" }] })],
      () => [sel("ENDT", "Fracture (per fracture)", C, "amount", "2026-10-10")],
      (v) => [call("final_answer", { subject_id: C, sentences: [
        S("You told me Cai broke his arm playing football last Saturday."),
        S("For that date, Cai's FamilyShield fracture benefit is S$500 per fracture in the Child column, as revised by Endorsement No. 2 from 1 July 2026.", { value_ids: [val(v, "ENDT", /Fracture/)], subject_id: C }),
        S("The FamilyShield policy wording is not in your uploaded documents, so its claim conditions are not stated."),
      ], next_steps: ["Ask Kestrel General for the FamilyShield claim form and what they need (for example the doctor's report)."] })],
    ] },
  ],
  V5: [
    { steps: [
      () => [call("resolve_person", { mention: "my wife" })],
      () => [sel("EMP", "GP visit", B), sel("EMP", "GP visit", A)],
      (v) => [call("final_answer", { subject_id: B, sentences: [
        S("Yes: Bea is the spouse on the Orchid Benefits Employee Group Outpatient Plan (policy OB-OP-7781), and her GP visit benefit is S$30 per visit.", { value_ids: [val(v, "EMP", /GP/, B)], subject_id: B }),
        S("As the employee, Alex's GP visit benefit is S$40 per visit.", { value_ids: [val(v, "EMP", /GP/, A)], subject_id: A }),
      ] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "cai" })],
      () => [call("read_page", { policy_id: doc("EMP").id, page: 1 })],
      (v) => [call("final_answer", { subject_id: C, sentences: [
        S("The Employee Group Outpatient Plan schedule only names Alex as the employee and Bea as the spouse; Cai is not listed, so the uploaded documents don't show outpatient cover for him."),
      ], next_steps: ["Ask your employer or Orchid Benefits whether children can be added."] })],
    ] },
    { steps: [
      () => [call("search_passages", { query: "GP visits per year limit", subject_id: B }), sel("EMP", "GP visit", B)],
      (v) => [call("final_answer", { subject_id: B, sentences: [
        S("The uploaded Employee Group Outpatient Plan schedule does not state how many GP visits a year Bea can claim.", {}),
        S("It lists her GP visit benefit as S$30 per visit in the Spouse column.", { value_ids: [val(v, "EMP")], subject_id: B }),
      ], next_steps: ["The full plan details from your employer or Orchid Benefits would show any annual visit limit."] })],
    ] },
  ],
  V6: [
    { steps: [
      () => [call("resolve_person", { mention: "bea" })],
      () => [sel("HC", "hospital cash daily benefit", B), sel("HC", "hospital cash annual limit", B)],
      (v) => [call("final_answer", { subject_id: B, sentences: [
        S("Bea's Harbourline Group Hospital Cash schedule (policy HL9900456) lists a daily benefit of S$100 per day and an annual limit of S$10,000, effective 1 April 2024.", { value_ids: [val(v, "HC", /daily/), val(v, "HC", /annual/)], subject_id: B }),
      ] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "her" })],
      () => [sel("CERT", "Group Term Life sum assured", B)],
      (v) => [call("final_answer", { subject_id: B, sentences: [
        S("Bea's certificate lists her Group Term Life sum assured as S$500,000, as of 1 April 2024.", { value_ids: [val(v, "CERT")], subject_id: B }),
      ] })],
    ] },
    { steps: [
      () => [sel("HC", "hospital cash daily benefit", B), sel("HC", "hospital cash annual limit", B)],
      (v) => [call("calculate", { calculator: "hospital_cash", purpose: "what_if", subject_id: B, policy_id: doc("HC").id, benefit: "Daily benefit", rate_value_id: val(v, "HC", /daily/), admission: { at: "2026-10-01T10:00:00+08:00", words: "if she's warded 5 days", assumed: true }, discharge: { at: "2026-10-06T10:00:00+08:00", words: "if she's warded 5 days", assumed: true } })],
      (v) => [call("final_answer", { subject_id: B, sentences: [
        S("Bea's Harbourline Group Hospital Cash schedule lists a daily benefit of S$100 and an annual limit of S$10,000.", { value_ids: [val(v, "HC", /daily/), val(v, "HC", /annual/)], subject_id: B }),
        S("If she is warded for 5 full days, an indicative illustration is S$500.", { result_id: pick(v, "calculate").calc_id, subject_id: B }),
      ] })],
    ] },
  ],
  V7: [
    { steps: [
      () => [call("resolve_person", { mention: "bea" })],
      () => [call("note_facts", { subject_id: B, facts: [{ key: "injury", value: "fractured arm", words: "bea fractured her arm on 15 june 2026" }, { key: "event_date", value: "2026-06-15", words: "bea fractured her arm on 15 june 2026" }] })],
      () => [sel("CERT", "Group Personal Accident sum insured", B), sel("PA_WORD", "Fracture of arm", B, "percent"), sel("FAMILY", "Fracture (per fracture)", B, "amount", "2026-06-15"), srch("accident means", B)],
      (v) => [call("calculate", { calculator: "lump_sum", purpose: "claim", subject_id: B, policy_id: doc("CERT").id, benefit: "Fracture of arm", sum_insured_value_id: val(v, "CERT"), percent_value_id: val(v, "PA_WORD", /arm/), condition: "fractured arm", assumption_words: "bea fractured her arm on 15 june 2026" })],
      (v) => [call("ask_user", { kind: "fact", subject_id: B, fact_key: "how_it_happened", question: "How did Bea fracture her arm?", because_evidence_ids: [hit(v, /Accident means/)], statements: [
        S("You told me Bea fractured her arm on 15 June 2026."),
        S("Her Group Personal Accident cover pays Fracture of arm at 20% of her S$400,000 sum assured (certificate as of 1 April 2024).", { value_ids: [val(v, "PA_WORD", /arm/), val(v, "CERT")], subject_id: B }),
        S("If the fracture was caused by an Accident as the wording defines it, an indicative illustration is S$80,000.", { result_id: calcId(v, /arm/), subject_id: B }),
        S("Her FamilyShield fracture benefit on 15 June 2026 was S$800 per fracture in the Adult column, before Endorsement No. 2 raised it from 1 July 2026.", { value_ids: [val(v, "FAMILY", /Fracture/)], subject_id: B }),
      ] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "cai" })],
      () => [call("note_facts", { subject_id: C, facts: [{ key: "injury", value: "fractured arm", words: "it was cai not bea" }] })],
      () => [sel("FAMILY", "Fracture (per fracture)", C, "amount", "2026-06-15"), call("policies_for", { subject_id: C })],
      (v) => [call("final_answer", { subject_id: C, sentences: [
        S("Thanks, this is about Cai, not Bea; the figures I gave for Bea no longer apply."),
        S("Cai is not named on the Harbourline Civil Service Group Scheme certificate."),
        S("He is the insured child on the FamilyShield Accident Plan.", { evidence_ids: cover(v, "FAMILY"), subject_id: C }),
        S("For a fracture on 15 June 2026, Cai's FamilyShield fracture benefit is S$400 per fracture in the Child column, before Endorsement No. 2 took effect on 1 July 2026.", { value_ids: [val(v, "FAMILY", /Fracture/)], subject_id: C }),
      ] })],
    ] },
    { steps: [
      () => [call("note_facts", { subject_id: C, facts: [{ key: "event_date", value: "2026-07-15", words: "it was 15 july actually, not june" }] })],
      () => [sel("ENDT", "Fracture (per fracture)", C, "amount", "2026-07-15")],
      (v) => [call("final_answer", { subject_id: C, sentences: [
        S("You told me the fracture was on 15 July 2026, not in June."),
        S("From 1 July 2026 Endorsement No. 2 raised Cai's FamilyShield fracture benefit to S$500 per fracture in the Child column, so S$500 applies to 15 July 2026.", { value_ids: [val(v, "ENDT", /Fracture/)], subject_id: C }),
      ] })],
    ] },
  ],
  V8: [
    { steps: [
      () => [call("resolve_person", { mention: "alex" })],
      () => [srch("illness or disease exclusion", A), sel("CERT", "Group Term Life sum assured", A), sel("SCAN", "Death", A), sel("SCAN", "Terminal Illness", A)],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("No: the Group Personal Accident wording excludes death caused by illness or disease, so it will not pay a death benefit for cancer.", { evidence_ids: [hit(v, /illness or disease/)], subject_id: A }),
        S("Alex's certificate lists a Group Term Life sum assured of S$1,000,000 as of 1 April 2024; its policy wording is not in your uploaded documents.", { value_ids: [val(v, "CERT")], subject_id: A }),
        S("His Harbourline term schedule lists a Death sum assured of S$250,000 and a Terminal Illness sum assured of S$250,000.", { value_ids: [val(v, "SCAN", /^Death/), val(v, "SCAN", /Terminal/)], subject_id: A }),
      ] })],
    ] },
    { steps: [
      () => [sel("CERT", "Group Personal Accident sum insured", A), sel("PA_WORD", "Death due to Accident", A, "percent"), srch("death due to accident within days", A)],
      (v) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: doc("CERT").id, benefit: "Death due to Accident", sum_insured_value_id: val(v, "CERT"), percent_value_id: val(v, "PA_WORD", /Death/), condition: "death in a car crash", assumption_words: "if it was a car crash on the pie on his way to work" })],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("If Alex died in a car crash on his way to work, the wording pays Death due to Accident at 100% of the Sum Insured where death results from the Accident within 365 days.", { value_ids: [val(v, "PA_WORD", /Death/)], evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: A }),
        S("If so, with his S$600,000 Group Personal Accident sum assured (certificate as of 1 April 2024), an indicative illustration is S$600,000.", { result_id: calcId(v, /Death/), value_ids: [val(v, "CERT")], subject_id: A }),
      ] })],
    ] },
  ],
  V9: [
    { steps: [
      () => [sel("OLD", "Group Personal Accident sum insured", A), sel("CERT", "Group Personal Accident sum insured", A)],
      (v) => [call("final_answer", { subject_id: A, sentences: [
        S("Your 2022 certificate has been replaced by a newer certificate, so I don't use it."),
        S("Your current certificate lists your Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", { value_ids: [val(v, "CERT")], subject_id: A }),
      ] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "bea" })],
      () => [sel("CERT", "Group Personal Accident sum insured", B)],
      (v) => [call("final_answer", { subject_id: B, sentences: [
        S("The 2022 certificate was replaced, so I no longer use it."),
        S("Bea's current certificate lists her Group Personal Accident sum assured as S$400,000, as of 1 April 2024.", { value_ids: [val(v, "CERT")], subject_id: B }),
      ] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "my colleague goh wei ming alex" })],
      () => [call("final_answer", { sentences: [
        S("I can only use your own household's documents, so I can't look up a colleague's certificate."),
      ] })],
    ] },
  ],
  V10: [
    { steps: [
      () => [call("resolve_person", { mention: "he" })],
      (v) => { const r = pick(v, "resolve_person"); return [call("ask_user", { kind: "person", question: "Do you mean Alex or Cai?", mention: "he", options: (r.options as any[]).map((o) => o.id) })]; },
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "my son" })],
      () => [sel("ENDT", "Fracture (per fracture)", C)],
      (v) => [call("final_answer", { subject_id: C, sentences: [
        S("Cai's FamilyShield fracture benefit is S$500 per fracture in the Child column from 1 July 2026 (previously S$400), under Endorsement No. 2.", { value_ids: [val(v, "ENDT"), other(v, "ENDT")], subject_id: C }),
      ] })],
    ] },
    { steps: [
      () => [srch("dental", C)],
      () => [call("final_answer", { subject_id: C, sentences: [
        S("None of your uploaded documents mentions dental cover, so it is not stated whether any of them covers Cai's dental treatment."),
      ], next_steps: ["A dental plan or the full policy wordings would be needed to check."] })],
    ] },
    { steps: [
      () => [call("read_page", { policy_id: doc("SCAN").id, page: 1 })],
      () => [call("final_answer", { subject_id: A, sentences: [
        S("The uploaded Harbourline term schedule (HL-TL-3302) does not state when the policy expires; the full policy contract would show its term."),
      ] })],
    ] },
  ],
};

// ------------------------------------------------------------------ grading
const DIAGNOSTIC = /cited page|figure is not bound|one column per person|save-time|evidence id|\bvalue id\b|\b[evr]\d+\b|left out is for|POLICY NO\.|T\*{4}\d{3}[A-Z]|HARBOURL1NE|row label/;
const amountRe = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (/\d$/.test(s) ? "(?![\\d,]*\\d)" : ""), "i");
const has = (text: string, s: string) => amountRe(s).test(text);

export function gradeTurn(t: Turn, a: ChatAnswer, docKey: (id: string) => string | null): string[] {
  const text = visible(a);
  const problems: string[] = [];
  for (const s of t.must_include ?? []) if (!has(text, s)) problems.push(`missing “${s}”`);
  for (const alts of t.must_include_any ?? []) if (!alts.some((s) => has(text, s))) problems.push(`missing one of ${JSON.stringify(alts)}`);
  for (const s of t.must_not_include ?? []) if (has(text, s)) problems.push(`must not include “${s}”`);
  const cited = new Set((a.citations ?? []).map((c) => `${docKey(c.policyId)}:${c.pageStart}`));
  for (const c of t.citations ?? []) if (!cited.has(`${c.doc}:${c.page}`)) problems.push(`no citation of ${c.doc} page ${c.page}`);
  const q = (a.questions ?? []).length;
  if (t.question_expected && q !== 1) problems.push(`expected one question (${t.question_about}), got ${q}`);
  if (!t.question_expected && q) problems.push(`asked a question it should not: “${a.questions![0].text}”`);
  if (DIAGNOSTIC.test(text)) problems.push(`shows internal text: ${text.match(DIAGNOSTIC)![0]}`);
  return problems;
}

async function main() {
  const h: Harness = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const docKey = (id: string) => HH.DOCS.find((d) => d.id === id)?.key ?? null;
  const transcripts: string[] = [];
  let turnsGraded = 0, turnsPassed = 0;
  for (const conv of SPEC) {
    const script = SCRIPTS[conv.id];
    if (!script) { await check(`${conv.id} ${conv.title}`, () => { throw new Error("no script for this conversation"); }); continue; }
    installLoopModel(new ScriptedLoopModel(script));
    let c: { id?: string; rev?: number } = {};
    const lines = [`### ${conv.id} ${conv.title}`];
    const failures: string[] = [];
    try {
      for (const [i, t] of conv.turns.entries()) {
        const answer = await h.send(t.user, c);
        c = { id: answer.conversationId, rev: answer.conversationRevision };
        const saved = await h.savedAnswer(c.id!);
        const trace = saved.state.ragLoop?.turns.at(-1);
        const problems = gradeTurn(t, saved.answer, docKey);
        turnsGraded++; if (!problems.length) turnsPassed++;
        lines.push(`USER: ${t.user}`, `APP:  ${visible(saved.answer).replace(/\n/g, "\n      ")}`, `      cites=${[...new Set((saved.answer.citations ?? []).map((x) => `${docKey(x.policyId)}:${x.pageStart}`))].join(",")} steps=${trace?.steps} loop_ms=${trace?.latencyMs} gate=${JSON.stringify(trace?.gate ?? [])}`,
          ...(trace?.dropped ?? []).map((d: any) => `      - dropped: ${d.sentence} -- ${d.reason}`), ...(trace?.toolCalls ?? []).filter((x: any) => !x.ok).map((x: any) => `      ! ${x.name}: ${String(x.error ?? "").slice(0, 300)}`),
          problems.length ? `      GRADE: FAIL -- ${problems.join("; ")}` : "      GRADE: pass");
        if (problems.length) failures.push(`turn ${i + 1} (“${t.user}”): ${problems.join("; ")}`);
      }
    } catch (e) { failures.push("error: " + (e instanceof Error ? e.message : String(e))); }
    finally { installLoopModel(null); }
    transcripts.push(lines.join("\n"));
    await check(`${conv.id} ${conv.title}`, () => { assert.deepEqual(failures, []); });
  }
  if (process.env.RELEASE_TRANSCRIPT) console.log("\n" + transcripts.join("\n\n"));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nturns graded ${turnsPassed}/${turnsGraded} passed`);
  console.log(`v1.1 acceptance ${results.length - failed.length}/${results.length} conversations passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

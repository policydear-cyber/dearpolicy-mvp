/**
 * Scenario completion (node --import tsx scripts/rag2-scenario-regressions.ts; npm run rag2:scenario-test).
 *
 * Reproduces a reported live conversation -- "Desmond broke his leg." / "He fell down the stairs." / "Yes, confirmed
 * with an X-ray. He was also warded for two nights." / "Transverse fracture." -- on a SYNTHETIC household
 * (scripts/fixtures/rag2-scenario/household.ts) through the REAL chat route, plus paraphrases, other people and other
 * policies, and grades the WHOLE visible conversation: what reached the household, not only whether the right question
 * was asked.
 *
 * Two model behaviours are played (both scripted; real-model behaviour is measured separately and budgeted):
 *  - CAPABLE: a model that looks up the schedule, the person's certificate amount and the hospital benefit, and uses
 *    the calculator. Graded on the complete visible conversation (facts, figures, conditions, one question).
 *  - MINIMAL: the live shape -- a model that only says back what it was told and repeats one clause. Graded on what
 *    the PRODUCT does with it: no false correction, the one repair names every new fact and the certificate link, the
 *    fallback carries what was established, and the paperwork note is not repeated turn after turn.
 *
 * Evidence class: PLUMBING / CONTROL evidence (scripted stand-in). RELEASE_TRANSCRIPT=1 prints every conversation.
 */
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-scenario/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

const { M, doc } = HH;
const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 16).join("\n     ")); }
}
const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const S = (text: string, o: Record<string, unknown> = {}) => ({ text, ...o });
const ids = (...xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const sel = (key: string, benefit: string, who: string, want = "amount") => call("select_table_value", { policy_id: doc(key).id, benefit, subject_id: who, want });
const vid = (v: ScriptView, key: string, benefit: RegExp, who: string) => { const o = v.find("select_table_value", (o) => o.args.policy_id === doc(key).id && benefit.test(String(o.args.benefit)) && o.args.subject_id === who); return o?.ok ? (o.result.data.valueId as string) : null; };
const hit = (v: ScriptView, text: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => text.test(`${x.text ?? ""} ${x.evidence?.excerpt ?? ""}`)); if (h) return h.evidence.evidence_id as string; } return null; };
const money = (n: number) => "S$" + n.toLocaleString("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const docKey = (id: string) => HH.DOCS.find((d) => d.id === id)?.key ?? null;

// ------------------------------------------------------------------ the capable model's moves
const D = M.desmond.id, G = M.grace.id, K = M.kai.id;
const ROWS = { femur: { label: "Fracture of thigh bone (femur)", re: /femur/, says: "a fracture of the thigh bone (femur)" }, lower: { label: "Fracture of lower leg (tibia or fibula)", re: /tibia/, says: "a fracture of the lower leg (tibia or fibula)" }, patella: { label: "Fracture of kneecap (patella)", re: /patella/, says: "a fracture of the kneecap (patella)" } } as const;
type RowKey = keyof typeof ROWS;
const NOTE_QUOTE = "For a simple (closed) fracture 50% of the percentage shown is payable";
/** The group PA lookups for one person: their certificate row, the schedule rows, the conditions, the hospital benefit and the certificate link. */
const paLookups = (who: string, rows: RowKey[]) => [
  call("policies_for", { subject_id: who }),
  sel("CERT", "Group Personal Accident", who),
  ...rows.map((r) => sel("PA_WORD", ROWS[r].label, who, "percent")),
  call("search_passages", { query: "fracture confirmed by X-ray simple closed compound open percentage", subject_id: who }),
  call("search_passages", { query: "Accident Hospital Income complete period of 24 hours confinement", subject_id: who }),
  call("search_passages", { query: "Sum Insured amount shown in the Certificate of Group Insurance", subject_id: who }),
];
const certSentence = (v: ScriptView, who: string, name: string) => S(`Certificate amount: ${name}'s Certificate of Group Insurance lists a Group Personal Accident sum insured of ${who === D ? "S$300,000" : "S$200,000"} as of 1 July 2025 (the amount on that date, not confirmation of current cover); the wording's Sum Insured is that amount.`, { value_ids: ids(vid(v, "CERT", /Personal Accident/, who)), evidence_ids: ids(hit(v, /Sum Insured is the amount shown/)), subject_id: who });
const rowsSentence = (v: ScriptView, who: string, rows: RowKey[]) => S(`Printed percentages: the Group Personal Accident Schedule of Compensation lists ${rows.map((r) => `${ROWS[r].says.replace(/^a fracture of /, "")} at ${({ femur: "10%", lower: "6%", patella: "4%" } as const)[r]}`).join(", ")} of the Sum Insured, payable for a fracture confirmed by X-ray.`, { value_ids: ids(...rows.map((r) => vid(v, "PA_WORD", ROWS[r].re, who))), evidence_ids: ids(hit(v, /confirmed by X-ray/)), subject_id: who });
const noteSentence = (v: ScriptView, who: string) => S("For a simple (closed) fracture 50% of the percentage shown is payable, and the full percentage for a compound (open) fracture.", { evidence_ids: ids(hit(v, /simple \(closed\)/)), subject_id: who });
const hospitalSentence = (v: ScriptView, who: string) => S("The wording's Accident Hospital Income pays S$100 for each complete period of 24 hours of continuous confinement in hospital as an in-patient, up to 90 days per Accident.", { evidence_ids: ids(hit(v, /Accident Hospital Income/)), subject_id: who });
const nightsSentence = (v: ScriptView, who: string, nights: string) => S(`You told me he was warded for ${nights}; how many complete 24-hour periods that is depends on the admission and discharge times, so it is not yet known whether that is one or two periods.`, { evidence_ids: ids(hit(v, /Accident Hospital Income/)), subject_id: who });
/** lump_sum illustrations for each row: the full percentage, and (where the calculator takes it) the wording's 50% for a simple fracture. */
const lumpCalls = (v: ScriptView, who: string, rows: RowKey[], words: string, simple: boolean) => rows.flatMap((r) => {
  const base = { calculator: "lump_sum", purpose: "claim", subject_id: who, policy_id: doc("PA_WORD").id, benefit: ROWS[r].label, sum_insured_value_id: vid(v, "CERT", /Personal Accident/, who), percent_value_id: vid(v, "PA_WORD", ROWS[r].re, who), assumption_words: words };
  return [
    call("calculate", { ...base, condition: `${ROWS[r].says}, compound (open)` }),
    ...(simple ? [call("calculate", { ...base, condition: `${ROWS[r].says}, simple (closed)`, proportion: { page: 1, quote: NOTE_QUOTE, percent: 50, applies_when: "a simple (closed) fracture" } })] : []),
  ];
});
/** One line per row that could apply, comparing its alternatives (compound / simple), each figure the calculator's own result. */
const lumpSentences = (v: ScriptView, who: string) => {
  const done = v.turn.filter((o) => o.name === "calculate" && o.ok && o.args.calculator === "lump_sum" && o.result.data.kind === "conditional_illustration");
  const rows = [...new Set(done.map((o) => String(o.args.benefit)))];
  return rows.map((row) => {
    const of = done.filter((o) => o.args.benefit === row);
    const open = of.find((o) => !/simple/.test(String(o.args.condition))), closed = of.find((o) => /simple/.test(String(o.args.condition)));
    const what = String(of[0].args.condition).replace(/^a fracture of /, "").replace(/, (compound \(open\)|simple \(closed\))$/, "");
    const alts = [open && `${money(Number(open.result.data.amount))} if compound (open)`, closed && `${money(Number(closed.result.data.amount))} if simple (closed)`].filter(Boolean).join(", or ");
    return S(`If it is ${what}: ${alts} -- an illustration only.`, { result_ids: of.map((o) => o.result.data.calc_id), subject_id: who });
  });
};
const synthesis = (v: ScriptView, who: string, open: string) => S(`Not yet established: ${open}; the amounts above are illustrations worked from the printed schedule, not approved amounts.`, { evidence_ids: ids(hit(v, /Fracture of thigh bone|% of Sum Insured/), hit(v, /simple \(closed\)/)), subject_id: who });
const lumpRefused = (v: ScriptView) => v.turn.filter((o) => o.name === "calculate" && !o.ok).map((o) => String(o.result.error ?? ""));
const boneQ = (v: ScriptView, who: string, name: string, statements: unknown[]) => call("ask_user", { kind: "fact", subject_id: who, fact_key: "bone_fractured", question: `Which bone in ${name}'s leg was broken: the thigh bone (femur), a lower-leg bone (tibia or fibula), or the kneecap (patella)?`, because_evidence_ids: ids(hit(v, /Fracture of thigh bone|% of Sum Insured/), hit(v, /confirmed by X-ray/)), statements });
/** ask_user, retried once without the statements the composer refused (as a model does when told what was not shown). */
const askRetry = (v: ScriptView): ScriptCall[] => {
  const prev = [...v.turn].reverse().find((o) => o.name === "ask_user");
  const a = prev!.args as any; const err = String(prev!.result.error ?? "");
  const refused = [...err.matchAll(/"([^"]{20,80})"/g)].map((m) => m[1]);
  return [call("ask_user", { ...a, statements: (a.statements ?? []).filter((s: any) => !refused.some((r) => String(s.text).startsWith(r))) })];
};

const LEG: RowKey[] = ["femur", "lower", "patella"];
/** The reported conversation, CAPABLE model. */
const CAPABLE_REPORTED: ScriptTurn[] = [
  { user: "broke his leg", steps: [
    () => [call("resolve_person", { mention: "Desmond" })],
    () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his leg", words: "Desmond broke his leg" }] }), ...paLookups(D, LEG), call("search_passages", { query: "Accident means sudden unforeseen external violent", subject_id: D })],
    (v) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "how_it_happened", question: "How did Desmond break his leg?", because_evidence_ids: ids(hit(v, /Accident means/)), statements: [certSentence(v, D, "Desmond"), rowsSentence(v, D, LEG)] })],
    askRetry,
  ] },
  { user: "stairs", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "fell down the stairs", words: "He fell down the stairs" }] }), ...paLookups(D, LEG)],
    (v) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "xray_confirmed", question: "Was the fracture confirmed by an X-ray?", because_evidence_ids: ids(hit(v, /confirmed by X-ray/)), statements: [] })],
  ] },
  { user: "X-ray", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "xray_confirmed", value: "yes", words: "Yes, confirmed with an X-ray" }, { key: "nights_in_hospital", value: "2", words: "He was also warded for two nights" }] }), ...paLookups(D, LEG)],
    (v) => lumpCalls(v, D, LEG, "Desmond broke his leg", true),
    (v) => [boneQ(v, D, "Desmond", [certSentence(v, D, "Desmond"), rowsSentence(v, D, LEG), noteSentence(v, D), ...lumpSentences(v, D), hospitalSentence(v, D), nightsSentence(v, D, "two nights"), synthesis(v, D, "which bone was broken, whether the fracture is simple (closed) or compound (open), and the admission and discharge times")])],
    askRetry,
  ] },
  { user: "Transverse", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "transverse fracture", words: "Transverse fracture." }] }), ...paLookups(D, LEG)],
    (v) => [boneQ(v, D, "Desmond", [
      S("You told me it is a transverse fracture.", {}),
      S("The Schedule of Compensation sets the percentage by the bone that is broken, and the payable share by whether the fracture is simple (closed) or compound (open); a transverse fracture, which describes the line of the break, is neither of those, so it does not decide the row.", { evidence_ids: ids(hit(v, /Fracture of thigh bone|% of Sum Insured/), hit(v, /simple \(closed\)/)), subject_id: D }),
    ])],
    askRetry,
  ] },
];

/** A model that ignores what it was told and repeats its last call. */
const repeatLast = (v: ScriptView): ScriptCall[] => { const prev = [...v.turn].reverse().find((o) => o.name === "ask_user" || o.name === "final_answer")!; return [call(prev.name, prev.args)]; };
/** The reported conversation, MINIMAL model (the live shape): one clause, repeated; the last answer only says back. */
const MINIMAL_REPORTED: ScriptTurn[] = [
  { user: "broke his leg", steps: [
    () => [call("resolve_person", { mention: "Desmond" })],
    () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his leg", words: "Desmond broke his leg" }] }), call("search_passages", { query: "fracture leg", subject_id: D }), call("search_passages", { query: "Accident means", subject_id: D })],
    (v) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "how_it_happened", question: "How did Desmond break his leg?", because_evidence_ids: ids(hit(v, /Accident means/)), statements: [noteSentence(v, D)] })],
    repeatLast,
  ] },
  { user: "stairs", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "fell down the stairs", words: "He fell down the stairs" }] }), call("search_passages", { query: "fracture X-ray", subject_id: D })],
    (v) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "xray_confirmed", question: "Was the fracture confirmed by an X-ray?", because_evidence_ids: ids(hit(v, /confirmed by X-ray/)), statements: [noteSentence(v, D)] })],
    repeatLast,
  ] },
  { user: "X-ray", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "xray_confirmed", value: "yes", words: "Yes, confirmed with an X-ray" }, { key: "nights_in_hospital", value: "2", words: "He was also warded for two nights" }] }), call("search_passages", { query: "simple closed compound open fracture", subject_id: D })],
    (v) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "fracture_type", question: "Was it a simple (closed) fracture, where the skin was not broken?", because_evidence_ids: ids(hit(v, /simple \(closed\)/)), statements: [noteSentence(v, D)] })],
    repeatLast,
  ] },
  { user: "Transverse", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "transverse fracture", words: "Transverse fracture." }, { key: "fracture_type", value: "transverse", words: "Transverse fracture." }] })],
    () => [call("final_answer", { subject_id: D, sentences: [S("You told me it is a transverse fracture.")] })],
    // The repair (if any) is answered by repeating the same thing: the product's fallback decides what is shown.
    () => [call("final_answer", { subject_id: D, sentences: [S("You told me it is a transverse fracture.")] })],
  ] },
];

/** The same MINIMAL model, but one that FOLLOWS the repair it is given (looks up what the repair names). */
const RESPONSIVE_REPORTED: ScriptTurn[] = [
  ...MINIMAL_REPORTED.slice(0, 3),
  { user: "Transverse", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "transverse fracture", words: "Transverse fracture." }, { key: "fracture_type", value: "transverse", words: "Transverse fracture." }] })],
    () => [call("final_answer", { subject_id: D, sentences: [S("You told me it is a transverse fracture.")] })],
    (v) => { const repair = String(v.last[0]?.result.error ?? ""); return /certificate|sum insured/i.test(repair) ? paLookups(D, LEG) : [call("search_passages", { query: "fracture", subject_id: D })]; },
    (v) => lumpCalls(v, D, LEG, "Desmond broke his leg", true),
    (v) => { const repair = String(v.turn.find((o) => o.name === "final_answer" && !o.ok)?.result.error ?? ""); const hosp = /warded|nights_in_hospital|hospital/i.test(repair);
      return [boneQ(v, D, "Desmond", [S("You told me it is a transverse fracture."), certSentence(v, D, "Desmond"), rowsSentence(v, D, LEG), noteSentence(v, D), ...lumpSentences(v, D), ...(hosp ? [hospitalSentence(v, D), nightsSentence(v, D, "two nights")] : [])])]; },
    askRetry,
  ] },
];

/** Paraphrase: the bone and the closed fracture are given, the stay is given with dates and times later. */
const CAPABLE_PARAPHRASE: ScriptTurn[] = [
  { user: "shin", steps: [
    () => [call("resolve_person", { mention: "Desmond" })],
    () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "fractured his shin bone", words: "Desmond fractured his shin bone" }, { key: "how_it_happened", value: "slipped on the stairs at home", words: "slipped on the stairs at home" }] }), ...paLookups(D, ["lower"])],
    (v) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "xray_confirmed", question: "Was the fracture confirmed by an X-ray?", because_evidence_ids: ids(hit(v, /confirmed by X-ray/)), statements: [certSentence(v, D, "Desmond"), rowsSentence(v, D, ["lower"])] })],
    askRetry,
  ] },
  { user: "closed", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "xray_confirmed", value: "yes", words: "the X-ray showed it" }, { key: "fracture_type", value: "closed", words: "it's a closed fracture" }, { key: "nights_in_hospital", value: "2", words: "he stayed two nights in the ward" }] }), ...paLookups(D, ["lower"])],
    (v) => [call("calculate", { calculator: "lump_sum", purpose: "claim", subject_id: D, policy_id: doc("PA_WORD").id, benefit: ROWS.lower.label, sum_insured_value_id: vid(v, "CERT", /Personal Accident/, D), percent_value_id: vid(v, "PA_WORD", /tibia/, D), assumption_words: "Desmond fractured his shin bone", condition: `${ROWS.lower.says}, simple (closed)`, proportion: { page: 1, quote: NOTE_QUOTE, percent: 50, applies_when: "a simple (closed) fracture" } })],
    (v) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "admission_datetime", question: "When was Desmond admitted to hospital (date and time)?", because_evidence_ids: ids(hit(v, /Accident Hospital Income/)), statements: [certSentence(v, D, "Desmond"), rowsSentence(v, D, ["lower"]), noteSentence(v, D), ...lumpSentences(v, D), hospitalSentence(v, D), nightsSentence(v, D, "two nights")] })],
    askRetry,
  ] },
  { user: "admitted", steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "admission_datetime", value: "2026-10-03T21:00+08:00", words: "admitted at 9pm on 3 October" }, { key: "discharge_datetime", value: "2026-10-05T11:00+08:00", words: "discharged at 11am on 5 October" }] }), call("search_passages", { query: "Accident Hospital Income complete period of 24 hours confinement", subject_id: D })],
    (v) => [call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: D, policy_id: doc("PA_WORD").id, benefit: "Accident Hospital Income", rate_passage: { page: 2, quote: "Accident Hospital Income: S$100 for each complete period of 24 hours", amount: 100, currency: "SGD" }, admission: { at: "2026-10-03T21:00+08:00", words: "admitted at 9pm on 3 October" }, discharge: { at: "2026-10-05T11:00+08:00", words: "discharged at 11am on 5 October" } })],
    (v) => { const c = v.find("calculate"); return [call("final_answer", { subject_id: D, sentences: [
      S("You told me Desmond was admitted at 9pm on 3 October and discharged at 11am on 5 October."),
      ...(c?.ok && c.result.data.kind === "indicative_estimate" ? [S(`On those times the stay counts as ${Number(c.result.data.amount) / 100} complete period${Number(c.result.data.amount) === 100 ? "" : "s"} of 24 hours, so the Accident Hospital Income indicative estimate is ${money(Number(c.result.data.amount))}, not an approved amount.`, { result_id: c.result.data.calc_id, subject_id: D })] : [hospitalSentence(v, D)]),
    ] })]; },
  ] },
];

/** Another person on the same certificate (Grace) and on a flat-amount family policy. */
const CAPABLE_GRACE: ScriptTurn[] = [
  { user: "Grace", steps: [
    () => [call("resolve_person", { mention: "my wife Grace" })],
    () => [call("note_facts", { subject_id: G, facts: [{ key: "injury", value: "broke her leg", words: "my wife Grace broke her leg" }, { key: "how_it_happened", value: "fell off a ladder", words: "she fell off a ladder" }] }), ...paLookups(G, LEG), sel("FAMILY", "Fracture (per fracture, any bone)", G)],
    (v) => [boneQ(v, G, "Grace", [
      S("Grace's FamilyShield Accident Plan lists S$800 per fracture, any bone, in its Adult column.", { value_ids: ids(vid(v, "FAMILY", /Fracture/, G)), subject_id: G }),
      certSentence(v, G, "Grace"), rowsSentence(v, G, LEG), noteSentence(v, G),
    ])],
    askRetry,
  ] },
];
/** A child on two other policies: no leg row (so "Other fracture" applies) and a calendar-day hospital cash rule. */
const CAPABLE_KAI: ScriptTurn[] = [
  { user: "Kai", steps: [
    () => [call("resolve_person", { mention: "Kai" })],
    () => [call("note_facts", { subject_id: K, facts: [{ key: "injury", value: "broke his leg", words: "broke his leg" }, { key: "how_it_happened", value: "fell at the playground", words: "Kai fell at the playground" }, { key: "nights_in_hospital", value: "2", words: "was in hospital for two nights" }] }),
      call("policies_for", { subject_id: K }), sel("JUNIOR", "Other fracture", K), sel("JUNIOR", "Hospital cash (per day)", K), sel("FAMILY", "Fracture (per fracture, any bone)", K),
      call("search_passages", { query: "hospital cash each day or part of a day admission discharge", subject_id: K })],
    (v) => [call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: K, policy_id: doc("JUNIOR").id, benefit: "Hospital cash (per day)", rate_value_id: vid(v, "JUNIOR", /Hospital cash/, K) })],
    (v) => [call("ask_user", { kind: "fact", subject_id: K, fact_key: "admission_datetime", question: "On which dates was Kai admitted and discharged?", because_evidence_ids: ids(hit(v, /each day or part of a day/)), statements: [
      S("Kai's JuniorCare Accident Plan has no row for a leg fracture; its Other fracture row lists S$300.", { value_ids: ids(vid(v, "JUNIOR", /Other fracture/, K)), subject_id: K }),
      S("Kai's FamilyShield Accident Plan lists S$400 per fracture, any bone, in its Child column.", { value_ids: ids(vid(v, "FAMILY", /Fracture/, K)), subject_id: K }),
      S("JuniorCare's hospital cash is S$50 per day, counting each day or part of a day in hospital including the day of admission and the day of discharge, up to 30 days per Accident.", { value_ids: ids(vid(v, "JUNIOR", /Hospital cash/, K)), evidence_ids: ids(hit(v, /each day or part of a day/)), subject_id: K }),
    ] })],
    askRetry,
  ] },
];

// ------------------------------------------------------------------ grading
type Expect = { user: string; include?: (string | RegExp)[]; any?: (string | RegExp)[][]; exclude?: (string | RegExp)[]; question?: RegExp | null; cites?: string[] };
type Conv = { id: string; title: string; script: ScriptTurn[]; turns: Expect[]; whole?: { include?: (string | RegExp)[]; exclude?: (string | RegExp)[]; maxRepeats?: [RegExp, number][] } };
const lit = (s: string | RegExp) => (typeof s === "string" ? new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (/\d$/.test(s) ? "(?![\\d,]*\\d)" : ""), "i") : s);
/** Never shown anywhere in these conversations: verifier text, ids, a false correction, an approval, a current-cover verdict. */
const NEVER: RegExp[] = [/cited page|figure is not bound|save-time|evidence id|\bvalue id\b|\b[evr]\d+\b/, /\bUpdated:|you said [^.]* at first/i, /\bapproved\b(?! amount)|\byou will (?:get|receive)\b|\bis covered\b|\bcurrently covered\b|\bcover in force\b/i, /S\$500,000|S\$250,000|S\$150,000 sum|S\$800,000|S\$900,000/];
const CERT_DATE = /1 July 2025|01\/07\/2025/;

const CONVS: Conv[] = [
  { id: "R1", title: "reported conversation, capable model", script: CAPABLE_REPORTED,
    turns: [
      { user: "Desmond broke his leg.", include: ["S$300,000", CERT_DATE, "10%", "6%", "4%"], question: /how/i, cites: ["CERT:1", "PA_WORD:1"] },
      { user: "He fell down the stairs.", question: /X-ray/i },
      { user: "Yes, confirmed with an X-ray. He was also warded for two nights.", include: ["S$300,000", "S$18,000", "S$9,000", "S$30,000", "S$15,000", "S$12,000", "S$6,000", /simple \(closed\)/i, "S$100", /complete period of 24 hours/i, /two nights/i, /admission and discharge times/i], exclude: ["S$200", /\b1%|Other fracture/i, "S$3,000"], question: /which bone/i, cites: ["CERT:1", "PA_WORD:1", "PA_WORD:2"] },
      { user: "Transverse fracture.", include: [/transverse/i, /bone/i, /simple \(closed\)|compound \(open\)/i], exclude: [/\b1%|Other fracture/i, "S$3,000", "S$1,500"], question: /which bone/i },
    ],
    whole: { maxRepeats: [[/your own account/i, 1], [/include the doctor|claim form/i, 1], [/50% of the percentage shown/i, 2]] } },
  { id: "R2", title: "reported conversation, minimal (live-shape) model", script: MINIMAL_REPORTED,
    turns: [
      { user: "Desmond broke his leg.", question: /how/i },
      { user: "He fell down the stairs.", question: /X-ray/i },
      { user: "Yes, confirmed with an X-ray. He was also warded for two nights.", question: /simple|closed/i },
      { user: "Transverse fracture.", include: [/transverse/i, "S$100", /complete period of 24 hours/i, "S$300,000", CERT_DATE], exclude: [/\b1%|Other fracture/i, "S$200", /haven['’]t yet read/i], question: /simple|closed/i, cites: ["PA_WORD:2", "CERT:1"] },
    ],
    whole: { maxRepeats: [[/your own account/i, 1], [/include the doctor|claim form/i, 1]] } },
  { id: "R3", title: "reported conversation, minimal model that follows the repair", script: RESPONSIVE_REPORTED,
    turns: [
      { user: "Desmond broke his leg.", question: /how/i },
      { user: "He fell down the stairs.", question: /X-ray/i },
      { user: "Yes, confirmed with an X-ray. He was also warded for two nights.", question: /simple|closed/i },
      { user: "Transverse fracture.", include: [/transverse/i, "S$300,000", CERT_DATE, "S$18,000", "S$9,000", "S$100", /complete period of 24 hours/i], exclude: [/\b1%|Other fracture/i, "S$200"], question: /which bone/i, cites: ["CERT:1", "PA_WORD:1", "PA_WORD:2"] },
    ],
    whole: { maxRepeats: [[/your own account/i, 1], [/include the doctor|claim form/i, 1]] } },
  { id: "P1", title: "paraphrase: shin bone, closed fracture, stay with times", script: CAPABLE_PARAPHRASE,
    turns: [
      { user: "My husband Desmond fractured his shin bone, he slipped on the stairs at home.", include: ["S$300,000", "6%"], question: /X-ray/i },
      { user: "Yes, the X-ray showed it, it's a closed fracture, and he stayed two nights in the ward.", include: ["S$9,000", /simple \(closed\)/i, "S$100", /complete period of 24 hours/i], exclude: ["S$18,000", "S$200", /\bwhich bone\b/i], question: /admitted/i },
      { user: "He was admitted at 9pm on 3 October and discharged at 11am on 5 October.", include: [/indicative estimate/i, "S$100"], exclude: ["S$200"], question: null },
    ] },
  { id: "P2", title: "other person: Grace (her own certificate row; a flat any-bone policy)", script: CAPABLE_GRACE,
    turns: [{ user: "My wife Grace broke her leg, she fell off a ladder.", include: ["S$800", "S$200,000", CERT_DATE, "10%", "6%", "4%"], exclude: ["S$300,000", "S$400"], question: /which bone/i, cites: ["FAMILY:1", "CERT:1", "PA_WORD:1"] }] },
  { id: "P3", title: "other person: Kai (no leg row, so Other fracture; calendar-day hospital cash)", script: CAPABLE_KAI,
    turns: [{ user: "Kai fell at the playground and broke his leg; he was in hospital for two nights.", include: ["S$300", /Other fracture/i, "S$400", "S$50", /day of admission and the day of discharge/i], exclude: ["S$100", "S$300,000", "S$200,000", /which bone/i], question: /dates/i, cites: ["JUNIOR:1", "FAMILY:1"] }] },
];

function grade(t: Expect, a: ChatAnswer): string[] {
  const text = visible(a);
  const p: string[] = [];
  for (const s of t.include ?? []) if (!lit(s).test(text)) p.push(`missing ${String(s)}`);
  for (const s of t.exclude ?? []) if (lit(s).test(text)) p.push(`must not include ${String(s)}`);
  for (const r of NEVER) if (r.test(text)) p.push(`shows ${text.match(r)![0]}`);
  // A reply made only of say-back ("You told me ...") with no question is an echo, never a completed turn.
  const substantive = [a.summary, ...a.details].join(" ").split(/(?<=[.!?”])\s+/).filter((x) => x.trim() && !/^\s*you (?:told me|said)\b/i.test(x));
  if (!substantive.length && !(a.questions ?? []).length) p.push("the reply only echoes what the household said");
  const q = a.questions ?? [];
  if (t.question === null && q.length) p.push(`asked a question it should not: ${q[0].text}`);
  if (t.question && (q.length !== 1 || !t.question.test(q[0].text))) p.push(`expected one question like ${t.question}, got ${q.map((x) => x.text).join(" | ") || "none"}`);
  const cited = new Set((a.citations ?? []).map((c) => `${docKey(c.policyId)}:${c.pageStart}`));
  for (const c of t.cites ?? []) if (!cited.has(c)) p.push(`no citation of ${c}`);
  return p;
}

async function play(h: Harness, conv: Conv, lines: string[]) {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  installLoopModel(new ScriptedLoopModel(conv.script));
  let c: { id?: string; rev?: number } = {};
  const failures: string[] = [], shown: string[] = [];
  const out: { answer: ChatAnswer; trace: any; state: any }[] = [];
  try {
    for (const [i, t] of conv.turns.entries()) {
      const answer = await h.send(t.user, c);
      c = { id: answer.conversationId, rev: answer.conversationRevision };
      const saved = await h.savedAnswer(c.id!);
      const trace = saved.state.ragLoop?.turns.at(-1);
      out.push({ answer: saved.answer, trace, state: saved.state });
      const problems = grade(t, saved.answer);
      shown.push(visible(saved.answer));
      const facts = saved.state.ragLoop?.claim?.facts ?? {};
      lines.push(`USER: ${t.user}`, `APP:  ${visible(saved.answer).replace(/\n/g, "\n      ")}`,
        `      cites=${[...new Set((saved.answer.citations ?? []).map((x) => `${docKey(x.policyId)}:${x.pageStart}`))].join(",")} steps=${trace?.steps} gate=${JSON.stringify(trace?.gate ?? [])}`,
        `      facts: ${Object.entries(facts).map(([k, f]: [string, any]) => `${k}=${f.value}${f.previous?.length ? ` [corrected from ${f.previous.at(-1).value}]` : ""}`).join("; ")}`,
        ...((saved.answer as any).calculations ?? []).map((r: any) => `      calc: ${r.benefit} ${r.kind} ${r.result?.value} ${r.currency}`),
        ...(trace?.toolCalls ?? []).filter((x: any) => !x.ok).map((x: any) => `      ! ${x.name}: ${String(x.error ?? "").slice(0, 600)}`),
        ...(trace?.dropped ?? []).map((d: any) => `      - dropped: ${d.sentence} -- ${d.reason}`),
        problems.length ? `      GRADE: FAIL -- ${problems.join("; ")}` : "      GRADE: pass");
      if (problems.length) failures.push(`turn ${i + 1} (“${t.user}”): ${problems.join("; ")}`);
    }
  } catch (e) { failures.push("error: " + (e instanceof Error ? e.message : String(e))); }
  finally { installLoopModel(null); }
  // Whole visible conversation: a caveat or paperwork line is not repeated turn after turn.
  const all = shown.join("\n");
  for (const [re, max] of conv.whole?.maxRepeats ?? []) { const n = shown.filter((s) => re.test(s)).length; if (n > max) failures.push(`whole conversation: ${re} shown in ${n} turns (at most ${max})`); }
  for (const s of conv.whole?.include ?? []) if (!lit(s).test(all)) failures.push(`whole conversation: missing ${String(s)}`);
  return { failures, out };
}

async function main() {
  const h: Harness = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const transcripts: string[] = [];
  const played = new Map<string, Awaited<ReturnType<typeof play>>>();
  for (const conv of CONVS) {
    const lines = [`### ${conv.id} ${conv.title}`];
    const r = await play(h, conv, lines);
    played.set(conv.id, r);
    transcripts.push(lines.join("\n"));
    await check(`${conv.id} ${conv.title}`, () => assert.deepEqual(r.failures, []));
  }

  // ---------------------------------------------------------------- controls
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const run = async (script: ScriptTurn[], users: string[]) => {
    installLoopModel(new ScriptedLoopModel(script));
    let c: { id?: string; rev?: number } = {}; const turns: { answer: ChatAnswer; state: any; trace: any }[] = [];
    try { for (const u of users) { const a = await h.send(u, c); c = { id: a.conversationId, rev: a.conversationRevision }; const s = await h.savedAnswer(c.id!); turns.push({ answer: s.answer, state: s.state, trace: s.state.ragLoop?.turns.at(-1) }); } }
    finally { installLoopModel(null); }
    return turns;
  };
  const noteTurn = (facts: Record<string, string>[], words?: string) => ({ steps: [() => [call("note_facts", { subject_id: D, facts })], () => [call("final_answer", { subject_id: D, sentences: [S(words ?? "You told me that.")] })]] });

  await check("CONTROL facts: an added detail is not a correction; a stated correction (or a changed count) still is", async () => {
    const t = await run([
      { steps: [() => [call("resolve_person", { mention: "Desmond" })], () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his leg", words: "Desmond broke his leg" }, { key: "nights_in_hospital", value: "2", words: "warded for two nights" }] })], () => [call("final_answer", { subject_id: D, sentences: [S("You told me Desmond broke his leg.")] })]] },
      noteTurn([{ key: "injury", value: "transverse fracture", words: "Transverse fracture." }]),
      noteTurn([{ key: "injury", value: "broke his arm", words: "sorry, it was his arm, not his leg" }]),
      noteTurn([{ key: "nights_in_hospital", value: "3", words: "three nights" }]),
    ], ["Desmond broke his leg and was warded for two nights.", "Transverse fracture.", "Sorry, it was his arm, not his leg.", "It was three nights."]);
    const f1 = t[1].state.ragLoop.claim.facts;
    assert.equal(f1.injury.value, "broke his leg", "the first report is kept");
    assert.ok(Object.values(f1).some((f: any) => f.value === "transverse fracture" && !f.previous?.length), "the detail is recorded as its own fact: " + JSON.stringify(f1));
    assert.ok(!/Updated:|at first/.test(visible(t[1].answer)), "an added detail was shown as a correction: " + visible(t[1].answer));
    assert.match(visible(t[2].answer), /Updated: injury is now broke his arm/);
    assert.match(visible(t[3].answer), /Updated: nights in hospital is now 3/);
  });

  await check("CONTROL calculator: the wording's simple-fracture share is applied only from a quote printing it on that policy", async () => {
    const pct = (v: ScriptView) => ({ calculator: "lump_sum", purpose: "claim", subject_id: D, policy_id: doc("PA_WORD").id, benefit: ROWS.lower.label, sum_insured_value_id: vid(v, "CERT", /Personal Accident/, D), percent_value_id: vid(v, "PA_WORD", /tibia/, D), assumption_words: "Desmond broke his leg", condition: "a fracture of the lower leg (tibia or fibula), simple (closed)" });
    const bad = [
      { page: 1, quote: NOTE_QUOTE, percent: 40, applies_when: "a simple (closed) fracture" }, // not the printed share
      { page: 1, quote: "For a simple fracture 50% is paid", percent: 50, applies_when: "a simple (closed) fracture" }, // not on the page
      { page: 2, quote: NOTE_QUOTE, percent: 50, applies_when: "a simple (closed) fracture" }, // another page
    ];
    const t = await run([{ steps: [
      () => [call("resolve_person", { mention: "Desmond" })],
      () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his leg", words: "Desmond broke his leg" }] }), ...paLookups(D, ["lower"])],
      (v) => [call("calculate", { ...pct(v), proportion: { page: 1, quote: NOTE_QUOTE, percent: 50, applies_when: "a simple (closed) fracture" } }), ...bad.slice(0, 2).map((p) => call("calculate", { ...pct(v), proportion: p }))],
      (v) => [call("final_answer", { subject_id: D, sentences: lumpSentences(v, D) })],
    ] }, { steps: [
      () => paLookups(D, ["lower"]),
      (v) => [call("calculate", { ...pct(v), proportion: bad[2] })],
      () => [call("final_answer", { subject_id: D, sentences: [S("You told me Desmond broke his leg.")] })],
    ] }], ["Desmond broke his leg.", "And for a simple fracture?"]);
    const calls = [...t[0].trace.toolCalls, ...t[1].trace.toolCalls].filter((x: any) => x.name === "calculate");
    assert.deepEqual(calls.map((x: any) => x.ok), [true, false, false, false], JSON.stringify(calls.map((x: any) => x.error ?? "ok")));
    assert.match(String(calls[1].error), /not printed in the quote/); assert.match(String(calls[2].error), /not on that page/); assert.match(String(calls[3].error), /not on that page/);
    assert.match(visible(t[0].answer), lit("S$9,000"));
    const rec = (t[0].answer as any).calculations?.[0];
    assert.ok(rec && rec.steps.length === 2 && rec.operands.filter((o: any) => o.source === "document").length === 3, "the record carries the share as a document operand and its own step");
    // The save-time gate re-runs it: a tampered share is rejected.
    const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
    const tampered = structuredClone(t[0].answer) as any;
    tampered.calculations[0].operands.find((o: any) => o.value === 50).value = 60;
    const problems = await verifyAnswerFigures(tampered, { accountId: HH.ACCOUNT, userText: "Desmond broke his leg.", report: true, priorUserTexts: [] });
    assert.ok(problems.length > 0, "a tampered share passed the save-time gate");
  });

  await check("CONTROL certificate link: the sum insured is the person's own row under the wording's product, on the current certificate", async () => {
    const t = await run([{ steps: [
      () => [call("resolve_person", { mention: "Desmond" })],
      () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his leg", words: "Desmond broke his leg" }] }), ...paLookups(D, ["lower"]), sel("CERT", "Group Term Life", D), call("select_table_value", { policy_id: doc("CERT_OLD").id, benefit: "Group Personal Accident", subject_id: D, want: "amount" }), call("select_table_value", { policy_id: doc("OTHER").id, benefit: "Group Personal Accident", subject_id: D, want: "amount" })],
      (v) => { const base = { calculator: "lump_sum", purpose: "claim", subject_id: D, policy_id: doc("PA_WORD").id, benefit: ROWS.lower.label, percent_value_id: vid(v, "PA_WORD", /tibia/, D), assumption_words: "Desmond broke his leg", condition: "a fracture of the lower leg (tibia or fibula), compound (open)" };
        return [call("calculate", { ...base, sum_insured_value_id: vid(v, "CERT", /Term Life/, D) }), call("calculate", { ...base, sum_insured_value_id: vid(v, "CERT", /Personal Accident/, D) })]; },
      (v) => [call("final_answer", { subject_id: D, sentences: lumpSentences(v, D) })],
    ] }], ["Desmond broke his leg."]);
    const tc = t[0].trace.toolCalls;
    const sels = tc.filter((x: any) => x.name === "select_table_value");
    const read = (x: any) => x.ok && /"status":"ok"/.test(String(x.summary ?? ""));
    assert.ok(!read(sels.at(-2)), "the superseded certificate was read"); assert.ok(!read(sels.at(-1)), "another household's certificate was read");
    const calcs = tc.filter((x: any) => x.name === "calculate");
    assert.deepEqual(calcs.map((x: any) => x.ok), [false, true], JSON.stringify(calcs.map((x: any) => x.error ?? "ok")));
    assert.match(String(calcs[0].error), /printed under “Group Term Life”/);
    const shown = visible(t[0].answer);
    assert.ok(lit("S$18,000").test(shown) && !/S\$30,000|S\$15,000/.test(shown), "the illustration does not rest on the Group Personal Accident row: " + shown);
  });

  await check("CONTROL fallback after the one repair: only the calculation the reply tried to state is rendered from its record", async () => {
    const calcs = (v: ScriptView) => lumpCalls(v, D, LEG, "Desmond broke his leg", false);
    const lowerId = (v: ScriptView) => v.turn.find((o) => o.name === "calculate" && o.ok && /tibia/.test(String(o.args.benefit)))!.result.data.calc_id;
    const noIf = (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [S("Desmond's certificate lists a Group Personal Accident sum insured of S$300,000 as of 1 July 2025.", { value_ids: ids(vid(v, "CERT", /Personal Accident/, D)), subject_id: D }), S("On those facts the conditional illustration for the lower leg is S$18,000.", { result_id: lowerId(v), subject_id: D })] })];
    const t = await run([
      { steps: [() => [call("resolve_person", { mention: "Desmond" })], () => [call("note_facts", { subject_id: D, facts: [{ key: "injury", value: "broke his leg", words: "Desmond broke his leg" }] }), ...paLookups(D, LEG)], calcs, noIf, noIf] },
      { steps: [() => [call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "fell down the stairs", words: "He fell down the stairs" }] }), ...paLookups(D, LEG)], calcs, (v) => [call("final_answer", { subject_id: D, sentences: [S("On the documents, the fracture rows differ by bone.", { evidence_ids: ids(hit(v, /Fracture of thigh bone|% of Sum Insured/)), subject_id: D })] })], (v) => [call("final_answer", { subject_id: D, sentences: [S("On the documents, the fracture rows differ by bone.", { evidence_ids: ids(hit(v, /Fracture of thigh bone|% of Sum Insured/)), subject_id: D })] })]] },
    ], ["Desmond broke his leg.", "He fell down the stairs."]);
    const a1 = t[0].answer as any, v1 = visible(t[0].answer);
    assert.match(v1, /\bIf\b[^.]*S\$18,000(?![\d,]*\d)/, "the attempted lower-leg illustration was not rendered: " + v1);
    assert.ok(!/S\$30,000|S\$12,000/.test(v1), "an exploratory femur / kneecap illustration was resurrected: " + v1);
    assert.deepEqual((a1.calculations ?? []).map((r: any) => r.result.value), [18000]);
    assert.ok(t[0].trace?.incomplete?.some((x: string) => /stated from its own record/.test(x)), "the restored turn is not marked in its trace");
    // Several resolved calculations and none attempted: nothing is chosen for the household.
    assert.ok(!((t[1].answer as any).calculations ?? []).length, "an unattempted calculation was chosen among several: " + visible(t[1].answer));
  });

  // The one bounded lookup the grounded fallback makes when a reply gives a percentage of the Sum Insured with no amount.
  const pctOnly = (who: string, name: string, words: string, injury: string) => {
    const reply = (v: ScriptView) => [call("final_answer", { subject_id: who, sentences: [S(`The Schedule of Compensation lists the lower leg (tibia or fibula) at 6% of the Sum Insured for ${name}.`, { value_ids: ids(vid(v, "PA_WORD", /tibia/, who)), subject_id: who })] })];
    return { steps: [() => [call("resolve_person", { mention: name })], () => [call("note_facts", { subject_id: who, facts: [{ key: "injury", value: injury, words }] }), sel("PA_WORD", ROWS.lower.label, who, "percent")], reply, reply] } as ScriptTurn;
  };
  const byFallback = (t: any) => (t.trace?.toolCalls ?? []).filter((x: any) => /grounded fallback/.test(String(x.args?.by ?? "")));
  await check("CONTROL lookup: one valid certificate -- its dated Personal Accident row for THIS person (never Term Life, the superseded or another household's)", async () => {
    const [d] = await run([pctOnly(D, "Desmond", "Desmond broke his leg", "broke his leg")], ["Desmond broke his leg."]);
    const v = visible(d.answer);
    assert.match(v, /S\$300,000(?![\d,]*\d)[^.]*1 July 2025/, v);
    for (const f of ["S$500,000", "S$250,000", "S$800,000", "S$200,000"]) assert.ok(!lit(f).test(v), f + " shown: " + v);
    assert.ok(!/haven['’]t yet read/i.test(v), v);
    assert.ok(byFallback(d).length >= 2 && byFallback(d).length <= 4, "the lookup is not bounded: " + JSON.stringify(byFallback(d).map((x: any) => x.name)));
    assert.deepEqual(d.trace?.gate ?? [], []);
    const b = (d.answer.figureBindings ?? []).find((x: any) => x.value === 300000);
    assert.ok(b && /personal accident/i.test(b.benefit) && b.subjectId === D && docKey(b.policyId) === "CERT", JSON.stringify(b));
    const [g] = await run([pctOnly(G, "Grace", "Grace broke her leg", "broke her leg")], ["Grace broke her leg."]);
    const vg = visible(g.answer);
    assert.match(vg, /S\$200,000(?![\d,]*\d)/, "Grace's own row: " + vg); assert.ok(!lit("S$300,000").test(vg), "Desmond's amount for Grace: " + vg);
  });
  await check("CONTROL lookup: two current certificates printing the product for the person -- ambiguous, never the first; one grounded question", async () => {
    const c = HH.doc("CERT"); const dupId = "7c000000-0000-4000-8000-000000000199";
    await h.db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date,document_date) VALUES($1,$2,$3,$4,'Meridian Public Service Group Scheme - Certificate (reissued)',$5,$6,$7,'schedule',true,'ready','cert-b.pdf','cert-b.pdf','scan_clean','active','sha256:scenario-cert-b','2025-07-01','2025-07-01')`, [dupId, HH.ACCOUNT, c.owner, c.insurer, c.policyNumber, c.groupPolicyNumber, c.policyType]);
    for (const m of c.members) await h.db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [dupId, m.id, HH.ACCOUNT]);
    await h.db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [HH.ACCOUNT, dupId, String(c.pages[1]).replace(/S\$300,000/, "S$350,000")]);
    try {
      const [d] = await run([pctOnly(D, "Desmond", "Desmond broke his leg", "broke his leg")], ["Desmond broke his leg."]);
      const v = visible(d.answer);
      assert.ok(!lit("S$300,000").test(v) && !lit("S$350,000").test(v), "an amount was picked: " + v);
      assert.match(v, /more than one current document/i, v);
      assert.equal((d.answer.questions ?? []).length, 1); assert.match(d.answer.questions![0].text, /current certificate/i);
    } finally {
      for (const t of ["policy_pages", "policy_members"]) await h.db.query(`DELETE FROM ${t} WHERE policy_id=$1`, [dupId]);
      await h.db.query("DELETE FROM policies WHERE id=$1", [dupId]);
    }
  });
  await check("CONTROL lookup: not made for an ordinary question that needs no certificate amount", async () => {
    const [d] = await run([{ steps: [() => [call("resolve_person", { mention: "Desmond" })], () => [sel("PA_WORD", ROWS.patella.label, D, "percent")], (v) => [call("final_answer", { subject_id: D, sentences: [S("The Schedule of Compensation lists a fracture of the kneecap (patella) at 4% of the Sum Insured.", { value_ids: ids(vid(v, "PA_WORD", /patella/, D)), subject_id: D })] })]] }], ["What percentage does the schedule list for a kneecap fracture?"]);
    assert.equal(byFallback(d).length, 0, "a lookup was made for an ordinary question");
    assert.match(visible(d.answer), /4%/); assert.ok(!/sum insured as S\$/i.test(visible(d.answer)));
  });

  await check("CONTROL hospital days: two nights under a complete-24-hours rule is not two payable days", () => {
    const p1 = played.get("P1")!;
    const r = (p1.out[2]?.answer as any)?.calculations?.find((x: any) => /Hospital Income/i.test(x.benefit));
    assert.ok(r, "no hospital calculation on the stay with times");
    assert.equal(r.result.value, 100, "admitted 9pm 3 Oct, discharged 11am 5 Oct is 38 hours: one complete 24-hour period");
    const r1 = played.get("R1")!;
    assert.ok(!(r1.out[2]?.answer as any)?.calculations?.some((x: any) => /Hospital Income/i.test(x.benefit)), "a hospital figure was given for 'two nights' without times");
  });

  await check("CONTROL repair attempts (separate from what is shown): each turn's one repair names the unaddressed stay and the certificate link, and the fallback is marked incomplete", () => {
    const r2 = played.get("R2")!;
    const repairs = r2.out.map((o) => (o.trace?.toolCalls ?? []).filter((x: any) => (x.name === "final_answer" || x.name === "ask_user") && !x.ok).map((x: any) => String(x.error ?? "")).join(" | "));
    assert.ok(repairs.every((x, i) => i === 0 || x), "a turn after the first had no repair: " + JSON.stringify(repairs.map((x) => x.slice(0, 80))));
    assert.match(repairs[2], /warded for two nights/i, "turn 3's repair does not name the hospital stay: " + repairs[2]);
    assert.ok(repairs.some((x) => /sum insured/i.test(x)), "no repair asks for the certificate amount behind the percentage");
    assert.ok(repairs.filter(Boolean).every((x) => !/try again|retry/i.test(x)), "a repair invites unlimited retries");
    const steps = r2.out.map((o) => o.trace?.steps ?? 0);
    assert.ok(steps.every((n) => n <= 4), "a fallback turn used more model steps than one repair allows: " + steps.join(","));
    assert.ok(r2.out[3]?.trace?.incomplete?.length, "the completed-by-fallback turn is not marked incomplete in its trace");
    assert.equal(r2.out[3]?.trace?.outcome, "ask_user", "the fallback turn was saved as a completed final answer");
  });

  await check("CONTROL category: a detail the schedule does not use is not mapped to its catch-all row", () => {
    for (const id of ["R1", "R2", "R3"]) {
      const last = played.get(id)!.out.at(-1);
      const text = last ? visible(last.answer) : "";
      assert.ok(!/Other fracture|\b1%/.test(text), `${id}: transverse shown as "Other fracture": ${text}`);
      assert.ok(!((last?.answer as any)?.calculations ?? []).some((x: any) => /Other fracture/i.test(x.benefit)), `${id}: an Other-fracture calculation`);
    }
  });

  if (process.env.RELEASE_TRANSCRIPT) console.log("\n" + transcripts.join("\n\n"));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nscenario completion ${results.length - failed.length}/${results.length} conversations and controls passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

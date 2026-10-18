/**
 * Death-journey live batch grader (grader v1, written and frozen BEFORE any paid call; pre-registered in
 * docs/rag-migration/reliable-chat/EXPECTED-death-journey.md, "Live batch addendum"). It reads the COMPLETE saved answer of every
 * turn -- summary, details, questions, every next step -- and fails on each of: a missing or mis-attributed amount, a missing
 * date, a lost or unscoped condition, a borrowed fracture / dismemberment condition, invented paperwork, a payment promise,
 * a budget-only dead end, an unnecessary question, a raw internal identifier, and any difference between the returned answer
 * and the saved one. A grader PASS never overrides reading the transcript; the transcripts are read separately.
 *
 * Household: DJR (death-journey-actual-values.ts) -- Daniel's certificate rows Group Term Life S$1,000,000 and Group Personal
 * Accident S$600,000, both "As of" 06/10/2022 (6 October 2022); Grace's own rows are S$200,000 / S$100,000.
 */
import { uniqueSteps } from "../../components/next-steps";

type Check = { id: string; dim: "C" | "K" | "S" | "U"; name: string; ok: boolean; detail?: string };
export type Graded = { scenario: string; verdict: "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE"; checks: Check[]; note: string | null };
export const DEATH_GRADER_VERSION = "death-v1";

const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const BUDGET = /model-use (?:budget|limit)|budget set for this test run|run_budget|no room to write the answer/i;
const NOT_CONFIRMED = /couldn['’]t (?:confirm|finish|work out)|could not confirm|assistant model returned an error|I stopped before finishing|haven['’]t (?:stated|given)/i;
const CUT_QUOTE = /[“"][^”"]*\b(?:which|and|or|of|the|to|that|if|an?|by|with|for)\s*[”"]/i;
const ORPHAN = /^(?:[a-z]|(?:Says|Said|Requires|Requiring|Payable only|And|But|That|It says)\b)/m;
const PROMISE = /\b(?:will (?:pay|receive|get)|you(?:'ll| will) be paid|is payable to you|guarantee[sd]?|entitled to)\b/i;
const RAW_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|evidence_id|\bev_[a-z0-9]+|benefit_id|\bpolicy_id|\bfact_key|\bsubject_id|\boption_id/i;
/** paperwork / parties the fixture's pages do not print (the booklet prints "proof of death and the relevant documents in our prescribed form") */
const INVENTED = /death certificate|probate|letters of administration|grant of|nominee|beneficiary (?:form|designation)|police report|coroner|within \d+ (?:days|months) of (?:the )?(?:death|claim)|claim form must be (?:filed|submitted)/i;
const CURRENT_COVER = /\b(?:is|are|remains?) (?:currently|still) (?:covered|insured|in force)|currently (?:covered|insured|in force)|cover is (?:in force|active)\b|was covered at the time/i;
const FRACTURE_OR_DISMEMBERMENT = /Dismemberment|Loss of (?:one|two)|Simple Fracture|Other Fracture|Fracture Benefit|S\$5,000\b|S\$3,750|S\$2,500\b/i;
const lines = (v: string) => v.split("\n").filter(Boolean);
const ends = (l: string) => /[.?!:]["”’)]?$/.test(l.trim());
const balanced = (l: string) => (l.match(/“/g) ?? []).length === (l.match(/”/g) ?? []).length && (l.match(/\(/g) ?? []).length === (l.match(/\)/g) ?? []).length;
const J = (x: unknown): string => JSON.stringify(x) ?? "undefined";
const contact = (v: string) => /Contact Aldermoor Life Ltd/i.test(v);

function base(conv: any) {
  const turns = ((conv?.loaded?.turns ?? []) as any[]).map((t: any, i: number) => ({ answer: t.answer, trace: conv?.saved?.traces?.[i] ?? null, v: visibleOf(t.answer), shown: conv?.turns?.[i]?.visible ?? null }));
  const refused = (conv?.turns ?? []).some((t: any) => (t.calls ?? []).some((c: any) => c.refused) || (t.httpCalls ?? []).some((c: any) => c.refused));
  const blocked = refused ? "a model call was refused by the run-cap guard" : null;
  const wanted = (conv?.turns ?? []).length;
  return { turns, blocked, incomplete: !turns.length || turns.length < wanted || turns.some((t) => !t.answer) ? `saved answers for ${turns.length} of ${wanted} turns` : null };
}
function finish(scenario: string, checks: Check[], b: ReturnType<typeof base>): Graded {
  if (b.blocked) return { scenario, verdict: "BLOCKED", checks, note: b.blocked };
  if (b.incomplete && !checks.length) return { scenario, verdict: "INCOMPLETE", checks, note: b.incomplete };
  return { scenario, verdict: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks, note: b.incomplete };
}
/** checks every journey shares */
function common(b: ReturnType<typeof base>): Check[] {
  const all = b.turns.map((t) => t.v).join("\n");
  return [
    { id: "G1", dim: "C", name: "no budget-only dead end, refusal or “couldn't confirm” text, and no model error", ok: !BUDGET.test(all) && !NOT_CONFIRMED.test(all), detail: all.slice(0, 900) },
    { id: "G2", dim: "C", name: "no unfinished clause: no cut quotation, no orphan fragment, every line ends as a sentence or a question", ok: !CUT_QUOTE.test(all) && !ORPHAN.test(all) && lines(all).every((l) => ends(l) && balanced(l)), detail: lines(all).filter((l) => !(ends(l) && balanced(l)) || ORPHAN.test(l) || CUT_QUOTE.test(l)).join(" ⏎ ").slice(0, 700) },
    { id: "G3", dim: "S", name: "no payment promise", ok: !PROMISE.test(all.replace(/not a payment[^.]*/gi, "")), detail: all.slice(0, 600) },
    { id: "G4", dim: "S", name: "no raw internal identifier", ok: !RAW_ID.test(all), detail: (all.match(RAW_ID) ?? [""])[0] },
    { id: "G5", dim: "S", name: "no invented paperwork, deadline or party", ok: !INVENTED.test(all), detail: (all.match(INVENTED) ?? [""])[0] },
    { id: "G6", dim: "U", name: "returned = saved = displayed: the answer the browser was given equals the saved answer, whole", ok: b.turns.every((t) => t.shown != null && t.shown === t.v), detail: J(b.turns.map((t) => ({ saved: t.v.slice(0, 200), returned: String(t.shown ?? "").slice(0, 200) }))) },
    { id: "G7", dim: "U", name: "every saved next step is visible (none saved but not shown)", ok: b.turns.every((t) => uniqueSteps(t.answer?.nextSteps).every((s: string) => t.v.includes(s))), detail: J(b.turns.map((t) => t.answer?.nextSteps)) },
  ];
}
/** the sentence/line that states `amount`, so an amount is judged against what it is attached to */
const sentences = (v: string) => lines(v).flatMap((l) => l.split(/;\s+|(?<=[.?!])\s+(?=[A-Z“])/));
const lineWith = (v: string, re: RegExp) => sentences(v).filter((l) => re.test(l));

/** D: the broad death question about Daniel (D1, D2) and its paraphrase (D3) */
export function gradeDeath(id: string, conv: any): Graded {
  const b = base(conv); if (b.blocked || !b.turns.length) return finish(id, [], b);
  const v = b.turns.at(-1)!.v;
  const tl = lineWith(v, /1,000,000/), pa = lineWith(v, /600,000/);
  const q = (b.turns.at(-1)!.answer?.questions ?? []) as any[];
  const checks: Check[] = [...common(b),
    { id: "A1", dim: "K", name: "Daniel's Group Term Life S$1,000,000 is stated, on a line naming Term Life and Daniel (never Personal Accident)", ok: tl.some((l) => /Term Life/i.test(l) && /Daniel/.test(l)) && tl.every((l) => !/Personal Accident|Accidental Death/i.test(l) || /Term Life/i.test(l)), detail: J(tl) },
    { id: "A2", dim: "K", name: "Daniel's Group Personal Accident S$600,000 is stated, on a line naming Personal Accident (never as Term Life)", ok: pa.some((l) => /Personal Accident|Accidental Death/i.test(l) && /Daniel/.test(l)) && pa.every((l) => !/Term Life/i.test(l) || /Personal Accident/i.test(l)), detail: J(pa) },
    { id: "A3", dim: "K", name: "the certificate date is stated for the amounts (6 October 2022 / 06/10/2022) and the amounts are not presented as current cover", ok: /6 October 2022|06\/10\/2022|2022-10-06/.test(tl.concat(pa).join("\n") || v) && !CURRENT_COVER.test(v), detail: v.slice(0, 700) },
    { id: "A4", dim: "K", name: "the two amounts are separate (not added, not 'S$1,600,000', not 'in total/combined')", ok: !/1,600,000|in total|combined|added together|sum of the two/i.test(v.replace(/(?:not|never|cannot|can't)[^.\n]{0,80}(?:total|combined|together)/gi, "")), detail: v.slice(0, 700) },
    { id: "A5", dim: "K", name: "Grace's figures (S$200,000 / S$100,000) are not attached to Daniel", ok: lineWith(v, /200,000|S\$100,000\b/).every((l) => /Grace/.test(l)), detail: J(lineWith(v, /200,000|S\$100,000\b/)) },
    { id: "A6", dim: "K", name: "the accident-dependent benefits say they depend on an Accident (a conditional 'if / only if ... Accident' wording; the Compassionate Death Allowance paragraph names the Accident)", ok: /\b(?:if|only if|where|when|results? from|as a result of)\b[^.\n]{0,160}\bAccident/i.test(v) && lines(v).filter((l) => /Compassionate/.test(l)).every((l) => /Accident/i.test(l)), detail: J(lineWith(v, /Accident|Compassionate/)) },
    { id: "A7", dim: "K", name: "the Compassionate Death Allowance Benefit is named with its printed conditions (accident, proof of death / prescribed form, Core or Voluntary Scheme)", ok: /Compassionate Death Allowance/i.test(v) && /proof of death/i.test(v) && /prescribed form|relevant documents/i.test(v) && /Core Scheme/i.test(v) && /Voluntary Scheme/i.test(v), detail: J(lineWith(v, /Compassionate|Core Scheme|proof of death/)) },
    { id: "A8", dim: "K", name: "the booklet's bare $2,000 keeps its currency unstated (never S$2,000 for the booklet); the summary's S$2,000 may be said with the summary", ok: !/booklet[^\n]*S\$2,000/i.test(v) && (!/booklet[^\n]*2,000/i.test(v) || /bare|“\$”|does not say which currency|currency (?:is )?not stated|not (?:say|state) (?:which )?currency/i.test(v)), detail: J(lineWith(v, /2,000/)) },
    { id: "A9", dim: "K", name: "no dismemberment / fracture benefit, row, figure or window is evaluated or borrowed for a death question", ok: !FRACTURE_OR_DISMEMBERMENT.test(v), detail: (v.match(FRACTURE_OR_DISMEMBERMENT) ?? [""])[0] },
    { id: "A10", dim: "U", name: "a useful next step is visible: contact the person's own insurer (Aldermoor Life Ltd) about a claim, without an amount", ok: contact(v) && uniqueSteps(b.turns.at(-1)!.answer?.nextSteps).length >= 1 && uniqueSteps(b.turns.at(-1)!.answer?.nextSteps).every((s: string) => !/S\$\s?\d|\$\s?\d/.test(s)), detail: J(b.turns.at(-1)!.answer?.nextSteps) },
    { id: "A11", dim: "U", name: "no unnecessary question: the person (Daniel) and the event are known, so none is asked", ok: q.length === 0, detail: J(q) },
    { id: "A12", dim: "C", name: "complete, not a one-product answer: Term Life, Personal Accident and the Compassionate Death Allowance all appear", ok: /Term Life/i.test(v) && /Personal Accident/i.test(v) && /Compassionate Death Allowance/i.test(v), detail: v.slice(0, 500) },
  ];
  return finish(id, checks, b);
}
/** F1: the fracture condition + comparison control */
export function gradeFracture(id: string, conv: any): Graded {
  const b = base(conv); if (b.blocked || !b.turns.length) return finish(id, [], b);
  const v = b.turns.at(-1)!.v;
  const hip = lineWith(v, /3,750/);
  const checks: Check[] = [...common(b),
    { id: "F1", dim: "K", name: "the Simple Fracture hip illustration S$3,750 (75% of the S$5,000 limit) is stated as conditional, on a line naming Hip", ok: hip.some((l) => /Hip/.test(l) && /75%/.test(l) && /5,000/.test(l)) && hip.every((l) => /\bIf\b|conditional|illustration|would be|could be/i.test(l)), detail: J(hip) },
    { id: "F2", dim: "K", name: "the fracture's own condition is given (an Accident causing a Simple Fracture of the nature in the table) with no borrowed window or death/dismemberment text", ok: /Accident/.test(v) && !/365|Dismemberment|Loss of (?:one|two)|Group Term Life|Sum Assured/i.test(lines(v).filter((l) => /Simple Fracture/.test(l)).join("\n")), detail: J(lines(v).filter((l) => /Simple Fracture|365/.test(l))) },
    { id: "F3", dim: "K", name: "the fracture benefit is stated as separate from the death benefits (not added to or taken from them)", ok: /separate|different|own|not (?:part of|added|combined|the same)|independent/i.test(v) && !/1,000,000|600,000|1,600,000|in total|combined|added together/i.test(v.replace(/(?:not|never|cannot|can't)[^.\n]{0,80}(?:total|combined|together|added)/gi, "")), detail: v.slice(0, 700) },
    { id: "F4", dim: "U", name: "no unnecessary question about a hip fracture (hip is stated) and a visible contact step", ok: !((b.turns.at(-1)!.answer?.questions ?? []) as any[]).length && contact(v), detail: J(b.turns.at(-1)!.answer?.questions) },
  ];
  return finish(id, checks, b);
}
export const DEATH_GRADERS: Record<string, (id: string, conv: any) => Graded> = { D1: gradeDeath, D2: gradeDeath, D3: gradeDeath, F1: gradeFracture };

/** the grader's own controls: a synthetic good answer passes; each known-bad variant fails on the intended check */
export function deathControls(): [string, Graded, Graded["verdict"], string | null][] {
  const STEP = "Contact Aldermoor Life Ltd (through the employer or scheme administrator) to ask how to make a claim.";
  const GOOD = {
    summary: "Daniel's certificate prints Group Term Life of S$1,000,000, as of 6 October 2022. It is an amount dated 6 October 2022, not proof of current cover.",
    details: [
      "Daniel's certificate also prints Group Personal Accident of S$600,000, as of 6 October 2022; this is separate from the Term Life amount and is relevant only if his death results from an Accident (Accidental Death pays 100% of the Sum Insured if death follows within 365 days of the Accident).",
      "The booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to $2,000 (printed with a bare “$” sign; the document does not say which currency), if an Insured Person dies as a result of an Accident, on receipt of proof of death and the relevant documents in the insurer's prescribed form; it can only be claimed under the Core Scheme or the Voluntary Scheme.",
    ],
    nextSteps: [STEP], questions: [],
  };
  const mk = (a: any) => { const v = visibleOf(a); return { turns: [{ visible: v }], loaded: { turns: [{ answer: a }] }, saved: { traces: [{}] } }; };
  const mut = (f: (a: any) => any) => mk(f(JSON.parse(JSON.stringify(GOOD))));
  const text = (a: any, from: string, to: string) => { a.summary = a.summary.replace(from, to); a.details = a.details.map((d: string) => d.replace(from, to)); return a; };
  const F_GOOD = { summary: "If Daniel's hip is broken in an Accident, the Simple Fracture benefit gives a conditional illustration of S$3,750: Hip 75% of the S$5,000 Simple Fracture Benefit Limit.", details: ["The Simple Fracture benefit applies if bodily injury as a result of an Accident results in a Simple Fracture of the nature in the table. It is a separate benefit from the death benefits."], nextSteps: [STEP], questions: [] };
  const mkF = (a: any) => { const v = visibleOf(a); return { turns: [{ visible: v }], loaded: { turns: [{ answer: a }] }, saved: { traces: [{}] } }; };
  return [
    ["D good", gradeDeath("D1", mk(GOOD)), "PASS", null],
    ["D one-product answer (Personal Accident only) with the limit text", gradeDeath("D1", mk({ summary: "Daniel's certificate prints Group Personal Accident of S$600,000, as of 6 October 2022 (if death results from an Accident).", details: ["I stopped before finishing because this question's model-use limit was reached."], nextSteps: [STEP], questions: [] })), "FAIL", "G1"],
    ["D budget-only dead end", gradeDeath("D1", mk({ summary: "I could not finish: another search would leave no room to write the answer within this question's model-use limit.", details: [], nextSteps: [], questions: [] })), "FAIL", "G1"],
    ["D Term Life amount attached to Personal Accident", gradeDeath("D1", mut((a) => text(a, "Group Personal Accident of S$600,000", "Group Personal Accident of S$1,000,000"))), "FAIL", "A1"],
    ["D Personal Accident amount shown as Term Life", gradeDeath("D1", mut((a) => text(a, "Group Term Life of S$1,000,000", "Group Term Life of S$600,000"))), "FAIL", "A1"],
    ["D certificate date dropped", gradeDeath("D1", mut((a) => { a.summary = a.summary.replace(/, as of 6 October 2022\. It is an amount dated 6 October 2022, not proof of current cover/, ""); a.details[0] = a.details[0].replace(", as of 6 October 2022", ""); return a; })), "FAIL", "A3"],
    ["D presented as current cover", gradeDeath("D1", mut((a) => { a.summary += " Daniel is currently covered."; return a; })), "FAIL", "A3"],
    ["D amounts added together", gradeDeath("D1", mut((a) => { a.details.push("Together this is S$1,600,000."); return a; })), "FAIL", "A4"],
    ["D Grace's amount attached to Daniel", gradeDeath("D1", mut((a) => { a.details.push("Daniel's certificate also prints S$200,000."); return a; })), "FAIL", "A5"],
    ["D Compassionate Death Allowance dropped", gradeDeath("D1", mut((a) => { a.details.pop(); return a; })), "FAIL", "A7"],
    ["D Core / Voluntary condition lost (orphan removed clause)", gradeDeath("D1", mut((a) => text(a, "; it can only be claimed under the Core Scheme or the Voluntary Scheme", ""))), "FAIL", "A7"],
    ["D bare $2,000 shown as S$2,000 for the booklet", gradeDeath("D1", mut((a) => text(a, "up to $2,000 (printed with a bare “$” sign; the document does not say which currency)", "up to S$2,000"))), "FAIL", "A8"],
    ["D dismemberment schedule borrowed", gradeDeath("D1", mut((a) => { a.details.push("Total and Permanent Dismemberment: Loss of one leg pays 50% of the Sum Insured."); return a; })), "FAIL", "A9"],
    ["D fracture figure borrowed", gradeDeath("D1", mut((a) => { a.details.push("A Simple Fracture of the hip would pay S$3,750."); return a; })), "FAIL", "A9"],
    ["D invented paperwork", gradeDeath("D1", mut((a) => { a.nextSteps.push("Obtain the death certificate and a letter from the coroner."); return a; })), "FAIL", "G5"],
    ["D no next step", gradeDeath("D1", mut((a) => { a.nextSteps = []; return a; })), "FAIL", "A10"],
    ["D unnecessary question", gradeDeath("D1", mut((a) => { a.questions = [{ text: "Who is Daniel?" }]; return a; })), "FAIL", "A11"],
    ["D raw internal id", gradeDeath("D1", mut((a) => { a.details.push("See evidence_id ev_3f2a."); return a; })), "FAIL", "G4"],
    ["D payment promise", gradeDeath("D1", mut((a) => { a.details.push("The insurer will pay S$600,000 to the family."); return a; })), "FAIL", "G3"],
    ["D returned differs from saved", gradeDeath("D1", { ...mk(GOOD), turns: [{ visible: "S$600,000" }] }), "FAIL", "G6"],
    ["D saved next step not displayed", gradeDeath("D1", (() => { const c: any = mk(GOOD); c.turns[0].visible = c.turns[0].visible; c.loaded.turns[0].answer = { ...GOOD, nextSteps: [STEP, "Keep a copy of the certificate."] }; c.turns[0].visible = visibleOf(GOOD); return c; })()), "FAIL", "G6"],
    ["D cut quotation", gradeDeath("D1", mut((a) => { a.details.push("The booklet says “if an Insured Person dies as a result of an”."); return a; })), "FAIL", "G2"],
    ["F good", gradeFracture("F1", mkF(F_GOOD)), "PASS", null],
    ["F borrowed 365-day window under the fracture", gradeFracture("F1", mkF({ ...F_GOOD, details: ["The Simple Fracture benefit applies if an Accident results in a Simple Fracture within 365 days of the Accident. It is a separate benefit from the death benefits."] })), "FAIL", "F2"],
    ["F added to the death benefit", gradeFracture("F1", mkF({ ...F_GOOD, details: [...F_GOOD.details, "Together with S$1,000,000 Term Life that is S$1,003,750 in total."] })), "FAIL", "F3"],
    ["F wrong figure", gradeFracture("F1", mkF({ ...F_GOOD, summary: "If Daniel's hip is broken in an Accident, the Simple Fracture benefit gives S$2,500: Hip 75% of S$5,000." })), "FAIL", "F1"],
    ["F budget refusal", gradeFracture("F1", { turns: [{ calls: [{ refused: "run cap" }] }], loaded: { turns: [{ answer: { summary: "stopped" } }] }, saved: { traces: [{}] } }), "BLOCKED", null],
  ];
}

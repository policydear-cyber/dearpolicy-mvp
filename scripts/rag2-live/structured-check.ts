/**
 * Structured-answers release (grader v8, written BEFORE any real-model run; docs/rag-migration/reliable-chat/EXPECTED-structured-answers.md):
 * graders for the actual-library-structure household (RAG2_LIVE_HOUSEHOLD=actuallib). They read the COMPLETE saved answers
 * (summary, details, questions, every next step, saved calculations) -- never only the expected figures. A wrong fact, an
 * unfinished clause, a refusal where a supported answer exists, a repeated question, a stale assumption, a total of
 * alternatives or an imported definition each fail on their own check.
 */
import { uniqueSteps } from "../../components/next-steps";
import { recomputeCalculation } from "@/lib/claims/calc-record";

type Check = { id: string; dim: "C" | "K" | "S" | "U"; name: string; ok: boolean; detail?: string };
export type Graded = { scenario: string; verdict: "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE"; checks: Check[]; note: string | null };
const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const BUDGET = /model-use budget|budget set for this test run|run_budget/i;
const NOT_CONFIRMED = /couldn['’]t (?:confirm|finish|work out)|could not confirm|left out an amount|assistant model returned an error|haven['’]t (?:stated|given)/i;
const CUT_QUOTE = /[“"][^”"]*\b(?:which|and|or|of|the|to|that|if|an?|by|with|for)\s*[”"]/i;
const ORPHAN = /^(?:[a-z]|(?:Says|Said|Requires|Requiring|Payable only|And|But|That|It says)\b)/m;
const PROMISE = /\b(?:will (?:pay|receive|get)|you(?:'ll| will) be paid|is payable to you|guarantee[sd]?|entitled to)\b/i;
const FOREIGN = /S\$\s?(?:7,000|4,000|900,000|3,500|10,000|500\b)|Singlife|MINDEF/;
const DEFINITION = /Simple Fracture means|means a closed|not a Simple Fracture|skin is not broken/i;
const SCHEDULE_ID = /“Schedule”|\bSchedule benefit\b|^•|\s•\s/m;
/** (v8.1, after sa-live-2: a crash-safe stringify -- an answer with no `calculations` made the detail of K5 throw instead of FAIL; no expectation changed) */
const J = (x: unknown): string => JSON.stringify(x) ?? "undefined";
const lines = (v: string) => v.split("\n").filter(Boolean);
const ends = (l: string) => /[.?!]["”’)]?$/.test(l.trim());
const balanced = (l: string) => (l.match(/“/g) ?? []).length === (l.match(/”/g) ?? []).length && (l.match(/\(/g) ?? []).length === (l.match(/\)/g) ?? []).length;
const recomputes = (rec: any, minor: number) => { try { const r = recomputeCalculation(rec); return r.ok && r.resultMinor === minor; } catch { return false; } };

function base(conv: any) {
  const turns = ((conv?.loaded?.turns ?? []) as any[]).map((t: any, i: number) => ({ answer: t.answer, trace: conv?.saved?.traces?.[i] ?? null, v: visibleOf(t.answer) }));
  const blocked = turns.find((t) => t.trace?.limit?.kind === "run_budget" || BUDGET.test(t.v)) ? "the run-cap guard refused a model call" : (conv?.turns ?? []).some((t: any) => (t.calls ?? []).some((c: any) => c.refused)) ? "a model call was refused by the run-cap guard" : null;
  const wanted = (conv?.turns ?? []).length;
  return { turns, blocked, incomplete: !turns.length || turns.length < wanted || turns.some((t) => !t.answer) ? `saved answers for ${turns.length} of ${wanted} turns` : null };
}
function finish(scenario: string, checks: Check[], b: ReturnType<typeof base>): Graded {
  if (b.blocked) return { scenario, verdict: "BLOCKED", checks, note: b.blocked };
  if (b.incomplete && !checks.length) return { scenario, verdict: "INCOMPLETE", checks, note: b.incomplete };
  return { scenario, verdict: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks, note: b.incomplete };
}
/** checks every journey shares, on the complete visible text of every turn */
function common(b: ReturnType<typeof base>): Check[] {
  const all = b.turns.map((t) => t.v).join("\n");
  return [
    { id: "G1", dim: "C", name: "no refusal / “couldn't confirm” text where an answer was possible, and no model error", ok: !NOT_CONFIRMED.test(all), detail: all.slice(0, 900) },
    { id: "G2", dim: "C", name: "no unfinished clause: no cut quotation, no orphan fragment, every line ends as a sentence or a question", ok: !CUT_QUOTE.test(all) && !ORPHAN.test(all) && lines(all).every((l) => ends(l) && balanced(l)), detail: lines(all).filter((l) => !ends(l) || !balanced(l) || CUT_QUOTE.test(l) || ORPHAN.test(l)).join("\n").slice(0, 900) },
    { id: "G3", dim: "K", name: "no other household's / superseded version's / other document's figure", ok: !FOREIGN.test(all), detail: all.slice(0, 900) },
    { id: "G4", dim: "K", name: "no “Schedule” / bullet identity and no imported definition of Simple / Other Fracture", ok: !SCHEDULE_ID.test(all) && !DEFINITION.test(all), detail: all.slice(0, 900) },
    { id: "G5", dim: "S", name: "no payment promise", ok: !PROMISE.test(all.replace(/not a payment[^.]*/gi, "")), detail: all.slice(0, 600) },
    { id: "G6", dim: "U", name: "returned = saved: every saved calculation's sentence is shown whole", ok: b.turns.every((t) => ((t.answer?.calculations ?? []) as any[]).every((k) => lines(t.v).includes(k.sentence))), detail: J(b.turns.map((t) => (t.answer?.calculations ?? []).map((k: any) => k.sentence))).slice(0, 900) },
  ];
}
const contact = (v: string) => /Contact Aldermoor Life Ltd/.test(v);

/** SA1: closed tibia then "it was his hip": the final conditional S$3,750 is complete, saved and recomputable; S$2,500 not current */
export function gradeSAcorrection(id: string, conv: any): Graded {
  const b = base(conv); if (b.blocked || !b.turns.length) return finish(id, [], b);
  const last = b.turns.at(-1)!, first = b.turns[0];
  const hip = lines(last.v).find((l) => /S\$3,750/.test(l)) ?? "";
  const k = ((last.answer?.calculations ?? []) as any[]).find((x) => x.result?.value === 3750);
  const checks = [...common(b),
    { id: "K1", dim: "K", name: "turn 1: the closed tibia is given its conditional S$2,500 (50% of the S$5,000 limit)", ok: /\bIf\b/.test(lines(first.v).find((l) => /S\$2,500/.test(l)) ?? "") && /50%/.test(first.v), detail: first.v.slice(0, 700) },
    { id: "K2", dim: "K", name: "final turn: one complete conditional sentence for S$3,750 (If … Hip … 75% … S$5,000 … not a payment)", ok: /^If\b/.test(hip) && /Hip/.test(hip) && /75%/.test(hip) && /S\$5,000/.test(hip) && /not a payment/.test(hip) && ends(hip), detail: last.v.slice(0, 900) },
    { id: "K3", dim: "K", name: "final turn: the withdrawn tibia amount (S$2,500) is not presented as current", ok: !/S\$2,500/.test(last.v), detail: last.v.slice(0, 700) },
    { id: "K4", dim: "K", name: "final turn: the household's message is not quoted into the calculation", ok: !/Correction:|as you described|not his tibia/i.test(last.v), detail: last.v.slice(0, 700) },
    { id: "K5", dim: "K", name: "final turn: the saved calculation exists, is the displayed sentence and recomputes to S$3,750", ok: !!k && lines(last.v).includes(k.sentence) && recomputes(k, 375000), detail: J(last.answer?.calculations?.map((x: any) => [x.result?.value, x.sentence])).slice(0, 600) },
    { id: "U1", dim: "U", name: "final turn: a contact step for the person's own insurer and no pending question", ok: contact(last.v) && !(last.answer?.questions ?? []).length, detail: last.v.slice(0, 700) },
  ] as Check[];
  return finish(id, checks, b);
}
/** SB: uncertain hip / tibia -> one relevant question -> the clarified case's illustration, current assumption, no repeat */
export function gradeSAambiguity(id: string, conv: any): Graded {
  const b = base(conv); if (b.blocked || b.turns.length < 2) return finish(id, [], b);
  const [t1, t2] = b.turns;
  const q = (t1.answer?.questions ?? []) as any[];
  const checks = [...common(b),
    { id: "Q1", dim: "U", name: "turn 1: exactly one question, about the hip or the lower-leg case, never whether the insurer accepts or approves", ok: q.length === 1 && /hip/i.test(q[0].text) && /leg|tibia|knee/i.test(q[0].text) && !/insurer (?:accept|approv)|(?:accept|approv)ed? by/i.test(q[0].text), detail: J(q) },
    { id: "Q2", dim: "K", name: "turn 1: the supported Simple Fracture terms come first (the S$5,000 limit and its hip and leg rows) and no amount is asserted before the case is known", ok: /S\$5,000/.test(t1.v) && /Hip/.test(t1.v) && !/conditional illustration is S\$/.test(t1.v), detail: t1.v.slice(0, 900) },
    { id: "Q3", dim: "K", name: "turn 1: no unrelated row is cited as the reason for the question (Cheekbone / Shoulder / Arm)", ok: !/Cheekbone|Shoulder|Arm, Elbow/.test(q.map((x) => x.text).join(" ")), detail: J(q) },
    { id: "Q4", dim: "K", name: "turn 2: the illustration is for the clarified case (leg row, S$2,500), conditional and saved", ok: /\bIf\b[^\n]*S\$2,500/.test(t2.v) && ((t2.answer?.calculations ?? []) as any[]).some((k) => k.result?.value === 2500 && recomputes(k, 250000)), detail: t2.v.slice(0, 900) },
    { id: "Q5", dim: "K", name: "turn 2: the earlier uncertain report is not the assumption (no “possibly”, “not sure”, “hip, or”)", ok: !/possibly|not sure|hip, or|hip or possibly/i.test(t2.v), detail: t2.v.slice(0, 700) },
    { id: "Q6", dim: "U", name: "turn 2: the question is not asked again; a contact step is shown", ok: !(t2.answer?.questions ?? []).length && contact(t2.v), detail: t2.v.slice(0, 700) },
  ] as Check[];
  return finish(id, checks, b);
}
/** SC: Simple vs Other: separate bases and assumptions, never a total, relationship honestly unestablished */
export function gradeSAcompare(id: string, conv: any): Graded {
  const b = base(conv); if (b.blocked || !b.turns.length) return finish(id, [], b);
  const v = b.turns.at(-1)!.v;
  const checks = [...common(b),
    { id: "C1", dim: "K", name: "Simple Fracture: S$2,500 = 50% of the S$5,000 limit, named with its own document", ok: /S\$2,500/.test(v) && /S\$5,000/.test(v) && /Product Summary/.test(v), detail: v.slice(0, 900) },
    { id: "C2", dim: "K", name: "Other Fracture: S$300,000 = 50% of Daniel's own S$600,000 sum insured, with its own document and its own assumption (an Other Fracture row)", ok: /S\$300,000/.test(v) && /S\$600,000/.test(v) && /Personal Accident Benefit Summary/.test(v) && /Other Fracture/.test(v), detail: v.slice(0, 900) },
    { id: "C3", dim: "K", name: "the two figures are alternatives from separate documents, never added or combined", ok: !/S\$302,500|in total|combined|together|\bplus\b|sum of the two|add(?:ed)? up|added/i.test(v.replace(/never a total|or adds to the other|(?:do(?:es)? not|cannot|can't|should not|should never|never)\b[^.\n]{0,80}\b(?:claimed together|added|combined|added together)\b/gi, "")) && /(?:neither document says|do not establish|does not say|unclear|not established)/i.test(v), detail: v.slice(0, 900) },
    { id: "C4", dim: "K", name: "no document is chosen as controlling without evidence", ok: !/supersede|overrides?|takes precedence|is the one that applies|controlling/i.test(v.replace(/replaces/g, "")), detail: v.slice(0, 700) },
  ] as Check[];
  return finish(id, checks, b);
}
/** SD: the death allowance in fresh wording */
export function gradeSAdeath(id: string, conv: any): Graded {
  const b = base(conv); if (b.blocked || !b.turns.length) return finish(id, [], b);
  const v = b.turns.at(-1)!.v;
  const checks = [...common(b),
    { id: "D1", dim: "K", name: "the Compassionate Death Allowance Benefit is retained by name with its printed conditions (accident, proof of death and the prescribed form, Core / Voluntary)", ok: /Compassionate Death Allowance Benefit/.test(v) && /proof of death/.test(v) && /prescribed form/.test(v) && /Core Scheme/.test(v), detail: v.slice(0, 900) },
    { id: "D2", dim: "K", name: "the booklet's bare $2,000 is said with its currency unstated, never as S$2,000 for the booklet", ok: /2,000 \(printed with a bare “\$” sign/.test(v) && !/booklet[^\n]*S\$2,000/i.test(v), detail: v.slice(0, 900) },
    { id: "D3", dim: "S", name: "no 365-day / receipts / illness condition the passage does not print", ok: !/365|original receipts|caused by an illness/i.test(v), detail: v.slice(0, 700) },
    { id: "D4", dim: "U", name: "a contact step for the person's own insurer, without an amount", ok: contact(v) && uniqueSteps(b.turns.at(-1)!.answer?.nextSteps).every((x) => !/S\$|\$\s?\d/.test(x)), detail: v.slice(0, 700) },
  ] as Check[];
  return finish(id, checks, b);
}
/** SE: person switch to Grace: her own illustration, certificate row and date; never Daniel's */
export function gradeSAperson(id: string, conv: any): Graded {
  const b = base(conv); if (b.blocked || b.turns.length < 2) return finish(id, [], b);
  const v = b.turns.at(-1)!.v;
  const checks = [...common(b),
    { id: "P1", dim: "K", name: "Grace's own conditional illustration (Hip 75% of the S$5,000 limit = S$3,750) names Grace", ok: /Grace/.test(lines(v).find((l) => /S\$3,750/.test(l)) ?? ""), detail: v.slice(0, 900) },
    { id: "P2", dim: "K", name: "Grace's own certificate row and date (S$100,000, 1 July 2024) when her cover is stated; never Daniel's S$600,000 or 1 April 2024", ok: !/S\$600,000|1 April 2024|Daniel/.test(v) && (!/certificate/i.test(lines(v).filter((l) => !/^Contact\b/.test(l)).join("\n")) || /S\$100,000/.test(v)), detail: v.slice(0, 900) },
  ] as Check[];
  return finish(id, checks, b);
}
export const STRUCTURED_GRADERS: Record<string, (id: string, conv: any) => Graded> = { SAa: gradeSAcorrection, SAb: gradeSAcorrection, SAp: gradeSAcorrection, SAq: gradeSAcorrection, SAr: gradeSAcorrection, SAs: gradeSAcorrection, SBa: gradeSAambiguity, SBb: gradeSAambiguity, SBp: gradeSAambiguity, SC: gradeSAcompare, SD: gradeSAdeath, SE: gradeSAperson };
/** v8.1 = v8 + crash-safe details (after sa-live-2); v8.2 = v8.1 + C3 accepts a NEGATED statement ("cannot be claimed together") and P2 does not count the contact step's document name as a statement of Grace's cover (both false positives found in sa-live-2's SC and SE answers; sa-live-2 stays graded by v8 as written, controls below show a real total and a real wrong-certificate still fail). */
export const STRUCTURED_GRADER_VERSION = "v8.2";

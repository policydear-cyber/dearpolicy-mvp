/**
 * Grader for the pre-registered real-model batch rc-live-1 (docs/rag-migration/reliable-chat/EXPECTED-rc-live-1.md).
 * WRITTEN BEFORE THE RUN; not changed after. Deterministic, no AI judge. Grades the COMPLETE visible answer of every
 * turn (summary, details, questions, every next step) and the saved calculation records, on four dimensions:
 *   C correct (the right benefit, row, base and amount; nothing another person's, superseded or unrelated)
 *   K terms (the supported terms that matter are said: the rows / base / condition)
 *   S source-bound (every amount comes from a saved calculation that recomputes, or a bound document figure)
 *   U useful (answers what was asked; one necessary question at most; no orphaned fragment, no "couldn't confirm",
 *     no inventory dump, no promise of payment)
 * Verdict per conversation: PASS (every check), FAIL, BLOCKED (the run-cap guard refused a model call -- a budget
 * refusal is not an answer failure), INCOMPLETE (no saved answer for a turn).
 *   node --import tsx scripts/rag2-live/reliable-chat-check.ts <RUN directory> [<RUN directory> ...]
 *   node --import tsx scripts/rag2-live/reliable-chat-check.ts --controls
 */
import fs from "node:fs";
import path from "node:path";
import { uniqueSteps } from "../../components/next-steps";
import { recomputeCalculation } from "@/lib/claims/calc-record";
import * as TAN from "../fixtures/reliable-chat/tan";
import * as PR50 from "../fixtures/rag2-pr50/household";
import * as BOOKLET from "../fixtures/reliable-chat/booklet";
import { gradeP50A } from "./pr50a-check";

type Check = { id: string; dim: "C" | "K" | "S" | "U"; name: string; ok: boolean; detail?: string };
type Verdict = "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE";
export type Graded = { scenario: string; verdict: Verdict; checks: Check[]; note: string | null };

export const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");
const BUDGET = /model-use budget|budget set for this test run|run_budget/i;
const PROMISE = /\b(?:will (?:pay|receive|get)|you(?:'ll| will) be paid|is payable to you|guarantee[sd]?|entitled to)\b/i;
const NOT_CONFIRMED = /couldn['’]t (?:confirm|finish|work out)|could not confirm|left out an amount|assistant model returned an error/i;
const INVENTORY_LINE = /^(?:[A-Z][a-z]+: .*(?:personal policy document|reference wording)|Not linked to anyone|.*: no documents on file\.)/m;
/** An orphaned fragment: a line that starts mid-sentence or with a clause that needs the one before it. */
const ORPHAN = /^(?:[a-z]|(?:Says|Said|Requires|Requiring|Payable only|And|But|That|It says)\b)/m;
const money = (s: string) => [...s.matchAll(/S\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
const calcsOf = (a: any) => ((a?.calculations ?? []) as any[]);
const recomputes = (rec: any, minor: number) => { try { const r = recomputeCalculation(rec); return r.ok && r.resultMinor === minor; } catch { return false; } };
const docOps = (rec: any) => ((rec?.operands ?? []) as any[]).filter((o) => o.source === "document");

function base(conv: any): { turns: { answer: any; trace: any; v: string }[]; blocked: string | null; incomplete: string | null } {
  const turns = ((conv?.loaded?.turns ?? []) as any[]).map((t: any, i: number) => ({ answer: t.answer, trace: conv?.saved?.traces?.[i] ?? null, v: visibleOf(t.answer) }));
  const blocked = turns.find((t) => t.trace?.limit?.kind === "run_budget" || BUDGET.test(t.v)) ? "the run-cap guard refused a model call" : (conv?.turns ?? []).some((t: any) => (t.calls ?? []).some((c: any) => c.refused)) ? "a model call was refused" : null;
  const wanted = (conv?.turns ?? []).length;
  const incomplete = !turns.length || turns.length < wanted || turns.some((t) => !t.answer) ? `saved answers for ${turns.length} of ${wanted} turns` : null;
  return { turns, blocked, incomplete };
}
function finish(scenario: string, checks: Check[], b: ReturnType<typeof base>): Graded {
  if (b.blocked) return { scenario, verdict: "BLOCKED", checks, note: b.blocked };
  if (b.incomplete && !checks.length) return { scenario, verdict: "INCOMPLETE", checks, note: b.incomplete };
  return { scenario, verdict: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks, note: b.incomplete };
}
/** Grader v2 (after rc-live-1, whose v1 grades passed answers that were not useful): questions the household cannot
 * answer, and contact / claim advice naming an insurer that is not behind one of the person's own policies. */
export const GRADER_VERSION = "v7"; // v7 = v6 + FL5a / FL5b (rc-live-9: FL4b's checks plus the next step); v6 = v5 + FL4b (rc-live-8, scheme-membership expectation corrected); FL1-FL4b checks unchanged
/** v4 (applicability follow-up, rc-live-6, written before the run): every v3 check unchanged; adds gradeFL1 / gradeFL2 /
 * gradeFL3, which check the complete visible answers, the saved calculations, the withdrawals on the claim and the
 * pending state after each conversation -- not only the expected figures. */
/** v3 (actual-library repairs, rc-live-5, written before the run): every v2 check unchanged, plus the booklet
 * household's graders (gradeBKL1 / gradeBKL2 / gradeBKL3) and a cut-clause check: a quotation ending in a connective
 * ("..., which”") is a usefulness failure, and so is the generic model-use-limit text. */
const CUT_QUOTE = /[“"][^”"]*\b(?:which|and|or|of|the|to|that|if|an?|by|with|for)\s*[”"]/i;
const LIMIT_TEXT = /model-use limit|reached its|stopped before finishing/i;
const INSURER_REVIEW_Q = /\b(?:has|have|did)\s+the\s+insurer\b|\binsurer(?:['’]s)?\s+(?:decision|review|reviewed|approv\w*|assessment|confirmation)\b|\breviewed medical (?:decision|record)\b/i;
const ACT = /\b(?:contact|call|phone|email|write to|notify|inform|report (?:it|the \w+) to|claim (?:from|under|with)|submit (?:a claim )?to|ask)\b/i;
const INSURERS = /\b(?:Aurora Assurance(?: Pte\.? Ltd\.?)?|Kestrel Life Ltd|KestrelOne|Harbourline General Insurance(?: Pte\.? Ltd\.?)?|Harbourline)\b/g;
const questionsOf = (a: any) => ((a?.questions ?? []) as any[]).map((q) => String(q.text ?? ""));
const universal = (add: (id: string, dim: Check["dim"], name: string, ok: boolean, detail?: string) => void, turns: { v: string; trace: any; answer?: any }[], prefix = "", allowedInsurers: string[] = []) => {
  turns.forEach((t, i) => {
    const review = questionsOf(t.answer).filter((q) => INSURER_REVIEW_Q.test(q));
    add(`${prefix}R${i + 1}`, "U", `turn ${i + 1}: no question the household cannot answer (what the insurer has reviewed or decided)`, !review.length, review.join(" | "));
    const bad = t.v.split("\n").filter((l) => ACT.test(l)).flatMap((l) => [...l.matchAll(INSURERS)].map((m) => m[0]).filter((n) => !allowedInsurers.some((a) => n.startsWith(a) || a.startsWith(n))).map((n) => `${n}: ${l}`));
    if (allowedInsurers.length) add(`${prefix}IN${i + 1}`, "C", `turn ${i + 1}: contact / claim advice names only the insurer of the person's own policy (${allowedInsurers.join(", ")})`, !bad.length, bad.join(" | "));
    const orphan = t.v.split("\n").filter((l) => ORPHAN.test(l.trim()) && !/\?\s*$/.test(l)); // (a question is not a fragment)
    add(`${prefix}O${i + 1}`, "U", `turn ${i + 1}: no orphaned fragment (no line starting mid-sentence or with a dependent clause)`, !orphan.length, orphan.join(" | "));
    const promises = t.v.split(/(?<=[.?!])\s+|\n/).filter((x) => PROMISE.test(x) && !/\b(?:not|no|never|cannot|can['’]t|isn['’]t|won['’]t|without)\b/i.test(x));
    add(`${prefix}P${i + 1}`, "U", `turn ${i + 1}: no promise of payment (a sentence saying it is NOT a promise is fine)`, !promises.length, promises.join(" | "));
    add(`${prefix}G${i + 1}`, "S", `turn ${i + 1}: the save-time gate rejected nothing`, !(t.trace?.gate ?? []).length, JSON.stringify(t.trace?.gate ?? []));
  });
};

/** RCT1a / RCT1b (household Tan): Jun's leg fracture -> which bone -> shin (10% x S$100,000 = S$10,000) -> thigh (20% = S$20,000). */
export function gradeRCT1(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const [t1, t2, t3] = b.turns;
  const never = (v: string) => !/15%|S\$300,000|S\$45,000|S\$15,000|S\$30,000|S\$40,000/.test(v);
  // turn 1
  add("T1C", "C", "turn 1: the Fracture Benefit for Jun; no amount before the bone is known (no S$10,000 / S$20,000); nothing superseded (15%) or from the other household (S$300,000)", !!t1 && /Fracture/i.test(t1.v) && !/S\$10,000|S\$20,000/.test(t1.v) && never(t1.v), t1?.v ?? "");
  add("T1K", "K", "turn 1: the supported terms -- the leg rows (thigh bone 20%, below the knee 10%) as a percentage of Jun's sum insured (S$100,000)", !!t1 && /20%/.test(t1.v) && /10%/.test(t1.v) && /S\$100,000/.test(t1.v) && /sum insured/i.test(t1.v), t1?.v ?? "");
  const qs = (t1?.answer?.questions ?? []) as any[];
  add("T1U", "U", "turn 1: exactly one necessary question, about which leg bone (thigh / femur vs below the knee / shin / tibia / fibula)", qs.length === 1 && /thigh|femur/i.test(qs[0]?.text ?? "") && /knee|shin|tibia|fibula/i.test(qs[0]?.text ?? ""), JSON.stringify(qs.map((q) => q.text)));
  // turn 2
  const r2 = calcsOf(t2?.answer)[0];
  add("T2C", "C", "turn 2: the conditional illustration S$10,000 (below the knee 10% x S$100,000); not S$20,000", !!t2 && money(t2.v).includes(10000) && !/S\$20,000/.test(t2.v) && never(t2.v) && /illustration|conditional|if /i.test(t2.v), t2?.v ?? "");
  add("T2S", "S", "turn 2: from a saved calculation that recomputes to S$10,000, its 10% bound to the wording and its S$100,000 to the schedule", !!r2 && recomputes(r2, 1_000_000) && docOps(r2).some((o) => o.value === 10 && o.binding?.policyId === TAN.doc("WORDING").id) && docOps(r2).some((o) => o.value === 100000 && o.binding?.policyId === TAN.doc("SCHEDULE").id), JSON.stringify(r2 ?? null).slice(0, 900));
  add("T2U", "U", "turn 2: answers without a further question and without 'couldn't confirm'", !!t2 && !(t2.answer?.questions ?? []).length && !NOT_CONFIRMED.test(t2.v), t2?.v ?? "");
  // turn 3
  const r3 = calcsOf(t3?.answer)[0];
  const calcs = Object.values(conv?.loaded?.state?.ragLoop?.claim?.calcs ?? {}) as any[];
  add("T3C", "C", "turn 3: the corrected illustration S$20,000 (thigh bone 20% x S$100,000); S$10,000 not presented as current", !!t3 && money(t3.v).includes(20000) && !/illustration is S\$10,000/.test(t3.v) && never(t3.v), t3?.v ?? "");
  add("T3S", "S", "turn 3: from a saved calculation that recomputes to S$20,000", !!r3 && recomputes(r3, 2_000_000), JSON.stringify(r3 ?? null).slice(0, 900));
  add("T3U", "U", "turn 3: the correction is acknowledged and the earlier estimate withdrawn (said, or recorded as withdrawn)", !!t3 && (/no longer applies|instead of|updated|corrected|rather than/i.test(t3.v) || calcs.some((c) => c.withdrawn)), t3?.v ?? "");
  // v2: a complete supported answer is the end of the turn -- no further question once the illustration is shown
  add("T3Q", "U", "turn 3 (v2): the corrected illustration ends the turn -- no further question; the withdrawal is SAID on the page", !!t3 && !(t3.answer?.questions ?? []).length && /no longer applies|instead of|rather than|replaces/i.test(t3.v), t3?.v ?? "");
  universal(add, b.turns, "", ["Aurora Assurance"]);
  return finish(id, checks, b);
}

/** RCW1a / RCW1b (household Wong): Simple Fracture, leg, closed -> 50% x the fixed S$5,000 limit = S$2,500. */
export function gradeRCW1(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0]; const rec = calcsOf(t.answer)[0];
  const SUM = PR50.DOCS.find((d) => d.key === "SUMMARY")!.id;
  add("W1C", "C", "S$2,500, conditional; never a product of the S$1,000,000 / S$600,000 sums (no S$300,000 / S$500,000 / S$3,000,000)", money(t.v).includes(2500) && !/S\$300,000|S\$500,000|S\$3,000,000/.test(t.v), t.v);
  add("W1K", "K", "the terms: 50% of the Simple Fracture Benefit Limit of S$5,000", /50%/.test(t.v) && /S\$5,000/.test(t.v) && /Simple Fracture/i.test(t.v), t.v);
  add("W1S", "S", "from a saved calculation that recomputes to S$2,500 with 50% and S$5,000 bound to the Summary of Benefits", !!rec && recomputes(rec, 250_000) && docOps(rec).some((o) => o.value === 50 && o.binding?.policyId === SUM) && docOps(rec).some((o) => o.value === 5000 && o.binding?.policyId === SUM), JSON.stringify(rec ?? null).slice(0, 900));
  add("W1U", "U", "answers without 'couldn't confirm' and without a question (the case is given)", !NOT_CONFIRMED.test(t.v) && !(t.answer?.questions ?? []).length, t.v);
  universal(add, b.turns, "", ["Kestrel Life Ltd"]);
  return finish(id, checks, b);
}

/** RCW2 (household Wong): death after a road accident abroad -- the pr50a-live-2 requirements (pr50a-check.ts R1-R7)
 * applied unchanged, plus the orphan / promise / gate checks. */
export function gradeRCW2(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const g = gradeP50A(b.turns[0].answer, b.turns[0].trace);
  const dimOf: Record<string, Check["dim"]> = { R1: "S", R2: "U", R3: "C", R4: "C", R5: "C", R6: "C", R7: "U" };
  for (const c of g.checks) add("D" + c.id, dimOf[c.id] ?? "C", c.name, c.ok, c.detail ?? "");
  add("DK", "K", "the Accidental Death benefit (100% of the Sum Insured) is explained", /Accidental Death/i.test(b.turns[0].v) && /100%/.test(b.turns[0].v), b.turns[0].v);
  universal(add, b.turns, "", ["Kestrel Life Ltd"]);
  if (g.verdict === "BLOCKED") return { scenario: id, verdict: "BLOCKED", checks, note: g.note };
  return finish(id, checks, b);
}

/** RCW3 (household Wong): "which of my uploaded policies should I claim under" -- an event question, not an inventory. */
/** RCX (household Wong, v2 control): a wrist -- which no listed fracture case covers -- and who to contact. Unlisted case
 * and reference insurer in one conversation: no illustration, no question offering unrelated cases, the unlisted case
 * said, and contact advice naming the certificate's insurer (Kestrel Life Ltd) -- never the summary's brand (KestrelOne)
 * alone and never the travel insurer. */
export function gradeRCX(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0];
  const amounts = money(t.v).filter((x) => ![5000, 600000, 1000000].includes(x));
  add("X1", "C", "no fracture illustration for a wrist (no amount other than the printed limits / dated sums)", !amounts.length && !calcsOf(t.answer).length, JSON.stringify(amounts) + "\n" + t.v);
  add("X2", "K", "says the documents list no fracture case for a wrist, with the cases they do list", /wrist/i.test(t.v) && /\b(?:no (?:listed )?case|not (?:one of the )?listed|does(?: not|n['’]t) list|not listed|lists no|isn['’]t listed|no case for)\b/i.test(t.v) && /\d+%/.test(t.v), t.v);
  add("X3", "U", "no question offering the listed cases (or any question): the answer is that a wrist is not listed", !questionsOf(t.answer).length, questionsOf(t.answer).join(" | "));
  add("X4", "U", "a contact step naming the certificate's insurer (Kestrel Life Ltd) or the scheme administrator / employer", t.v.split("\n").some((l) => ACT.test(l) && /Kestrel Life Ltd|scheme administrator|employer/i.test(l)), t.v);
  add("X5", "U", "no inventory and no 'couldn't confirm'", !INVENTORY_LINE.test(t.v) && !/could not be read|Photo of letter|Ethan/i.test(t.v) && !NOT_CONFIRMED.test(t.v), t.v);
  universal(add, b.turns, "", ["Kestrel Life Ltd"]);
  return finish(id, checks, b);
}

export function gradeRCW3(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0];
  add("I1", "U", "no household inventory (no per-person document list, no unlinked / unreadable file lines)", !INVENTORY_LINE.test(t.v) && !/could not be read|Photo of letter|Ethan/i.test(t.v), t.v);
  add("I2", "C", "names Adrian's accident cover (Group Personal Accident / its fracture benefits); never recommends the travel insurer (Harbourline)", /Personal Accident|Fracture/i.test(t.v) && !/(?:claim|contact)[^.\n]*Harbourline/i.test(t.v), t.v);
  add("I3", "K", "the fracture terms that decide it: Simple Fracture (wrist row 40% of S$5,000) and / or Other Fracture (a percentage of the Sum Insured), or the one question that separates them (closed / open)", /Simple Fracture|Other Fracture/i.test(t.v) && (/40%|S\$5,000|Sum Insured/i.test(t.v) || (t.answer?.questions ?? []).length === 1), t.v);
  const amounts = money(t.v).filter((x) => ![1000000, 600000, 5000].includes(x));
  const rec = calcsOf(t.answer)[0];
  add("I4", "S", "any illustrated amount comes from a saved calculation that recomputes (S$2,000 for the Simple Fracture wrist row)", !amounts.length || (!!rec && amounts.every((x) => recomputes(rec, Math.round(x * 100)))), JSON.stringify({ amounts, rec: rec ? recomputeCalculation(rec) : null }));
  add("I5", "U", "answers the question (no 'couldn't confirm')", !NOT_CONFIRMED.test(t.v), t.v);
  universal(add, b.turns, "", ["Kestrel Life Ltd"]);
  return finish(id, checks, b);
}

/** BKL1a / BKL1b (booklet household): "hip, but it could be his tibia" -> ONE question (the case), the Simple Fracture
 * terms, no amount -> "the X-ray confirms it is his hip" -> S$3,750 (Hip 75% x the S$5,000 Simple Fracture Benefit Limit)
 * from a saved calculation, no further question, the case question cleared. */
export function gradeBKL1(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const [t1, t2] = b.turns;
  const qs = questionsOf(t1?.answer);
  add("B1Q", "U", "turn 1: exactly one question, about which bone / case it is (hip vs tibia / leg)", qs.length === 1 && /hip/i.test(qs[0]) && /tibia|leg|shin|knee/i.test(qs[0]), qs.join(" | "));
  add("B1C", "C", "turn 1: no amount chosen before the case is known (no S$3,750 / S$2,500 / S$225,000 / S$150,000), no calculation saved", !!t1 && !/S\$3,750|S\$2,500|S\$225,000|S\$150,000/.test(t1.v) && !calcsOf(t1.answer).length, t1?.v ?? "");
  add("B1K", "K", "turn 1: the Simple Fracture terms that decide it (Hip 75%, the leg row 50%, of the S$5,000 limit)", !!t1 && /Simple Fracture/i.test(t1.v) && /75%/.test(t1.v) && /50%/.test(t1.v) && /S\$5,000/.test(t1.v), t1?.v ?? "");
  add("B1U", "U", "turn 1: never the generic model-use limit text", !!t1 && !LIMIT_TEXT.test(t1.v), t1?.v ?? "");
  const r2 = calcsOf(t2?.answer)[0];
  add("B2C", "C", "turn 2: the illustration S$3,750 (Hip 75% x S$5,000), conditional", !!t2 && money(t2.v).includes(3750) && /illustration|conditional|if /i.test(t2.v), t2?.v ?? "");
  add("B2S", "S", "turn 2: from a saved calculation that recomputes to S$3,750, bound to the booklet", !!r2 && recomputes(r2, 375_000) && docOps(r2).every((o) => o.binding?.policyId === BOOKLET.doc("BOOKLET").id), JSON.stringify(r2 ?? null).slice(0, 900));
  add("B2U", "U", "turn 2: no further question; the case question is cleared; no 'couldn't confirm'", !!t2 && !questionsOf(t2.answer).length && !conv?.loaded?.state?.ragLoop?.pending && !NOT_CONFIRMED.test(t2.v), t2?.v ?? "");
  b.turns.forEach((t, i) => add(`CQ${i + 1}`, "U", `turn ${i + 1}: no cut quotation`, !t.v.split("\n").some((l) => CUT_QUOTE.test(l)), t.v));
  universal(add, b.turns, "", ["Aldermoor Life Ltd"]);
  return finish(id, checks, b);
}
/** BKL2: Other Fracture (open hip) -> 75% x Daniel's Group Personal Accident sum insured S$300,000 = S$225,000; never the
 * Term Life S$500,000 (S$375,000), never the superseded 2022 amounts, never "not established" beside the amount. */
export function gradeBKL2(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0]; const rec = calcsOf(t.answer)[0];
  add("O1C", "C", "S$225,000 = 75% of Daniel's Group Personal Accident sum insured (S$300,000); never S$375,000 / S$150,000 / S$200,000", money(t.v).includes(225000) && !/S\$375,000|S\$150,000|S\$200,000/.test(t.v), t.v);
  add("O1S", "S", "from a saved calculation that recomputes to S$225,000, its S$300,000 bound to the certificate", !!rec && recomputes(rec, 22_500_000) && docOps(rec).some((o) => o.value === 300000 && o.binding?.policyId === BOOKLET.doc("CERT").id), JSON.stringify(rec ?? null).slice(0, 900));
  add("O1U", "U", "no contradiction (no 'not established' / 'unresolved' base beside the amount), no question, no 'couldn't confirm'", !/not established|unresolved|could not be established/i.test(t.v) && !questionsOf(t.answer).length && !NOT_CONFIRMED.test(t.v), t.v);
  add("OCQ", "U", "no cut quotation", !t.v.split("\n").some((l) => CUT_QUOTE.test(l)), t.v);
  universal(add, b.turns, "", ["Aldermoor Life Ltd"]);
  return finish(id, checks, b);
}
/** BKL3: the Compassionate Death Allowance Benefit -- named, with its conditions (accidental death, proof of death) and
 * its funeral-expenses amount said WITHOUT an S$ (the booklet prints a bare $), never dropped whole; no cut clause. */
export function gradeBKL3(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0];
  add("D1K", "K", "the Compassionate Death Allowance Benefit is named, with funeral expenses and its condition (death from an Accident) and proof of death", /Compassionate Death Allowance/i.test(t.v) && /funeral/i.test(t.v) && /accident/i.test(t.v) && /proof of death|death certificate|proof/i.test(t.v), t.v);
  add("D1C", "C", "the amount is never S$2,000 (the booklet's $ names no currency); nothing from Repatriation ($5,000) stated for it", !/S\$2,000|SGD\s?2,000/.test(t.v) && !/5,000/.test(t.v.split("\n").filter((l) => /Compassionate|funeral/i.test(l)).join(" ")), t.v);
  add("D1U", "U", "useful: no 'couldn't confirm', no generic limit text, no question unless the documents depend on a fact the household can give", !NOT_CONFIRMED.test(t.v) && !LIMIT_TEXT.test(t.v) && questionsOf(t.answer).length <= 1, t.v);
  add("DCQ", "U", "no cut quotation", !t.v.split("\n").some((l) => CUT_QUOTE.test(l)), t.v);
  universal(add, b.turns, "", ["Aldermoor Life Ltd"]);
  return finish(id, checks, b);
}

const ID_LIKE = /\bb[0-9a-f]{10}(?:r\d+)?\b/;
const optionsOf = (a: any) => ((a?.questions ?? []) as any[]).flatMap((q) => (q.options ?? []).map(String));
const pendingOf = (conv: any) => conv?.loaded?.state?.ragLoop?.pending ?? null;
const claimCalcs = (conv: any) => Object.values(conv?.loaded?.state?.ragLoop?.claim?.calcs ?? {}) as any[];
/** FL1a / FL1b: uncertain hip / tibia (closed) -> one household question about the case -> "hip" -> the conditional
 * S$3,750 (Hip 75% x S$5,000) from a saved, recomputing calculation; never an Other Fracture illustration (S$225,000),
 * never an insurer-only question, nothing pending once it is answered. */
export function gradeFL1(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const [t1, t2] = b.turns;
  const q1 = questionsOf(t1?.answer);
  add("F1Q", "U", "turn 1: exactly one question, about which bone / case (hip vs tibia / shin / leg), answerable by the household", q1.length === 1 && /hip/i.test(q1[0]) && /tibia|shin|leg|knee/i.test(q1[0]) && !INSURER_REVIEW_Q.test(q1[0]) && !/\b(?:meets?|qualif\w*|determin\w*|assess\w*|approv\w*|accept\w*)\b/i.test(q1[0]), q1.join(" | "));
  add("F1O", "U", "turn 1: the question's options (if any) are the cases' own words, never internal ids", !optionsOf(t1?.answer).some((o) => ID_LIKE.test(o)), optionsOf(t1?.answer).join(" | "));
  add("F1C", "C", "turn 1: no amount before the case is known (no S$3,750 / S$2,500 / S$225,000 / S$150,000) and no saved calculation", !!t1 && !/S\$3,750|S\$2,500|S\$225,000|S\$150,000/.test(t1.v) && !calcsOf(t1.answer).length, t1?.v ?? "");
  add("F1K", "K", "turn 1: the Simple Fracture terms that decide it (Hip 75%, the leg row 50%, of S$5,000)", !!t1 && /Simple Fracture/i.test(t1.v) && /75%/.test(t1.v) && /50%/.test(t1.v) && /S\$5,000/.test(t1.v), t1?.v ?? "");
  const r2 = calcsOf(t2?.answer);
  add("F2C", "C", "turn 2: the conditional S$3,750 (Hip 75% x S$5,000); no Other Fracture illustration (never S$225,000 / S$150,000)", !!t2 && money(t2.v).includes(3750) && /illustration|conditional|if /i.test(t2.v) && !/225,000|150,000/.test(t2.v), t2?.v ?? "");
  add("F2S", "S", "turn 2: exactly one saved calculation, recomputing to S$3,750, bound to the booklet; none for Other Fracture", r2.length === 1 && recomputes(r2[0], 375_000) && docOps(r2[0]).every((o) => o.binding?.policyId === BOOKLET.doc("BOOKLET").id), JSON.stringify(r2).slice(0, 900));
  add("F2U", "U", "turn 2: no question at all (no Other Fracture or insurer-only question), no 'couldn't confirm', no limit text", !!t2 && !questionsOf(t2.answer).length && !NOT_CONFIRMED.test(t2.v) && !LIMIT_TEXT.test(t2.v), t2?.v ?? "");
  add("F2P", "U", "after the conversation: nothing pending", !pendingOf(conv), JSON.stringify(pendingOf(conv)));
  b.turns.forEach((t, i) => add(`FQ${i + 1}`, "U", `turn ${i + 1}: no cut quotation, no limit text`, !t.v.split("\n").some((l) => CUT_QUOTE.test(l)) && !LIMIT_TEXT.test(t.v), t.v));
  universal(add, b.turns, "", ["Aldermoor Life Ltd"]);
  return finish(id, checks, b);
}
/** FL2: closed hip (S$3,750) -> "it was an open fracture": the Simple Fracture illustration withdrawn (said, and on the
 * claim), Other Fracture S$225,000 = 75% x Daniel's Group Personal Accident S$300,000 (certificate) as the only current
 * figure; no question; nothing pending. */
export function gradeFL2(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const [t1, t2] = b.turns;
  const r1 = calcsOf(t1?.answer), r2 = calcsOf(t2?.answer);
  add("C1C", "C", "turn 1 (closed): S$3,750 from a recomputing calculation; no Other Fracture illustration (never S$225,000)", !!t1 && money(t1.v).includes(3750) && !/225,000/.test(t1.v) && r1.some((r) => recomputes(r, 375_000)), (t1?.v ?? "") + " | " + JSON.stringify(r1).slice(0, 400));
  add("C1U", "U", "turn 1: no question (closed and hip were both given)", !!t1 && !questionsOf(t1.answer).length, t1?.v ?? "");
  const simple = claimCalcs(conv).filter((c) => /simple fracture/i.test(c.benefit));
  add("C2W", "U", "turn 2: the S$3,750 Simple Fracture illustration is withdrawn -- said on the page and marked withdrawn on the claim", !!t2 && /no longer applies|withdrawn|instead of|replaces/i.test(t2.v) && simple.length > 0 && simple.every((c) => c.withdrawn), (t2?.v ?? "") + " | " + JSON.stringify(simple.map((c) => [c.benefit, c.withdrawn?.reason ?? null])));
  add("C2C", "C", "turn 2: S$225,000 (75% x S$300,000 Group Personal Accident); S$3,750 not presented as current; never S$375,000 / S$150,000", !!t2 && money(t2.v).includes(225000) && !/illustration is S\$3,750|S\$375,000|S\$150,000/.test(t2.v), t2?.v ?? "");
  add("C2S", "S", "turn 2: the only saved calculation recomputes to S$225,000 with its S$300,000 bound to the certificate", r2.length === 1 && recomputes(r2[0], 22_500_000) && docOps(r2[0]).some((o) => o.value === 300000 && o.binding?.policyId === BOOKLET.doc("CERT").id), JSON.stringify(r2).slice(0, 900));
  add("C2U", "U", "turn 2: no question; nothing pending after the conversation; no 'couldn't confirm'", !!t2 && !questionsOf(t2.answer).length && !pendingOf(conv) && !NOT_CONFIRMED.test(t2.v), (t2?.v ?? "") + " | " + JSON.stringify(pendingOf(conv)));
  b.turns.forEach((t, i) => add(`CQ${i + 1}`, "U", `turn ${i + 1}: no cut quotation, no limit text`, !t.v.split("\n").some((l) => CUT_QUOTE.test(l)) && !LIMIT_TEXT.test(t.v), t.v));
  universal(add, b.turns, "", ["Aldermoor Life Ltd"]);
  return finish(id, checks, b);
}
/** FL3: the Compassionate Death Allowance Benefit -- named with funeral expenses, its accidental-death condition and
 * proof; its amount never S$2,000 (a bare $), and if stated, said with its currency unknown; no false enrolment caveat
 * (if Daniel's listing is mentioned, it is the dated certificate listing and later cover is not asserted); no repatriation
 * amount; no calculation. */
export function gradeFL3(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0];
  add("A1K", "K", "the Compassionate Death Allowance Benefit is named with funeral expenses, its condition (death from an Accident) and proof of death", /Compassionate Death Allowance/i.test(t.v) && /funeral/i.test(t.v) && /accident/i.test(t.v) && /proof of death|death certificate|proof/i.test(t.v), t.v);
  add("A1C", "C", "the amount is never S$2,000; a stated 2,000 says its currency is not stated; nothing from Repatriation ($5,000) for it; no calculation", !/S\$2,000|SGD\s?2,000/.test(t.v) && (!/2,000/.test(t.v) || /does not say which currency|currency is not stated|not state the currency/i.test(t.v)) && !/5,000/.test(t.v.split("\n").filter((l) => /Compassionate|funeral/i.test(l)).join(" ")) && !calcsOf(t.answer).length, t.v);
  const caveat = t.v.split("\n").filter((l) => /\b(?:do(?:es)? not|don['’]t|doesn['’]t|cannot)\s+(?:\w+\s+){0,2}?(?:confirm|show|establish|list|verify)\w*\b[^.]*\benrol/i.test(l) && /Daniel/.test(l));
  add("A1E", "C", "no false enrolment caveat (Daniel's certificate lists him); any listing said is the dated one", !caveat.length && (!/certificate lists Daniel/i.test(t.v) || /01\/04\/2024|1 April 2024|2024-04-01/.test(t.v)), caveat.join(" | ") + "\n" + t.v);
  add("A1L", "C", "later cover is not asserted: no 'is covered' / 'currently covered' / 'is enrolled' for Daniel without a date; if the dated listing is said, cover on a later date is not established", !/\b(?:is|remains|currently)\s+(?:covered|insured|enrolled)\b/i.test(t.v) && (!/certificate lists Daniel/i.test(t.v) || /later date|not establish|does not establish/i.test(t.v)), t.v);
  add("A1U", "U", "useful: no 'couldn't confirm', no limit text, at most one question, no cut quotation", !NOT_CONFIRMED.test(t.v) && !LIMIT_TEXT.test(t.v) && questionsOf(t.answer).length <= 1 && !t.v.split("\n").some((l) => CUT_QUOTE.test(l)), t.v);
  universal(add, b.turns, "", ["Aldermoor Life Ltd"]);
  return finish(id, checks, b);
}

/** FL4 (rc-live-7, booklet page faithful to the RECORDED actual-library passage, BOOKLET_CDA=recorded): the
 * Compassionate Death Allowance Benefit with ONLY its printed conditions -- accidental death, proof of death and the
 * relevant documents in the prescribed form, funeral expenses up to a bare $2,000, the Core / Voluntary Scheme
 * restriction -- and none of the synthetic fixture's additions (365 days, original receipts, illness exclusion). A
 * separate benefit summary prints "Up to S$2,000"; nothing links it to the booklet, so S$2,000 may appear only as that
 * summary's figure, never as the booklet's. */
export function gradeFL4(id: string, conv: any): Graded {
  const b = base(conv); const checks: Check[] = [];
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  if (b.blocked || !b.turns.length) return finish(id, checks, b);
  const t = b.turns[0];
  const lines = t.v.split("\n");
  add("A2K", "K", "the Compassionate Death Allowance Benefit is named with funeral expenses, death from an Accident, proof of death and the prescribed-form documents", /Compassionate Death Allowance/i.test(t.v) && /funeral/i.test(t.v) && /accident/i.test(t.v) && /proof of death/i.test(t.v) && /prescribed form/i.test(t.v), t.v);
  add("A2S", "K", "the Core / Voluntary Scheme restriction is kept", /Core Scheme/i.test(t.v) && /Voluntary Scheme/i.test(t.v), t.v);
  add("A2X", "C", "none of the synthetic additions: no 365-day condition, no 'original receipts', no illness exclusion", !/365|original receipts|illness/i.test(t.v), t.v);
  const sgd = lines.filter((l) => /S\$\s?2,000|SGD\s?2,000/.test(l));
  add("A2C", "C", "the booklet's amount is never S$2,000; a booklet 2,000 says its currency is not stated; S$2,000 only as the separate summary's figure; nothing from Repatriation ($5,000); no calculation", sgd.every((l) => /Insurance Benefits Summary/i.test(l) && !/Booklet/i.test(l)) && lines.filter((l) => /2,000/.test(l) && !/S\$\s?2,000|SGD/.test(l)).every((l) => /does not say which currency|currency is not stated|not state the currency/i.test(l)) && !/5,000/.test(lines.filter((l) => /Compassionate|funeral/i.test(l)).join(" ")) && !calcsOf(t.answer).length, t.v);
  const caveat = lines.filter((l) => /\b(?:do(?:es)? not|don['’]t|doesn['’]t|cannot)\s+(?:\w+\s+){0,2}?(?:confirm|show|establish|list|verify)\w*\b[^.]*\benrol/i.test(l) && /Daniel/.test(l));
  add("A2E", "C", "no false enrolment caveat (Daniel's certificate lists him); any listing said is the dated one", !caveat.length && (!/certificate lists Daniel/i.test(t.v) || /01\/04\/2024|1 April 2024|2024-04-01/.test(t.v)), caveat.join(" | ") + "\n" + t.v);
  add("A2L", "C", "later cover is not asserted: no 'is covered' / 'currently covered' / 'is enrolled' for Daniel; if the dated listing is said, cover on a later date is not established", !/\b(?:is|remains|currently)\s+(?:covered|insured|enrolled)\b/i.test(t.v) && (!/certificate lists Daniel/i.test(t.v) || /later date|not establish|does not establish/i.test(t.v)), t.v);
  add("A2U", "U", "useful: no 'couldn't confirm', no limit text, at most one question, no cut quotation", !NOT_CONFIRMED.test(t.v) && !LIMIT_TEXT.test(t.v) && questionsOf(t.answer).length <= 1 && !lines.some((l) => CUT_QUOTE.test(l)), t.v);
  universal(add, b.turns, "", ["Aldermoor Life Ltd"]);
  return finish(id, checks, b);
}

/** FL4b (rc-live-8): FL4's checks, with the scheme-membership expectation corrected (v6). v5's A2E / A2L treated "the
 * documents do not establish whether Daniel is enrolled in the Core or Voluntary Scheme" as the false enrolment caveat;
 * it is not: the certificate names Daniel under the scheme's products as of 01/04/2024 but prints neither Core nor
 * Voluntary. v6 separates the two:
 *  - A3E: never that the documents / certificate do not confirm, list or name Daniel (as enrolled, insured, covered or
 *    listed) in the scheme; an uncertainty that names Core / Voluntary membership is allowed;
 *  - A3L: Daniel is never asserted to be covered / insured / enrolled (now, or in a Core / Voluntary scheme) -- a
 *    "whether ..." uncertainty asserts nothing; a stated certificate listing is the dated one with the later-date limit.
 * FL4 (rc-live-7) keeps its v5 grade. */
export function gradeFL4b(id: string, conv: any): Graded {
  const g = gradeFL4(id, conv);
  const b = base(conv);
  if (b.blocked || !b.turns.length) return g;
  const t = b.turns[0];
  const lines = t.v.split("\n");
  const checks = g.checks.filter((c) => c.id !== "A2E" && c.id !== "A2L");
  const add = (cid: string, dim: Check["dim"], name: string, ok: boolean, detail = "") => checks.push({ id: cid, dim, name, ok, ...(!ok ? { detail: detail.slice(0, 1200) } : {}) });
  const NOT = /\b(?:do(?:es)? not|don['’]t|doesn['’]t|cannot|can['’]t|fails? to|not)\s+(?:\w+\s+){0,3}?(?:confirm|show|establish|list|name|verify|include|mention)\w*\b/i;
  const PERSON_IN_SCHEME = /\b(?:enrol\w*|insured|covered|listed|named|member\w*)\b/i;
  const caveat = lines.filter((l) => /Daniel/.test(l) && NOT.test(l) && PERSON_IN_SCHEME.test(l) && !/\bCore\b[^.]*\bVoluntary\b|\bVoluntary\b[^.]*\bCore\b/i.test(l));
  add("A3E", "C", "no claim that the documents do not confirm / list / name Daniel in the scheme (a Core / Voluntary membership uncertainty is allowed); any listing said is the dated one", !caveat.length && (!/certificate lists Daniel/i.test(t.v) || /01\/04\/2024|1 April 2024|2024-04-01/.test(t.v)), caveat.join(" | ") + "\n" + t.v);
  const asserted = t.v.replace(/\bwhether\b[^.;]*/gi, "").replace(/\b(?:is|are) not (?:established|confirmed|stated|shown)\b[^.;]*/gi, "");
  add("A3L", "C", "Daniel is never asserted to be covered / insured / enrolled (now, or in the Core or Voluntary Scheme); a stated listing carries the later-date limit", !/\b(?:is|remains|currently)\s+(?:\w+\s+)?(?:covered|insured|enrolled)\b/i.test(asserted) && (!/certificate lists Daniel/i.test(t.v) || /later date|not establish|does not establish/i.test(t.v)), t.v);
  const order = ["A2K", "A2S", "A2X", "A2C", "A3E", "A3L"];
  checks.sort((x, y) => (order.indexOf(x.id) + 1 || 99) - (order.indexOf(y.id) + 1 || 99));
  return finish(id, checks, b);
}

/** FL5a / FL5b (rc-live-9, v7): FL4b's checks on the complete displayed answer, plus its next step -- the run log now
 * records every next step, so the whole answer is graded:
 *  - N1: at least one next step is shown, and it is a contact / claim step for the person's own insurer (Aldermoor Life
 *    Ltd) -- never another insurer, never an amount. */
export function gradeFL5(id: string, conv: any): Graded {
  const g = gradeFL4b(id, conv);
  const b = base(conv);
  if (b.blocked || !b.turns.length) return g;
  const steps = uniqueSteps(b.turns[0].answer?.nextSteps);
  const checks = [...g.checks];
  const ok = steps.length >= 1 && steps.some((x) => /\bcontact\b|\bclaim\b/i.test(x) && /Aldermoor Life/.test(x)) && steps.every((x) => !/S\$|\$\s?\d|SGD/.test(x));
  checks.push({ id: "N1", dim: "U", name: "a next step is shown: contacting the person's own insurer (Aldermoor Life Ltd) about a claim, with no amount", ok, ...(!ok ? { detail: JSON.stringify(steps).slice(0, 1200) } : {}) });
  return finish(id, checks, b);
}

export const GRADERS: Record<string, (id: string, conv: any) => Graded> = { FL1a: gradeFL1, FL1b: gradeFL1, FL2: gradeFL2, FL3: gradeFL3, FL4: gradeFL4, FL4b: gradeFL4b, FL5a: gradeFL5, FL5b: gradeFL5, BKL1a: gradeBKL1, BKL1b: gradeBKL1, BKL2: gradeBKL2, BKL3: gradeBKL3, RCT1a: gradeRCT1, RCT1b: gradeRCT1, RCW1a: gradeRCW1, RCW1b: gradeRCW1, RCW2: gradeRCW2, RCW3: gradeRCW3,
  // rc-live-2 (pre-registered in EXPECTED-rc-live-2.md)
  RCT2a: gradeRCT1, RCT2b: gradeRCT1, RCW4a: gradeRCW1, RCW4b: gradeRCW1, RCX: gradeRCX };

/** v2 controls on the ACTUAL rc-live-1 transcripts (committed): answers the v1 grader passed that were not useful now
 * fail on the intended check. The v1 grades themselves are kept as they were (live/rc-live-1-grade.md). */
function liveControls(): [string, Graded, Verdict, string | null][] {
  const dir = "docs/rag-migration/reliable-chat/live";
  const conv = (run: string, sc: string) => { const d = fs.readdirSync(dir).find((x) => x.startsWith(run)); return d ? JSON.parse(fs.readFileSync(path.join(dir, d, `conv-${sc}.json`), "utf8")) : null; };
  const t1b = conv("RUN-rc-live-1-tan", "RCT1b"), w3 = conv("RUN-rc-live-1-wong", "RCW3"), w1a = conv("RUN-rc-live-1-wong", "RCW1a"), p50a = conv("RUN-rc-live-1-wong", "P50A");
  if (!t1b || !w3 || !w1a || !p50a) return [["the rc-live-1 transcripts are present", { scenario: "-", verdict: "INCOMPLETE", checks: [], note: null }, "PASS", null]];
  const p50aAsX = gradeRCX("P50A", p50a); // only its insurer check matters here
  return [
    ["live RCT1b (v1 PASS): ends with an insurer-review question", gradeRCT1("RCT1b", t1b), "FAIL", "R3"],
    ["live RCT1b (v1 PASS): a question after the corrected illustration", gradeRCT1("RCT1b", t1b), "FAIL", "T3Q"],
    ["live RCW3 graded as the wrist control: asks the household to choose neck / hip / leg", gradeRCX("RCX", w3), "FAIL", "X3"],
    ["live P50A: contact advice naming the travel insurer (Harbourline)", p50aAsX, "FAIL", "IN1"],
    ["live RCW1a (v1 PASS, correct and useful) still passes", gradeRCW1("RCW1a", w1a), "PASS", null],
  ];
}

function controls() {
  // The grader's own controls: a synthetic perfect answer passes; known-bad variants fail on the intended check.
  const conv = (answers: any[], extra: any = {}) => ({ turns: answers.map(() => ({})), loaded: { turns: answers.map((answer) => ({ answer })), state: extra.state ?? {} }, saved: { traces: answers.map(() => ({ gate: [] })) } });
  const cases: [string, Graded, Verdict, string | null][] = [
    ["RCW3 inventory dump", gradeRCW3("RCW3", conv([{ summary: "Adrian: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document).", details: ["Ethan: no documents on file.", "Group Personal Accident Simple Fracture pays 40% of S$5,000 for a wrist."] }])), "FAIL", "I1"],
    ["RCW3 good", gradeRCW3("RCW3", conv([{ summary: "Adrian's Group Personal Accident has a Simple Fracture benefit: a wrist is 40% of the S$5,000 Simple Fracture Benefit Limit for a closed fracture.", details: [], questions: [{ text: "Was the fracture closed (skin not broken) or open?" }] }])), "PASS", null],
    ["RCW1 orphan fragment", gradeRCW1("RCW1a", conv([{ summary: "Simple Fracture pays 50% of the S$5,000 limit for a leg: S$2,500 as an illustration.", details: ["says death must occur within 90 days."] }])), "FAIL", "O1"],
    ["RCW1 no record", gradeRCW1("RCW1a", conv([{ summary: "Simple Fracture pays 50% of the S$5,000 limit for a leg: S$2,500 as an illustration.", details: [] }])), "FAIL", "W1S"],
    ["RCT1 promise", gradeRCT1("RCT1a", conv([{ summary: "The Fracture Benefit pays 20% or 10% of Jun's sum insured of S$100,000.", questions: [{ text: "Was it the thigh bone (femur) or below the knee?" }] }, { summary: "The insurer will pay S$10,000 (illustration)." }, { summary: "S$20,000 instead of S$10,000." }])), "FAIL", "P2"],
    ["budget refusal", gradeRCW1("RCW1a", conv([{ summary: "I stopped: the model-use budget set for this test run is used up." }])), "BLOCKED", null],
    ["v2 incomplete: the wrist control without contact advice", gradeRCX("RCX", conv([{ summary: "The Summary of Benefits lists no case for a wrist under Simple Fracture: Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%." }])), "FAIL", "X4"],
    ["v2 unsupported insurer: claim advice naming KestrelOne (the summary's brand) alone", gradeRCX("RCX", conv([{ summary: "The Summary of Benefits lists no case for a wrist under Simple Fracture: Hip 75%.", nextSteps: ["Contact KestrelOne to make a claim."] }])), "FAIL", "IN1"],
    ["v3 BKL1 the generic model-use limit text instead of the question", gradeBKL1("BKL1a", conv([{ summary: "Civil Service Group Insurance Scheme - Certificate prints “Group Personal Accident” as S$300,000.", details: ["I stopped before finishing because this question reached its model-use limit."] }, { summary: "I couldn’t finish." }])), "FAIL", "B1Q"],
    ["v3 BKL3 the death allowance dropped whole (\"I haven't stated the amount for If an Insured Person ... which\")", gradeBKL3("BKL3", conv([{ summary: "I haven’t stated the amount for If an Insured Person sustains bodily injury as a result of an Accident, which in Group Insurance Benefits Booklet (page 9), because the currency didn’t match what the document prints." }])), "FAIL", "D1K"],
    ["v3 BKL3 a cut quotation", gradeBKL3("BKL3", conv([{ summary: "The booklet's Compassionate Death Allowance Benefit pays funeral expenses on proof of death after an accident, up to 2,000 (printed with a “$” sign; the document does not say which currency).", details: ["I'm asking because the wording turns on “If an Insured Person sustains bodily injury as a result of an Accident, which”."] }])), "FAIL", "DCQ"],
    ["v3 BKL3 good", gradeBKL3("BKL3", conv([{ summary: "The Group Insurance Benefits Booklet's Compassionate Death Allowance Benefit pays the funeral expenses incurred, up to 2,000 (printed with a “$” sign; the document does not say which currency), if Daniel dies as a result of an Accident within 365 days, on receipt of proof of death and the original receipts.", nextSteps: ["Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim."] }])), "PASS", null],
    ["v3 BKL2 Term Life base (S$375,000)", gradeBKL2("BKL2", conv([{ summary: "If the Other Fracture benefit applies to Daniel's case “Hip (Other Fracture)”, the conditional illustration is S$375,000: 75% of Daniel's sum insured of S$500,000 (Group Term Life)." }])), "FAIL", "O1C"],
    ["v2 good wrist control", gradeRCX("RCX", conv([{ summary: "The Summary of Benefits lists no case for a wrist under Simple Fracture: Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%.", nextSteps: ["Contact Kestrel Life Ltd (through the employer or scheme administrator) about the Public Officers Group Insurance Scheme - Certificate to ask what it needs for a claim."] }])), "PASS", null],
    ["v2 incomplete correction: S$20,000 without saying the earlier estimate no longer applies", gradeRCT1("RCT1a", conv([{ summary: "The Fracture Benefit pays a percentage of Jun's sum insured of S$100,000: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%.", questions: [{ text: "Was it the thigh bone (femur) or below the knee (tibia or fibula)?" }] }, { summary: "If it applies, the conditional illustration is S$10,000." }, { summary: "If it applies, the conditional illustration is S$20,000." }])), "FAIL", "T3Q"],
    ["v4 FL1 the rc-live-5 shape: S$3,750, then an insurer-only Other Fracture question left pending", gradeFL1("FL1a", conv([{ summary: "The Group Insurance Benefits Booklet (page 7) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Skull 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%.", questions: [{ text: "Which listed fracture case is Daniel’s: Hip or Jaw, Pelvis, Leg, Ankle or Knee?", options: ["Hip", "Jaw, Pelvis, Leg, Ankle or Knee"] }] }, { summary: "If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000.", questions: [{ text: "Does Daniel’s diagnosis meet the booklet’s definition of “Hip” for the Other Fracture benefit, as determined by the insurer’s medical assessment?" }] }], { state: { ragLoop: { pending: { kind: "fact", question: "Does ...?" } } } })), "FAIL", "F2U"],
    ["v4 FL1 option buttons carrying internal row ids", gradeFL1("FL1a", conv([{ summary: "The Simple Fracture pays Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50% of S$5,000.", questions: [{ text: "Was it Daniel's hip or his tibia?", options: ["b552ce93447r2", "b552ce93447r3"] }] }, { summary: "If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750." }])), "FAIL", "F1O"],
    ["v4 FL2 the earlier S$3,750 not withdrawn after the correction", gradeFL2("FL2", conv([{ summary: "If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750." }, { summary: "If the Other Fracture benefit applies to Daniel's case “Hip (Other Fracture)”, the conditional illustration is S$225,000: 75% of Daniel's sum insured of S$300,000 (Group Personal Accident)." }], { state: { ragLoop: { claim: { calcs: { k1: { benefit: "Simple Fracture", withdrawn: null } } } } } })), "FAIL", "C2W"],
    ["v4 FL3 the false enrolment caveat", gradeFL3("FL3", conv([{ summary: "The booklet's Compassionate Death Allowance Benefit pays funeral expenses incurred, up to 2,000 (printed with a “$” sign; the document does not say which currency), if death results from an Accident, on receipt of proof of death.", details: ["The uploaded documents do not confirm Daniel’s enrolment in the group scheme."] }])), "FAIL", "A1E"],
    ["v4 FL3 a bare $ shown as S$2,000", gradeFL3("FL3", conv([{ summary: "The booklet's Compassionate Death Allowance Benefit pays funeral expenses incurred, up to S$2,000, if death results from an Accident, on receipt of proof of death." }])), "FAIL", "A1C"],
    ["v4 FL3 good", gradeFL3("FL3", conv([{ summary: "The booklet's Compassionate Death Allowance Benefit pays funeral expenses incurred, up to 2,000 (printed with a “$” sign; the document does not say which currency), if death results from an Accident within 365 days, on receipt of proof of death and the original receipts.", details: ["Daniel's certificate lists Daniel under Group Personal Accident as of 01/04/2024.", "A dated certificate shows who it listed on that date; it does not by itself establish cover on a later date."] }])), "PASS", null],
    ...liveControls(),
  ];
  let ok = true;
  for (const [name, g, want, failing] of cases) {
    const hit = g.verdict === want && (!failing || g.checks.some((c) => c.id === failing && !c.ok));
    ok &&= hit;
    console.log(`${hit ? "PASS" : "FAIL"} control: ${name} -> ${g.verdict}${g.checks.some((c) => !c.ok) ? ` (${g.checks.filter((c) => !c.ok).map((c) => c.id).join(",")})` : ""}`);
  }
  console.log(`reliable-chat grader controls ${ok ? "all passed" : "FAILED"}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("reliable-chat-check.ts")) {
  if (process.argv[2] === "--controls") controls();
  else {
    const dirs = process.argv.slice(2); if (!dirs.length) { console.error("usage: reliable-chat-check.ts <RUN directory> [...]"); process.exit(2); }
    const all: Graded[] = []; const rows: string[] = [];
    for (const dir of dirs) {
      const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
      for (const conv of run.conversations ?? []) {
        const fn = GRADERS[conv.scenario]; if (!fn) continue;
        const g = fn(conv.scenario, conv); all.push(g);
        const timings = (conv.turns ?? []).map((t: any) => `${t.timings?.answerSeenMs ?? "?"} ms (model ${t.timings?.modelMs ?? "?"} ms)`).join("; ");
        rows.push(`## ${conv.scenario}: ${g.verdict}`, "", `run ${path.basename(dir)} -- ${conv.calls ?? "?"} calls, US$${(conv.costUsd ?? 0).toFixed(6)}; send-to-answer per turn: ${timings}`, ...(g.note ? ["", g.note] : []), "",
          "| id | dim | requirement | result | detail |", "|---|---|---|---|---|", ...g.checks.map((c) => `| ${c.id} | ${c.dim} | ${c.name} | ${c.ok ? "pass" : "**FAIL**"} | ${(c.detail ?? "").replace(/\|/g, "/").replace(/\n/g, " ⏎ ").slice(0, 500)} |`), "",
          "Visible answers:", "", ...((conv.loaded?.turns ?? []) as any[]).flatMap((t: any, i: number) => [`- **${conv.turns?.[i]?.user ?? "turn " + (i + 1)}**`, "", "```", visibleOf(t.answer), "```", ""]));
      }
    }
    const batch = path.basename(dirs[0]).replace(/^RUN-/, "").replace(/-(?:tan|wong)-\d{4}-.*$/, "");
    const name = process.env.GRADE_NAME ?? `${batch}-grade`;
    const head = [`# ${batch} grade (reliable-chat-check.ts, grader ${GRADER_VERSION})`, "", `| scenario | verdict |`, `|---|---|`, ...all.map((g) => `| ${g.scenario} | ${g.verdict} |`), ""];
    const out = path.join(dirs[0], "..", `${name}.md`);
    if (fs.existsSync(out) && !process.env.GRADE_OVERWRITE) { console.error(`${out} exists: grades are kept as written (set GRADE_NAME for another file)`); process.exit(2); }
    fs.writeFileSync(out, [...head, ...rows].join("\n") + "\n");
    fs.writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify(all, null, 2));
    console.log(head.join("\n")); console.log(`wrote ${out}`);
    process.exit(all.length && all.every((g) => g.verdict === "PASS") ? 0 : 1);
  }
}

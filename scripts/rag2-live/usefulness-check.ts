/**
 * fx-live-1 graders v1 (deterministic; written from docs/rag-migration/reliable-chat/EXPECTED-fracture-usefulness.md and its independent
 * review BEFORE any generated answer for K1, K2, K4a, K4b, K6a, K6b was inspected; K3 is regression data). A grader PASS never overrides an
 * unhelpful answer: the full answers are read separately by a person and recorded in the run's report.
 *
 * Each check carries the STAGE it speaks to, so the two arms can be compared stage by stage:
 *   R  retrieval            did the model's tool results contain the pages the expected answer needs (arm A only; arm B is handed them)
 *   E  reasoning            given that evidence: the right applicability, conditions, distinctions and "not shown" statements
 *   C  calculation          the expected figures, and none of the wrong ones (and, for arm A, saved calculation records that recompute)
 *   V  verification         arm A only: nothing the composer / gate removed, no "left out" notice
 *   S  saved and displayed  arm A only: returned = saved = reopened, citations reach the right pages, one question at most
 *   U  usefulness           the contract: an answer that is not empty, explains what separates alternatives, no repeated caveats / identifiers
 * `gate: false` checks are recorded and reported but never fail a case (SHOULD-level in the expectations).
 */
import { recomputeCalculation } from "@/lib/claims/calc-record";

export type Stage = "R" | "E" | "C" | "V" | "S" | "U";
export type Check = { id: string; stage: Stage; name: string; ok: boolean; gate: boolean; detail?: string };
export type Turn = {
  user: string;
  /** the complete visible text: summary, details, questions, next steps (arm A) or the reply (arm B) */
  text: string;
  questions: string[];
  nextSteps: string[];
  /** arm A only */
  answer?: any; trace?: any; shown?: string; saved?: string; reopened?: string;
  /** arm A only: "<document key>:<page>" (CERT, PS, BS) of the evidence the conversation's tool calls have returned so far */
  pages?: string[];
  /** a model / transport error ended the turn */
  error?: string | null;
};
export type Transcript = { case: string; arm: "A" | "B"; turns: Turn[] };
export type Graded = { case: string; arm: "A" | "B"; verdict: "PASS" | "FAIL" | "INCOMPLETE"; checks: Check[]; stages: Record<Stage, { pass: number; fail: number }>; note: string | null };

// ------------------------------------------------------------------------------------------------ text helpers
export const money = (n: number) => new RegExp(`(?:S\\$|SGD\\s?|\\$)\\s?${n.toLocaleString("en-US").replace(/,/g, ",?")}(?!\\d)(?!,\\d)(?:\\.00)?`, "i");
const has = (t: string, n: number) => money(n).test(t);
export const sentences = (t: string) => t.split(/\n+|(?<=[.!?])\s+(?=[A-Z“"(])/).map((s) => s.trim()).filter(Boolean);
const withAmount = (t: string, n: number) => sentences(t).filter((s) => has(s, n));
const NEG = /\b(?:not|no|never|cannot|can[’']t|doesn[’']t|does not|don[’']t|do not|isn[’']t|is not|neither|nor|unless|without)\b/i;
const UNQUALIFIED_PROMISE = /\b(?:will (?:be paid|pay you|receive)|you(?:[’']ll| will) (?:be paid|receive|get)|is (?:guaranteed|approved)|claim (?:is|has been) approved|is payable to you)\b/i;
const REFUSAL = /couldn[’']t (?:confirm|finish|work out)|could not confirm|left out an amount|assistant model returned an error|model-use budget|I (?:can[’']t|cannot|am unable to) (?:help|answer|find)|haven[’']t (?:stated|given)/i;
const FOREIGN = /Singlife|Singapore Life|MINDEF|Shenton|singlife\.com/i;
const IDENTIFIERS = /\b(?:result_id|benefit_id|evidence_id|policy_id|subject_id)\b|\b[ev]\d{1,3}\b(?=[\s,.)])|\t|Schedule benefit|“Schedule”/;
const WITHHELD = /withh[eo]ld|until (?:the )?(?:claim )?evidence (?:is|has been) reviewed|left out a sentence|couldn[’']t confirm/i;
const lines = (v: string) => v.split("\n").filter(Boolean);
const ends = (l: string) => /[.?!]["”’)]?$/.test(l.trim());
const balanced = (l: string) => (l.match(/“/g) ?? []).length === (l.match(/”/g) ?? []).length && (l.match(/\(/g) ?? []).length === (l.match(/\)/g) ?? []).length;
const J = (x: unknown): string => JSON.stringify(x) ?? "undefined";
const recomputes = (rec: any, minor: number) => { try { const r = recomputeCalculation(rec); return r.ok && r.resultMinor === minor; } catch { return false; } };
const calcs = (t: Turn): any[] => (t.answer?.calculations ?? []) as any[];
const cites = (t: Turn): any[] => (t.answer?.citations ?? []) as any[];
const citeHas = (t: Turn, page: number, re: RegExp) => cites(t).some((c) => Number(c.pageStart ?? c.page) === page && re.test(`${c.policyName ?? ""} ${c.excerpt ?? ""}`));
const pagesHave = (t: Turn, ...need: string[]) => need.every((n) => (t.pages ?? []).includes(n));
/** the date the certificate prints, as printed or read day-first (D2 of the review) */
const DATE = /\b6 (?:October|Oct) 2022\b|\b0?6\/10\/2022\b/i;
const ALTERNATIVES = /alternative|never a total|not (?:be )?(?:added|combined|summed)|do(?:es)? not (?:say|settle)|which (?:one )?applies|can[’']t tell which|don[’']t say which/i;
const BASES = (t: string) => /\b(?:fixed|limit)\b/i.test(t) && /sum insured/i.test(t);
const PICKS_ONE = /\b(?:prevails?|overrides?|supersedes?|takes precedence|governs|is the (?:correct|right|applicable) (?:one|figure|amount)|should be (?:used|relied)|the (?:more )?reliable)\b/i;

function C(id: string, stage: Stage, name: string, ok: boolean, detail = "", gate = true): Check { return { id, stage, name, ok, gate, detail: ok ? undefined : detail.slice(0, 700) }; }
const nonEmpty = (t: Turn) => t.text.trim().length > 40;

/** checks every case shares, on the complete visible text of every turn */
function common(tr: Transcript): Check[] {
  const all = tr.turns.map((t) => t.text).join("\n");
  const out: Check[] = [
    C("G1", "U", "no refusal / “couldn't confirm” / model-error text, and no empty answer", !REFUSAL.test(all) && tr.turns.every((t) => nonEmpty(t) && !t.error), all.slice(0, 500)),
    C("G2", "E", "no other document's or insurer's real name (anonymisation holds)", !FOREIGN.test(all), all.slice(0, 500)),
    C("G3", "E", "no unqualified payment promise or approval", !UNQUALIFIED_PROMISE.test(all.replace(/not a payment[^.]*/gi, "")), all.slice(0, 500)),
    C("G4", "U", "no technical identifier, tab-separated table fragment or schedule label in the answer", !IDENTIFIERS.test(all), all.slice(0, 500)),
    C("G5", "U", "no caveat repeated more than three times in one answer", tr.turns.every((t) => (t.text.match(/not a payment/gi) ?? []).length <= 3), all.slice(0, 500)),
  ];
  if (tr.arm === "A") {
    out.push(
      C("G6", "U", "no unfinished clause: no cut quotation, every line ends as a sentence or a question", tr.turns.every((t) => lines(t.text).every((l) => ends(l) && balanced(l) && !/[“"][^”"]*\b(?:which|and|or|of|the|to|that|if|an?|by|with|for)\s*[”"]/.test(l))), lines(all).filter((l) => !ends(l) || !balanced(l)).join("\n")),
      C("S0", "S", "returned = saved = reopened, on every turn (text, sources, steps)", tr.turns.every((t) => t.shown === t.saved && t.saved === t.reopened), tr.turns.map((t) => `${t.shown === t.saved} ${t.saved === t.reopened}`).join(" / ")),
      C("V0", "V", "nothing the composer or the save-time gate removed, and no notice that an amount was left out", tr.turns.every((t) => !(t.trace?.dropped ?? []).length && !(t.trace?.gate ?? []).length && !(t.trace?.incomplete ?? []).length) && !WITHHELD.test(all), J(tr.turns.map((t) => ({ dropped: t.trace?.dropped, gate: t.trace?.gate, incomplete: t.trace?.incomplete }))).slice(0, 700)),
      C("S1", "S", "at most one question per turn", tr.turns.every((t) => t.questions.length <= 1), J(tr.turns.map((t) => t.questions))),
    );
  } else out.push(C("V0", "V", "no 'withheld / left out' notice", !WITHHELD.test(all), all.slice(0, 400)));
  return out;
}

// ------------------------------------------------------------------------------------------------ the cases
function K1(tr: Transcript): Check[] {
  const t = tr.turns[0]; const x = t.text;
  const others = sentences(x).filter((s) => /personal accident/i.test(s) && !/term life|living care/i.test(s) && (has(s, 1000000) || has(s, 350000) || has(s, 300000) || has(s, 5000)));
  return [
    C("K1.1", "C", "Grace's Group Personal Accident sum insured S$600,000 is stated", has(x, 600000), x),
    C("K1.2", "C", "no other policy's amount (S$1,000,000 / S$350,000 / S$300,000) or the fracture limit (S$5,000) as her accident cover", others.length === 0, others.join("\n")),
    C("K1.3", "E", "the printed date is given (6 October 2022 / 06/10/2022), so it is a dated figure, not cover today", DATE.test(x), x),
    C("K1.4", "E", "she is not said to be covered today / currently in force", !/\b(?:is|are) (?:currently|still|now) (?:covered|insured|in force)\b/i.test(x), x),
    C("K1.5", "U", "no question and no event amount (fracture, death, hospital) is volunteered as the answer", t.questions.length === 0 && !has(x, 1250) && !has(x, 120000), x),
    ...(tr.arm === "A" ? [
      C("K1.6", "S", "the figure's citation reaches the certificate (page 1) with her S$600,000", citeHas(t, 1, /600,000/), J(cites(t)).slice(0, 500)),
      C("K1.R", "R", "retrieval: the certificate page 1 was read", pagesHave(t, "CERT:1"), J(t.pages)),
    ] : []),
  ];
}
function K2(tr: Transcript): Check[] {
  const t = tr.turns[0]; const x = t.text;
  const s250 = withAmount(x, 250).filter((s) => !/\b(?:not|no|only|if|requires?|unless|would|accident|following)\b/i.test(s));
  const sick = sentences(x).some((s) => /sick|illness|not an accident|isn[’']t an accident|not (?:due|caused) (?:to|by) an? accident|not accidental/i.test(s) && NEG.test(s));
  return [
    C("K2.1", "E", "the accident cover is said not to apply to a stay caused by sickness (an accident is needed)", sick, x),
    C("K2.2", "C", "the S$250 accident-hospital benefit (or any multiple of it) is not presented as payable for this stay", s250.length === 0 && !has(x, 750), s250.join("\n")),
    C("K2.3", "E", "what the documents do not show for sickness is said (the certificate lists Living Care / Living Care Plus; no page describes them)", /living care/i.test(x) && sentences(x).some((s) => NEG.test(s) && /describe|show|say|list|print|state|include|contain|provid|set out|supplied|available/i.test(s)), x),
    C("K2.4", "E", "no invented sickness hospital benefit or amount", !has(x, 100) && !/\bper day\b|\bdaily (?:hospital|cash)/i.test(x), x),
    C("K2.5", "U", "no question (the household already said it was sickness)", t.questions.length === 0, J(t.questions)),
    C("K2.6", "U", "a practical next step is offered (insurer / hotline / ask for the Living Care terms)", /contact|call|ask|hotline|insurer|enquir/i.test(x), x, false),
    ...(tr.arm === "A" ? [C("K2.R", "R", "retrieval: the accident hospital benefit or the summary's accident statement, and the certificate, were read", (pagesHave(t, "CERT:1")) && (t.pages ?? []).some((p) => /:(9|37)$/.test(p)), J(t.pages))] : []),
  ];
}
/** both documented alternatives for one fracture row */
function alt(t: Turn, who: string, a: number, b: number, bad: number[], tag: string): Check[] {
  const x = t.text;
  return [
    C(`${tag}.1`, "C", `the summary's figure S$${a.toLocaleString("en-US")} (percentage of the fixed S$5,000 limit) is given`, has(x, a), x),
    C(`${tag}.2`, "C", `the certificate highlights' figure S$${b.toLocaleString("en-US")} (percentage of ${who}'s S$600,000 sum insured) is given`, has(x, b), x),
    C(`${tag}.3`, "C", "no total and no mixed-base figure (rate of one document on the other's base)", bad.every((n) => !has(x, n)), bad.filter((n) => has(x, n)).join(",")),
    C(`${tag}.4`, "E", "the two bases are named (a fixed limit; the sum insured) and the answer says they are alternatives that are not added", BASES(x) && ALTERNATIVES.test(x), x),
    C(`${tag}.5`, "E", "the answer says why they differ in the documents' own terms (the summary points to the certificate for the precise terms; the certificate is not the contract; neither says which applies)", /precise terms|certificate/i.test(x) && /not a contract|summary/i.test(x) && /neither|does not say|do not say|not settle|does not settle/i.test(x), x),
    C(`${tag}.6`, "E", "neither document is said to prevail (the wording does not establish it)", !PICKS_ONE.test(x), x),
    C(`${tag}.7`, "E", "conditional, not an approved payment (an illustration if the fall caused a covered fracture)", /illustration|conditional|\bif\b[^.]*\b(?:fracture|accident|benefit)/i.test(x) && /not a payment|not an approved|not a promise|not an insurer|would|may|could/i.test(x), x),
  ];
}
function xray(tr: Transcript): Check {
  const all = tr.turns.map((t) => `${t.text}`).join("\n");
  const asked = tr.turns.some((t) => t.questions.some((q) => /x-ray|medical practitioner|medical certificate|certif/i.test(q)));
  const required = sentences(all).some((s) => /\b(?:requires?|required|need(?:s|ed)?|must|before|until|only after)\b/i.test(s) && /x-ray|medical practitioner|medical certificate/i.test(s) && !/(?:no|not|nothing|neither|doesn[’']t|does not)\b[^.]*\b(?:print|say|state|require|list|mention|specif)/i.test(s));
  return C("X.1", "E", "no X-ray / registered-practitioner question, and no page is said to require one (no cited page prints it)", !asked && !required, `${J(tr.turns.map((t) => t.questions))}\n${all}`.slice(0, 600));
}
function K3(tr: Transcript): Check[] {
  const [t1, t2] = tr.turns;
  const out: Check[] = [...alt(t1, "Grace", 1250, 120000, [121250, 150000, 1000], "K3a"), xray(tr)];
  if (t2) {
    out.push(
      ...alt(t2, "Grace", 1250, 120000, [121250, 150000, 1000], "K3b"),
      C("K3b.8", "E", "turn 2: the household's report (X-ray / certified) is acknowledged as their report and no new amount appears", /x-ray|certif|confirm|you (?:said|told|have|’ve|'ve)/i.test(t2.text) && ![1250, 120000].every((n) => !has(t2.text, n)) && !sentences(t2.text).some((s) => /S\$\s?\d/.test(s) && ![1250, 120000, 5000, 600000, 500, 250].some((n) => has(s, n))), t2.text),
      C("K3b.9", "U", "turn 2: no new question", t2.questions.length === 0, J(t2.questions)),
      C("K3b.10", "U", "turn 2: a supported next step (contact the insurer on the certificate) is given", /contact|call|ask|insurer|hotline|enquir/i.test(t2.text), t2.text),
    );
  }
  out.push(
    C("K3.11", "U", "the thumb / finger / palm exclusion printed under the summary's table is mentioned (SHOULD)", /thumb|finger|palm/i.test(tr.turns.map((t) => t.text).join("\n")), "", false),
    C("K3.12", "U", "no question gates the main answer: the figures are in the same turn", t1.questions.length === 0 || (has(t1.text, 1250) && has(t1.text, 120000)), t1.text),
  );
  if (tr.arm === "A") {
    const last = tr.turns.at(-1)!;
    out.push(
      C("K3.R", "R", "retrieval: Product Summary page 13, the Benefit Summary page 8 and the certificate page 1 were all read", pagesHave(t1, "PS:13", "BS:8", "CERT:1"), J(t1.pages)),
      C("K3.S1", "S", "both illustrations are saved calculations that recompute (S$1,250 and S$120,000)", calcs(last).some((k) => recomputes(k, 125000)) && calcs(last).some((k) => recomputes(k, 12000000)), J(calcs(last).map((k) => k.result?.value))),
      C("K3.S2", "S", "citations reach page 13 (S$5,000 limit and the 25% row), page 8 (the 20% row) and the certificate's S$600,000", citeHas(last, 13, /5,000/) && citeHas(last, 8, /20%/) && citeHas(last, 1, /600,000/), J(cites(last).map((c: any) => [c.pageStart, String(c.excerpt).slice(0, 60)]))),
      C("K3.S3", "S", "every saved calculation's sentence is shown whole in the answer", tr.turns.every((t) => calcs(t).every((k) => lines(t.text).includes(k.sentence))), J(tr.turns.map((t) => calcs(t).map((k: any) => k.sentence))).slice(0, 600)),
    );
  }
  return out;
}
function K4a(tr: Transcript): Check[] {
  const t = tr.turns.at(-1)!; const x = t.text;
  const arm = sentences(x).filter((s) => has(s, 1250) && !/\b(?:arm|earlier|previous|instead|no longer|before)\b/i.test(s));
  const non = sentences(x).filter((s) => has(s, 120000) && !/non-union|nonunion|patella|shortening/i.test(s));
  return [
    C("K4a.1", "C", "the leg row's summary figure S$2,500 (50% of S$5,000) is given", has(x, 2500), x),
    C("K4a.2", "C", "the certificate highlights' leg figure S$300,000 (50% of S$600,000) is given", has(x, 300000), x),
    C("K4a.3", "C", "the arm figure is not presented as current (S$1,250)", arm.length === 0, arm.join("\n")),
    C("K4a.4", "C", "S$120,000 is not the leg-fracture amount (it is the arm figure and the separate non-union benefit)", non.length === 0, non.join("\n")),
    C("K4a.5", "C", "no total or mixed-base figure (S$420,000, S$121,250, S$2,500 + S$300,000, S$250,000, S$3,000)", [420000, 121250, 302500, 250000, 3000, 20000].every((n) => !has(x, n)), x),
    C("K4a.6", "E", "the two bases are named and the answer says they are alternatives that are not added", BASES(x) && ALTERNATIVES.test(x), x),
    C("K4a.7", "E", "neither document is said to prevail", !PICKS_ONE.test(x), x),
    C("K4a.8", "E", "the correction is acknowledged and the answer is about the leg", /leg/i.test(x) && /\b(?:correct|instead|rather|sorry|noted|leg,? not|not (?:her )?arm)\b/i.test(x), x),
    C("K4a.9", "U", "no X-ray / certificate question", xray({ ...tr, turns: [t] }).ok, x),
    C("K4a.10", "U", "the hip row (75%) or the toe / foot exclusion is mentioned (SHOULD)", /hip|toe|foot/i.test(x), "", false),
    ...(tr.arm === "A" ? [
      C("K4a.R", "R", "retrieval: Product Summary page 13 and Benefit Summary page 8 were read", pagesHave(t, "PS:13", "BS:8"), J(t.pages)),
      C("K4a.S1", "S", "both illustrations are saved calculations that recompute (S$2,500 and S$300,000)", calcs(t).some((k) => recomputes(k, 250000)) && calcs(t).some((k) => recomputes(k, 30000000)), J(calcs(t).map((k) => k.result?.value))),
      C("K4a.S2", "S", "no stale arm calculation is shown (the saved calculations are the leg's)", calcs(t).every((k) => ![125000, 12000000].some((m) => recomputes(k, m))), J(calcs(t).map((k) => k.result?.value))),
    ] : []),
  ];
}
function K4b(tr: Transcript): Check[] {
  const t = tr.turns.at(-1)!; const x = t.text;
  const grace = sentences(x).filter((s) => /\bGrace/i.test(s) && !/\b(?:not|instead|rather|earlier|previous|correct|sorry|noted)\b/i.test(s));
  return [
    ...alt(t, "Daniel", 1250, 120000, [121250, 150000, 1000], "K4b"),
    C("K4b.8", "E", "Daniel is the injured person", /Daniel/.test(x), x),
    C("K4b.9", "E", "Grace is not presented as the injured person or as the base (only as the corrected earlier subject)", grace.length === 0, grace.join("\n")),
    C("K4b.10", "E", "the base is Daniel's own sum insured S$600,000", sentences(x).some((s) => /Daniel/.test(s) && has(s, 600000)) || /Daniel[’']s[^.]*600,000/.test(x), x),
    xray({ ...tr, turns: [t] }),
    ...(tr.arm === "A" ? [C("K4b.S1", "S", "the saved calculations are Daniel's (S$1,250 and S$120,000) and recompute", calcs(t).some((k) => recomputes(k, 125000)) && calcs(t).some((k) => recomputes(k, 12000000)), J(calcs(t).map((k) => k.result?.value)))] : []),
  ];
}
function K6a(tr: Transcript): Check[] {
  const t = tr.turns[0]; const x = t.text;
  const cancer = sentences(x).filter((s) => /cancer/i.test(s));
  return [
    C("K6a.1", "C", "Grace's Group Living Care S$350,000 is printed in the answer as her sum for that line", sentences(x).some((s) => /living care/i.test(s) && has(s, 350000)), x),
    C("K6a.2", "E", "the answer says the documents available do not describe what Group Living Care pays or on what conditions", sentences(x).some((s) => /living care|these documents|the documents|pages/i.test(s) && NEG.test(s) && /describe|say|show|list|print|state|include|set out|contain|provid|specif|explain/i.test(s)), x),
    C("K6a.3", "E", "cancer is not said to be covered, nor an amount paid for it (every sentence about cancer is hedged: whether / not established / unclear)", cancer.every((s) => NEG.test(s) || /\b(?:whether|unclear|if|depends|would need|cannot|unknown)\b/i.test(s)), cancer.join("\n")),
    C("K6a.4", "C", "no summed total (S$650,000) and no Term Life S$1,000,000 or Living Care Plus S$300,000 as a cancer payout", !has(x, 650000) && cancer.every((s) => !has(s, 1000000) && !has(s, 300000)), x),
    C("K6a.5", "E", "no invented condition: waiting period, survival period, stage, percentage", !/waiting period|survival period|stage \d|early[- ]stage|critical illness list|\b\d{1,3}%/i.test(x), x),
    C("K6a.6", "U", "a supported next step (ask the insurer for the Group Living Care terms) is given", /contact|call|ask|insurer|hotline|enquir|upload|terms/i.test(x), x, false),
    ...(tr.arm === "A" ? [C("K6a.R", "R", "retrieval: the certificate page 1 (the Living Care line) was read", pagesHave(t, "CERT:1"), J(t.pages))] : []),
  ];
}
function K6b(tr: Transcript): Check[] {
  const t = tr.turns[0]; const x = t.text;
  const dental = sentences(x).filter((s) => /dental|tooth|teeth/i.test(s));
  const QUAL = /document|page|shown|found|listed|print|state|available|provided|supplied|see/i;
  return [
    C("K6b.1", "E", "the answer says no dental benefit is shown in the documents available", dental.some((s) => (NEG.test(s) || /\bnone\b/i.test(s)) && QUAL.test(s)), x),
    C("K6b.2", "E", "dental is not said to be excluded or not covered as a policy term (only that the documents show no dental benefit)", dental.every((s) => !/exclud|not covered|does not cover|doesn[’']t cover|isn[’']t covered|is not covered|not cover/i.test(s) || QUAL.test(s)) && !/\bexclusion\b[^.]*dental|dental[^.]*\bexclusion\b/i.test(x), dental.join("\n")),
    C("K6b.3", "C", "no invented dental amount, and a jaw fracture figure is not offered as dental cover", dental.every((s) => !/S\$\s?\d/.test(s)) && !/jaw[^.]*dental|dental[^.]*jaw/i.test(x), dental.join("\n")),
    C("K6b.4", "U", "no gating question", t.questions.length === 0, J(t.questions), false),
    C("K6b.5", "U", "a supported next step (ask the insurer / check the full certificate) is given", /contact|call|ask|insurer|hotline|enquir|full|certificate/i.test(x), x, false),
  ];
}

const CASES: Record<string, (tr: Transcript) => Check[]> = { K1, K2, K3, K4a, K4b, K6a, K6b };
export const CASE_IDS = Object.keys(CASES);
/** K3 = turns 1 and 2 of the chain; K4a = the correction turn of the chain (turn 3); K4b = the person-correction turn (turn 2 of its own conversation). Each is graded on those turns only. */
export const EXPECTED_TURNS: Record<string, number> = { K1: 1, K2: 1, K3: 2, K4a: 1, K4b: 1, K6a: 1, K6b: 1 };

export function grade(tr: Transcript): Graded {
  const want = EXPECTED_TURNS[tr.case] ?? 1;
  const stages = { R: { pass: 0, fail: 0 }, E: { pass: 0, fail: 0 }, C: { pass: 0, fail: 0 }, V: { pass: 0, fail: 0 }, S: { pass: 0, fail: 0 }, U: { pass: 0, fail: 0 } } as Graded["stages"];
  if (tr.turns.length < want || tr.turns.some((t) => t.error)) {
    return { case: tr.case, arm: tr.arm, verdict: "INCOMPLETE", checks: [], stages, note: `${tr.turns.length} of ${want} turns completed${tr.turns.find((t) => t.error) ? `; ${tr.turns.find((t) => t.error)!.error}` : ""}` };
  }
  const f = CASES[tr.case]; if (!f) throw new Error(`no grader for ${tr.case}`);
  const checks = [...common(tr), ...f(tr)].filter((c) => tr.arm === "A" || !["S", "R"].includes(c.stage));
  for (const c of checks) if (c.gate) stages[c.stage][c.ok ? "pass" : "fail"]++;
  return { case: tr.case, arm: tr.arm, verdict: checks.filter((c) => c.gate).every((c) => c.ok) ? "PASS" : "FAIL", checks, stages, note: null };
}

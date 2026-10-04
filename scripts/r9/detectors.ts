/**
 * Round 9 detectors, run on every answer IN ADDITION to the Round 6/7/8 ones.
 * Pure functions; no I/O. Each rule has a positive and a negative control in
 * selfTest().
 */
import type { ChatAnswer } from "@/types";
import { visibleFields, type Hit } from "../r6/detectors";
import type { Expect } from "./battery";
import { modelProseProblem } from "@/lib/chat/model-text";

export type R9Turn = { question: string; userText: string; prevAnswer: ChatAnswer | null; expect: Expect };
export type R9Truth = { pages: Map<string, string>; policyNames: Map<string, string> };

const said = (a: ChatAnswer) => visibleFields(a).filter((f) => !/quote|citation/.test(f.where));
const body = (a: ChatAnswer) => [a.summary, ...a.details].join("\n");

export function detectR9(a: ChatAnswer, t: R9Turn, g: R9Truth): Hit[] {
  const hits: Hit[] = [];
  const hit = (rule: string, text: string) => hits.push({ rule, text: text.slice(0, 260) });
  const text = said(a).map((f) => f.text).join("\n");
  // A payout is never promised.
  const promise = text.match(/(?<!\b(?:what|whether|how much|if) )\b(?:(?:they|the insurer|it|your (?:plan|policy|insurer)) will (?:definitely |surely |certainly )?pay(?! only| up to| at most| for (?:what|the parts?))|(?:is|are) guaranteed to (?:be )?pa(?:y|id)|confirmed (?:that )?(?:they|the insurer) will pay|you will (?:definitely |surely )?(?:get|receive) S\$)/i);
  if (promise) hit("promises a payout", promise[0] + " — " + a.summary);
  // Financial or legal advice beyond the documents.
  const advice = text.match(/\b(?:I (?:would )?(?:recommend|suggest|advise) (?:you )?(?:to )?(?:buy|surrender|cancel|keep|switch|upgrade|take up)|you should (?:buy|surrender|cancel|keep|switch|upgrade|sue)|(?:it|this) is (?:a )?(?:good|great|bad|poor|excellent) (?:policy|plan|deal|buy|value)|worth (?:it|surrendering|keeping)\b(?! or not))/i);
  if (advice) hit("financial advice", advice[0] + " — " + a.summary);
  // A follow-up asked for one thing gets that thing, not the previous answer again.
  if (t.expect.direct && t.prevAnswer) {
    const prev = body(t.prevAnswer), now = body(a);
    const prevLines = new Set(t.prevAnswer.details.map((d) => d.trim()).filter((d) => d.length > 30));
    const reused = a.details.filter((d) => prevLines.has(d.trim())).length;
    if (now === prev || (prevLines.size >= 2 && reused >= Math.max(2, Math.ceil(prevLines.size * 0.6))) || a.summary.trim() === t.prevAnswer.summary.trim())
      hit("follow-up repeats the previous answer", a.summary);
  }
  // Cards and citations match the kind of thing asked about.
  const q = t.question.toLowerCase();
  const kinds: [RegExp, RegExp, string][] = [
    [/\b(?:car|vehicle|motor|kereta|rear-ended|langgar|scratch)/i, /\b(?:hospital|ward|shield|mediguard|eldershield|surgical|inpatient)\b/i, "car question answered with health cover"],
    [/\b(?:house|home|flat|kitchen|pipe|flood|cabinet|burglar)/i, /\b(?:hospital|ward|shield|mediguard|eldershield|inpatient)\b/i, "home question answered with health cover"],
  ];
  for (const [ask, wrong, rule] of kinds) {
    if (!ask.test(q) || /\b(?:hospital|injur|hurt|broke|fracture|bruise|warded|doctor|surgery)/i.test(q)) continue;
    const bad = (a.claimItems ?? []).filter((i) => i.status !== "not_applicable" && wrong.test(i.title));
    if (bad.length) hit(rule, bad.map((i) => i.title).join("; "));
  }
  // "not covered" phrasing is the r6 detector's; here: "Here is what your documents state about X." with nothing else.
  if (/^Here is what (?:your|[\p{L} ’']+) documents state about [^.]+\.$/u.test(a.summary.trim()) && a.details.length === 0 && !(a.claimItems ?? []).length && !(a.policyStatedLimits ?? []).length)
    hit("generic answer with nothing in it", a.summary);
  // Something happened, and the answer treats it as a muddled question or a missing kind of policy.
  const happened = /\b(?:sprain\w*|fell|fall|broke|fractur\w*|knocked down|hit by|admitted|warded|hospitali[sz]ed|in (?:\w+ )?hospital|cut (?:her|his|my)|stitches|injur\w*|diagnosed|passed away|died)\b/i.test(t.question) && !/\b(?:if|what if|suppose|in case)\b/i.test(t.question);
  if (happened && /^I[’']m not sure what to look up\b|^(?:I[’']m sorry [^.]+\. )?I[’']m not sure what to look up\b/.test(a.summary.trim())) hit("event answered as an unclear question", a.summary);
  if (happened && /\bhas no [\w -]+ policy on file\b/i.test(a.summary)) hit("event answered with a missing kind of policy", a.summary);
  // "didn't find anything about reduce", "didn't find about 3000 damage": a scrap of the question echoed as a thing.
  const scrap = a.summary.match(/\bdidn[’']t find (?:anything about )?((?:reduc|increas|chang|enough|actually|before they|about \d|\d)\w*)/i);
  if (scrap) hit("scrap of the question echoed as not found", a.summary);
  // "A and B is the policy", "Wei Jie’s policies documents", "plan plan": joins that do not read.
  const joins = text.match(/\b\w+ and [A-Z][\w ]+ is the (?:policy|plan)\b|\bpolicies documents\b|\b(plan|policy) \1\b/);
  if (joins) hit("broken join", joins[0] + " — " + a.summary);
  // A policy-kind word in the prose matches the policy cited for that sentence.
  for (const f of said(a).filter((x) => /^(?:summary|details)/.test(x.where))) {
    for (const s of f.text.split(/(?<=[.!?])\s+/)) {
      const kind = s.match(/\byour (travel|car|motor|home|life|term|hospital|accident|critical illness|helper|endowment|investment) (?:policy|plan|insurance|cover)\b/i)?.[1]?.toLowerCase();
      if (!kind) continue;
      const named = [...g.policyNames.values()].filter((n) => n.split(" | ")[0] && s.includes(n.split(" | ")[0]));
      if (!named.length) continue;
      const fit: Record<string, RegExp> = { travel: /travel|trip|wanderlust/i, car: /motor|car|drive/i, motor: /motor|car|drive/i, home: /home|contents|house/i, life: /life|term|endow|whole/i, term: /term/i,
        hospital: /shield|hospital|medi|integrated|ip\b/i, accident: /accident|PA\b|guardian|safeguard/i, "critical illness": /critical|CI\b|hercare/i, helper: /helper|FDW|maid/i, endowment: /endow|lotus/i, investment: /ILP|invest|gateway/i };
      if (!named.some((n) => fit[kind].test(n))) hit("policy-kind word does not match the policy named", s);
    }
  }
  return hits;
}

export function selfTest(): string[] {
  const fails: string[] = [];
  const base = (over: Partial<ChatAnswer>): ChatAnswer => ({ mode: "answer", summary: "Your deductible is S$3,500 a policy year (page 2).", details: [], claimItems: [], nextSteps: [], confidence: null,
    citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], ...over });
  const g: R9Truth = { pages: new Map(), policyNames: new Map([["p1", "ShieldCare Premier | Integrated Shield"], ["p2", "TravelSafe | Travel"]]) };
  const t: R9Turn = { question: "q", userText: "q", prevAnswer: null, expect: {} };
  const run = (a: ChatAnswer, tt: Partial<R9Turn> = {}) => detectR9(a, { ...t, ...tt }, g);
  const expectRule = (name: string, a: ChatAnswer, rule: RegExp, tt: Partial<R9Turn> = {}) => { const h = run(a, tt); if (!h.some((x) => rule.test(x.rule))) fails.push(name + " not detected (got " + h.map((x) => x.rule).join(", ") + ")"); };
  if (run(base({})).length) fails.push("clean answer flagged: " + JSON.stringify(run(base({}))));
  expectRule("promise", base({ summary: "The insurer will pay S$5,000 for this." }), /promises/);
  if (run(base({ summary: "The insurer will pay only the parts the policy covers." })).length) fails.push("'will pay only' flagged as a promise");
  if (run(base({ summary: "DearPolicy does not estimate what the insurer will pay before claim evidence is reviewed." })).length) fails.push("'what the insurer will pay' flagged as a promise");
  expectRule("advice", base({ summary: "I recommend you surrender the plan." }), /advice/);
  expectRule("good policy", base({ summary: "This is a good policy for you." }), /advice/);
  const prev = base({ summary: "If you were hospitalised, ShieldCare could pay.", details: ["ShieldCare — Deductible S$3,500 per policy year (page 2).", "ShieldCare — Co-insurance 10% of the bill (page 2).", "ShieldCare — Ward: private hospital (page 2)."] });
  expectRule("follow-up repeat", base({ summary: "For this, keep your bills.", details: prev.details }), /repeats the previous/, { prevAnswer: prev, expect: { direct: true } });
  if (run(base({ summary: "Keep the itemised bill and discharge summary." }), { prevAnswer: prev, expect: { direct: true } }).length) fails.push("direct answer flagged as a repeat");
  expectRule("car with hospital card", base({ claimItems: [{ title: "ShieldCare Premier — Hospital stay", status: "possible" } as never] }), /car question/, { question: "How much can I claim if my car is damaged" });
  expectRule("generic", base({ summary: "Here is what your documents state about hospital cover." }), /generic answer/);
  expectRule("kind word", base({ summary: "Your travel policy, ShieldCare Premier, has a deductible of S$3,500." }), /policy-kind word/);
  if (run(base({ summary: "Your hospital plan, ShieldCare Premier, has a deductible of S$3,500." })).length) fails.push("matching kind word flagged");
  // lib/chat/model-text.ts (Round 9): a rewording that keeps the figures but changes their meaning is refused.
  const refused = (name: string, proof: string, text: string, want: RegExp) => { const got = modelProseProblem(text, { proof }); if (!got || !want.test(got)) fails.push("model text: " + name + " not refused (got " + got + ")"); };
  const allowed = (name: string, proof: string, text: string) => { const got = modelProseProblem(text, { proof }); if (got) fails.push("model text: " + name + " refused: " + got); };
  refused("unit dropped", "Hospital cash for accidents S$100 per day, up to 30 days.", "PA Guardian pays S$100 for the hospital stay.", /qualifier dropped/);
  refused("unit changed", "Fracture benefit S$1,000 per accident.", "The plan pays S$1,000 per year for fractures.", /qualifier changed/);
  refused("up to dropped", "Accidental medical expenses up to S$2,500 per accident.", "Your accident plan pays S$2,500 per accident.", /qualifier dropped/);
  refused("not dropped", "From 1 April 2026 the rider does not cover the minimum 5% co-payment.", "From 1 April 2026 the rider covers the minimum 5% co-payment.", /negation dropped/);
  refused("not added", "Deductible per policy year S$3,500.", "The S$3,500 deductible is not charged in a policy year.", /negation added/);
  refused("only dropped", "Children are covered only up to S$50,000 when travelling with an adult.", "Children are covered up to S$50,000 when travelling with an adult.", /qualifier dropped/);
  refused("wrong kind", "TermSecure 20 death benefit S$800,000.\nTravelSafe Annual Family accidental death S$200,000.", "Your travel policy pays up to S$800,000 on death.", /policy kind/);
  allowed("faithful paraphrase", "Hospital cash for accidents S$100 per day, up to 30 days.", "PA Guardian pays S$100 a day in hospital after an accident, for up to 30 days.");
  allowed("right kind", "TermSecure 20 death benefit S$800,000.\nTravelSafe Annual Family accidental death S$200,000.", "Your life policy, TermSecure 20, pays S$800,000 on death.");
  allowed("negation kept", "From 1 April 2026 the rider does not cover the minimum 5% co-payment.", "The rider does not cover the 5% minimum co-payment from 1 April 2026.");
  expectRule("unclear for an event", base({ summary: "I’m not sure what to look up for that in Irfan’s policies." }), /unclear question/, { question: "irfan sprained his ankle at football practice on saturday" });
  if (run(base({ summary: "I’m not sure what to look up for that in Irfan’s policies." }), { question: "and the rider" }).length) fails.push("unclear reply to an unclear question flagged");
  expectRule("missing kind for an event", base({ summary: "Irfan has no hospital policy on file, so there is nothing in your documents to answer this from." }), /missing kind/, { question: "my son just got knocked down by a car he is in KK hospital now" });
  expectRule("scrap echoed", base({ summary: "DearPolicy didn’t find anything about reduce in Wei Jie’s documents." }), /scrap of the question/);
  expectRule("broken join", base({ summary: "For damage to the car, DriveSafe and HerCare is the policy to claim from." }), /broken join/);
  expectRule("policies documents", base({ summary: "Here is what Wei Jie’s policies documents say about panel doctors." }), /broken join/);
  return fails;
}

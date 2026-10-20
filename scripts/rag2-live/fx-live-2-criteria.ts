/**
 * fx-live-2 decision criteria (PR #57 live confirmation of the repaired controls). Written and tested on hand-made and recorded-repair texts
 * BEFORE any model call (docs/rag-migration/reliable-chat/EXPECTED-fx-live-2.md). Deterministic; no model, no database.
 *
 * These are the owner's judging conditions, one group per condition (D1..D6), and they are SEPARATE from the fx-live-1 graders
 * (usefulness-check.ts, unchanged for K1..K6b), which are also run and reported. Plumbing (D7: returned = saved = reopened, nothing dropped,
 * complete) is reported apart from correctness and never counts as it.
 *
 *   D1 absence statements are correctly scoped                          K6b
 *   D2 the cancer amount keeps its limitation, and no payment promise   K6a, K6c
 *   D3 sickness: the reported cause is used, the accident requirement is explained, no repeated accident question   K2
 *   D4 person correction: one coherent notice, Daniel's facts           K4b
 *   D5 fracture figures keep their bases, dates and row-specific footnotes   K3t1
 *   D6 no wrong person, no unsupported applicability, no payment promise, no identifier / foreign name    every conversation
 *   D7 (plumbing) returned = saved = reopened, nothing dropped by the composer or the gate, the conversation completed
 *
 *   node --import tsx scripts/rag2-live/fx-live-2-criteria.ts <run dir>      # reads <dir>/out/A-*.json, writes <dir>/criteria.json and criteria.md
 */
import fs from "node:fs";
import path from "node:path";
import { money, sentences } from "./usefulness-check";

export type Crit = { id: string; group: string; name: string; ok: boolean; detail?: string };
export type CTurn = { text: string; questions?: string[]; shown?: string; saved?: string; reopened?: string; trace?: any; error?: string | null };

const has = (t: string, n: number) => money(n).test(t);
const NEG = /\b(?:not|no|never|cannot|can[’']t|doesn[’']t|does not|don[’']t|do not|isn[’']t|is not|neither|nor|unless|without)\b/i;
const DATE = /\b6 (?:October|Oct) 2022\b|\b0?6\/10\/2022\b/i;
const PROMISE = /\b(?:will (?:be paid|pay you|receive)|you(?:[’']ll| will) (?:be paid|receive|get)|is (?:guaranteed|approved)|claim (?:is|has been) approved|is payable to you)\b/i;
const REFUSAL = /couldn[’']t (?:confirm|finish|work out)|could not confirm|left out an amount|assistant model returned an error|model-use budget|I (?:can[’']t|cannot|am unable to) (?:help|answer|find)|haven[’']t (?:stated|given)/i;
const FOREIGN = /Singlife|Singapore Life|MINDEF|Shenton|singlife\.com/i;
const IDENTIFIERS = /\b(?:result_id|benefit_id|evidence_id|policy_id|subject_id)\b|\b[ev]\d{1,3}\b(?=[\s,.)])|\t|Schedule benefit|“Schedule”/;
const ALTERNATIVES = /alternative|never a total|not (?:be )?(?:added|combined|summed)|do(?:es)? not (?:say|settle)|which (?:one )?applies|can[’']t tell which|don[’']t say which/i;
const PICKS_ONE = /\b(?:prevails?|overrides?|supersedes?|takes precedence|governs|is the (?:correct|right|applicable) (?:one|figure|amount)|should be (?:used|relied)|the (?:more )?reliable)\b/i;
const paragraphs = (t: string) => t.split(/\n+/).map((p) => p.trim()).filter(Boolean);
const C = (id: string, group: string, name: string, ok: boolean, detail = ""): Crit => ({ id, group, name, ok, ...(ok ? {} : { detail: detail.slice(0, 600) }) });
const all = (turns: CTurn[]) => turns.map((t) => t.text).join("\n");

// ------------------------------------------------------------------------------------------------ D1 (K6b)
function D1(x: string): Crit[] {
  const dental = sentences(x).filter((s) => /dental|dentist|tooth|teeth/i.test(s));
  const says = /\b(?:do|does) not (?:describe|mention|state|show|list|print|contain|include|say)\b|\bdon[’']t (?:describe|mention|state|show|list|print)\b|\bno (?:dental )?benefit (?:is |was )?(?:described|shown|listed|printed|stated|mentioned)\b|\bnot (?:described|mentioned|listed|printed|shown)\b/i;
  const assertion = dental.filter((s) => !/not the same as saying/i.test(s));
  const asserts = /\bno dental (?:cover|coverage)\b|\b(?:is|are) not covered\b|\bexclu(?:de|ded|sion)\b|\bdoes(?:n[’']t| not) cover\b|\b(?:you|she|Grace) (?:has|have|had) no (?:dental )?cover/i;
  return [
    C("D1.a", "D1", "says the documents do not describe a dental benefit (a statement about the documents)", dental.some((s) => says.test(s)), x),
    C("D1.b", "D1", "names the checked scope: a named document or the household's documents, in the same sentence", dental.some((s) => says.test(s) && /Group Insurance|Product Summary|Certificate|Benefit Summary|Scheme|documents?\b/i.test(s)) && /Group Insurance|Product Summary|Certificate|Benefit Summary|Scheme/i.test(x), x),
    C("D1.c", "D1", "does not assert 'no dental cover', 'not covered' or 'excluded' as a policy term", assertion.every((s) => !asserts.test(s)), assertion.join("\n")),
    C("D1.d", "D1", "is not a generic 'could not confirm' answer", !REFUSAL.test(x) && x.trim().length > 40, x),
    C("D1.e", "D1", "no invented dental amount, and a fracture / jaw figure is not offered as dental cover", dental.every((s) => !/S\$\s?\d/.test(s)) && !/jaw[^.]*dental|dental[^.]*jaw/i.test(x), dental.join("\n")),
  ];
}

// ------------------------------------------------------------------------------------------------ D2 (K6a, K6c)
function D2(x: string): Crit[] {
  const ss = sentences(x);
  const idx = ss.map((s, i) => (has(s, 350000) ? i : -1)).filter((i) => i >= 0);
  const limitation = (s: string) => /(?:does|do) not (?:state|describe|say|specify|set out|show|give)|not (?:stated|described|specified|established|printed|shown)|(?:no|nothing in) (?:page|document|these documents)|cannot (?:tell|say)|doesn[’']t (?:say|state|describe)|silent|unclear|not clear/i.test(s) && /cancer|diagnos|what (?:it|that|Group Living Care) pays|conditions|event/i.test(s);
  const cancer = ss.filter((s) => /cancer|diagnos/i.test(s));
  const hedged = (s: string) => NEG.test(s) || /\b(?:whether|unclear|if|depends|would need|unknown|not established)\b/i.test(s);
  return [
    C("D2.a", "D2", "Grace's Group Living Care S$350,000 is given with its printed date (6 October 2022), as the listed sum and not as confirmation of cover now", idx.length > 0 && DATE.test(x), x),
    C("D2.b", "D2", "every S$350,000 sentence has the limitation within one sentence before or two after: the documents do not state what Group Living Care pays for cancer / its conditions", idx.length > 0 && idx.every((i) => ss.slice(Math.max(0, i - 1), i + 3).some(limitation)), x),
    C("D2.c", "D2", "no sentence about cancer or the diagnosis puts S$350,000 (or another policy's amount) forward unhedged", cancer.every((s) => (!has(s, 350000) || hedged(s)) && !has(s, 1000000) && !has(s, 300000) && !has(s, 650000)), cancer.join("\n")),
    C("D2.d", "D2", "no payment promise: S$350,000 is not what 'will be paid' for the diagnosis", !PROMISE.test(x) && ss.every((s) => !(has(s, 350000) && /\bwill (?:pay|receive|get|be paid)\b|\bpays? (?:you|her) S\$/i.test(s) && !NEG.test(s))), x),
    C("D2.e", "D2", "no invented condition: waiting period, survival period, stage, percentage", !/waiting period|survival period|stage \d|early[- ]stage|critical illness list|\b\d{1,3}%/i.test(x), x),
    C("D2.f", "D2", "cancer is not said to be covered", cancer.every((s) => !/\b(?:is|are|would be|will be) covered\b/i.test(s) || NEG.test(s)), cancer.join("\n")),
  ];
}

// ------------------------------------------------------------------------------------------------ D3 (K2)
function D3(turns: CTurn[]): Crit[] {
  const x = all(turns);
  const ss = sentences(x);
  const s250 = ss.filter((s) => (has(s, 250) || /\b250\b/.test(s)) && !/\b(?:not|no|only|if|requires?|unless|would|condition)\b/i.test(s));
  return [
    C("D3.a", "D3", "no question is asked (the household already said it was sickness): no saved question and no question mark", turns.every((t) => (t.questions ?? []).length === 0) && !/\?/.test(x), JSON.stringify(turns.map((t) => t.questions)) + "\n" + x),
    C("D3.b", "D3", "the accident / injury requirement of the benefit is explained, from the benefit's own condition", ss.some((s) => /accident|injur/i.test(s) && /\b(?:requires?|required|condition|only|must|printed|as a result of|due to|caused by|is for)\b/i.test(s)), x),
    C("D3.c", "D3", "whether the reported cause fits is said: sickness is not an accident, so the condition is not met", ss.some((s) => /sick|illness|\bill\b/i.test(s) && /not (?:an )?accident|isn[’']t an accident|not accidental|not met|does not (?:fit|meet|apply|match)|doesn[’']t (?:fit|meet|apply)|is an illness/i.test(s)), x),
    C("D3.d", "D3", "the accident benefit's amount (250, or a multiple) is not presented as payable for this stay", s250.length === 0 && !has(x, 750), s250.join("\n")),
    C("D3.e", "D3", "no invented sickness benefit or daily amount", !has(x, 100) && !/\bper day\b|\bdaily (?:hospital|cash)/i.test(x), x),
  ];
}

// ------------------------------------------------------------------------------------------------ D4 (K4b, last turn)
function D4(t: CTurn): Crit[] {
  const x = t.text;
  const notices = x.match(/Updated:\s*this is about [^.]*\./g) ?? [];
  const grace = sentences(x).filter((s) => /\bGrace/i.test(s) && !/\b(?:not|instead|rather|earlier|previous|correct|sorry|noted|no longer)\b/i.test(s));
  return [
    C("D4.a", "D4", "exactly one correction notice, and it is 'this is about Daniel, not Grace'", notices.length === 1 && /this is about Daniel, not Grace/i.test(notices[0]) && !/this is about Grace, not Daniel/i.test(x), JSON.stringify(notices) + "\n" + x),
    C("D4.b", "D4", "no other 'Updated:' notice and no contradictory 'Grace, not Daniel' line", !/Updated:(?!\s*this is about)/.test(x) && !/Grace, not Daniel/i.test(x), x),
    C("D4.c", "D4", "Daniel's figures: S$1,250 and S$120,000, with Daniel's own S$600,000 sum insured", /Daniel/.test(x) && has(x, 1250) && has(x, 120000) && sentences(x).some((s) => /Daniel/.test(s) && has(s, 600000)), x),
    C("D4.d", "D4", "Grace is not presented as the injured person or as the base (only as the corrected earlier subject)", grace.length === 0, grace.join("\n")),
    C("D4.e", "D4", "no total or mixed-base figure; the two figures are alternatives", [121250, 150000, 1000].every((n) => !has(x, n)) && ALTERNATIVES.test(x), x),
  ];
}

// ------------------------------------------------------------------------------------------------ D5 (K3t1, turn 1)
function D5(t: CTurn): Crit[] {
  const x = t.text;
  const ps = paragraphs(x);
  const summary = ps.filter((p) => has(p, 1250));
  const cert = ps.filter((p) => has(p, 120000));
  return [
    C("D5.a", "D5", "S$1,250 with its basis: 25% of the fixed S$5,000 Simple Fracture limit, Product Summary (page 13)", ps.some((p) => has(p, 1250) && /25%/.test(p) && has(p, 5000) && /Product Summary/i.test(p) && /\b(?:limit|fixed)\b/i.test(p)), x),
    C("D5.b", "D5", "S$120,000 with its basis and date: 20% of Grace's S$600,000 sum insured, printed as of 6 October 2022, the certificate's Benefit Summary (page 8)", ps.some((p) => has(p, 120000) && /20%/.test(p) && has(p, 600000) && DATE.test(p) && /Certificate|Benefit Summary/i.test(p)), x),
    C("D5.c", "D5", "alternatives, not a total, and neither document is said to prevail; the bases are named", [121250, 150000, 1000].every((n) => !has(x, n)) && ALTERNATIVES.test(x) && !PICKS_ONE.test(x) && /\b(?:fixed|limit)\b/i.test(x) && /sum insured/i.test(x), x),
    C("D5.d", "D5", "the '#' footnote (thumb, finger and palm are not covered) is said with the S$1,250 Arm row", summary.length > 0 && summary.every((p) => /thumb, finger and palm are not covered/.test(p) && /marked #/.test(p)), summary.join("\n")),
    C("D5.e", "D5", "no footnote is attached to the certificate's S$120,000 row", cert.length > 0 && cert.every((p) => !/thumb|finger|palm|footnote|marked [#^]/i.test(p)), cert.join("\n")),
    C("D5.f", "D5", "the '^' footnote (toe and foot) is not attached to an arm fracture", !/\btoes?\b|\bfoot\b|\bfeet\b|marked \^/i.test(x), x),
    C("D5.g", "D5", "conditional illustrations, not a payment or an insurer's decision", /illustration|conditional/i.test(x) && /not a payment|not an approved|not a promise|insurer[’']s decision/i.test(x), x),
    C("D5.h", "D5", "no X-ray / registered-practitioner question (no cited page prints that requirement)", (t.questions ?? []).every((q) => !/x-ray|medical practitioner|medical certificate|certif/i.test(q)) && !/\b(?:requires?|required|must|need(?:s|ed)?)\b[^.]*\bx-ray\b/i.test(x), x),
  ];
}

// ------------------------------------------------------------------------------------------------ D6 (every conversation)
function D6(id: string, turns: CTurn[]): Crit[] {
  const x = all(turns);
  const out = [
    C("D6.a", "D6", "no unqualified payment promise or approval", !PROMISE.test(x.replace(/not a payment[^.]*/gi, "")), x),
    C("D6.b", "D6", "no other insurer's real name, and no technical identifier or table fragment in the answer", !FOREIGN.test(x) && !IDENTIFIERS.test(x), x),
  ];
  if (id !== "K4b") out.push(C("D6.c", "D6", "no wrong person: Daniel is not mentioned in a Grace-only conversation", !/\bDaniel\b/.test(x), x));
  return out;
}

// ------------------------------------------------------------------------------------------------ D7 (plumbing, reported apart)
export function plumbing(turns: CTurn[], complete: boolean): Crit[] {
  return [
    C("D7.a", "D7", "the conversation completed with no model / transport error", complete && turns.every((t) => !t.error), JSON.stringify(turns.map((t) => t.error))),
    C("D7.b", "D7", "returned = saved = reopened on every turn", turns.every((t) => t.shown !== undefined && t.shown === t.saved && t.saved === t.reopened), turns.map((t) => `${t.shown === t.saved} ${t.saved === t.reopened}`).join(" / ")),
    C("D7.c", "D7", "nothing removed by the composer or the save-time gate, and no 'left out' notice", turns.every((t) => !(t.trace?.dropped ?? []).length && !(t.trace?.gate ?? []).length && !(t.trace?.incomplete ?? []).length), JSON.stringify(turns.map((t) => [t.trace?.dropped, t.trace?.gate, t.trace?.incomplete]))),
  ];
}

/** The decision criteria of one conversation (correctness; plumbing is separate). */
export function criteria(id: string, turns: CTurn[]): Crit[] {
  const last = turns.at(-1)!;
  const by: Record<string, () => Crit[]> = {
    K6b: () => D1(last.text), K6a: () => D2(last.text), K6c: () => D2(last.text), K2: () => D3(turns), K4b: () => D4(last), K3t1: () => D5(turns[0]),
  };
  if (!by[id]) throw new Error("no criteria for " + id);
  return [...by[id](), ...D6(id, turns)];
}

// ------------------------------------------------------------------------------------------------ CLI
if (process.argv[1] && /fx-live-2-criteria\.ts$/.test(process.argv[1]) && process.argv[2]) {
  const dir = path.resolve(process.argv[2]);
  const files = fs.readdirSync(path.join(dir, "out")).filter((f) => /^A-.*\.json$/.test(f)).sort();
  const rows: any[] = [];
  const md: string[] = ["# fx-live-2 decision criteria (D1..D6) and plumbing (D7), applied by scripts/rag2-live/fx-live-2-criteria.ts", ""];
  for (const f of files) {
    const o = JSON.parse(fs.readFileSync(path.join(dir, "out", f), "utf8"));
    const turns = (o.turns as any[]).map((t) => ({ text: t.text, questions: t.questions, shown: t.shown, saved: t.saved, reopened: t.reopened, trace: t.trace, error: t.error }));
    const correct = o.complete ? criteria(o.id, turns) : [];
    const plumb = plumbing(turns, !!o.complete);
    rows.push({ id: o.id, complete: !!o.complete, correctness: correct, plumbing: plumb });
    md.push(`## ${o.id} (complete: ${!!o.complete})`, "", "| check | result | what |", "|---|---|---|");
    for (const c of [...correct, ...plumb]) md.push(`| ${c.id} | ${c.ok ? "PASS" : "**FAIL**"} | ${c.name}${c.ok ? "" : "<br><code>" + String(c.detail ?? "").replace(/\n/g, " ⏎ ").replace(/\|/g, "\\|").slice(0, 300) + "</code>"} |`);
    md.push("");
  }
  fs.writeFileSync(path.join(dir, "criteria.json"), JSON.stringify(rows, null, 1));
  fs.writeFileSync(path.join(dir, "criteria.md"), md.join("\n"));
  console.log(JSON.stringify(rows.map((r) => ({ id: r.id, complete: r.complete, failed: [...r.correctness, ...r.plumbing].filter((c: Crit) => !c.ok).map((c: Crit) => c.id) }))));
}

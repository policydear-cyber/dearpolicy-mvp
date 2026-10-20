/**
 * Acceptance checks for the structured answer fields (`bottomLine`, `statements[]`) against the Policy Evidence Reviewer's
 * source-derived reference, docs/rag-migration/pr57-roles/qc/EXPECTED-STATEMENTS.md (0dba0b4): five journeys, E1-E5.
 * Through the real /api/chat route, PGlite, scripted model (ScriptedLoopModel): NO model call, no spend, network refused.
 * Owner: Test engineer. Written for the Developer's answer-fields change; the fields' shape is the one the chat page reads
 * (components/answer-cards.tsx on PR #65: statements[].personName, amount{text,currencyResolved,illustration}, basis,
 * conditions[], asOf, source{policyName,page,rowLabel,footnote,note,citationIds}).
 *
 * Classes:
 *   AC     acceptance: FAILS on main 9a76490 (the fields do not exist yet); the answer-fields change must PASS it
 *   GUARD  must PASS on main and every candidate: the scripted turn reaches the amounts in today's prose (so an AC
 *          failure is about the fields, not the script), and the checker's own negative controls (it rejects a structured
 *          answer with a dropped condition, a total, a condition on the wrong row, a figure for a removed row)
 *
 * What one amount statement must carry (the reference's "must travel with it"): its person, the amount as printed with
 * the currency resolved or not, every required condition, the asOf date where the reference gives one, and its source
 * page. A condition counts as carried when it is in the statement's own conditions[], basis, source.footnote,
 * source.note or group.note (PR #70's either_or note): what the card shows with the amount. The prose sentence (text / fullText) does not count.
 * Scripted moves are plumbing evidence: they stand for a model that found the right rows, not for a model result.
 *
 *   node --import tsx scripts/reliable-chat-expected-statements-test.ts [--show] [--only=E1,E3]
 */
import { NextRequest } from "next/server";
import { setEnv, startHarness, type HarnessHousehold } from "./fixtures/rag2-loop/harness";
import * as FX from "./fixtures/reliable-chat/fracture-conversation";
import * as A from "./fixtures/reliable-chat/actual-lib";
import * as LH from "./fixtures/rag2-livelib/household";
import { GP_HH, MSG as GP_MSG, gpTurn } from "./fixtures/reliable-chat/gp-bill";
import { ScriptedLoopModel, type ScriptCall, type ScriptTurn, type ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { benefitIdOf, call, resultIds } from "./fixtures/reliable-chat/fracture-script";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
type Cls = "AC" | "GUARD";
const tally: Record<Cls, { pass: number; fail: number }> = { AC: { pass: 0, fail: 0 }, GUARD: { pass: 0, fail: 0 } };
const check = (cls: Cls, name: string, ok: boolean, detail = "") => {
  tally[cls][ok ? "pass" : "fail"]++;
  console.log(`${ok ? "PASS" : "FAIL"} [${cls}] ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 24).join("\n     ") : ""}`);
};
const show = process.argv.includes("--show");
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const only = (g: string) => !onlyArg || onlyArg.split(",").includes(g);
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => "Q: " + (q.text ?? "")), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");

// ---------------------------------------------------------------------------------------------------- the checker
type Stmt = { kind?: string; text?: string; fullText?: string; personName?: string | null; amount?: { text?: string; currencyResolved?: boolean } | null; basis?: string | null; conditions?: string[]; asOf?: string | null; source?: { policyName?: string; page?: number | null; footnote?: { text?: string } | null; note?: string | null; citationIds?: string[] } | null; group?: { kind?: string; note?: string } | null };
type Structured = { bottomLine?: string | null; statements?: Stmt[] };
/** What the card shows with an amount (the prose sentence excluded). */
const carried = (s: Stmt) => [...(s.conditions ?? []), s.basis ?? "", s.source?.footnote?.text ?? "", s.source?.note ?? "", s.group?.note ?? ""].join("\n");
const said = (s: Stmt) => [s.text ?? "", carried(s)].join("\n");
const amountOf = (s: Stmt) => (s.amount?.text ?? "").replace(/\s+/g, "");
export type Row = { label: string; amount: string; person: RegExp | null; currencyResolved: boolean; /** other acceptable printings, each with its currency state */ alt?: [string, boolean][]; must: [string, RegExp][]; mustNot?: [string, RegExp][]; /** the card's first condition (the event it depends on) */ first?: [string, RegExp]; asOf?: string | null; page?: number; basis?: RegExp };
export type Expect = { bottom: [string, RegExp][]; bottomNot?: [string, RegExp][]; rows: Row[]; optionalRows?: Row[]; noAmounts?: [string, RegExp][]; anywhereNot?: [string, RegExp][]; /** plain text the answer must show (prose, bottom line or statement text), not as an amount card */ plain?: [string, RegExp][] };
/** Every failure, as one line each; empty means the structured answer meets the reference. */
export function judge(a: Structured, e: Expect, prose = ""): string[] {
  const out: string[] = [];
  const bl = typeof a.bottomLine === "string" ? a.bottomLine.trim() : "";
  const st = Array.isArray(a.statements) ? a.statements : [];
  if (!bl) out.push("no bottomLine");
  if (!st.length) out.push("no statements[]");
  for (const [n, re] of e.bottom) if (bl && !re.test(bl)) out.push(`bottomLine lacks: ${n}`);
  for (const [n, re] of e.bottomNot ?? []) if (re.test(bl)) out.push(`bottomLine says: ${n}`);
  const rowCheck = (r: Row, s: Stmt) => {
    if (r.person && !r.person.test(s.personName ?? "")) out.push(`${r.label}: person is "${s.personName ?? ""}", not ${r.person}`);
    if (!r.person && s.personName) out.push(`${r.label}: names a person ("${s.personName}") the page does not name`);
    const want = [[r.amount, r.currencyResolved] as [string, boolean], ...(r.alt ?? [])].find(([t]) => t.replace(/\s+/g, "") === amountOf(s))?.[1] ?? r.currencyResolved;
    if (s.amount?.currencyResolved !== want) out.push(`${r.label}: currencyResolved ${s.amount?.currencyResolved}, expected ${want}`);
    for (const [n, re] of r.must) if (!re.test(carried(s))) out.push(`${r.label}: does not carry "${n}"`);
    for (const [n, re] of r.mustNot ?? []) if (re.test(said(s))) out.push(`${r.label}: carries "${n}", which is not this row's`);
    if (r.first && !r.first[1].test((s.conditions ?? [])[0] ?? "")) out.push(`${r.label}: first condition is "${(s.conditions ?? [])[0] ?? ""}", not "${r.first[0]}"`);
    if (r.basis && !r.basis.test(s.basis ?? "")) out.push(`${r.label}: basis "${s.basis ?? ""}" lacks ${r.basis}`);
    if (r.asOf !== undefined && (s.asOf ?? null) !== r.asOf) out.push(`${r.label}: asOf ${s.asOf ?? null}, expected ${r.asOf}`);
    if (r.page !== undefined && s.source?.page !== r.page) out.push(`${r.label}: source page ${s.source?.page}, expected ${r.page}`);
    if (!(s.source?.citationIds ?? []).length) out.push(`${r.label}: no source.citationIds`);
  };
  for (const r of e.rows) {
    const texts = [r.amount, ...(r.alt ?? []).map(([t]) => t)].map((t) => t.replace(/\s+/g, ""));
    const hits = st.filter((s) => texts.includes(amountOf(s)) && (!r.person || r.person.test(s.personName ?? "")));
    if (!hits.length) { if (st.length) out.push(`${r.label}: no statement with amount ${r.amount}${r.person ? " for " + r.person : ""}`); continue; }
    for (const s of hits) rowCheck(r, s);
  }
  for (const r of e.optionalRows ?? []) for (const s of st.filter((x) => amountOf(x) === r.amount.replace(/\s+/g, ""))) rowCheck(r, s);
  for (const [n, re] of e.noAmounts ?? []) for (const s of st) if (re.test(amountOf(s))) out.push(`a statement gives ${n} as an amount (${s.amount?.text})`);
  const all = [bl, ...st.map(said)].join("\n");
  for (const [n, re] of e.anywhereNot ?? []) if (re.test(all)) out.push(`says: ${n}`);
  for (const [n, re] of e.plain ?? []) if (!re.test([prose, all].join("\n"))) out.push(`does not show (plain text): ${n}`);
  return out;
}
const structured = (a: any): Structured => ({ bottomLine: a?.bottomLine ?? null, statements: a?.statements ?? [] });
/** Key order and absent-vs-null do not count when comparing what was returned, saved and reopened. */
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] != null).map((k) => [k, v[k]])) : v));

// ---------------------------------------------------------------------------------------------------- harness
type Out = { answer: any; prose: string; returned: string; saved: string; reopened: string };
async function journey(hh: unknown, turns: { msg: string; turn: ScriptTurn }[]): Promise<Out[]> {
  setEnv(hh as HarnessHousehold);
  const h = await startHarness(hh as HarnessHousehold);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  installLoopModel(new ScriptedLoopModel(turns.map((t) => t.turn)));
  try {
    const outs: Out[] = [];
    let conv: { id?: string; rev?: number } = {};
    for (const t of turns) {
      const a = await h.send(t.msg, conv);
      const sv = await h.savedAnswer(a.conversationId!);
      const r = await history(new NextRequest(`http://localhost/api/chat/history/${a.conversationId}`), { params: Promise.resolve({ id: a.conversationId! }) });
      const re = ((await r.json()).messages ?? []).filter((m: any) => m.role === "assistant").at(-1)?.answer_json;
      outs.push({ answer: sv.answer, prose: visible(sv.answer), returned: canon(structured(a)), saved: canon(structured(sv.answer)), reopened: canon(structured(re)) });
      if (show) console.log(`--- ${t.msg}\n${visible(sv.answer)}\n  bottomLine: ${(sv.answer as any)?.bottomLine ?? "(none)"}\n  statements: ${JSON.stringify((sv.answer as any)?.statements ?? null)}\n  trace: ${JSON.stringify((sv.state?.ragLoop?.turns?.at(-1)?.toolCalls ?? []).map((c: any) => `${c.name}${c.ok ? "" : " ERR " + String(c.error ?? "").slice(0, 160)}`))}`);
      conv = { id: a.conversationId!, rev: sv.state?.rev ?? a.conversationRevision! };
    }
    if (h.networkCalls.length) throw new Error("network calls made: " + h.networkCalls.join(", "));
    return outs;
  } finally { installLoopModel(null); }
}
const verdict = (id: string, title: string, o: Out, e: Expect) => {
  const f = judge(structured(o.answer), e, o.prose);
  check("AC", `${id} ${title}: bottomLine and statements[] meet the reference`, f.length === 0, f.join("\n"));
  check("AC", `${id} returned = saved = reopened (bottomLine and statements[]), and not empty`, o.returned === o.saved && o.saved === o.reopened && !!structured(o.answer).bottomLine && (structured(o.answer).statements ?? []).length > 0, `returned ${o.returned.slice(0, 200)}\nsaved ${o.saved.slice(0, 200)}\nreopened ${o.reopened.slice(0, 200)}`);
};
const setup = (id: string, what: string, ok: boolean, prose: string) => check("GUARD", `${id} setup: ${what} (today's prose; the script reaches the rows)`, ok, prose);

// ---------------------------------------------------------------------------------------------------- shared wording
const ACCIDENT: [string, RegExp] = ["caused by an accident", /accident/i];
const CORE_VOL: [string, RegExp] = ["Core or Voluntary Scheme only", /Core Scheme or (?:the )?Voluntary Scheme/i];
const THUMB: [string, RegExp] = ["thumb, finger and palm not covered", /thumb,? finger,? (?:and|or) palm/i];
const OTHER_UNDEFINED: [string, RegExp] = ["no page defines Other Fracture", /(?:do(?:es)? not|don.t|no (?:stored )?page) defines?\b[^.]*Other Fracture|Other Fracture[^.]*(?:not|never) defined/i];
const NOT_TOTAL: [string, RegExp] = ["alternatives, never a total", /never (?:a total|added)|not (?:a total|added(?: together)?)|(?:two|separate) (?:alternatives|answers)/i];
const INSURER: [string, RegExp] = ["the insurer decides", /insurer decides/i];
const PROMISE: [string, RegExp] = ["\"covered\" / \"will pay\"", /\bwill pay\b|\b(?:is|are|you're|you are|he is|she is) covered\b/i];
const TOE: [string, RegExp] = ["the toe/foot (^) note", /\btoe\b|\bfoot\b/i];
const XRAY: [string, RegExp] = ["an X-ray or medical-certificate requirement", /X-ray|medical certificate/i];

const fractureRows = (person: RegExp, who: string): Row[] => [
  { label: `${who} row 1 (Simple Fracture, PS p13)`, amount: "S$1,250", person, currencyResolved: true, must: [ACCIDENT, THUMB], mustNot: [["the Core/Voluntary condition (PS p13's * note is not on this row)", CORE_VOL[1]], TOE, XRAY], page: 13, basis: /25%[^.]*S\$5,000|S\$5,000[^.]*25%/ },
  { label: `${who} row 2 (Other Fracture, BS p8 + CERT)`, amount: "S$120,000", person, currencyResolved: true, must: [ACCIDENT, OTHER_UNDEFINED, CORE_VOL], mustNot: [TOE, XRAY], asOf: "2022-10-06", page: 8, basis: /20%[^.]*S\$600,000|S\$600,000[^.]*20%/ },
];

async function main() {
  const G = FX.M.grace.id, DAN = FX.M.daniel.id, CERT_FX = FX.doc("CERT").id;
  // A model that found both fracture tables for the person and stated both calculations (the production shape of a fracture turn).
  const fractureTurn = (who: string, mention: string, words: string): ScriptTurn => ({ steps: [
    () => [call("resolve_person", { mention })],
    () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: words, words }], subject_id: who }), call("person_benefits", { topic: "fracture after a fall", subject_id: who })],
    (v) => { const ev = (id: string) => call("evaluate_benefit", { case: words, purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: who, assumption_words: words }); return [ev(benefitIdOf(v, /^Simple Fracture$/i)), ev(benefitIdOf(v, /Simple Fracture or Other Fracture/i))]; },
    (v) => [call("final_answer", { subject_id: who, sentences: resultIds(v).map((r) => ({ kind: "calculation", text: "-", result_id: r, subject_id: who })), next_steps: ["contact:" + CERT_FX] })],
  ] });

  // ================================================================================================ E1 fracture, then the correction
  if (only("E1")) {
    const E1: Expect = { bottom: [["Grace", /Grace/], NOT_TOTAL, INSURER], rows: fractureRows(/Grace/, "Grace"), noAmounts: [["a total (S$121,250)", /121,250/]], anywhereNot: [["a total (S$121,250)", /121,250/], PROMISE] };
    const o = await journey(FX, [{ msg: "grace fell down and broke her arm", turn: fractureTurn(G, "grace", "broke her arm") }, { msg: "Actually it was Daniel who broke his arm, not Grace.", turn: fractureTurn(DAN, "Daniel", "broke his arm") }]);
    setup("E1", "the Grace answer shows S$1,250 and S$120,000", /S\$1,250/.test(o[0].prose) && /S\$120,000/.test(o[0].prose), o[0].prose);
    verdict("E1", "Grace broke her arm", o[0], E1);
    setup("E1b", "the corrected answer shows Daniel's S$1,250 and S$120,000", /Daniel/.test(o[1].prose) && /S\$1,250/.test(o[1].prose) && /S\$120,000/.test(o[1].prose), o[1].prose);
    const E1b: Expect = { bottom: [["Daniel", /Daniel/], NOT_TOTAL, INSURER], rows: fractureRows(/Daniel/, "Daniel"), noAmounts: [["a total (S$121,250)", /121,250/]], anywhereNot: [["a total", /121,250/], PROMISE] };
    verdict("E1b", "\"Actually it was Daniel\"", o[1], E1b);
    const st = (structured(o[1].answer).statements ?? []) as Stmt[];
    check("AC", "E1b no statement in the corrected answer is about Grace, and the answer says Grace's figures no longer apply", st.length > 0 && !st.some((s) => /Grace/.test(s.personName ?? "")) && /no longer appl/i.test([structured(o[1].answer).bottomLine ?? "", o[1].prose].join("\n")), JSON.stringify(st.map((s) => [s.personName, s.amount?.text])) + "\n" + o[1].prose);
  }

  // ================================================================================================ E2 GP bill
  const gpQualifiers: [string, RegExp][] = [["GP or outpatient", /GP|outpatient/i], ["not the same as not covered", /not the same as saying|doesn.t mean|does not mean/i]];
  const gpNot: [string, RegExp][] = [["not covered / excluded", /(?<!not the same as saying (?:he )?(?:is |isn.t )?)\b(?:is not covered|isn.t covered|not covered|excluded)\b/i]];
  const gpAnywhereNot: [string, RegExp][] = [["Living Care pages describe no GP benefit (no such page)", /Living Care[^.]*(?:describ|print)\w*[^.]*no\b[^.]*GP/i], ["\"haven't looked up\" after a search", /haven.t (?:yet )?looked up|have not (?:yet )?looked up/i], ["$770 or any amount from $800", /\$\s?770\b|S\$\s?800/], PROMISE];
  // Section 18 of qc/EVIDENCE.md (62633ba) ruled on these cards; the expectations it changed keep their original in a comment.
  // Original: the bottom line only had to name Outpatient Medicare (/Outpatient Medicare/i).
  const OPMC: [string, RegExp] = ["Outpatient Medicare: the scheme has it, his certificate does not list it", /Outpatient Medicare[^.]*(?:certificate|Part 1)[^.]*(?:does not|doesn.t|not) (?:list|show|include)|(?:certificate|Part 1)[^.]*(?:does not|doesn.t) (?:list|show|include)[^.]*Outpatient Medicare/i];
  const NO_OUTPATIENT: [string, RegExp] = ["\"no outpatient cover\"", /\bno (?:outpatient|GP) (?:cover|benefit|policy)|(?:does not|doesn.t) have (?:any )?(?:outpatient|GP) (?:cover|benefit)|not covered for (?:outpatient|GP)/i];
  const AS_GP_AMOUNT: [string, RegExp] = ["the accident benefits counted as amounts that may apply to the GP bill", /amounts? (?:that )?(?:may|might|could) apply|(?:towards?|for|against|pays?|covers?|covering|reimburses?) (?:the |his |this )?(?:\$\s?800 )?GP (?:bill|visit|consultation)/i];
  const E2a: Expect = {
    bottom: [...gpQualifiers, ["his certificate's date (6 Oct 2022)", /6 Oct(?:ober)? 2022|2022-10-06/], OPMC, ["the accident benefits only as \"only if\" alternatives", /only if/i]],
    bottomNot: [...gpNot, NO_OUTPATIENT, AS_GP_AMOUNT],
    rows: [
      // PS p13 prints S$500; BS p8 prints a bare "$500", which stays unresolved when only BS is cited (the reference's currency rule).
      { label: "E2a row 1 (Ambulance Cost)", amount: "S$500", alt: [["$500", false]], person: /Daniel/, currencyResolved: true, first: ["only if a ground ambulance took him to hospital after the accident", /only if[^.]*ambulance[^.]*hospital/i], must: [["only if a ground ambulance took him to hospital", /ambulance/i], ACCIDENT, ["per event / per incident", /per (?:event|incident)/i], CORE_VOL], mustNot: [AS_GP_AMOUNT] },
      // Original: amount "S$250" only, and only "30 days", "24 hours" and Core/Voluntary required.
      { label: "E2a row 2 (Accidental Hospital Recuperation)", amount: "S$250", alt: [["$250", false]], person: /Daniel/, currencyResolved: true, first: ["only if he was then admitted to hospital for at least 24 hours", /only if[^.]*(?:admitted|hospital)[^.]*24 (?:continuous )?hours/i], must: [["within 30 days of the accident", /30 days/i], ["at least 24 continuous hours in hospital", /24 (?:continuous )?hours/i], ["on a Registered Medical Practitioner's recommendation, not convalescent rest", /convalescen/i], ["one-time per hospitalisation", /one[- ]time|once per/i], ["no payment for later stays from the same injury", /subsequent hospitali[sz]ation/i], CORE_VOL], mustNot: [AS_GP_AMOUNT] },
    ],
    optionalRows: fractureRows(/Daniel/, "E2a row 3"),
    noAmounts: [["an amount for the GP bill ($800 or derived)", /800|770/]],
    anywhereNot: [...gpAnywhereNot, NO_OUTPATIENT],
  };
  // Original rows 4 and 5 were amount cards: "$30" (person null, panel vs non-panel, per visit, whose cover is not printed, page 25)
  // and "$1,000" (person null, outside Singapore, per Accident, page 20). Section 18: neither may be a card, only quoted scheme wording,
  // because a card carries a person and the invented pages name none.
  const E2b: Expect = {
    bottom: gpQualifiers, bottomNot: [...gpNot, NO_OUTPATIENT, AS_GP_AMOUNT],
    rows: [],
    noAmounts: [["$770 or an amount from $800", /770|800/], ["the panel GP $30 as a card", /^S?\$30$/], ["the overseas $1,000 as a card", /^S?\$1,000$/]],
    plain: [["the panel GP line quoted (30 per visit)", /\b30\b[^.\n]*per visit/i], ["that the page does not say whose cover it is", /(?:does not|doesn.t) (?:say|name|print|show)[^.]*(?:whose|which policy|person)/i], ["the overseas line, outside Singapore only", /outside Singapore/i]],
    anywhereNot: [...gpAnywhereNot, NO_OUTPATIENT, ["\"his certificate does not list it\" for the panel GP row", /certificate (?:does not|doesn.t) list[^.]*panel/i]],
  };
  if (only("E2")) {
    // E2a: stored pages only. A model that searched, found no GP benefit, and kept the documented accident benefits visible.
    const gpA: ScriptTurn = { steps: [
      () => [call("resolve_person", { mention: "daniel" })],
      () => [call("note_facts", { subject_id: DAN, facts: [{ key: "how_it_happened", value: "tripped on the kerb and fell", words: "tripped on the kerb and fell" }, { key: "bill_amount", value: "$800 GP bill", words: "his GP bill is $800" }] }), call("person_benefits", { subject_id: DAN, topic: "GP bill after an accident" })],
      () => [call("search_passages", { k: 8, query: "GP outpatient clinic medical expenses ambulance hospital recuperation", subject_id: DAN })],
      ...Array.from({ length: 6 }, () => (v: ScriptView): ScriptCall[] => {
        const ids = [benefitIdOf(v, /Ambulance/i), benefitIdOf(v, /^Accidental Hospital Recuperation Benefit$/i)].filter(Boolean);
        return [call("final_answer", { subject_id: DAN, sentences: [
          // (an absence over these partly stored copies is refused, rightly: Critic M5; the model says what it could not find instead)
          { kind: "uncertainty", text: "The uploaded pages do not show a benefit for a GP or outpatient bill; only part of the Product Summary and Benefit Summary was uploaded.", subject_id: DAN },
          ...ids.map((b) => ({ kind: "benefit_terms", benefit_id: b, subject_id: DAN })),
        ], next_steps: ["contact:" + CERT_FX] })];
      }),
    ] };
    const a = await journey(FX, [{ msg: GP_MSG.unsaid, turn: gpA }]);
    setup("E2a", "the GP answer completes, keeps $800 as written, and shows the ambulance (500) and recuperation (S$250) terms", !/returned an error|couldn.t confirm/i.test(a[0].prose) && !/S\$\s?800/.test(a[0].prose) && /\b500\b/.test(a[0].prose) && /S\$250/.test(a[0].prose), a[0].prose);
    verdict("E2a", "GP bill, stored pages only", a[0], E2a);

    // E2b: the invented PS p20 and p25 (PR #64), the PR #64 model moves.
    const b = await journey(GP_HH, [{ msg: GP_MSG.unsaid, turn: gpTurn() }]);
    setup("E2b", "the GP answer quotes the panel GP line (30 per visit, bare $)", /\b30\b[^.]*per visit/.test(b[0].prose), b[0].prose);
    verdict("E2b", "GP bill with the panel GP and overseas pages", b[0], E2b);
    // Row 5 is for treatment outside Singapore only: a visit stated as in Singapore gets no $1,000 statement.
    const c = await journey(GP_HH, [{ msg: GP_MSG.home, turn: gpTurn() }]);
    const cs = (structured(c[0].answer).statements ?? []) as Stmt[];
    // Original: only "no $1,000 statement". Section 18: the overseas line is quoted only when the message names no place or an overseas one.
    const cAll = [c[0].prose, structured(c[0].answer).bottomLine ?? "", ...cs.map(said)].join("\n");
    check("AC", "E2b' a GP visit stated as in Singapore: structured answer present, no $1,000 overseas statement, and the overseas line not quoted", cs.length > 0 && !cs.some((s) => /1,000/.test(amountOf(s))) && !/1,000/.test(cAll), JSON.stringify(cs.map((s) => s.amount?.text)) + "\n" + cAll);
  }

  // ================================================================================================ E3 death abroad, E4 travel (livelib)
  const AD = LH.M.adrian.id;
  const pbBenefit = (v: ScriptView, policy: string, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") for (const d of o.result?.data?.documents ?? []) if (d.policy_id === policy) for (const b of d.benefits ?? []) if (re.test(b.benefit) && b.benefit_id) return b.benefit_id as string; return ""; };
  const NOTIFY: [string, RegExp] = ["notify within 6 months (Term Life's step)", /6 months|six months/i];
  const EXCL: [string, RegExp] = ["the war / self-injury exclusions (the accident policy's)", /\bwar\b|self-injur|invasion/i];
  const WORLD: [string, RegExp] = ["the worldwide territorial limit (the accident policy's)", /worldwide|territorial/i];
  const E3: Expect = {
    bottom: [["Adrian", /Adrian/], ["separate policies, never added", /separate|never added|not added/i], INSURER, ["certificate date (6 Oct 2022)", /6 Oct(?:ober)? 2022|2022-10-06/]],
    bottomNot: [PROMISE],
    rows: [
      { label: "E3 row 1 (Group Term Life)", amount: "S$1,000,000", person: /Adrian/, currencyResolved: true, must: [["notify within 6 months", /6 months/i], ["with the death certificate", /death certificate/i]], mustNot: [EXCL, WORLD], asOf: "2022-10-06" },
      // Original exclusions regex: /war|self-injur/i (matched "toward" and "award").
      { label: "E3 row 2 (Accidental Death, 100% of GPA)", amount: "S$600,000", person: /Adrian/, currencyResolved: true, must: [ACCIDENT, ["worldwide territorial limit", /worldwide/i], ["exclusions (war, self-injury)", /\bwar\b|self-injur/i]], mustNot: [NOTIFY], asOf: "2022-10-06", basis: /100%[^.]*S\$600,000|S\$600,000[^.]*100%/ },
      // Original: amount "S$2,000" only. Section 18: WORD p3 prints a bare "$2,000"; S$ only with SUMMARY p9 cited.
      { label: "E3 row 3 (Repatriation)", amount: "S$2,000", alt: [["$2,000", false]], person: /Adrian/, currencyResolved: true, must: [["death outside Singapore", /outside Singapore/i], ACCIDENT, ["reimbursement, up to", /up to|reimburs/i]], mustNot: [NOTIFY] },
    ],
    optionalRows: [{ label: "E3 travel S$100,000 (if named at all)", amount: "S$100,000", person: /Adrian/, currencyResolved: true, must: [["its period (10-17 Mar 2025)", /10\/03\/2025|10 Mar(?:ch)? 2025/], ["Indonesia", /Indonesia/], ["why it does not fit", /does not (?:fit|apply|cover the date)|outside (?:its|the) period|before/i]] }],
    noAmounts: [["a total (S$1,602,000)", /1,602,000/], ["Daily Hospital Cash S$40", /^S\$40\b/], ["Living Care Plus S$300,000 as payable", /300,000/]],
    anywhereNot: [["a total (S$1,602,000)", /1,602,000/], PROMISE],
  };
  if (only("E3")) {
    const E3_MSG = "Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Please tell me which death benefits may apply and what I should do next.";
    const deathTurn: ScriptTurn = { steps: [
      () => [call("resolve_person", { mention: "Adrian" })],
      () => [call("note_facts", { subject_id: AD, facts: [{ key: "how_it_happened", value: "car accident in Japan", words: "died in a car accident in Japan" }, { key: "accident_date", value: "2026-10-03", words: "3 October 2026" }, { key: "death_date", value: "2026-10-05", words: "5 October 2026" }] }), call("person_benefits", { subject_id: AD, topic: "death after an accident abroad" })],
      (v) => [call("evaluate_benefit", { subject_id: AD, benefit_id: pbBenefit(v, LH.doc("SUMMARY").id, /^Accidental Death$/), purpose: "claim", case: "accidental death", assumption_words: "died in a car accident in Japan" })],
      (v) => [call("final_answer", { subject_id: AD, sentences: [
        { kind: "benefit_terms", benefit_id: pbBenefit(v, LH.doc("CERT").id, /Group Term Life/), subject_id: AD },
        ...resultIds(v).map((r) => ({ kind: "calculation", text: "-", result_id: r, subject_id: AD })),
        { kind: "benefit_terms", benefit_id: pbBenefit(v, LH.doc("SUMMARY").id, /Repatriation of Mortal Remains/), subject_id: AD },
      ], next_steps: ["contact:" + LH.doc("CERT").id] })],
    ] };
    const o = await journey(LH, [{ msg: E3_MSG, turn: deathTurn }]);
    setup("E3", "the answer shows S$1,000,000, S$600,000 and S$2,000", /S\$1,000,000/.test(o[0].prose) && /S\$600,000/.test(o[0].prose) && /S\$2,000/.test(o[0].prose), o[0].prose);
    verdict("E3", "death abroad", o[0], E3);
  }
  if (only("E4")) {
    const travelTurn: ScriptTurn = { steps: [
      () => [call("resolve_person", { mention: "Adrian" }), call("person_benefits", { subject_id: AD, topic: "travel insurance trip" })],
      (v) => [call("final_answer", { subject_id: AD, sentences: [{ kind: "benefit_terms", benefit_id: pbBenefit(v, LH.doc("TRAVEL").id, /Accidental Death/), subject_id: AD }], next_steps: [] })],
    ] };
    const E4: Expect = {
      bottom: [["Adrian", /Adrian/], ["one trip to Indonesia", /Indonesia/], ["10 to 17 March 2025", /10[^.]*17 March 2025|10\/03\/2025[^.]*17\/03\/2025/], ["does not show cover for a trip now", /(?:does not|doesn.t) show cover|after (?:that|the) period|no longer/i]],
      bottomNot: [["\"valid\" / \"active\" now", /\b(?:valid|active)\b/i], ["Cheryl as insured", /Cheryl/]],
      rows: [{ label: "E4 row 1 (Travel Accidental Death)", amount: "S$100,000", person: /Adrian/, currencyResolved: true, must: [["Period 10/03/2025 to 17/03/2025", /10\/03\/2025|10 Mar(?:ch)? 2025/], ["Destination Indonesia", /Indonesia/]], page: 1 }],
      anywhereNot: [["Cheryl named as insured", /Cheryl[^.]*insured|insured[^.]*Cheryl/i], ["medical, delay or baggage cover", /\b(?:medical expenses|delay|baggage)\b/i]],
    };
    const o = await journey(LH, [{ msg: "Does Adrian's travel insurance cover his trip?", turn: travelTurn }]);
    setup("E4", "the answer shows the travel S$100,000", /S\$100,000/.test(o[0].prose), o[0].prose);
    verdict("E4", "travel, no trip dates", o[0], E4);
  }

  // ================================================================================================ E5 conflicting documents (actuallib)
  if (only("E5")) {
    const AD5 = A.M.daniel.id;
    const scheds = (v: ScriptView) => ([...v.turn].reverse().find((o) => o.name === "person_benefits")?.result?.data?.schedules ?? []) as any[];
    const hipTurn: ScriptTurn = { steps: [
      () => [call("resolve_person", { mention: "Daniel" }), call("note_facts", { subject_id: AD5, facts: [{ key: "injury", value: "closed hip fracture", words: "fractured his hip, it's a closed fracture" }] })],
      () => [call("person_benefits", { subject_id: AD5, topic: "closed hip fracture accident" })],
      (v) => {
        const sf = scheds(v).find((s) => s.evidence?.policy_id === A.doc("PRODUCT_SUMMARY").id && /^Simple Fracture/.test(s.benefit));
        const pa = scheds(v).find((s) => s.evidence?.policy_id === A.doc("PA_SUMMARY").id || s.policy_id === A.doc("PA_SUMMARY").id);
        return [sf, pa].filter(Boolean).map((s) => call("evaluate_benefit", { subject_id: AD5, benefit_id: s.benefit_id, purpose: "claim", case: "hip", fact_keys: ["injury"] }));
      },
      (v) => [call("final_answer", { subject_id: AD5, sentences: resultIds(v).map((r) => ({ kind: "calculation", text: "-", result_id: r, subject_id: AD5 })), next_steps: ["contact:" + A.doc("CERT").id] })],
    ] };
    const E5: Expect = {
      bottom: [["Daniel", /Daniel/], NOT_TOTAL, INSURER],
      bottomNot: [PROMISE],
      rows: [
        { label: "E5 row 1 (Simple Fracture, PS p13)", amount: "S$3,750", person: /Daniel/, currencyResolved: true, must: [ACCIDENT, ["Simple Fracture (not defined on any page)", /Simple Fracture/i]], page: 13, basis: /75%[^.]*S\$5,000|S\$5,000[^.]*75%/ },
        { label: "E5 row 2 (PA Benefit Summary p8 + CERT)", amount: "S$450,000", person: /Daniel/, currencyResolved: true, must: [ACCIDENT, CORE_VOL], mustNot: [["the 'Other Fracture not defined' note (the hip row is not labelled Other Fracture)", OTHER_UNDEFINED[1]]], asOf: "2024-04-01", page: 8, basis: /75%[^.]*S\$600,000|S\$600,000[^.]*75%/ },
      ],
      noAmounts: [["a total (S$453,750)", /453,750/], ["the 2022 summary's S$3,000", /^S\$3,000$/], ["the other household's S$7,000 / S$900,000", /^S\$(?:7,000|900,000)$/]],
      anywhereNot: [["a total (S$453,750)", /453,750/], ["the 2022 limit S$4,000", /S\$4,000\b/], ["Grace's S$100,000 as the base", /S\$100,000/]],
    };
    const o = await journey(A, [{ msg: "Daniel fractured his hip, it's a closed fracture", turn: hipTurn }]);
    setup("E5", "the answer shows S$3,750 and S$450,000", /S\$3,750/.test(o[0].prose) && /S\$450,000/.test(o[0].prose), o[0].prose);
    verdict("E5", "hip on conflicting documents", o[0], E5);
  }

  // ================================================================================================ N: the checker can fail
  if (only("N")) {
    const E1: Expect = { bottom: [["Grace", /Grace/], NOT_TOTAL, INSURER], rows: fractureRows(/Grace/, "Grace"), noAmounts: [["a total", /121,250/]], anywhereNot: [["a total", /121,250/], PROMISE] };
    const good: Structured = {
      bottomLine: "Grace's accident cover prints two different fracture benefits for an arm. They are two alternatives, never a total; the insurer decides which applies.",
      statements: [
        { kind: "calculation", personName: "Grace", amount: { text: "S$1,250", currencyResolved: true }, basis: "25% of the S$5,000 Simple Fracture limit", conditions: ["Only if the fracture was caused by an accident"], asOf: null, source: { policyName: "Product Summary", page: 13, footnote: { text: "any fractures of thumb, finger and palm are not covered" }, citationIds: ["rag2:e5"] } },
        { kind: "calculation", personName: "Grace", amount: { text: "S$120,000", currencyResolved: true }, basis: "20% of Grace's S$600,000 sum insured", conditions: ["Only if caused by an accident", "These documents do not define which fractures count as Other Fracture", "Can only be claimed under either the Core Scheme or Voluntary Scheme"], asOf: "2022-10-06", source: { policyName: "Certificate of Insurance Part 2", page: 8, citationIds: ["rag2:e7"] } },
      ],
    };
    const mutate = (f: (s: Structured) => void) => { const c = JSON.parse(JSON.stringify(good)) as Structured; f(c); return c; };
    check("GUARD", "N0 a structured answer written to the reference passes the checker", judge(good, E1).length === 0, judge(good, E1).join("\n"));
    const bad: [string, Structured][] = [
      ["N1 row 2 without its Core/Voluntary condition", mutate((s) => { s.statements![1].conditions = s.statements![1].conditions!.slice(0, 2); })],
      ["N2 the Core/Voluntary condition on row 1", mutate((s) => { s.statements![0].conditions!.push("Can only be claimed under either the Core Scheme or Voluntary Scheme"); })],
      ["N3 a total in the bottom line", mutate((s) => { s.bottomLine += " Together that is S$121,250."; })],
      ["N4 the wrong person on row 2", mutate((s) => { s.statements![1].personName = "Daniel"; })],
      ["N5 row 2 without its date", mutate((s) => { s.statements![1].asOf = null; })],
      ["N6 the thumb/finger/palm footnote dropped from row 1", mutate((s) => { s.statements![0].source!.footnote = null; })],
      ["N7 a bottom line that promises payment", mutate((s) => { s.bottomLine = "Grace is covered: the insurer will pay S$120,000 or S$1,250, never a total; the insurer decides."; })],
      ["N8 the condition only in the prose sentence (fullText), not on the card", mutate((s) => { s.statements![1].fullText = "... This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme."; s.statements![1].conditions = s.statements![1].conditions!.slice(0, 2); })],
      ["N9 a statement missing (row 1)", mutate((s) => { s.statements!.shift(); })],
      ["N10 no fields at all (today's answer shape)", {}],
    ];
    for (const [name, s] of bad) check("GUARD", `${name}: the checker rejects it`, judge(s, E1).length > 0, "accepted");

    // Section 18 rules (GP-bill and death-abroad cards): an answer written to the ruling passes, each breach is rejected.
    const cite = (page: number) => ({ policyName: "Product Summary", page, citationIds: ["rag2:e" + page] });
    const gpGood: Structured = {
      bottomLine: "The uploaded pages do not show a GP or outpatient benefit for Daniel's $800 bill, which is not the same as saying he is not covered. The scheme also has an Outpatient Medicare policy, which his certificate (6 Oct 2022) does not list. The accident benefits below matter only if an ambulance took him to hospital or he was admitted.",
      statements: [
        { kind: "benefit_terms", personName: "Daniel", amount: { text: "S$500", currencyResolved: true }, conditions: ["Only if, after the accident, a ground ambulance took him to hospital", "Per event", "Can only be claimed under either the Core Scheme or Voluntary Scheme"], asOf: null, source: cite(13) },
        { kind: "benefit_terms", personName: "Daniel", amount: { text: "S$250", currencyResolved: true }, conditions: ["Only if he was then admitted to hospital for at least 24 hours", "Within 30 days following bodily injury as a result of an Accident", "Confined as a resident patient for a continuous period of at least 24 hours on a Registered Medical Practitioner's recommendation, not for convalescent rest", "One-time per hospitalisation", "Subsequent hospitalisation resulting from the same injury will not be payable", "Can only be claimed under either the Core Scheme or Voluntary Scheme"], asOf: null, source: cite(13) },
      ],
    };
    const gpProse = "Product Summary p25 prints: Panel GP $30 per visit. The page does not say whose cover this is. Product Summary p20 prints $1,000 per Accident for emergency outpatient treatment outside Singapore.";
    const deathGood: Structured = {
      bottomLine: "Adrian's documents show three separate policies that may apply, never added together, as of his certificate dated 6 Oct 2022; the insurer decides.",
      statements: [
        { kind: "benefit_terms", personName: "Adrian", amount: { text: "S$1,000,000", currencyResolved: true }, conditions: ["Notify the insurer within 6 months, with the death certificate"], asOf: "2022-10-06", source: cite(1) },
        { kind: "calculation", personName: "Adrian", amount: { text: "S$600,000", currencyResolved: true }, basis: "100% of Adrian's S$600,000 Group Personal Accident sum insured", conditions: ["Only if death was caused by an accident", "Territorial Limits: worldwide, 24 hours a day", "Exclusions include war, civil war and deliberate self-injury"], asOf: "2022-10-06", source: cite(9) },
        { kind: "benefit_terms", personName: "Adrian", amount: { text: "S$2,000", currencyResolved: true }, conditions: ["Only if death occurs outside Singapore as a result of an Accident", "Reimburses the reasonable cost of returning the remains to Singapore, up to S$2,000"], asOf: null, source: cite(9) },
      ],
    };
    const plainGP: Structured = { bottomLine: gpGood.bottomLine, statements: [{ kind: "fact", text: "Panel GP $30 per visit (Product Summary p25); the page does not say whose cover this is.", amount: null, source: cite(25) }] };
    const m = (base: Structured, f: (s: Structured) => void) => { const c = JSON.parse(JSON.stringify(base)) as Structured; f(c); return c; };
    const goods: [string, Structured, Expect, string][] = [["N0a a GP answer written to section 18 (E2a)", gpGood, E2a, ""], ["N0b a GP answer quoting the panel GP and overseas lines as plain text (E2b)", plainGP, E2b, gpProse], ["N0c a death-abroad answer written to section 18 (E3)", deathGood, E3, ""]];
    for (const [name, s, e, pr] of goods) check("GUARD", `${name} passes the checker`, judge(s, e, pr).length === 0, judge(s, e, pr).join("\n"));
    const bad18: [string, Structured, Expect, string][] = [
      ["N11 the ambulance card's \"only if\" event not first", m(gpGood, (s) => { s.statements![0].conditions!.push(s.statements![0].conditions!.shift()!); }), E2a, ""],
      ["N12 the recuperation card without \"subsequent hospitalisation\"", m(gpGood, (s) => { s.statements![1].conditions = s.statements![1].conditions!.filter((c) => !/Subsequent/.test(c)); }), E2a, ""],
      ["N13 a GP bottom line saying \"he has no outpatient cover\"", m(gpGood, (s) => { s.bottomLine = s.bottomLine!.replace("The scheme also has an Outpatient Medicare policy, which his certificate (6 Oct 2022) does not list.", "He has no outpatient cover; his certificate is dated 6 Oct 2022."); }), E2a, ""],
      ["N14 a GP bottom line counting the cards as amounts that may apply", m(gpGood, (s) => { s.bottomLine += " Your documents print amounts that may apply: S$500 and S$250."; }), E2a, ""],
      ["N15 the recuperation card presented as paying the GP bill", m(gpGood, (s) => { s.statements![1].conditions!.push("Can be claimed towards the GP bill"); }), E2a, ""],
      ["N16 the panel GP $30 as an amount card", m(plainGP, (s) => { s.statements!.push({ kind: "benefit_terms", personName: null, amount: { text: "$30", currencyResolved: false }, conditions: ["Panel GP, per visit"], source: cite(25) }); }), E2b, gpProse],
      ["N17 the overseas $1,000 as an amount card", m(plainGP, (s) => { s.statements!.push({ kind: "benefit_terms", personName: null, amount: { text: "$1,000", currencyResolved: false }, conditions: ["Only outside Singapore, per Accident"], source: cite(20) }); }), E2b, gpProse],
      ["N18 the war / self-injury exclusions on the Term Life card", m(deathGood, (s) => { s.statements![0].conditions!.push("Exclusions include war and deliberate self-injury"); }), E3, ""],
      ["N19 \"notify within 6 months\" on the accidental death card", m(deathGood, (s) => { s.statements![1].conditions!.push("Notify the insurer within 6 months"); }), E3, ""],
      ["N20 \"notify within 6 months\" on the repatriation card", m(deathGood, (s) => { s.statements![2].conditions!.push("Notify within 6 months with the death certificate"); }), E3, ""],
      ["N21 the worldwide limit on the Term Life card", m(deathGood, (s) => { s.statements![0].conditions!.push("Territorial Limits: worldwide"); }), E3, ""],
    ];
    for (const [name, s, e, pr] of bad18) check("GUARD", `${name}: the checker rejects it`, judge(s, e, pr).length > 0, "accepted");
  }

  console.log(`\nAC ${tally.AC.pass} passed, ${tally.AC.fail} failed | GUARD ${tally.GUARD.pass} passed, ${tally.GUARD.fail} failed`);
  process.exit(tally.GUARD.fail ? 2 : tally.AC.fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(3); });

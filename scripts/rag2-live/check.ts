/**
 * Live-model smoke: the DETERMINISTIC checker. Grades one saved conversation, read back from the local database
 * (chat_conversations.state -- the loop's trace, evidence and facts -- and every chat_messages row with its
 * answer_json), against its expected behaviour (scripts/rag2-live/scenarios.ts). No AI judge.
 *
 * Each check carries the pipeline stage a failure points at; a conversation's verdict names the EARLIEST failing stage
 * in pipeline order: document extraction -> retrieval -> person-version resolution -> model reasoning-tool selection
 * -> calculation -> verification -> presentation. A turn the loop stopped on a limit (budget, time, model error) is
 * INCOMPLETE, not a model failure.
 *
 * Re-grade a finished run from the database:
 *   node --import tsx scripts/rag2-live/check.ts docs/rag-migration/live/RUN-<timestamp>
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pool } from "@/lib/db/client";
import { recomputeCalculation } from "@/lib/claims/calc-record";
import { renderedAssistantText } from "@/components/assistant-message";
import { withoutNegatedDecisions } from "@/lib/rag2/loop/statements";
import { WITHHELD_AMOUNT_TEXT } from "@/lib/chat/monetary-boundary";
import { CALC_NOTE, DROPPED_NOTE, INSTRUCTION_NOTE } from "@/lib/rag2/loop/compose";
/** lib/rag2/loop/hook.ts RESUME_NOTE (not imported: the hook pulls in the chat route's modules). */
const RESUME_NOTE = "When you’re ready, here is the question I was on.";
const WITHHELD = new RegExp(WITHHELD_AMOUNT_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
import type { CalculationRecord, ChatAnswer } from "@/types";
import { ACCOUNT_L, DOCS, L, doc, type MemberKey } from "../fixtures/rag2-live/household";
import { SCENARIOS, STAGES, type Passage, type Scenario, type Stage, type TurnExpect } from "./scenarios";

export type Check = { turn: number; name: string; ok: boolean; stage: Stage; detail: string };
export type LoadedTurn = {
  index: number; user: string; answer: Partial<ChatAnswer> & Record<string, any>; visible: string; questions: string[];
  /** The saved message text (chat_messages.content): the body the chat page shows above the question card. */
  content?: string;
  userAt: string | null; assistantAt: string | null; trace: any | null;
};
export type LoadedConversation = { conversationId: string; state: any; turns: LoadedTurn[]; pages: Map<string, string> };
export type Verdict = { scenario: string; verdict: "PASS" | "FAIL" | "INCOMPLETE"; failureStage: Stage | null; incomplete: string | null; checks: Check[] };

const MONEY = /S\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
const INTERNAL = /\b(?:e\d+|v\d+|r\d+|k[0-9a-f]{10})\b(?=[,.)\s]|$)|evidence_id|value_id|result_id|select_table_value|final_answer|ask_user|note_facts|search_passages|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const ws = (t: string) => (t ?? "").replace(/\s+/g, " ").trim();
const amount = (s: string) => Number(s.replace(/[^\d.]/g, ""));
export const moneyIn = (text: string): number[] => [...(text ?? "").matchAll(MONEY)].map((m) => amount(m[1]));
const sentences = (text: string) => (text ?? "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const memberId = (k: MemberKey) => L[k].id;
const memberKeyOf = (id: string | null | undefined) => (Object.keys(L) as MemberKey[]).find((k) => L[k].id === id) ?? (id ? `unknown(${id.slice(-4)})` : "none");

/** What the household sees for one assistant message: the chat page's own view of it (components/assistant-message.ts
 * -- the body, each question once as its card with why it matters, the details, a next step when nothing is asked). */
export function visibleText(a: Partial<ChatAnswer> & Record<string, any>, content?: string | null): string {
  return renderedAssistantText(content ?? a.summary ?? "", a);
}
/** Wording that presents a printed benefit as a decision, a payment or an entitlement (never DearPolicy's to state). */
export const ENTITLEMENT = /\b(?:pre-?)?approved\b(?! (?:hospital|provider|panel|doctor|clinic))|\byou(?:['’]ll| will) (?:receive|get|be paid)\b|\b(?:he|she|they|kai|mei|grace|daniel)(?:['’]ll| will) (?:receive|get|be paid)\b|\bwill be (?:paid|reimbursed)\b|\bis entitled to\b|\bare entitled to\b|\bguarantee\w*\b|\bfully covered\b|\b(?:can|will) definitely claim\b/i;
const count = (hay: string, needle: string) => (needle ? hay.split(needle).length - 1 : 0);

/**
 * Round 7: whether a substantive assistant turn is USEFUL. It must carry at least one of: a supported figure or
 * condition (a sentence of its own, with a citation); a single material question; or an honest statement of what the
 * documents do not say. A turn that only says back the household's own words, or only the generic verification
 * failure, is not useful -- however safe. The stage is where it went wrong first: the model offered nothing citable
 * (model reasoning-tool selection), or it did and the answer still did not show it (presentation).
 */
const SAID_BACK = /^(?:you(?:['’]ve| have)? (?:said|told (?:me|us)|mentioned|wrote|reported|let me know)|as you (?:said|mentioned|told me))\b/i;
const NOT_IN_DOCS = /\b(?:documents?|polic(?:y|ies)|schedule|certificate|plan|wording)\b[^.]{0,80}\b(?:do(?:es)?n['’]t|do(?:es)? not|never)\s+(?:mention|say|list|show|include|print|state|cover|have)\b|\bnot (?:mentioned|listed|stated|shown|printed|included) (?:in|anywhere in) (?:your|the)\b|\b(?:couldn['’]t|could not|can['’]t|cannot) find\b[^.]{0,60}\bin (?:your|the) (?:documents?|polic)/i;
const GENERIC = new Set([DROPPED_NOTE, CALC_NOTE, INSTRUCTION_NOTE, RESUME_NOTE, "I need one more detail first.", "I need to know who this is about first.", "I need to know who is asking first."].map((x) => ws(x)));
export function turnUsefulness(t: LoadedTurn): { ok: boolean; stage: Stage; detail: string } {
  const questions = t.questions.map(ws).filter(Boolean);
  const body = [t.content ?? t.answer.summary ?? "", ...((t.answer.details ?? []) as string[])].flatMap((x) => sentences(String(x ?? ""))).map(ws).filter((s) => s && !questions.some((q) => s === q || q.includes(s)));
  if (questions.length === 1) return { ok: true, stage: "model reasoning-tool selection", detail: "one material question" };
  const honest = body.find((s) => NOT_IN_DOCS.test(s));
  if (honest) return { ok: true, stage: "model reasoning-tool selection", detail: "says what the documents do not say" };
  const substantive = body.filter((s) => !SAID_BACK.test(s) && !GENERIC.has(s));
  const citations = (t.answer.citations ?? []) as unknown[];
  if (substantive.length && citations.length) return { ok: true, stage: "model reasoning-tool selection", detail: "a cited statement" };
  // Where it went wrong first: did the model's terminal call offer anything citable (or did the composer drop it)?
  const terminal = ((t.trace?.toolCalls ?? []) as any[]).filter((c) => c.name === "final_answer" || c.name === "ask_user");
  const offered = terminal.some((c) => [...(c.args?.sentences ?? []), ...(c.args?.statements ?? [])].some((s: any) => (s?.evidence_ids ?? []).length || (s?.value_ids ?? []).length || s?.result_id));
  const stage: Stage = offered || (t.trace?.dropped ?? []).length ? "presentation" : "model reasoning-tool selection";
  const why = !body.length ? "says nothing" : body.every((s) => SAID_BACK.test(s)) ? `only says back the household's words: "${body[0]}"` : body.every((s) => SAID_BACK.test(s) || GENERIC.has(s)) ? `only a generic failure: "${body.find((s) => GENERIC.has(s))}"` : substantive.length ? `nothing cited: "${substantive[0]}"` : `"${body[0]}"`;
  return { ok: false, stage, detail: why };
}

/** Reads a saved conversation back from the database. */
export async function loadConversation(conversationId: string): Promise<LoadedConversation> {
  const c = (await pool.query("SELECT state FROM chat_conversations WHERE id=$1 AND account_id=$2", [conversationId, ACCOUNT_L])).rows[0];
  if (!c) throw new Error(`conversation ${conversationId} not found for the live household`);
  const msgs = (await pool.query("SELECT role, content, answer_json, created_at FROM chat_messages WHERE conversation_id=$1 AND account_id=$2 ORDER BY created_at, message_order", [conversationId, ACCOUNT_L])).rows;
  const pages = new Map<string, string>();
  for (const r of (await pool.query("SELECT policy_id::text AS policy_id, page_number, text FROM policy_pages WHERE account_id=$1", [ACCOUNT_L])).rows) pages.set(`${r.policy_id}:${r.page_number}`, r.text);
  const turns: LoadedTurn[] = [];
  const traces: any[] = c.state?.ragLoop?.turns ?? [];
  let pendingUser: { content: string; at: string } | null = null;
  for (const m of msgs) {
    if (m.role === "user") { pendingUser = { content: m.content, at: new Date(m.created_at).toISOString() }; continue; }
    const answer = (m.answer_json ?? { summary: m.content }) as LoadedTurn["answer"];
    const index = turns.length;
    const user = pendingUser?.content ?? "";
    const trace = traces.find((t) => t.userMessage === user && !turns.some((x) => x.trace === t)) ?? null;
    turns.push({ index, user, answer, content: m.content ?? undefined, visible: visibleText(answer, m.content), questions: (answer.questions ?? []).map((q: any) => String(q?.text ?? "")), userAt: pendingUser?.at ?? null, assistantAt: new Date(m.created_at).toISOString(), trace });
    pendingUser = null;
  }
  return { conversationId, state: c.state, turns, pages };
}

function citesPassage(t: LoadedTurn, state: any, p: Passage): boolean {
  const d = doc(p.doc);
  const want = ws(p.text);
  const ev = state?.ragLoop?.evidence ?? {};
  const chosen: any[] = (t.trace?.evidenceChosen ?? []).map((id: string) => ev[id]).filter(Boolean);
  const excerptHolds = (ex: string) => { const x = ws(ex); return x.includes(want) || (x.length > 10 && want.includes(x)); };
  return ((t.answer.citations ?? []) as any[]).some((c) => {
    if (c.policyId !== d.id) return false;
    const from = c.pageStart ?? 0, to = c.pageEnd ?? c.pageStart ?? 0;
    if (!(from <= p.page && p.page <= to)) return false;
    return excerptHolds(c.excerpt ?? "") || chosen.some((e) => e.policyId === d.id && ws(e.passage?.text ?? "").includes(want));
  });
}
/** Whether any tool call in the conversation ever returned the passage (it was retrieved, whether or not cited). */
function retrieved(state: any, p: Passage): boolean {
  const d = doc(p.doc), want = ws(p.text);
  return Object.values(state?.ragLoop?.evidence ?? {}).some((e: any) => e?.policyId === d.id && e?.page?.start <= p.page && p.page <= (e?.page?.end ?? e?.page?.start) && (ws(e?.passage?.text ?? "").includes(want) || ws(e?.table?.rowLabel ?? "") && want.includes(ws(e.table.rowLabel))));
}

function gradeTurn(t: LoadedTurn, e: TurnExpect, conv: LoadedConversation, out: Check[]) {
  const add = (name: string, ok: boolean, stage: Stage, detail: string) => out.push({ turn: t.index + 1, name, ok, stage, detail });
  const shown = moneyIn(t.visible);
  const printed = new Set(DOCS.flatMap((d) => Object.values(d.pages).flatMap((txt) => moneyIn(txt))));
  const dropped = [...(t.trace?.dropped ?? []).map((d: any) => String(d.sentence ?? "")), ...(t.trace?.gate ?? []).map((g: any) => String(g.figure ?? ""))].join("\n");
  // Presentation (every turn): no internal ids or tool names visible; an estimate is never called a payout.
  add("no internal ids visible", !INTERNAL.test(t.visible), "presentation", INTERNAL.exec(t.visible)?.[0] ?? "none");
  const payout = sentences(t.visible).filter((s) => /\bpayout\b/i.test(s) && !/\bnot a payout\b/i.test(s));
  add("estimate never called a payout", payout.length === 0, "presentation", payout[0] ?? "none");
  // Round 6: every turn -- a printed benefit is never a decision, payment or entitlement; at most ONE question, asked
  // once (by its card, never repeated in the body); asking a material question is never by itself a failure.
  // Round 6c: negation- and scope-aware, like the composer ("a limit, not a guaranteed payment" is not a decision).
  const entitled = sentences(t.visible).filter((s) => ENTITLEMENT.test(withoutNegatedDecisions(s)));
  // Round 6c: a printed figure is never replaced by the withheld-amount wording inside a sentence.
  const withheld = sentences(t.visible).filter((s) => WITHHELD.test(s));
  add("no withheld-amount wording", withheld.length === 0, "presentation", withheld[0] ?? "none");
  add("never states approval, payment or entitlement", entitled.length === 0, "verification", entitled[0] ?? "none");
  const multi = t.questions.filter((q) => (q.match(/\?/g) ?? []).length > 1);
  add("at most one question", t.questions.length <= 1 && !multi.length, "model reasoning-tool selection", t.questions.length > 1 ? `asked ${t.questions.length}: ${t.questions.join(" | ")}` : multi[0] ?? (t.questions[0] ?? "none"));
  const twice = t.questions.filter((q) => count(t.visible, ws(q)) > 1 || count(ws(t.visible), ws(q)) > 1);
  add("each question shown once", twice.length === 0, "presentation", twice.length ? `shown ${count(ws(t.visible), ws(twice[0]))}x: "${twice[0]}"` : "once");
  // Round 7: every substantive turn (not one a limit stopped) is useful.
  if (!t.trace?.limit && (!t.trace || ["final_answer", "ask_user"].includes(t.trace.outcome))) { const u = turnUsefulness(t); add("useful turn (a cited figure or condition, one material question, or what the documents do not say)", u.ok, u.stage, u.detail); }
  for (const f of e.figures ?? []) {
    const v = amount(f);
    const ok = shown.includes(v);
    let stage: Stage = "model reasoning-tool selection";
    // A wrong figure shown in its place names the stage the forbidden figure points at (a wrong column / version / count).
    const instead = (e.forbidden ?? []).find((f) => f.stage && sentences(t.visible).some((s) => moneyIn(s).includes(amount(f.figure)) && !(f.unless && new RegExp(f.unless, "i").test(s))));
    if (!ok) {
      if (instead) stage = instead.stage!;
      else if (moneyIn(dropped).includes(v)) stage = "verification";
      else if ((e.passages ?? []).some((p) => !retrieved(conv.state, p))) stage = "retrieval";
      else if (e.calculation) stage = (t.trace?.toolCalls ?? []).some((c: any) => c.name === "calculate") ? "calculation" : "model reasoning-tool selection";
    }
    add(`shows ${f}`, ok, stage, ok ? "present" : `missing; visible figures: ${shown.map((x) => "S$" + x.toLocaleString("en-SG")).join(", ") || "none"}${moneyIn(dropped).includes(v) ? " (dropped by the composer / gate)" : ""}`);
  }
  for (const f of e.forbidden ?? []) {
    const v = amount(f.figure);
    const bad = sentences(t.visible).filter((s) => moneyIn(s).includes(v) && !(f.unless && new RegExp(f.unless, "i").test(s)));
    add(`never states ${f.figure}`, bad.length === 0, f.stage ?? "model reasoning-tool selection", bad.length ? `${f.why}: "${bad[0]}"` : "absent");
  }
  if (e.conditional) {
    const c = e.conditional, v = amount(c.figure);
    const with_ = sentences(t.visible).filter((s) => moneyIn(s).includes(v));
    const ok = with_.length > 0 && with_.every((s) => new RegExp(c.pattern, "i").test(s));
    add(`${c.figure} stated with ${c.about}`, ok, "model reasoning-tool selection", !with_.length ? "figure not shown" : ok ? "conditional" : `unconditional: "${with_.find((s) => !new RegExp(c.pattern, "i").test(s))}"`);
  }
  if (e.figureOnlyWith) {
    const c = e.figureOnlyWith, v = amount(c.figure);
    const bad = sentences(t.visible).filter((s) => moneyIn(s).includes(v) && !new RegExp(c.pattern, "i").test(s));
    add(`${c.figure} only with ${c.about}`, bad.length === 0, "model reasoning-tool selection", bad[0] ?? (shown.includes(v) ? "with its condition" : "not shown"));
  }
  if (e.noMoney) add("no money figure", shown.length === 0, "model reasoning-tool selection", shown.length ? `shows ${shown.join(", ")}` : "none");
  if (e.noMoneyNear) { const bad = sentences(t.visible).filter((s) => new RegExp(e.noMoneyNear!, "i").test(s) && moneyIn(s).length); add(`no figure near /${e.noMoneyNear}/`, bad.length === 0, "model reasoning-tool selection", bad[0] ?? "none"); }
  if (e.onlyPrintedFigures) { const invented = shown.filter((v) => !printed.has(v) && !(t.answer.calculations ?? []).some((c: any) => c?.result?.value === v)); add("no invented figure", invented.length === 0, "model reasoning-tool selection", invented.length ? `not printed anywhere: ${invented.join(", ")}` : "every figure is printed or calculated"); }
  if (e.asks) { const ok = t.questions.some((q) => new RegExp(e.asks!.pattern, "i").test(q)); add(`asks ${e.asks.about}`, ok, "model reasoning-tool selection", t.questions.length ? `asked: ${t.questions.join(" | ")}` : "no question asked"); }
  if (e.mustNotAsk) { const bad = t.questions.filter((q) => new RegExp(e.mustNotAsk!.pattern, "i").test(q)); add(`does not re-ask ${e.mustNotAsk.about}`, bad.length === 0, "model reasoning-tool selection", bad[0] ?? "no re-ask"); }
  if (e.noQuestion) add("asks no question", t.questions.length === 0, "model reasoning-tool selection", t.questions.join(" | ") || "none");
  for (const s of e.says ?? []) { const ok = new RegExp(s.pattern, "i").test(t.visible); add(`says ${s.about}`, ok, "model reasoning-tool selection", ok ? "yes" : ws(t.visible).slice(0, 200)); }
  // Nobody resolved at all is the model not working out who is meant (tool selection); the wrong person is resolution.
  if (e.subject) { const got = memberKeyOf((t.answer as any).resolvedFamilyMemberId ?? null); add(`about ${e.subject}`, got === e.subject, got === "none" ? "model reasoning-tool selection" : "person-version resolution", `subject after the turn: ${got}`); }
  if (e.binding) {
    const b = e.binding, d = doc(b.doc);
    const binds = ((t.answer as any).figureBindings ?? []) as any[];
    const hit = binds.find((x) => x.value === b.value && x.policyId === d.id && (!x.subjectId || x.subjectId === memberId(b.member)) && (!b.column || ws(x.column ?? "") === b.column));
    add(`figure bound to ${b.member} / ${b.doc}${b.column ? " / " + b.column : ""}`, !!hit, binds.length ? "person-version resolution" : "model reasoning-tool selection", hit ? "bound" : `bindings: ${binds.map((x) => `${x.value}@${DOCS.find((dd) => dd.id === x.policyId)?.key ?? "?"}/${x.column ?? "-"}/${memberKeyOf(x.subjectId)}`).join("; ") || "none"}`);
  }
  for (const p of e.passages ?? []) {
    const ok = citesPassage(t, conv.state, p);
    add(`cites ${p.doc} p${p.page} "${p.text.slice(0, 40)}"`, ok, ok ? "retrieval" : retrieved(conv.state, p) ? "model reasoning-tool selection" : "retrieval", ok ? "cited" : retrieved(conv.state, p) ? "retrieved but not cited" : "never retrieved");
  }
  for (const k of e.notCiting ?? []) { const bad = ((t.answer.citations ?? []) as any[]).some((c) => c.policyId === doc(k).id); add(`does not cite ${k}`, !bad, "person-version resolution", bad ? "cited" : "not cited"); }
  if (e.calculation) {
    const x = e.calculation;
    const recs = ((t.answer as any).calculations ?? []) as CalculationRecord[];
    const rec = recs.find((r) => r.calculator === x.calculator);
    if (!rec) add(`saved ${x.calculator} calculation`, false, (t.trace?.toolCalls ?? []).some((c: any) => c.name === "calculate") ? "calculation" : "model reasoning-tool selection", `no CalculationRecord saved (calculate called: ${(t.trace?.toolCalls ?? []).filter((c: any) => c.name === "calculate").length}x)`);
    else {
      const re = recomputeCalculation(rec);
      add("calculation record recomputes", re.ok && re.resultMinor === Math.round(rec.result.value * 100), "calculation", re.ok ? `recomputed ${re.resultMinor / 100}, saved ${rec.result.value}` : re.error);
      add(`calculation result ${x.result}`, rec.result.value === x.result && rec.kind === x.kind, "calculation", `${rec.kind} ${rec.result.value}`);
      for (const o of x.operands) {
        const got = rec.operands.find((r: any) => o.source === "document" ? r.source === "document" && r.value === o.value : r.source !== "document" && r.role === o.label);
        const okv = !!got && (o.source === "document" || String(got.value).slice(0, 16) === String(o.value).slice(0, 16));
        add(`operand ${o.label} = ${o.value}`, okv, "calculation", got ? `saved ${JSON.stringify(got.value)}` : "missing");
      }
    }
  }
  for (const f of e.factNotRecorded ?? []) {
    const facts = [conv.state?.ragLoop?.claim, ...Object.values(conv.state?.ragLoop?.otherClaims ?? {})].filter(Boolean).flatMap((c: any) => Object.entries(c.facts ?? {}));
    const bad = facts.some(([k, v]: [string, any]) => k === f.key && [v?.value, ...(v?.previous ?? []).map((p: any) => p.value)].map((x) => String(x).toLowerCase()).includes(f.value));
    add(`never records ${f.key}=${f.value}`, !bad, "model reasoning-tool selection", bad ? f.why : "not recorded");
  }
  if (e.factRecorded) {
    const facts = [conv.state?.ragLoop?.claim, ...Object.values(conv.state?.ragLoop?.otherClaims ?? {})].filter(Boolean).flatMap((c: any) => Object.entries(c.facts ?? {}));
    const hit = facts.find(([k, v]: [string, any]) => new RegExp(e.factRecorded!.keyPattern, "i").test(k) && String(v?.words ?? "").toLowerCase().includes(e.factRecorded!.wordsInclude.toLowerCase()));
    add(`records ${e.factRecorded.keyPattern} in their words`, !!hit, "model reasoning-tool selection", hit ? `${hit[0]}="${(hit[1] as any).words}"` : `facts: ${facts.map(([k, v]: [string, any]) => `${k}=${v?.value}`).join(", ") || "none"}`);
  }
  if (e.pendingReasked) { const ok = t.questions.some((q) => new RegExp(e.pendingReasked!.pattern, "i").test(q)) || !!t.trace?.reasked; add("puts the pending question back", ok, "model reasoning-tool selection", ok ? "re-asked" : "not re-asked"); }
}

/** Fixture self-check: every expected passage is verbatim in the stored page (else the failure is document extraction). */
export function fixtureChecks(s: Scenario, conv: LoadedConversation): Check[] {
  const out: Check[] = [];
  s.turns.forEach((turn, i) => {
    for (const p of turn.expect.passages ?? []) {
      const page = conv.pages.get(`${doc(p.doc).id}:${p.page}`) ?? "";
      out.push({ turn: i + 1, name: `stored page ${p.doc} p${p.page} holds the passage`, ok: page.includes(p.text), stage: "document extraction", detail: page ? "present" : "page missing" });
    }
  });
  return out;
}

export function grade(s: Scenario, conv: LoadedConversation): Verdict {
  const checks = fixtureChecks(s, conv);
  let incomplete: string | null = null;
  s.turns.forEach((turn, i) => {
    const t = conv.turns[i];
    if (!t) { incomplete = incomplete ?? `turn ${i + 1} has no saved answer`; return; }
    if (t.user !== turn.user) checks.push({ turn: i + 1, name: "saved user turn matches the scenario", ok: false, stage: "presentation", detail: t.user.slice(0, 80) });
    const lim = t.trace?.limit;
    if (lim || (t.trace && !["final_answer", "ask_user"].includes(t.trace.outcome))) incomplete = incomplete ?? `turn ${i + 1} stopped: ${lim?.kind ?? t.trace?.outcome} ${lim?.detail ?? ""}`.trim();
    gradeTurn(t, turn.expect, conv, checks);
  });
  const failed = checks.filter((c) => !c.ok);
  const stage = failed.length ? STAGES.find((st) => failed.some((c) => c.stage === st)) ?? null : null;
  return { scenario: s.id, verdict: incomplete ? "INCOMPLETE" : failed.length ? "FAIL" : "PASS", failureStage: incomplete ? null : stage, incomplete, checks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  (async () => {
    const dir = process.argv[2];
    if (!dir) throw new Error("usage: check.ts <RUN directory>");
    const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
    for (const c of run.conversations ?? []) {
      const s = SCENARIOS.find((x) => x.id === c.scenario);
      if (!s || !c.conversationId) { console.log(`${c.scenario}: not run`); continue; }
      const v = grade(s, await loadConversation(c.conversationId));
      console.log(`${s.id} ${v.verdict}${v.failureStage ? " (" + v.failureStage + ")" : ""}${v.incomplete ? " -- " + v.incomplete : ""}`);
      for (const ck of v.checks.filter((x) => !x.ok)) console.log(`   t${ck.turn} FAIL [${ck.stage}] ${ck.name}: ${ck.detail}`);
    }
    await pool.end();
  })().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

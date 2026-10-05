/**
 * Round 7 independent battery: loads each household's singles and
 * conversations (scripts/fixtures/r7/<household>/battery.json), sends them
 * through the REAL chat route and scores every answer three ways:
 *   - the battery's own expectations (must_include / forbidden /
 *     global_forbidden, matched exactly as scripts/fixtures/r7/score.py does),
 *   - the behaviour the answer shows (answer, not-found, clarify, claim,
 *     refuse-advice, greeting, out-of-scope), classified from the answer's
 *     structure and wording, against expected_behaviour (+ also_acceptable),
 *   - the Round 6 rubbish detectors (garbled text, leaks, invented amounts,
 *     other households' people, citations to deleted or foreign documents).
 * Response time is recorded per turn.
 */
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";
import { ROOT, type HouseholdId, type LoadedHousehold } from "./household";
import type { GroundTruth, Hit } from "../r6/detectors";

export type Spec = string | { any_of: string[] } | { regex: string };
export type Item = { id: string; turn?: number; message: string; asker?: string; expected_behaviour: string; also_acceptable?: string[]; must_include: Spec[]; forbidden: Spec[];
  forbidden_unless_qualified?: Spec[]; cite?: { doc: string; page: number }[]; tags?: string[]; note?: string };
export type Conversation = { id: string; title: string; asker: string; tags: string[]; turns: (Item & { turn: number })[] };
export type Battery = { household_id: string; default_asker: string; global_forbidden: Spec[]; singles: Item[]; conversations: Conversation[]; notes: string[] };

export async function readBattery(h: HouseholdId): Promise<Battery> {
  return JSON.parse(await readFile(path.join(ROOT, h, "battery.json"), "utf8")) as Battery;
}

// ------------------------------------------------------------------ text checks (score.py, ported)
export function norm(s: string): string {
  let t = s.toLowerCase().replace(/’/g, "'").replace(/ /g, " ");
  t = t.replace(/\b(us\$|usd)\s*/g, "usd");
  t = t.replace(/(?<![a-z])(s\$|sgd|\$)\s*/g, "");
  t = t.replace(/(?<=\d),(?=\d{3}\b)/g, "");
  t = t.replace(/(?<=\d)\.00(?!\d)/g, "");
  return t.replace(/\s+/g, " ").trim();
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function contains(answerN: string, value: string): boolean {
  const v = norm(value);
  if (/\d/.test(v)) return new RegExp("(?<![\\d.])" + esc(v) + "(?!\\d|\\.\\d)").test(answerN);
  return answerN.includes(v);
}
export function specHit(answer: string, answerN: string, spec: Spec): boolean {
  if (typeof spec === "object" && "regex" in spec) return new RegExp(spec.regex, "i").test(answer);
  if (typeof spec === "object" && "any_of" in spec) return spec.any_of.some((x) => contains(answerN, x));
  return contains(answerN, spec);
}
export const specText = (s: Spec) => typeof s === "string" ? s : "any_of" in s ? "any_of(" + s.any_of.join(" | ") + ")" : "/" + s.regex + "/";

/** Everything the household reads for one answer (what the chat page renders). */
export function answerText(a: ChatAnswer, visibleFields: (a: ChatAnswer) => { where: string; text: string }[]): string {
  return visibleFields(a).filter((f) => !/^citation|^disclaimer/.test(f.where)).map((f) => f.text).join("\n");
}

// ------------------------------------------------------------------ behaviour
export const BEHAVIOURS = ["answer", "not-found", "clarify-which-person", "claim-question", "refuse-advice", "greeting", "out-of-scope"] as const;
const NOT_FOUND = /\b(?:(?:could|did)(?: not|n[’']t) find|(?:do(?:es)?|did)(?: not|n[’']t) (?:say|state|show|mention|print|list|include|give|set out|specify)|not (?:stated|shown|printed|mentioned|listed|on file|in (?:the|your) documents?)|no (?:document|policy|figure|amount|premium)[^.]{0,60}\b(?:on file|uploaded|found|printed|stated)|nothing (?:on file|in the documents)|isn[’']t (?:stated|shown|printed|on file)|silent|no longer (?:on file|available)|was deleted|has been deleted|not (?:able|possible) to (?:tell|confirm) from)\b/i;
const REFUSE = /\b(?:can(?:no|['’])t|cannot|won['’]t|not able to|unable to|don['’]t|do not) (?:give|offer|provide|make)? ?(?:personal )?(?:financial |insurance )?(?:advice|recommendations?|recommend|advise|tell you (?:whether|what) (?:to|you should))\b|\bnot (?:financial|personal) advice\b|\b(?:licensed|qualified) (?:financial )?advis[eo]r\b|\bthat decision is yours\b|\bdecide (?:that )?(?:for you|on your behalf)\b/i;
const GREETING = /^(?:(?:hi|hello|hey)\b|you['’]re welcome|glad (?:to|I could) help|no problem|anytime|happy to help|take care|good (?:morning|afternoon|evening))/i;
const OUT_OF_SCOPE = /\b(?:only (?:help|answer)|can only|outside what|not something (?:I|DearPolicy) can|can['’]t (?:do|help with) that|isn['’]t something|not about (?:your|the household['’]s) (?:insurance|policies)|beyond what|I (?:can['’]t|cannot) (?:check|look up|send|book|change|cancel|transfer|submit|file|contact))\b/i;
const CLARIFY = /\b(?:which (?:one|person|of (?:them|the two|your))|who (?:do|did) you mean|do you mean|did you mean)\b|\bor\b[^.?]{1,40}\?/i;

export function classifyBehaviour(a: ChatAnswer): string {
  const summary = (a.summary ?? "").trim();
  const firstQ = a.questions?.[0];
  if (firstQ?.id === "claim_person" || (a.personCandidates?.length ?? 0) > 1 || (CLARIFY.test(summary) && /\?/.test(summary) && !a.claimItems?.length)) return "clarify-which-person";
  const claimish = a.mode !== "answer" || (a.claimItems?.length ?? 0) > 0 || (a.factFinding?.length ?? 0) > 0 || (a.questions?.length ?? 0) > 0 || !!a.claimSessionId;
  if (claimish) return "claim-question";
  if (REFUSE.test(summary)) return "refuse-advice";
  if (GREETING.test(summary) && summary.length < 220 && !(a.citations?.length)) return "greeting";
  if (OUT_OF_SCOPE.test(summary) && !(a.citations?.length)) return "out-of-scope";
  if (NOT_FOUND.test(summary) && !/\b(?:S\$|US\$)\s?\d/.test(summary.split(/(?<=[.!?])\s+/)[0] ?? "")) return "not-found";
  if (!(a.citations?.length) && !(a.policyStatedLimits?.length) && !(a.portfolioItems?.length)) return NOT_FOUND.test(summary) ? "not-found" : "answer-uncited";
  return "answer";
}
/** Behaviours that satisfy an expectation. A grounded answer that also says
 * plainly what the documents do not state satisfies "not-found"; a claim
 * turn may answer the question it was asked. */
export function behaviourOk(expected: string, acceptable: string[], got: string, a: ChatAnswer): boolean {
  const ok = new Set([expected, ...acceptable]);
  if (ok.has(got)) return true;
  if (got === "answer-uncited" && (ok.has("greeting") || ok.has("out-of-scope") || ok.has("refuse-advice"))) return true;
  if (ok.has("not-found") && NOT_FOUND.test([a.summary, ...a.details].join(" "))) return true;
  if (ok.has("claim-question") && (got === "answer" || got === "not-found")) return true;
  if (ok.has("answer") && got === "claim-question" && a.mode === "answer") return true;
  if (ok.has("refuse-advice") && REFUSE.test([a.summary, ...a.details].join(" "))) return true;
  return false;
}

// ------------------------------------------------------------------ running
export type Scored = { household: HouseholdId; id: string; turn: number | null; message: string; status: number; ms: number; expected: string; behaviour: string; behaviourOk: boolean;
  missing: string[]; forbiddenHits: string[]; qualifyReview: string[]; cite: "ok" | "missing" | "n/a"; detectorHits: Hit[]; summary: string; text: string; tags: string[]; error?: string;
  resolved?: string | null; questions?: string[] };

export type RunOpts = {
  hh: LoadedHousehold; others: LoadedHousehold[]; db: { query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> };
  detect: typeof import("../r6/detectors").detect; visibleFields: typeof import("../r6/detectors").visibleFields; moneyIn: (t: string) => number[];
  singles?: (i: Item) => boolean; conversations?: (c: Conversation) => boolean; dump?: string;
  /** Conversations to run instead of the battery's own (long-chat phase). */
  conversationsOverride?: Conversation[];
  /** Items not scored (sent, so a conversation keeps its flow): see EXCLUDED in the suite. */
  exclude?: (id: string, turn: number | null) => boolean;
  /** Skip the singles entirely. */
  noSingles?: boolean;
  extra?: (a: ChatAnswer, question: string) => Hit[];
  onTurn?: (s: Scored) => void;
};

async function groundTruth(o: RunOpts): Promise<GroundTruth> {
  const acct = o.hh.account;
  const pages = new Map<string, string>();
  for (const r of (await o.db.query<{ policy_id: string; text: string }>("SELECT pp.policy_id,string_agg(pp.text,E'\\n' ORDER BY pp.page_number) text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id WHERE p.account_id=$1 AND p.lifecycle_state='active' GROUP BY 1", [acct])).rows) pages.set(r.policy_id, r.text);
  const premiumFigures: number[] = [];
  const amounts = new Set<number>();
  for (const r of (await o.db.query<{ amount: string; notes: string | null }>("SELECT amount::text,notes FROM premium_records WHERE account_id=$1", [acct])).rows) { premiumFigures.push(Number(r.amount)); premiumFigures.push(...o.moneyIn(r.notes ?? "")); amounts.add(Number(r.amount)); }
  // The household's premiums added up (each premium once) is derived, not invented.
  premiumFigures.push(Math.round([...amounts].reduce((n, v) => n + v, 0) * 100) / 100);
  const personPolicies = new Map<string, Set<string>>();
  for (const r of (await o.db.query<{ family_member_id: string; policy_id: string }>("SELECT family_member_id,policy_id FROM policy_members WHERE account_id=$1", [acct])).rows) {
    if (!personPolicies.has(r.family_member_id)) personPolicies.set(r.family_member_id, new Set());
    personPolicies.get(r.family_member_id)!.add(r.policy_id);
  }
  const deleted = o.hh.manifest.documents.filter((d) => d.fixture_state === "deleted").map((d) => o.hh.docIds[d.id]);
  return { pages, premiumFigures: [...new Set(premiumFigures)], householdNames: o.hh.manifest.members.map((m) => m.display_name),
    foreignNames: o.others.flatMap((x) => x.manifest.members.map((m) => m.display_name)),
    foreignPolicyIds: new Set([...o.others.flatMap((x) => Object.values(x.docIds)), ...deleted]), personPolicies };
}

export async function runBattery(o: RunOpts): Promise<Scored[]> {
  const { POST } = await import("@/app/api/chat/route");
  const battery = await readBattery(o.hh.id);
  const g = await groundTruth(o);
  const docOf = new Map(Object.entries(o.hh.docIds).map(([doc, id]) => [id, doc]));
  const owner = o.hh.manifest.account_owner;
  const out: Scored[] = [];
  const send = async (asker: string, question: string, conv: { id?: string; rev?: number; member?: string | null }) => {
    process.env.DEV_ACCOUNT_ID = o.hh.account;
    // The owner asks from the household chat; anyone else from their own page.
    const member = conv.member !== undefined ? conv.member : asker === owner ? null : o.hh.memberIds[asker];
    const t0 = Date.now();
    const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: member ? "member" : "family", question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore",
        ...(asker !== owner ? { askerFamilyMemberId: o.hh.memberIds[asker] } : {}) }) }));
    const ms = Date.now() - t0;
    const data = await res.json();
    if (res.status === 200) { const a = data.answer as ChatAnswer; conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev;
      // The chat page follows the person the answer was about.
      if (a.resolvedFamilyMemberId) conv.member = a.resolvedFamilyMemberId; }
    return { status: res.status, data, ms };
  };
  const score = async (item: Item, turn: number | null, r: { status: number; data: { answer?: ChatAnswer; error?: string }; ms: number }, userText: string, claimTurn: boolean) => {
    const a = r.status === 200 ? r.data.answer! : null;
    const text = a ? answerText(a, o.visibleFields) : String(r.data?.error ?? "");
    const n = norm(text);
    const missing = item.must_include.filter((m) => !specHit(text, n, m)).map(specText);
    const forbiddenHits = [...item.forbidden, ...battery.global_forbidden].filter((f) => specHit(text, n, f)).map(specText);
    const qualifyReview = (item.forbidden_unless_qualified ?? []).filter((f) => specHit(text, n, f)).map(specText);
    const behaviour = a ? classifyBehaviour(a) : "error";
    const ok = a ? behaviourOk(item.expected_behaviour, item.also_acceptable ?? [], behaviour, a) : false;
    let cite: Scored["cite"] = "n/a";
    if (item.cite?.length && a && /^(?:answer|claim-question)$/.test(item.expected_behaviour)) {
      const got = new Set([...(a.citations ?? []), ...(a.policyStatedLimits ?? []).map((l) => l.citation)].flatMap((c) => {
        const doc = docOf.get(c.policyId); if (!doc) return [];
        const pages: number[] = []; for (let p = c.pageStart ?? 0; p <= (c.pageEnd ?? c.pageStart ?? 0); p++) pages.push(p);
        return pages.map((p) => doc + "#" + p);
      }));
      cite = item.cite.some((c) => got.has(c.doc + "#" + c.page)) ? "ok" : "missing";
    }
    const detectorHits = a ? [...o.detect(a, { question: item.message, userText, claimTurn, ms: r.ms }, g), ...(o.extra?.(a, item.message) ?? [])]
      : [{ rule: "HTTP " + r.status, text: String(r.data?.error ?? "") }];
    if (o.exclude?.(item.id, turn)) return a;
    const s: Scored = { household: o.hh.id, id: item.id, turn, message: item.message, status: r.status, ms: r.ms, expected: item.expected_behaviour, behaviour, behaviourOk: ok,
      missing, forbiddenHits, qualifyReview, cite, detectorHits, summary: a?.summary ?? "", text, tags: item.tags ?? [],
      resolved: a?.resolvedFamilyMemberId ?? null, questions: a ? [...(a.questions ?? []).map((q) => q.text), ...(a.factFinding ?? []).flatMap((p) => p.nextQuestions.map((q) => q.text))] : [] };
    out.push(s); o.onTurn?.(s);
    if (o.dump) await appendFile(o.dump, JSON.stringify({ ...s, answer: a }) + "\n");
    return a;
  };
  for (const item of o.noSingles ? [] : battery.singles) {
    if (o.singles && !o.singles(item)) continue;
    const conv = {};
    try { const r = await send(item.asker ?? battery.default_asker, item.message, conv); await score(item, null, r, item.message, item.expected_behaviour === "claim-question"); }
    catch (e) { out.push(errorRecord(o.hh.id, item, null, e)); }
  }
  for (const c of o.conversationsOverride ?? battery.conversations) {
    if (o.conversations && !o.conversations(c)) continue;
    const conv: { id?: string; rev?: number; member?: string | null } = {};
    let userText = "";
    let inClaim = false;
    let lastAsker: string | null = null;
    for (const t of c.turns) {
      userText += "\n" + t.message;
      try {
        const asker = (t as { asker?: string }).asker ?? c.asker;
        // Someone else picks up the chat: it opens on their page.
        if (asker !== lastAsker) { if (lastAsker !== null) conv.member = undefined; lastAsker = asker; }
        const r = await send(asker, t.message, conv);
        const a = await score({ ...t, id: (t as { id?: string }).id ?? c.id }, t.turn, r, userText, inClaim || t.expected_behaviour === "claim-question");
        if (out.length) (out[out.length - 1] as Scored & { longId?: string }).longId = c.id;
        if (a) inClaim = a.mode !== "answer" || (a.claimItems?.length ?? 0) > 0;
      } catch (e) { out.push(errorRecord(o.hh.id, { ...t, id: c.id }, t.turn, e)); break; }
    }
  }
  return out;
}
function errorRecord(household: HouseholdId, item: Item, turn: number | null, e: unknown): Scored {
  return { household, id: item.id, turn, message: item.message, status: 0, ms: 0, expected: item.expected_behaviour, behaviour: "error", behaviourOk: false, missing: [], forbiddenHits: [], qualifyReview: [],
    cite: "n/a", detectorHits: [{ rule: "threw", text: (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400) }], summary: "", text: "", tags: item.tags ?? [] };
}

/** Per-household tallies. */
export function tally(rows: Scored[]) {
  const items = rows.length;
  const withFacts = rows.filter((r) => r.missing.length === 0).length;
  return {
    items,
    factsCorrect: withFacts,
    forbiddenHits: rows.reduce((n, r) => n + r.forbiddenHits.length, 0),
    itemsWithForbidden: rows.filter((r) => r.forbiddenHits.length).length,
    behaviourCorrect: rows.filter((r) => r.behaviourOk).length,
    detectorHits: rows.reduce((n, r) => n + r.detectorHits.length, 0),
    itemsWithDetectorHits: rows.filter((r) => r.detectorHits.length).length,
    citeMissing: rows.filter((r) => r.cite === "missing").length,
    fullPass: rows.filter((r) => !r.missing.length && !r.forbiddenHits.length && r.behaviourOk && !r.detectorHits.length).length,
  };
}
export function percentile(values: number[], p: number) { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; }

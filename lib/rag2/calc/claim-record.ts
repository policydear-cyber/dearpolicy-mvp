/**
 * Agent K: the claim record for a conversation-loop claim, through the EXISTING workflow (lib/claims/record.ts
 * recordClaim -> claim_sessions + decision packet), and only when the household is pursuing a claim: a calculate call
 * with purpose "claim" for the person whose event facts the loop has recorded. An ordinary policy question (purpose
 * question / what_if, or no recorded event) never creates or changes a claim.
 *
 * No payable amount reaches the claim record from here: every item is written with amountText null and no
 * calculatedAmount, so the claim workflow's own monetary gate, reviewed evidence and reviewer decisions
 * (lib/claims/monetary-gate.ts, indicative-assessment.ts) remain the only way a claim amount is shown on the Claims page.
 *
 * Agent G:
 *  - The amount the household says it is CLAIMING is recorded on the claim (facts.claimedAmount: amount, currency as
 *    they gave it, their words, the turn) -- the claim pack lists it as reported and asks for the receipts behind it
 *    (lib/claims/claim-pack.ts). It is its own kind: never the bill (facts.hospitalBill), a printed limit or an
 *    estimate, and never a calculation input.
 *  - syncLoopClaimState() keeps the PERSISTED claim in step with the conversation: a corrected person moves the record
 *    to them, corrected amounts / dates replace the stored facts, and every calculation that depended on what changed
 *    (or on a document since deleted / superseded) is kept on the record but marked withdrawn.
 */
import { query } from "@/lib/db/client";
import { claimFactsFromSubject, ensureClaimRecordSchema, recordClaim } from "@/lib/claims/record";
import { figuresIn } from "@/lib/chat/answer-verification";
import type { SubjectFacts } from "@/lib/chat/types";
import type { ClaimAssessmentItem, ClaimDecisionPacket, ReportedClaimAmount } from "@/lib/claims/types";
import type { ClaimItem } from "@/types";
import type { CalcOutcome } from "./engine";
import { factConcept, isoParts, normalizeKey, numbersIn } from "../loop/facts";
import type { LoopCalcRef, LoopClaim, RagLoopState } from "../loop/types";

type Calc = CalcOutcome & { purpose?: string };

/** True only when a calculation was made for a claim the household is pursuing, about the person whose event the
 * loop has recorded facts for. */
export function isClaimScenario(state: RagLoopState, calcs: Calc[]): boolean {
  const subject = state.claim?.subjectId;
  if (!subject || !Object.keys(state.claim?.facts ?? {}).length) return false;
  return calcs.some((c) => c.purpose === "claim" && c.subjectId === subject);
}

/** Keys under which the household's claimed amount is recorded (never a bill, a limit or an estimate). */
export const CLAIMED_AMOUNT_KEY = /^(?:claim(?:ed|ing)?_(?:amount|sum|total|value)|amount_(?:claimed|to_claim|being_claimed|claiming)|claimed|amount_of_(?:the_)?claim)$/;

/** The claimed amount the household stated (their own words, confirmed), with its provenance; null when none. The
 * currency is the one their words give (S$ / SGD ...), never one the model added; null when they gave none. */
export function claimedAmountOf(claim: LoopClaim | null | undefined, at = new Date().toISOString()): ReportedClaimAmount | null {
  const entry = Object.entries(claim?.facts ?? {}).find(([k, f]) => CLAIMED_AMOUNT_KEY.test(normalizeKey(k)) && (f.source ?? "user_reported") === "user_reported" && (f.basis ?? "stated") === "stated");
  if (!entry) return null;
  const read = (value: unknown, words: string) => {
    const said = numbersIn(words);
    const amount = numbersIn(String(value).replace(/\b[A-Z]{3}\b/g, " ")).find((n) => said.some((s) => Math.abs(s - n) < 1e-9));
    const fig = figuresIn(words).find((x) => amount != null && Math.abs(x.value - amount) < 1e-9);
    return amount == null ? null : { amount, currency: fig?.currency ?? null };
  };
  const [, f] = entry;
  const now = read(f.value, f.words);
  if (!now) return null;
  const previous = (f.previous ?? []).map((p) => { const r = read(p.value, p.words); return r ? { ...r, words: p.words, turn: p.turn } : null; }).filter((p): p is NonNullable<typeof p> => !!p);
  return { kind: "user_reported_claim_amount", amount: now.amount, currency: now.currency, source: "user_reported", words: f.words, turn: f.turn, recordedAt: at, ...(previous.length ? { previous } : {}) };
}

const isoDate = (v: unknown) => { const p = isoParts(String(v)); return p ? `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : null; };
function subjectFacts(state: RagLoopState): SubjectFacts {
  const out: SubjectFacts = {};
  const put = (key: string, value: string | number | boolean, quote: string, turn: number) => { out[key] = { value, state: "known", quote, recordedAt: `turn ${turn}`, source: "user" }; };
  for (const [key, f] of Object.entries(state.claim?.facts ?? {})) {
    const v = String(f.value);
    // Agent G: the claimed amount is its own record (claimedAmountOf), never the bill; admission / discharge dates are
    // the claim's dates (a corrected date replaces the stored one).
    if (CLAIMED_AMOUNT_KEY.test(normalizeKey(key))) continue;
    const concept = factConcept(key).concept;
    if (concept === "admission" && isoDate(v)) put("admissionDate", isoDate(v)!, f.words, f.turn);
    if (concept === "discharge" && isoDate(v)) put("dischargeDate", isoDate(v)!, f.words, f.turn);
    if (/^(?:cause|accident)/.test(key)) { put("injured", true, f.words, f.turn); if (/accident|fall|fell|slip/i.test(v + " " + f.words)) put("accidentType", v, f.words, f.turn); }
    if (/^injur/.test(key)) { put("injured", true, f.words, f.turn); put("injuries", v, f.words, f.turn); }
    if (/^admitted$|hospitali[sz]ed|warded/.test(key) && /^(?:yes|true)$/i.test(v)) put("hospitalised", true, f.words, f.turn);
    if (/bill/.test(key)) { const n = Number(v.replace(/[^\d.]/g, "")); if (Number.isFinite(n) && n > 0) put("hospitalBill", n, f.words, f.turn); }
    if (/diagnos/.test(key)) put("diagnosis", v, f.words, f.turn);
    if (/^(?:event_)?date$|accident_date|event_date/.test(key)) put("eventDate", v, f.words, f.turn);
  }
  return out;
}

/** Writes (or updates) the conversation's claim record when -- and only when -- it is a claim scenario. */
export async function syncCalcClaimRecord(args: { accountId: string; conversationId: string; state: RagLoopState; calcs: Calc[]; existingId?: string | null }): Promise<{ id: string } | null> {
  if (!isClaimScenario(args.state, args.calcs)) return null;
  const subject = args.state.claim!.subjectId!;
  const calcs = args.calcs.filter((c) => c.subjectId === subject && c.purpose === "claim");
  const items: ClaimItem[] = calcs.map((c) => ({
    title: `${c.benefit}`,
    status: c.kind === "not_payable" ? "not_applicable" : "potentially_applicable",
    amountText: null,
    reason: c.kind === "unresolved" ? c.unresolvedText : c.kind === "not_payable" ? c.unresolvedText : `Worked out in the chat as ${c.kind === "indicative_estimate" ? "an indicative estimate" : "an illustration"} from the policy wording; the insurer assesses the claim.`,
    conditions: c.conditions.map((x) => `${x.status}: ${x.text}`),
    calculationId: c.calcId,
  }));
  const facts = subjectFacts(args.state);
  const eventWords = Object.values(args.state.claim!.facts).map((f) => f.words).find((w) => w.length > 8) ?? calcs[0]?.benefit ?? "Claim";
  const missing = [...new Set(calcs.flatMap((c) => c.requirements))];
  // Agent G: a corrected person / fact first moves and marks the existing record, so the new items are written to the
  // corrected person's claim and the withdrawn ones stay on it, marked.
  const prior = await syncLoopClaimState({ accountId: args.accountId, state: args.state, conversationId: args.conversationId, existingId: args.existingId ?? null });
  const priorPacket = prior ? await packetOf(args.accountId, prior.id) : null;
  const recorded = await recordClaim({ accountId: args.accountId, familyMemberId: subject, existingId: prior?.id ?? args.existingId ?? null, facts, eventSummary: eventWords.slice(0, 120), items, citations: [],
    knownFacts: Object.entries(args.state.claim!.facts).map(([k, f]) => `${k.replace(/_/g, " ")}: ${String(f.value)}`), missingFacts: missing,
    complete: !missing.length, nextSteps: [...new Set(calcs.flatMap((c) => c.evidenceRequirements))].map((d) => "Attach: " + d), conversationId: args.conversationId, claimCategory: null,
    claimedAmount: claimedAmountOf(args.state.claim) });
  // Withdrawn items of the earlier record stay on it, marked (never silently replaced by the new ones).
  const kept = (priorPacket?.assessments ?? []).filter((a) => a.withdrawn && !items.some((i) => i.calculationId && i.calculationId === a.id));
  if (kept.length) {
    const now = await packetOf(args.accountId, recorded.id);
    const row = (await query<{ facts: unknown }>("SELECT facts FROM claim_sessions WHERE id=$1 AND account_id=$2", [recorded.id, args.accountId])).rows[0];
    const packet: ClaimDecisionPacket = now ? { ...now, assessments: [...now.assessments, ...kept] } : { ...priorPacket!, facts: (row?.facts ?? priorPacket!.facts) as ClaimDecisionPacket["facts"], assessments: kept, ready: false };
    await query("UPDATE claim_sessions SET decision_packet=$1::jsonb WHERE id=$2 AND account_id=$3", [JSON.stringify(packet), recorded.id, args.accountId]);
  }
  args.state.claimRecord = { id: recorded.id, memberId: subject };
  return { id: recorded.id };
}

async function packetOf(accountId: string, id: string): Promise<ClaimDecisionPacket | null> {
  const r = (await query<{ decision_packet: ClaimDecisionPacket | null }>("SELECT decision_packet FROM claim_sessions WHERE id=$1 AND account_id=$2", [id, accountId])).rows[0];
  return r?.decision_packet ?? null;
}

/** Agent G: the facts a calculation rests on -- the recorded household facts its household operands quote. */
export function calcFactKeys(c: Pick<CalcOutcome, "record">, claim: LoopClaim | null | undefined): string[] {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const keys = new Set<string>();
  for (const o of c.record?.operands ?? []) {
    if (o.source !== "household") continue;
    const a = norm(o.attribution ?? "");
    for (const [k, f] of Object.entries(claim?.facts ?? {})) {
      const w = norm(f.words ?? "");
      const sameWords = a.length >= 2 && w.length >= 2 && (w.includes(a) || a.includes(w));
      const sameRole = (o.role === "admission" && factConcept(k).concept === "admission") || (o.role === "discharge" && factConcept(k).concept === "discharge") || (o.role === "bill" && factConcept(k).concept === "bill");
      if (sameWords || (sameRole && numbersIn(String(f.value)).some((n) => numbersIn(String(o.value)).includes(n)))) keys.add(k);
    }
  }
  return [...keys];
}
/** Agent G: what to remember about one calculation of the claim. */
export function calcRef(c: CalcOutcome, claim: LoopClaim | null | undefined, evidenceIds: string[], turn: number): LoopCalcRef {
  return { calcId: c.calcId, kind: c.kind, policyId: c.policyId, benefit: c.benefit, factKeys: calcFactKeys(c, claim), evidenceIds, turn, withdrawn: null };
}

type SessionRow = { id: string; family_member_id: string; conversation_id: string | null; status: string; facts: Record<string, unknown> | null; decision_packet: ClaimDecisionPacket | null };
/**
 * Agent G: brings the persisted claim in line with the conversation's claim: the person (a correction moves the record
 * from the person first named to the corrected one), the facts (corrected amounts and dates replace the stored ones;
 * the claimed amount with its provenance) and the decision packet (each item worked out from something since corrected
 * or from a source since deleted / superseded is kept, marked withdrawn, and the packet is no longer ready). Writes only
 * a claim record that already exists for this conversation; never creates one. Idempotent.
 */
export async function syncLoopClaimState(args: { accountId: string; state: RagLoopState; conversationId?: string | null; existingId?: string | null }): Promise<{ id: string; moved: boolean; withdrawn: string[] } | null> {
  const claim = args.state.claim;
  const subject = claim?.subjectId ?? null;
  if (!subject) return null;
  await ensureClaimRecordSchema().catch(() => undefined);
  const cols = "id::text AS id, family_member_id::text AS family_member_id, conversation_id::text AS conversation_id, status, facts, decision_packet";
  const ids = [args.state.claimRecord?.id, args.existingId].filter((x): x is string => !!x);
  let rows: SessionRow[] = [];
  if (args.conversationId) rows = (await query<SessionRow>(`SELECT ${cols} FROM claim_sessions WHERE account_id=$1 AND conversation_id=$2 ORDER BY created_at`, [args.accountId, args.conversationId]).catch(() => ({ rows: [] as SessionRow[] }))).rows;
  if (!rows.length && ids.length) rows = (await query<SessionRow>(`SELECT ${cols} FROM claim_sessions WHERE account_id=$1 AND id::text = ANY($2::text[]) ORDER BY created_at`, [args.accountId, ids]).catch(() => ({ rows: [] as SessionRow[] }))).rows;
  if (!rows.length) return null;
  const movedFrom = new Set((args.state.claimMoves ?? []).filter((m) => m.to === subject).map((m) => m.from));
  let own = rows.find((r) => r.family_member_id === subject) ?? null;
  const at = new Date().toISOString();
  const mark = (p: ClaimDecisionPacket | null, pick: (a: ClaimAssessmentItem) => { cause: "person" | "fact" | "source"; reason: string; key?: string | null } | null) => {
    if (!p) return { packet: p, changed: [] as string[] };
    const changed: string[] = [];
    const assessments = p.assessments.map((a) => { if (a.withdrawn) return a; const w = pick(a); if (!w) return a; changed.push(a.id); return { ...a, withdrawn: { ...w, at } }; });
    return { packet: changed.length ? { ...p, assessments, ready: false } : p, changed };
  };
  let moved = false;
  const withdrawn: string[] = [];
  for (const r of rows) {
    if (r.family_member_id === subject || !movedFrom.has(r.family_member_id)) continue;
    // Everything on the record was worked out for the person first named.
    const reason = "the household corrected who this claim is about, so what was worked out for the person first named no longer applies";
    const m = mark(r.decision_packet, () => ({ cause: "person", reason }));
    withdrawn.push(...m.changed);
    if (!own) {
      await query("UPDATE claim_sessions SET family_member_id=$1, decision_packet=$2::jsonb, status='fact_finding', completed_at=NULL, updated_at=now() WHERE id=$3 AND account_id=$4", [subject, m.packet ? JSON.stringify(m.packet) : null, r.id, args.accountId]);
      own = { ...r, family_member_id: subject, decision_packet: m.packet };
      moved = true;
    } else {
      await query("UPDATE claim_sessions SET decision_packet=$1::jsonb, status='fact_finding', completed_at=NULL, updated_at=now() WHERE id=$2 AND account_id=$3", [m.packet ? JSON.stringify(m.packet) : null, r.id, args.accountId]);
    }
  }
  if (!own) return null;
  // Items worked out from a fact since corrected, or from a source since deleted / superseded.
  const refs = claim!.calcs ?? {};
  const m = mark(own.decision_packet, (a) => { const w = refs[a.id]?.withdrawn; return w ? { cause: w.cause, reason: w.reason, key: w.key ?? null } : null; });
  withdrawn.push(...m.changed);
  const facts = { ...claimFactsFromSubject(subjectFacts(args.state)), claimedAmount: claimedAmountOf(claim) };
  // (Facts the workflow itself owns -- reviewed evidence, definition matches -- are kept from the stored record.)
  const stored = (own.facts ?? {}) as Record<string, unknown>;
  for (const k of ["causeDefinitionMatches", "ciDefinitionMatches", "verifiedMedicalBillFacts", "medicalBillEvidenceReviewed", "causeOfDeathEvidenceReviewed", "priorPaidAmounts"]) if (stored[k] != null) (facts as Record<string, unknown>)[k] = stored[k];
  const packet = m.packet ? { ...m.packet, facts } : null;
  const status = withdrawn.length || moved ? "fact_finding" : own.status;
  await query(`UPDATE claim_sessions SET facts=$1::jsonb, decision_packet=$2::jsonb, status=$3, event_type=COALESCE($4,event_type), completed_at=CASE WHEN $3='complete' THEN completed_at ELSE NULL END, updated_at=now() WHERE id=$5 AND account_id=$6`,
    [JSON.stringify(facts), packet ? JSON.stringify(packet) : null, status, facts.eventType, own.id, args.accountId]);
  args.state.claimRecord = { id: own.id, memberId: subject };
  return { id: own.id, moved, withdrawn };
}

/**
 * Replies to a what-if's own question ("Roughly how much would the ambulance
 * charge be?").
 *
 * A what-if records nothing against anyone's profile, so its question was
 * never a pending fact: the reply ("...: Not sure", "about 3 nights") was read
 * as a new message, the what-if was answered again from scratch and the same
 * question came back, turn after turn. The reply is now recognised here and
 * kept in this conversation's own state only (ConversationState.whatIf):
 * "not sure" is accepted as unknown, a figure is noted, and that question is
 * never put again in this what-if.
 */
import type { ConversationState } from "./types";

export type WhatIfReply = { factKey: string; text: string; value: number | "unknown" };

const UNSURE = /^(?:(?:i\s*(?:am|'m|’m)\s+)?(?:not\s+sure|unsure)|unknown|not\s+(?:yet\s+)?known|no\s+idea|idk|dunno|(?:i\s+)?(?:don['’]?t|dont|do\s+not)\s+know|can['’]?t\s+say|cannot\s+say|not\s+certain|tbc|to\s+be\s+confirmed|n\/?a|-+|\?+)(?:[\s,]+(?:yet|lah|leh|sorry|really|exactly))*[.!\s]*$/i;
const FIGURE = /^(?:about|around|roughly|maybe|approx\.?|approximately|~|est\.?)?\s*(?:s\s?\$|\$|sgd\s*)?\s*\d[\d,]*(?:\.\d+)?\s*(?:k\b)?\s*(?:nights?|days?|dollars?|sgd)?[.!\s]*$/i;

/** Whether this message answers the what-if question that is open, and with what. */
export function readWhatIfReply(whatIf: ConversationState["whatIf"], message: string): WhatIfReply | null {
  const pending = whatIf?.pending;
  if (!pending) return null;
  const said = (message ?? "").trim();
  const stem = pending.text.replace(/\?\s*$/, "").trim().toLowerCase();
  let rest: string | null = null;
  // The question card's own "Question: answer" form.
  if (stem && said.toLowerCase().startsWith(stem)) rest = said.slice(stem.length).replace(/^\s*\??\s*[:\-–—]?\s*/, "").trim();
  // A bare reply typed into the box: "not sure", "idk", "about 3", "S$500".
  else if (UNSURE.test(said) || FIGURE.test(said)) rest = said;
  if (rest == null) return null;
  return { factKey: pending.factKey, text: pending.text, value: valueOf(rest) };
}

function valueOf(text: string): number | "unknown" {
  if (!text || UNSURE.test(text)) return "unknown";
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k\b)?/i);
  if (!m || !/^[^a-z]*(?:about|around|roughly|maybe|approx|approximately|est|s\s?\$|sgd)?[^a-z]*\d/i.test(text)) return "unknown";
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n >= 0 ? n : "unknown";
}

const LABEL: Record<string, string> = {
  hospitalNights: "the number of nights in hospital",
  hospitalBill: "the hospital bill",
  ambulanceBill: "the ambulance charge",
  vehicleRepairBill: "the repair bill",
  outOfPocket: "what you would pay yourself",
};
/** One plain sentence acknowledging the reply, different for each question. */
export function acknowledgeWhatIfReply(reply: WhatIfReply): string {
  const label = LABEL[reply.factKey] ?? "that figure";
  return reply.value === "unknown"
    ? "No problem — " + label + " can stay open until the real figure is known."
    : "Noted for " + label + ".";
}

/** A planned operation or admission (not an accident or an emergency): an
 * ambulance charge is not something to ask about. */
export function describesPlannedProcedure(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  if (/\b(?:accident|emergency|a\s*&\s*e|collaps\w*|crash\w*|fell|fall(?:s|en)?|injur\w*|knocked|hit by|ambulance|stroke|heart attack|unconscious|faint\w*)\b/.test(t)) return false;
  const procedure = /\b(?:surgery|surgeries|operation|op|procedure|replacement|scope|colonoscopy|endoscopy|cataract|admission|day surgery|c-?section|delivery)\b/.test(t);
  const planned = /\b(?:planned|plan to|scheduled|elective|booked|upcoming|next (?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|going to (?:have|do|undergo)|will (?:have|be having|undergo|go for)|am having|i['’]m having|having (?:a |my |an )?(?:knee |hip |eye |back )?(?:surgery|operation|procedure)|before (?:the|my) (?:surgery|operation))\b/.test(t);
  return procedure && planned;
}

/** The what-if state after asking (or not asking) this turn's question.
 * Replies are kept for the whole conversation: someone who could not say what
 * the ambulance would cost cannot say it for the same what-if asked again in
 * other words either. */
export function whatIfAfterTurn(previous: ConversationState["whatIf"], query: string, asked: { factKey: string; text: string } | null): NonNullable<ConversationState["whatIf"]> {
  return { query, answers: previous?.answers ?? {}, ...(asked ? { pending: asked } : {}) };
}
/** The questions this conversation's what-ifs have already had a reply to. */
export function repliedWhatIf(previous: ConversationState["whatIf"], _query?: string): Record<string, number | "unknown"> {
  return previous?.answers ?? {};
}

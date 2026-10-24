/**
 * Round 6: the last check on every chat answer before it is saved and shown.
 *
 * This is a safety net, not where answers are written: every rule below has a
 * root-cause fix where the text is composed, and scripts/r6-chat-quality-
 * regressions.ts runs 250+ messages with none of them firing. It exists for
 * what only a live model or a future change could produce -- an id, a table
 * name, a model name, a template token or a stutter in household-facing text.
 *
 * It repairs mechanical faults (a doubled word, stray spacing and
 * punctuation, a sentence said twice) and drops a sentence that leaks
 * internals. It never touches what is quoted from a document: citation
 * excerpts, policy-stated limits and anything inside quotation marks are left
 * exactly as printed, and it never adds a figure. If nothing honest is left
 * of the summary, it says so plainly instead of showing an empty answer.
 */
import type { ChatAnswer } from "@/types";

export const GUARD_FALLBACK_SUMMARY = "Sorry, I couldn’t put that answer together properly. Please ask again, or ask about one policy or one person at a time.";

// V1.5: a key, token or credential-shaped value (prefixed API keys, JWTs, PEM blocks, long mixed-case random strings).
const KEYLIKE = /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA)[-_](?:(?:live|test|proj)[-_])?[A-Za-z0-9]{12,}|\beyJ[\w-]{8,}\.|-----BEGIN|\b(?=[A-Za-z0-9+/=]*\d)(?=[A-Za-z0-9+/=]*[A-Z])(?=[A-Za-z0-9+/=]*[a-z])[A-Za-z0-9+/=]{32,}/;
// Things a household must never read.
const LEAKS: RegExp[] = [
  KEYLIKE,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // ids
  /\b(?:undefined|NaN|\[object Object\])\b|\bnull\b(?=\s*(?:[.,;:]|$))/, // debug tokens
  /\{\{?\s*[a-zA-Z_][\w.]*\s*\}\}?|\$\{[^}]*\}|<\/?[a-z]+[^>]*>/, // template tokens, markup
  /\b(?:gpt-?\d[\w.-]*|chatgpt|gemini(?:-[\w.]+)?|openai|anthropic|claude-[\w.-]+|llm|large language model|embeddings?|vector (?:store|database)|pinecone|pgvector|supabase|postgres(?:ql)?)\b/i, // model / provider / store names
  /\b(?:policy_benefits|policy_members|coverage_rules|family_members|chat_conversations|chat_messages|document_chunks|premium_records|policies\.id|processing_status|processing_error)\b/i, // table and column names
  /\b[a-z]+(?:_[a-z0-9]+){1,}\b/, // any other snake_case identifier
  /\b(?:row|chunk|job|batch) (?:id|#)\s*\d+|\bchunk_?id\b|\bjob (?:state|status)[: ]+(?:queued|running|failed|succeeded)\b/i,
];

/** Spans the guard must not edit: “quoted” and "quoted" text, and -- V1.5 (pr50-live C: an inventory line naming an
 * upload by its file name, "scan_20240611_0932.jpg", was dropped at save time as a snake_case identifier, after
 * composition and verification had kept it) -- the household's own document and file names the answer lists
 * (ChatAnswer.libraryNames, set by the server from the library record, never by the model). */
function protectedSpans(text: string, names: readonly string[] = []): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(/“[^”]*”|"[^"]*"/g)) spans.push([m.index!, m.index! + m[0].length]);
  for (const n of names) {
    if (n.length < 3) continue;
    let at = text.indexOf(n);
    while (at >= 0) {
      const end = at + n.length;
      // only the WHOLE name: never a stretch inside a longer token ("summary" inside "summary_internal_table")
      const whole = !/[\w-]/.test(text.charAt(at - 1) || " ") && !/[\w-]/.test(text.charAt(end) || " ");
      if (whole && !spans.some(([a, b]) => at < b && end > a)) spans.push([at, end]);
      at = text.indexOf(n, end);
    }
  }
  return spans.sort((x, y) => x[0] - y[0]);
}
function outsideQuotes(text: string, names: readonly string[] = []): string {
  let out = "", at = 0;
  for (const [a, b] of protectedSpans(text, names)) { out += text.slice(at, a) + " ".repeat(b - a); at = b; }
  return out + text.slice(at);
}
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/);

/** Mechanical repairs outside quotes: doubled words, spacing, punctuation. */
export function repairText(text: string, names: readonly string[] = []): string {
  if (!text) return text;
  const spans = protectedSpans(text, names);
  if (spans.length) {
    // Repair each unquoted stretch on its own.
    let out = "", at = 0;
    for (const [a, b] of spans) { out += repairPlain(text.slice(at, a)) + text.slice(a, b); at = b; }
    return (out + repairPlain(text.slice(at))).trim();
  }
  return repairPlain(text).trim();
}
function repairPlain(text: string): string {
  return text
    .replace(/\b([A-Za-z]{2,})\s+\1\b/gi, (m, w: string) => /^(?:that|had|is|very|bye|no|so|ha|there)$/i.test(w) ? m : w)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*([.,])/g, "$1")
    .replace(/(?<!\.)\.\.(?!\.)/g, ".")
    .replace(/;\s*\./g, ".")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ");
}

/** Drops each sentence that leaks internals; repairs the rest. Returns null when nothing is left. */
export function guardText(text: string, names: readonly string[] = []): string | null {
  if (typeof text !== "string" || !text.trim()) return text;
  const kept = sentencesOf(text).filter((s) => !LEAKS.some((re) => re.test(outsideQuotes(s, names))));
  const joined = repairText(kept.join(" "), names);
  return joined.trim() ? joined : null;
}

/** Removes leaking tokens themselves (for a question, which cannot be dropped). */
export function scrub(text: string): string {
  let out = text;
  for (const re of LEAKS) out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), "");
  return repairText(out);
}

/** Each time the guard had to change an answer (read by the quality suite,
 * which requires none: a change here means a root cause still needs fixing). */
export const guardInterventions: { before: string; after: string }[] = [];

/** V1.5: the library names an answer may show verbatim -- ChatAnswer.libraryNames, which ONLY the server sets, from the
 * household's own authorised, lifecycle-filtered inventory (the loop's household_documents lookup). Even from there, a
 * value shaped like something other than a document or file name never gains the exemption: a storage path, a key or
 * token, a bare id, an over-long value, or one of the answer's own record ids. */
const BARE_ID = /^\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$/i;
export function protectableNames(answer: ChatAnswer): string[] {
  const ids = new Set<string>([...(answer.citations ?? []).map((c) => (c as { policyId?: string }).policyId ?? ""), (answer as { conversationId?: string }).conversationId ?? ""].filter(Boolean).map((x) => x.toLowerCase()));
  return [...new Set((answer.libraryNames ?? []).filter((n): n is string => typeof n === "string"))]
    .map((n) => n.trim())
    .filter((n) => n.length >= 3 && n.length <= 160 && /[A-Za-z]/.test(n) && !/[\\/]/.test(n) && !KEYLIKE.test(n) && !BARE_ID.test(n) && ![...ids].some((id) => n.toLowerCase().includes(id)))
    .sort((a, b) => b.length - a.length);
}

/** Guards an answer in place and returns it. */
export function guardChatAnswer(answer: ChatAnswer): ChatAnswer {
  if (!answer || typeof answer !== "object") return answer;
  const visible = (a: ChatAnswer) => JSON.stringify([a.summary, a.details, a.nextSteps, (a.questions ?? []).map((q) => [q.text, q.why]), (a.claimItems ?? []).map((i) => [i.reason, i.conditions]),
    (a as { bottomLine?: unknown }).bottomLine ?? null, ((a as { statements?: { text: string; basis?: unknown; conditions?: unknown }[] }).statements ?? []).map((x) => [x.text, x.basis, x.conditions])]);
  const before = visible(answer);
  guardInPlace(answer);
  const after = visible(answer);
  if (before !== after) { guardInterventions.push({ before, after }); if (guardInterventions.length > 50) guardInterventions.shift(); console.warn("[chat] output guard changed an answer"); }
  return answer;
}
function guardInPlace(answer: ChatAnswer) {
  const seen = new Set<string>();
  const names = protectableNames(answer);
  // A sentence said once is enough: the summary first, then each detail.
  const once = (text: string | null) => {
    if (!text) return text;
    const parts = sentencesOf(text).filter((s) => {
      const key = s.trim().toLowerCase();
      if (key.length < 25) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return parts.join(" ").trim() || null;
  };
  const summary = once(guardText(answer.summary ?? "", names));
  answer.summary = summary && summary.trim() ? summary : (answer.questions?.length ? "I need one more detail first." : GUARD_FALLBACK_SUMMARY);
  answer.details = (answer.details ?? []).map((d) => once(guardText(d, names))).filter((d): d is string => !!d);
  // The simple chat's cards draw the bottom line from its own field: it is guarded like the summary, and stands in for it
  // when the guard leaves nothing, so a name the guard took out is never shown beside the fallback (TE P121-2).
  const held = answer as ChatAnswer & { bottomLine?: string | null };
  if (typeof held.bottomLine === "string") held.bottomLine = summary && summary.trim() ? guardText(held.bottomLine, names) || answer.summary : answer.summary;
  // The cards' own words: a point's conditions and basis, and the text of a point with no amount, are guarded too (Critic
  // R194). A point the guard leaves with no words is dropped. An amount's text is the server's own label, which the label
  // checks already matched, so it is left as it is.
  const cards = answer as ChatAnswer & { statements?: { text: string; fullText?: string; amount?: unknown; basis?: string | null; conditions?: string[] }[] };
  if (Array.isArray(cards.statements)) cards.statements = cards.statements.flatMap((st) => {
    // An amount never loses a qualifier: its condition or basis is scrubbed rather than dropped (Critic R195-1).
    const words = (c: string) => (st.amount ? guardText(c, names) || scrub(c) : guardText(c, names));
    const conditions = (st.conditions ?? []).map(words).filter((c): c is string => !!c && !!c.trim());
    const basis = typeof st.basis === "string" ? words(st.basis) || null : st.basis;
    if (st.amount) return [{ ...st, conditions, basis }];
    const text = guardText(st.text, names);
    if (!text || !text.trim()) return [];
    return [{ ...st, text, fullText: typeof st.fullText === "string" ? guardText(st.fullText, names) || text : st.fullText, conditions, basis }];
  });
  // A next step may name the household's own file too ("Open output_2026.pdf on the Documents page", TE P121-1).
  answer.nextSteps = (answer.nextSteps ?? []).map((d) => guardText(d, names)).filter((d): d is string => !!d);
  for (const q of answer.questions ?? []) {
    q.text = guardText(q.text) ?? scrub(q.text);
    if (q.why) q.why = guardText(q.why) ?? "";
  }
  answer.claimItems = (answer.claimItems ?? []).map((item) => ({ ...item,
    reason: guardText(item.reason) ?? "Listed in the policy.",
    conditions: [...new Set((item.conditions ?? []).map((c) => guardText(c)).filter((c): c is string => !!c))] }));
}

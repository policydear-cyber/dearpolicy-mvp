/**
 * Round 11 blind judge: scores one chat answer 0-2 against the battery's own
 * expectations (written from the documents) and a set of plain-reader rules
 * (rubbish, repetition, leaks, jargon, wrong person, invented figures,
 * unprinted "not covered", one question at a time, length).
 *
 *   2 = no defect; 1 = minor defects only; 0 = any major defect.
 */
import type { ChatAnswer } from "@/types";
import type { Expect } from "./battery";

export type Defect = { major: boolean; rule: string; text: string };
export type Person = { key: string; names: string[]; self?: boolean };
export type Truth = { people: Person[]; foreignNames: string[]; figures: Set<number>; policyFile: Map<string, string> };

/** What the person reads (citation excerpts are shown as quotes and judged separately). */
export function said(a: ChatAnswer): string {
  const parts: string[] = [a.summary, ...a.details, ...a.nextSteps, ...a.questions.map((q) => q.text + (q.options?.length ? " (" + q.options.join(" / ") + ")" : ""))];
  if (a.personCandidates?.length) parts.push(a.personCandidates.map((p) => p.label).join(" / "));
  for (const i of a.claimItems) parts.push(i.title, i.amountText ?? "", i.reason, ...i.conditions);
  for (const l of a.policyStatedLimits ?? []) parts.push((l.ownerName ? l.ownerName + " · " : "") + l.benefitTitle + " " + l.amountText);
  for (const p of a.potentialPayoutTotals ?? []) parts.push(p.amountText);
  parts.push(...(a.payoutQualifiers ?? []));
  return parts.filter(Boolean).join("\n").replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

const NORMALISE_OCR = (s: string) => s.replace(/(?<=[\d,])[Oo](?=[\d,.]|\b)/g, "0").replace(/(?<=\d)[lI](?=[\d,])/g, "1").replace(/(?<=S\$\s?)[lI](?=[\d,])/g, "1");
/** Every money figure a text prints (S$, $, SGD; plain numbers with thousands separators). */
export function figuresIn(text: string): number[] {
  const out: number[] = [];
  for (const m of NORMALISE_OCR(text).matchAll(/(?:S\$|SGD\s?|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g)) out.push(Number(m[1].replace(/,/g, "")));
  for (const m of NORMALISE_OCR(text).matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?![\d])/g)) out.push(Number(m[1].replace(/,/g, "")));
  return out;
}
const moneyInAnswer = (text: string) => [...text.matchAll(/(?:S\$|SGD\s?|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g)].map((m) => ({ n: Number(m[1].replace(/,/g, "")), raw: m[0] }));

const LEAK = /\b(?:undefined|NaN)\b|\bnull\b|\[object |\{\{|\}\}|DPTEST|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|\b[a-z]+_[a-z_]+\b|\\n|&[a-z]+;|\*\*/;
const JARGON = /\b(?:ledger|benefit catalog(?:ue)?|retriev\w*|chunks?|embeddings?|vectors?|indexed|indexing|extraction|deterministic|LLM|language model|composition engine|strong match|partial match|insufficient evidence|passages?|formula|fact key|trait|schema)\b/i;
/** Text no reader should ever see. */
const RUBBISH: [RegExp, string][] = [
  [/subject to the general terms of the policy/i, "boilerplate quoted as an answer"],
  [/only shown after claim evidence has been reviewed/i, "a printed figure replaced by a placeholder"],
  [/find anything about (?:back|it|that|this|them|him|her|there|now|so|then)\b/i, "a stray word taken as the subject"],
  [/\b(\w+(?: \w+){2,}) \1\b/i, "words repeated back to back"],
  [/\b([A-Z][\w-]*(?: [A-Z][\w-]*){1,4})(?:,| and) \1\b/i, "the same name listed twice"],
];
const NOT_COVERED = /\b(?:not covered|isn't covered|is not covered|aren't covered|are not covered|doesn't cover|does not cover|won't be covered|will not be covered|no cover for)\b/i;
const DECLINE = /can(?:'|no)?t|can ?not|won't|will not|unable|not able|isn't something|is not something|only (?:answer|explain|help|read|work)|outside what|not something|don't (?:give|recommend|make|provide)|do not (?:give|recommend|make|provide)/i;

export function judge(a: ChatAnswer | null, status: number, err: string, ctx: { question: string; userText: string; expect: Expect; truth: Truth }): { score: 0 | 1 | 2; defects: Defect[] } {
  const d: Defect[] = [];
  const major = (rule: string, text: string) => d.push({ major: true, rule, text: text.slice(0, 260) });
  const minor = (rule: string, text: string) => d.push({ major: false, rule, text: text.slice(0, 260) });
  if (status !== 200 || !a) { major("no answer", status + " " + err); return { score: 0, defects: d }; }
  const e = ctx.expect;
  const text = said(a);
  const flat = text.replace(/\s+/g, " ");
  // A short acknowledgement before the interview's next question is fine; on its own it says nothing.
  if (a.summary.trim().length < 15 && a.questions.length !== 1) major("empty or unhelpful", JSON.stringify(a.summary));
  // ---- rubbish
  const leak = text.match(LEAK); if (leak) major("rubbish/leak", leak[0] + " in: " + around(text, leak.index!));
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim().toLowerCase().replace(/[^a-z0-9$ ]/g, "")).filter((s) => s.split(" ").length >= 7);
  const seen = new Set<string>();
  for (const s of sentences) { if (seen.has(s)) { major("repetitive", s); break; } seen.add(s); }
  for (const [re, why] of RUBBISH) { const m = text.match(re); if (m) major("rubbish", why + ": " + around(text, m.index!)); }
  const asName = text.match(/anyone called "([^"]+)"/i);
  if (asName && asName[1] === asName[1].toLowerCase()) major("words taken for a person", asName[0]);
  const jar = text.match(JARGON); if (jar) minor("jargon", jar[0] + " in: " + around(text, jar.index!));
  if (/\b(?:I am an AI|as an AI|language model)\b/i.test(text)) minor("robotic", text.match(/as an AI|I am an AI|language model/i)![0]);
  // ---- people
  for (const n of ctx.truth.foreignNames) if (new RegExp("\\b" + n + "\\b", "i").test(text) && !new RegExp("\\b" + n + "\\b", "i").test(ctx.userText)) major("other household leaked", n);
  for (const k of e.person ?? []) {
    const p = ctx.truth.people.find((x) => x.key === k)!;
    const named = p.names.some((n) => new RegExp("\\b" + n + "\\b", "i").test(text)) || (p.self && /\byou(?:r)?\b/i.test(text));
    if (!named) major("wrong or missing person", "expected " + p.names[0] + " in: " + a.summary.slice(0, 200));
  }
  for (const k of e.notPerson ?? []) {
    const p = ctx.truth.people.find((x) => x.key === k)!;
    const hit = p.names.find((n) => new RegExp("\\b" + n + "\\b", "i").test(text));
    if (hit) major("wrong person", hit + " in: " + around(text, text.indexOf(hit)));
  }
  // ---- figures: only what the documents print, the user said, or the turn allows
  const allowed = new Set([...ctx.truth.figures, ...figuresIn(ctx.userText), ...(e.figures ?? [])]);
  for (const m of moneyInAnswer(text)) if (!allowed.has(m.n) && m.n !== 0) major("invented figure", m.raw + " in: " + around(text, text.indexOf(m.raw)));
  // ---- "not covered" only where a document prints it
  // Quoted document text is the document speaking ("the schedule prints \"Not covered\""), not the app.
  const unquoted = text.replace(/"[^"\n]*"/g, " ");
  if (!e.notCoveredOk) { const m = unquoted.match(NOT_COVERED); if (m) major("says not covered (not printed)", around(unquoted, m.index!)); }
  // ---- one question at a time
  if (a.questions.length > 1) major("several questions at once", a.questions.map((q) => q.text).join(" | "));
  // ---- length
  const words = flat.split(" ").length, sw = a.summary.split(/\s+/).length;
  if (sw > 90) minor("summary too long", sw + " words");
  // Round 12: the concise-answer rule. A question about one thing is answered in at most 180 words (the direct
  // answer first, the rest a question away); an overview, a comparison or a several-part question in at most 250.
  // Only an explicit request for every line is exempt. A claim assessment (its cards are the answer) keeps the old bound.
  const ceiling = wordCeiling(ctx.question, a);
  if (ceiling != null && words > ceiling) major("answer too long", words + " words (ceiling " + ceiling + ")");
  else if (words > 380) minor("answer too long", words + " words");
  // ---- Round 12: never "could not find" what the same answer shows
  for (const m of text.matchAll(/\bI could not find ([^.\n]+?) in the documents read\b/g)) {
    const words12 = m[1].split(/\s+or\s+|,\s*/).flatMap((x) => x.replace(/^(?:an?|the|any) /i, "").split(/\s+/)).filter((w) => w.length >= 6 && !/^(?:cover|value|details?|insurance|policy|benefits?)$/i.test(w));
    const others = text.split("\n").filter((l) => !l.includes(m[0]));
    const shown = words12.find((w) => others.some((l) => new RegExp("\\b" + w.slice(0, 7), "i").test(l)));
    if (shown) major("says not found for what it shows", "\"" + m[0] + "\" while a line shows " + shown);
  }
  // ---- expectations
  // A claim interview may ask its one question first instead of answering; a question asking what was already said is not that.
  const asked = a.questions.length === 1 && e.askOk;
  if (asked && e.notAsk && e.notAsk.test(a.questions[0].text)) major("asks what was already said", a.questions[0].text);
  if (!asked) for (const re of e.must ?? []) if (!re.test(text)) major("incorrect or incomplete", "missing " + re + " in: " + a.summary.slice(0, 220));
  if (!asked && e.any?.length && !e.any.some((re) => re.test(text))) major("incorrect or incomplete", "none of " + e.any.join(" ") + " in: " + a.summary.slice(0, 220));
  for (const re of e.not ?? []) { const m = text.match(re); if (m) major("says what it must not", m[0] + " in: " + around(text, m.index!)); }
  if (e.decline) {
    if (!DECLINE.test(text)) major("did not decline", a.summary.slice(0, 220));
    if (moneyInAnswer(text).length) minor("decline carries figures", moneyInAnswer(text).map((m) => m.raw).join(", "));
  }
  if (e.cite?.length && !asked) {
    const ok = a.citations.some((c) => e.cite!.some((w) => (w.doc.test(c.policyName) || w.doc.test(ctx.truth.policyFile.get(c.policyId) ?? "")) && c.pageStart != null && c.pageStart <= w.page && (c.pageEnd ?? c.pageStart) >= w.page));
    if (!ok) (e.strictCite ? major : minor)("missing citation", "wanted " + e.cite.map((w) => w.doc.source + " p" + w.page).join(" or ") + "; got " + a.citations.map((c) => c.policyName + " p" + c.pageStart).join(", "));
  }
  return { score: d.some((x) => x.major) ? 0 : d.length ? 1 : 2, defects: d };
}

/** Round 12: the most words a reader should have to read for this question (null: no ceiling). */
export const ASKS_EVERYTHING = /\b(?:full list|full details|(?:all|every one) of (?:it|them|the lines)|all (?:the )?(?:lines|benefits|details|rows)|every (?:benefit|line|row)|everything|whole (?:list|table|schedule)|benefits? (?:table|schedule|list)|schedule of benefits|table of benefits|list (?:all|every|the benefits))\b|^\s*(?:show|give|list|tell)(?: me| us)?(?: the)? (?:rest|full list|all)\b/i;
const BROAD_QUESTION = /\b(?:compare|comparison|versus|vs\.?|overview|summary|summari[sz]e|everyone|each of|both|family|household|all (?:our|my|of)|every\b|list)\b|\?.+\?|\band (?:how|what|when|which|is|are|does|do|can|will)\b|\bwhat (?:do|does) [^?]{1,40} (?:have|cover)\b|\bwhat (?:am i|is \w+) (?:insured|covered)\b|\btell me about\b/i;
export function wordCeiling(question: string, a: Pick<ChatAnswer, "mode" | "claimItems">): number | null {
  if (a.mode === "claim_assessment" || a.mode === "fact_finding" || a.claimItems.length) return null;
  if (ASKS_EVERYTHING.test(question)) return null;
  return BROAD_QUESTION.test(question) ? 250 : 180;
}

function around(text: string, i: number) { return text.slice(Math.max(0, i - 80), i + 140).replace(/\s+/g, " "); }

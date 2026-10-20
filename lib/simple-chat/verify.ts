/** The server's checks on the simple chat's answer, before anything is shown. Pure: it reads only the household's
 * library (lib/simple-chat/library.ts) and the model's JSON (lib/simple-chat/prompt.ts).
 *
 * 1. Sources come from the stored pages, never from the model's own page numbers: each quote is found in the stored
 *    page text, and the document and page shown are where it was found (Evidence Reviewer, 20 Oct 2026: the baseline
 *    cited the wrist row as page 12 when it is on page 13).
 * 2. Amounts appear only on cards the server builds: a currency-signed figure printed in the quote, or a percentage the
 *    quote prints of the sum its own table heading prints on that page (worked out here, shown as an illustration). A
 *    percentage of the sum insured is never multiplied. A quote that cannot be found drops its amount or fact.
 * 3. The model's own sentences carry no money at all (Critic round 39): any sentence of the bottom line, a card's text, a
 *    condition, a next step or the question that states money is left out. So nothing it writes can add amounts together
 *    or give a range (release-set C2), however it is worded.
 * 4. Alternatives are drawn as either/or only when they come from one document for one person; amounts from different
 *    documents are always separate cards. */
import type { ChatAnswer, ChatCitation, ChatQuestion } from "@/types";
import type { AnswerStatement, StructuredAnswer } from "@/components/answer-cards";
import { moneyFiguresIn, sentencesOf } from "@/lib/chat/answer-verification";
import { documentId, type Household, type HouseholdDocument } from "./library";
import type { ModelAnswer, ModelStatement } from "./prompt";

export const LEFT_OUT_AMOUNT = "I left out an amount I couldn’t find printed in your documents.";
export const LEFT_OUT_FACT = "I left out a point I couldn’t find in your documents.";
export const NO_ANSWER = "I couldn’t put together an answer from your documents. Please ask again, or ask about one benefit at a time.";
export const ALTERNATIVES_NOTE = "These are alternatives under one benefit in the same document, not a total.";
export const DISCLAIMER = "Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.";

// ------------------------------------------------------------------ finding a quote in the stored pages
/** Text for matching: case, spacing, quote marks and dashes do not count. `at[i]` is where character i came from. */
function squash(s: string): { text: string; at: number[] } {
  let text = ""; const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (/\s/.test(c)) continue;
    if (/[“”„"]/.test(c)) c = "\"";
    else if (/[‘’‚`´]/.test(c)) c = "'";
    else if (/[‐‑‒–—―−]/.test(c)) c = "-";
    text += c.toLowerCase(); at.push(i);
  }
  return { text, at };
}
const fragmentsOf = (quote: string) => quote.split(/\s*(?:\.{3}|…)\s*/).map((f) => squash(f).text).filter((f) => f.length >= 4);

/** Where a quote was found: the document, the stored page, the stored words, and where on the page they start. */
export type Found = { docIndex: number; page: number; excerpt: string; offset: number };

/** Where the quote is printed: every fragment on one page, in order. The model's document is tried first, then the rest. */
export function locateQuote(household: Household, quote: string, preferred: number | null): Found | null {
  // The library is sent with < and > escaped (library.ts); a quote copied from it is read back unescaped.
  const frags = fragmentsOf(quote.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  if (!frags.length) return null;
  const order = household.documents.map((_, i) => i);
  if (preferred != null && preferred >= 0 && preferred < order.length) order.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : a - b));
  for (const di of order) {
    for (const page of household.documents[di].pages) {
      const sq = squash(page.text);
      let from = 0, start = -1, end = -1, ok = true;
      for (const f of frags) {
        const i = sq.text.indexOf(f, from);
        if (i < 0) { ok = false; break; }
        if (start < 0) start = i;
        end = i + f.length; from = end;
      }
      if (!ok) continue;
      const excerpt = page.text.slice(sq.at[start], sq.at[end - 1] + 1).replace(/[ \t]+/g, " ").trim();
      return { docIndex: di, page: page.page, excerpt: excerpt.length > 700 ? excerpt.slice(0, 700) + "…" : excerpt, offset: sq.at[start] };
    }
  }
  return null;
}

// ------------------------------------------------------------------ amounts
const CENT = (n: number) => Math.round(n * 100);
const sameValue = (a: number, b: number) => CENT(a) === CENT(b);
/** Every number printed in a text (money or not), as values. */
const numbersIn = (text: string) => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter(Number.isFinite);

type Currency = { sign: string; resolved: boolean };
const SIGN: Record<string, string> = { SGD: "S$", USD: "US$", MYR: "RM", HKD: "HK$", AUD: "A$", EUR: "€", GBP: "£", JPY: "¥", "$": "$" };
/** The currency of an amount, resolved only when the words it rests on print that currency (a bare "$" never is). */
function currencyOf(amountText: string, evidence: string): Currency {
  const f = moneyFiguresIn(amountText)[0];
  const printed = moneyFiguresIn(evidence).map((x) => x.currency);
  const named = /\bSGD\b|S\$|Singapore dollars?/i.test(evidence) ? "SGD" : null;
  if (f && f.currency !== "$") return { sign: SIGN[f.currency] ?? f.currency, resolved: printed.includes(f.currency) || named === f.currency };
  if (printed.includes("SGD") || (named && !printed.some((c) => c !== "$" && c !== "SGD"))) return { sign: "S$", resolved: true };
  return { sign: "$", resolved: false };
}
const formatMoney = (sign: string, value: number) => sign + value.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });

type Checked = { s: ModelStatement; found: Found | null; amount: { value: number; text: string; currencyResolved: boolean; illustration: boolean } | null; person: string | null; note: string | null };

const valueOf = (raw: string) => Number(raw.replace(/^[^\d]+/, "").replace(/,/g, ""));

/** The sum a percentage on this page is a percentage of: the nearest "% of S$5,000" or "Limit: S$5,000" printed above
 * (or in) the quoted row on the same page; "sum_insured" when the nearest heading is "% of Sum Insured". */
function rowBase(pageText: string, end: number): { value: number; raw: string } | "sum_insured" | null {
  const above = pageText.slice(0, end);
  let best: { at: number; value: number; raw: string } | null = null;
  for (const re of [/%\s*of\s*((?:S\$|SGD|US\$|\$)\s?\d[\d,]*(?:\.\d+)?)/gi, /\blimit\s*:?\s*((?:S\$|SGD|US\$|\$)\s?\d[\d,]*(?:\.\d+)?)/gi])
    for (const m of above.matchAll(re)) if (!best || (m.index ?? 0) > best.at) best = { at: m.index ?? 0, value: valueOf(m[1]), raw: m[1] };
  const si = [...above.matchAll(/%\s*of\s*(?:the\s*)?sum\s*(?:insured|assured)/gi)].at(-1);
  if (si && (!best || (si.index ?? 0) > best.at)) return "sum_insured";
  return best ? { value: best.value, raw: best.raw } : null;
}

type AmountCheck = { ok: true; amount: NonNullable<Checked["amount"]> } | { ok: false; why: string; asFact?: boolean };
/** The amount a statement may show, or why it may not. An amount is a currency-signed figure printed in the quote, or a
 * percentage the quote prints of the sum its own table heading prints on the same page. A percentage of the sum insured is
 * never multiplied: the documents do not tie a benefit row to one of a person's sums insured, so the percentage is shown as
 * a fact and the sum insured as its own printed amount. */
function checkAmount(st: ModelStatement, found: Found, household: Household): AmountCheck {
  const doc = household.documents[found.docIndex];
  if (st.percentOf && st.percentOf.percent > 0) {
    const pct = st.percentOf.percent;
    if (!new RegExp(`(?<![\\d.])${String(pct).replace(".", "\\.")}\\s?(?:%|per\\s?cent)`, "i").test(found.excerpt)) return { ok: false, why: "the percentage is not in the quoted words" };
    const page = doc.pages.find((p) => p.page === found.page)!;
    const printed = rowBase(page.text, found.offset + found.excerpt.replace(/…$/, "").length);
    if (printed === "sum_insured") return { ok: false, why: "a percentage of the sum insured is shown, not worked out", asFact: true };
    const base = moneyFiguresIn(st.percentOf.baseAmount)[0]?.value ?? numbersIn(st.percentOf.baseAmount)[0];
    if (!printed || base == null || !sameValue(printed.value, base)) return { ok: false, why: "the sum is not the one this row's table is a percentage of" };
    const cur = currencyOf(printed.raw, page.text);
    const value = Math.round(base * pct) / 100;
    return { ok: true, amount: { value, text: formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: true } };
  }
  const raw = (st.amount ?? "").trim();
  const figures = moneyFiguresIn(raw);
  const plain = numbersIn(raw);
  // One figure per amount: "S$1,250 to S$2,000" is a range, never an amount.
  if (figures.length > 1 || plain.length > 1) return { ok: false, why: "an amount must be one figure" };
  const value = figures[0]?.value ?? plain[0];
  if (value == null) return { ok: false, why: "no amount given" };
  // Only a figure printed with its currency sign counts: a percentage, a count, a plan number or a code never does.
  if (!moneyFiguresIn(found.excerpt).some((f) => sameValue(f.value, value))) return { ok: false, why: "the amount is not printed with its currency in the quoted words" };
  const cur = currencyOf(raw, found.excerpt);
  return { ok: true, amount: { value, text: formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: false } };
}

// ------------------------------------------------------------------ people
const tokens = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, (m) => " " + m.slice(1, -1) + " ").split(/[^\p{L}]+/u).filter((t) => t.length > 1);
const baseName = (member: string) => member.replace(/\s*\([^)]*\)\s*$/, "").trim();
/** The household member a name means (all its words in the member's name), or null when none or several fit. */
export function matchMember(household: Household, person: string | null): string | null {
  if (!person?.trim()) return null;
  const want = tokens(person);
  if (!want.length) return null;
  const hits = household.members.filter((m) => { const have = new Set(tokens(m.name)); return want.every((w) => have.has(w)); });
  return hits.length === 1 ? baseName(hits[0].name) : null;
}

// ------------------------------------------------------------------ the written answer carries no money
/** Whether a sentence states money: a figure with a currency, a number with "dollars", or a number with thousands
 * separators. Amounts are shown only on the server's cards, so no sentence the model wrote may carry one -- which is
 * what keeps it from adding amounts or giving a range, whatever words it uses. */
export function statesMoney(sentence: string): boolean {
  return moneyFiguresIn(sentence).length > 0 || /\d[\d,]*(?:\.\d+)?\s*(?:dollars?|cents?|SGD|USD)\b/i.test(sentence) || /(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)/.test(sentence);
}
function withoutMoney(text: string, dropped: string[]): string {
  return sentencesOf(text ?? "").filter((s) => { const money = statesMoney(s); if (money) dropped.push(s); return !money; }).join(" ").trim();
}

/** Whether every excerpt sits on the same line of the same page. */
function oneRow(household: Household, found: Found[]): boolean {
  const f0 = found[0];
  if (found.some((f) => f.docIndex !== f0.docIndex || f.page !== f0.page)) return false;
  const page = household.documents[f0.docIndex].pages.find((p) => p.page === f0.page);
  const parts = found.map((f) => squash(f.excerpt.replace(/…$/, "")).text);
  return !!page && page.text.split("\n").some((line) => { const l = squash(line).text; return parts.every((x) => l.includes(x)); });
}

// ------------------------------------------------------------------ the answer
export type VerifyReport = { dropped: { kind: string; why: string; text: string }[]; sentencesLeftOut: string[] };

const asStrings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
/** The model's JSON as a ModelAnswer, or null when it is not one. */
export function readModelAnswer(json: unknown): ModelAnswer | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.bottomLine !== "string" || !Array.isArray(o.statements)) return null;
  const kinds = new Set(["amount", "fact", "not_found", "uncertainty"]);
  const statements = (o.statements as Record<string, unknown>[]).filter((s) => s && typeof s === "object" && kinds.has(String(s.kind)) && typeof s.text === "string").map((s) => ({
    kind: s.kind as ModelStatement["kind"], text: String(s.text),
    person: typeof s.person === "string" ? s.person : null, document: typeof s.document === "string" ? s.document : null,
    quote: typeof s.quote === "string" ? s.quote : null, amount: typeof s.amount === "string" ? s.amount : null,
    percentOf: s.percentOf && typeof s.percentOf === "object" && typeof (s.percentOf as { percent?: unknown }).percent === "number" && typeof (s.percentOf as { baseAmount?: unknown }).baseAmount === "string" ? s.percentOf as ModelStatement["percentOf"] : null,
    conditions: asStrings(s.conditions), alternativeGroup: typeof s.alternativeGroup === "string" && s.alternativeGroup.trim() ? s.alternativeGroup.trim() : null,
  }));
  return { bottomLine: o.bottomLine, statements, nextSteps: asStrings(o.nextSteps).slice(0, 3), question: typeof o.question === "string" && o.question.trim() ? o.question.trim() : null };
}

/** A document as the household knows it: its product name, with the file name when two documents share one. */
function docLabel(household: Household, d: HouseholdDocument): string {
  const product = d.productName?.trim();
  if (!product) return d.name;
  const shared = household.documents.some((o) => o !== d && o.productName?.trim().toLowerCase() === product.toLowerCase());
  return shared ? `${product} (${d.name.replace(/\.[a-z0-9]+$/i, "")})` : product;
}

export function verifyAnswer(household: Household, model: ModelAnswer): { answer: StructuredAnswer; report: VerifyReport } {
  const report: VerifyReport = { dropped: [], sentencesLeftOut: [] };
  const checked: Checked[] = [];
  for (const st of model.statements) {
    const preferred = st.document ? Number(/^D(\d+)$/i.exec(st.document.trim())?.[1] ?? NaN) - 1 : null;
    const found = st.quote ? locateQuote(household, st.quote, Number.isFinite(preferred) ? preferred : null) : null;
    const person = matchMember(household, st.person);
    if (st.kind === "amount") {
      if (!found) { report.dropped.push({ kind: st.kind, why: "quote not found in the stored pages", text: st.text }); continue; }
      const r = checkAmount(st, found, household);
      if (!r.ok) {
        if (!r.asFact) report.dropped.push({ kind: st.kind, why: r.why, text: st.text });
        // A percentage that is not worked out is kept as the printed percentage, without an amount.
        if (st.percentOf) checked.push({ s: { ...st, kind: "fact", amount: null, percentOf: null, alternativeGroup: null }, found, amount: null, person, note: null });
        continue;
      }
      checked.push({ s: st, found, amount: r.amount, person, note: null });
    } else if (st.kind === "fact") {
      if (!found) { report.dropped.push({ kind: st.kind, why: "quote not found in the stored pages", text: st.text }); continue; }
      checked.push({ s: st, found, amount: null, person, note: null });
    } else {
      checked.push({ s: st, found, amount: null, person, note: null });
    }
  }
  // What a source says about the person it is used for: not linked to them, or replaced by a later version.
  for (const c of checked) {
    if (!c.found) continue;
    const doc = household.documents[c.found.docIndex];
    const notes: string[] = [];
    if (c.person && doc.linkedPeople.length && !doc.linkedPeople.some((p) => baseName(p) === c.person)) notes.push(`This document is not linked to ${c.person} in your library.`);
    if (doc.supersededAt) notes.push(`This document was replaced by a later version on ${doc.supersededAt.slice(0, 10)}.`);
    c.note = notes.join(" ") || null;
  }
  // Either/or is drawn only for one person's amounts printed on one line (one row) of one page: alternatives the model
  // groups across rows or documents (ambulance cost and the recuperation benefit are separate benefits) are separate
  // cards, with a note that they are not a total.
  const groups = new Map<string, Checked[]>();
  for (const c of checked) if (c.amount && c.s.alternativeGroup) groups.set(c.s.alternativeGroup, [...(groups.get(c.s.alternativeGroup) ?? []), c]);
  const groupOf = new Map<Checked, string>();
  const notTotals: Checked[][] = [];
  let g = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    if (oneRow(household, members.map((m) => m.found!)) && new Set(members.map((m) => m.person ?? "")).size === 1) {
      const id = `g${++g}`;
      for (const m of members) groupOf.set(m, id);
    } else notTotals.push(members);
  }
  const citations: ChatCitation[] = [];
  const statements: AnswerStatement[] = [];
  checked.forEach((c, i) => {
    const doc = c.found ? household.documents[c.found.docIndex] : null;
    let text = withoutMoney(c.s.text, report.sentencesLeftOut);
    if (!text && doc && c.found) text = c.amount ? `As printed in ${docLabel(household, doc)}, page ${c.found.page}.` : `${docLabel(household, doc)} prints: “${c.found.excerpt}”`;
    if (!text) return;
    const conditions = c.s.conditions.map((x) => withoutMoney(x, report.sentencesLeftOut)).filter(Boolean);
    let source: AnswerStatement["source"] = null;
    if (c.found && doc) {
      const chunkId = `simple-${doc.policyId}-p${c.found.page}-${i + 1}`;
      citations.push({ chunkId, policyId: doc.policyId, policyName: docLabel(household, doc), insurer: doc.insurer ?? undefined, pageStart: c.found.page, pageEnd: c.found.page, documentRole: doc.documentRole ?? undefined, excerpt: c.found.excerpt, documentDate: doc.effectiveDate ?? undefined } as ChatCitation);
      source = { policyName: docLabel(household, doc), page: c.found.page, note: c.note, citationIds: [chunkId] };
    }
    const kind: AnswerStatement["kind"] = c.amount ? (c.amount.illustration ? "calculation" : "benefit_terms") : c.s.kind === "fact" || c.s.kind === "amount" ? "fact" : c.s.kind;
    const gid = groupOf.get(c);
    statements.push({
      id: `s${i + 1}`, kind, text, fullText: text, personName: c.person, amount: c.amount ? { text: c.amount.text, currencyResolved: c.amount.currencyResolved, illustration: c.amount.illustration } : null,
      basis: c.amount?.illustration && c.s.percentOf ? `${c.s.percentOf.percent}% of ${c.s.percentOf.baseAmount}, worked out from the document's terms` : null,
      conditions, asOf: null, source, group: gid ? { id: gid, kind: "either_or", note: ALTERNATIVES_NOTE } : null,
    });
  });
  for (const members of notTotals) {
    const who = members[0].person;
    const shown = members.filter((m) => statements.some((s) => s.amount?.text === m.amount!.text && s.personName === m.person));
    if (shown.length < 2) continue;
    const text = `${shown.map((m) => m.amount!.text).join(", ").replace(/, ([^,]*)$/, " and $1")}${who ? ` for ${who}` : ""} come from different parts of your documents. They are not a total; the insurer decides which applies.`;
    statements.push({ id: `not-total-${statements.length + 1}`, kind: "uncertainty", text, fullText: text, conditions: [] });
  }
  if (report.dropped.some((d) => d.kind === "amount")) statements.push({ id: "left-out-amount", kind: "uncertainty", text: LEFT_OUT_AMOUNT, fullText: LEFT_OUT_AMOUNT, conditions: [] });
  else if (report.dropped.length) statements.push({ id: "left-out-fact", kind: "uncertainty", text: LEFT_OUT_FACT, fullText: LEFT_OUT_FACT, conditions: [] });
  let bottomLine = withoutMoney(model.bottomLine, report.sentencesLeftOut);
  const nextSteps = model.nextSteps.map((x) => withoutMoney(x, report.sentencesLeftOut)).filter(Boolean);
  const question = model.question ? withoutMoney(model.question, report.sentencesLeftOut) : "";
  const shownAmounts = statements.filter((s) => s.amount).length;
  if (!bottomLine) bottomLine = shownAmounts > 1 ? "Here is what your documents print. Each amount below is separate; they are not added together." : statements.length ? "Here is what your documents say." : NO_ANSWER;
  const questions: ChatQuestion[] = question ? [{ id: "simple_question", text: question, type: "text", why: "This helps me answer from the right part of your documents." }] : [];
  const answer: StructuredAnswer = {
    mode: "answer", summary: bottomLine, details: [], claimItems: [], nextSteps, confidence: citations.length ? "partial_match" : "insufficient_evidence",
    citations, disclaimer: DISCLAIMER, claimSessionId: null, questions, knownFacts: [], missingFacts: [],
    bottomLine, statements,
    // The prose carries no figures; the live monetary boundary (lib/chat/monetary-boundary.ts) holds it to that on save and reopen.
    verifiedPolicyFactsOnly: true, verifiedPolicyFigures: [],
  };
  return { answer, report };
}

/** The text a later turn shows the model for this answer. */
export function answerAsText(answer: Pick<ChatAnswer, "summary" | "nextSteps" | "questions"> & { statements?: AnswerStatement[]; bottomLine?: string | null }): string {
  const lines = [answer.bottomLine || answer.summary, ...(answer.statements ?? []).map((s) => `- ${s.personName ? s.personName + ": " : ""}${s.amount ? s.amount.text + " — " : ""}${s.text}${s.source ? ` (${s.source.policyName}, page ${s.source.page})` : ""}`), ...answer.nextSteps.map((n) => `Next: ${n}`), ...answer.questions.map((q) => q.text)];
  return lines.filter(Boolean).join("\n");
}
export { documentId };

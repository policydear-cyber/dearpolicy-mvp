/**
 * Round 16 / Gate R17: the last verification every chat answer passes before it is saved and shown (called
 * from lib/chat/workflow.ts saveTurn, after the monetary boundary, for EVERY answer path).
 *
 * Every money figure the household would read must be backed by the household's own documents, and the
 * backing must be the sentence's OWN:
 *
 *  1. Scope binding. Each figure of each sentence is grounded only by a binding attached to that sentence
 *     (ChatAnswer.figureBindings): the policy, the person the sentence is about, the benefit (row / label),
 *     the document version (file hash), the page range and the verbatim passage. The figure must be printed
 *     beside its currency in that passage, which must be on those pages of that version (a superseded
 *     version only where the sentence says it is superseded), on the row of the benefit the sentence names,
 *     and -- where the row prints one column per person or tier -- in that person's / tier's column. The
 *     document must be this household's, active and released, and speak for that person. Another sentence's
 *     citation, or "a cited document" printing the figure somewhere, grounds nothing.
 *  2. Computed figures (totals, monthly restatements, multiples, differences) stand only with an explicit
 *     computation record (ChatAnswer.computations) the gate recomputes: every operand grounded under (1),
 *     one currency, one unit / period (unless the operation is an explicit per-period conversion with its
 *     factor), the stated rounding applied, and the sentence's figure equal to the result. "Total", "about"
 *     or "altogether" prove nothing.
 *  3. A figure from the household's own message appears only with explicit attribution in the same sentence
 *     ("you mentioned a bill of S$5,000"), exactly as they wrote it (value and currency -- the answer may not
 *     add a currency they did not give, and a bare "$" names none), and never in a sentence that states
 *     cover, a limit, a payable amount, a premium, an estimate or a total.
 *
 * A sentence with a figure that is none of these is removed (never softened) and the answer says that a
 * figure was left out. A policy-stated limit card stands only with its own binding. A sentence that states
 * cover where the cited page says the opposite ("not covered", "excluded") is removed the same way.
 *
 * DP_GATE_DEBUG=1 writes every rejection (and the bindings it was tried with) to stderr.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import type { BoundFigure, CalculationRecord, CalcOperand, ChatAnswer, ComputationOperand, ComputationRecord, FigureBinding, FigurePeriod } from "@/types";
import { recomputeCalculation } from "@/lib/claims/calc-record";
import { dayEdgeExceptionsFromWording, dayRuleFromWording, distinctDayEdges } from "@/lib/claims/day-count";
import { amountAppears, amountPrintedWith, benefitRowProblem, benefitWords, namesBenefit, negated, normalPassage, passageRows, printedPeriodsOf, rowCells } from "./assertions";
import { currenciesStatedIn } from "@/lib/claims/currency-evidence";
import { cleanScannedLine, looksScanned } from "./scanned-text";
import { checkUnitTerms } from "@/lib/claims/unit-terms";
import { reconstructCellRoster } from "@/lib/claims/roster-layout";
import { loadDocMeta } from "@/lib/lifecycle/amendment-metadata";
import { CATEGORY_HEADER, isRowCode, rowLabelOf, amendmentRemovalsFor, isAmendmentRole, STATES_REMOVAL_LIMITATION, SAYS_NOT_AMENDED, type AmendmentRemoval, type DocMeta, columnApplicability, columnDimensions, columnFitProblem, datesIn, personApplicability, versionInForce, versionPairOf, type ColumnDimensions } from "@/lib/claims/person";

const cleanScannedText = (t: string) => t.split(/\n/).map((l) => (looksScanned(l) ? cleanScannedLine(l) ?? "" : "")).filter(Boolean).join("\n");
const gateDebug = () => !!(process.env.DP_GATE_DEBUG || (globalThis as { __dpVerifyDebug?: boolean }).__dpVerifyDebug);

export const FIGURE_LEFT_OUT_NOTE = "I’ve left out an amount I couldn’t match to your documents.";
export const CLAIM_LEFT_OUT_NOTE = "I’ve left out a statement your documents don’t support.";

const FIGURE = /(?:\b(SGD|USD|MYR|HKD|AUD|EUR|GBP|JPY|PHP|CNY|IDR|THB|INR|KRW|NZD|CHF)\s?|\b(S|SG|US|HK|A|AU|NZ)\$\s?|(RM)\s?|([€£¥₱])\s?)(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|mil|million|thousand|bn|billion)\b)?|(\d[\d,]*(?:\.\d+)?)\s?(SGD|USD|MYR|HKD|AUD|EUR|GBP)\b/g;
const SYMBOL: Record<string, string> = { S: "SGD", SG: "SGD", US: "USD", HK: "HKD", A: "AUD", AU: "AUD", NZ: "NZD", RM: "MYR", "€": "EUR", "£": "GBP", "¥": "JPY", "₱": "PHP" };
const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mil: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
export type StatedFigure = { raw: string; value: number; currency: string };
/** Every money figure a text states, with its currency. */
export function figuresIn(text: string): StatedFigure[] {
  const out: StatedFigure[] = [];
  for (const m of (text ?? "").matchAll(FIGURE)) {
    const currency = m[1] ?? (m[2] ? SYMBOL[m[2]] : m[3] ? SYMBOL[m[3]] : m[4] ? SYMBOL[m[4]] : m[8]);
    const digits = (m[5] ?? m[7] ?? "").replace(/,/g, "");
    const value = Number(digits) * (m[6] ? MULT[m[6].toLowerCase()] ?? 1 : 1);
    if (currency && Number.isFinite(value)) out.push({ raw: m[0], value, currency: currency.toUpperCase() });
  }
  return out;
}
/** A bare "$" figure names no currency ("$5,000"): its currency is "$" (never SGD). */
const BARE_DOLLAR = /(?<![A-Za-z$])\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|mil|million|thousand|bn|billion)\b)?/g;
/** Every money figure of `text`, including bare "$" figures (currency "$"). */
export function moneyFiguresIn(text: string): StatedFigure[] {
  const out = figuresIn(text);
  for (const m of (text ?? "").matchAll(BARE_DOLLAR)) {
    const value = Number(m[1].replace(/,/g, "")) * (m[2] ? MULT[m[2].toLowerCase()] ?? 1 : 1);
    if (Number.isFinite(value)) out.push({ raw: m[0], value, currency: "$" });
  }
  return out;
}
const SAYS_SUPERSEDED = /\b(?:superseded|replaced|earlier|previous(?:ly)?|old(?:er)?|original(?:ly)?|former(?:ly)?|no longer)\b/i;
export const sentencesOf = (text: string) => (text ?? "").split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
const norm = (s: string) => normalPassage(s ?? "");
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const COVER_CLAIM = /^(?:(?:yes|good news)[,.!]?\s+)?(?:[\p{L}’' -]{2,60}?)\s+(?:is|are)\s+(not\s+)?covered\b/iu;
const NUMBERING = /^\d{1,2}[a-z]?[.)]?$/i;
const MONEY_FIGURE = /(?:S\$|SG\$|SGD|US\$|USD|RM|MYR|HK\$|HKD|A\$|AUD|€|£|¥|\$)?\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:S\$|SG\$|SGD|US\$|USD|RM|MYR|HK\$|HKD|A\$|AUD|€|£|¥|\$)\s?\d+(?:\.\d+)?|\d+\.\d{2}\b/g;
/** A line that prints an amount is a data row, never a table's header. */
const MONEY_CELL = /(?:S\$|SG\$|SGD|US\$|USD|RM|MYR|HK\$|HKD|A\$|AUD|€|£|¥)\s?\d/;
const RANK = { match: 0, bare: 1, other: 2, absent: 3 } as const;
const CLASS: [string, RegExp][] = [["spouse", /\b(?:spouse|wife|husband|partner)\b/i], ["child", /\b(?:child(?:ren)?|son|daughter|kids?)\b/i], ["self", /\b(?:employee|member|self|staff|policyholder|policy owner|main insured|principal)\b/i], ["parent", /\b(?:parents?|father|mother)\b/i]];
const classOf = (text: string) => CLASS.find(([, re]) => re.test(text))?.[0] ?? null;
/** The header of the table a row (at `at`, with `cells` cells) sits in: the top line of the block of table lines
 * directly above it (each with as many cells, or one fewer), when it prints no amount -- and, when `want` is given,
 * when it has that column. */
function headerFor(lines: string[], at: number, cells: number, want: string | null): string[] | null {
  let top = -1;
  for (let i = at - 1; i >= 0 && i >= at - 60; i--) { const n = rowCells(lines[i]).length; if (n >= 3 && n >= cells - 1) top = i; else break; }
  if (top < 0 || MONEY_CELL.test(lines[top])) return null;
  const head = rowCells(lines[top]);
  if (want && !head.some((h) => { const hn = norm(h); return hn === want || (hn.length >= 2 && (hn.includes(want) || want.includes(hn))); })) return null;
  return head;
}

// ---------------------------------------------------------------------------------------------------------
// Producers: attaching bindings, source hints and computation records.
// ---------------------------------------------------------------------------------------------------------

export type Provenance = { figureBindings?: BoundFigure[]; computations?: ComputationRecord[]; sourceHints?: SourceHint[] };
/** A producer's statement that the figures of `text` were read from `policyId`, pages pageStart..pageEnd (a line that
 * quotes or renders a printed row). saveTurn resolves it -- on those pages only -- into per-sentence bindings. */
export type SourceHint = { text: string; policyId: string; pageStart: number; pageEnd?: number; subjectId?: string | null; benefit?: string | null; column?: string | null };
const scope = new AsyncLocalStorage<{ figures: BoundFigure[]; computations: ComputationRecord[]; hints: SourceHint[] }>();
/** Runs a chat turn with a provenance scope: what producers bind during it reaches saveTurn (attachProvenance). */
export function withProvenanceScope<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({ figures: [], computations: [], hints: [] }, fn);
}
const hasFigure = (sentence: string, value: number, currency: string) => moneyFiguresIn(sentence).some((f) => same(f.value, value) && f.currency === currency);
/** Binds `value` in `currency` in every sentence of `text` that states it to `binding` (on `target`, and in the turn's scope). */
export function bindFigure(target: Provenance | null | undefined, text: string, value: number, currency: string, binding: FigureBinding | null | undefined): void {
  if (!binding || !text || !Number.isFinite(value) || !currency) return;
  const store = scope.getStore();
  for (const s of sentencesOf(text)) {
    if (!hasFigure(s, value, currency)) continue;
    const b: BoundFigure = { ...binding, sentence: s.trim(), value, currency };
    if (target) (target.figureBindings ??= []).push(b);
    store?.figures.push(b);
  }
}
/** Attaches `record` to every sentence of `text` that states its result. */
export function bindComputation(target: Provenance | null | undefined, text: string, record: Omit<ComputationRecord, "sentence"> | null | undefined): void {
  if (!record || !text) return;
  const store = scope.getStore();
  for (const s of sentencesOf(text)) {
    if (!hasFigure(s, record.result.value, record.result.currency)) continue;
    const r: ComputationRecord = { ...record, sentence: s.trim() } as ComputationRecord;
    if (target) (target.computations ??= []).push(r);
    store?.computations.push(r);
  }
}
/** Records that the figures of `text` were read from the given policy pages (see SourceHint). */
export function citeLine(target: Provenance | null | undefined, text: string, hint: Omit<SourceHint, "text">): void {
  if (!text || !hint?.policyId || !(hint.pageStart > 0)) return;
  const h: SourceHint = { ...hint, text };
  if (target) (target.sourceHints ??= []).push(h);
  scope.getStore()?.hints.push(h);
}
/** For lines that quote a page ("… (page 3)."): each is cited to the one cited policy page it names (see citeLine). */
export function citePageLines(target: Provenance | null | undefined, lines: string[], citations: { policyId: string; pageStart: number | null; pageEnd?: number | null }[], subjectId?: string | null): void {
  for (const line of lines) {
    if (!line || !moneyFiguresIn(line).length) continue;
    const pages = [...line.matchAll(/\(page (\d+)\b/g)].map((m) => Number(m[1]));
    for (const n of new Set(pages)) {
      const at = citations.filter((c) => c && (c.pageStart ?? 0) <= n && n <= (c.pageEnd ?? c.pageStart ?? 0));
      const ids = [...new Set(at.map((c) => c.policyId))];
      if (ids.length === 1) citeLine(target, line, { policyId: ids[0], pageStart: n, subjectId: subjectId ?? null });
    }
  }
}
/** A fact read from one passage of one page (a verified assertion: lib/chat/assertions.ts) as a producer renders it. */
export type PassageFact = { policyId: string; subjectId: string; documentHash: string | null; page: number | null; passage: string; title?: string | null; tierLabel?: string | null; tier?: string | null; presentedAsSuperseded?: boolean };
/** Binds the figures of `text` that `fact`'s passage prints to that passage (its own page, version, person and benefit
 * row), and cites `text` to the fact's page so saveTurn can also resolve the exact printed row (and its column) there.
 * The gate decides whether any of these grounds a sentence: a binding for the wrong benefit or person grounds nothing. */
export function bindPassageFact(target: Provenance | null | undefined, text: string, fact: PassageFact | null | undefined): void {
  if (!fact || !text || !fact.policyId || !(Number(fact.page) > 0)) return;
  const figures = moneyFiguresIn(text).filter((f) => f.currency !== "$");
  if (!figures.length) return;
  const page = Number(fact.page);
  if (fact.title && fact.subjectId && fact.passage) {
    const binding: FigureBinding = { policyId: fact.policyId, subjectId: fact.subjectId, benefit: fact.title, documentHash: fact.documentHash, pageStart: page, pageEnd: page, passage: fact.passage, column: fact.tierLabel ?? fact.tier ?? null, ...(fact.presentedAsSuperseded ? { presentedAsSuperseded: true } : {}) };
    for (const f of figures) if (amountAppears(f.value, fact.passage)) bindFigure(target, text, f.value, f.currency, binding);
  }
  citeLine(target, text, { policyId: fact.policyId, pageStart: page, subjectId: fact.subjectId ?? null, benefit: fact.title ?? null, column: fact.tierLabel ?? fact.tier ?? null });
  citeLine(target, text, { policyId: fact.policyId, pageStart: page, subjectId: fact.subjectId ?? null });
}
/** For an answer built from printed pages: each line with a figure is cited to the page it names ("(page N)"), or --
 * when it names none -- to each page the answer cites (at most six), so saveTurn can resolve the printed row there. */
export function citeAnswerLines(target: Provenance | null | undefined, texts: (string | null | undefined)[], citations: ({ policyId: string; pageStart: number | null; pageEnd?: number | null } | null | undefined)[], subjectId?: string | null): void {
  const cited = citations.filter((c): c is { policyId: string; pageStart: number; pageEnd?: number | null } => !!c && !!c.policyId && Number(c.pageStart) > 0);
  for (const t of texts) {
    if (!t || !moneyFiguresIn(t).length) continue;
    if (/\(page \d+\b/.test(t)) { citePageLines(target, [t], cited, subjectId); continue; }
    for (const c of cited.slice(0, 6)) citeLine(target, t, { policyId: c.policyId, pageStart: c.pageStart, pageEnd: Math.max(c.pageStart, c.pageEnd ?? c.pageStart), subjectId: subjectId ?? null });
  }
}
/** The printed line of `pageText` a rendered sentence's figure comes from: the line that prints the amount and shares the
 * most words with the sentence, with its row label and -- in a table with one column per person / tier -- its column. */
export function printedRowFor(sentence: string, value: number, pageText: string): { line: string; label: string; column: string | null } | null {
  // (An OCR line is read as repaired -- "$$3,000" is "S$3,000" -- the gate accepts the repaired line as printed.)
  const lines = pageText.split(/\n/).map((l) => l.trim()).map((l) => looksScanned(l) ? cleanScannedLine(l) ?? l : l);
  // Words, and numbers other than amounts (a year, a row number), the sentence and a line share.
  const tokens = (t: string) => [...(t.toLowerCase().match(/[a-z][a-z&'-]{2,}/g) ?? []), ...(t.replace(MONEY_FIGURE, " ").match(/(?<![\d.,])\d{1,4}(?![\d.,%])/g) ?? [])];
  const words = new Set(tokens(sentence));
  let best: { i: number; n: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || !amountAppears(value, lines[i])) continue;
    const n = tokens(lines[i]).filter((w) => words.has(w)).length;
    if (!best || n > best.n) best = { i, n };
  }
  if (!best || best.n === 0) return null;
  const line = lines[best.i], cells = rowCells(line);
  const first = cells.findIndex((c) => !NUMBERING.test(c));
  let label = cells.length >= 2 ? cells[Math.max(0, first)] : "";
  if (cells.length < 2) {
    const m = line.match(/(?:S\$|SG\$|SGD|US\$|USD|RM|MYR|HK\$|HKD|A\$|AUD|€|£|¥|\$)?\s?\d[\d,]*(?:\.\d+)?/g)?.find((x) => amountAppears(value, x));
    const at = m ? line.indexOf(m) : -1;
    label = (at > 0 ? line.slice(0, at) : line).replace(/[\s:–—·-]+$/, "").trim();
    if (label.replace(/[^A-Za-z]/g, "").length < 3) label = line.replace(m ?? "", " ").replace(/\s+/g, " ").trim();
  }
  let column: string | null = null;
  if (cells.length >= 3) {
    const head = headerFor(lines, best.i, cells.length, null);
    if (head) {
      const ks = cells.map((c, j) => j > 0 && amountAppears(value, c) ? j : -1).filter((j) => j > 0);
      const at = (k: number) => head[k - (cells.length - Math.min(head.length, cells.length))] ?? null;
      // The same amount in two columns: the column the sentence names.
      const k = ks.find((j) => { const h = (at(j) ?? "").toLowerCase(); return h.length >= 3 && sentence.toLowerCase().includes(h); }) ?? ks[0];
      column = k != null ? at(k) : null;
    }
  }
  return { line, label, column };
}
/** The benefit a printed row states: its label -- or, where the label is only generic words ("Amount due"), the row's
 * own words without its amounts ("Amount due (annual premium)"), so the row is named by what it prints. */
export function rowBenefit(r: { line: string; label: string }): string {
  if (benefitWords(r.label).size) return r.label;
  const words = r.line.replace(/(?:S\$|SG\$|SGD|US\$|USD|RM|MYR|HK\$|HKD|A\$|AUD|€|£|¥|\$)?\s?\d[\d,]*(?:\.\d+)?/g, " ").replace(/[\t|]+/g, " ").replace(/\s+/g, " ").trim();
  return benefitWords(words).size ? words : r.label;
}
/** A binding for `value` read from `pageText` (one page of one policy), or null when that page does not print it. */
export function bindingFromPage(args: { policyId: string; subjectId: string; documentHash: string | null; page: number; pageText: string | null | undefined; sentence: string; value: number; currency: string; benefit?: string | null; column?: string | null }): FigureBinding | null {
  if (!args.pageText) return null;
  const r = printedRowFor(args.sentence, args.value, args.pageText);
  if (!r) return null;
  return { policyId: args.policyId, subjectId: args.subjectId, benefit: args.benefit ?? rowBenefit(r), documentHash: args.documentHash, pageStart: args.page, pageEnd: args.page, passage: r.line, column: args.column ?? r.column };
}
/** Copies onto `answer` what the turn's producers bound for sentences it states, resolving their source hints on the
 * pages they name, and binds each policy-stated limit card to its own cited page (called by saveTurn before the gate). */
export async function attachProvenance(answer: ChatAnswer, accountId?: string, from?: Provenance | null): Promise<void> {
  const store = scope.getStore();
  const figures = [...(from?.figureBindings ?? []), ...(answer.figureBindings ?? []), ...(store?.figures ?? [])], computations = [...(from?.computations ?? []), ...(answer.computations ?? []), ...(store?.computations ?? [])];
  const hints = [...(from?.sourceHints ?? []), ...((answer as Provenance).sourceHints ?? []), ...(store?.hints ?? [])];
  if (!figures.length && !computations.length && !hints.length && !(answer.policyStatedLimits ?? []).some((l) => l && !l.binding)) return;
  const text = [answer.summary, ...(answer.details ?? []), ...(answer.nextSteps ?? []), ...(answer.claimItems ?? []).map((c) => c?.reason ?? "")].join("\n");
  const sentences = new Set(text.split("\n").flatMap((t) => sentencesOf(t)).map((s) => norm(s)));
  const outF: BoundFigure[] = [], seen = new Set<string>();
  const addF = (b: BoundFigure) => { const k = JSON.stringify(b); if (sentences.has(norm(b.sentence)) && !seen.has(k)) { seen.add(k); outF.push(b); } };
  for (const b of figures) addF(b);
  const outC: ComputationRecord[] = [], seenC = new Set<string>();
  for (const c of computations) { const k = JSON.stringify(c); if (sentences.has(norm(c.sentence)) && !seenC.has(k)) { seenC.add(k); outC.push(c); } }
  const live = hints.filter((h) => sentencesOf(h.text).some((s) => sentences.has(norm(s)) && moneyFiguresIn(s).length));
  // A policy-stated limit card carries its own citation (policy, page) and owner: its binding is that page's line that
  // prints its amount on its benefit's row, for its owner.
  const cards = (answer.policyStatedLimits ?? []).filter((l) => l && !l.binding && l.citation?.policyId && (l.citation.pageStart ?? 0) > 0);
  if ((live.length || cards.length) && accountId) {
    const ids = [...new Set([...live.map((h) => h.policyId), ...cards.map((c) => c.citation.policyId)])];
    const docs = new Map((await query<{ id: string; owner: string; file_hash: string | null }>(`SELECT p.id::text AS id, p.family_member_id::text AS owner, p.file_hash FROM policies p WHERE p.account_id=$1 AND p.id::text=ANY($2::text[]) AND ${activePredicate("p")}`, [accountId, ids]).catch(() => ({ rows: [] }))).rows.map((r) => [r.id, r]));
    const members = (await query<{ policy_id: string; member: string }>(`SELECT policy_id::text AS policy_id, family_member_id::text AS member FROM policy_members WHERE account_id=$1 AND policy_id::text=ANY($2::text[])`, [accountId, ids]).catch(() => ({ rows: [] }))).rows;
    const pages = (await query<{ policy_id: string; page_number: number; text: string }>(`SELECT policy_id::text AS policy_id, page_number, text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[])`, [accountId, ids]).catch(() => ({ rows: [] }))).rows;
    const people = (await query<{ id: string; display_name: string | null; preferred_name: string | null; relationship: string | null }>(`SELECT f.id::text AS id, f.display_name, f.preferred_name, f.relationship FROM family_members f WHERE f.account_id=$1 AND ${activePredicate("f")}`, [accountId]).catch(() => ({ rows: [] }))).rows;
    const classOfPerson = (id: string) => { const r = people.find((p) => p.id === id)?.relationship ?? ""; return classOf(r) ?? (/^self$/i.test(r) ? "self" : null); };
    for (const h of live) {
      const doc = docs.get(h.policyId); if (!doc) continue;
      const who = new Set([doc.owner, ...members.filter((m) => m.policy_id === h.policyId).map((m) => m.member)]);
      const from = h.pageStart, to = Math.max(from, h.pageEnd ?? from);
      for (const s of sentencesOf(h.text)) {
        if (!sentences.has(norm(s))) continue;
        const lower = " " + s.toLowerCase().replace(/['’]s\b/g, " ").replace(/[^\p{L}\p{N} ]+/gu, " ") + " ";
        const named = people.filter((p) => who.has(p.id) && [p.display_name, p.preferred_name].some((n) => !!n && n.trim().length >= 3 && lower.includes(" " + n.toLowerCase().trim() + " ")));
        const subjectId = h.subjectId ?? named[0]?.id ?? doc.owner;
        for (const f of moneyFiguresIn(s)) for (let p = from; p <= to; p++) {
          const pageText = pages.find((x) => x.policy_id === h.policyId && x.page_number === p)?.text;
          const b = bindingFromPage({ policyId: h.policyId, subjectId, documentHash: doc.file_hash, page: p, pageText: pageText == null ? null : pageText + "\n" + cleanScannedText(pageText), sentence: s, value: f.value, currency: f.currency, benefit: h.benefit, column: h.column });
          if (b) {
            // A quoted row of a per-person table states each column's figure for that column's people: a column's figure
            // (quoted verbatim, or with no person given) is bound to the document's member of that column's class.
            const quoted = [...s.matchAll(/“([^”]*)”/g)].some((m) => moneyFiguresIn(m[1]).some((x) => same(x.value, f.value)));
            const want = (!h.subjectId || quoted) && b.column ? classOf(b.column) : null;
            if (want && classOfPerson(b.subjectId) !== want) { const m = [...who].find((id) => classOfPerson(id) === want); if (m) b.subjectId = m; }
            addF({ ...b, sentence: s.trim(), value: f.value, currency: f.currency });
            // A value table (one row per policy year, one column per value): the figure's benefit is its column.
            if (!h.benefit && b.column && b.column !== b.benefit) addF({ ...b, benefit: b.column, sentence: s.trim(), value: f.value, currency: f.currency });
            break;
          }
        }
      }
    }
    for (const c of cards) {
      const doc = docs.get(c.citation.policyId); if (!doc) continue;
      const who = new Set([doc.owner, ...members.filter((m) => m.policy_id === doc.id).map((m) => m.member)]);
      const owner = (c.ownerName ?? "").split(/, | and /)[0]?.trim().toLowerCase();
      const tokens = (n: string | null) => (n ?? "").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
      const own = new Set(tokens(owner));
      const subjectId = !owner ? doc.owner
        : people.find((p) => who.has(p.id) && [p.display_name, p.preferred_name].some((n) => !!n && n.trim().toLowerCase() === owner))?.id
        ?? people.find((p) => who.has(p.id) && [p.display_name, p.preferred_name].some((n) => { const t = tokens(n); return t.length > 0 && t.every((w) => own.has(w)); }))?.id
        ?? (who.size === 1 ? doc.owner : undefined);
      if (!subjectId) continue;
      for (let p = c.citation.pageStart!; p <= Math.max(c.citation.pageStart!, c.citation.pageEnd ?? 0); p++) {
        const pageText = pages.find((x) => x.policy_id === doc.id && x.page_number === p)?.text;
        if (!pageText) continue;
        const lines = (pageText + "\n" + cleanScannedText(pageText)).split(/\n/).map((l) => l.trim()).filter((l) => amountAppears(c.amount, l) && !benefitRowProblem(c.amount, c.benefitTitle, l));
        const line = lines.find((l) => norm(c.quote ?? "").includes(norm(l)) || norm(l).includes(norm(c.quote ?? "").slice(0, 40))) ?? lines[0];
        if (!line) continue;
        c.binding = { policyId: doc.id, subjectId, benefit: c.benefitTitle, documentHash: doc.file_hash, pageStart: p, pageEnd: p, passage: line, column: printedRowFor(c.benefitTitle, c.amount, pageText)?.column ?? null };
        break;
      }
    }
  }
  if (outF.length) answer.figureBindings = outF;
  if (outC.length) answer.computations = outC;
}
/** A computation operand grounded by its own binding. */
export function boundOperand(value: number, currency: string, period: FigurePeriod | null, role: "premium" | "benefit", binding: FigureBinding): ComputationOperand {
  return { value, currency, period, role, binding };
}
const PER: Partial<Record<FigurePeriod, number>> = { year: 1, half_year: 2, quarter: 4, month: 12, week: 52 };
/** The per-period factor between two periods (year <-> month is 12), or null. */
export function periodFactor(from: FigurePeriod, to: FigurePeriod): number | null {
  const a = PER[from], b = PER[to];
  if (!a || !b) return null;
  return a > b ? a / b : b / a;
}

// ---------------------------------------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------------------------------------

type Doc = { id: string; owner: string; members: Set<string>; fileHash: string | null; superseded: boolean; usable: boolean; pages: Map<number, string>;
  product: string | null; policyNumber: string | null; groupPolicyNumber?: string | null; role: string | null; effective: string | null; expiry: string | null };
/** Every active document of the household (light: no pages), for an endorsement's link to the policy it amends. */
type HouseDoc = { id: string; owner: string; members: Set<string>; product: string | null; policyNumber: string | null; role: string | null };
type Person = { id: string; names: string[]; relationship: string; notes?: string | null; dateOfBirth?: string | null };
/** Agent G: a column printed for a class of person (Adult / Child / Insured Child / Juvenile / Spouse / Life Assured
 * ...) supports a figure only for a person established to be in that class; an ambiguous or unrecognised person column
 * supports nobody's figure, and a person whose class is not established never passes a class-specific column. */
function classProblem(column: string | null | undefined, subject: Person | undefined, ownerId: string | null): string | null {
  const col = columnApplicability(column);
  if (col.kind === "none") return null;
  const p = subject ? personApplicability({ relationship: subject.relationship, notes: subject.notes ?? null, dateOfBirth: subject.dateOfBirth ?? null }) : { cls: "unknown" as const, relation: "other" as const, age: null, basis: "none" as const, detail: "the person is not one of this household's members" };
  const why = columnFitProblem(col, p, { isOwner: subject && ownerId ? subject.id === ownerId : null, header: column ?? null });
  return why ? "the figure cannot be used for this person: " + why : null;
}
/** A sentence saying an amendment / endorsement document was removed (deleted / taken out / replaced). */
export const CLAIMS_REMOVAL = /\b(?:amend\w*|endorse\w*|alteration)\b[^.;]{0,120}?\b(?:was|were|has been|have been|had been|is|are)\s+(?:removed|deleted|taken out)\b/i;
/** Whether this household has any removed (deleted / superseded) amendment document at all (metadata only). */
async function householdRemovedAmendment(accountId: string): Promise<boolean> {
  const r = await query<{ any: boolean }>(`SELECT EXISTS (SELECT 1 FROM policies q WHERE q.account_id=$1 AND (q.lifecycle_state<>'active' OR q.superseded_at IS NOT NULL)
      AND coalesce(to_jsonb(q)->>'document_role','') ~* 'endorse|alteration|amendment|rider|addendum') AS any`, [accountId]).catch(() => null);
  // Unknown (the query failed): never reject on it.
  return r ? !!r.rows[0]?.any : true;
}
type Ctx = { docs: Map<string, Doc>; people: Person[]; userFigures: StatedFigure[]; userNumbers: number[]; userText: string; householdTexts: string[]; house: HouseDoc[];
  /** Round 8: for each cited active document, the removed amendments of its policy (metadata only). */
  removals: Map<string, AmendmentRemoval[]> };

function bindingsOf(answer: ChatAnswer): FigureBinding[] {
  const out: FigureBinding[] = [...(answer.figureBindings ?? [])];
  for (const l of answer.policyStatedLimits ?? []) if (l?.binding) out.push(l.binding);
  const walk = (r: ComputationRecord | undefined, depth: number) => { if (!r || depth > 3) return; for (const o of r.operands ?? []) { if (o?.binding) out.push(o.binding); if (o?.computation) walk(o.computation, depth + 1); } };
  for (const c of answer.computations ?? []) walk(c, 0);
  for (const k of answer.calculations ?? []) for (const o of k?.operands ?? []) if (o?.source === "document" && o.binding) out.push(o.binding);
  return out;
}

/** The documents the answer's bindings and citations name (this household's, active -- the lifecycle predicate --
 * with their release state, version and pages), the household's people, and the household's own figures. */
async function loadContext(accountId: string, answer: ChatAnswer, userText: string, priorUserTexts: string[] = []): Promise<Ctx> {
  const ids = [...new Set([...bindingsOf(answer).map((b) => b?.policyId), ...(answer.calculations ?? []).map((k) => k?.policyId),
    // Round 8e: a condition may quote an amendment document of the calculation's policy (an admission-day exception it restates).
    ...(answer.calculations ?? []).flatMap((k) => (k?.conditions ?? []).map((c) => c?.passage?.policyId)), ...(answer.citations ?? []).map((c) => c?.policyId), ...(answer.policyStatedLimits ?? []).map((l) => l?.citation?.policyId)].filter((x): x is string => typeof x === "string" && !!x))];
  const docs = new Map<string, Doc>();
  // Whether this household has any removed (deleted / superseded) amendment document at all -- asked in the same query
  // as the cited documents, so the metadata read below costs nothing for the many households that have none.
  let anyRemovedAmendment = false;
  if (ids.length) {
    const rows = (await query<{ id: string; owner: string; file_hash: string | null; superseded: boolean; usable: boolean; product: string | null; policy_number: string | null; group_policy_number: string | null; role: string | null; effective: string | null; expiry: string | null; removed_amendment: boolean }>(
      `SELECT p.id::text AS id, p.family_member_id::text AS owner, p.file_hash, (p.superseded_at IS NOT NULL) AS superseded,
              (coalesce(p.quarantine_status,'') IN ('scan_clean','not_scanned_prototype')) AS usable,
              to_jsonb(p)->>'product_name' AS product, to_jsonb(p)->>'policy_number' AS policy_number, to_jsonb(p)->>'group_policy_number' AS group_policy_number, to_jsonb(p)->>'document_role' AS role,
              left(to_jsonb(p)->>'effective_date', 10) AS effective, left(to_jsonb(p)->>'renewal_or_expiry_date', 10) AS expiry,
              EXISTS (SELECT 1 FROM policies q WHERE q.account_id=p.account_id AND (q.lifecycle_state<>'active' OR q.superseded_at IS NOT NULL)
                        AND coalesce(to_jsonb(q)->>'document_role','') ~* 'endorse|alteration|amendment|rider|addendum') AS removed_amendment
         FROM policies p WHERE p.account_id=$1 AND p.id::text=ANY($2::text[]) AND ${activePredicate("p")}`, [accountId, ids]).catch(() => ({ rows: [] }))).rows;
    anyRemovedAmendment = rows.some((r) => !!r.removed_amendment);
    for (const r of rows) docs.set(r.id, { id: r.id, owner: r.owner, members: new Set([r.owner]), fileHash: r.file_hash, superseded: !!r.superseded, usable: !!r.usable, pages: new Map(), product: r.product ?? null, policyNumber: r.policy_number ?? null, groupPolicyNumber: r.group_policy_number ?? null, role: r.role ?? null, effective: r.effective ?? null, expiry: r.expiry ?? null });
    if (docs.size) {
      const members = (await query<{ policy_id: string; member: string }>(`SELECT policy_id::text AS policy_id, family_member_id::text AS member FROM policy_members WHERE account_id=$1 AND policy_id::text=ANY($2::text[])`, [accountId, [...docs.keys()]]).catch(() => ({ rows: [] }))).rows;
      for (const m of members) docs.get(m.policy_id)?.members.add(m.member);
      const pages = (await query<{ policy_id: string; page_number: number; text: string }>(`SELECT policy_id::text AS policy_id, page_number, text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[])`, [accountId, [...docs.keys()]]).catch(() => ({ rows: [] }))).rows;
      for (const p of pages) docs.get(p.policy_id)?.pages.set(p.page_number, p.text ?? "");
    }
  }
  const people = (await query<{ id: string; display_name: string | null; preferred_name: string | null; relationship: string | null; notes: string | null; date_of_birth: string | null }>(`SELECT f.id::text AS id, f.display_name, f.preferred_name, f.relationship, f.notes, to_char(f.date_of_birth, 'YYYY-MM-DD') AS date_of_birth FROM family_members f WHERE f.account_id=$1 AND ${activePredicate("f")}`, [accountId]).catch(() => ({ rows: [] }))).rows
    .map((p) => ({ id: p.id, names: [p.display_name, p.preferred_name].filter((n): n is string => !!n && n.trim().length >= 3).map((n) => n.trim()), relationship: p.relationship ?? "", notes: p.notes ?? null, dateOfBirth: p.date_of_birth ?? null }));
  // The household's own messages in this conversation (only read when the answer carries a benefit calculation whose
  // household inputs must be quoted from them).
  const householdTexts = [userText, ...priorUserTexts.filter((t) => t && t !== userText)];
  if (answer.calculations?.length && answer.conversationId) {
    const rows = (await query<{ content: string }>(`SELECT content FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 AND role='user' ORDER BY created_at`, [accountId, answer.conversationId]).catch(() => ({ rows: [] as { content: string }[] }))).rows;
    householdTexts.push(...rows.map((r) => r.content ?? ""));
  }
  // The household's other documents, only when a cited document is an endorsement / alteration (its link to the policy
  // it amends is re-established from them).
  const house: HouseDoc[] = [];
  if ([...docs.values()].some((d) => isAmendment(d))) {
    const all = (await query<{ id: string; owner: string; product: string | null; policy_number: string | null; role: string | null }>(
      `SELECT p.id::text AS id, p.family_member_id::text AS owner, to_jsonb(p)->>'product_name' AS product, to_jsonb(p)->>'policy_number' AS policy_number, to_jsonb(p)->>'document_role' AS role
         FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL`, [accountId]).catch(() => ({ rows: [] }))).rows;
    const links = (await query<{ policy_id: string; member: string }>(`SELECT policy_id::text AS policy_id, family_member_id::text AS member FROM policy_members WHERE account_id=$1`, [accountId]).catch(() => ({ rows: [] }))).rows;
    for (const r of all) house.push({ id: r.id, owner: r.owner, members: new Set([r.owner, ...links.filter((l) => l.policy_id === r.id).map((l) => l.member)]), product: r.product ?? null, policyNumber: r.policy_number ?? null, role: r.role ?? null });
  }
  // Round 8: removed (deleted / superseded) amendment documents of the cited policies -- read from document METADATA
  // only; a removed document's text is never loaded. Active documents' text is used only for an explicit reversal.
  const removals = new Map<string, AmendmentRemoval[]>();
  if (docs.size && anyRemovedAmendment) {
    const meta = await loadDocMeta(accountId);
    if (meta.some((m) => isAmendmentRole(m.role) && (!m.active || m.superseded))) {
      const activeIds = meta.filter((m) => m.active && !m.superseded).map((m) => m.id);
      const texts = new Map<string, string>();
      for (const r of (await query<{ policy_id: string; text: string }>(`SELECT pp.policy_id::text AS policy_id, pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
          WHERE pp.account_id=$1 AND pp.policy_id::text=ANY($2::text[]) AND ${activePredicate("p")} AND p.superseded_at IS NULL`, [accountId, activeIds]).catch(() => ({ rows: [] as { policy_id: string; text: string }[] }))).rows)
        texts.set(r.policy_id, (texts.get(r.policy_id) ?? "") + "\n" + (r.text ?? ""));
      for (const id of docs.keys()) { const base = meta.find((m) => m.id === id); if (!base) continue; const r = amendmentRemovalsFor(base, meta, texts); if (r.length) removals.set(id, r); }
    }
  }
  return { docs, people, house, removals, userFigures: moneyFiguresIn(userText), userNumbers: (userText.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number), userText, householdTexts };
}

// ---- table dimensions ---------------------------------------------------------------------------------------
/** A document that amends a policy (an endorsement / alteration): by its recorded role, or its own wording. */
const AMENDS_WORDING = /\bendorsement\b|\bpolicy (?:is|has been) altered\b|\bpolicy alteration\b|\b(?:is|are|hereby|has been|have been) amended\b/i;
function isAmendment(d: Doc): boolean {
  if (/endorse|alteration|amendment/i.test(d.role ?? "")) return true;
  const first = [...d.pages.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t).join("\n").slice(0, 1200);
  return AMENDS_WORDING.test(first) && /\bendorsement\b|\balteration\b|\bamendment\b/i.test(first.slice(0, 400));
}
const normNo = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** The policy number an endorsement says it amends ("Endorsement No. 1 to policy KH-1234"), normalised; null if none. */
function amendedPolicyNumber(d: Doc): string | null {
  const all = [...d.pages.values()].join("\n");
  const m = all.match(/\b(?:to|of|under|for|amending)\s+(?:the\s+)?(?:above\s+)?policy\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})/i)
    ?? all.match(/^\s*policy\s*(?:no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})/im);
  return m && /\d/.test(m[1]) ? normNo(m[1]) : null;
}
/** The date a document's change takes effect: a printed line naming a change with a date, else its printed effective
 * date, else the recorded one. */
function changeDateOf(d: Doc): string | null {
  const text = [...d.pages.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t).join("\n");
  const lines = text.split(/\n/);
  for (const l of lines) if (/\b(?:with effect from|w\.?e\.?f\.?|effective (?:date|from|on)|takes? effect)\b/i.test(l) && /\b(?:endorse|amend|alter|revis|chang|new|increas|decreas)/i.test(l)) { const ds = datesIn(l); if (ds.length === 1) return ds[0]; }
  for (const l of lines) if (/\b(?:effective (?:date|from|on)|with effect from|takes? effect (?:on|from))\b/i.test(l)) { const ds = datesIn(l); if (ds.length) return ds[0]; }
  return d.effective;
}
/** The date a sentence is about: a date it states (other than the change's own effective date), else one the household's
 * message states, else today. */
function questionDate(sentence: string | null, userText: string, effective: string | null): string {
  const pick = (t: string) => datesIn(t).filter((x) => x !== effective);
  return (sentence ? pick(sentence)[0] : undefined) ?? pick(userText)[0] ?? new Date().toISOString().slice(0, 10);
}
/** Whether `sentence` presents the figure `value` itself as the EARLIER value of a change, decided at the figure's own
 * position: a marker must stand directly before that figure ("Before S$X; After S$Y", "from S$X to S$Y", "raised ...
 * from S$X", "previously S$X", "was S$X, now S$Y", "replacing S$X", or the table's own column label quoted next to it),
 * and the later value of the same row must be stated in the sentence too. A marker attached to another figure ("was
 * S$500 ... the limit is S$X") or anywhere else in the sentence does not count. */
/** A unit or period printed between a figure and a marker after it ("S$80 per day before the endorsement"). */
const UNIT_AFTER = "(?:\\s*(?:per|a|an|each|every)\\s+[\\p{L}]+(?:\\s+(?:of|in)\\s+[\\p{L}]+){0,2}|\\s*\\/\\s*[\\p{L}]+)?";
/** "…, but / and / while the endorsement revises / raises / changes it to" -- the clause between an earlier value and its
 * later value. */
const CONTRAST_REVISION = new RegExp("^" + UNIT_AFTER + "[^.;!?]{0,80}?\\b(?:but|and|however|whereas|while|though|although)\\b[^.;!?]{0,120}?\\b(?:revis|rais|increas|reduc|lower|chang|amend|replac|cut|lift|bump|adjust|alter|mov)\\w*\\b(?:\\s+[\\p{L}’']+){0,4}?\\s+(?:to|up to|down to|at)\\s*$", "iu");
const CHANGE_VERB = /\b(?:raised|raises|increased|increases|reduced|reduces|decreased|decreases|lowered|lowers|cut|changed|changes|amended|amends|revised|revises|moved|moves|went|goes|rose|rises|fell|falls|dropped|drops|adjusted|adjusts|altered|alters)\b/i;
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function earlierValuePresented(sentence: string, value: number, beforeLabels: string[], laterValues: number[]): boolean {
  const s = sentence ?? "";
  if (!laterValues.length || !moneyFiguresIn(s).some((f) => laterValues.some((l) => same(l, f.value)))) return false;
  const labels = [...new Set(beforeLabels.map((l) => l.trim()).filter((l) => l.length >= 2 && l.length <= 40))].map(escRe);
  const marker = new RegExp("(?:^|[^\\p{L}])(" + ["previous(?:ly)?", "formerly", "originally", "earlier", "old", "original", "existing", "prior", "before", "was", "were", "from", "replacing", "replaces", "replaced", "up from", "down from", ...labels].join("|") + ")"
    + "(?:\\s+(?:of|at|the|a|an|limit|amount|figure|sum|value|level|benefit|cover))*\\s*[:=–—-]?\\s*[\"“”‘’'(]?\\s*$", "iu");
  // ... or a marker directly after it ("S$X before the change, S$Y from ...", "S$X (Before)", "S$X previously").
  const postMarker = new RegExp("^" + UNIT_AFTER + "\\s*[,;]?\\s*[\"“”‘’'(]?\\s*(?:(?:before|prior to)\\s+(?:the\\s+|this\\s+|that\\s+|its\\s+)?(?:endorsement|amendment|alteration|change|revision|reduction|increase|decrease|update)|previously|originally|formerly|earlier|(?:in|under|on) the (?:earlier|previous|old|original|former) (?:schedule|policy|terms|version)|(?:as )?the (?:old|previous|earlier|original|former) (?:figure|value|amount|limit|sum)" + (labels.length ? "|(?:" + labels.join("|") + ")[\"“”‘’')]" : "") + ")(?![\\p{L}])", "iu");
  const all = [...s.matchAll(FIGURE), ...s.matchAll(BARE_DOLLAR)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, raw: m[0] })).sort((a, b) => a.at - b.at);
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    const v = moneyFiguresIn(f.raw)[0];
    if (!v || !same(v.value, value)) continue;
    const prevEnd = i > 0 ? all[i - 1].end : 0;
    const nextAt = i + 1 < all.length ? all[i + 1].at : s.length;
    if (postMarker.test(s.slice(f.end, nextAt))) return true;
    // A contrastive revision in the next clause ("… lists S$X per day, but the endorsement revises it to S$Y …"): the
    // figure sits in the earlier clause and the very next figure is the row's later value.
    if (i + 1 < all.length && moneyFiguresIn(all[i + 1].raw).some((x) => laterValues.some((l) => same(l, x.value))) && CONTRAST_REVISION.test(s.slice(f.end, all[i + 1].at))) return true;
    const m = s.slice(prevEnd, f.at).match(marker);
    if (!m) continue;
    const word = m[1].toLowerCase(), after = s.slice(f.end);
    const laterAfter = () => all.slice(i + 1).some((g) => moneyFiguresIn(g.raw).some((x) => laterValues.some((l) => same(l, x.value))));
    if (word === "from") { if (!(CHANGE_VERB.test(s.slice(0, f.at)) || /^\s*[,)]?\s*(?:to|→|->|–|—)\s/i.test(after)) || !(laterAfter() || CHANGE_VERB.test(s.slice(0, f.at)))) continue; }
    else if (word === "was" || word === "were") { if (!/\b(?:now|currently|today|at present)\b/i.test(after) || !laterAfter()) continue; }
    return true;
  }
  return false;
}
const brandWords = (product: string | null) => (product ?? "").toLowerCase().match(/[a-z][a-z0-9]{3,}/g)?.filter((w) => !/^(?:plan|plans|insurance|assurance|policy|family|health|life|personal|accident|hospital|integrated|shield|cover|care|protect|protection|benefit|benefits|schedule|endorsement|group|term|whole|travel|medical|critical|illness|guard|plus|basic|standard|premier|gold|silver|platinum)$/.test(w)) ?? [];

type TableHead = { top: number; head: string[]; full: string[] };
/** The header of the table a row sits in (see headerFor), with each column's full header: a spanning heading printed
 * on the line directly above it ("Adult" over "Before | After") joined to the leaf ("Adult / Before"). */
function tableHeadFor(lines: string[], at: number, cells: number): TableHead | null {
  let top = -1;
  for (let i = at - 1; i >= 0 && i >= at - 60; i--) { const n = rowCells(lines[i]).length; if (n >= 3 && n >= cells - 1) top = i; else break; }
  if (top < 0 || MONEY_CELL.test(lines[top])) return null;
  const head = rowCells(lines[top]);
  const full = [...head];
  const above = top > 0 ? lines[top - 1] : "";
  if (above.trim() && !MONEY_CELL.test(above) && !/\d[\d,]{3,}/.test(above) && rowCells(above).length >= 1 && rowCells(above).length < head.length && ((above.includes("\t") && !above.split("\t")[0].trim()) || (!above.includes("\t") && above.length - above.trimStart().length >= 4))) {
    const spans: { text: string; pos: number }[] = [];
    const leaves: number[] = [];
    if (above.includes("\t") && lines[top].includes("\t")) {
      let cur: string | null = null;
      const a = above.split("\t"), hraw = lines[top].split("\t");
      const map: (string | null)[] = hraw.map((_, i) => { if (a[i] && a[i].trim()) cur = a[i].trim(); return i < a.length || cur ? cur : null; });
      let k = 0;
      hraw.forEach((c, i) => { if (c.trim()) { if (map[i] && map[i] !== c.trim()) full[k] = `${map[i]} / ${c.trim()}`; k++; } });
    } else {
      for (const m of above.matchAll(/\S+(?: \S+)*/g)) spans.push({ text: m[0], pos: m.index! });
      for (const m of lines[top].matchAll(/\S+(?: \S+)*/g)) leaves.push(m.index!);
      if (leaves.length === head.length) leaves.forEach((pos, k) => { const sp = [...spans].reverse().find((x) => pos >= x.pos - 3); if (sp && k > 0 && sp.text !== head[k]) full[k] = `${sp.text} / ${head[k]}`; });
    }
  }
  return { top, head, full };
}

/** The column check: where the row that prints the amount has one value cell per person, tier, version or stage, the
 * amount must be in the binding's column, and EVERY dimension of that column must hold for the figure: the person's
 * class (an employee is not the spouse column), the version in force on the date the sentence is about (an amended
 * value from its effective date until it ends; the earlier value only before it, or where the sentence presents it as
 * the earlier value), and the stage the sentence names. A version column is never a person. */
/** The household member a cell names (every word of one of their names in the cell, any order; the fullest match
 * wins, a tie is nobody). */
function memberNamedInCell(cell: string, people: Person[]): string | null {
  const words = (x: string) => (x.toLowerCase().normalize("NFKC").match(/\p{L}+/gu) ?? []).filter((w) => w.length >= 2);
  const have = new Set(words(cell));
  let best: { id: string; n: number } | null = null, tie = false;
  // (A one-word name -- a preferred name such as "Grace" or "May" -- names a cell only when it is the whole cell, so
  // "Grace period" or "May 2026" is never a person.)
  const cellWords = words(cell);
  for (const p of people) for (const n of p.names) {
    const w = words(n);
    if (!w.length || !w.every((x) => have.has(x))) continue;
    if (w.length === 1 && !(cellWords.length === 1 && cellWords[0] === w[0])) continue;
    if (!best || w.length > best.n) { best = { id: p.id, n: w.length }; tie = false; } else if (w.length === best.n && best.id !== p.id) tie = true;
  }
  return best && !tie ? best.id : null;
}
/** Words that present a figure as cover in force now, or as money that will be paid -- not what a dated document
 * printed on its date. */
const PRESENT_COVER = /\b(?:currently|now|today|still)\s+(?:covered|insured|has|have|holds?|gets?)\b|\bis (?:currently |now )?(?:covered|insured) for\b|\bwill (?:be )?(?:receive|get|paid|pay|payable)\b|\b(?:entitled|eligible) to\b|\bpayable to\b|\byou(?:'ll| will) get\b/i;
/** Words that attribute a figure to the document ("the certificate lists ...", "as of 1 April 2024"). */
const ATTRIBUTED = /\b(?:certificate|schedule|document|policy (?:schedule|document)|lists?|listed|shows?|shown|prints?|printed|states?|stated|records?|recorded|as (?:of|at)|dated|effective)\b/i;
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Whether a sentence names the ISO date `iso` ("1 April 2024", "01/04/2024", "2024-04-01", "April 2024"). */
function namesDate(sentence: string, iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const s = sentence.toLowerCase();
  if (s.includes(iso)) return true;
  if (new RegExp(`\\b0?${d}[/.-]0?${m}[/.-]${y}\\b`).test(s)) return true;
  const month = MONTH_NAMES[m - 1];
  return new RegExp(`\\b${month.slice(0, 3)}[a-z]*\\.?\\s+${y}\\b`).test(s);
}
/** The shared evidence contract, layout person_row (a group certificate's roster: one insured person per ROW, the
 * product as the heading above the rows). Checked against the stored page, never trusted: the bound row is printed in
 * the cited passage with the figure; its name cell names the person the figure is stated for (household names, any
 * order) and no one else; the heading above it is the benefit the sentence states; the figure is the row's one amount
 * (or, where the row prints several, the one under the bound column's heading); its currency; and -- for a row printed
 * "as of" a date -- the sentence presents it as the document's amount on that date, not as current cover or money
 * that will be paid. */
function personRowProblem(b: FigureBinding, value: number, currency: string, rangeText: string, subject: Person | undefined, people: Person[], sentence: string | null): string | null {
  if (!subject) return "the figure is not bound to a household member";
  const pool = people.some((p) => p.id === subject.id) ? people : [...people, subject];
  const name = (b.rowPerson ?? "").trim();
  if (!name) return "the figure is not bound to a person's row";
  const row = passageRows(b.passage).find((r) => amountAppears(value, r) && norm(r).includes(norm(name)));
  if (!row) return cellRosterProblem(b, value, currency, rangeText, subject, pool, name, sentence) ?? null;
  const who = memberNamedInCell(name, pool);
  if (!who) return `the row's name (“${name}”) does not identify ${subject.names[0] ?? "the person"} unambiguously`;
  if (who !== subject.id) return "the figure is printed on another insured person’s row, not the one it is stated for";
  const cells = rowCells(row);
  for (const c of cells) { const other = !MONEY_CELL.test(c) && c !== name ? memberNamedInCell(c, pool) : null; if (other && other !== subject.id) return "the row also names another household member"; }
  const money = cells.filter((c) => MONEY_CELL.test(c));
  const holding = money.filter((c) => amountAppears(value, c));
  if (holding.length !== 1) return "the figure is not one of the row's printed amounts";
  if (money.length > 1) {
    const lines = rangeText.split(/\n/);
    const at = lines.findIndex((l) => norm(l).includes(norm(row).slice(0, 60)));
    const t = at >= 0 ? tableHeadFor(lines, at, cells.length) : null;
    const j = cells.indexOf(holding[0]);
    const off = t ? cells.length - Math.min(t.head.length, cells.length) : 0;
    if (!t || !b.column || norm(t.full[j - off] ?? t.head[j - off] ?? "") !== norm(b.column)) return "the row prints more than one amount, and the figure is not bound to the column it is printed in";
  }
  if (amountPrintedWith(value, currency, holding[0]) === "other") return "the currency printed in the row is not the figure’s";
  // The product heading the row sits under (the nearest heading line above it) must be the benefit the binding states.
  const lines = rangeText.split(/\n/);
  const at = lines.findIndex((l) => norm(l).includes(norm(row).slice(0, 60)));
  let heading: string | null = null;
  for (let i = at - 1; i >= 0 && i >= at - 40; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    const c = rowCells(lines[i]);
    if (c.length === 1 && !MONEY_CELL.test(l) && l.length <= 80 && !/[.:]$/.test(l)) { heading = l; break; }
    if (c.length >= 2 && !MONEY_CELL.test(l) && !/\d/.test(l)) break; // a header row: a table with no product headings
  }
  // (Compared on the heading's own words -- "Group", "Policy No." and numbers carry no product meaning -- so "Group
  // Term Life" is never "Group Personal Accident".)
  return headingAndDateProblem(b, heading, sentence);
}
/** The product heading a person's row is printed under must be the benefit the binding states, and a row printed "as
 * of" a date is presented as the document's amount on that date (shared by both roster layouts). */
function headingAndDateProblem(b: FigureBinding, heading: string | null, sentence: string | null): string | null {
  const productWords = (s: string) => (s.toLowerCase().replace(/\([^)]*\)/g, " ").match(/[a-z]{3,}/g) ?? []).filter((w) => !["group", "policy", "the", "and", "for", "sum", "assured", "insured", "benefit", "amount", "cover"].includes(w));
  const hw = heading ? productWords(heading) : [], bw = productWords(b.benefit);
  const sameProduct = hw.length > 0 && bw.length > 0 && (hw.every((w) => bw.includes(w)) || bw.every((w) => hw.includes(w)));
  if (heading && hw.length && !sameProduct) return `the row is printed under “${heading}”, not under the benefit the figure is stated for`;
  if (b.asOf && sentence != null) {
    if (PRESENT_COVER.test(sentence)) return `the document prints this amount as of ${b.asOf}: state it as the document's amount on that date, not as cover in force now or money that will be paid`;
    if (!ATTRIBUTED.test(sentence) && !namesDate(sentence, b.asOf)) return `the document prints this amount as of ${b.asOf}: say it is what the document lists (and as of when), not current cover`;
  }
  return null;
}
/** V1.4: a person's row on a roster stored ONE CELL PER LINE, read by its record structure (lib/claims/roster-layout.ts,
 * the same reconstruction retrieval used) from the stored page -- never trusted from the binding: the bound cells are
 * one complete record printed in the cited passage, its name cell names this person and no one else, its one amount is
 * the figure in its currency, under the heading the binding states. A record the structure cannot establish is refused. */
function cellRosterProblem(b: FigureBinding, value: number, currency: string, rangeText: string, subject: Person, pool: Person[], name: string, sentence: string | null): string | null {
  const sq = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
  const P = sq(b.passage);
  const { records } = reconstructCellRoster([{ page: b.pageStart, text: rangeText }], (t) => memberNamedInCell(t, pool));
  const rec = records.find((r) => sq(r.name.text) === sq(name) && amountAppears(value, r.amount.text) && P.includes(sq(r.cells.map((c) => c.text).join(" "))));
  if (!rec) return "the bound person's row does not print the figure in the cited passage";
  const who = memberNamedInCell(rec.name.text, pool);
  if (!who) return `the row's name (“${rec.name.text}”) does not identify ${subject.names[0] ?? "the person"} unambiguously`;
  if (who !== subject.id) return "the figure is printed on another insured person’s row, not the one it is stated for";
  if (amountPrintedWith(value, currency, rec.amount.text) === "other") return "the currency printed in the row is not the figure’s";
  return headingAndDateProblem(b, rec.heading, sentence);
}

function columnProblem(b: FigureBinding, value: number, currency: string, rangeText: string, subject: Person | undefined, opts: { count?: boolean; ownerId?: string | null; doc?: Doc | null; sentence?: string | null; userText?: string; people?: Person[] } = {}): string | null {
  const rows = passageRows(b.passage).filter((r) => amountAppears(value, r));
  if (!rows.length) return "the amount is not printed in the cited passage";
  // The table layout comes from retrieval (the shared evidence contract) and is checked against the page -- never
  // inferred here from the number of cells. A person's own ROW (a certificate roster):
  if (b.layout === "unresolved") return "who the table's value is for is not established";
  if (b.layout === "person_row") return opts.count ? null : personRowProblem(b, value, currency, rangeText, subject, opts.people ?? [], opts.sentence ?? null);
  // Whatever the layout: a figure on a row that names another household member (and not this person) is theirs.
  if (subject && !opts.count) {
    const pool = (opts.people ?? []).some((p) => p.id === subject.id) ? opts.people ?? [] : [...(opts.people ?? []), subject];
    for (const r of rows) {
      const named = rowCells(r).filter((c) => !MONEY_CELL.test(c)).map((c) => memberNamedInCell(c, pool)).filter((x): x is string => !!x);
      if (named.length && !named.includes(subject.id)) return "the figure is printed on another insured person’s row, not the one it is stated for";
    }
  }
  // A row with one value prints one figure for everyone it covers -- an item code ("A", "1") and the benefit's name are
  // not value columns ("No. | Benefit | Amount payable" is one amount column, not one column per person or tier). A
  // row that says in a cell of its own who it is for ("Category: Child (each)") is still checked for that person.
  const valueCells = (r: string) => { const c = rowCells(r); return c.length > 1 && isRowCode(c[0]) ? c.slice(1) : c; };
  if (rows.some((r) => valueCells(r).length < 3)) return rowCategoryProblem(rows, rangeText.split(/\n/), subject, opts.ownerId ?? null);
  const unbound = "the row prints one column per person or tier, and the figure is not bound to a column";
  const lines = rangeText.split(/\n/);
  const col = norm(b.column ?? "");
  for (const row of rows) {
    const cells = rowCells(row);
    const at = lines.findIndex((l) => norm(l).includes(norm(row).slice(0, 60)));
    if (at < 0) continue;
    const t = tableHeadFor(lines, at, cells.length);
    if (!t) { if (!col) return unbound; continue; }
    const off = cells.length - Math.min(t.head.length, cells.length);
    const value_js = t.head.map((_, j) => j).filter((j) => j + off > 0);
    let j = -1;
    if (col) {
      const by = (f: (j: number) => boolean) => value_js.filter(f);
      let cand = by((x) => norm(t.full[x]) === col);
      if (!cand.length) cand = by((x) => norm(t.head[x]) === col);
      if (!cand.length) cand = by((x) => { const hn = norm(t.head[x]), fn = norm(t.full[x]); return (hn.length >= 2 && (hn.includes(col) || col.includes(hn))) || (fn.length >= 2 && col.includes(fn)); });
      if (!cand.length) continue;
      // The same leaf under two headings ("After" under Adult and Child): the one that prints the figure.
      const holding = cand.filter((x) => amountAppears(value, cells[x + off] ?? ""));
      j = holding.length === 1 ? holding[0] : cand[0];
      if (!amountAppears(value, cells[j + off] ?? "")) return "the figure is printed in another person’s or tier’s column, not the one it is stated for";
    } else {
      // No column bound: the column the figure is printed in stands only when its one dimension is the version (an
      // endorsement's Before / After) -- a person, plan or stage column must be bound by the producer.
      const holding = value_js.filter((x) => amountAppears(value, cells[x + off] ?? ""));
      if (holding.length !== 1 || !versionPairOf(t.full)) return unbound;
      const d = columnDimensions(t.full[holding[0]]);
      if (!d.version || d.person.kind !== "none" || d.plan || d.stage) return unbound;
      j = holding[0];
    }
    const cell = cells[j + off] ?? "";
    const how = opts.count ? "match" : amountPrintedWith(value, currency, cell);
    if (how === "other" || (how === "bare" && !currenciesStatedIn(t.full[j] + " " + b.passage).includes(currency))) return "the currency printed in the column is not the figure’s";
    const dims = columnDimensions(t.full[j]);
    // Agent G: the column's class against the person's established class (an unknown class never passes).
    const rowCls = rowCategoryProblem([row], lines, subject, opts.ownerId ?? null);
    if (rowCls) return rowCls;
    const cls = classProblem(dims.version ? t.full[j].replace(dims.version.words, " ").replace(/\s*\/\s*$|^\s*\/\s*/g, "").trim() || null : t.full[j], subject, opts.ownerId ?? null);
    if (cls) return cls;
    if (dims.stage && opts.sentence != null && !new RegExp("\\b" + dims.stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ -]/g, "[ -]") + "\\b", "i").test(opts.sentence)) return `the figure is printed in the “${t.full[j]}” column, and the sentence does not say it is for that stage`;
    // The row's other versions: the later (after) values, and the labels of the earlier (before) columns.
    const sideOf = (x: number) => columnDimensions(t.full[x]).version?.side ?? null;
    const later = value_js.filter((x) => sideOf(x) === "after").flatMap((x) => (cells[x + off] ?? "").replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const beforeLabels = value_js.filter((x) => sideOf(x) === "before").flatMap((x) => [t.head[x], columnDimensions(t.full[x]).version?.words ?? ""]);
    return versionProblem(dims, t.full, opts.doc ?? null, opts.sentence ?? null, opts.userText ?? "", { value, later, beforeLabels });
  }
  return col ? "the table column the figure is stated for is not printed above its row" : unbound;
}
/** A row's own category cell (under a "Category" / "Insured" / "Class" heading): the person the figure is stated for
 * must be in that class, as for a person column. */
function rowCategoryProblem(rows: string[], lines: string[], subject: Person | undefined, ownerId: string | null): string | null {
  for (const row of rows) {
    const cells = rowCells(row);
    const at = lines.findIndex((l) => norm(l).includes(norm(row).slice(0, 60)));
    if (at < 0) continue;
    const t = tableHeadFor(lines, at, cells.length);
    if (!t) continue;
    const off = cells.length - Math.min(t.head.length, cells.length);
    const j = t.head.findIndex((h) => CATEGORY_HEADER.test(h.trim()));
    if (j < 0 || j + off < 0) continue;
    const cell = cells[j + off] ?? "";
    if (!cell || columnApplicability(cell).kind === "none") continue;
    const why = classProblem(cell, subject, ownerId);
    if (why) return why.replace("the column", `the row's “${t.head[j]}” cell (“${cell}”)`);
  }
  return null;
}
/** A sentence that names a DIFFERENT row of the same table than the one the figure is printed on: it uses words that
 * only that other row's label has, and none that only the bound row's label has ("simple fracture" for a figure on the
 * "Compound (open) fracture" row). Null when it does not. */
function otherRowProblem(sentence: string, value: number, passage: string, rangeText: string, label: string): string | null {
  const rowLine = passageRows(passage).find((r) => amountAppears(value, r));
  if (!rowLine || rowCells(rowLine).length < 2) return null;
  const lines = rangeText.split(/\n/);
  const at = lines.findIndex((l) => norm(l).includes(norm(rowLine).slice(0, 60)));
  if (at < 0) return null;
  const isRow = (l: string) => rowCells(l).length >= 2 && /\d/.test(l) && !!l.trim();
  let a = at, z = at;
  while (a > 0 && isRow(lines[a - 1])) a--;
  while (z + 1 < lines.length && isRow(lines[z + 1])) z++;
  const mine = benefitWords(label), said = benefitWords(sentence);
  for (let i = a; i <= z; i++) {
    if (i === at) continue;
    const other = rowLabelOf(rowCells(lines[i]));
    if (!other || norm(other) === norm(label)) continue;
    const theirs = benefitWords(other);
    const onlyTheirs = [...theirs].filter((w) => !mine.has(w)), onlyMine = [...mine].filter((w) => !theirs.has(w));
    if (onlyMine.length && onlyTheirs.some((w) => said.has(w)) && !onlyMine.some((w) => said.has(w))) return `the sentence names another row’s benefit (“${other}”), not the row the figure is printed on`;
  }
  return null;
}
/** The version dimension: the figure's column must be the version in force on the date the sentence is about. */
function versionProblem(dims: ColumnDimensions, headers: string[], doc: Doc | null, sentence: string | null, userText: string, row: { value: number; later: number[]; beforeLabels: string[] } = { value: NaN, later: [], beforeLabels: [] }): string | null {
  if (!dims.version || !versionPairOf(headers)) return null;
  const own = headers.map((h) => columnDimensions(h).version?.effective).find(Boolean) ?? null;
  const eff = dims.version.effective ?? own ?? (doc ? changeDateOf(doc) : null);
  const asOf = questionDate(sentence, userText, eff);
  const ends = doc && isAmendment(doc) ? doc.expiry : null;
  const v = versionInForce(asOf, eff, ends);
  if (dims.version.side === "after") {
    if (v.side === "after") return null;
    if (!v.side) return "the figure is the amended value, and " + v.reason;
    return `the figure is the amended value, which takes effect on ${eff}, after the date the sentence is about (${asOf})`;
  }
  if (v.side === "before") return null;
  // The earlier value of a change, presented as such next to the figure, with the later (in-force) value stated too.
  if (v.side === "after" && sentence != null && earlierValuePresented(sentence, row.value, row.beforeLabels, row.later)) return null;
  if (!v.side) return (eff ? `the figure is the value before the change effective ${eff}, and ` : "the figure is the earlier value, and ") + v.reason;
  return `the figure is the value before the change effective ${eff}, and the sentence states it for ${asOf}, when the amended value applies`;
}
/** An endorsement's link: it must amend a policy of this household that speaks for the person (same policy number,
 * and the policy number it prints, if any), and the sentence must not be about another of the household's policies. */
function amendmentProblem(doc: Doc, subjectId: string, sentence: string | null, ctx: Ctx): string | null {
  if (!isAmendment(doc)) return null;
  const own = normNo(doc.policyNumber);
  const named = amendedPolicyNumber(doc);
  if (named && own && named !== own) return "the endorsement names another policy than the one it is filed under";
  const key = named ?? own;
  if (!key) return "the endorsement does not say which policy it amends";
  const bases = ctx.house.filter((h) => h.id !== doc.id && normNo(h.policyNumber) === key && !/endorse|alteration|amendment/i.test(h.role ?? ""));
  if (!bases.length) return "the policy the endorsement amends is not one of this household’s documents";
  if (!bases.some((h) => h.members.has(subjectId))) return "the policy the endorsement amends does not cover the person the figure is stated for";
  if (sentence != null) {
    const lower = sentence.toLowerCase();
    const mine = new Set([...bases.flatMap((h) => brandWords(h.product)), ...brandWords(doc.product)]);
    const names = (w: string) => new RegExp("(?<![a-z0-9])" + w + "(?![a-z0-9])").test(lower);
    const other = ctx.house.filter((h) => normNo(h.policyNumber) !== key).flatMap((h) => brandWords(h.product)).filter((w) => !mine.has(w));
    if (other.some(names) && ![...mine].some(names)) return "the sentence is about another policy than the one the endorsement amends";
  }
  return null;
}
/** The currency a table's header names for the column the bare figure is printed in ("Benefit (S$)"). */
function columnCurrency(b: FigureBinding, rangeText: string): string | null {
  const lines = rangeText.split(/\n/);
  const at = lines.findIndex((l) => norm(l).includes(norm(b.passage).slice(0, 60)));
  for (let i = at - 1; i >= 0 && i >= at - 12; i--) { const named = currenciesStatedIn(lines[i]); if (named.length === 1) return named[0]; }
  return null;
}

/**
 * V1.5 (live verification: a policy wording printing "$2,000" bare): the currency a DOCUMENT itself declares for its
 * bare "$" amounts -- "All amounts are in Singapore Dollars", "Currency: SGD", "'$' means Singapore dollars". Source
 * identity is kept: only the same document's own declaration counts (never another document's "S$2,000", never an
 * assumption that "$" is SGD), and a document that also prints another explicit currency declares nothing.
 */
const DECLARES_SGD = [
  /\b(?:all\s+)?(?:monetary\s+)?(?:amounts?|sums?|benefits?|limits?|figures?|premiums?)\b[^.\n]{0,60}?\b(?:are|is|shall be|will be)\s+(?:shown\s+|stated\s+|expressed\s+|payable\s+|denominated\s+)?in\s+(?:Singapore\s+dollars?|SGD|S\$)/i,
  /\bcurrency\s*[:=]\s*(?:SGD|Singapore\s+dollars?)\b/i,
  /["“']?\$["”']?\s+(?:refers\s+to|means|denotes)\s+(?:the\s+)?(?:Singapore\s+dollars?|SGD)\b/i,
];
export function documentCurrency(text: string): "SGD" | null {
  if (!DECLARES_SGD.some((re) => re.test(text))) return null;
  if (/\b(?:US|A|NZ|HK|C)\$\s?\d|\b(?:USD|AUD|EUR|GBP|MYR|HKD|JPY|CNY|RM)\s?\d|[€£¥]\s?\d/.test(text)) return null;
  return "SGD";
}
/** Rule 2: is `value` in `currency` grounded by `b` (and, when `sentence` is given, for that sentence)? Null when it is. */
/** "the same benefit lists S$150,000", "that benefit is S$80": a sentence that refers back to the benefit named just before. */
const BENEFIT_BACK_REFERENCE = /\b(?:the same|that|this)\s+(?:benefit|item|row|cover)\b/i;
function groundProblem(b: FigureBinding | undefined, value: number, currency: string, ctx: Ctx, sentence: string | null, opts: { benefit?: string; previous?: string | null } = {}): string | null {
  if (!b || typeof b !== "object") return "the figure has no citation of its own";
  if (currency === "$") return "a bare $ names no currency";
  const doc = ctx.docs.get(b.policyId);
  if (!doc) return "the cited document is not one of this household’s active documents";
  if (!doc.usable) return "the cited document has not been released for reading";
  if (!b.documentHash || !doc.fileHash || b.documentHash !== doc.fileHash) return "the cited version of the document is not the one on file";
  if (doc.superseded && !(b.presentedAsSuperseded && sentence != null && SAYS_SUPERSEDED.test(sentence))) return "the cited document has been superseded and the sentence does not say so";
  if (!b.subjectId || !doc.members.has(b.subjectId)) return "the cited document does not speak for the person the figure is stated for";
  const subject = ctx.people.find((p) => p.id === b.subjectId);
  if (sentence != null) {
    // People the sentence names: the person bound must be one of them, and the document must speak for each.
    const lower = " " + sentence.toLowerCase().replace(/['’]s\b/g, " ").replace(/[^\p{L}\p{N} ]+/gu, " ") + " ";
    const named = ctx.people.filter((p) => p.names.some((n) => lower.includes(" " + n.toLowerCase() + " ")));
    if (named.length && (!named.some((p) => p.id === b.subjectId) || named.some((p) => !doc.members.has(p.id)))) return "the sentence is about someone the cited figure is not for";
  }
  const from = Math.trunc(Number(b.pageStart)), to = Math.trunc(Number(b.pageEnd ?? b.pageStart));
  if (!(from >= 1) || !(to >= from) || to - from > 5) return "the cited page range is not recorded";
  const range: string[] = [];
  for (let p = from; p <= to; p++) { const t = doc.pages.get(p); if (t == null) return "a cited page’s text is not stored"; range.push(t); }
  // (A page read by OCR from a scan may print "$$50,000" for "S$50,000": its repaired lines (scanned-text.ts, which repairs
  // only that sign) count as printed alongside the raw text, as in assertions.ts.)
  const rangeText = range.join("\n") + "\n" + cleanScannedText(range.join("\n"));
  const passage = norm(b.passage ?? "");
  if (passage.length < 3 || !norm(rangeText).includes(passage)) return "the cited passage is not on the cited pages";
  // (A passage read by OCR is read as printed and as repaired; OCR prints a table's cell break as " ; " -- one row.)
  const shown = (looksScanned(b.passage) ? cleanScannedLine(b.passage) ?? b.passage : b.passage).replace(/\s+;\s+/g, "\t");
  const how = [amountPrintedWith(value, currency, b.passage), amountPrintedWith(value, currency, shown)].sort((x, y) => RANK[x] - RANK[y])[0];
  if (how === "absent") return "the figure is not printed in the cited passage";
  if (how === "other") return "the figure is printed in another currency in the cited passage";
  if (how === "bare") { const named = currenciesStatedIn(shown); if (!(named.length === 1 && named[0] === currency)) { const c = columnCurrency(b, rangeText); if (c !== currency && documentCurrency([...doc.pages.values()].join("\n")) !== currency) return "the cited passage prints the figure without its currency"; } }
  let benefit = (opts.benefit ?? b.benefit ?? "").trim();
  if (!benefit) return "the figure is not bound to a benefit";
  // An item code bound as the benefit ("A", "4"): the benefit is the row's own name printed beside that code.
  if (isRowCode(benefit)) {
    const cells = rowCells(passageRows(shown).find((r) => amountAppears(value, r)) ?? "");
    if (cells.some((c) => c.trim().replace(/[.)]$/, "") === benefit.replace(/[.)]$/, ""))) benefit = rowLabelOf(cells);
  }
  // (A sentence that refers back to "the same benefit" names it when the sentence just before it names that benefit.)
  if (sentence != null && !namesBenefit(sentence, benefit) && !(BENEFIT_BACK_REFERENCE.test(sentence) && opts.previous != null && namesBenefit(opts.previous, benefit))) return "the sentence does not name the benefit the figure is printed for";
  if (sentence != null) { const other = otherRowProblem(sentence, value, shown, rangeText, benefit); if (other) return other; }
  // (A person's own row names the person, not the benefit: its product heading is checked with the row, below.)
  const row = b.layout === "person_row" ? null : benefitRowProblem(value, benefit, b.passage) && benefitRowProblem(value, benefit, shown);
  const column = columnProblem(b, value, currency, rangeText, subject, { ownerId: doc.owner, doc, sentence, userText: ctx.userText, people: ctx.people }) ?? amendmentProblem(doc, b.subjectId, sentence, ctx);
  if (row) {
    // A table whose rows are not benefits (a value table: one row per policy year, one column per value): the figure's
    // benefit is its own column (checked above), and the sentence names its row (the row's first cell).
    const first = rowCells(passageRows(b.passage).find((r) => amountAppears(value, r)) ?? "")[0] ?? "";
    const byColumn = !column && !!b.column && namesBenefit(b.column, benefit) && sentence != null && first.length > 0
      && (new RegExp("(?<![\\w.])" + first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w.])", "i").test(sentence) || (/[a-z]{4}/i.test(first) && namesBenefit(sentence, first)));
    if (!byColumn) return row;
  }
  return column;
}

// ---- round 8: a policy whose amendment document was removed ------------------------------------------------
/** A figure grounded on the remaining schedule of a policy whose amendment document was deleted / superseded (and not
 * replaced or explicitly reversed) is not confirmed current cover: the sentence (or the one just before it) must say
 * so -- unless it is about a date before that amendment took effect. */
function removalProblem(b: FigureBinding, sentence: string, previous: string | null, ctx: Ctx): string | null {
  const list = (ctx.removals.get(b.policyId) ?? []).filter((r): r is Extract<AmendmentRemoval, { kind: "amendment_removed" }> => r.kind === "amendment_removed");
  if (!list.length) return null;
  const asOf = questionDate(sentence, ctx.userText, null);
  const live = list.filter((r) => !r.effectiveDate || r.effectiveDate <= asOf);
  if (!live.length) return null;
  if (STATES_REMOVAL_LIMITATION.test(sentence) || (previous != null && STATES_REMOVAL_LIMITATION.test(previous))) return null;
  const r = live[0];
  return `an amendment document (${r.documentRole}) for this policy was ${r.removal === "deleted" ? "removed from the library" : "replaced"}${r.removedOn ? ` on ${r.removedOn}` : ""}, so the remaining schedule's figure is not confirmed current cover, and the sentence presents it without saying that the current amount may differ`;
}

// ---- rule 1: the household's own figures ------------------------------------------------------------------
const ATTRIBUTION = /\byou(?:['’]ve| have)? (?:asked about|mentioned|said|told (?:me|us)|wrote|reported|gave|quoted|entered|typed|noted|stated|put)\b|\baccording to you\b|\bin your (?:message|question)\b|\b(?:the )?(?:figure|amount|bill|number|sum) you (?:gave|mentioned|quoted|wrote|entered)\b/i;
const USER_FORBIDDEN = /\b(?:cover\w*|insured|assured|limits?|limited|caps?|capped|maximum|max|up to|pays|payable|payouts?|(?:will|would|could|can|may) (?:be )?pa(?:y|id)|reimburs\w*|claimable|entitle\w*|benefits?|totals?|totall?ing|altogether|in all|combined|add(?:s|ed)? up|sum insured|estimat\w*|refund\w*|compensat\w*|deductible|co-?insurance|excess|premiums?|polic(?:y|ies)|plan|schedule|insurer)\b/i;
function userProblem(f: StatedFigure, sentence: string, ctx: Ctx): string {
  const echoed = ctx.userFigures.some((u) => same(u.value, f.value) && u.currency === f.currency);
  if (!echoed) {
    if (ctx.userFigures.some((u) => same(u.value, f.value)) || ctx.userNumbers.some((n) => same(n, f.value))) return "the figure is the household’s own, but not in the currency they gave";
    return "the figure has no citation of its own";
  }
  // V1.3: the household's figure stated only to deny it ("... is S$200,000, not S$400,000") is their figure corrected,
  // never presented as cover.
  if (f.raw && new RegExp(`(?:\\bnot|n['’]t|\\brather than|\\binstead of)\\s+(?:the\\s+|your\\s+)?${f.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d,]*\\d)`, "i").test(sentence)) return "";
  if (!ATTRIBUTION.test(sentence)) return "a figure from the household’s message is stated without saying it is theirs";
  if (USER_FORBIDDEN.test(sentence)) return "a figure from the household’s message cannot state cover, a limit, a payable amount, a premium or a total";
  return "";
}

// ---- rule 3: computed figures -----------------------------------------------------------------------------
const PERIOD_WORDS: Partial<Record<FigurePeriod, RegExp>> = { month: /\bmonth(?:ly)?\b/i, year: /\byears?\b|\bannual(?:ly)?\b|\byearly\b|\bp\.\s?a\./i, quarter: /\bquarter(?:ly)?\b/i, half_year: /\bhalf[- ]?year(?:ly)?\b|\bsemi-?annual/i, week: /\bweek(?:ly)?\b/i };
export function roundBy(x: number, mode: ComputationRecord["rounding"]["mode"], precision: number): number {
  const k = 10 ** precision, y = x * k, eps = 1e-7;
  switch (mode) {
    case "half_up": return Math.sign(y) * Math.floor(Math.abs(y) + 0.5 + eps) / k;
    case "half_even": { const a = Math.abs(y), f = Math.floor(a), d = a - f; const r = d > 0.5 + eps ? f + 1 : d < 0.5 - eps ? f : (f % 2 === 0 ? f : f + 1); return Math.sign(y) * r / k; }
    case "down": return Math.sign(y) * Math.floor(Math.abs(y) + eps) / k;
    case "up": return Math.sign(y) * Math.ceil(Math.abs(y) - eps) / k;
    default: return x;
  }
}
type Computed = { value: number; period: FigurePeriod | null; subjects: Set<string>; roles: Set<string>; user: boolean } | { error: string };
function compute(r: ComputationRecord, sentence: string, ctx: Ctx, depth: number): Computed {
  if (!r || typeof r !== "object" || depth > 3) return { error: "the computation record is missing" };
  const ops = Array.isArray(r.operands) ? r.operands : [];
  if (!ops.length) return { error: "the computation has no operands" };
  if (!r.currency || r.currency === "$" || r.result?.currency !== r.currency) return { error: "the computation does not state one currency" };
  const round = r.rounding;
  if (!round || !["half_up", "half_even", "down", "up", "none"].includes(round.mode) || !Number.isInteger(round.precision) || round.precision < 0 || round.precision > 4) return { error: "the computation does not state its rounding" };
  const vals: number[] = [], periods: (FigurePeriod | null)[] = [], subjects = new Set<string>(), roles = new Set<string>();
  let users = 0;
  for (const o of ops) {
    if (!o || o.currency !== r.currency) return { error: "the operands are not all in the computation’s currency" };
    if ([o.binding, o.user, o.computation].filter(Boolean).length !== 1) return { error: "an operand is neither a cited figure, the household’s own figure nor a recorded computation" };
    if (o.binding) {
      if (o.role !== "premium" && o.role !== "benefit") return { error: "a cited operand has no role" };
      const g = groundProblem(o.binding, o.value, o.currency, ctx, null);
      if (g) return { error: "an operand is not grounded: " + g };
      if (o.binding.presentedAsSuperseded || ctx.docs.get(o.binding.policyId)?.superseded) return { error: "a superseded figure cannot be an operand" };
      // The period the passage prints beside the figure is the operand's.
      const printed = printedPeriodsOf(o.value, o.currency, o.binding.passage);
      const declared = o.period ?? null;
      if (printed.some((p) => p != null) && !printed.includes(declared)) return { error: "an operand’s period is not the one its passage prints" };
      // A premium is a premium on its own row; a benefit never is.
      const row = passageRows(o.binding.passage).filter((x) => amountAppears(o.value, x)).join(" ") + " " + o.binding.benefit;
      if ((o.role === "premium") !== /\bpremiums?\b/i.test(row)) return { error: "an operand’s role is not what its passage prints" };
      subjects.add(o.binding.subjectId); roles.add(o.role); vals.push(o.value); periods.push(declared);
    } else if (o.user) {
      if (o.role !== "user") return { error: "the household’s own figure cannot be a policy figure" };
      const p = userProblem({ raw: "", value: o.value, currency: o.currency }, sentence, ctx);
      if (p) return { error: p };
      users++; roles.add("user"); vals.push(o.value); periods.push(o.period ?? null);
    } else {
      const c = compute(o.computation!, sentence, ctx, depth + 1);
      if ("error" in c) return c;
      const res = o.computation!.result;
      if (!same(res.value, o.value) || res.currency !== o.currency) return { error: "a nested computation’s result is not its operand" };
      for (const s of c.subjects) subjects.add(s);
      for (const x of c.roles) roles.add(x);
      if (c.user) users++;
      vals.push(o.value); periods.push(c.period);
    }
  }
  if (users && users !== ops.length) return { error: "the household’s own figures cannot be combined with policy figures" };
  if (roles.size > 1) return { error: "the operands are different kinds of figure (premium, benefit)" };
  const period0 = periods[0];
  let value: number, period: FigurePeriod | null = r.period ?? null;
  const allSame = periods.every((p) => p === period0) && period0 === (r.period ?? null);
  switch (r.operation) {
    case "sum":
      if (ops.length < 2) return { error: "a sum needs two or more operands" };
      if (!allSame) return { error: "the operands are not all per the same period" };
      value = vals.reduce((a, b) => a + b, 0); break;
    case "difference":
      if (ops.length !== 2) return { error: "a difference needs exactly two operands" };
      if (!allSame) return { error: "the operands are not all per the same period" };
      value = vals[0] - vals[1]; break;
    case "product":
    case "divide": {
      const k = r.factor;
      if (ops.length !== 1 || !Number.isInteger(k) || !(k! >= 2) || k! > 100) return { error: "a multiple or share needs one operand and a whole-number factor" };
      if (!allSame) return { error: "the operand is not per the computation’s period" };
      if (!new RegExp("(?<![\\d.,])" + k + "(?![\\d.,])").test(sentence) && !(r.operation === "divide" && /\b(?:half|halves)\b/i.test(sentence) && k === 2)) return { error: "the sentence does not state the factor" };
      value = r.operation === "product" ? vals[0] * k! : vals[0] / k!; break;
    }
    case "per_period": {
      const from = r.fromPeriod, to = r.toPeriod;
      if (ops.length !== 1 || !from || !to || from === to) return { error: "a per-period conversion needs one operand and two periods" };
      const f = periodFactor(from, to);
      if (f == null || r.factor !== f) return { error: "the per-period conversion factor is not the one between " + from + " and " + to };
      if (period0 !== from || (r.period ?? from) !== from) return { error: "the operand is not per the period converted from" };
      if (!PERIOD_WORDS[to]?.test(sentence)) return { error: "the sentence does not say the period it converts to" };
      value = PER[to]! > PER[from]! ? vals[0] / f : vals[0] * f; period = to; break;
    }
    default: return { error: "the computation’s operation is not one the gate knows" };
  }
  if ((r.operation === "sum" || r.operation === "difference") && subjects.size > 1 && !(r.scope === "household" && /\b(?:household|family|everyone|all of you)\b/i.test(sentence))) return { error: "figures for different people are combined without stating a household total" };
  const rounded = roundBy(value, round.mode, round.precision);
  if (!same(rounded, r.result.value) && !(round.mode === "none" && Math.abs(rounded - r.result.value) < 1e-9)) return { error: "the stated result is not the recomputed one with the stated rounding" };
  return { value: rounded, period, subjects, roles, user: users > 0 };
}
function computationProblem(r: ComputationRecord, f: StatedFigure, sentence: string, ctx: Ctx): string | null {
  if (!same(r.result?.value, f.value) || r.result?.currency !== f.currency) return "the sentence’s figure is not the computation’s result";
  const c = compute(r, sentence, ctx, 0);
  return "error" in c ? c.error : null;
}

// ---- rule 4: benefit calculations (CalculationRecord, types/index.ts) -------------------------------------------
// An illustration or indicative estimate of a benefit stands only with a record the gate re-runs here: every step
// recomputed with the claim calculators' own arithmetic (lib/claims/calc-record.ts); every document operand grounded
// under rule 1 AND bound to the record's person, policy and version, on its row and in its column; every household
// input quoted verbatim from the household's own messages; every condition's status checked (an estimate needs every
// condition established or not applicable; a day-count step must use the rule the cited wording states); and the
// sentence worded as what it is (an estimate says so and is never a payout or a total; an illustration says "if" and
// answers a what-if the household asked). A number merely printed on the cited page never validates a calculation.
/** "this is not a confirmed payout", "isn't guaranteed": a negated payout / guarantee says the opposite of one. */
const CALC_NEGATED_PAYOUT = /\b(?:not|isn['’]t|aren['’]t|never)\s+(?:an?\s+)?(?:(?:confirmed|guaranteed|final|promised|actual)\s+)?(?:pay-?outs?|guarantee(?:d|s)?|payments?)\b|\bno guarantee\b/gi;
const CALC_PAYOUT = /\bpay-?outs?\b|\bwill (?:be )?pa(?:y|id)\b|\byou(?:’|')?ll (?:get|receive)\b|\byou will (?:get|receive)\b|\bguarantee\w*\b/i;
const CALC_TOTAL = /\b(?:totals?|totall?ing|altogether|combined|in all|add(?:s|ed)? up)\b/i;
const CALC_ATTRIBUTED = /\byour (?:own )?(?:figures?|bill|amount|dates?|times?|words)\b|\b(?:as )?you (?:gave|told|said|mentioned|quoted|wrote)\b|\bthe (?:bill|amount|dates?|times?) you\b/i;
const WHAT_IF = /\bwhat if\b|\bif\b|\bsuppose\b|\bsupposing\b|\bhypothetical\w*\b|\bwere to\b|\bsay (?:he|she|they|i|we)\b/i;
const squash = (t: string) => normalPassage(t ?? "").replace(/\s+/g, " ").trim();
/** A short follow-on ("and a broken toe?", "what about Cai?") continues the household's previous message. */
const FOLLOW_ON = /^\s*(?:and|or|also|then|what about|how about)\b|^\s*[^.?!]{1,40}\?\s*$/i;
function asksWhatIf(ctx: { userText: string; householdTexts: string[] }): boolean {
  if (WHAT_IF.test(ctx.userText)) return true;
  const prior = ctx.householdTexts.filter((t) => t && squash(t) !== squash(ctx.userText));
  const last = prior[prior.length - 1];
  return !!last && WHAT_IF.test(last) && FOLLOW_ON.test(ctx.userText);
}
const numsOf = (t: string) => (t.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
function quotedBy(words: string, texts: string[]): boolean {
  const w = squash(words);
  return w.length >= 2 && texts.some((t) => squash(t).includes(w));
}
/** Integration (r7): `endorsementId` is an endorsement of the calculation's own policy (same policy number, not itself
 * an endorsement), linked to this household's policy for the calculation's person. */
function endorsesPolicy(endorsementId: string, r: CalculationRecord, ctx: Ctx): boolean {
  const e = ctx.docs.get(endorsementId), base = ctx.docs.get(r.policyId);
  if (!e || !base || !isAmendment(e) || isAmendment(base)) return false;
  const key = amendedPolicyNumber(e) ?? normNo(e.policyNumber);
  if (!key || normNo(base.policyNumber) !== key) return false;
  return !amendmentProblem(e, r.subjectId, null, ctx);
}
/** Round 9: two documents of the same policy -- a group certificate and its policy wording -- share a policy or group
 * policy number (the calculator's own family rule: policyFamily in the conversation tools' store). */
function samePolicyFamily(a: string, b: string, ctx: Ctx): boolean {
  const x = ctx.docs.get(a), y = ctx.docs.get(b);
  if (!x || !y) return false;
  const keys = (d: Doc) => [normNo(d.policyNumber), normNo(d.groupPolicyNumber)].filter((k) => k.length >= 4);
  const kx = keys(x);
  return kx.length > 0 && keys(y).some((k) => kx.includes(k));
}
function docOperandProblem(o: Extract<CalcOperand, { source: "document" }>, r: CalculationRecord, ctx: Ctx): string | null {
  const b = o.binding;
  if (!b) return `${o.label}: a document figure without its own binding`;
  // Integration (r7): an endorsement's in-force figure may serve a calculation on the policy it amends (the same policy
  // number, the endorsement linked to this household's policy for the person); any other document is refused.
  const viaEndorsement = b.policyId !== r.policyId && endorsesPolicy(b.policyId, r, ctx);
  // Round 9: a figure from another document of the same policy (the wording's percentage for the certificate's sum
  // assured) serves the calculation as that document's own figure: its version is that document's, and it must speak
  // for the person.
  const viaFamily = b.policyId !== r.policyId && !viaEndorsement && samePolicyFamily(b.policyId, r.policyId, ctx) && !!ctx.docs.get(b.policyId)?.members.has(r.subjectId);
  if (b.policyId !== r.policyId && !viaEndorsement && !viaFamily) return `${o.label}: bound to another document than the calculation’s`;
  if (b.subjectId !== r.subjectId) return `${o.label}: bound to another person than the calculation’s`;
  if (viaFamily) { const d = ctx.docs.get(b.policyId)!; if (!b.documentHash || b.documentHash !== d.fileHash) return `${o.label}: bound to another version of that document than the one on file`; }
  else if (viaEndorsement) { const e = ctx.docs.get(b.policyId)!; if (!b.documentHash || b.documentHash !== e.fileHash) return `${o.label}: bound to another version of the endorsement than the one on file`; }
  else if ((b.documentHash ?? null) !== (r.documentHash ?? null)) return `${o.label}: bound to another version than the calculation’s`;
  if ((o.column ?? null) !== (b.column ?? null)) return `${o.label}: the stated column is not the binding’s`;
  if (o.row && !squash(b.passage).includes(squash(o.row).slice(0, 40))) return `${o.label}: the stated row is not the bound passage`;
  // A column printed for a class of person (Adult / Child) must be the person's own class.
  // Agent G: explicit classes -- an adult never takes a child / ambiguous / unrecognised column, and a person whose class
  // is not established never takes a class-specific one.
  const cls = classProblem(b.column, ctx.people.find((p) => p.id === b.subjectId), ctx.docs.get(b.policyId)?.owner ?? null);
  if (cls) return `${o.label}: ${cls}`;
  if (o.unit === "money") {
    if (o.currency !== r.currency) return `${o.label}: in another currency than the calculation`;
    const g = groundProblem(b, o.value, o.currency ?? "", ctx, null, { benefit: b.benefit });
    return g ? `${o.label}: ${g}` : null;
  }
  // A printed count (days) or percentage: the same document checks, the number printed in the passage, in the column.
  const doc = ctx.docs.get(b.policyId);
  if (!doc || !doc.usable) return `${o.label}: the cited document is not one of this household’s released documents`;
  if (!b.documentHash || b.documentHash !== doc.fileHash) return `${o.label}: the cited version of the document is not the one on file`;
  if (doc.superseded) return `${o.label}: the cited document has been superseded`;
  if (!doc.members.has(b.subjectId)) return `${o.label}: the cited document does not speak for the person`;
  const range: string[] = [];
  for (let p = b.pageStart; p <= b.pageEnd; p++) { const t = doc.pages.get(p); if (t == null) return `${o.label}: a cited page’s text is not stored`; range.push(t); }
  if (!norm(range.join("\n")).includes(norm(b.passage))) return `${o.label}: the cited passage is not on the cited pages`;
  if (!numsOf(b.passage).some((n) => same(n, o.value as number))) return `${o.label}: the number is not printed in the cited passage`;
  if (o.unit === "percent" && !new RegExp("(?<![\\d.])" + String(o.value).replace(".", "\\.") + "\\s?%").test(b.passage)) return `${o.label}: the percentage is not printed as a percentage`;
  const col = columnProblem(b, o.value as number, "", range.join("\n"), ctx.people.find((p) => p.id === b.subjectId), { count: true, ownerId: doc.owner, doc, userText: ctx.userText }) ?? amendmentProblem(doc, b.subjectId, null, ctx);
  return col ? `${o.label}: ${col}` : null;
}
/** V1.1: the one day-count convention an illustration may assume when the wording states none -- always as its stated
 * assumption, never as a term of the policy. */
const DAY_ASSUMED_24H = "assuming each complete 24 hours in hospital counts as one day";
const DURATION_WORDS = /\b(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|a couple of|a few)\s+(?:full\s+|whole\s+)?(?:days?|nights?|weeks?|hours?)\b/i;
const STATES_ASSUMPTION = /\bif you mean\b|\bassum(?:e|es|ed|ing|ption)\b|\bsuppos(?:e|ing)\b|\bhypothetical\w*\b|\bfor (?:that|this|such an?) (?:assumed|hypothetical)\b/i;
const MONTH_WORDS: [RegExp, number][] = ["jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "june?", "july?", "aug(?:ust)?", "sep(?:t(?:ember)?)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?"].map((w, i) => [new RegExp("\\b" + w + "\\b", "i"), i + 1]);
/** An assumed date (what-if) must fall inside the period the household's own words name: the exact date they gave, or
 * the month (and year, if they gave one) they named. Null when it does. */
export function assumedDateProblem(words: string, isoDay: string): string | null {
  // (datesIn reads a bare "August 2026" as its first day: only a date the words give with its day counts as exact.)
  const exact = datesIn(words).filter((d) => !d.endsWith("-01") || /\b0?1(?:st)?\s+[A-Za-z]{3}|[A-Za-z]{3,}\.?\s+0?1(?:st)?\b|\d{4}-\d{2}-01\b|\b0?1\/\d{1,2}\/\d{4}/.test(words));
  if (exact.length) return exact.includes(isoDay) ? null : "the assumed date is not the date in the household’s words";
  const months = MONTH_WORDS.filter(([re]) => re.test(words)).map(([, n]) => n);
  if (!months.length) return "the assumed date is not inside a period the household named";
  const [y, mo] = isoDay.split("-").map(Number);
  const years = (words.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number);
  if (!months.includes(mo) || (years.length && !years.includes(y))) return "the assumed date is outside the period the household named";
  return null;
}
/** Re-runs one benefit calculation for one sentence; null when it stands. */
export function calculationProblem(r: CalculationRecord, sentence: string, ctx: Ctx): string | null {
  if (!r || typeof r !== "object" || !Array.isArray(r.operands) || !Array.isArray(r.conditions)) return "the calculation record is malformed";
  if (r.kind !== "indicative_estimate" && r.kind !== "conditional_illustration") return "the calculation’s kind is not an illustration or an indicative estimate";
  if (!r.subjectId || !r.policyId || !r.benefit) return "the calculation does not name its person, policy and benefit";
  // Wording.
  if (CALC_PAYOUT.test(sentence.replace(CALC_NEGATED_PAYOUT, " "))) return "a calculated benefit is stated as a payout";
  if (r.kind === "indicative_estimate") {
    if (!/\bindicative estimate\b/i.test(sentence)) return "an indicative estimate is not labelled as one";
    if (CALC_TOTAL.test(sentence)) return "an indicative estimate is stated as (part of) a total";
    // Integration (r6): an estimate resting on a stated assumption (earlier use of a capped allowance) must say it.
    if (r.assumption?.trim() && !norm(sentence).includes(norm(r.assumption))) return "the estimate does not state its assumption (" + r.assumption.trim() + ")";
  } else {
    if (!/\bif\b/i.test(sentence)) return "an illustration does not state its what-if";
    // Assumed times (marked source "assumption" on the record) resolve a stay the household gave only as a duration
    // ("exactly 3 days in August"): accepted when their words with that duration are quoted from this message.
    const assumedTimes = r.operands.filter((o) => o?.source === "assumption" && (o.unit === "date" || o.unit === "datetime"));
    const resolvesDuration = assumedTimes.length > 0 && assumedTimes.every((o) => o.source === "assumption" && DURATION_WORDS.test(o.attribution ?? "") && quotedBy(o.attribution, [ctx.userText]));
    // V1.1: a what-if is the household's own -- asked in this message, carried by a short follow-on to one they just
    // asked ("and a broken toe?"), or the event they reported, quoted as the illustration's stated assumption.
    const assumedOps = r.operands.filter((o) => o?.source === "assumption");
    // (A stay given with its actual dates or times is an estimate on those inputs, never an illustration: assumed inputs
    // stand only for a stay the household gave as a length, with no date, month, year or time.)
    const lengthOnlyWords = (w: string) => DURATION_WORDS.test(w) && !MONTH_WORDS.some(([re]) => re.test(w)) && !/\b(?:19|20)\d{2}\b|\d{4}-\d{2}-\d{2}|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/i.test(w);
    const reported = (r.calculator === "lump_sum" && !!r.assumption?.trim() && quotedBy(r.assumption, ctx.householdTexts)) || (assumedOps.length > 0 && assumedOps.every((o) => quotedBy(o.attribution ?? "", ctx.householdTexts) && lengthOnlyWords(o.attribution ?? "")));
    if (!asksWhatIf(ctx) && !resolvesDuration && !reported) return "an illustration is given though the household did not ask a what-if";
    // Never the figure for their actual stay: times WE assumed for a duration they gave are stated as an assumption
    // ("If you mean exactly 72 hours ..."); a what-if in their own times is stated by its own "if" clause.
    if (resolvesDuration && !STATES_ASSUMPTION.test(sentence)) return "an illustration does not state the times it assumes";
  }
  // Operands.
  for (const o of r.operands) {
    if (!o || typeof o !== "object") return "an operand is malformed";
    if (o.source === "document") { const p = docOperandProblem(o, r, ctx); if (p) return p; continue; }
    if (o.source !== "household" && o.source !== "assumption") return "an operand is neither a document figure nor the household’s own";
    if (!o.attribution?.trim()) return `${o.label}: the household’s words are not recorded`;
    if (o.source === "assumption") {
      if (r.kind !== "conditional_illustration") return `${o.label}: an assumed figure in an estimate`;
      if (!quotedBy(o.attribution, [ctx.userText])) return `${o.label}: the what-if is not in the household’s message`;
    } else if (!quotedBy(o.attribution, ctx.householdTexts)) return `${o.label}: the household’s words are not in their messages`;
    if (o.unit === "money" || o.unit === "count") {
      if (!numsOf(o.attribution).some((n) => same(n, o.value as number))) return `${o.label}: the figure is not the one in the household’s words`;
      if (o.unit === "money" && moneyFiguresIn(sentence).some((f) => same(f.value, o.value as number)) && !CALC_ATTRIBUTED.test(sentence) && !ATTRIBUTION.test(sentence) && o.source === "household") return `${o.label}: the household’s figure is stated without saying it is theirs`;
    } else {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(o.value));
      if (!m) return `${o.label}: the date is not the one in the household’s words`;
      if (o.source === "assumption") {
        // V1.1: a what-if that gives only a length of stay ("if she's warded 5 days"), illustrated under the stated
        // complete-24-hours assumption, depends on that length only: the assumed dates just place it -- accepted when
        // they span exactly that many days and the words name no date, month or year.
        const len = (o.attribution.match(DURATION_WORDS)?.[0] ?? "");
        const n = numsOf(len)[0];
        const adm = r.operands.find((x) => x.role === "admission"), dis = r.operands.find((x) => x.role === "discharge");
        const span = adm && dis ? (Date.parse(String(dis.value)) - Date.parse(String(adm.value))) / 3_600_000 : NaN;
        const lengthOnly = r.conditions.some((c) => c.kind === "day_count_rule" && c.status === "unresolved" && !c.passage) && norm(r.assumption ?? "").includes(norm(DAY_ASSUMED_24H)) && /\bdays?\b/i.test(len) && n > 0 && span === n * 24
          && !MONTH_WORDS.some(([re]) => re.test(o.attribution)) && !/\b(?:19|20)\d{2}\b|\d{4}-\d{2}-\d{2}/.test(o.attribution);
        const p = lengthOnly ? null : assumedDateProblem(o.attribution, m[0]); if (p) return `${o.label}: ${p}`;
      }
      else if (!numsOf(o.attribution).some((n) => n === Number(m[3]))) return `${o.label}: the date is not the one in the household’s words`;
    }
  }
  // Steps.
  const re = recomputeCalculation(r);
  if (!re.ok) return re.error;
  // Integration (r6): the rate's unit terms re-read from their spans on the stored pages (records made before r6
  // carry none and are checked as before).
  if (r.unitTerms) { const u = checkUnitTerms(r, (pid, p) => ctx.docs.get(pid)?.pages.get(p)); if (u) return u; }
  // Conditions.
  const ruleCond = r.conditions.find((c) => c.kind === "day_count_rule");
  for (const c of r.conditions) {
    if (!c || !["established", "unresolved", "not_applicable"].includes(c.status)) return "a condition has no status";
    if (c.status === "unresolved") { if (r.kind === "indicative_estimate") return `a condition is unresolved: ${c.text}`; continue; }
    if (c.basis === "document") {
      // Round 8e: or an active amendment document of the same policy (same policy number) -- e.g. an endorsement that
      // restates the admission-day exception from its effective date.
      const own = ctx.docs.get(r.policyId);
      const pol = (d: { policyNumber: string | null } | undefined) => (d?.policyNumber ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const other = c.passage && c.passage.policyId !== r.policyId ? ctx.docs.get(c.passage.policyId) : null;
      const amending = !!other && !!own && pol(other).length >= 4 && pol(other) === pol(own) && isAmendmentRole(other.role) && c.kind === "day_count_rule";
      const doc = amending ? other! : own;
      if (!c.passage || (c.passage.policyId !== r.policyId && !amending) || !doc) return `a condition’s passage is not from the calculation’s document: ${c.text}`;
      const pages: string[] = []; for (let p = c.passage.pageStart; p <= c.passage.pageEnd; p++) pages.push(doc.pages.get(p) ?? "");
      if (!norm(pages.join("\n")).includes(norm(c.passage.text))) return `a condition’s passage is not on its page: ${c.text}`;
    } else if (c.basis === "household") {
      if (!c.householdWords || !quotedBy(c.householdWords, ctx.householdTexts)) return `a condition settled by the household is not in their messages: ${c.text}`;
    } else if (c.basis === "derived") {
      if (c.kind !== "minimum_stay" || !c.passage) return `a condition cannot be derived: ${c.text}`;
      const hours = numsOf(c.passage.text)[0];
      const adm = r.operands.find((o) => o.role === "admission"), dis = r.operands.find((o) => o.role === "discharge");
      const span = adm && dis ? (Date.parse(String(dis.value)) - Date.parse(String(adm.value))) / 3_600_000 : NaN;
      if (!(span >= hours)) return `the minimum stay is not met: ${c.text}`;
    } else if (c.basis === "assumption") {
      // Integration (r6): only earlier use of a capped allowance, only in an estimate that states the assumption.
      if (r.kind !== "indicative_estimate" || !/_prior_use$/.test(c.id) || !r.assumption?.trim()) return `a condition is settled by an assumption the estimate does not state: ${c.text}`;
    } else if (c.basis === "absent") {
      if (c.status !== "not_applicable") return `a condition the document does not print is marked established: ${c.text}`;
    } else return `a condition has no basis: ${c.text}`;
  }
  for (const st of r.steps) {
    if (st.op === "day_count") {
      // V1.1: a what-if on wording that states no rule may assume complete 24-hour days -- stated in the sentence (checked
      // with the conditions above), never anything else, and never with day exceptions.
      // V1.1: wording that states no rule leaves the rule UNRESOLVED on the record; an illustration may still count
      // complete 24-hour days when its stated assumption (in the record and in the sentence itself) says so.
      const assumedRule = !!ruleCond && r.kind === "conditional_illustration" && ruleCond.status === "unresolved" && !ruleCond.passage && st.rule === "completed_24h" && !(st.edges ?? []).length && norm(r.assumption ?? "").includes(norm(DAY_ASSUMED_24H)) && norm(sentence).includes(norm(DAY_ASSUMED_24H));
      if (assumedRule) continue;
      if (!ruleCond || ruleCond.status !== "established" || ruleCond.basis !== "document" || !ruleCond.passage) return "the day count uses a rule the cited wording does not establish";
      const said = dayRuleFromWording(ruleCond.passage.text);
      if (!said || said.rule !== st.rule) return "the day count uses another rule than the cited wording states";
      // Integration (r7): the remainder rule's hours are the wording's own (the recompute uses the record's).
      if (st.rule === "completed_24h_remainder" && (said.remainderHours ?? null) !== (st.remainderHours ?? null)) return "the day count counts a remaining part from another number of hours than the cited wording states";
      // Integration (D30): every admission / discharge-day exception applied must be stated by an established passage.
      const stated = r.conditions.filter((c) => c.kind === "day_count_rule" && c.status === "established" && c.basis === "document" && c.passage).flatMap((c) => dayEdgeExceptionsFromWording(c.passage!.text));
      for (const e of st.edges ?? []) if (!stated.some((x) => x.edge === e.edge && x.when === e.when && x.minutes === e.minutes)) return `the day count applies a ${e.edge}-day exception the cited wording does not state`;
      // Round 8e: an exception repeated in the record counts once (the recompute dedupes), and two different exceptions
      // for the same day -- in the record or in its cited wording -- are a conflict, never one picked.
      const applied = distinctDayEdges(st.edges ?? []);
      if (!("edges" in applied)) return `the day count applies different ${("conflict" in applied ? applied.conflict[0]?.edge : null) ?? "admission / discharge"}-day exceptions`;
      for (const e of applied.edges) if (stated.some((x) => x.edge === e.edge && !(x.when === e.when && x.minutes === e.minutes))) return `the cited wording states different ${e.edge}-day exceptions, and which one applies is not established`;
    }
    if (st.op === "days_after_waiting") {
      const w = r.conditions.find((c) => c.kind === "waiting_period" && c.status === "established" && c.basis === "document");
      if (!w?.passage || !numsOf(w.passage.text).some((n) => n === st.waitingDays || n === st.waitingDays + 1)) return "the waiting days are not the ones the cited wording prints";
    }
  }
  // Any day count must come from dates (never a household number of nights).
  if (r.calculator === "hospital_cash" && !r.steps.some((st) => st.op === "day_count")) return "hospital cash days are not counted from the admission and discharge under the policy’s rule";
  return null;
}
/** Money figures a verified calculation states: its result, its document amounts, its steps' amounts, and the
 * household's own amounts. */
function calculationFigures(r: CalculationRecord): number[] {
  const re = recomputeCalculation(r);
  const out: number[] = [r.result.value];
  for (const o of r.operands) if (o.unit === "money" && typeof o.value === "number") out.push(o.value);
  if (re.ok) for (const [, v] of re.values) if (v.unit === "money") out.push(v.n / 100);
  return out;
}

type Page = { policyId: string; page: number; text: string; current: boolean };
export type FigureProblem = { where: string; figure: string; sentence: string; reason: string };

/** Checks (and, unless `report`, repairs in place) every money figure and cover statement of an answer. */
export async function verifyAnswerFigures(answer: ChatAnswer, opts: { accountId: string; userText?: string; report?: boolean; priorUserTexts?: string[] }): Promise<FigureProblem[]> {
  if (!answer || typeof answer !== "object") return [];
  const fields: { where: string; get: () => string; set: (v: string) => void }[] = [
    { where: "summary", get: () => answer.summary ?? "", set: (v) => { answer.summary = v; } },
    ...(answer.details ?? []).map((_, i) => ({ where: "details[" + i + "]", get: () => answer.details[i] ?? "", set: (v: string) => { answer.details[i] = v; } })),
    ...(answer.nextSteps ?? []).map((_, i) => ({ where: "nextSteps[" + i + "]", get: () => answer.nextSteps[i] ?? "", set: (v: string) => { answer.nextSteps[i] = v; } })),
    ...(answer.claimItems ?? []).map((_, i) => ({ where: "claim[" + i + "].reason", get: () => answer.claimItems[i]?.reason ?? "", set: (v: string) => { answer.claimItems[i].reason = v; } })),
  ];
  // V1.5: names quoted from the library record (file / document names in an inventory) are not figures.
  const names = [...new Set((answer.libraryNames ?? []).filter((n) => typeof n === "string" && n.trim().length >= 3))].sort((a, b) => b.length - a.length);
  const unnamed = (s: string) => names.reduce((t, n) => t.split(n).join(" "), s);
  const all = fields.flatMap((f) => sentencesOf(f.get()).map((s) => ({ field: f, sentence: s, figures: moneyFiguresIn(unnamed(s)) })));
  const anyFigure = all.some((x) => x.figures.length);
  const anyCover = all.some((x) => COVER_CLAIM.test(x.sentence.trim()));
  if (!anyFigure && !anyCover && !answer.policyStatedLimits?.length && !all.some((x) => SAYS_NOT_AMENDED.test(x.sentence) || CLAIMS_REMOVAL.test(x.sentence))) return [];
  const ctx = await loadContext(opts.accountId, answer, opts.userText ?? "", opts.priorUserTexts ?? []);
  const problems: FigureProblem[] = [];
  const debug = gateDebug();
  // A policy-stated limit card stands only with its own binding, grounded for its benefit.
  if (answer.policyStatedLimits?.length) answer.policyStatedLimits = answer.policyStatedLimits.filter((l) => {
    const why = typeof l.amount !== "number" || !l.currency ? "the limit has no amount or currency"
      : !l.binding ? "the limit card has no binding of its own"
      : l.binding.policyId !== l.citation?.policyId ? "the limit card’s binding is not its citation"
      : groundProblem(l.binding, l.amount, l.currency, ctx, null, { benefit: l.benefitTitle });
    if (why) problems.push({ where: "policyStatedLimits", figure: l.amountText, sentence: l.benefitTitle, reason: why });
    if (why && debug) process.stderr.write("[figure-gate-card] " + JSON.stringify([l.benefitTitle, l.ownerName, l.amount, l.citation?.pageStart, (l.quote ?? "").slice(0, 100), l.binding ? [l.binding.benefit, l.binding.passage.slice(0, 80)] : null]) + "\n");
    return !why || !!opts.report;
  });
  const bindings = answer.figureBindings ?? [], computations = answer.computations ?? [], calculations = answer.calculations ?? [];
  const verdicts = new Map<CalculationRecord, string | null>();
  const calcVerdict = (k: CalculationRecord, sentence: string) => { if (!verdicts.has(k)) verdicts.set(k, calculationProblem(k, sentence, ctx)); return verdicts.get(k)!; };
  // A sentence whose calculation fails is replaced by that calculation's specific unresolved requirement.
  const requirements = new Map<string, string>();
  // Integration (D29): the replacement text claims missing information only for an unresolved calculation; for a
  // resolved one (estimate / illustration) it names the specific verification failure.
  const safeText = (t: string) => !!t && !moneyFiguresIn(t).length && !/\d{2,}/.test(t.replace(/\b(?:19|20)\d{2}\b/g, ""));
  const requirementFor = (x: { sentence: string }, k: CalculationRecord, why?: string) => {
    const resolved = k.kind === "indicative_estimate" || k.kind === "conditional_illustration";
    let t = (k.unresolvedText ?? "").trim();
    if (resolved && (!t || /\bI still need\b/i.test(t))) t = "I worked out that figure, but I couldn’t confirm it against your documents.";
    if (resolved && why) { const w = why.trim().replace(/[.\s]+$/, ""); const withWhy = t.replace(/ against your documents\.$/, ` against your documents (${w}).`); if (withWhy !== t && safeText(withWhy)) t = withWhy; }
    if (safeText(t)) requirements.set(x.sentence, t);
  };
  const drop = new Map<typeof fields[number], Set<string>>();
  const bad = (x: typeof all[number], figure: string, reason: string) => { problems.push({ where: x.field.where, figure, sentence: x.sentence, reason }); (drop.get(x.field) ?? drop.set(x.field, new Set()).get(x.field)!).add(x.sentence); };
  const previousOf = (x: typeof all[number]) => { const i = all.indexOf(x); return i > 0 && all[i - 1].field === x.field ? all[i - 1].sentence : null; };
  /** The sentence read just before, in the order shown (the summary, then each detail). */
  const precedingOf = (x: typeof all[number]) => { const i = all.indexOf(x); return i > 0 ? all[i - 1].sentence : null; };
  // Round 8: a policy whose amendment document was removed is not thereby "not amended".
  const flaggedCited = [...new Set([...(answer.citations ?? []).map((c) => c?.policyId), ...bindings.map((b) => b?.policyId)].filter((id): id is string => !!id && (ctx.removals.get(id) ?? []).some((r) => r.kind === "amendment_removed")))];
  if (flaggedCited.length) for (const x of all) if (SAYS_NOT_AMENDED.test(x.sentence) && !STATES_REMOVAL_LIMITATION.test(x.sentence)) bad(x, "", "an amendment document for this policy was removed from the library; that does not establish that the policy has no amendments or that nothing changed");
  // Round 8d: the reverse -- a sentence saying an amendment document was removed, in a household that has never removed
  // (deleted or superseded) one, states something false (ingest-live-6: the only sentence left of a comparison).
  const removalClaims = all.filter((x) => CLAIMS_REMOVAL.test(x.sentence));
  if (removalClaims.length && !(await householdRemovedAmendment(opts.accountId))) for (const x of removalClaims) bad(x, "", "no amendment document of this household was removed or replaced; do not say one was");
  for (const x of all) {
    const key = norm(x.sentence);
    // A sentence labelled as an indicative estimate stands only with a calculation (or computation) record of its own:
    // a number merely printed on a cited page never validates a calculation.
    if (x.figures.length && /^\s*indicative estimate\b/i.test(x.sentence) && !calculations.some((k) => k && norm(k.sentence) === key) && !computations.some((c) => c && norm(c.sentence) === key)) { bad(x, x.figures[0].raw, "an indicative estimate is stated without a calculation record"); continue; }
    for (const f of x.figures) {
      const own = bindings.filter((b) => b && norm(b.sentence) === key && same(b.value, f.value) && b.currency === f.currency);
      const reasons: string[] = [];
      let ok = false;
      for (const b of own) { const p = groundProblem(b, f.value, f.currency, ctx, x.sentence, { previous: precedingOf(x) }) ?? removalProblem(b, x.sentence, previousOf(x), ctx); if (!p) { ok = true; break; } reasons.push(p); }
      if (ok) continue;
      for (const c of computations.filter((c) => c && norm(c.sentence) === key)) { const p = computationProblem(c, f, x.sentence, ctx); if (!p) { ok = true; break; } if (same(c.result?.value, f.value)) reasons.push(p); }
      if (ok) continue;
      for (const k of calculations.filter((k) => k && norm(k.sentence) === key)) {
        const p = calcVerdict(k, x.sentence);
        if (!p && calculationFigures(k).some((v) => same(v, f.value)) && f.currency === k.currency) { ok = true; break; }
        if (p) { reasons.push(p); requirementFor(x, k, p); } else if (same(k.result?.value, f.value)) reasons.push("the sentence’s figure is not the calculation’s");
      }
      if (ok) continue;
      if (calculations.some((k) => k && norm(k.sentence) === key)) { bad(x, f.raw, reasons[0] ?? "the figure is not part of the calculation the sentence states"); break; }
      const u = userProblem(f, x.sentence, ctx);
      if (!u) continue;
      bad(x, f.raw, reasons[0] ?? u);
      if (debug && own.length) process.stderr.write("[figure-gate-bind] " + JSON.stringify(own.map((b) => [b.benefit, (b.passage ?? "").slice(0, 100), b.column ?? null, b.subjectId?.slice(-4)])) + "\n");
      break;
    }
  }
  // A cover statement the cited page contradicts ("X is covered" where it prints "X is not covered").
  if (anyCover) {
    const pages: Page[] = [];
    const cited = new Set([...(answer.citations ?? []).map((c) => c?.policyId), ...bindings.map((b) => b?.policyId)].filter(Boolean) as string[]);
    for (const id of cited) { const d = ctx.docs.get(id); if (d?.usable) for (const [page, text] of d.pages) pages.push({ policyId: id, page, text, current: !d.superseded }); }
    for (const x of all) {
      const m = COVER_CLAIM.exec(x.sentence.trim());
      if (!m || !pages.length) continue;
      const subject = normalPassage(x.sentence.trim().split(/\s+(?:is|are)\s+(?:not\s+)?covered\b/i)[0]).replace(/^(?:yes|good news)[,.!]?\s+/, "");
      const words = subject.match(/[a-z]{4,}/g) ?? [];
      if (!words.length) continue;
      const clauses = pages.filter((p) => p.current).flatMap((p) => p.text.split(/\n+|(?<=[.;])\s+/)).filter((c) => words.every((w) => normalPassage(c).includes(w)) && /\bcover|\bexclu|\bpay/i.test(c));
      const neg = !!m[1];
      if (clauses.length && clauses.every((c) => negated(c) !== neg)) bad(x, subject, "the cited page says the opposite");
    }
  }
  if (debug && problems.length) process.stderr.write("[figure-gate-debug] " + JSON.stringify(problems.map((p) => [p.where, p.figure, p.reason, p.sentence.slice(0, 160)])) + "\n");
  if (opts.report || !problems.length) return problems;
  for (const [field, sentences] of drop) {
    const kept = sentencesOf(field.get()).map((s) => (sentences.has(s) ? requirements.get(s) ?? null : s)).filter((s): s is string => !!s).join(" ").trim();
    field.set(kept);
  }
  answer.details = (answer.details ?? []).filter((d) => d && d.trim());
  answer.nextSteps = (answer.nextSteps ?? []).filter((d) => d && d.trim());
  const textProblems = problems.filter((p) => p.where !== "policyStatedLimits" && !requirements.has(p.sentence));
  if (!textProblems.length) return problems;
  const note = textProblems.every((p) => p.reason === "the cited page says the opposite") ? CLAIM_LEFT_OUT_NOTE : FIGURE_LEFT_OUT_NOTE;
  if (!answer.summary.trim()) answer.summary = note;
  else if (!answer.details.includes(note)) answer.details.push(note);
  return problems;
}

// ---- producer helpers for computed figures -------------------------------------------------------------------
const HALF_UP_CENTS = { mode: "half_up", precision: 2 } as const;
/** An explicit sum of operands (one operand is itself); null when any operand is missing or currencies differ. */
export function sumOperands(ops: (ComputationOperand | null | undefined)[], scope: "person" | "household" = "person"): ComputationOperand | null {
  if (!ops.length || ops.some((o) => !o)) return null;
  const list = ops as ComputationOperand[];
  if (list.length === 1) return list[0];
  const currency = list[0].currency;
  if (list.some((o) => o.currency !== currency || o.period !== list[0].period || o.role !== list[0].role)) return null;
  const value = roundBy(list.reduce((n, o) => n + o.value, 0), "half_up", 2);
  return { value, currency, period: list[0].period, role: list[0].role, computation: { sentence: "", result: { value, currency }, operation: "sum", operands: list, period: list[0].period, currency, rounding: HALF_UP_CENTS, scope } };
}
/** An explicit difference a - b. */
export function differenceOperands(a: ComputationOperand | null | undefined, b: ComputationOperand | null | undefined): ComputationOperand | null {
  if (!a || !b || a.currency !== b.currency || a.period !== b.period || a.role !== b.role) return null;
  const value = roundBy(a.value - b.value, "half_up", 2);
  return { value, currency: a.currency, period: a.period, role: a.role, computation: { sentence: "", result: { value, currency: a.currency }, operation: "difference", operands: [a, b], period: a.period, currency: a.currency, rounding: HALF_UP_CENTS } };
}
/** An explicit multiple (count x a figure). */
export function productOperand(a: ComputationOperand | null | undefined, count: number): ComputationOperand | null {
  if (!a || !Number.isInteger(count) || count < 1) return null;
  if (count === 1) return a;
  const value = roundBy(a.value * count, "half_up", 2);
  return { value, currency: a.currency, period: a.period, role: a.role, computation: { sentence: "", result: { value, currency: a.currency }, operation: "product", factor: count, operands: [a], period: a.period, currency: a.currency, rounding: HALF_UP_CENTS } };
}
/** An explicit per-period restatement (yearly -> monthly is / 12, half-up to cents). */
export function perPeriodOperand(a: ComputationOperand | null | undefined, to: FigurePeriod): ComputationOperand | null {
  if (!a || !a.period) return null;
  if (a.period === to) return a;
  const f = periodFactor(a.period, to);
  if (!f) return null;
  const value = roundBy(PER[to]! > PER[a.period]! ? a.value / f : a.value * f, "half_up", 2);
  return { value, currency: a.currency, period: to, role: a.role, computation: { sentence: "", result: { value, currency: a.currency }, operation: "per_period", fromPeriod: a.period, toPeriod: to, factor: f, operands: [a], period: a.period, currency: a.currency, rounding: HALF_UP_CENTS } };
}
/** Attaches an operand to the sentences of `text` that state its value: its binding, or its computation record. */
export function attachOperand(target: Provenance | null | undefined, text: string, o: ComputationOperand | null | undefined): void {
  if (!o) return;
  if (o.binding) bindFigure(target, text, o.value, o.currency, o.binding);
  else if (o.computation) bindComputation(target, text, { ...o.computation, result: { value: o.value, currency: o.currency } });
}
/** The current file hash of each (active) policy, for producers that know a figure's policy but not its version. */
export async function documentHashes(accountId: string, ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = (await query<{ id: string; file_hash: string | null }>(`SELECT p.id::text AS id, p.file_hash FROM policies p WHERE p.account_id=$1 AND p.id::text=ANY($2::text[]) AND ${activePredicate("p")}`, [accountId, want]).catch(() => ({ rows: [] }))).rows;
  return new Map(rows.map((r) => [r.id, r.file_hash]));
}

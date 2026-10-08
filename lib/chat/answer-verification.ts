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
import type { BoundFigure, ChatAnswer, ComputationOperand, ComputationRecord, FigureBinding, FigurePeriod } from "@/types";
import { amountAppears, amountPrintedWith, benefitRowProblem, benefitWords, namesBenefit, negated, normalPassage, passageRows, printedPeriodsOf, rowCells } from "./assertions";
import { currenciesStatedIn } from "@/lib/claims/currency-evidence";
import { cleanScannedLine, looksScanned } from "./scanned-text";

const cleanScannedText = (t: string) => t.split(/\n/).map((l) => (looksScanned(l) ? cleanScannedLine(l) ?? "" : "")).filter(Boolean).join("\n");
const gateDebug = () => !!(process.env.DP_GATE_DEBUG || (globalThis as { __dpVerifyDebug?: boolean }).__dpVerifyDebug);

export const FIGURE_LEFT_OUT_NOTE = "A figure that couldn’t be matched to the cited page of your documents was left out of this answer.";
export const CLAIM_LEFT_OUT_NOTE = "A statement that the cited page of your documents doesn’t support was left out of this answer.";

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

type Doc = { id: string; owner: string; members: Set<string>; fileHash: string | null; superseded: boolean; usable: boolean; pages: Map<number, string> };
type Person = { id: string; names: string[]; relationship: string };
type Ctx = { docs: Map<string, Doc>; people: Person[]; userFigures: StatedFigure[]; userNumbers: number[] };

function bindingsOf(answer: ChatAnswer): FigureBinding[] {
  const out: FigureBinding[] = [...(answer.figureBindings ?? [])];
  for (const l of answer.policyStatedLimits ?? []) if (l?.binding) out.push(l.binding);
  const walk = (r: ComputationRecord | undefined, depth: number) => { if (!r || depth > 3) return; for (const o of r.operands ?? []) { if (o?.binding) out.push(o.binding); if (o?.computation) walk(o.computation, depth + 1); } };
  for (const c of answer.computations ?? []) walk(c, 0);
  return out;
}

/** The documents the answer's bindings and citations name (this household's, active -- the lifecycle predicate --
 * with their release state, version and pages), the household's people, and the household's own figures. */
async function loadContext(accountId: string, answer: ChatAnswer, userText: string): Promise<Ctx> {
  const ids = [...new Set([...bindingsOf(answer).map((b) => b?.policyId), ...(answer.citations ?? []).map((c) => c?.policyId), ...(answer.policyStatedLimits ?? []).map((l) => l?.citation?.policyId)].filter((x): x is string => typeof x === "string" && !!x))];
  const docs = new Map<string, Doc>();
  if (ids.length) {
    const rows = (await query<{ id: string; owner: string; file_hash: string | null; superseded: boolean; usable: boolean }>(
      `SELECT p.id::text AS id, p.family_member_id::text AS owner, p.file_hash, (p.superseded_at IS NOT NULL) AS superseded,
              (coalesce(p.quarantine_status,'') IN ('scan_clean','not_scanned_prototype')) AS usable
         FROM policies p WHERE p.account_id=$1 AND p.id::text=ANY($2::text[]) AND ${activePredicate("p")}`, [accountId, ids]).catch(() => ({ rows: [] }))).rows;
    for (const r of rows) docs.set(r.id, { id: r.id, owner: r.owner, members: new Set([r.owner]), fileHash: r.file_hash, superseded: !!r.superseded, usable: !!r.usable, pages: new Map() });
    if (docs.size) {
      const members = (await query<{ policy_id: string; member: string }>(`SELECT policy_id::text AS policy_id, family_member_id::text AS member FROM policy_members WHERE account_id=$1 AND policy_id::text=ANY($2::text[])`, [accountId, [...docs.keys()]]).catch(() => ({ rows: [] }))).rows;
      for (const m of members) docs.get(m.policy_id)?.members.add(m.member);
      const pages = (await query<{ policy_id: string; page_number: number; text: string }>(`SELECT policy_id::text AS policy_id, page_number, text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[])`, [accountId, [...docs.keys()]]).catch(() => ({ rows: [] }))).rows;
      for (const p of pages) docs.get(p.policy_id)?.pages.set(p.page_number, p.text ?? "");
    }
  }
  const people = (await query<{ id: string; display_name: string | null; preferred_name: string | null; relationship: string | null }>(`SELECT f.id::text AS id, f.display_name, f.preferred_name, f.relationship FROM family_members f WHERE f.account_id=$1 AND ${activePredicate("f")}`, [accountId]).catch(() => ({ rows: [] }))).rows
    .map((p) => ({ id: p.id, names: [p.display_name, p.preferred_name].filter((n): n is string => !!n && n.trim().length >= 3).map((n) => n.trim()), relationship: p.relationship ?? "" }));
  return { docs, people, userFigures: moneyFiguresIn(userText), userNumbers: (userText.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number) };
}

/** The column check: where the row that prints the amount has one value cell per person or tier, the amount must be in
 * the binding's column, and that column must be the person's class (an employee is not the spouse column). */
function columnProblem(b: FigureBinding, value: number, currency: string, rangeText: string, subject: Person | undefined): string | null {
  const rows = passageRows(b.passage).filter((r) => amountAppears(value, r));
  if (!rows.length) return "the amount is not printed in the cited passage";
  if (rows.some((r) => rowCells(r).length < 3)) return null; // a row with one value prints one figure for everyone it covers
  if (!b.column || !b.column.trim()) return "the row prints one column per person or tier, and the figure is not bound to a column";
  const lines = rangeText.split(/\n/);
  const col = norm(b.column);
  for (const row of rows) {
    const cells = rowCells(row);
    const at = lines.findIndex((l) => norm(l).includes(norm(row).slice(0, 60)));
    if (at < 0) continue;
    const head = headerFor(lines, at, cells.length, col);
    if (!head) continue;
    const exact = head.findIndex((h) => norm(h) === col);
    const j = exact >= 0 ? exact : head.findIndex((h) => { const hn = norm(h); return hn.length >= 2 && (hn.includes(col) || col.includes(hn)); });
    const k = j + (cells.length - Math.min(head.length, cells.length));
    if (j < 0 || k <= 0) continue;
    const cell = cells[k] ?? "";
    if (!amountAppears(value, cell)) return "the figure is printed in another person’s or tier’s column, not the one it is stated for";
    const how = amountPrintedWith(value, currency, cell);
    if (how === "other" || (how === "bare" && !currenciesStatedIn(head[j] + " " + b.passage).includes(currency))) return "the currency printed in the column is not the figure’s";
    const want = classOf(head[j]), is = subject ? classOf(subject.relationship) ?? (/^self$/i.test(subject.relationship) ? "self" : null) : null;
    if (want && is && want !== is) return "the figure is printed in the " + want + " column, not the column for the person it is stated for";
    return null;
  }
  return "the table column the figure is stated for is not printed above its row";
}
/** The currency a table's header names for the column the bare figure is printed in ("Benefit (S$)"). */
function columnCurrency(b: FigureBinding, rangeText: string): string | null {
  const lines = rangeText.split(/\n/);
  const at = lines.findIndex((l) => norm(l).includes(norm(b.passage).slice(0, 60)));
  for (let i = at - 1; i >= 0 && i >= at - 12; i--) { const named = currenciesStatedIn(lines[i]); if (named.length === 1) return named[0]; }
  return null;
}

/** Rule 2: is `value` in `currency` grounded by `b` (and, when `sentence` is given, for that sentence)? Null when it is. */
function groundProblem(b: FigureBinding | undefined, value: number, currency: string, ctx: Ctx, sentence: string | null, opts: { benefit?: string } = {}): string | null {
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
  if (how === "bare") { const named = currenciesStatedIn(shown); if (!(named.length === 1 && named[0] === currency)) { const c = columnCurrency(b, rangeText); if (c !== currency) return "the cited passage prints the figure without its currency"; } }
  const benefit = (opts.benefit ?? b.benefit ?? "").trim();
  if (!benefit) return "the figure is not bound to a benefit";
  if (sentence != null && !namesBenefit(sentence, benefit)) return "the sentence does not name the benefit the figure is printed for";
  const row = benefitRowProblem(value, benefit, b.passage) && benefitRowProblem(value, benefit, shown);
  const column = columnProblem(b, value, currency, rangeText, subject);
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

// ---- rule 1: the household's own figures ------------------------------------------------------------------
const ATTRIBUTION = /\byou(?:['’]ve| have)? (?:asked about|mentioned|said|told (?:me|us)|wrote|reported|gave|quoted|entered|typed|noted|stated|put)\b|\baccording to you\b|\bin your (?:message|question)\b|\b(?:the )?(?:figure|amount|bill|number|sum) you (?:gave|mentioned|quoted|wrote|entered)\b/i;
const USER_FORBIDDEN = /\b(?:cover\w*|insured|assured|limits?|limited|caps?|capped|maximum|max|up to|pays|payable|payouts?|(?:will|would|could|can|may) (?:be )?pa(?:y|id)|reimburs\w*|claimable|entitle\w*|benefits?|totals?|totall?ing|altogether|in all|combined|add(?:s|ed)? up|sum insured|estimat\w*|refund\w*|compensat\w*|deductible|co-?insurance|excess|premiums?|polic(?:y|ies)|plan|schedule|insurer)\b/i;
function userProblem(f: StatedFigure, sentence: string, ctx: Ctx): string {
  const echoed = ctx.userFigures.some((u) => same(u.value, f.value) && u.currency === f.currency);
  if (!echoed) {
    if (ctx.userFigures.some((u) => same(u.value, f.value)) || ctx.userNumbers.some((n) => same(n, f.value))) return "the figure is the household’s own, but not in the currency they gave";
    return "the figure has no citation of its own";
  }
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

type Page = { policyId: string; page: number; text: string; current: boolean };
export type FigureProblem = { where: string; figure: string; sentence: string; reason: string };

/** Checks (and, unless `report`, repairs in place) every money figure and cover statement of an answer. */
export async function verifyAnswerFigures(answer: ChatAnswer, opts: { accountId: string; userText?: string; report?: boolean }): Promise<FigureProblem[]> {
  if (!answer || typeof answer !== "object") return [];
  const fields: { where: string; get: () => string; set: (v: string) => void }[] = [
    { where: "summary", get: () => answer.summary ?? "", set: (v) => { answer.summary = v; } },
    ...(answer.details ?? []).map((_, i) => ({ where: "details[" + i + "]", get: () => answer.details[i] ?? "", set: (v: string) => { answer.details[i] = v; } })),
    ...(answer.nextSteps ?? []).map((_, i) => ({ where: "nextSteps[" + i + "]", get: () => answer.nextSteps[i] ?? "", set: (v: string) => { answer.nextSteps[i] = v; } })),
    ...(answer.claimItems ?? []).map((_, i) => ({ where: "claim[" + i + "].reason", get: () => answer.claimItems[i]?.reason ?? "", set: (v: string) => { answer.claimItems[i].reason = v; } })),
  ];
  const all = fields.flatMap((f) => sentencesOf(f.get()).map((s) => ({ field: f, sentence: s, figures: moneyFiguresIn(s) })));
  const anyFigure = all.some((x) => x.figures.length);
  const anyCover = all.some((x) => COVER_CLAIM.test(x.sentence.trim()));
  if (!anyFigure && !anyCover && !answer.policyStatedLimits?.length) return [];
  const ctx = await loadContext(opts.accountId, answer, opts.userText ?? "");
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
  const bindings = answer.figureBindings ?? [], computations = answer.computations ?? [];
  const drop = new Map<typeof fields[number], Set<string>>();
  const bad = (x: typeof all[number], figure: string, reason: string) => { problems.push({ where: x.field.where, figure, sentence: x.sentence, reason }); (drop.get(x.field) ?? drop.set(x.field, new Set()).get(x.field)!).add(x.sentence); };
  for (const x of all) {
    const key = norm(x.sentence);
    for (const f of x.figures) {
      const own = bindings.filter((b) => b && norm(b.sentence) === key && same(b.value, f.value) && b.currency === f.currency);
      const reasons: string[] = [];
      let ok = false;
      for (const b of own) { const p = groundProblem(b, f.value, f.currency, ctx, x.sentence); if (!p) { ok = true; break; } reasons.push(p); }
      if (ok) continue;
      for (const c of computations.filter((c) => c && norm(c.sentence) === key)) { const p = computationProblem(c, f, x.sentence, ctx); if (!p) { ok = true; break; } if (same(c.result?.value, f.value)) reasons.push(p); }
      if (ok) continue;
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
    const kept = sentencesOf(field.get()).filter((s) => !sentences.has(s)).join(" ").trim();
    field.set(kept);
  }
  answer.details = (answer.details ?? []).filter((d) => d && d.trim());
  answer.nextSteps = (answer.nextSteps ?? []).filter((d) => d && d.trim());
  const textProblems = problems.filter((p) => p.where !== "policyStatedLimits");
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

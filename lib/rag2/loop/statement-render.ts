/**
 * Reliable chat, contract C: statements the SERVER writes. The model chooses what to say (a statement of a kind, the
 * benefit or result it is about); the server writes the figures, their bases and their source labels from the resolved
 * record or the saved calculation, so an amount, a percentage, a base or a date is never copied, paraphrased or cut.
 *   kind calculation    (result_id)   a calculation's result with its case, percentage, base and document
 *   kind benefit_terms  (benefit_id)  a benefit's printed terms (a dated amount, a rate, a percentage schedule)
 *   next step contact   (policy_id)   who to contact for that document: its own insurer
 * Other kinds (fact, uncertainty, suggestion, library_status) keep the model's words and are checked whole by the
 * composer: a statement that fails is omitted as a unit, never edited into a different claim.
 */
import type { ToolContext } from "../tools";
import { evidenceAt, evidenceFor, evidenceKey, type EvidenceRef } from "../evidence";
import type { RagLoopState } from "./types";
import { calcOutcomes } from "../calc/tool";
import { personAmountValue } from "../evaluate";
import { formatMoney, printedAmount, type BenefitRecord } from "../benefit-records";
import { loadDocs, loadLinks, loadMembers, pageMap, policyFamily, type DocRow, type LinkRow } from "../store";
import { cellDate } from "../tables";
import { ATTRIBUTES, reportedValue } from "../applicability";
import { familiesOf } from "../event-relations";
import { documentLabel, profileDocument, standingClause } from "./relation";
import { checkNotFound, unlistedSchemePolicy, type AbsenceCheck, type PrintedLine } from "./absence-scope";
import { moneyFiguresIn } from "@/lib/chat/answer-verification";
import type { AnswerStatement } from "@/types";

/** Answer shape (UX "shorter answers"): a server-rendered statement as fields -- its short text, its amount, base and OWN conditions, the
 * date the amount was printed, and where it comes from. Kept by the statement's full rendered text (ctx.structured); the answer's
 * statements read it (hook.ts). */
export type StructuredDraft = Omit<AnswerStatement, "id" | "text" | "fullText" | "source"> & { short: string; source: (Omit<NonNullable<AnswerStatement["source"]>, "citationIds"> & {
  /** the evidence the card cites, when it is narrower than what its sentence rests on (the relation notes: the rows shown) */ citeIds?: string[] }) | null };
/** Registers a draft only when its short text, basis and conditions state no figure the full statement does not (the full statement is
 * the one every check verified; the short form only leaves words out), and every amount the full statement prints is still on the card
 * (Critic R18-1: a condition carrying its own figure, "subject to the S$1,000 deductible", is never lost). Otherwise the statement is
 * sent as plain text (lib/chat/monetary-boundary.ts reconcileStatements checks the same again on return, save and reopen). */
function structure(d: Deps, full: string, draft: StructuredDraft): void {
  const key = (f: { currency?: string | null; value: number }) => `${Math.round(f.value * 100)}`;
  const have = moneyFiguresIn(full).map(key);
  // (an amount whose currency the document leaves unstated is shown as printed, "$500", while its paragraph says "500 (printed with a bare
  // “$” sign ...)": its number must be in the paragraph, and it is not a money figure of the paragraph's)
  const bare = draft.amount && !draft.amount.currencyResolved;
  if (bare && !((full.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) as string[]).includes(draft.amount!.text.replace(/^\$/, ""))) return;
  const said = [draft.short, draft.basis ?? "", bare ? "" : draft.amount?.text ?? "", ...draft.conditions].flatMap((t) => moneyFiguresIn(t)).map(key);
  if (said.some((f) => !have.includes(f)) || have.some((f) => !said.includes(f))) return;
  if (draft.amount && !draft.personName) return;
  (d.ctx.structured ??= new Map()).set(full, draft);
}

/** Statements the server wrote (never split, never re-edited by the composer). Not a tool parameter: kept aside. */
export const RENDERED = new WeakSet<object>();
/** The relationship note between two documents' tables (written once per answer). */
const RELATION = new WeakSet<object>();
/** Contact steps the server wrote for a document linked to the answer's person (checked here, not re-judged by text). */
export const RENDERED_STEPS = new Set<string>();
export const STATEMENT_KINDS = ["fact", "calculation", "benefit_terms", "uncertainty", "suggestion", "library_status", "not_found"] as const;
/** What the server checked for a not_found statement it wrote (kept aside: a model cannot supply it). */
/** Server-written statements that quote the documents verbatim (“…”): the quoted words are the insurer's, not a statement that an amount is paid. */
export const QUOTED = new WeakSet<object>();
export const ABSENCE_OF = new WeakMap<object, AbsenceCheck>();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDate = (iso: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ""); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso; };
/** A printed label as a reader expects it: an ALL-CAPS roster label takes the casing the household's own document names
 * use for the same words ("FAMILYGUARD PERSONAL ACCIDENT" -> "FamilyGuard Personal Accident"), else title case. */
const pretty = (label: string, known: (string | null | undefined)[] = []) => {
  const s = label.replace(/\(\s*(?:group\s+)?policy\s*no\.?[^)]*\)/gi, " ").replace(/\s+/g, " ").trim();
  // (the same words in a document name of the household's: that name's casing -- also for a label already title-cased
  // from a roster heading, "Familyguard Personal Accident")
  for (const k of known) { const i = (k ?? "").toLowerCase().indexOf(s.toLowerCase()); if (k && s.length >= 4 && i >= 0) return k.slice(i, i + s.length); }
  if (!(s === s.toUpperCase() && /[A-Z]{3}/.test(s))) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
};
/** A footnote's text as the page prints it (a note wrapped over two lines is one note). */
const noteText = (t: string) => t.replace(/\s+/g, " ").trim();
const quoted = (marker: string, text: string) => `“${noteText(text)}” (marked ${marker})`;
const docName = (r: BenefitRecord) => (r.policy.personalProof && /certificate/i.test(r.policy.product ?? "") ? "certificate" : r.policy.product ?? "document");

type Deps = { ctx: ToolContext; state: RagLoopState; evidenceId: (ref: EvidenceRef, via?: string) => string; nameOf: (id: string | null | undefined) => string | null;
  /** A model-written statement the server's own statement replaced (recorded in the trace, not as a verification failure). */
  superseded?: (text: string) => void;
  /** The errors of this turn's earlier tool calls (a refusal the model was already given). */
  priorErrors?: () => string[] };

/** What the documents print for a refused absence's topic, quoted line by line and cited to its page. */
export function quotePrinted(lines: PrintedLine[], evidenceId: (ref: EvidenceRef, via?: string) => string, subjectId: string | null): { text: string; evidence_ids: string[] } | null {
  const parts: string[] = []; const ids: string[] = [];
  const groups = new Map<string, string[]>();
  for (const l of lines) {
    const ref = evidenceFor({ policyId: l.policyId, documentHash: l.fileHash, page: l.page, pageText: l.pageText, passage: l.line, subjectId });
    if (!ref) continue;
    ids.push(evidenceId(ref, "printed"));
    const at = `the ${l.name} (page ${l.page})`; groups.set(at, [...(groups.get(at) ?? []), `“${l.line.replace(/[.\s]+$/, "")}”`]);
  }
  for (const [at, qs] of groups) parts.push(`${at} prints: ${qs.join(" and ")}`);
  if (!parts.length) return null;
  const text = parts.join("; and ");
  return { text: `${text.charAt(0).toUpperCase()}${text.slice(1)}.`, evidence_ids: [...new Set(ids)] };
}

/** A benefit's printed terms, written from its record (with the evidence and value ids that bind each figure). */
/** C5 (Policy Evidence Reviewer on C4): a trip schedule's amount is that trip's. The lines its own page prints for whom, when and where
 * ("Insured Person: ...", "Period of Insurance: ... to ...", "Destination: ...") are said beside the amount, cited -- never the amount
 * without them, and never left out: the household and the insurer judge whether the trip fits the event. */
const listOf = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "";
async function tripLimits(r: BenefitRecord, d: Deps): Promise<{ text: string; evidence: EvidenceRef[]; conditions: string[] } | null> {
  const page = (await pageMap(d.ctx.accountId, r.policy.id).catch(() => new Map<number, string>())).get(r.source.page) ?? "";
  if (!/^\s*(?:Period of Insurance|Destination)\s*:/im.test(page)) return null;
  const out: { label: string; value: string; ev: EvidenceRef }[] = [];
  let at = 0;
  for (const line of page.split("\n")) {
    const m = /^(\s*)(Insured Person|Period of Insurance|Destination)\s*:\s*(.+?)\s*$/i.exec(line);
    if (m) out.push({ label: m[2], value: m[3], ev: evidenceAt({ policyId: r.policy.id, documentHash: r.policy.version.documentHash, page: r.source.page, pageText: page, start: at + m[1].length, end: at + line.length, subjectId: r.memberId }) });
    at += line.length + 1;
  }
  if (!out.some((x) => /period|destination/i.test(x.label))) return null;
  // (C6, Critic R8-1: "trip" only when a Destination line is printed -- an annual schedule prints only its period)
  return { text: ` The schedule prints this cover for ${listOf(out.map((x) => `${x.label.toLowerCase() === "insured person" ? "the insured person" : x.label.toLowerCase() === "period of insurance" ? "the period of insurance" : "the destination"} “${x.value}”`))}; ${out.some((x) => /destination/i.test(x.label)) ? "whether that trip fits this event" : "whether this period of insurance covers the date of the event"} is for the insurer to confirm.`, evidence: out.map((x) => x.ev),
    // (the card: each printed line as its own condition, and -- from the printed dates alone, never from the household's words -- that the
    // printed period ended before today. PR #72 E4; Critic R25-1.)
    conditions: [...out.map((x) => `${x.label.replace(/^./, (c) => c.toUpperCase()).replace(/^(\w+) (\w)/, (_m, a, b) => `${a} ${b.toLowerCase()}`)}: ${x.value}.`), ...periodEnded(out.find((x) => /period/i.test(x.label))?.value ?? "")] };
}
/** "The printed period of insurance ended on 17 March 2025, before today." when a printed "dd/mm/yyyy to dd/mm/yyyy" period is over (a fact
 * of the document and today's date -- never of the household's words: Critic R25-1). */
export function periodEnded(period: string, now = Date.now()): string[] {
  const m = /\bto\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(period);
  if (!m || Date.UTC(+m[3], +m[2] - 1, +m[1]) >= now) return [];
  return [`The printed period of insurance ended on ${fmtDate(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`)}, before today.`];
}
/** PR #72 E3 / Evidence Reviewer 18: a printed line of the household's documents from the same insurer for the same product (its name in
 * the document's own product name) -- quoted and cited as printed, never inferred. `skip`: a document already quoted. */
async function schemeLine(d: Deps, r: BenefitRecord, product: string, want: RegExp, skip?: string, part?: (line: string) => string): Promise<{ line: string; quote: string; ev: string } | null> {
  // (the same insurer, or the same policy -- its policy or group policy number: a scheme's summary may print a brand name, "KestrelOne")
  const all = await loadDocs(d.ctx.accountId).catch(() => [] as DocRow[]);
  const own = all.find((x) => x.id === r.policy.id);
  const family = new Set((own ? policyFamily(all, own) : []).map((x) => x.id));
  const docs = all.filter((x) => x.id !== skip && !!x.productName && x.productName.toLowerCase().includes(product.toLowerCase()) && (family.has(x.id) || (!!x.insurer && x.insurer.toLowerCase() === (r.policy.insurer ?? "").toLowerCase())));
  for (const doc of docs) {
    for (const [page, text] of [...(await pageMap(d.ctx.accountId, doc.id).catch(() => new Map<number, string>()))].sort((a, b) => a[0] - b[0])) {
      let at = 0;
      for (const raw of text.split("\n")) {
        const whole = raw.trim();
        if (want.test(whole)) {
          // (`part`: the words of the line that are quoted -- a verbatim stretch of it, cited exactly)
          const line = (part ? part(whole) : whole).trim();
          const start = at + raw.indexOf(line);
          const ev = d.evidenceId(evidenceAt({ policyId: doc.id, documentHash: doc.fileHash, page, pageText: text, start, end: start + line.length, subjectId: r.memberId }));
          // (a bare "$" in the quoted words is said as printed, its currency unstated -- as compose.ts says a bare "$" the model quotes)
          const bare = (t: string) => t.replace(/(?<![A-Za-z])\$\s?(\d[\d,]*(?:\.\d+)?)/g, "$1 (printed with a “$” sign; the document does not say which currency)");
          const q = bare(line.replace(/[“”]/g, "\"").replace(/[.\s]+$/, ""));
          return { line: q, quote: `the ${doc.productName} (page ${page}) prints “${q}”`, ev };
        }
        at += raw.length + 1;
      }
    }
  }
  return null;
}
/** Quotes said once per document page: "the X (page 9) prints “A”, “B” and “C”". */
const quotes = (cs: { quote: string }[]) => {
  const by = new Map<string, string[]>();
  for (const c of cs) { const m = /^(.*? prints) (“.*”)$/.exec(c.quote); const k = m?.[1] ?? c.quote; by.set(k, [...(by.get(k) ?? []), m?.[2] ?? ""]); }
  return listOf([...by].map(([k, qs]) => `${k} ${listOf(qs.filter(Boolean))}`.trim()));
};
/** The product a benefit belongs to, for its scheme's other documents: a certificate row names it ("Group Personal Accident"); a document's
 * own benefit belongs to the product its name starts with ("Public Officers Group Personal Accident - Summary of Benefits"). */
const productOf = (r: BenefitRecord) => r.applicability === "person_row" ? r.benefit : (r.policy.product ?? "").split(/\s+-\s+/)[0];
export async function renderTerms(r: BenefitRecord, d: Deps): Promise<{ text: string; evidence_ids: string[]; value_ids: string[] }> {
  const w = await renderTermsBody(r, d);
  const trip = await tripLimits(r, d);
  const out = trip ? { text: w.text + trip.text, evidence_ids: [...new Set([...w.evidence_ids, ...trip.evidence.map((e) => d.evidenceId(e))])], value_ids: w.value_ids } : { text: w.text, evidence_ids: w.evidence_ids, value_ids: w.value_ids };
  // (a trip schedule's insured person, period and destination are the amount's own conditions: they stay on its card)
  if (w.draft) structure(d, out.text, trip ? { ...w.draft, conditions: [...w.draft.conditions, ...trip.conditions, "Whether that trip fits this event is for the insurer to confirm."] } : w.draft);
  return out;
}
async function renderTermsBody(r: BenefitRecord, d: Deps): Promise<{ text: string; evidence_ids: string[]; value_ids: string[]; draft?: StructuredDraft }> {
  const who = r.memberName;
  const ev = [d.evidenceId(r.source.evidence)];
  if (r.kind === "percentage_schedule" && r.schedule) {
    const s = r.schedule, b = s.base;
    const base = b.kind === "fixed_limit" ? `the ${b.label} of ${formatMoney(b.cents, b.currency)}` : b.kind === "sum_insured" ? `${who}'s own sum insured (${formatMoney(b.cents, b.currency)} on the ${b.from.policy.personalProof && /certificate/i.test(b.from.policy.product ?? "") ? "certificate" : b.from.policy.product ?? "schedule"})` : `“${b.words}”`;
    const vals: string[] = [];
    if (b.kind === "fixed_limit") ev.push(d.evidenceId(b.evidence));
    if (b.kind === "sum_insured") { const v = await personAmountValue(d.ctx, b.from, r.memberName, r.memberId); if (v) vals.push(v); }
    const cases = s.rows.map((x) => `${x.label} ${x.percent}%`).join("; ");
    // (an evaluation this turn found the household's reported part among none of these cases: said with the terms)
    const un = d.ctx.unlisted?.get(`${r.memberId}|${r.id}`);
    const none = un?.length ? ` It lists no case for ${un.length > 1 ? un.slice(0, -1).join(", ") + " or " + un.at(-1) : `a ${un[0]}`}.` : "";
    // (Actual-library findings: an unresolved base is said with the specific link that is missing -- never left as a bare
    // "Sum Insured" the household cannot act on, and never contradicted by an amount)
    const missing = b.kind === "unresolved" ? ` ${b.why.charAt(0).toUpperCase()}${b.why.slice(1)}.` : "";
    // fx-live-1 (omitted footnote): what the page prints under the table for the rows that print its marker, said with THOSE rows
    // and no others (calc/pct-rows.ts rowNotes) -- "any fractures of toe and foot are not covered" qualifies the leg row, not the arm row.
    const noted = s.rows.filter((x) => x.notes.length);
    for (const x of noted) for (const n of x.notes) ev.push(d.evidenceId(n.evidence));
    const footnotes = noted.length ? ` The page also prints ${noted.length > 1 ? "footnotes" : "a footnote"} for ${noted.length > 1 ? "these cases" : "one of them"}: ${noted.map((x) => `for “${x.label}”: ${x.notes.map((n) => quoted(n.marker, n.text)).join(" and ")}`).join("; ")}.` : "";
    for (const n of s.conditions ?? []) ev.push(d.evidenceId(n.evidence));
    const under = s.conditions?.length ? ` Under the table it prints: ${s.conditions.map((n) => `“${noteText(n.text).replace(/[.!?]+$/, "")}”`).join(" and ")}.` : "";
    return { text: `The ${r.policy.product ?? "document"} (page ${s.page}) pays the ${r.benefit} as a percentage of ${base} for each listed case: ${cases}.${none}${footnotes}${under}${missing}`, evidence_ids: [...new Set(ev)], value_ids: vals };
  }
  const p = r.printed;
  if (p?.kind === "money") {
    const amt = printedAmount(p);
    const amount = { text: p.currency ? amt : `${(p.cents / 100).toLocaleString("en-SG", { minimumFractionDigits: p.cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}${p.unit ? " " + p.unit : ""}`, currencyResolved: !!p.currency, illustration: false };
    const src = (note: string | null = null) => ({ policyName: r.policy.product ?? "document", page: r.source.page ?? null, rowLabel: null, footnote: null, note });
    if (r.applicability === "person_row") {
      const v = r.personBenefit ? await personAmountValue(d.ctx, r.personBenefit, r.memberName, r.memberId) : null;
      // (PR #72 E3, Evidence Reviewer 18: on a question about a death, the scheme's own printed death terms travel with the certificate's
      // amount -- Term Life: how to notify the insurer; Personal Accident: the share of the sum insured it pays on accidental death, where
      // it applies and what it excludes. Quoted from the same insurer's documents for that product; nothing else is added.)
      const extra: { line: string; quote: string; ev: string }[] = [];
      let basis: string | null = null;
      if (familiesOf(d.ctx.topicText ?? "").has("death") && amount.currencyResolved) {
        if (/\bTerm Life\b/i.test(r.benefit)) { const c = await schemeLine(d, r, r.benefit, /^Claims:[^.]*\bdeath\b/i, r.policy.id); if (c) extra.push(c); }
        if (/\bPersonal Accident\b/i.test(r.benefit)) {
          const death = await schemeLine(d, r, r.benefit, /^Accidental Death:\s*\d+(?:\.\d+)?% of the Sum Insured\b/i, r.policy.id);
          if (death) {
            extra.push(death);
            basis = `${/(\d+(?:\.\d+)?)%/.exec(death.line)![1]}% of ${who}'s sum insured of ${amt}`;
            for (const want of [/^Territorial Limits?:/i, /^Exclusions?:[^.]*\bdeath\b/i]) { const c = await schemeLine(d, r, r.benefit, want, r.policy.id); if (c) extra.push(c); }
          }
        }
      }
      for (const c of extra) ev.push(c.ev);
      const said = extra.length ? `; ${quotes(extra)}` : "";
      return { text: `${who}'s ${docName(r)} lists ${pretty(r.benefit)} of ${amt}${r.asOf ? ` as of ${fmtDate(r.asOf)}` : ""}${said}.`, evidence_ids: ev, value_ids: v ? [v] : [],
        draft: { kind: "benefit_terms", short: `${pretty(r.benefit).replace(/^./, (c) => c.toUpperCase())} · ${who}'s ${docName(r)}`, personName: who, amount, basis, conditions: extra.map((c) => c.line), asOf: r.asOf ?? null, source: src() } };
    }
    // PR #54 (rc-live-8): a benefit printed under its own heading, or a row with a footnote, is said in ONE sentence with
    // its name, its section, what it is for, its amount -- or that the document leaves the currency of its bare "$"
    // unstated -- and its own printed conditions, quoted from its own lines (with their own evidence). The clause that
    // pays the amount is said by the server ("for <what>, up to <amount>"), never quoted as a promise ("we will pay").
    const pb = r.personBenefit;
    if (pb && (pb.benefit.source === "section_heading" || pb.conditionSources?.length)) {
      for (const e of pb.conditionSources ?? []) ev.push(d.evidenceId(e));
      const doc = r.policy.product ?? "document";
      const sec = pb.benefit.section && pb.benefit.section !== pb.benefit.label ? `, under “${pb.benefit.section}”` : "";
      const wording = await wordingOf(r, d);
      if (wording) for (const e of await conditionEvidence(wording, p.cents, d)) ev.push(d.evidenceId(e));
      // (the row's own footnote, printed again in the wording with a word's difference -- "the Voluntary Scheme" -- is said once, as the
      // row's own page prints it: structured-answers J5s)
      const norm = (c: string) => c.toLowerCase().replace(/\bthe\b|[^a-z]/g, "");
      const paras = wording ? [...wording.conditions.filter((w) => !r.conditions.some((c) => norm(w) === norm(c))), ...r.conditions] : r.conditions;
      const t = paidTerms(paras, p.cents, wording ? `${pb.source.passage}\n${wording.personBenefit?.source.passage ?? ""}` : pb.source.passage);
      const figure = p.currency ? amt : `${(p.cents / 100).toLocaleString("en-SG", { minimumFractionDigits: p.cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}${p.unit ? " " + p.unit : ""} (printed with a bare “$” sign; the ${doc} does not say which currency)`;
      const conds = t.conditions.map((c) => `“${c.replace(/[“”]/g, "\"")}”`);
      const list = conds.length > 1 ? `${conds.slice(0, -1).join(", ")} and ${conds.at(-1)}` : conds[0] ?? "";
      return { text: `The ${doc} (page ${r.source.page}${sec}) prints the ${pretty(r.benefit)}${t.covers ? ` for ${t.covers}` : ""}, ${t.cap ? t.cap + " " : ""}${figure}${list ? `, with the printed condition${conds.length > 1 ? "s" : ""} ${list}` : ""}${wording ? ` (as the ${wording.policy.product ?? "document"} prints them for this benefit on page ${wording.source.page})` : ""}.`, evidence_ids: ev, value_ids: [],
        // (PR #72 E2a: a bare "$" amount is shown as printed, "$500", unresolved; its unit goes with its cap; the event it depends on leads)
        draft: { kind: "benefit_terms", short: `${pretty(r.benefit).replace(/^./, (c) => c.toUpperCase())}${t.covers ? ` · ${t.covers}` : ""}`, personName: who, amount: p.currency ? amount : { ...amount, text: `$${(p.cents / 100).toLocaleString("en-SG", { minimumFractionDigits: p.cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}` },
          basis: null, conditions: [...(t.lead ? [t.lead.replace(/[“”]/g, "\"")] : []), ...(t.cap ? [`${t.cap.replace(/^./, (c) => c.toUpperCase())} this amount${!p.currency && p.unit ? ` ${p.unit}` : ""}.`] : []), ...t.rest.map((c) => c.replace(/[“”]/g, "\""))], asOf: null, source: src(pb.benefit.section && pb.benefit.section !== pb.benefit.label ? `under “${pb.benefit.section}”` : null) } };
    }
    // (PR #57 follow-up, UX L2: a one-line benefit keeps the condition printed on its own line after the amount -- "S$2,000 per
    // Insured Person, if death occurs outside Singapore as a result of an Accident" -- quoted, never dropped)
    const own = pb?.benefit.source === "label_line" ? r.conditions.find((c) => c.startsWith(pb.benefit.label)) : undefined;
    const rest = own?.slice(pb!.benefit.label.length).replace(/^\s*:\s*/, "").replace(/^(?:S\$|SGD\s?|US\$|\$)?\s?[\d,]+(?:\.\d+)?/, "").replace(/^[\s,;]+/, "").replace(/[.\s]+$/, "").trim();
    // (PR #72 E3, Evidence Reviewer 18: a benefit paid on death keeps, on a question about a death, the exclusions its own page prints
    // and the scheme's policy wording for it -- "reimburse ... up to" -- quoted from the same insurer's documents for that product)
    const extra: { line: string; quote: string; ev: string }[] = [];
    if (familiesOf(d.ctx.topicText ?? "").has("death") && /\b(?:death|dies|remains|repatriation)\b/i.test(`${r.benefit} ${rest ?? ""}`)) {
      const ex = await schemeLine(d, r, r.policy.product ?? r.benefit, /^Exclusions?:[^.]*\bdeath\b/i);
      // (what the wording says it meets -- "the reasonable cost of returning the remains to Singapore, up to $2,000" -- quoted without its
      // "we will reimburse": a quote never calls an amount a payment)
      const wording = /\b(?:remains|repatriat\w*|funeral|burial)\b/i.test(r.benefit) ? await schemeLine(d, r, productOf(r), /\breimburse\b[^.]*\b(?:remains|repatriat\w*|funeral|burial)\b[^.]*\bup to\b/i, r.policy.id, (l) => l.replace(/^.*?\breimburse\s+/i, "")) : null;
      for (const c of [wording, ex]) if (c) extra.push(c);
    }
    for (const c of extra) ev.push(c.ev);
    return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) prints ${pretty(r.benefit)}: ${amt}${rest ? `, with the printed condition “${rest.replace(/[“”]/g, "\"")}”` : ""}${extra.length ? `; ${quotes(extra)}` : ""}.`, evidence_ids: ev, value_ids: [],
      draft: { kind: "benefit_terms", short: pretty(r.benefit).replace(/^./, (c) => c.toUpperCase()), personName: who, amount, basis: null, conditions: [...(rest ? [rest.replace(/[“”]/g, "\"")] : []), ...extra.map((c) => c.line)], asOf: null, source: src() } };
  }
  if (p?.kind === "percent") return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) prints ${pretty(r.benefit)}: ${p.percent}%${p.of ? ` of the ${p.of}` : ""}.`, evidence_ids: ev, value_ids: [] };
  if (p?.kind === "reference") return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) defines ${pretty(r.benefit)} as the ${p.of}.`, evidence_ids: ev, value_ids: [] };
  return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) prints ${pretty(r.benefit)}.`, evidence_ids: ev, value_ids: [] };
}

/** PR #54 (rc-live-8): a benefit's printed paragraphs read as what it pays for, its cap word and its conditions: in the
 * paragraph printing the amount, the comma clause that pays ("we will pay the funeral expenses incurred") gives what
 * it is for, the clause printing the figure gives its cap word ("up to"), and every other clause is a condition, quoted
 * as printed. A paragraph not printing the amount is a condition whole. PR #72 E2a (Evidence Reviewer 18): the event the
 * amount depends on -- the printed "if" clause and the clauses that continue it, what it is for, and the figure clause's
 * own words without the figure ("for transportation ... to the Hospital", "a one-time amount per hospitalisation") -- is
 * also given as ONE leading "Only if ..." condition (`lead`), and `rest` is the conditions it does not already say. */
export function paidTerms(paras: string[], cents: number, passage = ""): { covers: string | null; cap: string | null; conditions: string[]; lead: string | null; rest: string[] } {
  const figure = (cents / 100).toLocaleString("en-SG", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  let covers: string | null = null, cap: string | null = null;
  const conditions: string[] = [];
  const PAYS = /\b(?:we|the insurer|the company|it)\s+(?:will|shall)\s+(?:pay|reimburse)\s+(?:for\s+)?(.+)$/i;
  let ifs: string[] = [], figureClause: string | null = null;
  for (const para of paras) {
    const hasFigure = para.includes(figure);
    if (!hasFigure && !PAYS.test(para)) { conditions.push(para.trim()); continue; }
    let open = false;
    for (const raw of para.split(/,\s+/)) {
      const c = raw.trim().replace(/[.;]$/, "");
      if (!c) continue;
      if (c.includes(figure)) { cap = /\b(up to|not exceeding|a maximum of|maximum of|limited to)\b/i.exec(c)?.[1]?.toLowerCase() ?? cap; figureClause ??= c; open = false; continue; }
      const m = PAYS.exec(c);
      if (m) { covers = m[1].trim(); open = false; continue; }
      conditions.push(c);
      // (the "if" clause and the clauses that continue it, up to the clause that pays or prints the figure)
      if (/^if\b/i.test(c) && !ifs.length) { ifs = [c]; open = true; } else if (open) ifs.push(c);
    }
  }
  cap ??= new RegExp(`\\b(up to|not exceeding|a maximum of|maximum of|limited to)\\s*(?:[A-Z]{0,3}\\$|SGD|USD)?\\s?${figure.replace(/[.,]/g, "\\$&")}\\b`, "i").exec(passage)?.[1]?.toLowerCase() ?? null;
  if (!ifs.length) return { covers, cap, conditions, lead: null, rest: conditions };
  const purpose = (figureClause ?? "").replace(new RegExp(`\\s*(?:(?:up to|not exceeding|limited to)\\s+)?(?:(?:a\\s+)?maximum of\\s+)?(?:of\\s+)?(?:[A-Z]{0,3}\\$|SGD\\s?|USD\\s?)?\\s?${figure.replace(/[.,]/g, "\\$&")}\\b`, "i"), "").replace(/^(?:we|the insurer|the company|it)\s+(?:will|shall)\s+(?:pay|reimburse)\s+/i, "").trim();
  const lead = `Only if ${ifs.join(", ").replace(/^if\s+/i, "")}${covers ? `, for ${covers}` : ""}${purpose ? `, ${/^(?:a|an|one)\b/i.test(purpose) ? "as " : ""}${purpose}` : ""}.`;
  return { covers, cap, conditions, lead, rest: conditions.filter((c) => !ifs.includes(c)) };
}

/** PR #72 E2a (Evidence Reviewer 18): a table row whose own page prints only its name and amount ("Accidental Hospital Recuperation
 * Benefit* S$250") is said with the conditions the same scheme's wording prints for the same benefit and the same amount -- the
 * person's record of that benefit under its own heading, in the same document or one with the same policy number. Null when none,
 * or more than one, is found. */
async function wordingOf(r: BenefitRecord, d: Deps): Promise<BenefitRecord | null> {
  if (r.printed?.kind !== "money" || r.personBenefit?.benefit.source === "section_heading") return null;
  const cents = r.printed.cents;
  const no = (x: BenefitRecord) => x.policy.groupPolicyNumber ?? x.policy.policyNumber;
  const { recordsFor } = await import("../tools");
  const same = (await recordsFor(d.ctx, r.memberId).catch(() => [] as BenefitRecord[])).filter((x) => x.id !== r.id
    && x.benefit.trim().toLowerCase() === r.benefit.trim().toLowerCase() && x.printed?.kind === "money" && x.printed.cents === cents
    && x.personBenefit?.benefit.source === "section_heading" && (x.policy.id === r.policy.id || (!!no(x) && no(x) === no(r))));
  return same.length === 1 ? same[0] : null;
}
/** The evidence for a wording's conditions: its passage's lines, without the line printing its amount (another document's bare "$250"
 * would put the row's own printed currency in doubt -- structured-answers J5s; the row's own line is the amount's evidence). */
async function conditionEvidence(w: BenefitRecord, cents: number, d: Deps): Promise<EvidenceRef[]> {
  const e = w.source.evidence;
  const pageText = (await pageMap(d.ctx.accountId, w.policy.id).catch(() => new Map<number, string>())).get(e.passage.onPage);
  if (!pageText || pageText.slice(e.passage.start, e.passage.end) !== e.passage.text) return [];
  const figure = (cents / 100).toLocaleString("en-SG", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const out: EvidenceRef[] = [];
  let at = e.passage.start, run: [number, number] | null = null;
  const close = () => { if (run) out.push(evidenceAt({ policyId: w.policy.id, documentHash: e.documentHash, page: e.passage.onPage, pageText, start: run[0], end: run[1], subjectId: w.memberId })); run = null; };
  for (const line of e.passage.text.split("\n")) {
    const end = at + line.length;
    if (line.includes(figure) || !line.trim()) close(); else run = run ? [run[0], end] : [at, end];
    at = end + 1;
  }
  close();
  return out;
}

/** The footnote(s) the page prints for the percentage's own row (fx-live-1: omitted), said IN the illustration's own sentence (a saved calculation is one complete sentence). */
const rowNote = (all: { marker: string; text: string }[] | undefined) => {
  const notes = (all ?? []).filter((n) => n.marker), under = (all ?? []).filter((n) => !n.marker);
  // (PR #57 follow-up, QC Q1: an unmarked condition printed under the table is the table's benefit's own condition, said with its amount)
  return (notes.length ? `; the page prints ${notes.length > 1 ? "footnotes" : "a footnote"} for that row: ${notes.map((n) => quoted(n.marker, n.text)).join(" and ")}` : "")
    // (without its own full stop: a saved calculation is ONE sentence, and a quoted "." would split it)
    + (under.length ? `; under the table it prints: ${under.map((n) => `“${noteText(n.text).replace(/[.!?]+$/, "")}”`).join(" and ")}` : "");
};
/** A calculation's result, written from the saved outcome (its case, percentage, base and document). */
/** The either/or group of an illustration: one person, one pair of alternative readings (here two documents' schedules; later the
 * catalog's amount alternatives for one benefit), and one injury -- the row's case without its kind label ("Arm , Elbow, Wrist or Ribs"
 * and "Arm, Elbow, Wrist or Ribs (Other Fracture)" are one injury). Null when the row names no case: such an amount stays ungrouped. */
export function alternativeGroupId(memberId: string, pair: string[], rowLabel: string): string | null {
  const injury = rowLabel.replace(/\([^)]*\)/g, "").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim().toLowerCase();
  return injury ? `alt:${memberId}:${[...pair].sort().join("|")}:${injury}` : null;
}
export function renderCalculation(resultId: string, d: Deps, alt?: { label: string; page: number; group?: string | null }): string | null {
  const c = calcOutcomes(d.ctx).get(resultId);
  if (!c) return null;
  const who = d.nameOf(c.subjectId) ?? "this person";
  const product = [...(d.ctx.benefitRecords?.values() ?? [])].find((r) => r.policy.id === c.policyId)?.policy.product ?? d.state.docNames?.[c.policyId] ?? "the policy document";
  const money = (v: number, cur: string | null) => formatMoney(Math.round(v * 100), cur ?? "SGD");
  if (c.kind === "conditional_illustration" && c.calculator === "lump_sum" && c.amount != null) {
    const ops = (c.record?.operands ?? []).filter((o) => o.source === "document");
    const pct = ops.find((o) => o.unit === "percent"), base = ops.find((o) => o.unit === "money");
    // A sum insured a certificate prints "As of 06/10/2022" is that date's amount: the date is said with it, read from the very
    // passage that binds the amount (production fracture conversation, 19 Oct 2026: the S$600,000 base was shown undated).
    const baseAsOf = base?.role === "sum_insured" ? cellDate(/\bas\s+(?:of|at)\s+(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})/i.exec(String((base as { binding?: { passage?: string } }).binding?.passage ?? ""))?.[1] ?? "") : null;
    const baseDate = baseAsOf ? `, printed as of ${new Date(baseAsOf + "T00:00:00Z").toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}, not confirmation of cover on a later date` : "";
    const baseText = !base ? "" : base.role === "sum_insured" ? `${who}'s sum insured of ${money(Number(base.value), base.currency)} (${pretty(base.label, [...(d.ctx.benefitRecords?.values() ?? [])].map((r) => r.policy.product))}${baseDate})` : `the ${pretty(base.label)} of ${money(Number(base.value), base.currency)}`;
    // (the household's own words stay in the record as provenance; the statement says the resolved case, never a quotation)
    const said = "";
    const named = /\b(?:benefit|allowance|cover|compensation)\b/i.test(c.benefit) ? c.benefit : `${c.benefit} benefit`;
    // (a row the document itself labels with a case name in brackets -- "(Other Fracture)" -- says so: its applicability to
    // the reported event is the document's to define, and these documents print no definition of it)
    const label = pct ? pct.label.replace(/\s*\(([^)]*\bFracture)\)\s*$/i, "") : "";
    const tagged = pct ? /\(([^)]*\bFracture)\)\s*$/i.exec(pct.label)?.[1] : null;
    // (C4, Policy Evidence Reviewer / UX on C3: beside that figure, plainly: what is not defined, the household's own reported kind of
    // fracture, and that the insurer decides)
    const kind = tagged ? reportedValue(ATTRIBUTES[0], d.ctx.reportedFacts?.get(c.subjectId) ?? []).value : null;
    // (C6, Test engineer on C5: an untagged row of a benefit that names both kinds -- "Simple Fracture or Other Fracture due to Accident",
    // "Hip" -- carries the same plain note after a correction as a labelled row does: neither kind is defined here)
    const bothKinds = !tagged && /\bSimple Fracture\b[^.]*\bOther Fracture\b/i.test(c.benefit) && ![...(d.ctx.benefitRecords?.values() ?? [])].some((r) => r.policy.id === c.policyId && r.definitions.length);
    const undefinedNote = bothKinds ? " (the benefit names Simple Fracture and Other Fracture alike, and this row is labelled as neither; these documents do not define either kind, so the insurer decides how it applies)" : tagged ? ` (the row the document labels “${tagged}”; these documents do not define which fractures count as ${tagged}${kind ? `, or whether a${kind === "open" ? "n" : ""} ${kind} fracture is one` : ""}, so the insurer decides whether it applies)` : "";
    // (Evidence Reviewer E1: the cause the benefit's own lead-in prints before its table -- "If an Insured Person sustains bodily injury as a
    // result of an Accident, which results in ..." -- travels with the amount; read from the table's own page, never assumed)
    const sched = [...(d.ctx.benefitRecords?.values() ?? [])].find((r) => r.kind === "percentage_schedule" && r.policy.id === c.policyId && r.benefit === c.benefit && r.schedule)?.schedule;
    const lead = sched ? sched.pageText.slice(Math.max(0, sched.table.headerStart - 600), sched.table.headerStart).replace(/\s+/g, " ") : "";
    const cause = /\bbodily injury as a result of an Accident\b/i.test(lead) ? "bodily injury as a result of an Accident" : null;
    const causeText = cause ? `, and only if it results from ${cause} (as the page prints)` : "";
    const full = `If the ${named} applies${pct ? ` to ${who}'s case “${label}”${undefinedNote}` : ""}${causeText}${said}, the conditional illustration is ${money(c.amount, c.currency)}${pct && base ? `: ${pct.value}% of ${baseText}` : ""}${alt ? `, in the ${alt.label} (page ${alt.page})` : `, under the ${product}`}; it is an illustration from the document's terms, not a payment or an insurer's decision${rowNote(c.record?.rowNotes)}.`;
    // (answer shape: the same statement as fields -- the case and its own conditions stay with the amount; the document, page, row label and
    // the date the base was printed move to where it comes from)
    const baseShort = !base ? "" : base.role === "sum_insured" ? `${who}'s sum insured of ${money(Number(base.value), base.currency)}` : `the ${pretty(base.label)} of ${money(Number(base.value), base.currency)}`;
    const notes = c.record?.rowNotes ?? [];
    const conditions = [
      // (UX designer on PR #70: the card's text is a label; its "if" and "not a decision" travel here, with the amount)
      `Only if the ${named} applies${pct ? ` to ${who}'s case` : ""}; an illustration from the document's terms, not a payment or an insurer's decision.`,
      ...(cause ? [`Only if it results from ${cause}.`] : []),
      ...(undefinedNote ? [undefinedNote.trim().replace(/^\(|\)$/g, "").replace(/^./, (x) => x.toUpperCase()) + "."] : []),
      ...notes.map((n) => noteText(n.text).replace(/[.!?]+$/, "") + "."),
    ];
    const marked = notes.find((n) => n.marker);
    structure(d, full, { kind: "calculation", short: `${named.replace(/ benefit$/i, "").replace(/^./, (x) => x.toUpperCase())}${pct ? ` · ${label}` : ""}`, personName: who,
      amount: { text: money(c.amount, c.currency), currencyResolved: true, illustration: true }, basis: pct && base ? `${pct.value}% of ${baseShort}` : null, conditions, asOf: baseAsOf ?? null,
      source: { policyName: alt?.label ?? product, page: alt?.page ?? null, rowLabel: pct?.label ?? null, footnote: marked ? { marker: marked.marker, text: noteText(marked.text) } : null, note: undefinedNote ? undefinedNote.trim().replace(/^\(|\)$/g, "") : null },
      // (Critic R23-2: only the illustrations the two-document relation note re-rendered are alternatives to each other)
      ...(alt?.group ? { group: { id: alt.group, kind: "either_or" as const, note: "These are alternatives from different documents, never a total. The documents don't say which one applies; the insurer decides." } } : {}) });
    return full;
  }
  if ((c.kind === "indicative_estimate" || c.kind === "conditional_illustration") && c.amount != null) {
    const rate = c.printed.find((x) => x.unit === "money");
    return `${c.kind === "indicative_estimate" ? "Indicative estimate" : "Conditional illustration"} for ${who} under the ${c.benefit} of the ${product}: ${money(c.amount, c.currency)}${rate ? `, from the printed ${pretty(rate.label)} of ${money(rate.value, rate.currency)}` : ""}; it is not a payment or an insurer's decision.`;
  }
  return c.unresolvedText || null;
}

/** Writes every server-rendered statement and next step of a final_answer / ask_user call in place. Returns problems
 * the model must fix (an id this turn did not produce), or [] when every statement could be written. */
export async function renderStatements(args: Record<string, unknown>, list: Record<string, unknown>[] | undefined, d: Deps): Promise<string[]> {
  const problems: string[] = [];
  const omitted: number[] = [];
  for (const [i, s] of (list ?? []).entries()) {
    if (!s || typeof s !== "object") continue;
    const kind = typeof s.kind === "string" ? s.kind : null;
    if (kind === "calculation") {
      const rid = typeof s.result_id === "string" ? s.result_id : null;
      const text = rid ? renderCalculation(rid, d) : null;
      if (!text) { problems.push(`statement ${i + 1}: kind calculation needs the result_id of an evaluate_benefit result from this turn`); continue; }
      s.text = text; RENDERED.add(s);
    } else if (kind === "benefit_terms") {
      const bid = typeof s.benefit_id === "string" ? s.benefit_id : null;
      const r = bid ? d.ctx.benefitRecords?.get(bid) : undefined;
      if (!r) { problems.push(`statement ${i + 1}: kind benefit_terms needs a benefit_id that person_benefits returned this turn`); continue; }
      const w = await renderTerms(r, d);
      s.text = w.text; // Agent R (dj-live-2): a server-written statement is bound ONLY by the bindings its record gives. A model-supplied value
  // id (a stray "v1" of another table) merged into it made verification reject a sound statement and lose its amount.
      s.evidence_ids = [...new Set(w.evidence_ids)]; s.value_ids = [...new Set(w.value_ids)];
      s.subject_id ??= r.memberId; s.benefit ??= r.benefit; RENDERED.add(s);
    } else if (kind === "not_found") {
      // fx-live-1 K6a / K6b: "the documents do not describe X" is a claim about a search scope. The server reads the full text of
      // the scope (./absence-scope.ts); a statement the documents contradict is sent back with the lines that print it.
      const subject = typeof s.subject_id === "string" && s.subject_id ? s.subject_id : typeof args.subject_id === "string" && args.subject_id ? args.subject_id : d.state.subjectId ?? null;
      const members = await loadMembers(d.ctx.accountId);
      const r = await checkNotFound(d.ctx.accountId, s, { subjectId: subject, who: d.nameOf(subject) ?? null, names: members.flatMap((m) => [m.displayName, m.preferredName ?? ""]).filter(Boolean) });
      if (!r.ok) {
        if (r.partial) d.ctx.partialAbsence = { ...r.partial, subjectId: r.partial.check.subjectId, used: false };
        // PR #57 follow-up (DC's GP-bill answer): the same absence refused again for what the documents print -- the model could not say
        // those lines -- is replaced by the server quoting them, cited (never an absence, never a verdict).
        // (a repeat: an earlier call of this turn was already refused with exactly this problem)
        if (r.printed && list && (d.priorErrors?.() ?? []).some((e) => e.includes(r.problem))) {
          const q = r.printed.length ? quotePrinted(r.printed, d.evidenceId, subject) : null;
          // (a new statement in its place: the model's own not_found statement is left as it was sent)
          if (q) { const n = { kind: "fact", ...q, ...(subject ? { subject_id: subject } : {}) }; RENDERED.add(n); QUOTED.add(n); list[i] = n; continue; }
          // (critic round 5 F1: nothing quotable -- only a scheme's bare list of its policies -- so the statement is left out, and the rest of
          // the reply, or the server's fallback for a reported bill, answers)
          omitted.push(i); continue;
        }
        problems.push(`statement ${i + 1}: ${r.problem}`); continue;
      }
      s.text = r.text; if (r.check.subjectId) s.subject_id = r.check.subjectId; RENDERED.add(s); ABSENCE_OF.set(s, r.check);
      // fx-live-2 review: NO passage is cited for an absence. The household sees which documents were checked in the sentence itself, and
      // the evidence for the scope is the saved check (ChatAnswer.absenceChecks: each document's id, name, file hash and revision, and the
      // terms searched), which also withdraws the answer when one of those documents is deleted or replaced (lib/chat/stale-answers.ts).
      // The last passage read from each document (an amount row, a footnote, a claim condition) says nothing about the topic, and listing
      // it under Sources made a dental answer cite a S$300,000 row.
      s.evidence_ids = [];
    }
  }
  if (list) for (const i of omitted.reverse()) list.splice(i, 1);
  // PR #57 follow-up: an absence refused earlier this turn only because part of its scope was not stored is answered with what WAS read,
  // written by the server (absence-scope.ts), when the reply that follows states no absence of its own -- never the "couldn't confirm" note.
  const pa = d.ctx.partialAbsence;
  // (critic round 5 F3: only in a reply about the same person the refused absence was about)
  const replySubject = typeof args.subject_id === "string" && args.subject_id ? args.subject_id : d.state.subjectId ?? null;
  if (list && pa && !pa.used && !problems.length && (pa.subjectId ?? null) === replySubject && !list.some((s) => s && typeof s === "object" && s.kind === "not_found")) {
    const n = { kind: "not_found", text: pa.text, evidence_ids: [], subject_id: pa.subjectId } as Record<string, unknown>;
    RENDERED.add(n); ABSENCE_OF.set(n, pa.check); list.push(n); pa.used = true;
  }
  // (PR #72 E2a, Evidence Reviewer 18: a household asking about a doctor's or outpatient bill hears that the scheme names an outpatient
  // policy the person's own certificate does not list -- as found, dated, with who confirms -- when the reply does not already say it)
  if (list && !problems.length && replySubject && /\b(?:GP|doctor\w*|clinic|outpatient|consultation)\b/i.test(d.ctx.topicText ?? "") && !list.some((s) => /\bwhich that certificate does not list\b/.test(String(s?.text ?? "")))) {
    const u = await unlistedSchemePolicy(d.ctx.accountId, replySubject, d.nameOf(replySubject) ?? null, /\b(?:outpatient|clinic|GP|medic\w*)\b/i).catch(() => null);
    const ids = (u?.printed ?? []).map((l) => evidenceFor({ policyId: l.policyId, documentHash: l.fileHash, page: l.page, pageText: l.pageText, passage: l.line, subjectId: replySubject })).filter((x): x is EvidenceRef => !!x).map((ref) => d.evidenceId(ref, "printed"));
    if (u && ids.length) { const n = { kind: "fact", text: u.text, evidence_ids: ids, subject_id: replySubject } as Record<string, unknown>; RENDERED.add(n); list.push(n); }
  }
  let relationAsked = false;
  // Two documents of one scheme printing a percentage table for the same kind of event, each with its own base: said once,
  // from the records (their documents, pages and bases), that the documents give no relationship between them.
  if (list) {
    const rendered = list.filter((s) => s && typeof s === "object" && s.kind === "calculation" && RENDERED.has(s));
    const outs = rendered.map((s) => calcOutcomes(d.ctx).get(String(s.result_id))).filter((c): c is NonNullable<typeof c> => !!c && c.calculator === "lump_sum");
    const recs = outs.map((c) => [...(d.ctx.benefitRecords?.values() ?? [])].find((r) => r.kind === "percentage_schedule" && r.policy.id === c.policyId && r.benefit === c.benefit && r.memberId === c.subjectId)).filter((r): r is BenefitRecord => !!r);
    // (a benefit_terms statement that presents a schedule counts like a calculation on it: the relationship is as unestablished before any amount)
    const shown = list.filter((s) => s && typeof s === "object" && s.kind === "benefit_terms" && RENDERED.has(s)).map((s) => d.ctx.benefitRecords?.get(String(s.benefit_id))).filter((r): r is BenefitRecord => !!r && r.kind === "percentage_schedule");
    for (const r of shown) if (!recs.some((x) => x.id === r.id)) recs.push(r);
    const [a, b] = [recs[0], recs.find((r) => r.policy.id !== recs[0]?.policy.id)];
    const already = list.some((s) => !!s && typeof s === "object" && RELATION.has(s));
    if (already) relationAsked = true;
    if (a && b && !already && a.schedule && b.schedule && a.memberId === b.memberId && a.policy.documentRole !== "amendment" && b.policy.documentRole !== "amendment" && !a.policy.personalProof && !b.policy.personalProof) {
      const baseOf = (r: BenefitRecord) => { const x = r.schedule!.base; return x.kind === "fixed_limit" ? `a fixed ${x.label}` : x.kind === "sum_insured" ? `${r.memberName}'s own sum insured` : "an amount the document does not establish"; };
      // What separates the two documents: each one's own standing (a summary that sends the reader to the certificate for the precise terms,
      // a certificate that says it is not the contract), read from its stored pages and cited -- never inferred (./relation.ts).
      const [pa, pb] = await Promise.all([profileDocument(d.ctx.accountId, a.policy), profileDocument(d.ctx.accountId, b.policy)]);
      let la = documentLabel(a.policy, pa), lb = documentLabel(b.policy, pb);
      if (la === lb) { la = `${la} (page ${a.schedule.page})`; lb = `${lb} (page ${b.schedule.page})`; }
      const frame = `${a.memberName}'s documents give two different answers for ${outs.length > 0 ? "this event" : "the same kind of event"}, and what they say does not settle which applies: these are alternatives from separate documents, never a total.`;
      const standing = [standingClause(la, pa), standingClause(lb, pb)].filter((x): x is string => !!x);
      const status = [`The ${la} (page ${a.schedule.page}) takes its percentage of ${baseOf(a)}; the ${lb} (page ${b.schedule.page}) takes its percentage of ${baseOf(b)}.`, ...standing, "Neither document says whether one amends, replaces or adds to the other." /* (which applies is said once, in the frame above: PR #57 follow-up, K3t1 repetition) */].join(" ");
      const clauseEv = [...pa.clauses, ...pb.clauses].map((c) => d.evidenceId(c.evidence, "standing"));
      const both = [d.evidenceId(a.source.evidence), d.evidenceId(b.source.evidence)];
      // (answer shape, UX tester: the notes cite the rows shown and a fixed base, never the whole table's span -- whose refined sentence
      // could be an unrelated clause on the same page, such as a disappearance at sea)
      // (answer shape, UX tester: what the notes are SHOWN citing is the rows shown and a fixed base -- never the whole table's span, whose
      // refined sentence can be an unrelated clause on the same page, such as a disappearance at sea. Only spans already in this
      // conversation's evidence: a new evidence id here would renumber every later one. The notes' own evidence, which the loop reasons
      // over, is unchanged.)
      const known = (ref: EvidenceRef) => { const k = evidenceKey(ref); return Object.values(d.state.evidence).find((e) => evidenceKey(e) === k)?.id ?? null; };
      const shownRows = (r: BenefitRecord) => {
        const labels = outs.filter((c) => c.policyId === r.policy.id).flatMap((c) => (c.record?.operands ?? []).filter((o) => o.unit === "percent").map((o) => o.label));
        const base = r.schedule!.base;
        return [...r.schedule!.rows.filter((x) => labels.includes(x.label)).map((x) => known(x.evidence)), ...(base.kind === "fixed_limit" ? [known(base.evidence)] : [])].filter((x): x is string => !!x);
      };
      const rowsCited = [shownRows(a), shownRows(b)];
      const cite = rowsCited.every((x) => x.length) ? [...new Set(rowsCited.flat())] : both;
      const note1 = { kind: "uncertainty", text: frame, evidence_ids: both, subject_id: a.memberId } as Record<string, unknown>;
      const note2 = { kind: "uncertainty", text: status, evidence_ids: [...new Set([...both, ...clauseEv])], subject_id: a.memberId } as Record<string, unknown>;
      // PR #57 follow-up (K3t1, K4b: the relation said three or four times): a figure-free uncertainty the MODEL wrote that cites nothing beyond
      // what these two notes cite (the two schedule rows and the documents' standing clauses) says what they say, and is replaced by them.
      // Anything citing another passage stays (a row's own printed condition, such as "can only be claimed either under the Core Scheme or
      // Voluntary Scheme", cites its own line).
      const covered = new Set([...both, ...clauseEv]);
      for (let k = list.length - 1; k >= 0; k--) {
        const x = list[k];
        if (!x || typeof x !== "object" || x.kind !== "uncertainty" || RENDERED.has(x)) continue;
        const ids = Array.isArray(x.evidence_ids) ? (x.evidence_ids as unknown[]).map(String) : [];
        if (!ids.length || !ids.every((id) => covered.has(id))) continue;
        if (x.subject_id != null && x.subject_id !== a.memberId) continue;
        // (a figure: an amount or a percentage -- a document's own name, "Certificate of Insurance Part 2", is not one)
        if (/(?:[A-Z]{0,3}\$|\b(?:SGD|USD|MYR|EUR|GBP)\s?)\d|\d(?:[.,]\d+)?\s*(?:%|per ?cent)/i.test(String(x.text ?? ""))) continue;
        list.splice(k, 1);
        d.superseded?.(String(x.text ?? ""));
      }
      for (const n of [note1, note2]) { RENDERED.add(n); RELATION.add(n); list.push(n); }
      // (answer shape: the frame is the one caution line; the comparison of bases and standing stays in "where this comes from")
      const both2 = { policyName: `${la} and ${lb}`, page: null, rowLabel: null, footnote: null };
      structure(d, frame, { kind: "uncertainty", short: "The documents give two different answers and don't say which one applies. They are alternatives, not a total.", personName: a.memberName, amount: null, basis: null, conditions: [], asOf: null, source: { ...both2, note: null, citeIds: cite } });
      structure(d, status, { kind: "uncertainty", short: "Neither document says whether one amends, replaces or adds to the other.", personName: a.memberName, amount: null, basis: null, conditions: [], asOf: null, source: { ...both2, note: status, citeIds: [...new Set([...cite, ...clauseEv])] } });
      // (the two illustrations name their document and page; each stays one complete sentence, with its own not-a-payment clause)
      for (const sx of rendered) {
        const out = calcOutcomes(d.ctx).get(String(sx.result_id));
        // (Critic R24-2: the group is this note's own pair -- the two schedules, by benefit and document -- and only their illustrations join it)
        // (Critic R24-2, Evidence Reviewer 16: the group is this note's own pair of schedules AND one injury -- the row's case, read without
        // its kind label: "Arm , Elbow, Wrist or Ribs" and "Arm, Elbow, Wrist or Ribs (Other Fracture)" -- so a hip and an arm are two
        // separate either/or choices, never one choice across four amounts; a row with no partner in the other document stays ungrouped)
        const row = (out?.record?.operands ?? []).find((o) => o.unit === "percent")?.label ?? "";
        const group = out && ((out.policyId === a.policy.id && out.benefit === a.benefit) || (out.policyId === b.policy.id && out.benefit === b.benefit)) ? alternativeGroupId(a.memberId ?? "", [a.id, b.id], row) : null;
        const which = out?.policyId === a.policy.id ? { label: la, page: a.schedule.page, group } : out?.policyId === b.policy.id ? { label: lb, page: b.schedule.page, group } : null;
        const t = which ? renderCalculation(String(sx.result_id), d, which) : null;
        if (t) sx.text = t;
      }
      relationAsked = true;
    }
  }
  // next steps: "contact:<policy_id>" is written as that document's own insurer, never a model-named one
  if (Array.isArray(args.next_steps)) {
    const CONTACT = /^\s*contact:\s*(\S+)\s*$/i;
    const docs = (args.next_steps as unknown[]).some((x) => typeof x === "string" && CONTACT.test(x)) ? await loadDocs(d.ctx.accountId) : [];
    const subject = typeof args.subject_id === "string" ? args.subject_id : d.state.subjectId ?? null;
    const links = docs.length ? await loadLinks(d.ctx.accountId, docs.map((x) => x.id)) : [];
    const insurersSaid = new Set<string>();
    args.next_steps = (args.next_steps as unknown[]).map((x, i) => {
      const m = typeof x === "string" ? CONTACT.exec(x) : null;
      if (!m) return x;
      const t = contactTarget(docs, links, subject, m[1]);
      if ("refused" in t) { problems.push(`next step ${i + 1}: ${t.refused}`); return null; }
      const doc = t.doc;
      // one contact step per insurer (two documents of one scheme are one call to make)
      if (insurersSaid.has(doc.insurer!.trim().toLowerCase())) return null;
      insurersSaid.add(doc.insurer!.trim().toLowerCase());
      const group = /\bgroup\b|\bscheme\b/i.test(`${doc.productName ?? ""} ${doc.policyType ?? ""}`);
      const step = `Contact ${doc.insurer}${group ? " (through the employer or scheme administrator, for this group scheme)" : ""} about the ${doc.productName ?? "policy"} to ask ${relationAsked ? "which of the two schedules applies to this event, and " : ""}what it needs for a claim.`;
      RENDERED_STEPS.add(step);
      return step;
    }).filter((x) => x != null);
  }
  return problems;
}

/**
 * Reliable chat: the document a contact step may name, for this person. Only a PERSONAL policy document linked to them
 * (their certificate / schedule), or a reference document (wording, benefit summary) linked to them that belongs to one
 * of those personal policies -- the same policy or group policy number -- in which case the step names the personal
 * policy's insurer and product. Never: a document linked to nobody, a reference document with no personal policy of
 * theirs behind it (linked but unconfirmed), an unrelated product, or another person's policy.
 */
export function contactTarget(docs: DocRow[], links: LinkRow[], subject: string | null, docId: string): { doc: DocRow; via: "personal" | "reference" } | { refused: string } {
  const doc = docs.find((p) => p.id === docId);
  if (!doc) return { refused: `contact:${docId} is not one of the household's current documents` };
  if (!subject) return { refused: "contact:<policy_id> needs the person the step is for (subject_id)" };
  const linked = (id: string) => links.some((l) => l.policyId === id && l.memberId === subject);
  if (!linked(doc.id)) return { refused: `contact:<policy_id> must be a document linked to this person; ${doc.productName ?? "that document"} is not` };
  const personal = docs.filter((p) => p.personalCoverageConfirmed && linked(p.id) && !!p.insurer?.trim());
  if (doc.personalCoverageConfirmed && doc.insurer?.trim()) return { doc, via: "personal" };
  const num = (v: string | null) => (v ?? "").replace(/\s+/g, "").toUpperCase();
  const owner = personal.find((p) => (num(p.policyNumber) && num(p.policyNumber) === num(doc.policyNumber)) || (num(p.groupPolicyNumber) && (num(p.groupPolicyNumber) === num(doc.groupPolicyNumber) || num(p.groupPolicyNumber) === num(doc.policyNumber))));
  if (owner) return { doc: owner, via: "reference" };
  return { refused: `contact:<policy_id> must be this person's own policy document, or wording that belongs to it (the same policy number); ${doc.productName ?? "that document"} is reference wording with no personal policy of theirs behind it -- do not suggest contacting its insurer` };
}

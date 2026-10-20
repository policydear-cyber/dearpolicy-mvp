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
import { evidenceAt, evidenceFor, type EvidenceRef } from "../evidence";
import type { RagLoopState } from "./types";
import { calcOutcomes } from "../calc/tool";
import { personAmountValue } from "../evaluate";
import { formatMoney, printedAmount, type BenefitRecord } from "../benefit-records";
import { loadDocs, loadLinks, loadMembers, pageMap, type DocRow, type LinkRow } from "../store";
import { cellDate } from "../tables";
import { ATTRIBUTES, reportedValue } from "../applicability";
import { documentLabel, profileDocument, standingClause } from "./relation";
import { checkNotFound, type AbsenceCheck, type PrintedLine } from "./absence-scope";

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
async function tripLimits(r: BenefitRecord, d: Deps): Promise<{ text: string; evidence: EvidenceRef[] } | null> {
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
  return { text: ` The schedule prints this cover for ${listOf(out.map((x) => `${x.label.toLowerCase() === "insured person" ? "the insured person" : x.label.toLowerCase() === "period of insurance" ? "the period of insurance" : "the destination"} “${x.value}”`))}; whether that trip fits this event is for the insurer to confirm.`, evidence: out.map((x) => x.ev) };
}
export async function renderTerms(r: BenefitRecord, d: Deps): Promise<{ text: string; evidence_ids: string[]; value_ids: string[] }> {
  const w = await renderTermsBody(r, d);
  const trip = await tripLimits(r, d);
  return trip ? { text: w.text + trip.text, evidence_ids: [...new Set([...w.evidence_ids, ...trip.evidence.map((e) => d.evidenceId(e))])], value_ids: w.value_ids } : w;
}
async function renderTermsBody(r: BenefitRecord, d: Deps): Promise<{ text: string; evidence_ids: string[]; value_ids: string[] }> {
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
    if (r.applicability === "person_row") { const v = r.personBenefit ? await personAmountValue(d.ctx, r.personBenefit, r.memberName, r.memberId) : null; return { text: `${who}'s ${docName(r)} lists ${pretty(r.benefit)} of ${amt}${r.asOf ? ` as of ${fmtDate(r.asOf)}` : ""}.`, evidence_ids: ev, value_ids: v ? [v] : [] }; }
    // PR #54 (rc-live-8): a benefit printed under its own heading, or a row with a footnote, is said in ONE sentence with
    // its name, its section, what it is for, its amount -- or that the document leaves the currency of its bare "$"
    // unstated -- and its own printed conditions, quoted from its own lines (with their own evidence). The clause that
    // pays the amount is said by the server ("for <what>, up to <amount>"), never quoted as a promise ("we will pay").
    const pb = r.personBenefit;
    if (pb && (pb.benefit.source === "section_heading" || pb.conditionSources?.length)) {
      for (const e of pb.conditionSources ?? []) ev.push(d.evidenceId(e));
      const doc = r.policy.product ?? "document";
      const sec = pb.benefit.section && pb.benefit.section !== pb.benefit.label ? `, under “${pb.benefit.section}”` : "";
      const t = paidTerms(r.conditions, p.cents, pb.source.passage);
      const figure = p.currency ? amt : `${(p.cents / 100).toLocaleString("en-SG", { minimumFractionDigits: p.cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}${p.unit ? " " + p.unit : ""} (printed with a bare “$” sign; the ${doc} does not say which currency)`;
      const conds = t.conditions.map((c) => `“${c.replace(/[“”]/g, "\"")}”`);
      const list = conds.length > 1 ? `${conds.slice(0, -1).join(", ")} and ${conds.at(-1)}` : conds[0] ?? "";
      return { text: `The ${doc} (page ${r.source.page}${sec}) prints the ${pretty(r.benefit)}${t.covers ? ` for ${t.covers}` : ""}, ${t.cap ? t.cap + " " : ""}${figure}${list ? `, with the printed condition${conds.length > 1 ? "s" : ""} ${list}` : ""}.`, evidence_ids: ev, value_ids: [] };
    }
    // (PR #57 follow-up, UX L2: a one-line benefit keeps the condition printed on its own line after the amount -- "S$2,000 per
    // Insured Person, if death occurs outside Singapore as a result of an Accident" -- quoted, never dropped)
    const own = pb?.benefit.source === "label_line" ? r.conditions.find((c) => c.startsWith(pb.benefit.label)) : undefined;
    const rest = own?.slice(pb!.benefit.label.length).replace(/^\s*:\s*/, "").replace(/^(?:S\$|SGD\s?|US\$|\$)?\s?[\d,]+(?:\.\d+)?/, "").replace(/^[\s,;]+/, "").replace(/[.\s]+$/, "").trim();
    return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) prints ${pretty(r.benefit)}: ${amt}${rest ? `, with the printed condition “${rest.replace(/[“”]/g, "\"")}”` : ""}.`, evidence_ids: ev, value_ids: [] };
  }
  if (p?.kind === "percent") return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) prints ${pretty(r.benefit)}: ${p.percent}%${p.of ? ` of the ${p.of}` : ""}.`, evidence_ids: ev, value_ids: [] };
  if (p?.kind === "reference") return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) defines ${pretty(r.benefit)} as the ${p.of}.`, evidence_ids: ev, value_ids: [] };
  return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) prints ${pretty(r.benefit)}.`, evidence_ids: ev, value_ids: [] };
}

/** PR #54 (rc-live-8): a benefit's printed paragraphs read as what it pays for, its cap word and its conditions: in the
 * paragraph printing the amount, the comma clause that pays ("we will pay the funeral expenses incurred") gives what
 * it is for, the clause printing the figure gives its cap word ("up to"), and every other clause is a condition, quoted
 * as printed. A paragraph not printing the amount is a condition whole. */
export function paidTerms(paras: string[], cents: number, passage = ""): { covers: string | null; cap: string | null; conditions: string[] } {
  const figure = (cents / 100).toLocaleString("en-SG", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  let covers: string | null = null, cap: string | null = null;
  const conditions: string[] = [];
  const PAYS = /\b(?:we|the insurer|the company|it)\s+(?:will|shall)\s+(?:pay|reimburse)\s+(?:for\s+)?(.+)$/i;
  for (const para of paras) {
    const hasFigure = para.includes(figure);
    if (!hasFigure && !PAYS.test(para)) { conditions.push(para.trim()); continue; }
    for (const raw of para.split(/,\s+/)) {
      const c = raw.trim().replace(/[.;]$/, "");
      if (!c) continue;
      if (c.includes(figure)) { cap = /\b(up to|not exceeding|a maximum of|maximum of|limited to)\b/i.exec(c)?.[1]?.toLowerCase() ?? cap; continue; }
      const m = PAYS.exec(c);
      if (m) { covers = m[1].trim(); continue; }
      conditions.push(c);
    }
  }
  cap ??= new RegExp(`\\b(up to|not exceeding|a maximum of|maximum of|limited to)\\s*(?:[A-Z]{0,3}\\$|SGD|USD)?\\s?${figure.replace(/[.,]/g, "\\$&")}\\b`, "i").exec(passage)?.[1]?.toLowerCase() ?? null;
  return { covers, cap, conditions };
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
export function renderCalculation(resultId: string, d: Deps, alt?: { label: string; page: number }): string | null {
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
    const undefinedNote = tagged ? ` (the row the document labels “${tagged}”; these documents do not define which fractures count as ${tagged}${kind ? `, or whether a${kind === "open" ? "n" : ""} ${kind} fracture is one` : ""}, so the insurer decides whether it applies)` : "";
    return `If the ${named} applies${pct ? ` to ${who}'s case “${label}”${undefinedNote}` : ""}${said}, the conditional illustration is ${money(c.amount, c.currency)}${pct && base ? `: ${pct.value}% of ${baseText}` : ""}${alt ? `, in the ${alt.label} (page ${alt.page})` : `, under the ${product}`}; it is an illustration from the document's terms, not a payment or an insurer's decision${rowNote(c.record?.rowNotes)}.`;
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
      // (the two illustrations name their document and page; each stays one complete sentence, with its own not-a-payment clause)
      for (const sx of rendered) {
        const out = calcOutcomes(d.ctx).get(String(sx.result_id));
        const which = out?.policyId === a.policy.id ? { label: la, page: a.schedule.page } : out?.policyId === b.policy.id ? { label: lb, page: b.schedule.page } : null;
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

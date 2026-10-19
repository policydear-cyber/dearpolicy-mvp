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
import type { EvidenceRef } from "../evidence";
import type { RagLoopState } from "./types";
import { calcOutcomes } from "../calc/tool";
import { personAmountValue } from "../evaluate";
import { formatMoney, printedAmount, type BenefitRecord } from "../benefit-records";
import { loadDocs, loadLinks, type DocRow, type LinkRow } from "../store";
import { cellDate } from "../tables";

/** Statements the server wrote (never split, never re-edited by the composer). Not a tool parameter: kept aside. */
export const RENDERED = new WeakSet<object>();
/** The relationship note between two documents' tables (written once per answer). */
const RELATION = new WeakSet<object>();
/** Contact steps the server wrote for a document linked to the answer's person (checked here, not re-judged by text). */
export const RENDERED_STEPS = new Set<string>();
export const STATEMENT_KINDS = ["fact", "calculation", "benefit_terms", "uncertainty", "suggestion", "library_status"] as const;
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
const docName = (r: BenefitRecord) => (r.policy.personalProof && /certificate/i.test(r.policy.product ?? "") ? "certificate" : r.policy.product ?? "document");

type Deps = { ctx: ToolContext; state: RagLoopState; evidenceId: (ref: EvidenceRef) => string; nameOf: (id: string | null | undefined) => string | null };

/** A benefit's printed terms, written from its record (with the evidence and value ids that bind each figure). */
export async function renderTerms(r: BenefitRecord, d: Deps): Promise<{ text: string; evidence_ids: string[]; value_ids: string[] }> {
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
    return { text: `The ${r.policy.product ?? "document"} (page ${s.page}) pays the ${r.benefit} as a percentage of ${base} for each listed case: ${cases}.${none}${missing}`, evidence_ids: ev, value_ids: vals };
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
    return { text: `The ${r.policy.product ?? "document"} (page ${r.source.page}) prints ${pretty(r.benefit)}: ${amt}.`, evidence_ids: ev, value_ids: [] };
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

/** A calculation's result, written from the saved outcome (its case, percentage, base and document). */
export function renderCalculation(resultId: string, d: Deps): string | null {
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
    return `If the ${named} applies${pct ? ` to ${who}'s case “${label}”${tagged ? ` (the row the document labels “${tagged}”; these documents print no definition of which fractures that is)` : ""}` : ""}${said}, the conditional illustration is ${money(c.amount, c.currency)}${pct && base ? `: ${pct.value}% of ${baseText}` : ""}, under the ${product}; it is an illustration from the document's terms, not a payment or an insurer's decision.`;
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
    }
  }
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
    if (a && b && !already && a.schedule && b.schedule && a.memberId === b.memberId && a.policy.documentRole !== "amendment" && b.policy.documentRole !== "amendment" && !a.policy.personalProof && !b.policy.personalProof) {
      const baseOf = (r: BenefitRecord) => { const x = r.schedule!.base; return x.kind === "fixed_limit" ? `a fixed ${x.label}` : x.kind === "sum_insured" ? `${r.memberName}'s own sum insured` : "an amount the document does not establish"; };
      const text = `The ${a.policy.product ?? "document"} (page ${a.schedule.page}) prints “${pretty(a.benefit)}” as a percentage of ${baseOf(a)}; the ${b.policy.product ?? "document"} (page ${b.schedule.page}) prints “${pretty(b.benefit)}” as a percentage of ${baseOf(b)}. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.`;
      const note = { kind: "uncertainty", text, evidence_ids: [d.evidenceId(a.source.evidence), d.evidenceId(b.source.evidence)], subject_id: a.memberId } as Record<string, unknown>;
      RENDERED.add(note); RELATION.add(note); list.push(note);
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
      const step = `Contact ${doc.insurer}${group ? " (through the employer or scheme administrator, for this group scheme)" : ""} about the ${doc.productName ?? "policy"} to ask what it needs for a claim.`;
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

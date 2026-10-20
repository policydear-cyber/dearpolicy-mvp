/**
 * Scoped absence statements (fx-live-1 K6a / K6b).
 *
 * "The uploaded documents do not describe a dental benefit" is a claim about a SEARCH SCOPE, not about cover. It is true or
 * false of the documents that were checked, and it says nothing about whether the insurer would pay. The composer used to
 * judge such a sentence like a claim about cover (its cited passage had to mention what it was about), which is the opposite
 * of what an absence is, so a correct statement was dropped and the household was told "I couldn't confirm an answer".
 *
 * The model proposes the claim as a structured statement of kind `not_found`:
 *   claim      benefit_not_found    no benefit for <topic> is described in the scope
 *              document_silent      the named document(s) do not state <topic> (a condition, a payment, what a benefit pays for)
 *   topic      the thing looked for, a short noun phrase (no verdict, no figure)
 *   terms      the words a document would print for it ("dental", "dentist")
 *   scope_policy_ids  (optional) the documents the claim is about
 * The SERVER then decides whether it may be said: it reads the FULL stored text of every document in the scope, page by page,
 * and refuses the statement when any of the terms (the model's and the topic's own distinctive words) is printed in any of
 * them -- quoting where -- or when a scoped document's text is not stored. A statement that passes is written by the server:
 * it names the documents checked, says "describe" / "state" (never "cover" / "excluded"), and says in the same breath that
 * this is not a statement that there is no such cover. The scope (documents, their file hashes and versions, the terms) is
 * saved with the answer (ChatAnswer.absenceChecks), so a reopened answer is withdrawn when a document it was checked against
 * is deleted or replaced.
 *
 * Pure functions here; `checkNotFound` reads the household's documents through the turn store.
 */
import { loadDocs, loadLinks, loadMembers, loadPages, type DocRow, type MemberRow } from "../store";

export type AbsenceClaim = "benefit_not_found" | "document_silent";
export type CheckedDocument = { policyId: string; name: string; fileHash: string | null; rev: string | null; pages: number };
/** What was checked, saved with the answer. */
export type AbsenceCheck = {
  claim: AbsenceClaim; topic: string; terms: string[]; subjectId: string | null;
  /** "named": the documents the statement named; "subject": the person's own documents (and any document linked to nobody); "library": every readable document. */
  scope: "named" | "subject" | "library";
  documents: CheckedDocument[];
};
export type ScopeDoc = { policyId: string; name: string; pages: { page: number; text: string }[] };
export type ScopeHit = { policyId: string; name: string; page: number; term: string; line: string };

/** Words that say what kind of thing a topic is, not which one: never searched for on their own. */
const GENERIC_TOPIC = new Set(["benefit", "benefits", "cover", "covers", "coverage", "covered", "pay", "pays", "paid", "payment", "payments", "payable", "treatment", "treatments", "care", "cost", "costs", "expense", "expenses", "claim", "claims", "amount", "amounts", "insurance", "insured", "policy", "policies", "plan", "plans", "scheme", "document", "documents", "any", "the", "for", "and", "what", "when", "under", "from", "with", "this", "that", "does", "how", "much", "more", "other", "such", "there", "their", "your", "her", "his", "its", "she", "him", "them", "they", "you", "has", "have", "had", "will", "would", "can", "could", "may", "might", "should", "not", "nor", "are", "was", "were", "been", "being", "dollar", "sum", "limit", "limits", "condition", "conditions", "term", "terms", "type", "kind", "item", "items", "services", "service", "related", "specific", "particular", "certain", "general", "following", "diagnosed", "diagnosis"]);
/** A topic is a noun phrase naming what was looked for: never a verdict, an amount, or a sentence. */
const VERDICT = /\b(?:not\s+covered|no\s+cover|excluded|exclusions?|exclude[sd]?|isn['’]t|aren['’]t|doesn['’]t|don['’]t|won['’]t|cannot|can['’]t|never|approved|guarantee\w*|payable|reimburs\w*|entitle\w*|will\s+(?:be\s+)?pa(?:y|id)|is\s+covered|are\s+covered|has\s+no|have\s+no)\b/i;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A light stem so a term finds its inflections without finding words that merely contain it ("dental" is not in "accidental"). */
function stem(w: string): string {
  const x = w.toLowerCase();
  const cut = x.replace(/(?:isations?|izations?|ations?|ments?|ings?|ies|ied|ed|es|s)$/, "");
  return cut.length >= 4 ? cut : x;
}
/** The pattern for a term: a whole word (or phrase) beginning with its stem, so "dental" never matches inside "accidental". */
export function termPattern(term: string): RegExp {
  const parts = term.toLowerCase().split(/[\s-]+/).filter(Boolean).map((w) => esc(stem(w)));
  return new RegExp(`(?<![A-Za-z0-9])${parts.join("[\\s-]+")}[A-Za-z]*`, "i");
}

const tidyTerm = (t: unknown): string | null => {
  const x = String(t ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  return x.length >= 3 && x.length <= 40 ? x : null;
};

/** The topic as a noun phrase for the sentence ("a dental benefit" -> "dental"), or why it cannot be used. */
export function cleanTopic(raw: unknown): { topic: string; problem: null } | { topic: null; problem: string } {
  let t = String(raw ?? "").replace(/\s+/g, " ").trim().replace(/[.;:!?]+$/, "");
  if (!t) return { topic: null, problem: "topic is required: the thing looked for, as a short noun phrase (e.g. \"dental treatment\")" };
  if (t.length > 90) return { topic: null, problem: "topic must be a short noun phrase, not a sentence" };
  if (/\d/.test(t) || /[$€£¥]/.test(t)) return { topic: null, problem: "topic must not contain an amount or a number: a not_found statement states no figure" };
  if (/[?]/.test(t) || /[;]/.test(t)) return { topic: null, problem: "topic must be one short noun phrase" };
  if (/^(?:no|not|none|without|lack of|absence of|never)\b/i.test(t)) return { topic: null, problem: "topic names what was looked for, not its absence (\"dental treatment\", not \"no dental cover\")" };
  if (VERDICT.test(t)) return { topic: null, problem: "topic must name only what was looked for (e.g. \"dental treatment\"), never a verdict such as covered / not covered / excluded / payable" };
  t = t.replace(/^(?:a|an|any|the|some)\s+/i, "");
  return t ? { topic: t, problem: null } : { topic: null, problem: "topic is required" };
}

/** The words searched for: the model's own terms plus the distinctive words of the topic (never the generic ones, a person's
 * name, or the words of the scope documents' own names). */
export function searchTerms(topic: string, given: unknown, skip: Set<string>): { terms: string[]; problem: string | null } {
  const out = new Set<string>();
  for (const g of Array.isArray(given) ? given : []) { const t = tidyTerm(g); if (t && !GENERIC_TOPIC.has(t)) out.add(t); }
  for (const w of topic.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!GENERIC_TOPIC.has(w) && !skip.has(w) && !skip.has(stem(w))) out.add(w);
  const terms = [...out].slice(0, 12);
  return terms.length ? { terms, problem: null } : { terms: [], problem: "terms is required: the specific words a document would print for this (e.g. [\"dental\", \"dentist\"]); the topic alone has none" };
}

/** document_silent: "the document does not state <what a named benefit pays for X>". The topic names the benefit the document DOES
 * print ("Group Living Care") as well as the target (cancer), so the topic's own words cannot all be searched; the model's terms are
 * the target, and at least one must be a word of the topic, so the word it asked about is always among the words searched. */
export function targetTerms(topic: string, given: unknown): { terms: string[]; problem: string | null } {
  const terms = [...new Set((Array.isArray(given) ? given : []).map(tidyTerm).filter((t): t is string => !!t && !GENERIC_TOPIC.has(t)))].slice(0, 12);
  if (!terms.length) return { terms: [], problem: "terms is required: the specific words the document would print if it stated this (the target, e.g. [\"cancer\"], not the benefit's own name)" };
  const topicStems = new Set((topic.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !GENERIC_TOPIC.has(w)).map(stem));
  if (topicStems.size && !terms.some((t) => t.split(/[\s-]+/).some((w) => topicStems.has(stem(w))))) return { terms, problem: `terms must include a word of the topic itself (${[...topicStems].slice(0, 4).join(", ")}): the word the question is about is always searched` };
  return { terms, problem: null };
}

/** Every place in the scope's pages where any term is printed (first few, in document and page order). */
export function scanScope(docs: ScopeDoc[], terms: string[]): ScopeHit[] {
  const pats = terms.map((t) => ({ t, re: termPattern(t) }));
  const hits: ScopeHit[] = [];
  for (const d of docs) for (const p of d.pages) for (const raw of p.text.split(/\n+/)) {
    const line = raw.trim(); if (!line) continue;
    for (const { t, re } of pats) if (re.test(line)) { hits.push({ policyId: d.policyId, name: d.name, page: p.page, term: t, line: line.length > 200 ? line.slice(0, 197) + "..." : line }); break; }
  }
  return hits;
}

/** A readable label for each document: its product name, told apart by its role when two share a name. */
export function documentLabels(docs: Pick<DocRow, "id" | "productName" | "insurer" | "documentRole" | "personalCoverageConfirmed">[]): Map<string, string> {
  const base = (d: (typeof docs)[number]) => (d.productName ?? d.insurer ?? "Policy document").trim();
  const role = (d: (typeof docs)[number]) => d.documentRole === "product_summary" ? "product summary" : d.documentRole === "certificate" ? (d.personalCoverageConfirmed ? "certificate" : "certificate summary") : d.documentRole === "endorsement" ? "endorsement" : d.documentRole ? d.documentRole.replace(/_/g, " ") : "document";
  const count = new Map<string, number>();
  for (const d of docs) count.set(base(d).toLowerCase(), (count.get(base(d).toLowerCase()) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const d of docs) out.set(d.id, (count.get(base(d).toLowerCase()) ?? 0) > 1 ? `${base(d)} (${role(d)})` : base(d));
  const seen = new Map<string, number>();
  for (const [id, l] of out) { const n = (seen.get(l) ?? 0) + 1; seen.set(l, n); if (n > 1) out.set(id, `${l} (${n})`); }
  return out;
}
const listOf = (names: string[]) => names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
const shortList = (names: string[]) => names.length <= 4 ? listOf(names) : `${names.slice(0, 3).join(", ")} and ${names.length - 3} other documents`;

/** The sentence the household reads. It says what was checked and what that does (and does not) mean. */
export function renderAbsence(c: AbsenceCheck, who: string | null): string {
  const names = c.documents.map((d) => d.name);
  const scope = c.scope === "library" ? `Your uploaded documents (${shortList(names)})` : c.scope === "subject" ? `${who ? `${who}’s` : "This person’s"} documents (${shortList(names)})` : c.documents.length === 1 ? `The ${names[0]}` : `The ${shortList(names)} documents`;
  const verb = c.documents.length === 1 && c.scope === "named" ? "does" : "do";
  if (c.claim === "benefit_not_found") return `${scope} ${verb} not describe a benefit for ${c.topic}. That is not the same as saying there is no such cover: it only means none is shown in ${c.documents.length === 1 ? "this document" : "these documents"}, and only the insurer can confirm whether there is one.`;
  return `${scope} ${verb} not state ${c.topic}. That is not the same as saying it is excluded or not covered: it only means ${c.documents.length === 1 ? "this document does" : "these documents do"} not show it, and only the insurer can confirm it.`;
}

/** A sentence that says documents do not print something ("do not state a dental benefit", "is not mentioned", "none of your documents ..."). */
export const SAYS_NOT_PRINTED = /\b(?:do(?:es)?\s+not|don['’]t|doesn['’]t|cannot|can['’]t|couldn['’]t|could\s+not)\s+(?:find|see|state|say|show|mention|list|name|specify|include|describe|print|establish|document|provide|set\s+out|contain|address)\b|\b(?:is|are)\s+(?:not|no)\s+(?:stated|mentioned|listed|named|shown|specified|printed|described|included|found)\b|\bnone\s+of\s+(?:your|the|these)\b|\bno\s+(?:mention|reference)\b/i;
/** Why the composer left such a sentence out when the reason was the wrong test (its cited passage must mention what it is about) or no
 * test at all -- the statements the server could have checked against the documents instead. */
export const UNCHECKED_ABSENCE_DROP = /^(?:not supported by its evidence|states cover or a figure without citing|says something is absent without|says something is absent, but the library was not checked)/;

export type AbsenceSource = { docs: DocRow[]; links: { policyId: string; memberId: string }[]; pages: { policyId: string; page: number; text: string }[];
  /** The household's members (G1 reads the certificate rows that name the subject by their full name). */
  members?: Pick<MemberRow, "id" | "displayName" | "preferredName">[] };
/** The documents an absence statement is checked against. */
export function scopeDocs(src: AbsenceSource, opts: { policyIds: string[] | null; subjectId: string | null }): { docs: DocRow[]; scope: AbsenceCheck["scope"]; problem: string | null } {
  if (opts.policyIds?.length) {
    const wanted = [...new Set(opts.policyIds)];
    const docs = wanted.map((id) => src.docs.find((d) => d.id === id));
    if (docs.some((d) => !d)) return { docs: [], scope: "named", problem: `scope_policy_ids must be documents the household currently has; ${wanted.filter((id) => !src.docs.some((d) => d.id === id)).join(", ")} is not one of them` };
    return { docs: docs as DocRow[], scope: "named", problem: null };
  }
  const linkedToAnyone = new Set(src.links.map((l) => l.policyId));
  if (opts.subjectId) {
    // (a document linked to nobody could belong to anyone: it is part of every person's scope, so an absence is never claimed past it)
    const mine = src.docs.filter((d) => src.links.some((l) => l.policyId === d.id && l.memberId === opts.subjectId) || !linkedToAnyone.has(d.id));
    if (mine.length) return { docs: mine, scope: "subject", problem: null };
  }
  return { docs: src.docs, scope: "library", problem: src.docs.length ? null : "the household has no readable documents to check" };
}

/** A line the documents print for a refused absence's topic (G1 follow-up: what the server quotes when the model cannot recover). */
export type PrintedLine = { policyId: string; name: string; page: number; line: string; pageText: string; fileHash: string | null };
export type NotFoundResult = { ok: true; text: string; check: AbsenceCheck } | { ok: false; problem: string;
  /** Refused because the documents print words for the topic: those lines (outside a scheme's bare list of its policies first). */
  printed?: PrintedLine[];
  /** PR #64 (a doctor's bill, G2): said before / after the quoted lines -- whose cover a quoted line is not shown to be -- and the first line
   * limited to treatment abroad when it is not quoted (the household did not place the bill abroad). */
  before?: string; after?: string; abroad?: PrintedLine;
  /** PR #57 follow-up: refused ONLY because part of the scope was not stored -- what the pages that were read show, written by the server. */
  partial?: { text: string; check: AbsenceCheck } };
/** The whole decision, over data already loaded (pure): whether the statement may be said, and as what sentence. */
export function decideNotFound(s: Record<string, unknown>, src: AbsenceSource, ctx: { subjectId: string | null; who: string | null; names: string[] }): NotFoundResult {
  const named = Array.isArray(s.scope_policy_ids) ? (s.scope_policy_ids as unknown[]).map(String).filter(Boolean) : [];
  const claim: AbsenceClaim | null = s.claim === "benefit_not_found" || s.claim === "document_silent" ? s.claim : s.claim == null ? (named.length ? "document_silent" : "benefit_not_found") : null;
  if (!claim) return { ok: false, problem: "claim must be benefit_not_found (no benefit for the topic is described in the documents) or document_silent (the named documents do not state it)" };
  if (claim === "document_silent" && !named.length) return { ok: false, problem: "claim document_silent needs scope_policy_ids: the document(s) that do not state it" };
  const t = cleanTopic(s.topic);
  if (t.topic === null) return { ok: false, problem: t.problem };
  const subjectId = typeof s.subject_id === "string" && s.subject_id ? s.subject_id : ctx.subjectId;
  const scope = scopeDocs(src, { policyIds: named.length ? named : null, subjectId });
  if (scope.problem) return { ok: false, problem: scope.problem };
  const labels = documentLabels(scope.docs);
  const skip = new Set(ctx.names.flatMap((n) => n.toLowerCase().match(/[a-z]{3,}/g) ?? []));
  // (the words of the scope documents' own names are not what a document prints about a topic: "Group Living Care" is the document's
  // product, and what is asked is what it says about cancer)
  // PR #57 follow-up (critic M3): only for document_silent, where that reason holds. For benefit_not_found the topic's own words are always
  // searched: a "Dental Plan" document that prints "dental" on every page is never said not to describe dental.
  if (claim === "document_silent") for (const d of scope.docs) for (const w of (d.productName ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? []) skip.add(w);
  const st = claim === "benefit_not_found" ? searchTerms(t.topic, s.terms, skip) : targetTerms(t.topic, s.terms);
  if (st.problem) return { ok: false, problem: st.problem };
  const pagesOf = new Map<string, { page: number; text: string }[]>();
  for (const p of src.pages) { const l = pagesOf.get(p.policyId) ?? []; l.push({ page: p.page, text: p.text }); pagesOf.set(p.policyId, l); }
  const unread = scope.docs.filter((d) => !(pagesOf.get(d.id) ?? []).some((p) => p.text.trim()));
  if (unread.length) return { ok: false, problem: `the text of ${unread.map((d) => labels.get(d.id)).join(", ")} is not stored, so nothing can be said to be absent from it` };
  const hits = scanScope(scope.docs.map((d) => ({ policyId: d.id, name: labels.get(d.id) ?? "document", pages: (pagesOf.get(d.id) ?? []).sort((a, b) => a.page - b.page) })), st.terms);
  // PR #57 follow-up (critic round 5 A3): a doctor's or medical bill is never said to be absent while a page of the scope prints a benefit
  // that reimburses medical treatment ("we will reimburse the reasonable charges for treatment by a Registered Medical Practitioner"),
  // whatever words the model searched for: those sentences are the answer, quoted.
  const docsOf = scope.docs.map((d) => ({ policyId: d.id, name: labels.get(d.id) ?? "document", pages: (pagesOf.get(d.id) ?? []).sort((a, b) => a.page - b.page) }));
  const medical = claim === "benefit_not_found" && st.terms.some((t) => MEDICAL_TOPIC.test(t));
  // (critic round 6 R6-2: C2's term veto stays beside the sentence rule -- a label-style benefit, "Medical Expenses Benefit / Up to $2,000
  // per Accident for medical expenses incurred", has no payment verb but is medical-expense wording; a scheme's bare policy list is not)
  const termHits = medical ? scanScope(docsOf, MEDICAL_BILL_TERMS).filter((h) => !inPolicyList(pagesOf, h)) : [];
  const medicalHits: SentenceHit[] = medical ? [...medicalExpenseSentences(docsOf), ...termHits] : [];
  // PR #57 follow-up (G1, DC's GP-bill answer): a scheme document's own list of its group policies names a policy ("Outpatient Medicare
  // Policy ("OPMC")") without describing it. When EVERY hit is such a name, and the person's own certificate, read in full, lists neither
  // that name nor its abbreviation, the hit is set aside and said in its own sentence (the scheme names it, the certificate does not list
  // it, the insurer confirms current cover); the absence is then decided over the rest as usual. Any other hit refuses as before.
  const scheme = claim === "benefit_not_found" && scope.scope === "subject" && hits.length && !medicalHits.length ? schemeListing(scope.docs, pagesOf, hits, st.terms, labels, subjectId ?? null, src.members ?? []) : null;
  if ((hits.length && !scheme) || medicalHits.length) {
    const all: SentenceHit[] = [...medicalHits, ...hits];
    const shown = all.slice(0, 3).map((h) => `${h.name} page ${h.page} prints “${h.line}”`).join("; ");
    // (what the server quotes if the model cannot say it: the medical-expense wording first, then any other printed line -- never a line of a
    // scheme's bare list of its policies, which names a policy without saying who has it: critic round 5 F1)
    const kept = all.filter((h) => !inPolicyList(pagesOf, h)).filter((h, i, a) => a.findIndex((x) => x.policyId === h.policyId && x.page === h.page && x.line === h.line) === i);
    const place = s.bill_place === "abroad" || s.bill_place === "home" || s.bill_place === "unknown" ? s.bill_place : null;
    const bill = place ? billLines(kept, place) : null;
    const chosen = bill ? bill.chosen : kept.slice(0, 2);
    const toPrinted = (h: ScopeHit & { full?: boolean }): PrintedLine => { const pageText = (pagesOf.get(h.policyId) ?? []).find((p) => p.page === h.page)?.text ?? ""; const full = h.full ? h.line : pageText.split(/\n+/).map((l) => l.trim()).find((l) => l.startsWith(h.line.replace(/\.\.\.$/, ""))) ?? h.line;
      return { policyId: h.policyId, name: h.name, page: h.page, line: full, pageText, fileHash: scope.docs.find((d) => d.id === h.policyId)?.fileHash ?? null }; };
    const printed = chosen.map(toPrinted);
    // (PR #64, Policy Evidence Reviewer 12.1 / Critic R10-1: a quoted line from a document that is not the person's own confirmed certificate
    // does not show whose cover it is -- what their certificate lists, the section the line sits under, and that the insurer confirms)
    const whose = bill && scope.scope === "subject" ? whoseLines(scope.docs, pagesOf, all, chosen, labels, subjectId ?? null, src.members ?? [], ctx.who) : null;
    const abroad = bill?.abroad ? toPrinted(bill.abroad) : undefined;
    return { ok: false, printed, ...(whose?.before ? { before: whose.before } : {}), ...(whose?.after ? { after: whose.after } : {}), ...(abroad ? { abroad } : {}), problem: `not_found refused: the documents checked DO print ${all.length > 1 ? "words for" : "a word for"} this (${[...new Set(all.map((h) => h.term))].join(", ")}): ${shown}. Say what those lines print (cite them) or narrow the claim to documents and terms that are truly absent; never say a document does not describe what it prints` };
  }
  // PR #57 follow-up (critic M2; after the scan, so a page that prints the topic is still named): an absence is said only over a document read in full. A stored page with no text, fewer stored pages than
  // the document has, or a page count that is not known, means part of it was never read.
  const partial = scope.docs.filter((d) => {
    const ps = pagesOf.get(d.id) ?? [];
    // (every page 1..pageCount must be stored: a count of stored pages can match while a page in the middle is missing)
    const have = new Set(ps.map((p) => p.page));
    return ps.some((p) => !p.text.trim()) || d.pageCount == null || Array.from({ length: d.pageCount }, (_, i) => i + 1).some((n) => !have.has(n));
  });
  if (partial.length) {
    // (the server says what was read -- documents in full, and which pages of the rest -- and that the rest could not be checked; never an absence)
    const check: AbsenceCheck = { claim, topic: t.topic, terms: st.terms, subjectId: subjectId ?? null, scope: scope.scope,
      documents: scope.docs.map((d) => ({ policyId: d.id, name: labels.get(d.id) ?? "document", fileHash: d.fileHash ?? null, rev: d.rev ?? null, pages: (pagesOf.get(d.id) ?? []).length })) };
    const ranges = (ns: number[]) => { const out: string[] = []; for (let i = 0; i < ns.length; i++) { let j = i; while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++; out.push(i === j ? `${ns[i]}` : `${ns[i]}-${ns[j]}`); i = j; } return out.length > 1 ? `${out.slice(0, -1).join(", ")} and ${out.at(-1)}` : out.join(""); };
    const full = scope.docs.filter((d) => !partial.includes(d)).map((d) => labels.get(d.id) ?? "document");
    const part = partial.map((d) => { const ns = [...new Set((pagesOf.get(d.id) ?? []).filter((p) => p.text.trim()).map((p) => p.page))].sort((a, b) => a - b); return `the ${labels.get(d.id) ?? "document"} (page${ns.length > 1 ? "s" : ""} ${ranges(ns)}${d.pageCount != null ? ` of ${d.pageCount} pages` : ""})`; });
    const whose = scope.scope === "subject" && ctx.who ? `${ctx.who}’s documents` : "the documents";
    // (C6, Test engineer on C5: the page count is the uploaded file's own -- the file has those pages; only their text was not stored.
    // Said as what the app could read, never as a shorter upload or lost data)
    const unknownCount = partial.some((d) => d.pageCount == null);
    const text = `${scheme ? scheme.text(ctx.who) + " " : ""}I checked ${whose} for ${t.topic}: ${full.length ? `the ${shortList(full)} in full, and ` : ""}the text of ${part.length > 1 ? part.slice(0, -1).join(", ") + " and " + part.at(-1) : part[0]}. Those pages do not mention ${t.topic}. ${unknownCount ? `The rest of ${partial.length > 1 ? "their" : "its"} text was` : "The text of the other pages was"} not stored, so ${unknownCount ? "it" : "they"} could not be checked, and I can't say either way whether there is such cover.`;
    return { ok: false, problem: `${partial.map((d) => labels.get(d.id)).join(", ")} ${partial.length > 1 ? "were" : "was"} not read in full (a page has no stored text, or not every page is stored), so nothing can be said to be absent from ${partial.length > 1 ? "them" : "it"}: say what the pages that were read print, and that the rest could not be checked`, partial: { text, check } };
  }
  const check: AbsenceCheck = {
    claim, topic: t.topic, terms: st.terms, subjectId: subjectId ?? null, scope: scope.scope,
    documents: scope.docs.map((d) => ({ policyId: d.id, name: labels.get(d.id) ?? "document", fileHash: d.fileHash ?? null, rev: d.rev ?? null, pages: (pagesOf.get(d.id) ?? []).length })),
  };
  return { ok: true, check, text: `${scheme ? scheme.text(ctx.who) + " " : ""}${renderAbsence(check, ctx.who)}` };
}

/** PR #64 (G2, a doctor's bill only; Critic R10-2, R10-4): which printed lines are quoted for a bill. A line that pays only for treatment
 * abroad ("received outside Singapore") is quoted only when the household placed the bill abroad; otherwise it is said apart (abroad).
 * "In Singapore or overseas" is not abroad-only. A short heading ("Panel GP Benefit") is not quoted beside a line of its own. */
const ABROAD = /\b(?:outside (?:of )?Singapore|overseas|abroad)\b/i;
const EITHER = /\bSingapore\s+(?:and|or)\s+(?:overseas|abroad)\b|\b(?:overseas|abroad)\s+(?:and|or)\s+(?:in\s+)?Singapore\b|\bworldwide\b/i;
const abroadOnly = (l: string) => ABROAD.test(l) && !EITHER.test(l);
const isHeading = (l: string) => !/[a-z]/.test(l) || (!/[.;$\d]/.test(l) && l.split(/\s+/).length <= 6);
function billLines(kept: (ScopeHit & { full?: boolean })[], place: "abroad" | "home" | "unknown"): { chosen: (ScopeHit & { full?: boolean })[]; abroad: (ScopeHit & { full?: boolean }) | null } {
  const inside = (h: ScopeHit) => kept.some((x) => x !== h && x.policyId === h.policyId && x.page === h.page && x.line.length > h.line.length && flat(x.line).includes(flat(h.line).replace(/\.\.\.$/, "")));
  const body = kept.filter((h) => !isHeading(h.line) && !inside(h));
  if (!body.length) return { chosen: kept.slice(0, 2), abroad: null };
  const home = body.filter((h) => !abroadOnly(h.line)), away = body.filter((h) => abroadOnly(h.line));
  if (place === "abroad") return { chosen: [...away, ...home].slice(0, 2), abroad: null };
  return { chosen: home.slice(0, 2), abroad: place === "unknown" || !home.length ? away[0] ?? null : null };
}

const distinct = (t: string) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !["group", "policy", "plan", "benefit", "benefits", "insurance", "scheme", "the", "and"].includes(w));
/** What a person's own confirmed certificate(s), read in full, list for them: the product headings with a row naming them, and the one
 * "As of" date of those rows. Null when anything is in doubt. */
function certificateListing(docs: DocRow[], pagesOf: Map<string, { page: number; text: string }[]>, subjectId: string | null, members: Pick<MemberRow, "id" | "displayName" | "preferredName">[]) {
  const me = members.find((m) => m.id === subjectId);
  if (!me) return null;
  const certs = docs.filter((d) => d.documentRole === "certificate" && d.personalCoverageConfirmed);
  const full = (d: DocRow) => { const ps = pagesOf.get(d.id) ?? []; const have = new Set(ps.filter((p) => p.text.trim()).map((p) => p.page)); return d.pageCount != null && d.pageCount > 0 && Array.from({ length: d.pageCount }, (_, i) => i + 1).every((n) => have.has(n)); };
  if (!certs.length || !certs.every(full)) return null;
  const certText = certs.flatMap((d) => (pagesOf.get(d.id) ?? []).map((p) => p.text)).join("\n");
  // (what the certificate lists FOR THIS PERSON -- critic round 5 A2: the product headings with a row naming them under it, never a
  // spouse's -- and the date those rows are printed as of: one date, or G1 does not fire)
  // (critic round 6 R6-1: a row is this person's when it names them -- the display or preferred name, word-bounded, or every word of
  // the display name in any order ("Tan, John" for "John Tan") -- and names no other member of the household)
  const word = (w: string) => new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![\\p{L}])`, "iu");
  const names = (m: (typeof members)[number]) => [m.displayName, m.preferredName].filter((n): n is string => !!n && n.trim().length >= 3).map((n) => flat(n));
  const namesMember = (l: string, m: (typeof members)[number]) => { const ws = flat(m.displayName).split(/[\s,]+/).filter((w) => w.length >= 2); return names(m).some((n) => word(n).test(l)) || (ws.length >= 2 && ws.every((w) => word(w).test(l))); };
  const person = { test: (l: string) => namesMember(l, me) && !members.some((o) => o.id !== me.id && namesMember(l, o)) };
  const products: string[] = []; const dates = new Set<string>();
  let heading: string | null = null;
  for (const l of certText.split(/\n+/)) {
    const h = /^\s*([A-Z][A-Z &]{3,60}?)\s*\(\s*POLICY NO/.exec(l)?.[1]?.trim();
    if (h) { heading = h; continue; }
    if (heading && person.test(l)) { if (!products.includes(heading)) products.push(heading); for (const m of l.matchAll(/\bAs of (\d{2})\/(\d{2})\/(\d{4})\b/g)) dates.add(`${m[3]}-${m[2]}-${m[1]}`); }
  }
  if (!products.length || dates.size !== 1) return null;
  const asOf = new Date([...dates][0] + "T00:00:00Z").toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return { certs, certText, products, asOf, namesPerson: (l: string) => person.test(l) };
}

/** PR #64 (Policy Evidence Reviewer 12.1, Critic R10-1 / R10-3): for quoted lines from a document that is not the person's own confirmed
 * certificate and does not name them, what their certificate lists (dated), any scheme policy the scheme's own list names that the
 * certificate does not list, the heading each quoted line sits under (and whether the certificate lists it), and that the insurer
 * confirms whether it applies to them. */
function whoseLines(docs: DocRow[], pagesOf: Map<string, { page: number; text: string }[]>, all: ScopeHit[], chosen: ScopeHit[], labels: Map<string, string>, subjectId: string | null, members: Pick<MemberRow, "id" | "displayName" | "preferredName">[], who: string | null): { before: string | null; after: string | null } {
  const cert = certificateListing(docs, pagesOf, subjectId, members);
  const own = (h: ScopeHit) => { const d = docs.find((x) => x.id === h.policyId); const page = (pagesOf.get(h.policyId) ?? []).find((p) => p.page === h.page)?.text ?? "";
    return (d?.documentRole === "certificate" && !!d.personalCoverageConfirmed) || (!!cert && cert.namesPerson(page)); };
  const foreign = chosen.filter((h) => !own(h));
  if (!foreign.length) return { before: null, after: null };
  const whoS = who ? `${who}’s` : "this person’s";
  // (Critic R11-1: "does not list" is said only when NONE of the products on the person's own rows shares a distinctive word with the
  // policy's name or is its abbreviation -- "GROUP OUTPATIENT MEDICARE" and "GROUP OPMC" both list the Outpatient Medicare Policy. A
  // spouse's rows never count; when in doubt nothing is said about listing)
  const words = distinct;
  const unlisted = (name: string, abbr: string | null) => !!cert && words(name).length > 0 && cert.products.every((p) => { const pw = words(p); return !pw.some((w) => words(name).includes(w)) && !(abbr && pw.includes(abbr.toLowerCase())); });
  const policyNamed = (n: string) => `${n.replace(/\s+Policy$/i, "")} Policy`; // (R11-4 / R6-4: never "Policy Policy")
  const schemeEntries = docs.flatMap((d) => (pagesOf.get(d.id) ?? []).flatMap((p) => [...flat(p.text).matchAll(POLICY_ENTRY)].map((m) => ({ name: m[1].replace(/^(?:and|or|the)\s+/i, "").trim(), abbr: m[2] }))));
  let before: string | null = null;
  if (cert) {
    const scheme = new Map<string, string>();
    for (const h of all) { const entries = policyList(pagesOf, h); const re = termPattern(h.term); const e = entries?.find((x) => re.test(x.name));
      if (e && unlisted(e.name, e.abbr)) scheme.set(`${h.policyId}:${e.abbr}`, `the ${labels.get(h.policyId) ?? "document"} (page ${h.page}) names the scheme’s ${policyNamed(e.name)} (${e.abbr})`); }
    const names = [...scheme.values()].join(", and ");
    before = `${who ? `${who}’s` : "This person’s"} certificate lists ${listOf(cert.products.map(titleCase))} (as of ${cert.asOf}).${names ? ` ${names.charAt(0).toUpperCase() + names.slice(1)}, which that certificate does not list.` : ""}`;
  }
  const parts = foreign.filter((h, i, a) => a.findIndex((x) => x.policyId === h.policyId && x.page === h.page) === i).map((h) => {
    const lines = ((pagesOf.get(h.policyId) ?? []).find((p) => p.page === h.page)?.text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => l.startsWith(h.line.replace(/\.\.\.$/, "").slice(0, 40)));
    const above = lines.slice(0, Math.max(at, 0)).reverse();
    // (Evidence Reviewer 13: the benefit's own name printed just above the line, and the section it sits in)
    const name = at > 0 && isHeading(lines[at - 1]) && /[a-z]/.test(lines[at - 1]) ? lines[at - 1] : null;
    const section = above.find((l) => !/[a-z]/.test(l) && /[A-Z]{3}/.test(l)) ?? null;
    // (R11-1: a policy name is read from the section only from an explicit "... POLICY" phrase)
    const pol = section ? /(?:^|[(:]\s*)([A-Z][A-Z &]*?)\s+POLICY\b/.exec(section)?.[1] ?? null : null;
    // (and only when the scheme's own list gives that policy's abbreviation, so a "GROUP OPMC" row is recognised; without it nothing is said)
    const abbr = pol ? schemeEntries.find((e) => words(e.name).join(" ") === words(pol).join(" "))?.abbr ?? null : null;
    const off = !!pol && !!abbr && unlisted(pol, abbr);
    const where = [name ? `under “${name}”` : null, section ? `in “${section}”${off ? ` (a policy ${whoS} certificate does not list)` : ""}` : null].filter(Boolean).join(" ");
    return `The ${labels.get(h.policyId) ?? "document"} (page ${h.page}) prints that line${where ? ` ${where}` : ""}, and it does not say whose cover it is`;
  });
  return { before, after: `${parts.join(". ")}. Only the insurer or the scheme administrator can confirm whether it applies to ${who ?? "them"}.` };
}

/** Words a document would print for paying a doctor's or medical bill (C2's veto, critic round 4 condition 5). */
const MEDICAL_BILL_TERMS = ["medical expenses", "medical expense", "medical reimbursement", "medical bills", "medical treatment", "medical fees", "outpatient", "clinic", "general practitioner", "consultation"];
/** A topic about a doctor's or medical bill (the terms the model or the server searched for). */
const MEDICAL_TOPIC = /medic|outpatient|clinic|doctor|physician|practitioner|consultation|\bgp\b/i;
/** A sentence that reimburses or pays for medical treatment: a payment verb, and a medical word next to what is paid (expenses, charges,
 * fees, bills, costs). "Reimburse the actual ground ambulance costs ... (including the medical supplies used)" is not one: its medical word
 * is not next to what is paid. */
const PAYS = /\b(?:reimburs\w*|indemnif\w*|pay|pays|paid|payable)\b/i;
const MEDICAL_WORD = "(?:medical|treatment|doctor|physician|practitioner|clinic|outpatient|consultation|surgeon|specialist)";
const PAID_WORD = "(?:expenses?|charges?|fees?|bills?|costs?)";
const MEDICAL_PAID = new RegExp(`\\b${MEDICAL_WORD}\\W+(?:\\w+\\W+){0,3}?${PAID_WORD}\\b|\\b${PAID_WORD}\\W+(?:\\w+\\W+){0,3}?${MEDICAL_WORD}\\b`, "i");
type SentenceHit = ScopeHit & { full?: boolean };
function medicalExpenseSentences(docs: ScopeDoc[]): SentenceHit[] {
  const out: SentenceHit[] = [];
  for (const d of docs) for (const p of d.pages) for (const raw of flat(p.text).split(/(?<=[.:;])\s+(?=[A-Z(])/)) {
    const x = raw.trim();
    if (x && PAYS.test(x) && MEDICAL_PAID.test(x)) out.push({ policyId: d.policyId, name: d.name, page: p.page, term: "medical expenses", line: x.length > 400 ? x.slice(0, 397) + "..." : x, full: x.length <= 400 });
  }
  return out;
}
const POLICY_ENTRY = /([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,4})\s+(?:Policy\s+)?\(["“]([A-Z]{2,6})["”]\)/g;
const flat = (t: string) => t.replace(/\s+/g, " ").trim();
const titleCase = (t: string) => t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The scheme's own list of its group policies that a hit sits in (a sentence naming three or more policies with their abbreviations). */
function policyList(pagesOf: Map<string, { page: number; text: string }[]>, h: ScopeHit): { name: string; abbr: string }[] | null {
  const page = flat((pagesOf.get(h.policyId) ?? []).find((p) => p.page === h.page)?.text ?? "");
  const sentence = page.split(/(?<=\.)\s+(?=[A-Z])/).find((x) => x.includes(flat(h.line).replace(/\.\.\.$/, ""))) ?? "";
  const entries = [...sentence.matchAll(POLICY_ENTRY)].map((m) => ({ name: m[1].replace(/^(?:and|or|the)\s+/i, "").trim(), abbr: m[2] }));
  return entries.length >= 3 ? entries : null;
}
const inPolicyList = (pagesOf: Map<string, { page: number; text: string }[]>, h: ScopeHit) => { const e = policyList(pagesOf, h); const re = termPattern(h.term); return !!e && e.some((x) => re.test(x.name)); };

/** G1: whether every hit is the name of a group policy in a scheme document's own list of its policies (a sentence naming three or more
 * policies with their abbreviations), that the person's certificate, read in full, does not list. Null when anything is in doubt. */
function schemeListing(docs: DocRow[], pagesOf: Map<string, { page: number; text: string }[]>, hits: ScopeHit[], terms: string[], labels: Map<string, string>, subjectId: string | null, members: Pick<MemberRow, "id" | "displayName" | "preferredName">[]): { text: (who: string | null) => string } | null {
  const cl = certificateListing(docs, pagesOf, subjectId, members);
  if (!cl) return null;
  const { certs, certText, products, asOf } = cl;
  const everyHit = scanScope(docs.map((d) => ({ policyId: d.id, name: labels.get(d.id) ?? "document", pages: pagesOf.get(d.id) ?? [] })), terms);
  const named = new Map<string, { name: string; abbr: string; doc: string; page: number }>();
  for (const h of [...hits, ...everyHit]) {
    if (certs.some((c) => c.id === h.policyId)) return null;
    const entries = policyList(pagesOf, h);
    if (!entries) return null;
    const re = termPattern(h.term);
    const entry = entries.find((e) => re.test(e.name));
    if (!entry || !re.test(h.line) || [...h.line.matchAll(new RegExp(re.source, "gi"))].length !== 1) return null;
    // (not listed: neither the full name nor the abbreviation appears anywhere on the certificate)
    if (new RegExp(`\\b${entry.name.replace(/\s+/g, "\\s+")}\\b`, "i").test(certText) || new RegExp(`\\b${entry.abbr}\\b`).test(certText)) return null;
    // (Critic R11-1: nor does any product on the certificate share a distinctive word with it -- "GROUP OUTPATIENT MEDICARE(POLICY NO")
    if (products.some((p) => distinct(p).some((w) => distinct(entry.name).includes(w)))) return null;
    named.set(`${h.policyId}:${entry.abbr}`, { ...entry, doc: labels.get(h.policyId) ?? "document", page: h.page });
  }
  if (!named.size) return null;
  const list = products.map(titleCase);
  return { text: (who) => {
    const whose = who ? `${who}’s` : "This person’s";
    const names = [...named.values()];
    const scheme = names.map((n) => `the ${n.doc} (page ${n.page}) names the scheme’s ${n.name.replace(/\s+Policy$/i, "")} Policy (${n.abbr})`).join(", and ");
    return `${whose} certificate lists ${listOf(list)} (as of ${asOf}). ${scheme.charAt(0).toUpperCase() + scheme.slice(1)}, which that certificate does not list; only the insurer or the scheme administrator can confirm ${who ? `${who}’s` : "their"} current cover.`;
  } };
}

/** PR #72 E2a (Evidence Reviewer 18, DC's GP-bill answer): for a household asking about a doctor's or outpatient bill, a scheme policy for
 * it that the scheme's own list of its group policies names ("Outpatient Medicare Policy ("OPMC")") and the person's own certificate,
 * read in full, does not list -- said as found: what the certificate lists (dated), that the scheme names that policy, that the
 * certificate does not list it (the bottom line says who confirms: answer-statements.ts). Never "no outpatient cover". Null when anything is in doubt (as G1 and whoseLines). */
export async function unlistedSchemePolicy(accountId: string, subjectId: string, who: string | null, want: RegExp): Promise<{ text: string; printed: PrintedLine[] } | null> {
  const docs = await loadDocs(accountId);
  const [links, pages, members] = await Promise.all([loadLinks(accountId, docs.map((d) => d.id)), loadPages(accountId, docs.map((d) => d.id)), loadMembers(accountId)]);
  const scope = scopeDocs({ docs, links, pages, members }, { policyIds: null, subjectId });
  if (scope.problem || scope.scope !== "subject") return null;
  const pagesOf = new Map<string, { page: number; text: string }[]>();
  for (const p of pages) { const l = pagesOf.get(p.policyId) ?? []; l.push({ page: p.page, text: p.text }); pagesOf.set(p.policyId, l); }
  const cert = certificateListing(scope.docs, pagesOf, subjectId, members);
  if (!cert) return null;
  const labels = documentLabels(scope.docs);
  // (as G1: only when nothing else in the person's documents speaks to such a bill -- a sentence paying for medical treatment, or a
  // doctor's or outpatient word outside the scheme's bare list of its policies -- Critic A3, GP.c4)
  const docsOf = scope.docs.map((d) => ({ policyId: d.id, name: labels.get(d.id) ?? "document", pages: (pagesOf.get(d.id) ?? []).sort((a, b) => a.page - b.page) }));
  if (medicalExpenseSentences(docsOf).length || scanScope(docsOf, MEDICAL_BILL_TERMS).some((h) => !inPolicyList(pagesOf, h))) return null;
  const unlisted = (name: string, abbr: string) => distinct(name).length > 0 && cert.products.every((p) => { const pw = distinct(p); return !pw.some((w) => distinct(name).includes(w)) && !pw.includes(abbr.toLowerCase()); });
  const found = new Map<string, { name: string; abbr: string; line: PrintedLine }>();
  for (const d of scope.docs) {
    if (cert.certs.some((c) => c.id === d.id)) continue;
    for (const p of (pagesOf.get(d.id) ?? []).sort((a, b) => a.page - b.page)) for (const sentence of flat(p.text).split(/(?<=\.)\s+(?=[A-Z])/)) {
      const entries = [...sentence.matchAll(POLICY_ENTRY)].map((m) => ({ name: m[1].replace(/^(?:and|or|the)\s+/i, "").trim(), abbr: m[2] }));
      if (entries.length < 3) continue;
      for (const e of entries) if (want.test(e.name) && unlisted(e.name, e.abbr) && !found.has(e.abbr))
        {
        // (the printed line naming it, as the page prints it: what the statement cites)
        const raw = p.text.split(/\n+/).map((l) => l.trim()).find((l) => l.includes(e.abbr) && /\(["“]/.test(l));
        if (raw) found.set(e.abbr, { ...e, line: { policyId: d.id, name: labels.get(d.id) ?? "document", page: p.page, line: raw, pageText: p.text, fileHash: d.fileHash ?? null } });
      }
    }
  }
  if (!found.size) return null;
  const whose = who ? `${who}’s` : "This person’s";
  const named = [...found.values()].map((f) => `the ${f.line.name} (page ${f.line.page}) names the scheme’s ${f.name.replace(/\s+Policy$/i, "")} Policy (${f.abbr})`).join(", and ");
  return { text: `${whose} certificate lists ${listOf(cert.products.map(titleCase))} (as of ${cert.asOf}). ${named.charAt(0).toUpperCase() + named.slice(1)}, which that certificate does not list.`, printed: [...found.values()].map((f) => f.line) };
}

/** Loads the household's readable documents, links and stored pages for the turn, then decides. */
export async function checkNotFound(accountId: string, s: Record<string, unknown>, ctx: { subjectId: string | null; who: string | null; names: string[] }): Promise<NotFoundResult> {
  const docs = await loadDocs(accountId);
  const links = await loadLinks(accountId, docs.map((d) => d.id));
  const pages = await loadPages(accountId, docs.map((d) => d.id));
  const members = await loadMembers(accountId);
  return decideNotFound(s, { docs, links, pages, members }, ctx);
}

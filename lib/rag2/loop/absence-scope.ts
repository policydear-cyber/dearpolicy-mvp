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
import { loadDocs, loadLinks, loadPages, type DocRow } from "../store";

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

export type AbsenceSource = { docs: DocRow[]; links: { policyId: string; memberId: string }[]; pages: { policyId: string; page: number; text: string }[] };
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

export type NotFoundResult = { ok: true; text: string; check: AbsenceCheck } | { ok: false; problem: string };
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
  if (hits.length) {
    const shown = hits.slice(0, 3).map((h) => `${h.name} page ${h.page} prints “${h.line}”`).join("; ");
    return { ok: false, problem: `not_found refused: the documents checked DO print ${hits.length > 1 ? "words for" : "a word for"} this (${[...new Set(hits.map((h) => h.term))].join(", ")}): ${shown}. Say what those lines print (cite them) or narrow the claim to documents and terms that are truly absent; never say a document does not describe what it prints` };
  }
  // PR #57 follow-up (critic M2; after the scan, so a page that prints the topic is still named): an absence is said only over a document read in full. A stored page with no text, fewer stored pages than
  // the document has, or a page count that is not known, means part of it was never read.
  const partial = scope.docs.filter((d) => {
    const ps = pagesOf.get(d.id) ?? [];
    return ps.some((p) => !p.text.trim()) || d.pageCount == null || new Set(ps.map((p) => p.page)).size < d.pageCount;
  });
  if (partial.length) return { ok: false, problem: `${partial.map((d) => labels.get(d.id)).join(", ")} ${partial.length > 1 ? "were" : "was"} not read in full (a page has no stored text, or not every page is stored), so nothing can be said to be absent from ${partial.length > 1 ? "them" : "it"}: say what the pages that were read print, and that the rest could not be checked` };
  const check: AbsenceCheck = {
    claim, topic: t.topic, terms: st.terms, subjectId: subjectId ?? null, scope: scope.scope,
    documents: scope.docs.map((d) => ({ policyId: d.id, name: labels.get(d.id) ?? "document", fileHash: d.fileHash ?? null, rev: d.rev ?? null, pages: (pagesOf.get(d.id) ?? []).length })),
  };
  return { ok: true, check, text: renderAbsence(check, ctx.who) };
}

/** Loads the household's readable documents, links and stored pages for the turn, then decides. */
export async function checkNotFound(accountId: string, s: Record<string, unknown>, ctx: { subjectId: string | null; who: string | null; names: string[] }): Promise<NotFoundResult> {
  const docs = await loadDocs(accountId);
  const links = await loadLinks(accountId, docs.map((d) => d.id));
  const pages = await loadPages(accountId, docs.map((d) => d.id));
  return decideNotFound(s, { docs, links, pages }, ctx);
}

/**
 * Reliable chat: what the DOCUMENTS themselves say about their own standing, for the one case where it matters to the
 * answer -- two documents of one scheme print different schedules for the same kind of event, and the household needs to
 * know what separates them (production fracture conversation, 19 Oct 2026: a product summary printing 25% of a fixed
 * S$5,000 limit and the certificate's highlights printing 20% of the sum insured were presented under one identical
 * product name, with nothing to tell the reader which document was which or how they relate).
 *
 * The scan reads the documents' own stored pages and keeps only sentences of three plain kinds, each cited to its page:
 *   summary   "the above is a summary of the plan ... the precise terms and conditions ... are set out in the certificate"
 *   not_contract  "This Certificate is not a contract of insurance"
 *   dated     "Information is accurate as at July 2021"
 * and the document's own title when it names itself a numbered part of a certificate ("Certificate of Insurance Part 2:
 * Highlights of Cover"). Nothing is inferred: a sentence that is not found is not mentioned, and no sentence here
 * decides which schedule applies.
 */
import type { BenefitRecord } from "../benefit-records";
import { evidenceAt, type EvidenceRef } from "../evidence";
import { pageMap } from "../store";

export type StatusKind = "summary" | "not_contract" | "dated";
export type StatusClause = { kind: StatusKind; page: number; evidence: EvidenceRef; /** summary: what the precise terms are said to be set out in; dated: the printed date */ detail: string | null };
export type DocProfile = { /** the document's own title when it is a numbered part of a certificate ("Certificate of Insurance Part 2"), else null */ part: string | null; /** what that part is called ("highlights of cover") */ partTitle: string | null; clauses: StatusClause[] };

const SUMMARY = /\b(?:is|are)\s+(?:only\s+)?(?:a\s+)?summary\b|\bsummary\s+of\s+the\s+(?:plan|policy|cover|benefits?|scheme)\b/i;
const TERMS_ELSEWHERE = /\b(?:precise|full|complete|detailed|exact)\s+terms(?:\s+and\s+conditions)?\b[^.]{0,80}?\b(?:set\s+out|stated|contained|found|specified|provided)\s+in\s+(?:the\s+)?([a-z ]{3,40}?)(?:[.,;]|$)/i;
const NOT_CONTRACT = /\bnot\s+a\s+contract\s+of\s+insurance\b/i;
const DATED = /\binformation\s+is\s+accurate\s+as\s+at\s+((?:\d{1,2}\s+)?[A-Z][a-z]+\s+\d{4})/i;
const PART = /\bcertificate\s+of\s+insurance\s+part\s+(\d+)[ \t]*:[ \t]*([A-Za-z][A-Za-z ,&'-]{2,40})[ \t]*(?:\r?\n|$)/i;

/** Sentences of a page with their offsets in the ORIGINAL page text (newlines become spaces one-for-one, so offsets carry over). */
export function sentenceSpans(pageText: string): { text: string; start: number; end: number }[] {
  const flat = pageText.replace(/\n/g, " ");
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?]*(?:[.!?]+(?=\s|$)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) && m[0] !== "") {
    const raw = m[0], lead = raw.length - raw.trimStart().length, text = raw.trim();
    if (text) out.push({ text, start: m.index + lead, end: m.index + lead + text.length });
    if (re.lastIndex >= flat.length) break;
  }
  return out;
}

const lower = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The standing statements a document makes about itself (at most one of each kind), each bound to its page and span. */
export async function profileDocument(accountId: string, policy: BenefitRecord["policy"]): Promise<DocProfile> {
  const pages = await pageMap(accountId, policy.id);
  const clauses: StatusClause[] = [];
  let part: string | null = null, partTitle: string | null = null;
  const seen = new Set<StatusKind>();
  for (const [page, text] of [...pages.entries()].sort((x, y) => x[0] - y[0])) {
    if (!part && page <= 3) { const m = PART.exec(text); if (m) { part = `Certificate of Insurance Part ${m[1]}`; partTitle = lower(m[2]); } }
    const spans = sentenceSpans(text);
    for (const [i, s] of spans.entries()) {
      const add = (kind: StatusKind, detail: string | null, from = s.start, to = s.end) => {
        if (seen.has(kind)) return;
        seen.add(kind);
        const evidence = evidenceAt({ policyId: policy.id, documentHash: policy.version.documentHash, page, pageText: text, start: from, end: to });
        // (the citation shows the whole sentence -- the clause itself -- not the one line of it a later refinement would pick)
        evidence.support = { text: evidence.passage.text, start: evidence.passage.start, end: evidence.passage.end, onPage: page };
        clauses.push({ kind, page, detail, evidence });
      };
      if (NOT_CONTRACT.test(s.text)) add("not_contract", null);
      const dated = DATED.exec(s.text);
      if (dated) add("dated", dated[1]);
      // (the summary statement and the sentence naming where the precise terms are: adjacent sentences, or one)
      if (SUMMARY.test(s.text)) {
        for (const t of [s, spans[i + 1]].filter((x): x is NonNullable<typeof x> => !!x)) {
          const m = TERMS_ELSEWHERE.exec(t.text);
          if (m) { add("summary", m[1].trim().toLowerCase(), s.start, t.end); break; }
        }
      }
    }
  }
  return { part, partTitle, clauses };
}

/** What a document is called when two of one scheme are told apart: its own title as a certificate part, else its kind. */
export function documentLabel(policy: BenefitRecord["policy"], profile: DocProfile): string {
  if (profile.part) return profile.part;
  switch (policy.documentRole) {
    case "product_summary": return "Product Summary";
    case "benefit_guide": return "Benefit Guide";
    case "policy_wording": return "Policy Wording";
    case "brochure": return "Brochure";
    case "certificate": return policy.personalProof ? "Certificate" : "Supporting document";
    default: return policy.product ?? "document";
  }
}

/** One document's standing, as a clause of a sentence ("describes itself as a summary and says the precise terms are set out in the
 * certificate of insurance (page 37; its information is dated July 2021)"), or null when it states nothing of the kinds above. */
export function standingClause(label: string, profile: DocProfile): string | null {
  const by = (k: StatusKind) => profile.clauses.find((c) => c.kind === k);
  const summary = by("summary"), notContract = by("not_contract"), dated = by("dated");
  const parts: string[] = [];
  if (summary) parts.push(`describes itself as a summary and says the precise terms are set out in the ${summary.detail} (page ${summary.page}${dated ? `; its information is dated ${dated.detail}` : ""})`);
  else if (dated) parts.push(`dates its information ${dated.detail} (page ${dated.page})`);
  if (notContract) parts.push(`says it is not a contract of insurance (page ${notContract.page})`);
  return parts.length ? `The ${label}${profile.part && profile.partTitle ? `, its ${profile.partTitle},` : ""} ${parts.join(" and ")}.` : null;
}

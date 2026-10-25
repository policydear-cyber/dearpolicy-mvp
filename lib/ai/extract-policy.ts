import { z } from "zod";
import { structuredCompletion } from "./llm";
import type { PdfPage } from "@/lib/documents/pdf";
import { UNTRUSTED_DOCUMENT_NOTICE, cachedReading, delimitDocument, readingModelIdentity } from "@/lib/documents/evidence";
import { deterministicDocumentRole, personalDocumentTitle } from "@/lib/documents/intelligence";
import { correspondenceRole } from "@/lib/documents/messy";

const CoverageSchema = z.object({
  category: z.string(),
  productName: z.string().nullable(),
  policyNumber: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
  sourcePage: z.number().int().nullable(),
  evidenceText: z.string().nullable(),
  evidenceVerified: z.boolean().optional().default(false),
});

const InsuredPersonSchema = z.object({
  name: z.string(),
  relationshipHint: z.string().nullable(),
  coverages: z.array(CoverageSchema),
});

const PaymentRecordSchema = z.object({
  insuredPersonName: z.string().nullable(), insurer: z.string().nullable(), productName: z.string().nullable(), policyNumber: z.string().nullable(),
  amount: z.number().nullable(), currency: z.string().nullable(), frequency: z.string().nullable(), paymentDate: z.string().nullable(), periodStart: z.string().nullable(), periodEnd: z.string().nullable(),
  sourcePage: z.number().int().nullable(), notes: z.string().nullable(), evidenceText: z.string().nullable(),
});

const ReferenceCoverageSchema = z.object({
  category: z.string(), productName: z.string().nullable(), notes: z.string().nullable(), sourcePage: z.number().int().nullable(),
});

export const PolicyExtractionSchema = z.object({
  documentType: z.string().nullable(),
  documentRole: z.enum(["personal_schedule","certificate","endorsement","policy_wording","product_summary","benefit_guide","brochure","rider","policy_illustration","premium_receipt","renewal_statement","annual_statement","claim_receipt","claim_form","welcome_letter","insurer_letter","claim_decision","medical_bill","app_screenshot","personal_notes","other"]).nullable(),
  documentNotes: z.array(z.string()),
  insurer: z.string().nullable(), productName: z.string().nullable(), productsMentioned: z.array(z.string()), policyNumber: z.string().nullable(), groupPolicyNumber: z.string().nullable(), policyType: z.string().nullable(), policyholder: z.string().nullable(),
  personalCoverageConfirmed: z.boolean(), startDate: z.string().nullable(), renewalOrExpiryDate: z.string().nullable(),
  insuredPeople: z.array(InsuredPersonSchema),
  referenceCoverages: z.array(ReferenceCoverageSchema),
  premium: z.object({ amount: z.number().nullable(), currency: z.string().nullable(), frequency: z.string().nullable() }),
  paymentRecords: z.array(PaymentRecordSchema),
  keyExclusions: z.array(z.string()), waitingPeriods: z.array(z.string()), deductiblesAndCoinsurance: z.array(z.string()), riders: z.array(z.string()),
});

export type PolicyExtraction = z.infer<typeof PolicyExtractionSchema>;
/** The policy-extraction reply's output bound (it had none: an unbounded request). Room for a multi-person schedule. */
export const POLICY_EXTRACTION_MAX_OUTPUT_TOKENS = 6000;

const REFERENCE_ROLE_PATTERNS: Array<{ role: NonNullable<PolicyExtraction["documentRole"]>; test: (text: string) => boolean }> = [
  { role: "product_summary", test: (text) => /product summar(?:y|ies)/i.test(text) && /refer to (?:your )?certificate of insurance/i.test(text) },
  { role: "benefit_guide", test: (text) => /certificate of insurance\s*part\s*2|part\s*2\s*[:\-]?\s*(?:highlights|benefit)|highlights of cover/i.test(text) },
  { role: "benefit_guide", test: (text) => /benefit summary/i.test(text) && /(?:part\s*1|certificate|specific policy|sum insured)/i.test(text) },
  { role: "policy_wording", test: (text) => /policy wording|terms and conditions/i.test(text) && !/particulars of insured|certificate of insurance|policy schedule/i.test(text) },
  { role: "brochure", test: (text) => /brochure|product brochure/i.test(text) && !/policy schedule|certificate of insurance/i.test(text) },
];

function firstPagesText(pages: PdfPage[], count = 8) {
  return pages.slice(0, count).map((p) => p.text).join("\n");
}

/**
 * High-confidence generic/reference classification. When this fires DearPolicy
 * deliberately skips Qwen. Long generic booklets do not need a generative model
 * to decide who is insured, and avoiding that call makes ingestion faster and
 * much more stable on 8 GB GPUs.
 */
export function detectHighConfidenceReferenceRole(pages: PdfPage[]) {
  const text = firstPagesText(pages, 8);
  // Do not short-circuit a combined Part 1 + Part 2 certificate. It needs the
  // personal extraction path for ownership even though later pages also
  // contain generic benefit wording.
  if (/certificate of (?:group )?insurance/i.test(text) && /particulars of insured|insured person(?:'s)? name|name of insured/i.test(text) && /sum insured|sum assured|effective date/i.test(text)) return null;
  // A renewal certificate or policy contract naming its insured is personal.
  if (personalDocumentTitle(firstPagesText(pages, 2))) return null;
  // Round 10: a letter, claim decision or bill that mentions the policy wording is not the wording.
  if (correspondenceRole(pages)) return null;
  for (const candidate of REFERENCE_ROLE_PATTERNS) if (candidate.test(text)) return candidate.role;
  return null;
}

function inferInsurer(text: string) {
  const candidates: Array<[RegExp, string]> = [
    [/\bsinglife\b/i, "Singlife"],
    [/\bsingapore life ltd\b/i, "Singlife"],
    [/\bAIA\b/i, "AIA"],
    [/\bprudential\b/i, "Prudential"],
    [/\bgreat eastern\b/i, "Great Eastern"],
    [/\bincome insurance\b|\bntuc income\b/i, "Income Insurance"],
    [/\bmanulife\b/i, "Manulife"],
    [/\bFWD\b/i, "FWD"],
    [/\bHSBC Life\b/i, "HSBC Life"],
  ];
  return candidates.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function inferProducts(text: string) {
  const products: Array<[RegExp, string]> = [
    [/group term life/i, "Group Term Life"],
    [/group personal accident/i, "Group Personal Accident"],
    [/living care plus/i, "Living Care Plus"],
    [/\bliving care\b/i, "Living Care"],
    [/disability income/i, "Disability Income"],
    [/outpatient medicare/i, "Outpatient Medicare"],
    [/hospital(?:isation|ization)/i, "Hospitalisation"],
  ];
  return products.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function groupPolicyNumber(text: string) {
  return text.match(/group\s+policy\s+(?:no\.?|number)\s*[:#-]?\s*([A-Z0-9-]{4,})/i)?.[1] ?? null;
}


/** A group scheme's own title, as its first page prints it on a line of its own ("<Scheme name> Group Insurance", "...
 * Group Insurance Scheme"), for any employer or insurer. Null when there is none: no product name is guessed. */
function inferProductName(text: string) {
  const title = text.split("\n").slice(0, 15).map((l) => l.trim().replace(/\s+/g, " "))
    .find((l) => l.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9&'.,() -]*\bgroup\s+insurance(?:\s+scheme)?$/i.test(l));
  return title ?? null;
}

/** Round 5: what plain code can read when the reading service failed on a
 * document whose text layer is readable -- its role by the document's own
 * wording, insurer, product and printed policy number. It names no people and
 * confirms no cover (only the model reading does that, on a later retry), so
 * nothing personal is guessed. */
export function buildCodeOnlyExtraction(pages: PdfPage[]): PolicyExtraction {
  const text = pages.map((p) => p.text).join("\n");
  const role = deterministicDocumentRole(pages, null);
  const policyNumber = text.match(/\bpolicy\s+(?:no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,})/i)?.[1] ?? null;
  return PolicyExtractionSchema.parse({
    documentType: role ? role.replace(/_/g, " ") : "Document",
    documentRole: role,
    documentNotes: ["DearPolicy read this document's text and tables with plain code because its reading service was unavailable. Who it covers and the cover amounts are read when it tries again."],
    insurer: inferInsurer(text),
    productName: inferProductName(text),
    productsMentioned: inferProducts(text),
    policyNumber,
    groupPolicyNumber: groupPolicyNumber(text),
    policyType: null,
    policyholder: null,
    personalCoverageConfirmed: false,
    startDate: null,
    renewalOrExpiryDate: null,
    insuredPeople: [],
    referenceCoverages: [],
    premium: { amount: null, currency: null, frequency: null },
    paymentRecords: [],
    keyExclusions: [],
    waitingPeriods: [],
    deductiblesAndCoinsurance: [],
    riders: [],
  });
}

export function buildDeterministicReferenceExtraction(pages: PdfPage[], role: NonNullable<PolicyExtraction["documentRole"]>): PolicyExtraction {
  const text = pages.map((p) => p.text).join("\n");
  const productName = inferProductName(text);
  return PolicyExtractionSchema.parse({
    documentType: role === "product_summary" ? "Product Summary" : role === "benefit_guide" ? "Benefit Summary / Guide" : role === "policy_wording" ? "Policy Wording" : "Reference Document",
    documentRole: role,
    documentNotes: ["DearPolicy classified this as a generic reference document without using the local chat model.", "Generic reference documents do not establish personal policy ownership."],
    insurer: inferInsurer(text),
    productName,
    productsMentioned: inferProducts(text),
    policyNumber: null,
    groupPolicyNumber: groupPolicyNumber(text),
    policyType: null,
    policyholder: null,
    personalCoverageConfirmed: false,
    startDate: null,
    renewalOrExpiryDate: null,
    insuredPeople: [],
    referenceCoverages: [],
    premium: { amount: null, currency: null, frequency: null },
    paymentRecords: [],
    keyExclusions: [],
    waitingPeriods: [],
    deductiblesAndCoinsurance: [],
    riders: [],
  });
}

function pageScore(text: string) {
  const patterns: Array<[RegExp, number]> = [
    [/certificate of insurance|policy schedule|schedule of insurance|endorsement/i, 8],
    [/insured person|life assured|policyholder|name of insured/i, 6],
    [/sum insured|sum assured|coverage amount/i, 5],
    [/policy no\.?|policy number|certificate no\.?/i, 4],
    [/effective date|commencement date|renewal date/i, 3],
    [/premium/i, 3],
    [/S\$|SGD|\$\s?\d/i, 2],
  ];
  return patterns.reduce((score, [pattern, weight]) => score + (pattern.test(text) ? weight : 0), 0);
}

function compactSample(pages: PdfPage[], maxChars: number, perPageChars: number) {
  if (!pages.length) return "";
  const ranked = pages.map((page, index) => ({ page, index, score: pageScore(page.text) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = new Map<number, PdfPage>();
  for (const index of [0, 1, pages.length - 1]) {
    const page = pages[index];
    if (page) selected.set(page.pageNumber, page);
  }
  for (const item of ranked) {
    if (selected.size >= 5) break;
    selected.set(item.page.pageNumber, item.page);
  }

  let output = "";
  for (const page of [...selected.values()].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const block = `--- PAGE ${page.pageNumber} ---\n${page.text.slice(0, perPageChars)}\n\n`;
    if (output.length + block.length > maxChars) {
      const remaining = maxChars - output.length;
      if (remaining > 350) output += block.slice(0, remaining);
      break;
    }
    output += block;
  }
  return output.trim();
}

/** Exported for the prompt-safety regressions. */
export const POLICY_EXTRACTION_SYSTEM_PROMPT = `You are DearPolicy's conservative insurance-document extraction engine. Accuracy is more important than completeness.
Unknown scalar fields must be null. Unknown lists must be []. Never invent names, ownership, amounts, dates, policy numbers or premiums.

PERSON DETECTION
Only return real human names printed in a personalised context. Never return labels such as Insured Member, Insured Person, Insured Spouse, Insured Children, Policyholder, Member, Affiliate Member, Spouse, Child(ren), Dependant or Applicant as people.

OWNERSHIP
personalCoverageConfirmed=true only when a personalised schedule, certificate or endorsement clearly associates a named person with specific cover. Generic product information, eligibility text, maximums and sample premium tables are never personal ownership.
For every personal coverage/payment, sourcePage is required and evidenceText must be a short exact phrase copied from that page. For every referenceCoverages item too, sourcePage is required: the exact page where that specific product's own benefit section appears, never the document's first page, a cover page or a table of contents -- a multi-product reference document has a different page per product, and this page number is how the chat later binds a quoted clause to the right product instead of leaving it unmatched.
For every currency field, return a 3-letter ISO 4217 code such as SGD, USD, MYR or PHP. Never return symbols such as S$, $, RM, ₱, € or £.

ROLES
personal_schedule = personalised policy schedule; certificate = personalised certificate; endorsement = personalised amendment; policy_wording/product_summary/benefit_guide/brochure = generic reference; premium_receipt/renewal_statement/annual_statement = payment/account evidence; claim_receipt/claim_form = claims documents; insurer_letter = any other letter from the insurer (for example a premium revision or a rider being withdrawn); claim_decision = the insurer's decision on a claim; medical_bill = a hospital or clinic bill; app_screenshot = a screenshot of an insurer's app; personal_notes = notes the family wrote themselves. A letter, claim decision, bill, screenshot or note is never a personal schedule and never confirms cover: a figure it prints (an amount claimed, a bill total, a future premium) is not a cover amount or the current premium.

CATEGORIES
Use Hospitalisation; Hospital Cash; Death; Total Permanent Disability; Critical Illness; Early Critical Illness; Personal Accident; Disability Income; Outpatient; Long-term Care; Travel; Home; Motor; Savings; Investment; Other.
Group Term Life may create separate Death and TPD items when personally confirmed. Do not call a daily hospital cash benefit Hospitalisation; use Hospital Cash. Group Personal Accident => Personal Accident. Living Care => Critical Illness. Living Care Plus => Early Critical Illness.
Generic rate tables are never a personal premium.

DOCUMENT TEXT
The selected pages arrive between <document> and </document>.${UNTRUSTED_DOCUMENT_NOTICE}`;

function isTransientModelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|connection error|timed out|temporarily unavailable|ECONNRESET|socket|aborted/i.test(message);
}

/** `owner` (household + document) is recorded on the model_executions
 * provenance row, so an extracted fact can be traced to the call that read it. */
export async function extractPolicyStructure(pages: PdfPage[], owner?: { accountId: string; policyId: string }): Promise<PolicyExtraction> {
  const referenceRole = detectHighConfidenceReferenceRole(pages);
  if (referenceRole) return buildDeterministicReferenceExtraction(pages, referenceRole);

  // Keep the prompt intentionally small. The earlier build could feed tens of
  // thousands of characters into Qwen3, causing long stalls / model-process
  // resets on 8 GB GPUs. The full PDF is still indexed separately for RAG.
  const primarySample = compactSample(pages, 7_500, 2_200);
  // Cached by the exact sample read (derived from the document's own text),
  // so a retried job or a re-upload of identical bytes never pays for the
  // same extraction twice.
  const model = await readingModelIdentity();
  try {
    return await cachedReading(owner, "policy_extraction", { sample: primarySample, prompt: POLICY_EXTRACTION_SYSTEM_PROMPT }, model, () => structuredCompletion({
      role: "reading",
      operation: "policy_extraction",
      householdId: owner?.accountId,
      resourceId: owner?.policyId,
      system: POLICY_EXTRACTION_SYSTEM_PROMPT,
      user: `Extract only facts supported by these selected pages. The complete document will be indexed separately.\n\n${delimitDocument(primarySample)}`,
      schema: PolicyExtractionSchema,
      temperature: 0,
      // Bounded: a request with no max output is unbounded spend (and the live run's guard refuses it).
      maxOutputTokens: POLICY_EXTRACTION_MAX_OUTPUT_TOKENS,
      timeoutMs: 240_000,
      attempts: 1,
      }));
  } catch (error) {
    if (!isTransientModelError(error)) throw error;

    // One deliberate smaller fallback is more useful than retrying the same
    // oversized request three times. This keeps total failure time bounded.
    const fallbackSample = compactSample(pages, 4_200, 1_350);
    return cachedReading(owner, "policy_extraction_fallback", { sample: fallbackSample, prompt: POLICY_EXTRACTION_SYSTEM_PROMPT }, model, () => structuredCompletion({
      role: "reading",
      operation: "policy_extraction",
      householdId: owner?.accountId,
      resourceId: owner?.policyId,
      system: POLICY_EXTRACTION_SYSTEM_PROMPT,
      user: `Retry with a minimal evidence sample. Extract only clearly visible facts; use null/[] for everything else.\n\n${delimitDocument(fallbackSample)}`,
      schema: PolicyExtractionSchema,
      temperature: 0,
      maxOutputTokens: POLICY_EXTRACTION_MAX_OUTPUT_TOKENS,
      timeoutMs: 180_000,
      attempts: 1,
      }));
  }
}

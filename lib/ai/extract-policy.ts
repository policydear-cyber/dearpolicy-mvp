import { z } from "zod";
import { structuredCompletion } from "./llm";
import type { PdfPage } from "@/lib/documents/pdf";

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
  documentRole: z.enum(["personal_schedule","certificate","endorsement","policy_wording","product_summary","benefit_guide","brochure","rider","policy_illustration","premium_receipt","renewal_statement","annual_statement","claim_receipt","claim_form","welcome_letter","other"]).nullable(),
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


function inferProductName(text: string) {
  if (/MINDEF\s*&\s*MHA\s+Group Insurance/i.test(text)) return "MINDEF & MHA Group Insurance";
  return null;
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

const systemPrompt = `You are DearPolicy's conservative insurance-document extraction engine. Accuracy is more important than completeness.
Unknown scalar fields must be null. Unknown lists must be []. Never invent names, ownership, amounts, dates, policy numbers or premiums.

PERSON DETECTION
Only return real human names printed in a personalised context. Never return labels such as Insured Member, Insured Person, Insured Spouse, Insured Children, Policyholder, Member, Affiliate Member, Spouse, Child(ren), Dependant or Applicant as people.

OWNERSHIP
personalCoverageConfirmed=true only when a personalised schedule, certificate or endorsement clearly associates a named person with specific cover. Generic product information, eligibility text, maximums and sample premium tables are never personal ownership.
For every personal coverage/payment, sourcePage is required and evidenceText must be a short exact phrase copied from that page. For every referenceCoverages item too, sourcePage is required: the exact page where that specific product's own benefit section appears, never the document's first page, a cover page or a table of contents -- a multi-product reference document has a different page per product, and this page number is how the chat later binds a quoted clause to the right product instead of leaving it unmatched.
For every currency field, return a 3-letter ISO 4217 code such as SGD, USD, MYR or PHP. Never return symbols such as S$, $, RM, ₱, € or £.

ROLES
personal_schedule = personalised policy schedule; certificate = personalised certificate; endorsement = personalised amendment; policy_wording/product_summary/benefit_guide/brochure = generic reference; premium_receipt/renewal_statement/annual_statement = payment/account evidence; claim_receipt/claim_form = claims documents.

CATEGORIES
Use Hospitalisation; Hospital Cash; Death; Total Permanent Disability; Critical Illness; Early Critical Illness; Personal Accident; Disability Income; Outpatient; Long-term Care; Travel; Home; Motor; Savings; Investment; Other.
Group Term Life may create separate Death and TPD items when personally confirmed. Do not call a daily hospital cash benefit Hospitalisation; use Hospital Cash. Group Personal Accident => Personal Accident. Living Care => Critical Illness. Living Care Plus => Early Critical Illness.
Generic rate tables are never a personal premium.`;

function isTransientModelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|connection error|timed out|temporarily unavailable|ECONNRESET|socket|aborted/i.test(message);
}

export async function extractPolicyStructure(pages: PdfPage[]): Promise<PolicyExtraction> {
  const referenceRole = detectHighConfidenceReferenceRole(pages);
  if (referenceRole) return buildDeterministicReferenceExtraction(pages, referenceRole);

  // Keep the prompt intentionally small. The earlier build could feed tens of
  // thousands of characters into Qwen3, causing long stalls / model-process
  // resets on 8 GB GPUs. The full PDF is still indexed separately for RAG.
  const primarySample = compactSample(pages, 7_500, 2_200);
  try {
    return await structuredCompletion({
      role: "reading",
      operation: "policy_extraction",
      system: systemPrompt,
      user: `Extract only facts supported by these selected pages. The complete document will be indexed separately.\n\n${primarySample}`,
      schema: PolicyExtractionSchema,
      temperature: 0,
      timeoutMs: 240_000,
      attempts: 1,
      });
  } catch (error) {
    if (!isTransientModelError(error)) throw error;

    // One deliberate smaller fallback is more useful than retrying the same
    // oversized request three times. This keeps total failure time bounded.
    const fallbackSample = compactSample(pages, 4_200, 1_350);
    return structuredCompletion({
      role: "reading",
      operation: "policy_extraction",
      system: systemPrompt,
      user: `Retry with a minimal evidence sample. Extract only clearly visible facts; use null/[] for everything else.\n\n${fallbackSample}`,
      schema: PolicyExtractionSchema,
      temperature: 0,
      timeoutMs: 180_000,
      attempts: 1,
      });
  }
}

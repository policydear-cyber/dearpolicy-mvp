/**
 * Reads hospital-cash, ICU-cash, surgical and inpatient/pre-/post-
 * hospitalisation reimbursement wording directly from uploaded policy
 * text -- the medical-claims analogue of lib/claims/ci-evidence.ts and
 * lib/claims/death-evidence.ts. See those modules' doc comments for the
 * general approach (deterministic regex reading of quoted wording, never
 * a model, with an exact page citation for every rule); this module
 * applies it to the "Hospitalisation" product's benefit clauses.
 *
 * Every rule this module returns carries the exact quote and page it was
 * read from. A benefit this module cannot find explicit wording for is
 * never guessed at -- the caller (lib/claims/medical-rules.ts) leaves it
 * as `needs_document` with no amount, exactly like an unresolved CI or
 * death-benefit coverage does.
 */
import { query } from "@/lib/db/client";
import { canonicalProduct, productFromCategory, type OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimEvidence } from "./types";
import type { DayCountEdgeInclusion, DayCountRule } from "./day-count";

export type MedicalBenefitCode = "med-hospital-cash" | "med-icu-cash" | "med-surgical" | "med-inpatient" | "med-pre-hospitalisation" | "med-post-hospitalisation";

export type MedicalCashRule = {
  coverageId: string;
  benefitCode: "med-hospital-cash" | "med-icu-cash";
  dailyRateMinor: number;
  currency: string;
  capDays: number | null;
  quote: string;
  citation: ClaimEvidence;
};

export type MedicalReimbursementRule = {
  coverageId: string;
  benefitCode: "med-surgical" | "med-inpatient" | "med-pre-hospitalisation" | "med-post-hospitalisation";
  eligibleCategories: string[];
  categoryLimits: { category: string; capMinor: number }[];
  quote: string;
  citation: ClaimEvidence;
};

/** Plan-wide provisions -- deductible, co-insurance, panel-restriction and
 * day-count-rule wording that (per the reviewed policy documents supplied
 * for this build) applies uniformly across every Hospitalisation-product
 * benefit clause rather than being restated per clause. A future PR can
 * split these per-clause if a reviewed policy is found to vary them. */
export type MedicalPlanProvisions = {
  coverageId: string;
  deductibleMinor: number | null;
  coInsurancePercent: number | null;
  nonPanelFactor: number | null;
  dayCountRule: DayCountRule | null;
  /** Evidenced admission/discharge day-count edge inclusion -- see
   * lib/claims/day-count.ts's DayCountEdgeInclusion. null when the
   * wording does not explicitly state BOTH edges (never guessed at, and
   * never defaulted to a "conventional" rule -- see findPlanProvisions()). */
  edgeInclusion: { admissionDayIncluded: boolean; dischargeDayIncluded: boolean } | null;
  waitingDays: number | null;
  citation: ClaimEvidence;
};

export type MedicalEvidenceGapReasonCode = "GROUP_MISMATCH" | "AMBIGUOUS_EVIDENCE" | "DOCUMENT_FOUND_NO_CLAUSE" | "NO_MATCHING_DOCUMENT";
export type MedicalEvidenceGap = { coverageId: string; reason: string; nextStep: string; reasonCode?: MedicalEvidenceGapReasonCode };

export type MedicalWordingPage = {
  policy_id: string; page_number: number; text: string; group_policy_number: string | null;
  insurer: string | null; product_name: string | null; original_filename: string;
  document_role: string | null; personal_coverage_confirmed: boolean; linked_to_member: boolean;
};
type Page = { page_number: number; text: string };

const SECTION_HEADING = /\b(?:Group\s+)?Hospitalisation(?:\s+(?:and|&)\s+Surgical)?(?:\s+Benefits?|\s+Plan|\s+Rider)?\b/gi;
const REFERENCE_ROLES = new Set(["policy_wording", "product_summary", "benefit_guide", "benefit_summary", "rider"]);
const SINGLIFE_ALIASES = new Set(["singlife", "singlifewithaviva", "singaporelifeltd", "singaporelifelimited", "singaporelifeltdsinglife", "singaporelifelimitedsinglife"]);

export function canonicalMedicalInsurer(value: string | null | undefined) {
  const name = (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return name ? (SINGLIFE_ALIASES.has(name) ? "singlife" : name) : null;
}
function groupNumber(value: string | null | undefined) { return value?.replace(/\s+/g, "").toUpperCase() || null; }
function documentGroup(pages: MedicalWordingPage[]) {
  if (pages[0].group_policy_number) return groupNumber(pages[0].group_policy_number);
  const numbers = new Set(pages.flatMap(p => [...p.text.matchAll(/\bgroup\s+policy\s+(?:no\.?|number)\s*[:#.-]?\s*([A-Z0-9-]{4,})/gi)].map(m => groupNumber(m[1]))));
  return numbers.size === 1 ? [...numbers][0] : null;
}
function documentInsurer(pages: MedicalWordingPage[]) {
  if (pages[0].insurer) return canonicalMedicalInsurer(pages[0].insurer);
  return pages.some(p => /\bSingapore\s+Life\s+(?:Ltd|Limited)\b/i.test(p.text)) ? "singlife" : null;
}

const MONEY_PATTERN = /(?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*([\d,]+(?:\.\d+)?)/i;
function explicitCurrency(text: string) {
  if (/\bUS\$|USD\b/i.test(text)) return "USD";
  if (/\bS\$|SGD\b/i.test(text)) return "SGD";
  if (/\bMYR\b/i.test(text)) return "MYR";
  if (/\bEUR|€/i.test(text)) return "EUR";
  if (/\bGBP|£/i.test(text)) return "GBP";
  return "SGD";
}
function parseMoney(text: string): number | null {
  const m = text.match(MONEY_PATTERN);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function findCashRule(segment: string, label: RegExp, benefitCode: "med-hospital-cash" | "med-icu-cash", pageAt: (offset: number) => number, baseOffset: number): { benefitCode: typeof benefitCode; dailyRateMinor: number; currency: string; capDays: number | null; quote: string; page: number; pageEnd: number } | null {
  const heading = segment.match(label);
  if (!heading) return null;
  const tail = segment.slice(heading.index! + heading[0].length, heading.index! + heading[0].length + 260);
  const rate = tail.match(/(?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?\s*(?:per\s+day|(?:for\s+)?each\s+day|\/\s*day)\b/i);
  if (!rate) return null;
  const amount = parseMoney(rate[0]);
  if (amount == null) return null;
  const capMatch = tail.match(/\b(?:up\s+to|maximum\s+of)\s+(\d{1,4})\s*(?:payable\s+)?days?\b/i);
  const capDays = capMatch ? Number(capMatch[1]) : null;
  const end = rate.index! + rate[0].length;
  const absolute = baseOffset + heading.index!;
  const quote = `${heading[0]}${tail.slice(0, end)}`.trim();
  return { benefitCode, dailyRateMinor: Math.round(amount * 100), currency: explicitCurrency(rate[0]), capDays, quote, page: pageAt(absolute), pageEnd: pageAt(absolute + quote.length - 1) };
}

const REIMBURSEMENT_HEADINGS: { pattern: RegExp; benefitCode: MedicalReimbursementRule["benefitCode"] }[] = [
  { pattern: /\bSurgical\s+(?:Fees?\s+)?Benefit\b/i, benefitCode: "med-surgical" },
  { pattern: /\bInpatient\s+Medical\s+(?:Expenses?|Treatment)\s+Benefit\b/i, benefitCode: "med-inpatient" },
  { pattern: /\bPre-?\s?Hospitalisation\s+Treatment\s+Benefit\b/i, benefitCode: "med-pre-hospitalisation" },
  { pattern: /\bPost-?\s?Hospitalisation\s+Treatment\s+Benefit\b/i, benefitCode: "med-post-hospitalisation" },
];
const CATEGORY_LINE = /\b(surgical\s+fees|anaesthetist\s+fees|room\s+and\s+board|hospital\s+services|specialist\s+fees|diagnostic\s+(?:tests?|imaging)|medication|follow-?up\s+consultation)\b\s*[:\-]?\s*(?:up\s+to\s+)?((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)?/gi;

function findReimbursementRule(segment: string, pattern: RegExp, benefitCode: MedicalReimbursementRule["benefitCode"], pageAt: (offset: number) => number, baseOffset: number): { benefitCode: typeof benefitCode; eligibleCategories: string[]; categoryLimits: { category: string; capMinor: number }[]; quote: string; page: number; pageEnd: number } | null {
  const heading = segment.match(pattern);
  if (!heading) return null;
  const tail = segment.slice(heading.index! + heading[0].length, heading.index! + heading[0].length + 900);
  const stop = tail.search(/\n\s*\n/);
  const window = stop > 0 ? tail.slice(0, stop) : tail;
  const eligibleCategories: string[] = [];
  const categoryLimits: { category: string; capMinor: number }[] = [];
  for (const m of window.matchAll(CATEGORY_LINE)) {
    const category = m[1].toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
    eligibleCategories.push(category);
    const amount = m[2] ? parseMoney(m[2]) : null;
    if (amount != null) categoryLimits.push({ category, capMinor: Math.round(amount * 100) });
  }
  if (eligibleCategories.length === 0) return null;
  const absolute = baseOffset + heading.index!;
  const quote = `${heading[0]}${window}`.trim().slice(0, 500);
  return { benefitCode, eligibleCategories, categoryLimits, quote, page: pageAt(absolute), pageEnd: pageAt(absolute + quote.length - 1) };
}

function findPlanProvisions(segment: string, pageAt: (offset: number) => number, baseOffset: number): Omit<MedicalPlanProvisions, "citation" | "coverageId"> & { page: number } {
  const deductible = segment.match(/\bdeductible\s+of\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)\b/i);
  const coIns = segment.match(/\bco-?insurance\s+of\s+(\d{1,3}(?:\.\d+)?)\s*%/i);
  const nonPanel = segment.match(/\bnon-?panel\b[^.]{0,80}?(\d{1,3}(?:\.\d+)?)\s*%/i);
  const calendarDay = /\bcalendar\s+days?\b.{0,40}\bcount(?:ed|s)?\b|\bcounted\s+as\s+calendar\s+days?\b/i.test(segment);
  const completed24h = /\bcompleted\s+24-?\s?hour\s+period\b/i.test(segment);
  const waiting = segment.match(/\bwaiting\s+period\s+of\s+(\d{1,3})\s*(?:calendar\s+)?days?\b/i);
  // Edge inclusion is only ever set when BOTH the admission-day and
  // discharge-day rule are explicitly, separately stated -- one-sided
  // wording (e.g. only the discharge day is mentioned) is left null
  // rather than guessed, exactly like every other field here.
  const admissionIncluded = /\bday\s+of\s+admission\b[^.]{0,60}?\bis\s+counted\b/i.test(segment) || /\badmission\s+day\s+is\s+(?:included|counted)\b/i.test(segment);
  const admissionExcluded = /\bday\s+of\s+admission\b[^.]{0,60}?\bis\s+not\s+counted\b/i.test(segment) || /\badmission\s+day\s+is\s+(?:excluded|not\s+counted)\b/i.test(segment);
  const dischargeIncluded = /\bday\s+of\s+discharge\b[^.]{0,60}?\bis\s+counted\b/i.test(segment) || /\bdischarge\s+day\s+is\s+(?:included|counted)\b/i.test(segment);
  const dischargeExcluded = /\bday\s+of\s+discharge\b[^.]{0,60}?\bis\s+not\s+counted\b/i.test(segment) || /\bdischarge\s+day\s+is\s+(?:excluded|not\s+counted)\b/i.test(segment);
  const edgeInclusion: DayCountEdgeInclusion | null =
    (admissionIncluded || admissionExcluded) && (dischargeIncluded || dischargeExcluded) && !(admissionIncluded && admissionExcluded) && !(dischargeIncluded && dischargeExcluded)
      ? { admissionDayIncluded: admissionIncluded, dischargeDayIncluded: dischargeIncluded }
      : null;
  return {
    deductibleMinor: deductible ? Math.round((parseMoney(deductible[1]) ?? 0) * 100) || null : null,
    coInsurancePercent: coIns ? Number(coIns[1]) : null,
    nonPanelFactor: nonPanel ? Math.max(0, Math.min(1, 1 - Number(nonPanel[1]) / 100)) : null,
    dayCountRule: completed24h ? "completed_24h_period" : calendarDay ? "calendar_day" : null,
    edgeInclusion,
    waitingDays: waiting ? Number(waiting[1]) : null,
    page: pageAt(baseOffset),
  };
}

/** Reads every hospitalisation-product benefit clause out of one policy's
 * own wording pages. Returns an entry per benefit row actually found --
 * never a guess for a row the wording does not state. */
export function findMedicalRules(pages: Page[]): {
  cash: (Omit<MedicalCashRule, "coverageId" | "citation"> & { page: number; pageEnd: number })[];
  reimbursement: (Omit<MedicalReimbursementRule, "coverageId" | "citation"> & { page: number; pageEnd: number })[];
  provisions: (Omit<MedicalPlanProvisions, "citation" | "coverageId"> & { page: number }) | null;
} {
  let joined = "";
  const offsets: { start: number; page: number }[] = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    offsets.push({ start: joined.length, page: page.page_number }); joined += `${page.text}\n`;
  }
  const pageAt = (position: number) => offsets.filter(p => p.start <= position).at(-1)?.page ?? 1;
  const headings = [...joined.matchAll(SECTION_HEADING)];
  const cash: (Omit<MedicalCashRule, "coverageId" | "citation"> & { page: number; pageEnd: number })[] = [];
  const reimbursement: (Omit<MedicalReimbursementRule, "coverageId" | "citation"> & { page: number; pageEnd: number })[] = [];
  let provisions: (Omit<MedicalPlanProvisions, "citation" | "coverageId"> & { page: number }) | null = null;

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const start = heading.index! + heading[0].length;
    const segment = joined.slice(start, headings[i + 1]?.index ?? joined.length);

    const hospitalCash = findCashRule(segment, /\bDaily\s+Hospital\s+Cash(?:\s+Benefit)?\b/i, "med-hospital-cash", pageAt, start);
    if (hospitalCash) cash.push(hospitalCash);
    const icuCash = findCashRule(segment, /\bDaily\s+ICU\s+Cash(?:\s+Benefit)?\b/i, "med-icu-cash", pageAt, start);
    if (icuCash) cash.push(icuCash);

    for (const { pattern, benefitCode } of REIMBURSEMENT_HEADINGS) {
      const rule = findReimbursementRule(segment, pattern, benefitCode, pageAt, start);
      if (rule) reimbursement.push(rule);
    }

    if (!provisions) {
      const found = findPlanProvisions(segment, pageAt, start);
      if (found.deductibleMinor != null || found.coInsurancePercent != null || found.dayCountRule != null) provisions = found;
    }
  }
  return { cash, reimbursement, provisions };
}

/** Rows are scoped to one account, using the exact same fail-closed,
 * tiered evidence-document precedence as lib/claims/death-evidence.ts's
 * resolveDeathEvidence() and lib/claims/ci-evidence.ts's resolveCIEvidence()
 * -- see those functions' doc comments for the full rationale. */
export function resolveMedicalEvidence(coverages: OwnedCoverage[], rows: MedicalWordingPage[]) {
  const documents = new Map<string, MedicalWordingPage[]>();
  for (const row of rows) documents.set(row.policy_id, [...(documents.get(row.policy_id) ?? []), row]);
  const allDocuments = [...documents.values()];
  const cashRules: MedicalCashRule[] = [];
  const reimbursementRules: MedicalReimbursementRule[] = [];
  const planProvisions: MedicalPlanProvisions[] = [];
  const gaps: MedicalEvidenceGap[] = [];

  for (const coverage of coverages) {
    const product = canonicalProduct(coverage.productName) || productFromCategory(coverage.category);
    if (product !== "hospitalisation") continue;
    const insurer = canonicalMedicalInsurer(coverage.insurer);
    const wantedGroup = groupNumber(coverage.groupPolicyNumber);
    const sameGroupAndInsurer = (pages: MedicalWordingPage[]) => insurer != null && insurer === documentInsurer(pages) && documentGroup(pages) === wantedGroup;

    const ownDocument = allDocuments.filter((pages) => pages[0].policy_id === coverage.policyId);
    const linkedDocuments = allDocuments.filter((pages) => pages[0].policy_id !== coverage.policyId && pages[0].linked_to_member === true && sameGroupAndInsurer(pages));
    const referenceDocuments = allDocuments.filter((pages) => {
      const first = pages[0];
      return first.policy_id !== coverage.policyId && first.linked_to_member !== true
        && first.personal_coverage_confirmed === false && REFERENCE_ROLES.has(first.document_role ?? "")
        && sameGroupAndInsurer(pages);
    });

    const tiers: { name: string; documents: MedicalWordingPage[][] }[] = [
      { name: "own", documents: ownDocument }, { name: "linked", documents: linkedDocuments }, { name: "reference", documents: referenceDocuments },
    ];

    let resolved = false;
    let anyDocumentSeen = false;
    for (const tier of tiers) {
      if (tier.documents.length === 0) continue;
      anyDocumentSeen = true;
      if (tier.documents.length > 1) {
        gaps.push({
          coverageId: coverage.id, reasonCode: "AMBIGUOUS_EVIDENCE",
          reason: `${tier.documents.length} equally valid policy documents match this cover's insurer and group at the same evidence tier ("${tier.name}"), so DearPolicy cannot deterministically pick one for the hospitalisation wording.`,
          nextStep: "Remove the duplicate/extra document, or explicitly confirm which document is this person's own policy wording.",
        });
        resolved = true; break;
      }
      const pages = tier.documents[0];
      const first = pages[0];
      const found = findMedicalRules(pages);
      if (!found.cash.length && !found.reimbursement.length) continue;
      const citationFor = (page: number, pageEnd: number, label: string): ClaimEvidence => ({
        chunkId: `page:${first.policy_id}:${page}`, policyId: first.policy_id, policyName: first.product_name ?? first.original_filename,
        insurer: first.insurer ?? undefined, pageStart: page, pageEnd, documentRole: first.document_role,
        personalEvidence: false, evidenceLabel: label,
      });
      for (const rule of found.cash) cashRules.push({ coverageId: coverage.id, ...rule, citation: citationFor(rule.page, rule.pageEnd, `${rule.benefitCode} wording`) });
      for (const rule of found.reimbursement) reimbursementRules.push({ coverageId: coverage.id, ...rule, citation: citationFor(rule.page, rule.pageEnd, `${rule.benefitCode} wording`) });
      if (found.provisions) planProvisions.push({ ...found.provisions, coverageId: coverage.id, citation: citationFor(found.provisions.page, found.provisions.page, "Hospitalisation plan provisions") });
      resolved = true; break;
    }
    if (!resolved) gaps.push(anyDocumentSeen
      ? { coverageId: coverage.id, reasonCode: "DOCUMENT_FOUND_NO_CLAUSE", reason: "A matching policy document is uploaded, but I could not verify its hospitalisation benefit clauses.", nextStep: "Check that the uploaded benefit summary or wording is readable and includes the Hospitalisation section." }
      : { coverageId: coverage.id, reasonCode: "NO_MATCHING_DOCUMENT", reason: "I could not find uploaded hospitalisation wording that matches this cover's insurer and group.", nextStep: "Add the matching policy wording or benefit summary if it is missing; keep documents that are already uploaded." });
  }
  return { cashRules, reimbursementRules, planProvisions, gaps };
}

export async function loadMedicalEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  const result = await query<MedicalWordingPage>(`SELECT p.id AS policy_id, pp.page_number, pp.text, p.group_policy_number,
             p.insurer, p.product_name, p.original_filename, p.document_role, p.personal_coverage_confirmed,
             EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2) AS linked_to_member
        FROM policies p JOIN policy_pages pp ON pp.policy_id=p.id AND pp.account_id=p.account_id
       WHERE p.account_id=$1 AND p.processing_status='ready'
         AND (EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2)
              OR (p.personal_coverage_confirmed=false AND p.document_role IN ('policy_wording','product_summary','benefit_guide','benefit_summary','rider')))
       ORDER BY p.document_authority DESC, p.created_at DESC, p.id, pp.page_number
       LIMIT 1000`, [accountId, familyMemberId]);
  return { ...resolveMedicalEvidence(coverages, result.rows), pages: result.rows };
}

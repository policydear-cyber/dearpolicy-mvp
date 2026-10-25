/**
 * Reads a critical-illness benefit's own definition and payout wording
 * directly from uploaded policy text -- the CI analogue of
 * lib/claims/death-evidence.ts. See that module's doc comment for the
 * general approach (deterministic regex reading of quoted wording, never a
 * model, with an exact page citation for every rule); this module applies
 * it to the "Living Care" (major critical illness) and "Living Care Plus"
 * (early/intermediate critical illness) product sections instead of Group
 * Term Life/Group Personal Accident.
 *
 * Every rule this module returns carries the exact quote and page it was
 * read from. A benefit this module cannot find explicit wording for is
 * never guessed at -- the caller (lib/claims/ci-rules.ts) leaves it as
 * `needs_document` with no amount, exactly like an unresolved death-benefit
 * coverage does.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { canonicalProduct, productFromCategory, type OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimEvidence } from "./types";
import { canonicalInsurer } from "@/lib/policies/insurer-name";

export type CIFormula =
  | { kind: "fixed"; amount: number; currency: string }
  | { kind: "sum_insured_fraction"; fraction: number }
  | { kind: "stage_percentage"; stage: string; fraction: number };
export type CICap = { amount: number; currency: string } | null;
export type CIWaitingPeriodWording = { days: number; quote: string; page: number } | null;
export type CISurvivalPeriodWording = { days: number; quote: string; page: number } | null;

export type CIRuleEvidence = {
  coverageId: string;
  /** The calculator-facing benefit code this rule is for -- see
   * lib/claims/calculators/critical-illness.ts's CIInput.benefitCode and
   * lib/claims/calculators/evidence.ts's CIDefinitionMatch.benefitCode. */
  benefitCode: "ci-major" | "ci-early" | "ci-intermediate";
  /** The exact name this clause's own schedule uses for what it pays on --
   * what a CIDefinitionMatch must have been reviewed against. */
  illnessName: string;
  quote: string;
  formula: CIFormula;
  cap?: CICap;
  waitingPeriod?: CIWaitingPeriodWording;
  survivalPeriod?: CISurvivalPeriodWording;
  citation: ClaimEvidence;
};

export type CIEvidenceGapReasonCode = "GROUP_MISMATCH" | "AMBIGUOUS_EVIDENCE" | "DOCUMENT_FOUND_NO_CLAUSE" | "NO_MATCHING_DOCUMENT";
export type CIEvidenceGap = { coverageId: string; reason: string; nextStep: string; reasonCode?: CIEvidenceGapReasonCode };

export type CIWordingPage = {
  policy_id: string; page_number: number; text: string; group_policy_number: string | null;
  insurer: string | null; product_name: string | null; original_filename: string;
  document_role: string | null; personal_coverage_confirmed: boolean; linked_to_member: boolean;
};
type Page = { page_number: number; text: string };

const HEADINGS = /\b((?:Group\s+)?Living\s+Care\s+Plus|(?:Group\s+)?Living\s+Care)\b/gi;
const REFERENCE_ROLES = new Set(["policy_wording", "product_summary", "benefit_guide", "benefit_summary", "rider"]);

export const canonicalCIInsurer = canonicalInsurer;
function groupNumber(value: string | null | undefined) { return value?.replace(/\s+/g, "").toUpperCase() || null; }
function documentGroup(pages: CIWordingPage[]) {
  if (pages[0].group_policy_number) return groupNumber(pages[0].group_policy_number);
  const numbers = new Set(pages.flatMap(p => [...p.text.matchAll(/\bgroup\s+policy\s+(?:no\.?|number)\s*[:#.-]?\s*([A-Z0-9-]{4,})/gi)].map(m => groupNumber(m[1]))));
  return numbers.size === 1 ? [...numbers][0] : null;
}
function documentInsurer(pages: CIWordingPage[]) {
  if (pages[0].insurer) return canonicalCIInsurer(pages[0].insurer);
  return pages.some(p => /\bSingapore\s+Life\s+(?:Ltd|Limited)\b/i.test(p.text)) ? "singlife" : null;
}

const DISCRETIONARY_LANGUAGE = /\b(?:may\s+pay|up\s+to|at\s+(?:our|the\s+company'?s|the\s+insurer'?s)\s+discretion|discretionary|subject\s+to\s+underwriting)\b/i;
const MONEY_PATTERN = /(?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*([\d,]+(?:\.\d+)?)/i;
function explicitCICurrency(text: string) {
  if (/\bUS\$|USD\b/i.test(text)) return "USD";
  if (/\bS\$|SGD\b/i.test(text)) return "SGD";
  if (/\bMYR\b/i.test(text)) return "MYR";
  if (/\bEUR|€/i.test(text)) return "EUR";
  if (/\bGBP|£/i.test(text)) return "GBP";
  return "SGD";
}
function findCICap(segment: string, from: number, to: number): CICap {
  const window = segment.slice(from, Math.min(segment.length, to));
  const cap = window.match(/\b(?:subject\s+to\s+a\s+maximum\s+of|capped\s+at|not\s+exceeding|maximum\s+(?:benefit|payout)\s+of)\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)/i);
  if (!cap) return null;
  const money = cap[1].match(MONEY_PATTERN);
  if (!money) return null;
  const amount = Number(money[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: explicitCICurrency(cap[1]) };
}
function findWaitingPeriod(segment: string, pageAt: (offset: number) => number, baseOffset: number): CIWaitingPeriodWording {
  const match = segment.match(/\b(?:waiting\s+period\s+of|shall\s+not\s+be\s+payable\s+(?:for\s+any\s+diagnosis\s+made\s+)?within|not\s+payable\s+(?:for\s+any\s+diagnosis\s+made\s+)?within)\s+(\d{1,3})\s*(?:calendar\s+)?days?\b/i);
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days <= 0) return null;
  return { days, quote: match[0].trim(), page: pageAt(baseOffset + match.index!) };
}
function findSurvivalPeriod(segment: string, pageAt: (offset: number) => number, baseOffset: number): CISurvivalPeriodWording {
  const match = segment.match(/\bsurvive\s+(?:for\s+)?(?:a\s+period\s+of\s+)?(\d{1,3})\s*(?:calendar\s+)?days?\b/i);
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days <= 0) return null;
  return { days, quote: match[0].trim(), page: pageAt(baseOffset + match.index!) };
}

/** Reads every critical-illness benefit clause out of one policy's own
 * wording pages. Returns an entry per benefit row actually found -- never a
 * guess for a row the wording does not state. */
export function findCIRules(pages: Page[]): { page: number; pageEnd: number; benefitCode: CIRuleEvidence["benefitCode"]; illnessName: string; quote: string; formula: CIFormula; cap?: CICap; waitingPeriod?: CIWaitingPeriodWording; survivalPeriod?: CISurvivalPeriodWording }[] {
  let joined = "";
  const offsets: { start: number; page: number }[] = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    offsets.push({ start: joined.length, page: page.page_number }); joined += `${page.text}\n`;
  }
  const pageAt = (position: number) => offsets.filter(p => p.start <= position).at(-1)?.page ?? 1;
  const headings = [...joined.matchAll(HEADINGS)];
  const results: ReturnType<typeof findCIRules> = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const isPlus = /plus/i.test(heading[0]);
    const start = heading.index! + heading[0].length;
    const segment = joined.slice(start, headings[i + 1]?.index ?? joined.length);

    if (!isPlus) {
      // "Living Care": the major critical-illness benefit. A single row,
      // typically 100% of Sum Insured on diagnosis of a (Major) Critical
      // Illness named in the schedule.
      const majorPattern = /\b(?:Major\s+)?Critical\s+Illness(?:\s+Benefit)?\b/gi;
      for (const major of segment.matchAll(majorPattern)) {
        const tail = segment.slice(major.index! + major[0].length, major.index! + major[0].length + 260);
        const percentage = tail.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:the\s+)?)?(?:Sum\s+Insured|Sum\s+Assured)\b/i);
        if (!percentage) continue;
        const intervening = tail.slice(0, percentage.index);
        if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
        const fraction = Number(percentage[1]) / 100;
        if (!Number.isFinite(fraction) || fraction <= 0) continue;
        const end = percentage.index! + percentage[0].length;
        const absolute = start + major.index!;
        const quote = `${major[0]}${tail.slice(0, end)}`.trim();
        const cap = findCICap(tail, end, end + 260);
        const waitingPeriod = findWaitingPeriod(segment, pageAt, start);
        const survivalPeriod = findSurvivalPeriod(segment, pageAt, start);
        results.push({
          page: pageAt(absolute), pageEnd: pageAt(absolute + quote.length - 1), benefitCode: "ci-major",
          illnessName: "Major Critical Illness", quote, formula: { kind: "sum_insured_fraction", fraction },
          ...(cap ? { cap } : {}), ...(waitingPeriod ? { waitingPeriod } : {}), ...(survivalPeriod ? { survivalPeriod } : {}),
        });
        break; // one row for the major benefit is enough evidence for this clause
      }
      continue;
    }

    // "Living Care Plus": one row per named stage ("Early Stage", "Intermediate
    // Stage"), each with its own percentage. Never assumes a stage exists
    // just because the heading does -- only a stage the wording actually
    // names, with its own quoted percentage, becomes a rule.
    const stagePattern = /\b(Early|Intermediate)\s+Stage(?:\s+Critical\s+Illness)?(?:\s+Benefit)?\b/gi;
    for (const stageMatch of segment.matchAll(stagePattern)) {
      const stageWord = stageMatch[1];
      const tail = segment.slice(stageMatch.index! + stageMatch[0].length, stageMatch.index! + stageMatch[0].length + 260);
      const percentage = tail.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:the\s+)?)?(?:Sum\s+Insured|Sum\s+Assured)\b/i);
      const fixedAmount = tail.match(/\ba\s+fixed\s+benefit\s+of\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)\s+(?:will\s+be\s+paid|is\s+payable)\b/i);
      let formula: CIFormula | null = null;
      let end = 0;
      if (percentage) {
        const intervening = tail.slice(0, percentage.index);
        if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
        const fraction = Number(percentage[1]) / 100;
        if (!Number.isFinite(fraction) || fraction <= 0) continue;
        end = percentage.index! + percentage[0].length;
        formula = { kind: "stage_percentage", stage: `${stageWord} Stage`, fraction };
      } else if (fixedAmount) {
        const intervening = tail.slice(0, fixedAmount.index);
        if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
        const money = fixedAmount[1].match(MONEY_PATTERN);
        const amount = money ? Number(money[1].replace(/,/g, "")) : NaN;
        if (!Number.isFinite(amount) || amount <= 0) continue;
        end = fixedAmount.index! + fixedAmount[0].length;
        formula = { kind: "fixed", amount, currency: explicitCICurrency(fixedAmount[1]) };
      } else continue;
      const absolute = start + stageMatch.index!;
      const quote = `${stageMatch[0]}${tail.slice(0, end)}`.trim();
      const cap = findCICap(tail, end, end + 260);
      const waitingPeriod = findWaitingPeriod(segment, pageAt, start);
      const survivalPeriod = findSurvivalPeriod(segment, pageAt, start);
      results.push({
        page: pageAt(absolute), pageEnd: pageAt(absolute + quote.length - 1),
        benefitCode: stageWord.toLowerCase() === "early" ? "ci-early" : "ci-intermediate",
        illnessName: `${stageWord} Stage Critical Illness`, quote, formula,
        ...(cap ? { cap } : {}), ...(waitingPeriod ? { waitingPeriod } : {}), ...(survivalPeriod ? { survivalPeriod } : {}),
      });
    }
  }
  return results;
}

/** Rows are scoped to one account, using the exact same fail-closed,
 * tiered evidence-document precedence as lib/claims/death-evidence.ts's
 * resolveDeathEvidence() -- see that function's doc comment for the full
 * rationale; it is not repeated here. */
export function resolveCIEvidence(coverages: OwnedCoverage[], rows: CIWordingPage[]) {
  const documents = new Map<string, CIWordingPage[]>();
  for (const row of rows) documents.set(row.policy_id, [...(documents.get(row.policy_id) ?? []), row]);
  const allDocuments = [...documents.values()];
  const rules: CIRuleEvidence[] = [];
  const gaps: CIEvidenceGap[] = [];

  for (const coverage of coverages) {
    const product = canonicalProduct(coverage.productName) || productFromCategory(coverage.category);
    if (!["living care", "living care plus"].includes(product)) continue;
    const insurer = canonicalCIInsurer(coverage.insurer);
    const wantedGroup = groupNumber(coverage.groupPolicyNumber);
    const sameGroupAndInsurer = (pages: CIWordingPage[]) => {
      const sameInsurer = insurer != null && insurer === documentInsurer(pages);
      // A cover with no group number (an individual policy) is matched only to its own document, never to another
      // document that also prints no group number.
      const sameGroup = wantedGroup != null && documentGroup(pages) === wantedGroup;
      return sameGroup && sameInsurer;
    };

    const ownDocument = allDocuments.filter((pages) => pages[0].policy_id === coverage.policyId);
    const linkedDocuments = allDocuments.filter((pages) => pages[0].policy_id !== coverage.policyId && pages[0].linked_to_member === true && sameGroupAndInsurer(pages));
    const referenceDocuments = allDocuments.filter((pages) => {
      const first = pages[0];
      return first.policy_id !== coverage.policyId && first.linked_to_member !== true
        && first.personal_coverage_confirmed === false && REFERENCE_ROLES.has(first.document_role ?? "")
        && sameGroupAndInsurer(pages);
    });

    const tiers: { name: string; documents: CIWordingPage[][] }[] = [
      { name: "own", documents: ownDocument },
      { name: "linked", documents: linkedDocuments },
      { name: "reference", documents: referenceDocuments },
    ];

    let resolved = false;
    let anyDocumentSeen = false;
    for (const tier of tiers) {
      if (tier.documents.length === 0) continue;
      anyDocumentSeen = true;
      if (tier.documents.length > 1) {
        gaps.push({
          coverageId: coverage.id, reasonCode: "AMBIGUOUS_EVIDENCE",
          reason: `${tier.documents.length} equally valid policy documents match this cover's insurer and group at the same evidence tier ("${tier.name}"), so DearPolicy cannot deterministically pick one for the critical-illness wording. It never guesses based on insurer, group number or wording similarity alone.`,
          nextStep: "Remove the duplicate/extra document, or explicitly confirm which document is this person's own policy wording.",
        });
        resolved = true;
        break;
      }
      const pages = tier.documents[0];
      const first = pages[0];
      const found = findCIRules(pages).filter((rule) =>
        (product === "living care" && rule.benefitCode === "ci-major") ||
        (product === "living care plus" && rule.benefitCode !== "ci-major"));
      if (!found.length) continue;
      for (const rule of found) {
        rules.push({
          coverageId: coverage.id, benefitCode: rule.benefitCode, illnessName: rule.illnessName, quote: rule.quote,
          formula: rule.formula, ...(rule.cap ? { cap: rule.cap } : {}),
          ...(rule.waitingPeriod ? { waitingPeriod: rule.waitingPeriod } : {}),
          ...(rule.survivalPeriod ? { survivalPeriod: rule.survivalPeriod } : {}),
          citation: {
            chunkId: `page:${first.policy_id}:${rule.page}`, policyId: first.policy_id, policyName: first.product_name ?? first.original_filename,
            insurer: first.insurer ?? undefined, pageStart: rule.page, pageEnd: rule.pageEnd, documentRole: first.document_role,
            personalEvidence: false, evidenceLabel: `${rule.illnessName} wording`,
          },
        });
      }
      resolved = true;
      break;
    }
    if (!resolved) gaps.push(anyDocumentSeen
      ? { coverageId: coverage.id, reasonCode: "DOCUMENT_FOUND_NO_CLAUSE", reason: "A matching policy document is uploaded, but I could not verify its critical-illness clause.", nextStep: "Check that the uploaded benefit summary or wording is readable and includes the Critical Illness section." }
      : { coverageId: coverage.id, reasonCode: "NO_MATCHING_DOCUMENT", reason: "I could not find uploaded critical-illness wording that matches this cover's insurer and group.", nextStep: "Add the matching policy wording or benefit summary if it is missing; keep documents that are already uploaded." });
  }
  return { rules, gaps };
}

export async function loadCIEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  const result = await query<CIWordingPage>(`SELECT p.id AS policy_id, pp.page_number, pp.text, p.group_policy_number,
             p.insurer, p.product_name, p.original_filename, p.document_role, p.personal_coverage_confirmed,
             EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2) AS linked_to_member
        FROM policies p JOIN policy_pages pp ON pp.policy_id=p.id AND pp.account_id=p.account_id
       WHERE p.account_id=$1 AND p.processing_status='ready' AND ${activePredicate("p")}
         AND (EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2)
              OR (p.personal_coverage_confirmed=false AND p.document_role IN ('policy_wording','product_summary','benefit_guide','benefit_summary','rider')))
       ORDER BY p.document_authority DESC, p.created_at DESC, p.id, pp.page_number
       LIMIT 1000`, [accountId, familyMemberId]);
  return { ...resolveCIEvidence(coverages, result.rows), pages: result.rows };
}

export async function loadCIRuleEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  return (await loadCIEvidence(accountId, familyMemberId, coverages)).rules;
}

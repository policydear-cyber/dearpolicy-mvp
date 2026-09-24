/**
 * Reads a disability benefit's own definition and payout wording directly
 * from uploaded policy text -- the disability analogue of
 * lib/claims/ci-evidence.ts. See that module's doc comment for the general
 * approach (deterministic regex reading of quoted wording, never a model,
 * with an exact page citation for every rule); this module applies it to
 * three distinct benefit rows under the "Group Personal Accident" and
 * "Disability Income" product sections:
 *
 *  - "tpd-lump-sum": the Total & Permanent Disability lump sum (a
 *    percentage/multiple of Sum Insured, or a fixed amount).
 *  - "ppd-schedule": ONE ROW PER EXACT schedule-of-injuries entry the
 *    wording itself states (e.g. "Loss of one limb -- 100%"). Never a
 *    single generic "schedule" rule -- each named injury/loss gets its own
 *    exact, independently-citable row and its own stable `scheduleRowCode`,
 *    because lib/claims/calculators/disability-benefit.ts strictly matches
 *    on that exact code and never fuzzily compares an injury description
 *    against this table.
 *  - "di-monthly": a disability-income monthly cash benefit, read only when
 *    the wording states a flat monthly amount (V1 limitation: a
 *    percentage-of-declared-income formula is not read here -- see this
 *    module's own findDisabilityRules() doc comment).
 *
 * A benefit this module cannot find explicit wording for is never guessed
 * at -- the caller (lib/claims/disability-rules.ts) leaves it as
 * `needs_document` with no amount, exactly like an unresolved death-benefit
 * or CI coverage does.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { canonicalProduct, productFromCategory, type OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimEvidence } from "./types";
import { TOTAL_PERMANENT_DISABILITY_MATCH_KEY } from "./calculators/disability-benefit";
import { DISABILITY_INCOME_MATCH_KEY } from "./calculators/disability-income";

export type DisabilityFormula =
  | { kind: "fixed"; amount: number; currency: string }
  | { kind: "sum_insured_fraction"; fraction: number }
  | { kind: "schedule_percentage"; scheduleRowCode: string; fraction: number };
export type DisabilityCap = { amount: number; currency: string } | null;
export type DisabilityWaitingPeriodWording = { days: number; quote: string; page: number } | null;

export type DisabilityBenefitCode = "tpd-lump-sum" | "ppd-schedule" | "di-monthly";

export type DisabilityRuleEvidence = {
  coverageId: string;
  benefitCode: DisabilityBenefitCode;
  /** What this rule's own wording must be matched against -- see
   * lib/claims/calculators/evidence.ts's DisabilityDefinitionMatch doc
   * comment. The fixed sentinel for tpd-lump-sum/di-monthly; the exact,
   * stable schedule-row code for ppd-schedule. */
  matchKey: string;
  /** Human-readable label for the row (e.g. "Total & Permanent Disability",
   * "Loss of one limb", "Disability Income"). */
  label: string;
  quote: string;
  formula: DisabilityFormula;
  cap?: DisabilityCap;
  waitingPeriod?: DisabilityWaitingPeriodWording;
  /** di-monthly only: the deferred/elimination period in whole months, and
   * the maximum benefit period in whole months, when the wording states
   * them. Absent for tpd-lump-sum/ppd-schedule. */
  deferredPeriodMonths?: number | null;
  maximumBenefitMonths?: number | null;
  citation: ClaimEvidence;
};

export type DisabilityEvidenceGapReasonCode = "GROUP_MISMATCH" | "AMBIGUOUS_EVIDENCE" | "DOCUMENT_FOUND_NO_CLAUSE" | "NO_MATCHING_DOCUMENT";
export type DisabilityEvidenceGap = { coverageId: string; reason: string; nextStep: string; reasonCode?: DisabilityEvidenceGapReasonCode };

export type DisabilityWordingPage = {
  policy_id: string; page_number: number; text: string; group_policy_number: string | null;
  insurer: string | null; product_name: string | null; original_filename: string;
  document_role: string | null; personal_coverage_confirmed: boolean; linked_to_member: boolean;
};
type Page = { page_number: number; text: string };

const TPD_HEADING = /\bTotal\s+(?:and|&)\s+Permanent\s+Disab(?:lement|ility)\b/gi;
const SCHEDULE_HEADING = /\b(?:Schedule\s+of\s+Compensation|Scale\s+of\s+Benefits|Table\s+of\s+Compensation|Compensation\s+Table)\b/gi;
const DISABILITY_INCOME_HEADING = /\bDisability\s+Income(?:\s+Benefit)?\b/gi;
const REFERENCE_ROLES = new Set(["policy_wording", "product_summary", "benefit_guide", "benefit_summary", "rider"]);

function groupNumber(value: string | null | undefined) { return value?.replace(/\s+/g, "").toUpperCase() || null; }
function documentGroup(pages: DisabilityWordingPage[]) {
  if (pages[0].group_policy_number) return groupNumber(pages[0].group_policy_number);
  const numbers = new Set(pages.flatMap(p => [...p.text.matchAll(/\bgroup\s+policy\s+(?:no\.?|number)\s*[:#.-]?\s*([A-Z0-9-]{4,})/gi)].map(m => groupNumber(m[1]))));
  return numbers.size === 1 ? [...numbers][0] : null;
}
function documentInsurer(pages: DisabilityWordingPage[]) { return pages[0].insurer ? pages[0].insurer.toLowerCase().replace(/[^a-z0-9]+/g, "") : null; }

const DISCRETIONARY_LANGUAGE = /\b(?:may\s+pay|up\s+to|at\s+(?:our|the\s+company'?s|the\s+insurer'?s)\s+discretion|discretionary|subject\s+to\s+underwriting)\b/i;
const MONEY_PATTERN = /(?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*([\d,]+(?:\.\d+)?)/i;
function explicitCurrency(text: string) {
  if (/\bUS\$|USD\b/i.test(text)) return "USD";
  if (/\bS\$|SGD\b/i.test(text)) return "SGD";
  if (/\bMYR\b/i.test(text)) return "MYR";
  if (/\bEUR|€/i.test(text)) return "EUR";
  if (/\bGBP|£/i.test(text)) return "GBP";
  return "SGD";
}
function findCap(segment: string, from: number, to: number): DisabilityCap {
  const window = segment.slice(from, Math.min(segment.length, to));
  const cap = window.match(/\b(?:subject\s+to\s+a\s+maximum\s+of|capped\s+at|not\s+exceeding|maximum\s+(?:benefit|payout)\s+of)\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)/i);
  if (!cap) return null;
  const money = cap[1].match(MONEY_PATTERN);
  if (!money) return null;
  const amount = Number(money[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: explicitCurrency(cap[1]) };
}
function findWaitingPeriod(segment: string, pageAt: (offset: number) => number, baseOffset: number): DisabilityWaitingPeriodWording {
  const match = segment.match(/\b(?:waiting\s+period\s+of|shall\s+not\s+be\s+payable\s+within|not\s+payable\s+within)\s+(\d{1,3})\s*(?:calendar\s+)?days?\b/i);
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days <= 0) return null;
  return { days, quote: match[0].trim(), page: pageAt(baseOffset + match.index!) };
}
function findDeferredPeriodMonths(segment: string): number | null {
  const monthsMatch = segment.match(/\b(?:deferred|elimination)\s+period\s+of\s+(\d{1,3})\s*months?\b/i);
  if (monthsMatch) { const n = Number(monthsMatch[1]); return Number.isFinite(n) && n >= 0 ? n : null; }
  const daysMatch = segment.match(/\b(?:deferred|elimination)\s+period\s+of\s+(\d{1,4})\s*days?\b/i);
  if (daysMatch) { const n = Number(daysMatch[1]); return Number.isFinite(n) && n >= 0 ? Math.round(n / 30) : null; }
  return null;
}
function findMaximumBenefitMonths(segment: string): number | null {
  const monthsMatch = segment.match(/\bpayable\s+for\s+(?:up\s+to\s+)?(\d{1,3})\s*months?\b/i) ?? segment.match(/\bmaximum\s+benefit\s+period\s+of\s+(\d{1,3})\s*months?\b/i);
  if (monthsMatch) { const n = Number(monthsMatch[1]); return Number.isFinite(n) && n > 0 ? n : null; }
  const yearsMatch = segment.match(/\bpayable\s+for\s+(?:up\s+to\s+)?(\d{1,2})\s*years?\b/i);
  if (yearsMatch) { const n = Number(yearsMatch[1]); return Number.isFinite(n) && n > 0 ? n * 12 : null; }
  return null;
}
/** Stable, deterministic schedule-row code -- a slug of the row's own
 * quoted description, never a number the model or DearPolicy invents. Two
 * different quoted descriptions always produce different codes; the exact
 * same quoted description always produces the exact same code, which is
 * what lets a re-read of unchanged wording keep matching a prior review. */
function scheduleRowCode(description: string): string {
  return description.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

/** Reads the Total & Permanent Disability lump-sum clause out of one
 * policy's own Group Personal Accident wording pages. Returns at most one
 * row -- never a guess when the wording does not state a clear
 * percentage/amount. */
function findTPDRule(joined: string, pageAt: (offset: number) => number): { page: number; pageEnd: number; benefitCode: "tpd-lump-sum"; matchKey: string; label: string; quote: string; formula: DisabilityFormula; cap?: DisabilityCap; waitingPeriod?: DisabilityWaitingPeriodWording } | null {
  for (const heading of joined.matchAll(TPD_HEADING)) {
    const start = heading.index! + heading[0].length;
    const tail = joined.slice(start, start + 260);
    const percentage = tail.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:the\s+)?)?(?:Sum\s+Insured|Sum\s+Assured)\b/i);
    const fixedAmount = tail.match(/\ba\s+fixed\s+benefit\s+of\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)\s+(?:will\s+be\s+paid|is\s+payable)\b/i);
    let formula: DisabilityFormula | null = null;
    let end = 0;
    if (percentage) {
      const intervening = tail.slice(0, percentage.index);
      if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
      const fraction = Number(percentage[1]) / 100;
      if (!Number.isFinite(fraction) || fraction <= 0) continue;
      end = percentage.index! + percentage[0].length;
      formula = { kind: "sum_insured_fraction", fraction };
    } else if (fixedAmount) {
      const intervening = tail.slice(0, fixedAmount.index);
      if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
      const money = fixedAmount[1].match(MONEY_PATTERN);
      const amount = money ? Number(money[1].replace(/,/g, "")) : NaN;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      end = fixedAmount.index! + fixedAmount[0].length;
      formula = { kind: "fixed", amount, currency: explicitCurrency(fixedAmount[1]) };
    } else continue;
    const quote = `${heading[0]}${tail.slice(0, end)}`.trim();
    const cap = findCap(tail, end, end + 260);
    const waitingPeriod = findWaitingPeriod(joined.slice(Math.max(0, heading.index! - 200), start + 400), pageAt, Math.max(0, heading.index! - 200));
    return {
      page: pageAt(heading.index!), pageEnd: pageAt(heading.index! + quote.length - 1),
      benefitCode: "tpd-lump-sum", matchKey: TOTAL_PERMANENT_DISABILITY_MATCH_KEY, label: "Total & Permanent Disability",
      quote, formula, ...(cap ? { cap } : {}), ...(waitingPeriod ? { waitingPeriod } : {}),
    };
  }
  return null;
}

/** Reads every named row of a policy's own schedule of injuries -- lines
 * of the form "<description> -- NN%" inside a section introduced by a
 * recognised schedule heading. One result per row actually quoted; never a
 * single catch-all "schedule" rule. */
function findScheduleRows(joined: string, pageAt: (offset: number) => number): { page: number; pageEnd: number; benefitCode: "ppd-schedule"; matchKey: string; label: string; quote: string; formula: DisabilityFormula }[] {
  const results: ReturnType<typeof findScheduleRows> = [];
  const headings = [...joined.matchAll(SCHEDULE_HEADING)];
  const ROW_PATTERN = /^[ \t]*([A-Za-z][^\n%]{4,120}?)[ \t]*[-–—:][ \t]*(\d{1,3}(?:\.\d+)?)[ \t]*%[ \t]*$/gm;
  for (const heading of headings) {
    const start = heading.index! + heading[0].length;
    const segment = joined.slice(start, start + 6000);
    for (const row of segment.matchAll(ROW_PATTERN)) {
      const description = row[1].trim().replace(/\s+/g, " ");
      const fraction = Number(row[2]) / 100;
      if (!description || !Number.isFinite(fraction) || fraction <= 0 || fraction > 1) continue;
      const code = scheduleRowCode(description);
      if (!code || results.some((r) => r.matchKey === code)) continue;
      const absolute = start + row.index!;
      results.push({
        page: pageAt(absolute), pageEnd: pageAt(absolute + row[0].length - 1),
        benefitCode: "ppd-schedule", matchKey: code, label: description,
        quote: row[0].trim(), formula: { kind: "schedule_percentage", scheduleRowCode: code, fraction },
      });
    }
  }
  return results;
}

/** Reads a flat monthly disability-income amount out of one policy's own
 * Disability Income wording. V1 limitation: only a stated flat monthly
 * amount is read here -- a percentage-of-declared-monthly-income formula
 * (common in some individual disability-income policies) is not, since
 * DearPolicy has no verified declared-income figure to apply it to yet.
 * That gap is documented in the PR, not hidden here. */
function findDisabilityIncomeRule(joined: string, pageAt: (offset: number) => number): { page: number; pageEnd: number; benefitCode: "di-monthly"; matchKey: string; label: string; quote: string; formula: DisabilityFormula; deferredPeriodMonths: number | null; maximumBenefitMonths: number | null } | null {
  for (const heading of joined.matchAll(DISABILITY_INCOME_HEADING)) {
    const start = heading.index! + heading[0].length;
    const tail = joined.slice(start, start + 300);
    const monthly = tail.match(/\ba\s+monthly\s+(?:cash\s+)?(?:benefit|income)\s+of\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)/i);
    if (!monthly) continue;
    const intervening = tail.slice(0, monthly.index);
    if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
    const money = monthly[1].match(MONEY_PATTERN);
    const amount = money ? Number(money[1].replace(/,/g, "")) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const end = monthly.index! + monthly[0].length;
    const quote = `${heading[0]}${tail.slice(0, end)}`.trim();
    const window = joined.slice(start, start + 800);
    const deferredPeriodMonths = findDeferredPeriodMonths(window);
    const maximumBenefitMonths = findMaximumBenefitMonths(window);
    return {
      page: pageAt(heading.index!), pageEnd: pageAt(heading.index! + quote.length - 1),
      benefitCode: "di-monthly", matchKey: DISABILITY_INCOME_MATCH_KEY, label: "Disability Income",
      quote, formula: { kind: "fixed", amount, currency: explicitCurrency(monthly[1]) },
      deferredPeriodMonths, maximumBenefitMonths,
    };
  }
  return null;
}

/** Reads every disability benefit clause out of one policy's own wording
 * pages -- TPD, every named schedule-of-injuries row, and a flat monthly
 * disability-income amount, each with its own exact page citation. */
export function findDisabilityRules(pages: Page[]): (
  | { page: number; pageEnd: number; benefitCode: "tpd-lump-sum"; matchKey: string; label: string; quote: string; formula: DisabilityFormula; cap?: DisabilityCap; waitingPeriod?: DisabilityWaitingPeriodWording }
  | { page: number; pageEnd: number; benefitCode: "ppd-schedule"; matchKey: string; label: string; quote: string; formula: DisabilityFormula }
  | { page: number; pageEnd: number; benefitCode: "di-monthly"; matchKey: string; label: string; quote: string; formula: DisabilityFormula; deferredPeriodMonths: number | null; maximumBenefitMonths: number | null }
)[] {
  let joined = "";
  const offsets: { start: number; page: number }[] = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    offsets.push({ start: joined.length, page: page.page_number }); joined += `${page.text}\n`;
  }
  const pageAt = (position: number) => offsets.filter(p => p.start <= position).at(-1)?.page ?? 1;

  const results: ReturnType<typeof findDisabilityRules> = [];
  const tpd = findTPDRule(joined, pageAt);
  if (tpd) results.push(tpd);
  results.push(...findScheduleRows(joined, pageAt));
  const income = findDisabilityIncomeRule(joined, pageAt);
  if (income) results.push(income);
  return results;
}

/** Rows are scoped to one account, using the exact same fail-closed,
 * tiered evidence-document precedence as lib/claims/ci-evidence.ts's
 * resolveCIEvidence() -- see that function's doc comment for the full
 * rationale; it is not repeated here. */
export function resolveDisabilityEvidence(coverages: OwnedCoverage[], rows: DisabilityWordingPage[]) {
  const documents = new Map<string, DisabilityWordingPage[]>();
  for (const row of rows) documents.set(row.policy_id, [...(documents.get(row.policy_id) ?? []), row]);
  const allDocuments = [...documents.values()];
  const rules: DisabilityRuleEvidence[] = [];
  const gaps: DisabilityEvidenceGap[] = [];

  for (const coverage of coverages) {
    const product = canonicalProduct(coverage.productName) || productFromCategory(coverage.category);
    if (!["group personal accident", "disability income"].includes(product)) continue;
    const wantedGroup = groupNumber(coverage.groupPolicyNumber);
    const insurer = coverage.insurer ? coverage.insurer.toLowerCase().replace(/[^a-z0-9]+/g, "") : null;
    const sameGroupAndInsurer = (pages: DisabilityWordingPage[]) => {
      const sameInsurer = insurer != null && insurer === documentInsurer(pages);
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

    const tiers: { name: string; documents: DisabilityWordingPage[][] }[] = [
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
          reason: `${tier.documents.length} equally valid policy documents match this cover's insurer and group at the same evidence tier ("${tier.name}"), so DearPolicy cannot deterministically pick one for the disability wording. It never guesses based on insurer, group number or wording similarity alone.`,
          nextStep: "Remove the duplicate/extra document, or explicitly confirm which document is this person's own policy wording.",
        });
        resolved = true;
        break;
      }
      const pages = tier.documents[0];
      const first = pages[0];
      const found = findDisabilityRules(pages).filter((rule) =>
        (product === "group personal accident" && (rule.benefitCode === "tpd-lump-sum" || rule.benefitCode === "ppd-schedule")) ||
        (product === "disability income" && rule.benefitCode === "di-monthly"));
      if (!found.length) continue;
      for (const rule of found) {
        rules.push({
          coverageId: coverage.id, benefitCode: rule.benefitCode, matchKey: rule.matchKey, label: rule.label, quote: rule.quote,
          formula: rule.formula, ...("cap" in rule && rule.cap ? { cap: rule.cap } : {}),
          ...("waitingPeriod" in rule && rule.waitingPeriod ? { waitingPeriod: rule.waitingPeriod } : {}),
          ...("deferredPeriodMonths" in rule ? { deferredPeriodMonths: rule.deferredPeriodMonths } : {}),
          ...("maximumBenefitMonths" in rule ? { maximumBenefitMonths: rule.maximumBenefitMonths } : {}),
          citation: {
            chunkId: `page:${first.policy_id}:${rule.page}`, policyId: first.policy_id, policyName: first.product_name ?? first.original_filename,
            insurer: first.insurer ?? undefined, pageStart: rule.page, pageEnd: rule.pageEnd, documentRole: first.document_role,
            personalEvidence: false, evidenceLabel: `${rule.label} wording`,
          },
        });
      }
      resolved = true;
      break;
    }
    if (!resolved) gaps.push(anyDocumentSeen
      ? { coverageId: coverage.id, reasonCode: "DOCUMENT_FOUND_NO_CLAUSE", reason: "A matching policy document is uploaded, but I could not verify its disability clause.", nextStep: "Check that the uploaded benefit summary or wording is readable and includes the disability section." }
      : { coverageId: coverage.id, reasonCode: "NO_MATCHING_DOCUMENT", reason: "I could not find uploaded disability wording that matches this cover's insurer and group.", nextStep: "Add the matching policy wording or benefit summary if it is missing; keep documents that are already uploaded." });
  }
  return { rules, gaps };
}

export async function loadDisabilityEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  const result = await query<DisabilityWordingPage>(`SELECT p.id AS policy_id, pp.page_number, pp.text, p.group_policy_number,
             p.insurer, p.product_name, p.original_filename, p.document_role, p.personal_coverage_confirmed,
             EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2) AS linked_to_member
        FROM policies p JOIN policy_pages pp ON pp.policy_id=p.id AND pp.account_id=p.account_id
       WHERE p.account_id=$1 AND p.processing_status='ready' AND ${activePredicate("p")}
         AND (EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2)
              OR (p.personal_coverage_confirmed=false AND p.document_role IN ('policy_wording','product_summary','benefit_guide','benefit_summary','rider')))
       ORDER BY p.document_authority DESC, p.created_at DESC, p.id, pp.page_number
       LIMIT 1000`, [accountId, familyMemberId]);
  return { ...resolveDisabilityEvidence(coverages, result.rows), pages: result.rows };
}

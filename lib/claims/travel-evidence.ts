/**
 * Reads a travel policy's own overseas-medical-expense and accidental-death
 * benefit wording directly from uploaded policy text -- the travel analogue
 * of lib/claims/death-evidence.ts and lib/claims/medical-evidence.ts. See
 * those modules' doc comments for the general approach (deterministic
 * regex reading of quoted wording, never a model, with an exact page
 * citation for every rule); this module applies it to a travel policy's
 * own wording.
 *
 * V1 SCOPE (documented in the PR, not hidden here): travel claims are
 * limited to health and death outcomes only. findTravelRules() below is
 * deliberately built so it can only ever match an overseas-medical-expense
 * or an accidental-death clause -- it never reads, and cannot match,
 * baggage, travel-delay, trip-cancellation or personal-effects wording,
 * even when a travel policy's own document also contains those sections.
 * Only two benefit codes exist: "travel-medical-expenses" and
 * "travel-accidental-death".
 *
 * Travel coverage rows are identified by `coverage.category === "Travel"`
 * (see lib/insurance.ts's COVERAGE_CATEGORIES) rather than by
 * canonicalProduct()/productFromCategory() (lib/coverage/facts.ts) --
 * neither of those maps any travel product, and Travel is deliberately not
 * folded into that domestic product taxonomy.
 *
 * Two further V1 limitations, both fail-closed (never a guess in the
 * unsafe direction), are worth stating plainly:
 *  - Overseas-medical-expense wording is only read when the clause
 *    explicitly lists which expense types it covers (see CATEGORY_LINE
 *    below, the same category vocabulary lib/claims/medical-evidence.ts
 *    uses for domestic reimbursement wording). A lump-sum-only clause with
 *    no stated category breakdown is left as needs_document -- exactly
 *    like an un-evidenced domestic reimbursement benefit -- rather than
 *    DearPolicy inventing a category list.
 *  - Accidental-death wording is only read as a FIXED benefit amount,
 *    never as a percentage/multiple of a "sum insured". A travel policy's
 *    coverage rows are not split into the domestic per-benefit taxonomy
 *    lib/coverage/facts.ts's productFromCategory() relies on, so there is
 *    no single unambiguous "sum insured" row to multiply a percentage
 *    against here. Real travel accidental-death benefits are near-
 *    universally quoted as a flat lump sum anyway, so this is a narrow gap
 *    in practice, but it is a real one and is never silently widened.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimEvidence } from "./types";

export type TravelBenefitCode = "travel-medical-expenses" | "travel-accidental-death";

export type TravelMedicalRule = {
  coverageId: string;
  benefitCode: "travel-medical-expenses";
  /** Evidenced expense categories this clause explicitly names -- see this
   * module's own doc comment. Never empty; findTravelMedicalRule() returns
   * no rule at all when no category is explicitly named. */
  eligibleCategories: string[];
  /** The clause's own overall cap ("up to $X"), when explicitly quoted.
   * null when the clause states no single overall ceiling. */
  overallCap: { amount: number; currency: string } | null;
  quote: string;
  citation: ClaimEvidence;
};

export type TravelDeathRule = {
  coverageId: string;
  benefitCode: "travel-accidental-death";
  amount: number;
  currency: string;
  quote: string;
  citation: ClaimEvidence;
};

export type TravelRuleEvidence = TravelMedicalRule | TravelDeathRule;

export type TravelEvidenceGapReasonCode = "AMBIGUOUS_EVIDENCE" | "DOCUMENT_FOUND_NO_CLAUSE" | "NO_MATCHING_DOCUMENT";
export type TravelEvidenceGap = { coverageId: string; reason: string; nextStep: string; reasonCode?: TravelEvidenceGapReasonCode };

export type TravelWordingPage = {
  policy_id: string; page_number: number; text: string; group_policy_number: string | null;
  insurer: string | null; product_name: string | null; original_filename: string;
  document_role: string | null; personal_coverage_confirmed: boolean; linked_to_member: boolean;
};
type Page = { page_number: number; text: string };

const REFERENCE_ROLES = new Set(["policy_wording", "product_summary", "benefit_guide", "benefit_summary", "rider"]);

function documentInsurer(pages: TravelWordingPage[]) {
  return pages[0].insurer ? pages[0].insurer.toLowerCase().replace(/[^a-z0-9]+/g, "") : null;
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

// These two headings are deliberately narrow. Neither can ever match a
// baggage, travel-delay, trip-cancellation or personal-effects heading --
// those clauses use their own distinct wording ("Baggage and Personal
// Effects", "Travel Delay", "Trip Cancellation/Curtailment", and similar),
// none of which this pattern recognises. See this module's own doc comment.
const TRAVEL_MEDICAL_HEADING = /\b(?:Overseas\s+Medical\s+Expenses?|Emergency\s+Medical\s+(?:Expenses?|Treatment)|Medical\s+Expenses?(?:\s+(?:Incurred\s+)?(?:Overseas|Abroad))?)\s*(?:Benefit)?\b/gi;
const TRAVEL_DEATH_HEADING = /\bAccidental\s+Death\s*(?:Benefit)?\b/gi;
const DISCRETIONARY_LANGUAGE = /\b(?:may\s+pay|at\s+(?:our|the\s+company'?s|the\s+insurer'?s)\s+discretion|discretionary|subject\s+to\s+underwriting)\b/i;
/** Same category vocabulary as lib/claims/medical-evidence.ts's
 * CATEGORY_LINE, extended with a few travel-specific terms ("ambulance",
 * "outpatient treatment", plain "consultation fees") that domestic
 * hospitalisation-rider wording does not use but travel wording commonly
 * does. Deliberately duplicated rather than imported -- see
 * lib/claims/disability-evidence.ts's own MONEY_PATTERN/DISCRETIONARY_LANGUAGE
 * for the same established pattern of small, per-module regex constants. */
const CATEGORY_LINE = /\b(surgical\s+fees|anaesthetist\s+fees|room\s+and\s+board|hospital\s+services|hospitalisation|specialist\s+fees|consultation\s+fees|diagnostic\s+(?:tests?|imaging)|medication|follow-?up\s+consultation|outpatient\s+treatment|ambulance(?:\s+(?:service|charges?|fees?))?)\b\s*[:\-]?\s*(?:up\s+to\s+)?((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)?/gi;

/** Reads the overseas-medical-expenses clause out of one travel policy's
 * own wording pages. Never guesses a category -- see this module's own doc
 * comment on the lump-sum-only limitation. */
function findTravelMedicalRule(joined: string, pageAt: (offset: number) => number): { page: number; pageEnd: number; benefitCode: "travel-medical-expenses"; eligibleCategories: string[]; overallCap: { amount: number; currency: string } | null; quote: string } | null {
  for (const heading of joined.matchAll(TRAVEL_MEDICAL_HEADING)) {
    const tail = joined.slice(heading.index! + heading[0].length, heading.index! + heading[0].length + 900);
    const stop = tail.search(/\n\s*\n/);
    const window = stop > 0 ? tail.slice(0, stop) : tail;
    const eligibleCategories: string[] = [];
    for (const m of window.matchAll(CATEGORY_LINE)) {
      const category = m[1].toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
      if (!eligibleCategories.includes(category)) eligibleCategories.push(category);
    }
    if (eligibleCategories.length === 0) continue; // no explicit category breakdown -- never guessed
    const capMatch = window.match(/\b(?:up\s+to|not\s+exceeding|maximum\s+(?:benefit|limit|amount)\s+of|subject\s+to\s+a\s+maximum\s+of)\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)/i);
    let overallCap: { amount: number; currency: string } | null = null;
    if (capMatch) {
      const amount = parseMoney(capMatch[1]);
      if (amount != null) overallCap = { amount, currency: explicitCurrency(capMatch[1]) };
    }
    const quote = `${heading[0]}${window}`.trim().slice(0, 500);
    return { page: pageAt(heading.index!), pageEnd: pageAt(heading.index! + quote.length - 1), benefitCode: "travel-medical-expenses", eligibleCategories, overallCap, quote };
  }
  return null;
}

/** Reads the accidental-death clause out of one travel policy's own
 * wording pages -- a FIXED amount only, never a percentage/multiple of a
 * "sum insured". See this module's own doc comment for why. */
function findTravelDeathRule(joined: string, pageAt: (offset: number) => number): { page: number; pageEnd: number; benefitCode: "travel-accidental-death"; amount: number; currency: string; quote: string } | null {
  for (const heading of joined.matchAll(TRAVEL_DEATH_HEADING)) {
    const tail = joined.slice(heading.index! + heading[0].length, heading.index! + heading[0].length + 260);
    const fixed = tail.match(/\b(?:we\s+will\s+pay|pays?|a\s+(?:fixed\s+)?(?:lump\s+sum\s+)?benefit\s+of)\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)/i);
    if (!fixed) continue;
    const intervening = tail.slice(0, fixed.index);
    if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
    const amount = parseMoney(fixed[1]);
    if (amount == null) continue;
    const end = fixed.index! + fixed[0].length;
    const quote = `${heading[0]}${tail.slice(0, end)}`.trim();
    return { page: pageAt(heading.index!), pageEnd: pageAt(heading.index! + quote.length - 1), benefitCode: "travel-accidental-death", amount, currency: explicitCurrency(fixed[1]), quote };
  }
  return null;
}

/** Reads both travel benefit clauses out of one travel policy's own
 * wording pages, each with its own exact page citation. Never returns a
 * baggage/delay/cancellation-derived result -- see this module's own doc
 * comment. */
export function findTravelRules(pages: Page[]): (
  | { page: number; pageEnd: number; benefitCode: "travel-medical-expenses"; eligibleCategories: string[]; overallCap: { amount: number; currency: string } | null; quote: string }
  | { page: number; pageEnd: number; benefitCode: "travel-accidental-death"; amount: number; currency: string; quote: string }
)[] {
  let joined = "";
  const offsets: { start: number; page: number }[] = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    offsets.push({ start: joined.length, page: page.page_number }); joined += `${page.text}\n`;
  }
  const pageAt = (position: number) => offsets.filter(p => p.start <= position).at(-1)?.page ?? 1;

  const results: ReturnType<typeof findTravelRules> = [];
  const medical = findTravelMedicalRule(joined, pageAt);
  if (medical) results.push(medical);
  const death = findTravelDeathRule(joined, pageAt);
  if (death) results.push(death);
  return results;
}

/** Rows are scoped to one account, using the same fail-closed, tiered
 * evidence-document precedence as lib/claims/death-evidence.ts's
 * resolveDeathEvidence()/lib/claims/disability-evidence.ts's
 * resolveDisabilityEvidence() -- see those functions' own doc comments for
 * the full rationale; it is not repeated here. The one structural
 * difference: travel policies are individual (not employer-group) cover,
 * so there is no group-policy-number check here -- tiers match on insurer
 * only.
 *
 * A single travel policy can have more than one `OwnedCoverage` row under
 * the SAME `category: "Travel"` (there is no per-benefit travel category
 * the way lib/coverage/facts.ts's productFromCategory() splits domestic
 * GTL/GPA into "Death"/"Personal Accident"/etc.), so this resolves per
 * DISTINCT POLICY rather than per coverage row -- picking one
 * representative coverage per policyId -- and attaches both benefit rules
 * (when both are found) to that one coverage. This avoids ever duplicating
 * the same benefit across sibling coverage rows of the same travel policy. */
export function resolveTravelEvidence(coverages: OwnedCoverage[], rows: TravelWordingPage[]) {
  const travelCoverages = coverages.filter((c) => c.category === "Travel");
  const byPolicy = new Map<string, OwnedCoverage>();
  for (const c of travelCoverages) if (!byPolicy.has(c.policyId)) byPolicy.set(c.policyId, c);

  const documents = new Map<string, TravelWordingPage[]>();
  for (const row of rows) documents.set(row.policy_id, [...(documents.get(row.policy_id) ?? []), row]);
  const allDocuments = [...documents.values()];
  const rules: TravelRuleEvidence[] = [];
  const gaps: TravelEvidenceGap[] = [];

  for (const coverage of byPolicy.values()) {
    const insurer = coverage.insurer ? coverage.insurer.toLowerCase().replace(/[^a-z0-9]+/g, "") : null;
    const sameInsurer = (pages: TravelWordingPage[]) => insurer != null && insurer === documentInsurer(pages);

    const ownDocument = allDocuments.filter((pages) => pages[0].policy_id === coverage.policyId);
    const linkedDocuments = allDocuments.filter((pages) => pages[0].policy_id !== coverage.policyId && pages[0].linked_to_member === true && sameInsurer(pages));
    const referenceDocuments = allDocuments.filter((pages) => {
      const first = pages[0];
      return first.policy_id !== coverage.policyId && first.linked_to_member !== true
        && first.personal_coverage_confirmed === false && REFERENCE_ROLES.has(first.document_role ?? "")
        && sameInsurer(pages);
    });

    const tiers: { name: string; documents: TravelWordingPage[][] }[] = [
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
          reason: `${tier.documents.length} equally valid policy documents match this travel cover's insurer at the same evidence tier ("${tier.name}"), so DearPolicy cannot deterministically pick one for the travel wording. It never guesses based on insurer or wording similarity alone.`,
          nextStep: "Remove the duplicate/extra document, or explicitly confirm which document is this person's own travel policy wording.",
        });
        resolved = true;
        break;
      }
      const pages = tier.documents[0];
      const first = pages[0];
      const found = findTravelRules(pages);
      if (!found.length) continue;
      for (const rule of found) {
        const citation: ClaimEvidence = {
          chunkId: `page:${first.policy_id}:${rule.page}`, policyId: first.policy_id, policyName: first.product_name ?? first.original_filename,
          insurer: first.insurer ?? undefined, pageStart: rule.page, pageEnd: rule.pageEnd, documentRole: first.document_role,
          personalEvidence: false, evidenceLabel: rule.benefitCode === "travel-medical-expenses" ? "Overseas medical expenses wording" : "Accidental death wording",
        };
        if (rule.benefitCode === "travel-medical-expenses") {
          rules.push({ coverageId: coverage.id, benefitCode: "travel-medical-expenses", eligibleCategories: rule.eligibleCategories, overallCap: rule.overallCap, quote: rule.quote, citation });
        } else {
          rules.push({ coverageId: coverage.id, benefitCode: "travel-accidental-death", amount: rule.amount, currency: rule.currency, quote: rule.quote, citation });
        }
      }
      resolved = true;
      break;
    }
    if (!resolved) gaps.push(anyDocumentSeen
      ? { coverageId: coverage.id, reasonCode: "DOCUMENT_FOUND_NO_CLAUSE", reason: "A matching travel policy document is uploaded, but I could not verify its overseas medical-expense or accidental-death clause.", nextStep: "Check that the uploaded travel policy wording is readable and includes those sections." }
      : { coverageId: coverage.id, reasonCode: "NO_MATCHING_DOCUMENT", reason: "I could not find uploaded travel policy wording that matches this cover's insurer.", nextStep: "Add the matching travel policy wording if it is missing; keep documents that are already uploaded." });
  }
  return { rules, gaps };
}

export async function loadTravelEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  const result = await query<TravelWordingPage>(`SELECT p.id AS policy_id, pp.page_number, pp.text, p.group_policy_number,
             p.insurer, p.product_name, p.original_filename, p.document_role, p.personal_coverage_confirmed,
             EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2) AS linked_to_member
        FROM policies p JOIN policy_pages pp ON pp.policy_id=p.id AND pp.account_id=p.account_id
       WHERE p.account_id=$1 AND p.processing_status='ready' AND ${activePredicate("p")}
         AND (EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2)
              OR (p.personal_coverage_confirmed=false AND p.document_role IN ('policy_wording','product_summary','benefit_guide','benefit_summary','rider')))
       ORDER BY p.document_authority DESC, p.created_at DESC, p.id, pp.page_number
       LIMIT 1000`, [accountId, familyMemberId]);
  return { ...resolveTravelEvidence(coverages, result.rows), pages: result.rows };
}

import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { canonicalProduct, productFromCategory, type OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimEvidence } from "./types";
import { canonicalInsurer } from "@/lib/policies/insurer-name";

export type RacingExclusion = { quote: string; page: number; authorityException?: boolean };
/** A death-benefit payout formula read directly from the quoted wording.
 * `sum_insured_fraction` covers both a percentage (fraction 0-1) and a
 * multiple (fraction > 1) of the Sum Insured -- the same arithmetic either
 * way. `fixed` is a flat additional benefit independent of the Sum Insured. */
export type DeathFormula =
  | { kind: "sum_insured_fraction"; fraction: number }
  | { kind: "fixed"; amount: number; currency: string };
/** An explicitly evidenced ceiling quoted in the same clause. */
export type DeathCap = { amount: number; currency: string } | null;
export type DeathRuleEvidence = { coverageId: string; benefit: "gtl-death" | "gpa-accidental-death"; quote: string; citation: ClaimEvidence; racingExclusion?: RacingExclusion; formula: DeathFormula; cap?: DeathCap };
/** `reasonCode` is a stable, structured identifier for why a coverage has no
 * resolved rule -- used by downstream composition/UI logic that needs to
 * distinguish "genuinely ambiguous evidence" from "no document uploaded yet"
 * without parsing the human-readable `reason` string. Optional so any older
 * caller that only reads `reason`/`nextStep` keeps working unchanged. */
export type DeathEvidenceGapReasonCode = "GROUP_MISMATCH" | "AMBIGUOUS_EVIDENCE" | "DOCUMENT_FOUND_NO_CLAUSE" | "NO_MATCHING_DOCUMENT";
export type DeathEvidenceGap = { coverageId: string; reason: string; nextStep: string; reasonCode?: DeathEvidenceGapReasonCode };
export type DeathWordingPage = {
  policy_id: string; page_number: number; text: string; group_policy_number: string | null;
  insurer: string | null; product_name: string | null; original_filename: string;
  document_role: string | null; personal_coverage_confirmed: boolean; linked_to_member: boolean;
};
type Page = { page_number: number; text: string };
const HEADINGS = /\b(?:Group\s+Term\s+Life|Group\s+Personal\s+Accident|(?:Group\s+)?Living\s+Care(?:\s+Plus)?|(?:Group\s+)?Disability\s+Income|(?:Group\s+)?Outpatient\s+Medicare)\b/gi;
const REFERENCE_ROLES = new Set(["policy_wording", "product_summary", "benefit_guide", "benefit_summary", "rider"]);

/** Explicit legal/brand names shown on the supplied PDFs. Aviva by itself
 * and unrelated insurers are not aliases. */
export const canonicalDeathInsurer = canonicalInsurer;

function groupNumber(value: string | null | undefined) { return value?.replace(/\s+/g, "").toUpperCase() || null; }
function documentGroup(pages: DeathWordingPage[]) {
  // Metadata wins over incidental mentions of another group.
  if (pages[0].group_policy_number) return groupNumber(pages[0].group_policy_number);
  const numbers = new Set(pages.flatMap(p => [...p.text.matchAll(/\bgroup\s+policy\s+(?:no\.?|number)\s*[:#.-]?\s*([A-Z0-9-]{4,})/gi)].map(m => groupNumber(m[1]))));
  return numbers.size === 1 ? [...numbers][0] : null;
}
function documentInsurer(pages: DeathWordingPage[]) {
  if (pages[0].insurer) return canonicalDeathInsurer(pages[0].insurer);
  return pages.some(p => /\bSingapore\s+Life\s+(?:Ltd|Limited)\b/i.test(p.text)) ? "singlife" : null;
}

/** Accept a 100% row or an explicit promise to pay the relevant Sum Insured.
 * A formula in another product's section never establishes this benefit. */
const DISCRETIONARY_LANGUAGE = /\b(?:may\s+pay|up\s+to|at\s+(?:our|the\s+company'?s|the\s+insurer'?s)\s+discretion|discretionary|subject\s+to\s+underwriting)\b/i;
const MONEY_PATTERN = /(?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*([\d,]+(?:\.\d+)?)/i;
function explicitDeathCurrency(text: string) {
  if (/\bUS\$|USD\b/i.test(text)) return "USD";
  if (/\bS\$|SGD\b/i.test(text)) return "SGD";
  if (/\bMYR\b/i.test(text)) return "MYR";
  if (/\bEUR|€/i.test(text)) return "EUR";
  if (/\bGBP|£/i.test(text)) return "GBP";
  return "SGD";
}
/** An explicitly evidenced maximum quoted in the same clause -- "subject to a
 * maximum of S$X" / "capped at S$X" / "not exceeding S$X" -- required to be
 * definite (no "may"/discretionary language) exactly like the formula itself. */
function findDeathCap(segment: string, from: number, to: number): DeathCap {
  const window = segment.slice(from, Math.min(segment.length, to));
  const cap = window.match(/\b(?:subject\s+to\s+a\s+maximum\s+of|capped\s+at|not\s+exceeding|maximum\s+(?:benefit|payout)\s+of)\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)/i);
  if (!cap) return null;
  const money = cap[1].match(MONEY_PATTERN);
  if (!money) return null;
  const amount = Number(money[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: explicitDeathCurrency(cap[1]) };
}
export function findDeathRule(pages: Page[], product: string): { page: number; pageEnd: number; quote: string; racingExclusion?: RacingExclusion; formula: DeathFormula; cap?: DeathCap } | null {
  const wanted = canonicalProduct(product);
  if (!["group term life", "group personal accident"].includes(wanted)) return null;
  let joined = "";
  const offsets: { start: number; page: number }[] = [];
  for (const page of [...pages].sort((a,b) => a.page_number - b.page_number)) {
    offsets.push({ start: joined.length, page: page.page_number }); joined += `${page.text}\n`;
  }
  const pageAt = (position: number) => offsets.filter(p => p.start <= position).at(-1)?.page ?? 1;
  const headings = [...joined.matchAll(HEADINGS)];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (canonicalProduct(heading[0]) !== wanted) continue;
    const start = heading.index! + heading[0].length;
    const segment = joined.slice(start, headings[i + 1]?.index ?? joined.length);
    const deathPattern = wanted === "group personal accident"
      ? /\b(?:Death\s+(?:due\s+to|caused\s+by|resulting\s+from|from)\s+(?:an?\s+)?Accident|Accidental\s+Death(?:\s+Benefit)?)\b/gi
      : /\bDeath(?:\s+Benefit)?\b/gi;
    for (const death of segment.matchAll(deathPattern)) {
      if (wanted === "group term life" && /accidental\s*$/i.test(segment.slice(Math.max(0, death.index! - 20), death.index))) continue;
      const tail = segment.slice(death.index! + death[0].length, death.index! + death[0].length + 220);
      const percentage = tail.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:the\s+)?)?(?:Sum\s+Insured|Sum\s+Assured)\b/i);
      const multiple = tail.match(/(\d+(?:\.\d+)?)\s*times?\s+(?:the\s+)?(?:Sum\s+Insured|Sum\s+Assured)\b/i);
      const fullSumPromise = tail.match(/^\s*If\s+an?\s+Insured\s+Person\s+dies\s+while\s+insured\s+for\s+this\s+Benefit\s*,\s*(?:the\s+Company|we)\s+will\s+pay\s+the\s+(?:relevant\s+)?(?:Sum\s+Insured|Sum\s+Assured)\s+for\s+death\b/i);
      const fixedBenefit = tail.match(/\b(?:a\s+)?fixed\s+(?:additional\s+)?(?:death\s+)?benefit\s+of\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)\s+(?:will\s+be\s+paid|is\s+payable|shall\s+be\s+paid)\b/i);
      let end: number;
      let formula: DeathFormula;
      if (fullSumPromise) {
        end = fullSumPromise[0].length;
        formula = { kind: "sum_insured_fraction", fraction: 1 };
      } else if (percentage) {
        const intervening = tail.slice(0, percentage.index);
        if (/%|\b(?:disablement|disability|fracture|ambulance|medical|recuperation|education|compassionate|advance payment|terminal illness)\b/i.test(intervening)) continue;
        if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
        const fraction = Number(percentage[1]) / 100;
        if (!Number.isFinite(fraction) || fraction <= 0) continue;
        end = percentage.index! + percentage[0].length;
        formula = { kind: "sum_insured_fraction", fraction };
      } else if (multiple) {
        const intervening = tail.slice(0, multiple.index);
        if (/\b(?:disablement|disability|fracture|ambulance|medical|recuperation|education|compassionate|advance payment|terminal illness)\b/i.test(intervening)) continue;
        if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
        const fraction = Number(multiple[1]);
        if (!Number.isFinite(fraction) || fraction <= 0) continue;
        end = multiple.index! + multiple[0].length;
        formula = { kind: "sum_insured_fraction", fraction };
      } else if (fixedBenefit) {
        const intervening = tail.slice(0, fixedBenefit.index);
        if (DISCRETIONARY_LANGUAGE.test(intervening)) continue;
        const money = fixedBenefit[1].match(MONEY_PATTERN);
        const amount = money ? Number(money[1].replace(/,/g, "")) : NaN;
        if (!Number.isFinite(amount) || amount <= 0) continue;
        end = fixedBenefit.index! + fixedBenefit[0].length;
        formula = { kind: "fixed", amount, currency: explicitDeathCurrency(fixedBenefit[1]) };
      } else continue;
      const absolute = start + death.index!;
      const quote = `${death[0]}${tail.slice(0, end)}`.trim();
      const cap = findDeathCap(tail, end, end + 260);
      const exclusion = wanted === "group personal accident"
        ? segment.match(/\b(?:exclusions?|we (?:will|do) not pay|not covered)\b[\s\S]{0,4000}?\b(participation\s+in\s+competitive\s+racing\s+on\s+wheels(?:\s+except\s+for\s+those\s+sanctioned\s+by\s+the\s+Authority)?)/i) : null;
      const racingExclusion = exclusion ? {
        quote: exclusion[1], page: pageAt(start + exclusion.index! + exclusion[0].indexOf(exclusion[1])),
        authorityException: /except.*sanctioned/i.test(exclusion[1]),
      } : undefined;
      return { page: pageAt(absolute), pageEnd: pageAt(absolute + quote.length - 1), quote, formula, ...(cap ? { cap } : {}), ...(racingExclusion ? { racingExclusion } : {}) };
    }
  }
  return null;
}

/** Rows are scoped to one account. Shared reference wording can explain each
 * member's independently confirmed cover of the same insurer and group.
 *
 * Evidence-document selection uses a deterministic, fail-closed precedence
 * instead of taking whichever document happens to satisfy a loose OR
 * condition first (the previous behaviour, and the source of a real
 * production ambiguity: two policies that are both genuinely linked to the
 * same family member, with byte-identical wording, could resolve to either
 * one depending on row/Map iteration order). The precedence, from strongest
 * to weakest:
 *
 *  1/2/3. The coverage's OWN policy document (exact policy ID). This schema
 *     stores one physical document per `policies` row with no separate
 *     "document version" or "contract id" distinct from the policy id
 *     itself, so the requested tiers "exact policy ID + applicable
 *     policy-document version" and "exact contract/group identifier within
 *     the same policy" collapse into this single tier here: a coverage's
 *     own policy row IS both its exact policy id and its only version.
 *  4. Explicitly linked shared/master wording -- another policy document
 *     that a `policy_members` row explicitly ties to this exact family
 *     member (`linked_to_member`), with matching insurer and group.
 *  5. Otherwise, unlinked shared reference material (a product summary,
 *     benefit guide or similar with `personal_coverage_confirmed=false`)
 *     that matches insurer and group but is not tied to this member by any
 *     explicit record. Weaker than tier 4 because nothing ties it to this
 *     specific person.
 *
 * At every tier, if MORE THAN ONE candidate document independently
 * qualifies, that is treated as ambiguous and this coverage fails closed
 * with an explicit reason code and no rule -- even when the documents carry
 * identical wording. Selecting between two equally-qualified documents
 * would only ever be justified by "the insurer/group/wording happens to
 * match", which is exactly the reasoning this function must not use to pick
 * evidence. A higher tier is tried first; only when a tier has zero
 * qualifying documents does resolution fall through to the next tier, and a
 * document that qualifies for a tier but whose text does not contain the
 * benefit clause (`findDeathRule` returns null) does not count as
 * "resolved" -- resolution properly falls through to the next tier. */
export function resolveDeathEvidence(coverages: OwnedCoverage[], rows: DeathWordingPage[]) {
  const documents = new Map<string, DeathWordingPage[]>();
  for (const row of rows) documents.set(row.policy_id, [...(documents.get(row.policy_id) ?? []), row]);
  const allDocuments = [...documents.values()];
  const rules: DeathRuleEvidence[] = [];
  const gaps: DeathEvidenceGap[] = [];
  for (const coverage of coverages) {
    const product = canonicalProduct(coverage.productName) || productFromCategory(coverage.category);
    if (!["group term life", "group personal accident"].includes(product)) continue;
    const insurer = canonicalDeathInsurer(coverage.insurer);
    const wantedGroup = groupNumber(coverage.groupPolicyNumber);
    const sameGroupAndInsurer = (pages: DeathWordingPage[]) => {
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

    // Tiers in strength order. A tier with 2+ qualifying documents is
    // ambiguous and fails this coverage closed immediately -- it never
    // falls through to a weaker tier, since that would silently prefer a
    // weaker-evidenced document purely because the stronger tier happened
    // to be unresolvable, which is its own form of picking by convenience.
    const tiers: { name: string; documents: DeathWordingPage[][] }[] = [
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
          coverageId: coverage.id,
          reasonCode: "AMBIGUOUS_EVIDENCE",
          reason: `${tier.documents.length} equally valid policy documents match this cover's insurer and group at the same evidence tier ("${tier.name}"), so DearPolicy cannot deterministically pick one for the death-benefit wording. It never guesses based on insurer, group number or wording similarity alone.`,
          nextStep: "Remove the duplicate/extra document, or explicitly confirm which document is this person's own policy wording.",
        });
        resolved = true; // consumed -- stop, do not fall through to a weaker tier
        break;
      }
      const pages = tier.documents[0];
      const first = pages[0];
      const found = findDeathRule(pages, product);
      if (!found) continue; // this tier's one candidate has no clause -- fall through
      rules.push({ coverageId: coverage.id, benefit: product === "group term life" ? "gtl-death" : "gpa-accidental-death", quote: found.quote, racingExclusion: found.racingExclusion,
        formula: found.formula, ...(found.cap ? { cap: found.cap } : {}),
        citation: { chunkId: `page:${first.policy_id}:${found.page}`, policyId: first.policy_id, policyName: first.product_name ?? first.original_filename,
          insurer: first.insurer ?? undefined, pageStart: found.page, pageEnd: found.pageEnd, documentRole: first.document_role,
          personalEvidence: false, evidenceLabel: "Death benefit wording" } });
      resolved = true;
      break;
    }
    if (!resolved) gaps.push(anyDocumentSeen
      ? { coverageId: coverage.id, reasonCode: "DOCUMENT_FOUND_NO_CLAUSE", reason: "A matching policy document is uploaded, but I could not verify its death-benefit clause.", nextStep: "Check that the uploaded benefit summary or wording is readable and includes the Death section." }
      : { coverageId: coverage.id, reasonCode: "NO_MATCHING_DOCUMENT", reason: "I could not find uploaded death-benefit wording that matches this cover's insurer and group.", nextStep: "Add the matching policy wording or benefit summary if it is missing; keep documents that are already uploaded." });
  }
  return { rules, gaps };
}

export async function loadDeathEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  const result = await query<DeathWordingPage>(`SELECT p.id AS policy_id, pp.page_number, pp.text, p.group_policy_number,
             p.insurer, p.product_name, p.original_filename, p.document_role, p.personal_coverage_confirmed,
             EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2) AS linked_to_member
        FROM policies p JOIN policy_pages pp ON pp.policy_id=p.id AND pp.account_id=p.account_id
       WHERE p.account_id=$1 AND p.processing_status='ready' AND ${activePredicate("p")}
         AND (EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2)
              OR (p.personal_coverage_confirmed=false AND p.document_role IN ('policy_wording','product_summary','benefit_guide','benefit_summary','rider')))
       ORDER BY p.document_authority DESC, p.created_at DESC, p.id, pp.page_number
       LIMIT 1000`, [accountId, familyMemberId]);
  // `pages` is exposed alongside the resolved rules/gaps so the claim-
  // composition engine (lib/claims/composition/engine.ts) can read
  // composition-relationship and aggregate-cap wording from the EXACT same
  // evidenced pages death-benefit resolution just used, rather than
  // issuing a second, potentially inconsistent, unverified fetch.
  return { ...resolveDeathEvidence(coverages, result.rows), pages: result.rows };
}

export async function loadDeathRuleEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  return (await loadDeathEvidence(accountId, familyMemberId, coverages)).rules;
}

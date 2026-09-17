import { query } from "@/lib/db/client";
import { canonicalProduct, productFromCategory, type OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimEvidence } from "./types";

export type RacingExclusion = { quote: string; page: number; authorityException?: boolean };
export type DeathRuleEvidence = { coverageId: string; benefit: "gtl-death" | "gpa-accidental-death"; quote: string; citation: ClaimEvidence; racingExclusion?: RacingExclusion };
export type DeathEvidenceGap = { coverageId: string; reason: string; nextStep: string };
export type DeathWordingPage = {
  policy_id: string; page_number: number; text: string; group_policy_number: string | null;
  insurer: string | null; product_name: string | null; original_filename: string;
  document_role: string | null; personal_coverage_confirmed: boolean; linked_to_member: boolean;
};
type Page = { page_number: number; text: string };
const HEADINGS = /\b(?:Group\s+Term\s+Life|Group\s+Personal\s+Accident|(?:Group\s+)?Living\s+Care(?:\s+Plus)?|(?:Group\s+)?Disability\s+Income|(?:Group\s+)?Outpatient\s+Medicare)\b/gi;
const REFERENCE_ROLES = new Set(["policy_wording", "product_summary", "benefit_guide", "benefit_summary", "rider"]);
const SINGLIFE_ALIASES = new Set(["singlife", "singlifewithaviva", "singaporelifeltd", "singaporelifelimited", "singaporelifeltdsinglife", "singaporelifelimitedsinglife"]);

/** Explicit legal/brand names shown on the supplied PDFs. Aviva by itself
 * and unrelated insurers are not aliases. */
export function canonicalDeathInsurer(value: string | null | undefined) {
  const name = (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return name ? (SINGLIFE_ALIASES.has(name) ? "singlife" : name) : null;
}

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
export function findDeathRule(pages: Page[], product: string): { page: number; pageEnd: number; quote: string; racingExclusion?: RacingExclusion } | null {
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
      const fullSumPromise = tail.match(/^\s*If\s+an?\s+Insured\s+Person\s+dies\s+while\s+insured\s+for\s+this\s+Benefit\s*,\s*(?:the\s+Company|we)\s+will\s+pay\s+the\s+(?:relevant\s+)?(?:Sum\s+Insured|Sum\s+Assured)\s+for\s+death\b/i);
      let end: number;
      if (fullSumPromise) end = fullSumPromise[0].length;
      else {
        if (!percentage || Number(percentage[1]) !== 100) continue;
        const intervening = tail.slice(0, percentage.index);
        if (/%|\b(?:disablement|disability|fracture|ambulance|medical|recuperation|education|compassionate|advance payment|terminal illness)\b/i.test(intervening)) continue;
        end = percentage.index! + percentage[0].length;
      }
      const absolute = start + death.index!;
      const quote = `${death[0]}${tail.slice(0, end)}`.trim();
      const exclusion = wanted === "group personal accident"
        ? segment.match(/\b(?:exclusions?|we (?:will|do) not pay|not covered)\b[\s\S]{0,4000}?\b(participation\s+in\s+competitive\s+racing\s+on\s+wheels(?:\s+except\s+for\s+those\s+sanctioned\s+by\s+the\s+Authority)?)/i) : null;
      const racingExclusion = exclusion ? {
        quote: exclusion[1], page: pageAt(start + exclusion.index! + exclusion[0].indexOf(exclusion[1])),
        authorityException: /except.*sanctioned/i.test(exclusion[1]),
      } : undefined;
      return { page: pageAt(absolute), pageEnd: pageAt(absolute + quote.length - 1), quote, ...(racingExclusion ? { racingExclusion } : {}) };
    }
  }
  return null;
}

/** Rows are scoped to one account. Shared reference wording can explain each
 * member's independently confirmed cover of the same insurer and group. */
export function resolveDeathEvidence(coverages: OwnedCoverage[], rows: DeathWordingPage[]) {
  const documents = new Map<string, DeathWordingPage[]>();
  for (const row of rows) documents.set(row.policy_id, [...(documents.get(row.policy_id) ?? []), row]);
  const rules: DeathRuleEvidence[] = [];
  const gaps: DeathEvidenceGap[] = [];
  for (const coverage of coverages) {
    const product = canonicalProduct(coverage.productName) || productFromCategory(coverage.category);
    if (!["group term life", "group personal accident"].includes(product)) continue;
    if (groupNumber(coverage.groupPolicyNumber) !== "G007500") {
      gaps.push({ coverageId: coverage.id, reason: "I could not verify matching death-benefit wording for the group stated on this person's personal certificate.", nextStep: "Add the policy wording or benefit summary issued for this cover." });
      continue;
    }
    let matchedReference = false;
    for (const pages of documents.values()) {
      const first = pages[0];
      const ownDocument = first.policy_id === coverage.policyId;
      const sharedReference = first.personal_coverage_confirmed === false && REFERENCE_ROLES.has(first.document_role ?? "");
      const insurer = canonicalDeathInsurer(coverage.insurer);
      const sameInsurer = insurer != null && insurer === documentInsurer(pages);
      const sameGroup = documentGroup(pages) === groupNumber(coverage.groupPolicyNumber);
      if (!(ownDocument || (sameGroup && sameInsurer && (sharedReference || first.linked_to_member)))) continue;
      if (!ownDocument) matchedReference = true;
      const found = findDeathRule(pages, product);
      if (!found) continue;
      rules.push({ coverageId: coverage.id, benefit: product === "group term life" ? "gtl-death" : "gpa-accidental-death", quote: found.quote, racingExclusion: found.racingExclusion,
        citation: { chunkId: `page:${first.policy_id}:${found.page}`, policyId: first.policy_id, policyName: first.product_name ?? first.original_filename,
          insurer: first.insurer ?? undefined, pageStart: found.page, pageEnd: found.pageEnd, documentRole: first.document_role,
          personalEvidence: false, evidenceLabel: "Death benefit wording" } });
      break;
    }
    if (!rules.some(r => r.coverageId === coverage.id)) gaps.push(matchedReference
      ? { coverageId: coverage.id, reason: "A matching policy document is uploaded, but I could not verify its death-benefit clause.", nextStep: "Check that the uploaded benefit summary or wording is readable and includes the Death section." }
      : { coverageId: coverage.id, reason: "I could not find uploaded death-benefit wording that matches this cover's insurer and group.", nextStep: "Add the matching policy wording or benefit summary if it is missing; keep documents that are already uploaded." });
  }
  return { rules, gaps };
}

export async function loadDeathEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  const result = await query<DeathWordingPage>(`SELECT p.id AS policy_id, pp.page_number, pp.text, p.group_policy_number,
             p.insurer, p.product_name, p.original_filename, p.document_role, p.personal_coverage_confirmed,
             EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2) AS linked_to_member
        FROM policies p JOIN policy_pages pp ON pp.policy_id=p.id AND pp.account_id=p.account_id
       WHERE p.account_id=$1 AND p.processing_status='ready'
         AND (EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2)
              OR (p.personal_coverage_confirmed=false AND p.document_role IN ('policy_wording','product_summary','benefit_guide','benefit_summary','rider')))
       ORDER BY p.document_authority DESC, p.created_at DESC, p.id, pp.page_number
       LIMIT 1000`, [accountId, familyMemberId]);
  return resolveDeathEvidence(coverages, result.rows);
}

export async function loadDeathRuleEvidence(accountId: string, familyMemberId: string, coverages: OwnedCoverage[]) {
  return (await loadDeathEvidence(accountId, familyMemberId, coverages)).rules;
}

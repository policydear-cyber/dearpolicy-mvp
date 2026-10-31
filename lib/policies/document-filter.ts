import { REFERENCE_ROLES } from "@/lib/documents/intelligence";
import { NON_COVER_ROLES } from "@/lib/documents/messy";

/** Only a letter can be the cover letter of a policy pack: a claim decision, a bill, a screenshot or notes never is. */
const PACK_COVER_ROLES: ReadonlySet<string> = new Set(["insurer_letter"]);

/** A policy pack that opens with a cover letter is filed as a letter by its first pages, but its own benefit reading,
 * page by page, finds the people it insures and what they hold. Content first: it is called a policy document only when
 * that reading says it is personal proof AND printed a cover with its sum (`reading_policy`, from READING_POLICY_SQL);
 * the reading's word alone never renames a letter. Nothing here names an insurer, a product or a market. */
export function readAsPolicyDocument(p: { document_role: string | null; reading_policy?: boolean | null }) {
  return !!p.document_role && PACK_COVER_ROLES.has(p.document_role) && p.reading_policy === true;
}

/** The SQL for `reading_policy` on a policies row aliased `p`: the stored benefit reading (lib/benefit-table/service.ts
 * readDocument stores `{document: <Reading>, pages}`) says personal proof and has a cover with a sum insured. Strict JSON
 * paths with errors silenced, so a reading of another shape is false, never an error. Needs public.benefit_readings. */
export const READING_POLICY_SQL = `EXISTS(SELECT 1 FROM benefit_readings br WHERE br.policy_id=p.id AND br.account_id=p.account_id
  AND br.reading #>> '{document,document,kind}' = 'personal_proof'
  AND jsonb_path_exists(br.reading,'strict $.document.covers[*] ? (@.sumInsured.type() == "number" && @.sumInsured > 0)','{}',true))`;

/** Which filter a document sits under, in a household's terms, decided by what the document is. A general document about a
 * product (wording, summary, benefit guide, brochure, illustration, a blank claim form) is "General wording" even when
 * linked to someone (its card's "Applies to" line says who), unless its reading confirmed the household's own cover;
 * anything about their own cover or account (a schedule, a certificate, a receipt, a renewal, a letter, a file whose kind
 * is not known) is one of "Your policies". */
export function isOwnDocument(p: { personal_coverage_confirmed: boolean; document_role: string | null }) {
  if (p.personal_coverage_confirmed) return true;
  // A welcome letter is a reference role for reading, but it is sent about the household's own policy.
  return !(p.document_role && p.document_role !== "welcome_letter" && REFERENCE_ROLES.has(p.document_role));
}

/** The card's badge, in the household's words and always agreeing with the filter the card sits under (isOwnDocument):
 * a general document says "General wording"; one of their own never does, whatever the reading's stored label. */
const GENERAL_LABELS = new Set(["Reference", "Contract wording", "Reference information", "Supporting document"]);
export function authorityLabel(policy: Parameters<typeof isOwnDocument>[0] & { document_authority_label: string | null; reading_policy?: boolean | null; linked_people: { source: string }[] }) {
  if (!isOwnDocument(policy)) return "General wording";
  const label = readAsPolicyDocument(policy) ? null : policy.document_authority_label ?? (policy.personal_coverage_confirmed ? "Personal proof" : null);
  if (label === "Personal proof") return "Your own policy";
  if (label && !GENERAL_LABELS.has(label)) return label;
  return policy.linked_people.some((l) => l.source !== "scheme_reference_match") ? "Linked to your cover" : "Your document";
}

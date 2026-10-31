import { REFERENCE_ROLES } from "@/lib/documents/intelligence";

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
export function authorityLabel(policy: Parameters<typeof isOwnDocument>[0] & { document_authority_label: string | null; linked_people: { source: string }[] }) {
  if (!isOwnDocument(policy)) return "General wording";
  const label = policy.document_authority_label ?? (policy.personal_coverage_confirmed ? "Personal proof" : null);
  if (label === "Personal proof") return "Your own policy";
  if (label && !GENERAL_LABELS.has(label)) return label;
  return policy.linked_people.some((l) => l.source !== "scheme_reference_match") ? "Linked to your cover" : "Your document";
}

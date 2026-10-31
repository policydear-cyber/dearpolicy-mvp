import { REFERENCE_ROLES } from "@/lib/documents/intelligence";

/** Which filter a document sits under, in a household's terms. Only a general document about a product (wording, summary,
 * brochure, illustration, a blank claim form) that nobody in the household is linked to is "General wording"; anything
 * tied to their own cover, by its reading or by a person chosen on it, and anything about their own account (a schedule,
 * a receipt, a renewal, a letter, a file whose kind is not known) is one of "Your policies". */
export function isOwnDocument(p: { personal_coverage_confirmed: boolean; document_role: string | null; linked_people: { source: string }[] }) {
  if (p.personal_coverage_confirmed) return true;
  if (p.linked_people.some((l) => l.source !== "scheme_reference_match")) return true;
  // A welcome letter is a reference role for reading, but it is sent about the household's own policy.
  return !(p.document_role && p.document_role !== "welcome_letter" && REFERENCE_ROLES.has(p.document_role));
}

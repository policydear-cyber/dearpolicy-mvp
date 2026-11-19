/**
 * How the graders recognise a document in an answer, now that answers never show file names (DC 18 Nov). DC approved
 * changing the graders that pinned the file name on 19 Nov (decision card, 10:07Z); see
 * docs/verification/grader-changes-2026-11-19.md. A document is named by its title (lib/policies/document-name.ts
 * documentName); an upload with no name of its own reads "Photo uploaded 3 Nov 2026" (unnamedDescription), whose day
 * depends on when the fixture was seeded, so it is matched by shape. What each check grades is unchanged: only the words
 * that identify the document changed.
 */
import { documentName, hasOwnName } from "../../lib/policies/document-name";

export const UNNAMED_UPLOAD = /\b(?:photo|PDF|Word file|file) uploaded \d{1,2} [A-Z][a-z]{2} \d{4}\b/i;

type FixtureDoc = { product?: string | null; filename?: string | null; insurer?: string | null; role?: string | null; policyNumber?: string | null };
const asRow = (d: FixtureDoc) => ({ product_name: d.product?.trim() || null, original_filename: d.filename ?? "", insurer: d.insurer ?? null, document_role: d.role ?? null, policy_number: d.policyNumber ?? null });

/** The words an answer uses for this document: its product, and its title. Empty for an upload with no name of its own. */
export function spokenNames(d: FixtureDoc): string[] {
  const row = asRow(d);
  if (!hasOwnName(row)) return [];
  return [...new Set([d.product?.trim() ?? "", documentName(row)].filter((x) => x.length > 0))];
}
/** Whether `text` names this document: by product or title, or, for an upload with no name of its own, as "Photo uploaded <day>". */
export function namesDocument(d: FixtureDoc, text: string): boolean {
  const names = spokenNames(d);
  return names.length ? names.some((n) => text.includes(n)) : UNNAMED_UPLOAD.test(text);
}

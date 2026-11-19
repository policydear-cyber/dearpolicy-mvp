/**
 * How the graders recognise a document in an answer, now that answers never show file names (DC 18 Nov). DC approved
 * changing the graders that pinned the file name on 19 Nov (decision card, 10:07Z); see
 * docs/verification/grader-changes-2026-11-19.md. A document is named by its title (lib/policies/document-name.ts
 * documentName); an upload with no name of its own reads "Photo uploaded 3 Nov 2026" (unnamedDescription), whose day
 * depends on when the fixture was seeded, so it is matched by shape. What each check grades is unchanged: only the words
 * that identify the document changed.
 */
import { documentName, hasOwnName } from "../../lib/policies/document-name";

export const UNNAMED_UPLOAD = /\b(?:Photo|PDF|Word file|File) uploaded \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/;

type FixtureDoc = { product?: string | null; filename?: string | null; insurer?: string | null; role?: string | null; policyNumber?: string | null };
const asRow = (d: FixtureDoc) => ({ product_name: d.product?.trim() || null, original_filename: d.filename ?? "", insurer: d.insurer ?? null, document_role: d.role ?? null, policy_number: d.policyNumber ?? null });
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The exact shape a nameless upload is said with: its own format word ("Photo" for a .jpg, never "PDF") and a Singapore day
 * (the day depends on when the fixture was seeded, so any day). Case-sensitive (TE #564 F3). */
export function unnamedShape(d: FixtureDoc): RegExp {
  const file = d.filename ?? "";
  const word = /\.(?:jpe?g|png|heic|heif|webp|gif|tiff?)$/i.test(file) ? "Photo" : /\.pdf$/i.test(file) ? "PDF" : /\.docx?$/i.test(file) ? "Word file" : "File";
  return new RegExp(`\\b${escape(word)} uploaded \\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4}\\b`);
}
/** Text that names the upload by its file: the whole file name, or (for a nameless upload) its stem, in any case
 * ("IMG_0042.jpg", "IMG_0042", "img_0042.JPG"). */
export function showsFileName(d: FixtureDoc, text: string): boolean {
  const file = d.filename?.trim();
  if (!file) return false;
  const stem = file.replace(/\.[a-z0-9]{1,5}$/i, "");
  const t = text.toLowerCase();
  return t.includes(file.toLowerCase()) || (!hasOwnName(asRow(d)) && t.includes(stem.toLowerCase()));
}

/** The words an answer uses for this document: its product, and its title. Empty for an upload with no name of its own. */
export function spokenNames(d: FixtureDoc): string[] {
  const row = asRow(d);
  if (!hasOwnName(row)) return [];
  return [...new Set([d.product?.trim() ?? "", documentName(row)].filter((x) => x.length > 0))];
}
/** Whether `text` names this document by its title (or, for an upload with no name of its own, by its exact shape) and
 * does not show its file name: a text that shows the file name never counts as naming it (TE #564 F2). */
export function namesDocument(d: FixtureDoc, text: string): boolean {
  if (showsFileName(d, text)) return false;
  const names = spokenNames(d);
  return names.length ? names.some((n) => text.includes(n)) : unnamedShape(d).test(text);
}

/**
 * Identity and claim-event matching for a reviewed cause-of-death document.
 *
 * This never resolves an ambiguity on its own -- every genuinely uncertain
 * case (a weak name match, more than one person mentioned, a conflicting
 * date, a document already used elsewhere) comes out as `needs_review`,
 * which is exactly what blocks calculateAccidentalDeath() downstream until
 * a reviewer explicitly looks at it. Only a clean, unambiguous match comes
 * out `confirmed`, and a document that plainly names someone else entirely
 * comes out `mismatch`, which additionally cannot be waved through as
 * "still checking" the way `needs_review` can.
 */
import type { ClaimEvidenceDocumentRow, ClaimEvidenceExtractedFields, ClaimEvidenceIdentityConflict, ClaimEvidenceIdentityStatus } from "./types";

function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

/** Token-overlap similarity in [0,1] -- the same technique lib/rag/ingest.ts
 * uses to verify extracted evidence against source text, applied here to
 * two names instead. Order-independent, so "Tan Yi Chuen" and "Yi Chuen
 * Tan" score the same, and tolerant of a dropped middle name, but a name
 * that shares almost no tokens scores low regardless of length. */
function nameSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalize(a).split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(normalize(b).split(" ").filter((t) => t.length > 1));
  if (!tokensA.size || !tokensB.size) return 0;
  const shared = [...tokensA].filter((t) => tokensB.has(t)).length;
  return shared / Math.max(tokensA.size, tokensB.size);
}

function daysBetween(a: string, b: string): number | null {
  const da = Date.parse(a), db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.abs(da - db) / 86_400_000;
}

export function evaluateClaimEvidenceIdentity(args: {
  familyMember: { displayName: string; preferredName: string | null };
  fields: ClaimEvidenceExtractedFields;
  /** The claim's own already-stated date of death, if the family already
   * gave one in chat -- never overridden here, only checked against. */
  existingDeathDate: string | null;
  /** This exact file's content already seen under a different family
   * member or claim in this account (see store.findReusedEvidenceAcrossScopes). */
  reusedDocuments: ClaimEvidenceDocumentRow[];
  claimSessionId: string;
  familyMemberId: string;
}): { status: ClaimEvidenceIdentityStatus; conflicts: ClaimEvidenceIdentityConflict[] } {
  const conflicts: ClaimEvidenceIdentityConflict[] = [];

  for (const other of args.reusedDocuments) {
    if (other.family_member_id !== args.familyMemberId) {
      conflicts.push({ code: "REUSED_FOR_ANOTHER_FAMILY_MEMBER", message: "This exact document was already uploaded under a different family member." });
    } else if (other.claim_session_id !== args.claimSessionId) {
      conflicts.push({ code: "REUSED_FOR_ANOTHER_CLAIM", message: "This exact document was already uploaded for a different claim." });
    }
  }

  if (!args.fields.deceasedName || !args.fields.deceasedName.trim()) {
    conflicts.push({ code: "MISSING_IDENTIFIERS", message: "The document does not clearly state the deceased person's name." });
    return { status: "needs_review", conflicts };
  }

  const bestSimilarity = Math.max(
    nameSimilarity(args.fields.deceasedName, args.familyMember.displayName),
    args.familyMember.preferredName ? nameSimilarity(args.fields.deceasedName, args.familyMember.preferredName) : 0,
  );

  if (args.fields.otherNamesMentioned.length > 0) {
    conflicts.push({ code: "MULTIPLE_PEOPLE_MENTIONED", message: "The document mentions more than one person; DearPolicy cannot assume which one this claim is about." });
  }

  if (!args.fields.personIdentifiers.length) {
    conflicts.push({ code: "MISSING_IDENTIFIERS", message: "The document does not include an identifier (e.g. NRIC, passport, case/report number) to independently confirm the person." });
  }

  if (args.existingDeathDate && args.fields.dateOfDeath) {
    const diff = daysBetween(args.existingDeathDate, args.fields.dateOfDeath);
    if (diff !== null && diff > 1) {
      conflicts.push({ code: "CONFLICTING_DATE_OF_DEATH", message: "The document's date of death does not match the date already recorded for this claim." });
    }
  }

  // A weak or absent name match is treated as plainly the wrong person,
  // not merely "needs a second look" -- MISMATCH blocks harder than
  // needs_review (see ./state-machine.ts: "matched" can still return to
  // needs_review for re-review, but a mismatch is not offered as a
  // pending confirmation).
  if (bestSimilarity < 0.4) {
    conflicts.push({ code: "NAME_MISMATCH", message: "The deceased person named in the document does not match this family member's name." });
    return { status: "mismatch", conflicts };
  }
  if (conflicts.length > 0 || bestSimilarity < 0.85) return { status: "needs_review", conflicts };
  return { status: "confirmed", conflicts };
}

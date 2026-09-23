import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function root() {
  return path.resolve(/* turbopackIgnore: true */ process.env.LOCAL_STORAGE_DIR ?? "./data/storage");
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function savePolicyFile(args: {
  accountId: string;
  familyMemberId: string;
  policyId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  const dir = path.join(/* turbopackIgnore: true */ root(), safeSegment(args.accountId), safeSegment(args.familyMemberId), safeSegment(args.policyId));
  await mkdir(dir, { recursive: true });
  const filename = safeSegment(args.filename || "policy.pdf");
  const fullPath = path.join(/* turbopackIgnore: true */ dir, filename);
  await writeFile(fullPath, args.bytes);
  return path.relative(root(), fullPath).replaceAll(path.sep, "/");
}

export async function readPolicyFile(storageKey: string) {
  const storageRoot=root();
  const fullPath=path.resolve(storageRoot,storageKey);
  if(fullPath!==storageRoot&&!fullPath.startsWith(`${storageRoot}${path.sep}`))throw new Error("Invalid storage path");
  return readFile(/* turbopackIgnore: true */ fullPath);
}

export async function deletePolicyFile(storageKey: string) {
  const storageRoot = root();
  const fullPath = path.resolve(storageRoot, storageKey);

  // Refuse to delete anything outside DearPolicy's configured storage directory.
  if (fullPath !== storageRoot && !fullPath.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("Invalid storage path");
  }

  // Every uploaded policy is stored inside its own policy-id directory. Removing
  // that directory clears the PDF and any future temporary artefacts beside it.
  const policyDirectory = path.dirname(fullPath);
  await rm(policyDirectory, { recursive: true, force: true });
}

// --- Claim evidence (death certificates, police reports, coroner's/medical
// examiner's reports) -- stored under its own root, entirely separate from
// policy documents above, per the claim-evidence pipeline's requirement
// that the two are never mixed in the same storage location.
function claimEvidenceRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.env.LOCAL_CLAIM_EVIDENCE_DIR ?? "./data/claim-evidence");
}

export async function saveClaimEvidenceFile(args: {
  accountId: string;
  familyMemberId: string;
  claimSessionId: string;
  documentId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  const dir = path.join(
    /* turbopackIgnore: true */ claimEvidenceRoot(),
    safeSegment(args.accountId), safeSegment(args.familyMemberId), safeSegment(args.claimSessionId), safeSegment(args.documentId),
  );
  await mkdir(dir, { recursive: true });
  const filename = safeSegment(args.filename || "evidence.pdf");
  const fullPath = path.join(/* turbopackIgnore: true */ dir, filename);
  await writeFile(fullPath, args.bytes);
  return path.relative(claimEvidenceRoot(), fullPath).replaceAll(path.sep, "/");
}

export async function readClaimEvidenceFile(storageKey: string) {
  const storageRoot = claimEvidenceRoot();
  const fullPath = path.resolve(storageRoot, storageKey);
  if (fullPath !== storageRoot && !fullPath.startsWith(`${storageRoot}${path.sep}`)) throw new Error("Invalid storage path");
  return readFile(/* turbopackIgnore: true */ fullPath);
}

export async function deleteClaimEvidenceFile(storageKey: string) {
  const storageRoot = claimEvidenceRoot();
  const fullPath = path.resolve(storageRoot, storageKey);
  if (fullPath !== storageRoot && !fullPath.startsWith(`${storageRoot}${path.sep}`)) throw new Error("Invalid storage path");
  const documentDirectory = path.dirname(fullPath);
  await rm(documentDirectory, { recursive: true, force: true });
}

/** Local disk has no notion of a signed URL -- the review UI instead reads
 * claim-evidence bytes through an authenticated app route
 * (app/api/claims/evidence/[id]/file/route.ts), which itself re-checks
 * account/family-member/claim ownership on every request. Returning null
 * here tells that route to stream the bytes itself rather than redirect. */
export async function createClaimEvidenceSignedUrl(_storageKey: string): Promise<string | null> {
  return null;
}

// --- Household export (checkpoint 6): a versioned, deterministic JSON
// snapshot of everything a household is entitled to export (see
// lib/household/export.ts). Its own root, entirely separate from policy
// documents and claim evidence above -- an export is generated content,
// not an uploaded document, and is meant to disappear on a much shorter
// horizon (see lib/household/export-store.ts's expiry handling).
function householdExportRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.env.LOCAL_HOUSEHOLD_EXPORT_DIR ?? "./data/household-exports");
}

export async function saveHouseholdExportFile(args: { householdId: string; exportId: string; bytes: Uint8Array }) {
  const dir = path.join(/* turbopackIgnore: true */ householdExportRoot(), safeSegment(args.householdId));
  await mkdir(dir, { recursive: true });
  const filename = `${safeSegment(args.exportId)}.json`;
  const fullPath = path.join(/* turbopackIgnore: true */ dir, filename);
  await writeFile(fullPath, args.bytes);
  return path.relative(householdExportRoot(), fullPath).replaceAll(path.sep, "/");
}

export async function readHouseholdExportFile(storageKey: string) {
  const storageRoot = householdExportRoot();
  const fullPath = path.resolve(storageRoot, storageKey);
  if (fullPath !== storageRoot && !fullPath.startsWith(`${storageRoot}${path.sep}`)) throw new Error("Invalid storage path");
  return readFile(/* turbopackIgnore: true */ fullPath);
}

export async function deleteHouseholdExportFile(storageKey: string) {
  const storageRoot = householdExportRoot();
  const fullPath = path.resolve(storageRoot, storageKey);
  if (fullPath !== storageRoot && !fullPath.startsWith(`${storageRoot}${path.sep}`)) throw new Error("Invalid storage path");
  await rm(fullPath, { force: true });
}

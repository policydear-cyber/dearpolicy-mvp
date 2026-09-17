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

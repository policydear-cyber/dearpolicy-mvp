/** Storage facade. Picks the backend once, at first use, so the rest of the
 * app never has to know or care whether a PDF lives on local disk (dev) or
 * in Supabase Storage (production/Vercel, where a request can land on a
 * different, ephemeral machine each time — local disk does not survive that).
 *
 * STORAGE_DRIVER=local forces local disk (the default when Supabase is not
 * configured). STORAGE_DRIVER=supabase forces Supabase Storage. Otherwise the
 * choice follows whether SUPABASE_URL is set. */
import * as local from "./local";
import * as supabaseStorage from "./supabase";

function driver(): "local" | "supabase" {
  const explicit = (process.env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  if (explicit === "local" || explicit === "supabase") return explicit;
  return process.env.SUPABASE_URL ? "supabase" : "local";
}

function backend() {
  return driver() === "supabase" ? supabaseStorage : local;
}

export async function savePolicyFile(args: {
  accountId: string;
  familyMemberId: string;
  policyId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  return backend().savePolicyFile(args);
}

export async function readPolicyFile(storageKey: string) {
  return backend().readPolicyFile(storageKey);
}

export async function deletePolicyFile(storageKey: string) {
  return backend().deletePolicyFile(storageKey);
}

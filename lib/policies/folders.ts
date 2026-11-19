/** Policy folders (sql/policy-folders.sql): the household puts the documents of one policy into one folder, says who the
 * policy is for, and confirms when every document is in it. The household decides the grouping; nothing here guesses.
 *
 * Every write runs on the server's connection, for the household's owner only (the routes check that), and checks that
 * every document and person named belongs to the household before anything is written. Until sql/policy-folders.sql is
 * applied, foldersReady() is false, reads give no folders and writes are refused with FoldersNotReadyError. */
import { pool, query } from "@/lib/db/client";

export type FolderSlot = "schedule" | "wording" | "rider" | "other";
export const FOLDER_SLOTS: readonly FolderSlot[] = ["schedule", "wording", "rider", "other"];
export type PolicyFolder = {
  id: string;
  /** The household's own name for it, or null (the page then names it from its documents). */
  name: string | null;
  /** The household said these are all the documents for this policy. */
  complete: boolean;
  people: { id: string; name: string }[];
  /** Its documents that are still in the library, in the order they were added. */
  documents: { policyId: string; slot: FolderSlot | null }[];
  /** A document in it that a newer copy replaced, with that copy (not in the folder): offered as "Add it", never added
   * on its own. */
  replacements: { policyId: string; slot: FolderSlot | null; by: string }[];
  createdAt: string;
};
export type FolderDocumentInput = { policyId: string; slot?: FolderSlot | null };

export class FoldersNotReadyError extends Error {}
/** A document, person or folder that is not this household's, or a request that would leave a folder unusable. */
export class FolderInputError extends Error {}

let ready: Promise<boolean> | null = null;
export function foldersReady(): Promise<boolean> {
  // The tables and the newest column: a database with an earlier draft's tables and no confirmed_documents is not ready,
  // so nothing reads a column that is missing (TE #541 F1).
  ready ??= query<{ t: string | null; c: boolean }>(`SELECT to_regclass('public.policy_folder_documents')::text AS t,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='policy_folders' AND column_name='confirmed_documents') AS c`)
    .then((r) => !!r.rows[0]?.t && r.rows[0]?.c === true).catch(() => false)
    // Only a present table is remembered, so applying the file needs no restart.
    .then((ok) => { if (!ok) ready = null; return ok; });
  return ready;
}
/** For tests: forget whether the tables exist. */
export function resetFoldersReady() { ready = null; }

/** The household's folders, each with its people still in the household and its documents still in the library. */
export async function listFolders(accountId: string): Promise<PolicyFolder[]> {
  if (!await foldersReady()) return [];
  const folders = await query<{ id: string; account_id: string; name: string | null; complete: boolean; confirmed_documents: string[] | null; created_at: Date | string }>(
    "SELECT id, account_id, name, complete, confirmed_documents, created_at FROM policy_folders WHERE account_id=$1 ORDER BY created_at, id", [accountId]);
  if (!folders.rows.length) return [];
  const ids = folders.rows.map((f) => f.id);
  const [people, documents] = await Promise.all([
    query<{ folder_id: string; account_id: string; id: string; name: string }>(
      `SELECT fp.folder_id, fp.account_id, f.id, f.display_name AS name FROM policy_folder_people fp
         JOIN family_members f ON f.id=fp.family_member_id AND f.account_id=fp.account_id AND f.lifecycle_state='active'
        WHERE fp.account_id=$1 AND fp.folder_id = ANY($2::uuid[]) ORDER BY f.display_name`, [accountId, ids]),
    query<{ folder_id: string; account_id: string; policy_id: string; slot: FolderSlot | null }>(
      `SELECT fd.folder_id, fd.account_id, fd.policy_id, fd.slot FROM policy_folder_documents fd
         JOIN policies p ON p.id=fd.policy_id AND p.account_id=fd.account_id AND p.lifecycle_state='active' AND p.superseded_at IS NULL
        WHERE fd.account_id=$1 AND fd.folder_id = ANY($2::uuid[]) ORDER BY fd.created_at, fd.policy_id`, [accountId, ids]),
  ]);
  // Documents in a folder that a newer copy has replaced since, with that copy when it is in the library.
  const replaced = await query<{ folder_id: string; account_id: string; policy_id: string; slot: FolderSlot | null; by: string }>(
    `SELECT fd.folder_id, fd.account_id, fd.policy_id, fd.slot, n.id AS by FROM policy_folder_documents fd
       JOIN policies p ON p.id=fd.policy_id AND p.account_id=fd.account_id AND p.lifecycle_state='active' AND p.superseded_at IS NOT NULL
       JOIN policies n ON n.supersedes_id=p.id AND n.account_id=fd.account_id AND n.lifecycle_state='active' AND n.superseded_at IS NULL
      WHERE fd.account_id=$1 AND fd.folder_id = ANY($2::uuid[])
        AND NOT EXISTS (SELECT 1 FROM policy_folder_documents x WHERE x.folder_id=fd.folder_id AND x.policy_id=n.id)
      ORDER BY fd.created_at, fd.policy_id`, [accountId, ids]);
  for (const row of [...folders.rows, ...people.rows, ...documents.rows, ...replaced.rows])
    if (String(row.account_id) !== accountId) throw new Error("A folder row from another household was returned");
  return folders.rows.map((f) => ({
    id: f.id, name: f.name,
    complete: stillComplete(f.complete, f.confirmed_documents, documents.rows.filter((d) => d.folder_id === f.id).map((d) => d.policy_id)),
    createdAt: f.created_at instanceof Date ? f.created_at.toISOString() : String(f.created_at),
    people: people.rows.filter((p) => p.folder_id === f.id).map((p) => ({ id: p.id, name: p.name })),
    documents: documents.rows.filter((d) => d.folder_id === f.id).map((d) => ({ policyId: d.policy_id, slot: d.slot })),
    replacements: replaced.rows.filter((d) => d.folder_id === f.id).map((d) => ({ policyId: d.policy_id, slot: d.slot, by: d.by })),
  }));
}

/** A folder is complete only while every document it held when the household said yes is still in the library: one that
 * was deleted or replaced by a newer copy since makes it not complete, so the household is asked again. */
export function stillComplete(complete: boolean, confirmed: readonly string[] | null | undefined, live: readonly string[]): boolean {
  if (!complete) return false;
  const now = new Set(live.map(String));
  // Saying yes always records at least one document, so an empty record is never a confirmation.
  return now.size > 0 && !!confirmed?.length && confirmed.every((id) => now.has(String(id)));
}

type Tx = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
async function inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client as unknown as Tx);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const cleanName = (name: string | null | undefined) => {
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  if (n.length > 120) throw new FolderInputError("A policy name can be at most 120 characters.");
  return n || null;
};
const unique = <T>(xs: T[]) => [...new Set(xs)];

async function checkPeople(tx: Tx, accountId: string, ids: string[]) {
  if (!ids.length) return;
  const r = await tx.query("SELECT id FROM family_members WHERE account_id=$1 AND id = ANY($2::uuid[]) AND lifecycle_state='active'", [accountId, ids]);
  if (r.rows.length !== ids.length) throw new FolderInputError("That person is not in this household.");
}
async function checkDocuments(tx: Tx, accountId: string, ids: string[]) {
  if (!ids.length) return;
  const r = await tx.query("SELECT id FROM policies WHERE account_id=$1 AND id = ANY($2::uuid[]) AND lifecycle_state='active'", [accountId, ids]);
  if (r.rows.length !== ids.length) throw new FolderInputError("That document is not in this household's library.");
}
async function lockFolder(tx: Tx, accountId: string, folderId: string) {
  const r = await tx.query("SELECT id FROM policy_folders WHERE id=$1 AND account_id=$2 FOR UPDATE", [folderId, accountId]);
  if (!r.rows.length) throw new FolderInputError("That policy is not in this household.");
}
async function addDocuments(tx: Tx, accountId: string, folderId: string, docs: FolderDocumentInput[]) {
  for (const d of docs) await tx.query(
    `INSERT INTO policy_folder_documents(folder_id, account_id, policy_id, slot) VALUES($1,$2,$3,$4)
     ON CONFLICT (folder_id, policy_id) DO UPDATE SET slot=COALESCE(EXCLUDED.slot, policy_folder_documents.slot)`,
    [folderId, accountId, d.policyId, d.slot ?? null]);
}
async function documentCount(tx: Tx, accountId: string, folderId: string) {
  const r = await tx.query(`SELECT count(*)::int AS n FROM policy_folder_documents fd JOIN policies p ON p.id=fd.policy_id AND p.account_id=fd.account_id
    AND p.lifecycle_state='active' AND p.superseded_at IS NULL WHERE fd.folder_id=$1 AND fd.account_id=$2`, [folderId, accountId]);
  return Number(r.rows[0]?.n ?? 0);
}
async function personCount(tx: Tx, accountId: string, folderId: string) {
  const r = await tx.query(`SELECT count(*)::int AS n FROM policy_folder_people fp JOIN family_members f ON f.id=fp.family_member_id AND f.account_id=fp.account_id
    AND f.lifecycle_state='active' WHERE fp.folder_id=$1 AND fp.account_id=$2`, [folderId, accountId]);
  return Number(r.rows[0]?.n ?? 0);
}

/** A new folder for one or more of the household's people, with any of its documents. `complete` is the household's answer
 * to "Are these all the documents for this policy?"; a folder with no document can't be complete. */
export async function createFolder(accountId: string, input: { name?: string | null; people: string[]; documents: FolderDocumentInput[]; complete: boolean }): Promise<string> {
  if (!await foldersReady()) throw new FoldersNotReadyError("Policy folders are not switched on yet.");
  const people = unique(input.people), docs = [...new Map(input.documents.map((d) => [d.policyId, d])).values()];
  if (!people.length) throw new FolderInputError("Choose who this policy is for.");
  if (input.complete && !docs.length) throw new FolderInputError("Add at least one document first.");
  const name = cleanName(input.name);
  return inTransaction(async (tx) => {
    await checkPeople(tx, accountId, people);
    await checkDocuments(tx, accountId, docs.map((d) => d.policyId));
    const created = await tx.query("INSERT INTO policy_folders(account_id, name, complete, confirmed_documents) VALUES($1,$2,$3,$4::uuid[]) RETURNING id",
      [accountId, name, input.complete, input.complete ? docs.map((d) => d.policyId) : []]);
    const id = String(created.rows[0].id);
    for (const p of people) await tx.query("INSERT INTO policy_folder_people(folder_id, account_id, family_member_id) VALUES($1,$2,$3)", [id, accountId, p]);
    await addDocuments(tx, accountId, id, docs);
    return id;
  });
}

/** Changes to one folder. Adding or removing a document makes it not complete again, unless the same request answers
 * "Are these all the documents?" (`complete`). A folder keeps at least one person, and is complete only with a document. */
export async function updateFolder(accountId: string, folderId: string, change: {
  name?: string | null; complete?: boolean; people?: string[]; add?: FolderDocumentInput[]; remove?: string[];
}): Promise<void> {
  if (!await foldersReady()) throw new FoldersNotReadyError("Policy folders are not switched on yet.");
  const autoOn = await autoFoldersReady();
  await inTransaction(async (tx) => {
    await lockFolder(tx, accountId, folderId);
    const add = [...new Map((change.add ?? []).map((d) => [d.policyId, d])).values()], remove = unique(change.remove ?? []);
    await checkDocuments(tx, accountId, add.map((d) => d.policyId));
    if (change.people) {
      const people = unique(change.people);
      if (!people.length) throw new FolderInputError("Choose who this policy is for.");
      await checkPeople(tx, accountId, people);
      await tx.query("DELETE FROM policy_folder_people WHERE folder_id=$1 AND account_id=$2 AND NOT (family_member_id = ANY($3::uuid[]))", [folderId, accountId, people]);
      for (const p of people) await tx.query("INSERT INTO policy_folder_people(folder_id, account_id, family_member_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [folderId, accountId, p]);
    }
    await addDocuments(tx, accountId, folderId, add);
    if (remove.length) {
      await tx.query("DELETE FROM policy_folder_documents WHERE folder_id=$1 AND account_id=$2 AND policy_id = ANY($3::uuid[])", [folderId, accountId, remove]);
      // A document the household took out is never put into a folder again on its own.
      if (autoOn) await tx.query(`INSERT INTO policy_folder_auto(policy_id, account_id) SELECT p.id, p.account_id FROM policies p
        WHERE p.account_id=$1 AND p.id = ANY($2::uuid[]) ON CONFLICT DO NOTHING`, [accountId, remove]);
    }
    const documentsChanged = add.length > 0 || remove.length > 0;
    const complete: boolean | undefined = change.complete ?? (documentsChanged ? false : undefined);
    if (complete && await documentCount(tx, accountId, folderId) === 0) throw new FolderInputError("Add at least one document first.");
    if (change.people && await personCount(tx, accountId, folderId) === 0) throw new FolderInputError("Choose who this policy is for.");
    const sets: string[] = ["updated_at=now()"], params: unknown[] = [folderId, accountId];
    if (change.name !== undefined) { params.push(cleanName(change.name)); sets.push(`name=$${params.length}`); }
    if (complete !== undefined) {
      params.push(complete); sets.push(`complete=$${params.length}`);
      // What "all the documents" meant when the household said yes: the documents in it now that are in the library.
      sets.push(complete ? `confirmed_documents=ARRAY(SELECT fd.policy_id FROM policy_folder_documents fd JOIN policies p ON p.id=fd.policy_id
        AND p.account_id=fd.account_id AND p.lifecycle_state='active' AND p.superseded_at IS NULL WHERE fd.folder_id=$1 AND fd.account_id=$2)` : "confirmed_documents='{}'");
    }
    await tx.query(`UPDATE policy_folders SET ${sets.join(",")} WHERE id=$1 AND account_id=$2`, params);
  });
}

/** Deletes the folder only: its documents stay in the library, and none of them is made into a folder again on its own. */
export async function deleteFolder(accountId: string, folderId: string): Promise<void> {
  if (!await foldersReady()) throw new FoldersNotReadyError("Policy folders are not switched on yet.");
  const autoOn = await autoFoldersReady();
  await inTransaction(async (tx) => {
    if (autoOn) await tx.query(`INSERT INTO policy_folder_auto(policy_id, account_id)
      SELECT fd.policy_id, fd.account_id FROM policy_folder_documents fd WHERE fd.folder_id=$1 AND fd.account_id=$2 ON CONFLICT DO NOTHING`, [folderId, accountId]);
    const r = await tx.query("DELETE FROM policy_folders WHERE id=$1 AND account_id=$2", [folderId, accountId]);
    if (!r.rowCount) throw new FolderInputError("That policy is not in this household.");
  });
}

let autoReady: Promise<boolean> | null = null;
/** Whether sql/policy-folders-auto.sql is applied: until it is, no folder is made for the household. */
export function autoFoldersReady(): Promise<boolean> {
  autoReady ??= query<{ t: string | null }>("SELECT to_regclass('public.policy_folder_auto')::text AS t")
    .then((r) => !!r.rows[0]?.t).catch(() => false)
    .then((ok) => { if (!ok) autoReady = null; return ok; });
  return autoReady;
}
export function resetAutoFoldersReady() { autoReady = null; }

/** The documents that have had a folder made, or left one: never made into a folder again on their own. */
export async function handledDocuments(accountId: string): Promise<string[]> {
  if (!await foldersReady() || !await autoFoldersReady()) return [];
  const r = await query<{ policy_id: string }>("SELECT policy_id FROM policy_folder_auto WHERE account_id=$1", [accountId]);
  return r.rows.map((x) => String(x.policy_id));
}

export type AutoFolderInput = { scheduleId: string; people: string[]; documents: FolderDocumentInput[] };
/** Makes the folders the page worked out from the household's documents (lib/policies/folder-view.ts policyStarters), each
 * not complete, so the household checks and confirms it. A schedule that already had its folder made, or left one, is
 * skipped, so two open pages make one folder and a deleted folder is never made again. Returns how many were made. */
export async function makeAutoFolders(accountId: string, starters: AutoFolderInput[]): Promise<number> {
  if (!await foldersReady() || !await autoFoldersReady()) throw new FoldersNotReadyError("Policy folders are not switched on yet.");
  let made = 0;
  for (const s of starters) {
    const people = unique(s.people), docs = [...new Map(s.documents.map((d) => [d.policyId, d])).values()];
    if (!people.length || !docs.some((d) => d.policyId === s.scheduleId)) throw new FolderInputError("A policy needs its schedule and who it is for.");
    made += await inTransaction(async (tx) => {
      await checkPeople(tx, accountId, people);
      await checkDocuments(tx, accountId, docs.map((d) => d.policyId));
      const first = await tx.query("INSERT INTO policy_folder_auto(policy_id, account_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING policy_id", [s.scheduleId, accountId]);
      if (!first.rows.length) return 0;
      // The schedule is in no folder now (a folder made by hand since the page loaded keeps it).
      const filed = await tx.query("SELECT 1 FROM policy_folder_documents WHERE account_id=$1 AND policy_id=$2 LIMIT 1", [accountId, s.scheduleId]);
      if (filed.rows.length) return 0;
      for (const d of docs) await tx.query("INSERT INTO policy_folder_auto(policy_id, account_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [d.policyId, accountId]);
      const created = await tx.query("INSERT INTO policy_folders(account_id) VALUES($1) RETURNING id", [accountId]);
      const id = String(created.rows[0].id);
      for (const p of people) await tx.query("INSERT INTO policy_folder_people(folder_id, account_id, family_member_id) VALUES($1,$2,$3)", [id, accountId, p]);
      await addDocuments(tx, accountId, id, docs);
      return 1;
    });
  }
  return made;
}

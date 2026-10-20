/** The simple baseline's whole view of a household: every active document's stored page text, with the
 * document's name, type, role, dates and the people it is linked to. Nothing else -- no benefit records, no
 * search index, no verification layer. This is the "upload, read, answer from the pages" design DC asked about,
 * built only to be compared against the current pipeline (scripts/simple-answer/compare.ts).
 *
 * Household isolation: every query filters on account_id, and loadHouseholdFromDb re-checks each returned row's
 * account_id in code before it reaches a prompt. The database is opened read-only. */
import { readFileSync } from "node:fs";

export type HouseholdPage = { page: number; text: string };
export type HouseholdDocument = {
  policyId: string;
  name: string;
  insurer: string | null;
  productName: string | null;
  policyNumber: string | null;
  documentType: string | null;
  documentRole: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  uploadedAt: string | null;
  uploadedFor: string | null;
  linkedPeople: string[];
  supersededAt: string | null;
  /** The app's reading status, e.g. "ready" or "failed". */
  processingStatus?: string | null;
  pages: HouseholdPage[];
};
export type Household = {
  accountId: string;
  members: { name: string; relationship: string }[];
  documents: HouseholdDocument[];
};

/** A household snapshot written earlier (or a synthetic fixture). The file must name the household it holds. */
export function loadHouseholdFromFile(path: string, expectedAccountId?: string): Household {
  const household = JSON.parse(readFileSync(path, "utf8")) as Household;
  if (!household?.accountId || !Array.isArray(household.documents)) throw new Error(`${path} is not a household snapshot`);
  if (expectedAccountId && household.accountId !== expectedAccountId)
    throw new Error(`${path} holds household ${household.accountId}, not ${expectedAccountId}`);
  return household;
}

type Row = Record<string, unknown>;
export type ReadOnlyQuery = (sql: string, params: unknown[]) => Promise<Row[]>;

const text = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** Builds a Household from four account-scoped reads. `run` is injected so tests can supply a fake database. */
export async function readHousehold(accountId: string, run: ReadOnlyQuery): Promise<Household> {
  const members = await run(
    "SELECT account_id, display_name, relationship FROM family_members WHERE account_id=$1 AND lifecycle_state='active' ORDER BY created_at",
    [accountId]);
  const docs = await run(
    `SELECT p.account_id, p.id, p.original_filename, p.insurer, p.product_name, p.policy_number, p.policy_type, p.document_role,
            p.effective_date, p.renewal_or_expiry_date, p.created_at, p.superseded_at, p.processing_status, f.display_name AS uploaded_for
       FROM policies p LEFT JOIN family_members f ON f.id=p.family_member_id AND f.account_id=p.account_id
      WHERE p.account_id=$1 AND p.lifecycle_state='active' ORDER BY p.created_at`,
    [accountId]);
  const ids = docs.map((d) => String(d.id));
  const links = ids.length ? await run(
    `SELECT pm.account_id, pm.policy_id, f.display_name FROM policy_members pm
       JOIN family_members f ON f.id=pm.family_member_id AND f.account_id=pm.account_id AND f.lifecycle_state='active'
      WHERE pm.account_id=$1 AND pm.policy_id = ANY($2::uuid[])`,
    [accountId, ids]) : [];
  const pages = ids.length ? await run(
    "SELECT account_id, policy_id, page_number, text FROM policy_pages WHERE account_id=$1 AND policy_id = ANY($2::uuid[]) ORDER BY policy_id, page_number",
    [accountId, ids]) : [];
  for (const row of [...members, ...docs, ...links, ...pages])
    if (String(row.account_id) !== accountId) throw new Error("A row from another household was returned; refusing to build a prompt");
  return {
    accountId,
    members: members.map((m) => ({ name: String(m.display_name), relationship: String(m.relationship) })),
    documents: docs.map((d) => ({
      policyId: String(d.id),
      name: String(d.original_filename),
      insurer: text(d.insurer), productName: text(d.product_name), policyNumber: text(d.policy_number),
      documentType: text(d.policy_type), documentRole: text(d.document_role),
      effectiveDate: text(d.effective_date), expiryDate: text(d.renewal_or_expiry_date),
      uploadedAt: text(d.created_at), uploadedFor: text(d.uploaded_for), supersededAt: text(d.superseded_at), processingStatus: text(d.processing_status),
      linkedPeople: [...new Set(links.filter((l) => String(l.policy_id) === String(d.id)).map((l) => String(l.display_name)))],
      pages: pages.filter((p) => String(p.policy_id) === String(d.id)).map((p) => ({ page: Number(p.page_number), text: String(p.text) })),
    })),
  };
}

/** Reads one household from DATABASE_URL inside a READ ONLY transaction (lib/db/client's pool and TLS rules). */
export async function loadHouseholdFromDb(accountId: string): Promise<Household> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error("accountId must be a household uuid");
  const { pool } = await import("../../lib/db/client");
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const household = await readHousehold(accountId, async (sql, params) => (await client.query(sql, params)).rows);
    await client.query("ROLLBACK");
    return household;
  } finally {
    client.release();
    await pool.end();
  }
}

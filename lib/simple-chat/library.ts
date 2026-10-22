/** The simple chat's whole view of a household: every active document's stored page text, with the document's name,
 * type, role, dates and the people it is linked to. No benefit records, no search index. Shared by the in-app simple
 * chat (lib/simple-chat/hook.ts) and the comparison script (scripts/simple-answer).
 *
 * Household isolation: every query filters on account_id, and readHousehold re-checks each returned row's account_id
 * in code before anything reaches a prompt. */

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

type Row = Record<string, unknown>;
export type ReadOnlyQuery = (sql: string, params: unknown[]) => Promise<Row[]>;

const text = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** Builds a Household from four account-scoped reads. `run` is injected so tests can supply a fake database.
 * `notExcluded` is lib/policies/member-exclusions' clause for (pm.account_id, pm.policy_id, pm.family_member_id), so a
 * person the household removed from a document is not listed as linked to it. */
export async function readHousehold(accountId: string, run: ReadOnlyQuery, notExcluded = ""): Promise<Household> {
  const members = await run(
    "SELECT account_id, display_name, preferred_name, relationship FROM family_members WHERE account_id=$1 AND lifecycle_state='active' ORDER BY created_at",
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
      WHERE pm.account_id=$1 AND pm.policy_id = ANY($2::uuid[])${notExcluded}`,
    [accountId, ids]) : [];
  const pages = ids.length ? await run(
    "SELECT account_id, policy_id, page_number, text FROM policy_pages WHERE account_id=$1 AND policy_id = ANY($2::uuid[]) ORDER BY policy_id, page_number",
    [accountId, ids]) : [];
  for (const row of [...members, ...docs, ...links, ...pages])
    if (String(row.account_id) !== accountId) throw new Error("A row from another household was returned; refusing to build a prompt");
  return {
    accountId,
    members: members.map((m) => ({
      name: m.preferred_name && m.preferred_name !== m.display_name ? `${m.display_name} (${m.preferred_name})` : String(m.display_name),
      relationship: String(m.relationship),
    })),
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

/** The signed-in household's library, read through the app's database pool. */
export async function loadHousehold(accountId: string): Promise<Household> {
  const { query } = await import("@/lib/db/client");
  const { notExcludedClause } = await import("@/lib/policies/member-exclusions");
  const notExcluded = await notExcludedClause("pm.account_id", "pm.policy_id", "pm.family_member_id");
  return readHousehold(accountId, async (sql, params) => (await query(sql, params)).rows, notExcluded);
}

/** Uploaded text is data: < and > are escaped so a page cannot close or open a document tag (R36-4). */
export const escapeText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (name: string, value: string | null | undefined) => (value ? ` ${name}="${escapeText(value.replace(/"/g, "'"))}"` : "");

/** Documents are numbered D1, D2, ... in library order; the model cites them by that id. */
export const documentId = (index: number) => `D${index + 1}`;

/** Said for every document, so the model can tell "linked to nobody" from "not said" (release-set E1, E3). */
export const LINKED_TO_NOBODY = "nobody (not linked to anyone in DearPolicy)";
export const NOT_READABLE = "could not be read";
/** Whether the app failed to read (or has not finished reading) this file; its text is not sent or quoted. */
export const unreadable = (doc: HouseholdDocument) => !!doc.processingStatus && doc.processingStatus !== "ready";

export function renderDocument(doc: HouseholdDocument, index: number, pagesSent?: Set<string>): string {
  const head = `<document id="${documentId(index)}" name="${escapeText(doc.name.replace(/"/g, "'"))}"` +
    attr("insurer", doc.insurer) + attr("product", doc.productName) + attr("policy_number", doc.policyNumber) +
    attr("type", doc.documentType) + attr("role", doc.documentRole) + attr("effective", doc.effectiveDate) +
    attr("expiry_or_renewal", doc.expiryDate) + attr("uploaded", doc.uploadedAt) + attr("uploaded_for", doc.uploadedFor) +
    attr("linked_people", doc.linkedPeople.length ? doc.linkedPeople.join(", ") : LINKED_TO_NOBODY) + attr("superseded", doc.supersededAt) +
    (unreadable(doc) ? attr("reading_status", `${NOT_READABLE} (${doc.processingStatus})`) : "") + ">";
  // A file the app could not read is sent without its text: partial text read as the document misleads (release-set E1).
  const sent = pagesSent ? doc.pages.filter((p) => pagesSent.has(`${doc.policyId}#${p.page}`)) : doc.pages;
  const pages = unreadable(doc) || !doc.pages.length ? "<no_readable_text/>"
    : [...sent.map((p) => `<page n="${p.page}">\n${escapeText(p.text)}\n</page>`),
      ...(sent.length < doc.pages.length ? [`<pages_not_sent count="${doc.pages.length - sent.length}" of="${doc.pages.length}"/>`] : [])].join("\n");
  return `${head}\n${pages}\n</document>`;
}

/** pagesSent: with the benefit table, only the pages its rows cite and those documents' rule pages are sent (keys
 * `${policyId}#${page}`, pagesToSend in lib/benefit-table/chat.ts), about half the whole library; every document's details
 * are still sent. */
export function renderLibrary(household: Household, pagesSent?: Set<string>): string {
  const people = household.members.map((m) => `${m.name} (${m.relationship})`).join(", ") || "none recorded";
  const note = pagesSent ? `\n<pages_note>${PAGES_NOTE}</pages_note>` : "";
  return `<household_members>${escapeText(people)}</household_members>${note}\n<documents>\n${household.documents.map((d, i) => renderDocument(d, i, pagesSent)).join("\n")}\n</documents>`;
}
export const PAGES_NOTE = "Only the pages the benefit table's rows come from, and those documents' pages that print a waiting period, an exclusion or a rule on when a benefit is not paid, are sent below; each document's other pages are left out, though the app has read them. Before giving an amount, check those rule pages for the event asked about. When the pages sent do not say something, say that the pages shown here do not say it (never that the document does not), and that the full document is on the Documents page.";

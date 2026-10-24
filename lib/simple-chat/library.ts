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
/** What the answer is given in place of a page whose table text could not be checked. */
export const UNCHECKED_PAGE = "[This page's table text came out scrambled and could not be checked against the page image, so nothing on it is used. Say its amounts are not shown.]";
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
    "SELECT account_id, policy_id, page_number, text, to_jsonb(pp)->>'extraction_method' AS method FROM policy_pages pp WHERE account_id=$1 AND policy_id = ANY($2::uuid[]) ORDER BY policy_id, page_number",
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
      // A page whose table text could not be checked (lib/documents/layout-check.ts) gives the answer no words to quote.
      pages: pages.filter((p) => String(p.policy_id) === String(d.id)).map((p) => ({ page: Number(p.page_number), text: p.method === "unchecked" ? UNCHECKED_PAGE : String(p.text) })),
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
/** On a document some of whose pages are not sent: the app read them; never say such a file could not be read (E1, E2). */
export const PAGES_LEFT_OUT = "the app has read these pages; they are left out of this message only";
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
      ...(sent.length < doc.pages.length ? [`<pages_not_sent count="${doc.pages.length - sent.length}" of="${doc.pages.length}" note="${PAGES_LEFT_OUT}"/>`] : [])].join("\n");
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

const MALE_TITLE = /^mr$/i, FEMALE_TITLE = /^(?:mrs|ms|mdm|miss|madam)$/i;
/** Who "my husband" or "my wife" is, when the household settles it: of the two members set up as self and spouse, the one
 * the documents print with that kind of title ("Mr Tan Yi Chuen, Desmond") while the other is never printed with it. A
 * title counts only before all of that member's own name words. Never read from a name itself. Null otherwise
 * (stress run 23 Oct, S048: "my husband" was asked about as "Desmond's or Charmaine's?"). */
export function spouseMeant(household: Household, said: string[]): { word: string; member: string; printed: string } | null {
  const asked = said.map((t) => /\bmy\s+(husband|wife)\b/i.exec(t)?.[1]?.toLowerCase()).find(Boolean);
  if (!asked) return null;
  const couple = household.members.filter((m) => m.relationship === "self" || m.relationship === "spouse");
  if (couple.length !== 2 || new Set(couple.map((m) => m.relationship)).size !== 2) return null;
  const base = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const words = (n: string) => base(n).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2);
  const titles = (m: (typeof couple)[number]) => {
    const own = new Set(words(m.name));
    const out: { title: string; printed: string }[] = [];
    for (const d of household.documents) for (const p of d.pages)
      for (const x of p.text.matchAll(/\b(Mr|Mrs|Ms|Mdm|Miss|Madam)\.?(?=((?:[\s,]+[A-Za-z]+){2,5}))/g)) {
        // The name words right after the title, as far as they are this member's.
        const name = x[2].split(/[\s,]+/).filter(Boolean);
        const n = name.findIndex((w) => !own.has(w.toLowerCase()));
        const kept = n < 0 ? name.length : n;
        // Every word of the member's own name, so a relative who shares two of them ("Mr Lim Hui Jun") never counts (TE S3).
        if (kept >= 2 && [...own].every((w) => name.slice(0, kept).some((k) => k.toLowerCase() === w))) out.push({ title: x[1], printed: `${x[1]} ${name.slice(0, kept).join(" ")}` });
      }
    return out;
  };
  const want = asked === "husband" ? MALE_TITLE : FEMALE_TITLE;
  const other = asked === "husband" ? FEMALE_TITLE : MALE_TITLE;
  // A member also printed with the other kind of title ("Mrs Tan Yi Chuen", a wife under her husband's name) settles nothing.
  const fits = couple.map((m) => ({ m, all: titles(m) })).map(({ m, all }) => ({ m, hits: all.some((t) => other.test(t.title)) ? [] : all.filter((t) => want.test(t.title)) }));
  const yes = fits.filter((f) => f.hits.length);
  return yes.length === 1 ? { word: `my ${asked}`, member: base(yes[0].m.name), printed: yes[0].hits[0].printed } : null;
}

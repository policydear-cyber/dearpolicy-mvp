/** The simple chat's whole view of a household: every active document's stored page text, with the document's name,
 * type, role, dates and the people it is linked to. No benefit records, no search index. Shared by the in-app simple
 * chat (lib/simple-chat/hook.ts) and the comparison script (scripts/simple-answer).
 *
 * Household isolation: every query filters on account_id, and readHousehold re-checks each returned row's account_id
 * in code before anything reaches a prompt. */
import { uncheckedText } from "@/lib/documents/layout-check";
export { UNCHECKED_PAGE, uncheckedText } from "@/lib/documents/layout-check";

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
  /** Pages the upload check could not check against the page image: no amount on them is used. */
  uncheckedPages?: number[];
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
      uncheckedPages: pages.filter((p) => String(p.policy_id) === String(d.id) && p.method === "unchecked").map((p) => Number(p.page_number)),
      // A page whose table text could not be checked (lib/documents/layout-check.ts) gives the answer no words to quote.
      pages: pages.filter((p) => String(p.policy_id) === String(d.id)).map((p) => ({ page: Number(p.page_number), text: p.method === "unchecked" ? uncheckedText(String(p.text)) : String(p.text) })),
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

/** "page 3", "pages 3 and 4", "pages 2, 3 and 4". */
export const pageList = (pages: number[]) => pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
/** Said for a document with unchecked pages whichever of its pages are sent, so the answer never calls it fully read
 * (live 32fa444 E2: PruLink's unchecked pages were not sent, so the chat never saw the notice). */
export const readInPart = (doc: HouseholdDocument) => doc.uncheckedPages?.length && !unreadable(doc)
  ? `read in part: ${pageList(doc.uncheckedPages)} could not be checked against the page image; no amount from ${doc.uncheckedPages.length === 1 ? "it" : "them"} is used` : null;

export function renderDocument(doc: HouseholdDocument, index: number, pagesSent?: Set<string>): string {
  const head = `<document id="${documentId(index)}" name="${escapeText(doc.name.replace(/"/g, "'"))}"` +
    attr("insurer", doc.insurer) + attr("product", doc.productName) + attr("policy_number", doc.policyNumber) +
    attr("type", doc.documentType) + attr("role", doc.documentRole) + attr("effective", doc.effectiveDate) +
    attr("expiry_or_renewal", doc.expiryDate) + attr("uploaded", doc.uploadedAt) + attr("uploaded_for", doc.uploadedFor) +
    attr("linked_people", doc.linkedPeople.length ? doc.linkedPeople.join(", ") : LINKED_TO_NOBODY) + attr("superseded", doc.supersededAt) +
    (unreadable(doc) ? attr("reading_status", `${NOT_READABLE} (${doc.processingStatus})`) : attr("reading_status", readInPart(doc))) + ">";
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

// A possessive is the spouse's own ("my husband's policy") unless the next word makes it someone else (TE P117-2).
// The next word is looked at, not taken, so "my husband's first wife" is not read past (Critic R190-3).
const SPOUSE_WORD = /(?:^|[^\w'’-])(?:([\w'’-]+)\s+)?(husband|hubby|wifey|wife)(['’]s)?(?![\w'’-])(?=(?:\s+([\w'’-]+))?)/gi;
// After a possessive, only the spouse's own cover counts: an allow-list, since relatives and helpers are never a complete
// list (Critic R190-2). No insurer or product is named here: the household's own documents add theirs ("my husband's
// Manulife", "my wife's PRUShield"), so any household, with any insurer anywhere, is read the same way.
const HIS_OR_HERS = /^(?:policy|policies|plan|plans|cover|coverage|claim|claims|insurance|insurances|rider|riders|shield|card|benefits?|premiums?|documents?|certificate|schedule|ilp|endowment|annuity|hospital|medical|health|life|ci|tpd|own|bill|bills)$/i;
/** The household's own insurers and products, each as its words: a product by its whole name ("carefirst health"), an
 * insurer by its own name, without the words that only say what it is or where ("Zurich Life Insurance Company Ltd" is
 * "zurich", "Friends Provident International" is "friends provident", "AIA Singapore Private Limited" is "aia"). An own
 * name that would be one ordinary word for a person keeps its next word ("Family Life Insurance" is "family life"). */
const ownCover = (household: Household) => ({
  insurers: household.documents.map((d) => insurerCore(d.insurer ?? "")).filter((p) => p.length),
  products: household.documents.map((d) => words(d.productName ?? "")).filter((p) => p.length),
});
const words = (n: string) => n.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const NOT_OWN_NAME = /^(?:ltd|limited|pte|pvt|private|sdn|bhd|berhad|pty|gmbh|plc|inc|incorporated|llc|co|company|corp|corporation|sa|ag|nv|se|the|insurance|insurer|assurance|reinsurance|general|life|international|group|holdings|financial|services|singapore|malaysia|hong|kong|asia|pacific|uk|usa|us|india|indonesia|philippines|thailand|vietnam|china|australia|canada|europe)$/;
const personWord = (w: string) => NOT_THEM_AFTER.test(w) || NOT_THEM_AFTER.test(w.replace(/s$/, ""));
function insurerCore(name: string): string[] {
  const all = words(name), own = all.filter((w) => !NOT_OWN_NAME.test(w));
  if (own.length !== 1 || !personWord(own[0])) return own.length ? own : all;
  const at = all.indexOf(own[0]);
  return all.slice(at, at + 2);
}
/** After a possessive, the household's own cover: a whole product name or an insurer's own name, then the clause's end or
 * a cover word ("my wife's Family Care Plan claim", "hubby's Zurich", "my husband's AXA policy"). No single word of a
 * name counts on its own: names are ordinary English ("Domestic Helper Insurance", "Friends Provident"), so "my wife's
 * domestic helper" is about the helper, "my husband's friends medical bills" about his friends (Critic R207-1, TE P117-4
 * to P117-7). */
function coverAfter(rest: string, cover: { insurers: string[][]; products: string[][] }): boolean {
  const said = words(rest.match(/^[^.,;:!?()]*/)?.[0] ?? "");
  // A word for a person right after the possessive is about that person, whatever cover shares the word ("my wife's
  // family medical history" with a product named "Family", TE P117-8). A name that starts with one asks who is meant.
  if (said[0] && (personWord(said[0]) || /^partners?$/.test(said[0]))) return false;
  const then = (n: number) => said.length === n || HIS_OR_HERS.test(said[n]);
  return [...cover.insurers, ...cover.products].some((p) => p.every((w, i) => said[i] === w) && then(p.length));
}
// Only the person's own spouse: the word opens the message or a clause, or follows "my" or a clause word. Any other word
// before it ("sis", "client", "kakak", "her") may make it someone else's, so it is not resolved: an allow-list, since a
// list of other people's words is never complete (Critic R184-1).
const MINE_BEFORE = /^(?:my|me|mine|if|when|and|but|so|cos|coz|because|then|lah|ah|eh|wah|hi|hello|pls|please)$/i;
// "husband of my colleague", "husband mother", "husband side": about someone else.
const NOT_THEM_AFTER = /^(?:of|mother|mum|mom|mummy|mommy|ma|father|dad|daddy|papa|pa|mama|brother|bro|sister|sis|son|daughter|child|kid|grand\w*|side|family|parents?|in-laws?|boss|friend|colleague|cousin|ex)$/i;
/** The first "husband" or "wife" in a message that means the person's own spouse: "my husband", or the word alone as people
 * type it ("husband kena fracture leg", "hubby got cancer"; overnight run 23 Oct, N224, N226). Never someone else's
 * ("her husband", "my sis husband", "husband of my colleague"), a possessive about someone else ("my husband's mum": the
 * question is not about him), or "husband and wife" (a pair, not a person). */
function spouseSaid(text: string, cover = { insurers: [] as string[][], products: [] as string[][] }): { kind: "husband" | "wife"; word: string } | null {
  if (/\b(?:husband|wife)\s*(?:and|or|&|\/|-and-)\s*(?:husband|wife)\b/i.test(text)) return null;
  for (const x of text.matchAll(SPOUSE_WORD)) {
    if (x[1] && !MINE_BEFORE.test(x[1])) continue;
    if (x[3] ? x[4] && !HIS_OR_HERS.test(x[4]) && !coverAfter(text.slice(x.index! + x[0].length), cover) : x[4] && NOT_THEM_AFTER.test(x[4])) continue;
    const word = x[2].toLowerCase();
    return { kind: /^h/.test(word) ? "husband" : "wife", word: x[1]?.toLowerCase() === "my" ? `my ${word}` : word };
  }
  return null;
}

const MALE_TITLE = /^mr$/i, FEMALE_TITLE = /^(?:mrs|ms|mdm|miss|madam)$/i;
/** Who "my husband" or "my wife" is, when the household settles it: of the two members set up as self and spouse, the one
 * the documents print with that kind of title ("Mr Lim Ah Kow") while the other is never printed with it. A
 * title counts only before all of that member's own name words. Never read from a name itself. Null otherwise
 * (stress run 23 Oct, S048: "my husband" was asked about as "which of you two?"). Nothing here knows any household: it reads
 * the relationships each household sets for its members and the titles its own documents print, and asks when they do not
 * settle it. */
export function spouseMeant(household: Household, said: string[]): { word: string; member: string; printed: string } | null {
  const cover = ownCover(household);
  const heard = said.map((t) => spouseSaid(t, cover)).find(Boolean);
  if (!heard) return null;
  const asked = heard.kind;
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
  // A member also printed with the other kind of title ("Mrs Lim Wei Ming", a wife under her husband's name) settles nothing.
  const fits = couple.map((m) => ({ m, all: titles(m) })).map(({ m, all }) => ({ m, hits: all.some((t) => other.test(t.title)) ? [] : all.filter((t) => want.test(t.title)) }));
  const yes = fits.filter((f) => f.hits.length);
  return yes.length === 1 ? { word: heard.word, member: base(yes[0].m.name), printed: yes[0].hits[0].printed } : null;
}

/** The benefit table in the app: reading a document into `benefit_readings`, linking the household's benefit sections to
 * covers, the household's links and confirmations, and each person's table. The database and the model are passed in,
 * so tests run with fakes; the routes and lib/rag/ingest.ts pass the real ones.
 *
 * Only the model's reading, the links and the confirmations are stored. Every time a table is shown it is checked again
 * against the stored pages and assembled from scratch (check.ts, completeness.ts, assemble.ts), so a change to the
 * checks, a re-read, a removed document or a removed person shows at once, and no stored row can go stale. */
import { assembleTable, coversOf, sectionsOf, type BenefitTable, type Confirmation, type FamilyMember } from "./assemble";
import { createHash } from "node:crypto";
import { checkReading, type CheckedReading, type SourceDoc } from "./check";
import { mergeReadings, pagesToReread } from "./completeness";
import type { TableModel, TableReply } from "./model";
import { NON_COVER_ROLES, NO_COVER_READING_ROLES, correspondenceRole, schedulePage } from "@/lib/documents/messy";
import { policyJobLive, scanJobLive } from "@/lib/rag/live-job";
import { findFamilyMatchWithKind } from "@/lib/policies/linking";
import { isPolicyQuarantineHeld, policyQuarantineLabel } from "@/lib/policies/quarantine/ui";
import { LINKING_PROMPT, LINKING_SCHEMA, READING_PROMPT, READING_SCHEMA, pageReadingNote, partReadingNote, renderDocument, renderLinkingInput, type SectionLink } from "./reading";

export const PROMPT_VERSION = "2026-10-21.3";
export const READ_MAX_OUTPUT = 24_000;
export const PAGE_MAX_OUTPUT = 8_000;
export const LINK_MAX_OUTPUT = 8_000;
/** At most this many pages of one document are read again on their own. */
export const MAX_PAGE_REREADS = 12;
/** A document is read in parts of consecutive pages, each part at most this many characters of page text (a page longer
 * than this is a part on its own). One call over a long document can run out of output before it finishes and give
 * nothing (FWD re-read 5 Nov: 40,651 tokens in, the 24,000-token cap reached, the whole reading lost and paid for). A part
 * this size leaves room for every row of its pages. A document under it is read in one call, as before. */
export const PART_MAX_CHARS = 40_000;

/** Consecutive runs of pages, each at most `limit` characters of text, in page order. */
export function pageParts<T extends { page: number; text: string }>(pages: T[], limit = PART_MAX_CHARS): T[][] {
  const parts: T[][] = [];
  let part: T[] = [], size = 0;
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    if (part.length && size + p.text.length > limit) { parts.push(part); part = []; size = 0; }
    part.push(p); size += p.text.length;
  }
  if (part.length) parts.push(part);
  return parts;
}

type Row = Record<string, unknown>;
export type Db = (sql: string, params: unknown[]) => Promise<Row[]>;
export type StoredReading = { document: unknown; pages: { page: number; json: unknown }[] };
export type OnUsage = (what: string, reply: TableReply) => Promise<void> | void;

/** Once the tables exist they stay: a yes is remembered for this server instance, a no is checked again next time. */
const readyFor = new WeakSet<Db>();
export async function tableReady(db: Db): Promise<boolean> {
  if (readyFor.has(db)) return true;
  const rows = await db("SELECT to_regclass('public.benefit_readings') IS NOT NULL AND to_regclass('public.benefit_links') IS NOT NULL AND to_regclass('public.benefit_confirmations') IS NOT NULL AS ok", []);
  if (rows[0]?.ok === true) readyFor.add(db);
  return rows[0]?.ok === true;
}

async function family(db: Db, accountId: string): Promise<FamilyMember[]> {
  return (await db("SELECT id, display_name, preferred_name FROM family_members WHERE account_id=$1 AND lifecycle_state='active' ORDER BY created_at", [accountId]))
    .map((r) => ({ id: String(r.id), display_name: String(r.display_name), preferred_name: r.preferred_name == null ? null : String(r.preferred_name) }));
}

/** Each person's own links to documents, used only to tell apart people with the same name (assemble.ts sharedNameMatch):
 * the documents their record links them to (never a link made only because a scheme's wording matches), and the printed
 * names on a document the household matched to them. */
async function withDocumentLinks(db: Db, accountId: string, people: FamilyMember[]): Promise<FamilyMember[]> {
  if (!people.length) return people;
  // Without these links, people with the same name are shown as undecided (never dropped), so a failed read only loses the tie-break.
  // The household's own corrections (assemble.ts householdRecord): a name it matched by hand (its link is user_declared,
  // as lib/policies/linking.ts householdNameMatches reads it), people it took off a document, names it said are not its
  // family's. A table not created yet (sql/policy-member-exclusions.sql, sql/detected-name-dismissals.sql) has none.
  const [links, printed, excluded, dismissed] = await Promise.all([
    db("SELECT policy_id, family_member_id, source FROM policy_members WHERE account_id=$1 AND source<>'scheme_reference_match'", [accountId]).catch(() => []),
    db("SELECT policy_id, detected_name, matched_family_member_id FROM policy_detected_people WHERE account_id=$1", [accountId]).catch(() => []),
    // Asked only of a table that exists, so a missing one never fails a statement (and its transaction).
    db("SELECT to_regclass('public.policy_member_exclusions') IS NOT NULL AS ok", []).then((r) => r[0]?.ok === true
      ? db("SELECT policy_id, family_member_id FROM policy_member_exclusions WHERE account_id=$1", [accountId]) : []).catch(() => []),
    db("SELECT to_regclass('public.policy_name_dismissals') IS NOT NULL AS ok", []).then((r) => r[0]?.ok === true
      ? db("SELECT policy_id, detected_name FROM policy_name_dismissals WHERE account_id=$1", [accountId]) : []).catch(() => []),
  ]);
  // The household's word on who a printed name is: a name it matched by hand (user_declared), or the one printed name of a
  // personal document that matched nobody, linked to the profile the household uploaded it to (upload_hint; lib/rag/ingest.ts
  // writes it only then, flagged "Named in it: … Change"). Home and Family count that link (policy_members), so Coverage
  // does too: one rule for both (TE real-model run, 4 Nov: Home said covered, Coverage "Not in your family").
  // An upload_hint counts only while the printed name still matches no active person by name: once someone is added or
  // renamed so the name is theirs, the old upload choice must never hand that person's cover to the upload profile.
  const byHand = new Set(links.filter((l) => l.source === "user_declared").map((l) => `${l.policy_id}|${l.family_member_id}`));
  const byUpload = new Set(links.filter((l) => l.source === "upload_hint").map((l) => `${l.policy_id}|${l.family_member_id}`));
  const nobodyByName = (name: string) => !people.some((q) => findFamilyMatchWithKind(name, [q]));
  const chosen = (d: Record<string, unknown>, id: string) => byHand.has(`${d.policy_id}|${id}`)
    || (byUpload.has(`${d.policy_id}|${id}`) && nobodyByName(String(d.detected_name)));
  const notThem = dismissed.map((d) => ({ documentId: String(d.policy_id), name: String(d.detected_name) }));
  const namedOn = printed.map((d) => ({ documentId: String(d.policy_id), name: String(d.detected_name) }));
  return people.map((p) => ({ ...p,
    documents: links.filter((l) => String(l.family_member_id) === p.id).map((l) => String(l.policy_id)),
    printedAs: printed.filter((d) => String(d.matched_family_member_id) === p.id).map((d) => ({ documentId: String(d.policy_id), name: String(d.detected_name) })),
    chosenAs: printed.filter((d) => String(d.matched_family_member_id) === p.id && chosen(d, p.id)).map((d) => ({ documentId: String(d.policy_id), name: String(d.detected_name) })),
    excludedFrom: excluded.filter((x) => String(x.family_member_id) === p.id).map((x) => String(x.policy_id)),
    notThem, namedOn }));
}

/** What a document's own record says about it, for naming it to the household (lib/policies/inventory.ts documentName)
 * and for telling whether the table will ever read it. */
export type DocumentFile = { original_filename: string; product_name: string | null; insurer: string | null; document_role: string | null;
  policy_number: string | null; quarantine: string | null; scan_detail?: string | null };
/** `live`: a live intake job is reading the document now (lib/rag/live-job.ts, the Documents page's own rule).
 * `scanLive`: a live automatic malware-scan retry is checking it (lib/rag/live-job.ts scanJobLive). */
type HouseholdDoc = SourceDoc & { status: string; live: boolean; scanLive: boolean; file: DocumentFile };

/** The household's current documents (not deleted, not superseded) with their stored pages. */
async function documents(db: Db, accountId: string, policyId?: string, pick?: (docs: HouseholdDoc[]) => Promise<HouseholdDoc[]>): Promise<HouseholdDoc[]> {
  const docs = await db(`SELECT id, original_filename, processing_status, product_name, insurer, document_role, policy_number, quarantine_status, scan_result_detail,
      ${policyJobLive("policies")} AS reading_live, ${scanJobLive("policies")} AS scan_live FROM policies
    WHERE account_id=$1 AND lifecycle_state='active' AND superseded_at IS NULL${policyId ? " AND id=$2" : ""} ORDER BY created_at`, policyId ? [accountId, policyId] : [accountId]);
  if (!docs.length) return [];
  const people = (await family(db, accountId)).map((m) => m.display_name);
  const shaped = docs.map((d) => ({
    id: String(d.id), name: String(d.original_filename), status: String(d.processing_status ?? ""), readable: d.processing_status === "ready", live: d.reading_live === true, scanLive: d.scan_live === true,
    pages: [] as { page: number; text: string }[], people,
    file: { original_filename: String(d.original_filename), product_name: text(d.product_name), insurer: text(d.insurer), document_role: text(d.document_role),
      policy_number: text(d.policy_number), quarantine: text(d.quarantine_status), scan_detail: text(d.scan_result_detail) },
  }));
  // Without a choice, every document's pages; otherwise only the ones it asks for (load(): pages already checked are not
  // fetched again).
  const want = pick ? await pick(shaped) : shaped;
  if (want.length) {
    const pages = await db(`SELECT policy_id, page_number, text FROM policy_pages pp WHERE account_id=$1 AND policy_id = ANY($2::uuid[]) AND ${CHECKED_PAGE} ORDER BY policy_id, page_number`,
      [accountId, want.map((d) => d.id)]);
    const byDoc = new Map<string, { page: number; text: string }[]>();
    for (const p of pages) { const id = String(p.policy_id); if (!byDoc.has(id)) byDoc.set(id, []); byDoc.get(id)!.push({ page: Number(p.page_number), text: String(p.text ?? "") }); }
    for (const d of want) d.pages = byDoc.get(d.id) ?? [];
  }
  return shaped;
}
// Only pages whose words are the page's own are searched (an allow-list of how a page was read, lib/rag/ingest.ts): read
// natively or by OCR, checked line by line ("part_checked" keeps only its confirmed figures), or stored before methods
// were recorded. A page whose table text could not be checked ("unchecked", lib/documents/layout-check.ts), one that
// could not be read at all ("unreadable": whatever a reader made of it), or any method added later is not read into
// the table and no row's quote is found on it (Critic #327 L3). Read time only: no stored reading is re-read.
export const TABLE_PAGE_METHODS = ["", "native", "ocr", "part_checked"] as const;
const CHECKED_PAGE = `coalesce(to_jsonb(pp)->>'extraction_method', '') IN (${TABLE_PAGE_METHODS.map((m) => `'${m}'`).join(", ")})`;
/** pagesPrint in the database, for each document: its checked pages' count and fingerprint, without sending their text. */
const PAGES_PRINT_SQL = `SELECT policy_id, count(*)::int AS pages,
    md5(string_agg(page_number::text || ':' || md5(coalesce(text, '')), ',' ORDER BY page_number)) AS print
  FROM policy_pages pp WHERE account_id=$1 AND policy_id = ANY($2::uuid[]) AND ${CHECKED_PAGE} GROUP BY policy_id`;
const text = (v: unknown) => (v == null ? null : String(v));

/** Statuses of a document intake is still working on (lib/rag/ingest.ts); Read again puts a document back to "queued". */
const IN_INTAKE = new Set(["uploaded", "queued", "extracting", "indexing"]);
/** Upload scan states from which intake goes on (allow-list): a rejected or blank upload stays "queued" for good and is
 * not being read. */
export const SCAN_GOES_ON = new Set(["uploaded", "quarantined", "scan_pending", "scan_clean", "not_scanned_prototype"]);
/** Personal proof of cover (allow-list): a schedule or certificate naming the household's own cover. Intake reads it into
 * the table, so a reading that was not stored can be made again; every other role keeps "no_table". */
const PERSONAL_PROOF_ROLES = new Set(["personal_schedule", "certificate"]);
/** Scan states Read again accepts (app/api/policies/reprocess/route.ts); any other is refused there. */
const READ_AGAIN_SCAN = new Set(["scan_clean", "not_scanned_prototype"]);
export type DocumentState = "read" | "waiting" | "stalled" | "held" | "table_unread" | "no_table" | "not_readable";

/** Where a document stands in the table. "waiting" only while it is genuinely being read: a live intake job is reading it
 * (lib/rag/live-job.ts, the rule the Documents page uses), whether still in intake or ready and being read into the table
 * by that same job. In intake with no live job (the job died, its lease lapsed, or nothing claimed it) it is "stalled":
 * the Documents page offers Try again, and it is never said to be still being read. A receipt or letter (which intake
 * never reads into the table), and a ready document whose reading was not stored and that no job is reading, are
 * "no_table": nothing will read them by itself, so they are never shown as unread or sent to Read again (nor as having no
 * benefits: it may have some). A document the app could not read (failed, or an upload the scan rejected) stays
 * "not_readable".
 * An upload on hold for its malware scan (uploaded/quarantined/scan_pending, the Documents page's hold) waits on the scan,
 * not on an intake job: "waiting" while a live intake job or automatic scan retry is checking it, otherwise "held" (as the
 * Documents page shows it: on hold, no Try again, which the reprocess route refuses until the scan is clean). Never
 * "stalled".
 * A ready schedule or certificate (PERSONAL_PROOF_ROLES) with pages, no stored reading and no live job is "table_unread":
 * the household's own proof of cover, whose benefits were not read in; Read again on the Documents page (which reads it
 * into the table) is offered only when its scan state lets Read again run. So is a document filed as a letter, bill or
 * note (`misfiled`, see filedBeforeRoleRules) that encloses its own policy schedule page: it was filed before the rules
 * that look past a cover letter, so its cover was never read. */
export function documentState(d: { status: string; pages: number; live: boolean; scanLive?: boolean; misfiled?: boolean; file: Pick<DocumentFile, "document_role" | "quarantine"> }, hasReading: boolean): DocumentState {
  const quarantine = d.file.quarantine ?? "";
  if (IN_INTAKE.has(d.status)) {
    if (!SCAN_GOES_ON.has(quarantine)) return "not_readable";
    if (d.live === true) return "waiting";
    if (isPolicyQuarantineHeld({ quarantine_status: quarantine, scan_result_detail: null })) return d.scanLive === true ? "waiting" : "held";
    return "stalled";
  }
  if (d.status !== "ready") return "not_readable";
  // A stored reading with no page the table reads (every page unreadable or unchecked, lib/benefit-table/service.ts
  // CHECKED_PAGE) gives no row: it is not "read", which showed it as read with nothing in it (TE #328). It follows the
  // rules below, where a document with no pages is not readable.
  if (hasReading && d.pages) return "read";
  if (NO_COVER_READING_ROLES.includes(d.file.document_role ?? "")) {
    if (!d.misfiled || !d.pages || !NON_COVER_ROLES.has(d.file.document_role ?? "")) return "no_table";
    if (d.live === true) return "waiting";
    return READ_AGAIN_SCAN.has(quarantine) ? "table_unread" : "no_table";
  }
  if (!d.pages) return "not_readable";
  if (d.live === true) return "waiting";
  return PERSONAL_PROOF_ROLES.has(d.file.document_role ?? "") && READ_AGAIN_SCAN.has(quarantine) ? "table_unread" : "no_table";
}

/** A document stored as a letter, bill, screenshot or note that encloses its own policy schedule page: a policy pack
 * whose cover letter came first, filed before the rules that look past the letter (lib/documents/messy.ts
 * correspondenceRole). Its cover was never read, and chat leaves letters out, so it needs reading again. Only the
 * enclosed-page rule decides (schedulePage: a "Policy Schedule" title among a page's first lines, a real printed policy
 * number and a named person on that page), never a keyword: a lapse notice, a claim letter or a bill that mentions "your
 * policy schedule" stays what it is (Critic R327 H1). Payment roles (receipts, statements) are never re-filed this way. */
export function filedBeforeRoleRules(role: string | null, pages: { page: number; text: string }[]): boolean {
  // A screenshot is never a pack, whatever its later screens show.
  if (!NON_COVER_ROLES.has(role ?? "") || role === "app_screenshot" || !pages.length) return false;
  // The schedule page follows the cover (never the first page): what was filed is the letter around it.
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const at = schedulePage(sorted.map((p) => ({ pageNumber: p.page, text: p.text })));
  if (at == null || at <= sorted[0].page) return false;
  // Offer Read again only where it changes something: if today's rules would file the same pages as correspondence
  // again (a schedule past page 6, a claim decision that encloses one), every click would be another paid read (Critic R328 M1).
  return correspondenceRole(sorted.map((p) => ({ text: p.text }))) == null;
}

/** Why a "held" document is on hold, in the Documents page's own words (lib/policies/quarantine/ui.ts, fixed strings,
 * never the stored scanner text). None in the prototype mode, where the page uses no malware-scan language. */
export function holdReason(file: Pick<DocumentFile, "quarantine" | "scan_detail">, prototype: boolean): string | null {
  return prototype ? null : policyQuarantineLabel({ quarantine_status: file.quarantine ?? "", scan_result_detail: file.scan_detail ?? null });
}

/** A stored reading checked against today's pages, with its page re-reads added. */
export function checkStored(doc: SourceDoc, stored: StoredReading): CheckedReading {
  let reading = checkReading(doc, stored.document);
  for (const p of stored.pages ?? []) reading = mergeReadings(reading, checkReading(doc, p.json));
  return reading;
}

/** A stored reading checked against today's pages, remembered for this server instance: the check is the same for the same
 * reading, pages, names and code, and it is most of the Benefits page's time on a large library. Keyed by a hash of all
 * of them, so a re-read, an edited page or a renamed person checks afresh; a copy is handed out, so nothing a caller
 * changes is remembered. At most 200 documents are kept. */
const checkedCache = new Map<string, CheckedReading>();
/** A document's pages as one fingerprint: each page's number and the md5 of its text, in page order. The same as
 * PAGES_PRINT_SQL computes in the database, so a remembered check can be found without fetching the pages' text. */
export function pagesPrint(pages: { page: number; text: string }[]): string {
  const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
  return md5(pages.map((p) => `${p.page}:${md5(p.text)}`).join(","));
}
const checkKey = (doc: Omit<SourceDoc, "pages">, print: string, stored: StoredReading) =>
  createHash("sha256").update(JSON.stringify([doc.id, doc.name, doc.readable, doc.people ?? null, print, stored])).digest("base64");
export function checkedOnce(doc: SourceDoc, stored: StoredReading): CheckedReading {
  const hash = checkKey(doc, pagesPrint(doc.pages), stored);
  let hit = checkedCache.get(hash);
  if (!hit) {
    hit = checkStored(doc, stored);
    if (checkedCache.size >= 200) checkedCache.clear();
    checkedCache.set(hash, hit);
  }
  return structuredClone(hit);
}

/** Reads one document into the table: the document once, in parts of consecutive pages when it is long (pageParts), then
 * each page whose figures were mostly left unread.
 * - Each part after the first is also shown the previous part's last page, for context only (its rows are not taken
 *   from this part), and the section and plan-column headings found so far, so a table whose header is on the page
 *   before is still read under its columns (Critic R364 H1). The check drops a row that prints a figure for each plan
 *   with no column (check.ts), whatever the reader does.
 * - A part that runs out of output is read again as two halves, down to a single page, and every part still to come
 *   is made smaller too. At most 2 x the first count of parts + 4 calls are made for one document (Critic R364 M2).
 * - The document's own facts are merged across parts: the first kind, product, insurer, plan and period any part
 *   gives, and every named person (TE pr364).
 * The earlier reading is replaced only when every part was read: a reading with pages missing would drop their rows.
 * A failed reading is never silent: the earlier one is kept and the document says so (noteUnreadTable), and a later
 * reading that finishes takes that note away. A document the app could not read is not sent. */
export async function readDocument(db: Db, model: TableModel, accountId: string, policyId: string, onUsage?: OnUsage): Promise<{ read: boolean; why?: string; pagesReread: number; parts?: number }> {
  const [doc] = await documents(db, accountId, policyId);
  if (!doc) return { read: false, why: "no such current document", pagesReread: 0 };
  if (!doc.readable || !doc.pages.length) return { read: false, why: "the document could not be read", pagesReread: 0 };
  let limit = PART_MAX_CHARS;
  let queue = pageParts(doc.pages, limit);
  const maxCalls = 2 * queue.length + 4;
  const whole = queue.length === 1;
  const done: { pages: number[]; json: unknown; model: string }[] = [];
  let headings: string[] = [], columns: string[] = [], calls = 0;
  const fail = async (why: string) => { await noteUnreadTable(db, accountId, doc.id); return { read: false, why, pagesReread: 0 }; };
  while (queue.length) {
    if (calls >= maxCalls) return fail(`the reading did not finish (more than ${maxCalls} calls for this document)`);
    const part = queue.shift()!;
    const pages = part.map((p) => p.page);
    const before = done.length ? doc.pages.filter((p) => p.page < pages[0]).at(-1) : undefined;
    const user = whole && done.length === 0 && pages.length === doc.pages.length
      ? renderDocument({ name: doc.name, pages: part })
      : renderDocument({ name: doc.name, pages: before ? [before, ...part] : part }) + partReadingNote(pages, doc.pages.length, headings, columns, before?.page ?? null);
    calls++;
    const reply = await model.call({ system: READING_PROMPT, user, schema: READING_SCHEMA, maxTokens: READ_MAX_OUTPUT });
    await onUsage?.("reading", reply);
    if (reply.json == null) {
      if (reply.stopReason === "max_tokens" && part.length > 1) {
        // Parts this size run out on this document: the rest are made smaller too, so each is not paid for twice.
        limit = Math.max(1, Math.floor(part.reduce((n, p) => n + p.text.length, 0) / 2));
        const half = Math.ceil(part.length / 2);
        queue = [part.slice(0, half), part.slice(half), ...pageParts(queue.flat(), limit)];
        continue;
      }
      return fail(`the reading did not finish (${reply.stopReason ?? "no reply"}${pages.length < doc.pages.length ? `, pages ${pageRange(pages)}` : ""})`);
    }
    // Rows of the context page belong to the part before.
    const json = before ? withoutPage(reply.json, before.page) : reply.json;
    done.push({ pages, json, model: reply.model });
    const read = checkReading(doc, json);
    headings = [...new Set([...headings, ...read.benefits.map((b) => b.section).filter((h): h is string => !!h)])];
    columns = [...new Set([...columns, ...read.benefits.map((b) => b.column).filter((c): c is string => !!c)])];
  }
  // The document's own facts, merged across parts; the parts' rows are added as page readings (checkStored merges them).
  const stored: StoredReading = { document: withMergedDocument(done.map((d) => d.json)), pages: done.slice(1).map((d) => ({ page: d.pages[0], json: d.json })) };
  const first = checkStored(doc, stored);
  for (const f of pagesToReread(doc, first).slice(0, MAX_PAGE_REREADS)) {
    const page = { name: doc.name, pages: doc.pages.filter((p) => p.page === f.page) };
    const reply = await model.call({ system: READING_PROMPT, user: renderDocument(page) + pageReadingNote(f.page, headings), schema: READING_SCHEMA, maxTokens: PAGE_MAX_OUTPUT });
    await onUsage?.("page reading", reply);
    if (reply.json != null) stored.pages.push({ page: f.page, json: reply.json });
  }
  await db(`INSERT INTO benefit_readings(policy_id, account_id, reading, model, prompt_version, read_at) VALUES($1,$2,$3::jsonb,$4,$5,now())
    ON CONFLICT (policy_id) DO UPDATE SET reading=EXCLUDED.reading, model=EXCLUDED.model, prompt_version=EXCLUDED.prompt_version, read_at=now()
    WHERE benefit_readings.account_id=EXCLUDED.account_id`,
    [doc.id, accountId, JSON.stringify(stored), done[0].model, PROMPT_VERSION]);
  await clearUnreadTableNote(db, accountId, doc.id);
  return { read: true, pagesReread: stored.pages.length - (done.length - 1), ...(done.length > 1 ? { parts: done.length } : {}) };
}

type RawReading = { document?: Record<string, unknown>; covers?: { page?: unknown }[]; benefits?: { page?: unknown }[] };
/** A part's reading without the rows it read from its context page. */
function withoutPage(json: unknown, page: number): unknown {
  const r = (json ?? {}) as RawReading;
  const keep = (rows: { page?: unknown }[] | undefined) => Array.isArray(rows) ? rows.filter((x) => Number(x?.page) !== page) : rows;
  return { ...r, covers: keep(r.covers), benefits: keep(r.benefits) };
}
/** The first part's reading with the document's facts merged across every part: the first kind (other than "other"),
 * product, insurer, plan and period any part gives, and every person any part names. Each is still checked against the
 * printed pages (checkReading), as for a reading in one call. */
function withMergedDocument(readings: unknown[]): unknown {
  const docs = readings.map((r) => ((r ?? {}) as RawReading).document ?? {});
  const firstOf = (key: string, skip?: string) => docs.map((d) => d[key]).find((v) => v != null && v !== "" && v !== skip) ?? docs[0]?.[key] ?? null;
  const named = [...new Set(docs.flatMap((d) => Array.isArray(d.namedPeople) ? d.namedPeople.filter((n): n is string => typeof n === "string" && !!n.trim()) : []))];
  const document = { ...docs[0], kind: firstOf("kind", "other"), product: firstOf("product"), insurer: firstOf("insurer"), plan: firstOf("plan"),
    periodFrom: firstOf("periodFrom"), periodTo: firstOf("periodTo"), namedPeople: named };
  return { ...((readings[0] ?? {}) as RawReading), document };
}

const pageRange = (pages: number[]) => pages.length === 1 ? String(pages[0]) : `${pages[0]}-${pages[pages.length - 1]}`;
/** What a document says when its table could not be read this time: the table keeps the earlier reading, if any, and says
 * from when. Added once to the document's notes and its message on the Documents page (as lib/rag/ingest.ts adds its notes). */
export const UNREAD_TABLE_PREFIX = "The table of benefits could not be read";
export const UNREAD_TABLE_NOTE = (when: string | null) => when
  ? `The table of benefits could not be read again this time, so it still shows the reading from ${when}.`
  : "The table of benefits could not be read this time, so it has no rows from this document yet.";
/** Takes away the "could not be read" note once a reading of the document finishes. */
async function clearUnreadTableNote(db: Db, accountId: string, policyId: string) {
  try {
    await db(`UPDATE policies SET processing_message=nullif(btrim(regexp_replace(coalesce(processing_message,''), '\\s*The table of benefits could not be read[^.]*\\.', '', 'g')), ''),
        extracted_json=jsonb_set(extracted_json,'{documentNotes}',coalesce((SELECT jsonb_agg(n) FROM jsonb_array_elements(extracted_json->'documentNotes') n WHERE n #>> '{}' NOT LIKE $3),'[]'::jsonb)),updated_at=now()
      WHERE id=$1 AND account_id=$2 AND jsonb_typeof(extracted_json->'documentNotes')='array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(extracted_json->'documentNotes') n WHERE n #>> '{}' LIKE $3)`, [policyId, accountId, UNREAD_TABLE_PREFIX + "%"]);
  } catch (error) { console.warn("Benefit table: could not clear the unread-table note for " + policyId + ":", error instanceof Error ? error.message : error); }
}
async function noteUnreadTable(db: Db, accountId: string, policyId: string) {
  try {
    const earlier = await db("SELECT read_at FROM benefit_readings WHERE policy_id=$1 AND account_id=$2", [policyId, accountId]);
    const at = earlier[0]?.read_at;
    const when = at == null ? null : new Date(String(at instanceof Date ? at.toISOString() : at)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const note = UNREAD_TABLE_NOTE(when);
    await db(`UPDATE policies SET processing_message=concat_ws(' ', nullif(processing_message,''), $3::text),
        extracted_json=jsonb_set(coalesce(extracted_json,'{}'::jsonb),'{documentNotes}',coalesce(extracted_json->'documentNotes','[]'::jsonb)||to_jsonb($3::text)),updated_at=now()
      WHERE id=$1 AND account_id=$2 AND NOT (coalesce(extracted_json->'documentNotes','[]'::jsonb) ? $3::text)`, [policyId, accountId, note]);
  } catch (error) { console.warn("Benefit table: could not note the unread table for " + policyId + ":", error instanceof Error ? error.message : error); }
}

type Loaded = { family: FamilyMember[]; readings: CheckedReading[]; links: (SectionLink & { chosenBy: "model" | "household" })[]; confirmations: Confirmation[];
  documents: { id: string; name: string; state: DocumentState; file: DocumentFile }[] };

async function load(db: Db, accountId: string): Promise<Loaded> {
  const storedOnce = db("SELECT policy_id, reading FROM benefit_readings WHERE account_id=$1", [accountId])
    .then((rows) => new Map(rows.map((r) => [String(r.policy_id), (typeof r.reading === "string" ? JSON.parse(r.reading) : r.reading) as StoredReading])));
  storedOnce.catch(() => undefined);
  // Each document's page count and fingerprint, read in the database: a document whose check this server already holds
  // (checkedOnce) is not sent its pages' text again, which was most of a warm load's time on a large library. Pages are
  // fetched for every other document that reads them: a stored reading to check, or a letter that may enclose a schedule.
  const counts = new Map<string, number>(), remembered = new Map<string, CheckedReading>(), fetched = new Set<string>();
  const [members, docs] = await Promise.all([family(db, accountId), documents(db, accountId, undefined, async (all) => {
    // A database that cannot give the fingerprints (an older engine, a test double) is sent every document's pages, as before.
    const [stored, prints] = await Promise.all([storedOnce, db(PAGES_PRINT_SQL, [accountId, all.map((d) => d.id)]).catch(() => null)]);
    if (!prints) { for (const d of all) fetched.add(d.id); return all; }
    const printOf = new Map(prints.map((p) => [String(p.policy_id), String(p.print)]));
    for (const p of prints) counts.set(String(p.policy_id), Number(p.pages));
    const want = all.filter((d) => {
      if (!stored.has(d.id)) return NON_COVER_ROLES.has(d.file.document_role ?? "");
      if (!d.readable) return false;
      const hit = checkedCache.get(checkKey(d, printOf.get(d.id) ?? pagesPrint([]), stored.get(d.id)!));
      if (hit) remembered.set(d.id, structuredClone(hit));
      return !hit;
    });
    for (const d of want) fetched.add(d.id);
    return want;
  })]);
  const people = await withDocumentLinks(db, accountId, members);
  const stored = await storedOnce;
  const readings = docs.flatMap((d) => (stored.has(d.id) && d.readable ? [remembered.get(d.id) ?? checkedOnce(d, stored.get(d.id)!)] : []));
  const links = (await db("SELECT section_key, cover_key, why, chosen_by FROM benefit_links WHERE account_id=$1", [accountId]))
    .map((r) => ({ section: String(r.section_key), cover: r.cover_key == null ? null : String(r.cover_key), why: String(r.why ?? ""), chosenBy: r.chosen_by === "household" ? "household" as const : "model" as const }));
  const ids = new Set(people.map((p) => p.id));
  const confirmations = (await db("SELECT family_member_id, cover_key, status, sum_insured, updated_at FROM benefit_confirmations WHERE account_id=$1", [accountId]))
    .filter((r) => ids.has(String(r.family_member_id)))
    .map((r) => ({ personId: String(r.family_member_id), coverKey: String(r.cover_key), status: r.status === "corrected" ? "corrected" as const : "confirmed" as const,
      sumInsured: r.sum_insured == null ? null : Number(r.sum_insured), updatedAt: r.updated_at == null ? null : String(r.updated_at) }));
  return { family: people, readings, links, confirmations,
    documents: docs.map((d) => ({ id: d.id, name: d.name, state: documentState({ status: d.status, pages: fetched.has(d.id) ? d.pages.length : counts.get(d.id) ?? 0, live: d.live, scanLive: d.scanLive,
      misfiled: !stored.has(d.id) && filedBeforeRoleRules(d.file.document_role, d.pages), file: d.file }, stored.has(d.id)), file: d.file })) };
}

/** Each person's table, with the documents still waiting to be read. */
export async function tableFor(db: Db, accountId: string): Promise<{ table: BenefitTable; documents: Loaded["documents"]; links: Loaded["links"] }> {
  const l = await load(db, accountId);
  // No confirmations: people never confirm or correct amounts (DC, 22 Oct 2026), so the table always uses the printed
  // figures, even where an older build stored a correction (TE #99).
  return { table: assembleTable(l.readings, l.family, l.links), documents: l.documents, links: l.links };
}

/** Asks the model which cover each section is paid under, for every section the household has not linked itself. The
 * model's earlier links are replaced; the household's are never touched. */
export async function relink(db: Db, model: TableModel, accountId: string, onUsage?: OnUsage): Promise<{ proposed: number }> {
  const l = await load(db, accountId);
  const fixed = new Set(l.links.filter((x) => x.chosenBy === "household").map((x) => x.section));
  const sections = sectionsOf(l.readings).filter((s) => !fixed.has(s.key));
  const { types } = coversOf(l.readings, l.family);
  let links: SectionLink[] = [];
  if (sections.length && types.length) {
    const reply = await model.call({ system: LINKING_PROMPT, user: renderLinkingInput(sections, types), schema: LINKING_SCHEMA, maxTokens: LINK_MAX_OUTPUT });
    await onUsage?.("linking", reply);
    const keys = new Set(sections.map((s) => s.key)), covers = new Set(types.map((t) => t.key));
    links = ((reply.json as { links?: SectionLink[] } | null)?.links ?? []).filter((x) => keys.has(x.section) && (x.cover == null || covers.has(x.cover)));
  }
  await db("DELETE FROM benefit_links WHERE account_id=$1 AND chosen_by='model'", [accountId]);
  for (const x of links)
    await db(`INSERT INTO benefit_links(account_id, section_key, cover_key, why, chosen_by, updated_at) VALUES($1,$2,$3,$4,'model',now())
      ON CONFLICT (account_id, section_key) DO NOTHING`, [accountId, x.section, x.cover, x.why.slice(0, 300)]);
  return { proposed: links.length };
}

export class TableInputError extends Error { constructor(message: string) { super(message); this.name = "TableInputError"; } }

/** The household links a section to one of its covers, or to none. Kept through every re-read and re-link. */
export async function setLink(db: Db, accountId: string, section: string, cover: string | null): Promise<void> {
  const l = await load(db, accountId);
  if (!sectionsOf(l.readings).some((s) => s.key === section)) throw new TableInputError("That part of a document is not in your table any more.");
  if (cover != null && !coversOf(l.readings, l.family).types.some((t) => t.key === cover)) throw new TableInputError("That cover is not in your documents.");
  await db(`INSERT INTO benefit_links(account_id, section_key, cover_key, why, chosen_by, updated_at) VALUES($1,$2,$3,'Set by you','household',now())
    ON CONFLICT (account_id, section_key) DO UPDATE SET cover_key=EXCLUDED.cover_key, why=EXCLUDED.why, chosen_by='household', updated_at=now()`, [accountId, section, cover]);
}

/** The household confirms a person's headline amount, corrects it, or takes their word back (status null). */
export async function setConfirmation(db: Db, accountId: string, userId: string | null, personId: string, coverKey: string,
  status: "confirmed" | "corrected" | null, sumInsured: number | null): Promise<void> {
  const l = await load(db, accountId);
  if (!l.family.some((p) => p.id === personId)) throw new TableInputError("That person is not in your family.");
  const held = coversOf(l.readings, l.family).covers.some((c) => c.personId === personId && c.coverKey === coverKey);
  if (status == null) { await db("DELETE FROM benefit_confirmations WHERE account_id=$1 AND family_member_id=$2 AND cover_key=$3", [accountId, personId, coverKey]); return; }
  if (!held) throw new TableInputError("Your documents do not show that cover for this person.");
  if (status === "corrected" && (sumInsured == null || !Number.isFinite(sumInsured) || sumInsured <= 0)) throw new TableInputError("Give the amount as a number more than 0.");
  await db(`INSERT INTO benefit_confirmations(account_id, family_member_id, cover_key, status, sum_insured, updated_by, updated_at) VALUES($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (account_id, family_member_id, cover_key) DO UPDATE SET status=EXCLUDED.status, sum_insured=EXCLUDED.sum_insured, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [accountId, personId, coverKey, status, status === "corrected" ? sumInsured : null, userId]);
}

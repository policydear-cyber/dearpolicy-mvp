/** The benefit table in the app: reading a document into `benefit_readings`, linking the household's benefit sections to
 * covers, the household's links and confirmations, and each person's table. The database and the model are passed in,
 * so tests run with fakes; the routes and lib/rag/ingest.ts pass the real ones.
 *
 * Only the model's reading, the links and the confirmations are stored. Every time a table is shown it is checked again
 * against the stored pages and assembled from scratch (check.ts, completeness.ts, assemble.ts), so a change to the
 * checks, a re-read, a removed document or a removed person shows at once, and no stored row can go stale. */
import { assembleTable, coversOf, sectionsOf, type BenefitTable, type Confirmation, type FamilyMember } from "./assemble";
import { checkReading, type CheckedReading, type SourceDoc } from "./check";
import { mergeReadings, pagesToReread } from "./completeness";
import type { TableModel, TableReply } from "./model";
import { NON_COVER_ROLES, NO_COVER_READING_ROLES, correspondenceRole, schedulePage } from "@/lib/documents/messy";
import { policyJobLive, scanJobLive } from "@/lib/rag/live-job";
import { isPolicyQuarantineHeld, policyQuarantineLabel } from "@/lib/policies/quarantine/ui";
import { LINKING_PROMPT, LINKING_SCHEMA, READING_PROMPT, READING_SCHEMA, pageReadingNote, renderDocument, renderLinkingInput, type SectionLink } from "./reading";

export const PROMPT_VERSION = "2026-10-21.3";
export const READ_MAX_OUTPUT = 24_000;
export const PAGE_MAX_OUTPUT = 8_000;
export const LINK_MAX_OUTPUT = 8_000;
/** At most this many pages of one document are read again on their own. */
export const MAX_PAGE_REREADS = 12;

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

/** What a document's own record says about it, for naming it to the household (lib/policies/inventory.ts documentName)
 * and for telling whether the table will ever read it. */
export type DocumentFile = { original_filename: string; product_name: string | null; insurer: string | null; document_role: string | null;
  policy_number: string | null; quarantine: string | null; scan_detail?: string | null };
/** `live`: a live intake job is reading the document now (lib/rag/live-job.ts, the Documents page's own rule).
 * `scanLive`: a live automatic malware-scan retry is checking it (lib/rag/live-job.ts scanJobLive). */
type HouseholdDoc = SourceDoc & { status: string; live: boolean; scanLive: boolean; file: DocumentFile };

/** The household's current documents (not deleted, not superseded) with their stored pages. */
async function documents(db: Db, accountId: string, policyId?: string): Promise<HouseholdDoc[]> {
  const docs = await db(`SELECT id, original_filename, processing_status, product_name, insurer, document_role, policy_number, quarantine_status, scan_result_detail,
      ${policyJobLive("policies")} AS reading_live, ${scanJobLive("policies")} AS scan_live FROM policies
    WHERE account_id=$1 AND lifecycle_state='active' AND superseded_at IS NULL${policyId ? " AND id=$2" : ""} ORDER BY created_at`, policyId ? [accountId, policyId] : [accountId]);
  if (!docs.length) return [];
  const people = (await family(db, accountId)).map((m) => m.display_name);
  // A page whose table text could not be checked (lib/documents/layout-check.ts) is not searched: no row's quote is found on it.
  const pages = await db("SELECT policy_id, page_number, text FROM policy_pages pp WHERE account_id=$1 AND policy_id = ANY($2::uuid[]) AND coalesce(to_jsonb(pp)->>'extraction_method', '') <> 'unchecked' ORDER BY policy_id, page_number",
    [accountId, docs.map((d) => String(d.id))]);
  return docs.map((d) => ({
    id: String(d.id), name: String(d.original_filename), status: String(d.processing_status ?? ""), readable: d.processing_status === "ready", live: d.reading_live === true, scanLive: d.scan_live === true,
    pages: pages.filter((p) => String(p.policy_id) === String(d.id)).map((p) => ({ page: Number(p.page_number), text: String(p.text ?? "") })), people,
    file: { original_filename: String(d.original_filename), product_name: text(d.product_name), insurer: text(d.insurer), document_role: text(d.document_role),
      policy_number: text(d.policy_number), quarantine: text(d.quarantine_status), scan_detail: text(d.scan_result_detail) },
  }));
}
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
  if (hasReading) return "read";
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

/** Reads one document into the table: the whole document once, then each page whose figures were mostly left unread.
 * Replaces any earlier reading of the document. A document the app could not read is not sent. */
export async function readDocument(db: Db, model: TableModel, accountId: string, policyId: string, onUsage?: OnUsage): Promise<{ read: boolean; why?: string; pagesReread: number }> {
  const [doc] = await documents(db, accountId, policyId);
  if (!doc) return { read: false, why: "no such current document", pagesReread: 0 };
  if (!doc.readable || !doc.pages.length) return { read: false, why: "the document could not be read", pagesReread: 0 };
  const whole = await model.call({ system: READING_PROMPT, user: renderDocument(doc), schema: READING_SCHEMA, maxTokens: READ_MAX_OUTPUT });
  await onUsage?.("reading", whole);
  if (whole.json == null) return { read: false, why: `the reading did not finish (${whole.stopReason ?? "no reply"})`, pagesReread: 0 };
  const stored: StoredReading = { document: whole.json, pages: [] };
  const first = checkReading(doc, whole.json);
  const headings = [...new Set(first.benefits.map((b) => b.section).filter((h): h is string => !!h))];
  for (const f of pagesToReread(doc, first).slice(0, MAX_PAGE_REREADS)) {
    const page = { name: doc.name, pages: doc.pages.filter((p) => p.page === f.page) };
    const reply = await model.call({ system: READING_PROMPT, user: renderDocument(page) + pageReadingNote(f.page, headings), schema: READING_SCHEMA, maxTokens: PAGE_MAX_OUTPUT });
    await onUsage?.("page reading", reply);
    if (reply.json != null) stored.pages.push({ page: f.page, json: reply.json });
  }
  await db(`INSERT INTO benefit_readings(policy_id, account_id, reading, model, prompt_version, read_at) VALUES($1,$2,$3::jsonb,$4,$5,now())
    ON CONFLICT (policy_id) DO UPDATE SET reading=EXCLUDED.reading, model=EXCLUDED.model, prompt_version=EXCLUDED.prompt_version, read_at=now()
    WHERE benefit_readings.account_id=EXCLUDED.account_id`,
    [doc.id, accountId, JSON.stringify(stored), whole.model, PROMPT_VERSION]);
  return { read: true, pagesReread: stored.pages.length };
}

type Loaded = { family: FamilyMember[]; readings: CheckedReading[]; links: (SectionLink & { chosenBy: "model" | "household" })[]; confirmations: Confirmation[];
  documents: { id: string; name: string; state: DocumentState; file: DocumentFile }[] };

async function load(db: Db, accountId: string): Promise<Loaded> {
  const [people, docs] = await Promise.all([family(db, accountId), documents(db, accountId)]);
  const stored = new Map((await db("SELECT policy_id, reading FROM benefit_readings WHERE account_id=$1", [accountId]))
    .map((r) => [String(r.policy_id), (typeof r.reading === "string" ? JSON.parse(r.reading) : r.reading) as StoredReading]));
  const readings = docs.flatMap((d) => (stored.has(d.id) && d.readable ? [checkStored(d, stored.get(d.id)!)] : []));
  const links = (await db("SELECT section_key, cover_key, why, chosen_by FROM benefit_links WHERE account_id=$1", [accountId]))
    .map((r) => ({ section: String(r.section_key), cover: r.cover_key == null ? null : String(r.cover_key), why: String(r.why ?? ""), chosenBy: r.chosen_by === "household" ? "household" as const : "model" as const }));
  const ids = new Set(people.map((p) => p.id));
  const confirmations = (await db("SELECT family_member_id, cover_key, status, sum_insured, updated_at FROM benefit_confirmations WHERE account_id=$1", [accountId]))
    .filter((r) => ids.has(String(r.family_member_id)))
    .map((r) => ({ personId: String(r.family_member_id), coverKey: String(r.cover_key), status: r.status === "corrected" ? "corrected" as const : "confirmed" as const,
      sumInsured: r.sum_insured == null ? null : Number(r.sum_insured), updatedAt: r.updated_at == null ? null : String(r.updated_at) }));
  return { family: people, readings, links, confirmations,
    documents: docs.map((d) => ({ id: d.id, name: d.name, state: documentState({ status: d.status, pages: d.pages.length, live: d.live, scanLive: d.scanLive,
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

/**
 * Round 10 third household (synthetic, deterministic): an elderly couple and
 * the adult son who manages their insurance, uploading MESSY documents the way
 * real families do (scripts/fixtures/r10/make.py): phone photos rotated 90 and
 * 180 degrees, skewed, shadowed and low in contrast; a scanned PDF with no text
 * layer (one page fed in sideways); one PDF holding three policies; a schedule
 * whose pages are out of order; the same schedule uploaded as a photo AND as a
 * PDF; an insurer letter (premium increase, rider withdrawn); a claim rejection
 * citing a pre-existing condition; a hospital bill; an e-statement full of
 * small tables; a password-protected PDF; a truncated PDF; an insurer-app
 * screenshot; a Word file of the son's own notes; a 120-page policy wording;
 * handwritten notes; a photo too blurred to read; and an iPhone HEIC photo.
 *
 * Every upload goes through the REAL pipeline (upload validation, then
 * processPolicy) on PGlite with the deterministic model stand-in. Scanned
 * pages are transcribed by the deterministic hosted-OCR stand-in from
 * scripts/fixtures/r10/transcripts.json -- faithful but imperfect (S$1,O00,
 * l/1 swaps, broken table columns), and only for a page shown upright.
 *
 *   Chua Kok Leong  (self)    Wanderer travel (in the bundle), TermGuard 65 (locked PDF + app screenshot), his own notes (.docx)
 *   Chua Boon Huat  (parent)  SilverShield 2026 (PDF + photo duplicate), 2025 schedule (photo), premium letter, claim rejection,
 *                             hospital bill, Heritage Whole Life (in the bundle) + its e-statement, 120-page wording, handwritten notes
 *   Lee Ah Lian     (parent)  Golden Years CI (scan), SeniorGuard PA (in the bundle), CareCash (pages out of order), a damaged renewal PDF, a blurred photo
 */
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { installDatabase } from "../r6/fixture";

export const ACCOUNT = "00000000-0000-0000-0000-0000000a1000";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-0000000a10ff";
export const uuid = (n: number) => "a1000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const KOKLEONG = uuid(1), BOONHUAT = uuid(2), AHLIAN = uuid(3), OTHER_PERSON = uuid(9);
export const PEOPLE = [
  { id: KOKLEONG, display_name: "Chua Kok Leong", preferred_name: "Kok Leong", relationship: "self" },
  { id: BOONHUAT, display_name: "Chua Boon Huat", preferred_name: "Papa", relationship: "parent" },
  { id: AHLIAN, display_name: "Lee Ah Lian", preferred_name: "Mama", relationship: "parent" },
];
export const SELF = KOKLEONG;

const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", heic: "image/heic" };
/** Upload key -> [file, the profile it was uploaded to]. In upload order. */
export const UPLOADS: [string, string, string][] = [
  ["photo26", "IMG_20260412_093015.jpg", BOONHUAT],
  ["shield26", "SilverShield_Schedule_2026.pdf", BOONHUAT],
  ["photo25", "SilverShield_2025_photo.png", BOONHUAT],
  ["letter", "Merlion_Premium_Revision_Aug2026.pdf", BOONHUAT],
  ["rejection", "Merlion_Claim_Decision_CLM-2026-118842.pdf", BOONHUAT],
  ["bill", "Novena_Heights_Final_Bill_June2026.pdf", BOONHUAT],
  ["ciscan", "GoldenYears_CI_scan.pdf", AHLIAN],
  ["bundle", "Chua_family_policies_bundle.pdf", KOKLEONG],
  ["carecash", "CareCash_Hospital_Income_Schedule.pdf", AHLIAN],
  ["estatement", "TiongBahru_eStatement_2026.pdf", BOONHUAT],
  ["locked", "TermGuard65_Schedule_locked.pdf", KOKLEONG],
  ["damaged", "CareCash_Renewal_2026_damaged.pdf", AHLIAN],
  ["screenshot", "Screenshot_20260918_MerlionApp.png", KOKLEONG],
  ["notes", "Chua_insurance_notes.docx", KOKLEONG],
  ["wording", "SilverShield_Policy_Wording.pdf", BOONHUAT],
  ["handwritten", "Handwritten_notes.jpg", BOONHUAT],
  ["blurry", "CareCash_photo_blurry.jpg", AHLIAN],
  ["heic", "IMG_4471.heic", BOONHUAT],
];

export const fixtureBytes = async (name: string) => Buffer.from((await readFile(path.resolve("scripts/fixtures/r10/" + name + ".b64"), "utf8")).replace(/\s+/g, ""), "base64");

export type Upload = { key: string; file: string; member: string; policyId: string | null; rejected: string | null; ms: number; threw: string | null };
export type Household = { db: PGlite; docs: Record<string, string>; uploads: Upload[]; storageDir: string };

/** Registers what the hosted reader would transcribe from each scanned image
 * (keyed by the image as it reaches the reader, built by the same code the
 * pipeline uses), for the deterministic OCR stand-in. */
export async function registerTranscripts() {
  const { pageImageFingerprints, SYNTHETIC_OCR_REGISTRY } = await import("@/lib/ai/deterministic-model");
  const { imageToPdf, sniffFileFormat } = await import("@/lib/documents/formats");
  const transcripts = JSON.parse(await readFile(path.resolve("scripts/fixtures/r10/transcripts.json"), "utf8")) as Record<string, { page: number; rotation: number; quality: "good" | "poor" | "unreadable"; text: string }[]>;
  const registry = new Map<string, { text: string; rotation: number; quality: "good" | "poor" | "unreadable" }>();
  for (const [file, pages] of Object.entries(transcripts)) {
    const bytes = new Uint8Array(await fixtureBytes(file));
    const sniffed = sniffFileFormat(bytes);
    if (!sniffed.ok) throw new Error("fixture " + file + " is not readable: " + sniffed.message);
    const pdf = sniffed.format === "pdf" ? bytes : new Uint8Array(await imageToPdf(bytes, sniffed.format));
    const prints = await pageImageFingerprints(pdf);
    for (const p of pages) for (const h of prints[p.page - 1] ?? []) registry.set(h, { text: p.text, rotation: p.rotation, quality: p.quality });
  }
  (globalThis as Record<string, unknown>)[SYNTHETIC_OCR_REGISTRY] = registry;
  return registry.size;
}

export async function buildHousehold(opts: { perDocumentTimeoutMs?: number } = {}): Promise<Household> {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "r10-messy-"));
  for (const d of ["policy", "evidence", "exports"]) await mkdir(path.join(storageDir, d), { recursive: true });
  Object.assign(process.env, { STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.join(storageDir, "policy"), LOCAL_CLAIM_EVIDENCE_DIR: path.join(storageDir, "evidence"), LOCAL_HOUSEHOLD_EXPORT_DIR: path.join(storageDir, "exports") });
  const db = await installDatabase();
  for (const [account, name] of [[ACCOUNT, "Chua household"], [OTHER_ACCOUNT, "Other household"]]) {
    await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, name]);
    await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [account]);
  }
  for (const p of PEOPLE) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [p.id, ACCOUNT, p.display_name, p.preferred_name, p.relationship]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Tay Hui Min','Hui Min','self')", [OTHER_PERSON, OTHER_ACCOUNT]);
  await registerTranscripts();

  const { savePolicyFile } = await import("@/lib/storage");
  const { processPolicy } = await import("@/lib/rag/ingest");
  const { validateDocumentUpload, probeImageDecodes } = await import("@/lib/documents/formats");
  const docs: Record<string, string> = {};
  const uploads: Upload[] = [];
  let n = 100;
  const limit = opts.perDocumentTimeoutMs ?? 120_000;
  const upload = async (key: string, account: string, member: string, file: string, bytes: Buffer) => {
    const ext = file.split(".").pop()!.toLowerCase();
    const u: Upload = { key, file, member, policyId: null, rejected: null, ms: 0, threw: null };
    uploads.push(u);
    // The upload route's own checks, as the browser upload would meet them.
    const valid = validateDocumentUpload({ filename: file, mimeType: MIME[ext] ?? "application/octet-stream", byteSize: bytes.length, bytes: new Uint8Array(bytes), maxBytes: 50 * 1024 * 1024 });
    if (!valid.valid) { u.rejected = valid.message; return; }
    const probe = await probeImageDecodes(new Uint8Array(bytes), valid.format);
    if (probe) { u.rejected = probe; return; }
    const policyId = uuid(n++);
    const storageKey = await savePolicyFile({ accountId: account, familyMemberId: member, policyId, filename: file, bytes: new Uint8Array(bytes) });
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at)
      VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','r10-messy',now())`, [policyId, account, member, file, storageKey, createHash("sha256").update(bytes).digest("hex")]);
    u.policyId = policyId; docs[key] = policyId;
    const t0 = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([processPolicy({ accountId: account, familyMemberId: member, policyId, storageKey, linkUploadMember: true, attempt: { number: 1, max: 1 } }),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("HANG: still reading after " + limit + " ms")), limit); })]);
    } catch (e) { u.threw = (e instanceof Error ? e.message : String(e)).slice(0, 300); }
    finally { clearTimeout(timer); u.ms = Date.now() - t0; }
  };
  for (const [key, file, member] of UPLOADS) await upload(key, ACCOUNT, member, file, await fixtureBytes(file));
  // Another household's document: never visible here.
  await upload("other", OTHER_ACCOUNT, OTHER_PERSON, "SilverShield_Schedule_2026.pdf", await fixtureBytes("SilverShield_Schedule_2026.pdf"));
  return { db, docs, uploads, storageDir };
}

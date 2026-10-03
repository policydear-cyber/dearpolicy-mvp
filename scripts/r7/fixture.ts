/**
 * Round 7 second household (synthetic, deterministic), deliberately unlike the
 * Round 6 one on every axis: a single parent, an elderly mother, a teenage son,
 * an adult daughter overseas, a domestic helper, and documents from other
 * insurers and formats (ward-class columns, ElderShield in Malay/English, a
 * Chinese/English endowment illustration with a surrender table, an ILP fund
 * statement, a percentage-of-sum-insured accident scale, home, car, a lapse
 * notice, a grace-period reminder, an expired single-trip travel certificate,
 * a premium notice with no benefits, and names with bin/binte/binti,
 * apostrophes and hyphens; two people share the first name Muhammad).
 *
 * Every document goes through the REAL ingestion pipeline (processPolicy) on
 * PGlite with the deterministic model stand-in (scripts/fixtures/r7/make.py).
 *
 *   Rahman bin Yusof          (self)    MediGuard IP + Co-Pay Rider, Lion Gateway ILP, HomeShield, DriveSafe car,
 *                                       AssureTerm 65 (LAPSED), Wanderlust Japan travel (EXPIRED, with Aisyah)
 *   Aminah binte Ismail       (parent)  ElderShield 400 (Malay/English), Silver Years premium notice only
 *   Muhammad Irfan bin Rahman (child)   Golden Lotus endowment (Chinese/English), SafeGuard Junior PA
 *   Nur Aisyah binte Rahman   (child)   HerCare CI (in its grace period), named driver on the car, expired travel
 *   Muhammad Hafiz bin Yusof  (sibling) nothing on file (shares "Muhammad" with Irfan)
 *   Maria Luz D'Souza-Reyes   (helper)  HelperCare FDW insurance
 */
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { installDatabase } from "../r6/fixture";

export const ACCOUNT = "00000000-0000-0000-0000-00000000a700";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000a7ff";
export const uuid = (n: number) => "70000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const RAHMAN = uuid(1), AMINAH = uuid(2), IRFAN = uuid(3), AISYAH = uuid(4), HAFIZ = uuid(5), MARIA = uuid(6), OTHER_PERSON = uuid(9);
export const PEOPLE = [
  { id: RAHMAN, display_name: "Rahman bin Yusof", preferred_name: "Rahman", relationship: "self" },
  { id: AMINAH, display_name: "Aminah binte Ismail", preferred_name: "Aminah", relationship: "parent" },
  { id: IRFAN, display_name: "Muhammad Irfan bin Rahman", preferred_name: "Irfan", relationship: "child" },
  { id: AISYAH, display_name: "Nur Aisyah binte Rahman", preferred_name: "Aisyah", relationship: "child" },
  { id: HAFIZ, display_name: "Muhammad Hafiz bin Yusof", preferred_name: "Hafiz", relationship: "sibling" },
  { id: MARIA, display_name: "Maria Luz D'Souza-Reyes", preferred_name: "Maria", relationship: "helper" },
];
/** The person "I/me/my" means in this household's chats. */
export const SELF = RAHMAN;

export type Household = { db: PGlite; docs: Record<string, string>; storageDir: string };

const fixture = async (dir: string, name: string) => Buffer.from((await readFile(path.resolve("scripts/fixtures/" + dir + "/" + name + ".pdf.b64"), "utf8")).replace(/\s+/g, ""), "base64");

/** Document key -> [file, the person it was uploaded for]. */
export const DOCUMENTS: Record<string, [string, string]> = {
  shield: ["MediGuard_Shield_Schedule_2026", RAHMAN],
  eldershield: ["ElderShield400_Statement_2026", AMINAH],
  endowment: ["GoldenLotus_Endowment_Illustration", IRFAN],
  ilp: ["LionGateway_ILP_Statement_2026", RAHMAN],
  pa: ["SafeGuard_Junior_PA_Schedule", IRFAN],
  home: ["HomeShield_Contents_Schedule", RAHMAN],
  car: ["DriveSafe_Motor_Certificate", RAHMAN],
  lapsed: ["AssureTerm65_Lapse_Notice", RAHMAN],
  grace: ["HerCare_CI_Grace_Reminder", AISYAH],
  travel: ["Wanderlust_Japan_Travel_2025", RAHMAN],
  notice: ["SilverYears_Premium_Notice", AMINAH],
  helper: ["HelperCare_FDW_Schedule", MARIA],
};

export async function buildHousehold(): Promise<Household> {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "r7-answers-"));
  for (const d of ["policy", "evidence", "exports"]) await mkdir(path.join(storageDir, d), { recursive: true });
  Object.assign(process.env, { STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.join(storageDir, "policy"), LOCAL_CLAIM_EVIDENCE_DIR: path.join(storageDir, "evidence"), LOCAL_HOUSEHOLD_EXPORT_DIR: path.join(storageDir, "exports") });
  const db = await installDatabase();
  for (const [account, name] of [[ACCOUNT, "Rahman household"], [OTHER_ACCOUNT, "Other household"]]) {
    await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, name]);
    await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [account]);
  }
  for (const p of PEOPLE) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [p.id, ACCOUNT, p.display_name, p.preferred_name, p.relationship]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Ong Siew Hwa','Siew Hwa','self')", [OTHER_PERSON, OTHER_ACCOUNT]);

  const { savePolicyFile } = await import("@/lib/storage");
  const { processPolicy } = await import("@/lib/rag/ingest");
  const docs: Record<string, string> = {};
  let n = 100;
  const ingest = async (key: string, account: string, memberId: string, dir: string, name: string) => {
    const bytes = await fixture(dir, name);
    const policyId = uuid(n++);
    const storageKey = await savePolicyFile({ accountId: account, familyMemberId: memberId, policyId, filename: name + ".pdf", bytes: new Uint8Array(bytes) });
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at)
      VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','r7-answers',now())`, [policyId, account, memberId, name + ".pdf", storageKey, createHash("sha256").update(bytes).digest("hex")]);
    await processPolicy({ accountId: account, familyMemberId: memberId, policyId, storageKey, linkUploadMember: true });
    docs[key] = policyId;
  };
  for (const [key, [file, member]] of Object.entries(DOCUMENTS)) await ingest(key, ACCOUNT, member, "r7", file);
  // Another household's document: never visible here.
  await ingest("other", OTHER_ACCOUNT, OTHER_PERSON, "r5", "TermSecure20_Renewal_Certificate_2026_x");
  return { db, docs, storageDir };
}

/** What the documents print about policies that no longer cover anyone (for the detectors). */
export const INACTIVE: { key: string; name: string; state: "lapsed" | "expired"; date: string }[] = [
  { key: "lapsed", name: "AssureTerm 65", state: "lapsed", date: "2026-03-17" },
  { key: "travel", name: "Wanderlust Single Trip", state: "expired", date: "2025-12-14" },
];

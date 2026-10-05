/**
 * Round 6 chat-quality household (synthetic, deterministic).
 *
 * PGlite (real PostgreSQL SQL) with every production schema file, the real
 * ingestion pipeline (processPolicy) run on the Round 5 fixture PDFs with the
 * deterministic model stand-in, plus a hand-seeded accident plan with no
 * premium on file and a password-locked document that could not be read.
 *
 *   Tan Mei Ling   (self)    ShieldCare Premier schedule + renewal notice, TravelSafe (Adult)
 *   Lim Wei Jie    (spouse)  TermSecure 20 (+ CI accelerator), Harbourfront group booklet (Plan A), TravelSafe (Adult)
 *   Lim Xin Yi     (child)   PA Guardian (no premium on file), TravelSafe (Child), booklet (Dependants)
 *   Wong Siew Lan  (parent)  only a locked PDF that could not be read
 *   Lim Wei Ming   (sibling) nothing on file (ambiguous "Wei")
 */
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PDF_PASSWORD_REQUIRED_MESSAGE } from "@/lib/documents/processing-errors";
import { enterIngestChaos, tolerateUnderChaos } from "../r9/ingest-mode";

export const ACCOUNT = "00000000-0000-0000-0000-00000000a600";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000a6ff";
export const EMPTY_ACCOUNT = "00000000-0000-0000-0000-00000000a6e0";
export const uuid = (n: number) => "60000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const MEILING = uuid(1), WEIJIE = uuid(2), XINYI = uuid(3), SIEWLAN = uuid(4), WEIMING = uuid(5), OTHER_PERSON = uuid(9), EMPTY_PERSON = uuid(8);
export const PEOPLE = [
  { id: MEILING, display_name: "Tan Mei Ling", preferred_name: "Mei Ling", relationship: "self" },
  { id: WEIJIE, display_name: "Lim Wei Jie", preferred_name: "Wei Jie", relationship: "spouse" },
  { id: XINYI, display_name: "Lim Xin Yi", preferred_name: "Xin Yi", relationship: "child" },
  { id: SIEWLAN, display_name: "Wong Siew Lan", preferred_name: "Siew Lan", relationship: "parent" },
  { id: WEIMING, display_name: "Lim Wei Ming", preferred_name: "Wei Ming", relationship: "sibling" },
];
const SCHEMA = ["sql/schema.sql", "sql/benefit-catalog.sql", "sql/claim-evidence.sql", "sql/claim-composition.sql", "sql/critical-illness.sql", "sql/disability.sql",
  "sql/cover-conditions.sql", "sql/model-usage.sql", "sql/model-provenance.sql", "sql/chat-upgrade.sql", "sql/coverage-ledger.sql", "sql/background-jobs.sql", "sql/lifecycle.sql",
  "sql/claim-reviewers.sql", "sql/processing-failure-diagnostics.sql", "sql/storage-purge.sql", "sql/v11-ingestion-evidence.sql", "sql/household-rls.sql"];

export type Household = { db: PGlite; docs: Record<string, string>; storageDir: string };

/** Installs PGlite behind lib/db/client's pool. */
export async function installDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SCHEMA) {
    try { await db.exec(await readFile(path.resolve(file), "utf8")); }
    catch (e) { console.log("SQL note: " + file + " not applied (" + (e as Error).message.slice(0, 120) + ")"); }
  }
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  // As Supabase grants by default: the role that writes rows may use their id sequences.
  await db.exec("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;");
  const { pool } = await import("@/lib/db/client");
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((res) => { release = res; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const last = rs.at(-1); return { rows: last?.rows ?? [], rowCount: last?.affectedRows ?? 0 }; }
    const res = await db.query(text, params); return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
  };
  // A transaction holds the lock until release. Code running inside it that
  // calls pool.query directly (a deletion coordinator writing its audit row)
  // would wait for that lock forever: PGlite is one connection, so a query
  // that has waited this long while a transaction is open is treated as part
  // of it and runs straight away, as the service role it would have on its
  // own pooled connection.
  let held = 0;
  const nested = async (text: string, params: unknown[]) => {
    const role = String(((await db.query<{ r: string }>("SELECT current_user AS r")).rows[0])?.r ?? "");
    if (role === "authenticated") await db.exec("RESET ROLE");
    try { return await execute(text, params); } finally { if (role === "authenticated") await db.exec("SET LOCAL ROLE authenticated"); }
  };
  pool.query = (async (text: string, params: unknown[] = []) => {
    if (held) {
      let release: (() => void) | null = null;
      const got = await Promise.race([acquire().then((r) => { release = r; return true; }), new Promise<false>((res) => setTimeout(() => res(false), 300))]);
      if (!got) {
        // Still waiting: when the lock frees later, hand it straight back.
        void (async () => { while (!release) await new Promise((r) => setTimeout(r, 5)); (release as () => void)(); })();
        return nested(text, params);
      }
      try { return await execute(text, params); } finally { (release as unknown as () => void)(); }
    }
    const release = await acquire(); try { return await execute(text, params); } finally { release(); }
  }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); held++; let done = false;
    return { query: execute, release: () => { if (done) return; done = true; held--; release(); } }; }) as typeof pool.connect;
  return db;
}

const fixture = async (name: string) => Buffer.from((await readFile(path.resolve("scripts/fixtures/r5/" + name + ".pdf.b64"), "utf8")).replace(/\s+/g, ""), "base64");

export async function buildHousehold(): Promise<Household> {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "r6-chat-"));
  for (const d of ["policy", "evidence", "exports"]) await mkdir(path.join(storageDir, d), { recursive: true });
  Object.assign(process.env, { STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.join(storageDir, "policy"), LOCAL_CLAIM_EVIDENCE_DIR: path.join(storageDir, "evidence"), LOCAL_HOUSEHOLD_EXPORT_DIR: path.join(storageDir, "exports") });
  const db = await installDatabase();
  for (const [account, name] of [[ACCOUNT, "Tan-Lim household"], [OTHER_ACCOUNT, "Other household"], [EMPTY_ACCOUNT, "Empty household"]]) {
    await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, name]);
    await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [account]);
  }
  for (const p of PEOPLE) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [p.id, ACCOUNT, p.display_name, p.preferred_name, p.relationship]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Goh Boon Kiat','Boon Kiat','self')", [OTHER_PERSON, OTHER_ACCOUNT]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Ong Kai','Kai','self')", [EMPTY_PERSON, EMPTY_ACCOUNT]);

  const { savePolicyFile } = await import("@/lib/storage");
  const { processPolicy } = await import("@/lib/rag/ingest");
  const docs: Record<string, string> = {};
  let n = 100;
  const insert = async (account: string, memberId: string, filename: string, bytes: Buffer) => {
    const policyId = uuid(n++);
    const storageKey = await savePolicyFile({ accountId: account, familyMemberId: memberId, policyId, filename, bytes: new Uint8Array(bytes) });
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at)
      VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','r6-chat-quality',now())`, [policyId, account, memberId, filename, storageKey, createHash("sha256").update(bytes).digest("hex")]);
    return { policyId, storageKey };
  };
  const ingest = async (key: string, memberId: string, name: string, account = ACCOUNT) => {
    const doc = await insert(account, memberId, name + ".pdf", await fixture(name));
    await tolerateUnderChaos(() => processPolicy({ accountId: account, familyMemberId: memberId, policyId: doc.policyId, storageKey: doc.storageKey, linkUploadMember: true }));
    docs[key] = doc.policyId;
  };
  // Round 9: R9_INGEST_SEED reads every document under the ingestion chaos stand-in.
  const leaveChaos = enterIngestChaos(PEOPLE.map((p) => p.display_name));
  await ingest("shield", MEILING, "ShieldCare_Premier_Schedule_2026_x");
  await ingest("renewal", MEILING, "ShieldCare_Renewal_Notice_2027_x");
  await ingest("term", WEIJIE, "TermSecure20_Renewal_Certificate_2026_x");
  await ingest("travel", MEILING, "TravelSafe_Annual_Family_2026_x");
  await ingest("booklet", WEIJIE, "Harbourfront_Employee_Benefits_2026_x");
  // Another household's policy: never visible here.
  await ingest("other", OTHER_PERSON, "TermSecure20_Renewal_Certificate_2026_x", OTHER_ACCOUNT);
  leaveChaos?.();

  // PA Guardian for Xin Yi, seeded as ingestion stores a personal schedule; no premium on file.
  const pa = uuid(n++); docs.pa = pa;
  const vec = "[" + Array.from({ length: 1024 }, (_, j) => (j === 0 ? 1 : 0)).join(",") + "]";
  const paPages = [
    "PA Guardian Policy Schedule\nInsurer: Orchid Assurance (fictitious)\nInsured: Lim Xin Yi (child)\nPolicy number PAG-2026-4471\nPeriod of insurance 1 January 2026 to 31 December 2026\nSum insured S$100,000",
    "PA Guardian - Schedule of Benefits\nAccidental death S$100,000\nFracture benefit S$1,000 per accident (S$2,000 for skull or spine)\nAccidental medical expenses up to S$2,500 per accident, including traditional Chinese medicine\nHospital cash for accidents S$100 per day, up to 30 days\nPage 2 of 2",
  ];
  await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,renewal_or_expiry_date,extracted_json,quarantine_status,benefits_indexed_at,conditions_indexed_at,ledger_read_at,file_hash)
    VALUES($1,$2,$3,'Orchid Assurance (fictitious)','PA Guardian','PAG-2026-4471','Personal Accident','personal_schedule',true,95,'ready','PA_Guardian_Schedule_2026.pdf','pa.pdf','2026-01-01','2026-12-31',$4::jsonb,'scan_clean',now(),now(),now(),'sha256:pa')`,
    [pa, ACCOUNT, XINYI, JSON.stringify({ productsMentioned: ["PA Guardian"] })]);
  await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [pa, XINYI, ACCOUNT]);
  for (const [i, text] of paPages.entries()) {
    await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, pa, i + 1, text]);
    await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)", [uuid(n++), ACCOUNT, XINYI, pa, i + 1, text, vec]);
  }
  await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,'Personal Accident',100000,'SGD','PA Guardian',1,'Sum insured S$100,000',true,true)", [uuid(n++), ACCOUNT, pa, XINYI]);
  const paRows: [string, string, string, number | null, string[], string[], string | null][] = [
    ["Accidental death", "Accidental death S$100,000", "fixed", 100000, ["death", "accident"], ["accident"], null],
    ["Fracture benefit", "Fracture benefit S$1,000 per accident (S$2,000 for skull or spine)", "fixed", 1000, ["accident", "bodily_injury"], ["accident"], null],
    ["Accidental medical expenses", "Accidental medical expenses up to S$2,500 per accident, including traditional Chinese medicine", "expense_cap", 2500, ["accident", "medical_expense"], ["accident"], null],
    ["Hospital cash for accidents", "Hospital cash for accidents S$100 per day, up to 30 days", "daily", 100, ["accident", "hospitalisation"], ["accident"], "hospitalNights"],
  ];
  for (const [name, quote, kind, value, traits, requires, factKey] of paRows)
    await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,fact_key,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,'PA Guardian',$3,$4::text[],$5::text[],$6,$7,'SGD',$8,2,$9,'[]'::jsonb,'[]'::jsonb,false)",
      [ACCOUNT, pa, name, traits, requires, kind, value, factKey, quote]);

  // A password-protected PDF for Siew Lan that could not be read.
  const locked = uuid(n++); docs.locked = locked;
  await db.query(`INSERT INTO policies(id,account_id,family_member_id,processing_status,processing_stage,processing_message,processing_error,original_filename,storage_key,quarantine_status,file_hash)
    VALUES($1,$2,$3,'failed','failed','Analysis stopped',$4,'Eldershield_Statement_locked.pdf','locked.pdf','scan_clean','sha256:locked')`, [locked, ACCOUNT, SIEWLAN, PDF_PASSWORD_REQUIRED_MESSAGE]);
  await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [locked, SIEWLAN, ACCOUNT]);
  return { db, docs, storageDir };
}

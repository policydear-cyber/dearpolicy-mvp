/**
 * Seeds ONE clearly labelled synthetic claim fixture into household A of the
 * local CI database, the way the system suite's catalogued-benefit fixture
 * does: a personal schedule that writes its currency, the cited wording page,
 * the verified coverage row and a stored benefit rule. Local database only;
 * every name carries the run's SYNTHETIC-DPTEST prefix so cleanup finds it.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/lib/db/client";

async function main() {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`seed refuses non-local database host "${host}"`);
  if (!process.env.E2E_RUN_ID) throw new Error("E2E_RUN_ID is required");
  const prefix = `SYNTHETIC-DPTEST-${process.env.E2E_RUN_ID.replace(/[^A-Za-z0-9]/g, "").slice(-12)}`;
  // Household A by default; the owner/reviewer journey passes the user id of
  // the synthetic owner it just signed up (E2E_SEED_USER_ID) and its own
  // seed file, so both suites can share this one fixture definition.
  const seedUser = process.env.E2E_SEED_USER_ID || process.env.E2E_USER_A;
  const household = (await pool.query<{ household_id: string; name: string }>(
    `SELECT hm.household_id::text, a.name FROM household_members hm JOIN accounts a ON a.id=hm.household_id WHERE hm.user_id=$1 LIMIT 1`, [seedUser])).rows[0];
  if (!household) throw new Error("the synthetic household is not provisioned");
  if (!household.name.startsWith(prefix)) throw new Error("seed refuses a household whose name does not carry this run's synthetic prefix");
  const householdId = household.household_id;
  const member = randomUUID(), schedule = randomUUID(), wording = randomUUID();
  const product = `${prefix} Critical Illness Plan`;
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,'self')`, [member, householdId, `${prefix}-Claimant`]);
  // A synthetic relative with one synthetic personal-accident schedule: a
  // death is reported about someone other than the signed-in member (the app
  // treats a member reporting their own death as a what-if), and a claim turn
  // needs at least one confirmed personal policy to review.
  const relative = randomUUID(), paSchedule = randomUUID();
  const paProduct = `${prefix} Personal Accident Plan`;
  const paText = `${prefix}-Relative owns ${paProduct}. Accidental death sum insured: S$100,000. SYNTHETIC TEST DOCUMENT - NOT A REAL POLICY.`;
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,'parent')`, [relative, householdId, `${prefix}-Relative`]);
  await pool.query(
    `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,file_hash,benefits_indexed_at)
     VALUES($1,$2,$3,'Synthetic Test Insurer (fictitious)',$4,'SYNTHETIC-PA-1','Personal Accident','personal_schedule',true,95,'ready',$5,$5,'2022-01-01',$6::jsonb,'scan_clean',$7,now())`,
    [paSchedule, householdId, relative, paProduct, `${prefix}-pa-schedule.pdf`, JSON.stringify({ productsMentioned: [paProduct] }), `sha256:${paSchedule}`]);
  await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)`, [paSchedule, relative, householdId]);
  await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)`, [householdId, paSchedule, paText]);
  await pool.query(`INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,1,1,$5,$6::vector)`,
    [randomUUID(), householdId, relative, paSchedule, paText, "[" + Array.from({ length: 1024 }, (_, j) => (j === 0 ? 1 : 0)).join(",") + "]"]);
  await pool.query(`UPDATE policies SET conditions_indexed_at=now() WHERE id=$1`, [paSchedule]).catch(() => undefined);
  await pool.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed)
    VALUES($1,$2,$3,$4,'Personal Accident',100000,'SGD',$5,1,$6,true,true)`, [randomUUID(), householdId, paSchedule, relative, paProduct, "Accidental death sum insured: S$100,000"]);
  const scheduleText = `${prefix}-Claimant owns ${product}. Critical illness sum insured: S$350,000. SYNTHETIC TEST DOCUMENT - NOT A REAL POLICY.`;
  const wordingText = `${product}. We pay 100% of the Sum Insured for a qualifying critical illness. The diagnosis must satisfy the defined illness. SYNTHETIC TEST DOCUMENT.`;
  for (const [id, role, personal, text, page] of [[schedule, "personal_schedule", true, scheduleText, 1], [wording, "policy_wording", false, wordingText, 7]] as const) {
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,file_hash,benefits_indexed_at)
       VALUES($1,$2,$3,'Synthetic Test Insurer (fictitious)',$4,'SYNTHETIC-1','Critical Illness',$5,$6,$7,'ready',$8,$8,'2022-01-01',$9::jsonb,'scan_clean',$10,now())`,
      [id, householdId, member, product, role, personal, personal ? 95 : 60, `${prefix}-${role}.pdf`, JSON.stringify({ productsMentioned: [product] }), `sha256:${id}`]);
    await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)`, [id, member, householdId]);
    await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)`, [householdId, id, page, text]);
    await pool.query(`INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)`,
      [randomUUID(), householdId, member, id, page, text, "[" + Array.from({ length: 1024 }, (_, j) => (j === 0 ? 1 : 0)).join(",") + "]"]);
  }
  await pool.query(`UPDATE policies SET conditions_indexed_at=now() WHERE id = ANY($1::uuid[])`, [[schedule, wording]]).catch(() => undefined);
  await pool.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed)
    VALUES($1,$2,$3,$4,'Critical Illness',350000,'SGD',$5,1,$6,true,true)`, [randomUUID(), householdId, schedule, member, product, "Critical illness sum insured: S$350,000"]);
  await pool.query(`INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review)
    VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)`, [householdId, wording, product]);

  // ---- Evidence-gated fixture: one member, three critical-illness covers ----
  // SGD (certificate writes S$), USD (certificate writes US$), and one whose
  // certificate writes no currency at all. The wording is the production CI
  // parser's own format (scripts/fixtures/reviewer-benefit-wording.ts).
  const patient = randomUUID();
  const patientName = `${prefix}-Patient`;
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$3,'spouse')`, [patient, householdId, patientName]);
  const lcWording = "Group Living Care benefit summary. Critical Illness Benefit: 100% of the Sum Insured is payable upon diagnosis of a covered Critical Illness.";
  const waiting = "Living Care waiting period. A waiting period of 90 days applies to the Critical Illness Benefit from the cover start date.";
  const covers: { key: string; policyNumber: string; amount: number; currency: string; evidence: string }[] = [
    { key: "sgd", policyNumber: `${prefix}-LC-SGD`, amount: 200000, currency: "SGD", evidence: "Living Care sum insured: S$200,000" },
    { key: "usd", policyNumber: `${prefix}-LC-USD`, amount: 100000, currency: "USD", evidence: "Living Care sum insured: US$100,000" },
    { key: "unstated", policyNumber: `${prefix}-LC-NOCCY`, amount: 50000, currency: "SGD", evidence: "Living Care sum insured: 50,000" },
  ];
  const policyIds: Record<string, string> = {};
  for (const c of covers) {
    const id = randomUUID(); policyIds[c.key] = id;
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,quarantine_status,file_hash,benefits_indexed_at)
       VALUES($1,$2,$3,'Singlife','Living Care',$4,'G007500','Critical Illness','certificate',true,90,'ready',$5,$5,'2020-01-01','scan_clean',$6,now())`,
      [id, householdId, patient, c.policyNumber, `${c.policyNumber}.pdf`, `sha256:${id}`]);
    await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)`, [id, patient, householdId]);
    const pages: [number, string][] = [[1, `Certificate of insurance. SYNTHETIC TEST DOCUMENT. Insured person: ${patientName}. ${c.evidence}.`], [4, lcWording], ...(c.key === "sgd" ? [[5, waiting] as [number, string]] : [])];
    for (const [page, text] of pages) {
      await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)`, [householdId, id, page, text]);
      await pool.query(`INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)`,
        [randomUUID(), householdId, patient, id, page, text, "[" + Array.from({ length: 1024 }, (_, j) => (j === 1 ? 1 : 0)).join(",") + "]"]);
    }
    await pool.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed)
      VALUES($1,$2,$3,$4,'Critical Illness',$5,$6,'Living Care',1,$7,true,true)`, [randomUUID(), householdId, id, patient, c.amount, c.currency, c.evidence]);
  }
  // A stored rule so the chat can record the claim; the estimate itself only
  // ever comes from the evidence-gated engine.
  await pool.query(`INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review)
    VALUES($1,$2,'Living Care','Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,NULL,4,'100% of the Sum Insured is payable upon diagnosis of a covered Critical Illness.','[]'::jsonb,'[]'::jsonb,false)`, [householdId, policyIds.sgd]);
  await writeFile(path.resolve(process.env.E2E_SEED_FILE || ".e2e-seed.json"), JSON.stringify({ household: householdId, claimant: member, patient, patientName, policyIds }, null, 2));
  console.log(`seeded synthetic claim fixtures for the synthetic household (members ${member}, ${patient})`);
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

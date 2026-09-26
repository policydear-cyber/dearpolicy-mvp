/**
 * Seeds ONE clearly labelled synthetic claim fixture into household A of the
 * local CI database, the way the system suite's catalogued-benefit fixture
 * does: a personal schedule that writes its currency, the cited wording page,
 * the verified coverage row and a stored benefit rule. Local database only;
 * every name carries the run's SYNTHETIC-DPTEST prefix so cleanup finds it.
 */
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db/client";

async function main() {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`seed refuses non-local database host "${host}"`);
  if (!process.env.E2E_RUN_ID) throw new Error("E2E_RUN_ID is required");
  const prefix = `SYNTHETIC-DPTEST-${process.env.E2E_RUN_ID.replace(/[^A-Za-z0-9]/g, "").slice(-12)}`;
  const household = (await pool.query<{ household_id: string }>(`SELECT household_id::text FROM household_members WHERE user_id=$1 LIMIT 1`, [process.env.E2E_USER_A])).rows[0]?.household_id;
  if (!household) throw new Error("household A is not provisioned");
  const member = randomUUID(), schedule = randomUUID(), wording = randomUUID();
  const product = `${prefix} Critical Illness Plan`;
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,'self')`, [member, household, `${prefix}-Claimant`]);
  const scheduleText = `${prefix}-Claimant owns ${product}. Critical illness sum insured: S$350,000. SYNTHETIC TEST DOCUMENT - NOT A REAL POLICY.`;
  const wordingText = `${product}. We pay 100% of the Sum Insured for a qualifying critical illness. The diagnosis must satisfy the defined illness. SYNTHETIC TEST DOCUMENT.`;
  for (const [id, role, personal, text, page] of [[schedule, "personal_schedule", true, scheduleText, 1], [wording, "policy_wording", false, wordingText, 7]] as const) {
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,file_hash,benefits_indexed_at)
       VALUES($1,$2,$3,'Synthetic Test Insurer (fictitious)',$4,'SYNTHETIC-1','Critical Illness',$5,$6,$7,'ready',$8,$8,'2022-01-01',$9::jsonb,'scan_clean',$10,now())`,
      [id, household, member, product, role, personal, personal ? 95 : 60, `${prefix}-${role}.pdf`, JSON.stringify({ productsMentioned: [product] }), `sha256:${id}`]);
    await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)`, [id, member, household]);
    await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)`, [household, id, page, text]);
    await pool.query(`INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)`,
      [randomUUID(), household, member, id, page, text, "[" + Array.from({ length: 1024 }, (_, j) => (j === 0 ? 1 : 0)).join(",") + "]"]);
  }
  await pool.query(`UPDATE policies SET conditions_indexed_at=now() WHERE id = ANY($1::uuid[])`, [[schedule, wording]]).catch(() => undefined);
  await pool.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed)
    VALUES($1,$2,$3,$4,'Critical Illness',350000,'SGD',$5,1,$6,true,true)`, [randomUUID(), household, schedule, member, product, "Critical illness sum insured: S$350,000"]);
  await pool.query(`INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review)
    VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)`, [household, wording, product]);
  console.log(`seeded synthetic claim fixture for household A (member ${member})`);
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

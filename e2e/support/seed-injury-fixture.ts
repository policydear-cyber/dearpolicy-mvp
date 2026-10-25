/**
 * Seeds the synthetic injury-chat fixture into household A of the LOCAL
 * database: a family member "Josephine" (every name carries the run's
 * SYNTHETIC-DPTEST prefix) with one synthetic personal-accident schedule
 * whose stored benefit rules include a permanent-loss arm row, a genuine
 * fracture benefit and an accident medical reimbursement benefit -- the
 * shape of the live defect where "broke her arm" surfaced "Loss of arm".
 * A second synthetic member holds an identical policy for isolation.
 * Local database only; refuses any other host.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/lib/db/client";

const VECTOR = "[" + Array.from({ length: 1024 }, (_, j) => (j === 2 ? 1 : 0)).join(",") + "]";

async function seedPolicy(householdId: string, memberId: string, memberName: string, prefix: string, tag: string) {
  const id = randomUUID();
  const product = `${prefix} Personal Accident Plan ${tag}`;
  await pool.query(
    `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,file_hash,benefits_indexed_at)
     VALUES($1,$2,$3,'Synthetic Test Insurer (fictitious)',$4,$5,'Personal Accident','personal_schedule',true,95,'ready',$6,$6,'2022-01-01',$7::jsonb,'scan_clean',$8,now())`,
    [id, householdId, memberId, product, `${prefix}-PA-${tag}`, `${prefix}-pa-${tag}.pdf`, JSON.stringify({ productsMentioned: [product] }), `sha256:${id}`]);
  await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)`, [id, memberId, householdId]);
  const pages: [number, string][] = [
    [1, `Certificate of insurance. SYNTHETIC TEST DOCUMENT - NOT A REAL POLICY. Insured person: ${memberName}. ${product}. Sum insured: S$100,000.`],
    [3, `Schedule of benefits. Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist): 100% of the Sum Insured. Fracture of arm: S$1,000. Accident medical reimbursement: up to S$2,000 per accident. SYNTHETIC TEST DOCUMENT.`],
  ];
  for (const [page, text] of pages) {
    await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)`, [householdId, id, page, text]);
    await pool.query(`INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)`,
      [randomUUID(), householdId, memberId, id, page, text, VECTOR]);
  }
  await pool.query(`UPDATE policies SET conditions_indexed_at=now() WHERE id=$1`, [id]).catch(() => undefined);
  await pool.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed)
    VALUES($1,$2,$3,$4,'Personal Accident',100000,'SGD',$5,1,'Sum insured: S$100,000',true,true)`, [randomUUID(), householdId, id, memberId, product]);
  const rules: [string, string[], string, number, string | null, string][] = [
    ["Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist)", ["accident", "bodily_injury", "disability"], "sum_insured", 1, null,
      "Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist): 100% of the Sum Insured."],
    ["Fracture of arm", ["accident", "bodily_injury"], "fixed", 1000, null, "Fracture of arm: S$1,000."],
    ["Accident medical reimbursement", ["accident", "bodily_injury", "medical_expense"], "expense_cap", 2000, "hospitalBill",
      "Accident medical reimbursement: up to S$2,000 per accident."],
  ];
  for (const [name, traits, kind, value, factKey, quote] of rules)
    await pool.query(`INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,fact_key,source_page,quote,conditions,requirements,needs_review)
      VALUES($1,$2,$3,$4,$5::text[],$6,$7,'SGD',$8,3,$9,'[]'::jsonb,'[]'::jsonb,false)`, [householdId, id, product, name, traits, kind, value, factKey, quote]);
  return id;
}

async function main() {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`seed refuses non-local database host "${host}"`);
  if (!process.env.E2E_RUN_ID) throw new Error("E2E_RUN_ID is required");
  const prefix = `SYNTHETIC-DPTEST-${process.env.E2E_RUN_ID.replace(/[^A-Za-z0-9]/g, "").slice(-12)}`;
  const household = (await pool.query<{ household_id: string; name: string }>(
    `SELECT hm.household_id::text, a.name FROM household_members hm JOIN accounts a ON a.id=hm.household_id WHERE hm.user_id=$1 LIMIT 1`, [process.env.E2E_USER_A])).rows[0];
  if (!household) throw new Error("the synthetic household is not provisioned");
  if (!household.name.startsWith(prefix)) throw new Error("seed refuses a household whose name does not carry this run's synthetic prefix");
  const householdId = household.household_id;
  const josephine = randomUUID(), other = randomUUID();
  // Josephine is the display name the chat resolves; the synthetic marker is
  // kept in preferred_name-free legal name so cleanup still finds the rows via
  // the household prefix.
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Josephine','spouse')`, [josephine, householdId]);
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Bob','child')`, [other, householdId]);
  const josephinePolicy = await seedPolicy(householdId, josephine, "Josephine", prefix, "C");
  const otherPolicy = await seedPolicy(householdId, other, "Bob", prefix, "B");
  await writeFile(path.resolve(process.env.E2E_INJURY_SEED_FILE || ".e2e-injury-seed.json"),
    JSON.stringify({ household: householdId, josephine, other, josephinePolicy, otherPolicy }, null, 2));
  console.log("seeded synthetic injury-chat fixture");
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

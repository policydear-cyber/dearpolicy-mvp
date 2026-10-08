/**
 * Seeds the adversarial suite's two synthetic households (scripts/fixtures/rag2-adv/household.ts: Tan and Nair) into
 * the LOCAL PostgreSQL database for the browser spec e2e/tests/rag2-conversation.spec.ts. Fixed synthetic ids; every
 * account name carries the SYNTHETIC-DPTEST prefix. Local database only; refuses any other host.
 *   node --import tsx e2e/support/seed-rag2-conversation.ts            # (re)seed
 *   node --import tsx e2e/support/seed-rag2-conversation.ts --cleanup  # remove everything it seeded
 */
import { pool } from "@/lib/db/client";
import { ACCOUNT_N, ACCOUNT_T, DOCS, MEMBERS } from "../../scripts/fixtures/rag2-adv/household";

const ACCOUNTS = [ACCOUNT_T, ACCOUNT_N];
async function cleanup() {
  for (const t of ["chat_messages", "chat_conversations", "policy_pages", "policy_members", "policies", "family_members", "model_usage", "household_members"]) {
    const col = t === "household_members" ? "household_id" : "account_id";
    await pool.query(`DELETE FROM ${t} WHERE ${col} = ANY($1::uuid[])`, [ACCOUNTS]).catch(() => undefined);
  }
  await pool.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND name LIKE 'SYNTHETIC-DPTEST-%'`, [ACCOUNTS]);
}
async function main() {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`seed refuses non-local database host "${host}"`);
  await cleanup();
  if (process.argv.includes("--cleanup")) { console.log("removed the rag2 adversarial households"); await pool.end(); return; }
  await pool.query("INSERT INTO accounts(id,name) VALUES($1,'SYNTHETIC-DPTEST-rag2adv Household Tan'),($2,'SYNTHETIC-DPTEST-rag2adv Household Nair')", [ACCOUNT_T, ACCOUNT_N]);
  for (const a of ACCOUNTS) await pool.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [a]).catch(() => undefined);
  for (const p of MEMBERS) await pool.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, p.account, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'ready',$9,$9,'scan_clean','active',$10,$11,$12,$13)`,
      [d.id, d.account, d.owner, d.insurer, d.product, d.policyNumber, d.policyType, d.role, "synthetic-dptest-" + d.key.toLowerCase() + ".pdf", d.superseded ? new Date().toISOString() : null, d.hash, d.effective, d.expiry]);
    for (const m of d.members) await pool.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, d.account, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await pool.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [d.account, d.id, Number(page), text]);
  }
  console.log("seeded the rag2 adversarial households (Tan, Nair)");
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

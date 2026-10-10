/**
 * Seeds the live-model smoke's synthetic household Lim (scripts/fixtures/rag2-live/household.ts) into the LOCAL
 * PostgreSQL database, the same way e2e/support/seed-rag2-conversation.ts seeds the browser spec's households (rows as
 * ingestion leaves them: policies 'ready' + scan_clean, policy_members, policy_pages). Fixed synthetic ids; the account
 * name carries the SYNTHETIC-DPTEST prefix. Local database only; refuses any other host. A reseed first removes
 * everything the household had (its chats, jobs, claims, ledger and provenance rows), so each run starts clean.
 *   node --import tsx e2e/support/seed-rag2-live.ts            # (re)seed
 *   node --import tsx e2e/support/seed-rag2-live.ts --cleanup  # remove everything it seeded
 */
import { pathToFileURL } from "node:url";
import { pool } from "@/lib/db/client";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { ACCOUNT_L, DOCS, LIVE_ACCOUNT_NAME, MEMBERS } from "../../scripts/fixtures/rag2-live/household";

export function assertLocalDatabase(url = process.env.DATABASE_URL ?? "") {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`refusing non-local database host "${host}"`);
}

export async function cleanupLive(): Promise<void> {
  assertLocalDatabase();
  const ref = pseudonymizeId(ACCOUNT_L);
  await pool.query("DELETE FROM model_executions WHERE household_ref = $1", [ref]).catch(() => undefined);
  for (const t of ["chat_analysis_jobs", "chat_messages", "chat_conversations", "claim_sessions", "policy_pages", "policy_members", "policies", "family_members", "model_usage", "household_members"]) {
    const col = t === "household_members" ? "household_id" : "account_id";
    await pool.query(`DELETE FROM ${t} WHERE ${col} = $1::uuid`, [ACCOUNT_L]).catch(() => undefined);
  }
  await pool.query("DELETE FROM accounts WHERE id = $1::uuid AND name LIKE 'SYNTHETIC-DPTEST-%'", [ACCOUNT_L]);
}

export async function seedLive(): Promise<void> {
  assertLocalDatabase();
  await cleanupLive();
  await pool.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT_L, LIVE_ACCOUNT_NAME]);
  await pool.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [ACCOUNT_L]).catch(() => undefined);
  for (const p of MEMBERS) await pool.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, p.account, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'ready',$9,$9,'scan_clean','active',NULL,$10,$11,$12)`,
      [d.id, d.account, d.owner, d.insurer, d.product, d.policyNumber, d.policyType, d.role, "synthetic-dptest-live-" + d.key.toLowerCase() + ".pdf", d.hash, d.effective, d.expiry]);
    for (const m of d.members) await pool.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, d.account, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await pool.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [d.account, d.id, Number(page), text]);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  (async () => {
    if (process.argv.includes("--cleanup")) { await cleanupLive(); console.log("removed the rag2 live household (Lim)"); }
    else { await seedLive(); console.log("seeded the rag2 live household (Lim)"); }
    await pool.end();
  })().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

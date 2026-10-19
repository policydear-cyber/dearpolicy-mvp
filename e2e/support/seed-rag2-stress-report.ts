/**
 * Seeds the report-layout household (scripts/fixtures/rag2-stress/report-household.ts) and its isolation neighbour
 * into the LOCAL PostgreSQL database for the browser spec e2e/tests/rag2-stress-report.spec.ts. Fixed synthetic ids;
 * account names carry the SYNTHETIC-DPTEST prefix. Local database only; refuses any other host.
 *   node --import tsx e2e/support/seed-rag2-stress-report.ts            # (re)seed
 *   node --import tsx e2e/support/seed-rag2-stress-report.ts --cleanup  # remove everything it seeded
 */
import { pool } from "@/lib/db/client";
import * as REPORT_HH from "../../scripts/fixtures/rag2-stress/report-household";
import * as BINDING_HH from "../../scripts/fixtures/rag2-binding/household";
import * as LIVELIB_HH from "../../scripts/fixtures/rag2-livelib/household";
import * as PR50_HH from "../../scripts/fixtures/rag2-pr50/household";
import * as TAN_HH from "../../scripts/fixtures/reliable-chat/tan";
import * as BOOKLET_HH from "../../scripts/fixtures/reliable-chat/booklet";
import * as ACTUAL_HH from "../../scripts/fixtures/reliable-chat/actual-lib";
import * as FRACTURE_HH from "../../scripts/fixtures/reliable-chat/fracture-conversation";
import * as DEATH_HH from "../../scripts/fixtures/reliable-chat/death-journey";
import * as DEATHVALUES_HH from "../../scripts/fixtures/reliable-chat/death-journey-actual-values";

// V1.4: `--household binding` seeds the binding household (scripts/fixtures/rag2-binding) instead.
// `--household binding-cells` seeds it with the certificate one cell per line (the s50 live runs' layout).
const CELLS = process.argv.includes("binding-cells");
// `--household livelib` seeds the live-library household; `--scan-name <name>` renames its unreadable upload.
const SCAN_NAME = process.argv.includes("--scan-name") ? process.argv[process.argv.indexOf("--scan-name") + 1] : null;
const LIVELIB = process.argv.includes("livelib") ? { ...LIVELIB_HH, DOCS: LIVELIB_HH.DOCS.map((d) => (d.key === "SCAN" && SCAN_NAME ? { ...d, filename: SCAN_NAME } : d)) } : null;
// `--household pr50` seeds the PR #50 live-failure household (file names from PR50_NAMES).
// `--household tan` seeds the reliable-chat second household (scripts/fixtures/reliable-chat/tan.ts).
// `--household booklet` seeds the actual-library repair household (scripts/fixtures/reliable-chat/booklet.ts).
const HH = process.argv.includes("deathvalues") ? DEATHVALUES_HH : process.argv.includes("deathjourney") ? DEATH_HH : process.argv.includes("fracture") ? FRACTURE_HH : process.argv.includes("actuallib") ? ACTUAL_HH : process.argv.includes("tan") ? TAN_HH : process.argv.includes("booklet") ? BOOKLET_HH : process.argv.includes("pr50") ? PR50_HH : LIVELIB ? LIVELIB : CELLS ? { ...BINDING_HH, DOCS: BINDING_HH.DOCS.map((d) => (d.key === "CERT" ? { ...d, hash: "sha256:binding-cert-cells", pages: BINDING_HH.certLayout("cells") } : d)) } : process.argv.includes("binding") ? BINDING_HH : REPORT_HH;
const { ACCOUNT, DOCS, M, OTHER_ACCOUNT } = HH as typeof REPORT_HH;

const ACCOUNTS = [ACCOUNT, OTHER_ACCOUNT];
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
  if (process.argv.includes("--cleanup")) { console.log("removed the report-layout households"); await pool.end(); return; }
  await pool.query("INSERT INTO accounts(id,name) VALUES($1,'SYNTHETIC-DPTEST-stress-report Household'),($2,'SYNTHETIC-DPTEST-stress-report Other household') ON CONFLICT (id) DO NOTHING", [ACCOUNT, OTHER_ACCOUNT]);
  for (const a of ACCOUNTS) await pool.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [a]).catch(() => undefined);
  for (const p of Object.values(M)) await pool.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, (p as { account?: string }).account ?? ACCOUNT, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    const acct = d.account ?? ACCOUNT;
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date,document_date,processing_error)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,'scan_clean',$19,$18,$13,$14,$15,$16,$17)`,
      [d.id, acct, d.owner, d.insurer, d.product, d.policyNumber, d.groupPolicyNumber ?? null, d.policyType, d.role, d.personal, d.processing ?? "ready", d.filename ?? "synthetic-dptest-" + d.key.toLowerCase() + ".pdf", d.hash, d.effective ?? null, d.expiry ?? null, d.documentDate ?? null, d.processingError ?? null, d.superseded ? new Date().toISOString() : null, (d as { lifecycle?: string }).lifecycle ?? "active"]);
    for (const m of d.members) await pool.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, acct, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await pool.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [acct, d.id, Number(page), text]);
  }
  console.log("seeded the report-layout households");
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

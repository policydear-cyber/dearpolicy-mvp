/**
 * PR #47 actual-model reproduction: the SAME synthetic household and documents the scenario-completion suite uses
 * (scripts/fixtures/rag2-scenario/household.ts), seeded into the LOCAL PostgreSQL for the live harness
 * (scripts/rag2-live/run.ts with RAG2_LIVE_HOUSEHOLD=scenario). The six user turns are fixed; nothing tells the model
 * which tools to call or what to say. Expectations are graded afterwards by scripts/rag2-live/scenario-check.ts,
 * which was written before the run.
 *
 * Dates: the reported stay (9pm 3 Oct 2026 -> 11am 5 Oct 2026, 38 hours) is after the certificate's printed "As of"
 * date (1 July 2025, effective 2025-07-01) and the wording prints no end date or expiry, so no documented period
 * excludes it; the dates are kept as given. (The certificate is still only the amount as of 1 July 2025, not proof
 * of cover in October 2026 -- the grader checks the answer says so.)
 */
import { pool } from "@/lib/db/client";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { assertLocalDatabase } from "../../e2e/support/seed-rag2-live";
import * as SCENARIO from "../fixtures/rag2-scenario/household";
import * as STRESS from "../fixtures/rag2-stress/household";
import type { Scenario } from "./scenarios";

export const SCENARIO_ACCOUNT = SCENARIO.ACCOUNT;
export const STRESS_ACCOUNT = STRESS.ACCOUNT;
export const S47: Scenario = { id: "S47", title: "PR #47 reported broken-leg conversation, extended to the bone, the fracture type and the stay times", why: "actual-model reproduction of the reported conversation", turns: [
  "Desmond broke his leg.",
  "He fell down the stairs.",
  "Yes, confirmed with an X-ray. He was also warded for two nights.",
  "Transverse fracture.",
  "The tibia. It was a closed fracture.",
  "Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.",
].map((user) => ({ user, expect: {} })) };

/** V1.3 actual-model sample on the stress-test structures (scripts/fixtures/rag2-stress/household.ts): inventory, the
 * Personal Accident amount, a wrong amount, a Simple Fracture on its fixed limit, a stay that does not reach the
 * waiting period, and an unknown member. Fixed turns; graded afterwards by scripts/rag2-live/stress-check.ts. */
export const S48: Scenario = { id: "S48", title: "V1.3 stress-test structures (anonymised): inventory, PA amount, wrong amount, Simple Fracture base, waiting period, unknown member", why: "actual-model sample of the 14 October stress-test structures", turns: [
  "What policies does my family have?",
  "How much is my personal accident cover?",
  "My personal accident cover is S$400,000, right?",
  "I fractured my leg, the tibia, when I fell down the stairs. It's a simple fracture and the X-ray confirmed it. How much can I claim?",
  "I was also in hospital for 48 hours: admitted 5 October 2026 at 10am, discharged 7 October 2026 at 10am. Does the Daily Hospital Income pay anything?",
  "What cover does Bob have?",
].map((user) => ({ user, expect: {} })) };

export async function seedScenario(which: "scenario" | "stress" = "scenario"): Promise<void> {
  const { ACCOUNT, OTHER_ACCOUNT, DOCS, M } = (which === "stress" ? STRESS : SCENARIO) as unknown as typeof SCENARIO;
  assertLocalDatabase();
  for (const acct of [ACCOUNT, OTHER_ACCOUNT]) {
    await pool.query("DELETE FROM model_executions WHERE household_ref = $1", [pseudonymizeId(acct)]).catch(() => undefined);
    for (const t of ["chat_analysis_jobs", "chat_messages", "chat_conversations", "claim_sessions", "policy_pages", "policy_members", "policies", "family_members", "model_usage", "household_members"]) {
      await pool.query(`DELETE FROM ${t} WHERE ${t === "household_members" ? "household_id" : "account_id"} = $1::uuid`, [acct]).catch(() => undefined);
    }
    await pool.query("DELETE FROM accounts WHERE id = $1::uuid AND name LIKE 'SYNTHETIC-DPTEST-%'", [acct]);
  }
  await pool.query("INSERT INTO accounts(id,name) VALUES($1,$3),($2,$4)", [ACCOUNT, OTHER_ACCOUNT, which === "stress" ? "SYNTHETIC-DPTEST-stress Household Tan (Ivan)" : "SYNTHETIC-DPTEST-scenario Household Lim (Desmond)", `SYNTHETIC-DPTEST-${which} other household`]);
  await pool.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [ACCOUNT]).catch(() => undefined);
  for (const p of Object.values(M)) await pool.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, (p as { account?: string }).account ?? ACCOUNT, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    const acct = d.account ?? ACCOUNT;
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date,document_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$17,$11,$11,'scan_clean','active',$12,$13,$14,$15,$16)`,
      [d.id, acct, d.owner, d.insurer, d.product, d.policyNumber, d.groupPolicyNumber ?? null, d.policyType, d.role, d.personal, (d as { filename?: string }).filename ?? `synthetic-dptest-${which}-` + d.key.toLowerCase() + ".pdf", d.superseded ? new Date().toISOString() : null, d.hash, d.effective ?? null, d.expiry ?? null, d.documentDate ?? null, (d as { processing?: string }).processing ?? "ready"]);
    if ((d as { processingError?: string }).processingError) await pool.query("UPDATE policies SET processing_error=$2 WHERE id=$1", [d.id, (d as { processingError?: string }).processingError]);
    for (const m of d.members) await pool.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, acct, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await pool.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [acct, d.id, Number(page), text]);
  }
}

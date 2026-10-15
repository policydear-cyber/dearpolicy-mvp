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
import * as BINDING from "../fixtures/rag2-binding/household";
import * as LIVELIB from "../fixtures/rag2-livelib/household";
import * as PR50 from "../fixtures/rag2-pr50/household";
import type { Scenario } from "./scenarios";

export const SCENARIO_ACCOUNT = SCENARIO.ACCOUNT;
export const STRESS_ACCOUNT = STRESS.ACCOUNT;
export const BINDING_ACCOUNT = BINDING.ACCOUNT;
export const LIVELIB_ACCOUNT = LIVELIB.ACCOUNT;
export const PR50_ACCOUNT = PR50.ACCOUNT;
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

/** V1.4 actual-model sample on the person / product / benefit binding structures (scripts/fixtures/rag2-binding):
 * the reported death question (then the accident date), and a paraphrase in its own conversation. Fixed turns; graded
 * afterwards by scripts/rag2-live/binding-check.ts (written before the run). */
export const S49: Scenario = { id: "S49", title: "V1.4 reported scenario: a member's death after a car accident abroad, then the accident date", why: "actual-model sample of the post-PR #48 binding failure", turns: [
  "Darren died in a car accident in Japan, what can I do?",
  "The accident happened on 3 October 2026.",
].map((user) => ({ user, expect: {} })) };
export const S49B: Scenario = { id: "S49B", title: "V1.4 paraphrase: the same event in other words", why: "paraphrase of the reported scenario", turns: [
  "Darren passed away after a traffic accident while travelling in Japan. What insurance can we claim for him?",
].map((user) => ({ user, expect: {} })) };

/** V1.4 (cell-per-line layout): the reported question, then both dates, on the binding household whose certificate
 * text layer is one cell per line (RAG2_LIVE_HOUSEHOLD=binding-cells; scripts/fixtures/rag2-binding certLayout("cells")).
 * Graded by scripts/rag2-live/binding-check.ts version 3 (written before the run). */
export const S50: Scenario = { id: "S50", title: "V1.4 cell-per-line certificate: a member's death after a car accident abroad, then both dates", why: "actual-model sample of the one-cell-per-line roster reconstruction", turns: [
  "Darren died in a car accident in Japan, what can I do?",
  "The accident happened on 3 October 2026 and he died on 5 October 2026.",
].map((user) => ({ user, expect: {} })) };
/** The binding household with the certificate's text layer one cell per line (same people, products and amounts). */
export const BINDING_CELLS = { ...BINDING, DOCS: BINDING.DOCS.map((d) => (d.key === "CERT" ? { ...d, hash: "sha256:binding-cert-cells", pages: BINDING.certLayout("cells") } : d)) };

/** V1.5: the live verification report's six turns in its four conversations, on the live-library household
 * (scripts/fixtures/rag2-livelib; RAG2_LIVE_HOUSEHOLD=livelib). Pre-registered before s52-live-1; graded by
 * scripts/rag2-live/livelib-check.ts. The death conversation is explicitly hypothetical, as in the report. */
export const S52A: Scenario = { id: "S52A", title: "V1.5 report turns 1-2: hypothetical death in a car accident in Japan, then both dates", why: "live verification turns 1-2", turns: [
  "Hypothetically, Adrian died in a car accident in Japan. What can I do?",
  "Hypothetically, the accident happened on 3 October 2026 and Adrian died on 5 October 2026. Please explain the benefits and the next steps.",
].map((user) => ({ user, expect: {} })) };
export const S52B: Scenario = { id: "S52B", title: "V1.5 report turns 3-4: direct amounts and certificate date, then switch person and challenge a wrong PA amount", why: "live verification turns 3-4", turns: [
  "What are Adrian's Term Life and Personal Accident amounts, and what date is the certificate?",
  "And Cheryl? Her Personal Accident cover is S$1,000,000, right?",
].map((user) => ({ user, expect: {} })) };
export const S52C: Scenario = { id: "S52C", title: "V1.5 report turn 5: library inventory including unreadable files", why: "live verification turn 5", turns: [
  "List all our uploaded documents and their roles, including any files that could not be read.",
].map((user) => ({ user, expect: {} })) };
export const S52D: Scenario = { id: "S52D", title: "V1.5 report turn 6: conditional Simple Fracture arithmetic and Other Fracture", why: "live verification turn 6", turns: [
  "Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be? How is that different from Other Fracture?",
].map((user) => ({ user, expect: {} })) };

/** V1.5 (PR #51): the three prompts of the live verification after PR #50 that failed, on the anonymised PR #50
 * household (scripts/fixtures/rag2-pr50; RAG2_LIVE_HOUSEHOLD=pr50, PR50_NAMES=snake, page 13 as stored with tabs).
 * Pre-registered in docs/rag-migration/v15/EXPECTED-pr50-live-1.md; graded by scripts/rag2-live/pr50-check.ts. */
export const P50C: Scenario = { id: "P50C", title: "PR #50 report C: full document inventory by person, insurer and product, including unreadable files", why: "live verification after PR #50, conversation C", turns: [
  "What policies does my family have? List my uploaded documents by person, insurer and product. Distinguish personal certificates from reference wording and unreadable files.",
].map((user) => ({ user, expect: {} })) };
export const P50D: Scenario = { id: "P50D", title: "PR #50 report D: fixed-limit Simple Fracture illustration (50% x S$5,000)", why: "live verification after PR #50, conversation D", turns: [
  "Hypothetical document-arithmetic test for Adrian: in the uploaded Summary of Benefits, Simple Fracture has a S$5,000 limit and a Leg row of 50%. If that provision applies, what is the illustration? Distinguish this from the separate Other Fracture provision and do not promise a payment.",
].map((user) => ({ user, expect: {} })) };
export const P50A: Scenario = { id: "P50A", title: "PR #50 report A: hypothetical death with both dates -- which death benefits may apply and the next steps", why: "live verification after PR #50, conversation A (both turns in one message, to stay within the cap)", turns: [
  "Hypothetical test: Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Based on my uploaded documents, explain which death benefits may apply and what I should do next.",
].map((user) => ({ user, expect: {} })) };

export async function seedScenario(which: "scenario" | "stress" | "binding" | "binding-cells" | "livelib" | "pr50" = "scenario"): Promise<void> {
  const { ACCOUNT, OTHER_ACCOUNT, DOCS, M } = (which === "stress" ? STRESS : which === "binding" ? BINDING : which === "binding-cells" ? BINDING_CELLS : which === "livelib" ? LIVELIB : which === "pr50" ? PR50 : SCENARIO) as unknown as typeof SCENARIO;
  assertLocalDatabase();
  for (const acct of [ACCOUNT, OTHER_ACCOUNT]) {
    await pool.query("DELETE FROM model_executions WHERE household_ref = $1", [pseudonymizeId(acct)]).catch(() => undefined);
    for (const t of ["chat_analysis_jobs", "chat_messages", "chat_conversations", "claim_sessions", "policy_pages", "policy_members", "policies", "family_members", "model_usage", "household_members"]) {
      await pool.query(`DELETE FROM ${t} WHERE ${t === "household_members" ? "household_id" : "account_id"} = $1::uuid`, [acct]).catch(() => undefined);
    }
    await pool.query("DELETE FROM accounts WHERE id = $1::uuid AND name LIKE 'SYNTHETIC-DPTEST-%'", [acct]);
  }
  await pool.query("INSERT INTO accounts(id,name) VALUES($1,$3),($2,$4)", [ACCOUNT, OTHER_ACCOUNT, which === "stress" ? "SYNTHETIC-DPTEST-stress Household Tan (Ivan)" : which.startsWith("binding") ? `SYNTHETIC-DPTEST-${which} Household Tan (Darren)` : which === "livelib" ? "SYNTHETIC-DPTEST-livelib Household Wong (Adrian)" : which === "pr50" ? "SYNTHETIC-DPTEST-pr50 Household Wong (Adrian)" : "SYNTHETIC-DPTEST-scenario Household Lim (Desmond)", `SYNTHETIC-DPTEST-${which} other household`]);
  await pool.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [ACCOUNT]).catch(() => undefined);
  for (const p of Object.values(M)) await pool.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, (p as { account?: string }).account ?? ACCOUNT, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    const acct = d.account ?? ACCOUNT;
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date,document_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$17,$11,$11,'scan_clean',$18,$12,$13,$14,$15,$16)`,
      [d.id, acct, d.owner, d.insurer, d.product, d.policyNumber, d.groupPolicyNumber ?? null, d.policyType, d.role, d.personal, (d as { filename?: string }).filename ?? `synthetic-dptest-${which}-` + d.key.toLowerCase() + ".pdf", d.superseded ? new Date().toISOString() : null, d.hash, d.effective ?? null, d.expiry ?? null, d.documentDate ?? null, (d as { processing?: string }).processing ?? "ready", (d as { lifecycle?: string }).lifecycle ?? "active"]);
    if ((d as { processingError?: string }).processingError) await pool.query("UPDATE policies SET processing_error=$2 WHERE id=$1", [d.id, (d as { processingError?: string }).processingError]);
    for (const m of d.members) await pool.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, acct, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await pool.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [acct, d.id, Number(page), text]);
  }
}

/** The benefit table wired to the app's database, model key and usage ledger. service.ts takes these as arguments so
 * its tests run with fakes; this file is the only place the real ones are passed in. */
import { query } from "@/lib/db/client";
import { recordUsage } from "@/lib/ai/ledger";
import type { ModelChoice } from "@/lib/ai/providers";
import { benefitTableModel, benefitTableStatus } from "./flag";
import { ledgerUsage } from "@/lib/simple-chat/model";
import { anthropicTableModel } from "./model";
import { policyJobLive } from "@/lib/rag/live-job";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import { readDocument, relink, tableReady, type Db, type OnUsage } from "./service";

export const appDb: Db = async (sql, params) => (await query(sql, params)).rows;

/** Switched on for this account (DEARPOLICY_ALPHA_ACCOUNTS), and the additive tables (sql/benefit-table.sql) exist. */
export async function benefitTableLive(accountId: string): Promise<boolean> {
  return benefitTableLiveFor(appDb, process.env, accountId);
}

/** The same decision for any database (tests pass a fake). For a household the all-accounts switch reaches (not on the
 * alpha list):
 *   1. a household with a table reading for any current document is on the table, and stays there;
 *   2. otherwise one that already has documents read the existing way (a ready current cover document that is not being
 *      read right now, or rows in coverage_rules) keeps its existing Coverage page and reading: its documents were read
 *      before the table existed, so the table would show it no covers until each one was read again;
 *   3. otherwise (new, nothing read yet) it gets the table.
 * Table readings are checked first, so a household on the table never moves off it because the existing reading wrote
 * rows for it. If a check cannot answer, the household is kept on the existing Coverage for this request only: nothing
 * is stored, and the next request decides again. */
export async function benefitTableLiveFor(db: Db, env: NodeJS.ProcessEnv, accountId: string): Promise<boolean> {
  const status = benefitTableStatus(env, accountId);
  if (!status.enabled) return false;
  if (!(await tableReady(db).catch(() => false))) return false;
  if (status.scope !== "all") return true;
  try {
    const onTable = await db(`SELECT 1 FROM benefit_readings r JOIN policies p ON p.id=r.policy_id
      WHERE r.account_id=$1 AND p.account_id=$1 AND p.lifecycle_state='active' AND p.superseded_at IS NULL LIMIT 1`, [accountId]);
    if (onTable.length) return true;
    // A document is marked ready just before it is read into the table, so one whose reading job is still live is not
    // "read before"; nor is a receipt, statement or letter, which is never read into the table.
    const readBefore = await db(`SELECT 1 FROM policies WHERE account_id=$1 AND lifecycle_state='active' AND superseded_at IS NULL
      AND processing_status='ready' AND COALESCE(document_role,'') <> ALL($2::text[]) AND NOT (${policyJobLive("policies")}) LIMIT 1`,
      [accountId, [...NO_COVER_READING_ROLES]]);
    if (readBefore.length) return false;
    const ledger = await db("SELECT to_regclass('public.coverage_rules') IS NOT NULL AS ok", []);
    if (ledger[0]?.ok !== true) return true;
    return (await db("SELECT 1 FROM coverage_rules WHERE account_id=$1 LIMIT 1", [accountId])).length === 0;
  } catch { return false; }
}

/** Priced at the configured model (the reply may name a dated version the price table does not list). Cache reads and
 * writes are booked the way the simple chat books them (ledgerUsage), so the ledger counts every prompt token. */
function usage(accountId: string, choice: ModelChoice): OnUsage {
  return (_what, reply) => recordUsage({ accountId, role: "reading", choice,
    ...ledgerUsage({ input: reply.input, output: reply.output, cacheRead: reply.cacheRead ?? 0, cacheWrite: reply.cacheWrite ?? 0 }),
    durationMs: reply.ms, ok: reply.json != null });
}

/** On upload and on Read again: reads the document into the table, then re-links the household's sections to covers. */
export async function readIntoBenefitTable(accountId: string, policyId: string) {
  const model = anthropicTableModel(benefitTableModel());
  const read = await readDocument(appDb, model, accountId, policyId, usage(accountId, model.choice));
  const linked = read.read ? await relink(appDb, model, accountId, usage(accountId, model.choice)) : { proposed: 0 };
  return { ...read, linked: linked.proposed };
}

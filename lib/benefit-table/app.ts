/** The benefit table wired to the app's database, model key and usage ledger. service.ts takes these as arguments so
 * its tests run with fakes; this file is the only place the real ones are passed in. */
import { query } from "@/lib/db/client";
import { recordUsage } from "@/lib/ai/ledger";
import type { ModelChoice } from "@/lib/ai/providers";
import { benefitTableModel, benefitTableStatus } from "./flag";
import { ledgerUsage } from "@/lib/simple-chat/model";
import { anthropicTableModel } from "./model";
import { readDocument, relink, tableReady, type Db, type OnUsage } from "./service";

export const appDb: Db = async (sql, params) => (await query(sql, params)).rows;

/** Switched on for this account (DEARPOLICY_ALPHA_ACCOUNTS), and the additive tables (sql/benefit-table.sql) exist. */
export async function benefitTableLive(accountId: string): Promise<boolean> {
  return benefitTableLiveFor(appDb, process.env, accountId);
}

/** The same decision for any database (tests pass a fake). A household that the all-accounts switch reaches (not on the
 * alpha list) and that already has a Coverage page from the existing reading (rows in coverage_rules) keeps that page
 * and its reading: its documents were read before the table existed, so the table would show it no covers until each
 * one was read again. A household with no existing Coverage (new, or nothing read yet) gets the table. The rule never
 * changes for a household by itself: while it is on the table, documents are read only into the table, never into
 * coverage_rules. If the check cannot answer, the household keeps what it has (the existing Coverage). */
export async function benefitTableLiveFor(db: Db, env: NodeJS.ProcessEnv, accountId: string): Promise<boolean> {
  const status = benefitTableStatus(env, accountId);
  if (!status.enabled) return false;
  if (!(await tableReady(db).catch(() => false))) return false;
  if (status.scope !== "all") return true;
  try {
    const rows = await db("SELECT to_regclass('public.coverage_rules') IS NOT NULL AS ok", []);
    if (rows[0]?.ok !== true) return true;
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

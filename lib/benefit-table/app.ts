/** The benefit table wired to the app's database, model key and usage ledger. service.ts takes these as arguments so
 * its tests run with fakes; this file is the only place the real ones are passed in. */
import { query } from "@/lib/db/client";
import { recordUsage } from "@/lib/ai/ledger";
import type { ModelChoice } from "@/lib/ai/providers";
import { benefitTableEnabled, benefitTableModel } from "./flag";
import { ledgerUsage } from "@/lib/simple-chat/model";
import { anthropicTableModel } from "./model";
import { readDocument, relink, tableReady, type Db, type OnUsage } from "./service";

export const appDb: Db = async (sql, params) => (await query(sql, params)).rows;

/** Switched on for this account (DEARPOLICY_ALPHA_ACCOUNTS), and the additive tables (sql/benefit-table.sql) exist. */
export async function benefitTableLive(accountId: string): Promise<boolean> {
  if (!benefitTableEnabled(process.env, accountId)) return false;
  return tableReady(appDb).catch(() => false);
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

/**
 * Whether this household's chat turn goes to the simple chat. The alpha list decides as before (simpleChatStatus). A
 * household reached only by DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS gets it only when it is on the benefit table
 * (benefitTableLive): without the table's rows the simple chat sends the household's whole library and none of the
 * row guards (amountsFromRows) apply, so a household the table keeps on its existing reading keeps the existing chat.
 * If the table check cannot answer, the existing chat answers this turn.
 */
import { simpleChatStatus } from "./flag";

export async function simpleChatFor(accountId: string | null | undefined, env: NodeJS.ProcessEnv = process.env,
  tableLive: (accountId: string) => Promise<boolean> = async (id) => { const m = await import("@/lib/benefit-table/app"); return m.benefitTableLiveFor(m.appDb, env, id); }): Promise<boolean> {
  const status = simpleChatStatus(env, accountId);
  if (!status.enabled) return false;
  if (status.scope !== "all") return true;
  return !!accountId && (await tableLive(accountId).catch(() => false)) === true;
}

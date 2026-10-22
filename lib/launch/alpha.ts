/**
 * DEARPOLICY_ALPHA_ACCOUNTS: the accounts a switched-on alpha feature (the benefit table, the simple chat) is shown to,
 * as account ids separated by commas or spaces. Fail-safe: in a production build a feature is on only for an account
 * named here, so an unset or empty list, or a caller that does not say which account, keeps it off for everyone.
 * Outside production an unset list allows every account (local runs and tests), and a set list limits them as in
 * production.
 */
import { isProduction } from "./guards";

const productionBuild = (env: NodeJS.ProcessEnv) => isProduction(env) || (env.VERCEL ?? "").trim() !== "" || (env.VERCEL_ENV ?? "").trim() !== "";
export const alphaAccounts = (env: NodeJS.ProcessEnv = process.env) =>
  (env.DEARPOLICY_ALPHA_ACCOUNTS ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

export function alphaAccountAllowed(accountId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = alphaAccounts(env);
  if (!list.length) return !productionBuild(env);
  return !!accountId && list.includes(accountId.trim().toLowerCase());
}

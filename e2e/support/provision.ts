/**
 * Creates the two synthetic households the way sign-up does
 * (lib/household/repo.ts ensureDefaultHousehold), because Supabase Auth --
 * which normally triggers it -- is not available in CI. Local database only.
 */
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { pool } from "@/lib/db/client";

async function main() {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`provision refuses non-local database host "${host}"`);
  const prefix = `SYNTHETIC-DPTEST-${(process.env.E2E_RUN_ID ?? "").replace(/[^A-Za-z0-9]/g, "").slice(-12)}`;
  if (!process.env.E2E_RUN_ID) throw new Error("E2E_RUN_ID is required so every synthetic name carries the run prefix");
  const a = await ensureDefaultHousehold(process.env.E2E_USER_A ?? "", `${prefix}-Household-A`);
  const b = await ensureDefaultHousehold(process.env.E2E_USER_B ?? "", `${prefix}-Household-B`);
  console.log(`provisioned synthetic households A=${a} B=${b}`);
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

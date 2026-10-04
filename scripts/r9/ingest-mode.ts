/**
 * Round 9: building a fixture household with the ingestion chaos stand-in
 * (lib/ai/chaos-ingest.ts). R9_INGEST_SEED=<n> makes every document of the
 * Round 6/7 fixtures be READ under ingest-chaos-<n>; the chat afterwards runs
 * on the normal stand-in, so whatever reached an answer was planted at upload.
 */
export const ingestSeed = () => (process.env.R9_INGEST_SEED ?? "").trim();

/** Switches document reading to the ingestion chaos stand-in; returns the undo, or null when R9_INGEST_SEED is unset. */
export function enterIngestChaos(householdNames: string[]): (() => void) | null {
  const seed = ingestSeed();
  if (!seed) return null;
  const keys = ["NODE_ENV", "DEARPOLICY_DETERMINISTIC_MODEL", "E2E_RUN_ID"] as const;
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env as Record<string, string | undefined>, { NODE_ENV: "test", DEARPOLICY_DETERMINISTIC_MODEL: "ingest-chaos-" + seed, E2E_RUN_ID: process.env.E2E_RUN_ID || "r9ingest" });
  (globalThis as { __dpChaosHouseholdNames?: string[] }).__dpChaosHouseholdNames = householdNames;
  return () => {
    const env = process.env as Record<string, string | undefined>;
    for (const k of keys) { if (before[k] === undefined) delete env[k]; else env[k] = before[k]; }
    delete (globalThis as { __dpChaosHouseholdNames?: string[] }).__dpChaosHouseholdNames;
  };
}

/** Under R9 a document that fails to read is a legitimate outcome (the household sees it as failed), not a broken fixture. */
export async function tolerateUnderChaos(work: () => Promise<unknown>) {
  if (!ingestSeed()) { await work(); return; }
  try { await work(); } catch (error) { if (process.env.R9_DEBUG) process.stderr.write("R9 document failed: " + (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 1500) + "\n"); }
}

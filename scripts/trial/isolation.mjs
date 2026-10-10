/**
 * The trial's isolation boundary (scripts/trial/start.sh runs this FIRST -- before any database command, db:setup,
 * build, server or model call). Plain Node, no dependencies, no network, no database connection.
 *
 *   node scripts/trial/isolation.mjs        prints "cap=<usd>" and "allocation=<id>" when every check holds;
 *                                           otherwise prints "[trial] refused: <reason>" on stderr and exits 1.
 *
 * Checks, in order:
 *   1. Codespace only: CODESPACES=true and a CODESPACE_NAME.
 *   2. The database is LOCAL: TRIAL_DATABASE_URL (when set) and any pre-set DATABASE_URL must be postgres URLs on
 *      localhost / 127.0.0.1 / ::1, with no host / hostaddr override in the query string; PGHOST / PGHOSTADDR, when
 *      set, must be local too. A remote URL is refused here, before anything could connect to it.
 *   3. Storage and credentials: STORAGE_DRIVER unset or "local"; LOCAL_STORAGE_DIR unset; no Supabase URL or
 *      service-role key; not a Vercel environment.
 *   4. The budget: the trial spends only a FIXED allowance reserved in advance in the durable exercise ledger
 *      (docs/rag-migration/live/LEDGER.json, entry kind "trial_allocation", status "open"); the automated live runs
 *      see that reservation as already used. Exactly one open allocation must exist.
 *   5. The local spend record (.trial/ledger.json), when present, must be readable, belong to that allocation and to
 *      THIS Codespace. A corrupt or foreign record is refused -- spending is never silently reset to zero.
 * What this cannot enforce: two Codespaces created at the same time each start with an empty local record, so each
 * could spend the allowance once (see docs/trial/TRIAL.md, "Budget").
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TRIAL_MAX_ALLOCATION_USD = 0.25;
export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class TrialRefusal extends Error {}
const refuse = (m) => { throw new TrialRefusal(m); };

/** A postgres URL that can only reach this machine; null when it is local, otherwise the reason. */
export function remoteDatabaseProblem(name, value) {
  if (value == null || value === "") return null;
  let u;
  try { u = new URL(value); } catch { return `${name} is not a URL`; }
  if (!["postgres:", "postgresql:"].includes(u.protocol)) return `${name} must be a postgres:// URL`;
  const host = u.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return `${name} points at "${host || "(no host)"}"; the trial database must be local (localhost / 127.0.0.1)`;
  for (const k of u.searchParams.keys()) if (/^(host|hostaddr|service)$/i.test(k)) return `${name} overrides the host in its query string (${k}=)`;
  if (!/^\/[a-z_][a-z0-9_]{0,62}$/.test(u.pathname)) return `${name} must name a plain database (letters, digits, underscores)`;
  return null;
}

/** Steps 1-3 (environment). Throws TrialRefusal with the first problem. */
export function checkEnvironment(env) {
  if (env.CODESPACES !== "true") refuse("this runs only inside a GitHub Codespace (CODESPACES=true)");
  if (!env.CODESPACE_NAME || !/^[A-Za-z0-9._-]{1,120}$/.test(env.CODESPACE_NAME)) refuse("CODESPACE_NAME is not set (not a GitHub Codespace?)");
  for (const k of ["TRIAL_DATABASE_URL", "DATABASE_URL"]) { const p = remoteDatabaseProblem(k, env[k]); if (p) refuse(p); }
  for (const k of ["PGHOST", "PGHOSTADDR"]) if (env[k] && !LOCAL_HOSTS.has(String(env[k]).toLowerCase())) refuse(`${k} points at "${env[k]}"; the trial database must be local`);
  if (env.PGSERVICE) refuse("PGSERVICE must be unset (it can name a remote database)");
  if (env.STORAGE_DRIVER && env.STORAGE_DRIVER !== "local") refuse(`STORAGE_DRIVER must be unset or "local" (got "${env.STORAGE_DRIVER}")`);
  if (env.LOCAL_STORAGE_DIR) refuse("LOCAL_STORAGE_DIR must be unset (the trial keeps files in .trial/storage)");
  for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) if (env[k]) refuse(`${k} must not be set in the trial Codespace`);
  if (env.VERCEL || env.VERCEL_ENV) refuse("VERCEL / VERCEL_ENV must be unset");
}

/** Step 4: the one open trial allocation in the exercise ledger. */
export function openAllocation(ledger) {
  if (!ledger || !Array.isArray(ledger.runs)) refuse("the exercise ledger is unreadable");
  const open = ledger.runs.filter((r) => r && r.kind === "trial_allocation" && r.status === "open");
  if (!open.length) refuse("no open trial allocation in docs/rag-migration/live/LEDGER.json (the previous one was closed after reconciliation, or none was made)");
  if (open.length > 1) refuse("more than one open trial allocation in the exercise ledger");
  const a = open[0];
  const usd = Number(a.reserved_unsettled_usd);
  if (!(usd > 0) || usd > TRIAL_MAX_ALLOCATION_USD) refuse(`the trial allocation must reserve more than 0 and at most US$${TRIAL_MAX_ALLOCATION_USD}`);
  if (Number(a.spent_usd) !== 0) refuse("the open trial allocation already records spend: reconcile it first");
  if (!/^trial-codespace-\d{1,3}$/.test(String(a.run_id))) refuse("the trial allocation's id must be trial-codespace-<n>");
  return { id: String(a.run_id), usd };
}

/** Step 5: the local spend record, or null when this Codespace has none yet. */
export function readLocalLedger(file, allocation, codespace) {
  if (!fs.existsSync(file)) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { refuse(`${file} exists but is not valid JSON: refusing to start (spending is never reset to zero); see docs/trial/TRIAL.md "Budget"`); }
  const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!j || typeof j !== "object" || !num(j.spentUsd) || !num(j.inflightUsd) || !num(j.capUsd) || typeof j.startedAt !== "string") refuse(`${file} is incomplete or damaged: refusing to start (spending is never reset to zero)`);
  if (j.allocationId !== allocation.id) refuse(`${file} belongs to allocation "${j.allocationId ?? "(none)"}", not the open allocation "${allocation.id}": reconcile it first`);
  if (j.codespace !== codespace) refuse(`${file} belongs to Codespace "${j.codespace ?? "(none)"}", not this one: the trial allocation is for one Codespace`);
  if (j.capUsd !== allocation.usd) refuse(`${file} records a cap of US$${j.capUsd}, not the allocation's US$${allocation.usd}`);
  return j;
}

/** Everything start.sh needs, in order; throws TrialRefusal. */
export function trialIsolation(env, root) {
  checkEnvironment(env);
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(path.join(root, "docs/rag-migration/live/LEDGER.json"), "utf8")); } catch { refuse("docs/rag-migration/live/LEDGER.json is missing or not valid JSON"); }
  const allocation = openAllocation(ledger);
  const local = readLocalLedger(path.join(root, ".trial/ledger.json"), allocation, env.CODESPACE_NAME);
  const spent = local ? local.spentUsd + local.inflightUsd : 0;
  if (spent >= allocation.usd) refuse(`the trial allowance is used up (US$${spent.toFixed(4)} of US$${allocation.usd}); see docs/trial/TRIAL.md "Budget"`);
  return { cap: allocation.usd, allocation: allocation.id, spent };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = trialIsolation(process.env, path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
    process.stdout.write(`cap=${r.cap}\nallocation=${r.allocation}\n`);
  } catch (e) {
    process.stderr.write(`[trial] refused: ${e instanceof TrialRefusal ? e.message : "isolation check failed: " + (e && e.message ? e.message : String(e))}\n`);
    process.exit(1);
  }
}

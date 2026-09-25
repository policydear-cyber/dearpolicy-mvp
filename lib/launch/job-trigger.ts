/**
 * launch:check verifier for production_job_execution: every durable job
 * type that request handlers enqueue must have a real production execution
 * trigger, not merely a processor function or a CLI. Recomputed from the
 * real source on every run; exercised by
 * scripts/launch-check-verifier-regressions.mjs's sabotage cycles.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const JOB_RUNNER_ROUTE = "app/api/internal/jobs/run/route.ts";
export const JOB_RUNNER_PATH = "/api/internal/jobs/run";

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

export function evaluateJobExecutionTrigger(root = process.cwd(), env: NodeJS.ProcessEnv = process.env): {
  codeProblems: string[];
  configProblems: string[];
  enqueuedJobTypes: string[];
  summary: string;
} {
  const codeProblems: string[] = [];
  const configProblems: string[] = [];

  // 1. Every job-type constant passed to enqueueJob() somewhere in lib/ or app/
  //    (plus the operator CLI that enqueues staleness audits) ...
  const enqueued = new Set<string>();
  const sources = [...walk(path.join(root, "lib")), ...walk(path.join(root, "app")), path.join(root, "scripts/model-execution-staleness-check.ts")];
  for (const file of sources) {
    if (!existsSync(file) || file.endsWith(path.join("lib", "jobs", "queue.ts"))) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/enqueueJob\([^)]*?jobType\s*:\s*([A-Z][A-Z0-9_]*_JOB_TYPE)/gs)) enqueued.add(m[1]);
  }
  // 2. ... must be registered in lib/jobs/processors.ts's PRODUCTION_JOB_TYPES.
  const processorsPath = path.join(root, "lib/jobs/processors.ts");
  const processors = existsSync(processorsPath) ? readFileSync(processorsPath, "utf8") : "";
  const registry = /export const PRODUCTION_JOB_TYPES[^=]*=\s*\[([\s\S]*?)\];/.exec(processors)?.[1] ?? "";
  if (!registry) codeProblems.push("lib/jobs/processors.ts has no PRODUCTION_JOB_TYPES registry");
  for (const t of enqueued) if (!new RegExp(`jobType:\\s*${t}\\b`).test(registry)) codeProblems.push(`${t} is enqueued but has no processor in PRODUCTION_JOB_TYPES, so it would stay queued forever`);
  if (enqueued.size === 0) codeProblems.push("found no enqueueJob() call sites to verify (the scan itself is broken)");

  // 3. A scheduled production trigger runs PRODUCTION_JOB_TYPES.
  const vercelJsonPath = path.join(root, "vercel.json");
  let crons: { path?: string; schedule?: string }[] = [];
  if (!existsSync(vercelJsonPath)) codeProblems.push("vercel.json is missing, so nothing on Vercel ever runs the job queue");
  else {
    try { crons = (JSON.parse(readFileSync(vercelJsonPath, "utf8")) as { crons?: typeof crons }).crons ?? []; }
    catch { codeProblems.push("vercel.json is not valid JSON"); }
    if (!crons.some((c) => c.path === JOB_RUNNER_PATH && typeof c.schedule === "string" && c.schedule.trim().split(/\s+/).length === 5)) {
      codeProblems.push(`vercel.json has no cron entry for ${JOB_RUNNER_PATH}, so nothing on Vercel ever runs the job queue`);
    }
  }
  const routePath = path.join(root, JOB_RUNNER_ROUTE);
  if (!existsSync(routePath)) codeProblems.push(`${JOB_RUNNER_ROUTE} is missing`);
  else {
    const route = readFileSync(routePath, "utf8");
    if (!/export\s+async\s+function\s+GET\b/.test(route)) codeProblems.push(`${JOB_RUNNER_ROUTE} has no GET handler (Vercel Cron sends GET)`);
    if (!/authorizeJobRunner\(/.test(route)) codeProblems.push(`${JOB_RUNNER_ROUTE} does not authenticate the caller with authorizeJobRunner()`);
    if (!/runJobBatch\(\s*\{\s*jobTypes:\s*PRODUCTION_JOB_TYPES/.test(route)) codeProblems.push(`${JOB_RUNNER_ROUTE} does not run PRODUCTION_JOB_TYPES through runJobBatch()`);
    if (!/export const ROUTE_AUTH = "internal" as const/.test(route)) codeProblems.push(`${JOB_RUNNER_ROUTE} is not classified ROUTE_AUTH "internal"`);
  }
  const middlewarePath = path.join(root, "middleware.ts");
  const middleware = existsSync(middlewarePath) ? readFileSync(middlewarePath, "utf8") : "";
  const internal = /const INTERNAL_CALLBACK_PATHS = new Set\(\[([\s\S]*?)\]\)/.exec(middleware)?.[1] ?? "";
  if (!internal.replace(/\/\/[^\n]*/g, "").includes(`"${JOB_RUNNER_PATH}"`)) codeProblems.push(`middleware.ts does not exempt ${JOB_RUNNER_PATH} from the session gate, so Vercel Cron would be rejected with 401`);

  // 4. External: the runner refuses every call until CRON_SECRET is set.
  if ((env.CRON_SECRET?.trim() ?? "").length < 16) configProblems.push("CRON_SECRET is not set (at least 16 characters) in this environment, so the job runner refuses every call");

  return {
    codeProblems,
    configProblems,
    enqueuedJobTypes: [...enqueued].sort(),
    summary: `${enqueued.size} enqueued job type(s) (${[...enqueued].sort().join(", ")}); cron entries: ${crons.length}; ${codeProblems.length} code problem(s), ${configProblems.length} configuration problem(s)`,
  };
}

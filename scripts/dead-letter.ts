/**
 * Checkpoint 14f (claude/v1-launch-hardening): CLI for lib/jobs/dead-letter.ts
 * -- the operational drain scripts/launch-check.ts's dead_letter_retry_support
 * diagnosis found missing. Follows the same audit-by-default, explicit
 * subcommand shape as scripts/storage-cleanup.ts (this codebase's other
 * "list what's wrong, then explicitly act on exactly one item" operator
 * tool) -- there is no admin/staff role in this app's authorization model
 * (grepped: every app/api ROUTE_AUTH is household-member/-owner/
 * authenticated/public/internal-callback, nothing operator-facing), so a
 * script -- run by whoever operates the deployment, the same way
 * storage-cleanup and household-export:cleanup already are -- is this
 * codebase's real convention for this kind of tool, not a new
 * unauthenticated or under-authenticated HTTP route.
 *
 * Usage:
 *   node --import tsx scripts/dead-letter.ts list [--job-type=<type>] [--limit=<n>]
 *   node --import tsx scripts/dead-letter.ts retry --job-id=<uuid>
 */
import { pool } from "@/lib/db/client";
import { listDeadLetterJobs, countDeadLetterJobsByType, retryDeadLetterJob, DeadLetterJobNotFoundError } from "@/lib/jobs/dead-letter";

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1], match[2]);
  }
  return flags;
}

async function runList(flags: Map<string, string>) {
  const jobType = flags.get("job-type");
  const limit = flags.get("limit") ? Number(flags.get("limit")) : undefined;
  const summary = await countDeadLetterJobsByType();
  console.log("Dead-letter counts by job type:");
  if (summary.length === 0) console.log("  (none)");
  for (const row of summary) console.log(`  ${row.jobType}: ${row.count}`);

  const rows = await listDeadLetterJobs({ jobType, limit });
  console.log(`\nShowing ${rows.length} dead-letter job(s)${jobType ? ` of type "${jobType}"` : ""}:`);
  for (const row of rows) {
    console.log(
      `  id=${row.id} jobType=${row.job_type} idempotencyKey=${row.idempotency_key} ` +
        `attempts=${row.attempt_count}/${row.max_attempts} errorCategory=${row.last_error_category ?? "-"} ` +
        `error=${(row.last_error_message ?? "-").slice(0, 120)} updatedAt=${row.updated_at}`,
    );
  }
}

async function runRetry(flags: Map<string, string>) {
  const jobId = flags.get("job-id");
  if (!jobId) {
    console.error("retry requires --job-id=<uuid>. Nothing was retried.");
    process.exitCode = 1;
    return;
  }
  try {
    const row = await retryDeadLetterJob(jobId);
    console.log(`Requeued job ${row.id} (jobType=${row.job_type}) -- status is now "${row.status}"; the next worker poll will claim it.`);
  } catch (error) {
    if (error instanceof DeadLetterJobNotFoundError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (subcommand === "retry") {
    await runRetry(flags);
  } else if (!subcommand || subcommand === "list") {
    await runList(flags);
  } else {
    console.error(`Unknown subcommand "${subcommand}". Use "list" (default, read-only) or "retry".`);
    process.exitCode = 1;
  }
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

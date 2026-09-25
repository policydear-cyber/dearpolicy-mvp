/**
 * Operator CLI for DearPolicy's internal claim reviewers -- the ONLY way a
 * reviewer or a review assignment is ever created. There is deliberately no
 * HTTP route for any of this: running this script requires direct database
 * credentials (DATABASE_URL), which is the trust boundary. Every command is
 * recorded in the append-only claim_reviewer_audit_log with --operator and
 * the database role used.
 *
 *   npm run reviewer:admin -- provision  --user <auth user uuid> --label "<display label>" --operator <name>
 *   npm run reviewer:admin -- suspend    --user <uuid> --reason "<why>" --operator <name>
 *   npm run reviewer:admin -- reactivate --user <uuid> --reason "<why>" --operator <name>
 *   npm run reviewer:admin -- assign     --reviewer <uuid> --household <uuid> --claim <uuid> [--evidence <uuid>] --hours <1-720> --operator <name>
 *   npm run reviewer:admin -- revoke     --assignment <uuid> --reason "<why>" --operator <name>
 */
import path from "node:path";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* .env.local is optional outside local dev */ }

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    flags[key.slice(2)] = value;
    i++;
  }
  return flags;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const admin = await import("../lib/claims/reviewers/admin");
  const { pool } = await import("../lib/db/client");
  try {
    let result: unknown;
    switch (command) {
      case "provision":
        result = await admin.provisionClaimReviewer({ userId: flags.user, displayLabel: flags.label, operator: flags.operator });
        break;
      case "suspend":
      case "reactivate":
        result = await admin.setClaimReviewerStatus({ userId: flags.user, status: command === "suspend" ? "suspended" : "active", reason: flags.reason, operator: flags.operator });
        break;
      case "assign":
        result = await admin.assignClaimReview({
          reviewerUserId: flags.reviewer, accountId: flags.household, claimSessionId: flags.claim, evidenceDocumentId: flags.evidence ?? null,
          expiresInHours: Number(flags.hours), operator: flags.operator,
        });
        break;
      case "revoke":
        result = await admin.revokeClaimReviewAssignment({ assignmentId: flags.assignment, reason: flags.reason, operator: flags.operator });
        break;
      default:
        throw new Error("Usage: reviewer:admin <provision|suspend|reactivate|assign|revoke> --flag value ... (see this script's header).");
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `${(error as { code?: string }).code ?? "ERROR"}: ${error.message}` : error);
  process.exitCode = 1;
});

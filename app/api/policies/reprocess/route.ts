import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { scheduleRequestDrain, startJobNow } from "@/lib/jobs/request-drain";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { pool, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { enqueuePolicyProcessing,livePolicyJob,makePolicyJobDueNow,POLICY_PROCESSING_JOB_TYPE,UNCLAIMED_STALL_MINUTES } from "@/lib/rag/processing-queue";
import { recoverExpiredLeases } from "@/lib/jobs/queue";
import { getPolicyQuarantineRow } from "@/lib/policies/quarantine/store";
import { clearCatalogCheckpoints } from "@/lib/policies/catalog-checkpoint";
import { runAfterResponse } from "@/lib/http/background";
import { createDbRateLimiter } from "@/lib/http/db-rate-limit";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
// Re-reading a document can take as long as the original upload; give the
// background job room to finish inside after() rather than being cut off.
export const maxDuration = 300;

// Each re-read is a full paid reading of the document: a household gets 20 an hour.
const rereads = createDbRateLimiter({ name: "policy-reprocess", windowMs: 60 * 60 * 1000, max: 20 });

const Schema = z.object({ policyId: z.string().uuid(), pdfPassword: z.string().optional() });

class AlreadyProcessing extends Error {}
class NotClearedForProcessing extends Error {}

export async function POST(request: NextRequest) {
  try {
    const body = Schema.parse(await request.json().catch(() => ({})));
    const ctx = await requireHouseholdContext(request);
    const allowance = await rereads.attempt(ctx.householdId);
    if (!allowance.allowed) {
      return NextResponse.json({ error: "Too many documents read again in the last hour. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(allowance.retryAfterMs / 1000)) } });
    }
    scheduleRequestDrain(); // bounded job drain after the response (lib/jobs/request-drain.ts)

    const policy = await createUserSupabaseClient(ctx.userId, async (client) => {
      // Authorize the specific policy against this household before doing
      // anything else -- a client-supplied policyId for another household's
      // document must not even reveal whether it exists.
      const result = await client.query<{ family_member_id: string; storage_key: string; processing_status: string; updated_at: string }>(
        `SELECT family_member_id,storage_key,processing_status,updated_at FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
        [body.policyId, ctx.householdId],
      );
      const row = result.rows[0];
      if (!row) return null;

      // Re-check the PERSISTED quarantine/scan state here, on every
      // reprocess request -- never assume a document that was clean once
      // is still clear to process. A document that has not (yet, or ever)
      // passed a clean scan must not be silently re-queued only to have
      // lib/rag/ingest.ts's own gate no-op it a moment later with no
      // feedback to the person who asked for it.
      const quarantine = await getPolicyQuarantineRow(ctx.householdId, body.policyId);
      if (!quarantine || (quarantine.quarantine_status !== "scan_clean" && quarantine.quarantine_status !== "not_scanned_prototype")) throw new NotClearedForProcessing();

      return row;
    });

    if (!policy) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // A document can sit in an in-flight status forever if its background
    // job died permanently: a lease expiry dead-letters the JOB, but nothing
    // marks the POLICY failed. In-flight therefore only blocks a re-analyse
    // while a live job actually backs it; otherwise the document is stalled
    // and re-queueing it IS the recovery path. The short grace covers the
    // enqueue-after-response window where the policy row is already queued
    // but its job row has not been inserted yet.
    let stalled = false;
    if (["queued", "extracting", "indexing"].includes(policy.processing_status)) {
      // A queued job nothing has claimed for UNCLAIMED_STALL_MINUTES is not live either: nothing is running it, and
      // Try again starts it (25 Oct: a document sat queued for a day behind another).
      const live = await query(
        `SELECT 1 FROM background_jobs j WHERE j.job_type=$1 AND j.idempotency_key=$2 AND ${livePolicyJob("j", "$3")}`,
        [POLICY_PROCESSING_JOB_TYPE, body.policyId, UNCLAIMED_STALL_MINUTES],
      );
      const stalledByAge = Date.now() - new Date(policy.updated_at).getTime() > 2 * 60_000;
      if (live.rows.length || !stalledByAge) throw new AlreadyProcessing();
      stalled = true;
    }

    // Processing state is server-owned: written on the trusted connection
    // (browser sessions cannot update it -- sql/household-rls.sql), only
    // after the RLS-scoped authorization and clean-scan check above, and
    // only if the document is still not in flight.
    const requeued = await query(
      `UPDATE policies SET processing_status='queued',processing_stage='queued',processing_progress=1,
       processing_message='Waiting to be analysed…',processing_error=NULL,processing_started_at=NULL,processing_completed_at=NULL,updated_at=now()
       WHERE id=$1 AND account_id=$2 AND (processing_status NOT IN ('queued','extracting','indexing') OR $3::boolean) AND quarantine_status IN ('scan_clean','not_scanned_prototype')`,
      [body.policyId, ctx.householdId, stalled],
    );
    if (!requeued.rowCount) throw new AlreadyProcessing();

    // A deliberate re-read of a finished (or failed) document starts from a
    // clean slate; a stalled document keeps its checkpoints so the new run
    // resumes the pages already read instead of repeating them.
    if (!stalled) await clearCatalogCheckpoints(ctx.householdId, body.policyId);

    // after() keeps this alive past the response instead of racing the
    // serverless instance being frozen the instant "queued" is returned.
    // Only the already-authorized, server-resolved identifiers (household id,
    // the policy's own family_member_id/storage_key) are handed to the
    // background job -- never anything client-supplied beyond the request's
    // own pdfPassword field.
    // The job then starts at once, after it is enqueued: not when a drain in flight elsewhere or the daily run gets to it.
    runAfterResponse(async () => {
      // A stalled document's job may hold a lapsed lease, or wait out a retry delay: neither would start now. The lease is
      // recovered first (a job out of attempts goes to dead letter, which the enqueue revives), then the job is made due.
      if (stalled) await recoverExpiredLeases(pool);
      await enqueuePolicyProcessing({
        accountId: ctx.householdId,
        familyMemberId: policy.family_member_id,
        policyId: body.policyId,
        storageKey: policy.storage_key,
        pdfPassword: body.pdfPassword || undefined,
        linkUploadMember: true,
      });
      if (stalled) await makePolicyJobDueNow(body.policyId);
      await startJobNow({ jobType: POLICY_PROCESSING_JOB_TYPE, idempotencyKey: body.policyId });
    });

    return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    if (error instanceof AlreadyProcessing) return NextResponse.json({ error: "This document is already being analysed." }, { status: 409 });
    if (error instanceof NotClearedForProcessing) return NextResponse.json({ error: "This document has not passed malware scanning yet and cannot be re-analysed." }, { status: 409 });
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Re-analysis failed" }, { status: 500 });
    return authResponse;
  }
}

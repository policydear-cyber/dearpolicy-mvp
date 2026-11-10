import { after, NextResponse, type NextRequest } from "next/server";
import { authorizeJobRunner, runJobBatch } from "@/lib/jobs/cron-runner";
import { PRODUCTION_JOB_TYPES } from "@/lib/jobs/processors";
import { scrubDeletedDocuments } from "@/lib/lifecycle/content-scrub";
import { purgeSoon } from "@/lib/storage/purge";
import { requeueStuckTableWorkEverywhere } from "@/lib/benefit-table/app";
import { kickHop, kickIfPending, KICK_HOP_HEADER, runKickedLink } from "@/lib/jobs/self-kick";
import { withFunctionDeadline } from "@/lib/jobs/function-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Leaves room for the job already in flight after runJobBatch() stops
// claiming (see lib/jobs/cron-runner.ts).
export const maxDuration = 300;
// Called by Vercel Cron (vercel.json), never by a browser session.
// Authenticated by CRON_SECRET (lib/jobs/cron-runner.ts's
// authorizeJobRunner); middleware.ts's INTERNAL_CALLBACK_PATHS exempts
// this exact path from the Supabase-session requirement for that reason.
export const ROUTE_AUTH = "internal" as const;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = authorizeJobRunner(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.status === 503 ? "Job runner is not configured." : "Unauthorized." },
      { status: auth.status, headers: NO_STORE },
    );
  }
  // The daily pass also finishes any document deletion whose cleanup failed
  // earlier: content scrubbed, files removed (both bounded, never throw).
  await scrubDeletedDocuments();
  await purgeSoon();
  // A long policy's table reading (or its link run) whose run died is queued again before the batch runs, so the daily run
  // goes on with it when the app is idle (lib/benefit-table/app.ts; bounded, never throws).
  await requeueStuckTableWorkEverywhere();
  try {
    const summary = await runJobBatch({ jobTypes: PRODUCTION_JOB_TYPES });
    // Work still due soon goes on without waiting for a visit or tomorrow's run (lib/jobs/self-kick.ts).
    await kickIfPending();
    return NextResponse.json({ ok: true, ...summary }, { headers: NO_STORE });
  } catch (error) {
    // Error class only: never a message, payload or identifier.
    console.error(`job runner: batch failed (${error instanceof Error ? error.name : "unknown"})`);
    return NextResponse.json({ ok: false, error: "Job batch failed." }, { status: 500, headers: NO_STORE });
  }
}

/** A link of the background chain (lib/jobs/self-kick.ts): sent by this deployment itself, with the same CRON_SECRET check
 * as the daily run. It answers at once and does its work after the response, in its own time limit. The caller chooses
 * nothing but the chain's position (bounded); the job types, batch and limits are fixed here. */
export async function POST(request: NextRequest) {
  const auth = authorizeJobRunner(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.status === 503 ? "Job runner is not configured." : "Unauthorized." },
      { status: auth.status, headers: NO_STORE },
    );
  }
  const hop = kickHop(request.headers.get(KICK_HOP_HEADER));
  const startedAt = Date.now();
  try {
    after(() => withFunctionDeadline(startedAt, async () => {
      await requeueStuckTableWorkEverywhere();
      await runKickedLink({ hop, startedAt, jobTypes: PRODUCTION_JOB_TYPES });
    }));
  } catch { /* Outside a request scope (a suite calling the handler directly): nothing to run after. */ }
  return NextResponse.json({ ok: true, accepted: true }, { status: 202, headers: NO_STORE });
}

import { NextResponse, type NextRequest } from "next/server";
import { authorizeJobRunner, runJobBatch } from "@/lib/jobs/cron-runner";
import { PRODUCTION_JOB_TYPES } from "@/lib/jobs/processors";

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
  try {
    const summary = await runJobBatch({ jobTypes: PRODUCTION_JOB_TYPES });
    return NextResponse.json({ ok: true, ...summary }, { headers: NO_STORE });
  } catch (error) {
    // Error class only: never a message, payload or identifier.
    console.error(`job runner: batch failed (${error instanceof Error ? error.name : "unknown"})`);
    return NextResponse.json({ ok: false, error: "Job batch failed." }, { status: 500, headers: NO_STORE });
  }
}

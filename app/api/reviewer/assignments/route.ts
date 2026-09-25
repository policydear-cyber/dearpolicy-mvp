import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireActiveClaimReviewer, reviewerRouteErrorResponse } from "@/lib/claims/reviewers/boundary";
import { listActiveAssignments } from "@/lib/claims/reviewers/workspace";

export const runtime = "nodejs";
export const ROUTE_AUTH = "internal-reviewer" as const;

/** The signed-in reviewer's own active, unexpired assignments -- nothing
 * else. Read-only: there is no way to create or extend an assignment over
 * HTTP (see lib/claims/reviewers/admin.ts). */
export async function GET(request: NextRequest) {
  try {
    const reviewer = await requireActiveClaimReviewer();
    const assignments = await listActiveAssignments(reviewer.userId);
    return NextResponse.json({ reviewer: { displayLabel: reviewer.displayLabel }, assignments });
  } catch (error) {
    return reviewerRouteErrorResponse(error, { request });
  }
}

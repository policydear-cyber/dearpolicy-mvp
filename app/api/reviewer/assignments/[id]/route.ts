import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAssignedClaimReviewer, reviewerRouteErrorResponse } from "@/lib/claims/reviewers/boundary";
import { loadAssignmentWorkspace } from "@/lib/claims/reviewers/workspace";
import { INDICATIVE_ESTIMATE_NOTICE } from "@/lib/claims/reviewers/copy";

export const runtime = "nodejs";
export const ROUTE_AUTH = "internal-reviewer" as const;

/** One assigned claim: its documents with the facts read from them and
 * their page citations, the family member's confirmed coverages, each
 * policy's own cited definition, and the full decision history (including
 * superseded decisions). Scoped entirely by the assignment. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const review = await requireAssignedClaimReviewer({ assignmentId: id });
    const workspace = await loadAssignmentWorkspace(review);
    return NextResponse.json({ ...workspace, notice: INDICATIVE_ESTIMATE_NOTICE });
  } catch (error) {
    return reviewerRouteErrorResponse(error, { request });
  }
}

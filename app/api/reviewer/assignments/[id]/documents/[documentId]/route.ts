import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAssignedClaimReviewer, reviewerRouteErrorResponse } from "@/lib/claims/reviewers/boundary";
import { appendReviewerAudit } from "@/lib/claims/reviewers/audit";
import { readClaimEvidenceFile } from "@/lib/storage";

export const runtime = "nodejs";
export const ROUTE_AUTH = "internal-reviewer" as const;

/** The original uploaded document, streamed through this route after the
 * assignment is re-checked on every request -- never a signed or public
 * storage URL, so revoking or expiring an assignment cuts off access to
 * the file immediately. Every view is written to the reviewer audit log. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await params;
    const review = await requireAssignedClaimReviewer({ assignmentId: id, evidenceDocumentId: documentId });
    const document = review.evidenceDocument!;
    const bytes = await readClaimEvidenceFile(document.storage_key);
    await appendReviewerAudit({
      actor: review.reviewerIdentity, action: "document_viewed", reviewerUserId: review.userId, assignmentId: review.assignmentId,
      accountId: review.accountId, claimSessionId: review.claimSessionId, evidenceDocumentId: document.id,
    });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${document.original_filename.replace(/["\r\n]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return reviewerRouteErrorResponse(error, { request });
  }
}

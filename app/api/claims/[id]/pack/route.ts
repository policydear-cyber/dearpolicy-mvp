import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { buildClaimPack } from "@/lib/claims/claim-pack";
import { EMPTY_CLAIM_FACTS, type ClaimDecisionPacket, type ClaimFacts } from "@/lib/claims/types";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "That claim could not be found." }, { status: 404 });
    const ctx = await requireHouseholdContext(request);
    const result = await query<{ decision_packet: ClaimDecisionPacket | null; facts: Partial<ClaimFacts>; event_summary: string | null; display_name: string; relationship: string }>(
      `SELECT cs.decision_packet,cs.facts,cs.event_summary,f.display_name,f.relationship
         FROM claim_sessions cs JOIN family_members f ON f.id=cs.family_member_id AND f.account_id=cs.account_id AND ${activePredicate("f")}
        WHERE cs.id=$1 AND cs.account_id=$2`,
      [id, ctx.householdId],
    );
    const row = result.rows[0];
    if (!row) return NextResponse.json({ error: "That claim could not be found." }, { status: 404 });
    if (!row.decision_packet)
      return NextResponse.json({ error: "This claim has not been assessed yet. Finish answering DearPolicy's questions and the claim pack can be prepared." }, { status: 409 });
    const packet: ClaimDecisionPacket = {
      ...row.decision_packet,
      facts: {
        ...EMPTY_CLAIM_FACTS, ...row.facts, ...row.decision_packet.facts,
        injuries: row.decision_packet.facts?.injuries ?? [], uncertainFacts: row.decision_packet.facts?.uncertainFacts ?? [],
      },
      eventSummary: row.decision_packet.eventSummary || row.event_summary || "The claimant reported an event.",
      assessments: row.decision_packet.assessments ?? [],
      missingFacts: row.decision_packet.missingFacts ?? [],
      nextSteps: row.decision_packet.nextSteps ?? [],
    };
    const pdf = await buildClaimPack({ packet, claimantName: row.display_name, relationship: row.relationship });
    const name = ("DearPolicy claim summary - " + row.display_name).replace(/[^A-Za-z0-9 .-]/g, "").trim() + ".pdf";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "The claim pack could not be prepared" }, { status: 500 });
    return authResponse;
  }
}

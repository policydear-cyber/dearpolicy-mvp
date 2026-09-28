import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { claimDisplayStatus } from "@/lib/claims/status";
import { computeIndicativeEstimate } from "@/lib/claims/indicative-assessment";
import { ensureClaimRecordSchema } from "@/lib/claims/record";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(request:NextRequest){
  try{
    const ctx = await requireHouseholdContext(request);
    const url=new URL(request.url);const member=url.searchParams.get("familyMemberId");
    if(member&&!isUuid(member))return NextResponse.json({claims:[]});
    const params:unknown[]=[ctx.householdId];let where="cs.account_id=$1";
    if(member){params.push(member);where+=` AND cs.family_member_id=$${params.length}`;}
    await ensureClaimRecordSchema();
    const result=await createUserSupabaseClient(ctx.userId, (client) =>
      client.query<{id:string;family_member_id:string;display_name:string;relationship:string;status:string;event_type:string|null;event_summary:string|null;facts:Record<string,unknown>;decision_packet:Record<string,unknown>|null;pending_question:unknown;conversation_id:string|null;claim_category:string|null;created_at:string;updated_at:string}>(
        `SELECT cs.id,cs.family_member_id,f.display_name,f.relationship,cs.status,cs.event_type,cs.event_summary,cs.facts,cs.decision_packet,cs.pending_question,cs.conversation_id,cs.claim_category,cs.created_at::text,cs.updated_at::text
           FROM claim_sessions cs JOIN family_members f ON f.id=cs.family_member_id AND f.account_id=cs.account_id AND ${activePredicate("f")}
          WHERE ${where} ORDER BY cs.updated_at DESC LIMIT 30`,params),
    );
    // The list's status, the detail page's status and the requested documents
    // come from ONE function, fed the same evidence-gated estimate the detail
    // page shows -- so "ready" here can never sit beside "No estimate yet".
    const claims=[];
    for(const row of result.rows){
      let hasEvidenceBackedEstimate=false;
      try{hasEvidenceBackedEstimate=(await computeIndicativeEstimate(ctx.householdId,row.id))?.hasEstimate===true;}
      catch(error){console.warn("[claims] estimate unavailable for the list:",error instanceof Error?error.message:error);}
      claims.push({...row,display:claimDisplayStatus({...row,hasEvidenceBackedEstimate})});
    }
    return NextResponse.json({claims});
  }catch(error){return routeErrorResponse(error);}
}

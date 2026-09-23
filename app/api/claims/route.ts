import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(request:NextRequest){
  try{
    const ctx = await requireHouseholdContext(request);
    const url=new URL(request.url);const member=url.searchParams.get("familyMemberId");
    if(member&&!isUuid(member))return NextResponse.json({claims:[]});
    const params:unknown[]=[ctx.householdId];let where="cs.account_id=$1";
    if(member){params.push(member);where+=` AND cs.family_member_id=$${params.length}`;}
    const result=await createUserSupabaseClient(ctx.userId, (client) =>
      client.query<{id:string;family_member_id:string;display_name:string;relationship:string;status:string;event_type:string|null;event_summary:string|null;facts:Record<string,unknown>;decision_packet:Record<string,unknown>|null;created_at:string;updated_at:string}>(
        `SELECT cs.id,cs.family_member_id,f.display_name,f.relationship,cs.status,cs.event_type,cs.event_summary,cs.facts,cs.decision_packet,cs.created_at::text,cs.updated_at::text
           FROM claim_sessions cs JOIN family_members f ON f.id=cs.family_member_id AND f.account_id=cs.account_id
          WHERE ${where} ORDER BY cs.updated_at DESC LIMIT 30`,params),
    );
    return NextResponse.json({claims:result.rows});
  }catch(error){return routeErrorResponse(error);}
}

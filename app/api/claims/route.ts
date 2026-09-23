import { NextResponse } from "next/server";
import { devAccountId,isUuid,query } from "@/lib/db/client";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(request:Request){
  try{
    const accountId=devAccountId();const url=new URL(request.url);const member=url.searchParams.get("familyMemberId");
    if(member&&!isUuid(member))return NextResponse.json({claims:[]});
    const params:unknown[]=[accountId];let where="cs.account_id=$1";
    if(member){params.push(member);where+=` AND cs.family_member_id=$${params.length}`;}
    const result=await query<{id:string;family_member_id:string;display_name:string;relationship:string;status:string;event_type:string|null;event_summary:string|null;facts:Record<string,unknown>;decision_packet:Record<string,unknown>|null;created_at:string;updated_at:string}>(
      `SELECT cs.id,cs.family_member_id,f.display_name,f.relationship,cs.status,cs.event_type,cs.event_summary,cs.facts,cs.decision_packet,cs.created_at::text,cs.updated_at::text
         FROM claim_sessions cs JOIN family_members f ON f.id=cs.family_member_id AND f.account_id=cs.account_id
        WHERE ${where} ORDER BY cs.updated_at DESC LIMIT 30`,params);
    return NextResponse.json({claims:result.rows});
  }catch(error){return NextResponse.json({error:"Claims lookup failed"},{status:500});}
}

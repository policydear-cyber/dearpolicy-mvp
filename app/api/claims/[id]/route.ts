import { NextResponse } from "next/server";
import { isUuid } from "@/lib/db/client";
import { factsToLabels } from "@/lib/claims/facts";
import { EMPTY_CLAIM_FACTS,type ClaimFacts, type ClaimQuestion, type ClaimDecisionPacket } from "@/lib/claims/types";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const ctx = await requireHouseholdContext();
  const {id}=await params;if(!isUuid(id))return NextResponse.json({error:"Claim session not found"},{status:404});
  const result=await createUserSupabaseClient(ctx.userId, (client) =>
    client.query<{id:string;family_member_id:string;status:string;event_summary:string|null;facts:Partial<ClaimFacts>;pending_question:ClaimQuestion|null;decision_packet:ClaimDecisionPacket|null;updated_at:string}>(
      `SELECT id,family_member_id,status,event_summary,facts,pending_question,decision_packet,updated_at::text FROM claim_sessions WHERE id=$1 AND account_id=$2`,
      [id,ctx.householdId],
    ),
  );
  const row=result.rows[0];if(!row)return NextResponse.json({error:"Claim session not found"},{status:404});
  const facts:ClaimFacts={...EMPTY_CLAIM_FACTS,...row.facts,injuries:Array.isArray(row.facts?.injuries)?row.facts.injuries:[],uncertainFacts:Array.isArray(row.facts?.uncertainFacts)?row.facts.uncertainFacts:[]};
  return NextResponse.json({claim:{...row,facts,knownFacts:factsToLabels(facts)}});
 }catch(error){return routeErrorResponse(error);}
}

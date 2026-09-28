import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { factsToLabels } from "@/lib/claims/facts";
import { EMPTY_CLAIM_FACTS,type ClaimFacts, type ClaimQuestion, type ClaimDecisionPacket } from "@/lib/claims/types";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { claimDisplayStatus } from "@/lib/claims/status";
import { computeIndicativeEstimate } from "@/lib/claims/indicative-assessment";
import { ensureClaimRecordSchema } from "@/lib/claims/record";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const ctx = await requireHouseholdContext(request);
  const {id}=await params;if(!isUuid(id))return NextResponse.json({error:"Claim session not found"},{status:404});
  await ensureClaimRecordSchema();
  const result=await createUserSupabaseClient(ctx.userId, (client) =>
    client.query<{id:string;family_member_id:string;status:string;event_type:string|null;event_summary:string|null;facts:Partial<ClaimFacts>;pending_question:ClaimQuestion|null;decision_packet:ClaimDecisionPacket|null;claim_category:string|null;updated_at:string}>(
      `SELECT id,family_member_id,status,event_type,event_summary,facts,pending_question,decision_packet,claim_category,updated_at::text FROM claim_sessions WHERE id=$1 AND account_id=$2`,
      [id,ctx.householdId],
    ),
  );
  const row=result.rows[0];if(!row)return NextResponse.json({error:"Claim session not found"},{status:404});
  const facts:ClaimFacts={...EMPTY_CLAIM_FACTS,...row.facts,injuries:Array.isArray(row.facts?.injuries)?row.facts.injuries:[],uncertainFacts:Array.isArray(row.facts?.uncertainFacts)?row.facts.uncertainFacts:[]};
  let hasEvidenceBackedEstimate=false;
  try{hasEvidenceBackedEstimate=(await computeIndicativeEstimate(ctx.householdId,row.id))?.hasEstimate===true;}
  catch(error){console.warn("[claims] estimate unavailable for the detail:",error instanceof Error?error.message:error);}
  return NextResponse.json({claim:{...row,facts,knownFacts:factsToLabels(facts),display:claimDisplayStatus({...row,hasEvidenceBackedEstimate})}});
 }catch(error){return routeErrorResponse(error);}
}

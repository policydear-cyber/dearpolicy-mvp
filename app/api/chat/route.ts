import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { askDearPolicy } from "@/lib/rag/chat";
import { enqueueChat } from "@/lib/chat/jobs";
import { ChatConflict } from "@/lib/chat/store";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration=300;
const BodySchema=z.object({
  familyMemberId:z.string().uuid().nullable(),
  scope:z.enum(["member","family"]).optional(),
  question:z.string().trim().min(1).max(2000),
  conversationId:z.string().uuid().nullable().optional(),
  conversationRevision:z.number().int().nonnegative().optional(),
  claimSessionId:z.string().uuid().nullable().optional(),
  asynchronous:z.boolean().optional().default(true),
  timeZone:z.string().trim().max(100).optional(),
  personContextMessage:z.string().trim().min(1).max(2000).optional(),
  personContextRecordedAt:z.string().datetime().optional(),
  personChoiceId:z.string().uuid().optional(),
});
export async function POST(request:NextRequest){
  try{
    const body=BodySchema.parse(await request.json().catch(()=>({})));
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    if(body.familyMemberId){
      const member=await query<{id:string}>("SELECT id FROM family_members WHERE id=$1 AND account_id=$2",[body.familyMemberId,accountId]);
      if(!member.rows.length)return NextResponse.json({error:"Family member not found."},{status:404});
    }else if(body.scope!=="family")return NextResponse.json({error:"Tell DearPolicy who this concerns, or start in automatic family context."},{status:400});
    const args={...body,accountId};
    if(body.asynchronous)return NextResponse.json(await enqueueChat(args),{status:202});
    return NextResponse.json(await askDearPolicy(args));
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Invalid request",issues:error.issues},{status:400});
    if(error instanceof ChatConflict)return NextResponse.json({error:error.message},{status:409});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Chat failed"},{status:500});
    return authResponse;
  }
}

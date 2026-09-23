import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { ChatConflict,deleteHistory,listConversations } from "@/lib/chat/store";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(request:NextRequest){
  try{
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    const url=new URL(request.url);
    const scope=url.searchParams.get("scope")??url.searchParams.get("familyMemberId")??"all";
    if(!["all","family"].includes(scope))z.string().uuid().parse(scope);
    const cursor=url.searchParams.get("cursor");if(cursor)z.string().uuid().parse(cursor);
    return NextResponse.json(await listConversations(accountId,scope,cursor));
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"History lookup failed"},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"History lookup failed"},{status:500});
    return authResponse;
  }
}
const DeleteSchema=z.object({
  conversationId:z.string().uuid().optional(),
  scope:z.enum(["member","family","all"]).optional(),
  familyMemberId:z.string().uuid().optional(),
}).refine(body=>!!body.conversationId||body.scope==="all"||body.scope==="family"||(body.scope==="member"&&!!body.familyMemberId));
export async function DELETE(request:NextRequest){
  try{
    const body=DeleteSchema.parse(await request.json().catch(()=>({})));
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    if(body.familyMemberId){
      const member=await query("SELECT id FROM family_members WHERE id=$1 AND account_id=$2",[body.familyMemberId,accountId]);
      if(!member.rows.length)return NextResponse.json({error:"Family profile not found."},{status:404});
    }
    await deleteHistory(accountId,body.conversationId?{id:body.conversationId}:{all:body.scope==="all",memberId:body.familyMemberId??null});
    return NextResponse.json({deleted:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"History deletion failed"},{status:400});
    if(error instanceof ChatConflict)return NextResponse.json({error:"History deletion failed"},{status:404});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"History deletion failed"},{status:500});
    return authResponse;
  }
}

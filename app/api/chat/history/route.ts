import { NextResponse } from "next/server";
import { z } from "zod";
import { devAccountId,query } from "@/lib/db/client";
import { ChatConflict,deleteHistory,listConversations } from "@/lib/chat/store";

export const runtime="nodejs";
export async function GET(request:Request){
  try{
    const url=new URL(request.url),accountId=devAccountId();
    const scope=url.searchParams.get("scope")??url.searchParams.get("familyMemberId")??"all";
    if(!["all","family"].includes(scope))z.string().uuid().parse(scope);
    const cursor=url.searchParams.get("cursor");if(cursor)z.string().uuid().parse(cursor);
    return NextResponse.json(await listConversations(accountId,scope,cursor));
  }catch(error){return NextResponse.json({error:"History lookup failed"},{status:error instanceof z.ZodError?400:500});}
}
const DeleteSchema=z.object({
  conversationId:z.string().uuid().optional(),
  scope:z.enum(["member","family","all"]).optional(),
  familyMemberId:z.string().uuid().optional(),
}).refine(body=>!!body.conversationId||body.scope==="all"||body.scope==="family"||(body.scope==="member"&&!!body.familyMemberId));
export async function DELETE(request:Request){
  try{
    const body=DeleteSchema.parse(await request.json().catch(()=>({}))),accountId=devAccountId();
    if(body.familyMemberId){
      const member=await query("SELECT id FROM family_members WHERE id=$1 AND account_id=$2",[body.familyMemberId,accountId]);
      if(!member.rows.length)return NextResponse.json({error:"Family profile not found."},{status:404});
    }
    await deleteHistory(accountId,body.conversationId?{id:body.conversationId}:{all:body.scope==="all",memberId:body.familyMemberId??null});
    return NextResponse.json({deleted:true});
  }catch(error){return NextResponse.json({error:"History deletion failed"},{status:error instanceof z.ZodError?400:error instanceof ChatConflict?404:500});}
}

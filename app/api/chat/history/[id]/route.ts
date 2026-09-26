import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { getConversation } from "@/lib/chat/store";
import { sanitizeStoredAnswer } from "@/lib/chat/monetary-boundary";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;z.string().uuid().parse(id);
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    const conversation=await getConversation(accountId,id);
    if(!conversation)return NextResponse.json({error:"Chat not found."},{status:404});
    const cursor=new URL(request.url).searchParams.get("cursor");if(cursor)z.string().uuid().parse(cursor);
    const r=await query<{id:string;role:string;content:string;answer_json:unknown;created_at:string}>(
      "SELECT id,role,content,answer_json,created_at::text FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 AND ($3::uuid IS NULL OR (created_at,message_order)<(SELECT created_at,message_order FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 AND id=$3::uuid)) ORDER BY created_at DESC,message_order DESC LIMIT 51",[accountId,id,cursor]);
    const hasMore=r.rows.length>50,messages=r.rows.slice(0,50).reverse().map(m=>({...m,answer_json:sanitizeStoredAnswer(m.answer_json)}));
    const jobs=await query<{id:string;request_json:{question?:string}}>(
      "SELECT id,request_json FROM chat_analysis_jobs WHERE account_id=$1 AND conversation_id=$2 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",[accountId,id]);
    return NextResponse.json({conversation,messages,nextCursor:hasMore?messages[0]?.id:null,
      pendingJob:jobs.rows[0]?{id:jobs.rows[0].id,message:jobs.rows[0].request_json.question??"Previous policy question"}:null});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Chat lookup failed"},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Chat lookup failed"},{status:500});
    return authResponse;
  }
}

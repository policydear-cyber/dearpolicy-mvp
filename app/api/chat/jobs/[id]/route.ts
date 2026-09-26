import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { cancelChatJob,getChatJob } from "@/lib/chat/jobs";
import { sanitizeStoredAnswer } from "@/lib/chat/monetary-boundary";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;z.string().uuid().parse(id);
    const ctx=await requireHouseholdContext(request);
    const job=await getChatJob(ctx.householdId,id);
    if(!job)return NextResponse.json({error:"Analysis not found or its chat was deleted."},{status:404});
    return NextResponse.json({job:{id:job.id,status:job.status,progress:job.progress,error:job.error},result:job.status==="complete"?sanitizeStoredAnswer(job.result_json):null});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Analysis lookup failed"},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Analysis lookup failed"},{status:500});
    return authResponse;
  }
}
export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;z.string().uuid().parse(id);
    const ctx=await requireHouseholdContext(request);
    await cancelChatJob(ctx.householdId,id);
    return NextResponse.json({cancelled:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Cancellation failed"},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Cancellation failed"},{status:500});
    return authResponse;
  }
}

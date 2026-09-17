import { NextResponse } from "next/server";
import { z } from "zod";
import { devAccountId } from "@/lib/db/client";
import { cancelChatJob,getChatJob } from "@/lib/chat/jobs";

export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;z.string().uuid().parse(id);
    const job=await getChatJob(devAccountId(),id);
    if(!job)return NextResponse.json({error:"Analysis not found or its chat was deleted."},{status:404});
    return NextResponse.json({job:{id:job.id,status:job.status,progress:job.progress,error:job.error},result:job.status==="complete"?job.result_json:null});
  }catch(error){return NextResponse.json({error:"Analysis lookup failed"},{status:error instanceof z.ZodError?400:500});}
}
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;z.string().uuid().parse(id);await cancelChatJob(devAccountId(),id);
    return NextResponse.json({cancelled:true});
  }catch(error){return NextResponse.json({error:"Cancellation failed"},{status:error instanceof z.ZodError?400:500});}
}

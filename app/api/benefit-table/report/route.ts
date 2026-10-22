import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { benefitTableLive } from "@/lib/benefit-table/app";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;

const Body=z.object({ personId:z.string().uuid(), message:z.string().trim().min(1).max(1000) });

/** "Something looks wrong? Tell us" on Coverage: the household's note about one person's table. It changes nothing on the
 * page or in any answer; it is written to the server log (one JSON line, event benefit_table.report) for us to read. */
export async function POST(request:NextRequest){
  try{
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    if(!(await benefitTableLive(accountId)))return NextResponse.json({enabled:false},{status:404});
    const body=Body.parse(await request.json().catch(()=>({})));
    console.warn(JSON.stringify({event:"benefit_table.report",accountId,personId:body.personId,message:body.message,at:new Date().toISOString()}));
    return NextResponse.json({ok:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Could not send that"},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not send that"},{status:500});
    return authResponse;
  }
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { appDb, benefitTableLive } from "@/lib/benefit-table/app";
import { TableInputError, setFigureConfirmation } from "@/lib/benefit-table/service";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;

const Body=z.object({
  documentId:z.string().uuid(),
  claimKey:z.string().min(1).max(64),
  value:z.number().positive().finite().nullable(),
});

/** The household gives the figure for one check the figure guards could not settle, or takes it back (value null). Only
 * with the guards switched on (lib/benefit-table/guard-flag.ts). */
export async function POST(request:NextRequest){
  try{
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    if(!(await benefitTableLive(accountId)))return NextResponse.json({enabled:false},{status:404});
    const body=Body.parse(await request.json().catch(()=>({})));
    await setFigureConfirmation(appDb,accountId,ctx.userId,body.documentId,body.claimKey,body.value);
    return NextResponse.json({ok:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Could not save that"},{status:400});
    if(error instanceof TableInputError)return NextResponse.json({error:error.message},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not save that"},{status:500});
    return authResponse;
  }
}

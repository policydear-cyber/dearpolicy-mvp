import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { appDb, benefitTableLive } from "@/lib/benefit-table/app";
import { TableInputError, setConfirmation } from "@/lib/benefit-table/service";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;

const Body=z.object({
  personId:z.string().uuid(),
  coverKey:z.string().min(1).max(600),
  status:z.enum(["confirmed","corrected"]).nullable(),
  sumInsured:z.number().positive().nullable().optional(),
});

/** The household confirms one person's headline amount, corrects it, or takes that back (status null). */
export async function POST(request:NextRequest){
  try{
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    if(!(await benefitTableLive(accountId)))return NextResponse.json({enabled:false},{status:404});
    const body=Body.parse(await request.json().catch(()=>({})));
    await setConfirmation(appDb,accountId,ctx.userId,body.personId,body.coverKey,body.status,body.sumInsured??null);
    return NextResponse.json({ok:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Could not save that"},{status:400});
    if(error instanceof TableInputError)return NextResponse.json({error:error.message},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not save that"},{status:500});
    return authResponse;
  }
}

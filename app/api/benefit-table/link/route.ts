import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { appDb, benefitTableLive } from "@/lib/benefit-table/app";
import { TableInputError, setLink } from "@/lib/benefit-table/service";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;

const Body=z.object({ section:z.string().min(1).max(600), cover:z.string().min(1).max(600).nullable() });

/** The household says which cover a part of a document belongs to, or none. Kept through re-reads. */
export async function POST(request:NextRequest){
  try{
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    if(!(await benefitTableLive(accountId)))return NextResponse.json({enabled:false},{status:404});
    const body=Body.parse(await request.json().catch(()=>({})));
    await setLink(appDb,accountId,body.section,body.cover);
    return NextResponse.json({ok:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Could not save that"},{status:400});
    if(error instanceof TableInputError)return NextResponse.json({error:error.message},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not save that"},{status:500});
    return authResponse;
  }
}

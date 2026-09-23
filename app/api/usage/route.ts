import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { usageThisMonth } from "@/lib/ai/ledger";
import { describeChoice,modelFor,priceFor } from "@/lib/ai/providers";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export async function GET(request:NextRequest){
  try{
    const ctx=await requireHouseholdContext(request);
    const usage=await usageThisMonth(ctx.householdId);
    const routing=(["reading","judgement","narration"] as const).map(role=>{
      const choice=modelFor(role);const price=priceFor(choice);
      return {role,model:describeChoice(choice),hosted:true,
        price:price?"$"+price.input+" in / $"+price.output+" out per 1M tokens":"no price on file"};
    });
    return NextResponse.json({usage,routing});
  }catch(error){
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not load usage"},{status:500});
    return authResponse;
  }
}

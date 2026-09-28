import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { usageThisMonth } from "@/lib/ai/ledger";
import { describeChoice,modelFor,priceFor } from "@/lib/ai/providers";
import { budgetConfig,startOfMonth,usageByOperationAndModel } from "@/lib/ai/usage";

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
    // Recorded usage by operation and model (model_executions) for THIS
    // household only. The provider-account-wide total (usageByOperationAndModel
    // with null) is operator information and is not served to households.
    // The owner's provider budget is display-only; the per-household limit is
    // the one DearPolicy enforces.
    const byOperationAndModel=await usageByOperationAndModel(ctx.householdId,startOfMonth());
    // Two different limits, each under its own name. hardStopUsd was
    // DearPolicy's own per-household stop and read as if it were the owner's
    // $5 provider budget; it is not served under that name any more.
    const budget=budgetConfig();
    const {hardStopUsd:_internalStop,...plan}=usage.plan;void _internalStop;
    return NextResponse.json({usage:{...usage,plan},routing,byOperationAndModel,budget,
      limits:{
        ownerProviderBudgetUsd:budget.ownerProviderBudget.amountUsd,ownerProviderBudgetEnforcedByDearPolicy:false,
        dearPolicyHouseholdMonthlyLimitUsd:budget.householdLimit.amountUsd,dearPolicyHouseholdLimitEnforced:true,
      }});
  }catch(error){
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not load usage"},{status:500});
    return authResponse;
  }
}

import { NextResponse } from "next/server";
import { devAccountId } from "@/lib/db/client";
import { usageThisMonth } from "@/lib/ai/ledger";
import { describeChoice,modelFor,priceFor } from "@/lib/ai/providers";

export const runtime="nodejs";
export async function GET(){
  try{
    const usage=await usageThisMonth(devAccountId());
    const routing=(["reading","judgement","narration"] as const).map(role=>{
      const choice=modelFor(role);const price=priceFor(choice);
      return {role,model:describeChoice(choice),hosted:choice.provider!=="ollama",
        price:price?"$"+price.input+" in / $"+price.output+" out per 1M tokens":"no price on file"};
    });
    return NextResponse.json({usage,routing});
  }catch(error){
    return NextResponse.json({error:"Could not load usage"},{status:500});
  }
}

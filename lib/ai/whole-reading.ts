/** Whole readings (Critic #419): a structured reading whose reply stopped at its output bound held only the items before
 * the cut (the JSON repair keeps complete array elements) and was recorded as succeeded and cached, so what came after the
 * cut was silently missing (catalog_building at 700/900 tokens, condition_catalog_extraction at 900). A reading here starts
 * with room to spare and is read again with more when its reply was cut; one still cut is used for what it holds and never
 * cached. */
import { TruncatedModelOutput } from "@/lib/ai/llm";

/** The finish reasons a provider gives for a reply that stopped at its output bound (Anthropic, OpenAI-style, Gemini). */
const OUTPUT_CUT=/^(?:max_tokens|length|MAX_TOKENS)$/;
/** A reading still cut at its largest output bound: what it held, complete items only (the JSON repair keeps whole array
 * elements). It is used for what it holds, the page is treated as not fully read, and it is never cached. */
export class CutReading<T> extends Error{constructor(readonly partial:T){super("catalog_reading_cut");this.name="CutReading";}}
/** Output bounds for a document reading: a reply cut at the first is read again at the second (catalog_building calls cut at
 * 700 and 900 tokens dropped every benefit after the cut on 43 page reads across 16 documents, 24 Oct to 11 Nov). */
export const CATALOG_BUDGETS=[2400,6000];
/** Reads with each budget in turn until a reply is not cut at its bound; a reply cut at the last is thrown as CutReading. */
export async function readWhole<T>(read:(budget:number)=>Promise<{value:T;cut:boolean}>,budgets:number[]=CATALOG_BUDGETS):Promise<T>{
  let last:{value:T;cut:boolean}|null=null;
  for(const budget of budgets){last=await read(budget);if(!last.cut)return last.value;}
  throw new CutReading(last!.value);
}
/** One structured catalogue call, with whether its reply stopped at the output bound, from the reply itself (onReply, which
 * does not depend on provenance being stored). Fail-safe: a call whose reply was never reported is taken as cut, and a
 * cut reply that could not be repaired or validated is an empty cut reading, so the larger bound is still tried (Critic
 * #419 G1, G2). */
export async function boundedCall<T>(call:(onReply:(reply:{truncated:boolean;finishReason:string|null})=>void)=>Promise<T>,empty:T):Promise<{value:T;cut:boolean}>{
  let cut:boolean|null=null;
  try{
    const value=await call((reply)=>{cut=reply.truncated||OUTPUT_CUT.test(reply.finishReason??"");});
    return {value,cut:cut??true};
  }catch(error){
    if(error instanceof TruncatedModelOutput&&error.truncated)return {value:empty,cut:true};
    throw error;
  }
}


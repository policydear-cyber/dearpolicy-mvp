import { NextResponse } from "next/server";
import { query } from "@/lib/db/client";
import { readingModelLabel } from "@/lib/ai/reading-model";
import { describeChoice,modelFor } from "@/lib/ai/providers";
import { describePineconeState,pineconeEnabled } from "@/lib/rag/pinecone";
import { simpleChatModel } from "@/lib/simple-chat/flag";
import { truthy } from "@/lib/launch/guards";
import { limitOpenEndpoint } from "@/lib/http/open-endpoint-limit";

export const runtime="nodejs";
export const ROUTE_AUTH = "public" as const;

/** What the app needs to work, in the words the person will read.
 *
 * Every service DearPolicy depends on is hosted and sits behind a key the
 * person set up, so when one is down the fix is theirs to make — and the
 * message must say what to do, not print a connection string. */
export type ServiceState={ok:boolean;label:string;detail:string;fix?:string};
export async function GET(request:Request){
  // Open to anyone signed out, and each call checks the database and the search service: a per-IP brake
  // (lib/http/open-endpoint-limit.ts), far above any real poller.
  const limited=limitOpenEndpoint(request,"health");
  if(limited)return limited;
  const database:ServiceState=await query("SELECT 1").then(()=>({ok:true,label:"Database",detail:"Connected"}))
    .catch(error=>({ok:false,label:"Database",detail:/ECONNREFUSED/.test(String(error?.message))?"Not running":"Cannot connect",
      fix:"Check the DATABASE_URL environment variable in your hosting dashboard."}));
  const reading:ServiceState={ok:true,label:"Reading model",detail:readingModelLabel()};
  // The chat answers on its own model when the simple chat is switched on (lib/simple-chat/flag.ts); the judgement model
  // only checks readings and extractions. Naming that one "Answering model" made the page disagree with model_usage.
  let chat:ServiceState;
  try{chat={ok:true,label:"Chat model",detail:describeChoice(truthy(process.env.DEARPOLICY_SIMPLE_CHAT)?simpleChatModel():modelFor("chat"))};}
  catch{chat={ok:false,label:"Chat model",detail:"Setting not understood",fix:"Check DEARPOLICY_SIMPLE_CHAT_MODEL in your hosting dashboard."};}
  const judgement:ServiceState={ok:true,label:"Checking model",detail:describeChoice(modelFor("judgement"))};
  // Semantic search lives in Pinecone. When it is off, questions still find
  // documents by keyword, so this is reported as a state rather than a fault --
  // but the person should be able to see which of the two they are getting.
  const pineconeState=await describePineconeState();
  const search:ServiceState={...pineconeState,label:"Semantic search"};
  const services=[database,reading,chat,judgement,search];
  // Where this function ran (vercel.json "regions"): it should sit next to the database (Supabase, Singapore).
  return NextResponse.json({ok:services.every(s=>s.ok),services,hosted:true,region:process.env.VERCEL_REGION??null,
    // Kept for anything that read the old shape.
    app:"ok",database:database.ok?"ok":database.detail,llm:reading.ok?"ok":reading.detail,
    embeddings:pineconeEnabled()?(search.ok?"ok":search.detail):"not configured"});
}

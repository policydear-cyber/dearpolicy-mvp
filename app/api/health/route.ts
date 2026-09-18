import { NextResponse } from "next/server";
import { query } from "@/lib/db/client";
import { readingModelLabel } from "@/lib/ai/reading-model";
import { describeChoice,modelFor } from "@/lib/ai/providers";
import { describePineconeState,pineconeEnabled } from "@/lib/rag/pinecone";

export const runtime="nodejs";

/** What the app needs to work, in the words the person will read.
 *
 * Every service DearPolicy depends on is hosted and sits behind a key the
 * person set up, so when one is down the fix is theirs to make — and the
 * message must say what to do, not print a connection string. */
export type ServiceState={ok:boolean;label:string;detail:string;fix?:string};
export async function GET(){
  const database:ServiceState=await query("SELECT 1").then(()=>({ok:true,label:"Database",detail:"Connected"}))
    .catch(error=>({ok:false,label:"Database",detail:/ECONNREFUSED/.test(String(error?.message))?"Not running":"Cannot connect",
      fix:"Check the DATABASE_URL environment variable in your hosting dashboard."}));
  const reading:ServiceState={ok:true,label:"Reading model",detail:readingModelLabel()};
  const judgement:ServiceState={ok:true,label:"Answering model",detail:describeChoice(modelFor("judgement"))};
  // Semantic search lives in Pinecone. When it is off, questions still find
  // documents by keyword, so this is reported as a state rather than a fault --
  // but the person should be able to see which of the two they are getting.
  const pineconeState=await describePineconeState();
  const search:ServiceState={...pineconeState,label:"Semantic search"};
  const services=[database,reading,judgement,search];
  return NextResponse.json({ok:services.every(s=>s.ok),services,hosted:true,
    // Kept for anything that read the old shape.
    app:"ok",database:database.ok?"ok":database.detail,llm:reading.ok?"ok":reading.detail,
    embeddings:pineconeEnabled()?(search.ok?"ok":search.detail):"not configured"});
}

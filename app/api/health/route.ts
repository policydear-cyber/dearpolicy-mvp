import { NextResponse } from "next/server";
import { query } from "@/lib/db/client";
import { readingProvider,readingModelLabel } from "@/lib/ai/reading-model";
import { describeChoice,fullyHosted,modelFor } from "@/lib/ai/providers";

export const runtime="nodejs";

/** What the app needs to work, in the words the person will read.
 *
 * Every service DearPolicy depends on runs on this computer or behind a key the
 * person set up, so when one is down the fix is theirs to make — and the
 * message must say what to do, not print a connection string. */
export type ServiceState={ok:boolean;label:string;detail:string;fix?:string};
export async function GET(){
  // A hosted deployment has no Docker Desktop and no project folder to run a
  // command in, so the fix text the person sees has to match where they are.
  const hostedDb=!!process.env.SUPABASE_URL;
  const database:ServiceState=await query("SELECT 1").then(()=>({ok:true,label:"Database",detail:"Connected"}))
    .catch(error=>({ok:false,label:"Database",detail:/ECONNREFUSED/.test(String(error?.message))?"Not running":"Cannot connect",
      fix:hostedDb?"Check the DATABASE_URL environment variable in your hosting dashboard.":"Open Docker Desktop, then run: npm run db:start"}));
  const base=(process.env.OLLAMA_BASE_URL??"http://127.0.0.1:11434").replace(/\/$/,"");
  const model=process.env.LLM_MODEL??"";
  const local:ServiceState=await fetch(base+"/api/tags",{signal:AbortSignal.timeout(2500)}).then(async response=>{
    if(!response.ok)return {ok:false,label:"Local model",detail:"Ollama answered "+response.status,fix:"Restart Ollama"};
    const tags=await response.json().catch(()=>({models:[]})) as {models?:{name:string}[]};
    const names=(tags.models??[]).map(m=>m.name);
    const present=!model||names.some(name=>name===model||name.startsWith(model.split(":")[0]+":"));
    return present?{ok:true,label:"Local model",detail:model||"Ollama running"}
      :{ok:false,label:"Local model",detail:model+" is not downloaded",fix:"Run: ollama pull "+model};
  }).catch(()=>({ok:false,label:"Local model",detail:"Ollama is not running",fix:"Start Ollama"}));
  const reading:ServiceState=readingProvider()!=="ollama"
    ?{ok:true,label:"Reading model",detail:readingModelLabel()}
    :{ok:local.ok,label:"Reading model",detail:"Local model (set READING_MODEL for a stronger reader)"};
  // With every job hosted, the local model is simply not part of the system.
  const hosted=fullyHosted();
  const localState:ServiceState=hosted?{ok:true,label:"Local model",detail:"Not needed — all jobs hosted"}:local;
  const judgement:ServiceState={ok:true,label:"Answering model",detail:describeChoice(modelFor("judgement"))};
  const services=hosted?[database,reading,judgement]:[database,localState,reading];
  return NextResponse.json({ok:services.every(s=>s.ok),services,hosted,
    // Kept for anything that read the old shape.
    app:"ok",database:database.ok?"ok":database.detail,llm:local.ok?"ok":local.detail,embeddings:local.ok?"ok":local.detail});
}

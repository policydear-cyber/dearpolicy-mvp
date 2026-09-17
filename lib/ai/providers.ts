import { z } from "zod";

/** Which model does which job, as three settings.
 *
 * DearPolicy has three kinds of model work, with very different economics:
 *
 *   reading    — a document once, at upload. Volume, offline, cheap tier.
 *   judgement  — interpreting a message and deciding which benefits respond.
 *                Small context, needs to be right: the mid tier.
 *   narration  — two sentences around figures code has already computed.
 *                Cheapest tier, or local.
 *
 * Each is "provider:model", e.g. groq:llama-3.3-70b-versatile,
 * anthropic:claude-haiku-4-5, gemini:gemini-2.5-flash-lite, ollama:qwen3:8b.
 * Switching providers is a config change; nothing in the app knows which
 * company answered. Every call reports its tokens to the ledger, so a plan can
 * be priced from what a household actually costs. */
export type ModelRole="reading"|"judgement"|"narration"|"chat";
export type Provider="ollama"|"groq"|"anthropic"|"openai"|"gemini";
export type ModelChoice={provider:Provider;model:string};

const PROVIDERS:Provider[]=["ollama","groq","anthropic","openai","gemini"];
function parseChoice(value:string|undefined):ModelChoice|null{
  const text=(value??"").trim();
  const colon=text.indexOf(":");
  if(colon<1)return null;
  const provider=text.slice(0,colon).toLowerCase() as Provider,model=text.slice(colon+1).trim();
  if(!PROVIDERS.includes(provider)||!model)return null;
  if(provider!=="ollama"&&!apiKeyFor(provider))return null; // configured but no key: fall back
  return {provider,model};
}
export function apiKeyFor(provider:Provider){
  switch(provider){
    case "groq":return process.env.GROQ_API_KEY;
    case "anthropic":return process.env.ANTHROPIC_API_KEY;
    case "openai":return process.env.OPENAI_API_KEY;
    case "gemini":return process.env.GEMINI_API_KEY;
    default:return "local";
  }
}
/** The model for a job. Order of precedence: the job's own setting, then the
 * legacy READING_MODEL_PROVIDER/GROQ_MODEL pair for reading, then local. */
/** One key, whole system. MODEL_PRESET=anthropic routes every job to Claude
 * with the cheap tier where cheap is enough and the mid tier where it has to
 * be right, and needs nothing installed on the computer. Explicit per-job
 * settings still win over the preset. */
const PRESETS:Record<string,Record<"reading"|"judgement"|"narration",string>>={
  anthropic:{reading:"anthropic:claude-haiku-4-5",judgement:"anthropic:claude-sonnet-5",narration:"anthropic:claude-haiku-4-5"},
  gemini:{reading:"gemini:flash-lite",judgement:"gemini:flash",narration:"gemini:flash-lite"},
  openai:{reading:"openai:gpt-5-mini",judgement:"openai:gpt-5-mini",narration:"openai:gpt-5-mini"},
};
export function modelPreset(){
  const name=(process.env.MODEL_PRESET??"").trim().toLowerCase();
  return name&&PRESETS[name]?name:null;
}
/** True when no job is routed to the local model, so Ollama is not needed. */
export function fullyHosted(){
  return (["reading","judgement","narration"] as const).every(role=>modelFor(role).provider!=="ollama");
}
export function modelFor(role:ModelRole):ModelChoice{
  const local:ModelChoice={provider:"ollama",model:process.env.LLM_MODEL??"qwen3:8b"};
  const setting=role==="reading"?process.env.READING_MODEL:role==="judgement"?process.env.JUDGEMENT_MODEL:role==="narration"?process.env.NARRATION_MODEL:undefined;
  const chosen=parseChoice(setting);
  if(chosen)return chosen;
  const preset=modelPreset();
  if(preset&&role!=="chat"){
    const fromPreset=parseChoice(PRESETS[preset][role]);
    if(fromPreset)return fromPreset;
  }
  if(preset&&role==="chat"){const fromPreset=parseChoice(PRESETS[preset].judgement);if(fromPreset)return fromPreset;}
  if(role==="reading"&&(process.env.READING_MODEL_PROVIDER??"").toLowerCase()==="groq"&&process.env.GROQ_API_KEY)
    return {provider:"groq",model:process.env.GROQ_MODEL??"llama-3.3-70b-versatile"};
  return local;
}
export function describeChoice(choice:ModelChoice){
  const names:Record<Provider,string>={ollama:"Local",groq:"Groq",anthropic:"Anthropic",openai:"OpenAI",gemini:"Google"};
  return names[choice.provider]+" · "+choice.model;
}

/** List prices per million tokens, for the ledger. Kept as a table you can
 * read; the number that matters is per household per month, and it is only
 * as accurate as this. Unknown models cost zero here and are flagged. */
export type Price={input:number;output:number;cachedInput?:number};
const PRICES:Record<string,Price>={
  "anthropic:claude-haiku-4-5":{input:1,output:5,cachedInput:0.1},
  "anthropic:claude-sonnet-5":{input:2,output:10,cachedInput:0.2},
  "anthropic:claude-opus-5":{input:5,output:25,cachedInput:0.5},
  "gemini:gemini-2.5-flash-lite":{input:0.10,output:0.40},
  "gemini:gemini-2.5-flash":{input:0.30,output:2.50},
  "gemini:gemini-3.5-flash-lite":{input:0.30,output:2.50},
  "gemini:gemini-3.6-flash":{input:1.50,output:7.50},
  // Family names resolve to whatever Google currently serves; priced at the
  // newest family member on file so the ledger is never silently zero.
  "gemini:flash-lite":{input:0.30,output:2.50},
  "gemini:flash":{input:1.50,output:7.50},
  "groq:llama-3.3-70b-versatile":{input:0.59,output:0.79},
  "groq:llama-3.1-8b-instant":{input:0.05,output:0.08},
  "openai:gpt-5-mini":{input:0.25,output:2},
};
export function priceFor(choice:ModelChoice):Price|null{
  if(choice.provider==="ollama")return {input:0,output:0};
  return PRICES[choice.provider+":"+choice.model]??PRICES[choice.provider+":"+choice.model.replace(/-\d{8}$/,"")]??null;
}
export function costUsd(choice:ModelChoice,usage:{input:number;output:number;cached?:number}){
  const price=priceFor(choice);
  if(!price)return null;
  const cached=usage.cached??0;
  return ((usage.input-cached)*price.input+cached*(price.cachedInput??price.input)+usage.output*price.output)/1_000_000;
}

// ---------------------------------------------------------------------------
// Hosted providers. All return {content, truncated, usage}. A 429 or a 5xx is
// waited out with the server's own retry-after, never treated as the document's
// fault.
// ---------------------------------------------------------------------------
export type HostedReply={content:string;truncated:boolean;usage:{input:number;output:number;cached?:number}};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function withRetries(attempt:(signal:AbortSignal)=>Promise<Response>,timeoutMs:number):Promise<Response>{
  let lastError:Error|null=null;
  for(let n=0;n<8;n++){
    const controller=new AbortController();
    // Cleared on every path: a live timer keeps a process alive long after
    // the answer came back.
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await attempt(controller.signal);
      if(response.status===429||response.status>=500){
        const retryAfter=Number(response.headers.get("retry-after"));
        const wait=Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:Math.min(60_000,2_000*2**n);
        lastError=new Error("Model service is busy ("+response.status+")");
        await sleep(wait);continue;
      }
      return response;
    }catch(error){
      if(error instanceof Error&&error.name==="AbortError"){lastError=new Error("Model request timed out after "+Math.round(timeoutMs/1000)+"s");continue;}
      throw error;
    }finally{clearTimeout(timer);}
  }
  throw lastError??new Error("Model service did not answer");
}
const OpenAIShape=z.object({
  choices:z.array(z.object({message:z.object({content:z.string().nullable()}),finish_reason:z.string().nullable().optional()})).min(1),
  usage:z.object({prompt_tokens:z.number().optional(),completion_tokens:z.number().optional(),
    prompt_tokens_details:z.object({cached_tokens:z.number().optional()}).optional()}).optional(),
});
function openAiBase(provider:Provider){
  if(provider==="groq")return (process.env.GROQ_BASE_URL??"https://api.groq.com/openai/v1").replace(/\/$/,"");
  return (process.env.OPENAI_BASE_URL??"https://api.openai.com/v1").replace(/\/$/,"");
}
export async function openAiCompatible(choice:ModelChoice,args:{system:string;user:string;jsonSchema:unknown;temperature?:number;maxOutputTokens?:number;timeoutMs?:number}):Promise<HostedReply>{
  const key=apiKeyFor(choice.provider);
  if(!key)throw new Error("No API key configured for "+choice.provider);
  const timeoutMs=args.timeoutMs??120_000;
  const body=JSON.stringify({
    model:choice.model,temperature:args.temperature??0,
    ...(args.maxOutputTokens?{max_tokens:args.maxOutputTokens}:{}),
    response_format:{type:"json_object"},
    messages:[
      {role:"system",content:args.system+"\n\nReply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n"+JSON.stringify(args.jsonSchema)},
      {role:"user",content:args.user},
    ],
  });
  const response=await withRetries((signal)=>fetch(openAiBase(choice.provider)+"/chat/completions",{method:"POST",signal,
      headers:{"content-type":"application/json",authorization:"Bearer "+key},body}),timeoutMs);
  if(!response.ok)throw new Error("Model request failed ("+response.status+"): "+providerMessage(await response.text()));
  const payload=OpenAIShape.parse(await response.json());
  return {content:payload.choices[0].message.content??"",truncated:payload.choices[0].finish_reason==="length",
    usage:{input:payload.usage?.prompt_tokens??0,output:payload.usage?.completion_tokens??0,cached:payload.usage?.prompt_tokens_details?.cached_tokens}};
}
const AnthropicShape=z.object({
  content:z.array(z.object({type:z.string(),text:z.string().optional()})),
  stop_reason:z.string().nullable().optional(),
  usage:z.object({input_tokens:z.number(),output_tokens:z.number(),cache_read_input_tokens:z.number().optional()}).optional(),
});
export async function anthropicMessages(choice:ModelChoice,args:{system:string;user:string;jsonSchema:unknown;temperature?:number;maxOutputTokens?:number;timeoutMs?:number}):Promise<HostedReply>{
  const key=apiKeyFor("anthropic");
  if(!key)throw new Error("No API key configured for anthropic");
  const timeoutMs=args.timeoutMs??120_000;
  // The system prompt is stable per job and is the part worth caching; the
  // schema rides with it so the cache covers both.
  const body=JSON.stringify({
    model:choice.model,max_tokens:args.maxOutputTokens??1024,temperature:args.temperature??0,
    system:[{type:"text",text:args.system+"\n\nReply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n"+JSON.stringify(args.jsonSchema),
      cache_control:{type:"ephemeral"}}],
    messages:[{role:"user",content:args.user}],
  });
  const response=await withRetries((signal)=>fetch((process.env.ANTHROPIC_BASE_URL??"https://api.anthropic.com").replace(/\/$/,"")+"/v1/messages",{method:"POST",signal,
      headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},body}),timeoutMs);
  if(!response.ok)throw new Error("Model request failed ("+response.status+"): "+providerMessage(await response.text()));
  const payload=AnthropicShape.parse(await response.json());
  const text=payload.content.filter(block=>block.type==="text").map(block=>block.text??"").join("");
  // The model may wrap the object in a code fence; the object is what counts.
  const content=text.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"");
  return {content,truncated:payload.stop_reason==="max_tokens",
    usage:{input:payload.usage?.input_tokens??0,output:payload.usage?.output_tokens??0,cached:payload.usage?.cache_read_input_tokens}};
}
/** Gemini, natively. Google issues two kinds of key: AI Studio keys ("AIza…")
 * that work against generativelanguage.googleapis.com, and Vertex AI express
 * keys ("AQ.…") that work against aiplatform.googleapis.com. The request and
 * reply shapes are the same; only the host differs, so the key decides. */
const GeminiShape=z.object({
  candidates:z.array(z.object({content:z.object({parts:z.array(z.object({text:z.string().optional()})).optional()}).optional(),
    finishReason:z.string().optional()})).optional(),
  usageMetadata:z.object({promptTokenCount:z.number().optional(),candidatesTokenCount:z.number().optional(),cachedContentTokenCount:z.number().optional()}).optional(),
  promptFeedback:z.object({blockReason:z.string().optional()}).optional(),
});
/** The Gemini API (AI Studio keys, any prefix — Google's key format changed
 * and prefix is not a reliable tell) unless GEMINI_ENDPOINT=vertex asks for
 * Vertex AI express mode explicitly. */
export function geminiEndpoint(model:string,_key:string){
  if(process.env.GEMINI_BASE_URL)return process.env.GEMINI_BASE_URL.replace(/\/$/,"")+"/models/"+model+":generateContent";
  return (process.env.GEMINI_ENDPOINT??"").toLowerCase()==="vertex"
    ?"https://aiplatform.googleapis.com/v1/publishers/google/models/"+model+":generateContent"
    :"https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent";
}
/** Google renames and retires models often. A job is configured by FAMILY
 * ("flash-lite", "flash", "pro") or by an exact name; either way the live model
 * list decides what is actually called, so a retired name never stops the app.
 * The list is fetched once an hour. */
type GeminiGlobals={__dearpolicyGeminiModels?:{at:number;names:string[]}};
async function geminiModelNames(key:string){
  const state=globalThis as GeminiGlobals;
  if(state.__dearpolicyGeminiModels&&Date.now()-state.__dearpolicyGeminiModels.at<3_600_000)return state.__dearpolicyGeminiModels.names;
  const base=(process.env.GEMINI_ENDPOINT??"").toLowerCase()==="vertex"?null:"https://generativelanguage.googleapis.com/v1beta/models";
  if(!base)return [];
  try{
    const response=await fetch(base+"?pageSize=200&key="+encodeURIComponent(key),{headers:{"x-goog-api-key":key},signal:AbortSignal.timeout(15_000)});
    if(!response.ok)return [];
    const payload=await response.json() as {models?:{name:string;supportedGenerationMethods?:string[]}[]};
    const names=(payload.models??[]).filter(m=>(m.supportedGenerationMethods??["generateContent"]).includes("generateContent"))
      .map(m=>m.name.replace(/^models\//,""));
    state.__dearpolicyGeminiModels={at:Date.now(),names};
    return names;
  }catch{return [];}
}
function versionOf(name:string){const m=name.match(/gemini-(\d+(?:\.\d+)?)/);return m?Number(m[1]):0;}
export function pickGeminiModel(requested:string,available:string[]){
  if(!available.length)return requested;
  if(available.includes(requested))return requested;
  const family=/lite/.test(requested)?"lite":/pro/.test(requested)?"pro":/flash/.test(requested)?"flash":null;
  const stable=(name:string)=>!/preview|exp|latest|tts|image|audio|embedding|live|thinking/.test(name);
  const candidates=available.filter(name=>/^gemini-/.test(name)&&stable(name)).filter(name=>
    family==="lite"?/flash-lite/.test(name):family==="flash"?/flash/.test(name)&&!/lite/.test(name):family==="pro"?/pro/.test(name):true);
  candidates.sort((a,b)=>versionOf(b)-versionOf(a)||a.length-b.length);
  return candidates[0]??requested;
}
export async function geminiGenerate(choice:ModelChoice,args:{system:string;user:string;jsonSchema:unknown;temperature?:number;maxOutputTokens?:number;timeoutMs?:number}):Promise<HostedReply>{
  const key=apiKeyFor("gemini");
  if(!key)throw new Error("No API key configured for gemini");
  const timeoutMs=args.timeoutMs??120_000;
  const model=pickGeminiModel(choice.model,await geminiModelNames(key));
  const body=JSON.stringify({
    systemInstruction:{parts:[{text:args.system+"\n\nReply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n"+JSON.stringify(args.jsonSchema)}]},
    contents:[{role:"user",parts:[{text:args.user}]}],
    generationConfig:{temperature:args.temperature??0,responseMimeType:"application/json",
      ...(args.maxOutputTokens?{maxOutputTokens:args.maxOutputTokens}:{})},
  });
  // Express-mode keys are documented as a ?key= query parameter; AI Studio
  // keys accept either. Sending both costs nothing and rules out the difference.
  const endpoint=geminiEndpoint(model,key)+"?key="+encodeURIComponent(key);
  const response=await withRetries((signal)=>fetch(endpoint,{method:"POST",signal,
      headers:{"content-type":"application/json","x-goog-api-key":key},body}),timeoutMs);
  if(!response.ok)throw new Error("Model request failed ("+response.status+"): "+providerMessage(await response.text()));
  const payload=GeminiShape.parse(await response.json());
  if(payload.promptFeedback?.blockReason)throw new Error("The model declined this page: "+payload.promptFeedback.blockReason);
  const candidate=payload.candidates?.[0];
  const text=(candidate?.content?.parts??[]).map(part=>part.text??"").join("");
  const content=text.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"");
  return {content,truncated:candidate?.finishReason==="MAX_TOKENS",
    usage:{input:payload.usageMetadata?.promptTokenCount??0,output:payload.usageMetadata?.candidatesTokenCount??0,cached:payload.usageMetadata?.cachedContentTokenCount}};
}
/** The provider's own explanation, as a sentence: the "message" field when the
 * body is JSON, otherwise the text. Never the key, never braces. */
export function providerMessage(bodyText:string){
  try{
    const parsed=JSON.parse(bodyText) as {error?:{message?:string;status?:string;details?:{reason?:string}[]};message?:string};
    const reason=parsed.error?.details?.map(d=>d.reason).filter(Boolean).join(", ");
    const message=parsed.error?.message??parsed.message??bodyText;
    return (message+(reason?" ["+reason+"]":"")).replace(/[{}]/g,"").slice(0,400);
  }catch{return bodyText.replace(/[{}]/g,"").slice(0,400);}
}
export async function hostedStructuredCompletion(choice:ModelChoice,args:{system:string;user:string;jsonSchema:unknown;temperature?:number;maxOutputTokens?:number;timeoutMs?:number}){
  if(choice.provider==="anthropic")return anthropicMessages(choice,args);
  if(choice.provider==="gemini")return geminiGenerate(choice,args);
  return openAiCompatible(choice,args);
}

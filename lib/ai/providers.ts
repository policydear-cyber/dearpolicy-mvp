import { z } from "zod";
import { deterministicHostedDocumentText, deterministicHostedReply, deterministicModelEnabled, deterministicModelRequested } from "./deterministic-model";
/** Integration (r6): whether the deterministic stand-in is requested, for callers that must refuse rather than use it
 * (the conversation loop's hosted model). The stand-in itself stays reachable only from the guarded calls below. */
export function deterministicStandInRequested(env: NodeJS.ProcessEnv = process.env): boolean { return deterministicModelRequested(env); }

/** Which model does which job, as three settings.
 *
 * DearPolicy has three kinds of model work, with very different economics:
 *
 *   reading    — a document once, at upload. Volume, offline, cheap tier.
 *   judgement  — interpreting a message and deciding which benefits respond.
 *                Small context, needs to be right: the mid tier.
 *   narration  — two sentences around figures code has already computed.
 *                The cheapest tier.
 *
 * Every job is done by a hosted model. There is no local model and no GPU to
 * schedule around: DearPolicy runs wherever it is deployed, and a household's
 * laptop is not part of the system.
 *
 * Each is "provider:model", e.g. gemini:flash, anthropic:claude-haiku-4-5,
 * groq:llama-3.3-70b-versatile.
 * Switching providers is a config change; nothing in the app knows which
 * company answered. Every call reports its tokens to the ledger, so a plan can
 * be priced from what a household actually costs. */
export type ModelRole="reading"|"judgement"|"narration"|"chat";
export type Provider="gemini"|"anthropic"|"openai"|"groq";
export type ModelChoice={provider:Provider;model:string};

const PROVIDERS:Provider[]=["gemini","anthropic","openai","groq"];
function parseChoice(value:string|undefined):ModelChoice|null{
  const text=(value??"").trim();
  const colon=text.indexOf(":");
  if(colon<1)return null;
  const provider=text.slice(0,colon).toLowerCase() as Provider,model=text.slice(colon+1).trim();
  if(!PROVIDERS.includes(provider)||!model)return null;
  if(!apiKeyFor(provider))return null; // configured but no key: fall back
  return {provider,model};
}
export function apiKeyFor(provider:Provider){
  switch(provider){
    case "groq":return process.env.GROQ_API_KEY;
    case "anthropic":return process.env.ANTHROPIC_API_KEY;
    case "openai":return process.env.OPENAI_API_KEY;
    case "gemini":return process.env.GEMINI_API_KEY;
  }
}
/** The model for a job. Order of precedence: the job's own setting, then the
 * preset, then the legacy READING_MODEL_PROVIDER/GROQ_MODEL pair for reading,
 * and finally Google, which is what DearPolicy runs on. */
/** One key, whole system. MODEL_PRESET=anthropic routes every job to Claude
 * with the cheap tier where cheap is enough and the mid tier where it has to
 * be right, and needs nothing installed on the computer. Explicit per-job
 * settings still win over the preset. */
const PRESETS:Record<string,Record<"reading"|"judgement"|"narration",string>>={
  anthropic:{reading:"anthropic:claude-haiku-5-5",judgement:"anthropic:claude-sonnet-5-5",narration:"anthropic:claude-haiku-5-5"},
  gemini:{reading:"gemini:flash-lite",judgement:"gemini:flash",narration:"gemini:flash-lite"},
  openai:{reading:"openai:gpt-5-mini",judgement:"openai:gpt-5-mini",narration:"openai:gpt-5-mini"},
};
export function modelPreset(){
  const name=(process.env.MODEL_PRESET??"").trim().toLowerCase();
  return name&&PRESETS[name]?name:null;
}
/** Where a job lands when nothing is configured. Naming a Google model rather
 * than silently doing nothing means a missing GEMINI_API_KEY fails as "the key
 * was not accepted", which is the actual problem, instead of as an empty
 * answer nobody can explain. */
const DEFAULT_MODEL:Record<ModelRole,string>={reading:"flash-lite",judgement:"flash",narration:"flash-lite",chat:"flash"};
export function modelFor(role:ModelRole):ModelChoice{
  const setting=role==="reading"?process.env.READING_MODEL:role==="judgement"?process.env.JUDGEMENT_MODEL:role==="narration"?process.env.NARRATION_MODEL:process.env.CHAT_MODEL;
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
  return {provider:"gemini",model:DEFAULT_MODEL[role]};
}
export function describeChoice(choice:ModelChoice){
  const names:Record<Provider,string>={gemini:"Google",anthropic:"Anthropic",openai:"OpenAI",groq:"Groq"};
  return names[choice.provider]+" · "+choice.model;
}
/** A one-tier-down model to try when a role's primary is rate-limited, so a
 * household sees a slightly plainer answer instead of "try again in a
 * minute" for a quota that is specific to the pricier tier. Google prices
 * (and rate-limits) flash separately from flash-lite, so judgement falling
 * back to the reading tier's model is a real relief, not just a retry of the
 * same limit; other providers/roles have no such observed split, so this
 * stays narrow rather than guessing at one. An explicit env var always wins,
 * the same as modelFor. Returns null when there is nothing sensible to fall
 * back to, or when it would just be the same model again. */
export function fallbackModelFor(role:ModelRole):ModelChoice|null{
  const setting=role==="judgement"?process.env.JUDGEMENT_FALLBACK_MODEL:undefined;
  const chosen=parseChoice(setting);
  if(chosen)return chosen;
  const preset=modelPreset();
  if(preset==="gemini"&&role==="judgement"){
    const fallback=parseChoice(PRESETS.gemini.reading);
    const primary=modelFor(role);
    if(fallback&&(fallback.provider!==primary.provider||fallback.model!==primary.model))return fallback;
  }
  return null;
}

/** List prices per million tokens, for the ledger. Kept as a table you can
 * read; the number that matters is per household per month, and it is only
 * as accurate as this. Unknown models cost zero here and are flagged. */
export type Price={input:number;output:number;cachedInput?:number};
const PRICES:Record<string,Price>={
  "anthropic:claude-haiku-4-5":{input:1,output:5,cachedInput:0.1},
  "anthropic:claude-sonnet-5":{input:2,output:10,cachedInput:0.2},
  "anthropic:claude-sonnet-5-5":{input:2,output:10,cachedInput:0.2},
  // Haiku 5.5 has two rate cards by prompt length: these are the rates for prompts of 100K tokens or fewer (every
  // DearPolicy request); a longer prompt is billed at $0.50 / $2.50, which this table would under-count.
  "anthropic:claude-haiku-5-5":{input:0.10,output:0.50,cachedInput:0.01},
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
  // https://developers.openai.com/api/docs/models/gpt-6-luna (checked 2026-10-09): input $0.10, cached input $0.01,
  // output $0.50 per 1M tokens.
  "openai:gpt-6-luna":{input:0.10,output:0.50,cachedInput:0.01},
};
/** What a provider:model requires of a request, beyond its price -- recorded from the provider's own model page, next
 * to the price table so a model change brings its request rules with it. `chatCompletionsWithTools` is merged into a
 * Chat Completions request that carries tools (the conversational loop's hosted model, openAiRequest). */
export type ModelCapability={
  chatCompletionsWithTools?:{set:Record<string,unknown>;source:string};
  /** Merged into a Chat Completions request WITHOUT tools that asks for one JSON object (openAiCompatible: document
   * reading, judgement, narration). */
  chatCompletionsStructured?:{set:Record<string,unknown>;source:string};
  /** The model reads a PDF given as a Chat Completions file content part (text layer AND page images), so a scanned
   * page with no text layer can be transcribed by the configured reading model itself (openAiDocumentText). */
  documentInput?:{set:Record<string,unknown>;maxFileBytes:number;source:string};
  contextTokens?:number;maxOutputTokens?:number;
  /** Anthropic Messages API request rules. `omit` names request fields the model rejects (non-default temperature);
   * `set` is merged into the body; `toolChoice:"auto"` replaces forced tool use, which the model rejects; `beta` is sent
   * as the anthropic-beta header. `messagesWithTools` is the conversation loop's request (lib/rag2/loop/hosted-model.ts);
   * `messagesStructured` is one JSON reply without tools (anthropicMessages, anthropicDocumentText). */
  messagesWithTools?:AnthropicRequestRules;
  messagesStructured?:AnthropicRequestRules;
};
export type AnthropicRequestRules={set:Record<string,unknown>;omit:string[];toolChoice?:"auto";beta?:string;source:string};
const CAPABILITIES:Record<string,ModelCapability>={
  "openai:gpt-6-luna":{
    chatCompletionsWithTools:{set:{reasoning_effort:"none"},
      source:"https://developers.openai.com/api/docs/models/gpt-6-luna: \"Chat Completions supports function calling only with `reasoning_effort` set to `none`.\""},
    // max_completion_tokens is "An upper bound for the number of tokens that can be generated for a completion,
    // including visible output tokens and reasoning tokens" (Chat Completions API reference) and the model's default
    // reasoning effort is medium (model page). The structured calls' output budgets (700-4 000 tokens) were sized for
    // the JSON alone, so reasoning is turned off for them: the budget then bounds the visible JSON, as intended.
    chatCompletionsStructured:{set:{reasoning_effort:"none"},
      source:"https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create (max_completion_tokens includes reasoning tokens); https://developers.openai.com/api/docs/models/gpt-6-luna (reasoning.effort supports none ... medium (default))"},
    documentInput:{set:{reasoning_effort:"none"},maxFileBytes:50*1024*1024,
      source:"https://developers.openai.com/api/docs/models/gpt-6-luna: input Text, Image; https://developers.openai.com/api/docs/guides/pdf-files: on models with vision capabilities the API extracts both text and page images; Chat Completions accepts only PDF files as file content parts ({type:'file', file:{filename, file_data:'data:application/pdf;base64,...'}}); each file must be under 50 MB; Chat Completions file inputs don't support detail"},
    contextTokens:1_050_000,maxOutputTokens:128_000,
  },
  // The conversation loop resends its own tool calls within a turn, and narrows the tool list once retrieval closes. On
  // this model a replayed thinking block after a change to the tools or earlier messages is a 400 on accounts created
  // since 2026-08-31, unless the request asks for such blocks to be dropped -- which only adaptive thinking allows. So the
  // loop runs adaptive thinking at low effort with drop_block; the one-shot JSON calls have nothing to replay and run with
  // thinking off (between_tools, the lowest setting), as their output budgets were sized for the JSON alone.
  "anthropic:claude-sonnet-5-5":{
    messagesWithTools:{set:{thinking:{type:"adaptive",block_binding:{prefix_mismatch_behavior:"drop_block"}},output_config:{effort:"low"}},omit:["temperature"],toolChoice:"auto",
      beta:"thinking-binding-controls-2026-08-01",
      source:"Claude API migration guide, Claude Sonnet 5.5 (checked 2026-10-20): non-default temperature is a 400; tool_choice any/tool is a 400; thinking disabled is a 400 (between_tools is the lowest setting); thinking.block_binding.prefix_mismatch_behavior drop_block needs the thinking-binding-controls-2026-08-01 beta and adaptive thinking"},
    messagesStructured:{set:{thinking:{type:"between_tools"},output_config:{effort:"medium"}},omit:["temperature"],
      source:"Claude API migration guide, Claude Sonnet 5.5 (checked 2026-10-20): between_tools is accepted at effort high or below and takes no other thinking field"},
    contextTokens:1_000_000,maxOutputTokens:128_000,
  },
  "anthropic:claude-haiku-5-5":{
    messagesWithTools:{set:{},omit:["temperature"],
      source:"Claude API migration guide, Claude Haiku 5.5 (checked 2026-10-20): any temperature other than 1 is a 400; forced tool_choice is accepted"},
    messagesStructured:{set:{thinking:{type:"disabled"}},omit:["temperature"],
      source:"Claude API migration guide, Claude Haiku 5.5 (checked 2026-10-20): thinking is on by default and counts toward max_tokens; disabled is accepted at the default effort (medium)"},
    contextTokens:1_000_000,maxOutputTokens:128_000,
  },
};
/** A Messages API body with a model's request rules applied (exported for the request-shape regression). */
export function applyAnthropicRules(body:Record<string,unknown>,rules:AnthropicRequestRules|undefined):Record<string,unknown>{
  if(!rules)return body;
  const out:Record<string,unknown>={...body};
  for(const k of rules.omit)delete out[k];
  if(rules.toolChoice&&"tool_choice" in out)out.tool_choice={type:rules.toolChoice};
  return {...out,...rules.set};
}
function anthropicHeaders(key:string,rules:AnthropicRequestRules|undefined):Record<string,string>{
  return {"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01",...(rules?.beta?{"anthropic-beta":rules.beta}:{})};
}
export function anthropicHeadersFor(key:string,choice:ModelChoice,kind:"messagesWithTools"|"messagesStructured"){return anthropicHeaders(key,capabilityFor(choice)?.[kind]);}
/** A refusal is a 200 with no usable content: an error, not an empty answer. */
function refusedError(stopReason:string|null|undefined){return stopReason==="refusal"?new Error("The model declined this request (refusal)"):null;}
export function capabilityFor(choice:ModelChoice):ModelCapability|null{
  return CAPABILITIES[choice.provider+":"+choice.model]??CAPABILITIES[choice.provider+":"+choice.model.replace(/-\d{8}$/,"")]??null;
}
export function priceFor(choice:ModelChoice):Price|null{
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
/** Checkpoint 10: what the provider actually reported about the call it
 * served, as opposed to what was requested (ModelChoice). A family alias
 * ("flash", "haiku") is a request, never a resolved identity -- resolvedModel
 * is populated ONLY from a field the provider's response itself returned for
 * THIS call, never derived, defaulted, or copied from the request. When a
 * provider's response shape does not carry one (or parsing it fails), the
 * field is null, honestly, rather than falling back to the requested model
 * name -- lib/ai/provenance.ts treats a null resolvedModel as grounds to
 * mark the execution unverified. */
export type ResolvedModelIdentity={resolvedModel:string|null;providerRequestId:string|null;finishReason:string|null;region:string|null;
  /** The provider that actually served the call, when it is not the requested one (a document-reading fallback). */
  resolvedProvider?:Provider|null};
export type HostedReply={content:string;truncated:boolean;usage:{input:number;output:number;cached?:number};resolved:ResolvedModelIdentity};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** The provider account has run out of paid quota or credit (OpenAI
 * "insufficient_quota", a billing hard limit, Google's daily quota). Unlike a
 * per-minute rate limit this does not clear by waiting, so it is never
 * retried, never re-sent to another model on the same account, and its raw
 * provider text (which carries organisation identifiers and billing links)
 * is never part of the message. */
export class ProviderQuotaExhausted extends Error{
  readonly status:number;
  constructor(status:number){super("Model provider quota exhausted ("+status+")");this.name="ProviderQuotaExhausted";this.status=status;}
}
const QUOTA_EXHAUSTED=/insufficient_quota|exceeded your current quota|billing[_ ]hard[_ ]limit|billing details|credit balance is too low|out of credits|quota exceeded for quota metric.*per ?day|PerDay/i;
export function isQuotaExhaustedBody(status:number,bodyText:string){return (status===429||status===402||status===403)&&QUOTA_EXHAUSTED.test(bodyText);}
/** Provider text with account identifiers, links and keys removed. Used for
 * every provider message that can end up in an Error (and so in a log line
 * or, by mistake, a response). */
export function sanitizeProviderText(text:string){
  return text
    .replace(/https?:\/\/\S+/gi,"[link]")
    .replace(/\borg[-_][A-Za-z0-9]{6,}\b/g,"[organisation]")
    .replace(/\b(?:in )?organi[sz]ation\s+\S+\s*/gi,"")
    .replace(/\bproj(?:ect)?[-_ ]?[A-Za-z0-9]{8,}\b/gi,"[project]")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g,"[key]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g,"[key]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,"[email]")
    .replace(/\s+/g," ").trim();
}
/** Wall-clock ceiling for all retries of one call. A household waiting on
 * chat gets an answer or a clean failure inside 30 seconds; retries must not
 * quietly spend that. */
const RETRY_WINDOW_MS=Math.max(1_000,Number(process.env.MODEL_RETRY_WINDOW_MS??20_000)||20_000);
// maxAttempts defaults to 8 (existing behaviour for every caller that does
// not name it). A caller that DOES pass one -- like judgeRelevance's
// attempts:1 -- was silently ignored here before: this hardcoded loop always
// ran up to 8 times regardless, so a 90s-timeout call meant to fail fast
// could actually retry for up to ~12 minutes, well past Vercel's 300s
// function limit. That let the platform kill the function mid-retry instead
// of judgeRelevance's own try/catch ever getting to run its documented
// graceful fallback (the deterministic shortlist stands), leaving the job
// stuck "running" until the separate 10-minute cross-instance recovery sweep
// finally marked it failed -- exactly the stuck-chat symptom this was meant
// to avoid.
async function withRetries(attempt:(signal:AbortSignal)=>Promise<Response>,timeoutMs:number,maxAttempts=8):Promise<Response>{
  let lastError:Error|null=null;
  const started=Date.now();
  for(let n=0;n<maxAttempts;n++){
    const controller=new AbortController();
    // Cleared on every path: a live timer keeps a process alive long after
    // the answer came back.
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await attempt(controller.signal);
      if(response.status===429||response.status>=500){
        const retryAfter=Number(response.headers.get("retry-after"));
        const body=await response.text().catch(()=>"");
        // Exhausted paid quota does not clear by waiting: fail now, cleanly.
        if(isQuotaExhaustedBody(response.status,body))throw new ProviderQuotaExhausted(response.status);
        const detail=providerMessage(body).slice(0,300);
        lastError=new Error("Model service is busy ("+response.status+")"+(detail?": "+detail:""));
        const wait=Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:Math.min(20_000,2_000*2**n);
        // Never retry past the window: a clean failure beats a dead spinner.
        if(Date.now()-started+wait>RETRY_WINDOW_MS)throw lastError;
        // A provider saying "come back later" for longer than a serverless
        // invocation can live is a terminal answer for THIS call, not a
        // sleep: honouring a long retry-after burned the whole function
        // window in silence and the person watched a spinner die. Fail fast
        // with the provider's own sentence instead.
        if(wait>20_000)throw lastError;
        await sleep(wait);continue;
      }
      return response;
    }catch(error){
      if(error instanceof Error&&error.name==="AbortError"){lastError=new Error("Model request timed out after "+Math.round(timeoutMs/1000)+"s");if(Date.now()-started>RETRY_WINDOW_MS)throw lastError;continue;}
      throw error;
    }finally{clearTimeout(timer);}
  }
  throw lastError??new Error("Model service did not answer");
}
const OpenAIShape=z.object({
  id:z.string().optional(),
  model:z.string().optional(),
  choices:z.array(z.object({message:z.object({content:z.string().nullable()}),finish_reason:z.string().nullable().optional()})).min(1),
  usage:z.object({prompt_tokens:z.number().optional(),completion_tokens:z.number().optional(),
    prompt_tokens_details:z.object({cached_tokens:z.number().optional()}).optional()}).optional(),
});
function openAiBase(provider:Provider){
  if(provider==="groq")return (process.env.GROQ_BASE_URL??"https://api.groq.com/openai/v1").replace(/\/$/,"");
  return (process.env.OPENAI_BASE_URL??"https://api.openai.com/v1").replace(/\/$/,"");
}
/** Parameters a given provider:model has rejected with a 400, remembered so
 * later calls never re-pay the discovery roundtrip. Process-lifetime only. */
const LEARNED_PARAMETER_STRIPS=new Map<string,Set<string>>();
export async function openAiCompatible(choice:ModelChoice,args:{system:string;user:string;jsonSchema:unknown;temperature?:number;maxOutputTokens?:number;timeoutMs?:number;attempts?:number}):Promise<HostedReply>{
  const key=apiKeyFor(choice.provider);
  if(!key)throw new Error("No API key configured for "+choice.provider);
  const timeoutMs=args.timeoutMs??120_000;
  // OpenAI generations disagree about their own parameters: newer models
  // accept only max_completion_tokens where older ones took max_tokens, and
  // reasoning-class models pin temperature to its default and reject an
  // explicit 0. Rather than tracking every model's quirks by name, a 400
  // that names a parameter is retried once without that parameter, at most
  // three strips, so a model change in the hosting dashboard cannot brick
  // every answer over a request setting. What a model rejected is REMEMBERED
  // per provider:model for the life of the process -- without that, every
  // single call re-paid the failed discovery roundtrip, which on a turn with
  // many calls added minutes.
  const params:Record<string,unknown>={
    model:choice.model,temperature:args.temperature??0,
    ...(args.maxOutputTokens?(choice.provider==="openai"?{max_completion_tokens:args.maxOutputTokens}:{max_tokens:args.maxOutputTokens}):{}),
    response_format:{type:"json_object"},
    ...(choice.provider==="openai"?capabilityFor(choice)?.chatCompletionsStructured?.set??{}:{}),
    messages:[
      {role:"system",content:args.system+"\n\nReply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n"+JSON.stringify(args.jsonSchema)},
      {role:"user",content:args.user},
    ],
  };
  const stripKey=choice.provider+":"+choice.model;
  for(const learned of LEARNED_PARAMETER_STRIPS.get(stripKey)??[]){
    if(learned==="max_completion_tokens"&&"max_completion_tokens" in params){params.max_tokens=params.max_completion_tokens;delete params.max_completion_tokens;}
    else if(learned==="max_tokens"&&"max_tokens" in params){params.max_completion_tokens=params.max_tokens;delete params.max_tokens;}
    else delete params[learned];
  }
  const learn=(name:string)=>{const set=LEARNED_PARAMETER_STRIPS.get(stripKey)??new Set<string>();set.add(name);LEARNED_PARAMETER_STRIPS.set(stripKey,set);};
  let response!:Response;
  for(let strip=0;strip<4;strip++){
    const body=JSON.stringify(params);
    response=await withRetries((signal)=>fetch(openAiBase(choice.provider)+"/chat/completions",{method:"POST",signal,
        headers:{"content-type":"application/json",authorization:"Bearer "+key},body}),timeoutMs,args.attempts);
    if(response.ok)break;
    const text=await response.text();
    if(response.status===400){
      if("temperature" in params&&/temperature/i.test(text)){learn("temperature");delete params.temperature;continue;}
      if("max_completion_tokens" in params&&/max_completion_tokens/i.test(text)){learn("max_completion_tokens");params.max_tokens=params.max_completion_tokens;delete params.max_completion_tokens;continue;}
      if("max_tokens" in params&&/max_tokens/i.test(text)){learn("max_tokens");params.max_completion_tokens=params.max_tokens;delete params.max_tokens;continue;}
      if("response_format" in params&&/response_format/i.test(text)){learn("response_format");delete params.response_format;continue;}
      if("reasoning_effort" in params&&/reasoning_effort/i.test(text)){learn("reasoning_effort");delete params.reasoning_effort;continue;}
    }
    throw failedResponse(response.status,text);
  }
  if(!response.ok)throw failedResponse(response.status,await response.text());
  const payload=OpenAIShape.parse(await response.json());
  return {content:payload.choices[0].message.content??"",truncated:payload.choices[0].finish_reason==="length",
    usage:{input:payload.usage?.prompt_tokens??0,output:payload.usage?.completion_tokens??0,cached:payload.usage?.prompt_tokens_details?.cached_tokens},
    resolved:{resolvedModel:payload.model??null,providerRequestId:payload.id??null,finishReason:payload.choices[0].finish_reason??null,region:null}};
}
const AnthropicShape=z.object({
  id:z.string().optional(),
  model:z.string().optional(),
  content:z.array(z.object({type:z.string(),text:z.string().optional()})),
  stop_reason:z.string().nullable().optional(),
  usage:z.object({input_tokens:z.number(),output_tokens:z.number(),cache_read_input_tokens:z.number().nullable().optional(),cache_creation_input_tokens:z.number().nullable().optional()}).optional(),
});
/** Anthropic usage: input_tokens EXCLUDES cache reads and cache writes, so both are added back to give every input
 * token (the same normalisation as the conversation loop's hosted model); the cache reads are the cached part, so
 * "input minus cached" is never negative. Cache writes are priced as ordinary input. */
export function anthropicUsageOf(u:{input_tokens?:number|null;output_tokens?:number|null;cache_read_input_tokens?:number|null;cache_creation_input_tokens?:number|null}|null|undefined):{input:number;output:number;cached:number}{
  const n=(x:unknown)=>typeof x==="number"&&Number.isFinite(x)&&x>0?Math.floor(x):0;
  const read=n(u?.cache_read_input_tokens),write=n(u?.cache_creation_input_tokens);
  return {input:n(u?.input_tokens)+read+write,output:n(u?.output_tokens),cached:read};
}
export async function anthropicMessages(choice:ModelChoice,args:{system:string;user:string;jsonSchema:unknown;temperature?:number;maxOutputTokens?:number;timeoutMs?:number;attempts?:number}):Promise<HostedReply>{
  const key=apiKeyFor("anthropic");
  if(!key)throw new Error("No API key configured for anthropic");
  const timeoutMs=args.timeoutMs??120_000;
  // The system prompt is stable per job and is the part worth caching; the
  // schema rides with it so the cache covers both.
  const rules=capabilityFor(choice)?.messagesStructured;
  const body=JSON.stringify(applyAnthropicRules({
    model:choice.model,max_tokens:args.maxOutputTokens??1024,temperature:args.temperature??0,
    system:[{type:"text",text:args.system+"\n\nReply with a single JSON object and nothing else. It must match this JSON Schema exactly:\n"+JSON.stringify(args.jsonSchema),
      cache_control:{type:"ephemeral"}}],
    messages:[{role:"user",content:args.user}],
  },rules));
  const response=await withRetries((signal)=>fetch((process.env.ANTHROPIC_BASE_URL??"https://api.anthropic.com").replace(/\/$/,"")+"/v1/messages",{method:"POST",signal,
      headers:anthropicHeaders(key,rules),body}),timeoutMs,args.attempts);
  if(!response.ok)throw failedResponse(response.status,await response.text());
  const payload=AnthropicShape.parse(await response.json());
  const refused=refusedError(payload.stop_reason);if(refused)throw refused;
  const text=payload.content.filter(block=>block.type==="text").map(block=>block.text??"").join("");
  // The model may wrap the object in a code fence; the object is what counts.
  const content=text.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"");
  return {content,truncated:payload.stop_reason==="max_tokens",
    usage:anthropicUsageOf(payload.usage),
    resolved:{resolvedModel:payload.model??null,providerRequestId:payload.id??null,finishReason:payload.stop_reason??null,region:null}};
}
/** Gemini, natively. Google issues two kinds of key: AI Studio keys ("AIza…")
 * that work against generativelanguage.googleapis.com, and Vertex AI express
 * keys ("AQ.…") that work against aiplatform.googleapis.com. The request and
 * reply shapes are the same; only the host differs, so the key decides. */
const GeminiShape=z.object({
  // modelVersion is the exact resolved model Google actually served this
  // call with (the requested name may be a family alias like "flash" that
  // resolves to a specific dated model); responseId is Google's own id for
  // this call, when the API version in use returns one. Neither is
  // guaranteed present on every Gemini API surface/version -- absent means
  // absent, never backfilled from the request.
  modelVersion:z.string().optional(),
  responseId:z.string().optional(),
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
export async function geminiGenerate(choice:ModelChoice,args:{system:string;user:string;jsonSchema:unknown;temperature?:number;maxOutputTokens?:number;timeoutMs?:number;attempts?:number}):Promise<HostedReply>{
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
      headers:{"content-type":"application/json","x-goog-api-key":key},body}),timeoutMs,args.attempts);
  if(!response.ok)throw failedResponse(response.status,await response.text());
  const payload=GeminiShape.parse(await response.json());
  if(payload.promptFeedback?.blockReason)throw new Error("The model declined this page: "+payload.promptFeedback.blockReason);
  const candidate=payload.candidates?.[0];
  const text=(candidate?.content?.parts??[]).map(part=>part.text??"").join("");
  const content=text.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"");
  return {content,truncated:candidate?.finishReason==="MAX_TOKENS",
    usage:{input:payload.usageMetadata?.promptTokenCount??0,output:payload.usageMetadata?.candidatesTokenCount??0,cached:payload.usageMetadata?.cachedContentTokenCount},
    resolved:{resolvedModel:payload.modelVersion??null,providerRequestId:payload.responseId??null,finishReason:candidate?.finishReason??null,region:null}};
}
/** The provider's own explanation, as a sentence: the "message" field when the
 * body is JSON, otherwise the text. Never the key, never braces. */
export function providerMessage(bodyText:string){
  try{
    const parsed=JSON.parse(bodyText) as {error?:{message?:string;status?:string;details?:{reason?:string}[]};message?:string};
    const reason=parsed.error?.details?.map(d=>d.reason).filter(Boolean).join(", ");
    const message=parsed.error?.message??parsed.message??bodyText;
    return sanitizeProviderText((message+(reason?" ["+reason+"]":"")).replace(/[{}]/g,"")).slice(0,400);
  }catch{return sanitizeProviderText(bodyText.replace(/[{}]/g,"")).slice(0,400);}
}
/** A failed (non-OK) provider response as an Error: exhausted quota is its
 * own type; everything else carries only sanitized provider text. */
function failedResponse(status:number,bodyText:string){
  if(isQuotaExhaustedBody(status,bodyText))return new ProviderQuotaExhausted(status);
  return new Error("Model request failed ("+status+"): "+providerMessage(bodyText));
}
export async function hostedStructuredCompletion(choice:ModelChoice,args:{system:string;user:string;jsonSchema:unknown;temperature?:number;maxOutputTokens?:number;timeoutMs?:number;attempts?:number}){
  // Synthetic browser/CI journeys only; impossible in production (see
  // lib/ai/deterministic-model.ts and lib/launch/guards.ts).
  if(deterministicModelEnabled())return deterministicHostedReply(args);
  if(choice.provider==="anthropic")return anthropicMessages(choice,args);
  if(choice.provider==="gemini")return geminiGenerate(choice,args);
  return openAiCompatible(choice,args);
}

// ---------------------------------------------------------------------------
// Document (PDF page) reading, for scanned pages that have no usable text
// layer. Used in place of a locally-run OCR program: production runs on
// Vercel, which cannot spawn a local Python/PaddleOCR process (no GPU, no
// persistent disk to install it on, and a much shorter execution window than
// a 30-minute OCR job needs). Anthropic, Gemini and OpenAI vision models all
// accept a PDF document natively and return its text — no separate
// image-rendering step needed. See lib/documents/ocr.ts.
// ---------------------------------------------------------------------------
/** servedBy: the provider:model that actually read the pages (the requested reading model, or a document-capable
 * fallback when the reading model cannot look at documents) -- usage, price and provenance are booked to it. */
export type HostedDocumentReply = { text: string; truncated: boolean; usage: { input: number; output: number; cached?: number }; resolved: ResolvedModelIdentity; servedBy: ModelChoice };

const HOSTED_DOCUMENT_PROVIDERS: Provider[] = ["anthropic", "gemini"];
/** Whether this reading model can itself look at a PDF page (a scan with no text layer). Anthropic and Gemini always
 * can; an OpenAI model can when its capability record says it takes PDF file input (vision models, e.g. gpt-6-luna).
 * Given a bare provider (older callers), OpenAI is not assumed. */
export function supportsHostedDocumentReading(target: Provider | ModelChoice) {
  const choice = typeof target === "string" ? null : target;
  const provider = typeof target === "string" ? target : target.provider;
  if (HOSTED_DOCUMENT_PROVIDERS.includes(provider)) return true;
  return provider === "openai" && !!choice && !!capabilityFor(choice)?.documentInput;
}
/** The model that reads scanned pages: the configured reading model when it can look at documents; otherwise the
 * first document-capable provider with a key (the older fallback); otherwise null -- the pages stay unread, visibly. */
export function documentReaderFor(reading: ModelChoice = modelFor("reading")): ModelChoice | null {
  if (deterministicModelEnabled()) return reading; // synthetic journeys: the stand-in reads (see hostedDocumentToText)
  if (supportsHostedDocumentReading(reading) && apiKeyFor(reading.provider)) return reading;
  if (apiKeyFor("gemini")) return { provider: "gemini", model: "flash-lite" };
  if (apiKeyFor("anthropic")) return { provider: "anthropic", model: "claude-haiku-4-5" };
  return null;
}

const OpenAIDocumentShape = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).optional() }).optional(),
});
/** The exact Chat Completions body for reading a PDF (exported for the request-shape regression and the live guard's
 * reservation): the pages go as ONE file content part -- {type:"file", file:{filename, file_data:"data:application/pdf;
 * base64,..."}} (developers.openai.com/api/docs/guides/pdf-files) -- followed by the instruction text; no `detail`
 * (Chat Completions file inputs do not support it); max_completion_tokens always set. */
export function openAiDocumentRequest(choice: ModelChoice, args: { system: string; user: string; pdfBase64: string; maxOutputTokens?: number }, strip: Set<string> = new Set()) {
  const body: Record<string, unknown> = {
    model: choice.model, temperature: 0, max_completion_tokens: Math.max(1, Math.floor(args.maxOutputTokens ?? 4096)),
    response_format: { type: "json_object" },
    ...(capabilityFor(choice)?.documentInput?.set ?? {}),
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: [
        { type: "file", file: { filename: "pages.pdf", file_data: "data:application/pdf;base64," + args.pdfBase64 } },
        { type: "text", text: args.user },
      ] },
    ],
  };
  for (const k of strip) delete body[k];
  return body;
}
async function openAiDocumentText(choice: ModelChoice, args: { system: string; user: string; pdfBase64: string; maxOutputTokens?: number; timeoutMs?: number }): Promise<HostedDocumentReply> {
  const key = apiKeyFor("openai");
  if (!key) throw new Error("No API key configured for openai");
  const limit = capabilityFor(choice)?.documentInput?.maxFileBytes ?? 50 * 1024 * 1024;
  if (Math.floor(args.pdfBase64.length * 3 / 4) >= limit) throw new Error("The pages to read are larger than " + describeChoice(choice) + " accepts in one request (" + Math.round(limit / 1048576) + " MB).");
  const timeoutMs = args.timeoutMs ?? 120_000;
  const stripKey = choice.provider + ":" + choice.model;
  const strip = new Set([...(LEARNED_PARAMETER_STRIPS.get(stripKey) ?? [])].filter((k) => k !== "max_completion_tokens" && k !== "max_tokens"));
  let response!: Response;
  // A 400 naming an optional setting is sent once more without it (at most three); the output bound is never dropped.
  for (let attempt = 0; attempt < 4; attempt++) {
    const body = JSON.stringify(openAiDocumentRequest(choice, args, strip));
    response = await withRetries((signal) => fetch(openAiBase("openai") + "/chat/completions", { method: "POST", signal, headers: { "content-type": "application/json", authorization: "Bearer " + key }, body }), timeoutMs, 3);
    if (response.ok) break;
    const text = await response.text();
    const optional = response.status === 400 ? ["temperature", "reasoning_effort", "response_format"].find((k) => !strip.has(k) && new RegExp(k, "i").test(text)) : undefined;
    if (optional) { strip.add(optional); const set = LEARNED_PARAMETER_STRIPS.get(stripKey) ?? new Set<string>(); set.add(optional); LEARNED_PARAMETER_STRIPS.set(stripKey, set); continue; }
    throw failedResponse(response.status, text);
  }
  if (!response.ok) throw failedResponse(response.status, await response.text());
  const payload = OpenAIDocumentShape.parse(await response.json());
  const finish = payload.choices[0].finish_reason ?? null;
  return { text: payload.choices[0].message.content ?? "", truncated: finish === "length",
    usage: { input: payload.usage?.prompt_tokens ?? 0, output: payload.usage?.completion_tokens ?? 0, cached: payload.usage?.prompt_tokens_details?.cached_tokens },
    resolved: { resolvedModel: payload.model ?? null, providerRequestId: payload.id ?? null, finishReason: finish, region: null, resolvedProvider: "openai" },
    servedBy: choice };
}

async function anthropicDocumentText(choice: ModelChoice, args: { system: string; user: string; pdfBase64: string; maxOutputTokens?: number; timeoutMs?: number }): Promise<HostedDocumentReply> {
  const key = apiKeyFor("anthropic");
  if (!key) throw new Error("No API key configured for anthropic");
  const timeoutMs = args.timeoutMs ?? 120_000;
  const rules = capabilityFor(choice)?.messagesStructured;
  const body = JSON.stringify(applyAnthropicRules({
    model: choice.model,
    max_tokens: args.maxOutputTokens ?? 4096,
    temperature: 0,
    system: [{ type: "text", text: args.system }],
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: args.pdfBase64 } },
        { type: "text", text: args.user },
      ],
    }],
  }, rules));
  const response = await withRetries((signal) => fetch((process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages", {
    method: "POST", signal, headers: anthropicHeaders(key, rules), body,
  }), timeoutMs);
  if (!response.ok) throw failedResponse(response.status, await response.text());
  const payload = AnthropicShape.parse(await response.json());
  const refused = refusedError(payload.stop_reason); if (refused) throw refused;
  const text = payload.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  return { text, truncated: payload.stop_reason === "max_tokens", usage: anthropicUsageOf(payload.usage),
    resolved: { resolvedModel: payload.model ?? null, providerRequestId: payload.id ?? null, finishReason: payload.stop_reason ?? null, region: null, resolvedProvider: "anthropic" }, servedBy: choice };
}

async function geminiDocumentText(choice: ModelChoice, args: { system: string; user: string; pdfBase64: string; maxOutputTokens?: number; timeoutMs?: number }): Promise<HostedDocumentReply> {
  const key = apiKeyFor("gemini");
  if (!key) throw new Error("No API key configured for gemini");
  const timeoutMs = args.timeoutMs ?? 120_000;
  const model = pickGeminiModel(choice.model, await geminiModelNames(key));
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: args.system }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: args.pdfBase64 } }, { text: args.user }] }],
    generationConfig: { temperature: 0, ...(args.maxOutputTokens ? { maxOutputTokens: args.maxOutputTokens } : {}) },
  });
  const endpoint = geminiEndpoint(model, key) + "?key=" + encodeURIComponent(key);
  const response = await withRetries((signal) => fetch(endpoint, { method: "POST", signal, headers: { "content-type": "application/json", "x-goog-api-key": key }, body }), timeoutMs);
  if (!response.ok) throw failedResponse(response.status, await response.text());
  const payload = GeminiShape.parse(await response.json());
  if (payload.promptFeedback?.blockReason) throw new Error("The model declined this page: " + payload.promptFeedback.blockReason);
  const candidate = payload.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  return { text, truncated: candidate?.finishReason === "MAX_TOKENS", usage: { input: payload.usageMetadata?.promptTokenCount ?? 0, output: payload.usageMetadata?.candidatesTokenCount ?? 0, cached: payload.usageMetadata?.cachedContentTokenCount },
    resolved: { resolvedModel: payload.modelVersion ?? null, providerRequestId: payload.responseId ?? null, finishReason: candidate?.finishReason ?? null, region: null, resolvedProvider: "gemini" }, servedBy: choice };
}

/** Reads a (small, single- or few-page) PDF document natively, returning its text: with the configured reading model
 * when it can look at documents (OpenAI vision models included), else with a document-capable fallback provider
 * (reply.servedBy names it). Throws a clear error when nothing configured can read documents rather than guessing. */
export async function hostedDocumentToText(choice: ModelChoice, args: { system: string; user: string; pdfBase64: string; maxOutputTokens?: number; timeoutMs?: number }): Promise<HostedDocumentReply> {
  // Synthetic browser/CI journeys only; impossible in production (see
  // lib/ai/deterministic-model.ts and lib/launch/guards.ts).
  if (deterministicModelEnabled()) return { ...(await deterministicHostedDocumentText(args)), servedBy: choice };
  const reader = documentReaderFor(choice);
  if (!reader) throw new Error(describeChoice(choice) + " cannot read scanned PDF pages and no document-capable model is configured.");
  if (reader.provider === "anthropic") return anthropicDocumentText(reader, args);
  if (reader.provider === "gemini") return geminiDocumentText(reader, args);
  return openAiDocumentText(reader, args);
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { ensureChatSchema,getConversation,historyToken,openConversation,saveTurn,deleteHistory,ChatConflict } from "@/lib/chat/store";
import { loadPolicyInventory,retrieveContractSources } from "@/lib/policies/inventory";
import { negativeCoverageClaim } from "@/lib/policies/review-coverage";
import { POST } from "@/app/api/chat/route";
import { GET as getHistory,DELETE as removeHistory } from "@/app/api/chat/history/route";
import { GET as getSavedChat } from "@/app/api/chat/history/[id]/route";
import { GET as getJob } from "@/app/api/chat/jobs/[id]/route";
import { GET as getBenefits,PATCH as patchBenefit,DELETE as deleteBenefit } from "@/app/api/benefits/route";
import { GET as getLedger,PATCH as patchLedger,POST as postLedger } from "@/app/api/ledger/route";
import { addLedgerRow } from "@/lib/ledger/store";
import { GET as getClaimPack } from "@/app/api/claims/[id]/pack/route";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getIndexStatus,POST as indexBenefits } from "@/app/api/benefits/index/route";
import { POST as linkPerson } from "@/app/api/policies/link-person/route";
import { GET as listPolicies } from "@/app/api/policies/route";
import { nameKey,nameKeySql,notDismissedCondition,recountedReview } from "@/lib/policies/name-dismissals";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { searchPassages } from "@/lib/rag2/search";
import { linkRelatedReferenceDocuments,syncInsuredPersonToMember } from "@/lib/policies/linking";
import { seedLedger } from "@/lib/ledger/store";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";
import type { Interpretation } from "@/lib/chat/facts";
import type { PolicyAnalysis } from "@/lib/chat/types";
import { claimAndProcessOne } from "@/lib/jobs/worker-runtime";
import { PRODUCTION_JOB_TYPES } from "@/lib/jobs/processors";

/** Runs real PostgreSQL/pgvector SQL in a disposable WASM database.
 * Only Ollama responses are simulated; no user database, GPU or policies are modified.
 */
async function main(){
  const db=new PGlite({extensions:{vector,pgcrypto}});
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"),"utf8"));
  await db.exec(await readFile(path.resolve("sql/benefit-catalog.sql"),"utf8"));
  await db.exec(await readFile(path.resolve("sql/model-usage.sql"),"utf8"));
  await db.exec(await readFile(path.resolve("sql/coverage-ledger.sql"),"utf8"));
  // Async chat is a real producer of the shared durable queue; its route
  // regression must therefore install the same background_jobs schema the
  // standalone worker uses in production.
  await db.exec(await readFile(path.resolve("sql/background-jobs.sql"),"utf8"));
  // Household-scoped routes now resolve identity through
  // requireHouseholdContext()/createUserSupabaseClient(), which needs the
  // authenticated/anon/service_role shim roles and the household_members
  // RLS policies this file defines (see sql/household-rls.sql's own doc
  // comment -- a real Supabase project already has the authenticated role
  // and its default table grants; this file recreates just enough of that
  // for a non-Supabase Postgres, including this PGlite instance, to behave
  // the same way).
  await db.exec(await readFile(path.resolve("sql/household-rls.sql"),"utf8"));
  // Remembered removals ("who does this cover"), after is_household_member().
  await db.exec(await readFile(path.resolve("sql/policy-member-exclusions.sql"),"utf8"));
  await db.exec(await readFile(path.resolve("sql/detected-name-dismissals.sql"),"utf8"));
  // Checkpoint 7: lib/policies/inventory.ts's loadPolicyInventory() now filters
  // on policies.lifecycle_state via activePredicate() -- exec sql/lifecycle.sql
  // so that column exists here too.
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"),"utf8"));
  // No domain table outside accounts/household_members/household_invitations
  // has its own RLS policy file yet (see the Checkpoint 1/2 commit messages'
  // disclosed gap: the claims/policies repository layer is authorized at the
  // application layer -- explicit account_id filters -- not via Postgres
  // RLS). A real Supabase project grants `authenticated` broad table access
  // by default as part of its own bootstrapping; this mirrors that default
  // for every table so createUserSupabaseClient()'s `SET LOCAL ROLE
  // authenticated` can still reach them here, exactly as it can in production.
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  const account="00000000-0000-0000-0000-000000000001",foreign="00000000-0000-0000-0000-000000000099";
  // requireCurrentUser() resolves through the dev-only session fallback
  // (lib/auth/session.ts's devSessionUser(), gated behind DEV_AUTH_ENABLED
  // and unconditionally unavailable in production) rather than a real
  // Supabase session cookie -- there is no browser here, only a route
  // handler invoked directly. DEV_ACCOUNT_ID is pinned to this fixture's
  // own `account` id so every already-migrated route under test resolves
  // to the same household its seeded rows belong to.
  process.env.DEV_AUTH_ENABLED="1";
  process.env.DEV_ACCOUNT_ID=account;
  const uuid=(n:number)=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");
  const people=Array.from({length:9},(_,i)=>({
    id:uuid(i+1),display_name:i===0?"Tan Yi Chuen Desmond":i===1?"Ong Pei Lin Charmaine":"Family Member "+i,
    preferred_name:i===0?"Desmond":i===1?"Charmaine":"Member "+i,relationship:i===0?"self":i===1?"spouse":i<5?"child":"parent",
  }));
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Test Family'),($2,'Other Account')",[account,foreign]);
  // The dev-fallback session user (id == DEV_ACCOUNT_ID == account, see
  // above) needs a genuine household_members row of their own --
  // resolveActiveHouseholdId() re-verifies real membership on every call,
  // so a route under test can't reach `account`'s data without one.
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')",[account]);
  for(const p of people)await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)",[p.id,account,p.display_name,p.preferred_name,p.relationship]);
  const foreignPerson=uuid(9999);
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Other Account Person','self')",[foreignPerson,foreign]);

  // A connection mutex preserves transaction isolation for the single embedded
  // PostgreSQL connection. All SQL and constraints execute in PostgreSQL.
  let tail=Promise.resolve();
  const acquire=async()=>{
    const previous=tail;let release!:()=>void;
    tail=new Promise<void>(resolve=>{release=resolve;});await previous;return release;
  };
  const execute=async(text:string,params:unknown[]=[])=>{
    if(!params.length&&text.includes(";")){
      const results=await db.exec(text);const result=results.at(-1);
      return {rows:result?.rows??[],rowCount:result?.affectedRows??0};
    }
    const result=await db.query(text,params);
    return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};
  };
  const originalQuery=pool.query,originalConnect=pool.connect,originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;
  pool.query=(async(text:string,params:unknown[]=[])=>{const release=await acquire();try{return await execute(text,params);}finally{release();}}) as typeof pool.query;
  pool.connect=(async()=>{
    const release=await acquire();
    return {query:execute,release};
  }) as typeof pool.connect;
  // The suite runs the routing production runs. Restored after any test that
  // reroutes to another provider, so one test cannot silently change the next.
  const HARNESS_PRESET="gemini",HARNESS_KEY="AQ.test-key";
  const useHarnessModel=()=>{process.env.MODEL_PRESET=HARNESS_PRESET;process.env.GEMINI_API_KEY=HARNESS_KEY;};
  useHarnessModel();
  globalThis.setTimeout=((fn:Parameters<typeof setTimeout>[0],ms?:number,...args:unknown[])=>originalTimeout(fn,ms===700?0:ms,...args)) as typeof setTimeout;
  let interpretationCalls=0,readingCalls=0,explanationCalls=0,maxModelUserCharacters=0,catalogCalls=0,categoriseCalls=0,relevanceCalls=0,ledgerReads=0,ledgerChecks=0;
  let malformed=false,failReading=false,truncateInterpretations=0,misshapeReading=0;
  // The simulated model answers on Google's wire format, because that is the
  // one the app speaks. REPLAY_URL is how the provider-specific tests below
  // reuse these same answers without re-implementing the decision table.
  const REPLAY_URL="http://model.test/replay";
  const googleReply=(text:string)=>Response.json({modelVersion:"gemini-3.6-flash",responseId:"fixture-response",candidates:[{content:{parts:[{text}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:900,candidatesTokenCount:80}});
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(/googleapis\.com\/v1beta\/models\?/.test(url))
      return Response.json({models:[{name:"models/gemini-3.6-flash",supportedGenerationMethods:["generateContent"]},
        {name:"models/gemini-3.5-flash-lite",supportedGenerationMethods:["generateContent"]}]});
    const google=/googleapis\.com/.test(url);
    if(!google&&url!==REPLAY_URL)throw new Error("Unexpected model request: "+url);
    const body=JSON.parse(String(init?.body));
    const userText=google?String(body.contents[0].parts[0].text):String(body.user);
    const system:string=google?String(body.systemInstruction.parts[0].text):String(body.system);
    const user=JSON.parse(userText);
    maxModelUserCharacters=Math.max(maxModelUserCharacters,userText.length);
    const reply=(text:string)=>google
      ?Response.json({modelVersion:"gemini-3.6-flash",responseId:"fixture-response",candidates:[{content:{parts:[{text}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:900,candidatesTokenCount:80}})
      :Response.json({content:text});
    let result:unknown;
    if(system.startsWith("Interpret this")){
      interpretationCalls++;
      if(malformed)return reply("invalid JSON");
      const message:string=user.currentMessage,subject=user.subjects[0]?.id;
      const facts:Interpretation["facts"]=[];
      const scenarioCandidates:NonNullable<Interpretation["scenarioCandidates"]>=[];
      const add=(key:string,value:Interpretation["facts"][number]["value"],state:"known"|"unknown"|"pending"="known")=>facts.push({subjectId:subject,key,value,state,quote:message});
      const scenario=(label:string,family:NonNullable<Interpretation["scenarioCandidates"]>[number]["family"],traits:NonNullable<Interpretation["scenarioCandidates"]>[number]["traits"])=>
        scenarioCandidates.push({subjectId:subject,label,family,traits,quote:message});
      let intent:Interpretation["intent"]=/policies|portfolio|family have/i.test(message)?"portfolio":
        // A hypothetical reports no event, which is what the real prompt says.
        /\b(?:what if|if i|if my|suppose)\b/i.test(message)?"policy_question":
        /matur|surrender|premium|guaranteed|endowment/i.test(message)?"policy_question":user.previousIntent?"follow_up":"claim";
      if(/breast cancer/i.test(message)){
        intent="claim";add("eventType","diagnosis");add("diagnosis","stage 2 breast cancer");add("diagnosisStage","2");add("diagnosisSite","breast");
        facts.push({subjectId:subject,key:"diagnosisDate",value:"yesterday",state:"known",quote:"yesterday"});
        scenario("Breast cancer diagnosis and hospital attendance","illness",["illness","diagnosis","hospitalisation","medical_expense"]);
      }
      if(/\b(?:was|were) murdered\b/i.test(message)){
        intent="claim";add("eventType","death");add("death",true);add("causeOfDeath","murdered");add("eventLocation","Thailand");
        scenario("Reported homicide","death",["death","sudden","external","violent","unintentional_to_insured"]);
      }
      if(/flight was delayed/i.test(message)){
        intent="claim";add("eventType","travel_disruption");add("flightDelayHours",/three hours/i.test(message)?3:8);
        scenario("Flight delay","travel",["travel_disruption","delay"]);
      }
      if(/car was damaged|vehicle was damaged/i.test(message)){
        intent="claim";add("eventType","accident");add("vehicleDamaged",true);add("vehicleRepairBill",4000);
        scenario("Vehicle collision damage","motor",["accident","sudden","external","vehicle_collision","property_damage"]);
      }
      if(/broke his (?:left )?forearm/i.test(message)){
        intent="claim";add("eventType","accident");add("accidentType","playing basketball");add("injured",true);add("fractureBodyPart","forearm");
        scenario("Broken forearm playing basketball","injury",["accident","bodily_injury","sudden","external"]);
      }
      if(/\bdengue\b/i.test(message)){
        intent="claim";add("eventType","diagnosis");add("diagnosis","dengue");
        scenario("Dengue fever","illness",["illness","diagnosis"]);
      }
      // A short answer to the pending question, the way the real prompt does it.
      const pending=user.pendingQuestion as {factKey:string;subjectId:string}|null;
      if(pending&&/^\s*(yes|no|not sure|\d+|an accident|an illness)\s*$/i.test(message)){
        intent="follow_up";
        const text=message.trim().toLowerCase();
        if(text==="not sure")facts.push({subjectId:pending.subjectId,key:pending.factKey,value:null,state:"pending",quote:message});
        else if(pending.factKey==="eventType")add("eventType",text==="an accident"?"accident":"diagnosis");
        else if(/^\d+$/.test(text))add(pending.factKey,Number(text));
        else add(pending.factKey,text==="yes");
      }
      if(/no ambulance/i.test(message))add("ambulanceUsed",false);
      else if(/ambulance/i.test(message))add("ambulanceUsed",true);
      const nights=message.match(/(\d+)\s*nights?/i);
      if(nights&&!/don['’]?t know|not sure/i.test(message)){add("hospitalNights",Number(nights[1]));add("hospitalised",true);}
      if(/bill/i.test(message)&&/don['’]?t know|not sure/i.test(message))add("hospitalBill",null,"pending");
      if(/nights/i.test(message)&&/don['’]?t know|not sure/i.test(message))add("hospitalNights",null,"pending");
      if(/warded for|still in hospital/i.test(message)){add("hospitalStayOngoing",true);add("hospitalised",true);}
      if(/discharged after twelve nights/i.test(message)){
        add("hospitalNights",12);add("hospitalStayOngoing",false);add("hospitalised",true);
      }
      result={intent,newTopic:false,searchTerms:["critical illness","major cancer","hospital cash","waiting period","maturity","accidental death","flight delay","vehicle damage"],facts,scenarioCandidates};
    }else if(system.startsWith("List the insurance benefits")){
      catalogCalls++;
      const text=String(user.text);
      const quote=text.match(/We pay 100% of Sum Insured for qualifying critical illness\./)?.[0];
      result=quote?{benefits:[{name:"Major Critical Illness",quote,formulaKind:"sum_insured",formulaValue:1,currency:"SGD",
        factKey:null,offsetDays:null,maximumDays:null,conditions:"The diagnosis must satisfy the defined illness."}]}
        // A page with no benefit rule must produce nothing, not a guess.
        :{benefits:[{name:"Invented",quote:"a quote that is not on this page at all",formulaKind:"fixed",formulaValue:99,
          currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,conditions:[]}]};
    }else if(system.startsWith("Build the coverage ledger")){
      // The simulated reader knows the seed wordings. It writes ledger rows
      // exactly the way the real reader is asked to: one row per rule, with
      // the sentence it came from and the page it is on.
      ledgerReads++;
      const rows:Record<string,unknown>[]=[];
      const family:string[]=user.familyMembers??[];
      for(const page of user.pages as {page:number;text:string}[]){
        const text:string=page.text;
        const named=family.find(name=>text.includes(name))??null;
        const plan=(text.match(/(?:owns |^)(Plan \d+ [A-Za-z ]+?|Review Fixture Critical Illness)(?:\.| Sum)/)?.[1]??text.match(/^([^.]+?)\./)?.[1]??"Plan").trim();
        const sum=Number(text.match(/Sum Insured SGD (\d+)/)?.[1]??"")||null;
        const q=(re:RegExp)=>text.match(re)?.[0]??null;
        let quote:string|null;
        if((quote=q(/we pay 100% of Sum Insured for a qualifying covered death\./i)))rows.push({insuredName:named,planName:plan,benefitName:"Death benefit",eventType:"death",paysKind:"percent_of_sum",amount:1,currency:"SGD",sumBasis:null,sourcePage:page.page,quote});
        if((quote=q(/For Death due to Accident, we pay 100% of Sum Insured\./i)))rows.push({insuredName:named,planName:plan,benefitName:"Personal accident death benefit",eventType:"accidental_death",cause:"accident",paysKind:"percent_of_sum",amount:1,currency:"SGD",sourcePage:page.page,quote});
        if((quote=q(/We pay 100% of Sum Insured for qualifying critical illness\./i)))rows.push({insuredName:named,planName:plan,benefitName:"Critical illness benefit",eventType:"critical_illness",paysKind:"percent_of_sum",amount:1,currency:"SGD",sourcePage:page.page,quote,conditions:["The diagnosis must satisfy the defined illness."]});
        if((quote=q(/Daily hospital cash benefit S\$30 per day after the 10th day, maximum of 30 continuous days\./i)))rows.push({insuredName:named,planName:plan,benefitName:"Daily hospital cash",eventType:"hospital_daily_cash",paysKind:"per_day",amount:30,currency:"SGD",offsetDays:10,maximumDays:30,sourcePage:page.page,quote});
        if((quote=q(/Flight delay benefit pays a fixed S\$300 if departure is delayed at least 6 hours\./i)))rows.push({insuredName:named,planName:plan,benefitName:"Flight delay benefit",eventType:"travel_delay",paysKind:"lump_sum",amount:300,currency:"SGD",sourcePage:page.page,quote,minimum:{factKey:"flightDelayHours",value:6}});
        if((quote=q(/We reimburse the reasonable repair cost for accidental damage to the insured vehicle up to S\$100,000\./i)))rows.push({insuredName:named,planName:plan,benefitName:"Vehicle damage reimbursement",eventType:"motor_damage",cause:"accident",paysKind:"reimbursement_cap",amount:100000,currency:"SGD",sourcePage:page.page,quote});
        if((quote=q(/Sum Insured SGD \d+\./)))for(const row of rows)if(row.sourcePage===page.page&&row.paysKind==="percent_of_sum"&&row.sumBasis==null)row.sumBasis=sum;
        // A schedule line ("X owns Plan N Death. Sum Insured SGD 1000000.") states the sum insured of a plan, not a payout rule.
      }
      result={rows};
    }else if(system.startsWith("Check coverage ledger rows")){
      ledgerChecks++;
      result={verdicts:(user.rows as {index:number}[]).map(r=>({index:r.index,supported:true}))};
    }else if(system.startsWith("Read insurance")){
      readingCalls++;
      if(failReading)return reply("not valid json");
      if(misshapeReading>0){
        misshapeReading--;
        const quote={sourceId:user.sources[0].id,quote:String(user.sources[0].text).slice(0,120)};
        // The exact shape Qwen returned on DC's machine: a bare string where a
        // list of quoted conditions belongs, and one quote instead of a list.
        return reply(JSON.stringify({benefits:[{title:"Critical illness benefit",coverageId:user.confirmedCoverages[0]?.id,
          evidence:quote,requirements:[],conditions:"Subject to the defined illness.",
          formula:{kind:"none",value:null,currency:null,factKey:null,offsetDays:null,maximumDays:null,evidence:null}}],
          observations:[],nextSteps:[]}));
      }
      const analysis:PolicyAnalysis={benefits:[],observations:[],nextSteps:[]};
      const traits=new Set<string>((user.scenarioCandidates??[]).flatMap((candidate:{traits:string[]})=>candidate.traits));
      for(const s of user.sources){
        const text:string=s.text;
        const q={sourceId:s.id,quote:text};
        const owned=user.confirmedCoverages[0];
        if(!owned)continue;
        if(user.intent==="claim"&&traits.has("illness")&&/100% of Sum Insured for qualifying critical illness/i.test(text)){
          analysis.benefits.push({title:"Critical illness benefit",coverageId:owned.id,evidence:[q],
            formula:{kind:"sum_insured",value:1,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,evidence:q},
            requirements:[{factKey:"medicalDefinitionConfirmed",operator:"document",value:null,question:"",why:"The diagnosis must satisfy the defined illness.",evidence:q}],
            conditions:[{text:"The diagnosis must satisfy the defined illness.",evidence:q}]});
        }
        if(user.intent==="claim"&&traits.has("hospitalisation")&&/Daily hospital cash/i.test(text)){
          analysis.benefits.push({title:"Daily hospital cash",coverageId:owned.id,evidence:[q],
            formula:{kind:"daily",value:30,currency:"SGD",factKey:"hospitalNights",offsetDays:10,maximumDays:30,evidence:q},
            requirements:[
              {factKey:"hospitalised",operator:"equals",value:true,question:"Was this an inpatient admission?",why:"The benefit requires hospital admission.",evidence:q},
              {factKey:"hospitalNights",operator:"present",value:null,question:"What was the completed length of the hospital stay?",why:"The hospital cash amount depends on the completed stay.",evidence:q},
            ],conditions:[]});
        }
        if(user.intent==="claim"&&traits.has("death")&&/100% of Sum Insured for a qualifying covered death/i.test(text)){
          analysis.benefits.push({title:"Death benefit",coverageId:owned.id,evidence:[q],
            formula:{kind:"sum_insured",value:1,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,evidence:q},
            requirements:[],conditions:[]});
        }
        if(user.intent==="claim"&&traits.has("death")&&/Death due to Accident, we pay 100% of Sum Insured/i.test(text)){
          analysis.benefits.push({title:"Personal accident death benefit",coverageId:owned.id,evidence:[q],
            formula:{kind:"sum_insured",value:1,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,evidence:q},
            requirements:[{factKey:"accidentalDeath",operator:"equals",value:true,question:"",why:"The death must result from an Accident.",evidence:q}],conditions:[]});
        }
        if(user.intent==="claim"&&traits.has("delay")&&/Flight delay benefit pays a fixed S\$300/i.test(text)){
          analysis.benefits.push({title:"Flight delay benefit",coverageId:owned.id,evidence:[q],
            formula:{kind:"fixed",value:300,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,evidence:q},
            requirements:[{factKey:"flightDelayHours",operator:"at_least",value:6,question:"Was the departure delayed for at least 6 hours?",why:"The benefit starts at 6 hours.",evidence:q}],conditions:[]});
        }
        if(user.intent==="claim"&&traits.has("property_damage")&&/reimburse the reasonable repair cost/i.test(text)){
          analysis.benefits.push({title:"Vehicle damage reimbursement",coverageId:owned.id,evidence:[q],
            formula:{kind:"expense_cap",value:100000,currency:"SGD",factKey:"vehicleRepairBill",offsetDays:null,maximumDays:null,evidence:q},
            requirements:[{factKey:"vehicleDamaged",operator:"equals",value:true,question:"",why:"The insured vehicle must have accidental damage.",evidence:q}],conditions:[]});
        }
        if(user.intent!=="claim"&&/guaranteed maturity value/i.test(text)){
          const guaranteed=text.match(/The guaranteed maturity value is SGD \d+\./)?.[0];
          const projected=text.match(/The projected non-guaranteed maturity value is SGD \d+\./)?.[0];
          if(guaranteed)analysis.observations.push({text:guaranteed,evidence:[{sourceId:s.id,quote:guaranteed}]});
          if(projected)analysis.observations.push({text:projected,evidence:[{sourceId:s.id,quote:projected}]});
        }
      }
      result=analysis;
    }else if(system.startsWith("You decide which of a person")){
      relevanceCalls++;
      // The simulated reader knows what keywords cannot: dengue is not cancer.
      const event=String(user.event)+" "+(user.facts as string[]).join(" ");
      const candidates=user.candidates as {name:string}[];
      const applies:{name:string;why:string}[]=[],ruledOut:{name:string;why:string}[]=[];
      for(const c of candidates){
        if(/dengue/i.test(event)&&/cancer|paley|radiotherapy|dialysis|surgery/i.test(c.name))ruledOut.push({name:c.name,why:"not a treatment for dengue"});
        else applies.push({name:c.name,why:"responds to a hospital stay for an illness"});
      }
      result={applies,ruledOut};
    }else if(system.startsWith("You are given rows recovered")){
      categoriseCalls++;
      // The simulated reader knows two things keyword rules do not: "Loss of
      // speech" is a disability, and a premium is not a benefit.
      result={rows:(user.rows as {index:number;label:string}[]).map(row=>({index:row.index,
        isBenefit:!/premium/i.test(row.label),
        respondsTo:/speech|hearing|sight/i.test(row.label)?["disability","bodily_injury"]:[]}))};
    }else{
      explanationCalls++;
      result={summary:user.summary,details:(user.details??[]).slice(0,1)};
    }
    let content=JSON.stringify(result);
    if(truncateInterpretations>0&&system.startsWith("Interpret this")){truncateInterpretations--;content=content.slice(0,Math.floor(content.length*0.75));}
    return reply(content);
  }) as typeof fetch;

  let cases=0;const test=async(name:string,fn:()=>Promise<void>)=>{try{await fn();cases++;console.log("PASS "+name);}catch(error){throw new Error(name,{cause:error});}};
  const blank:ChatAnswer={mode:"answer",summary:"Saved answer",details:[],claimItems:[],nextSteps:[],confidence:null,citations:[],disclaimer:"",
    claimSessionId:null,questions:[],knownFacts:[],missingFacts:[]};
  const sendOnce=async(message:string,member:string|null=people[0].id,conversationId?:string,revision?:number,asynchronous=false)=>{
    const response=await POST(new NextRequest("http://localhost/api/chat",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({familyMemberId:member,scope:member?"member":"family",question:message,conversationId,conversationRevision:revision,asynchronous,timeZone:"Asia/Singapore"})}));
    return {response,data:await response.json()};
  };
  // V1.1 Task 3: a reported death, diagnosis, disability, hospital stay or
  // trip problem is now fact-found one question at a time (the category's
  // deterministic plan, lib/claims/fact-finding.ts) before any assessment.
  // The checks in this suite are about the assessment, so its interview is
  // answered "Not sure" first -- the injury interview keeps its own tests.
  const send=async(message:string,member:string|null=people[0].id,conversationId?:string,revision?:number,asynchronous=false)=>{
    let result=await sendOnce(message,member,conversationId,revision,asynchronous);
    for(let i=0;i<8&&!asynchronous&&result.response.status===200;i++){
      const answer=result.data.answer as ChatAnswer|undefined;
      const q=answer?.questions?.[0];
      if(!answer||answer.mode!=="fact_finding"||!q||!/^ff-(?!accidental_injury)/.test(q.id))break;
      result=await sendOnce("Not sure",answer.resolvedFamilyMemberId??member,answer.conversationId??undefined,answer.conversationRevision??undefined);
    }
    return result;
  };
  // A reported injury is fact-found one question per turn before any benefit
  // is shown. Answers each question the way the chat's own question card
  // does ("Question: answer"), asserting one question per turn, no claim
  // cards meanwhile, and that no question is ever asked twice.
  const answerInjuryInterview=async(first:ChatAnswer,member:string)=>{
    const reply:Record<string,string>={eventType:"An accident",eventLocation:"Singapore",eventDate:"2026-09-01",fractureConfirmed:"Yes",treatmentType:"Outpatient or clinic",injuryKind:"A broken bone"};
    const asked:string[]=[];let answer=first;
    for(let turn=0;turn<8&&answer.mode==="fact_finding"&&answer.questions.length;turn++){
      assert.equal(answer.questions.length,1,"Exactly one question at a time: "+JSON.stringify(answer.questions));
      assert.equal(answer.claimItems.length,0,"No claim cards while facts are missing");
      const q=answer.questions[0];const key=(q.id??"").replace(/^(?:claim-|ff-|q-)/,"");
      const value=Object.entries(reply).find(([k])=>key.endsWith(k)||q.id===k)?.[1]??q.options?.[0]??"Not sure";
      asked.push(q.text);
      answer=(await send(q.text.replace(/\?\s*$/,"")+": "+value,member,answer.conversationId,answer.conversationRevision)).data.answer as ChatAnswer;
    }
    assert.equal(new Set(asked).size,asked.length,"No question is asked twice: "+JSON.stringify(asked));
    return answer;
  };
  const awaitJob=async(id:string)=>{
    for(let i=0;i<3000;i++){
      const response=await getJob(new NextRequest("http://localhost/api/chat/jobs/"+id),{params:Promise.resolve({id})});
      const data=await response.json();
      if(data.job?.status==="complete")return data.result.answer as ChatAnswer;
      if(["failed","cancelled"].includes(data.job?.status))throw new Error(data.job.error);
      await new Promise(resolve=>originalTimeout(resolve,2));
    }
    throw new Error("Simulated analysis did not complete");
  };
  const seedPlans=async(count:number)=>{
    await db.query("DELETE FROM policies WHERE account_id=$1",[account]);
    await db.query("DELETE FROM policy_analysis_cache WHERE account_id=$1",[account]);
    const types=["Savings","Investment","Motor","Travel","Death","Personal Accident","Critical Illness","Early Critical Illness","Hospital Cash","Home"];
    for(let i=0;i<count;i++){
      const p=people[i%9],type=types[Math.floor(i/9)%types.length],id=uuid(10000+i),ref=uuid(50000+i),name="Plan "+i+" "+type;
      const sum=type==="Death"?1_000_000:type==="Personal Accident"?600_000:type==="Critical Illness"?350_000:100_000;
      const schedule=p.display_name+" owns "+name+". Sum Insured SGD "+sum+".";
      const wording=name+". "+(type==="Critical Illness"?"We pay 100% of Sum Insured for qualifying critical illness. The diagnosis must satisfy the defined illness.":
        type==="Hospital Cash"?"Daily hospital cash benefit S$30 per day after the 10th day, maximum of 30 continuous days. Hospital admission is required.":
        type==="Savings"?"The guaranteed maturity value is SGD 100000. The projected non-guaranteed maturity value is SGD 120000.":
        type==="Death"?"If the insured dies while covered, we pay 100% of Sum Insured for a qualifying covered death.":
        type==="Personal Accident"?"For Death due to Accident, we pay 100% of Sum Insured. The death must result from an Accident.":
        type==="Travel"?"Flight delay benefit pays a fixed S$300 if departure is delayed at least 6 hours.":
        type==="Motor"?"We reimburse the reasonable repair cost for accidental damage to the insured vehicle up to S$100,000.":
        type==="Home"?"We reimburse replacement cost for stolen household contents up to S$100,000.":
        "This plan is assessed from its own terms and schedule.");
      for(const item of [{id,text:schedule,personal:true},{id:ref,text:wording,personal:false}]){
        await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,file_hash) VALUES($1,$2,$3,'Example Insurer',$4,$5,$6,$7,$8,$9,'ready',$10,$10,'2022-01-01',$11::jsonb,'scan_clean','sha256:'||md5(random()::text||clock_timestamp()::text))",
          [item.id,account,p.id,name,"POLICY-"+i,type,item.personal?"personal_schedule":"policy_wording",item.personal,item.personal?95:60,item.id+".pdf",JSON.stringify({productsMentioned:[name]})]);
        await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)",[item.id,p.id,account]);
        await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)",[account,item.id,item.text]);
        await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,1,1,$5,$6::vector)",
          [uuid(100000+(item.personal?i:count+i)),account,p.id,item.id,item.text,"["+Array.from({length:1024},(_,j)=>j===0?1:0).join(",")+"]"]);
      }
      await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,$5,$6,'SGD',$7,1,$8,true,true)",
        [uuid(200000+i),account,id,p.id,type,sum,name,schedule]);
    }
    // Seeded documents have been READ. A household where nothing has ever been
    // read is a different case, exercised explicitly by its own test.
    await db.query("UPDATE policies SET benefits_indexed_at=now() WHERE account_id=$1 AND benefits_indexed_at IS NULL",[account]);
  };
  try{
    await test("Legacy guided sessions and ordinary chats migrate without losing facts",async()=>{
      const claim=uuid(800000),plain=uuid(800001);
      await db.query("INSERT INTO claim_sessions(id,account_id,family_member_id,facts,event_summary) VALUES($1,$2,$3,$4::jsonb,'Previous diagnosis')",[claim,account,people[1].id,JSON.stringify({diagnosis:"stage 2 breast cancer",uncertainFacts:["hospital_nights"]})]);
      await db.query("INSERT INTO chat_messages(account_id,family_member_id,claim_session_id,role,content) VALUES($1,$2,$3,'user','Previous event')",[account,people[1].id,claim]);
      await db.query("INSERT INTO chat_messages(id,account_id,family_member_id,role,content) VALUES($1,$2,$3,'user','Previous normal question')",[plain,account,people[0].id]);
      await ensureChatSchema();
      const c=await getConversation(account,claim);assert.equal(c?.state.subjects[people[1].id].hospitalNights.state,"unknown");
      const migrated=await db.query<{conversation_id:string}>("SELECT conversation_id FROM chat_messages WHERE id=$1",[plain]);assert.ok(migrated.rows[0].conversation_id);
      await db.exec(await readFile(path.resolve("sql/chat-upgrade.sql"),"utf8"));
      assert.equal((await db.query("SELECT id FROM chat_conversations WHERE id=$1",[claim])).rows.length,1);
    });
    await seedPlans(90);
    await test("Real SQL loads all 90 mixed policies and correctly scopes one family member",async()=>{
      const all=await loadPolicyInventory(account,people);assert.equal(all.contracts.length,90);
      assert.equal(all.contracts.every(c=>c.references.length===1),true);
      const one=await loadPolicyInventory(account,[people[1]]);assert.equal(one.contracts.length,10);assert.equal(one.contracts.every(c=>c.ownerId===people[1].id),true);
    });
    await test("The last policy is retrieved independently of a global top-k",async()=>{
      const inventory=await loadPolicyInventory(account,people);
      const sources=await retrieveContractSources({accountId:account,contracts:inventory.contracts,question:"What death benefits are included?",searchTerms:["death"]});
      assert.equal(sources.size,90);assert.ok(sources.get(inventory.contracts.at(-1)!.id)?.length);
    });
    await test("An ambiguous chat moves completely to the family member later selected",async()=>{
      const first=await send("My parent was injured in an accident.");
      assert.equal(first.response.status,200,JSON.stringify(first.data));
      const prompt=first.data.answer as ChatAnswer;
      assert.equal(prompt.mode,"fact_finding");assert.ok((prompt.personCandidates?.length??0)>1);
      const response=await POST(new NextRequest("http://localhost/api/chat",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({familyMemberId:people[0].id,scope:"member",question:people[5].display_name,
          conversationId:prompt.conversationId,conversationRevision:prompt.conversationRevision,personChoiceId:people[5].id,
          personContextMessage:prompt.personContextMessage,personContextRecordedAt:prompt.personContextRecordedAt,
          asynchronous:false,timeZone:"Asia/Singapore"})}));
      const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
      assert.equal(data.answer.resolvedFamilyMemberId,people[5].id);
      const row=await getConversation(account,prompt.conversationId!);assert.equal(row?.family_member_id,people[5].id);
      const messages=await db.query<{family_member_id:string}>("SELECT family_member_id FROM chat_messages WHERE account_id=$1 AND conversation_id=$2",[account,prompt.conversationId]);
      assert.ok(messages.rows.length>=4);assert.equal(messages.rows.every(m=>m.family_member_id===people[5].id),true);
    });
    await test("A homicide keeps verified death cover visible and withholds inferred accidental death cover",async()=>{
      const result=await send("Desmond was murdered in Thailand");
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;
      assert.match(answer.summary,/reported death/i);assert.match(answer.summary,/Thailand/i);assert.doesNotMatch(answer.summary,/S\$1,000,000/);
      assert.equal(answer.potentialPayoutTotals?.length??0,0,"No payout total before claim evidence review");
      assert.ok(answer.claimItems.some(item=>/Death/.test(item.title)&&item.amountText===null),answer.claimItems.map(i=>i.title).join(" | "));
      assert.ok(answer.claimItems.some(item=>/Accidental death|Personal Accident/i.test(item.title)&&item.amountText===null&&item.status==="needs_document"),answer.claimItems.map(i=>i.title).join(" | "));
      assert.ok(answer.scenarioClassifications?.some(item=>item.traits.includes("violent")&&item.traits.includes("external")));
      assert.equal(new Set(answer.details).size,answer.details.length);
      const saved=(await getConversation(account,answer.conversationId!))!.state,state=saved.subjects[people[0].id];
      assert.equal(state.death.value,true);assert.equal(state.causeOfDeath.value,"murdered");assert.equal(state.eventLocation.value,"Thailand");
      assert.equal(state.accidentalDeath,undefined);assert.ok(saved.scenarios?.[people[0].id]?.length);
      // Deterministic fact-finding: what is still needed, never an amount,
      // and no question about a fact the family already gave.
      const plan=answer.factFinding?.find(p=>p.category==="accidental_death"&&p.subjectId===people[0].id);
      assert.ok(plan,JSON.stringify(answer.factFinding));
      assert.equal(plan!.readyForEvidenceGatedEstimate,false);
      assert.ok(plan!.missingDocuments.includes("Death certificate"));
      assert.ok(!plan!.nextQuestions.some(q=>q.factKey==="causeOfDeath"||q.factKey==="eventLocation"),"known facts are not asked again");
      assert.doesNotMatch(JSON.stringify(answer.factFinding),/S\$|SGD|US\$/);
    });
    // Reading a travel rule into the ledger checks it twice before trusting
    // it: the quote and every number must be on the cited page (deterministic,
    // code-checked), and a second, independent read of the same page must
    // agree it is what the document says. That double-check is the
    // confirmation this benefit needs -- "the person never has to confirm
    // anything; they can look" (lib/ledger/extract.ts) -- so once both checks
    // pass, the figure is shown with confidence, not held back a third time
    // for a human to re-approve what two independent reads already verified.
    await test("A travel rule is found without a pre-review payout figure",async()=>{
      const result=await send("Desmond's flight was delayed for eight hours.");
      assert.equal(result.response.status,200,JSON.stringify(result.data));const answer=result.data.answer as ChatAnswer;
      const flight=answer.claimItems.find(item=>item.title.includes("Flight delay"));
      assert.ok(flight,JSON.stringify(answer.claimItems.map(i=>[i.title,i.amountText,i.status])));
      assert.equal(flight!.amountText,null,"No flight-delay estimate before claim evidence review");
      assert.equal(flight!.status,"likely_applicable");
      assert.equal(flight!.preliminaryStatus,"policy_condition_unresolved");
      // V1.1 Task 4: the household sees where the rule is, not how DearPolicy
      // read it ("verified by a second read" is the system's own work).
      assert.match(flight!.reason,/page \d+/i);assert.doesNotMatch(flight!.reason,/second read/i);
      assert.equal(answer.potentialPayoutTotals?.length??0,0,"No payout total before claim evidence review");
    });
    await test("A duration below a travel threshold rules out only that benefit",async()=>{
      const result=await send("Desmond's flight was delayed for three hours.");
      assert.equal(result.response.status,200,JSON.stringify(result.data));const answer=result.data.answer as ChatAnswer;
      const item=answer.claimItems.find(value=>value.title.includes("Flight delay"));assert.equal(item?.status,"not_applicable");assert.equal(item?.amountText,null);
      assert.equal(answer.potentialPayoutTotals?.length,0);
    });
    // Same double-check as the travel rule above: the motor reimbursement
    // clause was confirmed by an independent second read, so the reported
    // repair bill is priced against it. A reimbursement is still never
    // summed into a lump-sum household total, which is the separate
    // invariant this test also protects.
    await test("A motor reimbursement is found without a pre-review payout or total",async()=>{
      const result=await send("Desmond's car was damaged in a collision. The vehicle repair bill is SGD 4,000.");
      assert.equal(result.response.status,200,JSON.stringify(result.data));const answer=result.data.answer as ChatAnswer;
      const item=answer.claimItems.find(value=>value.title.includes("Vehicle damage"));
      assert.ok(item,JSON.stringify(answer.claimItems.map(i=>[i.title,i.amountText,i.status])));
      assert.equal(item?.amountText,null,"No reimbursement estimate before claim evidence review");
      assert.equal(item?.status,"likely_applicable");
      assert.notEqual(item?.amountLabel,"Calculated reimbursement (internal)");
      assert.equal(item?.aggregation,undefined);
      assert.equal(answer.potentialPayoutTotals?.length,0,"A reimbursement is never added to a lump-sum household total");
    });
    await test("The active API resolves Charmaine before loading personal policies",async()=>{
      const result=await send("Charmaine fainted yesterday and took the ambulance to hospital. She was diagnosed with stage 2 breast cancer. I still don't know how much the hospital bill will be.");
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;assert.equal(answer.resolvedFamilyMemberId,people[1].id);
      assert.ok(answer.claimItems.some(item=>item.title.includes("Critical illness")&&item.amountText===null&&item.status==="needs_document"));
      assert.equal(answer.policyReview?.length,10);
      const row=await getConversation(account,answer.conversationId!);assert.equal(row?.family_member_id,people[1].id);
      assert.equal(row?.state.subjects[people[1].id].hospitalBill.state,"pending");
      assert.ok(interpretationCalls>0&&readingCalls>0&&explanationCalls>0);
    });
    let ongoingAnswer:ChatAnswer;
    await test("Unknown future nights do not repeat or block a separate cancer benefit",async()=>{
      const history=await db.query<{id:string;last_answer:ChatAnswer}>("SELECT id,last_answer FROM chat_conversations WHERE account_id=$1 AND family_member_id=$2 ORDER BY updated_at DESC LIMIT 1",[account,people[1].id]);
      const prior=history.rows[0].last_answer;
      const reply=await send("still not sure how many nights she needs to be warded for",people[1].id,history.rows[0].id,prior.conversationRevision);
      assert.equal(reply.response.status,200,JSON.stringify(reply.data));ongoingAnswer=reply.data.answer;
      assert.equal(ongoingAnswer.questions.length,0);assert.ok(ongoingAnswer.claimItems.some(item=>item.title.includes("Critical illness")&&item.amountText===null&&item.status==="needs_document"));
      const next=await send("i still don't know how many nights",people[1].id,ongoingAnswer.conversationId,ongoingAnswer.conversationRevision);
      assert.equal(next.response.status,200,JSON.stringify(next.data));ongoingAnswer=next.data.answer;assert.equal(ongoingAnswer.questions.length,0);
      const state=(await getConversation(account,ongoingAnswer.conversationId!))!.state;
      assert.equal(state.subjects[people[1].id].hospitalNights.state,"pending");
      assert.equal(state.subjects[people[1].id].hospitalStayOngoing.value,true);
    });
    await test("A completed stay updates memory and permits the independent daily calculation",async()=>{
      const result=await send("She was discharged after twelve nights.",people[1].id,ongoingAnswer.conversationId,ongoingAnswer.conversationRevision);
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;assert.ok(answer.claimItems.some(item=>item.title.includes("Daily hospital")&&item.amountText===null&&/applicable/.test(item.status)));
      const row=await getConversation(account,answer.conversationId!);assert.equal(row?.state.subjects[people[1].id].hospitalNights.value,12);
    });
    await test("Automatic context retains a named reported condition when model facts are empty",async()=>{
      const result=await send("Charmaine caught dengue",null);
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;assert.equal(answer.resolvedFamilyMemberId,people[1].id);
      assert.ok(answer.knownFacts.includes("Diagnosis: dengue"));
      assert.ok(answer.scenarioClassifications?.some(item=>item.family==="illness"&&item.traits.includes("diagnosis")));
      assert.match(answer.summary,/Charmaine.*dengue/i);assert.equal(answer.policyReview?.length,10);
      assert.ok(!answer.details.some(detail=>/model could not finish/i.test(detail)));
    });
    await test("Whole-family portfolio responses include all policies without a huge model prompt",async()=>{
      const result=await send("What policies does my family have?",null);assert.equal(result.response.status,200,JSON.stringify(result.data));
      assert.equal(result.data.answer.portfolioItems.length,90);assert.equal(result.data.answer.policyReview.length,90);
      assert.ok(maxModelUserCharacters<11000,"Maximum model input: "+maxModelUserCharacters);
    });
    // A maturity question asks what the policy document states. It is policy
    // information, not a claim assessment: the cited guaranteed and projected
    // values are explained separately, while no claim card carries an amount
    // and nothing is totalled.
    await test("Savings questions are policy information: cited guaranteed and projected values stay separate",async()=>{
      const result=await send("What happens when my endowment plan matures?",people[1].id);
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;
      const text=answer.details.join(" ");
      assert.match(text,/The guaranteed maturity value is SGD 100000\./);
      assert.match(text,/The projected non-guaranteed maturity value is SGD 120000\./);
      assert.doesNotMatch(text,/(?<!non-)guaranteed maturity value is SGD 120000/,"A projected value is never presented as guaranteed");
      assert.equal(answer.questions.length,0);
      assert.equal(answer.mode,"answer");
      assert.notEqual(answer.assessmentKind,"preliminary","A policy-information answer is not framed as a claim assessment");
      assert.equal(answer.potentialPayoutTotals?.length??0,0);
      assert.ok(answer.claimItems.every(item=>item.amountText===null&&item.calculatedAmount===undefined));
      assert.ok(answer.citations.length>0,"Policy-stated values are explained from cited wording");
    });
    // Negative control for the same wording: once the question asks what can
    // be claimed, the pre-review claim boundary applies and no figure is shown.
    await test("A claim-money question about the same plan stays inside the pre-review boundary",async()=>{
      const result=await send("My endowment plan matured. How much can I claim?",people[1].id);
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;
      const prose=[answer.summary,...answer.details,...answer.nextSteps].join(" ");
      assert.doesNotMatch(prose,/SGD 100000|SGD 120000|100,000|120,000/);
      assert.equal(answer.potentialPayoutTotals?.length??0,0);
      assert.ok(answer.claimItems.every(item=>item.amountText===null));
    });
    await test("Async analysis returns actual progress and a saved final answer",async()=>{
      const result=await send("What policies does my family have?",null,undefined,undefined,true);
      assert.equal(result.response.status,202,JSON.stringify(result.data));assert.ok(result.data.jobId);
      const config=PRODUCTION_JOB_TYPES.find(candidate=>candidate.jobType==="chat_analysis");
      assert.ok(config,"chat_analysis must be registered with the standalone worker");
      assert.equal(await claimAndProcessOne({jobType:"chat_analysis",workerId:`system-chat-${process.pid}`,process:config!.process}),"succeeded");
      const answer=await awaitJob(result.data.jobId);assert.equal(answer.portfolioItems?.length,90);
      const saved=await getSavedChat(new NextRequest("http://localhost/api/chat/history/"+answer.conversationId),{params:Promise.resolve({id:answer.conversationId!})});
      const payload=await saved.json();assert.equal(saved.status,200);assert.equal(payload.messages.length,2);assert.equal(payload.messages[1].answer_json.portfolioItems.length,90);
    });
    // Round 8: a malformed interpreter reply is retried once; when the retry is
    // malformed too, the message is read with plain rules and still answered
    // from the documents -- never a dead end, never raw model output.
    await test("A malformed model response is retried once, then the message is still answered from the documents",async()=>{
      const callsBefore=interpretationCalls;
      malformed=true;const result=await send("I still don't know how many hospital nights",people[1].id);malformed=false;
      assert.equal(result.response.status,200,JSON.stringify(result.data));assert.equal(result.data.answer.claimItems.length,0);
      assert.equal(interpretationCalls-callsBefore,2,"One retry, no more");
      assert.doesNotMatch(result.data.answer.summary,/couldn’t read your message/,"A broken interpreter no longer ends the turn");
      assert.ok(result.data.answer.citations.length>0,"Answered from cited documents");
      assert.equal(/\{|invalid JSON/.test(result.data.answer.summary+result.data.answer.details.join(" ")),false,"Raw model output never reaches the person");
    });
    await test("Saved chats and API requests cannot access another account",async()=>{
      const c=await openConversation({accountId:foreign,memberId:foreignPerson,title:"Other account secret"});
      assert.equal(await getConversation(account,c.id),null);
      const response=await getSavedChat(new NextRequest("http://localhost/api/chat/history/"+c.id),{params:Promise.resolve({id:c.id})});assert.equal(response.status,404);
      const result=await send("What policies are there?",foreignPerson);assert.equal(result.response.status,404);
      const removal=await removeHistory(new NextRequest("http://localhost/api/chat/history",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:c.id})}));
      assert.equal(removal.status,404);assert.ok(await getConversation(foreign,c.id));
    });
    await test("Concurrent replies cannot overwrite an already-saved revision",async()=>{
      const c=await openConversation({accountId:account,memberId:people[0].id,title:"Revision test"}),token=await historyToken(account,c.family_member_id);
      await saveTurn({conversation:c,token,state:c.state,message:"First message",answer:blank});
      await assert.rejects(saveTurn({conversation:c,token,state:c.state,message:"Stale message",answer:blank}),ChatConflict);
      assert.equal((await db.query("SELECT id FROM chat_messages WHERE conversation_id=$1",[c.id])).rows.length,2);
    });
    await test("Deleted chats cannot be restored by an in-flight result",async()=>{
      const c=await openConversation({accountId:account,memberId:people[0].id,title:"Delete during work"}),token=await historyToken(account,c.family_member_id);
      await deleteHistory(account,{id:c.id});
      await assert.rejects(saveTurn({conversation:c,token,state:c.state,message:"Late answer",answer:blank}),ChatConflict);
      assert.equal(await getConversation(account,c.id),null);
    });
    await test("Clearing a profile removes both normal and guided memory without deleting its policies",async()=>{
      const before=(await db.query("SELECT id FROM policies WHERE account_id=$1",[account])).rows.length;
      const c=await openConversation({accountId:account,memberId:people[1].id,title:"Clear during work"}),token=await historyToken(account,c.family_member_id);
      await deleteHistory(account,{memberId:people[1].id});
      await assert.rejects(saveTurn({conversation:c,token,state:c.state,message:"Late answer",answer:blank}),ChatConflict);
      assert.equal((await db.query("SELECT id FROM chat_conversations WHERE account_id=$1 AND family_member_id=$2",[account,people[1].id])).rows.length,0);
      assert.equal((await db.query("SELECT id FROM claim_sessions WHERE account_id=$1 AND family_member_id=$2",[account,people[1].id])).rows.length,0);
      assert.equal((await db.query("SELECT id FROM chat_messages WHERE account_id=$1 AND family_member_id=$2",[account,people[1].id])).rows.length,0);
      assert.equal((await db.query("SELECT id FROM policies WHERE account_id=$1",[account])).rows.length,before);
      assert.ok((await db.query("SELECT id FROM chat_conversations WHERE account_id=$1 AND family_member_id=$2",[account,people[0].id])).rows.length);
      await db.exec(await readFile(path.resolve("sql/chat-upgrade.sql"),"utf8"));
      assert.equal((await db.query("SELECT id FROM chat_conversations WHERE account_id=$1 AND family_member_id=$2",[account,people[1].id])).rows.length,0);
    });
    await test("Whole-family clear removes every account chat but preserves another account",async()=>{
      await deleteHistory(account,{all:true});
      assert.equal((await db.query("SELECT id FROM chat_conversations WHERE account_id=$1",[account])).rows.length,0);
      assert.equal((await db.query("SELECT id FROM chat_messages WHERE account_id=$1",[account])).rows.length,0);
      assert.equal((await db.query("SELECT id FROM policies WHERE account_id=$1",[account])).rows.length,180);
      assert.ok((await db.query("SELECT id FROM chat_conversations WHERE account_id=$1",[foreign])).rows.length);
    });
    await test("History is paginated, with no fixed limit on retained conversations",async()=>{
      for(let i=0;i<61;i++)await openConversation({accountId:account,memberId:people[0].id,title:"History "+i});
      const response=await getHistory(new NextRequest("http://localhost/api/chat/history?scope="+people[0].id)),data=await response.json();
      assert.equal(response.status,200);assert.equal(data.conversations.length,50);assert.ok(data.nextCursor);
      const next=await getHistory(new NextRequest("http://localhost/api/chat/history?scope="+people[0].id+"&cursor="+data.nextCursor)),page=await next.json();
      assert.equal(page.conversations.length,11);
    });
    const seedReviewFixture=async(wordingPages:number)=>{
      await db.query("DELETE FROM policies WHERE account_id=$1",[account]);
      await db.query("DELETE FROM policy_analysis_cache WHERE account_id=$1",[account]);
      await db.query("DELETE FROM premium_records WHERE account_id=$1",[account]);
      const person=people[0],id=uuid(700100),ref=uuid(700200),name="Review Fixture Critical Illness";
      const schedule=person.display_name+" owns "+name+". Sum Insured SGD 350000.";
      for(const item of [{id,text:schedule,personal:true},{id:ref,text:"placeholder",personal:false}]){
        await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,file_hash) VALUES($1,$2,$3,'Example Insurer',$4,'REVIEW-1','Critical Illness',$5,$6,$7,'ready',$8,$8,'2022-01-01',$9::jsonb,'scan_clean','sha256:'||md5(random()::text||clock_timestamp()::text))",
          [item.id,account,person.id,name,item.personal?"personal_schedule":"policy_wording",item.personal,item.personal?95:60,item.id+".pdf",JSON.stringify({productsMentioned:[name]})]);
        await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)",[item.id,person.id,account]);
      }
      // These documents have been READ; they simply state no rule this fixture
      // needs. That is a different state from never having been read, and it is
      // the one these fallback tests are about.
      await db.query("UPDATE policies SET benefits_indexed_at=now() WHERE account_id=$1 AND benefits_indexed_at IS NULL",[account]);
      await db.query("UPDATE policies SET conditions_indexed_at=now() WHERE account_id=$1 AND conditions_indexed_at IS NULL",[account]).catch(()=>{});
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)",[account,id,schedule]);
      await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,1,1,$5,$6::vector)",
        [uuid(700300),account,person.id,id,schedule,"["+Array.from({length:1024},(_,j)=>j===0?1:0).join(",")+"]"]);
      for(let page=1;page<=wordingPages;page++){
        const text=page===1?name+". We pay 100% of Sum Insured for qualifying critical illness. The diagnosis must satisfy the defined illness.":
          name+". Section "+page+" sets out administrative conditions that this retrieval did not return. "+"Clause text ".repeat(120);
        await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)",[account,ref,page,text]);
        await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)",
          [uuid(700400+page),account,person.id,ref,page,text,"["+Array.from({length:1024},(_,j)=>j===0?1:0).join(",")+"]"]);
      }
      await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,'Critical Illness',350000,'SGD',$5,1,$6,true,true)",
        [uuid(700500),account,id,person.id,name,schedule]);
      return {policyId:id,referenceId:ref,person};
    };
    await test("An unread policy section is reported as a partial review, never as no coverage",async()=>{
      await seedReviewFixture(12);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.reviewCoverage?.complete,false);
      assert.equal(answer.reviewCoverage?.contractsTotal,1);
      assert.equal(answer.reviewCoverage?.pagesTotal,13);
      assert.ok((answer.reviewCoverage?.pagesRead??0)>0&&(answer.reviewCoverage?.pagesRead??0)<13,"Only the retrieved pages may count as read");
      assert.equal(answer.policyReview?.[0].coverage?.completeness,"partial_retrieval");
      assert.equal(answer.policyReview?.[0].coverage?.passagesTotal,13);
      // V1.1: page counts are internal reading progress, not household text (eval internal_text); the counts are asserted on the numeric fields above.
      assert.match(answer.reviewCoverage!.statement,/^Partial review: not every part/);assert.doesNotMatch(answer.reviewCoverage!.statement,/\d+ of \d+/);
      assert.ok(!answer.details.includes(answer.reviewCoverage!.statement),"The banner owns the statement; repeating it in details duplicated it on screen");
      const normalised=answer.details.map(d=>d.toLowerCase().replace(/[^a-z0-9]+/g," ").trim());
      assert.equal(new Set(normalised).size,normalised.length,"No detail may appear twice");
      assert.equal(negativeCoverageClaim(answer.summary),false);
      // The wording section (13 pages) was never fully retrieved, so the
      // payout rule is not fully verified. The gate must withhold the
      // amount -- but the benefit itself, being potentially relevant, must
      // stay visible rather than disappearing or reading as "not covered".
      const item=answer.claimItems[0];
      assert.ok(item,"The potentially relevant critical-illness benefit must remain visible");
      assert.match(item!.title,/[Cc]ritical [Ii]llness/);
      assert.equal(item!.status,"needs_document");
      assert.equal(item!.amountText,null);
      assert.match(item!.reason,/withheld/i,"The reason must explain the amount was withheld, not just state a fact");
      assert.ok(item!.conditions.some(c=>/partial policy review/i.test(c)),"A condition must name the incomplete review as the cause");
    });
    await test("A fully read contract is reported as a complete review",async()=>{
      await seedReviewFixture(1);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.reviewCoverage?.complete,true);
      assert.equal(answer.reviewCoverage?.pagesTotal,2);
      assert.equal(answer.reviewCoverage?.pagesRead,2);
      assert.equal(answer.policyReview?.[0].coverage?.completeness,"full_text_reviewed");
      assert.match(answer.reviewCoverage!.statement,/^Complete review/);
    });
    await test("Missing premium evidence flags active status without changing ownership",async()=>{
      const fixture=await seedReviewFixture(1);
      const stale=(await send("What policies do we have?",people[0].id)).data.answer as ChatAnswer;
      const staleItem=stale.portfolioItems?.find(item=>item.ownerName===fixture.person.display_name);
      assert.equal(staleItem?.confirmed,true);
      assert.equal(staleItem?.coverages[0].amount,350000);
      assert.equal(staleItem?.currentness?.state,"unknown");
      assert.equal(staleItem?.currentness?.label,"Active status not recently verified");
      assert.ok(stale.nextSteps.some(step=>/premium receipt or renewal notice/i.test(step)));
      // The medical-definition match for a critical-illness diagnosis is a
      // document-confirmation requirement the mock evidence never resolves
      // (see the shared CI benefit fixture above), so this claim is withheld
      // on that ground regardless of premium evidence. That withholding is
      // separate from ownership/currentness -- the point under test here is
      // that a missing premium receipt only ever adds its own qualifier and
      // never substitutes for, or erases, the other reasons already present.
      const claim=(await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id)).data.answer as ChatAnswer;
      const claimItem=claim.claimItems[0];
      assert.ok(claimItem,"The critical-illness benefit must remain visible");
      assert.equal(claimItem!.status,"needs_document");
      assert.equal(claimItem!.amountText,null,"A missing receipt must not manufacture an amount that was never confirmed");
      // Round 5: the currentness note is about the policy, so it is said once
      // per answer (answer.details), not repeated on every benefit card
      // (lib/policies/currentness.ts consolidateActiveStatus).
      assert.ok(claim.details.some(d=>d.startsWith("Active status not recently verified")),"The currentness qualifier must still be present alongside the medical-definition qualifier");
      assert.equal(claim.details.filter(d=>d.startsWith("Active status not recently verified")).length,1,"The currentness qualifier is said once per answer");
      assert.ok(claimItem!.conditions.some(c=>c.startsWith("The diagnosis must satisfy")),"The medical-definition qualifier that actually withholds the amount must also be present");
      await db.query("INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,policy_number,amount,currency,payment_date) VALUES($1,$2,$3,'Example Insurer','REVIEW-1',1200,'SGD',current_date - 30)",
        [account,fixture.policyId,fixture.person.id]);
      const fresh=(await send("What policies do we have?",people[0].id)).data.answer as ChatAnswer;
      const freshItem=fresh.portfolioItems?.find(item=>item.ownerName===fixture.person.display_name);
      assert.equal(freshItem?.currentness?.state,"verified_recent");
      assert.equal(freshItem?.coverages[0].amount,350000);
    });
    await test("A premium receipt for another person or policy cannot verify this contract",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,policy_number,amount,currency,payment_date) VALUES($1,NULL,$2,'Example Insurer','REVIEW-1',1200,'SGD',current_date - 10)",
        [account,people[3].id]);
      await db.query("INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,policy_number,amount,currency,payment_date) VALUES($1,NULL,$2,'Example Insurer','SOME-OTHER-POLICY',1200,'SGD',current_date - 10)",
        [account,fixture.person.id]);
      const answer=(await send("What policies do we have?",people[0].id)).data.answer as ChatAnswer;
      const item=answer.portfolioItems?.find(row=>row.ownerName===fixture.person.display_name);
      assert.equal(item?.currentness?.state,"unknown");
      assert.equal(item?.confirmed,true);
    });
    await test("A long booklet is read deeper than the small-document floor",async()=>{
      await seedReviewFixture(40);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.reviewCoverage?.pagesTotal,41);
      assert.ok((answer.reviewCoverage?.pagesRead??0)>=8,"A 40-passage booklet must not be read six passages at a time, got "+answer.reviewCoverage?.pagesRead);
      assert.equal(answer.reviewCoverage?.complete,false,"and what the call budget left unread is still reported");
      // The critical-illness benefit's medical-definition match is a
      // document-confirmation requirement (see the shared CI mock above),
      // which the safety gate withholds regardless of how deep the read
      // went -- the depth assertions above are what this test is actually
      // about.
      assert.equal(answer.claimItems[0]?.status,"needs_document");
      assert.equal(answer.claimItems[0]?.amountText,null);
    });
    await test("A claim amount states the specific reasons it could settle differently",async()=>{
      await seedReviewFixture(1);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      // The medical-definition match is a document-confirmation requirement
      // (see the shared CI mock above), so the monetary gate withholds the
      // amount outright rather than showing it with a qualifier -- a
      // qualifier next to a figure that is not displayed is its own defect
      // (fixed in lib/chat/workflow.ts alongside this test). The specific
      // reasons this test is about must still be visible, on the benefit's
      // own conditions, exactly as strongly as before.
      const item=answer.claimItems[0];
      assert.ok(item,"The potentially relevant benefit must remain visible");
      assert.equal(item!.status,"needs_document");
      assert.equal(item!.amountText,null);
      assert.equal(answer.potentialPayoutTotals?.length??0,0,"No total may be shown when its only item was withheld");
      assert.ok(!answer.payoutQualifiers?.length,"A qualifier with no displayed total to qualify is a dangling caveat");
      assert.ok(item!.conditions.some(c=>/defined illness|definition/i.test(c)),"The outstanding definition is the real reason here: "+JSON.stringify(item!.conditions));
      // Round 5: named once per answer (answer.details), not on each card.
      assert.ok(answer.details.some(d=>/active status not recently verified/i.test(d)),"The missing premium/renewal evidence must also be named");
      assert.doesNotMatch(answer.summary,/S\$350,000/,"An unconfirmed amount must never reach the summary text either");
    });
    await test("A failed evidence batch is never counted as text that was read",async()=>{
      await seedReviewFixture(1);
      failReading=true;
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      failReading=false;
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.reviewCoverage?.pagesRead,0,"Sections the model could not finish were sent, not read");
      assert.equal(answer.reviewCoverage?.complete,false);
      assert.ok((answer.reviewCoverage?.windowsFailed??0)>0);
      assert.equal(answer.claimItems.length,0);
      assert.equal(negativeCoverageClaim(answer.summary),false,"A failed batch must never read as an absence of cover");
      assert.match(answer.summary,/incomplete review/i);
      // Round 6: the retry step is said in household words ("Ask the same question again in a minute"), not "evidence batch".
      assert.ok(answer.nextSteps.some(step=>/\bask the same question again\b/i.test(step)&&!/evidence batch/i.test(step)),"The user must be told to retry rather than left with silence");
    });
    await test("A contract with no matching wording asks for it instead of going quiet",async()=>{
      await db.query("DELETE FROM policies WHERE account_id=$1 AND document_role='policy_wording'",[account]);
      await db.query("DELETE FROM policy_analysis_cache WHERE account_id=$1",[account]);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.claimItems.length,0);
      assert.equal(answer.questions.length,1,"Missing wording is something the user can fix, so ask for it");
      assert.match(answer.questions[0].text,/policy wording or benefit summary/i);
      assert.match(answer.questions[0].why,/payout rule/i);
      assert.equal(answer.policyReview?.[0].coverage?.completeness,"no_wording");
    });
    await test("Interpretation cut off part-way through still answers the turn",async()=>{
      await seedReviewFixture(1);
      truncateInterpretations=1;
      const {response,data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      truncateInterpretations=0;
      assert.equal(response.status,200,JSON.stringify(data));
      const answer=data.answer as ChatAnswer;
      assert.doesNotMatch(answer.summary,/invalid structured JSON/i,"A raw JSON dump must never reach the user");
      assert.ok(!answer.details.some(d=>d.includes("subjectId")),"The raw model output must not be shown");
      assert.ok(answer.claimItems[0],"A salvaged or retried interpretation still produces the assessment");
      assert.equal(answer.claimItems[0]?.status,"needs_document");
    });
    await test("Short subject handles are mapped back to the real family member",async()=>{
      await seedReviewFixture(1);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.resolvedFamilyMemberId,people[0].id);
      assert.ok(answer.knownFacts.some(f=>/breast cancer/i.test(f)),"Facts must land on the real person, not on the handle");
      const saved=await getConversation(account,answer.conversationId!);
      assert.ok(saved?.state.subjects[people[0].id],"State is keyed by the real family member id");
      assert.equal(Object.keys(saved!.state.subjects).some(k=>/^s\d+$/.test(k)),false,"No short handle may leak into saved state");
    });
    await test("A turn stops at its reading budget instead of running for minutes",async()=>{
      await seedReviewFixture(40);
      process.env.RAG_MAX_EVIDENCE_WINDOWS="2";
      // Small sections so this document needs more of them than the budget
      // allows, which is the situation the test is about. At the default size
      // the whole document fits in one section and nothing is ever cut short.
      process.env.RAG_EVIDENCE_WINDOW_CHARACTERS="3300";
      const readsBefore=readingCalls;
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      delete process.env.RAG_MAX_EVIDENCE_WINDOWS;delete process.env.RAG_EVIDENCE_WINDOW_CHARACTERS;
      const answer=data.answer as ChatAnswer;
      assert.ok(readingCalls-readsBefore<=2,"The call ceiling must be enforced, made "+(readingCalls-readsBefore));
      assert.equal(answer.reviewCoverage?.complete,false);
      assert.equal(negativeCoverageClaim(answer.summary),false,"Stopping early is an incomplete review, not an absence of cover");
      assert.ok(answer.details.some(d=>/still unread/i.test(d)),"The user must be told the read was cut short");
    });
    await test("A misshapen reading reply is repaired instead of losing the section",async()=>{
      await seedReviewFixture(1);
      misshapeReading=1;
      const readsBefore=readingCalls;
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      misshapeReading=0;
      const answer=data.answer as ChatAnswer;
      assert.equal(readingCalls-readsBefore,1,"A wrong shape must not trigger a second, slower attempt");
      assert.ok(answer.claimItems.some(item=>/Critical illness benefit/.test(item.title)),
        "The salvageable benefit must survive: "+JSON.stringify(answer.claimItems.map(i=>i.title)));
      assert.equal(answer.reviewCoverage?.windowsFailed,0,"The section counts as read, because it was");
    });
    await test("A failed section never prints validation output to the user",async()=>{
      await seedReviewFixture(1);
      failReading=true;
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      failReading=false;
      const answer=data.answer as ChatAnswer;
      const everything=[answer.summary,...answer.details,...answer.nextSteps].join(" ");
      // Round 6: said in household words, never "evidence batch" or the provider's own reason.
      assert.ok(/couldn’t be read just now/i.test(everything)&&!/evidence batch|flash|gemini|google/i.test(everything),"The user is still told a section could not be read");
      for(const leak of ["invalid_type","ZodError","{\"","received","sourceId"])
        assert.equal(everything.includes(leak),false,"Raw model or validation output leaked: "+leak);
    });
    await test("The same benefit is not shown as two identical cards",async()=>{
      await seedReviewFixture(1);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      const keys=answer.claimItems.map(item=>item.title+"|"+(item.amountText??"")+"|"+item.status);
      assert.equal(new Set(keys).size,keys.length,"Duplicate cards: "+keys.join(" / "));
    });
    await test("With benefits on file, a claim is answered without reading documents",async()=>{
      const fixture=await seedReviewFixture(40);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,fact_key,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Death Benefit',ARRAY['death']::text[],'sum_insured',1,'SGD',NULL,9,'On death we pay the Sum Insured.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const readsBefore=readingCalls,narrationsBefore=explanationCalls;
      const started=Date.now();
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(readingCalls-readsBefore,0,"Stored rules mean the documents are never re-read");
      // V1.1 Task 5: the final claim answer is composed by code from the
      // stored rules and the interview; no paid model call restates it.
      assert.equal(explanationCalls-narrationsBefore,0,"No model call only to restate a deterministic claim answer");
      assert.match(answer.summary,/possible benefit/i,"It still speaks to the person, in words, not a table");
      assert.ok(Date.now()-started<4000,"A catalogued answer must be effectively instant");
      assert.equal(answer.potentialPayoutTotals?.length??0,0);
      assert.equal(answer.claimItems.length,1,"Only benefits the event can trigger: "+JSON.stringify(answer.claimItems.map(i=>i.title)));
      assert.match(answer.claimItems[0].title,/Major Critical Illness/);
      assert.match(answer.claimItems[0].reason,/page 7/);
      assert.doesNotMatch(answer.summary,/S\$350,000/);
    });
    await test("A document whose conditions were never read has them read without being asked",async()=>{
      const fixture=await seedReviewFixture(2);
      // The state every household was in the day this shipped: rules on file,
      // and nothing yet read about what those covers do NOT pay.
      await db.query("UPDATE policies SET conditions_indexed_at=NULL WHERE account_id=$1",[account]);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const unreadBefore=Number((await db.query<{n:number}>("SELECT count(*)::int AS n FROM policies WHERE account_id=$1 AND conditions_indexed_at IS NULL",[account])).rows[0].n);
      assert.ok(unreadBefore>0,"the fixture should start with conditions unread");
      await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const unreadAfter=Number((await db.query<{n:number}>("SELECT count(*)::int AS n FROM policies WHERE account_id=$1 AND conditions_indexed_at IS NULL",[account])).rows[0].n);
      assert.ok(unreadAfter<unreadBefore,"asking a question should have read the conditions, with nothing pressed");
      // And never again: a document is read once and marked.
      const callsBefore=readingCalls+explanationCalls;
      await send("And what about a heart attack?",people[0].id);
      const readAgain=Number((await db.query<{n:number}>("SELECT count(*)::int AS n FROM policies WHERE account_id=$1 AND conditions_indexed_at IS NULL",[account])).rows[0].n);
      assert.ok(readAgain<=unreadAfter,"a document already read must not be read again");
      assert.ok(readingCalls+explanationCalls-callsBefore<20,"the second question must not pay the reading cost again");
    });
    await test("The same question gives the same answer every time",async()=>{
      const first=(await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id)).data.answer as ChatAnswer;
      const second=(await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id)).data.answer as ChatAnswer;
      // The DECISION is deterministic. The wording is free to vary, which is
      // what keeps the chat feeling like a conversation rather than a report.
      assert.deepEqual(first.claimItems,second.claimItems);
      assert.deepEqual(first.potentialPayoutTotals,second.potentialPayoutTotals);
    });
    await test("Rebuilding the catalogue never touches documents or coverage",async()=>{
      const { replaceBenefitCatalog,loadBenefitCatalog }=await import("@/lib/policies/benefit-catalog");
      const fixture=await db.query<{id:string}>("SELECT id FROM policies WHERE account_id=$1 AND document_role='policy_wording'",[account]);
      const documentsBefore=(await db.query("SELECT id FROM policies WHERE account_id=$1",[account])).rows.length;
      const coveragesBefore=(await db.query("SELECT id FROM policy_coverages WHERE account_id=$1",[account])).rows.length;
      const pagesBefore=(await db.query("SELECT id FROM policy_pages WHERE account_id=$1",[account])).rows.length;
      await replaceBenefitCatalog(account,fixture.rows[0].id,[]);
      assert.equal((await loadBenefitCatalog(account,[fixture.rows[0].id])).length,0);
      assert.equal((await db.query("SELECT id FROM policies WHERE account_id=$1",[account])).rows.length,documentsBefore);
      assert.equal((await db.query("SELECT id FROM policy_coverages WHERE account_id=$1",[account])).rows.length,coveragesBefore);
      assert.equal((await db.query("SELECT id FROM policy_pages WHERE account_id=$1",[account])).rows.length,pagesBefore);
    });
    await test("Indexing happens per document and refuses a quote that is not on the page",async()=>{
      const fixture=await seedReviewFixture(3);
      const { catalogueDocument,documentPages }=await import("@/lib/policies/catalog-builder");
      const { loadBenefitCatalog }=await import("@/lib/policies/benefit-catalog");
      const before=catalogCalls;
      const pages=await documentPages(account,fixture.referenceId);
      const seen:number[]=[];
      const stored=await catalogueDocument({accountId:account,policyId:fixture.referenceId,productName:"Review Fixture Critical Illness",
        pages,report:(page)=>seen.push(page)});
      // V1.1 Task 5 ($5/month budget): only a page with something unread on it is sent to the model; the two administrative pages cost nothing.
      assert.equal(catalogCalls-before,1,"Only the page that states a rule is read by the model");
      assert.deepEqual(seen,pages.map((_,index)=>index+1),"Progress is reported per page so the user can watch it");
      assert.equal(stored,1,"Only the page that actually states a rule yields a benefit");
      const catalog=await loadBenefitCatalog(account,[fixture.referenceId]);
      assert.equal(catalog.length,1);
      assert.equal(catalog[0].benefitName,"Major Critical Illness");
      assert.equal(catalog[0].formulaKind,"sum_insured");
      assert.deepEqual(catalog[0].traits,["illness"],"Traits come from the wording itself, not from a model's opinion");
      assert.deepEqual(catalog[0].conditions,["The diagnosis must satisfy the defined illness."],"A string condition is accepted as one condition");
      assert.equal(catalog[0].sourcePage,1);
      // Re-indexing replaces rather than accumulating.
      await catalogueDocument({accountId:account,policyId:fixture.referenceId,productName:"Review Fixture Critical Illness",pages});
      assert.equal((await loadBenefitCatalog(account,[fixture.referenceId])).length,1);
    });
    await test("The benefit schedule shows every stored rule in plain English",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Hospital Cash',ARRAY['hospitalisation']::text[],'daily',30,'SGD','hospitalNights',10,30,4,'We pay S$30 per day after the first 10 days, up to a maximum of 30 days.','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const data=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      assert.equal(data.summary.total,2);
      assert.equal(data.summary.needsYou,0,"A daily rule that states its own rate, waiting period and cap needs nothing from anyone");
      assert.equal(data.summary.usable,2);
      const hospital=data.benefits.find((b:{benefitName:string})=>b.benefitName==="Hospital Cash");
      // The whole point of the screen: a rule a non-specialist can check.
      assert.equal(hospital.pays,"S$30.00 per day after the first 10 days, up to 30 days");
      assert.equal(hospital.sourcePage,4,"A rule is only checkable next to the page it came from");
      assert.deepEqual(hospital.owners,[people[0].display_name]);
      assert.match(hospital.quote,/S\$30 per day/);
      const illness=data.benefits.find((b:{benefitName:string})=>b.benefitName==="Major Critical Illness");
      assert.equal(illness.pays,"100% of the sum insured on your schedule");
      const mine=await (await getBenefits(new NextRequest("http://localhost/api/benefits?familyMemberId="+people[0].id))).json();
      assert.equal(mine.summary.total,2);
      const other=await (await getBenefits(new NextRequest("http://localhost/api/benefits?familyMemberId="+people[2].id))).json();
      assert.equal(other.summary.total,0,"A person sees only the documents that are linked to them");
    });
    await test("A rule with no readable amount says so rather than showing a figure",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Dental',ARRAY['other']::text[],'none',NULL,NULL,12,'Dental treatment is covered as charged.','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const data=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      const dental=data.benefits.find((b:{benefitName:string})=>b.benefitName==="Dental");
      assert.equal(dental.pays,"Not yet readable — tell DearPolicy what this pays");
      assert.equal(data.summary.unreadable,1);
      assert.equal(/\d/.test(dental.pays),false,"An unreadable rule must never show a number");
    });
    await test("A correction outranks the parser and survives the document being read again",async()=>{
      const fixture=await seedReviewFixture(1);
      const wording="We pay 100% of the Sum Insured for a qualifying critical illness.";
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,$4,'[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness",wording]);
      const listed=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      const target=listed.benefits[0];
      const saved=await patchBenefit(new NextRequest("http://localhost/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:target.id,formula:{kind:"sum_insured",value:0.5,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null}})}));
      assert.equal(saved.status,200);
      const after=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      assert.equal(after.benefits[0].pays,"50% of the sum insured on your schedule");
      assert.equal(after.summary.needsYou,0,"Correcting a rule is itself the answer");
      assert.ok(after.benefits[0].reviewedAt,"The correction is recorded as human review");
      // Re-reading the document must not quietly restore the parser's version.
      const { replaceBenefitCatalog,loadBenefitCatalog }=await import("@/lib/policies/benefit-catalog");
      const stored=await replaceBenefitCatalog(account,fixture.referenceId,[{productName:"Review Fixture Critical Illness",
        benefitName:"Major Critical Illness",traits:["illness"],formulaKind:"sum_insured",formulaValue:1,currency:"SGD",
        factKey:null,offsetDays:null,maximumDays:null,sourcePage:7,quote:wording,conditions:[],requirements:[],needsReview:true}]);
      assert.equal(stored,0,"A reviewed benefit is not re-extracted over the top of the person's answer");
      const catalog=await loadBenefitCatalog(account,[fixture.referenceId]);
      assert.equal(catalog.length,1,"Re-reading must not duplicate the benefit");
      assert.equal(catalog[0].formulaValue,0.5);
      assert.equal(catalog[0].needsReview,false);
      // And the money actually answered with follows the correction.
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.claimItems[0].amountText,null,"The corrected rule must not become a pre-review payout");
    });
    await test("A rule DearPolicy could not compute is refused in plain language",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Hospital Cash',ARRAY['hospitalisation']::text[],'none',NULL,NULL,4,'A daily amount is payable while confined.','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const listed=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      const id=listed.benefits[0].id;
      const attempt=async(formula:Record<string,unknown>)=>{
        const response=await patchBenefit(new NextRequest("http://localhost/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
          body:JSON.stringify({id,formula})}));
        return {status:response.status,error:(await response.json()).error as string};
      };
      const uncapped=await attempt({kind:"daily",value:30,currency:"SGD",factKey:"hospitalNights",offsetDays:10,maximumDays:null});
      assert.equal(uncapped.status,400);
      assert.match(uncapped.error,/maximum number of days/);
      const unbound=await attempt({kind:"expense_cap",value:500,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null});
      assert.equal(unbound.status,400);
      assert.match(unbound.error,/which cost/i);
      const negative=await attempt({kind:"fixed",value:0,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null});
      assert.equal(negative.status,400);
      for(const message of [uncapped.error,unbound.error,negative.error])
        for(const leak of ["invalid_type","ZodError","{\"","received","formulaKind"])
          assert.equal(message.includes(leak),false,"Raw validation output leaked to the user: "+leak);
      const unchanged=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      assert.equal(unchanged.benefits[0].formulaKind,"none","A refused correction changes nothing");
      assert.equal(unchanged.benefits[0].needsReview,true);
    });
    await test("Saying a rule is already right records the review without changing it",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const listed=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      const response=await patchBenefit(new NextRequest("http://localhost/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:listed.benefits[0].id,needsReview:false})}));
      assert.equal(response.status,200);
      const after=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      assert.equal(after.benefits[0].formulaValue,1,"Confirming a rule must not alter it");
      assert.equal(after.benefits[0].needsReview,false);
      assert.ok(after.benefits[0].reviewedAt);
    });
    await test("Removing a row from the schedule leaves the document and cover untouched",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Table of Contents',ARRAY['other']::text[],'none',NULL,NULL,2,'Contents','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const listed=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      const pagesBefore=(await db.query("SELECT id FROM policy_pages WHERE account_id=$1",[account])).rows.length;
      const coveragesBefore=(await db.query("SELECT id FROM policy_coverages WHERE account_id=$1",[account])).rows.length;
      const response=await deleteBenefit(new NextRequest("http://localhost/api/benefits",{method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:listed.benefits[0].id})}));
      assert.equal(response.status,200);
      assert.equal((await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json()).summary.total,0);
      assert.equal((await db.query("SELECT id FROM policy_pages WHERE account_id=$1",[account])).rows.length,pagesBefore);
      assert.equal((await db.query("SELECT id FROM policy_coverages WHERE account_id=$1",[account])).rows.length,coveragesBefore);
    });
    await test("An out-of-date database upgrades itself instead of failing the person's next upload",async()=>{
      await seedReviewFixture(1);
      // Exactly what an existing install looks like before the upgrade.
      await db.query("ALTER TABLE policy_benefits DROP COLUMN reviewed_at");
      await db.query("ALTER TABLE policy_benefits DROP COLUMN basis_inferred");
      delete (globalThis as {__dearpolicyBenefitSchema?:unknown}).__dearpolicyBenefitSchema;
      const response=await getBenefits(new NextRequest("http://localhost/api/benefits"));
      assert.equal(response.status,200,"A missing column must never reach the user as an error");
      const columns=await db.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_name='policy_benefits' AND column_name IN ('reviewed_at','basis_inferred')");
      assert.equal(columns.rows.length,2,"Every column the catalogue needs is added on first use");
    });
    await test("The benefit schedule never shows or changes another account's rules",async()=>{
      await seedReviewFixture(1);
      const foreignPolicy=uuid(700900);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,document_authority,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'Other Insurer','Other Plan','OTHER-1','Critical Illness','policy_wording',60,'ready','other.pdf','other.pdf','scan_clean')",
        [foreignPolicy,foreign,foreignPerson]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)",[foreignPolicy,foreignPerson,foreign]);
      const inserted=await db.query<{id:string}>("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,'Other Plan','Other Benefit',ARRAY['illness']::text[],'fixed',1000,'SGD',1,'Other wording','[]'::jsonb,'[]'::jsonb,true) RETURNING id",
        [foreign,foreignPolicy]);
      const data=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      assert.equal(data.benefits.some((b:{benefitName:string})=>b.benefitName==="Other Benefit"),false);
      const response=await patchBenefit(new NextRequest("http://localhost/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:inserted.rows[0].id,needsReview:false})}));
      assert.equal(response.status,404);
      assert.equal((await db.query<{needs_review:boolean}>("SELECT needs_review FROM policy_benefits WHERE id=$1",[inserted.rows[0].id])).rows[0].needs_review,true);
      const removal=await deleteBenefit(new NextRequest("http://localhost/api/benefits",{method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:inserted.rows[0].id})}));
      assert.equal(removal.status,404);
      assert.equal((await db.query("SELECT id FROM policy_benefits WHERE id=$1",[inserted.rows[0].id])).rows.length,1);
      await db.query("DELETE FROM policies WHERE id=$1",[foreignPolicy]);
    });
    await test("An assessed claim produces a printable claim pack; an unassessed one says why not",async()=>{
      const assessed=uuid(701100),unassessed=uuid(701200);
      const packet={sessionId:assessed,eventSummary:"Fell from a motorcycle and fractured a wrist.",
        facts:{eventType:"accident",eventDate:"2026-09-14",injured:true,injuries:["fracture"],fractureBodyPart:"wrist",
          hospitalised:true,hospitalNights:4,uncertainFacts:[]},
        knownFacts:[],missingFacts:["the final hospital bill"],relevantOwnedProducts:["Group Personal Accident"],
        assessments:[{id:"gpa-fracture",title:"Simple Fracture (wrist)",status:"likely_applicable",amountText:"S$1,250",
          calculatedAmount:1250,currency:"SGD",reason:"25% of the S$5,000 fracture limit printed in the schedule.",
          conditions:[],evidenceTerms:["fracture"],productName:"Group Personal Accident",
          ruleEvidence:{chunkId:"c1",policyId:"p1",policyName:"Group Personal Accident",pageStart:14,pageEnd:14}}],
        nextSteps:["Ask the hospital for an itemised final bill."],ready:true};
      await db.query("INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_summary,facts,decision_packet) VALUES($1,$2,$3,'complete','Motorcycle accident',$4::jsonb,$5::jsonb)",
        [assessed,account,people[0].id,JSON.stringify(packet.facts),JSON.stringify(packet)]);
      await db.query("INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_summary,facts) VALUES($1,$2,$3,'fact_finding','Still answering questions','{}'::jsonb)",
        [unassessed,account,people[0].id]);
      const pack=await getClaimPack(new NextRequest("http://localhost/api/claims/"+assessed+"/pack"),{params:Promise.resolve({id:assessed})});
      assert.equal(pack.status,200);
      assert.equal(pack.headers.get("content-type"),"application/pdf");
      assert.match(pack.headers.get("content-disposition")??"",/attachment; filename="DearPolicy claim summary - Tan Yi Chuen Desmond\.pdf"/);
      const bytes=new Uint8Array(await pack.arrayBuffer());
      assert.equal(Buffer.from(bytes.slice(0,5)).toString("latin1"),"%PDF-");
      const { extractPdfPages }=await import("@/lib/documents/pdf");
      const printed=(await extractPdfPages(bytes)).map(page=>page.text).join(" ").replace(/\s+/g," ");
      assert.match(printed,/Tan Yi Chuen Desmond/);
      assert.doesNotMatch(printed,/S\$1,250/,"Preliminary claim pack must not print a proposed payout");
      assert.match(printed,/page 14/,"The insurer can check the policy wording");
      assert.doesNotMatch(printed,/the an amount/,"Redaction must leave readable prose");
      assert.match(printed,/Hospital discharge summary/,"The checklist follows the reported event");
      const pending=await getClaimPack(new NextRequest("http://localhost/api/claims/"+unassessed+"/pack"),{params:Promise.resolve({id:unassessed})});
      assert.equal(pending.status,409);
      assert.match((await pending.json()).error,/has not been assessed yet/);
      await db.query("DELETE FROM claim_sessions WHERE id=ANY($1::uuid[])",[[assessed,unassessed]]);
    });
    await test("A claim pack cannot be downloaded from another account",async()=>{
      const foreignClaim=uuid(701300);
      await db.query("INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_summary,facts,decision_packet) VALUES($1,$2,$3,'complete','Other event','{}'::jsonb,$4::jsonb)",
        [foreignClaim,foreign,foreignPerson,JSON.stringify({sessionId:foreignClaim,eventSummary:"Other event",facts:{},knownFacts:[],missingFacts:[],relevantOwnedProducts:[],assessments:[],nextSteps:[],ready:true})]);
      const response=await getClaimPack(new NextRequest("http://localhost/api/claims/"+foreignClaim+"/pack"),{params:Promise.resolve({id:foreignClaim})});
      assert.equal(response.status,404);
      assert.equal(response.headers.get("content-type")?.includes("pdf"),false);
      await db.query("DELETE FROM claim_sessions WHERE id=$1",[foreignClaim]);
    });
    await test("A document nobody has claimed is surfaced with one question, and answering it is one click",async()=>{
      const fixture=await seedReviewFixture(1);
      const orphan=uuid(701400);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,document_authority,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'Example Insurer','Household Shield Plan','ORPHAN-1','Personal Accident','policy_wording',60,'ready','shield-booklet.pdf','shield-booklet.pdf','scan_clean')",
        [orphan,account,people[0].id]);
      const before=await (await getDashboard(new NextRequest("http://localhost/api/dashboard"))).json();
      const listed=before.unclaimed.find((doc:{id:string})=>doc.id===orphan);
      assert.ok(listed,"An uploaded document with no owner is invisible everywhere else");
      assert.equal(listed.product_name,"Household Shield Plan");
      assert.ok(before.reminders.some((r:{title:string})=>/whose/i.test(r.title)),"It is on the to-do list, not only in a list of documents");
      assert.equal(before.unclaimed.some((doc:{id:string})=>doc.id===fixture.referenceId),false,"A document that already has an owner is not asked about again");
      // The person says whose it is. That is the whole interaction.
      const linked=await linkPerson(new NextRequest("http://localhost/api/policies/link-person",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({policyId:orphan,familyMemberId:people[1].id,declared:true})}));
      assert.equal(linked.status,200);
      const after=await (await getDashboard(new NextRequest("http://localhost/api/dashboard"))).json();
      assert.equal(after.unclaimed.some((doc:{id:string})=>doc.id===orphan),false);
      assert.equal(after.reminders.some((r:{title:string})=>/whose/i.test(r.title)),false,"Answered questions leave the to-do list");
      assert.equal((await db.query("SELECT source FROM policy_members WHERE policy_id=$1",[orphan])).rows.length,1);
      await db.query("DELETE FROM policies WHERE id=$1",[orphan]);
    });
    await test("Another account's unclaimed documents are never asked about here",async()=>{
      await seedReviewFixture(1);
      const foreignOrphan=uuid(701500);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,document_authority,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'Other Insurer','Other Booklet','OTHER-2','Personal Accident','policy_wording',60,'ready','other-booklet.pdf','other-booklet.pdf','scan_clean')",
        [foreignOrphan,foreign,foreignPerson]);
      const data=await (await getDashboard(new NextRequest("http://localhost/api/dashboard"))).json();
      assert.equal(data.unclaimed.some((doc:{id:string})=>doc.id===foreignOrphan),false);
      await db.query("DELETE FROM policies WHERE id=$1",[foreignOrphan]);
    });
    await test("Removing a person from a document unlinks them, stops their answers using it, and touches only this household",async()=>{
      // UX acceptance on ca6af69 (critical): pressing a ticked person on a
      // reference certificate said "Saved" but the link stayed, because the
      // save only ever removed links the household had added by hand.
      const cert=uuid(701600),foreignCert=uuid(701601);
      const [daniel,grace,scheme]=[people[0].id,people[1].id,people[2].id];
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,file_hash) VALUES($1,$2,$3,'Example Insurer','Unlink Scheme Benefit Summary','UNLINK-1','Group Insurance','certificate',false,60,'ready','unlink.pdf','unlink.pdf','scan_clean','sha256:unlink')",[cert,account,daniel]);
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'Hospital and surgical benefit. Daily room and board SGD 300.')",[account,cert]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$4,'ai_name_match',0.95),($1,$3,$4,'ai_name_match',0.95),($1,$5,$4,'scheme_reference_match',0.9)",[cert,daniel,grace,account,scheme]);
      await db.query("INSERT INTO policy_detected_people(account_id,policy_id,detected_name,matched_family_member_id,confidence) VALUES($1,$2,$3,$4,0.95)",[account,cert,people[1].display_name,grace]);
      await db.query("INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency) VALUES($1,$2,$3,'Hospitalisation',300,'SGD'),($1,$2,$4,'Hospitalisation',300,'SGD')",[account,cert,daniel,grace]);
      await db.query("INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,event_type,pays_kind,amount,currency,origin) VALUES($1,$2,$3,'Unlink Scheme','hospital_stay','per_day',300,'SGD','wording'),($1,$2,$3,'Unlink Scheme','hospital_stay','per_day',100,'SGD','person')",[account,grace,cert]);
      // Another household's copy of the same scheme, linked to its own person.
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'Example Insurer','Unlink Scheme Benefit Summary','UNLINK-1','Group Insurance','certificate',false,60,'ready','other.pdf','other.pdf','scan_clean')",[foreignCert,foreign,foreignPerson]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'ai_name_match')",[foreignCert,foreignPerson,foreign]);
      const save=(policyId:string,ids:string[])=>linkPerson(new NextRequest("http://localhost/api/policies/link-person",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({policyId,assignments:ids.map(familyMemberId=>({familyMemberId,planTier:null}))})}));
      const links=async(policyId:string)=>(await db.query<{family_member_id:string}>("SELECT family_member_id::text FROM policy_members WHERE policy_id=$1 ORDER BY family_member_id",[policyId])).rows.map(r=>r.family_member_id);
      const searched=async(member:string)=>(await searchPassages({accountId:account,query:"hospital room and board",subjectId:member})).searchedPolicyIds.includes(cert);
      assert.equal(await searched(grace),true,"Before: Grace's questions read the certificate");

      // The household removes Grace (the picker sends everyone still ticked).
      const removed=await save(cert,[daniel]);
      assert.equal(removed.status,200);
      const body=await removed.json();
      assert.deepEqual(await links(cert),[daniel,scheme].sort(),"Grace's link is gone; the matching-wording link the picker never showed is kept");
      assert.equal(await searched(grace),false,"Grace's answers stop using the certificate");
      assert.deepEqual(body.removed,[grace]);
      assert.deepEqual(body.linked,[daniel],"The response says who the document now covers");
      assert.equal(await searched(daniel),true,"Daniel's still do");
      assert.equal((await db.query("SELECT 1 FROM policy_coverages WHERE policy_id=$1 AND family_member_id=$2",[cert,grace])).rows.length,0,"Her cover read from it is gone");
      assert.equal((await db.query("SELECT 1 FROM policy_coverages WHERE policy_id=$1 AND family_member_id=$2",[cert,daniel])).rows.length,1);
      assert.deepEqual((await db.query<{origin:string}>("SELECT origin FROM coverage_rules WHERE policy_id=$1 AND family_member_id=$2",[cert,grace])).rows.map(r=>r.origin),["person"],"Ledger rows read from the document go; the household's own entry stays");
      assert.equal((await db.query<{matched_family_member_id:string|null}>("SELECT matched_family_member_id FROM policy_detected_people WHERE policy_id=$1",[cert])).rows[0].matched_family_member_id,null);
      // Reloading the library shows the same thing the confirmation said.
      const listed=(await (await listPolicies(new NextRequest("http://localhost/api/policies"))).json()).policies.find((x:{id:string})=>x.id===cert);
      assert.deepEqual(listed.linked_people.filter((x:{source:string})=>x.source!=="scheme_reference_match").map((x:{id:string})=>x.id),[daniel]);

      // Removing the upload profile's person moves the profile to someone still covered,
      // because the chat treats the upload profile as covered by the document.
      assert.equal((await save(cert,[grace])).status,200);
      assert.deepEqual(await links(cert),[grace,scheme].sort());
      assert.equal((await db.query<{family_member_id:string}>("SELECT family_member_id::text FROM policies WHERE id=$1",[cert])).rows[0].family_member_id,grace);
      assert.equal(await searched(daniel),false,"Daniel's answers stop using it, upload profile included");

      // Covering nobody is refused with a reason, and changes nothing.
      const empty=await save(cert,[]);
      assert.equal(empty.status,409);
      assert.match((await empty.json()).error,/at least one person/);
      assert.deepEqual(await links(cert),[grace,scheme].sort());

      // Another household's document or person is refused and left untouched.
      assert.equal((await save(foreignCert,[daniel])).status,404);
      assert.equal((await save(cert,[foreignPerson])).status,404);
      assert.deepEqual(await links(foreignCert),[foreignPerson]);
      assert.deepEqual(await links(cert),[grace,scheme].sort());
      await db.query("DELETE FROM policies WHERE id=ANY($1::uuid[])",[[cert,foreignCert]]);
    });
    await test("A reopened chat marks answers about a person since removed from the document, and answers a later correction replaced",async()=>{
      // Critic R16-2: removing someone from a document left their saved answers about it looking current. UX finding 4:
      // after "it was his hip", the earlier tibia answer stayed above, unmarked, with its withdrawn figures.
      const cert=uuid(701900);
      const [daniel,grace]=[people[0].id,people[1].id];
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'Example Insurer','Marked Answers Plan','MARK-1','Group Insurance','certificate',true,80,'ready','mark.pdf','mark.pdf','scan_clean')",[cert,account,daniel]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$4,'ai_name_match',0.95),($1,$3,$4,'ai_name_match',0.95)",[cert,daniel,grace,account]);
      const binding=(subjectId:string)=>({policyId:cert,subjectId,benefit:"Hospital cash",documentHash:null,pageStart:1,pageEnd:1,passage:"Hospital cash per day",sentence:"Hospital cash is paid per day.",value:0,currency:"SGD"});
      const calc=(id:string,subjectId:string)=>({id,sentence:"",calculator:"lump_sum",kind:"conditional_illustration",subjectId,policyId:cert,benefit:"Fracture",documentHash:null,operands:[],steps:[],result:{value:0,currency:"SGD"},currency:"SGD",rounding:{mode:"half_up",precision:2,source:"default"},conditions:[],evidenceRequirements:[]});
      const answer=(summary:string,extra:Record<string,unknown>)=>({mode:"answer",summary,details:[],claimItems:[],nextSteps:[],missingFacts:[],questions:[],
        citations:[{chunkId:"c1",policyId:cert,policyName:"Marked Answers Plan",insurer:"Example Insurer",pageStart:1,pageEnd:1,quote:"Hospital cash per day"}],...extra});
      const c=await openConversation({accountId:account,memberId:null,title:"Marked answers"});
      const say=async(text:string,a:unknown)=>db.query("INSERT INTO chat_messages(account_id,conversation_id,role,content,answer_json) VALUES($1,$2,'user',$3,NULL),($1,$2,'assistant',$4,$5::jsonb)",[account,c.id,text,(a as {summary:string}).summary,JSON.stringify(a)]);
      await say("What does Grace's plan pay in hospital?",answer("Grace's plan pays hospital cash per day.",{figureBindings:[binding(grace)],resolvedFamilyMemberId:grace}));
      await say("And Daniel's?",answer("Daniel's plan pays hospital cash per day.",{figureBindings:[binding(daniel)],resolvedFamilyMemberId:daniel}));
      await say("He broke his tibia",answer("The fracture benefit for a tibia applies.",{calculations:[calc("calc-tibia",daniel)],resolvedFamilyMemberId:daniel}));
      await say("Sorry, it was his hip",answer("Updated: the injury is now hip. The fracture benefit for a hip applies.",{calculations:[calc("calc-hip",daniel)],resolvedFamilyMemberId:daniel}));
      // What the loop saved after the correction: the tibia calculation withdrawn, the hip one current.
      await db.query("UPDATE chat_conversations SET state=state||$2::jsonb WHERE id=$1",[c.id,JSON.stringify({ragLoop:{v:1,turn:4,claim:{subjectId:daniel,facts:{},derived:[],calcs:{
        "calc-tibia":{calcId:"calc-tibia",kind:"conditional_illustration",policyId:cert,benefit:"Fracture",factKeys:["injury"],evidenceIds:[],turn:3,withdrawn:{cause:"fact",key:"injury",reason:"injury was corrected",turn:4}},
        "calc-hip":{calcId:"calc-hip",kind:"conditional_illustration",policyId:cert,benefit:"Fracture",factKeys:["injury"],evidenceIds:[],turn:4,withdrawn:null}}}}})]);
      const reopened=async()=>(await (await getSavedChat(new NextRequest("http://localhost/api/chat/history/"+c.id),{params:Promise.resolve({id:c.id})})).json()).messages
        .filter((m:{role:string})=>m.role==="assistant") as {content:string;answer_json:ChatAnswer}[];
      const reopen=async()=>(await reopened()).map(m=>m.answer_json);
      const save=(ids:string[])=>linkPerson(new NextRequest("http://localhost/api/policies/link-person",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({policyId:cert,assignments:ids.map(familyMemberId=>({familyMemberId,planTier:null}))})}));

      assert.equal((await save([daniel])).status,200,"The household removes Grace from the document");
      const [graces,daniels,tibia,hip]=await reopen();
      assert.equal(graces.invalidated?.reason,"person_unlinked","Grace's answer about the document is marked out of date");
      assert.match(graces.summary,/removed from the document/);
      assert.deepEqual([graces.citations.length,graces.figureBindings?.length??0],[0,0],"and shows nothing it read from it");
      assert.equal(daniels.invalidated,undefined,"Daniel's answer about the same document stays");
      assert.equal(tibia.invalidated?.reason,"superseded","The tibia answer the correction replaced is marked");
      assert.match(tibia.summary,/replaced by the corrected answer below/);
      assert.equal(tibia.calculations?.length??0,0,"and its withdrawn figure is not shown");
      assert.equal(hip.invalidated,undefined,"The corrected answer stays");
      // F69-1: the page shows the message's own text, so an out-of-date answer's text is its notice, not the old sentence.
      const texts=(await reopened()).map(m=>m.content);
      assert.equal(texts[0],graces.summary);
      assert.doesNotMatch(texts[0],/hospital cash per day/);
      assert.equal(texts[2],tibia.summary);
      assert.doesNotMatch(texts[2],/tibia/);
      assert.equal(texts[1],"Daniel's plan pays hospital cash per day.","A current answer keeps its own text");

      // Ticking Grace again makes her answer current again.
      assert.equal((await save([daniel,grace])).status,200);
      assert.equal((await reopen())[0].invalidated,undefined);
      await db.query("DELETE FROM chat_conversations WHERE id=$1",[c.id]);
      await db.query("DELETE FROM policies WHERE id=$1",[cert]);
    });
    await test("\"Not in my family\" hides a name read from a document, survives a re-read, and never hides another household's names",async()=>{
      const doc=uuid(701700),foreignDoc=uuid(701701),[daniel,grace]=[people[0].id,people[1].id];
      const add=(id:string,acct:string,owner:string)=>db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,needs_review,review_reason) VALUES($1,$2,$3,'Example Insurer','Dismiss Plan','DIS-1','Hospital','personal_schedule',true,60,'ready',$4,$4,'scan_clean',true,'1 named insured person is not linked')",[id,acct,owner,id+".pdf"]);
      await add(doc,account,daniel);await add(foreignDoc,foreign,foreignPerson);
      const names=async(acct:string,policyId:string,rows:[string,string|null][])=>{
        await db.query("DELETE FROM policy_detected_people WHERE policy_id=$1",[policyId]);
        for(const [name,matched] of rows)await db.query("INSERT INTO policy_detected_people(account_id,policy_id,detected_name,matched_family_member_id,confidence) VALUES($1,$2,$3,$4,0.9)",[acct,policyId,name,matched]);
      };
      await names(account,doc,[["Stranger  Lim",null],[people[1].display_name,grace],["Another Name",null]]);
      await names(foreign,foreignDoc,[["Stranger Lim",null]]);
      const post=(body:object)=>linkPerson(new NextRequest("http://localhost/api/policies/link-person",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
      const shown=async()=>((await (await listPolicies(new NextRequest("http://localhost/api/policies"))).json()).policies.find((x:{id:string})=>x.id===doc).detected_people as {name:string}[]).map(x=>x.name).sort();
      assert.deepEqual(await shown(),["Another Name",people[1].display_name,"Stranger  Lim"].sort(),"Before: every name read is listed");

      // The household says "Stranger Lim" is not in the family (any spacing or case).
      const dismissed=await post({policyId:doc,detectedName:" stranger lim ",notFamily:true});
      assert.equal(dismissed.status,200);
      assert.deepEqual(await dismissed.json(),{ok:true,notFamily:true,remembered:true});
      assert.deepEqual(await shown(),["Another Name",people[1].display_name].sort(),"The dismissed name is no longer listed");
      assert.equal((await post({policyId:doc,detectedName:"Stranger Lim",notFamily:true})).status,200,"Saying it twice is fine");
      // Dismissing the last unlinked name clears the document's review flag.
      assert.equal((await post({policyId:doc,detectedName:"Another Name",notFamily:true})).status,200);
      assert.deepEqual((await db.query<{needs_review:boolean;review_reason:string|null}>("SELECT needs_review,review_reason FROM policies WHERE id=$1",[doc])).rows[0],{needs_review:false,review_reason:null});

      // Critic R30-2: a reason the reading wrote ("check this is the right person") is kept when the names are recounted.
      const check="The name on this document does not match a family profile, so it was linked to the profile it was uploaded to: X. Check this is the right person";
      await db.query("UPDATE policies SET needs_review=true,review_reason=$2 WHERE id=$1",[doc,"2 named insured people are not linked to a family profile; "+check]);
      assert.equal((await post({policyId:doc,detectedName:"Another Name",notFamily:true})).status,200);
      assert.deepEqual((await db.query<{needs_review:boolean;review_reason:string|null}>("SELECT needs_review,review_reason FROM policies WHERE id=$1",[doc])).rows[0],{needs_review:true,review_reason:check},
        "Only the unlinked-names part is recounted; the reading's own reason stays");
      assert.deepEqual(recountedReview("1 named insured person is not linked; 3 extracted coverage items could not be source-verified; "+check,0,1),
        {needsReview:true,reason:"1 coverage item could not be source-verified; "+check});
      assert.deepEqual(recountedReview("1 named insured person is not linked",0,0),{needsReview:false,reason:null});
      // Critic R30-3: the answer is saved even when recounting the flag afterwards fails; the request does not say it failed.
      await db.query("UPDATE policies SET needs_review=false,review_reason=NULL WHERE id=$1",[doc]);
      await db.query("ALTER TABLE policy_coverages RENAME TO policy_coverages_away");
      try{
        const saved=await post({policyId:doc,detectedName:"Another Name",notFamily:false});
        assert.equal(saved.status,200,"A failed recount after the save is not a failed request");
      }finally{await db.query("ALTER TABLE policy_coverages_away RENAME TO policy_coverages");}
      assert.equal((await db.query("SELECT 1 FROM policy_name_dismissals WHERE policy_id=$1 AND name_key='another name'",[doc])).rows.length,0,"The undo was saved");
      assert.equal((await post({policyId:doc,detectedName:"Another Name",notFamily:true})).status,200);
      // The SQL and JS name keys agree.
      assert.equal((await db.query<{k:string}>(`SELECT ${nameKeySql("$1")} AS k`,["  Jane\t  TAN "])).rows[0].k,nameKey("  Jane\t  TAN "));

      // Reading the document again rebuilds the names; the answer is kept.
      await names(account,doc,[["Stranger Lim",null],[people[1].display_name,grace],["Another Name",null]]);
      assert.deepEqual(await shown(),[people[1].display_name],"A re-read does not bring a dismissed name back");

      // Refused: a name that isn't on the document, a name linked to someone, another household's document, and a mixed request.
      assert.equal((await post({policyId:doc,detectedName:"Nobody Here",notFamily:true})).status,404);
      assert.equal((await post({policyId:doc,detectedName:people[1].display_name,notFamily:true})).status,409);
      assert.equal((await post({policyId:foreignDoc,detectedName:"Stranger Lim",notFamily:true})).status,404);
      assert.equal((await post({policyId:doc,detectedName:"Stranger Lim",notFamily:true,familyMemberId:daniel})).status,400);
      assert.equal((await post({policyId:doc,detectedName:"Stranger Lim"})).status,400,"Without notFamily a person is still required");
      assert.equal((await db.query("SELECT 1 FROM policy_name_dismissals WHERE policy_id=$1 OR account_id=$2",[foreignDoc,foreign])).rows.length,0,"Nothing was written for the other household");

      // The browser session cannot write a dismissal for another household's document, nor file one under another household.
      await assert.rejects(createUserSupabaseClient(account,(c)=>c.query("INSERT INTO policy_name_dismissals(policy_id,account_id,name_key,detected_name) VALUES($1,$2,'stranger lim','Stranger Lim')",[foreignDoc,foreign])));
      await assert.rejects(createUserSupabaseClient(account,(c)=>c.query("INSERT INTO policy_name_dismissals(policy_id,account_id,name_key,detected_name) VALUES($1,$2,'stranger lim','Stranger Lim')",[foreignDoc,account])));
      // Even a dismissal row filed under another household (written past RLS) hides nothing here, and this household's answers hide nothing there.
      await db.query("INSERT INTO policy_name_dismissals(policy_id,account_id,name_key,detected_name) VALUES($1,$2,'other key','x')",[doc,foreign]);
      await names(account,doc,[["Stranger Lim",null],[people[1].display_name,grace],["Another Name",null],["Other Key",null]]);
      assert.ok((await shown()).includes("Other Key"),"Another household's row never hides this household's name");
      const foreignNames=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM policy_detected_people pd WHERE pd.policy_id=$1 AND ${await notDismissedCondition("pd")}`,[foreignDoc]);
      assert.equal(foreignNames.rows[0].n,1,"The other household's Stranger Lim is still listed for them");

      // Undo takes the answer back without linking anyone, and only in this household.
      await db.query("INSERT INTO policy_name_dismissals(policy_id,account_id,name_key,detected_name) VALUES($1,$2,'stranger lim','Stranger Lim')",[foreignDoc,foreign]);
      assert.equal((await post({policyId:foreignDoc,detectedName:"Stranger Lim",notFamily:false})).status,404,"Another household's document is refused");
      assert.equal((await db.query("SELECT 1 FROM policy_name_dismissals WHERE policy_id=$1",[foreignDoc])).rows.length,1,"Their answer is untouched");
      const undone=await post({policyId:doc,detectedName:"Another  NAME",notFamily:false});
      assert.equal(undone.status,200);
      assert.deepEqual(await undone.json(),{ok:true,notFamily:false,remembered:true});
      assert.ok((await shown()).includes("Another Name"),"The name is listed again");
      assert.equal((await db.query("SELECT 1 FROM policy_detected_people WHERE policy_id=$1 AND detected_name='Another Name' AND matched_family_member_id IS NULL",[doc])).rows.length,1,"Undo links nobody");
      assert.equal((await db.query<{needs_review:boolean}>("SELECT needs_review FROM policies WHERE id=$1",[doc])).rows[0].needs_review,true,"It is waiting to be linked again");
      assert.equal((await post({policyId:doc,detectedName:"Another Name",notFamily:false})).status,200,"Undoing twice is fine");
      assert.equal((await post({policyId:doc,detectedName:"Another Name",notFamily:false,familyMemberId:daniel})).status,400);

      // Linking the name to someone takes the dismissal back.
      assert.equal((await post({policyId:doc,detectedName:"Stranger Lim",familyMemberId:daniel,declared:true})).status,200);
      assert.ok((await shown()).includes("Stranger Lim"),"The name is listed again once the household links it");
      await db.query("DELETE FROM policies WHERE id=ANY($1::uuid[])",[[doc,foreignDoc]]);
    });
    await test("A removal survives the document being read again, and ticking the person again restores their cover",async()=>{
      const [daniel,grace]=[people[0].id,people[1].id];
      const [schedule,summary,graceSchedule]=[uuid(701800),uuid(701801),uuid(701802)];
      const extraction={insuredPeople:[{name:people[0].display_name,relationshipHint:"employee",coverages:[]},
        {name:people[1].display_name,relationshipHint:"spouse",coverages:[{category:"Hospitalisation",amount:200,currency:"SGD",productName:"Remember Plan",notes:null,sourcePage:1,evidenceText:"Daily hospital cash SGD 200",evidenceVerified:true}]}],
        paymentRecords:[],personalCoverageConfirmed:true} as unknown as PolicyExtraction;
      const insert=(id:string,owner:string,personal:boolean,role:string)=>db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,extracted_json,ledger_read_at) VALUES($1,$2,$3,'Example Insurer','Remember Plan','REM-1','GREM-1','Hospital',$5,$4,60,'ready',$7,$7,'scan_clean',$6::jsonb,now())",[id,account,owner,personal,role,JSON.stringify(extraction),id+".pdf"]);
      await insert(schedule,daniel,true,"personal_schedule");
      await insert(summary,daniel,false,"product_summary");
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$4,'ai_name_match',0.95),($1,$3,$4,'ai_name_match',0.95),($5,$2,$4,'ai_name_match',0.95),($5,$3,$4,'ai_name_match',0.95)",[schedule,daniel,grace,account,summary]);
      await syncInsuredPersonToMember({accountId:account,sourcePolicyId:schedule,familyMemberId:grace,detectedName:people[1].display_name,extraction});
      assert.equal((await db.query("SELECT 1 FROM policy_coverages WHERE policy_id=$1 AND family_member_id=$2",[schedule,grace])).rows.length,1);
      const save=(policyId:string,ids:string[])=>linkPerson(new NextRequest("http://localhost/api/policies/link-person",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({policyId,assignments:ids.map(familyMemberId=>({familyMemberId,planTier:null}))})}));
      const linked=async(policyId:string)=>(await db.query<{family_member_id:string;source:string}>("SELECT family_member_id::text,source FROM policy_members WHERE policy_id=$1",[policyId])).rows;
      const has=async(policyId:string,member:string)=>(await linked(policyId)).some(r=>r.family_member_id===member);

      assert.equal((await save(schedule,[daniel])).status,200);
      assert.equal((await save(summary,[daniel])).status,200);
      assert.equal((await db.query("SELECT 1 FROM policy_member_exclusions WHERE policy_id=ANY($1::uuid[]) AND family_member_id=$2",[[schedule,summary],grace])).rows.length,2,"The removal is remembered");

      // The document is read again (or a read in flight finishes after "Saved"): her printed name does not link her back.
      await syncInsuredPersonToMember({accountId:account,sourcePolicyId:schedule,familyMemberId:grace,detectedName:people[1].display_name,extraction});
      assert.equal(await has(schedule,grace),false,"A re-read does not undo the household's removal");
      assert.equal((await db.query("SELECT 1 FROM policy_coverages WHERE policy_id=$1 AND family_member_id=$2",[schedule,grace])).rows.length,0);
      // Another of her documents of the same scheme does not match her back onto the summary either.
      await insert(graceSchedule,grace,true,"personal_schedule");
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'ai_name_match')",[graceSchedule,grace,account]);
      await linkRelatedReferenceDocuments(account,graceSchedule,"GREM-1");
      assert.equal(await has(summary,grace),false,"Matching wording does not undo the removal");

      // Ticking her again links her, forgets the removal and restores her cover from the stored reading.
      assert.equal((await save(schedule,[daniel,grace])).status,200);
      assert.equal((await linked(schedule)).find(r=>r.family_member_id===grace)?.source,"user_declared");
      assert.equal((await db.query("SELECT 1 FROM policy_member_exclusions WHERE policy_id=$1 AND family_member_id=$2",[schedule,grace])).rows.length,0);
      assert.equal(Number((await db.query<{amount:string}>("SELECT amount::text FROM policy_coverages WHERE policy_id=$1 AND family_member_id=$2",[schedule,grace])).rows[0]?.amount),200,"Her cover is back without a re-analysis");
      assert.equal((await db.query<{ledger_read_at:string|null}>("SELECT ledger_read_at FROM policies WHERE id=$1",[schedule])).rows[0].ledger_read_at,null,"The ledger reads the document again for her");
      // A household tick survives a later matching-wording pass (it stays shown as covered).
      await linkRelatedReferenceDocuments(account,graceSchedule,"GREM-1");
      assert.equal((await linked(schedule)).find(r=>r.family_member_id===grace)?.source,"user_declared");
      await db.query("DELETE FROM policies WHERE id=ANY($1::uuid[])",[[schedule,summary,graceSchedule]]);
    });
    await test("Coverage and Benefits say which document is still waiting and which failed, and why, in safe words",async()=>{
      // UX acceptance on ca6af69 (item 3): with every document Ready, both pages
      // said "still being read" forever; a failed read looked like a waiting one.
      const {ensureEvidenceSchema}=await import("@/lib/documents/evidence");
      const {noteReadFailure,BENEFIT_READ_FAILURE_KEY}=await import("@/lib/policies/read-failures");
      await ensureEvidenceSchema();
      await db.query("DELETE FROM policies WHERE account_id=$1",[account]);
      const [waiting,failed,resting]=[uuid(701700),uuid(701701),uuid(701702)];
      for(const [id,name] of [[waiting,"Waiting Plan"],[failed,"Failed Plan"],[resting,"Resting Plan"]]){
        await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_type,document_role,document_authority,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'Example Insurer',$4,'Hospital','policy_wording',60,'ready',$5,$5,'scan_clean')",[id,account,people[0].id,name,id+".pdf"]);
        await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'Daily hospital cash SGD 100.')",[account,id]);
        await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')",[id,people[0].id,account]);
      }
      const raw=new Error("Request timed out after 180000ms at platform.example (org-SECRET123)");
      await noteReadFailure(account,failed,BENEFIT_READ_FAILURE_KEY,raw);
      await noteReadFailure(account,failed,BENEFIT_READ_FAILURE_KEY,raw);
      // Ledger notes as lib/ledger/extract.ts writes them: one due again, one resting.
      const note=(minutes:number)=>JSON.stringify({ledger_read_failure:{attempts:1,reasonCode:"reader_unavailable",lastFailedAt:new Date().toISOString(),retryAfter:new Date(Date.now()+minutes*60_000).toISOString()}});
      await db.query("UPDATE policies SET reading_cache=coalesce(reading_cache,'{}'::jsonb)||$2::jsonb WHERE id=$1",[failed,note(-1)]);
      await db.query("UPDATE policies SET reading_cache=coalesce(reading_cache,'{}'::jsonb)||$2::jsonb WHERE id=$1",[resting,note(60)]);

      const index=await (await getIndexStatus(new NextRequest("http://localhost/api/benefits/index"))).json();
      const byId=(list:{policyId:string}[])=>new Map(list.map(d=>[d.policyId,d as Record<string,unknown>]));
      const benefits=byId(index.documents);
      assert.equal(index.unread.length,3,"unread is unchanged for existing callers");
      assert.equal(benefits.get(waiting)?.state,"waiting");
      assert.equal(benefits.get(failed)?.state,"failed");
      assert.equal(benefits.get(failed)?.reasonCode,"timeout");
      assert.equal(benefits.get(failed)?.attempts,2);
      assert.equal(benefits.get(failed)?.name,"Failed Plan","It names the document");
      assert.doesNotMatch(JSON.stringify(index),/org-SECRET|platform\.example|180000/,"The raw error never reaches the household");

      const ledger=await (await getLedger(new NextRequest("http://localhost/api/ledger"))).json();
      const reading=byId(ledger.reading.documents);
      assert.equal(reading.get(waiting)?.state,"waiting");
      assert.equal(reading.get(failed)?.state,"failed","A failed read that is due again says failed, not still reading");
      assert.equal(reading.get(resting)?.state,"backed_off");
      assert.ok(reading.get(resting)?.retryAfter,"and says when it is tried again");
      assert.match(String(reading.get(failed)?.reason),/unavailable/);

      // Reading the document successfully clears its failure.
      const read=await indexBenefits(new NextRequest("http://localhost/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({policyId:failed})}));
      assert.equal(read.status,200);
      const after=byId((await (await getIndexStatus(new NextRequest("http://localhost/api/benefits/index"))).json()).documents);
      assert.equal(after.has(failed),false);
      assert.equal((await db.query<{n:unknown}>("SELECT reading_cache->'benefit_read_failure' AS n FROM policies WHERE id=$1",[failed])).rows[0].n,null);
      await db.query("DELETE FROM policies WHERE id=ANY($1::uuid[])",[[waiting,failed,resting]]);
    });
    await test("Reading a document by hand still works, for a deliberate re-read after the model changes",async()=>{
      const fixture=await seedReviewFixture(1);
      // What an install upgraded from an older version actually looks like.
      await db.query("UPDATE policies SET benefits_indexed_at=NULL WHERE account_id=$1",[account]);
      const listed=await (await getIndexStatus(new NextRequest("http://localhost/api/benefits/index"))).json();
      assert.ok(listed.unread.length>=1,"A ready document with stored pages that has never been read is offered for reading");
      assert.ok(listed.unread.every((doc:{pages:number})=>doc.pages>0),"Only documents whose pages are already stored: reading them needs no PDF and no OCR");
      const first=await (await indexBenefits(new NextRequest("http://localhost/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}))).json();
      assert.ok(first.stored>=0);
      assert.equal(typeof first.name,"string");
      // Reading is one document per request so the screen can show progress.
      let guard=0,remaining=first.remaining;
      while(remaining>0&&guard++<10)
        remaining=(await (await indexBenefits(new NextRequest("http://localhost/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}))).json()).remaining;
      assert.equal(remaining,0,"Every document is read in the end");
      assert.equal((await (await getIndexStatus(new NextRequest("http://localhost/api/benefits/index"))).json()).unread.length,0,"Nothing is left asking to be read");
      const catalog=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      assert.ok(catalog.summary.total>0,"Reading them is what puts amounts on the Benefits page");
      assert.ok(catalog.benefits.some((b:{policyId:string})=>b.policyId===fixture.referenceId));
      // A document that stated no rules has still been read, and must not keep asking.
      assert.equal((await db.query("SELECT id FROM policies WHERE account_id=$1 AND benefits_indexed_at IS NULL AND processing_status='ready'",[account])).rows.length,0);
      // And it never touched the document, its pages or the confirmed cover.
      assert.equal((await db.query("SELECT id FROM policy_pages WHERE account_id=$1",[account])).rows.length>0,true);
      assert.equal((await db.query("SELECT id FROM policy_coverages WHERE account_id=$1 AND confirmed=true",[account])).rows.length,1);
    });
    await test("Reading a document a person has already corrected keeps their correction",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review,reviewed_at) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness']::text[],'sum_insured',0.5,'SGD',1,'We pay 100% of Sum Insured for qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false,now())",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      await db.query("UPDATE policies SET benefits_indexed_at=NULL WHERE account_id=$1 AND id=$2",[account,fixture.referenceId]);
      const response=await indexBenefits(new NextRequest("http://localhost/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({policyId:fixture.referenceId})}));
      assert.equal(response.status,200);
      const kept=await db.query<{formula_value:string}>("SELECT formula_value::text FROM policy_benefits WHERE account_id=$1 AND policy_id=$2 AND benefit_name='Major Critical Illness'",[account,fixture.referenceId]);
      assert.equal(kept.rows.length,1,"Re-reading must not produce a second copy of a benefit the person has fixed");
      assert.equal(Number(kept.rows[0].formula_value),0.5,"Their answer outranks the parser, every time it is read again");
    });
    await test("The schedule only asks the person for what only the person can answer",async()=>{
      const fixture=await seedReviewFixture(1);
      const insert=(name:string,extra:string,values:string)=>db.query(
        "INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review"+extra+") VALUES($1,$2,$3,$4,ARRAY['other']::text[],"+values+")",
        [account,fixture.referenceId,"Review Fixture Critical Illness",name]);
      // 1. Stated outright by the document: nothing to ask.
      await insert("Accidental Hospital Recuperation","","'fixed',250,'SGD',4,'We pay S$250.','[]'::jsonb,'[]'::jsonb,false");
      // 2. Read from the table heading: DearPolicy will not use it until told.
      await insert("Loss of speech",",basis_inferred","'sum_insured',0.5,'SGD',6,'Loss of speech 50%','[]'::jsonb,'[]'::jsonb,true,true");
      // 3. A daily rate whose row never said for how many days.
      await insert("Daily Hospital Cash",",fact_key,offset_days,maximum_days","'daily',30,'SGD',9,'S$30 per day.','[]'::jsonb,'[]'::jsonb,true,'hospitalNights',0,NULL");
      // 4. No amount could be read at all: an admission, not a task.
      await insert("Dental","","'none',NULL,NULL,12,'Dental treatment as charged.','[]'::jsonb,'[]'::jsonb,true");
      const data=await (await getBenefits(new NextRequest("http://localhost/api/benefits"))).json();
      const by=(name:string)=>data.benefits.find((b:{benefitName:string})=>b.benefitName===name);
      assert.equal(by("Accidental Hospital Recuperation").attention,null);
      assert.equal(by("Loss of speech").attention,"confirm");
      assert.equal(by("Daily Hospital Cash").attention,"confirm");
      assert.equal(by("Dental").attention,"unreadable",
        "A row DearPolicy could not read an amount from is not work the person can do");
      assert.equal(data.summary.needsYou,2,"Only the two rules that cannot be used without an answer are counted as the person's");
      assert.equal(data.summary.unreadable,1);
      assert.equal(data.summary.usable,1);
      assert.equal(data.summary.needsYou+data.summary.unreadable+data.summary.usable,data.summary.total,
        "Every row is in exactly one of the three states the screen shows");
    });
    await test("With nothing read yet, the chat reads what it needs and answers — nothing to press",async()=>{
      await seedReviewFixture(12);
      // What an install upgraded from an older version actually looks like,
      // and what every household looked like the day conditions arrived.
      await db.query("UPDATE policies SET benefits_indexed_at=NULL WHERE account_id=$1",[account]);
      await db.query("UPDATE policies SET conditions_indexed_at=NULL WHERE account_id=$1",[account]).catch(()=>{});
      const unreadBefore=(await db.query("SELECT id FROM policies WHERE account_id=$1 AND benefits_indexed_at IS NULL",[account])).rows.length;
      assert.ok(unreadBefore>0);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      // The person uploaded documents and asked a question. Everything between
      // those two things is this system's job: it reads what it needs, then
      // answers. It does not hand the work back.
      const unreadAfter=(await db.query("SELECT id FROM policies WHERE account_id=$1 AND benefits_indexed_at IS NULL",[account])).rows.length;
      assert.ok(unreadAfter<unreadBefore,"Asking the question should have read the documents it needed");
      assert.doesNotMatch(answer.summary,/have not read your policy documents yet/,
        "Telling someone their documents are unread is a confession, not an answer");
      const everything=[answer.summary,...answer.details,...answer.nextSteps].join(" ");
      for(const leak of ["RAG_","policies:index","npm run","benefits_indexed_at","Read them now"])
        assert.equal(everything.includes(leak),false,"A person holding a policy document should never be shown: "+leak);
      // Once its rules are on file, the same question is answered from them.
      const fixture=await db.query<{id:string}>("SELECT id FROM policies WHERE account_id=$1 AND document_role='policy_wording'",[account]);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.rows[0].id,"Review Fixture Critical Illness"]);
      const started=Date.now();
      const after=(await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id)).data.answer as ChatAnswer;
      assert.doesNotMatch(after.summary,/S\$350,000/);
      assert.ok(Date.now()-started<4000,"Nothing is re-read, so a second question is immediate");
    });
    await test("A what-if question is answered from the stored benefits, with figures and a question back",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,fact_key,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Ambulance Cost',ARRAY['accident','medical_expense']::text[],'expense_cap',500,'SGD','ambulanceBill',13,'Ambulance Cost Up to S$500 per incident','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Simple Fracture (wrist)',ARRAY['accident','bodily_injury']::text[],'fixed',1250,'SGD',14,'Arm, Elbow, Wrist or Ribs 25%','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const readsBefore=readingCalls;
      const sessionsBefore=(await db.query("SELECT id FROM claim_sessions WHERE account_id=$1 AND family_member_id=$2",[account,people[0].id])).rows.length;
      const started=Date.now();
      const {data}=await send("how much can i claim if i fell down and have a bill of $500",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(readingCalls-readsBefore,0,"A what-if must use the benefits already read, not re-read every PDF");
      assert.ok(Date.now()-started<4000,"…and come back immediately");
      const titles=answer.claimItems.map(item=>item.title).join(" | ");
      assert.match(titles,/Simple Fracture/,"A fall is an accident, and the accident plan is what should answer: "+titles);
      assert.match(titles,/Ambulance Cost/);
      // The rule itself is the answer when the amount depends on what happens.
      const ambulance=answer.claimItems.find(item=>/Ambulance/.test(item.title))!;
      assert.equal(ambulance.amountText,null,"No pre-review reimbursement figure");
      const fracture=answer.claimItems.find(item=>/Fracture/.test(item.title))!;
      assert.equal(fracture.amountText,null);
      // It asks the one thing that turns a rule into a number.
      assert.equal(answer.questions.length,1,"One question, not an interrogation");
      assert.match(answer.questions[0].text,/hospital|bill|ambulance/i);
      // Nothing is recorded as an actual claim.
      assert.ok(answer.details.some(detail=>/what-if/i.test(detail)&&/nothing here has been recorded as a claim/i.test(detail)));
      const stored=await db.query("SELECT facts FROM claim_sessions WHERE account_id=$1 AND family_member_id=$2",[account,people[0].id]);
      assert.equal(stored.rows.length,sessionsBefore,"A hypothetical must not open a claim on anyone's profile");
    });
    await test("A portfolio question is not turned into a claim assessment",async()=>{
      await seedReviewFixture(1);
      const {data}=await send("what policies do i have?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.notEqual(answer.mode,"claim_assessment");
    });
    await test("Routing reading to another provider sends documents there and leaves chat where it was",async()=>{
      const fixture=await seedReviewFixture(3);
      const { catalogueDocument,documentPages }=await import("@/lib/policies/catalog-builder");
      const { loadBenefitCatalog }=await import("@/lib/policies/benefit-catalog");
      const pages=await documentPages(account,fixture.referenceId);
      const inner=globalThis.fetch;
      let groqCalls=0,throttled=false,authHeader="";
      globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(url.startsWith("https://api.groq.com/")){
          groqCalls++;
          authHeader=String((init?.headers as Record<string,string>)?.authorization??"");
          // The free tier throttles by tokens per minute; the first page hits it.
          if(!throttled){throttled=true;return new Response("rate limited",{status:429,headers:{"retry-after":"0"}});}
          const body=JSON.parse(String(init?.body));
          assert.equal(body.response_format?.type,"json_object");
          assert.match(body.messages[0].content,/JSON Schema/,"The schema travels with the request so the reply can be validated");
          const text=String(JSON.parse(body.messages[1].content).text);
          const benefits=/100% of Sum Insured/.test(text)
            ?[{name:"Major Critical Illness",quote:"We pay 100% of Sum Insured for qualifying critical illness.",formulaKind:"sum_insured",formulaValue:1,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,conditions:[]},
              // A quote that is not on the page must be refused wherever it came from.
              {name:"Invented Benefit",quote:"We pay S$999,999 on request.",formulaKind:"fixed",formulaValue:999999,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,conditions:[]}]
            :[];
          return Response.json({id:"fixture-groq-response",model:"llama-3.3-70b-versatile",choices:[{message:{content:JSON.stringify({benefits})},finish_reason:"stop"}]});
        }
        return inner(input,init);
      }) as typeof fetch;
      // The preset would otherwise claim reading too; this test is about the
      // per-job override, so it is what has to be out of the way.
      const savedPreset=process.env.MODEL_PRESET;delete process.env.MODEL_PRESET;
      process.env.READING_MODEL_PROVIDER="groq";process.env.GROQ_API_KEY="test-key";
      try{
        const stored=await catalogueDocument({accountId:account,policyId:fixture.referenceId,productName:"Review Fixture Critical Illness",pages});
        // V1.1 Task 5 ($5/month budget): only the page with something unread is sent (the administrative pages cost nothing); it was throttled once and retried.
        assert.ok(groqCalls>=2,"The page with a rule went to the hosted reader, and the throttled request was retried");
            assert.equal(authHeader,"Bearer test-key");
        assert.equal(stored,1,"The invented quote was refused; only the real rule was stored");
        const catalog=await loadBenefitCatalog(account,[fixture.referenceId]);
        assert.deepEqual(catalog.map(b=>b.benefitName),["Major Critical Illness"]);
        // Rerouting reading does not move the other jobs with it.
        // (V1.1: a claim answer is no longer narrated by a model, so the chat
        // model's own call here is the interpretation of the message.)
        const readsBefore=interpretationCalls;
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        assert.equal((data.answer as ChatAnswer).claimItems[0]?.amountText,null);
        assert.ok(interpretationCalls-readsBefore>=1,"Chat interpretation stays on the model its own setting names");
      }finally{
        delete process.env.READING_MODEL_PROVIDER;delete process.env.GROQ_API_KEY;
        if(savedPreset)process.env.MODEL_PRESET=savedPreset;useHarnessModel();globalThis.fetch=inner;
      }
    });
    await test("Rows are categorised by meaning after upload, not by keywords alone",async()=>{
      const fixture=await seedReviewFixture(1);
      const { catalogueDocument }=await import("@/lib/policies/catalog-builder");
      const { loadBenefitCatalog }=await import("@/lib/policies/benefit-catalog");
      const table=["Schedule of Indemnities","(% of Sum Insured)","Loss of speech\t50%","Loss of one limb\t100%","Annual premium payable\t$1,200"].join("\n");
      const before=categoriseCalls;
      await catalogueDocument({accountId:account,policyId:fixture.referenceId,productName:"Review Fixture Critical Illness",
        pages:[{page_number:1,text:table}]});
      assert.equal(categoriseCalls-before,1,"One categorisation per page, for all its rows at once");
      const catalog=await loadBenefitCatalog(account,[fixture.referenceId]);
      const names=catalog.map(b=>b.benefitName);
      assert.ok(names.includes("Loss of speech")&&names.includes("Loss of one limb"),names.join(" | "));
      assert.equal(names.some(name=>/premium/i.test(name)),false,"The reader ruled the premium row out even though its value cell parsed");
      const speech=catalog.find(b=>b.benefitName==="Loss of speech")!;
      assert.ok(speech.traits.includes("disability"),"A trait the keywords could never find: "+speech.traits.join(","));
      assert.ok(speech.traits.includes("bodily_injury"));
      assert.equal(speech.traits.includes("other"),false,"'other' is only a placeholder for a row nothing could categorise");
    });
    await test("An illness is never offered accident-only benefits, and facts come before figures",async()=>{
      const fixture=await seedReviewFixture(1);
      const product="Review Fixture Critical Illness";
      const insert=(name:string,traits:string,requires:string,kind:string,value:number,factKey:string|null,offset:number|null,max:number|null,page:number)=>db.query(
        "INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,'SGD',$9,$10,$11,$12,$13,'[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,product,name,traits.split(",").filter(Boolean),requires.split(",").filter(Boolean),kind,value,factKey,offset,max,page,name+" wording"]);
      await insert("Ambulance Cost","accident,medical_expense","accident","expense_cap",500,"ambulanceBill",null,null,13);
      await insert("Accidental Hospital Recuperation Benefit","accident,hospitalisation","accident","fixed",250,null,null,null,13);
      await insert("Daily Hospital Cash Benefit","hospitalisation","","daily",30,"hospitalNights",0,30,5);
      // The same daily benefit stated again in a second document of the same plan.
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Daily Hospital Cash Benefit',ARRAY['hospitalisation']::text[],'{}'::text[],'daily',30,'SGD','hospitalNights',0,30,9,'Daily Hospital Cash S$30 per day','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.policyId,product]);
      const first=(await send("Desmond caught dengue. What can he claim?",people[0].id)).data;
      const one=first.answer as ChatAnswer;
      assert.equal(one.mode,"fact_finding","Facts come first");
      assert.equal(one.claimItems.length,0,"No figure before the facts are in");
      assert.equal(one.questions.length,1);
      assert.match(one.questions[0].text,/hospital admission/i,"The first question is the one that rules benefits in or out: "+one.questions[0].text);
      // Candidates are named as household-friendly categories, never as raw
      // schedule rows, and what was ruled out is internal tracing only.
      const candidates=one.details.find(detail=>detail.startsWith("This may relate to"))??"";
      assert.equal(/ambulance|accident/i.test(candidates),false,"Dengue is an illness; accident-only benefits are not candidates: "+candidates);
      assert.match(candidates,/hospital cash/i);
      const visible=[one.summary,...one.details].join("\n");
      assert.equal(/Not applicable here|Ambulance Cost|Daily Hospital Cash Benefit|benefit rules? read/i.test(visible),false,"No schedule dump, raw rows or rule counts: "+visible);
      const second=(await send("Yes",people[0].id,first.answer.conversationId,first.answer.conversationRevision)).data;
      const two=second.answer as ChatAnswer;
      assert.equal(two.mode,"fact_finding");
      assert.match(two.questions[0]?.text??"",/how many nights/i,"Then the quantity: "+JSON.stringify(two.questions));
      const third=(await send("4",people[0].id,second.answer.conversationId,second.answer.conversationRevision)).data;
      const three=third.answer as ChatAnswer;
      assert.equal(three.mode,"claim_assessment","With the facts in, the figures come");
      assert.equal(three.questions.length,0,"Nothing left to ask");
      const titles=three.claimItems.map(item=>item.title);
      assert.equal(titles.length,1,"One card per benefit per person, even when two documents state it: "+titles.join(" | "));
      assert.match(titles[0],/Daily Hospital Cash/);
      assert.equal(three.claimItems[0].amountText,null,"Stored duration rule does not permit a pre-review payout");
      assert.equal(three.potentialPayoutTotals?.length??0,0);
    });
    await test("When the cause is unknown, it is asked rather than assumed",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Accidental Hospital Recuperation Benefit',ARRAY['accident','hospitalisation']::text[],ARRAY['accident']::text[],'fixed',250,'SGD',13,'Accidental Hospital Recuperation Benefit S$250','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      // The interpreter reports a hospital stay and nothing about its cause.
      const first=(await send("Desmond was discharged after twelve nights",people[0].id)).data;
      const one=first.answer as ChatAnswer;
      assert.equal(one.mode,"fact_finding");
      assert.match(one.questions[0]?.text??"",/accident, or an illness/i,JSON.stringify(one.questions));
      const second=(await send("An accident",people[0].id,first.answer.conversationId,first.answer.conversationRevision)).data;
      const two=second.answer as ChatAnswer;
      assert.equal(two.mode,"claim_assessment");
      assert.equal(two.claimItems[0]?.amountText,null);
    });
    await test("A death benefit that sits in a sentence, not a table, is read into the ledger and answered",async()=>{
      // The only rule on file is an accident-hospital row. A death benefit sits
      // in a sentence of the policy wording that never became a table row.
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Accidental Hospital Recuperation Benefit',ARRAY['accident','hospitalisation']::text[],ARRAY['accident']::text[],'fixed',250,'SGD',13,'Accidental Hospital Recuperation Benefit S$250','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const deathClause="Review Fixture Critical Illness. If the insured dies while covered, we pay 100% of Sum Insured for a qualifying covered death.";
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,2,$3)",[account,fixture.referenceId,deathClause]);
      await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,2,2,$5,$6::vector)",
        [uuid(700499),account,people[0].id,fixture.referenceId,deathClause,"["+Array.from({length:1024},(_,j)=>j===0?1:0).join(",")+"]"]);
      const {data}=await send("Desmond was murdered in Thailand",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.questions.length,0,"A death is not answered with a question about hospital admission: "+JSON.stringify(answer.questions));
      assert.ok(answer.claimItems.some(item=>item.title.includes("Death benefit")&&item.amountText===null),"The death benefit is found in the wording: "+answer.claimItems.map(i=>i.title+" "+i.amountText).join(" | "));
      assert.doesNotMatch(answer.summary,/None of the benefit rules on file respond/,"An empty rule list is not a verdict");
      // (V1.1 Task 4 removed the "Coverage page shows…" pointer from the
      // household's answer; the ledger path is identified by its citations.)
      assert.ok(answer.citations.some(c=>c.chunkId.startsWith("ledger:")),"…because the sentence was read into the ledger (answered from the Coverage Ledger path): "+answer.citations.map(c=>c.chunkId).join(" / "));
    });
    // A certificate's schedule lines (no benefit table read yet) name a plan
    // as potentially responding to a death, but only assume the standard
    // rule for that kind of cover -- so the figure stays withheld, for a
    // what-if and for a reported death alike, until the wording is read.
    await test("A certificate's schedule lines name a death cover on their own, but withhold the figure until the wording is read",async()=>{
      const fixture=await seedReviewFixture(1);
      const cover=async(id:number,category:string,amount:number)=>db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,$5,$6,'SGD','MINDEF Group Insurance',2,$7,true,true)",
        [uuid(id),account,fixture.policyId,people[0].id,category,amount,category+" S$"+amount]);
      await cover(700510,"Group Term Life",1_000_000);
      await cover(700511,"Group Personal Accident",600_000);
      await cover(700512,"Group Living Care",350_000);
      // Labelled an inventory question ("policies"), it is a what-if about a payout.
      const whatIf=(await send("If Desmond dies in an accident, how much would the payout be across his policies?",people[0].id)).data.answer as ChatAnswer;
      assert.equal(whatIf.mode,"claim_assessment","A payout what-if is not answered with the inventory table: "+whatIf.summary);
      assert.equal(whatIf.portfolioItems,undefined);
      const titles=whatIf.claimItems.map(item=>item.title);
      assert.ok(titles.some(t=>/Group Term Life/.test(t)),"The life sum assured is named as potentially responding to a death: "+titles.join(" | "));
      assert.ok(titles.some(t=>/Group Personal Accident/.test(t)),"…and the PA cover to an accidental death: "+titles.join(" | "));
      assert.ok(!titles.some(t=>/Living Care/.test(t)),"A critical illness plan does not respond to a death: "+titles.join(" | "));
      // Neither plan's benefit table has been read yet, so the schedule can
      // only assume the standard rule for this kind of cover -- named, but
      // without a bare figure, until the wording confirms it.
      assert.ok(whatIf.claimItems.every(item=>item.amountText===null&&item.status==="needs_document"),
        "Each figure is withheld until the wording is read: "+JSON.stringify(whatIf.claimItems.map(i=>[i.title,i.amountText,i.status])));
      assert.ok(whatIf.claimItems.every(item=>item.conditions.some(c=>/Assumes the standard rule/.test(c))),"Each card says it assumes the standard rule until the wording is read");
      assert.equal(whatIf.potentialPayoutTotals?.length??0,0,"No total may be shown when every item's amount is withheld");
      // The same schedule answers a reported death whose cause is not yet known.
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Accidental Hospital Recuperation Benefit',ARRAY['accident','hospitalisation']::text[],ARRAY['accident']::text[],'fixed',250,'SGD',13,'Accidental Hospital Recuperation Benefit S$250','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const reported=(await send("Desmond was murdered in Thailand",people[0].id)).data.answer as ChatAnswer;
      assert.equal(reported.mode,"claim_assessment",reported.summary);
      const life=reported.claimItems.find(item=>/Group Term Life/.test(item.title));
      const pa=reported.claimItems.find(item=>/Group Personal Accident/.test(item.title));
      assert.ok(life,"The life cover is still named for a reported death: "+reported.claimItems.map(i=>i.title).join(" | "));
      assert.ok(pa,"…and the PA cover for an accidental death");
      // Neither plan's own wording has been read, so a reported death gets
      // the same treatment as the what-if above: the cover is named, but no
      // figure is shown until the schedule's assumed rule is confirmed by
      // the actual clause.
      assert.equal(life?.amountText,null);assert.equal(life?.status,"needs_document");
      assert.equal(pa?.amountText,null);assert.equal(pa?.status,"needs_document");
      assert.ok(life?.conditions.some(c=>/Assumes the standard rule/.test(c)),"An assumed ledger row says so: "+life?.conditions.join(" / "));
      assert.equal(negativeCoverageClaim(reported.summary),false,"A withheld figure must never read as \"not covered\"");
      assert.ok(reported.claimSessionId,"…and the claim is on record with a pack to print");
    });
    await test("The Coverage Ledger: confirming a row makes the answer exact, rejecting removes it, and a row you add counts",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,'Group Term Life',1000000,'SGD','MINDEF Group Insurance',2,'Group Term Life S$1,000,000',true,true)",
        [uuid(700520),account,fixture.policyId,people[0].id]);
      // The page lists what was read, marked as proposed.
      const listed=await (await getLedger(new NextRequest("http://localhost/api/ledger?familyMemberId="+people[0].id))).json();
      type LRow={id:string;eventType:string;status:string;pays:string;planName:string;origin:string};
      const life=(listed.rows as LRow[]).find(r=>r.eventType==="death"&&/Group Term Life/.test(r.planName));
      assert.ok(life,"The certificate's life cover is a ledger row: "+JSON.stringify(listed.rows.map((r:LRow)=>r.planName+"/"+r.eventType)));
      assert.equal(life!.status,"proposed");assert.match(life!.pays,/S\$1,000,000 lump sum/);
      const tpd=(listed.rows as LRow[]).find(r=>r.eventType==="tpd"&&/Group Term Life/.test(r.planName));
      assert.ok(tpd,"…with the standard companion rows for that kind of plan");
      // Before confirmation the answer is an estimate; after, it is confirmed.
      const before=(await send("Desmond was murdered in Thailand",people[0].id)).data.answer as ChatAnswer;
      const beforeItem=before.claimItems.find(i=>/Group Term Life/.test(i.title));
      // A proposed, unconfirmed row only assumes the standard rule, so the
      // gate withholds the figure -- the same treatment the schedule-only
      // death cover gets above -- until the person confirms it below.
      assert.equal(beforeItem?.amountText,null);assert.equal(beforeItem?.status,"needs_document");
      const confirmed=await patchLedger(new NextRequest("http://localhost/api/ledger",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:life!.id,status:"confirmed"})}));
      assert.equal(confirmed.status,200);
      // The person says the plan has no TPD cover; the row is gone from answers.
      await patchLedger(new NextRequest("http://localhost/api/ledger",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:tpd!.id,status:"rejected"})}));
      // And DPS, which no document states, is entered by hand.
      const added=await (await postLedger(new NextRequest("http://localhost/api/ledger",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({familyMemberId:people[0].id,planName:"DPS",eventType:"death",paysKind:"lump_sum",amount:70000,currency:"SGD"})}))).json();
      assert.equal(added.row.status,"confirmed");
      const after=(await send("Desmond was murdered in Thailand",people[0].id)).data.answer as ChatAnswer;
      const afterItem=after.claimItems.find(i=>/Group Term Life/.test(i.title));
      assert.equal(afterItem?.estimateBasis,undefined);assert.equal(afterItem?.status,"likely_applicable");
      assert.ok(after.claimItems.some(i=>/DPS/.test(i.title)&&i.amountText===null),"A row entered by the person is answered from: "+after.claimItems.map(i=>i.title).join(" | "));
      assert.equal(after.potentialPayoutTotals?.length??0,0);
      const again=await (await getLedger(new NextRequest("http://localhost/api/ledger?familyMemberId="+people[0].id))).json();
      assert.equal((again.rows as LRow[]).some(r=>r.id===tpd!.id),false,"A rejected row is not shown");
      // Re-seeding after a new upload adds nothing twice and never touches a confirmed row.
      const rebuilt=await (await postLedger(new NextRequest("http://localhost/api/ledger",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"rebuild"})}))).json();
      assert.equal(rebuilt.added,0);
      const still=await (await getLedger(new NextRequest("http://localhost/api/ledger?familyMemberId="+people[0].id))).json();
      assert.equal((still.rows as LRow[]).find(r=>r.id===life!.id)?.status,"confirmed");
      // Another account's rows are never visible or editable.
      const foreignRow=await db.query<{id:string}>("INSERT INTO coverage_rules(account_id,family_member_id,plan_name,event_type,pays_kind,amount,origin) VALUES($1,$2,'Other Plan','death','lump_sum',5,'person') RETURNING id",[foreign,foreignPerson]);
      const denied=await patchLedger(new NextRequest("http://localhost/api/ledger",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:foreignRow.rows[0].id,status:"confirmed"})}));
      assert.equal(denied.status,404);
      assert.equal((still.rows as LRow[]).some(r=>r.planName==="Other Plan"),false);
      // Isolation audit (20 Oct): a row cannot be added for another household's person (the foreign key alone accepted any
      // household's id, and answered differently for an id that exists).
      const strangers=await postLedger(new NextRequest("http://localhost/api/ledger",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({familyMemberId:foreignPerson,planName:"Probe",eventType:"death",paysKind:"lump_sum",amount:1,currency:"SGD"})}));
      assert.equal(strangers.status,404);
      assert.equal((await db.query("SELECT 1 FROM coverage_rules WHERE family_member_id=$1 AND account_id<>$2",[foreignPerson,foreign])).rows.length,0,"Nothing is written against another household's person");
      // A person or document this household removed (soft-deleted) cannot be given a row either.
      const removedPerson=uuid(702500),removedDoc=uuid(702501);
      await db.query("INSERT INTO family_members(id,account_id,display_name,relationship,lifecycle_state) VALUES($1,$2,'Removed Person','child','soft_deleted')",[removedPerson,account]);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state) VALUES($1,$2,$3,'Example Insurer','Removed Plan','Hospital','personal_schedule',true,60,'ready','rm.pdf','rm.pdf','scan_clean','soft_deleted')",[removedDoc,account,people[0].id]);
      const add=(body:object)=>postLedger(new NextRequest("http://localhost/api/ledger",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({planName:"Probe",eventType:"death",paysKind:"lump_sum",amount:1,currency:"SGD",...body})}));
      assert.equal((await add({familyMemberId:removedPerson})).status,404,"a removed person");
      assert.equal(await addLedgerRow(account,{familyMemberId:people[0].id,policyId:removedDoc,planName:"Probe",eventType:"death",paysKind:"lump_sum",amount:1,currency:"SGD"}),null,"a removed document");
      assert.equal((await db.query("SELECT 1 FROM coverage_rules WHERE family_member_id=$1 OR policy_id=$2",[removedPerson,removedDoc])).rows.length,0);
      await db.query("DELETE FROM policies WHERE id=$1",[removedDoc]);
      await db.query("DELETE FROM family_members WHERE id=$1",[removedPerson]);
    });
    await test("Coverage works a percentage out from the cover it pays under, and takes no plan column's figure or liability row as the person's",async()=>{
      // Live release set (20 Oct): the Coverage page showed an accident-scale row (sight in one eye) as a percentage of the
      // S$1,000,000 term life cover, while the Benefits page used the S$600,000 personal accident cover. A group scheme's
      // certificate lists every cover under one scheme name, so joining a wording row to "a cover whose name shares a
      // word" picked whichever came first.
      const member=people[2].id,cert=uuid(702000);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'Example Insurer','Example Group Scheme','EGS-1','G-EGS','Group Insurance','certificate',true,95,'ready','egs.pdf','egs.pdf','scan_clean')",[cert,account,member]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'user_declared',1.0)",[cert,member,account]);
      await db.query("INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified) VALUES($1,$2,$3,'Group Term Life',1000000,'SGD','Example Group Scheme',1,'Group Term Life SGD 1,000,000',true)",[account,cert,member]);
      await db.query("INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified) VALUES($1,$2,$3,'Group Personal Accident',600000,'SGD','Example Group Scheme',1,'Group Personal Accident SGD 600,000',true)",[account,cert,member]);
      const row=async(eventType:string,cause:string|null,note:string)=>(await db.query<{id:string}>("INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,event_type,detail,cause,pays_kind,amount,currency,note,origin,status) VALUES($1,$2,$3,'Example Group Scheme',$4,$5,$6,'percent_of_sum',0.5,'SGD',$5,'wording','confirmed') RETURNING id",[account,member,cert,eventType,note,cause])).rows[0].id;
      const eye=await row("dismemberment","accident","Loss of sight in one eye");
      const death=await row("death",null,"Death");
      await seedLedger(account);
      const basis=async(id:string)=>Number((await db.query<{sum_basis:string|null}>("SELECT sum_basis::text FROM coverage_rules WHERE id=$1",[id])).rows[0].sum_basis);
      assert.equal(await basis(eye),600000,"An accident-scale row is a percentage of the personal accident cover");
      assert.equal(await basis(death),1000000,"A death row is a percentage of the life cover");

      // Live release set (20 Oct): a travel wording's third-party liability row ("if you are liable for accidental death,
      // injury or damage to other people", one figure per plan column) showed as the person's own "Accidental death
      // S$500,000", and a "Not covered" schedule term showed as a S$500 lump sum.
      const benefit=(name:string,kind:string,value:number,quote:string,rowKind:string|null=null)=>db.query(
        "INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review,row_kind) VALUES($1,$2,'Example Group Scheme',$3,ARRAY[]::text[],$4,$5,'SGD',7,$6,'[]'::jsonb,'[]'::jsonb,false,$7)",
        [account,cert,name,kind,value,quote,rowKind]);
      await benefit("If you are liable for accidental death, injury or damage to other people","fixed",500000,"If you are liable for accidental death, injury or damage to other people S$500,000 S$750,000 S$1,000,000");
      await benefit("Sports equipment","fixed",500,"Sports equipment Not covered S$500 S$1,000","not_covered");
      await benefit("Trip cancellation","fixed",7500,"If you have to cancel your entire trip S$7,500 S$10,000 S$15,000");
      await seedLedger(account);
      const seeded=(await db.query<{event_type:string;pays_kind:string;amount:string|null;note:string|null}>(
        "SELECT event_type,pays_kind,amount::text,note FROM coverage_rules WHERE policy_id=$1 AND origin<>'person' AND note IS NOT NULL",[cert])).rows;
      const liability=seeded.find(r=>/liable/.test(r.note??""));
      assert.ok(liability,"The liability row is still listed");
      assert.equal(liability!.event_type,"other","Liability to other people is not the person's accidental death");
      assert.equal(liability!.amount,null,"One plan column's figure is not the person's");
      assert.equal(seeded.some(r=>/Sports equipment/.test(r.note??"")&&r.amount!=null),false,"A \"Not covered\" row carries no amount");
      assert.equal(seeded.find(r=>/Trip cancellation/.test(r.note??""))?.amount??null,null,"A per-plan cancellation limit is not given as the person's");
      assert.equal(seeded.some(r=>r.event_type==="accidental_death"&&Number(r.amount)===500000),false);
      await db.query("DELETE FROM policy_benefits WHERE policy_id=$1",[cert]);
      await db.query("DELETE FROM coverage_rules WHERE policy_id=$1",[cert]);

      // Either/or amounts (reviewer, 20 Oct): the wrist as 25% of a fixed S$5,000 limit in one table and 20% of the
      // S$600,000 accident cover ("% of Sum Insured" printed in the heading) in another. Both pages send the two as one
      // group on the member row -- never one picked figure (the Benefits page showed S$1,000), never a total.
      // The two tables are in two documents (the product summary and the benefit summary).
      const productSummary=uuid(702001);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'Example Insurer','Example Group Scheme','EGS-1','G-EGS','Group Insurance','product_summary',false,40,'ready','egs-ps.pdf','egs-ps.pdf','scan_clean')",[productSummary,account,member]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'user_declared',1.0)",[productSummary,member,account]);
      const ids=(await db.query<{id:string}>(
        `INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review,basis_inferred) VALUES
         ($1,$3,'Example Group Scheme','Arm , Elbow, Wrist or Ribs',ARRAY['bodily_injury','accident']::text[],ARRAY['accident']::text[],'fixed',1250,'SGD',13,'Arm , Elbow, Wrist or Ribs 25%','["DearPolicy read this as 25% of the S$5,000 limit stated in the heading of this schedule."]'::jsonb,'[]'::jsonb,true,true),
         ($1,$2,'Example Group Scheme','Arm, Elbow, Wrist or Ribs (Other Fracture)',ARRAY['bodily_injury','accident']::text[],ARRAY['accident']::text[],'sum_insured',0.2,'SGD',8,'Arm, Elbow, Wrist or Ribs (Other Fracture) 20%','["DearPolicy read this as 20% of the sum insured, from the heading of the schedule this row sits in."]'::jsonb,'[]'::jsonb,true,true)
         RETURNING id::text`,[account,cert,productSummary])).rows.map(r=>r.id);
      const listed=(await (await getBenefits(new NextRequest("http://localhost/api/benefits?familyMemberId="+member))).json()).benefits as {id:string;alternatives:{groupId:string;note:string;options:{rowId:string;amountText:string}[]}|null}[];
      const wristRows=listed.filter(b=>ids.includes(b.id));
      assert.equal(wristRows.length,2);
      for(const b of wristRows){
        assert.deepEqual(b.alternatives?.options.map(o=>o.amountText).sort(),["S$1,250","S$120,000"].sort(),"Benefits: both readings on each member row");
        assert.match(b.alternatives!.note,/never added together; the insurer decides/);
      }
      assert.equal(wristRows[0].alternatives!.groupId,wristRows[1].alternatives!.groupId);
      assert.doesNotMatch(JSON.stringify(listed),/S\$1,000(?![,\d])|121,250/,"No S$1,000 reading and no total");
      await seedLedger(account);
      const ledger=(await (await getLedger(new NextRequest("http://localhost/api/ledger?familyMemberId="+member))).json()).rows as {policyId:string|null;alternatives:{options:{amountText:string}[]}|null}[];
      const grouped=ledger.filter(r=>(r.policyId===cert||r.policyId===productSummary)&&r.alternatives);
      assert.ok(grouped.length>=1,"Coverage: the wrist row carries the group");
      for(const r of grouped)assert.deepEqual(r.alternatives!.options.map(o=>o.amountText).sort(),["S$1,250","S$120,000"].sort());
      await db.query("DELETE FROM policy_benefits WHERE policy_id=ANY($1::uuid[])",[[cert,productSummary]]);
      await db.query("DELETE FROM coverage_rules WHERE policy_id=ANY($1::uuid[])",[[cert,productSummary]]);
      await db.query("DELETE FROM policies WHERE id=ANY($1::uuid[])",[[cert,productSummary]]);
    });
    await test("An assessment from the stored rules leaves a claim on record, with a pack to print",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.ok(answer.claimSessionId,"The claim is on record");
      assert.ok(answer.nextSteps.some(step=>/claim pack/i.test(step)),"The last thing said is what to do next: "+answer.nextSteps.join(" / "));
      assert.ok(answer.nextSteps.some(step=>/Send these documents for the claim:|Gather:/.test(step)&&/medical report/i.test(step)),"…and what to gather follows the event: "+answer.nextSteps.join(" / "));
      const pack=await getClaimPack(new NextRequest("http://localhost/api/claims/"+answer.claimSessionId+"/pack"),{params:Promise.resolve({id:answer.claimSessionId!})});
      assert.equal(pack.status,200,"The pack can be printed straight from a chat answer");
      const { extractPdfPages }=await import("@/lib/documents/pdf");
      const printed=(await extractPdfPages(new Uint8Array(await pack.arrayBuffer()))).map(page=>page.text).join(" ").replace(/\s+/g," ");
      assert.doesNotMatch(printed,/S\$350,000/,"A preliminary pack does not state a payout");
      assert.doesNotMatch(printed,/verified an amount/,"Redaction keeps the explanation readable");
      assert.match(printed,/page 7/);
      // It appears on the Claims page for this person.
      const listed=await (await db.query("SELECT status,decision_packet FROM claim_sessions WHERE id=$1",[answer.claimSessionId])).rows[0] as {status:string;decision_packet:{ready:boolean}};
      assert.equal(listed.status,"complete");assert.equal(listed.decision_packet.ready,true);
    });
    await test("Relevance is read, not keyword-matched: dengue is not cancer, and 'no ambulance' is heard",async()=>{
      const fixture=await seedReviewFixture(1);
      const product="Review Fixture Critical Illness";
      const insert=(name:string,traits:string,requires:string,kind:string,value:number,factKey:string|null,offset:number|null,max:number|null)=>db.query(
        "INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,'SGD',$9,$10,$11,6,$12,'[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,product,name,traits.split(",").filter(Boolean),requires.split(",").filter(Boolean),kind,value,factKey,offset,max,name+" wording"]);
      // A health booklet: rows that all carry "hospitalisation" and would all match by keyword.
      await insert("Cancer drug services","illness,hospitalisation,medical_expense","","fixed",4500,null,null,null);
      await insert("Day surgery","hospitalisation","","fixed",1500,null,null,null);
      await insert("Daily Hospital Cash Benefit","hospitalisation","","daily",30,"hospitalNights",0,30);
      await insert("Ambulance Cost","medical_expense","","expense_cap",500,"ambulanceBill",null,null);
      const before=relevanceCalls;
      const first=(await send("Desmond caught dengue. What can he claim?",people[0].id)).data;
      const one=first.answer as ChatAnswer;
      assert.ok(relevanceCalls>before,"The shortlist was put to the reader");
      const candidates=one.details.find(d=>d.startsWith("This may relate to"))??"";
      assert.equal(/critical illness|cancer/i.test(candidates),false,"Rows the reader ruled out are not even named as candidates: "+candidates);
      assert.match(candidates,/hospital cash/i);
      const visible=[one.summary,...one.details].join("\n");
      assert.equal(/Not applicable here|Cancer drug services|Day surgery|benefit rules? read/i.test(visible),false,"Ruled-out rows are internal tracing, never household text: "+visible);
      // Facts given in passing are heard: "no ambulance" ends the ambulance question for good.
      const second=(await send("Yes",people[0].id,first.answer.conversationId,first.answer.conversationRevision)).data;
      const third=(await send("3 nights, no ambulance, we took a taxi",people[0].id,second.answer.conversationId,second.answer.conversationRevision)).data;
      const three=third.answer as ChatAnswer;
      assert.equal(three.questions.some(q=>/ambulance/i.test(q.text)),false,"Never ask about a charge for something that did not happen: "+JSON.stringify(three.questions));
      assert.equal(three.questions.some(q=>/maximum number of days|not stated in the row/i.test(q.text)),false,"Internal notes are never asked as questions");
      const titles=three.claimItems.map(i=>i.title).join(" | ");
      assert.equal(/Ambulance|Cancer|Day surgery/.test(titles),false,titles);
      assert.match(titles,/Daily Hospital Cash/);
      assert.equal(three.claimItems[0].amountText,null);
      assert.equal(/took a taxi/.test(three.summary),false,"The person's own words are never handed back as the answer");
    });
    await test("Every model call is on the ledger, priced, and the plan can be checked against it",async()=>{
      const { usageThisMonth }=await import("@/lib/ai/ledger");
      await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) SELECT $1,id,'Review Fixture Critical Illness','Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured.','[]'::jsonb,'[]'::jsonb,false FROM policies WHERE account_id=$1 AND document_role='policy_wording'",[account]);
      const before=await usageThisMonth(account);
      await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const after=await usageThisMonth(account);
      assert.ok(after.calls>before.calls,"The turn's model calls were counted");
      assert.ok(after.byRole.some(r=>r.role==="judgement"),"Interpretation and relevance are judgement work");
      // V1.1 Task 5: the claim answer is worded by code; nothing is paid for narration.
      assert.equal(after.byRole.find(r=>r.role==="narration")?.calls??0,before.byRole.find(r=>r.role==="narration")?.calls??0,"No narration call for a deterministic claim answer");
      // Every call is billable now, so a turn that costs nothing would mean the
      // ledger missed it -- which is the failure this test exists to catch.
      assert.ok(after.costUsd>before.costUsd,"A turn's hosted calls are priced, not just counted: "+before.costUsd+" -> "+after.costUsd);
      assert.ok(after.byRole.every(r=>r.costUsd>=0),"No role reports a negative cost");
      assert.equal(after.plan.priceUsd,4.99);
      assert.ok(after.chatTurns>=1,"Questions are counted against the plan's allowance");
    });
    await test("A household past its spend limit is stopped before the next hosted call, in plain words",async()=>{
      const { assertUnderSpendCap,SpendCapReached }=await import("@/lib/ai/ledger");
      const { readableModelFailure }=await import("@/lib/ai/llm");
      // This test sets the month's spend to the cent, so it needs the month to
      // start empty. Every earlier turn in this suite is now a priced call, and
      // without this the $14.99 below lands on top of them and trips the cap
      // before the first assertion gets to check that it does not.
      await db.query("DELETE FROM model_usage WHERE account_id=$1",[account]);
      await db.query("INSERT INTO model_usage(account_id,role,provider,model,input_tokens,output_tokens,cost_usd,priced) VALUES($1,'reading','anthropic','claude-sonnet-5',1000000,200000,14.99,true)",[account]);
      process.env.PLAN_HARD_STOP_USD="15";
      try{
        await assertUnderSpendCap(account); // 14.99 < 15: still allowed
        await db.query("INSERT INTO model_usage(account_id,role,provider,model,input_tokens,output_tokens,cost_usd,priced) VALUES($1,'judgement','anthropic','claude-haiku-4-5',10000,1000,0.02,true)",[account]);
        let stopped:unknown=null;
        try{await assertUnderSpendCap(account);}catch(error){stopped=error;}
        assert.ok(stopped instanceof SpendCapReached,"Past the stop, hosted calls are refused");
        const message=readableModelFailure(stopped);
        assert.match(message,/reached its model-spend limit/);
        assert.match(message,/documents already read still work/,"The person is told what still works, not just what stopped");
        for(const leak of ["PLAN_HARD_STOP","model_usage","{"])assert.equal(message.includes(leak),false);
      }finally{delete process.env.PLAN_HARD_STOP_USD;await db.query("DELETE FROM model_usage WHERE account_id=$1 AND provider='anthropic'",[account]);}
    });
    await test("MODEL_PRESET=anthropic runs a whole claim with one key and nothing local",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const inner=globalThis.fetch;
      let anthropicCalls=0;const modelsUsed=new Set<string>();let cached=false;
      globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(url.startsWith("https://api.anthropic.com/v1/messages")){
          anthropicCalls++;
          const body=JSON.parse(String(init?.body));
          modelsUsed.add(body.model);
          assert.equal((init?.headers as Record<string,string>)["x-api-key"],"sk-ant-test");
          cached=cached||body.system?.[0]?.cache_control?.type==="ephemeral";
          const system=String(body.system[0].text),user=JSON.parse(body.messages[0].content);
          // Reuse the simulated model's answers by replaying the request through it.
          const replay=await inner(REPLAY_URL,{method:"POST",body:JSON.stringify({system,user:JSON.stringify(user)})});
          const content=(await replay.json()).content;
          return Response.json({id:"fixture-anthropic-response",model:body.model,content:[{type:"text",text:content}],stop_reason:"end_turn",usage:{input_tokens:1200,output_tokens:90,cache_read_input_tokens:800}});
        }
        return inner(input,init);
      }) as typeof fetch;
      process.env.MODEL_PRESET="anthropic";process.env.ANTHROPIC_API_KEY="sk-ant-test";delete process.env.GEMINI_API_KEY;
      try{
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        const answer=data.answer as ChatAnswer;
        assert.equal(answer.claimItems[0]?.amountText,null,"The benefit is found without a pre-review payout");
        assert.ok(anthropicCalls>=2,"Interpretation, relevance and narration went to Claude");
        assert.ok(modelsUsed.has("claude-sonnet-5"),"Judgement on the mid tier: "+[...modelsUsed].join(","));
        assert.ok(cached,"The system prompt is marked for prompt caching");
        const { usageThisMonth }=await import("@/lib/ai/ledger");
        const usage=await usageThisMonth(account);
        assert.ok(usage.costUsd>0,"Hosted calls are priced on the ledger");
        assert.ok(usage.byRole.some(r=>r.role==="judgement"&&r.costUsd>0));
      }finally{
        delete process.env.ANTHROPIC_API_KEY;useHarnessModel();globalThis.fetch=inner;
        await db.query("DELETE FROM model_usage WHERE account_id=$1 AND provider='anthropic'",[account]);
      }
    });
    await test("MODEL_PRESET=gemini routes to Google, choosing the endpoint from the key",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const { geminiEndpoint }=await import("@/lib/ai/providers");
      assert.match(geminiEndpoint("gemini-2.5-flash","AIzaSyExample"),/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent$/,"An AI Studio key goes to the Gemini API");
      assert.match(geminiEndpoint("gemini-2.5-flash","AQ.Ab8Example"),/^https:\/\/generativelanguage\.googleapis\.com/,"Key prefix is not a tell; the Gemini API is the default for every key");
      process.env.GEMINI_ENDPOINT="vertex";
      assert.match(geminiEndpoint("gemini-2.5-flash","AQ.Ab8Example"),/^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/gemini-2\.5-flash:generateContent$/,"Vertex only when asked for");
      delete process.env.GEMINI_ENDPOINT;
      const inner=globalThis.fetch;
      let googleCalls=0;const hosts=new Set<string>();
      globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(/googleapis\.com\/v1beta\/models\?/.test(url))
          return Response.json({models:[{name:"models/gemini-3.6-flash",supportedGenerationMethods:["generateContent"]},{name:"models/gemini-3.5-flash-lite",supportedGenerationMethods:["generateContent"]}]});
        if(/googleapis\.com/.test(url)){
          googleCalls++;hosts.add(new URL(url).host);
          assert.match(url,/gemini-3\.(6-flash|5-flash-lite):generateContent/,"A family name resolves to a model Google actually serves: "+url);
          assert.equal((init?.headers as Record<string,string>)["x-goog-api-key"],"AQ.test-key");
          const body=JSON.parse(String(init?.body));
          assert.equal(body.generationConfig.responseMimeType,"application/json");
          const system=String(body.systemInstruction.parts[0].text),user=JSON.parse(body.contents[0].parts[0].text);
          const replay=await inner(REPLAY_URL,{method:"POST",body:JSON.stringify({system,user:JSON.stringify(user)})});
          const content=(await replay.json()).content;
          return Response.json({modelVersion:url.match(/models\/(.*):generateContent/)?.[1]??"gemini-3.6-flash",responseId:"fixture-gemini-response",candidates:[{content:{parts:[{text:content}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:900,candidatesTokenCount:80}});
        }
        return inner(input,init);
      }) as typeof fetch;
      process.env.MODEL_PRESET="gemini";process.env.GEMINI_API_KEY="AQ.test-key";
      try{
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        assert.equal((data.answer as ChatAnswer).claimItems[0]?.amountText,null);
        assert.ok(googleCalls>=2);
        assert.deepEqual([...hosts],["generativelanguage.googleapis.com"],"The Gemini API by default");
      }finally{
        useHarnessModel();globalThis.fetch=inner;
        await db.query("DELETE FROM model_usage WHERE account_id=$1 AND provider='gemini'",[account]);
      }
    });
    await test("Reading is given the output budget a hosted model can actually use",async()=>{
      const { readingOutputTokens }=await import("@/lib/chat/policy-analysis");
      const savedTokens=process.env.RAG_READING_OUTPUT_TOKENS;
      delete process.env.RAG_READING_OUTPUT_TOKENS;
      try{
        // 900 was the local GPU's ceiling, and it forced the reader to choose
        // between quoting a clause and structuring it. Nothing imposes it now.
        assert.equal(readingOutputTokens(),2600,"A hosted model is not forced to choose between quoting a clause and also structuring it");
        process.env.RAG_READING_OUTPUT_TOKENS="1500";
        assert.equal(readingOutputTokens(),1500,"An explicit setting always wins over the default");
      }finally{
        if(savedTokens)process.env.RAG_READING_OUTPUT_TOKENS=savedTokens;else delete process.env.RAG_READING_OUTPUT_TOKENS;
      }
    });
    await test("Retrieval depth per document is set for a reader that can take it",async()=>{
      const { passageBudget }=await import("@/lib/policies/inventory");
      const savedMax=process.env.RAG_MAX_PASSAGES_PER_DOCUMENT;
      delete process.env.RAG_MAX_PASSAGES_PER_DOCUMENT;
      try{
        // A ceiling of 16 is how a real benefit table ranked just outside the
        // retrieved set and never reached the model at all.
        assert.equal(passageBudget(500),40,"A hosted reader can take the depth that keeps a real benefit table in the retrieved set");
        process.env.RAG_MAX_PASSAGES_PER_DOCUMENT="10";
        assert.equal(passageBudget(500),10,"An explicit setting always wins over the default");
      }finally{
        if(savedMax)process.env.RAG_MAX_PASSAGES_PER_DOCUMENT=savedMax;else delete process.env.RAG_MAX_PASSAGES_PER_DOCUMENT;
      }
    });
    await test("A judgement call rate-limited on Google's pricier tier falls back to the cheaper tier instead of failing the chat",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const inner=globalThis.fetch;
      let flashCalls=0,flashLiteCalls=0;
      globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(/googleapis\.com\/v1beta\/models\?/.test(url))
          return Response.json({models:[{name:"models/gemini-3.6-flash",supportedGenerationMethods:["generateContent"]},{name:"models/gemini-3.5-flash-lite",supportedGenerationMethods:["generateContent"]}]});
        // The pricier judgement tier is out of quota for this whole test --
        // every call to it fails, the way a real Google rate limit would.
        if(/gemini-3\.6-flash:generateContent/.test(url)){flashCalls++;return new Response("rate limited",{status:429,headers:{"retry-after":"0"}});}
        if(/gemini-3\.5-flash-lite:generateContent/.test(url)){
          flashLiteCalls++;
          const body=JSON.parse(String(init?.body));
          const system=String(body.systemInstruction.parts[0].text),user=JSON.parse(body.contents[0].parts[0].text);
          const replay=await inner(REPLAY_URL,{method:"POST",body:JSON.stringify({system,user:JSON.stringify(user)})});
          const content=(await replay.json()).content;
          return Response.json({modelVersion:url.match(/models\/(.*):generateContent/)?.[1]??"gemini-3.6-flash",responseId:"fixture-gemini-response",candidates:[{content:{parts:[{text:content}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:900,candidatesTokenCount:80}});
        }
        return inner(input,init);
      }) as typeof fetch;
      process.env.MODEL_PRESET="gemini";process.env.GEMINI_API_KEY="AQ.test-key";
      try{
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        assert.equal((data.answer as ChatAnswer).claimItems[0]?.amountText,null,"The benefit is found despite the pricier tier being down");
        assert.ok(flashCalls>=1,"The primary judgement tier was tried first");
        assert.ok(flashLiteCalls>=1,"...and every judgement call fell back to the tier that is not rate-limited");
        const usage=(await db.query("SELECT model,ok FROM model_usage WHERE account_id=$1 AND role='judgement' ORDER BY at",[account])).rows as {model:string;ok:boolean}[];
        assert.ok(usage.some(r=>r.model==="flash"&&r.ok===false),"The failed attempt on the primary model is on the ledger, not silently dropped: "+JSON.stringify(usage));
        assert.ok(usage.some(r=>r.model==="flash-lite"&&r.ok===true),"...and the successful fallback attempt is billed under the model that actually ran: "+JSON.stringify(usage));
      }finally{
        useHarnessModel();globalThis.fetch=inner;
        await db.query("DELETE FROM model_usage WHERE account_id=$1 AND provider='gemini'",[account]);
      }
    });
    await test("Several reading windows restating the same \'no coverage\' conclusion collapse into one detail, not several near-duplicates",async()=>{
      await seedReviewFixture(40);
      const inner=globalThis.fetch;
      let readingWindowCalls=0;
      globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(!/googleapis\.com/.test(url)||!/generateContent/.test(url))return inner(input,init);
        const body=JSON.parse(String(init?.body)),system=String(body.systemInstruction.parts[0].text);
        if(!system.startsWith("Read insurance"))return inner(input,init);
        readingWindowCalls++;
        const user=JSON.parse(body.contents[0].parts[0].text),source=user.sources[0],quote=String(source.text).slice(0,40);
        // Independent reading windows over the same undershot section, worded
        // differently the way a real model varies its phrasing window to window.
        const restatements=["This contract does not contain a critical illness benefit for this diagnosis.",
          "The policy wording does not include any relevant benefit here.","These pages do not provide coverage for the reported event."];
        const text=readingWindowCalls<=3?restatements[readingWindowCalls-1]:
          "This particular passage raises an unrelated administrative point, not a coverage conclusion.";
        return googleReply(JSON.stringify({benefits:[],observations:[{text,evidence:[{sourceId:source.id,quote}]}],nextSteps:[]}));
      }) as typeof fetch;
      // Small sections so these 40 pages span several reading windows, which is
      // the condition the test is about; at the default size they fit in two.
      process.env.RAG_EVIDENCE_WINDOW_CHARACTERS="3300";
      try{
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        const answer=data.answer as ChatAnswer;
        assert.ok(readingWindowCalls>=4,"The fixture\'s 40 wording pages must span more than one reading window: "+readingWindowCalls);
        const restatementLines=answer.details.filter(d=>/\b(?:do|does) not (?:contain|include|cover|provide)\b/i.test(d));
        assert.equal(restatementLines.length,1,"Every window\'s restatement of the same \'no coverage\' conclusion collapses into a single detail line, not one per window: "+JSON.stringify(answer.details));
        assert.ok(answer.details.some(d=>/unrelated administrative point/.test(d)),"A genuinely distinct observation for the same contract is still preserved: "+JSON.stringify(answer.details));
      }finally{
        delete process.env.RAG_EVIDENCE_WINDOW_CHARACTERS;globalThis.fetch=inner;
      }
    });
    await test("A percentage-of-Sum-Insured clause quoted as prose is promoted into a preliminary benefit",async()=>{
      const fixture=await seedReviewFixture(1);
      const fractureText="For accidental fracture of a limb, compensation is provided for a broken forearm at 20% of the Sum Insured.";
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,2,$3)",[account,fixture.referenceId,fractureText]);
      await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,2,2,$5,$6::vector)",
        [uuid(700600),account,fixture.person.id,fixture.referenceId,fractureText,"["+Array.from({length:1024},(_,j)=>j===0?1:0).join(",")+"]"]);
      const inner=globalThis.fetch;
      globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(!/googleapis\.com/.test(url)||!/generateContent/.test(url))return inner(input,init);
        const body=JSON.parse(String(init?.body)),system=String(body.systemInstruction.parts[0].text);
        if(!system.startsWith("Read insurance"))return inner(input,init);
        const user=JSON.parse(body.contents[0].parts[0].text);
        const fractureSource=(user.sources as {id:string;text:string}[]).find(s=>s.text.includes("broken forearm"));
        if(!fractureSource)return inner(input,init);
        // The model quotes the clause correctly but -- the way a small/cheap
        // model sometimes does -- returns it only as prose, never structuring
        // it into the benefits list alongside.
        return googleReply(JSON.stringify({benefits:[],
          observations:[{text:"Compensation is provided for a broken forearm at 20% of the Sum Insured.",
            evidence:[{sourceId:fractureSource.id,quote:"compensation is provided for a broken forearm at 20% of the Sum Insured"}]}],
          nextSteps:[]}));
      }) as typeof fetch;
      try{
        // A reported fracture is fact-found first: one question per turn, no
        // claim cards and no figures until the facts that decide which
        // benefits respond are in. Answer each question as the chat's own
        // question card would, then check the clause is promoted.
        const {data}=await send("He broke his left forearm playing basketball. What can he claim?",fixture.person.id);
        let answer=data.answer as ChatAnswer;
        assert.equal(answer.mode,"fact_finding","A fracture is fact-found before any benefit is shown");
        assert.equal(answer.questions.length,1,"Exactly one question at a time: "+JSON.stringify(answer.questions));
        assert.equal(answer.claimItems.length,0,"No claim cards while facts are missing");
        answer=await answerInjuryInterview(answer,fixture.person.id);
        const item=answer.claimItems.find(c=>/broken forearm/i.test(c.title));
        assert.ok(item,"The quoted percentage clause must be promoted into a claim item, not left as prose the household has to work out itself: "+JSON.stringify(answer.claimItems));
        assert.equal(item!.calculatedAmount,undefined,"Pre-review chat must not expose a computed payout");
        assert.equal(item!.amountText,null);
      }finally{
        globalThis.fetch=inner;
      }
    });
    await test("A printed figure outranks a heading-inferred percentage for the same benefit across two documents",async()=>{
      const fixture=await seedReviewFixture(1);
      const product="Review Fixture Critical Illness";
      // Benefit summary: "% of Sum Insured" heading -> 20% of the S$350,000 cover = S$70,000. Wrong for a fracture.
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review,basis_inferred) VALUES($1,$2,$3,'Arm, Elbow, Wrist or Ribs (Other Fracture)',ARRAY['accident','bodily_injury']::text[],ARRAY['accident']::text[],'sum_insured',0.2,'SGD',8,'Arm, Elbow, Wrist or Ribs (Other Fracture) 20%','[]'::jsonb,'[]'::jsonb,true,true)",
        [account,fixture.referenceId,product]);
      // Product summary of the same plan: "% of S$5,000" heading -> S$1,250.
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review,basis_inferred) VALUES($1,$2,$3,'Arm , Elbow, Wrist or Ribs',ARRAY['accident','bodily_injury']::text[],ARRAY['accident']::text[],'fixed',1250,'SGD',13,'Arm , Elbow, Wrist or Ribs 25%','[]'::jsonb,'[]'::jsonb,true,true)",
        [account,fixture.policyId,product]);
      const {data}=await send("Desmond broke his forearm playing basketball",people[0].id);
      assert.equal((data.answer as ChatAnswer).mode,"fact_finding","A fracture is fact-found before any benefit is shown");
      const answer=await answerInjuryInterview(data.answer as ChatAnswer,people[0].id);
      const cards=answer.claimItems.map(item=>item.title+"="+item.amountText);
      assert.equal(answer.claimItems.length,1,"One fracture benefit, not two versions of it: "+cards.join(" | ")+" [mode="+answer.mode+"; summary="+answer.summary+"; q="+JSON.stringify(answer.questions)+"; facts="+JSON.stringify(answer.knownFacts)+"]");
      assert.match(answer.claimItems[0].title,/Arm.*Elbow.*Wrist/,"The printed S$5,000 clause outranks the heading-inferred percentage, even while both stay unpriced: "+cards.join(" | "));
      // Both rates were read from a heading above their row, not the row
      // itself, so neither is trusted for a bare figure until a person
      // confirms it on the Benefits page -- which also means the wrong
      // S$70,000 percentage-of-whole-sum reading can never leak through.
      assert.equal(answer.claimItems[0].amountText,null);
      assert.equal(answer.claimItems[0].status,"needs_document");
      assert.equal(answer.claimItems[0].estimateBasis,undefined,"Pre-review cards do not expose an estimate basis");
      // V1.1 Task 4: an unconfirmed (heading-read) rate stays unpriced and says it
      // still needs checking -- never a "confirm the heading" task for the household.
      assert.ok(answer.claimItems[0].conditions.some(c=>/still has to check this benefit’s wording/.test(c)),"The condition says the rate is not yet checked: "+answer.claimItems[0].conditions.join(" / "));
      assert.equal(answer.claimItems[0].conditions.some(c=>/heading|Benefits page/i.test(c)),false,"No heading-confirmation task for the household");
      assert.equal(/S\$70,000/.test(JSON.stringify(answer)),false,"S$70,000 for a forearm never appears anywhere");
    });
    await seedPlans(900);
    await test("Real keyset SQL and per-policy retrieval still include the 900th policy",async()=>{
      const inventory=await loadPolicyInventory(account,people);assert.equal(inventory.contracts.length,900);
      const sources=await retrieveContractSources({accountId:account,contracts:inventory.contracts,question:"death benefits",searchTerms:["death"]});
      assert.equal(sources.size,900);assert.ok(sources.get(inventory.contracts.at(-1)!.id)?.length);
    });
    console.log("DearPolicy PostgreSQL/pgvector/API checks passed ("+cases+" checks; simulated Ollama responses).");
    console.log("Model calls exercised: interpretation="+interpretationCalls+", policy reading="+readingCalls+", explanation="+explanationCalls+". Maximum user-prompt characters="+maxModelUserCharacters+".");
  }finally{
    pool.query=originalQuery;pool.connect=originalConnect;globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;await db.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

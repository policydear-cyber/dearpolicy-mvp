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
import { GET as getClaimPack } from "@/app/api/claims/[id]/pack/route";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getIndexStatus,POST as indexBenefits } from "@/app/api/benefits/index/route";
import { POST as linkPerson } from "@/app/api/policies/link-person/route";
import type { ChatAnswer } from "@/types";
import type { Interpretation } from "@/lib/chat/facts";
import type { PolicyAnalysis } from "@/lib/chat/types";

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
  const account="00000000-0000-0000-0000-000000000001",foreign="00000000-0000-0000-0000-000000000099";
  const uuid=(n:number)=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");
  const people=Array.from({length:9},(_,i)=>({
    id:uuid(i+1),display_name:i===0?"Tan Yi Chuen Desmond":i===1?"Ong Pei Lin Charmaine":"Family Member "+i,
    preferred_name:i===0?"Desmond":i===1?"Charmaine":"Member "+i,relationship:i===0?"self":i===1?"spouse":i<5?"child":"parent",
  }));
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Test Family'),($2,'Other Account')",[account,foreign]);
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
  process.env.LLM_MODEL="qwen3:8b";
  // Remove only the VRAM cleanup delay for a simulated model. Production model
  // locking/unloading code is exercised and left unchanged.
  globalThis.setTimeout=((fn:Parameters<typeof setTimeout>[0],ms?:number,...args:unknown[])=>originalTimeout(fn,ms===700?0:ms,...args)) as typeof setTimeout;
  let interpretationCalls=0,readingCalls=0,explanationCalls=0,maxModelUserCharacters=0,unloadCalls=0,catalogCalls=0,categoriseCalls=0,relevanceCalls=0,ledgerReads=0,ledgerChecks=0;
  let lastKeepAlive:unknown=null;
  // Unload count observed at each policy-reading call, to prove the model is not
  // dropped and reloaded between the sections of a single turn.
  const unloadsAtRead:number[]=[];
  let malformed=false,failReading=false,truncateInterpretations=0,misshapeReading=0;
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(url.endsWith("/api/generate")){unloadCalls++;return Response.json({});}
    if(url.endsWith("/api/embed"))return Response.json({embeddings:[Array.from({length:1024},(_,i)=>i===0?1:0)]});
    if(!url.endsWith("/api/chat"))throw new Error("Unexpected model request: "+url);
    const body=JSON.parse(String(init?.body)),system=body.messages[0].content,user=JSON.parse(body.messages[1].content);
    maxModelUserCharacters=Math.max(maxModelUserCharacters,body.messages[1].content.length);
    assert.equal(body.options.num_ctx,4096);lastKeepAlive=body.keep_alive;
    let result:unknown;
    if(system.startsWith("Interpret this")){
      interpretationCalls++;
      if(malformed)return Response.json({message:{content:"invalid JSON"}});
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
      readingCalls++;unloadsAtRead.push(unloadCalls);
      if(failReading)return Response.json({message:{content:"not valid json"}});
      if(misshapeReading>0){
        misshapeReading--;
        const quote={sourceId:user.sources[0].id,quote:String(user.sources[0].text).slice(0,120)};
        // The exact shape Qwen returned on DC's machine: a bare string where a
        // list of quoted conditions belongs, and one quote instead of a list.
        return Response.json({message:{content:JSON.stringify({benefits:[{title:"Critical illness benefit",coverageId:user.confirmedCoverages[0]?.id,
          evidence:quote,requirements:[],conditions:"Subject to the defined illness.",
          formula:{kind:"none",value:null,currency:null,factKey:null,offsetDays:null,maximumDays:null,evidence:null}}],
          observations:[],nextSteps:[]})}});
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
    return Response.json({message:{content}});
  }) as typeof fetch;

  let cases=0;const test=async(name:string,fn:()=>Promise<void>)=>{try{await fn();cases++;console.log("PASS "+name);}catch(error){throw new Error(name,{cause:error});}};
  const blank:ChatAnswer={mode:"answer",summary:"Saved answer",details:[],claimItems:[],nextSteps:[],confidence:null,citations:[],disclaimer:"",
    claimSessionId:null,questions:[],knownFacts:[],missingFacts:[]};
  const send=async(message:string,member:string|null=people[0].id,conversationId?:string,revision?:number,asynchronous=false)=>{
    const response=await POST(new Request("http://localhost/api/chat",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({familyMemberId:member,scope:member?"member":"family",question:message,conversationId,conversationRevision:revision,asynchronous,timeZone:"Asia/Singapore"})}));
    return {response,data:await response.json()};
  };
  const awaitJob=async(id:string)=>{
    for(let i=0;i<3000;i++){
      const response=await getJob(new Request("http://localhost/api/chat/jobs/"+id),{params:Promise.resolve({id})});
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
        await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json) VALUES($1,$2,$3,'Example Insurer',$4,$5,$6,$7,$8,$9,'ready',$10,$10,'2022-01-01',$11::jsonb)",
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
      const response=await POST(new Request("http://localhost/api/chat",{method:"POST",headers:{"content-type":"application/json"},
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
    await test("A homicide is classified broadly and both evidence-supported death amounts remain visible",async()=>{
      const result=await send("Desmond was murdered in Thailand");
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;
      assert.match(answer.summary,/reported death/i);assert.match(answer.summary,/Thailand/i);assert.match(answer.summary,/S\$1,600,000/);
      assert.deepEqual(answer.potentialPayoutTotals,[{currency:"SGD",amount:1_600_000,amountText:"S$1,600,000",itemCount:2}]);
      assert.ok(answer.claimItems.some(item=>/Death/.test(item.title)&&item.amountText==="S$1,000,000"),answer.claimItems.map(i=>i.title).join(" | "));
      assert.ok(answer.claimItems.some(item=>/Accidental death|Personal Accident/i.test(item.title)&&item.amountText==="S$600,000"),answer.claimItems.map(i=>i.title).join(" | "));
      assert.ok(answer.scenarioClassifications?.some(item=>item.traits.includes("violent")&&item.traits.includes("external")));
      assert.equal(new Set(answer.details).size,answer.details.length);
      const saved=(await getConversation(account,answer.conversationId!))!.state,state=saved.subjects[people[0].id];
      assert.equal(state.death.value,true);assert.equal(state.causeOfDeath.value,"murdered");assert.equal(state.eventLocation.value,"Thailand");
      assert.equal(state.accidentalDeath,undefined);assert.ok(saved.scenarios?.[people[0].id]?.length);
    });
    await test("A travel delay is assessed from its own clause and reported duration",async()=>{
      const result=await send("Desmond's flight was delayed for eight hours.");
      assert.equal(result.response.status,200,JSON.stringify(result.data));const answer=result.data.answer as ChatAnswer;
      assert.ok(answer.claimItems.some(item=>item.title.includes("Flight delay")&&item.amountText==="S$300.00"&&/applicable/.test(item.status)),JSON.stringify(answer.claimItems.map(i=>[i.title,i.amountText,i.status])));
      assert.equal(answer.potentialPayoutTotals?.[0]?.amount,300);
    });
    await test("A duration below a travel threshold rules out only that benefit",async()=>{
      const result=await send("Desmond's flight was delayed for three hours.");
      assert.equal(result.response.status,200,JSON.stringify(result.data));const answer=result.data.answer as ChatAnswer;
      const item=answer.claimItems.find(value=>value.title.includes("Flight delay"));assert.equal(item?.status,"not_applicable");assert.equal(item?.amountText,null);
      assert.equal(answer.potentialPayoutTotals?.length,0);
    });
    await test("A motor repair estimate is calculated but excluded from freely additive lump-sum totals",async()=>{
      const result=await send("Desmond's car was damaged in a collision. The vehicle repair bill is SGD 4,000.");
      assert.equal(result.response.status,200,JSON.stringify(result.data));const answer=result.data.answer as ChatAnswer;
      const item=answer.claimItems.find(value=>value.title.includes("Vehicle damage"));assert.equal(item?.amountText,"S$4,000");
      assert.equal(item?.amountLabel,"Potential reimbursement");assert.equal(answer.potentialPayoutTotals?.length,0);
    });
    await test("The active API resolves Charmaine before loading personal policies",async()=>{
      const result=await send("Charmaine fainted yesterday and took the ambulance to hospital. She was diagnosed with stage 2 breast cancer. I still don't know how much the hospital bill will be.");
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;assert.equal(answer.resolvedFamilyMemberId,people[1].id);
      assert.ok(answer.claimItems.some(item=>item.title.includes("Critical illness")&&item.amountText?.includes("350,000")));
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
      assert.equal(ongoingAnswer.questions.length,0);assert.ok(ongoingAnswer.claimItems.some(item=>item.amountText?.includes("350,000")));
      const next=await send("i still don't know how many nights",people[1].id,ongoingAnswer.conversationId,ongoingAnswer.conversationRevision);
      assert.equal(next.response.status,200,JSON.stringify(next.data));ongoingAnswer=next.data.answer;assert.equal(ongoingAnswer.questions.length,0);
      const state=(await getConversation(account,ongoingAnswer.conversationId!))!.state;
      assert.equal(state.subjects[people[1].id].hospitalNights.state,"pending");
      assert.equal(state.subjects[people[1].id].hospitalStayOngoing.value,true);
    });
    await test("A completed stay updates memory and permits the independent daily calculation",async()=>{
      const result=await send("She was discharged after twelve nights.",people[1].id,ongoingAnswer.conversationId,ongoingAnswer.conversationRevision);
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const answer=result.data.answer as ChatAnswer;assert.ok(answer.claimItems.some(item=>item.title.includes("Daily hospital")&&item.amountText==="S$60.00"));
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
    await test("Savings questions separate guaranteed and projected values",async()=>{
      const result=await send("What happens when my endowment plan matures?",people[1].id);
      assert.equal(result.response.status,200,JSON.stringify(result.data));
      const text=result.data.answer.details.join(" ");assert.match(text,/guaranteed maturity value is SGD 100000/);
      assert.match(text,/projected non-guaranteed maturity value is SGD 120000/);assert.equal(result.data.answer.questions.length,0);
    });
    await test("Async analysis returns actual progress and a saved final answer",async()=>{
      const result=await send("What policies does my family have?",null,undefined,undefined,true);
      assert.equal(result.response.status,202,JSON.stringify(result.data));assert.ok(result.data.jobId);
      const answer=await awaitJob(result.data.jobId);assert.equal(answer.portfolioItems?.length,90);
      const saved=await getSavedChat(new Request("http://localhost/api/chat/history/"+answer.conversationId),{params:Promise.resolve({id:answer.conversationId!})});
      const payload=await saved.json();assert.equal(saved.status,200);assert.equal(payload.messages.length,2);assert.equal(payload.messages[1].answer_json.portfolioItems.length,90);
    });
    await test("A malformed model response is saved as an incomplete analysis",async()=>{
      malformed=true;const result=await send("I still don't know how many hospital nights",people[1].id);malformed=false;
      assert.equal(result.response.status,200,JSON.stringify(result.data));assert.equal(result.data.answer.claimItems.length,0);
      assert.match(result.data.answer.summary,/couldn’t read your message just now/);assert.equal(/\{|invalid JSON/.test(result.data.answer.summary+result.data.answer.details.join(" ")),false,"Raw model output never reaches the person");assert.equal(result.data.answer.confidence,"insufficient_evidence");
    });
    await test("Saved chats and API requests cannot access another account",async()=>{
      const c=await openConversation({accountId:foreign,memberId:foreignPerson,title:"Other account secret"});
      assert.equal(await getConversation(account,c.id),null);
      const response=await getSavedChat(new Request("http://localhost/api/chat/history/"+c.id),{params:Promise.resolve({id:c.id})});assert.equal(response.status,404);
      const result=await send("What policies are there?",foreignPerson);assert.equal(result.response.status,404);
      const removal=await removeHistory(new Request("http://localhost/api/chat/history",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:c.id})}));
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
      const response=await getHistory(new Request("http://localhost/api/chat/history?scope="+people[0].id)),data=await response.json();
      assert.equal(response.status,200);assert.equal(data.conversations.length,50);assert.ok(data.nextCursor);
      const next=await getHistory(new Request("http://localhost/api/chat/history?scope="+people[0].id+"&cursor="+data.nextCursor)),page=await next.json();
      assert.equal(page.conversations.length,11);
    });
    const seedReviewFixture=async(wordingPages:number)=>{
      await db.query("DELETE FROM policies WHERE account_id=$1",[account]);
      await db.query("DELETE FROM policy_analysis_cache WHERE account_id=$1",[account]);
      await db.query("DELETE FROM premium_records WHERE account_id=$1",[account]);
      const person=people[0],id=uuid(700100),ref=uuid(700200),name="Review Fixture Critical Illness";
      const schedule=person.display_name+" owns "+name+". Sum Insured SGD 350000.";
      for(const item of [{id,text:schedule,personal:true},{id:ref,text:"placeholder",personal:false}]){
        await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json) VALUES($1,$2,$3,'Example Insurer',$4,'REVIEW-1','Critical Illness',$5,$6,$7,'ready',$8,$8,'2022-01-01',$9::jsonb)",
          [item.id,account,person.id,name,item.personal?"personal_schedule":"policy_wording",item.personal,item.personal?95:60,item.id+".pdf",JSON.stringify({productsMentioned:[name]})]);
        await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)",[item.id,person.id,account]);
      }
      // These documents have been READ; they simply state no rule this fixture
      // needs. That is a different state from never having been read, and it is
      // the one these fallback tests are about.
      await db.query("UPDATE policies SET benefits_indexed_at=now() WHERE account_id=$1 AND benefits_indexed_at IS NULL",[account]);
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
      assert.match(answer.reviewCoverage!.statement,/^Partial review: \d+ of 13 processed pages/);
      assert.ok(!answer.details.includes(answer.reviewCoverage!.statement),"The banner owns the statement; repeating it in details duplicated it on screen");
      const normalised=answer.details.map(d=>d.toLowerCase().replace(/[^a-z0-9]+/g," ").trim());
      assert.equal(new Set(normalised).size,normalised.length,"No detail may appear twice");
      assert.equal(negativeCoverageClaim(answer.summary),false);
      assert.equal(answer.claimItems[0]?.amountText,"S$350,000");
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
      const claim=(await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id)).data.answer as ChatAnswer;
      assert.equal(claim.claimItems[0]?.amountText,"S$350,000","A missing receipt must not erase a supported amount");
      assert.ok(claim.claimItems[0]?.conditions.some(c=>c.startsWith("Active status not recently verified")));
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
      assert.equal(answer.claimItems[0]?.amountText,"S$350,000");
    });
    await test("A claim amount states the specific reasons it could settle differently",async()=>{
      await seedReviewFixture(1);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(answer.potentialPayoutTotals?.[0].amountText,"S$350,000");
      assert.ok(answer.payoutQualifiers?.length,"A calculated amount must say what could change it");
      assert.ok(answer.payoutQualifiers!.some(q=>/defined illness|definition/i.test(q)),"The outstanding definition is the real reason here: "+JSON.stringify(answer.payoutQualifiers));
      assert.ok(answer.payoutQualifiers!.some(q=>/premium or renewal evidence/i.test(q)));
      assert.match(answer.summary,/S\$350,000/);
      assert.match(answer.summary,/final settled amount can differ because/i);
      assert.ok(answer.payoutQualifiers!.every(q=>!/^\s*$/.test(q)));
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
      assert.ok(answer.nextSteps.some(step=>/evidence batch/i.test(step)),"The user must be told to retry rather than left with silence");
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
      assert.equal(answer.claimItems[0]?.amountText,"S$350,000","A salvaged or retried interpretation still produces the assessment");
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
    await test("The model is not reloaded for every evidence section",async()=>{
      await seedReviewFixture(40);
      unloadsAtRead.length=0;
      await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      assert.ok(unloadsAtRead.length>1,"This fixture must need several evidence sections, got "+unloadsAtRead.length);
      assert.equal(new Set(unloadsAtRead).size,1,
        "A 9B model reloaded between sections is what made a turn take many minutes; unload counts seen at each section: "+unloadsAtRead.join(","));
      assert.equal(lastKeepAlive,0,"The session must leave the GPU released when it ends");
    });
    await test("A turn stops at its reading budget instead of running for minutes",async()=>{
      await seedReviewFixture(40);
      process.env.RAG_MAX_EVIDENCE_WINDOWS="2";
      const readsBefore=readingCalls;
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      delete process.env.RAG_MAX_EVIDENCE_WINDOWS;
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
      assert.ok(/evidence batch/i.test(everything),"The user is still told a section could not be read");
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
      assert.equal(explanationCalls-narrationsBefore,1,"It should still speak like an assistant, not print a table");
      assert.ok(Date.now()-started<4000,"A catalogued answer must be effectively instant");
      assert.equal(answer.potentialPayoutTotals?.[0].amountText,"S$350,000");
      assert.equal(answer.claimItems.length,1,"Only benefits the event can trigger: "+JSON.stringify(answer.claimItems.map(i=>i.title)));
      assert.match(answer.claimItems[0].title,/Major Critical Illness/);
      assert.match(answer.claimItems[0].reason,/page 7/);
      assert.match(answer.summary,/S\$350,000/);
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
      assert.equal(catalogCalls-before,pages.length,"Every page is read exactly once");
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
      const data=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
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
      const mine=await (await getBenefits(new Request("http://localhost/api/benefits?familyMemberId="+people[0].id))).json();
      assert.equal(mine.summary.total,2);
      const other=await (await getBenefits(new Request("http://localhost/api/benefits?familyMemberId="+people[2].id))).json();
      assert.equal(other.summary.total,0,"A person sees only the documents that are linked to them");
    });
    await test("A rule with no readable amount says so rather than showing a figure",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Dental',ARRAY['other']::text[],'none',NULL,NULL,12,'Dental treatment is covered as charged.','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const data=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
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
      const listed=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
      const target=listed.benefits[0];
      const saved=await patchBenefit(new Request("http://localhost/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:target.id,formula:{kind:"sum_insured",value:0.5,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null}})}));
      assert.equal(saved.status,200);
      const after=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
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
      assert.equal(answer.claimItems[0].amountText,"S$175,000","The corrected rule is what the claim is calculated from");
    });
    await test("A rule DearPolicy could not compute is refused in plain language",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Hospital Cash',ARRAY['hospitalisation']::text[],'none',NULL,NULL,4,'A daily amount is payable while confined.','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const listed=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
      const id=listed.benefits[0].id;
      const attempt=async(formula:Record<string,unknown>)=>{
        const response=await patchBenefit(new Request("http://localhost/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
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
      const unchanged=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
      assert.equal(unchanged.benefits[0].formulaKind,"none","A refused correction changes nothing");
      assert.equal(unchanged.benefits[0].needsReview,true);
    });
    await test("Saying a rule is already right records the review without changing it",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const listed=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
      const response=await patchBenefit(new Request("http://localhost/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:listed.benefits[0].id,needsReview:false})}));
      assert.equal(response.status,200);
      const after=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
      assert.equal(after.benefits[0].formulaValue,1,"Confirming a rule must not alter it");
      assert.equal(after.benefits[0].needsReview,false);
      assert.ok(after.benefits[0].reviewedAt);
    });
    await test("Removing a row from the schedule leaves the document and cover untouched",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Table of Contents',ARRAY['other']::text[],'none',NULL,NULL,2,'Contents','[]'::jsonb,'[]'::jsonb,true)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const listed=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
      const pagesBefore=(await db.query("SELECT id FROM policy_pages WHERE account_id=$1",[account])).rows.length;
      const coveragesBefore=(await db.query("SELECT id FROM policy_coverages WHERE account_id=$1",[account])).rows.length;
      const response=await deleteBenefit(new Request("http://localhost/api/benefits",{method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:listed.benefits[0].id})}));
      assert.equal(response.status,200);
      assert.equal((await (await getBenefits(new Request("http://localhost/api/benefits"))).json()).summary.total,0);
      assert.equal((await db.query("SELECT id FROM policy_pages WHERE account_id=$1",[account])).rows.length,pagesBefore);
      assert.equal((await db.query("SELECT id FROM policy_coverages WHERE account_id=$1",[account])).rows.length,coveragesBefore);
    });
    await test("An out-of-date database upgrades itself instead of failing the person's next upload",async()=>{
      await seedReviewFixture(1);
      // Exactly what an existing install looks like before the upgrade.
      await db.query("ALTER TABLE policy_benefits DROP COLUMN reviewed_at");
      await db.query("ALTER TABLE policy_benefits DROP COLUMN basis_inferred");
      delete (globalThis as {__dearpolicyBenefitSchema?:unknown}).__dearpolicyBenefitSchema;
      const response=await getBenefits(new Request("http://localhost/api/benefits"));
      assert.equal(response.status,200,"A missing column must never reach the user as an error");
      const columns=await db.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_name='policy_benefits' AND column_name IN ('reviewed_at','basis_inferred')");
      assert.equal(columns.rows.length,2,"Every column the catalogue needs is added on first use");
    });
    await test("The benefit schedule never shows or changes another account's rules",async()=>{
      await seedReviewFixture(1);
      const foreignPolicy=uuid(700900);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,document_authority,processing_status,original_filename,storage_key) VALUES($1,$2,$3,'Other Insurer','Other Plan','OTHER-1','Critical Illness','policy_wording',60,'ready','other.pdf','other.pdf')",
        [foreignPolicy,foreign,foreignPerson]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)",[foreignPolicy,foreignPerson,foreign]);
      const inserted=await db.query<{id:string}>("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,'Other Plan','Other Benefit',ARRAY['illness']::text[],'fixed',1000,'SGD',1,'Other wording','[]'::jsonb,'[]'::jsonb,true) RETURNING id",
        [foreign,foreignPolicy]);
      const data=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
      assert.equal(data.benefits.some((b:{benefitName:string})=>b.benefitName==="Other Benefit"),false);
      const response=await patchBenefit(new Request("http://localhost/api/benefits",{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:inserted.rows[0].id,needsReview:false})}));
      assert.equal(response.status,404);
      assert.equal((await db.query<{needs_review:boolean}>("SELECT needs_review FROM policy_benefits WHERE id=$1",[inserted.rows[0].id])).rows[0].needs_review,true);
      const removal=await deleteBenefit(new Request("http://localhost/api/benefits",{method:"DELETE",headers:{"content-type":"application/json"},
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
      const pack=await getClaimPack(new Request("http://localhost/api/claims/"+assessed+"/pack"),{params:Promise.resolve({id:assessed})});
      assert.equal(pack.status,200);
      assert.equal(pack.headers.get("content-type"),"application/pdf");
      assert.match(pack.headers.get("content-disposition")??"",/attachment; filename="DearPolicy claim summary - Tan Yi Chuen Desmond\.pdf"/);
      const bytes=new Uint8Array(await pack.arrayBuffer());
      assert.equal(Buffer.from(bytes.slice(0,5)).toString("latin1"),"%PDF-");
      const { extractPdfPages }=await import("@/lib/documents/pdf");
      const printed=(await extractPdfPages(bytes)).map(page=>page.text).join(" ").replace(/\s+/g," ");
      assert.match(printed,/Tan Yi Chuen Desmond/);
      assert.match(printed,/S\$1,250/);
      assert.match(printed,/page 14/,"The insurer can check the figure against the wording");
      assert.match(printed,/Hospital discharge summary/,"The checklist follows the reported event");
      const pending=await getClaimPack(new Request("http://localhost/api/claims/"+unassessed+"/pack"),{params:Promise.resolve({id:unassessed})});
      assert.equal(pending.status,409);
      assert.match((await pending.json()).error,/has not been assessed yet/);
      await db.query("DELETE FROM claim_sessions WHERE id=ANY($1::uuid[])",[[assessed,unassessed]]);
    });
    await test("A claim pack cannot be downloaded from another account",async()=>{
      const foreignClaim=uuid(701300);
      await db.query("INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_summary,facts,decision_packet) VALUES($1,$2,$3,'complete','Other event','{}'::jsonb,$4::jsonb)",
        [foreignClaim,foreign,foreignPerson,JSON.stringify({sessionId:foreignClaim,eventSummary:"Other event",facts:{},knownFacts:[],missingFacts:[],relevantOwnedProducts:[],assessments:[],nextSteps:[],ready:true})]);
      const response=await getClaimPack(new Request("http://localhost/api/claims/"+foreignClaim+"/pack"),{params:Promise.resolve({id:foreignClaim})});
      assert.equal(response.status,404);
      assert.equal(response.headers.get("content-type")?.includes("pdf"),false);
      await db.query("DELETE FROM claim_sessions WHERE id=$1",[foreignClaim]);
    });
    await test("A document nobody has claimed is surfaced with one question, and answering it is one click",async()=>{
      const fixture=await seedReviewFixture(1);
      const orphan=uuid(701400);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,document_authority,processing_status,original_filename,storage_key) VALUES($1,$2,$3,'Example Insurer','Household Shield Plan','ORPHAN-1','Personal Accident','policy_wording',60,'ready','shield-booklet.pdf','shield-booklet.pdf')",
        [orphan,account,people[0].id]);
      const before=await (await getDashboard(new Request("http://localhost/api/dashboard"))).json();
      const listed=before.unclaimed.find((doc:{id:string})=>doc.id===orphan);
      assert.ok(listed,"An uploaded document with no owner is invisible everywhere else");
      assert.equal(listed.product_name,"Household Shield Plan");
      assert.ok(before.reminders.some((r:{title:string})=>/whose/i.test(r.title)),"It is on the to-do list, not only in a list of documents");
      assert.equal(before.unclaimed.some((doc:{id:string})=>doc.id===fixture.referenceId),false,"A document that already has an owner is not asked about again");
      // The person says whose it is. That is the whole interaction.
      const linked=await linkPerson(new Request("http://localhost/api/policies/link-person",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({policyId:orphan,familyMemberId:people[1].id,declared:true})}));
      assert.equal(linked.status,200);
      const after=await (await getDashboard(new Request("http://localhost/api/dashboard"))).json();
      assert.equal(after.unclaimed.some((doc:{id:string})=>doc.id===orphan),false);
      assert.equal(after.reminders.some((r:{title:string})=>/whose/i.test(r.title)),false,"Answered questions leave the to-do list");
      assert.equal((await db.query("SELECT source FROM policy_members WHERE policy_id=$1",[orphan])).rows.length,1);
      await db.query("DELETE FROM policies WHERE id=$1",[orphan]);
    });
    await test("Another account's unclaimed documents are never asked about here",async()=>{
      await seedReviewFixture(1);
      const foreignOrphan=uuid(701500);
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,document_authority,processing_status,original_filename,storage_key) VALUES($1,$2,$3,'Other Insurer','Other Booklet','OTHER-2','Personal Accident','policy_wording',60,'ready','other-booklet.pdf','other-booklet.pdf')",
        [foreignOrphan,foreign,foreignPerson]);
      const data=await (await getDashboard(new Request("http://localhost/api/dashboard"))).json();
      assert.equal(data.unclaimed.some((doc:{id:string})=>doc.id===foreignOrphan),false);
      await db.query("DELETE FROM policies WHERE id=$1",[foreignOrphan]);
    });
    await test("A document uploaded before DearPolicy could read schedules is offered as a button, not a command",async()=>{
      const fixture=await seedReviewFixture(1);
      // What an install upgraded from an older version actually looks like.
      await db.query("UPDATE policies SET benefits_indexed_at=NULL WHERE account_id=$1",[account]);
      const listed=await (await getIndexStatus(new Request("http://localhost/api/benefits/index"))).json();
      assert.ok(listed.unread.length>=1,"A ready document with stored pages that has never been read is offered for reading");
      assert.ok(listed.unread.every((doc:{pages:number})=>doc.pages>0),"Only documents whose pages are already stored: reading them needs no PDF and no OCR");
      const first=await (await indexBenefits(new Request("http://localhost/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}))).json();
      assert.ok(first.stored>=0);
      assert.equal(typeof first.name,"string");
      // Reading is one document per request so the screen can show progress.
      let guard=0,remaining=first.remaining;
      while(remaining>0&&guard++<10)
        remaining=(await (await indexBenefits(new Request("http://localhost/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}))).json()).remaining;
      assert.equal(remaining,0,"Every document is read in the end");
      assert.equal((await (await getIndexStatus(new Request("http://localhost/api/benefits/index"))).json()).unread.length,0,"Nothing is left asking to be read");
      const catalog=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
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
      const response=await indexBenefits(new Request("http://localhost/api/benefits/index",{method:"POST",headers:{"content-type":"application/json"},
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
      const data=await (await getBenefits(new Request("http://localhost/api/benefits"))).json();
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
    await test("With nothing read yet, the chat says so at once instead of grinding through the PDFs",async()=>{
      await seedReviewFixture(12);
      await db.query("UPDATE policies SET benefits_indexed_at=NULL WHERE account_id=$1",[account]);
      const readsBefore=readingCalls;
      const started=Date.now();
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.equal(readingCalls-readsBefore,0,"Reading twelve sections to produce a partial answer helps nobody");
      assert.ok(Date.now()-started<4000,"It must come back immediately, not after minutes");
      assert.match(answer.summary,/have not read your policy documents yet/);
      assert.ok(answer.nextSteps.some(step=>/Benefits page/.test(step)&&/Read them now/.test(step)),
        "It names the one button that fixes this: "+answer.nextSteps.join(" / "));
      const everything=[answer.summary,...answer.details,...answer.nextSteps].join(" ");
      for(const leak of ["RAG_","policies:index","npm run","benefits_indexed_at"])
        assert.equal(everything.includes(leak),false,"A person holding a policy document should never be shown: "+leak);
      assert.equal(answer.claimItems.length,0,"It claims nothing it has not read");
      // Once the documents are read, the same question is answered from them.
      const fixture=await db.query<{id:string}>("SELECT id FROM policies WHERE account_id=$1 AND document_role='policy_wording'",[account]);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.rows[0].id,"Review Fixture Critical Illness"]);
      const after=(await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id)).data.answer as ChatAnswer;
      assert.match(after.summary,/S\$350,000/);
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
      assert.match(ambulance.amountText??"",/S\$500/,"A reimbursement limit is still a figure the person can act on");
      const fracture=answer.claimItems.find(item=>/Fracture/.test(item.title))!;
      assert.equal(fracture.amountText,"S$1,250");
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
    await test("With a hosted reading model configured, documents are read there and chat stays local",async()=>{
      const fixture=await seedReviewFixture(3);
      const { catalogueDocument,documentPages }=await import("@/lib/policies/catalog-builder");
      const { loadBenefitCatalog }=await import("@/lib/policies/benefit-catalog");
      const pages=await documentPages(account,fixture.referenceId);
      const inner=globalThis.fetch;
      let groqCalls=0,throttled=false,ollamaReads=0,authHeader="";
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
              // A quote that is not on the page must be refused exactly as it is for the local model.
              {name:"Invented Benefit",quote:"We pay S$999,999 on request.",formulaKind:"fixed",formulaValue:999999,currency:"SGD",factKey:null,offsetDays:null,maximumDays:null,conditions:[]}]
            :[];
          return Response.json({choices:[{message:{content:JSON.stringify({benefits})},finish_reason:"stop"}]});
        }
        if(url.endsWith("/api/chat"))ollamaReads++;
        return inner(input,init);
      }) as typeof fetch;
      process.env.READING_MODEL_PROVIDER="groq";process.env.GROQ_API_KEY="test-key";
      try{
        const stored=await catalogueDocument({accountId:account,policyId:fixture.referenceId,productName:"Review Fixture Critical Illness",pages});
        assert.ok(groqCalls>=pages.length+1,"Every page went to the hosted reader, and the throttled page was retried");
        assert.equal(ollamaReads,0,"The local model was not used for reading");
        assert.equal(authHeader,"Bearer test-key");
        assert.equal(stored,1,"The invented quote was refused; only the real rule was stored");
        const catalog=await loadBenefitCatalog(account,[fixture.referenceId]);
        assert.deepEqual(catalog.map(b=>b.benefitName),["Major Critical Illness"]);
        // Asking a question still runs on the local model.
        const readsBefore=explanationCalls;
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        assert.equal((data.answer as ChatAnswer).claimItems[0]?.amountText,"S$350,000");
        assert.equal(explanationCalls-readsBefore,1,"Chat narration stays on the local model");
      }finally{
        delete process.env.READING_MODEL_PROVIDER;delete process.env.GROQ_API_KEY;globalThis.fetch=inner;
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
      const candidates=one.details.find(detail=>detail.startsWith("Benefits that may respond"))??"";
      assert.equal(/Ambulance|Accidental/.test(candidates),false,"Dengue is an illness; accident-only benefits are not candidates: "+candidates);
      assert.match(candidates,/Daily Hospital Cash/);
      // …and the person is told why, rather than left to wonder whether they were missed.
      const excluded=one.details.find(detail=>detail.startsWith("Not applicable here"))??"";
      assert.match(excluded,/Ambulance Cost/);
      assert.match(excluded,/only for an accident, and this was an illness/);
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
      assert.equal(three.claimItems[0].amountText,"S$120.00","4 nights × S$30, from the stored rule");
      assert.equal(three.potentialPayoutTotals?.[0]?.amountText,"S$120.00");
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
      assert.equal(two.claimItems[0]?.amountText,"S$250.00");
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
      assert.ok(answer.claimItems.some(item=>item.title.includes("Death benefit")&&item.amountText==="S$350,000"),"The death benefit is found in the wording: "+answer.claimItems.map(i=>i.title+" "+i.amountText).join(" | "));
      assert.doesNotMatch(answer.summary,/None of the benefit rules on file respond/,"An empty rule list is not a verdict");
      assert.ok(answer.details.some(d=>/Coverage Ledger/.test(d)),"…because the sentence was read into the ledger: "+answer.details.join(" / "));
    });
    await test("A certificate's schedule lines answer a death on their own when no rule on file responds",async()=>{
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
      const titles=whatIf.claimItems.map(item=>item.title+" "+item.amountText);
      assert.ok(titles.some(t=>/Group Term Life.*S\$1,000,000/.test(t)),"The life sum assured responds to a death: "+titles.join(" | "));
      assert.ok(titles.some(t=>/Group Personal Accident.*S\$600,000/.test(t)),"…and the PA sum insured to an accidental death: "+titles.join(" | "));
      assert.ok(!titles.some(t=>/Living Care/.test(t)),"A critical illness plan does not respond to a death: "+titles.join(" | "));
      assert.equal(whatIf.potentialPayoutTotals?.[0]?.amountText,"S$1,600,000");
      assert.ok(whatIf.claimItems.every(item=>item.estimateBasis==="estimated"&&/standard rule/.test(item.reason)),"Each figure says it assumes the standard rule until the wording is read");
      // The same schedule answers a reported death whose cause is not yet known.
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Accidental Hospital Recuperation Benefit',ARRAY['accident','hospitalisation']::text[],ARRAY['accident']::text[],'fixed',250,'SGD',13,'Accidental Hospital Recuperation Benefit S$250','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const reported=(await send("Desmond was murdered in Thailand",people[0].id)).data.answer as ChatAnswer;
      assert.equal(reported.mode,"claim_assessment",reported.summary);
      const life=reported.claimItems.find(item=>/Group Term Life/.test(item.title));
      const pa=reported.claimItems.find(item=>/Group Personal Accident/.test(item.title));
      assert.equal(life?.amountText,"S$1,000,000");
      assert.equal(pa?.amountText,"S$600,000");
      // A homicide is sudden, external and violent — what a PA plan means by an accident — so it is not asked.
      console.log("DEBUG",JSON.stringify({life,summary:reported.summary,details:reported.details}).slice(0,2500));
      assert.ok(life?.conditions.some(c=>/Assumes the standard rule/.test(c)),"An assumed ledger row says so: "+life?.conditions.join(" / "));
      assert.match(reported.summary,/S\$1,600,000/);
      assert.ok(reported.claimSessionId,"…and the claim is on record with a pack to print");
    });
    await test("The Coverage Ledger: confirming a row makes the answer exact, rejecting removes it, and a row you add counts",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,'Group Term Life',1000000,'SGD','MINDEF Group Insurance',2,'Group Term Life S$1,000,000',true,true)",
        [uuid(700520),account,fixture.policyId,people[0].id]);
      // The page lists what was read, marked as proposed.
      const listed=await (await getLedger(new Request("http://localhost/api/ledger?familyMemberId="+people[0].id))).json();
      type LRow={id:string;eventType:string;status:string;pays:string;planName:string;origin:string};
      const life=(listed.rows as LRow[]).find(r=>r.eventType==="death"&&/Group Term Life/.test(r.planName));
      assert.ok(life,"The certificate's life cover is a ledger row: "+JSON.stringify(listed.rows.map((r:LRow)=>r.planName+"/"+r.eventType)));
      assert.equal(life!.status,"proposed");assert.match(life!.pays,/S\$1,000,000 lump sum/);
      const tpd=(listed.rows as LRow[]).find(r=>r.eventType==="tpd"&&/Group Term Life/.test(r.planName));
      assert.ok(tpd,"…with the standard companion rows for that kind of plan");
      // Before confirmation the answer is an estimate; after, it is confirmed.
      const before=(await send("Desmond was murdered in Thailand",people[0].id)).data.answer as ChatAnswer;
      const beforeItem=before.claimItems.find(i=>/Group Term Life/.test(i.title));
      assert.equal(beforeItem?.estimateBasis,"estimated");assert.equal(beforeItem?.status,"potentially_applicable");
      const confirmed=await patchLedger(new Request("http://localhost/api/ledger",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:life!.id,status:"confirmed"})}));
      assert.equal(confirmed.status,200);
      // The person says the plan has no TPD cover; the row is gone from answers.
      await patchLedger(new Request("http://localhost/api/ledger",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:tpd!.id,status:"rejected"})}));
      // And DPS, which no document states, is entered by hand.
      const added=await (await postLedger(new Request("http://localhost/api/ledger",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({familyMemberId:people[0].id,planName:"DPS",eventType:"death",paysKind:"lump_sum",amount:70000})}))).json();
      assert.equal(added.row.status,"confirmed");
      const after=(await send("Desmond was murdered in Thailand",people[0].id)).data.answer as ChatAnswer;
      const afterItem=after.claimItems.find(i=>/Group Term Life/.test(i.title));
      assert.equal(afterItem?.estimateBasis,"confirmed");assert.equal(afterItem?.status,"likely_applicable");
      assert.ok(after.claimItems.some(i=>/DPS/.test(i.title)&&i.amountText==="S$70,000"),"A row entered by the person is answered from: "+after.claimItems.map(i=>i.title).join(" | "));
      assert.equal(after.potentialPayoutTotals?.[0]?.amountText,"S$1,070,000");
      const again=await (await getLedger(new Request("http://localhost/api/ledger?familyMemberId="+people[0].id))).json();
      assert.equal((again.rows as LRow[]).some(r=>r.id===tpd!.id),false,"A rejected row is not shown");
      // Re-seeding after a new upload adds nothing twice and never touches a confirmed row.
      const rebuilt=await (await postLedger(new Request("http://localhost/api/ledger",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"rebuild"})}))).json();
      assert.equal(rebuilt.added,0);
      const still=await (await getLedger(new Request("http://localhost/api/ledger?familyMemberId="+people[0].id))).json();
      assert.equal((still.rows as LRow[]).find(r=>r.id===life!.id)?.status,"confirmed");
      // Another account's rows are never visible or editable.
      const foreignRow=await db.query<{id:string}>("INSERT INTO coverage_rules(account_id,family_member_id,plan_name,event_type,pays_kind,amount,origin) VALUES($1,$2,'Other Plan','death','lump_sum',5,'person') RETURNING id",[foreign,foreignPerson]);
      const denied=await patchLedger(new Request("http://localhost/api/ledger",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:foreignRow.rows[0].id,status:"confirmed"})}));
      assert.equal(denied.status,404);
      assert.equal((still.rows as LRow[]).some(r=>r.planName==="Other Plan"),false);
    });
    await test("An assessment from the stored rules leaves a claim on record, with a pack to print",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
      const answer=data.answer as ChatAnswer;
      assert.ok(answer.claimSessionId,"The claim is on record");
      assert.ok(answer.nextSteps.some(step=>/claim pack/i.test(step)),"The last thing said is what to do next: "+answer.nextSteps.join(" / "));
      assert.ok(answer.nextSteps.some(step=>/Gather:/.test(step)&&/medical report/i.test(step)),"…and what to gather follows the event: "+answer.nextSteps.join(" / "));
      const pack=await getClaimPack(new Request("http://localhost/api/claims/"+answer.claimSessionId+"/pack"),{params:Promise.resolve({id:answer.claimSessionId!})});
      assert.equal(pack.status,200,"The pack can be printed straight from a chat answer");
      const { extractPdfPages }=await import("@/lib/documents/pdf");
      const printed=(await extractPdfPages(new Uint8Array(await pack.arrayBuffer()))).map(page=>page.text).join(" ").replace(/\s+/g," ");
      assert.match(printed,/S\$350,000/);
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
      const candidates=one.details.find(d=>d.startsWith("Benefits that may respond"))??"";
      assert.equal(/Cancer|Day surgery/.test(candidates),false,"Rows the reader ruled out are not even named as candidates: "+candidates);
      assert.match(candidates,/Daily Hospital Cash/);
      const excluded=one.details.find(d=>d.startsWith("Not applicable here"))??"";
      assert.match(excluded,/Cancer drug services/);
      assert.match(excluded,/not a treatment for dengue/,"…and the reader's reason is shown: "+excluded);
      // Facts given in passing are heard: "no ambulance" ends the ambulance question for good.
      const second=(await send("Yes",people[0].id,first.answer.conversationId,first.answer.conversationRevision)).data;
      const third=(await send("3 nights, no ambulance, we took a taxi",people[0].id,second.answer.conversationId,second.answer.conversationRevision)).data;
      const three=third.answer as ChatAnswer;
      assert.equal(three.questions.some(q=>/ambulance/i.test(q.text)),false,"Never ask about a charge for something that did not happen: "+JSON.stringify(three.questions));
      assert.equal(three.questions.some(q=>/maximum number of days|not stated in the row/i.test(q.text)),false,"Internal notes are never asked as questions");
      const titles=three.claimItems.map(i=>i.title).join(" | ");
      assert.equal(/Ambulance|Cancer|Day surgery/.test(titles),false,titles);
      assert.match(titles,/Daily Hospital Cash/);
      assert.equal(three.claimItems[0].amountText,"S$90.00");
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
      assert.ok(after.byRole.some(r=>r.role==="narration"),"Wording the answer is narration work");
      assert.equal(after.costUsd,before.costUsd,"Local calls cost nothing but are still counted");
      assert.equal(after.plan.priceUsd,4.99);
      assert.ok(after.chatTurns>=1,"Questions are counted against the plan's allowance");
    });
    await test("A household past its spend limit is stopped before the next hosted call, in plain words",async()=>{
      const { assertUnderSpendCap,SpendCapReached }=await import("@/lib/ai/ledger");
      const { readableModelFailure }=await import("@/lib/ai/llm");
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
      let anthropicCalls=0,ollamaCalls=0;const modelsUsed=new Set<string>();let cached=false;
      globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(url.startsWith("https://api.anthropic.com/v1/messages")){
          anthropicCalls++;
          const body=JSON.parse(String(init?.body));
          modelsUsed.add(body.model);
          assert.equal((init?.headers as Record<string,string>)["x-api-key"],"sk-ant-test");
          cached=cached||body.system?.[0]?.cache_control?.type==="ephemeral";
          const system=String(body.system[0].text),user=JSON.parse(body.messages[0].content);
          // Reuse the simulated local model's answers by replaying the request through it.
          const replay=await inner("http://127.0.0.1:11434/api/chat",{method:"POST",body:JSON.stringify({options:{num_ctx:4096},keep_alive:0,
            messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(user)}]})});
          const content=(await replay.json()).message.content;
          return Response.json({content:[{type:"text",text:content}],stop_reason:"end_turn",usage:{input_tokens:1200,output_tokens:90,cache_read_input_tokens:800}});
        }
        if(/127\.0\.0\.1:11434/.test(url))ollamaCalls++;
        return inner(input,init);
      }) as typeof fetch;
      process.env.MODEL_PRESET="anthropic";process.env.ANTHROPIC_API_KEY="sk-ant-test";
      const savedModel=process.env.LLM_MODEL;delete process.env.LLM_MODEL;
      try{
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        const answer=data.answer as ChatAnswer;
        assert.equal(answer.claimItems[0]?.amountText,"S$350,000","The claim is answered");
        assert.ok(anthropicCalls>=2,"Interpretation, relevance and narration went to Claude");
        assert.equal(ollamaCalls,0,"Nothing touched Ollama — not a model call, not an unload");
        assert.ok(modelsUsed.has("claude-sonnet-5"),"Judgement on the mid tier: "+[...modelsUsed].join(","));
        assert.ok(cached,"The system prompt is marked for prompt caching");
        const { usageThisMonth }=await import("@/lib/ai/ledger");
        const usage=await usageThisMonth(account);
        assert.ok(usage.costUsd>0,"Hosted calls are priced on the ledger");
        assert.ok(usage.byRole.some(r=>r.role==="judgement"&&r.costUsd>0));
      }finally{
        delete process.env.MODEL_PRESET;delete process.env.ANTHROPIC_API_KEY;if(savedModel)process.env.LLM_MODEL=savedModel;globalThis.fetch=inner;
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
      let googleCalls=0,ollamaCalls=0;const hosts=new Set<string>();
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
          const replay=await inner("http://127.0.0.1:11434/api/chat",{method:"POST",body:JSON.stringify({options:{num_ctx:4096},keep_alive:0,
            messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(user)}]})});
          const content=(await replay.json()).message.content;
          return Response.json({candidates:[{content:{parts:[{text:content}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:900,candidatesTokenCount:80}});
        }
        if(/127\.0\.0\.1:11434/.test(url))ollamaCalls++;
        return inner(input,init);
      }) as typeof fetch;
      process.env.MODEL_PRESET="gemini";process.env.GEMINI_API_KEY="AQ.test-key";
      const savedModel=process.env.LLM_MODEL;delete process.env.LLM_MODEL;
      try{
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        assert.equal((data.answer as ChatAnswer).claimItems[0]?.amountText,"S$350,000");
        assert.ok(googleCalls>=2);assert.equal(ollamaCalls,0);
        assert.deepEqual([...hosts],["generativelanguage.googleapis.com"],"The Gemini API by default");
      }finally{
        delete process.env.MODEL_PRESET;delete process.env.GEMINI_API_KEY;if(savedModel)process.env.LLM_MODEL=savedModel;globalThis.fetch=inner;
        await db.query("DELETE FROM model_usage WHERE account_id=$1 AND provider='gemini'",[account]);
      }
    });
    await test("A judgement call rate-limited on Google's pricier tier falls back to the cheaper tier instead of failing the chat",async()=>{
      const fixture=await seedReviewFixture(1);
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',7,'We pay 100% of the Sum Insured for a qualifying critical illness.','[]'::jsonb,'[]'::jsonb,false)",
        [account,fixture.referenceId,"Review Fixture Critical Illness"]);
      const inner=globalThis.fetch;
      let flashCalls=0,flashLiteCalls=0,ollamaCalls=0;
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
          const replay=await inner("http://127.0.0.1:11434/api/chat",{method:"POST",body:JSON.stringify({options:{num_ctx:4096},keep_alive:0,
            messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(user)}]})});
          const content=(await replay.json()).message.content;
          return Response.json({candidates:[{content:{parts:[{text:content}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:900,candidatesTokenCount:80}});
        }
        if(/127\.0\.0\.1:11434/.test(url))ollamaCalls++;
        return inner(input,init);
      }) as typeof fetch;
      process.env.MODEL_PRESET="gemini";process.env.GEMINI_API_KEY="AQ.test-key";
      const savedModel=process.env.LLM_MODEL;delete process.env.LLM_MODEL;
      try{
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        assert.equal((data.answer as ChatAnswer).claimItems[0]?.amountText,"S$350,000","The chat still produced the right answer despite the pricier tier being down");
        assert.ok(flashCalls>=1,"The primary judgement tier was tried first");
        assert.ok(flashLiteCalls>=1,"...and every judgement call fell back to the tier that is not rate-limited");
        assert.equal(ollamaCalls,0,"Fully hosted -- the local model is never touched as a fallback");
        const usage=(await db.query("SELECT model,ok FROM model_usage WHERE account_id=$1 AND role='judgement' ORDER BY at",[account])).rows as {model:string;ok:boolean}[];
        assert.ok(usage.some(r=>r.model==="flash"&&r.ok===false),"The failed attempt on the primary model is on the ledger, not silently dropped: "+JSON.stringify(usage));
        assert.ok(usage.some(r=>r.model==="flash-lite"&&r.ok===true),"...and the successful fallback attempt is billed under the model that actually ran: "+JSON.stringify(usage));
      }finally{
        delete process.env.MODEL_PRESET;delete process.env.GEMINI_API_KEY;if(savedModel)process.env.LLM_MODEL=savedModel;globalThis.fetch=inner;
        await db.query("DELETE FROM model_usage WHERE account_id=$1 AND provider='gemini'",[account]);
      }
    });
    await test("Several reading windows restating the same \'no coverage\' conclusion collapse into one detail, not several near-duplicates",async()=>{
      await seedReviewFixture(40);
      const inner=globalThis.fetch;
      let readingWindowCalls=0;
      globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
        const url=String(input);
        if(!url.endsWith("/api/chat"))return inner(input,init);
        const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content);
        if(!system.startsWith("Read insurance"))return inner(input,init);
        readingWindowCalls++;
        const user=JSON.parse(body.messages[1].content),source=user.sources[0],quote=String(source.text).slice(0,40);
        // Independent reading windows over the same undershot section, worded
        // differently the way a real model varies its phrasing window to window.
        const restatements=["This contract does not contain a critical illness benefit for this diagnosis.",
          "The policy wording does not include any relevant benefit here.","These pages do not provide coverage for the reported event."];
        const text=readingWindowCalls<=3?restatements[readingWindowCalls-1]:
          "This particular passage raises an unrelated administrative point, not a coverage conclusion.";
        return Response.json({message:{content:JSON.stringify({benefits:[],observations:[{text,evidence:[{sourceId:source.id,quote}]}],nextSteps:[]})}});
      }) as typeof fetch;
      try{
        const {data}=await send("I was diagnosed with stage 2 breast cancer. What can I claim?",people[0].id);
        const answer=data.answer as ChatAnswer;
        assert.ok(readingWindowCalls>=4,"The fixture\'s 40 wording pages must span more than one reading window: "+readingWindowCalls);
        const restatementLines=answer.details.filter(d=>/\b(?:do|does) not (?:contain|include|cover|provide)\b/i.test(d));
        assert.equal(restatementLines.length,1,"Every window\'s restatement of the same \'no coverage\' conclusion collapses into a single detail line, not one per window: "+JSON.stringify(answer.details));
        assert.ok(answer.details.some(d=>/unrelated administrative point/.test(d)),"A genuinely distinct observation for the same contract is still preserved: "+JSON.stringify(answer.details));
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
      const answer=data.answer as ChatAnswer;
      const cards=answer.claimItems.map(item=>item.title+"="+item.amountText);
      assert.equal(answer.claimItems.length,1,"One fracture benefit, not two versions of it: "+cards.join(" | "));
      assert.equal(answer.claimItems[0].amountText,"S$1,250","The printed S$5,000 limit wins over a percentage of the whole sum insured");
      assert.equal(answer.claimItems[0].estimateBasis,"indicative","…and it is still marked as read from a heading");
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

import assert from "node:assert/strict";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as T from "./fixtures/reliable-chat/tan";
import { conflictingTurns } from "./fixtures/reliable-chat/conflicting-conversations";
import { uniqueSteps } from "@/components/next-steps";
process.env.DEARPOLICY_CHAT_CONTRACT="benefits";
setEnv(T as any);
async function main() {
 const h=await startHarness(T as any);
 process.env.DEARPOLICY_RAG_LOOP="1";
 const {installLoopModel}=await import("@/lib/rag2/loop/model");
 const {ScriptedLoopModel}=await import("@/lib/rag2/loop/scripted-model");
 const {recomputeCalculation}=await import("@/lib/claims/calc-record");
 let checks=0;
 try {
  for(const first of [
   "Jun fractured his shin and thigh in a fall. What could the fracture benefit pay?",
   "Jun fractured his tibia or femur in a fall. We are not sure which.",
   "Jun has no thigh fracture after a fall. What could the fracture benefit pay?"
  ]) {
   const turns=conflictingTurns(first);
   installLoopModel(new ScriptedLoopModel(turns));
   let conv:{id?:string;rev?:number}={};
   for(let i=0;i<turns.length;i++){
    const a=await h.send(String(turns[i].user),conv);conv={id:a.conversationId,rev:a.conversationRevision};
    const s=await h.savedAnswer(conv.id!);
    const visible=[s.answer.summary,...(s.answer.details??[]),...(s.answer.questions??[]).map((q:any)=>q.text),...uniqueSteps(s.answer.nextSteps)].filter(Boolean).join("\n");
    const calls=s.state.ragLoop.turns.at(-1).toolCalls??[];
    if(i===0){
     assert.equal((s.answer.calculations??[]).length,0,"conflict must save no calculation");
     assert.doesNotMatch(visible,/illustration is S\$/,"conflict must show no illustration");
     if(!/Which bone should I use for this illustration/.test(visible)) console.error(JSON.stringify(calls,null,2));
     assert.match(visible,/Which bone should I use for this illustration/);
     assert.ok(calls.some((c:any)=>c.name==="evaluate_benefit"&&c.ok));
     assert.match(calls.find((c:any)=>c.name==="evaluate_benefit")?.summary ?? "",/case_conflict/,"a valid option cannot override conflicting reported facts");
    }else{
     assert.match(visible,/S\$10,000/,"correction must restore the shin illustration");
     assert.doesNotMatch(visible,/illustration is S\$20,000/);
     assert.equal((s.answer.questions??[]).length,0,"settled injury must not be asked again");
     assert.equal((s.answer.calculations??[]).length,1);
     const re=recomputeCalculation(s.answer.calculations![0]);
     assert.ok(re.ok);if(re.ok) assert.equal(re.resultMinor,1000000);
    }
    assert.deepEqual(a.calculations??[],s.answer.calculations??[],"returned calculations equal saved");
    console.log("PASS",i===0?"unresolved":"corrected",first,visible);
    checks++;
   }
  }
  assert.equal(h.networkCalls.length,0);
  console.log(checks+" route turns passed; no external calls");
 } finally {installLoopModel(null);await h.db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});


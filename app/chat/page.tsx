"use client";

import { FormEvent,Suspense,useEffect,useRef,useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ChatAnswer,ClaimItem } from "@/types";
import { POLICY_STATED_LIMIT_LABEL,POLICY_STATED_LIMIT_NOTICE,PRELIMINARY_ASSESSMENT_NOTICE } from "@/lib/chat/monetary-boundary";
import { formatMoney } from "@/lib/format/currency";

type Member={id:string;display_name:string;relationship:string;policy_count:number};
type Message={id?:string;role:"user"|"assistant";content:string;answer?:ChatAnswer;error?:string};
type SavedChat={id:string;family_member_id:string|null;title:string;updated_at:string;revision:string};
const factFindingStatusCopy:Record<NonNullable<ChatAnswer["factFinding"]>[number]["status"],string>={
  information_needed:"Information needed",evidence_needed:"Evidence needed",reviewer_assessment_needed:"Reviewer assessment needed",
  policy_condition_unresolved:"Policy condition unresolved",ready_for_evidence_gated_estimate:"Ready for an evidence-based estimate",
};
const preliminaryStatusCopy:Record<NonNullable<ClaimItem["preliminaryStatus"]>,string>={information_needed:"Information needed",evidence_needed:"Evidence needed",reviewer_assessment_needed:"Reviewer assessment needed",policy_condition_unresolved:"Policy condition unresolved",not_applicable:"Not applicable"};
const statusCopy:Record<ClaimItem["status"],string>={likely_applicable:"Likely applicable",potentially_applicable:"Potentially applicable",not_applicable:"Not applicable",needs_document:"Needs checking"};
const reviewCopy:Record<string,string>={searched:"Retrieved sections checked",missing_wording:"Matching wording needed",not_ready:"Document processing",no_matching_section:"No match in retrieved sections",needs_review:"Further review needed"};
const completenessCopy:Record<string,string>={full_text_reviewed:"All processed pages read",partial_retrieval:"Part of the document read",no_wording:"No matching wording uploaded",not_processed:"Still processing"};
function coverageText(coverage?:{pagesRead:number;pagesTotal:number;passagesRead:number;passagesTotal:number;completeness:string}){
  if(!coverage)return "Not measured";
  return (completenessCopy[coverage.completeness]??coverage.completeness)+" · "+coverage.pagesRead+"/"+coverage.pagesTotal+" pages · "+coverage.passagesRead+"/"+coverage.passagesTotal+" passages";
}

function ChatContent(){
  const params=useSearchParams();
  const [family,setFamily]=useState<Member[]>([]);
  const [memberId,setMemberId]=useState(params.get("member")??"");
  const [question,setQuestion]=useState("");
  const [messages,setMessages]=useState<Message[]>([]);
  const [conversationId,setConversationId]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const [history,setHistory]=useState<SavedChat[]>([]);
  const [historyCursor,setHistoryCursor]=useState<string|null>(null);
  const [messageCursor,setMessageCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("Reading your message…");
  const [progressDetail,setProgressDetail]=useState<{completed:number;total:number}|null>(null);
  const [elapsed,setElapsed]=useState(0);
  const [error,setError]=useState("");
  const [historyError,setHistoryError]=useState("");
  const [confirmDeleteChatId,setConfirmDeleteChatId]=useState<string|null>(null);
  const [confirmClearHistory,setConfirmClearHistory]=useState(false);
  const requestVersion=useRef(0);
  const controller=useRef<AbortController|null>(null);
  const jobId=useRef<string|null>(null);
  const end=useRef<HTMLDivElement|null>(null);
  // Reading a real policy takes real time on a local GPU, so the indicator has
  // to keep moving and show what stage it is at rather than looking frozen.
  useEffect(()=>{
    if(!busy){setElapsed(0);return;}
    setElapsed(0);
    const started=Date.now();
    const timer=setInterval(()=>setElapsed(Math.round((Date.now()-started)/1000)),1000);
    return ()=>clearInterval(timer);
  },[busy]);
  async function refreshHistory(cursor?:string|null){
    const response=await fetch("/api/chat/history?scope=all"+(cursor?"&cursor="+cursor:""));
    const data=await response.json();
    if(!response.ok)throw new Error(data.error??"Could not load chat history");
    setHistory(previous=>cursor?[...previous,...data.conversations]:data.conversations);
    setHistoryCursor(data.nextCursor??null);
  }
  function stopLocal(){
    requestVersion.current++;controller.current?.abort();controller.current=null;
    const running=jobId.current;jobId.current=null;
    if(running)void fetch("/api/chat/jobs/"+running,{method:"DELETE"}).catch(()=>undefined);
    setBusy(false);
  }
  function reset(){
    stopLocal();setMessages([]);setConversationId(null);setRevision(0);setMessageCursor(null);setQuestion("");setError("");setMemberId("");
  }
  function accept(answer:ChatAnswer,version:number){
    if(version!==requestVersion.current)return;
    if(answer.resolvedFamilyMemberId)setMemberId(answer.resolvedFamilyMemberId);
    setConversationId(answer.conversationId??null);setRevision(answer.conversationRevision??0);
    setMessages(previous=>[...previous,{role:"assistant",content:answer.summary,answer}]);
  }
  async function waitForJob(id:string,signal:AbortSignal,version:number):Promise<ChatAnswer>{
    jobId.current=id;
    for(;;){
      if(signal.aborted||version!==requestVersion.current)throw new DOMException("Cancelled","AbortError");
      const response=await fetch("/api/chat/jobs/"+id,{signal,cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"Could not read analysis progress");
      if(data.job.status==="complete"){jobId.current=null;return data.result.answer;}
      if(["failed","cancelled"].includes(data.job.status))throw new Error(data.job.error??"Analysis stopped");
      if(version===requestVersion.current){
        const p=data.job.progress;
        setProgress(p?.stage??"Waiting to read policy evidence");
        setProgressDetail(p?.total?{completed:p.completed,total:p.total}:null);
      }
      await new Promise<void>((resolve,reject)=>{
        const onAbort=()=>{clearTimeout(timer);signal.removeEventListener("abort",onAbort);reject(new DOMException("Cancelled","AbortError"));};
        const timer=setTimeout(()=>{signal.removeEventListener("abort",onAbort);resolve();},1000);
        signal.addEventListener("abort",onAbort,{once:true});
      });
    }
  }
  async function restore(id:string){
    stopLocal();const version=requestVersion.current;
    const abort=new AbortController();controller.current=abort;
    setBusy(true);setError("");setProgress("Opening saved chat…");setProgressDetail(null);
    try{
      const response=await fetch("/api/chat/history/"+id,{signal:abort.signal,cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"Could not open saved chat");
      if(version!==requestVersion.current)return;
      setConversationId(id);setRevision(data.conversation.revision);
      setMemberId(data.conversation.family_member_id??"");
      setMessageCursor(data.nextCursor??null);
      setMessages(data.messages.map((m:{id:string;role:Message["role"];content:string;answer_json?:ChatAnswer})=>({id:m.id,role:m.role,content:m.content,answer:m.answer_json??undefined})));
      if(data.pendingJob){
        // A job that was still running when the tab closed (or the app
        // restarted mid-analysis) needs to be shown as answered, failed, or
        // still in flight -- not silently re-added as a plain, unanswered
        // "You" bubble that looks identical to one nobody ever picked up.
        const pendingMessage:Message={role:"user",content:data.pendingJob.message};
        setMessages(previous=>[...previous,pendingMessage]);
        try{
          accept(await waitForJob(data.pendingJob.id,abort.signal,version),version);
        }catch(e){
          if(version===requestVersion.current&&!(e instanceof DOMException&&e.name==="AbortError")){
            const message=e instanceof Error?e.message:"Analysis stopped";
            setMessages(previous=>previous.map(m=>m===pendingMessage?{...m,error:message}:m));
          }
        }
      }
    }catch(e){if(version===requestVersion.current&&!(e instanceof DOMException&&e.name==="AbortError"))setError(e instanceof Error?e.message:"Could not open chat");}
    finally{if(version===requestVersion.current){setBusy(false);controller.current=null;}}
  }
  async function olderMessages(){
    if(!conversationId||!messageCursor||busy)return;
    const version=requestVersion.current;
    try{
      const response=await fetch("/api/chat/history/"+conversationId+"?cursor="+messageCursor);
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not load older messages");
      if(version!==requestVersion.current)return;
      setMessages(previous=>[...data.messages.map((m:{id:string;role:Message["role"];content:string;answer_json?:ChatAnswer})=>({id:m.id,role:m.role,content:m.content,answer:m.answer_json??undefined})),...previous]);
      setMessageCursor(data.nextCursor??null);
    }catch(e){setError(e instanceof Error?e.message:"Could not load messages");}
  }
  async function sendText(text:string,personChoiceId?:string){
    text=text.trim();if(!text||busy)return;
    const version=++requestVersion.current,abort=new AbortController();controller.current=abort;
    const userMessage:Message={role:"user",content:text};
    setMessages(previous=>[...previous,userMessage]);setQuestion("");setBusy(true);setError("");setProgress("Understanding your message…");setProgressDetail(null);
    try{
      const response=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},signal:abort.signal,
        body:JSON.stringify({familyMemberId:memberId||null,scope:memberId?"member":"family",
          question:text,conversationId,conversationRevision:conversationId?revision:undefined,asynchronous:true,
          timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,personChoiceId})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Chat failed");
      if(version!==requestVersion.current)return;
      setConversationId(data.conversationId);setRevision(data.conversationRevision);
      const resolved=data.familyMemberId??"";setMemberId(resolved);
      const answer=await waitForJob(data.jobId,abort.signal,version);accept(answer,version);
      if(version===requestVersion.current)await refreshHistory();
    }catch(e){
      // Marking the message itself -- instead of only a page-level banner --
      // is what stops a failed send from looking like a message that simply
      // never got a reply: the person can see exactly which of their
      // messages didn't go through, and why, right where they sent it.
      if(version===requestVersion.current&&!(e instanceof DOMException&&e.name==="AbortError")){
        const message=e instanceof Error?e.message:"Chat failed";
        setMessages(previous=>previous.map(m=>m===userMessage?{...m,error:message}:m));
      }
    }
    finally{if(version===requestVersion.current){jobId.current=null;setBusy(false);controller.current=null;}}
  }
  async function removeChat(id:string){
    // Inline arm-then-confirm avoids window.confirm()'s tab-freezing blocking
    // dialog (see the Delete button below) while keeping a deliberate second
    // click before anything irreversible happens.
    if(confirmDeleteChatId!==id){setConfirmDeleteChatId(id);return;}
    setConfirmDeleteChatId(null);
    if(id===conversationId)reset();
    try{
      const response=await fetch("/api/chat/history",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:id})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not delete chat");
      await refreshHistory();
    }catch(e){setHistoryError(e instanceof Error?e.message:"Could not delete chat");}
  }
  async function clearHistory(){
    if(!confirmClearHistory){setConfirmClearHistory(true);return;}
    setConfirmClearHistory(false);
    reset();setHistoryError("");
    try{
      const response=await fetch("/api/chat/history",{method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({scope:"all"})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not clear history");
      await refreshHistory();
    }catch(e){setHistoryError(e instanceof Error?e.message:"Could not clear history");}
  }
  useEffect(()=>{
    let live=true;
    fetch("/api/family").then(r=>r.json()).then(data=>{
      if(!live)return;const members=data.family??[];setFamily(members);
      const saved=params.get("conversation")??params.get("claim");if(saved)void restore(saved);
    }).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;controller.current?.abort();requestVersion.current++;};
  },[]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    const abort=new AbortController();
    fetch("/api/chat/history?scope=all",{signal:abort.signal,cache:"no-store"}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not load history");
      if(!abort.signal.aborted){setHistory(data.conversations);setHistoryCursor(data.nextCursor??null);setHistoryError("");}
    }).catch((e)=>{if(!abort.signal.aborted)setHistoryError(e instanceof Error?e.message:"Could not load your chat history.");});
    return()=>abort.abort();
  },[]);
  useEffect(()=>{end.current?.scrollIntoView({behavior:"smooth",block:"end"});},[messages,busy]);
  async function ask(event:FormEvent){event.preventDefault();await sendText(question);}
  const active=family.find(m=>m.id===memberId);

  return <div className="page chat-page">
    <header className="chat-header">
      <div><div className="eyebrow">ASK DEARPOLICY</div><h1>Your policies. Your questions.</h1><p className="lead">Ask about an event, a policy or your family’s plans. DearPolicy checks the uploaded evidence and keeps track of what is still unknown.</p></div>
      <div className="chat-head-actions"><div className="auto-context"><strong>Automatic family context</strong><span>{active?"Following "+active.display_name+" until you mention someone else":"Mention a name, relationship, “I”, or ask about the whole family"}</span></div><button className="button secondary compact" onClick={reset}>New chat</button></div>
    </header>
    <details className="chat-history"><summary>Previous chats · {history.length}{historyCursor?"+":""}</summary>
      <div className="history-actions"><button className="mini-button danger" disabled={!history.length} onClick={clearHistory}>{confirmClearHistory?"Confirm clear all":"Clear all chat history"}</button>{confirmClearHistory&&<button className="mini-button" onClick={()=>setConfirmClearHistory(false)}>Cancel</button>}</div>
      {!history.length?<p>No previous chats yet.</p>:<ul>{history.map(chat=><li key={chat.id}>
        <button className="history-open" disabled={busy} onClick={()=>void restore(chat.id)} aria-current={conversationId===chat.id?"true":undefined}>{chat.title}<small>{family.find(p=>p.id===chat.family_member_id)?.display_name??"Whole family"} · {new Date(chat.updated_at).toLocaleDateString()}</small></button>
        <button className="mini-button danger" onClick={()=>void removeChat(chat.id)} aria-label={"Delete chat: "+chat.title}>{confirmDeleteChatId===chat.id?"Confirm delete":"Delete"}</button>
        {confirmDeleteChatId===chat.id&&<button className="mini-button" onClick={()=>setConfirmDeleteChatId(null)}>Cancel</button>}
      </li>)}</ul>}
      {historyCursor?<button className="mini-button" onClick={()=>void refreshHistory(historyCursor).catch(()=>setHistoryError("Could not load more chats."))}>Load more chats</button>:null}
      {historyError?<p role="alert">{historyError}</p>:null}
    </details>
    <div className="chat-window" aria-live="polite">
      {!messages.length&&!busy?<div className="chat-empty"><img className="big-mark" src="/dearpolicy-logo.png" alt="DearPolicy" width={827} height={161} />
        <p>Just say who and what happened. DearPolicy resolves the person, follows the conversation, and checks that person’s uploaded policies.</p>
        <div className="prompt-grid">{["What policies does my family have?","What happens when my endowment plan matures?","My wife’s flight was delayed. Could any policy help?","Charmaine caught dengue. What can she claim?"].map(text=><button key={text} onClick={()=>setQuestion(text)}>{text}</button>)}</div>
      </div>:null}
      {messageCursor?<button className="mini-button" disabled={busy} onClick={()=>void olderMessages()}>Load older messages</button>:null}
      {messages.map((message,index)=><div className={"message "+message.role} key={message.id??index}>
        <div className="message-label">{message.role==="user"?"You":"DearPolicy"}</div><div className="message-body"><p>{message.content}</p>
          {message.answer?.knownFacts.length?<div className="known-facts"><strong>Facts and uncertainties</strong><div>{message.answer.knownFacts.map((f,i)=><span key={i}>{f}</span>)}</div></div>:null}
          {message.answer?.scenarioClassifications?.length?<div className="scenario-check"><strong>What DearPolicy is checking against</strong><small>These guide which policy wording is matched; the wording and your evidence decide what you can actually claim.</small><div>{message.answer.scenarioClassifications.map((s,i)=>{const extra=s.traits.map(t=>t.replaceAll("_"," ")).filter(t=>t.toLowerCase()!==s.label.toLowerCase());return<span key={i}><b>{s.label}</b>{extra.length?" · "+extra.join(" · "):""}</span>;})}</div></div>:null}
          {message.answer?.questions.map(q=><div className="fact-question" key={q.id}><div className="question-label">A fact that changes this assessment</div><strong>{q.text}</strong><small>{q.why}</small>
            <div className="quick-replies">{q.id==="claim_person"?message.answer?.personCandidates?.map(p=><button key={p.id} disabled={busy||index!==messages.length-1} onClick={()=>void sendText(p.label,p.id)}>{p.label}</button>):q.options?.map(option=><button key={option} disabled={busy||index!==messages.length-1} onClick={()=>void sendText(option)}>{option}</button>)}</div>
          </div>)}
          {message.answer?.assessmentKind==="preliminary"?<div className="preliminary-assessment" data-testid="preliminary-assessment"><small>Preliminary claim assessment</small><p>{PRELIMINARY_ASSESSMENT_NOTICE}</p></div>:null}
          {message.answer?.factFinding?.length?<div className="fact-finding" data-testid="fact-finding"><small>What DearPolicy still needs</small>{message.answer.factFinding.map((plan,i)=><div className="fact-finding-plan" key={i} data-status={plan.status}>
            <strong>{plan.subjectName?plan.subjectName+" · ":""}{plan.label}</strong> <span className="fact-finding-status">{factFindingStatusCopy[plan.status]}</span>
            {plan.nextQuestions.length?<ul className="fact-finding-questions">{plan.nextQuestions.map(q=><li key={q.id}>{q.text}</li>)}</ul>:null}
            {plan.missingDocuments.length?<p className="fact-finding-documents">Documents: {plan.missingDocuments.join("; ")}</p>:null}
            {plan.reviewerRequirements.length?<p className="fact-finding-reviewers">{plan.reviewerRequirements.join("; ")}</p>:null}
            {plan.reportedAmountsIgnored.length?<p className="fact-finding-reported">Any amount you mentioned is recorded as you reported it. It is not used as your cover or to work out a claim.</p>:null}
          </div>)}</div>:null}
          {message.answer?.policyStatedLimits?.length?<div className="policy-stated-limits" data-testid="policy-stated-limits">{message.answer.policyStatedLimits.map((limit,i)=><div className="policy-stated-limit" key={i}>
            <small>{POLICY_STATED_LIMIT_LABEL}</small><strong>{limit.amountText}</strong><span>{limit.ownerName?limit.ownerName+" · ":""}{limit.benefitTitle}</span>
            <p>{POLICY_STATED_LIMIT_NOTICE}</p><em>From {limit.citation.policyName}, page {limit.citation.pageStart}: “{limit.quote.length>200?limit.quote.slice(0,197)+"…":limit.quote}”</em>
          </div>)}</div>:null}
          {message.answer?.claimItems.length?<div className="claim-results">{message.answer.claimItems.map((item,i)=><div className={"claim-result "+item.status} key={i}>
            <div className="claim-result-head"><strong>{item.title}</strong><span>{statusCopy[item.status]}</span></div>{item.preliminaryStatus?<span className="preliminary-status">{preliminaryStatusCopy[item.preliminaryStatus]}</span>:null}<p>{item.reason}</p>
            {item.conditions.length?<details className="claim-conditions"><summary>{item.conditions.length===1?"1 condition":item.conditions.length+" conditions"}</summary><ul>{item.conditions.map((c,j)=><li key={j}>{c}</li>)}</ul></details>:null}
          </div>)}</div>:null}
          {message.answer?.composition?<div className="claim-composition">
            <div className="composition-totals"><small>Indicative estimate · from reviewed evidence · the insurer decides</small>
              <div>{message.answer.composition.totalsByCurrency.length?message.answer.composition.totalsByCurrency.map(t=><strong key={t.currency}>{t.amountText}</strong>):<strong>No amount calculated yet</strong>}</div>
              <p>{message.answer.composition.disclaimer}</p>
            </div>
            {message.answer.composition.policies.map(policy=><div className="composition-policy" key={policy.policyId}>
              <div className="composition-policy-head"><strong>{policy.policyLabel}</strong>{policy.subtotalsByCurrency.length?<span>{policy.subtotalsByCurrency.map(s=>s.amountText).join(" + ")}</span>:null}</div>
              {policy.benefits.map(b=><div className={"composition-benefit "+b.status} key={b.calculationId}>
                <div className="composition-benefit-head"><span>{b.benefitCategory}</span><strong>{b.status==="included"?b.payableAmountText:"—"}</strong><em>{b.status==="included"?"Included in total":b.status==="needs_document"?"Needs a document":b.status==="needs_review"?"Needs review":b.status==="excluded"?"Excluded":"Blocked"}</em></div>
                {b.status!=="included"&&b.blockedReasons.length?<p className="composition-blocked-reason">{b.blockedReasons.join(" ")}</p>:null}
                {b.deductionReferences.length||b.capReferences.some(c=>c.applied)?<details className="composition-why"><summary>Why this amount?</summary>
                  {b.rawAmount!==b.payableAmount?<p>Raw calculated amount before deductions: {b.rawAmount.toLocaleString()} {b.currency}</p>:null}
                  {b.deductionReferences.map((d,i)=><p key={i}>−{d.amountText} · {d.reason.replaceAll("_"," ")}</p>)}
                  {b.capReferences.filter(c=>c.applied).map((c,i)=><p key={i}>Capped by {c.label} ({c.scope}): {c.amountDeductedText} deducted, cap {c.amountText}</p>)}
                </details>:null}
                {b.evidenceReferences.length?<div className="composition-evidence">{b.evidenceReferences.map((e,i)=><span key={i}>{e.label??"Policy wording"} · page {e.pageStart}{e.pageEnd!==e.pageStart?"–"+e.pageEnd:""}</span>)}</div>:null}
              </div>)}
            </div>)}
            {message.answer.composition.alternativeGroups.length?<div className="composition-alternatives"><strong>Alternative benefits · policy pays only one</strong>{message.answer.composition.alternativeGroups.map(g=><ul key={g.compositionGroupId}>{g.benefits.map(b=><li key={b.calculationId}>{b.benefitCategory} — {b.status==="included"&&b.payableAmountText?b.payableAmountText:"not counted in any total"}{b.calculationId===g.selectedBenefitCalculationId?" · selected (higher amount)":" · not selected"}</li>)}</ul>)}</div>:null}
            {message.answer.composition.excludedBenefits.length?<details className="composition-excluded"><summary>Excluded or pending benefits · {message.answer.composition.excludedBenefits.length}</summary>{message.answer.composition.excludedBenefits.map(b=><div className="composition-excluded-item" key={b.calculationId}><strong>{b.benefitCategory}</strong><span>{b.status}</span>{b.blockedReasons.map((r,i)=><p key={i}>{r}</p>)}</div>)}</details>:null}
            {message.answer.composition.outstandingQuestions.length?<div className="composition-outstanding"><strong>Still needed to finish this calculation</strong><ul>{message.answer.composition.outstandingQuestions.map((q,i)=><li key={i}>{q}</li>)}</ul></div>:null}
          </div>:null}
          {message.answer?.claimSessionId&&message.answer.mode==="claim_assessment"&&message.answer.claimItems.length?<a className="claim-pack-link" href={`/api/claims/${message.answer.claimSessionId}/pack`}>Download the claim pack (PDF)</a>:null}
          {message.answer?.portfolioItems?.length?<div className="policy-table-scroll"><table className="chat-policy-table"><caption>Personal policy inventory</caption><thead><tr><th>Family member</th><th>Policy</th><th>Confirmed cover</th><th>Active status</th></tr></thead><tbody>{message.answer.portfolioItems.map(item=><tr key={item.id}><td>{item.ownerName}</td><td>{item.policyName}</td><td>{item.confirmed?item.coverages.map((c,i)=><div key={i}>{c.productName??c.category}{c.amount!=null?" · "+formatMoney(c.amount,c.currency):""}</div>):"Personal evidence needs review"}</td><td title={item.currentness?.detail}>{item.currentness?.label??"Not checked"}</td></tr>)}</tbody></table></div>:null}
          {message.answer?.details.map((detail,i)=><p key={i}>{detail}</p>)}
          {message.answer?.reviewCoverage?<div className={"review-coverage "+(message.answer.reviewCoverage.complete?"complete":"partial")}><strong>{message.answer.reviewCoverage.complete?"Complete policy review":"Partial policy review"}</strong><p>{message.answer.reviewCoverage.statement}</p></div>:null}
          {message.answer?.policyReview?.length?<details className="policy-review"><summary>Policy review · {message.answer.policyReview.length} contracts</summary><div className="policy-table-scroll"><table className="chat-policy-table"><thead><tr><th>Family member</th><th>Policy</th><th>Review</th><th>Evidence read</th><th>Active status</th></tr></thead><tbody>{message.answer.policyReview.map(item=><tr key={item.id}><td>{item.ownerName}</td><td>{item.policyName}</td><td>{reviewCopy[item.status]??item.status}</td><td>{coverageText(item.coverage)}</td><td title={item.currentness?.detail}>{item.currentness?.label??"Not checked"}</td></tr>)}</tbody></table></div></details>:null}
          {message.answer?.nextSteps.length?<div className="next-steps"><strong>What to do next</strong><ol>{message.answer.nextSteps.map((step,i)=><li key={i}>{step}</li>)}</ol></div>:null}
          {message.answer?.citations.length?<details className="citations"><summary>Why DearPolicy says this · {message.answer.citations.length} sources</summary>{message.answer.citations.map(c=><div className="citation" key={c.chunkId}><span>{c.insurer?c.insurer+" · ":""}{c.policyName}<small>{c.evidenceLabel??"Uploaded policy evidence"}</small></span><b>Page {c.pageStart}{c.pageEnd!==c.pageStart?"–"+c.pageEnd:""}</b></div>)}</details>:null}
          {message.answer?.disclaimer?<div className="answer-disclaimer">{message.answer.disclaimer}</div>:null}
        </div>
        {message.error?<div className="alert error message-inline-error" role="alert"><strong>This didn&rsquo;t go through.</strong><span> {message.error} Send it again when you&rsquo;re ready.</span></div>:null}
      </div>)}
      {busy?<div className="message assistant"><div className="message-label">DearPolicy</div>
        <div className="message-body thinking" role="status" aria-live="polite">
          <div className="thinking-head"><span className="thinking-dots" aria-hidden="true"><i/><i/><i/></span><strong>{progress}</strong></div>
          <div className={"thinking-bar "+(progressDetail?"determinate":"indeterminate")}>
            <span style={progressDetail?{width:Math.max(4,Math.round((progressDetail.completed/Math.max(1,progressDetail.total))*100))+"%"}:undefined}/>
          </div>
          <small>{progressDetail?progressDetail.completed+" of "+progressDetail.total+" policy contracts read":"Reading your uploaded policy evidence"} · {elapsed<60?elapsed+"s":Math.floor(elapsed/60)+"m "+(elapsed%60)+"s"}</small>
        </div></div>:null}
      {error?<div className="alert error" role="alert"><strong>Something went wrong.</strong><span> {error}</span></div>:null}<div ref={end}/>
    </div>
    <form className="chat-composer" onSubmit={ask}><textarea aria-label="Message to DearPolicy" value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask a question, answer a missing fact, or tell me what you don’t know yet…" rows={3}/>
      <button disabled={busy||!question.trim()} className="button primary" type="submit">Send →</button></form>
    <p className="chat-disclaimer">Personal records confirm ownership. Matching policy wording supports benefit assessments.</p>
  </div>;
}
export default function ChatPage(){return <Suspense fallback={<div className="page">Loading…</div>}><ChatContent/></Suspense>;}

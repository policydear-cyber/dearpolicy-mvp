"use client";

import { Icon } from "@/components/icons";
import Link from "next/link";
import { FormEvent,Suspense,useCallback,useEffect,useRef,useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ChatAnswer,ClaimItem } from "@/types";
import { POLICY_STATED_LIMIT_LABEL,POLICY_STATED_LIMIT_NOTICE,PRELIMINARY_ASSESSMENT_NOTICE } from "@/lib/chat/monetary-boundary";
import { formatMoney } from "@/lib/format/currency";
import { documentCardTitle } from "@/lib/policies/document-name";
import { customerAnswerText,customerError,customerMessage } from "@/components/customer-text";
import { answerText,codeWords } from "@/components/answer-text";
import { uniqueSteps } from "@/components/next-steps";
import { hasAssessment,withQuestionsOnce } from "@/components/assistant-message";
import { readableDates,sgDate } from "@/components/format-date";
import { AnswerWait,isAnswerStage,type AnswerStageId } from "@/components/answer-wait";
import { SourceList } from "@/components/source-list";
import { AnswerCards,showsCards } from "@/components/answer-cards";
import { StoppedNotice,isStopped } from "@/components/answer-stopped";
import { LearnLinks } from "@/components/learn-links";
import { sendFailure } from "@/components/chat-send-failure";

/* V1.1: an answer shows a direct answer, its sources (collapsed), any real
 * uncertainty, and one next question or action. Internal working -- what the
 * system classified the event as, per-contract page/passage counts, ruled-out
 * benefits, reviewer routing, raw errors -- is not shown to households. */
const ANSWER_FAILED="DearPolicy could not finish this answer. Your message is saved.";
/** The server refuses a question longer than this (app/api/chat/route.ts). */
const MAX_QUESTION_LENGTH=2000;
/** The chat was changed elsewhere (another tab or window) since this page
 * loaded it: the server refuses to append to a stale copy. */
/** Shown when the server gave no words of its own for a household with nobody in it. */
const NO_FAMILY_TEXT="Add a family member first, then ask again.";
const CONFLICT_TEXT="This chat was updated in another tab or window, so this message was not sent. Reload the chat to see the latest messages, then send it again.";
const shown=answerText,words=codeWords;
/** An answer's next steps, each once and in order, once nothing is waiting on a question (then they sit with the question). */
const nextStepsAfter=(answer?:ChatAnswer)=>{const steps=uniqueSteps(answer?.nextSteps);return steps.length&&!answer?.questions.length?<div className="next-steps" data-testid="next-step"><strong>{steps.length>1?"Next steps":"Next step"}</strong>{steps.length>1?<ol>{steps.map((step,i)=><li key={i} data-testid="next-step-item">{shown(step)}</li>)}</ol>:<p data-testid="next-step-item">{shown(steps[0])}</p>}</div>:null;};
/** Keeps the open conversation in the address bar, so a reload (or a
 * closed tab reopened from history) returns to it -- and to its pending
 * answer -- instead of starting a new chat. */
function rememberConversation(id:string|null){
  try{const url=new URL(window.location.href);url.searchParams.delete("claim");if(id)url.searchParams.set("conversation",id);else url.searchParams.delete("conversation");window.history.replaceState(window.history.state,"",url.toString());}catch{/* never block the chat */}
}

type Member={id:string;display_name:string;relationship:string;policy_count:number};
const CHAT_MAX_WAIT_MS=6*60_000;
type Message={id?:string;role:"user"|"assistant";content:string;answer?:ChatAnswer;error?:string;conflict?:boolean;noFamily?:boolean;stopped?:boolean;restored?:boolean};
type SavedChat={id:string;family_member_id:string|null;title:string;updated_at:string;revision:string};
const factFindingStatusCopy:Record<NonNullable<ChatAnswer["factFinding"]>[number]["status"],string>={
  information_needed:"Information needed",evidence_needed:"Evidence needed",reviewer_assessment_needed:"A DearPolicy reviewer will check this",
  policy_condition_unresolved:"Policy condition unresolved",ready_for_evidence_gated_estimate:"Ready for an evidence-based estimate",
};
const preliminaryStatusCopy:Record<NonNullable<ClaimItem["preliminaryStatus"]>,string>={information_needed:"Information needed",evidence_needed:"Evidence needed",reviewer_assessment_needed:"Reviewer assessment needed",policy_condition_unresolved:"Policy condition unresolved",not_applicable:"Not applicable"};
const statusCopy:Record<ClaimItem["status"],string>={likely_applicable:"Likely applicable",potentially_applicable:"Potentially applicable",not_applicable:"Not applicable",needs_document:"Needs checking"};
/** Inline answer control for a promoted fact-finding question that has no
 * tappable options (a date or free text). Submits the question restated with
 * the answer so the conversation model records the right fact without the
 * person retyping the question. */
function InlineAnswer({kind,disabled,onSubmit}:{kind:"text"|"date";disabled:boolean;onSubmit:(value:string)=>void}){
  const [value,setValue]=useState("");
  return <form className="quick-replies inline-answer" onSubmit={event=>{event.preventDefault();const v=value.trim();if(v){onSubmit(v);setValue("");}}}>
    <input type={kind==="date"?"date":"text"} value={value} disabled={disabled} onChange={event=>setValue(event.target.value)} placeholder={kind==="date"?undefined:"Type your answer"} aria-label="Your answer" />
    <button type="submit" disabled={disabled||!value.trim()}>Answer</button>
  </form>;
}

class ConflictError extends Error{}
/** The household has nobody in it yet: the server's own words, with a link to add family members. */
class NoFamilyError extends Error{}
/** The page stopped waiting; the job may still finish on the server, so the answer can still arrive in this chat. */
class StoppedWaiting extends Error{}

/** What the household's library is like right now, so an empty chat says what a first question will be answered from:
 * nothing uploaded yet, documents still being read, or documents that could not be read. */
type Library={total:number;reading:number;failed:{id:string;name:string}[]};
const READING_STATUSES=new Set(["queued","uploaded","extracting","indexing"]);
type LibraryPolicy={id:string;original_filename?:string|null;product_name?:string|null;insurer?:string|null;document_role?:string|null;policy_number?:string|null;processing_status?:string;quarantine_status?:string};
function libraryOf(policies:LibraryPolicy[]):Library{
  return {total:policies.length,
    reading:policies.filter(p=>READING_STATUSES.has(p.processing_status??"")&&(p.quarantine_status??"clean")!=="rejected").length,
    failed:policies.filter(p=>p.processing_status==="failed").map(p=>({id:p.id,name:documentCardTitle({product_name:p.product_name??null,original_filename:p.original_filename??null,insurer:p.insurer,document_role:p.document_role,policy_number:p.policy_number})}))};
}

/** The empty chat: an open invitation to ask anything in your own words (no fixed list of questions), plus what the
 * answer can draw on today. */
function ChatWelcome({library}:{library:Library|null}){
  return <div className="chat-empty" data-testid="chat-welcome"><img className="big-mark" src="/dearpolicy-logo.png" alt="DearPolicy" width={827} height={161} />
    {library&&library.total===0?<>
      <p><strong>Upload a policy first.</strong> DearPolicy answers only from the documents you upload, so there is nothing to answer from yet.</p>
      <Link className="button primary" href="/policies"><Icon name="upload"/>Upload a document</Link>
    </>:<>
      <p><strong>Ask anything about your policies, in your own words.</strong> If something happened, say who and what.</p>
      {library&&library.reading>0?<p className="chat-library-note" role="status">{library.reading===1?"One document is":`${library.reading} documents are`} still being read. You can ask now; answers use {library.reading===1?"it":"them"} once {library.reading===1?"it is":"they are"} ready.</p>:null}
      {library&&library.failed.length?<p className="chat-library-note">{library.failed.length===1?<>&ldquo;{library.failed[0].name}&rdquo; couldn&rsquo;t be read, so answers can&rsquo;t use it.</>:<>{library.failed.length} documents couldn&rsquo;t be read, so answers can&rsquo;t use them.</>} <Link className="text-link" href={library.failed.length===1?`/policies#doc-${library.failed[0].id}`:"/policies"}>See Documents →</Link></p>:null}
    </>}
  </div>;
}

function ChatContent(){
  const params=useSearchParams();
  const [family,setFamily]=useState<Member[]>([]);
  const [memberId,setMemberId]=useState(params.get("member")??"");
  // The home page's ask box opens a new chat with its question in the box, ready to send (not sent for them).
  const [question,setQuestion]=useState(()=>(params.get("ask")??"").slice(0,MAX_QUESTION_LENGTH));
  const [messages,setMessages]=useState<Message[]>([]);
  const [conversationId,setConversationId]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const [history,setHistory]=useState<SavedChat[]>([]);
  const [historyCursor,setHistoryCursor]=useState<string|null>(null);
  const [messageCursor,setMessageCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  // "" until the server reports a stage of its own: the wait never names a step that is not really happening.
  const [progress,setProgress]=useState("");
  const [stageId,setStageId]=useState<AnswerStageId|null>(null);
  /** What is in the message box right now, read when a send fails (a closure would see the old value). */
  const boxText=useRef("");
  const [queued,setQueued]=useState(false);
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
  const latest=useRef<HTMLDivElement|null>(null);
  const composer=useRef<HTMLTextAreaElement|null>(null);
  /** Document id -> file name, so each source row says which file it is. */
  const [documentFiles,setDocumentFiles]=useState<Record<string,string>>({});
  const [library,setLibrary]=useState<Library|null>(null);
  const loadLibrary=useCallback(async()=>{
    const data=await fetch("/api/policies",{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null);
    if(!data?.policies)return null;
    const policies=data.policies as LibraryPolicy[];
    setDocumentFiles(Object.fromEntries(policies.filter(p=>p.original_filename).map(p=>[p.id,p.original_filename as string])));
    const next=libraryOf(policies);setLibrary(next);return next;
  },[]);
  // While documents are being read, the welcome checks again now and then (for up to ten minutes), so it never says
  // "still being read" about a document that is ready.
  useEffect(()=>{
    let live=true,checks=0,timer:ReturnType<typeof setTimeout>|undefined;
    const tick=async()=>{const next=await loadLibrary();if(live&&next&&next.reading>0&&++checks<100)timer=setTimeout(()=>void tick(),6000);};
    void tick();
    return()=>{live=false;if(timer)clearTimeout(timer);};
  },[loadLibrary]);
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
    stopLocal();setMessages([]);setConversationId(null);setRevision(0);setMessageCursor(null);setQuestion("");setError("");setMemberId("");rememberConversation(null);
  }
  function accept(answer:ChatAnswer,version:number){
    if(version!==requestVersion.current)return;
    if(answer.resolvedFamilyMemberId)setMemberId(answer.resolvedFamilyMemberId);
    setConversationId(answer.conversationId??null);setRevision(answer.conversationRevision??0);
    setMessages(previous=>[...previous,{role:"assistant",content:answer.summary,answer}]);
  }
  async function waitForJob(id:string,signal:AbortSignal,version:number):Promise<ChatAnswer>{
    jobId.current=id;
    // Never an endless spinner: after this long the turn is reported as not
    // finished, with the message kept, whatever the server still says.
    const giveUpAt=Date.now()+CHAT_MAX_WAIT_MS;
    for(;;){
      if(Date.now()>giveUpAt){jobId.current=null;throw new StoppedWaiting("This is taking much longer than it should, so DearPolicy stopped waiting. Your question is saved, and the answer may still arrive.");}
      if(signal.aborted||version!==requestVersion.current)throw new DOMException("Cancelled","AbortError");
      const response=await fetch("/api/chat/jobs/"+id,{signal,cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"Could not read analysis progress");
      if(data.job.status==="complete"){jobId.current=null;return data.result.answer;}
      // A job this page did not cancel ends "cancelled" only when the chat
      // changed under it (lib/chat/jobs.ts: ChatConflict -> cancelled).
      if(data.job.status==="cancelled")throw new ConflictError();
      if(data.job.status==="failed")throw new Error(data.job.error??"Analysis stopped");
      if(version===requestVersion.current){
        const p=data.job.progress;
        setQueued(data.job.status==="queued");
        setStageId(isAnswerStage(p?.stageId)?p.stageId:null);
        setProgress(p?.stage?customerMessage(p?.stage,""):"");
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
    setBusy(true);setError("");setProgress("Opening saved chat…");setStageId(null);setQueued(false);setProgressDetail(null);
    try{
      const response=await fetch("/api/chat/history/"+id,{signal:abort.signal,cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"Could not open saved chat");
      if(version!==requestVersion.current)return;
      setConversationId(id);setRevision(data.conversation.revision);rememberConversation(id);
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
            const message=customerError(e,ANSWER_FAILED);
            setMessages(previous=>previous.map(m=>m===pendingMessage?{...m,error:message}:m));
          }
        }
      }
    }catch(e){if(version===requestVersion.current&&!(e instanceof DOMException&&e.name==="AbortError"))setError(customerError(e,"Could not open chat"));}
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
    }catch(e){setError(customerError(e,"Could not load messages"));}
  }
  async function sendText(text:string,personChoiceId?:string){
    text=text.trim();if(!text||busy)return;
    const version=++requestVersion.current,abort=new AbortController();controller.current=abort;
    const userMessage:Message={role:"user",content:text};
    setMessages(previous=>[...previous,userMessage]);setQuestion("");setBusy(true);setError("");setProgress("");setStageId(null);setQueued(false);setProgressDetail(null);
    try{
      const response=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},signal:abort.signal,
        body:JSON.stringify({familyMemberId:memberId||null,scope:memberId?"member":"family",
          question:text,conversationId,conversationRevision:conversationId?revision:undefined,asynchronous:true,
          timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,personChoiceId})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){const said=typeof data.error==="string"?data.error:"",kind=sendFailure(response.status,said,data.code);if(kind==="no_family")throw new NoFamilyError(said);if(kind==="conflict")throw new ConflictError();throw new Error(data.error??"Chat failed");}
      if(version!==requestVersion.current)return;
      setConversationId(data.conversationId);setRevision(data.conversationRevision);rememberConversation(data.conversationId??null);
      const resolved=data.familyMemberId??"";setMemberId(resolved);
      const answer=await waitForJob(data.jobId,abort.signal,version);accept(answer,version);
      if(version===requestVersion.current)await refreshHistory();
    }catch(e){
      // Marking the message itself -- instead of only a page-level banner --
      // is what stops a failed send from looking like a message that simply
      // never got a reply: the person can see exactly which of their
      // messages didn't go through, and why, right where they sent it.
      if(version===requestVersion.current&&!(e instanceof DOMException&&e.name==="AbortError")){
        const said=String((e as {message?:unknown}|null)?.message??"");
        const kind=e instanceof NoFamilyError?"no_family":e instanceof ConflictError?"conflict":sendFailure(null,said);
        const noFamily=kind==="no_family",conflict=kind==="conflict";
        const stopped=e instanceof StoppedWaiting;
        const message=noFamily?customerMessage(said,NO_FAMILY_TEXT):conflict?CONFLICT_TEXT:stopped?e.message:customerError(e,ANSWER_FAILED);
        // The unsent text goes back into the box, ready to send again -- unless something new is already typed there, or
        // the page only stopped waiting: that answer may still arrive, and sending again would ask twice.
        const restored=!stopped&&!boxText.current.trim();
        if(restored)setQuestion(text);
        setMessages(previous=>previous.map(m=>m===userMessage?{...m,error:message,conflict,noFamily,stopped,restored}:m));
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
    }catch(e){setHistoryError(customerError(e,"Could not delete chat"));}
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
    }catch(e){setHistoryError(customerError(e,"Could not clear history"));}
  }
  useEffect(()=>{
    let live=true;
    fetch("/api/family").then(r=>r.json()).then(data=>{
      if(!live)return;const members=data.family??[];setFamily(members);
      const saved=params.get("conversation")??params.get("claim");if(saved)void restore(saved);
    }).catch(e=>{if(live)setError(customerError(e,"Could not load your family profiles."));});
    return()=>{live=false;controller.current?.abort();requestVersion.current++;};
  },[]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    const abort=new AbortController();
    fetch("/api/chat/history?scope=all",{signal:abort.signal,cache:"no-store"}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not load history");
      if(!abort.signal.aborted){setHistory(data.conversations);setHistoryCursor(data.nextCursor??null);setHistoryError("");}
    }).catch((e)=>{if(!abort.signal.aborted)setHistoryError(customerError(e,"Could not load your chat history."));});
    return()=>abort.abort();
  },[]);
  // A new answer scrolls to its FIRST line (a long answer read from the top,
  // not from its disclaimer); while a message is sending, the pending bubble
  // at the bottom stays in view.
  useEffect(()=>{
    const behavior:ScrollBehavior=typeof window!=="undefined"&&window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?"auto":"smooth";
    if(!busy&&!messages.length)return;
    if(!busy&&messages[messages.length-1]?.role==="assistant"&&latest.current){latest.current.scrollIntoView({behavior,block:"start"});return;}
    end.current?.scrollIntoView({behavior,block:"end"});
  },[messages,busy]);
  useEffect(()=>{boxText.current=question;},[question]);
  async function ask(event:FormEvent){event.preventDefault();await sendText(question);}
  /** Enter sends and Shift+Enter starts a new line, on a keyboard. On a
   * touch screen Enter stays a new line: the Send button is right there. */
  function sendOnEnter(event:React.KeyboardEvent<HTMLTextAreaElement>){
    if(event.key!=="Enter"||event.shiftKey||event.nativeEvent.isComposing)return;
    if(typeof window!=="undefined"&&window.matchMedia?.("(pointer: coarse)").matches)return;
    event.preventDefault();void sendText(question);
  }
  // The box grows with what is typed (up to a limit), so a phone keeps most
  // of the screen for the answer.
  useEffect(()=>{const box=composer.current;if(!box)return;box.style.height="auto";box.style.height=Math.min(box.scrollHeight,240)+"px";},[question]);
  const active=family.find(m=>m.id===memberId);

  return <div className="page chat-page">
    <header className="chat-header">
      <div><h1><span className="title-icon"><Icon name="ask"/></span>Ask DearPolicy</h1><p className="trust-line" data-testid="chat-trust-line"><Icon name="documents"/>Answers only from your documents, with the page.</p></div>
      <div className="chat-head-actions"><div className="auto-context"><strong><Icon name="person"/> Who it’s about</strong><span>{active?"Following "+active.display_name+" until you mention someone else":"Mention a name or “I”, or ask about the whole family"}</span></div><button className="button secondary compact" onClick={reset}><Icon name="plus"/>New chat</button></div>
    </header>
    {/* A first-time user has no previous chats: the empty panel is left out rather than shown as "Previous chats · 0". */}
    {history.length||historyCursor?<details className="chat-history" open={!messages.length&&!busy&&history.length>0?true:undefined}><summary>Previous chats · {history.length}{historyCursor?"+":""}</summary>
      <div className="history-actions"><button className="mini-button danger" disabled={!history.length} onClick={clearHistory}>{confirmClearHistory?"Confirm clear all":"Clear all chat history"}</button>{confirmClearHistory&&<button className="mini-button" onClick={()=>setConfirmClearHistory(false)}>Cancel</button>}</div>
      {!history.length?<p>No previous chats yet.</p>:<ul>{history.map(chat=><li key={chat.id}>
        <button className="history-open" disabled={busy} onClick={()=>void restore(chat.id)} aria-current={conversationId===chat.id?"true":undefined}>{chat.title}<small>{family.find(p=>p.id===chat.family_member_id)?.display_name??"Whole family"} · {sgDate(chat.updated_at)}</small></button>
        <button className="mini-button danger" onClick={()=>void removeChat(chat.id)} aria-label={"Delete chat: "+chat.title}>{confirmDeleteChatId===chat.id?"Confirm delete":"Delete"}</button>
        {confirmDeleteChatId===chat.id&&<button className="mini-button" onClick={()=>setConfirmDeleteChatId(null)}>Cancel</button>}
      </li>)}</ul>}
      {historyCursor?<button className="mini-button" onClick={()=>void refreshHistory(historyCursor).catch(()=>setHistoryError("Could not load more chats."))}>Load more chats</button>:null}
      {historyError?<p role="alert">{historyError}</p>:null}
    </details>:null}
    <div className="chat-window" aria-live="polite">
      {!messages.length&&!busy?<ChatWelcome library={library}/>:null}
      {messageCursor?<button className="mini-button" disabled={busy} onClick={()=>void olderMessages()}>Load older messages</button>:null}
      {withQuestionsOnce(messages).map((message,index,all)=><div className={"message "+message.role} key={message.id??index} ref={index===messages.length-1?latest:undefined}>
        <div className="message-label">{message.role==="user"?"You":"DearPolicy"}</div><div className="message-body">{/* Round 6: a question is presented once, by its card below; the body never repeats it. */}
          {/* An answer that arrives with checked statements is shown as cards (bottom line, one card per amount, sources one tap
              away); the same text otherwise, as before. A claim assessment keeps its own layout. */}
          {(()=>{const cards=message.role==="assistant"&&showsCards(message.answer);return <>
          {cards?<AnswerCards answer={message.answer as Parameters<typeof AnswerCards>[0]["answer"]} render={text=>readableDates(customerAnswerText(shown(text)))} prose={[message.content??"",...(message.answer!.details??[])]} sources={<SourceList citations={message.answer!.citations} files={documentFiles}/>} after={nextStepsAfter(message.answer)}/>:null}
          {/* A turn that stopped before answering is drawn as a stop, with one tap to a narrower question. */}
          {cards?null:message.role==="assistant"&&isStopped(message.answer,message.content)?<StoppedNotice text={readableDates(customerAnswerText(message.content))} question={all.slice(0,index).reverse().find(m=>m.role==="user")?.content} people={family.map(m=>({id:m.id,name:m.display_name}))} onAsk={(text,id)=>{setQuestion(text.slice(0,MAX_QUESTION_LENGTH));if(id)setMemberId(id);composer.current?.focus();}}/>
          :message.role==="assistant"?(message.content?<p>{readableDates(customerAnswerText(message.content))}</p>:null):<p>{message.content}</p>}
          {!cards&&message.answer&&!hasAssessment(message.answer)&&message.answer.questions.length?message.answer.details.map((detail,i)=><p key={"d"+i}>{shown(detail)}</p>):null}
          </>;})()}
          {message.answer?.invalidated?<div className="alert" role="note" data-testid="answer-invalidated" data-reason={message.answer.invalidated.reason}><strong>{message.answer.invalidated.reason==="superseded"?"Replaced.":"Out of date."}</strong> {({policy_deleted:"A policy document this answer relied on has been deleted, so it no longer describes your cover.",documents_added:"Documents have been added since this answer, so it may no longer be right.",person_unlinked:"Someone this answer was about has since been removed from the document it relied on.",superseded:"This answer was replaced by the corrected answer below."} as Record<string,string>)[message.answer.invalidated.reason]??"This answer no longer describes your cover."}</div>:null}
          {/* dj-live-3: while a question is open, the supported practical steps are shown ahead of it (never collapsed behind it). */}
          {(()=>{const steps=uniqueSteps(message.answer?.nextSteps);return steps.length&&message.answer?.questions.length?<div className="next-steps" data-testid="next-step"><strong>{steps.length>1?"Next steps":"Next step"}</strong>{steps.length>1?<ol>{steps.map((step,i)=><li key={i} data-testid="next-step-item">{shown(step)}</li>)}</ol>:<p data-testid="next-step-item">{shown(steps[0])}</p>}</div>:null;})()}
          {message.answer?.questions.map(q=><div className="fact-question" key={q.id}><div className="question-label">A fact that changes this assessment</div><strong>{shown(q.text)}</strong><small>{shown(q.why)}</small>
            <div className="quick-replies">{(q.id==="claim_person"||q.id==="rag_person")&&message.answer?.personCandidates?.length?message.answer.personCandidates.map(p=><button key={p.id} disabled={busy||index!==messages.length-1} onClick={()=>void sendText(p.label,p.id)}>{p.label}</button>):q.options?.map(option=><button key={option} disabled={busy||index!==messages.length-1} onClick={()=>void sendText(option)}>{option}</button>)}</div>
            {/* A date or a free-text fact is answered in place: the reply
                restates the question so the fact it answers is unambiguous. */}
            {q.id!=="claim_person"&&q.id!=="rag_person"&&(q.type==="date"||q.type==="text")?<InlineAnswer kind={q.type==="date"?"date":"text"} disabled={busy||index!==messages.length-1} onSubmit={value=>void sendText(q.text.replace(/\?\s*$/,"")+": "+value)} />:null}
          </div>)}
          {/* One question at a time, always answerable: when the turn asks
              nothing directly but the fact-finding plan still needs facts,
              the first open question gets the same highlighted, tappable
              treatment instead of sitting in a bullet list nobody answers.
              Tapping restates the question with the answer so the recorded
              fact is unambiguous. */}
          {message.answer&&!message.answer.questions.length?(()=>{const plans=message.answer?.factFinding??[];const active=plans.find(plan=>plan.nextQuestions.length);const q=active?.nextQuestions[0];if(!active||!q)return null;
            const remaining=plans.reduce((n,plan)=>n+plan.nextQuestions.length,0)-1;
            const reply=(text:string)=>void sendText(q.text.replace(/\?\s*$/,"")+": "+text);
            const locked=busy||index!==messages.length-1;
            return <div className="fact-question" key={q.id}><div className="question-label">{active.subjectName?active.subjectName+" · ":""}{active.label}{remaining>0?` · ${remaining} more question${remaining===1?"":"s"} after this`:""}</div><strong>{shown(q.text)}</strong><small>{shown(q.why)}</small>
              {q.type==="yes_no"?<div className="quick-replies">{["Yes","No","Not sure"].map(option=><button key={option} disabled={locked} onClick={()=>reply(option)}>{option}</button>)}</div>
              :q.type==="choice"&&q.options?.length?<div className="quick-replies">{q.options.map(option=><button key={option} disabled={locked} onClick={()=>reply(option)}>{option}</button>)}</div>
              :<InlineAnswer kind={q.type==="date"?"date":"text"} disabled={locked} onSubmit={reply} />}
            </div>;})():null}
          {/* Documents give the answer more to stand on than typed facts:
              anything the family already holds (death certificate, police or
              coroner's report, bills, receipts) uploads on the claim's own
              evidence page, so the affordance is one clear link, not a
              second uploader. */}
          {message.answer?.claimSessionId&&(message.answer.factFinding??[]).some(plan=>plan.missingDocuments.length)?<a className="claim-pack-link evidence-upload-link" href={`/claims/${message.answer.claimSessionId}`}>Upload documents for this claim — {[...new Set((message.answer.factFinding??[]).flatMap(plan=>plan.missingDocuments))].slice(0,4).join("; ")} →</a>:null}
          {/* When information is still needed, the questions above are the
              whole point of the turn: everything else collapses behind one
              toggle so they are never buried under the full assessment. Once
              nothing is open, the assessment renders expanded as before. */}
          {(awaiting=>{const detail=<>
          {message.answer?.factFinding?.length?<div className="fact-finding" data-testid="fact-finding"><small>What DearPolicy still needs</small>{message.answer.factFinding.map((plan,i)=><div className="fact-finding-plan" key={i} data-status={plan.status}>
            <strong>{plan.subjectName?plan.subjectName+" · ":""}{plan.label}</strong> <span className="fact-finding-status">{factFindingStatusCopy[plan.status]}</span>
            {plan.missingDocuments.length?<p className="fact-finding-documents">Documents: {plan.missingDocuments.join("; ")}</p>:null}
            {plan.reportedAmountsIgnored.length?<p className="fact-finding-reported">Any amount you mentioned is recorded as you reported it. It is not used as your cover or to work out a claim.</p>:null}
          </div>)}</div>:null}
          {message.answer?.knownFacts?.length?<div className="known-facts"><strong>Facts and uncertainties</strong><div>{message.answer.knownFacts.map((f,i)=><span key={i}>{shown(f)}</span>)}</div></div>:null}
          {message.answer?.assessmentKind==="preliminary"?<div className="preliminary-assessment" data-testid="preliminary-assessment"><small>Preliminary claim assessment</small><p>{PRELIMINARY_ASSESSMENT_NOTICE}</p></div>:null}
          {message.answer?.policyStatedLimits?.length?<div className="policy-stated-limits" data-testid="policy-stated-limits">{message.answer.policyStatedLimits.map((limit,i)=><div className="policy-stated-limit" key={i}>
            <small>{POLICY_STATED_LIMIT_LABEL}</small><strong>{limit.amountText}</strong><span>{limit.ownerName?limit.ownerName+" · ":""}{limit.benefitTitle}</span>
            <p>{POLICY_STATED_LIMIT_NOTICE}</p><em>From {limit.citation.policyName}, page {limit.citation.pageStart}: “{limit.quote.length>200?limit.quote.slice(0,197)+"…":limit.quote}”</em>
          </div>)}</div>:null}
          {message.answer?.claimItems.some(item=>item.status!=="not_applicable")?<div className="claim-results">{message.answer.claimItems.filter(item=>item.status!=="not_applicable").map((item,i)=><div className={"claim-result "+item.status} key={i}>
            <div className="claim-result-head"><strong>{item.title}</strong><span>{statusCopy[item.status]}</span></div>{item.preliminaryStatus?<span className="preliminary-status">{preliminaryStatusCopy[item.preliminaryStatus]}</span>:null}<p>{shown(item.reason)}</p>
            {item.conditions.length?<details className="claim-conditions"><summary>{item.conditions.length===1?"1 condition":item.conditions.length+" conditions"}</summary><ul>{item.conditions.map((c,j)=><li key={j}>{shown(c)}</li>)}</ul></details>:null}
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
                {b.status!=="included"&&b.blockedReasons.length?<p className="composition-blocked-reason">{shown(b.blockedReasons.join(" "))}</p>:null}
                {b.deductionReferences.length||b.capReferences.some(c=>c.applied)?<details className="composition-why"><summary>Why this amount?</summary>
                  {b.rawAmount!==b.payableAmount?<p>Calculated amount before deductions: {formatMoney(b.rawAmount,b.currency)}</p>:null}
                  {b.deductionReferences.map((d,i)=><p key={i}>−{d.amountText} · {words(d.reason)}</p>)}
                  {b.capReferences.filter(c=>c.applied).map((c,i)=><p key={i}>Capped by {c.label} ({words(c.scope).toLowerCase()}): {c.amountDeductedText} deducted, cap {c.amountText}</p>)}
                </details>:null}
                {b.evidenceReferences.length?<div className="composition-evidence">{b.evidenceReferences.map((e,i)=><span key={i}>{e.label??"Policy wording"} · page {e.pageStart}{e.pageEnd!==e.pageStart?"–"+e.pageEnd:""}</span>)}</div>:null}
              </div>)}
            </div>)}
            {message.answer.composition.alternativeGroups.length?<div className="composition-alternatives"><strong>Alternative benefits · policy pays only one</strong>{message.answer.composition.alternativeGroups.map(g=><ul key={g.compositionGroupId}>{g.benefits.map(b=><li key={b.calculationId}>{b.benefitCategory} — {b.status==="included"&&b.payableAmountText?b.payableAmountText:"not counted in any total"}{b.calculationId===g.selectedBenefitCalculationId?" · selected (higher amount)":" · not selected"}</li>)}</ul>)}</div>:null}
            {message.answer.composition.outstandingQuestions.length?<div className="composition-outstanding"><strong>Still needed to finish this calculation</strong><ul>{message.answer.composition.outstandingQuestions.map((q,i)=><li key={i}>{shown(q)}</li>)}</ul></div>:null}
          </div>:null}
          {message.answer?.claimSessionId&&message.answer.mode==="claim_assessment"&&message.answer.claimItems.length?<a className="claim-pack-link" href={`/api/claims/${message.answer.claimSessionId}/pack`}>Download the claim pack (PDF)</a>:null}
          {message.answer?.portfolioItems?.length?<div className="policy-table-scroll"><table className="chat-policy-table"><caption>Personal policy inventory</caption><thead><tr><th>Family member</th><th>Policy</th><th>Confirmed cover</th><th>Active status</th></tr></thead><tbody>{message.answer.portfolioItems.map(item=><tr key={item.id}><td data-label="Family member">{item.ownerName}</td><td data-label="Policy">{item.policyName}</td><td data-label="Confirmed cover">{item.confirmed?item.coverages.map((c,i)=><div key={i}>{c.productName??c.category}{c.amount!=null?(c.currency?" · "+formatMoney(c.amount,c.currency):" · "+c.amount.toLocaleString()+" (currency not stated)"):""}</div>):"Personal evidence needs review"}</td><td data-label="Active status" title={item.currentness?.detail}>{item.currentness?.label??"Not checked"}</td></tr>)}</tbody></table></div>:null}
          {/* Round 13: on a claim answer, what applies to every card is said once, under its own heading. */}
          {message.answer?.mode==="claim_assessment"&&message.answer.details.length&&message.answer.claimItems.some(item=>item.status!=="not_applicable")
            ?<div className="claim-before" data-testid="claim-before"><strong>Before you claim</strong>{message.answer.details.map((detail,i)=><p key={i}>{shown(detail)}</p>)}</div>
            :message.answer&&!hasAssessment(message.answer)&&message.answer.questions.length?null:message.role==="assistant"&&showsCards(message.answer)?null:message.answer?.details.map((detail,i)=><p key={i}>{shown(detail)}</p>)}
          {message.answer?.reviewCoverage&&!message.answer.reviewCoverage.complete?<div className="review-coverage partial" data-testid="answer-uncertainty"><p>DearPolicy could not check every part of your documents for this, so this is not a finding that it is missing.</p></div>:null}
          {/* V1.5: every saved next step, in order, each once (a repeated step is shown once) -- never only the first. While a
              question is waiting for an answer they sit with the rest of the assessment under "Show full assessment". */}
          {message.role==="assistant"&&showsCards(message.answer)?null:nextStepsAfter(message.answer)}
          {message.answer?.citations.length&&!(message.role==="assistant"&&showsCards(message.answer))?<details className="citations"><summary>Sources</summary><SourceList citations={message.answer.citations} files={documentFiles}/></details>:null}
          </>;return awaiting?<details className="assessment-details" data-testid="assessment-details"><summary>Show full assessment</summary>{detail}</details>:detail;})(
            ((message.answer?.questions.length??0)+(message.answer?.factFinding?.reduce((n,p)=>n+p.nextQuestions.length,0)??0))>0
          )}
          {message.answer?.disclaimer&&!isStopped(message.answer,message.content)?<div className="answer-disclaimer">{message.answer.disclaimer}</div>:null}
          {/* Knowledge library: general explanations of terms this answer uses (static, never changes the answer). */}
          {message.role==="assistant"&&message.answer&&!isStopped(message.answer,message.content)?<LearnLinks texts={[message.content,...(message.answer.details??[]),...(message.answer.claimItems??[]).flatMap(item=>[item.reason,...(item.conditions??[])])]}/>:null}
        </div>
        {message.error?(message.noFamily
          ?<div className="alert error message-inline-error" role="alert" data-testid="chat-no-family"><strong>Not sent.</strong><span> {message.error}</span><Link className="mini-button" href="/family">Add family members</Link></div>
          :message.conflict
          ?<div className="alert error message-inline-error" role="alert" data-testid="chat-conflict"><strong>Not sent.</strong><span> {message.error}</span>{conversationId?<button type="button" className="mini-button" disabled={busy} onClick={()=>void restore(conversationId)}>Reload this chat</button>:null}</div>
          :message.stopped
          ?<div className="alert message-inline-error" role="alert" data-testid="chat-stopped-waiting"><strong>Still not answered.</strong><span> {message.error}</span>{conversationId?<button type="button" className="mini-button" disabled={busy} onClick={()=>void restore(conversationId)}>Check for the answer</button>:null}</div>
          :<div className="alert error message-inline-error" role="alert"><strong>This didn&rsquo;t go through.</strong><span> {message.error.replace(/\.?\s*$/,".")} {message.restored&&index===messages.length-1&&!busy?"Your question is back in the box below, ready to send again.":"Send it again when you’re ready."}</span></div>):null}
      </div>)}
      {busy?<div className="message assistant"><div className="message-label">DearPolicy</div>
        <AnswerWait label={progress} stageId={stageId} detail={progressDetail} elapsed={elapsed} queued={queued}/></div>:null}
      {error?<div className="alert error" role="alert"><strong>Something went wrong.</strong><span> {error}</span></div>:null}<div ref={end} className="chat-end"/>
    </div>
    <form className="chat-composer" onSubmit={ask}><textarea ref={composer} aria-label="Message to DearPolicy" aria-describedby="chat-length" value={question} maxLength={MAX_QUESTION_LENGTH} onChange={e=>setQuestion(e.target.value.slice(0,MAX_QUESTION_LENGTH))} onKeyDown={sendOnEnter} placeholder="Ask anything about your policies…" rows={2}/>
      <small id="chat-length" className={"chat-length"+(question.length>=MAX_QUESTION_LENGTH*0.9?" near-limit":"")+(question.length>=MAX_QUESTION_LENGTH*0.8?" visible":"")} aria-live="polite">{question.length.toLocaleString()} / {MAX_QUESTION_LENGTH.toLocaleString()}{question.length>=MAX_QUESTION_LENGTH?" — that’s the limit for one message. Split a longer story into two messages.":""}</small>
      {busy&&question.trim()?<small className="chat-wait-hint" role="status">You can send this once the answer above arrives.</small>:null}
      <button disabled={busy||!question.trim()} className="button primary" type="submit">Send<Icon name="arrowRight"/></button></form>
    <p className="chat-disclaimer">DearPolicy answers only from your uploaded documents. Your insurer decides any claim.</p>
  </div>;
}
export default function ChatPage(){return <Suspense fallback={<div className="page">Loading…</div>}><ChatContent/></Suspense>;}

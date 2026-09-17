import type { PolicySource } from "@/lib/chat/types";
import type { AnswerReviewCoverage,ReviewCoverage } from "@/types";

/** Evidence-completeness accounting.
 *
 * A retrieval that returns nothing is an incomplete review, never proof that a
 * benefit is absent. DearPolicy therefore measures how much of each contract's
 * processed text was actually retrieved and actually read by the policy reader,
 * and only permits a negative coverage conclusion when nothing was left unread.
 */
/** Page numbers restart in every document, so a page is identified by its
 * document as well as its number. */
export function pagesSpanned(sources:{policyId?:string;pageStart:number;pageEnd:number}[]){
  const pages=new Set<string>();
  for(const source of sources){
    const start=Math.min(source.pageStart,source.pageEnd),end=Math.max(source.pageStart,source.pageEnd);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<1)continue;
    for(let page=start;page<=end&&page-start<5000;page++)pages.add((source.policyId??"")+"#"+page);
  }
  return pages;
}
/** Windowing splits a retrieved passage into `id#part-n` fragments. Both halves
 * of that split describe the same stored passage, so count the passage once. */
export function passageIdentity(source:PolicySource){return source.id.split("#part-")[0];}
export function emptyReviewCoverage(completeness:ReviewCoverage["completeness"]="not_processed"):ReviewCoverage{
  return {documentsTotal:0,documentsReady:0,pagesTotal:0,pagesRetrieved:0,pagesRead:0,
    passagesTotal:0,passagesRetrieved:0,passagesRead:0,windowsAnalyzed:0,windowsFailed:0,completeness};
}
export function contractReviewCoverage(args:{
  documents:{id:string;processing_status:string;page_total:number;chunk_total:number}[];
  retrieved:PolicySource[];read:PolicySource[];
  windowsAnalyzed:number;windowsFailed:number;hasWording:boolean;
}):ReviewCoverage{
  const documents=[...new Map(args.documents.map(d=>[d.id,d])).values()];
  const ready=documents.filter(d=>d.processing_status==="ready");
  const pagesTotal=ready.reduce((sum,d)=>sum+Math.max(0,d.page_total||0),0);
  const passagesTotal=ready.reduce((sum,d)=>sum+Math.max(0,d.chunk_total||0),0);
  const readyIds=new Set(ready.map(d=>d.id));
  const retrieved=args.retrieved.filter(s=>readyIds.has(s.policyId));
  const read=args.read.filter(s=>readyIds.has(s.policyId));
  const passagesRetrieved=new Set(retrieved.map(passageIdentity)).size;
  const passagesRead=new Set(read.map(passageIdentity)).size;
  const pagesRetrieved=pagesSpanned(retrieved).size;
  const pagesRead=pagesSpanned(read).size;
  const complete=documents.length>0&&ready.length===documents.length&&args.hasWording&&args.windowsFailed===0&&
    passagesTotal>0&&passagesRead>=passagesTotal&&pagesTotal>0&&pagesRead>=pagesTotal;
  const completeness:ReviewCoverage["completeness"]=
    !documents.length||ready.length<documents.length?"not_processed":
    !args.hasWording?"no_wording":
    complete?"full_text_reviewed":"partial_retrieval";
  return {documentsTotal:documents.length,documentsReady:ready.length,
    pagesTotal,pagesRetrieved:Math.min(pagesRetrieved,pagesTotal||pagesRetrieved),pagesRead:Math.min(pagesRead,pagesTotal||pagesRead),
    passagesTotal,passagesRetrieved:Math.min(passagesRetrieved,passagesTotal||passagesRetrieved),
    passagesRead:Math.min(passagesRead,passagesTotal||passagesRead),
    windowsAnalyzed:args.windowsAnalyzed,windowsFailed:args.windowsFailed,completeness};
}
function plural(count:number,word:string){return count+" "+word+(count===1?"":"s");}
export function summarizeReviewCoverage(coverages:ReviewCoverage[]):AnswerReviewCoverage{
  const total=(pick:(c:ReviewCoverage)=>number)=>coverages.reduce((sum,c)=>sum+pick(c),0);
  const contractsTotal=coverages.length;
  const contractsFullyReviewed=coverages.filter(c=>c.completeness==="full_text_reviewed").length;
  const documentsTotal=total(c=>c.documentsTotal);
  const documentsNotProcessed=total(c=>c.documentsTotal-c.documentsReady);
  const pagesTotal=total(c=>c.pagesTotal),pagesRead=total(c=>c.pagesRead);
  const windowsFailed=total(c=>c.windowsFailed);
  const complete=contractsTotal>0&&contractsFullyReviewed===contractsTotal&&documentsNotProcessed===0&&windowsFailed===0;
  const scope=plural(pagesTotal,"processed page")+" across "+plural(documentsTotal,"document")+" in "+plural(contractsTotal,"contract");
  const statement=!contractsTotal?"No confirmed personal policy contract was available to review, so nothing here establishes that a benefit is absent.":
    complete?"Complete review: every one of the "+scope+" was read for this answer.":
    "Partial review: "+pagesRead+" of "+scope+" "+(pagesRead===1?"was":"were")+" read for this answer"+
      (documentsNotProcessed?", and "+plural(documentsNotProcessed,"document")+" "+(documentsNotProcessed===1?"is":"are")+" still processing":"")+
      (windowsFailed?", and "+plural(windowsFailed,"evidence batch")+" could not be finished":"")+
      ". An unread section is an incomplete review, not proof that the event is uninsured.";
  return {contractsTotal,contractsFullyReviewed,documentsTotal,documentsNotProcessed,pagesTotal,pagesRead,windowsFailed,complete,statement};
}
/** "Not covered" requires a completely reviewed authoritative record. */
export function negativeConclusionPermitted(coverage:AnswerReviewCoverage|undefined|null){return !!coverage&&coverage.complete;}
const NEGATIVE_COVERAGE=/\b(?:not covered|isn(?:'|’)?t covered|are not covered|aren(?:'|’)?t covered|no cover(?:age)?\b|without (?:any )?cover(?:age)?\b|there (?:is|was) no (?:cover|policy|benefit)|has no (?:cover|benefit)|have no (?:cover|benefit)|nothing (?:can be|to) claim|not insured|uninsured)/i;
/** Detects a categorical negative-coverage claim in generated prose. The
 * application's own "this is an incomplete review" wording is exempt. */
export function negativeCoverageClaim(text:string){
  const sentences=text.split(/(?<=[.!?])\s+/);
  return sentences.some(sentence=>NEGATIVE_COVERAGE.test(sentence)&&
    !/\b(?:incomplete|partial|does(?:n(?:'|’)?t| not) (?:establish|prove|mean)|cannot (?:establish|prove|conclude)|not proof|can(?:'|’)?t conclude)\b/i.test(sentence));
}

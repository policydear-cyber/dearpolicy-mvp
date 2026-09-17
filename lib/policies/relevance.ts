import type { PolicySource } from "@/lib/chat/types";

/** Spending a scarce number of local-model calls well.
 *
 * Reading one evidence window is the single most expensive thing DearPolicy
 * does. Giving every contract an equal slice means a household with ten
 * policies spends most of its budget on contracts that retrieval already showed
 * were not responsive, and the one contract that actually answers the question
 * is read shallowly. Retrieval has already scored every passage, so use those
 * scores to decide the order, and record what was never examined so an
 * unexamined contract is reported rather than silently treated as empty. */
export type ContractCandidate = {
  contractId:string;
  windows:PolicySource[][];
  /** Passages whose text matched the question lexically. */
  lexicalMatches:number;
  /** Closest semantic passage; null when embeddings were unavailable. */
  bestDistance:number|null;
};
export function candidateFromWindows(contractId:string,windows:PolicySource[][]):ContractCandidate{
  const passages=windows.flat();
  const distances=passages.map(p=>p.semanticDistance).filter((d):d is number=>typeof d==="number"&&Number.isFinite(d));
  return {contractId,windows,
    lexicalMatches:passages.filter(p=>p.lexicalMatch===true).length,
    bestDistance:distances.length?Math.min(...distances):null};
}
/** A lexical hit beats any semantic proximity; otherwise the closest passage
 * wins. Ties keep the caller's order so the result is deterministic. */
export function rankCandidates(candidates:ContractCandidate[]):ContractCandidate[]{
  return candidates.map((candidate,index)=>({candidate,index})).sort((a,b)=>
    Number(b.candidate.lexicalMatches>0)-Number(a.candidate.lexicalMatches>0)||
    b.candidate.lexicalMatches-a.candidate.lexicalMatches||
    (a.candidate.bestDistance??Number.POSITIVE_INFINITY)-(b.candidate.bestDistance??Number.POSITIVE_INFINITY)||
    a.index-b.index).map(entry=>entry.candidate);
}
/** Round-robin in relevance order: every candidate gets its best window before
 * any candidate gets a second one, then the budget deepens the strongest
 * contracts. Contracts with no retrieved evidence are never allocated a call. */
export function allocateReadingWindows(candidates:ContractCandidate[],maximumWindows:number,perContractCap:number){
  const ranked=rankCandidates(candidates.filter(c=>c.windows.length>0));
  const allocation=new Map<string,number>(candidates.map(c=>[c.contractId,0]));
  let remaining=Math.max(0,maximumWindows);
  for(let round=0;remaining>0&&round<perContractCap;round++){
    let progressed=false;
    for(const candidate of ranked){
      if(remaining<=0)break;
      const current=allocation.get(candidate.contractId)??0;
      if(current>=candidate.windows.length||current>=perContractCap)continue;
      allocation.set(candidate.contractId,current+1);remaining--;progressed=true;
    }
    if(!progressed)break;
  }
  return allocation;
}

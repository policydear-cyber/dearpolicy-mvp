import { query } from "@/lib/db/client";
import { embedTexts, toPgVector } from "@/lib/ai/embeddings";
import { pineconeEnabled, searchPolicyPassages } from "@/lib/rag/pinecone";
import type { RetrievedChunk } from "@/types";

type ChunkRow={ id:string;policy_id:string;insurer:string|null;product_name:string|null;page_start:number;page_end:number;heading:string|null;text:string;distance:number;document_role:string|null;personal_coverage_confirmed:boolean;document_authority:number;keyword_rank:number };

function ownershipQuestion(q:string){ return /\b(do i|do we|am i|is .* covered|how much.*cover|what.*cover|my coverage|my policy|sum assured|sum insured|premium|claim|diagnos|cancer|hospital|fractur|accident|surgery|illness|disabil)\b/i.test(q); }

function retrievalExpansion(question:string){
  const extras:string[]=[];
  if(/cancer|tumou?r|carcinoma|malignan/i.test(question))extras.push("Major Cancer Critical Illness Living Care Living Care Plus severe stage early stage claims scenario diagnosis survival period waiting period");
  if(/hospital|admitted|inpatient/i.test(question))extras.push("Hospitalisation Daily Hospital Cash hospital stay benefit");
  if(/fractur|broken bone|accident|injur/i.test(question))extras.push("Personal Accident fracture benefit ambulance accidental injury");
  if(/total permanent|tpd|permanent disabil/i.test(question))extras.push("Total Permanent Disability Group Term Life sum insured");
  if(/early critical/i.test(question))extras.push("Living Care Plus early critical illness");
  return [question,...extras].join(" ");
}

/** The semantic candidates for one family member's documents.
 *
 * Pinecone holds the vectors and embeds both the passages and the question, so
 * this hands it the member's document ids and gets chunk ids back. Where there
 * is no Pinecone key but a local Ollama install, pgvector answers the same
 * question instead. If neither can, retrieval carries on with the keyword arm
 * below: a worse answer, never a failed one. */
async function semanticCandidates(args:{accountId:string;familyMemberId:string;searchText:string}){
  if(pineconeEnabled()){
    const owned=await query<{policy_id:string}>(
      `SELECT DISTINCT c.policy_id FROM policy_chunks c
         JOIN policy_members pm ON pm.policy_id=c.policy_id AND pm.account_id=c.account_id
        WHERE c.account_id=$1 AND pm.family_member_id=$2`,
      [args.accountId,args.familyMemberId]);
    const policyIds=owned.rows.map(r=>r.policy_id);
    if(!policyIds.length)return {ids:[] as string[],distances:[] as number[],vector:null as string|null};
    try{
      const hits=await searchPolicyPassages({accountId:args.accountId,policyIds,text:args.searchText,topK:28});
      return {ids:hits.map(h=>h.chunkId),distances:hits.map(h=>h.distance),vector:null as string|null};
    }catch(error){
      console.warn("Pinecone retrieval failed:",error instanceof Error?error.message:error);
      return {ids:[] as string[],distances:[] as number[],vector:null as string|null};
    }
  }
  try{
    const [embedding]=await embedTexts([args.searchText]);
    return {ids:[] as string[],distances:[] as number[],vector:toPgVector(embedding)};
  }catch{
    return {ids:[] as string[],distances:[] as number[],vector:null as string|null};
  }
}

export async function retrieveRelevantChunks(args:{accountId:string;familyMemberId:string;question:string;limit?:number;}):Promise<RetrievedChunk[]> {
  const searchText=retrievalExpansion(args.question);
  const semantic=await semanticCandidates({accountId:args.accountId,familyMemberId:args.familyMemberId,searchText});
  const result=await query<ChunkRow>(
    `WITH hits AS (SELECT * FROM unnest($5::uuid[],$6::float8[]) AS h(id,distance)), vec AS (
       SELECT c.id,COALESCE(h.distance,(c.embedding <=> $1::vector)::double precision) AS distance
       FROM policy_chunks c JOIN policy_members pm ON pm.policy_id=c.policy_id AND pm.account_id=c.account_id
       LEFT JOIN hits h ON h.id=c.id
       WHERE c.account_id=$2 AND pm.family_member_id=$3
         AND (h.distance IS NOT NULL OR ($1::vector IS NOT NULL AND c.embedding IS NOT NULL))
       ORDER BY COALESCE(h.distance,(c.embedding <=> $1::vector)::double precision) NULLS LAST LIMIT 28
     ), kw AS (
       SELECT c.id,ts_rank_cd(to_tsvector('english',coalesce(c.heading,'')||' '||c.text),websearch_to_tsquery('english',$4)) AS keyword_rank
       FROM policy_chunks c JOIN policy_members pm ON pm.policy_id=c.policy_id AND pm.account_id=c.account_id
       WHERE c.account_id=$2 AND pm.family_member_id=$3 AND to_tsvector('english',coalesce(c.heading,'')||' '||c.text) @@ websearch_to_tsquery('english',$4)
       ORDER BY keyword_rank DESC LIMIT 18
     ), candidates AS (SELECT id FROM vec UNION SELECT id FROM kw)
     SELECT c.id,c.policy_id,p.insurer,p.product_name,c.page_start,c.page_end,c.heading,c.text,
            COALESCE(v.distance,1.0)::float AS distance,p.document_role,p.personal_coverage_confirmed,p.document_authority,
            COALESCE(k.keyword_rank,0)::float AS keyword_rank
     FROM candidates x JOIN policy_chunks c ON c.id=x.id JOIN policies p ON p.id=c.policy_id AND p.account_id=c.account_id
     LEFT JOIN vec v ON v.id=c.id LEFT JOIN kw k ON k.id=c.id
     WHERE p.processing_status='ready'`,
    [semantic.vector,args.accountId,args.familyMemberId,searchText,semantic.ids,semantic.distances],
  );
  const wantsOwnership=ownershipQuestion(args.question);
  return result.rows
    .map((r)=>({r,score:(1-Number(r.distance))*0.70+Math.min(Number(r.keyword_rank),1)*0.20+(wantsOwnership&&r.personal_coverage_confirmed?0.16:0)+(wantsOwnership&&!r.personal_coverage_confirmed?-0.05:0)+Math.min(r.document_authority/100,1)*0.06}))
    .sort((a,b)=>b.score-a.score).slice(0,args.limit??10)
    .map(({r})=>({id:r.id,policyId:r.policy_id,insurer:r.insurer,productName:r.product_name,pageStart:r.page_start,pageEnd:r.page_end,heading:r.heading,text:r.text,distance:Number(r.distance),documentRole:r.document_role,personalCoverageConfirmed:r.personal_coverage_confirmed,documentAuthority:r.document_authority}));
}

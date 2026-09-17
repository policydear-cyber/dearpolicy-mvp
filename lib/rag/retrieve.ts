import { query } from "@/lib/db/client";
import { embedTexts, toPgVector } from "@/lib/ai/embeddings";
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

export async function retrieveRelevantChunks(args:{accountId:string;familyMemberId:string;question:string;limit?:number;}):Promise<RetrievedChunk[]> {
  // One-off retrieval embedding: BGE-M3 is released before Qwen is asked to answer.
  const searchText=retrievalExpansion(args.question);
  const [vector]=await embedTexts([searchText]);
  const result=await query<ChunkRow>(
    `WITH vec AS (
       SELECT c.id,(c.embedding <=> $1::vector) AS distance
       FROM policy_chunks c JOIN policy_members pm ON pm.policy_id=c.policy_id AND pm.account_id=c.account_id
       WHERE c.account_id=$2 AND pm.family_member_id=$3
       ORDER BY c.embedding <=> $1::vector LIMIT 28
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
    [toPgVector(vector),args.accountId,args.familyMemberId,searchText],
  );
  const wantsOwnership=ownershipQuestion(args.question);
  return result.rows
    .map((r)=>({r,score:(1-Number(r.distance))*0.70+Math.min(Number(r.keyword_rank),1)*0.20+(wantsOwnership&&r.personal_coverage_confirmed?0.16:0)+(wantsOwnership&&!r.personal_coverage_confirmed?-0.05:0)+Math.min(r.document_authority/100,1)*0.06}))
    .sort((a,b)=>b.score-a.score).slice(0,args.limit??10)
    .map(({r})=>({id:r.id,policyId:r.policy_id,insurer:r.insurer,productName:r.product_name,pageStart:r.page_start,pageEnd:r.page_end,heading:r.heading,text:r.text,distance:Number(r.distance),documentRole:r.document_role,personalCoverageConfirmed:r.personal_coverage_confirmed,documentAuthority:r.document_authority}));
}

import { query } from "@/lib/db/client";
import { NON_COVER_ROLES } from "@/lib/documents/messy";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { canonicalDeathInsurer } from "@/lib/claims/death-evidence";
import { canonicalProduct, confirmedOwnedCoverages, type OwnedCoverage } from "@/lib/coverage/facts";
import { pineconeEnabled,searchPolicyPassages } from "@/lib/rag/pinecone";
import type { ClaimPerson } from "@/lib/claims/person";
import type { PolicySource } from "@/lib/chat/types";

/** Falls back to a readable label when a document has no extracted product
 * name yet -- a raw filename like "dps.pdf" or
 * "careshield_life_welcome_booklet_for_1980_2026.pdf" reads as broken when it
 * shows up inline in a sentence ("Upload the latest receipt for ... dps.pdf"),
 * so this turns separators and case boundaries into spaces and title-cases a
 * name that was all lowercase (snake_case/kebab-case filenames), while
 * leaving deliberate casing (acronyms, PascalCase) alone. */
export function prettifyFilename(filename:string):string {
  const base=filename.replace(/\.[a-zA-Z0-9]{1,5}$/,"");
  const spaced=base.replace(/[_\-]+/g," ").replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2").replace(/\s+/g," ").trim();
  if(!spaced)return filename;
  if(spaced===spaced.toLowerCase())return spaced.replace(/\b\w/g,c=>c.toUpperCase());
  return spaced;
}

export type InventoryDocument = {
  id:string;insurer:string|null;product_name:string|null;policy_number:string|null;group_policy_number:string|null;
  policy_type:string|null;document_role:string|null;personal_coverage_confirmed:boolean;document_authority:number;
  needs_review:boolean;processing_status:string;original_filename:string;updated_at:string;
  effective_date:string|null;renewal_or_expiry_date:string|null;member_ids:string[];
  products:string[];header:string;has_reference_sections?:boolean;
  /** People who told DearPolicy this policy is theirs. Uploading a welcome
   * booklet is a statement of ownership; it is still not proof of an amount. */
  declared_member_ids?:string[];
  /** People linked to the document by anything but its scheme (a name on it, the profile it was uploaded to, their own word). Missing in older callers. */
  named_member_ids?:string[];
  /** Stored corpus size for this document, used to measure how much of it was
   * actually retrieved and read. Both are 0 until processing stores text. */
  page_total:number;chunk_total:number;
};
export type PolicyContract = {
  id:string;ownerId:string;ownerName:string;name:string;insurer:string|null;
  documents:InventoryDocument[];references:InventoryDocument[];coverages:OwnedCoverage[];
  confirmed:boolean;effectiveDate:string|null;
  /** "evidence" when a personalised schedule proves ownership; "declared" when
   * the person told us it is theirs and no schedule has been uploaded yet. */
  ownershipBasis:"evidence"|"declared";
};
export const referenceRoles=new Set(["policy_wording","product_summary","benefit_guide","benefit_summary","rider"]);
/** Roles of a personal document. One that proves nobody's cover (a scheme's "Benefit Summary" read as a certificate,
 * naming no insured person) is the scheme's own wording, the same as a product summary. One that names a person, or
 * that someone said is theirs, is that person's evidence even unconfirmed, and is never another member's wording. */
const personalRoles=new Set(["certificate","personal_schedule"]);
/** Whether a document can be read as the wording of a contract someone owns. */
export function servesAsReference(doc:Pick<InventoryDocument,"document_role"|"personal_coverage_confirmed"|"document_authority"|"named_member_ids"|"declared_member_ids">){
  const role=doc.document_role??"";
  if(referenceRoles.has(role))return true;
  if(doc.personal_coverage_confirmed||!personalRoles.has(role)||doc.document_authority>=70)return false;
  // Not known whether anyone is named: not wording.
  if(!doc.named_member_ids)return false;
  return !doc.named_member_ids.length&&!(doc.declared_member_ids??[]).length;
}
export function normalizedIdentifier(value:string|null|undefined){return (value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");}
export function productIdentity(value:string|null|undefined){
  const normal=(value??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(/^(?:group )?(?:term life|personal accident|living care(?: plus)?)$|^(?:gtl|gpa)$/.test(normal))return canonicalProduct(normal);
  return normal;
}
function productMatch(owner:InventoryDocument,reference:InventoryDocument){
  const products=new Set([owner.product_name,...owner.products].map(productIdentity).filter(Boolean));
  return [reference.product_name,...reference.products].map(productIdentity).some(p=>!!p&&products.has(p));
}
function schemeTokens(document:InventoryDocument){
  const stop=new Set(["insurance","insured","policy","policies","group","scheme","product","summary","benefit","benefits","certificate","schedule","terms","conditions","singapore","singlife","life","term","personal","accident","living","care","limited","company"]);
  return new Set(((document.product_name??"")+" "+document.header.slice(0,900)).toLowerCase().match(/[a-z][a-z0-9]{2,}/g)?.filter(token=>!stop.has(token))??[]);
}
function sharedSchemeContext(owner:InventoryDocument,reference:InventoryDocument){
  const left=schemeTokens(owner),right=schemeTokens(reference);
  const shared=[...left].filter(token=>right.has(token));
  return shared.length>=2||shared.some(token=>token.length>=6);
}
/** Why a wording document does or does not support an owned document. The
 * boolean form below is the single source of truth for matching; this returns
 * the same decision plus a readable reason for diagnostics. */
export function referenceMatchReason(owner:InventoryDocument,reference:InventoryDocument):{matches:boolean;reason:string} {
  const yes=(reason:string)=>({matches:true,reason});
  const no=(reason:string)=>({matches:false,reason});
  if(owner.id===reference.id)return yes("Same document: one PDF holding both the personalised part and the wording.");
  if(reference.personal_coverage_confirmed)return no("This is someone's personalised evidence, which is never reused as reference wording.");
  if(!servesAsReference(reference))return no("Document role \""+(reference.document_role??"none")+"\" is not a wording role ("+[...referenceRoles].join(", ")+").");
  const insurer=canonicalDeathInsurer(owner.insurer);
  if(!insurer)return no("The owned document has no recognised insurer, so no wording can be bound to it.");
  if(insurer!==canonicalDeathInsurer(reference.insurer))return no("Insurer differs: owned \""+(owner.insurer??"none")+"\" vs wording \""+(reference.insurer??"none")+"\".");
  const group=normalizedIdentifier(owner.group_policy_number),refGroup=normalizedIdentifier(reference.group_policy_number);
  const policy=normalizedIdentifier(owner.policy_number),refPolicy=normalizedIdentifier(reference.policy_number);
  if(group&&refGroup){
    if(group!==refGroup)return no("Group policy number differs: "+group+" vs "+refGroup+".");
    if(policy&&refPolicy&&refPolicy!==refGroup&&policy!==refPolicy)return no("Same group "+group+" but a different policy number: "+policy+" vs "+refPolicy+".");
    return yes("Same insurer and group policy number "+group+".");
  }
  if(policy&&refPolicy)return policy===refPolicy?yes("Same insurer and policy number "+policy+"."):no("Policy number differs: "+policy+" vs "+refPolicy+".");
  const matchesProduct=productMatch(owner,reference);
  if(group||refGroup){
    if(!matchesProduct)return no("Only one document carries a group number and the product names do not match.");
    const identifier=group||refGroup;
    const unnumbered=group?reference:owner;
    // Some benefit/product summaries print a scheme name but omit the group
    // number from the extracted metadata. Accept that weaker link only when
    // the exact owned product also matches and the document itself contains
    // the number or a distinctive shared scheme identity.
    if(normalizedIdentifier(unnumbered.header).includes(identifier))return yes("Matching product, and the other document's first pages contain group number "+identifier+".");
    if(sharedSchemeContext(owner,reference))return yes("Matching product and a distinctive shared scheme name, though only one document records group number "+identifier+".");
    return no("Matching product, but group number "+identifier+" appears on only one document and no shared scheme name was found.");
  }
  return matchesProduct?yes("Same insurer and matching product name."):no("Same insurer, but no shared group number, policy number or product name.");
}
export function referenceMatches(owner:InventoryDocument,reference:InventoryDocument):boolean {
  return referenceMatchReason(owner,reference).matches;
}
export function buildContracts(documents:InventoryDocument[],people:ClaimPerson[],coverages:OwnedCoverage[]):PolicyContract[] {
  const contracts=new Map<string,PolicyContract>();
  for(const owner of documents){
    const evidenced=owner.personal_coverage_confirmed&&owner.document_authority>=70;
    const declaredFor=new Set(owner.declared_member_ids??[]);
    if(!evidenced&&!declaredFor.size)continue;
    const holders=evidenced?owner.member_ids:[...declaredFor];
    for(const person of people.filter(p=>holders.includes(p.id))){
      const owned=coverages.filter(c=>c.policyId===owner.id&&c.familyMemberId===person.id);
      const identity=normalizedIdentifier(owner.policy_number)||("document:"+owner.id);
      const key=person.id+":"+canonicalDeathInsurer(owner.insurer)+":"+identity;
      const contract=contracts.get(key)??{id:key,ownerId:person.id,ownerName:person.display_name,
        name:owner.product_name??prettifyFilename(owner.original_filename),insurer:owner.insurer,documents:[],references:[],coverages:[],
        confirmed:false,effectiveDate:owner.effective_date,
        ownershipBasis:evidenced?"evidence" as const:"declared" as const};
      contract.documents.push(owner);contract.coverages.push(...owned);
      contract.confirmed||=owned.length>0;
      if(evidenced)contract.ownershipBasis="evidence";
      contracts.set(key,contract);
    }
  }
  for(const contract of contracts.values()){
    contract.documents.sort((a,b)=>b.document_authority-a.document_authority||b.updated_at.localeCompare(a.updated_at));
    // Preserve versions and conflicting amounts. Never silently add an
    // endorsement to the schedule that it supersedes.
    const byProduct=new Map<string,OwnedCoverage>();
    for(const coverage of [...contract.coverages].sort((a,b)=>contract.documents.findIndex(d=>d.id===a.policyId)-contract.documents.findIndex(d=>d.id===b.policyId))){
      const key=productIdentity(coverage.productName)+":"+coverage.category;
      if(!byProduct.has(key))byProduct.set(key,coverage);
    }
    contract.coverages=[...byProduct.values()];
    contract.references=documents.filter(reference=>!contract.documents.some(d=>d.id===reference.id)&&contract.documents.some(owner=>referenceMatches(owner,reference)));
    contract.effectiveDate=contract.documents[0]?.effective_date??null;
  }
  return [...contracts.values()];
}
export async function loadPolicyInventory(accountId:string,people:ClaimPerson[]) {
  const documents:InventoryDocument[]=[];
  let cursor:string|null=null;
  // Keyset pagination is a work batch, not a policy limit.
  for(;;){
    const r:{rows:InventoryDocument[]}=await query<InventoryDocument>(
      `SELECT p.id,p.insurer,p.product_name,p.policy_number,p.group_policy_number,p.policy_type,p.document_role,p.personal_coverage_confirmed,p.document_authority,p.needs_review,p.processing_status,p.original_filename,p.updated_at::text,p.effective_date::text,p.renewal_or_expiry_date::text,(SELECT count(*)::int FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id) AS page_total,(SELECT count(*)::int FROM policy_chunks pc WHERE pc.account_id=p.account_id AND pc.policy_id=p.id) AS chunk_total,ARRAY(SELECT pm.family_member_id::text FROM policy_members pm WHERE pm.account_id=p.account_id AND pm.policy_id=p.id) AS member_ids,ARRAY(SELECT pm.family_member_id::text FROM policy_members pm WHERE pm.account_id=p.account_id AND pm.policy_id=p.id AND pm.source='user_declared') AS declared_member_ids,ARRAY(SELECT pm.family_member_id::text FROM policy_members pm WHERE pm.account_id=p.account_id AND pm.policy_id=p.id AND pm.source<>'scheme_reference_match') AS named_member_ids,coalesce(p.extracted_json->'productsMentioned','[]'::jsonb) AS products,coalesce((SELECT string_agg(pp.text,' ' ORDER BY pp.page_number) FROM policy_pages pp WHERE pp.account_id=p.account_id AND pp.policy_id=p.id AND pp.page_number<=2),'') AS header,EXISTS(SELECT 1 FROM policy_reference_coverages prc WHERE prc.account_id=p.account_id AND prc.policy_id=p.id) AS has_reference_sections FROM policies p WHERE p.account_id=$1 AND (${activePredicate("p")}) AND p.superseded_at IS NULL AND ($2::uuid IS NULL OR p.id>$2::uuid) ORDER BY p.id LIMIT 200`,
      [accountId,cursor]);
    for(const doc of r.rows){
      doc.products=Array.isArray(doc.products)?doc.products:[];
      doc.page_total=Number(doc.page_total)||0;doc.chunk_total=Number(doc.chunk_total)||0;
      doc.declared_member_ids=Array.isArray(doc.declared_member_ids)?doc.declared_member_ids:[];
      if(!doc.group_policy_number)doc.group_policy_number=doc.header.match(/group\s+policy\s+(?:no\.?|number)\s*[:#-]?\s*([A-Z0-9-]{4,})/i)?.[1]??null;
      if(!doc.insurer&&/\bSingapore Life Ltd\b/i.test(doc.header))doc.insurer="Singapore Life Ltd";
      // Round 10: a letter, claim decision, bill, app screenshot or the family's
      // own notes is never a contract (lib/chat/document-questions.ts answers from them).
      if(NON_COVER_ROLES.has(doc.document_role??""))continue;
      documents.push(doc);
    }
    if(r.rows.length<200)break;cursor=r.rows.at(-1)!.id;
  }
  const coverages=(await Promise.all(people.map(p=>confirmedOwnedCoverages(accountId,p.id)))).flat();
  // Extraction metadata is deliberately conservative. Confirmed coverage rows
  // are stronger product evidence for their own personal document, so use them
  // to enrich matching without changing ownership or inventing a contract.
  for(const doc of documents){
    const ownedProducts=coverages.filter(coverage=>coverage.policyId===doc.id).map(coverage=>coverage.productName).filter((name):name is string=>!!name);
    doc.products=[...new Set([...doc.products,...ownedProducts])];
  }
  const personal=documents.filter(d=>d.personal_coverage_confirmed);
  const products=[...new Set([...personal.flatMap(d=>[d.product_name,...d.products]),...coverages.map(c=>c.productName)].filter((p):p is string=>!!p))];
  const issuers=[...new Set(personal.map(d=>d.insurer).filter((p):p is string=>!!p))];
  for(const doc of documents.filter(d=>!d.personal_coverage_confirmed&&servesAsReference(d))){
    const header=" "+doc.header.toLowerCase().replace(/[^a-z0-9]+/g," ")+" ";
    if(!doc.insurer){
      const matches=issuers.filter(name=>name.length>=3&&header.includes(" "+name.toLowerCase().replace(/[^a-z0-9]+/g," ")+" "));
      if(new Set(matches.map(canonicalDeathInsurer)).size===1)doc.insurer=matches[0];
    }
    if(!doc.products.length)doc.products=products.filter(name=>header.includes(" "+name.toLowerCase().replace(/[^a-z0-9]+/g," ")+" "));
  }
  return {documents,contracts:buildContracts(documents,people,coverages),coverages};
}
function escaped(value:string){return value.replace(/[.*+?^$()|[\]\\]/g,"\\$&");}
export function pageProductScopes(pages:{page_number:number;text:string}[],products:string[]) {
  const result=new Map<number,string[]>();let current:string[]=[];
  const names=[...new Set(products.filter(Boolean))].sort((a,b)=>b.length-a.length);
  for(const page of [...pages].sort((a,b)=>a.page_number-b.page_number)){
    const found=names.filter(name=>new RegExp("(?:BENEFIT\\s*\\d+\\s*[:.-]\\s*|(?:PRODUCT\\s+SUMMARY\\s*[:.-]?\\s*)?)"+escaped(name)+"\\b","i").test(page.text.slice(0,650)));
    if(found.length)current=found.filter(name=>!found.some(other=>other!==name&&productIdentity(other).startsWith(productIdentity(name)+" ")));
    result.set(page.page_number,[...current]);
  }
  return result;
}
/** Retrieval depth per document.
 *
 * A fixed six passages is fine for a two-page schedule and far too few for a
 * forty-page multi-product booklet, where the responsive benefit table can sit
 * well outside the top six. The cap therefore scales with how much text the
 * document actually stores, with a floor for small documents and a ceiling
 * that -- for a local model -- keeps its reading work bounded on an 8 GB GPU.
 * A hosted model has no such ceiling to respect, and a low one is exactly how
 * a real benefit table can rank just outside the retrieved set and never
 * reach the model at all, which is indistinguishable from the model failing
 * to find it. Tune with RAG_MIN_PASSAGES_PER_DOCUMENT / RAG_MAX_PASSAGES_PER_DOCUMENT. */
export const DEFAULT_MIN_PASSAGES_PER_DOCUMENT=6;
export const DEFAULT_MAX_PASSAGES_PER_DOCUMENT=16;
export const HOSTED_MAX_PASSAGES_PER_DOCUMENT=40;
function configuredPassageBound(name:string,fallback:number){
  const value=Number(process.env[name]);
  return Number.isFinite(value)&&value>=1&&value<=200?Math.floor(value):fallback;
}
export function passageBudget(chunkTotal:number,share=0.35){
  const minimum=configuredPassageBound("RAG_MIN_PASSAGES_PER_DOCUMENT",DEFAULT_MIN_PASSAGES_PER_DOCUMENT);
  const maximum=Math.max(minimum,configuredPassageBound("RAG_MAX_PASSAGES_PER_DOCUMENT",HOSTED_MAX_PASSAGES_PER_DOCUMENT));
  const stored=Number.isFinite(chunkTotal)&&chunkTotal>0?Math.floor(chunkTotal):0;
  if(!stored)return minimum;
  return Math.min(maximum,stored,Math.max(minimum,Math.ceil(stored*share)));
}
export function searchExpression(message:string,extra:string[]=[]){
  const stop=new Set(["what","when","which","where","this","that","with","from","have","does","would","could","should","about","claim","claims","policy","policies","know","still","please","dearpolicy"]);
  const words=[message,...extra].join(" ").toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)??[];
  return [...new Set(words.filter(w=>!stop.has(w)))].slice(0,32).join(" OR ")||"benefit OR conditions OR exclusions";
}
export function analysisSources(sources:PolicySource[],maximumSemanticDistance?:number){
  const signalled=sources.some(s=>s.lexicalMatch!==undefined||s.semanticDistance!==undefined);
  if(!signalled)return sources;
  const configured=Number(process.env.RAG_MAX_COSINE_DISTANCE??maximumSemanticDistance??0.72);
  const maximum=Number.isFinite(configured)&&configured>=0&&configured<=2?configured:0.72;
  return sources.filter(s=>s.lexicalMatch===true||(typeof s.semanticDistance==="number"&&Number.isFinite(s.semanticDistance)&&s.semanticDistance<=maximum));
}
/** Round 12: passages come back in one fixed order (document, page, text) and ties are broken by text before
 * the random chunk id, so the same question reads the same passages in the same order on every run. */
export async function retrieveContractSources(args:{accountId:string;contracts:PolicyContract[];question:string;searchTerms:string[]}) {
  const documents=[...new Map(args.contracts.flatMap(c=>[...c.documents,...c.references]).filter(d=>d.processing_status==="ready").map(d=>[d.id,d])).values()];
  if(!documents.length)return new Map<string,PolicySource[]>();
  const ids=documents.map(d=>d.id);
  const caps=documents.map(d=>passageBudget(d.chunk_total));
  const searchText=args.question+" "+args.searchTerms.join(" ");
  // The semantic half of retrieval. Pinecone holds the vectors and embeds both
  // sides, so this asks it which stored passages read like an answer and gets
  // back chunk ids; the text itself still comes from Postgres below. A failure
  // here only costs semantic ranking: indexed lexical retrieval carries the
  // query on its own.
  let semanticIds:string[]=[];
  let semanticDistances:number[]=[];
  if(pineconeEnabled()){
    try{
      const hits=await searchPolicyPassages({accountId:args.accountId,policyIds:ids,text:searchText,
        topK:Math.min(Math.max(caps.reduce((total,cap)=>total+cap,0),20),100)});
      semanticIds=hits.map(h=>h.chunkId);semanticDistances=hits.map(h=>h.distance);
    }catch(error){console.warn("Pinecone retrieval failed:",error instanceof Error?error.message:error);}
  }
  const r=await query<{id:string;policy_id:string;page_start:number;page_end:number;text:string;lexical_match:boolean;semantic_distance:number|null}>(
    "WITH wanted AS (SELECT * FROM unnest($2::uuid[],$5::int[]) AS t(id,cap)), terms AS (SELECT websearch_to_tsquery('english',$3) AS q), semantic AS (SELECT * FROM unnest($4::uuid[],$6::float8[]) AS s(id,distance)) SELECT DISTINCT c.id,c.policy_id,c.page_start,c.page_end,c.text,c.lexical_match,c.semantic_distance FROM wanted w CROSS JOIN LATERAL (SELECT x.id,x.policy_id,x.page_start,x.page_end,x.text,(x.search_vector @@ terms.q) AS lexical_match,s.distance AS semantic_distance FROM policy_chunks x CROSS JOIN terms LEFT JOIN semantic s ON s.id=x.id WHERE x.account_id=$1 AND x.policy_id=w.id ORDER BY (CASE WHEN x.search_vector @@ terms.q THEN 1 ELSE 0 END) DESC,ts_rank_cd(x.search_vector,terms.q) DESC,s.distance NULLS LAST,x.page_start,x.page_end,x.text,x.id LIMIT w.cap) c ORDER BY c.policy_id,c.page_start,c.page_end,c.text,c.id",
    [args.accountId,ids,searchExpression(args.question,args.searchTerms),semanticIds,caps,semanticDistances]);
  const pages=await query<{policy_id:string;page_number:number;text:string}>(
    "SELECT policy_id,page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id=ANY($2::uuid[]) ORDER BY policy_id,page_number",[args.accountId,ids]);
  const productsByDoc=new Map<string,Set<string>>();
  const pagesByDoc=new Map<string,{page_number:number;text:string}[]>();
  for(const page of pages.rows){const values=pagesByDoc.get(page.policy_id)??[];values.push(page);pagesByDoc.set(page.policy_id,values);}
  for(const contract of args.contracts)for(const doc of [...contract.documents,...contract.references]){
    const products=productsByDoc.get(doc.id)??new Set<string>();
    for(const coverage of contract.coverages)products.add(coverage.productName??contract.name);
    productsByDoc.set(doc.id,products);
  }
  const scopes=new Map(documents.map(doc=>[doc.id,pageProductScopes(pagesByDoc.get(doc.id)??[],[...(productsByDoc.get(doc.id)??[]),...doc.products])]));
  const docsById=new Map(documents.map(doc=>[doc.id,doc]));
  const rowsByDoc=new Map<string,typeof r.rows>();
  for(const row of r.rows){const values=rowsByDoc.get(row.policy_id)??[];values.push(row);rowsByDoc.set(row.policy_id,values);}
  const sourceMap=new Map<string,PolicySource[]>();
  for(const contract of args.contracts){
    const allowed=new Set([...contract.documents,...contract.references].map(d=>d.id));
    sourceMap.set(contract.id,[...allowed].flatMap(id=>rowsByDoc.get(id)??[]).map(row=>{
      const doc=docsById.get(row.policy_id)!;
      return {id:row.id,policyId:row.policy_id,text:row.text,pageStart:row.page_start,pageEnd:row.page_end,
        lexicalMatch:row.lexical_match,semanticDistance:row.semantic_distance,
        productScopes:scopes.get(doc.id)?.get(row.page_start)??[],
        citation:{chunkId:row.id,policyId:doc.id,policyName:doc.product_name??prettifyFilename(doc.original_filename),insurer:doc.insurer??undefined,
          pageStart:row.page_start,pageEnd:row.page_end,documentRole:doc.document_role,
          personalEvidence:contract.documents.some(d=>d.id===doc.id),evidenceLabel:contract.documents.some(d=>d.id===doc.id)?"Personal document":"Policy wording"}};
    }));
  }
  return sourceMap;
}

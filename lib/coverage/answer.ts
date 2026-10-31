import { confirmedOwnedCoverages, type OwnedCoverage } from "./facts";
import { formatMoney } from "@/lib/format/currency";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import type { ChatAnswer,ChatCitation } from "@/types";

const CORE=["Hospitalisation","Hospital Cash","Death","Critical Illness","Early Critical Illness","Total Permanent Disability","Personal Accident","Disability Income","Outpatient"];
function specificCategory(q:string){const v=q.toLowerCase();if(/early.*critical/.test(v))return"Early Critical Illness";if(/critical|cancer/.test(v))return"Critical Illness";if(/\btpd\b|total.*permanent/.test(v))return"Total Permanent Disability";if(/personal accident|accident cover/.test(v))return"Personal Accident";if(/disability income/.test(v))return"Disability Income";if(/outpatient/.test(v))return"Outpatient";if(/hospital cash/.test(v))return"Hospital Cash";if(/hospital|medical cover/.test(v))return"Hospitalisation";if(/death|life cover|term life/.test(v))return"Death";return null;}
export function looksLikePortfolioQuestion(q:string){return /\b(what.*covered|what.*coverage|what do i have|how much.*cover|sum insured|sum assured|am i covered|not covered|coverage amount)\b/i.test(q);}
function cite(c:OwnedCoverage):ChatCitation{return{chunkId:`coverage:${c.id}`,policyId:c.policyId,policyName:c.productName??c.policyName??"Policy",insurer:c.insurer??undefined,pageStart:c.sourcePage??null,pageEnd:c.sourcePage??null,documentRole:c.documentRole,personalEvidence:true,evidenceLabel:"Personal cover"};}
/** Not finding a cover in the uploaded documents is never "Not covered": only a document can say that (coordinator, 31 Oct).
 * A policy that was not uploaded, or a page that was not read, may still hold it. */
const NOT_FOUND_IS_NOT_NONE="A policy that hasn't been uploaded, or a page that couldn't be read, may still include it.";
async function personName(accountId:string,familyMemberId:string){
 const r=await query<{name:string|null}>("SELECT COALESCE(NULLIF(preferred_name,''),display_name) AS name FROM family_members WHERE id=$1 AND account_id=$2 AND "+activePredicate(),[familyMemberId,accountId]);
 return r.rows[0]?.name?.trim()||"this person";
}
export async function answerPortfolioQuestion(accountId:string,familyMemberId:string,question:string):Promise<ChatAnswer>{
 const [owned,name]=await Promise.all([confirmedOwnedCoverages(accountId,familyMemberId),personName(accountId,familyMemberId)]);const target=specificCategory(question);const notCovered=/not covered|don'?t have|do not have/i.test(question);
 const byCat=new Map<string,OwnedCoverage[]>();for(const c of owned){const a=byCat.get(c.category)??[];a.push(c);byCat.set(c.category,a);}
 let summary="",details:string[]=[];let citations:ChatCitation[]=[];
 if(target){const rows=byCat.get(target)??[];if(rows.length){const amount=rows.reduce((s,r)=>s+(r.amount??0),0);const c=rows[0];summary=`Covered — ${target}${amount>0?` is ${formatMoney(amount,c.currency)}`:" is confirmed in your personal policy evidence"}.`;details=rows.map(r=>`${r.productName??r.policyName??r.category}${r.policyNumber?` · Policy ${r.policyNumber}`:""}`);citations=rows.map(cite);}else {summary=`I couldn't find ${target} cover for ${name} in the personal policies uploaded.`;details=[NOT_FOUND_IS_NOT_NONE];if(target==="Hospitalisation"&&byCat.has("Hospital Cash")){const h=byCat.get("Hospital Cash")![0];details=[`You do have a separate Hospital Cash benefit${h.productName??h.policyName?` under ${h.productName??h.policyName}`:""}. That is a fixed cash benefit, not general hospital-bill coverage.`,NOT_FOUND_IS_NOT_NONE];}}}
 else if(notCovered){const missing=CORE.filter(c=>!byCat.has(c));summary=missing.length?`I couldn't find these covers for ${name} in the personal policies uploaded: ${missing.join(", ")}.`:"All core categories in DearPolicy's current portfolio view have confirmed cover.";details=["This is based on personalised ownership evidence, not on which products appear in brochures or product summaries.",...(missing.length?[NOT_FOUND_IS_NOT_NONE]:[])];citations=owned.slice(0,4).map(cite);}
 else{const covered=[...new Set(owned.map(c=>c.category))];summary=covered.length?`Confirmed cover: ${covered.join(", ")}.`:"I do not have a personalised certificate or schedule that confirms coverage for this person yet.";details=owned.map(c=>`${c.category}: ${c.amount!=null?formatMoney(c.amount,c.currency):"confirmed"} · ${c.productName??c.policyName??"Policy"}`);citations=owned.slice(0,8).map(cite);}
 return{mode:"answer",summary,details,claimItems:[],nextSteps:[],confidence:citations.length?"strong_match":"insufficient_evidence",citations,disclaimer:"Coverage status is based on the personal policy evidence uploaded to DearPolicy. Active status can be checked separately with recent renewal/payment evidence.",claimSessionId:null,questions:[],knownFacts:[],missingFacts:[]};
}

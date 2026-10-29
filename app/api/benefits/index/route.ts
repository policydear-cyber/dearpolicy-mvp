import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { ensureBenefitSchema } from "@/lib/policies/benefit-catalog";
import { ensureConditionSchema } from "@/lib/policies/condition-catalog";
import { readingModelLabel } from "@/lib/ai/reading-model";
import { BENEFIT_READ_FAILURE_KEY,READ_FAILURE_REASON,noteReadFailure,readFailureNotes } from "@/lib/policies/read-failures";
import { maskIdentityText,maskShownText } from "@/lib/chat/identity-numbers";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Reading a document's benefit rules from the page text already stored.
 *
 * Documents are read on the way in, so this exists for the two cases where that
 * did not happen: a document uploaded before DearPolicy learned to read
 * schedules, and one whose reading failed at the time. It never re-opens the
 * PDF and never runs OCR — the pages are already in the database — so it is far
 * quicker than a full re-analysis and cannot disturb anything that was
 * extracted from the original file. */
type Unread={id:string;name:string;product_name:string|null;pages:number};
async function unreadDocuments(accountId:string){
  const result=await query<Unread>(
    `SELECT p.id,coalesce(p.product_name,p.original_filename) AS name,p.product_name,
            (SELECT count(*)::int FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id) AS pages
       FROM policies p
      WHERE p.account_id=$1 AND p.processing_status='ready' AND p.benefits_indexed_at IS NULL AND ${activePredicate("p")}
        AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
      ORDER BY p.created_at`,[accountId]);
  return result.rows;
}

/** Every readable document, for a deliberate re-read — after the reading model
 * changes, say. Re-reading keeps any rule a person has corrected. */
async function allDocuments(accountId:string){
  const result=await query<Unread>(
    `SELECT p.id,coalesce(p.product_name,p.original_filename) AS name,p.product_name,
            (SELECT count(*)::int FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id) AS pages
       FROM policies p
      WHERE p.account_id=$1 AND p.processing_status='ready' AND ${activePredicate("p")}
        AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
      ORDER BY p.created_at`,[accountId]);
  return result.rows;
}
/** Documents whose benefit rules have been read but whose conditions have not.
 * Every document uploaded before the conditions pass existed is one of these. */
async function conditionlessDocuments(accountId:string){
  const result=await query<Unread>(
    `SELECT p.id,coalesce(p.product_name,p.original_filename) AS name,p.product_name,
            (SELECT count(*)::int FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id) AS pages
       FROM policies p
      WHERE p.account_id=$1 AND p.processing_status='ready' AND p.conditions_indexed_at IS NULL AND ${activePredicate("p")}
        AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
      ORDER BY p.created_at`,[accountId]);
  return result.rows;
}
/** Where each unread document stands: waiting (not read yet) or failed (its
 * last read failed; reasonCode/reason say why, in words safe to show). */
async function readingStates(accountId:string,unread:Unread[]){
  const notes=await readFailureNotes(accountId,unread.map(d=>d.id),BENEFIT_READ_FAILURE_KEY);
  return unread.map(d=>{
    const note=notes.get(d.id);
    return {policyId:d.id,name:d.name,state:note?"failed" as const:"waiting" as const,reasonCode:note?.reasonCode??null,
      reason:note?READ_FAILURE_REASON[note.reasonCode]:null,attempts:note?.attempts??0,lastFailedAt:note?.lastFailedAt??null};
  });
}
export async function GET(request:NextRequest){
  try{
    await ensureBenefitSchema();
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    const all=new URL(request.url).searchParams.get("all")==="1";
    const unread=await unreadDocuments(accountId);
    // Document names are shown: ID numbers in them are masked, as on every other screen (row ids are kept).
    return NextResponse.json(maskShownText({unread,documents:await readingStates(accountId,unread),...(all?{all:await allDocuments(accountId)}:{}),
      reader:readingModelLabel()}));
  }catch(error){
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not check which documents still need reading"},{status:500});
    return authResponse;
  }
}

const Schema=z.object({policyId:z.string().uuid().optional(),
  /** Read only the conditions -- the exclusions, waiting periods and caps --
   * leaving the benefit rules exactly as they are. A document whose rules are
   * already right does not need reading twice to gain its conditions. */
  conditionsOnly:z.boolean().optional()});
/** Reads ONE document per request. A booklet can take minutes, so the screen
 * asks for the next one each time and can show real progress instead of
 * freezing on a single call that covers the whole household. */
export async function POST(request:NextRequest){
  try{
    const body=Schema.parse(await request.json().catch(()=>({})));
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    await ensureBenefitSchema();
    // The conditions table carries the column the query below filters on.
    await ensureConditionSchema().catch(()=>{});
    const pending=body.conditionsOnly?await conditionlessDocuments(accountId):await unreadDocuments(accountId);
    const target=body.policyId
      ?(await query<{id:string;name:string;product_name:string|null}>(
        `SELECT id,coalesce(product_name,original_filename) AS name,product_name FROM policies WHERE id=$1 AND account_id=$2 AND processing_status='ready' AND ${activePredicate()}`,
        [body.policyId,accountId])).rows[0]
      :pending[0];
    if(!target)return NextResponse.json({done:true,remaining:0});
    const { catalogueDocument,documentPages }=await import("@/lib/policies/catalog-builder");
    const pages=await documentPages(accountId,target.id);
    if(!pages.length){
      await noteReadFailure(accountId,target.id,BENEFIT_READ_FAILURE_KEY,new Error("no_pages"));
      return NextResponse.json({error:"This document has no stored pages yet. Use Re-analyse on the Documents page instead."},{status:409});
    }
    let stored=0;
    try{
      stored=body.conditionsOnly?0
        :await catalogueDocument({accountId,policyId:target.id,productName:target.product_name,pages});
    }catch(error){
      if(!body.conditionsOnly)await noteReadFailure(accountId,target.id,BENEFIT_READ_FAILURE_KEY,error);
      throw error;
    }
    // Rebuilding a document's rules rebuilds its conditions too: a benefit
    // table without its exclusions is the half-read state this replaced.
    let conditions=0;
    try{
      const { catalogueConditions }=await import("@/lib/policies/condition-catalog");
      conditions=await catalogueConditions({accountId,policyId:target.id,productName:target.product_name,pages});
    }catch{/* conditions are additive; a failure never blocks the rules */}
    const remaining=(await unreadDocuments(accountId)).length;
    return NextResponse.json({policyId:target.id,name:maskIdentityText(target.name),stored,conditions,remaining,done:remaining===0});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"That request could not be read."},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not read that document's benefit rules"},{status:500});
    return authResponse;
  }
}

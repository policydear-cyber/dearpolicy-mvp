import { NextResponse } from "next/server";
import { z } from "zod";
import { devAccountId,query } from "@/lib/db/client";
import { ensureBenefitSchema } from "@/lib/policies/benefit-catalog";
import { ensureConditionSchema } from "@/lib/policies/condition-catalog";
import { readingModelLabel } from "@/lib/ai/reading-model";

export const runtime="nodejs";

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
      WHERE p.account_id=$1 AND p.processing_status='ready' AND p.benefits_indexed_at IS NULL
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
      WHERE p.account_id=$1 AND p.processing_status='ready'
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
      WHERE p.account_id=$1 AND p.processing_status='ready' AND p.conditions_indexed_at IS NULL
        AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
      ORDER BY p.created_at`,[accountId]);
  return result.rows;
}
export async function GET(request:Request){
  try{
    await ensureBenefitSchema();
    const accountId=devAccountId();
    const all=new URL(request.url).searchParams.get("all")==="1";
    return NextResponse.json({unread:await unreadDocuments(accountId),...(all?{all:await allDocuments(accountId)}:{}),
      reader:readingModelLabel()});
  }catch(error){
    return NextResponse.json({error:"Could not check which documents still need reading"},{status:500});
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
export async function POST(request:Request){
  try{
    const body=Schema.parse(await request.json().catch(()=>({})));
    const accountId=devAccountId();
    await ensureBenefitSchema();
    // The conditions table carries the column the query below filters on.
    await ensureConditionSchema().catch(()=>{});
    const pending=body.conditionsOnly?await conditionlessDocuments(accountId):await unreadDocuments(accountId);
    const target=body.policyId
      ?(await query<{id:string;name:string;product_name:string|null}>(
        `SELECT id,coalesce(product_name,original_filename) AS name,product_name FROM policies WHERE id=$1 AND account_id=$2 AND processing_status='ready'`,
        [body.policyId,accountId])).rows[0]
      :pending[0];
    if(!target)return NextResponse.json({done:true,remaining:0});
    const { catalogueDocument,documentPages }=await import("@/lib/policies/catalog-builder");
    const pages=await documentPages(accountId,target.id);
    if(!pages.length)
      return NextResponse.json({error:"This document has no stored pages yet. Use Re-analyse on the Documents page instead."},{status:409});
    const stored=body.conditionsOnly?0
      :await catalogueDocument({accountId,policyId:target.id,productName:target.product_name,pages});
    // Rebuilding a document's rules rebuilds its conditions too: a benefit
    // table without its exclusions is the half-read state this replaced.
    let conditions=0;
    try{
      const { catalogueConditions }=await import("@/lib/policies/condition-catalog");
      conditions=await catalogueConditions({accountId,policyId:target.id,productName:target.product_name,pages});
    }catch{/* conditions are additive; a failure never blocks the rules */}
    const remaining=(await unreadDocuments(accountId)).length;
    return NextResponse.json({policyId:target.id,name:target.name,stored,conditions,remaining,done:remaining===0});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"That request could not be read."},{status:400});
    return NextResponse.json({error:"Could not read that document's benefit rules"},{status:500});
  }
}

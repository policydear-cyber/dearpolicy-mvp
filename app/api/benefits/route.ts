import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isUuid,query } from "@/lib/db/client";
import { nameWithoutPlanCell } from "@/lib/insurance/scale-limit";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { isWarmPing } from "@/lib/http/warm-ping";
import { coverageForBenefit,describeBenefitFormula,describeScheduleTerm,isScheduleTerm,ensureBenefitSchema,isRulelessCoverLine,looksLikeCoverageLine,namesNoBenefit,repairStoredRules,reviewedBenefitFormula,type CatalogBenefit } from "@/lib/policies/benefit-catalog";

import { documentName,loadPolicyInventory } from "@/lib/policies/inventory";
import { ensureConditionSchema } from "@/lib/policies/condition-catalog";
import { inNumberedOrder } from "@/lib/policies/benefit-order";
import { conditionEffect,describeCondition,type CoverCondition,type CoverConditionKind,type ExcludedCause } from "@/lib/insurance/cover-conditions";
import { formatMoney } from "@/lib/format/currency";
import { cutNameSuffix } from "@/lib/policies/cut-name";
import { wholeSumAgainst } from "@/lib/policies/whole-sum";
import { oncePerPerson } from "@/lib/policies/benefit-people";
import { amountAlternatives } from "@/lib/policies/amount-alternatives";
import { PLAN_COLUMNS_NOTE,planCellRun,planColumnFigure,type PlanColumnReading } from "@/lib/insurance/scale-limit";
import { maskShownText,sentName } from "@/lib/chat/identity-numbers";
import { documentKinds,type DocumentKind } from "@/lib/coverage/table-figures";

export const runtime="nodejs";

async function warmPing(){
  const headers={"Cache-Control":"private, no-store"};
  try{await Promise.all([query("SELECT 1"),import("@/lib/benefit-table/app")]);return new NextResponse(null,{status:204,headers});}
  catch{return new NextResponse(null,{status:503,headers});}
}
export const ROUTE_AUTH = "household-member" as const;

/** The benefit schedule: every payout rule DearPolicy has read out of the
 * household's documents, in plain English, with the page it came from.
 *
 * This is the screen that makes imperfect extraction acceptable. A rule that
 * was misread is visible before a claim happens, and correcting it once makes
 * that household permanently right — the correction is stored, not re-derived,
 * so re-reading the document can never quietly undo it. */
type Row={
  id:string;policy_id:string;product_name:string|null;benefit_name:string;traits:string[];
  formula_kind:string;formula_value:string|null;currency:string|null;fact_key:string|null;
  offset_days:number|null;maximum_days:number|null;source_page:number|null;quote:string;
  conditions:unknown;requirements:unknown;needs_review:boolean;reviewed_at:string|null;basis_inferred:boolean;
  original_filename:string;insurer:string|null;document_role:string|null;document_product:string|null;document_policy_number:string|null;
  owner_names:string[]|null;tier:string|null;row_kind:string|null;
};

type ConditionRow={id:string;policy_id:string;product_name:string|null;condition_kind:string;
        cause:string|null;condition_names:string[];days:number|null;amount:string|null;amount_basis:string|null;
        scope:string|null;carve_out:string|null;source_page:number|null;quote:string;needs_review:boolean;
        original_filename:string;insurer:string|null;document_role:string|null;document_product:string|null;document_policy_number:string|null};
const CONDITIONS_SQL=`SELECT c.id,c.policy_id,c.product_name,c.condition_kind,c.cause,c.condition_names,c.days,c.amount::text,
                c.amount_basis,c.scope,c.carve_out,c.source_page,c.quote,c.needs_review,p.original_filename,
                p.insurer,p.document_role,p.product_name AS document_product,p.policy_number AS document_policy_number
           FROM policy_cover_conditions c
           JOIN policies p ON p.id=c.policy_id AND p.account_id=c.account_id AND p.superseded_at IS NULL AND ${activePredicate("p")}
          WHERE c.account_id=$1
            AND ($2::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM policy_members pm
                   WHERE pm.policy_id=c.policy_id AND pm.account_id=c.account_id AND pm.family_member_id=$2::uuid))
          ORDER BY c.product_name NULLS FIRST,c.condition_kind,c.source_page`;
export async function GET(request:NextRequest){
  // The keep-awake ping (lib/http/warm-ping.ts), allowed signed out: load what a real load needs (the database pool,
  // the benefit table's modules) and answer with no body. Nothing about any household is read or returned.
  if(isWarmPing(request))return warmPing();
  try{
    const url=new URL(request.url);
    const member=url.searchParams.get("familyMemberId");
    if(member&&!isUuid(member))return NextResponse.json({benefits:[],summary:{total:0,needsYou:0,unreadable:0,usable:0,documents:0,unclaimed:0}});
    // How long each part took, sent as Server-Timing so a slow load on the live site can be told apart (sign-in, the
    // stored rows, the documents' cover, the benefit table, conditions). Durations only, nothing about the household.
    const started=performance.now(),timings:string[]=[];let mark=started;
    const lap=(name:string)=>{const now=performance.now();timings.push(`${name};dur=${(now-mark).toFixed(0)}`);mark=now;};
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    lap("auth");
    // The household's benefit table, built at most once per request and started now, so its page checks run while the
    // stored rows below are fetched. Both uses below share it; without the table nothing is built.
    const tableTimer=performance.now();let tableMs:number|null=null;
    const tableOnce=import("@/lib/benefit-table/app").then(async({ benefitTableLive,appDb })=>{
      if(!(await benefitTableLive(accountId)))return null;
      const { tableFor }=await import("@/lib/benefit-table/service");
      return tableFor(appDb,accountId);
    }).finally(()=>{tableMs=performance.now()-tableTimer;});
    tableOnce.catch(()=>undefined);
    await ensureBenefitSchema();
    // The household's contracts and the documents' conditions do not depend on the benefit rows, so they are fetched
    // while the rows are (Benefits load, 31 Oct: on a cold start rows, inventory and conditions ran one after another).
    // Each keeps its own failure handling below: a failed contract list leaves amounts unjoined, failed conditions none.
    const inventoryOnce=query<{id:string;display_name:string;preferred_name:string|null;relationship:string}>(
      `SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND ${activePredicate()}`,[accountId])
      .then(people=>loadPolicyInventory(accountId,people.rows).catch(()=>null));
    inventoryOnce.catch(()=>undefined);
    const conditionRowsOnce=ensureConditionSchema().then(()=>query<ConditionRow>(CONDITIONS_SQL,[accountId,member||null]));
    conditionRowsOnce.catch(()=>undefined);
    const rows=await query<Row>(
      `SELECT b.id,b.policy_id,b.product_name,b.benefit_name,b.traits,b.formula_kind,b.formula_value::text,
              b.currency,b.fact_key,b.offset_days,b.maximum_days,b.source_page,b.quote,
              b.conditions,b.requirements,b.needs_review,b.reviewed_at::text,b.basis_inferred,
              p.original_filename,p.insurer,p.document_role,p.product_name AS document_product,p.policy_number AS document_policy_number,
              owners.names AS owner_names,x.tier,x.row_kind
         FROM policy_benefits b
         JOIN policies p ON p.id=b.policy_id AND p.account_id=b.account_id AND p.superseded_at IS NULL AND ${activePredicate("p")}
         LEFT JOIN LATERAL (
              SELECT array_agg(f.display_name ORDER BY f.display_name) AS names
                FROM policy_members pm
                JOIN family_members f ON f.id=pm.family_member_id AND f.account_id=pm.account_id AND ${activePredicate("f")}
               WHERE pm.policy_id=b.policy_id AND pm.account_id=b.account_id
         ) owners ON true
         -- The optional columns, read from the row once each (tier, row kind and duplicate are absent on older schemas):
         -- read inside the duplicate check, the row was turned into JSON once per document of the household (Benefits load).
         CROSS JOIN LATERAL (SELECT j->>'tier' AS tier,j->>'row_kind' AS row_kind,j->>'duplicate_of_policy_id' AS duplicate_of FROM (SELECT to_jsonb(b) AS j) bj) x
        WHERE b.account_id=$1
          -- The same policy uploaded twice: one set of rows (see markDuplicates),
          -- as long as the kept document is still here.
          AND NOT EXISTS (SELECT 1 FROM policies k WHERE k.account_id=b.account_id AND k.id=x.duplicate_of::uuid
                AND k.superseded_at IS NULL AND ${activePredicate("k")})
          AND ($2::uuid IS NULL OR EXISTS (
                SELECT 1 FROM policy_members pm
                 WHERE pm.policy_id=b.policy_id AND pm.account_id=b.account_id AND pm.family_member_id=$2::uuid))
        ORDER BY b.needs_review DESC,coalesce(b.product_name,p.original_filename),b.benefit_name,b.source_page,x.tier`,
      [accountId,member||null]);
    // A table's numbered rows in number order, not text order ("2." before "10.").
    rows.rows=inNumberedOrder(rows.rows);
    lap("rows");
    /** What, if anything, this row needs from the person reading the screen.
     *
     * "Needs review" was an internal flag doing duty as a label, and it lumped
     * together three unrelated things: a rule DearPolicy read from a table
     * heading and will not use until someone says it is right, a rule missing
     * one fact before it can be calculated, and a row whose amount could not be
     * read at all. Only the first two are anyone's job; the third is DearPolicy
     * admitting a limit, and calling that "waiting to be checked" put work on
     * the person that they could not do. */
    const attentionFor=(input:{needsConfirmation:boolean;formulaKind:string;maximumDays:number|null;factKey:string|null})=>{
      if(input.needsConfirmation)return "confirm" as const;
      // A daily rate whose own row never said how many days it pays for.
      if(input.formulaKind==="daily"&&input.maximumDays==null)return "confirm" as const;
      if(input.formulaKind==="none")return "unreadable" as const;
      return null;
    };
    // Which sum insured each rule would be calculated against — the join that
    // decides whether a "% of Sum Insured" row ever becomes money. Shown, so a
    // wrong or missing join is a thing a person can see and fix.
    const inventory=await inventoryOnce;
    lap("inventory");
    const contractsByDocument=new Map<string,typeof inventory extends null?never:NonNullable<typeof inventory>["contracts"]>();
    for(const contract of inventory?.contracts??[])
      for(const doc of [...contract.documents,...contract.references])contractsByDocument.set(doc.id,[...(contractsByDocument.get(doc.id)??[]),contract]);
    // The screen must show the same rules the answers use, or correcting one
    // here fixes nothing there. Both of the transforms the answer path applies
    // at load run here too: a certificate's cover line is not a benefit, and a
    // scale stated as percentages is resolved against the limit the
    // household's own documents imply.
    const asCatalog=(row:Row):CatalogBenefit=>{
      const value=row.formula_value==null?null:Number(row.formula_value);
      return {id:row.id,policyId:row.policy_id,productName:row.product_name??row.document_product,
        benefitName:row.benefit_name,traits:(Array.isArray(row.traits)?row.traits:[]) as CatalogBenefit["traits"],
        formulaKind:row.formula_kind as CatalogBenefit["formulaKind"],
        formulaValue:Number.isFinite(value as number)?value:null,
        currency:row.currency,factKey:row.fact_key,offsetDays:row.offset_days,maximumDays:row.maximum_days,
        sourcePage:row.source_page,quote:row.quote,
        conditions:Array.isArray(row.conditions)?row.conditions.map(String):[],
        requirements:(Array.isArray(row.requirements)?row.requirements:[]) as CatalogBenefit["requirements"],
        needsReview:row.needs_review,basisInferred:row.basis_inferred,
        needsConfirmation:row.basis_inferred&&!row.reviewed_at,reviewedAt:row.reviewed_at};
    };
    const usableRows=rows.rows.filter(row=>!looksLikeCoverageLine(row.benefit_name)&&!namesNoBenefit(row.benefit_name,row.quote)
      &&!isRulelessCoverLine({benefitName:row.benefit_name,quote:row.quote,formulaKind:row.formula_kind,formulaValue:row.formula_value}));
    const resolved=new Map(repairStoredRules(usableRows.map(asCatalog)).map(entry=>[entry.id,entry]));
    // Either/or amounts: the same row worked out two ways for one person (a share of a fixed limit in one table, a share
    // of the sum insured in another). Sent as one group on every member row, never as one picked figure, and only when
    // every person the row is shown for gets the same options.
    // A document is named as Documents names it ("FWD endorsement"), never by a made-up file name ("output_2026….pdf").
    const nameOf=(row:Row)=>documentName({product_name:row.document_product,original_filename:row.original_filename,insurer:row.insurer,document_role:row.document_role,policy_number:row.document_policy_number});
    const documentNames=new Map(usableRows.map(row=>[row.policy_id,nameOf(row)]));
    const groupsByContract=(inventory?.contracts??[]).map(contract=>{
      const docs=new Set([...contract.documents,...contract.references].map(d=>d.id));
      return {docs,groups:amountAlternatives(contract,[...resolved.values()].filter(b=>docs.has(b.policyId)),id=>documentNames.get(id)??"Your document")};
    });
    const alternativesFor=(row:Row)=>{
      const found=groupsByContract.filter(c=>c.docs.has(row.policy_id)).map(c=>c.groups.get(row.id)??null);
      if(!found.length||found.some(g=>!g))return null;
      return new Set(found.map(g=>JSON.stringify(g!.options))).size===1?found[0]:null;
    };
    // A plan-table row whose plan the household's benefit table already settled from its documents (the Coverage page's
    // "Plan Business"): that column's checked figure, said with its plan. Read from stored readings only; nothing is read.
    // Each person's own readings, and who holds each document: a row's figure is taken only when every person who holds
    // its document (or the one person asked about) has the same plan column for it (Critic R370 M1).
    const planReadings=new Map<string,PlanColumnReading[]>();
    const holders=new Map<string,string[]>();
    if(usableRows.some(row=>resolved.get(row.id)?.conditions.includes(PLAN_COLUMNS_NOTE))){
      try{
        const built=await tableOnce;
        if(built){
          const { figureText }=await import("@/lib/benefit-table/assemble");
          const { table }=built;
          for(const person of table.people)planReadings.set(person.id,person.rows.map(r=>
            ({documentId:r.source.documentId,page:r.source.page,excerpt:r.source.excerpt,column:r.column,qualifier:r.qualifier,figure:r.figure,figureText:figureText(r.figure),benefit:r.benefit})));
          const held=await query<{policy_id:string;family_member_id:string}>(
            `SELECT pm.policy_id,pm.family_member_id FROM policy_members pm
               JOIN family_members f ON f.id=pm.family_member_id AND f.account_id=pm.account_id AND ${activePredicate("f")}
              WHERE pm.account_id=$1`,[accountId]);
          for(const h of held.rows)holders.set(h.policy_id,[...(holders.get(h.policy_id)??[]),h.family_member_id]);
        }
      }catch(error){console.warn("Benefit table unavailable for Benefits:",error instanceof Error?error.message:error);}
    }
    // Whether no other stored row of the same page prints the same run of plan cells (planColumnFigure), alone or beside
    // another run (Critic R389 L1). Every row of the document counts, kept or not, so a hidden neighbour still blocks.
    const runIsUnique=(row:Row)=>{
      const run=planCellRun(row.quote);
      return run!=null&&rows.rows.filter(r=>r.policy_id===row.policy_id&&r.source_page===row.source_page&&String(r.quote??"").replace(/\s+/g," ").includes(run)).length===1;
    };
    const benefits=usableRows.map(row=>{
      const stub=resolved.get(row.id)!;
      const formula={
        formulaKind:stub.formulaKind,formulaValue:stub.formulaValue,
        currency:stub.currency,factKey:stub.factKey,offsetDays:stub.offsetDays,maximumDays:stub.maximumDays,
      };
      const needsConfirmation=stub.needsConfirmation===true;
      // A schedule term ("As charged", a deductible, a policy-year limit) is
      // read exactly as printed: nothing is unreadable and nothing to confirm.
      const term=isScheduleTerm(row.row_kind);
      // A row of a plan table with one figure per plan: nothing is unreadable, the plan is simply not known (scale-limit.ts).
      const planColumns=stub.conditions.includes(PLAN_COLUMNS_NOTE);
      const planFigure=planColumns?(()=>{
        const people=member?[member]:holders.get(row.policy_id)??[];
        const picks=people.map(id=>planColumnFigure({policyId:row.policy_id,sourcePage:row.source_page,quote:row.quote,benefitName:row.benefit_name},planReadings.get(id)??[],
          {runIsUnique:runIsUnique(row)}));
        return picks.length&&picks.every(p=>p&&JSON.stringify(p)===JSON.stringify(picks[0]))?picks[0]:null;
      })():null;
      const attention=term||planColumns?null:attentionFor({needsConfirmation,formulaKind:stub.formulaKind,maximumDays:stub.maximumDays,factKey:stub.factKey});
      // Each person once, and only the person asked for: one person is often linked to a booklet by several documents.
      const calculatedAgainst=oncePerPerson((contractsByDocument.get(row.policy_id)??[]).filter(contract=>!member||contract.ownerId===member).map(contract=>{
        const coverage=coverageForBenefit(contract,stub);
        return coverage?{ownerId:contract.ownerId,owner:contract.ownerName,plan:coverage.productName??contract.name,amount:coverage.amount!=null?formatMoney(coverage.amount,coverage.currency):null}
          :{ownerId:contract.ownerId,owner:contract.ownerName,plan:null,amount:null};
      }));
      // A row that pays the whole sum insured in words: each person's own sum of the cover named the same, with its source.
      const wholeSum=attention==="unreadable"&&stub.formulaKind==="none"
        ?wholeSumAgainst((contractsByDocument.get(row.policy_id)??[]).filter(contract=>!member||contract.ownerId===member),{benefitName:row.benefit_name,quote:row.quote})
        :null;
      return {
        id:row.id,policyId:row.policy_id,
        productName:row.product_name??row.document_product,
        wholeSum,
        // For a "% of Sum Insured" rule: whose sum insured, from which plan.
        calculatedAgainst,
        // Without a plan cell run into the name only beside this household's own plan figure (Critic R394 M2).
        benefitName:nameWithoutPlanCell(row.benefit_name,row.quote,{householdFigure:planFigure!=null}),
        traits:Array.isArray(row.traits)?row.traits:[],
        ...formula,
        // The whole point of the screen: the rule as a sentence, not a schema.
        pays:term?describeScheduleTerm(row.row_kind!,stub.formulaValue,stub.currency):describeBenefitFormula({...formula,quote:stub.quote,benefitName:stub.benefitName,reviewedAt:stub.reviewedAt}),
        // The column of a multi-column table: the plan tier or person class.
        tier:row.tier,rowKind:row.row_kind??"benefit",
        sourcePage:row.source_page,quote:row.quote,
        // What the page adds after a name cut at its stored length: ")" or "…" (lib/policies/cut-name).
        nameSuffix:cutNameSuffix(row.benefit_name,row.quote),
        conditions:stub.conditions,planColumns,planFigure,
        requirements:stub.requirements,
        needsReview:row.needs_review,reviewedAt:row.reviewed_at,
        // Read from a heading above the row rather than from the row itself, and
        // not yet confirmed. DearPolicy shows it but will not calculate from it.
        needsConfirmation,attention,
        documentName:documentNames.get(row.policy_id)??nameOf(row),insurer:row.insurer,documentRole:row.document_role,
        // A booklet nobody has claimed yet has no owner. Saying so is more
        // useful than printing an empty cell.
        owners:row.owner_names??[],
        alternatives:alternativesFor(row),
      };
    });
    // The other half of every document: what these covers do NOT pay. Shown on
    // the same screen and for the same reason -- a condition read wrongly takes
    // money off an answer, so it has to be visible before a claim happens.
    let conditions:{id:string;policyId:string;documentName:string;cover:string|null;kind:string;
      description:string;effect:string;sourcePage:number|null;quote:string;needsReview:boolean}[]=[];
    try{
      const conditionRows=await conditionRowsOnce;
      conditions=conditionRows.rows.map(row=>{
        const condition:CoverCondition={
          id:row.id,policyId:row.policy_id,productName:row.product_name,
          kind:row.condition_kind as CoverConditionKind,cause:row.cause as ExcludedCause|null,
          appliesToEvents:[],conditionNames:Array.isArray(row.condition_names)?row.condition_names:[],
          days:row.days,amount:row.amount==null?null:Number(row.amount),
          amountBasis:row.amount_basis as CoverCondition["amountBasis"],scope:row.scope as CoverCondition["scope"],
          carveOut:row.carve_out,sourcePage:row.source_page,quote:row.quote,needsReview:row.needs_review};
        return {id:row.id,policyId:row.policy_id,documentName:documentName({product_name:row.document_product,original_filename:row.original_filename,insurer:row.insurer,document_role:row.document_role,policy_number:row.document_policy_number}),cover:row.product_name,
          kind:row.condition_kind,description:describeCondition(condition),effect:conditionEffect(condition),
          sourcePage:row.source_page,quote:row.quote,needsReview:row.needs_review};
      });
    }catch{/* A document whose conditions have not been read yet simply has none to show. */}
    // ID numbers in quotes are masked as chat masks them; ids are left as stored.
    // Each document's whole-policy kind by the rule Home and Coverage use (a savings plan), so Benefits
    // says the same. Optional: without the benefit table, nothing is said.
    let documentKindsById:Record<string,DocumentKind>={};
    try{
      const built=await tableOnce;
      if(built)documentKindsById=documentKinds(built.table.people);
    }catch{/* No table: no kind is said. */}
    lap("rest");
    if(tableMs!=null)timings.push(`table;dur=${(tableMs as number).toFixed(0)}`);
    timings.push(`total;dur=${(performance.now()-started).toFixed(0)}`);
    return NextResponse.json(maskShownText({
      benefits,
      conditions,
      documentKinds:documentKindsById,
      summary:{
        conditions:conditions.length,
        conditionsThatChangeAmounts:conditions.filter(c=>c.effect==="changes the amount").length,
        total:benefits.length,
        // The only number that is a to-do for the person reading the screen.
        needsYou:benefits.filter(b=>b.attention==="confirm").length,
        unreadable:benefits.filter(b=>b.attention==="unreadable").length,
        usable:benefits.filter(b=>b.attention==null).length,
        documents:new Set(benefits.map(b=>b.policyId)).size,
        unclaimed:benefits.filter(b=>!b.owners.length).length,
      },
    }),{headers:{"Server-Timing":timings.join(", ")}});
  }catch(error){
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not load the benefit schedule"},{status:500});
    return authResponse;
  }
}

const Patch=z.object({
  id:z.string().uuid(),
  benefitName:z.string().min(1).max(200).optional(),
  formula:z.object({
    kind:z.enum(["none","sum_insured","fixed","expense_cap","daily"]),
    value:z.number().finite().nullable(),
    currency:z.string().max(16).nullable(),
    factKey:z.string().max(64).nullable(),
    offsetDays:z.number().int().nullable(),
    maximumDays:z.number().int().nullable(),
  }).optional(),
  needsReview:z.boolean().optional(),
});

export async function PATCH(request:NextRequest){
  try{
    const body=Patch.parse(await request.json().catch(()=>({})));
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    await ensureBenefitSchema();
    const existing=await query<{id:string;benefit_name:string;quote:string|null}>("SELECT id,benefit_name,quote FROM policy_benefits WHERE id=$1 AND account_id=$2",[body.id,accountId]);
    if(!existing.rows[0])return NextResponse.json({error:"That benefit is not in your schedule."},{status:404});
    // The GET shows names masked (maskShownText), and the Schedule pages send the name they were shown back with an
    // amount: that masked copy of the stored name is no new name, so the stored name is kept (TE pr181 F1).
    body.benefitName=sentName(body.benefitName,existing.rows[0].benefit_name);
    // The GET may also show the name without a plan cell the reader ran into it (nameWithoutPlanCell): sent back, that
    // shown name is no new name either, so the stored name the rules and links key on is kept (TE pr204 Z8, Critic R394 M1).
    const stored=existing.rows[0].benefit_name,shownName=nameWithoutPlanCell(stored,existing.rows[0].quote,{householdFigure:true});
    const even=(t:string)=>t.replace(/\s+/g," ").trim();
    if(body.benefitName!=null&&shownName!==stored&&(even(body.benefitName)===even(shownName)||sentName(body.benefitName,shownName)===undefined))body.benefitName=undefined;
    if(body.formula){
      const checked=reviewedBenefitFormula(body.formula);
      if(!checked.ok)return NextResponse.json({error:checked.error},{status:400});
      const f=checked.formula;
      await query(
        `UPDATE policy_benefits
            SET benefit_name=coalesce($3,benefit_name),formula_kind=$4,formula_value=$5,currency=$6,
                fact_key=$7,offset_days=$8,maximum_days=$9,needs_review=$10,reviewed_at=now(),updated_at=now()
          WHERE id=$1 AND account_id=$2`,
        [body.id,accountId,body.benefitName??null,f.formulaKind,f.formulaValue,f.currency,
         f.factKey,f.offsetDays,f.maximumDays,body.needsReview??false]);
    }else if(body.benefitName!=null||body.needsReview!=null){
      await query(
        `UPDATE policy_benefits
            SET benefit_name=coalesce($3,benefit_name),needs_review=coalesce($4,needs_review),
                reviewed_at=CASE WHEN $4 IS FALSE THEN now() ELSE reviewed_at END,updated_at=now()
          WHERE id=$1 AND account_id=$2`,
        [body.id,accountId,body.benefitName??null,body.needsReview??null]);
    }else{
      return NextResponse.json({error:"Nothing to change."},{status:400});
    }
    return NextResponse.json({ok:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"That correction could not be read."},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not save the correction"},{status:500});
    return authResponse;
  }
}

const Remove=z.object({id:z.string().uuid()});
/** A row that is not a benefit at all — a heading the parser mistook for one.
 * Only the catalogue is affected: the document, its pages and any confirmed
 * cover are untouched, and re-indexing the document rebuilds the row. */
export async function DELETE(request:NextRequest){
  try{
    const body=Remove.parse(await request.json().catch(()=>({})));
    const ctx=await requireHouseholdContext(request);
    await ensureBenefitSchema();
    const result=await query("DELETE FROM policy_benefits WHERE id=$1 AND account_id=$2",[body.id,ctx.householdId]);
    if(!result.rowCount)return NextResponse.json({error:"That benefit is not in your schedule."},{status:404});
    return NextResponse.json({ok:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"That request could not be read."},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not remove the benefit"},{status:500});
    return authResponse;
  }
}

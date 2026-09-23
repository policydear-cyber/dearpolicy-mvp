import { NextResponse } from "next/server";
import { z } from "zod";
import { devAccountId,query } from "@/lib/db/client";
import { EVENTS,type EventType,type PaysKind } from "@/lib/ledger/events";
import { addLedgerRow,ledgerFor,loadLedgerRow,seedLedger,updateLedgerRow,type LedgerRow } from "@/lib/ledger/store";
import type { ClaimPerson } from "@/lib/claims/person";
import { describePays } from "@/lib/ledger/answer";
import { ledgerReadingInProgress,pendingDocumentCount,readPendingDocuments } from "@/lib/ledger/extract";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** The Coverage Ledger, as a screen: one row per (person, plan, event, pays),
 * with what it came from and whether the person has confirmed it. Every payout
 * answer is a lookup in this table, so confirming a row here is what makes the
 * next answer exact. */
function family(accountId:string){
  return query<ClaimPerson>("SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 ORDER BY created_at",[accountId]);
}
function shape(row:LedgerRow,people:ClaimPerson[]){
  return {...row,eventLabel:EVENTS[row.eventType]?.label??row.eventType,pays:describePays(row),
    ownerName:people.find(p=>p.id===row.familyMemberId)?.display_name??"Unknown",
    hasFigure:row.paysKind!=="stated"&&row.amount!=null&&!(row.paysKind==="percent_of_sum"&&row.sumBasis==null)};
}

export async function GET(request:Request){
  try{
    const accountId=devAccountId();
    const url=new URL(request.url);
    const member=url.searchParams.get("familyMemberId");
    const people=(await family(accountId)).rows;
    const rows=await ledgerFor(accountId,people);
    const shown=rows.filter(r=>!member||r.familyMemberId===member).map(r=>shape(r,people));
    const summary={
      total:shown.length,
      confirmed:shown.filter(r=>r.status==="confirmed").length,
      proposed:shown.filter(r=>r.status==="proposed").length,
      noFigure:shown.filter(r=>!r.hasFigure).length,
    };
    const pending=await pendingDocumentCount(accountId);
    return NextResponse.json({rows:shown,summary,family:people,events:Object.entries(EVENTS).map(([value,e])=>({value,label:e.label})),
      reading:{pending,inProgress:ledgerReadingInProgress(accountId)}});
  }catch(error){
    return NextResponse.json({error:"Could not load the coverage ledger"},{status:500});
  }
}

const Patch=z.object({
  id:z.string().uuid(),
  status:z.enum(["proposed","confirmed","rejected"]).optional(),
  amount:z.number().nonnegative().nullable().optional(),
  paysKind:z.enum(["lump_sum","per_day","per_month","percent_of_sum","reimbursement_cap","stated"]).optional(),
  eventType:z.string().optional(),
  sumBasis:z.number().nonnegative().nullable().optional(),
  detail:z.string().max(200).nullable().optional(),
  planName:z.string().min(1).max(200).optional(),
});
export async function PATCH(request:Request){
  try{
    const accountId=devAccountId();
    const body=Patch.parse(await request.json().catch(()=>({})));
    if(body.eventType&&!(body.eventType in EVENTS))return NextResponse.json({error:"Unknown event"},{status:400});
    const existing=await loadLedgerRow(accountId,body.id);
    if(!existing)return NextResponse.json({error:"Row not found"},{status:404});
    // A person who edits a figure has read their policy: an edit is a
    // confirmation unless they say otherwise.
    const edits=body.amount!==undefined||body.paysKind!==undefined||body.eventType!==undefined||body.sumBasis!==undefined||body.detail!==undefined||body.planName!==undefined;
    const patch={...body,id:undefined,eventType:body.eventType as EventType|undefined,paysKind:body.paysKind as PaysKind|undefined,
      status:body.status??(edits?"confirmed" as const:undefined)};
    const row=await updateLedgerRow(accountId,body.id,patch);
    const people=(await family(accountId)).rows;
    return NextResponse.json({row:row?shape(row,people):null});
  }catch(error){
    return NextResponse.json({error:"Could not update the row"},{status:400});
  }
}

const Add=z.object({
  familyMemberId:z.string().uuid(),
  planName:z.string().min(1).max(200),
  eventType:z.string(),
  paysKind:z.enum(["lump_sum","per_day","per_month","percent_of_sum","reimbursement_cap","stated"]),
  amount:z.number().nonnegative().nullable(),
  currency:z.string().max(3).optional(),
  detail:z.string().max(200).nullable().optional(),
});
export async function POST(request:Request){
  try{
    const accountId=devAccountId();
    const body=await request.json().catch(()=>({}));
    if(body?.action==="rebuild"){
      const added=await seedLedger(accountId);
      return NextResponse.json({added:added.added});
    }
    if(body?.action==="read"){
      // Reads every document the model has not read yet, then fills in the
      // standard rows for anything a certificate states without wording.
      const read=await readPendingDocuments(accountId);
      const seeded=await seedLedger(accountId);
      return NextResponse.json({documents:read.documents,added:read.added+seeded.added});
    }
    const add=Add.parse(body);
    if(!(add.eventType in EVENTS))return NextResponse.json({error:"Unknown event"},{status:400});
    const row=await addLedgerRow(accountId,{...add,eventType:add.eventType as EventType,policyId:null,note:"Entered on the Coverage page"});
    const people=(await family(accountId)).rows;
    return NextResponse.json({row:row?shape(row,people):null});
  }catch(error){
    return NextResponse.json({error:"Could not add the row"},{status:400});
  }
}

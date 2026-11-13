import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
// Live chat goes straight to the contextual workflow: never through
// lib/rag/chat.ts, which also carries the legacy orchestrator path
// (scripts/live-chat-monetary-boundary-regressions.ts enforces this).
import { askContextualDearPolicy as askDearPolicy } from "@/lib/chat/workflow";
import { scheduleChatDrain,scheduleRequestDrain } from "@/lib/jobs/request-drain";
import { enqueueChat } from "@/lib/chat/jobs";
import { ChatConflict } from "@/lib/chat/store";
import { overSpendCap, SPEND_LIMIT_TEXT, SpendCheckUnavailable, SPEND_CHECK_UNAVAILABLE_TEXT } from "@/lib/ai/ledger";

const NO_FAMILY_MESSAGE="Add a family member first. Under Account settings > People, add yourself (and anyone else your policies cover), then ask again.";
export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration=300;
const BodySchema=z.object({
  familyMemberId:z.string().uuid().nullable(),
  scope:z.enum(["member","family"]).optional(),
  question:z.string().trim().min(1).max(2000),
  conversationId:z.string().uuid().nullable().optional(),
  conversationRevision:z.number().int().nonnegative().optional(),
  claimSessionId:z.string().uuid().nullable().optional(),
  asynchronous:z.boolean().optional().default(true),
  timeZone:z.string().trim().max(100).optional(),
  personContextMessage:z.string().trim().min(1).max(2000).optional(),
  personContextRecordedAt:z.string().datetime().optional(),
  personChoiceId:z.string().uuid().optional(),
});
export async function POST(request:NextRequest){
  try{
    const body=BodySchema.parse(await request.json().catch(()=>({})));
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    scheduleRequestDrain(); // bounded job drain after the response (lib/jobs/request-drain.ts)
    scheduleChatDrain(); // Round 10: and the chat lane, so an answer never waits behind a document job
    // A household with nobody in it has no policies to read and nobody to ask
    // about: say what to do, instead of failing every message with a 500.
    const anyone=await query<{id:string}>(`SELECT id FROM family_members WHERE account_id=$1 AND ${activePredicate()} LIMIT 1`,[accountId]);
    if(!anyone.rows.length)return NextResponse.json({error:NO_FAMILY_MESSAGE,code:"no_family_members"},{status:409});
    if(body.familyMemberId){
      const member=await query<{id:string}>(`SELECT id FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,[body.familyMemberId,accountId]);
      if(!member.rows.length)return NextResponse.json({error:"Family member not found."},{status:404});
    }else if(body.scope!=="family")return NextResponse.json({error:"Tell DearPolicy who this concerns, or start in automatic family context."},{status:400});
    // Past the household's monthly hard stop every answer would fail in the background: say so now, in words a household
    // can act on (live run 23 Oct: "Something went wrong").
    // This month's use that cannot be read is never taken as none: nothing is sent, and the household is told to try again.
    let over:boolean;
    try{over=await overSpendCap(accountId);}
    catch(error){if(error instanceof SpendCheckUnavailable)return NextResponse.json({error:SPEND_CHECK_UNAVAILABLE_TEXT,code:"spend_check_unavailable"},{status:503});throw error;}
    if(over)return NextResponse.json({error:SPEND_LIMIT_TEXT,code:"spend_limit"},{status:429});
    const args={...body,accountId};
    if(body.asynchronous)return NextResponse.json(await enqueueChat(args),{status:202});
    return NextResponse.json(await askDearPolicy(args));
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Invalid request",issues:error.issues},{status:400});
    if(error instanceof ChatConflict)return NextResponse.json({error:error.message},{status:409});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"DearPolicy couldn't answer just now. Please try again."},{status:500});
    return authResponse;
  }
}

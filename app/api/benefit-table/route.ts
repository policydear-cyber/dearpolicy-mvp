import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { appDb, benefitTableLive, requeueStuckTableLinks } from "@/lib/benefit-table/app";
import { figureText } from "@/lib/benefit-table/assemble";
import { holdReason, tableFor } from "@/lib/benefit-table/service";
import { scheduleRequestDrain } from "@/lib/jobs/request-drain";
import { malwareScanningIntentionallyDisabled } from "@/lib/scanning/adapter";
import { documentName } from "@/lib/policies/inventory";
import { maskShownText } from "@/lib/chat/identity-numbers";
import { scheduleLinesFor } from "@/lib/ledger/schedule-lines";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Each person's benefit table (lib/benefit-table), assembled from the stored readings, links and confirmations on every
 * request. Switched off, or before its tables are applied, it answers {enabled:false} and Coverage shows the old view. */
export async function GET(request:NextRequest){
  try{
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    if(!(await benefitTableLive(accountId)))return NextResponse.json({enabled:false});
    // A stored reading whose link run died is queued to link again (bounded; it reads nothing, so it pays for no reading).
    await requeueStuckTableLinks(accountId).catch(()=>0);
    const {table,documents,links,figureChecks}=await tableFor(appDb,accountId);
    // A document still being read (a long reading's next run, or the run that links its sections) goes on now, after this
    // response, rather than waiting for another page or the daily run (lib/jobs/request-drain.ts: bounded, throttled).
    if(documents.some(d=>d.state==="waiting"))
      scheduleRequestDrain();
    const chosenBy=new Map(links.map(l=>[l.section,l.chosenBy]));
    // Each person's schedule lines, the ones Home's tiles count, so Family lists the same kinds of cover (kindsOfTable). Optional.
    const lines=await scheduleLinesFor(accountId).catch(()=>[]);
    // Each document by the name the household knows it by (the Documents page and chat use the same), never a made-up file name.
    // ID numbers in quotes and excerpts are masked as chat masks them; row and link keys are left exactly as stored.
    return NextResponse.json(maskShownText({enabled:true,documents:documents.map(d=>({id:d.id,name:documentName(d.file),state:d.state,
      // A document on hold for its malware scan says why, as its Documents page card does.
      hold:d.state==="held"?holdReason(d.file,malwareScanningIntentionallyDisabled()):null})),
      people:table.people.map(p=>({...p,rows:p.rows.map(r=>({...r,figureText:figureText(r.figure)})),scheduleLines:lines.filter(l=>l.familyMemberId===p.id).map(l=>({policyId:l.policyId,category:l.category}))})),
      covers:[...new Map(table.people.flatMap(p=>p.covers).map(c=>[c.coverKey,{key:c.coverKey,product:c.product,cover:c.cover,plan:c.plan,riderOf:c.riderOf??null}])).values()],
      unmatchedCovers:table.unmatchedCovers,ambiguousCovers:table.ambiguousCovers,illustrationCovers:table.illustrationCovers,
      unlinkedSections:table.unlinkedSections.map(u=>({...u,chosenBy:chosenBy.get(u.section.key)??null})),
      staleConfirmations:table.staleConfirmations,
      // Only with the figure guards on (lib/benefit-table/guard-flag.ts): the figures the household is asked to check.
      ...(figureChecks?{figureChecks}:{})}));
  }catch(error){
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not load your coverage"},{status:500});
    return authResponse;
  }
}

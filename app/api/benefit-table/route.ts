import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { appDb, benefitTableLive } from "@/lib/benefit-table/app";
import { figureText } from "@/lib/benefit-table/assemble";
import { holdReason, tableFor } from "@/lib/benefit-table/service";
import { malwareScanningIntentionallyDisabled } from "@/lib/scanning/adapter";
import { documentName } from "@/lib/policies/inventory";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Each person's benefit table (lib/benefit-table), assembled from the stored readings, links and confirmations on every
 * request. Switched off, or before its tables are applied, it answers {enabled:false} and Coverage shows the old view. */
export async function GET(request:NextRequest){
  try{
    const ctx=await requireHouseholdContext(request),accountId=ctx.householdId;
    if(!(await benefitTableLive(accountId)))return NextResponse.json({enabled:false});
    const {table,documents,links}=await tableFor(appDb,accountId);
    const chosenBy=new Map(links.map(l=>[l.section,l.chosenBy]));
    // Each document by the name the household knows it by (the Documents page and chat use the same), never a made-up file name.
    return NextResponse.json({enabled:true,documents:documents.map(d=>({id:d.id,name:documentName(d.file),state:d.state,
      // A document on hold for its malware scan says why, as its Documents page card does.
      hold:d.state==="held"?holdReason(d.file,malwareScanningIntentionallyDisabled()):null})),
      people:table.people.map(p=>({...p,rows:p.rows.map(r=>({...r,figureText:figureText(r.figure)}))})),
      covers:[...new Map(table.people.flatMap(p=>p.covers).map(c=>[c.coverKey,{key:c.coverKey,product:c.product,cover:c.cover,plan:c.plan,riderOf:c.riderOf??null}])).values()],
      unmatchedCovers:table.unmatchedCovers,illustrationCovers:table.illustrationCovers,
      unlinkedSections:table.unlinkedSections.map(u=>({...u,chosenBy:chosenBy.get(u.section.key)??null})),
      staleConfirmations:table.staleConfirmations});
  }catch(error){
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Could not load your coverage"},{status:500});
    return authResponse;
  }
}

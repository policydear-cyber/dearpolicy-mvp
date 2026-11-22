import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { loadPolicyDates } from "@/lib/policies/policy-dates-load";
import { lifeStages, type LifeCover, type LifeValueRow } from "@/lib/policies/life-stages";
import { singaporeDay } from "@/lib/benefit-table/dates";
import { maskShownText } from "@/lib/chat/identity-numbers";

/** One person's policies across the stages of their life (lib/policies/life-stages.ts), for the Life stages page. Read from
 * stored documents, readings and premium records only: no model call. Members may view it (DC 18 Nov). */
export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const requested = new URL(request.url).searchParams.get("member") ?? "";
    const loaded = await loadPolicyDates(ctx.householdId, isUuid(requested) ? requested : null);
    const covers: LifeCover[] = (loaded.table?.covers ?? []).map((c) => ({ documentId: c.source.documentId, coverKey: c.coverKey, name: c.cover || c.product || "",
      premiumEndDate: c.premiumEndDate ?? null, premiumTerm: c.premiumTerm ?? null, maturityDate: c.maturityDate ?? null, page: c.source.page ?? null }));
    const coverCurrency = new Map((loaded.table?.covers ?? []).map((c) => [c.coverKey, c.currency] as const));
    const values: LifeValueRow[] = (loaded.table?.rows ?? []).flatMap((r) => r.valueAt && (r.figure.kind === "value" || r.figure.kind === "projected")
      ? [{ coverKey: r.coverKey, benefit: r.benefit, column: r.column, coverCurrency: coverCurrency.get(r.coverKey) ?? null, amount: r.figure.amount, currency: r.figure.currency, kind: r.figure.kind, basis: r.figure.kind === "projected" ? r.figure.basis : undefined,
          age: r.valueAt.age, policyYear: r.valueAt.policyYear, rate: r.valueAt.rate, repeatedAt: r.repeatedAt, documentId: r.source.documentId, document: r.source.document, page: r.source.page }] : []);
    const stages = lifeStages({ dates: loaded.policies, covers, values, dateOfBirth: loaded.dateOfBirth, today: singaporeDay(new Date()) });
    return NextResponse.json(maskShownText({ member: loaded.memberId ? { id: loaded.memberId, name: loaded.name } : null, ...stages }));
  } catch (error) {
    const response = routeErrorResponse(error);
    if (response.status === 500) return NextResponse.json({ error: "Life stages are unavailable" }, { status: 500 });
    return response;
  }
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isUuid, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { loadPolicyInventory } from "@/lib/policies/inventory";
import { singaporeDay } from "@/lib/benefit-table/dates";
import { householdPolicyDates, type DatedCover, type PaymentRecord } from "@/lib/policies/policy-dates";
import { maskShownText } from "@/lib/chat/identity-numbers";

/** When each of a person's policies ends or renews (lib/policies/policy-dates.ts), for Home's "Policy dates" list. Read from
 * stored documents, readings and premium records only: no model call. */
export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request); const accountId = ctx.householdId;
    const requested = new URL(request.url).searchParams.get("member") ?? "";
    const people = (await query<{ id: string; display_name: string; preferred_name: string | null; relationship: string }>(
      `SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY created_at`, [accountId])).rows;
    const member = people.find((p) => isUuid(requested) && p.id === requested) ?? people[0];
    if (!member) return NextResponse.json({ memberId: null, policies: [] });
    const inventory = await loadPolicyInventory(accountId, [member]);
    const contracts = inventory.contracts.filter((c) => c.ownerId === member.id);
    // The person's own cover lines and their printed dates, from the benefit table when it is live.
    let covers: DatedCover[] = [];
    try {
      const { benefitTableLive, appDb } = await import("@/lib/benefit-table/app");
      if (await benefitTableLive(accountId)) {
        const { tableFor } = await import("@/lib/benefit-table/service");
        const person = (await tableFor(appDb, accountId)).table.people.find((p) => p.id === member.id);
        covers = (person?.covers ?? []).map((c) => ({ documentId: c.source.documentId, name: c.cover || c.product || "", startDate: c.startDate ?? null, endDate: c.endDate ?? null, page: c.source.page ?? null }));
      }
    } catch (error) { console.warn("Benefit table unavailable for policy dates:", error instanceof Error ? error.message : error); }
    const payments = (await query<PaymentRecord>(
      `SELECT pr.policy_id::text AS policy_id,pr.source_document_id::text AS source_document_id,pr.family_member_id::text AS family_member_id,pr.insurer,pr.policy_number,
              pr.payment_date::text AS payment_date,pr.period_start::text AS period_start,pr.period_end::text AS period_end,pr.created_at::text AS created_at
         FROM premium_records pr WHERE pr.account_id=$1 AND (pr.family_member_id IS NULL OR pr.family_member_id=$2)`, [accountId, member.id])).rows;
    const policies = householdPolicyDates(contracts, covers, payments, singaporeDay(new Date()));
    return NextResponse.json(maskShownText({ memberId: member.id, policies }));
  } catch (error) {
    const response = routeErrorResponse(error);
    if (response.status === 500) return NextResponse.json({ error: "Policy dates are unavailable" }, { status: 500 });
    return response;
  }
}

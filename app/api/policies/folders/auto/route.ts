import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext } from "@/lib/auth/request-context";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { makeAutoFolders } from "@/lib/policies/folders";
import { AutoFolders, folderError } from "../http";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

/** Makes the policy folders the Documents page worked out from the household's own documents (one per schedule or
 * certificate in no folder; lib/policies/folder-view.ts policyStarters). The owner only. Each is made once: a schedule
 * that had its folder made, or left one, is skipped. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    await requireHouseholdOwner(ctx.userId, ctx.householdId);
    const body = AutoFolders.parse(await request.json().catch(() => ({})));
    const made = await makeAutoFolders(ctx.householdId, body.starters);
    return NextResponse.json({ ok: true, made });
  } catch (error) {
    return folderError(error, request);
  }
}

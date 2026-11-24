import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdOwnerContext } from "@/lib/auth/request-context";
import { deleteFolder, updateFolder } from "@/lib/policies/folders";
import { UpdateFolder, folderError } from "../http";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

/** Rename, confirm complete, change who it is for, add or remove documents. Removing a document takes it out of this
 * policy only: it stays in the library. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const ctx = await requireHouseholdOwnerContext(request);
    await updateFolder(ctx.householdId, id, UpdateFolder.parse(await request.json().catch(() => ({}))));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return folderError(error, request);
  }
}

/** Deletes the folder; its documents stay in the library. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const ctx = await requireHouseholdOwnerContext(request);
    await deleteFolder(ctx.householdId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return folderError(error, request);
  }
}

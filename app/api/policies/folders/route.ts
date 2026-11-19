import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, requireHouseholdOwnerContext } from "@/lib/auth/request-context";
import { requireHouseholdOwner, NotHouseholdOwnerError } from "@/lib/household/repo";
import { autoFoldersReady, createFolder, foldersReady, handledDocuments, listFolders } from "@/lib/policies/folders";
import { CreateFolder, folderError } from "./http";

export const runtime = "nodejs";
// Every member reads the household's policy folders; only the owner creates one (POST uses requireHouseholdOwnerContext).
export const ROUTE_AUTH = "household-member" as const;

/** { ready, canManage, folders, auto, handled }: ready is false until sql/policy-folders.sql is applied, and the page then
 * shows no folders. canManage is whether the signed-in person is the household's owner, who alone changes folders. auto is
 * whether folders are made for the household (sql/policy-folders-auto.sql); handled lists the documents never to make one
 * from again (POST ./auto). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const ready = await foldersReady();
    const canManage = await requireHouseholdOwner(ctx.userId, ctx.householdId).then(() => true, (e) => { if (e instanceof NotHouseholdOwnerError) return false; throw e; });
    const auto = ready && await autoFoldersReady();
    return NextResponse.json({ ready, canManage, auto, handled: auto ? await handledDocuments(ctx.householdId) : [], folders: ready ? await listFolders(ctx.householdId) : [] });
  } catch (error) {
    return folderError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdOwnerContext(request);
    const body = CreateFolder.parse(await request.json().catch(() => ({})));
    const id = await createFolder(ctx.householdId, body);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return folderError(error, request);
  }
}

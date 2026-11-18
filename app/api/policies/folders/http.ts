import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { routeErrorResponse } from "@/lib/auth/request-context";
import { FOLDER_SLOTS, FolderInputError, FoldersNotReadyError } from "@/lib/policies/folders";

const uuid = z.string().uuid();
export const DocumentInput = z.object({ policyId: uuid, slot: z.enum(FOLDER_SLOTS as [string, ...string[]]).nullable().optional() })
  .transform((d) => ({ policyId: d.policyId, slot: (d.slot ?? null) as (typeof FOLDER_SLOTS)[number] | null }));
export const CreateFolder = z.object({
  name: z.string().max(200).nullable().optional(),
  people: z.array(uuid).max(50),
  documents: z.array(DocumentInput).max(100).default([]),
  complete: z.boolean(),
});
export const UpdateFolder = z.object({
  name: z.string().max(200).nullable().optional(),
  complete: z.boolean().optional(),
  people: z.array(uuid).max(50).optional(),
  add: z.array(DocumentInput).max(100).optional(),
  remove: z.array(uuid).max(100).optional(),
});

/** The household's words for each refusal; anything else is the shared route error. */
export function folderError(error: unknown, request: NextRequest): NextResponse {
  if (error instanceof ZodError) return NextResponse.json({ error: "That request was not complete. Please try again." }, { status: 400 });
  if (error instanceof FolderInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof FoldersNotReadyError) return NextResponse.json({ error: "Grouping documents by policy is not switched on yet." }, { status: 409 });
  return routeErrorResponse(error, { request });
}

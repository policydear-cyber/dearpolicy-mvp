import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { deletePolicyFile } from "@/lib/storage";
import { deletePolicyPassages, pineconeEnabled } from "@/lib/rag/pinecone";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

type PolicyFileRow = {
  id: string;
  storage_key: string;
  original_filename: string;
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: policyId } = await params;
  if (!isUuid(policyId)) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  let policy: PolicyFileRow | null;
  let householdId: string;
  try {
    const ctx = await requireHouseholdContext(request);
    householdId = ctx.householdId;

    policy = await createUserSupabaseClient(ctx.userId, async (client) => {
      // FOR UPDATE locks the row for the duration of this transaction so a
      // concurrent reprocess/link-person request can't race the delete --
      // the row-level security predicate on account_id is what actually
      // keeps this scoped to the caller's own household; FOR UPDATE only
      // adds the concurrency guarantee the original implementation relied on.
      const existing = await client.query<PolicyFileRow>(
        `SELECT id, storage_key, original_filename
           FROM policies
          WHERE id=$1 AND account_id=$2
          FOR UPDATE`,
        [policyId, ctx.householdId],
      );

      const row = existing.rows[0];
      if (!row) return null;

      // Premium/payment rows use SET NULL foreign keys so that records can
      // survive policy changes. When a user explicitly deletes an uploaded
      // document, though, DearPolicy should also remove payment data derived
      // from that document.
      await client.query(
        `DELETE FROM premium_records
          WHERE account_id=$1
            AND (source_document_id=$2 OR policy_id=$2)`,
        [ctx.householdId, policyId],
      );

      // Recorded in the quarantine audit trail, in this SAME transaction,
      // immediately before the row is removed below -- so "deleted" is
      // this document's last quarantine state (the audit_log row survives
      // via ON DELETE SET NULL on policy_document_audit_log.policy_id),
      // and a scan result racing this delete is rejected by
      // recordPolicyScanResult()'s own CAS the instant this transaction
      // commits: a deleted document can never be revived by a late-arriving
      // scan callback. Deliberately inline (not via
      // lib/policies/quarantine/store.ts's own helpers, which open their
      // own connection) so this stays part of the SAME FOR-UPDATE-locked
      // transaction as the delete itself, preserving the concurrency
      // guarantee described above -- splitting this into a second,
      // separate transaction would reopen exactly the race window FOR
      // UPDATE exists to close.
      await client.query(
        `INSERT INTO policy_document_audit_log(account_id,actor,action,previous_value,new_value,policy_id)
         VALUES($1,'system','deleted',$2::jsonb,$3::jsonb,$4)`,
        [ctx.householdId, JSON.stringify({ quarantineStatus: null }), JSON.stringify({ quarantineStatus: "deleted" }), policyId],
      );

      // policy_pages, policy_chunks, policy_coverages, policy_members,
      // policy_detected_people and policy_corrections are removed by ON DELETE CASCADE.
      await client.query(`DELETE FROM policies WHERE id=$1 AND account_id=$2`, [policyId, ctx.householdId]);

      return row;
    });
  } catch (error) {
    return routeErrorResponse(error);
  }

  if (!policy) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  let storageWarning: string | null = null;
  try {
    await deletePolicyFile(policy.storage_key);
  } catch (error) {
    storageWarning = "The document file could not be removed";
  }

  // The database rows are gone by cascade, but the vector index is a separate
  // store: without this, a deleted document's sentences would keep coming back
  // as evidence for questions the person asks afterwards.
  if (pineconeEnabled()) {
    await deletePolicyPassages({ accountId: householdId, policyId }).catch((error) => {
      console.warn("Pinecone cleanup failed for deleted policy " + policyId + ":", error instanceof Error ? error.message : error);
    });
  }

  return NextResponse.json({
    deleted: true,
    id: policyId,
    filename: policy.original_filename,
    storageWarning,
  });
}

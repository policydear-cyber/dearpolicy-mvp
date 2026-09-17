import { NextResponse } from "next/server";
import { devAccountId, pool } from "@/lib/db/client";
import { deletePolicyFile } from "@/lib/storage";

export const runtime = "nodejs";

type PolicyFileRow = {
  id: string;
  storage_key: string;
  original_filename: string;
};

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: policyId } = await params;
  const accountId = devAccountId();
  const client = await pool.connect();
  let policy: PolicyFileRow | undefined;

  try {
    await client.query("BEGIN");

    const existing = await client.query<PolicyFileRow>(
      `SELECT id, storage_key, original_filename
         FROM policies
        WHERE id=$1 AND account_id=$2
        FOR UPDATE`,
      [policyId, accountId],
    );

    policy = existing.rows[0];
    if (!policy) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Premium/payment rows use SET NULL foreign keys so that records can survive
    // policy changes. When a user explicitly deletes an uploaded document, though,
    // DearPolicy should also remove payment data derived from that document.
    await client.query(
      `DELETE FROM premium_records
        WHERE account_id=$1
          AND (source_document_id=$2 OR policy_id=$2)`,
      [accountId, policyId],
    );

    // policy_pages, policy_chunks, policy_coverages, policy_members,
    // policy_detected_people and policy_corrections are removed by ON DELETE CASCADE.
    await client.query(
      `DELETE FROM policies WHERE id=$1 AND account_id=$2`,
      [policyId, accountId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json(
      { error: "Could not delete document" },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  let storageWarning: string | null = null;
  try {
    await deletePolicyFile(policy.storage_key);
  } catch (error) {
    storageWarning = "The document file could not be removed";
  }

  return NextResponse.json({
    deleted: true,
    id: policyId,
    filename: policy.original_filename,
    storageWarning,
  });
}

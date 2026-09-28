/**
 * Measures model calls per document by operation, on the v11 synthetic
 * dataset, through the REAL processPolicy() with the deterministic stand-in
 * (local database). Counts logical calls (one attempt group) and attempts
 * from model_executions, including calls the stand-in answers with a
 * failure: with a real provider every one of them is billed. Prints JSON.
 *
 *   node --import tsx scripts/v11-ingestion-cost.ts [--out file.json]
 */
import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

process.env.E2E_RUN_ID ||= `v11c${Date.now().toString(36)}`;

(async () => {
  const { pool } = await import("@/lib/db/client");
  const { ensureDefaultHousehold } = await import("@/lib/household/repo");
  const { savePolicyFile } = await import("@/lib/storage");
  const { processPolicy } = await import("@/lib/rag/ingest");
  const { pseudonymizeId } = await import("@/lib/telemetry/pseudonymize");
  const { renderDataset, PEOPLE, UPLOAD_ORDER, PREFIX } = await import("../e2e/support/v11-dataset");
  const cleanup = (await import("../e2e/support/cleanup")).default;
  const users = { A: randomUUID(), B: randomUUID() };
  process.env.E2E_USER_A = users.A; process.env.E2E_USER_B = users.B;
  const households = { A: await ensureDefaultHousehold(users.A, `${PREFIX}-Household-A`), B: await ensureDefaultHousehold(users.B, `${PREFIX}-Household-B`) };
  const memberIds: Record<string, string> = {};
  for (const [key, p] of Object.entries(PEOPLE)) {
    memberIds[key] = randomUUID();
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)`, [memberIds[key], households[p.household], p.fullName, p.preferred, p.relationship]);
  }
  const rendered = await renderDataset();
  const docs: Record<string, unknown>[] = [];
  try {
    for (const key of UPLOAD_ORDER) {
      const d = rendered.find((r) => r.key === key)!;
      const account = households[d.household];
      const member = d.person ? memberIds[d.person] : memberIds[d.household === "A" ? "marcus" : "charmaineB"];
      const policyId = randomUUID();
      const bytes = new Uint8Array(d.buffer);
      const storageKey = await savePolicyFile({ accountId: account, familyMemberId: member, policyId, filename: d.fileName, bytes });
      await pool.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at)
        VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','v11-cost',now())`, [policyId, account, member, d.fileName, storageKey, createHash("sha256").update(bytes).digest("hex")]);
      await processPolicy({ accountId: account, familyMemberId: member, policyId, storageKey, linkUploadMember: !!d.person }).catch(() => undefined);
      const ops = (await pool.query(`SELECT operation,count(DISTINCT attempt_group_id)::int calls,count(*)::int attempts FROM model_executions WHERE resource_ref=$1 GROUP BY 1 ORDER BY 1`, [pseudonymizeId(policyId)])).rows;
      const pages = (await pool.query(`SELECT count(*)::int n,coalesce(sum(length(text)),0)::int chars FROM policy_pages WHERE policy_id=$1`, [policyId])).rows[0];
      const conditions = (await pool.query(`SELECT count(*)::int n FROM policy_cover_conditions WHERE policy_id=$1`, [policyId]).catch(() => ({ rows: [{ n: null }] }))).rows[0].n;
      docs.push({ key, pages: pages.n, chars: pages.chars, conditions, ops });
      console.log(key.padEnd(24), "pages", pages.n, "conditions", conditions, ops.map((o) => `${o.operation}=${o.calls}/${o.attempts}`).join(" "));
    }
  } finally {
    await cleanup();
  }
  const totals: Record<string, { calls: number; attempts: number }> = {};
  for (const d of docs) for (const o of d.ops as { operation: string; calls: number; attempts: number }[]) {
    totals[o.operation] ??= { calls: 0, attempts: 0 };
    totals[o.operation].calls += o.calls; totals[o.operation].attempts += o.attempts;
  }
  const pagesTotal = docs.reduce((s, d) => s + Number(d.pages), 0);
  const result = { run: PREFIX, documents: docs.length, pages: pagesTotal, totals, docs };
  console.log(JSON.stringify({ documents: docs.length, pages: pagesTotal, totals }));
  const out = process.argv.indexOf("--out");
  if (out > 0) await writeFile(process.argv[out + 1], JSON.stringify(result, null, 2));
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

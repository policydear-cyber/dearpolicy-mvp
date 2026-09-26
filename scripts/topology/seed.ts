/**
 * Seeds ONE synthetic household with three synthetic policy documents and
 * enqueues their real policy_processing jobs through the real
 * enqueuePolicyProcessing(), exactly as the upload route does:
 *   clean    - an ordinary synthetic PDF (fake scanner: clean)
 *   infected - carries the synthetic malicious marker (fake scanner: malicious)
 *   deleted  - moved to pending_deletion after enqueue; must never be scanned
 * Local database only. No real person, policy or document is involved.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pool } from "@/lib/db/client";
import { savePolicyFile } from "@/lib/storage";
import { enqueuePolicyProcessing } from "@/lib/rag/processing-queue";

function syntheticPdf(label: string, extra = ""): Uint8Array {
  const stream = `BT /F1 12 Tf 40 760 Td (SYNTHETIC DPTEST topology proof - ${label}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  if (extra) out += `% ${extra}\n`;
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("topology seed refuses a non-local database");
  const run = process.env.TOPOLOGY_RUN_ID ?? "local";
  const household = randomUUID();
  const member = randomUUID();
  await pool.query(`INSERT INTO accounts(id,name) VALUES($1,$2)`, [household, `SYNTHETIC-DPTEST-topology-${run}`]);
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,'self')`, [member, household, `SYNTHETIC-DPTEST-topology-${run}`]);
  const docs: Record<string, { policyId: string; sha256: string }> = {};
  for (const [kind, extra] of [["clean", ""], ["infected", "SYNTHETIC-DPTEST-MALICIOUS-VERDICT-MARKER"], ["deleted", ""]] as const) {
    const policyId = randomUUID();
    const bytes = syntheticPdf(`${kind} ${run}`, extra);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = await savePolicyFile({ accountId: household, familyMemberId: member, policyId, filename: `synthetic-${kind}.pdf`, bytes });
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message)
       VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting to be analysed…')`,
      [policyId, household, member, `synthetic-${kind}.pdf`, storageKey, `sha256:${sha256}`]);
    await enqueuePolicyProcessing({ accountId: household, familyMemberId: member, policyId, storageKey });
    docs[kind] = { policyId, sha256 };
  }
  // The household deletes the third document before any worker runs.
  await pool.query(`UPDATE policies SET lifecycle_state='pending_deletion' WHERE id=$1 AND account_id=$2`, [docs.deleted.policyId, household]);
  writeFileSync(".topology-seed.json", JSON.stringify({ household, member, docs }, null, 2));
  console.log("topology seed: 1 synthetic household, 3 synthetic documents, 3 queued policy_processing jobs");
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

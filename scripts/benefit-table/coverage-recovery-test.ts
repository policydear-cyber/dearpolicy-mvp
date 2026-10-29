/** Coverage's notices for two documents that used to have no true way forward (lib/benefit-table/service.ts documentState,
 * components/benefit-table-coverage.tsx):
 * - An upload on hold for its malware scan waits on an automatic scan retry (lib/scanning/retry.ts), not on an intake job.
 *   It is "waiting" while that scan job is live, and otherwise "held": on hold, as its Documents page card says, with no
 *   Try again (app/api/policies/reprocess/route.ts refuses until the scan is clean). Never "stalled".
 * - A ready schedule or certificate (the household's own proof of cover) with pages, no stored table reading and no live
 *   job is "table_unread": its benefits couldn't be read for Coverage yet, and Read again on the Documents page (which
 *   reads it into the table, lib/rag/ingest.ts) is offered. Receipts, letters and reference documents stay "no_table".
 * In-memory rows, and real background_jobs rows in one transaction that is rolled back; made-up names, no model.
 *   DATABASE_URL=... npm run benefit-table:coverage-recovery-test */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as service from "@/lib/benefit-table/service";
import * as liveJob from "@/lib/rag/live-job";
import { BenefitTableCoverage, type BenefitTableData } from "@/components/benefit-table-coverage";
import { SCAN_DID_NOT_COMPLETE_DETAIL } from "@/lib/policies/quarantine/ui";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => { passed++; }, (error) => { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); });
}

type Ds = (d: { status: string; pages: number; live: boolean; scanLive?: boolean; file: { document_role: string | null; quarantine: string | null } }, r: boolean) => string;
const ds = service.documentState as unknown as Ds;
const doc = (o: { status?: string; pages?: number; live?: boolean; scanLive?: boolean; role?: string | null; quarantine?: string | null }) =>
  ({ status: o.status ?? "ready", pages: o.pages ?? 2, live: o.live ?? false, scanLive: o.scanLive, file: { document_role: o.role === undefined ? "personal_schedule" : o.role, quarantine: o.quarantine === undefined ? "scan_clean" : o.quarantine } });

const textOf = (documents: BenefitTableData["documents"]) =>
  renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents, unmatchedCovers: [], illustrationCovers: [], unlinkedSections: [] } }))
    .replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/\s+/g, " ");

async function main() {
  await test("A: an upload whose malware scan is being retried is waiting, not stalled", () => {
    assert.equal(ds(doc({ status: "queued", pages: 0, scanLive: true, role: null, quarantine: "scan_pending" }), false), "waiting");
  });
  await test("A: an upload on hold for its scan with no scan running is held, never stalled (Try again is refused for it)", () => {
    for (const quarantine of ["scan_pending", "quarantined", "uploaded"])
      assert.equal(ds(doc({ status: "queued", pages: 0, scanLive: false, role: null, quarantine }), false), "held", quarantine);
  });
  await test("A controls: a live intake job is waiting; a clean upload with no job is stalled; a rejected one could not be read", () => {
    assert.equal(ds(doc({ status: "queued", pages: 0, live: true, role: null, quarantine: "scan_pending" }), false), "waiting");
    assert.equal(ds(doc({ status: "queued", pages: 0, role: null, quarantine: "scan_clean" }), false), "stalled");
    assert.equal(ds(doc({ status: "extracting", pages: 0, scanLive: true, role: null, quarantine: "scan_clean" }), false), "stalled", "a scan job does not back a cleared document");
    assert.equal(ds(doc({ status: "queued", pages: 0, scanLive: true, role: null, quarantine: "scan_rejected" }), false), "not_readable");
  });
  await test("A: the hold says why in the Documents page's own words, and no malware words in the prototype mode", () => {
    const holdReason = (service as Record<string, unknown>).holdReason as ((f: unknown, prototype: boolean) => string | null) | undefined;
    assert.ok(holdReason, "holdReason is exported");
    assert.equal(holdReason({ quarantine: "scan_pending", scan_detail: SCAN_DID_NOT_COMPLETE_DETAIL }, false), "On hold: malware scan did not complete");
    assert.equal(holdReason({ quarantine: "scan_pending", scan_detail: "provider internal analysis id 123" }, false), "Waiting for malware scan", "never the stored scanner text");
    assert.equal(holdReason({ quarantine: "scan_pending", scan_detail: SCAN_DID_NOT_COMPLETE_DETAIL }, true), null);
  });
  await test("A: the scan-retry job type and key are the ones lib/scanning/retry.ts writes", async () => {
    const live = liveJob as Record<string, unknown>;
    assert.equal(typeof live.scanJobLive, "function", "lib/rag/live-job.ts exports scanJobLive");
    const retry = await import("@/lib/scanning/retry");
    assert.equal(live.SCAN_RETRY_JOB_TYPE, retry.SCAN_RETRY_JOB_TYPE);
    assert.ok(retry.scanRetryKey("policy_document", "abc", 3).startsWith("policy_document:abc:scan-retry:"));
  });

  await test("B: a ready schedule or certificate with pages, no stored reading and no live job is table_unread", () => {
    assert.equal(ds(doc({ role: "personal_schedule" }), false), "table_unread");
    assert.equal(ds(doc({ role: "certificate" }), false), "table_unread");
    assert.equal(ds(doc({ role: "certificate", quarantine: "not_scanned_prototype" }), false), "table_unread");
  });
  await test("B controls: receipts, letters and reference documents stay no_table; read, live and pageless keep theirs", () => {
    for (const role of ["premium_receipt", "renewal_statement", "insurer_letter", "claim_decision", "product_summary", "policy_wording", "brochure", "endorsement", null])
      assert.equal(ds(doc({ role }), false), "no_table", String(role));
    assert.equal(ds(doc({ live: true }), false), "waiting");
    assert.equal(ds(doc({}), true), "read");
    assert.equal(ds(doc({ pages: 0 }), false), "not_readable");
    assert.equal(ds(doc({ status: "failed" }), false), "not_readable");
    assert.equal(ds(doc({ quarantine: "uploaded" }), false), "no_table", "Read again is refused for a scan state it does not accept");
  });

  await test("the page: a held upload is on hold with its reason, never stalled or 'try again'; a scan being retried is still being read", () => {
    const text = textOf([
      { id: "1", name: "Example Home Cover", state: "held" as BenefitTableData["documents"][number]["state"], hold: "On hold: malware scan did not complete" },
      { id: "2", name: "Example Car Cover", state: "waiting" },
    ]);
    assert.match(text, /One document is on hold and hasn't been read yet\. Example Home Cover \(On hold: malware scan did not complete\)\. The Documents page shows its status\./);
    assert.match(text, /One document is still being read\. Example Car Cover\./);
    assert.ok(!/try again/i.test(text), text);
    assert.ok(!/finished reading/i.test(text), text);
  });
  await test("the page: a personal proof whose benefits weren't read names Read again; a receipt beside it does not", () => {
    const text = textOf([
      { id: "1", name: "Example Shield policy schedule", state: "table_unread" as BenefitTableData["documents"][number]["state"] },
      { id: "2", name: "Example Shield receipt", state: "no_table" },
    ]);
    assert.match(text, /One document's benefits couldn't be read for Coverage yet\. Example Shield policy schedule\. You can use Read again on the Documents page ?\./);
    assert.match(text, /Example Shield receipt isn't shown on this page\. You can still ask about it in chat\./);
    assert.equal(text.match(/Read again/g)?.length, 1, text);
  });
  await test("the page controls: a stalled document still offers Try again; a no_table-only page never says Read again", () => {
    assert.match(textOf([{ id: "1", name: "Example Accident Plan", state: "stalled" }]), /One document hasn't finished reading\. Example Accident Plan\. You can try again on the Documents page ?\./);
    assert.ok(!/Read again|couldn't be read/.test(textOf([{ id: "1", name: "Example Shield receipt", state: "no_table" }])));
  });

  await test("real database: a held upload waits on a live scan retry, and is held without one; a schedule with no reading is table_unread", async () => {
    const url = process.env.DATABASE_URL;
    assert.ok(url, "DATABASE_URL is needed: this check reads real background_jobs rows");
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query("BEGIN");
      const acct = randomUUID(), member = randomUUID();
      await client.query("INSERT INTO accounts(id,name) VALUES($1,'Lim household (test)')", [acct]);
      await client.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Lim Ah Kow','self')", [member, acct]);
      // [file, processing status, scan state, role, scan-retry job (null: none), policy_processing job (null: none), expected]
      const cases: [string, string, string, string | null, string | null, string | null, string][] = [
        ["scan-retry-later.pdf", "queued", "scan_pending", null, "status='queued', available_at=now()+interval '2 hours'", null, "waiting"],
        ["scan-retry-running.pdf", "queued", "scan_pending", null, "status='processing', lease_expires_at=now()+interval '5 minutes'", null, "waiting"],
        ["scan-retry-dead.pdf", "queued", "scan_pending", null, "status='dead_letter'", "status='succeeded', completed_at=now()", "held"],
        ["scan-retry-done.pdf", "queued", "scan_pending", null, "status='succeeded', completed_at=now()", null, "held"],
        ["scan-no-job.pdf", "queued", "scan_pending", null, null, null, "held"],
        ["scan-first.pdf", "queued", "scan_pending", null, null, "status='processing', lease_expires_at=now()+interval '5 minutes'", "waiting"],
        // Controls
        ["clean-no-job.pdf", "queued", "scan_clean", null, null, null, "stalled"],
        ["schedule-unread.pdf", "ready", "scan_clean", "personal_schedule", null, "status='succeeded', completed_at=now()", "table_unread"],
        ["certificate-unread.pdf", "ready", "scan_clean", "certificate", null, null, "table_unread"],
        ["schedule-reading.pdf", "ready", "scan_clean", "personal_schedule", null, "status='processing', lease_expires_at=now()+interval '5 minutes'", "waiting"],
        ["receipt.pdf", "ready", "scan_clean", "premium_receipt", null, null, "no_table"],
        ["summary.pdf", "ready", "scan_clean", "product_summary", null, null, "no_table"],
      ];
      const ids = new Map<string, string>();
      for (const [file, status, quarantine, role, scanJob, job] of cases) {
        const id = randomUUID();
        ids.set(file, id);
        await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,document_role,processing_completed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, acct, member, file, `test/${id}`, status, quarantine, role, status === "ready" ? new Date() : null]);
        if (status === "ready") await client.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'SCHEDULE Lim Ah Kow')", [acct, id]);
        if (job) {
          await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'policy_processing',$2,'{}'::jsonb)", [acct, id]);
          await client.query(`UPDATE background_jobs SET ${job} WHERE job_type='policy_processing' AND idempotency_key=$1`, [id]);
        }
        if (scanJob) {
          const key = `policy_document:${id}:scan-retry:1`;
          await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'document_scan_retry',$2,'{}'::jsonb)", [acct, key]);
          await client.query(`UPDATE background_jobs SET ${scanJob} WHERE job_type='document_scan_retry' AND idempotency_key=$1`, [key]);
        }
      }
      // A live scan retry of ANOTHER document never backs this one.
      const other = `policy_document:${randomUUID()}:scan-retry:1`;
      await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload,available_at) VALUES($1,'document_scan_retry',$2,'{}'::jsonb,now()+interval '1 hour')", [acct, other]);
      const got = await service.tableFor(async (sql, params) => (await client.query(sql, params as unknown[])).rows, acct);
      const by = Object.fromEntries(got.documents.map((d) => [d.name, d.state]));
      for (const [file, , , , , , want] of cases) assert.equal(by[file], want, file);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  console.log(`${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("FAIL " + f);
  if (failures.length) process.exit(1);
  process.exit(0);
}
main().catch((error) => { console.error(error); process.exit(1); });

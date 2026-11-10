/** Coverage's "not read yet" notice (lib/benefit-table/service.ts documentState, components/benefit-table-coverage.tsx):
 * a document is "waiting" only while DearPolicy is genuinely reading it: a live intake job backs it (lib/rag/live-job.ts,
 * the Documents page's own rule), never a guess from the row's times. In intake with no live job (the job died, its lease
 * lapsed, or nothing claimed it) it is "stalled": never "still being read", and pointed to Try again on the Documents page. A receipt or letter (which intake never reads
 * into the table), or a reference document whose table reading was never stored, is never described as unread and never sent to
 * Read again (which re-reads and re-links every section, at a model cost); it is said not to be shown on this page (never "no
 * benefits": it may have some), and can still be asked about in chat. A schedule or certificate (the household's own proof
 * of cover) whose reading was never stored is "table_unread": its benefits couldn't be read for Coverage yet, and Read
 * again, which reads it into the table, is named (scripts/benefit-table/coverage-recovery-test.ts). A document the app could not read keeps its "could not be read" notice. In-memory rows, and one real-database check of real background_jobs rows (one transaction, rolled back); made-up
 * names, no model.
 *   DATABASE_URL=... npm run benefit-table:unread-notice-test */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as service from "@/lib/benefit-table/service";
import { documentName } from "@/lib/policies/inventory";
import { BenefitTableCoverage, type BenefitTableData } from "@/components/benefit-table-coverage";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => { passed++; }, (error) => { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); });
}

const A = "acct-lim";
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 24 * 3600_000;
type Policy = { id: string; original_filename: string; processing_status: string; document_role: string | null; product_name: string | null;
  insurer: string | null; policy_number: string | null; processing_completed_at: string | null; quarantine_status: string | null;
  created_at: string; updated_at: string; reading_live: boolean; link_only?: boolean };
const policy = (id: string, o: Partial<Policy>): Policy => ({ id, original_filename: `${id}.pdf`, processing_status: "ready", document_role: "personal_schedule",
  product_name: null, insurer: "Example Insurance", policy_number: null, processing_completed_at: ago(3 * DAY), quarantine_status: "scan_clean", created_at: ago(30 * DAY), updated_at: ago(3 * DAY), reading_live: false, ...o });

const reading = (covers: unknown[]) => ({ document: { document: { kind: "personal_proof", product: "Example Shield", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
  covers, benefits: [] }, pages: [] });

const policies: Policy[] = [
  policy("schedule", { product_name: "Example Shield" }),                                                    // read, with a cover
  policy("empty-read", { product_name: "Example Travel Guard", document_role: "product_summary" }),          // read, nothing to place
  policy("receipt", { document_role: "premium_receipt", product_name: "Example Shield receipt", reading_live: true }), // never read into the table, even while its job runs
  policy("letter", { document_role: "insurer_letter", product_name: null, original_filename: "Letter from Example Insurance.pdf" }),
  policy("summary", { original_filename: "0b6f3c1e-1a2b-4c3d-8e9f-0123456789ab.pdf", document_role: "product_summary", product_name: null, policy_number: "TRV-000-4821" }), // reading never stored
  policy("fresh", { product_name: "Example Critical Care", processing_completed_at: ago(60_000), reading_live: true }), // ready, its job is reading it into the table now
  policy("intake", { product_name: "Example Hospital Plan", processing_status: "extracting", processing_completed_at: null, reading_live: true }), // in intake, job live
  policy("scanning", { product_name: "Example Home Cover", processing_status: "queued", quarantine_status: "scan_pending", processing_completed_at: null, reading_live: true }), // upload scan running
  policy("rejected", { product_name: "Example Rejected Upload", processing_status: "queued", quarantine_status: "scan_rejected", processing_completed_at: null, reading_live: true }), // stays queued for good
  policy("blank", { product_name: "Example Blank Upload", processing_status: "queued", quarantine_status: null, processing_completed_at: null }),
  policy("legacy", { product_name: "Example Term Life", processing_completed_at: null }),                    // older row: no completion time, last touched days ago
  policy("touched", { product_name: "Example Dental Plan", processing_completed_at: null, updated_at: ago(60_000) }), // old unread document, a person linked to it a minute ago
  policy("future", { product_name: "Example Travel Plan", processing_completed_at: new Date(NOW + DAY).toISOString() }), // a completion time in the future, no job
  policy("dead-intake", { product_name: "Example Accident Plan", processing_status: "extracting", processing_completed_at: null, updated_at: ago(60_000) }), // its job died
  policy("unclaimed", { product_name: "Example Maternity Plan", processing_status: "queued", processing_completed_at: null, updated_at: ago(60_000) }), // nothing claimed its job
  policy("scan", { product_name: "Example Blurry Scan", processing_status: "failed" }),                      // could not be read
  policy("unchecked", { product_name: "Example Unchecked Pages" }),                                          // ready, but no page could be checked
  policy("linking", { product_name: "Example Long Wording" }), // its long reading is stored, the run that links its sections is still to come
];
const LINKING = { ...policies.at(-1)!, link_only: true };
policies[policies.length - 1] = LINKING;
const pages = [
  ...policies.filter((p) => p.id !== "unchecked").map((p) => ({ policy_id: p.id, page_number: 1, text: "SCHEDULE\nLim Ah Kow\tS$100,000", extraction_method: "native" })),
  { policy_id: "unchecked", page_number: 1, text: "garbled", extraction_method: "unchecked" },
];
const readings = new Map<string, unknown>([
  ["schedule", reading([{ person: "Lim Ah Kow", product: "Example Shield", cover: "Hospital", plan: null, sumInsured: 100000, asOf: null, page: 1, quote: "Lim Ah Kow\tS$100,000" }])],
  ["empty-read", reading([])],
  ["scan", reading([])], // a reading kept from before the document failed
  ["linking", reading([{ person: "Lim Ah Kow", product: "Example Long Wording", cover: "Death", plan: null, sumInsured: 500000, asOf: null, page: 1, quote: "Lim Ah Kow\tS$500,000" }])],
]);

const db: service.Db = async (sql, p) => {
  const q = sql.replace(/\s+/g, " ").trim();
  if (q.startsWith("SELECT id, display_name, preferred_name FROM family_members")) return [{ id: "p1", display_name: "Lim Ah Kow", preferred_name: null }];
  if (q.startsWith("SELECT id, original_filename, processing_status")) return p[0] === A ? policies : [];
  if (q.startsWith("SELECT policy_id, page_number, text FROM policy_pages"))
    return pages.filter((x) => (p[1] as string[]).includes(x.policy_id) && x.extraction_method !== "unchecked");
  if (q.startsWith("SELECT policy_id, reading FROM benefit_readings")) return [...readings].map(([policy_id, r]) => ({ policy_id, reading: JSON.stringify(r) }));
  if (q.startsWith("SELECT section_key, cover_key, why, chosen_by FROM benefit_links")) return [];
  if (q.startsWith("SELECT family_member_id, cover_key, status, sum_insured, updated_at FROM benefit_confirmations")) return [];
  throw new Error("fake db: unexpected statement " + q.slice(0, 80));
};

async function main() {
  const { documents, table } = await service.tableFor(db, A);
  const state = Object.fromEntries(documents.map((d) => [d.id, d.state]));

  await test("a receipt or a letter, which intake never reads into the table, is not waiting", () => {
    assert.equal(state.receipt, "no_table");
    assert.equal(state.letter, "no_table");
  });
  await test("a document whose table reading was never stored, long after it was ready, is not waiting", () => {
    assert.equal(state.summary, "no_table");
  });
  await test("a document in intake with a live job is waiting (it is being read), not 'could not be read'", () => {
    assert.equal(state.intake, "waiting");
    assert.equal(state.scanning, "waiting", "the upload scan is still running");
  });
  await test("an upload the scan rejected (or with no scan state) stays queued for good: could not be read, never waiting", () => {
    assert.equal(state.rejected, "not_readable");
    assert.equal(state.blank, "not_readable");
  });
  await test("a ready document with no stored reading and no live job is never waiting, whatever its times say", () => {
    // These are schedules (the household's own proof of cover): not waiting, and not left without a way forward either.
    assert.equal(state.legacy, "table_unread");
    assert.equal(state.touched, "table_unread", "linking a person to an old unread document does not make it 'being read'");
    assert.equal(state.future, "table_unread", "a completion time in the future does not keep it 'being read'");
  });
  await test("a document in intake whose job is not live is stalled, never waiting (the Documents page offers Try again)", () => {
    assert.equal(state["dead-intake"], "stalled");
    assert.equal(state.unclaimed, "stalled");
  });
  await test("control: a ready document whose job is reading it into the table now is waiting", () => {
    assert.equal(state.fresh, "waiting");
  });
  await test("controls: a read document is read, also when its reading had nothing to place", () => {
    assert.equal(state.schedule, "read");
    assert.equal(state["empty-read"], "read");
    assert.equal(table.people.find((p) => p.id === "p1")!.covers.length, 1);
  });
  await test("a long document whose reading is stored but whose sections are not linked yet is still being read, and shows none of its reading (TE #404)", () => {
    assert.equal(state.linking, "waiting");
    assert.ok(!table.people.flatMap((p) => p.covers).some((c) => /Long Wording|Death/.test(JSON.stringify(c))), "none of its covers or rows shown");
    assert.ok(!JSON.stringify(table).includes("500000"), "no figure from it");
  });
  await test("controls: a document that failed, or has no page that could be checked, keeps 'not readable'", () => {
    assert.equal(state.scan, "not_readable");
    assert.equal(state.unchecked, "not_readable");
  });
  await test("the rule is the live job, not a clock (TE Z2, Z8)", () => {
    const ds = (service as Record<string, unknown>).documentState as ((d: unknown, r: boolean) => string) | undefined;
    assert.ok(ds, "documentState is exported");
    const doc = (live: boolean, o: Record<string, unknown> = {}) => ({ status: "ready", pages: 2, live, file: { document_role: "personal_schedule", quarantine: "scan_clean" }, ...o });
    assert.equal(ds(doc(true), false), "waiting");
    assert.equal(ds(doc(false), false), "table_unread", "a schedule whose reading was not stored, with no job: Read again reads it in");
    assert.equal(ds(doc(true), true), "read");
    assert.equal(ds(doc(false), true), "read");
    // Z2: a receipt is never waiting, even while its intake job is still running.
    assert.equal(ds(doc(true, { file: { document_role: "premium_receipt", quarantine: "scan_clean" } }), false), "no_table");
    assert.equal(ds(doc(false, { file: { document_role: "premium_receipt", quarantine: "scan_clean" } }), false), "no_table");
    for (const status of ["uploaded", "queued", "extracting", "indexing"]) {
      assert.equal(ds({ status, pages: 0, live: true, file: { document_role: null, quarantine: "scan_clean" } }, false), "waiting", status);
      assert.equal(ds({ status, pages: 0, live: false, file: { document_role: null, quarantine: "scan_clean" } }, false), "stalled", status);
      assert.equal(ds({ status, pages: 0, live: true, file: { document_role: null, quarantine: "scan_rejected" } }, false), "not_readable", status);
    }
    assert.equal(ds({ status: "failed", pages: 2, live: true, file: { document_role: null, quarantine: "scan_clean" } }, false), "not_readable");
  });

  await test("real database: waiting exactly where the Documents page's rule finds a live job (TE Z8: the 10-minute edge)", async () => {
    const url = process.env.DATABASE_URL;
    assert.ok(url, "DATABASE_URL is needed: this check reads real background_jobs rows");
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query("BEGIN");
      const acct = randomUUID(), member = randomUUID();
      await client.query("INSERT INTO accounts(id,name) VALUES($1,'Tan household (test)')", [acct]);
      await client.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Tan Mei Ling','self')", [member, acct]);
      // [file, processing status, document role, the job row (null: none), expected state]
      const cases: [string, string, string | null, string | null, string][] = [
        ["live-queued.pdf", "queued", null, "status='queued', available_at=now()", "waiting"],
        ["queued-9min.pdf", "queued", null, "status='queued', available_at=now()-interval '9 minutes'", "waiting"],
        ["unclaimed-11min.pdf", "queued", null, "status='queued', available_at=now()-interval '11 minutes'", "stalled"],
        ["live-lease.pdf", "extracting", null, "status='processing', lease_expires_at=now()+interval '5 minutes'", "waiting"],
        ["lease-lapsed.pdf", "extracting", null, "status='processing', lease_expires_at=now()-interval '1 minute'", "stalled"],
        ["retry-wait.pdf", "indexing", null, "status='failed_retryable', available_at=now()+interval '2 minutes'", "waiting"],
        ["dead.pdf", "indexing", null, "status='dead_letter'", "stalled"],
        ["no-job.pdf", "queued", null, null, "stalled"],
        ["ready-table-read.pdf", "ready", "personal_schedule", "status='processing', lease_expires_at=now()+interval '5 minutes'", "waiting"],
        ["ready-done.pdf", "ready", "personal_schedule", "status='succeeded', completed_at=now()", "table_unread"],
        ["ready-receipt.pdf", "ready", "premium_receipt", "status='processing', lease_expires_at=now()+interval '5 minutes'", "no_table"],
      ];
      for (const [file, status, role, job] of cases) {
        const id = randomUUID();
        await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,document_role,processing_completed_at)
          VALUES($1,$2,$3,$4,$5,$6,'scan_clean',$7,$8)`, [id, acct, member, file, `test/${id}`, status, role, status === "ready" ? new Date() : null]);
        if (status === "ready") await client.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'SCHEDULE Tan Mei Ling')", [acct, id]);
        if (job) {
          await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'policy_processing',$2,'{}'::jsonb)", [acct, id]);
          await client.query(`UPDATE background_jobs SET ${job} WHERE job_type='policy_processing' AND idempotency_key=$1`, [id]);
        }
      }
      // A document waiting for the re-read intake scheduled after a reading-service failure (`<id>:retry-read`, due in 30
      // minutes) is being read, not stalled: Try again would read it twice (TE). A dead re-read is stalled.
      for (const [file, set, want] of [["deferred.pdf", "available_at=now()+interval '30 minutes'", "waiting"], ["deferred-dead.pdf", "status='dead_letter'", "stalled"]] as const) {
        const id = randomUUID();
        await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status)
          VALUES($1,$2,$3,$4,$5,'queued','scan_clean')`, [id, acct, member, file, `test/${id}`]);
        await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'policy_processing',$2,'{}'::jsonb)", [acct, id + ":retry-read"]);
        await client.query(`UPDATE background_jobs SET ${set} WHERE job_type='policy_processing' AND idempotency_key=$1`, [id + ":retry-read"]);
        cases.push([file, "queued", null, null, want]);
      }
      // A long document whose reading is stored and whose link run (benefit_table_reading) is still to come, however long it
      // waits and even when that run died (Coverage queues it again until it links, below): waiting, never "read" with
      // nothing linked and never "could not be read" (TE #404; DC 10 Nov).
      for (const [file, set, want] of [["link-waits-2h.pdf", "status='queued', available_at=now()-interval '2 hours'", "waiting"], ["link-dead.pdf", "status='dead_letter'", "waiting"]] as const) {
        const id = randomUUID();
        const progress = JSON.stringify({ benefitTableProgress: { id: "r1", fp: "", queue: [], done: [], headings: [], columns: [], calls: 0, limit: 0, outputLimit: 0, linkOnly: true } });
        await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,document_role,processing_completed_at,extracted_json)
          VALUES($1,$2,$3,$4,$5,'ready','scan_clean','personal_schedule',now(),$6::jsonb)`, [id, acct, member, file, `test/${id}`, progress]);
        await client.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'SCHEDULE Tan Mei Ling')", [acct, id]);
        await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'benefit_table_reading',$2,'{}'::jsonb)", [acct, `${id}:table-reading:r1:3`]);
        await client.query(`UPDATE background_jobs SET ${set} WHERE job_type='benefit_table_reading' AND idempotency_key=$1`, [`${id}:table-reading:r1:3`]);
        cases.push([file, "ready", "personal_schedule", null, want]);
      }
      // A long document whose reading is carried over runs (not stored yet) and whose next run died: still being read, never
      // "not read" (it is queued again below). One saved moments ago is not queued again yet: its run may be queuing the next.
      const readingProgress = (at: string) => JSON.stringify({ benefitTableProgress: { id: "r2", fp: "x", queue: [[1]], done: [], headings: [], columns: [], calls: 1, limit: 1, outputLimit: 1, run: 4, at } });
      const readDead = randomUUID(), readFresh = randomUUID();
      for (const [id, file, at] of [[readDead, "read-dead.pdf", "2000-01-01T00:00:00.000Z"], [readFresh, "read-fresh.pdf", new Date().toISOString()]] as const) {
        await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,document_role,processing_completed_at,extracted_json)
          VALUES($1,$2,$3,$4,$5,'ready','scan_clean','personal_schedule',now(),$6::jsonb)`, [id, acct, member, file, `test/${id}`, readingProgress(at)]);
        await client.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'SCHEDULE Tan Mei Ling')", [acct, id]);
        cases.push([file, "ready", "personal_schedule", null, "waiting"]);
      }
      await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload,status) VALUES($1,'benefit_table_reading',$2,'{}'::jsonb,'dead_letter')", [acct, `${readDead}:table-reading:r2:5`]);
      // A document read with a page read past (skippedPages): read in part, and the page is named (Critic and TE #404).
      const inPart = randomUUID();
      await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,document_role,processing_completed_at)
        VALUES($1,$2,$3,'read-in-part.pdf',$4,'ready','scan_clean','personal_schedule',now())`, [inPart, acct, member, `test/${inPart}`]);
      await client.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'SCHEDULE Tan Mei Ling')", [acct, inPart]);
      await client.query("INSERT INTO benefit_readings(policy_id,account_id,reading,model,prompt_version) VALUES($1,$2,$3::jsonb,'stand-in','t')",
        [inPart, acct, JSON.stringify({ document: { kind: "schedule", namedPeople: [] }, covers: [], benefits: [], pages: [], skippedPages: [23] })]);
      cases.push(["read-in-part.pdf", "ready", "personal_schedule", null, "read_in_part"]);
      const realDb: service.Db = async (sql, params) => (await client.query(sql, params as unknown[])).rows;
      const got = await service.tableFor(realDb, acct);
      assert.deepEqual(got.documents.find((d) => d.name === "read-in-part.pdf")?.unreadPages, [23], "the page read past is named");
      assert.equal(service.tableStateKey(got.documents.find((d) => d.name === "read-in-part.pdf")!), "read_in_part:23", "the chat is told which page");
      const by = Object.fromEntries(got.documents.map((d) => [d.name, d.state]));
      for (const [file, , , , want] of cases) assert.equal(by[file], want, file);

      // A dead link run is queued again when Coverage opens (requeueStuckLinks), later each time, until it links: never given
      // up on. A link run still queued is never queued twice. Queuing it reads nothing (the link run makes no reading call:
      // long-document-test K10).
      const { requeueStuckLinks } = await import("@/lib/benefit-table/app");
      const queued: { policyId: string; id: string; attempt: number; delayMs: number }[] = [];
      const later = async (policyId: string, id: string, attempt: number, delayMs: number) => { queued.push({ policyId, id, attempt, delayMs }); };
      const deadId = (await client.query("SELECT id::text FROM policies WHERE account_id=$1 AND original_filename='link-dead.pdf'", [acct])).rows[0].id as string;
      assert.equal(await requeueStuckLinks(realDb, acct, later), 1, "only the dead link run is queued again: the waiting one has its job");
      assert.deepEqual(queued.map((q) => [q.policyId, q.id, q.attempt]), [[deadId, "r1", 2]]);
      // Each time as if its last queuing were long ago (one queued moments ago may still be about to run).
      const aged = () => client.query(`UPDATE policies SET extracted_json=jsonb_set(extracted_json,'{benefitTableProgress,at}','"2000-01-01T00:00:00.000Z"') WHERE id=$1`, [deadId]);
      for (let i = 0; i < 8; i++) { await aged(); await requeueStuckLinks(realDb, acct, later); }
      assert.equal(queued.length, 9, "queued again every time it is still not linked: never given up on");
      assert.deepEqual(queued.map((q) => q.attempt), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
      assert.ok(queued.every((q, i) => i === 0 || q.delayMs >= queued[i - 1].delayMs) && queued.at(-1)!.delayMs <= 6 * 3600_000, "later each time, at most 6 hours");
      const still = Object.fromEntries((await service.tableFor(realDb, acct)).documents.map((d) => [d.name, d.state]));
      assert.equal(still["link-dead.pdf"], "waiting", "still being read, never 'could not be read'");
      const notes = (await client.query("SELECT extracted_json->'documentNotes' AS n FROM policies WHERE id=$1", [deadId])).rows[0].n;
      assert.ok(!JSON.stringify(notes ?? []).includes("could not"), "no 'could not be read' note");
      // Its link job queued now: not queued again.
      await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'benefit_table_reading',$2,'{}'::jsonb)", [acct, `${deadId}:table-reading:r1:link-10`]);
      assert.equal(await requeueStuckLinks(realDb, acct, later), 0);

      // The whole sweep (requeueStuckTableWork): the dead reading's next run is queued again, numbered on from its last run,
      // under a key of its own; the one saved moments ago and the ones with a job are not. Later each time; never given up on.
      const { requeueStuckTableWork, requeueStuckTableWorkEverywhere } = await import("@/lib/benefit-table/app");
      const reads: { policyId: string; id: string; run: number; again: number; delayMs: number }[] = [];
      const sweep = { link: later, read: async (policyId: string, id: string, run: number, again: number, delayMs: number) => { reads.push({ policyId, id, run, again, delayMs }); } };
      assert.equal(await requeueStuckTableWork(realDb, acct, sweep), 1);
      assert.deepEqual(reads.map((q) => [q.policyId, q.id, q.run, q.again]), [[readDead, "r2", 5, 1]]);
      for (let i = 0; i < 4; i++) {
        await client.query(`UPDATE policies SET extracted_json=jsonb_set(extracted_json,'{benefitTableProgress,at}','"2000-01-01T00:00:00.000Z"') WHERE id=$1`, [readDead]);
        await requeueStuckTableWork(realDb, acct, sweep);
      }
      assert.deepEqual(reads.map((q) => q.again), [1, 2, 3, 4, 5], "queued again every time: never given up on");
      assert.ok(reads.every((q, i) => i === 0 || q.delayMs > reads[i - 1].delayMs), "later each time");
      assert.equal((await service.tableFor(realDb, acct)).documents.find((d) => d.name === "read-dead.pdf")?.state, "waiting", "still being read");
      // From the drain and the daily run: every household whose table is on.
      const swept: string[] = [];
      await requeueStuckTableWorkEverywhere(realDb, async () => true, async (a) => { swept.push(a); return 0; });
      assert.ok(swept.includes(acct), "the drain's sweep reaches this household");
      swept.length = 0;
      await requeueStuckTableWorkEverywhere(realDb, async () => false, async (a) => { swept.push(a); return 0; });
      assert.deepEqual(swept, [], "a household whose table is off is not swept");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  // What the Coverage page says, with each document named the way the route names it.
  const named = documents.map((d) => ({ id: d.id, state: d.state as BenefitTableData["documents"][number]["state"],
    name: (d as { file?: Parameters<typeof documentName>[0] }).file ? documentName((d as unknown as { file: Parameters<typeof documentName>[0] }).file) : d.name }));
  const html = renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents: named, unmatchedCovers: [], illustrationCovers: [], unlinkedSections: [] } }));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/\s+/g, " ");

  await test("the page never tells the household to Read again a document that will never give rows", () => {
    // Read again is named once, for the schedules only (table_unread); never beside a receipt, letter or summary.
    assert.equal(text.match(/Read again/gi)?.length, 1, text);
    assert.match(text, /3 documents' benefits couldn't be read for Coverage yet\. Example Term Life, Example Dental Plan, Example Travel Plan\. You can use Read again on the Documents page ?\./);
    assert.ok(!/not been read/i.test(text), text);
  });
  await test("a document with no table is said not to be shown here (never 'no benefits'), by its readable name", () => {
    assert.match(text, /Example Shield receipt, Letter from Example Insurance, Example Insurance product summary \(ending 4821\) aren't shown on this page\. You can still ask about them in chat\./);
    assert.ok(!/no benefits/i.test(text), "missing information never reads as no benefits");
    assert.ok(!/0b6f3c1e/.test(text), "never the made-up file name");
  });
  await test("controls: documents being read and documents that could not be read keep their notices", () => {
    assert.match(text, /4 documents are still being read\. Example Critical Care, Example Hospital Plan, Example Home Cover, Example Long Wording\./);
    assert.match(text, /Some documents could not be read\. Example Rejected Upload, Example Blank Upload, Example Blurry Scan, Example Unchecked Pages/);
  });

  await test("a stalled document is never 'still being read': it hasn't finished reading, and can be tried again on the Documents page", () => {
    assert.match(text, /2 documents haven't finished reading\. Example Accident Plan, Example Maternity Plan\. You can try again on the Documents page ?\./);
    const still = text.match(/still being read\.[^.]*\./)?.[0] ?? "";
    assert.ok(!/Accident|Maternity/.test(still), still);
  });

  console.log(`${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((error) => { console.error(error); process.exit(1); });

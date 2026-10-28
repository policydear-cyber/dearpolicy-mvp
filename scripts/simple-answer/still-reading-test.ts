/** A document the app is reading right now is described as still being read, never as "could not be read"; a document the
 * app failed to read, or one in a status the app does not know, keeps "could not be read". "Reading right now" is the
 * Documents page's own rule (lib/rag/live-job.ts): an in-progress document whose intake job died, whose lease lapsed, or
 * that nothing claimed for UNCLAIMED_STALL_MINUTES is stalled, and is never "still being read" (it keeps "could not be
 * read", and the server's point says it can be tried again on the Documents page). No kind's text is sent or quoted.
 * Covers the chat library (renderLibrary), the server's own points about files (verifyAnswer: libraryFact,
 * libraryCount, libraryGroups) and the household read (readHousehold), the last also against a real database with
 * real background_jobs rows (one transaction, rolled back). Made-up household; no model.
 *   DATABASE_URL=... npm run simple:still-reading-test */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import assert from "node:assert/strict";
import { readHousehold, renderLibrary, stillReading, type Household, type HouseholdDocument } from "../../lib/simple-chat/library";
import { libraryFact, libraryGroups, verifyAnswer } from "../../lib/simple-chat/verify";
import { SIMPLE_SYSTEM_PROMPT, type ModelStatement } from "../../lib/simple-chat/prompt";

let passed = 0;
const failed: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (e) { failed.push(name); console.log("not ok - " + name + "\n  " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); }
}

const SECRET = "Hospital cash S$123 per day";
const base: HouseholdDocument = {
  policyId: "cccccccc-0000-4000-8000-000000000001", name: "Lim plan.pdf", insurer: "Example Insurance", productName: "Example Shield",
  policyNumber: null, documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-28",
  uploadedFor: "Lim Ah Kow", linkedPeople: ["Lim Ah Kow"], supersededAt: null, processingStatus: "ready",
  pages: [{ page: 1, text: `Example Shield schedule\n${SECRET}` }],
};
const doc = (n: number, name: string, extra: Partial<HouseholdDocument>): HouseholdDocument =>
  ({ ...base, policyId: `cccccccc-0000-4000-8000-00000000000${n}`, name, productName: null, ...extra });
const HOUSE: Household = {
  accountId: "22222222-2222-4222-8222-222222222222",
  members: [{ name: "Lim Ah Kow", relationship: "self" }, { name: "Tan Mei Ling", relationship: "spouse" }],
  documents: [
    doc(1, "read.pdf", { productName: "Example Shield", processingStatus: "ready" }),
    doc(2, "queued.pdf", { processingStatus: "queued", readingLive: true }),
    doc(3, "extracting.pdf", { processingStatus: "extracting", readingLive: true }),
    doc(4, "indexing.pdf", { processingStatus: "indexing", readingLive: true }),
    doc(5, "uploaded.pdf", { processingStatus: "uploaded", quarantineStatus: "scan_pending", readingLive: true }),
    doc(6, "failed.pdf", { processingStatus: "failed" }),
    doc(7, "odd.pdf", { processingStatus: "paused_by_operator", readingLive: true }),
    doc(8, "rejected.pdf", { processingStatus: "queued", quarantineStatus: "scan_rejected", readingLive: true }),
    doc(9, "gone.pdf", { processingStatus: "queued", quarantineStatus: null, readingLive: true }),
    // In progress, but no live job: the Documents page calls these stalled and offers Try again.
    doc(10, "stalled-queued.pdf", { processingStatus: "queued", quarantineStatus: "scan_clean", readingLive: false }),
    doc(11, "stalled-extracting.pdf", { processingStatus: "extracting" }),
  ],
};
const IN_PROGRESS = ["queued.pdf", "extracting.pdf", "indexing.pdf", "uploaded.pdf"];
const STALLED = ["stalled-queued.pdf", "stalled-extracting.pdf"];
const NOT_READ = ["failed.pdf", "odd.pdf", "rejected.pdf", "gone.pdf", ...STALLED];
const tagOf = (lib: string, name: string) => lib.match(new RegExp(`<document [^>]*name="${name.replace(/\./g, "\\.")}"[^>]*>\\n[\\s\\S]*?</document>`))?.[0] ?? "";

async function main() {
  await check("library: a document still being read says so, with no text sent; never 'could not be read'", () => {
    const lib = renderLibrary(HOUSE);
    for (const name of IN_PROGRESS) {
      const tag = tagOf(lib, name);
      assert.ok(tag, name);
      assert.match(tag, /reading_status="still being read/, name);
      assert.doesNotMatch(tag, /could not be read/, name);
      assert.match(tag, /<no_readable_text\/>/, name);
      assert.ok(!tag.includes(SECRET), name);
    }
  });

  await check("library: failed, unknown-status, scan-rejected and unknown-scan documents keep 'could not be read' (negative controls)", () => {
    const lib = renderLibrary(HOUSE);
    for (const name of NOT_READ) {
      const tag = tagOf(lib, name);
      assert.match(tag, /reading_status="could not be read \(/, name);
      assert.doesNotMatch(tag, /still being read/, name);
      assert.match(tag, /<no_readable_text\/>/, name);
      assert.ok(!tag.includes(SECRET), name);
    }
    assert.match(tagOf(lib, "failed.pdf"), /reading_status="could not be read \(failed\)"/);
    // A stalled document says exactly what main said of it: the model is told nothing new.
    assert.match(tagOf(lib, "stalled-queued.pdf"), /reading_status="could not be read \(queued\)"/);
    const read = tagOf(lib, "read.pdf");
    assert.doesNotMatch(read, /reading_status=/);
    assert.ok(read.includes(SECRET));
  });

  await check("server's point about one file: still being read vs could not be read", () => {
    const fact = (name: string) => libraryFact(HOUSE, HOUSE.documents.find((d) => d.name === name)!);
    for (const name of IN_PROGRESS) {
      assert.match(fact(name), new RegExp(`^${name.replace(/\./g, "\\.")} is still being read, so nothing in it is used yet; ask again in a minute\\.`), name);
      assert.doesNotMatch(fact(name), /could not be read/, name);
    }
    for (const name of NOT_READ) {
      assert.match(fact(name), /could not be read \(status: [^)]+\), so nothing in it was used\./, name);
      assert.doesNotMatch(fact(name), /still being read/, name);
    }
    // Stalled: the Documents page offers Try again; a failed or rejected one is not told so (negative controls).
    for (const name of STALLED) assert.match(fact(name), /could not be read \(status: (queued|extracting)\), so nothing in it was used\. It can be tried again on the Documents page\./, name);
    for (const name of ["failed.pdf", "odd.pdf", "rejected.pdf", "gone.pdf"]) assert.doesNotMatch(fact(name), /tried again/, name);
    assert.match(fact("read.pdf"), /was read\./);
  });

  await check("server's answer about the files (verifyAnswer): the count and per-file points tell reading from failed", () => {
    const st = (text: string, document: string | null): ModelStatement => ({ kind: "fact", text, person: null, document, quote: null, amount: null,
      alternativeGroup: null, percentOf: null, conditions: [] });
    const { answer } = verifyAnswer(HOUSE, { bottomLine: "", nextSteps: [], question: null, statements: [
      st("D2 could not be read.", "D2"),
      st("D6 could not be read.", "D6"),
      st("The other files (D1, D3) were read.", null),
    ] });
    const texts = answer.statements!.filter((x) => x.kind === "fact").map((x) => x.text);
    assert.ok(texts.some((t) => t.startsWith("queued.pdf is still being read, so nothing in it is used yet; ask again in a minute.")), texts.join("\n"));
    assert.ok(texts.some((t) => t.startsWith("failed.pdf could not be read (status: failed), so nothing in it was used.")), texts.join("\n"));
    assert.ok(texts.includes("Of your 11 uploaded files, 1 was read, 4 are still being read (queued.pdf, extracting.pdf, indexing.pdf, uploaded.pdf) and 6 could not be read (failed.pdf, odd.pdf, rejected.pdf, gone.pdf, stalled-queued.pdf, stalled-extracting.pdf)."), texts.join("\n"));
    assert.ok(!texts.join("\n").includes(SECRET));
  });

  await check("server's count with nothing still being read is unchanged (negative control)", () => {
    const st = (text: string): ModelStatement => ({ kind: "fact", text, person: null, document: null, quote: null, amount: null, alternativeGroup: null, percentOf: null, conditions: [] });
    const two: Household = { ...HOUSE, documents: [HOUSE.documents[0], HOUSE.documents[5]] };
    const { answer } = verifyAnswer(two, { bottomLine: "", nextSteps: [], question: null, statements: [st("The files (D1, D2) were read.")] });
    assert.deepEqual(answer.statements!.filter((x) => x.kind === "fact").map((x) => x.text), ["Of your 2 uploaded files, 1 was read and 1 could not be read (failed.pdf)."]);
  });

  await check("benefit-table library groups use the same words", () => {
    const lines = libraryGroups(HOUSE, HOUSE.documents);
    assert.ok(lines.some((l) => l.startsWith("queued.pdf is still being read")), lines.join("\n"));
    assert.ok(lines.some((l) => l.startsWith("failed.pdf could not be read")), lines.join("\n"));
  });

  await check("household read carries the scan status, so a scan-rejected upload is never called 'still being read'", async () => {
    const acct = HOUSE.accountId;
    const run = async (sql: string) => {
      if (/FROM family_members WHERE/.test(sql)) return [{ account_id: acct, display_name: "Lim Ah Kow", preferred_name: null, relationship: "self" }];
      if (/FROM policies p/.test(sql)) return [
        { account_id: acct, id: "cccccccc-0000-4000-8000-00000000000a", original_filename: "new.pdf", processing_status: "queued", quarantine_status: "scan_clean", created_at: "2026-10-28", reading_live: true },
        { account_id: acct, id: "cccccccc-0000-4000-8000-00000000000b", original_filename: "bad.pdf", processing_status: "queued", quarantine_status: "scan_rejected", created_at: "2026-10-28", reading_live: true },
      ];
      return [];
    };
    const h = await readHousehold(acct, run);
    const lib = renderLibrary(h);
    assert.match(tagOf(lib, "new.pdf"), /reading_status="still being read/);
    assert.match(tagOf(lib, "bad.pdf"), /reading_status="could not be read \(queued\)"/);
  });

  await check("household read against a real database: 'still being read' only with a live intake job (the Documents page's rule)", async () => {
    const url = process.env.DATABASE_URL;
    assert.ok(url, "DATABASE_URL is needed: this check reads real background_jobs rows");
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query("BEGIN");
      const acct = randomUUID(), member = randomUUID();
      await client.query("INSERT INTO accounts(id,name) VALUES($1,'Lim household (test)')", [acct]);
      await client.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Lim Ah Kow','self')", [member, acct]);
      // [file, processing status, the job row (null: none), whether it is being read]
      const cases: [string, string, string | null, boolean][] = [
        ["live-queued.pdf", "queued", "status='queued', available_at=now()", true],
        ["live-lease.pdf", "extracting", "status='processing', lease_expires_at=now()+interval '5 minutes'", true],
        ["retry-wait.pdf", "indexing", "status='failed_retryable', available_at=now()+interval '2 minutes'", true],
        ["queued-9min.pdf", "queued", "status='queued', available_at=now()-interval '9 minutes'", true],
        ["no-job.pdf", "queued", null, false],
        ["lease-lapsed.pdf", "extracting", "status='processing', lease_expires_at=now()-interval '1 minute'", false],
        ["unclaimed-11min.pdf", "queued", "status='queued', available_at=now()-interval '11 minutes'", false],
        ["dead.pdf", "indexing", "status='dead_letter'", false],
        ["done-job.pdf", "queued", "status='succeeded'", false],
      ];
      const ids = new Map<string, string>();
      for (const [file, status, job] of cases) {
        const id = randomUUID();
        ids.set(file, id);
        await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status)
          VALUES($1,$2,$3,$4,$5,$6,'scan_clean')`, [id, acct, member, file, `test/${id}`, status]);
        if (job) {
          await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'policy_processing',$2,'{}'::jsonb)", [acct, id]);
          await client.query(`UPDATE background_jobs SET ${job} WHERE job_type='policy_processing' AND idempotency_key=$1`, [id]);
        }
      }
      // Negative control: a live job of another type, or for another document, does not make this one being read.
      const other = randomUUID();
      await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status)
        VALUES($1,$2,$3,'other-type.pdf',$4,'queued','scan_clean')`, [other, acct, member, `test/${other}`]);
      await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'household_export',$2,'{}'::jsonb)", [acct, other]);
      cases.push(["other-type.pdf", "queued", null, false]);
      // A document waiting for the re-read intake scheduled after a reading-service failure (`<id>:retry-read`, due in
      // 30 minutes) is being read, not stalled: Try again would read it twice (TE). A dead re-read is not.
      for (const [file, set, live] of [["deferred.pdf", "available_at=now()+interval '30 minutes'", true], ["deferred-dead.pdf", "status='dead_letter'", false]] as const) {
        const id = randomUUID();
        await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status)
          VALUES($1,$2,$3,$4,$5,'queued','scan_clean')`, [id, acct, member, file, `test/${id}`]);
        await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'policy_processing',$2,'{}'::jsonb)", [acct, id + ":retry-read"]);
        await client.query(`UPDATE background_jobs SET ${set} WHERE job_type='policy_processing' AND idempotency_key=$1`, [id + ":retry-read"]);
        cases.push([file, "queued", null, live]);
      }

      const h = await readHousehold(acct, async (sql, params) => (await client.query(sql, params)).rows);
      const lib = renderLibrary(h);
      for (const [file, , , live] of cases) {
        const d = h.documents.find((x) => x.name === file)!;
        assert.ok(d, file);
        assert.equal(stillReading(d), live, file);
        const tag = tagOf(lib, file);
        if (live) assert.match(tag, /reading_status="still being read/, file);
        else {
          assert.match(tag, /reading_status="could not be read \(/, file);
          assert.doesNotMatch(tag, /still being read/, file);
          assert.match(libraryFact(h, d), /It can be tried again on the Documents page\./, file);
        }
      }
      // The same rows by the Documents page's own query: stalled exactly where the chat does not say "still being read".
      const { livePolicyJob, POLICY_PROCESSING_JOB_TYPE, UNCLAIMED_STALL_MINUTES } = await import("../../lib/rag/processing-queue");
      const stalled = new Set((await client.query(`SELECT p.id FROM policies p WHERE p.account_id=$1
          AND NOT EXISTS (SELECT 1 FROM background_jobs j WHERE j.job_type=$2 AND j.idempotency_key=p.id::text AND ${livePolicyJob("j", "$3")})`,
        [acct, POLICY_PROCESSING_JOB_TYPE, UNCLAIMED_STALL_MINUTES])).rows.map((r) => String(r.id)));
      // Except a document waiting for its scheduled re-read (`<id>:retry-read`): the Documents page's query misses that job
      // (pre-existing, outside this PR) and calls it stalled; the chat says it is being read, which is true.
      for (const d of h.documents) if (!d.name.startsWith("deferred.")) assert.equal(stillReading(d), !stalled.has(d.policyId), d.name);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  await check("prompt: a document still being read is said to be still being read", () => {
    assert.match(SIMPLE_SYSTEM_PROMPT, /still being read/);
  });

  console.log(`\n${passed} still-reading checks passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

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
import { offersTryAgain, readHousehold, renderLibrary, stalledReading, stillReading, type Household, type HouseholdDocument } from "../../lib/simple-chat/library";
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

  // An upload on hold for its malware scan (uploaded/quarantined/scan_pending, the Documents page's hold,
  // lib/policies/quarantine/ui.ts) waits on its scan, not on an intake job: being read while a live intake job or automatic
  // scan retry (lib/rag/live-job.ts scanJobLive) is checking it, otherwise on hold. Never stalled, never offered Try again
  // (app/api/policies/reprocess/route.ts refuses it until the scan is clean).
  const held = (n: number, name: string, extra: Partial<HouseholdDocument>) =>
    doc(n, name, { processingStatus: "queued", quarantineStatus: "scan_pending", readingLive: false, scanLive: false, holdLabel: "Waiting for malware scan", ...extra });
  const SCAN_HOUSE: Household = { ...HOUSE, documents: [
    HOUSE.documents[0],
    held(2, "scan-retry-live.pdf", { scanLive: true }),
    held(3, "held.pdf", {}),
    held(4, "held-uploaded.pdf", { processingStatus: "uploaded", quarantineStatus: "uploaded", holdLabel: "Waiting to start malware scan" }),
    held(5, "held-quarantined.pdf", { quarantineStatus: "quarantined", holdLabel: "Waiting to start malware scan" }),
    held(6, "held-prototype.pdf", { holdLabel: null }),
    // Controls: a clean upload with no live intake job is stalled and offered Try again, a scan retry or not.
    doc(7, "clean-stalled.pdf", { processingStatus: "queued", quarantineStatus: "scan_clean", readingLive: false, scanLive: false }),
    doc(8, "clean-stalled-scanjob.pdf", { processingStatus: "extracting", quarantineStatus: "scan_clean", readingLive: false, scanLive: true }),
    doc(9, "rejected-scanjob.pdf", { processingStatus: "queued", quarantineStatus: "scan_rejected", readingLive: false, scanLive: true }),
  ] };
  const scanDoc = (name: string) => SCAN_HOUSE.documents.find((d) => d.name === name)!;
  const HELD = ["held.pdf", "held-uploaded.pdf", "held-quarantined.pdf", "held-prototype.pdf"];

  await check("scan hold: a held upload with a live scan retry is still being read", () => {
    const d = scanDoc("scan-retry-live.pdf");
    assert.equal(stillReading(d), true);
    assert.equal(offersTryAgain(d), false);
    assert.match(tagOf(renderLibrary(SCAN_HOUSE), "scan-retry-live.pdf"), /reading_status="still being read/);
    assert.match(libraryFact(SCAN_HOUSE, d), /^scan-retry-live\.pdf is still being read, so nothing in it is used yet; ask again in a minute\./);
  });

  await check("scan hold: a held upload with no live job is on hold for its scan, not stalled, no Try again", () => {
    const lib = renderLibrary(SCAN_HOUSE);
    for (const name of HELD) {
      const d = scanDoc(name), tag = tagOf(lib, name), fact = libraryFact(SCAN_HOUSE, d);
      assert.equal(stillReading(d), false, name);
      assert.equal(stalledReading(d), false, name);
      assert.equal(offersTryAgain(d), false, name);
      assert.match(tag, /reading_status="on hold/, name);
      assert.doesNotMatch(tag, /could not be read|still being read/, name);
      assert.match(tag, /<no_readable_text\/>/, name);
      assert.ok(!tag.includes(SECRET), name);
      assert.match(fact, new RegExp(`^${name.replace(/\./g, "\\.")} is on hold`), name);
      assert.doesNotMatch(fact, /could not be read|still being read|tried again|Try again/i, name);
    }
    assert.match(tagOf(lib, "held.pdf"), /reading_status="on hold for its scan, so it is not being read yet \(Waiting for malware scan\)"/);
    assert.match(libraryFact(SCAN_HOUSE, scanDoc("held.pdf")), /^held\.pdf is on hold for its scan \(Waiting for malware scan\), so nothing in it is used yet\./);
  });

  await check("scan hold: prototype mode says on hold with no malware wording", () => {
    const tag = tagOf(renderLibrary(SCAN_HOUSE), "held-prototype.pdf"), fact = libraryFact(SCAN_HOUSE, scanDoc("held-prototype.pdf"));
    assert.match(tag, /reading_status="on hold, so it is not being read yet"/);
    assert.match(fact, /^held-prototype\.pdf is on hold, so nothing in it is used yet\./);
    for (const t of [tag, fact]) assert.doesNotMatch(t, /malware|scan/i);
  });

  await check("scan hold: the server's count names held uploads apart from stalled and failed ones", () => {
    const st = (text: string): ModelStatement => ({ kind: "fact", text, person: null, document: null, quote: null, amount: null, alternativeGroup: null, percentOf: null, conditions: [] });
    const { answer } = verifyAnswer(SCAN_HOUSE, { bottomLine: "", nextSteps: [], question: null, statements: [st("The files (D1, D2) were read.")] });
    const texts = answer.statements!.filter((x) => x.kind === "fact").map((x) => x.text);
    assert.ok(texts.includes("Of your 9 uploaded files, 1 was read, 1 is still being read (scan-retry-live.pdf), 4 are on hold for their scan (held.pdf, held-uploaded.pdf, held-quarantined.pdf, held-prototype.pdf) and 3 could not be read (clean-stalled.pdf, clean-stalled-scanjob.pdf, rejected-scanjob.pdf)."), texts.join("\n"));
  });

  await check("scan hold controls: a clean stalled upload still offers Try again, a scan retry or not; a rejected one does not", () => {
    for (const name of ["clean-stalled.pdf", "clean-stalled-scanjob.pdf"]) {
      const d = scanDoc(name);
      assert.equal(stillReading(d), false, name);
      assert.equal(offersTryAgain(d), true, name);
      assert.match(tagOf(renderLibrary(SCAN_HOUSE), name), /reading_status="could not be read \((queued|extracting)\)"/, name);
      assert.match(libraryFact(SCAN_HOUSE, d), /could not be read \(status: (queued|extracting)\), so nothing in it was used\. It can be tried again on the Documents page\./, name);
    }
    const r = scanDoc("rejected-scanjob.pdf");
    assert.equal(stillReading(r), false);
    assert.equal(offersTryAgain(r), false);
    assert.match(libraryFact(SCAN_HOUSE, r), /could not be read \(status: queued\)/);
  });

  await check("scan hold: the stored scanner text never reaches the library or the server's points; only the Documents page's fixed words", async () => {
    const acct = HOUSE.accountId, RAW = "VT analysis id u-9f3e engines 3/70 poll budget exhausted";
    const row = (id: string, file: string, q: string, detail: string | null) => ({ account_id: acct, id, original_filename: file, processing_status: "queued",
      quarantine_status: q, scan_result_detail: detail, created_at: "2026-10-28", reading_live: false, scan_live: false });
    const run = async (sql: string) => {
      if (/FROM family_members WHERE/.test(sql)) return [{ account_id: acct, display_name: "Lim Ah Kow", preferred_name: null, relationship: "self" }];
      if (/FROM policies p/.test(sql)) return [row("cccccccc-0000-4000-8000-00000000000c", "raw.pdf", "scan_pending", RAW),
        row("cccccccc-0000-4000-8000-00000000000d", "none.pdf", "scan_pending", "No malware-scanning adapter is configured in this environment."),
        row("cccccccc-0000-4000-8000-00000000000e", "incomplete.pdf", "scan_pending", "The malware scan did not complete. The document stays on hold until it is scanned successfully.")];
      return [];
    };
    for (const prototype of [false, true]) {
      const h = await readHousehold(acct, run, "", prototype);
      const lib = renderLibrary(h), out = [lib, ...h.documents.map((d) => libraryFact(h, d)), JSON.stringify(h)].join("\n");
      assert.ok(!out.includes(RAW), "raw scanner text leaked");
      assert.doesNotMatch(out, /u-9f3e|engines|poll budget|adapter is configured|stays on hold until/);
      for (const name of ["raw.pdf", "none.pdf", "incomplete.pdf"]) assert.match(tagOf(lib, name), /reading_status="on hold/, name);
      if (prototype) assert.doesNotMatch(out, /malware/i);
      else {
        // Unknown stored text is no category: the plain hold label, as the Documents page shows it.
        assert.match(tagOf(lib, "raw.pdf"), /\(Waiting for malware scan\)"/);
        assert.match(tagOf(lib, "incomplete.pdf"), /\(On hold: malware scan did not complete\)"/);
        assert.match(tagOf(lib, "none.pdf"), /\(On hold: malware scanning unavailable\)/);
      }
    }
  });

  await check("household read against a real database: a held upload is being read only with its own live scan retry", async () => {
    const url = process.env.DATABASE_URL;
    assert.ok(url, "DATABASE_URL is needed: this check reads real background_jobs rows");
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query("BEGIN");
      const acct = randomUUID(), member = randomUUID();
      await client.query("INSERT INTO accounts(id,name) VALUES($1,'Lim household (test)')", [acct]);
      await client.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Lim Ah Kow','self')", [member, acct]);
      const add = async (file: string, quarantine: string) => {
        const id = randomUUID();
        await client.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status)
          VALUES($1,$2,$3,$4,$5,'queued',$6)`, [id, acct, member, file, `test/${id}`, quarantine]);
        return id;
      };
      const job = async (key: string, set: string) => {
        await client.query("INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES($1,'document_scan_retry',$2,'{}'::jsonb)", [acct, key]);
        await client.query(`UPDATE background_jobs SET ${set} WHERE job_type='document_scan_retry' AND idempotency_key=$1`, [key]);
      };
      const live = await add("held-retry-live.pdf", "scan_pending");
      await job(`policy_document:${live}:scan-retry:1`, "status='queued', available_at=now()+interval '5 minutes'");
      await add("held-no-retry.pdf", "scan_pending");
      const dead = await add("held-retry-dead.pdf", "scan_pending");
      await job(`policy_document:${dead}:scan-retry:1`, "status='dead_letter'");
      // Another document's live retry does not make this one being read.
      await add("held-other-retry.pdf", "quarantined");
      const other = await add("other-clean.pdf", "scan_clean");
      await job(`policy_document:${other}:scan-retry:2`, "status='queued', available_at=now()");
      // Control: a clean upload with no intake job is stalled and offered Try again (other-clean.pdf too: a scan retry is
      // not an intake job).
      await add("clean-no-job.pdf", "scan_clean");

      const h = await readHousehold(acct, async (sql, params) => (await client.query(sql, params)).rows);
      const lib = renderLibrary(h), d = (file: string) => h.documents.find((x) => x.name === file)!;
      assert.equal(d("held-retry-live.pdf").scanLive, true);
      assert.equal(stillReading(d("held-retry-live.pdf")), true);
      assert.match(tagOf(lib, "held-retry-live.pdf"), /reading_status="still being read/);
      for (const file of ["held-no-retry.pdf", "held-retry-dead.pdf", "held-other-retry.pdf"]) {
        assert.equal(d(file).scanLive, false, file);
        assert.equal(stillReading(d(file)), false, file);
        assert.equal(offersTryAgain(d(file)), false, file);
        assert.match(tagOf(lib, file), /reading_status="on hold/, file);
        assert.doesNotMatch(libraryFact(h, d(file)), /tried again|could not be read/, file);
      }
      for (const file of ["clean-no-job.pdf", "other-clean.pdf"]) {
        assert.equal(stillReading(d(file)), false, file);
        assert.equal(offersTryAgain(d(file)), true, file);
        assert.match(libraryFact(h, d(file)), /It can be tried again on the Documents page\./, file);
      }
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  await check("prompt: a document on hold is said to be on hold, not unreadable", () => {
    assert.match(SIMPLE_SYSTEM_PROMPT, /starts "on hold"/);
  });

  await check("prompt: a document still being read is said to be still being read", () => {
    assert.match(SIMPLE_SYSTEM_PROMPT, /still being read/);
  });

  console.log(`\n${passed} still-reading checks passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

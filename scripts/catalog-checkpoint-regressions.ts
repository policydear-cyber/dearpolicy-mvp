/**
 * Catalogue-pass checkpoint/resume regressions, run against a disposable
 * PGlite instance with the repository schema, exactly like
 * scripts/prototype-scan-mode-regressions.ts.
 *
 * The benefits and conditions catalogue passes make one model call per prose
 * page. On Vercel Hobby there is no worker: processing advances inside
 * bounded request drains, and an invocation that runs out of its window is
 * simply cut off. Before lib/policies/catalog-checkpoint.ts the passes
 * persisted only at the end of the loop, so every retry restarted at page 1
 * and a long document could never finish (observed live: a 39-page product
 * summary reached page 20 on one attempt, restarted at page 3 on the next,
 * headed for the dead-letter queue).
 *
 * Proves, for BOTH passes, against the real loops:
 *  1. A run cut off mid-document leaves a checkpoint recording exactly the
 *     pages already read.
 *  2. The retry resumes at the first unread page -- it never re-reads page 1
 *     -- and a completed pass keeps a done marker so the NEXT retry of the
 *     same job skips the whole stage (the pipeline re-runs every stage per
 *     attempt; without the marker a retry that only needed the later stage
 *     would re-read this one from scratch and burn its window).
 *  3. A checkpoint written over different page text is ignored: the pass
 *     restarts from page 1 rather than resuming over the wrong document.
 *
 * DEARPOLICY_DETERMINISTIC_MODEL is set so model calls fail fast offline
 * (every prose page is "skipped, never guessed" -- which is exactly the
 * per-page work the checkpoint brackets).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

async function main() {
  const saved = {
    model: process.env.DEARPOLICY_DETERMINISTIC_MODEL,
    runId: process.env.E2E_RUN_ID,
  };
  // Model calls must fail fast and deterministically offline; what is under
  // test is the loop around them, not the calls themselves.
  process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
  process.env.E2E_RUN_ID = "ckpt-regressions";

  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/chat-upgrade.sql"), "utf8"));

  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; }); await previous; return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) {
      const results = await db.exec(text); const result = results.at(-1);
      return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;

  try {
    const { catalogueDocument } = await import("@/lib/policies/catalog-builder");
    const { catalogueConditions } = await import("@/lib/policies/condition-catalog");

    const account = "83000000-0000-4000-8000-000000000001";
    const member = "83000000-0000-4000-8000-000000000002";
    const policy = "83000000-0000-4000-8000-000000000003";
    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Checkpoint Test')`, [account]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Self','self')`, [member, account]);
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status)
       VALUES($1,$2,$3,'ckpt.pdf','k-ckpt','queued')`,
      [policy, account, member]);

    // Prose pages: no parseable schedule rows, so every page takes the
    // model path, which fails fast offline and is skipped -- the loop still
    // visits and checkpoints every page. Page 1 is a schedule the table
    // parser reads without the model, so the pass finds something; a pass in
    // which every model page failed and nothing was found is a failed read
    // (tested last).
    const prose = (n: number) => ({
      page_number: n,
      text: `Page ${n}. This section explains the policy's administrative provisions in continuous prose, with no benefit schedule, no amounts and no table rows, so only the reading model could be consulted about it.`,
    });
    const schedule = { page_number: 1,
      text: "Schedule of Benefits\nBenefit\tLimit\nOverseas medical expenses\tS$500,000\nPersonal accident\tS$200,000\nBaggage loss\tS$5,000\nEmergency evacuation\tS$100,000" };
    const pages = [schedule, ...Array.from({ length: 7 }, (_, i) => prose(i + 2))];

    const checkpointRow = async (stage: string) => {
      const r = await pool.query(
        `SELECT analysis_json FROM policy_analysis_cache WHERE account_id=$1 AND cache_key=$2`,
        [account, `catalog-progress:${stage}:${policy}`]);
      return (r.rows[0] as { analysis_json: unknown } | undefined)?.analysis_json ?? null;
    };

    type RunArgs = { accountId: string; policyId: string; productName: string | null;
      pages: { page_number: number; text: string }[]; report?: (page: number, total: number) => void };
    const stages: [string, (args: RunArgs) => Promise<number>][] = [
      ["benefits", (args) => catalogueDocument(args)],
      ["conditions", (args) => catalogueConditions(args)],
    ];

    for (const [stage, run] of stages) {
      await testAsync(`${stage}: a cut-off run leaves a checkpoint at the last completed page`, async () => {
        await assert.rejects(run({ accountId: account, policyId: policy, productName: null, pages,
          report: (page) => { if (page === 5) throw new Error("drain window cut off"); } }));
        const row = (await checkpointRow(stage)) as { nextIndex: number } | null;
        assert.ok(row, "checkpoint row written");
        assert.equal(row.nextIndex, 4, "pages 1-4 completed before the cut-off");
      });
      await testAsync(`${stage}: the retry resumes at the first unread page and a completed pass keeps its marker`, async () => {
        const reported: number[] = [];
        await run({ accountId: account, policyId: policy, productName: null, pages,
          report: (page) => { reported.push(page); } });
        assert.equal(reported[0], 5, "resumed, not restarted");
        assert.deepEqual(reported, [5, 6, 7, 8]);
        const done = (await checkpointRow(stage)) as { nextIndex: number } | null;
        assert.equal(done?.nextIndex, pages.length, "completed pass keeps a done marker");
      });
      await testAsync(`${stage}: a retry after completion skips the whole pass instead of re-reading it`, async () => {
        const reported: number[] = [];
        await run({ accountId: account, policyId: policy, productName: null, pages,
          report: (page) => { reported.push(page); } });
        assert.deepEqual(reported, [], "no page re-read after the stage completed");
      });
      await testAsync(`${stage}: changed page text restarts from page 1 instead of resuming`, async () => {
        // The done marker above covers the ORIGINAL text; revised text must
        // be read afresh (and can itself be cut off and resumed).
        const revised = pages.map((page) => ({ ...page, text: page.text + " (revised wording)" }));
        await assert.rejects(run({ accountId: account, policyId: policy, productName: null, pages: revised,
          report: (page) => { if (page === 3) throw new Error("drain window cut off"); } }));
        const changed = revised.map((page, i) => i === 5 ? { ...page, text: page.text + " changed" } : page);
        const reported: number[] = [];
        await run({ accountId: account, policyId: policy, productName: null, pages: changed,
          report: (page) => { reported.push(page); } });
        assert.equal(reported[0], 1, "a stale checkpoint over different text is ignored");
        const done = (await checkpointRow(stage)) as { nextIndex: number } | null;
        assert.equal(done?.nextIndex, changed.length, "done marker recorded for the new text");
      });
    }

    await testAsync("benefits: a pass in which every model page failed and nothing was found is a failed read, not \"read, nothing found\"", async () => {
      const other = "83000000-0000-4000-8000-0000000000f1";
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status)
         VALUES($1,$2,$3,'prose.pdf','k-prose','queued')`, [other, account, member]);
      const prosePages = Array.from({ length: 3 }, (_, i) => prose(i + 1));
      await assert.rejects(catalogueDocument({ accountId: account, policyId: other, productName: null, pages: prosePages }),
        "the caller records the failure and the document stays on the unread list");
      const rows = await pool.query(`SELECT count(*)::int AS n FROM policy_benefits WHERE policy_id=$1`, [other]);
      assert.equal((rows.rows[0] as { n: number }).n, 0);
      const left = await pool.query(`SELECT 1 FROM policy_analysis_cache WHERE account_id=$1 AND cache_key=$2`,
        [account, `catalog-progress:benefits:${other}`]);
      assert.equal(left.rows.length, 0, "no checkpoint is left to skip the pass on Try again");
    });

    console.log(`Catalogue checkpoint regressions passed (${cases} cases).`);
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    if (saved.model === undefined) delete process.env.DEARPOLICY_DETERMINISTIC_MODEL; else process.env.DEARPOLICY_DETERMINISTIC_MODEL = saved.model;
    if (saved.runId === undefined) delete process.env.E2E_RUN_ID; else process.env.E2E_RUN_ID = saved.runId;
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Regression suite for the stuck-chat-spinner heal in lib/chat/jobs.ts
 * (getChatJob). A chat_analysis worker that dies silently -- serverless
 * invocation killed, lease expired, background job swept into dead_letter
 * -- never runs processChatAnalysisJob's catch block, so nothing wrote a
 * terminal status to chat_analysis_jobs and the browser polled a spinner
 * forever. getChatJob now detects a queued/running chat row whose backing
 * background job is dead_letter and flips it to a normal, retryable
 * failure at the read.
 *
 * Same disposable-PGlite + pool-patching pattern as every other suite in
 * this repository.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool, query } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { enqueueJob } from "@/lib/jobs/queue";
import { CHAT_ANALYSIS_JOB_TYPE, getChatJob } from "@/lib/chat/jobs";

const SQL_FILES = ["sql/schema.sql", "sql/background-jobs.sql", "sql/chat-upgrade.sql"];

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

async function seedAccount(): Promise<string> {
  const id = randomUUID();
  await query("INSERT INTO accounts(id,name) VALUES ($1,'Test')", [id]);
  return id;
}

async function seedChatJob(accountId: string, status: string): Promise<string> {
  const id = randomUUID();
  await query(
    "INSERT INTO chat_analysis_jobs(id,account_id,status,request_json) VALUES ($1,$2,$3,'{}'::jsonb)",
    [id, accountId, status]);
  return id;
}

async function backingJob(accountId: string, chatJobId: string, status: string) {
  const enqueued = await enqueueJob(pool, { jobType: CHAT_ANALYSIS_JOB_TYPE, idempotencyKey: chatJobId, accountId, payload: { chatJobId } });
  await query("UPDATE background_jobs SET status=$2 WHERE id=$1", [enqueued.row.id, status]);
}

async function main() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    if (params.length === 0) {
      const results = await db.exec(text);
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  pool.query = (async (text: string, params: unknown[] = []) => {
    const release = await acquire();
    try {
      return await execute(text, params);
    } finally {
      release();
    }
  }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return {
      query: (text: string, params: unknown[] = []) => execute(text, params),
      release,
    };
  }) as unknown as typeof pool.connect;

  const accountId = await seedAccount();

  await testAsync("a running chat row with a still-live backing job is left alone", async () => {
    const chatJobId = await seedChatJob(accountId, "running");
    await backingJob(accountId, chatJobId, "processing");
    const row = await getChatJob(accountId, chatJobId);
    assert.equal(row?.status, "running");
    const stored = await query<{ status: string; error: string | null }>("SELECT status,error FROM chat_analysis_jobs WHERE id=$1", [chatJobId]);
    assert.equal(stored.rows[0].status, "running");
    assert.equal(stored.rows[0].error, null);
  });

  await testAsync("a running chat row whose backing job dead-lettered is healed to a retryable failure", async () => {
    const chatJobId = await seedChatJob(accountId, "running");
    await backingJob(accountId, chatJobId, "dead_letter");
    const row = await getChatJob(accountId, chatJobId);
    assert.equal(row?.status, "failed");
    assert.match(row?.error ?? "", /could not be finished/);
    // The heal is persisted, not cosmetic: the next plain read agrees.
    const again = await getChatJob(accountId, chatJobId);
    assert.equal(again?.status, "failed");
    assert.match(again?.error ?? "", /try sending it again/);
  });

  await testAsync("a queued chat row whose backing job dead-lettered is healed too", async () => {
    const chatJobId = await seedChatJob(accountId, "queued");
    await backingJob(accountId, chatJobId, "dead_letter");
    const row = await getChatJob(accountId, chatJobId);
    assert.equal(row?.status, "failed");
  });

  await testAsync("a terminal chat row is never rewritten, whatever the backing job says", async () => {
    const chatJobId = await seedChatJob(accountId, "complete");
    await backingJob(accountId, chatJobId, "dead_letter");
    const row = await getChatJob(accountId, chatJobId);
    assert.equal(row?.status, "complete");
    const stored = await query<{ error: string | null }>("SELECT error FROM chat_analysis_jobs WHERE id=$1", [chatJobId]);
    assert.equal(stored.rows[0].error, null);
  });

  await testAsync("the heal is account-scoped: another account cannot see or flip the row", async () => {
    const chatJobId = await seedChatJob(accountId, "running");
    await backingJob(accountId, chatJobId, "dead_letter");
    const otherAccount = await seedAccount();
    assert.equal(await getChatJob(otherAccount, chatJobId), null);
    const stored = await query<{ status: string }>("SELECT status FROM chat_analysis_jobs WHERE id=$1", [chatJobId]);
    assert.equal(stored.rows[0].status, "running");
  });

  console.log("chat stuck-job regressions passed (" + cases + " cases)");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});

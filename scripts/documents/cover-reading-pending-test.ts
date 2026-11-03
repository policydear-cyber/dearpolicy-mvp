/**
 * A document whose cover reading did not finish (the reading service failed; lib/rag/ingest.ts readInPart) says so, in
 * the household's words, with the step that can work. New-household audit, 3 Nov, defect 2: the card said "some details
 * could not be matched to the page they came from" (another state's reason), and the stored note still said "it will
 * try again automatically" after the last automatic retry had run. Made-up households, PGlite, no network, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installDatabase } from "../r6/fixture";
import * as errors from "@/lib/documents/processing-errors";
import { coverReadingPending, readInPartAdvice } from "@/lib/documents/failure-advice";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("each stored state gets its own reason and next step; any other text gets none", () => {
  const waiting = coverReadingPending(errors.DOCUMENT_READ_IN_PART_MESSAGE);
  assert.ok(waiting);
  assert.match(waiting.what, /couldn't finish reading who it covers and its cover amounts/);
  assert.match(waiting.next, /try again automatically/);
  const final = coverReadingPending(errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE);
  assert.ok(final);
  assert.match(final.next, /Read again/);
  assert.doesNotMatch(final.next + final.what, /automatically|matched to the page/);
  for (const other of [null, "", "Ready.", "Read in part. Page 3 could not be checked.", errors.DOCUMENT_READING_SERVICE_MESSAGE, errors.DOCUMENT_READING_FAILED_MESSAGE,
    errors.DOCUMENT_READ_IN_PART_MESSAGE + "Page 4 is sideways.", errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE.toUpperCase(), "Note. " + errors.DOCUMENT_READ_IN_PART_MESSAGE])
    assert.equal(coverReadingPending(other), null, String(other));
  // A later note after the stored one (an earlier copy kept for reference) is the same state (TE #313).
  const kept = "An earlier schedule of the same policy (ending 1 March 2026), replaced by the newer schedule “b.pdf”; kept for reference.";
  assert.match(coverReadingPending(errors.DOCUMENT_READ_IN_PART_MESSAGE + " " + kept)!.next, /automatically/);
  assert.match(coverReadingPending(errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE + " " + kept)!.next, /Read again/);
  // The two states never overlap with "Read in part" (that card has its own advice).
  assert.equal(readInPartAdvice(errors.DOCUMENT_READ_IN_PART_MESSAGE), null);
  assert.equal(readInPartAdvice(errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE), null);
});

test("the final note is honest: no promise of another try, no internals, the file is not blamed", () => {
  const m = errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE;
  assert.doesNotMatch(m, /try again automatically|will try/i);
  assert.doesNotMatch(m, /could not be read|unreadable|clearer|upload/i);
  assert.doesNotMatch(m, /model|provider|quota|error|exception|job|queue|ocr/i);
  assert.match(m, /Read again/);
  assert.deepEqual([...errors.DOCUMENT_READ_IN_PART_MESSAGES], [errors.DOCUMENT_READ_IN_PART_MESSAGE, m]);
});

test("intake chooses the note by whether a retry was really scheduled, and the card shows it before 'Not fully confirmed'", () => {
  const ingest = readFileSync("lib/rag/ingest.ts", "utf8");
  const schedule = ingest.indexOf("const retryScheduled = readInPart ? await scheduleDeferredRead(args) : false;");
  const ready = ingest.indexOf("UPDATE policies SET processing_status='ready',processing_stage='complete'");
  assert.ok(schedule > 0 && ready > schedule, "the retry is scheduled before the note is written");
  assert.match(ingest, /readInPart\s*\?\s*withPageNotes\(retryScheduled \? DOCUMENT_READ_IN_PART_MESSAGE : DOCUMENT_READ_IN_PART_FINAL_MESSAGE,/);
  assert.doesNotMatch(ingest.slice(ready, ready + 3000), /scheduleDeferredRead\(args\)/, "scheduled once, not again after the note");
  const page = readFileSync("app/policies/page.tsx", "utf8");
  assert.match(page, /const pending = !part && !processing && policy\.processing_status === "ready" \? coverReadingPending\(policy\.processing_message\) : null;/);
  assert.match(page, /\{!part && !pending && !processing && policy\.needs_review/, "'Not fully confirmed' is never shown for this state");
});

test("Home counts a document in either state as not fully read (lib/policies/not-fully-read.ts)", async () => {
  const db = await installDatabase();
  await db.exec("ALTER TABLE policies ADD COLUMN IF NOT EXISTS reading_cache jsonb");
  const A = "00000000-0000-0000-0000-0000000e0001", P = "72000000-0000-4000-8000-000000000001", Q = "72000000-0000-4000-8000-000000000002";
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [A]);
  for (const [p, name] of [[P, "Nadia Rahman"], [Q, "Owen Price"]]) await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,'self')", [p, A, name]);
  let n = 0;
  const add = async (member: string, message: string, role: string, product: string) => {
    const pid = "73000000-0000-4000-8000-" + String(++n).padStart(12, "0");
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_message,document_role,product_name,quarantine_status)
      VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8,$9,'scan_clean')`, [pid, A, member, `u${n}.pdf`, "k/" + pid, "h" + pid, message, role, product]);
    await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'Made-up page')", [A, pid]);
    await db.query("INSERT INTO policy_members(account_id,policy_id,family_member_id) VALUES($1,$2,$3)", [A, pid, member]);
  };
  await add(P, errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE, "certificate", "Example Takaful Shield (RM)");
  await add(P, errors.DOCUMENT_READ_IN_PART_MESSAGE, "personal_schedule", "Example Health Cash Plan (£)");
  await add(P, "Ready.", "personal_schedule", "Example Term");
  await add(P, errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE + " An earlier schedule of the same policy, replaced by the newer schedule “b.pdf”; kept for reference.", "personal_schedule", "Example Hospital Plan (HK$)");
  await add(P, errors.DOCUMENT_READ_IN_PART_MESSAGE + "X", "personal_schedule", "Example Not A Note (€)");
  await add(Q, errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE, "premium_receipt", "Example Receipt");
  const { notFullyRead } = await import("@/lib/policies/not-fully-read");
  const nadia = await notFullyRead(A, P);
  assert.equal(nadia.count, 3, JSON.stringify(nadia));
  assert.deepEqual(new Set(nadia.names), new Set(["Example Takaful Shield (RM)", "Example Health Cash Plan (£)", "Example Hospital Plan (HK$)"]));
  assert.equal((await notFullyRead(A, Q)).count, 0, "a receipt never holds cover, in either state");
});

test("a document read in part keeps its page notes after the message, and every reader still sees the state (TE and Critic #323)", () => {
  const unread = errors.unreadablePagesNote([4]);
  const unchecked = "Read in part. Page 2 could not be checked: a second reading from the page image did not agree with its text, so no amount on it is used.";
  for (const lead of errors.DOCUMENT_READ_IN_PART_MESSAGES) {
    const stored = errors.withPageNotes(lead, [unchecked, unread, null, "Page 3 was sideways or upside down; DearPolicy turned it upright to read it."]);
    assert.ok(stored.startsWith(lead + " "), stored);
    assert.match(stored, /Page 4 could not be read, so anything printed only there is not available\./);
    assert.match(stored, /Page 2 could not be checked/);
    assert.match(stored, /Page 3 was sideways/);
    assert.doesNotMatch(stored, /Read in part\./, "the lead says it already; a note's own 'Read in part.' is dropped");
    assert.ok(coverReadingPending(stored), "the card still shows 'Not fully read yet'");
    assert.equal(readInPartAdvice(stored), null, "never the other state's 'Read in part' advice");
    // lib/policies/not-fully-read.ts matches the lead exactly or the lead and a space.
    assert.ok(stored === lead || stored.slice(0, lead.length + 1) === lead + " ");
  }
  assert.equal(errors.withPageNotes(errors.DOCUMENT_READ_IN_PART_MESSAGE, [null, undefined, ""]), errors.DOCUMENT_READ_IN_PART_MESSAGE, "no notes: the message alone, as before");
});

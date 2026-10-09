/**
 * docs/trial/scanned-detect.sql on a disposable PGlite database loaded with the real schema: documents stored by the
 * pre-fix code (scanned page kept as empty 'native' text; an all-scan document refused as unreadable) are found;
 * documents read after the fix (page 'ocr'), visibly unread pages ('unreadable'), text-only documents, deleted
 * documents and documents processed after the fix are not. The scanned page text comes from run ingest-live-2's dump.
 * Asserts the query is READ ONLY (it runs inside BEGIN TRANSACTION READ ONLY ... ROLLBACK).
 *   node --import tsx scripts/ingest-live/scanned-detect-test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { UNREADABLE_DOCUMENT_MESSAGE, UNREADABLE_PHOTO_MESSAGE } from "@/lib/documents/processing-errors";

const SQL_FILES = ["sql/schema.sql", "sql/lifecycle.sql", "sql/v11-ingestion-evidence.sql"];
const RUN2 = "docs/rag-migration/ingest-live/RUN-ingest-live-2-2026-10-09T14-53-47/dump-processing/dump.json";

async function main() {
  const detect = fs.readFileSync("docs/trial/scanned-detect.sql", "utf8");
  assert.ok(detect.includes(UNREADABLE_DOCUMENT_MESSAGE) && detect.includes(UNREADABLE_PHOTO_MESSAGE), "the query names the app's own unreadable-document messages verbatim");
  assert.match(detect, /BEGIN TRANSACTION READ ONLY;[\s\S]*ROLLBACK;\s*$/, "read only");
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i.test(detect.replace(/--.*$/gm, "")), "no write statement");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  for (const f of SQL_FILES) await db.exec(fs.readFileSync(f, "utf8"));
  const dump = JSON.parse(fs.readFileSync(RUN2, "utf8"));
  const scannedRow = dump.tables.policies.find((p: any) => p.original_filename === "hx-scanned.pdf");
  const scannedText: string = dump.tables.policy_pages.find((p: any) => p.policy_id === scannedRow.id).text;
  assert.ok(scannedText.length > 100, "run 2 read the scanned page");
  const acct = "00000000-0000-4000-8000-0000000000f3";
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'SYNTHETIC-DPTEST-scanned-detect')", [acct]);
  const fm = (await db.query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Isla Maren Hartwell','child') RETURNING id", [acct])).rows[0].id;
  const before = "2026-10-01T00:00:00Z", after = "2026-10-12T00:00:00Z", fixedAt = "2026-10-10T00:00:00Z";
  const doc = async (name: string, status: string, at: string, pages: [number, string, string | null][], extra: { error?: string; lifecycle?: string } = {}) => {
    const id = (await db.query<{ id: string }>(`INSERT INTO policies(account_id,family_member_id,original_filename,processing_status,processing_error,processing_completed_at,updated_at,page_count,lifecycle_state,storage_key)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) RETURNING id`, [acct, fm, name, status, extra.error ?? null, at, pages.length || 1, extra.lifecycle ?? "active", `test/${name}`])).rows[0].id;
    for (const [n, text, method] of pages) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text,extraction_method) VALUES($1,$2,$3,$4,$5)", [acct, id, n, text, method]);
    return name;
  };
  const schedule = "Meridian Harbour Assurance SafeStay Family Plan Policy Schedule MHA-HC-2025-0748213 Simon Alastair Hartwell 01 February 2026 to 31 January 2027";
  await doc("pre-fix-mixed.pdf", "ready", before, [[1, schedule, "native"], [2, "", "native"], [3, " 3 ", null]]);   // FOUND: pages 2, 3
  await doc("pre-fix-all-scan.pdf", "failed", before, [], { error: UNREADABLE_DOCUMENT_MESSAGE });                     // FOUND: whole document
  await doc("pre-fix-photo.jpg", "failed", before, [], { error: UNREADABLE_PHOTO_MESSAGE });                         // FOUND: whole document
  await doc("post-fix-read.pdf", "ready", before, [[1, scannedText, "ocr"]]);                                         // read (run 2's page)
  await doc("post-fix-mixed.pdf", "ready", before, [[1, schedule, "native"], [2, scannedText, "ocr"]]);
  await doc("post-fix-unread.pdf", "ready", before, [[1, schedule, "native"], [2, "", "unreadable"]]);                // visibly unread
  await doc("text-only.pdf", "ready", before, [[1, schedule, "native"], [2, schedule, "native"]]);
  await doc("deleted.pdf", "ready", before, [[1, "", "native"]], { lifecycle: "pending_deletion" });
  await doc("processed-after-fix.pdf", "ready", after, [[1, schedule, "native"], [2, "", "native"]]);
  await doc("other-failure.pdf", "failed", before, [], { error: "DearPolicy could not open this file." });
  const results = await db.exec(detect.replace(/:'fixed_at'/g, `'${fixedAt}'`));
  const rows = results.find((r) => r.fields.some((f) => f.name === "finding"))!.rows as any[];
  const found = Object.fromEntries(rows.map((r) => [r.original_filename, r]));
  assert.deepEqual(Object.keys(found).sort(), ["pre-fix-all-scan.pdf", "pre-fix-mixed.pdf", "pre-fix-photo.jpg"]);
  assert.deepEqual(found["pre-fix-mixed.pdf"].empty_page_numbers, [2, 3]);
  assert.equal(found["pre-fix-all-scan.pdf"].finding, "whole document unread (failed: no readable text)");
  const summary = results.find((r) => r.fields.some((f) => f.name === "pages_to_read"))!.rows[0] as any;
  assert.equal(Number(summary.documents), 3);
  assert.equal(Number(summary.pages_to_read), 4, "2 empty pages + 1 + 1");
  console.log(`scanned-detect: found ${rows.length} pre-fix documents (${rows.map((r) => r.original_filename).join(", ")}); ${summary.pages_to_read} pages to read; read, visibly unread, text-only, deleted and post-fix documents not listed -- passed.`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

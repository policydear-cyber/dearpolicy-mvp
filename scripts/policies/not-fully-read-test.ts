/**
 * Home and Coverage say "Not found" for a cover no document shows. When one of the person's documents failed to read,
 * was read in part, or had its cover reading stop, that cover may simply not have been read, so the tile and the
 * Coverage answer say so (lib/policies/not-fully-read.ts). Made-up household in PGlite, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDatabase } from "../r6/fixture";
import { DOCUMENT_READ_IN_PART_MESSAGE } from "@/lib/documents/processing-errors";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const ACCOUNT = "00000000-0000-0000-0000-0000000f0001", OTHER = "00000000-0000-0000-0000-0000000f0002";
const ADA = "70000000-0000-4000-8000-000000000001", BEN = "70000000-0000-4000-8000-000000000002", ZOE = "70000000-0000-4000-8000-000000000003";
let n = 0;
const id = () => "71000000-0000-4000-8000-" + String(++n).padStart(12, "0");

test("only a person's failed, partly read or cover-stopped documents count, and the note says so", async () => {
  const db = await installDatabase();
  await db.exec("ALTER TABLE policies ADD COLUMN IF NOT EXISTS reading_cache jsonb");
  for (const [a, name] of [[ACCOUNT, "Made-up household"], [OTHER, "Other household"]]) await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [a, name]);
  for (const [p, a, name] of [[ADA, ACCOUNT, "Ada Okafor"], [BEN, ACCOUNT, "Ben Okafor"], [ZOE, OTHER, "Zoe Lim"]])
    await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,'self')", [p, a, name]);
  const add = async (o: { account?: string; member?: string | null; link?: string; status: string; message?: string | null; role?: string | null; product?: string | null; cache?: object; superseded?: boolean; deleted?: boolean; pages?: number; quarantine?: string; age?: string }) => {
    const pid = id();
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_message,document_role,product_name,reading_cache,quarantine_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [pid, o.account ?? ACCOUNT, o.member ?? o.link ?? ADA, "upload-" + n + ".pdf", "k/" + pid, "h" + pid, o.status, o.message ?? null, o.role ?? null, o.product ?? null, o.cache ? JSON.stringify(o.cache) : null, o.quarantine ?? "scan_clean"]);
    // A ready document has its pages unless the case says otherwise.
    for (let page = 1; page <= (o.pages ?? (o.status === "ready" ? 1 : 0)); page++)
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,'Made-up page')", [o.account ?? ACCOUNT, pid, page]);
    if (o.age) await db.query(`UPDATE policies SET updated_at=now()-interval '${o.age}' WHERE id=$1`, [pid]);
    if (o.link) await db.query("INSERT INTO policy_members(account_id,policy_id,family_member_id) VALUES($1,$2,$3)", [o.account ?? ACCOUNT, pid, o.link]);
    if (o.superseded) await db.query("UPDATE policies SET superseded_at=now() WHERE id=$1", [pid]);
    if (o.deleted) await db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [pid]);
    return pid;
  };
  // Ada: one failed upload (owner set, no member link yet), one schedule read in part (linked), one ready schedule.
  await add({ member: ADA, status: "failed", message: "Analysis stopped" });
  await add({ member: ADA, link: ADA, status: "ready", message: "Read in part. Page 3 could not be checked against the page image.", product: "Example Saver Plan", role: "personal_schedule" });
  await add({ member: ADA, link: ADA, status: "ready", message: "Ready.", role: "personal_schedule", product: "Example Term" });
  // Ada: a document whose cover reading stopped, and a receipt whose (never-run) cover reading note must not count.
  await add({ link: ADA, status: "ready", message: DOCUMENT_READ_IN_PART_MESSAGE, role: "certificate", product: "Example Shield" });
  await add({ link: ADA, status: "ready", message: "Ready.", role: "premium_receipt", cache: { benefit_read_failure: { attempts: 1, reasonCode: "timeout" } } });
  await add({ link: ADA, status: "ready", message: "Ready.", role: "certificate", product: "Example Travel", cache: { benefit_read_failure: { attempts: 2, reasonCode: "timeout" } } });
  // Not counted: still reading, a superseded or deleted failed copy, "Ready." text that merely mentions reading in part.
  await add({ member: ADA, status: "extracting", message: "Reading…" });
  await add({ member: ADA, status: "failed", superseded: true });
  await add({ member: ADA, status: "failed", deleted: true });
  await add({ link: ADA, status: "ready", message: "Ready. Read in part pages were checked again." });
  // Uploaded for Ben but linked to Ada only: Ada's. Another person, another household.
  await add({ member: BEN, link: ADA, status: "failed", product: "Example Linked Plan" });
  await add({ member: BEN, link: BEN, status: "failed" });
  await add({ account: OTHER, member: ZOE, status: "failed" });

  // Ben: documents intake never finished with (Critic R345 M1, TE #185): queued two days ago, held for its scan an hour,
  // rejected by the scan, and ready with no pages: counted. Still reading within Home's 30 minutes: not counted.
  await add({ member: BEN, status: "queued", age: "2 days" });
  await add({ member: BEN, status: "uploaded", quarantine: "scan_pending", age: "1 hour" });
  await add({ member: BEN, status: "queued", quarantine: "scan_rejected" });
  await add({ member: BEN, link: BEN, status: "ready", role: "certificate", pages: 0 });
  await add({ member: BEN, status: "extracting", age: "5 minutes" });
  // Ben: a failed or read-in-part receipt or letter never holds cover (TE #185 finding 1): not counted.
  await add({ member: BEN, link: BEN, status: "failed", role: "premium_receipt" });
  await add({ member: BEN, link: BEN, status: "ready", role: "insurer_letter", message: "Read in part. Page 2 could not be checked." });
  // Ben: what the benefit table says. A letter that is a misfiled pack waiting for Read again counts whatever its role;
  // a failed receipt the table calls not readable still does not.
  const pack = await add({ member: BEN, link: BEN, status: "ready", role: "insurer_letter", product: "Example Pack" });
  const receipt = await add({ member: BEN, link: BEN, status: "failed", role: "premium_receipt" });
  const tableDocs = [{ id: pack, state: "table_unread" }, { id: receipt, state: "not_readable" }];

  const { notFullyRead, notFullyReadNote } = await import("@/lib/policies/not-fully-read");
  const ada = await notFullyRead(ACCOUNT, ADA);
  assert.equal(ada.count, 5, JSON.stringify(ada));
  assert.equal(ada.ids.length, 5);
  assert.equal(new Set(ada.ids).size, 5, "one id per document, so Home names a document once");
  assert.ok(ada.names.includes("Example Saver Plan") && ada.names.includes("Example Shield") && ada.names.includes("Example Travel"), JSON.stringify(ada.names));
  assert.equal((await notFullyRead(ACCOUNT, BEN)).count, 5, "a failed upload and four that intake never finished with");
  const ben = await notFullyRead(ACCOUNT, BEN, tableDocs);
  assert.equal(ben.count, 6, JSON.stringify(ben));
  assert.ok(ben.ids.includes(pack) && !ben.ids.includes(receipt));
  assert.equal((await notFullyRead(OTHER, ADA)).count, 0, "never another household's documents");
  assert.equal((await notFullyRead(ACCOUNT, ZOE)).count, 0);

  assert.equal(notFullyReadNote({ count: 0 }, "Ada"), null);
  assert.equal(notFullyReadNote({ count: 1 }, "Ben", true), "One of Ben’s documents was not fully read.");
  assert.equal(notFullyReadNote(ada, "Ada", true), "5 of Ada’s documents were not fully read.");
  assert.match(notFullyReadNote(ada, "Ada") ?? "", /^5 of Ada’s documents were not fully read, so cover in them may be missing here\. Documents shows which/);
  await db.close();
});

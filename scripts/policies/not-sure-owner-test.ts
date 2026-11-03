/**
 * An upload whose person was "Not sure" is filed under the household's first person only as a placeholder. It counts as
 * a person's document once someone is linked to it, never before: Home said "4 of Alex's documents were not fully read"
 * when Alex had 2 (new-household audit, 3 Nov, defect 3). Made-up households in PGlite, no network, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installDatabase } from "../r6/fixture";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const A = "00000000-0000-0000-0000-0000000d0001";
const ALEX = "74000000-0000-4000-8000-000000000001", BELLA = "74000000-0000-4000-8000-000000000002", WEI = "74000000-0000-4000-8000-000000000003";
let n = 0;

test("a 'Not sure' upload is nobody's until someone is linked; a chosen upload and an older one count as before", async () => {
  const db = await installDatabase();
  await db.exec("ALTER TABLE policies ADD COLUMN IF NOT EXISTS reading_cache jsonb");
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [A]);
  for (const [p, name, rel] of [[ALEX, "Alex Tan", "self"], [BELLA, "Bella Tan", "spouse"], [WEI, "Wei Ming Tan", "child"]])
    await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,$4)", [p, A, name, rel]);
  const { noteOwnerUnsure, UNSURE_KEY } = await import("@/lib/policies/upload-owner");
  const add = async (o: { owner: string; unsure?: boolean; link?: string; status: string; message?: string; product: string; review?: boolean; stale?: boolean }) => {
    const pid = "75000000-0000-4000-8000-" + String(++n).padStart(12, "0");
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_message,product_name,document_role,quarantine_status,needs_review,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'personal_schedule','scan_clean',$10,$11)`, [pid, A, o.owner, `u${n}.pdf`, "k/" + pid, "h" + pid, o.status, o.message ?? null, o.product, o.review ?? false, o.stale ? new Date(Date.now() - 3 * 3600_000) : new Date()]);
    if (o.status === "ready") await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'Made-up page')", [A, pid]);
    if (o.unsure) await noteOwnerUnsure(A, pid);
    if (o.link) await db.query("INSERT INTO policy_members(account_id,policy_id,family_member_id) VALUES($1,$2,$3)", [A, pid, o.link]);
    return pid;
  };
  // Alex chose himself twice: one failed, one read in part. Counted.
  await add({ owner: ALEX, status: "failed", product: "Example Term (S$)" });
  await add({ owner: ALEX, link: ALEX, status: "ready", message: "Read in part. Page 2 could not be checked.", product: "Example Shield (S$)" });
  // "Not sure" twice, nobody linked yet (a failed upload; one read with no name matched): nobody's.
  const unsureFailed = await add({ owner: ALEX, unsure: true, status: "failed", product: "Example Takaful (RM)" });
  await add({ owner: ALEX, unsure: true, status: "ready", message: "Read in part. Page 1 could not be checked.", product: "Example Cash Plan (£)" });
  // "Not sure", then its printed name linked it to Bella: Bella's, not Alex's.
  await add({ owner: ALEX, unsure: true, link: BELLA, status: "ready", message: "Read in part. Page 4 could not be checked.", product: "Example Travel (S$)" });
  // "Not sure", stuck in the queue for hours; and one still being read now (Home's reading count shows that one).
  await add({ owner: ALEX, unsure: true, status: "queued", stale: true, product: "Example Medical Card (HK$)" });
  await add({ owner: ALEX, unsure: true, status: "queued", product: "Example Hospital Plan (A$)" });
  // An upload from before the note existed: counts as before (the placeholder owner).
  await add({ owner: ALEX, status: "failed", product: "Example Old Upload" });

  const stored = (await db.query<{ ok: boolean }>("SELECT reading_cache ? $2 AS ok FROM policies WHERE id=$1", [unsureFailed, UNSURE_KEY])).rows[0];
  assert.equal(stored.ok, true, "the upload's choice is kept with the document");

  const { notFullyRead, OWNED_BY_MEMBER } = await import("@/lib/policies/not-fully-read");
  const alex = await notFullyRead(A, ALEX);
  assert.deepEqual(new Set(alex.names), new Set(["Example Term (S$)", "Example Shield (S$)", "Example Old Upload"]), JSON.stringify(alex));
  const bella = await notFullyRead(A, BELLA);
  assert.deepEqual(bella.names, ["Example Travel (S$)"]);
  assert.equal((await notFullyRead(A, WEI)).count, 0);
  // Nobody's, so the household is told once: failed, stalled and read-in-part "Not sure" uploads nobody is linked to.
  // Not the one still being read, not the one linked to Bella, not anyone's own.
  const { unownedNotFullyRead } = await import("@/lib/policies/not-fully-read");
  const household = await unownedNotFullyRead(A);
  assert.deepEqual(new Set(household.names), new Set(["Example Takaful (RM)", "Example Cash Plan (£)", "Example Medical Card (HK$)"]), JSON.stringify(household));
  // Every upload is counted somewhere (or is still being read): none vanishes, none is counted twice.
  const people = [...alex.ids, ...bella.ids, ...household.ids];
  assert.equal(new Set(people).size, people.length);
  assert.equal(people.length, n - 1);

  // Without the reading_cache column the rule is the old one (no column to read the note from).
  assert.doesNotMatch(OWNED_BY_MEMBER("$2"), /reading_cache/);
  assert.match(OWNED_BY_MEMBER("$2", true), new RegExp(`NOT coalesce\\(p\\.reading_cache \\? '${UNSURE_KEY}',false\\)`));
  // The note only narrows the placeholder owner: a linked person always counts.
  const linkedOnly = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM policies p WHERE p.account_id=$1 AND ${OWNED_BY_MEMBER("$2", true)}`, [A, BELLA])).rows[0].n;
  assert.equal(linkedOnly, 1);
});

test("the upload writes the note only for 'Not sure', parts of a 'Not sure' file inherit it, and Home's other reminder uses the same rule", () => {
  const accept = readFileSync("app/api/policies/upload/accept.ts", "utf8");
  assert.match(accept, /if \(!args\.explicitFamilyMember\) await noteOwnerUnsure\(ctx\.householdId, policyId\);/);
  const ingest = readFileSync("lib/rag/ingest.ts", "utf8");
  assert.match(ingest, /if \(!args\.linkUploadMember\) \{ const \{ noteOwnerUnsure \} = await import\("@\/lib\/policies\/upload-owner"\); await noteOwnerUnsure\(args\.accountId, partId\); \}/);
  const dashboard = readFileSync("app/api/dashboard/route.ts", "utf8");
  assert.match(dashboard, /OWNED_BY_MEMBER\("\$2",await readingCacheReady\(\)\)\} AND p\.needs_review/);
  // Home names unowned unfinished uploads once, leaving out those already in "Say whose" (ready, nobody linked).
  assert.match(dashboard, /unownedNotFullyRead\(accountId,tableDocuments\)\)\.ids\.filter\(\(id\)=>!claimable\.has\(id\)\)/);
  const notRead = readFileSync("lib/policies/not-fully-read.ts", "utf8");
  assert.match(notRead, /OWNED_BY_MEMBER\("\$2", cache\)/);
});

/**
 * An upload chosen for one person whose printed names put it with someone else says so on its card, beside the way to
 * change it (new-household audit, 3 Nov: uploaded "for Bella", it prints Alex's name, and it moved silently). The choice
 * is kept as chosen at upload, survives a re-read, and a document split out of the file keeps it. Made-up households in
 * PGlite, no network, no model.
 *   npm run policies:upload-override-test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installDatabase } from "../r6/fixture";
import { listNames, uploadOverrideLine } from "@/lib/policies/upload-override";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const family = [
  { id: "m-nadia", display_name: "Nadia Rahman" }, { id: "m-omar", display_name: "Omar Rahman" },
  { id: "m-siti", display_name: "Siti" }, { id: "m-li", display_name: "李明" },
];

test("the card line: shown only when a printed name put it with someone other than the person chosen", () => {
  // Chosen Nadia; the certificate prints Omar's name and was matched to Omar.
  assert.equal(uploadOverrideLine({ uploadChoice: "m-nadia", linkedIds: ["m-omar"], named: [{ name: "OMAR BIN RAHMAN", memberId: "m-omar" }] }, family),
    "You uploaded this for Nadia Rahman. The name printed in it matches Omar Rahman, so it is used for Omar Rahman.");
  // Two printed names, two other people (any script).
  assert.equal(uploadOverrideLine({ uploadChoice: "m-nadia", linkedIds: ["m-omar", "m-li"], named: [{ name: "Omar Rahman", memberId: "m-omar" }, { name: "李明", memberId: "m-li" }] }, family),
    "You uploaded this for Nadia Rahman. The names printed in it match Omar Rahman and 李明, so it is used for them.");
  // The chosen person is covered too (a family certificate naming both): nothing to say.
  assert.equal(uploadOverrideLine({ uploadChoice: "m-nadia", linkedIds: ["m-nadia", "m-omar"], named: [{ name: "Nadia", memberId: "m-nadia" }, { name: "Omar", memberId: "m-omar" }] }, family), null);
  // The printed name was the chosen person: nothing to say.
  assert.equal(uploadOverrideLine({ uploadChoice: "m-siti", linkedIds: ["m-siti"], named: [{ name: "SITI BINTI ALI", memberId: "m-siti" }] }, family), null);
  // "Not sure", an upload from before the choice was kept, or a chosen person since removed from the household: nothing.
  for (const uploadChoice of [null, undefined, "m-gone"]) assert.equal(uploadOverrideLine({ uploadChoice, linkedIds: ["m-omar"], named: [{ name: "Omar", memberId: "m-omar" }] }, family), null);
  // No printed name matched anyone (it asks "Who is this?" instead): nothing.
  assert.equal(uploadOverrideLine({ uploadChoice: "m-nadia", linkedIds: [], named: [{ name: "Someone Else", memberId: null }] }, family), null);
  // The same person under two printed names is named once.
  assert.equal(uploadOverrideLine({ uploadChoice: "m-siti", linkedIds: ["m-omar"], named: [{ name: "Omar Rahman", memberId: "m-omar" }, { name: "O. Rahman", memberId: "m-omar" }] }, family),
    "You uploaded this for Siti. The names printed in it match Omar Rahman, so it is used for Omar Rahman.");
  // Only people it is used for now: the household moved Omar's name to Siti, or nobody is linked yet, or one of two is.
  assert.equal(uploadOverrideLine({ uploadChoice: "m-nadia", linkedIds: ["m-siti"], named: [{ name: "Omar Rahman", memberId: "m-omar" }] }, family), null);
  assert.equal(uploadOverrideLine({ uploadChoice: "m-nadia", linkedIds: [], named: [{ name: "Omar Rahman", memberId: "m-omar" }] }, family), null);
  assert.equal(uploadOverrideLine({ uploadChoice: "m-nadia", linkedIds: ["m-omar"], named: [{ name: "Omar Rahman", memberId: "m-omar" }, { name: "李明", memberId: "m-li" }] }, family),
    "You uploaded this for Nadia Rahman. The name printed in it matches Omar Rahman, so it is used for Omar Rahman.");
  // The chosen person's own printed name (not linked) is not one of the names that put it elsewhere.
  assert.equal(uploadOverrideLine({ uploadChoice: "m-nadia", linkedIds: ["m-omar"], named: [{ name: "Nadia Rahman", memberId: "m-nadia" }, { name: "Omar Rahman", memberId: "m-omar" }] }, family),
    "You uploaded this for Nadia Rahman. The name printed in it matches Omar Rahman, so it is used for Omar Rahman.");
  assert.equal(listNames(["A", "B", "C"]), "A, B and C");
});

const A = "00000000-0000-0000-0000-0000000e0001";
const NADIA = "76000000-0000-4000-8000-000000000001", OMAR = "76000000-0000-4000-8000-000000000002";
const DOC = "77000000-0000-4000-8000-000000000001", PART = "77000000-0000-4000-8000-000000000002", OTHER = "77000000-0000-4000-8000-000000000003";

test("the choice is kept as chosen, survives other notes on the document, and a part split out of the file keeps it", async () => {
  const db = await installDatabase();
  await db.exec("ALTER TABLE policies ADD COLUMN IF NOT EXISTS reading_cache jsonb");
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [A]);
  for (const [p, name, rel] of [[NADIA, "Nadia Rahman", "self"], [OMAR, "Omar Rahman", "spouse"]])
    await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,$4)", [p, A, name, rel]);
  for (const id of [DOC, PART, OTHER])
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,quarantine_status)
      VALUES($1,$2,$3,$4,$5,$6,'ready','scan_clean')`, [id, A, NADIA, id + ".pdf", "k/" + id, "h" + id]);
  const { noteOwnerChosen, copyOwnerChosen, CHOSEN_KEY, UNSURE_KEY } = await import("@/lib/policies/upload-owner");
  await noteOwnerChosen(A, DOC, NADIA);
  // The owner later follows a printed name to Omar, and the reading adds its own notes: the choice stays Nadia.
  await db.query("UPDATE policies SET family_member_id=$2, reading_cache=reading_cache||'{\"ledger_retry\":{\"n\":1}}'::jsonb WHERE id=$1", [DOC, OMAR]);
  const kept = (await db.query<{ m: string | null }>(`SELECT reading_cache->'${CHOSEN_KEY}'->>'member' AS m FROM policies WHERE id=$1`, [DOC])).rows[0].m;
  assert.equal(kept, NADIA);
  await copyOwnerChosen(A, DOC, PART);
  assert.equal((await db.query<{ m: string | null }>(`SELECT reading_cache->'${CHOSEN_KEY}'->>'member' AS m FROM policies WHERE id=$1`, [PART])).rows[0].m, NADIA);
  // Copying from a document with no choice writes nothing, and another household's document is never touched.
  await copyOwnerChosen(A, OTHER, PART);
  assert.equal((await db.query<{ m: string | null }>(`SELECT reading_cache->'${CHOSEN_KEY}'->>'member' AS m FROM policies WHERE id=$1`, [PART])).rows[0].m, NADIA);
  await copyOwnerChosen("00000000-0000-0000-0000-0000000e0099", DOC, OTHER);
  assert.equal((await db.query<{ c: unknown }>("SELECT reading_cache AS c FROM policies WHERE id=$1", [OTHER])).rows[0].c, null);
  assert.notEqual(CHOSEN_KEY, UNSURE_KEY);
});

test("the upload keeps the choice, a part inherits it, the list returns it and the card shows the line", () => {
  const accept = readFileSync("app/api/policies/upload/accept.ts", "utf8");
  assert.match(accept, /if \(!args\.explicitFamilyMember\) await noteOwnerUnsure\(ctx\.householdId, policyId\);\n[^\n]*\n\s*else await noteOwnerChosen\(ctx\.householdId, policyId, outcome\.familyMemberId\);/);
  const ingest = readFileSync("lib/rag/ingest.ts", "utf8");
  assert.match(ingest, /else \{ const \{ copyOwnerChosen \} = await import\("@\/lib\/policies\/upload-owner"\); await copyOwnerChosen\(args\.accountId, args\.policyId, partId\); \}/);
  const route = readFileSync("app/api/policies/route.ts", "utf8");
  assert.match(route, /\$\{uploadChoice\} AS upload_choice/);
  const page = readFileSync("app/policies/page.tsx", "utf8");
  assert.match(page, /uploadOverrideLine\(\{ uploadChoice: policy\.upload_choice/);
  assert.match(page, /data-testid="upload-override"/);
});

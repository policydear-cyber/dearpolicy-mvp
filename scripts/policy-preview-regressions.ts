/**
 * Document Preview: GET /api/policies/[id]/file opens a household's own
 * document so a person can tell which one it is. A new link or byte stream is
 * issued only for a document the caller's household owns, that is the current
 * active version and that the scan cleared (or prototype mode recorded as not
 * scanned), re-checked on every request; a PDF on Supabase Storage gets a
 * signed URL of at most 300 seconds, a photo comes back re-encoded as a JPEG,
 * a Word file downloads, and every response is private/no-store and carries no
 * storage key. Real route on PGlite; the Supabase signing endpoint is simulated
 * at global.fetch only. Synthetic households and files.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { asUser, fixedUuid, startReviewerHarness } from "./fixtures/reviewer-harness";

let cases = 0;
let finished = false;
async function testAsync(name: string, fn: () => Promise<void>) {
  console.log(`policy preview: ${name}`);
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}
process.on("beforeExit", () => {
  if (!finished && !process.exitCode) { console.error("policy preview regressions did not finish (a pending operation never settled)"); process.exitCode = 1; }
});

async function main() {
  const h = await startReviewerHarness();
  const ownerA = fixedUuid("b9600000", 1), memberUser = fixedUuid("b9600000", 2), ownerB = fixedUuid("b9600000", 3);
  const householdA = fixedUuid("a9600000", 1), householdB = fixedUuid("a9600000", 2);
  const envBefore = { STORAGE_DRIVER: process.env.STORAGE_DRIVER, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR };
  const fetchBefore = global.fetch;
  const storageDir = await mkdtemp(path.join(tmpdir(), "dp-preview-"));
  try {
    process.env.LOCAL_STORAGE_DIR = storageDir;
    process.env.STORAGE_DRIVER = "local";
    await h.createHousehold(householdA, ownerA);
    await h.createHousehold(householdB, ownerB, "Other household");
    await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'member')`, [householdA, memberUser]);
    const memberA = await h.createMember(householdA, fixedUuid("d9600000", 1), "Alex Tan");
    const memberB = await h.createMember(householdB, fixedUuid("d9600000", 2), "Sam Lee");

    const { savePolicyFile } = await import("@/lib/storage");
    const sharp = (await import("sharp")).default;
    let seq = 0;
    /** One stored document: the file is really written (local driver), then its row. */
    async function doc(accountId: string, memberId: string, filename: string, bytes: Uint8Array, quarantine: string | null = "scan_clean") {
      const id = fixedUuid("c9600000", ++seq);
      const storageKey = await savePolicyFile({ accountId, familyMemberId: memberId, policyId: id, filename, bytes });
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,processing_status,original_filename,storage_key,quarantine_status) VALUES($1,$2,$3,'ready',$4,$5,$6)`,
        [id, accountId, memberId, filename, storageKey, quarantine]);
      return { id, storageKey };
    }
    const pdf = (n: number) => new Uint8Array(Buffer.from(`%PDF-1.4\n%preview-${n}\n%%EOF\n`, "latin1"));
    const png = new Uint8Array(await sharp({ create: { width: 3200, height: 1600, channels: 3, background: "#3366aa" } }).png().toBuffer());

    const own = await doc(householdA, memberA, "a8f3_20261020_scan.pdf", pdf(1));
    const prototype = await doc(householdA, memberA, "prototype.pdf", pdf(2), "not_scanned_prototype");
    const photo = await doc(householdA, memberA, "IMG_4021.png", png);
    const word = await doc(householdA, memberA, "Benefits table.docx", new Uint8Array(Buffer.from("PK\x03\x04 word/document.xml synthetic", "latin1")));
    const pending = await doc(householdA, memberA, "pending.pdf", pdf(3), "scan_pending");
    const quarantined = await doc(householdA, memberA, "held.pdf", pdf(4), "quarantined");
    const rejected = await doc(householdA, memberA, "rejected.pdf", pdf(5), "scan_rejected");
    const legacy = await doc(householdA, memberA, "just-uploaded.pdf", pdf(6), "uploaded");
    const superseded = await doc(householdA, memberA, "old-version.pdf", pdf(7));
    await pool.query(`UPDATE policies SET superseded_at=now() WHERE id=$1`, [superseded.id]);
    const deleted = await doc(householdA, memberA, "deleted.pdf", pdf(8));
    await pool.query(`UPDATE policies SET lifecycle_state='pending_deletion' WHERE id=$1`, [deleted.id]);
    const foreign = await doc(householdB, memberB, "their-policy.pdf", pdf(9));
    const storageKeys = [own, prototype, photo, word, pending, quarantined, rejected, legacy, superseded, deleted, foreign].map((d) => d.storageKey);

    const { GET } = await import("@/app/api/policies/[id]/file/route");
    const open = (userId: string, id: string, household = householdA) => {
      asUser(userId);
      return GET(new NextRequest(`http://localhost/api/policies/${id}/file`, { headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}` } }), { params: Promise.resolve({ id }) });
    };
    const assertPrivate = (res: Response, label: string) => {
      assert.equal(res.headers.get("cache-control"), "private, no-store", `${label}: private, no-store`);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${label}: never sniffed`);
    };
    const assertNoInternals = async (res: Response, label: string) => {
      const text = (await res.clone().text()) + JSON.stringify([...res.headers.entries()]);
      for (const key of storageKeys) assert.ok(!text.includes(key), `${label}: no raw storage key`);
      assert.ok(!text.includes(storageDir) && !text.includes("storage-test.invalid/storage") && !text.includes("backend failure"), `${label}: no internal detail`);
    };

    await testAsync("a household's own cleared PDF opens inline (local driver), under its own name only", async () => {
      for (const d of [own, prototype]) {
        const res = await open(ownerA, d.id);
        assert.equal(res.status, 200, await res.clone().text());
        assertPrivate(res, "own pdf");
        assert.equal(res.headers.get("content-type"), "application/pdf");
        assert.match(res.headers.get("content-disposition") ?? "", /^inline; filename="[^/]+"$/);
        assert.equal(Buffer.from(await res.arrayBuffer()).toString("latin1").slice(0, 5), "%PDF-");
      }
      assert.equal((await open(memberUser, own.id)).status, 200, "a household member may preview too");
    });

    await testAsync("another household's document is refused, by forged cookie or in its own context, and nothing is read", async () => {
      const forged = await open(ownerB, own.id);
      assert.ok([401, 403, 404].includes(forged.status), `forged household cookie: ${forged.status}`);
      assertPrivate(forged, "forged");
      const theirs = await open(ownerA, foreign.id);
      assert.equal(theirs.status, 404, "household A asking for household B's document id");
      assertPrivate(theirs, "foreign");
      await assertNoInternals(theirs, "foreign");
      const wrongContext = await open(ownerB, own.id, householdB);
      assert.equal(wrongContext.status, 404, "household B in its own context asking for A's id");
      await pool.query(`DELETE FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdA, memberUser]);
      const removed = await open(memberUser, own.id);
      assert.ok([401, 403, 404].includes(removed.status), `removed member: ${removed.status}`);
      await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'member')`, [householdA, memberUser]);
    });

    await testAsync("pending, just-uploaded, held, rejected, superseded and deleted documents are never opened", async () => {
      for (const [label, d] of [["scan pending", pending], ["quarantined", quarantined], ["rejected", rejected], ["just uploaded", legacy], ["superseded", superseded], ["deleted", deleted]] as const) {
        const res = await open(ownerA, d.id);
        assert.ok(res.status === 404 || res.status === 409, `${label}: ${res.status}`);
        assertPrivate(res, label);
        await assertNoInternals(res, label);
        assert.match(res.headers.get("content-type") ?? "", /json/, `${label}: no file bytes`);
      }
      assert.equal((await open(ownerA, "not-a-uuid")).status, 404);
    });

    await testAsync("a photo comes back as a JPEG no larger than 2000px; a Word file downloads under its name", async () => {
      const res = await open(ownerA, photo.id);
      assert.equal(res.status, 200);
      assertPrivate(res, "photo");
      assert.equal(res.headers.get("content-type"), "image/jpeg");
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      assert.equal(meta.format, "jpeg");
      assert.ok(meta.width! <= 2000 && meta.height! <= 2000, `${meta.width}x${meta.height}`);
      const docx = await open(ownerA, word.id);
      assert.equal(docx.status, 200);
      assert.equal(docx.headers.get("content-disposition"), 'attachment; filename="Benefits table.docx"');
    });

    // Supabase Storage, simulated at the network edge only.
    process.env.STORAGE_DRIVER = "supabase";
    process.env.SUPABASE_URL = "https://storage-test.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-not-real";
    const signCalls: { path: string; expiresIn: number; download?: unknown }[] = [];
    let signFailure = false;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const marker = "/storage/v1/object/sign/";
      if (!url.includes(marker)) throw new Error(`unexpected network call in test: ${url}`);
      const objectPath = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
      const body = JSON.parse(String(init?.body ?? "{}")) as { expiresIn: number };
      signCalls.push({ path: objectPath, expiresIn: body.expiresIn });
      if (signFailure) return new Response(JSON.stringify({ statusCode: "500", error: "Internal", message: `backend failure for ${objectPath}` }), { status: 500, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ signedURL: `/object/sign/${objectPath}?token=signed-test-token` }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await testAsync("on Supabase Storage a PDF redirects to a fresh signed URL of at most five minutes; refusals sign nothing", async () => {
      const res = await open(ownerA, own.id);
      assert.equal(res.status, 307);
      assertPrivate(res, "redirect");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.ok(res.headers.get("location")?.includes("token=signed-test-token"));
      assert.equal(signCalls.length, 1);
      assert.equal(signCalls[0].path, `policy-files/${own.storageKey}`);
      assert.ok(signCalls[0].expiresIn > 0 && signCalls[0].expiresIn <= 300, `expiresIn=${signCalls[0].expiresIn}`);
      for (const [userId, id, household] of [[ownerA, foreign.id, householdA], [ownerB, own.id, householdA], [ownerB, own.id, householdB], [ownerA, pending.id, householdA], [ownerA, deleted.id, householdA]] as const) {
        const refused = await open(userId, id, household);
        assert.ok([401, 403, 404, 409].includes(refused.status), `refused: ${refused.status}`);
      }
      assert.equal(signCalls.length, 1, "nothing was signed for a refused request");
    });

    await testAsync("a storage failure returns a generic error with no storage key or provider message", async () => {
      signFailure = true;
      try {
        const res = await open(ownerA, own.id);
        assert.equal(res.status, 500);
        assertPrivate(res, "failure");
        await assertNoInternals(res, "failure");
      } finally { signFailure = false; }
    });
  } finally {
    global.fetch = fetchBefore;
    for (const [k, v] of Object.entries(envBefore)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await h.close();
    await rm(storageDir, { recursive: true, force: true });
  }
  finished = true;
  console.log(`DearPolicy policy preview regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

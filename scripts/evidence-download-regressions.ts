/**
 * Household evidence downloads: the file route issues a NEW link or byte
 * stream only for evidence the caller's household currently owns, that is
 * active, not superseded, scanned clean and not uploaded/quarantined/
 * rejected -- re-checked on every request -- with a signed URL of at most
 * 300 seconds, private/no-store caching on every response, and no raw
 * storage key or internal error text in any household-facing evidence
 * response. Real routes and store on PGlite; the Supabase Storage signing
 * endpoint is simulated at global.fetch only, so the production
 * supabase-js call (and the expiresIn it sends) is what is observed.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { asUser, fixedUuid, startReviewerHarness } from "./fixtures/reviewer-harness";
import { BENEFIT_FIXTURES } from "./fixtures/reviewer-benefit-wording";

let cases = 0;
let finished = false;
async function testAsync(name: string, fn: () => Promise<void>) {
  console.log(`evidence download: ${name}`);
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}
process.on("beforeExit", () => {
  if (!finished && !process.exitCode) { console.error("evidence download regressions did not finish (a pending operation never settled)"); process.exitCode = 1; }
});

async function main() {
  const h = await startReviewerHarness();
  const f = BENEFIT_FIXTURES[0];
  const ownerA = fixedUuid("b9500000", 1), memberUser = fixedUuid("b9500000", 2), ownerB = fixedUuid("b9500000", 3);
  const householdA = fixedUuid("a9500000", 1), householdB = fixedUuid("a9500000", 2);
  const envBefore = { STORAGE_DRIVER: process.env.STORAGE_DRIVER, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  try {
    await h.createHousehold(householdA, ownerA);
    await h.createHousehold(householdB, ownerB, "Other household");
    await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'member')`, [householdA, memberUser]);
    const member = await h.createMember(householdA, fixedUuid("d9500000", 1), "Tan Jia Ming Raymond");
    const claim = await h.createClaim(householdA, member, fixedUuid("e9500000", 1), f.claimEventType);
    const processed = () => h.uploadEvidence({ accountId: householdA, ownerUserId: ownerA, memberId: member, claimId: claim, ...f.evidence });

    const { transitionEvidenceStatus, supersedeEvidenceDocument } = await import("@/lib/claims/evidence/store");
    const { transitionLifecycle } = await import("@/lib/lifecycle/state-machine");
    const { POST: postUpload } = await import("@/app/api/claims/evidence/upload/route");
    const { GET: getFile } = await import("@/app/api/claims/evidence/[id]/file/route");
    const { GET: listEvidence } = await import("@/app/api/claims/evidence/route");
    const { GET: getEvidence } = await import("@/app/api/claims/evidence/[id]/route");
    let seq = 0;
    async function uploadOnly() {
      seq++;
      asUser(ownerA);
      const form = new FormData();
      form.set("file", new File([new Uint8Array(Buffer.from(`%PDF-1.4\n%download-${seq}\n%%EOF\n`, "latin1"))], `download-${seq}.pdf`, { type: "application/pdf" }));
      form.set("familyMemberId", member); form.set("claimSessionId", claim); form.set("documentType", f.evidence.documentType);
      const res = await postUpload(new NextRequest("http://localhost/api/claims/evidence/upload", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` }, body: form }));
      assert.equal(res.status, 202, await res.clone().text());
      return (await res.json()).documentId as string;
    }

    // Evidence in every state a download must consider.
    const clean = await processed();
    const pendingScan = await uploadOnly();
    const heldClean = await uploadOnly();
    assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: heldClean, from: "uploaded", to: "quarantined", scanStatus: "clean" }));
    const infected = await uploadOnly();
    assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: infected, from: "uploaded", to: "quarantined", scanStatus: "infected" }));
    const rejected = await uploadOnly();
    assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: rejected, from: "uploaded", to: "quarantined", scanStatus: "infected" }));
    assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: rejected, from: "quarantined", to: "rejected", errorCode: "SCAN_INFECTED", errorMessage: "infected" }));
    const superseded = await processed();
    const replacement = await processed();
    await supersedeEvidenceDocument({ accountId: householdA, oldId: superseded, newId: replacement, reason: "corrected upload" });
    const deleted = await processed();
    await transitionLifecycle(pool, { resourceType: "claim_evidence", resourceId: deleted, accountId: householdA, fromState: "active", toState: "pending_deletion" });
    const failed = await uploadOnly();
    assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: failed, from: "uploaded", to: "quarantined", scanStatus: "clean" }));
    assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: failed, from: "quarantined", to: "processing" }));
    const INTERNAL_ERROR = "Error: connect ECONNREFUSED 10.0.0.5:5432 at pg/lib/client.js";
    assert.ok(await transitionEvidenceStatus({ accountId: householdA, id: failed, from: "processing", to: "failed", errorCode: "PROCESSING_ERROR", errorMessage: INTERNAL_ERROR }));
    const storageKeys = (await pool.query<{ storage_key: string }>(`SELECT storage_key FROM claim_evidence_documents WHERE account_id=$1`, [householdA])).rows.map((r) => r.storage_key);
    assert.ok(storageKeys.length >= 9 && storageKeys.every(Boolean));

    // Supabase Storage, simulated at the network edge only.
    process.env.STORAGE_DRIVER = "supabase";
    process.env.SUPABASE_URL = "https://storage-test.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-not-real";
    const signCalls: { path: string; expiresIn: number }[] = [];
    let signFailure = false;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const marker = "/storage/v1/object/sign/";
      if (!url.includes(marker)) throw new Error(`unexpected network call in test: ${url}`);
      const path = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
      const body = JSON.parse(String(init?.body ?? "{}")) as { expiresIn: number };
      signCalls.push({ path, expiresIn: body.expiresIn });
      if (signFailure) return new Response(JSON.stringify({ statusCode: "500", error: "Internal", message: `backend failure for ${path}` }), { status: 500, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ signedURL: `/object/sign/${path}?token=signed-test-token` }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const download = (userId: string, id: string, household = householdA) => {
      asUser(userId);
      return getFile(new NextRequest(`http://localhost/api/claims/evidence/${id}/file?familyMemberId=${member}&claimSessionId=${claim}`, { headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}` } }), { params: Promise.resolve({ id }) });
    };
    const assertPrivate = (res: Response, label: string) => assert.equal(res.headers.get("cache-control"), "private, no-store", `${label}: private, no-store`);
    const assertNoInternals = async (res: Response, label: string) => {
      const text = await res.clone().text();
      for (const key of storageKeys) assert.ok(!text.includes(key), `${label}: no raw storage key in the body`);
      assert.ok(!text.includes("storage-test.invalid") && !text.includes("backend failure") && !text.includes("ECONNREFUSED"), `${label}: no internal error text`);
    };

    await testAsync("an owned, active, scanned-clean document gets a fresh signed URL of at most five minutes, privately cached", async () => {
      const res = await download(ownerA, clean);
      assert.equal(res.status, 307);
      assertPrivate(res, "redirect");
      assert.equal(signCalls.length, 1);
      assert.ok(signCalls[0].expiresIn > 0 && signCalls[0].expiresIn <= 300, `expiresIn=${signCalls[0].expiresIn}`);
      assert.ok(res.headers.get("location")?.includes("token=signed-test-token"));
    });

    await testAsync("authorisation is re-checked for every new URL: a removed member and another household get nothing", async () => {
      assert.equal((await download(memberUser, clean)).status, 307, "control: a current member may download");
      const before = signCalls.length;
      await pool.query(`DELETE FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdA, memberUser]);
      const removed = await download(memberUser, clean);
      assert.ok([401, 403, 404].includes(removed.status), `removed member: ${removed.status}`);
      assertPrivate(removed, "removed member");
      const foreign = await download(ownerB, clean);
      assert.ok([401, 403, 404].includes(foreign.status), `other household with a forged cookie: ${foreign.status}`);
      const foreignOwn = await download(ownerB, clean, householdB);
      assert.ok([403, 404].includes(foreignOwn.status), `other household in its own context: ${foreignOwn.status}`);
      assertPrivate(foreignOwn, "other household");
      assert.equal(signCalls.length, before, "no URL was signed for any of them");
    });

    await testAsync("pending-scan, quarantined, infected, rejected, superseded and deleted evidence never receives a new URL", async () => {
      const before = signCalls.length;
      for (const [label, id] of [["pending scan", pendingScan], ["quarantined (clean, held)", heldClean], ["infected", infected], ["rejected", rejected], ["superseded", superseded], ["deleted", deleted]] as const) {
        const res = await download(ownerA, id);
        assert.ok(res.status === 404 || res.status === 409, `${label}: ${res.status}`);
        assertPrivate(res, label);
        await assertNoInternals(res, label);
      }
      assert.equal(signCalls.length, before, "nothing was signed");
      assert.equal((await download(ownerA, replacement)).status, 307, "control: the current replacement is downloadable");
    });

    await testAsync("a storage failure returns a generic error: no storage key, provider message or internal detail", async () => {
      signFailure = true;
      try {
        const res = await download(ownerA, clean);
        assert.equal(res.status, 500);
        assertPrivate(res, "failure");
        await assertNoInternals(res, "failure");
      } finally { signFailure = false; }
    });

    await testAsync("household evidence listings and detail never return the raw storage key or internal error text", async () => {
      asUser(ownerA);
      const list = await listEvidence(new NextRequest(`http://localhost/api/claims/evidence?familyMemberId=${member}&claimSessionId=${claim}`, { headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` } }));
      assert.equal(list.status, 200);
      await assertNoInternals(list, "list");
      const docs = (await list.json()).documents as Record<string, unknown>[];
      assert.ok(docs.length >= 5, "control: the listing returns documents");
      for (const doc of docs) { assert.equal("storage_key" in doc, false); assert.equal("processing_error" in doc, false); }
      assert.equal(docs.find((d) => d.id === failed)?.processing_error_code, "PROCESSING_ERROR", "the safe error code is still available to the UI");
      asUser(ownerA);
      const detail = await getEvidence(new NextRequest(`http://localhost/api/claims/evidence/${failed}?familyMemberId=${member}&claimSessionId=${claim}`, { headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` } }), { params: Promise.resolve({ id: failed }) });
      assert.equal(detail.status, 200);
      await assertNoInternals(detail, "detail");
      const body = (await detail.json()).document as Record<string, unknown>;
      assert.equal(body.id, failed);
      assert.equal("storage_key" in body, false);
    });

    await testAsync("on the local driver the route streams bytes itself, privately cached, under the same checks", async () => {
      process.env.STORAGE_DRIVER = "local";
      const ok = await download(ownerA, clean);
      assert.equal(ok.status, 200);
      assertPrivate(ok, "stream");
      assert.equal(ok.headers.get("content-type"), "application/pdf");
      assert.ok(!(ok.headers.get("content-disposition") ?? "").includes("/"), "only the file name, never the storage path");
      const blocked = await download(ownerA, infected);
      assert.equal(blocked.status, 409);
      assertPrivate(blocked, "blocked stream");
    });
  } finally {
    for (const [k, v] of Object.entries(envBefore)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await h.close();
  }
  finished = true;
  console.log(`DearPolicy evidence download regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

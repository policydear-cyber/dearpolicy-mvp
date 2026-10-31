/**
 * Round 5 (post-launch exploratory findings) -- customer-experience
 * regressions that run without a browser:
 *   node --import tsx scripts/r5-ux-regressions.ts
 * The browser journey for the same findings is e2e/tests/v11-ux-r5.spec.ts.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (error) { console.error(`  FAIL ${name}\n${error instanceof Error ? error.stack : error}`); process.exitCode = 1; }
}
const read = (f: string) => readFileSync(path.resolve(f), "utf8");

async function main() {
  // ---- 1. uploads: large documents go straight to storage -----------------
  const { signUploadIntent, verifyUploadIntent } = await import("../app/api/policies/upload/intent-token");
  const intent = {
    v: 1 as const, householdId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222",
    familyMemberId: "33333333-3333-4333-8333-333333333333", explicitFamilyMember: true, policyId: "44444444-4444-4444-8444-444444444444",
    storageKey: "h/m/p/scan.pdf", filename: "scan.pdf", mimeType: "application/pdf", byteSize: 34_000_000,
    supersedesPolicyId: null, driver: "local" as const, expiresAt: Date.now() + 60_000,
  };
  await test("upload intent: a server-signed intent verifies; any change to it, its signature or its expiry is refused", () => {
    const token = signUploadIntent(intent);
    assert.deepEqual(verifyUploadIntent(token), intent);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...intent, householdId: "99999999-9999-4999-8999-999999999999" })).toString("base64url");
    assert.equal(verifyUploadIntent(`${forged}.${mac}`), null, "another household");
    assert.equal(verifyUploadIntent(`${body}.${mac.slice(0, -2)}AA`), null, "bad signature");
    assert.equal(verifyUploadIntent(signUploadIntent({ ...intent, expiresAt: Date.now() - 1 })), null, "expired");
    for (const junk of [null, "", "abc", "a.b.c", 42, "x".repeat(9000)]) assert.equal(verifyUploadIntent(junk), null);
  });

  const dir = mkdtempSync(path.join(tmpdir(), "r5-ux-"));
  process.env.LOCAL_STORAGE_DIR = dir;
  await test("local direct upload: parts are written strictly in order, never outside storage, and read back whole", async () => {
    const local = await import("../lib/storage/local");
    const key = local.policyObjectKey({ accountId: "acc", familyMemberId: "fm", policyId: "pol", filename: "big scan.pdf" });
    assert.equal(key, "acc/fm/pol/big_scan.pdf");
    const a = new Uint8Array(4 * 1024 * 1024).fill(1), b = new Uint8Array(1000).fill(2);
    assert.equal(await local.appendPolicyUploadPart(key, 0, a), a.length);
    await assert.rejects(local.appendPolicyUploadPart(key, a.length + 5, b), /out of order/);
    await assert.rejects(local.appendPolicyUploadPart(key, 10, b), /out of order/);
    assert.equal(await local.appendPolicyUploadPart(key, a.length, b), a.length + b.length);
    const whole = await local.readPolicyFile(key);
    assert.equal(whole.length, a.length + b.length);
    assert.equal(whole[0], 1); assert.equal(whole[whole.length - 1], 2);
    // A retried first part starts the file again rather than appending.
    assert.equal(await local.appendPolicyUploadPart(key, 0, b), b.length);
    assert.equal((await local.readPolicyFile(key)).length, b.length);
    await assert.rejects(local.appendPolicyUploadPart("../../etc/evil", 0, b), /Invalid storage path/);
  });
  rmSync(dir, { recursive: true, force: true });

  await test("the pages upload through the direct flow; the multipart route refuses bodies a function cannot carry", () => {
    const docs = read("app/policies/page.tsx");
    assert.match(docs, /uploadPolicyDocument\(/, "Documents uses the direct upload");
    assert.ok(!/fetch\("\/api\/policies\/upload"/.test(docs), "Documents no longer posts the file through a function");
    // One place to upload: Payments lists what was found and sends a new receipt to Documents.
    const payments = read("app/records/page.tsx");
    assert.ok(!/uploadPolicyDocument\(|type="file"|\/api\/policies\/upload/.test(payments), "Payments has no upload of its own");
    assert.match(payments, /href="\/policies"/, "Payments links to the upload on Documents");
    const helper = read("components/upload-document.ts");
    assert.match(helper, /\/api\/policies\/upload\/start/);
    assert.match(helper, /\/api\/policies\/upload\/finalize/);
    assert.match(helper, /MAX_UPLOAD_BYTES = 50 \* 1024 \* 1024/);
    const route = read("app/api/policies/upload/route.ts");
    assert.match(route, /MULTIPART_MAX_BYTES/);
    assert.match(route, /status: 413/);
    const accept = read("app/api/policies/upload/accept.ts");
    for (const check of ["validateDocumentUpload(", "probeImageDecodes(", "DuplicateDocument", "createUserSupabaseClient(", "enqueuePolicyProcessing(", "activePredicate()"]) assert.ok(accept.includes(check), `accept.ts keeps ${check}`);
    assert.match(accept, /MULTIPART_MAX_BYTES = 4 \* 1024 \* 1024/, "under Vercel's ~4.5 MB request body limit");
    const finalize = read("app/api/policies/upload/finalize/route.ts");
    assert.match(finalize, /readPolicyFile\(intent\.storageKey\)/, "finalize validates the STORED bytes");
    assert.match(finalize, /intent\.householdId !== ctx\.householdId \|\| intent\.userId !== ctx\.userId/);
    const part = read("app/api/policies/upload/part/route.ts");
    assert.match(part, /intent\.driver !== "local"/);
    assert.match(part, /MAX_PART_BYTES = 4 \* 1024 \* 1024/);
  });

  // ---- 3. one document, several people, cover tiers -------------------------
  const tiers = await import("../lib/policies/member-tier");
  await test("cover tiers come from the document's own relationship hints, and only offered tiers are stored", () => {
    assert.deepEqual(tiers.tierOptionsFromHints(["employee", "spouse", "child", null]), ["Employee", "Spouse", "Child"]);
    assert.deepEqual(tiers.tierOptionsFromHints(["self", null]), [], "one tier is not a choice");
    assert.equal(tiers.normalizePlanTier("spouse", ["Employee", "Spouse"]), "Spouse");
    assert.equal(tiers.normalizePlanTier("Platinum", ["Employee", "Spouse"]), null, "a tier the document does not offer is refused");
    assert.equal(tiers.normalizePlanTier("", ["Employee"]), null);
    const route = read("app/api/policies/link-person/route.ts");
    assert.match(route, /assignments: z\.array/);
    // Expectation change (Test engineer, PR #67): was
    //   assert.match(route, /source IN \('user_declared','upload_hint'\)/, "only household-made links are ever removed");
    // which required the bug PR #67 fixes (unticking a person the reading had linked said "Saved" but kept the link).
    // Now everyone the picker shows as covered can be removed; only matching-wording links are left alone.
    assert.doesNotMatch(route, /source IN \('user_declared','upload_hint'\)/, "links the reading made can be removed too");
    assert.match(route, /saveDocumentCoverage/, "the picker's save goes through the shared coverage save");
    assert.match(read("lib/policies/coverage-assignments.ts"), /NOT_SHOWN_AS_COVERED = \["scheme_reference_match"\]/, "matching-wording links, which the picker does not show, are left alone");
    // One tier column (policy_members.benefit_tier), shared with the reading
    // pipeline and claims; the table's own column headings are offered first.
    assert.doesNotMatch(read("sql/schema.sql"), /plan_tier/);
    assert.match(read("sql/v11-ingestion-evidence.sql"), /ALTER TABLE IF EXISTS policy_members ADD COLUMN IF NOT EXISTS benefit_tier text;/);
    // PR #67 moved the picker's save to lib/policies/coverage-assignments.ts (was: assert.match(route, ...)).
    assert.match(read("lib/policies/coverage-assignments.ts"), /SET benefit_tier=EXCLUDED\.benefit_tier/);
    assert.deepEqual(tiers.tierOptionsForDocument({ hints: ["employee", "child"], tableTiers: ["Adult", "Child", "Child"] }), ["Adult", "Child"], "a benefit table's own columns are the vocabulary");
    assert.equal(tiers.namedTierFor("daughter", ["Adult", "Child"], ["Adult", "Child"]), "Child");
    const page = read("app/policies/page.tsx");
    assert.match(page, /function CoversPicker/);
    assert.match(page, /aria-pressed=\{on\}/);
  });

  // ---- 2 and 4: flows and small defects ----------------------------------------
  await test("deleting a household lands on a confirmation with real next steps", () => {
    assert.match(read("app/household/page.tsx"), /window\.location\.href = "\/household\/deleted"/);
    const deleted = read("app/household/deleted/page.tsx");
    assert.match(deleted, /Start a new household/);
    assert.match(deleted, /Sign out/);
    assert.match(read("app/api/household/start/route.ts"), /ROUTE_AUTH = "authenticated"/);
  });
  await test("chat: 2,000-character limit with a counter, a conflict says what happened and offers a reload, the open chat survives a reload", () => {
    const chat = read("app/chat/page.tsx");
    assert.match(chat, /maxLength=\{MAX_QUESTION_LENGTH\}/);
    assert.match(chat, /MAX_QUESTION_LENGTH=2000/);
    assert.match(read("app/api/chat/route.ts"), /max\(2000\)/, "the page's limit matches the server's");
    assert.match(chat, /Reload this chat/);
    assert.ok(!/Reopen it before sending[^"]*Send it again/.test(chat));
    assert.match(chat, /rememberConversation\(data\.conversationId/);
    assert.ok(!/Josephine|endowment/.test(chat), "no other family's names or products in the starter prompts");
  });
  await test("household roster: names, no sole-owner Leave; dates in Singapore format", async () => {
    // The roster moved from the Household page to People (Account settings), as this shared component.
    const page = read("components/household-access.tsx");
    assert.ok(!/Member \$\{member\.userId/.test(page));
    assert.match(page, /soleOwner/);
    const { sgDate } = await import("../components/format-date");
    assert.equal(sgDate("2026-09-29"), "29 Sep 2026");
    assert.equal(sgDate(""), "");
  });
  await test("a future date of birth is refused on the page and by the API", () => {
    assert.match(read("app/family/page.tsx"), /A date of birth can't be in the future\./);
    for (const r of ["app/api/family/route.ts", "app/api/family/[id]/route.ts"]) assert.match(read(r), /can't be in the future/);
  });
  await test("locked PDFs: password entered on the card; a wrong password is named as such", () => {
    const page = read("app/policies/page.tsx");
    assert.match(page, /function LockedPdf/);
    assert.match(page, /The password didn’t work/);
    assert.match(page, /\/api\/policies\/reprocess/);
    assert.ok(!/It is password-protected\./.test(page));
  });
  await test("a ready document can be read again in place, after a confirming click", () => {
    const page = read("app/policies/page.tsx");
    // Offered on ready documents, beside Details; the first click only arms it; the second calls the same
    // in-place re-read as "Try reading it again" (/api/policies/reprocess), so nothing is deleted or re-uploaded.
    assert.match(page, /policy\.processing_status === "ready" && <button type="button" className="mini-button"[^>]*onClick=\{\(\) => \{ if \(confirmRereadId === policy\.id\) \{ setConfirmRereadId\(null\); void retryReading\(policy\); \} else setConfirmRereadId\(policy\.id\); \}\}>/);
    assert.match(page, /"Confirm read again" : "Read again"/);
    assert.match(page, /async function retryReading[\s\S]{0,400}\/api\/policies\/reprocess/);
  });
  await test("upload form labels are tied to their inputs", () => {
    const page = read("app/policies/page.tsx");
    for (const id of ["up-profile", "up-file", "up-password"]) { assert.match(page, new RegExp(`htmlFor="${id}"`)); assert.match(page, new RegExp(`id="${id}"`)); }
  });
  await test("claim detail links back to its conversation and orders document types by what the claim asks for", () => {
    const page = read("app/claims/[id]/page.tsx");
    assert.match(page, /Back to the conversation/);
    assert.match(page, /Asked for on this claim/);
    assert.match(read("app/api/claims/[id]/route.ts"), /claim_category,conversation_id,updated_at/);
    assert.match(read("app/claims/page.tsx"), /\/chat\?conversation=\$\{c\.conversation_id\}/);
  });
  await test("empty portfolio: a next step, not 'everything looks current' or S$0.00", () => {
    const home = read("app/page.tsx");
    assert.match(home, /function EmptyPortfolio/);
    assert.match(home, /emptyPortfolio\?<EmptyPortfolio/);
  });
  await test("no verdict before the data is in: cover detail and Payments say nothing found only once loaded", () => {
    const cover = read("app/coverage/page.tsx");
    assert.match(cover, /const ready=Boolean\(data&&!data\.error\)/, "the cover page knows when its answer is in");
    assert.match(cover, /\{ready\?<>\s*<section className="section evidence-section">[^]*?Not found in your documents/, "the ANSWER section renders only once ready");
    assert.match(cover, /!ready\?"This cover could not be loaded\."/, "a failed load is not read as not found");
    const payments = read("app/records/page.tsx");
    assert.match(payments, /useState<RecordRow\[\]\|null>\(null\)/, "payments start unknown, not empty");
    assert.match(payments, /records && !records\.length && <div className="empty-card">No payment records/, "'No payment records' only after loading");
    assert.match(payments, /useState<Person\[\]\|null>\(null\)/, "the premiums Home counts start unknown, not empty");
    assert.match(payments, /!people && !peopleFailed && <div className="empty-card" role="status">Loading/, "the counted premiums say loading first");
  });
  await test("Payments shows every premium Home counts, from the same computation, with its source", () => {
    // Home's cost and Payments' list both come from countedPremiums, so a premium read off a policy schedule (no payment
    // record) is on both, and the figures reconcile for any household.
    const dashboard = read("app/api/dashboard/route.ts"), summary = read("app/api/premiums/summary/route.ts"), payments = read("app/records/page.tsx");
    assert.match(dashboard, /const premiums=await countedPremiums\(accountId,/, "Home counts through the shared helper");
    assert.ok(!/summarisePremiums\(/.test(dashboard), "Home has no premium count of its own");
    assert.match(summary, /countedPremiums\(accountId,/, "the Payments summary counts through the same helper");
    assert.ok(!/runAfterResponse|readPendingDocuments|seedLedger/.test(summary), "the Payments summary reads only, starting no background work");
    assert.match(payments, /fetch\("\/api\/premiums\/summary"\)/, "Payments loads the counted premiums");
    assert.match(payments, /policy_schedule:"From the policy schedule",payment_record:"From a payment record"/, "each premium names where it was read");
    assert.match(payments, /\|\|"From your documents"/, "an unknown source says the neutral words");
    assert.match(payments, /p\.oneOff\.map/, "a premium paid once is listed, not hidden");
    assert.match(payments, /p\.note&&<p className="note">\{p\.note\}/, "what the total leaves out is said, as on Home");
  });
  await test("signed-out pages carry no app navigation", () => {
    const shell = read("components/AppShell.tsx");
    assert.match(shell, /const noNav = signedOutPage \|\| NO_NAV_PATHS\.has\(pathname\)/);
    assert.match(shell, /noNav \? \[\]/);
  });

  console.log(`Round 5 customer-experience regressions: ${passed} passed${process.exitCode ? ", some FAILED" : ""}.`);
}
main();

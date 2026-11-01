/**
 * The beta privacy notice (app/privacy/page.tsx) is public, linked from sign-up and sign-in, names every service that
 * receives a household's information, and marks every passage DC still has to confirm. Pure: reads source files only.
 *   npm run privacy:notice-test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIVACY_NOTICE_FINAL, privacyNoticeVisible } from "@/lib/privacy/notice-status";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
let passed = 0;
const failed: string[] = [];
const t = (name: string, fn: () => void) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };
const page = readFileSync("app/privacy/page.tsx", "utf8");

t("readable before signing in: /privacy is an open path, and the page reads no data and calls no service", () => {
  assert.match(readFileSync("middleware.ts", "utf8"), /OPEN_PATHS = new Set\(\[[^\]]*"\/privacy"/);
  assert.doesNotMatch(page, /from "@\/lib\/(?:db|supabase|household|auth)|fetch\(|process\.env/);
});
t("linked where a person signs up and signs in, once published", () => {
  for (const f of ["app/signup/page.tsx", "app/login/page.tsx"]) assert.match(readFileSync(f, "utf8"), /\{PRIVACY_NOTICE_FINAL \? \([\s\S]{0,200}href="\/privacy"/, f);
});
t("a draft never goes live: while unpublished the page is 'not found' (unless the preview is on) and nothing links to it", () => {
  assert.match(page, /if \(!privacyNoticeVisible\(\)\) notFound\(\);/);
  const marks = (page.match(/<ToConfirm>/g) ?? []).length;
  if (marks > 0) assert.equal(PRIVACY_NOTICE_FINAL, false, "a notice with passages still To confirm cannot be published");
  if (!PRIVACY_NOTICE_FINAL) {
    assert.equal(privacyNoticeVisible({}), false);
    for (const v of ["1", "yes", "on", ""]) assert.equal(privacyNoticeVisible({ DEARPOLICY_PRIVACY_PREVIEW: v }), false, v);
    assert.equal(privacyNoticeVisible({ DEARPOLICY_PRIVACY_PREVIEW: "true" }), true);
  }
});
t("says what deleting a document really does, and names Pinecone and the hash-only malware check", () => {
  for (const w of [/Pinecone/, /everything read from it is deleted/, /none of its content/, /retried automatically/, /The file itself is not sent/, /claim calculations that used it are cleared/, /replaced with a short note/]) assert.match(page, w, String(w));
  assert.doesNotMatch(page, /it is no longer used for anything/);
  // #271 and #275 are merged: past answers, coverage summaries and claim calculations are now really cleaned, so the notice says so plainly.
  assert.doesNotMatch(page, /<ToConfirm>that answers DearPolicy already gave you/, "past answers are cleaned since #271; the notice no longer marks it To confirm");
  assert.match(page, /not malware-scanned/);
  assert.match(readFileSync("lib/privacy/notice-status.ts", "utf8"), /Check those are live on the site before flipping it/);
});
t("promises that are not yet checked stay To confirm (encryption, telling you about a breach or a change)", () => {
  for (const w of [/<ToConfirm>information is encrypted/, /<ToConfirm>if something goes wrong/, /<ToConfirm>if this notice changes/]) assert.match(page, w, String(w));
});
t("the public page shows no Sign out button or app navigation to a signed-out visitor", () => {
  assert.match(readFileSync("components/AppShell.tsx", "utf8"), /SIGNED_OUT_PATHS = new Set\(\[[^\]]*"\/privacy"/);
});
t("names what is kept, every service that receives it, and how to remove it", () => {
  for (const w of [/Anthropic/, /Supabase/, /Vercel/, /Pinecone/, /VirusTotal/, /identity numbers/, /Permanently delete household/, /export/, /do not sell/, /not an insurer/])
    assert.match(page, w, String(w));
});
t("every passage DC must settle is marked To confirm (operator, contact, date, location, staff access, backups, law, model terms)", () => {
  const marks = page.match(/<ToConfirm>/g) ?? [];
  assert.ok(marks.length >= 8, `${marks.length} marked passages`);
  for (const w of [/operating DearPolicy/, /contact email/, /date this notice is published/, /hosted/, /staff may look/, /backups/, /PDPA/, /train its models/])
    assert.match(page, w, String(w));
});
console.log(`\nprivacy notice: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);

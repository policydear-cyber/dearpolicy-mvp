/**
 * The beta privacy notice (app/privacy/page.tsx) is public, linked from sign-up and sign-in, names every service that
 * receives a household's information, and marks every passage DC still has to confirm. Pure: reads source files only.
 *   npm run privacy:notice-test
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  for (const w of [/Pinecone/, /everything read from it is deleted/, /none of its content/, /retried automatically/, /The file itself is not sent/]) assert.match(page, w, String(w));
  assert.doesNotMatch(page, /it is no longer used for anything/);
  // Past answers, claim calculations and summaries are claimed as removed only now that the scrubs are merged and live
  // (lib/lifecycle/derived-content-scrub.ts, claim-snapshot-scrub.ts; prod 3 Nov: every deleted document has both audit marks).
  for (const f of ["lib/lifecycle/derived-content-scrub.ts", "lib/lifecycle/claim-snapshot-scrub.ts"]) assert.ok(existsSync(f), f);
  assert.match(page, /replaced by a note that the document was deleted \(the questions you typed stay\)/);
  assert.match(page, /claim calculations that used it keep only that a calculation was made/);
  assert.doesNotMatch(page, /a fix is being built/);
  assert.match(page, /not malware-scanned/);
  assert.match(readFileSync("lib/privacy/notice-status.ts", "utf8"), /Do not flip it before the deletion work it describes is live/);
});
t("promises that are not yet checked stay To confirm (how fast a breach is told, telling you about a change)", () => {
  for (const w of [/we will email the affected households <ToConfirm>within how many days/, /<ToConfirm>if this notice changes/]) assert.match(page, w, String(w));
});
t("technical facts the notice states are the code's own (encryption, where it runs, scanning, model terms)", () => {
  // Encryption in transit: HTTPS only (HSTS) and a database connection that must use verified TLS in production.
  assert.match(page, /served over HTTPS only/);
  assert.match(readFileSync("next.config.ts", "utf8"), /Strict-Transport-Security/);
  assert.match(page, /refuses to start in production without it/);
  assert.match(readFileSync("lib/db/client.ts", "utf8"), /DATABASE_SSL=off is not permitted in production/);
  // Where it runs: the website region is the deploy config's; records and files are Supabase's Southeast Asia region.
  assert.match(page, /the website runs in Singapore \(Vercel\)/);
  assert.match(readFileSync("vercel.json", "utf8"), /"regions":\s*\["sin1"\]/);
  // Anthropic: the standard API only (no file storage or batch services, which keep data longer).
  assert.match(page, /within 30 days/);
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sources(`${dir}/${d.name}`) : /\.(?:ts|tsx)$/.test(d.name) ? [`${dir}/${d.name}`] : []);
  for (const f of [...sources("lib"), ...sources("app")]) assert.doesNotMatch(readFileSync(f, "utf8"), /\/v1\/files|messages\/batches/, f);
  // Malware checking is stated as off, and the notice says it changes before it is switched on.
  assert.match(page, /Malware checking is off for the beta today/);
});
t("the public page shows no Sign out button or app navigation to a signed-out visitor", () => {
  assert.match(readFileSync("components/AppShell.tsx", "utf8"), /SIGNED_OUT_PATHS = new Set\(\[[^\]]*"\/privacy"/);
});
t("names what is kept, every service that receives it, and how to remove it", () => {
  for (const w of [/Anthropic/, /Supabase/, /Vercel/, /Pinecone/, /VirusTotal/, /identity numbers/, /Permanently delete household/, /export/, /do not sell/, /not an insurer/])
    assert.match(page, w, String(w));
});
t("every passage DC must settle is marked To confirm (operator, contact, date, staff access, backups, law, processing outside Singapore)", () => {
  const marks = page.match(/<ToConfirm>/g) ?? [];
  assert.ok(marks.length >= 8, `${marks.length} marked passages`);
  for (const w of [/operating DearPolicy/, /contact email/, /date this notice is published/, /staff may look/, /backups/, /PDPA/, /<ToConfirm>where Anthropic processes/])
    assert.match(page, w, String(w));
});
console.log(`\nprivacy notice: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);

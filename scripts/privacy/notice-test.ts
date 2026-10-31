/**
 * The beta privacy notice (app/privacy/page.tsx) is public, linked from sign-up and sign-in, names every service that
 * receives a household's information, and marks every passage DC still has to confirm. Pure: reads source files only.
 *   npm run privacy:notice-test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
let passed = 0;
const failed: string[] = [];
const t = (name: string, fn: () => void) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };
const page = readFileSync("app/privacy/page.tsx", "utf8");

t("readable before signing in: /privacy is an open path, and the page reads no data and calls no service", () => {
  assert.match(readFileSync("middleware.ts", "utf8"), /OPEN_PATHS = new Set\(\[[^\]]*"\/privacy"/);
  assert.doesNotMatch(page, /from "@\/lib\/(?:db|supabase|household|auth)|fetch\(|process\.env/);
});
t("linked where a person signs up and signs in", () => {
  for (const f of ["app/signup/page.tsx", "app/login/page.tsx"]) assert.match(readFileSync(f, "utf8"), /href="\/privacy"/, f);
});
t("names what is kept, every service that receives it, and how to remove it", () => {
  for (const w of [/Anthropic/, /Supabase/, /Vercel/, /identity numbers/, /Permanently delete household/, /export/, /do not sell/, /not an insurer/])
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

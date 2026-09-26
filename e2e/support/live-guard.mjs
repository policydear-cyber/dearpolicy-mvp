#!/usr/bin/env node
// Guard for `npm run e2e:browser:live`: live execution is opt-in, explicit,
// and never aimed at production by accident.
const target = process.env.E2E_BASE_URL_A ?? "";
if (process.env.E2E_LIVE_APPROVED !== "yes") { console.error("e2e live: refusing to run without E2E_LIVE_APPROVED=yes (an owner-authorised deployment only)."); process.exit(1); }
if (!/^https:\/\//.test(target)) { console.error("e2e live: E2E_BASE_URL_A must be an https URL of the authorised deployment."); process.exit(1); }
if (/dearpolicy-mvp\.vercel\.app/.test(target) && process.env.E2E_LIVE_TARGET_IS_PRODUCTION_APPROVED !== "yes") { console.error("e2e live: refusing the production prototype without E2E_LIVE_TARGET_IS_PRODUCTION_APPROVED=yes."); process.exit(1); }
if (!process.env.E2E_LOGIN_EMAIL_A || !process.env.E2E_LOGIN_PASSWORD_A) { console.error("e2e live: E2E_LOGIN_EMAIL_A / E2E_LOGIN_PASSWORD_A (a synthetic test account) are required."); process.exit(1); }
if (process.env.DATABASE_URL) { console.error("e2e live: unset DATABASE_URL; live runs clean up only through the app's own household deletion."); process.exit(1); }
console.log(`e2e live: approved run against ${new URL(target).host}`);

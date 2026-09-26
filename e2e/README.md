# Browser E2E (synthetic data only)

A real-browser journey (Playwright + Chromium) against a real Next.js server, a
real PostgreSQL database, the real durable-job worker and the **real VirusTotal
adapter** pointed at a local fake VirusTotal API. Nothing here touches
production, a real insurer document, or a real VirusTotal account.

## What runs in CI (`.github/workflows/browser-e2e.yml`)

| Piece | What it is |
|---|---|
| Database | `pgvector/pgvector:pg17` service container, schema from `sql/*.sql` (`e2e/support/apply-schema.ts`) |
| App (user A) | `next dev` on :3000, `DEV_AUTH_ENABLED=true`, `DEV_ACCOUNT_ID` = synthetic user A |
| App (user B) | a second `next dev` on :3001 from a copy of the checkout, `DEV_ACCOUNT_ID` = synthetic user B |
| Worker | `npm run jobs:worker` (the same `claimAndProcessOne()` the Vercel runner uses) |
| Scanner | `MALWARE_SCANNER_PROVIDER=virustotal`, `VIRUSTOTAL_API_BASE_URL` = `e2e/support/fake-services.mjs` |
| Storage | local disk (`STORAGE_DRIVER=local`) |
| Model | none configured: the synthetic PDFs are policy **wording** documents, which DearPolicy classifies deterministically without a model call |

**Authentication is the development identity (`DEV_AUTH_ENABLED`), not Supabase Auth.** Supabase Auth is not available in CI, and households are normally created at sign-up, so `e2e/support/provision.ts` creates each synthetic household with the same `ensureDefaultHousehold()` sign-up uses. The live command (below) signs in through the real login page instead.

## Synthetic-data rules enforced by the suite
- Every name, file and household starts with `SYNTHETIC-DPTEST-<run id>-` (`e2e/support/synthetic.ts`).
- Synthetic PDFs are generated at runtime and contain no personal, medical or real policy data.
- `e2e/support/cleanup.ts` refuses to run against a non-local database unless `E2E_ALLOW_REMOTE_CLEANUP=yes`, and only ever deletes households whose name starts with the synthetic prefix (and the dev identity's placeholder `Household` row for the two synthetic user ids). It runs as Playwright's global teardown, so it also runs after a failure.
- Traces and videos are off. Screenshots are taken only on failure and show only synthetic pages. No cookies, storage state, tokens or signed URLs are written to disk.

## Commands
- CI / local stack: see the workflow file; locally: `npm run e2e:browser` after starting Postgres, the fake services, the worker and both app servers with the env in the workflow.
- **Live (separate, explicit):** `E2E_LIVE_APPROVED=yes E2E_BASE_URL_A=https://<authorised staging> E2E_LOGIN_EMAIL_A=... E2E_LOGIN_PASSWORD_A=... npm run e2e:browser:live`. It refuses to run without `E2E_LIVE_APPROVED=yes`, refuses `dearpolicy-mvp.vercel.app` unless `E2E_LIVE_TARGET_IS_PRODUCTION_APPROVED=yes`, and has **not been executed** against any deployment.

## Coverage of the requested journey (honest status)
See the table in the pull request description; steps not listed as covered there are not covered.

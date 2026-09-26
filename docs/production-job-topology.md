# Production background-job topology

Audited against `main` at `7335fd7a` (2026-09-26), and against branch `claude/vercel-cron-job-runner`, which adds the runner described below. Status words:
- **operational**: runs in production today;
- **blocked by code**: cannot run in production as written;
- **blocked by external configuration**: wired in code, but needs a setting outside the repository;
- **manual only**: runs only when an operator runs a CLI;
- **unknown**: not verifiable from here.

**Nothing in this table was observed running live.** Vercel runtime logs and the production URL were not accessible to the auditor. Every status comes from the code path, and from CI where CI covers it.

## How work is started

Request handlers only **enqueue** durable jobs into `background_jobs` (`lib/jobs/queue.ts`: idempotency key, `FOR UPDATE SKIP LOCKED` claim with a CAS lease, heartbeat, bounded retries with backoff (default 5 attempts), then `dead_letter`). Before this branch, the only thing that claimed jobs was `npm run jobs:worker` (`scripts/worker.ts`), a long-running Node process. **Vercel has no long-running process and the repository had no `vercel.json` cron, so on production every enqueued job stayed `queued` forever.** That includes the malware scan, which runs inside the processing job.

This branch adds:
- **`vercel.json`:** a cron entry that calls `GET /api/internal/jobs/run` **once a day** (`0 3 * * *`, 03:00 UTC). That is the most Vercel Hobby allows, and it is only a backstop sweep (see "Vercel plan and the trigger" below).
- **The route (`app/api/internal/jobs/run/route.ts`, `ROUTE_AUTH = "internal"`):**
  - authenticates with `Authorization: Bearer <CRON_SECRET>`, compared in constant time;
  - refuses every call (503) when `CRON_SECRET` is unset or shorter than 16 characters, and production refuses to **start** without it (`checkCronSecretConfigured` in `lib/launch/guards.ts`);
  - takes no query parameters or body: job types, household and worker identity cannot be chosen by the caller;
  - is exempt from the session gate for exactly that path.
- **The batch (`lib/jobs/cron-runner.ts`, `runJobBatch`):**
  - recovers expired leases, then claims round-robin across `PRODUCTION_JOB_TYPES`;
  - stops claiming after 10 jobs or 60 s, leaving the rest of the 300 s `maxDuration` for the job in flight;
  - returns counts only.
- **Overlap and timeouts:**
  - overlapping invocations never run the same job twice, because the claim is `SKIP LOCKED` plus a CAS lease;
  - a job the platform kills mid-run stops heartbeating; its lease expires after 5 minutes and it is retried, or dead-lettered once it has used its attempts.
- **Launch check:** the new `production_job_execution` capability reports blocked by code if any enqueued job type has no processor, or if the cron entry, the route wiring or the middleware exemption is missing.

**Required outside the repository:**
- `CRON_SECRET`, Production only.
- A trigger at least every 5 minutes. See the next section.

## Vercel plan and the trigger

Read-only account metadata (2026-09-26) reports the `dearpolicy-mvp` owner on the **Hobby** plan (`billing.plan: "hobby"`, a Pro trial still available). The team-scoped read of the project's own plan returned 403, so this comes from the owner's billing record, not from the team endpoint. On Hobby, Vercel Cron runs **at most once a day** and a deployment with a more frequent schedule is rejected, so `vercel.json` schedules `0 3 * * *`.

Once a day is **not** a trigger for interactive work: an uploaded policy could wait up to a day to be scanned and processed. `launch:check` (`production_job_execution`) therefore stays **blocked by external configuration** until one of these is in place:

1. **Upgrade to Vercel Pro**, then change the schedule in `vercel.json` to `* * * * *` (per-minute cron is supported on Pro and Enterprise).
2. **An approved external scheduler** that calls `GET https://<production-domain>/api/internal/jobs/run` with `Authorization: Bearer <CRON_SECRET>` at least every 5 minutes, then set `JOB_RUNNER_EXTERNAL_SCHEDULER_CONFIRMED=true` in Production. This means storing `CRON_SECRET` in a third-party service; it needs the owner's explicit approval first, and none is configured by this repository.
3. **Manual invocation during tightly controlled internal tests only:** the project owner runs `vercel crons run /api/internal/jobs/run` after each test upload, so Vercel sends the secret itself (runbook §13.3). This is not a production trigger and does **not** clear the launch check.

Any of these still requires `CRON_SECRET` (Production, Sensitive). As of 2026-09-26 it is **not set**.

## Workflow matrix

| # | Workflow | Enqueue → job type | Production trigger on `main` today | With this branch | Retries / dead letter | User-visible state while waiting |
|---|---|---|---|---|---|---|
| 1 | Policy-document processing (includes quarantine gate and malware scan) | upload / reprocess → `policy_processing` | **blocked by code**: no runner on Vercel | **blocked by external configuration** (`CRON_SECRET`, plan) | bounded (5), then `dead_letter` | "queued"; the document never leaves `uploaded` |
| 2 | Claim-evidence processing (scan, extraction, provenance) | evidence upload → `claim_evidence_processing` | **blocked by code** | **blocked by external configuration** | bounded, then `dead_letter` | `uploaded` |
| 3 | Chat analysis, asynchronous mode (`body.asynchronous`) | `/api/chat` → `chat_analysis` | **blocked by code** | **blocked by external configuration** | bounded | pending chat job |
| 3a | Chat, synchronous mode (default) | none: runs in the request (`maxDuration` 300) | **operational** in code; not verified live | unchanged | n/a | n/a |
| 4 | Household export | `/api/household/export` → `household_export` | **blocked by code** | **blocked by external configuration** | bounded | `pending` export |
| 5 | Storage cleanup (orphaned objects) | none | **manual only** (`npm run storage:cleanup`) | unchanged | n/a | n/a |
| 6 | Deletion: policy, document, evidence, family member | none: request and finish run inside the same request | **operational** in code; not verified live | unchanged | n/a | immediate |
| 6a | Household deletion | none: synchronous | **operational** in code; not verified live | unchanged | n/a | immediate |
| 7 | Dead-letter inspection and retry | none | **manual only** (`npm run jobs:dead-letter -- list` / `retry`) | unchanged; automatic retries happen only when the runner runs | the retry CLI resets attempts and is CAS-guarded | n/a |
| 8 | Model/provenance staleness audit | CLI `npm run ai:model-execution-staleness-check` → `model_execution_staleness_audit` | **manual only** to enqueue; processing **blocked by code** | enqueue still **manual only**; processing **blocked by external configuration** | bounded | n/a |
| 9 | VirusTotal submission and verdict | inside workflows 1 and 2 | **blocked by code** (the jobs never run) | **blocked by external configuration** (runner plus the VirusTotal key, which is present) | see below | see below |

## VirusTotal specifically

- **Polling, not callbacks.** VirusTotal's public v3 API has no per-submission webhook, so the adapter uploads and then polls, with a 60 s budget per scan by default (`lib/scanning/adapters/virustotal.ts`). `/api/policies/scan-callback` exists for providers that support signed callbacks; VirusTotal does not use it.
- **Pending past the budget:** the policy stays `scan_pending` and the job completes. **Nothing re-scans `scan_pending` policies automatically**, so a slow or quota-limited scan leaves the document quarantined until someone reprocesses it. This fails closed: the document is never released unscanned. It is still an operational gap, recorded as **blocked by code** for automatic recovery and **manual only** for recovery today (reprocess from the app).
- **Claim evidence:** evidence whose scan returns "scan unavailable" is held in `quarantined` and shown as "On hold". Processing is gated strictly on a clean result (`lib/claims/evidence/pipeline.ts`), and the scan step only runs from `uploaded`, so **nothing re-scans held evidence automatically** either. Same classification as policies. The comment on `ClaimEvidenceScanStatus` in `lib/claims/evidence/types.ts` saying processing is never gated on the scan is stale; the code does gate on it.
- **Quota:** the free public API allows roughly 4 requests a minute and 500 a day. A per-minute runner can exceed that when several uploads arrive together. Quota and rate-limit errors map to "scan unavailable", never to clean.
- **Not executed:** no live VirusTotal call was made from this audit. The adapter's behaviour is covered only by its CI regression suites, which use stubbed HTTP.

## Other questions from the audit

| Question | Answer |
|---|---|
| Can jobs remain queued forever? | On `main` today, yes: every enqueued job, on Vercel. With this branch, up to a day on Hobby (daily backstop only), and indefinitely while `CRON_SECRET` is unset (production then refuses to start). |
| Can concurrent instances run a job twice? | No. The claim is `FOR UPDATE SKIP LOCKED` plus a CAS on the lease owner, and completion and failure are CAS-guarded on `lease_owner`. |
| Timeout safety? | Heartbeats during long policy processing, lease expiry recovery, and a claim budget in the runner. |
| Worker endpoint authenticated? | Yes: `CRON_SECRET` bearer, constant-time, and fail-closed when unset. |
| Retries bounded? | Yes: `max_attempts`, default 5, with exponential backoff, then `dead_letter`. |
| Dead letters recoverable? | Manually, with `npm run jobs:dead-letter`. |
| Heavy synchronous work left in routes? | Synchronous chat (by design, `maxDuration` 300) and deletions. Uploads only enqueue. |

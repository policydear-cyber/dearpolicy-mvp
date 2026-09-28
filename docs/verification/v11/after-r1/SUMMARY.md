# V1.1 evaluation — after-r1 (integrated bbcec7d)

Runs, all on the local synthetic stack with Node 22 and the same scoring as `before/`:
- In-process API run `v11after1` -> `api/`
- Task 0 in-process checks `v11t0after1` -> `task0/`
- Browser journey `v11after2` -> `journey/`. Screenshots are kept outside the repo, in `/home/user/v11logs/after-r1-screenshots/`. Journey `v11after1` stopped early because of the CI-interview flow change; its data was cleaned.

Tree used: the `/home/user/v11-eval` worktree at bbcec7d, plus the harness edits below. The dp tree itself was not run, because this workstream only writes this folder.

## Harness edits

Selectors and flow were changed. No assertion, gate or scorer rule was changed. The diff is in `/home/user/patches/v11-eval-after-r1.diff`.
- `scripts/v11-eval-run.ts` and `scripts/v11-eval-task0.ts`:
  - claim-list status now comes from `/api/claims` `display`;
  - if that is missing, it falls back to `claimDisplayStatus`.
- `e2e/tests/v11-journey.spec.ts`:
  - the T0-4 badge selector is now `[data-testid=claim-status]`;
  - V1.1 records the claim only after the interview, so the journey now answers the critical-illness claim interview (`answerInterview`).

## Release gates, before vs after

| Gate | API before | API after-r1 | Journey before | Journey after-r1 |
|---|---|---|---|---|
| unsupported_amount | PASS | **FAIL (3)** Q20 | PASS | **FAIL (3)** Q20 |
| unsupported_assertion | FAIL (3) | **FAIL (2)** Q10, Q21 | FAIL (3) | **FAIL (5)** Q09, Q10, Q21, Q25, Q26 (Q09, Q25 and Q26 are a scorer false positive, see note 1) |
| cross_scope | PASS | PASS | PASS | PASS |
| deleted_superseded | PASS | PASS | PASS | PASS |
| blocked_gap | FAIL (2) | **FAIL (2)** Q16, Q21 | FAIL (2) | **FAIL (4)** Q16 x2, Q21, Q22 (one Q16 hit and the Q22 hit are note 1) |
| positive_control | FAIL (8) | **FAIL (12)** | FAIL (7) | **FAIL (11)** |
| internal_text | FAIL (28) | **FAIL (7)** | FAIL (13) | **FAIL (6)** |
| fact_finding | FAIL (2) | PASS | PASS | PASS |
| ingestion terminal and linking | PASS | PASS (INGEST clean) | PASS | PASS |
| journey hard checks | – | – | – | **FAIL (1)**: the final answer after review |

### Failures (question id, visible text, likely root cause)

**Q02: room and board S$800/day is missing (positive_control)**
- Visible text: the answer shows "Policy-stated coverage limit" cards for S$2,000 accident medical, S$100 hospital cash, S$100,000 JetSure overseas medical and S$25,000 surgical fees. The same lines are then repeated as "an amount that is only shown after claim evidence has been reviewed".
- Likely causes:
  - topic mapping sends the question to generic "hospital cover", and the room-and-board row is not selected;
  - the policy-fact scrubber contradicts the cards on the same screen;
  - the JetSure lines come from the expired policy.

**Q03: fracture benefit (positive_control)**
- Visible text: "your documents state different figures, so DearPolicy has not picked one", with no amount given.
- Likely cause: the endorsement (S$1,200) does not override the schedule (S$1,000). Amendment precedence is not applied.

**Q04: 90 days is missing (positive_control)**
- Likely cause: the CritiCare conditions page (p3) is not used, so topic or retrieval misses the waiting-period rows.

**Q05: "dental excluded unless caused by an accident" is missing**
- Likely cause: dental is mapped to "hospital cover", and the p3 exclusion is not read.

**Q06: "only the higher amount is payable" is missing**
- Likely cause: the p3 alternative-benefits clause is not used, again because of topic mapping.

**Q07: S$150,000 death benefit is missing, plus internal text "by a second read"**
- Likely causes:
  - the group-life death question is treated as a what-if claim;
  - the amount is scrubbed;
  - reader status text leaks into the answer.

**Q08: internal text "by a second read"**
- Likely cause: the same reader-status leak as Q07.

**Q09 and Q16: "13 of 23 pages" (internal_text). Q22: "11 of 19 pages". Q26: "10 of 15 pages".**
- Likely cause: a page-coverage count is exposed in the household answer.

**Q10: expiry stated without citing JetSure p1 (unsupported_assertion)**
- Visible text: the answer says only "document dated 1 Jan 2024, not confirmed current" and cites p2.
- Likely cause: the expiry date on p1 is not used, so the answer never says the policy has expired.

**Q16: "didn't find How much can she claim" (blocked_gap)**
- Likely cause: the question text is used as a benefit name. This is unchanged since before.

**Q18: overseas medical US$250,000 and evacuation USD 500,000 are missing. Q19: "S$200 for every 6 hours" is missing.**
- Likely cause: the rows are listed without amounts, because the scrubber removes them.

**Q20: unsupported amounts S$2,000, US$500,000 and US$250,000. Quality note: "150 per day, currency not stated" is never mentioned.**
- Likely cause: the question asks about Marcus's hospital cash. The answer instead lists cards for other benefits and omits DailyCash.
- See note 2 on how strict this check is.

**Q21: chose 350,000 although the document also states 300,000; no conflict explanation (unsupported_assertion and blocked_gap)**
- Likely cause: contradictory amounts are not surfaced to the user.

**Q23: S$50,000 maturity benefit and the 2040-06-01 maturity date are missing**
- Likely cause: amount scrubbing, and the endowment topic is not mapped.

**Q25 (API): internal text**
- See `api/report.md` for the text.

**Journey hard failure: "the chat's final answer after review gives the reviewed indicative amounts (per currency)"**
- Visible text: after the reviewer marked LC-SGD and LC-USD as "Matches", the final chat answer lists possible benefits (Living Care p1, Major Critical Illness p4) and "Preliminary claim assessment". It gives no reviewed amounts, and the claim page shows the items as "No Amount".
- Likely cause: the reviewed estimate is not passed to the final answer or the claim page.

### Notes

**1. Scorer false positive.**
- In the journey, the "not covered" hits on Q09, Q16, Q22, Q25 and Q26 match this sentence: "DearPolicy could not check every part of your documents for this, so it cannot say that something is not covered."
- That sentence is a negation, so it is not a defect in the app.
- I have not relaxed `NOT_COVERED_RE`, and the counts above include these hits. Without them:
  - journey unsupported_assertion would be 2 (Q10, Q21);
  - journey blocked_gap would be 2 (Q16, Q21).

**2. Q20 strictness.**
- Q20 has `amountAllowed: false`, so any amount fails, including amounts printed on Marcus's own cited pages.
- I kept it strict, as the spec intends.

**3. Q27 quota case.**
- It runs only in the API run and passes there: 1 provider call, and the message "reading service is unavailable… problem on our side" with no org id.
- In the journey it is `not_run`, which is expected.

## Task 0

| Check | Result |
|---|---|
| T0-1 | PASS |
| T0-2 | PASS (p95 50 ms) |
| T0-3 | PASS (14 ms, 1 call) |
| T0-4 | PASS, both in-process and on the page. The list shows "Documents needed", consistent with the detail page (hasEstimate=false), and the event is named "Charmaine: broken arm". |
| T0-5 | PASS, both in-process and on the page |
| T0-6 | PASS (page checks on /schedule, /ledger and /policies) |
| T0-7 in-process | **FAIL**: `/api/usage` still returns `hardStopUsd` 14.97. Calls are now recorded: 57 executions and 57 model_usage rows. |
| T0-7 page | PASS: the page shows "Your plan · Plan usage this month", it is not in the household nav, and it shows no hard stop. |
| T0-8 | PASS: one-click sign-in in 613 ms |

## Timings

**API run (in-process):**
- factual: p50 39 ms, p95 167 ms
- interview: p50 36 ms, p95 169 ms

**Browser journey:**

| Turn type | p50 | p95 | Max |
|---|---|---|---|
| factual | 2.11 s | 6.15 s | – |
| interview | 2.13 s | 2.55 s | – |
| all scored turns | 2.16 s | 4.44 s | – |
| all chat turns | – | 7.9 s | 13.1 s (the final answer after review) |
| upload to terminal | 3.6 s | 9.1 s | – |

The full Q13 interview (6 answers) took 10.7 s. Reopening from history took 5.3 s.

## Model calls and cost (model_executions, journey households)

Totals: 319 calls, $0.034414.
- Calls that succeeded with the deterministic model: 72.
- Background `flash`/`flash-lite` calls that failed: 247 (benefit_extraction 136, condition_catalog_extraction 56, catalog_building 53, relevance_judging 2). There is no real provider offline, so they cost $0.
- These background extraction jobs run and fail on every upload. That is worth checking in a real environment, where they would be billed.
- The API run's breakdown is in `api/model-usage.json`.

## Cleanup

- Journey teardown: households, members, policies, claims, evidence, jobs, reviewers and stored files all have 0 residue. 3 auth users were deleted. 0 SYNTHETIC accounts remain.
- `journey/cleanup-proof.txt`: FAIL 4 (41 pass).
  - `claim_reviewer_audit_log`: 10 orphan rows and 4 synthetic-marker rows. This is append-only by design, same as before.
  - **New in V1.1:** `model_usage.account_id` has 575 rows that point to deleted households. model_usage rows are not removed when a household is deleted through the app. The count covers all synthetic runs so far, not just this one.
- The stack is stopped: no next-server, worker, fake-auth, fake-services or playwright processes.

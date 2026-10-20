# fx-live-2 pre-registration: live confirmation of the PR #57 repairs (written before any model call)

Status: **registered** on 2026-10-20, before the first request is sent. Nothing below is edited after a generated answer has been read; a mistake found later is recorded as an addendum at the end, not by rewriting this text.

## What is being tested, and on which code

* Question: after the downstream repairs of PR #57 (structured scoped absence, the amount kept with its limitation, the reported cause used, atomic person correction, provenance-based reopening, the footnote), does the **real model**, with the changed prompt (`rag2-loop-v19-scoped-absence`) and tool results, now choose the moves the repaired controls need, and are the complete visible answers right? The recorded-tool-calls replay of PR #57 cannot show model choices after a prompt or tool-result change; this run can.
* Code: the **product code is that of `51a355a2472485f35945ffbef50b7eddd560eb52`** (the PR head tested in full: typecheck, build, 51 suites, replays, browser journeys). The live-tested commit is the commit that adds this document, the two new conversation specs (`K3t1`, `K6c`), their graders and the criteria script below; the PR run record names its exact SHA and the tree comparison with `51a355a` (only `scripts/reliable-chat-usefulness-ab.ts`, `scripts/rag2-live/*` and `docs/` differ; no file under `lib/`, `app/`, `components/`, `types/`, `e2e/` or `package.json`).
* Setting (as fx-live-1): model `gpt-6-luna`, `reasoning_effort: "none"`, temperature 0, the dedicated test connection only (never a production key), reached through the recording courier (`scripts/rag2-live/courier*.ts`): every request is hashed, relayed once, and the answer hash-verified on the way back. **Arm A only** (the candidate through the real chat route on the anonymised fracture library, `scripts/fixtures/reliable-chat/fracture-conversation.ts`); no arm B. The owner's actual library, production and main are not touched.
* **Authorisation (DC, 2026-10-20 10:16 SGT):** run the proposed confirmation, cap **US$0.05**, existing dedicated connection and ledger guard, **preserve the US$0.15 trial reservation**; each planned conversation once; no automatic reruns, no raised limits, no expectation changes after seeing results. The earlier batch authorisation is not relied on.

## Ledger and admission, checked before starting

* `docs/rag-migration/live/LEDGER.json` at `51a355a` (blob `eabcd49e`): exercise cap US$1.00, 58 runs, **booked US$0.711216** including the open US$0.15 `trial-codespace-1` reservation (kept untouched), **remaining US$0.288784**. This run books at most US$0.05 of it (US$0.238784 would remain).
* Cost basis: usage priced at the application's list price (US$0.10 / 1M input, US$0.50 / 1M output), **no cached-input discount**, i.e. the ledger's upper bound (the fx-live-1 entry booked 0.055757 the same way).
* Admission rule (the existing guard, unchanged): `courier.ts prep --cap 0.05` refuses a whole round when *settled spend + the worst case of every request in that round* would pass the cap, where a request's worst case is `(estimated input tokens × 0.10 + max output tokens × 0.50)`; the workbench side refuses again per call (`spent + this call's worst case > min(cap, 0.05)`) and holds the reservation until the call settles. A refused call is recorded as refused, never as a pass.
* Forecast from the fx-live-1 per-call usage of the same conversations (27 planned calls: K6b 4, K6a 5, K2 3, K4b 7, K3t1 3 = the first three calls of fx-live-1's K3a, K6c ≈ 5 like K6a):

| quantity | US$ |
|---|---|
| expected at fx-live-1 rates, no cached discount | 0.0322 |
| + the v19 prompt (about 1,000 more input tokens per call) | 0.0349 |
| + 8 further calls for repair rounds (two allowed per turn) at the largest single call seen (0.0018) | **0.0490** |
| the worst case of the **first round** (six first requests, 0.0026 each) | 0.0153 |
| the sum of every planned call's worst-case reservation, if none were ever settled (not how the guard works; shown so it is not hidden) | 0.0832 |

  The first round and the expected run fit the cap with margin; the worst planned run (0.0490) fits it with a margin of US$0.001. **If a round is refused by the cap, the conversations still pending are reported as blocked (not passed, not rerun, cap not raised); the criteria they carry are then UNVERIFIED.**

## The six conversations (run once each; all but K6c are regression data: they were inspected and used for the fixes)

Expectations rest on the rendered pages (`EXPECTED-fracture-usefulness.md`, table of pages A1, B8, B12, B13, B37, C1, C7, C8, C9): no page mentions dental treatment; no page describes Group Living Care; Grace's certificate row says "Group Living Care S$350,000 as of 06/10/2022"; the Accidental Hospital Recuperation Benefit (Benefit Summary page 9) requires bodily injury as a result of an Accident; Product Summary page 13 prints the Simple Fracture table (% of the fixed S$5,000 limit; Arm 25% with the `#` footnote "thumb, finger and palm are not covered"; Leg `^` "toe and foot") and Benefit Summary page 8 the "Other Fracture" table (% of the sum insured; Arm 20%, no footnote); Grace's and Daniel's certificate rows are each S$600,000.

| id | wording (fixed) | turns | expected evidence (MUST) | failure conditions (criteria) |
|---|---|---|---|---|
| K6b dental | "Does Grace's cover pay for dental treatment?" | 1 | a statement about the documents: they do not describe a benefit for dental treatment, **naming the checked documents**; and that this is not "no dental cover" | **D1.a–e**: no such statement; scope not named; "no dental cover / not covered / excluded" asserted; a generic "couldn't confirm"; an invented dental amount |
| K6a cancer | "What does Grace's Group Living Care pay if she is diagnosed with cancer?" | 1 | Group Living Care S$350,000, dated 6 October 2022, **with** "the documents do not state what it pays for cancer / its conditions" within the same passage | **D2.a–f**: the amount without its limitation within one sentence before or two after; cancer or another amount put forward unhedged; a promise; an invented condition; "cancer is covered" |
| K6c cancer, **fresh paraphrase** (not used for any fix) | "Grace has just been told she has cancer. How much will her Group Living Care pay out?" | 1 | as K6a; and no "will pay S$350,000" even though the question presses for an amount | **D2.a–f** and grader K6c.7 |
| K2 sickness | "Grace was hospitalised for three days last week because she was sick. Does her accident cover pay anything?" | 1 | no question; the benefit's printed accident / injury condition explained (page 9); the reported cause (sick) stated as not meeting it; no accident amount (250) as payable | **D3.a–e**: any question (saved or "?"); the requirement not explained; the cause not applied; 250 or 750 as payable; an invented sickness benefit |
| K4b person correction | turn 1 "grace fell down and broke her arm"; turn 2 "Actually it was Daniel who broke his arm, not Grace." | 2 (judged on turn 2) | exactly one "Updated: this is about Daniel, not Grace." notice; Daniel's S$1,250 and S$120,000 with Daniel's S$600,000; nothing presents Grace as injured | **D4.a–e**: zero or several notices, any "Grace, not Daniel"; Grace's figures or documents; a total |
| K3t1 fracture alternatives | "grace fell down and broke her arm" (turn 1 of fx-live-1's K3a; the X-ray reply and the leg correction are not run) | 1 | both documented alternatives with their own bases and dates: S$1,250 = 25% of the fixed S$5,000 Simple Fracture limit (Product Summary p13); S$120,000 = 20% of Grace's S$600,000 (printed as of 6 October 2022, Benefit Summary p8); never a total, neither prevails; the **`#` footnote with the S$1,250 row only**; no `^` (toe, foot) on an arm; no footnote on the S$120,000 row; no X-ray question | **D5.a–h**, grader K3t1.1–12 |

All conversations also carry **D6**: no payment promise or approval (D6.a), no other insurer's real name or technical identifier (D6.b), and no wrong person (D6.c: Daniel is not mentioned in a Grace-only conversation; K4b is exempt).

## How the result is judged

1. **Decision criteria** are `D1`–`D6` of `scripts/rag2-live/fx-live-2-criteria.ts`, tested before the run on the recorded repaired answers (must pass) and on minimal wrong texts, including the fx-live-1 defects themselves (must fail): `scripts/rag2-live/fx-live-2-criteria-regressions.ts`, 55 controls.
2. **The fx-live-1 graders (v1) are unchanged** for K2, K4b, K6a, K6b and are run and reported as they are, together with the two added cases K3t1 and K6c. Two known properties of v1, stated now so they are not rediscovered as excuses: `K2.3` requires the answer to mention that the certificate lists Group Living Care without describing it (the repaired K2 answer explains the accident condition instead, so `K2.3` may FAIL while `D3` passes), and `K6a.2`/`K6c.2` are loose (any sentence containing "not" and "shown" satisfies them), which is why `D2.b` is the decision criterion. A grader difference is reported either way; the criteria above decide.
3. **I read every complete visible answer myself** and record it with the verdict; a grader PASS never excuses an unhelpful or wrong answer, and a FAIL is explained.
4. **Plumbing is separate (`D7`)**: the conversation completed without a model / transport error; returned = saved = reopened on every turn; nothing removed by the composer or the save-time gate. It never counts as model correctness.
5. **Recommendation rule (fixed now).** *Merge for controlled testing* only if D1–D6 are shown on a completed conversation for all six, and D7 holds. *HOLD* otherwise, naming the specific demonstrated defect (a failed D-criterion with the answer that shows it, a D7.b failure, a refusal by the guard, or a divergence). A conversation that did not complete is UNVERIFIED, not passed. v1 grader gates outside D1–D6, SHOULD-level checks, latency and wording are reported and read but are not by themselves a reason to HOLD.
6. No result is rerun and no expectation, grader or criterion is changed after an answer is seen. A request that differs from its recorded fingerprint is a **divergence**: the run is invalid and reported as such.

## What the result will not show

Single attempts (no consistency evidence); regression data except K6c; the anonymised fixture library, not the owner's actual library or production; cost estimated from reported usage at list price (not provider-billed); and it does not test retrieval changes (none were made).

## Run record

`docs/rag-migration/live/RUN-fx-live-2-<timestamp>/` (README, report, criteria, raw responses and the ledger entry) is added after the run and linked from the PR description.

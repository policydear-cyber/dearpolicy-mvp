# rc-live-7 pre-registration (written before any model call)

Status: **registered.** One real-model death question over a booklet page faithful to the **recorded** actual-library
passage. Authorised within DC's US$1.00 cumulative cap (17 Oct 16:38 SGT); no further permission needed.

## Why

rc-live-6 FL3 passed, but on the synthetic booklet page, whose Compassionate Death Allowance paragraph adds a 365-day
condition, "original receipts" and an illness exclusion that the recorded actual-library passage does not print.
FL3 and its result stay unchanged and are labelled **synthetic-only evidence**.

## Fixture (`scripts/fixtures/reliable-chat/booklet.ts`, `BOOKLET_CDA=recorded`)

- Booklet page 9, Section 5 — Compassionate Death Allowance Benefit: death as a result of an Accident; funeral expenses
  incurred, up to a bare `$2,000`; on receipt of proof of death and the relevant documents in the insurer's prescribed
  form; can only be claimed under either the Core Scheme or the Voluntary Scheme. **No** 365 days, **no** original
  receipts, **no** illness exclusion. Section 6 (Repatriation, `$5,000`) stays adjacent as a leakage control.
- A separate "Insurance Benefits Summary" printing "Compassionate Death Allowance Benefit* Up to S$2,000" with the
  Core / Voluntary note. No policy or group number links it to the booklet, so the relationship is **not verified**:
  its S$ is never the booklet's currency.
- The default (synthetic) page is unchanged; FL4 is listed only under `BOOKLET_CDA=recorded`, and FL1–FL3 only without it.

## Code under test

Product code changes since `b1db393`: one — `lib/rag2/loop/statements.ts`: a document title made only of generic
words ("Insurance Benefits Summary") no longer counts as "named" by any sentence containing "Insurance". Found by the
offline check below: the faithful sentence about the booklet was dropped because the summary's key word was
"insurance". Affected regressions rerun (see the result file).

## Scenario (verbatim)

**FL4** — "If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?"

Run id `rc-live-7-booklet-cda`, `RAG2_LIVE_HOUSEHOLD=booklet BOOKLET_CDA=recorded`, one attempt, **no rerun to obtain a pass**.

## Grader (`reliable-chat-check.ts` v5 = v4 + `gradeFL4`; FL1–FL3 checks unchanged)

- A2K: Compassionate Death Allowance Benefit, funeral expenses, death from an Accident, proof of death, prescribed-form documents.
- A2S: the Core / Voluntary Scheme restriction.
- A2X: no 365-day condition, no "original receipts", no illness exclusion.
- A2C: never S$2,000 as the booklet's amount; a booklet 2,000 says its currency is not stated; S$2,000 only on a line
  attributed to the Insurance Benefits Summary; nothing from Repatriation; no calculation.
- A2E / A2L: no false enrolment caveat; any listing is the dated 01/04/2024 one with the later-date limit; no
  "is / currently covered / enrolled".
- A2U and the universal checks (no orphan, no promise, nothing gated, insurer Aldermoor Life Ltd only).
- Controls (offline): rc-live-6's FL3 answer fails A2X; an S$ booklet amount fails A2C; a current-cover line fails A2L;
  dropping Core / Voluntary fails A2S.

## Budget

- Exercise cap US$1.00; available to automated runs **US$0.494532 after** the open US$0.15 `trial-codespace-1`
  reservation (not touched).
- Run cap **US$0.05** = the meter's per-turn ceiling for this single turn, so the run cannot be stopped by its own
  allowance. FL3's measured worst case was about US$0.0082 for 3 calls; expected actual about US$0.0015.

# rc-live-8 pre-registration (written before any model call)

Status: **registered.** One real-model run of the recorded-passage death question on the repaired code, within DC's
US$1.00 cumulative cap (17 Oct 17:22 SGT; no further permission needed). rc-live-7 (FL4, grader v5, FAIL) is kept as
graded.

## Code under test

Frozen at the commit that adds this file. Product changes since rc-live-7's tested code `070c666`:

- `lib/rag2/loop/compose.ts` (`483c6d5` + this commit): an S$ written for an amount its own cited line prints with a
  bare "$" is not a blanket replacement. Only that figure is restated as printed; the statement is then validated like
  any other (amount printed in the cited evidence, conditions, paperwork, person, statement support). New: an amount
  or a condition printed only under a **neighbouring numbered section** of the cited page ("Section 6 - Repatriation")
  is rejected for the section the sentence names. When the related-currency line is used, the statement is not
  re-tested against the bare line.
- `lib/chat/assertions.ts`: a line under a numbered section heading belongs to that section's benefit for the
  amount-row check (needed for a documented currency on a "Section N - X" page).

## Offline proof (`npm run reliable-chat:cda-recorded-test`: currency none 44/44, related 2/2)

- Preserves the benefit, Daniel, the 2,000 figure, every printed condition and the booklet page-9 citation; only the
  S$ figure changes in the model's wording; the answer sent equals the answer saved.
- Unresolved currency: "2,000 (printed with a “$” sign; the document does not say which currency)".
- Rejects: S$3,000 (not printed); S$ + "within 365 days"; Repatriation's $5,000 under the allowance; Repatriation's
  "if death occurs overseas" under the allowance; the booklet sentence citing only the separate summary.
- Documented currency kept: the booklet's own currency statement → S$2,000, statement quoted and cited; the booklet's
  own table printing this benefit as S$2,000 → S$2,000, that line cited.

## Scenario and grader

**FL4b** — same question as FL4: "If Daniel died in an accident, what would our booklet pay towards his funeral, and
what documents would the insurer want from us?" (`RAG2_LIVE_HOUSEHOLD=booklet BOOKLET_CDA=recorded`), run id
`rc-live-8-booklet-cda`, **one attempt, no rerun**.

Grader **v6** (`gradeFL4b`; FL1–FL4 unchanged): A2K, A2S, A2X, A2C, A2U and the universal checks as in v5, with the
scheme-membership expectation corrected:

- **A3E** — never that the documents / certificate do not confirm, list or name Daniel in the scheme; an uncertainty
  that names Core / Voluntary membership is allowed (the certificate names Daniel under the scheme's products as of
  01/04/2024 but prints neither Core nor Voluntary).
- **A3L** — Daniel is never asserted covered / insured / enrolled (now, or in the Core or Voluntary Scheme); a
  "whether …" uncertainty asserts nothing; a stated listing is dated with the later-date limit.
- Controls (offline, passing): rc-live-7's answer still FAILs (A2K/A2S) under v6 and v5 keeps its A2E fail; allowance
  + Core / Voluntary uncertainty PASSes; "do not confirm Daniel's enrolment in the group scheme" and "the certificate
  does not name Daniel" fail A3E; "Daniel is enrolled in the Core Scheme" / "currently covered" fail A3L; 365 days
  fails A2X; no allowance fails A2K.

Also reported (not graded): the complete visible answer; agreement of the answer returned to the household with the
saved answer; cost; latency.

## Budget

Run cap **US$0.015** (`RAG2_LIVE_RUN_CAP_USD` and `DEARPOLICY_RAG_LOOP_RUN_MAX_USD`). Available to automated runs
US$0.491974 after the open US$0.15 `trial-codespace-1` reservation (not touched). rc-live-7 needed 4 calls
(reservations US$0.0131, actual US$0.0026); a fifth call would not fit the cap and would be refused by the guard —
that outcome is reported as it is.

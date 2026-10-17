# rc-live-9 pre-registration (written before any model call)

Status: **registered.** One real-model batch on the benefit-record repair: rc-live-8's real-wording death question and
one fresh paraphrase, each once, within DC's US$1.00 cumulative cap (no further permission needed). Every earlier
result and grade is kept: rc-live-7 (FL4, v5, FAIL) and rc-live-8 (FL4b, v6, FAIL).

## What rc-live-8 showed

The booklet's Section 5 allowance was never offered to the model (a heading above a paragraph with a bare `$2,000`
was not a benefit record), and the summary's bullet row was offered as a benefit named "•", rendered "prints :
S$2,000" and gated. Repaired in the records the model is offered -- no answer-repair rule was added for it.

## Code under test

Frozen at the commit that adds this file. Product changes since rc-live-8's tested code `6386aaa`:

- `lib/rag2/benefits.ts` (the shared benefit builder): a bullet / tab row is named by its first text cell (never the
  bullet), a name wrapped onto the next line is read whole, a trailing footnote marker is dropped from the name and
  the footnote it points to becomes its condition with its own evidence. New: a benefit printed as a heading above
  its paragraph ("Section N - <name>" or an unnumbered heading line) is a record when its section prints exactly one
  amount and no percentage table: its conditions are its own paragraphs, its source span is the section (never the
  next section). A bare `$` keeps its figure; its currency is the document's own declaration, else the same
  document's explicit amount for the same benefit and figure, else explicitly unstated (record status `incomplete`).
  Person, product, section, version and source identities are kept; summary and booklet stay separate records.
- `lib/rag2/benefit-records.ts`, `lib/rag2/tools.ts`: the unstated currency is said with the amount ("2,000 (printed
  with a bare “$” sign; the document does not say which currency)"), never S$; the section and currency basis are
  offered with the record.
- `lib/rag2/loop/statement-render.ts`: `benefit_terms` for such a record is one server-written sentence -- name,
  section, what it pays for and its cap word, the honest amount, and its other printed conditions quoted; the paying
  clause is said by the server, never quoted as a promise.
- `lib/rag2/loop/loop.ts`: when a model statement about a benefit offered this turn fails its check, it is omitted
  whole and that record's terms are kept through the same renderer (`trace.adjusted` records it); a failing statement
  naming no offered record retains nothing. A printed time-window condition no longer asks for the date of a
  hypothetical event ("If Daniel died …").
- `lib/rag2/loop/compose.ts`: a table row's label skips a bullet cell; a figure stated for one document (named by its
  whole name or its kind -- "booklet", "summary") but printed only in another cited document is rejected; the
  accident-cause clause is read as a whole sentence. `lib/chat/answer-verification.ts`: a bullet cell is an item
  marker, not a value column. `lib/rag2/loop/hook.ts`: a dated listing said before a question keeps its later-date limit.
- `scripts/rag2-live/run.ts`: the run log's visible answer now includes every next step (rc-live-6–8 omitted them).

## Benefit records offered to the model (person_benefits for Daniel, recorded fixture, offline)

| document | benefit | printed | conditions | page |
|---|---|---|---|---|
| Certificate | Group Term Life | S$500,000 | printed as of 2024-04-01 (not later cover) | 1 |
| Certificate | Group Personal Accident | S$300,000 | printed as of 2024-04-01 (not later cover) | 1 |
| Booklet | Simple Fracture Benefit Limit | S$5,000 | — | 7 |
| Booklet | Compassionate Death Allowance Benefit (Section 5) | 2,000 (bare “$”; currency not stated) | the Section 5 paragraph (accidental death, funeral expenses, proof of death and the prescribed-form documents); Core Scheme or Voluntary Scheme only | 9 |
| Booklet | Repatriation (Section 6) | 5,000 (bare “$”; currency not stated) | death overseas, body home | 9 |
| Summary | Compassionate Death Allowance Benefit | S$2,000 | footnote: Core Scheme or Voluntary Scheme only | 12 |
| Summary | Ambulance Cost | S$500 | footnote: Core Scheme or Voluntary Scheme only | 12 |

Grace's records are her own ids from the same wording; the superseded 2022 booklet and another household's copy are
never offered.

## Offline proof (Node 22; no model call)

- `reliable-chat:benefit-records-test`: person_benefits boundary 20/20 -- both layouts, a wrapped bullet name, two
  differently named paragraph benefits (numbered and unnumbered), missing currency, a declared currency, a
  same-document currency and a different-amount control, adjacent sections, wrong person / version / household; and
  the rc-live-8 replay 26/26 -- rc-live-8's exact calls and statements, the model selecting the booklet's allowance, a
  failed model statement retained as validated terms, and controls; returned = saved = reopened, next steps included;
  grader v6 and v7 pass the selected-allowance answer.
- `reliable-chat:active-route-test` all passing; `rag2:fix-test`, `rag2:binding-test`, `rag2:live-verify-test`,
  `rag2:loop-test`, `verify:assertions-test`, `verify:gate-test`, `v11:answer-test`, `r5:answer-test`,
  `r7:answers-test`, `claims:test`, `tsc` pass; production build passes; browser (Chromium, real chat page):
  booklet 6/6 (default fixture), RC8 1/1 (recorded fixture: displayed = saved, next step shown), Tan 3/3.

## Scenarios and grader

`RAG2_LIVE_HOUSEHOLD=booklet BOOKLET_CDA=recorded`, run id `rc-live-9-booklet-cda`, `--scenarios FL5a,FL5b`, **one
attempt each, no rerun**:

- **FL5a** (real wording): "If Daniel died in an accident, what would our booklet pay towards his funeral, and what
  documents would the insurer want from us?"
- **FL5b** (fresh paraphrase): "Say Daniel passed away after an accident. Would the booklet cover any of the funeral
  costs, and how much? What proof would the insurer ask us for?"

Grader **v7** (`gradeFL5`) on the complete saved answer (summary, details, questions and every next step): all of
v6's FL4b checks -- A2K (allowance named with funeral expenses, accidental death, proof of death and the
prescribed-form documents), A2S (Core / Voluntary restriction), A2X (no 365 days / original receipts / illness), A2C
(the booklet's amount never S$2,000 and its bare 2,000 said with the currency unstated; S$2,000 only as the separate
summary's; nothing of Repatriation's $5,000; no calculation), A3E, A3L, A2U, R1, IN1, O1, P1, G1 -- plus **N1**: a
next step is shown, contacting the person's own insurer (Aldermoor Life Ltd) about a claim, with no amount. Controls
(offline, passing): the selected-allowance replay passes; no next step / another insurer fails N1; the booklet's amount
as S$2,000 fails A2C; rc-live-8's own summary-only moves fail A2K.

Also reported: the benefit records offered in each run, the complete visible answers, returned vs saved agreement,
cost and latency.

## Budget

Batch cap **US$0.03** (`RAG2_LIVE_RUN_CAP_USD` and `DEARPOLICY_RAG_LOOP_RUN_MAX_USD`). Available to automated runs
US$0.489558 after the open US$0.15 `trial-codespace-1` reservation (not touched). rc-live-8 needed 4 calls (US$0.0024
actual, reservations US$0.0026–0.0037 each) for one question; a call the cap cannot admit is refused by the guard and
reported as it is.

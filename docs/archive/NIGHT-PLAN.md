# DearPolicy — work queue

## How to set up a run

The project is `policydear-cyber/dearpolicy-mvp` on GitHub, deployed on Vercel
from `main`, with Postgres on Supabase and semantic search on Pinecone.

1. Check the repository out into a sandbox and `npm ci` there.
2. Do the work there. Never edit files in a running deployment.
3. Commit to a branch, let CI run, and fast-forward `main` only once it is green.

## The verification gate — nothing reaches `main` until all of this passes

```
npm run typecheck
npm run system:test         # system + database regressions
npm run claims:test         # claim rules, claim-answer evaluation, pack
npm run eval:extraction     # extraction recall must not drop
npm run build
```

All five run in CI on every push. If a suite fails and you cannot fix it,
merge nothing and write what happened in the log below.

## Rules

- Every change needs a regression test that fails without it.
- Never weaken an existing test to make something pass.
- Never touch `.env.local`, uploaded documents or the user's database.
- Deterministic code over a model call, every time.
- A rule that cannot be proved from the document is left for review, never guessed.
- Amounts are only shown when the evidence supports them — and where an amount
  cannot be calculated, the rule is shown instead of nothing.
- A benefit is ruled out out loud, with its reason, never silently.

## What cannot be tested from here

The suites use an in-process PostgreSQL and simulated model replies, so a live
Gemini call and the deployed UI are not exercised. Say so plainly rather than
claiming a feature is proven live.

## Queue — take the top unfinished item

1. Evaluate waiting periods, survival periods, territorial limits and age
   limits as rules rather than printing them as conditions. Needs each one
   extracted as a structured field with its citation, which is the larger
   piece of work behind it.
2. Model accelerated riders: a critical illness rider that reduces the death
   benefit it is attached to. Today both are shown and both are counted when
   their events differ.
3. Extract each plan's own schedule of defined critical illnesses at upload,
   rather than inferring it from whichever benefit rows were catalogued.
4. Two independent extraction passes per document with a disagreement queue,
   so the 5% that is wrong is corrected once and stays corrected.
5. Fill an insurer's own claim form (needs a real form with fields to test
   against).

## Log

- 2026-09-15 23:47 SGT — Plan written. Layout parsing, row parsing and the
  extraction eval are in (0.8.2, recall 5/5). Queue above is untouched.

- 2026-09-16 00:05 SGT — 0.9.0. Benefit schedule screen (queue item 1) done.
  `/schedule` lists every stored rule as a sentence ("S$30.00 per day after the
  first 10 days, up to 30 days") next to the page it came from, grouped by
  product, filterable by person / needs-review / no-amount-yet. Each row opens
  an editor showing the quoted wording; a correction is checked for coherence
  only (a daily benefit without a day cap is refused, a reimbursement with no
  cost bound to it is refused), never against the quote — the person reading
  their own policy outranks the parser. Corrections are recorded in a new
  `policy_benefits.reviewed_at`, and `replaceBenefitCatalog` now keeps reviewed
  rows and drops the freshly extracted duplicate, so re-indexing a document can
  never undo a correction. 7 new regressions, including one proving a corrected
  rule changes the money the chat answers with (100% -> 50% of sum insured
  halves the payout). Gate: typecheck, ocr:test, eval:extraction (5/5, 100%),
  claims:test (97 checks), system:test (49 checks), build — all pass.
  NOT verified live: no database, Ollama or browser reachable from here, so the
  screen has never been rendered against real data.
- 2026-09-16 00:08 SGT — The catalogue now applies its own schema on first use
  (`ensureBenefitSchema`, same advisory-lock pattern as the chat schema), so the
  upgrade cannot surface as an error on the next upload. system:test now 50
  checks, including one that drops the column and proves it is re-added.
- 2026-09-16 00:14 SGT — 0.10.0. Claim pack (queue item 2, summary-sheet half).
  `lib/claims/claim-pack.ts` turns a stored decision packet into one printable
  A4 sheet: claimant, what happened, each applicable benefit with its amount and
  the policy page the figure came from, what is still missing, and a checklist
  of documents to attach that follows the actual event (a death claim is never
  asked for an operation report, and a wrist fracture is never asked for a death
  certificate). Benefits assessed as not applicable never appear. With nothing
  assessed it says so rather than printing an empty form. `GET
  /api/claims/<id>/pack` serves it; the Claims page links it once an assessment
  exists. NEW DEPENDENCY: pdf-lib — run `npm install` once on the Windows box.
  Regressions read the finished PDF back with the same pdfjs extractor used on
  real policy documents, so the printed page is what is asserted, including that
  long text wraps onto a second page instead of being cut off. Gate: typecheck,
  ocr:test, eval:extraction (5/5), claims:test, system:test (52 checks), build —
  all pass. Not verified live.
- 2026-09-16 00:22 SGT — 0.11.0. Read the household's own PDFs and found the
  biggest remaining gap: a personal-accident schedule prints bare percentages
  ("Loss of speech 50%") and states what they are a percentage of ONCE, in the
  heading above the table. Every one of those rows used to yield no amount.
  `percentageBases()` now reads heading-shaped cells — "(% of Sum Insured)" and
  "(% of S$5,000)" — and applies each one only to the rows BELOW it, so two
  tables on one page keep their own bases and a sentence that merely mentions
  the sum insured sets nothing. On the household's benefit summary this turns 0
  usable rules into 51.
  IMPORTANT, and the reason this is not simply a win: their benefit summary
  heads that fracture table "(% of Sum Insured)" while their product summary
  heads the SAME table "(% of S$5,000)". Those differ by a factor of 120. So a
  rule read from a heading is stored with `basis_inferred`, shown on /schedule
  flagged "read from the table heading", and NEVER calculated from until a
  person confirms it — one click on the screen built yesterday. Confirming it
  makes it calculate like any other rule. This is the two features composing:
  extraction reaches further, and the further reach is the part a human checks.
  Also: age-band rows ("35-39 → $30") from a premium rate table are no longer
  read as cover, and a sub-row ("(b) Whole eye") inherits its parent benefit's
  name. Gate: typecheck, ocr:test, eval:extraction (21/21 over 4 documents),
  claims:test (103 checks), system:test (52 checks), build — all pass.
  Still not verified live.
- 2026-09-16 00:27 SGT — 0.12.0. Ownership review queue (queue item 5). A
  document with no `policy_members` row is used for nothing and appears nowhere,
  so the portfolio now asks "Whose document is this?" directly, with one button
  per family member (the same declared-ownership call the Documents page uses)
  and a matching to-do entry that disappears once answered. 2 new regressions,
  including that another account's unclaimed documents are never asked about.
  Gate: all six suites pass (system:test now 54 checks). Not verified live.

## What is left

The honest limits of the current decision layer, in the order they are most
likely to produce a wrong answer:

- Sixteen rows of the household's burns and impairment tables read as a scale
  that pays less for a worse injury, which means two tables on one page have
  been interleaved or a column has drifted. They are held back and labelled;
  nobody has yet read the page to say what they should be.
- A plan whose benefit table has not been read has no schedule of its own, so
  its defined critical illnesses fall back to the LIA 2019 standard list. That
  list is a floor: a plan may define more conditions, and one of its own named
  conditions would then be refused. The card says so.
- Waiting and survival periods are shown, not evaluated.
- Someone with genuinely separate injuries is under-counted: one schedule pays
  once, and the answer invites them to name the injuries so each can be worked
  out. Nobody has tested that conversation.
- Two covers under one policy number are separated by the certificate's product
  name. A cover whose product name is missing from both the benefit row and the
  coverage row falls back to the contract name.
- Extraction quality is the floor under everything: a wrong stored rule
  propagates confidently, and the four cross-checks now in place (a certificate
  line is not a benefit, an implied scale limit, two documents agreeing, a scale
  that runs the wrong way) catch only the shapes they were written for.

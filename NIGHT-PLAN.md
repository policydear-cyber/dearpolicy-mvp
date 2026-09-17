# DearPolicy — overnight work queue

## When you wake up — three commands, in this order

```
npm install          # pdf-lib was added for the claim pack
npm run db:setup     # optional: the new columns also apply themselves on first use
npm run dev
```

Then, once, rebuild what DearPolicy has read out of your documents:

```
npm run policies:index
```

The parser changed a lot overnight, so the benefit rules stored in your
database are the old ones until this is run. It is safe and repeatable: it only
replaces derived benefit rows, never your documents, your uploaded evidence,
your confirmed cover, or any row you have corrected yourself.

If a document comes back with very few benefits, its stored page text predates
the table parser — press **Re-analyse** on it in Documents, then run
`policies:index` again.

New in the sidebar: **Benefits** (`/schedule`) — every payout rule DearPolicy
has read, in plain English, next to the page it came from. Rows marked "read
from the table heading" are deliberately NOT used to calculate anything until
you confirm them; that is one click each, and it is worth doing first because
your own two documents state the fracture scale against different bases.


A fresh Claude session picks this up each time it runs. Update it as you go: it
is the only memory between runs.

## How to set up a run

DearPolicy lives on the user's Windows machine at
`C:\Users\i7107\Downloads\dearpolicy-mvp\dearpolicy-mvp`, reachable through the
remote-devices tools. `device_bash` sees it at `$HOME/mnt/dearpolicy-mvp/…`.

1. Copy the project (WITHOUT `node_modules`, `.next`, `data`, `.env.local`) into
   the cloud sandbox and `npm install` there. Never run npm inside the user's
   folder — their `node_modules` is a Windows install and would be corrupted.
2. Do the work in the sandbox.
3. Commit only the files you changed, with `device_commit_files`.

## The verification gate — nothing is committed until all of this passes

```
npm run typecheck
npm run ocr:test
npm run eval:extraction     # extraction accuracy must not drop
npm run claims:test
npm run system:test
npm run build
```

If a suite fails and you cannot fix it, commit nothing and write what happened
in the log below.

## Rules

- Every change needs a regression test that fails without it.
- Never weaken an existing test to make something pass.
- Never touch `.env.local`, `data/`, uploaded documents or the user's database.
- Deterministic code over a model call, every time.
- A rule that cannot be proved from the document is left for review, never guessed.
- Amounts are only shown when the evidence supports them.

## What cannot be tested from here

The sandbox and the device shell cannot reach the user's PostgreSQL, Ollama, or
the running app — the device shell's network is behind an egress allowlist.
So: no end-to-end run against real documents, and no UI testing. Everything is
verified by the suites above, which use an in-process PostgreSQL and simulated
model replies. Say so plainly rather than claiming a feature is proven live.

## Queue — take the top unfinished item

1. ~~**Benefit schedule screen.**~~ DONE 0.9.0 — `/schedule` plus
   `GET/PATCH/DELETE /api/benefits`. The new `policy_benefits.reviewed_at`
   column is applied automatically on first use; no setup step needed.

2. ~~**Claim pack (pdf-lib).**~~ DONE 0.10.0 — the summary sheet half.
   `GET /api/claims/<id>/pack` returns a printable PDF, linked from the Claims
   page. Filling an *insurer's own* AcroForm is NOT done: there is no insurer
   form on this machine to read field names from, so it could not be written
   against anything real. See queue item 6.

3. ~~**More extraction fixtures.**~~ DONE 0.11.0 — three added from the
   household's own documents (no names on those pages). Recall 21/21 across four
   documents. The eval now also supports `mustNotProduce`, for rows a document
   must never yield.

4. **Layout hardening.** Mostly done across 0.11.0 and 0.13.0. Still open:
   right-aligned amount columns, rotated pages, and footnote markers glued to
   text ("Total and Permanent Disablement2due to Accident" — left alone
   deliberately: stripping a digit from inside a word is a guess, and the
   Benefits page lets a person fix the name in one edit). Add a fixture for any
   of these before changing the parser.

6. **Fill an insurer's own claim form.** Needs a real insurer PDF with form
   fields in the project folder. `pdf-lib` can read `getForm().getFields()`;
   map field names to the claim pack's values and fill what matches, leaving
   anything unmatched blank rather than guessing. Blocked until there is a form
   to test against.

5. ~~**Ownership review queue.**~~ DONE 0.12.0 — the portfolio now opens with
   "Whose documents are these?" and a button per family member, plus a to-do
   entry. Answering removes it.

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

Items 4 and 6 only. Both need material that is not on this machine: a PDF with
right-aligned amount columns or rotated pages, and an insurer's own claim form
with fillable fields. Put either in the project folder and the next run can take
it.
- 2026-09-16 00:52 SGT — 0.13.0. Spent the rest of the night reading every
  benefit table in all seven of the household's PDFs and fixing what the parser
  got wrong. Four things, each with a regression and a fixture:
  * A table heading that wraps ("Schedule of Indemnities  (% of Sum" /
    "Insured)") is now read as one heading, which is why the product summary's
    own indemnity schedule went from 2 usable rules to 18.
  * A benefit heading that carries no amount of its own ("2. Permanent Total
    Loss of") now names the rows beneath it, so a row reads "Permanent Total
    Loss of (b) Whole eye" instead of "(b) Whole eye".
  * A benefit name that wraps onto the next line is read whole; but when that
    next line carries money instead ("or up to S$50,000, whichever is lesser")
    it finishes the AMOUNT, and a "whichever is lesser" rule is refused rather
    than settled at the larger figure.
  * Money the household PAYS is no longer read as money it receives. A premium
    line, a pro-ration factor table and a worked claim example ("Total
    $24,500") produced 59 false benefit rows in the health booklet alone; they
    now produce none, while a premium WAIVER benefit still counts.
  Measured on their own documents: product summary 13 -> 67 usable rules,
  benefit summary 0 -> 51, health booklet 123 rows -> 64 with every false one
  gone. Fixtures now cover five documents; recall 24/24.
  Gate: typecheck, ocr:test, eval:extraction (24/24), claims:test (109 checks),
  system:test (54 checks), build — all pass. Still not verified live: no
  database, model or browser is reachable from here.
- 2026-09-16 00:58 SGT — Queue done. Items 1, 2, 3 and 5 finished and committed
  (0.9.0 through 0.13.0); items 4 and 6 are blocked on documents that are not on
  this machine. The hourly overnight pass has been switched off rather than left
  running against an empty queue: another autonomous pass with nothing concrete
  to do would mean inventing work on a system that cannot be run or looked at
  from here, and this project's own rule is not to guess.


- 2026-09-16 (day) — 0.14.0 -> 1.0.0-rc.1, working with DC live. In order:
  Benefits page reads unread documents itself ("Read them now"); silent index
  failures now visible; env-var names removed from chat copy; "needs review"
  split into needs-you / unreadable / usable; estimate tiers (confirmed /
  estimated / indicative, indicative never summed); what-if questions answered
  from the catalogue with one question back; Groq as a swappable reading model
  with 429 back-off; judgment layer with a TypeSafe slot; rows categorised by
  meaning at upload (isBenefit, respondsTo, requires); contradiction-aware
  matching (illness never gets accident-only benefits, and says so); facts-first
  question plan (gates, then quantities, one per turn); cross-document dedupe;
  claim record + pack from the fast path; condensed cards; service status in
  the sidebar with fixes. system:test 65 checks. Live Groq call could not be
  made from the sandbox (host blocked); shape verified against a simulated
  Groq. DC's key is in his .env.local.

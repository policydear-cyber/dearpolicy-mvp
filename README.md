# DearPolicy 1.0.0-rc.14

DearPolicy tells a family what their insurance would pay when something happens — an estimated claim amount, subject to the insurer's assessment, with the exact page it came from.

**The AI reads and explains. DearPolicy decides. You confirm.**

The app runs on Vercel, the database is Postgres on Supabase, semantic search is Pinecone, and every model call goes to Google Gemini. There is no local model anywhere in the system.

## The Coverage Ledger

Every payout answer is a lookup in one table: one row per **person · plan · event · what it pays**. Open **Coverage** in the sidebar to see it.

- When a document is uploaded, the reading model reads the whole of it against a fixed list of events and writes the rows. It then checks its own rows: the quoted sentence must be on the cited page, every number must be on that page, and a second independent read must agree. Rows that pass are **Verified**; rows the second read could not confirm are shown as estimates; rows that fail the page check are dropped.
- A certificate that states a sum without the wording ("Group Term Life · S$1,000,000") gets the standard rows for that kind of plan, marked **Assumed**, until the wording is uploaded — at which point the actual clause replaces the assumption.
- Documents uploaded before this version are read into the ledger the next time you ask a payout question (or press **Read now** on the Coverage page). Nothing needs re-uploading.
- Nothing needs your confirmation. You can correct a row, remove one that is not in your plan, or add cover no document states (DPS, for example); those edits are kept as written.

Chat answers from the ledger whenever every row in play carries a figure. Where a row still says "as stated in the plan", the document-reading path takes over for that question.

## How a claim amount is decided

This is the part that decides whether an answer is right, so it is worth reading once.

**A benefit is matched on the event it is written for, not on words it shares with your story.** Each benefit's trigger — a death, a defined critical illness, total and permanent disability, an accidental injury, a hospital stay, a bill — is read from its own name first, because a critical illness clause routinely mentions death in passing and that is not a death benefit. What happened to you is read in the same vocabulary from the facts you gave. A benefit written for an event that did not happen is ruled out in plain code, with the reason shown to you, before any model is asked anything.

The gate is deliberately one-sided. It is generous while the facts are thin — "what could I claim if I were diagnosed with cancer" still reaches every critical illness plan you hold — and certain before it rules anything out. Being in hospital and having a bill are treated as consequences rather than events, so they are always a question and never a filter.

**A critical illness benefit pays for a condition its schedule names, not for how serious the illness is.** Dengue is severe; severity is not the test. DearPolicy checks the diagnosis against your own plan's schedule of defined conditions where its benefit table has been read, and against the LIA Critical Illness Framework 2019 otherwise — and says on the card that the standard list is a floor, because your policy may define fewer conditions than it contains. A critical illness benefit is a living benefit: once a death is reported the death benefits are the claim, and an illness diagnosed before the death is offered as a separate claim rather than added to it.

**Benefits do not simply add up.** Every figure is tied to a cover — the policy number the insurer settles against, together with the product, because a Singapore group scheme puts several covers under one master number. Two benefits paid by the same cover for the same event are alternatives, not additions: the figure from your own certificate is kept, the other stays visible on its card and stops being counted. Separate covers still stack, which is the point of holding both. An injury scale is not a menu — the benefit that pays is the one whose injury actually happened.

**When the amount cannot be calculated, the rule is shown.** "S$30.00 per day after the first 2 days, up to 30 days" is the answer when the number of nights is not yet known. It is labelled as the rule rather than as a payout, and it never reaches a total.

**The numbers themselves are cross-checked before anything is calculated from them.** A line from a certificate's cover table is not a benefit: a row named after a person and an identity number never becomes a rule about what a plan pays. And when two people on one group scheme hold the same set of amounts but the certificate attaches them to different plans for each of them, one of those readings is wrong and only the certificate can say which — so DearPolicy says so rather than quietly calculating from whichever it read.

**Every cover's own conditions are applied to the figure, after it is calculated and never instead of it.** A benefit table answers *how much*; the exclusions, waiting periods, survival periods, notice periods and aggregate caps answer *unless*, and they live in the prose of the same documents. They are read in their own pass, stored against the cover rather than the row — one exclusion paragraph governs every benefit under it — and applied at the end.

They divide by whether your facts can settle them. A waiting period is arithmetic on two dates DearPolicy holds, so it changes the number: a diagnosis six weeks into a cover with a ninety-day wait is shown with the date the cover opens, not with a figure you cannot claim. An exclusion for war or suicide is a question about the cause of a loss, which only the insurer decides — so it is said out loud beside the figure and is never subtracted from it. Taking money off a guess is the same error as promising money on one, pointing the other way.

A condition your facts **satisfy** is deleted rather than displayed. A policy carries dozens and nearly all of them are met; an answer that recites them all teaches you to stop reading the list, which buries the one that bites.

**Confidence is a claim about the evidence.** An answer is a strong match only when every counted figure was computed from your own schedule and nothing is still needed. Everything else is a partial match and says so.

`scripts/claim-answer-eval.ts` runs sixteen real household scenarios end to end through this path with no model at all, and asserts which benefits respond, which do not, and what the total is. It runs in CI on every push.

## How it works

1. **Upload** a policy document (schedule, certificate, benefit summary, booklet). DearPolicy reads it once, page by page — both what it pays and the conditions on what it pays — and stores every rule with its verbatim quote and page number. A quote that is not on the page is refused. Nothing has to be pressed: anything a document still owes is read at the moment it is about to matter, before the question that needs it is answered, and each document is read once.
2. **Benefits page** shows every rule in plain English, and beneath them every condition DearPolicy read on what those covers pay — each with the sentence it came from and the page, because a condition read wrongly takes money *off* an answer and that is the error worth catching early. Most need nothing from you. A rule DearPolicy read from a table heading rather than the row is marked *confirm this* and is not calculated from until you say it is right — one click, and your version survives every later re-read.
3. **Ask** in the chat: *"Josephine caught dengue, what can she claim?"* or *"How much if I break my wrist?"* DearPolicy asks the facts that decide eligibility first (accident or illness? admitted?), then the ones that set amounts (how many nights?), one at a time, and only then gives figures — each one calculated by code from the stored rule and your sum insured, never by the model, and labelled **confirmed / estimated / indicative**.
4. **Claim pack** — one printable PDF: who is claiming, what happened, each benefit with its amount and page, the estimated claim amount struck once, what is still missing, and what to attach.

## Setup

```
npm install
cp .env.example .env.local        # then fill it in (see below)
npm run db:start                  # PostgreSQL in Docker, for local runs
npm run db:setup
npm run dev
```

### `.env.local`

**One key, whole system:**

```
MODEL_PRESET=gemini
GEMINI_API_KEY=...
```

Gemini Flash-Lite reads documents and words answers; Gemini Flash decides what applies. Presets also exist for `anthropic` and `openai`. Or route each job yourself:

| Key | What it is |
|---|---|
| `READING_MODEL` / `JUDGEMENT_MODEL` / `NARRATION_MODEL` | `provider:model` per job, e.g. `google:flash-lite`; overrides the preset |
| `DATABASE_URL` | Postgres connection string (Supabase in production) |
| `PINECONE_API_KEY` | Semantic search. Without it, retrieval falls back to Postgres full-text alone |
| `PLAN_PRICE_USD`, `PLAN_CHAT_TURNS`, `PLAN_DOCUMENTS`, `PLAN_HARD_STOP_USD` | Allowances shown on the Usage page; the hard stop halts model calls for the month |
| `RAG_EVIDENCE_WINDOW_CHARACTERS`, `RAG_MAX_EVIDENCE_WINDOWS`, `RAG_ANALYSIS_BUDGET_MS` | How deep one question is allowed to read |

The sidebar shows whether the database, the models and semantic search are up, and what to do if one is not.

## Commands

| Command | Does |
|---|---|
| `npm run db:check` | Verifies the database, every table and column, and how much is indexed |
| `npm run policies:index` | Re-reads every document's stored pages into benefit rules (also a button on the Benefits page) |
| `npm run policies:report` | What was captured, per document |
| `npm run typecheck` | TypeScript across the whole app |
| `npm run system:test` | System and database regressions against an in-process PostgreSQL |
| `npm run claims:test` | Claim rules, the nine-scenario claim-answer evaluation, death evidence, orchestration and the printed claim pack |
| `npm run eval:extraction` | Extraction recall against five real documents (24/24 today) |

Every one of these runs in CI on every push, plus the production build.

## What DearPolicy will and will not do

- Every figure carries the quote and page it came from, the cover it is paid under, and a label saying how far to trust it. Indicative figures are shown but never added into the total.
- A benefit written for an event that did not happen is ruled out, and the reason is said out loud rather than the row quietly vanishing.
- Two rows describing the same cover are counted once, never twice.
- A rule the wording does not clearly state is left for you to confirm — never guessed. "Whichever is lesser" rules are refused rather than settled at the larger figure.
- Money you pay (premiums, pro-ration factors, worked examples) is never read as money you receive.
- An incomplete read is reported as incomplete, never as "not covered".
- Nothing here is an offer, an admission of liability, or a decision by any insurer.

## Not done yet

- A policy's own schedule of defined critical illnesses is only known where its benefit table was read. Where it was not, the LIA 2019 list is the floor and the card says so.
- Waiting periods, survival periods, territorial limits and age limits are stored as conditions on the card rather than evaluated as rules.
- An accelerated rider that reduces another benefit is not yet modelled; both are shown.
- Filling an insurer's own claim form (needs a real form with fields to test against).
- Rules the five formula kinds cannot express (per-year aggregates, deductibles, co-insurance) are stored for review rather than calculated.
- Rotated pages and right-aligned amount columns have no fixture yet.
- The suites use an in-process PostgreSQL and a simulated model; the live Gemini path is verified by hand.

---

# History

# DearPolicy 0.8.2 — A Failure You Can Read

DearPolicy is a local-first family insurance workspace. It combines uploaded personal policy evidence, matching policy wording, structured conversation memory and locally hosted AI to answer policy and potential-claim questions without treating a brochure as proof of ownership.

## What changed in 0.8.2

### A failing API no longer blanks the page

The dashboard read `data?.coverages.filter(...)`. The optional chain stopped at
`data`, so when the API returned an error object instead of a portfolio the page
threw before it could render the error banner it already had — a white screen
instead of the reason. Every `data?.x.y` on the dashboard and coverage pages is
now guarded, a non-JSON or non-200 response becomes a readable message, and the
banner says what to do about it.

### `npm run db:check`

Answers "why did that 500?" in one command. Verifies `DATABASE_URL` is set,
PostgreSQL is reachable, every required table, column and extension exists, and
reports how many documents and benefit rules are indexed. Read-only, and it
names the exact command to fix whatever it finds.

## What changed in 0.8.1

### The payout rule is read straight from the cell

Reading the page as a table was only half the fix: the rule still had to survive
regexes written for prose, which is why `25% of S$5,000` — a cell stating its
own rule completely — was rejected for not saying "of the Sum Insured".

Schedule cells are a small closed grammar, so they are now parsed in plain code:

| Cell | Result |
|---|---|
| `25% of S$5,000` | **fixed S$1,250** — both halves are printed, so it needs nothing else |
| `100% of the Sum Insured` | 100% of the schedule amount |
| `Up to S$500 per incident` | reimbursement capped at S$500 |
| `S$30 per day` | daily rate, with the waiting period and cap taken from the same row |
| `Up to 30 days`, `As charged`, `Nil`, `S$500 minus the deductible` | left for review, never guessed |

A page whose schedule parses cleanly skips the model pass entirely, so indexing
is faster as well as repeatable.

Two conservative choices worth knowing: a reimbursement is only compared against
a bill its label actually names (an "Ambulance fee" row binds to the ambulance
bill; a row that names no expense stays unbound and asks), and a daily rate whose
row states no maximum is *not* treated as unlimited — it asks for the cap.

## What changed in 0.8.0 — the layout fix

### A benefit schedule is a table, and we were destroying it

`extractPdfPages` joined every PDF.js text item with a space. That threw away
the x/y position of each word, so a two-column page interleaved into nonsense
and a benefit row — *"Simple fracture — wrist | 25% of S$5,000"* — dissolved into
prose that nothing could tie back together. This is why the formula validator
almost never fired on real documents, and why nearly every answer came back
"needs checking" with no amount.

Positions are now kept. `lib/documents/layout.ts` finds the vertical gutters
between columns, reads each column top to bottom, groups items into lines, and
splits each line into cells on the wide horizontal gaps. It is geometry — no
model is involved.

Measured on a real 7-page insurer booklet:

| | Amounts found | Tied to a label |
|---|---|---|
| Before | 27 | 0 |
| After | — | **5 clean rows** |

```
2026 -> $689    2027 -> $717    2028 -> $745    2029 -> $775    2030 -> $806
```

That payout table was previously invisible.

Page text is stored with its tabs and newlines intact, so a document already in
the database can be re-read as a table without reopening the PDF, and every
exact-quote check still passes because quote matching normalises whitespace.
The benefit extractor now receives those rows as `tableRows` and is told to
trust them over anything it infers from prose.

Re-analyse a document, or re-run `npm run policies:index`, to pick this up.

## What changed in 0.7.0

### Ownership and amount are two different questions

DearPolicy had been conflating them. "A brochure never proves you own S$600,000"
is a rule about the **amount**. It was being applied to the **policy**, so
someone who uploaded their own welcome booklet was told it was reference
material and got nothing from it. People do not collect other insurers'
booklets; uploading one is a statement that you hold that cover.

There are now three states, not two:

| | Ownership | Amount |
|---|---|---|
| Personal schedule or certificate | proved | proved |
| **Declared — you said it is yours** | **taken as true** | **the document's own printed figure, labelled as such** |
| Nobody claimed it | not established | not established |

A document with no named policyholder now asks **"Whose policy is this?"** on
the Policies page, with a button per family profile. Once claimed, its benefit
rules are used in answers. A figure the document itself prints — "S$600 each
month" — is shown as that person's, labelled *"Amount printed in the policy
document — not yet confirmed against your own schedule"*, and deliberately kept
out of the headline household total until a schedule confirms it.

The one thing a declaration still cannot do is turn "100% of the Sum Insured"
into a number, because that sum is on a schedule nobody has uploaded. There the
answer says exactly that, and asks for it.

## What changed in 0.6.3

### "Cannot perform Construct on a detached ArrayBuffer"

PDF.js **transfers** the buffer it is handed and leaves the caller holding a
detached ArrayBuffer. DearPolicy reads a PDF twice — once for text, then again
to render the image-backed pages for OCR — so the second pass failed on every
document containing images, after text extraction had already succeeded. PDF.js
is now given its own copy. Reproduced against a real 7-page booklet with 3
image pages, and covered by a regression that fails if the copy is removed.

### A booklet's products are kept apart

One PDF often covers several products. Benefits were catalogued under the
document's single product name, so a rule belonging to one product could be
attached to another product's insured amount — which is how an accident rule
ended up quoted against a term-life death benefit. Each page's product section
is now tracked, and a benefit is filed under the product whose section it
appears in.

## What changed in 0.6.2

### Benefit rules are read during upload, not by a command

Indexing is now part of processing a document. After the PDF is read and the
coverage extracted, DearPolicy reads the benefit rules page by page and stores
them, reporting real progress the whole way ("Reading the benefit rules — page
12 of 40…"). Waiting is exactly what someone expects while a document is being
digested, and it means the first question is already fast.

Reprocessing a document rebuilds its rules. If indexing fails the document is
still fully usable — questions fall back to reading it when asked.

`npm run policies:index` remains, now as a one-time backfill for documents that
were uploaded before this version.

## What changed in 0.6.1

### It still talks like an assistant

Answering from a table should not mean sounding like one. Both answer paths now
end in a single short narration call that turns the validated decision into
ordinary speech: it reflects back what the person said happened, leads with the
figure, and explains in plain words what could still change it.

The split is the point. Application code decides who is covered, which benefits
respond and what they pay; the model only chooses the words, and every guard
still applies — it cannot introduce a number, drop a total, promise approval,
claim something is not covered, or ask its own question. So the decision is
byte-identical on every re-ask while the conversation stays human.

Where a fact is the only thing standing between a benefit and a real figure,
the chat now asks for that one fact instead of presenting a verdict.

## What changed in 0.6.0 — the important one

### The model now reads your policies once, not on every question

A policy is a contract with fixed rules. "Simple Fracture pays 25% of the
S$5,000 limit, page 14" is a stable fact about a document, not something to
rediscover each time somebody asks a question.

Until now DearPolicy re-read raw policy text with the local model on every
question. That is why answers took minutes, why the same question could give
different results, and why an answer depended on which passages retrieval
happened to return.

Now:

1. **Upload time (slow, thorough, once).** `npm run policies:index` reads every
   page of every document and stores each benefit in `policy_benefits`: its
   name, the events that trigger it, the payout rule, the page, and the exact
   quote that proves it. Take as long as it needs — nobody is waiting.
2. **Question time (instant, deterministic).** Resolve the person, work out what
   happened, look up the benefits whose triggers match, and calculate in
   application code. No model call. The same question gives the same answer.

A payout rule only enters the table when plain code can prove it from the quoted
clause — the same checks as before, now applied once at indexing. The triggers
are keyword rules, not a model decision, so a broken ankle can never surface a
death or disability benefit.

```text
npm run db:setup       # once, adds the benefit table
npm run policies:index # after uploading documents
```

If a household has not been indexed, questions still fall back to the old
read-at-question-time path, so nothing breaks before you run it.

### Do you still need the AI?

For reading documents, yes — every insurer lays out its wording differently, and
that is exactly what a language model is good at. For answering questions, no.
Matching an event to benefits and computing a payout is ordinary code, and it
belongs in code: it is faster, repeatable, inspectable and correctable.

## What changed in 0.5.4

### A wrong shape no longer costs a whole evidence section

Qwen returns `conditions` as a bare string, or a single quote where a list of one
belongs. One such field made the entire reply fail validation, so the section was
discarded, retried at double the output budget, and usually lost anyway — which
is both slower and less complete. `coercePolicyAnalysis` now normalises structure
before validation and drops only the elements that cannot be validated. Nothing
unquoted or unsupported is admitted: every surviving element still passes the
full schema and then `validateAnalysis` against the source passages.

A reply that was complete but misshapen is no longer retried with more room —
more room does not fix a wrong shape. Only genuine truncation is retried.

### Validation output never reaches the chat

A failed section reported its raw Zod error in the answer body. Causes are now
written in plain language — "the model ran out of room part-way through that
section", "the model timed out on that section" — and raw model text and
validation output are never surfaced.

### Duplicate benefit cards

The same clause extracted under two coverage ids rendered as two identical cards.
Cards that say the same thing are collapsed, and the reading prompt asks for the
benefit name the policy itself prints rather than a generic category.

## What changed in 0.5.3

### The cost of a reading call is the number of tokens it writes

Benchmarking on a fully GPU-resident model settled it: generation ran at a steady
49 tokens/sec for every variant, and the only thing that changed was volume — 105
output tokens for a trivial schema (2.1s) against 1198 for the real one (24.5s).
Stripping length and range bounds from the schema, attempted in 0.5.2, made no
measurable difference and has been removed rather than left in as folklore.

Verbatim quotes are the bulk of that output, and a quote only has to be long
enough for the application to locate the clause — `hasQuote` is a substring
match, so a short distinctive span proves exactly what a paragraph does. Quotes
are now capped at 260 characters instead of 900, evidence at two spans per
benefit instead of four, and every array and free-text field is tightened to
match. The prompt asks for the shortest span that proves the point.

`RAG_READING_OUTPUT_TOKENS` (default 900, was 1400) is now the single knob for
speed, and `RAG_MAX_EVIDENCE_WINDOWS` defaults to 8. Truncation is still salvaged
and retried, so a tight budget costs quality only on unusually rich sections.

## What was tried and removed in 0.5.2

The theory was that Ollama's JSON-Schema-to-grammar conversion expanded bounded
string lengths and numeric ranges into huge rules. Measured on the real schema,
the difference was 24.5s with bounds against 24.7s without — noise. The change
was reverted.

`npm run model:benchmark` reports output tokens beside every timing, which is
what actually predicts the cost.

## What changed in 0.5.1

### Model calls go where retrieval actually matched

Splitting a scarce call budget evenly across contracts meant a ten-policy
household spent most of it on contracts retrieval had already shown were not
responsive, and read the one contract that answers the question shallowly.

Retrieval and windowing still cover **every** contract — that is cheap SQL and
is what keeps the 900th policy reachable. Model calls are now allocated
round-robin in relevance order (lexical match first, then closest semantic
passage), so every candidate contract gets its best section read before any
contract gets a second, and spare budget deepens the strongest match. A contract
with no retrieved evidence never costs a call, and any contract left unopened is
named in the answer rather than treated as empty.

### Cheaper calls, and a way to measure them

`LLM_NUM_BATCH` now defaults to 256 rather than 64, and output per evidence
section is capped by `RAG_READING_OUTPUT_TOKENS` (default 1400) — generation,
not prompt processing, dominates the time per call. Truncated output is still
salvaged and retried, so a lower cap costs quality only on unusually rich
sections.

`npm run model:benchmark` times a real reading call, reports prompt and output
tokens/sec, says how much of the model is in VRAM versus on the CPU, estimates
how long a question will take, and recommends what to change. Read-only.

## What changed in 0.5.0

### The model is no longer reloaded for every evidence section

Every model call set `keep_alive: 0` and then explicitly unloaded the model. That
is correct between phases and ruinous within one: reading ten evidence windows
meant loading a 9 B model from disk ten times, which dominated the wall clock far
more than inference did. A phase now runs inside a model session that holds the
model resident (`LLM_KEEP_ALIVE`, default 5m) and unloads exactly once at the
end. The single-heavy-task GPU lock and the unload before OCR are unchanged.

### A question can no longer run unbounded

Reading is capped by call count (`RAG_MAX_EVIDENCE_WINDOWS`, default 12, shared
fairly across contracts so the first contract cannot consume the lot) and by
elapsed time (`RAG_ANALYSIS_BUDGET_MS`, default 5 minutes). Hitting either bound
leaves the remaining sections unread and says so — the completeness figures
already make that visible, and it can never read as an absence of cover.

Per-document depth is also more conservative: share 0.35, ceiling 16.

## What changed in 0.4.9

### A long message no longer breaks the turn

Every fact and scenario candidate repeated a 36-character UUID, which consumed a
large share of the model's output budget; a detailed message (fall, ankle pain,
ambulance, fracture, cast, bill) could exhaust it mid-JSON and lose the whole
turn. Subjects are now passed as short handles (`s1`) and mapped back in the
application, the interpretation budget is doubled, output that stops mid-JSON is
salvaged back to its last complete element, and a genuine shortfall is retried
once with a larger budget. If it still fails, the user gets a plain explanation
and a retry step — never a raw JSON dump in the chat.

### Thinking indicator

Local analysis takes real time, so the chat now shows animated dots, the current
stage, a progress bar (determinate once the contract count is known), contracts
read so far, and elapsed time. It respects `prefers-reduced-motion`.

## What changed in 0.4.8

### Retrieval depth now scales with the document

A fixed six passages per document was fine for a two-page schedule and far too
few for a forty-page multi-product booklet, where the responsive benefit table
often sits outside the top six. The per-document budget now scales with how much
text the document stores (roughly 40%, floor 6, ceiling 24) and is tunable with
`RAG_MIN_PASSAGES_PER_DOCUMENT` / `RAG_MAX_PASSAGES_PER_DOCUMENT`. Reading more
takes longer; that is the intended trade for not missing an owned benefit.

### A failed batch is no longer counted as text that was read

An evidence batch the local model could not finish was previously counted
towards review completeness. It is now excluded, the reported cause is shown,
and the answer tells you to retry rather than leaving silence.

### Stated reasons a claim amount could settle differently

When arithmetic is supported, the summary leads with the amount and then names
the specific reasons it could change — an outstanding policy definition, a fact
you have not confirmed, cover whose active status is unverified, a reimbursement
shown separately, or unread sections. These are derived from actual unresolved
checks, never a generic caveat.

### It asks instead of going quiet

A documentary condition now becomes the question when no ordinary missing fact
is outstanding. If a contract has no matching wording at all, DearPolicy asks
for the policy wording or benefit summary, because that is the blocker the user
can actually clear.

### Document linkage report

`npm run policies:report` prints, per family member, which documents are their
personal evidence, which wording was bound to each contract and why, and — for
every wording document that was not bound — the exact reason. Read-only.

## What changed in 0.4.7

### Measured evidence completeness

Every answer now reports how much of the stored policy text was actually read.
For each contract DearPolicy counts the documents that finished processing, the
pages and passages stored for them, the passages retrieval returned, and the
passages the policy reader actually read. The chat shows a **Complete policy
review** or **Partial policy review** banner with the exact figures, and the
per-contract table adds an "Evidence read" column.

That measurement is enforced, not decorative. A categorical negative conclusion
("not covered", "no cover", "uninsured") is permitted only when every processed
page of every contract in scope was read. If the local model produces such a
sentence while the review is partial, the explanation is rejected and the
validated application answer is used instead. An unread section is an
incomplete review, never proof that the event is uninsured.

### Policy currentness, separated from ownership

Premium receipts and renewal notices are matched to the *same* contract — by
document, or by policy/group number plus insurer, and always for the same
insured person. A receipt belonging to another person, policy or insurer never
verifies this contract.

Each contract then reports one of **Active status evidenced** or **Active status
not recently verified** (evidence older than 400 days, a passed renewal/expiry
date with no later receipt, or no payment evidence at all). This appears in the
portfolio table, in the policy review table and as a condition on each claim
item. It never changes ownership, a confirmed insured amount or a supported
calculation: a missing premium receipt cannot erase verified cover.

## What changed in 0.4

### Contextual conversation

Every turn is interpreted as a whole message with relevant saved facts and recent chat context. The system is not a fixed questionnaire: questions are derived from the clauses found for the selected person's actual contracts. A reply such as “I still don't know how many nights” is retained as pending and is not asked repeatedly. A missing hospital duration cannot block an independently supported critical-illness lump sum.

Reported facts are stored separately for each family member with their source quote, state (`known`, `unknown` or `pending`) and time. Narrow application-side checks reject unquoted numbers, invented medical definitions, false death language such as “almost died”, and an accidental cause that the user did not actually report.

Version 0.4.4 removed the required “Ask about” selector. Each message resolves the subject from an explicit full or preferred name, a relationship such as “my wife”, first-person language, or the prior resolved subject for a follow-up pronoun. A new explicit name switches context. Ambiguous relationships and unknown names produce a single clarification before any personal policy is loaded.

The event layer remains open-ended rather than a menu of canned scenarios. Qwen converts an actual reported event into broad, reusable traits such as death, injury, illness, hospitalisation, external violence, vehicle damage, theft, travel delay or maturity. A conservative grammar fallback also preserves directly reported conditions such as “caught dengue” when the local model returns a weak interpretation; it keeps the user's exact condition wording and does not infer a medical or policy definition.

When matching wording proves a supported formula, DearPolicy now shows the potential amount even if an eligibility definition still needs documentary confirmation. Uncertainty changes the label to conditional; it no longer erases the calculation. Independent additive lump sums are totalled by currency. Reimbursements are shown separately and are not freely added to the lump-sum total. If only a personal schedule is available, its insured amount is shown as a confirmed cover amount with an explicit warning that the payout rule has not been verified.

### Scalable household portfolio

DearPolicy groups schedules, certificates, endorsements and matching wording into contracts by owner, insurer, policy/group number and product. Database keyset pagination and bounded work batches have no user-facing policy-count limit. Each contract receives its own bounded retrieval and evidence review, so a global top-k cannot silently omit the 90th or 900th policy.

Combined documents are supported: when one PDF contains a personalised certificate in Part 1 and benefit wording in Part 2, the ownership evidence and reference sections are retained separately.

The inventory accepts diverse categories such as life, medical, critical illness, savings, endowment, investment, motor, travel, home and other plans. An unfamiliar type is handled from its uploaded clauses rather than forced into a prewritten answer.

### Evidence and calculation boundaries

- Personalised schedules/certificates establish ownership and personal insured amounts.
- Matching wording explains benefits, definitions, conditions and exclusions but cannot establish ownership.
- Qwen extracts candidate clauses and requirements with exact quotes.
- Qwen classifies the reported scenario into open-ended event candidates and controlled traits, separately from user facts and policy conclusions.
- The application validates those quotes, contract/product identity, currencies and owned coverage IDs.
- Application code calculates only supported, source-proved formula shapes: insured-sum percentage, fixed amount, expense cap and daily benefit. Complex or ambiguous formulas remain unresolved.
- Every benefit is assessed independently and remains a potential assessment, not insurer approval.
- Known contradictions rule out only the affected benefit. Missing or documentary conditions do not hide an otherwise calculable potential amount.

### Real analysis progress and chat controls

Policy analysis runs as a persisted background job. The chat shows the actual stage and number of contracts reviewed while the local model works. Oversized legacy passages are split at safe text boundaries and assessed in bounded windows instead of being discarded and reported as a model failure. Saved chats can be reopened or deleted individually, and all chat history can be cleared without removing family profiles or uploaded policies. Revision and history-epoch checks prevent an in-flight answer from restoring a deleted chat.

## Local stack

- Next.js 16, React 19 and TypeScript
- PostgreSQL with pgvector
- Ollama with Qwen3.5 9B and BGE-M3
- PaddleOCR-VL 1.6 for scanned/image-only pages
- local filesystem document storage

The existing global Ollama lock, model switching and zero-keepalive behaviour remain in place for an 8 GB GPU: only one heavy local-model task is admitted at a time, and models are unloaded between phases.

## Install or update

```text
npm install
INSTALL-OCR.cmd
npm run db:start
npm run db:setup
npm run dev
```

Then open `http://localhost:3000`. Existing policy documents do not need to be uploaded again. See `UPDATE-GUIDE.txt` for Windows copy-and-run instructions.

## Verification

```text
npm run typecheck
npm run ocr:test
npm run claims:test
npm run system:test
npm run build
```

`system:test` uses a disposable in-process PostgreSQL/pgvector database and simulated, schema-valid Ollama responses. It verifies real SQL, API orchestration, persistence, deletion, account isolation, 90/900-policy retrieval, review-completeness accounting and premium-evidence binding without touching the user's database or GPU.

## Scanned policies

Double-click `INSTALL-OCR.cmd` once. It creates an isolated private Python environment inside `paddleocr-service`; users do not need to activate it or type Python commands. DearPolicy continues using reliable native PDF text and invokes OCR only for image-backed pages with no usable text. Password-protected PDFs are rendered temporarily after authentication, and the password is never placed in a process argument or stored.

Before OCR, DearPolicy unloads Qwen and BGE-M3 under the existing global GPU lock. PaddleOCR exits when the affected pages are complete, after which Qwen and BGE-M3 load normally on demand.

## Conservative limits

- OCR text remains evidence that must be source-verified; uncertain amounts, dates and policy numbers must not be silently treated as confirmed facts.
- A policy can be reviewed only as far as the uploaded, successfully processed documents allow.
- No software can know a policy “100%” from missing or ambiguous evidence; DearPolicy reports what was reviewed and what still needs a document/check.
- Final admissibility and payment remain with the insurer.

PDF.js remains pinned to 6.2.108 to address the malicious-PDF JavaScript-execution advisory reported by `npm audit`. DearPolicy requires Node.js 22.13 or newer.

# DearPolicy Architecture

## Product boundary

DearPolicy is an insurance evidence and workflow system, not an insurer adjudicator and not a generic chatbot. It runs on Vercel with Postgres on Supabase, semantic search on Pinecone, and Google Gemini for every model call. It keeps four things distinct:

1. personalised evidence that establishes ownership and insured amounts;
2. wording that establishes policy rules for the matching contract/product;
3. event facts explicitly reported by a user or verified document;
4. application-side calculations that are authorised by validated wording.

No one layer is allowed to silently substitute for another.

## Deciding what a benefit pays

The layer that decides whether an answer is right, in the order it runs.

**Claim events (`lib/insurance/claim-events.ts`).** A closed vocabulary of the
kinds of claim a contract is written for: a death, a terminal diagnosis, a
defined critical illness, total and permanent disability, an accidental injury,
a hospital stay, an operation, a medical bill, lost income, a need for care,
property or motor, travel, liability, a policy maturing. Both sides speak it.
`benefitTriggerEvents` reads a benefit's trigger from its own name first and
falls back to the quoted clause only when the name names no once-only trigger,
because a critical illness clause routinely mentions death in passing and that
is not a death benefit. `reportedClaimEvents` reads what happened from the
stored facts in the same vocabulary.

`ruledOutByEvent` then rules out a benefit whose triggers are all causes, none
of which happened. Hospital stays and bills are excluded from that gate by
design: they are consequences that can follow almost any event, so they stay
questions rather than filters. The gate is silent while nothing is known, and
generous where the facts are thin — an unnamed illness still reaches the
critical illness benefits — so it only ever closes a door it is certain about.

**Defined conditions (`lib/insurance/defined-conditions.ts`).** A critical
illness benefit pays for a condition its schedule names, not for severity.
`matchesPolicySchedule` checks the diagnosis against the household's own
critical-illness benefit rows, which ARE that plan's schedule where its table
was read; `definedConditionsFor` falls back to the LIA Critical Illness
Framework 2019. The policy wins, because the policy is the contract, and the
card says that the standard list is a floor.

**Cover identity and composition (`lib/insurance/cover-composition.ts`).**
`coverKey` is the policy number the insurer settles against together with the
product, because a Singapore group scheme puts several covers under one master
number. `resolveCoverOverlaps` treats two benefits in one cover paying on one
event as alternatives when they compute from the same sum insured or arrive at
an identical figure — never when one is a smaller fixed grant, which really is
paid as well. The kept figure is the one from the person's own certificate; the
other stays visible and stops being counted. Only then is a total struck.

All three answer paths run this: rules stored at upload, schedule lines with a
standard rule assumed, and benefits read live out of the document.

**5. What the cover does not pay.** `lib/insurance/cover-conditions.ts`, applied
by `applyCoverConditionsToAnswer` in `lib/chat/workflow.ts` immediately before
the overlaps are settled, so a benefit the cover cannot pay is never the one
chosen to represent the others.

The conditions themselves are read in their own pass —
`lib/policies/condition-catalog.ts`, run over every page alongside the benefit
pass and stored in `policy_cover_conditions` against a cover rather than a
benefit row. The benefit pass gives up on a page as soon as its table parses
(`parsedHere>=2`) and correctly returns nothing on a page of pure prose, so
before this the exclusions were read and thrown away: seventeen pages of one
benefit summary yielded fifty-three rules and not one condition.

`conditionIsDecidable` is the distinction the layer turns on. A waiting period,
a survival period, a notice period, an aggregate cap, a sub-limit and a
payment precondition are arithmetic on facts already held, so they change the
figure. An exclusion is a question about the cause of a loss, which no claim
conversation establishes, so it is stated beside the figure and can never
reduce it. `time_bar_from_inception` is the hybrid the documents actually
write — suicide within twelve months of commencement — where the window is
arithmetic and the cause is not.

A condition the facts satisfy returns `clear` and is dropped entirely rather
than shown. That is deliberate: an answer carrying every condition a policy
states is an answer nobody finishes reading.

`scripts/claim-answer-eval.ts` asserts the end result — which benefits respond,
which do not, which are blocked by a condition and what is said about the rest,
and what the total is — for sixteen real household scenarios, with no model in
the loop, in CI on every push.

## Document ingestion and OCR

### Page layout

A benefit schedule is a table, so the page is read as one. `renderPageLayout`
keeps each text item's x/y, detects column gutters as vertical strips with no
ink and text on both sides, reads each column top to bottom, groups items into
lines by baseline, and breaks a line into cells at wide horizontal gaps.
`benefitRows` then takes any line whose second-or-later cell is a short value
containing money or a percentage — including "Up to S$500 per incident", which
is how limits are actually written.

Stored page text keeps its tabs and newlines, so `linesFromStoredText` recovers
the same table from the database without reopening the PDF, and exact-quote
validation is unaffected because it normalises whitespace. No model takes part
in any of this.

PDF.js transfers ownership of the byte array it is given, so `extractPdfPages`
passes it a copy: the same bytes are needed afterwards to render image-backed
pages for OCR, and a detached buffer made every image-bearing PDF fail after its
text pass had succeeded.

PDF.js extracts the original embedded text first and records whether each page is image-backed. Pages with usable native text are never sent through OCR. An image-backed page without usable text is rendered temporarily and passed to the private PaddleOCR-VL 1.6 bridge; the resulting text replaces only that page and retains the original page number.

Password-protected PDFs are authenticated before temporary rendering. The password travels to the private bridge over stdin, never in command-line arguments, and is not stored. Temporary PDFs and page images are removed after every run.

Missing OCR support, unreadable output and timeouts become visible policy-processing errors rather than silently indexing empty text.

OCR is transcription, not authority. Its output still passes the same exact-quote, person, contract, currency and coverage validation as native text before it can support a payout calculation.

## Narration

`narrateAnswer` is the last step of both answer paths and the only model call at
question time on the catalogue path. It receives the already-decided packet —
totals, benefits, qualifiers, the one question worth asking — and returns prose.

Every guard from the previous explanation layer still runs, and the narration is
discarded wholesale if any fails: exact formatted totals must survive verbatim,
no numeric token may appear that is not in the packet, no approval language, no
categorical negative-coverage claim unless review completeness permits it, and
no question mark, because the interface renders the question separately.
Temperature is non-zero deliberately: the decision is deterministic, the wording
need not be.

## Reading a schedule row

`lib/policies/benefit-rows.ts` parses the "what it pays" cell of a benefit row.
Once a page is read as a table the rule is no longer buried in prose — it is a
short cell beside the benefit name — and those cells form a small closed grammar
that plain code handles: percentage of a limit printed in the same cell (which
resolves to a figure immediately), percentage of the sum insured, a cap, a
periodic rate, or a flat amount. A cell outside the grammar returns null and the
row is left for review rather than guessed at; deductions and ranges are
rejected outright.

`catalogueDocument` runs this pass first, and a page yielding two or more parsed
rows skips the model entirely. `expenseFactKey` binds a reimbursement only to a
bill its label names, and `dailyLimitsFrom` takes a waiting period and cap from
the row's own text — a daily rate with no stated cap is treated as incomplete,
never as unlimited.

## Benefit catalogue: read once, answer from the table

The expensive, non-deterministic work is moved from question time to upload
time. Cataloguing runs inside document processing, between coverage extraction and
finalisation, reporting per-page progress through the existing
`processing_stage`/`processing_progress`/`processing_message` columns. It is
wrapped so that a failure never fails the upload: the document stays usable and
questions fall back to reading it at question time.

`lib/policies/catalog-builder.ts` is the only place the model reads raw
policy wording: page by page, with a small flat schema, it extracts each named
benefit with one short proving quote and a candidate payout rule.

Benefits are filed under the product section of the page they appear on, using
the same `pageProductScopes` tracking the retrieval path uses, so a multi-product
booklet cannot attach one product's rule to another product's insured amount.

Three checks run in plain code before a row is stored: the quote must appear
verbatim on that page; `validateCatalogFormula` must be able to prove the rule
from the quote itself (the same guards that previously ran per question); and
the triggering events are derived by keyword rules, never by the model. A clause
that does not clearly state a supported rule is stored with no formula and
flagged for review rather than guessed at.

At question time `assessContractFromCatalog` matches the reported event's traits
against the stored benefit traits, binds each match to a coverage the person is
proved to own, and calculates the amount. No model call, no retrieval, constant
time in the size of the documents, and the same input always produces the same
output. The catalogue is derived data: rebuilding it deletes only benefit rows
and never touches documents, pages, chunks or confirmed coverage.

The read-at-question-time pipeline below remains as the fallback for a household
that has not been indexed yet.

## Contextual request pipeline

1. Resolve the account and relevant family member(s) from the message. Explicit full/preferred names and relationships override conversational context; first-person language maps to the unique account holder; follow-up pronouns reuse the resolved subject. An ambiguous or unknown person produces a choice before any personal policy is loaded.
2. Load the saved conversation revision, structured facts and a bounded recent-message window.
3. Ask the reading model to interpret the whole current message into an intent, search terms, quoted fact candidates and broad scenario candidates.
4. Validate candidates in application code: subject binding, exact quote, numeric/date provenance, known/unknown/pending state, terminal-event hierarchy and causal-death safeguards. Store scenario candidates separately from facts so semantic matching cannot silently become policy eligibility.
5. Load the complete selected inventory using 200-row keyset work batches. The batch size is not a policy limit.
6. For a portfolio request, return the deterministic contract ledger without sending the whole portfolio to a model.
7. For an evidence question, retrieve bounded candidates independently for every contract/document using PostgreSQL full-text search and semantic similarity (Pinecone). Keep only lexically matched or sufficiently close semantic passages for model reading; an omitted/unmatched section remains an incomplete review, never proof of no cover.
8. Split any oversized legacy passage at text boundaries, then ask the reading model to extract candidate benefits, observations, conditions and material requirements from small source windows with exact quotes and owned coverage IDs.
9. Validate every extracted quote, number, currency, coverage ID and product-section binding. Evaluate each benefit independently. A scenario candidate may keep a benefit in consideration, but supporting claim evidence must still confirm the policy definition.
10. Calculate only source-proved formula shapes in application code. No model ever performs the payout arithmetic. Missing or documentary conditions make the result potential rather than suppressing a valid calculation; a known failed condition removes that benefit's amount.
11. Aggregate only distinct additive amounts in the same currency. Reimbursement estimates remain separate to avoid implying duplicate recovery. Each calculated amount carries the specific unresolved checks that could change the settled figure, so the answer states reasons rather than a generic caveat.
12. Optionally ask the narration model to explain the bounded validated packet. Reject new numbers, omitted payout totals, questions or claim-approval language.
13. Atomically save the user turn, answer, structured state and new conversation revision.

## Ownership basis

Ownership and insured amount are separate questions and are answered separately.
`PolicyContract.ownershipBasis` is `evidence` when a personalised schedule or
certificate proves ownership, and `declared` when the person linked the document
to themselves through the Policies page (`policy_members.source='user_declared'`).
A declared document forms a contract and its catalogued benefits are used; a
document nobody has claimed forms none. Evidence always outranks a declaration
for the same document.

For a declared contract there is no coverage row, so a benefit pays only what the
document itself prints. Those amounts carry an explicit label, and are given
`aggregation: "reimbursement"` so they are never summed into a headline household
total. A `sum_insured` rule stays uncalculated and names the missing schedule,
because a percentage of an unknown sum is not a number.

## Evidence hierarchy and contract binding

Document authority is explicit. Endorsements/amendments supersede matching lower-authority values instead of being added to them. Personal schedules and certificates may establish ownership. Policy wording, riders, benefit guides and product summaries may support rules only when insurer plus policy/group/product identity match the owned contract. Another family member's personalised schedule is never reference wording.

A combined certificate is not flattened into one evidence class: personalised Part 1 can establish ownership while generic Part 2 sections can support rules for the same product. Confirmed coverage rows enrich product matching for their own document, but never create ownership for a reference document.

A multi-product booklet is tracked by product section across pages. If the relevant section cannot be established, it cannot authorise arithmetic.

## Evidence completeness accounting

Retrieval is bounded by design, so "nothing was found" and "nothing is there"
are different statements and are tracked as such.

`lib/policies/review-coverage.ts` computes, per contract: documents grouped and
how many finished processing; pages and passages stored for the processed
documents; passages returned by retrieval; and passages actually read by the
policy reader after semantic/lexical filtering and windowing. Windowing splits a
stored passage into `id#part-n` fragments, which are folded back to one passage
so a split cannot inflate the count. Page numbers restart per document, so a
page is identified by document plus number.

A contract is `full_text_reviewed` only when every grouped document is ready,
matching wording exists, no evidence batch failed, and every stored page and
passage was read. Otherwise it is `partial_retrieval`, `no_wording` or
`not_processed`. The answer-level summary is complete only when every contract
is, and `negativeConclusionPermitted` gates any categorical statement that a
benefit or cover is absent — including a guard that rejects generated prose
containing such a claim while the review is partial.

## Structured-output recovery

Subjects reach the interpretation model as short handles (`s1`, `s2`) and are
mapped back to family member ids in the application, so no UUID is ever spent on
output tokens and no handle can leak into saved state. When structured output
stops mid-document, `repairTruncatedJson` cuts back to the last complete array
element — tracking string and escape state, and treating a comma as an element
boundary only inside an array — and closes the open containers. A shortfall is
retried once with a doubled output budget. Output that is merely malformed is
not retried, because the same call will not improve.

## Retrieval depth

Each document receives its own passage budget from `passageBudget`, scaled to
the number of passages it stores (share 0.4, floor `RAG_MIN_PASSAGES_PER_DOCUMENT`
= 6, ceiling `RAG_MAX_PASSAGES_PER_DOCUMENT` = 24) and never exceeding what the
document holds. The budgets are passed into the retrieval query as a parallel
array so each document's LATERAL limit is its own. A per-document budget, rather
than one global top-k, is what keeps the 900th policy reachable while still
reading a long booklet properly.

Only windows the policy reader actually completed count towards review
completeness. A window that failed is recorded as a failure with its reported
cause, never as text that was read.

## Policy currentness

`lib/policies/currentness.ts` derives payment/renewal recency deterministically
in application code. Premium evidence binds to a contract only through one of
its own documents, or a matching policy/group number with a matching insurer,
and only for the contract's own insured person. The resulting state is one of
`verified_recent`, `not_recently_verified`, `expiry_date_passed` or `unknown`;
a receipt newer than a printed expiry date outranks that date.

Currentness is reported alongside ownership and never substituted for it. It
does not change `confirmed`, coverage amounts, benefit assessment or any
calculation; it only adds a visible condition and a next step.

## Formula engine

The general engine supports only validated formula shapes:

- percentage/full sum insured;
- explicit fixed benefit;
- actual eligible expense capped by an explicit limit;
- daily rate with a proved start day and maximum day count.

Complex deductions, co-insurance, bonus/projection calculations, conflicting clauses and cross-currency conversions remain unresolved. Existing specialised MINDEF/MHA regression rules are retained for backward compatibility, but the active contextual pipeline is clause-driven rather than a fixed product questionnaire.

## Conversation and uncertainty memory

`chat_conversations.state` stores facts per subject with a value, state, exact quote, source and timestamp. Facts can be `known`, `unknown` or `pending`. A later correction replaces an earlier fact; a reported death remains the terminal event unless the user explicitly corrects that the person is alive. Relative dates are resolved against the user's time zone and initial-message timestamp.

Direct homicide wording is stored as reported death, cause and location when present. It is deliberately not converted into an accidental-death fact; that classification requires matching policy wording and documentary support. Direct condition-report grammar (diagnosed with, tested positive for, caught, contracted and equivalent factual forms) provides a conservative fallback when model extraction is incomplete. It preserves the reported condition and never assigns a policy medical definition.

`chat_conversations.state.scenarios` stores open-ended labels plus a controlled set of event traits. This is an event ontology, not a list of canned answers or products. The same mechanism supports illness, injury, property, motor, travel, liability, savings and unfamiliar future categories. The policy reader still has to find the person's actual responsive clause.

Unknown facts are retained so they are not asked repeatedly. A requirement marked unknown for one benefit does not block an independent benefit.

## Tolerating model shape errors

A small local model reliably gets the JSON shape slightly wrong: a bare string in
place of a list of quoted conditions, a lone object where a list belongs.
`coercePolicyAnalysis` normalises those structures and then validates each
element independently, keeping what parses and discarding what does not, so one
bad field costs one element rather than the whole section. This is a structural
repair only — it admits nothing unquoted, and every surviving element still goes
through the full schema and `validateAnalysis` against the source passages.

`structuredCompletion` distinguishes a reply cut short from one that is complete
but misshapen, and retries with a larger output budget only in the first case.
`readableModelFailure` converts any failure into plain language; validation
output and raw model text never reach the answer.

## Reading cost

One evidence section is one structured model call, and its wall-clock cost is
output tokens divided by the model's generation rate. Measurement on a
GPU-resident 8B model gave a flat ~49 tokens/sec across schema variants, so the
only controllable term is how much the model writes. Constraining the generation
grammar (removing length and range keywords from the schema) was measured and
made no difference.

The schema is therefore written as an output budget. Quotes are capped at 260
characters because `hasQuote` is a substring match and a short distinctive span
validates exactly as well as a paragraph; evidence is capped at two spans per
benefit, and every array and free-text field is sized to match.
`readingOutputTokens` caps `num_predict` per section, and truncated output is
salvaged and retried, so the cap is a target rather than a hard failure.

## Reading bounds

`lib/policies/relevance.ts` decides where those calls go. Retrieval scores every
passage of every contract, so contracts are ranked by lexical matches first and
closest semantic distance second, and windows are allocated round-robin in that
order: each candidate's best window before any candidate's second. A contract
with no retrieved evidence is never allocated a call, and contracts left
unopened are counted and reported. Retrieval itself remains per-contract and
exhaustive, so this is a spending policy for model calls, not a global top-k
over evidence.

`readingBudget` bounds one turn's reading: a maximum number of evidence windows
(shared as an equal per-contract allowance, minimum one each, so a large
household still reaches every contract) and a wall-clock budget. Whichever binds
first stops the read; the unread sections are reported through the existing
completeness figures rather than silently dropped.

## Async work

`chat_analysis_jobs` stores queued/running progress, final results and failures. The UI polls real stages and contract counts. Model calls are bounded in context and output, run concurrently within one turn's reading budget, and are charged against the spend ledger before they are made.

## History deletion safety

One-chat deletion cascades to its messages and jobs. Profile or account clearing removes conversations, messages, legacy guided sessions and jobs in that exact account scope. It does not touch policies, coverages, pages, chunks or stored files.

Every worker holds both a conversation revision and profile/account history epochs. Before committing, it locks and rechecks those tokens plus its running job row. Consequently, deleting or clearing history while analysis is running cannot recreate the conversation afterward.

## Scale properties

- Policy inventory: keyset pagination until exhaustion; no household-count constant.
- Retrieval: bounded top passages per document, not one global top-k across the household.
- Model context: bounded facts and evidence windows; the complete ledger stays in PostgreSQL/application memory rather than one prompt.
- History: keyset pagination for conversations and messages.
- Supported categories: evidence-driven and open-ended, including protection, savings/endowment, investment, motor, travel, home and future categories.

# Developer: trace and smallest-repair proposal on C0

Candidate: C0 `4956588a4e2cae948809e34d78d3b728a99a96ed` (branch `claude/pr57-followup-pgaq7d`).
Evidence: the fx-live-2 run record (`docs/rag-migration/live/RUN-fx-live-2-2026-10-20T02-39-03/`, saved
`responses.jsonl` and `answers.json`), the C0 source, and three suites run on C0 (Node 22.22.0, scripted model,
no model call, no spend). Nothing below is implemented yet; it waits for the Critic.

Revised after the Critic's round-1 findings (`claude/pr57-critic-bfg8to` @ `52880bf`, `critic/FINDINGS.md`) and Policy QC's
findings on C0 (`claude/pr57-qc-mv65td` @ `b6a7a96`, `qc/FINDINGS-C0.md`). The Critic's H1 and H2 come first: they can
change a claimable amount; the usefulness gaps follow.

## Repair plan in priority order

| # | finding | repair (product code) | file |
|---|---|---|---|
| P1 | Critic H1: loose cue ("...too. It was not serious.", "I mean, he fell", "rather than fell") moves Grace's event to Daniel and deletes it from her | A person correction must be explicit about the people: a mix-up phrase ("mixed them up", "wrong child/person"); or "I meant / it was / actually it was" followed directly by the new person's name; or a negation/contrast bound to the FIRST person's name ("not Grace", "rather than Grace", "instead of Grace", "Grace didn't / wasn't"). The destructive paths (`moveClaimTo`, `supersededNow`, the `claimFor` move) use only this check, resolved against household names, not the loose cue | `lib/rag2/loop/loop.ts` (`PERSON_CORRECTION` and its five call sites) |
| P2 | Critic H2: "She felt sick and fainted, hitting her head" withholds an accident benefit and says its condition is not met | `causeFit` reads "illness" only when the person's reports carry no injury words (injur*, fractur*, broke/broken, hit, fell/fall, slip, trip, cut, burn, sprain, wound). With both, the cause is unresolved: the benefit keeps its terms, its printed accident condition is quoted, and no verdict is given. A pure illness report keeps today's answer, plus "the insurer decides" | `lib/rag2/loop/loop.ts` (`causeFit`) |
| P3 | Critic M1: a row's own footnote never stops the amount ("broke her toe" on the Leg^ row) | When the row's printed footnote says something is not covered and a content word of the reported case (the household's words) appears in that footnote, `lump_sum` returns no amount for that row (unlisted case, the footnote quoted) | `lib/rag2/calc/tool.ts` (after `rowNotesOf`) |
| P4 | Critic M2: absence passes over unreadable pages | `checkNotFound` refuses when any stored page of a scoped document is empty or fewer pages are stored than the document has | `lib/rag2/loop/absence-scope.ts:176` |
| P5 | Critic M3: topic word skipped when it is in the product name | Product-name words are skipped only for `document_silent`; for `benefit_not_found` the topic's own words are always searched | `lib/rag2/loop/absence-scope.ts:171` |
| P6 | Repetition (K3t1, K4b) | R1 below | `lib/rag2/loop/statement-render.ts` |
| P7 | Critic M4: a new upload does not withdraw a `library`/`subject` absence answer | Withdraw such an answer when the scope's document set differs from the one saved in `absenceChecks` | `lib/chat/stale-answers.ts` |
| P8 | Critic L1: reopened figure accepted anywhere in the block | Require the matched figure's position to lie inside the record sentence's span | `lib/chat/monetary-boundary.ts:369` |
| P9 | K2.3 and QC Q2 | R2 below (lists Living Care and Living Care Plus, both undescribed) | `lib/rag2/loop/loop.ts` (`causeFit`) |
| P10 | env contract red | R3 below | `.env.example` (docs) |

P1 to P6 are the proposed C1. P7 to P10 go in only if the Critic agrees they are small enough; otherwise they are listed
as open. Each needs a test that fails on C0, which the Test engineer owns: H1's three "too" messages plus a true
correction; H2's sick-then-injured report plus a pure "she was sick"; M1's toe on the Leg^ row; M2 a document with
one empty page; M3 a "Dental" product with terms ["dentist"].

Not repaired, for DC or the release notes:

- QC Q1: the S$120,000 alternative omits its own printed condition (BS p8 "can only be claimed either under the Core
  Scheme or Voluntary Scheme") and the S$5,000 table is the Voluntary Scheme's summary. Showing a benefit's own printed
  conditions with every illustration is a wider rendering change; I recommend it as the next change, not this round.
- QC Q3 (K4b cannot show recomputation because both people hold S$600,000): a test gap for the Test engineer.
- QC Q4/Q6, Critic L2 (footnotes cut after three lines; footnotes not under the last row are not attached), K6a, K6c:
  release-note limitations.

## Original summary (usefulness gaps and red suites)

| item | where it breaks | proposal | product change |
|---|---|---|---|
| Repetitive fracture answer (K3t1, also K4b) | `lib/rag2/loop/statement-render.ts` `renderStatements`: the server appends its two relation notes even when the model already wrote its own | R1: the server's relation notes supersede model-written relation statements | yes, one function |
| K2.3 sickness answer silent on other listed cover | `lib/rag2/loop/loop.ts` `causeFit`: the illness path states why the accident benefit fails and nothing else | R2: one server-written absence sentence for the person's other listed cover that no page describes, through the existing absence-scope check | yes, small |
| K6a limitation before the amount | model order of statements; the review found the limitation in the answer and read first | none | no |
| K6c "the policy definition" | model-written uncertainty clause; the verifier sets uncertainty clauses aside by design | none (a fix would be a phrase rule) | no |
| `security:env-contract-test` red | `.env.example` lacks 34 names (33 read only by scripts/tests, plus `DEARPOLICY_CHAT_CONTRACT` read by `lib/rag2/loop/loop.ts` and 24 more) | R3: document them in `.env.example` | no (docs) |
| `v11:customer-screens-test` red | the test, not the page | Test engineer | no |
| `rag2:s52-replay` red | the test expectation, not the product | Test engineer | no |

## Trace

### Repetition (K3t1 turn 1; K4b turn 2 has the same shape)

The saved model call `A/K3t1#3` (`responses.jsonl`) sends four statements: two `calculation` statements and two
`uncertainty` statements written by the model:

1. "Grace's documents give different alternatives for this event, and do not establish which applies; the amounts are not to be added together." (evidence e16, e17)
2. "The Product Summary and Certificate of Insurance Part 2 use different bases for their fracture percentages, and the uploaded documents do not establish which document governs this event." (e16, e17, e32, e33, e34)

`renderStatements` (statement-render.ts, the block after "Two documents of one scheme printing a percentage table")
then finds two percentage-schedule records of different documents for the same person and appends its own two
notes (`note1` frame, `note2` bases and standing). Its guard `already` only looks for an earlier *server* note
(`RELATION`), so the model's two sentences stay and the visible answer says the relation three or four times.

### K2.3

The saved answer is one server-written `fact` from `causeFit` (loop.ts, "is printed with an accident condition").
For `cause === "illness"` it replaces the accident benefit's terms and adds nothing about other cover. The
person's certificate lists Group Living Care at S$350,000 with no page describing it. No product path says that.

### K6a and K6c

K6a: the model ordered `not_found` before the `fact` (`A/K6a#2`). The limitation is read first and is complete;
the reviewed grader already accepts the window. Moving statements by matching the topic text to the benefit name
would be a text heuristic for an ordering preference.

K6c: the model wrote an `uncertainty` statement, "do not establish whether Grace's cancer meets the policy
definition or what amount would be payable for it" (`A/K6c#2`). `withoutUncertainty` (statements.ts) sets the
"do not establish whether" clause aside before the topic check, by design (V1.4). Dropping the sentence would
lose the limitation the answer needs; rewriting it would mean a rule about the word "definition". One wording,
one attempt, no wrong fact. I propose recording it as an accepted wording gap, not a product change.

### The three red suites (run on C0 here)

- `v11:customer-screens-test`: 10 passed, 1 failed at `scripts/v11-ux-customer-screens-regressions.ts:168`,
  `assert.match(chat, /nextSteps\[0\]/)`. `app/chat/page.tsx:307` and `:385` now render `steps[0]` from
  `uniqueSteps(message.answer?.nextSteps)`, a deliberate change in `df8577b` ("show every saved next step").
  The assertion is stale.
- `rag2:s52-replay`: 11/12. S52A#0 adds three sentences, the expectation lists two. The third is
  "The policy wording says reasonable costs of returning the remains to Singapore are reimbursed up to 2,000
  (printed with a "$" sign; the document does not say which currency)." That is the currency-silence behaviour
  the same replay's own S52A check requires (the bare $2,000 no longer attributed as S$). The expectation is stale.
- `security:env-contract-test`: fails on 34 names, as on main.

## Proposed repairs

### R1. Server relation notes supersede the model's own relation statements

In `renderStatements`, at the point where the server pushes `note1` and `note2`, drop each model-written statement
that meets every condition:

- kind `uncertainty`, not server-rendered (`!RENDERED.has(s)`);
- same subject as the two records (or no subject);
- its evidence ids resolve to passages of the two relation documents only, and include at least one passage of each;
- it carries no figure (no money, no percentage).

Record each drop in the trace as superseded (not as a verification failure). Statement order stays: the two
calculations, then the server frame and bases note.

What it changes: post-model composition only. Model inputs and tool behaviour are unchanged. Not phrase-based:
the rule is about which documents a figure-free uncertainty cites, at the moment the server states the same
relationship from the records.

Risk for the Critic: a model uncertainty that cites both documents but says something else (for example a
shared condition) would also be dropped. Conditions normally come as `benefit_terms` or a question, not as an
uncertainty citing both schedules, but this is an assumption to challenge.

Acceptance (for the Test engineer to write so it fails on C0): replaying `A/K3t1#3` and the K4b turn-2 call,
the visible answer contains the relation once (server frame plus bases note), both illustrations, no total,
and nothing else changes in the other fx-live-2 conversations.

### R2. Sickness answer names other listed cover that no page describes

In `causeFit`, only when `cause === "illness"` and at least one accident benefit was set aside: for the same
person, find benefit records whose status is not resolved because no page describes their terms (listed on a
certificate only), with no accident condition. Add one `not_found` statement (claim `document_silent`) for them,
written and checked by the existing `checkNotFound` in `absence-scope.ts`, so the scope is read from the full
text and the absence cites no passage. It names the benefit and its dated listed amount only as listed, never
as cover for the illness.

What it changes: tool-loop composition on the illness path. No prompt or model-input change.

Risk for the Critic: this is the only repair that adds a sentence the household did not ask for. The question
was "does her accident cover pay anything?" and the expected answer pre-registered `K2.3`; it must not suggest
Living Care pays for sickness, and must not fire when no such record exists.

Acceptance: K2 answer says the certificate lists Group Living Care and no page describes it; no amount for
sickness, no question; an illness answer for a person without such a record is unchanged.

### R3. Document the 34 environment names

Add the 34 names to `.env.example` with scope (test / script, or chat contract for `DEARPOLICY_CHAT_CONTRACT`),
default and "not a secret". Documentation only; no runtime configuration changes. I will do this unless the
coordinator assigns it to the Test engineer.

## Not proposed

No change for K6a or K6c (above). No prompt change, no new feature, no paid call. The tests for R1 and R2 and
the two stale test expectations belong to the Test engineer.

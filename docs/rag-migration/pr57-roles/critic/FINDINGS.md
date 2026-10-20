# PR #57 critic findings

Role: Critic/reviewer (findings only; no product code, tests or shared files edited).
Candidate: C0 = `4956588a4e2cae948809e34d78d3b728a99a96ed` (main head, verified with `git fetch origin main` on 20 Oct 2026 05:21Z).
Scope of round 1: the product-code part of `f3c9bcd..4956588` (20 files, +788/-54 under `lib/` and `types/`). Tests, fixtures and docs were read only where a finding needed them.
Method: code reading plus one executed regex check (marked). No build, DB suite or model call was run. Line numbers are on C0.

## Status line

task | SHA | status | evidence | blocker
--- | --- | --- | --- | ---
Review PR #57 on main | 4956588 | round 1 done | this file | none
Review Developer's repair | pending | waiting | | repair not yet relayed
Review frozen C1 | pending | waiting | | C1 not frozen

## Findings (most severe first)

### H1. A loose "correction" cue now moves one person's event to another and deletes it from the first (High)

- `lib/rag2/loop/loop.ts:105` `PERSON_CORRECTION` matches `it was (\w+ ){0,3}not`, `i mean`, `rather than`, and any `not <Capitalised word>`.
- PR #57 made the move destructive: `loop.ts:426` deletes every household-reported fact from the first person, and the new branch in `claimFor` (about `loop.ts:466`) moves the claim whenever `correcting` is true and the subject differs.
- Executed check (node, regex copied from `loop.ts:105`): "Daniel broke his arm too. It was not serious.", "Daniel broke his arm too. I mean, he fell off his bike." and "Daniel broke his arm too, he slipped rather than fell." all test as corrections. Plain "Daniel broke his arm too." does not.
- What I infer from the code (not run end to end): in those messages Grace's reported event moves to Daniel, Grace's facts are deleted, and her calculations are withdrawn. This is the exact "too" scenario the handoff says carries nothing, made unsafe by ordinary wording. Before PR #57 the facts were copied, not deleted, so a false positive could be recovered.
- Ask: the acceptance tests should include "too" messages that also contain these cues. The fix belongs at the cue (a correction must name the person corrected away from, or contrast two household names), not at extra phrase exceptions.

### H2. `causeFit` withholds an accident benefit's amount on a one-word "sick" cue, using a classifier built for deaths (High)

- `loop.ts:1749-1783` (new). It reuses `CAUSE_ATTRIBUTE` (`lib/rag2/applicability.ts:39-47`, id `cause_of_death`, question "Did X die ...") for any non-death benefit with a printed accident condition.
- If the household's report matches only the illness pattern (`ill`, `sick`, `stroke`, `covid`, `terminal` ...), the benefit's terms are removed and the server writes "this benefit's condition is not met and no amount is given for it" (`loop.ts:1776`).
- Example inferred from the regexes: "She felt sick and fainted, hitting her head" gives `illness` only (no accident word matches "fainted" or "hitting"), so an accident or injury benefit is dropped with a statement that its condition is not met. That is a coverage decision made by the server, and an amount of zero shown where one may be due. DC's stance says a wrong claimable amount is the worst bug and the insurer decides.
- Ask: when the cause is "illness", state the printed accident condition and say the insurer decides whether it is met; do not remove the benefit or say "not met". Or require the classifier to see no injury words (fell, hit, fracture, injur*) before it says illness. Add a test for a sick-then-injured report.

### M1. A row's own footnote is shown, but never stops the amount (Medium)

- `lib/rag2/calc/tool.ts:189` attaches the row's footnotes; `lib/rag2/loop/statement-render.ts:126` appends them to the illustration sentence. Nothing compares the household's reported part with the footnote.
- If the model maps "broke her toe" to the "Leg, Ankle or Knee^" row, the reply gives the Leg illustration (S$2,500 in the fixture, `scripts/reliable-chat-fx-repairs-test.ts:263`) followed by "any fractures of toe and foot are not covered". The amount and its own exclusion sit in one sentence. Whether the model does this mapping is not tested; F1 to F8 only check that the note is attached to the right row.
- Ask: a test where the reported part is named in the row's footnote ("toe", "finger") must give `unlisted_case` or no amount. A server check of reported words against the footnote's "not covered" list is structural, not phrase-specific, as long as it reads the printed footnote rather than a hard-coded body part list.

### M2. An absence answer passes when some pages of a document have no text (Medium)

- `lib/rag2/loop/absence-scope.ts:176` refuses only when *no* page of a document has text. A 20-page document with five OCR-empty pages passes, and "does not describe a benefit for dental" is then said over pages that were never read. The module's own docstring says it refuses "when a scoped document's text is not stored".
- Ask: refuse when any stored page is empty or the stored page count is below the document's page count.

### M3. The topic word is not searched when the document's product name contains it (Medium)

- `absence-scope.ts:171` adds every word of each scoped document's product name to `skip`, and `searchTerms` drops topic words in `skip`. For a product called "XYZ Dental Plan" and topic "dental", the word "dental" is searched only if the model also passes it in `terms`. With terms `["dentist"]` the check can pass on a document that prints "dental" on every page.
- The absence check is also only as wide as the model's own terms (no floor of synonyms: tooth/teeth, oral, orthodontic). The sentence's caveat ("not the same as saying there is no such cover") limits harm but does not make a false "does not describe" true.
- Ask: never skip the topic's own words for `benefit_not_found`; skip product-name words only for `document_silent`, where the reason given applies.

### M4. Adding a document does not withdraw a saved "not found" answer (Medium)

- `lib/chat/stale-answers.ts:53` withdraws on deletion or file-hash change only. An answer saying "Your uploaded documents (...) do not describe a benefit for dental" stays as it was after the household uploads the dental policy. For scope `library` and `subject` this answer is now false.
- The handoff only claims deletion and replacement, so this is a gap, not an untrue claim. Ask: for `library`/`subject` scope, withdraw when the scope's document set changes.

### L1. The reopened render context binds a figure to any record in the same text (Low)

- `lib/chat/monetary-boundary.ts:369` accepts a money figure if *any* record's sentence appears in the same text block and that record carries the same number. It does not check that the figure lies inside that sentence. A second sentence in the same block repeating the amount as "you can claim S$2,500" would validate and be read under `claimContext:false`. The amount cannot differ from a verified record, so this is a relabelling risk, not a wrong number. `CUED_BARE_AMOUNT_PATTERN` figures are not checked here at all.
- Ask: require the match position to fall inside the record sentence's span.

### L2. Footnotes longer than three continuation lines are silently cut (Low)

- `lib/rag2/calc/pct-rows.ts:196` stops a footnote after three continuation lines. A long footnote's later clause (often the exclusion itself) would be dropped without a note. Footnotes printed anywhere other than directly under the last percentage row are not attached at all (documented in the code; worth stating in the release notes as a limitation).

### L3. Notes on claims made by the handoff and PR text

- "No live model call has exercised the new refusals" is stated correctly. I found no 99%/100% or consistency claim in the product code comments.
- The fracture fixes are not phrase patches as far as I read: footnotes, absence and the relation sentences read structure. Two pieces are wording-driven and should be named as such: `PERSON_CORRECTION` (H1) and `CAUSE_ATTRIBUTE` reuse (H2).
- PR #57's title said not to merge or deploy, and it is on main and most likely live. The findings above therefore describe production behaviour, not a candidate.

## Release view on C0

Not ready for wider release as is. H1 and H2 can each produce a wrong or missing claimable amount from ordinary household wording, and neither is covered by a test. M1 to M4 are gaps that a test can pin down. Nothing here needs a model call to reproduce: H1 and H2 can be shown with the scripted model.

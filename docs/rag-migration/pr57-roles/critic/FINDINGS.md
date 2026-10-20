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

---

# Round 2: verdict on the Developer's proposal

Reviewed: `docs/rag-migration/pr57-roles/developer/PROPOSAL.md` @ `03e1b1d` (branch `claude/pr57-followup-pgaq7d`), with QC's `FINDINGS-C0.md` @ `b6a7a96`. Still C0; nothing implemented yet. Code reading only, no runs.

task | SHA | status | evidence | blocker
--- | --- | --- | --- | ---
Review Developer's proposal | 03e1b1d (on C0) | done | this section | none
Review frozen C1 | pending | waiting | | C1 not frozen

## Verdict per item

| # | verdict | condition |
| --- | --- | --- |
| P1 explicit correction | Accept with changes | see P1 below: two cue forms are still loose, and the delete should become reversible |
| P2 sick + injury | Accept | soften the pure-illness wording (below) |
| P3 footnote stops amount | Accept with one guard | the match must ignore event words, or every fracture is excluded |
| P4 empty / missing pages | Accept | expect the K6b fixture answer to change; do not treat an unknown page count as complete |
| P5 product-name skip | Accept | none |
| P6 / R1 drop model relation notes | Accept with a tighter rule | it must not drop a statement that carries the S$120,000 row's own condition (QC Q1) |
| P7 stale after upload | Small enough: include | compare the saved document id set, for `library` and `subject` scope only |
| P8 figure inside its sentence | Small enough: include | none |
| P9 / R2 Living Care sentence | Not small: defer | adds an unrequested sentence on the sickness path; usefulness gap only |
| P10 env names in `.env.example` | Small enough: include | docs only; say in the PR that it is a baseline repair, not part of the fracture fix |
| Deferral of QC Q1 (Core or Voluntary condition) | Acceptable for C1, not for a release decision of "ready" | see below |

## P1: the explicit-correction rule is safe only with two changes

The direction is right: a missed correction leaves Grace's facts where they were, which is the safe failure. Two proposed forms still fire on ordinary messages:

- **"it was" + a name.** "Daniel broke his arm too. It was Daniel's bike." would count as "it was" followed by the new person's name. A correction should need both people: the new name and the first name negated or contrasted in the same message ("it was Daniel, not Grace"; "Daniel, not Grace"), or a mix-up phrase. "I meant Daniel" alone is acceptable only when it answers a pending question about the first person.
- **"Grace didn't / wasn't".** "Daniel broke his arm too; Grace wasn't with him." would count as a correction away from Grace. Bind the negation to the event ("Grace didn't break it", "it wasn't Grace"), or require the new person's name in the same sentence.

Defence in depth, needed whatever the cue: PR #57's `delete from.facts[k]` (`loop.ts:426`) should become a withdrawal kept in the first person's `previous`, so a later "no, I meant Grace as well" can restore it and a false positive is not a permanent loss.

Tests needed beyond the Developer's list: the two messages above must not move anything; "Actually it was Daniel who broke his arm, not Grace." must still move it.

## P2: accepted; one wording change on the pure-illness path

The injury-word list fails safe: "fell ill" matches "fell", so it is read as unresolved and no verdict is given. On the pure-illness path, "this benefit's condition is not met" (`loop.ts:1776`) is still the server deciding cover. Say instead that the benefit is printed with an accident condition, that what was reported is an illness, that no amount is shown, and that the insurer decides. Keep "no amount": with the household's own report of an illness, showing an accident amount would be worse.

## P3: the footnote match must ignore event words

"A content word of the reported case appears in the footnote" will fire on "fracture" itself: "fractured her leg" and the Leg^ footnote "any fractures of toe and foot are not covered" share the stem `fractur`. That would remove every fracture amount on a footnoted row. Only words that name the part or case (the words left after removing the benefit's own event vocabulary: fracture, broke/broken, injury, accident and similar) may match, and only within the "not covered" clause of the footnote. Tests: "broke her toe" on Leg^ gives no amount; "fractured her leg" and "broke her ankle" on Leg^ still give S$2,500 with the footnote.

## P4: expect the fixture to change

QC Q5 notes that the fixture Product Summary stores 4 of its 36 printed pages. With P4, the K6b dental absence over that document should now be refused. That is the correct result, and the Test engineer should expect it. The Developer must not make it pass by treating an unknown page count as complete. If the document's page count is not stored, the safe reading is "not fully read".

## P6 / R1: tighten what is dropped

The risk the Developer names is real and is exactly QC Q1. A model `uncertainty` citing BS p8 and PS p13 that says "this benefit can only be claimed under the Core Scheme or the Voluntary Scheme" meets all four drop conditions, and would be removed by the very repair meant to reduce repetition. Tighter rule: drop a model statement only when every evidence id it cites is among the evidence the server's two notes cite (the two schedule rows and the standing clauses), and none of its passages is a sentence the server notes do not carry. Anything citing another passage stays. Acceptance must include a model statement carrying the Core/Voluntary sentence that survives.

## QC Q1 deferral: acceptable for this round, with two conditions

QC found no wrong amount. The omitted sentence ("can only be claimed either under the Core Scheme or Voluntary Scheme") means one scheme or the other, never both, which the answer already says ("alternatives ... never a total"). So leaving it out does not by itself mislead on the amount. It is still a printed condition directly under a S$120,000 row that is shown at the same weight as S$1,250, and the prompt rule says a conditional benefit is stated with its condition. Conditions for deferring:

1. It is listed as an open release item in the integrated PR and in the release decision. C1 cannot be called release-ready while it is open.
2. R1 must not remove a model statement that says it (above). Otherwise this round would make Q1 worse.

Also note that `pct-rows.ts` deliberately attaches nothing for an unmarked "*This Benefit can only be claimed ..." line. That is why the server path never shows it. A future fix belongs there, as a benefit-level condition read from the table, not as a phrase rule.

## Items I agree should stay out

K6a, K6c and the red `v11:customer-screens-test` and `rag2:s52-replay` expectations: I agree with the Developer's reading. The s52 third sentence is the currency-silence behaviour the same replay requires, so updating the expectation is not a weakened check. That is true as long as the Test engineer changes only the count and the new sentence's text, and not the S52A currency check.

## Round 2 addendum: against DC's project instructions (set 20 Oct 2026 05:29Z)

Three verdicts change once they are read against DC's project instructions (the coordinator relayed the review-relevant parts verbatim):

1. **QC Q1 can no longer be deferred quietly.** The contract says each benefit statement stays tied to "the benefit's own section, table row, conditions and footnotes", and says "never remove a qualifier and leave a misleading amount". The S$120,000 illustration without the "can only be claimed either under the Core Scheme or Voluntary Scheme" sentence printed under its own row breaks the first rule as written. Verdict: put it in C1 if there is a small fix at the existing boundary (`pct-rows.ts` reads the table and is where that unmarked line is deliberately dropped, so attach it there as a benefit-level condition of that table). It must not become a phrase rule or a new rendering layer. If no such fix fits, it is a release blocker and must be named as one in the integrated PR, not as a release note.
2. **P2 must keep the benefit's terms on the pure-illness path.** "An answer that unnecessarily hides a documented benefit is a failure" and "keep supported terms useful when an amount is unresolved". Today `causeFit` removes the benefit's terms when the cause is illness (the `replaced` set, `loop.ts` around 1779). The repair should keep the printed terms, quote the accident condition, show no amount, and leave the decision to the insurer. Removing the benefit entirely hides it.
3. **P1 matches the instruction's own examples.** "Actually it was Daniel, not Grace" must reassign; "Daniel broke his arm too" must not, and must not pick up Grace's words. The instruction says corrections "must not contaminate another person's later scenario", which supports making the delete a reversible withdrawal (round 2, P1).

Unchanged and supported by the instructions: P3 (no amount, but the row's terms and footnote stay shown), R1's tighter rule ("never remove a qualifier"), P4/P5 ("missing information is not an exclusion": an unread page is not absence), and deferring R2. P7 to P10 add no new pipeline.

For C1 I will also check that the integrated PR keeps the four evidence categories separate and states that replays cannot show the real model's response to the changed tool refusals.

## Round 2 update after the Test engineer's C0 run (a63040b, `test/FINDINGS-C0.md`)

- H1, H2, M2, M3 and M4 were reproduced on C0.
- **M1 is withdrawn.** On C0, `evaluate_benefit` reads the reported "toe" and returns `unlisted_case` even when the model names the Leg row. My finding was inferred from the footnote path alone and missed that case check. **P3 should therefore be dropped from C1**: it is not needed, and as proposed it risked removing every fracture amount on a footnoted row (round 2, P3). M1.1 stays as a guard test.
- **New, from the Test engineer's N5b (Medium):** when a document's stored file hash changes in place, a reopened answer with a calculation (the S$120,000) is not withdrawn. Only absence answers compare hashes (`lib/chat/stale-answers.ts:53`). Under DC's contract ("Keep returned, saved, displayed and reopened answers consistent"; a document's version and date stay tied to the statement), a replaced version should withdraw a calculation too. The calculation record already stores `documentHash`, so this is the same small check as P7. Whether production re-uploads change a hash in place or create a new row is unverified (Test engineer's limit). Include it with P7 if that check shows the path is real; otherwise list it as open.

---

# Round 3: review of frozen C1 (`8c63250`, recorded by `9d3327e`)

Read: the product diff `4956588..8c63250` (`lib/`, `types/`), `developer/C1.md`, and QC's C1 ruling as relayed. Two checks were executed with tsx against the C1 source, copied verbatim (no DB, no model, no spend); they are marked "executed". The rest is code reading.

task | SHA | status | evidence | blocker
--- | --- | --- | --- | ---
Review frozen C1 | 8c63250 | done | this section | C1-1 must be fixed before C2 is frozen

## Findings on C1 (most severe first)

### C1-1. `tableConditions` attaches the NEXT benefit's heading and amount as this table's condition (High)

`lib/rag2/calc/pct-rows.ts` `tableConditions` (new in C1) takes the first capitalised sentence after a percentage table. It does not stop at a heading. It skips leading blank lines, and it does not reject figures. Executed on the C1 source, the fracture table followed by:

| what follows the table | what C1 attaches as the fracture benefit's condition |
| --- | --- |
| the fixture's "This Benefit can only be claimed ..." then "F.\tDisappearance" | the Core/Voluntary sentence (correct) |
| "F. Ambulance Cost" / "We will reimburse ambulance costs up to $500 per event." | "F. Ambulance Cost We will reimburse ambulance costs up to $500 per event." |
| a blank line, "Ambulance Cost", the same sentence | "Ambulance Cost We will reimburse ..." |
| "We will also reimburse ambulance costs up to $500 per event." | that sentence |

The attached text goes into the S$120,000 illustration sentence ("under the table it prints: ...") and the benefit's terms. That breaks DC's contract twice: it attaches one benefit's conditions to another, and it puts an unresolved bare "$500" inside an amount sentence. The fixture passes only because its next heading has a tab. Fix at the same place:
- stop at `isSectionHeading` (already imported in `pct-rows.ts`) or `isHeadingLine`;
- stop at the first blank line instead of skipping it;
- refuse any candidate sentence that carries a money figure or a percentage.

Tests (Test engineer): the three bad layouts above attach nothing; the fixture still attaches the Core/Voluntary sentence.

### C1-2. "too ... but it wasn't Grace's fault" is still a correction (Medium)

Executed with `isPersonCorrection` from C1 (from Grace to Daniel):

- Correctly a correction: "Actually it was Daniel who broke his arm, not Grace."; "It wasn't Grace, it was Daniel."; "Sorry, Daniel, not Grace."
- Correctly not: "Daniel broke his arm too."; "... It was not serious."; "... It was Daniel's bike." (pending about Grace); "... Grace wasn't with him."
- Still wrongly a correction: "Daniel broke his arm too, but it wasn't Grace's fault."; "Daniel broke his arm too, not Grace's leg this time."

C1 makes the move reversible, which limits the damage, but Grace's illustrations are still withdrawn and her facts moved until someone corrects it back. DC's instructions name exactly this pair. Two structural fixes:
- a possessive after the first person's name ("Grace's") is not that person;
- a separate-event cue in the same message ("too", "also", "as well", "both") blocks a correction unless a mix-up phrase is present.

Add both messages as acceptance tests.

### C1-3. The reason for leaving N5b open is incomplete: re-analysis rewrites a document in place (Medium)

The Developer says an active policy's file is never replaced in place. That is true of the file and its `file_hash`. But "Re-analyse" (`app/api/policies/reprocess/route.ts`, which queues `lib/rag/ingest.ts`) keeps the same policy id and hash and deletes and rewrites `policy_pages` (`ingest.ts:529`), `policy_members` (`:615`, `:628`) and the coverage tables (`:631`, `:632`). After a re-analysis:
- a saved "not found" answer still stands, though the text it was checked against changed (its hash check cannot see it);
- a saved S$120,000 calculation still stands, though the row it rests on may have been re-read differently.

This conflicts with "keep returned, saved, displayed and reopened answers consistent". `rev` is not a usable signal, because it includes `updated_at`, which changes on any update. The smallest sound fix is to save a digest of the pages each check or calculation read, and compare it on reopen. If that is too large for this round, list N5b with this corrected reason, not "never replaced in place".

### C1-4. The read-in-full rule is safe, but may refuse most absence answers in production (Medium, usefulness)

`absence-scope.ts` refuses when any stored page is empty, or when `page_count` is unknown or larger than the number of stored pages. That is the right side to fail on: it never states an absence it did not check, and the refusal text tells the model to say what was read. It hides no documented benefit, because it only stops a "not described" sentence. The risk is reach. Production documents get `page_count` from `ingest.ts:601`, but an image-only cover page or a scanned back page with no text would make every absence over that document refuse. How often that happens in real uploads is unmeasured. Ask: before release, count (read-only, on test households or with DC's say-so on his library) how many documents have an empty stored page.

**The fixture `page_count` commit (Test engineer) must be checked line by line.** Each fixture document's `page_count` must equal the pages that document really has, not the pages stored. The Product Summary fixture stores 4 of its printed 36 pages (QC Q5), so its `page_count` must be 36 and its absence must stay refused. Setting it to 4 would be changing an expectation to force green. I will check that commit when it lands.

### C1-5. Smaller notes (Low)

- `causeFit`: `replaced` is never filled now, so the trace line's "its terms and amount are left out" clause is dead text. Harmless; remove it in C2.
- R1/R3 fail in replay because the new condition passage takes the recorded id `e32`. I accept the Developer's reading (a replay artefact; the rule keeps a sentence citing the condition, as it should). It means the de-duplication is **not shown** on C1 by any evidence category. The PR must say so, not "fixed".
- L1 (`monetary-boundary.ts`), M3 and M4 match the agreed repairs. M4 loads the household's documents on reopen only when an answer has a `library`/`subject` absence. Fine.

## On QC's C1 ruling and the coordinator's C2 additions

- **Sickness-only wording.** I agree with QC, with one condition. "On what you reported, the accident condition is not met; the claim decision is the insurer's" is supported only on the pure-illness path, which C1 now reaches only when no injury word was reported (`INJURY_WORDS`). It must not reach the `unresolved` path. Keep the printed S$250 terms with every condition shown, and no estimate for the stay.
- **Living Care sentence (overriding my deferral).** I accept the coordinator's ruling under DC's contract. The risks to guard:
  1. It must be written by the server through the existing `checkNotFound` (`document_silent`, scope the certificate), not as a model sentence.
  2. It must state S$350,000 / S$300,000 only as "listed as of 6 October 2022", never as cover for this stay or for sickness.
  3. It must not fire when the person has no such listed-but-undescribed record.
  4. With C1-4's rule, it will refuse on any certificate with an empty page. Then the answer must still name the listed benefit (as a listing) rather than drop it, or the repair will hide what it is meant to show.

## Release view on C1

Not ready to freeze as the final candidate. C1-1 attaches another benefit's terms and an unresolved amount to an illustration, which DC's contract forbids. It must be fixed in C2. C1-2 and C1-3 should be fixed in C2 or listed accurately as open. The rest of C1 is sound.

The evidence for C1 is scripted tests and recorded replays only. C1 changes tool behaviour the model sees: which messages move an event, and the refusal texts for absence and `note_facts`. So no replay can show how the real model responds. That limit must be stated, and a live check needs DC's authorisation and ledger room.

---

# Round 3b: rulings on the Test engineer's C1.1 (`0a5dfb0`) and notes on pre-C2 `86ffadf`

## Product Summary page count: 37, not 36

Agreed: 37. `page_count` is the document's length, and the fixture stores page index 37 (which prints "Page 36 of 36"). A count of 36 would sit below a stored page, which is impossible for a real document. Either value keeps the copy incomplete (4 stored of 37), so neither forces anything green. The certificate at 1 ("Page 1 of 1") and the Benefit Summary as unknown are also right.

The unit fixture in `reliable-chat-absence-scope-test.ts` was renumbered so that each synthetic document is stored in full. That is acceptable. I checked that no assertion depends on the old page numbers: F1 names its own page 20 document. The partial cases moved to the new S12 and S13, so nothing that was tested is lost.

## fx-repairs A2 to A5, A9 (and B1): genuine expectation errors; do not edit them to pass, re-point them

These checks assert that the three-document dental absence ("do not describe a benefit for dental treatment", scope of 3 documents, saved and reopened) is said over the fracture fixture. Two of those three documents are partial copies: 4 of 37 pages, and 6 of an unknown number. QC Q5 already noted that an absence over that copy says nothing about the real document. The expectation therefore asserted a claim the documents could not support. That is an expectation error, not a regression in C1.

Ruling:
1. **Keep the original checks' intent and re-point them at fully stored documents.** Add a fully stored variant of the household (every page stored, true `page_count`) and run A2 to A5, A9 and B1 there with their wording unchanged. This keeps "a supported absence is still said, scoped, saved and reopened identically" under test. That is the guard against C1-4 (the full-read rule hiding supported answers), and it must be able to fail.
2. **On the partial fixture, add new checks, not edited ones:** no absence is said (M5 covers this), and the answer stays useful. It must name what was read and that the rest could not be checked. It must not end in "couldn't confirm an answer" or in the model-error answer. The C1 replay shows K6a ending in "I couldn't finish: the assistant model returned an error". That happens because the recorded calls have no repair step, which is a replay limit. But nothing yet shows the live path ends well, so this is an open item for a live run.
3. **Publish the reason** next to the change (in `test/`): the original lines, why each was an expectation error (asserted absence over 4 of 37 pages), and the commit that preserves them. Do not delete the old assertions from history.

## New product regressions from the Test engineer's C1 run (for the Developer; tests must not be changed for these)

- **`rag2:tools-test` F4 (Medium, contract):** `lib/chat/stale-answers.ts` now imports `lib/rag2/store` and `lib/rag2/loop/absence-scope` (M4 repair). That breaks the rule that the existing chat path does not load the loop when it is off. Fix in product code: do the M4 widening check in SQL inside `stale-answers.ts`, or behind the flagged hook. The suite's boundary must not be relaxed.
- **`reliable-chat:structured-answers-test` J2, J3, J3b, J4, SBa (Medium):** the table condition is quoted with its own full stop inside the illustration sentence, and the sentence splitter then splits one saved calculation into two. This is DC's "one complete sentence" rule for a saved calculation. Fix the rendering (quote the condition without its final full stop, or put it in brackets); do not change the splitter's expectation.
- **"the J, Accidental Hospital Recuperation Benefit" (Low):** the section letter is taken into the benefit label on the sickness path. Same family as C1-1 (layout text read as content); fix where the label is read.

## Pre-C2 `86ffadf` (read, not run)

- **C1-1 fix:** stops at `isSectionHeading` / `isHeadingLine`, at the first blank line, and at any sentence with an amount or percentage. That matches my ask, and N7 tests it. Accepted, pending the Test engineer's run.
- **C1-2 fix:** "too / also / as well" blocks a correction unless a mix-up phrase is present, and a possessive is not the person. This fails safe (a missed correction leaves facts where they were). H1.6 tests it. Accepted.
- **Sickness wording:** matches QC's ruling, and is reachable only with no injury word. Accepted.
- **Living Care sentence:** names the listed cover with no amount, says "listed as of <date>", and adds the server-checked `document_silent` absence only when `checkNotFound` passes; otherwise the listing alone is said. That meets all four conditions I set. Accepted.
- **C1-3 (re-analysis in place):** not addressed yet. It must be fixed or listed with the corrected reason in C2.

---

# Round 4: DC's live GP-bill failure, the Developer's G1 and G2 (`720f5f5`, `developer/GP-BILL.md`)

Read: GP-BILL.md and the fixture's Benefit Summary page 1 (it names OPMC in the scheme's policy list, and says "A Benefit is only applicable to you if the Policy containing the Benefit is specifically stated in Part 1 of this Certificate"). Code reading only.

task | SHA | status | evidence | blocker
--- | --- | --- | --- | ---
Review G1 / G2 | 720f5f5 | done | this section | none

## G2 (fallback wording): accept

"I haven't yet looked up ..." is untrue after a search, and DC saw it. Two conditions:
- **What counts as a search.** It must be a search that ran this turn for the bill's topic, not any tool call.
- **What the new line says.** It must not contradict a benefit the same answer states. Write "The pages I read do not print a benefit for the bill you mentioned", and keep the household's "$800" as they wrote it (bare "$", currency not established).

## G1: accept the direction, with five conditions

Without G1, the household gets "I couldn't confirm an answer", which is the failure DC reported. With G1 as written, three of DC's contract rules are at risk. Each condition below maps to one.

1. **No exclusion or non-cover claim** ("Missing information is not an exclusion"; "a dated certificate proves what it printed on that date"). The sentence may say: the certificate, *as of its printed date*, lists policies A, B, C and D; the scheme document also names the Outpatient Medicare Policy, which that certificate does not list; and whether Desmond has that cover now is for the insurer or scheme administrator to confirm. It must not say "not covered", "does not apply" or "is not insured". It must not combine the Part 1 applicability clause with the absence of the listing into a conclusion. Quoting that clause next to "not listed" *is* the conclusion, whatever the wording, so leave it out of G1's sentence.
2. **Reference wording is not proof either way.** The Benefit Summary naming OPMC proves only that the scheme has such a policy. It is not evidence that Desmond has it, nor that he lacks it. The server's sentence should cite the scheme page only for "the scheme names it", and the certificate only for "the certificate lists".
3. **"The certificate does not list it" must be shown, not assumed.** It needs every page of the certificate stored (the read-in-full rule), and a match on the policy's full name *and* its printed abbreviation ("OPMC") against everything the certificate lists. If the certificate is partial or any name matches loosely, G1 does not fire, and the existing refusal path (C2's "what was read") answers instead.
4. **The trigger must be structural, not a phrase.** "Every hit is in a line that names a group policy the certificate does not list" should mean the hit lies inside the scheme document's own list of its policies (the span that defines the abbreviations). It must not mean any line that happens to contain a policy-like name. Any hit anywhere else (a benefit's own wording, a schedule row) refuses exactly as today.
5. **Do not hide a documented accident benefit** (DC: "an answer that unnecessarily hides a documented benefit is a failure"). This is the most important one for DC's real library. Desmond *tripped and fell*: an accident. Personal accident wordings often reimburse medical expenses after an accident, printed with words like "medical expenses", "registered medical practitioner", "treatment" or "reimburse", not "GP", "outpatient" or "clinic". The model's terms in the reconstruction (outpatient / GP / clinic / general practitioner) would miss such a benefit, and G1 would then say no listed policy describes it. Before G1 may say the listed policies' pages do not describe the bill, the server must check the person's accident benefits for a medical-expense reimbursement using the existing benefit records (`person_benefits` / `evaluate_benefit`). If one exists, state its terms (no amount without a resolved currency and the case) and do not say an absence. In the fixture this changes nothing (it prints none), so add a fixture variant that prints an accidental medical expense benefit as the control.

## On the evidence

The reconstruction (scripted model, anonymised household) shows that variant C reproduces the live text line for line. It cannot show which variant the live model actually took. Reading that one conversation's saved trace in production, read-only, would settle it. That needs DC's permission, and I recommend asking for it. Whether DC's real certificate lists an outpatient or medical-expense benefit is unknown, and condition 5 exists because of that.

Tests (Test engineer):
- G1 positive: certificate in full, OPMC only in the scheme roster. The answer names the listed policies and "the certificate does not list OPMC (as of date)", with no "not covered" and no Part 1 clause.
- G1 negative: the certificate partial, OPMC matched by abbreviation, and a hit inside a benefit's own wording.
- The accident-medical-expense control (condition 5).
- G2: the wording when a search ran versus when none ran.

---

# Round 5: adversarial review of frozen C2 (`98ada99`), full diff from C0 `4956588`

Scope, as DC asked: correction handling, household isolation, applicability, and fallback behaviour (including the "couldn't confirm" path, G1 and G2). C1 was already reviewed in round 3; this round covers C1-to-C2 in detail and re-checks C1 items against C2. Code reading only, no runs. Line numbers are on `98ada99`.

task | SHA | status | evidence | blocker
--- | --- | --- | --- | ---
Adversarial review of C2 | 98ada99 | done | this section | A1, A2 and F1 before release

## Correction handling

**A1. Medium: "too / also / as well" now blocks real corrections.** `lib/rag2/loop/loop.ts:119` returns false before the explicit-name test whenever the message contains too, also or as well. So "Actually it was Daniel who broke his arm, not Grace. He also hurt his knee." is not a correction. Grace keeps the event and its illustrations, and Daniel's report starts empty. That is the very reassignment DC's instructions say must move. The block is also unnecessary: the possessive exclusion on line 122 (`(?!['’])`) already stops "wasn't Grace's fault". Fix: remove line 119, keeping the possessive exclusion. Test: the sentence above must reassign, and H1.6 must still not.

C1 items re-checked on C2: reversible moves (`reassigned`), `supersededNow` and `movedThisTurn` are unchanged since round 3 and still sound.

## Household isolation

**A2. Medium: G1 lists another person's policies as "this person's certificate lists ...".** `absence-scope.ts:250-255` takes every confirmed certificate in scope and joins all their text. `products` is every line of the form "<NAME>(POLICY NO ...)". It does not check which person each row belongs to. A family certificate listing two members, or a library-scope check (no subject, so certificates of several people), gives "Desmond's certificate lists X, Y, Z", where Z is the spouse's policy. The "does not list OPMC" test also reads every certificate together. That fails safe for non-listing (any match suppresses G1), but not for what is said to be listed. Fix: G1 fires only for a subject-scope check, and reads only the rows that name this person (the certificate's person rows, as `person_row` bindings already do); otherwise return null.

No other crossing found:
- `stale-answers.ts` M4 is account-scoped, and filters members to active ones.
- `partialAbsence` is per tool context.
- `heldForAnother` and `saidAboutThem` are unchanged.

## Applicability

**A3. Medium: the medical-bill vocabulary would still miss a typical accident medical-expense wording.** `MEDICAL_BILL_TERMS` (`absence-scope.ts:233`) and the server's own GP check (`loop.ts:2138`, terms outpatient / clinic / general practitioner / consultation; "GP" itself is dropped by `tidyTerm`'s three-letter minimum) do not include "medical practitioner", "physician", "doctor", "charges incurred" or "reimburse". A wording such as "we will reimburse the reasonable charges for treatment by a Registered Medical Practitioner following an Accident" produces no hit. G1 then sets the OPMC line aside, and the server states "Desmond's documents do not describe a benefit for GP or outpatient treatment". That hides a documented accident benefit, which DC's contract calls a failure, and my round-4 condition 5 asked for this case to be covered. Fix:
- add those terms;
- before stating the absence on the GP path, check the person's benefit records for any accident benefit whose printed terms reimburse treatment or medical charges, since the records already exist;
- add the fixture control from round 4, which is still missing from f550b5f's checks (a) to (d) as far as the C2 notes show.

**A4. Low-Medium: G1 only recognises one certificate layout.** `absence-scope.ts:255` (`"<NAME>(POLICY NO"`) and the single "As of dd/mm/yyyy" date. On any other layout `products` is empty and G1 returns null, which is safe: it falls back to the refusal path. But the GP-bill repair would not help other households. Say this in the PR as a limit; do not widen it now.

## Fallback behaviour

**F1. Medium-High: a repeated refusal can quote the scheme's policy list as the answer.** When G1 does not fire (for example, because of A2's guard or A4's layout), `absence-scope.ts:200` picks the lines to quote. That is lines outside the policy list *or, if none, the hits themselves*. For the GP bill, the only hit is the scheme roster line naming "Outpatient Medicare Policy ("OPMC")". `quotePrinted` (`statement-render.ts:220` on a repeat, and `loop.ts:2142` on the GP path) then tells the household "The Benefit Summary (page 1) prints: '... and Outpatient Medicare Policy ("OPMC") ...'" in reply to "can he claim his GP bill". That reads as a pointer to cover, from reference wording, with no word that his certificate does not list it. DC's contract says reference wording is not personal proof of cover. Fix: never quote a line that `inPolicyList` identifies; if only such lines remain, say nothing from them, and let C2's "what was read" text or the G2 note carry the answer.

**F2. Medium: the G2 note can say the pages print no benefit when they do.** `loop.ts:2144` adds "The pages I read do not print a benefit for the bill you mentioned" whenever `said` is false. `said` is false in two cases:
- `checkNotFound` refused because the documents *do* print the terms, but `quotePrinted` returned null (no evidence ref could be built);
- it refused for another reason, such as an unstored document.

In the first case the note contradicts the documents. Emit the G2 note only when the check did not refuse for printed hits. Otherwise fall back to the original neutral wording without "not yet looked up", for example "I could not confirm from your documents what pays for the bill you mentioned".

**F3. Low-Medium: a partial-scope sentence can attach to a different subject's reply.** `statement-render.ts:238` appends the saved `partialAbsence` text to any later final answer this turn that has no `not_found`, whatever that answer's subject is. If the model refused on Desmond and then answered about someone else, the partial sentence about Desmond is added to it. Fix: append only when the answer's subject equals `pa.subjectId`.

**F4. Low: quoted lines skip the payout check, so must still pass the currency rule.** `compose.ts:1150` blanks quoted text before `payoutOrDecision`. That is right for the insurer's own "we will reimburse". But a quoted line can carry a bare "$500" (the ambulance wording). Confirm that the figure gate still treats it as currency-unresolved and never as S$, and add one test for it.

## Still open from earlier rounds

- **C1-3 (re-analysis rewrites pages in place):** not fixed, and `developer/C1.md:25-26` still gives the incomplete reason ("never rewritten in place"). It must be corrected in the integrated PR's open items.
- The de-duplication of the repeated fracture wording is still not shown by any evidence category (replay limit).
- All C2 evidence is scripted or recorded replay. C2 changes tool behaviour the model sees: the absence refusals, the quoted replacement on a repeat refusal, and the GP-path server statements. The real model's response to these is unshown, and a live check needs DC's authorisation.

## Release view on C2

Not release-ready.
- **Fix before release:** F1 (reference wording quoted as if it answers a cover question), A2 (another person's policies named as this person's) and A3 (a documented accident medical benefit could be hidden behind a stated absence). Each is a small change at the place named.
- **Fix in C2, or list accurately as open:** A1, F2 and F3.
- Everything else reviewed in C2 holds: the table-condition boundary, the sickness wording, the Living Care sentence, read-in-full, and M4 without the rag2 import.

---

# Round 6: final adversarial review of C3 `17668630` (full diff `4956588..17668630`, delta `98ada99..17668630`)

Method: read the C3 product delta (`absence-scope.ts`, `loop.ts`, `statement-render.ts`, `event-relations.ts`) and the
Developer's `RELEASE-REPORT.md` / corrected `C1.md` (`427d1d4`). Ran `decideNotFound` from C3 and from C2 directly (a scratch copy
with the store import stubbed; no DB, no model, no spend) on the fracture fixture's certificate (`CERT_P1`) and Benefit Summary
page 1 (`BS_P1`, the OPMC roster), plus one extra page per case. Ran `isPersonCorrection` from C3 on 12 messages. Line numbers
are on C3.

## New findings

**R6-1. High (for the GP-bill repair; no wrong amount): G1 now fires only when the member's display name equals the certificate
cell exactly.** `absence-scope.ts:125` builds the row matcher from `displayName` alone, as a whole tab-delimited cell. The fracture
fixture passes because its member is named `"Lee Wei Ming, Daniel"`, the same as the cell (`fracture-conversation.ts:21`). The
repo's own other households show the usual shape: member `"Daniel Lee Wei Ming"`, preferred name `"Daniel"`, certificate cell
`"Lee Wei Ming, Daniel"` (`actual-lib.ts:34` vs `:142`, `booklet.ts:31` vs `:46`). Reproduced: with the display name
`"Daniel Lee Wei Ming"`, C2 says the G1 answer, but C3 refuses with `printed=[]`. On the GP path the household then gets "I could not
confirm from your documents what pays for the bill you mentioned" (`loop.ts:2149`), which is DC's original complaint. That is
safe, but the release report's line "DC's GP-bill question gets an answer" holds only where the names happen to match. DC's real
member name versus his certificate cell is unchecked, because the production read was blocked. Fix (small): match rows the way the
table selector already does (`tables.ts:604-609`: display name or preferred name, word-bounded, at least 3 letters). Then drop a row
that also matches another household member's name, which keeps A2 closed. Add a GP variant where the member name is in app order.

**R6-2. Medium-High: the A3 change narrowed round-4 condition 5, so a documented medical-expense benefit can again be hidden behind
a stated absence.** C2 vetoed G1 when any medical-bill term ("medical expenses", ...) was printed outside the policy list. C3
replaces that with `medicalExpenseSentences` (`absence-scope.ts:95`), which needs a payment verb in the same sentence. A page that
prints the benefit as a label and a limit ("G. Medical Expenses Benefit / Up to $2,000 per Accident for medical expenses incurred
following an Accident") has no "reimburse/pay". Reproduced: C2 refuses and quotes both lines. C3 lets G1 fire and states "Daniel's
documents ... do not describe a benefit for GP or outpatient treatment" next to that benefit. Fix: keep C2's term veto (outside
the policy list) as well as the new sentence rule, and add this label-style control beside GP.b1.

**R6-3. Low-Medium (already in C2; C3 now quotes it first): an exclusion counts as medical-expense wording.** `PAYS` matches "We
will not pay any medical expenses arising from a pre-existing condition". It refuses the absence and is quoted ahead of other
lines as what the documents print for the GP bill, with the heading merged in ("General Exclusions We will not pay ..."). That
attaches another benefit's exclusion to a fall. Fix: skip sentences with a negation before the payment verb (not / no / never /
excluded). Inpatient-only wording ("... while hospitalised as an inpatient") is also counted. It is quoted verbatim, so this is
listed only.

**R6-4. Low (cosmetic, also in C2):** the G1 sentence reads "Outpatient Medicare Policy Policy (OPMC)".

## Round-5 items on C3

| item | verdict | evidence |
| --- | --- | --- |
| A1 too/also block | closed | block removed (`loop.ts:116`). 9/12 messages as intended. Residual (Low, accepted trade-off): "Daniel fell too, not Grace though, she was fine" and "Daniel also fell, it wasn't Grace who pushed him" now read as corrections (reversible) |
| A2 spouse's products named | closed, but over-tight (R6-1) | only rows naming the subject are read (`absence-scope.ts:125-133`); subject scope only (`:64`) |
| A3 doctor/practitioner wording | closed for sentence wording; regressed for label-style wording (R6-2) | "reimburse the reasonable charges for treatment by a Registered Medical Practitioner" now refuses |
| F1 policy list quoted | closed | `chosen` never takes an `inPolicyList` line (`:70`); repeat with nothing quotable is left out (`statement-render.ts:314`); reproduced `printed=[]` |
| F2 G2 note after refusal | closed | `loop.ts:2149` says "could not confirm" after a refusal |
| F3 partial sentence, other subject | closed | subject-matched in `statement-render.ts:328-329` and the new `withPartialAbsence` (`loop.ts:2563`) |
| F4 quoted bare "$" | holds by reading; still no test | the bare-currency gates run on the full text, quotes included, before the payout check blanks quotes (`compose.ts:1121-1150`) |
| C1-3 re-analysis in place | listed open with the corrected reason | `developer/C1.md:25-29`, `RELEASE-REPORT.md` |

## UX regressions

- **X-ray card (FX-K4B): fixed.** The own-section filter now runs before the relevance and "unprinted requirement" checks
  (`loop.ts:1182-1217`), so a mobility-aid passage no longer justifies a fracture question.
- **Dental "couldn't confirm" (FX-K6B): fixed.** `withPartialAbsence` adds the server's "what was read" statement for the same
  subject when the reply has no absence of its own. Bonus: the GP-path merge now keeps `absenceChecks` (`loop.ts:2152`), so that
  saved absence can be withdrawn on reopen. It was lost on C2.
- **Correction line (superseded answers not marked): not fixed; listed open.** Medium. After a correction, the earlier answer's
  figures (S$2,500 / S$300,000) stay on screen and after reload with no "replaced" marking. This is also on main, so it is not a
  regression. It is next to the worst-bug class (a withdrawn figure readable as current), so fix it before public launch.
- Death abroad (L2): the repatriation benefit is now a death benefit (label-only rule, `event-relations.ts:16`) and keeps its
  printed condition, quoted.

## Correction handling, household isolation, applicability, fallbacks

- Corrections: as A1 above. No new crossing.
- Household isolation: members are read per account (`checkNotFound`), and `partialAbsence` is per turn and per subject. No crossing
  found.
- Applicability: R6-1, R6-2, R6-3. Quoted reference wording still carries no "scheme wording, not proof of cover" qualifier when
  the quoted document is not the person's certificate (Medium-Low, widened by A3). List it as open.
- Fallbacks: F1-F3 and FX-K6B hold. Where G1 does not fire, the answer is the neutral "could not confirm", never a false absence,
  except in R6-2.

## Release verdict on C3

**Not release-ready.** Two small fixes, both in `absence-scope.ts`, plus two scripted controls:
1. R6-1: match certificate rows by display or preferred name, as the table selector does, excluding rows that name another member.
2. R6-2: restore C2's medical-term veto beside the new sentence rule.

After that, list as open: R6-3, R6-4, the reference-quote qualifier, superseded answers not marked, C1-3, travel trip dates, the
F4 test, and no live run. All C3 evidence is scripted (OpenAI configuration). The Claude switch (PR #59) needs its own check.
Nothing found in C3 states a wrong claimable amount.

---

# Round 7: final review of C4 `fbeed4af` (delta `17668630..fbeed4af`; product code in 3 files)

Method: read the delta. Re-ran round 6's `decideNotFound` cases on C4 (stubbed store; no DB, no model, no spend), plus two A2
cases. Ran the new travel-trip predicate (copied verbatim from `loop.ts:1648-1656`) on seven schedules. The rest of the full diff
from `4956588` is unchanged since round 6.

## Round-6 items on C4

| item | verdict | evidence |
| --- | --- | --- |
| R6-1 name matching | closed | "Daniel Lee Wei Ming" with the cell "Lee Wei Ming, Daniel" now gives the G1 answer (case 2) |
| R6-2 term veto | closed | the label-style "Medical Expenses Benefit" refuses and is quoted again (case 3); the OPMC roster still lets G1 fire (case 1) |
| A2 (spouse's products) | mostly holds; see R7-2 | a row naming another household member is dropped (case 7) |
| R6-3 exclusion counted | open, as listed | case 4 unchanged |
| R6-4 "Policy Policy" | open, cosmetic | case 1 |

## New findings

**R7-1. High: the travel suppression hides a matching trip's Accidental Death benefit.** `otherTrip` (`loop.ts:1648-1656`) drops a
record from the death answer when the schedule's period has ended *before today*, or when the current message does not contain its
printed destination word. Reproduced, each suppressing a S$100,000 benefit that does apply:
- "Adrian died in a car accident in Japan on 5 March" on a Japan trip of 1-10 March 2026. Deaths are reported after the trip, and
  `ended` compares with today (`new Date()`), not with the date of death or `input.asOf`.
- "died in Tokyo" on a Japan schedule.
- "Destination: Asia" or "Worldwide (excluding USA)" with "died in Japan".
- The place was given in an earlier turn ("what happens now that Adrian has died?").

At C3 these were shown (without trip dates, the Evidence Reviewer's point). At C4 they disappear with no sentence about the travel
policy. That hides a documented benefit with a claimable amount: a regression in exactly the death-abroad journey. Fix: never drop
the record. Keep the line and add the printed destination and period as its own qualifier ("for the trip to Indonesia, 1-10 March
2025"). That fixes the reviewer's misleading amount without guessing applicability. If the Developer keeps a suppression, it must use
the reported date of death and `asOf`, and treat region or worldwide destinations and an unknown place as "show with the qualifier".

**R7-2. Low: a preferred name alone can claim a non-member's certificate row.** `namesMember` (`absence-scope.ts:291`) accepts the
preferred name word-bounded anywhere in the row. A row "Lee Jun Hao, Daniel" for a son who is not entered as a member is read as
Daniel's, so "Group Critical Illness" was listed as on Daniel's certificate (case 6). That is a product name only, with no amount,
and dropped when the son is a member (case 7). Fix if cheap: accept a preferred-name-only match only when no other row under any
heading also matches it, or require every word of the display name.

**R7-3. Low (cosmetic):** the closed-fracture note can read "whether a open fracture is one" (`statement-render.ts:186`). The
wording otherwise matches the record: it says what is undefined and that the insurer decides, with no new figure. The partial-copy
wording (`absence-scope.ts:229-234`) is fine.

## Release verdict on C4

**Not release-ready: one blocker, R7-1.** It is small and local: keep the travel line with its printed trip qualifier instead of
dropping it. R6-1 and R6-2 are closed. Nothing in C4 states a wrong claimable amount. The remaining items stay listed as open:
R6-3, R6-4, R7-2, R7-3, the reference-quote qualifier, superseded answers not marked, C1-3, the F4 test, no live run, and the
Claude switch unverified.

---

# Round 8: final review of C5 `177c0734` (delta `fbeed4af..177c0734`; product code in 3 files)

## R7-1: closed

C4's `otherTrip` suppression is removed. `loop.ts` at C5 is byte-identical to C3 (same blob hash). No death benefit is dropped for
a trip any more. The travel amount is now said with what its own page prints: `tripLimits` (`statement-render.ts:78-90`) appends
the "Insured Person", "Period of Insurance" and "Destination" lines verbatim, each cited by an exact span (`evidenceAt`), and says the
insurer confirms whether the trip fits. That meets the contract: the qualifier is kept and the benefit is not hidden.

## Other C5 changes

- The partial-copy wording is definite only when the stored distinct pages are fewer than a known page count
  (`absence-scope.ts:233`). Correct.
- "an open fracture" (R7-3): closed.

## New finding

**R8-1. Low-Medium (wording; no amount changes): the "trip" sentence also fires on annual schedules.** `tripLimits` runs for any
record whose source page has a line starting "Period of Insurance:" *or* "Destination:". Annual schedules print a period too.
The repo's own Tan household PA schedule prints "Period of Insurance: 01/03/2026 to 28/02/2027"
(`scripts/fixtures/reliable-chat/tan.ts:24`). A benefit sourced from such a page gets "... the period of insurance
“01/03/2026 to 28/02/2027”; whether that trip fits this event is for the insurer to confirm". That reads as if a Personal Accident
benefit depended on a trip. The quoted period itself is useful. Fix (one condition): say "trip" only when a Destination line is
printed; otherwise "whether this period covers the date of the event is for the insurer to confirm". The Test engineer should check
whether any Tan expectation now sees the added sentence.

## Full diff `4956588..177c0734`

Nothing new. Every product-code change since round 5 is covered by rounds 6-8. The round-6 cases (R6-1, R6-2) depend only on
`absence-scope.ts`, whose only C5 change is the partial-copy wording, so they stand as reproduced on C4.

## Final release verdict (Critic) on C5

**No Critic blocker remains.** Nothing found in C5 states a wrong claimable amount, hides a documented benefit, or crosses
between people.

C5 is release-ready from the code review, provided the PR lists these as open, accepted items:
- R8-1 (trip wording on annual schedules; recommended as a quick follow-up);
- R6-3 (exclusion sentences counted as medical-expense wording);
- R6-4 ("Policy Policy");
- R7-2 (a non-member's row sharing a preferred name);
- quoted scheme wording without a "not proof of cover" qualifier;
- superseded answers not marked after a correction (fix before public launch);
- C1-3 (re-analysis in place);
- no test for F4.

Evidence limit, unchanged: all evidence is scripted or replay on the OpenAI configuration. The model-facing changes (absence
refusals, server quotes, the GP fallback) have had no live run. A live check needs DC's authorisation, and the Claude switch
(PR #59) needs its own check. Whether to ship before that live check is DC's call.

---

# Round 9: final review of C6 `f4937ef1` (delta `177c0734..f4937ef1`; product code in 2 files)

- **R8-1: closed.** "whether that trip fits this event" is said only when a Destination line is printed. A schedule that prints only
  a period gets "whether this period of insurance covers the date of the event" (`statement-render.ts:90`).
- **Partial-copy wording: correct.** "the text of the X (pages 1-4 and 8 of 37 pages) ... The text of the other pages was not stored"
  matches what the check knows (pages counted from the stored rows; no claim about the upload itself). The refusal problem the
  model sees is unchanged.
- **Corrected hip note: no figure changes; one wording risk.**

**R9-1. Low-Medium (wording only; no amount changes).** The new `bothKinds` note (`statement-render.ts:212`) says "these documents do
not define either kind". It is gated on the *same policy's* records having no definitions, and `definitions` are read only from a
record's own document (`benefit-records.ts:48-50,151-155`). Suppose a household's policy wording defines Simple Fracture while the
table sits in a separate summary document. The note then claims all the documents are silent, though one defines it. It errs toward
"the insurer decides", so no claim is overstated, but the absence statement can be false. Fix (one word): say "this document does
not define either kind", or check every record in scope for a Simple/Other Fracture definition. The existing tagged note
("these documents do not define which fractures count as ...") has the same ungated wording since C4; the same fix covers it.

## Final release verdict (Critic) on C6

**No Critic blocker remains.** Nothing in C6 states a wrong claimable amount, hides a documented benefit, or crosses between people.
The full-diff position of round 8 stands: `loop.ts` and the G1 / absence logic are unchanged except the wording above.

List as accepted open items: R9-1, R6-3, R6-4, R7-2, the scheme-quote qualifier, superseded answers not marked after a correction
(fix before public launch), C1-3, and the F4 test.

Evidence limit, unchanged: all evidence is scripted or replay (OpenAI configuration), with no live run. The Claude switch (PR #59)
is unverified. Shipping before a live check is DC's call.

---

# Round 10: PR #64 (live GP-bill fix), head `235d2623c45dc4ba4ebff56fdd461d362cad3bd7`, base main `ca6af69`

Method: read the product diff (`absence-scope.ts` ranking, `loop.ts` G2 terms, `compose.ts` `sayBack`). Ran `decideNotFound` from
`235d262` directly (store stubbed; no DB, no model, no spend) on the fixture certificate and BS page 1. I added the Developer's
invented overseas page (`gp-bill-live-repro.ts` P20) and a panel GP page like P25, with its section heading naming the Outpatient
Medicare Policy, the policy Daniel's certificate does not list.

**R10-1. High: a panel GP line from a policy the certificate does not list is now quoted as the GP-bill answer, and G1's "his
certificate does not list OPMC" sentence disappears.** In case A, the server quotes "Consultation at a panel GP clinic in Singapore: no
charge to the Insured Person. Non-panel GP consultation: up to $30 per visit." for Daniel. That line is any hit outside the scheme's
policy list, so G1 no longer fires (`absence-scope.ts:64`). Nothing in the answer says the wording comes from a scheme document, or
that Daniel's certificate (as of 6 October 2022) lists Term Life, PA, Living Care and Living Care Plus but not Outpatient Medicare.
In DC's real scheme, panel GP is most likely the OPMC's benefit; QC's ground truth says his certificate does not list it. The answer
would then read as "free panel GP, $30 otherwise" beside an $800 bill. That is reference wording presented as personal cover, with an
amount: next to the worst-bug class. The PR body says the reconstruction's invented page has no section owner, so this was not
tested. Fix before merge: when a quoted line comes from a document that is not the person's confirmed certificate, keep the G1
facts with it. Say what his certificate lists (dated), name the section or policy the quoted line sits under when its page heading
names one, and say only the insurer can confirm it applies to him. If the section's policy is one the certificate does not list,
say so plainly.

**R10-2. Medium: ranking overseas-only lines last is not enough.**
- Case B: when the only wording printed is the overseas clause, it is still quoted alone for a GP bill at home. That is the live
  symptom, so ranking cannot stop it.
- Case C: `ABROAD` also demotes a line that covers home, "Medical expenses incurred in Singapore or overseas are reimbursed under
  Benefit G", behind the overseas-only clause.
- The rank applies to every repeated refusal (`statement-render.ts`), not only the bill. A question about cover abroad gets its own
  answer lines pushed behind unrelated ones.

Fix: on the G2 bill path, unless the household's words place the bill abroad, do not quote a line limited to treatment abroad. Treat
"outside Singapore" or "overseas" as a limit only when the line has no "Singapore or overseas" / "in Singapore" inclusion. If only
such lines remain, say it in a sentence ("the only outpatient wording printed is for treatment outside Singapore"), never as the
answer. Keep the ranking out of non-bill topics.

**R10-3. Low: household isolation and person attribution.** The new terms do not widen scope: `scopeDocs` is unchanged, with the
person's linked documents plus documents linked to nobody. A panel GP page in an *unlinked* document, such as a spouse's employer
plan uploaded without a person, is still quoted for this person, with no "whose" wording. This is the existing open item (scheme or
unlinked quotes carry no qualifier), now on the main GP path. The fix for R10-1 covers it.

**R10-4. Low (cosmetic):** the line's own heading ("Panel GP Benefit") is quoted as the second line. The containment check only drops
a heading that sits inside the chosen line, and an mixed-case heading ranks with sentences.

**`sayBack`: fine.** Words with no subject are quoted ("You told me: “tripped on the kerb”"). Pronoun- and article-led words keep the
old path. I found no regression.

## Verdict on PR #64

**Not ready to merge.** R10-1 is the blocker: as it stands, the PR can turn a scheme's panel GP wording for a policy Daniel does not
hold into an apparent answer to his GP bill. Fix R10-2 in the same change; it is small. No paid run was made; this is a scripted
reconstruction only.

---

# Round 11: PR #64 head `094da7b` (re-review after R10 fixes)

Method: ran `decideNotFound` from `094da7b` (store stubbed; no DB, no model, no spend) with round 10's pages: fixture certificate,
BS page 1 (OPMC roster), overseas clause P20, and a panel GP page under "SECTION 6: CLINICAL BENEFITS (OUTPATIENT MEDICARE POLICY)".
Added a "Singapore or overseas" line, a spouse with OPMC on the shared certificate, and Daniel himself with OPMC. Ran the new
`bill_place` detector (`loop.ts:2141-2143`, copied verbatim) on seven messages.

## R10 items

| item | verdict | evidence |
| --- | --- | --- |
| R10-1 panel GP of an unlisted policy | fixed when Daniel does not hold OPMC | case A: quote, then "Daniel's certificate lists ... (as of 6 October 2022) ... OPMC, which that certificate does not list" and "sits under 'SECTION 6 ... (OUTPATIENT MEDICARE POLICY)', which Daniel's certificate does not list. Only the insurer ... can confirm"; **but see R11-1** |
| R10-2 overseas ranking | fixed for "unknown" and "home" | case B: the overseas clause is never the answer, only said apart with "applies only if the treatment was abroad"; case C: "Singapore or overseas" is quoted; **but see R11-2** |
| R10-3 unlinked / whose | fixed by the same note | any quoted line not from the person's confirmed certificate gets "does not say whose cover that line is" and the insurer line |
| R10-4 heading quoted | fixed | "Panel GP Benefit" is no longer quoted |

## New findings

**R11-1. High: the new note can tell the person he does not hold the cover he does hold.** `whoseLines` decides "not listed" by a
literal phrase search of the whole certificate text (`absence-scope.ts:313`, `listed`).
- The scheme name is searched as "Outpatient Medicare Policy" and the section as "CLINICAL BENEFITS (OUTPATIENT MEDICARE". A
  certificate heading "GROUP OUTPATIENT MEDICARE(POLICY NO ...)" or "GROUP OPMC(POLICY NO ...)" matches neither.
- Case E (Daniel's own rows include Group Outpatient Medicare): the answer says "Daniel's certificate lists ... Group Outpatient
  Medicare ..." and then "names the scheme's Outpatient Medicare Policy (OPMC), which that certificate does not list" and "sits under
  ... (OUTPATIENT MEDICARE POLICY), which Daniel's certificate does not list".
- Case E2 ("GROUP OPMC"): the second claim is still made.

That is a false statement about his own cover, sitting beside the panel GP benefit that applies to him. It can stop a valid claim:
the hides-a-benefit class. Also, `listed` reads the whole certificate, not his rows, so a spouse's matching heading would suppress the
sentence for him (an A2 cousin, not reproduced). Fix: compare against `cert.products` (his rows only) with the same normalisation
G1's must-not-fire checks use (name without "Policy"/"Group", or the abbreviation). Read a policy name from the section heading
only from an explicit "(... POLICY)" or "... POLICY" phrase. When unsure, say only that the document does not say whose cover it is;
never "does not list".

**R11-2. Medium-High: the "abroad" detector fires on ordinary Singapore messages, and then the overseas clause is quoted first
with no caveat.** `away` matches any "in <Capitalised word>": "saw a GP in Tampines", "GP in Raffles Place" and "fell in Grace's
room" all read as abroad. It also reads every earlier user turn (`userTexts`), so a Japan death two turns ago makes today's GP bill
"abroad". With `bill_place = "abroad"`, `billLines` quotes abroad-only lines first and drops the "applies only if abroad" sentence.
That is the live symptom again. Fix: "abroad" only on explicit words (overseas, abroad, on holiday, travelling, a trip) in the
current message, and default to "unknown", which is already safe. Even for "abroad", keep the "outside Singapore" line's own wording
quoted, which it is.

**R11-3. Low-Medium: the whose-cover facts are a trailing note, not a statement next to the quote.** They go into `notes`
(`loop.ts:2156`), appended after all sentences. They are not evidence-checked, and if the composer drops the quote they remain
alone ("does not say whose cover that line is" with no line). Ask the Test engineer for one render check that the note sits
directly under the quote and that returned = saved = reopened. Better: emit it as a server statement right after the quote.

**R11-4. Low (wording):** "The only line found is in the Scheme X Group Insurance (page 2) prints a benefit for treatment outside
Singapore" is ungrammatical (`loop.ts:2158`). Also "Outpatient Medicare Policy Policy" (R6-4) now appears here too.

## Verdict on PR #64 at `094da7b`

**Not ready to merge.** R11-1 is the blocker: in a household whose certificate does list the outpatient policy, the answer says it
does not. R11-2 should be fixed with it; both are small and local. R10-1 to R10-4 are fixed for the cases they were raised on.
No paid run; scripted reproductions only.

---

# Round 12: PR #64 head `7f4dbd3`

Method: the same `decideNotFound` reproductions as rounds 10-11, from `7f4dbd3` (store stubbed; no DB, no model, no spend), plus the
new `bill_place` detector copied verbatim (`loop.ts:2143-2144`).

| item | verdict | evidence |
| --- | --- | --- |
| R11-1 false "does not list" | fixed | E ("GROUP OUTPATIENT MEDICARE" on Daniel's rows) and E2 ("GROUP OPMC"): no "does not list" anywhere; the section is named and the insurer line kept. A: still says OPMC is not on his certificate (true). D (spouse holds OPMC on the shared certificate): judged on Daniel's rows only, so "does not list" stays (true) |
| R11-2 abroad detector | fixed | "GP in Tampines", "GP in Raffles Place", "fell in Grace's room" and a trip in an earlier turn all give `unknown`; only "on holiday" etc. in the current message gives `abroad` |
| R11-3 note placement | fixed in substance | the note is added only when the quote survives composing, and first among this step's notes (`loop.ts:2168`) |
| R11-4 wording | fixed | "The only line found for this is in the ..."; no "Policy Policy" (G1 and the new note) |
| R10-1 to R10-4 | still fixed | A, B, C as round 11 |

The new "does not list" rule only speaks when none of the person's own products shares a distinctive word with the policy name or
its abbreviation. G1's must-not-fire gains the same check. Both err toward silence, which is the safe side.

## Residual (Low, not blocking)

- **R12-1:** `merged.notes` puts the earlier reply's notes before this step's, so when the model's own reply carried notes, the
  whose-cover note is not strictly directly under the quote (`loop.ts:2169`). Worth one render check by the Test engineer
  (returned = saved = reopened, and the order).
- **R12-2:** with an unknown place, the "only for treatment outside Singapore" sentence is now pushed before the home quote, so it
  reads first. It carries its own caveat, so this is order only.
- **R12-3:** the note is matched to the kept quote by its first 60 characters. Composing never edits a quote today (no S$ rewrite
  of a quoted bare "$"), but if that changes, the note would silently drop.

## Verdict on PR #64 at `7f4dbd3`

**Ready to merge from the Critic's side.** No blocker remains. Nothing reproduced states a wrong claimable amount, quotes an
overseas-only line as the answer for a bill at home, presents another policy's wording as his cover, or says he lacks cover his
certificate lists. The evidence is scripted reconstruction only (no live run; OpenAI configuration). The model-dependent parts are
unshown, and so is whether DC's real scheme prints its panel GP under a "... POLICY" heading.

---

# Round 13: PR #65 (UI polish), head `72568be4f5ab814155914811cab3520d14c77fbb`, base main `ca6af69`

Scope: `app/chat/page.tsx`, `app/policies/page.tsx`, `components/source-list.tsx`, `components/AppShell.tsx`, `app/globals.css`.
Nothing under `lib/` changes. Read-only review; nothing run against a database or model.

**1. "Try reading it again" (`app/policies/page.tsx:164-181`).** It posts `{ policyId }` to the existing
`/api/policies/reprocess`.
- **No cross-household reach.** The route resolves the policy with `id=$1 AND account_id=<household>` under the user's own client,
  returns 404 otherwise, and re-checks the quarantine state (`route.ts:29-47`). The button adds no new server path; the household
  could already call it through the locked-PDF form. Double taps are guarded (`retryingId`, and the route's `AlreadyProcessing`).
- **R13-1. Low (C1-3 now one tap away).** Re-reading rewrites `policy_pages` in place with the same id and hash, and
  `stale-answers.ts:56-69` withdraws a saved absence only on a hash change or scope growth. The button shows on any document with a
  non-password `processing_error`. A document can have that error after some pages were stored. In that case a saved "what was
  read" answer, or a citation into those pages, is not withdrawn when the re-read changes them. The partial-scope wording
  understates ("could not be checked"), so it does not overclaim. No amount rests on an unreadable document's pages in any case I
  traced. Accept under C1-3, or show the button only when the document has no stored page text.

**2. One source row per document (`components/source-list.tsx`).** Nothing is hidden:
- every distinct page is listed;
- every distinct excerpt is kept, deduplicated only on identical text;
- rows are keyed by `policyId`, so two people's certificates, or two versions of a product (different ids), stay separate rows.

Citations carry no person, and a shared scheme booklet is one document, so one row is correct. This was an improvement: the old
list showed no words at all.
- **R13-2. Low:** the label, document date and "does not confirm cover today" flag come from the document's *first* citation. For
  one document these should agree, but if a later citation alone carried `notConfirmedCurrent`, the flag would be lost. Take
  `some(...)` for the flag.
- **R13-3. Low:** excerpts over 320 characters are cut with "…" in the panel. A long passage's qualifier could fall past the cut.
  The answer text itself keeps it, and "Open in Documents" reaches the page. Consider cutting at a sentence end, or not cutting.
- If `policyId` were ever empty, the key falls back to `policyName`, and two same-named documents would merge with one "Open in
  Documents" link. The type makes `policyId` required, so this is noted, not a finding.

**3. Bold "bottom line" (`answer-lead`).** The class bolds the whole `message.content` paragraph that was already shown first. It
moves no sentence and splits nothing from its qualifier: the server writes each amount's qualifier inside the same sentence
(calculation and terms statements, round 6-9 checks). Details still render below as before. No way found for it to present a
qualifier-less amount as the answer. If the content holds several statements, the whole block is bold, which is cosmetic.

## Verdict on PR #65 at `72568be`

**No blocker from the Critic.** It is presentation only: no change to answer text, citations, isolation or saved answers. R13-1 is
an existing accepted risk (C1-3) made more reachable. R13-2 and R13-3 are small polish. The mobile e2e spec needs the Test
engineer's update (Claims and Household are now under More), as the PR says.

---

# Round 14: PR #66 ("what do i do now"), head `23af18248495ccf79e9ff60678964b8a0f5f9ed2`, base main `ca6af69`

Read-only review of `loop.ts` `whatToDo` (`:2578-2589`) and the `contactStepFor` change (`:1682`). Nothing run.

**R14-1. High: the repeated steps are the model's raw `next_steps` arguments, not the steps the household was shown.** The PR says
it repeats "the server's own rendered steps". The code reads `t.toolCalls[...].args.next_steps` from earlier turns (`:2581`), and
`args` is `call.arguments` as the model sent it (`record(call.name, call.arguments, ...)`, `:2245`, `:2331`). Composition filters
steps *after* that point (`compose.ts:1417-1440`):
- it drops a step that states a figure ("a next step may not state a figure");
- it drops a step that names the wrong insurer;
- it drops a "must / required / need to submit" requirement no document prints;
- it drops a step that promises cover or money (`unsafeNextStep`);
- it labels unsupported paperwork.

`whatToDo` puts the raw strings straight into `composed.nextSteps`, past all of those. So "what do i do now" can show:
- "Claim S$2,500 under Simple Fracture" (an amount without its conditions);
- "You must submit the claim form with receipts" (the exact general advice the composer removed in the live turn 7);
- a step naming another household member's insurer.

The answer is then saved and reopened that way. Fix: repeat the steps the earlier answers actually showed (their saved, composed
`nextSteps`), or run the repeated strings through the same step filters before showing them.

**R14-2. High: no person or scenario boundary.** `earlier` takes every turn before this one (`:2581`), whatever its subject. Some
steps were given for Grace before "it was Daniel, not Grace". Some came from a superseded scenario, or from an answer later
withdrawn by a correction. All are repeated, newest first, deduplicated, under "the next step from my earlier answer". This breaks
the contract that a correction must not contaminate another person's later scenario. Fix:
- take steps only from turns whose answer subject is the current subject;
- take them only since the latest correction, reassignment or new scenario for that person;
- never from an answer the conversation withdrew.

If that cannot be told, show only the open question.

**R14-3. Medium: `contactStepFor` takes the event from all earlier user messages** (`:1682`). After a death question then a fracture
question, `familiesOf(userTexts.join(" "))` holds both. The first certificate record matching either family supplies the insurer
contact step, so the step can belong to the previous scenario's benefit. Fix: use the latest message that names an event, not the
union.

**R14-4. Low: the open question.** It is read from the current `state.pending`, so it is this conversation's live question; a fact
already supplied would have closed it, and none is re-asked. But `requirementQuestion` / `conditionQuestion` run *after* `whatToDo`
and can turn the reply into an ask card for the same question. The note "One thing I asked is still open: ..." then sits above the
same question card: a duplicate. Check that order with one scripted render.

**Returned = saved = reopened.** It goes through the normal composed path, so it is consistent. Under R14-1 and R14-2, though, it
is consistently wrong.

## Verdict on PR #66 at `23af182`

**Not ready to merge.** R14-1 and R14-2 are blockers: the fallback can surface amounts and requirements the composer had removed,
and steps for the wrong person or an earlier scenario. Both fixes are local to `whatToDo`. Without them the safe fallback is to show
only the open question, plus the server's own insurer contact step for the current event.

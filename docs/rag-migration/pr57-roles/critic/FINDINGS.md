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

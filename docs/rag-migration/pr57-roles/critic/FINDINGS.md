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

---

# Round 15: short-answer cards (PR #65 branch head `989f34b`, cards commit `2d56c27`)

Scope: `components/answer-cards.tsx`, the cards switch in `app/chat/page.tsx` (:327-331, :410, :415), and the fixture
`scripts/fixtures/ux/answer-cards-fr1.json`. This was read only, with no build and no model calls. The server does not send
`statements[]` or `bottomLine` yet, so on today's server the cards path never runs and production answers render as before.
The findings below are about what happens once the Developer's answer-fields change starts sending those fields.

## R15-1 (High): an amount card never says whose amount it is

`AmountCard` (answer-cards.tsx:39-57) renders `amount`, `text`, `basis`, `conditions`, the source and the date. It never renders
`personName`. In the fixture, card s1 shows "S$1,250 · Simple Fracture · arm, elbow, wrist or ribs" with no name. Only the bottom
line says Grace. In a whole-family answer, two people's cards would look identical. That breaks "each benefit stays tied to its
person". Fix: put `personName` on the card, and keep a card hidden when `personName` is missing and the answer is about more than
one person.

## R15-2 (High): qualifiers leave the card

- The card shows the short `text`. `fullText` holds the conditional wording ("If the Simple Fracture benefit applies to Grace's
  case …"), and that wording is never shown. The card keeps only the label "illustration".
- In s2, the qualifier "The documents do not define which fractures count as Other Fracture, so the insurer decides" sits in
  `source.note`. That only renders inside the collapsed "Where this comes from" section (:71). The amount S$120,000 shows
  without it.
- A `benefit_terms` (or any) statement with `amount: null` renders as a bare `<p>{text}</p>` (:92). Its `basis` and
  `conditions` are dropped, not even collapsed.
- The "not a payment or an insurer's decision" footer appears only when at least one amount is an illustration (:94). The type
  says `text` has no "not a payment" tail. So a printed amount (illustration=false) loses that qualifier entirely.

Fix: on the card itself, show a qualifier line whenever `fullText` starts with a condition or `source.note` names a limit on
cover. Render `basis` and `conditions` for every statement, not only amount ones. Show the footer for printed amounts too.

## R15-3 (High): cards replace the whole answer text

When `statements[]` is present, page.tsx:330-331 drops `message.content`, and :410 drops `answer.details`. Anything the prose
says that is not one of the statements disappears. Examples are a scheme or certificate listing, the death-completion sentence,
a second benefit, or a "not found in these documents" scope line. Hiding a documented benefit is a failure. Fix, either of:
(a) the server guarantees, and a test checks, that every sentence of `content` and `details` maps to a statement; or (b) the UI
shows the remaining prose sentences under the cards, or at least a "Full answer" disclosure with `content` and `details`.

## R15-4 (High): statements skip the server's money checks, so returned and reopened answers can differ

`sanitizeStoredAnswer` → `enforceLiveChatMonetaryBoundary` (monetary-boundary.ts:304-323, :248-271) runs when a saved answer is
reopened. It rewrites `claimItems`, `policyStatedLimits`, `potentialPayoutTotals` and `payoutQualifiers`. It does not touch
`statements[]`. `verifyAnswerFigures` (answer-verification.ts:1294) and `invalidateAnswersWithDeletedPolicies` also read only the
existing fields. So when the boundary strips an amount from the prose on reopen, the card still shows it. A statement can also
carry a figure that verification never checked. Fix (Developer, with the fields change): run `statements[].amount`, `basis` and
`conditions` through the same verification and monetary boundary as the prose, on both the live path and the reopen path, and drop
the card when its figure is removed. A test should compare the cards for one answer as returned, saved and reopened.

## R15-5 (Medium): the fallback can show a sentence twice, and the bottom line has no link to its qualifier

- With no `bottomLine`, the summary is hidden only when it exactly equals a statement's `fullText ?? text` (:89). A summary
  that differs by markdown, a date rewrite or one trimmed clause shows next to the card that says the same thing. The two
  versions can differ in their qualifiers, with the summary carrying the "If …" and the card not. Fix: compare after the same
  `render` normalisation, or have the server mark which statement the summary is.
- `bottomLine` renders on its own, in bold, first. Nothing ties it to the conditions it depends on. The fixture's "may be able
  to claim" is fine, but the UI has no guard. The server contract should require that a `bottomLine` naming an outcome carries
  its qualifier in the same sentence.

## R15-6 (Low): the wording for an unknown currency assumes a bare "$"

`currencyResolved: false` always renders "The document prints a bare “$”" (:72). That is wrong when the figure has no symbol,
or prints "dollars". Use "The document does not say which currency" unless the server says a bare $ was printed.

## Answers to the coordinator's four questions

1. Can a card show an amount without its conditions, person or currency status? Person: yes, always (R15-1). Conditions: yes,
   for the "If … applies" wording and the insurer-decides note (R15-2). Currency status: no, "currency not stated" stays on the
   card.
2. Can `bottomLine` appear without its qualifier? Yes, nothing prevents it (R15-5).
3. Can the fallback mix `fullText` and card fields so a statement shows twice or half? Twice, yes (R15-5). Half, yes, because
   `text` replaces `fullText` (R15-2) and the rest of the prose is dropped (R15-3).
4. Do returned, saved and reopened answers render the same? The rendering is the same if the stored JSON keeps `statements`,
   which it does (`answer_json` is copied whole). But the reopen path re-applies the monetary boundary to the prose and not to
   the statements, so they can differ (R15-4).

## Verdict on the cards at `989f34b`

**Safe to merge as a dormant change; not safe to switch on.** No server path sends `statements[]` today, so PR #65 changes no live
answer. R15-1 to R15-4 must be fixed before the Developer's answer-fields change lands. R15-1 to R15-3 are UI fixes. R15-4 belongs
to the Developer.

---

# Round 16: removing a person from a document (PR #67 head `0b56452`)

Scope: `app/api/policies/link-person/route.ts`, the `assignments` branch, read against `lib/chat/stale-answers.ts`,
`sql/schema.sql` and the readers of `policy_coverages`. This was read only, with nothing run.

## What holds

- **No other household is touched.** Both ids are checked against the caller's household before any write. Every delete or
  update filters on `account_id`, `policy_id` and the removed member ids, and the user-table writes run through the RLS client.
- **The document itself is not deleted or changed,** apart from moving the upload profile.
- **Nobody still ticked is touched.** The policy-members delete excludes everyone in `ids` and leaves
  `scheme_reference_match` links alone.
- **The household's own records survive.** `coverage_rules` keeps rows where `origin='person'`. `premium_records` has no
  origin column, but its `source_document_id` is only ever written by ingest and linking (`lib/rag/ingest.ts:694-727`,
  `lib/policies/linking.ts:142`), never by `/api/premiums`. So the delete only reaches rows read from the document.
- **Rows read for kept people are untouched.**

## R16-1 (High, introduced here): re-ticking the person does not bring their cover back

Removing a person deletes their `policy_coverages`, `premium_records` and `coverage_rules` rows for this document. It also
clears the detected-name match. Ticking them again only inserts a `user_declared` link (route.ts, insert loop). Nothing re-reads
their rows. So after a mis-tap and an undo, the person is shown as covered, but:

- the Coverage page and dashboard (`app/api/coverage`, `app/api/dashboard`) show none of their cover from this document;
- `policy-answer.ts` and `registry-answers.ts` find no premium or coverage row for them.

The chat's rag2 path still reads the pages, so the loop answers are less affected. On main, removal didn't work at all, so this
loss is new. Hiding a documented benefit is a failure. Fix: when a person is linked again, rebuild their rows from the stored
reading (the `syncInsuredPersonToMember` path, or a targeted re-read). At minimum, the save response and the screen should say
"re-analyse to restore their cover details".

## R16-2 (High): saved answers that relied on the removed person are not withdrawn or marked

`invalidateAnswersWithDeletedPolicies` (stale-answers.ts:48-) withdraws an answer only in three cases:

- a cited document is deleted;
- the file hash changed;
- an absence scope grew.

A smaller scope is not one of them. So an answer saved before the removal still reopens with no "out of date" note. For example,
"Grace's fracture illustration is S$1,250 from this document" stays as it was. An answer still being written when the save lands
is saved under the old links too. This is the same family as the accepted "superseded answers unmarked" item, so fix it before
public launch: mark answers whose `claimItems` or citations pair this document with a person no longer linked to it.

## R16-3 (Medium): two of the writes are outside the save's transaction

The `policy_coverages` delete and the upload-profile move run with the server `query` after the user transaction has committed
(route.ts, after `createUserSupabaseClient`). If either fails, the route returns 500 "Link failed", but the links are already
gone. That leaves half a removal:

- If the coverage delete fails, the Coverage page and the registry answers keep the person's cover from this document.
- If the profile move fails, `policies.family_member_id` stays on the removed person, and `searchableDocs` and `benefits.ts`
  still treat them as covered. The chat keeps answering for them from this document, which is the exact bug this PR fixes.

Fix: run both on one connection in one transaction, or make the move idempotent and retry it. At minimum, return the removal
as partial so the screen doesn't show "Saved".

## R16-4 (Medium): a document read already running can undo the removal

The PR notes that a re-analysis rebuilds name-matched links. It does not cover the case where a read is already running when
the household saves. The ingest job then re-inserts the `ai_name_match` link, the coverages and the detected match after the
save. The person comes back while the screen says "Saved". Fix: refuse the save, or queue it, while `processing_status` is not
`ready`. The stored exclusion the PR offers as a decision would fix both this and the later re-read case.

## R16-5 (Low): refusing "covers nobody" is right, but the message points to deleting

Refusing an empty list is needed while `policies.family_member_id` is NOT NULL and the chat treats the upload profile as
covered. Reference wording is unaffected, because its links are `scheme_reference_match` and are not shown. The one real case is
a document for someone outside the family profiles, for example a parent not yet added. There the 409 says to delete it. Better
wording: "Add the person it covers in Family first, or delete it if it isn't your family's."

## Answers to the coordinator's questions

- Can the clearing delete or change another person's or household's records, or the document? No (see "What holds").
- Is it scoped to this document and person only? Yes.
- Are saved answers withdrawn or marked? No (R16-2).
- Is there a race with an in-flight read? Yes (R16-4).
- Does "covers nobody" block a legitimate case? Only a document for someone not yet added, and the message could say so (R16-5).
- Is it reversible by re-linking? The link is, but the person's cover details are not until a re-analysis (R16-1).
- Also: two writes sit outside the transaction (R16-3).

## Verdict on PR #67 at `0b56452`

**No blocker on scope or safety. Fix R16-1 before merging, or ship it with a screen note.** The scoping is sound, and the PR fixes
a critical bug on main. But R16-1 means that undoing a mis-tap silently drops the person's cover details from the Coverage page
and dashboard. The cheapest acceptable fix is to rebuild that person's rows when they are linked again. Failing that, show the
note "re-analyse to restore". R16-2 and R16-3 should follow before public launch. R16-4 can wait for the stored-exclusion
decision. The `r5:ux-test` source check that pins the old behaviour is the Test engineer's to update.

---

# Round 17: PR #66 re-check at `c00e41e` (R14 fixes)

Scope: `git diff 23af182 c00e41e -- lib/`, which touches `loop.ts` `whatToDo` and `contactStepFor`, `hook.ts` (sets
`trace.shown`) and `types.ts`. The repro is a scratch script that mirrors the new selection logic line for line, with no model
calls. It checks which turn's steps a "what do i do now" repeats and which event the contact step uses.

## R14 re-check

| Finding | Status at `c00e41e` | Evidence |
|---|---|---|
| R14-1 raw `args.next_steps` | **Fixed.** The repeat now uses `TraceTurn.shown.nextSteps`, copied from `c.nextSteps`, which are the composed and filtered steps the answer showed (hook.ts, final branch). | The repro repeats only the composed step. |
| R14-2 person or scenario boundary | **Partly fixed.** It uses one previous answer, only for the same person, and never when this turn corrected or withdrew something. See R17-1 for the gap. | Grace → Daniel (final turn): no repeat. Grace → Daniel (ask turn): no repeat, because the person differs. Correction in this turn: no repeat. |
| R14-3 event union | **Fixed.** It now uses the latest user message that names an event (`userTexts` includes the current message). | death → fracture → "what do i do now" gives `fracture` only. |
| R14-4 duplicate open question | **Fixed.** The "still open" note is gone, and the question shows once, as its card. | Code read. |

## R17-1 (High): an ask turn is not a boundary, so an older scenario's steps can come back for the same person

`trace.shown` is set only on the `reply.kind === "final"` branch (hook.ts, after `answer.nextSteps = c.nextSteps`). It is not set
on the ask branch, the unknown-person branch or the plain-text branch. `whatToDo` takes the latest earlier turn that has `shown`
(`filter(t => ... && t.shown).at(-1)`), not the immediately previous turn. Repro:

1. Turn 1: "my mum Grace died". The final answer shows "Tell the insurer about the death and ask for the death claim form".
2. Turn 2: "Grace broke her arm". This becomes an ask card (for example "was it an accident?"), and no `shown` is recorded.
3. Turn 3: "what do i do now". The reply keeps nothing, and the turn-1 death steps are repeated under "from my last answer".

The repro returns `["Tell the insurer about the death and ask for the death claim form"]`. That is the R14-2 scenario
contamination again, through a common path, and the code comment ("only the immediately previous answer") does not match.

Fix (hook.ts, a few lines): record `shown` on every branch, with `nextSteps: []` when the turn showed none. Or have `whatToDo` read
only `state.turns.at(-1)` and repeat nothing if that turn has no `shown`.

## R17-2 (Low): `shown` is copied before the save gate

`trace.shown` is copied before `enforceLiveChatMonetaryBoundary`, `verifyAnswerFigures` and `rescueRejected`. Those can rewrite
or drop `answer.nextSteps[i]` (answer-verification.ts:1299, :1399). So `shown` can hold a step the household never saw. The later
turn runs the gate again on the repeated steps, which limits the harm. Copy from `answer.nextSteps` after the final gate so
"shown" means shown.

## R17-3 (Low): steps from an answer withdrawn later are still repeated

An answer can be withdrawn after it was shown, for example when its document is deleted (`invalidateAnswersWithDeletedPolicies`).
Its `shown` steps are still repeated by a later "what do i do now". Skip `prev` when any of its cited documents is no longer active,
or accept this as part of the "superseded answers" item.

## Regressions

There are none outside `whatToDo` and `contactStepFor`. `types.ts` only adds an optional field. Older saved states have no
`shown`, so the fallback simply does nothing for them, which is safe. The rest of the diff is the Developer's own repro script.
The returned, saved and reopened answer is still the normal composed path, so it is consistent.

## Verdict on PR #66 at `c00e41e`

**Not ready to merge: one small fix left.** R14-1, R14-3 and R14-4 are fixed. R14-2 is fixed except for R17-1, where an ask turn
in between lets an older scenario's steps come back for the same person. Recording `shown` on every turn closes it. R17-2 and
R17-3 can follow.

---

# Round 18: short-answer cards re-check (PR #65 head `91bccc4`, fixes in `3402884`)

Scope: `components/answer-cards.tsx` and the `prose` hand-off in `app/chat/page.tsx`. The repro is a scratch script that runs
the file's own `norm`, `sentences`, `conditionOf` and `safeBottomLine`, copied verbatim, on sample sentences. No build and no
model calls.

## R15 re-check

| Finding | Status | Evidence |
|---|---|---|
| R15-1 whose amount | **Fixed for named statements.** The card shows "For {personName}". When an answer names more than one person, an amount with no name falls back to its full sentence. See R18-3 for the gap. | Code read. |
| R15-2 qualifiers | **Mostly fixed.** `source.note`, `basis` and `conditions` now render on every card and point, and the footer covers printed amounts too. The "If …" clause extraction has a real defect, see R18-1. | Script. |
| R15-3 prose dropped | **Fixed.** `prose` = content + details. Sentences no statement covers show under "Also in this answer", and everything is under a collapsed "Full answer". The matching has a gap, see R18-2. | Code read. |
| R15-5 shown twice / bottom line | **Improved.** Matching is now normalised. A bottom line with an outcome word and no hedge is hidden, but the hedge list is weak, see R18-4. | Script. |
| R15-6 bare "$" | **Fixed.** | Code read. |
| R15-4 statements skip the money checks | **Open.** This is the Developer's, and nothing on this branch changes it. | — |

## R18-1 (High): the "If …" clause extraction can print a wrong amount or cut a condition short

`conditionOf` cuts at the first comma outside “…” and (…). Script output:

- "If the bill exceeds S$1,000, the benefit pays 80% …" → **"If the bill exceeds S$1"**. That is a wrong figure shown on an
  amount card, which is the worst class of bug.
- "If Grace is hospitalised for more than 3 days, and the stay is medically necessary, …" → "If Grace is hospitalised for more
  than 3 days". The second condition is lost.
- "If the Other Fracture benefit applies, subject to the S$500 deductible, …" → "If the Other Fracture benefit applies". The
  deductible is lost.
- Straight quotes `"Arm, Elbow, …"` → `If … case "Arm`. Square brackets `[Plan A, Plan B]` → `[Plan A`.
- "The illustration is S$1,250 if the benefit applies" → nothing. A condition placed after the amount is not found, so the card
  shows no condition.

The fixture's own sentence works only because it uses curly quotes. Fix: never parse a condition out of prose in the UI. Either
the server sends it as its own field, or an amount whose `fullText` carries a condition shows the whole `fullText` on the card. At
minimum, do not cut at a comma between digits, and fall back to the whole sentence whenever the clause would end inside a number,
a quote or a bracket.

## R18-2 (Medium): a prose sentence counts as covered when it is any substring of a statement

`isCovered` hides a prose sentence from "Also in this answer" when its normalised text is contained anywhere in a statement's
text or `fullText` (`c.includes(n)`). In the script, "It is not covered." and "Core Scheme." both count as covered by an
unrelated statement that happens to contain those words. Short, important sentences are the ones most likely to be hidden. They
are still under the collapsed "Full answer", but not in view. Fix: treat a sentence as covered only when it equals a statement's
text or `fullText`.

## R18-3 (Medium): the multi-person fallback only works when someone is named

`asCard` shows a nameless amount card whenever `people.size <= 1`. When no statement has a `personName` (size 0), every amount
becomes a nameless card, even in a whole-family answer. When one person is named and another amount has no name, that card also
shows with no name and sits next to the named one. Fix: show a nameless card only when the answer is about exactly one person
(`answer.resolvedFamilyMemberId` set) and every amount either carries that name or none.

## R18-4 (Medium): the bottom-line guard lets flat outcomes through

`HEDGE` counts "not", "would" and "only" as hedges. These bottom lines all pass, by the script:

- "Grace is not covered for this." (a flat exclusion; missing information is not an exclusion);
- "Grace would get S$1,250.";
- "Grace can only claim S$120,000.".

The guard is a backstop. The server contract still has to make sure a bottom line carries its qualifier. At least remove "not",
"would" and "only" from `HEDGE`, and do not show a bottom line that states an amount unless an amount card shows that same
figure with its condition.

## Verdict on the cards at `91bccc4`

**Still safe to merge as a dormant change; not yet safe to switch on.** No server path sends `statements[]`, so live answers do
not change. R15-1, R15-3, R15-5 and R15-6 are fixed or much improved. R18-1 has to be fixed before the server fields go live,
because it can put a wrong figure on a card. R18-2 to R18-4 are short UI fixes, and R15-4 is still the Developer's.

---

# Round 19: PR #65 merge check at `7ccc837`

Scope: `git diff 91bccc4 7ccc837`, which covers the R18 fixes in `fbe8c0f` and the stalled-read copy in `7ccc837`. I also skimmed
every live UI change since my last full review at `72568be`: chat sources, dashboard cost, Family, Usage, Records, Ledger and
Schedule empty states, and the covers picker. Read only.

## R18 re-check

| Finding | Status |
|---|---|
| R18-1 clause extraction | **Fixed.** `conditionOf` is removed. The card shows the server's `conditions[]`, or, when there are none, the whole `fullText`. Nothing is cut in the browser. |
| R18-2 substring coverage | **Fixed.** A prose sentence counts as covered only when it equals a statement's text, its `fullText`, or one whole sentence of either. |
| R18-3 nameless cards | **Fixed.** An amount without `personName` is never a card. It shows as its full checked sentence with its qualifiers. |
| R18-4 bottom-line guard | **Moved to the server contract.** Only the server's `bottomLine` is shown, and none is derived in the browser. Acceptable while the field doesn't exist. Carry it into the Developer's answer-fields contract. |

## R19-1 (Low, contract note for the Developer's fields change)

When `conditions[]` is present, the card no longer shows `fullText`. So the "If the … benefit applies to Grace's case" wording
must also be one of the `conditions[]` items. Otherwise it appears only under the collapsed "Full answer". The same contract
should also say:

- a `bottomLine` that names an outcome carries its qualifier;
- statement amounts go through `verifyAnswerFigures` and the monetary boundary on both the live and reopen paths (R15-4).

## Live UI changes since `72568be`

I found no problems in the live UI changes:

- **Chat sources:** source rows add the document type, the household's own file name (from the household-scoped
  `/api/policies`) and the date. Excerpts are now shown whole, so no end-of-passage qualifier is cut.
- **Dashboard cost:** shows "Not known yet" instead of S$0.00 when there is no payment evidence.
- **Family:** no "parent" is guessed by default.
- **Coverage and Benefits:** a "couldn't be read" state with Try again replaces "still being read" forever.
- **Previous chats:** the list opens on an empty chat.

None of these touches amounts, people's links or saved answers.

## Verdict on PR #65 at `7ccc837`

**Ready to merge** from the Critic's side. The live UI changes have no blocker. The cards are dormant, because no server path
sends `statements[]`, and they now hold up against R15 and R18 for when it does. Before the cards are switched on, the Developer's
fields change must cover R15-4 and R19-1. GitHub Actions is billing-blocked, so the local check results are the Test engineer's to
confirm. The merge is DC's call.

---

# Round 20: PR #66 merge check at `e91d5b7`

Scope: `git diff c00e41e e91d5b7 -- lib/`. In `hook.ts`, `trace.shown` is now set once on the shared tail, after the final
`verifyAnswerFigures`, for every branch, with `[]` when the turn made a correction or withdrew something. In `loop.ts`,
`whatToDo` reads only the immediately previous turn. `runLoopChatTurn` has no early return before the tail (hook.ts:163-323), so
every loop turn records `shown`. The repro is a scratch script that mirrors the new selection logic.

| Check | Result |
|---|---|
| R17-1: death → fracture ask card → "what do i do now" | **Fixed.** Nothing is repeated, because the ask turn recorded `shown` with no steps. |
| R17-2: `shown` copied before the gate | **Fixed.** It is copied from `answer.nextSteps` after the final gate. |
| R17-3: steps from a withdrawn answer | **Fixed for this turn and the previous one.** A turn that withdrew support records no steps, and this turn's `invalidated` blocks the repeat. |
| Same scenario: final answer with steps → "what do i do now" | Its steps are repeated, as intended. |
| Another person in between, or an old saved state with no `shown` | Nothing is repeated. |

**R20-1 (Low, note).** A turn answered outside the loop does not add to `state.turns`, for example a registry or library question
handled by the older path. So "what do i do now" after one can repeat the loop answer before it. It is still the same person, and
nothing new in scenario terms came from the loop, so I accept this.

R14 and R17 are all closed, and I found no regressions. The rest of the diff is the Developer's repro script.

## Verdict on PR #66 at `e91d5b7`

**Ready to merge** from the Critic's side. GitHub Actions is billing-blocked, so the local check results are the Test engineer's to
confirm. The merge is DC's call.

---

# Round 21: PR #67 merge and deploy-safety check at `37777de`

Scope: `git diff 0b56452 37777de`. That covers the `coverage-assignments.ts` save and restore, `member-exclusions.ts`,
`sql/policy-member-exclusions.sql`, the exclusion checks in `linking.ts` and `ingest.ts`, `read-failures.ts` with the Benefits and
Ledger reading states, and the runbook entry. Read only.

## R16 re-check

| Finding | Status at `37777de` |
|---|---|
| R16-1 re-tick restores cover | **Fixed for documents that name the person.** `rebuildForAddedPeople` re-runs `syncInsuredPersonToMember` from the stored reading, with no model call, and resets `ledger_read_at`, so the ledger re-reads and adds rows. For a generic booklet that names nobody, only the ledger rows come back, which matches how they were made. It runs after the save with errors logged and not surfaced, so a failure leaves the person ticked with their cover rebuilt on the next ledger read (R21-3). |
| R16-3 atomic save | **Fixed.** Links, coverage rows, premiums, detected names, ledger rows, the remembered removal and the upload-profile move all run in one `withServiceTransaction`, every statement scoped by `account_id` and `policy_id`. The ids are authorised through the RLS client first. |
| R16-4 a re-read or an in-flight read undoing the removal | **Fixed once the migration is applied.** Every automatic link writer skips a remembered pair: name match (`syncInsuredPersonToMember` returns early, before links or coverages), upload profile (`ingest.ts`) and matching wording (`linking.ts`). A read already running when the save lands is covered too, because the check happens at write time. Matching wording no longer overwrites a `user_declared` tick. Before the migration, behaviour is as on main, so a re-read can bring the person back. |
| R16-5 "covers nobody" copy | **Fixed.** It now says to add them on the Family page first, or delete the document. |
| R16-2 saved answers not marked | **Still open.** Not in scope here. Fix before public launch, together with "superseded answers unmarked". |

## Deploy safety: code deployed before the migration

- **Every reader of the new table checks first.** `exclusionsReady()` checks `to_regclass` and caches only `true`. Without the
  table, `notExcludedClause` returns "", `isExcluded` returns false, and `saveDocumentCoverage` skips both exclusion statements.
  Nothing queries the absent table, so Documents, link-person, re-reads and the chat cannot 500 on it.
- **The reading-state additions are guarded too.** `readFailureNotes`, `noteReadFailure` and `clearReadFailure` check the
  `reading_cache` column and swallow their own errors. `reading_cache` already exists in production, written by the ledger since
  before this PR. So Coverage (`/api/ledger`) and Benefits (`/api/benefits/index`) only gain a `documents` field.
- **No half-done removal.** The whole save is one transaction, with or without the table.
- **Result:** deploying code first is safe. Removals made before the table exists are simply not remembered, which is main's
  behaviour.

## The migration

- **Additive:** it creates one table and two indexes, and changes no existing table, column or row.
- **Idempotent:** it uses `IF NOT EXISTS`, `DROP POLICY IF EXISTS` and then `CREATE POLICY`.
- **RLS-scoped:** RLS is enabled with the same `is_household_member(account_id)` policies as `policy_members`, `anon` is revoked,
  and the table is in `table-inventory.ts`.
- **Reversible:** `DROP TABLE`, and the runbook gives the checks.

## R21-1 (Low): the exclusion check doesn't compare households

`notExcludedClause` matches on `policy_id` and `family_member_id` only. The RLS insert check is `is_household_member(account_id)`
only. A signed-in member of household A who knew household B's document and person UUIDs could write a row with A's
`account_id` through a browser grant. That row would stop B's automatic re-link. The UUIDs are random and never exposed across
households, so this is not exploitable in practice, but it is cheap to close:

- add `AND x.account_id = <the document's account>` to the clause;
- add a `WITH CHECK` requiring that `policy_id` and `family_member_id` belong to `account_id`.

This is a follow-up, not a blocker.

## R21-2 (Low): rolling back needs a restart

`exclusionsReady()` caches `true`. If the table is dropped as a rollback, warm servers keep querying it, and link-person saves and
re-reads error until restarted. Add "redeploy, or restart the functions, after DROP TABLE" to the runbook's rollback line. The
reverse case is handled: a warm server picks up a newly applied table, because `false` is not cached.

## R21-3 (Low): a failed restore is silent

When `rebuildForAddedPeople` fails, it only logs. The person shows as ticked, and their coverage rows wait for the next ledger
read or a re-analysis. That is acceptable for now, and it should go on the list of things to show on screen later.

## Verdict on PR #67 at `37777de`

**Ready to merge** from the Critic's side. R16-1, R16-3, R16-4 and R16-5 are fixed, and R16-2 is still open for before launch.

**Safe order:** either order works without errors. The better order is to **apply `sql/policy-member-exclusions.sql` first**
(staging, then production, with DC's explicit yes, using the runbook's psql line and checks), then merge and deploy. That way
remembered removals work from the first deploy. Merging first is also safe: removals made before the migration are simply not
remembered, as on main. The migration and the merge are both DC's call.

---

# Round 22: PR #69 at `7b1574e`: out-of-date notes for removed people and corrected answers

Scope: `lib/chat/stale-answers.ts`, `app/api/chat/history/[id]/route.ts` and `types/index.ts`, read against
`lib/rag2/calc/engine.ts` (how calculation ids are made), `loop.ts` (where calculations are marked withdrawn) and
`app/chat/page.tsx`. Read only.

## What holds

- **Another person on the same document is not marked.** Pairs come from each figure binding's and calculation's
  `subjectId` and `policyId`. A pair counts as covered while any `policy_members` row or the upload profile joins them, so an
  answer about Daniel stays valid after Grace is removed from the same document.
- **Superseded is exact.** `calcId` is a content hash of calculator, policy, benefit, person, operands, steps and conditions
  (engine.ts:89), and `record.id = calcId`. Only an answer carrying that exact calculation is marked. If the same calculation is
  worked out again after a correction, it is re-recorded with `withdrawn: null` (loop.ts:2673/2698), so the answer comes back,
  which is right because its inputs are true again.
- **It follows every way a calculation is withdrawn:** a fact correction (:995), a change of person (:438), the benefit no
  longer fitting (:416), and a deleted or replaced source (:2796).
- **Nothing withdrawn is still shown.** Invalidated answers now also drop `figureBindings`, `computations` and `calculations`.
- **No cross-household effect.** Both queries filter on `account_id`, and pairs are limited to this household's active
  documents.
- **Reversible.** Ticking the person again brings the answer back, because nothing is written.
- **Consistency.** Reopening is deterministic from the stored answer plus the current links and chat state. The returned
  answer is marked only after a reload (known limit), so returned and reopened differ only in the direction of being more
  current. Neither shows a withdrawn figure as current once reloaded.

## R22-1 (Medium, fix before or with merge): the alert says a document was deleted, whatever the reason

`app/chat/page.tsx:305` always renders "Out of date. A policy document this answer relied on has been deleted". Under this PR, a
corrected answer reopens as "This earlier answer was replaced by the corrected answer below" with that alert above it. That tells
the household a document was deleted when none was. The same false alert already shows for `documents_added`. Fix: one line in
the page that chooses the alert by `invalidated.reason`, or shows no alert when the summary already says why. The PR names this
as the designer's copy, but it should land with this PR, not after it.

## R22-2 (Low): an answer about two people is hidden entirely when one is removed

`unlinked` uses `.some`. An answer covering Grace and Daniel on one document is replaced in full when Grace is removed, and
Daniel's still-valid figures are hidden behind "ask again". That is conservative, the notice is honest, and nothing wrong is
shown, so I accept it. Ideally only Grace's part would be withdrawn.

## R22-3 (Low): coverage gaps, so the open items are only mostly closed

- An answer with no figure bindings or calculations is never marked `person_unlinked`. For example, "Grace is covered by this
  document" with no figure.
- A statement-only answer is not marked `superseded` after a correction (the PR states this).
- A calculation made outside `state.claim` or `otherClaims` is not tracked, for example an informational what-if with no claim
  open. So it can't be marked superseded.
- Until a reload, the earlier answer in the same open chat still shows its withdrawn figure (the PR states this). The corrected
  answer below does say what no longer applies (hook.ts correction notes), which limits the harm.

**Coverage of the open items:** R16-2 is closed for answers with figures, which are the ones that matter for amounts.
"Superseded answers unmarked" is closed for calculation answers after a reload. It is still open for statement-only answers and
within the open session.

## Verdict on PR #69 at `7b1574e`

**Ready to merge once R22-1 is fixed.** That is a one-line alert change, so the chat doesn't tell the household a document was
deleted when an answer was only corrected or a person removed. The logic is scoped correctly, marks no valid answer about another
person, and shows no withdrawn figure after a reload. R22-2 and R22-3 can follow. Within them, marking the earlier answer in the
same open chat is the one that matters most before public launch.

---

# Round 23: PR #70 (answer fields) at `0cd6a49`

Scope: `answer-statements.ts`, `reconcileStatements` in `monetary-boundary.ts`, the `structure()` drafts in
`statement-render.ts`, the `hook.ts` and `workflow.ts` wiring, `excerptOf` and `sentenceEnd` in `evidence.ts`, and `types`.
These were read against `lib/chat/stale-answers.ts` and the history route on main `9a76490`. Read only.

## What holds

- **R15-4: fixed.** `reconcileStatements` runs after the figure gate on return (via `buildStatements` in hook.ts), again after
  the save-time gate in `saveTurn`, and on reopen inside `enforceLiveChatMonetaryBoundary` (`sanitizeStoredAnswer`).
  - A statement keeps its fields only when its `fullText` is exactly a paragraph that is still shown, its fields state no number
    the paragraph doesn't, every amount in the paragraph is on the card, an amount names its person, and no scan-unclear figure is
    in it.
  - Anything the gate or boundary changed falls back to that paragraph's plain text.
  - It is pure and idempotent, so returned = saved = reopened.
- **The plain-text fallback never drops a condition.** The fallback statement is the whole paragraph.
- **R19-1: fixed for calculations.** The card's short text keeps "If the … applies to Grace's case “…”". The undefined-kind
  note and the row notes, including the thumb/finger/palm footnote, are in `conditions[]`. Printed benefit terms keep their quoted
  printed conditions, and trip limits are added to conditions.
- **R18-4: fixed for server bottom lines.** Every generated bottom line names who decides ("only the insurer decides …"), and
  `reconcileStatements` drops a bottom line that has no hedge or that states a figure not on a kept amount card.
- **personName after a correction: no finding.** `personName` is the record's own member at render time (`r.memberName`, the
  calculation's `who`), not the conversation subject. A correction re-renders for the new person, and PR #69 marks the old
  answer.

## R23-1 (High, blocker together with PR #65): invalidated answers keep their statements and bottom line

`invalidatedAnswer` (stale-answers.ts) clears summary, details, claim items, citations, limits and, after PR #69, calculations. It
does not clear `statements` or `bottomLine`. The history route runs `sanitizeStoredAnswer` (and with it `reconcileStatements`)
before `invalidateAnswersWithDeletedPolicies`. So a reopened answer marked out of date because its document was deleted, its
person was removed, or it was superseded still carries the old amount cards and the bottom line, for example "Grace's documents
print either S$1,250 or S$120,000 …". The PR #65 page renders cards whenever `statements` is non-empty, so the withdrawn amounts
reappear under the out-of-date note. Fix: `invalidatedAnswer` sets `statements: []` and `bottomLine: null`. Running
`reconcileStatements` afterwards is not enough, because a figure-free bottom line such as "If you go ahead, start here: …"
passes its checks.

## R23-2 (High): an either-or group takes in every calculated amount, not just the two alternatives

`buildStatements` groups all `kind === "calculation"` amounts once any uncertainty statement names two documents
(`alternatives = statements.filter(s => s.amount && s.kind === "calculation")`). Example: an answer shows the two fracture
alternatives plus a third calculated amount for a different benefit, such as a hospital-income illustration for the same
event. All three get the group, and the bottom line says "Grace's documents print either S$1,250, S$120,000 or S$X for this
(alternatives, not a total), and only the insurer decides which applies". That tells the household the third amount replaces the
others, when it may be paid in addition. Fix: group only the calculations the relation note itself rendered. `renderStatements`
already loops over exactly those (`rendered` / `outs` for the two policies), so record their result ids on the drafts, or key the
group by those two policy ids and benefit. Leave every other amount ungrouped, and leave the "either" bottom line off when other
amounts exist (use the "several amounts" line instead).

## R23-3 (Medium): narrowing citations can drop the source of a paragraph the gate shortened

`evidenceOf` keeps a composed sentence's evidence only when the paragraph still contains that sentence's text exactly (after
squashing spaces). When `rescueRejected` replaces a rejected figure sentence with its figure-free part, the paragraph no longer
contains the original text. Its evidence is then filtered out of `answer.citations`, even though the shortened paragraph still
rests on it. The household sees a claim with no source. Fix: also keep evidence for a paragraph that is contained in a composed
sentence (`squash(s.text).includes(p)`), or carry the evidence ids through `rescueRejected`.

## R23-4 (Low): the excerpt run-on can pull in an unrelated line

`sentenceEnd` continues through up to three following lines that start in lower case and are not table lines. A line that ends
in a letter and is followed by an unrelated lower-case line, such as a wrapped heading fragment, would join it. This is for
display only and never chooses support. Stopping at a line that starts with a footnote marker or a numbered clause would be
enough.

## Verdict on PR #70 at `0cd6a49`

**Not ready to merge.** The money-check wiring (R15-4) and conditions on cards (R19-1, R18-4) are done well, and the fallback is
safe. But R23-1 and R23-2 are blockers. PR #65 is ready to merge, and its page switches the cards on as soon as this PR sends
`statements[]`. The two would then show withdrawn amounts under out-of-date notes (R23-1) and frame an independent amount as an
alternative (R23-2). Both are small, local fixes. R23-3 should go in the same push.

---

# Round 24: PR #70 re-check at `c685b92`

Scope: `git diff 0cd6a49 c685b92 -- lib/`, which covers `stale-answers.ts`, `monetary-boundary.ts`, `answer-statements.ts`,
`statement-render.ts` and `evidence.ts`. I also read the Developer's repro output `answer-shape-output.txt`. Read only.

## R23 re-check

| Finding | Status |
|---|---|
| R23-1 out-of-date answers keep cards | **Fixed twice over.** `invalidatedAnswer` sets `statements: []` and `bottomLine: null`, and `reconcileStatements` empties both for any `answer.invalidated` on return, save and reopen. That also covers the PR #69 reasons. |
| R23-2 either-or takes every amount | **Fixed.** The group is set only on calculations the two-document relation note re-rendered (`alt`). The "either A or B" bottom line is used only when the group is every amount on the answer. Otherwise the bottom line is the neutral "N amounts that may apply, each with its own conditions". The repro unit check confirms a third amount stays ungrouped. |
| R23-3 citations of a shortened paragraph | **Fixed.** Evidence is kept when a sentence of the paragraph (40 characters or more) is inside a composed sentence. |
| R23-4 excerpt run-on | **Fixed.** It continues into one short line only (six words or fewer, and only if that line ends the sentence). |

## The other changes

- **Accident condition (Evidence Reviewer E1):** read from the benefit's own lead-in on the table's page. It is added to the
  sentence and to `conditions[]` only when the page prints it. The figure checks cover it, because it states no number.
- **Ruled-out amounts as plain text:** an amount whose printed period has ended, or that another paragraph says does not apply,
  is sent as its whole sentence, not a card. This only moves amounts toward plain text, which is the safe direction.
- **Short labels:** the card's text is now a label ("Simple Fracture · Arm, Elbow, Wrist or Ribs"). The "only if … applies" and
  "not a payment or an insurer's decision" wording moved into `conditions[]`, which the page renders on the card. Nothing is lost.
- **Bottom line:** a printed amount on its own is never the outcome. The figure check now counts only amounts and percentages, so
  a page number or date no longer fails it.

## R24-1 (Medium, one line): the bottom-line count leaves out amounts shown as plain text

"Your documents print {count} amounts that may apply" counts only amount cards. In the death answer the Developer named, Term Life
S$1,000,000 is sent as plain text, so the bottom line says "two amounts" while the answer prints three. A headline that
undercounts the household's benefits partly hides one. Fix: when any plain-text paragraph that is not ruled out states an amount,
leave out the number ("Your documents print amounts that may apply …"), or count those paragraphs too.

## R24-2 (Low): two relation notes for one person share a group id

The group id is `alt:${subjectId}`. If one answer has two different benefits, each with its own two-document relation, all four
illustrations share one group. The bottom line would then say "either A, B, C or D". Add the benefit (or the pair of policy ids)
to the id.

## Open, not the Critic's to close

The hosted-model path has not been run (it needs a paid run with DC's yes). The cards follow the composed prose, and every
check runs on the server whichever model writes, so the risk is in what the model writes, not in the fields.

## Verdict on PR #70 at `c685b92`

**Ready to merge once R24-1 is fixed** (one line). R23-1 to R23-4 are fixed, with tests for the two blockers, and the new changes
only move amounts toward safer display. R24-2 can follow. PR #65 can merge in either order with this one after that.

---

# Round 25: PR #70 at `76de2d8`

Scope: `git diff c685b92 76de2d8 -- lib/`, which covers `answer-statements.ts` (the bottom-line count) and `statement-render.ts`
(group ids and the trip verdict). The repro is a scratch script that runs the new trip-verdict expressions, copied verbatim, on
sample household messages. No model calls.

## R24 re-check

| Finding | Status |
|---|---|
| R24-1 count leaves out plain-text amounts | **Fixed.** The count is said only when no plain paragraph states money. Otherwise it reads "Your documents print amounts that may apply …". |
| R24-2 shared group id | **Fixed.** The id is `alt:{member}:{sorted policy pair}:{injury}`, with the injury read from the row label without its kind label. A hip and an arm are separate choices, and a row with no partner stays ungrouped (a singleton group is dropped by reconcile). The bottom line for several groups says "two alternative amounts for each injury below". |

## R25-1 (High, blocker): the new trip verdict tells the household that cover does not fit, from guesses

`tripLimits` now adds "On what you have told me, this trip's cover does not fit this event: …". It does so when either:

- `elsewhere` is set, from the first capitalised word after "in" in the household's words; or
- the period has ended and `recent` matches.

`recent` includes the bare word "just". The script, on the expressions copied verbatim, gives this:

| Household said | Destination | Result |
|---|---|---|
| "My dad died in a car accident in Tokyo" | Japan | "you said it happened in **Tokyo**, not Japan", so **does not fit** |
| "He broke his leg in March while skiing" | Japan | "you said it happened in **March**, not Japan", so **does not fit** |
| "Dad died on 12/03/2025 in Japan, I just found the policy" (inside the printed period) | Japan | `recent` from "just", so "ended … before the event you described" and **does not fit** |
| "She was admitted in Singapore after flying home from Japan" | Japan | "in **Singapore**, not Japan", so **does not fit** |

That sentence then does three things:

- It joins the amount's `conditions[]`.
- It matches `VERDICT` ("does not fit"), so the amount is demoted from a card to plain text.
- It becomes the bottom line ("a printed benefit whose condition … is the outcome").

So the headline tells the household a documented benefit doesn't apply, on a misread. That is the "hiding a documented benefit"
and "missing information is not an exclusion" failure, said as the answer.

Fix: remove the verdict and keep the earlier neutral sentence ("whether that trip fits this event is for the insurer to
confirm"). If a reason is wanted, say only what is printed next to what the household recorded, without a conclusion. Two
examples:

- "The period printed is 10/03/2025 to 17/03/2025; you said it happened last week."
- "The destination printed is Japan."

Use only recorded facts: an event date compared with the period, and a recorded location. Never take a capitalised word after
"in", and never the word "just".

## Two injuries in one message: "which injury?"

Asking "which injury?" when the household named two, for example "he broke his wrist and his hip", is a problem. Both injuries
may each have a benefit, and the new grouping already keeps one either/or choice per injury. Making them pick one hides the
other's amounts, and they may not know that both count. The chat should take both as reported facts and answer each, one group
per injury. If something is genuinely unknown, it should ask about both at once ("was each from an accident?"), never make
them choose. I haven't traced where the question comes from in this diff. It belongs to the Developer's injury fact handling,
as a separate fix, not a blocker for this PR on its own.

## Verdict on PR #70 at `76de2d8`

**Not ready to merge.** R24-1 and R24-2 are closed. R25-1 is new in this push and is a blocker: the trip verdict can turn a
covered event into "does not fit" as the bottom line. Removing the verdict, which brings back the previous neutral wording, is
enough to merge.

---

# Round 26: PR #73 (server prefetches `resolve_person`) at `c67c02e`

Scope: `git diff b7e18f8 c67c02e -- lib/`, which covers `loop.ts` (the prefetch) and `scripted-model.ts` (test only). This was
read against how `resolve_person` results are handled (loop.ts, around :2417, `setSubject`). The repro is a scratch script that
runs the PR's own `namesFor`, `said` and `named` expressions, copied verbatim, on sample messages. No model calls.

## What holds

- **No other household's people.** Candidates are `input.people`, the household's own members, and the call goes through the
  same `resolve_person` tool, so no other household's person can be picked.
- **Same checks as a model call.** The prefetched call runs through the same handler, result recording and evidence path. It is
  not metered or counted as a step, and `trace.adjusted` records it.
- **Ambiguous names.** Two members sharing a name means two matches, so there is no prefetch.
- **Open questions, taps and claims.** It is skipped while a question is open, after a person was tapped, and once a claim
  exists, so person corrections stay with the existing logic.

## R26-1 (High, blocker): name matching is looser than the model and picks the wrong person

`namesFor` returns every name token of 3 or more letters, so "Tan Hui Min Grace (Grace)" gives Grace, Tan, Hui and Min. `said`
matches each one **case-insensitively** anywhere in the message. A single match triggers `resolve_person`, and an `ok` result
calls `setSubject` (loop.ts ~:2423). So the conversation is bound to that person before the model reads the message. Script
output:

| Message | Prefetch |
|---|---|
| "What is the **grace** period for my premium?" | Grace (mention "grace"). "Grace period" is an insurance term. |
| "**Will** my policy cover dental?" | Will (a member named Will) |
| "I waited 30 **min** at the clinic, can I claim?" | Grace, through her given name "Min" |
| "Sarah, **Grace**'s colleague, broke her arm at work" | Grace, though the event is Sarah's, and Sarah is not a member |
| "Grace broke her arm" | Grace, correct |

Before this change, the model decided whether a word was a name, whether the event was about a non-member ("Sarah"), and whom
to resolve ("I"). Now the server binds the subject first, and the model starts from that result. A model that does not re-resolve
answers about the wrong person's policies. That is the wrong-person failure the contract treats as worst. The offline proof
covers only three clean turns (FR1 t1, K6A, K6B) with unambiguous capitalised names, so it cannot show this.

Fix, all of these:

- Match only the member's display or preferred name, case-sensitively with its capital letter, and never single tokens such as
  surnames or middle names.
- Skip tokens that are common words or insurance terms (grace, will, may, hope, joy, mark, min, …).
- Skip when the message also names someone who is not a household member, or a possessive pattern ("X's colleague / friend /
  boss").
- Or, safer: pass the prefetched result to the model as a hint and let the model's own `resolve_person` call `setSubject`. That
  keeps most of the saving where the model agrees, and none of the risk.

## R26-2 (Low): it isn't limited to the first message about an event

The condition is "no open question, no tap, no claim", not "first message about an event". Informational follow-ups ("and for
Daniel?") get a prefetch too. That is fine for clean names, but it widens R26-1's exposure to every non-claim turn.

## Second person mentioned later

On a later turn with no claim, R26-1 applies again. With a claim, the prefetch is skipped and the existing correction logic
decides. So the risk is confined to turns without a claim, which are exactly the informational questions where words like
"grace period" come up.

## Verdict on PR #73 at `c67c02e`

**Not ready to merge.** R26-1 can bind a conversation to the wrong person on ordinary messages, with no model step to catch it,
and the PR can't be confirmed live before merge. Either tighten the matching as above, with tests for the four rows in the table,
or keep the result as a hint that doesn't set the subject. Until then, set `DEARPOLICY_PREFETCH_PERSON=0` as the default.

---

# Round 27: PR #73 at `6e8a09d` (restarted from main `9a76490`)

Scope: `git diff 9a76490 6e8a09d -- lib/`, which covers `prefetchMention`, the prefetch, the context-only handling in
`loop.ts`, and `scripted-model.ts`. The repro is a scratch script that runs `prefetchMention` and `COMMON_WORD_NAMES`, copied
verbatim, on 16 messages. No model calls.

## R26 re-check

| Finding | Status |
|---|---|
| R26-1 wrong person | **Closed.** The server's lookup no longer calls `setSubject`. Its result carries a note ("Use this person only if the question is about them; otherwise call resolve_person"). The person becomes the subject only when the model's next calls use that `subject_id` without calling `resolve_person` itself, which is what a model-made lookup leads to anyway. Matching needs the member's whole preferred name, capitalised. It skips common words and insurance terms (grace, will, may, min, …), possessives, "Name period/cover/…", and any other capitalised word inside a sentence. Script: "grace period", "Will my policy", "30 min", "Sarah, Grace's colleague", "Daniel's friend", "Daniel … in Japan", and lower or upper case names all give **no prefetch**. "Daniel broke his arm" and "Adrian Tan died last week" give Daniel and Adrian Tan. |
| R26-2 every non-claim turn | **Closed.** It runs only when `state.history` is empty (the conversation's first message), and it is off by default (`DEARPOLICY_PREFETCH_PERSON=1` turns it on). |

## R27-1 (Low): a non-member named as the first word of a sentence isn't caught

The "other capitalised word" check skips the first word of each sentence (`slice(1)`). So "Sarah fell and Daniel took her to
hospital" and "Sarah fell. Daniel took her to hospital" prefetch Daniel, although the event is Sarah's and she isn't a member.
Because the result is now context only, the model still reads the message and is told to resolve someone else if needed, so this
is a nudge, not a binding. To close it, also check a sentence's first word, skipping only ordinary sentence starters (My, The,
What, Can, Is, How, Does, Do, When, Where, Why, Who, Please, Hi, Hello, Our, His, Her, If, After, Yesterday, Today, Last, And,
But, So).

## Verdict on PR #73 at `6e8a09d`

**Ready to merge** from the Critic's side. Off by default, it changes nothing.

**Switching it on by default:** I'd be comfortable once R27-1 is fixed (one line), because the lookup is now context only and
fires only on a clean first message. Before switching it on, one short paid check with the real model, which DC has approved,
should include "Sarah fell and Daniel took her to hospital" and one clean message. It should confirm two things: the model
resolves Sarah itself in the first case, and the model-call count drops in the second. The saving is one model call (about 2.5 to
3 seconds), and only on a conversation's first message.

---

# Round 28: PR #73 at `69e9065` (R27-1 fix, on by default)

**R27-1 is closed.** A capitalised first word now counts as another name unless it is in `SENTENCE_STARTS`. I re-ran the 16
messages from round 27 plus 5 more, with the PR's own code copied verbatim:

- "Sarah fell and Daniel took her to hospital" and "Sarah fell. Daniel took her to hospital" now give no prefetch.
- "Daniel broke his arm", "Yesterday Daniel broke his arm" and "My son Daniel broke his arm" still give Daniel.
- Every round-26 trap still gives no one.

The default is now on for hosted models, and `DEARPOLICY_PREFETCH_PERSON=0` turns it off.

**Verdict: ready to merge**, with the production checks after deploy as agreed with the coordinator:

- use real member names;
- read the outcome from the trace;
- have a deploy slot ready for the switch-off, because turning it off with the env flag needs a redeploy.

---

# Round 29: PR #74 (wrong amounts, either/or alternatives) at `1a73ddd`

Scope: `git diff effa2a2 1a73ddd -- lib app`, which covers `amount-alternatives.ts`, the `ledgerAlternatives` and
`coverageForLedgerRow` code in `ledger/store.ts`, `events.ts` (liability and per-plan), `extract.ts` `rowSupported`,
`scale-limit.ts` `statesItsOwnBase`, `benefit-catalog.ts` `coverForEvent`, and the two routes. Read only.

## What holds

- **No alternative is ever summed.** `amountAlternatives` only lists options. Nothing in the diff adds them, and the
  regressions assert that no S$453,750 or S$121,250 appears anywhere.
- **No alternative is picked silently.** A group is returned whole or not at all: if any option can't be worked out, there is
  no group. The same figure printed twice is not offered as an alternative.
- **No alternative goes to the wrong person.**
  - The options are worked out per contract (one owner, one scheme's documents), and the sum insured is that owner's cover
    (`coverageForBenefit(contract, …)`).
  - `/api/benefits` sends a group only when every contract showing the row produces identical options. So a spouse on a
    different sum insured gets no shared group.
  - `/api/ledger` maps options per `benefitId|ownerId`.
- **Inferred-base rows are unchanged.** `statesItsOwnBase` applies only to rows carrying the "from the heading of the
  schedule" note. Heading-inferred rows such as the cheekbone S$1,500 still scale (test kept).
- **The other fixes are sound:**
  - Accident rows join the accident cover (`coverForEvent`, unresolved when it can't tell).
  - Per-plan rows and "Not covered" rows carry no figure.
  - No existing expected value changed.

## R29-1 (Medium, fix before merge): the liability test reads the whole quote, so a real death benefit can be dropped

`rowSupported` rejects any row not mapped to "other" when `THIRD_PARTY_LIABILITY` (`liable|liability|third party|to other
people`) matches the joined name, detail **and printed quote** (`part`). Personal accident quotes often carry wording such as "the
Company shall not be liable for death caused by …" or "liability of the Company". An accidental-death row whose quote includes that
sentence is then dropped from Coverage, so a documented benefit is hidden. Fix: test only the row's name and detail. Or require
the third-party sense ("liab\w* (?:to|for) … (?:other people|third part)", "third[- ]party liability", "personal liability").

## R29-2 (Medium): alternatives are grouped by row name alone

`rowKey` keeps only letters and digits of the benefit name. Two rows with the same generic name in different tables of one
scheme are offered as alternatives of each other, even when they pay for different events. Examples are "Others", "Any other
bone", or "Leg" in a fracture table and a dismemberment table. Fix: also require the same event (`eventForBenefitName(...).event`)
and the same `requires` (accident). For extra safety, leave out names shorter than about 4 letters, or names that are generic
("others", "any other", "total").

## R29-3 (Low, the designer's): until the page draws the group, the two rows still read as two benefits

The ledger still has one row per option, each with its own figure, and the new `alternatives` field is only data. Until Coverage
and Benefits render the group with its note (ux-design/coverage-alternatives-shape.md), the screen shows S$1,250 and S$120,000 as
two rows with nothing saying "never added together". That is no worse than main, but the page change should follow soon. Also,
when one option can't be worked out, there is no group, but the remaining row still shows its own single figure. That is the
existing behaviour.

## Verdict on PR #74 at `1a73ddd`

**Ready to merge once R29-1 is fixed** (one regex). The alternatives can't be summed, picked silently or attached to the wrong
person, and inferred-base rows are unchanged. R29-2 is a short follow-up, best in the same push. R29-3 is for the designer.

# Round 30: PR #75 household isolation at `6a31182`, PR #76 "Not in my family" at `7e87b9b8`

Asked: can either PR read, write or hide anything across households, and is the code safe while the optional table is absent?
Read the lib/app/sql diffs against `effa2a2`. No builds, DB suites or paid calls.

## PR #75 at `6a31182`

- `lib/ledger/store.ts` `addLedgerRow`: the INSERT only runs when the person (`family_members.account_id=$1`) and, if given,
  the document (`policies.account_id=$1`) belong to the caller's household; otherwise no row and the route returns 404
  (`app/api/ledger/route.ts`). Closes the cross-household write.
- `lib/lifecycle/coordinator.ts` `requestInvitationRevocation`: the lookup joins the caller's own `household_members` row, so an
  invitation in another household reads as "not found", and a non-owner gets `NotFoundError`, both before any
  `deletion_requests` write. Still the plain pool, but now scoped by the caller join; fine.
- `sql/storage-rls.sql`: adds `household-exports` to the safety-net UPDATE. Only takes effect when DC re-applies the file.
- No new table, so nothing depends on an optional migration.

**Verdict: ready to merge.** Note for the release list: re-apply `sql/storage-rls.sql` after merge.

## PR #76 at `7e87b9b8`

Isolation checks, all pass:
- Every dismissal read is tied to the row's own household and document (`name-dismissals.ts` `notDismissedCondition`:
  `nd.account_id=pd.account_id AND nd.policy_id=pd.policy_id`). A row filed under another household hides nothing (R21-1 lesson
  applied; the regression at `scripts/system-database-regressions.ts:1357-1367` covers both directions).
- Writes run in the caller's RLS session after the document is authorised against `ctx.householdId`; the INSERT/UPDATE
  policies also require `policies.account_id = account_id`, so a browser can't file a dismissal on another household's document
  or under another household (tests at :1355-1356). DELETEs are scoped by `account_id`.
- `notFamily: true` checks the name is on that document (404) and unlinked (409) before writing.
- `refreshReviewState` (link-person `route.ts`) runs on the service pool but only after the household transaction authorised the
  document, and filters by `account_id` and `policy_id`.

Table absent: `dismissalsReady()` uses `to_regclass`, caches only `true`, and every caller falls back to "" (no filter), so
GET /api/policies and the dashboard behave exactly as on main; link-person returns `remembered:false` without touching the table.
No 500 path found.

## R30-1 (Low): a re-read brings the "not linked" review flag back for a dismissed name

`lib/rag/ingest.ts:751-760` counts every unmatched detected name for `needs_review`/`review_reason` and doesn't know about
dismissals. After a re-read the name stays hidden (correct), but the document is flagged for review again with "1 named insured
person is not linked", and the household can't clear it because the name is no longer listed. Fix: apply
`notDismissedClause` (or skip dismissed keys) when ingest computes `unmatched`. Follow-up is fine.

## R30-2 (Low, existing pattern now reached more often): `refreshReviewState` overwrites reasons it doesn't compute

It rebuilds `review_reason` from unmatched names and unverified items only, so the ingest-only reasons ("linked to the profile it
was uploaded to … Check this is the right person", "not named in it …") are erased. Linking already did this on main; a "Not in
my family" tap now does it too, which can clear a "check this is the right person" warning that has nothing to do with the
dismissed name. Fix: keep those reasons (recompute them, or only remove the "not linked" clause). Follow-up is fine.

## R30-3 (Low): saved, then 500

The review refresh now runs after the commit. If it fails, the dismissal or link is saved but the route returns 500. Retrying is
safe (`ON CONFLICT DO NOTHING`, idempotent DELETE), so this is only a confusing message. Optional: catch and log instead.

## Verdict on PR #76 at `7e87b9b8`

**Ready to merge.** Nothing reads, writes or hides across households, and it is safe before `sql/detected-name-dismissals.sql` is
applied. Apply that file after `sql/policy-member-exclusions.sql`, in either order relative to the deploy. R30-1 and R30-2 are
short follow-ups.

# Round 31: PR #74 wrong amounts at `25365a5` (R29-1, R29-2 fixes)

Read `git diff 1a73ddd 25365a5` (extract.ts, amount-alternatives.ts, both regression scripts) and traced the real wrist rows
(reviewer-confirmations.md §1: Product Summary p13 and Benefit Summary p8 are two separate documents in the household, so the
new "different documents" rule fits the real case and the DB fixture change matches reality). Scratch check: `eventForBenefitName`
gives `other` for "Arm , Elbow, Wrist or Ribs 25%" and `fracture` for the "(Other Fracture)" row, so `namedEvent` does not split
the real pair. No builds, DB suites or paid calls.

R29-1 is fixed for the reported case and R29-2 is fixed (generic names skipped, one-document pairs skipped, conflicting named
events skipped; four cases plus a control).

## R31-1 (High, fix before merge): the liability guard now trusts the reader's own label, so a liability sum can become the person's death benefit

`extract.ts:112-115` tests `THIRD_PARTY_LIABILITY` only against `benefitName`/`detail`, which are the extraction model's labels
(kept when ≥60% of their words are on the page, `fact-check.ts:81-92`). The guard exists for rows the model has already
mis-typed. Trace: a travel or home page prints "Legal liability for accidental death or bodily injury to third parties
S$500,000". The model returns `benefitName:"Accidental Death"`, `eventType:"accidental_death"`. "Accidental" and "death" are on
the page, so the name counts as printed; it doesn't match the liability pattern; `eventSupported("accidental_death", names+part)`
passes because the quote says "accidental death". The row is kept, and S$500,000 owed to other people reads as the person's own
accidental death cover. That is a wrong claimable amount. Before this push, the quote's "liability" dropped it.

Fix (one regex): keep the name test, and also test the printed quote with the third-party sense only, e.g.
`/third[- ]part(?:y|ies)\b|\bto other (?:people|persons)\b|\b(?:personal|legal|public) liabilit\w*|\bliab\w* (?:to|for)\b[^.]{0,60}\b(?:others?|third)\b/i`.
"The Company shall not be liable for death caused by war" matches none of these, so the R29-1 case stays kept. Add the trace above
as a case next to the R29-1 test.

## R31-2 (Medium, follow-up): exact trait equality may stop DC's real wrist, hip and ankle groups forming

`sameBenefitKey` requires identical `traits`. The two real rows get their traits by different paths (`catalog-builder.ts:165-173`):
the Product Summary row has no keyword trait, so it takes the categorising model's `respondsTo` as is. The "(Other Fracture)" row
has the keyword `bodily_injury` plus only the model's traits in the same family. If the model adds `disability` to one, or its call
fails (keyword `["other"]` against `["bodily_injury"]`), the group silently doesn't form. That is not a wrong amount: each row keeps its own figure, as
on main. But the fix this PR is for may not show up for the real household, and the DB test hard-codes equal traits. Fix: compare
only the traits that tell benefits apart (`death`, `disability`, `illness`, `hospitalisation`), not `accident`, `bodily_injury` or
`other`. Also add the wrist group on Coverage to the post-deploy Live site check.

## R31-3 (Low): two documents' same-name rows with the same traits still group

"Leg 50%" in a fracture table of one document and "Leg 50%" in a dismemberment table of another both read as event `other`. When
the model gives both the same traits, they are offered as alternatives. Both figures are real and nothing is summed, so the harm
is a wrong pairing note. Accept for now.

## Verdict on PR #74 at `25365a5`

**Not ready: fix R31-1 first** (one regex plus one case). R31-2 is a follow-up and a post-deploy check. R31-3 is accepted.

# Round 32: PR #77 design pass at `12eac98`

Read the diff from the merge base `0417567` (pages, components, CSS; nothing in lib/ or app/api/). Focus: anything readable as a
coverage claim (Coverage gaps line, either/or block, amounts without a figure) and whether Family remove and "Not in my family"
can touch another household. No builds or browser runs.

Passes:
- Either/or (`components/alternative-amounts.tsx`): drawn only for a complete group (≥2 options), once per person per group,
  labelled "Either / or" with "or" between options and the server's note; no total is computed anywhere. Benefits draws it only
  for an established line. It stays dormant until #74 sends `alternatives`.
- Gaps line wording: "Not found in your uploaded documents" / "in the documents read so far", plus "a plan you haven't uploaded
  may still cover", "more may appear", or the unreadable-document note. It never says "not covered". Good.
- Isolation: "Not in my family" and Undo only call #76's `POST /api/policies/link-person`, which authorises the document and
  name against the caller's household (round 30). The browser fallback keys on `policyId:name`, and policy ids are per household,
  so it can't hide anything in another household. Family removal still uses the existing server path; "Go to Documents" only
  replaces the button. `?person=` filters the household's own list in the browser. Pass.
- Chat: conflict, stopped-waiting and failure messages are kept. The wait names a step only when the server sends `stageId`.

## R32-1 (High, fix before merge): "Covered." is printed for plan-type guesses whose own note says "if covered"

`app/ledger/page.tsx` `amountLine`: any row with `paysKind==="stated"` now reads **"Covered. Your documents don't print an amount
for this."** (main showed "as stated in the plan — no figure on file"). Many stated rows are not read from any benefit. They are
seeded from `PRODUCT_DEFAULTS` (`lib/ledger/events.ts:173-200`, `store.ts:164-173`, origin `schedule`, status `proposed`) only
because a schedule line names a plan type. Their notes are "fractures, **if covered**, are paid from the plan's fracture table",
"accident medical expenses, **if covered** …", "early-stage conditions, **if covered** …", and the travel, motor and home ones.
So a Group Personal Accident line alone makes Coverage say "Fracture: Covered." That is an unconfirmed coverage claim, and the
"if covered" qualifier is stripped. The same rows also feed the Documents "found" line and the Family kinds chips (both read
`/api/ledger` rows with `status !== "rejected"`), so the document card says it was found to pay for fractures.

Fix: say "Covered." only for a row the person confirmed or one read from the wording (`status==="confirmed" || origin==="wording"`).
For a proposed schedule row, say something like "Plans like this usually include this. Your documents don't confirm it or print
an amount." Leave proposed schedule rows out of the Documents "found" line and the Family chips (or label them "to confirm").

## R32-2 (Low): gaps come from Coverage event types only

`coverGaps` maps ledger `eventType`s to kinds. A benefit the reader typed `other` (or one that is only on the Benefits page, not
in the ledger) doesn't count, so for example "hospital or medical cover" can be listed as not found while Benefits shows a
hospital benefit. The wording is hedged, so this is a misleading pointer, not a false "not covered". Follow-up: also treat a
Benefits row of that kind as found, or add "see Benefits by policy" to the line.

## R32-3 (Low): before #76, "Not in my family" shows an error, not the device-only fallback

On main, `link-person` still requires `familyMemberId`, so `{notFamily:true}` gets a 400 and the page shows "Could not save that
answer". The PR body says it falls back. It's harmless, but merge #76 first.

## R32-4 (Low): device-only answers are not cleared at sign-out

`localStorage["dearpolicy.notFamily"]` keeps document ids and printed names after sign-out on a shared device. Nothing crosses
households (the ids are per household), but it's a privacy leftover. Optional: clear it on sign-out or once the server remembers.

## Verdict on PR #77 at `12eac98`

**Not ready: fix R32-1 first** (the stated-amount line, plus the found and chips filters). Everything else asked about passes. Merge
after #76. R32-2..4 are follow-ups.

# Round 33: fix check on PR #74 `361a6ce`, PR #75 `43eeb39`, PR #76 `ef4e968`

Read each diff against the head reviewed before (`25365a5`, `6a31182`, `7e87b9b8`). No builds, DB suites or paid calls.

## PR #74 at `361a6ce`: R31-1 and R31-2 fixed

- R31-1: `rowSupported` (`extract.ts:116`) now drops a non-"other" row when the name matches `THIRD_PARTY_LIABILITY` **or** the
  printed quote matches `THIRD_PARTY_SENSE` (`events.ts:207`). The traced "Legal liability for accidental death or bodily injury
  to third parties" row is dropped, and "shall not be liable for death caused by war" is still kept.
- R31-2: `sameBenefitKey` compares only `death`, `disability`, `illness` and `hospitalisation`. The real wrist pair (both
  fracture-family, keyword or model traits) now keys the same; a fracture "Leg" and a dismemberment "Leg" still split on
  `disability`.
- R33-1 (Low, follow-up): `THIRD_PARTY_SENSE` matches a bare "third party" anywhere in the quote. A personal accident row whose
  printed line says, say, "including injury caused by assault by a third party" is dropped, which hides a documented benefit.
  That wording is rare in a benefit row, and it was my suggested regex. Narrow it later to the liability sense, e.g.
  `third[- ]party (?:liabilit|claim|propert)|liab\w* (?:to|for)[^.]{0,60}(?:others?|third)|to other (?:people|persons)|(?:personal|legal|public) liabilit`.

**Verdict: ready to merge.**

## PR #75 at `43eeb39`: ready to merge

`addLedgerRow` now also requires the person and the document to be active (`activePredicate` on both EXISTS). The three extra
guards (`stale-answers.ts` covered set, `coverage-assignments.ts` `rebuildForAddedPeople`, `read-failures.ts`) only narrow reads to
active rows. `activePredicate` is imported in each file. No cross-household path, and no optional-table dependency. Still re-apply
`sql/storage-rls.sql` after merge.

## PR #76 at `ef4e968`: R30-1, R30-2 and R30-3 fixed; ready to merge

- R30-1: ingest (`lib/rag/ingest.ts`) reads `dismissedNameKeys(account, policy)` (scoped by both, and empty when the table is
  absent). It skips dismissed names in `unmatched`, so a re-read no longer re-flags them. It also no longer falls back to linking a
  dismissed name to the upload profile, a good extra. This path is untested locally (the PR says so); add it to the post-deploy
  check (dismiss a name, re-read the document, and see no "not linked" flag).
- R30-2: `recountedReview` replaces only the "named insured … not linked" and "coverage item(s) could not be source-verified"
  parts. Its regex matches both the route's and ingest's wording, and every other reason part is kept.
- R30-3: a failed recount is logged, and the saved change returns 200.
- Nit (no action): `nameKey` in JS uses `trim()`/`\s`, and SQL uses `btrim` (spaces only). They differ only for names with tabs or
  non-breaking spaces at the edges.

**Merge order:** #76 before #77. Apply `sql/detected-name-dismissals.sql` after `sql/policy-member-exclusions.sql`.

# Round 34: PR #77 at `c0969e5` (R32 fixes and the "Who covers" line)

Read `git diff 12eac98 c0969e5` (pages, `components/cover-kinds.ts`, `components/device-memory.ts`, AppShell). No builds or browser runs.

## R32-1 fixed: a "to confirm" row never reads as covered

`isToConfirm` (`cover-kinds.ts`) = status present and not `confirmed`, and origin neither `wording` nor `person`. That covers every
`scheduleSeeds` row (`store.ts:159-177`, origin `schedule`, status `proposed`), i.e. every PRODUCT_DEFAULTS guess. Checked each surface:
- Coverage row: `amountLine` returns "Plans like this usually include this. Your documents don't confirm it or print an amount."
  *before* the "Covered." branch. A guess with a figure (life/PA lump sums) keeps the figure and adds "To confirm: plans like this
  usually include this, but your documents don't confirm it yet."
- Coverage chips: a kind whose rows are all guesses is labelled "(to confirm)" with a dashed style.
- Family chips: a kind counts as plain only if one of its rows is not a guess; otherwise it shows "Label (to confirm)".
- Documents: guesses are split out of **Found** into "Plans like this usually include …, but this document doesn't confirm it".
- "Covered." now appears only for a stated row from the wording, a confirmed row, or the household's own entry.

Also fixed: R32-2 (gaps also count `/api/benefits` kinds by owner name, and "other"-typed rows are sorted by name). R32-4 (sign-out
clears the device-only key). The "Covers nobody yet · choose who it covers" line with a Choose button is fine. It adds no claim, and
"Done" is now always offered.

## R34-1 (Low): the "to confirm" line under a figure can understate what the schedule prints

For a seeded lump sum (for example a Group Life line printing S$500,000, seeded as death = S$500,000), the line says "your documents
don't confirm it yet". The schedule does print the plan and its sum. What isn't confirmed is what the plan pays for, which matters
for TPD and terminal illness, so they are rightly flagged. Optional wording: "Your schedule shows this plan's sum; its wording hasn't
been read to confirm what it pays for." No wrong amount either way.

## R34-2 (Low): a guessed row can make a gap note say "found"

`coverGaps` counts guessed rows as found. A PA default's `accident_medical_expense` guess turns the hospital gap into "For medical
costs, only accident medical expenses were found". Optional: skip the RELATED note when its event is only a guess (list the gap as
missing, or say "may include").

## Verdict on PR #77 at `c0969e5`

**Ready to merge** (after #76). R34-1 and R34-2 are optional wording follow-ups. R32-3 still holds: before #76 merges, "Not in my family"
shows an error rather than the device fallback.

# Round 35: PR #78 at `d8738d0` (R33-1, narrow THIRD_PARTY_SENSE)

Read `git diff bf228cf d8738d0` (one regex in `lib/ledger/events.ts:208`, two new cases). I ran the new regex in node on 14 wordings.

| Wording | Result |
|---|---|
| Legal liability for accidental death or bodily injury to third parties S$500,000 | dropped ✓ |
| If you are liable for accidental death, injury or damage to other people | dropped ✓ |
| Third Party Liability S$1,000,000 / Liabilities to third parties / Liability to third parties for death | dropped ✓ |
| If your legal liability for death of others | dropped ✓ |
| Accidental Death …, including death from assault by a third party | kept ✓ (R33-1) |
| … shall not be liable for death caused by war / not liable to pay for death caused by war | kept ✓ |
| not liable for any claim recoverable from a third party / a third party is responsible | kept ✓ |
| Compensation for death caused by a third party vehicle | kept ✓ |
| We will not be liable for death caused **to others** by the insured | dropped (see R35-1) |

The #74 liability guard still holds: the name test (`THIRD_PARTY_LIABILITY`) is unchanged, and every liability-cover phrasing above
is still dropped through the quote.

## R35-1 (Low, accept): a negated "not liable … to others" exclusion inside a personal accident quote still drops the row

"We will not be liable for death caused to others by the insured" matches `liab… to others`. The old regex dropped it too, and the
wording is rare in a benefit row. Optional: skip a match preceded by "not (be )?" / "never". No change needed for this PR.

## Verdict on PR #78 at `d8738d0`

**Ready to merge.** R33-1 is fixed, the liability guard holds, and R35-1 is accepted.

# Round 36: PR #71 simple chat at `d17b033`

Read `lib/simple-chat/**` and the wiring (`lib/chat/workflow.ts` two lines, `lib/ai/providers.ts` prices, `package.json`) against
`main 1ee2aec`. I ran `verify.ts` offline with crafted inputs (sources extracted to the scratchpad, DB client stubbed). No model calls.

Passes:
- **Off means off.** `simpleChatEnabled()` is checked first in `prepareChat` and `runChatWorkflowInternal`, and the module is only
  `import()`ed when on. With the flag unset, both functions run the existing path unchanged. Production also needs
  `DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION=1` (VERCEL / VERCEL_ENV count as production).
- **Household isolation.** Every library read filters on `account_id`, and `readHousehold` re-checks each row's `account_id`
  before building the prompt. `runSimpleChat` refuses a library for another account. History (`conversationTurns`) is
  account-scoped, and saving goes through `saveTurn` (revision check, output guard). The spend cap is checked and usage booked.
- **Groups.** Either/or only when every excerpt is on the same line of the same page, for one person (`oneRow`). Rows from
  different rows or documents never group; they get a "not a total; the insurer decides which applies" note.
- **Page citations.** The page and document shown come from where the server found the quote (`locateQuote`), never from the
  model.

Probe results (`sentenceProblem` with answer amounts 1,250 / 120,000 / 750, and `verifyAnswer`):

| Input | Result | Should be |
|---|---|---|
| "You may get S$1,250-2,000 in total." | kept | dropped (range) |
| "You may get S$1,250 to 2,000." | kept | dropped (range) |
| "In total about 121,250 dollars." | kept | dropped (total) |
| "Together that is S$1,250 plus S$750." | kept | dropped (adds amounts) |
| "Between S$1,250 and S$2,000." | dropped ✓ | |
| "up to S$121,250" | dropped ✓ | |
| amount "S$25", quote "Arm , Elbow, Wrist or Ribs 25%" | **shown as S$25** | dropped |
| amount "S$30", quote "S$100 per day, up to 30 days" | **shown as S$30** | dropped |
| 25% (PS p13 row) of S$600,000 (printed on another page of that document) | **shown as S$150,000** | dropped |

## R36-1 (High, before switching on): any number in the quote passes as the amount

`checkAmount` accepts the amount if its value appears among **all** numbers in the excerpt (`numbersIn`), so a percentage, a day
count, an age or a page number becomes a dollar amount ("S$25" from "25%", "S$30" from "30 days"). That is a wrong claimable amount.
Fix: compare against the excerpt's money figures only (`moneyFiguresIn(excerpt)`), or at least reject a number followed by
`%`, `per cent`, `day(s)`, `week(s)`, `month(s)`, `year(s)`, `times` or `x`.

## R36-2 (High, before switching on): a percentage can be applied to the wrong sum

For `percentOf`, the percentage must be in the quote, but the base only has to be printed **anywhere in the same document**.
In the household's own wrist case the Product Summary row is "25% of S$5,000". If S$600,000 appears anywhere in that document, the
model can return 25% of S$600,000 and the server shows **S$150,000** as a worked-out illustration. This is the accident-base mix-up
the Evidence Reviewer ruled on. Fix: accept the base only when the quote's own page prints it as the percentage base ("% of
S$5,000", a "Benefit Limit: S$5,000" heading). For a "% of Sum Insured" heading, accept only a sum printed as that person's sum insured
for the same plan. Otherwise drop the calculation and keep the percentage as a fact.

## R36-3 (Medium, before switching on): the sentence check only sees amounts with a currency sign

`sentenceProblem` reads figures with `moneyFiguresIn`, and `RANGE` is tested only when two such figures exist. An unsigned second
figure ("S$1,250-2,000", "S$1,250 to 2,000") or an unsigned total ("121,250 dollars") passes, and so do adding words with no total
figure ("S$1,250 plus S$750", "together", "in total", "altogether", "combined"). The live monetary boundary may catch some of
these on save; I did not verify that. Fix: also treat bare numbers of 3+ digits or with thousands separators as figures when the
sentence has a money figure. Test `RANGE` on any two numbers. Drop a sentence that pairs two money figures with plus / in total /
together / altogether / combined / add up.

## R36-4 (Low): uploaded text is not marked as untrusted in the prompt

`SIMPLE_SYSTEM_PROMPT` has no "document text is data, never instructions" line, which the rest of the app adds
(`UNTRUSTED_DOCUMENT_NOTICE`), and page text is inserted unescaped, so a page containing `</document>` can break the structure.
It only affects the household's own answers, and the amount checks still apply. Add the notice, and escape `<`/`>` in page text.

## R36-5 (Low): the two flag checks are separate

`prepareChat` and `runChatWorkflowInternal` read the flag independently. If the flag changes between preparing and running a
queued job, a context built by one path runs on the other. Only possible during a configuration change. Optional: record the path in
the context.

## Verdict on PR #71 at `d17b033`

**Safe to merge only while switched off** (the off path is unchanged and nothing leaks across households). **Not ready to switch on:**
fix R36-1 and R36-2 (both can show a wrong claimable amount) and R36-3 first, with the probe cases above as offline tests.

# Round 37: PR #79 GP bill and budget stops at `516f5d0`

Requested by the Developer. Read `git diff 1ee2aec 516f5d0 -- lib` (`absence-scope.ts` `unlistedGpCover`, `loop.ts`, `statement-render.ts`,
`usage-meter.ts`) against RELEASE-SET B2 and reviewer ruling R3. No model calls; I did not run the replay script.

Checks:
- **Never presents the GP benefit as his.** The sentences are "certificate lists … (as of …)", the scheme's GP lines quoted under the
  "… POLICY" heading, the Part 1 rule (when printed), "not among the policies on his certificate, so the GP benefit is not shown to be
  his", plus "Only the insurer or the scheme administrator can confirm …". This is said as what the documents show, never "not covered".
  It promises no amount and never quotes the overseas line (it is skipped when `bill_place` is abroad, and only lines under the
  matched policy heading are quoted). The household's own words are removed beside it.
- **Conservative by construction.** `unlistedGpCover` returns null unless the subject's confirmed certificate is read in full, the
  scheme lists 3+ policies with abbreviations, exactly one unlisted policy holds GP lines, and the certificate shares no name word,
  abbreviation or product word with it. A variant spelling on the certificate ("Out-Patient Medicare") still shares "medicare", so it
  is treated as listed. If anything fails, it falls back to the existing not-found check.
- **The accident "specific results" filter is principled enough.** It takes only the lettered benefits under the certificate-listed
  accident product's own "BENEFIT n:" heading, whose wording opens on an accident and names no death, disablement, dismemberment,
  disappearance or coma. It quotes the benefit names only (no amounts), each "only if that result happened". That matches B2
  (ambulance, a 24h+ stay, fracture). Limit: the grave-word test reads the heading and the next two lines only, so a benefit whose
  death wording comes later could be listed. That is harmless here, because nothing is calculated.
- **Running outside budget stops** is limited to a reply that left the reported bill unaddressed (`groundedFallback`), for a local or
  unknown bill place. Loaders are account-scoped, so there's no cross-household path.
- **Budget stop.** `reportStopAnswer` only answers a bill or stay reported this turn for the current subject, through `groundedFallback`
  with `budgetStopped` set, so no repair call. `roomForAnother` uses the meter's own limits. Leaving out a refused absence when no
  further call fits drops a statement, which is the safe direction.

## R37-1 (Low): "what do i do now" replaces "I couldn't confirm an answer" with "Here is what you can do next."

That only applies when the reply has next steps and no sentences, and B2 asks for it. A household that asked something specific in
the same message is then not told it went unanswered. Accept, or keep the dropped note after the steps when the message also asks a
question.

## R37-2 (Observation for the coordinator, not a correctness issue): this is a scheme-shaped server answer

`unlistedGpCover` keys on this scheme's layout: "(POLICY NO" headings, the Part 1 sentence, "BENEFIT n:" lettered benefits. DC's
11:54 direction was no per-scenario rules, and DC chose to build in the simple chat at 15:08. Worth deciding whether to carry this on
the rag2 path or let the simple chat handle B2.

## Verdict on PR #79 at `516f5d0`

**Ready to merge.** It's correct for B2 and conservative when the documents don't match exactly. R37-1 is accepted. R37-2 is a
direction question for the coordinator.

# Round 38: PR #71 simple chat at `a4b529f` (R36 fixes)

Read `git diff d17b033 a4b529f`. I re-ran the round-36 probes and new ones offline: crafted inputs plus the real snapshot loaded in
the scratchpad, never committed. No model calls.

Fixed:
- R36-1 for the reported cases: "S$25" from "25%" and "S$30" from "30 days" are now dropped.
- R36-2 for a row under a "% of S$5,000" / "Limit: S$5,000" heading: the base must be the nearest one above the quoted row on its
  page. 25% of S$600,000 for the PS p13 row is dropped and the percentage is kept as a fact.
- R36-3 for the reported cases: "S$1,250-2,000", "S$1,250 to 2,000", "plus", "in total" and "121,250 dollars" are all dropped.
- R36-4: `UNTRUSTED_DOCUMENT_NOTICE` is in the prompt, and `<`/`>` are escaped in every page, attribute and member name. Quotes
  are unescaped before matching.
- R36-5: `context.chatPath` decides the run path, so a flag change mid-turn can't mix the paths.

New probes on the real snapshot, BS p8 row "Arm, Elbow, Wrist or Ribs (Other Fracture) 20%" (heading "% of Sum Insured"), person
Desmond:

| percentOf base | Result |
|---|---|
| S$600,000 (his real GPA sum insured, on the certificate) | dropped, kept as the 20% fact |
| S$400,000 (PS p5 "100% Sum Insured (up to S$400,000)", an advance-payment cap) | **shown: S$80,000** |
| S$10,000 (PS p28 "monthly premium rate for every S$10,000 Sum Insured") | **shown: S$2,000** |
| S$50,000 (BS p10 "Comatose State … maximum of $50,000") | **shown: S$10,000** |

Synthetic: amount "S$500", quote "Plan 500 Hospital cash S$100 per day" → **shown: S$500**.

## R38-1 (High, before switching on): the "% of Sum Insured" path accepts any figure on a line that says "sum insured"

`printedSumInsured` accepts the base if *any* line containing "sum insured", in a same-product document linked to the person, prints
that value. Caps ("up to S$400,000"), premium units ("every S$10,000 Sum Insured") and other benefits' maximums ("maximum of $50,000")
all qualify, so a wrong base produces a wrong worked-out amount. Meanwhile the true S$600,000 fails: the certificate's product name
"… SCHEME" doesn't equal "… Group Insurance", and its table doesn't print "sum insured" on the value's line. Fix: accept only the
person's own sum insured for that plan, as a value, not a cap, rate or maximum. Either reject lines with `%`, "up to", "maximum",
"max", "per", "every", "for each" or "premium" before the figure, or (better) take it from the person's certificate coverage row
for the matching benefit, e.g. the app's `policy_coverages` amount for that person and product. Otherwise drop, as it does now.
Add the four rows above as tests.

## R38-2 (Medium-High, before switching on): a bare 3+ digit number in the quote still counts as money

`checkAmount` uses `moneyValuesIn(excerpt)`, which includes `bareMoneyNumbers`: any unsigned 3+ digit number not followed by a unit.
"Plan 500", "Class 101", "Section 210" or a table code then becomes an amount ("S$500" was shown). Fix: for `checkAmount`, require a
currency-signed figure in the excerpt, or a bare number on a page whose column header prints the currency ("(S$)"). In both places,
exclude numbers right after Plan, Class, Type, Code, Section, Clause, Ward, Room, Tier, Option or No.

## R38-3 (Low): range and both-pay wording the regexes don't see

These are kept when both figures are allowed amounts: "1,250 to 120,000 dollars" (no sign on either side), "At least S$1,250 and as
much as S$120,000", and "Both pay, so S$1,250 and S$120,000 for her" (which misstates an either/or as both payable). "Anywhere from
S$1,250 up to S$120,000" is caught. Optional: treat "dollars" as a sign in `RANGE`, add "as much as" / "at least … and", and drop
"both pay" / "each pay" sentences when the amounts are in an either/or group.

## Verdict on PR #71 at `a4b529f`

**Still safe to merge only while switched off. Not ready to switch on:** fix R38-1 and R38-2 (both can still show a wrong claimable
amount, R38-1 on the household's own documents). R38-3 is optional.

---

# Round 39: PR #71 (simple chat) at `0091db8`, re-check of round 38

Method: same local probes as round 38 (`lib/simple-chat/verify.ts` run with tsx against the real household snapshot, kept
out of Git, plus a synthetic household). No paid model calls.

## Round 38 items

- **R38-1 (wrong base for "% of sum insured"): fixed on the real documents.** "Arm, Elbow, Wrist or Ribs (Other Fracture) 20%"
  for Desmond now uses S$600,000 and gives S$120,000. The S$400,000 cap, S$10,000 premium unit and S$50,000 maximum are now
  kept as plain facts and never multiplied. For Charmaine the same row gives S$120,000 from S$600,000, which is her own
  certificate line ("Ong Pei Lin Charmaine S$600,000") under the accident heading, so no cross-person base. A synthetic
  "50% of Ben's S$300,000" asked for Ann is dropped.
- **R38-2 (label number read as money): partly fixed.** "Plan 500" is now rejected. **R39-1 (Medium):** "Plan A 500" under a
  "(S$)" column heading still becomes S$500, because `LABEL_BEFORE` only matches when the label word sits directly before the
  number (`verify.ts`, `LABEL_BEFORE`). The same applies to "Class B 2", "Ward A1 300" and similar.
- **R38-3 (range and both-pay wordings): partly fixed.** **R39-2 (Low-Medium):** these sentences still pass the sentence check:
  "With the fracture and the ambulance she gets S$1,250 and S$200." / "Expect S$1,250 and, if she stays over, another S$200." /
  "The most she can get is S$120,000." (an either/or shown as a maximum) / "Up to S$120,000 or S$1,250."

## Is this becoming tuned to one household?

Yes. Each round adds another word list (cover kinds, label words, "not a sum insured" words, range words, adding words) and
another layout guess (headings above a row, person-named lines, column headings). Each list fixes the probes and the next
wording gets through. This also drifts from DC's "no per-scenario rules" design.

**Recommended simpler rule (safer):**
1. The model's prose (bottom line, text, conditions, next steps) carries no money figures at all.
2. Amounts appear only in server-built amount cards, each copied from a currency-signed figure inside the quoted source text.
3. A percentage is worked out only when its base is printed in the same place ("20% of S$600,000" or a "Limit: S$X" heading
   on the same page). That path is already passing.
4. For "% of sum insured", show the percentage and the person's printed sum insured as two separate cited facts, not
   multiplied, until a structured per-person source (for example `policy_coverages`) exists.

This removes the range and adding word lists entirely, and a wrong total can no longer appear in a sentence.

## Verdict on PR #71 at `0091db8`

**Still safe to merge only while switched off. Not ready to switch on.** R38-1 is fixed. R39-1 can still show a wrong
claimable amount. Rather than patching R39-1 and R39-2 with more word lists, adopt the simpler rule above.

---

# Round 40: PR #71 (simple chat) at `9757784`, the "no money in prose" rule

Method: local tsx probes of `lib/simple-chat/verify.ts` (statesMoney and verifyAnswer) against the real household snapshot,
kept out of Git, plus 23 prose wordings. No paid model calls.

## What holds

- Amounts now come only from a currency-signed figure in the located quote, or a percentage of a sum printed in the same
  table's heading on the same page. Desmond's wrist: S$1,250 (25% of S$5,000, Product Summary p13) as a calculation card;
  the Benefit Summary p8 "20%" kept as a fact card, never multiplied; S$600,000 from his certificate p1 as its own card.
  S$120,000 is never computed. The word lists from rounds 36 to 39 are gone, and the design no longer depends on this
  household's layout.
- Any prose sentence with a currency sign or code, "dollars", or a thousands separator is dropped (bottom line, card text,
  conditions, next steps, question): "S$1,250", "SGD1250", "1250 SGD", "$1.25K", "S$ 1,250", "SGD 1.25k", "Total: 1,450".
- Percentages, days and page numbers survive ("within 30 days", "Page 13 lists 25%").

## Findings

**R40-1 (Medium): a figure still reaches prose when written without a currency sign or separator.** These sentences are
all kept by `statesMoney` (`verify.ts:154`): "She gets 1.25k", "She gets 1250", "About 120k if you use the sum insured",
"20% of 600k is the most", "She is covered 600000", "The fracture pays 1 250 and the ambulance 200", "Roughly 1.4
thousand in total", "one thousand two hundred and fifty dollars", "The ambulance fee is two hundred", "25% of five
thousand". "About 120k" is exactly the multiplied sum-insured figure this design exists to stop. The model is told not
to write amounts, so this only bites when it disobeys, but release-set C2 shows it does. The save and reopen boundary
(`containsMoney` in `lib/chat/monetary-boundary.ts`) has the same gap. A generic fix, not tied to this household: also
drop a prose sentence that has (a) a number followed by k, m, mn, million, thousand, grand or bn; (b) any of the words
hundred, thousand, million, billion or grand; or (c) a number of 100 or more not directly followed by %, a time unit
(day, week, month, year) and not directly after "page".

**R40-2 (Low-Medium, usefulness): an amount card can lose what the amount is for.** When the model writes the figure in
the card text ("Desmond can claim S$1,250 for the wrist fracture.", the natural wording), the whole sentence is dropped
and the card reads only "As printed in MINDEF & MHA Group Insurance (Product Summary), page 13." next to S$1,250, with
no benefit name (`verify.ts:251`). Fact cards already fall back to the quoted words; do the same for amount cards (for
example "S$1,250 — “Arm, Elbow, Wrist or Ribs 25%”, Product Summary page 13"). Similarly a bottom line that names an
amount falls back to "Here is what your documents say.", which loses the answer itself; consider asking the model again
once, or keeping the sentence with the figure removed.

**R40-3 (Low):** two statements quoting the same row produce two identical fact cards (seen with the 20% row).

## Verdict on PR #71 at `9757784`

**Safe to merge while switched off. Close to ready to switch on:** the structure is now right and no longer tuned to
this household. Fix R40-1 (a small generic rule) before switching on; R40-2 is recommended so the answer stays useful;
R40-3 is optional.

---

# Round 41: PR #71 (simple chat) at `788f3de`, re-check of round 40

Method: local tsx probes of `statesMoney` and `verifyAnswer` (32 prose wordings, plus the real household snapshot kept out
of Git). No paid model calls.

## Round 40 items

- **R40-1: fixed.** All ten round-40 slips are now dropped ("1.25k", "1250", "About 120k…", "20% of 600k", "600000",
  "1 250 … 200", "1.4 thousand", "one thousand two hundred and fifty dollars", "two hundred", "five thousand"), as are
  "120 K" and "990 over ten days". Kept as they should be: "within 30 days", "within 365 days", "Page 13 lists 25%",
  "The 2023 schedule", "dated 06/10/2022", "starts 19 Oct 2026", "Clause 4.12", "age 65", "Pages 12 and 13".
- **R40-2: fixed.** Desmond's wrist card now reads "MINDEF & MHA Group Insurance (Product Summary) prints: “Arm , Elbow,
  Wrist or Ribs 25%”" beside S$1,250; his S$600,000 card quotes his certificate line. A bottom line that only named an
  amount becomes "Your documents list this benefit for Tan Yi Chuen Desmond. This is the wrist fracture benefit. The
  amount is shown below."
- **R40-3: fixed.** The 20% row now gives one fact card.
- containsMoney in `monetary-boundary.ts` being unchanged is acceptable: the simple path writes prose only after
  `withoutMoney`, and amounts only on server cards.

## Remaining (all Low, none blocks switching on)

- **R41-1 (Low):** still kept: "She gets 2000 for the ambulance" and "She gets 1999 in total" (bare 1900 to 2099 read as
  a year), "Twelve fifty for the fracture", "One twenty k at most", "Several thousands are payable", "It pays hundreds
  for each night" (`\bhundred\b` misses the plural). Each needs the model to disobey the prompt and pick an unusual
  wording. Cheap tightening: match `hundreds?|thousands?|millions?`, and exempt a bare 19xx/20xx only after in, since,
  from, until, by, before, after, of or a month name. The year trade-off is acceptable if left as is.
- **R41-2 (Low, usefulness):** next steps lose a helpline or policy number ("Call the hotline on 1800 123 4567", "Quote
  policy number 12345678") and "See p. 113". Acceptable for now; the source cards stay one tap away.

## Verdict on PR #71 at `788f3de`

**Ready to switch on, apart from the one paid smoke test it still needs.** Safe to merge. R41-1 and R41-2 are optional
tightening.

---

# Round 42: PR #71 (simple chat) at `2717c76`, re-check of round 41

Method: local tsx probes of `statesMoney` and `verifyAnswer` with a synthetic certificate that prints "S$600,000",
"S$1,250" and "Claims hotline: 6333 1234". No paid model calls.

## Round 41 items

- **R41-1: fixed.** Now dropped: "She gets 2000", "She gets 1999", "Several thousands", "pays hundreds". Still kept as
  dates: "from 2026", "of 2023", "in October 2022". "Twelve fifty" and "One twenty k" still pass; accepted as Low.
- **R41-2: works for real numbers.** "Call on 6333 1234 to claim" and "Call the hotline at 1234" are kept. A sentence that
  also states money is still dropped ("Call 6333 1234 and expect 1250").

## Findings

**R42-1 (Low-Medium): the R41-2 exemption accepts a printed money figure as a phone or policy number.** Kept as next
steps: "Call 1250 to claim the ambulance fee.", "Call 600000 about your sum insured.", "Quote policy no. 1250 for the
ambulance.", "Claim no. 600000 applies." The cause is that `labelledNumbersRead` (`verify.ts`) joins every digit in each
cited excerpt into one string and checks whether the number is inside it. So "1250" matches "S$1,250", and any substring
across neighbouring numbers matches too. A reader is unlikely to take "Call 1250" as an amount, but it is a path for a
figure around the money rule and the fix is small: compare whole numbers, not substrings, and never accept a number that
the excerpt prints with a currency sign. Safer still: accept it only when the excerpt prints the same label (hotline,
tel, phone, fax, policy/certificate/claim no.) directly before that number.

**R42-2 (Low, usefulness):** "The 2026 schedule applies." is now dropped (a year before a noun, with no introducing word),
and "See pp. 113 to 115." is dropped because the second page number has no "page" before it. Acceptable.

## Verdict on PR #71 at `2717c76`

**Safe to merge. Ready to switch on once R42-1 is fixed** (a few lines in `labelledNumbersRead`), apart from the one paid
smoke test. Everything else from rounds 36 to 41 holds.

---

# Round 43: PR #71 (simple chat) at `1a62deb`, re-check of round 42

Local tsx probe with a synthetic certificate printing "S$600,000", "S$1,250", "Claims hotline: 6333 1234", "Policy no. 1250"
and "Policy no.: 778899". No paid model calls.

- **R42-1: fixed.** Now dropped: "Call 1250…", "Call 600000…", "Quote policy no. 1250…" (even though the page prints
  "Policy no. 1250", the same value is printed as S$1,250), "Claim no. 600000…", "Call 6333" (partial number) and
  "Call 778899" (a policy number used under a phone label). Kept: "Quote policy no. 778899 when you call."
- **R43-1 (Low, usefulness):** when the cited quote has more digits right after the phone number ("Claims hotline: 6333
  1234 / 24 hours a day"), the label pattern's `[\d\s-]*` runs across the line break and reads "6333123424", so "Call on
  6333 1234 to claim" is dropped. It fails safe. Stopping the number at a line break or before a space followed by a word
  would fix it. Optional.

## Verdict on PR #71 at `1a62deb`

**Ready to switch on, apart from the one paid smoke test.** Safe to merge. R43-1 is optional.

---

# Round 44: PR #77 at `3a24587` (two commits on top of `c0969e5`, passed in round 34)

Commits: fb29af8 (`app/api/family/route.ts`) and 3a24587 (`app/api/dashboard/route.ts`). Both counts now join
`policies p ON p.id=pm.policy_id AND p.account_id=f.account_id AND p.superseded_at IS NULL AND p.lifecycle_state='active'`,
the same filter GET /api/policies uses (`app/api/policies/route.ts:56`). Read-only review; no DB or paid runs.

- **Removing a person with an active document stays blocked.** The count is only a display hint. The server check is
  separate and unchanged: DELETE /api/family/[id] calls `requestFamilyMemberDeletion` (`lib/lifecycle/coordinator.ts`,
  around line 1038). It counts active policies through `policy_members`, the legacy `policies.family_member_id`, chats, claim
  sessions, coverage rules and premium records, and throws `HasLinkedActivityError` (409) when any exist. An active,
  current document still counts in the new UI query, so the Family page still shows "Go to Documents" instead of Delete.
- **Household scoping holds.** `f.account_id=$1`; both joins are tied to `f.account_id`, so another household's policy rows
  cannot be counted. GET /api/family still runs through the user-scoped client (`createUserSupabaseClient`).
- **R44-1 (Low, wording only):** the server check does not exclude replaced (superseded) documents and also counts the
  legacy `policies.family_member_id` column and chats/claims; the new UI count excludes the first and never included the
  others. A person linked only to a replaced document (or with a chat) now shows "No documents linked yet" and a Delete
  button, then gets the 409 "has linked documents or activity" message. It fails safe. Optional: align the server's
  policy_members count with `superseded_at IS NULL` if replaced documents should not block, or keep superseded in the UI
  count if they should.

## Verdict on PR #77 at `3a24587`

**Ready to merge.** R44-1 is optional.

---

# Round 45: two quick commit checks

**PR #71, c332676 (on top of 1a62deb): test-only, correct.** The commit touches only `scripts/simple-answer/chat-test.ts`.
The rule it tests was already in `verify.ts` (either/or is drawn only when every grouped amount is on one row of one page
*and* `new Set(person).size === 1`). The new test puts the same one-row pair on two real household members (Lim Ah Kow,
Lim Mei Mei, both in HOUSE, so neither resolves to null by accident) and checks two separate cards, no group, and the
"not a total" note. The single-person either/or case stays covered by the existing test "either/or only for one person's
amounts on one row of one page" (same pair, same person). No implementation change, so legitimate single-person
either/or answers are unaffected. Note (no action): two amounts with no named person on one row still group, which is
fine because they come from one row of one document.

**PR #77, b22e92d on top of 3a24587: test-only.** The range 3a24587..b22e92d (179737e, 852d776, 2e55195, b22e92d) touches
only `e2e/**` specs and `docs/rag-migration/pr57-roles/test/EXPECTATION-CHANGES.md`; no app, lib or SQL file. The
EXPECTATION-CHANGES table records each changed check with its "was" and "now", and says each original is kept in a comment
beside the change. The new household-journey step 21-22 asserts the still-linked alert, "Go to Documents", no "Confirm
delete", and the child still present, which matches round 44.

**Verdict:** both fine. Nothing changes for #71's or #77's readiness.

---

# Round 46: two quick checks before the merge list

**PR #80 at e743e25: test-only, and the checks can fail.** Against its merge base on main, the only file changed is
`scripts/infrastructure-table-permissions-regressions.ts` (+28). It appends `sql/policy-member-exclusions.sql` and
`sql/detected-name-dismissals.sql` to MIGRATION_ORDER after `household-rls.sql`/`infrastructure-rls.sql`, and adds
section 3b for both tables:
- anon SELECT, INSERT and DELETE must be denied;
- household B cannot read A's rows (0 rows), write a row for A, delete A's rows (0 rows), or "forge" a row under its own
  account that names A's document;
- controls: a member of A reads its own row and can add one.

`record(ok, label)` pushes a failure whenever `ok` is false, so each line fails if the matching policy is loosened. For
example, the forged-row check fails if the `EXISTS (… p.account_id = …account_id)` clause is removed from the INSERT
policy, and the read check fails if SELECT becomes `USING (true)`. The `removable` person used in the exclusion insert
was soft-deleted earlier in the suite (`finishFamilyMemberDeletion` sets `soft_deleted`, `lib/lifecycle/coordinator.ts`
~1105) but the row still exists. So the foreign key does not mask the RLS result, and the member control proves the
insert path works. Not run here (a database suite); this is a code read.

**PR #71 at 260aa95: only `.env.example` changed.** `git diff c332676 260aa95` is 4 added comment lines documenting
DEARPOLICY_PREFETCH_PERSON, DEARPOLICY_SIMPLE_CHAT, DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION and
DEARPOLICY_SIMPLE_CHAT_MODEL. They contain no values and no secrets. Nothing else changed, so round 43's verdict stands.

**Verdict:** #80 is ready to merge. #71's readiness is unchanged (ready; switch-on still needs the one paid smoke test).

---

# Round 47: PR #81 at `b29be86` (designer's after-#77 work), against main `64173c7`, with and without #79

Four commits: ea794bb (Coverage wording, R34-1/R34-2), 1d0feb2 (chat on a phone), d4f5f2a (upload on a phone), b29be86
(Home for returning households). 12 files, no lib/ or SQL changes. The method was a code read, plus a local tsx probe of
`restates()` copied from `components/answer-cards.tsx`. No build, DB or paid runs.

**With and without #79.** #81 and #79 share no files. A trial merge of main + #81 + #79 is clean in both orders. The new
stop notice (`components/answer-stopped.tsx`) matches main's stop texts and #79's: `STOPPED` matches "I couldn’t
finish…", "I couldn’t look that up…" and "I stopped before answering…", and `TOO_BIG` matches "limit set for model use on
a single question" and "more steps than the limit" in both wordings. Without #79, main's stop text says "ask about one
person at a time" even when the question already names one person, while the card offers "Ask again". That is consistent
with #79's intent, so it is fine either way.

## Findings

**R47-1 (Medium-High, qualifier hidden from view): the next-step de-duplication runs the wrong way.** In `AnswerCards`,
`repeats(s)` drops a prose sentence when `restates(t, s, 0.8)` for any next step `t`, that is, when the step's words are
inside the sentence. A sentence that adds a condition to a step is therefore hidden from "Also in this answer":
- "Send the bill within 30 days, but only after he is discharged from hospital." is hidden by the step "Send the bill
  within 30 days."
- "Call the claims hotline before any treatment overseas, or the claim may be refused." is hidden by the step "Call the
  claims hotline."

The words remain only under the collapsed "Full answer", which breaks "never strip a qualifier". Fix: hide only when the
sentence restates the step (`restates(s, t, 0.8)`) or matches it exactly.

**R47-2 (Medium): a negated sentence counts as a restatement of the bottom line.** `restates(s, bottomLine)` with a 0.7
share treats "Ah Kow is not covered for the wrist fracture." as repeating the bottom line "Ah Kow is covered for the wrist
fracture." (5 of 6 content words), so the contradiction is hidden. "only if", "unless" and "after a 30-day waiting
period" survive in my probes, but only because they add enough words. Fix: never treat a sentence as a restatement when
it has a limiting word the other lacks: not, no, never, only, unless, except, excluded, without, until, after or before.
A digit is already handled that way.

**Checked, fine:**
- Home: data comes only from household-scoped GET /api/policies (server-side name dismissals already applied) and GET
  /api/claims. "Who is …?" also honours this device's `NOT_FAMILY_KEY`. `#doc-<id>` anchors exist. The `?ask=` question
  is placed in the chat box, capped at 2,000 characters, and not sent.
- Upload: the password field shows only for a PDF and is cleared when a non-PDF is chosen. The "not stored" note is kept
  beside the field. Errors are shown under the button.
- Coverage: R34-1 and R34-2 wording as agreed. `coverGaps` now gives the "may include … don’t confirm it yet" note when
  the related row is only a to-confirm guess, so a guess is no longer called "found".
- The "To confirm" flag on a bottom line appears only with no amount and at least one uncertainty point. The disclaimer
  is hidden on a stop card only.

## Verdict on PR #81 at `b29be86`

**Not ready to merge yet:** fix R47-1 and R47-2. Both are small changes in `components/answer-cards.tsx`. Everything
else is ready, and the result is the same with or without #79.

---

# Round 48: PR #81 at `404d54b`, re-check of round 47

Only `components/answer-cards.tsx` and the phone e2e spec changed. Method: local tsx probe of the new `restates()`.

- **R47-1: fixed.** The next-step check now hides a sentence only if it restates the step (`restates(s, t, 0.8)`) or
  matches it exactly. "Send the bill within 30 days, but only after he is discharged." and "Call the claims hotline before
  any treatment overseas…" are now shown. A sentence that says less than the step ("Send the claim form." under "Send the
  claim form and the hospital bill.") is still hidden, which is right.
- **R47-2: mostly fixed.** Under the bottom line "Ah Kow can claim for the wrist fracture.", these are now shown: "…is
  not covered…", "…can't claim…", "…provided he was admitted.", "The plan excludes…".

**R48-1 (Medium, same class as R47-2): some conditions and one negation are still hidden as restatements.** Under that
bottom line, these are hidden:
- "Ah Kow can claim for the wrist fracture if admitted." ("if" is in `STOP`, and "admitted" alone stays under the 0.7 share)
- "…subject to approval."
- "…once discharged."
- "Ah Kow couldn't claim for the wrist fracture." ("couldnt" is missing from `NEGATION`)

Fix:
- Take "if" out of `STOP`.
- Add if, when, once, provided, subject, unless and while to `LIMITS`.
- Add couldnt, shouldnt, mustnt, neither and nor to `NEGATION`.
- Simpler still: against the bottom line, hide a sentence only when it adds no content word at all (share 1.0).

Hidden harmlessly: "may claim" for "can claim", and "too" or "also".

## Verdict on PR #81 at `404d54b`

**Not ready yet:** fix R48-1. It is a few words in the same two constants. Everything else from round 47 stands, with
or without #79.

---

# Round 49: PR #81 at `00a06ff`, re-check of round 48

Only `components/answer-cards.tsx` (2 lines) and the phone e2e spec changed.

- **R48-1: fixed.** Against the bottom line, `restates(s, bottomLine, 1)` hides a sentence only when every content word is
  already in the bottom line. So "…if admitted", "…subject to approval" and "…once discharged" each add a word and are
  shown. "couldnt", "shouldnt", "mustnt", "neither" and "nor" are now in NEGATION, so "Ah Kow couldn’t claim…" is shown.
  The new R48 phone check asserts all four, and that a word-for-word repeat of the bottom line is still hidden.
- **Expectation change: legitimate.** The removed assertion expected the to-confirm summary sentence ("…usually includes
  a hospital benefit, but her documents don’t confirm it or print an amount.") to be hidden under the bottom line ("Not
  confirmed yet: plans like … usually include a hospital benefit, but her documents don’t print one."). That sentence adds
  "confirm" and "amount", so it is not a pure repeat. Showing it costs one near-duplicate line. Hiding it is the class of
  error rounds 47 and 48 were about. The "said once" intent is still checked for an exact repeat by the R48 test, and the
  next-step direction (R47-1) is unchanged and still checked.

## Verdict on PR #81 at `00a06ff`

**Ready to merge**, with or without #79 (no shared files; stop texts match both).

---

# Round 50: PR #82 at `741aba9` (simple chat aiming at 32/32)

Method: code read of `lib/simple-chat/**` and `scripts/simple-answer/app-run.ts`, plus a local tsx probe of `verifyAnswer`
on the real snapshot (kept out of Git). No paid calls.

**"Both paid runs used the comparison script": confirmed.** `sonnet-run/SCORES.md` names `scripts/simple-answer/compare.ts`
as the runner, and the side-by-side header has `current: none`. So the app's checks never saw those answers. app-run.ts
drives `runSimpleChat` with a per-call worst-case cap and writes output only to `--out`. That is the right way to measure
what ships.

**"% of Sum Insured" on the person's own sum insured: correct on the intended rows.** These match the Evidence Reviewer
figures:
- Desmond wrist (BS p8, 20%): S$120,000.
- Desmond hip (75%): S$450,000.
- Charmaine wrist: S$120,000.

The Term Life S$1,000,000 offered as the base for a GPA row is refused (kept as a fact). No person means no calculation.

## Findings

**R50-1 (High, wrong amount): a "% of the Sum Insured" sentence below a row is taken as the row's table heading.**
`rowBase` scans everything before the end of the whole excerpt. So a quote that joins a row to a later sentence with
"..." makes that sentence the row's base. Probe: "At least 6 months 50% ... Comatose State sum insured will be 15% of the
Sum Insured" (BS p10) gives **S$300,000** (50% of S$600,000). The document's benefit is 50% of the Comatose State sum
insured, which is the lesser of 15% of S$600,000 or S$50,000. That is at most S$25,000. The row alone is correctly
refused. Fix:
- Find the base above the row's own line: the line holding the percentage, using the first fragment's position, not
  the excerpt end.
- Accept "sum_insured" only from a table heading line such as "(% of Sum Insured)". Never accept it from prose.
- Refuse when the row's own column heading names another base ("percentage of Comatose State Sum Insured").

**R50-2 (Medium-High): prose percentages are multiplied and the cap is lost.** "of 100% of the Sum Insured, up to a
maximum amount of $400,000" (BS p4, Term Life TPD) gives a S$1,000,000 calculation card. The quote's "$400,000 maximum,
balance paid later" is not on the card, so a qualifier is stripped. The same fix as R50-1 (a table heading only, not a
sentence in the quote) stops it.

**R50-3 (Low): the base citation can show another person's line.** With Charmaine's certificate line quoted as
Desmond's base, Desmond still gets S$120,000. `sumInsuredBase` finds Desmond's own line on the page, but the cited base
excerpt is Charmaine's line. Fix: require the quoted line itself to name the person.

**R50-4 (Low-Medium, latent): `sectionOf` only records headings that are also certificate covers.** A section the
certificate does not list (BS p14 "DISABILITY INCOME POLICY", p16 "OUTPATIENT MEDICARE POLICY") does not end the previous
one, so a "% of Sum Insured" row there would inherit "living care plus". There is no such row in this household today.
Fix: track every heading, and accept only when the last one matches.

**Checked, fine:**
- Unreadable files are sent with no text and cannot be quoted (`locateQuote` skips them).
- `linked_people` always says "nobody" when empty.
- Conditions must quote words on the statement's own page, and footnote conditions apply only to rows with the same mark.
- At most one question is kept, and question sentences elsewhere are dropped.
- The no-money-in-prose rule is unchanged.

## Verdict on PR #82 at `741aba9`

**Not ready:** fix R50-1 and R50-2 (wrong or unqualified amounts) before any paid app-path run. R50-3 and R50-4 are
small. The approach is sound.

---

# Round 51: PR #83 at `d883368` (document roles)

Method: code read of the `lib/documents` changes. I ran `documents:role-test` locally (tsx, with zod installed in a
scratch folder) and ran the main and #83 rules on all 8 snapshot documents (kept out of Git), plus 5 new layout probes.
No database, model or production read.

- **The test can fail and does:** 10/10 pass on #83, and the same file fails 6 of 10 on main.
- **Snapshot roles change exactly as reported, and nothing else moves:**
  - Benefit Summary: certificate → benefit_guide.
  - The FWD summary (…053): policy_wording → personal_schedule.
  - The FWD wording (…157): endorsement → policy_wording.
  - The CI II pack (5e58ea7d…): insurer_letter → personal_schedule. `correspondenceRole` is now null because page 3
    opens with "Policy Schedule".
  - Product Summary, Certificate, the CI II illustration and the failed invoice are unchanged.

## Findings

**R51-1 (Medium): a generic group summary can become a personal schedule.** The new `personalDocumentTitle` rule needs
"insurance/policy summary" plus a printed policy number. The `personal` guard is met by any "policy no." together with
"sum insured". So "Harbour Group Insurance Summary / Group Policy No. G123400 / … The Sum Insured is shown in your
certificate." is now `personal_schedule`; on main it was null. Generic terms labelled as personal proof is the same error
class as the Benefit Summary. Fix: skip a *group* policy number, and require a person field with a value on the same
page (policyholder, insured person or life assured, then ":" and a name).

**R51-2 (Medium, could hide personal cover): the Part 2-only test only recognises three Part 1 phrasings.** A combined
certificate whose Part 1 says "Life Assured: …" or "Sum Assured S$…" with an effective date, followed by "CERTIFICATE OF
INSURANCE PART 2: HIGHLIGHTS OF COVER", is now `benefit_guide`. Main had `certificate`. That would drop a person's
documented cover. DC's own certificate uses "Particulars of Insured Person(s)" and is unaffected. Fix: count a
certificate as Part 1 present when it prints any personal field (life assured, insured member, name of insured, a name
line with an amount and "As of"/effective date). Then add this layout as a control.

**R51-3 (Low): a letter that encloses any titled page is no longer correspondence.** That is right for the CI II welcome
pack, and for a renewal letter enclosing new "Policy Wording" (now policy_wording). But a claim letter that attaches a copy
of the policy schedule is now a `personal_schedule`, a second copy of existing cover. It is acceptable because the
schedule is real; the duplicate-handling path should cope.

## Verdict on PR #83 at `d883368`

**Not ready yet:** tighten R51-1 and R51-2. Both are small regex conditions, and each needs one control case. The four
real fixes are correct and nothing else in this household moves. After merge, DC still needs to re-read the four
documents (as the report says).

# Round 52: recheck of PR #82 at `897a8a0` (R50-1 to R50-4)

Method: verify.ts at 897a8a0 run offline against the real household snapshot (never committed). Every line with a `%`
in every document was fed in as a quote with Desmond's accident base, plus targeted probes. 741aba9 was run with the
same probes for comparison. No model calls.

## Confirmed fixed

- **R50-1:** the Comatose rows ("At least 6 months 50%") now get no card. The joined "… 15% of the Sum Insured" also
  gets none. Their heading names "Comatose State Sum Insured".
- **R50-2:** BS p4 TPD "100% of the Sum Insured, up to a maximum amount of $400,000" now gets no card. The BS p10
  natural catastrophe prose (S$90,000 at 741aba9) now gets no card either.
- **R50-3:** the base line quoted for Desmond must name Desmond. Charmaine's line gets no card.
- **R50-4:** headings now end sections.
- **Evidence Reviewer figures still hold:**
  - BS wrist S$120,000 and hip S$450,000 for Desmond; wrist S$120,000 for Charmaine.
  - PS wrist 25% of S$5,000 is S$1,250 and hip is S$3,750.
  - PS p10 dismemberment rows and the BS split-line rows ("70%" / "(b) Right Hand" gives S$420,000) still work.
  - A Term Life base on an accident row is refused.

## Findings

**R52-1 (High, wrong amount): a cap on the next line is still dropped.** Product Summary p13 prints "• Death due to
natural catastrophe\t15% of Sum Insured" with "or up to S$50,000, whichever is lesser" on the *next* line. The row line
is a short table line ending "% of Sum Insured" with no cap word on it, so Desmond gets a **S$90,000** card. The true
amount is at most S$50,000. It stays S$90,000 even when the model quotes both lines, because `CAPPED` only tests
`rowLine(...).text`. The bug was already there at 741aba9 (my miss in round 50). Fix: test `CAPPED` on the whole quoted
passage and on continuation lines after the row, up to the next bullet or numbered row. A line starting "or", "up to",
"whichever" or "subject to" always belongs to the row above. Add this row as a control.

**R52-2 (Medium, needless refusal that hides amounts): burns rows now get no card.** `CAPPED` includes `greater`, and
every burns row prints "Equals to or greater than 8%". So BS p7 and PS p12 third- and second-degree burns rows (for
example head ≥8% 100%, which is S$600,000, or body 15–20% 75%, which is S$450,000) are now facts with no amount. At
741aba9 they gave the right cards. Fix: drop `greater` (and `lesser`) when it is not part of "whichever is
greater/lesser", or match only `whichever\s+is\s+(?:the\s+)?(?:greater|lesser)`. Add one burns row as a control.

**R52-3 (Low, qualifier): PS p10 accident TPD "150% of Sum Insured" gives S$900,000.** The total is right. BS p5 says
anything above $200,000 is paid as a $200,000 lump sum and the balance in three annual instalments. The card should
carry that, as a condition from the model or a note. This is not a wrong amount.

**Pre-existing, not new (Low):** PS p5 Term Life "Death 100% of Sum Insured" with Desmond's S$1,000,000 base gets no
card, because no Term Life heading precedes it in the Product Summary. The certificate prints S$1,000,000 directly, so
the amount is not hidden.

The new prompt line (give every applicable amount separately, never only the larger, add "uncertainty" when documents
differ) is consistent with the Evidence Reviewer's rule and with "never added".

## Verdict on PR #82 at `897a8a0`

**Not ready yet:** R52-1 is a wrong claimable amount, and R52-2 hides amounts that 741aba9 showed correctly. Both are
small changes to `CAPPED` and its scope, each with one control case. R50-1 to R50-4 are fixed.

# Round 53: recheck of PR #83 at `cec8873` (R51-1, R51-2)

Method: `intelligence.ts` and `messy.ts` at cec8873 run offline against the snapshot (never committed) and synthetic
probes. `npm run documents:role-test` gives 12/12.

## Confirmed

- On the snapshot, the same four roles change as at d883368. Product Summary, Certificate, the CI II illustration and
  the invoice are unchanged. DC's Benefit Summary stays `benefit_guide`.
- **R51-1:** "Harbour Group Insurance Summary / Group Policy No. G123400" is null again. A personal travel summary with
  "Policyholder: Lim Wei Jie" is still `personal_schedule`.
- **R51-2:** combined certificates whose Part 1 says "Name of Insured Member" or "Life Assured: … Sum Assured S$…" are
  `certificate` again.
- **R51-3:** a claim letter enclosing a schedule copy is still `personal_schedule`. This is accepted.

## Findings

**R53-1 (Medium): a definition line counts as a named person.** The person-field patterns accept any two words after the
colon. Both new rules therefore treat a definitions line as a named person:
- "Group Insurance Summary / Master Policy No. G123400 / Insured Person: any eligible employee of the company" is
  `personal_schedule`. Only "group policy" is skipped, not "master policy".
- A Part 2-only "Highlights of Cover" printing "Insured Person: any member of the Scheme", "Life Assured: the person
  named in Part 1", or a plan table "Plan A Sum Insured: S$100,000" is `certificate`. At d883368 these were
  `benefit_guide`, and `detectHighConfidenceReferenceRole` still says `benefit_guide`.

Main also called the Part 2 cases `certificate`, so this is no worse than main. It is the same generic-as-personal error
R51-1 named, though, and a multi-plan table read as a personal certificate is a route to a wrong amount.

Fix:
- Reject a field value that starts with any, the, a, an, all, each, every, eligible, means or refers.
- Skip "master policy" as well as "group policy".
- Count "Sum Insured: S$…" as Part 1 only when the same line or page also prints a named person (the name-line rule
  already does this).
- Add one definitions control.

**R53-2 (Low):** a personal "Policy Summary" whose "Insured Person" label and name sit on separate lines is now null. It
was `personal_schedule` at d883368. The model's role then stands, so this is acceptable.

## Verdict on PR #83 at `cec8873`

**Not ready yet:** R53-1 needs a stop-word guard on the two person-field patterns, a "master policy" skip, and one
control. Everything else is confirmed.

# Round 54: review of PR #84 at `97ceaae` (household deletion removes its Pinecone namespace)

Method: read the diff (`lib/rag/pinecone.ts`, `lib/lifecycle/coordinator.ts`, the deletion regression script) and the
callers in `lib/rag/ingest.ts` and `lib/rag/backfill.ts`. The DB regression suite was not run, because database suites
are out of scope for this role.

## Answers to the three questions

- **Only the deleted household's namespace?** Yes.
  - `deleteHouseholdPassages` sends `{deleteAll: true, namespace: namespaceFor(householdId)}`, and `namespaceFor` is
    the identity function, the same one used for every upsert and search.
  - It runs only after `deleteHousehold()` has returned. That call already passed the `SELECT … FROM accounts`
    existence check and the owner/RLS check, so a forbidden or missing household throws before any Pinecone call.
  - The test asserts exactly one delete-all, scoped to the deleted id, and that the other household's id never appears.
- **Can a failed Pinecone call block or corrupt the deletion?** No.
  - The call is awaited inside `.catch(...)`, after the irreversible DB delete. `apiKey()` and `indexHost()` errors are
    rejections inside the async function, so they are caught too.
  - It is skipped entirely when `PINECONE_API_KEY` is unset. A 404 (namespace never created) counts as success.
- **What happens to the rest if it fails?** The household is already fully deleted, and the outcome is still
  `completed`. Only a `console.warn` records the miss, and the namespace and its passage text remain.

## Findings (all Low, none blocking)

**R54-1 (Low, privacy retention): no retry.** If Pinecone is down at that moment, the deleted household's passage text
stays in the index forever. Nothing reads it (the namespace is a deleted UUID), but it outlives the deletion. The
per-document deletes at coordinator.ts:275 and :886 have the same pattern. Suggested later: record the namespace in the
existing purge queue (`enqueueStoragePurge`-style) or the daily jobs cron, so it is retried.

**R54-2 (Low, race): an upload being indexed during deletion can recreate the namespace.** `ingest.ts` inserts chunks
and then upserts for up to 120 s (`indexPolicyPassages`). If the household is deleted between those steps, the upsert
lands after the delete-all and recreates the namespace with that document's passages. Later chunk inserts fail on the
foreign key, so only an upsert already in flight leaks. R54-1's retry would also close this.

**R54-3 (Low, defensive):** `deleteHouseholdPassages` is exported and would send `namespace: ""` for an empty id, which
Pinecone treats as the default namespace. Today the only caller has already proved the id exists. A one-line
`if (!accountId.trim()) throw` would keep any future caller from emptying the default namespace.

**R54-4 (Low):** the cleanup adds up to about 60 s (host lookup 30 s plus delete 30 s) to the DELETE response in the
worst case, after the household is already gone. That is acceptable.

## Verdict on PR #84 at `97ceaae`

**Ready.** The scope is safe, and a failure cannot block or corrupt the deletion. R54-1 to R54-4 are follow-ups.

# Round 55: recheck of PR #82 at `7089ddd` (R52-1 to R52-3)

Method: as in round 52. Every `%` line of every snapshot document was quoted at 897a8a0 and at 7089ddd and the results
diffed. The targeted probes were rerun. No model calls.

## Confirmed fixed

- **R52-1:** PS p13 "Death due to natural catastrophe 15% of Sum Insured" with the cap on the next line now gets no card,
  whether the quote is the row alone or both lines. The separate "S$50,000" card still shows. PS and BS comatose rows
  get no card.
- **R52-2:** BS p7 and PS p12 burns rows give cards again (head ≥8% 100% is S$600,000, body 15–20% 75% is S$450,000).
  The whole-snapshot diff shows no other change: no new refusals and no lost cards. The Evidence Reviewer figures, PS
  fractures on S$5,000, dismemberment rows and split-line rows are unchanged.
- **R52-3:** handling it with a prompt rule (the instalment terms as their own fact quoting BS p5) is acceptable. The
  S$900,000 total is right, and borrowing a condition from another document on the server would be worse. The server
  does not enforce it; the release set will show whether the model does it.

## Finding

**R55-1 (High, wrong amount; pre-existing, already at 741aba9): a row with two percentages accepts either.** Burns rows
print a threshold and a payout on one line ("- Equals to or greater than 8%\t100%"). `checkAmount` only asks that the
stated percent appears somewhere on the row line. So a model statement of 8% gives a **S$48,000** card where the
document pays 100% (S$600,000). Likewise 5% on "2% but less than 5%\t50%" gives S$30,000, and 40% on "≥40%\t50%" gives
S$240,000.

The model would have to misread the row, but catching exactly that is this check's job, and R52-2 has just made these
rows computable again. Fix:
- When the row line prints more than one percentage, accept only the last one (the compensation column).
- Or refuse when the stated percent sits inside "greater than / less than / at least … %".
- Add one burns control with the threshold percent.

## Verdict on PR #82 at `7089ddd`

**Not ready yet, one small fix:** R55-1. R50-1 to R50-4 and R52-1 to R52-3 are all fixed.

# Round 56: recheck of PR #83 at `8022bc1` (R53-1)

Method: as in round 53, with the same probes. role-test gives 13/13.

## Confirmed

- **R53-1 fixed.**
  - "Group Insurance Summary / Master Policy No. … / Insured Person: any eligible employee" is null.
  - The Part 2-only definitions probes ("Insured Person: any member", "Life Assured: the person named in Part 1") and a
    plan table "Plan A Sum Insured: S$100,000" are `benefit_guide` again.
- **Controls hold.** Combined certificates with "Name of Insured Member" or "Life Assured: Lim Wei Jie" stay
  `certificate`, and the personal travel summary stays `personal_schedule`.
- **Snapshot:** the same four roles change and nothing else. DC's Benefit Summary stays `benefit_guide`.

## Notes (Low, not blocking)

- **R56-1:** the name-line rule still accepts any line with an amount and "effective date"/"as of", with no name
  required. So a Part 2 line like "Ambulance limit S$5,000 effective date: 01/01/2026 for all members" makes the page
  `certificate`. It is contrived and no worse than main.
- **R56-2:** `PERSON_VALUE` needs at least two words, so a single-word name ("Insured Person: Madonna") does not count.
  The cost is a null role, and the model's role then stands.
- R51-3 and R53-2 remain accepted.

## Verdict on PR #83 at `8022bc1`

**Ready.** After merge, DC re-reads the four documents, as the PR report says.

# Round 57: recheck of PR #82 at `9fe083c` (R55-1)

Method: as in round 55. The whole-snapshot sweep was redone with the *last* `%` on each line as the stated percent, at
7089ddd and at 9fe083c, and the results diffed. The targeted probes were rerun.

- **R55-1 fixed.** On burns rows, a stated 8%, 5% or 40% (the threshold) now gets no card. The payout figures still give
  the right cards: head ≥8% 100% is S$600,000, body 15–20% 75% is S$450,000, and PS head 2–5% 50% is S$300,000.
- **No other change.** The only difference in the snapshot diff is the reason wording on two 0.75% terrorism-limit
  lines, which already had no card.
- **Unchanged and still correct:**
  - The Evidence Reviewer figures (BS wrist S$120,000 and hip S$450,000 for Desmond, wrist S$120,000 for Charmaine).
  - PS fractures on S$5,000 (S$1,250 and S$3,750).
  - Dismemberment rows and split-line rows.
  - No card for comatose, the TPD cap or natural catastrophe (either document).
  - Another person's base and a Term Life base are refused.
- **Note (Low):** a row with two payout columns (for example "Plan A 50%  Plan B 30%") accepts only the last column. That
  errs towards no card, not a wrong amount, and no such row exists in this household.

## Verdict on PR #82 at `9fe083c`

**Ready.** R50-1 to R50-4, R52-1 to R52-3 and R55-1 are fixed, and I found no remaining wrong-amount path.

# Round 58: recheck of PR #83 at `c6e48fb` (Test engineer's policy-wording regression)

Method: as in round 56. role-test gives 15/15.

- **Fix confirmed.** The "Policy wording" rule now needs an exact title line within the first 8 lines of page 1, and is
  skipped when the opening says "this endorsement". An endorsement that only cites "the policy wording" falls through to
  `endorsement` again.
- **Snapshot:** the same four roles change. The travel wording (output_…157) is still `policy_wording`, and DC's Benefit
  Summary is still `benefit_guide`.
- **No change on the other probes:** the R51-1, R51-2 and R53-1 controls, the definitions probes, the claim letter and
  the renewal letter enclosing a wording all give the same roles as at 8022bc1.
- **Note (Low):** a wording whose title line carries more words ("Example Plan Policy Wording", "Policy Wording (v3)")
  no longer matches. It falls back to the later rules, which is main's behaviour, so it is no regression against main.

## Verdict on PR #83 at `c6e48fb`

**Ready.**

# Round 59: review of PR #82 at `39ab335` (loosened checks: currency inference, heading-% mapping, wider conditions, perDay, identifiers, file facts)

Method: verify.ts at 39ab335 run offline.
- The whole-snapshot `%` sweep was diffed against 9fe083c, and all earlier probes were rerun.
- Synthetic documents were added to a copy of the snapshot household for currency, perDay and condition cases.
- No model calls. Nothing private is committed.

## Confirmed

- **No change on the snapshot sweep.** The Evidence Reviewer figures, PS fractures on S$5,000, burns payout rows,
  split-line rows, and no card for comatose, TPD cap and natural catastrophe all hold.
- **New and correct:** PS p5 Term Life "Death / TPD 100% of Sum Insured" now gives S$1,000,000 for Desmond, because the
  scheme title is read as that section.
- **Kept out:** the Benefit Summary's "Core or Voluntary" footnote is still not put on the PS wrist row. A travel
  policy's personal-accident clauses are not put on the group PA certificate line.
- **Currency:** a page declaring "Currency : Singapore Dollar" gives S$ to "300,000.00". A US$ amount on an SGD page,
  and an S$ amount on a US Dollar page, are refused.

## Findings

**R59-1 (High, wrong amount; also reopens R55-1): `rowFor` maps a wrong percentage onto whichever row prints it.** When
the quoted row's last % differs from the stated one, `rowFor` searches every document for a single tab row ending in the
stated %. The row qualifies when its label shares two words with the statement's text *or quote*. The overlap count also
counts repeated label words, so "Loss of or Permanent Total Loss of …" matches on "loss" alone.

| Statement | Card | Correct |
|---|---|---|
| Loss of speech, 25%, quote "(% of Sum Insured)" | S$150,000 (hearing in one ear row) | S$300,000 |
| Loss of sight in one eye, 30% | S$180,000 (a thumb/hand row) | not that row |
| R55-1 probe: "≥40% → 50%" row quoted, model says 40% | S$240,000 (the "25–40% → 40%" row) | S$300,000 |

The check that existed to catch a wrong percentage now turns it into a different row's amount, labelled with the model's
words.

Fix:
- Never map away from a quoted row line that prints a percentage. Use `rowFor` only when the quote prints no row
  percentage at all (a heading or wording).
- Count distinct label words, and match on the statement's text only, not the quote.
- Require *all* label words to match (or name the row exactly), and search only the quoted document.
- Add controls for speech 25% and burns 40%.

**R59-2 (High, wrong amount): `perDay` ignores other day rules in the same text.**
- "S$100 per day from the 1st day, ICU S$200 per day for a maximum of 7 days / up to a maximum of 365 days per policy
  year" with a 30-day stay gives **S$700**. The first "maximum … 7 days" is the ICU cap; the right answer is S$3,000.
- "S$100 per day, payable after the 3rd day … maximum of 30 days / The benefit is not payable if the stay is less than
  7 days" with a 5-day stay gives **S$200**, where nothing is payable.

Fix: compute only when the row and its continuation print exactly one daily figure, one start-day rule and one
maximum-days figure, and no other day count or "not payable / less than / minimum / per admission" wording. Otherwise
show the daily benefit as a fact.

**R59-3 (Medium, wrong amount): the stay length can come from an unrelated number.** `stayDaysWritten` accepts any "N
days" the household wrote. "Can I claim within 30 days?" lets a stay of 30 through and gives a S$600 card for a stay no
one described. Fix: require the number beside stay words ("in hospital for 15 days", "stayed 15 nights", "15-day stay"),
or ask.

**R59-4 (Medium, borrowed condition): a condition travels between sub-benefits of one benefit.** In the Benefit Summary,
"A. Death …" to "N. Natural Catastrophe" are not headings, so everything under "BENEFIT 2: GROUP PERSONAL ACCIDENT" is
one section. The Comatose condition "must be confined to a Hospital for the duration of the Comatose state" is accepted
on the **Hip fracture** row. It wrongly suggests a fracture claim needs a hospital stay. Fix: treat lettered or numbered
sub-benefit titles ("M. Comatose State Lump Sum Benefit", "D. Injury due to Accident") as section ends for conditions, or
keep conditions to the row's own sub-benefit.

**R59-5 (Medium, wrong currency): currency inference on a page that names another currency.** "All amounts are in
Singapore dollars unless stated otherwise." with a row "Medical expenses overseas (in US$)\t50,000.00" gives
**S$50,000**. Fix: no inferred currency when the page says "unless stated otherwise/specified", or when the quoted row
line or its column heading names another currency (US$, USD, RM, HK$, A$, €, £).

**R59-6 (Low-Medium): a non-money figure on a declared-currency page becomes money.** "Currency : SGD / Units
allocated\t1,250.00" gives an S$1,250 card. Fix: refuse when the row label names units, rate, age, year, points or
factor.

**Notes (Low):** the file-status facts come from the library record and read correctly. Identifier read-past keeps
"Call 1250" blocked against S$1,250. One edge: a bare 6+ digit number that the documents print unformatted would be read
past in prose. None exists in this snapshot.

## Verdict on PR #82 at `39ab335`

**Not ready.** R59-1 and R59-2 are wrong claimable amounts that the previous head refused, and R59-1 reopens R55-1.
R59-3 to R59-5 should be fixed in the same pass; each needs one control. The other loosenings (scheme-title section, file
facts, identifiers, unsigned figures on a schedule page) look right.

# Round 60: recheck of PR #82 at `fa0ef79` (R59 fixes, card moves, two-line rows)

Method: verify.ts at fa0ef79 run offline. The round 52/55/57/59 probes, the whole-snapshot `%` sweep and new probes on
the two new rules were run against the snapshot household, plus a copy with synthetic documents. No model calls.

## Confirmed fixed

- **R59-1:** a quoted row whose last % differs is refused, never moved. Speech 25% and sight 30% now give no card, and
  the R55-1 burns probe (40%) gives none again. A heading quote with the right % still maps (speech 50% gives
  S$300,000).
- **R59-2:** the ICU-cap and minimum-stay texts no longer give a stay card.
- **R59-3:** "within 30 days?" no longer counts as a stay. "I was in hospital for 15 days" still gives S$150 (S$30 a day
  from day 11).
- **R59-4:** the Comatose hospital condition is no longer kept on the Hip row.
- **R59-5:** "unless stated otherwise" with a US$ row gives no inferred currency.
- **R59-6:** a "Units allocated" figure is refused.
- **Snapshot sweep unchanged.** The Evidence Reviewer figures, S$5,000 fractures, burns payouts, and no card for the caps
  (the natural catastrophe cap now shows as "Up to S$50,000") all hold.
- **Legitimate moves work:** the PS recuperation S$250 card moves to the BS "$250 per hospitalisation" line with its
  24-hour condition, and PS child education moves to the BS "$5,000 per child" line with its age and student
  condition. A recuperation condition offered for the compassionate allowance does not move it.

## Findings

**R60-1 (High, wrong amount): the two-line fallback pairs a row's label with the next row's figure.**
`acrossTwoLines` only needs every quoted word and figure to appear somewhere on line *i* and line *i+1*. On PS p13:

| Quote | Card | Correct |
|---|---|---|
| "Child Education Fund Benefit S$250" | **S$250** (recuperation figure) | S$5,000 per child |
| "Ambulance Cost Up to S$10,000" | **Up to S$10,000** (mobility-aid figure) | up to S$500 |
| "Compassionate Death Allowance Benefit S$5,000 per child" | **S$5,000** | up to S$2,000 |

A model that mixes up two adjacent rows is exactly what this check must refuse.

Fix: accept only the H7 shape.
- The figure and the start of the label are on line *i*.
- Line *i+1* prints no money figure and does not start a new row (bullet, number, letter or tab-separated label).
- Line *i+1* is only the label's continuation ("Permanent Disablement*").
- Add these three as controls.

**R60-2 (Medium-High, borrowed condition and cross-person): a card can move to any document that prints the figure and
the condition.** `lineWithCondition` ignores whose document it is and which benefit the target line is.
- Desmond's PS recuperation S$250 card, with a condition quoted from a document linked only to Charmaine ("Only for
  stays of at least 48 hours"), moves to *Charmaine's* document and keeps her condition.
- PS child education S$5,000, with a condition quoted from the unlinked CI plan, moves to the CI plan's "Death Benefit
  of S$5,000" line with "the Policy will terminate".

The figure is the same in both cases, but the card now cites another person's or another product's benefit with that
benefit's condition. That is the B1 error the rule set out to prevent.

Fix: move only when all of these hold.
- The target document is linked to the statement's person, or has the same linkage as the quoted one.
- The target line's section has the same cover as the quoted row's.
- The target line names the same benefit (its label words match the quoted row's).

**R60-3 (Low-Medium): `SUB_BENEFIT` misses "J, Accidental Hospital Recuperation Benefit"** (BS p9 prints a comma). The
recuperation text is therefore inside "I. Home Rehabilitation Renovation Expenses", and the home-rehab condition ("a
self-powered, climbing wheelchair") is accepted on the $250 recuperation card. Fix: allow `[.,)]` after the letter.

**Note (Low):** a moved card takes the target's printed sign, so S$250 becomes "$250" (unresolved currency). This is
acceptable because it is what that page prints.

## Verdict on PR #82 at `fa0ef79`

**Not ready.**
- R60-1 is a wrong claimable amount from the new two-line fallback.
- R60-2 lets the new move rule borrow another person's or another product's line and condition.
- Both are tight guards with controls, and R60-3 is a one-character regex fix.
- Every R59 item is fixed.

# Round 61: review of PR #85 at `1b93474` (re-join Coverage rows stored on the wrong cover)

Method: read the diff (`lib/ledger/store.ts` seedLedger, plus a DB regression case), `coverageForLedgerRow` and
`coverageForBenefit`, the person-edit path (store.ts:106) and the `seedLedger` callers. The DB suite was not run,
because database suites are out of scope for this role.

## Answers to the three questions

- **Can it move another person's or product's rows?** No.
  - The SELECT is scoped to `account_id=$1`.
  - Each row is matched only to a contract whose `ownerId` equals the row's `family_member_id` and which contains the
    row's `policy_id`.
  - The new basis comes from `coverageForLedgerRow` on that same person's contract, the same join new rows already use.
  - Only rows whose stored basis equals one of *that* contract's cover amounts are touched. A printed fixed limit such as
    S$5,000 is left alone, and the test covers this.
- **Is it idempotent?** Yes.
  - After the update the stored basis equals the join, so the next run takes `continue`.
  - A cleared row (NULL) leaves the `sum_basis IS NOT NULL` set, and the earlier unbased-join block re-tries it each run
    with the same result.
  - `updated_at` is not touched (there is no trigger on coverage_rules), so the row stays machine-made and a re-read still
    replaces it.
  - Person edits set `updated_at=now()` (store.ts:106), so confirmed, rejected or edited rows are excluded by
    `updated_at=created_at`, and the test covers this.
- **Does it rewrite stored data?** **Yes.**
  - It UPDATEs `coverage_rules.sum_basis` on live rows the next time `seedLedger` runs after deploy. That covers the
    dashboard load, `/api/ledger`, chat workflow and ingest, and so includes DC's real household.
  - It is derived machine data, not anything a person typed, and it is the same kind of write the existing join above it
    already makes.
  - It is still a data correction that runs automatically on production, so **merging it is DC's yes for that change**.
    The coordinator should say that plainly when asking.
  - The old (wrong) S$1,000,000 bases are overwritten and are not kept anywhere, but they can be recomputed from the code.

## Notes (Low, not blocking)

- **R61-1:** when the join is ambiguous (no single cover fits) and the contract's covers have different amounts, the
  basis is cleared. A row that showed an amount then shows only its percentage. That is consistent with how new rows are
  joined and better than a possibly wrong cover, but it is a visible change: some rows may lose a figure rather than
  gain the right one.
- **R61-2:** a document-printed fixed limit that happens to equal one of the contract's cover amounts (for example "% of
  S$350,000" where a cover is also S$350,000) would be treated as joined and re-joined. No such case exists in this
  household.
- **R61-3:** there is one UPDATE per changed row on every `seedLedger` call until it settles, then none. Concurrent calls
  write the same value, which is harmless.

## Verdict on PR #85 at `1b93474`

**Ready on the code.** Its scope is limited to the person's own contract, and it is idempotent. Because it rewrites
stored Coverage data on production when it runs, the merge needs DC's explicit yes, with a one-line explanation that
the accident rows will switch from S$1,000,000 to S$600,000 and a few ambiguous rows may show only their percentage.

# Round 62: recheck of PR #82 at `844e968` (R60-1 to R60-3, plus the owner's question on certificate-line conditions)

Method: as in round 60. All earlier probes and the snapshot sweep were rerun, with new probes for the certificate-line
condition path.

## Confirmed fixed

- **R60-1:** "Child Education Fund Benefit S$250", "Ambulance Cost Up to S$10,000" and "Compassionate … S$5,000" give no
  card. The legitimate H7 mobility-aid row still gives "Up to S$10,000".
- **R60-2:** no card moves to a Charmaine-only document or to the unlinked CI plan. The legitimate moves (S$250
  recuperation to the BS line with the 24-hour condition, child education to the BS line with its age condition) still
  work.
- **R60-3:** the home-rehab wheelchair condition is no longer kept on the "J, Accidental Hospital Recuperation" card.
- **No other change:** the snapshot sweep matches, and every round 52–59 probe gives the same result as at fa0ef79.

## The owner's question: yes, restrict it (R62-1)

**R62-1 (Medium-High, cross-person borrowed condition; present since 39ab335, missed in round 59).** The certificate-line
path in `conditionApplies` accepts a condition from *any* document whose section heading names the same cover.
- A travel policy linked only to Charmaine, headed "PERSONAL ACCIDENT", prints "The benefit is reduced by 50% for an
  Insured Person aged 70 or above."
- That condition is kept on **Desmond's** group PA certificate line (S$600,000).
- My round 59 probe used "SECTION 2: PERSONAL ACCIDENT", which `coverName` does not read as that cover, so it passed by
  accident.
- I could not make the owner's exact case (a BS "BENEFIT 2: GROUP PERSONAL ACCIDENT" summary row taking another
  document's condition) borrow in this household. The path allows it all the same.

Fix (small): take the cross-document path only when
- the statement's line names a household member (the certificate's "Name S$… As of …" line), as the owner proposes; and
- the other document has the same non-empty linked people as the statement's document, the same guard R60-2 uses.

Add the Charmaine-travel control.

## Verdict on PR #82 at `844e968`

**Not ready, one small fix:** R62-1. Everything from R59 and R60 is fixed and confirmed.

# Round 63: review of PR #86 at `c0dbbb9` (reference summaries: "Used for …"; phone Benefits sideways scroll)

Method: read the diff (`app/policies/page.tsx`, `app/globals.css`, two e2e specs). Browser tests were not run.

- **No claim of personal cover.**
  - `covered` still excludes `scheme_reference_match` links (page.tsx:542), so the "Covers …" line is only ever built
    from personal links.
  - A summary linked only by a scheme match now reads "**Used for** Desmond, Charmaine · as the wording for their plan".
    It does not say "Covers", it names the role (wording for their plan), and the names come from the policy's own
    `linked_people` in this household.
  - A document with no links of either kind still says "Covers nobody yet · choose who it covers…".
  - The open picker keeps "Also available as matching wording for …" (page.tsx:599), and nothing new is written to the
    database.
- **Button:** it now reads "Change" rather than "Choose" when only reference links exist. Opening it starts with no
  personal cover selected, as before, and saving still goes through `saveCoverage`, so a person must pick people
  explicitly to make it personal cover.
- **CSS:** `min-width:0; overflow-wrap:anywhere` on benefit items, heads and schedule headings. This is a contained
  change for long file names, with no layout change elsewhere.
- **Note (Low):** "Used for" can still be skimmed as cover by a hurried reader. "Wording used for …'s plan" would be
  harder to misread, but the current text is accurate.

## Verdict on PR #86 at `c0dbbb9`

**Ready.**

# Round 64: recheck of PR #82 at `fe5bd31` (R62-1)

Method: as in round 62. All probes from rounds 52–62 and the snapshot sweep were run at 844e968 and fe5bd31, and the
outputs diffed.

- **R62-1 fixed.** The Charmaine-only travel policy's "reduced by 50% … aged 70 or above" is no longer kept on
  Desmond's group PA certificate line. The cross-document path now needs a household member named on the statement's
  line and a document with the same non-empty linked people.
- **No other change.** The only difference in the full probe diff is that line. The Evidence Reviewer figures, the
  refused caps, R55-1, R59-1 to R59-6 and R60-1 to R60-3 all hold, and so do the legitimate moves (S$250 recuperation and
  child education to the BS lines with their own conditions).
- **Residual (Low, not blocking):** a different product linked to *exactly the same* people (for example a family travel
  policy linked to both spouses with a "PERSONAL ACCIDENT" section) can still lend a condition to the group PA
  certificate line. Conditions never carry money, and the case needs the model to cite that clause. A later tightening
  could also require the same insurer or scheme reference.

## Verdict on PR #82 at `fe5bd31`

**Ready.** Every wrong-amount and borrowed-condition finding from rounds 50–62 is fixed, and I found no remaining
wrong-amount path in this household or in the synthetic probes.

---

# Round 65: PR #85 re-review at `10f998e` (benefit summary read as a certificate)

What changed since round 61 (`1b93474`): `lib/policies/inventory.ts` adds `servesAsReference()`, so any document with
role `certificate` or `personal_schedule` and `personal_coverage_confirmed=false` is now accepted as wording
(`referenceMatchReason` at inventory.ts:82 and the insurer/product enrichment at inventory.ts:180). One new DB
regression test was added. `lib/ledger/store.ts` is unchanged.

Checked offline with `buildContracts` on synthetic documents (scratchpad `r65/t65.ts`). Desmond has a confirmed
certificate on group G-123, and three unconfirmed documents share the same insurer and group:

| Unconfirmed document | Linked people | Bound as wording to Desmond's contract |
|---|---|---|
| Benefit Summary, role `certificate`, authority 30 | Desmond | yes (intended) |
| Certificate the reader did not confirm, authority 80 | Charmaine | **yes** |
| Personal schedule, no group number, same product name | none | no |

## Findings

**R65-1 (Medium, cross-person amount). inventory.ts:51-53.** The new rule accepts *any* unconfirmed personal-role
document, not only one that names nobody. Example: a real certificate for another member whose name the reader
failed to confirm (fact-check.ts:431 and intelligence.ts:192 both drop confirmation on weak name evidence). That
certificate is now bound as wording to Desmond's contract, so its rows reach Desmond's Coverage ledger, the Benefits
page and chat through `contract.references`. Its fixed figures would show as Desmond's (store.ts:236/254/271,
api/benefits/route.ts:88/114, workflow.ts:767). At `1b93474` the same document was ignored, not mis-assigned.
DC's snapshot does not contain such a document today; the D3 certificate is confirmed for both people.

Suggested narrowing (one line): accept an unconfirmed `certificate`/`personal_schedule` as wording only when it
proves nobody's cover. Two ways to express that:
- `document_authority<70` (the Benefit Summary is 30);
- no `ai_name_match` or `user_declared` link (that is, linked only by `scheme_reference_match`).

Add a test: an unconfirmed certificate name-matched to another member stays out of the owner's references.

**R65-2 (Low, consistency).** Other places still use only `referenceRoles`, so they treat the same document
differently:
- `isGroupGuide` (household-status.ts:50) does not call it a group guide.
- The claim evidence queries (death/ci/disability/medical/travel `*-evidence.ts`, role lists near lines 212–353)
  still skip it.

This is conservative and does not produce a wrong amount. Note it only.

## Checks the coordinator asked for

- **Reference wording as personal proof:** No. `buildContracts` ownership is unchanged: it still needs
  confirmed with authority ≥70, or a user declaration. The Benefit Summary only joins `references`, and its rows keep
  the scheme-wording label: `scheme_reference_match` links are excluded from "covered" (page.tsx:542,
  coverage-assignments.ts:9). The `personalEvidence` flag at benefit-catalog.ts:585 reads the owner's coverage row,
  not the reference document's role.
- **Interaction with #83:** #85 and #83 merge cleanly (`git merge-tree`); #83 touches `lib/documents/intelligence.ts`
  and its regression script only. The two complement each other. #83 makes a *newly read* Benefit Summary
  `benefit_guide`, which is already in `referenceRoles`. #85 covers the *stored* row that still says `certificate`
  until it is re-read. Neither changes the other's decision.
- **Stored-data rewrite:** The seedLedger block is unchanged. It still updates a row only when the contract is owned by
  the row's `family_member_id` and the document is in that contract's documents or references. It still requires
  `origin<>'person'` and `updated_at=created_at`, so it remains idempotent. The only widening is that the Benefit
  Summary's rows are now in scope for the owner's own contract, which is the purpose of the fix. The merge still
  rewrites stored `coverage_rules.sum_basis` on production, so it still needs DC's explicit yes (round 61).

## Verdict on PR #85 at `10f998e`

**Not ready: one Medium (R65-1).** The wrist either/or fix is correct for DC's household. Narrow
`servesAsReference` to unconfirmed personal-role documents that prove nobody's cover, add the cross-member test, and
it is ready.

---

# Round 66: PR #85 recheck at `c40fca7` (R65-1 fix), combined with main after #83

What changed: `servesAsReference` (inventory.ts:54-61) now accepts an unconfirmed `certificate` or `personal_schedule`
as wording only when all of these hold:
- authority is below 70;
- `named_member_ids` is known and empty, where any link other than `scheme_reference_match` counts as naming someone;
- there are no declared members.

`loadPolicyInventory` selects `named_member_ids`. A caller that does not supply the field gets `false`, which fails
safe. The new DB test covers an unconfirmed certificate name-matched to another member.

I re-ran the offline `buildContracts` probe (scratchpad `r65/t66.ts`). Desmond and Charmaine are on one confirmed
group certificate:

| Unconfirmed document | Authority | Named / declared | Wording for anyone |
|---|---|---|---|
| Benefit Summary, linked only by scheme match | 30 | none | yes, for both (intended) |
| Same, with a leftover `upload_hint` to Desmond | 30 | Desmond | no |
| Certificate name-matched to Charmaine | 30 | Charmaine | no (R65-1 case) |
| Certificate, high authority, no names | 80 | none | no |
| `named_member_ids` not supplied | 30 | unknown | no |
| Declared by Desmond | 30 | Desmond | no; it stays his own declared contract, as before |

**R65-1: fixed.**

**Combination with main** (`d6c3042`, which includes #83, #82 and #86): `git merge-tree` is clean. #83 makes a newly
read Benefit Summary `benefit_guide`, which `referenceRoles` already accepts. #85 handles the stored row that still
says `certificate`. The two rules agree and neither overrides the other.

**Stored-data rewrite:** unchanged since round 65. It is scoped to the row owner's own contract and is idempotent.
It still needs DC's explicit yes, because it rewrites `coverage_rules.sum_basis` on production.

**R66-1 (Low, verify after merge).** The fix applies to DC's live Benefit Summary only if every one of its member
links is `scheme_reference_match`. That is likely: ingest.ts:751 runs `linkRelatedReferenceDocuments` after the
`upload_hint` insert (ingest.ts:622), and that function's `ON CONFLICT ... DO UPDATE` overwrites the hint. I could
not confirm it without a production read. If a hint survives, the fix is inert and fails safe: no wrong amount, but
the wrist stays S$1,250 alone. The Live site tester's Coverage check after deploy settles it.

R65-2 (Low) is accepted as is.

## Verdict on PR #85 at `c40fca7`

**Ready.** The merge still needs DC's explicit yes because it rewrites stored data (round 61).

---

# Round 67: PR #87 at `d6770ea` ("Read again" on a ready document)

What changed: `app/policies/page.tsx` adds a two-click "Read again" button on documents whose status is `ready`.
It calls the existing `retryReading` and `POST /api/policies/reprocess`. The API route is unchanged. There is also a
source-regex test in `scripts/r5-ux-regressions.ts`. I reviewed the route and the ingest path that a re-read runs
(`lib/rag/ingest.ts`, `lib/policies/linking.ts`, `lib/policies/benefit-catalog.ts`).

## What a re-read keeps (checked in code)

| Item | Kept? | Where |
|---|---|---|
| Document id | yes | the UPDATE runs in place (reprocess route, ingest.ts:600) |
| `user_declared` links | yes | not in the delete list at ingest.ts:616 |
| Removals (`policy_member_exclusions`) | yes | `notExcludedClause` for upload hints and reference links; `isExcluded` in `syncInsuredPersonToMember` |
| Dismissed names | yes | `dismissedNameKeys`, ingest.ts:647 |
| Benefit rows a person corrected (`reviewed_at`) | yes | `replaceBenefitCatalog` keeps them and drops the fresh duplicate (benefit-catalog.ts:1074-1083) |
| Person-edited ledger rows (`origin='person'`) | yes | ledger deletes are scoped to `origin<>'person'` |
| **A name the household linked by hand, and coverage tiers** | **no** | see R67-1 |

**Household scoping:** OK. The policy is read through the RLS client with `account_id=$householdId`, and the requeue
UPDATE is scoped to `account_id`. Another household's id returns 404, and only server-resolved ids reach the job.

**Mid-read and double-click:** OK.
- The button only shows when `!processing && status==='ready'`.
- A fast second request loses the atomic `UPDATE ... WHERE processing_status NOT IN (...)` and gets 409, which the
  page shows as "This document is already being analysed." No second read starts.

## Findings

**R67-1 (Medium, a household choice is lost).**
- The PR adds a tooltip at page.tsx:485: "People you chose for it stay chosen." That is not true for two kinds of
  choice.
- **Kind 1: a name linked by hand.** When the household links a detected name to a profile on the document,
  `link-person` calls `syncInsuredPersonToMember` without `link`, so the row is stored as `source='ai_name_match'`
  (link-person/route.ts:179-185, linking.ts:126).
- **Kind 2: a tick on a row already linked by name.** A CoversPicker tick on a row already linked by name keeps
  `ai_name_match` and only sets `benefit_tier` (coverage-assignments.ts:41-44, `ON CONFLICT DO UPDATE SET
  benefit_tier`).
- **What a re-read does to both.** It deletes every `ai_name_match` row first (ingest.ts:616), then re-links only
  names the automatic matcher finds.
- **Result for a hand-linked person.** The matcher already failed on that name, which is why the household linked it.
  The person is dropped from the document, and their `policy_coverages` go too (ingest.ts:634).
- **Result for a re-matched person.** The row is recreated without `benefit_tier`, so a chosen plan tier is lost.
- Before this PR the re-read was offered only on unreadable documents, which have no such links. Putting it on ready
  documents makes this reachable in one click.
- **Fix (pick one):**
  - store household name links under a source that a re-read keeps (`user_declared`, or a new source counted in
    `named_member_ids`), and have the CoversPicker tick set that source; or
  - make ingest keep the household-matched row and its `benefit_tier` across a re-read.
- **Test to add:** a hand-linked name and a tier survive a re-read. Until the fix lands, remove or soften the tooltip.

**R67-2 (Low, cost and rate; the API exposure is older than this PR).** Each confirmed click runs a full paid read on
production's key: the structure extraction, the page-by-page benefit catalogue and the conditions pass. Checkpoints
are cleared for a non-stalled re-read, so nothing is reused. `/api/policies/reprocess` has no rate limit. The only
guard is one read in flight per document, so a member can re-read every document over and over. The route already
accepted ready documents before this PR; the button makes it one click. Suggested: a per-household
`createDbRateLimiter` on the route, for example a few re-reads per document per day.

**R67-3 (Low, note).**
- While a re-read runs (status `queued`/`extracting`/`indexing`), the document's cover leaves Coverage and chat.
- A re-read that comes out worse (a role or name read differently) has no undo except reading again.
- Answers saved from the old pages are not withdrawn. This is C1-3, already accepted, and the PR comment says so.

## Verdict on PR #87 at `d6770ea`

**Not ready: one Medium (R67-1).** Keep hand-linked names and tiers across a re-read (or drop the tooltip's promise
and add the test). Then it is ready. R67-2 is advisable before launch but not blocking.

---

# Round 68: PR #88 at `a085833` (A&E and stage 3 cancer, simple chat)

What changed in `lib/simple-chat/verify.ts`:
- **Table currency.** A new `tableCurrency` lets an own-line "(S$)"/"(SGD$)" heading anywhere above the quote price
  any whole figure that sits alone in a tab cell.
- **"limit" as a money word.** "limit(s)" now counts as a money word that overrides the count/rate words of R59-6.
- **Bill card.** A new `billAgainst` card is driven by `ofBill`.

The prompt now covers lump sums, the claims-by-stage table and waiting periods against today's date, and the hook
adds "(Today is YYYY-MM-DD.)". I probed offline on top of DC's snapshot with one synthetic page per case (scratchpad
`r68/t68.ts`).

## In DC's snapshot

Every whole cell under an own-line currency heading is money:
- Product Summary p33 and Benefit Summary p16, Outpatient Medicare: 30, 100, co-payment 10, annual 1,000/500.
- The p4 premium table has no whole cell.

So the two live cases come out right: A&E S$100 per visit, and "Up to S$100" of an S$800 bill.

## Findings

**R68-1 (High, wrong amount; not reachable in DC's snapshot). verify.ts:155-159 and 399-405.**
- **The problem.** The "(S$)" heading is not scoped to its table or its column, and "limit" now overrides every
  count word.
- **Result.** A count, period, age or percentage cell becomes a dollar amount. On main every one of these was
  dropped.

| Synthetic page (own-line "(S$)" above) | Model's claim | Card at `a085833` |
|---|---|---|
| `Physiotherapy\t80\t12`, header "Maximum visits per year" | 12 | **S$12** |
| `Age limit\t65` | 65 | **S$65** |
| `Visit limit\t12` | 12 | **S$12** |
| `Physio sessions\t6` | 6 | **S$6** |
| `Co-insurance\t20`, a percent with no sign | 20 | **S$20** |
| `Plan\t2` | 2 | **S$2** |
| `Survival period\t30` | 30 | **S$30** |
| `Policy term\t20` | 20 | **S$20** |
| A later "Maximum days payable" table, row `Intensive Care Unit\t30` | 30 | dropped (R59-6 "days") |

Fix:
- Price a whole cell only when the heading heads the row's own table: only table rows or sub-headings lie between
  them, with no prose and no new heading.
- Take the figure only from a column the heading covers. A row with more numeric cells than the heading's plan
  columns does not qualify.
- Count "limit" as money only in "limit(s) per (visit|claim|policy year|…)" or "annual limit", never after a count
  word ("age/visit/day limit").
- Add plan, co-insurance, sessions, visits, period, term and survival to the R59-6 count/rate words.
- Add tests for the rows above.

**R68-2 (Medium, wrong amount on the bill card). verify.ts:473-476.**
- **The problem.** The "the household wrote it" test matches `$80` inside "US$80" (and "HK$", "A$"). The bill's sign
  comes from the model's `ofBill` string, not from what the household wrote.

| Household wrote | Model's `ofBill` | Card |
|---|---|---|
| "her bill was US$80" | "$80" | **"Up to S$80"**, "within this limit, up to the whole bill" |
| "the bill was RM800" | "800" | "Of the **S$800** bill, at most S$100" (the limit is right, the bill is mislabelled) |

The PR's own test (US$800 → no card) passes only because the model's string there carries "US$".

Fix: read the bill's currency from the household's own words. Refuse when they print another currency or a letter
before "$", or when the sign they wrote does not match the limit's.

**R68-3 (Low–Medium, the bill card's limit test is not scoped).**
- **Per-day row.** The "Limit(s) Per Visit" heading can be anywhere above on the page. A per-day "Daily benefit\t100"
  row in a later table on the same page gets "Up to S$100 of the S$800 bill".
- **Several visits.** A bill the household gave for several visits ("$800 for 3 A&E visits") is set against one
  visit's limit, which understates up to S$300 as "at most S$100".

Fix: scope the heading to the row's table, as in R68-1. Refuse when the household's sentence about the bill names a
count of visits or claims above one.

**R68-4 (Low).** hook.ts:56 uses `toISOString()`, a UTC date. Between 00:00 and 08:00 Singapore time it gives
yesterday, so a waiting period that ends today can be judged as still running. Use the household's time zone (SGT).

**R68-5 (Info, for the Evidence Reviewer).** "Non-Panel Specialist with referral" is 100 in the Product Summary
(p33) but 30 in the Benefit Summary (p16). That is a real difference between the documents. Answers should state
both figures, with the documents-differ uncertainty.

The prompt changes are otherwise consistent with the standing rules:
- The bill and stay cards stay server-computed.
- "Give no amount" applies at a stage the claims table excludes.
- A lump sum is still priced only from a certificate or table line the server checks.

## Verdict on PR #88 at `a085833`

**Not ready: one High (R68-1) and one Medium (R68-2).** Both are wrong-amount paths that the server checks exist to
stop. DC's two live cases are right, and nothing in DC's snapshot hits the new paths wrongly. Scope the table
currency and the "limit" word, and take the bill's currency from the household's words. Then recheck.

---

# Round 69: PR #87 recheck at `295e13c` (R67-1/2/3)

What changed:
- link-person hand matches and CoversPicker ticks are now stored as `user_declared`.
- `syncInsuredPersonToMember` never downgrades a `user_declared` row.
- ingest reads `householdNameMatches` (hand matches by name key) before it deletes machine links and detected
  people, then re-applies them.
- `/api/policies/reprocess` gets a household rate limit of 20 per hour (`createDbRateLimiter`, which fails open on a DB
  error).
- The confirm step shows "Coverage for this document is unavailable for a minute…".

## Checks

- **R67-1, the main case: fixed.** A name the household linked by hand, where the matcher found nobody, is matched to
  the same person again. The read happens before the delete at ingest.ts:619 and before `policy_detected_people` is
  cleared. The cover is rebuilt and the link stays `user_declared`.
- **Ticked tiers: fixed.** Ticks are `user_declared`, which ingest does not delete, so `benefit_tier` survives.
- **R67-2: fixed.** Each household gets 20 re-reads an hour. The limit is per household, not per member. It also
  counts locked-PDF unlock attempts (the same route), so 20 wrong passwords lock unlocking for an hour. Acceptable.
- **R67-3: addressed.** The confirm step now says so. A worse read still has no undo, and C1-3 is unchanged; both are
  accepted.
- **Semantic change (the coordinator asked about it).** A hand match or tick on an *unconfirmed* document now makes a
  `declared` contract for that person in `buildContracts`, with indicative amounts. Before, an `ai_name_match` link
  there made no contract. This is consistent with what a fresh tick already did, because the tick was already
  `user_declared`. It needs a choice by the household, so it does not move cover to a person nobody named.
  Probe (scratchpad `r65/t69.ts`): a benefit guide hand-matched to Desmond, who also holds a confirmed certificate,
  is listed both as his declared contract's document and as wording for his certificate contract.

## Findings

**R69-1 (Medium; the R67-1 correction case is still lost). ingest.ts:665.**
- **The problem.** The hand match applies only when the automatic matcher found nobody (`!match ? ... : undefined`).
- **How the household corrects a wrong auto match.** They take person A off the document, which records an
  exclusion, then link the printed name to B by hand.
- **What a re-read does.**
  - The matcher finds A again.
  - `syncInsuredPersonToMember(A)` returns early because A is excluded.
  - B's hand match is never applied.
  - B's `policy_coverages` were already deleted (ingest.ts:637).
  - `policy_detected_people` now records A, so the next re-read no longer even knows about B.
- **Result.** B keeps a `user_declared` link with no cover amounts.
- **Fix (one line).** Look up the hand match first, so the household's match wins over the automatic one:
  `const hand = family.find(m => m.id === handMatches.get(nameKey(person.name)));`, and if it is found, use it. Also
  add a test for the correction case.

**R69-2 (Low, double listing).** The double listing in the probe above was already possible from fresh ticks. Hand
matches on unconfirmed group documents make it more common. Check that Coverage and Benefits do not count the same
row twice for one person (no wrong total if they dedupe by benefit id).

## Verdict on PR #87 at `295e13c`

**Not ready: one Medium (R69-1), with a one-line fix.** Everything else from round 67 is fixed.

---

# Round 70: PR #89 at `9efe42a` (document Preview)

What changed:
- New `GET /api/policies/[id]/file`.
- New `createPolicyFileSignedUrl` in `lib/storage`; the local driver returns null and the route streams the bytes.
- A `PreviewLink` on the Documents page.
- Regression script `scripts/policy-preview-regressions.ts` and one e2e spec.

## Checks

- **Cross-household access: OK.**
  - The household comes from `requireHouseholdContext`: the server resolves it with `resolveActiveHouseholdId` and
    checks membership.
  - The service-connection query is scoped to `id=$1 AND account_id=$householdId AND superseded_at IS NULL AND
    activePredicate()`.
  - A malformed id, another household's id, a deleted or superseded document, a forged household cookie and a
    removed member all get 404/401/403. The regression script covers each case and checks that no storage key or
    internal detail appears in the body.
- **Scan gate: OK.** The route uses `isPolicyProcessingAllowed`, the same gate as processing (`scan_clean` or
  `not_scanned_prototype`). Otherwise it returns 409 JSON, and the button is offered only for those two states.
- **Signed URLs: OK.**
  - Created only after the checks, for the stored key read from the database (never a client value).
  - TTL is 300 s (`SIGNED_URL_TTL_SECONDS`, which the script asserts).
  - The bucket stays private.
  - The redirect carries `private, no-store`, `Referrer-Policy: no-referrer` and `nosniff`.
  - The link opens with `rel="noopener noreferrer"`.
  - The file is served from the Supabase origin, not the app origin, so stored content cannot run script on the
    app's origin.
- **Headers: OK.** `Content-Disposition` filenames are sanitised (quotes, backslash, CR/LF, non-ASCII). Every
  response, including errors, is no-store and nosniff.
- **Dependency: OK.** `sharp` 0.35.4 is already in `package.json` and the lockfile.

## Findings (all Low)

**R70-1 (Low, merge order).** This PR conflicts textually with #87: both rewrite the same `document-meta` line in
`app/policies/page.tsx` (checked with `git merge-tree`). Whichever merges second must keep Preview, Read again (with
its note) and Delete.

**R70-2 (Low, resource use).** Image previews decode the whole stored file with sharp's default `limitInputPixels`
(about 268 MP). A very large TIFF or PNG can use most of a serverless function's memory before the resize. Suggest
`sharp(buf, { pages: 1, limitInputPixels: 50_000_000 })`. A failure already returns the plain 500 message.

**R70-3 (Low, accepted pattern).** A signed URL that was already issued stays valid for up to 300 s after the
document is deleted. It also stays in browser history. This matches the documented claim-evidence behaviour; no new
link is ever minted for a deleted document.

**R70-4 (Low, cosmetic).**
- The file type is decided by the file-name extension.
- A `.doc`, `.xls` or other non-PDF file is served as `application/pdf` inline and shows as broken.
- A PDF that was uploaded under a `.jpg` name fails in sharp and returns the 500 message.
- No security impact, because of the nosniff header and the separate origin.

## Verdict on PR #89 at `9efe42a`

**Ready.** I found no cross-household path and no signed-URL leak. Resolve the #87 conflict at merge time.

---

# Round 71: PR #89 delta at `14bc2d6` (R70-2, R70-4)

- **R70-4: fixed.**
  - The format now comes from the file's first 64 bytes (`sniffFileFormat`, lib/documents/formats.ts:100). On
    Supabase Storage they are fetched with a server-side `Range: bytes=0-63` request through a fresh signed URL. That
    URL never leaves the server, and it comes from our own Supabase client, so there is no SSRF.
  - A PDF redirects to a signed URL.
  - JPEG, PNG, WebP and TIFF are re-encoded to JPEG.
  - Anything else, including Word files, old .doc files and unrecognised bytes, gets a download signed URL
    (`download=` makes Supabase send `attachment`), or `application/octet-stream` with `attachment` on local disk.
  - A file is never opened inline as something its bytes are not.
- **R70-2: fixed.** `limitInputPixels: 50_000_000` makes sharp refuse a larger image before decoding it. A failed or
  oversized photo returns 422 JSON with the private headers.
- **Unchanged and still OK.** Ownership and scan checks run before any storage access. The signed-URL TTL is 300 s.
  Every response is no-store, no-referrer and nosniff. The tests were extended for the sniffed formats and the
  422 case.
- **New note (Low).** A request may now mint two signed URLs: one to sniff the bytes and one to download. Only the
  second is ever sent to the browser. A missing or empty object makes the Range fetch throw, and the route returns
  the plain 500 message.

R70-1 (the merge conflict with #87 on the `document-meta` line) and R70-3 (accepted) still apply.

## Verdict on PR #89 at `14bc2d6`

**Ready.**

---

# Round 72: PR #88 recheck at `0b8e364`

What changed since round 68:
- **`moneyTable`.** A "(S$)" heading now holds only until another unit heading or a prose line. Its own lines say
  whether it is per visit.
- **R59-6 word list.** More count words: plan, co-insurance, sessions, visits, period, term, survival, waiting.
  "per visit/year" is stripped before the check, and "limit" no longer counts as money.
- **Bill card.**
  - It takes the bill and its currency from the household's own words (`moneyFiguresIn`).
  - It refuses a per-day, per-week or annual row, and a bill the household gave for several visits.
  - It shows only the limit, with no worked figure.
- **Date.** The hook's date is now SGT.

I re-ran the round 68 probes and added variants (scratchpad `r72/t68.ts`, on DC's snapshot plus one synthetic page per
case).

| Case | a085833 | 0b8e364 |
|---|---|---|
| Age limit 65 / Visit limit 12 / Physio sessions 6 | S$65 / S$12 / S$6 | dropped |
| Co-insurance 20 / Plan 2 / Survival period 30 / Policy term 20 | S$20 / S$2 / S$30 / S$20 | dropped |
| Waiting period (months) 3; a later "days" table | dropped | dropped |
| Bill: the household wrote US$80, HK$800, A$800, NT$800, RM800 or "800 USD" | wrong bill card | no bill card |
| Bill: a per-day row under an earlier per-visit heading | "Up to S$100 of S$800" | no bill card |
| Bill: the household wrote S$800 and the model "$800" | — | card, bill shown as "S$800" (right) |
| DC's A&E (PS p33 / BS p16), S$800 bill | S$100 + bill card | S$100 + bill card |
| **Row `Physiotherapy\t80\t12` under columns "Limit Per Visit / Max visits"; the model claims 12** | **S$12** | **S$12** |
| **`Maximum claims\t3`** | — | **S$3** |
| **`Hospital stay limit (per admission)\t30`** | — | **S$30** |
| Bill "$800 for her 2 A&E visits" | — | card: "above the S$100 limit, reimbursed only up to S$100" |

R68-2, R68-4 and R68-5 are fixed. R68-3 is fixed for the per-day case. Most of R68-1 is fixed.

## Findings

**R72-1 (Medium, wrong amount; not in DC's snapshot). verify.ts:412-423.**
- **Remaining shapes.**
  - **Count column.** A row with several numeric cells is still priced cell by cell, so a count column under a
    "(S$)" heading becomes money (S$12 visits).
  - **Labels the word list misses.** "claims", "stay" and "admission" are not on the list, so S$3 and S$30 still
    appear.
- **Why a structural fix.** Word lists will keep missing shapes like these. Suggested rule:
  - Price a whole cell only when the row has exactly one numeric cell, or when every numeric cell sits under a plan
    column (the header lines name that many plans, as "Plan A / Plan B" or "(Superior) (Deluxe)" do on DC's pages).
  - Also add claims, stay(s), admission(s) and nights to the count words.
- **Effect on DC's pages.** None: "Annual Limits Per Policy Year\t1,000\t500" sits under two plan columns, and every
  other row there has one cell.
- **Tests.** Add the three rows above.

**R72-2 (Low, bill card).** The several-visits guard only matches a number placed directly before "visits"
(`MANY`). So "$800 for her 2 A&E visits" still makes a card that says the bill "could be reimbursed only up to
S$100". For two visits that understates S$200. Suggested: refuse when the household's sentence about the bill has any
number other than the bill next to visit/claim words within a few words. Or drop "only up to" from the text and just
say the limit is per visit.

Everything else holds:
- No worked figure is shown.
- A co-payment row is never treated as a limit.
- The bill is shown exactly as the household wrote it.
- The prompt line "A limit is not a payment" fits the standing rules.

## Verdict on PR #88 at `0b8e364`

**Not ready: one Medium (R72-1).** DC's live cases are right, and every round 68 probe that produced a wrong amount
is fixed except the count-column shape. Tie whole-cell pricing to one-cell rows or plan columns, add the missing
count words, and it is ready.

---

# Round 73: PR #87 delta at `a77723b` (R69-1, R69-2)

- **R69-1: fixed.** `preferHouseholdMatch` (linking.ts:131) is now checked for every printed name, so the household's
  hand match wins over the automatic match. In the correction flow (A taken off, the name linked to B), a re-read
  links B as `user_declared` and rebuilds B's cover. A also stays off, because the automatic match is no longer used
  for that name. The DB regression and e2e spec cover this flow.
- **R69-2: fixed.** `buildContracts` (inventory.ts:138-142) drops a declared contract only when every one of its
  documents is already wording for the **same person's** evidenced contract. I probed it offline (scratchpad
  `r65/t73.ts`):
  - A booklet claimed for Desmond (who has a certificate) and for Charmaine (who has none) is listed once for
    Desmond, as wording on his certificate contract. Charmaine keeps her declared contract.
  - An unrelated booklet claimed for Desmond (a different group and product) keeps its own declared contract.
  - No benefit is hidden: the document is still read through the evidenced contract's references, which the ledger
    and benefits use (owner plus document-in-contract scoping is unchanged).
- **Unchanged:** the rate limit, the confirm note, and the scoping and double-click behaviour from round 67.
- **R70-1 still applies.** `git merge-tree` still shows a conflict with #89 on the `document-meta` line.

## Verdict on PR #87 at `a77723b`

**Ready.**

---

# Round 74: PR #88 delta at `53f92d2` (R72-1, R72-2)

What changed:
- **One figure per row.** A whole cell under "(S$)" is priced only when its row prints exactly one numeric cell, or
  exactly one per "Plan X" column named in the heading's own lines.
- **More count words.** Claims, stays, admissions and nights are added.
- **Several visits.** `MANY` now allows up to three words between a count and what it counts, and refuses any plural
  visits/claims/bills/admissions/sessions/consultations/trips, or "twice".

I re-ran the probes (scratchpad `r72/t68.ts` and `r72/t74.ts`, on DC's snapshot):

| Case | 0b8e364 | 53f92d2 |
|---|---|---|
| `Physiotherapy\t80\t12` under "Limit Per Visit / Max visits", model claims 12 | **S$12** | dropped |
| `Maximum claims\t3` / `Hospital stay limit (per admission)\t30` | **S$3 / S$30** | dropped |
| Age limit, co-insurance, plan, sessions, survival, term (round 68 set) | dropped | dropped |
| Bill "$800 for her 2 A&E visits" / "for 3 A&E visits" | card "only up to S$100" | no bill card |
| Bill, the household wrote S$800 and the model "$800" | card | card (right) |
| DC's PS p33 / BS p16: A&E 100 with an $800 bill | S$100 + card | S$100 + card |
| DC's PS p33 / BS p16: Non-Panel GP 30 | S$30 | S$30 |
| DC's PS p33 / BS p16: "Annual Limits Per Policy Year 1,000 500", Plan B | S$500 | S$500 (two plan columns) |

R72-1 and R72-2 are fixed. I found no new wrong-amount path.

**Note (Low, fails safe).** In a row with a money cell beside a count cell, the money figure is now dropped too
(`Physiotherapy\t80\t12`, claimed 80, gives no card). That is a missing card, not a wrong amount, and the model's text
still states the limit. The plan count only recognises "Plan A/B/1/2" labels. A table whose plan columns are named
otherwise ("Silver/Gold") prices only its one-cell rows, which also fails safe.

## Verdict on PR #88 at `53f92d2`

**Ready.**

---

# Round 75: PR #90 at `cee51fe` (re-join stamped rows; refresh rows seeded under an older rule)

What changed, in `lib/ledger/store.ts`:
- **Re-join.** The `sum_basis` re-join also takes rows whose `status='proposed'`, even when `updated_at` was stamped
  (the 27 Sep join stamped 52 rows).
- **Refresh.** A new `refreshSeededRows` runs before the join. It rewrites a machine row to what its current seed
  says. A row qualifies only when all of these hold: `origin<>'person'`, `status<>'rejected'`, `updated_at=created_at`,
  the seed key or legacy key matches, and the seed's `familyMemberId` equals the row's.

## Checks

- **A person's figure is not overwritten: OK, with one Low caveat (R75-1).** The only edit path is PATCH
  `/api/ledger` → `updateLedgerRow`, which always stamps `updated_at=now()`. Any edit defaults the row to
  `confirmed` unless the request says otherwise (app/api/ledger/route.ts:73-78). So:
  - The refresh never touches an edited or confirmed-by-click row: both have a stamped `updated_at`.
  - The re-join's new `status='proposed'` clause can only reach an edited row if a client sends an edit together with
    `status:"proposed"`. No UI does that today (I searched `app/`, `components/`).
  - Rows the household added are `origin='person'` and excluded from both.
- **Scope: OK.** Both passes are scoped to `account_id`. The refresh needs the seed's person to equal the row's
  person, so it can never move a row to another person. The re-join still needs the row's owner's contract to hold
  the document, and the stored basis to be one of that contract's cover amounts, as in round 61.
- **Idempotent: OK.** The refresh skips rows that already equal their seed. It does not stamp `updated_at`, so a row
  stays the machine's. `sum_basis` is only overwritten when the seed carries one; otherwise the join decides.
- **FWD liability row:** the new DB test covers it. The untouched row becomes `other` with no amount. Once a person
  changes it, it stays theirs.
- **Stored-data rewrite:** this rewrites `coverage_rules` on production (`amount`, `event_type` and `sum_basis` of
  machine rows), so the merge needs DC's explicit yes.

## Findings

**R75-1 (Low).** The API still accepts an edit together with `status:"proposed"`. Such a row would then be re-joined
over the person's typed basis. Either ignore `status:"proposed"` when the same request edits a figure, or make the
re-join clause require that the basis is one the machine wrote (see option (b) below).

**R75-2 (Info; this matters for option (b)).** `confirmed` does **not** mean that a person confirmed the row. Wording
rows are seeded `status:"confirmed"` unless the benefit needs confirmation (store.ts:173), and certificate rows are
seeded `proposed` (store.ts:191). So the 27 Sep-stamped percentage rows that this PR leaves alone are probably
machine rows seeded `confirmed`, not figures a person typed.

## View on option (b): re-join confirmed rows whose basis is a different cover's amount

- **Do not use status as the test.** Per R75-2, status cannot tell a hand-typed figure from a machine join.
- **Use time instead.** The stamped `updated_at` can tell them apart.
  - The old join stamped each row within seconds of its seeding (live: 52 rows within 12 seconds).
  - A person's PATCH lands whenever they edit.
- **Recommended rule.** Re-join a machine row (`origin<>'person'`) whose stored basis equals one of its contract's
  cover amounts and whose `updated_at - created_at` is under 60 seconds. Leave every other stamped row alone. This
  also closes R75-1.
- **Why fix them.** Those rows overstate claimable amounts (a percentage of S$1,000,000 instead of S$600,000), which
  is the worst-bug class. Fixing them matters more than keeping a figure nobody typed.
- **For DC's 4 live rows,** check their `updated_at - created_at` with a read-only query. A gap of seconds means it was
  the old join: re-join them. A gap of minutes or more means a person may have typed it: show the row as "this
  percentage may be of the wrong cover" for DC to decide, and never change it silently.
- Either way it is a production data change, so it needs DC's yes.

## Verdict on PR #90 at `cee51fe`

**Ready on code.** No other person's rows and no person's typed figure can be overwritten through the UI. The merge
rewrites stored ledger rows, so it needs DC's explicit yes. For option (b), I recommend the time-gap rule above
rather than overriding confirmed rows.

---

# Round 76: PR #90 delta at `9352440` (batch rule for machine stamps)

What changed: the re-join now covers every non-rejected machine row (`origin<>'person'`) whose basis is one of its
contract's cover amounts. Such a row is re-joined when either:
- it is untouched (`updated_at=created_at`); or
- at least 5 other machine-made rows in the account were stamped within ±60 s of it (`MACHINE_BATCH`).

Any other changed row is never rewritten. It gets one appended condition, "This may be worked out from the wrong
cover: S$X is the sum insured of another cover; the cover this pays under is S$Y. Check it before relying on it." The
note is idempotent and is skipped when it is already present.

## Can the batch rule override a real edit?

**Only in a narrow case.** Every path below needs all three of these together:
1. A person makes 6 or more ledger PATCHes within about 2 minutes. Each PATCH stamps `updated_at`, and the rows
   they confirm are machine-made (`origin` wording or schedule), so their clicks count towards the batch.
2. Inside that window they type a `sumBasis`. Only the operator Coverage page's "Fix" form exposes `sumBasis`
   (app/operator/coverage/page.tsx:105, 207); the household ledger page does not.
3. The typed value equals exactly one of the contract's *other* cover amounts. A value no cover carries is skipped
   before this point.

So no household edit can be overwritten, because a household cannot type a basis. DC confirms they never typed a
Coverage amount.

**R75-1: closed.** A lone edit sent as `proposed` is no longer re-joined, because status no longer decides.

**R75-2: addressed.** Status is ignored, so machine rows seeded `confirmed` are now re-joined.

**Live fit:** the 52 rows stamped within 12 s qualify as one batch. With 1722–1730 s between created and updated,
the old 60 s gap rule would have missed them.

**R76-1 (Low, hardening).** `MACHINE_BATCH=5` is low enough that a fast reviewer clicking confirm reaches it. The
live batch is 52 rows. Raising it to about 20 keeps the live fix and puts the batch out of reach of a person's
clicking. Alternatively, count only rows whose `sum_basis` also differs from their current join, since a person's
confirm clicks do not change the basis.

Unchanged and still OK:
- Every pass is scoped by account, and to the owner's own contract.
- The refresh still requires `updated_at=created_at` and the same person.
- No pass stamps `updated_at`.
- Rejected rows are excluded.

## Verdict on PR #90 at `9352440`

**Ready.** R76-1 is optional. The merge still rewrites stored ledger rows on production, so it needs DC's explicit
yes.

## Round 77: PR #91 (simple chat: uncovered-bill card, claim-steps prompt), head 2ede3c4 on main 9b76779

Scope: `lib/simple-chat/verify.ts` (billWritten, billUncovered, the `-bill` not_found card, the bottom-line fallback), `lib/simple-chat/prompt.ts` (a4aa437 and the prompt-only 2ede3c4), new chat-test cases. Probes run locally on pr91 lib with DC's snapshot (not committed): `t77.ts` P1-P10, `t77b.ts` next steps.

Wrong amounts: none found. The new card carries no amount (`amount: null`) and echoes the bill only as the household wrote it ("US$800", "800 dollars" stay as written). Printed hotline numbers, office hours ("8.30am to 5.30pm"), day counts and a payee sentence survive `withoutMoney` in nextSteps; a "$10 co-payment" step is still removed.

Snapshot check of the false "not covered" risk for the GP-bill case: the GPA pays fracture percentages and ground ambulance (Benefit Summary p8), not GP bills; Desmond's travel policy pays "Medical expenses incurred in Singapore" only after a trip. So the card is correct for DC's household on L4/L5.

- **R77-1 (Medium, false "not covered")** `lib/simple-chat/verify.ts:906`. The uncovered card is dropped only when a bill card was actually built. When `billAgainst` refuses (bill for several visits, a foreign currency, a per-day or annual row), a kept per-visit limit for the same person stays next to "The $800 bill you gave is not shown to be covered by Ong Pei Lin Charmaine's documents". Probes P2 ("her 2 A&E visits cost $800"), P3 ("US$800") and P4 (limit statement without ofBill) all show the S$100 limit card and the not-covered card together. The prompt makes this pairing likely, since a product missing from the certificate is to be given "only as what would apply if they have it". Fix: drop `uncovered` for a person when any kept amount statement for that person carries `ofBill` (P2/P3). P4 is model inconsistency and can also be covered by dropping it when any kept amount for that person comes from a "Limits Per Visit/Claim" row. Add P2/P3 as tests.
- **R77-2 (Low)** `verify.ts:1036` fallback. When a bottom line is dropped for stating money and there is no amount card, the first non-card not_found becomes the headline, even a side point. P7: "The documents do not say whether physiotherapy is covered." headlines over a fact that the ambulance is reimbursed. Prefer the not_found that carries `ofBill` (the intended finding), else keep "Here is what your documents say."
- **R77-3 (Low)** `verify.ts:906` suppression is household-wide. Desmond's bill card hides Charmaine's uncovered card (P6). This is conservative, because her own not_found text still shows. Note only; scoping to the same person would fit naturally with the R77-1 fix.
- **R77-4 (Low)** `verify.ts:486` billWritten matches the figure in any message of the conversation, so an earlier "$800" premium is echoed as "the $800 bill" (P8). It is an echo only, not a computed amount. Note only.
- **R77-5 (Nit)** "The 800 dollars bill you gave" (P9) reads oddly; consider "The bill of 800 dollars you gave".

Prompt 2ede3c4 (office hours both, suggestions labelled, payee in full): no conflict with the money rules; no finding.

Verdict: **NOT READY until R77-1 is fixed** (one line plus two tests). R77-2 to R77-5 are optional.

## Round 78: PR #91 delta, head 7fe86f9 (fixes for R77-1..5 and TE Q1-Q12)

Probes: `t77.ts` P1-P10 rerun on 7fe86f9 lib, plus Qa-Qf, with DC's snapshot locally (not committed).

Fixed: R77-1 (P2/P3/P4 no longer show the not-covered card next to the S$100 limit), R77-2 (P7 falls back to "Here is what your documents say."), R77-3 (per person: Qf keeps Charmaine's own finding, and Desmond's limit card no longer affects her card, which is now refused for the documents' dental lines anyway), R77-4 (P8: a figure written as a premium is not a bill), R77-5 ("The bill of 800 dollars"). Card duplicates are keyed per person and bill. A finding whose only sentence stated money still shows its card. There are no wrong amounts: the card carries no amount.

- **R78-1 (Medium, false "not covered")** `lib/simple-chat/verify.ts` `billMayBeUncovered`, last statement. The check that a document "prints a figure for that care" only looks at single lines that contain both the care word and a digit. Benefit tables often print the name on one line and the figures on the next. Probe Qc: "desmond physio bill $800" with the model's not_found shows "The $800 bill you gave is not shown to be covered by Tan Yi Chuen Desmond's documents". But his travel policy (D6, linked to him) p8 prints "Chinese medicine practitioner, physiotherapist and / chiropractor expenses / S$300 S$500 S$500 / Capped at S$50 per visit". The benefit is conditional on a trip, which the card hides, and hiding a documented benefit is a failure. Fix: count a figure on the matching line or the next few lines (for example up to 3), or use `rowLine`/`moneyTable` around each match. Add Qc as a test.
- **R78-2 (Low)** Bottom-line fallback `finding`. When the card is refused because a document prints that care (DC's L4 GP limit), the model's not_found still becomes a dropped bottom line's headline (Qd: "No cover on her certificate pays this bill."). For L4 that is close to the model's intended bottom line, and the wording is the model's, not the server's. Optionally lead with it only when `c.uncovered` is set.
- Note: the card now rarely shows for DC's household. GP and A&E lines with figures exist in the scheme documents, so the model's own finding stands alone. This leans safe and is acceptable.

Verdict: **NOT READY until R78-1 is fixed** (widen the figure check to the next lines, plus the Qc test). R78-2 is optional.

## Round 79: PR #91 delta, head 64259c8 (R78 fixes, TE N1-N9)

Probes: `t77.ts` P1-P10 and Qa-Qi rerun on 64259c8 lib with DC's snapshot locally (not committed).

- R78-1 fixed. A care's figure on the matching line or the next three now counts. Qc ("desmond physio bill $800") no longer shows the not-covered card, because his travel policy D6 p8 prints the physio limits two lines below the name.
- R78-2 fixed. A dropped bottom line leads with the finding only when its card is shown. Qd falls back to "Here is what your documents say."
- GP words widened (polyclinic, doctor, consultation, medical practitioner, whole words). "specialist doctor" now resolves to GP care first, which only refuses more cards (Qi). That is the safe side.
- Every probe leans safe: no not-covered card appears beside a limit for the same person, or for a care any of that person's documents print. No new amount is shown anywhere.

No new findings.

Verdict: **READY.**

## Round 80: PR #92 (refresh stored Coverage rows on open), head 4731a9a on main 55abc78

Scope: `app/api/ledger/route.ts` GET, `lib/ledger/store.ts` refreshLedgerOnOpen, the regression test. Read-only review; no DB suite run.

Cross-household scope: OK. accountId comes from `requireHouseholdContext`, and the throttle map is keyed by it. Every statement in `seedLedger`, `refreshSeededRows` and the joins is filtered by `account_id`. The refresh leaves `updated_at` alone, which matches #90's rules.

- **R80-1 (Medium, race with reading)** `app/api/ledger/route.ts:38`. The only guard is `ledgerReadingInProgress(accountId)`, an in-memory map filled only by `readPendingDocuments` on the same server instance. It misses three cases:
  (a) an upload's own read: `lib/rag/ingest.ts:941` calls `readDocumentIntoLedger` directly after marking the document ready, in the job's own invocation;
  (b) the dashboard's `after()` read, which runs on whichever instance served the dashboard;
  (c) any read on another instance.
  `readDocumentIntoLedger` (`lib/ledger/extract.ts:257-275`) deletes the document's model rows, then re-inserts them one by one, outside a transaction. A Coverage open that lands in that window runs `seedLedger` with `existing` missing those events. `known` then lacks them, so table-parser or schedule seeds are inserted for the same events under their own seed keys. When the read finishes, nothing removes those rows: `refreshSeededRows` only updates rows whose seed is still produced, and the stale-row DELETE only covers vanished `benefit:`/`coverage:` ids. The result is two rows for one event, the model's figure and the parser's or default figure, breaking "rows the model already read outrank the table parser". Before #92, `seedLedger` ran mostly right after a read, on the same path; #92 makes it run on every Coverage open, once per 10 minutes per instance.
  Fix: guard from the database instead of memory. Skip the refresh when any active document of the household is mid-processing (status not ready/failed), or is ready with `ledger_read_at IS NULL` and due (`pendingDocumentCount(accountId,{dueOnly:true})>0`), as well as the in-memory check. Optionally also make the model-row DELETE+INSERT in `readDocumentIntoLedger` one transaction, which closes the window for every caller.
- **R80-2 (Low, load cost)** `seedLedger` (inventory, catalog, several queries, one UPDATE per changed row) is awaited before the rows are loaded. On serverless, cold instances make the "once per 10 minutes" per-instance throttle fire on most opens after idle. Usually only the first open pays, and after the first pass there are no row writes. Acceptable for now; consider logging its duration so a slow household shows up.
- **R80-3 (Nit)** `refreshedOnOpen` grows with each household seen per instance; this is harmless at current scale.

Merging still rewrites production rows on the next Coverage open, so it needs DC's explicit yes.

Verdict: **NOT READY until R80-1 is fixed** (database-side guard). R80-2 and R80-3 are optional.

## Round 81: PR #92 delta, head 06feac8 (R80 fixes, TPD on the life cover)

Read-only review of the diff. TPD wording checked in DC's snapshot locally (not committed); no DB suite run.

R80-1 fixed. `ledgerReadUnderway` (`lib/ledger/extract.ts:364`) skips the refresh in three cases: an in-process read; a queued, extracting or indexing document updated within 30 minutes; and a ready document still due for its ledger read. The last case covers an upload's own read at `ingest.ts:941`, since the document is already ready with `ledger_read_at` NULL while it reads. A reprocess goes back to queued, so the second case covers it. A backed-off document does not hold the refresh. These are all the statuses the code writes (queued, extracting, indexing, ready, failed). R80-2 is fixed (duration logged) and so is R80-3 (map pruned above 1,000 entries).

TPD join (`lib/policies/benefit-catalog.ts:1170-1178`). The DC case is right. GTL "Total and Permanent Disability Benefit (TPD) 100% of Sum Insured" (Product Summary p5, Benefit Summary p3) has no disability cover on the contract, so it joins the single life cover, S$1,000,000, matching the Evidence Reviewer. "TPD due to Accident" (150%, Benefit Summary p5), "Mobility aid upon accidental total & permanent disablement" (p8) and the travel policy's personal-accident TPD all name an accident, so they stay off the life sum. The join needs exactly one life/death cover with a figure, so two life lines resolve to nothing.

- **R81-1 (Medium, wrong-amount risk, cheap hardening)** The TPD trigger can come from the quote alone, and the only accident check is a word search over the benefit's name and quote. Benefit Summary p10, "N. Natural Catastrophe", reads: "If an Insured Person sustains bodily injury as a result of an Accident due to a Natural Catastrophe, which ... results in death or Total and Permanent Disability from the date of loss, we will pay an additional fifteen percent (15%) of the Sum Insured or S$50,000, whichever is lesser." Suppose a row is named "Natural Catastrophe", its quote is the contiguous second part ("results in death or Total and Permanent Disability ... fifteen percent (15%) of the Sum Insured"), it has no `requires: accident`, and no product-name match placed it first. That row has a TPD trigger and no "accident"/"injur" word, so it joins GTL: 15% of S$1,000,000 instead of the personal accident S$600,000. Before this change it resolved to no cover and showed no figure. Fix: join to the life cover only when the benefit's own name states TPD (the claim-events TPD pattern on `benefitName`), not when the quote alone does. DC's GTL row ("Total and Permanent Disability Benefit (TPD)") still joins. Add the Natural Catastrophe shape as a test (it should resolve to no life cover).
- **R81-2 (Low)** A document that is ready and due but that nothing reads holds the refresh back until a reader picks it up. The dashboard's `after()` read does that on any dashboard load, so this resolves itself. Note only.

Merging still rewrites production rows on the next Coverage open, so it needs DC's explicit yes.

Verdict: **NOT READY until R81-1 is in** (one condition plus one test). R81-2 is note only.

## Round 82: PR #92 delta, head 24c3cbd (R81-1)

R81-1 fixed (`lib/policies/benefit-catalog.ts:1176`). The life-cover TPD join now needs `benefitTriggerEvents(benefit.benefitName,"")` to give TPD. Only the name is lowercased and matched, so a quote alone never qualifies. "Natural Catastrophe" (death or TPD named only in its wording) no longer joins GTL. DC's "Total and Permanent Disability Benefit (TPD)" still does. The accident-word and injury guards are unchanged. Four new tests in `scripts/system-regressions.ts` cover:
- GTL TPD joins the life cover;
- accident TPD joins GPA;
- a "Permanent Total Disablement" row written about an injury does not join GTL;
- the Natural Catastrophe shape does not join GTL.

No new findings. Merging still rewrites production rows on the next Coverage open, so it needs DC's explicit yes.

Verdict: **READY** (after DC's yes for the production row rewrite).

## Round 83: PR #93 (Haiku 5.5 price entry), head 67367e6 on main d280550

Diff: `lib/ai/providers.ts` (one entry plus a comment) and two offline checks in `scripts/simple-answer/offline-test.ts`. Read-only review; no paid call.

The price matches the published rate (claude-api skill, Haiku 5.5 section). There are two rate cards chosen by prompt length: $0.10 / $0.50 per MTok up to 100K prompt tokens, and $0.50 / $2.50 above. Cache reads are 0.1x input ($0.05 on the long card), 5-minute cache writes 1.25x and 1-hour writes 2x. The simple chat's library is about 230K tokens, so every call is on the long card. Using the long card for every call can only over-count a short prompt, never under-count.

Cost guard. `anthropicRequest` caches the library with `ttl: "5m"`, and `callUsd` charges cache writes at 1.25x input, which is right for 5-minute writes. `runSet` (`scripts/simple-answer/app-run.ts:48-50`) checks the worst case before every call: the full prefix written to cache, plus fresh input, plus `MAX_OUTPUT_TOKENS` 8000, the cap that includes thinking. Prefix tokens are estimated at length/2.5, which stays conservative even with Haiku 5.5's tokenizer counting about 30% more tokens. `--max-usd` is refused above the authorised cap. A run therefore stops before a call that could pass its cap.

- **R83-1 (Low)** `lib/simple-chat/model.ts:55-56` sends `betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"` for every model. The skill says Haiku 5.5 has no server-side fallback: with `"default"` a declined request simply stays declined (no 400, no extra spend), and a model list would return a 400. So there is no overspend or failure today. Omitting `fallbacks` and the beta header for `claude-haiku-5-5` would match the documented use; this can wait for a later PR.
- Note: for Opus and Sonnet runs, a server-side fallback is billed at the fallback model's rates, while `callUsd` prices every call at the requested model's rates. A fallback to a dearer model such as Opus 4.8 ($5/$25 against Opus 5.5's $4/$20) would be under-counted for that call. This is not new in #93 and does not apply to Haiku.

Verdict: **READY.** R83-1 is optional.

## Round 84: PR #92 delta, head 83d2707 (NAMED_TPD)

The life-cover TPD join now needs the benefit name to begin with TPD (`NAMED_TPD`, `lib/policies/benefit-catalog.ts:1138`). This only narrows R81-1's check: a name that merely contains TPD ("Natural Catastrophe ... Total and Permanent Disability", or a ledger note naming another benefit) no longer joins. DC's "Total and Permanent Disability Benefit (TPD)" still matches. A name with a leading section letter ("B. Total and Permanent Disability Benefit") would not match and would resolve to no cover. That leans safe: no figure rather than a wrong one. The accident and injury guards and the one-life-cover rule are unchanged. The TE's Natural Catastrophe ledger probe is now an assertion in `scripts/system-database-regressions.ts`.

No new findings. Merging still rewrites production rows on the next Coverage open, so it needs DC's explicit yes.

Verdict: **READY** (after DC's yes).

## Round 85: PR #94 (benefit table behind DEARPOLICY_BENEFIT_TABLE), head edb369b on main c1520b9

Read-only review of `sql/benefit-table.sql`, `lib/benefit-table/*`, the ingest hook, the three routes, and the Coverage switch in `app/ledger/page.tsx`. No DB suite or paid call was run.

What holds:
- **SQL is additive.** It adds three `CREATE TABLE IF NOT EXISTS` tables and alters, drops or rewrites nothing existing. RLS is enabled with `is_household_member(account_id)` policies and anon is revoked. The write checks tie a reading to a policy, and a confirmation to a family member, of the same household. A rollback line is given. Readers check `to_regclass` first, so code deployed before the SQL is applied keeps the old view.
- **Cross-household scope.** Every service query filters by `account_id`, including `policy_pages`. The reading upsert's `ON CONFLICT ... WHERE benefit_readings.account_id=EXCLUDED.account_id` cannot overwrite another household's row. Links and confirmations are validated against the household's own sections, covers and people.
- **Figure checks.** A row is kept only when its quote is located on a stored page and its figure is printed in that quote. A fixed base must be printed on the same page. Day counts must be printed too. A cover needs the person's name on its page. Rows are never added together, and a figure with no stated currency is labelled.
- **Flag off on the server.** Ingest, the dashboard and chat behave as today, and the routes answer `enabled:false`, 404 or 401.

- **R85-1 (High, wrong amounts)** `lib/benefit-table/assemble.ts:115-121` `columnProblem` decides whether a plan column belongs to a person's cover by raw substring:
  ```
  plan && (col.includes(plan) || plan.includes(col))
  ```
  A one-letter plan matches almost anything. Plan "A" normalises to "a", and "plan b".includes("a") is true. So a Plan A member's cover accepts a link from the "Plan B" column section, and the person is shown Plan B's figures as theirs. The same happens with "Classic"/"Premier" columns for plan "A", or with any column containing the plan's letters. Two further problems:
  - When the cover prints no plan, every plan-named column is accepted (`if (!plan) return null`). The doc comment says those are refused. Links to both the Plan A and the Plan B sections then both apply, showing two plans' figures as the person's.
  - A non-plan column ("Adult", "Child", "Per Visit") is refused whenever the cover has a plan, which hides documented benefits.

  Fix: compare whole tokens. Extract the plan identifier ("plan a", "a", "classic", "premier") and require the column's plan token to equal it. Refuse a plan-named column when the cover has no plan, as the comment says. Treat a column with no plan word as plan-neutral. Add tests: plan A against a "Plan B" column (refused), plan A against "Plan A" (kept), no plan against "Plan B" (refused), plan A against "Adult" (kept).
- **R85-2 (Medium, projection shown as payable)** `assemble.ts:93-97` relies only on the model's `basis` field, or on the document kind being "illustration", to mark a figure as projected. A yearly policy statement or schedule (kind `personal_proof`) often prints a projected maturity or surrender value table under a "Non-Guaranteed" or "at 4.25% p.a." heading. If the model leaves `basis` null on such a row, the figure shows as a printed amount or as a "value" the person holds. Fix: a server backstop. Mark a row as projected when its quote, section, column or the line above its row prints "non-guaranteed", "not guaranteed", "illustrat", "projected", or an assumed return rate ("at 4.25%", "investment return"). Add a test.
- **R85-3 (Medium, double paid reading with the flag on)** The flag swaps only the ingest hook (`lib/rag/ingest.ts:944`). With the flag on, ingest no longer sets `ledger_read_at`, so every new document stays "pending" for the old ledger. These callers then read it again with paid model calls and seed the old ledger:
  - the dashboard's `after()` read (`app/api/dashboard/route.ts:46-54`, on every dashboard load until read);
  - the ledger POST routes (`app/api/ledger/route.ts:104-112`);
  - chat (`lib/chat/workflow.ts:2461-2465`).
  #92's Coverage refresh also keeps running through `/api/ledger` if anything still calls it. Fix: gate those callers on `!benefitTableEnabled()` too, or mark the document ledger-read when the table read succeeds. Decide explicitly whether chat keeps using the old ledger while the flag is on.
- **R85-4 (Low)** `app/ledger/page.tsx:62-75`. With the flag off, Coverage now waits on `/api/benefit-table` first, and shows "Your coverage could not be loaded" on any non-OK answer (a 500, or a 401 after the session expires) instead of the old view. Today's view is therefore no longer exactly identical with the flag off. Consider falling back to the ledger view on a non-OK answer while the flag is off; the server could also answer `enabled:false` before the auth/DB work when the switch is unset.
- **R85-5 (Low)** `sql/benefit-table.sql:51-58` grants authenticated users INSERT/UPDATE/DELETE on all three tables. The server uses the service connection. A household member could write a reading or a model-labelled link straight from the browser. The checks re-verify quotes, so no unprinted figure would show, but SELECT-only for `authenticated` (as the comment's purpose implies) is tighter.
- **R85-6 (Low)** `assemble.ts:128-133`. A correction applies only to the first cover with that person and key. A second copy with a different printed sum (two documents) keeps its printed figure, so one person can show two bases. Apply it to every match, or show the duplicates as a conflict.
- Note for DC's spend: with the flag on, each document costs one Sonnet 5.5 reading (up to 24K output), up to 12 page re-reads, and a household-wide linking call on each upload. Usage is recorded through `recordUsage`.

Verdict: **NOT READY until R85-1 to R85-3 are fixed.** R85-1 can show another plan's figures as the person's. R85-2 is the projection backstop. R85-3 doubles paid reads with the flag on. R85-4 to R85-6 are optional.

## Round 86: PR #94 delta, head 824823f (R85 fixes)

Read-only review; no paid call.

- **R85-1 fixed.** `assemble.ts:119-141`: plan tokens are now compared whole, with "plan/option/tier/..." removed. "Plan B" is refused for a Plan A cover, a plan column is refused for a cover with no plan, and "Adult"/"Child"/"Per Visit" are neutral. A single letter, a roman numeral, a tier name or a household plan counts as a plan column.
- **R85-2 fixed.** `PROJECTION` checks the quote, benefit name, section and column for "non-guaranteed", "illustration", "projected", a rate of return, or "at N% p.a.". The check also applies when the model said "guaranteed", because only non_guaranteed and illustrated short-circuit it.
- **R85-3 fixed.** The gate sits inside `readDocumentIntoLedger`, `readPendingDocuments`, `pendingDocumentCount` and `seedLedger`. With the table live, the upload, the dashboard after(), the ledger routes, chat and #92's refresh all stop paid ledger reads and default seeding.
- **R85-4 fixed.** Any non-OK answer or fetch error shows the old view. With the flag on, that view can no longer start a paid read.
- **R85-5 fixed.** Anon and authenticated have all rights revoked and authenticated has SELECT only. The server writes through the service connection.
- **R85-6 fixed.** A confirmation or correction applies to every copy of the cover for that person.

No wrong-amount regression found. New, all Low:
- **R86-1 (Low, hides a benefit)** `samePlan` compares every remaining token, so a column carrying a currency or unit ("Plan A (S$)" becomes the tokens "a s", and "Plan A Per Visit" becomes "a per visit") is refused for a Plan A cover. The section then shows as unlinked instead of as the person's benefits. This is safe (no figure rather than a wrong one), but a printed "(S$)" heading is common. Consider dropping currency and unit tokens (s, sgd, usd, per, visit, claim, limit, day, year) before comparing.
- **R86-2 (Low, product call)** With the flag on, the old ledger is frozen: no reads and no seeding. Chat and claim paths that read `coverage_rules` see nothing for documents uploaded after the switch. Confirm that is intended before DC switches the flag on.
- **R86-3 (Low)** `benefitTableLive()` runs a `to_regclass` query on every `pendingDocumentCount`, `seedLedger` and `readDocumentIntoLedger` call. It is cheap, but it is called on every dashboard and Coverage load; it could be cached per instance once the tables exist.

Verdict: **READY.** R86-1 to R86-3 are optional, and nothing is switched on until DC sets DEARPOLICY_BENEFIT_TABLE and applies the SQL.

## R87 — PR #94 delta 824823f → 41ab81e (R86-1, R86-3, strict Correct-field amount)

**Verdict: NOT READY** (one Medium, one-line fix).

Probed locally (tsx, `columnProblem` and `parseAmount` on 41ab81e); no DB, no paid calls.

- **R87-1 (Medium, wrong amount backstop weakened)** `lib/benefit-table/assemble.ts:125-127`. `UNIT_WORDS` strips "annual", "annually", "trip", "lifetime" and "policy" from both sides of `samePlan`. These words name plan variants in travel, not units. Cover plan "Annual Gold" with a section column "Gold" (the single-trip column, a tier name, so a plan column) was refused at 824823f and is now ACCEPTED, so single-trip limits can be shown for an annual-plan holder. Same for "Plan A Annual" vs "Plan A". Fix: keep only currency tokens and words that follow "per" (or sit in brackets) in the strip list; drop annual, annually, trip, lifetime, policy. "Plan A (S$)" and "Plan A Per Visit" still match.
- R86-1 otherwise fixed: "Plan A (S$)" and "Plan A Per Year" now match "Plan A"; "Plan B" vs "Plan A" still refused.
- R86-3 fixed: `tableReady` caches a yes per `Db` in a WeakSet; `appDb` is a module constant (`lib/benefit-table/app.ts:15`), so it hits. A no is re-checked. Fine.
- Amount parsing (`lib/benefit-table/amount.ts`): correct. Refuses 0, "250k", "1.5 million", "1,0000", "$1,00", "12.345", "USD 1000". Accepts "S$ 1,000", "1,500,000.00". The preview shows the exact amount before Save, Save is disabled when invalid, and the route (`z.number().positive()`) and `setConfirmation` (`<= 0`) both refuse 0. No issues.
- R87-2 (Low, pre-existing, not from this delta): a column such as "Annual Gold" or "Single Trip Gold" is not judged a plan column (`namesPlan`, not all tier words), so it is neutral and accepted for any cover. The trip type in travel tables has no guard. Worth a follow-up, not blocking.

## R88 — PR #94 delta 41ab81e → 76cf9d2 (R87-1, R87-2)

**Verdict: NOT READY** (one Medium).

Probed `columnProblem` on 76cf9d2 locally (tsx), no DB, no paid calls.

- R87-1 fixed for unbracketed headings: "Annual Gold" vs "Gold", "Gold" vs "Annual Gold" and "Single Trip Gold" vs "Annual Gold" are all refused. "Plan A (S$)" and "Plan A Per Visit" still match "Plan A". "Plan B" vs "Plan A" is still refused.
- R87-2 fixed for unbracketed headings: a column naming a tier anywhere is now a plan column.
- **R88-1 (Medium, wrong amount)** `lib/benefit-table/assemble.ts:128`: `planTokens` drops all bracketed text, not only currency and units. So the variant or tier in brackets is lost:
  - "Gold (Annual)" is ACCEPTED for plan "Gold (Single Trip)" and for plan "Gold".
  - "Single Trip (Gold)" is ACCEPTED for plan "Platinum". The tier goes, the column becomes neutral, and Gold limits can be shown for a Platinum holder.
  - Fix: drop a bracket only when its content is currency or unit words, such as "(S$)", "(SGD)" or "(per visit)". Otherwise keep its words.
- R88-2 (Low, hiding): the tier-word test now makes ordinary headings plan columns. "Max Limit", "Max Limit (S$)" and "Core Benefits" are refused for every cover, including covers with no plan, so those sections are hidden. Consider matching "max" or "core" as a tier only when the whole heading is tier words, or when it equals a held plan.

## R89 — PR #94 delta 76cf9d2 → 8d1c7fc (one rule for plan columns)

**Verdict: READY** (no wrong-plan path found; one Low left open to track).

Probed `columnProblem` on 8d1c7fc locally (22 cases, tsx), no DB and no paid calls.

- R88-1 is fixed. "Gold (Annual)" is refused for the plans "Gold (Single Trip)" and "Gold", and "Single Trip (Gold)" is refused for "Platinum". For a cover that prints a plan, only an exact-words column passes. "Plan A (S$)", "Plan A Per Visit", "Gold (SGD)", "Gold US$", "Gold HK$" and "Gold RM" all still match.
- R88-2 is moot under the new rule. "Max Limit" is refused for a plan holder and neutral for a no-plan cover. The coordinator accepts over-refusal, and it is not widespread.
- No-plan covers: a column that is in the document's plan list or says "Plan"/"Option" is refused, and a lone column is neutral. That is fine.
- R89-1 (Low, person scope, not plan): `UNIT_TOKENS` drops adult/child and `PER` drops "per person"/"per family". So "Gold Child" and "Gold Per Family" pass for any Gold holder, and child or family limits can attach to an adult. Rows show the column label ("(Gold Child)", `components/benefit-table-coverage.tsx:130`), so the figure is labelled, not silent. Bare "Adult"/"Child" columns were already neutral before this delta. Revisit before chat reads amounts from table rows. Either keep adult/child and person/family in the heading words, or carry them as a row qualifier the chat must state.

## R90 — PR #95 at c719256 (chat amounts only from benefit-table rows, behind the switches)

**Verdict: NOT READY** (two blockers).

Probed with the PR's own chat-test fixture (tsx, model replies scripted, no DB, no network, no paid calls).

What holds:
- An amount with no row, a made-up row, or another person's row is dropped.
- The model's own amount, quote and document are ignored.
- A percentage is worked out on the row person's own base, and a corrected base becomes a fact.
- Model-typed money in prose is still stripped by verify.ts.
- With the switch off, the library, schema and flow are unchanged (`withRows` is false and `liveTable` returns null).

- **R90-1 (blocker, R89-1 qualifier lost)** `lib/benefit-table/chat.ts:72` (`said`): "For child:" and "Projected, not guaranteed:" are glued onto the model's first sentence. When that sentence states money, verify.ts drops the whole sentence and the label goes with it, but the amount stays.
  - Probe P1: row "Hospital cash (Child)" on the adult Lim, with text "Hospital cash pays S$50 a day.", shows S$50 with the text "Scheme terms prints: “Hospital cash S$50 per day”". No "child" appears anywhere.
  - Probe P2b, with two sentences, loses the label the same way.
  - The projected label is lost the same way (P3). There it survived only because the excerpt happened to print "Non-Guaranteed".
  - Fix: make the qualifier and projection their own sentence, added after the money filter or kept by it (for example "This figure is for a child only."). Alternatively, refuse the statement if the label does not survive. Add a test whose model text contains money.
- **R90-2 (blocker, wrong product or benefit label)** `chat.ts:72`: the server writes the row's figure, person and page, but the words that say what the amount is for remain the model's. Probe P4: row "Ambulance Cost" with the text "Death benefit pays this." shows "Death benefit pays this. Up to S$500". That reads as a wrong claimable amount for death. Fix: start the text with the row's own benefit and cover ("Ambulance Cost, Group Personal Accident:"), or refuse when the text names a different benefit.
- R90-3 (Medium, hiding, decide before switching on) `lib/simple-chat/hook.ts:84,88`: `rows` is `[]` (truthy) for a household whose table has no rows yet. `renderTable` then returns "" (no instructions), but `withRows` is true, so every amount is dropped with no explanation. Documents not yet read into the table lose their amounts the same way. Either fall back to today's path when there are no rows, or say plainly that amounts are not ready yet.
- R90-4 (Low) The row's unit is not carried. A per-day row shows "S$50" and relies on the model's text to say "a day" (P2). `statementFromRow` knows `f.unit`, so it could add "a day" or set `perDay`. The cash-value as-of date is also dropped. Pre-existing in verify.ts, but now cheap to fix.
- Note (by design, from R89-1): an adult holder gets child-column rows. That is acceptable only while R90-1 keeps the label.

## R91 — PR #95 delta c719256 → 3d49e09 (server-only amount labels)

**Verdict: READY** (Lows only).

Probed with the PR's chat-test fixture (scripted model replies, tsx, no DB, no network, no paid calls).

- R90-1 is fixed. The qualifier is part of the server's label ("Hospital cash (Group Scheme, Group Personal Accident), for child only: paid per day."). The model's sentence is never used, so a money sentence can no longer strip it. `keepLabelledAmounts` refuses any amount whose text is not exactly a server label.
- R90-2 is fixed. With the model text "Death benefit pays S$1,000,000." for each of Hip, Ankle, Ambulance Cost, Hospital cash and Surrender value, every card shows only the row's own benefit and cover, with the row's figure. The person is taken from the row, after the model's person must match it. Model `conditions` and `ofBill` did not attach to the card.
- R90-3 is fixed. An empty table plus a dropped amount gives the "Amounts are not shown yet" note, and any dropped or refused amount adds the left-out-amount note.
- R90-4 is fixed. Per-day, per-period, up-to, value as-of and projected are all in the label.
- Correct amounts survive: Hip S$450,000, Ankle S$2,500, Ambulance Up to S$500, Hospital cash S$50 (for child only), Surrender value S$12,400 (projected, not guaranteed). Alternatives still get the "not a total" note.
- R91-1 (Low, wording) `lib/benefit-table/chat.ts` `rowLabel`: a percentage of the sum insured reads "75% of the amount printed, worked out". The test is `/sum insured/` against `f.how`, which prints the figure, not those words. Use `row.percentOf`/`baseSource` (sum_insured vs fixed_amount) instead.
- R91-2 (Low, hiding) A plan or benefit name with a number of 100 or more ("plan Plan 300", "plan 1000") makes `statesMoney` true for the label. verify.ts then drops the label and the correct amount is refused, though it is noted as left out. Consider passing the label through verify.ts as trusted text, or quoting plan names so the money check ignores them.
- R91-3 (Low, cosmetic): the same row named twice gives two identical cards. Consider de-duplicating by row id.

## R92 — PR #95 delta 3d49e09 → 233669e (full-width digit shield, percentOf wording, one card per row)

**Verdict: NOT READY** (one High, which already existed but is now load-bearing, and one Medium introduced by this delta).

Probed with the chat-test fixture (scripted model replies, tsx, no DB, no network, no paid calls).

- R91-1 is fixed: a sum-insured row now reads "75% of the sum insured, worked out" (`percentOf`).
- R91-3 is fixed: a row named twice is given once.
- The unshield step itself is narrow. Only a statement whose text exactly equals a server label gets its digits back, so the model cannot borrow it.
- **R92-1 (High; already in `lib/simple-chat/verify.ts` `statesMoney`, not introduced here)**: full-width digits are not read as money. `statesMoney("Death pays S$１,０００,０００.")` returns false.
  - End to end, a model reply with bottom line "Your death cover pays S$１,０００,０００.", next step "Claim S$１,０００,０００ now." and fact text "Death cover pays S$１,０００,０００." reaches the household unchanged.
  - This is a hole in "the model's sentences carry no money". It also affects the live simple chat with the table switched off.
  - The shield in this delta works only because this hole exists. Fixing `statesMoney` (NFKC-normalise before reading, and the same in `moneyFiguresIn`) would bring R91-2 back.
  - Fix both together: normalise in verify.ts, and exempt a server label from the money check by identity (an allow-set of exact label texts passed to `verifyAnswer`), not by changing its digits.
- **R92-2 (Medium, introduced)** `lib/benefit-table/chat.ts` `shield`: the shield also hides money inside a row's own names, which come from the document reading. A row whose benefit reads "Accidental Death S$1,000,000" shows "Accidental Death S$1,000,000 (Group Scheme, Group Personal Accident): up to this limit." next to "Up to S$500".
  - Before this delta the money check dropped that label and refused the amount.
  - Fix: before building the label, refuse (or strip money from) a benefit, cover or product name that states money. Allow only plan names, which may be bare numbers.

## R93 — PR #95 delta 233669e → f63cd60 (NFKC money checks, server labels exempt by identity)

**Verdict: READY.**

Probed with the chat-test fixture (tsx, no DB, no network, no paid calls). benefit-table chat-test passed 28/28 and benefit-table test passed 38/38 locally. I could not run simple:offline-test here, because the scratch deps lack @anthropic-ai/sdk, so that rests on the Test engineer's run.

- R92-1 fixed. In the bottom line "Your death cover pays S$１,０００,０００.", the next step "Claim S$１,０００,０００ now." and fact text with the same figure, the money is now caught. The bottom line falls back, the next step is dropped, and the fact shows only its quoted words. `figuresIn`/`moneyFiguresIn` NFKC-normalise, and callers find `raw` by content rather than offset, so the shared change does not shift positions.
- R92-2 fixed. A row whose benefit reads "Accidental Death S$1,000,000" or "Death S$１,０００,０００" is dropped ("name states money") and noted as left out.
- R91-2 still fixed. "plan Plan 300" survives through the exact `serverWords` allow-set.
- Exemption is by identity only. A statement keeps unfiltered words only when its text exactly equals a server label, and labels can no longer carry money (names pre-checked; a plan may be a bare number only). So a model sentence that copies a label gains nothing.
- Correct amounts still survive: Hip S$450,000 (now worded "75% of the sum insured"), Ankle S$2,500, Ambulance Up to S$500, Hospital cash S$50 (for child only), and Surrender value S$12,400 (projected, not guaranteed). In each case the model's own text carried full-width money.
- No open findings on #95.

## R94 — PR #96 at b4ed730 (row names with policy numbers; `nameStatesMoney`)

**Verdict: NOT READY** (one Medium; small fix).

Probed `nameStatesMoney` on 23 names (tsx, no DB, no paid calls).

- The fix works for its own case. "GROUP POLICY NO. G007500", "POLICY NO.3037850" and "Plan 300" now pass.
- Real money is still caught when it has a currency sign, thousands commas, a size word, or a dollar/SGD/USD word. Caught: "S$1,000,000", "Death 1,000,000", "1.5 million", "RM500", "HK$ 800", "Fracture 5k", "SGD 500", "500 dollars", "€500" and "£500".
- **R94-1 (Medium, money in a label)** `lib/benefit-table/chat.ts` `nameStatesMoney`: a bare amount with money context gets through. These all PASS as names:
  - "Accidental Death 1000000"
  - "Death benefit of 600000"
  - "Hospital cash 200 per day"
  - "Hospital cash 200/day"
  - "Benefit up to 5000"
  - "Room & Board 300"
  - "Death 1 000 000"

  Once a row is labelled, its name skips the money filter (serverWords), so for example "Hospital cash 200 per day (…): paid per day." could show beside a different figure (another plan's S$300). Fix ideas, keeping policy and plan numbers allowed:
  - In benefit, cover and product names (not plan), count as money any number of 2 or more digits followed by "per"/"/" plus a period word (day, visit, year, …), or preceded by "up to", "limit", "max(imum)" or "of".
  - Also count as money any standalone number of 4 or more digits (including "1 000 000") that is not glued to letters, not after "No."/"number"/"#", and not a year 19xx/20xx.
  - Add those 7 names as test cases.
- Low: "₹ 500" is not read as money (₹ is missing from the currency symbols). This is outside the SGD/USD/MYR/HKD scope, so it is a note only.
- app-run `--table` is a script, not on the app path; reviewed for scope only.

## R95 — PR #96 at 99b7a5c (capped percentages; stricter money-in-names rule)

**Verdict: NOT READY** (two blockers, both in `lib/benefit-table/check.ts` `rowAndContinuation`).

Probed `checkReading` and `nameStatesMoney` (tsx, no DB, no paid calls).

- R94-1 is fixed. All seven names are now refused ("Accidental Death 1000000", "Death benefit of 600000", "Hospital cash 200 per day", "Hospital cash 200/day", "Benefit up to 5000", "Room & Board 300", "Death 1 000 000"). Identifiers still pass: "G007500", "POLICY NO.3037850", "Plan 300", "Ward Class B1", "Covid-19 Benefit", "24-hour Assistance", "Group Term Life 2026", "Clause 12.1 Death". A plan of "1000 per year" is refused.
- "whichever is greater" correctly yields no amount (N8). Readings are re-checked from raw on load (`service.ts:55`), so old readings also get `capUnread`.
- **R95-1 (blocker, an uncapped figure still shows)** `check.ts` `rowAndContinuation`:
  - `source.excerpt` is whitespace-normalised ("Hip 75% of Sum Insured"), but the page prints a tab ("Hip\t75% of Sum Insured"). So `pageText.indexOf(excerpt)` and `indexOf(last)` both miss, and only the excerpt is returned; the continuation line is never read.
  - N5: page "Hip\t75% of Sum Insured\nor up to S$50,000, whichever is lesser", with no cap read, gives `capUnread=false`. The table works out 75% of the sum insured uncapped (S$450,000 on S$600,000) when the row pays at most S$50,000.
  - N4: the same row with the cap read correctly is refused ("not printed in the row") and shows no amount, so the feature's own example fails.
  - Fix: anchor on the located quote's page offset (the `Found` from `locateQuote`), not on `indexOf` of the normalised excerpt.
- **R95-2 (blocker, a cap from a neighbouring row)**:
  - N1: page "Hip 75%\nWrist 20% up to S$5,000\nAnkle 10%" (rows separated by spaces, no tabs). The Hip claim `cap 5000, capQuote "up to S$5,000"` is ACCEPTED. `rowWithContinuation` treats the next table row as a continuation, so Hip shows S$5,000 (Wrist's limit).
  - N3: a row quote that spans two rows ("Hip 75% Wrist 20% up to S$5,000") is also accepted.
  - Fix: a continuation line must not start a new row (a label followed by its own %/figure). The cap words must sit on the row's own line, or on a continuation that begins with or/and/up to/subject/whichever (lower-case or a connective). Refuse a row quote that holds two percentages or two row labels.
  - Add N1, N3, N4 and N5 as tests (tab and space layouts).
- Low (not new): a cap printed once for a section ("All benefits subject to a maximum of S$100,000 per policy year") is not read, so rows under it are worked out uncapped (N7). Worth a follow-up.
- Low: `nameStatesMoney` now refuses "Benefit 365 days" and "ICU 500". That hides amounts but is safe.

## R96 — PR #96 delta 99b7a5c → 2eeccc5 (row anchored on quote offset; continuation rule; names by role)

**Verdict: NOT READY** (one blocker left in the continuation rule).

Probed `checkReading` on 11 page layouts and `nameStatesMoney` on 11 names (tsx, no DB, no paid calls).

- R95-1 is fixed. With a tab row, N4 (cap read) gives cap 50,000. N5 (cap not read) gives `capUnread=true`, so no uncapped amount.
- R95-2 is fixed for capitalised rows: N1 (space layout), N2 (tabs) and B5 (two rows on one line) refuse the neighbour's cap. N3 (a two-row quote) is dropped.
- **R96-1 (blocker, a cap from a neighbouring row)** `lib/benefit-table/check.ts` `continues`: a line that starts lower-case or with "(" counts as a continuation. So the next row is read as part of this one when items are lettered or numbered, which is common in policy wordings. Hip takes Wrist's S$5,000 cap in all of these:
  - B1 "(a) Hip 75%\n(b) Wrist 20% up to S$5,000" gives cap 5000.
  - B2 "a) Hip 75%\nb) Wrist 20% up to S$5,000" gives cap 5000.
  - B3 "(i) Hip 75%\n(ii) Wrist 20% up to S$5,000" gives cap 5000.
  - B4 lower-case rows "hip fracture 75%\nwrist fracture 20% up to S$5,000" gives cap 5000.

  Fix: a line is never a continuation when it starts with an item marker (`^\s*\(?([a-z]{1,3}|[ivx]{1,5}|\d{1,3})[.)]\s`) or holds its own percentage, figure-with-label or tab-separated cells. Add B1 to B4 as tests. With the cap left unread (B6), `capUnread` is already true, so only the claimed-cap path is open.
- Names by role are fine for the R94-1 shapes. "Death 1000000", "Accident 50000" and "Accidental Death 200000" in product or cover names are refused. "Shield 360", "MER 1500" and "Smart Life 100" pass. Benefit names keep the strict rule ("Room & Board 300" is refused) and allow counts ("Benefit 365 days").
- Low: a 4-digit amount in a product or cover name passes ("Accidental Death 5000"). This is accepted as the cost of product numbers.

## R97 — PR #96 delta 2eeccc5 → db6b313 (`startsRow`)

**Verdict: NOT READY** (the new rule now drops a row's own cap line in two shapes, and the uncapped figure shows).

Probed `checkReading` on 17 layouts (tsx, no DB, no paid calls).

- R96-1 is fixed. B1 "(a)/(b)", B2 "a)/b)", B3 "(i)/(ii)", B5 "1./2." and B4 (lower-case rows) all refuse the neighbour's cap.
- Still right: N4, N5, C4 ("subject to a maximum of"), C5/C6 ("(up to S$50,000)"), C7 ("up to … per accident") and C9 ("max S$50,000").
- **R97-1 (blocker, uncapped figure)** `check.ts` `ITEM_MARKER`: `\(?[a-z]{1,3}[.)]\s` matches "max. " and "Max. ", so a cap line written "max. S$50,000" is treated as a new row.
  - C1: "Hip\t75% of Sum Insured\nmax. S$50,000" with the cap not read gives `capUnread=false`, so 75% of the sum insured is shown uncapped.
  - C8 does the same with "Max. S$50,000".
  - C2: with the cap read, it is refused (not in the row), so no amount; that case is safe.
- **R97-2 (blocker, uncapped figure)** `startsRow`'s own-percentage test runs before the connective check.
  - C3b: "Death\t100% of Sum Insured\nor 200% of premiums paid, whichever is lower" ends the row at line 1, `capUnread=false`, and 100% of the sum insured is shown although the row pays the lower of the two.
- Fix for both: when a line starts with a connective or cap word (add `max\.?`, `min\.?`, `maximum`, `limit` to `CONNECTIVE`), it always continues the row and `startsRow` is not consulted. Belt and braces: compute `capUnread` also from the next line when it starts with a connective or cap word, even if it was not joined. Add C1, C3b and C8 as tests.

## R98 — PR #96 delta db6b313 → fa2044f (connective lines always continue; capUnread backstop)

**Verdict: NOT READY, with a one-line fix.** Every other probed path fails safe.

I re-ran all 19 earlier layouts plus 2 new ones (tsx, no DB, no paid calls).

- R97-1 and R97-2 are fixed. "max. S$50,000" and "Max. S$50,000" (C1, C8) and "or 200% … whichever is lower" (C3b) now give `capUnread=true`, so no amount is shown.
- All earlier cases still hold: the neighbour cap is refused in N1, N2, N3, B1 to B5 and D2. The row's own cap is read in N4, C2 and C6. The rest (N5, C4, C5, C7, C9) withhold an amount.
- **R98-1 (wrong amount, narrow)** `check.ts` `startsRow`: `!CONNECTIVE.test(text)` now overrides every new-row signal, tab cells included. A next row whose label starts with a cap word joins this one.
  - D1: "Hip\t75%\nMaximum Disablement\t20% up to S$5,000" takes cap 5000, so Hip shows S$5,000 (the neighbour's limit).
  - One-line fix: keep the tab-cells test outside the connective override, i.e. `(!sameLine && /\S\t+\S/.test(text)) || (!CONNECTIVE.test(text) && (…rest…))`. C3b has no tab cells, so it still continues.
  - Add D1 as a test.
- Judged against the coordinator's fail-safe bar: with R98-1 fixed, every open path I found either reads the row's own cap or withholds the amount (`capUnread`). Neighbour rows that are lettered, numbered, lower-case, tabbed or on the same line are refused, and a quote spanning two rows is dropped.

## R99 — PR #96 delta fa2044f → 72fa2c5 (strict join rule plus nearby-cap backstop)

**Verdict: NOT READY.** Two paths still show a wrong amount; both fixes are small.

Re-ran all 21 earlier layouts plus 8 new ones (tsx, no DB, no paid calls). The 21 earlier ones all pass, including D1 (tabbed "Maximum …" neighbour) and D2. New ones that pass: E3 (cap three lines down, withheld), E4, E5 ("(or up to … whichever is lesser)" read), E6 and E7.

- **R99-1 (uncapped figure)** E1: page "Hip\t75% of Sum Insured\nwhich is payable up to S$50,000", cap not read.
  - The lower-case line no longer joins, and the backstop skips it as "its own label plus a figure" (`which is payable up to S$50,000` matches the label+figure test). The result is `capUnread=false`, so 75% of the sum insured is shown uncapped.
  - E2 (the same row with the cap read) is withheld, which is safe.
  - Fix: in the backstop, skip a line as its own row only when it starts upper-case (or has an item marker, its own %, or tab cells). A lower-case line is never a new row's label.
- **R99-2 (neighbour cap)** E8: page "Hip 75%\nMaximum Disablement 20% up to S$5,000" (no tabs).
  - "Maximum" is a connective, so the next row joins and Hip takes cap 5000. D1 is safe only because it has tabs.
  - Fix: never accept a cap from a joined line that has its own percentage. Still mark `capUnread` for such a row, so C3b ("or 200% … whichever is lower") keeps withholding.
- Add E1 and E8 as tests. With both fixed, every path I have found either reads the row's own cap or withholds the amount.

## R100 — PR #96 delta 72fa2c5 → 1eaa9f8 (no join for lines with their own %, stricter backstop)

**Verdict: NOT READY.** One path still shows an uncapped amount. The fix is one condition.

Re-ran all 29 earlier layouts plus 8 new ones (tsx, no DB, no paid calls).
- All 29 earlier layouts are safe. E1 and E8 are now withheld.
- E2 (lower-case continuation with the cap read) is also withheld now. That is safe over-refusal.
- New layouts that pass:
  - F4: a same-line two-column neighbour "Hip 75% of Sum Insured   Wrist 20% up to S$5,000" is withheld.
  - F5: a same-line own cap "… up to S$50,000" is read as 50,000.
  - F6: a same-line lower-case ", payable up to S$50,000" is withheld.
  - F8: a joined line with its own % is withheld.
  - F7: the next row "Ambulance Cost S$500" (no cap words) is treated as another row, so Hip shows its amount. That is correct.

- **R100-1 (uncapped figure)**: an upper-case continuation of the row's own cap still counts as "another row".
  - Pages with the cap not read:
    - F1: "Hip\t75% of Sum Insured\nPayable up to S$50,000 per accident"
    - F2: "…\nWhich is payable up to S$50,000"
    - F3: "…\nPer accident limit S$50,000"
  - In all three the line passes the upper-case label+figure test, so the backstop drops it and the result is `capUnread=false`. 75% of the sum insured shows uncapped.
  - My R99-1 suggestion ("only when it starts upper-case") was not enough on its own. Capitalisation doesn't tell a cap continuation from a new row.
  - Fix (`check.ts` `otherRow`): the upper-case label+figure case counts as another row only when the line has no cap words (`CAP_WORDS`, plus a bare `\blimit\b` for F3).
    - A neighbour row that has cap words and no % or marker ("Ambulance Cost up to S$500") then withholds Hip. That is safe over-refusal.
    - Tab-cell and item-marker rows are unchanged.
  - Add F1 to F3 as tests.

With this fixed, every path I have found either reads the row's own cap or withholds the amount.

## R101 — PR #96 delta 1eaa9f8 → d3883e2 (fail-safe "cap word near the row" rule)

**Verdict: NOT READY.** Two regressions show a wrong amount, and both are small fixes.

I re-ran all 37 earlier layouts plus 7 new ones (tsx, no DB, no paid calls).
- F1 to F3 (R100) are fixed.
- All the neighbour-cap layouts still withhold the amount: N1, B1 to B5, D1, D2, E4, E6 to E8, F4, G3 and G5.

- **R101-1 (uncapped figure, regression)** E3: the page reads "Hip\t75% of Sum Insured\nfor each fracture\nas certified by a doctor\nup to S$50,000", and the cap is not read.
  - At 1eaa9f8 this was withheld. Now it gives `capUnread=false`, so 75% of the sum insured shows with no cap.
  - Cause: the loop now stops after `below < LINES_BELOW` (2 lines). Before, the stop was `unjoined.length < LINES_BELOW + 1` (3 lines). The "up to" line is the third non-joined line, so nobody looks at it.
  - Fix: restore the 3-line window.
- **R101-2 (cap read while an alternative limit is printed, regression)** G1: the page reads "Hip 75% of Sum Insured up to S$50,000 or 10% of annual salary, whichever is lower", and the cap 50,000 is claimed.
  - The new "next label with a %" split cuts the tail at " or 10% …". So "up to S$50,000" joins the row, the cap is accepted, and Hip shows min(75% SI, S$50,000). The lower "10% of annual salary" limit is ignored.
  - At 1eaa9f8 the tail had its own %, so it was not joined and the row withheld.
  - G2 is the same text on the next line ("…up to S$50,000\nor 10% of annual salary, whichever is lower"). It also accepts the cap. That was already the case at 1eaa9f8, so it is not a regression.
  - Fix: when a claimed cap is accepted, still withhold if the rest of the row's line, or a connective line below, has a percentage of its own. That is a second limit the table can't work out. Then the split only needs to keep the neighbour's cap out of the row.
- Add E3, G1 and G2 as tests.

**Non-blocking (over-refusal):**
- G4: in "Hip\t75% of Sum Insured\tup to S$50,000", the row withholds even with the cap read. `tail.split("\t")[0]` is empty when the tail starts with a tab, so the row's own cap cell is never joined.
  - This will hit every tab table with a cap column. It is safe but likely common.
  - Suggested fix: take the first non-empty cell.
- G6: a lower neighbour "Transport up to S$300" within two lines withholds the amount. This is the accepted cost of the rule.

**Fixture edit ("Ambulance Cost up to $500 per incident" changed to tab cells): fair.**
- The real certificate's extracted quote in run-02 is "Ambulance Cost*\tUp to S$500 per incident", with tab cells.
- So the edit makes the fixture match the real layout. It does not hide a real loss.
- The cost (an untabbed neighbour with a cap withholds the row above it) is safe and logged in COVERAGE-PLAN line 79. I accept it.

## R102 — PR #96 delta d3883e2 → dc62892 (R101 fixes)

**Verdict: NOT READY.** Two narrow "whichever is lower" paths still accept a cap while a second limit is printed. Both fixes are one condition each.

I re-ran all 44 earlier layouts plus 8 new ones (tsx, no DB, no paid calls).
- Fixed: E3, G1 and G2 now withhold. G4 (a tab cap column) now reads cap 50,000, so the over-refusal is gone.
- G6 and H4 now stop at the next row: "Knee\t10%\nup to S$50,000" belongs to Knee. That is correct.
- H1 ("\nOr 10% of annual salary, whichever is lower" on the next line) withholds.
- Also withheld: H5 (a blank line, then the cap), H6 (cap column with the cap unread) and H7 (a tab neighbour's cap).
- H8 (cap on the 4th plain line) is outside the 3-line window. That is the same bound I accepted at R99.

- **R102-1 (second limit printed as a figure)** H3: the line is "Hip 75% of Sum Insured up to S$50,000 or S$500 per day, whichever is lower", and cap 50,000 is claimed.
  - The cap is accepted, so Hip shows min(75% SI, S$50,000). The lower S$500-per-day limit is ignored.
  - This was already the case at 1eaa9f8; it is not new. But it is a realistic layout and it shows a wrong, too-high amount.
  - Fix: a tied cap is accepted only when the row's joined text prints no money figure other than the claimed cap. `otherPercent` already does this for percentages; treat a second figure the same way. E5 ("(or up to S$50,000, whichever is lesser)") still reads, because it has only one figure.
- **R102-2 (upper-case "Or")** H2: the line is "Hip 75% of Sum Insured up to S$50,000 Or 10% of annual salary, whichever is lower".
  - The new next-row cut `/\s+[A-Z][^%\d]*\d+…%/` treats "Or 10%" as the next row's label. So `otherPercent` stays false and the cap is accepted.
  - Fix: the next-row label must not start with a connective word (`CONNECTIVE` minus its leading-punctuation part). H1, the same text on the next line, already withholds because `CONNECTIVE` is case-insensitive.
- Add H2 and H3 as tests.

With these two fixed, every path I have found either reads the row's own cap or withholds the amount.

## R103 — PR #96 delta dc62892 → ee7d121 (otherMoney, connective-label skip)

**Verdict: NOT READY. One condition is left, in the same "whichever is lower" class.**

I re-ran all 52 earlier layouts plus 7 new ones (tsx, no DB, no paid calls).
- H2 and H3 now withhold, and so do I1 (the second figure on a joined next line) and I3 (SGD).
- I6 (the cap repeated at the same value) still reads 50,000.
- I7 ("Orthopaedic 20% …" after Hip's cap on the same line) is cut correctly and reads Hip's own 50,000.
- G7 ("subject to a maximum of S$100,000 per family" under the cap) and I5 (a base figure in the quote) now withhold. That is safe over-refusal.

- **R103-1 (second limit missed outside the joined text)**: a tied cap is accepted while a "whichever is lower" second limit is printed where `otherMoney` doesn't look.
  - I2: "Hip\t75% of Sum Insured up to S$50,000\nper accident, or S$500 per day, whichever is lower".
    - The next line starts with "per", so it is not joined. It is in `near`, but `near` is only read when no cap is tied.
    - The result is cap 50,000 accepted.
  - I4: "… up to S$50,000 or 500 per day, whichever is lower". The second figure has no currency sign, so `otherMoney` misses it.
  - Fix (one condition): when a cap is tied, withhold the amount if row + near contains "whichever" and any number other than the claimed cap and the row's own percentage(s).
    - E5 ("(or up to S$50,000, whichever is lesser)") still reads.
    - This also covers H3 regardless of the currency sign.
  - Add I2 and I4 as tests.

I found nothing else. If the next delta only adds this condition and its tests, I will mark it READY on that delta.

## R104 — PR #96 delta ee7d121 → 7326b4f (R103-1 "whichever" condition)

**Verdict: READY.** Every path I have found reads the row's own cap or withholds the amount.

- The delta only adds `otherWhichever`. Like `otherPercent` and `otherMoney`, it can only withhold an amount, never show one. The exemption for a leading item marker only removes "1." from the numbers counted.
- I re-ran all 59 layouts plus J1 ("1. Hip 75% … or up to S$50,000, whichever is lesser"), with tsx, no DB and no paid calls.
  - I2 and I4 now withhold.
  - The rows that still show an amount are the correct own-cap reads: N4, C2, C6, E5, F5, G4, I6, I7 and J1 (each 50,000). The others are the deliberate bounds already accepted:
    - F7 and G6: the next row is "Ambulance Cost S$500".
    - H4: the cap belongs to Knee.
    - H8: the cap is on the 4th plain line, outside the 3-line window.
- Known, accepted over-refusal (safe):
  - an untabbed neighbour with cap words withholds the row above it (COVERAGE-PLAN line 79);
  - a base figure in the quote with a tied cap (I5) withholds;
  - a per-family maximum under the cap (G7) withholds.
- Residual limits, not blockers:
  - The 3-line window (H8).
  - The detection is wording-based, so a cap phrase with no cap word at all would not be caught.

## R105 — PR #96 delta 7326b4f → cce0e43 (tab next-row cells left out of `near`)

**Verdict: READY with a one-token change: in the new condition, use `NEAR_CAP.test(label)` instead of `CONNECTIVE.test(label)`.** The swap only withholds more, so it doesn't need another review.

- I re-ran all 60 earlier layouts, and none changed. G3 (a tab neighbour "Wrist\t20% up to S$5,000" with Wrist's cap claimed) still withholds, because the claimed cap isn't in Hip's row. With nothing claimed, Hip now correctly shows uncapped.
- New layouts:
  - K1: the Hip line is followed by its own "up to S$50,000" on the next line. It still withholds.
  - K2: a "Maximum" label cell stays in `near`, so the row withholds.
  - K3: a lower-case label never matches, so the row withholds.
  - K4: a label cell followed by a cap cell with no % withholds.
- **R105-1 (narrow)** K5: "Hip\t75% of Sum Insured\tPayable up to\t50% of S$100,000" shows Hip uncapped.
  - The label cell has cap words, but it doesn't *start* with one, so `CONNECTIVE` misses it.
  - Test the label with `NEAR_CAP` (cap words anywhere, including "limit"). A real next-row label rarely contains cap words, so this costs almost nothing.

## R106 — PR #96 at c07aa11: READY holds

- `CONNECTIVE || NEAR_CAP` is right. My R105 "swap" would have dropped the "Or\t10% …" case (TE layout 32), so keeping both was correct.
- I re-ran all 65 layouts. Only K5 changed, and it now withholds. Everything else is identical.

## R107 — PR #96 delta c07aa11 → 1f99963 (reading schema within the 16-union limit)

**Verdict: READY.**

- **Missing vs null is the same everywhere downstream.**
  - Every stored reading (the whole document and its page re-reads) goes through `checkReading` (`service.ts:55-56`). That function reads each of the 11 fields through `str`, `num`, `int` or `day`, and all of these return null for `undefined` (`check.ts:141-143, 183-190, 258-262`).
  - After that point the types are `T | null`. `assemble.ts`, `chat.ts`, `components/benefit-table-coverage.tsx` and `app/api/benefit-table` only see null.
  - Document `insurer`, `periodFrom` and `periodTo` are not read by `checkReading` at all.
  - `coverKeyOf` already guards `riderOf` with `?? null` / truthiness.
- **No amount field lost its guarantee.**
  - `value`, `percentOf`, `baseAmount`, `baseQuote`, `cap`, `capQuote`, `quote` and `page` stay required. So do cover `sumInsured` and `policyNumber`, and benefit `section`, `column`, `period` and `basis`. The new test pins the benefit set.
  - `premium` is optional, but it is a cover attribute, never a claimable amount, and `check.ts:184` still drops one that is not printed.
- **Qualifier check, the one field class that matters: `fromDay`/`maxDays`.** These are now optional, so a model could leave out "up to N days" on a per-day row.
  - Before this change the field could already come back null, so the guarantee was always weak; the amount itself is unaffected.
  - In run-03b, the one per-day row that was re-read under the new schema kept its `maxDays`.
  - Not a blocker. Watch per-day rows in the next gold check.
- The `object()` helper strips the `optional` marker from the emitted schema, and the test asserts that none remains.

## R108 — draft PR #97 at fa89d96 (stay totals, cover rows, wrapped labels, schedule currency, premiumQuote)

**Verdict: NOT READY.** One path can show a stay total that is too high. One path drops a premium's qualifier.

- **R108-1 (overstated stay total, blocker)** `chat.ts` `keepLabelledAmounts` → `stayOf`.
  - The stay figure comes from `verify.ts` `stayPays`. Before this PR the table path always refused it. Now it is kept whenever the table rows agree on max-days and first day.
  - `stayPays` rejects other *day* rules (`OTHER_DAY_RULE`), but nothing rejects a *money* limit on the same row. `dailies` counts only figures followed by "per day", and every other figure is ignored.
  - Example: "S$100 per day from the 1st day, up to a maximum of 30 days, subject to an overall limit of S$2,000". For a 25-day stay this gives S$2,500, above the S$2,000 limit.
  - The real B3/H4 row (S$30 a day after the 10th day, max 30 days) has no such limit, so the replay is correct. But the guard is missing.
  - Fix in `chat.ts` (verify.ts stays frozen): keep the stay only when the row as printed, with its continuation lines, prints no money figure other than the daily and no cap word (`NEAR_CAP`) other than the max-days phrase. Carry that as a flag in `report.days`. Add the example above as a test.
- **R108-2 (premium qualifier stripped)** `check.ts` premiumQuote + `chat.ts` `coverRows`.
  - D8 page 3 prints both "Instalment Premium : 470.85" and "First Year Instalment Premium * : 376.68". Both lines say "premium" and print a figure, so either one passes.
  - Whichever one the model picks, the row is labelled "Premium, monthly". So S$376.68 would show with no "first year" qualifier.
  - Also, nothing stops the same policy premium being attached to several cover lines (the basic plan and each rider), which double-counts it if the chat adds up premiums.
  - Fix: when the premium comes from premiumQuote, take the label from that line's own words before the figure ("First Year Instalment Premium"), or refuse a line with a qualifier (first year, discount, health extra, basic, rider). Keep one premium source line per policy, not per cover.
- **(3) Wrapped label: sound.**
  - The quote minus one text-only cell must sit on a single line. The very next line must be exactly that cell with no figure, and only one cell can qualify.
  - The figures checked (`printsNumber` on `source.excerpt`) are on the matched line. So the binding is to that line, and a mismatch only refuses.
- **(4) Schedule currency: sound.**
  - The fallback runs only when `DECLARED` finds nothing. `pageCurrency` returns null when the page names or prints any other currency, says "unless stated", or lists currency options.
  - A sign printed in the excerpt still wins, and the chat path already uses `pageCurrency` on the same pages.
- **(2) Cover rows: sound.**
  - The sum insured comes from the person's own cover line, and a corrected sum insured shows no amount.
  - The premium path is covered by R108-2.

## R109 — PR #97 delta fa89d96 → a58235f (R108 fixes)

**Verdict: READY.**

- **R108-1 is fixed.** `dailyRateAlone` reads the row's line, its continuation lines and its quote. Any money figure other than the daily rate refuses the stay. So does any cap or limit word left once "max N days" is removed.
  - I probed it with tsx:
    - The real B3 line ("S$30 per day after the 10th day, up to a maximum of thirty (30) days") is still kept.
    - "overall limit of S$2,000", "capped at 2,000", "payable up to 2,000" and "not exceeding twenty times the daily amount" are all refused.
    - "per policy year" passes this check, but `verify.ts` `OTHER_DAY_RULE` already rejects it before a stay is worked out.
  - Residual: a limit printed outside the row and its continuation lines (a footnote elsewhere on the page) cannot be seen. I accept this.
- **R108-2 is fixed.** A premiumQuote is used only when the page has exactly one plain premium line, and that line is the premiumQuote's line.
  - D8: "First Year Instalment Premium *" is not plain, so only "Instalment Premium : 470.85" can be used.
  - The label is the line's own words. The frequency is kept only when it is printed on the page.
  - The premium is de-duplicated per person, policy and source line.
- `declaredCurrency` now defers "unless stated otherwise" to `pageCurrency`, which returns null for it.
- `chat-test.ts` passes 41/41 locally with tsx.

## R110 — PR #97 delta a58235f → 924c5a2 (premium refused when the page names another life)

**Verdict: READY.**

- `otherLife` is a new condition, and it can only refuse a premium. It cannot show a figure or change one.
- Worst case, a page whose "Policy Owner" differs from the life assured drops a premium that was correct. That is safe over-refusal of a non-claimable figure.
- `chat-test.ts` passes 42/42 locally.

## R111 — PR #97 delta 924c5a2 → 70a5204 (premium rule uses household names)

**Verdict: READY.**

- **Household isolation.** `service.ts` `documents()` fills `people` from `family()`, which queries `family_members WHERE account_id=$1 AND lifecycle_state='active'`, with the same `accountId` as the documents.
  - The names are only used in memory, in `otherLife`.
  - They are not stored: the stored reading is the model's JSON.
  - They are not sent to the model: `renderDocument` uses only `name` and `pages`.
  - `app-run` takes them from the same snapshot household.
- **Can only refuse.** `doc.people` is read in one place (`check.ts:241`), as a further `!otherLife(...)` condition before a premiumQuote is accepted. It can only make that condition false, which drops the premium.
  - It never adds, changes or moves an amount.
  - Benefit rows and sums insured are unaffected.
- `chat-test.ts` passes locally.

## Round 112: PR #98 at 8853ef4 (reading CLI passes household names)

**Verdict: READY.** No findings.

- `scripts/benefit-table/read.ts:35` `sourcesOf` now sets `people` from `familyOf(s)`, with the same "(self)"-style suffix stripping the table uses, which matches the app path (`lib/benefit-table/service.ts:45-50`). The CLI's premium check now agrees with production.
- `people` is read only by `otherLife` (`lib/benefit-table/check.ts:34,241`), which can only refuse a premium. `renderDocument` does not include it, so the names are never sent to the model, and nothing is written to the database.
- Replays of earlier runs can only lose a premium that the page ties to another member. They can never gain an amount.
- `test.ts` importing `./read` is safe: `main()` runs only when `argv[1]` ends with `read.ts`.
- Local results: `scripts/benefit-table/test.ts` 104/104, `chat-test.ts` 42/42.

## Round 113: PR #98 at 4f604d4 (alpha switch-on)

**Verdict: NOT READY.** One high finding, about the narrower page set. The allowlist and the backfill SQL are sound.

### R113-1 (high): the narrower page set hides waiting periods and exclusions from the chat
`lib/simple-chat/library.ts:110-113` and `lib/simple-chat/hook.ts:89`. With the table on, the model now sees only the pages its rows cite, which is 30 of the 229 pages in the snapshot library. I reproduced that 30/229 figure from run-03b `table.json` plus the snapshot.

**What gets dropped.** Of the 199 pages not sent, 59 print "waiting period", "exclusions", "pre-existing", "will not pay", "does not cover" or "not covered". That is about 156k characters. Breakdown:

| Document | Pages dropped |
|---|---|
| Benefit Summary | 6 |
| Product Summary | 8 |
| CI II wording | 5 |
| Life wording | 5 |
| Travel wording | 30 |

**Concrete case.** Benefit Summary p11 states a 90-day waiting period for Living Care: no Living Care benefit is paid for a heart attack, major cancer and similar conditions diagnosed within 90 days of cover starting. The Living Care rows show "up to S$350,000" with no conditions, and they cite Product Summary p17 and p22, so p11 is not sent.

Ask "I had a heart attack a month after joining, what can I claim?" The model now sees the S$350,000 row and nothing about the waiting period. Before this change, the whole library was sent and the model could raise it. The CI II rows say "The waiting period in Section 3.2", but the page that holds Section 3.2 isn't cited either.

**Why the safeguards don't catch it.** `verifyAnswer` still checks quotes against every stored page, but it does not add waiting periods or exclusions. `PAGES_NOTE` only helps when the model thinks to look for an exclusion it cannot see. So a claimable amount can be shown without the rule that makes it unpayable. That breaks the "never strip a qualifier" rule.

**Fix options, cheapest first:**
- **(a) Free.** When `pagesSent` narrows the library, every amount statement carries a fixed server-side note: waiting periods and exclusions may be on pages not shown here, so check the full document before claiming.
- **(b) Recommended.** Also send, for each document that has a cited page, its pages matching a waiting-period / exclusion / pre-existing / "will not pay" / "does not cover" pattern. On this library that adds 59 pages, roughly 62k tokens, taking the prefix from about 85k to about 150k tokens. That is still about half the full library.

Either way, add a chat-test case: a Living Care row with an uncited waiting-period page must not produce a bare S$350,000.

### Allowlist: sound
- Every caller now passes an account. I checked by grepping all of them: the 3 API routes, `workflow.ts:308`, ledger extract and seed, ingest, and the hook's `liveTable`.
- The account always comes from the server: `requireHouseholdContext().householdId`, or `request.accountId`. `jobs.ts:40` replays the stored request.
- An unset or empty list, or a call that names no account, is off in any production build. That includes previews, because `VERCEL` is set there.
- Comparison is exact after trimming and lower-casing, so neither a substring nor a wildcard matches.
- No path turns the feature on for an unlisted account.

### Backfill SQL: sound
- **Readings.** Each reading insert has `WHERE EXISTS` on the policy, with the same `account_id`, active and not superseded, plus `ON CONFLICT (policy_id) DO NOTHING`. A wrong account or policy inserts nothing, and stored readings are never overwritten.
- **Links.** Link inserts are scoped by `account_id` and use `DO NOTHING`, so the household's own links are kept.
- **Quoting.** Every value is dollar-quoted with a random tag that is checked against the text, so no reading can end the quote.
- **Transaction and RLS.** One transaction. No policy or RLS change, and the new rows carry `account_id`, so the existing RLS policies cover them.
- **Account.** The account in the file matches the snapshot's `accountId`.

Two minor notes:
- The second undo line deletes every `chosen_by='model'` link for the account, including any the app makes after the import. The plan's "nothing else is touched" overstates it, but the app's own `relink` does the same delete (`service.ts:125`).
- `links_stored` counts all of the account's links, not only the imported ones.

### Checked locally
- `scripts/benefit-table/test.ts`: 105/105.
- `chat-test.ts`: 43/43.
- `scripts/simple-answer/chat-test.ts` was not run, because `@anthropic-ai/sdk` is missing in my sandbox.

## Round 114: PR #98 at d728de5 (delta review for R113-1)

**Verdict: READY.** R113-1 is fixed, and I am adding one recommended one-line widening of the page pattern (R114-1).

### R113-1: fixed
- **Rule pages are now sent.** `pagesToSend` (`lib/benefit-table/chat.ts:89-95`) adds every `RULE_PAGE` page of each document that a row comes from.
  - I reproduced the coordinator's figure on run-03b plus the snapshot: 84 of 229 pages are sent.
  - Benefit Summary p11, which holds the 90-day Living Care waiting period, is now sent.
- **Every amount now carries a warning.** `noteNarrowedPages` (`chat.ts:101-104`, called at `hook.ts:104`) adds `NARROWED_PAGES_NOTE` once to any answer that shows an amount.
  - The note contains no figure.
  - I checked the trigger: it fires on `s.amount`, the same field the saved answer carries, and the end-to-end test asserts exactly one note when there is an amount and none when there isn't.
  - It only runs when there are rows, which is when pages are narrowed. The only harmless edge is a library whose cited and rule pages happen to be all of its pages.
- **Prompt.** `PAGES_NOTE` now tells the model to check the rule pages for the event before giving an amount.
- **Tests.** The Living Care waiting page is sent, and the claims page is not.

### R114-1 (medium, recommended before merge): `RULE_PAGE` misses "survival period" and "not payable"
The doc comment on `RULE_PAGE` (`chat.ts:84`) says it covers "a waiting or survival period", but the regex has no `survival`.

On the snapshot, these rule pages are still not sent:
- **5e58ea7d p65:** "9 SURVIVAL PERIOD The Life Assured must survive a period of seven (7) days after the date of diagnosis…". This affects every CI amount if death follows within 7 days.
- **817d6e8b p27 and p51, 5e58ea7d p38 and p61:** "This benefit is not payable if … diagnosed before the Benefit Commencement Date".
- **817d6e8b p29, 5e58ea7d p40:** "shall not be payable".
- **5e58ea7d p16:** "We will not be liable for any claim made on or after the Policy ends".

The server note (a) still warns on every amount, so this is not a bare wrong amount. That is why it is not blocking.

Suggested fix: add `|survival\s+period|\bnot\s+(be\s+)?payable\b|\bnot\s+be\s+liable\b` to `RULE_PAGE`. On this library that sends about 12 more pages, roughly 10k tokens.

### Residual (noted, not blocking)
- A document with no rows sends no pages at all, for example a separate policy wording whose schedule holds every row. Its exclusions reach the user only through the fixed note. Here, the only document with no rows is a single-page one (output_…117).

### Tests (run locally)
- `scripts/benefit-table/test.ts`: 105/105
- `chat-test.ts`: 44/44

## Round 115: PR #98 at 8fd4003 (R114-1 delta)

**Verdict: READY.** R114-1 is fixed.

- **The pattern now catches the missed rules.** `RULE_PAGE` (`lib/benefit-table/chat.ts:86`) adds three patterns:
  - `survival\s+period`
  - `not (be) payable`
  - `not be liable`

  This matches the fix I suggested, and the regex now agrees with its doc comment.
- **The page count matches.** 96 of 229 pages are sent, which is what I estimated: 84, plus 12 new rule pages.
- **Test coverage.** The survival-period case is added inside the existing chat-test case.
- **Local test results:** `scripts/benefit-table/test.ts` 105/105, `chat-test.ts` 44/44.

## Round 116: PR #99 at 6d01bff (Coverage with nothing to confirm)

**Verdict: NOT READY.** Two findings: R116-1 is high, R116-2 is medium. Amounts, caps, qualifiers and person binding are sound. The confirmations code is safe, and so is leaving out the multi-person picker.

### R116-1 (high): the conditions of each row are no longer shown anywhere on Coverage
In `components/benefit-table-coverage.tsx`, `benefitParts` builds its detail from `rowDetail` and the figure note. `rowDetail` (`lib/benefit-table/headline.ts:42-45`) only includes the qualifier, `fromDay` and `maxDays`. Its own comment says "Conditions are on the page the row links to". As a result, `r.conditions` is not rendered, either in the key rows or in the "All N benefits" table.

On main, every row showed its days plus its first two conditions, with the full list under "Conditions and source" (old lines 133-135).

On run-03b, 154 of the 348 rows carry conditions. Examples:
- "Only 1 claim is allowed under this benefit"
- "The waiting period in Section 3.2"
- "Each condition can only be paid once and a maximum of 6 claims"
- the "survives at least … days" rules

The amount itself is unchanged. But "S$300,000" or "Up to S$500" is now shown without the rule that limits it, and a page link is not the same as showing the rule. This breaks the "never strip a qualifier" rule, and it contradicts the PR's claim that no qualifier is lost.

**Suggested fix:**
- In "All N benefits", show each row's conditions in the name cell's `<small>`, or add a fourth cell that wraps.
- On key rows, show the first condition and a "+N more" that points to the full list.
- Add a test that a row's conditions text appears in the rendered table.

### R116-2 (medium): unplaced parts of documents are now hidden without a word
`assemble.ts:54` documents `unlinkedSections` as "shown to the household, never silently dropped". The new page drops that field from `BenefitTableData` and renders nothing for it. On run-03b there are 22 such parts.

Leaving them out of the table and the chat is fail-safe, because no wrong amount can appear. But nothing tells the household that parts of their documents are not summarised, and hiding a documented benefit counts as a failure.

**Suggested fix (no picker needed):** one line under "Also in your documents", for example: "N parts of your documents couldn't be placed under a cover, so they aren't in this summary or the chat", followed by one page link per part. Leaving auto-linking out of this PR is fine once the household is told.

### Checked and sound
- **Amounts.** `shortFigure` only re-words the figure the row already has. It uses the same unit and period wording as `assemble.figureText`.
  - A capped worked-out amount says "Up to", and the note keeps "N% of S$base, capped".
  - Projections are labelled "not an amount held or payable".
  - A row with no currency says "(currency not stated)".
  - `money` matches `assemble.ts`.
- **Key-benefit selection.** It only orders and limits rows, and never shows a figure the row doesn't carry.
  - It never chooses a projected row, a not-covered row, a row with no amount that isn't "as charged", or a second row with the same name.
  - The qualifier ("for child") stays in the detail line.
  - Every row is still in "All N benefits".
  - Rows are filtered by `coverKey` as on main, and no row is left without a cover on run-03b (0 of 348).
- **Person binding.** It is unchanged: rows stay under `person.rows`, and the table never reads `policy_members` or `linkedPeople`. So leaving out the multi-person upload picker changes no binding.
- **Confirmations.** The confirm and link routes and `benefit_confirmations` are untouched, and no longer called from the page.
  - The table still applies any stored correction. With 0 in production, that changes nothing.
  - One consequence: a stored correction can no longer be undone from the page.
- **The new report route.** It requires a household member, is off unless the table is live for the account, takes at most 1,000 characters, writes one log line, and changes nothing.

### Tests (run locally)
- `headline-test`: 12/12
- `test.ts`: 105/105
- `chat-test`: 44/44

## Round 117: PR #99 at 42ac13d (R116 fixes, short cover names, temperature retry)

**Verdict: READY.** R116-1 and R116-2 are fixed. I found no new blocking issue; one low note is at the end.

### R116-1: fixed
`rowDetail(r, brief)` (`lib/benefit-table/headline.ts:39-43`) now includes the row's conditions:
- In the full list, every condition is shown.
- On a key row, the first condition is shown with "(+N more)".

The component passes `brief` only for key rows, and the headline test covers both cases.

### R116-2: fixed
- `assembleTable` now records a `source` for each unplaced part: the first benefit of that section.
- The GET route already sends `unlinkedSections`.
- The page lists the parts under "Also in your documents", in a collapsed line: "N parts … couldn't be placed under a cover, so they aren't in this summary or in the chat". Each part has its document and a page link.

### Stored corrections
`tableFor` (`service.ts:108-110`) no longer passes confirmations, so:
- every amount is the printed or worked-out figure;
- the chat path that depended on a corrected base (`coverRows`/`baseCorrected`) gets nothing;
- `staleConfirmations` is empty.

This is consistent with the page having no undo.

### Short cover names: no two covers merge
`coverLabels` (`chat.ts:57-76`) is keyed by the full printed name, and it decides uniqueness across all the household's covers, not just the ones in one answer:
- **Unique short name:** the cover is labelled with its short name, which is its own words without the printed policy number, plus the plan.
- **Shared short name:** the product is added.
- **Still shared:** the full printed name is kept, policy numbers included.

Checks:
- **Real table (run-03b):** 7 covers give 7 distinct labels.
- **Adversarial case:** "A / GTL(POLICY NO. 1)", "A / GTL(POLICY NO. 2)" and "B / GTL" stay distinct, as "A, GTL(POLICY NO. 1)", "A, GTL(POLICY NO. 2)" and "GTL, B".
- **Checks that compare labels:** `report.labels` and `keepLabelledAmounts` use the same `said` text, so they still match.
- **Covers that already shared a full name:** two covers whose full printed names were identical already shared a label before this change. For example, two CI II policies with no policy number in their names. That is not new.

### Temperature retry: no loop and no double charge
`anthropicPost` (`lib/ai/providers.ts:357-364`) sends the request at most twice:
- It retries only on a 400 whose body mentions temperature, and only while `temperature` is still in the request.
- The retry drops `temperature`, so a second retry cannot happen.
- A 400 is not billed.
- `withRetries` retries only 429 and 5xx errors. So any repeat paid call can only come from those, exactly as before this change.

Other details:
- The model is remembered for the rest of the process, so later calls skip the 400.
- Each caller builds a fresh request, so deleting `temperature` from it affects nothing else.
- The rag2 hosted-model path uses the same helper.
- Tests: `anthropic-post-test` 4/4.

### R117-1 (low, not blocking): a short name can drop the kind of cover
On run-03b, "Travel insurance summary, Single Trip, plan Business" becomes "Single Trip, plan Business". The card's citation names the document, so the reader can still tell what it is.

Optional fix: keep the product whenever the short name has no cover-type word in it (life, accident, travel, health, critical, hospital and so on).

### Tests (run locally)
- headline-test 13/13
- test.ts 105/105
- chat-test 45/45
- anthropic-post-test 4/4

## Round 118: PR #99 at cc6e495 (delta from 42ac13d)

**Verdict: READY.** No findings.

- **R117-1 is fixed.** A short cover name keeps its product unless it contains a cover-type word (`COVER_KIND`, `chat.ts:60`).
  - On run-03b the travel cover now reads "Single Trip, plan Business, Travel insurance summary".
  - The other 6 labels are unchanged, and all 7 are still distinct.
- **No two covers can share a label.** If any picked label is used by more than one cover, every cover with that label gets its full printed name. Full names are the keys, so they are distinct.
  - The only way left to collide is contrived: one cover's picked short label would have to equal another cover's full printed name, word for word.
  - My earlier adversarial case (GTL with policy no. 1, GTL with policy no. 2, and GTL from product B) still gives three distinct labels.
- **Key rows now show every condition.** `rowDetail` takes no `brief` argument any more, so a key row's detail line is the same as the full list's. That is stricter than R116-1 asked for, and nothing is shortened.
- **Tests (run locally):** headline-test 13/13, test.ts 105/105, chat-test 46/46.

## Round 119: PR #100 at 3b87b9d (MODEL_PRESET=anthropic ignores non-Anthropic per-job settings)

**Verdict: READY on code.** One cost point needs DC's decision before merge (R119-1).

### The four checks
1. **The alpha chat and the benefit-table reading are untouched.** Neither path calls `modelFor`:
   - The benefit table uses `benefitTableModel`, which reads `DEARPOLICY_BENEFIT_TABLE_MODEL` and accepts only `anthropic:` values (default Sonnet 5.5).
   - The simple chat uses `simpleChatModel` and `DEARPOLICY_SIMPLE_CHAT_MODEL`.
   - Nothing outside `providers.ts` reads `READING_MODEL`, `JUDGEMENT_MODEL`, `NARRATION_MODEL`, `CHAT_MODEL` or `JUDGEMENT_FALLBACK_MODEL` directly.
2. **Anthropic per-job settings still win.** `allowedByPreset` (`lib/ai/providers.ts:73-75`) drops a setting only when the preset is anthropic and the setting's provider is not anthropic. So `CHAT_MODEL=anthropic:claude-haiku-4-5` is kept.
   - When a setting is dropped, the job falls back to the preset's model: Haiku 4.5 for reading and narration, Sonnet 5 for judgement and chat.
   - Every other preset, and no preset, behaves exactly as before. The tests cover all five cases.
3. **Fallback.** Under the anthropic preset, `fallbackModelFor` returns null unless `JUDGEMENT_FALLBACK_MODEL` is itself an Anthropic model.
   - A leftover `gemini:flash-lite` fallback is now ignored, so a rate-limited judgement retries nothing rather than switching to Google.
   - No fallback can end on a non-Claude model.
   - Scanned-page reading (`documentReaderFor`) now gets a Claude reading model. Anthropic is in `HOSTED_DOCUMENT_PROVIDERS`, so that model is used for scanned pages.
4. **Spend accounting.** Every model these paths can now resolve to is in `PRICES`: `claude-haiku-4-5`, `claude-sonnet-5` and `claude-sonnet-5-5`.
   - An Anthropic model typed into a per-job setting that is not in the table is still priced at zero and flagged. That was already true.

One edge case: with the preset set but no `ANTHROPIC_API_KEY`, the preset choice parses to null. The OpenAI setting is now ignored too, so the job falls back to the Gemini default. The preset implies the key, so this only matters if the key is removed.

### R119-1 (decision for DC, not a defect): merging moves every household's older jobs to Claude prices
The test comment says production already has `MODEL_PRESET=anthropic` set, with the `openai:gpt-6-luna` per-job settings left over. If so, then from merge and deploy onward, these jobs move for every household, not just the alpha account:

| Job | Today | After merge |
|---|---|---|
| Reading (old ledger) | `gpt-6-luna` | Haiku 4.5 |
| Narration | `gpt-6-luna` | Haiku 4.5 |
| Judgement | `gpt-6-luna` | Sonnet 5 |

By `PRICES`, Haiku 4.5 costs US$1 in / US$5 out per million tokens, and Sonnet 5 costs US$2 / US$10. `gpt-6-luna` costs US$0.10 / US$0.50. That is about 10x for reading and narration, and about 20x for judgement.

This is the intended behaviour, but it changes cost and model quality in production, against a US$100/month budget. DC should say yes knowing that.

The alternative is to unset `MODEL_PRESET`, or keep the OpenAI settings with no preset, until the alpha's own spend is known.

### Tests
`model-preset-test`: 5/5, run locally.

## Round 120: PR #100 at 9d22898 (delta from 3b87b9d)

**Verdict: READY.** No findings. R119-1 (the cost switch) is accepted under DC's Anthropic-only rule.

- **Preset check.** `allowedByPreset(choice, env)` is now exported and reads `MODEL_PRESET` from the env it is given. "anthropic" is a known preset, so this behaves the same as `modelPreset()`.
- **Alpha chat model.** `simpleChatModel` (`lib/simple-chat/flag.ts:45`) runs the parsed value through `allowedByPreset`. Under the preset, a leftover `openai:` value falls back to `DEFAULT_SIMPLE_MODEL` (Sonnet 5.5). An `anthropic:` value still wins, and the format check still throws on a malformed value.
- **Canaries.** `canaryConfigFor` (`lib/ai/rollout.ts:116`) returns null for a canary that names another provider. With no canary configured, the stable model applies, and under the preset that model is Claude. So no Google or OpenAI call can come in through the canary path.
- **Imports.** `simple-chat/flag.ts` now imports a value from `providers.ts`; before, it imported only types. `providers.ts` imports only zod and `deterministic-model`, so there is no import cycle. Neither module is imported by a client component; only server modules (`lib/chat/workflow.ts`, `lib/ai/llm.ts`) import them.
- **Tests (run locally):** model-preset-test 7/7, benefit-table chat-test 46/46.

## Round 121: PR #101 at aef0cbd (answer style guide, label clean-up, sin1 region)

**Verdict: NOT READY.** One finding is high, two are medium and one is low. The region change is safe, and the PR has no per-question patches.

### R121-1 (high): any model note containing "differ", "either" or "alternative" now removes the server's "not a total" warning
In `lib/simple-chat/verify.ts:1063-1066`, `saidApart` skips every not-a-total note whenever any uncertainty statement in the answer matches `not a total|alternatives?|either|differ(ent|s)?`.

The style guide asks for exactly such a note: "When documents print different figures, say so once, in the note after the amounts". That note says the figures differ, not that they must not be added. It is also not tied to the amounts in the group: one such note anywhere drops the warning for every group.

I probed this with the PR's own style-test fixture (two cross-row amounts, S$500 and S$250):

| Model's note | not-a-total notes kept |
|---|---|
| "The two documents print different figures." | 0 |
| "Either document can be used to claim." | 0 |
| no note | 1 |

In each case both amounts are still shown. This is the wrist case in plain form: S$1,250 or S$120,000 shown with only "the documents differ", and nothing saying they cannot be added. A wrong total is our worst kind of bug, and this removes the server-side guard against it on the model's wording alone.

**Fix:** always keep the server's note. To say it once, drop the model's own uncertainty sentence when it only restates the difference. If you do want to skip the server's note, require the model's sentence to say "not a total" or "cannot be added" and to name every amount in the group.

### R121-2 (medium): the chat goes down if the style file is missing at run time
`SIMPLE_SYSTEM_PROMPT` is a module-level template that calls `answerStyle()`, which does `readFileSync(.../answer-style.md)`. If the file is not traced into a route, the prompt module throws when it is imported, and every chat request fails. That can happen through a future `outputFileTracingIncludes` edit, a bundling change or a route that is not covered.

The `"/**"` include in `next.config.ts` covers today's routes, and the test asserts that config line. But a style file should never be able to stop the chat.

**Fix:** wrap the read in try/catch, return "" on failure and log once. Or import the text at build time, for example as a `.ts` string export.

### R121-3 (medium): cards for printed policy terms lost their only text label
`components/answer-cards.tsx:96`. Cards of kind `benefit_terms` used to say "as printed in the policy, not worked out for this case". Now only the CSS class `printed` (a quieter style) tells them apart from an amount worked out for the event. A style is not a qualifier: a screen reader or a quick reader sees "Up to S$5,000" just as they see a calculated figure.

Removing "illustration", "printed amount" and the "currency not stated" line is fine:
- the footer still says "Illustrations/Amounts from your documents, not a payment or an insurer's decision";
- a bare "$" is still explained under "Where this comes from" (`answer-cards.tsx:125-126`).

But the per-case qualifier on printed terms should stay. A short label such as "Policy terms, not worked out for this case" is enough.

Also checked:
- Removing "To confirm" (no amount, only uncertainties) leaves no amount, so it cannot mislead.
- Removing "worked out from the document's terms" from `basisOf` and the stay basis keeps "N% of …" and "(n × amount)", so how each figure was reached is still shown.

### R121-4 (low): a real household name is in a prompt sent to every household
`lib/chat/answer-style.md:31` uses "sorry, it was Desmond" and "For Desmond, …". The guide goes into every household's system prompt. It is DC's real family member's name, from the live test.

**Fix:** use a made-up name, as the tests do ("Lim Ah Kow").

Separately, and outside this PR: `app/family/page.tsx:115` already shows DC's full legal name as the placeholder to every user. It should be replaced the same way.

### Can the style guide override the accuracy rules? Mostly no.
- The guide is placed after the rules, with "The rules above always win over it".
- It tells the model only how to write. The server's checks (`verifyAnswer`, `amountsFromRows`, `keepLabelledAmounts`) do not read it, so it cannot add an amount or remove a qualifier. R121-1 is the exception, because a server check now depends on wording the guide encourages.

Two wording points, neither blocking:
- The prompt's "could fall under" became "falls under", and "Leave out benefits … the question didn't ask about" was added. Read with the new "a separate benefit … one short fact, no amount" line, this narrows answers to the event as described. That matches "missing information is not an exclusion": the benefit is still named.
- "Never show … 'as printed'" conflicts with keeping the printed-terms qualifier (R121-3). Apply that line to the model's prose only.

### Region (sin1) on Hobby: safe
- `vercel.json` sets one region, `["sin1"]`. To my knowledge Vercel's Hobby plan allows one region of your choice for functions; only multiple regions need Pro. I have not checked this against the live dashboard.
- No route sets `preferredRegion` or the edge runtime, so nothing conflicts.
- The daily cron runs in sin1 too.
- The only effect is lower latency to the Singapore database.
- `/api/health` now reports `VERCEL_REGION` and splits the "Chat model" and "Checking model" labels. `simpleChatModel()` can throw, and that is caught.

### No per-question patches
- The prompt and guide lines are general rules (corrections, unmentioned separate benefits, list questions, follow-ups). The ambulance and hospital-stay examples illustrate a general rule.
- `benefitName` strips any leading row letter or number from every benefit. It is tested on 8 shapes, including ones it must leave alone ("A Death benefit", "X-ray").
- Loading the library, conversation and table in parallel is general. The spend-cap check runs in that same `Promise.all`, so going over the cap still rejects before the model is called.

### Tests (run locally)
- style-test: 6/6
- benefit-table chat-test: 46/46

## Round 122: PR #101 at 58a225f (R121 fixes)

**Verdict: READY.** R121-1 to R121-4 are fixed. One low note follows.

- **R121-1 is fixed.** `verify.ts:1063-1075` now always adds the server's not-a-total note, which names the amounts. It then drops the model's own uncertainty statements that say "not a/the total". I re-ran my R121 probe with the PR's fixture. "The documents print different figures", "Either document…" and no note each now keep exactly 1 server note, and both amounts stay.
- **R121-2 is fixed.** `answerStyle()` catches a read failure, logs one line and returns "". The prompt then leaves out the style block entirely, so the accuracy rules are unchanged. The style test covers a missing path.
- **R121-3 is fixed.** `benefit_terms` cards show "Policy terms, not worked out for this case" again.
- **R121-4 is fixed.** The guide uses "Wei Ming", and a test asserts that neither household name appears in it. The full name in `app/family/page.tsx` is still there, outside this PR's scope.

### R122-1 (low, not blocking)
A model sentence is dropped whole when it contains "not a total", even if it also says something else. My probe: "These are not a total; the recuperation benefit needs a 24-hour stay" is removed. The condition still sits on the recuperation card, because cards carry the row's conditions, so nothing is hidden today.

A tighter rule would drop the sentence only when, once "not a total" and the amounts are removed, nothing else is left.

### Tests (run locally)
- style-test: 9/9
- benefit-table chat-test: 46/46

## Round 123: PR #101 at e8adffd (delta from 58a225f)

**Verdict: READY.** No findings.

- **"Currency not stated" is back.** An amount card shows it whenever the currency is not resolved, alone or after the policy-terms label (`answer-cards.tsx:99`).
- **R122-1 is fixed.** `onlyNotATotal` (`verify.ts:893-900`) removes a sentence only if it says nothing but "not a total". A sentence with a digit, a time word, a condition word or any other content word stays. I probed four model notes:

  | Model's note | What stays |
  |---|---|
  | "They are not a total." | removed |
  | "…not a total. Claim within thirty days of the accident." | "Claim within thirty days of the accident." |
  | "These are not a total; the recuperation benefit needs a 24-hour stay." | kept whole (it has a digit) |
  | "Not a total, and the hip benefit is reduced by any earlier fracture payout." | kept whole |

  The server's note, which names the amounts, is there in every case.
- **benefitName regex fixed.** "D, E and F Benefit" is now treated as a list and left whole. `benefitNames` keeps the printed names whenever stripping the row letters would make two different benefits of one cover look the same ("A. Death" / "B. Death").
  - Coverage and the chat label both use it, and the label checks compare the same text.
  - Separately, the `benefitName` calls in `lib/claims/*` belong to a different, local function.
- **Tests run locally:** benefit-table chat-test 46/46 and headline-test 13/13. `style-test` now imports React, which my sandbox lacks, so I did not run it. I ran the verify-level probes above directly instead.

## Round 124: PR #102 at cdc9105 (second answer-quality round, diff vs main)

**Verdict: NOT READY. Two blockers, both small fixes.** (b) and (c) hold. The amounts in the before-and-after are right.

### R124-1 (blocker): the bare-$ rule does not catch every other currency
`documentCurrency` (`lib/simple-chat/verify.ts:133-146`) decides that a document is Singapore-dollar only. It does so when the document names S$ and it finds no *listed* other currency. The list misses common spellings, so a foreign-currency document can pass, and its bare "$" is then shown as S$. My probes, each text with "S$" somewhere plus a bare "$100,000":

| The document also says | Result |
|---|---|
| "Premiums are payable in S$ or U.S. dollars" | **SGD** (wrong: "U.S." is not matched) |
| "Japanese yen" / "RMB 5,000" / "NT$5,000" / "Canadian dollars CAD 5,000" / "Rs 5,000 or ₹5,000" | **SGD** (all wrong) |
| "Policy Currency: USD" / "USD100,000" | null (correct) |

USD policies sold in Singapore are common, so "U.S. dollars" is a realistic path to a wrong currency on an amount. The coordinator's bar is that an open path must withhold, not show a wrong figure. This path shows a wrong one.

**Fix: make the check fail-safe.** Treat any of these as "other":
- any "dollar(s)" not directly preceded by "Singapore";
- any three-letter capital code other than SGD next to a number (`\b(?!SGD)[A-Z]{3}\s?\d`);
- any currency sign other than "S$" and a bare "$" (`[A-Z]{1,3}\$`, ₹, ฿, ₩, ₱, ¥, €, £);
- the words yen, yuan, renminbi, rupee, baht, ringgit, peso, won, franc.

The cost of a false "other" is only the existing "Currency not stated" label.

On the real snapshot, the 17-page MINDEF benefit summary resolves 19 bare "$" figures to S$. That is correct, and it still works with the stricter check.

Scope (challenge a) is right. The inference uses only the amount's own document (`found.docIndex`, the base document for a sum insured, `bdoc` in `basisOf`), with one cache entry per document object. It is never borrowed from another document or version. DC approved this rule in principle when they said go on round 2. It changes the frozen money rules, so the stricter detection is a precondition for that approval holding.

### R124-2 (blocker): "each paid on its own terms" is a promise the documents don't support
Challenge (d). `answer-style.md` states as a fact: "Separate covers each pay on their own terms unless a document says one replaces or reduces another." The default sentence in `prompt.ts` tells the model to say "separate covers, each paid on its own terms" whenever the pages it was sent print no such rule. DC's own documents contain several such rules:

| Document and page | Rule printed there | Sent under narrowed pages (RULE_PAGE)? |
|---|---|---|
| MINDEF Voluntary Scheme, 55 rows in the table | "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme." Hospital cash, Compassionate Death Allowance, Child Education Fund, recuperation, home modification. | Only some pages: D2 p9 yes (it says "exclusions"), D1 p7 no |
| D2 p4, Advance Payment | Pays only "provided no other Benefit has been paid", and "the balance of the Sum Insured … shall be paid" at death. An advance payment reduces the death benefit. | Yes |
| D2 p3 | Cover "terminated upon payment of full Sum Insured under GTL or GPA". | **No** |

Mitigation: the table rows already carry the Core-or-Voluntary sentence as a condition, so those cards show it. The model's uncertainty line can still contradict a condition printed on the card next to it. Where the rule sits on an unsent page (D1 p7, D2 p3), "each paid on its own terms" fills the gap with an entitlement nobody checked.

**Fix (two lines):**
- Default sentence, in both the prompt and the style guide: "These are separate covers. The pages I used don't say whether one affects the other, so the insurer decides. They are not added up." Drop "each paid on its own terms" everywhere.
- Add coordination words to `RULE_PAGE`: `can only be claimed|either under|no other benefit (has been )?paid|balance of the sum|terminated upon payment|instead of|in lieu|reduce[sd]?\b|deducted`. Pages that print these rules are then always sent.

Keep the existing "fact with its quote" path for printed rules. In the before-and-after, the TPD answer already quotes the cover-ends rule, which is the right behaviour.

### R124-3 (medium, should fix in this round): "not shown to be covered" also drops the claim deadline
Challenge (e). The new rule (`prompt.ts`) removes how-and-when-to-claim steps when the bottom line is "not covered", "**not shown to be covered**" or "cover ended". The first and third are fine. "Not shown to be covered" means information is missing. Missing information is not an exclusion, so the cover may still pay.

Dropping the printed notice deadline there can cost a valid claim. Example: the knee-ligament answer is "not shown covered", yet it lists ambulance (up to S$500) and recuperation (S$250) under the same accident cover. In the flight answer, the trip dates are uncertain and the user is told to confirm them with FWD.

**Fix:** for "not shown to be covered" only, keep the printed deadline as a conditional fact, for example: "If FWD confirms cover, the policy says to claim within 30 days." Suppress claim steps only for "not covered" and "cover ended".

### R124-4 (low, not blocking): a dropped point is now silent
The LEFT_OUT_FACT notice is removed. A left-out amount still shows LEFT_OUT_AMOUNT. An unverified fact or exclusion the model wanted to state now disappears without a trace. Exclusion pages are sent (RULE_PAGE) and the cards carry the rows' own conditions, so I accept this as DC's style choice ("never say you left something out"). Keep `report.dropped` logged so the Test engineer can count dropped exclusion-type facts.

### Checked and holding
- **(b) The not-a-total note survives.** The R121 and R122 probes re-run on cdc9105. The model note "The two documents print different figures. The insurer decides which applies." is removed, and the server's not-a-total note stays (1 note, 2 amounts). The same holds for "X and the summary print different figures; the insurer decides which", "Either document…" and no note at all. A note with a condition is kept beside the server's note.
- **(c) The card still shows base and percentage.** Every percent-of amount is an illustration (`verify.ts:407,413`), and `basis` is attached for every illustration with `percentOf` (`verify.ts:1087`, `basisOf` at 943). The card shows basis unless the text already says it (`answer-cards.tsx:60`). A capped row keeps its percentage in the label. A base the household corrected now states the percentage in the fact. A failed percent-of amount that is kept as a fact gains "N% of …". I found no path where a worked-out amount shows without its percentage and base.
- **Row letters:** the `benefitNames` change keeps distinct letters ("A. Death" / "B. Death"). headline-test passes 13/13.

### Tests (run locally, free)
- benefit-table chat-test: 46/46
- headline-test: 13/13
- benefit-table test: 105/105

simple-answer chat-test, style-test and offline-test need `@anthropic-ai/sdk` or React, which this sandbox lacks, so I did not run them. I ran the verify-level probes above instead.

## Round 125: PR #102 at 501fe7c (delta from cdc9105)

**Verdict: READY.** All four R124 findings are fixed. One low note, not blocking.

- **R124-1 is fixed.** `documentCurrency` (`verify.ts:131-154`) now treats as "other" all of the following:
  - any "dollar(s)" not after "Singapore";
  - a listed foreign code next to a number, in capitals;
  - any letters-then-"$" sign other than S$/SG$/SGD$;
  - any other currency sign, "Rs";
  - currency names, and foreign-currency or exchange-rate clauses.

  All my R124 probes now return null: U.S. dollars, yen, RMB, NT$, Canadian dollars, Rs/₹, USD100,000 and "Policy Currency: USD". "GPA 600 / GTL" (scheme codes) still resolves to SGD. On the real snapshot, the 17-page MINDEF benefit summary still resolves its 19 bare "$" to S$. The scope is still the amount's own document.
- **R124-2 is fixed.** Both `prompt.ts` and `answer-style.md` now use the neutral line: "These are separate covers. The pages I used don't say whether one affects the other, so the insurer decides. They are not added up." "Each paid on its own terms" appears nowhere in either, and style-test asserts its absence. Printed rules are named for the model to quote: one scheme only, instead of / reduces, balance of the sum insured, cover ends after a full payment. `RULE_PAGE` now also matches coordination wording. On the snapshot it sends 93 rule pages instead of 81, adding 12, including D1 p7 (Core-or-Voluntary note) and D2 p3 (terminated upon payment of the full sum insured).
- **R124-3 is fixed.** Claim steps are suppressed only for "not covered" and "cover ended". For "not shown to be covered", a printed deadline is given as a condition ("If FWD confirms cover, claim within 30 days …"), and the prompt adds "Missing wording is not an exclusion".
- **R124-4:** accepted as DC's style choice. No change needed.
- **TE fixes checked.**
  - The "different figures" sentence is removed only when the server's notes cover every amount shown (`differOk`).
  - `onlyNotATotal` now keeps any sentence with a condition or time word (if, when, after, only, dated…).
  - Re-running my R121 and R122 probes: 1 server not-a-total note and 2 amounts in every case.
  - `docLabel` tells apart documents that would read the same by upload date, then by "file N of M".
  - `personalFileName` hides WhatsApp, Screenshot, PXL and "document (3)" names.

### R125-1 (low, not blocking)
`\bwon\b` also matches "won't", so a Singapore document that says "we won't pay" falls back to "Currency not stated" for its bare "$". This errs on the safe side (it withholds, never mislabels). It only costs the improvement in such documents. A later fix is `\bwon\b(?!['’]t)`.

### Tests (run locally, free)
- benefit-table chat-test: 46/46
- headline-test: 13/13
- benefit-table test: 105/105

style-test (which now covers R124-1/2/3) needs React, which this sandbox lacks, so I did not run it. I re-ran the verify-level probes directly instead.

## Round 126: PR #103 at 57e33b4 (round 3, diff vs main)

**Verdict: NOT READY. Two blockers, both of which can show a wrong or unqualified amount.** Premium rows (2), short files (3) and the prompt-only changes (5) hold.

### R126-1 (blocker): the "100% of the sum insured" fallback accepts another policy's, another person's, or a contradicted sum
The new fallback (`verify.ts` ~1009-1023) runs when `checkAmount` refuses for one of two reasons:
- "the percentage is not the quoted row's own figure";
- "the sum is not the one this row's table is a percentage of".

It then shows the model's base quote as the amount if three things hold: the base line is printed, the base's *page* contains the person's name tokens, and the wording has no limit words. It skips every check `sumInsuredBase` makes. It does not check that the base line names the person, that the base is the same cover or policy as the wording, or that the base agrees with the row's own printed base.

Probes (`scratchpad/r126/w.ts`) use a certificate page with "GROUP TERM LIFE / Lim Ah Kow S$500,000 / Tan Mei S$1,000,000 / GROUP PERSONAL ACCIDENT / Lim Ah Kow S$600,000":

| Model statement | Shown |
|---|---|
| CI policy wording "100% of the Sum Assured will be payable in one lump sum", base = Lim's **GTL** line | **S$500,000** as the CI death benefit (another policy's sum) |
| Same wording for Lim, base = **Tan Mei's** line | **S$1,000,000** (spouse's sum, for Lim) |
| A table that prints its own base "Accidental Medical Expenses (Sum Insured S$5,000) / Medical expenses 100%", base = Lim's S$600,000 | **S$600,000** (overrides the base the table prints) |

Each of these is a wrong claimable amount.

**Fix:**
- Drop "the sum is not the one this row's table is a percentage of" from `WHOLE_FALLBACK`. A table that prints its own base has settled the base.
- For the other reason, require the base to come from the **same document as the wording, or a document with the same policy number**.
- Require the base **line** to name the person (as `sumInsuredBase` does at R50-3) and the page to name no other household member (`otherLife`).

A3 (policy wording and its own schedule, one policy) still passes under these rules.

### R126-2 (blocker): a companion row is shown without its own conditions
`amountsFromRows` (`chat.ts` ~179-196) builds each companion with `statementFromRow(r, { ...raw, alternativeGroup })`. `raw` is the model's statement for the *primary* row, so the companion:
- inherits the primary's conditions (verify then drops them, because their quote is not on the companion's page);
- never gets its own row's conditions, because the model never wrote a statement for it.

Probe: I added the condition "Payable only if surgery is performed." to the benefit-summary Hip row, R3 in the test. The card reads **S$1,500 with conditions []**. Its qualifier is stripped, which the standing rule forbids.

Borrowing (challenge 4) is blocked today, but only by the page-quote check, not by design.

**Fix:** build each companion with `conditions: r.conditions.map((t) => ({ text: t, quote: t }))` and none of `raw.conditions`. Add a test asserting that the companion card carries its own row's condition.

Holding:
- Companions require the same person, `coverKey` (product, cover and plan), qualifier and core name, from a different document and with a different figure.
- No combination across people or schedules was found.
- The not-a-total note is added.

### Checked and holding
- **(2) Premium rows.**
  - Only a page with exactly one plain premium line is used ("First Year Instalment Premium *" fails `PLAIN_PREMIUM`), and only when the page names no other life (`otherLife`), on the first cover of that page and person.
  - Currency: the snapshot's 470.85 (D8 p3) prints no sign, but the page declares "Currency : Singapore Dollar", so it is S$ by the page's own declaration. A different stated currency on the line skips it.
  - With no declaration, the premium takes the cover's own currency from the same document and cover. I accept that, because one policy has one currency; it is noted below.
  - "Monthly" comes only from a single "Payment Frequency" on the page.
  - The first-year note is part of the row's label (`premiumName`), so it cannot come apart from the figure.
- **(3) Short files.**
  - Only readable documents of 3 pages or fewer that no row comes from are sent whole, and only from this household's `documents`, so isolation holds.
  - On the snapshot that is 3 one-page files, a negligible cost.
  - `PAGES_LEFT_OUT` replaces the misleading "not sent" so the model stops saying a file "could not be read".
- **(5) Prompt and style.** These rules carry no amount risk:
  - count documents from linked_people;
  - give the number under the label asked;
  - say what is settled before asking who is meant;
  - no self-correction;
  - a file with no reading_status was read.

### Low (not blocking)
- **R126-3.** There is no total cap on short files sent whole. A household with dozens of 3-page receipts sends them all. A page budget, say 15 pages for this rule, would bound the cost.
- **R126-4.** A bare premium with no page declaration borrows the cover's currency, which comes from the same document. It would be safer to require the premium's own page to settle the currency, otherwise "Currency not stated".

### Tests (run locally, free)
- benefit-table chat-test: 49/49
- headline-test: 13/13
- benefit-table test: 105/105

style-test needs React, which this sandbox lacks, so I did not run it.

## Round 127: PR #103 at 9aefff9 (delta from 57e33b4)

**Verdict: NOT READY. One blocker left (R127-1), and it is a small fix.** R126-1 to R126-4 are fixed.

### R127-1 (blocker): within one policy's schedule, the fallback can take another benefit's sum
`wholeSumInsured` (`verify.ts` ~399-421) accepts a base line only when the page has exactly one line with an amount of 10,000 or more. A schedule can print one large sum and one small sum on the same page. In that case the large line passes the "exactly one" test even when the wording is about the other benefit.

Probe: `scratchpad/r127/w.ts` uses the chat-test schedule (Comprehensive Critical Illness 300,000.00 and Death Benefit 5,000.00, Currency: Singapore Dollar). Its policy wording has the same policy number and says "2. Death Benefit … 100% of the Sum Assured will be payable in one lump sum".

| Base quote the model gives | Shown as the death benefit |
|---|---|
| "Death Benefit 5,000.00" | S$5,000 (right) |
| "Comprehensive Critical 300,000.00" | **S$300,000 (wrong: another benefit's sum)** |

This is the shape of DC's own CI II schedule (D8 p3), which has a S$5,000 death benefit beside the CI sum assured. It would be a wrong claimable amount.

**Fix (pick one):**
- Count every line on the page that prints a benefit amount, of any size, skipping premium lines. Require exactly one.
- Or require the base line to share the benefit's name with the wording's own heading ("Death Benefit").

Both cases stay correct under either fix. A3 keeps its 5,000 only if the wording names that benefit.

### Fixed and checked
- **R126-1.** My three R126 probes are now all refused ("the row prints no sum it is a percentage of"):
  - the base is another policy's certificate;
  - the base is the spouse's line;
  - the table prints its own base (S$5,000).

  The fallback now needs all of these:
  - same document or same policy number;
  - no other life on the base page (`otherLife`, now shared in `lives.ts`);
  - the base line names the person, or names nobody on a page about them alone;
  - wording with no limit or base words, including a base printed on a line above.

  "The sum is not the one this row's table is a percentage of" is no longer a fallback reason.
- **TE's A1 positive control.** Its base is a certificate in another document that names both spouses, so it is now refused. **I agree that refusing it is correct.** The bar is to withhold rather than risk another person's or another policy's sum. The S$1,000,000 figure was right in that case, but nothing on that page ties it to this one life and this policy. The percentage is still given as a fact.
- **R126-2.** A companion now carries only its own row's conditions. My R126 probe now shows S$1,500 with "Payable only if surgery is performed." and the primary keeps its own condition. `sameBenefit` keeps "Simple Fracture: Wrist" and "Compound Fracture: Wrist" apart (TE C4).
- **R126-3.** Short files sent whole are capped at 15 pages in total.
- **R126-4.** A premium's currency now comes only from its own line or page (`premiumCurrency`). With neither, it shows "Currency not stated".

### Tests (run locally, free)
- benefit-table chat-test: 51/51
- headline-test: 13/13
- benefit-table test: 105/105

The 44-question replay (40 right, 4 partly right, 0 wrong) is the TE's. I did not re-run it.

## Round 128: PR #103 at 153d9e7 (delta from 9aefff9)

**Verdict: READY.** R127-1 is fixed. No new findings.

The fallback now needs two things:
- **Exactly one benefit-amount line on the base page, of any size.** Premium, instalment, total, discount, GST, tax and fee lines don't count.
- **A base whose own or neighbouring lines name the benefit heading the wording** (`headingWords`). With no heading, it refuses.

All my probes, re-run in `scratchpad/r128/w.ts`, now come back as expected:

| Case | Result |
|---|---|
| CI 300,000 + Death 5,000 schedule, base = CI line | refused (R127-1) |
| Same schedule, base = Death line | refused: two benefit amounts, so it is fail-safe and only the percentage is given |
| Base is another policy's certificate, the spouse's line, or a table that prints its own base | refused (R126-1) |
| One-benefit schedule ("Death Benefit 50,000.00", premium line ignored), wording headed "2. Death Benefit" | S$50,000 with the basis "100% of the sum insured, which is the amount shown" |

The second row means DC's CI II death benefit (D8 p3) now shows as a percentage rather than S$5,000. That gives up a correct amount but never shows a wrong one, which meets the bar.

### Tests (run locally, free)
- benefit-table chat-test: 51/51
- headline-test: 13/13
- benefit-table test: 105/105

## Round 129: PR #103 at 43515c3 (delta from 153d9e7)

**Verdict: READY.** No findings.

The TE's A10b fix adds two more conditions on the base for the "100% of the sum insured" fallback:
- **The base's own lines must not be a limit, an expense or a per-event amount.** Lines containing limit, up to, maximum, expense(s) or per claim/day/event/visit/trip/accident/incident are refused.
- **"Sum insured" or "sum assured" must appear** on the base's lines or within the ten lines above them.

Both conditions only refuse more cases, so they are fail-safe.

My probes (`scratchpad/r129/w.ts`):

| Case | Result |
|---|---|
| All earlier R126 and R127 cases | still refused |
| One-benefit schedule under a "Sum Assured" table heading | S$50,000, with its basis |
| The same schedule without that heading | refused (fail-safe) |
| A "… Medical Expenses limit 50,000.00" base under a "Sum Assured" heading | refused |

### Tests (run locally, free)
- benefit-table chat-test: 51/51
- headline-test: 13/13
- benefit-table test: 105/105

## Round 130: PR #103 at bcb3e25 (delta from 43515c3)

**Verdict: READY.** No findings.

This round adds the TE's A10c rule. The base line is taken as the sum insured only if nothing is left on it after removing:
- the heading's benefit words,
- "sum insured" or "sum assured",
- the amount and its currency.

The rule only adds refusals, so it is fail-safe.

My probes (`scratchpad/r130/w.ts`):
- Every earlier R126–R129 case is still refused.
- The one-benefit positive case ("Death Benefit 50,000.00 ---" under a "Sum Assured" heading) still resolves to S$50,000.

Trade-off: DC's real CI II base is now refused, so A3 is back to partly right. The answer shows the percentage instead of the amount. That withholds a correct figure and never shows a wrong one, so I accept it.

### Tests (run locally, free)
- benefit-table chat-test: 51/51
- headline-test: 13/13
- benefit-table test: 105/105

## Round 131: PR #104 at d21672e (round 4, diff vs main)

**Verdict: NOT READY. One blocker (R131-1).** No path I found shows a wrong amount. The blocker is a check that removes true limits and refusals from the answer.

### R131-1 (blocker): `dropPeopleShutOut` removes true conditions and refusals, not only ownership claims
`chat.ts` `shutOut` treats any "<person> does not / cannot / is not / has no …" as shutting the person out. It removes the sentence whenever that person has a card in the answer, or a row for the same benefit. My probe (`scratchpad/r131/scripts/benefit-table/probe.ts`) uses Tan's hip card plus one uncertainty sentence:

| Sentence | Result |
|---|---|
| "Tan Mei Ling does not get the ambulance benefit, because no ambulance was used." | **dropped** |
| "Tan Mei Ling is not covered for this event, because a hairline crack is not a listed fracture." | **dropped** |
| "Tan Mei Ling cannot claim the recuperation benefit unless she stays in hospital for 24 hours." | **dropped** |
| "Tan Mei Ling has no cover under the travel policy." | kept |
| "…paid only for Lim, not Tan Mei Ling, because it is paid on the insured member's death." | kept |

So the answer becomes more generous than the documents. It loses a refusal, or a condition such as the 24-hour stay. That fails open, and it breaks the rule never to remove a qualifier.

**Fix:** match only ownership or exclusivity wording:
- "belongs to", "is X's (alone)", "X's, not Y's";
- "only X has", "not for Y" with no reason after it;
- "held by X".

Keep every sentence that carries a reason or condition (because, unless, if, until, since, as, only if, without, no … was), or that names a benefit Y has no card for in this answer. The generic negations ("does not", "cannot", "is not", "has no") should never trigger a drop on their own.

### R131-2 (medium, fix in this round): a swapped twin drops the named row's own conditions (from reading the code)
`checkedRow` swaps a refused named row for a twin with the same figure, benefit and cover from another document. The twin is built with only its own `o.conditions`. Conditions the named row's document prints, from `named.conditions` and the model's conditions quoting that document, are not carried over. When only the refused document prints a condition (a stay length, or proof needed), the card shows the amount without it. This is the same kind of hole as R126-2, in the other direction.

**Fix:** give the twin both rows' conditions, each kept against its own document's page. Alternatively, refuse the swap when `named.conditions` holds anything the twin's do not.

### Checked and holding
- **(1)/(a) The plan-table Sum Assured read.** It cannot take another row's or another person's cell:
  - It takes only the **first row** under a header with exactly one Sum Assured column. Any amount line between the header and the row refuses it, so a rider or "Death Benefit 5,000.00" second row is never read.
  - The row name must hold every word of the wording's heading, and no other word but the product's own name (or a server label).
  - The page must name the person and no other life (`otherLife`).
  - Searching is limited to the wording's document, or the base's document when the policy number matches.
  - Every matching row must print the same sum, and it must equal the model's base.
  - The card stays on the wording's page, so its conditions are read there, and the basis line names the person, the sum, the document and the page.
  - All my R126–R130 probes are still refused. Tests 59/59.
- **(3)/(c) Per child.** `perUnit` only appends the printed words ("per child (up to 2 children)") to the server's label. Nothing multiplies or adds it: the amount stays the printed figure, one card.
- **(5) First-year premium.**
  - It is taken only when the premium's page prints exactly one first-year line, ending in a figure with two decimals, with no other life on the page.
  - It uses the premium's own currency (`premiumCurrency`, so it can show "Currency not stated").
  - It is labelled "(first policy year only)" and shown after the premium, never as an alternative and never added to it.
- **(4) Library claims.** Counts are held to the number of documents linked to the person; "uploaded for" / "linked to" claims are held to the record. These are prose-only changes with no amount risk.
- **H8 policy-number prose.** A number is skipped by the money filter only when the sentence calls it by the label the documents print it under. That is narrow enough.

### Low (not blocking)
- **R131-3.** `PREMIUM_DECIDES` drops any statement mentioning a premium together with decides / determines / "to rely on". A true fact such as "the premium is waived if the insurer determines you are disabled" (the Premium Waiver, D1 p30) would vanish whole, hiding a documented benefit. Narrow it to "decides which premium" or a premium amount that "applies".
- **R131-4.** A count sentence with a qualifier ("Desmond has 2 travel documents") is replaced with his total linked count ("Desmond has 5 documents linked"), which changes what was said. Skip sentences with a word between the number and "documents" that is not a count word.

### Tests (run locally, free)
- benefit-table chat-test: 59/59
- headline-test: 13/13
- benefit-table test: 105/105

## Round 132: PR #104 at c9ae1f8 (delta from d21672e)

**Verdict: READY.** R131-1 to R131-4 are fixed. No new findings.

### R131-1: fixed
A sentence is now dropped only when it uses ownership or exclusivity wording ("belongs/held by/owns", "X's alone/cover/policy … not Y", "only X has/is covered", "belongs only to X"). Any sentence with a reason or condition word is never dropped.

My R131 probe, re-run in `scratchpad/r132/scripts/benefit-table/probe.ts`:

| Sentence | Result |
|---|---|
| "…because no ambulance was used" | kept |
| "…because a hairline crack is not a listed fracture" | kept |
| "…unless she stays in hospital for 24 hours" | kept |
| "…no cover under the travel policy" | kept |
| "…only for Lim, not Tan, because …" | kept |
| "They belong to Lim, not Tan Mei Ling." | dropped |
| "Only Lim has this cover." | dropped |
| "This is Lim's alone." | dropped |
| "Tan has no hip benefit; it is Lim's cover, not Tan's." (Tan's own hip card is shown) | dropped |

All the drops are false claims about who holds a cover, which is what this check is for. Nothing that limits or refuses a benefit is removed.

### R131-2: fixed
When `checkedRow` swaps in a twin, the named row's table conditions that are not printed on the twin's page are carried over. Each becomes its own point ("<benefit> also depends on this: …") quoting the named row's document. A carried condition that states money blocks the swap, so the refusal stands.

### R131-3: fixed
`PREMIUM_DECIDES` now needs "decides which/what", "decides if they differ or apply", "which premium applies" or "to rely on". A test shows a Premium Waiver statement is kept.

### R131-4: fixed
`DOC_COUNT` matches only a plain count ("four documents", "3 uploaded files"). "Two travel documents" is left alone.

### Tests (run locally, free)
- benefit-table chat-test: 59/59
- headline-test: 13/13
- benefit-table test: 105/105

## Round 133: PR #104 at 202b8f1 (delta from c9ae1f8)

**Verdict: READY.** No findings. Every change in this delta makes the code refuse or drop less often than before, or refuse where it used to accept.

- **Plan Sum Assured read.** Two new cases are refused:
  - Any line with no tab between the header and the row (for example, a rider's name printed above its cells).
  - A row name or product name that carries a rider word.

  Both only add refusals.
- **Ownership filter.** It is now held to the cover or policy the sentence names, so it drops fewer sentences. My R131/R132 probe is unchanged: the 5 sentences with a reason or condition are kept, and the 4 ownership claims are dropped.
- **Claim questions.** "File a claim" questions are no longer treated as library questions. An unquoted point in such an answer is now dropped as unquoted, instead of being replaced with a library-record line.
- **Earlier probes.** All my R126–R130 cases for the "100% of the sum insured" fallback are still refused. The one-benefit positive case still shows S$50,000, now with the fuller basis line.

### Tests (run locally, free)
- benefit-table chat-test: 59/59
- headline-test: 13/13
- benefit-table test: 105/105

## Round 134: PR #105 at 086b123 (round 5, diff vs main)

**Verdict: NOT READY. One blocker (R134-1).**

### R134-1 (blocker): `pointedRows` turns "this amount is not payable" into a card
`pointedRows` (`chat.ts`) turns any non-amount statement that matches `AMOUNT_POINTER` into an extra amount card. It does this whenever the statement's quote is one row's own line, whatever the sentence says about that amount. It never checks whether the pointer is positive.

My probe used the test's own `run` helper and the ambulance line "Ambulance Cost Up to S$500 per incident" (D2), with the bottom line "Not covered.":

| The model's fact | Result |
|---|---|
| "No ambulance was used, so this amount is not payable." | **card: Lim, Up to S$500** |
| "This amount does not apply, because the policy ended before the accident." | **card: Lim, Up to S$500** |
| "That limit is for Tan Mei Ling's policy only." (person: Lim) | **card: Lim, Up to S$500** |

The answer says "Not covered" and then shows a payable-looking card. That breaks the prompt's own rule ("Give no amount for a cover whose terms … this event does not meet"). The card is labelled, but a card for an amount the answer itself says does not apply amounts to a wrong claimable amount.

**Fix:** give a pointed row only when both of these hold:
- The pointing clause is positive: "shows / gives / is / pays this amount", "the amount below".
- The statement has no negation or refusal word: not, no, never, n't, does not apply, not payable, excluded, ended, expired, only for, instead.

Also skip it when the bottom line says the event is not covered or not shown to be covered. Otherwise drop the pointing words as `dropAmountPointers` already does. Add these three sentences as tests.

### Checked and holding
- **awayConditions.** The model's condition becomes a separate point quoting the sibling's document only when all of these hold:
  - it is not printed on the row's own page;
  - it applies at the sibling row (`conditionApplies` checks the section and footnote mark, as tested since R62-1);
  - its first place in that document is the sibling's own page;
  - its text states no money.

  The sibling must have the same person, cover, qualifier and benefit, in another document. The point is extra wording, never moved onto a card, so it cannot raise an amount. Shown once with no person when carried for two people: fine.

  Low note: only the condition's *text* is checked for money, not its quote. That is harmless, because the point shows the model's text through the money filter, and the quote is only located.
- **lesserOf.** It only adds wording that narrows the payout ("the cost, up to this limit, whichever is less") to an up_to row whose own line, or a same-figure sibling's line, says so. It never changes an amount.
- **dropAmountPointers.** It runs only when no card is shown, and removes only the pointing clause. The tests cover "these sums insured" staying, and a pointer whose first clause is the whole sentence being dropped.

### Tests (run locally, free)
- benefit-table chat-test: 61/61
- headline-test: 13/13
- benefit-table test: 105/105

## Round 135: PR #105 at 003a4fc (delta from 086b123)

**Verdict: READY.** R134-1 is fixed.

`pointedRows` now gives a card from a point only when all three hold:
- the point says the amount is shown (`POSITIVE_POINTER`);
- the point has no word saying it is not paid, does not apply or is someone else's (`NOT_PAID`);
- the point names no household member other than the person it is about.

Any other pointing point loses its pointing words.

I re-ran the probe (`scratchpad/r135/scripts/benefit-table/probe.ts`) with the bottom line "Not covered.":

| Point | Result |
|---|---|
| "No ambulance was used, so this amount is not payable." | no card; "No ambulance was used." |
| "This amount does not apply, because the policy ended…" | no card; dropped |
| "That limit is for Tan Mei Ling's policy only." | no card; dropped |
| "The policy has ended. The scheme terms show this amount." | no card; "The policy has ended." |
| "Tan Mei Ling's terms show this amount." (person Lim) | no card; dropped |
| "If it was an emergency, the scheme terms show this amount." | card Up to S$500, with the point kept beside it |

**Bottom-line rule: not needed.** I accept the reasoning. The B7 card is the printed term, shown with its "if" condition, under a "not shown to be covered" bottom line. Each of my probes is now stopped by the refusal inside its own sentence.

### R135-1 (low, not blocking)
On a converted point, the "if" clause stays in the point's own text. It goes onto the card only when the model also listed it as a condition. To keep it attached to the figure, consider copying a leading "if …" clause into the card's conditions.

A refused point whose refusal and pointer sit in one clause is dropped whole, for example "the terms show this amount, payable only if an ambulance was needed". The condition goes with it, but so does any card, so nothing is overstated.

### Tests (run locally, free)
- benefit-table chat-test: 61/61
- headline-test: 13/13
- benefit-table test: 105/105

## Round 136: PR #105 at 66bd9cc (delta from 003a4fc)

**Verdict: READY.**

### Y13
A point that says something about "this amount" without saying it is shown is now kept, reworded to be about the benefit. The rewording happens only on paths that make no card (`withoutPointer`), so it cannot add an amount.

I re-ran my R134 and R135 probe:

| Point | Now reads |
|---|---|
| "No ambulance was used, so this amount is not payable." | "…so this benefit is not payable." |
| "This amount does not apply, because the policy ended…" | "This benefit does not apply, because…" |

Both refusals now survive instead of being dropped, which is better than R135. The conditional B7-style card is unchanged. No refusal or other-person point makes a card.

### W3
A footnote mark must now match exactly: a "*" condition no longer attaches to a "**" row. This only tightens matching.

### R136-1 (low, not blocking)
"That limit is for Tan Mei Ling's policy only." in Lim's answer is now kept as "That benefit is for Tan Mei Ling's policy only." It used to be dropped.

No card goes with it, but it is the ownership kind of claim from C5. `dropPeopleShutOut` misses it because "<Y>'s policy only" with no "not <X>" is not one of its patterns. One fix is to add "<X>'s (cover|policy) only" / "for <X>'s … only" to the exclusivity patterns.

### Tests (run locally, free)
- benefit-table chat-test: 61/61
- headline-test: 13/13
- benefit-table test: 105/105

## Round 137: PR #105 at 6a46183 (delta from 66bd9cc)

**Verdict: NOT READY. One small blocker (R137-1), a one-line fix.**

### R137-1 (blocker, same class as R131-1): the new "X's … only" pattern drops a true payee rule
The R136-1 fix adds `X's (up to two words) only` to the exclusivity patterns. Because any two words may come between "X's" and "only", it also matches true rules that are not about who owns a cover.

I re-ran the shut-out probe with Tan's hip card shown:

| Sentence | Result |
|---|---|
| "It is paid to Tan Mei Ling's estate only." | **dropped** |
| "Tan Mei Ling can claim this only once." | kept |
| The 5 reason or condition sentences from R131 | kept |
| The 4 ownership claims | dropped |

Whom a claim is paid to is a printed rule; the H10 payee pages are sent for exactly this. Dropping it hides a documented condition.

**Fix:** limit the words in between to cover words only: `X's (?:[a-z]+\s+)?(?:cover|policy|policies|plan|benefit)s?\s+only`. "That benefit is for Lim's policy only" is still dropped, and "Tan's estate only" is kept. Add the estate sentence as a test.

### Tests (run locally, free)
- benefit-table chat-test: 61/61

## Round 138: PR #105 at 9b1e0f6 (delta from 6a46183)

**Verdict: READY.** R137-1 is fixed. The pattern is now limited to cover words (`X's [word] cover/policy/plan/benefit only`).

I re-ran the shut-out probe:
- "It is paid to Tan Mei Ling's estate only" is kept.
- "Can claim this only once" is kept.
- The 5 sentences that give a reason or condition are kept.
- The 4 ownership claims are dropped.
- The chat-test case "That benefit is for Lim's policy only" is still dropped.

### Tests (run locally, free)
- benefit-table chat-test: 61/61
- headline-test: 13/13
- benefit-table test: 105/105

## Round 139: PR #105 at 8c19160 (delta from 9b1e0f6)

**Verdict: READY.** For TE O2, "X's … cover/policy/plan/benefit only" now needs "only" to end its clause. That only tightens what is dropped.

My probe results are unchanged:
- The 5 sentences that give a reason or condition are kept, along with "estate only" and "only once".
- The 4 ownership claims and "That cover is Lim's policy only." are dropped.

### Low (pre-existing, not from this delta)
"It is Lim's policy only, so Tan Mei Ling cannot use it." is kept. The exclusivity branch skips any sentence that also names the shut-out person. It carries no amount, so it does not block.

### Tests
- benefit-table chat-test: 61/61

## Round 140: PR #107 at 6aca18b (round 6, diff vs main 3364af3)

**Verdict: NOT READY. One blocker (R140-1) and one medium finding (R140-2).** Both remove information the documents support. Neither shows a wrong amount.

### R140-1 (blocker): rule 1 drops cards the answer says may still pay
`NOT_FIT` includes "not shown to be covered/paid/payable". That is the phrase for missing information, which is not an exclusion. `saysNotFit` drops a row whenever the not-fit *sentence* uses any of the row's distinctive words anywhere in it. That covers the "could still pay" clause and the "if it turns out" clause too.

Probe: `scratchpad/r140/scripts/benefit-table/probe.ts`, using the test's own `run` helper.

| Bottom line or point | Card |
|---|---|
| "A ligament tear is not shown to be covered by the fracture benefits, but **the ambulance cost could still be paid** if an ambulance was needed." | **Ambulance dropped** |
| "The ambulance cost is not shown to be covered **unless** an ambulance took her to hospital." | **dropped** |
| "The ankle benefit is not shown to be payable **yet because the X-ray result is pending**." | **dropped** |
| B7 wording: "Not shown to be covered as a claim for a back strain; **if it turns out to be a full break of the spine**, the Product Summary shows this amount." (Neck, Skull or Spine row) | **dropped**. This undoes R134/R135, where this card was agreed as correct. |
| "…the hip benefit is not shown to be payable…" | kept, but only because "hip" has fewer than 4 letters |

Each dropped card is a documented benefit hidden by the answer's own hedge. The prompt itself asks for these "could still pay" facts after a "Not shown to be covered" bottom line.

**Fix:**
1. Take the "not shown to be covered/paid/payable" phrases out of `NOT_FIT`. Keep only list-membership wording: "not on/among/one of its list", "not named among", "may not fall under", "would not necessarily meet".
2. Match the row's words only inside the same **clause** as the not-fit phrase, not anywhere in the sentence.
3. Never drop when that clause or sentence carries a positive or conditional for the row: could/may/would still, if, unless, until, pending, yet, but.

The H2 test ("Living Care Plus … so a heart attack may not fall under it") and the diabetes and list tests still pass under all three.

### R140-2 (medium, fix in this round): `withoutOrphans` drops a real condition sentence with its money sentence
Probe: `probe2.ts`, uncertainty text "The ambulance limit is S$500 per incident. It is paid only if the ambulance takes her to a hospital within 24 hours of the accident."

Both sentences go: the first because it states money, the second as an "orphan". The second is a printed condition. It is lost unless the model also put it on the card.

**Fix:** never drop as an orphan a sentence that carries a condition word (only if, unless, provided, within, subject to, must, after, before, until, waiting, exclu…). Alternatively, keep it and replace the leading pronoun with the benefit's name.

### Checked and holding
- **Rule 2:** `PERIOD_ROW` rows are never put in an alternative group. Only the grouping changes; the amounts do not.
- **Rule 3:** `LINKED_COUNT` checks "N are linked to X (and Y) (only)" against the library record. If it is wrong, it replaces the sentence with the server's own breakdown. This is prose only.
- **Rule 4b:** with no amount shown, "different figures / not a total" sentences are dropped. Nothing they refer to is shown, so this is correct.
- **No left-out-amount note** for a not-fit refusal: correct, once R140-1 narrows what counts as not-fit.
- **Rule 1 does miss** "X is not covered by <cover>" (plain "not covered"). That is the same behaviour as before this PR, so not a regression.

### Tests (run locally, free)
- benefit-table chat-test: 63/63
- headline-test: 13/13
- benefit-table test: 105/105

## R141: PR #107 re-review at db703c8 (diff 6aca18b..db703c8)

**Verdict: NOT READY, one fix.** R140-1 and R140-2 are fixed. But the sentence-wide "but" door now lets the H2 failure type through again, with the most natural wording. That fault is partly mine: R140 fix item 3 listed "but" as a door word. That was too broad.

### R141-1 (high, blocking): a sentence-wide "but" keeps the Living Care Plus S$300,000 card for a heart attack
`lib/benefit-table/chat.ts` `saidNotToFit`: `if (!m || STILL_OPEN.test(x)) return;` checks door words against the **whole sentence**, and `STILL_OPEN` includes `but`. So any contrast with another cover keeps the refused cover's card.

| Model text (R901 Living Care + R902 Living Care Plus named) | db703c8 | right |
|---|---|---|
| "A heart attack is not one of the 10 early illnesses on the Living Care Plus list, but Living Care covers it." (bottom line) | LC **and LCP** | LC only |
| "Heart attack is not on the Living Care Plus list, but Living Care pays its sum insured." | LC **and LCP** | LC only |
| "Stroke is not on the Living Care Plus list, but it is on the Living Care list." | LC **and LCP** | LC only |
| "Heart attack is not on the Living Care Plus list; Living Care pays it." | LC | LC |

The answer says the cover does not fit, yet shows its S$300,000 card. That is a wrong claimable amount, the worst bug. (At 6aca18b these sentences dropped **both** cards, so neither commit is right yet.)

**Fix (tested in a scratch copy):** check door words only inside the not-fit **clause**, and leave "but" out of the list:
```ts
const STILL_OPEN_CLAUSE = /\b(?:still|unless|until|pending|yet)\b/i;
// in saidNotToFit: drop the sentence-wide STILL_OPEN test, then
if (/\bif\b/i.test(clause) || STILL_OPEN_CLAUSE.test(clause)) return;
```
"but" is not a clause splitter, so "not on the list but could still be covered if …" stays one clause and is still kept (it has "still" and "if").

With this patch:
- chat-test passes 63/63, headline-test 13/13 and table 105/105.
- All five R140 cases keep their cards, and so does the B7 spine card.
- The H2, diabetes and "not one of its 10 early illnesses" cases still refuse.
- All four rows in the table above give LC only.

Please add the first two rows as tests.

### R140-1: fixed
`NOT_FIT` now uses list wording only. The row is matched in the not-fit clause, and the sentence is read whole only when the clause uses a pronoun. Probes (`r141/scripts/benefit-table/probe.ts`) keep these cards:
- the "could still be paid" ambulance card;
- the "unless" card;
- the two X-ray-pending cards;
- the "if it turns out to be a broken hip" card;
- the "knee is not on its list" ankle card;
- the B7 spine card.

"Living Care Plus will not pay, because a heart attack is not one of its 10 early illnesses" refuses LCP and keeps LC, which is correct.

### R140-2: fixed
"It is paid only if the ambulance takes her to a hospital within 24 hours of the accident." is now kept after its money sentence is dropped.

Low, note only: `STATES_CONDITION` also matches "not covered", "after" and "before". So a sentence like "It is not covered." can stay after the sentence it points to is dropped. It reads oddly but shows no amount. No change needed this round.

### Tests (run locally, free)
- At db703c8: chat-test 63/63, headline-test 13/13, benefit-table test 105/105.

## R142: PR #107 re-review at d8f0181 (diff db703c8..d8f0181)

**Verdict: NOT READY, two small fixes in the same function (patch tested below).** R141-1 is fixed: "not on the LCP list, but Living Care pays" now shows Living Care only. But "but" as a clause splitter opens two new holes.

### R142-1 (high, blocking): a pronoun clause still reads the whole sentence, including the "but Living Care …" part
`saidNotToFit`: when the not-fit clause uses a pronoun, `context` is the **whole sentence**. That includes the contrast clause after "but", which names the other cover. Probes (`r142/scripts/benefit-table/probe.ts`):

| Model fact (LC R901 + LCP R902 named) | d8f0181 | right |
|---|---|---|
| "Living Care Plus only pays for 10 early illnesses, so a heart attack may not fall under it, but Living Care covers it." | **no cards** | LC |
| "Living Care Plus covers 10 early illnesses. A heart attack is not on its list, but Living Care pays." | **LCP only** | LC |
| "Living Care Plus covers 10 early illnesses. It is not on its list, but Living Care pays." | **no cards** | LC |

- The first row is the existing H2 test wording plus a natural ", but Living Care covers it": the right cover is hidden.
- The second row is inverted. The right card is hidden and the S$300,000 LCP card is shown: a wrong claimable amount.

**Fix:** for a pronoun clause, read the sentence only **up to the end of the not-fit clause** (plus the sentence before it when it leans back), never the clauses after it.

### R142-2 (medium): a hedge about the same cover after "but" is now refused
| Model fact | d8f0181 | right |
|---|---|---|
| "Heart attack is not on the Living Care Plus list, but it may still be covered if it is diagnosed at an early stage." | LC only | LC + LCP |
| "A mild heart attack is not on the Living Care Plus list as worded, but the insurer may still accept it." | LC only | LC + LCP |
| "Heart attack is not named among the Living Care Plus illnesses, but it could be paid if it meets the early-stage definition." | LC only | LC + LCP |

The answer itself says Living Care Plus could still pay, so dropping its card hides a documented benefit. Before d8f0181, "but" did not split, so the door words kept these cards.

**Fix:** also keep the card when a "but" clause right after the not-fit clause starts with it/this/that/they/the insurer **and** has "if" or a door word. "Stroke is not on the LCP list, but it is on the LC list" still refuses LCP, because it has no door word.

### Patch for both (tested in a scratch copy of d8f0181)
```diff
       if (/\bif\b/i.test(clause) || STILL_OPEN.test(clause)) return;
-      const context = LEANS_BACK.test(x.trim()) && i ? `${all[i - 1]} ${x}` : x;
+      // "…, but it may still be covered if …": a "but" clause about the same thing (a pronoun, the insurer) that keeps a door open.
+      const after = x.slice(pos + clause.length).match(/^[\s,;]*but\b([^,;:]*)/i)?.[1] ?? "";
+      if (/^\s*(?:it|this|that|they|the\s+insurer)\b/i.test(after) && (/\bif\b/i.test(after) || STILL_OPEN.test(after))) return;
+      const upTo = x.slice(0, pos + clause.length);
+      const context = LEANS_BACK.test(x.trim()) && i ? `${all[i - 1]} ${upTo}` : upTo;
```

With it:
- chat 63/63, headline 13/13 and table 105/105 pass.
- The three R141 "but" sentences, "but Living Care pays" with no comma, and the two-sentence version all give LC only.
- The H2 wording plus ", but Living Care covers it" gives LC only.
- All three hedges above keep both cards.
- The R140 ambulance case, the X-ray case and the B7 spine card keep their cards.

**Left open (low):** "Living Care Plus covers 10 early illnesses. A heart attack is not on its list, but Living Care pays." keeps both cards with the patch. The clause does not lean back, so "its" is not resolved. This fails open. That is no worse than before #107, and the prompt is still the main guard. Please add the R142-1 rows and the first R142-2 row as tests.

### Tests (run locally, free)
- At d8f0181: chat-test 63/63, headline-test 13/13, benefit-table test 105/105.

## R143: PR #107 at 3ba746b (new rule 1: per-card eventFit)

**Verdict: no blocker. The design is right. Two small fixes are recommended this round.** R140 to R142 are superseded. Moving the list decision out of prose matching and onto a per-card flag removes the whole class of wording bugs from R140 to R142.

### What I checked
- **The drop is placed correctly.** `amountsFromRows` drops a `not_on_list` card after `checkedRow`, so a twin swap cannot dodge it. The drop also comes before companions are built, so the other document's twin of that row is never added.
- **The schema** (`TABLE_ANSWER_SCHEMA`) requires `eventFit` on every statement. The value can be null or one of 4 enum values. This is fine for the Anthropic `json_schema` format in `model.ts`.
- **The prompt line** sits in `renderTable`, next to the rows it governs. It also tells the model to say in a fact that the event is not on the list.
- **The free tests at 3ba746b pass:** chat-test 63/63, headline-test 13/13, benefit-table test 105/105.

### On "should a missing or unknown flag fail open?" — yes, keep it failing open
- **Live answers always carry the key**, because the schema requires it. Only null can still occur.
- **Failing closed on null** would hide every card for a row that is not a list cover whenever the model leaves the flag empty. That hides documented benefits, which is a failure under the project rules.
- **Failing open is also the floor before #107.** It is no worse than main, and old recordings replay unchanged.
- **Suggestion (no fix needed):** record in `report` when a card comes with a null `eventFit`, so the next paid sweep can count how often it happens.

### R143-1 (medium, fix this round): a card made from a pointer bypasses the gate
`pointedRows` turns a fact such as "the Product Summary shows this amount" into an amount card, copying the fact's fields. The prompt asks for `eventFit` only "for every amount statement", so a fact will usually carry `eventFit: null`. A Living Care Plus card made this way would then pass for a heart attack, which is the H2 shape by another route.

**Fix:** change the prompt line to "for every statement that gives a row's amount **or points at one** ('this amount')". `pointedRows` already copies the fact's `eventFit` onto the card, so no code change is needed. Please add one test: a pointer fact carrying `not_on_list` gives no card.

### R143-2 (medium, fix this round): a wrong `not_on_list` hides a cover without a trace
The server trusts the flag and adds no left-out note (`noteLeftOutAmounts` skips `notFit` drops). If the model sets `not_on_list` on a row that is not a list cover, or on the wrong row, that benefit disappears, and nothing tells the user the cover exists.

**Fix:** skip the left-out note for a `notFit` drop only when the kept answer text (the bottom line or a statement) names that cover. Otherwise let the usual left-out-amount line show. In the right case (H2, where the fact says Living Care Plus does not list a heart attack), nothing changes. In the wrong case, the user at least sees that an amount was left out.

### Known limit (not a regression)
U16: the model marks the shoulder fracture rows `on_list` for a dislocation. The gate depends on the model's call, and a missed `not_on_list` fails open, as on main. This is a prompt or unseen-set matter for the next sweep, not a server fix.

## R144: PR #107 re-review at 4e4b43e (diff 3ba746b..4e4b43e)

**Verdict: READY.** R143-1 and R143-2 are fixed. No new blocker.

- **R143-1 fixed.** The prompt now asks for `eventFit` on every statement that gives a row's amount or points at one. `pointedRows` copies the flag onto the card it makes. The new test, a pointer fact marked `not_on_list`, gives no card.
- **R143-2 fixed.** A `not_on_list` drop is marked `notFit`, and so skips the left-out note, only when `namesRow(said, row)` is true. `said` is the bottom line plus the text of non-amount statements, so a dropped card's own text is excluded.
  - `noNumbers` strips "(POLICY NO. 1)" and the code strips the leading "GROUP", so "Living Care Plus" matches the printed cover name.
  - There is a test for the unnamed case, which gets the note.
- **Low, note only.** `namesRow` matches substrings, so "Living Care" is found inside "Living Care Plus". Suppose the model wrongly flagged Living Care `not_on_list` while its text named only Living Care Plus. Living Care would then be hidden with no note. This needs a wrong flag and an unlucky overlap of names. Not worth more code now. If it ever matters, match on whole names (for example, not followed by " plus").
- **Free tests at 4e4b43e:** chat-test 63/63, headline-test 13/13, benefit-table test 105/105.

## R145: PR #107 at 46cd590 (diff 4e4b43e..46cd590, Test Engineer fixes E7, E8b, E8c, L4)

**Verdict: READY still holds.**

- **`ruledOut` is right.** It holds a `not_on_list` row plus its twins: same person, same cover, same qualifier, and `sameBenefit`. It is checked against both the named row and the row `checkedRow` swaps to, and it is excluded from companions. So a ruled-out row can no longer come back as a twin swap, a companion or a repeat name.
- **`namesRow` is right.** It blanks out longer cover names first ("Living Care Plus") before looking for a shorter one ("Living Care"). That closes my R144 low note.
- **Free tests at 46cd590:** chat-test 63/63, headline-test 13/13, benefit-table test 105/105.

### Low, note only
- **Conflicting flags hide the row for the whole answer.** In a two-event question ("heart attack or stroke"), suppose the model gives Living Care Plus `not_on_list` for one event and `on_list` for the other. Its card is then hidden for both events. That errs toward withholding, which meets the project bar, and the answer text still says what it covers. No change needed now. Worth one item in the next unseen sweep.
- **A pointer fact with `not_on_list` but `row: null` is not collected up front.** The card made from it is still dropped by its own flag, so only that row's twins could come back, as a companion of another card for the same benefit. That needs the model to contradict itself. No change needed.

## R146: PR #107 at b4bffaa (diff 46cd590..b4bffaa, Test Engineer E8d)

**Verdict: READY still holds.**

- **`pointedRows` now runs once**, and `ruledOut` is built from its output. A pointer card marked `not_on_list` now rules out its row and that row's twins. This closes my R145 note 2.
- **The loop is unchanged.** It iterates over the same `pointed` array. `pointedRows` builds a new array without changing its input, so reading it twice is safe.
- **`said` is still built from the original statements.** That is still right: a pointer fact's own text stays in `said`.
- **Free tests at b4bffaa:** chat-test 63/63, headline-test 13/13, benefit-table test 105/105.

## R147: PR #108 chat round 7 at 5e84b6a (on main 28f2ca1)

**Verdict: NOT READY. One blocker and one medium, both with a small patch tested below.** You asked whether the figure fallback can put a wrong amount on a card. It can: see R147-1.

### R147-1 (high, blocking): the figure fallback in `rowOfQuote` gives a row's full amount for a quote that works a different amount out from it
The fallback checks only three things: the quote prints one money figure, exactly one of the person's printed rows has that figure, and the two share one non-filler word. A percentage or a multiplier of that figure passes all three. Probes (`r147/scripts/benefit-table/probe.ts`, Lim Ah Kow, no row id):

| Quote | Card at 5e84b6a | Right |
|---|---|---|
| "Overseas ambulance evacuation: 50% of the Ambulance Cost limit of S$500" | **Up to S$500** | S$250, or no card |
| "Hospital cash for ICU: 200% of S$50 per day" | **S$50** | S$100, or no card |
| "Hospital cash for ICU is doubled (2 x S$50 per day)" | **S$50** | S$100, or no card |

These are wrong claimable amounts. The fallback also ignores the quote's document: the same quote marked D3, a document that does not exist, still matched.

On DC's real documents, the same shape is "Terminal illness: 50% of the Death benefit of S$200,000", which would give the Death row's full amount. (In the test fixture, the accident base "Sum insured" row cannot match because its name is all filler words. That is luck, not a guard.)

**Fix (tested):** take the figure path only when the quote prints exactly one number and has no `%` or multiplier word:
```ts
if (figures.length !== 1 || numbersIn(String(raw.quote)).length !== 1 || /%|\b(?:x|times|twice|double[ds]?|half|triple[ds]?|percent)\b/i.test(String(raw.quote))) return undefined;
```
`numbersIn` comes from `./check`, already imported for `CAP_WORDS`.

With the fix:
- All three probes give no card.
- The A6 tests ("Ambulance claims S$500", "Total premium S$73.17" in its shape) still pass.
- chat 66/66, headline 13/13 and table 106/106 pass.

Please add the three rows above as tests.

Low, no change needed: "Ambulance excess S$500 per claim" still gives the ambulance card. The card is the real row with its real amount, so this is not a wrong amount.

### R147-2 (medium, fix this round): with cards shown, `dropAmountPointers` deletes coordination rules about the amount shown
The new cut fires on any clause with AMOUNT_POINTER and DENIES_AMOUNT and no CONDITIONAL word. Real rules about the card match that test:

| Statement next to a shown card | At 5e84b6a |
|---|---|
| "The Advance Payment amount below is not paid in addition to the death benefit." | **deleted** |
| "The amount below is not payable on top of the Advance Payment already paid." | **deleted** |
| "The amounts below don't count towards the yearly limit." | **deleted** |
| "The amounts below for Living Care Plus don't apply." (the U8 target) | deleted, correctly |

Those are the R124-2 coordination rules (Advance Payment balance, not paid on top). Deleting them strips a qualifier, and a household could then add the amounts together.

**Fix (tested):** cut only when the denial **ends its clause**, optionally followed by "here", "to it/this/them/this event" or "for it/this/that/them":
```ts
const DENIES_END = new RegExp(`(?:${DENIES_AMOUNT.source})(?:\\s+(?:here|to\\s+(?:it|this|them|this\\s+event)|for\\s+(?:it|this|that|them)))?\\s*[.!?]?\\s*$`, "i");
const denies = (x: string) => clauses(x).some((c) => AMOUNT_POINTER.test(c) && DENIES_END.test(c) && !CONDITIONAL.test(c));
```
With this:
- The U8 test still passes, and the Living Care Plus row above is still cut.
- The three rule sentences are kept.
- All suites pass.

Please add the first two rows as tests. The full patch for R147-1 and R147-2 is in the Critic scratchpad as `r147-fix.diff`. It is quoted in the relay too.

### Checked and holding
- **Rule 1, first branch** (the quote is the row's own line, for the same person and document, and only one row matches): same shape as the R134 pointer match. Fine.
- **Rule 2, `firstDay`:** "after the 10th day" gives fromDay 11, and `renderTable` now shows from-day and at-most-days.
  - Low: "Hospital cash from day 1 if hospitalised for more than 2 days" would also let a model's fromDay 3 through.
  - It needs a misread plus that wording, and fromDay does not change a shown amount. Note only.
- **Spend limit:**
  - `overSpendCap` runs before `enqueueChat` and returns 429 with SPEND_LIMIT_TEXT.
  - A failed query counts as zero, so it fails open, as before.
  - `customerMessage` lets the text through: it is short and has no system words.
  - `SpendCapReached` is now 429 with the same text. Correct.
- **Prompt "same meaning in different words":** prose only. It only narrows when "they differ" may be said, when figures, days and conditions are the same.
- **The percentage-cap inference left out:** agreed. It is safer than breaking the R95/R96/L22/L23 guards.

### Tests (run locally, free)
- At 5e84b6a: chat-test 66/66, headline-test 13/13, benefit-table test 106/106.

## R148: PR #108 re-review at 58cf8cc (diff 5e84b6a..58cf8cc)

**Verdict: READY.**

- **R147-1 and R147-2 are fixed exactly as patched.** The figure path in `rowOfQuote` now needs a quote with exactly one number and no `%` or multiplier word. `dropAmountPointers` uses `DENIES_END`. `numbersIn` is now imported from `./check`, alongside `CAP_WORDS`.
- **The five probes are now tests.**
- **Free tests at 58cf8cc:** chat-test 66/66, headline-test 13/13, benefit-table test 106/106.
- **The R147 low notes stand, with no change needed:** an excess quote can still give the real row's card, and the `firstDay` edge case remains.

## R149: PR #108 at ee44388 (structural: bind by row id only; startDay; condition pointers kept)

**Verdict: no blocker. Two small fixes are recommended this round (patch tested).** Removing `rowOfQuote` is the right call: cards now bind only by the row id the model names, so the whole R147-1 class is gone. The A6 trade-off (a premium without its id is left out, with a note) is the safe direction.

### R149-1 (medium, fix this round): `startDay` reads a waiting period as the first paid day
`startDay` treats any "after N days" in a per-day row's quote as day N+1. It runs for every `per_day` row, even when the reading gave no fromDay. So "Hospital cash S$50 per day, payable after 30 days of continuous cover." gets **"from day 31"** on the row.

The model reads that row, so it can tell the household the benefit starts on day 31 of the stay. That understates the benefit. The stay card itself is safe: `keepLabelledAmounts` refuses it when the days disagree, and `stayPays` parses the days on its own.

**Fix (tested):** count "after" only as "after the Nth day" (an ordinal and a singular "day"), or as "after N days of hospital/hospitalisation/confinement/stay/admission" or "in hospital":
```ts
for (const m of text.matchAll(/\b(?:after|beyond)\s+(?:the\s+)?(?:first\s+)?(?:(\d+)(?:st|nd|rd|th)\s+day\b|(\d+)\s+(?:consecutive\s+)?days?\s+(?:of\s+(?:hospital\w*|confinement|stay|admission)|in\s+(?:the\s+)?hospital)\b)/gi)) days.add(Number(m[1] ?? m[2]) + 1);
```
With this:
- The B3 quotes still give day 11: "after the 10th day of Hospital stay" and "after 10 days in hospital".
- "after 30 days of continuous cover" gives no day.
- All suites pass.

Low, note only: "payable after 3 days of hospitalisation, backdated to the first day" gives day 4. That understates, and it is rare wording.

### R149-2 (low-medium, fix this round): `ofBenefit` garbles a pointer that has a noun before it
With no card shown, "The Advance Payment amount below is not paid in addition to the death benefit." becomes **"The Advance Payment this benefit is not paid in addition to the death benefit."** The coordination rule survives, but the sentence is broken.

**Fix (tested):** use "this benefit" or "these benefits" only when the match starts with a determiner (the/this/that/these/those). Otherwise use a bare "benefit" or "benefits". The example then reads "The Advance Payment benefit is not paid in addition to the death benefit."

### Checked and holding
- **Binding by row id only.** The `renderTable` line asks for the id even when the figure comes from another document. A missing or unknown id is dropped with the left-out note.
- **`startDay` is used safely.** Two different days give null, and a null day can never lengthen a stay card, because `stayPays` needs exactly one start. A quote with no day keeps the reading's day only when that day is printed.
- **`CONDITION_OF_AMOUNT` behaves as intended:**
  - With cards shown, conditions and coordination rules stay word for word.
  - A bare "The amounts below for Living Care Plus don't apply." is still cut.
  - "This amount is not payable." still reads "This benefit is not payable.", the same as before.
- **Free tests at ee44388:** chat-test 65/65 (the rowOfQuote tests are gone), headline-test 13/13, benefit-table test 106/106. The same counts pass with the patch.

## R150: PR #108 at 21d1f3f (diff ee44388..21d1f3f)

**Verdict: READY.**

- **R149-1 and R149-2 are in, exactly as patched.** Each has a new test: a waiting-period quote gives fromDay null, and the no-card Advance Payment sentence now reads "The Advance Payment benefit …".
- **Free tests at 21d1f3f:** chat-test 65/65, headline-test 13/13, benefit-table test 106/106.
- **The R149 low note stands, with no change needed:** "backdated to the first day" still gives day 4.

## R151: PR #108 at 46f5a10 (diff 21d1f3f..46f5a10, Test Engineer B6 and D8)

**Verdict: READY still holds.**

- **B6:** `startDay` no longer counts "beyond". That only narrows it: a quote that loses its day keeps the reading's printed day, or none, and the stay card still parses on its own.
- **D8:** "cannot" was missing from the negation list in `CONDITION_OF_AMOUNT`, because `n't` does not match "cannot". Adding it is correct.
- **Free tests at 46f5a10:** chat-test 65/65, headline-test 13/13, benefit-table test 106/106.

## R152: PR #108 at a596032 (diff 46f5a10..a596032, Test Engineer: negated "after")

**Verdict: READY still holds.**

- **The change works as described.** A from/after day whose own clause has not/no/never/cannot/n't is skipped. A quote with only such a limit gives null. Probes:

  | Quote | Day |
  |---|---|
  | "Not payable after the 30th day" | null |
  | "S$50 per day from day 1, not payable after the 30th day" | 1 |
  | "No benefit for the first 10 days; payable from the 11th day" | 11 |
  | "S$30 per day from the 11th day onwards. Max: 30 days" | 11 |

- **Low, note only.** A negation in the same clause that is not about the day also blanks the day. "There is no waiting period and payment starts from the 11th day" gives null, and so does "…isn't reduced and is paid from the 4th day". The result is null, which never lengthens a stay card and only drops the row's "from day" text. That is the safe direction.
- **Free tests at a596032:** chat-test 65/65, headline-test 13/13, benefit-table test 106/106.

## R153: PR #109 round 8 at f82ba06 (on main 1032612)

**Verdict: NOT READY. Two blockers and one medium.** Patches for both blockers are tested in a scratch copy (`r153-fix.diff` in the Critic scratchpad, quoted in the relay). Free tests at f82ba06 pass: chat-test 71/71, headline-test 13/13, benefit-table test 106/106.

### R153-1 (high, blocking): the waiting-period backstop hides fracture cards for a whole year
`chatRows` sets `coverSince = c.startDate ?? c.asOf`. `insideWaiting` then hides any `on_list` card whose cover started less than 365 days ago when `waiting` is null. But null is exactly what the prompt asks for when "the cover prints no waiting period".

An accident certificate printed "As of 01/01/2026" is a print date, and a group renewal start is not a first entry. Probe on the test household (Lim Ah Kow, GPA certificate "As of 01/01/2026", today 23/10/2026):

| Card | waiting | Result |
|---|---|---|
| Hip (listed injury), `on_list` | null | **hidden**: "its cover started less than a year ago and no waiting period was checked" |
| Hip, `on_list` | key missing (old recording) | **hidden** |
| Hip, `any_event` | null | shown |

On DC's GPA, this hides the wrist, hip and ankle fracture cards until next January. That hides documented benefits in the core accident questions.

**Fix (tested):** take the backstop only when a page of the row's own document prints "waiting period" **and names the row's cover**:
```ts
const cover = noNumbers(row.cover).replace(/^group\s+/i, "").toLowerCase();
const prints = household.documents[row.docIndex]?.pages.some((p) => /\bwaiting\s+period/i.test(p.text) && p.text.toLowerCase().includes(cover)) ?? false;
if (raw.eventFit === "on_list" && prints && since != null && today - since < LONGEST_WAIT_DAYS) return "…";
```
`insideWaiting` also needs `household` passed in.

With this, all three Hip probes show the card. One test needs its fixture changed: `shown(fresh, null)` in the S023 test uses a "CRITICAL ILLNESS PLAN" row whose document never prints that name next to "Waiting Period". Give it a page that does, or use the "LIVING CARE" cover. I would also drop `?? c.asOf` from `since`, because a print date is not a start date.

### R153-2 (high, blocking): `dailyRateOf` makes per-day cards from rates that belong to something else
The derived row takes **any** single "S$X per/a day" on a limit's line that is below the limit. Probes (the function copied verbatim):

| A limit row's own line | Derived daily card |
|---|---|
| "Hospital Room & Board S$8,000 per policy year; ICU S$200 per day" | **S$200 per day for Room & Board** (the rate is ICU only) |
| "Medical expenses up to S$5,000, subject to an excess of S$100 per day" | **S$100 per day** (that is an excess, not a benefit) |
| "Overseas medical up to S$200,000; hospital allowance S$100 a day" | **S$100 per day for overseas medical** |
| "Up to S$1,000 per trip, S$50 per day for a travel companion" | **S$50 per day** |

Each is a wrong claimable amount under the limit row's name.

**Fix (tested):** count a rate only when a cap word comes right before it (capped at, up to, maximum (of), max, limited to, not exceeding). Return null when the line names ICU, intensive, excess, deductible, co-pay, companion or allowance.

With this:
- The S016 test ("Capped at S$200 per day") still derives S$200.
- "maximum S$300 per day" and "up to S$300 per day, up to S$8,000 per year" still derive S$300.
- All four rows above derive nothing.

Please add the four rows as tests.

### R153-3 (medium, fix this round): a bare day count is taken from any turn once any turn mentions a stay
`stayDaysWritten` now accepts any "N days" in **any** user turn when any turn has stay words. For example: "I was hospitalised. Does the 30 days waiting period matter?" If the model sets `perDay.stayDays` 30, the stay card is worked out for a 30-day stay the household never described.

**Suggested guard:** do not count a bare count followed by waiting, period, ago, since, notice, of cover, to claim or to notify. For example:
```ts
new RegExp(String.raw`\b${n}[\s-]*days?\b(?!\s+(?:waiting|period|ago|since|notice|of\s+cover|to\s+(?:claim|notify)))`, "gi")
```

### Checked and holding
- **`not_described`** rules out the row and its twins like `not_on_list`. The left-out note uses the same `namesRow` rule.
- **Waiting with dates:** `applies` "no" is shown. yes/unsure with a period still running is hidden, and so is one with no usable date. The date is Singapore's. `printedDay` reads day first and only real dates.
- **The daily label** (`rowLabel`) now says the start day and the most days. These come from `startDay`, with the R149 to R152 guards.
- **A stay too short** gives a fact with no money in it, never a S$0 card.
- **`libraryList`** is the library's own record (linked people, superseded documents left out). It only replaces a point that cites no document, in a question about documents.
- **`NOTHING_SHOWN`:** correct.
- **`spouseMeant`**, low, note only. It counts a title before at least 2 words of a member's name, so "Mrs Tan Yi Chuen" (a wife printed under her husband's name) would count for the husband. That would point "my wife" at Desmond if Charmaine is never printed with Mrs/Ms. It is rare in insurance documents. A stricter version would also require the other spouse to be printed with the opposite title.

## R154: PR #109 re-review at 3aea7bc (diff f82ba06..3aea7bc)

**Verdict: READY.**

- **R153-1 fixed.** The backstop fires only when the row's own document has a page that prints "waiting period" and names the cover. My Hip probes are now shown in all four forms (on_list with waiting null, a missing key, any_event, and applies "no"). Keeping `asOf` as the stand-in date is acceptable now: the page-and-cover check is what limits the backstop, and live readings carry no startDate.
- **R153-2 fixed.** A rate counts only when a cap word comes just before it, and a line naming ICU, an excess, a companion or an allowance gives no rate. The four rows are now tests, and S016 still gives 200.
- **R153-3 fixed.** A bare day count followed by waiting, period, ago, since, notice, of cover/the policy, or to claim/notify/tell/inform is not counted.
- **Low note fixed.** A member also printed with the other kind of title settles nothing.
- **Free tests at 3aea7bc:** chat-test 71/71, headline-test 13/13, benefit-table test 106/106.

## R155: PR #109 at c2621b6 (diff 3aea7bc..c2621b6, Test Engineer findings)

**Verdict: READY still holds.** Every change narrows a path or fixes wording.

- **`dailyRateOf`:** a line with its own day rule (from/after/beyond/starting/commencing … day, or "day N") gives no derived row. That only narrows it. "Capped at S$200 per day" (S016) still derives.
- **`stayDaysWritten`:** a turn that names a day rule (within, claim, notify, waiting, period, deadline, submit) gives no bare count. That only narrows it.
- **`spouseMeant`:** a title now needs every one of the member's own name words, and the latest "my husband" or "my wife" decides, because history is newest first.
  - Low, note only: if a document prints only part of a member's name (for example "Mr Tan Yi Chuen" for a member recorded as "Tan Yi Chuen, Desmond"), the spouse note is no longer given and the model asks whose cover is meant. That is the safe direction. It is worth checking against DC's real documents for S048.
- **`aDay`:** gives "An 8-day", "an 11-day" and "an 18-day", and "A" otherwise. Correct for the stay lengths the checks allow (up to 366).
- **Free tests at c2621b6:** chat-test 71/71, headline-test 13/13, benefit-table test 106/106.

## R156: PR #110 chat round 9 at 476516c (on main c098eb7)

**Verdict: NOT READY. One fix (patch tested).** No path in this PR shows a wrong amount or a wrong person. The blocker is a documented benefit hidden on missing information. Free tests at 476516c pass: chat-test 76/76, headline-test 13/13, benefit-table test 106/106.

### R156-1 (high, blocking): an event with no date is taken as today, so a trip card is hidden whenever the trip has ended
`outsidePeriod` uses `printedDay(p.eventOn) ?? today`. The prompt tells the model to give "" when the household did not say a date. So any travel question asked after the trip hides the trip's card with "its cover period ended on …". Two examples:
- S048 itself: "my husband was hospitalised for 15 days with pneumonia". No date was given, and the trip ran 29/09 to 04/10, so the stay may have been during the trip.
- The ordinary travel claim: "I got food poisoning on my trip, how much can I claim?"

Claims are usually asked after the trip, so this hides the travel cover in its most common question. That breaks the standing rule that missing information is not an exclusion.

**Fix (tested):**
1. With no event date, `outsidePeriod` returns null.
2. The card stays and says "Its cover period ended on 04/10/2026, so it pays only for an event on or before that day." This uses the same `periodEnded` note, now also for undated event cards.
3. The prompt's `eventOn` asks for today's date when the household says the event is happening now. An explicit date outside the period (including today's) still hides the card.

The test changes:
- `any_event` with eventOn "" is now shown with that note.
- `any_event` with eventOn "23/10/2026" is hidden.

All suites pass (76/13/106). The patch is in the Critic scratchpad as `r156-fix.diff` and quoted in the relay.

### Checked and holding
- **`asksFor`** (`not_described` shown when the question names the benefit, through `namesRow` or a name head of 2 or more words): it only reverses a model refusal for a row the household named. It changes no amount or person.
- **`NOTHING_SHOWN`** only after an introducing bottom line: fine. Money is stripped from any bottom line anyway.
- **`dropAgreeingDayRules`** acts only when every daily card has the same non-null start and most days, and the sentence states that start at least twice, with every most-days figure the same. A stay length ("for 12 days") breaks the match, so the sentence is kept. Labels are untouched.
  - Low: a sentence that also says something else ("…so 2 days are paid") is dropped whole. The stay card carries that.
- **`periodsNote`** is descriptive only: up to 3 date ranges per document, with ended/running/not started by Singapore date. Low: a range could be a premium or claims window rather than the cover period. The note only says what is printed.
- **The no-event "ended" note:** it is added to the label before the label is recorded, so `keepLabelledAmounts` keeps the card.
- **Schema:** `period` is three plain strings, keeping the API within 16 union parameters (a test guards this).
- **Known gap S088** (the model gives the wrong row id): agreed, out of scope. A word-against-name guard dropping right cards on the 44 is the worse trade.

## R157: PR #110 at e29365d (diff 476516c..e29365d, wrong-row check)

**Verdict: NOT READY.** R156-1 is still open: line 266 is unchanged, `on = printedDay(p.eventOn) ?? today`, so undated trip events are still hidden. My tested patch from R156 still applies. The new wrong-row check is a good idea, with one hole. Free tests at e29365d pass: chat-test 77/77, headline-test 13/13, benefit-table test 106/106.

### R156-1 (high, blocking): still open
Apply the R156 patch:
- `outsidePeriod` returns null with no event date.
- Undated event cards carry "Its cover period ended on X, so it pays only for an event on or before that day."
- The prompt's `eventOn` says "today's date when they say it is happening now".
- The test changes as listed in R156.

### R157-1 (medium, fix this round): `copiedName`'s "one name inside the other" lets a slip between nested names through
Containment of at least two words accepts "Hospital Cash" for an "ICU Hospital Cash" row, and the reverse. Probe (added to the S088 test in a scratch copy):

| row id given | rowBenefit copied | e29365d | right |
|---|---|---|---|
| ICU Hospital Cash | "Hospital Cash" | **shown** (the ICU rate on a hospital-cash answer) | left out |
| Hospital Cash | "ICU Hospital Cash" | **shown** | left out |
| ICU Hospital Cash | "ICU Hospital Cash" | shown | shown |

The same applies to "Accidental Death" against "Accidental Death and Dismemberment", or a base benefit against its "Enhanced …" variant. These are exactly the slips this check exists to stop, and each shows another row's amount.

**Fix (tested):** in place of containment, allow only generic words to differ:
```ts
const core = (t: string) => ` ${t} `.replace(/\s(?:the|benefits?|cover(?:age)?|amount|limit|plan|payment)(?=\s)/g, " ").replace(/\s+/g, " ").trim();
return !!core(a) && core(a) === core(b);
```
With this:
- The existing S088 test still passes, including "child education fund" for "K. Child Education Fund Benefit".
- All three probe rows give the right result.
- chat-test 77/77.

Please add the ICU/Hospital Cash pair as tests.

### Low, note only
Two rows with **identical** benefit names (for example "Hospital cash" on two covers of the same person) still pass a slip between them, because the copied name is the same. A later `rowCover` copy would close it. That is not needed this round.

### Checked and holding
- Cards bound by pointer have `rowBenefit` unset, so they are not checked. That is correct: they are bound by quote.
- An empty `rowBenefit` on an amount drops the card. That is the safe direction, and the prompt says to copy the name exactly.
- A recording with no field (undefined) is not checked, so replays are unchanged.
- The check runs before `checkedRow`, so it judges the row the model named.
- `rowBenefit` is a plain string, so the 16-union limit holds.

## R158: PR #110 at 9a03b85 (diff e29365d..9a03b85)

**Verdict: NOT READY, one fix left.**

- **R156-1 is fixed, exactly as patched.** An undated event is no longer taken as today. Its card says when the period ended. The prompt now asks for today's date for an event happening now. There is a test for an event dated today that falls outside the period.
- **R157-1 is still open.** `copiedName` still accepts one name inside the other when the shorter name has at least 2 words (chat.ts:635). So a slip between "Hospital Cash" and "ICU Hospital Cash" still shows the other row's amount. Apply the R157 `core()` patch and add the ICU/Hospital Cash pair as tests.
- **Free tests at 9a03b85:** chat-test 77/77, headline-test 13/13, benefit-table test 106/106.

## R159: PR #110 at 4ddcd71 (diff 9a03b85..4ddcd71)

**Verdict: READY.**

- **R156-1 is fixed** (in 9a03b85, confirmed in R158).
- **R157-1 is fixed, exactly as patched.** `copiedName` now needs the two names to be equal once generic words are taken out. A slip between ICU Hospital Cash and Hospital Cash is dropped in both directions. The exact name and "Hospital Cash Benefit" are still shown. All four cases are tests.
- **Free tests at 4ddcd71:** chat-test 77/77, headline-test 13/13, benefit-table test 106/106.
- **Low note from R157 stands, with no change needed:** a slip between rows with identical names on different covers still passes.

## R160: PR #110 at f6855ca (diff 4ddcd71..f6855ca, Test Engineer findings)

**Verdict: READY still holds.**

- **K8, `copiedName`:** the `sameBenefit` acceptance is gone, so the section is part of the name. That is stricter, and the failure it adds is a card left out, never a wrong one.
- **A3, `asksFor`:** matches the benefit's own name or name head only, never the cover. That narrows it.
- **N3/N4, `INTRODUCES`:** now matches only wording that points forward. `NOTHING_SHOWN` appears less often, and that line has no money in it.
- **D8/D9, `dayRulesIn`:** it now reads "after 10 days", and a date such as "on 11th October" no longer counts as a day. It only feeds `dropAgreeingDayRules`, which still requires every start and most-days figure to match the cards' one rule.
- **Free tests at f6855ca:** chat-test 77/77, headline-test 13/13, benefit-table test 106/106.

## R161: PR #110 at d223ff2 (diff f6855ca..d223ff2, Test Engineer D11, N5)

**Verdict: READY still holds.** All three changes narrow a check.

- **D11:** "from day 11 to day 60" is read as a range ending on day 60. This only feeds `dropAgreeingDayRules`, which still needs an exact match with the cards' one rule.
- **N5:** `INTRODUCES` matches "below" only at the end of a sentence, and "these are" only when "not" does not follow.
- **`asksFor`:** needs a whole name of at least two words, so "hip" alone no longer counts.
- **Free tests at d223ff2:** chat-test 77/77, headline-test 13/13, benefit-table test 106/106.

## R162 — PR #111 (round 10, head 877dcbd) vs main 762bd83

Free tests on 877dcbd: chat 82/82, headline 13/13, table 106/106.

**Verdict: no blocker. One medium fix (R162-1), three low notes.**

- **R162-1 (medium) `lib/benefit-table/chat.ts:465`** `PREMIUM_ROW = /\bpremiums?\b/i` also matches "Waiver of Premium", "Premium Waiver" and "Return/Refund of Premium". Those are event-paid benefits that can carry a waiting period or cover period, and line 324 now skips both checks for them, so a card could show inside a waiting period or after cover ended. Fix (checked on 7 labels: plain premium rows still exempt, waiver/return/refund not):
  `const PREMIUM_ROW = /^(?!.*\b(?:waiver|waive[sd]?|return|refund)\b).*\bpremiums?\b/i;`
  Suggest one chat-test case: a "Waiver of Premium" row with a waiting period is still held back.
- **Q1 looser copiedName / LIST_MARKS: no wrong-row or wrong-amount path found.** A shortened copy binds only when no other row of that person has the same short name; the only exception is a same-cover, same-qualifier sameBenefit twin, which shows as a companion anyway. A copy that adds a note ("(per child)") is still rejected; premium first-year vs later-year rows stay apart.
  - Low: sameBenefit now equates rows that differ only by a list mark ("1. X" vs "2. X"). ruledOut has no document check, so two such rows in one document could be ruled out together. That withholds, it never shows a wrong amount. Single-letter brackets like "(s)" are also stripped; harmless.
- **Q2 dedupe: cannot hide a different figure.** The skip needs same person, cover, qualifier, sameBenefit, a different document, and sameFigure (same amount and unit). Low: the skipped twin's own carried points/conditions are dropped with it; if the two documents print different conditions, only the first card's show.
- **Low `lib/simple-chat/hook.ts` datesSaidNote:** "24/7", "1/2", "3/4" are read as dd/mm dates (24 Jul, 1 Feb, 3 Apr), adding a wrong "days before today" line. Suggest requiring a year in the slash form, or a lead word (on, since, from, by, dated, until).
- Holds: AMOUNT_POINTER widening (end-of-clause only), points after the card, deadline prompt rule.

## R163 — PR #111 re-check (head 4ea465b)

**Verdict: READY.**

- R162-1 fixed with the suggested PREMIUM_ROW (chat.ts:466) plus a test for waiver/return/refund rows inside a waiting period.
- datesSaidNote: slash dates now need a 4-digit year or a lead word. Probed: "24/7", "3/4 of the bill" give no note; "on 3/4", "on 29/9/2026", "since 1/10/2026" are read right. "on 3/4/26" (2-digit year) gives no note, which is a miss, not a wrong date.
- The two low notes left as is are accepted (both only withhold).
- Free tests on 4ea465b: chat 82/82, headline 13/13, table 106/106.

## R164 — PR #111 re-check (4ea465b..a3e0eba)

**Verdict: READY.** Free tests on a3e0eba: chat 82/82, headline 13/13, table 106/106.

- T5 (chat.ts:352-370): a skipped twin's conditions become fact points quoting the skipped row's own document; money-stating conditions are dropped, and near-repeats (80% of words) of a shown condition are skipped. No amount can come from this path. It only runs once the kept twin was given (same person, cover, qualifier, figure).
- C5 (chat.ts:684-686): a frequency in the copy must equal the row's. Low: synonyms ("annual" vs "yearly", "half-yearly" vs "semi-annual") and a copy with a frequency on a row without one are now rejected. That only withholds.
- M4 (chat.ts:484): stems waiv*/return*/refund* are excluded; plain premium rows still exempt.

## R165 — PR #112 (round 11, head 3f2547b) vs main af79682

Free tests on 3f2547b: chat 86/86, headline 13/13, table 106/106.

**Verdict: NOT READY. Two wrong-row binds (R165-1, R165-2), both reproduced and fixed in a tested patch.**

- **R165-1 (high) one-sided note in `sameBenefit` (chat.ts ~747) opens the copiedName guard.** `others` in copiedName (chat.ts ~701) excludes every sameBenefit row of the same cover and qualifier, *in any document*. With the new rule, "Accidental Death" and "Accidental Death (Public Transport)" are now the same benefit, so a copy "Accidental Death" on the Public Transport row's id passes (the short path strips the note, and the plain row is no longer a rival). Probe on 3f2547b: same document → binds (true); main → false. Same for "Hospital Cash" on the "Hospital Cash (ICU)" row, and across documents. The card then shows the doubled or ICU amount for the plain benefit asked about.
  Fix: the rival exclusion keeps the old strict meaning, and only for another document, as its comment says:
  `&& o.source.documentId !== row.source.documentId && nameParts(o.benefit).core === nameParts(row.benefit).core && sameBenefit(...)`.
- **R165-2 (medium) `quotesRow` accepts a quote that merely contains a short excerpt (chat.ts ~752).** `q.includes(e)` with a bare-amount excerpt ("S$50,000", a table cell) means a long quote about another benefit ("Comatose ... up to S$50,000") binds a Natural Catastrophe row's id when the Comatose row's excerpt is a different line. Probe: true.
  Fix: the longer-quote direction holds only when the excerpt prints one of the row's own name words. The A6 premium quote still binds.
- Patch (both): scratchpad r165-fix.diff. With it: chat 86/86, headline 13/13, table 106/106; all four probes false; A6-style quote true.
- Low: the one-sided note still pairs AD and AD (Public Transport) as cross-document twins (companions, ruledOut). Companions show their own labels and amounts, and dedupe needs the same figure, so this shows an extra card or withholds; it never puts a wrong amount on a label.
- Low: withoutPointer's ", listed below" cut can leave a stray comma ("The amounts, apply only if ..."). Cosmetic.
- Holds: the fit fallback (ties and better rivals reject; "Hospital Cash" vs "ICU Hospital Cash" rejects), the condition merge (same row only, money conditions dropped, quote from the row's own document), the dropped-list filter, and amountLeftOut.

## R166 — PR #112 re-check (3f2547b..6de7b2f)

**Verdict: READY.** R165-1 and R165-2 applied as patched, with a test that fails on 3f2547b. My four probes are false and the A6 quote still binds. Low (b) fixed (", shown below," eats its following comma). Low (a) accepted. Free tests on 6de7b2f: chat 87/87, headline 13/13, table 106/106.

## R167 — PR #112 re-check (6de7b2f..b1e0669)

**Verdict: READY.** Free tests on b1e0669: chat 87/87, headline 13/13, table 106/106. The R165 probes still hold.
- B4 (copy equal to another cover's name rejected): only rejects, and only in the fit fallback. That can withhold, never mis-bind.
- N4 (PERIOD_NOTE turns off the one-sided-note rule): this only narrows pairing. Core-equal names still match as before.
- M1b (away point for a condition only the other document prints): reuses awayConditions (money dropped, quote located in the sibling's document) and the same `away` key dedupe as carried points. It adds no amount.

## R168 — PR #112 re-check (b1e0669..07d14e6)

**Verdict: READY.** B4b only adds rejects in copiedName's fit fallback: policy-type words are dropped before the cover compare, and an empty name is rejected. It can withhold, never mis-bind. Free tests on 07d14e6: chat 87/87, headline 13/13, table 106/106.

## R169 — PR #113 (round 12, head 431c4b6) vs main a02c1da

Free tests on 431c4b6: chat 91/91, headline 13/13, table 106/106.

**Verdict: NOT READY. Four ways to show a wrong amount (R169-1 to R169-4) and one hidden true fact (R169-5), all reproduced. A tested patch fixes all five (scratchpad r169-fix.diff). With it: chat 91, headline 13, table 106, and every probe is fixed.**

- **R169-1 (high) check.ts capInRow takes a cap meant for some insured persons only.** "Accidental Death 100% of Sum Insured (Child: limited to S$50,000)" now gives every adult S$50,000 (probe: worked_out 50000 on S$200,000). "maximum S$200,000 for insured persons above age 70" is also taken as everyone's cap. Fix: no cap from the row when it names a group (child, adult, age/aged, spouse, dependant, above/below/over/under).
  Q1 answer: the changed test expectations (Advance Payment S$400,000, Burns S$5,000, ICU S$25,000 on the continuing line, Hip S$50,000 next line) are sound, and they still pass with the fix.
- **R169-2 (high) chat.ts planTableRows reads every table on the document's pages that has the same plan headings.** A second table "for insured persons aged 70 years and above" (or an annual plan's table) gives "Overseas medical expenses" S$100,000 next to the real S$500,000, plus a 70+ "Personal accident" figure (probe). Name dedupe only checks the reading's own rows. Fix: read only the header block that holds one of this plan's reading rows (its excerpt's first line).
- **R169-3 (high) planTableRows takes a money first cell as the line's name.** "S$500\tS$1,000\tS$1,500\tS$2,000" under three plans becomes "Trip cancellation: S$500", and the Business plan gets S$1,500, shifted one column (probe). Fix: an extra first cell must not be a PLAN_CELL.
- **R169-4 (medium-high) verify.ts stayDaysSaid reads when, not how long.** "admitted 10 days after the accident" gives 10, "admitted 3 days ago" gives 3, and "hospitalised 2 days before the trip ended" gives 2. Now that the server works out a stay when the model gave none, these become worked-out stay totals. Fix: a negative lookahead for ago, after, before, later, earlier, prior, since, from and into.
- **R169-5 (medium) hook.ts dropLateClaims deletes a true "window has passed" fact** whenever any sentence has "until/by/before + a future date". Example: "Your cover runs until 31/12/2026" removes the statement "The 30-day claim window has passed: it ended on 01/09/2026." (probe). Fix: openSaid needs claim/notice/deadline words and no OTHER_PERIOD.
- Process: verify.ts money rules are frozen. The stayPays change (and the R169-4 fix) is a money path in verify.ts, so please confirm DC has said yes to it.
- Low: the capInRow capSource is the row's quote, which may not print the cap when the cap is on the continuing line. At worst verify withholds.
- Holds: stayPays stays limited to rows with one per-day figure equal to the card, one start rule and one max (lump sums cannot pass). claimWindows and datesSaidNote "yesterday / N days ago" hold, NRIC masking holds, and the prompt rules hold.

## R170 — PR #113 re-check (431c4b6..0c5c151)

**Verdict: READY.** check.ts, verify.ts and hook.ts match the R169 patch byte for byte. chat.ts matches too, except the header test is pulled into a `heading()` helper, which behaves the same. Tests were added for all five items. Free tests on 0c5c151: chat 91/91, headline 13/13, table 107/107. Process: accepted. DC's 06:47Z "ok" on fix-list group 3d covers the per-day stay change.

## R171 — PR #113 re-check (0c5c151..489d55a)

Free tests on 489d55a: chat 93/93, headline 13/13, table 107/107.

**Verdict: NOT READY. One wrong-amount path (R171-1), reproduced. A tested patch is in scratchpad r171-fix.diff.**

- **R171-1 (high) chat.ts planTableRows: PLAN_CELL now accepts footnote marks ("S$2,000*") but drops what the footnote says.** A page with "Personal accident / S$50,000^ S$100,000^ S$150,000^" and "^ Limited to S$25,000 for children." gives a child S$100,000. "* Reduced to 50% for insured persons aged 70 years and above." under medical gives a 70+ person S$500,000 (probe). Each row has conditions [], so the qualifier is stripped.
  Fix: a marked cell gives a row only when the page prints that footnote and the footnote names no group, limit or share (no digits; no child/adult/age/senior/family/spouse/reduced/limited/sub-limit/max/per/each). The footnote then goes with the row as its condition. With the patch, both probes give no row, a benign footnote ("* Pre-existing conditions are excluded.") gives the row with that condition, and the existing P7 case ("S$2,000*" with no footnote on the page) now gives none. That one expectation needs to change to [] (or the test can add a benign footnote line). A missing card is acceptable; a wrong one is not.
- Holds: capInRow (excess, per-day, NEAR_CAP all only withhold); the plan-table end on a foreign heading or optional line; adult/child inline lines skipped; the cell's own currency (a bare "$" keeps the template's currency, as before); the label-below rule; stayDaysSaid (my R169 probes still null; "for 12 days after the fall" = 12; a second "for N days" makes it unclear); claimWindows exclusions; dropLateClaims whose-claim check (only keeps more); the yesterday skip removal (the alternation already consumes "day before yesterday").

## R172 — PR #113 re-check (489d55a..3ffce25)

**Verdict: READY.** chat.ts is byte-identical to the R171 patch. Tests cover no footnote, the child footnote and the 70+ footnote; P7 now has a benign footnote. Free tests on 3ffce25: chat 93/93, headline 13/13, table 107/107.

## R173 — PR #113 re-check (3ffce25..76a25e4)

Free tests on 76a25e4: chat 94/94, headline 13/13, table 107/107.

**Verdict: NOT READY. One fix (R173-1): a label drops the plan name. A tested patch is in scratchpad r173-fix.diff.**

- **R173-1 (medium) coverLabels `repeats` uses a substring test in both directions, so the plan is dropped whenever it *contains* the cover name.** Probes: cover "Travel Insurance", plan "Travel Insurance Premier" → "Travel Insurance". Cover "Hospital & Surgical", plan "Hospital & Surgical (Plan 2)" → "Hospital & Surgical" (noNumbers also removes the 2). The amount is still the plan's, but the card no longer names the plan, which breaks "never strip a qualifier".
  Fix: a plan or product is left out only when all of its words are already shown, except one word that is the product's first word (the insurer, as in "AIA"). With the patch: AIA → "PRO LIFETIME PROTECTOR - MAX" (test still passes); Travel/Plan 2 keep their plan; chat 94, headline 13.
- Holds: the group-name and plan-footnote skips in planTableRows (they only skip); "for each day" per-unit in capInRow (only withholds); claimWindows (sentence scope, starts/diagnosed excluded; note only); the dropLateClaims "deadline for X" (only keeps more); the stayDaysSaid second length (only withholds; "within 30 days" and "3 days ago" are not counted).

## R174 — PR #113 re-check (76a25e4..c3c110b)

**Verdict: READY.** chat.ts is byte-identical to the R173 patch, with tests for Travel Premier and Plan 2. H1 (stayDaysSaid ignores "N days to claim" and a waiting period as a second length) only narrows. My R169 probes still give null; "stayed 4 days" gives 4. Free tests on c3c110b: chat 94/94, headline 13/13, table 107/107.

## R175 — Upload check, early review (patch series 14c0507 + f89e0ac on a02c1da)

Probes ran with tsx against the applied series. v11-ingestion-regressions needs the DB stack, so I could not run it here; I relied on the author's run.

**Verdict: NOT READY. One high fix (R175-1, tested) and one design gap (R175-2).**

- **R175-1 (high) layout-check.ts `FIGURE` only counts two-decimal or comma-grouped numbers.** "S$300", "S$500", "25%" are ignored, so readingsAgree passes a suspect page whose text pairs them differently from the image. Probe: text "Ambulance S$300 / Hospital cash S$500 per day / Coma 25%", image "Ambulance S$500 / Hospital cash S$300 / Coma 50%" gives agree:true, and the text (wrong pairing) is kept. This is exactly the wrong-label case the gate exists for.
  Fix: FIGURE = every number, /\d[\d,]*(?:\.\d+)?/g. With it, the swap is refused ("the image reading does not print 300 beside ambulance") and an agreeing glued page still agrees. A stricter check can only leave more pages unchecked.
- **R175-2 (medium, design) the second reading starts only on visible signs (glued figures, or labels before values).** A layout that pairs a label with the next row's figure, with no glue and no label run, is never checked, which was the second trigger in the plan ("a schedule where most amounts fail the source check"). Suggest also checking a personal document's pages that hold coverages with evidenceVerified=false, or benefit-table rows dropped for "quote not found", once per document.
- Low: numbersIn now skips any figure with three or more decimals ("1.375" matches /\.\d{2}\d/), which withholds such rates. Better to require a comma group or a currency before it.
- Low: lineFrom splits "01.01" from "2024" when a date's items touch. That's harmless for amounts.
- Low: an unchecked page gives the chat a placeholder, so the policy name, number and in-force status printed there are hidden too. That's acceptable as a withhold, but the household may see the policy as missing. Consider keeping lines that hold no figure.
- Holds: the label:value merge (≥3 colon labels, ≥60% of the left band, ≥80% of values beside them); bare-figure value columns merged only when every line sits beside a label; the text is kept and only confirmed (never replaced); unchecked pages are left out of the table reading (service.ts) and the fact check; needs_review plus the "Read in part" message, including unverified coverages; clean pages make no paid call.

## R176 — PR #114 upload check (head 5ef852d on main 2435418)

Probes ran with tsx against 5ef852d. I could not run v11-ingestion here (DB stack).

**Verdict: NOT READY. Unchecked pages still feed three writers (R176-1), and the chat still sees bare amounts on them (R176-2, patch tested).**

- **R176-1 (high) lib/rag/ingest.ts: only the fact check, the benefit table (service.ts) and the chat library skip unchecked pages.** These still read them:
  - `evidencePages` (line 570) → `catalogueDocument` (policy_benefits, the Benefits page) and `annotateCoverageEvidence`;
  - `printedText` (738) → `premiumPrinted` and `printedPremiumTable`, which stores rider premiums read from the scrambled page;
  - `paymentSplitNote`, `fullText` (634), the `applyMemberTiers` text and `catalogueConditions`;
  - `chunkPages(pages)` (815) → the search index, with every amount.

  `evidencePages` is also built before the second cross-check pass (613), so pages marked unchecked there are missed even if it is filtered.
  Fix: after the second pass, set `const usable = pages.filter((p) => !p.unchecked)` and build evidencePages, printedText, the payment split, fullText, the tiers text and the conditions pages from it. Chunk unchecked pages as `uncheckedText(p.text)`. Add a regression test: an unchecked page that prints a rider premium and a benefit amount stores neither.
- **R176-2 (medium-high) library.ts uncheckedText keeps bare whole numbers.** "Sum Assured 13500" and "Crisis Cover 100000" survive AMOUNT_LINE (probe), so the chat can quote an amount whose pairing was never checked, and verify finds it in the text. Fix (tested): keep only lines with no digit, or a number or date beside its own label (policy/certificate/contract/member/account number; date/commencement/expiry/issue). The probe then keeps "Basic Plan: PruLink Enhanced Protector" and "Policy Number: 63639755" only. Patch: scratchpad r176-fix.diff.
- Low: numbersIn skips the glued head but then reads the tail as its own number ("181.44181.44" gives [44], so printsNumber(…, 44) is true). Suggest also skipping the match straight after a skipped glued token.
- Holds: FIGURE widened (the R175 swap probe is refused); the second trigger on unverified coverage pages (capped at 6, extraction recomputed, DB flag updated); rates like 1.375 kept whole; the needs_review and "Read in part" messages.

## R177 — PR #114 upload check re-review (head 2fd0c58)

Probes ran with tsx against 2fd0c58. I could not run v11-ingestion here (DB stack).

**Verdict: NOT READY. One small fix left (R177-1), plus R176-2 still open.**

- **R177-1 (high) lib/rag/ingest.ts:563: `evidencePages` is built before the second cross-check pass (line ~604).** crossCheckPages now swaps an unchecked page's text for uncheckedText in memory, so first-pass pages are safe everywhere: printedText, fullText, the payment split, chunks and evidencePages. A page marked unchecked in the second pass is safe in the DB, the fact check, printedText and chunks, but not in `evidencePages`. That array still holds its full text and feeds `catalogueDocument` (policy_benefits, the Benefits page, line 888) and `annotateCoverageEvidence` (728). The catalogue's quote check reads the same text, so a scrambled pairing on that page can still be stored. This is the case the gate exists for.
  Fix: move the `const evidencePages = …` line to just after the second-pass block. Nothing between uses it, and only lines 728 and 888 read it.
- **R176-2 (medium-high) still open: uncheckedText keeps bare whole numbers.** A probe at 2fd0c58 keeps "Sum Assured 13500" and "Crisis Cover 100000" on an unchecked page, now in the DB, search and chat alike. Use the tested patch from R176:
  ```ts
  const NUMBER_LABEL = /\b(?:policy|certificate|contract|member|account)\s*(?:no\.?|number)\b|\b(?:date|dated|commencement|expiry|issued?)\b/i;
  export const uncheckedText = (text: string) => text.startsWith(UNCHECKED_PAGE) ? text
    : [UNCHECKED_PAGE, ...text.split("\n").filter((l) => l.trim() && (!/\d/.test(l) || (NUMBER_LABEL.test(l) && !AMOUNT_LINE.test(l))))].join("\n");
  ```
- Low (observe): readingsAgree is strict about line breaks and OCR spelling. If the image reading puts a label on its own line, the page becomes unchecked. That is safe because it withholds amounts rather than showing wrong ones. Measure how many suspect pages pass on one real document before relying on the "Read in part" rate.
- Low (carried over): numbersIn reads the tail of a glued pair as its own number.
- Holds:
  - The R175 and TE U-F1 swaps are refused: pairs swapped across lines, and "Plan A/B" swapped within a line. Different currency marks still agree.
  - GLUED skips rates and dates (1.375, 01.10.2026).
  - The labels-before-values check fires on the Prudential shape.
  - crossCheckPages is pure. A failed image read makes the page unchecked, and a matching read keeps the page's own words.
  - uncheckedText is idempotent.
  - library.ts re-exports the single copy.

## R178 — PR #114 upload check (head d679b94)

Probes ran with tsx against d679b94. The free suites pass: chat 94/0, headline 13/0, benefit-table 107/0. I could not run v11-ingestion here (DB stack).

**Verdict: READY.**

- R177-1 / R176-1 fixed: evidencePages is rebuilt after the second pass, from the same `pages` array whose unchecked pages carry uncheckedText. Every reader now works from that text.
- R176-2 fixed: the probe keeps "Basic Plan", "Policy Number: 63639755" and "Commencement Date: 01/02/2020", and drops "Sum Assured 13500" and "Date 50,000.00".
- numbersIn: "13,500.00100,000.00" and "181.44181.44" give []. "1.375", "S$600,000" and "1 million" are read as before.
- Low (observe, no change needed): the glued-tail skip also drops a number one character after a glued token ("13,500.00100,000.00 5 days" gives []). That only withholds, and only on a line that is already broken.

## R179 — PR #114 upload check, TE UC delta (head 4c58b2f)

Probes ran with tsx against 4c58b2f. The free suites pass: 94/0, 13/0, 107/0.

**Verdict: NOT READY. One fix left (R179-1, tested patch).**

- **R179-1 (high) lib/documents/layout-check.ts DATE:** the "d Month yyyy" forms match any word, `[A-Za-z]{3,9}`. LABELLED then strips "start/end/expiry/issue" plus a fake date and the line is kept with its amount: "Expiry 30 days 1500" and "Start 12 months 2000" both survive on an unchecked page.
  Fix (tested; it also drops those two lines and keeps "Issue Date 12 March 2024" and "Issued on March 3, 2024"):
  ```ts
  const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
  const DATE = String.raw`(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+${MONTH}\s+\d{4}|${MONTH}\s+\d{1,2},?\s+\d{4})`;
  const LONE_DATE = new RegExp(String.raw`^\s*` + DATE + String.raw`\s*$`, "i");
  ```
- Holds:
  - UC-1: "Policy number TE-1 Annual limit 150000" is dropped. "Date of issue 1 Jan 2020 Premium 1500" is dropped too.
  - UC-2: the header skip needs a non-amount key cell.
  - UC-3: a lone page number is ignored. A lone value still fails, because the image line "TPD 3" has no match in the text.
- Low (accepted): "Policy no. 5000" is kept. Its label says it is a policy number.

## R180 — PR #114 upload check (head 9e57e8e)

**Verdict: READY.** R179-1 is fixed exactly as patched. The R179 probe now keeps the policy number and the real dates. It drops "Expiry 30 days 1500", "Start 12 months 2000", "End 90 days 25000" and "Sum Assured 13500". The free suites pass: 94/0, 13/0, 107/0. I could not run v11-ingestion here (DB stack).

## R181 — PR #115 Prudential plan steps 3–4 (head f99e66f)

The free suites pass: 94/0, 13/0, 107/0. simple-answer chat-test can't run here (@anthropic-ai/sdk is missing locally), and neither can v11 (DB stack).

**Verdict: READY for steps 3–4.** Step 2, a tolerant parse of the image-reading reply, is still to be added to this PR.

- **Step 3:** uncheckedWhy is set in every branch. The probe gives:
  - "could not be read" when there is no reading;
  - "gave no text" when the page is missing or unreadable;
  - readingsAgree's reason otherwise.

  It goes only to processing_failure_diagnostics, the service-only table, as "page N: why", and never into the page text. The second-pass crossCheck logs as well.
- **Step 4:** uncheckedPages comes from extraction_method. reading_status "read in part …" is printed whatever pages are sent. libraryFact says "was read in part". unreadable() is unchanged.
- Low: prompt.ts:24 only explains the case where a document has no reading_status. It could add one line: "read in part" means saying which pages couldn't be checked, and never that the file couldn't be read. The attribute already reads plainly, so this is optional.
- Low: a page the image reader dropped (PartialTranscription) and a reply that could not be parsed both give "gave no text". Step 2's OCR_REPLY_UNPARSED row will tell them apart.

## R182 — PR #115 step 2: tolerant image-reading parse (head b756874)

Probes ran against the extracted parseTranscription, since ocr-hosted.ts needs @anthropic-ai/sdk, which is missing locally. The free suites pass: 94/0, 13/0, 107/0.

**Verdict: READY.**

- These now parse: a raw TAB or newline in the page text, a sentence plus fences before the JSON, an escaped quote with a TAB, and a "}" inside the text with a trailing sentence. Escaping is lossless.
- OCR_REPLY_UNPARSED keeps only the page numbers and the reply length. Parsed readings are now cached as usual.
- Low (optional): other control characters, such as a form feed, still give null. A one-line generalisation escapes any character below U+0020 inside strings:
  `else if (ch < " ") { out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"); continue; }`
- Low: when the parse fails, the dropped-page retry resends the same pages at temperature 0, so it gets the same reply. That costs one wasted call; it is not a correctness problem.
- No integration test is needed for the failure row. The unit cases cover the parser, and the row write is one guarded call.

## R183 — PR #116 OCR page numbers (head bdfe1e3)

The probe ran against the extracted acceptTranscribedPages.

**Verdict: READY.**

- Probe results:

  | Requested | Reply | Result |
  |---|---|---|
  | [3,4] | 1,2 | mapped to 3,4 |
  | [3,4] | 2,1 | mapped by number, 2 to 4 and 1 to 3 |
  | [3] | page_number 1, text as a list | mapped to 3, list joined |
  | [3,4] | 1,5 | nothing mapped |
  | [3,4] | 4,5 | 4 only (no positional map) |
  | [3,4] | 3,4 plus an injected page 1 | 3 and 4 only |
  | [3,4] | "1","2" | mapped to 3,4 |
  | [1,3] | 1,2 | 1 only (no positional map) |

- A wrong mapping can only end as an unchecked page, because the upload check compares it with the text reading.
- Low (optional): OCR_PAGES_ABSENT logs `returned` as the raw value of pageNumber/page_number/page. If a reader put text in `page`, that text would be stored. Use `Number(...)`, falling back to its typeof, to keep only a number.

## R184 — PR #117 bare "husband"/"wife" (head 9928ad5)

**Verdict: NOT READY. The deny-list resolves other people's spouses to the user's own (a wrong-person answer).**

- **R184-1 (high) library.ts spouseSaid / NOT_MINE:** each phrase below resolves to the household's spouse.

  | Kind | Phrases |
  |---|---|
  | Another relative's or someone else's spouse | "my sis husband got cancer", "my bro wife pregnant", "my sister-in-law husband" (the hyphen splits the word), "kakak husband kena accident", "jie jie husband", "my client wife", "my bf wife", "my gf husband" |
  | About someone else entirely | "husband of my colleague died", "husband mother warded", "my husband's mum got stroke" (that last one was already the case on main), "husband-and-wife plan" |

- **Fix (tested; file /mnt/project-files/critic/spouse-said-r184.ts):** an allow-list instead of a deny-list.
  - Resolve only when the word opens the message or a clause, or follows my/me/if/when/and/but/so/cos/because/then/lah/ah/eh/wah/hi/pls.
  - Never when it is followed by "'s", a hyphen, "of", or a family or other-person noun (mother/mum/dad/brother/sis/side/family/parents/boss/friend/colleague/cousin/ex).
  - Words before it may contain hyphens, so "sister-in-law husband" is caught.
  - Every phrase above gives null. "husband kena fracture leg", "hubby got cancer", "my wife kena dengue", "if wife hospitalised can claim", "husband and I both covered?", "Husband warded at SGH" and "my hubby, he fell" still resolve.

## R185 — PR #118 app-help fixed answers (head fa556d4); #117 recheck (a694384)

**Verdict on #118: NOT READY (two findings; patch tested).**

- **R185-1 (high): cover questions get a canned reply instead of their amount.** ABOUT_COVER misses most cover words, and "plan" means the insurance plan to most people. Caught today:
  - usage: "how much of my plan have I used for outpatient this year?", "how much of our plan is left for dental", "how much of my plan has been used up for physio sessions";
  - cost: "do I pay anything to use it at a panel clinic", "how much does it cost to use this for an MRI scan? will it pay";
  - who-sees: "who can access the policy documents if I die" (an estate question);
  - rename: "change my name on the policy", "update my son's name on the rider";
  - safe: "is my data safe to share with the agent".

  **Fix (tested; file /mnt/project-files/critic/app-help-r185.ts):**
  - Widen ABOUT_COVER with: policy/policies, rider, insured/assured, pay(s)/paid, reimburs*, outpatient, inpatient, dental, physio, clinic, panel, doctor, specialist, scan, mri, x-ray, surgery, operation, ward(ed), treatment, therapy, accident, illness, cancer, critical, disability, tpd, death/die/dies/died, medisave, shield, deductible, co-insurance, left, remaining, balance, estate, agent.
  - Usage fires only on "plan usage", or on usage/used/use/left together with "this month", "questions", "documents read" or the app's name. "How much of my plan have I used this year" then goes to the model.
  - All the phrases above go to the model. "what is dearpolicy", "who can see my documents", "delete my account", "update my wife's name", "is dearpolicy free" and "plan usage" keep their fixed answers.
- **R185-2 (medium) who-sees / safe: the answers say more than the pages do.**
  - "Your household's documents are shown to the members of your household", given as the answer to "who can see" or "is it safe", implies they are the only ones.
  - But the app's own copy says "A DearPolicy reviewer will check this" (app/chat/page.tsx:45), and pages are sent to the reading model.
  - No page states any security property.
  - Suggested wording: "Within DearPolicy, the people in your household are listed under Household > Members, and the owner can remove a member or revoke an invitation there. The app's pages don't describe who else handles documents or how they are secured, so I can't say more than that."
- Checked as true against the pages:
  - Delete this household: owner only, the exact name is typed, and it cannot be undone.
  - A member who isn't the owner can Leave.
  - Revoke an invitation.
  - Family > Edit details > Full name / Preferred name.
  - Plan usage is linked from Household.
  - No price is shown (the usage page says so).
- **#117 at a694384 is still NOT READY.** The added deny-list words (sis, bro, frens, grandma, grandpa) don't close R184-1. "my client wife", "my bf wife", "my gf husband", "kakak husband", "jie jie husband", "my sister-in-law husband", "husband of my colleague", "husband mother warded" and "husband-and-wife plan" still resolve to the household spouse. The allow-list in /mnt/project-files/critic/spouse-said-r184.ts is still the fix.

## R186 — PR #119 file labels (1b50f45) and PR #120 per-block travel delay (67e86e0)

**#119: READY.**
- labelFor follows the intended precedence: (product || (not a personal name and readable)) ? docLabel : name.
- Unreadable files keep their bare name, and the file name stays in brackets.
- Low: docLabel uses documentRole, which is the app's guess (for example, the Manulife schedule filed as an endorsement). The file name in brackets keeps it findable, and prompt.ts already says roles are guesses. No change needed.

**#120: NOT READY.**
- **R186-1 (medium-high) chat.ts perBlock currency:** BLOCK_FIGURE accepts a bare "$" and then takes `template.figure.currency` from another row. "A bare $ does not establish currency." Fix: `const currency = /^us\$/i.test(sign) ? "USD" : /^(?:s\$|sgd)/i.test(sign) ? "SGD" : null;`. figureText then says "currency not stated".
- **R186-2 (medium) perBlock drops a limit printed on the next line.** The doc comment says "a third wrapped line gives none", but only lines i-1 to i+1 are checked. With "S$100 for every / six-hour delay" followed by "up to S$1,000\tup to S$500\tup to S$500" (or "maximum …"), the card shows "S$100 for every six-hour delay" without its limit. That strips a qualifier.
  Fix: pass `lines[i + 2]` and return null when it starts lowercase, or when it starts with (up to|max(imum)?|subject|capped|limit|overall|per (trip|journey|period)), or when it holds `columns` cells of figures.
- Low: headline.ts:33 still renders per_period as `a ${period}`, giving "S$50 a three-hour delay". Use periodWords there too.
- Holds:
  - column k always exists, because the heading must include template.column;
  - a merged cell or a missing plan cell changes the count, so no row is made;
  - the label can't be a block length;
  - block rows are appended after the others, so existing row numbers don't change.

## R187 — PR #121 library file names exempt from the output guard (head 5a44640)

**Verdict: READY.**

- libraryNames is built only from `household.documents[].name`, which is the signed-in household's own library. A name gets in only when the answer's text includes it. The model can't add a name: readModelAnswer doesn't carry the field, and verifyAnswer builds the answer object.
- protectableNames still filters on the guard side: slashes, key-like values, bare UUIDs, record ids, and names under 3 or over 160 characters.
- Low (observe): answer-verification.ts:1304 `unnamed` removes library names from a sentence with no whole-word check before reading money figures. Only a file name that is itself part of an amount (for example "000.pdf") could hide a figure. Real names carry an extension, so this is acceptable.

## Round 188: re-review of #116 (9571c14), #117 (f9e56f7), #118 (cef1202), #120 (0069169)

Free probes only: the three benefit-table suites on #117 and #120, plus extracted-function probes for #116, #117 and #118.

- **#116: READY.** Probed acceptTranscribedPages with 11 reply shapes. These are mapped:
  - 1..n for [3,4];
  - page_number/page keys and a text array;
  - a single [1] for [3];
  - [1,2] for [2,3] (TE P116-1).

  These give nothing: a shifted [4,5], a duplicated [1,1] and a partial [1]. An extra page beside the asked ones is only dropped. OCR_PAGES_ABSENT stores coerced numbers and letter-only keys (R183 met).
  - Low, comments only: line ~177 says "none is a page that was asked for", but [3,4,5] answered as [3,1,2] is mapped by position (3 to 5), which is correct. Line ~185 says a shifted page "is asked for on its own", but the retry asks for all absent pages together. The upload check still guards both cases.
- **#117: READY.** The R184 allow-list is verbatim, and its 18 probe phrases behave as intended. Unresolved stays safe: "pls check wife" and "my wife's policy" ask who is meant. Suites: 94/0, 13/0, 107/0.
- **#120: READY.** R186-1 is fixed: a bare "$" gives a null currency, and "SGD " gives SGD. R186-2 is fixed: a third-line limit, a lowercase wrap or a figures line gives no row. periodWords is used in figureText, rowLabel and shortFigure. Suites: 95/0, 13/0, 107/0.
- **#118: NOT READY** (R185-1 and R185-2 are met; the who-sees and safe wording is now honest).
  - **R188-1 (medium, my own R185 pattern):** "How do I use DearPolicy?", "can I use this app on my phone" and "can I use the app for my parents" get the Plan usage answer. A how-to question gets a wrong canned reply. "left" in the same pattern can never fire either, because ABOUT_COVER has "left". Fix: `\bplan\s+usage\b|\b(?:usage|used)\b[^?.!]*\b(?:this\s+month|questions?|documents?\s+read|${APP})\b|\bhow\s+(?:much|many)\b[^?.!]*\buse\b[^?.!]*\b(?:this\s+month|questions?|documents?)\b`
  - **R188-2 (low-medium):** "remove the data for my son" gets "delete the whole household". Fix: delete test noun followed by `(?!\s+(?:for|of|on|about)\b)`.
  - **R188-3 (low):** "How much does DearPolicy cost?" goes to the model, because cost words are matched only before the app name. Add `|${APP}[^?.!]*\b(?:cost|costs|charge|charges)\b` to the cost test.
  - Probed with the patch: the how-to questions go to the model; "how much did I use this month" and "how much have I used dearpolicy" still get usage; "How much does DearPolicy cost?" and "...this app cost per month" get cost; "delete my account" and "delete everything" still get delete.

## Round 189: #122 (6e824ef), lone page number in readingsAgree (TE N8)

**NOT READY.** It is the right direction: a lone value in the middle of a page no longer passes. But it refuses ordinary page-number layouts, and it still passes a lone value on the last line. Probed main against #122 with the same readings on both sides (`true` means the readings agree):

| Layout | main | #122 |
|---|---|---|
| body, "3", disclaimer line (footer then disclaimer) | true | **false** |
| "PRUDENTIAL", "3", body (header then number) | true | **false** |
| text has "3" before a footer word; image has it last | true | **false** |
| N8: value alone in the middle of the page | true | false (fixed) |
| "Hospital Cash per day" then "150" as the **last** line | true | **true** (still passes) |
| "Page 3 of 4" in the middle | true | true |

- **R189-1 (medium):** the edge rule refuses real pages whose page number sits next to a header or footer line. The PDF text layer often extracts the page number before the footer text, so whole benefit pages would become unchecked and their amounts hidden.
- **R189-2 (medium):** a lone value printed on the last line ("150" under its label) is still taken for the page number, so its pairing is never checked.
- **Fix** (diff at /mnt/project-files/critic/readings-agree-r189.diff):
  - pass the page's own number: `readingsAgree(text, image, pageNumber?)`, and `crossCheckPages` passes `p.pageNumber`;
  - treat a bare number as the page number when any of these holds:
    - it is the "page N" or "N of M" form;
    - it equals the page's own number, wherever it sits;
    - it is the first or last filled line and has at most 2 digits.

  All six layouts above then behave as wanted (the first three agree; N8 and the last-line 150 are refused). A printed "1" on PDF page 5 at the edge still passes.
- Residual risk (low, accepted): a lone value equal to the page number ("3" days on page 3) is still stripped. Its figure is still counted on both sides.

## Round 190: re-review of #122 (b8d372f), #118 (36cb215), #117 (e73dc4e)

- **#122: READY.** The R189 diff and TE P122-1 are applied. I probed nine layouts: the footer then disclaimer, the header then number, the trailing blank and a page number beside a footer label all agree. N8 mid-page and a 2-digit value first or last under a label-only line are refused.
  - The trade-off is accepted: a bundle page (printed "1" on PDF page 5) next to a label-only footer line is refused. That fails safe, and only pages already sent for a second reading are affected.
- **#118: NOT READY** (R188-1/2/3 are met, and TE P118 is fine).
  - **R190-1 (medium):** the new `is (?:APP|this|it) free` sends "is it free" and "is this free?" to the price answer. Only the message is read, so a follow-up about a treatment ("…GP visit." then "is this free?") gets "The app doesn't show a price". Fix: in the cost test, use `\bis\s+${APP}\s+free\b|\bfree\s+to\s+use\b` instead of `\bis\s+(?:${APP}|this|it)\s+free\b`.
  - Probed with the fix: "is it free", "is this free?" and "is this treatment free" go to the model; "is it free to use" and "is dearpolicy free" get cost.
- **#117: NOT READY.**
  - **R190-2 (high, wrong person):** the possessive now resolves the household's spouse whenever the next word is not on NOT_THEM_AFTER. That is the R184 deny-list problem again. These all resolve to the spouse, so the question is answered about the wrong person: "my husband's niece", "my wife's nephew", "my husband's uncle", "my wife's aunt", "my husband's maid", "my wife's helper", "my wife's kids", "my husband's children", "my wife's brother-in-law", "my husband's friend's car", "my wife's stepdaughter", "my husband's goddaughter".
  - **R190-3 (medium):** the trailing capture consumes the next word, so "my husband's first wife" resolves "wife".
  - **Fix** (tested):
    ```ts
    const SPOUSE_WORD = /(?:^|[^\w'’-])(?:([\w'’-]+)\s+)?(husband|hubby|wifey|wife)(['’]s)?(?![\w'’-])(?=(?:\s+([\w'’-]+))?)/gi;
    // After a possessive, only the spouse's own cover counts: an allow-list (Critic R190-2).
    const HIS_OR_HERS = /^(?:policy|policies|plan|plans|cover|coverage|claim|claims|insurance|insurances|rider|riders|shield|card|benefits?|premiums?|documents?|certificate|schedule|ilp|endowment|annuity|hospital|medical|health|life|ci|tpd|aia|pru\w*|manulife|ge|great|income|singlife|fwd|aviva|tokio|hsbc|own)$/i;
    // in the loop:
    if (x[1] && !MINE_BEFORE.test(x[1])) continue;
    if (x[3] ? x[4] && !HIS_OR_HERS.test(x[4]) : x[4] && NOT_THEM_AFTER.test(x[4])) continue;
    const word = x[2].toLowerCase();
    ```
  - Probed with the fix: all 12 relatives above and "my husband's first wife" give null. These still resolve: "my husband's policy", "my wife's hospital plan", "husband's claim how", "hubby's AIA", "is this my husband's?", "my wife's Prudential plan" and "my husband kena fracture".

## Round 191: #120 at af5c2eb (TE P120-1/2)

**READY, re-confirmed.** The change only refuses more often:
- the "after" line is now the next non-blank line;
- "total" and "aggregate" join the limit words;
- money figures are counted across the whole line.

A block can now only be refused more often, never given a new amount. Suites: 95/0, 13/0, 107/0. The R190 verdicts stand: #122 READY; #118 and #117 NOT READY.

## Round 192: #117 (6b6411a), #118 (6e9dfdd)

- **#117: READY.** The R190-2/3 patch is applied as given, plus "bill|bills" in HIS_OR_HERS ("my hubby's hospital bill"). That is still the spouse's own, and it is fine. Chat suite: 94/0.
- **#118: READY.** The R190-1 cost test is applied as given. The other help tests are unchanged since R190, so the R190 probe still holds.

## Round 193: #118 at 9e27270 (TE P118-4)

**READY.** I probed 18 phrases:
- Dialysis and chemo "how many … this month" questions, and "how many times can I use this month", go to the model.
- The app's own counts still get usage: questions, messages, documents left, plan usage, and "how much have I used dearpolicy".
- Cost, who-sees and delete are unchanged.

Two low points, no change needed:
- "usage this month?" now goes to the model. That is safe.
- "how much have I used this month" with no cover word gets the Plan usage reply, even though a user might mean an outpatient limit. The reply only points to a page and states no amount.

#117 6b6411a was confirmed READY in R192.

## Round 194: #121 at 7508309 (fix 8b4042e, TE P121-1/2)

**READY.** In `guardInPlace`:
- next steps now get the server-set `libraryNames` exemption, as details do;
- a string `bottomLine` is guarded like the summary, and falls back to the guarded summary (or GUARD_FALLBACK_SUMMARY) when the summary is emptied or the bottom line is stripped. A removed internal name can no longer sit beside the fallback.
- The guard strips model, provider and table names, not amounts or people, so the exemption cannot reopen an amount path.

Two low follow-ups, not blocking:
- Answers stored before this keep their raw bottomLine on reopen, because sanitizeStoredAnswer is unchanged.
- `statements[]` are not guarded, as on main. Their text comes from checked rows, but a model-written `conditions` or `basis` string could carry a provider word. A later small PR could run guardText over those fields.

The r9-redteam and r6 failures are reported as the same on main 4050804; I did not re-run them (DB suites).

## Round 195: #123 (5222e20, stacked on #121), statements guarded and the stored bottom line

**NOT READY, one small change.**

- **Calculation children are safe.** The guard runs at save (`lib/chat/store.ts:94`), after `keepLabelledAmounts` (`lib/simple-chat/hook.ts:279`), so dropping a point at save cannot change which amounts that step kept.
  - "-stay" and "-bill" children are built only under a parent that has an amount (`verify.ts:1468-1490`, `c.amount!`), and an amount point is never dropped. So no child loses its parent.
  - A "-stay" child with payable 0 and the not_found "-bill" carry server-built text with no leak pattern, so they stay.
- **No import cycle.** output-guard imports only types. Monetary-boundary now pulls output-guard into the chat page's client bundle through app/chat/page.tsx, which is a few regexes and harmless.
- **R195-1 (medium, qualifier):** on an AMOUNT point, `conditions` and `basis` go through guardText, which drops a whole sentence when any leak pattern matches. The amount would then show without its qualifier, which breaks "never strip a qualifier". Wordings that would trigger it:
  - "…becomes null." (the debug-token pattern);
  - a pasted snake_case code or form id;
  - a 32+ character mixed reference string.

  They are rare, but the result is an amount without its condition. Fix: on amount points, scrub the leaked token instead of dropping the sentence.
  ```ts
  const keepWords = (c: string) => guardText(c, names) || scrub(c);   // amount points: never lose a qualifier
  const conditions = (st.conditions ?? []).map((c) => (st.amount ? keepWords(c) : guardText(c, names))).filter((c): c is string => !!c && !!c.trim());
  const basis = typeof st.basis === "string" ? (st.amount ? keepWords(st.basis) : guardText(st.basis, names)) || null : st.basis;
  ```
- **R195-2 (low):** when a no-amount point's `text` is unchanged, `fullText` is kept unguarded, and the fullText of an amount point is never guarded. If the cards show fullText (the expand), guard it on its own: `fullText: typeof st.fullText === "string" ? guardText(st.fullText, names) || text : st.fullText`. For amount points, fullText is the server label in verify.ts, so it is fine as is.
- **The `sanitizeStoredAnswer` bottomLine fallback is correct.** It only replaces the bottom line when the stored summary is exactly GUARD_FALLBACK_SUMMARY.

## Round 196: #123 at 08b33de

**READY.** R195-1 and R195-2 are applied as given, and the "becomes null." test bites (guardText alone returns null for it). Reported suites: simple chat 83, benefit-table chat 94, tsc clean.

Note: a scrubbed condition can read oddly ("…the benefit becomes."). It still stays beside the amount, which is the point. The guard should almost never fire on real document wording.

## Round 197: #123 at 96ed299 (TE P123-2: an amount card with a leak in a condition or basis is dropped)

**NOT READY, one addition.** Dropping the amount is the right call: it is better than an amount with altered qualifiers. The bottom line can't carry the dropped figure, because `withoutMoney` strips money from it (`verify.ts:1527`), and the summary is the bottom line. Children go by id prefix ("s1-" does not catch "s10-").

- **R197-1 (medium, your open question): yes, say it.** A documented amount that disappears with no word is the "hiding a benefit" failure. The household must hear that an amount was left out.
  - LEFT_OUT_AMOUNT is the wrong wording here ("couldn't find printed").
  - Importing anything from verify or benefit-table into output-guard would also pull them into the chat page's client bundle through monetary-boundary.

  So add a local note when `gone.size` is non-zero:
  ```ts
  const LEFT_OUT_UNSHOWABLE = "I left out an amount I couldn’t show with all of its conditions. The full wording is in the document.";
  if (gone.size && !cards.statements.some((s) => s.id === "left-out-guarded"))
    cards.statements.push({ id: "left-out-guarded", kind: "uncertainty", text: LEFT_OUT_UNSHOWABLE, fullText: LEFT_OUT_UNSHOWABLE, amount: null, basis: null, conditions: [], asOf: null, source: null, group: null } as never);
  ```
  Add a test: one amount card with "pre_existing" in a condition gives no amount card and this note.
- **R197-2 (low):** `st.text.includes(t)` over-matches: a dropped "S$50" also removes a note that names "S$500". Match on a boundary instead: `new RegExp(`(?<![\\d.,])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d,]*\\d)`).test(st.text)`. The harm is only an extra note dropped, so it is low.

## Round 198: #123 at 6aa2e1d

**READY.** R197-1 (the "left-out-guarded" note) and R197-2 (boundary match, plus `\.\d` so "S$50" doesn't match "S$50.50") are applied, with tests. Reported suites: simple chat 83, benefit-table chat 94, TE pr121 9 and pr123 13, tsc clean. #123 merges after #121.

## Round 199: #124 (c1ac28d), Family "Covered for" from the benefit table

**NOT READY.** The direction is right: a live household's ledger is stale.

- **`people[].id` is the family member id.** `assemble.ts:207` builds people from `family.map((m) => ({ id: m.id, … }))`, and `/api/ledger` keys `kinds` by the same id.
- **R199-1 (medium, hidden cover):** `/\bpremium/` drops "Waiver of premium" and "Premium waiver on TPD" rows, which are cover. A person whose only rider is a waiver loses it. Skip only a row that IS the premium ("Annual premium", "Premium payable").
- **R199-2 (medium, false statement):** a person with covers on the table but no countable rows gets an empty list, so the page says "Nothing found in your uploaded documents for them yet" (`app/family/page.tsx:143`). That happens when sections are not linked yet, or the only rows are waivers or values. `people[].covers` is in the same response: count each cover that has no counted row by its cover name.
- **R199-3 (low-medium):** a failed `/api/benefit-table` request (`!r.ok` or a network error) gives null, which falls through to `/api/ledger`. A live household then sees the stale kinds again, which is the bug this PR fixes. Fall back only on `enabled === false`, and show nothing on an error.
- **R199-4 (low):** `/travel|trip/` has no word boundaries. Use `\b(?:travel|trip)\b`.
- Not fixed, noted: a life plan named only by its sum ("Sum Assured" under "Basic plan") shows "Other". I tried the product name as a fallback, and it made "CPF LIFE" annuity rows "Death" (`\blife\b`), which is worse. So keep [benefit, cover] only.
- **Fix**, tested: /mnt/project-files/critic/cover-kinds-r199.ts. The page change is `kindsOfTable(p.rows ?? [], p.covers ?? [])`, and `if (!table) return;` before the ledger fallback.
  - The waiver and "Premium waiver on TPD" rows now count (Other and Disability), while "Annual premium" is skipped.
  - Covers with no rows give their kinds, and annuity stays Other.

## Round 200: #125 (7a8b5c2), ledger rows printed as not applying

**NOT READY (false drops of real rows).** I probed `printedNotApplying` with 15 lines. `NOT_APPLYING_CELL` matches a not-applying cell **anywhere** on the benefit's own line, so these real rows are dropped:

| Line | Row | #125 |
|---|---|---|
| `Hospital cash  S$100 per day  Waiting period: Nil` | Hospital cash | **dropped** |
| `Accidental death\tS$100,000\tDeductible: Nil` | Accidental death | **dropped** |
| `Outpatient\tS$1,000\tCo-payment: Nil` | Outpatient | **dropped** |
| `Emergency dental  S$500  Excess: Nil  Sub-limit: -` | Emergency dental | **dropped** |
| `Medical expenses overseas  S$200,000  -` | Medical expenses overseas | **dropped** |
| `Terrorism  Covered  Hijack  Nil` | Terrorism | **dropped** (it's Hijack's cell) |

- **R200-1 (high, hidden benefit):** a "Nil" deductible, waiting period or co-payment, or another benefit's cell on the same line, removes a real benefit.
- **Fix** (tested, /mnt/project-files/critic/not-applying-r200.ts): only the cell printed **right after the benefit's own name** counts. With no findable name, the first line counts only when it prints no figure.
  - All six rows above are kept.
  - These are still dropped: "Home Guard  Not Applicable", "Pet care  -", "Golf equipment: N/A", "Hijack  Nil" (as Hijack), "Loss of income  NA", and "Golf  N.A." with a paraphrased name.
  - "Pet care - boarding  S$50 per day" and "Section 3  Golf  N.A.  S$250" (no name) are kept.
- Noted (low, a miss and not a false drop): a wrapped "Home Guard" / "Not Applicable" on the next line is still kept. "Home Guard\tNot Applicable\tS$500" (plan columns) is dropped. That withholds rather than guesses the plan, which is consistent with `rowFiguresDependOnPlan`.

## Round 201: #124 at 82ff6ce

**NOT READY, one regex.** R199-1 to R199-4 and TE P124-1 are in. I probed 29 cases: waiver riders, travel, Shield, PA under motor, covers with no rows, CPF LIFE as Other, "Wealth", "Carefree" and "PRUActive" all behave as intended.

- **R201-1 (medium, the same wrong-kind class this PR fixes):** `\bhome(?:shield|guard|protect)?\b` makes HDB **HomeProtect** (mortgage-reducing term: death/TPD on the borrower) show "Home and vehicle", alongside "Death". A mortgage reducing term named "HomeProtect" gives ["Death", "Home and vehicle"].
- **Fix** (tested): drop "protect" from the property alternation, and put a mortgage line before property:
  ```ts
  // A mortgage plan ("HomeProtect", "Mortgage Reducing Term") is death cover on the borrower, not home insurance.
  [/\bmortgage\b|\breducing\s+term\b|\bhome\s?protect\b/i, "death"],
  [/\bmotor\b|\bcar\b|\bvehicle\b|\bhome(?:shield|guard)?\b(?!\s*(?:care|nursing|health))|\bhousehold\b|\bfire\b/i, "property"],
  ```
  With it, HomeProtect gives ["Death"], a mortgage reducing term gives ["Death"], and real home and motor covers keep "Home and vehicle".

## Round 202: #125 at 4c908e4

**NOT READY, one line.** R200-1 is in. The split-out dash is right ("Accidental Death  -  S$100,000" is kept), and so are the TE P125-2 additions.

- **R202-1 (medium, hidden benefit):** `lastIndexOf(last)` finds the LAST printing of the name's last word. On a side-by-side travel table, a later benefit sharing that word supplies the cell:
  - "Flight delay  S$100 per 6 hours  Baggage delay  Nil" drops Flight delay;
  - "Travel delay\tS$100\tTrip delay\tNot Applicable" drops Travel delay.
- **Fix** (tested): take the name's first printing, meaning its first word, then its last word after it.
  ```ts
  const low=l.toLowerCase(),last=words[words.length-1],at=low.indexOf(last,Math.max(0,low.indexOf(words[0])));
  ```
  With it, both rows are kept, and so are "Loss of baggage … Baggage delay  Nil", the R200 keeps and "No cover for war". "Hijack Nil", "Home Guard  Not Applicable*" and "Golf: ✗" are still dropped.

## Round 203: design PRs #126 (b1922be), #127 (494d756), #128 (07bce21), #129 (699b6ea), for the UI/UX designer thread

**All four READY.** None changes answer logic or data, and they are independent off main 4050804.

- **#126 colour tokens: READY.**
  - I computed the contrast of every text pair, and all clear AA: muted on bg 5.8; brand-ink on surface 5.74, on bg 5.25, on brand-tint 5.07; warn-text on its tint 6.65; critical on its tint 5.23; good-text 5.76. In dark mode: white on brand 4.7, muted 6.87, brand-ink 7.53. Input lines are 3.18 (light) and 3.36 (dark), and the UI minimum is 3.
  - Low points:
    1. The logo PNG is still terracotta (#884938, transparent) on the new cool grey and blue. The brand and the UI no longer match, which is for DC to decide.
    2. Dark mode still paints a cream patch (#f9f5e4) behind the logo (globals.css, `.brand-logo` dark rule).
    3. `--money` is now ink, so amounts no longer stand out from the text. That is a design choice; flagging it only because amounts are the product's main figure.
    4. On the Portfolio "Not found" cards the dot is now link blue, which reads as "tap me" rather than "missing".
- **#127 page titles as nouns: READY.**
  - No test or script asserts any removed eyebrow or old title. The only hit, "cover at a glance" in scripts/v11-ingestion-regressions.ts, is document text and unrelated.
  - The #118 app-help answers still match the new names: the Documents page, the Family page, Household, then Plan usage.
  - Low: a first-time visitor now sees "Portfolio" instead of a sentence saying what the app does; the lead line still says it.
- **#128 sentence-case labels: READY.**
  - Labels now show their source text as written. The only lowercase source is the either-or divider "or" (answer-cards.tsx:182), which reads fine.
- **#129 quieter sidebar footer and phone top bar: READY.**
  - On phones the theme button keeps its accessible name, because the visually hidden span is clipped rather than `display:none`.
  - Low, pre-existing and not this PR's: the footer still says "Your documents and questions are kept private to your household." Pages are also read by the reading model, and a DearPolicy reviewer can check answers. That is the same overclaim as R185-2, worth softening in a later PR.

## Round 204 (24 Oct): #124 1bc0910, #125 e5ccbe8

**#125 e5ccbe8: READY.** R202-1 applied verbatim; both side-by-side delay lines are keep tests.

**#124 1bc0910: NOT READY (one fix).** R201-1 and F12 are right (HomeProtect gives Death and Disability, Mortgage Reducing Term gives Death, Public Vehicle Accident Plan gives Accidents).

- **R204-1 (high, hides a plan): components/cover-kinds.ts:64.** P124-2 counts the cover before *every* skip, so a cover whose only rows are a value or the premium now counts as no cover. Probe: an ILP with only "Fund value" + "Annual premium" rows gave `["Other"]` on 82ff6ce and `[]` on 1bc0910; "Critical Illness II" with only an "Annual premium" row went from `["Critical illness"]` to `[]`. With no other plan, Family shows "Nothing found in your uploaded documents" (app/family/page.tsx:145) for a person who has a plan, against R199-2. Fix: skip value/premium rows before counting; only a not-covered row counts the cover and then skips:
  ```ts
  // A value or the premium says nothing about the cover: its pages may not be linked yet (Critic R204-1).
  if (r.pays === "value" || PREMIUM_ONLY.test(r.benefit.trim())) continue;
  counted.add(`${r.product}\u0000${r.cover}`);
  if (r.pays === "not_covered") continue;
  ```
  With it: ILP gives Other, CI premium-only gives Critical illness, all-not-covered HomeShield still gives nothing; headline 15/0.

## Round 205 (24 Oct): #124 38d1090

**#124 38d1090: READY.** R204-1 applied verbatim, with the ILP and CI-premium-only tests; F15 `home\s?protect(?:ion)?` is right. headline 15/0 on 38d1090.

- Low (not blocking): a home-contents product sold under a name like "Home Protection Plan" would now show as Death (its home rows add no kind). Only the Family label changes, never an amount. Watch for it on real schedules.

## Round 206 (24 Oct): #124 a1aeea4

**#124 a1aeea4: READY.** 9aa5a61 (`\bHPS\b`, TE P124-3) and a1aeea4 (only "Home Protection Scheme" is a mortgage plan; "Home Protection Plan" for contents stays Home and vehicle) close the R205 low note, both tested. headline 15/0 on a1aeea4.

## Round 207 (25 Oct): any-household / any-market re-review (#117 0aec6d7, #118 a2d5060, #119 c63a5e3) and sweep of #116-#125

**#117 0aec6d7: NOT READY (one fix).**
- **R207-1 (medium, wrong-person class): lib/simple-chat/library.ts `ownCoverWords`.** Every word of the household's insurer and product names counts after a possessive, including relation words. Probe with product words "family care plan": "my wife's family has cancer history, covered?" now resolves to the wife (null before); so does "my husband's family". Fix: drop words that NOT_THEM_AFTER already says are someone else:
  ```ts
  .flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 2 && !NOT_THEM_AFTER.test(w)));
  ```
  With it: "my wife's family ..." gives null again, "my wife's care plan" still resolves.

**#118 a2d5060: READY**, but **its PR #118 was merged at 8524386, so this commit is in no open PR**: it needs a new PR from main. Low: generic product words ("safe", "secure", "family") now send an app question to the model. That costs a model call, not a wrong answer.

**#119 c63a5e3: READY**, with the same problem: **PR #119 was merged at 32e365d**, so this needs a new PR. Until then, main still carries the "Desmond travel.pdf", "charmaine's name to Charmaine Ong" and FWD/AIA test strings, which #118/#119 follow-ups remove.

**#123 6aa2e1d is neither open nor merged** (closed). FYI in case that was not intended.

**Sweep of #116-#125 (main 999048d) for one-household / one-market code:**
- **R207-2 (medium, market): lib/benefit-table/chat.ts:198 BLOCK_FIGURE, :112 and :140 (#120).** Per-block delay cells match only S$/US$/SGD/$, and currency maps only to SGD/USD. An RM, HK$, A$, € or £ delay table gives no row (missing, not wrong). lib/chat/assertions.ts:224 already has a full sign table. Fix: one shared sign list:
  ```ts
  const SIGN_RE = String.raw`S\$|SG\$|SGD|US\$|USD|RM|MYR|HK\$|HKD|A\$|AU\$|AUD|€|EUR|£|GBP|₱|PHP|\$`;
  const SIGNS: [RegExp, string][] = [[/^(?:S\$|SG\$|SGD)$/i, "SGD"], [/^(?:US\$|USD)$/i, "USD"], [/^(?:RM|MYR)$/i, "MYR"], [/^(?:HK\$|HKD)$/i, "HKD"],
    [/^(?:A\$|AU\$|AUD)$/i, "AUD"], [/^(?:€|EUR)$/i, "EUR"], [/^(?:£|GBP)$/i, "GBP"], [/^(?:₱|PHP)$/i, "PHP"]];
  // A bare "$" names no currency (Critic R186-1).
  const currencyOfSign = (sign: string) => SIGNS.find(([re]) => re.test(sign.trim()))?.[1] ?? null;
  const BLOCK_FIGURE = new RegExp(String.raw`^(${SIGN_RE})\s?(\d[\d,]*(?:\.\d+)?)\s+for\s+every$`, "i");
  // :112  (after.match(new RegExp(String.raw`(?:${SIGN_RE})\s?\d`, "g")) ?? []).length >= columns
  // :140  const currency = currencyOfSign(sign);
  ```
- Low (pre-existing, round 12): chat.ts:172-175 plan-table cells take S$/US$/SGD only, and a bare "$" takes `template.figure.currency`. That conflicts with R186-1; a follow-up should use the same `currencyOfSign`.
- Additive SG vocabulary is acceptable (it recognises more; it hides nothing elsewhere): CareShield/ElderShield, HomeProtect/HPS (#124), MediSave in ABOUT_COVER, Singlish particles in MINE_BEFORE. One label risk outside SG: cover-name `shield` means Hospital and medical (the SG Integrated Shield convention), so an "XYZ Shield" life plan elsewhere would show as Hospital and medical on Family. That is a label only, never an amount.
- **R207-3 (repo-wide, pre-existing; not from #116-#125): real household names in code.** "Desmond", "Charmaine" and "Tan Yi Chuen" appear in 686 lines across 71 files in lib/app/components/scripts (comments and tests, e.g. chat.ts:1058-1092, layout-check.ts:1, claims/evidence/identity.ts:19). Against "keep private records out of Git" and any-household. Needs one sweep PR replacing them with made-up names (no logic change). #116-#125 themselves add none beyond the two test lines above.

## Round 208 (25 Oct): #135 6e86ebb (build fix)

**#135 6e86ebb: READY (urgent, merge first).** Root cause confirmed: headline.ts (imported by the client component components/benefit-table-coverage.tsx) value-imported `periodWords` from assemble.ts, which imports lib/policies/linking (database). Now headline.ts imports only types; assemble.ts value-imports headline.ts with no cycle, and chat.ts keeps getting `periodWords` through the re-export. Function body unchanged. No `"use client"` file value-imports assemble or db. On 6e86ebb: headline 16/0, benefit-table 107/0, chat 95/0. I did not run `next build` (free-work rule); the builder reports it passes.
- Low: the guard test reads one line per import, so a value import split across lines (`import {\n periodWords,\n} from "./assemble"`) or an `export … from "./assemble"` would get past it. Optional: match with `/^(?:import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/gm`.

## Round 209 (25 Oct): #136 f057339 (de-household follow-ups to #118/#119)

**#136 f057339: NOT READY (one small fix, same class as the PR).** The code is right: ABOUT_COVER names no insurer; appHelp takes the household's own insurer and product words; hook.ts passes them. Probe on f057339 with own = Zurich/CareFirst: "is my data safe with Zurich" and "... with CareFirst" both give null (model); "is my data safe" gives safe; what/delete/cost/rename/usage are unchanged. I could not run the simple-answer chat-test locally (missing SDK dep in my scratch install).
- **R209-1 (privacy / any-household): the same real file names #136 removes elsewhere are still in the code.**
  - lib/simple-chat/verify.ts:1112 has "817d6e8b-....pdf" and "output_202609281146053.pdf".
  - lib/simple-chat/verify.ts:1563 (from #121) has "5e58ea7d-….pdf" and "output_202609281146053.pdf".
  - scripts/simple-answer/style-test.ts:100-106 has "817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", "output_202609281146053.pdf" and insurer "Singlife".

  Fix: use made-up names, as #136 already does in chat-test ("0a1b2c3d-0000-4000-8000-00000000abcd.pdf", "output_202601010900001.pdf", "Example Insurance"), and change the `/817d6e8b/` assertion to match the new name.
- Not blocking: ABOUT_COVER keeps medisave/polyclinic/tcm/shield. These only add recognition and hide nothing in other markets. The repo-wide real-name sweep (R207-3) stays a separate PR.

## Round 210 (25 Oct): #137 62cd137 (benefit-table prompt cache, cache-token booking, Sonnet 5.5 cache price)

**#137 62cd137: READY.**
- **Price, verified against the live source.** platform.claude.com prompt-caching page (fetched 25 Oct): Sonnet 5.5 is $2 input, $2.50 5m write, **$0.10 cache hit**, $10 output; footnote: "Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the base input price." So `cachedInput: 0.1` is right; 0.2 was the old 0.1x figure. (The bundled claude-api reference, cached 6 Oct, still says $0.20 for Sonnet 5.5; the live page wins.)
- **Does the cap now let through spend it should block? No.** The ledger now books what Anthropic bills. Before, Sonnet 5.5 cache reads were booked at 2x, so the cap was stricter than it needed to be; it now meets the true cost exactly. benefit-table calls book `input = uncached + reads + ceil(1.25 × writes)` and `cached = reads`, so `costUsd` = uncached×p + 1.25×writes×p + reads×0.05p. That matches the 5m write price ($2.50 = 1.25×$2). Before this PR the table had no caching, so input_tokens was already the whole prompt; without the new booking, cached tokens would have gone unbooked. The PR books them.
- **Model-visible change? None.** `system` goes from a string to one text block holding the same `c.system` string. `cache_control` changes billing and latency, not what the model reads. user content, schema, effort and max_tokens are all unchanged. Only the shared prompt (READING_PROMPT / LINKING_PROMPT) sits in the cached prefix; the household's document stays in the user turn (tested), so nothing from one household is cached ahead of another's.
- **Build fix:** 62cd137 is byte-identical to #135's 6e86ebb (the patches diff empty), so whichever merges second applies cleanly.
- **Local checks:** service-test 22/0 (includes the new cache test), headline 16/0.
- Low: a document read with no page re-read inside 5 minutes pays the 1.25x write on the prompt once, a little more than today. That is cents-of-a-cent per document, and it is repaid by the second call that shares the prompt.
- Low (pre-existing, not this PR): `claude-haiku-5-5` has no PRICES entry (#93 adds one). If any route is set to Haiku 5.5, its calls book US$0 ("unpriced") and the household cap cannot see them.

## R211 — #139 4401e68 (page check line by line): NOT READY

Free review: code read and pure `checkLines` probes only. The PR's own layout assertions (v11-ingestion-regressions E1 blocks, layout-check part) pass before and after the patch below.

- **R211-1 (high, new in this PR) — a row's own figure masked, its continuation kept.** `layout-check.ts` checkLines masks only the unconfirmed line. Text `Hospital cash S$150 per day` / `or up to S$50,000, whichever is lesser`, image misreads 150: the page is stored as `Hospital cash [amount not checked] per day` / `or up to S$50,000, whichever is lesser`. `lib/benefit-table/check.ts` rowSegment joins a connective line into the row, so the row can show "up to S$50,000" as its whole limit while the binding daily limit is hidden. Before #139 the whole page was unchecked. Wrong claimable amount.
- **R211-2 (high, new in this PR) — column header masked, rows under it kept.** Text `Benefit\tPlan 1\tPlan 2\tPlan 3` over value rows, image misreads one plan number: the header becomes `Plan [amount not checked]` x3 and every value row stays, so no figure can be tied to its plan (or age/year). Wrong plan's amount.
- **R211-3 (high, pre-existing since the line-multiset check) — a line confirmed under a different heading.** Text `Plan A / Death benefit 100,000 / Plan B / Death benefit 200,000`, image `Plan A / Death benefit 200,000 / Plan B / Death benefit 100,000`: checkLines agrees (kind null) and the page is stored whole. Headings carry no figures, so they are never compared. A two-column page whose text layer interleaves columns gives exactly this.
- Fix for all three (one function, patch at /mnt/project-files/critic/r211-layout-check.patch): match a line only under the same heading in both readings (the nearest label-only line above it that both readings print; headings only one reading has are passed over), and spread masking to the masked row's continuation lines (lower-case or connective start, both directions) and, when the masked line has 3+ tab cells, to the run of rows below with the same cell count. Probes: R211-1 masks the cap too; R211-2 and R211-3 leave nothing confirmed, so the page is unchecked. PW9 shapes (footer code, OCR missing a heading, glued age) are unchanged.
- **R211-4 (medium) — chat calls a part-checked document fully read.** `lib/simple-chat/verify.ts:1170` libraryFact checks only `uncheckedPages`; a document with only part-checked pages says "X was read." Fix: add a branch for `d.partCheckedPages?.length`: "`${named}` was read in part: some amounts on `${pageList(d.partCheckedPages)}` couldn't be checked against the page image, so they are not used."
- Downstream checked and fine: benefit-table `service.ts:47` sends part-checked text, and `check.ts` drops any figure not printed in the quote, so an amount invented for `[amount not checked]` is dropped (but see R211-1). simple-chat `library.ts` readInPart covers both kinds. ingest second pass re-verifies against masked text and skips part-checked pages. checkLog holds shapes and positions only; uncheckedWhy stays a fixed phrase (TE P115-1 holds).
- Low, pre-existing: lines with no figure, zero amounts and amounts in words are never compared; ANY_FIGURE eats a trailing comma ("S$50,000," becomes "[amount not checked]").

## R212 — #138 861b71b (any-household cleanup): READY

Free review: diff read, `canonicalInsurer` probed against the old alias rule.

- Product code (lib, app, components) now has no real household names: 21 files and 42 lines before, 0 after. The other code changes are comments, two form placeholders and two example names in prompts (simple-chat prompt.ts, rag2 loop prompt.ts), all harmless.
- `lib/policies/insurer-name.ts` canonicalInsurer: every old Singlife alias still maps to "singlife", and "Aviva Ltd" stays apart. Two names that differ only by legal-form words now match ("The Great Eastern Life Assurance Company Limited" = "Great Eastern Life Assurance Co Ltd"). Disability and travel move from the raw name to this rule. Every caller I checked (currentness matchPremiumEvidence, inventory, claims wording) also needs a policy number, group number or product match, so the wider insurer match can't attach another contract's evidence.
- Low: LEGAL_FORM misses "private", "pvt", "sdn", "pty", "gmbh" and "se", so "AIA Singapore Private Limited" and "AIA Singapore Pte Ltd" still differ, as they did before. No regression; add them for other markets.
- Medium, still open (R207-3): scripts and e2e still hold 738 lines with the owner household's first names, including a full name at scripts/claim-evidence-regressions.ts:134, :506 and :599. DC's rule says tests use made-up names. Needs its own PR if it isn't planned already.
- G007500 hard-coding (ci-evidence.ts:214, death-evidence.ts:192, dashboard route:97) is left for its own plan, as stated.

## R213 — #140 9657d16 (reading starts at once, Try again): NOT READY (one small fix)

Free review: code read only. I did not run the DB suite.

- **Double runs: none found.** startJobNow uses the same claimNextJob CAS (`FOR UPDATE SKIP LOCKED`, queued/failed_retryable only, `available_at <= now()`, not cancel_requested), now filtered by idempotency key. The drain, the daily run and start-now can race on one row, but only one claims it; the losers get "empty" (shown as not_claimable). Lease, heartbeat, retries and dead-lettering are unchanged.
- **Lease clash with the drain: none.** A leased row is never claimable, and only recoverExpiredLeases (run by runJobBatch) touches an expired lease.
- **Try again on a leased job: 409, as intended.** livePolicyJob is true for `processing` with a live lease, so the reprocess route throws AlreadyProcessing (route.ts:123, 409). The same is true for failed_retryable inside its backoff.
- **R213-1 (medium): Try again on an expired lease does not start anything.** This is the likely stall: a run killed at 300 s, or a crashed instance. The row stays `processing` with `lease_expires_at < now()`, so livePolicyJob is false and the page offers Try again. Then:
  - enqueuePolicyProcessing does nothing (the row is neither terminal nor conflict-free);
  - startJobNow returns not_claimable (the status is processing);
  - the drain scheduled at the top of the route moves the row to failed_retryable with a backoff, so the page goes back to "Reading this document…" until a later poll-driven drain claims it.
  The button says it starts reading and it doesn't. Fix in the reprocess route, stalled path, after the policies UPDATE:
  ```ts
  await recoverExpiredLeases(pool); // expired lease -> failed_retryable, or dead_letter at max attempts (which enqueue then revives)
  await enqueuePolicyProcessing({...});
  // Try again means now: a retry delay the person is asking to skip is skipped.
  await query(`UPDATE background_jobs SET available_at=now(), updated_at=now()
    WHERE job_type=$1 AND idempotency_key=$2 AND status='failed_retryable' AND NOT cancel_requested`, [POLICY_PROCESSING_JOB_TYPE, body.policyId]);
  await startJobNow({ jobType: POLICY_PROCESSING_JOB_TYPE, idempotencyKey: body.policyId });
  ```
  Add a test: a processing row with an expired lease, then Try again, gives "succeeded" and runs once.
- **R213-2 (low-medium): a 150 s claim budget against 300 s maxDuration.** A job claimed at 149 s has 151 s before Vercel kills it. PW9 already ran past 60 s, so a second long document can be killed mid-read, paying again for the calls it already made. Checkpoints and the hosted_ocr cache soften this. Now that start-now gives every document its own start, keep the runner budget at about maxDuration minus the longest expected reading (100-120 s).
- Low: up to 3 start-now runs plus 1 drain per instance read side by side. The household cap is checked per call, so parallel reads can overshoot it by a few calls' worth, and DC's household has about US$12 left.
- Low: Try again on an existing queued row keeps that row's payload, so a PDF password typed with Try again is ignored. Pass it through in an UPDATE of payload for a queued row.
- Low: when start-now is "busy" (3 in flight), Try again shows "Starting…" while nothing starts. The page then shows stalled again after 10 minutes, which is honest.

## R214 — re-review of #139 f0faa3b, #140 6b6f16d, #117 7401aa7, #136 3887506, #138 99696b5: all READY

- **#139 f0faa3b READY.** The R211 patch is in as written. My three probes now give: the continuation masked with the row ("or up to [amount not checked], whichever is lesser", comma kept), and the header and heading cases fully unchecked. The PW9 shapes are unchanged. P139-1 (skipped lone date or value masked when an image figure line is left over) is right: the confirmed count excludes skipped lines, and a page with only skipped lines masked is part-checked with kind non-null. R211-4: libraryFact now says "read in part" for part-checked pages. The branch also carries #135/#137 (build fix, cache pricing), already reviewed in R208/R210.
- **#140 6b6f16d READY.** On a stalled Try again: recoverExpiredLeases, then enqueue (revives dead_letter), then makePolicyJobDueNow (failed_retryable and not cancel_requested only; never a leased or cancelling job), then startJobNow. R213-1 is closed. The budget is 110 s, leaving about 190 s for the last job claimed. Lows in R213 stand (parallel reads against the household cap, the payload password on an existing queued row).
- **#117 7401aa7 READY.** ownCoverWords drops NOT_THEM_AFTER words (family, side, parents, ...) and PERSON_WORD (husband, wife, first, former, late, kids, ...), so a "Family Care Plan" or "Family First" product no longer makes "my wife's family" her cover. R207-1 is closed.
- **#136 3887506 READY.** style-test uses made-up file, person and insurer names. The verify.ts real file names (R209-1 lines 1112, 1563) are fixed in #138, so merge #138 with or before #136.
- **#138 99696b5 READY.** Sdn, Pty, Pvt, Private and GmbH are legal forms, with a test. SE is left out on purpose.
- Merge order I'd suggest: #138, #136, #117, #139, #140 (#139 and #140 both carry #135/#137, so whichever merges second may need a main merge).

## R215 — #139 46e389f (lone dates and numbers compared in order): NOT READY (one small fix)

- The new rule is sound for dates and stray values: the lone figures of both readings must match in printed order, or every skipped figure line is masked and kind becomes non-null, so the page can't count as agreeing. A print date only the text layer has (`Schedule / Sum Assured 100,000.00 / 01/10/2026`, image without the date) masks the date and keeps the rest. That is right.
- **R215-1 (medium): a page number only the text layer prints now costs the page.** Text `… / Premium 181.44 / 3` (page 3), image without the footer: agree false, kind "figures differ", text ends `[amount not checked]`, and the document says "Read in part". Image readers often drop footers, so this brings back the R189-1 / TE UC-3 failure (a footer refusing the page) as "read in part" noise on many pages. Fix: leave the page's own number out of the comparison:
  ```ts
  const pageNo = (l: string) => /page|of/i.test(l) || (pageNumber != null && Number(l.trim()) === pageNumber);
  const loneFigures = (ls: string[], skip: Set<number>) => ls.flatMap((l, i) => (skip.has(i) && !pageNo(l) ? lineTokens(l).filter((t) => typeof t !== "string" || isDate(t)) : []));
  ```
  A skipped lone number that isn't the page's own number is still compared, so TE's A29-A31 / N8 values stay covered. Test: the page number only in the text reading still gives agree true and the text unchanged.

## R216 — #139 5417562: READY

- R215-1 is closed. A page number printed only by the text layer ("3" or "Page 3 of 12") gives agree true with the text unchanged.
- The builder's exception holds. A lone value equal to the page number under a label-only line ("Hospital cash per day" over "3" on page 3) is kept only when the image prints the same label over the same number. Probes:
  - the image prints the same: agree, kept;
  - the image prints 5: masked, "figures differ";
  - the image prints "Hospital cash per day 3" on one line: masked, "pairing differs" (fail safe).
  The exception runs before the kind check, so the page never counts as agreeing.
- My R211 probes are unchanged: the continuation is masked, and the header and heading cases are unchecked. Accepted cost: a label-only header over a lone page number that the image drops masks just that number (part checked).

## R217 — #139 e74d449: READY (one low cost noted)

- P139-2 is closed safely. A lone page-number value under a line ending in words is kept only when the image prints the same line over it. My R215-1, R211 and label probes give the same results as R216.
- **R217-1 (low, fails safe): a footer after a prose line counts as a value again.** Text `… / Please read the policy wording for full terms / 3` on page 3, image dropping the footer: the "3" is masked, kind "figures differ", and the page shows "read in part". Many pages end with a prose line over the page number, so some R215-1 noise comes back. Nothing wrong gets stored. To cut most of it, treat a line above that reads as a sentence as prose, not a label:
  ```ts
  const prose = (l: string) => /[.!?]\s*$/.test(l.trim()) || l.trim().length > 60;
  // in valueUnder: return typeof last === "string" && !isDate(last) && !prose(above(ls, i));
  ```
  TE's labels ("Hospital cash per day (max 30 days)", "Persons covered (age 0-17)") are short and don't end in a full stop, so they stay values.

## R218 — #117 0612632 (allow-list after a possessive): READY

- coverAfter reads what follows the possessive: SPOUSE_WORD takes the next word only as a lookahead, so `rest` starts right after "'s", up to the first punctuation mark. It needs either a whole insurer or product name, or the insurer's first word alone or before a cover word.
  - "my wife's domestic helper" with Domestic Helper Insurance: no match, as wanted.
  - "my wife's Domestic Helper Insurance claim": match.
  - "my wife's great aunt" with Great Eastern: no match.
- Accepted cost: part of a product name gives no match, so the chat asks who is meant. This fails safe (it asks rather than picking a person).
- Low, harmless: an insurer whose first word is ordinary English counts when that word stands alone ("my wife's income." with Income Insurance). It still resolves to the spouse, who is the subject anyway.
- On #139 R217-1: the builder is right that my prose rule misses the probe line (no full stop, under 60 characters). Leaving it for later is fine, since it fails safe.

## R219 — #139 e1852f6: READY

- P139-3 (TE A40) is closed. A lone page number at the edge is left out only when nothing is printed above it, or the row above ends in a comma-grouped or two-decimal amount. Anything else is compared, which fails safe.
- My probes are unchanged:
  - R215-1 ("Premium 181.44" over "3", the image dropping it) agrees with the text unchanged;
  - the label exception works for all three image variants;
  - the R211 continuation, header and heading cases still mask or leave the page unchecked.
- Accepted cost: footers under prose, or under a row ending in a small whole number, add R217-1 noise ("read in part"). Nothing wrong is stored.

## R220 — #138 1554411: READY

- "Private" is dropped only before Limited or Ltd. Probes: "AIA Singapore Private Limited" = "AIA Singapore Pte Ltd" = aiasingapore, "Private Health Mutual" stays privatehealthmutual, a bare "Private" stays private, the Singlife aliases are unchanged, and "Aviva Ltd" gives aviva.

## R221 — #117 38e605b: READY

- A whole name now counts only before a cover word or the end of the clause, and an insurer first word that is a relative's word (NOT_THEM_AFTER) never counts. So "my husband's business partner died" with a "Business Partner" product, and "my wife's family medical history" with Family Life Insurance, both give no match.
- Low, rare: HIS_OR_HERS holds ordinary words (health, medical, life, hospital, bill), so a product named with plain English followed by one of them still matches ("my husband's business partner's hospital bill" if the name is "Business Partner"). The wrong case only resolves to the spouse, who is named in the message anyway. Leave it.

## R222 — #117 47c011a (insurer by its core name only): READY

- insurerCore works as described:
  - "Friends Provident International" becomes "friends provident", so "my husband's friends medical bills" gives no match;
  - "Family Life Insurance" becomes "family life", so "my wife's family life is busy" gives no match (then() fails), while "my wife's family life insurance" matches;
  - "Prudential Assurance Company Singapore" becomes "prudential", "AXA Insurance" becomes "axa", and "Great Eastern Life" becomes "great eastern".
- Low, fails safe (the chat asks who is meant):
  - When every word is generic, the full name is kept ("Singapore Life Ltd"), so "my wife's Singlife" doesn't match unless a product carries the brand.
  - Splitting market words cuts brands that contain them ("Hong Leong Assurance" becomes "leong", "NTUC Income" stays "ntuc income", so "my wife's Income policy" doesn't match).
  - A single plain-word core ("Income Insurance" becomes "income") matches "my wife's income." and resolves to the spouse, which is harmless.

## R223 — #117 32791a2: READY

- A person word right after the possessive (including plurals, and partner or partners) now gives false before any name is matched. This catches products and insurers whose names start with a relative's word. Accepted cost: those names ask who is meant, which fails safe.

## R224 — #141 c1c5e59 (one shape for document questions): READY

Free review: code read only.

- Mixed answers (a per-person point plus per-file points) are handled right:
  - A file is skipped from the groups only when every person it is linked to already has a libraryList line. libraryList lists every current file linked to that person, so nothing listed is lost.
  - Files read in part, unreadable, unlinked, or uploaded for someone else still get their own sentence even when the person was listed. That repeats the file, but it carries news the list doesn't.
- The splice keeps every non-file point in order and puts the grouped lines where the first file point stood. fromRecord skips only the library-claim check, so server text built from the record isn't held to that record again.
- Low:
  - (a) The group key is linkedPeople in stored order, so files linked to A and B and to B and A make two groups. Sort the names before joining.
  - (b) A joint file (A and B) with only A listed is listed again under "Linked to A and B". It's a repeat, not wrong.
  - (c) Grouped lines still pass through withoutMoney. FILE_NAME protects names ending in .pdf etc., but a product label carrying a figure would now drop the whole group sentence instead of one file's line. Treat fromRecord like serverWords for `said` too: `const said = serverWords.has(t) || fromRecord.has(t) ? t : …`.
  - (d) Each grouped entry copies filePoints[0].s, including its `document` id. If any renderer links a card from s.document when found is null, every group would point at the first file. I saw no such use, but it is worth a glance.

## R225 — #142 fe0bf2b, #144 69e8070, #143 405874c (G007500 removal, name cleanup)

Free review: code read and git grep only.

### #142 (table figures label tiles): READY after one medium fix

- Medium: `categoryRows` drops only projected and not_covered rows. A `pays === "value"` row (fund, surrender or account value) whose name carries "death" can label the Death tile with a fund value. Add `r.pays !== "value"` (and the R204 premium-only test) to the filter.
- Low: the tile currency falls back to SGD when the figure has none (`normalizeCurrencyCode(..., "SGD")`). A bare $ does not establish currency; show no currency instead.
- Low: `wordingDescribes` compares insurers by plain lowercase; use `canonicalInsurer` (#138) so "AIA Singapore Private Limited" and "AIA Singapore" agree.
- Low: a combined "Death or TPD" row goes to TPD only. Low, fails safe: word-for-word product names may drop a derived wording category.

### #144 (claim items from the benefit table): NOT READY (one high, two medium)

- High, wrong amount: `purposeOf` matches the body part with `some` over part words, and positional words are not in SIDE. "upper arm" matches an "Upper jaw" fracture row, "lower leg" matches "Lower jaw". Fix:
  ```ts
  const SIDE = new Set([...existing, "upper", "lower", "front", "back", "inner", "outer", "top", "bottom", "middle", "base"]);
  // in purposeOf:
  words.length > 0 && words.every((w) => new RegExp(`\\b${w}s?\\b`, "i").test(row.benefit))
  ```
- Medium, double count: the death dedupe only looks at `i.id === "gtl-death"`. death-evidence.ts:241 also builds `gpa-accidental-death`, and travel-rules.ts:177 builds `travel-accidental-death`. A GPA death row for a cover that already has a checked `gpa-accidental-death` item adds a second death item with an amount. With `item.coverageId` null there is no dedupe at all. Fix:
  ```ts
  const DEATH_IDS = new Set(["gtl-death", "gpa-accidental-death", "travel-accidental-death"]);
  if (g.purpose === "death") {
    if (!item.coverageId) continue; // no verified cover: leave death to the evidence path
    const same = items.filter((i) => i.coverageId === item.coverageId && DEATH_IDS.has(i.id));
    if (same.some((i) => i.status !== "needs_document")) continue;
    items = items.filter((i) => !same.includes(i));
  }
  ```
- Medium, wrong cover: `coverageFor`'s second fallback takes any coverage on the same document. On a multi-cover schedule (GTL + GPA) a GPA row with an unmatched name maps to the GTL coverage, passes the money gate with GTL's effective date, and (with the death dedupe) can replace GTL's own item. Fix: use the same-document fallback only when that document holds exactly one coverage:
  ```ts
  const onDoc = doc == null ? [] : coverages.filter((c) => c.policyId === doc);
  return onDoc.find(named) ?? (onDoc.length === 1 ? onDoc[0] : undefined) ?? coverages.find(named) ?? null;
  ```
- Low-medium, hides a benefit: `covered()` for fracture, ambulance and recuperation tests titles across all items, not per cover. An evidence item for cover A hides cover B's table item. Compare `i.coverageId` with the group's cover once coverageFor is fixed.
- Good: CI and TPD never get an amount; a lump sum needs a currency; several figures give "cannot"; hospital cash uses only the printed fromDay and maxDays.

### #143 (made-up names in fixtures and records): NOT READY (one high)

- High, private record: only the English first name was swapped. The real surname and given name remain: "Tan Yi Chuen Raymond" (was "Tan Yi Chuen Desmond") in 20 files under scripts/ (claim-*-regressions, evidence-*, v11-*, fixtures/reviewer-benefit-wording.ts, system-database-regressions.ts and others). Replace the whole name with a made-up one, e.g. "Lim Wei Jie Raymond" / "Raymond Lim Wei Jie", and keep the swapped-order variant in claim-evidence-regressions.ts:156 consistent.
- Checked clean: no Desmond or Charmaine left (case-insensitive); the change is a pure rename (5,870 lines each way); no PDF or extracted-text fixture changed, so no fixture text disagrees with its test; NRIC-shaped strings left (S1234567A/D, T1234567J, S7712345J, S9100227Z) are synthetic test values.
- Note: the docs/rag-migration/live run records now show names the live model never printed. Fine for privacy; the old names stay in git history (DC's open item).

## R226 — #145 999f8d3 (one money sign for every market): NOT READY (one high)

Free review: code read plus tsx probes of MONEY_SIGN, statedCurrencyCode, moneyFiguresIn, parseAmount and otherLife (pg stubbed). No next build here (no node_modules; heavy builds are out of my scope), so the builder's own next build stands.

- High, hides a cap (Q1): MONEY_SIGN itself is safe ("FORM 2", "TERM 5", "Room 2" give no sign). But check.ts now counts money with `moneyIn`, which calls `moneyFiguresIn`, and its FIGURE in lib/chat/answer-verification.ts reads `(RM)\s?` with no guard before it. Probe output:
  - "Up to S$50,000 (submit claim FORM 2)" gives S$50,000 and RM 2.
  - "Up to S$50,000 within TERM 1 of cover" gives S$50,000 and RM 1.
  - "PLATFORM 3: up to S$500" gives RM 3.
  So capInRow sees two values and returns null, and otherMoneyThan / otherMoney turn true, so a real printed cap is refused. Before this PR, MONEY_IN only knew s$/us$/sgd/$, so these rows kept their cap. Fix at the shared boundary (it also stops the chat verifier reading "CLAIM FORM 2" as RM 2):
  ```ts
  // lib/chat/answer-verification.ts FIGURE
  ...|\b(S|SG|US|HK|A|AU|NZ)\$\s?|(?<![A-Za-z])(RM)\s?|([€£¥₱])\s?)...
  ```
  Add "Up to S$50,000 (claim FORM 2)" and "TERM 5" rows to parity-test.ts.
- Medium, wrong currency (Q2): MONEY_SIGN accepts "NZ$", but `statedCurrencyCode("NZ$")` returns null, so an NZ$ plan cell falls back to the template's currency (SGD on a mixed table). Add `"NZ$": "NZD"` to the aliases in normalizeCurrencyCode. Otherwise Q2 is right: RM, £, €, A$, AU$, HK$, SG$, S$, US$ and the codes map correctly; a bare "$" gives null, so block cells stay without a currency and table cells take the template's, as before.
- Low (Q3): inferProductName takes any of the first 15 lines that ends in "group insurance (scheme)", so "Certificate of Group Insurance", "Important notice about your Group Insurance" or an insurer's line ("<Insurer> Group Insurance") becomes the product name. It runs only on the code-only fallback and generic reference documents, and a wrong name mostly fails safe (wording and spouse-word matches need the exact name). Refuse lines that start with a generic word: `/^(?:certificate|summary|notice|important|about|your|welcome|claims?|guide|the|of)\b/i`, or that contain "of group insurance" / "your group insurance".
- Q4 lives.ts is fine: the cut only removes a sign followed by digits, and names have no digits. "Life Assured: Jane Doe RM 250,000" still finds another life, "Insured\tJANE DOE\tS$250,000" too, and "Sum Insured\tRM 250,000" no longer reads "rm" as a name.
- Low: compiled with "i", MONEY_SIGN reads "Rm 2" / "rm 12" (a room) as ringgit, and "Plan RM2" or "GBP3" as money. Only facts.ts (targetedMoney, moneyNear) could take one as a bill amount, and only when the person types it. Node 22 has no `(?-i:)`, so if it matters, build those two regexes without "i".
- Low: parseAmount now drops "RM" / "£" / "EUR" from a typed sum insured and keeps the number, so a typed currency that differs from the policy's is lost. It is used only by scripts/benefit-table/service-test.ts today; refuse a non-matching sign before it gets a caller.
- Racing texts: they no longer name the scheme and now quote the wording's own exception. Good.

## R227 — re-check: #141 28d62b5, #142 c2bf547, #143 c2e5b15, #144 dd3f15b: READY; #145 ca5bef3: still NOT READY (R226 open)

Free review: delta read only. The builder's next build and 15-set replay (0 changed lines) stand.

- #141: (a) the group key is now the sorted, de-duplicated names, with "A, B and C" for three or more; (c) fromRecord lines skip withoutMoney; (d) grouped entries carry found:null and document:null; superseded files are skipped, as libraryList skips them. (b) was left as is, which I accept. READY.
- #142: categoryRows drops value figures, pays:"value" rows and premium rows; wordingDescribes uses canonicalInsurer. Accident-only death, TPD and dismemberment rows go to Personal Accident, and any-cause or illness rows stay as Death or TPD. READY.
  - Low: a Death row that only mentions the accident uplift ("Death benefit; doubled for accidental death", "Death (additional 100% if accidental)") has no any-cause word, so it moves to Personal Accident and the Death tile loses it. Add `doubl\w*|additional|extra|plus|uplift` to anyCause, or test whether the row starts with "death".
  - SGD default on the tile: accepted, since the tile text is the row's own figure.
- #143: no "Yi Chuen" anywhere. Names are now "Tan Jia Ming Raymond" and "Raymond Tan Jia Ming" (the reversed order is kept). READY.
- #144: every part word must match, and SIDE has the positional words; coverageFor uses only the row's own cover document (a name match, or its only coverage); covered() compares coverageId; DEATH_IDS covers all three death items; an unmatched death row is skipped when any death item exists. READY.
  - Low, fails safe (hides): "neck of femur" needs both words, so it misses a plain "Femur" or "Thigh (femur)" row. A cash, allowance or income item with no coverageId still hides hospital-cash rows on every cover.
- #145 ca5bef3 only merged B in. R226 is still open: FIGURE in answer-verification.ts still has an unguarded `(RM)\s?`, so "FORM 2" and "TERM 1" read as RM figures and refuse caps; normalizeCurrencyCode still has no "NZ$" alias.

## R228 — #143 eaa9a05: READY

- The delta is 6 run-record files (s47 live-1, live-2 and live-4, conv and run JSON, 48 lines each way). Only calculation ids change: kc85c31c5d6 becomes k46fc3b9ba9, and k7c2fc04d5c becomes k1283bcfe55. Each map key, calcId and result_id changes together, and neither old id is left anywhere in the tree.
- No Yi Chuen, Desmond or Charmaine is left. The builder reports scenario-replay 22/22, matching main.

## R229 — #142 bef4fba, #144 3d52bc1, #145 f578e12

Free review: delta read plus tsx probes of categoryOfBenefit, anyMoneyFigures and moneyFiguresIn (pg stubbed).

### #142: one medium, caused by my R227 suggestion

- Medium: the builder's reason for leaving out "additional" applies to "double" as well. Probe results:
  - "Double Indemnity Accidental Death Benefit" goes to Death.
  - "Accidental Death (double for public transport)" goes to Death.
  Both are accident-only riders, now on the Death tile. Count the uplift words only when the name opens with a plain death benefit:
  ```ts
  const uplift = /^\s*death(?:\s+benefit)?\b/i.test(paid) && /\b(?:doubl\w*|twice|uplift)\b/i.test(paid);
  const anyCause = (/\b(?:any\s+cause|all\s+causes|illness|sickness|disease|natural\s+causes?)\b/i.test(paid) || uplift) && !/\bpersonal\s+accident\b/i.test(benefit);
  ```
  With this, "Death benefit; doubled for accidental death" still goes to Death, and the two riders go to Personal Accident.
- Low: "Death from causes other than accident" goes to Personal Accident. The "other than" strip removes the words that make it not accident-only, but the PA regex still tests the full name. Test the PA regex on `paid`, or treat `other\s+than\s+accident` as any-cause.
- Low: "Death (including death due to injury)" goes to Personal Accident. Rare.
- Checked: "Additional Accidental Death Benefit" goes to PA, "Accidental Death (death from illness is not covered)" to PA, and "Death due to illness or accident" to Death.

### #144: READY

- otherSide stops "lower jaw" matching the "Upper jaw" row, and a row that prints both side words still matches. The only-coverage fallback now also needs the table to show one cover on that document.

### #145: READY (one low)

- FIGURE now has `(?<![A-Za-z])(RM)`. Probe: "claim FORM 2", "TERM 1" and "PLATFORM 3" give no money in either moneyFiguresIn or anyMoneyFigures. The NZ$ alias is in. The title filter refuses heading lines. ₹, USD-after-figure and RM caps are seen.
- Low, fails safe (hides): ANY_SIGN's bare `R` reads "Rider R1: up to S$50,000" as [1, 50000] and "Class R 2 up to S$500" as [2, 500], so a cap is refused. Require a thousands group for a bare R (rand), e.g. `R\s?\d{1,3}(?:[ ,]\d{3})+`, or drop it.

## R230 — #142 d71b7b9, #144 2eebb62, #145 f9d040e

Free review: delta read only.

- #145: READY. A bare R now counts only before a figure with a thousands group, and the third capture group is read in anyMoneyFigures. FIGURE_IN_CELL and LABEL_FIGURE never index groups, so the extra group is safe.
- #144: READY. A merged in; no change to table-benefits.ts.
- #142: one medium, the same kind as R229. The new "including … accident/injury" clause has no plain-death guard. "Accidental Death Benefit (including injury on public transport)" or "Accidental Death (including accidents abroad)" counts as any cause and lands on the Death tile, though it is an accident-only rider. Give it the uplift's guard:
  ```ts
  const plainDeath = /^\s*death(?:\s+benefit)?\b/i.test(paid);
  const uplift = plainDeath && /\b(?:doubl\w*|twice|uplift)\b/i.test(paid);
  const including = plainDeath && /\bincluding\b[^)]*\b(?:accident\w*|injur\w*)/i.test(paid);
  const anyCause = (uplift || including || /\b(?:any\s+cause|all\s+causes|illness|sickness|disease|natural\s+causes?)\b/i.test(paid)) && !/\bpersonal\s+accident\b/i.test(benefit);
  ```
  "Death (including death due to injury)" still goes to Death. Testing the PA regex on `paid` is right: "Death from causes other than accident" goes to Death. Otherwise READY.

## R231 — #142 09eef59, #144 ca6eb02: READY

- #142: plainDeath now guards both uplift and including, exactly as R230 wrote. A regression covers "Accidental Death Benefit (including injury on public transport)", which goes to PA, and "Death (including death due to injury)" still goes to Death. READY.
- #144: only merges in the A commit; table-benefits.ts is unchanged. READY.
- #145 f9d040e was READY at R230. The coming A merge needs only a delta glance.

## R232 — #142 cff9102, #144 8efb7a8, #145 a14a15e: READY (lows on #142)

Free review: delta read plus a tsx probe of categoryOfBenefit on 20 names.

- #142: causeOf is an allow-list that defaults to accident only, so an accident-only rider never lands on the Death or TPD tile. That is the right direction. These go right:
  - to PA: "Double Indemnity Accidental Death Benefit", "Accidental Death (including injury abroad)", "Accidental death or dismemberment";
  - to Death: "Death (including death due to injury)", "Death benefit, doubled for accidental death", "Non-accidental death", "Death from causes other than accident", "Death (accident or illness)";
  - to TPD: "TPD due to sickness or injury".
  - Low, any-cause rows mislabelled as PA (shown on the PA tile, missing from Death):
    - (a) ACCIDENT_ONLY wins over ANY_CAUSE, and its "only" can sit anywhere on the line. So "Death due to illness or accident, payable only once" and "Death benefit (any cause); accidental death benefit payable only to age 70" go to PA. Tie "only/solely/exclusively" to the accident word, e.g. `\b(?:only|solely|exclusively)\s+(?:\w+\s+){0,3}?(?:by\s+|from\s+|due\s+to\s+)?(?:an?\s+)?${ACC}|\b${ACC}\s+(?:\w+\s+){0,1}(?:only|solely|exclusively)\b`.
    - (b) Phrasings the allow-list doesn't know: "natural causes or accident", "accidental or otherwise", "2x for accidental death", "200% if accidental".
- #144: merge only. READY.
- #145: a bare R after or/and/to/max, plus a second pass once any rand figure is found, catches "up to R100,000 or R900" (two values, so the cap is refused). An extra "R1" label in such a text only withholds an amount. Superscripts are stripped the same way in moneyIn and capInRow, so the indexes still line up. READY.

## R233 — #142 ed43151: READY (#144 bd2c3d0, #145 d979758 are merges only)

- I re-ran the 20-name probe from R232 plus 7 new ones. Both R232 (a) names and all four (b) phrasings now go to Death or TPD. Every accident-only rider stays Personal Accident: "Double Indemnity…", "(including injury abroad)", "(2x on public transport)", "(pays 200% if on public transport)", "unless death is due to illness", "illness excluded", "natural causes excluded" and "other causes not covered". READY.

## R234 — #142 56c9434: NOT READY (one high; #144 e0d0ab7, #145 725af0f merges only, READY)

Free review: tsx probe of categoryOfBenefit on 48 names (R232/R233 set plus round-4 cases).

- High, the round-4 defect without brackets: the head check runs ILLNESS_ONLY before it tests for an accident word, and the head only ends at a bracket, dash, comma, semicolon or colon. So an exclusion clause with no punctuation still makes an accident rider "illness only" and puts it on the Death tile. Probe:
  - "Accidental Death excluding injury from war" goes to Death.
  - "Accidental Death other than injury from war" goes to Death.
  - "Accidental death except injury from riots" goes to Death.
  - "Accidental Death Benefit excluding injuries sustained while racing" goes to Death.
  Fix: decide on the words before any exclusion word, before ILLNESS_ONLY runs:
  ```ts
  const lead = head.split(/\b(?:excluding|except|other\s+than|unless|but\s+not)\b/i)[0];
  if (/\bnon-?\s?accident/i.test(lead)) return "illness";
  if (new RegExp(String.raw`\b${ACC}`, "i").test(lead) && !ANY_CAUSE.test(lead)) return "accident";
  // then the existing ILLNESS_ONLY / ANY_CAUSE / ACC tests on head
  ```
  Results with this: "Death other than by accident" has no accident word in its lead, so ILLNESS_ONLY makes it Death. "Non-accidental death" goes to illness. "Accidental and Sickness Death Benefit" has ANY_CAUSE in the lead, so it goes to Death.
- Low (fails toward PA, so an any-cause row is missing from the Death tile): "Death and Accidental Death Benefit" (a combined row), "Death by accident, illness or otherwise" (the comma cuts the head) and "Death benefit (100%) accidental death 200%".
- Every R232/R233 name, plus the round-4 bracket and dash cases, gives the expected tile.

## R235 — #142 b113b93: READY (#144 3b18e52, #145 298c402 merges only, READY)

- The R234 lead check went in word for word. Re-ran the 48-name probe plus 6 exclusion cases with no brackets. All four R234 probes now go to Personal Accident. "Non-accidental death", "Death, other than by accident" and "Accidental and Sickness Death Benefit" go to Death, and every R232/R233/round-4 name gives the same tile as before. The three lows are left as is; they fail toward PA, and I accept that.

## R236 — #142 5f354fb: READY (#144 8871cf3, #145 d4007e7 merges only, READY)

- The 42 names from R232 to R235 give identical output (diffed). Both round-5 cases ("…not payable for illness or injury caused by war", "…; sickness or injury from war excluded") and all six no-bracket exclusions go to PA. Pairs at the start ("Injury or illness death benefit", "Sickness and Accident Death Benefit") and pairs right after the death words go to Death.
- Low, fails toward PA (an any-cause row is missing from Death or TPD): PAIR_AFTER_DEATH misses:
  - "Death benefit for illness or accident" ("for" is not in the preposition list);
  - "Total Permanent Disability due to illness or accident" (it needs "total and permanent");
  - "Death or TPD by illness or accident" (a compound head).
  Suggest adding `for`, `total\s+(?:(?:and|&)\s+)?permanent`, and an optional `(?:death|tpd)\s+(?:or|and|&|/)\s+` before the death words.

## R238 — #147 0330ab1 (Home tile figures on 31357e4): NOT READY (one medium)

Ran here: npm ci and `next build` (pass), coverage:table-test 22/0, plus a tsx probe with a made-up household (Harbour Staff Scheme). The prod rows file was read only for its shape and is not quoted here.

- Expected results reproduce. S$30 a day (from day 11, up to 30 days) plus the same figure with a bare $ on the same cover, plus a travel "while overseas" row, gives "S$30 a day · from day 11 · up to 30 days". Travel-only cover still shows its own figure.
- Bare $ (Q1): restatedWithCurrency drops a bare-$ row only for the same coverKey, kind, amount, unit, period, fromDay, maxDays, qualifier and pays. A bare row on another cover gives null (Covered), and a bare row with a different fromDay gives null. Correct.
- Medium, a limit is lost (Q4). Days and qualifier are compared, but conditions are not, so a limit printed only as a condition disappears from the tile. Probe:
  - The S$ row plus a bare-$ restatement carrying "Max 6 claims per policy year": the restatement is dropped, so the tile reads "S$30 a day · from day 11 · up to 30 days" with no claim limit.
  - Two covers, both S$30 from day 11, one with "Max 6 claims per policy year": the conditions differ, so they are dropped, giving the same text with no limit.
  Fix: compare the limiting conditions and ignore only wording such as exclusions:
  ```ts
  const LIMIT = /\d|\b(?:max(?:imum)?|up\s+to|limit\w*|only|once|per\s+(?:policy\s+)?(?:year|claim|event|admission|confinement|life))\b/i;
  const limits = (r: SummaryRow) => r.conditions.filter((c) => LIMIT.test(c)).sort().join(" · ");
  // restatedWithCurrency: also require limits(s) === limits(r)
  // tableDisplay: if (new Set(rows.map(limits)).size > 1) return null;  // Covered; the Coverage page lists each row
  ```
  The expected strings are unchanged by this. The bare row's extra condition is a self-inflicted-injury/maternity exclusion, with no digit or limit word, so it still drops. Add the two probes above as regressions.
- Waivers, trip-only and clause rows (Q2): left out only when another row remains; the Coverage page keeps them. Correct.
- Accident sections (Q3): "TPD" under "Personal accident" goes to PA; under "Accident and Sickness Benefits" it stays TPD; "Death" under "Death and Accidental Death" stays Death. Low: an explicit any-cause row under an accident section ("Death benefit (any cause)" under "Accident Benefits") goes to PA. Skip the section rule when the row's own name matches ANY_CAUSE.

## R239 — #147 069e483: one small fix left

- LIMIT is now compared in both restatedWithCurrency and tableDisplay, and an ANY_CAUSE name keeps its category under an accident section. Both R238 findings are fixed. I accept that a numeric non-limit condition now blocks an otherwise matching figure: it fails safe and is tested.
- Medium, the same class of bug, one step on: the limits must agree, but the display still shows conditions only when the whole condition lists are identical. Two rows that both print "Max 6 claims per policy year", where one also prints an exclusion, pass the limits check. Their condition lists differ, so the tile shows the figure without "Max 6 claims". Fix: when the lists differ, show the agreed limits:
  ```ts
  const shown = conditions.size === 1 ? [...conditions][0] : limits(rows[0]);
  return [[...texts][0], shown].filter(Boolean).join(" · ");
  ```
  The expected live strings are unchanged: Desmond's kept S$ row has no conditions, and the dropped bare row's extra condition is an exclusion. Add a regression for this case. With that, READY.

## R240 — #147 d942627: READY

- The R239 change went in as written: when the condition wording differs, the tile shows the shared limits. A regression covers two rows that both print "Max 6" where one also has an exclusion. With R238 and R239, a tile figure can no longer lose a fromDay, maxDays, qualifier or limiting condition, and it never takes another cover's terms (a bare $ restatement counts only on the same cover). I ran next build on 0330ab1. The delta since then touches only lib/coverage/table-figures.ts, plain TS with no new imports.

## R241 — #147 9d62193 (every condition is a limit unless plainly eligibility): NOT READY (one high)

Free review: I ran ELIGIBILITY, CHANGES_AMOUNT, TRIP_ONLY and ALSO_ABROAD, extracted from the head, on made-up conditions. I accept that my R238 keyword LIMIT rule was the wrong design (TE P147-5). The inverted rule is the right shape, but its eligibility side is still too broad.

- High, the full amount shows (the same class as P147-5). The `excluding/excludes` and `no/not … payable/covered` alternatives accept any clause, and CHANGES_AMOUNT is still a deny-list. These amount-changing conditions are IGNORED, so the tile keeps the full figure:
  - "Excluding amounts paid under the early critical illness benefit" (an accelerated deduction)
  - "Not payable in excess of the actual charges incurred"
  - "No benefit is payable for the portion exceeding reasonable charges"
  - "Excluding any amount reimbursed by other insurers"
  - "No benefit payable to the extent covered by another policy"
  - "Admitted as an inpatient; the benefit is net of any government subsidy"
  - "Continuous confinement; payable as a proportion of the sum insured"
  - "Confined continuously; payable at the ward-class rate"
  - "Not payable where another benefit under this policy has been paid"
  - "Excludes any bonus"
  Fix: an eligibility condition may not mention money or another benefit at all. Add to CHANGES_AMOUNT:
  ```ts
  |\b(?:amounts?|sums?|portion|proportion\w*|exceed\w*|excess|net\s+of|reimburs\w*|subsid\w*|already\s+paid|paid\s+under|in\s+addition|rates?|bonus\w*|values?|charges?|costs?|expenses?|pro[\s-]?rat\w*|shared?|aggregate|combined|offset|balance|remaining|salary|income|earnings)\b|\b(?:other|another)\s+(?:insurer\w*|insurance|polic\w*|benefits?|plans?)\b
  ```
  Better still, narrow the two broad alternatives to cause clauses, e.g. `^\s*(?:no|not)\b[^.]*\b(?:payable|covered)\s+(?:for|if|when|where\s+the\s+(?:insured|life)|due\s+to|arising|caused|resulting|in\s+respect\s+of\s+(?!amounts?))`. With both, the fixes stay on the safe side: anything unplaced gives Covered. "No benefit for self-inflicted injuries", "Excluding pregnancy", "Hospitalised as an inpatient" and "Not payable if the insured is outside Singapore" stay harmless, so the live J1 case keeps its figure.
- Low (Q3): ALSO_ABROAD's bare `and` turns trip rows into standing cover. "Daily hospital cash while overseas and travelling" and "Hospital cash when you travel and are admitted abroad" become STANDING. Accept and/or only after a home word: `(?:at\s+home|locally|in\s+[A-Z]\w+)\s+(?:and|or)\s+(?:overseas|abroad)`, plus the including/also/as-well-as forms.
- CLAUSE now needs threshold wording, so "Daily Hospital Cash S$80 per day" stays a benefit. Correct.

## R242: #147 Home tiles at ad30d58 (strict eligibility allow-list): NOT READY, one High

Checked for free: tsx probes of the new `isEligibility`/`tripOnly` on 46 condition and 15 benefit-name phrasings; `coverage-table-figures-regressions.ts` 25/0; `tsc` clean; `next build` passes (npm ci in a scratch worktree).

Fixed and confirmed:
- All 10 R241 phrasings and all 3 TE P147-5 phrasings ("reduced by half after age sixty-five", "less any amount already paid", "the higher of this amount or the account value") are now limits, so the tile gives no figure unless every row prints it.
- The stay/standing shape is a true allow-list (`STANDING_WORDS`, every word must be in the set). It holds no amount words, so nothing amount-changing can be built from it. Correct design.
- "while overseas and travelling" is trip-only again. "in Singapore and overseas", "at home and abroad", "including while overseas" stay standing cover.
- Harmless controls keep the figure: "No benefit for self-inflicted injuries", "Excluding pregnancy", "Hospitalised as an inpatient", "Inpatient only", "Admitted on the advice of a registered medical practitioner", "Excluding war and terrorism", "No benefit if the illness is pre-existing".

- **High (Q1): the cause shape is still a deny-list.** `NOT_A_CAUSE` lists amount words to refuse, so any amount change worded outside the list passes as harmless and the full figure shows. This was my own R241 suggestion; it repeats the R238 mistake. Each of these is ELIGIBILITY at ad30d58 (the tile would print the full figure when another row lacks it):
  - "Excluding outstanding loans and interest", "Excluding indebtedness to the company", "Excluding unpaid premiums", "Excluding outstanding premium arrears", "Not payable for interest accrued" (life death benefits are paid net of these)
  - "Excluding copayment", "Excluding coinsurance" (no word boundary before `pay`/`insur`)
  - "Excluding the balance", "Excluding the shortfall", "Excluding the remainder", "No benefit for the top-up"
  - "Excluding fifty dollars of each claim", "Excluding one hundred ringgit" (spelled-out figure and currency word)
  - "Excluding the surrender value", "Excluding partial surrenders", "Excluding withdrawals made"
  - "No benefit for subsequent claims", "No benefit for the second and further disabilities" (a count limit, like "once")
  - Fix: give the cause the same design as the stay shape. Every word of the cause must be in a fixed set of risk words plus function words. Anything else is a limit:
  ```ts
  const CAUSE_WORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "by", "from", "in", "on", "under", "with", "while", "is", "are", "was", "be", "being", "any", "if", "its", "their", "his", "her",
    "self", "inflicted", "self-inflicted", "intentional", "intentionally", "deliberate", "injury", "injuries", "suicide", "attempted",
    "war", "terrorism", "riot", "riots", "strike", "strikes", "civil", "commotion", "invasion", "hostilities", "rebellion", "nuclear", "radiation", "radioactive", "contamination",
    "pregnancy", "childbirth", "miscarriage", "abortion", "infertility", "sterilisation", "sterilization", "contraception",
    "pre-existing", "preexisting", "existing", "condition", "conditions", "illness", "illnesses", "disease", "diseases", "disorder", "disorders", "congenital", "hereditary",
    "cosmetic", "plastic", "surgery", "dental", "treatment", "treatments", "outpatient", "experimental", "elective", "mental", "psychiatric", "nervous",
    "alcohol", "alcoholism", "drugs", "drug", "narcotics", "intoxication", "influence", "abuse", "hiv", "aids", "sexually", "transmitted",
    "hazardous", "dangerous", "sports", "sport", "activities", "activity", "aviation", "flying", "racing", "diving", "mountaineering", "professional",
    "criminal", "unlawful", "illegal", "act", "acts", "participation", "provoked", "assault"]);
  function isCause(cause: string): boolean {
    const words = cause.toLowerCase().replace(/[.,;:()]/g, " ").split(/\s+/).filter(Boolean);
    return words.length > 0 && words.every((w) => CAUSE_WORDS.has(w));
  }
  // in isEligibility: if (head) return isCause(c.slice(head[0].length));
  ```
  The safe side holds: an unlisted risk word ("Excluding skydiving") only drops the figure when rows differ, never shows a wrong one. Gate it with the list above as limits and the controls above as eligibility.
- Low (Q2, over-block): "Not payable if the insured is outside Singapore" is now a limit (`insur\w*`). With the word set above it stays a limit too. That is acceptable: it only drops the figure when rows differ. The live J1 regression case still passes.
- Medium (Q3, pre-existing gap now visible): `TRIP_ONLY` only knows "while/when (you are) overseas/abroad/travel…". So "Hospital cash when you travel", "Hospital cash whilst on holiday abroad", "Hospital cash overseas" and "Hospital cash abroad" count as standing cover, and a trip-only row can decide the Home tile. Fix: `\b(?:while|whilst|when)\s+(?:you\s+(?:are\s+)?)?(?:\w+\s+){0,2}?(?:overseas|abroad|travel\w*)\b|\b(?:during|on)\s+(?:the|your|a)\s+(?:trip|journey|holiday)\b|\boverseas\s+(?:only|travel)\b|^[^,;(]*\b(?:overseas|abroad)\s*$`, keeping ALSO_ABROAD/HOME_AND_ABROAD as the overrides.
- Low: "Hospital cash while abroad or at home" stays trip-only (home word after). This hides the row; it never shows a wrong figure. Optional: also accept `(?:overseas|abroad)\s+(?:and|or)\s+(?:at\s+home|locally)`.

Verdict: NOT READY. Fix Q1 (word allow-list for the cause) and Q3; Q2 and the last Low are optional.

## R243: #147 Home tiles at 34f5a8a (rows dropped per cover; travel known by cover name): NOT READY, one High

Checked for free:
- tsx probes of the real `tileRows`/`tableDisplay` with made-up two-cover households;
- node probes of the new cause and stay rules, rerun on all R241/R242 phrasings;
- `coverage-table-figures-regressions.ts` 25/0, `te-pr147b-test.ts` 51/0, `te-pr147c-test.ts` 39/0;
- `tsc` clean, `next build` passes.

Fixed and confirmed:
- All 20 R242 adversarial causes are now limits: loans, unpaid premiums, indebtedness, copayment, coinsurance, balance, shortfall, "fifty dollars", "one hundred ringgit", subsequent/second claims, surrender value, withdrawals. The R241 ten and the TE P147-5 three stay limits.
- `CAUSE_WORDS` and `STANDING_WORDS` are both word allow-lists, and the count words are a closed class. Correct design.
- A row is dropped by its wording only within its own cover. Another cover is dropped only as a whole (travel, or waiver-only). A phrasing no rule knows now gives "Covered", not a wrong figure. Good structure. The trip-wording regexes and their R242 Q3 gaps are gone.

- **High (Q1): `TRAVEL_COVER` misfires on employer and product names, and a whole standing cover then drops out of the tile.** It tests `product + cover + plan` for a bare `travel*|trips?|journeys?|holidays?`. A group scheme's product name usually carries the employer's name, so these count as travel: "Holiday Inn Group Insurance / Group Term Life", "Trip.com Group Employee Benefits / Group Hospital & Surgical", "Sunrise Travel & Tours Staff Scheme / Group Personal Accident". Personal products count too: "Life Journey Protector", "Premium Holiday Saver", "Journey Critical Illness Plan".
  - Real outcome (made-up household): GTL Death S$500,000 under "Holiday Inn Group Insurance" plus whole life Death S$200,000. The Death tile shows **S$200,000**; the control with a plain employer name shows no single figure. The tile hides S$500,000 of documented cover and reads as the person's whole death cover. "Sunrise Travel & Tours Staff Scheme" gives the same result. "Life Journey Protector" 200k + GTL 500k gives S$500,000.
  - Fix: decide travel on the cover's own name and plan first, and on the product only when it is not a scheme name. Drop the bare trip/journey/holiday words:
  ```ts
  const TRAVEL_COVER = /\btravel\w*|\b(?:single|annual|multi)[\s-]?trips?\b|\b(?:holiday|journey|trip)\s+(?:insurance|cover|plan|policy)\b/i;
  const SCHEME_NAME = /\b(?:group|scheme|staff|employees?|members?|corporate|company|benefits?\s+(?:programme|program|plan))\b/i;
  const isTravelCover = (r: CoverRow) => TRAVEL_COVER.test(r.cover ?? "") || TRAVEL_COVER.test(r.plan ?? "")
    || (TRAVEL_COVER.test(r.product ?? "") && !SCHEME_NAME.test(r.product ?? ""));
  ```
  Probed: the 6 misfires above become standing cover. These stay travel: "TravelEasy", "Single Trip Plan", "Annual Multi-Trip Plan", "Holiday Insurance", "Overseas Travel Insurance", and a scheme's own "Group Business Travel Accident" or "Business Travel Cover" line. Gate it with the employer-name household above (expected: no single Death figure) in SG/MY/UK.
- Low (Q2, missed travel, safe side): "SmartTraveller", "Overseas Guard Plan", "Takaful Perjalanan" and "Assurance Voyage" are not travel. With other cover that gives "Covered", never a wrong figure. Optional for other markets: add `perjalanan|voyage|viaje|reise\w*`.
- Low (Q3, over-block, safe side): these are now limits, so the figure drops when rows differ:
  - "No benefit if the illness is pre-existing" (`is`)
  - "Excluding outpatient treatment" (`outpatient`)
  - "Excluding pregnancy, childbirth and miscarriage" (comma rule)
  - "No benefit for death due to suicide (including attempted suicide)" (`death`)
  - "Not payable if the insured is outside Singapore"
  Optional: add `is`, `are`, `outpatient`, `death`, `deaths`, and allow a comma list made only of cause words. The live J1 case still passes.

Verdict: NOT READY on Q1 alone; Q2 and Q3 are optional.

## R244: #147 Home tiles at ee1e2f9 (travel = travel name AND an abroad row): NOT READY, one High

Checked for free:
- tsx probes of the real `tileRows`/`tableDisplay`, with a standing group hospital cash S$30 a day beside a second cover paying S$100 a day;
- regressions 25/0, te-pr147b 54/0, te-pr147c 39/0, te-pr147d 51/0;
- `tsc` clean, `next build` passes.

Fixed and confirmed:
- Employer-name schemes stay in: "Holiday Inn Group Insurance", "Sunny Holidays Group Insurance" and "Trip.com Group …" give no single figure.
- The two-signal design is right: when unsure, the cover stays in and the tile gives "Covered".
- The new `plainCondition` only ignores case, spacing and a closing stop. The display still prints the first row's own wording. Fine.

- **High (Q1): the abroad signal is any mention of "overseas", so a standing cover that also pays overseas can still drop out.** `ABROAD_ROW` matches bare `overseas|abroad`, so "Hospital cash in Singapore and overseas" and "Hospital cash including overseas" count as rows that pay only abroad. `TRAVEL_NAME` also accepts "journey/holiday/trip" + plan|protection|assurance|guard, and `SCHEME_NAME` lacks "corporate". Probed outcomes beside the S$30 group cover:
  - "Life Journey Plan / Basic", row "Hospital cash in Singapore and overseas" S$100 a day: tile shows **S$30 a day** (hides S$100 of standing cover)
  - "Travel Guard Corporate Medical / Hospital", row "Hospital cash including overseas" S$100: tile shows **S$30 a day**
  - Control "Travel insurance / Single Trip", row "Daily hospital cash while overseas": S$30 a day, which is correct.
  - Fix: make the row signal mean "pays only abroad", and the name signal a travel product. Both are probed:
  ```ts
  const TRAVEL_NAME = /\btravel\w*|\b(?:single|annual|multi)[\s-]*trips?\b|\b(?:holiday|trip)\s+(?:insurance|cover)\b/i;
  const SCHEME_NAME = /\b(?:group|scheme|staff|employees?|corporate|company|members?)\b/i;
  const ONLY_ABROAD = /\b(?:while|whilst|when)\s+(?:you\s+are\s+)?(?:overseas|abroad|travel\w*)\b|\bduring\s+(?:the|your|a)\s+(?:trip|journey)\b/i;
  const ALSO_HOME = /\b(?:including|incl\.?|also|even|as\s+well\s+as)\b|\b(?:or|and|&)\s+(?:at\s+home|locally|in\s+[A-Z])|\b(?:at\s+home|locally|in\s+[A-Z][\w-]*)\s+(?:and|or|&)\b/;
  const abroadOnly = (b: string) => ONLY_ABROAD.test(b) && !ALSO_HOME.test(b);
  ```
  Probed: Life Journey Plan, Travel Guard Corporate Medical, Life Journey Saver ("while overseas or at home") and "while overseas, including at home" stay in. Travel insurance/Single Trip, TravelEasy, Travel Guard/Annual Multi-Trip and "during the trip" count as travel. With the stricter row signal, `\btravel\w*` can safely take one-word brands ("TravelEasy"), which the ee1e2f9 name rule misses, giving "Covered".
- Verify before merge (I could not check this; the auto-mode safety check refused my read of the private live rows): the live travel cover's product/cover/plan must match the travel name rule. Otherwise the live J1 Hospital Cash tile gives "Covered" instead of "S$30 a day · from day 11 · up to 30 days". The regression fixture uses the friendly name "Travel insurance / Single Trip". The builder or the Live site tester should confirm against the live names.
- Low, safe side: "SmartTraveller" and "Overseas Protection" are not travel. Beside other cover that gives "Covered".

Verdict: NOT READY on Q1. After the Q1 fix, plus the live-name check, I expect READY.

## R245: #147 Home tiles at 724ba9d (every row abroad-only + strict travel name): READY

Checked for free:
- Suites: regressions 25/0, te-pr147 78/0, te-pr147b 54/0, te-pr147c 39/0, te-pr147d 69/0 with 3 notes;
- `tsc` clean, `next build` passes;
- tsx probes of the real `tileRows`/`tableDisplay` with a standing S$30 a day group cover beside a second cover paying S$100.

Probe results:
- Live-shaped travel cover ("Travel insurance summary / Single Trip / Business", "Daily hospital cash while overseas"): S$30 a day. This matches the builder's live check: Hospital Cash S$30 a day, TPD S$1,000,000 (the travel TPD sits under personal accident).
- The R244 misfires now stay in and give no single figure: "Life Journey Plan" + "in Singapore and overseas", and "Travel Guard Corporate Medical" + "including overseas".
- These also stay in and give no single figure: employer "Holiday Inn Group Insurance" + "while overseas", "In Malaysia or while overseas", "while overseas or at home".
- The cause and stay rules are unchanged since R243; all R241/R242 limits stay gated.

Remaining, all on the safe side (the tile shows "Covered", never a wrong figure):
- One-word travel brands ("TravelEasy", "SmartTraveller") are not travel.
- The TE notes V3 (SG/MY/UK): a group scheme's business travel line beside standing cover gives no figure.
- The R243 Q3 cause over-blocks.
None of these blocks merge.

Verdict: READY at 724ba9d.

## R246: #148 Home tiles, a confirmed total shows only when every cover is accounted for (e1ea28c): NOT READY, one High

Checked for free:
- regressions 49/0, te-pr147 78/0, te-pr147b 54/0, te-pr147c 39/0, te-pr147d 78/0 (6 known safe-side travel notes);
- `tsc` clean, `next build` passes;
- tsx probes of `confirmedTotalComplete` with made-up households.

I did not open the live rows file (private household data). Before/after claims are taken from the builder's note.

The direction is right. The old tile summed confirmed lines and ignored a cover only the benefit table knows, so a part sum read as the whole (live: S$100,000 shown against S$1,100,000). This PR only ever turns a figure into "Covered", so it adds no new wrong amount except through Q1. A confirmed line with no amount now also gives "Covered" instead of a part sum. Good. `source.documentId` and `policies.id` are the same id space, so the document match is sound.

- **High (Q1): the amount fallback can still pass a part sum as the whole, by coincidence of equal round sums.** A table cover with no row from a confirmed line's document is "accounted for" by any unused confirmed line, from any insurer, whose amount and currency equal one of its figures. Probes (`confirmedTotalComplete` → true, so the old total shows):
  - A: confirmed term S$500,000 (its document gives no TPD row) plus group TPD S$500,000, printed only in a scheme summary. The tile shows S$500,000; the real cover is S$1,000,000. This is the same defect the PR fixes, surviving on a coincidence.
  - E: two confirmed S$200,000 lines plus one group S$200,000 cover shows S$400,000; the real cover is S$600,000.
  - Fix:
    1. Match a cover first by its own document: `person.covers[].source.documentId`, the page that names the person with that cover. Today the match uses the benefit rows' source, which is often the wording or a summary, not the schedule.
    2. Allow the amount fallback only when the line and the cover are the same product. Product words must be equal, as in `wordingDescribes`; insurer or group number must not differ.
    Sketch:
  ```ts
  export type ConfirmedLine = { documentIds: string[]; amount: number | null; currency: string; productName?: string | null };
  export function confirmedTotalComplete(rows: TileRow[], lines: ConfirmedLine[], coverDocs = new Map<string, string>()): boolean {
    // docs of a cover = its rows' sources + its own cover document
    const docsOf = (list: TileRow[]) => new Set([...list.map(doc), coverDocs.get(list[0].coverKey ?? "")].filter(Boolean) as string[]);
    // inTable = union of docsOf over all covers
    // own = lines.filter((l) => l.documentIds.some((d) => docsOf(list).has(d)))
    // free match additionally: productWords(l.productName).join(" ") === productWords(list[0].product).join(" ") (both non-empty)
  }
  // route: coverDocs = new Map(person.covers.map((c) => [c.coverKey, c.source.documentId])); lines carry productName: x.productName
  ```
  Probe D shows the same change also fixes an over-hide. A personal policy whose TPD row comes from its wording as "100% of sum assured" with no worked figure gives "Covered" today, though its schedule is the confirmed line; by cover document it is accounted for. Gate A, D and E, plus the Charmaine shape (AIA S$100,000 confirmed + group S$1,000,000 → Covered), in SG/MY/UK.
- Medium (Q2, live check): with Q1 the Charmaine PA S$600,000 must still match through the group cover's own document or same product name. If the live cover document is the scheme summary under a different product name, PA turns to "Covered" too. That is the safe side, but it adds a seventh hidden figure. The builder should confirm on the live covers' `source.documentId`.
- Low (Q3): Desmond's PA turns to "Covered" because of a single-trip travel cover whose rows are not all abroad-only. That is consistent with #147 (when unsure, the cover stays in). Dropping ended single-trip policies at intake, as the builder notes, is the right place.

On "at least S$X, more cover on Coverage": I recommend against it as the tile headline. The confirmed part is often the small part: Charmaine TPD would read "at least S$100,000" against S$1,100,000. A number on a tile is read as the amount, whatever qualifier sits beside it. The rules say a wrong claimable amount is the worst bug, and an 11× understatement shown as a floor is close to one. "Covered" plus the per-cover figures on Coverage is honest.
The useful next step is a **sum rule** for lump-sum categories only (Death, TPD, CI, early CI, PA), which pay out independently. Show the total only when every paying cover gives exactly one plain lump-sum figure: its confirmed line, or one SUM row on its own document with no limits, all in one currency. Otherwise show "Covered". That gives Charmaine TPD S$1,100,000 and Desmond Death S$1,005,000, and never sums hospital or indemnity figures. That is DC's call on the decision card; it is not a blocker for #148.

Verdict: NOT READY on Q1.

## R247: #148 sum rule for lump-sum tiles (2d9d127): NOT READY, two High

Checked for free (no paid calls):
- regressions 73/0, te-pr147 78/0, te-pr147b 54/0, te-pr147c 39/0, te-pr147d 78/0 (6 known safe-side notes);
- `tsc` clean, `next build` passes;
- tsx probes of `lumpSumParts`/`categoryOfBenefit` with made-up households;
- the builder's before/after note. I did not open the private live rows.

Fixed and confirmed: the R246 cases. Equal amounts no longer join covers: a confirmed term S$500,000 plus a group S$500,000 now totals S$1,000,000, and two S$200,000 lines plus a group S$200,000 total S$600,000. Hospital and per-day categories are never added. A cover with no single plain sum is named with no amount, and then there is no total.

- **High (Q1, live): an accident-only confirmed line is added to any-cause cover.** Confirmed schedule lines are added by their stored category, without the benefit-name classifier the table rows go through. The before/after gives Charmaine's TPD as **S$1,100,000** = "Total Disability Acc - Max S$100,000" + Group Term Life S$1,000,000. "Acc" is accident, so a TPD from illness pays S$1,000,000, not S$1,100,000. That overstates the claimable amount, the worst bug class.
  - `categoryOfBenefit` returns null for "Total Disability Acc - Max S$100,000", "Total Disability Acc" and "AD&D": `ACC` knows only `accident\w*|injur…`.
  - Probe: `lumpSumParts` with that line plus a GTL S$1,000,000 cover gives total 1,100,000.
  - The same risk sits in Charmaine's Death S$1,149,000: the AIA S$100,000 part is on the same AIA policy as the "Acc" line. The builder should list the stored line names for both tiles.
  - Fix:
    - (a) Add the abbreviations to `ACC`: `\bacc\b\.?|\bad&d\b|\baccidental\b`.
    - (b) Classify each confirmed line's own name in the dashboard: `const placed = categoryOfBenefit(x.productName ?? "")`. A line placed in another category (PA) is not added to Death/TPD/CI; it is added in the category it is placed in, when that is a lump sum. A line whose name carries an accident word but cannot be placed is a part with no amount, so there is no total.
    - A line whose name is a plain product name (no benefit words) keeps its stored category. Refusing those would hide almost every confirmed sum.
    - Gate: "Total Disability Acc - Max S$100,000", "Accidental Death", "Death (Accident)", "AD&D", "Accidental TPD" as lines beside a GTL cover must never raise the Death/TPD total, in SG/MY/UK.
- **High (Q2): two covers on one policy document get one line, and the result depends on cover order.** `selected` keeps one line per policy and category, and `lumpSumParts` gives that line to the first cover whose document matches, whatever its amount. Probe: one certificate with GTL S$1,000,000 and a top-up S$500,000; the selected line is GTL 1,000,000.
  - With the top-up first: total **S$2,000,000** (the line is counted, then GTL is added again as its own part).
  - With GTL first: S$1,500,000, which is correct.
  - Fix: when several covers share the line's document, give the line only to the cover whose sum insured (`held.sumInsured`) or single plain figure equals the line's amount. If none or more than one match, those covers and the line become parts with no amount, so there is no total.
- Medium (Q3): one cover read under two names is added twice. The certificate's "Group Term Life" and another person-naming page's "GTL" (two cover keys, same S$1,000,000) give **S$2,000,000**, with or without a confirmed line. I have not seen this live; covers are only read from pages that name the person. Guard: two parts with the same amount and currency whose product words agree (`productWords`, which already expands GTL/GPA/GHS) give no total, with both still named. This never joins different products, so it does not bring back the R246 equal-amount problem.
- Low: the hand-applied before/after lacks cover keys. After the fixes, the builder should re-derive Charmaine's Death, TPD and PA and Desmond's Death and CI from the stored covers, not by hand, before DC sees numbers.

Verdict: NOT READY on Q1 and Q2. Q3 is recommended.

## R248: #148 at 450969f (c446c2b + match by the cover's sum insured): READY, with two Mediums

Checked for free:
- regressions 82/0, te-pr147 78/0, te-pr147b 54/0, te-pr147c 39/0, te-pr147d 78/0 (6 known notes), te-pr148b 87/0 (3 notes, see Q4);
- `tsc` clean, `next build` passes;
- tsx probes of `lumpSumParts`.

Fixed and confirmed:
- R247 Q2: one certificate with GTL S$1,000,000 and a top-up S$500,000 now gives S$1,500,000 in either cover order.
- R247 Q3: "Group Term Life" and "GTL" with the same sum give no total, both named, with or without a line.
- R246 A (term S$500,000 + group S$500,000 only in the table): no total, both named. That is the safe side.
- 450969f: a group PA certificate line of S$600,000 matches its cover by sum insured even though the cover prints several sums, so the total is S$600,000. If the sum insured differs from the line: no total, both named.

- **Q1 (R247), settled: I withdraw the High for the live tile.** I could not read the stored page text: the auto-mode safety check refused my narrow search of the private live files, and I did not work around it.
  - The builder's reading is specific: "TOTAL DISABILITY ACC - MAX" = AIA's "Total Disability Accelerator – Max", page 27, Ref 2213S, matching the schedule code on page 1.
  - An accelerator is any-cause TPD that pays the base sum early, so Charmaine's TPD S$1,100,000 = S$100,000 + S$1,000,000 is right. An accelerator means the AIA S$100,000 is paid once, for TPD or death, not both. Each tile on its own is still right.
  - My R247 suggestion to treat "acc" as an accident word was wrong and must not be applied: it would class this accelerator as accident-only and hide the S$100,000.
  - A free check by the Evidence Reviewer of the page 27 wording would close it.
- Medium (Q1b, generic, not live): a confirmed line whose own name says accident still adds into Death/TPD. Probe: line "Accidental Total Disability" S$100,000 + GTL S$1,000,000 gives a TPD total of S$1,100,000. Fix: pass each line's name through `categoryOfBenefit`. A line it places in another category ("Accidental Total Disability", "Accidental Death" → Personal Accident) is not added here. Names it cannot place keep their stored category. This uses the existing classifier and adds no new abbreviation list.
- Medium (Q4, TE note P3, pre-existing): two separate policies of the same product and the same sum collapse into one. `coverKeyOf` is product|cover|plan with no policy number, and `assemble` skips a second cover with the same key and sum. So the tile shows S$100,000 as the total of two S$100,000 policies, a part sum shown as the whole. The fix belongs in `coverKeyOf`/`assemble` (add the policy number when printed), not in the tile rule. Track it as a separate PR.
- Low: when the sum insured matches the line but the cover's single printed sum differs, the line wins. Probe: SI S$200,000, death row S$300,000 → S$200,000. Optional: `sums.size === 1 && !fits` after an SI match gives no total. That keeps the multi-sum PA case working.
- Low: a line and its matched cover are not compared on currency. The line's stored currency defaults to SGD when none is stored.

Verdict: READY at 450969f. Q1b and Q4 are recommended follow-ups, and a live check after the merge stays required (the builder's before/after is a prediction).

## R249: #149 sums insured on lump-sum tiles (c252ed5): NOT READY, one High and one gate failure

Checked for free:
- regressions 94/0, te-pr147 78/0, te-pr147b 54/0, te-pr147c 39/0, te-pr147d 78/0;
- **te-pr148b 84 passed / 3 failed** (S5 in SG/MY/UK);
- `tsc` clean, `next build` passes;
- tsx probes of `lumpSumParts`/`categoryOfBenefit`.

- **Gate (blocking): the registered TE gate `coverage:te148b-test` fails 3/87 on this head.** S5 ("no row prints an amount: the sum insured with its currency", expects 90,000) now gives no amount, because (2) requires a row that pays a share of the sum insured. The change is deliberate, so the test engineer must re-state S5 in their own gate. The builder must not edit the assertion, and the PR must not merge red.
- **High (Q1, the loosening asked about): any condition now shows the full sum, with nothing on the tile saying so.** A lump-sum row equal to the cover's sum insured counts whatever its conditions. Probes on a CI cover with sum insured S$300,000 and one printed row of S$300,000 all give **S$300,000**:
  - "reduced by half after age sixty-five"
  - "less any amounts already paid under the early critical illness benefit"
  - "subject to a co-payment of 10%"
  - "payable only if death occurs after age 65; otherwise return of premiums"
  - "7-day survival period" (the intended case)
  - The figure never exceeds the sum insured, and the parts line now begins "Sum insured:", so the number is true *as a sum insured*. But the explanatory "What is paid depends on each policy's own terms" shows only when there are 2+ parts. A one-policy tile shows a bare S$300,000 for a death that, before 65, pays back premiums only. That reads as a claimable amount.
  - TE N7 ("a sum with a limit: no amount") still passes only because its fixture has no held sum insured. With one it would show the full figure. This reverses the lesson the R238–R242 rounds settled, so it must at least be visible.
  - Fix (free, small): carry `conditional: true` on a part counted through `asInsured` when the row has limits (`limits(r)` non-empty, i.e. not a cause/stay allow-listed condition). Show "(conditions apply)" after that part's amount. Show the "What is paid depends on each policy's own terms" line whenever any part is conditional, even with one part.
  - The 7-day survival period is a condition on *when*, not *how much*. Optionally add "survival period"/"waiting period" wording to `STANDING_WORDS` or the cause allow-list so the live Singlife CI gets no marker. Do not widen it further.
  - Gate it: the five phrasings above with a held sum insured must show the amount **with** the marker. A condition-free row shows no marker.
- Fine as built (2): a cover with no printed amount gives its sum insured only when a row pays a share of it. ReadyBuilder's notional S$49,000 drops out, and Charmaine's Death has no total. That is the safe side.
- Low (3, R247 Q1b as folded in): `categoryOfBenefit` on line names only hides amounts, never adds them. "Accidental Death" stored as Death → no amount here. Plain product names ("Group Term Life", "Group Living Care", "Total Disability Accelerator") place nowhere and keep their category. Over-hides seen: "Group Critical Illness" stored as Early CI and "Early Critical Illness Benefit" stored as CI each lose their amount on the stored tile. That is the safe side; the classifier decides by the benefit word.
- Low: `accelerates` keys off any "accelerat…" word in the cover's benefit, section or cover names. The label is cosmetic and adds nothing to the total. Fine.
- Pre-existing (R248 Q4, TE note P3): two policies of one product and sum still collapse into one. That needs a separate `coverKeyOf` fix.

Verdict: NOT READY. Get the te148b gate green through the TE, and add the conditional marker.

## R250: #149 at 618ca6a (conditional marker, timing allow-list, negation, currency): READY, with one recommended follow-up

Checked for free:
- regressions 97/0, te-pr147 78/0, te-pr147b 54/0, te-pr147c 39/0, te-pr147d 78/0, te-pr148b 90/0, te-pr148c 81/0, te-pr149 84/0;
- `tsc` clean, `next build` passes;
- tsx probes.

Confirmed:
- The R249 gate: te-pr148b S5 is now graded "no amount", with an S5b positive case, under a "Grader correction (TE …)" comment that keeps the original grade on record. It arrived inside the builder's commit 618ca6a. **The coordinator should confirm the test engineer wrote this correction**, since registered graders are never edited by the builder.
- The R249 High: a single row carrying "reduced by half after age sixty-five" now shows "S$300,000 (conditions apply)". The terms line now shows even with one part.
- "The life assured survives at least 7 days after the date of diagnosis" carries no marker. `TIMING_WORDS` is a word allow-list; "%" and number words are not in it, so a payout fraction cannot pass as timing.
- Negated "accelerat…" ("Non-accelerated", "does not accelerate") gives no mark.
- The same number in another currency is not the sum insured.

Recommended follow-up (Medium, marker gaps; no new wrong figure, since each amount is the stated sum insured): the marker reads only the first row equal to the sum insured, and only on the `asInsured` path. These show the sum insured with no marker:
- (3) two rows equal to the sum insured, the first with only eligibility/timing conditions and the second "reduced by half after age sixty-five";
- (5) a confirmed schedule line matched to a cover whose row says "reduced by half after age sixty-five" (`lineCover` copies `accelerates` but not `conditional`). This is the usual path for a personal policy with a confirmed schedule;
- (6) a plain S$200,000 death row plus a "return of premiums only before age 65" row on the same cover (the `sums.size === 1` path; pre-existing since #148).
- Fix: `conditional = list.some((r) => r.conditions.some((c) => isLimit(c) && !timingOnly(c)))` for every part that shows an amount, including the line part through `lineCover`. Gate cases 3, 5 and 6.

Verdict: READY at 618ca6a once the TE confirms the S5 correction. The marker follow-up is recommended next.

## R251: #150 intake, combined limits and ended short-term covers (c593995): NOT READY, two High

Checked for free:
- `intake-limits-test.ts` 29/0, regressions 25/0, te-pr147d 78/0;
- `tsc` clean, `next build` passes;
- `git merge-tree` with main (b1fa3d1, after #148) is clean;
- tsx probes of `combinedLimit` and `coverEnded`.

Both rules *hide* rows: from tiles, the Coverage page (ended rows), chat amounts and claim purposes. A false positive therefore hides a documented benefit. That direction needs the allow-list mindset as much as amounts do.

- **High (Q1): `combinedLimit` hides real benefits that carry an aggregate clause, and anything under a "limits of compensation" heading.** It tests the row's quote and section, not just its name, so a benefit row whose printed line adds a per-life or all-policies cap counts as no cover at all. Each of these is LIMIT at c593995:
  - "Total Permanent Disability" | "TPD benefit: 100% of sum assured, up to a maximum of S$5,000,000 for all policies on the same life"
  - "Critical Illness" | "…; the maximum we pay across all policies on the same life is S$3,000,000"
  - "Daily Hospital Cash" | "S$100 a day, up to 30 days a year in total for all plans"
  - "Accidental Death" | "S$200,000; in aggregate across all your policies with us the most we pay is S$1,000,000"
  - "Death Benefit" | "Sum assured S$500,000", section "Benefits and limits of compensation"
  - "Death Benefit" | "Sum assured S$500,000 (see limits of compensation)"
  - Per-life aggregate caps like these are common on TPD and CI, so the rule would remove those categories from the tiles and from claims.
  - Fix (structural, like the #142 name head): a row is a combined limit only when the **head of its own name** (text before the first ":", "–", "-", "(" or ",") is limit wording: `^\s*(?:limits?\s+of\s+compensation|(?:overall|aggregate|combined|maximum|total)\s+(?:limit|benefit\s+limit|amount\s+payable)|maximum\s+(?:amount|sum)\s+payable)\b`, and the scope (same life / all policies / all benefits) is in the name or quote.
  - A row whose head is a benefit ("TPD benefit", "Critical Illness", "Daily Hospital Cash") stays a benefit. Its aggregate clause becomes a limit condition, so `limits()` blocks a tile figure unless every row prints it.
  - The section alone never makes a row a limit.
  - The live ReadyBuilder row ("Limits of compensation: most paid for TI and CI claims…") still qualifies by its head.
  - Gate the six phrasings above as BENEFIT and the live row plus "Overall limit: the most we pay for all benefits combined…" as LIMIT.
- **High (Q2): `coverEnded` can hide a renewed or recurring policy.** "≤ 183 days with both ends printed and passed" is not the same as "single trip". Probes (today 27/10/2026), each ENDED:
  - a group-scheme certificate for an employee who joined mid-year, 01/10/2025–31/12/2025 (renewed each 1 January; the new certificate simply not uploaded yet);
  - a monthly renewable PA policy whose schedule prints the current month, 01/09/2026–30/09/2026;
  - a rider attached mid-term, co-terminous with the annual base, 01/06/2026–31/08/2026;
  - a document whose only period is short (a group certificate printing 01/07/2026–30/09/2026), which ends **every** cover on it through the `periodFrom/periodTo` fallback.
  - The docstring itself says "missing renewal papers are not an ended cover". The first case contradicts it.
  - Fix: end a cover only when it is **travel** by #147's own two-signal rule (a travel name on its cover/plan or non-scheme product, `TRAVEL_NAME`/`SCHEME_NAME`) **and** its term is short and over. Use the document period only when the document is that travel cover's own. Never end a cover whose product or cover name is a group scheme's.
  - Gate the four cases above as current and "Single Trip 01/08/2026–15/08/2026" as ended.
- Fine: the ended rows stay in the chat for an event inside the trip. `printedDay` moved unchanged into `dates.ts`. Claims and chat both skip combined limits.

Verdict: NOT READY on Q1 and Q2. Both fixes narrow the rules to their stated targets (the live limits-of-compensation row and the single-trip plan).

## R252: #149 at f3f8ff1 (marker reads every row; trigger allow-list): READY

Checked for free:
- regressions 103/0, te-pr147 78/0, te-pr147b 54/0, te-pr147c 39/0, te-pr147d 78/0, te-pr148b 90/0, te-pr148c 81/0, te-pr149 84/0, te-pr149b 105/0;
- `tsc` clean, `next build` passes.

R250 marker gaps closed: the marker now reads every row of the cover, and a schedule line matched to a cover with "reduced by half after age sixty-five" shows "(conditions apply)".

Probe of the new trigger and timing allow-lists (Death SI S$200,000):
- Unmarked (plain trigger or timing):
  - "If the Life Assured dies while the Policy is in force and We receive satisfactory proof of claim"
  - "… while this rider is in force"
  - "the life assured survives 30 days after the date of diagnosis"
  - "waiting period of 90 days"
  - "subject to the policy survival of 2 months"
- Marked (a reducer never passes as a trigger):
  - "…, less any TPD benefit paid"
  - "If the life assured dies before age 65"
  - "If death is in the first policy year"
  - "… and the death benefit is the total premiums"
  - "waiting period of 12 months; 50 percent in the first year"
  - "survival period 30 days or 0.5 of the benefit"
  - "reduced by half after age sixty-five"
  - "no benefit for suicide in the first year"
- `TRIGGER_WORDS` holds no amount, age, time or premium word. A number in a timing clause counts only before days/months or after section/clause.

Verdict: READY at f3f8ff1.

## R253: #150 at bd94663 (name-head limits; only single-trip travel ends): READY, two Lows

Checked for free:
- intake 30/0, regressions 82/0, te-pr147d 78/0, te-pr148b 87/0;
- `tsc` clean, `next build` passes;
- clean `git merge-tree` with main;
- tsx probes of `combinedLimit` and `coverEnded`.

R251 Q1 fixed. All six benefit rows with aggregate clauses are now BENEFIT: TPD "…up to a maximum of S$5,000,000 for all policies on the same life", CI "…across all policies on the same life", Daily Hospital Cash "…in total for all plans", Accidental Death "…across all your policies", Death Benefit under a "limits of compensation" heading, and "(see limits of compensation)". The live ReadyBuilder row is LIMIT, written either way ("Limits of compensation" + quote, or the full name). "Overall limit…" and "Maximum amount payable under all policies on the same life" are LIMIT.

R251 Q2 fixed. These are current: the mid-year group certificate 01/10/2025–31/12/2025, the monthly PA, the co-terminous rider, a group certificate with only a short document period, a group business travel line on a short scheme period, and the annual multi-trip plan. "Travel insurance summary / Single Trip / Business" 01/08–15/08/2026 is ENDED.

- Low (L1): a limit-worded head with a single benefit after it is a limit, so the row is hidden. "Total amount payable for death | S$500,000 for all plans" and "Maximum sum payable for hospital cash | S$100 per day across all policies" are LIMIT. Each is arguably a per-benefit cap across policies, but if it is the only row for that benefit, the category loses its cover. Optional: when the name after the head places in exactly one category (`categoryOfBenefit`), keep it as that benefit with the cap as a limit condition.
- Low (L2): a rider whose own name is travel ends by its printed dates. "HealthPlan / Overseas Travel Cover" 01/06–31/08/2026 (co-terminous with an annual base) is ENDED. Optional: `if (c.riderOf) return null` in `coverEnded`, since riders end with their base.
- The live "Limits of compensation" row needs a scope ("the same life", "all policies") in its name or quote. A bare "Limits of compensation | TI and CI S$2,000,000" stays a benefit, the old behaviour, which is safe for the tile because CI then has no total. The builder's stored-row run should confirm the live row qualifies.

Verdict: READY at bd94663. L1 and L2 are optional.

## R254 — #150 at d186935 (limits heading middle way, L1, L2): one High, then READY

**H1 (High, hides documented cover): `lib/benefit-table/assemble.ts` `printsSumInsured`.** Under any heading containing "limits of compensation", every row whose figure is not exactly the cover's sum insured becomes `combinedLimit`, so it drops out of tiles, chat and claims. Many accident and travel schedules print the whole benefit list under "Schedule of benefits and limits of compensation". Made-up probe (Shield PA, sum insured S$200,000, all rows under that heading):

| Row | Figure | d186935 |
|---|---|---|
| Accidental Death 100% of Sum Insured | 200,000 | benefit |
| Fracture of hip 15% of Sum Insured | 30,000 | **limit (hidden)** |
| Medical Expenses up to S$2,000 | 2,000 | **limit (hidden)** |
| Hospital Cash S$100 per day | 100 | **limit (hidden)** |

The same happens to capped-percent and as-charged rows (figure kind `none`), and to every row when no sum insured is held. Patch: a row under the heading is a limit only when it is a printed lump sum or "up to" figure that is **more** than the cover's sum insured in the same currency, or any such figure when no sum insured is held. Per-day, per-period, percentage and figure-less rows are never limits.

```ts
function headingLimit(f: Figure, c: PersonCover): boolean {
  if (f.kind !== "printed" || (f.unit !== "lump_sum" && f.unit !== "up_to")) return false;
  if (c.sumInsured == null) return true;
  return f.amount > c.sumInsured && (!f.currency || !c.currency || f.currency === c.currency);
}
// …combinedLimit: (b.combinedLimit ?? false) || (!!b.limitsHeading && headingLimit(figure, c))
```

With that patch the probe keeps all four rows, and intake stays 36/0 (TE P150-2 "Critical Illness up to S$2,000,000" with or without a sum insured is still a limit). Residual Low: with no sum insured held, "Medical Expenses up to S$2,000" under such a heading is still hidden. That is the cautious side, so I'm accepting it.

**L1 (fixed):** "Total amount payable for death … for all plans" is now a Death benefit, with the line kept as a condition; "Limits of compensation: …" stays combined. **L2 (fixed):** `riderOf` returns null before the travel test, and the caller passes the CheckedCover, which carries riderOf.

Checks on d186935:
- intake 36/0, benefit-table 107/0, chat 96/0, parity 10/0, te-pr147d 78/0;
- te-pr148b 87/3: S5 ×3 fails the same way on main b1fa3d1 (the #149 grader correction), so it is not this PR's;
- tsc clean, next build passes, merge-tree with main clean.

Verdict: READY once H1 is patched as above. Everything else is in order.

## R255 — #151 at 90ee276 (Home re-fetches while documents are read): two Mediums, one Low

Checks:
- new `coverage:dashboard-dynamic-test` 19/0 on a throwaway local Postgres 16 + pgvector (setup-db list, then benefit-table, policy-member-exclusions and detected-name-dismissals);
- intake 39/0, benefit-table 107/0, te-pr149b 105/0;
- tsc clean, next build passes, merge-tree with main 3efb382 clean.

Isolation holds: the count is scoped by `account_id`, and the suite's other-household case passes. Nothing is hard-coded to a household, insurer or market. Polling stops: the client caps it at 10 minutes, the server stops counting a ready document after 10 minutes and an in-progress one after 30, and an error payload has no `reading`, so polling ends there too.

**M1 (Medium, a picked person can be overwritten by a late poll): `app/page.tsx` load/timer.** The 8 s timer and the visibility handler capture `activeId` from the render that set them. The timer's effect depends only on `[data]`, so choosing another person (`choose(B)`) does not clear a pending poll for A. If that poll fires while B's request is in flight and its reply lands after B's, `setData` shows A again, with the pill, heading and tiles all on A. The user's choice is silently undone. Every label stays consistent with the shown person, so this is not a mislabelled person. Fix: only the newest request may set the page, and polls ask for the person last chosen.

```tsx
const latest=useRef(0),want=useRef("");
async function load(memberId?:string,quiet=false){const mine=++latest.current; …fetch…
  if(mine!==latest.current)return;               // a newer request owns the page
  if(!want.current&&payload.activeMember?.id)want.current=payload.activeMember.id;
  setData(payload); … }
async function choose(id:string){want.current=id;setActiveId(id);await load(id);}
// timer and visibility: void load(want.current||undefined,true)
```

**M2 (Medium, a 10-minute false "still being read" banner plus about 75 polls): `app/api/dashboard/route.ts` reading count.** A ready document with no benefit reading counts as being read. Ingest never reads payment documents (premium_receipt, renewal_statement, annual_statement) or `NON_COVER_ROLES` documents into the benefit table (`lib/rag/ingest.ts:1000`). So every uploaded receipt or letter shows "A document is still being read" and polls for 10 minutes. I confirmed it with a probe added to the suite: setting the pending row's `document_role='premium_receipt'` still counts 1 on 90ee276. With the patch below the probe gives 0 and the suite stays 19/0.

```ts
const NO_READING_ROLES=[...NON_COVER_ROLES,"premium_receipt","renewal_statement","annual_statement"];
// ready branch: … AND NOT (coalesce(p.document_role,'')=ANY($2::text[])) AND NOT EXISTS(…)
// params: benefitLive?[accountId,NO_READING_ROLES]:[accountId]
```

Better still: share one list with ingest, so the two can't drift apart.

**L1 (Low, cost for accounts without the benefit table, which is every sign-up except the alpha): `route.ts:28` runAfterResponse.** Every dashboard GET kicks `readPendingDocuments`, which makes paid ledger reads. Its dedupe lives in memory per instance, and `ledger_read_at` is set only after a read finishes (`lib/ledger/extract.ts:310`). Ingest runs its own ledger read straight after marking a document ready (`ingest.ts:1000`), so a poll landing on another instance in that window can start a second paid read of the same document. This already happens on a manual reload, but polling every 8 s makes it routine. This is inferred from the code; it was not run, because it needs a model. Fix: send `&poll=1` on quiet loads and skip the background ledger kick when it is set.

Verdict: READY once M1 and M2 are fixed. L1 is optional, but cheap.

## R256 — #151 at 6af3b7b (R255 fixes): READY

**M1 (fixed), read line by line.** `load` takes `n=++seq.current`, and only `n===seq.current` may setData or clear loading. `choose` sets `want` before it calls `load`, so any later poll or visibility re-fetch asks for the newly chosen person. If a poll supersedes a full load, it asks for the same person and clears the spinner itself. Before the first reply, `want` is undefined and a re-fetch asks for the default person, same as the first load. The visibility handler's closure keeps the first render's `activeId=""`, so it re-sets `activeId` to the returned person, which is the person `want` asked for; harmless. Claim-a-document re-fetches with `want` too. I found no path where the page shows a person other than the newest choice.

**M2 (fixed):** one shared list, `NO_COVER_READING_ROLES` (payment roles plus NON_COVER_ROLES) in `lib/documents/messy.ts`, used by both ingest and the dashboard count. The suite now covers a receipt, a letter and a schedule.

**L1 (fixed):** `poll=1` skips the background ledger kick. Only quiet loads send it, so a full Home load still kicks, as before. The suite has a poll case and asserts that nothing tried to leave the machine.

Checks, all run network-blocked (no key in env, proxy pointed at a dead port):
- dashboard-dynamic 22/0 on a throwaway Postgres 16 + pgvector;
- intake 39/0, benefit-table 107/0, chat 96/0, te-pr149b 105/0;
- tsc clean, next build passes, merge-tree with main 3efb382 clean.

## R257 — #151 at 01323b3 (Home waits for links after the reading, TE F1): READY, two Lows

The new clause counts a recent ready document until it has a reading, and then either a `benefit_links` row with `updated_at >= read_at` exists or no reading in the household has benefits. It is right on the main path. `readDocument` stores `{document: <model json>, pages}`, so `reading->'document'->'benefits'` is the correct path. `relink` deletes and re-inserts every model link with `now()`, so any re-link after the reading ends the wait, a covers-only document included, as long as some other section is model-linked. Everything is scoped by account.

Known edge (accepted): when relink writes no row, Home polls for the full 10 minutes. That happens when every section is household-linked, when there are no cover types, or when the link call fails or returns nothing. It is bounded, and the banner stays truthful enough.

**L1 (Low, the dashboard can 500):** `jsonb_array_length(coalesce(…,'[]'))` raises "cannot get array length of a non-array" if a stored reading's `benefits` is an object or scalar (checked on Postgres 16). The JS side guards this with `Array.isArray` (`check.ts:373`), and the SQL should match. **L2 (Low, Home stops early):** a document whose whole-document reading has no benefits, but whose page re-reads do (`stored.pages[].json.benefits`), counts as covers-only, so Home can stop before relink writes its links. One expression fixes both. I checked it on Postgres 16: object → no, `[]` → no, `[1]` → yes, page benefits → yes, scalars → no, with no error.

```sql
coalesce(jsonb_path_exists(b2.reading,'strict $.document.benefits[0]','{}',true)
      OR jsonb_path_exists(b2.reading,'strict $.pages[*].json.benefits[0]','{}',true), false)
```

Checks, all network-blocked:
- dashboard-dynamic 25/0, including both TE F1 cases;
- intake 39/0, benefit-table 107/0, chat 96/0, te-pr149b 105/0;
- tsc clean, next build passes, merge-tree with main 3efb382 clean.

## R258 — #152 at 85841ce (cover holdings by policy number; accident-worded lines): NOT READY, two Highs

Probe (made-up SG household, "Alder Term", run on the PR's own assembleTable → tileRows → lumpSumParts path, network-blocked; main 44fb9ec vs PR):

| Case | main | 85841ce |
|---|---|---|
| R1 one policy renewed: 2025 and 2026 schedules, new number each year (GT-2025-77 / GT-2026-77), S$100,000, periods 1 Jan–31 Dec 2025 and 2026 | **100,000** | **200,000** (two parts) |
| R2 one policy: product summary prints group no. G-55000 (benefit table), member certificate prints C-000123 (no rows) | 100,000 | 100,000, but 2 covers |
| R3 two real policies: A's contract prints the benefit table (AT-1001, 100k); B has only its certificate (AT-2002, 250k) | no total (`?`) | **total 100,000, B's part missing** |

**H1 (High, wrong amount): `assemble.ts` coversOf holdings.** A different printed number is not enough to prove a second policy. Annual renewals (group schemes and many term/PA plans re-number every year), a summary's group number against a certificate number, and endorsement or renewal notices all print different numbers for one policy. R1 doubles a renewed policy. Main merged it because the sums were equal.

**H2 (High, hides a policy and shows a part total as complete): `ownCovers` + `lumpSumParts`.** A section on one holding's own document is given only to that holding. A holding with no rows and no line then produces no part at all, so the tile adds up only the policies that have rows. In R3, B's S$250,000 disappears and Home shows S$100,000. Main showed no total there. R2 also shows how the H2 fix exposes H1: once every held holding becomes a part, the summary and certificate of ONE policy would add to 200,000.

Proposed fix (one rule, unsure → no figure):
1. Keep the split. Each holding is its own part, with its own sum when its own document prints one, else no amount. Add a part for every held holding that has no rows and no line, so nothing disappears.
2. Give a total across holdings of one cover type only when every holding's own document prints both a start and an end date, the periods overlap, and none has ended. Otherwise `unsure` → no total, and the parts still list each one.
3. Where the periods do not overlap (R1), the earlier holding is a past year of the same cover, not a second policy. Show the current one only, or no total.

**M1 (Medium, pre-existing but now in conflict with holdings): chat groups by coverKey.**
- `chat.ts:77` keys `coverSince` by `person|coverKey`, so the last holding's start date wins for both. A new policy's start date applied to an older one (or the reverse) gets the waiting-period answer wrong, which means a wrong claimable answer.
- `chat.ts:464` (ruledOut siblings), `:531/538` (companions, first-year), and `:647/796` (twins) also treat two holdings as one cover. An exclusion on X's document rules out Y's same benefit, and a twin collapse can give one policy's figure for both.

Fix: key on `holding ?? coverKey` in those places, in this PR or straight after. (A confirmation keyed by coverKey also applies to both holdings. Low, since households do not confirm amounts.)

**Q1b remainder: fine.** ACCIDENT_WORD only removes an amount from non-PA tiles, a name that places elsewhere keeps the R247 rule, and bare `acc` is rightly not added.

Checks:
- cover-holdings-test 57/0, intake 39/0, benefit-table 107/0, chat 96/0, te-pr149b 105/0, te-pr149 84/0, te-pr148c 81/0;
- tsc clean, next build passes, merge-tree with main 44fb9ec clean.

## R259 — #152 at df4c84b (R258 fixes): READY, one Medium (pre-existing) and one Low

I re-ran my probes on the PR path, network-blocked:

| Case | 85841ce | df4c84b |
|---|---|---|
| R1 renewal, two numbers, 100k each | 200,000 | no total; parts 100,000 + 100,000 |
| R2 summary (G no.) + certificate (C no.), one policy | 100,000 (one part) | no total; parts 100,000 + `?` |
| R3 A's contract has the table; B has a certificate only (250k) | 100,000, B missing | no total; parts 100,000 + `?` |

H1 is closed: no total whenever a cover type is split. That is the right call; date overlap would not separate R2. H2 is closed: every held holding of a split type is a part. Chat (M1): coverSince, the plan-table group, siblings, ruledOut, companions, firstYear, twins and copiedName all key on `holding ?? coverKey`. For an event this year, the ended 2025 holding is still ruled out by its own dates, so a renewal never answers with two current policies.

**M1 (Medium, pre-existing on main; the PR now has what it needs to close it): a split that shows only through schedule lines is still added up.** `split` is built only from row groups. A tile with no table rows, made only of confirmed lines whose documents are two holdings, adds them. Probe R4: lines 100,000 (polA) and 250,000 (polB), with held holdings k#a and k#b → **total 350,000**. A renewal whose sum changed (2025 100k, 2026 120k) gives 220,000 the same way. Equal sums are already caught by the same-name rule. Fix: also add a held holding's `coverKey` to `split` when its `documentId` is in any line's `documentIds`.

**L1 (Low): an added holding hides its own printed sum.** In R3, B's certificate prints 250,000, but its added part shows `?`. R1 shows both amounts, and the product rule is "each person's sum assured per policy", so use `amount: h.sumInsured, currency: h.currency` when present. There is no total in either case.

Checks:
- cover-holdings 72/0, intake 39/0, benefit-table 107/0, chat 96/0, headline 16/0, parity 10/0, te-pr149b 105/0, te-pr149 84/0, te-pr148c 81/0;
- tsc clean, next build passes, merge-tree with main 44fb9ec clean.

## R260 — #152 at a1db9a1 (via 9b3dd5a and 90797b1): READY, two nits

Probes on a1db9a1, network-blocked:
- R1 renewal: no total, parts 100k + 100k.
- R2 summary + certificate: no total, one part.
- R3 certificate-only B: no total, A's part only.
- R4 lines-only over two holdings: no total (R259 M1 closed).
- P1 "1001"/"10011": two policies, no total (it was merged on 9b3dd5a and 90797b1).
- P2 "MT-104455"/"MT104455": one cover, 100,000 (same as main).
- P3 un-numbered copy + A + B, all at the same sum: no total.
- P5 "1001" 100k / "10011" 250k: no total, both sums.

**On dropping the row-less holding (TE P152 N1): I agree.** A policy whose own document gives the tile no row may not hold that benefit, and its sum insured may be another benefit's sum. The harm I raised in R258 H2, a part total shown as complete, stays closed because any tile touching a split cover type has no total. So I withdraw R259 L1.

Nits, optional:
- `ADD-ONS` still reads as AD&D, because `(?![\s-]*ON\b)` misses the plural. Use `ONS?\b`.
- P4 (an un-numbered copy at A's sum, plus B at another sum): the un-numbered copy absorbs A because the dedupe groups by sum, so the tile shows one `?` part and no holdings. That matches main and gives no wrong figure. Counting numbers per person + cover type, not per sum group, would keep both policies visible.

Checks:
- cover-holdings 144/0, benefit-table 107/0, chat 96/0, te-pr149b 105/0, te-pr148c 81/0;
- on 90797b1 also intake 39/0, headline 16/0, parity 10/0, te-pr149 84/0;
- tsc clean, next build passes, merge-tree with main 44fb9ec clean.

## R262 — #153 at 89da910 (identity numbers masked in chat answers): one High, then READY

All probes use made-up numbers and the network was blocked. No real ID appears below.

**H1 (High, corrupts answer text and amounts): `identity-numbers.ts` maskIdentityText.** After a label, the value may run on as words. When its first word has no digit, `value.match(...)?.[0] ?? value` falls back to the WHOLE value and masks every word before the last 4 characters:
- "Identity theft cover up to 50000 per trip" → "Identity ***** ***** ** ** *0000 per trip"
- "Identity Theft Expenses 10 000" → "Identity ***** ******** *0 000"
- "Passport replacement costs 25000" → "Passport *********** ***** *5000"
- "the NRIC holder may claim 10000 per year" → "the NRIC ****** *** ***** *0000 per year"

Identity-theft and passport-loss benefits are ordinary travel benefits, so a bare or space-grouped amount after such a word gets garbled. Fix: the masked part must be a number that starts the value, an optional 1–2 letter prefix allowed. Otherwise leave the text alone:

```ts
const number = value.match(/^(?:[A-Z]{1,2}\s+)?[A-Z0-9-]*\d[A-Z0-9-]*(?:\s+[A-Z0-9-]*\d[A-Z0-9-]*)*(?:\s+[A-Z](?![A-Z0-9]))?/i)?.[0];
if (!number) return all;
```

With it, all four sentences are unchanged. The spaced forms stay masked: "NI number QQ ## ## ## C", "NRIC: S #### ### Z", "Passport No. K #### ####", and "ID No. … and plan A" keeps its words. identity:mask-test stays 5/0. A plain `?? value → return all` is not enough, because it would unmask those spaced IDs.

**M1 (Medium, useful references hidden): unlabelled dashed shapes.** The SSN shape (3-2-4) and the MyKad shape (6-2-4) mask any reference that happens to match: "Claim reference 123-45-6789" → "***-**-6789", "Group policy 202501-01-0001" → "******-**-0001". Fix: mask the SSN shape only with an SSN or Social Security label (US is not a launch market). Accept the MyKad shape only when its first 6 digits are a real date (YYMMDD, month 01–12, day 01–31). "202501…" then fails, since month 25 is not valid.

**L1 (Low, missing labels for Malaysia):** "No. K/P", "Kad Pengenalan", "MyKid" and "Birth Certificate No." are not labels, so 12-digit MyKad numbers without dashes (and birth-certificate numbers) after them stay visible. Add `K\/P|Kad\s+Pengenalan|MyKid|Birth\s+Cert(?:ificate)?`.

**L2 (Low, accepted trade-offs, no change needed):**
- An NRIC-shaped policy or certificate number ("Policy No. T1234567X") is masked. Keep this: group certificates often use the NRIC as the member number.
- "<word> ID No." is masked for Customer, Agent, Transaction, Document, Policyholder, and possessives ("Member's ID No."), because the not-a-person lookbehind only sees a bare preceding word. Only the last 4 stay visible, and erring towards privacy is acceptable. If you change it, allow `'s` in the lookbehind rather than growing the word list.

**Re-render and gates: fine.** sanitizeStoredAnswer masks a deep copy before the calculation recompute and sentence matching. Both sides are masked the same way, and ids, UUIDs and hashes do not fit any shape. The stored row is untouched. User messages are deliberately left unmasked. Note that a household's own typed NRIC still shows in history, and still goes back to the model through recentMessages; say whether that is intended.

Checks:
- identity:mask-test 5/0, security:live-chat-monetary-boundary 32 cases, rag2:scenario-replay 22/22, dj-live-3 replay 48/48;
- simple offline 17, simple chat 84, simple style 22/0, benefit-table chat 96/0;
- tsc clean, next build passes, merge-tree with main 44fb9ec clean.

## R263 — #153 at ed6295a: masking READY; one-off premiums (657ede2) one High

**Masking (R262 fixes): READY.** All of these stay unchanged now: the identity-theft, passport-replacement and NRIC-holder sentences, "Claim reference 123-45-6789", "Group policy 202501-01-0001", and "ID card replacement 30000". These are masked: spaced NINO, NRIC and passport forms; No. K/P, Kad Pengenalan and MyKid 12-digit numbers; a birth certificate; dashed MyKad; a bare NRIC; mid-sentence "ID no is …"; and SSN when labelled. Leaving the household's own typed words unmasked is accepted as a project rule.

**H1 (High, the Home cost total drops a recurring premium and still says it is complete): `premium-summary.ts` isOneOffPremium.** It treats any record with no recurring frequency word and a `period_end` as a one-off. Ingest stores renewal_statement and annual_statement payments with the model's `frequency` (often null) and the printed period end (`lib/rag/ingest.ts:753`). A yearly renewal notice ("Premium S$300, period 1 Jan–31 Dec 2026") is therefore a one-off. It drops out of `items` and the annual total. Because `missing` is now computed over `all`, its policy is not listed as missing either, so `complete` can be true while the total leaves it out.

The RECURRING word list also misses common frequencies. Probe results (isOneOffPremium, with period_end set):

| frequency | result |
|---|---|
| null (single trip, 6-day period) | one-off ✓ |
| null (annual statement to 31 Dec) | **one-off ✗** |
| "per annum", "p.a.", "Fortnightly", "Tahunan", "Bulanan", "12" | **one-off ✗** |
| "Yearly" | recurring ✓ |

Fix (structural, unsure → recurring as before):
1. One-off when the frequency says single, one-off or "for the period".
2. Otherwise one-off only when there is no recurring frequency AND the record prints both `period_start` and `period_end` AND the span is ≤ 183 days (a short-term cover, the same bound as SHORT_TERM_DAYS). A year-long period stays recurring.
3. Add `annum|p\.?\s*a\.?|fortnight|bulanan|tahunan` to RECURRING. Pre-existing: `annualisePremium` treats "Bulanan" (monthly) and "Fortnightly" as annual, which undercounts 12× and 26×. Teach it the same words.

Checks on 657ede2 and ed6295a:
- r5:answer-test 19/19, identity:mask-test 5/0, simple chat 84, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with main clean.

## R264 — #153 re-check at 8615065 (one-off premium fix for R263)

R263 H1 is fixed. An annual statement with no frequency word and a one-year printed period now stays yearly. An end date with no start date stays recurring. "per annum", "p.a.", "Fortnightly", "Bulanan" and "Tahunan" are all read as recurring. annualisePremium gives Bulanan 10 → 120 and Fortnightly 10 → 260. A trip premium with no frequency and 6 printed days is still one-off, and so is "Single premium" with no dates.

**M1 (Medium, lib/policies/premium-summary.ts isOneOffPremium).** A monthly plan's statement can print no frequency word and a one-month period (2026-10-01 to 2026-10-31). That row is ≤ SHORT_TERM_DAYS, so it is classed one-off. Two things follow:
- it drops out of the Home yearly total;
- `missing` is worked out over `all`, so that policy is not flagged either. The total quietly goes down, with nothing on screen to say so.

Premium rows carry no cover name or document role, so a travel-name check can't be done here. Suggested fix, in line with "the unsure case shows no figure":
- treat a row as one-off only when the frequency word says so (single, one-off, "for the period");
- treat a row with no frequency word and a short printed period as **unsure**: keep it out of the total and count it in `missing`, so Home shows the total as incomplete rather than quietly smaller;
- add a P4 case for a monthly statement with no frequency and a one-month period, expecting it in `missing` and not in `oneOff`.

If the builder judges this rare, it can be a follow-up. It is still a quietly wrong total, not a wrong claim amount.

Minor: premium-summary imports SHORT_TERM_DAYS from lib/benefit-table/assemble. There is no import cycle, but it pulls a heavy module into the premium path. A shared constants file would avoid that.

Checks on 8615065, run network-blocked with model keys stripped:
- r5:answer-test 19/19, identity:mask-test passing, simple chat 84, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with origin/main clean.

Verdict: READY once M1 is fixed (or accepted as a follow-up). The masking side stays READY from R262/R263.

## R265 — #154 at 7c4ee65 (intensive-care daily rate row, N119)

**H1 (High, lib/benefit-table/chat.ts intensiveCareRateOf): the base rate becomes the ICU rate.** The allow-list holds both the multiplier words (doubled, double, twice, this) and the cap words. Nothing checks where the figure sits relative to them, so a clause that prints the *base* rate and then says it doubles passes. The figure is then given as the intensive-care rate, which understates the ICU day by half. That is a wrong claimable amount. Probe results:
- "Daily hospital cash S$200 per day, doubled in ICU" gives 200 (should be 400 or no row);
- "Hospital cash benefit S$100 per day doubled if hospitalised in intensive care" gives 100;
- "S$150 per day, double if in ICU" gives 150;
- "S$200 per day, twice this amount in ICU" gives 200;
- "S$400 per day in ICU or the daily amount" gives 400. "or" plus an unpriced alternative leaves it unsure which applies.

Commas don't split clauses, so in the row path each of these is one clause. It is printed in the row's own document, and the only dedupe is against existing ICU rows.

Fix (structural, allow-list):
- when the clause holds a multiplier word, give a row only if the multiplier comes before the figure and a cap word (capped, up to, maximum, max, limited) sits between them. Otherwise return null;
- drop "or" from the words unless both sides are priced (the existing two-figure check already refuses those);
- add the four cases above to the negative controls.

**M1 (Medium): "doubled, capped at S$400" is a cap, but the table line reads as a flat rate.** The card renders "Up to S$400", which is fine. The model-visible table line is "… in intensive care | S$400 a day" with `conditions: []`, so the doubling is lost. With a base of S$150, an ICU day pays min(2×150, 400) = S$300, not S$400. Fix, either of:
- keep the clause as the row's condition when a multiplier is present, so the line reads "doubled, at most S$400 a day";
- when the same row prints one base per-day figure, give min(multiplier × base, cap) and quote both. The first is simpler and default-safe.

**M2 (Medium): dropping the base row's overall limit.** The ICU row is cloned from the limit row (S$8,000 up_to in the test), and its limit is cleared. ICU days count against that overall limit. With nothing on the ICU card, 25 ICU days read as 25 × S$400 = S$10,000 against an S$8,000 limit, which overstates. Day-count limits are already refused (rows with maxDays give no row). A money overall limit should not be silently dropped either. Fix, either of:
- carry it as a condition ("counts toward the S$8,000 overall limit"), keeping capSource;
- give no ICU row when the base has an overall money limit. That hides the rate, so the first is better.

Model-visible change: one more table line, added last, so ids are stable. The replay gate is 22/22 and unchanged, so I see no other risk there once H1/M1 are fixed.

Checks on 7c4ee65, run network-blocked with model keys stripped:
- benefit-table chat 99/0, benefit-table 107/0, simple chat 84, r5 18/18, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with origin/main (44fb9ec) clean.

Verdict: NOT READY. H1 must be fixed; M1 and M2 before merge if cheap.

## R266: #153 re-check at 3a5fff0 (short-period premiums)

R264 M1 is fixed. One-off now means only that the frequency word says so (single, one-off, "for the period"). A row with no frequency word and a printed period of 183 days or less is `shortPeriod`. It is never totalled and sets `complete=false`, and the note names it with its amount and period. Both the chat and the dashboard (`app/api/dashboard/route.ts:156`, through `complete` and `note`) carry this, so the Home total says it is incomplete instead of quietly shrinking. The new import of longDate from lib/chat/policy-status adds no cycle.

Optional Lows:
- **L1.** A trip that ended long ago keeps Home marked incomplete for good. That is the safe direction, because an ended short-period row could also be an old monthly statement. If it gets noisy, a later follow-up could drop ended short-period rows only when a newer record for the same policy exists.
- **L2.** shortNote has no "and N more" past four, unlike missingNote. It also says "so it may be a one-off premium" when it names several premiums.
- **L3.** The mutant gap the builder already named: the P4 fixture already has a missing policy, so dropping shortPeriod from `complete` survives. A P4 case with no missing policy would close it.

Checks on 3a5fff0, run network-blocked with model keys stripped:
- r5 19/19, identity mask passing, simple chat 84, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with origin/main (44fb9ec) clean.

Verdict: READY.

## R267: #154 re-check at b842a74

H1 is fixed. With "doubled", "double" or "twice" in the clause, a figure counts only when it comes after the multiplier with a cap word between them. My probes:
- "S$200 per day, doubled in ICU": null.
- "S$200 per day, twice this amount in ICU": null.
- "S$400 per day in ICU or the daily amount": null.
- "doubled ... capped at / up to a maximum of / max / limited to S$400 per day": 400.
- "doubled to S$400 per day": null. This is conservative, and the base row still carries the doubling text.
- "subject to S$400": null, because "subject" is not an allowed word.

M1 is fixed. The clause is now the ICU row's condition, so the table line shows "doubled …, capped at".

M2 is accepted as answered. The ICU row never gets a stay total (stayPays refuses intensive-care wording), and the model cannot put money in prose. A money condition on the card would be dropped by verify, so carrying the overall limit would buy nothing.

Checks on b842a74, run network-blocked with model keys stripped:
- benefit-table chat 99/0, benefit-table 107/0, simple chat 84, r5 18/18, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with origin/main (44fb9ec) clean.

Verdict: READY.

## R268: #154 at 78065b8 (Test engineer F1 and F2)

Still READY. A "doubled …, capped at X" clause now gives a row only when the benefit has one known daily rate and twice that rate reaches X, so the card's X is exactly what an ICU day pays. Place words count only when the benefit's own name holds them: "while overseas" passes with a name such as "Daily hospital cash while overseas" and is refused with no name.

Optional Low: `dailies` does not check that the daily rate's currency matches the cap's. A cross-currency pair on one benefit is unlikely, and the row is refused unless 2 × rate ≥ cap anyway.

Checks on 78065b8, run network-blocked with model keys stripped:
- benefit-table chat 99/0, benefit-table 107/0, simple chat 84, r5 18/18, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with main clean.

## R269: #153 at db91c15 (Test engineer F1: an ID inside a file name)

Still READY. Shapes are now bounded by non-alphanumerics: "Certificate_S1234567D.pdf" gives S****567D, and "x_850101-14-5678.pdf" is masked. "National Insurance at 12500 a year" is left unchanged. "ID No. S1234567D and plan A" and the HKID shape are masked. "S1234567Dx" is not masked, which is correct because it is not the NRIC shape.

Optional Low: dropping the `i` flag means a lowercase spaced NINO after its label ("NINO qq 12 34 56 c") is now not masked at all. Before, it was masked. Unspaced lowercase after a label ("NRIC: s1234567d") is still masked. A fix: allow `[A-Za-z]{1,2}\s+` as the prefix only when a digit group follows.

Checks on db91c15, run network-blocked: identity mask passing, r5 19/19, simple chat 84, tsc clean.

## R270: #155 at a3fd531 (premium parts, and a clause's total limit)

premiumPartsOf is sound:
- it reads one cover line holding the sum;
- extras are lines that open with a dash, with no sum and one cell with cents;
- the parts must add up to the premium to the cent;
- it refuses when another life is on the page.
I found no wrong-cover path.

**H1 (High, lib/benefit-table/chat.ts totalLimitRows): another benefit's limit is attached to this benefit.** The heading must name the row's benefit, but the sentence itself never has to. The clause also runs on past any heading that has no number. My probes, using the PR's own LIMIT_WORDING and CI row:
- inside 2.2, "The most We will pay in total for all Accidental Death claims under all Policies covering the same Life Assured shall not exceed S$300,000." gives **"Limit in total on Critical Illness Benefit claims: S$300,000"**;
- with no limit in 2.2 and an unnumbered "GENERAL PROVISIONS" section after it holding the same sentence, it gives the same CI card. The scope reads "GENERAL PROVISIONS The most We will pay …";
- "Appendix B\nThe maximum total amount payable under all policies for the same life shall not exceed S$300,000." gives a CI card. That limit names no benefit at all.

The card's name and figure point at the wrong benefit (or at none), which is the wrong-attachment case you asked about. Fix (allow-list):
- the scope (the sentence up to its limit words) must name the row's benefit: every word of benefitName, allowing a plural ("Illnesses");
- it must name no other benefit heading on the page;
- end the clause at any line that looks like a heading (no sentence punctuation, Title or ALL CAPS, or "Appendix" / "Section" / "Schedule"), not only at numbered ones.

**M1 (Medium): words after the figure are dropped from the card.** The scope is cut at the limit words, and the tail after the figure is never checked. Probes, each giving "up to S$800,000" with nothing about the tail:
- "S$800,000 less any amount already paid under the Death Benefit";
- "S$800,000, or the Sum Assured if that is lower";
- "S$800,000, reduced by any Early Stage payment made before the Life Assured reaches sixty-five".

"Up to" stays an upper bound, but the lessons log (#147) says condition text that is not provably harmless must block the figure. Fix: the tail after the figure, up to the sentence end, must be empty or an allow-listed phrase such as "(or equivalent currency)". Anything else gives no row.

Checks on a3fd531, run network-blocked with model keys stripped:
- benefit-table chat 103/0, benefit-table 107/0, simple chat 84, r5 18/18, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with main clean.

Verdict: NOT READY (H1). Add the six probes above as negative controls.

## R271: #156 at ebd7ed4 (per-child amounts, N023)

The core is sound:
- countPays reads the row's own printed words: one figure, then per child, then at most one most-children figure;
- any other limit word refuses;
- `-count` cards are kept only beside their labelled parent, with the same most and the exact multiple;
- the not_described override needs the previous message to have asked for the benefit by name.

**H1 (High, lib/simple-chat/verify.ts childrenSaid): counts are deduplicated with a Set, so groups of children with the same number collapse.**
- "we have 2 sons and 2 daughters, how much in total" gives 2, though there are 4 children;
- "I have 3 children from my first marriage and 3 children with my wife" gives 3, though there are 6.
With no printed most, the card understates the total (2 × instead of 4 ×). That is a wrong claimable amount. Fix: take the number only when there is exactly one count match (`counted.length === 1`), and otherwise give none. "my two kids, both kids …" has one match, so it still works.

**H2 (High): a per-child benefit paid on one child's own event is multiplied by every child.** "if one of my 2 kids gets cancer how much do we get" gives 2. countPays runs for every amount statement, whatever its event, so a "Juvenile critical illness S$10,000 per child" row would get a "For 2 children … S$20,000" card when only one child is ill. Fix (allow-list): give a count only when the message asks for a total ("in total", "altogether", "total", "combined", "both", "all") and holds no single-child words ("one of", "either", "a child", "my son", "my daughter", "one kid"). Optionally also limit it to rows whose event is the insured's own (death, disability), which is the N023 shape.

**M1 (Medium): only the row and its continuation are checked for a cap.** An overall limit printed in the next sentence, or as the row's condition ("The total payable under this benefit shall not exceed S$8,000"), is outside `rule`. With "S$5,000 per child (up to 2 children)" that gives S$10,000 against an S$8,000 limit. Fix: refuse a count when any condition the statement carries states money (statesMoney) or names a total or limit word.

Low: an age-bounded benefit ("my 2 kids are 23 and 26") still gets a card. The card's "if this benefit's conditions are met for each child" covers it.

Checks on ebd7ed4, run network-blocked with model keys stripped:
- per-child 13/0, benefit-table chat 96/0, benefit-table 107/0, simple chat 84, r5 18/18, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with main clean.

Verdict: NOT READY (H1, H2). Add the probes above as negative controls.

## R272: #154 at 3679205 (currency of the doubled cap)

Still READY. The daily rate's currency is now read from its own printed words, and the cap must print the same stated currency. A bare "$" cap gives no row, and the US$-versus-S$ negative control is added.

The builder flagged a pre-existing issue in dailyRateOf: a limit's derived daily row borrows the limit's currency, so "US$300 per day" under an S$ limit shows as S$300. That is a wrong-currency amount. It deserves its own small fix (use ownCurrency, and give no row when the currencies differ), as a separate PR rather than widening #154.

## R273: #155 at 9e92988 (Test engineer F1 and F2)

R270 M1 is fixed. With every word after the limit words on an allow-list, "less any amount already paid …" and "…, or the Sum Assured if that is lower" now give no row. The N087 control still gives S$800,000 with its scope.

R270 H1 is still open at this head. All three wrong-benefit probes still give "Limit in total on Critical Illness Benefit claims: S$300,000":
- an Accidental Death sentence inside 2.2;
- the same sentence under an unnumbered "GENERAL PROVISIONS" heading;
- "Appendix B …", which names no benefit.
The fix is as in R270. Still NOT READY.

## R274: #155 at cd93f9e

R270 H1 is fixed. The total's scope must now name the row's benefit (or say "this benefit") and name no other heading's benefit, and the clause ends at an unnumbered heading-like line. My probes:
- these now give no row:
  - an Accidental Death limit inside 2.2;
  - the same limit under an unnumbered "GENERAL PROVISIONS";
  - "Appendix B …";
  - "Critical Illness and Death claims";
  - a CI limit printed inside the Death clause;
  - a "Waiting Period" sub-heading before the limit (conservative);
- these give the right CI row:
  - the "this benefit" scope gives S$300,000;
  - the N087 control and the "Illnesses" plural each give S$800,000.

R270 M1 stays fixed by the tail allow-list from 9e92988.

Checks on cd93f9e, run network-blocked with model keys stripped:
- benefit-table chat 103/0, benefit-table 107/0, simple chat 84, r5 18/18, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with origin/main (44fb9ec) clean.

Verdict: READY.

## R275: #156 at 8d5a6c7

H1 is fixed: the count is taken only when exactly one count match is found.

**H2 is still open (High). The single-child check is a deny-list, and plain single-child events get past it.** childrenSaid gives 2 for each of these:
- "we have 2 kids; if one gets cancer how much in total";
- "we have 2 kids, if Jamie is diagnosed how much in total";
- "in total, what if the elder of our 2 kids is hospitalised";
- "we have 2 kids, if he gets dengue how much in total";
- "total payout for our 2 kids if the younger gets cancer".

A per-child benefit paid on that one child's event is then shown doubled, which is a wrong claimable amount. This is the R241/R242 lesson again: a deny-list of phrasings leaks. Fix (allow-list): take the count only when every word of the message, after removing the count phrase, is on a small known set:
- question and total words: how, much, what, in, total, altogether, all, both, for, would, will, does, do, it, pay, get, we, our, my, the, have, has, if;
- the insured's own events in first person: I, me, die, dies, pass, passes, away, death, am, disabled, diagnosed (with "I").
Any other word (a name, he, she, one, elder, younger, hospitalised…) gives no count. These still pass:
- "how much in total if we have two kids";
- "how much altogether for our 3 children if I die";
- "if I pass away how much would the 2 kids get in total".

**M1 is partly open (Medium).** countPays reads only `st.conditions`, which are the model's own conditions for the row it named (chat.ts:567 keeps them for the named row). If the model leaves out the row's printed cap ("total payable under this benefit shall not exceed S$8,000"), nothing sees it. Fix: also refuse when the named ChatRow's own conditions state money or a limit word. amountsFromRows can attach them, for example as a server-only field on the statement. The word check here (money, limit, total, exceed…) refuses any such wording, so it is the safe direction for a refusal and is fine as it is.

Checks on 8d5a6c7, run network-blocked with model keys stripped:
- per-child 15/0, benefit-table chat 96/0, simple chat 84, r5 18/18, monetary-boundary 32, scenario-replay 22/22;
- tsc clean, next build passes, merge-tree with main clean.

Verdict: NOT READY (H2).

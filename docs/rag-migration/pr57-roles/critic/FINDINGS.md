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

# PR #57 follow-up: release report (Developer)

**Release decision: not release-ready.** The coordinator gives the integrated verdict once testing, evidence review and the UX pass
on C6 report. Until then the PR stays a draft.

## Commits

- Tested commit: **C6 `f4937ef160a06420bf5e526df8d3ab979dc9f11b`** (`CANDIDATE.md`), the last code round, on top of the Test
  engineer's C5 release run (`f7d115a`, `test/FINDINGS-C5.md`) and browser expectation changes (`f07f8a0`). Before it, C5 `177c073`. C3 `1766863` was assessed
  by the Test engineer (`test/FINDINGS-C3.md`, `b4e0ed0`); C4 and C5 add only the fixes for the C3 and C4 reviews. C0 is `4956588`.
- PR head: C6 plus docs only. No product code after C6.

### C6 changes (the Test engineer's C5 findings)

- Partial copy: "I checked Daniel’s documents for GP or outpatient treatment: the Scheme X Group Insurance Scheme in full, and the text
  of the Scheme X Group Insurance (product summary) (pages 8, 12-13 and 37 of 37 pages) ... Those pages do not mention GP or outpatient
  treatment. The text of the other pages was not stored, so they could not be checked, and I can't say either way whether there is such
  cover." The page count is the uploaded file's own, so C5's "not in the copy that was uploaded" was wrong.
- Critic R8-1: "whether that trip fits this event" only when a Destination line is printed; otherwise "whether this period of insurance
  covers the date of the event".
- Corrected hip turn (actuallib SA2): the S$450,000 row "Hip" of "Simple Fracture or Other Fracture due to Accident" is labelled as
  neither kind; it now says "the benefit names Simple Fracture and Other Fracture alike, and this row is labelled as neither; these
  documents do not define either kind, so the insurer decides how it applies", as a labelled row says on the first turn.

Results on C6 (scripted, no spend): acceptance AC 34/40 (the same 6 open: R1, R2, R3, R7, R9, N5b), GUARD 49/49; fx-repairs 89/89;
structured-answers 123/123 + 8/8, absence-scope 32/32, tools 38/38, applicability 36/36 + 2/2, death suites green, s52 replay 12/12,
live-verify 5/5, env-contract and typecheck green.

### C5 changes (after the C4 reviews)

- Travel (Evidence Reviewer, Critic R7-1): C4's suppression is removed; it compared the trip with today, not the date of death, and
  needed the exact destination word. A trip schedule's terms now always carry what its own page prints: "The Single Trip Travel
  Insurance - Policy Schedule (page 1) prints Accidental Death: S$100,000. The schedule prints this cover for the insured person “Wong
  Jia Hui, Adrian”, the period of insurance “10/03/2025 to 17/03/2025” and the destination “Indonesia”; whether that trip fits this
  event is for the insurer to confirm." (`developer/japan-death-repro.ts`, scripted)
- Partial copy: "are not in the copy that was uploaded" when the page count proves pages are missing (e.g. 4 of 37); "may not all be"
  only when no page count is known.
- R7-3: "an open fracture".
- Closed hip on actuallib (Evidence Reviewer): checked, no change needed. The answer gives S$3,750 (Product Summary p13) and S$450,000
  (Benefit Summary p8) under "these are alternatives from separate documents, never a total", with the Core-or-Voluntary condition
  printed under the table, "Neither document says whether one amends, replaces or adds to the other", and the next step asking the
  insurer which schedule applies (scripted hip variant of actuallib J1).

Results on C5 (scripted, no spend): acceptance AC 31/37 (the same 6 open), GUARD 47/47; structured-answers 123/123 + 8/8,
absence-scope 32/32, tools 38/38, applicability 36/36 + 2/2, death suites green, live-verify 5/5, env-contract and typecheck green;
fx-repairs 88/89 (A12 expects the replaced partial-copy words; Test engineer's check); s52 replay 11/12 as on C2-C4.

### C4 changes (after the C3 reviews)

### C4 changes (after the C3 reviews)

- Critic R6-1: G1 now finds the person's certificate rows by display or preferred name, word-bounded, or every word of the display name in
  any order ("Lee Wei Ming, Daniel" for "Daniel Lee Wei Ming"), and drops rows naming another member. Shown with
  `developer/gp-bill-reconstruction.ts` (`DISPLAY="Daniel Lee Wei Ming"`): the same answer as the certificate-order name.
- Critic R6-2: C2's medical-term veto ("medical expenses", "outpatient", "clinic", ...) is back beside the sentence rule.
- Other Fracture (Evidence Reviewer, UX): "these documents do not define which fractures count as Other Fracture, or whether a closed
  fracture is one, so the insurer decides whether it applies", beside the figure (actuallib, scripted).
- Partial copy (UX): "I checked Grace's documents for dental treatment: ... (pages 8, 12-13 of 37). Those pages do not mention dental
  treatment. The other pages are not in the copy that was uploaded, so I can't say either way whether there is such cover."
- Travel S$100,000: suppressed in C4; replaced in C5 (above).

Results on C4 (scripted, no spend): acceptance with the Test engineer's new checks AC 31/37 (the same 6 open), GUARD 47/47;
structured-answers 123/123 + 8/8, absence-scope 32/32, tools 38/38, applicability 36/36 + 2/2, death suites green, live-verify 5/5,
env-contract and typecheck green. **fx-repairs 88/89: A12 expects the old words "could not be checked"**, which the UX asked to replace;
the Test engineer owns that check. s52 replay 11/12 as on C2 and C3.
- PR #59 (switch from OpenAI to Claude) is **not** in this branch.

## What users can now do (compared with production `4956588`)

- **Corrections stay with the right person.** "Daniel broke his arm too" no longer moves Grace's facts to Daniel. Only an explicit
  correction ("it was Daniel, not Grace", "mixed them up") moves them, and a reverse correction restores them.
- **Mixed causes keep the accident benefit.** "Felt sick and fainted, hitting her head" keeps the accident benefit's printed terms
  and conditions, without a verdict. A pure illness says the accident condition is not met on what was told, keeps the printed terms
  as terms (not an amount for the stay), names other cover the certificate lists (dated, no amount), and says the insurer decides.
- **A table's own printed condition stays with its figure**, e.g. "can only be claimed either under the Core Scheme or Voluntary
  Scheme" under the fracture table.
- **The fracture answer repeats less.** It says once that the documents don't settle which alternative applies. No evidence
  category shows this yet (see below).
- **"Not described" is said only over documents read in full.** Otherwise the answer says which pages were read and that the rest
  couldn't be checked, instead of "I couldn't confirm".
- **DC's GP-bill question gets an answer.** The answer says what the certificate lists (dated), that the scheme also names an
  Outpatient Medicare Policy the certificate doesn't list, and that the documents don't describe GP or outpatient cover (not the
  same as no cover; the insurer confirms). If a document does print medical-expense wording, the answer quotes it, cited.
  "I haven't yet looked up" no longer appears after a search.
- **A death answer names every documented death benefit with its printed condition**, including "Repatriation of Mortal Remains:
  S$2,000, with the printed condition “per Insured Person, if death occurs outside Singapore as a result of an Accident”" (C3).
- **The GP-bill answer never quotes the scheme's own list of policies**, reads only the person's own certificate rows, and treats
  doctor, practitioner and charges wording as medical-expense wording (C3).
- **Saved answers stay honest on reopening.** A "not found" answer is withdrawn when a document is added to its scope. A reopened
  figure must sit inside its own record sentence.

## Real defects still open

| item | owner view |
| --- | --- |
| N5b / Critic C1-3: "Re-analyse" keeps the document's id and file hash but rewrites its pages, members and coverage in place, so a saved calculation or absence still stands afterwards | Medium, open. Fix: save a digest of the pages each answer read and compare on reopen (`developer/C1.md`). Not in C3 |
| Death answer: the Term Life "Terminal Illness Benefit" line is added to a death answer | Low, open |
| Critic R8-1 (annual schedule called a trip) | fixed in C6 |
| Critic R7-2: a non-member row sharing the person's preferred name can be read as theirs in the scheme-listing sentence (a product name only, never an amount) | Low, open |
| Critic R6-3: an exclusion sentence can be quoted as medical-expense wording | open |
| Critic R6-4: "Policy Policy" in the scheme-listing sentence when a list entry already ends in "Policy" | open |
| A quoted scheme line carries no "scheme wording, not proof of cover" qualifier | open |
| Sickness-stay length (UX) | open, unchanged by decision |
| No live run of any C1-C4 change; the Claude switch (PR #59) is unverified | open |
| UX: sources are plain, not clickable, and repeated | open (main), not in C3 |
| UX: the unreadable-upload card has no filename and hides the stored reason | open (main), not in C3 |
| UX: answers superseded by a correction are not marked as replaced (the correction notice in the new answer is back; the earlier answer above it still shows its figures unmarked) | open (main) |
| UX: the family page says "5 linked documents" while the library shows 4 | open (main), not in C3 |
| R7 / R9 (K6a, K6c wording), R2 (K4b repetition, kept by the Critic's rule), R1/R3 (repetition) | accepted wording gaps |
| Living Care: "listed but not described" is not said; the server can say "not described" only over documents read in full, and that scope is partly stored | open, needs a live run or a fully stored document |
| `rag2-s52-replay`: 11/12; "the differences from the live answers are exactly the fixes above" fails on S52A (the repatriation sentence is now split in two) | Same on C2 (checked); a test expectation for the Test engineer, not a C3 regression |
| No executable check that the S$120,000 illustration keeps the Core/Voluntary condition; no test for F4 (a quoted bare "$") | test gaps (QC, Critic) |

### Checked in C3 and found not to be defects

- **Closed fracture and "Other Fracture" (UX top issue).** The UX transcripts `SA2x`, `SA3x`, `SA4` were labelled "booklet" but show the
  actuallib household (S$600,000 sum insured, Group Insurance Product Summary page 13, Benefit Summary page 8). Actuallib reproduces the
  real pages, which print **no** definition of Simple or Other Fracture (`scripts/fixtures/reliable-chat/actual-lib.ts:13`), so "these
  documents print no definition of which fractures that is" is true there. In the booklet household, which does print "Simple Fracture
  means a closed fracture" and "Other Fracture means a fracture that is not a Simple Fracture", a closed fracture gets no Other Fracture
  amount, question or terms (`reliable-chat:applicability-test`: 36/36, alt definitions 2/2). The wording was not changed: the Test
  engineer's recorded controls pin it.
- **Japan death (UX L2).** The L2 scenario is a next-steps display check whose script names only Term Life, and the UX test server forces
  the older answer contract for livelib, which production cannot run (`chatContract` returns `benefits` in production). Under the
  production contract the server adds Personal Accident S$600,000 and Accidental Death 100%; C3 adds the repatriation benefit and its
  condition (`developer/japan-death-repro.ts`).

## Evidence limits (not defects)

- All C3 evidence is **scripted** (the test-only scripted model, recorded replays, PGlite, anonymised households). There was no
  model call and no spend. Ledger: US$0.259121 left.
- R1/R3 (repetition) are not shown by any evidence category: recorded replay ids shift when evidence is added.
- The model-dependent parts need a live run with DC's authorisation (QC's order: J6 GP bill, J5 sickness, J2 correction, J3/J1).
- **Production trace of DC's GP-bill conversation: not read.** DC said yes, but this session's automatic safety check blocked the
  read; nothing was read. The reconstruction reproduces the live text line for line; which path the live model took is unconfirmed.
- C1-4: how many real documents have an empty stored page (which would make every absence over them refuse) is unmeasured.
- **All model evidence is for the OpenAI configuration** (fx-live runs). The Claude switch (PR #59, `MODEL_PRESET=anthropic`)
  needs its own verification.

## Model inputs and tool behaviour

- No prompt, model, preset or configuration change.
- Tool behaviour the model sees **did change**: `note_facts` / person-correction handling, the refusal texts of `not_found`
  (partial scope, the scheme-list case), and a repeated refused absence now becoming a server quote. Replays cannot show how
  the real model reacts.
- C3 adds no tool. It changes which absences are refused (medical-expense wording), the GP note after a refusal, and which death
  benefits the server adds.
- Post-model composition changed: server-written relation, absence, listing and quote statements; a fallback that runs the
  server's own absence check for a reported GP / clinic bill.

## Data, migration and rollback

- No database migration, no new table or column, no production data change.
- `types/index.ts`: `ChatAnswer.invalidated.reason` gains `"documents_added"` (optional field). `absenceChecks` is the existing field.
- Rollback: revert the merge. Answers saved under C3 reopen on C0 (the new field is ignored). On C0 an absence answer whose scope
  later grew is no longer withdrawn.
- `.env.example` documents 34 names (no runtime change).

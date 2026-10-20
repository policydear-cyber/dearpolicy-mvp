# PR #57 follow-up: release report (Developer)

**Release decision: not release-ready.** The coordinator gives the integrated verdict once testing, evidence review and the UX pass
on C3 report. Until then the PR stays a draft.

## Commits

- Tested commit: **C3 `17668630fab90a94997f3c918d8a5b31139ec40e`** (`CANDIDATE.md`). C0 is `4956588` (main, production).
- PR head: C3 plus docs only (this report, the candidate register, Developer scratch reproductions). No product code after C3.
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
| Death answer (livelib, scripted): the travel schedule's "Accidental Death: S$100,000" is printed without its trip dates (a 2025 trip), and the Term Life "Terminal Illness Benefit" line is added to a death answer | Medium / Low, open. Server-written lines from the benefit records; needs a trip-date rule, not a small change |
| UX: sources are plain, not clickable, and repeated | open (main), not in C3 |
| UX: the unreadable-upload card has no filename and hides the stored reason | open (main), not in C3 |
| UX: answers superseded by a correction are not marked | open (main), not in C3 |
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

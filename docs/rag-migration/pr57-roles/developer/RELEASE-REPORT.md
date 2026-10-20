# PR #57 follow-up: release report (Developer)

**Release decision: not release-ready.** The coordinator gives the integrated verdict once testing, evidence review and the UX pass
on C2 report. Until then the PR stays a draft.

## Commits

- Tested commit: **C2 `98ada990d0a792f7a7b8c2e1931704a07409d33d`** (`CANDIDATE.md`). C0 is `4956588` (main, production).
- PR head: C2 plus tests and docs only (Test engineer checks, reviewers' findings files, this report). No product code after C2.
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
- **Saved answers stay honest on reopening.** A "not found" answer is withdrawn when a document is added to its scope. A reopened
  figure must sit inside its own record sentence.

## Real defects still open

| item | owner view |
| --- | --- |
| N5b / Critic C1-3: re-analysis rewrites a document's pages in place (same id and file hash), so a saved calculation or absence is not withdrawn afterwards | Medium. Fix: save a digest of the pages each answer read and compare on reopen. Not in C2 |
| UX: sources are plain, not clickable, and repeated | open (main), not in C2 |
| UX: the unreadable-upload card has no filename and hides the stored reason | open (main), not in C2 |
| UX: answers superseded by a correction are not marked | open (main), not in C2 |
| UX: the family page says "5 linked documents" while the library shows 4 | open (main), not in C2 |
| UX top issue: a closed fracture shows the S$120,000+ "Other Fracture" alternative beside S$1,250 (pending QC fact check) | open |
| R7 / R9 (K6a, K6c wording), R2 (K4b repetition, kept by the Critic's rule) | accepted wording gaps |
| QC: "The pages that were read do not mention GP or outpatient treatment" right after naming "Outpatient Medicare" reads as a contradiction | Low, open |
| G1 conditions not met to the letter: the medical-expense check is a full-text scan of the person's documents, not the benefit records (Critic condition 5); the scheme page is named, not cited (condition 2) | for the Critic on C2 |
| No executable check that the S$120,000 illustration keeps the Core/Voluntary condition | test gap (QC) |

## Evidence limits (not defects)

- All C2 evidence is **scripted** (the test-only scripted model, recorded replays, PGlite, anonymised households). There was no
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
- Post-model composition changed: server-written relation, absence, listing and quote statements; a fallback that runs the
  server's own absence check for a reported GP / clinic bill.

## Data, migration and rollback

- No database migration, no new table or column, no production data change.
- `types/index.ts`: `ChatAnswer.invalidated.reason` gains `"documents_added"` (optional field). `absenceChecks` is the existing field.
- Rollback: revert the merge. Answers saved under C2 reopen on C0 (the new field is ignored). On C0 an absence answer whose scope
  later grew is no longer withdrawn.
- `.env.example` documents 34 names (no runtime change).

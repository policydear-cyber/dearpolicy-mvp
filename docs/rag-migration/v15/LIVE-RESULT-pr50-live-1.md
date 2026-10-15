# pr50-live-1: one pre-registered actual-model run of the three affected prompts — **FAIL** (P50C and P50D pass; P50A stopped by the run cap)

**Run facts**
- **Tested SHA:** `371ba7d3ec2f298735ec8234a04fa64a70c62ab6`. Before any call, the provenance guard checked the working tree against that commit's manifest (890 files).
- **Build:** `-GqmFKGh4u06esGcA0ela`, built from the same tree.
- **Pre-registration:** `docs/rag-migration/v15/EXPECTED-pr50-live-1.md`, graded by `scripts/rag2-live/pr50-check.ts`. Both were committed in `e3ae6cc`, before the run.
- **Model:** `openai:gpt-6-luna`, through the dedicated test key behind the loopback relay.
- **Household:** the anonymised PR #50 household, with snake_case file names and page 13 as stored, with tabs.
- **Cost:** US$0.003029 over 11 calls (0 refused, 0 failed), against a cap of US$0.006.
- **Ledger:** unreserved remaining is now US$0.081075. The US$0.15 `trial-codespace-1` reservation is untouched.
- **Run record:** `docs/rag-migration/live/RUN-pr50-live-1-2026-10-15T07-31-03/` (unaltered) and `pr50-grade.json` / `.md`. The run was not repeated.

## P50C, inventory: PASS (6/6)

```
Unlinked to a person: Harbourline General Insurance Pte. Ltd.’s Travel Insurance Policy Wording and Benefit Summary are readable reference documents, not linked to anyone in the household.
Adrian: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document); Public Officers Group Personal Accident - Summary of Benefits (KestrelOne, reference wording for the scheme, not a personal policy document); Public Officers Group Personal Accident - Policy Wording (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document).
Cheryl: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document); Public Officers Group Personal Accident - Summary of Benefits (KestrelOne, reference wording for the scheme, not a personal policy document); Public Officers Group Personal Accident - Policy Wording (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document).
Ethan: no documents on file.
Not linked to anyone in the household: Travel Insurance - Policy Wording (Harbourline General Insurance Pte. Ltd.); Travel Insurance - Benefit Summary (Harbourline General Insurance Pte. Ltd.) -- link it to a person so it can be used for them.
Not linked to anyone in the household, and its contents could not be read: scan_20241003_153045.jpg. Nothing in it can be used; linking it to a person would not change that -- it would first have to be read successfully.
```

| C1 | all six eligible uploads are displayed by identity (product name, or the exact file name with its case) | pass |
| C2 | each displayed upload is in the saved record (a citation of its document id, or its library name) | pass |
| C3 | the failed upload is stated as unreadable (on the line naming it); nothing is quoted from it | pass |
| C4 | the deleted upload and the other household's upload are absent (by name and by id) | pass |
| C5 | the travel insurer's documents are not presented as personal cover | pass |
| C6 | no token-limit / unfinished fallback | pass |

- All six eligible document ids are displayed:
  - CERT …101, SUMMARY …102 and WORDING …103, for both people;
  - TRAVEL_WORDING …104 and TRAVEL_SUMMARY …105, as unlinked reference documents;
  - SCAN …106, with its exact name `scan_20241003_153045.jpg`, as unreadable.
- DELETED …107 and OTHER …201 are absent.
- **Finding, not graded:**
  - The model's own unreadable-file sentence ("One unlinked file, “Scan 20241003 153045” (scan_20241003_153045.jpg), is unreadable; …") was dropped as "states cover or a figure without citing evidence", because the digits in the file name counted as a figure (the uncited-sentence check in `compose.ts`).
  - The server's inventory lines then supplied the status line, so nothing was lost. The digit-in-file-name check is still worth narrowing in a later round.

## P50D, fixed-limit fracture: PASS (4/4)

```
If the Simple Fracture provision applies to Adrian’s Leg row, the conditional illustration is S$2,500 (50% of the S$5,000 Simple Fracture Benefit Limit), not a promised payment.
This is distinct from the separate Other Fracture provision; the uploaded Summary of Benefits page reviewed here prints the Simple Fracture schedule, not an Other Fracture amount.
```

| D1 | a conditional S$2,500 is visible, and every sentence stating it is conditional / an illustration, not a payment | pass |
| D2 | a saved calculation: 50% from the "Jaw, Pelvis, Leg^, Ankle or Knee" row and S$5,000 from "Simple Fracture Benefit Limit: S$5,000", both Summary of Benefits page 13; result S$2,500 SGD; re-computes; Term Life S$1,000,000 is not an operand | pass |
| D3 | Simple and Other Fracture kept separate; no unrelated benefit label (Death due to Accident, Compassionate Death Allowance, Term Life) and no figure other than S$5,000 / S$2,500 | pass |
| D4 | no token-limit / unfinished fallback and no generic 'left out an amount' note in place of the illustration | pass |

**Saved calculation:** `conditional_illustration`, `lump_sum`, result **S$2,500 SGD**. It re-computes, and the assumption is "If the Simple Fracture provision applies to the Leg row".

| operand | value | source span |
|---|---|---|
| `benefit_limit` | S$5,000 | “Simple Fracture Benefit Limit: S$5,000”, Summary of Benefits (…102) p13, `sha256:pr50-summary` |
| `percent` | 50% | “Jaw, Pelvis, Leg^, Ankle or Knee<TAB>50%”, same document and page |

- Tools: resolve_person → person_benefits → search_passages → read_page → calculate, accepted on the first call → final_answer.
- No sentence was dropped, and the gate raised nothing.
- Term Life is not an operand.

## P50A, death next steps: FAIL (A1, A5)

```
I couldn’t look that up: the model-use budget set for this test run is used up, so no model was called.
```

| A1 | supported contact advice is visible: a step to contact / notify the person's own insurer (Kestrel) or the scheme administrator | **FAIL** |
| A2 | no instruction to contact or claim from the unrelated travel insurer (Harbourline), and its wording is not presented as Adrian's cover | pass |
| A3 | every amount shown is one the documents print for Adrian's scheme (Term Life S$1,000,000, PA S$600,000, the allowance S$3,000 / S$1,500) | pass |
| A4 | no unsupported exclusion (an uncertainty about enrolment is not said as 'not enrolled' / 'not covered') | pass |
| A5 | no token-limit / unfinished fallback | **FAIL** |

**Cause.**
- After three calls (note_facts, policies_for, person_benefits, then three searches), the run-cap guard refused the fourth call. The loop stopped with `limit: run_budget`: "US$0.003029 spent … of US$0.006; the next call may cost up to US$0.003756".
- The guard reserves each call's worst case: the full input plus the maximum output tokens, priced at list. By the fourth call of the third conversation that worst case was above the US$0.00297 still under the cap, although the actual spend was half the cap.
- So this conversation was not completed. The run does not show whether the repaired death answer (contact advice, uncertainty clause) holds on the real model.
- Per the authorisation, it was not rerun.

## Latency (model time vs time to visible answer)

| scenario | model calls | model time | accepted | answer persisted | answer seen | tokens in / out |
|---|---|---|---|---|---|---|
| P50C | 2 | 8.7 s | 0.7 s | 9.8 s | 10.1 s | 15,758 / 247 |
| P50D | 6 | 50.5 s | 0.0 s | 51.7 s | 52.0 s | 53,528 / 498 |
| P50A | 3 | 18.5 s | 0.0 s | 19.2 s | 19.3 s | 25,863 / 409 |

"Answer seen" is the time from the POST to the job result. It does not include rendering in a browser. The browser replays give the rendering overhead: about 2.2–3.3 s from click to visible answer with no model, and a checking indicator left for 7–36 ms after the answer appeared.

## Evidence class

This is synthetic real-model evidence on an anonymised household. It does not verify the actual library.

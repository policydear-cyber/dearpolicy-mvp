# s52-live-1 — pre-registered real-model run on the PR #50 candidate

- Tested SHA: `490fc32b2acffd9b87fd296def6af4d95bb52031` (provenance guard: request SHA = tested SHA; tree manifest matched). main unchanged at `5be9ec3`.
- Model: `openai:gpt-6-luna` (provider-reported `gpt-6-luna`), temperature 0, reasoning none, via the dedicated test key through the loopback relay.
- Pre-registration: `docs/rag-migration/v15/EXPECTED-s52.md`; grader `scripts/rag2-live/livelib-check.ts` (frozen before the run).
- One run only. Not rerun. Run record: `docs/rag-migration/live/RUN-s52-live-1-2026-10-14T15-40-42/` (unaltered).
- Budget: cap US$0.015; spent **US$0.008405** over 18 calls (0 refused, 0 failed); ledger remaining after run US$0.085894, nothing reserved.

## What this is evidence of

Synthetic real-model evidence: the real configured model, the real loop and save path, against **synthetic fixtures modelled on the report's stored passages and layouts** (placeholder names, insurer and identifiers). It is **not** verification against the household's actual library; that still requires a live check in production after an approved deploy.

## Verdict: FAIL (42/44 pre-registered checks pass; 2 fail, both S52D)

| Grade item | Result |
|---|---|
| Correct dated Term Life / PA | pass (S52A t1, S52B t1) |
| Useful death explanation and relevant next step | pass (Accidental Death 100% of Sum Insured, repatriation, notify insurer with death certificate) |
| Both dates used without asking again | pass |
| Person switch and wrong-amount correction | pass (“No—… S$600,000 …, not S$1,000,000”) |
| Unreadable upload included | pass (IMG_0042.jpg, could not be read) — composed, saved and displayed |
| Conditional S$2,500 from 50% of S$5,000 | **FAIL** — answer states 50% of S$5,000 but no S$2,500; no saved calculation |
| No Living Care Plus fallback | pass (all turns) |
| No borrowed 365-day dismemberment condition | pass (all turns) |
| No token-limit dead end | pass (no turn hit a limit) |

### S52D failure cause (from the trace)

The model called `calculate` with benefit “Simple Fracture”, a `proportion` `{evidence_id: e17, applies_when: "simple (closed) fracture"}` and an unresolved base id. The server refused: “proportion.evidence_id: that passage has no single line that prints one percentage for “simple (closed) fracture””. The model did not retry and answered in words. The refusal was correct (the row is not one line), but it was not actionable: it did not name the candidate rows (e.g. Leg 50%) or say to bind `percent_value_id`.

### Ungraded defects observed

1. S52D says the documents do not provide Adrian's PA Sum Insured — false; the certificate prints S$600,000 (retrieved in other turns).
2. S52A attributes “S$2,000” to the policy wording, which prints bare `$2,000` (summary prints S$2,000). The gate accepted it via same-document currency declaration; wording should quote the document's own form.
3. Compose dropped a printed “within 6 months” claims-notification clause from a Death Benefit sentence (`borrowedCondition` false positive).
4. S52C inventory ends with a stray “I couldn’t confirm an answer to that from your documents.”

## Per-turn tokens, latency, cost

| Turn | Tokens in / out | Model time | Saved at | Calls | Cost |
|---|---|---|---|---|---|
| S52A t1 | 40,885 / 1,109 | 15.5 s | 16.2 s | 4 | US$0.00212 |
| S52A t2 | 26,956 / 1,060 | 11.8 s | 13.1 s | 2 | US$0.00252 |
| S52B t1 | 24,058 / 230 | 7.2 s | 8.3 s | 3 | US$0.00059 |
| S52B t2 | 17,119 / 162 | 4.9 s | 6.0 s | 2 | US$0.00113 |
| S52C t1 | 15,732 / 243 | 6.0 s | 7.1 s | 2 | US$0.00042 |
| S52D t1 | 54,558 / 763 | 12.9 s | 13.3 s | 5 | US$0.00162 |

Conversation totals: S52A US$0.00464 (29.6 s), S52B US$0.00172 (14.8 s), S52C US$0.00042 (7.2 s), S52D US$0.00162 (13.4 s). Report baseline for comparison: 68,777 input tokens for death t1 and a limit stop at ~47k–59k for t2/t6; here the largest turn used 54,558 with no limit stop.

## Complete visible answers

```
=== S52A t 1 | Hypothetically, Adrian died in a car accident in Japan. What can I do?
For Adrian, the uploaded certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000, each as of 6 October 2022; these are dated document amounts, not confirmation of cover now or a claim payment.
The group accident wording states Accidental Death is 100% of the Sum Insured and that its territorial limits are worldwide, 24 hours a day; the certificate’s S$600,000 Group Personal Accident amount is dated 6 October 2022, so the documents do not establish the amount in force at a hypothetical future event.
The group accident wording lists S$2,000 for Repatriation of Mortal Remains if death occurs outside Singapore as a result of an Accident, and the policy wording says reasonable costs of returning the remains to Singapore are reimbursed up to S$2,000.
The Group Term Life product summary says its Death Benefit is the Sum Assured shown in the certificate and says to notify Kestrel Life Ltd with the death certificate.
The uploaded travel schedule lists Accidental Death of S$100,000 for a trip to Indonesia from 10 to 17 March 2025, so it does not document cover for a hypothetical trip to Japan.

=== S52A t 2 | Hypothetically, the accident happened on 3 October 2026 and Adrian died on 5 October 2026. Please explain the benefits and the next steps.
You told me “the accident happened on 3 October 2026” and “Adrian died on 5 October 2026.”
For Adrian, the certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Term Life product summary says its Death Benefit is the Sum Assured shown in the certificate, payable on the insured person’s death, but the dated certificate does not establish the amount in force on the hypothetical 2026 death date.
For Adrian, the group accident wording states Accidental Death is 100% of the Sum Insured and territorial limits are worldwide, 24 hours a day; his certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, so the uploaded documents do not establish the Sum Insured in force on 3 October 2026.
For Adrian, the group accident wording provides Repatriation of Mortal Remains of S$2,000 if death occurs outside Singapore as a result of an Accident, and the policy wording says reasonable costs of returning the remains to Singapore are reimbursed up to S$2,000.
For Adrian, the Group Term Life product summary says to notify Kestrel Life Ltd of a death and provide the death certificate.

=== S52B t 1 | What are Adrian's Term Life and Personal Accident amounts, and what date is the certificate?
Adrian’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.
It lists Group Personal Accident of S$600,000 as of 6 October 2022.
The certificate date shown is 6 October 2022 (page 1).

=== S52B t 2 | And Cheryl? Her Personal Accident cover is S$1,000,000, right?
No—the certificate lists Cheryl’s Group Personal Accident amount as S$600,000 as of 6 October 2022, not S$1,000,000.

=== S52C t 1 | List all our uploaded documents and their roles, including any files that could not be read.
Adrian: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document); Public Officers Group Personal Accident - Summary of Benefits (KestrelOne, reference wording for the scheme, not a personal policy document); Public Officers Group Personal Accident - Policy Wording (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document); Public Officers Group Term Life - Product Summary (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document); Single Trip Travel Insurance - Policy Schedule (Falcon General, a personal policy document).
Cheryl: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document); Public Officers Group Personal Accident - Summary of Benefits (KestrelOne, reference wording for the scheme, not a personal policy document); Public Officers Group Personal Accident - Policy Wording (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document); Public Officers Group Term Life - Product Summary (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document).
Not linked to anyone in the household: IMG_0042.jpg (could not be read) -- link it to a person so it can be used for them.
I couldn’t confirm an answer to that from your documents.

=== S52D t 1 | Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be? How is that different from Other Fracture?
For Adrian, the Simple Fracture section lists a S$5,000 benefit limit and 50% for a leg, ankle, knee, jaw or pelvis fracture—so the printed calculation is 50% of that limit for a leg fracture, provided it is a Simple Fracture caused by an Accident.
The wording defines a Simple Fracture as a closed fracture where the skin is not broken, and defines Other Fracture as a fracture that is not a Simple Fracture, including a compound (open) fracture.
For comparison, the Other Fracture table lists 50% of the Sum Insured for a leg, ankle, knee, jaw or pelvis fracture, rather than 50% of the Simple Fracture Benefit Limit.
The uploaded documents do not provide Adrian’s Group Personal Accident Sum Insured, so I can’t work out the Other Fracture amount from these documents.

```

## Recommendation

Do not merge yet. Seven of the nine graded behaviours from the report now pass on synthetic fixtures, including the inventory status line through save and display, no fallback substitution and no borrowed condition. The fracture arithmetic — one of the report's two outright failures — still fails. Next: make the calculate refusal actionable (list candidate rows and the percent/base ids to bind), fix the four ungraded defects with scripted controls, then a separately authorised re-run on a new frozen SHA, and after any approved deploy, a live check against the actual library.

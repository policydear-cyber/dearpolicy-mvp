# V1.5: s52-live-1 follow-up (PR #50) — frozen `1be70cb4389a0669be4e05041f1b6589bcfb4558`

- Product code: frozen at `14a41e5e0e8181f518e8a1d98ac031bbc697a692`. `1be70cb` changes only the s52 replay script
  and spec, which now compare exactly what the chat page shows.
- main is unchanged at `5be9ec3`. Nothing was merged or deployed.
- **No model call was made.** The ledger is unchanged; see live/LEDGER-RECONCILIATION-2026-10-15.md.

## Evidence classes

All of this is synthetic or replayed. None of it verifies the household's actual library.

| Evidence | What it shows |
|---|---|
| Replay of all six s52-live-1 turns: the recorded model output played verbatim through the real chat route, composer and save path (`npm run rag2:s52-replay`, 11/11) | What the CURRENT product does with the output the real model actually produced |
| Browser replay of the same six turns (`npm run e2e:rag2-s52-replay`, 4/4) | The page displays exactly the saved answer |
| Scripted controls (`npm run rag2:live-verify-test`: report 5/5, binding 7/7, livelib 13/13, multiline 5/5) | Each fix and its negative control, on synthetic households |

## 1. Multiline calculation evidence

**Cause in s52-live-1.**
- The model passed `proportion.evidence_id` = a search passage that **stops at the table's first row** (Skull 100%).
  The leg row is the next line of the same page.
- The existing tail-of-table read found the leg row. However, the row selector ignored three-letter words, so the
  condition's "leg" matched nothing and the call was refused.

**Fix** (lib/rag2/calc/pct-rows.ts, used by the loop's evidence resolver and by lump_sum).
- The percentage table on the passage's own stored page is reconstructed with:
  - its section heading;
  - the "% of ..." header that names the base;
  - continuation lines: a label wrapped onto the next line, or a percentage printed on its own line;
  - its exact span (the same document, page and characters).
- The ONE row that the condition's own words name, in the benefit's own table, is used.
- These cases stay refused:
  - **A tie, or no row named.** The refusal is now actionable: it lists the table's rows as valid value ids
    ("v12 = “Jaw, Pelvis, Leg, Ankle or Knee” 50% (Bone fractured Compensation (% of S$5,000), Simple Fracture) … call
    calculate again with that id as percent_value_id and without proportion").
  - **A row printed twice with different percentages, or a row printing no percentage.** These stay unresolved, and
    no id is offered for them.
- A percentage read for a benefit NAME must be in that benefit's own table and must single out its row. This closes a
  wrong pick found while testing: "Simple Fracture" had selected "Skull (Other Fracture) 100%" from the adjacent table.

**Proved.**
- **MULTILINE, live layout.** s52-live-1's exact calculate call gives 50% × S$5,000 = S$2,500 (conditional). The
  calculation is saved with operands [50, 5000]; `recomputeCalculation` gives 250000 minor units; `verifyAnswerFigures`
  on the saved answer finds no problem; saved = returned.
- **MULTILINE, wrapped row.** The leg row "Jaw, Pelvis, Leg,\nAnkle or Knee   50%" gives the same result. The saved
  operand carries the row text, page 13 and document hash; the base is the table's own "Simple Fracture Benefit Limit:
  S$5,000". The record re-verifies.
- **ADJACENT.** The Other Fracture table printed right below supplies only its OWN row and base: 60% × Sum Insured
  S$600,000 = S$360,000 for "Other Fracture". It never supplies a row or base to Simple Fracture.
- **AMBIGUOUS.** "leg or arm" is refused with the rows' ids, and the other table's rows are not offered. The next call
  with the leg row's id gives S$2,500.
- **CONFLICT / INCOMPLETE.** Shoulder 20% vs 30%, and Hip "see Note 2", are refused with no id, no figure and no saved
  calculation.
- **Replay.** S52D's recorded calculate call now runs: a conditional illustration of 2500.

## 2. The four observed defects

All four are fixed in composition, and each is checked on the saved and browser-shown answer.

| Defect | Fix | Replay result | Control |
|---|---|---|---|
| "The uploaded documents do not provide Adrian’s Group Personal Accident Sum Insured" (S52D) | A sentence saying a person's sum insured for a product is not in the documents is taken out when that person's own certificate row for the product prints it. A dated limitation ("do not establish the Sum Insured in force on 3 October 2026") is a different statement and is kept. | Taken out ("…Certificate lists S$600,000 as of 2022-10-06 (page 1)"). The dated limitations in S52A are kept. | — |
| S$2,000 attributed to the policy wording, which prints bare $2,000 (S52A) | The cited line a clause restates is found by its words. When that line prints the amount with a bare $, S$ is allowed only on **that document's own** currency statement, which is then quoted and cited with the amount. Otherwise that clause is taken out. | "…and the policy wording says … up to S$2,000" is taken out in both turns. The summary's S$2,000 is kept. | CURRENCY: with "All amounts in this Policy are in Singapore Dollars." on file, the clause is kept with the statement quoted and cited. |
| "within 6 months" taken out of the Term Life death sentence (S52A) | A window printed under a policy-wide heading (Claims, notice, general conditions) governs that document's policy. It is kept for any benefit or product of the same document, and taken out when attached to another document's benefit or product. The 365-day dismemberment control is unchanged. | Kept in both turns. | NOTICE: attached to the Personal Accident policy's Accidental Death, it is taken out. |
| Generic "I couldn’t confirm an answer to that from your documents." under the inventory (S52C) | Not shown when the inventory answers the question. | Gone; every upload and IMG_0042.jpg are listed. | — |

## 3. Travel conclusion

- **The saved s52 answer did not overstate.** Turn 1 says "…so it does not document cover for a hypothetical trip to
  Japan" (not proven). Its evidence, a schedule for Indonesia 10–17 March 2025, supports exactly that.
- **Turn 2 had the reverse error.** "…so it does not document travel cover for Japan in October 2026" was taken out
  live as if it asserted an exclusion. "does not document / show / establish cover" is now treated as not-proven, not as
  an exclusion, so that sentence is shown.
- **Guard added.** "does not cover / is not covered / excludes" a trip stands only on a printed exclusion or territorial
  limit naming the place. Otherwise it is reworded to "does not show cover for".
- **Control (TRAVEL).** On a schedule for another trip, the sentence is reworded. A sentence that is already "does not
  show cover" is kept. With "Exclusions: travel to Japan is excluded." printed, the exclusion stands.

## 4. Ledger

See live/LEDGER-RECONCILIATION-2026-10-15.md.
- Unreserved remaining: US$0.085894.
- The US$0.15 `trial-codespace-1` allocation is still open: reserved, unspent and not released.
- ROUND8-RESULTS.md had double-counted it ("US$0.027111 left"; it was US$0.177111 at the time).

## 5. Verification on the frozen code

- Typecheck clean.
- 51 affected suites, rc 0 each: verify:*, all rag2:* suites including rag2:live-verify-test and rag2:s52-replay,
  the monetary and currency boundary tests, import boundary, CI workflow coverage, and the v1 / v11 / r5–r11 answer
  suites.
- `next build` OK.
- Browser:
  - s52 replay 4/4 (on `1be70cb`);
  - livelib inventory 1/1 and s50 replay 1/1 (on `14a41e5`, the same product code).

## Complete visible transcripts: replay on `1be70cb`, as the page shows them

**S52A — “Hypothetically, Adrian died in a car accident in Japan. What can I do?”**

```
For Adrian, the uploaded certificate lists Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000, each as of 6 October 2022; these are dated document amounts, not confirmation of cover now or a claim payment.
The group accident wording states Accidental Death is 100% of the Sum Insured and that its territorial limits are worldwide, 24 hours a day; the certificate’s S$600,000 Group Personal Accident amount is dated 6 October 2022, so the documents do not establish the amount in force at a hypothetical future event.
The group accident wording lists S$2,000 for Repatriation of Mortal Remains if death occurs outside Singapore as a result of an Accident.
The Group Term Life product summary says its Death Benefit is the Sum Assured shown in the certificate and says to notify Kestrel Life Ltd within 6 months with the death certificate.
The uploaded travel schedule lists Accidental Death of S$100,000 for a trip to Indonesia from 10 to 17 March 2025, so it does not document cover for a hypothetical trip to Japan.
If this were a real event, contact the relevant insurers and Adrian’s employer or scheme administrator promptly to confirm cover on the event date, claim requirements, and how to submit the claims.
```

**S52A — “Hypothetically, the accident happened on 3 October 2026 and Adrian died on 5 October 2026. Please explain the benefits and the next steps.”**

```
You told me “the accident happened on 3 October 2026” and “Adrian died on 5 October 2026.”
For Adrian, the certificate lists Group Term Life of S$1,000,000 as of 6 October 2022; the Group Term Life product summary says its Death Benefit is the Sum Assured shown in the certificate, payable on the insured person’s death, but the dated certificate does not establish the amount in force on the hypothetical 2026 death date.
For Adrian, the group accident wording states Accidental Death is 100% of the Sum Insured and territorial limits are worldwide, 24 hours a day; his certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, so the uploaded documents do not establish the Sum Insured in force on 3 October 2026.
For Adrian, the group accident wording provides Repatriation of Mortal Remains of S$2,000 if death occurs outside Singapore as a result of an Accident.
For Adrian, the Group Term Life product summary says to notify Kestrel Life Ltd of a death within 6 months and provide the death certificate.
The uploaded travel schedule is for Indonesia from 10 to 17 March 2025, so it does not document travel cover for Japan in October 2026.
Notify Kestrel Life Ltd about the Group Term Life death claim within the stated six-month period and provide the death certificate.
```

**S52B — “What are Adrian's Term Life and Personal Accident amounts, and what date is the certificate?”**

```
Adrian’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.
It lists Group Personal Accident of S$600,000 as of 6 October 2022.
The certificate date shown is 6 October 2022 (page 1).
```

**S52B — “And Cheryl? Her Personal Accident cover is S$1,000,000, right?”**

```
No—the certificate lists Cheryl’s Group Personal Accident amount as S$600,000 as of 6 October 2022, not S$1,000,000.
```

**S52C — “List all our uploaded documents and their roles, including any files that could not be read.”**

```
Adrian: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document); Public Officers Group Personal Accident - Summary of Benefits (KestrelOne, reference wording for the scheme, not a personal policy document); Public Officers Group Personal Accident - Policy Wording (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document); Public Officers Group Term Life - Product Summary (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document); Single Trip Travel Insurance - Policy Schedule (Falcon General, a personal policy document).
Cheryl: Public Officers Group Insurance Scheme - Certificate (Kestrel Life Ltd, a personal policy document); Public Officers Group Personal Accident - Summary of Benefits (KestrelOne, reference wording for the scheme, not a personal policy document); Public Officers Group Personal Accident - Policy Wording (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document); Public Officers Group Term Life - Product Summary (Kestrel Life Ltd, reference wording for the scheme, not a personal policy document).
Not linked to anyone in the household: IMG_0042.jpg (could not be read) -- link it to a person so it can be used for them.
```

**S52D — “Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be? How is that different from Other Fracture?”**

```
For Adrian, the Simple Fracture section lists a S$5,000 benefit limit and 50% for a leg, ankle, knee, jaw or pelvis fracture—so the printed calculation is 50% of that limit for a leg fracture, provided it is a Simple Fracture caused by an Accident.
The wording defines a Simple Fracture as a closed fracture where the skin is not broken, and defines Other Fracture as a fracture that is not a Simple Fracture, including a compound (open) fracture.
For comparison, the Other Fracture table lists 50% of the Sum Insured for a leg, ankle, knee, jaw or pelvis fracture, rather than 50% of the Simple Fracture Benefit Limit.
```

These are the answers saved and displayed. The browser spec checks that every saved line is displayed.
Machine-readable record: live/RUN-s52-live-1-2026-10-14T15-40-42/REPLAY-1be70cb.json (calculations, bindings,
citations, tool outcomes, drops).

## Remaining limitations

1. **Model-dependent: S$2,500 in the S52D answer.**
   - The replay shows the recorded calculate call now succeeds. It cannot show what the model writes next: the
     recorded final answer was written after a refusal, so it does not state S$2,500.
   - Whether the real model now states the conditional S$2,500 citing the saved calculation (or, in another wording,
     retries with an offered value id) is not established.
   - **Smallest test:** one pre-registered real-model run of the S52D turn only, on the frozen code, through the
     existing dedicated setup.
     - Cap: about US$0.006. The live turn cost US$0.00162 over 5 calls; the largest per-call reservation was about
       US$0.0035.
     - Pass: a visible conditional S$2,500, bound to a saved calculation with operands 50% and S$5,000; no Other
       Fracture amount; no "Sum Insured not provided".
     - Not started: it needs your authorisation.
2. **Synthetic, not the actual library.** The live fixtures mirror the report's stored passages and layouts. The real
   page's search-chunk boundaries, row wrapping and whether the real wording declares its currency are not known here.
3. **Reconstruction scope.** Only tables with a "% of …" header are reconstructed; other tables keep the previous
   handling. A label-only sub-heading directly above a row (at most two lines) would be read as that row's wrapped
   label.
4. **The trip guard** finds places by capitalised words after "to / in / for / of". The policy-wide window rule
   recognises a product by all distinctive words of its document name.
5. **Next steps.** The page shows only the first next step when there is no question. S52A turn 2's other two
   suggested steps are saved but not displayed, as on live.

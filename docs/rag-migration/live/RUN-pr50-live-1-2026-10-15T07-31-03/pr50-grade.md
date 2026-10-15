# pr50-live-1 grade (pr50-check.ts, pre-registered): FAIL

## P50C

| id | requirement | result | detail |
|---|---|---|---|
| C1 | all six eligible uploads are displayed by identity (product name, or the exact file name with its case) | pass |  |
| C2 | each displayed upload is in the saved record (a citation of its document id, or its library name) | pass |  |
| C3 | the failed upload is stated as unreadable (on the line naming it); nothing is quoted from it | pass |  |
| C4 | the deleted upload and the other household's upload are absent (by name and by id) | pass |  |
| C5 | the travel insurer's documents are not presented as personal cover | pass |  |
| C6 | no token-limit / unfinished fallback | pass |  |

## P50D

| id | requirement | result | detail |
|---|---|---|---|
| D1 | a conditional S$2,500 is visible, and every sentence stating it is conditional / an illustration, not a payment | pass |  |
| D2 | a saved calculation: 50% from the "Jaw, Pelvis, Leg^, Ankle or Knee" row and S$5,000 from "Simple Fracture Benefit Limit: S$5,000", both Summary of Benefits page 13; result S$2,500 SGD; re-computes; Term Life S$1,000,000 is not an operand | pass |  |
| D3 | Simple and Other Fracture kept separate; no unrelated benefit label (Death due to Accident, Compassionate Death Allowance, Term Life) and no figure other than S$5,000 / S$2,500 | pass |  |
| D4 | no token-limit / unfinished fallback and no generic 'left out an amount' note in place of the illustration | pass |  |

## P50A

| id | requirement | result | detail |
|---|---|---|---|
| A1 | supported contact advice is visible: a step to contact / notify the person's own insurer (Kestrel) or the scheme administrator | **FAIL** | I couldn’t look that up: the model-use budget set for this test run is used up, so no model was called. |
| A2 | no instruction to contact or claim from the unrelated travel insurer (Harbourline), and its wording is not presented as Adrian's cover | pass |  |
| A3 | every amount shown is one the documents print for Adrian's scheme (Term Life S$1,000,000, PA S$600,000, the allowance S$3,000 / S$1,500) | pass |  |
| A4 | no unsupported exclusion (an uncertainty about enrolment is not said as 'not enrolled' / 'not covered') | pass |  |
| A5 | no token-limit / unfinished fallback | **FAIL** | I couldn’t look that up: the model-use budget set for this test run is used up, so no model was called. |


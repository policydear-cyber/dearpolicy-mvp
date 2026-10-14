# S47 actual-model grade: FAIL (earliest failing stage: model reasoning-tool selection)


| turn | check | result | stage | detail |
|---|---|---|---|---|
| all | Desmond's Personal Accident sum insured (S$300,000) is stated | **FAIL** | model reasoning-tool selection |  |
| all | never states S$500,000 (Group Term Life) | pass |  |  |
| all | never states S$200,000 (Grace's amount) | pass |  |  |
| all | never states S$250,000 (superseded certificate) | pass |  |  |
| all | never states S$800,000 (another household) | pass |  |  |
| all | never states S$900,000 (another household) | pass |  |  |
| all | the certificate's sum insured is read when it is available (not 'I haven't yet read the sum insured') | pass |  |  |
| all | never claims current cover / cover in force | pass |  |  |
| 4 | 'transverse' does not select a payout row (no 'Other fracture' / 1%) | pass |  |  |
| 4 | after 'transverse' it asks for the detail the schedule uses (bone, or closed/open) | **FAIL** | model reasoning-tool selection |  |
| 4 | 'transverse' is not saved as a correction | pass |  |  |
| 4 | no 'Updated: … at first' correction note | pass |  |  |
| 5 | the closed-tibia illustration S$9,000 (6% x S$300,000 x 50%) is shown | **FAIL** | calculation | PLUMBING TEST: this reply comes from a local fake endpoint, not from a model. PLUMBING TEST: this reply comes from a local fake endpoint, not from a model. |
| 5 | a saved lump_sum record of S$9,000 for the lower leg | **FAIL** | calculation | [] |
| 5 | S$18,000 is not given as the amount for the closed fracture | pass |  |  |
| 3 | never S$200 for the stay (two nights are not two payable days) | pass |  |  |
| 4 | never S$200 for the stay (two nights are not two payable days) | pass |  |  |
| 5 | never S$200 for the stay (two nights are not two payable days) | pass |  |  |
| 6 | never S$200 for the stay (two nights are not two payable days) | pass |  |  |
| 6 | the stay's Accident Hospital Income S$100 (one complete 24-hour period) is shown | **FAIL** | calculation | PLUMBING TEST: this reply comes from a local fake endpoint, not from a model. |
| 6 | a saved hospital_cash record of S$100 | **FAIL** | calculation | [] |
| 3 | the reported hospital stay is addressed by turn 3 or 4 (hospital income / complete 24 hours) | **FAIL** | model reasoning-tool selection | PLUMBING TEST: this reply comes from a local fake endpoint, not from a model.PLUMBING TEST: this reply comes from a local fake endpoint, not from a model. |
| all | does not ask how it happened after turn 2 | pass |  |  |
| all | does not ask about the X-ray after turn 3 | pass |  |  |
| all | does not ask which bone / closed or open after turn 5 | pass |  |  |
| all | does not ask for the admission / discharge times after turn 6 | pass |  |  |
| all | saved facts include the X-ray, the nights, the closed tibia and both times | **FAIL** | model reasoning-tool selection |  |
| all | no amount is called approved / paid / what he will receive | pass |  |  |
| 6 | the final answer gives useful information (a figure with its basis), not only echoes, caveats or an insurer referral | **FAIL** | presentation | PLUMBING TEST: this reply comes from a local fake endpoint, not from a model. |

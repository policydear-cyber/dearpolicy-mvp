# S47 actual-model grade: FAIL (earliest failing stage: model reasoning-tool selection)


| turn | check | result | stage | detail |
|---|---|---|---|---|
| all | Desmond's Personal Accident sum insured (S$300,000) is stated | pass |  |  |
| all | never states S$500,000 (Group Term Life) | pass |  |  |
| all | never states S$200,000 (Grace's amount) | pass |  |  |
| all | never states S$250,000 (superseded certificate) | pass |  |  |
| all | never states S$800,000 (another household) | pass |  |  |
| all | never states S$900,000 (another household) | pass |  |  |
| 1 | the certificate's sum insured is read when it is available (not 'I haven't yet read the sum insured') | **FAIL** | model reasoning-tool selection | retrieval/tool-selection failure: the certificate was available |
| 2 | the sum insured is attributed to the certificate's date (1 July 2025) | pass |  |  |
| 3 | the sum insured is attributed to the certificate's date (1 July 2025) | pass |  |  |
| 5 | the sum insured is attributed to the certificate's date (1 July 2025) | pass |  |  |
| all | never claims current cover / cover in force | pass |  |  |
| 4 | 'transverse' does not select a payout row (no 'Other fracture' / 1%) | pass |  |  |
| 4 | after 'transverse' it asks for the detail the schedule uses (bone, or closed/open) | pass |  |  |
| 4 | 'transverse' is not saved as a correction | pass |  |  |
| 4 | no 'Updated: … at first' correction note | pass |  |  |
| 5 | the closed-tibia illustration S$9,000 (6% x S$300,000 x 50%) is shown | pass |  |  |
| 5 | a saved lump_sum record of S$9,000 for the lower leg | pass |  |  |
| 5 | S$18,000 is not given as the amount for the closed fracture | pass |  |  |
| 3 | never S$200 for the stay (two nights are not two payable days) | pass |  |  |
| 4 | never S$200 for the stay (two nights are not two payable days) | pass |  |  |
| 5 | never S$200 for the stay (two nights are not two payable days) | pass |  |  |
| 6 | never S$200 for the stay (two nights are not two payable days) | pass |  |  |
| 6 | the stay's Accident Hospital Income S$100 (one complete 24-hour period) is shown | pass |  |  |
| 6 | a saved hospital_cash record of S$100 | pass |  |  |
| 3 | the reported hospital stay is addressed by turn 3 or 4 (hospital income / complete 24 hours) | pass |  |  |
| all | does not ask how it happened after turn 2 | pass |  |  |
| all | does not ask about the X-ray after turn 3 | pass |  |  |
| all | does not ask which bone / closed or open after turn 5 | pass |  |  |
| all | does not ask for the admission / discharge times after turn 6 | pass |  |  |
| all | saved facts include the X-ray, the nights, the closed tibia and both times | pass |  |  |
| 2 | a turn stating figures carries citations | pass |  |  |
| 2 | the save-time gate rejected nothing in this turn | pass |  |  |
| 3 | a turn stating figures carries citations | pass |  |  |
| 3 | the save-time gate rejected nothing in this turn | pass |  |  |
| 5 | a turn stating figures carries citations | pass |  |  |
| 5 | the save-time gate rejected nothing in this turn | pass |  |  |
| 6 | a turn stating figures carries citations | pass |  |  |
| 6 | the save-time gate rejected nothing in this turn | pass |  |  |
| all | no amount is called approved / paid / what he will receive | pass |  |  |
| 5 | the Fracture of lower leg (tibia or fibula) figure is labelled an illustration or indicative estimate | pass |  |  |
| 6 | the Accident Hospital Income figure is labelled an illustration or indicative estimate | pass |  |  |
| 6 | the final answer gives useful information (a figure with its basis), not only echoes, caveats or an insurer referral | pass |  |  |

# V1.2: scenario completion (the broken-leg conversation)

The reported live conversation was not read: the production read was refused, so nothing from it is used here. It is
reproduced on a **synthetic** household (`scripts/fixtures/rag2-scenario/household.ts`, every name and figure
invented) with the four reported turns, through the real chat route (`npm run rag2:scenario-test`).

All evidence here is **scripted** (a stand-in model plays the tool calls). No real-model run was made: the Composio
`openai` connection is still not active, so the dedicated test key cannot be reached. The ledger was not touched.

## Trace: earliest causes found (at `2916912`)

| Stage | What happened | Fix |
|---|---|---|
| Saved facts | `note_facts` treated any new value under a recorded key as a correction: "Transverse fracture." after "broke his leg" was shown as "Updated: injury is now transverse fracture (you said broke his leg at first)" and anything derived was withdrawn. | `loop.ts` `isCorrection`: a value is corrected only when the household says so ("actually", "sorry", "not …", "I meant") or a count, amount, date or yes/no changes. A further free-text detail is kept beside the first report (`<key>_detail`). |
| Composition | A clause-printed figure ("Accident Hospital Income: S$100 for each complete period of 24 hours …") was dropped, with a misleading "S$100 is printed in none of the evidence" reason, when the sentence carried no `benefit` label. A model told that drops the sentence, so the hospital stay disappears. | `compose.ts` `passageLabel`: a line that prints its benefit's name before the figure labels that figure when the sentence names it. When the figure is printed but under another name, the drop reason now says so. |
| Calculation | `lump_sum` could not apply the wording's "50% of the percentage shown" for a simple fracture, so the clause could only be repeated, never turned into an amount. | `lump_sum` `proportion`: the share must be printed in a verbatim quote on the calculation document's page. It is an extra document operand and step, so the save-time gate re-runs it. The case stays an unresolved condition. |
| Calculation (linkage) | `lump_sum` accepted the certificate's **Group Term Life** row as the sum insured for the **Group Personal Accident** wording (S$500,000 × 6% = S$30,000 instead of S$18,000). | `tool.ts` `sumInsuredLink`: when the sum insured comes from another document of the policy, the product it is printed under must share a distinctive word with the calculation document's product. |
| Calculation (hospital) | `hospital_cash` took only a table rate, not a rate printed in a sentence. | `rate_passage`, verified like `passage_limits`. The day-count rule is still read from the wording: 9pm 3 Oct → 11am 5 Oct = 1 complete 24-hour period = S$100, never "two nights = S$200". |
| Completion | A reply that only says back what it was told, or that ignores a reported hospital stay, was accepted. The repair after an answered question offered only the clause it was asked about, never the certificate amount the percentage is of, and ended every time with "the insurer checks … claim form". | `loop.ts` `completionLines`, folded into the turn's one repair (final answer) or one refusal (`ask_user`): a hospital stay or bill reported this turn, or earlier and never addressed, must be addressed. A percentage of the Sum Insured with no amount asks for the person's own sum insured and `lump_sum` illustrations. The repair lists the person's established figures, and the paperwork note is shown once per conversation. |
| Presentation | Each illustration got the cause limit appended. It said "only for a **stay** …", quoted the schedule row "Death due to Accident 100%" as if it were a clause, and was repeated on every sentence. | `compose.ts`: schedule rows are not cause clauses, a lump sum says "injury", and the limit is said once per answer. |
| Planning | – | Prompt `rag2-loop-v11` adds three general instructions: address every fact; a detail the rows do not use does not pick a row (never the "other" row); state a percentage with the person's sum insured and illustrations, then end with what is known and what is open. |

There is no phrase rule for "broken leg" or "transverse". No new architecture, model or embedding.

## Results (`npm run rag2:scenario-test`, whole visible conversation graded)

| | before (`2916912`) | after |
|---|---|---|
| conversations + controls | 3/12 | 12/12 |

The three that already passed at base are the positive controls that needed no fix:
- Grace: her own S$200,000 row and a flat any-bone amount.
- Kai: no leg row, so "Other fracture" applies, under a calendar-day hospital rule.
- The category control.

Transcripts: `before-2916912-scripted.txt` and `after-scripted.txt`.

**Scripted model behaviours:**
- R1 capable model (the reported turns).
- R2 minimal "live-shape" model: it only repeats one clause, then only says back.
- R3 the same minimal model when it follows the repair it is given.

**Other conversations:**
- P1 paraphrase: shin bone, closed fracture, stay with times.
- P2 Grace and P3 Kai: other people and other policies.

**Controls:**
- Added detail vs stated correction vs changed count.
- Share quote not printed, off-page or on another page.
- Certificate link: GTL row refused, superseded certificate and other household unreadable.
- Two nights vs complete 24-hour periods.
- Repair names the hospital stay and the sum insured.
- "Transverse" never maps to "Other fracture".

**What R2 shows:** a model that ignores the repair still ends with only "You told me it is a transverse fracture." The product does not invent content it was not given. It now repairs (naming the stay and the certificate link) and does not show a false correction. Whether the real model follows the repair is the open real-model question.

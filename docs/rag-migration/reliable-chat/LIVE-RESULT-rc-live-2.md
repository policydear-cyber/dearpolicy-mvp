# rc-live-2 — real-model batch result (candidate 7c7b68f)

**Tested code:** `7c7b68f9a08ecfdfdb6367fa85aa61354fe4d202` (provenance checked against GitHub's tree of that commit,
905 source files; production build newer than every source file). **Model:** `openai:gpt-6-luna` (the existing
configured chat model) through the existing loopback relay and the Composio-held test key. Prompt `rag2-loop-v16-cases`.
Pre-registration: [EXPECTED-rc-live-2.md](EXPECTED-rc-live-2.md). Grader: `scripts/rag2-live/reliable-chat-check.ts`
**v2**, unchanged after the run. Per-check details: [live/rc-live-2-grade.md](live/rc-live-2-grade.md); raw runs:
`live/RUN-rc-live-2-tan-…/`, `live/RUN-rc-live-2-wong-…/`.

## Budget
| | US$ |
|---|---|
| Authorised cap | 0.020000 |
| Unreserved balance before | 0.056889 |
| rc-live-2-tan (cap 0.0145; 33 calls, 0 refused, 0 failed) | 0.010252 |
| rc-live-2-wong (cap 0.009747 = 0.02 − tan's spend; 18 calls, 0 refused, 0 failed) | 0.004815 |
| **Batch total** | **0.015067** |
| Unreserved balance after (ledger) | 0.041822 |

The US$0.15 `trial-codespace-1` reservation is untouched (open, still counted as reserved). Before any spend, both runs
were checked with `--dry-run` (exactly RCT2a, RCT2b / RCW4a, RCW4b, RCX; relay request count 0), and a missing or
unknown scenario id was confirmed to be refused. No unintended scenario ran. No rerun.

## Result per conversation
| conversation | grader v2 | send → answer per turn (model time) | my review of the complete answer |
|---|---|---|---|
| RCT2a (Tan) | **PASS** | 19.5 s (18.4) · 16.2 s (14.8) · 16.4 s (15.0) | **Correct and useful throughout.** Terms and the one bone question; "shin bone" → S$10,000 (10 % × S$100,000) with a contact step; correction → withdrawal said, S$20,000; no further question. |
| RCT2b (Tan) | **FAIL** (T2U, T3Q) | 15.1 s (14.3) · 11.8 s (11.0) · 15.1 s (13.8) | Correct figures, not fully useful. Turn 2 showed S$10,000 and then asked whether the fracture was confirmed by X-ray — a printed condition, so not irrelevant, but the pre-registered expectation was no question. **Turn 3 did not say the S$10,000 no longer applies**: it was withdrawn on the record but the withdrawal note was missing (defect, fixed below). It also added an uncertainty about "the insurer's medical assessment". |
| RCW4a (Wong) | **PASS** | 15.6 s (14.4) | **Correct and useful:** S$2,500 = 50 % × the S$5,000 Simple Fracture Benefit Limit, the household's own words as the what-if. |
| RCW4b (Wong) | **PASS** | 14.7 s (13.2) | **Correct and useful;** adds a vague uncertainty sentence ("does not provide the definition") and a Kestrel Life Ltd contact step. |
| RCX (Wong, unlisted + reference insurer) | **PASS** | 13.8 s (12.9) | **Correct and useful:** neither fracture table lists a wrist (said, with the listed cases), no question, no amount, contact **Kestrel Life Ltd** through the scheme administrator — not the summary's KestrelOne brand, not the travel insurer. |

**4 of 5 conversations pass the grader; on my review, 4 of 5 are correct and useful throughout (RCT2a, RCW4a, RCW4b,
RCX). RCT2b is not.** Both repeats of the fixed-limit journey passed; the sum-insured journey passed once in two.
The rc-live-1 failures did not recur: "shin bone" resolved to the below-the-knee row in both Tan attempts; both Wong
attempts showed S$2,500 (no gate refusal); no insurer-review question; no question offering unrelated cases; no
unsupported insurer. **Timing:** no turn met the 10 s direct-lookup target (12–16 s for one-turn questions); multi-step
turns took 11.8–19.5 s, within the 20 s target; model time is 90–95 % of send-to-answer.

## Fixed after the run (not verified with the real model)
- **The withdrawal is always said.** A calculation shown in a turn that ended with a question had no "derived" sentence,
  so a correction withdrew it on the record without saying so (RCT2b turn 3). Every calculation withdrawn by a correction
  now counts for the note (`lib/rag2/loop/loop.ts`). Pinned by `reliable-chat-live-regressions.ts` (the RCT2b shape,
  replayed; it fails without the fix).
- Not changed: asking for a printed condition (X-ray confirmation) after an illustration is allowed — it is a fact the
  household can give and the wording depends on it; the pre-registered grader still counts it against RCT2b.

## Complete visible transcripts
### RCT2a
> **My son Jun fractured his leg at football training. What could his personal accident policy pay?**

The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%.
*Question:* Which bone did Jun fracture: the thigh bone (femur) or a bone below the knee (tibia or fibula)?

> **The doctor said it was the shin bone.**

You told me, “The doctor said it was the shin bone.”
If the Fracture Benefit applies to Jun's case “Leg - below the knee (tibia or fibula)” (as you described: “The doctor said it was the shin bone.”), the conditional illustration is S$10,000: 10% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
*Next step:* Contact Aurora Assurance Pte. Ltd. about the FamilyGuard Personal Accident - Policy Schedule to ask what it needs for a claim.

> **Sorry, I got that wrong - the X-ray shows it was his thigh bone.**

Updated: fracture bone is now thigh bone (you said shin bone at first). The earlier estimate worked out from it no longer applies.
You told me, “the X-ray shows it was his thigh bone.”
If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)” (as you described: “the X-ray shows it was his thigh bone”), the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.

### RCT2b
> **My son Jun fractured his leg at football training. What could his personal accident policy pay?**

The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%.
*Question:* Which bone did Jun fracture: his thigh bone (femur), or a bone below the knee (tibia or fibula)?

> **The doctor said it was the shin bone.**

If the Fracture Benefit applies to Jun's case “Leg - below the knee (tibia or fibula)” (as you described: “The doctor said it was the shin bone.”), the conditional illustration is S$10,000: 10% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision. The Fracture Benefit wording says a fracture must be caused by an Accident and confirmed by X-ray for the listed percentage to apply.
*Question:* Was Jun’s fracture confirmed by X-ray?

> **Sorry, I got that wrong - the X-ray shows it was his thigh bone.**

Updated: fracture bone is now thigh bone (you said shin bone at first).
You told me the X-ray shows Jun’s fracture was in his thigh bone.
If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)” (as you described: “the X-ray shows it was his thigh bone”), the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
The wording requires the fracture to be caused by an Accident and confirmed by X-ray.
The documents do not establish whether Jun’s injury meets the policy’s definition of the listed thigh-bone case, which requires the insurer’s medical assessment.
*Next step:* Contact Aurora Assurance Pte. Ltd. about the FamilyGuard Personal Accident - Policy Schedule to ask what it needs for a claim.

### RCW4a
> **Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.**

If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee” (as you described: “Adrian broke his leg”), the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision.

### RCW4b
> **(the same question)**

If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee” (as you described: “Adrian broke his leg”), the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision.
The uploaded summary does not establish whether Adrian’s diagnosis meets that definition; it says the listed case and percentage but does not provide the definition.
*Next step:* Contact Kestrel Life Ltd (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Insurance Scheme - Certificate to ask what it needs for a claim.

### RCX
> **Adrian fractured his wrist falling off his bicycle. What can we claim for it from his accident cover, and who should I contact?**

Adrian’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022; this is the amount shown on that date, not confirmation of cover now.
The Public Officers Group Personal Accident - Summary of Benefits (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg^, Ankle or Knee 50%. It lists no case for a wrist.
The Other Fracture wording defines this as a fracture that is not a Simple Fracture, including a compound fracture, and its listed cases do not include the wrist.
The uploaded accident documents do not establish a benefit amount for Adrian’s wrist fracture, so I can’t work out a claim amount from these listed fracture schedules.
*Next step:* Contact Kestrel Life Ltd (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Insurance Scheme - Certificate to ask what it needs for a claim.

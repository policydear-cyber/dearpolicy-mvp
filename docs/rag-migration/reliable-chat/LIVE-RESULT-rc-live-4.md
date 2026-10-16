# rc-live-4 — real-model batch result (candidate 0222152)

**Tested code:** `0222152792a0bd8e442a3c83f34fcceae895b26d` (provenance checked against GitHub's tree of that commit, 905
source files; production build newer than every source file). **Model:** `openai:gpt-6-luna` through the loopback relay
and the Composio-held test key. Pre-registration: [EXPECTED-rc-live-4.md](EXPECTED-rc-live-4.md) (pushed as c471dcb before
any spend). Grader v2 unchanged. Per-check details: [live/rc-live-4-grade.md](live/rc-live-4-grade.md).

## Budget
| | US$ |
|---|---|
| Unreserved balance before | 0.026491 |
| rc-live-4-tan (cap 0.016; 31 calls, 0 refused, 0 failed) | 0.010427 |
| rc-live-4-wong (cap 0.010; 17 calls, 0 refused, 0 failed) | 0.005274 |
| **Batch total** | **0.015701** |
| Unreserved balance after (ledger) | 0.010790 |

Since the 07:31 cap increase: rc-live-3 US$0.015331 + rc-live-4 US$0.015701 = **US$0.031032**. The US$0.15
`trial-codespace-1` reservation is untouched. Both runs dry-run first (exactly the five ids). No rerun of a failed
conversation: rc-live-4 is the pre-registered verification of a new candidate.

## Result per conversation
| conversation | grader v2 | send → answer per turn (model) | my review |
|---|---|---|---|
| RCT2a | PASS | 14.4 s (13.3) · 16.3 s (14.7) · 10.8 s (10.2) | **Correct and useful throughout:** terms and one bone question; shin bone → S$10,000 with the contact step, no question; correction → withdrawal said, S$20,000, no question put back. |
| RCT2b | PASS | 13.4 s (12.4) · 14.0 s (12.6) · 9.5 s (8.1) | **Correct and useful throughout** (same shape; "You told me the shin bone." is terse but accurate). |
| RCW4a | PASS | 15.0 s (13.8) | **Correct and useful:** S$2,500 = 50 % × S$5,000; contact Kestrel Life Ltd. |
| RCW4b | PASS | 18.9 s (17.6) | **Correct and useful;** adds the wording's Simple Fracture definition (closed fracture). |
| RCX | PASS | 13.7 s (13.1) | **Correct and useful:** listed cases said, no wrist case, no question, contact Kestrel Life Ltd through the employer / scheme administrator. |

**5 of 5 correct and useful in this batch.** Across the four batches the sum-insured fracture journey passed 1/2
(rc-live-2), 0/2 (rc-live-3, before the fix) and 2/2 (rc-live-4); the fixed-limit and unlisted-case journeys passed in
every attempt since rc-live-2.

**Latency:** one-turn questions 13.7–18.9 s (target 10 s: **not met**); multi-step turns 9.5–16.3 s (target 20 s: met);
model time is 90–95 % of send-to-answer.

## Complete visible transcripts
### RCT2a

- **My son Jun fractured his leg at football training. What could his personal accident policy pay?**

```
I’m sorry Jun was hurt. The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%.
Which part of Jun’s leg was fractured: the thigh bone (femur) or below the knee (tibia or fibula)?
```

- **The doctor said it was the shin bone.**

```
You told me the doctor said it was the shin bone.
If the Fracture Benefit applies to Jun's case “Leg - below the knee (tibia or fibula)”, the conditional illustration is S$10,000: 10% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aurora Assurance Pte. Ltd. about the FamilyGuard Personal Accident - Policy Schedule to ask what it needs for a claim.
```

- **Sorry, I got that wrong - the X-ray shows it was his thigh bone.**

```
Updated: fracture site detail is now thigh bone (you said shin bone at first). The earlier estimate worked out from it no longer applies.
If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)” (as you described: “the X-ray shows it was his thigh bone”), the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
The wording says the Fracture Benefit applies when a fracture is caused by an Accident and confirmed by X-ray.
Contact Aurora Assurance Pte. Ltd. about the FamilyGuard Personal Accident - Policy Schedule to ask what it needs for a claim.
```

### RCT2b

- **My son Jun fractured his leg at football training. What could his personal accident policy pay?**

```
I’m sorry Jun was hurt. The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%.
Which bone did Jun fracture: the thigh bone (femur), or below the knee (tibia or fibula)?
```

- **The doctor said it was the shin bone.**

```
You told me the shin bone.
If the Fracture Benefit applies to Jun's case “Leg - below the knee (tibia or fibula)”, the conditional illustration is S$10,000: 10% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aurora Assurance Pte. Ltd. about the FamilyGuard Personal Accident - Policy Schedule to ask what it needs for a claim.
```

- **Sorry, I got that wrong - the X-ray shows it was his thigh bone.**

```
Updated: fracture bone is now thigh bone (you said shin bone at first). The earlier estimate worked out from it no longer applies.
If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)” (as you described: “the X-ray shows it was his thigh bone”), the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aurora Assurance Pte. Ltd. about the FamilyGuard Personal Accident - Policy Schedule to ask what it needs for a claim.
```

### RCW4a

- **Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.**

```
If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee” (as you described: “Adrian broke his leg”), the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Kestrel Life Ltd (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

### RCW4b

- **Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.**

```
If the Simple Fracture benefit applies to Adrian's case “Jaw, Pelvis, Leg^, Ankle or Knee” (as you described: “Adrian broke his leg”), the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Public Officers Group Personal Accident - Summary of Benefits; it is an illustration from the document's terms, not a payment or an insurer's decision.
The policy wording defines a Simple Fracture as a closed fracture where the skin is not broken.
Contact Kestrel Life Ltd (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

### RCX

- **Adrian fractured his wrist falling off his bicycle. What can we claim for it from his accident cover, and who should I contact?**

```
Adrian’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022; this is the amount printed on that date, not confirmation of cover now.
The Public Officers Group Personal Accident - Summary of Benefits (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg^, Ankle or Knee 50%. It lists no case for a wrist.
Contact Kestrel Life Ltd (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

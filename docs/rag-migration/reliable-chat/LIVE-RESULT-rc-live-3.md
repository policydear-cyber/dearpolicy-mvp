# rc-live-3 — real-model batch result (candidate ee5c2b0)

**Tested code:** `ee5c2b0712e35abc0462d911d864b829a22f82c9` (provenance checked against GitHub's tree of that commit, 905
source files; production build newer than every source file). **Model:** `openai:gpt-6-luna` through the loopback relay
and the Composio-held test key. Pre-registration: [EXPECTED-rc-live-3.md](EXPECTED-rc-live-3.md) (pushed as a01ae49 before
any spend). Grader v2 unchanged. Per-check details: [live/rc-live-3-grade.md](live/rc-live-3-grade.md).

## Budget
| | US$ |
|---|---|
| Cap authorised 16 Oct 07:31 SGT | 0.50 (exercise ceiling; spendable = unreserved balance) |
| Unreserved balance before | 0.041822 |
| rc-live-3-tan (cap 0.020; 34 calls, 0 refused, 0 failed) | 0.011001 |
| rc-live-3-wong (cap 0.015; 17 calls, 0 refused, 0 failed) | 0.004330 |
| **Batch total** | **0.015331** |
| Unreserved balance after (ledger) | 0.026491 |

US$0.15 `trial-codespace-1` reservation untouched. Both runs dry-run first (exactly RCT2a, RCT2b / RCW4a, RCW4b, RCX; an
unknown id refused; relay requests 0). No unintended scenario; no rerun.

## Result per conversation
| conversation | grader v2 | send → answer per turn (model) | my review |
|---|---|---|---|
| RCT2a | **FAIL** (T2U, T3Q) | 13.1 s (12.0) · 18.1 s (16.8) · 24.0 s (22.7) | Figures right (S$10,000, then S$20,000 with the withdrawal said), **not useful**: turns 2 and 3 put the already-answered bone question back ("here is the question I was on"); turn 2 adds that the wording "requires a reviewed medical decision" that the documents do not establish. |
| RCT2b | **FAIL** (T2U) | 12.6 s (11.3) · 13.4 s (11.8) · 12.3 s (10.9) | Turn 2 shows S$10,000 then asks whether an X-ray confirmed the fracture (a printed condition; pre-registered as a failure). **Turn 3 now says the S$10,000 no longer applies** — the ee5c2b0 fix is verified with the real model. |
| RCW4a | PASS | 12.9 s (12.0) | Correct and useful: S$2,500 = 50 % × S$5,000. |
| RCW4b | PASS | 11.3 s (9.9) | Correct and useful. |
| RCX | PASS | 13.7 s (12.3) | Correct and useful: no wrist case (listed cases said), no question, contact **Kestrel Life Ltd** through the employer / scheme administrator. |

**3 of 5 correct and useful. Not a success.** The fixed-limit and unlisted-case journeys passed again; the sum-insured
fracture journey failed in both attempts.

## Fixed after the run (offline; not yet verified with the real model)
- **An answered case question is never put back** (`lib/rag2/loop/loop.ts`, `types.ts`). The bone question was asked as
  `fracture_bone`; the model noted the answer as `fracture_bone_detail`, so the open question was not cleared and was
  re-shown on turns 2 and 3. The server now tags a question asked after `evaluate_benefit` could not settle a case with
  that benefit, and clears it as soon as the server settles that benefit's case from the household's words (a result, or
  the case is not listed) — whatever key the answer was noted under. Pinned by `reliable-chat-live-regressions.ts` (the
  RCT2a calls replayed; it fails without the fix and passes the v2 grader with it).

## Complete visible transcripts
### RCT2a

- **My son Jun fractured his leg at football training. What could his personal accident policy pay?**

```
I’m sorry Jun was hurt. The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%.
Which bone did Jun fracture: the thigh bone (femur), or below the knee (tibia or fibula)?
```

- **The doctor said it was the shin bone.**

```
You told me, “The doctor said it was the shin bone.”
If the Fracture Benefit applies to Jun's case “Leg - below the knee (tibia or fibula)” (as you described: “The doctor said it was the shin bone.”), the conditional illustration is S$10,000: 10% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
The policy wording requires a reviewed medical decision that Jun’s diagnosis meets its definition of “Leg - below the knee (tibia or fibula)”.
The uploaded documents do not establish that this has been confirmed.
When you’re ready, here is the question I was on.
Which bone did Jun fracture: the thigh bone (femur), or below the knee (tibia or fibula)?
Contact Aurora Assurance Pte. Ltd. about the FamilyGuard Personal Accident - Policy Schedule to ask what it needs for a claim.
```

- **Sorry, I got that wrong - the X-ray shows it was his thigh bone.**

```
Updated: fracture bone detail is now thigh bone (you said shin bone at first). The earlier estimate worked out from it no longer applies.
You told me, “Sorry, I got that wrong - the X-ray shows it was his thigh bone.”
If the Fracture Benefit applies to Jun's case “Leg - thigh bone (femur)” (as you described: “the X-ray shows it was his thigh bone”), the conditional illustration is S$20,000: 20% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision.
The wording says the Fracture Benefit applies to a fracture caused by an Accident and confirmed by X-ray.
When you’re ready, here is the question I was on.
Which bone did Jun fracture: the thigh bone (femur), or below the knee (tibia or fibula)?
Contact Aurora Assurance Pte. Ltd. about the FamilyGuard Personal Accident - Policy Schedule to ask what it needs for a claim.
```

### RCT2b

- **My son Jun fractured his leg at football training. What could his personal accident policy pay?**

```
The FamilyGuard Personal Accident - Policy Wording (page 1) pays the Fracture Benefit as a percentage of Jun's own sum insured (S$100,000 on the FamilyGuard Personal Accident - Policy Schedule) for each listed case: Leg - thigh bone (femur) 20%; Leg - below the knee (tibia or fibula) 10%; Wrist 5%; Finger or toe 2%. The schedule lists 20% for a thigh-bone fracture and 10% for a fracture below the knee, each as a percentage of Jun’s Sum Insured.
Which bone did Jun fracture: his thigh bone (femur), or below the knee (tibia or fibula)?
```

- **The doctor said it was the shin bone.**

```
The shin-bone detail points to the below-the-knee row, but it does not settle the policy’s confirmation requirements. If the Fracture Benefit applies to Jun's case “Leg - below the knee (tibia or fibula)”, the conditional illustration is S$10,000: 10% of Jun's sum insured of S$100,000 (FamilyGuard Personal Accident), under the FamilyGuard Personal Accident - Policy Wording; it is an illustration from the document's terms, not a payment or an insurer's decision. The policy says the Fracture Benefit is payable for a fracture caused by an accident and confirmed by X-ray.
Has Jun’s fracture been confirmed by X-ray?
```

- **Sorry, I got that wrong - the X-ray shows it was his thigh bone.**

```
Updated: fracture bone detail is now thigh bone (you said shin bone at first). The earlier estimate worked out from it no longer applies.
You told me, “the X-ray shows it was his thigh bone.”
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
```

### RCX

- **Adrian fractured his wrist falling off his bicycle. What can we claim for it from his accident cover, and who should I contact?**

```
Adrian’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022; this is the amount recorded on that date, not confirmation of cover now.
The Public Officers Group Personal Accident - Summary of Benefits (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg^, Ankle or Knee 50%. It lists no case for a wrist.
The policy wording defines Other Fracture as a fracture that is not a Simple Fracture, including a compound fracture, but its listed bone cases do not include the wrist.
Only the insurer decides whether an amount is paid, owed or claimable, after it reviews the claim.
Contact Kestrel Life Ltd (through the employer or scheme administrator, for this group scheme) about the Public Officers Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

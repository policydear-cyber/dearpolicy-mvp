# Round 4 live result: schedule completeness (sa-live-6)

Tested code SHA: `bbe9aa5393e237154a729bdedb66a5a55b1b08d3` (clean tree, build `8IjSCdVxhKWmyqXcQMWuD`). Model `openai:gpt-6-luna`, relay mode, actual-library household. Batch cap US$0.03; spent US$0.006232 over 10 calls, 0 refusals, 0 failed, 0 open reservations. Preflight (no model calls) cost US$0. Cumulative spend about US$0.4385 of US$1.00; the US$0.15 trial-codespace reservation is untouched.

Grades: v8.2 and v9.1 (including completeness checks K1-K3) PASS for SBc and SBd. One attempt each; nothing repeated. The run's own generic verdict label ("INCOMPLETE") is the harness status and is graded separately by `sa-live-6-2026-10-18T09-21-21-grade.md`.

Limitation of this live evidence: in both journeys the model itself called `evaluate_benefit` for both schedules, so the server completion (`completeSchedules`) did not have to fire. That path is proven by the offline SBb replay (model omits the second evaluation; fails without the repair, passes with it).

## SBc (cost US$0.003456, 5 model calls, total 22952 ms)

### Turn 1
User: Daniel tripped on the kerb outside the house and the hospital thinks it is either his hip or his tibia that has cracked - they will know more after the scan. It looks like a closed fracture from an accident. What could his accident cover give him?

Schedules: Simple Fracture or Other Fracture due to Accident = explained; Simple Fracture = explained

Answer:

> The Group Personal Accident Benefit Summary (page 8) pays the Simple Fracture or Other Fracture due to Accident as a percentage of Daniel's own sum insured (S$600,000 on the certificate) for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs (Other Fracture) 20%. The Group Insurance Product Summary (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs 25%. The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
> Once the scan confirms the fracture, is it in Daniel’s hip or his lower leg (shin/tibia)?
> This changes what your policy pays under: “Hip 75%”; “Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%” (page 8)

### Turn 2
User: The scan is back: it is the tibia.

Schedules: Simple Fracture or Other Fracture due to Accident = evaluated; Simple Fracture = evaluated

Answer:

> If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
> You told me the scan is back: it is the tibia.
> The uploaded documents do not establish whether these separate benefits both apply, or whether one governs this event.
> The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.

## SBd (cost US$0.002776, 5 model calls, total 20687 ms)

### Turn 1
User: Daniel slipped in the bathroom at home. The doctor suspects a fracture of the hip or possibly the tibia but is waiting for imaging. No open wound, so a closed fracture. What would his accident insurance pay for that?

Schedules: Simple Fracture or Other Fracture due to Accident = explained; Simple Fracture = explained

Answer:

> The imaging result is still pending, so the documents do not yet establish which listed fracture case applies. The Group Personal Accident Benefit Summary (page 8) pays the Simple Fracture or Other Fracture due to Accident as a percentage of Daniel's own sum insured (S$600,000 on the certificate) for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs (Other Fracture) 20%. The Group Insurance Product Summary (page 13) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Neck, Skull or Spine (Full Break) 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; Cheekbone, Shoulder or Hairline Fracture of Skull or Spine 30%; Arm, Elbow, Wrist or Ribs 25%. The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
> Once imaging confirms a fracture, is it the hip or the lower leg (shin/tibia)?
> This changes what your policy pays under: “Hip 75%”; “Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%” (page 8)

### Turn 2
User: Imaging confirms the tibia, not the hip.

Schedules: Simple Fracture or Other Fracture due to Accident = evaluated; Simple Fracture = evaluated

Answer:

> If the Simple Fracture or Other Fracture due to Accident benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee” (the row the document labels “Other Fracture”; these documents print no definition of which fractures that is), the conditional illustration is S$300,000: 50% of Daniel's sum insured of S$600,000 (Group Personal Accident), under the Group Personal Accident Benefit Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
> If the Simple Fracture benefit applies to Daniel's case “Jaw, Pelvis, Leg, Ankle or Knee”, the conditional illustration is S$2,500: 50% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Product Summary; it is an illustration from the document's terms, not a payment or an insurer's decision.
> You told me: “Imaging confirms the tibia, not the hip”.
> The Group Personal Accident Benefit Summary (page 8) prints “Simple Fracture or Other Fracture due to Accident” as a percentage of Daniel's own sum insured; the Group Insurance Product Summary (page 13) prints “Simple Fracture” as a percentage of a fixed Simple Fracture Benefit Limit. Neither document says whether one amends, replaces or adds to the other, or which applies to this event, so these are alternatives from separate documents, never a total.
> Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Scheme X Group Insurance - Certificate to ask what it needs for a claim.


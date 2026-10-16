# Reliable chat — what the ACTIVE route is tested for

The active route is production's: the model selects a `benefit_id` and passes the household's words; the server picks
the case, base and rate (`evaluate_benefit`), writes calculation / terms / contact statements, and the save-time gate
checks the answer. `npm run reliable-chat:active-route-test` runs every suite below (all through the real chat route,
scripted model moves, both synthetic households: Tan — a percentage of the person's own sum insured; Wong — a fixed
S$5,000 limit). The browser journey runs in browser-e2e CI (`npm run e2e:reliable-chat`).

| requirement | active-route test (suite → check) |
|---|---|
| Fixed-limit calculation (50 % × S$5,000 = S$2,500), record recomputes, operands bound to the summary | slice [wong] V5, V6, RC grader; live-regressions [wong] RCW1b; stage3 [wong] G5 |
| Sum-insured calculation (10 % × Jun's S$100,000; 5 % × Mei Ling's S$200,000) | slice [tan] V2, G1; live-regressions [tan] RCT1a |
| Correction and withdrawal (S$10,000 withdrawn and said; S$20,000 recomputes) | slice [tan] V3; live-regressions [tan] RCT1a, RCT2b (illustration shown beside a question); browser RC1 |
| An answered case question is never put back (answer noted under another key) | live-regressions [tan] RCT2a (rc-live-3 calls replayed; grader v2) |
| Wrong person rejected (another household's Jun; a benefit id for another person) | slice [tan] G4; cases [tan] CONTACT (Wei, another household) |
| Wrong base rejected (Term Life / PA money as base or percentage; the S$600,000 never used for Simple Fracture) | slice [wong] V5, V6 |
| Wrong version rejected (superseded 15 % wording) | slice [tan] G4 |
| Missing vs ambiguous vs unlisted case | cases [tan] CASE terms, MISSING vs AMBIGUOUS, UNLISTED |
| Unlisted case said, with no irrelevant question (server refuses a question offering the listed cases) | cases [tan] UNLISTED; cases [wong] OPTION vs REPORTED; live-regressions [wong] RCW3; browser RC2 |
| An option id never overrides the reported case (wrist + valid Leg option; thigh + below-the-knee option) | cases [wong] OPTION vs REPORTED; cases [tan] OPTION vs REPORTED |
| Ordinary terminology without invented diagnoses (shin, thigh bone, femur, collarbone, kneecap, big toe; "a fall" names no part) | cases CASE terms; live-regressions [tan] RCT1a ("shin bone") |
| No insurer-review question blocking an illustration | live-regressions [tan] RCT1a turn 3 |
| Relevant contact advice; contact only for the person's personal policy or wording that belongs to it (linked-but-unconfirmed reference, unrelated product, another person's policy refused; shared scheme wording → the certificate's insurer) | cases [tan] CONTACT; cases [wong] CONTACT ×4; live-regressions [wong] P50A |
| Complete statements, preserved conditions, no orphaned clauses | stage3 [wong] T1, T2a, T2b, T4, T5; stage3 [tan] T3 |
| Event question never answered with an inventory | stage3 [wong] I2; cases [wong] OPTION vs REPORTED |
| Hospital-day control (24-hour periods, never nights) and a side question | stage3 [tan] H1, G2 |
| Saved answer = visible UI | browser RC1, RC2 (displayed = saved, amounts saved); cases UNLISTED / WRIST (saved = returned) |
| The real-model grader fails irrelevant questions, incomplete answers and unsupported insurer advice | `reliable-chat-check.ts --controls` (incl. the actual rc-live-1 transcripts the v1 grader passed) |

## Legacy operand-contract suites (reported separately)
27 scripted suites still exercise the earlier model-facing contract (`calculate` lump_sum / hospital_cash with
model-chosen value ids), via `scripts/fixtures/legacy-contract.ts` (never in production). They run in CI and pass,
but **they are not evidence for the active route**: rag2:adversarial, binding, conv, conv2–conv7, demo10, fix, gaps,
loop, presentation, release, release-holdout, s52-replay, scenario, scenario-replay, stress, stress-report, tools,
v11, plus pr50-regressions, live-verify, s50-replay and loop-demo. Their safety cases that matter for the active route
are ported above (wrong person / base / version, corrections, contact, statement integrity, hospital day).

# pr50a-live-2: one pre-registered actual-model run of the death next-steps prompt alone — **BLOCKED** (budget refusal, not a factual-answer failure)

**Run facts**
- **Run SHA:** `004d25e96ef0921370daa3ad23becb5e51295c4b`. Before any call, the provenance guard checked the working tree against that commit's manifest (891 files).
- **Product code:** identical to the tested `371ba7d`. The GitHub compare of `371ba7d...004d25e` lists 16 files, all under `docs/`, `scripts/rag2-live/` or `scripts/rag2-pr50-regressions.ts`. The production build is the same: `-GqmFKGh4u06esGcA0ela`.
- **Pre-registration:** `EXPECTED-pr50a-live-2.md` and `scripts/rag2-live/pr50a-check.ts`, committed in `004d25e` before the run. Grader controls passed 10/10.
- **Model:** `openai:gpt-6-luna`, through the dedicated test key behind the loopback relay.
- **Cost:** US$0.002322 over 5 calls (0 refused at the provider, 0 failed), against a cap of US$0.006.
- **Ledger:** unreserved remaining is now US$0.078753. The US$0.15 `trial-codespace-1` reservation is untouched.
- **Run record:** `docs/rag-migration/live/RUN-pr50a-live-2-2026-10-15T08-00-05/` (unaltered) and `pr50a-grade.json` / `.md`. The run was not repeated.

## Visible answer (complete)

```
I couldn’t look that up: the model-use budget set for this test run is used up, so no model was called.
```

There are no figure bindings and no calculation. Nothing was dropped, and the save-time gate raised nothing.

## What happened

| call | input (cached) | output | charged |
|---|---|---|---|
| 1 | 7,303 (7,177) | 120 | US$0.000144 |
| 2 | 7,585 (7,177) | 47 | US$0.000136 |
| 3 | 9,035 (7,459) | 124 | US$0.000294 |
| 4 | 13,157 (8,909) | 239 | US$0.000633 |
| 5 | 21,113 (13,031) | 350 | US$0.001114 |

- Tools: note_facts, person_benefits, policies_for, then **9 search_passages** and one select_table_value. The model kept searching, and each search result grew the context.
- Before a sixth call, the run-cap guard reserved its worst case: "US$0.002322 spent … of US$0.006; the next call may cost up to US$0.003905". That was more than the US$0.003678 left, so the call was refused and the turn ended with the budget message.
- Under the pre-registered rule this is **BLOCKED**, not a failure of the answer.
- There is still no real-model evidence for the death next-steps answer: contact advice, event-date uncertainty and dated amounts. That behaviour is verified only deterministically, through the scripted pipeline, the browser replay and grader control R1–R7.

| | |
|---|---|
| Accepted | 0.6 s |
| Model time | 15.8 s |
| Answer persisted | 16.9 s |
| Answer seen | 17.0 s |

## P50D (pr50-live-1) latency breakdown, recorded as a performance limitation

The 52 s fracture answer used **6 sequential model calls**: resolve_person, person_benefits, search_passages, read_page, calculate, final_answer.

| call | upstream | input (cached) | output |
|---|---|---|---|
| 1 | 11.0 s | 7,315 (7,119) | 18 |
| 2 | 6.2 s | 7,430 (7,189) | 52 |
| 3 | 8.7 s | 8,885 (7,304) | 91 |
| 4 | 5.4 s | 9,603 (8,759) | 39 |
| 5 | 12.1 s | 9,853 (9,477) | 130 |
| 6 | 7.1 s | 10,442 (9,727) | 168 |

- Model time is 50.5 s of 52.0 s. The application adds about 1.5 s.
- Token counts are small, so the time is per-call provider round trips, not prompt size.
- No performance redesign in this PR.

## Follow-up (documented, not done)

- **File-name digits.** In pr50-live-1, the uncited-sentence check dropped the model's own unreadable-file sentence because `scan_20241003_153045.jpg` contains digits. The verified server inventory line kept the complete, correct status line: "Not linked to anyone in the household, and its contents could not be read: scan_20241003_153045.jpg. Nothing in it can be used; …". It is left as a follow-up.
- **Run cap for the death prompt.** The death prompt cannot finish under a US$0.006 cap with the current per-call worst-case reservation, because 6+ calls are needed and each later call reserves about US$0.004. A real-model check of that prompt needs a cap of about US$0.010, or a narrower reservation. Neither was changed here.

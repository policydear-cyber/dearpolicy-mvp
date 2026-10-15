# s52d-live-2: one pre-registered actual-model S52D conversation — PASS (6/6)

- **Tested SHA:** `5cd0de97a571141f8ad7ed95e876083deab86b13`. The provenance guard checked the working tree against
  that commit's manifest (884 files) before any call.
- **Product code:** identical to `df8577b`. `5cd0de9` adds only the pre-registration, the grader and the
  `--scenarios` filter.
- **Production build:** `1vu38m7M_eJ8-PCW-tMfa`, built from `df8577b`.
- **Pre-registration:** `docs/rag-migration/v15/EXPECTED-s52d-2.md`, graded by `scripts/rag2-live/s52d-check.ts`.
  Both were committed before the run. The run happened once and was not repeated.
- **Model:** `openai:gpt-6-luna` (provider-reported `gpt-6-luna`), temperature 0, reasoning none. It ran through
  the dedicated test key behind the loopback relay.
- **Cost:** US/bin/bash.00179 over 4 calls (0 refused, 0 failed), against a cap of US/bin/bash.006.
- **Ledger:** unreserved remaining is now US/bin/bash.084104. The US/bin/bash.15 `trial-codespace-1` reservation is untouched.
- **Run record:** `docs/rag-migration/live/RUN-s52d-live-2-2026-10-15T05-06-25/` (unaltered), plus `s52d-grade.json` / `.md`.

## Complete visible answer (as the chat page shows it; no question, no next steps)

**User:** "Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit
be? How is that different from Other Fracture?"

```
If Adrian had a simple (closed) leg fracture, the Simple Fracture table lists 50% of its S$5,000 benefit limit for a leg, giving a conditional illustration of S$2,500; the wording says this benefit applies to a listed simple fracture caused by an Accident, and the diagnosis must meet its definition.
Other Fracture is a separate benefit for fractures that are not Simple Fractures, including compound (open) fractures; for a leg it lists 50% of the Sum Insured, rather than 50% of the Simple Fracture benefit limit.
Adrian’s certificate lists Group Personal Accident at S$600,000 as of 6 October 2022, but that dated figure is not confirmation of cover on a later date.
```

## Calculation (saved, re-verified)

- Conditional illustration: **S$2,500 SGD**, from one step, `percent_of`.
- Operand 1, percent: **50%**. Row "Jaw, Pelvis, Leg, Ankle or Knee         50%", Summary of Benefits (doc …102), page 13.
- Operand 2, limit: **S$5,000**. Row "Simple Fracture Benefit Limit: S$5,000", same document, page 13.
- The model's tools: resolve_person → person_benefits → search_passages → calculate (accepted on the first call) → final_answer.
- No sentence was dropped, the save-time gate raised nothing, and there was no limit stop.

## Pre-registered requirements

| id | requirement | result |
|---|---|---|
| R1 | a conditional S$2,500 from 50% x S$5,000 is visible (the sentence stating it is conditional / an illustration, not a payment) | pass |
| R2 | a saved calculation with source-bound operands: 50% from the leg row and S$5,000 from the Simple Fracture Benefit Limit, both Summary of Benefits page 13; result S$2,500; it re-computes | pass |
| R3 | Simple Fracture and Other Fracture are kept separate (the S$2,500 is not given as Other Fracture's; no Simple Fracture amount on the Sum Insured) | pass |
| R4 | no unsupported Other Fracture amount (any Other Fracture amount is a saved calculation on the wording's Other Fracture row and the certificate's S$600,000 sum insured) | pass |
| R5 | no false statement that the certificate lacks the Group Personal Accident sum insured | pass |
| R6 | no token-limit fallback and no unrelated benefit or figure | pass |

## Latency and tokens

| call | tokens in / out (cached) | upstream |
|---|---|---|
| 1 | 7,254 / 18 (0) | 2.4 s |
| 2 | 7,369 / 58 (7,128) | 2.0 s |
| 3 | 9,578 / 251 (7,243) | 5.2 s |
| 4 | 12,129 / 275 (9,452) | 6.3 s |

- Accepted at 0.5 s; answer saved at 17.0 s; seen at 17.2 s.
- Model time 15.9 s.
- Totals: 36,330 input and 602 output tokens.
- For comparison, s52-live-1's S52D took 54,558 input tokens, the calculation was refused, and no S$2,500 appeared.

## Limits of this evidence

- This is one sample on synthetic fixtures (the live-library household), not verification of the actual library.
- At temperature 0 it is still a single draw. It shows the path works with the real model on this layout; it does not
  measure a rate.
- The answer adds "the diagnosis must meet its definition". That is a paraphrase of the wording's Simple Fracture
  definition, which the answer itself cites. It is not a new condition.

# pr50a-live-2: pre-registered actual-model run of the death next-steps prompt alone (written before the run)

**Authorisation.** One run was authorised on 15 Oct 2026 at 15:56 SGT.
- It covers the death next-steps prompt alone.
- It is capped at **US$0.006** and at the unreserved ledger balance (US$0.081075). The US$0.15 `trial-codespace-1` reservation is not touched.
- It runs once. The answer, source bindings, grade, cost and latency are preserved whatever the result.

**Product code.** The run uses the tested product code of `371ba7d3ec2f298735ec8234a04fa64a70c62ab6`, with the same production build (`-GqmFKGh4u06esGcA0ela`). Commits after `371ba7d` touch only:
- `docs/`;
- `scripts/rag2-live/` (the `--scenarios` filter for the pr50 household, and this grader);
- `scripts/rag2-pr50-regressions.ts` (the grader's positive control).

The GitHub compare of the run SHA against `371ba7d` lists the files. No `lib/`, `app/`, `components/`, `types/` or `e2e/` file changes.

**Setup.**
- Environment: `RAG2_LIVE_HOUSEHOLD=pr50`, `PR50_NAMES=snake`.
- Command: `scripts/rag2-live/run.ts --live --run-id pr50a-live-2 --scenarios P50A`.
- Model: `openai:gpt-6-luna`, with the same request settings as before.

**Prompt (P50A):** "Hypothetical test: Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Based on my uploaded documents, explain which death benefits may apply and what I should do next."

## Pre-registered requirements

The grader is `scripts/rag2-live/pr50a-check.ts`. It is deterministic and grades the complete visible answer and the saved figure bindings.

| id | requirement |
|---|---|
| R1 | Adrian's dated amounts: Group Term Life S$1,000,000 and Group Personal Accident S$600,000, each with the certificate date (6 October 2022), each bound to Adrian's own certificate row (saved figure bindings: subject Adrian, the certificate document). |
| R2 | Useful, supported contact advice: contact or notify the person's own insurer (Kestrel Life Ltd) or the scheme administrator or employer. |
| R3 | Uncertainty about cover on the event date is stated as uncertainty. Nothing is stated as an exclusion (for example "was not covered" or "not payable"). |
| R4 | No recommendation to contact or claim from the unrelated travel insurer, and its wording is not presented as Adrian's cover. |
| R5 | The dismemberment condition (365 days) is not borrowed into the death benefit. |
| R6 | No invented mandatory paperwork. The wording prints only "proof of death and the relevant documents in our prescribed form"; anything else must be framed as a suggestion. |
| R7 | No unrelated benefit fallback and no unrelated figure. Only S$1,000,000, S$600,000 and the allowance's S$3,000 / S$1,500 may appear. |

**Verdicts.**
- **PASS:** every check passes.
- **FAIL:** a check fails.
- **BLOCKED:** the run-cap guard refused a model call. That is a budget refusal, not a factual-answer failure.
- **INCOMPLETE:** there is no saved answer.

**Grader controls** (`pr50a-check.ts --controls`, run before the live run): all 10 behave as intended.
- The scripted compliant answer from the full pipeline gives PASS.
- A budget refusal gives BLOCKED.
- Each violation fails its own check: an unrelated-insurer step (R4), a borrowed 365-day condition (R5), invented mandatory paperwork (R6), an unrelated-benefit fallback (R7), an exclusion (R3), another person's binding (R1), and no contact step (R2).
- Paperwork framed as a suggestion still gives PASS.

# Replay of s50-live-2 on the final head `8d5a838` (no model call)

**Release code:** `8d5a838dc389d89aea9d4bdfbe3ba961e994375a`.
- This commit adds only the replay script, the browser spec, test-server support and these records. `app/`, `lib/` and `components/` are byte-identical to `8d5a838`.
- `8d5a838` is the code the replay ran on. The working tree was checked against the commit's tree manifest.

**Replay method:**
- The recorded model output of the actual-model run s50-live-2 (`a13c755`, `openai:gpt-6-luna`) is played back verbatim: every tool call with its arguments, grouped into the model calls the relay log recorded.
- It runs through the real `/api/chat` route, composer, save-time check and save on the same synthetic household: the binding household, with the certificate one cell per line.
- No model or network call was made (0 network calls).

## What changed between `a13c755` (real-model-tested) and `8d5a838`

There is one commit. Only two lines of application logic changed, both in the choice of DearPolicy's own "your own account" note:
- **`lib/rag2/loop/compose.ts`:** the medical-condition pattern. `certif\w*` became `certified|certification|medical certificate(s)`, so "death certificate" and "Certificate of Group Insurance" no longer count as medical.
- **`lib/rag2/loop/loop.ts`:** the note is classified from the answered question's condition (its "why" and the lines of its own evidence that state that condition), not from every passage the answer cites.

Unchanged:
- **Prompt and tool schema:** byte-identical. Their sha256 equals what the relay recorded for the live run (system `756f3a563ade…`, tools `cd7e78dd3864…`; checked by the replay).
- **Tool selection, tool behaviour, evidence binding, the save-time check and the composer's handling of model sentences:** none changed.

**So:** the model saw exactly the same inputs on `8d5a838`, and the replay shows what the final code does with the output it actually produced.

## Results: `REPLAY=s50 node --import tsx scripts/rag2-s50-replay.ts`, 10/10 passed

| check | result |
|---|---|
| Prompt and tool schema identical to what the model saw | pass |
| Every recorded model step replays with the same tool outcomes as live | pass |
| The saved answer is what the chat route returned | pass |
| Turn 1: Term Life S$1,000,000 and PA S$600,000, each bound to Darren's row in the certificate (`person_row`, policy …101, page 1) and cited | pass |
| Turn 2: every amount the model stated is kept (PA S$600,000, bound and cited); nothing dropped; save-time check clean | pass |
| No injury-specific paperwork note in either turn | pass |
| No unsupported paperwork presented as required (grader v4's check) | pass |
| Dates not asked again; turn 1 asks one question, the accident date | pass |
| Grader v4 (written before s50-live-2) on the replayed conversation | **PASS** |
| Only the application's note changed from the live answer | pass |

**Line-by-line difference from the live answer:**
- **Turn 1:** none.
- **Turn 2:** one line replaced.
  - Before: "What you've told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for (such as the doctor's report and the test or scan results) and decides the claim after reviewing them."
  - After: "What you've told me is your own account: the insurer will check it against the documents it asks for and decides the claim after reviewing them."

**Turn 2 states only the PA amount.** In turn 2 the model restated only the PA amount, not Term Life. Term Life was stated and bound in turn 1. The replay keeps every amount the model wrote; it cannot add one the model did not write. The full replayed answers are in `RUN-s50-live-2-…/REPLAY-8d5a838.json`.

## Browser: `e2e/tests/rag2-s50-replay.spec.ts`, 1/1 passed

The same recorded output was played through the real chat page: the production build, `E2E_RAG2_HOUSEHOLD=binding-cells`, scenario R50, and local PostgreSQL. For each turn:
- every saved line (summary, details, question, next step) is displayed;
- every displayed amount and every displayed sentence is in the saved answer;
- no injury wording is displayed;
- turn 1 shows both amounts and the one accident-date question;
- turn 2 shows the PA amount and no question;
- the saved bindings are TL and PA in turn 1, and PA in turn 2.

## Positive control: `REPLAY=injury`, 1/1 passed

A scripted fracture conversation on the scenario household: the PA wording says "Fracture benefits are payable for a fracture confirmed by X-ray". The household is asked, then confirms the X-ray.
- The same note path still gives the medical paperwork: "…include the doctor's report and the test or scan results that show the policy's condition is met, with the insurer's claim form". It is labelled as a suggestion to confirm with the insurer.
- Unit checks in `rag2:binding-test` (REPORTED NOTE) also keep the medical note for X-ray and specialist-diagnosis conditions.

## Not shown by a replay

- **The real model's behaviour on a fresh conversation is variable.** It was the same in s50-live-2's inputs, but the model may phrase or bind differently next time.
- **Model-chosen wording in s50-live-2, unchanged by the fix:**
  - "I'm so sorry for your loss, Michelle" (who is writing is a guess);
  - Michelle's endorsement cited as a reason Darren's amount is uncertain.
- **Your actual library:** unverified. No authorised read-only access to a real certificate was available.

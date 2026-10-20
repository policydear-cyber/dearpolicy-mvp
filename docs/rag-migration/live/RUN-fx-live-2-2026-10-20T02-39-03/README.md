# fx-live-2: live confirmation record (PR #57)

A real-model confirmation of the PR #57 fracture/absence/correction repairs on the synthetic fracture household (three anonymised documents, two people). It does **not** touch the owner's actual library, production, or any production key.

| item | value |
|---|---|
| live-tested SHA | `c4edd48cf8b01054fc2f592516ebd7cdec07407a` ("C4"). Its **product code is identical to `51a355a`** (its parent): C4 changes six files only (the pre-registration, the registered criteria with their controls, and the K3t1/K6c specs and graders); nothing under `lib/`, `app/`, `components/`, `types/`, `e2e/` or `package.json` |
| frozen copy | the harness ran from a frozen copy of C4; against the pushed C4 tree only `docs/DEMO-TRANSCRIPT.md` and `tsconfig.tsbuildinfo` differ |
| this record | added in a separate commit that touches only `docs/rag-migration/live/` (this directory and `LEDGER.json`); no product code |
| model | `gpt-6-luna`, `reasoning_effort: "none"`, temperature 0, dedicated test connection only |
| arm | A only (the frozen candidate through the real chat route: tool loop, server-resolved benefits, statement verification, save, reopen). No baseline arm |
| calls | 23 sent once each, 23 HTTP 200, 0 failed, 0 refused by the cap, no divergence between planned and sent requests |
| cost | upper bound **US$0.029663** (what the ledger books; no cache discount); estimate US$0.012903 with cached input at its rate. Neither is provider-billed. Authorised cap US$0.05 |
| model time | 65.8 s over 23 calls, measured at the relay (excludes relay hand-off, tool time, and anything after the answer; see Timings) |
| window | 2026-10-20 10:39 to 10:57 (Asia/Singapore), responses recorded 02:39:03Z to 02:57:40Z |
| expectations | `docs/rag-migration/reliable-chat/EXPECTED-fx-live-2.md`, committed in C4 **before any request**: six conversations with fixed wording, expected evidence, failure conditions, the judging rules and the recommendation rule |
| criteria | `scripts/rag2-live/fx-live-2-criteria.ts` (D1 to D7), 55 controls in `fx-live-2-criteria-regressions.ts`. Nothing was changed after results were seen |

The sandbox could not reach the provider, so each request was hashed, relayed once through a recording courier (`scripts/rag2-live/courier*.ts`), and the answer was hash-verified on the way back. Each round was admitted by `prep --cap 0.05`, which refuses a whole round if settled spend plus that round's worst-case reserves would exceed the cap (round 1 worst case US$0.016071, spent 0; round 3 worst case US$0.021955, spent US$0.013008; no round was refused). The workbench also hard-capped spend at US$0.05. (`courier.ts status` prints its own default cap of US$0.25; it is not the cap that was enforced.)

The US$0.15 `trial-codespace-1` reservation is untouched and still counts as unavailable.

### One relay event, disclosed

Request `A/K4b#6` (about 17,000 characters) was refused once by the courier with HTTP 400 "request checksum mismatch (transcription error: send this item again)". That was my copy error while pasting the request into the relay, caught by the courier's checksum before any model call: no spend, no model call, and the refused line was not applied. After I found and fixed the two slips (an inserted fragment, and a dropped word "the"), I verified length and sha256 against the local request and sent **the same request (same sha)** once; it returned 200. This was not a rerun of a conversation, and no request, expectation or limit changed.

## Files

| file | bytes | sha256 (first 16) |
|---|---|---|
| `report.md` (generated: verdicts, stages, cost, failed checks, every visible answer) | 12445 | `fd043f83fac3ef58` |
| `criteria.md` (the registered D1 to D7 results, every check; `criteria.json` is the same data, 13378 bytes, `c66d2a7b1b90d170`, not stored in Git) | 8412 | `5cc5bc56884cd9e2` |
| `bindings.json` (per turn: returned = saved = reopened flag, pages, request keys, every tool call with arguments and evidence ids, citations, calculations with operand bindings, composer drops, timings) | 67794 | `37a8b36a1d33559b` |
| `responses.jsonl` (every raw provider response with request and response hashes) | 30910 | `beeff2a1ba5b901a` |
| `sent.jsonl` (request hash and key per call) | 2830 | `bf0b28e545c21fe3` |
| `results.json` (graded; regenerate with `scripts/reliable-chat-usefulness-ab.ts report`) | 24795 | `e093a5c190e58a06` |
| `requests.jsonl` (1.4 MB; regenerate by replaying `responses.jsonl` against the frozen SHA) | 1395487 | `7d199a1b27dac87c` |

`sent.jsonl`, `results.json`, `criteria.json` and `requests.jsonl` are not stored in Git (size, or fully derivable). The full sha256 of `requests.jsonl` is `7d199a1b27dac87c8403ed7484eb85762a0e343aee9a446d2d506e4482dd8368`; it is the ledger entry's `request_sha`.

CI is covered separately in `CI-FINDINGS.md` (same directory): the workflow file's YAML parse error, GitHub's billing refusal of the other checks, and a local run of the workflow's own steps on the PR tip. The YAML error and the billing refusal do not come from PR #57. Of the three steps red in the local run, all three are red on `main` too; the environment-contract suite is slightly worse on this branch (4 more undocumented variable names, all debug switches in this PR's new test script). Details and the exact counts are in `CI-FINDINGS.md`.

## Results as registered (kept exactly as the graders returned them)

"registered" is the pre-registered criteria (D1 to D7). `v1` is the existing usefulness grader (K3t1 and K6c added in C4).

| conversation | registered D checks | v1 | note |
|---|---|---|---|
| K6b dental | all pass (D1.a to e, D6, D7) | PASS | |
| K2 sickness | all pass (D3.a to e, D6, D7) | FAIL `K2.3` | pre-registered: v1 `K2.3` requires saying Living Care is listed but undescribed, which D3 does not; see EXPECTED |
| K6a cancer | **D2.b FAIL**; D2.a, c to f, D6, D7 pass | PASS | |
| K6c cancer, fresh paraphrase | **D2.b FAIL**; D2.a, c to f, D6, D7 pass | PASS | only conversation that is not regression data |
| K3t1 fracture, one turn | **D5.c FAIL**; D5.a, b, d to h, D6, D7 pass | FAIL `K3t1.6` | |
| K4b person correction | D4.a to e, D6, D7.a, D7.b pass; **D7.c FAIL** | FAIL `V0` | |

Applied mechanically, the registered recommendation rule ("merge for controlled testing only if D1 to D6 are shown on a completed conversation for all six, and D7 holds; HOLD otherwise, naming the specific demonstrated defect") returns **HOLD**, because of the four failed checks. I did not change the rule or any criterion. My reading of each failed check, from the complete visible answer:

| check | what the check matched | my reading |
|---|---|---|
| K3t1 D5.c / v1 `K3t1.6` | the only match of the "a document prevails" pattern is the word "governs" inside "The uploaded documents **do not establish which document governs** this event" | false positive: a negated use that says the opposite of what the check looks for. Neither document is said to prevail |
| K6a D2.b | the limitation "The Scheme X Group Insurance does not state what Group Living Care pays for cancer" is sentence 1, an explanatory sentence is 2, and "Grace's certificate lists Group Living Care at S$350,000 as of 6 October 2022; this is the amount shown on that date, not confirmation of cover now" is 3; the window allows one sentence before | window miss. The limitation is in the answer and **precedes** the amount in the same answer, but it is not attached to the amount's own sentence (see Findings 5) |
| K6c D2.b | the amount sentence is followed directly by "The uploaded documents do not establish whether Grace's cancer meets the policy definition or what amount would be payable for it"; the regex verb list has "do not state/describe/say/specify/show/give" but not "do not establish" | regex miss. The limitation is the next sentence |
| K4b D7.c / v1 `V0` | the composer removed one model sentence: "The certificate wording also leaves open whether Daniel's diagnosis meets its definition of the listed arm fracture; that requires the insurer's medical assessment." because "its evidence does not mention what it is about (requir, insurer, medical, assessment)" | the safeguard worked: no cited page prints an insurer medical-assessment requirement, and the visible answer loses nothing. Recorded as a composer drop, as registered |

These readings are mine; they are not a regrade. The raw grades above stand.

## My reading of the complete visible answers

I read all seven visible answers (full text in `report.md`). `K2`, `K3t1`, `K4b`, `K6a` and `K6b` are **regression data** (the conversations had been inspected and used for fixes before this run); `K6c` is the only fresh wording.

| conversation | what the user sees | judgement |
|---|---|---|
| K6b dental | "Grace's documents (Scheme X Group Insurance Scheme, ... product summary ... certificate summary) do not describe a benefit for dental treatment. That is not the same as saying there is no such cover: it only means none is shown in these documents, and only the insurer can confirm whether there is one." | correct, scoped to three named documents, no invented amount, not a generic refusal |
| K2 sickness | Names the Accidental Hospital Recuperation Benefit (page 9) with its printed accident condition ("within 30 days following bodily injury as a result of an Accident"), applies the reported cause ("she was sick") and says the condition is not met and no amount is given | no repeated accident question; condition and cause correct; no amount, no invented sickness benefit. It does not say that Living Care exists but is undescribed (the v1 `K2.3` fail, as pre-registered) |
| K6a cancer | limitation first (the scheme "does not state what Group Living Care pays for cancer ... not the same as saying it is excluded"), then S$350,000 "as of 6 October 2022 ... not confirmation of cover now", then a contact step | correct and no promise; weakest point is that the limitation is in a separate earlier paragraph rather than attached to the amount |
| K6c cancer paraphrase | S$350,000 dated and "does not confirm cover now", then "do not establish whether Grace's cancer meets the policy definition or what amount would be payable for it", then a contact step | correct, no promise, limitation directly after the amount; minor: "the policy definition" implies a definition exists |
| K3t1 fracture | S$1,250 = 25% of the S$5,000 Simple Fracture limit, Product Summary p13, with the row's `#` footnote (thumb, finger, palm); S$120,000 = 20% of Grace's S$600,000, printed as of 6 October 2022, certificate p8, no footnote on that row; alternatives, not a total; why the documents differ; conditional illustration, not a payment or insurer decision | all figures, bases, dates and row footnotes correct; no `^` toe/foot footnote and no X-ray question; **repetitive**: "the documents do not establish which applies" and "different bases" are said about three and two times |
| K4b turn 1 | same content as K3t1 without the repetition | as above |
| K4b turn 2 | exactly one notice "Updated: this is about Daniel, not Grace.", then Daniel's S$1,250 (with `#`) and S$120,000 (Daniel's own S$600,000, dated), alternatives and not a total, then a contact step | one coherent notice, no Grace figures presented as Daniel's, no wrong-person text |

Across all answers: no payment promise, no unsupported applicability, no wrong person, no other insurer's real name, no technical identifier. Contact steps are limited to the scheme the person's own documents belong to.

## Findings (separate from the grades above)

1. **Returned = saved = reopened on all seven turns** (D7.b pass in all six conversations). This is plumbing consistency only; it says nothing about whether an answer is correct.
2. **Repetition in K3t1.** The same "alternatives / which applies is not established" claim appears about three times and the "different bases" claim twice in one reply. This is a readability defect, not a wrong fact. It is not in K4b turn 1 or turn 2.
3. **The end state depends on the server guards.** The model tried to ask whether the stay was an accident in K2 although the household had already said "she was sick", and tried an X-ray / registered-practitioner question in K3t1 and K4b although no cited page prints that requirement. Server guards handled each: K2's question was "not asked -- how it happened is already recorded"; in K3t1 and K4b "the cited wording ... does not print what it asks"; in K3t1 an earlier call without a `fact_key` was also rejected; in K6a the model's first `note_facts` (`diagnosis=cancer`, a policy-defined classification the household did not state) was rejected. The visible answers and saved questions are clean because of those guards (see `adjusted` and `tool_calls` in `bindings.json`). Nothing here shows the model would stop attempting them.
4. **K4b carry-over.** After the correction the model recorded Grace's "fell down" as Daniel's `how_it_happened`; the user's correction named only the broken arm. It is an inference that carried over, not visible in the answer, and not used in any figure.
5. **K6a placement.** The absence limitation precedes the S$350,000 sentence by one explanatory sentence instead of attaching to it.
6. **Sources under an absence answer.** The citations saved with K6b ("no dental benefit described") are a S$300,000 row on Grace's certificate, the toe/foot footnote and a page-8 claim-condition sentence; none mentions dental. They back "these documents were checked", so unrelated passages are expected, but a reader who opens Sources sees amounts and a fracture footnote under a dental answer. Not graded; a presentation question for the owner.
7. **Latency** is relay-measured model time (K2 9.3 s, K3t1 12.9 s, K4b 7.7 s and 11.0 s, K6a 7.1 s, K6b 7.6 s, K6c 10.1 s) plus 0.1 to 0.2 s of tool time per turn. Browser and network time were not measured.

## Timings

| conversation | turn | model calls | in / out tokens | upstream s | tool s | cost US$ (estimate) |
|---|---|---|---|---|---|---|
| K2 | 1 | 3 | 36249 / 462 | 9.3 | 0.13 | 0.001928 |
| K3t1 | 1 | 4 | 54769 / 948 | 12.9 | 0.18 | 0.001877 |
| K4b | 1 | 3 | 37751 / 486 | 7.7 | 0.18 | 0.001411 |
| K4b | 2 | 4 | 48842 / 616 | 11.0 | 0.12 | 0.004408 |
| K6a | 1 | 3 | 36520 / 386 | 7.1 | 0.16 | 0.001236 |
| K6b | 1 | 3 | 28652 / 147 | 7.6 | 0.11 | 0.000786 |
| K6c | 1 | 3 | 36445 / 435 | 10.1 | 0.13 | 0.001257 |

Model time alone is inside the 20 s ordinary-scenario target on every turn; the two direct lookups (K6a, K6b) are inside 10 s and K6c is 0.1 s over. These are product targets, not guarantees, and the end-to-end send-to-visible time was not measured here.

## What this run does not show

* It does not verify the owner's actual library, and it was not a deployment test. No browser was used in this run.
* One attempt per conversation: there is no consistency evidence. The model's choices on the second attempt could differ. K6c is the only conversation that is not regression data, and one fresh wording is not a held-back set.
* The footnote and absence behaviour is shown for this household's wording only. It is not a claim of 99% or 100% accuracy.
* Cost is estimated from usage at the application's price on file, not billed.
* The recommendation depends on a judgement that the four failed checks are not product defects. A reader who applies the registered rule mechanically gets HOLD; see the table above and decide with the exact sentences in front of you.

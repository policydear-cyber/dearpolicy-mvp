# fx-live-1: live comparison record

A real-model comparison on the synthetic fracture household (three anonymised documents, two people). It does **not** touch the owner's actual library, production, or any production key.

| item | value |
|---|---|
| candidate | `e04cb61d6816c15e4ff7dce30027525bddcb2c00` (frozen before the run; a clean copy was re-hashed after it and was unchanged) |
| model | `gpt-6-luna`, `reasoning_effort: "none"`, temperature 0, dedicated test connection only |
| arm A | the frozen candidate through the real chat route (tool loop, server-resolved benefits, statement verification, save) |
| arm B | one no-tool call per turn with the complete stored text of all three documents ("minimal baseline") |
| calls | 55 (A 43, B 12), none refused, none failed, no divergence between planned and sent requests |
| cost | estimated US$0.023623; upper bound US$0.055757. Neither is provider-billed. The ledger books the upper bound |
| model time | 176.7 s over 55 calls, measured at the relay (excludes relay hand-off and tool time) |
| expectations | written from the rendered pages **before** any answer was read: `EXPECTED-fracture-usefulness.md` (fx-live-1 pre-registration, committed in `e04cb61`) and its independent review |

The sandbox could not reach the provider, so each request was hashed, relayed once through a recording courier (`scripts/rag2-live/courier*.ts`), and the answer was hash-verified on the way back. A run that diverged from its recorded requests would have been invalid; none did.

## Files

| file | bytes | sha256 (first 16) |
|---|---|---|
| `report.md` (generated: verdict table, stage table, cost table, failed checks, every visible answer) | 53311 | `2b5cd3115a8e42e9` |
| `responses.jsonl` (every raw provider response with request and response hashes) | 72734 | `2b4b89004bccfa7c` |
| `sent.jsonl` (request hash and send time per call; the hashes are also in `responses.jsonl`) | 6760 | `b71f42b587d260c4` |
| `results.json` (graded, 90 KB; regenerate with `scripts/reliable-chat-usefulness-ab.ts report`) | 90089 | `57d8e61c77f3c4a1` |
| `requests.jsonl` (2.5 MB; regenerate by replaying `responses.jsonl` against the frozen SHA) | 2582120 | `058e1e7c62aa735b` |

`sent.jsonl`, `results.json` and `requests.jsonl` are not stored in Git (size, or fully derivable). Their hashes are recorded here, and the hash of `requests.jsonl` is the ledger entry's `request_sha`.

## My reading of the full answers

I read all 22 visible answers myself rather than relying on the grader. `K3` (and `K4a`, the leg correction that continues the K3 chain) are labelled **regression data** in every table, because the arm-fracture conversation had already been inspected and used for fixes. The expectations for `K1`, `K2`, `K4b`, `K6a` and `K6b` were written from the rendered pages before any generated answer for them was inspected.

| conversation | A (current pipeline) | B (minimal baseline) | better for the user |
|---|---|---|---|
| K1 amount lookup | correct, dated, "not confirmation of cover now" | correct, dated | equal |
| K2 sick hospital stay (household already said sickness) | prints the accident hospital benefit's wording (`250`, bare `$`) and then **asks whether it was an accident**, which the household already answered; never says plainly that an injury-only benefit does not apply | says the documents show no sickness benefit, explains the injury requirement | B |
| K3 / K4a fracture (regression data) | both documented figures with their bases (S$1,250 = 25% x S$5,000; S$120,000 = 20% x S$600,000; leg S$2,500 / S$300,000), "alternatives from separate documents, never a total", the documents' own reasons they differ (summary defers to certificate; certificate says it is not a contract; neither says which applies), the contact step. Defects: in K3a turn 2 repeats turn 1 unchanged, turn 3 states the framing twice, and "Updated: injury is now broke her leg" reads badly | figures present in most turns, but turn 1 of one run has none, page citations drift (p12 / p13), reads the difference as a simple-vs-other classification the documents never define, no explanation of the summary/certificate relation, no saved server calculation | A |
| K4b wrong-person correction | binds Daniel's figures correctly, but the notice shows **"Updated: this is about Daniel, not Grace. ... Updated: this is about Grace, not Daniel."**, which contradicts itself | right person, concise, no computed figures | B (A has the better content and a defect) |
| K6a cancer under Living Care | gives S$350,000 "as of 6 October 2022" and a contact step; **the statement that the documents do not say what it pays for cancer was dropped**, so the bare figure can be read as the answer | states S$350,000 and that the documents do not say what it pays for cancer | B |
| K6b dental | **"I couldn’t confirm an answer to that from your documents."** (safe but empty) | correct: no dental benefit shown | B |

### What the grader got wrong or exaggerated

* `K4a.8` is a narrow-wording false fail for A: the leg correction is acknowledged and the leg figures are right.
* The `V0` fails in K3a, K3b, K4a and K4b are drops of sentences that restate what the server-rendered status note already says ("neither document says ... which applies") or that assert an insurer review the pages never print. The user loses nothing there. In K6a and K6b the dropped sentence **was the answer**.

### Earliest failing boundary for K6a / K6b

Retrieval passed (7/7). The model wrote the absence statement; the composer's cited-sentence check (`lib/rag2/loop/statements.ts`, line 157, "its evidence does not mention what it is about") rejected it because an incidental word ("found", "available") is not in the cited passage, and the fallback `DROPPED_NOTE` (`lib/rag2/loop/compose.ts`, line 57) was shown. Neither file is changed by this branch, so this is existing behaviour. Main was not run live, so it is not shown whether main answers K6a/K6b better or the same.

## What this run does not show

* It does not verify the owner's actual library, and it was not a deployment test.
* As pre-registered, only the K3 chain was run twice (K3a, K3b, two independent attempts, both kept). K1, K2, K4b, K6a and K6b were run once each, so there is no consistency evidence for them. Actual spend was well inside the registered US$0.25 cap.
* Cost is estimated from usage at the application's price on file, not billed.
* The footnote condition on the Product Summary row (thumb, finger, palm; toe, foot) is not shown in the illustration.
* Whether to lead with the certificate figure or the summary figure is an owner product decision; the answer shows both and does not choose.

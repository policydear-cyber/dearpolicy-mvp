# V1.1 evaluation — BEFORE (base 60b8ac8, Node 22.23.3, deterministic model stand-in)

Runs: in-process API `v11before1` (api/), Task 0 `v11t0before2` (task0/), browser journey with real
sessions `v11before1` (journey/; screenshots kept outside the repo at /home/user/v11logs/before-screenshots/).

## Release gates

| Gate | In-process API (28 questions + ingestion) | Browser journey (same questions through the page) |
|---|---|---|
| unsupported_amount | PASS (0) | PASS (0) |
| unsupported_assertion | **FAIL (3)** Q10, Q14, Q21 | **FAIL (3)** Q10, Q14, Q21 |
| cross_scope | PASS (0) | PASS (0) |
| deleted_superseded | PASS (0) | PASS (0) |
| blocked_gap | **FAIL (2)** Q16, Q21 | **FAIL (2)** Q16, Q21 |
| positive_control | **FAIL (8)** Q02, Q05, Q06, Q07, Q19 (x2), Q23 (x2) | **FAIL (7)** Q02, Q05, Q06, Q07, Q19, Q23 (x2) |
| internal_text | **FAIL (28)** incl. 15 on the documents list | **FAIL (13)** |
| fact_finding | **FAIL (2)** Q17 | PASS (0) (list/detail mismatch caught as T0-4) |
| ingestion terminal state + linking | PASS (17/17 documents: 15 ready, unreadable failed, scan ready; all linked) | 17/17 terminal, all linked |

## Every gate failure

- Q02 positive control: room and board answer lists benefit names but never states S$800/day.
- Q05 positive control: dental exclusion (p3) not reported; answer lists hospital benefits instead.
- Q06 positive control: the alternative-benefits clause (p3) is not reported; answer lists benefit rows.
- Q07 positive control: group life death benefit S$150,000 not stated ("an amount that is only shown after claim evidence has been reviewed"); question treated as a what-if claim.
- Q10 unsupported assertion: expired JetSure (2024-12-31) benefits presented without saying it expired.
- Q14 unsupported assertion: the fracture interview's final answer offers the expired overseas JetSure "Overseas medical expenses" for an accident in Singapore; "reader could not be reached" in the answer.
- Q16 blocked gap: "How much can she claim?" answered "DearPolicy didn't find How much can she claim in the parts of Josephine's policies read so far (13 of 23 pages)".
- Q17 fact finding (API): the claims list says "Assessment ready" while the claim has no estimate; the claim event is named after an interview reply ("Has a doctor said the injury will leave any lasting impairment: No").
- Q19 positive control: baggage delay S$200 / 6 h, max S$1,000 not stated (listed without amount).
- Q21 unsupported assertion + blocked gap: TermGuard shows only US$350,000 (p2) and never the conflicting S$300,000 (p1); no conflict explained.
- Q23 positive control: FutureSaver maturity S$50,000 on 2040-06-01 not stated (row listed without amount).
- internal_text: "13 of 23 processed pages" / "11 of 19 pages" (Q04, Q09, Q16, Q20, Q22, Q25, Q26); "verified against the page by a second read" (Q07, Q08, interview); "DearPolicy's reader could not be reached for this answer" (interview end, Q14); documents list "Ready. N benefit rules read from this document; 1 to confirm on the Benefits page." (14 documents); unreadable document: "Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again."
- Journey hard check: after the reviewer's decisions the claim page shows an indicative estimate, but the chat's final answer in the same claim conversation reverts to "preliminary claim assessment" and asks whether a specialist made the diagnosis (no reviewed amounts).

## Task 0 live defects

| Check | Before |
|---|---|
| T0-1 "Josephine broke her arm" premature assessment / permanent loss | PASS (asks accident vs illness first; no amount; no permanent loss) |
| T0-2 factual question ~40 s | PASS in-process (p95 33 ms); page: factual p50 2.1 s, p95 4.2 s, max 7.9 s |
| T0-3 raw quota error + org id | PASS (clean "reading service is busy" message in 2.0 s, 1 provider call) |
| T0-4 list "Assessment ready" vs detail "No estimate yet" | **FAIL** (reproduced in-process and on the pages) |
| T0-5 fracture claim action lists death documents | **FAIL** ("Manage claim evidence (death certificate, police report, coroner's report)") |
| T0-6 Benefits/Coverage pages ask to fix rows / confirm headings / re-read | **FAIL** (Coverage page: "fix a row only if you know something the document doesn't say") |
| T0-7 usage "No model calls" + wrong hard stop | **FAIL** (page says "No model calls yet this month" while model_executions has 57/269 rows; "Hard stop at $14.97" vs owner's $5) |
| T0-8 login needs two clicks | PASS (one click, 0.8 s) |

## Timing (browser, real page, deterministic model)

Factual answers p50 2.1 s / p95 4.2 s (max 7.9 s, n=20); interview turns p50 2.5 s / p95 3.9 s (n=12);
upload to terminal state p50 3.5 s / p95 12.0 s (n=17). Targets (<= 8 s / <= 12 s / <= 30 s) met locally;
these exclude a real provider's latency.

## Model calls and cost (model_executions, same runs)

Journey: 269 calls, $0.000000 (stand-in unpriced): policy_extraction 15, hosted_ocr 1, and 253 recorded as
**failed** (benefit_extraction 144, condition_catalog_extraction 56, catalog_building 53 — operations the
stand-in does not implement; in production these are real paid calls). No chat-turn executions are
attributed to the household (chat model calls carry no household reference). The Usage page shows none of it.

## Cleanup

Journey teardown: 0 residue in every counted table; 3 Auth users deleted. Independent
`v1-db-verification --cleanup-proof`: FAIL 3 — the reviewer audit log keeps identifier/label rows by
design (append-only trigger; 7 orphan rows from two journey runs); nothing else remains.

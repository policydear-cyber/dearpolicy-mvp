# Task 0 live-defect regression checks (in-process)

| Check | Defect | Result | Detail |
|---|---|---|---|
| T0-1 | "Josephine broke her arm" produced an assessment and a permanent-loss schedule | PASS | mode=fact_finding; first question="Was this caused by an accident, or an illness?"; permanent-loss text=none; claim items with amounts=0 |
| T0-2 | a factual question took roughly 40 seconds | PASS | 5 stored-fact answers in-process: 33, 31, 19, 18, 30 ms (p95 33 ms; target <= 8000). In-process with the stand-in: excludes network/provider latency -- the browser journey measures the page. |
| T0-3 | the endowment question exposed a raw OpenAI quota error and organisation identifier | PASS | HTTP 200 in 2026 ms; provider calls=1 (bound 3); provider text=none; leaks=none |
| T0-4 | the claims list said "Assessment ready" while the detail page said "No estimate yet" | **FAIL** | list "Assessment ready" (claims page rule status==='complete') vs detail hasEstimate=false; event "Has a doctor said the injury will leave any lasting impairment: No" |
| T0-5 | a fracture claim's list action described death documents | **FAIL** | lib/claims/status.ts claimDisplayStatus does not exist at this commit; the claims list renders a fixed 'Manage claim evidence (death certificate, police report, coroner's report)' action for every claim (app/claims/page.tsx) -- confirmed on the rendered page by e2e/tests/v11-journey.spec.ts (Task 0 page checks) |
| T0-7 | usage said no model calls despite model activity, and showed a different hard stop than the owner's $5 API budget | **FAIL** | model_executions for this household this run=57; model_usage rows=0; /api/usage calls=0, byRole=0; hard stop shown=14.97 (owner's provider cap: $5/month) |

T0-4/T0-5/T0-6/T0-7 rendered pages: e2e/tests/v11-journey.spec.ts (Task 0 page checks). T0-8 login: e2e/tests/v11-journey.spec.ts.
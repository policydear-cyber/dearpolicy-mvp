# dj-live-3 answer-completeness repair -- offline checkpoint (19 Oct 2026)

Draft PR #56. Main, production, credentials, migrations and uploaded documents are unchanged. No model call and no spend in this
checkpoint. The original dj-live-2 and dj-live-3 grades (`dj-live-3-grade.json` / `.md`), the ledger (US$0.15 trial reservation and
all spending history) and the recorded run directories are untouched.

Records head 3bb34f6; product code under test in the live run: f2fe6a6.

## 1. What the DI message and the uploaded wording say about the exact death date

DI's message: "Daniel passed away last week after a long illness - it was not an accident. What would the family receive from his
insurance, and what should we do?" (dated Mon 19 Oct 2026).

* "last week" is kept as a range, not one day: 6-18 Oct 2026 (the previous calendar week or the past seven days, the union of both
  readings). It is never turned into an exact day.
* The uploaded wording on the cited passages: Group Term Life pays 100% of the Sum Assured and "Death must occur while the
  Insured Person is covered under the Scheme". No cited clause counts a period from the death. Every date the documents print
  (certificate 6 Oct 2022, product summary dates) lies years before the range.
* So under this wording the exact day cannot change what the documents say: the cover on the date of death is not established
  either way, whatever day of that week it was. The answer says so and keeps the uncertainty ("the documents do not establish
  whether Daniel was covered on the date he died").
* A date question is NOT banned. It stays when (a) no date was given, (b) a cited clause counts a period from the event
  ("within 365 days of the Accident", "cover ends ..."), or (c) a printed date is not before the start of the range.
  Rule: `lib/rag2/loop/answer-completeness.ts` (`dateQuestionVerdict`).

## 2. Completeness across final_answer AND ask_user

* When the household asks what to do, the supported step ("Contact <insurer of this person's own policy document> ... to ask what
  it needs for a claim") is added on both ways of ending a turn, using the existing person-linked contact renderer. It is ahead of
  any remaining question; a clarification no longer suppresses independently supported advice.
* The step is a suggestion to ask the insurer. Printed claim requirements stay in the cited statements. No deadline, form or
  contact detail is invented. It is not repeated when the reply or an earlier turn already gave it, not added to a direct amount
  lookup, and never names another person's insurer.
* An ask_user reply now saves and shows its next steps; the page shows them above the open question instead of inside the
  collapsed "Show full assessment".

## 3. dj-live-3 replayed unchanged (scripts/reliable-chat-dj-live-3-replay.ts)

The recorded model calls (seven calls in three steps, ending in one ask_user) are fed back through the real chat route. Result:
final_answer with the dated Group Term Life S$1,000,000 as of 6 October 2022 and "does not confirm cover on his date of death";
the printed Term Life terms; accident-only benefits named as accident-only with no amount (no S$600,000); the uncertainty note
about "last week"; the Aldermoor Life Ltd contact step; zero questions. Returned = saved = reopened (history route) = displayed
in the browser (e2e/tests/reliable-chat-dj-live-3.spec.ts, recorded output only, no new model call).

## 4. Controls (same file)

* date-dependent question kept: wording counts "within 365 days of the Accident", no date given -> asked once, with its reason,
  step shown ahead; and the same "last week" over that clause still asks;
* direct amount lookup: no contact step; contact step already given: shown once; later "what next": not repeated;
* another person's insurer: Daniel's step names Aldermoor only, Grace's names Harbourline only (second household);
* pure rule checks with positive and negative controls (range after every printed date; printed date inside or after the range;
  period clause; cover-limiting clause; no date; exact date given).

## 5. Evaluator note (separate from the original grade)

The original grade stays: dj-live-3 FAILED the pre-registered I5 (no visible next step) and I6. I5 was a real failure and is fixed
in code only (not yet re-run live). I6's stated reason ("the person and the cause are known") was coarser than the real test: a
death-date question is unnecessary only when the uploaded wording does not turn on it. For DI, on this wording, it was
unnecessary, so the I6 verdict stands; the reason text should be read as above. Any future grader should judge such a question by
whether a cited clause or a printed date makes the date decisive, with the positive control (365-day clause) and negative control
(Term Life wording with "last week") from section 4. Nothing about the original grade file is edited.

## 6. Latency of the 65.5 s DI turn (measured from the existing trace only)

* Three model calls: upstream 19.1 s, 3.6 s, 41.9 s (sum 64.6 s). Relay overhead 10 ms per call. Application time about 0.9 s
  (accepted 0.36 s). So about 98.6% of the turn was the provider/proxy hop. The trace cannot separate provider time from the
  proxy_execute hop.
* Output tokens 163, 171, 300; the 41.9 s call produced only 300 tokens, so token count does not explain it. One observation.
* No limit was raised and no infrastructure change is proposed on one slow call.

## 7. Verification at this checkpoint

Typecheck clean; death-live-repairs, death-journey, death-cause, death-applicability, applicability, benefit-records,
structured-answers, slice, live-regressions, cache-compaction, cases, conflicts, booklet, cda-recorded, active-route, stage3,
rag2:loop (22/22), ci-workflow-coverage and the new dj-live-3 replay (39 checks) pass. Browser (production build, local
PostgreSQL, Chromium): tan 3/3, booklet 6/6, actuallib 8/8, deathjourney 3/3, dj-live-3 DI replay 1/1.
Limitation: the browser journey covers the replayed final answer; the open-question layout (steps above the question) is
covered by the saved/reopened comparison in the replay test, not by a browser run.

## 8. Smallest live confirmation (proposed, not run)

One DI attempt (`dj-live-4`), same message, new product SHA, cap at most US$0.01, US$0 preflight first, loopback relay as before,
graded against the unchanged six pre-registered expectations. Needs your approval.

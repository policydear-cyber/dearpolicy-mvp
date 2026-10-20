# PR #67 (removing a person from a document): Test engineer check at 02089e7

| worker | task | SHA | status | evidence | blocker |
| --- | --- | --- | --- | --- | --- |
| Test engineer | update the test that required the bug; browser journey for unlinking | PR #67 head `02089e7` | pass | `pr67/` | none |

Scripted and synthetic only: local PostgreSQL, the dev-identity stack from `browser-e2e.yml`, the deterministic model stand-in and Chromium. No model call, no spend.

## The test that required the bug

`scripts/r5-ux-regressions.ts` asserted `source IN ('user_declared','upload_hint')` with the message "only household-made links are ever removed". That is the bug PR #67 fixes.
It now asserts:
- the old restriction is gone;
- the picker's save goes through `saveDocumentCoverage`;
- only matching-wording links (`NOT_SHOWN_AS_COVERED = ["scheme_reference_match"]`) are left alone.

The tier upsert check now reads `lib/policies/coverage-assignments.ts`, where 02089e7 moved it. The originals are kept in comments. Result: 13/13, six runs in a row.

## Browser journey (`e2e/tests/document-unlink.spec.ts`)

The journey runs these steps:
1. Add two people and upload a synthetic wording.
2. Tick the first person in "Who does this document cover?".
3. Link the second as a reading links a matched name (`ai_name_match`, written to the local synthetic database).
4. Control: the second person's answer uses the document.
5. Untick the second person and reload.
6. Check that they stay unticked, the library lists only the first person, their answer no longer uses the document, and the first person's still does.

| | 02089e7 | main ac3216d |
| --- | --- | --- |
| set-up, control, unlink and reload | 3/3 | 2/3: after the untick and reload, the chip is still ticked (the bug) |

## Not covered

No live-site run. The PR's own `system-database-regressions` test was not re-run here.

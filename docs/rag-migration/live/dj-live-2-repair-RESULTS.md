# dj-live-2 repair (offline checkpoint, no paid calls)

Original dj-live-2 responses and grades are unchanged. This file records only the offline repair.

## First incorrect decision, per statement
- Term Life S$1,000,000 (missing from DI): `bindCitedFigures` renamed and deleted a value id still held by a server-written statement (and `personAmountValue` returned a stale cached id), so the statement was dropped as "table value not read". Presentation failure on a sound binding.
- PA S$600,000 (surviving): the fallback completion built the "schedule's percentages are of that sum insured" line from an inapplicable PA value; a certificate-summary roster path also ignored applicability.

## Repair
- `lib/rag2/benefit-applicability.ts`: explicit result (supported / not_applicable / unresolved) with source and reported-fact dependencies, read by every output path.
- Binder keeps held value ids; verification-removed statements are re-rendered only from a sound validated record; rejected claims are never restored.

## Controls
`npm run reliable-chat:death-applicability-test` (A1-A7, M1-M15 mutations). Mutations M1, M3, M5, M7, M15 are layered defences and are not individually proven.

## Remaining failures
- `rag2:s52-replay` 11/12 (extra split sentence; baseline unverified).
- Live confirmation of DI not yet run. Recommendation: HOLD.

# Backend housekeeping audit

Baseline: `4ad93424367cb45eb1c748709840d6f5497e96d1`.

## Removed

- `lib/ai/judge.ts`: no imports, dynamic path references, or external uses of its exported adapter APIs in the 775 code/configuration/SQL files examined. The adapter included an unimplemented TypeSafe provider.
- `lib/supabase/browser.ts`: no callers of `createSupabaseBrowserClient`; authentication uses the existing server routes instead.
- The `JUDGMENT_PROVIDER` and `TYPESAFE_API_KEY` example block in `.env.example`, which belonged only to the removed adapter.

## Retained

The older chat pipeline is still a selectable fallback and shares helpers with active routes and tests. It must be retired only when its replacement and callers have migrated; it is not an unused directory.

Scanners, workers, calculators, schema setup scripts and regression suites still have callers or explicit package/workflow entry points. No removal was based solely on a disabled feature flag or an empty table.

The live database catalog contains 47 public tables. Catalog inspection alone does not establish that any table is obsolete. No live records, tables, functions, buckets, environment secrets or migration history were deleted.

## Validation

Static reference and exported-symbol checks covered app, lib, components, config, scripts, e2e, SQL and workflow/package configuration at the baseline commit. Both deleted modules have zero inbound references in that snapshot. There were no identical backend module files. Existing internal-only exports are not automatically unused implementations.

The housekeeping PR runs the existing repository checks. Local full typecheck/build were not executed during this audit. No model calls were made.

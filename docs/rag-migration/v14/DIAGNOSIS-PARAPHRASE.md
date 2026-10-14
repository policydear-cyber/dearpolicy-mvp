# V1.4: why the paraphrase (S49B, s49-live-1) ended at the token limit

Source: the saved trace in `docs/rag-migration/live/RUN-s49-live-1-2026-10-14T08-44-21/run.json` (S49B, run on `c6c1dba`).

## What the model did, call by call

| model call | tools it called | input tokens (cached) | output | latency |
|---|---|---|---|---|
| 1 | `resolve_person` | 7,156 (7,005) | 18 | 1.8 s |
| 2 | `note_facts`, `person_benefits`, `policies_for` | 7,271 (7,030) | 136 | 2.5 s |
| 3 | `search_passages` ×2 | 9,170 (7,145) | 174 | 3.4 s |
| 4 | `select_table_value` (Group Personal Accident) | 14,153 (9,044) | 79 | 1.8 s |
| 5 | `ask_user`: **refused** (`statements[1].e2 is not a parameter of this tool`) | 14,532 (14,027) | 288 | 3.2 s |
| 6 | `final_answer`: **refused** (`sentences[3].e8,e9 is not a parameter of this tool`) | 14,914 (14,406) | 378 | 4.1 s |
| (7) | not made: about 68,269 of the 80,000 per-turn tokens were used, and the next call (about 20,552) would have gone over | | | |

Token use by stage:

| stage | tokens | share |
|---|---|---|
| Baseline (system prompt and tool definitions, about 7k per call) | about 42,000 | the bulk |
| Results of `person_benefits` + `policies_for` | about 1,900 | |
| The two searches | about 5,000 | |
| The two refused answer calls (their input) | about 29,400 | |

## Causes

1. **Malformed answer calls.** The model wrote citations as object keys (`{"e2": ["e2"]}`, `{"e8,e9": [...]}`) instead of in `evidence_ids` or `value_ids`. The schema check rightly refused them, but the error did not say what was allowed, so the model failed the same way twice. The same habit cost one refused `ask_user` in S49 turn 1.
2. **Redundant lookups.**
   - `select_table_value` re-read the Group Personal Accident row that `person_benefits` had already returned with a value id.
   - The two `search_passages` calls looked for wording that `person_benefits` already listed (the accidental-death condition and the Death Benefit line).

## Fixes (general, with no limit raised and no retry added)

- **Unambiguous key-written citations are moved into their citation field.** This applies only where the key, and its value, are nothing but evidence, value or result ids. The citation is then checked like any other.
- **Any other unknown key is still refused**, and the error now lists the allowed fields.
- **`select_table_value` reuses `person_benefits`' value id** for the same document, person and row, and says so, instead of reading the table again.
- **`person_benefits` tells the model** that its lines are already the person's printed benefits, to cite them directly, and to search only for what is not listed.
- **Unchanged:** repeated identical calls are still refused with actionable feedback ("not run again: the same call was already made …"), and a tool that fails twice is still stopped.

## Tests

`npm run rag2:binding-test` covers these, without model calls:
- an answer with key-written citations is accepted on its first call;
- any other unknown key is refused with the allowed fields listed;
- a repeated row read reuses the value id.

# DearPolicy — conversational RAG migration: handoff

Branch: `claude/conversational-rag-v1-1` (private repo policydear-cyber/dearpolicy-mvp).
Main is NOT changed by this branch. No deployment or live migration is authorised.

## Objective
Replace the growing collection of specialised chat answer handlers with one model-driven
conversation loop over common retrieval tools, keeping the safety foundations:
- evidence identities: every stated figure carries its own binding (policy, document version/hash,
  person, benefit row, table column, page range, verbatim passage) and is re-checked at save time;
- shared table selection: a value is selected by policy/version → row → column kind → the person's
  applicable column; ambiguous → clarify, unknown → explicit missing information; never "a number
  elsewhere on the page";
- deterministic calculations: integer-cent arithmetic with policy-defined units, rounding and caps;
  printed limit ≠ indicative estimate ≠ payout; estimates never enter totals.

## Architecture (planned, behind a feature flag)
- Prompt 1 — common retrieval tools alongside the existing chat (flag off by default):
  search passages, read page, select table value, resolve person, select policy/version,
  compute (deterministic), each returning evidence identities.
- Prompt 2 — one conversation loop: the model retrieves evidence, resolves the person, asks only
  policy-relevant questions (one at a time), handles interruption and correction, and answers from
  specific passages; the save-time gate verifies every figure and coverage statement.

## Current state
- Base: remote main `42bcac1ab10f722cf51ff442ff7bc6b5aabc21de` (tree `cb351147cc6e9040d0b4ad31e34687beeaf7c2fe`),
  verified against the GitHub API on 2026-10-08.
- Implemented paths on this branch: none yet beyond this document (checkpoint 1).

## Lost historical work (not recoverable — historical reports only)
The cloud sandbox used for development was reset on 7 Oct and again on 8 Oct 2026; Composio
download links used as "backups" expired within about a day. Lost, with no recoverable code or
raw results:
- local commits d3e0423, a6345da (R17 gate + claims integration), fd0fc92 (gate rebuild),
  323f1d5 (person/policy/version), ce72eab (tables/calculators), 7e36490 (direct answers),
  dd1883b (69-commit integrated candidate);
- all evaluation tooling, judge rubric files, adjudication and raw outputs for those runs;
- the 6 Oct sealed holdout (sha256 49c8a074…) and its 7 Oct re-creation (sha256 2edbcef5…),
  neither ever opened by developer agents.
Reported results for those commits (e.g. dd1883b strict 255/873) are historical claims without
evidence. None of their fixes should be assumed present.

## Durable evaluation artifacts
- Used regression set "r15" (H4/H5/H6, 873 items): generator sources to be versioned in this branch
  under `eval/r15-used/` (checkpoint 2), with SHA-256s of manifests/batteries recorded below once
  regenerated and matched.
- Future sealed holdouts must be stored outside developer-agent access (not in this repo, not in
  the shared sandbox).

## Verification commands
(to be filled per checkpoint)

## Known failures
(to be filled per checkpoint)

## Next steps
1. Checkpoint 2: version the r15 regression set sources and evaluation code.
2. Prompt 1: retrieval tools behind a flag, reusing rebuilt evidence identities, table selection,
   deterministic calculation.
3. Prompt 2: the single conversation loop.
4. Demonstrate: ordinary policy question, ambiguous person, injury fact-finding, interruption,
   correction, grounded final answer.

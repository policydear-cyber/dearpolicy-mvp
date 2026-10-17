# rc-live-9 result: benefit-record repair, real wording + fresh paraphrase — PASS (both)

- **Tested code (frozen):** `c72905871c8d0322f2fb149fb08f97db94c1ccb5` (pre-registration [EXPECTED-rc-live-9.md](EXPECTED-rc-live-9.md) in the same
  commit, before the run). Provenance by tree manifest (922 files); production build of that tree on Node 22.22.2.
  Grader **v7** (`gradeFL5`), unchanged after the run. One attempt per scenario, no rerun. rc-live-7 (v5 FAIL) and
  rc-live-8 (v6 FAIL) are kept as graded.
- **Run:** `rc-live-9-booklet-cda` (`RAG2_LIVE_HOUSEHOLD=booklet BOOKLET_CDA=recorded`, `--scenarios FL5a,FL5b`), batch
  cap **US$0.03**, `openai:gpt-6-luna` through the existing loopback relay (dedicated test key held by Composio; relay
  stopped after the run). Dry run listed FL5a and FL5b only.
- **Spend:** US$0.003323 over 8 calls (0 refused, 0 failed): FL5a US$0.001615 (3 calls), FL5b US$0.001708 (5 calls).
  Ledger: spent by all runs US$0.363765; **available to automated runs US$0.486235
  after** the open US$0.15 `trial-codespace-1` reservation (unspent, not released). Earlier entries unchanged.
- **Latency (send → visible):** FL5a 10.3 s (saved 10.2 s; model 9.3 s, 3 steps); FL5b 15.0 s (saved 14.8 s; model
  14.3 s, 5 steps). FL5a is just over the 10 s direct-answer target.
- **Returned = saved:** for both, the answer the route returned (summary, details, questions and next steps -- the run
  log now records next steps) is identical to the saved answer that reopening shows.
- **Files:** `live/RUN-rc-live-9-booklet-cda-2026-10-17T12-15-21/`, `live/rc-live-9-booklet-cda-2026-10-17T12-15-21-grade.md` / `.json`.

## Benefit records offered

Both runs called `person_benefits` for Daniel (FL5a topic "accidental death and funeral expenses"; FL5b "death after
an accident; funeral expenses or funeral benefit; proof or documents required for a claim"). Offered: the
certificate's Group Term Life and Group Personal Accident rows (as of 2024-04-01); the booklet's Simple Fracture
Benefit Limit, **Compassionate Death Allowance Benefit (Section 5): 2,000 (bare "$"; currency not stated), with its
Section 5 paragraphs as conditions**, and Repatriation (Section 6, 5,000 bare "$"); the summary's Compassionate Death
Allowance Benefit (S$2,000, footnote: Core or Voluntary Scheme only) and Ambulance Cost (S$500) -- the table in the
pre-registration. Both models selected the booklet's allowance by `benefit_id` (`benefit_terms`); the server wrote it.

## FL5a (real wording) — PASS (13/13)

> If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?

```
The Group Insurance Benefits Booklet (page 9, under “Section 5 - Compassionate Death Allowance Benefit”) prints the Compassionate Death Allowance Benefit for the funeral expenses incurred, up to 2,000 (printed with a bare “$” sign; the Group Insurance Benefits Booklet does not say which currency), with the printed conditions “If an Insured Person dies as a result of an Accident”, “on receipt of proof of death and the relevant documents in our prescribed form” and “This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme.”.
The booklet does not list the specific documents or forms required beyond proof of death and relevant documents in the prescribed form.
The benefit can be claimed under either the Core Scheme or the Voluntary Scheme, but not both.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

Calls: resolve_person → note_facts → person_benefits → search_passages → final_answer (accepted first time). Nothing
dropped, nothing gated.

## FL5b (fresh paraphrase) — PASS (13/13)

> Say Daniel passed away after an accident. Would the booklet cover any of the funeral costs, and how much? What proof would the insurer ask us for?

```
The Group Insurance Benefits Booklet (page 9, under “Section 5 - Compassionate Death Allowance Benefit”) prints the Compassionate Death Allowance Benefit for the funeral expenses incurred, up to 2,000 (printed with a bare “$” sign; the Group Insurance Benefits Booklet does not say which currency), with the printed conditions “If an Insured Person dies as a result of an Accident”, “on receipt of proof of death and the relevant documents in our prescribed form” and “This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme.”.
The uploaded certificate does not show whether Daniel is enrolled in the Core or Voluntary Scheme.
The booklet says the certificate shows which products and amounts apply; so these documents do not establish that this funeral benefit applies to him.
The booklet specifies proof of death and relevant documents in the insurer’s prescribed form, but does not list the particular documents required.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

Calls: resolve_person → note_facts → person_benefits → policies_for → search_passages → final_answer (sent back once
by the save-time check: its own sentence "The separate Insurance Benefits Summary lists up to S$2,000 for this
benefit." did not name the benefit the figure is printed for) → final_answer (accepted, that sentence left out).
The final saved answer has no gate rejection.

## Observations beyond the grade

- The allowance, its funeral-expenses purpose, accidental death, proof of death and the prescribed-form documents,
  and the Core / Voluntary restriction are shown in both, from the record, with the bare-"$" currency stated as
  unknown; nothing from Repatriation, no S$ for the booklet, no promise of payment, no invented condition.
- FL5a's "…under either the Core Scheme or the Voluntary Scheme, but not both" paraphrases "can only be claimed either
  under the Core Scheme or the Voluntary Scheme"; "but not both" is the model's reading, not printed words.
- FL5b omits the summary's S$2,000 (its first wording was refused and the model dropped it rather than rewording it);
  the separate summary figure is therefore not shown -- acceptable (A2C allows but does not require it).
- Two attempts are one per question, not two per scenario: consistency across repeated attempts is not established.

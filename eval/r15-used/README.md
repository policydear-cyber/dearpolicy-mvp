# r15 held-out test set - DearPolicy (DO NOT SHARE WITH DEVELOPERS)

Evaluator-only. Three new households (H4, H5, H6) with fictional insurers, products, people and questions
written from scratch. Nothing here is reused from r7.

As-of date for every question: **2026-10-06, Asia/Singapore**. Run the app with that clock (or tell the
model that today is 06 Oct 2026), otherwise date answers ("days left", "expired") will be wrong.

## Layout

```
r15-heldout/
  README.md            this file
  score.py             stdlib-only scorer
  generator/
    common.py          PDF builder, pdftotext extraction, fact + battery verification
    gen_h4.py gen_h5.py gen_h6.py   each prints "ALL FACTS VERIFIED" (exit 1 on any mismatch)
  H4/ H5/ H6/
    manifest.json      ground truth: members, documents, facts (doc/page/value/evidence), derived facts, traps, not_uploaded
    battery.json       >=150 single messages + 15 multi-turn conversations
    docs/<name>.pdf               upload these
    docs/<name>.pdf.b64           same bytes, base64 (for API upload)
    docs/<name>.pdf.extracted.txt `pdftotext -layout` output (pages split by \f) - reference only
```

Regenerate (needs python3, reportlab, poppler `pdftotext`, a TrueType CJK font such as
DroidSansFallbackFull.ttf or wqy-zenhei.ttc):

```
cd generator && python3 gen_h4.py && python3 gen_h5.py && python3 gen_h6.py
```

## Households

| HH | Who | Documents | Key traps |
|----|-----|-----------|-----------|
| H4 | Blended family: Marcus Lim Wei Jie + Priya Varghese, Marcus's son Aiden Lim Jun Hao (student in Australia), Priya's children Kavya Nair and Rohan Nair, helper Maricel Dela Cruz | Kestrel HealthGuard schedule (Jan 2026) + endorsement (Priya upgraded to Premier 01 Jul 2026), Orchidia CI MultiProtect (multi-pay table), Harbourline FamilyPA + claim settlement (Rohan S$640 paid, S$860 left), Crestbay Student Abroad (Aiden), Kestrel HelperCare maid insurance | two schedules/effective dates; only Priya upgraded; Aiden not named on PA; helper only on maid policy; "my son" ambiguous on a shared login; CI offset/cap; dengue not CI |
| H5 | Elderly couple: Teo Boon Huat (73), Lau Siew Lan (69); daughter Teo Mei Ling asks for them | Lumina Shield Plan A (as-charged private) and Plan B (pro-ration 55%/65% private), MediSave limits reference sheet, ElderShield/CareShield + supplements, Banyan whole life (surrender table split over pages 3-4), assignment notice to Straits Harbour Bank, Chinese-language funeral plan with English headings | pro-ration vs as-charged; deductible by ward class; table continued on next page; assignment revokes nomination and needs bank consent; supplements trigger at 2 ADLs vs 3; funeral advance is deducted, not extra; MediSave AWL changes at Mum's 2027 renewal |
| H6 | Young professional: Ethan Yeo Zhi Hao (31), dog Mochi | FlexBen booklet (options) + enrolment confirmation (choices), Pelican HomeShield mortgage reducing term (SA schedule by year), PawSure pet, DriveSafe motor (excess, NCD), DailyCare hospital cash (30-day waiting, pre-existing exclusion), `scan_0915.pdf` (garbled/unreadable), TravelEase expired 15 Sep 2026 | booklet vs elections (Group CI not elected); current-year SA not initial; pet does not cover a person; cumulative excesses; waiting period cut-off 14 Sep 2026; unreadable doc; expired travel; business travel only for authorised trips |

## Loading notes

* One app household/account per HH. Upload every file in `HH/docs/*.pdf` (not the .b64/.txt). Upload
  `scan_0915.pdf` as-is: it is meant to be unreadable. `banyan_final_farewell_lau_zh.pdf` is Chinese with
  English headings.
* Let indexing finish before running the battery. Run each single message in a **fresh chat**; run each
  conversation's turns in order in **one chat**.
* Household context the app may be given (names, relations, DOBs) is in `manifest.json -> members`. H4
  uses a shared login, so "I / my son / my plan" are ambiguous unless the user says who they are.
* Collect replies as `{"singles": {id: text}, "conversations": {conv_id: [text per turn]}}` and run
  `python3 score.py H4/battery.json replies.json --json result.json`.

## Battery format

```
singles[]:       {id, intent, message, behaviour, expected, forbidden, fact_refs, tags, note?}
conversations[]: {id, title, tags, turns: [{turn, user, behaviour, expected, forbidden, fact_refs, note?}]}
```

* `expected`: list of groups; a group passes when ANY alternative appears in the reply. Matching is
  case-insensitive, `S$`/`$`/`SGD` and thousand separators are normalised, numbers match on digit
  boundaries, dates are pre-expanded to common formats.
* `forbidden`: strings a correct reply to that message must not contain (wrong figure / wrong plan).
* `fact_refs`: manifest fact or derived-fact ids that ground the expectation. The generator refuses to
  build if any expected group is not found in its referenced facts, or any fact's evidence is not on the
  stated PDF page.
* Tags: `singlish`, `typo`, `why`, plus topic tags on conversations.

## Behaviour vocabulary

(The r7 README was not present in this sandbox, so the vocabulary is defined here and also embedded in
each `battery.json -> behaviour_types`.)

| behaviour | meaning |
|-----------|---------|
| answer | factual answer grounded in an uploaded document |
| compute | arithmetic or date reasoning over document facts (as-of 2026-10-06) |
| clarify | genuinely ambiguous; must ask, must not commit to one interpretation's figure |
| not_uploaded | the document/policy is not among the uploads; say so, do not invent |
| not_covered | uploads show the person/event is not covered (not named, excluded, not elected, wrong policy type) |
| expired | policy not in force on the relevant date |
| unreadable | relevant doc cannot be read; say so, ask for a readable copy, do not guess |
| out_of_scope | not an insurance-document question; brief redirect |
| advice_decline | personal recommendation requested; facts allowed, decision deferred to a licensed adviser |
| claim_start / claim_step | claim flow: right policy/person, next single question or estimate |
| correction | user corrects a fact; answer must switch to the corrected figure and drop the old one |

`score.py` checks expected/forbidden strictly and behaviour with simple marker regexes; for a stricter
grade, give an LLM judge the behaviour definitions plus the `note` fields.

## Counts

| HH | docs | facts | derived | singles | conversations (turns) |
|----|------|-------|---------|---------|-----------------------|
| H4 | 7 | 118 | 34 | 163 | 15 (137) |
| H5 | 7 | 130 | 40 | 151 | 15 (136) |
| H6 | 8 | 100 | 31 | 153 | 15 (133) |

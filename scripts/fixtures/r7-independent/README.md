# r7 independent test battery (DearPolicy)

Synthetic households, generated policy PDFs and question batteries written **independently of the app code**
(nothing under `lib/`, `app/` or `scripts/r6/` was read). All insurers, people, policy numbers and amounts are
fictional; every PDF page has the footer "SYNTHETIC TEST DOCUMENT". "As of" date for every expectation: **2026-10-05 (Asia/Singapore)**.

## Layout

```
r7-battery/
  README.md                 this file
  score.py                  reference text scorer (deterministic checks; see "Scoring")
  generator/                scripts that rebuild everything (python3 + reportlab + Pillow; pdftotext/pdftoppm/tesseract for verification)
    fixturelib.py           PDF renderer (vector pages + image-only "scanned" pages) and fact verifier
    gen_h1.py gen_h2.py gen_h3.py            household + document definitions (single source of truth for PDFs AND manifests)
    batterylib.py battery_h1.py battery_h2.py battery_h3.py   question batteries
  H1-tan/  H2-aisyah/  H3-ong/
    manifest.json           members, documents, ground-truth facts, traps
    battery.json            singles + multi-turn conversations
    docs/<name>.pdf         the document
    docs/<name>.pdf.b64     same bytes, base64 (same convention as scripts/fixtures/r5-*/ *.pdf.b64)
    docs/<name>.pdf.extracted.txt   pdftotext -layout per page (OCR output for the image-only page) - used for verification
```

Rebuild: `cd generator && for f in gen_h1 gen_h2 gen_h3 battery_h1 battery_h2 battery_h3; do python3 $f.py; done`
(each gen script prints `ALL FACTS VERIFIED` only when every manifest fact is found on its stated page of the generated PDF).

## Households

| id | who | documents (active / deleted) | main traps |
|---|---|---|---|
| H1-tan | Tan Wei Ming (owner), father Tan Ah Kow (75), wife Lee Siew Ling, kids Tan Jun Hao (2013), Tan Jun Hui (2016), Tan Xin Yi (2020) | 7 / 1 | Integrated Shield plan + Co-Pay rider with MediSave split; age-banded deductible; group booklet (GTL/GPA/GHS, Plan 1 vs Plan 2, Employee/Spouse/Child tiers); endowment; ILP statement with **no premium printed**; **image-only scanned** PA certificate; "Jun" ambiguity; deleted travel policy |
| H2-aisyah | Nur'Aisyah Binte Abdul-Rahman (single) | 7 / 1 | CareShield Life (MediSave premium), term life, annual travel, dental/outpatient rider whose base plan is NOT uploaded, lapse notice + later reinstatement letter, **USD** universal life, deleted old hospital plan, nominee who is not a member |
| H3-ong | Ong Kah Seng (owner) + spouse Chua Pei Shan Rachel | 6 / 1 | 2021 schedule (S$300,000) vs 2025 endorsement (S$250,000); SecureCare **Plus** (him) vs SecureCare **Pro** (her), same insurer; joint-life policy covering both; a document that is only a premium receipt; deleted home policy |

Each manifest's `traps` array lists what the battery is probing, in plain words.

## manifest.json

- `members[]`: `id`, `display_name`, `preferred_name`, `relationship` (`self|spouse|child|parent`), `dob`.
- `documents[]`: `id`, `file`, `file_b64`, `sha256`, `insurer`, `product_name`, `policy_number`, `policy_type`,
  `document_role`, `covers` (member ids insured), `policyholder`, `effective_date`, `renewal_or_expiry_date`,
  `document_date` (letters/receipts/endorsements), `currency`, `benefit_tier` / `member_tiers` (GHS tier per member),
  `cover_by_member` (group booklet: which sub-cover applies to whom), `fixture_state` (`active` | `deleted`),
  `pages[]` (`page`, `text_layer`, `summary`), `facts[]`, `facts_verified`.
- `facts[]`: `{id, label, value, page, line_contains?, tier?}` - `value` is the exact printed string; when
  `line_contains` is present the value is on the same printed line as that label (table rows).
  For the image-only page, verification is a fuzzy OCR match (OCR reads `S$` as `$$`/`5$`), the value itself is exact.

## Loading the fixtures (notes for developers)

1. One account per household; insert `members` into `family_members` (`display_name`, `preferred_name`, `relationship`).
   The signed-in user is the battery's `asker` (default = manifest `account_owner`; some conversations use `m_siewling` / `m_rachel`).
2. Prefer running the real ingestion on `docs/*.pdf` (or `.pdf.b64`, decoded the same way as `r5-answer-regressions.ts`).
   If you seed rows directly instead, the manifest fields map onto `policies` / `policy_members` / `premium_records`;
   `document_role` values used here are `certificate`, `benefit_guide`, `statement`, `endorsement`, `lapse_notice`,
   `premium_receipt` - map them to your enum, but keep the distinction (the battery depends on it).
3. `fixture_state: "deleted"` documents must be uploaded and indexed, then deleted through the normal user delete path
   (soft-delete), so that deletion is actually exercised. Their amounts are in each battery's `global_forbidden`.
4. H1 `lioncity-juniorguard-pa-xin-yi-scan.pdf` has **no text layer** (a skewed, noisy image). Ingestion needs OCR;
   if your pipeline cannot read it, the 5 Xin Yi PA singles (tag `scanned`) are expected to fail - that is the finding.
5. H3: upload the 2025 endorsement **before** the 2021 schedule (upload order differs from document date order).
6. The group booklet covers 5 people but with different sub-covers (GTL/GPA employee only; GHS everyone except Ah Kow) and tiers.

## battery.json

```
{ household_id, as_of_date, default_asker, global_forbidden: [...], notes: [...],
  singles: [ {id, kind:"single", asker, scope:"household", message, expected_behaviour, also_acceptable?,
              must_include, forbidden, forbidden_unless_qualified?, cite?, tags?, note?} ],
  conversations: [ {id, kind:"conversation", title, asker, tags, turns:[ {turn, message, expected_behaviour, ...same fields} ]} ],
  counts }
```

- Singles are independent: send each in a **fresh** chat. Conversation turns are sent in order in one chat;
  expectations assume the previous turns happened (pronouns, corrections, topic switches).
- `must_include`: every entry must appear in the answer (summary + details). An entry is a string or `{"any_of": [...]}`.
- `forbidden`: must not appear. Entry is a string or `{"regex": "..."}` (regex applied to the raw answer, case-insensitive).
- `global_forbidden`: forbidden in **every** item of that household (deleted-document amounts/numbers, other households' people).
- `forbidden_unless_qualified`: may appear only when clearly labelled old/original/superseded (needs human/LLM judgement).
- `cite`: `{doc, page}` pairs - at least one should be among the answer's citations when the answer is grounded.
- `also_acceptable`: other behaviours that are fine (see the item's `note` for the condition).
- `note`: grader guidance, including the arithmetic behind computed amounts.

### expected_behaviour vocabulary

| value | meaning |
|---|---|
| `answer` | Answer from the household's documents; include the `must_include` facts; cite pages. |
| `not-found` | The documents on file do not say (silent document, missing document, deleted document, unprinted figure). Say so plainly; do **not** turn silence into "not covered", and do not guess a number. |
| `clarify-which-person` | The question is ambiguous between people (or between two similar plans): ask which one before answering (e.g. "Jun" = Jun Hao or Jun Hui). |
| `claim-question` | User is describing a real event they want to claim for: engage the claim flow / explain which policy and benefits may apply, limits, deadlines and what is needed. Must not promise payment. |
| `refuse-advice` | Personal financial/insurance advice ("should I..."): decline to recommend; may restate facts. |
| `greeting` | Greeting, thanks, acknowledgement - brief reply, no policy data dump. |
| `out-of-scope` | Not about the household's insurance documents (weather, letters, exchange rates, actions the app cannot do). |

Useful tags: `ambiguous-jun`, `similar-names`, `conflict`, `deleted-doc`, `missing-base-plan`, `silent-doc`, `scanned`,
`usd`, `total`, `comparison`, `computation`, `correction`, `subject-change`, `pronouns`, `very-short`, `typo`,
`singlish`, `malay`, `chinese`, `name-variant`, `sensitive`.

## Scoring

`python3 score.py H1-tan/battery.json answers.jsonl [--report r.json]`, where each answers line is
`{"id": "H1-S001", "turn": null|n, "answer": "...", "behaviour": "...", "citations": [{"doc": "...", "page": n}]}`.
Matching: case-insensitive, whitespace collapsed, curly apostrophes folded; `S$`/`SGD`/`$` stripped, `US$`/`USD`
kept as a `usd` marker (so `S$250,000` does **not** satisfy `US$250,000`); thousands commas and trailing `.00` ignored;
numbers match on digit boundaries (`S$300` does not match `S$300,000`). Behaviour labels and `forbidden_unless_qualified`
need a human/LLM grader; the scorer reports them as `unchecked` / `qualify_review`.

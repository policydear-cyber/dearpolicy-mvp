# Fixture reconciliation against the actual-library report (PR #54, 17 October 2026)

Source: `DearPolicy-live-verification-PR54-2026-10-17.md` (the owner's report of eight UI turns on the six-document library). No private source text or trace was committed: the fixture (`scripts/fixtures/reliable-chat/actual-lib.ts`) stays anonymised (insurer, address, web path, people, numbers changed consistently) and is checked against what the report states, in three groups.

## 1. Faithfully reproduced (the report prints / quotes it)
| item | report | fixture |
|---|---|---|
| Combined PA heading "Simple Fracture or Other Fracture due to Accident", rows with explicit "(Other Fracture)" labels, no printed definition of Simple/Other | yes | same; the synthetic "Simple means closed" definitions are NOT imported |
| Simple Fracture table: S$5,000 limit; Neck/Skull/Spine 100%, Hip 75%, Jaw/Pelvis/Leg/Ankle/Knee 50%, Cheekbone/Shoulder/Hairline 30%, Arm/Elbow/Wrist/Ribs 25% | yes | same |
| Footnote / marker artefacts "Leg^, Ankle", "# Arm", "30% #" | yes | same (J3/J5s cover them) |
| Other-Fracture row 50% of own sum insured = S$300,000 for a S$600,000 sum insured | yes | same |
| Compassionate Death Allowance: summary "up to S$2,000"; booklet bare "$2,000"; condition "can only be claimed either under the Core Scheme or Voluntary Scheme"; clause-14 documents | yes | same; the wrapped footnote ("... or Voluntary" / "Scheme.") is now quoted whole (found by this reconciliation: J5s failed before `lib/rag2/headings.ts` was fixed) |
| Direct certificate lookup (dated Term Life and PA amounts), switch to the other member's own row | yes | J6 / SE (own row and date) |

## 2. Verified metadata (previously INFERRED, now confirmed by the report)
Group Personal Accident sum insured **S$600,000** (the member's own certificate row; the report's S$300,000 = 50% of it) and Term Life S$1,000,000. The report shows the summaries naming the product "MINDEF & MHA Group Insurance" and the certificate naming an insurer and hotline; the fixture uses an invented insurer name.

## 3. Still inferred / invented (do not read these as actual-library evidence)
- INFERRED: page numbers of the PA summary page (report states page 13 for the product summary only); the certificate dates (the report's are 06/10/2022; this fixture's are its own); both summaries' document metadata and whether they amend/replace each other (the report says that relationship is unestablished -- the fixture and the answers keep it so).
- INVENTED controls: the other household, the superseded earlier product summary, Grace's certificate row (own date and amount), all personal names (Daniel/Grace for the report's anonymised members) and policy numbers.
- Not reproducible here: the report's job-timing figures (database job creation-to-completion, 24-52 s) -- different deployment, no live-site access; reported separately from the live-relay timings of this work.

## What the reconciliation changed
- J5s (new): the product summary's wrapped Compassionate Death Allowance footnote -- failed on the sa-live-3 candidate, fixed in `lib/rag2/headings.ts` (a capitalised line end continued by a short closing fragment).
- Explanations of a case question now quote the asked options' own rows (“Hip 75%”; “Jaw, Pelvis, Leg, Ankle or Knee 50%”) instead of an arbitrary table row (the report's "Cheekbone ... 30% #" finding) in both the model-asked and the server-asked path.

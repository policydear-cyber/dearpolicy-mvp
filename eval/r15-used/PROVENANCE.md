# r15-used — provenance

**Status: USED regression set — NOT a holdout.**

## Origin
- Written 6 Oct 2026 by an independent author agent (synthetic Singapore household
  insurance documents H4, H5, H6 plus question batteries and a strict scorer).
- Used for the baseline scoring of `main` at 663611e (strict `score.py`: **254/873**).
- Its failures were then used to inform fixes. Because the set has been seen and
  used to guide changes, it is a regression set only; results on it must not be
  reported as held-out generalisation.
- Regenerated 7 Oct 2026; this copy is staged from the surviving local copy
  (8 Oct 2026) and re-verified by regenerating it in a clean sandbox.

## Contents
- `README.md`, `score.py` — set description and strict scorer.
- `generator/common.py`, `generator/gen_h4.py`, `gen_h5.py`, `gen_h6.py` — deterministic generators.
- `H4/`, `H5/`, `H6/`: `manifest.json` (facts), `battery.json` (questions/conversations),
  `docs/*.pdf.extracted.txt` (`pdftotext -layout` text of each generated PDF).

## PDFs are not stored — regenerate them
The PDFs and their `.pdf.b64` copies are build outputs and are deliberately not versioned.
Regenerate with:

```
pip install reportlab            # tested with reportlab 4.4.10
# poppler-utils (pdftotext) and a TrueType CJK font, e.g. fonts-droid-fallback or fonts-wqy-zenhei
cd generator && python3 gen_h4.py && python3 gen_h5.py && python3 gen_h6.py
```

Each script must print `ALL FACTS VERIFIED`. On 8 Oct 2026 regeneration was checked in two
environments (local: Ubuntu, poppler 24.02, WenQuanYi Zen Hei; sandbox: Debian 13, poppler 25.03,
Droid Sans Fallback): `manifest.json`, `battery.json` and every `*.extracted.txt` were
byte-identical to the files below. The PDF bytes themselves differ between runs/environments
(embedded timestamps/IDs and the CJK font chosen), so PDFs are verified via their extracted text,
not their own hashes.

## SHA-256 of every versioned file (excluding this PROVENANCE.md)
```
61f753c4359effbaf538d4f8337b8bc49a6c62b0b8e836fd307ea6c37e047b8e  H4/battery.json
32f77dfb3df85480bb7eb1c9681579724a6a7e8570636f439205fe7903479163  H4/docs/crestbay_student_abroad_aiden.pdf.extracted.txt
f0901aaf8bcd81b65e6c36c00ebedc2e6d326d93e7983b772305d2f5170573ea  H4/docs/harbourline_claim_settlement_rohan.pdf.extracted.txt
7757a728f9011b478ef42a7dc701de46501564020c8cc0c00bda8737d28e919b  H4/docs/harbourline_familypa_schedule.pdf.extracted.txt
e6dc2767df66a597603c68afd01e9e43564d7e4b9d7a26c9352e79c33a9cb90c  H4/docs/kestrel_healthguard_endorsement_jul2026.pdf.extracted.txt
d47cf034cbe06cb9cdcda6311451f6fa26157545f19290b1e6e7718a8a575b6e  H4/docs/kestrel_healthguard_schedule_2026.pdf.extracted.txt
4a56d50603aa86c934b4acc517fbd0a7edc09f0f52e03e28a3478caacabd0efc  H4/docs/kestrel_helpercare_maricel.pdf.extracted.txt
134a22e02a456f07ea896d1d4dc025c5abefe30ab0f8fcd1b01d882e4d7ee6b1  H4/docs/orchidia_ci_multiprotect_marcus.pdf.extracted.txt
39e2915a7a73225ed15e7782ecaf581788ff3ddcd0960f8e6e43b44ce371e916  H4/manifest.json
934804f6304bf2e14405e5dc10287d0a6ee49178b102c83ce3cfc1c8c296a70a  H5/battery.json
8a23c9f53f0c2acfc1fa7a580f80549ba517898a7b99ab68e8fa85ee86880d1e  H5/docs/banyan_assignment_notice_teo.pdf.extracted.txt
240fedc8f37a5a7bf17ce65e8e58deed25010846e4bd586b66998c96527b6b5c  H5/docs/banyan_final_farewell_lau_zh.pdf.extracted.txt
4de07d8c801e633edf2a5fc0f02d572a440a00c7c6df86be18e964d2a800cdd2  H5/docs/banyan_heritage_wholelife_teo.pdf.extracted.txt
facd03794daf8c34444ad41504164da3220357ac2afb9417ac7e13e061195d68  H5/docs/lumina_longterm_care_supplements.pdf.extracted.txt
2f9d7aa40a00b4644804f69dcddbad8a570e6a8651c8336f6899329150b2692d  H5/docs/lumina_shield_planA_teo.pdf.extracted.txt
44407609b2e4ccbf037625b06d5a6bc1bbe245642851b441ddf4e2727f220bbf  H5/docs/lumina_shield_planB_lau.pdf.extracted.txt
76421cbca65df92c321d67379cdbfad52a974e5761ef1f4b50de072bccff2025  H5/docs/medisave_withdrawal_limits_reference.pdf.extracted.txt
e3c3a970cf4756476476b83870a6e555cdbe4794832504700328dff7ac8e37de  H5/manifest.json
501b62e4c992a162fd4a2b7bbbefb3313d1fc2244ab6ef062dbea11a21c45f08  H6/battery.json
5e381f842f9d30a067af4d715ca879a391e95ef43b82a39cdbb8bca81aa8809e  H6/docs/aurelion_flexben_booklet_2026.pdf.extracted.txt
62fd441eb8e98276248f9b8acc43cac2216f2af1da660f4f9e60d9fab182f66f  H6/docs/aurelion_flexben_enrolment_ethan.pdf.extracted.txt
a0537bfd85c57f0b88bf95f5e4ab77399347edb5a69e2f6f4e451dac5dc56aa1  H6/docs/pelican_dailycare_hospital_cash.pdf.extracted.txt
8e5f809a436935dd9e6d3575ed811946600ffaef8c47815b744c9b94e5779ba5  H6/docs/pelican_homeshield_mrt_ethan.pdf.extracted.txt
eace6eba7ea1921c6c9038c7670020245f152e6f717164ba069f60797070637a  H6/docs/scan_0915.pdf.extracted.txt
7e82089b03d43ce908bdee33f9cf19d9a7465a0bd62999e21be4bc39ac471e3f  H6/docs/tembusu_drivesafe_motor_ethan.pdf.extracted.txt
d199ce4a43d37cfd82360f4414b0e5e90d9fea8559d61366825587cf905cad83  H6/docs/tembusu_pawsure_mochi.pdf.extracted.txt
8ff9da1d2f07356f6847992b5af29eaa5b63761ac8f78ce05f9f50bae0bd91cd  H6/docs/tembusu_travelease_annual_2025.pdf.extracted.txt
a3445d7e742637a0184410e7b3524a01ec54a0b69d5512ee76412d9789f773b5  H6/manifest.json
f2ff90facbc92c87404daf1a194c257bd7fef5fda1bf3f9eac7a6bfdf0fe1c56  README.md
239a6c032a4c7b6eaaf47522b0b9258fcb91a0da6cec222f8c254bb89de0da42  generator/common.py
a35395ecf80943e03a13a6595b205473212d410d58ad7686aae6a10773c7af6f  generator/gen_h4.py
0b2d693caf676a541d5a1a04de79cff8a1db7586b0d15ed0bdd719f186aad2bc  generator/gen_h5.py
c0bb2f183e9f1c52c6e61721c6d2247ea235c28fd5e59329c2322b0af83a3062  generator/gen_h6.py
8397580a4ea1236bb1e42218b7ba2b3a295ec007c960773e09d23e0ce7a6ac1f  score.py
```

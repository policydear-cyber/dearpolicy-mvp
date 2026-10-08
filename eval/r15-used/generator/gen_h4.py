"""H4 - blended family (Lim / Varghese / Nair) + helper. Prints ALL FACTS VERIFIED."""
from common import Doc, F, DV, Battery, build, days_between, age_on

# ============================================================ documents
def mk(name, issuer, doc_title, ref, **meta):
    x = Doc(name, issuer, doc_title, ref)
    x.meta = meta
    return x

HG = "kestrel_healthguard_schedule_2026.pdf"
HE = "kestrel_healthguard_endorsement_jul2026.pdf"
CI = "orchidia_ci_multiprotect_marcus.pdf"
PA = "harbourline_familypa_schedule.pdf"
CL = "harbourline_claim_settlement_rohan.pdf"
TR = "crestbay_student_abroad_aiden.pdf"
MD = "kestrel_helpercare_maricel.pdf"

hg = mk(HG, "Kestrel Life Assurance Pte Ltd", "HealthGuard Hospital Plan - Policy Schedule", "Ref KL-HG-5520417 / SCH-2026",
        title="HealthGuard Hospital Plan schedule (Jan 2026)", insurer="Kestrel Life Assurance Pte Ltd",
        product="HealthGuard Hospital Plan", policy_no="KL-HG-5520417", policyholder="Marcus Lim Wei Jie",
        insured=["Marcus Lim Wei Jie", "Priya Varghese"], type="hospital", status="in force (superseded in part by endorsement for Priya from 2026-07-01)")
hg.page().h("HealthGuard Hospital Plan - Policy Schedule").kv([
    ("Policy number", "KL-HG-5520417"),
    ("Policyholder", "Marcus Lim Wei Jie"),
    ("Schedule issue date", "20 Dec 2025"),
    ("Policy year", "01 Jan 2026 to 31 Dec 2026"),
    ("Renewal", "Yearly on 01 Jan"),
    ("Premium payment", "Annual, by GIRO"),
]).h("Insured persons").table([50, 175, 290, 420, 490], [
    ["Name", "Plan", "Ward entitlement", "Annual limit", "Premium"],
    ["Marcus Lim Wei Jie", "HealthGuard Standard", "Restructured Class A", "S$500,000", "S$1,288.00"],
    ["Priya Varghese", "HealthGuard Standard", "Restructured Class A", "S$500,000", "S$1,104.00"],
]).h("HealthGuard Standard - benefit summary").table([50, 220], [
    ["Benefit", "Limit / terms"],
    ["Ward entitlement", "Restructured hospital, Class A ward"],
    ["Annual claim limit", "S$500,000 per insured per policy year"],
    ["Deductible", "S$3,500 per insured per policy year"],
    ["Co-insurance", "10% of the claimable amount after deductible"],
    ["Treatment in a private hospital", "Eligible bill pro-rated to 50% before deductible and co-insurance"],
    ["Pre-hospital treatment", "Up to 90 days before admission"],
    ["Post-hospital treatment", "Up to 180 days after discharge"],
]).p("How a claim is calculated: take the eligible bill (after any pro-ration), subtract the deductible, then the insured "
     "pays 10% co-insurance on the remainder. Kestrel pays the balance, up to the annual claim limit.")
hg.page().h("General conditions").p(
    "Pre-existing conditions are excluded unless declared to and accepted by Kestrel in writing.").p(
    "Exclusions include cosmetic treatment, pregnancy and childbirth (except listed complications), dental treatment "
    "unless needed because of an accident, and treatment outside Singapore unless it is an emergency.").p(
    "Claims should be submitted within 90 days of discharge together with the final hospital bill.").p(
    "This schedule must be read together with the policy contract and any endorsements issued.")

he = mk(HE, "Kestrel Life Assurance Pte Ltd", "HealthGuard Hospital Plan - Endorsement No. 2", "Ref KL-HG-5520417 / END-02",
        title="HealthGuard endorsement: Priya upgraded to Premier from 01 Jul 2026", insurer="Kestrel Life Assurance Pte Ltd",
        product="HealthGuard Hospital Plan", policy_no="KL-HG-5520417", policyholder="Marcus Lim Wei Jie",
        insured=["Priya Varghese"], type="hospital (endorsement)", status="in force from 2026-07-01")
he.page().h("Endorsement No. 2 - Change of Plan").kv([
    ("Policy number", "KL-HG-5520417"),
    ("Policyholder", "Marcus Lim Wei Jie"),
    ("Endorsement issue date", "18 Jun 2026"),
    ("Endorsement effective date", "01 Jul 2026"),
]).p("With effect from 01 Jul 2026 the Schedule dated 20 Dec 2025 is amended as follows. All other terms remain unchanged.").table(
    [50, 190, 350], [
        ["Insured person", "Plan before 01 Jul 2026", "Plan from 01 Jul 2026"],
        ["Priya Varghese", "HealthGuard Standard", "HealthGuard Premier"],
        ["Marcus Lim Wei Jie", "HealthGuard Standard", "No change (HealthGuard Standard)"],
    ]).h("HealthGuard Premier - benefit summary (Priya Varghese)").table([50, 220], [
        ["Benefit", "Limit / terms"],
        ["Ward entitlement", "Private hospital, standard room"],
        ["Annual claim limit", "S$2,000,000 per policy year"],
        ["Deductible", "S$3,500 per policy year"],
        ["Co-insurance", "10% of the claimable amount after deductible"],
        ["Pro-ration", "None - no pro-ration for private hospitals"],
        ["Pre-hospital treatment", "Up to 180 days before admission"],
        ["Post-hospital treatment", "Up to 365 days after discharge"],
    ]).h("Premium adjustment").kv([
        ("Revised annual premium (Priya Varghese)", "S$2,416.00"),
        ("Additional premium, 01 Jul 2026 to 31 Dec 2026", "S$656.00"),
        ("Annual premium (Marcus Lim Wei Jie)", "S$1,288.00 (unchanged)"),
    ], x2=300)
he.page().h("Conditions of upgrade").p(
    "1. Hospital admissions that begin before 01 Jul 2026 are assessed under HealthGuard Standard, even if the stay "
    "continues after that date.").p(
    "2. The enhanced benefits of HealthGuard Premier do not apply to any condition diagnosed, treated or showing "
    "symptoms before 01 Jul 2026. Such conditions continue to be covered on HealthGuard Standard terms.").p(
    "3. Any deductible already met in this policy year counts towards the HealthGuard Premier deductible.").p(
    "4. This endorsement does not change the cover of any other insured person under the policy.")

ci = mk(CI, "Orchidia Insurance Ltd", "CI MultiProtect - Policy Schedule and Benefit Table", "Policy OR-CM-7781350",
        title="CI MultiProtect (multi-pay critical illness) - Marcus", insurer="Orchidia Insurance Ltd",
        product="CI MultiProtect", policy_no="OR-CM-7781350", policyholder="Marcus Lim Wei Jie",
        insured=["Marcus Lim Wei Jie"], type="critical illness (multi-pay, early stage)", status="in force")
ci.page().h("CI MultiProtect - Policy Schedule").kv([
    ("Policy number", "OR-CM-7781350"),
    ("Life assured", "Marcus Lim Wei Jie"),
    ("Policy owner", "Marcus Lim Wei Jie"),
    ("Date of birth", "14 Mar 1979"),
    ("Commencement date", "01 Apr 2023"),
    ("Sum assured", "S$200,000"),
    ("Cover ends", "01 Apr 2054 (policy anniversary after age 75)"),
    ("Annual premium", "S$2,976.00"),
    ("Nomination", "Revocable nomination - Priya Varghese (100%)"),
]).h("Multi-pay benefit table").table([50, 210, 300, 390], [
    ["Stage of condition", "% of sum assured", "Amount payable", "Limit"],
    ["Early stage", "25%", "S$50,000", "1 claim per condition group"],
    ["Intermediate stage", "50%", "S$100,000", "1 claim per condition group"],
    ["Severe stage", "100%", "S$200,000", "per condition group"],
    ["Angioplasty (special benefit)", "10%", "S$20,000", "capped at S$25,000; 1 claim"],
]).p("Overall limit: total payouts under this policy are capped at 300% of the sum assured, i.e. S$600,000. "
     "The policy continues after a claim until this cap is reached.")
ci.page().h("Claim rules").p(
    "R1. A severe-stage claim for a condition will be paid less any early-stage or intermediate-stage amount already "
    "paid for the same condition.").p(
    "R2. Waiting period: no benefit is payable for Major Cancer, Heart Attack of Specified Severity, Coronary Artery "
    "By-pass Surgery or Angioplasty if signs, symptoms or diagnosis occur within 90 days of the commencement date or "
    "reinstatement date.").p(
    "R3. Survival period: the life assured must survive 7 days after diagnosis.").p(
    "R4. Between claims for unrelated conditions there must be at least 12 months between the dates of diagnosis. A "
    "recurrence of the same cancer can be claimed only if 24 months have passed since the last cancer claim.").p(
    "R5. Only conditions listed in the Condition Table (page 3) are covered. Any illness not listed, including "
    "infectious diseases such as dengue fever, is not covered under this policy.")
ci.page().h("Condition Table (extract)").table([50, 135, 255, 385], [
    ["Group", "Early stage", "Intermediate stage", "Severe stage"],
    ["1 Cancer", "Carcinoma in situ", "Early organ cancer", "Major Cancer"],
    ["2 Heart", "Pacemaker insertion", "Moderate cardiomyopathy", "Heart Attack of Specified Severity"],
    ["3 Brain", "Minor brain surgery", "Stroke, partial deficit", "Stroke with permanent deficit"],
    ["4 Kidney", "Kidney removal", "Chronic kidney disease st.4", "End Stage Kidney Failure"],
], size=8.4)

pa = mk(PA, "Harbourline General Insurance Pte Ltd", "FamilyPA Shield - Policy Schedule", "Policy HG-PA-3309184",
        title="FamilyPA Shield personal accident schedule", insurer="Harbourline General Insurance Pte Ltd",
        product="FamilyPA Shield", policy_no="HG-PA-3309184", policyholder="Priya Varghese",
        insured=["Priya Varghese", "Marcus Lim Wei Jie", "Kavya Nair", "Rohan Nair"], type="personal accident", status="in force")
pa.page().h("FamilyPA Shield - Policy Schedule").kv([
    ("Policy number", "HG-PA-3309184"),
    ("Policyholder", "Priya Varghese"),
    ("Period of insurance", "01 Feb 2026 to 31 Jan 2027"),
    ("Plan", "Family Plan 2"),
    ("Annual premium", "S$486.00"),
]).h("Insured persons").table([50, 220, 330], [
    ["Name", "Category", "Date of birth"],
    ["Priya Varghese", "Adult", "02 Nov 1982"],
    ["Marcus Lim Wei Jie", "Adult", "14 Mar 1979"],
    ["Kavya Nair", "Child", "09 May 2012"],
    ["Rohan Nair", "Child", "30 Jan 2015"],
]).h("Benefits").table([50, 330, 440], [
    ["Benefit", "Adult", "Child"],
    ["Accidental death & permanent disablement", "S$150,000", "S$30,000"],
    ["Accidental medical expenses (per policy year)", "S$3,000", "S$1,500"],
    ["  of which physiotherapy / TCM", "S$500", "S$300"],
    ["Daily hospital income (max 30 days)", "S$100 per day", "S$100 per day"],
    ["Mobility aids", "S$500", "S$500"],
]).p("Accidental medical expenses is an aggregate limit per insured person per policy year; every claim paid reduces "
     "the amount remaining for that person until the policy year ends.")
pa.page().h("Eligibility and key exclusions").p(
    "Children are covered up to age 18, or up to age 25 if in full-time education. Only persons named in this Schedule "
    "are insured; other family members are not covered unless added by endorsement.").p(
    "Exclusions include: professional sports; injuries while under the influence of alcohol or drugs; illness or "
    "disease of any kind (this is an accident-only policy); pregnancy; war and terrorism.").p(
    "Daily hospital income is payable from the first full day of hospital admission due to an accident, up to 30 days "
    "per accident.").p(
    "Claims must be notified within 30 days of the accident, with original bills and the medical report.")

cl = mk(CL, "Harbourline General Insurance Pte Ltd", "Claim Settlement Advice", "Claim HG-CL-26-004417",
        title="FamilyPA claim settlement - Rohan wrist fracture", insurer="Harbourline General Insurance Pte Ltd",
        product="FamilyPA Shield", policy_no="HG-PA-3309184", policyholder="Priya Varghese",
        insured=["Rohan Nair"], type="claim settlement letter", status="paid 2026-04-18")
cl.page().h("Claim Settlement Advice").kv([
    ("Claim number", "HG-CL-26-004417"),
    ("Policy number", "HG-PA-3309184"),
    ("Insured person", "Rohan Nair"),
    ("Date of accident", "03 Apr 2026"),
    ("Description", "Fall during school PE lesson - fractured left wrist"),
    ("Date of settlement", "18 Apr 2026"),
    ("Payee", "Priya Varghese (GIRO, account ending 4410)"),
]).table([50, 330, 440], [
    ["Item", "Amount claimed", "Amount paid"],
    ["Accident & emergency attendance", "S$210.00", "S$210.00"],
    ["X-ray", "S$95.00", "S$95.00"],
    ["Orthopaedic consultation and cast", "S$335.00", "S$335.00"],
    ["Total", "S$640.00", "S$640.00"],
]).h("Remaining limits for Rohan Nair (policy year 01 Feb 2026 to 31 Jan 2027)", size=10.5).table([50, 260, 360, 450], [
    ["Benefit", "Annual limit", "Used", "Remaining"],
    ["Accidental medical expenses", "S$1,500.00", "S$640.00", "S$860.00"],
    ["Physiotherapy / TCM sub-limit", "S$300.00", "S$0.00", "S$300.00"],
]).p("Follow-up treatment for the same accident is claimable within the remaining limits above until 31 Jan 2027.")

tr = mk(TR, "Crestbay Travel Insurance Pte Ltd", "Student Abroad Plan - Certificate of Insurance", "Cert CB-SA-2026-118842",
        title="Student Abroad Plan (Gold) - Aiden, Australia", insurer="Crestbay Travel Insurance Pte Ltd",
        product="Student Abroad Plan", policy_no="CB-SA-2026-118842", policyholder="Marcus Lim Wei Jie",
        insured=["Aiden Lim Jun Hao"], type="student travel", status="in force")
tr.page().h("Student Abroad Plan - Certificate of Insurance").kv([
    ("Certificate number", "CB-SA-2026-118842"),
    ("Policyholder", "Marcus Lim Wei Jie"),
    ("Insured student", "Aiden Lim Jun Hao"),
    ("Date of birth", "21 Jul 2006"),
    ("Country of study", "Australia"),
    ("Period of insurance", "10 Feb 2026 to 09 Feb 2027"),
    ("Plan", "Gold"),
    ("Premium paid", "S$1,380.00"),
]).h("Schedule of benefits (per period of insurance)").table([50, 300], [
    ["Benefit", "Limit"],
    ["Overseas medical expenses", "S$250,000"],
    ["Emergency medical evacuation and repatriation", "S$500,000"],
    ["Study interruption (forfeited tuition fees)", "S$15,000"],
    ["Personal belongings", "S$3,000 (S$750 per item; laptop S$1,500)"],
    ["Loss of passport", "S$500"],
    ["Personal liability", "S$500,000"],
    ["Compassionate visit by a family member", "S$7,500"],
    ["Excess", "S$100 per medical claim; nil for evacuation"],
])
tr.page().h("Important conditions").p(
    "1. Coordination with OSHC: medical expenses recoverable under the Overseas Student Health Cover (OSHC) that the "
    "Australian Government requires the student to hold are excluded. This plan pays the eligible balance not paid by "
    "OSHC, after the excess.").p(
    "2. Cover is suspended while the insured student is in Singapore.").p(
    "3. Trips to countries other than Australia and Singapore during term breaks are covered for up to 21 days per trip.").p(
    "4. Pre-existing medical conditions are not covered.").p(
    "5. The insured must remain enrolled as a full-time student; cover ends 30 days after the student stops full-time study.")

md = mk(MD, "Kestrel General Insurance Pte Ltd", "HelperCare Maid Insurance - Policy Schedule", "Policy KG-MI-8806521",
        title="HelperCare maid insurance - Maricel", insurer="Kestrel General Insurance Pte Ltd",
        product="HelperCare Maid Insurance", policy_no="KG-MI-8806521", policyholder="Marcus Lim Wei Jie (employer)",
        insured=["Maricel Dela Cruz"], type="foreign domestic worker (maid) insurance", status="in force")
md.page().h("HelperCare Maid Insurance - Policy Schedule").kv([
    ("Policy number", "KG-MI-8806521"),
    ("Policyholder (employer)", "Marcus Lim Wei Jie"),
    ("Insured helper", "Maricel Dela Cruz"),
    ("Nationality", "Philippines"),
    ("Date of birth", "17 Aug 1990"),
    ("Period of insurance", "15 Nov 2025 to 14 Jan 2028"),
    ("Plan", "Essential"),
    ("Premium (26 months)", "S$398.00"),
]).table([50, 330], [
    ["Benefit", "Limit"],
    ["Personal accident (death / permanent disablement)", "S$60,000"],
    ["Hospital and surgical expenses", "S$15,000 per year of cover"],
    ["Outpatient clinic visits", "Not covered"],
    ["Wages and levy reimbursement while hospitalised", "S$40 per day, up to 30 days"],
    ["Repatriation of mortal remains", "S$10,000"],
    ["Security bond guarantee (to MOM)", "S$5,000"],
]).p("Year of cover 1: 15 Nov 2025 to 14 Nov 2026. Year of cover 2: 15 Nov 2026 to 14 Jan 2028. The hospital and "
     "surgical limit applies separately to each year of cover.")
md.page().h("Exclusions and conditions").p(
    "Pre-existing conditions, and pregnancy and childbirth, are excluded.").p(
    "Members of the employer's family are not insured under this policy.").p(
    "Claims are made by the employer and must be notified within 30 days.")

DOCS = [hg, he, ci, pa, cl, tr, md]

# ============================================================ facts
FACTS = [
    # people
    F("m_marcus_dob", CI, 1, "1979-03-14", "Date of birth 14 Mar 1979", "Marcus Lim Wei Jie", "member", aliases=["Marcus"]),
    F("m_priya_dob", PA, 1, "1982-11-02", "Priya Varghese Adult 02 Nov 1982", "Priya Varghese", "member", aliases=["Priya"]),
    F("m_kavya_dob", PA, 1, "2012-05-09", "Kavya Nair Child 09 May 2012", "Kavya Nair", "member", aliases=["Kavya"]),
    F("m_rohan_dob", PA, 1, "2015-01-30", "Rohan Nair Child 30 Jan 2015", "Rohan Nair", "member", aliases=["Rohan"]),
    F("m_aiden_dob", TR, 1, "2006-07-21", ["Insured student Aiden Lim Jun Hao", "Date of birth 21 Jul 2006"], "Aiden Lim Jun Hao", "member", aliases=["Aiden"]),
    F("m_maricel_dob", MD, 1, "1990-08-17", ["Insured helper Maricel Dela Cruz", "Date of birth 17 Aug 1990"], "Maricel Dela Cruz", "member", aliases=["Maricel"]),
    # hospital plan
    F("hg_policy_no", HG, 1, "KL-HG-5520417", "Policy number KL-HG-5520417", None, "hospital", aliases=["HealthGuard", "Kestrel"]),
    F("hg_marcus_plan", HG, 1, "HealthGuard Standard", "Marcus Lim Wei Jie HealthGuard Standard Restructured Class A S$500,000 S$1,288.00", "Marcus Lim Wei Jie", "hospital"),
    F("hg_priya_plan_jan", HG, 1, "HealthGuard Standard", "Priya Varghese HealthGuard Standard Restructured Class A S$500,000 S$1,104.00", "Priya Varghese", "hospital"),
    F("hg_policy_year_end", HG, 1, "2026-12-31", "Policy year 01 Jan 2026 to 31 Dec 2026", None, "hospital"),
    F("hg_std_ward", HG, 1, "Restructured hospital, Class A ward", "Ward entitlement Restructured hospital, Class A ward", None, "hospital"),
    F("hg_std_limit", HG, 1, "500,000", "Annual claim limit S$500,000 per insured per policy year", None, "hospital"),
    F("hg_std_deductible", HG, 1, "3,500", "Deductible S$3,500 per insured per policy year", None, "hospital"),
    F("hg_coins", HG, 1, "10%", "Co-insurance 10% of the claimable amount after deductible", None, "hospital"),
    F("hg_std_proration", HG, 1, "50%", "Treatment in a private hospital Eligible bill pro-rated to 50% before deductible and co-insurance", None, "hospital"),
    F("hg_std_pre", HG, 1, "90 days", "Pre-hospital treatment Up to 90 days before admission", None, "hospital"),
    F("hg_std_post", HG, 1, "180 days", "Post-hospital treatment Up to 180 days after discharge", None, "hospital"),
    F("hg_marcus_premium", HG, 1, "1,288.00", "S$1,288.00", "Marcus Lim Wei Jie", "hospital"),
    F("hg_priya_premium_std", HG, 1, "1,104.00", "S$1,104.00", "Priya Varghese", "hospital"),
    F("hg_claims_deadline", HG, 2, "90 days", "submitted within 90 days of discharge", None, "hospital"),
    F("hg_upgrade_date", HE, 1, "2026-07-01", "Endorsement effective date 01 Jul 2026", "Priya Varghese", "hospital"),
    F("hg_priya_new_plan", HE, 1, "HealthGuard Premier", "Priya Varghese HealthGuard Standard HealthGuard Premier", "Priya Varghese", "hospital"),
    F("hg_marcus_unchanged", HE, 1, "No change (HealthGuard Standard)", "Marcus Lim Wei Jie HealthGuard Standard No change (HealthGuard Standard)", "Marcus Lim Wei Jie", "hospital"),
    F("hg_prem_ward", HE, 1, "Private hospital, standard room", "Ward entitlement Private hospital, standard room", "Priya Varghese", "hospital"),
    F("hg_prem_limit", HE, 1, "2,000,000", "Annual claim limit S$2,000,000 per policy year", "Priya Varghese", "hospital"),
    F("hg_prem_deductible", HE, 1, "3,500", "Deductible S$3,500 per policy year", "Priya Varghese", "hospital"),
    F("hg_prem_noproration", HE, 1, "None - no pro-ration for private hospitals", "Pro-ration None - no pro-ration for private hospitals", "Priya Varghese", "hospital"),
    F("hg_prem_pre", HE, 1, "180 days", "Pre-hospital treatment Up to 180 days before admission", "Priya Varghese", "hospital"),
    F("hg_prem_post", HE, 1, "365 days", "Post-hospital treatment Up to 365 days after discharge", "Priya Varghese", "hospital"),
    F("hg_priya_new_premium", HE, 1, "2,416.00", "Revised annual premium (Priya Varghese) S$2,416.00", "Priya Varghese", "hospital"),
    F("hg_additional_premium", HE, 1, "656.00", "Additional premium, 01 Jul 2026 to 31 Dec 2026 S$656.00", "Priya Varghese", "hospital"),
    F("hg_rule_admission_before", HE, 2, "HealthGuard Standard", "Hospital admissions that begin before 01 Jul 2026 are assessed under HealthGuard Standard, even if the stay continues after that date", "Priya Varghese", "hospital"),
    F("hg_rule_preexisting_upgrade", HE, 2, "HealthGuard Standard terms", "do not apply to any condition diagnosed, treated or showing symptoms before 01 Jul 2026. Such conditions continue to be covered on HealthGuard Standard terms", "Priya Varghese", "hospital"),
    F("hg_rule_deductible_carry", HE, 2, "counts towards", "Any deductible already met in this policy year counts towards the HealthGuard Premier deductible", "Priya Varghese", "hospital"),
    # CI
    F("ci_life_assured", CI, 1, "Marcus Lim Wei Jie", "Life assured Marcus Lim Wei Jie", "Marcus Lim Wei Jie", "ci", aliases=["CI MultiProtect", "Orchidia", "critical illness"]),
    F("ci_nominee", CI, 1, "Priya Varghese", "Nomination Revocable nomination - Priya Varghese (100%)", "Marcus Lim Wei Jie", "ci"),
    F("ci_sa", CI, 1, "200,000", "Sum assured S$200,000", "Marcus Lim Wei Jie", "ci", aliases=["CI MultiProtect", "Orchidia", "critical illness"]),
    F("ci_start", CI, 1, "2023-04-01", "Commencement date 01 Apr 2023", "Marcus Lim Wei Jie", "ci"),
    F("ci_end", CI, 1, "2054-04-01", "Cover ends 01 Apr 2054 (policy anniversary after age 75)", "Marcus Lim Wei Jie", "ci"),
    F("ci_premium", CI, 1, "2,976.00", "Annual premium S$2,976.00", "Marcus Lim Wei Jie", "ci"),
    F("ci_early", CI, 1, "50,000", "Early stage 25% S$50,000 1 claim per condition group", "Marcus Lim Wei Jie", "ci", aliases=["25%"]),
    F("ci_inter", CI, 1, "100,000", "Intermediate stage 50% S$100,000 1 claim per condition group", "Marcus Lim Wei Jie", "ci", aliases=["50%"]),
    F("ci_severe", CI, 1, "200,000", "Severe stage 100% S$200,000 per condition group", "Marcus Lim Wei Jie", "ci"),
    F("ci_angio", CI, 1, "20,000", "Angioplasty (special benefit) 10% S$20,000 capped at S$25,000; 1 claim", "Marcus Lim Wei Jie", "ci"),
    F("ci_cap", CI, 1, "600,000", "capped at 300% of the sum assured, i.e. S$600,000", "Marcus Lim Wei Jie", "ci"),
    F("ci_rule_offset", CI, 2, "less any early-stage or intermediate-stage amount already paid", "paid less any early-stage or intermediate-stage amount already paid for the same condition", None, "ci"),
    F("ci_waiting", CI, 2, "90 days", "within 90 days of the commencement date or reinstatement date", None, "ci"),
    F("ci_survival", CI, 2, "7 days", "must survive 7 days after diagnosis", None, "ci"),
    F("ci_gap", CI, 2, "12 months", "at least 12 months between the dates of diagnosis", None, "ci"),
    F("ci_recur", CI, 2, "24 months", "only if 24 months have passed since the last cancer claim", None, "ci"),
    F("ci_dengue_excluded", CI, 2, "not covered", "including infectious diseases such as dengue fever, is not covered under this policy", None, "ci", aliases=["dengue"]),
    F("ci_cancer_early", CI, 3, "Carcinoma in situ", "1 Cancer Carcinoma in situ Early organ cancer Major Cancer", None, "ci"),
    F("ci_stroke_partial", CI, 3, "Stroke, partial deficit", "3 Brain Minor brain surgery Stroke, partial deficit Stroke with permanent deficit", None, "ci"),
    # PA
    F("pa_policy_no", PA, 1, "HG-PA-3309184", "Policy number HG-PA-3309184", None, "pa", aliases=["FamilyPA", "Harbourline"]),
    F("pa_policyholder", PA, 1, "Priya Varghese", "Policyholder Priya Varghese", "Priya Varghese", "pa"),
    F("pa_start", PA, 1, "2026-02-01", "Period of insurance 01 Feb 2026 to 31 Jan 2027", None, "pa", aliases=["FamilyPA", "Harbourline"]),
    F("pa_end", PA, 1, "2027-01-31", "Period of insurance 01 Feb 2026 to 31 Jan 2027", None, "pa", aliases=["FamilyPA", "Harbourline"]),
    F("pa_premium", PA, 1, "486.00", "Annual premium S$486.00", None, "pa"),
    F("pa_insured_list", PA, 1, "Priya Varghese, Marcus Lim Wei Jie, Kavya Nair, Rohan Nair",
      ["Priya Varghese Adult", "Marcus Lim Wei Jie Adult", "Kavya Nair Child", "Rohan Nair Child"], None, "pa",
      check_value=False, absent_from_doc=["Aiden", "Maricel"], aliases=["Kavya", "Rohan", "Priya", "Marcus", "FamilyPA", "Harbourline"]),
    F("pa_adb_adult", PA, 1, "150,000", "Accidental death & permanent disablement S$150,000 S$30,000", None, "pa"),
    F("pa_adb_child", PA, 1, "30,000", "Accidental death & permanent disablement S$150,000 S$30,000", None, "pa"),
    F("pa_ame_adult", PA, 1, "3,000", "Accidental medical expenses (per policy year) S$3,000 S$1,500", None, "pa"),
    F("pa_ame_child", PA, 1, "1,500", "Accidental medical expenses (per policy year) S$3,000 S$1,500", None, "pa"),
    F("pa_physio_adult", PA, 1, "500", "of which physiotherapy / TCM S$500 S$300", None, "pa"),
    F("pa_physio_child", PA, 1, "300", "of which physiotherapy / TCM S$500 S$300", None, "pa"),
    F("pa_dhi", PA, 1, "100", "Daily hospital income (max 30 days) S$100 per day S$100 per day", None, "pa", aliases=["30 days"]),
    F("pa_mobility", PA, 1, "500", "Mobility aids S$500 S$500", None, "pa"),
    F("pa_aggregate_rule", PA, 1, "aggregate limit per insured person per policy year", "Accidental medical expenses is an aggregate limit per insured person per policy year", None, "pa"),
    F("pa_named_only", PA, 2, "Only persons named in this Schedule are insured", "Only persons named in this Schedule are insured; other family members are not covered unless added by endorsement", None, "pa", aliases=["not named", "not covered"]),
    F("pa_child_age", PA, 2, "up to age 25 if in full-time education", "Children are covered up to age 18, or up to age 25 if in full-time education", None, "pa", aliases=["18"]),
    F("pa_accident_only", PA, 2, "accident-only policy", "illness or disease of any kind (this is an accident-only policy)", None, "pa", aliases=["accident", "not covered"]),
    F("pa_notify", PA, 2, "30 days", "Claims must be notified within 30 days of the accident", None, "pa"),
    # claim settlement
    F("cl_no", CL, 1, "HG-CL-26-004417", "Claim number HG-CL-26-004417", "Rohan Nair", "pa_claim"),
    F("cl_accident_date", CL, 1, "2026-04-03", "Date of accident 03 Apr 2026", "Rohan Nair", "pa_claim"),
    F("cl_desc", CL, 1, "fractured left wrist", "Fall during school PE lesson - fractured left wrist", "Rohan Nair", "pa_claim", aliases=["wrist"]),
    F("cl_settle_date", CL, 1, "2026-04-18", "Date of settlement 18 Apr 2026", "Rohan Nair", "pa_claim"),
    F("cl_paid", CL, 1, "640.00", "Total S$640.00 S$640.00", "Rohan Nair", "pa_claim"),
    F("cl_xray", CL, 1, "95.00", "X-ray S$95.00 S$95.00", "Rohan Nair", "pa_claim"),
    F("cl_rohan_remaining", CL, 1, "860.00", "Accidental medical expenses S$1,500.00 S$640.00 S$860.00", "Rohan Nair", "pa_claim"),
    F("cl_rohan_physio_remaining", CL, 1, "300.00", "Physiotherapy / TCM sub-limit S$300.00 S$0.00 S$300.00", "Rohan Nair", "pa_claim"),
    F("cl_followup", CL, 1, "2027-01-31", "Follow-up treatment for the same accident is claimable within the remaining limits above until 31 Jan 2027", "Rohan Nair", "pa_claim"),
    # travel
    F("tr_cert", TR, 1, "CB-SA-2026-118842", "Certificate number CB-SA-2026-118842", "Aiden Lim Jun Hao", "travel", aliases=["Student Abroad", "Crestbay"]),
    F("tr_policyholder", TR, 1, "Marcus Lim Wei Jie", "Policyholder Marcus Lim Wei Jie", "Aiden Lim Jun Hao", "travel"),
    F("tr_country", TR, 1, "Australia", "Country of study Australia", "Aiden Lim Jun Hao", "travel"),
    F("tr_start", TR, 1, "2026-02-10", "Period of insurance 10 Feb 2026 to 09 Feb 2027", "Aiden Lim Jun Hao", "travel"),
    F("tr_end", TR, 1, "2027-02-09", "Period of insurance 10 Feb 2026 to 09 Feb 2027", "Aiden Lim Jun Hao", "travel"),
    F("tr_premium", TR, 1, "1,380.00", "Premium paid S$1,380.00", "Aiden Lim Jun Hao", "travel"),
    F("tr_med", TR, 1, "250,000", "Overseas medical expenses S$250,000", "Aiden Lim Jun Hao", "travel", aliases=["Student Abroad", "Crestbay"]),
    F("tr_evac", TR, 1, "500,000", "Emergency medical evacuation and repatriation S$500,000", "Aiden Lim Jun Hao", "travel"),
    F("tr_study", TR, 1, "15,000", "Study interruption (forfeited tuition fees) S$15,000", "Aiden Lim Jun Hao", "travel"),
    F("tr_belongings", TR, 1, "3,000", "Personal belongings S$3,000 (S$750 per item; laptop S$1,500)", "Aiden Lim Jun Hao", "travel"),
    F("tr_item", TR, 1, "750", "S$750 per item", "Aiden Lim Jun Hao", "travel"),
    F("tr_laptop", TR, 1, "1,500", "laptop S$1,500", "Aiden Lim Jun Hao", "travel"),
    F("tr_passport", TR, 1, "500", "Loss of passport S$500", "Aiden Lim Jun Hao", "travel"),
    F("tr_liability", TR, 1, "500,000", "Personal liability S$500,000", "Aiden Lim Jun Hao", "travel"),
    F("tr_compassionate", TR, 1, "7,500", "Compassionate visit by a family member S$7,500", "Aiden Lim Jun Hao", "travel"),
    F("tr_excess", TR, 1, "100", "Excess S$100 per medical claim; nil for evacuation", "Aiden Lim Jun Hao", "travel"),
    F("tr_oshc", TR, 2, "OSHC", "medical expenses recoverable under the Overseas Student Health Cover (OSHC)", "Aiden Lim Jun Hao", "travel", aliases=["balance"]),
    F("tr_sg_suspended", TR, 2, "suspended", "Cover is suspended while the insured student is in Singapore", "Aiden Lim Jun Hao", "travel"),
    F("tr_third_country", TR, 2, "21 days", "covered for up to 21 days per trip", "Aiden Lim Jun Hao", "travel"),
    F("tr_preexisting", TR, 2, "not covered", "Pre-existing medical conditions are not covered", "Aiden Lim Jun Hao", "travel"),
    F("tr_fulltime", TR, 2, "30 days", "cover ends 30 days after the student stops full-time study", "Aiden Lim Jun Hao", "travel"),
    # maid
    F("md_policy", MD, 1, "KG-MI-8806521", "Policy number KG-MI-8806521", "Maricel Dela Cruz", "maid", aliases=["HelperCare", "maid insurance"]),
    F("md_employer", MD, 1, "Marcus Lim Wei Jie", "Policyholder (employer) Marcus Lim Wei Jie", "Maricel Dela Cruz", "maid"),
    F("md_insured", MD, 1, "Maricel Dela Cruz", "Insured helper Maricel Dela Cruz", "Maricel Dela Cruz", "maid", aliases=["HelperCare", "maid insurance"]),
    F("md_start", MD, 1, "2025-11-15", "Period of insurance 15 Nov 2025 to 14 Jan 2028", "Maricel Dela Cruz", "maid"),
    F("md_end", MD, 1, "2028-01-14", "Period of insurance 15 Nov 2025 to 14 Jan 2028", "Maricel Dela Cruz", "maid"),
    F("md_premium", MD, 1, "398.00", "Premium (26 months) S$398.00", "Maricel Dela Cruz", "maid"),
    F("md_pa", MD, 1, "60,000", "Personal accident (death / permanent disablement) S$60,000", "Maricel Dela Cruz", "maid"),
    F("md_hosp", MD, 1, "15,000", "Hospital and surgical expenses S$15,000 per year of cover", "Maricel Dela Cruz", "maid"),
    F("md_outpatient", MD, 1, "Not covered", "Outpatient clinic visits Not covered", "Maricel Dela Cruz", "maid"),
    F("md_wages", MD, 1, "40", "Wages and levy reimbursement while hospitalised S$40 per day, up to 30 days", "Maricel Dela Cruz", "maid"),
    F("md_repat", MD, 1, "10,000", "Repatriation of mortal remains S$10,000", "Maricel Dela Cruz", "maid"),
    F("md_bond", MD, 1, "5,000", "Security bond guarantee (to MOM) S$5,000", "Maricel Dela Cruz", "maid"),
    F("md_year1_end", MD, 1, "2026-11-14", "Year of cover 1: 15 Nov 2025 to 14 Nov 2026", "Maricel Dela Cruz", "maid"),
    F("md_year2_start", MD, 1, "2026-11-15", "Year of cover 2: 15 Nov 2026 to 14 Jan 2028", "Maricel Dela Cruz", "maid"),
    F("md_exclusions", MD, 2, "pregnancy and childbirth", "Pre-existing conditions, and pregnancy and childbirth, are excluded", "Maricel Dela Cruz", "maid", aliases=["excluded"]),
    F("md_family_not", MD, 2, "not insured", "Members of the employer's family are not insured under this policy", None, "maid"),
]

# ============================================================ derived
def pay(bill, pr, ded, co):
    return round((bill * pr - ded) * (1 - co), 2)

DERIVED = [
    DV("dv_priya_may_16k", 4050, ["hg_std_proration", "hg_std_deductible", "hg_coins", "hg_rule_admission_before"],
       lambda V: pay(16000, 0.5, V("hg_std_deductible"), 0.10),
       "Priya, private hospital, admitted before 01 Jul 2026 (Standard): 16,000 x 50% = 8,000; -3,500 = 4,500; less 10% = 4,050."),
    DV("dv_priya_may_16k_oop", 11950, ["dv_priya_may_16k"], lambda V: 16000 - V("dv_priya_may_16k"), "16,000 - 4,050"),
    DV("dv_priya_aug_16k", 11250, ["hg_prem_deductible", "hg_coins", "hg_prem_noproration"],
       lambda V: pay(16000, 1.0, V("hg_prem_deductible"), 0.10),
       "Priya on Premier (admitted on/after 01 Jul 2026, new condition): 16,000 - 3,500 = 12,500; less 10% = 11,250."),
    DV("dv_priya_aug_16k_oop", 4750, ["dv_priya_aug_16k"], lambda V: 16000 - V("dv_priya_aug_16k"), "16,000 - 11,250"),
    DV("dv_marcus_private_16k", 4050, ["hg_std_proration", "hg_std_deductible", "hg_coins", "hg_marcus_unchanged"],
       lambda V: pay(16000, 0.5, V("hg_std_deductible"), 0.10), "Marcus stays on Standard: private bill pro-rated 50%."),
    DV("dv_marcus_classA_12k", 7650, ["hg_std_deductible", "hg_coins", "hg_std_ward"],
       lambda V: pay(12000, 1.0, V("hg_std_deductible"), 0.10), "12,000 - 3,500 = 8,500; less 10% = 7,650."),
    DV("dv_priya_premium_increase", 1312, ["hg_priya_new_premium", "hg_priya_premium_std"],
       lambda V: V("hg_priya_new_premium") - V("hg_priya_premium_std"), "2,416 - 1,104"),
    DV("dv_hosp_premium_total_now", 3704, ["hg_priya_new_premium", "hg_marcus_premium"],
       lambda V: V("hg_priya_new_premium") + V("hg_marcus_premium"), "2,416 + 1,288"),
    DV("dv_ci_severe_after_early", 150000, ["ci_severe", "ci_early", "ci_rule_offset"],
       lambda V: V("ci_severe") - V("ci_early"), "200,000 - 50,000 (R1 offset)"),
    DV("dv_ci_cap_left_after_early", 550000, ["ci_cap", "ci_early"], lambda V: V("ci_cap") - V("ci_early"), "600,000 - 50,000"),
    DV("dv_ci_wait_end", "2023-06-30", ["ci_start", "ci_waiting"],
       lambda V: __import__("datetime").date(2023, 4, 1) + __import__("datetime").timedelta(days=90), "01 Apr 2023 + 90 days"),
    DV("dv_pa_family_adb_total", 360000, ["pa_adb_adult", "pa_adb_child", "pa_insured_list"],
       lambda V: 2 * V("pa_adb_adult") + 2 * V("pa_adb_child"), "2 adults x 150,000 + 2 children x 30,000"),
    DV("dv_pa_adults_adb_total", 300000, ["pa_adb_adult"], lambda V: 2 * V("pa_adb_adult"), "2 x 150,000"),
    DV("dv_rohan_dhi_3", 300, ["pa_dhi"], lambda V: 3 * V("pa_dhi"), "3 days x S$100"),
    DV("dv_kavya_dhi_5", 500, ["pa_dhi"], lambda V: 5 * V("pa_dhi"), "5 days x S$100"),
    DV("dv_rohan_after_420", 440, ["cl_rohan_remaining"], lambda V: V("cl_rohan_remaining") - 420, "860 - 420"),
    DV("dv_rohan_physio_250_left", 50, ["cl_rohan_physio_remaining"], lambda V: V("cl_rohan_physio_remaining") - 250, "300 - 250", aliases=["250"]),
    DV("dv_rohan_after_physio_250", 610, ["cl_rohan_remaining"], lambda V: V("cl_rohan_remaining") - 250, "860 - 250"),
    DV("dv_rohan_physio_400_paid", 300, ["cl_rohan_physio_remaining"], lambda V: min(400, V("cl_rohan_physio_remaining")), "physio capped by 300 sub-limit"),
    DV("dv_aiden_oshc_balance", 800, ["tr_oshc", "tr_excess"], lambda V: 4000 - 3100 - V("tr_excess"), "4,000 bill - 3,100 OSHC - 100 excess"),
    DV("dv_tr_days_left", 126, ["tr_end"], lambda V: days_between("2026-10-06", "2027-02-09"), "06 Oct 2026 -> 09 Feb 2027"),
    DV("dv_pa_days_left", 117, ["pa_end"], lambda V: days_between("2026-10-06", "2027-01-31"), "06 Oct 2026 -> 31 Jan 2027"),
    DV("dv_md_year1_days_left", 39, ["md_year1_end"], lambda V: days_between("2026-10-06", "2026-11-14"), "06 Oct 2026 -> 14 Nov 2026"),
    DV("dv_md_wages_5", 200, ["md_wages"], lambda V: 5 * V("md_wages"), "5 days x S$40"),
    DV("dv_aiden_age", 20, ["m_aiden_dob"], lambda V: age_on("2006-07-21"), "age on 2026-10-06"),
    DV("dv_aiden_age_tr_end", 20, ["m_aiden_dob", "tr_end"], lambda V: age_on("2006-07-21", "2027-02-09"), "age on 2027-02-09"),
    DV("dv_kavya_age", 14, ["m_kavya_dob"], lambda V: age_on("2012-05-09"), "age on 2026-10-06"),
    DV("dv_rohan_age", 11, ["m_rohan_dob"], lambda V: age_on("2015-01-30"), "age on 2026-10-06"),
    DV("dv_marcus_age", 47, ["m_marcus_dob"], lambda V: age_on("1979-03-14"), "age on 2026-10-06"),
    DV("dv_priya_age", 43, ["m_priya_dob"], lambda V: age_on("1982-11-02"), "age on 2026-10-06"),
    DV("dv_kavya_child_until", "2030-05-09", ["m_kavya_dob", "pa_child_age"],
       lambda V: "2030-05-09", "Kavya turns 18 on 09 May 2030 (cover beyond needs full-time education)"),
    DV("dv_kids_ame_compare", 1500, ["pa_ame_child", "cl_rohan_remaining"], lambda V: V("pa_ame_child"),
       "Kavya has the full S$1,500 (no claim on file) vs Rohan S$860", aliases=["Kavya"]),
    DV("dv_laptop_2200_paid", 1500, ["tr_laptop"], lambda V: min(2200, V("tr_laptop")), "laptop capped at S$1,500"),
    DV("dv_phone_1100_paid", 750, ["tr_item"], lambda V: min(1100, V("tr_item")), "per item cap S$750"),
]

TRAPS = [
    {"id": "T1", "trap": "Only Priya was upgraded to Premier on 01 Jul 2026; Marcus remains on HealthGuard Standard (Class A, S$500,000, 50% private pro-ration).", "facts": ["hg_marcus_unchanged", "hg_priya_new_plan"]},
    {"id": "T2", "trap": "Two hospital schedules with different effective dates: admissions starting before 01 Jul 2026 use Standard terms even if the stay runs past 01 Jul.", "facts": ["hg_rule_admission_before"]},
    {"id": "T3", "trap": "Conditions with symptoms before the upgrade stay on Standard terms (no Premier benefit).", "facts": ["hg_rule_preexisting_upgrade"]},
    {"id": "T4", "trap": "Rohan's accidental medical limit is reduced by the S$640 already paid: S$860 remaining, not S$1,500. Physio sub-limit S$300 untouched.", "facts": ["cl_rohan_remaining", "cl_rohan_physio_remaining"]},
    {"id": "T5", "trap": "Aiden (20, full-time student) would be age-eligible but is NOT named on FamilyPA, so not covered; his Student Abroad plan is the relevant cover overseas.", "facts": ["pa_named_only", "pa_insured_list"]},
    {"id": "T6", "trap": "Maricel (helper) is covered only by HelperCare maid insurance, not by the family's PA or hospital plans; outpatient visits not covered.", "facts": ["md_insured", "md_outpatient", "pa_insured_list"]},
    {"id": "T7", "trap": "Step-children have different surnames (Kavya Nair, Rohan Nair; Aiden Lim). 'My son' is ambiguous with a shared login (Aiden or Rohan).", "facts": ["pa_insured_list", "tr_cert"]},
    {"id": "T8", "trap": "CI multi-pay: severe stage after early stage of the same condition pays S$150,000 (offset), not S$200,000; overall cap S$600,000.", "facts": ["dv_ci_severe_after_early", "ci_cap"]},
    {"id": "T9", "trap": "Angioplasty is 10% of S$200,000 = S$20,000 (cap S$25,000 is not the amount).", "facts": ["ci_angio"]},
    {"id": "T10", "trap": "Dengue is not a listed critical illness. Priya is CI nominee, not the life assured.", "facts": ["ci_dengue_excluded", "ci_nominee"]},
    {"id": "T11", "trap": "Student plan is suspended while Aiden is in Singapore and pays only the balance after OSHC (OSHC policy not uploaded).", "facts": ["tr_sg_suspended", "tr_oshc"]},
    {"id": "T12", "trap": "FamilyPA is accident-only: illness hospitalisation pays nothing under it.", "facts": ["pa_accident_only"]},
]

NOT_UPLOADED = [
    "Aiden's Overseas Student Health Cover (OSHC) policy (referred to by the Student Abroad plan, not uploaded)",
    "MediShield Life / CPF / MediSave statements for any member",
    "School or student group insurance for Kavya or Rohan",
    "Any motor, home or travel policy other than Aiden's Student Abroad plan",
    "Any life, CI or hospital policy for the children; any life or CI policy for Priya",
]

META = {
    "label": "H4 - blended family with helper",
    "description": "Remarried couple Marcus Lim Wei Jie and Priya Varghese; Marcus's son Aiden Lim Jun Hao (studying in Australia); "
                   "Priya's children Kavya Nair and Rohan Nair; helper Maricel Dela Cruz. The app login is shared, so "
                   "'my son' / 'my plan' / 'I' are ambiguous unless the user identifies themselves.",
    "members": [
        {"id": "marcus", "name": "Marcus Lim Wei Jie", "relation": "husband; father of Aiden; step-father of Kavya and Rohan", "dob": "1979-03-14"},
        {"id": "priya", "name": "Priya Varghese", "relation": "wife; mother of Kavya and Rohan; step-mother of Aiden", "dob": "1982-11-02"},
        {"id": "aiden", "name": "Aiden Lim Jun Hao", "relation": "Marcus's son (Priya's step-son); full-time student in Australia", "dob": "2006-07-21"},
        {"id": "kavya", "name": "Kavya Nair", "relation": "Priya's daughter (Marcus's step-daughter)", "dob": "2012-05-09"},
        {"id": "rohan", "name": "Rohan Nair", "relation": "Priya's son (Marcus's step-son)", "dob": "2015-01-30"},
        {"id": "maricel", "name": "Maricel Dela Cruz", "relation": "foreign domestic worker (helper) employed by Marcus", "dob": "1990-08-17"},
    ],
}

# ============================================================ battery
B = Battery("H4")
q = B.q

# --- hospital plan
q("hosp_marcus_plan", "answer", ["hg_marcus_plan", "hg_marcus_unchanged", "hg_std_ward"], ["Standard"], [
    "What hospital plan is Marcus on now?",
    ("marcus hosp plan still the standard one or got upgrade?", "singlish"),
    "Did my husband's hospital plan also get upgraded in July?",
    ("wat ward class is marcus entitled to under healthguard", "typo"),
])
q("hosp_priya_now", "answer", ["hg_priya_new_plan", "hg_upgrade_date", "hg_prem_ward"], ["Premier"], [
    "Which HealthGuard plan is Priya on currently?",
    ("my wife hospital plan now is which one ah", "singlish"),
    "Is Priya covered for a private hospital now?",
])
q("hosp_upgrade_date", "answer", ["hg_upgrade_date"], ["@2026-07-01"], [
    "From what date did Priya's upgrade take effect?",
    ("when did the premier upgrade start", "typo"),
])
q("hosp_why_limit_changed", "answer", ["hg_upgrade_date", "hg_prem_limit", "hg_std_limit"], ["2,000,000|2 million|2m|2mil"], [
    "Why does Priya's annual limit show $2 million in one document but $500k in the January schedule?",
    ("eh why priya limit jump from 500k to 2 mil??", "singlish", "why"),
    "The two Kestrel documents give different hospital limits for my wife. Which one is right today?",
])
q("hosp_priya_may_16k", "compute", ["hg_rule_admission_before", "hg_std_proration", "hg_std_deductible", "hg_coins", "dv_priya_may_16k"],
  ["4,050"], [
    "Priya was admitted to a private hospital on 12 May 2026 and the bill was S$16,000. It's her first claim this policy year. Roughly how much will Kestrel pay?",
    ("priya warded private hosp in may, bill 16k, never claim before this yr. how much can get back?", "singlish"),
  ], forbidden=["11,250"])
q("hosp_priya_aug_16k", "compute", ["hg_upgrade_date", "hg_prem_noproration", "hg_prem_deductible", "hg_coins", "dv_priya_aug_16k"],
  ["11,250"], [
    "If Priya is admitted to a private hospital in August 2026 for a new condition with a S$16,000 bill (no earlier claim this year), what would Kestrel pay?",
    ("aug private hospital 16k bill for priya, new illness, first claim - payout?", "typo"),
  ], forbidden=["4,050"])
q("hosp_marcus_private_16k", "compute", ["hg_marcus_unchanged", "hg_std_proration", "hg_std_deductible", "hg_coins", "dv_marcus_private_16k"],
  ["4,050"], [
    "If Marcus goes to a private hospital next month and the bill is S$16,000 (no claim yet this year), how much does his plan pay?",
    ("marcus private hosp 16k next mth how much claimable", "singlish"),
  ], forbidden=["11,250"])
q("hosp_marcus_classA_12k", "compute", ["hg_std_ward", "hg_std_deductible", "hg_coins", "dv_marcus_classA_12k"], ["7,650"], [
    "Marcus stays in a Class A ward at a restructured hospital, bill S$12,000, first claim of the year. Estimated payout?",
    ("class A restructured, 12k bill, marcus, how much kestrel pay", "typo"),
  ])
q("hosp_straddle", "answer", ["hg_rule_admission_before"], ["Standard"], [
    "Priya was admitted on 28 June and discharged on 3 July. Is that stay under Standard or Premier?",
    ("admitted 28 jun discharge 3 jul for my wife - old plan or new plan?", "singlish"),
  ], forbidden=["11,250"])
q("hosp_preexisting_upgrade", "answer", ["hg_rule_preexisting_upgrade", "hg_std_proration"], ["Standard"], [
    "Priya's knee pain started in March and she's planning surgery at a private hospital in November. Will Premier cover it in full?",
    ("knee problem since march, op in nov at private hosp - can use the new premier benefits?", "singlish"),
  ])
q("hosp_deductible", "answer", ["hg_std_deductible", "hg_prem_deductible"], ["3,500"], [
    "What's the deductible on our HealthGuard plan?",
    ("deductable for kestrel hospital plan how much", "typo"),
    "Did the deductible change when Priya upgraded?",
])
q("hosp_deductible_carry", "answer", ["hg_rule_deductible_carry"], ["counts towards"], [
    "Priya already paid her deductible in May. Does she have to pay a new deductible under Premier this year?",
])
q("hosp_coins", "answer", ["hg_coins"], ["10%"], [
    "What co-insurance percentage applies on the Kestrel plan?",
    ("coinsurance for hospital plan how many percent", "typo"),
])
q("hosp_post_both", "answer", ["hg_std_post", "hg_prem_post"], ["180", "365"], [
    "How long after discharge are follow-up visits covered under our hospital plan, for each of us?",
], note="Both 180 days (Marcus, Standard) and 365 days (Priya, Premier) should be stated.")
q("hosp_post_priya", "answer", ["hg_prem_post"], ["365"], [
    "How many days of post-hospital treatment does Priya get now?",
    ("post hosp for priya how many days", "singlish"),
], forbidden=["180 days"])
q("hosp_pre_marcus", "answer", ["hg_std_pre"], ["90"], [
    "How many days before admission are Marcus's pre-hospital bills covered?",
], forbidden=["180 days"])
q("hosp_upgrade_cost", "compute", ["hg_additional_premium", "dv_priya_premium_increase"], ["656|1,312"], [
    "How much extra are we paying for Priya's upgrade?",
    ("upgrade cost how much more", "singlish"),
])
q("hosp_total_premium", "compute", ["dv_hosp_premium_total_now", "hg_priya_new_premium", "hg_marcus_premium"], ["3,704"], [
    "What's the total annual HealthGuard premium for both of us now?",
    ("total hosp premium per yr for marcus + priya now", "typo"),
])
q("hosp_limit_marcus", "answer", ["hg_std_limit", "hg_marcus_plan"], ["500,000"], [
    "What's Marcus's annual claim limit?",
], forbidden=["2,000,000"])
q("hosp_claim_deadline", "answer", ["hg_claims_deadline"], ["90 days"], [
    "How soon after discharge must we submit a hospital claim to Kestrel?",
])
q("hosp_kids", "not_covered", ["hg_marcus_plan", "hg_priya_plan_jan"], ["Marcus|Priya"], [
    "Are Kavya and Rohan covered under the HealthGuard hospital plan?",
    ("kids got hospital plan under kestrel or not", "singlish"),
], note="Only Marcus and Priya are insured persons on the HealthGuard schedule.")
q("hosp_policy_no", "answer", ["hg_policy_no"], ["KL-HG-5520417"], [
    "What's our Kestrel hospital policy number?",
])

# --- CI
q("ci_sa", "answer", ["ci_sa"], ["200,000"], [
    "What's the sum assured on Marcus's critical illness plan?",
    ("marcus CI cover how much", "singlish"),
])
q("ci_early", "answer", ["ci_early"], ["50,000"], [
    "How much does the CI MultiProtect pay for an early-stage illness?",
    ("early stage CI payout?", "typo"),
])
q("ci_inter", "answer", ["ci_inter"], ["100,000"], [
    "What does Marcus get for an intermediate-stage condition?",
])
q("ci_severe_after_early", "compute", ["dv_ci_severe_after_early", "ci_rule_offset"], ["150,000"], [
    "If Marcus is first diagnosed with carcinoma in situ and later it becomes major cancer, how much would the severe-stage claim pay?",
    ("early cancer claim first then later severe same cancer - how much more can get?", "singlish"),
])
q("ci_angio", "answer", ["ci_angio"], ["20,000"], [
    "How much is the angioplasty benefit on Marcus's CI plan?",
    ("if marcus do angioplasty how much payout", "singlish"),
])
q("ci_cap", "answer", ["ci_cap"], ["600,000"], [
    "What's the maximum total the CI MultiProtect can ever pay out?",
    ("overall cap for multi pay CI", "typo"),
])
q("ci_cap_left", "compute", ["dv_ci_cap_left_after_early"], ["550,000"], [
    "After an early-stage payout, how much of the overall CI cap would be left?",
])
q("ci_waiting_passed", "compute", ["ci_start", "ci_waiting", "dv_ci_wait_end"], ["90"], [
    "Does the cancer waiting period still apply to Marcus's CI policy?",
    ("still got waiting period for heart attack claim on marcus CI?", "singlish"),
])
q("ci_gap", "answer", ["ci_gap"], ["12 months"], [
    "After one CI claim, how long before Marcus can claim for a different, unrelated illness?",
])
q("ci_recur", "answer", ["ci_recur"], ["24 months"], [
    "If the same cancer comes back, when can it be claimed again?",
])
q("ci_survival", "answer", ["ci_survival"], ["7 days"], [
    "Is there a survival period on the CI plan?",
])
q("ci_dengue", "not_covered", ["ci_dengue_excluded"], ["not covered"], [
    "Marcus got dengue and was warded 4 days. Can he claim on his CI plan?",
    ("dengue considered critical illness or not??", "singlish"),
], forbidden=["50,000", "200,000"])
q("ci_end", "answer", ["ci_end"], ["@2054-04-01|2054"], [
    "Until when is Marcus covered under the Orchidia CI plan?",
])
q("ci_premium", "answer", ["ci_premium"], ["2,976"], [
    "How much is the CI premium each year?",
])
q("ci_priya_insured", "not_covered", ["ci_life_assured", "ci_nominee"], ["Marcus"], [
    "Is Priya covered under the Orchidia CI plan? Her name is on it.",
    ("priya name inside the CI doc, means she also covered right?", "singlish"),
], note="Priya is only the nominee; Marcus is the life assured.")
q("ci_nominee", "answer", ["ci_nominee"], ["Priya"], [
    "Who is the nominee on Marcus's CI policy?",
])
q("ci_stroke_partial", "answer", ["ci_stroke_partial", "ci_inter"], ["100,000"], [
    "Marcus had a stroke with partial deficit. Which stage is that and how much would it pay?",
])

# --- PA
q("pa_rohan_remaining", "answer", ["cl_rohan_remaining", "cl_paid"], ["860"], [
    "How much accident medical cover does Rohan have left this year?",
    ("rohan accident medical balance left how much ah", "singlish"),
    ("how much left on rohans PA after the wrist claim", "typo"),
    "We already claimed for Rohan's wrist. What's left of his accidental medical expenses limit?",
])
q("pa_rohan_why_860", "answer", ["cl_rohan_remaining", "cl_paid", "pa_ame_child"], ["640"], [
    "Why does Rohan only have $860 left when the PA schedule says children get $1,500?",
    ("why rohan limit not 1500??", "why", "singlish"),
])
q("pa_rohan_physio", "answer", ["cl_rohan_physio_remaining"], ["300"], [
    "How much can Rohan still claim for physio?",
    ("rohan physio limit still have?", "singlish"),
])
q("pa_rohan_new_420", "compute", ["dv_rohan_after_420", "cl_rohan_remaining"], ["440"], [
    "If Rohan has another S$420 follow-up bill for the wrist, how much accident medical limit is left after that?",
])
q("pa_kavya_ame", "answer", ["pa_ame_child", "pa_aggregate_rule"], ["1,500"], [
    "How much accidental medical cover does Kavya have?",
    ("kavya PA medical limit", "typo"),
])
q("pa_kids_compare", "compute", ["dv_kids_ame_compare", "cl_rohan_remaining"], ["Kavya"], [
    "Which of the two younger kids has more accident medical limit left this year?",
])
q("pa_aiden", "not_covered", ["pa_named_only", "pa_insured_list", "tr_med"], ["not named|only persons named"], [
    "Aiden fell skateboarding in Melbourne. Can we claim under FamilyPA?",
    ("aiden is 20 and full time student, so FamilyPA covers him right?", "singlish"),
    "Is Aiden one of the insured persons on the Harbourline PA?",
])
q("pa_maricel", "not_covered", ["pa_named_only", "md_insured", "md_pa"], ["HelperCare|maid insurance"], [
    "If our helper slips in the kitchen, can she claim under our family PA?",
    ("maricel fall down at home, use FamilyPA can?", "singlish"),
])
q("pa_illness", "not_covered", ["pa_accident_only"], ["accident"], [
    "Kavya was warded 2 days for food poisoning. Can we claim daily hospital income from FamilyPA?",
    ("can claim PA for fever hospitalisation?", "typo"),
], forbidden=["200"])
q("pa_rohan_dhi_3", "compute", ["dv_rohan_dhi_3", "pa_dhi"], ["300"], [
    "If Rohan is hospitalised 3 days after an accident, how much daily hospital income can we claim?",
])
q("pa_adb", "answer", ["pa_adb_adult", "pa_adb_child"], ["150,000"], [
    "What's the accidental death benefit for adults and children on FamilyPA?",
])
q("pa_family_total", "compute", ["dv_pa_family_adb_total"], ["360,000"], [
    "Add up the accidental death cover for everyone insured on FamilyPA. What's the total?",
    ("total accidental death payout whole family if all on the PA", "typo"),
])
q("pa_adults_total", "compute", ["dv_pa_adults_adb_total"], ["300,000"], [
    "Combined accidental death cover for Marcus and me on the PA?",
])
q("pa_end", "answer", ["pa_end"], ["@2027-01-31|@2027-02-01"], [
    "When does the FamilyPA policy expire?",
    ("PA renewal when", "singlish"),
])
q("pa_days_left", "compute", ["dv_pa_days_left", "pa_end"], ["117"], [
    "How many days until the FamilyPA period ends?",
])
q("pa_notify", "answer", ["pa_notify"], ["30 days"], [
    "How soon after an accident do we have to notify Harbourline?",
])
q("pa_policyholder", "answer", ["pa_policyholder"], ["Priya"], [
    "Who is the policyholder of the FamilyPA?",
])
q("pa_kavya_age_limit", "answer", ["pa_child_age", "dv_kavya_child_until"], ["18"], [
    "Until what age is Kavya covered as a child on the PA?",
])
q("pa_mobility", "answer", ["pa_mobility"], ["500"], [
    "Does FamilyPA pay for crutches or a wheelchair?",
])
q("pa_kids_covered", "answer", ["pa_insured_list"], ["Kavya", "Rohan"], [
    "Which of the kids are covered for accidents?",
    ("kids all covered for accident or not", "singlish"),
], note="Kavya and Rohan are named; Aiden is not.")
q("pa_xray", "answer", ["cl_xray"], ["95"], [
    "How much did Harbourline pay for Rohan's X-ray?",
])
q("pa_settle_date", "answer", ["cl_settle_date"], ["@2026-04-18"], [
    "When was Rohan's wrist claim paid?",
])

# --- travel
q("tr_med", "answer", ["tr_med"], ["250,000"], [
    "How much overseas medical cover does Aiden have?",
    ("aiden student insurance medical limit", "typo"),
])
q("tr_oshc_balance", "compute", ["dv_aiden_oshc_balance", "tr_oshc", "tr_excess"], ["800"], [
    "Aiden had a S$4,000 hospital bill in Melbourne and OSHC paid S$3,100. How much can we get from the Crestbay plan?",
    ("4k bill, OSHC cover 3.1k, crestbay pay the rest?", "singlish"),
])
q("tr_laptop", "compute", ["dv_laptop_2200_paid", "tr_laptop"], ["1,500"], [
    "Aiden's S$2,200 laptop was stolen from his dorm. How much can he claim?",
])
q("tr_phone", "compute", ["dv_phone_1100_paid", "tr_item"], ["750"], [
    "His S$1,100 phone was stolen too - how much for that?",
])
q("tr_in_sg", "not_covered", ["tr_sg_suspended"], ["suspended"], [
    "Aiden is coming home to Singapore for Christmas. If he falls sick here, does the student plan pay?",
    ("aiden back in sg for holidays, his travel insurance still cover him here?", "singlish"),
])
q("tr_bali", "answer", ["tr_third_country"], ["21 days"], [
    "Aiden wants to go to Bali for 2 weeks during term break. Is he covered?",
])
q("tr_end", "answer", ["tr_end"], ["@2027-02-09"], [
    "When does Aiden's student plan end?",
])
q("tr_days_left", "compute", ["dv_tr_days_left", "tr_end"], ["126"], [
    "How many days of cover are left on Aiden's student plan?",
    ("how many days more aiden insurance", "typo"),
])
q("tr_excess", "answer", ["tr_excess"], ["100"], [
    "What's the excess for a medical claim on Aiden's plan?",
])
q("tr_study", "answer", ["tr_study"], ["15,000"], [
    "If Aiden has to drop out of a semester because he's sick, is the tuition covered?",
])
q("tr_liability", "answer", ["tr_liability"], ["500,000"], [
    "Does Aiden's plan cover him if he accidentally damages his landlord's property?",
])
q("tr_compassionate", "answer", ["tr_compassionate"], ["7,500"], [
    "If Aiden is hospitalised in Australia, is there cover for me to fly over?",
])
q("tr_policyholder", "answer", ["tr_policyholder", "m_aiden_dob"], ["Marcus"], [
    "Who bought Aiden's student plan - whose name is the policyholder?",
])
q("tr_aiden_age_end", "compute", ["dv_aiden_age_tr_end"], ["20"], [
    "How old will Aiden be when his student plan ends?",
])
q("tr_preexisting", "not_covered", ["tr_preexisting"], ["not covered"], [
    "Aiden has had eczema since he was a kid. If it flares up in Melbourne, does Crestbay pay?",
])

# --- maid
q("md_hosp", "answer", ["md_hosp"], ["15,000"], [
    "What's Maricel's hospital and surgical limit?",
    ("helper hospital cover how much", "singlish"),
])
q("md_outpatient", "not_covered", ["md_outpatient"], ["Not covered"], [
    "Can Maricel's maid insurance pay for her GP visit for flu?",
    ("maid see doctor for cough, can claim insurance?", "singlish"),
])
q("md_reset", "answer", ["md_year2_start"], ["@2026-11-15"], [
    "When does Maricel's hospital limit reset?",
])
q("md_reset_days", "compute", ["dv_md_year1_days_left", "md_year1_end"], ["39"], [
    "How many days are left in Maricel's first year of cover?",
])
q("md_end", "answer", ["md_end"], ["@2028-01-14"], [
    "When does the maid insurance end?",
    ("helpercare expiry date", "typo"),
])
q("md_wages", "compute", ["dv_md_wages_5", "md_wages"], ["200"], [
    "If Maricel is hospitalised 5 days, how much wage and levy reimbursement can I get?",
])
q("md_pa", "answer", ["md_pa"], ["60,000"], [
    "What's the personal accident cover for our helper?",
])
q("md_bond", "answer", ["md_bond"], ["5,000"], [
    "Does the HelperCare policy include the security bond?",
])
q("md_employer", "answer", ["md_employer"], ["Marcus"], [
    "Whose name is the maid insurance under?",
])
q("md_pregnancy", "not_covered", ["md_exclusions"], ["excluded"], [
    "If Maricel gets pregnant, are her hospital bills covered by HelperCare?",
])
q("md_family", "not_covered", ["md_family_not"], ["not insured"], [
    "Can Kavya claim under the maid insurance if she gets hurt with the helper?",
])

# --- cross-policy / totals / dates
q("marcus_policies", "answer", ["hg_marcus_plan", "ci_life_assured", "pa_insured_list"], ["HealthGuard", "MultiProtect|critical illness|Orchidia", "FamilyPA|personal accident|Harbourline"], [
    "List all the policies Marcus is insured under.",
    ("wat policies cover marcus", "typo"),
])
q("aiden_policies", "answer", ["tr_cert", "pa_named_only"], ["Student Abroad|Crestbay"], [
    "What insurance does Aiden have?",
])
q("ages", "compute", ["dv_kavya_age", "dv_rohan_age"], ["14", "11"], [
    "How old are Kavya and Rohan now?",
])
q("marcus_age", "compute", ["dv_marcus_age"], ["47"], [
    "How old is Marcus as of today?",
])

# --- ambiguity -> clarify
q("clarify_my_son", "clarify", ["pa_insured_list", "m_aiden_dob"], [], [
    "My son broke his arm playing football. How much can I claim?",
    ("my boy fell down and fracture, how much can claim", "singlish"),
], forbidden=["860", "250,000"], note="Shared login: 'my son' could be Aiden (Marcus) or Rohan (Priya); the right policy differs.")
q("clarify_i_hospital", "clarify", [], [], [
    "I was hospitalised last week. How much can I claim?",
    ("i kena warded last week, how much can claim back", "singlish"),
], forbidden=["4,050", "11,250", "7,650"], note="Who is 'I' and what bill/ward is unknown.")
q("clarify_my_limit", "clarify", [], [], [
    "What's my annual hospital limit?",
], note="Marcus S$500,000 vs Priya S$2,000,000. Listing both and asking which person is acceptable.")
q("clarify_daughter_claim", "clarify", [], [], [
    "Can I claim for my kid's hospital stay?",
], forbidden=["300", "500"], note="Which child, accident or illness, and how many days are unknown.")

# --- not uploaded
q("nu_oshc", "not_uploaded", [], [], [
    "What's the excess on Aiden's OSHC policy?",
    ("how much OSHC cover aiden got", "typo"),
])
q("nu_medishield", "not_uploaded", [], [], [
    "How much will MediShield Life pay for Kavya's hospital stay?",
])
q("nu_car", "not_uploaded", [], [], [
    "When is our car insurance due for renewal?",
    ("car insurance NCD how much now", "typo"),
])
q("nu_priya_life", "not_uploaded", [], [], [
    "How much life insurance does Priya have?",
])
q("nu_school", "not_uploaded", [], [], [
    "What does Rohan's school insurance cover?",
])

# --- out of scope
q("oos_permit", "out_of_scope", [], [], [
    "Can you help me renew Maricel's work permit?",
    "What's the weather like in Melbourne this week?",
    "Write me a birthday message for Kavya.",
])

# --- advice
q("adv_upgrade_marcus", "advice_decline", [], [], [
    "Should Marcus also upgrade to Premier?",
    ("worth it to upgrade marcus hospital plan or not", "singlish"),
])
q("adv_ci_priya", "advice_decline", [], [], [
    "Should I buy a critical illness plan for Priya too?",
])
q("adv_cancel_travel", "advice_decline", [], [], [
    "Should we cancel Aiden's Crestbay plan since he has OSHC anyway?",
])

# --- claim start (single)
q("claim_rohan_physio", "claim_start", ["cl_rohan_physio_remaining", "pa_policy_no"], ["300"], [
    "I want to claim for Rohan's physio sessions for his wrist.",
])
q("claim_maricel_hosp", "claim_start", ["md_hosp", "md_policy"], ["HelperCare|KG-MI-8806521"], [
    "Our helper was admitted to hospital yesterday. I want to start a claim.",
])

# ============================================================ conversations
C = B.conv
C("Rohan wrist follow-up claim", [
    ("Hi, Rohan needs physio for the wrist he broke in April. Can we claim?", "claim_start", ["cl_rohan_physio_remaining", "cl_desc"], ["300"]),
    ("Which policy is that under?", "answer", ["pa_policy_no", "cl_no"], ["FamilyPA|HG-PA-3309184"]),
    ("How much did we already claim for the wrist?", "answer", ["cl_paid"], ["640"]),
    ("So how much accident medical is left for him?", "answer", ["cl_rohan_remaining"], ["860"]),
    ("The physio clinic billed S$250 for 5 sessions.", "claim_step", ["dv_rohan_physio_250_left", "cl_rohan_physio_remaining"], ["250"]),
    ("How much physio limit does he have after that?", "compute", ["dv_rohan_physio_250_left"], ["50"]),
    ("And the overall accident medical balance after this?", "compute", ["dv_rohan_after_physio_250"], ["610"]),
    ("Until when can we claim follow-up for this accident?", "answer", ["cl_followup"], ["@2027-01-31"]),
    ("What if he needs 3 more sessions next month at S$150?", "compute", ["dv_rohan_physio_250_left"], ["50"], [], "Only S$50 physio sub-limit remains."),
    ("ok thanks", "out_of_scope", [], []),
], tags=["claim", "pa", "remaining-limit"])
C("Switching child mid-claim (Rohan -> Aiden)", [
    ("My son got injured, want to claim", "clarify", [], [], ["860", "250,000"]),
    ("Rohan", "claim_step", ["pa_insured_list", "cl_rohan_remaining"], ["860"]),
    ("Wait sorry, not Rohan. It's Aiden, he sprained his ankle in Melbourne", "correction", ["tr_med", "pa_named_only"], ["Student Abroad|Crestbay"], ["860"]),
    ("Isn't he under the FamilyPA too?", "not_covered", ["pa_named_only", "pa_insured_list"], ["not named|only persons named"]),
    ("The clinic bill was S$4,000 and OSHC paid S$3,100", "compute", ["dv_aiden_oshc_balance"], ["800"]),
    ("why not 900?", "answer", ["tr_excess"], ["100"], [], "why-question about changed figure: S$100 excess."),
    ("What's his OSHC excess by the way?", "not_uploaded", [], []),
    ("Is there a deadline for the claim?", "not_uploaded", [], [], [], "Claim deadline for the Crestbay plan is not stated in the uploaded certificate."),
    ("ok and if he flies back to SG and gets worse here?", "not_covered", ["tr_sg_suspended"], ["suspended"]),
], tags=["claim", "correction", "switch-person", "travel"])
C("Priya hospital stay - date correction", [
    ("Priya was in a private hospital for a new condition, bill S$16,000, first claim this year. Admitted 10 August.", "compute", ["dv_priya_aug_16k"], ["11,250"], ["4,050"]),
    ("Sorry I got the date wrong, she was admitted 28 June and discharged 3 July.", "correction", ["hg_rule_admission_before", "dv_priya_may_16k"], ["4,050"], ["11,250"]),
    ("Why did the amount drop so much?", "answer", ["hg_rule_admission_before", "hg_std_proration"], ["50%"]),
    ("But her Premier started on 1 July and she was still in hospital then", "answer", ["hg_rule_admission_before"], ["Standard"]),
    ("So how much do we pay out of pocket?", "compute", ["dv_priya_may_16k_oop"], ["11,950"]),
    ("What's the deductible in that calculation?", "answer", ["hg_std_deductible"], ["3,500"]),
    ("If she goes back to hospital in November for the same problem, is that Premier?", "answer", ["hg_rule_preexisting_upgrade"], ["Standard"]),
    ("Does she need to pay the deductible again in November?", "answer", ["hg_rule_deductible_carry"], ["counts towards"]),
], tags=["hospital", "correction", "why", "date-reasoning"])
C("Marcus CI multi-pay walkthrough", [
    ("Marcus just got diagnosed with carcinoma in situ. Is that covered?", "answer", ["ci_cancer_early", "ci_early"], ["50,000"]),
    ("Any waiting period problem? Policy started in 2023.", "compute", ["ci_waiting", "ci_start"], ["90"]),
    ("Does the policy end after we claim?", "answer", ["ci_cap"], ["600,000"]),
    ("If it progresses to major cancer later, how much more?", "compute", ["dv_ci_severe_after_early"], ["150,000"]),
    ("Why not the full 200k?", "answer", ["ci_rule_offset"], ["less any early-stage or intermediate-stage amount already paid"]),
    ("And if he has a heart attack two years later?", "answer", ["ci_severe", "ci_gap"], ["200,000"]),
    ("What's the minimum gap between unrelated claims?", "answer", ["ci_gap"], ["12 months"]),
    ("How much cap is left after the first early-stage payout?", "compute", ["dv_ci_cap_left_after_early"], ["550,000"]),
    ("Should we make the claim now or wait until it's severe?", "advice_decline", [], []),
    ("Who would receive the money?", "answer", ["ci_life_assured", "ci_nominee"], ["Marcus|Priya"], [], "Living benefit is paid to the policy owner (Marcus); Priya is nominee."),
], tags=["ci", "multi-pay", "advice"])
C("Helper matters", [
    ("Maricel has a fever and needs to see a GP. Can I claim?", "not_covered", ["md_outpatient"], ["Not covered"]),
    ("What if she ends up hospitalised?", "answer", ["md_hosp"], ["15,000"]),
    ("Do I get anything for her days off?", "answer", ["md_wages"], ["40"]),
    ("She might be in hospital 5 days", "compute", ["dv_md_wages_5"], ["200"]),
    ("Can she use our FamilyPA if it was a fall?", "not_covered", ["pa_named_only", "md_insured", "md_pa"], ["HelperCare|maid insurance"]),
    ("When does her hospital limit refresh?", "answer", ["md_year2_start"], ["@2026-11-15"]),
    ("How many days from today?", "compute", ["dv_md_year1_days_left"], ["39"], [], "Year 1 ends 14 Nov 2026 (39 days); new limit 15 Nov."),
    ("And the whole policy ends when?", "answer", ["md_end"], ["@2028-01-14"]),
    ("Can you remind me to renew her work permit?", "out_of_scope", [], []),
], tags=["maid", "date-reasoning"])
C("Why did the hospital figures change", [
    ("Why are there two Kestrel hospital documents?", "answer", ["hg_upgrade_date", "hg_priya_new_plan"], ["Premier"]),
    ("What changed for Marcus?", "answer", ["hg_marcus_unchanged"], ["Standard"]),
    ("What's Priya's limit now vs before?", "answer", ["hg_prem_limit", "hg_std_limit"], ["2,000,000", "500,000"]),
    ("why priya premium so high now", "answer", ["hg_priya_new_premium", "hg_upgrade_date"], ["2,416"]),
    ("How much more is that per year?", "compute", ["dv_priya_premium_increase"], ["1,312"]),
    ("and the bill we already paid for this year?", "answer", ["hg_additional_premium"], ["656"]),
    ("Total hospital premium for both of us per year now?", "compute", ["dv_hosp_premium_total_now"], ["3,704"]),
    ("Is pro-ration still applied to Priya at private hospitals?", "answer", ["hg_prem_noproration"], ["no pro-ration|None"]),
    ("And to Marcus?", "answer", ["hg_std_proration"], ["50%"]),
], tags=["hospital", "why", "comparison"])
C("Aiden overseas student questions", [
    ("What insurance does Aiden have in Australia?", "answer", ["tr_cert", "tr_country"], ["Student Abroad|Crestbay"]),
    ("Medical limit?", "answer", ["tr_med"], ["250,000"]),
    ("Does he need OSHC as well?", "answer", ["tr_oshc"], ["OSHC"]),
    ("What does his OSHC cover?", "not_uploaded", [], []),
    ("He's planning a 2-week Bali trip in the break", "answer", ["tr_third_country"], ["21 days"]),
    ("What about a 4-week Japan trip instead?", "answer", ["tr_third_country"], ["21 days"], [], "Only first 21 days per trip covered."),
    ("When does the plan end?", "answer", ["tr_end"], ["@2027-02-09"]),
    ("How many days from today?", "compute", ["dv_tr_days_left"], ["126"]),
    ("If he stops full-time study in December, what happens?", "answer", ["tr_fulltime"], ["30 days"]),
    ("Should we buy a cheaper plan next year?", "advice_decline", [], []),
], tags=["travel", "date-reasoning", "not-uploaded"])
C("Family overview and totals", [
    ("Give me a quick overview of who is covered by what.", "answer", ["hg_marcus_plan", "pa_insured_list", "tr_cert", "md_insured"], ["HealthGuard", "FamilyPA|personal accident|Harbourline", "Student Abroad|Crestbay", "HelperCare"]),
    ("Which policies cover Kavya?", "answer", ["pa_insured_list"], ["FamilyPA|personal accident|Harbourline"]),
    ("Does she have any hospital plan?", "not_uploaded", [], [], [], "No hospital plan for Kavya among uploaded docs."),
    ("Total accidental death cover for everyone on the PA?", "compute", ["dv_pa_family_adb_total"], ["360,000"]),
    ("Why isn't Aiden included in that?", "answer", ["pa_named_only"], ["not named|only persons named"]),
    ("Which kid has more accident medical left?", "compute", ["dv_kids_ame_compare"], ["Kavya"]),
    ("By how much?", "compute", ["dv_kids_ame_compare", "cl_rohan_remaining"], ["640"]),
    ("What does the family pay for FamilyPA per year?", "answer", ["pa_premium"], ["486"]),
], tags=["overview", "totals", "comparison"])
C("Mixed not-uploaded and out-of-scope", [
    ("What does our car insurance cover?", "not_uploaded", [], []),
    ("Ok what about MediShield Life for the kids?", "not_uploaded", [], []),
    ("Then what CAN you see?", "answer", ["hg_policy_no", "ci_sa", "pa_policy_no", "tr_cert", "md_policy"], ["HealthGuard", "MultiProtect|critical illness|Orchidia", "FamilyPA|personal accident|Harbourline", "Student Abroad|Crestbay", "HelperCare"]),
    ("can you file the claim with Harbourline directly for me?", "out_of_scope", [], []),
    ("What's the best insurance company in Singapore?", "advice_decline", [], []),
    ("ok then how much is Priya's accident death benefit", "answer", ["pa_adb_adult"], ["150,000"]),
    ("and her life insurance?", "not_uploaded", [], []),
    ("thanks lah", "out_of_scope", [], []),
], tags=["not-uploaded", "out-of-scope"])
C("Advice requests", [
    ("Should I upgrade Marcus to Premier too?", "advice_decline", [], []),
    ("Ok just tell me the difference in limits then", "answer", ["hg_std_limit", "hg_prem_limit"], ["500,000", "2,000,000"]),
    ("And how much more would it cost?", "not_uploaded", [], [], [], "Marcus's Premier premium is not in any uploaded document; Priya's figures are hers."),
    ("Priya's upgrade cost how much extra per year?", "compute", ["dv_priya_premium_increase"], ["1,312"]),
    ("Is the CI plan good value?", "advice_decline", [], []),
    ("What's the CI premium?", "answer", ["ci_premium"], ["2,976"]),
    ("And sum assured?", "answer", ["ci_sa"], ["200,000"]),
    ("Should we surrender it?", "advice_decline", [], []),
], tags=["advice"])
C("Dengue for Marcus", [
    ("Marcus has dengue and is warded in a Class A ward at a restructured hospital.", "claim_start", ["hg_marcus_plan", "hg_std_ward"], ["HealthGuard"]),
    ("Can he claim critical illness too?", "not_covered", ["ci_dengue_excluded"], ["not covered"], ["50,000"]),
    ("What about the accident plan?", "not_covered", ["pa_accident_only"], ["accident"]),
    ("Bill is likely S$12,000, his first claim this year", "compute", ["dv_marcus_classA_12k"], ["7,650"]),
    ("How was that worked out?", "answer", ["hg_std_deductible", "hg_coins"], ["3,500", "10%"]),
    ("If he had gone private instead with the same 12k bill?", "compute", ["hg_std_proration", "hg_std_deductible"], ["50%"], ["7,650"], "6,000 - 3,500 = 2,500 less 10% = 2,250."),
    ("How long after discharge are follow-ups covered?", "answer", ["hg_std_post"], ["180"], ["365"]),
    ("Deadline to submit?", "answer", ["hg_claims_deadline"], ["90 days"]),
], tags=["hospital", "ci", "not-covered", "claim"])
C("Kavya accident claim", [
    ("Kavya fell off her bike and was admitted to hospital", "claim_start", ["pa_insured_list", "pa_ame_child"], ["FamilyPA|personal accident|Harbourline"]),
    ("She stayed 5 days", "compute", ["dv_kavya_dhi_5"], ["500"]),
    ("Plus medical bills of S$1,200", "claim_step", ["pa_ame_child"], ["1,200|1,500"]),
    ("Has she claimed anything before this year?", "answer", ["pa_ame_child", "cl_rohan_remaining"], ["1,500"], [], "No Kavya claim on file; only Rohan's."),
    ("What's her limit for physio afterwards?", "answer", ["pa_physio_child"], ["300"]),
    ("Can her hospital stay be claimed on Kestrel too?", "not_covered", ["hg_marcus_plan", "hg_priya_plan_jan"], ["Marcus|Priya"]),
    ("Within how many days must we notify?", "answer", ["pa_notify"], ["30 days"]),
    ("She's 14 right? Until when is she a 'child' on this?", "answer", ["pa_child_age", "dv_kavya_age"], ["18"]),
], tags=["claim", "pa"])
C("Singlish rapid-fire", [
    ("eh marcus hosp plan which one", "answer", ["hg_marcus_plan"], ["Standard"]),
    ("priya leh", "answer", ["hg_priya_new_plan"], ["Premier"]),
    ("since when", "answer", ["hg_upgrade_date"], ["@2026-07-01"]),
    ("rohan PA balance how much", "answer", ["cl_rohan_remaining"], ["860"]),
    ("aiden can use PA anot", "not_covered", ["pa_named_only"], ["not named|only persons named"]),
    ("maid GP visit can claim?", "not_covered", ["md_outpatient"], ["Not covered"]),
    ("CI got cover dengue?", "not_covered", ["ci_dengue_excluded"], ["not covered"]),
    ("aiden insurance end when", "answer", ["tr_end"], ["@2027-02-09"]),
    ("ok can help me book doctor?", "out_of_scope", [], []),
], tags=["singlish"])
C("Renewals and dates", [
    ("Which of our policies expire or renew in the next 4 months?", "compute", ["pa_end", "hg_policy_year_end"], ["@2027-01-31|@2027-02-01", "@2026-12-31|@2027-01-01"], [], "HealthGuard renews 01 Jan 2027 (policy year ends 31 Dec 2026); FamilyPA ends 31 Jan 2027. Aiden's plan (09 Feb 2027) is just over 4 months."),
    ("When does Aiden's plan end?", "answer", ["tr_end"], ["@2027-02-09"]),
    ("So which ends first, PA or Aiden's plan?", "compute", ["pa_end", "tr_end"], ["FamilyPA|personal accident|Harbourline"]),
    ("When did Marcus's CI start?", "answer", ["ci_start"], ["@2023-04-01"]),
    ("How old will Marcus be when it ends?", "compute", ["ci_end"], ["75"]),
    ("When does the helper's first year of cover end?", "answer", ["md_year1_end"], ["@2026-11-14"]),
    ("How old is Aiden now?", "compute", ["dv_aiden_age"], ["20"]),
    ("And Priya?", "compute", ["dv_priya_age"], ["43"]),
], tags=["date-reasoning"])
C("Long mixed session with corrections", [
    ("Hi, I'm Priya.", "out_of_scope", [], []),
    ("What's my hospital limit?", "answer", ["hg_prem_limit"], ["2,000,000"], ["500,000 per"]),
    ("And my deductible?", "answer", ["hg_prem_deductible"], ["3,500"]),
    ("Am I covered for accidents?", "answer", ["pa_insured_list", "pa_adb_adult"], ["FamilyPA|personal accident|Harbourline"]),
    ("What's my accident medical limit?", "answer", ["pa_ame_adult"], ["3,000"]),
    ("And for my son?", "answer", ["cl_rohan_remaining"], ["860"], [], "Priya's son is Rohan (Aiden is her step-son)."),
    ("No I meant my stepson", "correction", ["pa_named_only", "tr_med"], ["Student Abroad|Crestbay|not named"], ["860"]),
    ("ok what's his medical limit overseas", "answer", ["tr_med"], ["250,000"]),
    ("Am I covered under critical illness?", "not_covered", ["ci_life_assured", "ci_nominee"], ["Marcus"]),
    ("So what happens to the CI money if Marcus passes away?", "answer", ["ci_nominee"], ["Priya"]),
    ("If I get hospitalised in a private hospital next week with a new illness, bill S$16,000 and no claim this year?", "compute", ["dv_priya_aug_16k"], ["11,250"], ["4,050"]),
    ("Actually the condition started in May", "correction", ["hg_rule_preexisting_upgrade", "dv_priya_may_16k"], ["4,050"], ["11,250"]),
    ("why so different", "answer", ["hg_rule_preexisting_upgrade", "hg_std_proration"], ["Standard", "50%"]),
    ("Should I switch insurer?", "advice_decline", [], []),
    ("Ok thanks bye", "out_of_scope", [], []),
], tags=["long", "correction", "persona"])

if __name__ == "__main__":
    build("H4", META, DOCS, FACTS, DERIVED, TRAPS, B, NOT_UPLOADED)

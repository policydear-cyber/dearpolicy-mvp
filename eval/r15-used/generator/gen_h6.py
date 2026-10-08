"""H6 - young professional (Ethan Yeo Zhi Hao). Prints ALL FACTS VERIFIED."""
from common import Doc, F, DV, Battery, build, days_between, age_on

def mk(name, issuer, doc_title, ref, **meta):
    x = Doc(name, issuer, doc_title, ref)
    x.meta = meta
    return x

FB = "aurelion_flexben_booklet_2026.pdf"
EN = "aurelion_flexben_enrolment_ethan.pdf"
MR = "pelican_homeshield_mrt_ethan.pdf"
PET = "tembusu_pawsure_mochi.pdf"
CAR = "tembusu_drivesafe_motor_ethan.pdf"
HC = "pelican_dailycare_hospital_cash.pdf"
GB = "scan_0915.pdf"
TV = "tembusu_travelease_annual_2025.pdf"

# ---------------------------------------------------------------- flexben booklet
fb = mk(FB, "Aurelion Analytics Pte Ltd", "FlexBen 2026 - Employee Benefits Booklet", "HR-BEN-2026-01",
        title="FlexBen 2026 employee benefits booklet (options, not elections)", insurer="Group insurer via Aurelion Analytics (employer)",
        product="FlexBen 2026", policy_no=None, policyholder="Aurelion Analytics Pte Ltd", insured=["all confirmed employees"],
        type="employer flexible benefits booklet", status="plan year 2026")
fb.page().h("FlexBen 2026 - How it works").p(
    "Every confirmed employee receives 1,000 FlexPoints for the plan year 01 Jan 2026 to 31 Dec 2026. Use FlexPoints to "
    "choose benefit options below. The options you actually chose are shown in your personal Enrolment Confirmation.").p(
    "Unused FlexPoints are converted to your Wellness Spending Account at S$0.80 per point. Wellness claims (gym, health "
    "screening, sports equipment) must be submitted by 31 Jan 2027.").p(
    "If no election is made by the enrolment deadline of 05 Dec 2025, default options apply and all FlexPoints convert "
    "to the Wellness Spending Account.").p(
    "Elections are locked for the plan year. Changes are allowed only within 30 days of a qualifying life event "
    "(marriage, birth or adoption of a child).").p(
    "All cover ends on the last day of employment.")
fb.page().h("FlexBen 2026 - Options and FlexPoint costs").table([50, 165, 215, 470], [
    ["Category", "Option", "Cover", "Points"],
    ["Hospital & Surgical", "H1 (default)", "Ward B1, annual limit S$40,000", "0"],
    ["Hospital & Surgical", "H2", "Ward A (restructured), annual limit S$80,000", "180"],
    ["Hospital & Surgical", "H3", "Private hospital, annual limit S$150,000", "420"],
    ["Outpatient GP", "Standard (default)", "Panel GP, S$10 co-payment per visit", "0"],
    ["Dental", "D1", "S$300 per year", "150"],
    ["Dental", "D2", "S$600 per year", "280"],
    ["Optical", "O1", "S$200 per year", "90"],
    ["Group Term Life", "Core (default)", "S$100,000", "0"],
    ["Group Term Life", "Top-up unit", "+S$100,000 per unit (max 3 units)", "120 per unit"],
    ["Group Critical Illness", "CI1", "S$50,000", "200"],
    ["Business Travel", "Automatic", "Company-authorised trips, medical S$500,000", "0"],
], size=8.4)
fb.page().h("FlexBen 2026 - Key terms").p(
    "Group Hospital & Surgical: no deductible or co-insurance. Bills are settled with the hospital through a letter of "
    "guarantee, up to the annual limit of the option chosen. Pre-existing conditions are covered after 12 months of "
    "continuous cover.").p(
    "Group Critical Illness (CI1) applies only to employees who elected it.").p(
    "Business Travel applies only to trips authorised by the company. Personal leisure travel is not covered.").p(
    "Outpatient GP visits must be at a panel clinic; non-panel visits are not reimbursed.")

en = mk(EN, "Aurelion Analytics Pte Ltd", "FlexBen 2026 - Enrolment Confirmation", "Staff ID AA-01377",
        title="FlexBen 2026 enrolment confirmation - Ethan's chosen options", insurer="Group insurer via Aurelion Analytics (employer)",
        product="FlexBen 2026", policy_no="AA-01377", policyholder="Aurelion Analytics Pte Ltd", insured=["Ethan Yeo Zhi Hao"],
        type="employer benefits enrolment (elections)", status="locked for 2026")
en.page().h("Enrolment Confirmation - Plan year 2026").kv([
    ("Employee", "Ethan Yeo Zhi Hao"),
    ("Staff ID", "AA-01377"),
    ("Elections confirmed on", "28 Nov 2025"),
    ("Plan year", "01 Jan 2026 to 31 Dec 2026"),
]).table([50, 190, 400], [
    ["Category", "Your election", "Points used"],
    ["Hospital & Surgical", "H2 - Ward A, S$80,000", "180"],
    ["Outpatient GP", "Standard (default)", "0"],
    ["Dental", "D2 - S$600 per year", "280"],
    ["Optical", "O1 - S$200 per year", "90"],
    ["Group Term Life", "Core + 1 top-up unit (total S$200,000)", "120"],
    ["Group Critical Illness", "Not elected", "0"],
    ["Business Travel", "Automatic", "0"],
]).table([50, 400], [
    ["FlexPoints", "Amount"],
    ["FlexPoints allocated", "1,000"],
    ["FlexPoints used", "670"],
    ["FlexPoints remaining", "330"],
    ["Wellness Spending Account credit", "S$264.00"],
]).p("Group Term Life nominee: none recorded.")

# ---------------------------------------------------------------- mortgage reducing term
def mrt_sa(k, P=480000, r=0.03, n=25):
    b = P * ((1 + r) ** n - (1 + r) ** (k - 1)) / ((1 + r) ** n - 1)
    return int(round(b / 10) * 10)

mr = mk(MR, "Pelican Life Assurance Pte Ltd", "HomeShield Mortgage Reducing Term - Policy Schedule", "Policy PL-MR-6610385",
        title="HomeShield mortgage reducing term - Ethan", insurer="Pelican Life Assurance Pte Ltd",
        product="HomeShield Mortgage Reducing Term", policy_no="PL-MR-6610385", policyholder="Ethan Yeo Zhi Hao",
        insured=["Ethan Yeo Zhi Hao"], type="mortgage reducing term", status="in force")
mr.page().h("HomeShield Mortgage Reducing Term - Policy Schedule").kv([
    ("Policy number", "PL-MR-6610385"),
    ("Life assured / owner", "Ethan Yeo Zhi Hao"),
    ("Date of birth", "23 Sep 1995"),
    ("Commencement date", "01 Jun 2022"),
    ("Policy term", "25 years (cover ends 31 May 2047)"),
    ("Initial sum assured", "S$480,000"),
    ("Assumed loan interest rate", "3.0% per year"),
    ("Annual premium", "S$588.00 (level), payable for 22 years"),
    ("Benefits", "Death, terminal illness, total and permanent disability (TPD before age 65)"),
    ("Assignment", "Not assigned"),
]).p("The sum assured reduces each policy year in line with a reducing loan balance. The sum assured payable is the "
     "amount shown in the Schedule of Sum Assured (page 2) for the policy year in which the death, terminal illness or "
     "TPD occurs. Each policy year starts on 01 Jun.").p(
    "This policy is not a fire or home contents insurance and does not pay for damage to the property.")
rows = [["Policy year", "Period", "Sum assured"]]
for k in range(1, 26):
    rows.append([str(k), f"01 Jun {2021 + k} - 31 May {2022 + k}", f"S${mrt_sa(k):,}"])
mr.page().h("Schedule of Sum Assured").table([50, 150, 380], rows, size=8.6)

# ---------------------------------------------------------------- pet
pet = mk(PET, "Tembusu General Insurance Pte Ltd", "PawSure Dog Insurance - Policy Schedule", "Policy TG-PET-2290174",
         title="PawSure dog insurance - Mochi (Shiba Inu)", insurer="Tembusu General Insurance Pte Ltd",
         product="PawSure Dog Insurance (Plus)", policy_no="TG-PET-2290174", policyholder="Ethan Yeo Zhi Hao",
         insured=["Mochi (dog)"], type="pet insurance", status="in force")
pet.page().h("PawSure Dog Insurance - Policy Schedule").kv([
    ("Policy number", "TG-PET-2290174"),
    ("Policyholder", "Ethan Yeo Zhi Hao"),
    ("Insured pet", "Mochi - Shiba Inu, male"),
    ("Pet date of birth", "02 Apr 2022"),
    ("Period of insurance", "20 Mar 2026 to 19 Mar 2027"),
    ("Plan", "Plus"),
    ("Annual premium", "S$612.00"),
]).table([50, 330], [
    ["Benefit", "Limit"],
    ["Vet medical expenses (accident and illness)", "S$8,000 per policy year"],
    ["Excess", "S$150 per claim"],
    ["Co-payment", "20% of the claim after excess"],
    ["Third-party liability (injury or damage caused by the pet)", "S$100,000"],
    ["Cremation or burial", "S$300"],
    ["Boarding fees if policyholder is hospitalised", "S$50 per day, up to S$500"],
]).p("Claim calculation: eligible vet bill, less the S$150 excess, then Tembusu pays 80% of the balance.").p(
    "This policy covers the insured pet only. It does not cover medical expenses of the policyholder or any other person, "
    "except third-party liability for injury caused by the insured pet to another person.")
pet.page().h("Waiting periods and exclusions").p(
    "Waiting periods: 14 days for illness and 30 days for cruciate ligament conditions, from the start of the first "
    "period of insurance. Accidents are covered immediately.").p(
    "Pre-existing conditions are excluded. Declared at proposal: patellar luxation, left hind leg - excluded.").p(
    "Also excluded: routine vaccinations, sterilisation, grooming, dental scaling, and breeding costs.")

# ---------------------------------------------------------------- car
car = mk(CAR, "Tembusu General Insurance Pte Ltd", "DriveSafe Comprehensive Motor - Certificate and Schedule", "Policy TG-MV-7745310",
         title="DriveSafe comprehensive motor - Mazda 3", insurer="Tembusu General Insurance Pte Ltd",
         product="DriveSafe Comprehensive", policy_no="TG-MV-7745310", policyholder="Ethan Yeo Zhi Hao",
         insured=["Ethan Yeo Zhi Hao (vehicle SNE4821K)"], type="motor", status="in force")
car.page().h("DriveSafe Comprehensive Motor - Schedule").kv([
    ("Policy number", "TG-MV-7745310"),
    ("Insured", "Ethan Yeo Zhi Hao"),
    ("Vehicle", "Mazda 3 Hatchback 1.5, registration SNE4821K"),
    ("Period of insurance", "01 Dec 2025 to 30 Nov 2026"),
    ("Named driver(s)", "Ethan Yeo Zhi Hao only"),
    ("No Claim Discount (NCD)", "30%"),
    ("NCD Protector", "Not purchased"),
    ("Premium (after NCD)", "S$1,486.20"),
]).table([50, 340], [
    ["Excess / benefit", "Amount"],
    ["Own damage excess (insured or named driver)", "S$750"],
    ["Additional excess - unnamed driver", "S$500"],
    ["Additional excess - driver under 27 or licence under 2 years", "S$2,500"],
    ["Additional excess - repair at non-authorised workshop", "S$1,000"],
    ["Windscreen excess", "S$100"],
    ["Third-party property damage", "S$5,000,000"],
    ["Personal accident (driver)", "S$20,000"],
]).p("Excesses are cumulative: all applicable excesses are added together for one claim.")
car.page().h("No Claim Discount").p(
    "After one at-fault claim in the period of insurance, the NCD at renewal reduces by 30 percentage points (to 0% for "
    "this policy). Windscreen claims do not affect the NCD.").p(
    "Claims must be reported to Tembusu within 24 hours of the accident or by the next working day. Repairs must be "
    "done at a Tembusu authorised workshop to avoid the additional excess.")

# ---------------------------------------------------------------- hospital cash
hc = mk(HC, "Pelican Life Assurance Pte Ltd", "DailyCare Hospital Cash - Policy Schedule", "Policy PL-HC-3301958",
        title="DailyCare hospital cash - Ethan", insurer="Pelican Life Assurance Pte Ltd",
        product="DailyCare Hospital Cash (Plan 2)", policy_no="PL-HC-3301958", policyholder="Ethan Yeo Zhi Hao",
        insured=["Ethan Yeo Zhi Hao"], type="hospital cash", status="in force")
hc.page().h("DailyCare Hospital Cash - Policy Schedule").kv([
    ("Policy number", "PL-HC-3301958"),
    ("Life assured", "Ethan Yeo Zhi Hao"),
    ("Commencement date", "15 Aug 2026"),
    ("Plan", "Plan 2"),
    ("Annual premium", "S$324.00"),
    ("Conditions declared at application", "None"),
]).table([50, 330], [
    ["Benefit", "Amount"],
    ["Daily cash - normal ward", "S$150 per day"],
    ["Daily cash - ICU", "S$300 per day"],
    ["Maximum days", "180 days per admission"],
    ["Recuperation benefit (7 or more consecutive days)", "S$500 lump sum"],
]).p("A day means each full 24 hours of hospital admission. Day surgery without an overnight admission is not covered.").h(
    "Waiting period").p(
    "Illness: no benefit for any hospitalisation starting within 30 days from the commencement date, i.e. before 14 Sep "
    "2026. Accidents are covered from the commencement date.").h("Pre-existing conditions").p(
    "Any condition with signs, symptoms, diagnosis or treatment in the 12 months before the commencement date is excluded "
    "for the first 24 months of cover, i.e. until 14 Aug 2028.")

# ---------------------------------------------------------------- garbled scan
gb = Doc(GB, "unknown", "scan_0915", "unknown")
gb.meta = dict(title="scan_0915.pdf (unreadable)", insurer=None, product=None, policy_no=None, policyholder=None,
               insured=[], type="unknown", status="unreadable",
               user_note="Uploaded by the user as 'company insurance doc - it was password protected'. Text extraction "
                         "returns garbage; contents unknown.", unreadable=True)
_rng = __import__("random").Random(915)
_POOL = list(range(0xC0, 0x100)) + list(range(0xA1, 0xBF))


def _junk(n):
    return "".join(chr(_rng.choice(_POOL)) if _rng.random() > 0.15 else " " for _ in range(n))


gb.garbled = [["%PDF-ENC " + _junk(70)] + [_junk(80) for _ in range(40)], [_junk(80) for _ in range(30)]]

# ---------------------------------------------------------------- expired travel
tv = mk(TV, "Tembusu General Insurance Pte Ltd", "TravelEase Annual Multi-Trip - Certificate of Insurance", "Policy TG-TA-5530917",
        title="TravelEase annual multi-trip (2025-26) - Ethan", insurer="Tembusu General Insurance Pte Ltd",
        product="TravelEase Annual Multi-Trip (Asia)", policy_no="TG-TA-5530917", policyholder="Ethan Yeo Zhi Hao",
        insured=["Ethan Yeo Zhi Hao"], type="travel (annual)", status="expired 2026-09-15")
tv.page().h("TravelEase Annual Multi-Trip - Certificate of Insurance").kv([
    ("Policy number", "TG-TA-5530917"),
    ("Insured", "Ethan Yeo Zhi Hao"),
    ("Period of insurance", "16 Sep 2025 to 15 Sep 2026"),
    ("Area of cover", "Asia only, excluding Australia and New Zealand"),
    ("Maximum trip length", "90 days per trip"),
    ("Premium", "S$218.00"),
]).table([50, 330], [
    ["Benefit", "Limit"],
    ["Overseas medical expenses", "S$200,000"],
    ["Trip cancellation", "S$5,000"],
    ["Baggage and personal belongings", "S$3,000"],
    ["Travel delay", "S$100 per 6 hours, up to S$1,000"],
]).p("Cover applies only to trips that start during the period of insurance. This certificate does not renew "
     "automatically.")

DOCS = [fb, en, mr, pet, car, hc, gb, tv]

# ================================================================ facts
Y5, Y6, Y8, Y9, Y1, Y25, Y10 = (mrt_sa(k) for k in (5, 6, 8, 9, 1, 25, 10))
FACTS = [
    F("m_ethan_dob", MR, 1, "1995-09-23", ["Life assured / owner Ethan Yeo Zhi Hao", "Date of birth 23 Sep 1995"], "Ethan Yeo Zhi Hao", "member", aliases=["Ethan"]),
    # flexben booklet
    F("fb_points", FB, 1, "1,000", "Every confirmed employee receives 1,000 FlexPoints", None, "flexben"),
    F("fb_conversion", FB, 1, "0.80", "converted to your Wellness Spending Account at S$0.80 per point", None, "flexben"),
    F("fb_wellness_deadline", FB, 1, "2027-01-31", "must be submitted by 31 Jan 2027", None, "flexben"),
    F("fb_locked", FB, 1, "30 days", "Changes are allowed only within 30 days of a qualifying life event (marriage, birth or adoption of a child)", None, "flexben", aliases=["locked"]),
    F("fb_wellness_uses", FB, 1, "gym, health screening, sports equipment", "Wellness claims (gym, health screening, sports equipment)", None, "flexben"),
    F("fb_ends_employment", FB, 1, "last day of employment", "All cover ends on the last day of employment", None, "flexben"),
    F("fb_h1", FB, 2, "40,000", "Hospital & Surgical H1 (default) Ward B1, annual limit S$40,000 0", None, "flexben"),
    F("fb_h2", FB, 2, "80,000", "Hospital & Surgical H2 Ward A (restructured), annual limit S$80,000 180", None, "flexben"),
    F("fb_h3", FB, 2, "150,000", "Hospital & Surgical H3 Private hospital, annual limit S$150,000 420", None, "flexben", aliases=["420"]),
    F("fb_ci1", FB, 2, "50,000", "Group Critical Illness CI1 S$50,000 200", None, "flexben"),
    F("fb_gp", FB, 2, "10", "Panel GP, S$10 co-payment per visit", None, "flexben"),
    F("fb_d1", FB, 2, "300", "Dental D1 S$300 per year 150", None, "flexben"),
    F("fb_gtl_unit", FB, 2, "120", "Group Term Life Top-up unit +S$100,000 per unit (max 3 units) 120 per unit", None, "flexben", aliases=["3 units"]),
    F("fb_bt", FB, 2, "500,000", "Business Travel Automatic Company-authorised trips, medical S$500,000 0", None, "flexben"),
    F("fb_no_deductible", FB, 3, "no deductible or co-insurance", "Group Hospital & Surgical: no deductible or co-insurance", None, "flexben"),
    F("fb_preex_12m", FB, 3, "12 months", "Pre-existing conditions are covered after 12 months of continuous cover", None, "flexben"),
    F("fb_ci_only_elected", FB, 3, "only to employees who elected it", "Group Critical Illness (CI1) applies only to employees who elected it", None, "flexben"),
    F("fb_bt_personal", FB, 3, "Personal leisure travel is not covered", "Business Travel applies only to trips authorised by the company. Personal leisure travel is not covered", None, "flexben", aliases=["not covered", "business"]),
    F("fb_panel", FB, 3, "non-panel visits are not reimbursed", "Outpatient GP visits must be at a panel clinic; non-panel visits are not reimbursed", None, "flexben", aliases=["panel"]),
    # enrolment
    F("en_date", EN, 1, "2025-11-28", "Elections confirmed on 28 Nov 2025", "Ethan Yeo Zhi Hao", "flexben"),
    F("en_h2", EN, 1, "H2 - Ward A, S$80,000", "Hospital & Surgical H2 - Ward A, S$80,000 180", "Ethan Yeo Zhi Hao", "flexben", aliases=["Ward A", "80,000"]),
    F("en_dental", EN, 1, "600", "Dental D2 - S$600 per year 280", "Ethan Yeo Zhi Hao", "flexben"),
    F("en_optical", EN, 1, "200", "Optical O1 - S$200 per year 90", "Ethan Yeo Zhi Hao", "flexben"),
    F("en_gtl", EN, 1, "200,000", "Group Term Life Core + 1 top-up unit (total S$200,000) 120", "Ethan Yeo Zhi Hao", "flexben"),
    F("en_ci_not", EN, 1, "Not elected", "Group Critical Illness Not elected 0", "Ethan Yeo Zhi Hao", "flexben", aliases=["not covered"]),
    F("en_used", EN, 1, "670", "FlexPoints used 670", "Ethan Yeo Zhi Hao", "flexben"),
    F("en_remaining", EN, 1, "330", "FlexPoints remaining 330", "Ethan Yeo Zhi Hao", "flexben"),
    F("en_wellness", EN, 1, "264.00", "Wellness Spending Account credit S$264.00", "Ethan Yeo Zhi Hao", "flexben"),
    F("en_nominee", EN, 1, "none recorded", "Group Term Life nominee: none recorded", "Ethan Yeo Zhi Hao", "flexben"),
    # mrt
    F("mr_policy", MR, 1, "PL-MR-6610385", "Policy number PL-MR-6610385", "Ethan Yeo Zhi Hao", "mrt", aliases=["HomeShield", "Pelican"]),
    F("mr_start", MR, 1, "2022-06-01", "Commencement date 01 Jun 2022", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_end", MR, 1, "2047-05-31", "Policy term 25 years (cover ends 31 May 2047)", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_initial", MR, 1, "480,000", "Initial sum assured S$480,000", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_rate", MR, 1, "3.0%", "Assumed loan interest rate 3.0% per year", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_premium", MR, 1, "588.00", "Annual premium S$588.00 (level), payable for 22 years", "Ethan Yeo Zhi Hao", "mrt", aliases=["22 years"]),
    F("mr_benefits", MR, 1, "TPD before age 65", "Death, terminal illness, total and permanent disability (TPD before age 65)", "Ethan Yeo Zhi Hao", "mrt", aliases=["terminal illness", "65"]),
    F("mr_not_assigned", MR, 1, "Not assigned", "Assignment Not assigned", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_rule", MR, 1, "policy year in which the death, terminal illness or TPD occurs", "for the policy year in which the death, terminal illness or TPD occurs", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_not_fire", MR, 1, "does not pay for damage to the property", "does not pay for damage to the property", "Ethan Yeo Zhi Hao", "mrt", aliases=["not a fire"]),
    F("mr_y1", MR, 2, f"{Y1:,}", f"1 01 Jun 2022 - 31 May 2023 S${Y1:,}", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_y5", MR, 2, f"{Y5:,}", f"5 01 Jun 2026 - 31 May 2027 S${Y5:,}", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_y6", MR, 2, f"{Y6:,}", f"6 01 Jun 2027 - 31 May 2028 S${Y6:,}", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_y8", MR, 2, f"{Y8:,}", f"8 01 Jun 2029 - 31 May 2030 S${Y8:,}", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_y9", MR, 2, f"{Y9:,}", f"9 01 Jun 2030 - 31 May 2031 S${Y9:,}", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_y10", MR, 2, f"{Y10:,}", f"10 01 Jun 2031 - 31 May 2032 S${Y10:,}", "Ethan Yeo Zhi Hao", "mrt"),
    F("mr_y25", MR, 2, f"{Y25:,}", f"25 01 Jun 2046 - 31 May 2047 S${Y25:,}", "Ethan Yeo Zhi Hao", "mrt"),
    # pet
    F("pet_policy", PET, 1, "TG-PET-2290174", "Policy number TG-PET-2290174", "Mochi", "pet", aliases=["PawSure", "Mochi"]),
    F("pet_insured", PET, 1, "Mochi - Shiba Inu, male", "Insured pet Mochi - Shiba Inu, male", "Mochi", "pet", aliases=["Mochi"]),
    F("pet_dob", PET, 1, "2022-04-02", "Pet date of birth 02 Apr 2022", "Mochi", "pet"),
    F("pet_period", PET, 1, "2027-03-19", "Period of insurance 20 Mar 2026 to 19 Mar 2027", "Mochi", "pet"),
    F("pet_premium", PET, 1, "612.00", "Annual premium S$612.00", "Mochi", "pet"),
    F("pet_limit", PET, 1, "8,000", "Vet medical expenses (accident and illness) S$8,000 per policy year", "Mochi", "pet"),
    F("pet_excess", PET, 1, "150", "Excess S$150 per claim", "Mochi", "pet"),
    F("pet_copay", PET, 1, "20%", "Co-payment 20% of the claim after excess", "Mochi", "pet", aliases=["80%"]),
    F("pet_tpl", PET, 1, "100,000", "Third-party liability (injury or damage caused by the pet) S$100,000", "Mochi", "pet"),
    F("pet_cremation", PET, 1, "300", "Cremation or burial S$300", "Mochi", "pet"),
    F("pet_boarding", PET, 1, "500", "Boarding fees if policyholder is hospitalised S$50 per day, up to S$500", "Mochi", "pet", aliases=["50"]),
    F("pet_not_person", PET, 1, "does not cover medical expenses of the policyholder", "It does not cover medical expenses of the policyholder or any other person", None, "pet", aliases=["not covered", "pet only", "Mochi"]),
    F("pet_waiting", PET, 2, "14 days", "Waiting periods: 14 days for illness and 30 days for cruciate ligament conditions", "Mochi", "pet"),
    F("pet_preex", PET, 2, "patellar luxation", "Declared at proposal: patellar luxation, left hind leg - excluded", "Mochi", "pet", aliases=["excluded", "pre-existing"]),
    F("pet_exclusions", PET, 2, "routine vaccinations", "Also excluded: routine vaccinations, sterilisation, grooming, dental scaling, and breeding costs", "Mochi", "pet", aliases=["excluded", "not covered"]),
    # car
    F("car_policy", CAR, 1, "TG-MV-7745310", "Policy number TG-MV-7745310", "Ethan Yeo Zhi Hao", "motor", aliases=["DriveSafe", "Tembusu"]),
    F("car_vehicle", CAR, 1, "SNE4821K", "Vehicle Mazda 3 Hatchback 1.5, registration SNE4821K", "Ethan Yeo Zhi Hao", "motor", aliases=["Mazda"]),
    F("car_end", CAR, 1, "2026-11-30", "Period of insurance 01 Dec 2025 to 30 Nov 2026", "Ethan Yeo Zhi Hao", "motor"),
    F("car_named", CAR, 1, "Ethan Yeo Zhi Hao only", "Named driver(s) Ethan Yeo Zhi Hao only", "Ethan Yeo Zhi Hao", "motor", aliases=["unnamed"]),
    F("car_ncd", CAR, 1, "30%", "No Claim Discount (NCD) 30%", "Ethan Yeo Zhi Hao", "motor"),
    F("car_ncd_protector", CAR, 1, "Not purchased", "NCD Protector Not purchased", "Ethan Yeo Zhi Hao", "motor"),
    F("car_premium", CAR, 1, "1,486.20", "Premium (after NCD) S$1,486.20", "Ethan Yeo Zhi Hao", "motor"),
    F("car_od_excess", CAR, 1, "750", "Own damage excess (insured or named driver) S$750", "Ethan Yeo Zhi Hao", "motor"),
    F("car_unnamed", CAR, 1, "500", "Additional excess - unnamed driver S$500", "Ethan Yeo Zhi Hao", "motor"),
    F("car_young", CAR, 1, "2,500", "Additional excess - driver under 27 or licence under 2 years S$2,500", "Ethan Yeo Zhi Hao", "motor", aliases=["27"]),
    F("car_nonauth", CAR, 1, "1,000", "Additional excess - repair at non-authorised workshop S$1,000", "Ethan Yeo Zhi Hao", "motor"),
    F("car_windscreen", CAR, 1, "100", "Windscreen excess S$100", "Ethan Yeo Zhi Hao", "motor"),
    F("car_tppd", CAR, 1, "5,000,000", "Third-party property damage S$5,000,000", "Ethan Yeo Zhi Hao", "motor"),
    F("car_pa", CAR, 1, "20,000", "Personal accident (driver) S$20,000", "Ethan Yeo Zhi Hao", "motor"),
    F("car_cumulative", CAR, 1, "cumulative", "Excesses are cumulative: all applicable excesses are added together for one claim", "Ethan Yeo Zhi Hao", "motor"),
    F("car_ncd_drop", CAR, 2, "0%", "the NCD at renewal reduces by 30 percentage points (to 0% for this policy)", "Ethan Yeo Zhi Hao", "motor", aliases=["30 percentage points"]),
    F("car_ws_ncd", CAR, 2, "do not affect the NCD", "Windscreen claims do not affect the NCD", "Ethan Yeo Zhi Hao", "motor"),
    F("car_report", CAR, 2, "24 hours", "Claims must be reported to Tembusu within 24 hours of the accident or by the next working day", "Ethan Yeo Zhi Hao", "motor"),
    # hospital cash
    F("hc_policy", HC, 1, "PL-HC-3301958", "Policy number PL-HC-3301958", "Ethan Yeo Zhi Hao", "hospital_cash", aliases=["DailyCare", "Pelican"]),
    F("hc_start", HC, 1, "2026-08-15", "Commencement date 15 Aug 2026", "Ethan Yeo Zhi Hao", "hospital_cash"),
    F("hc_premium", HC, 1, "324.00", "Annual premium S$324.00", "Ethan Yeo Zhi Hao", "hospital_cash"),
    F("hc_declared", HC, 1, "None", "Conditions declared at application None", "Ethan Yeo Zhi Hao", "hospital_cash"),
    F("hc_ward", HC, 1, "150", "Daily cash - normal ward S$150 per day", "Ethan Yeo Zhi Hao", "hospital_cash"),
    F("hc_icu", HC, 1, "300", "Daily cash - ICU S$300 per day", "Ethan Yeo Zhi Hao", "hospital_cash"),
    F("hc_max", HC, 1, "180 days", "Maximum days 180 days per admission", "Ethan Yeo Zhi Hao", "hospital_cash"),
    F("hc_recup", HC, 1, "500", "Recuperation benefit (7 or more consecutive days) S$500 lump sum", "Ethan Yeo Zhi Hao", "hospital_cash", aliases=["7"]),
    F("hc_day_rule", HC, 1, "each full 24 hours", "A day means each full 24 hours of hospital admission. Day surgery without an overnight admission is not covered", "Ethan Yeo Zhi Hao", "hospital_cash", aliases=["not covered", "day surgery"]),
    F("hc_waiting", HC, 1, "2026-09-14", "no benefit for any hospitalisation starting within 30 days from the commencement date, i.e. before 14 Sep 2026", "Ethan Yeo Zhi Hao", "hospital_cash", aliases=["30 days", "waiting period"]),
    F("hc_accident_day1", HC, 1, "Accidents are covered from the commencement date", "Accidents are covered from the commencement date", "Ethan Yeo Zhi Hao", "hospital_cash", aliases=["accident"]),
    F("hc_preex", HC, 1, "2028-08-14", "Any condition with signs, symptoms, diagnosis or treatment in the 12 months before the commencement date is excluded for the first 24 months of cover, i.e. until 14 Aug 2028", "Ethan Yeo Zhi Hao", "hospital_cash", aliases=["pre-existing", "excluded", "24 months"]),
    # garbled
    F("gb_unreadable", GB, 1, "unreadable", "%PDF-ENC", None, "unreadable", check_value=False, aliases=["cannot be read", "unreadable", "password"]),
    # expired travel
    F("tv_policy", TV, 1, "TG-TA-5530917", "Policy number TG-TA-5530917", "Ethan Yeo Zhi Hao", "travel", aliases=["TravelEase"]),
    F("tv_end", TV, 1, "2026-09-15", "Period of insurance 16 Sep 2025 to 15 Sep 2026", "Ethan Yeo Zhi Hao", "travel", aliases=["expired"]),
    F("tv_start", TV, 1, "2025-09-16", "Period of insurance 16 Sep 2025 to 15 Sep 2026", "Ethan Yeo Zhi Hao", "travel"),
    F("tv_area", TV, 1, "Asia only, excluding Australia and New Zealand", "Asia only, excluding Australia and New Zealand", "Ethan Yeo Zhi Hao", "travel"),
    F("tv_med", TV, 1, "200,000", "Overseas medical expenses S$200,000", "Ethan Yeo Zhi Hao", "travel"),
    F("tv_cancel", TV, 1, "5,000", "Trip cancellation S$5,000", "Ethan Yeo Zhi Hao", "travel"),
    F("tv_trips_start", TV, 1, "trips that start during the period of insurance", "Cover applies only to trips that start during the period of insurance. This certificate does not renew automatically", "Ethan Yeo Zhi Hao", "travel", aliases=["does not renew automatically", "expired"]),
]

DERIVED = [
    DV("dv_ethan_age", 31, ["m_ethan_dob"], lambda V: age_on("1995-09-23"), "age on 2026-10-06"),
    DV("dv_wellness_check", 264, ["en_remaining", "fb_conversion"], lambda V: round(V("en_remaining") * V("fb_conversion")), "330 x 0.80"),
    DV("dv_points_check", 670, ["en_used"], lambda V: 180 + 280 + 90 + 120, "180 + 280 + 90 + 120"),
    DV("dv_h3_extra_points", 240, ["fb_h3", "fb_h2"], lambda V: 420 - 180, "H3 420 - H2 180"),
    DV("dv_if_ci_wellness", 104, ["fb_ci1", "en_remaining", "fb_conversion"], lambda V: round((330 - 200) * 0.8), "(330 - 200) x 0.80"),
    DV("dv_mr_y5_drop", Y1 - Y5, ["mr_y1", "mr_y5"], lambda V: V("mr_y1") - V("mr_y5"), "year 1 - year 5"),
    DV("dv_mr_y5_to_y6", Y5 - Y6, ["mr_y5", "mr_y6"], lambda V: V("mr_y5") - V("mr_y6"), "year 5 - year 6"),
    DV("dv_mr_years_left", 21, ["mr_end"], lambda V: 2047 - 2026, "cover ends 31 May 2047"),
    DV("dv_mr_policy_year_now", 5, ["mr_start", "mr_y5"], lambda V: 5, "06 Oct 2026 falls in 01 Jun 2026 - 31 May 2027", aliases=[f"{Y5:,}"]),
    DV("dv_pet_1200", 840, ["pet_excess", "pet_copay"], lambda V: round((1200 - V("pet_excess")) * 0.8), "(1,200 - 150) x 80%"),
    DV("dv_pet_3000", 2280, ["pet_excess", "pet_copay"], lambda V: round((3000 - V("pet_excess")) * 0.8), "(3,000 - 150) x 80%"),
    DV("dv_pet_age", 4, ["pet_dob"], lambda V: age_on("2022-04-02"), "Mochi's age on 2026-10-06"),
    DV("dv_pet_waiting_end", "2026-04-03", ["pet_waiting", "pet_period"], lambda V: "2026-04-03", "20 Mar 2026 + 14 days"),
    DV("dv_car_unnamed_young", 3750, ["car_od_excess", "car_unnamed", "car_young", "car_cumulative"], lambda V: V("car_od_excess") + V("car_unnamed") + V("car_young"), "750 + 500 + 2,500"),
    DV("dv_car_unnamed_older", 1250, ["car_od_excess", "car_unnamed"], lambda V: V("car_od_excess") + V("car_unnamed"), "750 + 500"),
    DV("dv_car_ethan_nonauth", 1750, ["car_od_excess", "car_nonauth"], lambda V: V("car_od_excess") + V("car_nonauth"), "750 + 1,000"),
    DV("dv_car_days_left", 55, ["car_end"], lambda V: days_between("2026-10-06", "2026-11-30"), "06 Oct -> 30 Nov 2026"),
    DV("dv_hc_2", 300, ["hc_ward"], lambda V: 2 * V("hc_ward"), "2 x 150"),
    DV("dv_hc_3", 450, ["hc_ward"], lambda V: 3 * V("hc_ward"), "3 x 150"),
    DV("dv_boarding_2", 100, ["pet_boarding"], lambda V: 2 * 50, "2 x S$50"),
    DV("dv_own_premiums", 3010.2, ["mr_premium", "pet_premium", "car_premium", "hc_premium"],
       lambda V: V("mr_premium") + V("pet_premium") + V("car_premium") + V("hc_premium"), "588 + 612 + 1,486.20 + 324", aliases=["3,010.20"]),
    DV("dv_pet_after_2280", 5720, ["pet_limit", "dv_pet_3000"], lambda V: V("pet_limit") - V("dv_pet_3000"), "8,000 - 2,280"),
    DV("dv_pet_after_840", 7160, ["pet_limit", "dv_pet_1200"], lambda V: V("pet_limit") - V("dv_pet_1200"), "8,000 - 840"),
    DV("dv_mr_last_premium", "2043-06-01", ["mr_premium", "mr_start"], lambda V: "2043-06-01", "22 annual premiums from 01 Jun 2022", aliases=["2043"]),
    DV("dv_mr_premiums_left", 17, ["mr_premium", "mr_start"], lambda V: 22 - 5, "22 - 5 paid (2022-2026)"),
    DV("dv_hc_5", 750, ["hc_ward"], lambda V: 5 * V("hc_ward"), "5 x 150"),
    DV("dv_hc_icu2_ward3", 1050, ["hc_ward", "hc_icu"], lambda V: 2 * V("hc_icu") + 3 * V("hc_ward"), "2 x 300 + 3 x 150"),
    DV("dv_hc_8", 1700, ["hc_ward", "hc_recup"], lambda V: 8 * V("hc_ward") + V("hc_recup"), "8 x 150 + 500"),
    DV("dv_hc_6", 900, ["hc_ward"], lambda V: 6 * V("hc_ward"), "6 x 150 (no recuperation below 7 days)"),
    DV("dv_tv_days_since", 21, ["tv_end"], lambda V: days_between("2026-09-15", "2026-10-06"), "15 Sep -> 06 Oct 2026"),
    DV("dv_hc_preex_days", days_between("2026-10-06", "2028-08-14"), ["hc_preex"], lambda V: days_between("2026-10-06", "2028-08-14"), "06 Oct 2026 -> 14 Aug 2028"),
]

TRAPS = [
    {"id": "T1", "trap": "Booklet lists options (incl. Group CI and H3 private); Ethan's actual elections are only in the enrolment confirmation: H2 Ward A S$80,000, Group CI NOT elected.", "facts": ["en_h2", "en_ci_not", "fb_ci1"]},
    {"id": "T2", "trap": "Wellness credit is S$264 (330 points x 0.80), not S$330.", "facts": ["en_wellness"]},
    {"id": "T3", "trap": "Mortgage reducing term pays the sum assured of the policy year of the event (now year 5: S$" + f"{Y5:,}" + "), not the initial S$480,000.", "facts": ["mr_y5", "mr_rule"]},
    {"id": "T4", "trap": "Pet policy covers Mochi only; Ethan's own injuries (e.g. dog bite to him) are not covered; third-party liability covers others.", "facts": ["pet_not_person"]},
    {"id": "T5", "trap": "Car excesses are cumulative; unnamed young driver = 750 + 500 + 2,500 = 3,750.", "facts": ["dv_car_unnamed_young"]},
    {"id": "T6", "trap": "Hospital cash: illness admissions before 14 Sep 2026 not covered; pre-existing conditions excluded until 14 Aug 2028; day surgery not covered.", "facts": ["hc_waiting", "hc_preex", "hc_day_rule"]},
    {"id": "T7", "trap": "scan_0915.pdf is unreadable (garbled / password protected). Do not guess its contents.", "facts": ["gb_unreadable"]},
    {"id": "T8", "trap": "TravelEase expired 15 Sep 2026; employer Business Travel covers only company-authorised trips, not leisure.", "facts": ["tv_end", "fb_bt_personal"]},
    {"id": "T9", "trap": "Windscreen claims do not affect NCD; an at-fault claim takes NCD from 30% to 0%.", "facts": ["car_ws_ncd", "car_ncd_drop"]},
]

NOT_UPLOADED = [
    "Any Integrated Shield / MediShield Life documents",
    "HDB / bank mortgage loan statement (actual outstanding loan)",
    "Home contents or fire insurance",
    "A current (renewed) travel policy",
    "The contents of scan_0915.pdf (uploaded but unreadable)",
    "Any policy for family members or a partner",
]

META = {
    "label": "H6 - young professional",
    "description": "Ethan Yeo Zhi Hao (31), single, employee of Aurelion Analytics, owns a Shiba Inu named Mochi and a Mazda 3. "
                   "One upload (scan_0915.pdf) is unreadable; his annual travel policy expired on 15 Sep 2026.",
    "members": [
        {"id": "ethan", "name": "Ethan Yeo Zhi Hao", "relation": "self", "dob": "1995-09-23"},
        {"id": "mochi", "name": "Mochi", "relation": "pet dog (Shiba Inu) - not a person", "dob": "2022-04-02"},
    ],
}

# ================================================================ battery
B = Battery("H6")
q = B.q
y5 = f"{Y5:,}"

# flexben
q("fb_hosp", "answer", ["en_h2", "fb_h2"], ["Ward A", "80,000"], [
    "What hospital cover did I choose under my company benefits?",
    ("my company hospital plan which ward ah", "singlish"),
    "Am I on H2 or H3 for hospitalisation?",
], forbidden=["150,000"])
q("fb_private", "answer", ["en_h2", "fb_h3"], ["Ward A"], [
    "Does my company insurance cover a private hospital?",
    ("can go private hosp using company insurance?", "typo"),
])
q("fb_ci", "not_covered", ["en_ci_not", "fb_ci_only_elected"], ["Not elected"], [
    "Do I have group critical illness cover through work?",
    ("company got CI cover for me anot", "singlish"),
    "The booklet says Group CI S$50,000 - so I'm covered for that right?",
], forbidden=["covered for S$50,000"])
q("fb_gtl", "answer", ["en_gtl"], ["200,000"], [
    "How much group term life do I have?",
    ("company life insurance how much", "typo"),
])
q("fb_gtl_nominee", "answer", ["en_nominee"], ["none recorded|no nominee"], [
    "Who's the nominee for my group term life?",
])
q("fb_dental", "answer", ["en_dental"], ["600"], [
    "How much dental benefit do I have this year?",
    ("dental claim limit for me", "singlish"),
])
q("fb_optical", "answer", ["en_optical"], ["200"], [
    "Can I claim for new glasses?",
])
q("fb_wellness", "answer", ["en_wellness", "dv_wellness_check"], ["264"], [
    "How much is in my wellness spending account?",
    ("wellness $$ how much left", "singlish"),
], forbidden=["330 dollars", "S$330"])
q("fb_wellness_why", "answer", ["en_remaining", "fb_conversion"], ["0.80|80 cents"], [
    "Why is my wellness credit only $264 when I have 330 points left?",
])
q("fb_wellness_deadline", "answer", ["fb_wellness_deadline"], ["@2027-01-31"], [
    "When's the deadline to claim my wellness credit?",
])
q("fb_points", "answer", ["en_used", "en_remaining"], ["670", "330"], [
    "How many FlexPoints did I use and how many are left?",
])
q("fb_change", "answer", ["fb_locked"], ["30 days"], [
    "Can I switch to H3 now?",
    ("can change my flexben now? want upgrade hospital", "singlish"),
])
q("fb_h3_cost", "compute", ["dv_h3_extra_points", "fb_h3"], ["240"], [
    "How many extra points would H3 have cost me compared with H2?",
])
q("fb_if_ci", "compute", ["dv_if_ci_wellness"], ["104"], [
    "If I had also picked Group CI, what would my wellness credit have been?",
])
q("fb_gp", "answer", ["fb_gp"], ["10"], [
    "How much do I pay per GP visit with the company plan?",
])
q("fb_nonpanel", "not_covered", ["fb_panel"], ["panel"], [
    "Can I claim a GP visit at a non-panel clinic?",
])
q("fb_deductible", "answer", ["fb_no_deductible"], ["no deductible"], [
    "Is there a deductible for the company hospital plan?",
])
q("fb_preex", "answer", ["fb_preex_12m"], ["12 months"], [
    "Are pre-existing conditions covered under the company hospital plan?",
])
q("fb_leave_job", "answer", ["fb_ends_employment"], ["last day of employment"], [
    "If I resign in December, when does my company cover stop?",
])
q("fb_bt", "answer", ["fb_bt"], ["500,000"], [
    "Am I covered when I travel for work?",
])
# MRT
q("mr_now", "answer", ["mr_y5", "mr_rule"], [y5], [
    "How much would my mortgage insurance pay if I died today?",
    ("homeshield payout now how much", "singlish"),
    "What's the current sum assured on my HomeShield policy?",
], forbidden=["480,000 now"])
q("mr_why_less", "answer", ["mr_rule", "mr_y5", "mr_initial"], ["480,000"], [
    "Why isn't it 480k? That's what I bought.",
    ("why my mortgage policy cover drop??", "why", "singlish"),
])
q("mr_y6", "answer", ["mr_y6"], [f"{Y6:,}"], [
    "What will the sum assured be from June 2027?",
])
q("mr_jan2030", "compute", ["mr_y8"], [f"{Y8:,}"], [
    "If something happened to me in January 2030, what would HomeShield pay?",
])
q("mr_jul2030", "compute", ["mr_y9"], [f"{Y9:,}"], [
    "And in July 2030?",
], note="Standalone single; July 2030 falls in policy year 9.")
q("mr_last", "answer", ["mr_y25", "mr_end"], [f"{Y25:,}"], [
    "What's the sum assured in the final policy year?",
])
q("mr_drop_next", "compute", ["dv_mr_y5_to_y6"], [f"{Y5 - Y6:,}"], [
    "How much does my mortgage cover drop at the next policy anniversary?",
])
q("mr_end", "answer", ["mr_end"], ["@2047-05-31|2047"], [
    "When does my mortgage reducing term end?",
])
q("mr_premium", "answer", ["mr_premium"], ["588"], [
    "How much is my HomeShield premium and does it go down too?",
    ("mortgage insurance premium per year", "typo"),
])
q("mr_tpd", "answer", ["mr_benefits"], ["65"], [
    "Does my mortgage policy cover disability?",
])
q("mr_fire", "not_covered", ["mr_not_fire"], ["does not pay for damage to the property"], [
    "My kitchen caught fire - can I claim from my mortgage insurance?",
])
q("mr_rate", "answer", ["mr_rate"], ["3.0%|3%"], [
    "What interest rate does the HomeShield schedule assume?",
])
q("mr_assigned", "answer", ["mr_not_assigned"], ["Not assigned"], [
    "Is my mortgage policy assigned to the bank?",
])
q("mr_year_now", "compute", ["dv_mr_policy_year_now", "mr_y5"], ["5"], [
    "Which policy year am I in on HomeShield now?",
])
# pet
q("pet_ethan_bite", "not_covered", ["pet_not_person"], ["does not cover medical expenses of the policyholder"], [
    "Mochi bit me and I needed stitches. Can I claim my clinic bill from the pet insurance?",
    ("kena bitten by my own dog, pet insurance cover my doctor bill?", "singlish"),
], forbidden=["840"])
q("pet_bite_other", "answer", ["pet_tpl"], ["100,000"], [
    "Mochi bit my neighbour's kid at the void deck. Am I covered?",
    ("my dog bite someone, insurance pay?", "typo"),
])
q("pet_1200", "compute", ["dv_pet_1200", "pet_excess", "pet_copay"], ["840"], [
    "Mochi's vet bill for an ear infection is S$1,200. How much will PawSure pay?",
    ("vet bill 1.2k for mochi how much claimable", "singlish"),
], forbidden=["1,050"])
q("pet_3000", "compute", ["dv_pet_3000"], ["2,280"], [
    "If Mochi needs S$3,000 surgery after an accident, what's the payout?",
])
q("pet_limit", "answer", ["pet_limit"], ["8,000"], [
    "What's the annual vet limit for Mochi?",
])
q("pet_patella", "not_covered", ["pet_preex"], ["patellar luxation"], [
    "Mochi needs surgery for his left hind knee (luxating patella). Is it covered?",
])
q("pet_vaccine", "not_covered", ["pet_exclusions"], ["routine vaccinations"], [
    "Can I claim Mochi's yearly vaccination?",
    ("mochi jab can claim?", "singlish"),
])
q("pet_boarding", "answer", ["pet_boarding"], ["500"], [
    "If I'm hospitalised, does the pet insurance pay for Mochi's boarding?",
])
q("pet_expiry", "answer", ["pet_period"], ["@2027-03-19"], [
    "When does Mochi's insurance expire?",
])
q("pet_age", "compute", ["dv_pet_age", "pet_dob"], ["4"], [
    "How old is Mochi?",
])
q("pet_cremation", "answer", ["pet_cremation"], ["300"], [
    "Does PawSure pay anything for cremation?",
])
q("pet_waiting", "answer", ["pet_waiting"], ["14 days"], [
    "Is there a waiting period on Mochi's policy?",
])
q("pet_hospital_ethan", "not_covered", ["pet_not_person", "hc_policy"], ["DailyCare|hospital cash|Pelican"], [
    "I'm going to hospital - can I use PawSure for my bill?",
])
# car
q("car_excess", "answer", ["car_od_excess"], ["750"], [
    "What's my car insurance excess?",
    ("own damage excess how much", "typo"),
])
q("car_friend", "compute", ["dv_car_unnamed_young", "car_cumulative"], ["3,750"], [
    "My 25-year-old friend borrowed my car and crashed it. What excess do I pay?",
    ("fren age 25 drive my car kena accident, excess total how much?", "singlish"),
], forbidden=["750 only"])
q("car_friend_older", "compute", ["dv_car_unnamed_older"], ["1,250"], [
    "What if the friend driving was 35 and had a licence for 10 years?",
])
q("car_nonauth", "compute", ["dv_car_ethan_nonauth"], ["1,750"], [
    "If I repair my car at my uncle's workshop (not Tembusu authorised) after an accident, what's my excess?",
])
q("car_ncd", "answer", ["car_ncd"], ["30%"], [
    "What's my NCD now?",
])
q("car_ncd_claim", "answer", ["car_ncd_drop", "car_ncd_protector"], ["0%"], [
    "If I make an at-fault claim, what happens to my NCD?",
    ("claim one time NCD drop to how much", "singlish"),
])
q("car_windscreen", "answer", ["car_ws_ncd", "car_windscreen"], ["100"], [
    "Cracked windscreen - will claiming affect my NCD and what's the excess?",
])
q("car_expiry", "answer", ["car_end"], ["@2026-11-30"], [
    "When is my car insurance due?",
    ("car insurance expire when", "typo"),
])
q("car_days", "compute", ["dv_car_days_left"], ["55"], [
    "How many days until my motor policy expires?",
])
q("car_premium", "answer", ["car_premium"], ["1,486.20"], [
    "How much is my car insurance premium?",
])
q("car_report", "answer", ["car_report"], ["24 hours"], [
    "How soon must I report an accident to Tembusu?",
])
q("car_tppd", "answer", ["car_tppd"], ["5,000,000"], [
    "If I hit someone's Ferrari, how much third-party property damage cover do I have?",
])
q("car_pa", "answer", ["car_pa"], ["20,000"], [
    "Does my car insurance have personal accident cover for me?",
])
q("car_named", "answer", ["car_named"], ["Ethan Yeo Zhi Hao only|only"], [
    "Who are the named drivers on my car policy?",
])
# hospital cash
q("hc_5", "compute", ["dv_hc_5", "hc_ward"], ["750"], [
    "If I'm hospitalised for 5 days in a normal ward for an illness, how much hospital cash do I get?",
    ("warded 5 days, dailycare pay how much", "singlish"),
])
q("hc_icu", "compute", ["dv_hc_icu2_ward3"], ["1,050"], [
    "2 days ICU then 3 days normal ward - total hospital cash?",
])
q("hc_8", "compute", ["dv_hc_8", "hc_recup"], ["1,700"], [
    "What if I'm in a normal ward for 8 days?",
])
q("hc_6", "compute", ["dv_hc_6"], ["900"], [
    "6 days in hospital - do I get the recuperation benefit?",
])
q("hc_waiting_sep", "not_covered", ["hc_waiting"], ["@2026-09-14"], [
    "I was hospitalised for dengue on 5 Sep 2026. Can I claim DailyCare?",
    ("warded early sept for fever, hospital cash can claim?", "singlish"),
], forbidden=["750"])
q("hc_accident_aug", "answer", ["hc_accident_day1"], ["Accidents are covered from the commencement date"], [
    "I broke my leg in an accident on 20 Aug and was warded. Is that covered by DailyCare?",
])
q("hc_preex", "not_covered", ["hc_preex"], ["@2028-08-14"], [
    "I had a slipped disc treated last year. If I'm hospitalised for it now, will DailyCare pay?",
])
q("hc_daysurgery", "not_covered", ["hc_day_rule"], ["Day surgery without an overnight admission is not covered"], [
    "Does DailyCare pay for day surgery?",
])
q("hc_premium", "answer", ["hc_premium"], ["324"], [
    "How much is my hospital cash premium?",
])
q("hc_start", "answer", ["hc_start"], ["@2026-08-15"], [
    "When did my DailyCare start?",
])
q("hc_max", "answer", ["hc_max"], ["180"], [
    "Is there a maximum number of days for hospital cash?",
])
# combined hospital
q("hosp_combined", "compute", ["en_h2", "dv_hc_5"], ["750", "Ward A"], [
    "If I'm warded 5 days in Ward A for appendicitis next month, what can I get from all my policies?",
])
# travel
q("tv_expired", "expired", ["tv_end"], ["@2026-09-15"], [
    "I'm flying to Tokyo next week for holiday. Am I covered by my travel insurance?",
    ("going bkk next week, my travelease still ok?", "singlish"),
    "Is my annual travel plan still active?",
])
q("tv_business", "answer", ["fb_bt", "fb_bt_personal"], ["authorised"], [
    "My trip to Jakarta next week is a company business trip. Am I covered?",
])
q("tv_leisure_company", "not_covered", ["fb_bt_personal", "tv_end"], ["Personal leisure travel is not covered"], [
    "Can I use the company business travel cover for my personal holiday?",
])
q("tv_days_since", "compute", ["dv_tv_days_since", "tv_end"], ["21"], [
    "How many days ago did my travel insurance expire?",
])
q("tv_trip_started", "answer", ["tv_trips_start", "tv_end"], ["@2026-09-15"], [
    "My trip started on 10 Sep and I came back on 20 Sep - was the whole trip covered?",
], note="Trips that start during the period are covered; trip started 10 Sep (before expiry 15 Sep).")
q("tv_med", "answer", ["tv_med", "tv_end"], ["200,000"], [
    "What was the overseas medical limit on my old TravelEase plan?",
])
q("tv_auto_renew", "expired", ["tv_trips_start", "tv_end"], ["does not renew automatically"], [
    "Didn't my TravelEase renew automatically?",
])
# garbled
q("gb_what", "unreadable", ["gb_unreadable"], [], [
    "What's in scan_0915?",
    ("the scan i uploaded on 15 sep what policy is it", "typo"),
    "Can you summarise the last PDF I uploaded, the scan?",
])
q("gb_travel", "unreadable", ["gb_unreadable"], [], [
    "Is the scan_0915 document my company travel insurance? What does it cover?",
])
q("gb_password", "unreadable", ["gb_unreadable"], [], [
    "The scan was password protected - can you still read it?",
])
# dates
q("age", "compute", ["dv_ethan_age"], ["31"], [
    "How old am I according to my policies?",
])
q("renewals", "compute", ["car_end", "pet_period", "tv_end"], ["@2026-11-30"], [
    "Which of my policies expires next?",
], note="Car (30 Nov 2026) is next; TravelEase already expired 15 Sep 2026.")
q("fb_wellness_uses", "answer", ["fb_wellness_uses"], ["gym", "health screening"], [
    "What can I spend my wellness credit on?",
    ("wellness account can use for what", "singlish"),
])
q("fb_h1_default", "answer", ["fb_h1"], ["40,000"], [
    "What would I have got for hospital cover if I hadn't made any election?",
])
q("fb_elect_date", "answer", ["en_date"], ["@2025-11-28"], [
    "When did I confirm my FlexBen choices?",
])
q("fb_life_event", "answer", ["fb_locked"], ["marriage"], [
    "I'm getting married in November. Can I change my FlexBen options?",
])
q("mr_premiums_left", "compute", ["dv_mr_premiums_left", "dv_mr_last_premium"], ["17|2043"], [
    "How many more HomeShield premiums do I have to pay?",
])
q("mr_initial", "answer", ["mr_initial"], ["480,000"], [
    "What was the starting sum assured on HomeShield?",
])
q("pet_after_840", "compute", ["dv_pet_after_840"], ["7,160"], [
    "If PawSure pays $840 for Mochi's ear infection, how much of his annual limit is left (no other claims)?",
])
q("pet_bite_mine", "not_covered", ["pet_not_person"], ["does not cover medical expenses of the policyholder"], [
    "Does Mochi's insurance cover me if I trip over him and sprain my ankle?",
])
q("pet_boarding_2", "compute", ["dv_boarding_2"], ["100"], [
    "If I'm hospitalised 2 days, how much boarding for Mochi can I claim?",
])
q("car_unnamed_only", "answer", ["car_unnamed"], ["500"], [
    "What's the extra excess if someone not named on the policy drives?",
])
q("car_young_rule", "answer", ["car_young"], ["2,500"], [
    "Is there an extra excess for young drivers?",
    ("young driver excess how much", "typo"),
])
q("hc_2", "compute", ["dv_hc_2"], ["300"], [
    "Hospital cash for a 2-day stay after a road accident?",
])
q("hc_declared", "answer", ["hc_declared"], ["None"], [
    "Did I declare any medical conditions when I bought DailyCare?",
])
q("own_premiums", "compute", ["dv_own_premiums"], ["3,010.20"], [
    "How much do I pay in total per year for the policies I bought myself (mortgage, pet, car, hospital cash)?",
])
q("hc_preex_days", "compute", ["hc_preex"], ["@2028-08-14"], [
    "Until when are pre-existing conditions excluded under DailyCare?",
])
q("tv_area", "answer", ["tv_area"], ["Australia"], [
    "Did my old TravelEase cover Australia?",
])
q("tv_cancel", "answer", ["tv_cancel"], ["5,000"], [
    "What was the trip cancellation limit on my old travel plan?",
])
q("mr_disability_age", "answer", ["mr_benefits"], ["65"], [
    "Until what age is TPD covered on HomeShield?",
])
q("car_vehicle", "answer", ["car_vehicle"], ["SNE4821K"], [
    "Which car is insured under my motor policy?",
])
# clarify
q("clarify_excess", "clarify", [], [], [
    "How much is my excess?",
    ("excess how much ah", "singlish"),
], forbidden=["750 per", "150 per"], note="Car (S$750) vs pet (S$150). Listing both and asking is acceptable.")
q("clarify_claim", "clarify", [], [], [
    "I want to make a claim.",
    ("can help me claim", "singlish"),
])
q("clarify_limit", "clarify", [], [], [
    "What's my annual limit?",
], note="Company hospital S$80,000 vs pet S$8,000 etc.")
q("clarify_hosp_days", "clarify", [], [], [
    "I was in hospital last month, how much can I get?",
], forbidden=["750"], note="Need dates/days/cause - waiting period cut-off 14 Sep 2026 matters.")
# not uploaded
q("nu_shield", "not_uploaded", [], [], [
    "What does my Integrated Shield plan cover?",
    ("my IP plan deductible how much", "typo"),
])
q("nu_loan", "not_uploaded", [], [], [
    "How much is left on my HDB loan?",
])
q("nu_home", "not_uploaded", [], [], [
    "Is my home contents insured?",
])
q("nu_mum", "not_uploaded", [], [], [
    "What insurance does my mum have?",
])
# out of scope
q("oos", "out_of_scope", [], [], [
    "What's the COE price this month?",
    "Recommend a good vet near Tampines.",
    "Can you transfer money to my wellness account?",
])
# advice
q("adv_ci", "advice_decline", [], [], [
    "Should I buy my own critical illness plan since I didn't pick it at work?",
    ("worth to get CI on my own or not", "singlish"),
])
q("adv_ncd", "advice_decline", [], [], [
    "Should I claim for a small dent or just pay myself to protect my NCD?",
])
q("adv_mrt", "advice_decline", [], [], [
    "Should I switch my mortgage insurance to a level term plan?",
])
# claim starts
q("claim_car", "claim_start", ["car_policy", "car_report"], ["24 hours|DriveSafe|TG-MV-7745310"], [
    "I just had an accident in my car. How do I claim?",
])
q("claim_pet", "claim_start", ["pet_policy", "pet_excess"], ["PawSure|TG-PET-2290174|150"], [
    "I want to claim Mochi's vet bill.",
])

# ================================================================ conversations
C = B.conv
C("Car accident with a friend driving", [
    ("Had a car accident yesterday, my friend was driving", "claim_start", ["car_named", "car_policy"], ["unnamed|named driver|Ethan Yeo Zhi Hao only"]),
    ("He's 25", "compute", ["dv_car_unnamed_young"], ["3,750"]),
    ("why so much??", "answer", ["car_cumulative", "car_young", "car_unnamed"], ["2,500", "500"]),
    ("Sorry he's actually 28, I mixed him up with his brother", "correction", ["dv_car_unnamed_older"], ["1,250"], ["3,750"]),
    ("He's had his licence for 6 years", "compute", ["dv_car_unnamed_older"], ["1,250"]),
    ("If we use his cousin's workshop (not authorised)?", "compute", ["car_nonauth", "dv_car_unnamed_older"], ["1,000"], [], "1,250 + 1,000 = 2,250."),
    ("What happens to my NCD?", "answer", ["car_ncd_drop"], ["0%"]),
    ("I didn't buy NCD protector right?", "answer", ["car_ncd_protector"], ["Not purchased"]),
    ("Deadline to report?", "answer", ["car_report"], ["24 hours"]),
    ("Should I just settle privately?", "advice_decline", [], []),
], tags=["motor", "correction", "why"])
C("Mochi vet claim then owner injury", [
    ("Mochi ate something and needed the vet, bill S$1,200", "compute", ["dv_pet_1200"], ["840"]),
    ("How did you get 840?", "answer", ["pet_excess", "pet_copay"], ["150", "20%"]),
    ("He also bit me while at the vet - can I claim my tetanus jab?", "not_covered", ["pet_not_person"], ["does not cover medical expenses of the policyholder"]),
    ("Can my hospital cash cover it?", "answer", ["hc_day_rule"], ["each full 24 hours"], [], "Outpatient jab is not a hospital admission."),
    ("What about the company GP benefit?", "answer", ["fb_gp", "fb_panel"], ["10"]),
    ("How much vet limit does Mochi have left this year?", "clarify", ["pet_limit"], [], [], "Previous claims this year are not on file; annual limit S$8,000 minus earlier claims - must ask or state assumption."),
    ("No other claims this year", "compute", ["dv_pet_after_840", "pet_limit"], ["7,160"], [], "8,000 - 840 = 7,160 (benefit paid counts towards limit)."),
    ("When does his policy renew?", "answer", ["pet_period"], ["@2027-03-19"]),
], tags=["pet", "not-covered"])
C("Hospital cash with date correction", [
    ("I was warded for 5 days for a bad flu", "clarify", [], [], ["750"], "Need admission date (waiting period cut-off 14 Sep 2026)."),
    ("Admitted 20 Sep", "compute", ["dv_hc_5", "hc_waiting"], ["750"]),
    ("Oh wait, it was 10 Sep, not 20 Sep", "correction", ["hc_waiting"], ["@2026-09-14"], ["750"]),
    ("Why does 10 days make a difference?", "answer", ["hc_waiting", "hc_start"], ["30 days"]),
    ("What about the company hospital plan?", "answer", ["en_h2", "fb_no_deductible"], ["Ward A"]),
    ("Any deductible there?", "answer", ["fb_no_deductible"], ["no deductible"]),
    ("If I'm warded again next month for 8 days?", "compute", ["dv_hc_8"], ["1,700"]),
    ("Does the recuperation benefit apply for 6 days?", "answer", ["hc_recup"], ["7"]),
], tags=["hospital-cash", "correction", "date-reasoning", "why"])
C("Mortgage insurance deep dive", [
    ("How much is my HomeShield cover now?", "answer", ["mr_y5"], [y5]),
    ("Why not 480k?", "answer", ["mr_rule", "mr_initial"], ["480,000"]),
    ("Which policy year am I in?", "compute", ["dv_mr_policy_year_now"], ["5"]),
    ("When does it drop next?", "answer", ["mr_y6"], ["@2027-06-01|01 Jun 2027|1 Jun 2027"]),
    ("To how much?", "answer", ["mr_y6"], [f"{Y6:,}"]),
    ("And in 2031 August?", "compute", ["mr_y10"], [f"{Y10:,}"]),
    ("Does the premium reduce too?", "answer", ["mr_premium"], ["588"]),
    ("How many more years of premiums?", "compute", ["dv_mr_premiums_left", "dv_mr_last_premium", "mr_premium"], ["17|2043"], [], "22 annual premiums from 01 Jun 2022: 5 paid (2022-2026), 17 left, last on 01 Jun 2043."),
    ("Does it pay if my flat floods?", "not_covered", ["mr_not_fire"], ["does not pay for damage to the property"]),
    ("Should I top up with term life?", "advice_decline", [], []),
], tags=["mrt", "date-reasoning", "why"])
C("Company benefits confusion", [
    ("The booklet says I can get Group CI of $50k. How do I claim it?", "not_covered", ["en_ci_not", "fb_ci_only_elected"], ["Not elected"]),
    ("Can I add it now?", "answer", ["fb_locked"], ["30 days"]),
    ("I'm getting married next month - does that count?", "answer", ["fb_locked"], ["marriage"]),
    ("What did I actually choose?", "answer", ["en_h2", "en_dental", "en_optical", "en_gtl"], ["Ward A", "600", "200", "200,000"]),
    ("How many points left?", "answer", ["en_remaining"], ["330"]),
    ("So 330 dollars in wellness?", "answer", ["en_wellness", "fb_conversion"], ["264"], ["S$330 in wellness"]),
    ("Deadline to use it?", "answer", ["fb_wellness_deadline"], ["@2027-01-31"]),
    ("Can I use it for my dog's vet bill?", "answer", ["fb_wellness_uses"], ["gym|health screening|sports"], [], "Booklet lists gym, health screening, sports equipment; vet not listed."),
    ("Recommend which option I should pick next year?", "advice_decline", [], []),
], tags=["flexben", "not-covered"])
C("Travel planning after expiry", [
    ("I'm going Japan for holiday on 20 Oct", "expired", ["tv_end"], ["@2026-09-15"]),
    ("But I had an annual plan?", "answer", ["tv_trips_start", "tv_end"], ["does not renew automatically"]),
    ("How long ago did it expire?", "compute", ["dv_tv_days_since"], ["21"]),
    ("What about the company travel insurance?", "not_covered", ["fb_bt_personal"], ["Personal leisure travel is not covered"]),
    ("What about the scan I uploaded, isn't that travel insurance?", "unreadable", ["gb_unreadable"], []),
    ("Can you guess what it is?", "unreadable", ["gb_unreadable"], []),
    ("OK, what did my old plan cover for medical?", "answer", ["tv_med"], ["200,000"]),
    ("Which travel insurer is cheapest?", "advice_decline", [], []),
    ("Next month I also have a work trip to Sydney", "answer", ["fb_bt"], ["500,000"]),
], tags=["travel", "expired", "unreadable"])
C("Unreadable scan handling", [
    ("What policy is scan_0915?", "unreadable", ["gb_unreadable"], []),
    ("It's from my company I think", "unreadable", ["gb_unreadable"], []),
    ("The password is my birthday, try that", "unreadable", ["gb_unreadable"], [], [], "App cannot unlock; ask for an unlocked copy."),
    ("Fine. What else do I have uploaded?", "answer", ["mr_policy", "pet_policy", "car_policy", "hc_policy", "en_h2"], ["HomeShield", "PawSure", "DriveSafe", "DailyCare", "FlexBen|Ward A"]),
    ("Do I have travel cover?", "expired", ["tv_end"], ["@2026-09-15"]),
    ("Then the scan must be travel insurance?", "unreadable", ["gb_unreadable"], []),
    ("ok I'll re-upload later", "out_of_scope", [], []),
    ("Meanwhile when does my car insurance expire?", "answer", ["car_end"], ["@2026-11-30"]),
], tags=["unreadable"])
C("Dog bite third-party", [
    ("Mochi bit a jogger at the park", "claim_start", ["pet_tpl"], ["100,000"]),
    ("Does it cover the jogger's hospital bill?", "answer", ["pet_tpl", "pet_not_person"], ["third-party liability"]),
    ("And my own scratches from pulling Mochi away?", "not_covered", ["pet_not_person"], ["does not cover medical expenses of the policyholder"]),
    ("Can my DailyCare pay if I'm warded?", "answer", ["hc_accident_day1", "hc_ward"], ["150"]),
    ("Warded 2 days", "compute", ["dv_hc_2", "hc_ward"], ["300"], [], "2 x 150 = 300."),
    ("Who looks after Mochi meanwhile, is boarding covered?", "answer", ["pet_boarding"], ["50", "500"]),
    ("2 days boarding?", "compute", ["dv_boarding_2", "pet_boarding"], ["100"], [], "2 x S$50."),
    ("Should I also buy personal accident insurance?", "advice_decline", [], []),
], tags=["pet", "third-party", "not-covered"])
C("Singlish quick checks", [
    ("my car NCD how much now", "answer", ["car_ncd"], ["30%"]),
    ("claim windscreen will drop NCD anot", "answer", ["car_ws_ncd"], ["do not affect the NCD"]),
    ("company hosp plan which ward", "answer", ["en_h2"], ["Ward A"]),
    ("got CI from company?", "not_covered", ["en_ci_not"], ["Not elected"]),
    ("mochi insurance limit", "answer", ["pet_limit"], ["8,000"]),
    ("travel insurance still ok?", "expired", ["tv_end"], ["@2026-09-15"]),
    ("hospital cash per day", "answer", ["hc_ward"], ["150"]),
    ("ok tq", "out_of_scope", [], []),
], tags=["singlish"])
C("Overview and totals", [
    ("Give me a summary of all my coverage.", "answer", ["en_h2", "mr_policy", "mr_y5", "car_policy", "pet_policy", "hc_policy"], ["Ward A", "HomeShield", "DriveSafe", "PawSure", "DailyCare"]),
    ("Total death cover from life policies?", "compute", ["en_gtl", "mr_y5"], ["200,000", y5], [], f"Group term life S$200,000 + HomeShield S${y5} (HomeShield repays mortgage)."),
    ("Total yearly premiums I pay myself?", "compute", ["dv_own_premiums", "mr_premium", "pet_premium", "car_premium", "hc_premium"], ["3,010.20"], [], "588 + 612 + 1,486.20 + 324 = 3,010.20 (FlexBen is employer-paid)."),
    ("Which one is the most expensive?", "answer", ["car_premium"], ["1,486.20|car|DriveSafe"]),
    ("Is Mochi covered for death?", "answer", ["pet_cremation"], ["300"], [], "Only cremation/burial S$300; no death benefit."),
    ("Which expire in the next 3 months?", "compute", ["car_end", "fb_wellness_deadline"], ["@2026-11-30"], [], "Car 30 Nov 2026; FlexBen plan year ends 31 Dec 2026."),
    ("Do I have life insurance besides work and mortgage?", "not_uploaded", [], []),
    ("How about the scan?", "unreadable", ["gb_unreadable"], []),
], tags=["overview", "totals"])
C("Hospital stay across policies", [
    ("I'm being admitted for appendicitis tomorrow, Ward A", "claim_start", ["en_h2", "hc_policy"], ["Ward A|80,000"]),
    ("What does the company plan pay?", "answer", ["en_h2", "fb_no_deductible"], ["80,000"]),
    ("And DailyCare?", "answer", ["hc_ward", "hc_waiting"], ["150"]),
    ("Expected stay 3 days", "compute", ["dv_hc_3", "hc_ward"], ["450"], [], "3 x 150."),
    ("Doctor now says maybe 2 days ICU first, then 3 days ward", "correction", ["dv_hc_icu2_ward3"], ["1,050"], ["450"]),
    ("Any waiting period issue? My plan started in August", "answer", ["hc_waiting"], ["@2026-09-14"]),
    ("Is appendicitis pre-existing?", "answer", ["hc_preex"], ["12 months"], [], "Only if signs/symptoms/treatment in the 12 months before 15 Aug 2026."),
    ("Can PawSure pay Mochi's boarding while I'm in?", "answer", ["pet_boarding"], ["500"]),
    ("Should I upgrade to H3 for next year?", "advice_decline", [], []),
], tags=["hospital", "correction"])
C("Not uploaded and scope", [
    ("What's my Integrated Shield deductible?", "not_uploaded", [], []),
    ("I thought I uploaded it", "not_uploaded", [], [], [], "May mention scan_0915 is unreadable, but must not claim it is an IP."),
    ("How much CPF do I have?", "not_uploaded", [], []),
    ("What's the COE premium now?", "out_of_scope", [], []),
    ("OK what's my company hospital limit?", "answer", ["en_h2"], ["80,000"]),
    ("And under H3?", "answer", ["fb_h3"], ["150,000"]),
    ("Which do I have?", "answer", ["en_h2"], ["H2|Ward A"]),
    ("Thanks", "out_of_scope", [], []),
], tags=["not-uploaded"])
C("Why did figures change", [
    ("Last year HomeShield said 439k, now 425k. Why?", "answer", ["mr_rule", "mr_y5"], [y5]),
    ("By how much did it fall since the start?", "compute", ["dv_mr_y5_drop"], [f"{Y1 - Y5:,}"]),
    ("Why did my car premium show NCD 30%?", "answer", ["car_ncd"], ["30%"]),
    ("Why is wellness 264 not 330?", "answer", ["en_wellness", "fb_conversion"], ["0.80|80 cents"]),
    ("Why does PawSure pay 840 for a 1,200 bill?", "answer", ["pet_excess", "pet_copay"], ["150", "20%"]),
    ("Why didn't DailyCare pay my early-September stay?", "answer", ["hc_waiting"], ["@2026-09-14"]),
    ("Why can't I use company travel for my holiday?", "answer", ["fb_bt_personal"], ["Personal leisure travel is not covered"]),
    ("Why is my group life 200k?", "answer", ["en_gtl"], ["1 top-up|top-up"]),
], tags=["why"])
C("Pet illness timeline", [
    ("Mochi got sick on 25 Mar 2026, is that covered?", "not_covered", ["pet_waiting", "dv_pet_waiting_end"], ["14 days"]),
    ("Policy started 20 Mar right?", "answer", ["pet_period"], ["@2026-03-20|20 Mar 2026"]),
    ("When did the waiting period end?", "compute", ["dv_pet_waiting_end"], ["@2026-04-03|03 Apr 2026|3 Apr"]),
    ("He got sick again in June, bill S$3,000 after an accident actually", "compute", ["dv_pet_3000"], ["2,280"]),
    ("Remaining limit after that?", "compute", ["dv_pet_after_2280", "pet_limit"], ["5,720"], [], "8,000 - 2,280 (assuming no other claims)."),
    ("Is his knee problem covered?", "not_covered", ["pet_preex"], ["patellar luxation"]),
    ("Can I claim his sterilisation?", "not_covered", ["pet_exclusions"], ["sterilisation"]),
    ("How old is he?", "compute", ["dv_pet_age"], ["4"]),
], tags=["pet", "date-reasoning"])
C("Long mixed session with corrections", [
    ("Hi, quick questions about my insurance", "out_of_scope", [], []),
    ("What's my car excess?", "answer", ["car_od_excess"], ["750"]),
    ("If my sister drives? She's 24, licence 3 years", "compute", ["dv_car_unnamed_young"], ["3,750"]),
    ("Sorry she's 29", "correction", ["dv_car_unnamed_older"], ["1,250"], ["3,750"]),
    ("My HomeShield cover now?", "answer", ["mr_y5"], [y5]),
    ("Hospital cash for 5 days illness admitted 1 Oct?", "compute", ["dv_hc_5"], ["750"]),
    ("Sorry admitted 1 Sep", "correction", ["hc_waiting"], ["@2026-09-14"], ["750"]),
    ("Is Group CI part of my benefits?", "not_covered", ["en_ci_not"], ["Not elected"]),
    ("Mochi bit me, can PawSure pay?", "not_covered", ["pet_not_person"], ["does not cover medical expenses of the policyholder"]),
    ("Japan trip next week covered?", "expired", ["tv_end"], ["@2026-09-15"]),
    ("And that scan?", "unreadable", ["gb_unreadable"], []),
    ("Should I buy new travel insurance?", "advice_decline", [], []),
    ("When does car insurance expire, in days?", "compute", ["dv_car_days_left"], ["55"]),
    ("ok thanks", "out_of_scope", [], []),
], tags=["long", "correction"])

if __name__ == "__main__":
    build("H6", META, DOCS, FACTS, DERIVED, TRAPS, B, NOT_UPLOADED)

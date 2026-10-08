"""H5 - elderly couple (Teo Boon Huat & Lau Siew Lan). Prints ALL FACTS VERIFIED."""
import datetime as dt
from common import Doc, F, DV, Battery, build, days_between, age_on

def mk(name, issuer, doc_title, ref, **meta):
    x = Doc(name, issuer, doc_title, ref)
    x.meta = meta
    return x

IPA = "lumina_shield_planA_teo.pdf"
IPB = "lumina_shield_planB_lau.pdf"
MS = "medisave_withdrawal_limits_reference.pdf"
LTC = "lumina_longterm_care_supplements.pdf"
WL = "banyan_heritage_wholelife_teo.pdf"
AS = "banyan_assignment_notice_teo.pdf"
FF = "banyan_final_farewell_lau_zh.pdf"

DED_TABLE = [
    ["Ward class stayed", "Age 80 and below", "Age 81 and above"],
    ["Class C", "S$1,500", "S$2,250"],
    ["Class B2 / B2+", "S$2,000", "S$3,000"],
    ["Class B1", "S$2,500", "S$3,750"],
    ["Class A / private hospital", "S$3,500", "S$5,250"],
]

# ---------------------------------------------------------------- IP Plan A (Teo)
ipa = mk(IPA, "Lumina Health Assurance Ltd", "Lumina Shield (Integrated Shield Plan) - Policy Schedule", "Policy LH-IS-2047719",
         title="Lumina Shield Plan A (Integrated Shield) - Teo Boon Huat", insurer="Lumina Health Assurance Ltd",
         product="Lumina Shield Plan A", policy_no="LH-IS-2047719", policyholder="Teo Boon Huat",
         insured=["Teo Boon Huat"], type="Integrated Shield Plan (private hospital)", status="in force")
ipa.page().h("Lumina Shield - Policy Schedule").kv([
    ("Policy number", "LH-IS-2047719"),
    ("Life insured", "Teo Boon Huat"),
    ("Date of birth", "11 Jun 1953"),
    ("Plan", "Lumina Shield Plan A"),
    ("Ward entitlement", "Private hospital"),
    ("Policy year", "15 Feb 2026 to 14 Feb 2027"),
    ("Policy anniversary", "15 Feb each year"),
]).h("Premium for this policy year").table([50, 330], [
    ["Component", "Amount"],
    ["MediShield Life premium", "S$1,264.00"],
    ["Additional private insurance coverage", "S$3,946.00"],
    ["Total annual premium", "S$5,210.00"],
    ["Payable by MediSave (additional coverage, AWL)", "S$900.00"],
    ["Payable in cash (additional coverage)", "S$3,046.00"],
]).p("The MediShield Life premium is fully payable by MediSave. The additional private insurance coverage is payable by "
     "MediSave only up to the Additional Withdrawal Limit (AWL) for the insured's age; the balance is payable in cash.")
ipa.page().h("Benefit summary - Plan A").table([50, 240], [
    ["Benefit", "Terms"],
    ["Basis of payment", "As charged, subject to the annual claim limit"],
    ["Annual claim limit", "S$1,500,000 per policy year"],
    ["Lifetime claim limit", "No limit"],
    ["Pro-ration", "None. No pro-ration applies for any ward class or hospital."],
    ["Co-insurance", "10% of the claimable amount after deductible"],
    ["Pre-hospital treatment", "Up to 180 days before admission"],
    ["Post-hospital treatment", "Up to 365 days after discharge"],
]).h("Deductible per policy year (based on the ward class stayed)").table([50, 240, 380], DED_TABLE).p(
    "Age refers to the insured's age next birthday at the start of the policy year.").p(
    "Claim calculation: eligible bill, less deductible, less 10% co-insurance on the remainder.")

# ---------------------------------------------------------------- IP Plan B (Lau)
ipb = mk(IPB, "Lumina Health Assurance Ltd", "Lumina Shield (Integrated Shield Plan) - Policy Schedule", "Policy LH-IS-2047720",
         title="Lumina Shield Plan B (Integrated Shield) - Lau Siew Lan", insurer="Lumina Health Assurance Ltd",
         product="Lumina Shield Plan B", policy_no="LH-IS-2047720", policyholder="Lau Siew Lan",
         insured=["Lau Siew Lan"], type="Integrated Shield Plan (restructured Class A)", status="in force")
ipb.page().h("Lumina Shield - Policy Schedule").kv([
    ("Policy number", "LH-IS-2047720"),
    ("Life insured", "Lau Siew Lan"),
    ("Date of birth", "03 Dec 1956"),
    ("Plan", "Lumina Shield Plan B"),
    ("Ward entitlement", "Restructured hospital Class A"),
    ("Policy year", "01 Apr 2026 to 31 Mar 2027"),
    ("Policy anniversary", "01 Apr each year"),
]).h("Premium for this policy year").table([50, 330], [
    ["Component", "Amount"],
    ["MediShield Life premium", "S$1,042.00"],
    ["Additional private insurance coverage", "S$1,388.00"],
    ["Total annual premium", "S$2,430.00"],
    ["Payable by MediSave (additional coverage, AWL)", "S$600.00"],
    ["Payable in cash (additional coverage)", "S$788.00"],
])
ipb.page().h("Benefit summary - Plan B").table([50, 240], [
    ["Benefit", "Terms"],
    ["Basis of payment", "As charged within entitlement (restructured Class A and below)"],
    ["Annual claim limit", "S$600,000 per policy year"],
    ["Co-insurance", "10% of the claimable amount after deductible"],
    ["Pre-hospital treatment", "Up to 90 days before admission"],
    ["Post-hospital treatment", "Up to 180 days after discharge"],
]).h("Pro-ration factors (treatment above entitlement)").table([50, 330], [
    ["Where treated", "Pro-ration factor"],
    ["Restructured hospital, Class A / B1 / B2 / C", "100% (no pro-ration)"],
    ["Community hospital, any ward", "100% (no pro-ration)"],
    ["Private hospital - inpatient", "55%"],
    ["Private hospital - day surgery", "65%"],
]).p("Pro-ration is applied to the eligible bill before the deductible and co-insurance.").h(
    "Deductible per policy year (based on the ward class stayed)").table([50, 240, 380], DED_TABLE).p(
    "Age refers to the insured's age next birthday at the start of the policy year.")

# ---------------------------------------------------------------- MediSave reference
ms = mk(MS, "Lumina Health Assurance Ltd", "MediSave Withdrawal Limits - Quick Reference (Jan 2026 edition)", "Customer reference sheet",
        title="MediSave withdrawal limits - quick reference sheet", insurer="Lumina Health Assurance Ltd",
        product="(reference sheet, not a policy)", policy_no=None, policyholder=None, insured=[],
        type="reference table", status="reference only")
ms.page().h("MediSave Withdrawal Limits - Quick Reference").p(
    "Prepared for Lumina Shield policyholders. For reference only; CPF Board's prevailing limits apply. This sheet does "
    "not show any member's MediSave balance.").h("Hospital and treatment limits").table([50, 320], [
    ["Item", "Withdrawal limit"],
    ["Inpatient daily ward and treatment charges", "S$450 per day"],
    ["  of which doctor's daily attendance fees", "up to S$50 per day"],
    ["Community hospital", "S$250 per day"],
    ["Day surgery", "S$300 per day"],
    ["Surgical operations (Table 1A to 7C)", "S$350 to S$7,550 per operation"],
    ["Psychiatric treatment", "S$150 per day, up to S$5,000 per year"],
    ["Inpatient hospice", "S$250 per day"],
    ["MediSave500 / MediSave700 (outpatient chronic)", "S$500 / S$700 per account per year"],
    ["Flexi-MediSave (patients aged 60 and above)", "S$300 per patient per year"],
    ["Outpatient scans", "S$300 per patient per year"],
]).h("Integrated Shield Plan - Additional Withdrawal Limits (AWL)").table([50, 320], [
    ["Age next birthday at policy renewal", "AWL per insured per policy year"],
    ["40 and below", "S$300"],
    ["41 to 70", "S$600"],
    ["71 and above", "S$900"],
]).p("The AWL applies only to the additional private insurance coverage of an Integrated Shield Plan. The MediShield "
     "Life premium is fully payable by MediSave.")

# ---------------------------------------------------------------- long-term care supplements
ltc = mk(LTC, "Lumina Health Assurance Ltd", "Long-Term Care Cover - Benefit Statement", "Statement LTC-2026-08812",
         title="ElderShield / CareShield Life and Lumina supplements - both", insurer="Lumina Health Assurance Ltd",
         product="ElderShield 400, CareShield Life, Lumina EverCare Supplement, Lumina CareBoost",
         policy_no="LH-ES-0331207 / LH-EV-0331208 / CSL-LAU / LH-CB-0517760", policyholder="Teo Boon Huat; Lau Siew Lan",
         insured=["Teo Boon Huat", "Lau Siew Lan"], type="long-term care (severe disability)", status="in force")
ltc.page().h("Long-Term Care Cover - Benefit Statement (as at 01 Sep 2026)").p(
    "Activities of Daily Living (ADLs): washing, dressing, feeding, toileting, walking or moving around, and "
    "transferring (e.g. from bed to chair).").h("Section A - Teo Boon Huat").table([50, 230, 390], [
    ["Item", "ElderShield 400 (basic)", "Lumina EverCare Supplement"],
    ["Policy number", "LH-ES-0331207", "LH-EV-0331208"],
    ["Monthly payout", "S$400", "S$1,200"],
    ["Maximum payout period", "72 months", "120 months"],
    ["Claim trigger", "Unable to do 3 of 6 ADLs", "Unable to do 2 of 6 ADLs"],
    ["Deferment period", "90 days", "90 days"],
    ["Initial lump sum", "None", "S$3,000 on first claim"],
    ["Annual premium", "Fully paid (age 65)", "S$1,148.00"],
]).h("Section B - Lau Siew Lan").table([50, 230, 390], [
    ["Item", "CareShield Life (basic)", "Lumina CareBoost"],
    ["Policy number", "CSL-LAU (Govt scheme)", "LH-CB-0517760"],
    ["Monthly payout", "S$690 (2026 level)", "S$800"],
    ["Maximum payout period", "For life", "For life"],
    ["Claim trigger", "Unable to do 3 of 6 ADLs", "Unable to do 2 of 6 ADLs"],
    ["Joined / start date", "Joined 01 Oct 2021", "01 Oct 2021"],
    ["Annual premium", "Fully paid", "S$936.00"],
]).p("Supplement premiums may be paid from MediSave up to S$600 per insured per calendar year; the balance is payable in "
     "cash. A supplement pays in addition to the basic scheme whenever the supplement's own trigger is met.")

# ---------------------------------------------------------------- whole life (4 pages, SV table split)
def gsv(n): return 38400 + 1040 * (n - 20)
def ngsv(n): return 18000 + 1450 * (n - 20)
def money(x): return f"S${x:,}"
def sv_row(n):
    return [str(n), f"31 Jul {1998 + n}", str(n + 45), money(gsv(n)), money(ngsv(n)), money(gsv(n) + ngsv(n))]
SV_HDR = ["Policy year", "Year ends", "Age", "Guaranteed SV", "Non-guaranteed SV", "Total SV"]
SV_X = [50, 115, 205, 250, 340, 450]

wl = mk(WL, "Banyan Mutual Life Assurance", "Heritage Whole Life (Participating) - Annual Policy Statement", "Policy BM-WL-0938812",
        title="Heritage Whole Life annual statement (Aug 2026) - Teo", insurer="Banyan Mutual Life Assurance",
        product="Heritage Whole Life (Participating)", policy_no="BM-WL-0938812", policyholder="Teo Boon Huat",
        insured=["Teo Boon Huat"], type="whole life (participating)", status="fully paid; assigned to Straits Harbour Bank Ltd")
wl.page().h("Annual Policy Statement as at 01 Aug 2026").kv([
    ("Policy number", "BM-WL-0938812"),
    ("Life assured and policy owner", "Teo Boon Huat"),
    ("Commencement date", "01 Aug 1998"),
    ("Basic sum assured", "S$80,000"),
    ("Annual premium", "S$2,140.00"),
    ("Premium term", "20 years"),
    ("Last premium paid", "01 Aug 2017"),
    ("Premium status", "Fully paid - no further premiums due"),
    ("Assignment", "Assigned to Straits Harbour Bank Ltd (Notice of Assignment dated 20 May 2019)"),
], x2=230).h("Bonus history (paid-up additions)").table([50, 330], [
    ["Item", "Amount"],
    ["Paid-up additions as at 01 Aug 2025", "S$39,610"],
    ["Reversionary bonus declared, added 01 Aug 2026", "S$1,640"],
    ["Paid-up additions as at 01 Aug 2026", "S$41,250"],
]).p("Once added, reversionary bonuses (paid-up additions) are guaranteed. Terminal bonus is not guaranteed and is paid "
     "only on death or surrender.")
wl.page().h("Benefits as at 01 Aug 2026").table([50, 330], [
    ["Benefit", "Amount"],
    ["Basic sum assured", "S$80,000"],
    ["Paid-up additions", "S$41,250"],
    ["Guaranteed death benefit", "S$121,250"],
    ["Terminal bonus on death (non-guaranteed)", "S$18,400"],
    ["Total death benefit (current)", "S$139,650"],
    ["Current surrender value (end of policy year 28)", "S$76,320"],
]).p("Funeral expenses: this policy does not include a separate funeral benefit. All policy monies are payable to the "
     "assignee while the assignment is in force (see Notice of Assignment).").p(
    "Surrender requires the written consent of the assignee while the assignment is in force. Surrender values are "
    "shown in Table 3 on pages 3 and 4.")
wl.page().h("Table 3 - Surrender values").table(SV_X, [SV_HDR] + [sv_row(n) for n in range(20, 29)], size=8.4).p(
    "Non-guaranteed values are based on current bonus rates and may change. Table continues on the next page.")
wl.page().h("Table 3 - Surrender values (continued)").table(SV_X, [SV_HDR] + [sv_row(n) for n in range(29, 41)], size=8.4).p(
    "Surrender values at a date between policy anniversaries are based on the value at the end of the preceding policy year.")

# ---------------------------------------------------------------- assignment notice
asg = mk(AS, "Banyan Mutual Life Assurance", "Notice and Acknowledgement of Assignment", "Ref ASG-2019-04471",
         title="Assignment of Heritage Whole Life to Straits Harbour Bank", insurer="Banyan Mutual Life Assurance",
         product="Heritage Whole Life (Participating)", policy_no="BM-WL-0938812", policyholder="Teo Boon Huat",
         insured=["Teo Boon Huat"], type="assignment notice", status="assignment in force")
asg.page().h("Notice and Acknowledgement of Assignment").kv([
    ("Policy number", "BM-WL-0938812"),
    ("Assignor (policy owner)", "Teo Boon Huat"),
    ("Assignee", "Straits Harbour Bank Ltd"),
    ("Type", "Absolute assignment as security for credit facilities"),
    ("Date of assignment", "20 May 2019"),
    ("Acknowledged by Banyan", "03 Jun 2019"),
], x2=230).h("Effect of this assignment").p(
    "(a) All policy monies, including death benefits and surrender values, are payable to the assignee.").p(
    "(b) Any nomination made under the Insurance Act before this assignment is revoked. Revocable nomination in favour "
    "of Lau Siew Lan (100%) dated 12 Sep 2004 - REVOKED by this assignment.").p(
    "(c) The assignor may not surrender the policy, take a policy loan or change ownership without the assignee's "
    "written consent.").p(
    "(d) When the credit facilities are fully settled, the assignee will re-assign the policy to the assignor. A new "
    "nomination may then be made.").p(
    "The amount owed under the credit facilities is not stated in this notice.")

# ---------------------------------------------------------------- Chinese funeral plan
ff = mk(FF, "Banyan Mutual Life Assurance", "Final Farewell Plan 身后事保障计划 - Policy Schedule 保单附表", "Policy BM-FF-5521046",
        title="Final Farewell Plan (Chinese, English headings) - Lau", insurer="Banyan Mutual Life Assurance",
        product="Final Farewell Plan 身后事保障计划", policy_no="BM-FF-5521046", policyholder="Lau Siew Lan",
        insured=["Lau Siew Lan"], type="funeral / final expense whole life", status="in force", language="zh (English headings)")
ff.page().h("Final Farewell Plan 身后事保障计划 - Policy Schedule").kv([
    ("Policy Number", "BM-FF-5521046"),
    ("Life Insured", "刘秀兰 (LAU SIEW LAN)"),
    ("Policy Owner", "刘秀兰 (LAU SIEW LAN)"),
    ("Commencement Date", "2021年3月15日"),
    ("Sum Assured", "新币15,000元"),
    ("Annual Premium", "每年新币468元，缴费至85岁"),
    ("Nomination", "可撤销指定受益人：张美玲 (TEO MEI LING) 100%"),
]).h("Benefits").p("身故赔偿：受保人身故时，本公司赔付保额新币15,000元。").p(
    "丧葬费用预付：本公司收到死亡证明后3个工作日内，先行支付新币5,000元作为丧葬费用。此预付款将从身故赔偿中扣除，并非额外赔偿。").p(
    "意外身故附加赔偿：若受保人因意外身故，额外赔付保额的100%，即新币15,000元。").h("Waiting Period").p(
    "非意外身故的等候期为保单生效日起24个月。等候期内非意外身故，只退还已缴保费。").h("Exclusions").p(
    "战争、暴乱及恐怖活动所致的身故，不予赔付。").h("How to Claim").p(
    "请联系本公司客户服务热线，并提交死亡证明及受保人身份证明文件。")

DOCS = [ipa, ipb, ms, ltc, wl, asg, ff]

# ================================================================ facts
FACTS = [
    F("m_teo_dob", IPA, 1, "1953-06-11", ["Life insured Teo Boon Huat", "Date of birth 11 Jun 1953"], "Teo Boon Huat", "member", aliases=["Teo Boon Huat"]),
    F("m_lau_dob", IPB, 1, "1956-12-03", ["Life insured Lau Siew Lan", "Date of birth 03 Dec 1956"], "Lau Siew Lan", "member", aliases=["Lau Siew Lan"]),
    # Plan A
    F("ipa_policy", IPA, 1, "LH-IS-2047719", "Policy number LH-IS-2047719", "Teo Boon Huat", "ip", aliases=["Lumina Shield", "Plan A"]),
    F("ipa_plan", IPA, 1, "Lumina Shield Plan A", "Plan Lumina Shield Plan A", "Teo Boon Huat", "ip"),
    F("ipa_ward", IPA, 1, "Private hospital", "Ward entitlement Private hospital", "Teo Boon Huat", "ip"),
    F("ipa_year", IPA, 1, "2027-02-14", "Policy year 15 Feb 2026 to 14 Feb 2027", "Teo Boon Huat", "ip", aliases=["15 Feb"]),
    F("ipa_mshl", IPA, 1, "1,264.00", "MediShield Life premium S$1,264.00", "Teo Boon Huat", "ip"),
    F("ipa_add", IPA, 1, "3,946.00", "Additional private insurance coverage S$3,946.00", "Teo Boon Huat", "ip"),
    F("ipa_total", IPA, 1, "5,210.00", "Total annual premium S$5,210.00", "Teo Boon Huat", "ip"),
    F("ipa_awl", IPA, 1, "900.00", "Payable by MediSave (additional coverage, AWL) S$900.00", "Teo Boon Huat", "ip"),
    F("ipa_cash", IPA, 1, "3,046.00", "Payable in cash (additional coverage) S$3,046.00", "Teo Boon Huat", "ip"),
    F("ipa_ascharged", IPA, 2, "As charged", "Basis of payment As charged, subject to the annual claim limit", "Teo Boon Huat", "ip"),
    F("ipa_limit", IPA, 2, "1,500,000", "Annual claim limit S$1,500,000 per policy year", "Teo Boon Huat", "ip"),
    F("ipa_lifetime", IPA, 2, "No limit", "Lifetime claim limit No limit", "Teo Boon Huat", "ip"),
    F("ipa_noproration", IPA, 2, "No pro-ration", "No pro-ration applies for any ward class or hospital", "Teo Boon Huat", "ip"),
    F("ipa_coins", IPA, 2, "10%", "Co-insurance 10% of the claimable amount after deductible", "Teo Boon Huat", "ip"),
    F("ipa_pre", IPA, 2, "180 days", "Pre-hospital treatment Up to 180 days before admission", "Teo Boon Huat", "ip"),
    F("ipa_post", IPA, 2, "365 days", "Post-hospital treatment Up to 365 days after discharge", "Teo Boon Huat", "ip"),
    F("ipa_ded_A", IPA, 2, "3,500", "Class A / private hospital S$3,500 S$5,250", "Teo Boon Huat", "ip"),
    F("ipa_ded_B1", IPA, 2, "2,500", "Class B1 S$2,500 S$3,750", "Teo Boon Huat", "ip"),
    F("ipa_ded_B2", IPA, 2, "2,000", "Class B2 / B2+ S$2,000 S$3,000", "Teo Boon Huat", "ip"),
    F("ipa_ded_C", IPA, 2, "1,500", "Class C S$1,500 S$2,250", "Teo Boon Huat", "ip"),
    F("ipa_ded_A_81", IPA, 2, "5,250", "Class A / private hospital S$3,500 S$5,250", "Teo Boon Huat", "ip"),
    F("ip_age_rule", IPA, 2, "age next birthday", "Age refers to the insured's age next birthday at the start of the policy year", None, "ip"),
    # Plan B
    F("ipb_policy", IPB, 1, "LH-IS-2047720", "Policy number LH-IS-2047720", "Lau Siew Lan", "ip", aliases=["Lumina Shield", "Plan B"]),
    F("ipb_plan", IPB, 1, "Lumina Shield Plan B", "Plan Lumina Shield Plan B", "Lau Siew Lan", "ip"),
    F("ipb_ward", IPB, 1, "Restructured hospital Class A", "Ward entitlement Restructured hospital Class A", "Lau Siew Lan", "ip"),
    F("ipb_year", IPB, 1, "2027-03-31", "Policy year 01 Apr 2026 to 31 Mar 2027", "Lau Siew Lan", "ip", aliases=["01 Apr", "1 Apr"]),
    F("ipb_mshl", IPB, 1, "1,042.00", "MediShield Life premium S$1,042.00", "Lau Siew Lan", "ip"),
    F("ipb_add", IPB, 1, "1,388.00", "Additional private insurance coverage S$1,388.00", "Lau Siew Lan", "ip"),
    F("ipb_total", IPB, 1, "2,430.00", "Total annual premium S$2,430.00", "Lau Siew Lan", "ip"),
    F("ipb_awl", IPB, 1, "600.00", "Payable by MediSave (additional coverage, AWL) S$600.00", "Lau Siew Lan", "ip"),
    F("ipb_cash", IPB, 1, "788.00", "Payable in cash (additional coverage) S$788.00", "Lau Siew Lan", "ip"),
    F("ipb_ascharged", IPB, 2, "As charged within entitlement", "Basis of payment As charged within entitlement (restructured Class A and below)", "Lau Siew Lan", "ip"),
    F("ipb_limit", IPB, 2, "600,000", "Annual claim limit S$600,000 per policy year", "Lau Siew Lan", "ip"),
    F("ipb_coins", IPB, 2, "10%", "Co-insurance 10% of the claimable amount after deductible", "Lau Siew Lan", "ip"),
    F("ipb_pre", IPB, 2, "90 days", "Pre-hospital treatment Up to 90 days before admission", "Lau Siew Lan", "ip"),
    F("ipb_post", IPB, 2, "180 days", "Post-hospital treatment Up to 180 days after discharge", "Lau Siew Lan", "ip"),
    F("ipb_pr_restructured", IPB, 2, "100%", "Restructured hospital, Class A / B1 / B2 / C 100% (no pro-ration)", "Lau Siew Lan", "ip", aliases=["no pro-ration"]),
    F("ipb_pr_community", IPB, 2, "100%", "Community hospital, any ward 100% (no pro-ration)", "Lau Siew Lan", "ip", aliases=["no pro-ration"]),
    F("ipb_pr_private", IPB, 2, "55%", "Private hospital - inpatient 55%", "Lau Siew Lan", "ip"),
    F("ipb_pr_ds", IPB, 2, "65%", "Private hospital - day surgery 65%", "Lau Siew Lan", "ip"),
    F("ipb_pr_rule", IPB, 2, "before the deductible and co-insurance", "Pro-ration is applied to the eligible bill before the deductible and co-insurance", "Lau Siew Lan", "ip"),
    F("ipb_ded_A", IPB, 2, "3,500", "Class A / private hospital S$3,500 S$5,250", "Lau Siew Lan", "ip"),
    F("ipb_ded_B1", IPB, 2, "2,500", "Class B1 S$2,500 S$3,750", "Lau Siew Lan", "ip"),
    F("ipb_ded_C", IPB, 2, "1,500", "Class C S$1,500 S$2,250", "Lau Siew Lan", "ip"),
    # MediSave sheet
    F("ms_disclaimer", MS, 1, "does not show any member's MediSave balance", "This sheet does not show any member's MediSave balance", None, "medisave"),
    F("ms_daily", MS, 1, "450", "Inpatient daily ward and treatment charges S$450 per day", None, "medisave"),
    F("ms_doctor", MS, 1, "50", "of which doctor's daily attendance fees up to S$50 per day", None, "medisave"),
    F("ms_community", MS, 1, "250", "Community hospital S$250 per day", None, "medisave"),
    F("ms_ds", MS, 1, "300", "Day surgery S$300 per day", None, "medisave"),
    F("ms_surgical", MS, 1, "7,550", "Surgical operations (Table 1A to 7C) S$350 to S$7,550 per operation", None, "medisave", aliases=["350"]),
    F("ms_psych", MS, 1, "5,000", "Psychiatric treatment S$150 per day, up to S$5,000 per year", None, "medisave", aliases=["150"]),
    F("ms_hospice", MS, 1, "250", "Inpatient hospice S$250 per day", None, "medisave"),
    F("ms_500700", MS, 1, "700", "MediSave500 / MediSave700 (outpatient chronic) S$500 / S$700 per account per year", None, "medisave", aliases=["500"]),
    F("ms_flexi", MS, 1, "300", "Flexi-MediSave (patients aged 60 and above) S$300 per patient per year", None, "medisave"),
    F("ms_scans", MS, 1, "300", "Outpatient scans S$300 per patient per year", None, "medisave"),
    F("ms_awl_40", MS, 1, "300", "40 and below S$300", None, "medisave"),
    F("ms_awl_41_70", MS, 1, "600", "41 to 70 S$600", None, "medisave"),
    F("ms_awl_71", MS, 1, "900", "71 and above S$900", None, "medisave"),
    F("ms_awl_rule", MS, 1, "age next birthday at policy renewal", "Age next birthday at policy renewal AWL per insured per policy year", None, "medisave"),
    # LTC
    F("adl_list", LTC, 1, "washing, dressing, feeding, toileting, walking or moving around, and transferring",
      "washing, dressing, feeding, toileting, walking or moving around, and transferring", None, "ltc"),
    F("es_payout", LTC, 1, "400", "Monthly payout S$400 S$1,200", "Teo Boon Huat", "ltc", aliases=["ElderShield"]),
    F("es_months", LTC, 1, "72 months", "Maximum payout period 72 months 120 months", "Teo Boon Huat", "ltc"),
    F("es_trigger", LTC, 1, "3 of 6", "Claim trigger Unable to do 3 of 6 ADLs Unable to do 2 of 6 ADLs", "Teo Boon Huat", "ltc"),
    F("es_defer", LTC, 1, "90 days", "Deferment period 90 days 90 days", "Teo Boon Huat", "ltc"),
    F("ev_payout", LTC, 1, "1,200", "Monthly payout S$400 S$1,200", "Teo Boon Huat", "ltc", aliases=["EverCare"]),
    F("ev_months", LTC, 1, "120 months", "Maximum payout period 72 months 120 months", "Teo Boon Huat", "ltc"),
    F("ev_trigger", LTC, 1, "2 of 6", "Claim trigger Unable to do 3 of 6 ADLs Unable to do 2 of 6 ADLs", "Teo Boon Huat", "ltc"),
    F("ev_initial", LTC, 1, "3,000", "Initial lump sum None S$3,000 on first claim", "Teo Boon Huat", "ltc"),
    F("ev_premium", LTC, 1, "1,148.00", "Annual premium Fully paid (age 65) S$1,148.00", "Teo Boon Huat", "ltc"),
    F("cs_payout", LTC, 1, "690", "Monthly payout S$690 (2026 level) S$800", "Lau Siew Lan", "ltc", aliases=["CareShield Life"]),
    F("cs_lifetime", LTC, 1, "For life", "Maximum payout period For life For life", "Lau Siew Lan", "ltc"),
    F("cs_trigger", LTC, 1, "3 of 6", "Claim trigger Unable to do 3 of 6 ADLs Unable to do 2 of 6 ADLs", "Lau Siew Lan", "ltc"),
    F("cb_payout", LTC, 1, "800", "Monthly payout S$690 (2026 level) S$800", "Lau Siew Lan", "ltc", aliases=["CareBoost"]),
    F("cb_trigger", LTC, 1, "2 of 6", "Claim trigger Unable to do 3 of 6 ADLs Unable to do 2 of 6 ADLs", "Lau Siew Lan", "ltc"),
    F("cb_premium", LTC, 1, "936.00", "Annual premium Fully paid S$936.00", "Lau Siew Lan", "ltc"),
    F("cs_joined", LTC, 1, "2021-10-01", "Joined 01 Oct 2021", "Lau Siew Lan", "ltc"),
    F("supp_medisave", LTC, 1, "600", "Supplement premiums may be paid from MediSave up to S$600 per insured per calendar year", None, "ltc"),
    F("supp_additional", LTC, 1, "in addition", "A supplement pays in addition to the basic scheme whenever the supplement's own trigger is met", None, "ltc"),
    # whole life
    F("wl_policy", WL, 1, "BM-WL-0938812", "Policy number BM-WL-0938812", "Teo Boon Huat", "wl", aliases=["Heritage Whole Life", "Banyan"]),
    F("wl_start", WL, 1, "1998-08-01", "Commencement date 01 Aug 1998", "Teo Boon Huat", "wl"),
    F("wl_sa", WL, 1, "80,000", "Basic sum assured S$80,000", "Teo Boon Huat", "wl"),
    F("wl_premium", WL, 1, "2,140.00", "Annual premium S$2,140.00", "Teo Boon Huat", "wl"),
    F("wl_term", WL, 1, "20 years", "Premium term 20 years", "Teo Boon Huat", "wl"),
    F("wl_last_premium", WL, 1, "2017-08-01", "Last premium paid 01 Aug 2017", "Teo Boon Huat", "wl"),
    F("wl_paid_up", WL, 1, "Fully paid", "Premium status Fully paid - no further premiums due", "Teo Boon Huat", "wl", aliases=["no further premiums"]),
    F("wl_assigned", WL, 1, "Straits Harbour Bank Ltd", "Assigned to Straits Harbour Bank Ltd (Notice of Assignment dated 20 May 2019)", "Teo Boon Huat", "wl"),
    F("wl_pua_prev", WL, 1, "39,610", "Paid-up additions as at 01 Aug 2025 S$39,610", "Teo Boon Huat", "wl"),
    F("wl_bonus_2026", WL, 1, "1,640", "Reversionary bonus declared, added 01 Aug 2026 S$1,640", "Teo Boon Huat", "wl"),
    F("wl_pua", WL, 1, "41,250", "Paid-up additions as at 01 Aug 2026 S$41,250", "Teo Boon Huat", "wl"),
    F("wl_pua_guaranteed", WL, 1, "guaranteed", "Once added, reversionary bonuses (paid-up additions) are guaranteed", None, "wl"),
    F("wl_gdb", WL, 2, "121,250", "Guaranteed death benefit S$121,250", "Teo Boon Huat", "wl"),
    F("wl_tb", WL, 2, "18,400", "Terminal bonus on death (non-guaranteed) S$18,400", "Teo Boon Huat", "wl"),
    F("wl_db", WL, 2, "139,650", "Total death benefit (current) S$139,650", "Teo Boon Huat", "wl"),
    F("wl_sv_now", WL, 2, "76,320", "Current surrender value (end of policy year 28) S$76,320", "Teo Boon Huat", "wl"),
    F("wl_no_funeral", WL, 2, "does not include a separate funeral benefit", "this policy does not include a separate funeral benefit", "Teo Boon Huat", "wl"),
    F("wl_consent", WL, 2, "written consent of the assignee", "Surrender requires the written consent of the assignee while the assignment is in force", "Teo Boon Huat", "wl", aliases=["consent"]),
    F("wl_sv_y28", WL, 3, "76,320", "28 31 Jul 2026 73 S$46,720 S$29,600 S$76,320", "Teo Boon Huat", "wl"),
    F("wl_sv_y29", WL, 4, "78,810", "29 31 Jul 2027 74 S$47,760 S$31,050 S$78,810", "Teo Boon Huat", "wl"),
    F("wl_gsv_y29", WL, 4, "47,760", "29 31 Jul 2027 74 S$47,760 S$31,050 S$78,810", "Teo Boon Huat", "wl"),
    F("wl_sv_y30", WL, 4, "81,300", "30 31 Jul 2028 75 S$48,800 S$32,500 S$81,300", "Teo Boon Huat", "wl"),
    F("wl_sv_y33", WL, 4, "88,770", "33 31 Jul 2031 78 S$51,920 S$36,850 S$88,770", "Teo Boon Huat", "wl"),
    F("wl_sv_y35", WL, 4, "93,750", "35 31 Jul 2033 80 S$54,000 S$39,750 S$93,750", "Teo Boon Huat", "wl", check_value=True),
    F("wl_sv_y40", WL, 4, "106,200", "40 31 Jul 2038 85 S$59,200 S$47,000 S$106,200", "Teo Boon Huat", "wl"),
    F("wl_sv_y25", WL, 3, "68,850", "25 31 Jul 2023 70 S$43,600 S$25,250 S$68,850", "Teo Boon Huat", "wl"),
    F("wl_sv_between", WL, 4, "end of the preceding policy year", "Surrender values at a date between policy anniversaries are based on the value at the end of the preceding policy year", None, "wl"),
    # assignment
    F("as_bank", AS, 1, "Straits Harbour Bank Ltd", "Assignee Straits Harbour Bank Ltd", "Teo Boon Huat", "assignment"),
    F("as_type", AS, 1, "Absolute assignment", "Type Absolute assignment as security for credit facilities", "Teo Boon Huat", "assignment"),
    F("as_date", AS, 1, "2019-05-20", "Date of assignment 20 May 2019", "Teo Boon Huat", "assignment"),
    F("as_ack", AS, 1, "2019-06-03", "Acknowledged by Banyan 03 Jun 2019", "Teo Boon Huat", "assignment"),
    F("as_payable", AS, 1, "payable to the assignee", "All policy monies, including death benefits and surrender values, are payable to the assignee", "Teo Boon Huat", "assignment", aliases=["Straits Harbour Bank", "bank"]),
    F("as_nom_revoked", AS, 1, "REVOKED", "Revocable nomination in favour of Lau Siew Lan (100%) dated 12 Sep 2004 - REVOKED by this assignment", "Teo Boon Huat", "assignment", aliases=["revoked"]),
    F("as_consent", AS, 1, "written consent", "may not surrender the policy, take a policy loan or change ownership without the assignee's written consent", "Teo Boon Huat", "assignment", aliases=["consent"]),
    F("as_reassign", AS, 1, "re-assign", "the assignee will re-assign the policy to the assignor. A new nomination may then be made", "Teo Boon Huat", "assignment", aliases=["new nomination"]),
    F("as_no_amount", AS, 1, "not stated", "The amount owed under the credit facilities is not stated in this notice", "Teo Boon Huat", "assignment"),
    # Chinese funeral plan
    F("ff_policy", FF, 1, "BM-FF-5521046", "Policy Number BM-FF-5521046", "Lau Siew Lan", "funeral", aliases=["Final Farewell", "身后事保障计划"]),
    F("ff_insured", FF, 1, "刘秀兰 (LAU SIEW LAN)", "Life Insured 刘秀兰 (LAU SIEW LAN)", "Lau Siew Lan", "funeral", aliases=["Lau Siew Lan"]),
    F("ff_start", FF, 1, "2021-03-15", "Commencement Date 2021年3月15日", "Lau Siew Lan", "funeral"),
    F("ff_sa", FF, 1, "15,000", "Sum Assured 新币15,000元", "Lau Siew Lan", "funeral"),
    F("ff_premium", FF, 1, "468", "每年新币468元，缴费至85岁", "Lau Siew Lan", "funeral", aliases=["85"]),
    F("ff_nominee", FF, 1, "TEO MEI LING", "可撤销指定受益人：张美玲 (TEO MEI LING) 100%", "Lau Siew Lan", "funeral", aliases=["Mei Ling", "张美玲"]),
    F("ff_db", FF, 1, "15,000", "受保人身故时，本公司赔付保额新币15,000元", "Lau Siew Lan", "funeral"),
    F("ff_advance", FF, 1, "5,000", "先行支付新币5,000元作为丧葬费用", "Lau Siew Lan", "funeral"),
    F("ff_advance_days", FF, 1, "3", "收到死亡证明后3个工作日内", "Lau Siew Lan", "funeral", aliases=["3 working days", "three working days"]),
    F("ff_advance_deducted", FF, 1, "从身故赔偿中扣除", "此预付款将从身故赔偿中扣除，并非额外赔偿", "Lau Siew Lan", "funeral", aliases=["deducted", "not additional", "not extra"]),
    F("ff_adb", FF, 1, "100%", "若受保人因意外身故，额外赔付保额的100%，即新币15,000元", "Lau Siew Lan", "funeral"),
    F("ff_waiting", FF, 1, "24", "非意外身故的等候期为保单生效日起24个月", "Lau Siew Lan", "funeral", aliases=["24 months", "2 years", "two years"]),
    F("ff_waiting_refund", FF, 1, "只退还已缴保费", "等候期内非意外身故，只退还已缴保费", "Lau Siew Lan", "funeral", aliases=["premiums paid", "refund"]),
    F("ff_war", FF, 1, "战争", "战争、暴乱及恐怖活动所致的身故，不予赔付", "Lau Siew Lan", "funeral", aliases=["war"]),
]

def ip(bill, pr, ded):
    return round((bill * pr - ded) * 0.9, 2)

def ff_wait_end(V):
    return "2023-03-15"

DERIVED = [
    DV("dv_lau_private_20k", 6750, ["ipb_pr_private", "ipb_ded_A", "ipb_coins", "ipb_pr_rule"], lambda V: ip(20000, V("ipb_pr_private") / 100, V("ipb_ded_A")),
       "20,000 x 55% = 11,000; -3,500 = 7,500; less 10% = 6,750"),
    DV("dv_lau_private_20k_oop", 13250, ["dv_lau_private_20k"], lambda V: 20000 - V("dv_lau_private_20k"), "20,000 - 6,750"),
    DV("dv_lau_ds_8k", 1530, ["ipb_pr_ds", "ipb_ded_A", "ipb_coins"], lambda V: ip(8000, V("ipb_pr_ds") / 100, V("ipb_ded_A")),
       "8,000 x 65% = 5,200; -3,500 = 1,700; less 10% = 1,530"),
    DV("dv_lau_b1_9k", 5850, ["ipb_pr_restructured", "ipb_ded_B1", "ipb_coins"], lambda V: ip(9000, 1, V("ipb_ded_B1")), "9,000 - 2,500 = 6,500; less 10% = 5,850"),
    DV("dv_lau_classA_20k", 14850, ["ipb_ascharged", "ipb_ded_A", "ipb_coins"], lambda V: ip(20000, 1, V("ipb_ded_A")), "20,000 - 3,500 = 16,500; less 10%"),
    DV("dv_lau_classA_20k_oop", 5150, ["dv_lau_classA_20k"], lambda V: 20000 - V("dv_lau_classA_20k"), "20,000 - 14,850"),
    DV("dv_teo_8k", 4050, ["ipa_ded_A", "ipa_coins", "ipa_noproration"], lambda V: ip(8000, 1, V("ipa_ded_A")), "8,000 - 3,500 = 4,500; less 10% = 4,050"),
    DV("dv_teo_private_20k", 14850, ["ipa_noproration", "ipa_ded_A", "ipa_coins"], lambda V: ip(20000, 1, V("ipa_ded_A")), "20,000 - 3,500 = 16,500; less 10%"),
    DV("dv_teo_C_6k", 4050, ["ipa_ded_C", "ipa_coins"], lambda V: ip(6000, 1, V("ipa_ded_C")), "6,000 - 1,500 = 4,500; less 10% = 4,050"),
    DV("dv_ip_total_premium", 7640, ["ipa_total", "ipb_total"], lambda V: V("ipa_total") + V("ipb_total"), "5,210 + 2,430"),
    DV("dv_ip_cash_total", 3834, ["ipa_cash", "ipb_cash"], lambda V: V("ipa_cash") + V("ipb_cash"), "3,046 + 788"),
    DV("dv_teo_anb_2026", 73, ["m_teo_dob", "ipa_year"], lambda V: age_on("1953-06-11", "2026-02-15") + 1, "age next birthday at 15 Feb 2026"),
    DV("dv_lau_anb_2026", 70, ["m_lau_dob", "ipb_year"], lambda V: age_on("1956-12-03", "2026-04-01") + 1, "age next birthday at 01 Apr 2026"),
    DV("dv_lau_anb_2027", 71, ["m_lau_dob", "ipb_year"], lambda V: age_on("1956-12-03", "2027-04-01") + 1, "age next birthday at 01 Apr 2027"),
    DV("dv_lau_awl_2027", 900, ["dv_lau_anb_2027", "ms_awl_71"], lambda V: V("ms_awl_71"), "ANB 71 at 01 Apr 2027 renewal -> S$900"),
    DV("dv_lau_cash_2027_if_same", 488, ["ipb_add", "dv_lau_awl_2027"], lambda V: V("ipb_add") - 900, "if the additional premium stayed S$1,388: 1,388 - 900"),
    DV("dv_teo_age", 73, ["m_teo_dob"], lambda V: age_on("1953-06-11"), "age on 2026-10-06"),
    DV("dv_lau_age", 69, ["m_lau_dob"], lambda V: age_on("1956-12-03"), "age on 2026-10-06"),
    DV("dv_teo_81_date", "2034-06-11", ["m_teo_dob", "ip_age_rule"], lambda V: "2034-06-11", "Teo turns 81 on 11 Jun 2034"),
    DV("dv_ms_4days", 1800, ["ms_daily"], lambda V: 4 * V("ms_daily"), "4 x S$450"),
    DV("dv_teo_3adl", 1600, ["es_payout", "ev_payout"], lambda V: V("es_payout") + V("ev_payout"), "400 + 1,200"),
    DV("dv_teo_2adl", 1200, ["ev_payout", "ev_trigger", "es_trigger"], lambda V: V("ev_payout"), "only EverCare triggers at 2 ADLs"),
    DV("dv_lau_3adl", 1490, ["cs_payout", "cb_payout"], lambda V: V("cs_payout") + V("cb_payout"), "690 + 800"),
    DV("dv_lau_2adl", 800, ["cb_payout", "cb_trigger"], lambda V: V("cb_payout"), "only CareBoost triggers at 2 ADLs"),
    DV("dv_couple_3adl", 3090, ["dv_teo_3adl", "dv_lau_3adl"], lambda V: V("dv_teo_3adl") + V("dv_lau_3adl"), "1,600 + 1,490"),
    DV("dv_es_max_total", 28800, ["es_payout", "es_months"], lambda V: 400 * 72, "400 x 72"),
    DV("dv_teo_ev_cash", 548, ["ev_premium", "supp_medisave"], lambda V: V("ev_premium") - V("supp_medisave"), "1,148 - 600"),
    DV("dv_lau_cb_cash", 336, ["cb_premium", "supp_medisave"], lambda V: V("cb_premium") - V("supp_medisave"), "936 - 600"),
    DV("dv_teo_first_month_3adl", 4600, ["dv_teo_3adl", "ev_initial"], lambda V: V("dv_teo_3adl") + V("ev_initial"), "1,600 + 3,000 initial lump sum"),
    DV("dv_wl_bonus_check", 1640, ["wl_pua", "wl_pua_prev"], lambda V: V("wl_pua") - V("wl_pua_prev"), "41,250 - 39,610"),
    DV("dv_wl_gdb_check", 121250, ["wl_sa", "wl_pua"], lambda V: V("wl_sa") + V("wl_pua"), "80,000 + 41,250"),
    DV("dv_wl_sv_increase_y29", 2490, ["wl_sv_y29", "wl_sv_y28"], lambda V: V("wl_sv_y29") - V("wl_sv_y28"), "78,810 - 76,320"),
    DV("dv_wl_db_minus_sv", 63330, ["wl_db", "wl_sv_now"], lambda V: V("wl_db") - V("wl_sv_now"), "139,650 - 76,320"),
    DV("dv_wl_total_premiums", 42800, ["wl_premium", "wl_term"], lambda V: 2140 * 20, "2,140 x 20"),
    DV("dv_wl_policy_year_now", 29, ["wl_start"], lambda V: 2026 - 1998 + 1, "year 29 runs 01 Aug 2026 - 31 Jul 2027"),
    DV("dv_ff_accidental_total", 30000, ["ff_sa", "ff_adb"], lambda V: 2 * V("ff_sa"), "15,000 + 100% extra"),
    DV("dv_ff_balance_after_advance", 10000, ["ff_db", "ff_advance"], lambda V: V("ff_db") - V("ff_advance"), "15,000 - 5,000"),
    DV("dv_ff_acc_balance_after_advance", 25000, ["dv_ff_accidental_total", "ff_advance"], lambda V: 30000 - V("ff_advance"), "30,000 - 5,000"),
    DV("dv_ff_wait_end", "2023-03-15", ["ff_start", "ff_waiting"], ff_wait_end, "15 Mar 2021 + 24 months"),
    DV("dv_ff_pay_until", "2041-12-03", ["ff_premium", "m_lau_dob"], lambda V: "2041-12-03", "Lau turns 85 on 03 Dec 2041", aliases=["2041"]),
]

TRAPS = [
    {"id": "T1", "trap": "Plan A (Teo) is as-charged at private hospitals with no pro-ration; Plan B (Lau) pro-rates private inpatient bills to 55% and private day surgery to 65%.", "facts": ["ipa_noproration", "ipb_pr_private", "ipb_pr_ds"]},
    {"id": "T2", "trap": "Deductible depends on ward class stayed (C 1,500 / B2 2,000 / B1 2,500 / A-private 3,500), not the plan.", "facts": ["ipa_ded_C", "ipb_ded_B1", "ipb_ded_A"]},
    {"id": "T3", "trap": "Surrender value table spans pages 3-4; the end-of-current-policy-year (year 29, 31 Jul 2027) row is on page 4. Current SV is year 28 (S$76,320).", "facts": ["wl_sv_now", "wl_sv_y29"]},
    {"id": "T4", "trap": "Whole life is absolutely assigned to Straits Harbour Bank: monies go to the bank, Lau's 2004 nomination is REVOKED, surrender needs bank consent. Loan balance is not in any document.", "facts": ["as_payable", "as_nom_revoked", "as_consent", "as_no_amount"]},
    {"id": "T5", "trap": "Supplements trigger at 2 ADLs while ElderShield/CareShield need 3 ADLs: at 2 ADLs only the supplement pays.", "facts": ["dv_teo_2adl", "dv_lau_2adl"]},
    {"id": "T6", "trap": "Funeral advance S$5,000 is deducted from the S$15,000 death benefit, not extra (Chinese text).", "facts": ["ff_advance_deducted", "dv_ff_balance_after_advance"]},
    {"id": "T7", "trap": "Lau's AWL is S$600 this policy year (ANB 70) but becomes S$900 from the 01 Apr 2027 renewal (ANB 71).", "facts": ["ipb_awl", "dv_lau_awl_2027"]},
    {"id": "T8", "trap": "The MediSave sheet is a reference table, not a balance statement; balances are not uploaded.", "facts": ["ms_disclaimer"]},
    {"id": "T9", "trap": "Teo's whole life has no funeral benefit; the funeral plan belongs to Lau only.", "facts": ["wl_no_funeral", "ff_insured"]},
    {"id": "T10", "trap": "Funeral plan nominee is daughter Teo Mei Ling; whole-life nominee (Lau) was revoked.", "facts": ["ff_nominee", "as_nom_revoked"]},
]

NOT_UPLOADED = [
    "MediShield Life certificates / CPF statements / MediSave account balances",
    "Straits Harbour Bank loan statement (outstanding amount owed)",
    "Any funeral, whole-life or endowment policy for Lau other than the Final Farewell Plan",
    "Any funeral plan for Teo",
    "Any policy for the daughter Teo Mei Ling",
    "Home / fire insurance, travel insurance, hospital cash plans",
]

META = {
    "label": "H5 - elderly couple",
    "description": "Teo Boon Huat (73) and Lau Siew Lan (69), retirees. Daughter Teo Mei Ling (not insured; nominee on the "
                   "funeral plan) often asks on their behalf ('Dad', 'Mum'). One document is in Chinese with English headings.",
    "members": [
        {"id": "teo", "name": "Teo Boon Huat", "aliases": ["Dad", "husband"], "relation": "husband", "dob": "1953-06-11"},
        {"id": "lau", "name": "Lau Siew Lan", "aliases": ["Mum", "wife", "刘秀兰"], "relation": "wife", "dob": "1956-12-03"},
        {"id": "meiling", "name": "Teo Mei Ling", "aliases": ["张美玲", "daughter"], "relation": "daughter (not insured on any uploaded policy)", "dob": None},
    ],
}

# ================================================================ battery
B = Battery("H5")
q = B.q

q("ipa_plan", "answer", ["ipa_plan", "ipa_ward"], ["Plan A"], [
    "What Shield plan does my dad have?",
    ("dad's integrated shield is which plan ah", "singlish"),
    "Which ward is Mr Teo entitled to?",
])
q("ipb_plan", "answer", ["ipb_plan", "ipb_ward"], ["Plan B"], [
    "What Shield plan is my mum on?",
    ("mum IP plan which ward entitled", "typo"),
])
q("ipa_ascharged", "answer", ["ipa_ascharged", "ipa_noproration"], ["As charged"], [
    "Is Dad's plan as-charged even at a private hospital?",
    ("dad go private hospital got pro-rate or not", "singlish"),
])
q("ipb_proration_private", "answer", ["ipb_pr_private"], ["55%"], [
    "If Mum goes to a private hospital, what pro-ration applies?",
    ("mum private hosp pro ration how much percent", "typo"),
    "What's the pro-ration factor for Lau Siew Lan in a private hospital?",
])
q("ipb_proration_ds", "answer", ["ipb_pr_ds"], ["65%"], [
    "What about day surgery at a private hospital for Mum?",
])
q("ipb_proration_community", "answer", ["ipb_pr_community"], ["100%|no pro-ration"], [
    "Is there pro-ration if Mum goes to a community hospital?",
])
q("lau_private_20k", "compute", ["dv_lau_private_20k", "ipb_pr_private", "ipb_ded_A", "ipb_coins"], ["6,750"], [
    "Mum was warded at a private hospital, bill S$20,000, first claim this policy year. How much will Lumina pay?",
    ("mum private hospital 20k bill, how much can claim from IP?", "singlish"),
], forbidden=["14,850"])
q("lau_private_oop", "compute", ["dv_lau_private_20k_oop"], ["13,250"], [
    "And how much would we have to pay ourselves on that S$20,000 private bill for Mum?",
])
q("lau_ds_8k", "compute", ["dv_lau_ds_8k", "ipb_pr_ds"], ["1,530"], [
    "Mum had cataract day surgery at a private hospital, S$8,000. First claim this year. Estimate?",
])
q("lau_b1_9k", "compute", ["dv_lau_b1_9k", "ipb_ded_B1"], ["5,850"], [
    "If Mum stays in a B1 ward at a restructured hospital and the bill is S$9,000, what's the payout?",
    ("b1 ward 9k bill for mum, first claim, how much claimable", "typo"),
])
q("lau_classA_20k", "compute", ["dv_lau_classA_20k"], ["14,850"], [
    "Same S$20,000 bill but Mum stays in Class A at a restructured hospital - how much would Lumina pay?",
], forbidden=["6,750"])
q("teo_private_20k", "compute", ["dv_teo_private_20k", "ipa_noproration"], ["14,850"], [
    "Dad was in a private hospital with a S$20,000 bill, first claim this year. How much does his Shield pay?",
    ("dad private hosp 20k, how much IP cover", "singlish"),
], forbidden=["6,750"])
q("teo_C_6k", "compute", ["dv_teo_C_6k", "ipa_ded_C"], ["4,050"], [
    "If Dad chooses a Class C ward and the bill is S$6,000, how much can he claim?",
])
q("why_diff", "answer", ["ipa_noproration", "ipb_pr_private"], ["55%"], [
    "Why would Mum get so much less than Dad for the same private hospital bill?",
    ("why mum claim so little compared to dad for same bill??", "why", "singlish"),
])
q("ded_table", "answer", ["ipa_ded_A", "ipa_ded_B1", "ipa_ded_C"], ["3,500", "1,500"], [
    "What are the deductibles on the Lumina Shield plans?",
    ("deductable for shield plan how much", "typo"),
])
q("ded_b1", "answer", ["ipb_ded_B1"], ["2,500"], [
    "What's the deductible if Mum stays in a B1 ward?",
])
q("ded_81", "answer", ["ipa_ded_A_81", "ip_age_rule"], ["5,250"], [
    "What happens to Dad's Class A deductible once he's above 80?",
])
q("teo_81_when", "compute", ["dv_teo_81_date", "ipa_ded_A_81"], ["2034"], [
    "Roughly when will Dad move into the 81-and-above deductible bracket?",
], note="He turns 81 on 11 Jun 2034; the rule uses age next birthday at the start of the policy year, so the higher bracket applies from a policy year starting in 2034 (15 Feb 2034, ANB 81).")
q("ipa_limit", "answer", ["ipa_limit"], ["1,500,000"], [
    "What's Dad's annual claim limit?",
])
q("ipb_limit", "answer", ["ipb_limit"], ["600,000"], [
    "What's Mum's annual claim limit under her Shield plan?",
    ("mum IP yearly limit", "singlish"),
])
q("ipa_post", "answer", ["ipa_post"], ["365"], [
    "How long after discharge are Dad's follow-up visits covered?",
], forbidden=["180 days"])
q("ipb_pre", "answer", ["ipb_pre"], ["90"], [
    "How many days of pre-hospital treatment does Mum's plan cover?",
], forbidden=["180 days"])
q("coins", "answer", ["ipa_coins", "ipb_coins"], ["10%"], [
    "Is there co-insurance on my parents' Shield plans?",
])
q("ipa_premium", "answer", ["ipa_total", "ipa_cash"], ["5,210"], [
    "How much is Dad's Shield premium this year?",
    ("dad IP premium how much per year", "singlish"),
])
q("ipa_cash", "answer", ["ipa_cash", "ipa_awl"], ["3,046"], [
    "How much of Dad's Shield premium has to be paid in cash?",
])
q("ipb_cash", "answer", ["ipb_cash", "ipb_awl"], ["788"], [
    "How much cash does Mum need to pay for her Shield plan?",
])
q("ip_total_premium", "compute", ["dv_ip_total_premium"], ["7,640"], [
    "Total Shield premiums for both of them this year?",
    ("total IP premium mum + dad", "typo"),
])
q("ip_cash_total", "compute", ["dv_ip_cash_total"], ["3,834"], [
    "How much cash in total for both Shield plans?",
])
q("ipa_renewal", "answer", ["ipa_year"], ["@2027-02-14|15 Feb"], [
    "When is Dad's Shield plan renewal?",
])
q("ipb_renewal", "answer", ["ipb_year"], ["01 Apr|1 Apr|@2027-03-31"], [
    "When does Mum's Shield policy year renew?",
])
# MediSave
q("ms_awl_teo", "answer", ["ipa_awl", "ms_awl_71"], ["900"], [
    "How much of Dad's Shield premium can MediSave cover?",
    ("medisave can pay how much for dad shield", "singlish"),
])
q("ms_awl_lau", "answer", ["ipb_awl", "ms_awl_41_70"], ["600"], [
    "How much can Mum use MediSave for her Shield additional premium?",
])
q("ms_awl_lau_2027", "compute", ["dv_lau_awl_2027", "dv_lau_anb_2027", "ms_awl_71"], ["900"], [
    "Will Mum be able to use more MediSave for her Shield premium next year?",
    ("next year mum medisave limit for IP go up anot", "singlish"),
])
q("ms_why_600_vs_900", "answer", ["ms_awl_41_70", "ms_awl_71", "ms_awl_rule"], ["600", "900"], [
    "Why can Dad use S$900 of MediSave but Mum only S$600?",
])
q("ms_daily", "answer", ["ms_daily"], ["450"], [
    "How much MediSave can be used per day for a hospital stay?",
])
q("ms_4days", "compute", ["dv_ms_4days"], ["1,800"], [
    "If Mum is in hospital 4 days, what's the most MediSave can pay for daily ward charges?",
])
q("ms_ds", "answer", ["ms_ds"], ["300"], [
    "What's the MediSave limit for day surgery?",
])
q("ms_surgical", "answer", ["ms_surgical"], ["7,550"], [
    "What's the MediSave range for surgical operations?",
])
q("ms_flexi", "answer", ["ms_flexi"], ["300"], [
    "Can Dad use MediSave for his GP visits? He's above 60.",
    ("flexi medisave for elderly how much", "typo"),
])
q("ms_chronic", "answer", ["ms_500700"], ["500|700"], [
    "How much MediSave can be used for Mum's diabetes check-ups at the polyclinic?",
])
q("ms_community", "answer", ["ms_community"], ["250"], [
    "MediSave limit per day for a community hospital?",
])
q("ms_balance", "not_uploaded", ["ms_disclaimer"], [], [
    "How much is left in Dad's MediSave?",
    ("mum medisave balance how much", "singlish"),
])
# LTC
q("teo_es", "answer", ["es_payout", "es_months"], ["400"], [
    "What does Dad's ElderShield pay?",
    ("eldershield dad monthly payout", "typo"),
])
q("teo_ev", "answer", ["ev_payout"], ["1,200"], [
    "What does Dad's EverCare supplement pay per month?",
])
q("teo_3adl", "compute", ["dv_teo_3adl"], ["1,600"], [
    "If Dad can't do 3 ADLs, how much will he get per month in total?",
    ("dad cannot bathe, dress and walk, how much monthly from all his care plans", "singlish"),
])
q("teo_2adl", "compute", ["dv_teo_2adl", "es_trigger"], ["1,200"], [
    "If Dad can only not do 2 ADLs, what does he get?",
], forbidden=["1,600"])
q("teo_first_month", "compute", ["dv_teo_first_month_3adl", "ev_initial"], ["3,000"], [
    "Is there any lump sum when Dad first claims EverCare?",
])
q("lau_cs", "answer", ["cs_payout", "cs_lifetime"], ["690"], [
    "How much does Mum's CareShield Life pay?",
    ("careshield mum how much", "singlish"),
])
q("lau_3adl", "compute", ["dv_lau_3adl"], ["1,490"], [
    "If Mum is severely disabled (3 ADLs), monthly total from CareShield and her supplement?",
])
q("lau_2adl", "compute", ["dv_lau_2adl", "cs_trigger"], ["800"], [
    "Mum can't toilet or transfer on her own (2 ADLs). What can she claim monthly?",
], forbidden=["1,490"])
q("couple_3adl", "compute", ["dv_couple_3adl"], ["3,090"], [
    "If both of them became severely disabled (3 ADLs), how much per month combined?",
])
q("es_max", "compute", ["dv_es_max_total"], ["28,800"], [
    "What's the maximum Dad's ElderShield could pay in total?",
])
q("ev_months", "answer", ["ev_months"], ["120"], [
    "How long does the EverCare supplement pay for?",
])
q("cs_lifetime", "answer", ["cs_lifetime"], ["life"], [
    "Is Mum's CareShield payout for life or limited years?",
])
q("adl_list", "answer", ["adl_list"], ["dressing", "transferring"], [
    "What are the 6 ADLs?",
    ("what count as ADL ah", "singlish"),
])
q("supp_cash", "compute", ["dv_teo_ev_cash", "supp_medisave"], ["548"], [
    "How much cash does Dad pay for EverCare after using MediSave?",
])
q("supp_cash_lau", "compute", ["dv_lau_cb_cash"], ["336"], [
    "And Mum's CareBoost - cash portion after MediSave?",
])
q("es_defer", "answer", ["es_defer"], ["90 days"], [
    "Is there a waiting period before ElderShield starts paying?",
])
# Whole life
q("wl_sv_now", "answer", ["wl_sv_now"], ["76,320"], [
    "What's the current surrender value of Dad's whole life plan?",
    ("if dad surrender the banyan policy now get how much", "singlish"),
])
q("wl_sv_y29", "answer", ["wl_sv_y29"], ["78,810"], [
    "What will the surrender value be at the end of this policy year?",
    ("SV end of policy year 29 how much", "typo"),
])
q("wl_sv_y30", "answer", ["wl_sv_y30"], ["81,300"], [
    "What's the surrender value in July 2028?",
])
q("wl_sv_y33", "answer", ["wl_sv_y33"], ["88,770"], [
    "What would the surrender value be when Dad is 78?",
])
q("wl_sv_y40", "answer", ["wl_sv_y40"], ["106,200"], [
    "What's the surrender value at age 85?",
])
q("wl_sv_increase", "compute", ["dv_wl_sv_increase_y29"], ["2,490"], [
    "How much does the surrender value go up between the end of year 28 and the end of year 29?",
])
q("wl_gsv_y29", "answer", ["wl_gsv_y29"], ["47,760"], [
    "How much of the year-29 surrender value is guaranteed?",
])
q("wl_db", "answer", ["wl_db", "wl_gdb", "wl_tb"], ["139,650"], [
    "How much would the whole life plan pay if Dad passes away?",
    ("dad whole life death benefit how much", "singlish"),
])
q("wl_gdb", "answer", ["wl_gdb"], ["121,250"], [
    "How much of the death benefit is guaranteed?",
])
q("wl_why_db_up", "answer", ["wl_bonus_2026", "wl_pua_prev", "wl_pua"], ["1,640"], [
    "Why is the paid-up additions figure higher than last year's statement?",
    ("why the bonus amount increase this yr", "why", "typo"),
])
q("wl_pua", "answer", ["wl_pua"], ["41,250"], [
    "How much paid-up additions has Dad's whole life accumulated?",
])
q("wl_premium_status", "answer", ["wl_paid_up", "wl_last_premium"], ["Fully paid|no further premiums"], [
    "Does Dad still need to pay premiums for the Banyan whole life?",
])
q("wl_total_premiums", "compute", ["dv_wl_total_premiums"], ["42,800"], [
    "How much premium did Dad pay in total over the life of the Banyan whole life?",
])
q("wl_sa", "answer", ["wl_sa"], ["80,000"], [
    "What's the basic sum assured on the whole life?",
])
q("wl_policy_year", "compute", ["dv_wl_policy_year_now", "wl_start"], ["29"], [
    "Which policy year is the whole life in now?",
])
q("wl_funeral", "not_covered", ["wl_no_funeral"], ["does not include a separate funeral benefit"], [
    "Does Dad's whole life have a funeral benefit?",
])
# assignment
q("as_who_gets", "answer", ["as_payable", "as_bank"], ["Straits Harbour Bank"], [
    "If Dad passes away, who gets the whole life payout?",
    ("dad pass away the banyan money go to who", "singlish"),
])
q("as_nominee", "answer", ["as_nom_revoked"], ["revoked"], [
    "Isn't Mum the nominee on Dad's whole life?",
    ("mum still nominee for dad policy right", "singlish"),
])
q("as_surrender", "answer", ["as_consent", "wl_consent"], ["consent"], [
    "Can Dad just surrender the whole life to get cash?",
])
q("as_loan_amount", "not_uploaded", ["as_no_amount"], [], [
    "How much does Dad still owe the bank?",
    ("loan balance with straits harbour how much", "typo"),
])
q("as_when", "answer", ["as_date"], ["@2019-05-20"], [
    "When was the policy assigned to the bank?",
])
q("as_after_loan", "answer", ["as_reassign"], ["re-assign|new nomination"], [
    "What happens to the assignment once the loan is paid off?",
])
q("as_type", "answer", ["as_type"], ["Absolute assignment"], [
    "What kind of assignment is it?",
])
# Chinese funeral plan
q("ff_explain", "answer", ["ff_sa", "ff_advance", "ff_policy"], ["15,000", "5,000"], [
    "Mum's funeral policy is in Chinese. Can you explain what it covers in English?",
    ("the chinese document for mum, what does it say?", "typo"),
])
q("ff_advance", "answer", ["ff_advance", "ff_advance_days"], ["5,000", "3"], [
    "How fast does the funeral plan pay out for funeral costs?",
    ("got funeral cash advance or not, how many days", "singlish"),
])
q("ff_extra", "answer", ["ff_advance_deducted", "dv_ff_balance_after_advance"], ["10,000"], [
    "So in total we get S$20,000 from Mum's funeral plan - S$5,000 advance plus S$15,000?",
    ("advance 5k is on top of the 15k right?", "singlish"),
], forbidden=["20,000 in total"])
q("ff_accident", "compute", ["dv_ff_accidental_total"], ["30,000"], [
    "If Mum dies in an accident, how much does the Final Farewell Plan pay?",
])
q("ff_nominee", "answer", ["ff_nominee"], ["Mei Ling|张美玲"], [
    "Who is the nominee on Mum's funeral plan?",
])
q("ff_waiting", "compute", ["ff_waiting", "dv_ff_wait_end"], ["24"], [
    "Is there still a waiting period on Mum's funeral plan?",
])
q("ff_premium", "answer", ["ff_premium"], ["468"], [
    "How much is the premium for Mum's funeral plan and until when?",
])
q("ff_pay_until", "compute", ["dv_ff_pay_until", "ff_premium"], ["2041"], [
    "In what year does Mum stop paying for the funeral plan?",
])
q("ff_start", "answer", ["ff_start"], ["@2021-03-15"], [
    "When did Mum's Final Farewell Plan start?",
])
q("ff_teo", "not_uploaded", [], [], [
    "Does Dad have a funeral plan too?",
], note="No funeral plan for Teo is uploaded; his whole life has no funeral benefit.")
# ages / dates
q("ages", "compute", ["dv_teo_age", "dv_lau_age"], ["73", "69"], [
    "How old are my parents now?",
])
q("lau_anb", "compute", ["dv_lau_anb_2026", "ms_awl_41_70"], ["70"], [
    "What age is used for Mum's MediSave limit this policy year?",
])
q("ipa_lifetime", "answer", ["ipa_lifetime"], ["No limit|no lifetime limit"], [
    "Is there a lifetime limit on Dad's Shield plan?",
])
q("ms_psych", "answer", ["ms_psych"], ["150"], [
    "How much MediSave per day for psychiatric treatment?",
])
q("ms_hospice", "answer", ["ms_hospice"], ["250"], [
    "Can MediSave be used for inpatient hospice care, and how much per day?",
])
q("ms_mshl_full", "answer", ["ms_awl_rule", "ipa_mshl"], ["1,264"], [
    "Is Dad's MediShield Life portion fully payable by MediSave?",
])
q("ipa_mshl_lau", "answer", ["ipb_mshl"], ["1,042"], [
    "How much is the MediShield Life part of Mum's premium?",
])
# clarify
q("clarify_hosp_claim", "clarify", [], [], [
    "How much can I claim for my hospital bill of $20k?",
    ("parent warded, bill 20k, how much can claim?", "singlish"),
], forbidden=["6,750", "14,850"], note="Which parent and which hospital/ward are unknown.")
q("clarify_my_plan", "clarify", [], [], [
    "Is my Shield plan as-charged?",
], note="'My' is ambiguous (Teo Plan A vs Lau Plan B). Answering both and asking is acceptable.")
q("clarify_deductible_ward", "clarify", [], [], [
    "How much is the deductible for Mum's upcoming surgery?",
], forbidden=["3,500 for"], note="Depends on ward class stayed; must ask.")
q("clarify_sv_when", "clarify", [], [], [
    "What's the surrender value next time?",
], note="Unclear which date/policy year.")
# not uploaded
q("nu_mshl", "not_uploaded", [], [], [
    "Can you show me Dad's MediShield Life certificate details?",
])
q("nu_home", "not_uploaded", [], [], [
    "Is our HDB flat covered for fire?",
    ("home insurance got or not", "singlish"),
])
q("nu_daughter", "not_uploaded", [], [], [
    "What insurance does Mei Ling have?",
])
q("nu_mum_wl", "not_uploaded", [], [], [
    "What's the surrender value of Mum's whole life policy?",
])
q("nu_travel", "not_uploaded", [], [], [
    "My parents are going to Taiwan next month - are they covered for travel?",
])
# out of scope
q("oos", "out_of_scope", [], [], [
    "Can you apply for the Silver Support scheme for my parents?",
    "Book a polyclinic appointment for Mum tomorrow.",
    "What's a good Chinese restaurant near Toa Payoh?",
])
# advice
q("adv_surrender", "advice_decline", [], [], [
    "Should Dad surrender the whole life to pay off the bank loan?",
    ("better to surrender or keep the banyan policy?", "singlish"),
])
q("adv_upgrade_mum", "advice_decline", [], [], [
    "Should Mum upgrade to Plan A?",
])
q("adv_drop_supp", "advice_decline", [], [], [
    "Is it worth keeping Mum's CareBoost supplement?",
])
# claims (single)
q("claim_lau_hosp", "claim_start", ["ipb_plan", "ipb_policy"], ["Plan B|LH-IS-2047720"], [
    "Mum is being admitted to hospital tomorrow, I want to start a claim.",
])
q("claim_funeral", "claim_start", ["ff_advance", "ff_policy"], ["5,000"], [
    "I need to claim the funeral advance on my mother's Banyan plan.",
])
q("claim_ltc_teo", "claim_start", ["es_trigger", "ev_trigger"], ["2 of 6|3 of 6"], [
    "Dad can't walk or dress himself anymore. How do we start a long-term care claim?",
])

# ================================================================ conversations
C = B.conv
C("Mum private hospital claim with correction", [
    ("Mum was admitted to hospital last week, I want to claim", "claim_start", ["ipb_plan", "ipb_policy"], ["Plan B|LH-IS-2047720"]),
    ("It was a private hospital, Mount something", "claim_step", ["ipb_pr_private"], ["55%"]),
    ("Bill is S$20,000. First claim this year.", "compute", ["dv_lau_private_20k"], ["6,750"]),
    ("Why so little??", "answer", ["ipb_pr_private", "ipb_pr_rule", "ipb_ded_A"], ["55%"]),
    ("Sorry, I checked - it was actually a restructured hospital, Class A ward.", "correction", ["dv_lau_classA_20k"], ["14,850"], ["6,750"]),
    ("So no pro-ration now?", "answer", ["ipb_pr_restructured"], ["no pro-ration|100%"]),
    ("How much do we pay ourselves then?", "compute", ["dv_lau_classA_20k_oop"], ["5,150"], [], "20,000 - 14,850 = 5,150."),
    ("Can MediSave pay part of that?", "answer", ["ms_daily"], ["450"], [], "MediSave can be used within withdrawal limits; balance not uploaded."),
    ("How much is in her MediSave?", "not_uploaded", ["ms_disclaimer"], []),
    ("Within how many days after discharge are her follow-ups covered?", "answer", ["ipb_post"], ["180"], ["365 days"]),
], tags=["claim", "correction", "pro-ration"])
C("Comparing parents' Shield plans", [
    ("What Shield plans do my parents have?", "answer", ["ipa_plan", "ipb_plan"], ["Plan A", "Plan B"]),
    ("What's the difference in ward entitlement?", "answer", ["ipa_ward", "ipb_ward"], ["Private hospital", "Class A"]),
    ("And annual limits?", "answer", ["ipa_limit", "ipb_limit"], ["1,500,000", "600,000"]),
    ("Same 20k private hospital bill, who gets more?", "compute", ["dv_teo_private_20k", "dv_lau_private_20k"], ["14,850", "6,750"]),
    ("why the difference", "answer", ["ipb_pr_private", "ipa_noproration"], ["55%"]),
    ("Do they have the same deductible?", "answer", ["ipa_ded_A", "ipb_ded_A"], ["3,500"]),
    ("Total premiums for both?", "compute", ["dv_ip_total_premium"], ["7,640"]),
    ("How much of that is cash?", "compute", ["dv_ip_cash_total"], ["3,834"]),
    ("Should Mum switch to Plan A?", "advice_decline", [], []),
], tags=["comparison", "totals", "advice"])
C("Whole life surrender questions", [
    ("Dad wants to know what his Banyan whole life is worth now", "answer", ["wl_sv_now", "wl_db"], ["76,320"]),
    ("And if he waits until end of this policy year?", "answer", ["wl_sv_y29"], ["78,810"]),
    ("That's on which page? I only see up to year 28", "answer", ["wl_sv_y29"], ["78,810"], [], "Row is on page 4 (Table 3 continued)."),
    ("How much more is that?", "compute", ["dv_wl_sv_increase_y29"], ["2,490"]),
    ("Is that guaranteed?", "answer", ["wl_gsv_y29"], ["47,760"]),
    ("Can he surrender now?", "answer", ["as_consent", "as_bank"], ["consent"]),
    ("Why does the bank have a say?", "answer", ["as_type", "as_date"], ["Absolute assignment"]),
    ("How much does he owe the bank?", "not_uploaded", ["as_no_amount"], []),
    ("Should he surrender then?", "advice_decline", [], []),
    ("What would the value be at 80?", "answer", ["wl_sv_y35"], ["93,750"]),
], tags=["whole-life", "two-page-table", "assignment"])
C("Who gets the money - nominees and assignment", [
    ("If Dad passes, does Mum get his whole life money?", "answer", ["as_payable", "as_nom_revoked"], ["Straits Harbour Bank"]),
    ("But she was the nominee", "answer", ["as_nom_revoked"], ["revoked"]),
    ("When was that nomination made?", "answer", ["as_nom_revoked"], ["@2004-09-12|2004"]),
    ("What happens after the loan is cleared?", "answer", ["as_reassign"], ["re-assign|new nomination"]),
    ("And Mum's funeral plan, who's the nominee?", "answer", ["ff_nominee"], ["Mei Ling|张美玲"]),
    ("How much would Mei Ling get?", "answer", ["ff_db"], ["15,000"]),
    ("Does the 5k advance come on top?", "answer", ["ff_advance_deducted", "dv_ff_balance_after_advance"], ["10,000"], ["20,000 in total"]),
    ("And if it's an accident?", "compute", ["dv_ff_accidental_total"], ["30,000"]),
    ("Can Mum change the nominee?", "answer", ["ff_nominee"], ["可撤销|revocable"], [], "Nomination is revocable."),
], tags=["nominee", "assignment", "chinese-doc"])
C("Long-term care scenario", [
    ("Dad had a stroke, he can't dress or bathe himself", "claim_start", ["ev_trigger", "es_trigger"], ["2 of 6"]),
    ("Which plans can pay?", "answer", ["ev_payout", "es_trigger"], ["EverCare"]),
    ("How much per month?", "compute", ["dv_teo_2adl"], ["1,200"], ["1,600"]),
    ("Why not ElderShield?", "answer", ["es_trigger"], ["3 of 6"]),
    ("The doctor now says he also can't walk on his own", "correction", ["dv_teo_3adl"], ["1,600"]),
    ("Any lump sum?", "answer", ["ev_initial"], ["3,000"]),
    ("When does it start paying?", "answer", ["es_defer"], ["90 days"]),
    ("How long will ElderShield pay?", "answer", ["es_months"], ["72"]),
    ("And EverCare?", "answer", ["ev_months"], ["120"]),
    ("If Mum also needs care later with 3 ADLs, combined monthly?", "compute", ["dv_couple_3adl"], ["3,090"]),
], tags=["ltc", "correction", "totals"])
C("Chinese funeral plan walkthrough", [
    ("Mum has a Chinese policy document. What is it?", "answer", ["ff_policy", "ff_sa"], ["Final Farewell|身后事保障计划"]),
    ("What's the sum assured?", "answer", ["ff_sa"], ["15,000"]),
    ("Premium?", "answer", ["ff_premium"], ["468"]),
    ("Until what age?", "answer", ["ff_premium"], ["85"]),
    ("Which year is that?", "compute", ["dv_ff_pay_until"], ["2041"]),
    ("Is there a waiting period?", "answer", ["ff_waiting"], ["24"]),
    ("Has it passed?", "compute", ["dv_ff_wait_end"], ["@2023-03-15|2023"]),
    ("What's excluded?", "answer", ["ff_war"], ["war"]),
    ("How do we claim?", "answer", ["ff_advance_days"], ["3"]),
], tags=["chinese-doc", "date-reasoning"])
C("MediSave questions", [
    ("Can my parents use MediSave for their Shield premiums?", "answer", ["ipa_awl", "ipb_awl"], ["900", "600"]),
    ("Why different?", "answer", ["ms_awl_rule", "ms_awl_41_70", "ms_awl_71"], ["age"]),
    ("When does Mum's go up?", "compute", ["dv_lau_awl_2027", "ipb_year"], ["@2027-04-01|2027"]),
    ("How much will it be then?", "answer", ["dv_lau_awl_2027"], ["900"]),
    ("If her additional premium stays the same, how much cash will she pay next year?", "compute", ["dv_lau_cash_2027_if_same"], ["488"]),
    ("And for the CareBoost supplement?", "answer", ["supp_medisave"], ["600"]),
    ("Cash for CareBoost then?", "compute", ["dv_lau_cb_cash"], ["336"]),
    ("How much MediSave do they have left?", "not_uploaded", ["ms_disclaimer"], []),
], tags=["medisave", "date-reasoning"])
C("Dad hospital claim walkthrough", [
    ("Dad needs a knee operation", "clarify", [], [], ["14,850"]),
    ("Private hospital, estimated S$20,000, no claims yet this year", "compute", ["dv_teo_private_20k"], ["14,850"]),
    ("Any pro-ration?", "answer", ["ipa_noproration"], ["No pro-ration"]),
    ("Deductible?", "answer", ["ipa_ded_A"], ["3,500"]),
    ("If he chooses a C ward instead with a 6k bill?", "compute", ["dv_teo_C_6k"], ["4,050"]),
    ("Pre-op tests 3 months before - covered?", "answer", ["ipa_pre"], ["180"]),
    ("Physio after - how long?", "answer", ["ipa_post"], ["365"]),
    ("MediSave limit for the surgery itself?", "answer", ["ms_surgical"], ["7,550"]),
    ("And what will the hospital give him in cash per day?", "not_uploaded", [], [], [], "No hospital cash policy uploaded."),
], tags=["claim", "hospital", "clarify"])
C("Singlish auntie questions", [
    ("my husband insurance got cover private hospital or not", "answer", ["ipa_ward"], ["Private hospital"]),
    ("mine leh", "answer", ["ipb_ward", "ipb_pr_private"], ["Class A"]),
    ("if i go private how many percent they pay", "answer", ["ipb_pr_private"], ["55%"]),
    ("aiyo so little. then day surgery?", "answer", ["ipb_pr_ds"], ["65%"]),
    ("my funeral one the advance how much", "answer", ["ff_advance"], ["5,000"]),
    ("give to who", "answer", ["ff_nominee"], ["Mei Ling|张美玲"]),
    ("my careshield how much a month", "answer", ["cs_payout"], ["690"]),
    ("can help me buy more insurance?", "advice_decline", [], []),
], tags=["singlish", "persona"])
C("Mixed not-uploaded and scope", [
    ("What does MediShield Life pay for Dad?", "not_uploaded", [], []),
    ("What's in the uploaded documents then?", "answer", ["ipa_policy", "ipb_policy", "wl_policy", "ff_policy"], ["Lumina Shield", "Heritage Whole Life|Banyan", "Final Farewell|身后事保障计划"]),
    ("Do they have travel insurance?", "not_uploaded", [], []),
    ("Is our home insured?", "not_uploaded", [], []),
    ("Can you call Lumina for me?", "out_of_scope", [], []),
    ("OK what's Dad's Shield policy number", "answer", ["ipa_policy"], ["LH-IS-2047719"]),
    ("And Mum's?", "answer", ["ipb_policy"], ["LH-IS-2047720"]),
    ("Thanks", "out_of_scope", [], []),
], tags=["not-uploaded", "out-of-scope"])
C("Why did the numbers change", [
    ("Last year's statement said paid-up additions S$39,610, now it's S$41,250. Why?", "answer", ["wl_bonus_2026"], ["1,640"]),
    ("Is that bonus guaranteed?", "answer", ["wl_pua_guaranteed"], ["guaranteed"]),
    ("What about the terminal bonus?", "answer", ["wl_tb"], ["18,400"]),
    ("So guaranteed death benefit is?", "answer", ["wl_gdb"], ["121,250"]),
    ("Explain how you got that", "compute", ["dv_wl_gdb_check", "wl_sa", "wl_pua"], ["80,000", "41,250"]),
    ("Difference between death benefit and surrender value now?", "compute", ["dv_wl_db_minus_sv"], ["63,330"]),
    ("Why is Mum's MediSave limit only 600 when Dad's is 900?", "answer", ["ms_awl_41_70", "ms_awl_71"], ["600", "900"]),
    ("Why is Mum's private hospital estimate lower than Dad's?", "answer", ["ipb_pr_private"], ["55%"]),
], tags=["why"])
C("Mum day surgery then switch to Dad", [
    ("Mum is doing cataract day surgery at a private clinic hospital, about S$8,000", "compute", ["dv_lau_ds_8k"], ["1,530"]),
    ("Why only 1.5k?", "answer", ["ipb_pr_ds", "ipb_ded_A"], ["65%"]),
    ("MediSave for day surgery limit?", "answer", ["ms_ds"], ["300"]),
    ("Actually it's Dad having the surgery, not Mum", "correction", ["ipa_noproration", "ipa_ded_A"], ["No pro-ration|as charged"], ["1,530"]),
    ("So how much for Dad with 8k?", "compute", ["dv_teo_8k", "ipa_ded_A", "ipa_coins"], ["4,050"], ["1,530"], "8,000 - 3,500 = 4,500 less 10% = 4,050."),
    ("Pre-surgery consults 2 months before ok?", "answer", ["ipa_pre"], ["180"]),
    ("Follow-up eye drops for 6 months?", "answer", ["ipa_post"], ["365"]),
    ("Do we need to tell the bank since his policy is assigned?", "answer", ["as_payable"], ["Straits Harbour Bank"], [], "Assignment covers the Banyan whole life only, not the Shield plan."),
], tags=["switch-person", "correction"])
C("Renewal and date reasoning", [
    ("When do my parents' Shield plans renew?", "answer", ["ipa_year", "ipb_year"], ["15 Feb|@2027-02-14", "01 Apr|1 Apr|@2027-03-31"]),
    ("Which comes first?", "answer", ["ipa_year"], ["Dad|Teo|15 Feb|Plan A"]),
    ("How old will Mum be at her next renewal, for MediSave purposes?", "compute", ["dv_lau_anb_2027"], ["71"]),
    ("When did Mum join CareShield?", "answer", ["cs_joined"], ["@2021-10-01"]),
    ("When did the whole life start?", "answer", ["wl_start"], ["@1998-08-01|1998"]),
    ("Last premium paid when?", "answer", ["wl_last_premium"], ["@2017-08-01|2017"]),
    ("How old are they now?", "compute", ["dv_teo_age", "dv_lau_age"], ["73", "69"]),
    ("When does Dad hit the over-80 deductible?", "compute", ["dv_teo_81_date"], ["2034"]),
], tags=["date-reasoning"])
C("Funeral claim flow", [
    ("Mum passed away yesterday. What do we need to do for her insurance?", "claim_start", ["ff_advance", "ff_policy"], ["Final Farewell|BM-FF-5521046|5,000"]),
    ("How fast is the funeral money?", "answer", ["ff_advance_days", "ff_advance"], ["3"]),
    ("Who receives it?", "answer", ["ff_nominee"], ["Mei Ling|张美玲"]),
    ("Total payable?", "answer", ["ff_db", "ff_advance_deducted"], ["15,000"], ["20,000 in total"]),
    ("Balance after the advance?", "compute", ["dv_ff_balance_after_advance"], ["10,000"]),
    ("What about her Shield plan and CareShield?", "not_covered", [], [], [], "No death benefit under those; app should not invent one."),
    ("Documents needed?", "answer", ["ff_advance_days"], ["死亡证明|death certificate"]),
    ("Does Dad's whole life pay anything because Mum died?", "not_covered", ["wl_policy"], ["Teo Boon Huat|Heritage Whole Life|Banyan"], [], "Dad is the life assured; nothing payable on Mum's death."),
], tags=["claim", "funeral", "chinese-doc"])
C("Long mixed session", [
    ("Hi, I'm Mei Ling, their daughter.", "out_of_scope", [], []),
    ("What's my insurance?", "not_uploaded", [], []),
    ("Ok, my parents' then. Dad first.", "answer", ["ipa_plan", "wl_policy", "es_payout"], ["Plan A", "Heritage Whole Life|Banyan", "ElderShield"]),
    ("Mum?", "answer", ["ipb_plan", "cs_payout", "ff_policy"], ["Plan B", "CareShield", "Final Farewell|身后事保障计划"]),
    ("Am I nominee on anything?", "answer", ["ff_nominee", "ff_policy"], ["Final Farewell|身后事保障计划|BM-FF-5521046"]),
    ("Mum private hospital S$20k, first claim, payout?", "compute", ["dv_lau_private_20k"], ["6,750"]),
    ("Dad same?", "compute", ["dv_teo_private_20k"], ["14,850"]),
    ("Dad's whole life SV now?", "answer", ["wl_sv_now"], ["76,320"]),
    ("Can I surrender it on his behalf?", "answer", ["as_consent"], ["consent"]),
    ("Should we?", "advice_decline", [], []),
    ("Dad's long-term care if 3 ADLs?", "compute", ["dv_teo_3adl"], ["1,600"]),
    ("Sorry I meant Mum", "correction", ["dv_lau_3adl"], ["1,490"], ["1,600"]),
    ("MediSave for Mum's Shield next year?", "compute", ["dv_lau_awl_2027"], ["900"]),
    ("Thanks!", "out_of_scope", [], []),
], tags=["long", "correction", "persona"])

if __name__ == "__main__":
    build("H5", META, DOCS, FACTS, DERIVED, TRAPS, B, NOT_UPLOADED)

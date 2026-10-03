# Round 7 second household (Rahman bin Yusof): realistic-looking, clearly FICTITIOUS
# insurer documents (synthetic only), each prefixed with a DPTEST-EXTRACTION control
# page carrying what a competent reading model would return (the deterministic
# stand-in reads ONLY that page; every answer is still checked against the printed pages).
# Run: python3 scripts/fixtures/r7/make.py   (writes scripts/fixtures/r7/*.pdf.b64)
import json, base64, os, io, copy
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from pypdf import PdfReader, PdfWriter
pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
HERE = os.path.dirname(os.path.abspath(__file__))
ss = getSampleStyleSheet(); H1 = ss["Heading1"]; H2 = ss["Heading2"]; B = ss["BodyText"]
S = ParagraphStyle("s", parent=B, fontSize=8, leading=10); FN = ParagraphStyle("fn", parent=B, fontSize=6.5, leading=8, textColor=colors.grey)
ZH = ParagraphStyle("zh", parent=B, fontName="STSong-Light", fontSize=8.5, leading=11)
ZH2 = ParagraphStyle("zh2", parent=H2, fontName="STSong-Light")
def P(t, st=B): return Paragraph(t, st)
def tbl(rows, widths, head=1, size=7.5, font=None, shade=None):
    cs = ParagraphStyle("c", parent=B, fontSize=size, leading=size + 2, **({"fontName": font} if font else {}))
    t = Table([[P(str(c), cs) for c in r] for r in rows], colWidths=widths, repeatRows=head)
    st = [("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]
    if head: st.append(("BACKGROUND", (0, 0), (-1, head - 1), colors.lightgrey))
    if shade is not None: st.append(("BACKGROUND", (shade, head), (shade, -1), colors.Color(0.92, 0.96, 1)))
    t.setStyle(TableStyle(st)); return t
def kv(rows, size=8.5): return tbl(rows, [62*mm, 112*mm], head=0, size=size)
def build(story, insurer):
    buf = io.BytesIO()
    def foot(c, d):
        c.saveState(); c.setFont("Helvetica", 6.5)
        c.drawString(15*mm, 8*mm, f"{insurer} (fictitious insurer - synthetic test document)   Page {d.page}"); c.restoreState()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=15*mm, bottomMargin=15*mm).build(story, onFirstPage=foot, onLaterPages=foot)
    return buf.getvalue()

def cov(cat, amt, page, ev, notes=None, prod=None):
    return {"category": cat, "productName": prod, "policyNumber": None, "amount": amt, "currency": "SGD" if amt is not None else None, "notes": notes, "sourcePage": page, "evidenceText": ev, "evidenceVerified": False}
def base(**k):
    d = {"documentType": None, "documentRole": None, "documentNotes": [], "insurer": None, "productName": None, "productsMentioned": [], "policyNumber": None, "groupPolicyNumber": None,
         "policyType": None, "policyholder": None, "personalCoverageConfirmed": True, "startDate": None, "renewalOrExpiryDate": None, "insuredPeople": [], "referenceCoverages": [],
         "premium": {"amount": None, "currency": None, "frequency": None}, "paymentRecords": [], "keyExclusions": [], "waitingPeriods": [], "deductiblesAndCoinsurance": [], "riders": []}
    d.update(k); return d
def person(name, hint, *covs): return {"name": name, "relationshipHint": hint, "coverages": list(covs)}

DOCS = {}
# Page numbers in the extraction are pages of the FINAL file (control page is page 1).
# ---------------------------------------------------------------- 1. Integrated Shield, ward-class columns, Co-Pay Rider
INS = "Temasek Harbour Insurance"
s = [P(f"{INS} (fictitious)", H1), P("MEDIGUARD INTEGRATED SHIELD - POLICY SCHEDULE", H2),
     kv([["Policy number", "THI-MG-4410298"], ["Policyholder and life assured", "Rahman bin Yusof (date of birth 2 May 1974)"],
         ["Plan", "MediGuard Class A Ward Plan, with MediGuard Co-Pay Rider"], ["Period of insurance", "1 February 2026 to 31 January 2027"],
         ["Annual premium (MediGuard Class A Ward Plan)", "S$742.00, of which S$600.00 is deducted from MediSave and S$142.00 is payable in cash"],
         ["Annual premium (MediGuard Co-Pay Rider)", "S$418.00, payable in cash only"], ["Next renewal date", "1 February 2027"], ["Date of issue", "20 January 2026"]]),
     Spacer(1, 6), P("This schedule forms part of your policy and must be read with the Policy Wording. Your plan is the Class A Ward Plan: the shaded column of the Schedule of Benefits applies to you. All amounts are in Singapore dollars.", S),
     PageBreak(), P("SCHEDULE OF BENEFITS", H2),
     tbl([["Benefit", "Standard Plan (B1 ward)", "Class A Ward Plan", "Private Plan"],
          ["Daily ward and treatment charges", "As charged, B1 ward", "As charged, A ward", "As charged, standard room in a private hospital"],
          ["Intensive care unit", "As charged", "As charged", "As charged"],
          ["Surgical procedures (inpatient and day surgery)", "As charged", "As charged", "As charged"],
          ["Pre-hospitalisation treatment", "Within 90 days before admission", "Within 120 days before admission", "Within 180 days before admission"],
          ["Post-hospitalisation treatment", "Within 90 days after discharge", "Within 180 days after discharge", "Within 365 days after discharge"],
          ["Outpatient cancer drug treatment (Cancer Drug List)", "Up to 2 x MediShield Life limit per month", "Up to 3 x MediShield Life limit per month", "Up to 5 x MediShield Life limit per month"],
          ["Outpatient kidney dialysis", "Up to S$3,000 per month", "Up to S$3,500 per month", "Up to S$4,000 per month"],
          ["Policy year limit", "S$300,000", "S$600,000", "S$1,500,000"],
          ["Deductible per policy year (age 80 and below)", "S$2,250", "S$3,000", "S$3,750"],
          ["Deductible per policy year (age 81 and above)", "S$3,375", "S$4,500", "S$5,625"],
          ["Co-insurance", "10%", "10%", "10%"],
          ["Pro-ration if you stay in a private hospital", "35%", "70%", "Not applicable"]], [56*mm, 38*mm, 40*mm, 46*mm], shade=2),
     Spacer(1, 4),
     P("Pro-ration: if you choose a ward above your plan's entitlement, the bill is reduced to the stated percentage before the deductible and co-insurance apply.", FN),
     P("The deductible is paid once in each policy year. Co-insurance applies to the claimable amount above the deductible.", FN),
     PageBreak(), P("MEDIGUARD CO-PAY RIDER - BENEFITS", H2),
     tbl([["Rider benefit", "Panel or pre-authorised treatment", "Other treatment"],
          ["Deductible and co-insurance", "Rider pays 95%; you pay a 5% co-payment", "Rider pays 95%; you pay a 5% co-payment"],
          ["Maximum co-payment per policy year", "S$3,000", "No maximum"],
          ["Restructured hospital cash (A or B1 ward only)", "S$80 per day, up to 30 days per admission", "S$80 per day, up to 30 days per admission"],
          ["Pro-ration", "Not paid by the rider", "Not paid by the rider"]], [62*mm, 60*mm, 58*mm]),
     Spacer(1, 6), P("The Co-Pay Rider premium cannot be paid from MediSave. The rider ends when the MediGuard plan ends.", S),
     PageBreak(), P("GENERAL EXCLUSIONS AND WAITING PERIOD", H2),
     P("A waiting period of 30 days applies from the start date, except for treatment of injuries caused by an accident.", S)]
for ex in ["Pre-existing conditions not declared at application.", "Cosmetic treatment and dental treatment other than as a result of an accident.", "Treatment for drug or alcohol abuse.", "Pregnancy and childbirth, except the complications listed in the Policy Wording."]:
    s.append(P("- " + ex, S))
DOCS["MediGuard_Shield_Schedule_2026"] = (build(s, INS), base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=INS + " (fictitious)", productName="MediGuard Integrated Shield",
    productsMentioned=["MediGuard Co-Pay Rider"], policyNumber="THI-MG-4410298", policyType="Integrated Shield Plan", policyholder="Rahman bin Yusof", startDate="2026-02-01", renewalOrExpiryDate="2027-01-31",
    insuredPeople=[person("Rahman bin Yusof", "self", cov("Hospitalisation", 600000, 3, "Policy year limit", "Class A Ward Plan"))],
    premium={"amount": 742.0, "currency": "SGD", "frequency": "annual"}, deductiblesAndCoinsurance=["Deductible S$3,000 per policy year (Class A Ward Plan, age 80 and below)", "Co-insurance 10%", "Co-Pay Rider: co-payment 5%, max S$3,000 (panel)"],
    waitingPeriods=["30 days except accidents"], riders=["MediGuard Co-Pay Rider"]))

# ---------------------------------------------------------------- 2. ElderShield annual statement, bilingual Malay / English
INS = "Pelangi General Assurance"
s = [P(f"{INS} (fictitious)", H1), P("PENYATA TAHUNAN / ANNUAL STATEMENT - ELDERSHIELD 400", H2),
     kv([["Nombor polisi / Policy number", "ES400-0718823"], ["Orang yang diinsuranskan / Insured", "AMINAH BINTI ISMAIL (tarikh lahir / date of birth 9 June 1948)"],
         ["Tarikh mula / Cover start date", "1 October 2002"], ["Status premium / Premium status", "Premium payments completed at age 65. Cover continues for life; no further premium is payable."],
         ["Tarikh penyata / Statement date", "1 October 2026"]]),
     Spacer(1, 8), P("MANFAAT / BENEFIT", H2),
     tbl([["Manfaat / Benefit", "Jumlah / Amount"],
          ["Bayaran bulanan / Monthly payout", "S$400 sebulan / S$400 a month"],
          ["Tempoh bayaran maksimum / Maximum payout period", "72 bulan / 72 months"],
          ["Tempoh penangguhan / Deferment period", "90 hari / 90 days (no payout for the first 90 days of severe disability)"]], [80*mm, 94*mm]),
     Spacer(1, 6),
     P("Ketidakupayaan teruk bermaksud tidak dapat melakukan sekurang-kurangnya 3 daripada 6 Aktiviti Kehidupan Harian. / Severe disability means being unable to perform at least 3 of the 6 Activities of Daily Living: washing, dressing, feeding, toileting, walking or moving around, and transferring.", S),
     P("ElderShield Supplement: tiada / none on record.", S),
     P("Untuk membuat tuntutan, sila hubungi kami. / To make a claim, an accredited assessor must certify the severe disability.", S)]
DOCS["ElderShield400_Statement_2026"] = (build(s, INS), base(documentType="Annual Statement", documentRole="personal_schedule", insurer=INS + " (fictitious)", productName="ElderShield 400",
    policyNumber="ES400-0718823", policyType="Long-term Care", policyholder="Aminah binti Ismail", startDate="2002-10-01",
    insuredPeople=[person("AMINAH BINTI ISMAIL", "self", cov("Long-term Care", 400, 2, "S$400 a month", "Monthly payout, up to 72 months"))],
    waitingPeriods=["Deferment period 90 days"]))

# ---------------------------------------------------------------- 3. Endowment, bilingual Chinese / English, surrender table
INS = "Straits Lotus Life"
s = [P(f"{INS} (fictitious) 海峡莲花人寿 (虚构)", ZH2), P("GOLDEN LOTUS ENDOWMENT 18 金莲储蓄计划 - POLICY ILLUSTRATION AND SCHEDULE 保单说明及附表", ZH2),
     tbl([["保单号码 Policy number", "SLL-GL18-2290471"], ["保单持有人 Policy owner", "Rahman bin Yusof"], ["受保人 Life assured", "Muhammad Irfan bin Rahman (出生日期 date of birth 3 August 2011)"],
          ["生效日期 Commencement date", "1 August 2018"], ["满期日期 Maturity date", "1 August 2036 (受保人25岁 when the life assured is 25)"], ["保额 Sum assured", "S$30,000"],
          ["年缴保费 Annual premium", "S$2,460.00, payable for 18 years 缴费18年"], ["保证满期价值 Guaranteed maturity value", "S$36,000"]], [62*mm, 112*mm], head=0, size=8.5, font="STSong-Light"),
     Spacer(1, 6), P("非保证价值是根据投资回报率4.25%和3.00%的假设计算，并非保证。 Non-guaranteed values are illustrated at assumed investment returns of 4.25% and 3.00% a year and are not guaranteed.", ZH),
     PageBreak(), P("退保价值表 SURRENDER VALUE TABLE (at the end of each policy year 每个保单年度结束时)", ZH2),
     tbl([["保单年度 Policy year", "已缴保费总额 Total premiums paid", "保证退保价值 Guaranteed surrender value", "总退保价值 (4.25%) Total surrender value at 4.25%", "总退保价值 (3.00%) Total surrender value at 3.00%"],
          ["1", "S$2,460", "S$0", "S$0", "S$0"], ["3", "S$7,380", "S$2,950", "S$3,120", "S$3,050"], ["5", "S$12,300", "S$9,840", "S$10,560", "S$10,190"],
          ["8", "S$19,680", "S$17,220", "S$19,050", "S$18,110"], ["10", "S$24,600", "S$22,630", "S$25,720", "S$24,060"],
          ["15", "S$36,900", "S$33,950", "S$41,200", "S$37,540"], ["18 (满期 maturity)", "S$44,280", "S$36,000", "S$48,210", "S$41,580"]],
         [24*mm, 34*mm, 38*mm, 40*mm, 40*mm], size=7.5, font="STSong-Light"),
     Spacer(1, 6), P("提前退保可能导致损失。 Surrendering early may mean you get back less than the premiums paid. The 8th policy year ended on 1 August 2026.", ZH),
     P("身故赏金 Death benefit: 已缴保费的101%或保证退保价值加红利，以较高者为准。 101% of premiums paid, or the guaranteed surrender value plus bonuses, whichever is higher.", ZH)]
DOCS["GoldenLotus_Endowment_Illustration"] = (build(s, INS), base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=INS + " (fictitious)", productName="Golden Lotus Endowment 18",
    policyNumber="SLL-GL18-2290471", policyType="Endowment", policyholder="Rahman bin Yusof", startDate="2018-08-01", renewalOrExpiryDate="2036-08-01",
    insuredPeople=[person("Muhammad Irfan bin Rahman", "child", cov("Savings", 36000, 2, "S$36,000", "Guaranteed maturity value"))],
    premium={"amount": 2460.0, "currency": "SGD", "frequency": "annual"}))

# ---------------------------------------------------------------- 4. ILP annual statement, fund units
INS = "Merdeka Life Assurance"
s = [P(f"{INS} (fictitious)", H1), P("LION GATEWAY INVEST-LINK - ANNUAL POLICY STATEMENT", H2),
     kv([["Policy number", "MLA-ILP-5520734"], ["Policyholder and life assured", "Rahman bin Yusof"], ["Statement date", "Valuation as at 30 June 2026"],
         ["Policy start date", "1 July 2018"], ["Basic sum assured", "S$100,000"], ["Regular premium", "S$150.00 a month (S$1,800.00 a year), 100% allocated to units"]]),
     Spacer(1, 8), P("YOUR FUND HOLDINGS", H2),
     tbl([["Fund", "Units held", "Bid price (30 June 2026)", "Value"],
          ["Merdeka Asia Dividend Fund", "4,812.335", "S$1.2840", "S$6,179.04"], ["Merdeka Global Bond Fund", "3,105.000", "S$0.9715", "S$3,016.51"],
          ["Total fund value", "", "", "S$9,195.55"]], [70*mm, 30*mm, 40*mm, 34*mm]),
     Spacer(1, 6),
     P("Death benefit: the higher of the basic sum assured or the total fund value. Fund values are not guaranteed and may go down as well as up.", S),
     P("There is no surrender charge after the 5th policy year. Insurance charges are deducted monthly by cancelling units.", S)]
DOCS["LionGateway_ILP_Statement_2026"] = (build(s, INS), base(documentType="Annual Statement", documentRole="personal_schedule", insurer=INS + " (fictitious)", productName="Lion Gateway Invest-Link",
    policyNumber="MLA-ILP-5520734", policyType="Investment-linked", policyholder="Rahman bin Yusof", startDate="2018-07-01",
    insuredPeople=[person("Rahman bin Yusof", "self", cov("Death", 100000, 2, "Basic sum assured", "Higher of sum assured or fund value"), cov("Investment", 9195.55, 2, "S$9,195.55", "Total fund value at 30 June 2026"))],
    premium={"amount": 150.0, "currency": "SGD", "frequency": "monthly"}))

# ---------------------------------------------------------------- 5. Personal accident, percentage-of-sum-insured scale
INS = "Kranji General Insurance"
s = [P(f"{INS} (fictitious)", H1), P("SAFEGUARD JUNIOR PERSONAL ACCIDENT - POLICY SCHEDULE", H2),
     kv([["Policy number", "KGI-SGJ-1187365"], ["Policyholder", "Rahman bin Yusof"], ["Insured person", "Muhammad Irfan bin Rahman (son, age 15)"],
         ["Period of insurance", "1 March 2026 to 28 February 2027"], ["Sum insured", "S$150,000"], ["Annual premium", "S$188.00"]]),
     PageBreak(), P("SCALE OF COMPENSATION (percentage of the sum insured)", H2),
     tbl([["Event caused by an accident", "% of sum insured"],
          ["Accidental death", "100%"], ["Permanent total disablement", "100%"], ["Loss of two limbs, or sight of both eyes", "100%"], ["Loss of one limb", "50%"],
          ["Loss of sight of one eye", "50%"], ["Total loss of hearing in both ears", "75%"], ["Loss of a thumb", "25%"], ["Loss of an index finger", "10%"], ["Loss of any other finger", "5%"]], [120*mm, 50*mm]),
     Spacer(1, 6),
     tbl([["Other benefits", "Limit"], ["Medical expenses for an accident", "Up to S$3,000 per accident (traditional Chinese medicine up to S$300)"],
          ["Excess on medical expense claims", "S$50 per claim"]], [80*mm, 90*mm]),
     P("The total paid for one accident under the scale will not exceed 100% of the sum insured.", FN)]
DOCS["SafeGuard_Junior_PA_Schedule"] = (build(s, INS), base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=INS + " (fictitious)", productName="SafeGuard Junior PA",
    policyNumber="KGI-SGJ-1187365", policyType="Personal Accident", policyholder="Rahman bin Yusof", startDate="2026-03-01", renewalOrExpiryDate="2027-02-28",
    insuredPeople=[person("Muhammad Irfan bin Rahman", "child", cov("Personal Accident", 150000, 2, "Sum insured"))],
    premium={"amount": 188.0, "currency": "SGD", "frequency": "annual"}))

# ---------------------------------------------------------------- 6. Home contents
INS = "Bedok Bay General Insurance"
s = [P(f"{INS} (fictitious)", H1), P("HOMESHIELD CONTENTS PLUS - POLICY SCHEDULE", H2),
     kv([["Policy number", "BBG-HC-6603381"], ["Insured", "Rahman bin Yusof"], ["Insured address", "Blk 812 Tampines Avenue 4, #08-215, Singapore 520812"],
         ["Period of insurance", "15 November 2025 to 14 November 2026"], ["Annual premium", "S$214.00 including GST"]]),
     Spacer(1, 8), P("SECTIONS OF COVER", H2),
     tbl([["Section", "Limit"], ["Household contents", "S$60,000"], ["Renovations", "S$20,000"], ["Valuables (jewellery, watches)", "S$5,000 in total, S$1,000 for any one item"],
          ["Personal liability", "S$500,000"], ["Alternative accommodation", "S$100 a day, up to S$6,000"], ["Excess", "S$250 for each claim"]], [80*mm, 94*mm]),
     Spacer(1, 6), P("Damage caused by gradual wear and tear, termites or a leaking pipe over a long period is excluded. Water damage from a sudden burst pipe is covered.", S)]
DOCS["HomeShield_Contents_Schedule"] = (build(s, INS), base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=INS + " (fictitious)", productName="HomeShield Contents Plus",
    policyNumber="BBG-HC-6603381", policyType="Home", policyholder="Rahman bin Yusof", startDate="2025-11-15", renewalOrExpiryDate="2026-11-14",
    insuredPeople=[person("Rahman bin Yusof", "self", cov("Home", 60000, 2, "S$60,000", "Household contents"))],
    premium={"amount": 214.0, "currency": "SGD", "frequency": "annual"}))

# ---------------------------------------------------------------- 7. Car
INS = "Changi Road General Insurance"
s = [P(f"{INS} (fictitious)", H1), P("DRIVESAFE COMPREHENSIVE MOTOR - CERTIFICATE AND SCHEDULE", H2),
     kv([["Policy number", "CRG-DS-7741926"], ["Policyholder", "Rahman bin Yusof"], ["Vehicle", "Toyota Corolla Altis 1.6 (2019), registration SKA 1234 Z"],
         ["Period of insurance", "8 August 2026 to 7 August 2027"], ["Named driver", "Nur Aisyah binte Rahman"],
         ["Premium", "S$1,486.20 after a 30% no-claim discount"]]),
     Spacer(1, 8), P("COVER AND EXCESS", H2),
     tbl([["Item", "Limit or excess"], ["Own damage", "Market value at the time of loss"], ["Own damage excess", "S$800 for each claim"],
          ["Additional excess: driver under 26 or with less than 2 years of driving experience", "S$2,500"], ["Windscreen excess", "S$100"],
          ["Third-party injury or death", "Unlimited"], ["Third-party property damage", "S$5,000,000"]], [100*mm, 74*mm]),
     Spacer(1, 6), P("Only the policyholder and the named driver may drive the vehicle. Any other driver is not insured by this policy.", S)]
DOCS["DriveSafe_Motor_Certificate"] = (build(s, INS), base(documentType="Certificate of Insurance", documentRole="certificate", insurer=INS + " (fictitious)", productName="DriveSafe Comprehensive Motor",
    policyNumber="CRG-DS-7741926", policyType="Motor", policyholder="Rahman bin Yusof", startDate="2026-08-08", renewalOrExpiryDate="2027-08-07",
    insuredPeople=[person("Rahman bin Yusof", "self", cov("Motor", None, 2, "Market value at the time of loss"))],
    premium={"amount": 1486.2, "currency": "SGD", "frequency": "annual"}, deductiblesAndCoinsurance=["Own damage excess S$800", "Young or inexperienced driver excess S$2,500"]))

# ---------------------------------------------------------------- 8. Lapse notice (term life)
INS = "Merdeka Life Assurance"
s = [P(f"{INS} (fictitious)", H1), P("NOTICE OF LAPSE - ASSURETERM 65", H2),
     P("Date: 24 March 2026", S), P("Dear Rahman bin Yusof,", S),
     kv([["Policy number", "MLA-AT65-3392017"], ["Life assured", "Rahman bin Yusof"], ["Sum assured before lapse", "S$300,000 on death or total and permanent disability"],
         ["Monthly premium", "S$96.50"]]),
     Spacer(1, 6),
     P("The premium due on 15 February 2026 was not paid by the end of the grace period. Your policy lapsed on 17 March 2026 and all cover stopped on that date. No benefit is payable for any event on or after 17 March 2026.", S),
     P("You may apply to reinstate the policy until 16 March 2028. Reinstatement needs a health declaration and payment of all overdue premiums with interest at 5% a year.", S)]
DOCS["AssureTerm65_Lapse_Notice"] = (build(s, INS), base(documentType="Notice of Lapse", documentRole="other", insurer=INS + " (fictitious)", productName="AssureTerm 65",
    policyNumber="MLA-AT65-3392017", policyType="Term Life", policyholder="Rahman bin Yusof", personalCoverageConfirmed=False, renewalOrExpiryDate="2026-03-17",
    documentNotes=["Policy lapsed on 17 March 2026"], insuredPeople=[person("Rahman bin Yusof", "self")]))

# ---------------------------------------------------------------- 9. Grace-period reminder with cover summary (daughter overseas)
INS = "Orchard Mutual Life"
s = [P(f"{INS} (fictitious)", H1), P("HERCARE CRITICAL ILLNESS - PREMIUM REMINDER (GRACE PERIOD)", H2),
     P("Date: 25 September 2026", S), P("To: Nur Aisyah binte Rahman, 14 Lygon Street, Carlton VIC 3053, Australia", S),
     kv([["Policy number", "OML-HC-7781204"], ["Life assured", "Nur Aisyah binte Rahman"], ["Monthly premium", "S$86.40"], ["Premium due date", "20 September 2026"],
         ["Grace period ends", "20 October 2026"]]),
     Spacer(1, 6),
     P("We have not received the monthly premium of S$86.40 that was due on 20 September 2026. Your policy stays in force during the 30-day grace period, which ends on 20 October 2026. If we do not receive payment by then, the policy will lapse.", S),
     PageBreak(), P("YOUR COVER (SUMMARY)", H2),
     tbl([["Benefit", "Amount"], ["Critical illness (37 illnesses, late stage)", "S$100,000"], ["Early-stage female cancers", "25% of the sum assured, up to S$25,000"],
          ["Policy term", "1 May 2023 to 30 April 2048"]], [100*mm, 74*mm]),
     P("A waiting period of 90 days from the start date applies to cancer, heart attack and coronary artery bypass surgery.", S)]
DOCS["HerCare_CI_Grace_Reminder"] = (build(s, INS), base(documentType="Premium Reminder", documentRole="personal_schedule", insurer=INS + " (fictitious)", productName="HerCare Critical Illness",
    policyNumber="OML-HC-7781204", policyType="Critical Illness", policyholder="Nur Aisyah binte Rahman", startDate="2023-05-01", renewalOrExpiryDate="2048-04-30",
    insuredPeople=[person("Nur Aisyah binte Rahman", "self", cov("Critical Illness", 100000, 3, "S$100,000"))],
    premium={"amount": 86.4, "currency": "SGD", "frequency": "monthly"}, waitingPeriods=["90 days for cancer, heart attack, CABG"]))

# ---------------------------------------------------------------- 10. Expired single-trip travel
INS = "Jurong Point General Insurance"
s = [P(f"{INS} (fictitious)", H1), P("WANDERLUST SINGLE TRIP TRAVEL - CERTIFICATE OF INSURANCE", H2),
     kv([["Certificate number", "JPG-WST-2025-55190"], ["Insured persons", "Rahman bin Yusof; Nur Aisyah binte Rahman"], ["Destination", "Japan"],
         ["Period of insurance", "1 December 2025 to 14 December 2025"], ["Plan", "Classic"], ["Premium paid", "S$118.80"]]),
     Spacer(1, 8), P("BENEFITS (per insured person)", H2),
     tbl([["Benefit", "Limit"], ["Overseas medical expenses", "S$250,000"], ["Trip cancellation", "S$5,000"], ["Baggage loss or damage", "S$3,000 (S$500 for any one item)"],
          ["Travel delay", "S$100 for every 6 hours of delay, up to S$1,000"]], [90*mm, 84*mm])]
DOCS["Wanderlust_Japan_Travel_2025"] = (build(s, INS), base(documentType="Certificate of Insurance", documentRole="certificate", insurer=INS + " (fictitious)", productName="Wanderlust Single Trip",
    policyNumber="JPG-WST-2025-55190", policyType="Travel", startDate="2025-12-01", renewalOrExpiryDate="2025-12-14",
    insuredPeople=[person("Rahman bin Yusof", None, cov("Travel", 250000, 2, "S$250,000")), person("Nur Aisyah binte Rahman", None, cov("Travel", 250000, 2, "S$250,000"))],
    premium={"amount": 118.8, "currency": "SGD", "frequency": "single"}))

# ---------------------------------------------------------------- 11. Premium notice only (mother's hospital income plan)
INS = "Bukit Timah Life"
s = [P(f"{INS} (fictitious)", H1), P("PREMIUM NOTICE", H2), P("Date: 2 October 2026", S),
     kv([["Plan", "Silver Years Hospital Income"], ["Policy number", "BTL-SY-0091355"], ["Life assured", "Aminah binte Ismail"], ["Premium due date", "1 November 2026"],
         ["Amount due", "S$312.00 (annual premium)"], ["Payment method", "GIRO from your DBS account ending 4471"]]),
     Spacer(1, 6), P("Please make sure your account has enough funds on the due date. This notice is not a receipt.", S)]
DOCS["SilverYears_Premium_Notice"] = (build(s, INS), base(documentType="Premium Notice", documentRole="premium_receipt", insurer=INS + " (fictitious)", productName="Silver Years Hospital Income",
    policyNumber="BTL-SY-0091355", personalCoverageConfirmed=False, insuredPeople=[person("Aminah binte Ismail", "parent")],
    paymentRecords=[{"insuredPersonName": "Aminah binte Ismail", "insurer": INS + " (fictitious)", "productName": "Silver Years Hospital Income", "policyNumber": "BTL-SY-0091355", "amount": 312.0, "currency": "SGD",
                     "frequency": "annual", "paymentDate": "2026-11-01", "periodStart": None, "periodEnd": None, "sourcePage": 2, "notes": "premium due", "evidenceText": "S$312.00 (annual premium)"}]))

# ---------------------------------------------------------------- 12. Helper insurance (apostrophe + hyphen name)
INS = "Kallang Basin General Insurance"
s = [P(f"{INS} (fictitious)", H1), P("HELPERCARE FOREIGN DOMESTIC WORKER INSURANCE - POLICY SCHEDULE", H2),
     kv([["Policy number", "KBG-FDW-3308812"], ["Employer", "Rahman bin Yusof"], ["Insured helper", "Maria Luz D'Souza-Reyes"],
         ["Period of insurance", "1 June 2025 to 31 May 2027"], ["Premium for the period", "S$398.00"]]),
     Spacer(1, 8),
     tbl([["Benefit", "Limit"], ["Hospital and surgical expenses", "S$60,000 a year"], ["Personal accident (death or permanent disablement)", "S$60,000"],
          ["Security bond guarantee", "S$5,000"], ["Outpatient", "Not included in this plan"]], [100*mm, 74*mm])]
DOCS["HelperCare_FDW_Schedule"] = (build(s, INS), base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=INS + " (fictitious)", productName="HelperCare FDW Insurance",
    policyNumber="KBG-FDW-3308812", policyType="Hospitalisation", policyholder="Rahman bin Yusof", startDate="2025-06-01", renewalOrExpiryDate="2027-05-31",
    insuredPeople=[person("Maria Luz D'Souza-Reyes", "helper", cov("Hospitalisation", 60000, 2, "S$60,000 a year"))],
    premium={"amount": 398.0, "currency": "SGD", "frequency": "single"}))

def trim(p):
    q = copy.deepcopy(p)
    for st in [lambda q: q.update(keyExclusions=[]), lambda q: q.update(productsMentioned=[]), lambda q: q.update(riders=[]), lambda q: q.update(waitingPeriods=[]),
               lambda q: [c.update(notes=None) for ip in q["insuredPeople"] for c in ip["coverages"]]]:
        if len(base64.b64encode(json.dumps(q, separators=(",", ":")).encode())) <= 1950: break
        st(q)
    n = len(base64.b64encode(json.dumps(q, separators=(",", ":")).encode()))
    assert n <= 1950, n
    return q
for name, (pdf, payload) in DOCS.items():
    enc = base64.b64encode(json.dumps(trim(payload), separators=(",", ":")).encode()).decode()
    ctrl = io.BytesIO(); c = canvas.Canvas(ctrl, pagesize=A4); c.setFont("Helvetica", 6); y = 800
    for line in ["DPTEST-EXTRACTION:"] + [enc[i:i+110] for i in range(0, len(enc), 110)] + [":DPTEST-END"]:
        c.drawString(30, y, line); y -= 8
    c.save()
    w = PdfWriter()
    for pg in PdfReader(io.BytesIO(ctrl.getvalue())).pages: w.add_page(pg)
    for pg in PdfReader(io.BytesIO(pdf)).pages: w.add_page(pg)
    w.add_metadata({"/Producer": "dearpolicy-r7-fixture"})
    out = io.BytesIO(); w.write(out)
    b64 = base64.b64encode(out.getvalue()).decode()
    with open(os.path.join(HERE, name + ".pdf.b64"), "w") as f: f.write("\n".join(b64[i:i+76] for i in range(0, len(b64), 76)) + "\n")
    print(name, len(enc), len(out.getvalue()))

# Realistic-looking, clearly FICTITIOUS insurer documents for exploratory testing (synthetic only).
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Frame, PageTemplate, BaseDocTemplate, NextPageTemplate
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
import pikepdf, os
OUT = "/home/user/explore/docs/out"
ss = getSampleStyleSheet(); H1 = ss["Heading1"]; H2 = ss["Heading2"]; B = ss["BodyText"]
S = ParagraphStyle("s", parent=B, fontSize=7, leading=8.5); FN = ParagraphStyle("fn", parent=B, fontSize=6.5, leading=8, textColor=colors.grey)
def P(t, st=B): return Paragraph(t, st)
def tbl(rows, widths, head=1, size=7):
    t = Table([[P(str(c), ParagraphStyle("c", parent=B, fontSize=size, leading=size + 1.5)) for c in r] for r in rows], colWidths=widths, repeatRows=head)
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("BACKGROUND", (0, 0), (-1, head - 1), colors.lightgrey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return t
def footer(insurer):
    def f(c, d):
        c.saveState(); c.setFont("Helvetica", 6.5)
        c.drawString(15 * mm, 8 * mm, f"{insurer} (fictitious insurer - synthetic test document)   Page {d.page}")
        c.restoreState()
    return f
def build(name, story, insurer, twocol=False):
    path = os.path.join(OUT, name)
    if twocol:
        doc = BaseDocTemplate(path, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=15*mm, bottomMargin=15*mm)
        w = (A4[0] - 30*mm - 6*mm) / 2
        frames = [Frame(15*mm, 15*mm, w, A4[1]-30*mm, id="l"), Frame(15*mm + w + 6*mm, 15*mm, w, A4[1]-30*mm, id="r")]
        full = [Frame(15*mm, 15*mm, A4[0]-30*mm, A4[1]-30*mm, id="f")]
        doc.addPageTemplates([PageTemplate(id="full", frames=full, onPage=footer(insurer)), PageTemplate(id="two", frames=frames, onPage=footer(insurer))])
        doc.build(story)
    else:
        SimpleDocTemplate(path, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=15*mm, bottomMargin=15*mm).build(story, onFirstPage=footer(insurer), onLaterPages=footer(insurer))
    return path

# 1. Integrated Shield plan (hospital) -- deductible, co-insurance, as charged, pro-ration, sub-limits, rider, footnotes
INS = "Merlion Mutual Assurance"
s = [P(f"{INS} (fictitious)", H1), P("SHIELDCARE PREMIER - Integrated Shield Plan", H2),
     P("POLICY SCHEDULE", H2),
     tbl([["Policy number", "MMA-ISP-7730152"], ["Policyholder", "Tan Mei Ling"], ["Life assured", "Tan Mei Ling (date of birth 14 March 1984)"],
          ["Plan", "ShieldCare Premier (Private hospital) with ShieldCare Plus Rider"], ["Period of insurance", "1 April 2026 to 31 March 2027"],
          ["Annual premium (Integrated Shield Plan)", "S$1,284.00, of which S$1,050.00 is payable from MediSave and S$234.00 in cash"],
          ["Annual premium (ShieldCare Plus Rider)", "S$689.00 payable in cash"], ["Date of issue", "18 March 2026"]], [60*mm, 110*mm], head=0, size=8),
     Spacer(1, 6), P("This schedule forms part of your policy. Please read it with the Policy Wording and the Rider Wording. All amounts are in Singapore dollars unless stated otherwise.", S),
     PageBreak(), P("TABLE OF BENEFITS", H2),
     tbl([["Benefit", "Private hospital", "Restructured hospital (A ward)", "Restructured hospital (B1 ward)", "Notes"],
          ["Daily room, board and hospital services", "As charged", "As charged", "As charged", "1"],
          ["Intensive care unit", "As charged", "As charged", "As charged", ""],
          ["Surgical benefits (including day surgery)", "As charged", "As charged", "As charged", "1, 2"],
          ["Pre-hospitalisation treatment", "As charged, within 180 days before admission", "As charged, within 180 days", "As charged, within 180 days", "3"],
          ["Post-hospitalisation treatment", "As charged, within 365 days after discharge", "As charged, within 365 days", "As charged, within 365 days", "3"],
          ["Community hospital", "As charged, up to 90 days", "As charged, up to 90 days", "As charged, up to 90 days", ""],
          ["Outpatient cancer drug treatment (on the Cancer Drug List)", "Up to 5 x MediShield Life limit per month", "Up to 5 x MediShield Life limit per month", "Up to 3 x MediShield Life limit per month", "4"],
          ["Outpatient kidney dialysis", "Up to S$4,000 per month", "Up to S$4,000 per month", "Up to S$3,000 per month", ""],
          ["Emergency overseas treatment", "As charged, capped at the cost of a Singapore private hospital", "Not covered", "Not covered", "5"],
          ["Pro-ration factor (private hospital treatment on a restructured-hospital plan)", "Not applicable", "65%", "50%", "6"],
          ["Policy year limit", "S$2,000,000", "S$1,000,000", "S$500,000", ""],
          ["Deductible per policy year (Class B1 / A / private)", "S$3,500", "S$3,500", "S$2,500", "7"],
          ["Co-insurance", "10%", "10%", "10%", "7"],
          ], [48*mm, 36*mm, 32*mm, 32*mm, 12*mm]),
     Spacer(1, 4),
     P("1. Pre-authorised treatment at a panel private hospital is paid as charged. Treatment by a non-panel specialist is paid up to the MOH fee benchmark; any excess is not covered.", FN),
     P("2. Day surgery follows the deductible and co-insurance that apply to the ward class you choose.", FN),
     P("3. Pre- and post-hospitalisation treatment must be directly related to the hospital stay or day surgery.", FN),
     P("4. Only treatments on the MOH Cancer Drug List are covered. Non-listed cancer drugs are not covered under this plan.", FN),
     P("5. Emergency overseas treatment is covered only for emergencies. Planned overseas treatment is not covered.", FN),
     P("6. If you stay in a ward higher than your plan covers, the claimable amount is multiplied by the pro-ration factor before the deductible and co-insurance apply.", FN),
     P("7. You pay the deductible first, then 10% of the remaining claimable amount (co-insurance). See the ShieldCare Plus Rider for the co-payment cap.", FN),
     PageBreak(), P("SHIELDCARE PLUS RIDER - SCHEDULE OF BENEFITS", H2),
     tbl([["Rider benefit", "Panel provider or pre-authorised", "Non-panel provider"],
          ["Deductible", "Covered in full (you pay nothing towards the deductible)", "Not covered"],
          ["Co-insurance", "You pay 5% of the claimable amount", "You pay 5% of the claimable amount"],
          ["Co-payment cap per policy year", "S$3,000", "No cap"],
          ["Post-hospitalisation extension", "Extended to 365 days", "Not extended"],
          ["Ambulance fees", "Up to S$500 per admission", "Up to S$500 per admission"]], [50*mm, 65*mm, 55*mm]),
     Spacer(1, 6), P("The ShieldCare Plus Rider pays part of the deductible and co-insurance that you would otherwise pay under ShieldCare Premier. From 1 April 2026 the rider does not cover the minimum 5% co-payment. Riders must be paid in cash; MediSave cannot be used.", S),
     PageBreak(), P("GENERAL EXCLUSIONS", H2)]
for ex in ["Pre-existing conditions not declared at application, unless accepted in writing.", "Treatment during the first 30 days of the policy, except for accidents.", "Cosmetic surgery, dental treatment other than as a result of an accident, and spectacles.",
           "Pregnancy, childbirth and related complications, except the specified pregnancy complications listed in the Policy Wording.", "Self-inflicted injuries, drug or alcohol abuse.", "Congenital conditions for a life assured older than 1 year at entry, unless covered by MediShield Life."]:
    s.append(P("- " + ex, S))
s += [PageBreak(), P("HOW TO CLAIM", H2), P("For a pre-authorised admission, the hospital files the claim electronically. Otherwise, submit the final hospital bill, the inpatient discharge summary and the Letter of Guarantee (if any) within 90 days after discharge.", S)]
build("ShieldCare_Premier_Schedule_2026.pdf", s, INS)

# 2. Group insurance booklet -- Plan A/B/C tiers, employee vs dependant, multi-column
INS2 = "Lion City General Insurance"
s = [P(f"{INS2} (fictitious)", H1), P("Employee Benefits Booklet 2026 - Harbourfront Logistics Pte Ltd (fictitious employer)", H2),
     P("This booklet summarises the group insurance programme for employees and their eligible dependants. It is not a contract. The master policy GHS-HL-2026-004 prevails.", S),
     P("Eligible employee: Lim Wei Jie, Operations Manager, Plan A (Grade M2 and above). Dependants enrolled: spouse Tan Mei Ling; child Lim Xin Yi.", S),
     PageBreak(), P("SECTION 1 - GROUP TERM LIFE (GTL) AND GROUP PERSONAL ACCIDENT (GPA)", H2),
     tbl([["Benefit", "Plan A (Grade M2 and above)", "Plan B (Grade E1 to M1)", "Plan C (all other staff)", "Dependants"],
          ["Group Term Life - death or total and permanent disability", "36 x last drawn basic monthly salary, maximum S$500,000", "24 x basic monthly salary, maximum S$250,000", "S$50,000", "Not covered"],
          ["Group Personal Accident - accidental death", "S$300,000", "S$200,000", "S$100,000", "Spouse: S$50,000; child: S$20,000"],
          ["GPA - permanent disablement", "Up to S$300,000 per scale", "Up to S$200,000 per scale", "Up to S$100,000 per scale", "Per scale, up to the dependant sum insured"],
          ["GPA - medical expenses per accident", "S$3,000", "S$2,000", "S$1,000", "S$500"]], [40*mm, 38*mm, 34*mm, 28*mm, 30*mm]),
     P("Salary multiples use the basic monthly salary on the date of the event. Non-medical limit S$750,000; amounts above it need evidence of health.", FN),
     PageBreak(), P("SECTION 2 - GROUP HOSPITAL AND SURGICAL (GHS)", H2),
     tbl([["Benefit (per disability unless stated)", "Plan A", "Plan B", "Plan C", "Dependants (Plan A only)"],
          ["Daily room and board (max 120 days)", "S$360 per day", "S$250 per day", "S$150 per day", "S$250 per day"],
          ["Intensive care unit (max 30 days)", "S$720 per day", "S$500 per day", "S$300 per day", "S$500 per day"],
          ["Hospital miscellaneous services", "S$8,000", "S$6,000", "S$4,000", "S$6,000"],
          ["Surgical fees (per schedule)", "S$10,000", "S$8,000", "S$6,000", "S$8,000"],
          ["Pre-hospital specialist consultation (within 90 days)", "S$1,000", "S$800", "S$500", "S$800"],
          ["Post-hospitalisation treatment (within 90 days)", "S$1,000", "S$800", "S$500", "S$800"],
          ["Overall annual limit", "S$100,000", "S$80,000", "S$60,000", "S$80,000"]], [48*mm, 30*mm, 30*mm, 30*mm, 32*mm]),
     P("GHS benefits are paid after MediShield Life and any Integrated Shield Plan (coordination of benefits). Dependant cover applies to Plan A employees who pay the dependant premium.", FN),
     PageBreak(), P("SECTION 3 - OUTPATIENT (GP, SPECIALIST, DENTAL)", H2),
     tbl([["Benefit", "Plan A", "Plan B", "Plan C", "Dependants"],
          ["General practitioner - panel clinic", "Co-payment S$5 per visit", "Co-payment S$10 per visit", "Co-payment S$10 per visit", "Co-payment S$10 per visit"],
          ["General practitioner - non-panel clinic", "Reimbursed up to S$40 per visit", "Up to S$30 per visit", "Up to S$25 per visit", "Up to S$30 per visit"],
          ["Specialist (referral required)", "Up to S$150 per visit, S$2,000 per year", "Up to S$120 per visit, S$1,500 per year", "Not covered", "Up to S$120 per visit"],
          ["Dental", "Up to S$300 per year", "Up to S$200 per year", "Not covered", "Not covered"],
          ["Traditional Chinese medicine", "Up to S$30 per visit, 10 visits per year", "Up to S$25 per visit, 10 visits", "Not covered", "Not covered"]], [44*mm, 34*mm, 34*mm, 28*mm, 30*mm]),
     PageBreak(), P("SECTION 4 - HOW TO CLAIM", H2),
     P("Submit claims through the HR portal within 30 days of the visit or discharge. Hospital claims need the final bill and discharge summary. Death claims need the death certificate and the claimant's statement.", S)]
build("Harbourfront_Employee_Benefits_2026.pdf", s, INS2)

# 3. Premium / renewal notice
s = [P(f"{INS} (fictitious)", H1), P("RENEWAL NOTICE AND PREMIUM DUE", H2),
     P("Dear Tan Mei Ling,", B), P("Your ShieldCare Premier policy MMA-ISP-7730152 will renew on 1 April 2027. Please see the premium payable below.", B),
     tbl([["Item", "Amount"], ["ShieldCare Premier premium (age next birthday 44)", "S$1,412.00"], ["Less: MediSave deduction (Additional Withdrawal Limit)", "S$1,050.00"],
          ["ShieldCare Premier cash payable", "S$362.00"], ["ShieldCare Plus Rider premium (cash)", "S$758.00"], ["Total cash payable", "S$1,120.00"],
          ["Payment due date", "1 April 2027"], ["Payment mode", "GIRO - deducted on 5 April 2027"]], [110*mm, 50*mm], size=9),
     P("If payment is not received within the 30-day grace period, the rider will lapse. Your Integrated Shield Plan continues while MediSave pays its portion.", B)]
build("ShieldCare_Renewal_Notice_2027.pdf", s, INS)

# 4. Term life renewal certificate + two-column policy wording (endowment of terms)
INS3 = "Straits Heritage Life (fictitious)"
s = [P(INS3, H1), P("CERTIFICATE OF RENEWAL - TERMSECURE 20", H2),
     tbl([["Policy number", "SHL-TS20-551820"], ["Life assured", "Lim Wei Jie"], ["Sum assured - death", "S$800,000"], ["Sum assured - total and permanent disability (before age 65)", "S$800,000"],
          ["Critical illness accelerator rider (37 critical illnesses, late stage)", "S$200,000 (accelerates the death benefit)"], ["Renewal period", "12 June 2026 to 11 June 2027"], ["Annual premium", "S$1,936.50"]], [90*mm, 80*mm], head=0, size=9),
     P("The critical illness benefit is an acceleration of the death benefit: any amount paid for a critical illness reduces the death sum assured by the same amount.", B),
     NextPageTemplate("two"), PageBreak(), P("EXTRACT OF POLICY PROVISIONS", H2)]
for i, (h, t) in enumerate([
    ("1. Death benefit", "If the life assured dies during the policy term, we pay the death sum assured less any amount already paid under the critical illness accelerator rider."),
    ("2. Total and permanent disability", "Total and permanent disability means the life assured is unable to work in any occupation for at least 6 continuous months, or suffers the total and irrecoverable loss of sight of both eyes or use of two limbs. The benefit is paid only if disability starts before the policy anniversary on which the life assured is aged 65."),
    ("3. Suicide exclusion", "If the life assured commits suicide within 1 year of the issue date or the date of reinstatement, the policy ends and we refund the premiums paid, without interest."),
    ("4. Critical illness accelerator", "We pay the critical illness sum assured if the life assured is first diagnosed with one of the 37 critical illnesses (late stage) defined in the Life Insurance Association Singapore (LIA) 2019 definitions, after a waiting period of 90 days from the issue date for cancer, heart attack and coronary artery by-pass surgery. The life assured must survive 7 days after diagnosis."),
    ("5. Grace period", "A grace period of 30 days is allowed for each premium after the first."),
    ("6. Claims", "Death claims must be notified within 90 days with the certified death certificate, the claimant's identity documents and proof of relationship.")]):
    s += [P(h, ParagraphStyle("h", parent=B, fontName="Helvetica-Bold", fontSize=8)), P(t + " " + ("This provision is subject to the general terms of the policy. " * 3), S)]
build("TermSecure20_Renewal_Certificate_2026.pdf", s, INS3, twocol=True)

# 5. Travel policy (annual multi-trip), family plan, per-trip limits, delay per 6 hours
INS4 = "Sentosa Shield Travel (fictitious)"
s = [P(INS4, H1), P("TRAVELSAFE ANNUAL FAMILY - CERTIFICATE OF INSURANCE", H2),
     tbl([["Certificate number", "SST-AMT-2026-88412"], ["Insured persons", "Tan Mei Ling; Lim Wei Jie; Lim Xin Yi (child)"], ["Plan", "Annual multi-trip, Asia, Classic"], ["Period", "1 July 2026 to 30 June 2027"], ["Maximum trip duration", "90 days per trip"]], [60*mm, 110*mm], head=0, size=9),
     PageBreak(), P("SUMMARY OF BENEFITS (per insured person per trip)", H2),
     tbl([["Section", "Benefit", "Adult", "Child", "Family maximum"],
          ["1", "Overseas medical expenses", "S$500,000", "S$250,000", "S$1,000,000"],
          ["2", "Emergency medical evacuation and repatriation", "Unlimited", "Unlimited", "Unlimited"],
          ["3", "Travel delay (for every full 6 hours of delay)", "S$100", "S$100", "S$2,000"],
          ["3a", "Travel delay - maximum per person", "S$1,000", "S$1,000", ""],
          ["4", "Baggage delay (after 6 hours on arrival overseas)", "S$200", "S$200", "S$600"],
          ["5", "Loss of or damage to baggage and personal belongings", "S$5,000 (S$500 per item)", "S$2,500", "S$10,000"],
          ["6", "Trip cancellation", "S$10,000", "S$5,000", "S$20,000"],
          ["7", "Accidental death and permanent disablement", "S$200,000", "S$50,000", "S$450,000"],
          ["8", "COVID-19 overseas medical expenses", "S$150,000", "S$75,000", "S$300,000"]], [12*mm, 70*mm, 30*mm, 26*mm, 32*mm]),
     P("Travel delay is paid for each full 6 consecutive hours of delay of the scheduled public transport, caused by adverse weather, strike or mechanical breakdown. Delay must be confirmed in writing by the carrier.", S),
     P("Children are covered only when travelling with an insured adult. Pre-existing medical conditions are excluded.", S)]
build("TravelSafe_Annual_Family_2026.pdf", s, INS4)

# 6. Personal accident with a scale of compensation (percentages) + riders
INS5 = "Orchid Assurance (fictitious)"
rows = [["Item", "Injury", "Percentage of sum insured"], ["1", "Death", "100%"], ["2", "Permanent total disablement", "100%"], ["3", "Loss of sight of one eye", "50%"],
        ["4", "Loss of one limb (above the elbow or knee)", "50%"], ["5", "Loss of thumb (both phalanges)", "25%"], ["6", "Loss of index finger (three phalanges)", "10%"],
        ["7", "Permanent total loss of hearing, both ears", "75%"], ["8", "Third-degree burns covering more than 50% of body surface", "100%"]]
s = [P(INS5, H1), P("PA GUARDIAN - POLICY SCHEDULE", H2),
     tbl([["Policy number", "OA-PAG-209947"], ["Insured person", "Lim Xin Yi (child, aged 8)"], ["Sum insured", "S$100,000"], ["Accidental medical expenses", "Up to S$2,500 per accident, including traditional Chinese medicine up to S$250"],
          ["Fracture benefit", "S$1,000 per accident (S$2,000 for skull or spine)"], ["Hospital cash for accidents", "S$100 per day, up to 30 days"], ["Period", "1 January 2026 to 31 December 2026"]], [60*mm, 110*mm], head=0, size=9),
     PageBreak(), P("SCALE OF COMPENSATION", H2), tbl(rows, [15*mm, 105*mm, 50*mm]),
     P("The total of all percentages for one accident will not exceed 100%. If more than one injury results from the same accident, only the highest applicable percentage is paid for injuries to the same limb.", S),
     P("Sports rider: covers injuries while playing organised school sports. Not covered: professional sports, motor racing, scuba diving below 30 metres.", S)]
build("PA_Guardian_Schedule_2026.pdf", s, INS5)

# 7. Password-protected copy of the PA schedule
with pikepdf.open(os.path.join(OUT, "PA_Guardian_Schedule_2026.pdf")) as pdf:
    pdf.save(os.path.join(OUT, "PA_Guardian_Schedule_2026_LOCKED.pdf"), encryption=pikepdf.Encryption(user="S1234567", owner="own3r-x", R=6))
print("\n".join(sorted(os.listdir(OUT))))

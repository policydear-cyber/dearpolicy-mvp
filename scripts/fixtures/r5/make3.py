# Same documents + a final page carrying the extraction a competent reading model would return
# (DPTEST-EXTRACTION control block: the deterministic stand-in reads ONLY this). Synthetic only.
import json, base64, os
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
OUT = "/home/user/explore/docs/out"
def cov(cat, amt, cur, page, ev, notes=None, prod=None):
    return {"category": cat, "productName": prod, "policyNumber": None, "amount": amt, "currency": cur, "notes": notes, "sourcePage": page, "evidenceText": ev, "evidenceVerified": False}
def base(**k):
    d = {"documentType": None, "documentRole": None, "documentNotes": [], "insurer": None, "productName": None, "productsMentioned": [], "policyNumber": None, "groupPolicyNumber": None,
         "policyType": None, "policyholder": None, "personalCoverageConfirmed": True, "startDate": None, "renewalOrExpiryDate": None, "insuredPeople": [], "referenceCoverages": [],
         "premium": {"amount": None, "currency": None, "frequency": None}, "paymentRecords": [], "keyExclusions": [], "waitingPeriods": [], "deductiblesAndCoinsurance": [], "riders": []}
    d.update(k); return d
X = {
 "ShieldCare_Premier_Schedule_2026.pdf": base(documentType="Policy Schedule", documentRole="personal_schedule", insurer="Merlion Mutual Assurance (fictitious)", productName="ShieldCare Premier",
   productsMentioned=["ShieldCare Plus Rider"], policyNumber="MMA-ISP-7730152", policyType="Integrated Shield Plan", policyholder="Tan Mei Ling", startDate="2026-04-01", renewalOrExpiryDate="2027-03-31",
   insuredPeople=[{"name": "Tan Mei Ling", "relationshipHint": "self", "coverages": [
     cov("Hospitalisation", 2000000, "SGD", 2, "Policy year limit S$2,000,000", "Private hospital; room and board as charged"),
     cov("Hospitalisation", None, None, 2, "Daily room, board and hospital services As charged", "As charged"),
     cov("Outpatient cancer treatment", None, None, 2, "Outpatient cancer drug treatment (on the Cancer Drug List) Up to 5 x MediShield Life limit per month")]}],
   premium={"amount": 1284.0, "currency": "SGD", "frequency": "annual"},
   deductiblesAndCoinsurance=["Deductible S$3,500 per policy year (private hospital / Class A)", "Co-insurance 10%", "Rider: co-insurance 5%, co-payment cap S$3,000 per policy year (panel)"],
   waitingPeriods=["30 days except accidents"], riders=["ShieldCare Plus Rider"], keyExclusions=["Cosmetic surgery", "Pregnancy and childbirth except specified complications"]),
 "Harbourfront_Employee_Benefits_2026.pdf": base(documentType="Benefits Booklet", documentRole="benefit_guide", insurer="Lion City General Insurance (fictitious)", productName="Harbourfront Group Insurance Programme",
   productsMentioned=["Group Term Life", "Group Personal Accident", "Group Hospital and Surgical", "Group Outpatient"], groupPolicyNumber="GHS-HL-2026-004", policyType="Group insurance", policyholder="Harbourfront Logistics Pte Ltd",
   startDate="2026-01-01", renewalOrExpiryDate="2026-12-31",
   insuredPeople=[
     {"name": "Lim Wei Jie", "relationshipHint": "employee", "coverages": [cov("Life", None, None, 2, "36 x basic monthly salary, max S$500,000")]},
     {"name": "Tan Mei Ling", "relationshipHint": "spouse", "coverages": [cov("Accidental death", 50000, "SGD", 2, "Spouse: S$50,000")]},
     {"name": "Lim Xin Yi", "relationshipHint": "child", "coverages": [cov("Accidental death", 20000, "SGD", 2, "child: S$20,000")]}]),
 "ShieldCare_Renewal_Notice_2027.pdf": base(documentType="Renewal Notice", documentRole="renewal_statement", insurer="Merlion Mutual Assurance (fictitious)", productName="ShieldCare Premier", policyNumber="MMA-ISP-7730152",
   personalCoverageConfirmed=False, startDate="2027-04-01", renewalOrExpiryDate="2028-03-31", insuredPeople=[{"name": "Tan Mei Ling", "relationshipHint": "self", "coverages": []}],
   premium={"amount": 1120.0, "currency": "SGD", "frequency": "annual"},
   paymentRecords=[{"insuredPersonName": "Tan Mei Ling", "insurer": "Merlion Mutual Assurance (fictitious)", "productName": "ShieldCare Premier", "policyNumber": "MMA-ISP-7730152", "amount": 362.0, "currency": "SGD", "frequency": "annual", "paymentDate": "2027-04-05", "periodStart": "2027-04-01", "periodEnd": "2028-03-31", "sourcePage": 1, "notes": "cash portion after MediSave S$1,050", "evidenceText": "ShieldCare Premier cash payable S$362.00"},
                   {"insuredPersonName": "Tan Mei Ling", "insurer": "Merlion Mutual Assurance (fictitious)", "productName": "ShieldCare Plus Rider", "policyNumber": "MMA-ISP-7730152", "amount": 758.0, "currency": "SGD", "frequency": "annual", "paymentDate": "2027-04-05", "periodStart": "2027-04-01", "periodEnd": "2028-03-31", "sourcePage": 1, "notes": "rider, cash only", "evidenceText": "ShieldCare Plus Rider premium (cash) S$758.00"}]),
 "TermSecure20_Renewal_Certificate_2026.pdf": base(documentType="Certificate of Renewal", documentRole="certificate", insurer="Straits Heritage Life (fictitious)", productName="TermSecure 20", productsMentioned=["Critical illness accelerator rider"],
   policyNumber="SHL-TS20-551820", policyType="Term Life", startDate="2026-06-12", renewalOrExpiryDate="2027-06-11",
   insuredPeople=[{"name": "Lim Wei Jie", "relationshipHint": None, "coverages": [cov("Death", 800000, "SGD", 1, "Sum assured - death S$800,000"), cov("Total and permanent disability", 800000, "SGD", 1, "Sum assured - total and permanent disability (before age 65) S$800,000"),
       cov("Critical illness", 200000, "SGD", 1, "Critical illness accelerator rider (37 critical illnesses, late stage) S$200,000 (accelerates the death benefit)", "Accelerates the death benefit")]}],
   premium={"amount": 1936.5, "currency": "SGD", "frequency": "annual"}, waitingPeriods=["90 days for cancer, heart attack, CABG"], keyExclusions=["Suicide within 1 year"], riders=["Critical illness accelerator rider"]),
 "TravelSafe_Annual_Family_2026.pdf": base(documentType="Certificate of Insurance", documentRole="certificate", insurer="Sentosa Shield Travel (fictitious)", productName="TravelSafe Annual Family", policyNumber="SST-AMT-2026-88412",
   policyType="Travel", startDate="2026-07-01", renewalOrExpiryDate="2027-06-30",
   insuredPeople=[{"name": n, "relationshipHint": h, "coverages": [cov("Travel", a, "SGD", 2, e)]} for n, h, a, e in [("Tan Mei Ling", None, 500000, "Overseas medical expenses S$500,000"), ("Lim Wei Jie", None, 500000, "Overseas medical expenses S$500,000"), ("Lim Xin Yi", "child", 250000, "S$250,000")]]),
 "PA_Guardian_Schedule_2026.pdf": base(documentType="Policy Schedule", documentRole="personal_schedule", insurer="Orchid Assurance (fictitious)", productName="PA Guardian", policyNumber="OA-PAG-209947", policyType="Personal Accident",
   startDate="2026-01-01", renewalOrExpiryDate="2026-12-31",
   insuredPeople=[{"name": "Lim Xin Yi", "relationshipHint": "child", "coverages": [cov("Personal accident", 100000, "SGD", 1, "Sum insured S$100,000"), cov("Fracture", 1000, "SGD", 1, "S$1,000 per accident (S$2,000 for skull or spine)")]}]),
}
def trim(p):
    import copy
    q = copy.deepcopy(p)
    steps = [lambda q: q.update(keyExclusions=[]), lambda q: q.update(productsMentioned=[]), lambda q: q.update(riders=[]),
             lambda q: [c.update(evidenceText=(c["evidenceText"] or "")[:48], notes=None) for ip in q["insuredPeople"] for c in ip["coverages"]],
             lambda q: q.update(waitingPeriods=[])]
    for st in steps:
        if len(base64.b64encode(json.dumps(q, separators=(",", ":")).encode())) <= 1950: break
        st(q)
    return q
for name, payload in X.items():
    payload = trim(payload)
    enc = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode(); print(name, len(enc))
    ctrl = "/tmp/ctrl.pdf"; c = canvas.Canvas(ctrl, pagesize=A4); c.setFont("Helvetica", 6); y = 800
    for line in ["DPTEST-EXTRACTION:"] + [enc[i:i+110] for i in range(0, len(enc), 110)] + [":DPTEST-END"]:
        c.drawString(30, y, line); y -= 8
        if y < 30: c.showPage(); c.setFont("Helvetica", 6); y = 800
    c.save()
    w = PdfWriter()
    for p in PdfReader(ctrl).pages: w.add_page(p)
    for p in PdfReader(os.path.join(OUT, name)).pages: w.add_page(p)
    w.write(os.path.join(OUT, name.replace(".pdf", "_x.pdf")))
print("ok", len(X))

# Round 10 third household (the Chua family): an elderly couple and the adult son who
# manages their insurance, uploading MESSY documents the way real families do -- phone
# photos (rotated, skewed, shadowed, low contrast), a scan with no text layer, a bundle of
# three policies in one PDF, pages out of order, the same schedule as a photo AND a PDF,
# insurer letters, a claim rejection, a hospital bill, an e-statement full of small tables,
# a password-protected PDF, a truncated PDF, an insurer-app screenshot, a Word file of the
# son's own notes, a 120-page policy wording and handwritten notes.
#
# Everything is clearly FICTITIOUS (synthetic only). As in Round 7, each document the
# reading model sees carries a DPTEST-EXTRACTION block with what a competent -- but
# realistically imperfect -- reading model would return for it (the deterministic stand-in
# reads only that block; every fact is still checked against the printed pages).
# Images and scanned pages have no text layer: what a hosted OCR model would transcribe is
# in transcripts.json (faithful but imperfect: S$1,O00, l/1 swaps, broken table columns),
# served by the deterministic OCR stand-in only when it is shown that exact image upright.
#
# Run: python3 scripts/fixtures/r10/make.py   (writes scripts/fixtures/r10/*.b64 and transcripts.json)
import json, base64, os, io, copy, subprocess, tempfile, random, math
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(1010)
ss = getSampleStyleSheet(); H1 = ss["Heading1"]; H2 = ss["Heading2"]; B = ss["BodyText"]
S = ParagraphStyle("s", parent=B, fontSize=8.5, leading=11); FN = ParagraphStyle("fn", parent=B, fontSize=6.5, leading=8, textColor=colors.grey)
def P(t, st=B): return Paragraph(t, st)
def tbl(rows, widths, head=1, size=8):
    cs = ParagraphStyle("c", parent=B, fontSize=size, leading=size + 2)
    t = Table([[P(str(c), cs) for c in r] for r in rows], colWidths=widths, repeatRows=head)
    st = [("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]
    if head: st.append(("BACKGROUND", (0, 0), (-1, head - 1), colors.lightgrey))
    t.setStyle(TableStyle(st)); return t
def kv(rows, size=8.5): return tbl(rows, [62*mm, 112*mm], head=0, size=size)

def marker_lines(payload):
    enc = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    assert len(enc) <= 1950, (payload.get("productName"), len(enc))
    return ["DPTEST-EXTRACTION:"] + [enc[i:i+110] for i in range(0, len(enc), 110)] + [":DPTEST-END"]

def build(story, footer, payload=None, page_label=None):
    """A PDF whose first page carries the extraction block at its very top."""
    buf = io.BytesIO()
    lines = marker_lines(payload) if payload else []
    def first(c, d):
        c.saveState(); c.setFont("Helvetica", 5.5); y = A4[1] - 8*mm
        for l in lines: c.drawString(15*mm, y, l); y -= 6.2
        c.restoreState(); foot(c, d)
    def foot(c, d):
        c.saveState(); c.setFont("Helvetica", 6.5)
        label = page_label(d.page) if page_label else f"Page {d.page}"
        c.drawString(15*mm, 8*mm, f"{footer} (fictitious - synthetic test document)   {label}"); c.restoreState()
    top = 15*mm + (len(lines) * 6.2 + 6 if lines else 0)
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=top, bottomMargin=15*mm)
    doc.build(story, onFirstPage=first, onLaterPages=foot)
    return buf.getvalue()

def cov(cat, amt, page, ev, notes=None):
    return {"category": cat, "productName": None, "policyNumber": None, "amount": amt, "currency": "SGD" if amt is not None else None, "notes": notes, "sourcePage": page, "evidenceText": ev, "evidenceVerified": False}
def base(**k):
    d = {"documentType": None, "documentRole": None, "documentNotes": [], "insurer": None, "productName": None, "productsMentioned": [], "policyNumber": None, "groupPolicyNumber": None,
         "policyType": None, "policyholder": None, "personalCoverageConfirmed": True, "startDate": None, "renewalOrExpiryDate": None, "insuredPeople": [], "referenceCoverages": [],
         "premium": {"amount": None, "currency": None, "frequency": None}, "paymentRecords": [], "keyExclusions": [], "waitingPeriods": [], "deductiblesAndCoinsurance": [], "riders": []}
    d.update(k); return d
def person(name, hint, *covs): return {"name": name, "relationshipHint": hint, "coverages": list(covs)}

FILES = {}          # name -> bytes
TRANSCRIPTS = {}    # name -> [{"page": n, "rotation": deg, "quality": "good"|"poor"|"unreadable", "text": str}]
def save(name, data): FILES[name] = data

def raster(pdf_bytes, page=1, dpi=90):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "in.pdf"); open(src, "wb").write(pdf_bytes)
        subprocess.run(["pdftoppm", "-r", str(dpi), "-f", str(page), "-l", str(page), "-png", src, os.path.join(d, "p")], check=True)
        out = [f for f in os.listdir(d) if f.startswith("p") and f.endswith(".png")][0]
        return Image.open(os.path.join(d, out)).convert("RGB")

def photo(img, rotate=0, skew=0.0, shadow=0.0, contrast=1.0, blur=0.0, noise=0, bg=(118, 102, 86)):
    """A phone photo of a printed page: on a table, a little skewed, a shadow, the camera's contrast."""
    w, h = img.size
    pad = int(w * 0.08)
    canvas_img = Image.new("RGB", (w + 2*pad, h + 2*pad), bg)
    canvas_img.paste(img, (pad, pad))
    if skew: canvas_img = canvas_img.rotate(skew, resample=Image.BICUBIC, expand=False, fillcolor=bg)
    if shadow:
        W, H = canvas_img.size
        mask = Image.new("L", (W, H), 0); md = ImageDraw.Draw(mask)
        for x in range(W):
            v = int(255 * shadow * max(0.0, 1 - x / (W * 0.65)))
            md.line([(x, 0), (x, H)], fill=v)
        dark = Image.new("RGB", (W, H), (20, 20, 25))
        canvas_img = Image.composite(dark, canvas_img, mask)
    if contrast != 1.0: canvas_img = ImageEnhance.Contrast(canvas_img).enhance(contrast)
    if blur: canvas_img = canvas_img.filter(ImageFilter.GaussianBlur(blur))
    if noise:
        px = canvas_img.load(); W, H = canvas_img.size
        for _ in range(W * H // 40):
            x, y = random.randrange(W), random.randrange(H); r, g, b = px[x, y]; n = random.randint(-noise, noise)
            px[x, y] = (max(0, min(255, r+n)), max(0, min(255, g+n)), max(0, min(255, b+n)))
    if rotate: canvas_img = canvas_img.rotate(-rotate, expand=True)   # rotate clockwise by `rotate` degrees
    return canvas_img

def jpeg(img, q=62):
    b = io.BytesIO(); img.save(b, "JPEG", quality=q); return b.getvalue()
def png(img):
    b = io.BytesIO(); img.save(b, "PNG", optimize=True); return b.getvalue()

def scanned_pdf(images):
    """A PDF made by a scanner: each page is one image, no text layer at all."""
    buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=A4)
    for im in images:
        tmp = io.BytesIO(); im.save(tmp, "JPEG", quality=55); tmp.seek(0)
        from reportlab.lib.utils import ImageReader
        iw, ih = im.size; pw, ph = A4
        if iw > ih: c.setPageSize((ph, pw)); pw, ph = ph, pw
        else: c.setPageSize(A4)
        c.drawImage(ImageReader(tmp), 0, 0, width=pw, height=ph); c.showPage()
    c.save(); return buf.getvalue()

def merge(*pdfs, order=None):
    w = PdfWriter(); pages = []
    for p in pdfs: pages.extend(PdfReader(io.BytesIO(p)).pages)
    for i in (order or range(len(pages))): w.add_page(pages[i])
    w.add_metadata({"/Producer": "dearpolicy-r10-fixture"})
    out = io.BytesIO(); w.write(out); return out.getvalue()

MMA = "Merlion Mutual Assurance (fictitious)"; SSI = "Straits Shield Insurance (fictitious)"; TBL = "Tiong Bahru Life (fictitious)"; RQG = "Raffles Quay General Insurance (fictitious)"
BH, AL, KL = "Chua Boon Huat", "Lee Ah Lian", "Chua Kok Leong"

# =========================================================== A1. SilverShield 2026 schedule (native PDF)
ss26_p1 = [[ "Policy number", "MMA-SS-5520417"], ["Policyholder and life assured", BH + " (date of birth 9 August 1947)"],
           ["Plan", "SilverShield Plan B (Class A ward), with SilverShield Assist Rider"], ["Policy year limit", "S$1,000,000"],
           ["Period of insurance", "1 April 2026 to 31 March 2027"],
           ["Annual premium (SilverShield Plan B)", "S$2,184.00, of which S$1,800.00 is deducted from MediSave and S$384.00 is payable in cash"],
           ["Annual premium (SilverShield Assist Rider)", "S$1,036.00, payable in cash only"], ["Next renewal date", "1 April 2027"], ["Date of issue", "12 March 2026"]]
def silvershield_story(rows):
    return [P(MMA, H1), P("SILVERSHIELD INTEGRATED PLAN - POLICY SCHEDULE", H2), kv(rows), Spacer(1, 6),
     P("This schedule forms part of your policy and must be read with the SilverShield Policy Wording. All amounts are in Singapore dollars.", S),
     PageBreak(), P("SCHEDULE OF BENEFITS - SILVERSHIELD PLAN B", H2),
     tbl([["Benefit", "Limit"], ["Daily ward and treatment charges", "As charged, up to Class A ward"], ["Intensive care unit", "As charged"],
          ["Surgical procedures", "As charged"], ["Pre-hospitalisation treatment", "Within 120 days before admission"], ["Post-hospitalisation treatment", "Within 365 days after discharge"],
          ["Policy year limit", "S$1,000,000"], ["Deductible per policy year (age 80 and below)", "S$3,500"], ["Deductible per policy year (age 81 and above)", "S$5,250"],
          ["Co-insurance", "10%"], ["Pro-ration if you stay in a private hospital", "65%"]], [100*mm, 74*mm]),
     Spacer(1, 4), P("The deductible is paid once in each policy year. Co-insurance applies to the claimable amount above the deductible.", FN),
     PageBreak(), P("SILVERSHIELD ASSIST RIDER - BENEFITS", H2),
     tbl([["Rider benefit", "Amount"], ["Deductible and co-insurance", "Rider pays 95%; you pay a 5% co-payment"], ["Maximum co-payment per policy year", "S$3,000"],
          ["Pro-ration", "Not paid by the rider"]], [100*mm, 74*mm]),
     P("The rider premium cannot be paid from MediSave. The rider ends when the SilverShield plan ends.", S)]
ss26_payload = base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=MMA, productName="SilverShield Integrated Plan", productsMentioned=["SilverShield Plan B", "SilverShield Assist Rider"],
    policyNumber="MMA-SS-5520417", policyType="Hospitalisation", policyholder=BH, startDate="2026-04-01", renewalOrExpiryDate="2027-03-31",
    insuredPeople=[person(BH, "parent", cov("Hospitalisation", 1000000, 1, "Policy year limit S$1,000,000"))],
    premium={"amount": 2184.0, "currency": "SGD", "frequency": "annual"}, deductiblesAndCoinsurance=["Deductible S$3,500 per policy year (age 80 and below)", "Co-insurance 10%"], riders=["SilverShield Assist Rider"])
A1 = build(silvershield_story(ss26_p1), "Merlion Mutual Assurance", ss26_payload)
save("SilverShield_Schedule_2026.pdf", A1)

# =========================================================== A2. the same 2026 schedule photographed (rotated 90, skewed, shadow)
A1_plain = build(silvershield_story(ss26_p1), "Merlion Mutual Assurance")
ph = photo(raster(A1_plain, 1, 80), rotate=90, skew=2.5, shadow=0.55, contrast=0.85, noise=18)
save("IMG_20260412_093015.jpg", jpeg(ph))
a2_payload = copy.deepcopy(ss26_payload)
a2_payload.update(policyNumber="MMA-SS-5520417", documentNotes=["Read from a photo of the policy schedule"])  # normalised silently by the reader: the photo prints MMA-SS-552O417
a2_payload["insuredPeople"][0]["coverages"] = [cov("Hospitalisation", 1000000, 1, "Policy year limit S$1,OOO,OOO")]
a2_text = ("Merlion Mutual Assurance (fictitious)\nSILVERSHIELD INTEGRATED PLAN - POLICY SCHEDULE\nPolicy number\tMMA-SS-552O417\n"
    "Policyholder and life assured\tChua Boon Huat (date of birth 9 August 1947)\nPlan\tSilverShield Plan B (Class A ward), with SilverShield Assist Rider\n"
    "Policy year limit\tS$1,OOO,OOO\nPeriod of insurance\t1 April 2026 to 31 March 2027\n"
    "Annual premium (SilverShield Plan B)\tS$2,l84.00, of which S$1,800.00 is deducted from MediSave and S$384.00 is payab1e in cash\n"
    "Annual premium (SilverShield Assist Rider)\tS$1,O36.00, payable in cash only\nNext renewal date\t1 April 2027\nDate of issue\t12 March 2026\n"
    "This schedule forms part of your policy and must be read with the SilverShield Policy Wording. All amounts are in Singapore dollars.")
TRANSCRIPTS["IMG_20260412_093015.jpg"] = [{"page": 1, "rotation": 90, "quality": "good", "text": "\n".join(marker_lines(a2_payload)) + "\n" + a2_text}]

# =========================================================== A3. last year's schedule (2025-26), photo upside down, low contrast
ss25_p1 = copy.deepcopy(ss26_p1)
ss25_p1[4][1] = "1 April 2025 to 31 March 2026"; ss25_p1[5][1] = "S$1,962.00, of which S$1,800.00 is deducted from MediSave and S$162.00 is payable in cash"
ss25_p1[6][1] = "S$968.00, payable in cash only"; ss25_p1[7][1] = "1 April 2026"; ss25_p1[8][1] = "14 March 2025"
A3_plain = build(silvershield_story(ss25_p1), "Merlion Mutual Assurance")
ph = photo(raster(A3_plain, 1, 80), rotate=180, skew=-1.5, shadow=0.3, contrast=0.45, noise=10, bg=(200, 196, 188))
save("SilverShield_2025_photo.png", png(ph.convert("L")))
a3_payload = copy.deepcopy(ss26_payload)
a3_payload.update(startDate="2025-04-01", renewalOrExpiryDate="2026-03-31", premium={"amount": 1962.0, "currency": "SGD", "frequency": "annual"}, documentNotes=["Read from a photo of the policy schedule"])
a3_text = ("Merlion Mutual Assurance (fictitious)\nSILVERSHIELD INTEGRATED PLAN - POLICY SCHEDULE\nPolicy number\tMMA-SS-5520417\n"
    "Policyholder and life assured\tChua Boon Huat (date of birth 9 August 1947)\nPlan\tSilverShield Plan B (Class A ward), with SilverShield Assist Rider\n"
    "Policy year limit\tS$1,000,000\nPeriod of insurance\t1 April 2025 to 31 March 2026\n"
    "Annual premium (SilverShield Plan B)\tS$1,962.0O, of which S$1,800.00 is deducted from MediSave and S$162.00 is payable in cash\n"
    "Annual premium (SilverShield Assist Rider)\tS$968.00, payable in cash only\nNext renewal date\t1 April 2026\nDate of issue\t14 March 2025")
TRANSCRIPTS["SilverShield_2025_photo.png"] = [{"page": 1, "rotation": 180, "quality": "good", "text": "\n".join(marker_lines(a3_payload)) + "\n" + a3_text}]

# =========================================================== B. insurer letter: premium revision, rider withdrawn
letter = [P(MMA, H1), P("10 Collyer Quay, Singapore 049315", FN), Spacer(1, 4), P("15 August 2026", S),
    P("Mr Chua Boon Huat<br/>Blk 412 Ang Mo Kio Avenue 10 #08-1123<br/>Singapore 560412", S), Spacer(1, 4),
    P("Dear Mr Chua Boon Huat,", S),
    P("<b>SilverShield Integrated Plan (policy number MMA-SS-5520417): revision of premiums and withdrawal of the SilverShield Assist Rider</b>", S),
    P("We are writing to let you know about two changes that will apply from your next renewal on 1 April 2027.", S),
    P("1. Your SilverShield Plan B premium will increase. Premiums are revised regularly to reflect rising medical costs and claims experience. At your next renewal you also move into the age band 80 and above. Your annual premium for SilverShield Plan B will be S$2,736.00 from 1 April 2027 (it is S$2,184.00 for the current policy year).", S),
    P("2. The SilverShield Assist Rider will be withdrawn. The SilverShield Assist Rider will end on 31 March 2027 and will not be renewed. Treatment on or after 1 April 2027 will not be covered by the rider: you will pay the deductible and co-insurance of your SilverShield plan yourself, unless you choose a replacement rider.", S),
    P("You may switch to the SilverShield Care Rider without a health declaration if you apply before 28 February 2027. Its premium at your age is S$1,412.00 a year, payable in cash.", S),
    P("Your SilverShield Plan B cover itself does not change. If you have questions, please call us on 6788 1234 or speak to your financial adviser representative.", S),
    P("Yours sincerely,<br/>Customer Care, Merlion Mutual Assurance", S),
    PageBreak(), P("YOUR PREMIUMS FROM 1 APRIL 2027", H2),
    tbl([["Plan", "Current annual premium (1 April 2026 to 31 March 2027)", "Annual premium from 1 April 2027"],
         ["SilverShield Plan B", "S$2,184.00", "S$2,736.00"], ["SilverShield Assist Rider", "S$1,036.00", "Withdrawn - not renewed after 31 March 2027"],
         ["SilverShield Care Rider (optional replacement)", "Not held", "S$1,412.00"]], [60*mm, 60*mm, 54*mm]),
    Spacer(1, 4), P("MediSave can be used for SilverShield Plan B premiums up to the withdrawal limits. Rider premiums must be paid in cash.", FN)]
b_payload = base(documentType="Renewal notice", documentRole="renewal_statement", insurer=MMA, productName="SilverShield Integrated Plan", productsMentioned=["SilverShield Plan B", "SilverShield Assist Rider", "SilverShield Care Rider"],
    policyNumber="MMA-SS-5520417", policyType="Hospitalisation", policyholder=BH, personalCoverageConfirmed=False, insuredPeople=[person(BH, "parent")],
    premium={"amount": 2736.0, "currency": "SGD", "frequency": "annual"},
    paymentRecords=[{"insuredPersonName": None, "insurer": MMA, "productName": "SilverShield Integrated Plan", "policyNumber": "MMA-SS-5520417", "amount": 2736.0, "currency": "SGD", "frequency": "annual",
                     "paymentDate": None, "periodStart": None, "periodEnd": None, "sourcePage": 2, "notes": "renewal premium", "evidenceText": "S$2,736.00"}],
    riders=["SilverShield Assist Rider"])
save("Merlion_Premium_Revision_Aug2026.pdf", build(letter, "Merlion Mutual Assurance", b_payload))

# =========================================================== C. claim rejection letter (pre-existing condition)
rej = [P(MMA, H1), P("Claims Department, 10 Collyer Quay, Singapore 049315", FN), Spacer(1, 4), P("2 July 2026", S),
    P("Mr Chua Boon Huat<br/>Blk 412 Ang Mo Kio Avenue 10 #08-1123<br/>Singapore 560412", S), Spacer(1, 4), P("Dear Mr Chua Boon Huat,", S),
    P("<b>Your claim CLM-2026-118842 under SilverShield Integrated Plan (policy number MMA-SS-5520417)</b>", S),
    kv([["Claim number", "CLM-2026-118842"], ["Patient", BH], ["Hospital", "Novena Heights Hospital (fictitious)"], ["Admission", "3 June 2026 to 9 June 2026"],
        ["Treatment", "Total knee replacement, right knee"], ["Amount claimed", "S$24,816.40"], ["Amount payable", "S$0.00"]]), Spacer(1, 6),
    P("We have carefully reviewed your claim and the medical reports. We regret to inform you that we are unable to admit this claim.", S),
    P("Reason: the treatment was for osteoarthritis of the right knee, a pre-existing condition. The medical report from Dr Lim of Ang Mo Kio Orthopaedic Clinic (fictitious) shows that this condition was diagnosed on 18 November 2024, before your SilverShield cover started on 1 April 2025, and it was not declared in your application. Under the General Exclusions of the SilverShield Policy Wording, pre-existing conditions are not covered unless they were declared to us and accepted in writing.", S),
    P("This decision applies to this claim under the SilverShield plan and the SilverShield Assist Rider. Your SilverShield policy remains in force. Your MediShield Life claim for this admission is assessed separately.", S),
    P("If you disagree with this decision, you may appeal in writing within 30 days of the date of this letter, with any further medical evidence. If you remain dissatisfied after our review, you may refer the matter to the Financial Industry Disputes Resolution Centre (FIDReC).", S),
    P("Yours sincerely,<br/>Claims Assessment, Merlion Mutual Assurance", S)]
c_payload = base(documentType="Claim letter", documentRole="claim_receipt", insurer=MMA, productName="SilverShield Integrated Plan", policyNumber="MMA-SS-5520417", policyType="Hospitalisation",
    policyholder=BH, personalCoverageConfirmed=True, insuredPeople=[person(BH, "parent", cov("Hospitalisation", 24816.40, 1, "Amount claimed S$24,816.40"))],
    keyExclusions=["Pre-existing conditions not declared and accepted"])
save("Merlion_Claim_Decision_CLM-2026-118842.pdf", build(rej, "Merlion Mutual Assurance", c_payload))

# =========================================================== D. hospital final bill
bill = [P("Novena Heights Hospital (fictitious)", H1), P("38 Irrawaddy Road, Singapore 329563   GST Reg No. M9-1234567-X", FN), P("FINAL BILL / TAX INVOICE", H2),
    kv([["Bill number", "NHH-IP-26-0604418"], ["Patient", BH], ["NRIC", "S47xxxx1J"], ["Ward", "Class A, single room"], ["Admission", "3 June 2026"], ["Discharge", "9 June 2026"],
        ["Attending surgeon", "Dr Ng Teck Huat (Orthopaedic Surgery)"], ["Bill date", "12 June 2026"]]), Spacer(1, 6),
    tbl([["Summary of charges", "Amount (S$)"], ["Total charges before GST", "22,767.34"], ["GST 9%", "2,049.06"], ["Total charges", "24,816.40"],
         ["Less: MediShield Life payable (pending)", "0.00"], ["Less: Integrated Shield Plan payable (claim submitted)", "0.00"], ["Amount payable by patient", "24,816.40"]], [120*mm, 54*mm]),
    Spacer(1, 4), P("Payment is due within 30 days of the bill date. MediSave may be used for the approved amount under the MediSave withdrawal limits.", S),
    PageBreak(), P("ITEMISED CHARGES", H2),
    tbl([["Item", "Qty", "Amount (S$)"], ["Ward charges - Class A (6 days)", "6", "4,830.00"], ["Surgeon's fee - total knee replacement", "1", "9,200.00"],
         ["Anaesthetist's fee", "1", "2,150.00"], ["Operating theatre", "1", "1,980.00"], ["Implants and prosthesis", "1", "3,450.00"], ["Laboratory and radiology", "-", "612.34"],
         ["Medicines and consumables", "-", "545.00"], ["Total charges before GST", "", "22,767.34"]], [110*mm, 20*mm, 44*mm])]
d_payload = base(documentType="Hospital bill", documentRole="claim_receipt", insurer="Novena Heights Hospital (fictitious)", productName=None, policyType="Hospitalisation",
    personalCoverageConfirmed=True, insuredPeople=[person(BH, "parent", cov("Hospitalisation", 24816.40, 1, "Amount payable by patient 24,816.40"))])
save("Novena_Heights_Final_Bill_June2026.pdf", build(bill, "Novena Heights Hospital", d_payload))

# =========================================================== E. scanned CI policy: no text layer, page 2 fed sideways
gy1 = [P(SSI, H1), P("GOLDEN YEARS CRITICAL ILLNESS - POLICY SCHEDULE", H2),
       kv([["Policy number", "SSI-GY-7710293"], ["Life assured", AL + " (date of birth 2 December 1950)"], ["Policy start date", "1 July 2018"],
           ["Policy term", "To age 85 (1 December 2035)"], ["Sum assured", "S$50,000"], ["Annual premium", "S$1,248.00"], ["Premium term", "10 years (premiums fully paid from 1 July 2028)"]])]
gy2 = [P("SCHEDULE OF BENEFITS", H2),
       tbl([["Benefit", "Amount payable"], ["Critical illness (37 conditions, severe stage)", "100% of sum assured, S$50,000"], ["Early stage cancer", "25% of sum assured, up to S$12,500"],
            ["Angioplasty (once only)", "10% of sum assured, up to S$5,000"]], [100*mm, 74*mm]),
       Spacer(1, 6), P("Waiting period: 90 days from the policy start date for cancer, heart attack and coronary artery bypass surgery.", S)]
gyp1 = raster(build(gy1, "Straits Shield Insurance"), 1, 80); gyp2 = raster(build(gy2, "Straits Shield Insurance"), 1, 80)
gyp1 = photo(gyp1, skew=0.8, contrast=0.9, noise=12, bg=(245, 245, 240)); gyp2 = photo(gyp2, rotate=90, skew=-0.6, contrast=0.9, noise=12, bg=(245, 245, 240))
save("GoldenYears_CI_scan.pdf", scanned_pdf([gyp1, gyp2]))
e_payload = base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=SSI, productName="Golden Years Critical Illness", policyNumber="SSI-GY-7710293",
    policyType="Critical Illness", policyholder=AL, startDate="2018-07-01", renewalOrExpiryDate="2035-12-01",
    insuredPeople=[person(AL, "parent", cov("Critical Illness", 50000, 1, "Sum assured S$5O,000"))],
    premium={"amount": 1248.0, "currency": "SGD", "frequency": "annual"}, waitingPeriods=["90 days for cancer, heart attack and coronary artery bypass surgery"])
TRANSCRIPTS["GoldenYears_CI_scan.pdf"] = [
  {"page": 1, "rotation": 0, "quality": "good", "text": "\n".join(marker_lines(e_payload)) + "\nStraits Shield Insurance (fictitious)\nGOLDEN YEARS CRITICAL ILLNESS - POLICY SCHEDULE\n"
     "Po1icy number SSI-GY-77l0293\nLife assured\tLee Ah Lian (date of birth 2 December 1950)\nPolicy start date\t1 July 2O18\nPolicy term\tTo age 85 (1 December 2O35)\n"
     "Sum assured\tS$5O,000\nAnnual premium\tS$1,248.00\nPremium term\t10 years (premiums fully paid from 1 July 2028)"},
  {"page": 2, "rotation": 90, "quality": "good", "text": "SCHEDULE OF BENEFITS\nBenefit Amount payable\nCritical illness (37 conditions, severe stage)\t100% of sum assured, S$50,000\n"
     "Ear1y stage cancer\n25% of sum assured, up to\nS$12,5OO\nAngioplasty (once only)  10% of sum assured, up to S$5,0OO\n"
     "Waiting period: 90 days from the policy start date for cancer, heart attack and coronary artery bypass surgery."}]

# =========================================================== F. one PDF, three policies (uploaded to the son's own profile)
pa = [P(SSI, H1), P("SENIORGUARD PERSONAL ACCIDENT - POLICY SCHEDULE", H2),
      kv([["Policy number", "SSI-PA-4410876"], ["Insured person", AL], ["Period of insurance", "1 January 2026 to 31 December 2026"], ["Annual premium", "S$312.00"]]),
      Spacer(1, 6), tbl([["Benefit", "Limit"], ["Accidental death", "S$50,000"], ["Accidental medical expenses (per accident)", "S$3,000"], ["Fracture (per accident)", "S$1,500"],
                         ["Hospital cash for accidents", "S$80 per day, up to 60 days"]], [100*mm, 74*mm]),
      PageBreak(), P("SENIORGUARD - IMPORTANT CONDITIONS", H2), P("A fall at home is an accident under this policy. Accidental medical expenses include traditional Chinese medicine up to S$300 per accident.", S)]
wl = [P(TBL, H1), P("HERITAGE WHOLE LIFE - POLICY SCHEDULE", H2),
      kv([["Policy number", "TBL-HW-1988-0042"], ["Life assured", BH], ["Policy start date", "12 March 1988"], ["Sum assured", "S$80,000"],
          ["Premium", "Fully paid up since 12 March 2013 - no further premiums are payable"]]),
      PageBreak(), P("HERITAGE WHOLE LIFE - BENEFITS", H2), P("On death, we pay the sum assured of S$80,000 plus any reversionary and terminal bonuses declared. Bonuses are not guaranteed until declared.", S)]
tr = [P(RQG, H1), P("WANDERER ANNUAL TRAVEL - CERTIFICATE OF INSURANCE", H2),
      kv([["Certificate number", "RQG-WAT-2026-31907"], ["Insured person", KL], ["Period of insurance", "15 May 2026 to 14 May 2027"], ["Plan", "Worldwide, individual"], ["Premium", "S$268.00"]]),
      Spacer(1, 6), tbl([["Benefit", "Limit"], ["Overseas medical expenses", "S$500,000"], ["Trip cancellation", "S$10,000"], ["Baggage", "S$5,000 (S$500 for any one item)"]], [100*mm, 74*mm]),
      PageBreak(), P("WANDERER - CONDITIONS", H2), P("Each trip may last up to 90 days. Pre-existing medical conditions are not covered.", S)]
pa_payload = base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=SSI, productName="SeniorGuard Personal Accident", policyNumber="SSI-PA-4410876", policyType="Personal Accident",
    policyholder=AL, startDate="2026-01-01", renewalOrExpiryDate="2026-12-31", insuredPeople=[person(AL, "parent", cov("Personal Accident", 50000, 1, "Accidental death S$50,000"))],
    premium={"amount": 312.0, "currency": "SGD", "frequency": "annual"})
# What a reading model returns for the WHOLE bundle: one "policy", with people from all three folded into it.
merged = copy.deepcopy(pa_payload)
merged["insuredPeople"] += [person(BH, "parent", cov("Death", 80000, 3, "Sum assured S$80,000")), person(KL, "self", cov("Travel", 500000, 5, "Overseas medical expenses S$500,000"))]
merged["productsMentioned"] = []
wl_payload = base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=TBL, productName="Heritage Whole Life", policyNumber="TBL-HW-1988-0042", policyType="Whole Life",
    policyholder=BH, startDate="1988-03-12", insuredPeople=[person(BH, "parent", cov("Death", 80000, 1, "Sum assured S$80,000"))])
tr_payload = base(documentType="Certificate of Insurance", documentRole="certificate", insurer=RQG, productName="Wanderer Annual Travel", policyNumber="RQG-WAT-2026-31907", policyType="Travel",
    policyholder=KL, startDate="2026-05-15", renewalOrExpiryDate="2027-05-14", insuredPeople=[person(KL, "self", cov("Travel", 500000, 1, "Overseas medical expenses S$500,000"))],
    premium={"amount": 268.0, "currency": "SGD", "frequency": "annual"})
lbl = lambda n: (lambda p: f"Page {p} of {n}")
save("Chua_family_policies_bundle.pdf", merge(build(pa, "Straits Shield Insurance", merged, lbl(2)), build(wl, "Tiong Bahru Life", wl_payload, lbl(2)), build(tr, "Raffles Quay General Insurance", tr_payload, lbl(2))))

# =========================================================== G. hospital income schedule with its pages out of order (3, 1, 2)
def cc_story(): return [P(MMA, H1), P("CARECASH HOSPITAL INCOME - POLICY SCHEDULE", H2),
      kv([["Policy number", "MMA-CC-3307781"], ["Insured person", AL], ["Period of insurance", "1 January 2026 to 31 December 2026"], ["Annual premium", "S$486.00"]]),
      Spacer(1, 8), P("SCHEDULE OF BENEFITS", H2),
      tbl([["Benefit", "Amount per day", "Maximum days per admission"], ["Daily hospital cash (normal ward)", "S$200", "365"]], [90*mm, 40*mm, 44*mm]),
      P("The schedule of benefits continues on the next page.", FN),
      PageBreak(), P("SCHEDULE OF BENEFITS (CONTINUED)", H2),
      tbl([["Benefit", "Amount", "Maximum"], ["Intensive care unit cash", "S$400 per day", "30 days per admission"], ["Surgical cash", "S$1,000 per surgery", "-"],
           ["Recuperation cash after 5 or more days in hospital", "S$100 per day", "30 days"]], [90*mm, 40*mm, 44*mm]),
      PageBreak(), P("IMPORTANT CONDITIONS", H2),
      P("A waiting period of 30 days applies to hospitalisation caused by illness. Pre-existing conditions are not covered during the first 12 months of the policy.", S),
      P("Hospital cash is paid for each complete day in hospital. Days in the intensive care unit are paid at the intensive care rate instead of the daily rate, not in addition to it.", S)]
cc_payload = base(documentType="Policy Schedule", documentRole="personal_schedule", insurer=MMA, productName="CareCash Hospital Income", policyNumber="MMA-CC-3307781", policyType="Hospital Cash",
    policyholder=AL, startDate="2026-01-01", renewalOrExpiryDate="2026-12-31", insuredPeople=[person(AL, "parent", cov("Hospital Cash", 200, 2, "Daily hospital cash (normal ward) S$200"))],
    premium={"amount": 486.0, "currency": "SGD", "frequency": "annual"}, waitingPeriods=["30 days for illness"])
save("CareCash_Hospital_Income_Schedule.pdf", merge(build(cc_story(), "Merlion Mutual Assurance", cc_payload, lbl(3)), order=[2, 0, 1]))

# =========================================================== H. e-statement with many small tables
est = [P(TBL, H1), P("ANNUAL POLICY STATEMENT - HERITAGE WHOLE LIFE", H2),
       kv([["Policy number", "TBL-HW-1988-0042"], ["Life assured", BH], ["Statement date", "31 March 2026"], ["Sum assured", "S$80,000"], ["Policy status", "In force - fully paid up"]]),
       Spacer(1, 6), P("POLICY VALUES AS AT 31 MARCH 2026", H2),
       tbl([["Value", "S$"], ["Guaranteed cash value", "41,220.00"], ["Reversionary bonus (accumulated)", "38,460.00"], ["Terminal bonus (not guaranteed)", "12,900.00"], ["Total surrender value", "92,580.00"]], [110*mm, 64*mm]),
       Spacer(1, 4),
       tbl([["Death benefit", "S$"], ["Sum assured", "80,000.00"], ["Plus reversionary bonus", "38,460.00"], ["Plus terminal bonus (not guaranteed)", "12,900.00"], ["Total death benefit", "131,360.00"]], [110*mm, 64*mm]),
       Spacer(1, 4),
       tbl([["Policy loan", ""], ["Loan outstanding", "S$0.00"], ["Loan interest rate", "6.0% a year"], ["Maximum loan available", "S$37,098.00"]], [110*mm, 64*mm]),
       PageBreak(), P("BONUS HISTORY", H2),
       tbl([["Year", "Reversionary bonus rate", "Bonus added (S$)"], ["2022", "1.6%", "1,152.00"], ["2023", "1.6%", "1,170.00"], ["2024", "1.5%", "1,115.00"], ["2025", "1.5%", "1,131.00"], ["2026", "1.4%", "1,071.00"]], [50*mm, 60*mm, 64*mm]),
       Spacer(1, 4),
       tbl([["Premium history", ""], ["Annual premium (1988 to 2013)", "S$1,742.40"], ["Premiums paid in total", "S$43,560.00"], ["Fully paid up since", "12 March 2013"]], [110*mm, 64*mm]),
       Spacer(1, 4),
       tbl([["Nomination", "Share"], ["Lee Ah Lian (spouse)", "100%"]], [110*mm, 64*mm]),
       Spacer(1, 4), P("The terminal bonus is not guaranteed and may change. The surrender value is what you would receive if you ended the policy today.", FN)]
h_payload = base(documentType="Annual Statement", documentRole="annual_statement", insurer=TBL, productName="Heritage Whole Life", policyNumber="TBL-HW-1988-0042", policyType="Whole Life",
    policyholder=BH, personalCoverageConfirmed=True, insuredPeople=[person(BH, "parent", cov("Death", 80000, 1, "Sum assured S$80,000"))])
save("TiongBahru_eStatement_2026.pdf", build(est, "Tiong Bahru Life", h_payload))

# =========================================================== I. password-protected PDF (the son's term plan)
tg = [P(MMA, H1), P("TERMGUARD 65 - POLICY SCHEDULE", H2), kv([["Policy number", "MMA-TG-8820315"], ["Life assured", KL], ["Sum assured", "S$500,000"], ["Monthly premium", "S$118.40"]])]
w = PdfWriter()
for pg in PdfReader(io.BytesIO(build(tg, "Merlion Mutual Assurance"))).pages: w.add_page(pg)
w.encrypt(user_password="S7712345J", owner_password="owner-r10", algorithm="AES-128")
o = io.BytesIO(); w.write(o); save("TermGuard65_Schedule_locked.pdf", o.getvalue())

# =========================================================== J. truncated / corrupted PDF
full = build([P(MMA, H1), P("CARECASH HOSPITAL INCOME - RENEWAL CERTIFICATE 2026", H2), kv([["Policy number", "MMA-CC-3307781"], ["Insured person", AL]])], "Merlion Mutual Assurance")
save("CareCash_Renewal_2026_damaged.pdf", full[: int(len(full) * 0.42)])

# =========================================================== K. screenshot of the insurer's app
W, H = 540, 1170
sc = Image.new("RGB", (W, H), (246, 247, 250)); d = ImageDraw.Draw(sc)
F = lambda s, b=False: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans" + ("-Bold" if b else "") + ".ttf", s)
d.text((24, 14), "9:41", fill=(0, 0, 0), font=F(20, True)); d.text((W - 90, 14), "87%", fill=(0, 0, 0), font=F(18))
d.rectangle([0, 56, W, 130], fill=(178, 34, 52)); d.text((24, 76), "Merlion Mutual", fill=(255, 255, 255), font=F(28, True))
d.text((24, 150), "My Policies", fill=(20, 20, 20), font=F(26, True))
d.rounded_rectangle([20, 200, W - 20, 600], radius=18, fill=(255, 255, 255), outline=(220, 220, 225))
y = 220
for t, f in [("TermGuard 65", F(26, True)), ("In force", F(18)), ("Policy no. MMA-TG-8820315", F(18)), ("Life assured  Chua Kok Leong", F(18)), ("Sum assured  S$500,000", F(22, True)),
             ("Next premium  S$118.40 due 5 Nov 2026", F(18)), ("View policy documents  >", F(18))]:
    d.text((40, y), t, fill=(30, 30, 30), font=f); y += 52
d.rectangle([0, H - 90, W, H], fill=(255, 255, 255)); d.text((40, H - 60), "Home      Policies      Claims      Profile", fill=(90, 90, 90), font=F(18))
save("Screenshot_20260918_MerlionApp.png", png(sc))
k_payload = base(documentType="Policy summary", documentRole="personal_schedule", insurer=MMA, productName="TermGuard 65", policyNumber="MMA-TG-8820315", policyType="Term Life",
    policyholder=KL, insuredPeople=[person(KL, "self", cov("Death", 500000, 1, "Sum assured S$500,000"))], premium={"amount": 118.4, "currency": "SGD", "frequency": "monthly"})
TRANSCRIPTS["Screenshot_20260918_MerlionApp.png"] = [{"page": 1, "rotation": 0, "quality": "good", "text": "\n".join(marker_lines(k_payload)) + "\n9:41\t87%\nMerlion Mutual\nMy Policies\nTermGuard 65\nIn force\n"
    "Policy no. MMA-TG-8820315\nLife assured  Chua Kok Leong\nSum assured  S$500,000\nNext premium  S$118.40 due 5 Nov 2026\nView policy documents  >\nHome  Policies  Claims  Profile"}]

# =========================================================== L. Word document: the son's own notes
from docx import Document
doc = Document()
l_payload = base(documentType="Policy summary", documentRole="personal_schedule", insurer=None, productName="Family insurance summary", policyType="Hospitalisation",
    personalCoverageConfirmed=True, insuredPeople=[person(AL, "parent", cov("Hospital Cash", 200, 1, "CareCash - S$200 a day in hospital")), person(BH, "parent", cov("Hospitalisation", 3000, 1, "deductible S$3,000"))],
    deductiblesAndCoinsurance=["Deductible S$3,000"])
for l in marker_lines(l_payload): doc.add_paragraph(l)
doc.add_heading("Chua family insurance - my notes (Kok Leong)", 1)
doc.add_paragraph("Typed up for myself so I know what Mum and Dad have. Not from the insurers - check the real documents.")
t = doc.add_table(rows=1, cols=3); t.style = "Table Grid"
for i, h in enumerate(["Who", "Policy", "What I wrote down"]): t.rows[0].cells[i].text = h
for row in [["Dad", "SilverShield (Merlion)", "deductible S$3,000 I think? agent Mr Tan 9123 4567"], ["Dad", "Heritage Whole Life", "paid up, S$80k"],
            ["Mum", "CareCash", "CareCash - S$200 a day in hospital"], ["Mum", "Golden Years CI", "scan is blurry - find paper copy"], ["Me", "TermGuard 65", "PDF password = my NRIC"]]:
    cells = t.add_row().cells
    for i, v in enumerate(row): cells[i].text = v
doc.add_paragraph("To do: appeal Dad's knee claim? Ask Mr Tan if the rider going away matters.")
bio = io.BytesIO(); doc.save(bio); save("Chua_insurance_notes.docx", bio.getvalue())

# =========================================================== M. 120-page policy wording
story = [P(MMA, H1), P("SILVERSHIELD INTEGRATED PLAN - POLICY WORDING", H2), P("Terms and Conditions. This policy wording applies to every SilverShield plan and rider.", S), PageBreak()]
sections = ["Definitions", "Eligibility", "Benefits", "Deductible and co-insurance", "Pro-ration", "Pre-authorisation", "General exclusions", "Claims", "Premiums", "Renewal", "Termination", "General provisions"]
for n in range(2, 121):
    sec = sections[(n - 2) * len(sections) // 119]
    story.append(P(f"Section {(n - 2) * len(sections) // 119 + 1} - {sec} (continued)" if n % 10 else f"Section {(n - 2) * len(sections) // 119 + 1} - {sec}", H2))
    if n == 37:
        story.append(P("Pre-existing condition means any illness, injury or symptom that existed before the cover start date, for which you had signs or symptoms, sought or received medical advice, diagnosis or treatment, whether or not you were aware of it.", S))
    if n == 41:
        story.append(P("We will not pay for treatment of any pre-existing condition unless you declared it in your application and we accepted it in writing. This exclusion applies to the plan and to every rider.", S))
    for k in range(6):
        story.append(P(f"{n}.{k + 1} The provisions of this section apply to every insured person under the plan. Where a term is defined in Section 1, it has the meaning given there. Paragraph reference W-{n:03d}-{k + 1}.", S))
    story.append(PageBreak())
save("SilverShield_Policy_Wording.pdf", build(story[:-1], "Merlion Mutual Assurance"))

# =========================================================== N. handwritten notes (photo)
hw = Image.new("RGB", (900, 1150), (250, 248, 232)); d = ImageDraw.Draw(hw)
for yy in range(120, 1150, 48): d.line([(40, yy), (880, yy)], fill=(190, 205, 230), width=2)
HF = ImageFont.truetype("/usr/share/fonts/opentype/urw-base35/Z003-MediumItalic.otf", 40)
for i, line in enumerate(["Dad - knee op claim REJECTED (pre-exist?)", "Appeal by end July??", "Call Mr Tan (agent) 9123 ....", "Mum CareCash $200/day - check", "SilverShield prem going up to 2,7.. next yr"]):
    d.text((60, 76 + i * 96), line, fill=(30, 40, 120), font=HF)
hw = photo(hw, skew=-4, shadow=0.35, contrast=0.8, noise=14)
save("Handwritten_notes.jpg", jpeg(hw, 55))
n_payload = base(documentType="Notes", documentRole="other", personalCoverageConfirmed=False, productName="SilverShield", insuredPeople=[], documentNotes=["Handwritten notes"])
TRANSCRIPTS["Handwritten_notes.jpg"] = [{"page": 1, "rotation": 0, "quality": "poor", "text": "\n".join(marker_lines(n_payload)) + "\nDad - knee op claim REJECTED (pre-exist?)\nAppea1 by end [illegible]\nCall Mr Tan (agent) 9l23 [illegible]\nMum CareCash $2OO/day - check\nSilverShie1d prem going up to 2,7[illegible] next yr"}]

# =========================================================== P. a photo too blurry and dark to read
bl = photo(raster(build(cc_story(), "Merlion Mutual Assurance"), 1, 60), skew=7, shadow=0.85, contrast=0.35, blur=4.5, noise=30)
save("CareCash_photo_blurry.jpg", jpeg(bl, 40))
TRANSCRIPTS["CareCash_photo_blurry.jpg"] = [{"page": 1, "rotation": 0, "quality": "unreadable", "text": ""}]

# =========================================================== Q. HEIC from an iPhone (rejected at upload)
save("IMG_4471.heic", b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + bytes(400))

for name, data in FILES.items():
    b64 = base64.b64encode(data).decode()
    with open(os.path.join(HERE, name + ".b64"), "w") as f: f.write("\n".join(b64[i:i+76] for i in range(0, len(b64), 76)) + "\n")
    print(f"{name:48s} {len(data):>9,d} bytes")
with open(os.path.join(HERE, "transcripts.json"), "w") as f: json.dump(TRANSCRIPTS, f, indent=1, ensure_ascii=False)

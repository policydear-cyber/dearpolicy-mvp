/**
 * Structured-answers release (after PR #54's actual-library test, 17 Oct 2026): an anonymised household whose documents
 * are FAITHFUL REPRODUCTIONS of the actual library's stored page text -- wording, line breaks, tab cells, bullets,
 * footnote markers and table headers kept exactly as DearPolicy stores them. Sources:
 *  - PRODUCT_SUMMARY p13 / p5   scripts/fixtures/extraction/group-product-summary.json pages 13 and 5 (stored text)
 *  - PA_SUMMARY p8 / p6         scripts/fixtures/extraction/group-pa-benefit-summary.json pages 8 and 6 (stored text)
 *  - BOOKLET p9                 the recorded actual-library Compassionate Death Allowance passage (booklet.ts
 *                               BK_P9_RECORDED, from the rc-live-6 trace)
 *  - CERT                       the certificate layout of booklet.ts (from the actual-library report)
 * Private identifiers are changed CONSISTENTLY: the insurer (and its address / registration footer and web address)
 * -> "Aldermoor Life Ltd" / aldermoor.example; the scheme web path -> /SCHEMEX; people, NRIC masks, policy numbers and
 * the certificate amounts are invented. Nothing else on these pages is changed. In particular the real passages print
 * NO definition of "Simple Fracture" or "Other Fracture" (the synthetic booklet's "Simple means closed" / "Other means
 * not Simple" are NOT imported here).
 *
 * Reconciled against the actual-library verification report (DearPolicy PR54, 17 Oct 2026; docs/rag-migration/reliable-chat/
 * FIXTURE-RECONCILIATION.md lists each item):
 * VERIFIED by that report: the certificate's Group Personal Accident sum insured S$600,000 (and Term Life S$1,000,000) for the
 * two members read, "as of" a certificate date; the combined section heading "Simple Fracture or Other Fracture due to
 * Accident" with explicit "(Other Fracture)" row labels; the Simple Fracture S$5,000 table rows and percentages; the footnote
 * markers ("Leg^", "# Arm"); the Compassionate Death Allowance "up to S$2,000" in the summary and the booklet's bare "$2,000"; the
 * Core-or-Voluntary condition; and that the real pages print NO definition of "Simple" or "Other" Fracture.
 * STILL INFERRED here: the page numbers of the PA summary (the report names page 13 for the product summary), the certificate DATES
 * (the report's are 06/10/2022 for its members; this fixture uses its own), and both summaries' document metadata.
 * Deliberately INVENTED controls (never faithful reproductions): another household's copy, a superseded earlier product
 * summary with another limit, and Grace's certificate row (her own date and amount).
 */
import type { FxDoc, FxMember } from "../rag2/household";

export const ACCOUNT = "00000000-0000-0000-0000-00000000c001";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000c002";
const id = (n: number) => "7c000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const M = {
  daniel: { id: id(1), name: "Daniel Lee Wei Ming", pref: "Daniel", rel: "self", notes: null, dob: "1981-04-02" },
  grace: { id: id(2), name: "Grace Tan Hui Min", pref: "Grace", rel: "spouse", notes: "wife", dob: "1983-09-15" },
  other: { id: id(9), name: "Daniel Lee", pref: "Daniel", rel: "self", notes: null, dob: "1970-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const anon = (t: string) => t
  .replace(/Singapore Life Ltd\. 4 Shenton Way, #01-01, SGX Centre 2 Singapore 068807 singlife\.com/g, "Aldermoor Life Ltd. 1 Example Road, #01-01 Singapore 000000 aldermoor.example")
  .replace(/Company Reg\.No\. 196900499K GST Reg\.No\. MR-8500166-8/g, "Company Reg.No. 000000000X GST Reg.No. MR-0000000-0")
  .replace(/singlife\.com\/MINDEFandMHA/g, "aldermoor.example/SCHEMEX")
  .replace(/Singlife/g, "Aldermoor");

/** group-product-summary.json page 13, as stored (anonymised). "Page 12 of 36" is the document's own printed page. */
export const PS_P13 = anon([
  "Insurance Benefits (continued)",
  "(For details on the plan benefits, please refer to singlife.com/MINDEFandMHA)",
  "•\tSimple Fracture due to Accident",
  "If an Insured Person sustains bodily injury as a result of an Accident, which",
  "results in a Simple Fracture of the nature mentioned in the table below, we",
  "will pay the relevant amount specified in the table below:",
  "Simple Fracture Benefit Limit: S$5,000",
  "Schedule\tCompensation",
  "(% of S$5,000)",
  "Neck, Skull or Spine (Full Break)\t100%",
  "Hip\t75%",
  "Jaw, Pelvis, Leg^, Ankle or Knee\t50%",
  "Cheekbone, Shoulder or Hairline Fracture of Skull or Spine\t30%",
  "#",
  "Arm , Elbow, Wrist or Ribs\t25%",
  "^\tFor the avoidance of doubt, any fractures of toe and foot are not covered",
  "#",
  "For the avoidance of doubt, any fractures of thumb, finger and palm are not",
  "covered",
  "•\tDisappearance\t100% of Sum Insured",
  "•\tAmbulance Cost*\tUp to S$500 per incident",
  "•\tMobility aid upon Accidental Total &\tUp to S$10,000",
  "Permanent Disablement*",
  "•\tHome Rehabilitation Renovation Expenses*\tUp to S$10,000",
  "•\tAccidental Hospital Recuperation Benefit*\tS$250",
  "•\tChild Education Fund Benefit*\tS$5,000 per child (up to 2 children)",
  "•\tCompassionate Death Allowance Benefit*\tUp to S$2,000",
  "•\tComatose State Lump Sum Benefit\t15% of Sum Insured or",
  "up to S$50,000, whichever is lesser",
  "•\tDeath due to natural catastrophe\t15% of Sum Insured",
  "or up to S$50,000, whichever is lesser",
  "*This Benefit can only be claimed either under the Core Scheme or Voluntary",
  "Scheme.",
  "Page 12 of 36",
].join("\n"));

/** group-pa-benefit-summary.json page 8, as stored (anonymised footer). */
export const PA_P8 = anon([
  "E. Simple Fracture or Other Fracture due to Accident",
  "If an Insured Person sustains bodily injury as a result of an Accident, which results in a Simple Fracture or Other Fracture of the nature",
  "mentioned in the table below, we will pay the relevant amount specified in the table:-",
  "Simple Fracture or Other Fracture due to Accident",
  "Compensation",
  "Schedule",
  "(% of Sum Insured)",
  "Neck, Skull or Spine (Full Break)\t100%",
  "Hip\t75%",
  "Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)\t50%",
  "Cheekbone, Shoulder or Hairline Fracture of Skull or Spine\t30%",
  "Arm, Elbow, Wrist or Ribs (Other Fracture)\t20%",
  "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.",
  "F.\tDisappearance",
  "If an Insured Person:",
  "(i)\tdisappears as a result of the sinking or wrecking of the ship, aeroplane or vehicle in which he was travelling at the time of the Accident; and",
  "(ii)\this body is not found within l year from the date of his disappearance; and",
  "(iii) there is sufficient evidence leading to the conclusion that the Insured Person sustained bodily injury as a result of an Accident, which",
  "caused his death, then we will pay the Sum Insured. However, the person(s) to whom the Benefit is paid shall sign an undertaking",
  "to refund",
  "such sum(s) so paid, to the Company, if the Insured Person is subsequently found to be alive.",
  "G. Ambulance Cost",
  "If an Insured Person sustains bodily injury as a result of an Accident, which necessitates the use of an ambulance, we will reimburse the actual",
  "ground ambulance costs on a per event per Insured Person basis, incurred by the Insured Person up to maximum of $500 for transportation",
  "(including the medical supplies used) to the Hospital.",
  "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.",
  "H. Mobility aid upon accidental total & permanent disablement",
  "If an Insured Person who sustains bodily injury as a result of an Accident and suffers total and permanent disability and needs to and can",
  "operate:",
  "(i)\ta self-powered, climbing wheelchair; and/or",
  "(ii)\this motor vehicle with the controls suitably adjusted; and/or",
  "(iii) a lift, necessary ramps, railings and holds installed to his/her usual place of residence;",
  "We will, upon receipt of relevant documents as required under clause 14 (including proof of need and total and permanent disability certified",
  "by a Registered Medical Practitioner), pay up to $10,000 of the costs of such equipment and the installation thereof, whichever is lesser.",
  "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.",
  "Singapore Life Ltd. 4 Shenton Way, #01-01, SGX Centre 2 Singapore 068807 singlife.com",
  "Company Reg.No. 196900499K GST Reg.No. MR-8500166-8",
].join("\n"));

/** The recorded actual-library booklet passage (booklet.ts BK_P9_RECORDED). */
export const BK_P9 = [
  "Section 5 - Compassionate Death Allowance Benefit",
  "If an Insured Person dies as a result of an Accident, we will pay the funeral expenses incurred, up to $2,000,",
  "on receipt of proof of death and the relevant documents in our prescribed form.",
  "This Benefit can only be claimed either under the Core Scheme or the Voluntary Scheme.",
  "Section 6 - Repatriation",
  "We will pay up to $5,000 for the cost of bringing the Insured Person's body home if death occurs overseas.",
].join("\n");

const T = "\t";
const row = (masked: string, name: string, amount: string, date: string) => [masked, name, amount, "As of", date].join(T);
export const CERT_P1 = [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Aldermoor Life Ltd.\" for cover(s) as indicated:",
  "SCHEME X GROUP INSURANCE SCHEME (GROUP POLICY NO. GIS-8000)   Page 1 of 1",
  ["Product, Policy Number, Particulars of Insured Person(s) and Sum Assured", "Effective Date"].join(T),
  "GROUP TERM LIFE(POLICY NO.GTL-8001)",
  row("S****411A", "Lee Wei Ming, Daniel", "S$500,000", "01/04/2024"),
  row("S****822B", "Tan Hui Min, Grace", "S$200,000", "01/07/2024"),
  "GROUP PERSONAL ACCIDENT(POLICY NO. GPA-8002)",
  row("S****411A", "Lee Wei Ming, Daniel", "S$600,000", "01/04/2024"),
  row("S****822B", "Tan Hui Min, Grace", "S$100,000", "01/07/2024"),
].join("\n");

const both = [{ id: M.daniel.id }, { id: M.grace.id }];
const scheme = { insurer: "Aldermoor Life Ltd", policyType: "Group insurance", groupPolicyNumber: "GIS-8000" };
export const DOCS: FxDoc[] = [
  { key: "CERT", id: id(101), owner: M.daniel.id, members: both, ...scheme, product: "Scheme X Group Insurance - Certificate", policyNumber: "GIS-8000", role: "schedule", personal: true, hash: "sha256:al-cert", effective: "2024-04-01", documentDate: "2024-04-01", filename: "certificate.pdf", pages: { 1: CERT_P1 } },
  { key: "PRODUCT_SUMMARY", id: id(102), owner: M.daniel.id, members: both, ...scheme, product: "Group Insurance Product Summary", policyNumber: "GIS-8000", role: "benefit_summary", personal: false, hash: "sha256:al-product-summary", filename: "product_summary.pdf", pages: { 13: PS_P13 } },
  { key: "PA_SUMMARY", id: id(103), owner: M.daniel.id, members: both, ...scheme, product: "Group Personal Accident Benefit Summary", policyNumber: "GIS-8000", role: "benefit_summary", personal: false, hash: "sha256:al-pa-summary", filename: "pa_benefit_summary.pdf", pages: { 8: PA_P8 } },
  { key: "BOOKLET", id: id(104), owner: M.daniel.id, members: both, ...scheme, product: "Group Insurance Benefits Booklet", policyNumber: "GIS-8000", role: "policy_wording", personal: false, hash: "sha256:al-booklet", filename: "booklet.pdf", pages: { 9: BK_P9 } },
  // INVENTED controls
  { key: "OLD_PRODUCT_SUMMARY", id: id(105), owner: M.daniel.id, members: both, ...scheme, product: "Group Insurance Product Summary (2022)", policyNumber: "GIS-8000", role: "benefit_summary", personal: false, hash: "sha256:al-old-ps", superseded: true, filename: "product_summary_2022.pdf", pages: { 13: PS_P13.replace(/S\$5,000/g, "S$4,000") } },
  { key: "OTHER_PS", id: id(201), account: OTHER_ACCOUNT, owner: M.other.id, members: [{ id: M.other.id }], ...scheme, product: "Group Insurance Product Summary (other household)", policyNumber: "GIS-8000", role: "benefit_summary", personal: false, hash: "sha256:al-other-ps", filename: "other_product_summary.pdf", pages: { 13: PS_P13.replace(/S\$5,000/g, "S$7,000") } },
  { key: "OTHER_CERT", id: id(202), account: OTHER_ACCOUNT, owner: M.other.id, members: [{ id: M.other.id }], ...scheme, product: "Scheme X Group Insurance - Certificate (other household)", policyNumber: "GIS-8000", role: "schedule", personal: true, hash: "sha256:al-other-cert", filename: "other_certificate.pdf", pages: { 1: CERT_P1.replace(/Lee Wei Ming, Daniel/g, "Lee, Daniel").replace(/S\$600,000/g, "S$900,000") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

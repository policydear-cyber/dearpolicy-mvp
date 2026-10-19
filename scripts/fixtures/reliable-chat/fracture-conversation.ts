/**
 * Production fracture conversation (19 Oct 2026, production f3c9bcd): an ANONYMISED household whose documents reproduce the
 * actual library's stored page text for the pages that conversation cited -- INCLUDING the certificate layout the earlier
 * fixtures did not have: the actual certificate prints its effective date as ONE cell ("As of 06/10/2022"), where
 * ./actual-lib.ts and ./death-journey-actual-values.ts split it into two cells ("As of" | "06/10/2022"). That difference hid
 * the defect "a date printed as 'As of dd/mm/yyyy' in one cell is not read as a date".
 *
 * Sources (read-only, 19 Oct 2026, the household's own saved pages): certificate p1; Product Summary p8, p12, p13; Benefit
 * Summary (a document the household's library stores with role "certificate", "Supporting document") p7, p8, p9. Wording,
 * line breaks, tab cells, footnote markers and headings are kept exactly; only the insurer (name, address, registration,
 * web address), the scheme web path, people, NRIC masks and policy numbers are changed -- consistently -- as in ./actual-lib.ts.
 * Amounts and the date are the printed ones (S$1,000,000 Term Life; S$600,000 Personal Accident; 06/10/2022): they are
 * policy figures, not personal identifiers. The roles/authority of the three documents are the library's own.
 */
import type { FxDoc, FxMember } from "../rag2/household";
import { ACCOUNT, OTHER_ACCOUNT } from "./actual-lib";

export { ACCOUNT, OTHER_ACCOUNT };
const id = (n: number) => "7d000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const M = {
  daniel: { id: id(1), name: "Lee Wei Ming, Daniel", pref: "Daniel", rel: "self", notes: null, dob: "1981-04-02" },
  grace: { id: id(2), name: "Tan Hui Min Grace", pref: "Grace", rel: "spouse", notes: "wife", dob: "1983-09-15" },
  other: { id: id(9), name: "Daniel Lee", pref: "Daniel", rel: "self", notes: null, dob: "1970-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const anon = (t: string) => t
  .replace(/Singapore Life Ltd\. 4 Shenton Way, #01-01, SGX Centre 2 Singapore 068807 singlife\.com/g, "Aldermoor Life Ltd. 1 Example Road, #01-01 Singapore 000000 aldermoor.example")
  .replace(/Company Reg\.No\. 196900499K GST Reg\.No\. MR-8500166-8/g, "Company Reg.No. 000000000X GST Reg.No. MR-0000000-0")
  .replace(/singlife\.com\/MINDEFandMHA/g, "aldermoor.example/SCHEMEX")
  .replace(/Singapore Life Ltd/g, "Aldermoor Life Ltd")
  .replace(/MINDEF & MHA/g, "Scheme X")
  .replace(/MINDEF\/SAF/g, "Authority-A")
  .replace(/MINDEF or MHA/g, "Authority-A or Authority-B")
  .replace(/Singlife/g, "Aldermoor");

/** Certificate p1 -- the layout as stored: every row's date is ONE cell "As of dd/mm/yyyy". */
export const CERT_P1 = anon([
  "Daniel Lee Wei Ming",
  "1 Example Walk",
  "#00-000,",
  "SG 000000",
  "Private & Confidential",
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Singapore Life Ltd\" for cover(s) as indicated:",
  "MINDEF & MHA GROUP INSURANCE SCHEME (GROUP POLICY NO. G007500)\tPage 1 of 1",
  "Product, Policy Number, Particulars of Insured Person(s) and Sum Assured/Medical Plan\tEffective Date",
  "GROUP TERM LIFE(POLICY NO.3037850)",
  "S****411A\tLee Wei Ming, Daniel\tS$1,000,000\tAs of 06/10/2022",
  "S****822B\tTan Hui Min Grace\tS$1,000,000\tAs of 06/10/2022",
  "GROUP PERSONAL ACCIDENT(POLICY NO. 3037850)",
  "S****411A\tLee Wei Ming, Daniel\tS$600,000\tAs of 06/10/2022",
  "S****822B\tTan Hui Min Grace\tS$600,000\tAs of 06/10/2022",
  "GROUP LIVING CARE(POLICY NO. 3037850)",
  "S****411A\tLee Wei Ming, Daniel\tS$350,000\tAs of 06/10/2022",
  "S****822B\tTan Hui Min Grace\tS$350,000\tAs of 06/10/2022",
  "GROUP LIVING CARE PLUS(POLICY NO. 3037850)",
  "S****411A\tLee Wei Ming, Daniel\tS$300,000\tAs of 06/10/2022",
  "S****822B\tTan Hui Min Grace\tS$300,000\tAs of 06/10/2022",
  "This certificate is issued to the terms and conditions of the Group Policy. All endorsements, changes and amendments to the Group Policy shall be",
  "binding without prior notice to the certificate holder. This Certificate of Insurance contains information about your life insurance and",
  "supersedes any certificate(s) previously issued to your under this policy. Please read it carefully and keep it safe.",
  "Singapore Life Ltd 4 Shenton Way #01-01 SGX Centre 2 Singapore 068807 www.singlife.com",
].join("\n"));

/** Product Summary p8 (printed "Page 7 of 36"): the key features of Group Personal Accident. */
export const PS_P8 = anon([
  "Group Personal Accident",
  "MINDEF & MHA GROUP INSURANCE VOLUNTARY SCHEME",
  "(GROUP POLICY NO: G007500)",
  "The Group Personal Accident Insurance provides coverage in the event of an accident,",
  "and provides you and your family with greater assurance and peace of mind.",
  "The coverage we offer is up to age 70 next birthday (ANB) and continues even",
  "after you have:",
  "•\tRetired or left the employment of MINDEF or MHA",
  "•\tBeen released from NS liability",
  "•\tCompleted Operationally Ready National Service (ORNS) training cycle",
  "or reached statutory age for completion of ORNS",
  "•\tLeft volunteer service",
  "Key Features",
  "1",
  "•\tBe insured up to a maximum coverage of S$600,000 at S$0.20 per day",
  "2",
  "•\tReceive 150% of your coverage amount if Total and Permanent Disability is",
  "due to an accident",
  "•\tPay the same premium rate up to age 70 (ANB)",
  "•\tCoverage for simple fracture or other fracture due to accident",
  "•\tReimbursement of ambulance cost",
  "•\t24/7 worldwide coverage",
  "•\tIn the event that the main Insured Person passes away, the spouse can",
  "continue to receive coverage",
  "(For details on the plan benefits, please refer to singlife.com/MINDEFandMHA)",
  "Page 7 of 36",
].join("\n"));

/** Product Summary p12 (printed "Page 11 of 36"): Injury due to Accident. */
export const PS_P12 = anon([
  "Insurance Benefits (continued)",
  "(For details on the plan benefits, please refer to singlife.com/MINDEFandMHA)",
  "•\tInjury due to Accident",
  "If while this policy is in force, an Insured Person sustains an Accidental bodily",
  "injury and suffers from any of the results described in the Schedule below,",
  "Singlife upon receipt and approval of satisfactory proof, indemnify the Insured",
  "Person according to the Schedule below:",
  "Compensation",
  "Schedule\t(% of Sum",
  "Insured)",
  "Fractured leg or patella with established non-union\t20%",
  "Shortening of leg by at least 5cm\t10%",
  "Third Degree Burns",
  "Area Damage as a Percentage of Total Body Surface Area",
  "Head - Equals to or greater than 2% but less than 5%\t50%",
  "- Equals to or greater than 5% but less than 8%\t75%",
  "- Equals to or greater than 8%\t100%",
  "Page 11 of 36",
].join("\n"));

/** Product Summary p13 (printed "Page 12 of 36"): Simple Fracture due to Accident, a fixed limit. */
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

/** Benefit Summary p7 (the part with Injury due to Accident). */
/** Benefit Summary p3 and p5: the product headings the library stores (the schedule on p8 is printed under "BENEFIT 2"). */
export const BS_P3 = anon(["BENEFIT 1: GROUP TERM LIFE", "Part 1", "Death or Terminal Illness: 100% of Sum Insured"].join("\n"));
export const BS_P5 = anon(["BENEFIT 2: GROUP PERSONAL ACCIDENT", "Part 1", "Death due to Accident: 100% of Sum Insured"].join("\n"));
export const BS_P7 = anon([
  "D. Injury due to Accident",
  "If while this Policy is in force, an Insured Person sustains an Accidental bodily injury and suffers from any of the results described in the",
  "Schedule below, the Company shall, upon receipt of relevant documents as required under clause 14, indemnify the Insured Person according",
  "to the Schedule below:",
  "Compensation",
  "Schedule",
  "(% of Sum Insured)",
  "Fractured leg or patella with established non-union\t20%",
  "Shortening of leg by at least 5cm\t10%",
  "Third Degree Burns",
  "Area\tDamage as a Percentage of Total Body Surface Area",
  "Head\t- Equals to or greater than 2% but less than 5%\t50%",
  "- Equals to or greater than 5% but less than 8%\t75%",
  "- Equals to or greater than 8%\t100%",
  "Singapore Life Ltd. 4 Shenton Way, #01-01, SGX Centre 2 Singapore 068807 singlife.com",
  "Company Reg.No. 196900499K GST Reg.No. MR-8500166-8",
].join("\n"));

/** Benefit Summary p8: Simple Fracture or Other Fracture due to Accident, a percentage of the Sum Insured. */
export const BS_P8 = anon([
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

/** Benefit Summary p9: benefits with printed requirements (a positive control: a question about a requirement that IS printed). */
export const BS_P9 = anon([
  "J, Accidental Hospital Recuperation Benefit",
  "In addition to the specific exclusions listed below, if within 30 days following bodily injury as a result of an Accident, it is medically necessary",
  "due to the said injury (whether directly or indirectly necessary) of the Insured Person to be confined as a resident patient in a Hospital for a",
  "continuous period of at least 24 hours on the recommendation of a Registered Medical Practitioner but not for the purpose of convalescent rest,",
  "We will pay a one-time amount of $250 per hospitalisation.",
  "Subsequent hospitalisation resulting from the same injury will not be payable.",
  "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.",
  "K. Child Education Fund Benefit",
  "If an Insured Person sustains bodily injury as a result of an Accident resulting in death, we will, upon receipt of relevant documents as required",
  "under clause 14 (including proof of death) in our prescribed form, pay child education fund of $5,000 per child, subject to a maximum of two",
  "children, provided the Dependant child is unmarried and a full-time student including in an institution of higher learning and is aged 25 and below",
  "and not enlisted into full-time National Service.",
  "This Benefit can only be claimed either under the Core Scheme or Voluntary Scheme.",
  "Singapore Life Ltd. 4 Shenton Way, #01-01, SGX Centre 2 Singapore 068807 singlife.com",
  "Company Reg.No. 196900499K GST Reg.No. MR-8500166-8",
].join("\n"));

const both = [{ id: M.daniel.id }, { id: M.grace.id }];
const scheme = { insurer: "Aldermoor Life Ltd", policyType: "Group insurance", groupPolicyNumber: "G007500" };
export const DOCS: FxDoc[] = [
  { key: "CERT", id: id(101), owner: M.daniel.id, members: both, ...scheme, product: "Scheme X Group Insurance Scheme", policyNumber: "3037850", role: "certificate", personal: true, hash: "sha256:fx-cert", effective: "2022-10-06", documentDate: null, filename: "Certificate of Insurance.pdf", pages: { 1: CERT_P1 } },
  { key: "PRODUCT_SUMMARY", id: id(102), owner: M.daniel.id, members: both, ...scheme, product: "Scheme X Group Insurance", policyNumber: "3037850", role: "product_summary", personal: false, hash: "sha256:fx-product-summary", filename: "Product Summary.pdf", pages: { 8: PS_P8, 12: PS_P12, 13: PS_P13 } },
  { key: "BENEFIT_SUMMARY", id: id(103), owner: M.daniel.id, members: both, ...scheme, product: "Scheme X Group Insurance", policyNumber: "3037850", role: "certificate", personal: false, hash: "sha256:fx-benefit-summary", filename: "Benefit Summary.pdf", pages: { 3: BS_P3, 5: BS_P5, 7: BS_P7, 8: BS_P8, 9: BS_P9 } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

/**
 * Reliable chat (actual-library findings after d549a27, 16 Oct 2026): an anonymised household whose library has the
 * STRUCTURE the report describes. The live records were not read from this session (production access is not
 * authorised), so this follows the report; every name, identifier and amount not material to the findings is invented.
 *
 *  report (actual library)                                fixture
 *  a generic group-insurance booklet holding several       BOOKLET: "Group Insurance Benefits Booklet" (no product
 *  products (Term Life and Personal Accident)              word in its title): Part A Group Term Life, Part B Group
 *                                                          Personal Accident -- the Simple Fracture table (% of a fixed
 *                                                          S$5,000) and, on the next page, Other Fracture (% of Sum
 *                                                          Insured) with no product word on that page
 *  a certificate with Term Life and PA amounts             CERT: Term Life and PA rows for two people with IDENTICAL
 *                                                          amounts (S$500,000 / S$300,000), as of 01/04/2024
 *  page 9: a section headed "Compassionate Death           BOOKLET p9: that heading, then a paragraph wrapped over lines
 *  Allowance Benefit"; accidental death, proof, funeral    ("... as a result of an Accident, which" / "independently ...")
 *  expenses up to $2,000 (bare $)                          naming funeral expenses up to $2,000 (bare $)
 *  an uncertain hip / tibia fracture                       BK1 conversation (scripts/reliable-chat-booklet.ts)
 *
 * Variants (BOOKLET_CURRENCY): "none" (default; the booklet never says what "$" is) | "related" (the booklet's own
 * benefit table prints the same benefit in S$) | "unrelated" (an S$ figure printed for ANOTHER benefit only).
 * BOOKLET_SECTIONS=none: the booklet prints no product (PART) headings -- which certificate product Other Fracture's
 * Sum Insured is cannot be established, and must be said as that missing link, never chosen.
 * Always present: a SUPERSEDED earlier certificate (other amounts) -- never a base.
 */
import type { FxDoc, FxMember } from "../rag2/household";

export const ACCOUNT = "00000000-0000-0000-0000-00000000b001";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000b002";
const id = (n: number) => "7b000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const M = {
  daniel: { id: id(1), name: "Daniel Lee Wei Ming", pref: "Daniel", rel: "self", notes: null, dob: "1981-04-02" },
  grace: { id: id(2), name: "Grace Tan Hui Min", pref: "Grace", rel: "spouse", notes: "wife", dob: "1983-09-15" },
  other: { id: id(9), name: "Daniel Lee", pref: "Daniel", rel: "self", notes: null, dob: "1970-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const T = "\t";
const row = (masked: string, name: string, amount: string) => [masked, name, amount, "As of", "01/04/2024"].join(T);
export const CERT_P1 = [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Aldermoor Life Ltd.\" for cover(s) as indicated:",
  "CIVIL SERVICE GROUP INSURANCE SCHEME (GROUP POLICY NO. GIS-7000)   Page 1 of 1",
  ["Product, Policy Number, Particulars of Insured Person(s) and Sum Assured", "Effective Date"].join(T),
  "GROUP TERM LIFE(POLICY NO.GTL-7001)",
  row("S****411A", "Lee Wei Ming, Daniel", "S$500,000"),
  row("S****822B", "Tan Hui Min, Grace", "S$500,000"),
  "GROUP PERSONAL ACCIDENT(POLICY NO. GPA-7002)",
  row("S****411A", "Lee Wei Ming, Daniel", "S$300,000"),
  row("S****822B", "Tan Hui Min, Grace", "S$300,000"),
].join("\n");

export type CurrencyVariant = "none" | "related" | "unrelated";
export const SECTIONS: "parts" | "none" = process.env.BOOKLET_SECTIONS === "none" ? "none" : "parts";
export const CURRENCY: CurrencyVariant = (["related", "unrelated"].includes(process.env.BOOKLET_CURRENCY ?? "") ? process.env.BOOKLET_CURRENCY : "none") as CurrencyVariant;

const BK_P1 = [
  "Group Insurance Benefits Booklet",
  "Civil Service Group Insurance Scheme (Group Policy No. GIS-7000)",
  "This booklet describes the products of the scheme. Your Certificate of Group Insurance shows the products and amounts that apply to you.",
  ...(CURRENCY === "related" ? ["Benefit table", "Compassionate Death Allowance Benefit\tS$2,000"] : CURRENCY === "unrelated" ? ["Benefit table", "Child Education Benefit\tS$2,000"] : []),
].join("\n");
const BK_P2 = [
  "Definitions",
  "Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means.",
  "Sum Insured means the amount shown for the Insured Person under the relevant product in the Certificate of Group Insurance.",
].join("\n");
const BK_P3 = [
  ...(SECTIONS === "parts" ? ["PART A - GROUP TERM LIFE"] : []),
  "Death Benefit",
  "We will pay 100% of the Sum Insured if the Insured Person dies while covered.",
].join("\n");
const BK_P7 = [
  ...(SECTIONS === "parts" ? ["PART B - GROUP PERSONAL ACCIDENT"] : []),
  "Section 3 - Simple Fracture",
  "Simple Fracture means a closed fracture where the skin is not broken.",
  "Simple Fracture Benefit Limit: S$5,000",
  "We will pay the percentage of the Simple Fracture Benefit Limit shown below for a Simple Fracture of a nature listed, caused by an Accident.",
  "Bone fractured Compensation (% of S$5,000)",
  "Skull 100%",
  "Hip 75%",
  "Jaw, Pelvis, Leg, Ankle or Knee 50%",
  "Arm, Wrist or Elbow 40%",
].join("\n");
const BK_P8 = [
  "Section 4 - Other Fracture",
  "Other Fracture means a fracture that is not a Simple Fracture, including a compound (open) fracture. We will pay the percentage of the Sum Insured shown below.",
  "Bone fractured Compensation (% of Sum Insured)",
  "Skull (Other Fracture) 100%",
  "Hip (Other Fracture) 75%",
  "Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%",
].join("\n");
/** Page 9 as stored: the heading, then one paragraph wrapped over three lines (the first ends ", which"). */
export const BK_P9 = [
  "Section 5 - Compassionate Death Allowance Benefit",
  "If an Insured Person sustains bodily injury as a result of an Accident, which",
  "independently of any other cause results in the Insured Person's death within 365 days of the Accident, we will",
  "pay the funeral expenses incurred, up to $2,000, on receipt of proof of death and the original receipts.",
  "This benefit is not payable for death caused by an illness.",
  "Section 6 - Repatriation",
  "We will pay up to $5,000 for the cost of bringing the Insured Person's body home if death occurs overseas.",
].join("\n");

const both = [{ id: M.daniel.id }, { id: M.grace.id }];
export const DOCS: FxDoc[] = [
  { key: "CERT", id: id(101), owner: M.daniel.id, members: both, insurer: "Aldermoor Life Ltd", product: "Civil Service Group Insurance Scheme - Certificate", policyNumber: "GIS-7000", groupPolicyNumber: "GIS-7000", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:bk-cert", effective: "2024-04-01", documentDate: "2024-04-01", pages: { 1: CERT_P1 } },
  { key: "BOOKLET", id: id(102), owner: M.daniel.id, members: both, insurer: "Aldermoor Life Ltd", product: "Group Insurance Benefits Booklet", policyNumber: "GIS-7000", groupPolicyNumber: "GIS-7000", policyType: "Group insurance", role: "policy_wording", personal: false, hash: "sha256:bk-booklet-" + CURRENCY, pages: { 1: BK_P1, 2: BK_P2, 3: BK_P3, 7: BK_P7, 8: BK_P8, 9: BK_P9 } },
  // an earlier certificate, superseded (other amounts): never a base
  { key: "OLD_CERT", id: id(103), owner: M.daniel.id, members: both, insurer: "Aldermoor Life Ltd", product: "Civil Service Group Insurance Scheme - Certificate (2022)", policyNumber: "GIS-7000", groupPolicyNumber: "GIS-7000", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:bk-old-cert", effective: "2022-04-01", documentDate: "2022-04-01", superseded: true, filename: "certificate_2022.pdf", pages: { 1: CERT_P1.replace(/S\$300,000/g, "S$200,000").replace(/S\$500,000/g, "S$400,000").replace(/01\/04\/2024/g, "01/04/2022") } },
  // another household: the same scheme, the same amounts -- never this household's evidence
  { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.other.id, members: [{ id: M.other.id }], insurer: "Aldermoor Life Ltd", product: "Civil Service Group Insurance Scheme - Certificate (other household)", policyNumber: "GIS-7000", groupPolicyNumber: "GIS-7000", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:bk-other", filename: "other_certificate.pdf", pages: { 1: CERT_P1.replace(/Lee Wei Ming, Daniel/g, "Lee, Daniel") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

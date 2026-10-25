/**
 * Synthetic household for the scenario-completion suite (scripts/rag2-scenario-regressions.ts; npm run
 * rag2:scenario-test). Written by hand to mirror the document layouts behind a reported live conversation ("Raymond
 * broke his leg" -> how -> X-ray + two nights warded -> "transverse fracture"); every insurer, scheme, person, masked
 * ID, policy number and amount is invented.
 *
 *  CERT      group certificate, NO column header, one insured person per ROW under each product heading, each row
 *            "As of" a date (Raymond and Grace; GTL is a distractor product on the same certificate).
 *  CERT_OLD  the superseded earlier certificate (other amounts): never a source.
 *  PA_WORD   the same scheme's personal accident wording: a schedule of compensation listing fractures BY BONE
 *            (femur / tibia or fibula / patella / arm / other), a note that only 50% of the listed percentage is
 *            payable for a simple (closed) fracture and the full percentage for a compound (open) one, an X-ray
 *            condition, and Accident Hospital Income per COMPLETE 24 hours of confinement.
 *  FAMILY    Grace (adult) and Kai (child): one flat fracture amount per person (no bone or fracture type matters).
 *  JUNIOR    Kai only: no leg row -- "Other fracture" is the row that applies -- and hospital cash per day or part of
 *            a day (calendar days).
 *  OTHER     another household's certificate naming a "Raymond" with other amounts: never visible here.
 */
import { row, type FxDoc, type FxMember } from "../rag2/household";

export const ACCOUNT = "00000000-0000-0000-0000-00000000c301";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000c302";
const id = (n: number) => "7c000000-0000-4000-8000-" + String(n).padStart(12, "0");

export const M = {
  raymond: { id: id(1), name: "Raymond Lim Wei Jie", pref: "Raymond", rel: "self", notes: null, dob: "1983-05-14" },
  grace: { id: id(2), name: "Grace Ng Hui Lin", pref: "Grace", rel: "spouse", notes: "wife", dob: "1985-09-30" },
  kai: { id: id(3), name: "Kai Lim Jun Wen", pref: "Kai", rel: "child", notes: "son", dob: "2015-03-08" },
  otherRaymond: { id: id(9), name: "Raymond Lim", pref: "Raymond", rel: "self", notes: null, dob: "1977-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const W = [14, 24, 14, 8];
const person = (masked: string, name: string, amount: string, date: string) => row([masked, name, amount, "As of", date], W);
const cert = (gtl: [string, string], gpa: [string, string], date: string, scheme = "MERIDIAN PUBLIC SERVICE GROUP SCHEME (GROUP POLICY NO. G7720)") => [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Meridian Assurance\" for cover(s) as indicated:",
  scheme + "   Page 1 of 1",
  "Product, Policy Number, Particulars of Insured Person(s) and Sum Assured   Effective Date",
  "GROUP TERM LIFE(POLICY NO.MPS-500123)",
  person("S****514D", "Lim Wei Jie, Raymond", gtl[0], date),
  person("S****930G", "Ng Hui Lin Grace", gtl[1], date),
  "GROUP PERSONAL ACCIDENT(POLICY NO. MPS-500123)",
  person("S****514D", "Lim Wei Jie, Raymond", gpa[0], date),
  person("S****930G", "Ng Hui Lin Grace", gpa[1], date),
].join("\n");

const WS = [52];
const PA_P1 = [
  "Meridian Assurance - Public Service Group Personal Accident (Policy No. MPS-500123, Group Policy No. G7720)",
  "Schedule of Compensation",
  "",
  row(["Event", "% of Sum Insured"], WS),
  row(["Death due to Accident", "100%"], WS),
  row(["Fracture of thigh bone (femur)", "10%"], WS),
  row(["Fracture of lower leg (tibia or fibula)", "6%"], WS),
  row(["Fracture of kneecap (patella)", "4%"], WS),
  row(["Fracture of arm (humerus, radius or ulna)", "5%"], WS),
  row(["Other fracture not listed above", "1%"], WS),
  "",
  "Fracture benefits are payable for a fracture confirmed by X-ray. For a simple (closed) fracture 50% of the percentage shown is payable; the full percentage shown is payable for a compound (open) fracture. Where one Accident causes more than one fracture, only the highest single amount is payable.",
].join("\n");
const PA_P2 = [
  "Section 2 - Benefits",
  "Accident Hospital Income: S$100 for each complete period of 24 hours of continuous confinement in a hospital as an in-patient as a direct result of an Accident, up to 90 days per Accident.",
  "Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means.",
  "The Sum Insured is the amount shown for the Insured Person under Group Personal Accident in the Certificate of Group Insurance.",
  "",
  "Section 3 - Exclusions",
  "We will not pay for injury caused by illness or disease.",
].join("\n");

const WF = [40, 16, 16];
const FAMILY_P1 = [
  "Kestrel General - FamilyShield Accident Plan - Policy Schedule",
  "Policy No. KG-FS-8812",
  "Insured adult: Grace Ng Hui Lin. Insured child: Kai Lim Jun Wen.",
  "",
  row(["Benefit", "Adult", "Child"], WF),
  row(["Accidental death", "S$150,000", "S$50,000"], WF),
  row(["Fracture (per fracture, any bone)", "S$800", "S$400"], WF),
].join("\n");
const WJ = [44, 16];
const JUNIOR_P1 = [
  "Orchid Life - JuniorCare Accident Plan - Policy Schedule",
  "Policy No. OL-JC-2290    Insured child: Kai Lim Jun Wen",
  "",
  row(["Benefit", "Amount"], WJ),
  row(["Fracture of skull", "S$2,000"], WJ),
  row(["Other fracture", "S$300"], WJ),
  row(["Hospital cash (per day)", "S$50"], WJ),
  "",
  "Hospital cash is payable for each day or part of a day of confinement in hospital as an in-patient, including the day of admission and the day of discharge, up to 30 days per Accident.",
].join("\n");

export const DOCS: FxDoc[] = [
  { key: "CERT", id: id(101), owner: M.raymond.id, members: [{ id: M.raymond.id }, { id: M.grace.id }], insurer: "Meridian Assurance", product: "Meridian Public Service Group Scheme - Certificate", policyNumber: "MPS-500123", groupPolicyNumber: "G7720", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:scenario-cert", effective: "2025-07-01", documentDate: "2025-07-01", pages: { 1: cert(["S$500,000", "S$300,000"], ["S$300,000", "S$200,000"], "01/07/2025") } },
  { key: "CERT_OLD", id: id(102), owner: M.raymond.id, members: [{ id: M.raymond.id }, { id: M.grace.id }], insurer: "Meridian Assurance", product: "Meridian Public Service Group Scheme - Certificate (2023)", policyNumber: "MPS-500123", groupPolicyNumber: "G7720", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:scenario-cert-2023", effective: "2023-07-01", documentDate: "2023-07-01", superseded: true, pages: { 1: cert(["S$400,000", "S$250,000"], ["S$250,000", "S$150,000"], "01/07/2023") } },
  { key: "PA_WORD", id: id(103), owner: M.raymond.id, members: [{ id: M.raymond.id }, { id: M.grace.id }], insurer: "Meridian Assurance", product: "Meridian Public Service Group Personal Accident - Policy Wording", policyNumber: "MPS-500123", groupPolicyNumber: "G7720", policyType: "Personal accident", role: "policy_wording", personal: true, hash: "sha256:scenario-pa-wording", pages: { 1: PA_P1, 2: PA_P2 } },
  { key: "FAMILY", id: id(104), owner: M.grace.id, members: [{ id: M.grace.id, tier: "Adult" }, { id: M.kai.id, tier: "Child" }], insurer: "Kestrel General", product: "FamilyShield Accident Plan", policyNumber: "KG-FS-8812", policyType: "Personal accident", role: "schedule", personal: true, hash: "sha256:scenario-family", effective: "2026-01-01", pages: { 1: FAMILY_P1 } },
  { key: "JUNIOR", id: id(105), owner: M.grace.id, members: [{ id: M.kai.id }], insurer: "Orchid Life", product: "JuniorCare Accident Plan", policyNumber: "OL-JC-2290", policyType: "Personal accident", role: "schedule", personal: true, hash: "sha256:scenario-junior", effective: "2026-02-01", pages: { 1: JUNIOR_P1 } },
  { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.otherRaymond.id, members: [{ id: M.otherRaymond.id }], insurer: "Meridian Assurance", product: "Meridian Public Service Group Scheme - Certificate", policyNumber: "MPS-509999", groupPolicyNumber: "G7720", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:scenario-other", pages: { 1: cert(["S$900,000", "S$0"], ["S$800,000", "S$0"], "01/07/2025").replace("Lim Wei Jie, Raymond", "Lim, Raymond") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

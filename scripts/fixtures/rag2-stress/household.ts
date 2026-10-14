/**
 * Synthetic household for the stress-test structures (scripts/rag2-stress-regressions.ts; npm run rag2:stress-test).
 * Written by hand to preserve the LAYOUTS behind the 14 October live stress test -- every insurer, scheme, person,
 * masked ID, policy number and amount is invented; no source document or identifier is reused.
 *
 *  ROSTER     group certificate: one insured person per ROW under SEPARATE product headings (Group Term Life, then
 *             Group Personal Accident), each row "As of" a date. Personal proof for Ivan and Lena.
 *  GPA_WORD   the scheme's Personal Accident policy wording (reference wording, not personal proof):
 *               4.1 Simple Fracture -- a table of percentages of a FIXED benefit limit (S$5,000), not of the Sum Insured;
 *               4.2 Other Fracture  -- a similarly named provision paying a percentage of the Sum Insured;
 *               5.1 Daily Hospital Income -- per day, payable only FROM THE 11TH DAY of continuous confinement.
 *  LENA_TERM  Lena's own personal term-life policy schedule from another insurer.
 *  TRAVEL     an annual travel policy uploaded but linked to nobody.
 *  LOCKED     Lena's upload that is password protected (unreadable).
 *  PHOTO      Ivan's photo upload too blurred to read (unreadable).
 *  ROSTER_OLD the superseded 2025 certificate (other amounts): never a source, never listed.
 *  GPA_WORD p3 a Schedule of Compensation whose percentages ARE of the Sum Insured (the other structure).
 *  OTHER      another household's certificate naming an "Ivan Tan" with other amounts: never visible here.
 * Noah (son) has no document.
 */
import { row, type FxDoc, type FxMember } from "../rag2/household";
import { PDF_PASSWORD_REQUIRED_MESSAGE, UNREADABLE_PHOTO_MESSAGE } from "@/lib/documents/processing-errors";

export const ACCOUNT = "00000000-0000-0000-0000-00000000d401";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000d402";
const id = (n: number) => "7d000000-0000-4000-8000-" + String(n).padStart(12, "0");

export const M = {
  ivan: { id: id(1), name: "Ivan Tan Wei Ming", pref: "Ivan", rel: "self", notes: null, dob: "1982-02-11" },
  lena: { id: id(2), name: "Lena Goh Mei Ling", pref: "Lena", rel: "spouse", notes: "wife", dob: "1984-07-23" },
  noah: { id: id(3), name: "Noah Tan Jun Kai", pref: "Noah", rel: "child", notes: "son", dob: "2016-10-02" },
  otherIvan: { id: id(9), name: "Ivan Tan", pref: "Ivan", rel: "self", notes: null, dob: "1975-05-05", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const W = [14, 24, 14, 8];
const person = (masked: string, name: string, amount: string, date: string) => row([masked, name, amount, "As of", date], W);
const roster = (gtl: [string, string], gpa: [string, string], date: string, scheme = "ARBOR CIVIL SERVICE GROUP SCHEME (GROUP POLICY NO. GA-4410)") => [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Arbor Assurance\" for cover(s) as indicated:",
  scheme + "   Page 1 of 1",
  "Product, Policy Number, Particulars of Insured Person(s) and Sum Assured   Effective Date",
  "GROUP TERM LIFE(POLICY NO.ACS-771001)",
  person("S****221A", "Tan Wei Ming, Ivan", gtl[0], date),
  person("S****318C", "Goh Mei Ling, Lena", gtl[1], date),
  "GROUP PERSONAL ACCIDENT(POLICY NO. ACS-771002)",
  person("S****221A", "Tan Wei Ming, Ivan", gpa[0], date),
  person("S****318C", "Goh Mei Ling, Lena", gpa[1], date),
].join("\n");

const WT = [46];
const GPA_P1 = [
  "Arbor Assurance - Civil Service Group Personal Accident - Policy Wording (Group Policy No. GA-4410)",
  "Section 4 - Fracture Benefits",
  "4.1 Simple Fracture",
  "The Simple Fracture benefit limit is S$5,000 for each Insured Person per Accident. We will pay the percentage of the Simple Fracture benefit limit shown below for a simple fracture confirmed by X-ray.",
  row(["Bone fractured", "% of Simple Fracture benefit limit"], WT),
  row(["Skull", "100%"], WT),
  row(["Thigh (femur)", "60%"], WT),
  row(["Leg (tibia or fibula)", "50%"], WT),
  row(["Arm (humerus, radius or ulna)", "40%"], WT),
  row(["Finger or toe", "10%"], WT),
  "4.2 Other Fracture",
  "Other Fracture: for a compound fracture, or a fracture of a bone not listed in 4.1, we will pay 5% of the Sum Insured shown for the Insured Person under Group Personal Accident in the Certificate of Group Insurance.",
].join("\n");
const GPA_P3 = [
  "Section 3 - Schedule of Compensation (Permanent Disablement)",
  row(["Permanent disablement", "% of Sum Insured"], WT),
  row(["Total and permanent loss of sight of one eye", "50%"], WT),
  row(["Loss of one hand at or above the wrist", "50%"], WT),
  row(["Total loss of hearing in one ear", "15%"], WT),
].join("\n");
const GPA_P2 = [
  "Section 5 - Hospital Benefits",
  "Daily Hospital Income: S$150 for each day of confinement in a hospital as an in-patient as a direct result of an Accident, payable from the 11th day of continuous confinement, up to 180 days per Accident.",
  "",
  "Section 6 - Definitions",
  "Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means.",
  "Simple fracture means a closed fracture where the skin is not broken.",
  "Compound fracture means a fracture where the broken bone pierces the skin.",
  "",
  "Section 7 - Exclusions",
  "We will not pay for injury caused by illness or disease.",
].join("\n");

const WL = [34];
const LENA_P1 = [
  "Harbourline Life - SecureLife Term Plan - Policy Schedule",
  row(["Policy number", "HL-SL-60321"], WL),
  row(["Life assured", "Goh Mei Ling"], WL),
  row(["Policy owner", "Goh Mei Ling"], WL),
  row(["Policy start date", "15 Mar 2024"], WL),
  row(["Basic sum assured (death or terminal illness)", "S$250,000"], WL),
  row(["Premium", "S$41.20 monthly"], WL),
].join("\n");
const TRAVEL_P1 = [
  "Bluewave General - Annual Travel Plan - Certificate of Insurance",
  "Certificate No. BW-AT-11873   Period of insurance: 01 Jan 2026 to 31 Dec 2026",
  "Plan: Family Annual Multi-Trip (Asia)",
  "Overseas medical expenses limit: S$150,000 per Insured Person",
].join("\n");

export const DOCS: FxDoc[] = [
  { key: "ROSTER", id: id(101), owner: M.ivan.id, members: [{ id: M.ivan.id }, { id: M.lena.id }], insurer: "Arbor Assurance", product: "Arbor Civil Service Group Scheme - Certificate", policyNumber: "ACS-771002", groupPolicyNumber: "GA-4410", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:stress-roster", effective: "2026-04-01", documentDate: "2026-04-01", pages: { 1: roster(["S$400,000", "S$150,000"], ["S$200,000", "S$100,000"], "01/04/2026") } },
  { key: "GPA_WORD", id: id(102), owner: M.ivan.id, members: [{ id: M.ivan.id }, { id: M.lena.id }], insurer: "Arbor Assurance", product: "Arbor Civil Service Group Personal Accident - Policy Wording", policyNumber: "ACS-771002", groupPolicyNumber: "GA-4410", policyType: "Personal accident", role: "policy_wording", personal: false, hash: "sha256:stress-gpa-wording", pages: { 1: GPA_P1, 2: GPA_P2, 3: GPA_P3 } },
  { key: "ROSTER_OLD", id: id(107), owner: M.ivan.id, members: [{ id: M.ivan.id }, { id: M.lena.id }], insurer: "Arbor Assurance", product: "Arbor Civil Service Group Scheme - Certificate (2025)", policyNumber: "ACS-771002", groupPolicyNumber: "GA-4410", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:stress-roster-2025", effective: "2025-04-01", documentDate: "2025-04-01", superseded: true, pages: { 1: roster(["S$350,000", "S$120,000"], ["S$150,000", "S$80,000"], "01/04/2025") } },
  { key: "LENA_TERM", id: id(103), owner: M.lena.id, members: [{ id: M.lena.id }], insurer: "Harbourline Life", product: "SecureLife Term Plan", policyNumber: "HL-SL-60321", policyType: "Term life", role: "schedule", personal: true, hash: "sha256:stress-lena-term", effective: "2024-03-15", pages: { 1: LENA_P1 } },
  { key: "TRAVEL", id: id(104), owner: M.ivan.id, members: [], insurer: "Bluewave General", product: "Annual Travel Plan", policyNumber: "BW-AT-11873", policyType: "Travel", role: "schedule", personal: false, hash: "sha256:stress-travel", effective: "2026-01-01", expiry: "2026-12-31", pages: { 1: TRAVEL_P1 } },
  { key: "LOCKED", id: id(105), owner: M.lena.id, members: [{ id: M.lena.id }], insurer: "", product: "", policyNumber: null, policyType: "", role: "", personal: false, hash: "sha256:stress-locked", processing: "failed", processingError: PDF_PASSWORD_REQUIRED_MESSAGE, filename: "lena-hospital-plan.pdf", pages: {} },
  { key: "PHOTO", id: id(106), owner: M.ivan.id, members: [{ id: M.ivan.id }], insurer: "", product: "", policyNumber: null, policyType: "", role: "", personal: false, hash: "sha256:stress-photo", processing: "failed", processingError: UNREADABLE_PHOTO_MESSAGE, filename: "IMG_2231.jpg", pages: {} },
  { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.otherIvan.id, members: [{ id: M.otherIvan.id }], insurer: "Arbor Assurance", product: "Arbor Civil Service Group Scheme - Certificate", policyNumber: "ACS-779999", groupPolicyNumber: "GA-4410", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:stress-other", pages: { 1: roster(["S$900,000", "S$0"], ["S$700,000", "S$0"], "01/04/2026").replace(/Tan Wei Ming, Ivan/g, "Tan, Ivan").replace(/Goh Mei Ling, Lena/g, "Nobody, None") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

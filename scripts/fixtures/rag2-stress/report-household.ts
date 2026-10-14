/**
 * V1.3 (reconciled with the 14 October live stress-test report): a synthetic household reproducing the LAYOUTS the
 * report describes for the real library, so the fixes are tested on those structures and not only on the earlier
 * stress household (scripts/fixtures/rag2-stress/household.ts, kept unchanged because the recorded actual-model runs
 * s48-live-1..3 replay against it). Every insurer, scheme, person, masked ID, policy number, date and amount below is
 * invented, except the structural figures the report gives as layout (a S$5,000 Simple Fracture limit with a
 * "% of S$5,000" compensation column, 50% for the joint row, hospital cash payable from the 11th day). The household's
 * own names, insurers, amounts and dates are NOT reused, and no source document or identifier is committed.
 *
 * Report structure                                  -> this fixture
 *  six uploads: one personal-proof certificate,        CERT (personal proof, both adults), SUMMARY + WORDING
 *  five reference/supporting, one unreadable            (reference, linked to both), PET_WORD + PET_END (another
 *                                                       insurer's pet wording and endorsement, linked to nobody),
 *                                                       SCAN (could not be read)
 *  certificate: Group Term Life and Group Personal      CERT: GROUP TERM LIFE S$1,200,000 and GROUP PERSONAL ACCIDENT
 *  Accident printed separately for each adult, dated    S$450,000 for each adult, "As of 15/09/2023"
 *  summary PDF page 13 (printed page 12 of 36):         SUMMARY p13 "Page 12 of 36": "Simple Fracture Benefit Limit:
 *  Simple Fracture Benefit Limit S$5,000, column        S$5,000", column "Compensation (% of S$5,000)", row
 *  "percentage of S$5,000", "Jaw, Pelvis, Leg,          "Jaw, Pelvis, Leg, Ankle or Knee   50%" (the tibia is NOT
 *  Ankle or Knee: 50%"                                  named separately)
 *  a separate document's Other Fracture provision,      WORDING p1: "Jaw, Pelvis, Leg, Ankle or Knee (Other
 *  the same joint row at 50% of the Sum Insured         Fracture)   50%" under "Compensation (% of Sum Insured)"
 *  Daily Hospital Cash per day from the 11th day,       SUMMARY p5 (S$40 per day)
 *  page 5
 *  a name that is not a household member                any name not in M
 */
import { row, type FxDoc, type FxMember } from "../rag2/household";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/documents/processing-errors";

export const ACCOUNT = "00000000-0000-0000-0000-00000000d403";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000d404";
const id = (n: number) => "7e000000-0000-4000-8000-" + String(n).padStart(12, "0");

export const M = {
  marcus: { id: id(1), name: "Marcus Lee Kok Wai", pref: "Marcus", rel: "self", notes: null, dob: "1979-04-18" },
  serena: { id: id(2), name: "Serena Ong Hui Min", pref: "Serena", rel: "spouse", notes: "wife", dob: "1981-12-05" },
  otherMarcus: { id: id(9), name: "Marcus Lee", pref: "Marcus", rel: "self", notes: null, dob: "1970-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const W = [14, 24, 16, 8];
const person = (masked: string, name: string, amount: string, date: string) => row([masked, name, amount, "As of", date], W);
const certificate = (a: [string, string], b: [string, string], names: [string, string] = ["Lee Kok Wai, Marcus", "Ong Hui Min, Serena"]) => [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Kestrel Assurance\" for cover(s) as indicated:",
  "PUBLIC OFFICERS GROUP SCHEME (GROUP POLICY NO. KP-2207)   Page 1 of 1",
  "Product, Policy Number, Particulars of Insured Person(s) and Sum Assured   Effective Date",
  "GROUP TERM LIFE(POLICY NO.KPT-310045)",
  person("S****604D", names[0], a[0], "15/09/2023"),
  person("S****917H", names[1], a[1], "15/09/2023"),
  "GROUP PERSONAL ACCIDENT(POLICY NO. KPA-310046)",
  person("S****604D", names[0], b[0], "15/09/2023"),
  person("S****917H", names[1], b[1], "15/09/2023"),
].join("\n");

const WS = [40];
const SUMMARY_P5 = [
  "Public Officers Group Personal Accident - Summary of Benefits   Page 4 of 36",
  "Section B - Hospital Benefits",
  "Daily Hospital Cash: S$40 per day of confinement in hospital as an in-patient as a result of an Accident, payable from the 11th day onwards, up to 90 days per Accident.",
].join("\n");
const SUMMARY_P13 = [
  "Public Officers Group Personal Accident - Summary of Benefits   Page 12 of 36",
  "Section D - Simple Fracture",
  "Simple Fracture Benefit Limit: S$5,000",
  "We will pay the percentage of the Simple Fracture Benefit Limit shown below for a Simple Fracture of a nature listed, caused by an Accident.",
  row(["Bone fractured", "Compensation (% of S$5,000)"], WS),
  row(["Skull", "100%"], WS),
  row(["Jaw, Pelvis, Leg, Ankle or Knee", "50%"], WS),
  row(["Arm, Wrist or Elbow", "40%"], WS),
  row(["Collarbone or Rib", "20%"], WS),
  row(["Finger or Toe", "10%"], WS),
].join("\n");
const WO = [52];
const WORDING_P1 = [
  "Kestrel Assurance - Public Officers Group Personal Accident - Policy Wording (Group Policy No. KP-2207)",
  "Section 6 - Other Fracture",
  "Other Fracture means a fracture that is not a Simple Fracture, including a compound (open) fracture. We will pay the percentage of the Sum Insured shown below.",
  row(["Bone fractured", "Compensation (% of Sum Insured)"], WO),
  row(["Skull (Other Fracture)", "100%"], WO),
  row(["Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)", "50%"], WO),
  row(["Arm, Wrist or Elbow (Other Fracture)", "25%"], WO),
].join("\n");
const WORDING_P2 = [
  "Section 2 - Definitions",
  "Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means.",
  "Simple Fracture means a closed fracture where the skin is not broken.",
  "Sum Insured means the amount shown for the Insured Person under Group Personal Accident in the Certificate of Group Insurance.",
].join("\n");
const PET_WORD_P1 = ["Lumen General - PawSafe Pet Insurance - Policy Wording", "Section 1 - Veterinary fees", "We will pay veterinary fees up to S$4,000 per Policy Year for your Pet."].join("\n");
const PET_END_P1 = ["Lumen General - PawSafe Pet Insurance - Endorsement No. 2", "With effect from 1 March 2026 the Excess for each claim is amended to S$150."].join("\n");

export const DOCS: FxDoc[] = [
  { key: "CERT", id: id(101), owner: M.marcus.id, members: [{ id: M.marcus.id }, { id: M.serena.id }], insurer: "Kestrel Assurance", product: "Public Officers Group Scheme - Certificate", policyNumber: "KPA-310046", groupPolicyNumber: "KP-2207", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:report-cert", effective: "2023-09-15", documentDate: "2023-09-15", pages: { 1: certificate(["S$1,200,000", "S$1,200,000"], ["S$450,000", "S$450,000"]) } },
  { key: "SUMMARY", id: id(102), owner: M.marcus.id, members: [{ id: M.marcus.id }, { id: M.serena.id }], insurer: "Kestrel Assurance", product: "Public Officers Group Personal Accident - Summary of Benefits", policyNumber: "KPA-310046", groupPolicyNumber: "KP-2207", policyType: "Personal accident", role: "benefit_summary", personal: false, hash: "sha256:report-summary", pages: { 5: SUMMARY_P5, 13: SUMMARY_P13 } },
  { key: "WORDING", id: id(103), owner: M.marcus.id, members: [{ id: M.marcus.id }, { id: M.serena.id }], insurer: "Kestrel Assurance", product: "Public Officers Group Personal Accident - Policy Wording", policyNumber: "KPA-310046", groupPolicyNumber: "KP-2207", policyType: "Personal accident", role: "policy_wording", personal: false, hash: "sha256:report-wording", pages: { 1: WORDING_P1, 2: WORDING_P2 } },
  { key: "PET_WORD", id: id(104), owner: M.marcus.id, members: [], insurer: "Lumen General", product: "PawSafe Pet Insurance - Policy Wording", policyNumber: "LG-PS-5512", policyType: "Pet", role: "policy_wording", personal: false, hash: "sha256:report-pet-word", pages: { 1: PET_WORD_P1 } },
  { key: "PET_END", id: id(105), owner: M.marcus.id, members: [], insurer: "Lumen General", product: "PawSafe Pet Insurance - Endorsement", policyNumber: "LG-PS-5512", policyType: "Pet", role: "endorsement", personal: false, hash: "sha256:report-pet-end", pages: { 1: PET_END_P1 } },
  { key: "SCAN", id: id(106), owner: M.marcus.id, members: [{ id: M.marcus.id }], insurer: "", product: "", policyNumber: null, policyType: "", role: "", personal: false, hash: "sha256:report-scan", processing: "failed", processingError: UNREADABLE_PHOTO_MESSAGE, filename: "scan-0042.jpg", pages: {} },
  { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.otherMarcus.id, members: [{ id: M.otherMarcus.id }], insurer: "Kestrel Assurance", product: "Public Officers Group Scheme - Certificate", policyNumber: "KPA-399999", groupPolicyNumber: "KP-2207", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:report-other", pages: { 1: certificate(["S$800,000", "S$0"], ["S$700,000", "S$0"], ["Lee, Marcus", "Nobody, None"]) } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

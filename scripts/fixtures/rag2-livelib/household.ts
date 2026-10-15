/**
 * V1.5: synthetic household reproducing the STORED STRUCTURE of the live library described in the live verification
 * after PR #49 (14 Oct 2026): the passages and layouts that report inspected, with every name, identifier, insurer and
 * address invented. Used by scripts/rag2-live-verify-regressions.ts (controls) and the pre-registered actual-model
 * sample s52 (RAG2_LIVE_HOUSEHOLD=livelib; scripts/rag2-live/scenario-household.ts S52A-D).
 *
 * Report structure                                   -> this fixture
 *  six active uploads, five ready, one failed          CERT, SUMMARY, WORDING, GTL_SUM, TRAVEL ready; SCAN failed,
 *                                                       linked to nobody
 *  personal certificate: complete TAB-SEPARATED person  CERT: two adults under separate product headings, Term Life
 *  rows beneath separate product headings; both adults  S$1,000,000 and PA S$600,000 each (plus Living Care Plus
 *  Term Life S$1,000,000 and PA S$600,000, as of        S$300,000 each -- the figure the live limit fallback showed),
 *  6 October 2022                                       "As of 06/10/2022"
 *  certificate insurer stored under the registered      CERT insurer "Kestrel Life Ltd"; SUMMARY insurer stored as
 *  name; the scheme summary under the brand name        the brand "KestrelOne", whose text prints "underwritten by
 *                                                       Kestrel Life Ltd."
 *  Summary of Benefits page 13 (printed page 12 of      SUMMARY p13 "Page 12 of 36": "Simple Fracture Benefit Limit:
 *  36): Simple Fracture Benefit Limit S$5,000;          S$5,000", column "Compensation (% of S$5,000)", row "Jaw,
 *  "Compensation (% of S$5,000)"; "Jaw, Pelvis, Leg,    Pelvis, Leg, Ankle or Knee  50%"
 *  Ankle or Knee: 50%"
 *  the 365-day condition sits under permanent           SUMMARY p9: "Accidental Death: 100% of the Sum Insured."
 *  dismemberment, not under death                        then "Permanent Dismemberment: … within 365 days of the
 *                                                       Accident." on its own line
 *  the summary prints S$2,000; the detailed wording     SUMMARY p9 "Repatriation of Mortal Remains: S$2,000 …";
 *  prints bare $2,000                                   WORDING p3 "… up to $2,000 …" (no currency declaration)
 *  another insurer's trip cover, not proven for this    TRAVEL: "Falcon General" single-trip travel policy for a 2025
 *  trip                                                 trip, linked to the first adult
 */
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/documents/processing-errors";
import type { FxDoc, FxMember } from "../rag2/household";

export const ACCOUNT = "00000000-0000-0000-0000-00000000e601";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000e602";
const id = (n: number) => "7e600000-0000-4000-8000-" + String(n).padStart(12, "0");

export const M = {
  adrian: { id: id(1), name: "Adrian Wong Jia Hui", pref: "Adrian", rel: "self", notes: null, dob: "1978-02-11" },
  cheryl: { id: id(2), name: "Cheryl Lim Pei Shan", pref: "Cheryl", rel: "spouse", notes: "wife", dob: "1980-07-30" },
  otherAdrian: { id: id(9), name: "Adrian Wong", pref: "Adrian", rel: "self", notes: null, dob: "1969-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const T = "\t";
const row = (masked: string, name: string, amount: string) => [masked, name, amount, "As of", "06/10/2022"].join(T);
const CERT_P1 = [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Kestrel Life Ltd.\" for cover(s) as indicated:",
  "PUBLIC OFFICERS GROUP INSURANCE SCHEME (GROUP POLICY NO. KP-2207)   Page 1 of 1",
  ["Product, Policy Number, Particulars of Insured Person(s) and Sum Assured", "Effective Date"].join(T),
  "GROUP TERM LIFE(POLICY NO.KPT-310045)",
  row("S****604D", "Wong Jia Hui, Adrian", "S$1,000,000"),
  row("S****917H", "Lim Pei Shan, Cheryl", "S$1,000,000"),
  "GROUP PERSONAL ACCIDENT(POLICY NO. KPA-310046)",
  row("S****604D", "Wong Jia Hui, Adrian", "S$600,000"),
  row("S****917H", "Lim Pei Shan, Cheryl", "S$600,000"),
  "GROUP LIVING CARE PLUS(POLICY NO. KPL-310047)",
  row("S****604D", "Wong Jia Hui, Adrian", "S$300,000"),
  row("S****917H", "Lim Pei Shan, Cheryl", "S$300,000"),
].join("\n");
const SUM_P5 = [
  "KestrelOne Public Officers Group Personal Accident - Summary of Benefits   Page 4 of 36",
  "Underwritten by Kestrel Life Ltd.",
  "Section B - Hospital Benefits",
  "Daily Hospital Cash: S$40 per day of confinement in hospital as an in-patient as a result of an Accident, payable from the 11th day onwards, up to 90 days per Accident.",
].join("\n");
const SUM_P9 = [
  "KestrelOne Public Officers Group Personal Accident - Summary of Benefits   Page 8 of 36",
  "Section A - Death and Disablement",
  "Accidental Death: 100% of the Sum Insured.",
  "Permanent Dismemberment: up to 100% of the Sum Insured according to the Scale of Compensation, if the loss occurs within 365 days of the Accident.",
  "Repatriation of Mortal Remains: S$2,000 per Insured Person, if death occurs outside Singapore as a result of an Accident.",
  "Territorial Limits: worldwide, 24 hours a day.",
  "Exclusions: no benefit is payable for death or injury caused by war or civil war, or by the Insured Person's deliberate self-injury.",
].join("\n");
const W = 40;
const pad = (cells: string[]) => cells.map((c, i) => (i < cells.length - 1 ? c.padEnd(W) : c)).join("");
const SUM_P13 = [
  "KestrelOne Public Officers Group Personal Accident - Summary of Benefits   Page 12 of 36",
  "Section D - Simple Fracture",
  "Simple Fracture Benefit Limit: S$5,000",
  "We will pay the percentage of the Simple Fracture Benefit Limit shown below for a Simple Fracture of a nature listed, caused by an Accident.",
  pad(["Bone fractured", "Compensation (% of S$5,000)"]),
  pad(["Skull", "100%"]),
  pad(["Jaw, Pelvis, Leg, Ankle or Knee", "50%"]),
  pad(["Arm, Wrist or Elbow", "40%"]),
  pad(["Collarbone or Rib", "20%"]),
  pad(["Finger or Toe", "10%"]),
].join("\n");
const WORD_P1 = [
  "Kestrel Life Ltd - Public Officers Group Personal Accident - Policy Wording (Group Policy No. KP-2207)",
  "Section 6 - Other Fracture",
  "Other Fracture means a fracture that is not a Simple Fracture, including a compound (open) fracture. We will pay the percentage of the Sum Insured shown below.",
  [pad(["Bone fractured", "Compensation (% of Sum Insured)"])].join(""),
  pad(["Skull (Other Fracture)", "100%"]),
  pad(["Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)", "50%"]),
  pad(["Arm, Wrist or Elbow (Other Fracture)", "25%"]),
].join("\n");
const WORD_P2 = [
  "Section 2 - Definitions",
  "Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means.",
  "Simple Fracture means a closed fracture where the skin is not broken.",
  "Sum Insured means the amount shown for the Insured Person under Group Personal Accident in the Certificate of Group Insurance.",
].join("\n");
const WORD_P3 = [
  "Section 4 - Repatriation",
  "If the Insured Person dies outside Singapore as a result of an Accident, we will reimburse the reasonable cost of returning the remains to Singapore, up to $2,000.",
  "Section 5 - General Exclusions",
  "We will not pay for death or injury caused by war, invasion or civil war, or by the Insured Person's deliberate self-injury.",
].join("\n");
const GTL_P1 = [
  "Kestrel Life Ltd - Public Officers Group Term Life - Product Summary",
  "Death Benefit: the Sum Assured shown in the Certificate of Group Insurance is payable on the death of the Insured Person.",
  "Terminal Illness Benefit: the Sum Assured is payable once on diagnosis of a Terminal Illness.",
  "Claims: notify Kestrel Life Ltd of a death within 6 months, with the death certificate.",
].join("\n");
const TRAVEL_P1 = [
  "Falcon General - Single Trip Travel Insurance - Policy Schedule",
  "Insured Person: Wong Jia Hui, Adrian",
  "Period of Insurance: 10/03/2025 to 17/03/2025",
  "Destination: Indonesia",
  "Accidental Death: S$100,000",
].join("\n");

const both = [{ id: M.adrian.id }, { id: M.cheryl.id }];
export const DOCS: FxDoc[] = [
  { key: "CERT", id: id(101), owner: M.adrian.id, members: both, insurer: "Kestrel Life Ltd", product: "Public Officers Group Insurance Scheme - Certificate", policyNumber: "KPA-310046", groupPolicyNumber: "KP-2207", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:livelib-cert", effective: "2022-10-06", documentDate: "2022-10-06", pages: { 1: CERT_P1 } },
  { key: "SUMMARY", id: id(102), owner: M.adrian.id, members: both, insurer: "KestrelOne", product: "Public Officers Group Personal Accident - Summary of Benefits", policyNumber: "KPA-310046", groupPolicyNumber: "KP-2207", policyType: "Personal accident", role: "benefit_summary", personal: false, hash: "sha256:livelib-summary", pages: { 5: SUM_P5, 9: SUM_P9, 13: SUM_P13 } },
  { key: "WORDING", id: id(103), owner: M.adrian.id, members: both, insurer: "Kestrel Life Ltd", product: "Public Officers Group Personal Accident - Policy Wording", policyNumber: "KPA-310046", groupPolicyNumber: "KP-2207", policyType: "Personal accident", role: "policy_wording", personal: false, hash: "sha256:livelib-wording", pages: { 1: WORD_P1, 2: WORD_P2, 3: WORD_P3 } },
  { key: "GTL_SUM", id: id(104), owner: M.adrian.id, members: both, insurer: "Kestrel Life Ltd", product: "Public Officers Group Term Life - Product Summary", policyNumber: "KPT-310045", groupPolicyNumber: "KP-2207", policyType: "Term life", role: "product_summary", personal: false, hash: "sha256:livelib-gtl", pages: { 1: GTL_P1 } },
  { key: "TRAVEL", id: id(105), owner: M.adrian.id, members: [{ id: M.adrian.id }], insurer: "Falcon General", product: "Single Trip Travel Insurance - Policy Schedule", policyNumber: "FG-TRV-77120", policyType: "Travel", role: "schedule", personal: true, hash: "sha256:livelib-travel", effective: "2025-03-10", expiry: "2025-03-17", documentDate: "2025-03-01", pages: { 1: TRAVEL_P1 } },
  { key: "SCAN", id: id(106), owner: M.adrian.id, members: [], insurer: "", product: "", policyNumber: null, policyType: "", role: "", personal: false, hash: "sha256:livelib-scan", processing: "failed", processingError: UNREADABLE_PHOTO_MESSAGE, filename: "IMG_0042.jpg", pages: {} },
  { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.otherAdrian.id, members: [{ id: M.otherAdrian.id }], insurer: "Kestrel Life Ltd", product: "Public Officers Group Insurance Scheme - Certificate", policyNumber: "KPA-399999", groupPolicyNumber: "KP-2207", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:livelib-other", pages: { 1: CERT_P1.replace(/Wong Jia Hui, Adrian/g, "Wong, Adrian").replace(/S\$1,000,000/g, "S$2,000,000") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

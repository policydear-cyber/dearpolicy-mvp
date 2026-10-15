/**
 * V1.5 (live verification after PR #50, 15 Oct 2026): the live library's STRUCTURE as the report describes it, with
 * every name, identifier and amount that is not material replaced by placeholders (the live records were not read from
 * this session -- production access is not authorised -- so this follows the report, not the database).
 *
 *  report (live)                                         fixture
 *  six active uploads: five ready, one failed            CERT, SUMMARY, WORDING (insurer \"Kestrel\"), TRAVEL_WORDING,
 *                                                        TRAVEL_SUMMARY (insurer \"Harbourline\", linked to nobody),
 *                                                        SCAN (failed, linked to nobody)
 *  three members, the third with no documents            Adrian, Cheryl, Ethan (no documents)
 *  certificate: complete tab-separated rows under        CERT: Term Life S$1,000,000, PA S$600,000 for both adults,
 *  product headings, as of 06/10/2022                    as of 06/10/2022
 *  summary page 13: Simple Fracture Benefit Limit        SUMMARY p13, PLAIN-TEXT layout (single spaces, as text is
 *  S$5,000; \"(% of S$5,000)\"; Skull 100%, Hip 75%,       read from a PDF): the limit line, the \"% of S$5,000\" header,
 *  Jaw, Pelvis, Leg, Ankle or Knee 50%                   Skull 100%, Hip 75%, Leg row 50%, ...
 *  a \"• Death due to Accident\" label in the summary     SUMMARY p9: a Compassionate Death Allowance section listing
 *                                                        \"• Death due to Accident\" / \"• Death due to Illness\"
 *  the travel insurer's wording: a 90-day condition      TRAVEL_WORDING p1
 *  the uploads' file names (not in the report)           HYPOTHESIS variants: snake_case and UUID-style file names
 *                                                        (the shapes phones and download tools produce)
 * Not material and therefore invented: policy numbers, masked ids, the Compassionate Death Allowance wording.
 */
import type { FxDoc, FxMember } from "../rag2/household";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/documents/processing-errors";

export const ACCOUNT = "00000000-0000-0000-0000-00000000e801";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000e802";
const id = (n: number) => "7e800000-0000-4000-8000-" + String(n).padStart(12, "0");
export const M = {
  adrian: { id: id(1), name: "Adrian Wong Jia Hui", pref: "Adrian", rel: "self", notes: null, dob: "1978-02-11" },
  cheryl: { id: id(2), name: "Cheryl Lim Pei Shan", pref: "Cheryl", rel: "spouse", notes: "wife", dob: "1980-07-30" },
  ethan: { id: id(3), name: "Ethan Wong Kai Le", pref: "Ethan", rel: "child", notes: "son", dob: "2012-05-04" },
  otherAdrian: { id: id(9), name: "Adrian Wong", pref: "Adrian", rel: "self", notes: null, dob: "1969-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const T = "\t";
const row = (masked: string, name: string, amount: string) => [masked, name, amount, "As of", "06/10/2022"].join(T);
export const CERT_P1 = [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Kestrel Life Ltd.\" for cover(s) as indicated:",
  "PUBLIC OFFICERS GROUP INSURANCE SCHEME (GROUP POLICY NO. KP-4410)   Page 1 of 1",
  ["Product, Policy Number, Particulars of Insured Person(s) and Sum Assured", "Effective Date"].join(T),
  "GROUP TERM LIFE(POLICY NO.KPT-520011)",
  row("S****604D", "Wong Jia Hui, Adrian", "S$1,000,000"),
  row("S****917H", "Lim Pei Shan, Cheryl", "S$1,000,000"),
  "GROUP PERSONAL ACCIDENT(POLICY NO. KPA-520012)",
  row("S****604D", "Wong Jia Hui, Adrian", "S$600,000"),
  row("S****917H", "Lim Pei Shan, Cheryl", "S$600,000"),
].join("\n");
export const SUM_P9 = [
  "KestrelOne Public Officers Group Personal Accident - Summary of Benefits Page 8 of 36",
  "Section A - Death and Disablement",
  "Accidental Death: 100% of the Sum Insured.",
  "Permanent Dismemberment: up to 100% of the Sum Insured according to the Scale of Compensation, if the loss occurs within 365 days of the Accident.",
  "Section B - Compassionate Death Allowance",
  "Compassionate Death Allowance: S$3,000 per enrolled Insured Person, payable on",
  "• Death due to Accident",
  "• Death due to Illness",
  "The allowance applies only to Insured Persons enrolled for it under the scheme's optional cover.",
].join("\n");
/** The live page as plain text: single spaces between a row's label and its percentage. */
export const SUM_P13 = [
  "KestrelOne Public Officers Group Personal Accident - Summary of Benefits Page 12 of 36",
  "Section D - Simple Fracture",
  "Simple Fracture Benefit Limit: S$5,000",
  "We will pay the percentage of the Simple Fracture Benefit Limit shown below for a Simple Fracture of a nature listed, caused by an Accident.",
  "Bone fractured Compensation (% of S$5,000)",
  "Skull 100%",
  "Hip 75%",
  "Jaw, Pelvis, Leg, Ankle or Knee 50%",
  "Arm, Wrist or Elbow 40%",
  "Collarbone or Rib 20%",
  "Finger or Toe 10%",
].join("\n");
export const WORD_P1 = [
  "Kestrel Life Ltd - Public Officers Group Personal Accident - Policy Wording (Group Policy No. KP-4410)",
  "Section 6 - Other Fracture",
  "Other Fracture means a fracture that is not a Simple Fracture, including a compound (open) fracture. We will pay the percentage of the Sum Insured shown below.",
  "Bone fractured Compensation (% of Sum Insured)",
  "Skull (Other Fracture) 100%",
  "Hip (Other Fracture) 75%",
  "Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture) 50%",
].join("\n");
export const WORD_P2 = [
  "Section 2 - Definitions",
  "Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means.",
  "Simple Fracture means a closed fracture where the skin is not broken.",
  "Sum Insured means the amount shown for the Insured Person under Group Personal Accident in the Certificate of Group Insurance.",
].join("\n");
export const TRAVEL_W1 = [
  "Harbourline General Insurance Pte. Ltd. - Travel Insurance - Policy Wording",
  "Section 1 - Accidental Death",
  "We will pay the Accidental Death benefit shown in your Schedule if you die within 90 days of an Accident during your Journey.",
  "This wording applies only to a Journey shown in a Schedule issued to you.",
].join("\n");
export const TRAVEL_S1 = [
  "Harbourline General Insurance Pte. Ltd. - Travel Insurance - Benefit Summary",
  "Plans: Classic, Premier",
  "Accidental Death: as shown in the Schedule for the plan chosen",
].join("\n");

/** File names: the report does not give them. `names(\"plain\" | \"snake\" | \"uuid\")` -- the hypothesis variants. */
export type NameVariant = "plain" | "snake" | "uuid";
export const FILES: Record<NameVariant, { travelWording: string; travelSummary: string; scan: string }> = {
  plain: { travelWording: "Travel Wording.pdf", travelSummary: "Travel Benefit Summary.pdf", scan: "Photo of letter.jpg" },
  snake: { travelWording: "travel_policy_wording_2024.pdf", travelSummary: "travel_benefit_summary.pdf", scan: "scan_20241003_153045.jpg" },
  uuid: { travelWording: "3f2b8c1e-9a7d-4c2e-8b1a-1234567890ab.pdf", travelSummary: "77c0e2d4-1b3a-4f5e-9c8d-aa00bb11cc22.pdf", scan: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.jpg" },
};
const both = [{ id: M.adrian.id }, { id: M.cheryl.id }];
export function docsFor(v: NameVariant): FxDoc[] {
  const f = FILES[v];
  return [
    { key: "CERT", id: id(101), owner: M.adrian.id, members: both, insurer: "Kestrel Life Ltd", product: "Public Officers Group Insurance Scheme - Certificate", policyNumber: "KPA-520012", groupPolicyNumber: "KP-4410", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:pr50-cert", effective: "2022-10-06", documentDate: "2022-10-06", pages: { 1: CERT_P1 } },
    { key: "SUMMARY", id: id(102), owner: M.adrian.id, members: both, insurer: "KestrelOne", product: "Public Officers Group Personal Accident - Summary of Benefits", policyNumber: "KPA-520012", groupPolicyNumber: "KP-4410", policyType: "Personal accident", role: "benefit_summary", personal: false, hash: "sha256:pr50-summary", pages: { 9: SUM_P9, 13: SUM_P13 } },
    { key: "WORDING", id: id(103), owner: M.adrian.id, members: both, insurer: "Kestrel Life Ltd", product: "Public Officers Group Personal Accident - Policy Wording", policyNumber: "KPA-520012", groupPolicyNumber: "KP-4410", policyType: "Personal accident", role: "policy_wording", personal: false, hash: "sha256:pr50-wording", pages: { 1: WORD_P1, 2: WORD_P2 } },
    { key: "TRAVEL_WORDING", id: id(104), owner: M.adrian.id, members: [], insurer: "Harbourline General Insurance Pte. Ltd.", product: "Travel Insurance - Policy Wording", policyNumber: null, policyType: "Travel", role: "policy_wording", personal: false, hash: "sha256:pr50-travel-wording", filename: f.travelWording, pages: { 1: TRAVEL_W1 } },
    { key: "TRAVEL_SUMMARY", id: id(105), owner: M.adrian.id, members: [], insurer: "Harbourline General Insurance Pte. Ltd.", product: "Travel Insurance - Benefit Summary", policyNumber: null, policyType: "Travel", role: "benefit_summary", personal: false, hash: "sha256:pr50-travel-summary", filename: f.travelSummary, pages: { 1: TRAVEL_S1 } },
    { key: "SCAN", id: id(106), owner: M.adrian.id, members: [], insurer: "", product: "", policyNumber: null, policyType: "", role: "", personal: false, hash: "sha256:pr50-scan", processing: "failed", processingError: UNREADABLE_PHOTO_MESSAGE, filename: f.scan, pages: {} },
    // Not eligible: a deleted upload and another household's certificate.
    { key: "DELETED", id: id(107), owner: M.adrian.id, members: [], insurer: "Kestrel Life Ltd", product: "Old Benefit Summary (deleted)", policyNumber: null, policyType: "Personal accident", role: "benefit_summary", personal: false, hash: "sha256:pr50-deleted", lifecycle: "soft_deleted", pages: { 1: "Old Benefit Summary (deleted)" } },
    { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.otherAdrian.id, members: [{ id: M.otherAdrian.id }], insurer: "Kestrel Life Ltd", product: "Public Officers Group Insurance Scheme - Certificate (other household)", policyNumber: "KPA-599999", groupPolicyNumber: "KP-4410", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:pr50-other", pages: { 1: CERT_P1.replace(/Wong Jia Hui, Adrian/g, "Wong, Adrian") } },
  ];
}
export const DOCS = docsFor((process.env.PR50_NAMES as NameVariant) || "plain");
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;
/** The documents an inventory must list (household, active, not superseded). */
export const ELIGIBLE = ["CERT", "SUMMARY", "WORDING", "TRAVEL_WORDING", "TRAVEL_SUMMARY", "SCAN"];

/**
 * Reliable chat: the SECOND synthetic household (H2 "Tan"), unrelated to H1 (scripts/fixtures/rag2-pr50) -- different
 * insurer, people, layout and figures, and a percentage schedule whose base is the PERSON'S OWN SUM INSURED (H1's is a
 * fixed S$5,000 limit). Space-separated tables (H1's are tabbed), a policy schedule roster with two insured persons, a
 * daily Hospital Income rate (the hospital-day control), a superseded wording with a different percentage, and another
 * household holding the same product. Every name, number and identifier is invented.
 */
import type { FxDoc, FxMember } from "../rag2/household";

export const ACCOUNT = "00000000-0000-0000-0000-00000000f201";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000f202";
const id = (n: number) => "7f200000-0000-4000-8000-" + String(n).padStart(12, "0");
export const M = {
  meiling: { id: id(1), name: "Tan Mei Ling", pref: "Mei Ling", rel: "self", notes: null, dob: "1983-04-17" },
  wei: { id: id(2), name: "Lee Wei Ming", pref: "Wei", rel: "spouse", notes: "husband", dob: "1981-11-02" },
  jun: { id: id(3), name: "Lee Jun Kai", pref: "Jun", rel: "child", notes: "son", dob: "2016-09-12" },
  otherJun: { id: id(9), name: "Lee Jun Kai", pref: "Jun", rel: "child", notes: null, dob: "2015-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const G = "     "; // space-separated cells (5 spaces)
export const SCHEDULE_P1 = [
  "AURORA ASSURANCE PTE. LTD.",
  "Policy Schedule",
  "Period of Insurance: 01/03/2026 to 28/02/2027",
  ["Insured Person", "Relationship", "Sum Insured"].join(G),
  "FAMILYGUARD PERSONAL ACCIDENT (POLICY NO. FG-778201)",
  ["Tan Mei Ling", "Policyholder", "S$200,000"].join(G),
  ["Lee Jun Kai", "Child", "S$100,000"].join(G),
].join("\n");
export const WORDING_P1 = [
  "Aurora Assurance Pte. Ltd. - FamilyGuard Personal Accident - Policy Wording (Policy No. FG-778201)",
  "",
  "Section 3 - Fracture Benefit",
  "If an Insured Person suffers a Fracture caused by an Accident and confirmed by X-ray, we will pay the percentage of the Sum Insured shown below for the bone fractured.",
  ["Bone fractured", "Benefit (% of Sum Insured)"].join("                              "),
  ["Leg - thigh bone (femur)", "20%"].join("                    "),
  ["Leg - below the knee (tibia or fibula)", "10%"].join("      "),
  ["Wrist", "5%"].join("                                       "),
  ["Finger or toe", "2%"].join("                               "),
].join("\n");
export const WORDING_P2 = [
  "Section 5 - Hospital Income",
  "Hospital Income: S$100 per day, for each complete period of 24 hours in hospital following an Accident, up to 30 days per Accident.",
  "",
  "Section 6 - Child Education Benefit",
  "Child Education Benefit: $5,000 per child, payable only for a child of the Insured Person who is under 18 when the Insured Person dies in an Accident.",
  "",
  "Section 1 - Accidental Death",
  "Accidental Death: 100% of the Sum Insured, if death occurs within 12 months of the Accident.",
].join("\n");
/** The superseded edition: the same section with a different percentage -- never to be used. */
export const OLD_WORDING_P1 = WORDING_P1.replace("10%", "15%").replace("Policy Wording (Policy No. FG-778201)", "Policy Wording 2023 edition (Policy No. FG-778201)");

const meiAndJun = [{ id: M.meiling.id }, { id: M.jun.id }];
export const DOCS: FxDoc[] = [
  { key: "SCHEDULE", id: id(101), owner: M.meiling.id, members: meiAndJun, insurer: "Aurora Assurance Pte. Ltd.", product: "FamilyGuard Personal Accident - Policy Schedule", policyNumber: "FG-778201", policyType: "Personal accident", role: "schedule", personal: true, hash: "sha256:tan-schedule", effective: "2026-03-01", expiry: "2027-02-28", documentDate: "2026-02-20", filename: "familyguard_schedule_2026.pdf", pages: { 1: SCHEDULE_P1 } },
  { key: "WORDING", id: id(102), owner: M.meiling.id, members: meiAndJun, insurer: "Aurora Assurance Pte. Ltd.", product: "FamilyGuard Personal Accident - Policy Wording", policyNumber: "FG-778201", policyType: "Personal accident", role: "policy_wording", personal: false, hash: "sha256:tan-wording-2026", pages: { 1: WORDING_P1, 2: WORDING_P2 } },
  { key: "OLD_WORDING", id: id(103), owner: M.meiling.id, members: meiAndJun, insurer: "Aurora Assurance Pte. Ltd.", product: "FamilyGuard Personal Accident - Policy Wording (2023)", policyNumber: "FG-778201", policyType: "Personal accident", role: "policy_wording", personal: false, hash: "sha256:tan-wording-2023", superseded: true, pages: { 1: OLD_WORDING_P1 } },
  { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.otherJun.id, members: [{ id: M.otherJun.id }], insurer: "Aurora Assurance Pte. Ltd.", product: "FamilyGuard Personal Accident - Policy Schedule", policyNumber: "FG-990001", policyType: "Personal accident", role: "schedule", personal: true, hash: "sha256:tan-other", pages: { 1: SCHEDULE_P1.replace("FG-778201", "FG-990001").replace("Tan Mei Ling", "Ong Siew Lan").replace("S$100,000", "S$300,000") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

/**
 * Two synthetic households for npm run rag2:conv-test (agent C). Every insurer, product, person and figure is invented
 * and differs from the rag2 / rag2-loop fixtures, so behaviour is tested as a general rule, not on one family's words.
 *
 *  TAN  -- a shared household login: TWO members recorded as self (Wei Ming and Hui Ling), so who is typing is unknown
 *          until they say; a daughter and a stepdaughter; two hospital plans with different deductibles (so "my
 *          deductible" depends on the speaker); an accident plan whose wording excludes sickness, with a benefit table
 *          that continues onto page 2 without repeating its header, and a footnoted fracture clause.
 *  RAHMAN -- one member recorded as self; a son and a stepson; a mother and a stepmother; a children's accident plan.
 */
import { row, type FxDoc, type FxMember } from "../rag2/household";

export const TAN = "00000000-0000-0000-0000-00000000c301";
export const RAHMAN = "00000000-0000-0000-0000-00000000c302";
const id = (n: number) => "73000000-0000-4000-8000-" + String(n).padStart(12, "0");

export const T = {
  weiming: { id: id(1), name: "Tan Wei Ming", pref: "Wei Ming", rel: "self", notes: "father", dob: "1981-02-17", account: TAN },
  huiling: { id: id(2), name: "Lim Hui Ling", pref: "Hui Ling", rel: "self", notes: "mother", dob: "1983-09-04", account: TAN },
  xinyi: { id: id(3), name: "Tan Xin Yi", pref: "Xin Yi", rel: "child", notes: "daughter", dob: "2015-06-30", account: TAN },
  chloe: { id: id(4), name: "Chloe Ng Shi Min", pref: "Chloe", rel: "child", notes: "stepdaughter", dob: "2012-12-01", account: TAN },
} satisfies Record<string, FxMember>;
export const R = {
  rahman: { id: id(11), name: "Rahman bin Ali", pref: "Rahman", rel: "self", notes: null, dob: "1979-05-20", account: RAHMAN },
  siti: { id: id(12), name: "Siti Nurhaliza binte Osman", pref: "Siti", rel: "spouse", notes: "wife", dob: "1982-01-11", account: RAHMAN },
  adam: { id: id(13), name: "Adam bin Rahman", pref: "Adam", rel: "child", notes: "son", dob: "2013-03-03", account: RAHMAN },
  danish: { id: id(14), name: "Danish Iskandar", pref: "Danish", rel: "child", notes: "stepson", dob: "2011-08-08", account: RAHMAN },
  aminah: { id: id(15), name: "Aminah binte Yusof", pref: null, rel: "parent", notes: "mother", dob: "1950-07-07", account: RAHMAN },
  zainab: { id: id(16), name: "Zainab binte Harun", pref: null, rel: "parent", notes: "stepmother", dob: "1958-10-10", account: RAHMAN },
} satisfies Record<string, FxMember>;

const W = [46, 18, 18];
const BRIGHT_P1 = [
  "Kestrel Point General Insurance Pte Ltd",
  "BrightStar Family Accident Plan - Schedule",
  "Policy number KP-FA-55120   Period 01 May 2026 to 30 Apr 2027",
  "",
  "Insured persons: Tan Wei Ming (adult); Lim Hui Ling (adult); Tan Xin Yi (child); Chloe Ng Shi Min (child)",
  "",
  row(["Benefit", "Adult", "Child"], W),
  row(["Accidental death", "S$150,000", "S$40,000"], W),
  row(["Medical expenses per accident", "S$2,500", "S$1,200"], W),
  row(["Hospital income per complete day", "S$90", "S$70"], W),
].join("\n");
// Page 2: the benefit table continues straight on (no header row), then the wording.
const BRIGHT_P2 = [
  "BrightStar Family Accident Plan (continued)",
  row(["Ambulance and transport", "S$400", "S$250"], W),
  row(["Dental repair after injury", "S$600", "S$300"], W),
  "",
  "This plan pays for bodily injury caused solely by an Accident. Sickness or disease of any kind is not covered.",
  "Fractures are reimbursed under Medical expenses up to S$600 for each fracture.*",
  "Hospital income is paid for each complete day of confinement, counted from admission.",
  "",
  "* The fracture benefit requires an X-ray report confirming the fracture.",
].join("\n");
const CARE_HL = [
  "Juniper Health Assurance",
  "CareShield Hospital Plan - Policy Schedule",
  "Life assured: Lim Hui Ling",
  "",
  "Benefit\tLimit",
  "Deductible (per policy year)\tS$2,000",
  "Co-insurance\t10%",
].join("\n");
const CARE_WM = [
  "Juniper Health Assurance",
  "CareShield Hospital Plan - Policy Schedule",
  "Life assured: Tan Wei Ming",
  "",
  "Benefit\tLimit",
  "Deductible (per policy year)\tS$3,000",
  "Co-insurance\t5%",
].join("\n");
const KIDS_P1 = [
  "Harbour Crest Insurance",
  "Horizon Kids Accident Cover - Schedule",
  "Cover period 01 Jan 2026 to 31 Dec 2026",
  "",
  row(["Insured person", "Category"], [30]),
  row(["Adam bin Rahman", "Insured Child"], [30]),
  row(["Danish Iskandar", "Insured Child"], [30]),
  "",
  row(["Benefit", "Insured Child"], [40]),
  row(["Accidental medical reimbursement", "S$2,000"], [40]),
  row(["Fracture benefit (per fracture)", "S$500"], [40]),
  "",
  "Injuries must result from an accident; illness is excluded.",
].join("\n");
const SHIELD_R = [
  "Harbour Crest Insurance",
  "Integrated Ward Plan - Schedule",
  "Life assured: Rahman bin Ali",
  "",
  "Benefit\tLimit",
  "Annual deductible (Class B1)\tS$3,750",
].join("\n");

const base = { personal: true, role: "schedule" } as const;
export const CONV_DOCS: FxDoc[] = [
  { ...base, key: "BRIGHT", id: id(101), account: TAN, owner: T.weiming.id, members: [{ id: T.weiming.id }, { id: T.huiling.id }, { id: T.xinyi.id }, { id: T.chloe.id }], insurer: "Kestrel Point General Insurance", product: "BrightStar Family Accident Plan", policyNumber: "KP-FA-55120", policyType: "Personal Accident", hash: "sha256:conv-bright", effective: "2026-05-01", expiry: "2027-04-30", pages: { 1: BRIGHT_P1, 2: BRIGHT_P2 } },
  { ...base, key: "CARE_HL", id: id(102), account: TAN, owner: T.huiling.id, members: [{ id: T.huiling.id }], insurer: "Juniper Health Assurance", product: "CareShield Hospital Plan (Hui Ling)", policyNumber: "JH-CS-1001", policyType: "Integrated Shield", hash: "sha256:conv-care-hl", pages: { 1: CARE_HL } },
  { ...base, key: "CARE_WM", id: id(103), account: TAN, owner: T.weiming.id, members: [{ id: T.weiming.id }], insurer: "Juniper Health Assurance", product: "CareShield Hospital Plan (Wei Ming)", policyNumber: "JH-CS-1002", policyType: "Integrated Shield", hash: "sha256:conv-care-wm", pages: { 1: CARE_WM } },
  { ...base, key: "KIDS", id: id(111), account: RAHMAN, owner: R.rahman.id, members: [{ id: R.adam.id }, { id: R.danish.id }], insurer: "Harbour Crest Insurance", product: "Horizon Kids Accident Cover", policyNumber: "HC-KA-2026", policyType: "Personal Accident", hash: "sha256:conv-kids", effective: "2026-01-01", expiry: "2026-12-31", pages: { 1: KIDS_P1 } },
  { ...base, key: "SHIELD_R", id: id(112), account: RAHMAN, owner: R.rahman.id, members: [{ id: R.rahman.id }], insurer: "Harbour Crest Insurance", product: "Integrated Ward Plan", policyNumber: "HC-IW-77", policyType: "Integrated Shield", hash: "sha256:conv-shield-r", pages: { 1: SHIELD_R } },
];
export const CONV_MEMBERS: FxMember[] = [...Object.values(T), ...Object.values(R)];

/**
 * Synthetic household for scripts/rag2-tools-regressions.ts (npm run rag2:tools-test). Every insurer, product, person
 * and number here is invented for this suite (no overlap with the eval sets). Pages are stored text as ingestion
 * stores it: space-aligned columns (pdftotext-style) or tab-separated cells.
 */

/** Pads cells into fixed-width columns (at least three spaces between cells, as a PDF text layer prints them). */
export function row(cells: string[], widths: number[], indent = 0): string {
  return " ".repeat(indent) + cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(Math.max(widths[i] ?? 0, c.length + 3)))).join("").replace(/\s+$/, "");
}
const W3 = [48, 21, 21];

export const ACCOUNT = "00000000-0000-0000-0000-00000000a201";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000a202";
const id = (n: number) => "72000000-0000-4000-8000-" + String(n).padStart(12, "0");

export type FxMember = { id: string; name: string; pref: string | null; rel: string; notes: string | null; dob: string | null; account?: string };
export const M = {
  darren: { id: id(1), name: "Darren Koh Wen Jie", pref: "Darren", rel: "self", notes: null, dob: "1984-03-02" },
  melissa: { id: id(2), name: "Melissa Teo Shu Hui", pref: "Melissa", rel: "spouse", notes: "wife", dob: "1986-08-14" },
  yixuan: { id: id(3), name: "Koh Yi Xuan", pref: "Yi Xuan", rel: "child", notes: "daughter", dob: "2014-05-09" },
  junhao: { id: id(4), name: "Koh Jun Hao", pref: "Jun Hao", rel: "child", notes: "son", dob: "2017-01-30" },
  ryan: { id: id(5), name: "Ryan Lim Zhi Hao", pref: "Ryan", rel: "child", notes: "stepson", dob: "2010-06-21" },
  ahmui: { id: id(6), name: "Teo Ah Mui", pref: null, rel: "parent", notes: "mother-in-law", dob: "1958-11-03" },
  rosalind: { id: id(7), name: "Rosalind Dela Cruz", pref: "Rosa", rel: "other", notes: "domestic helper", dob: "1990-02-11" },
  stranger: { id: id(8), name: "Okafor Bright Chidi", pref: "Bright", rel: "self", notes: null, dob: "1979-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

export type FxDoc = {
  key: string; id: string; owner: string; members: { id: string; tier?: string | null }[]; insurer: string; product: string; policyNumber: string | null; groupPolicyNumber?: string | null;
  policyType: string; role: string; personal: boolean; hash: string; effective?: string | null; expiry?: string | null; documentDate?: string | null;
  lifecycle?: string; quarantine?: string; superseded?: boolean; account?: string; pages: Record<number, string>;
  /** processing_status (default 'ready') and processing_error: an upload that could not be read. */
  processing?: string; processingError?: string | null; filename?: string;
};

const PA_P1 = [
  row(["Selvane Assurance Pte Ltd", "Policy SV-PA-771204"], [72]),
  "FamilyGuard Personal Accident - Policy Schedule",
  "",
  row(["Policy number", "SV-PA-771204"], [34]),
  row(["Policyholder", "Darren Koh Wen Jie"], [34]),
  row(["Period of insurance", "01 Mar 2026 to 28 Feb 2027"], [34]),
  row(["Annual premium", "S$612.00"], [34]),
  "",
  "Insured persons",
  row(["Name", "Category", "Date of birth"], [34, 22]),
  row(["Darren Koh Wen Jie", "Insured Adult", "02 Mar 1984"], [34, 22]),
  row(["Melissa Teo Shu Hui", "Insured Adult", "14 Aug 1986"], [34, 22]),
  row(["Koh Yi Xuan", "Insured Child", "09 May 2014"], [34, 22]),
  row(["Koh Jun Hao", "Insured Child", "30 Jan 2017"], [34, 22]),
  row(["Ryan Lim Zhi Hao", "Insured Child", "21 Jun 2010"], [34, 22]),
  "",
  "Schedule of benefits",
  row(["Benefit", "Insured Adult", "Insured Child"], W3),
  row(["Accidental death & permanent disablement", "S$200,000", "S$50,000"], W3),
  row(["Accidental medical expenses (per policy year)", "S$3,000", "S$1,500"], W3),
  row(["of which physiotherapy / TCM", "S$500", "S$300"], [47, 21, 21], 1),
  row(["Hospital cash (max 30 days)", "S$100 per day", "S$100 per day"], W3),
  row(["Mobility aids", "S$500", "S$500"], W3),
  row(["Ambulance fees", "S$300", "S$300"], W3),
  "",
  "Accidental medical expenses is an aggregate limit per insured person per policy year; every claim paid reduces it.",
  "",
  row(["", "Page 1 of 2"], [74]),
].join("\n");
const PA_P2 = [
  row(["Selvane Assurance Pte Ltd", "Policy SV-PA-771204"], [72]),
  "Eligibility and exclusions",
  "Children are covered up to age 18, or 25 in full-time education. Illness of any kind is excluded.",
  "Note: claims for fractures are paid under accidental medical expenses up to S$800 per fracture.",
  "Physiotherapy must be prescribed by a registered medical practitioner within 30 days of the accident.",
].join("\n");

const CI_P1 = [
  "Quorvine Life Assurance\tPolicy QL-CI-209931",
  "CritiCare Multipay - Benefit Schedule",
  "Life assured: Melissa Teo Shu Hui",
  "Sum assured: S$150,000",
  "Policy period 15 Apr 2025 to 14 Apr 2045",
  "",
  "Stage\tCondition group\t%\tAmount payable",
  "Early\tCancer, heart attack, stroke (early stage)\t25%\tS$37,500",
  "Intermediate\tCancer, heart attack, stroke (intermediate stage)\t50%\tS$75,000",
  "Severe\tMajor cancer, heart attack, stroke (severe stage)\t100%\tS$150,000",
  "Special\tAngioplasty for coronary artery disease\t10%\tS$15,000",
  "",
  "Each stage is payable once per condition group; total claims are capped at 300% of the sum assured.",
].join("\n");

const GW = [38, 16, 16];
const GHS_P1 = [
  row(["Ardent Peak Holdings Pte Ltd", "HR-BEN-2026"], [66]),
  "Employee Benefits Booklet 2026 - Group Hospital & Surgical (policy AP-GHS-5521)",
  "Plan year 01 Jan 2026 to 31 Dec 2026",
  "",
  "Schedule of benefits",
  row(["Benefit", "Employee", "Spouse", "Child"], GW),
  row(["Daily room & board (max 120 days)", "S$600", "S$400", "S$300"], GW),
  row(["Intensive care unit (max 30 days)", "S$1,200", "S$800", "S$600"], GW),
  row(["Surgical fees (per operation)", "S$8,000", "S$6,000", "S$4,000"], GW),
  "",
  row(["", "Page 1 of 2"], [66]),
].join("\n");
const GHS_P2 = [
  row(["Ardent Peak Holdings Pte Ltd", "HR-BEN-2026"], [66]),
  "",
  row(["Benefit", "Employee", "Spouse", "Child"], GW),
  row(["Outpatient cancer treatment", "S$20,000", "S$15,000", "S$10,000"], GW),
  row(["Pre- and post-hospital treatment", "S$1,500", "S$1,000", "S$800"], GW),
  "",
  "Dependants are covered only if enrolled. See your Enrolment Confirmation.",
].join("\n");
const ENROL_P1 = [
  "Ardent Peak Holdings Pte Ltd",
  "Enrolment Confirmation - Group Hospital & Surgical (policy AP-GHS-5521)",
  "Employee: Darren Koh Wen Jie",
  "Dependants enrolled:",
  row(["Melissa Teo Shu Hui", "Spouse", "enrolled 01 Jan 2026"], [27, 14]),
  row(["Koh Yi Xuan", "Child", "enrolled 01 Jan 2026"], [27, 14]),
].join("\n");

const TERM_P1 = [
  "Tidewell Insurance Ltd",
  "TermSecure - Policy Schedule",
  "Policy number: TW-TL-440187",
  "Life assured: Darren Koh Wen Jie",
  "Effective date: 10 Jan 2024",
  "Policy term 10 Jan 2024 to 09 Jan 2054",
  "",
  "Benefit\tSum assured",
  "Death\tS$500,000",
  "Total and permanent disability\tS$500,000",
  "Annual premium\tS$1,380.00",
].join("\n");
const ENDT_P1 = [
  "Tidewell Insurance Ltd",
  "Endorsement No. 2 to policy TW-TL-440187",
  "Effective date: 01 Jul 2026",
  "The sum assured is hereby amended as follows.",
  "",
  "Benefit\tBefore\tAfter",
  "Death\tS$500,000\tS$350,000",
  "Total and permanent disability\tS$500,000\tS$350,000",
].join("\n");

const HW = [31, 15, 15];
const CASH_P1 = [
  "Mistral Bay General Insurance",
  "DailyCare Hospital Cash - Schedule",
  "Insured persons: Darren Koh Wen Jie (adult); Koh Jun Hao (child)",
  "Cover period 01 Feb 2026 to 31 Jan 2027",
  row(["Benefit", "Child", "Adult"], HW),
  row(["Hospital cash per day", "S$80", "S$150"], HW),
  row(["ICU cash per day", "S$160", "S$300"], HW),
  row(["Maximum days per admission", "30 days", "60 days"], HW),
].join("\n");
// Page 2 continues the same table straight on, without repeating its header.
const CASH_P2 = [
  "Mistral Bay General Insurance - DailyCare Hospital Cash (continued)",
  row(["Recuperation benefit per day", "S$50", "S$100"], HW),
  row(["Maximum recuperation days", "10 days", "14 days"], HW),
  "",
  "Hospital cash is payable from the first full day of admission.",
].join("\n");

const OW = [37, 15, 14, 15];
const OUTPT_P1 = [
  "Tidewell Insurance Ltd",
  "OutpatientPlus - Schedule of Benefits",
  "Insured: Melissa Teo Shu Hui (adult); Koh Yi Xuan (child)",
  "Period of cover 01 Jan 2026 to 31 Dec 2026",
  "",
  row(["Insured Adult", "Insured Child"], [29], 37),
  row(["Benefit", "Limit", "Co-pay", "Limit", "Co-pay"], OW),
  row(["Specialist consultation", "S$1,000", "10%", "S$600", "10%"], OW),
  row(["Outpatient fracture treatment", "S$2,500", "20%", "S$1,200", "10%"], OW),
].join("\n");

const DENTAL_P1 = [
  "Ardent Peak Holdings - Dental Rider",
  "Insured: Darren Koh Wen Jie",
  "Period of cover 01 Jan 2026 to 31 Dec 2026",
  "",
  "Dental benefits",
  row(["Scaling and polishing", "S$150", "S$80"], [27, 13]),
  row(["Fillings", "S$300", "S$200"], [27, 13]),
  "",
  row(["Annual dental limit", "S$500"], [27]),
].join("\n");

const MOTOR_P1 = [
  "Tidewell DriveSafe Motor - Certificate of Insurance",
  "Policyholder: Darren Koh Wen Jie",
  "Vehicle registration no SLX 4821 K; private car",
  "Period of insurance 01 Apr 2026 to 31 Mar 2027",
  row(["Own damage", "Market value"], [27]),
  row(["Personal accident (driver)", "S$20,000"], [27]),
].join("\n");

const LEGACY_P1 = [
  "Quorvine Life Assurance",
  "Legacy Whole Life - Policy Schedule",
  "Policy owner and life assured: Teo Ah Mui",
  "Nominee: Melissa Teo Shu Hui (daughter) 100%",
  "Policy term 01 Jun 2001 to 31 May 2059",
  "",
  "Benefit\tSum assured",
  "Death\tS$80,000",
].join("\n");

const HELPER_P1 = [
  "Mistral Bay General Insurance",
  "HelperCare - Domestic Helper Insurance Schedule",
  "Insured helper: Rosalind Dela Cruz",
  "Employer: Darren Koh Wen Jie",
  "Period of insurance 01 Jan 2024 to 31 Dec 2024",
  "",
  "Benefit\tLimit",
  "Hospital and surgical\tS$15,000",
  "Personal accident\tS$60,000",
].join("\n");

const ZEPHYR = "Zephyrine Mutual - Accident Shield\nInsured: Darren Koh Wen Jie\nBenefit\tInsured Adult\tInsured Child\nAccidental medical expenses\tS$9,999\tS$7,777\nZephyr clause: every physiotherapy session S$999";

export const DOCS: FxDoc[] = [
  { key: "PA", id: id(101), owner: M.darren.id, members: [{ id: M.darren.id }, { id: M.melissa.id }, { id: M.yixuan.id }, { id: M.junhao.id }, { id: M.ryan.id }], insurer: "Selvane Assurance", product: "FamilyGuard Personal Accident", policyNumber: "SV-PA-771204", policyType: "Personal Accident", role: "schedule", personal: true, hash: "sha256:rag2-pa", effective: "2026-03-01", expiry: "2027-02-28", pages: { 1: PA_P1, 2: PA_P2 } },
  { key: "CI", id: id(102), owner: M.melissa.id, members: [{ id: M.melissa.id }], insurer: "Quorvine Life Assurance", product: "CritiCare Multipay", policyNumber: "QL-CI-209931", policyType: "Critical Illness", role: "schedule", personal: true, hash: "sha256:rag2-ci", pages: { 1: CI_P1 } },
  { key: "GHS", id: id(103), owner: M.darren.id, members: [{ id: M.darren.id }, { id: M.melissa.id }, { id: M.yixuan.id }], insurer: "Ardent Peak Holdings", product: "Employee Benefits Booklet 2026", policyNumber: null, groupPolicyNumber: "AP-GHS-5521", policyType: "Group Hospital & Surgical", role: "booklet", personal: false, hash: "sha256:rag2-ghs", pages: { 1: GHS_P1, 2: GHS_P2 } },
  { key: "ENROL", id: id(104), owner: M.darren.id, members: [{ id: M.darren.id }], insurer: "Ardent Peak Holdings", product: "Enrolment Confirmation", policyNumber: "AP-GHS-5521", policyType: "Group Hospital & Surgical", role: "enrolment_confirmation", personal: true, hash: "sha256:rag2-enrol", pages: { 1: ENROL_P1 } },
  { key: "TERM", id: id(105), owner: M.darren.id, members: [{ id: M.darren.id }], insurer: "Tidewell Insurance", product: "TermSecure", policyNumber: "TW-TL-440187", policyType: "Term Life", role: "schedule", personal: true, hash: "sha256:rag2-term", effective: "2024-01-10", pages: { 1: TERM_P1 } },
  { key: "ENDT", id: id(106), owner: M.darren.id, members: [{ id: M.darren.id }], insurer: "Tidewell Insurance", product: "TermSecure Endorsement 2", policyNumber: "TW-TL-440187", policyType: "Term Life", role: "endorsement", personal: true, hash: "sha256:rag2-endt", effective: "2026-07-01", documentDate: "2026-06-15", pages: { 1: ENDT_P1 } },
  { key: "CASH", id: id(107), owner: M.darren.id, members: [{ id: M.darren.id }, { id: M.junhao.id }], insurer: "Mistral Bay General Insurance", product: "DailyCare Hospital Cash", policyNumber: "MB-HC-118230", policyType: "Hospital Cash", role: "schedule", personal: true, hash: "sha256:rag2-cash", pages: { 1: CASH_P1, 2: CASH_P2 } },
  { key: "OUTPT", id: id(108), owner: M.melissa.id, members: [{ id: M.melissa.id }, { id: M.yixuan.id }], insurer: "Tidewell Insurance", product: "OutpatientPlus", policyNumber: "TW-OP-602214", policyType: "Outpatient", role: "schedule", personal: true, hash: "sha256:rag2-outpt", pages: { 1: OUTPT_P1 } },
  { key: "DENTAL", id: id(109), owner: M.darren.id, members: [{ id: M.darren.id }], insurer: "Ardent Peak Holdings", product: "Dental Rider", policyNumber: "AP-DN-7781", policyType: "Dental", role: "schedule", personal: true, hash: "sha256:rag2-dental", pages: { 1: DENTAL_P1 } },
  { key: "MOTOR", id: id(110), owner: M.darren.id, members: [{ id: M.darren.id }], insurer: "Tidewell Insurance", product: "DriveSafe Motor", policyNumber: "TW-MT-339120", policyType: "Motor", role: "certificate", personal: true, hash: "sha256:rag2-motor", pages: { 1: MOTOR_P1 } },
  { key: "LEGACY", id: id(111), owner: M.ahmui.id, members: [{ id: M.ahmui.id }], insurer: "Quorvine Life Assurance", product: "Legacy Whole Life", policyNumber: "QL-WL-010577", policyType: "Whole Life", role: "schedule", personal: true, hash: "sha256:rag2-legacy", pages: { 1: LEGACY_P1 } },
  { key: "HELPER", id: id(112), owner: M.darren.id, members: [{ id: M.rosalind.id }], insurer: "Mistral Bay General Insurance", product: "HelperCare", policyNumber: "MB-DH-550021", policyType: "Domestic Helper", role: "schedule", personal: true, hash: "sha256:rag2-helper", pages: { 1: HELPER_P1 } },
  // Never readable: deleted, pending the safety scan, superseded, another household's.
  { key: "DELETED", id: id(120), owner: M.darren.id, members: [{ id: M.darren.id }, { id: M.yixuan.id }], insurer: "Zephyrine Mutual", product: "Accident Shield (deleted)", policyNumber: "ZM-1", policyType: "Personal Accident", role: "schedule", personal: true, hash: "sha256:rag2-del", lifecycle: "soft_deleted", pages: { 1: ZEPHYR } },
  { key: "PENDING", id: id(121), owner: M.darren.id, members: [{ id: M.darren.id }, { id: M.yixuan.id }], insurer: "Zephyrine Mutual", product: "Accident Shield (pending)", policyNumber: "ZM-2", policyType: "Personal Accident", role: "schedule", personal: true, hash: "sha256:rag2-pend", quarantine: "scan_pending", pages: { 1: ZEPHYR } },
  { key: "OLD", id: id(122), owner: M.darren.id, members: [{ id: M.darren.id }, { id: M.yixuan.id }], insurer: "Zephyrine Mutual", product: "Accident Shield (superseded)", policyNumber: "ZM-3", policyType: "Personal Accident", role: "schedule", personal: true, hash: "sha256:rag2-old", superseded: true, pages: { 1: ZEPHYR } },
  { key: "FOREIGN", id: id(123), owner: M.stranger.id, members: [{ id: M.stranger.id }], insurer: "Zephyrine Mutual", product: "Accident Shield (other household)", policyNumber: "ZM-4", policyType: "Personal Accident", role: "schedule", personal: true, hash: "sha256:rag2-foreign", account: OTHER_ACCOUNT, pages: { 1: ZEPHYR.replace("Darren Koh Wen Jie", "Okafor Bright Chidi") } },
];

/**
 * Synthetic household for the release acceptance suite (scripts/rag2-release-acceptance.ts; npm run rag2:release-test).
 * Authored by hand from the document layouts the live app meets, independently of the implementation: every insurer,
 * scheme, person, masked ID, policy number and amount is invented. The expected facts in the suite are read off these
 * pages, never produced by the code under test.
 *
 *  CERT      a group certificate with NO column header: one insured person per ROW under each product heading
 *            (masked ID | name | sum assured | "As of" | date), the first heading directly under the caption.
 *  PA_WORD   the same scheme's personal accident wording: a schedule of compensation (% of sum insured), the death
 *            clause with its 365-day condition, an explicit racing exclusion, and nothing at all about dental care.
 *  HC        a group hospital-cash roster WITH a header row and TWO amounts per person (Insured person | ID | Daily
 *            benefit | Annual limit | Effective date).
 *  FAMILY    adult / child columns (Bea adult, Cai child).
 *  EMP       employee / spouse columns (Alex employee, Bea spouse).
 *  ENDT      a before / after endorsement of FAMILY (fracture benefit raised from a stated date).
 *  OLD       a superseded earlier certificate (different amounts): never a source.
 *  OTHER     another household's certificate naming a person with Alex's exact name: never visible here.
 */
import { row, type FxDoc, type FxMember } from "../rag2/household";

export const ACCOUNT = "00000000-0000-0000-0000-00000000b701";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000b702";
const id = (n: number) => "7a000000-0000-4000-8000-" + String(n).padStart(12, "0");

export const M = {
  alex: { id: id(1), name: "Alex Goh", pref: "Alex", rel: "self", notes: null, dob: "1984-02-11" },
  bea: { id: id(2), name: "Bea Tan Hui Min", pref: "Bea", rel: "spouse", notes: "wife", dob: "1986-07-23" },
  cai: { id: id(3), name: "Cai Goh Jun Le", pref: "Cai", rel: "child", notes: "son", dob: "2016-05-02" },
  otherAlex: { id: id(9), name: "Alex Goh", pref: "Alex", rel: "self", notes: null, dob: "1979-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const W = [14, 26, 14, 8];
const person = (masked: string, name: string, amount: string, date = "01/04/2024") => row([masked, name, amount, "As of", date], W);
const cert = (amounts: { gtl: [string, string]; gpa: [string, string]; lc: [string, string] }, date = "01/04/2024") => [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Harbourline Life\" for cover(s) as indicated:",
  "HARBOURLINE CIVIL SERVICE GROUP SCHEME (GROUP POLICY NO. GX55001)   Page 1 of 1",
  "Product, Policy Number, Particulars of Insured Person(s) and Sum Assured/Medical Plan   Effective Date",
  "GROUP TERM LIFE(POLICY NO.HL7700123)",
  person("T****771K", "Goh Wei Ming, Alex", amounts.gtl[0], date),
  person("T****302B", "Tan Hui Min Bea", amounts.gtl[1], date),
  "GROUP PERSONAL ACCIDENT(POLICY NO. HL7700123)",
  person("T****771K", "Goh Wei Ming, Alex", amounts.gpa[0], date),
  person("T****302B", "Tan Hui Min Bea", amounts.gpa[1], date),
  "GROUP LIVING CARE(POLICY NO. HL7700123)",
  person("T****771K", "Goh Wei Ming, Alex", amounts.lc[0], date),
  person("T****302B", "Tan Hui Min Bea", amounts.lc[1], date),
].join("\n");

const PA_P1 = [
  "Harbourline Life - Civil Service Group Personal Accident (Policy No. HL7700123, Group Policy No. GX55001)",
  "Schedule of Compensation",
  "",
  row(["Event", "% of Sum Insured"], [48]),
  row(["Death due to Accident", "100%"], [48]),
  row(["Permanent Total Disablement due to Accident", "100%"], [48]),
  row(["Fracture of arm", "20%"], [48]),
  row(["Fracture of toe", "2%"], [48]),
].join("\n");
const PA_P2 = [
  "Section 2 - Benefits",
  "Death due to Accident: if the Insured Person dies as a direct result of an Accident within 365 days of the Accident, we will pay 100% of the Sum Insured shown in the Certificate of Group Insurance.",
  "Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means.",
  "Cover for an Insured Person ends on the date the Insured Person ceases to be a member of the Scheme.",
  "",
  "Section 3 - Exclusions",
  "We will not pay for death or injury caused by participation in competitive racing on wheels, except racing sanctioned by the Authority.",
  "We will not pay for death or disablement caused by illness or disease.",
].join("\n");

const HC_P1 = [
  "Harbourline Life - Group Hospital Cash (Policy No. HL9900456)",
  "Particulars of insured persons",
  "",
  row(["Insured person", "ID", "Daily benefit", "Annual limit", "Effective date"], [26, 12, 16, 16]),
  row(["Goh Wei Ming, Alex", "T****771K", "S$150", "S$15,000", "01/04/2024"], [26, 12, 16, 16]),
  row(["Tan Hui Min Bea", "T****302B", "S$100", "S$10,000", "01/04/2024"], [26, 12, 16, 16]),
].join("\n");

const WF = [44, 16, 16];
const FAMILY_P1 = [
  "Kestrel General - FamilyShield Accident Plan - Policy Schedule",
  "Policy No. KG-FS-4410",
  "Insured adult: Bea Tan Hui Min. Insured child: Cai Goh Jun Le.",
  "",
  row(["Benefit", "Adult", "Child"], WF),
  row(["Accidental death", "S$200,000", "S$50,000"], WF),
  row(["Fracture (per fracture)", "S$800", "S$400"], WF),
].join("\n");
const ENDT_P1 = [
  "Kestrel General - Endorsement No. 2 to Policy No. KG-FS-4410",
  "With effect from 1 July 2026 the fracture benefit is revised as follows.",
  "",
  row(["Benefit", "Adult / Before", "Adult / After", "Child / Before", "Child / After"], [30, 16, 16, 16]),
  row(["Fracture (per fracture)", "S$800", "S$1,000", "S$400", "S$500"], [30, 16, 16, 16]),
].join("\n");
const EMP_P1 = [
  "Orchid Benefits - Employee Group Outpatient Plan",
  "Policy No. OB-OP-7781",
  "Employee: Alex Goh. Spouse: Bea Tan Hui Min.",
  "",
  row(["Benefit", "Employee", "Spouse"], WF),
  row(["GP visit (per visit)", "S$40", "S$30"], WF),
].join("\n");
// A scanned page: OCR text with irregular spacing and a broken line, as ingestion stores it.
const SCAN_P1 = [
  "HARBOURL1NE LIFE   Policy Schedule (scanned)",
  "Policy  No.  HL-TL-3302      Life  Assured :  Alex  Goh",
  "",
  "Benefit                         Sum  Assured",
  "Death                           S$250,000",
  "Terminal  Illness               S$250,000",
].join("\n");

export const DOCS: FxDoc[] = [
  { key: "CERT", id: id(101), owner: M.alex.id, members: [{ id: M.alex.id }, { id: M.bea.id }], insurer: "Harbourline Life", product: "Harbourline Civil Service Group Scheme - Certificate", policyNumber: "HL7700123", groupPolicyNumber: "GX55001", policyType: "Personal accident", role: "schedule", personal: true, hash: "sha256:release-cert", effective: "2024-04-01", documentDate: "2024-04-01", pages: { 1: cert({ gtl: ["S$1,000,000", "S$500,000"], gpa: ["S$600,000", "S$400,000"], lc: ["S$350,000", "S$250,000"] }) } },
  { key: "PA_WORD", id: id(102), owner: M.alex.id, members: [{ id: M.alex.id }, { id: M.bea.id }], insurer: "Harbourline Life", product: "Harbourline Civil Service Group Personal Accident - Policy Wording", policyNumber: "HL7700123", groupPolicyNumber: "GX55001", policyType: "Personal accident", role: "policy_wording", personal: true, hash: "sha256:release-pa-word", effective: "2024-04-01", pages: { 1: PA_P1, 2: PA_P2 } },
  { key: "HC", id: id(103), owner: M.alex.id, members: [{ id: M.alex.id }, { id: M.bea.id }], insurer: "Harbourline Life", product: "Harbourline Group Hospital Cash", policyNumber: "HL9900456", policyType: "Hospital cash", role: "schedule", personal: true, hash: "sha256:release-hc", effective: "2024-04-01", pages: { 1: HC_P1 } },
  { key: "FAMILY", id: id(104), owner: M.bea.id, members: [{ id: M.bea.id, tier: "Adult" }, { id: M.cai.id, tier: "Child" }], insurer: "Kestrel General", product: "FamilyShield Accident Plan", policyNumber: "KG-FS-4410", policyType: "Personal accident", role: "schedule", personal: true, hash: "sha256:release-family", effective: "2026-01-01", pages: { 1: FAMILY_P1 } },
  { key: "ENDT", id: id(105), owner: M.bea.id, members: [{ id: M.bea.id, tier: "Adult" }, { id: M.cai.id, tier: "Child" }], insurer: "Kestrel General", product: "FamilyShield Accident Plan - Endorsement No. 2", policyNumber: "KG-FS-4410", policyType: "Personal accident", role: "endorsement", personal: true, hash: "sha256:release-endt", effective: "2026-07-01", pages: { 1: ENDT_P1 } },
  { key: "EMP", id: id(106), owner: M.alex.id, members: [{ id: M.alex.id, tier: "Employee" }, { id: M.bea.id, tier: "Spouse" }], insurer: "Orchid Benefits", product: "Employee Group Outpatient Plan", policyNumber: "OB-OP-7781", policyType: "Outpatient", role: "schedule", personal: true, hash: "sha256:release-emp", effective: "2026-01-01", pages: { 1: EMP_P1 } },
  { key: "SCAN", id: id(107), owner: M.alex.id, members: [{ id: M.alex.id }], insurer: "Harbourline Life", product: "Harbourline Term (scanned schedule)", policyNumber: "HL-TL-3302", policyType: "Life", role: "schedule", personal: true, hash: "sha256:release-scan", effective: "2023-01-01", pages: { 1: SCAN_P1 } },
  { key: "OLD", id: id(108), owner: M.alex.id, members: [{ id: M.alex.id }, { id: M.bea.id }], insurer: "Harbourline Life", product: "Harbourline Civil Service Group Scheme - Certificate (2022)", policyNumber: "HL7700123", groupPolicyNumber: "GX55001", policyType: "Personal accident", role: "schedule", personal: true, superseded: true, hash: "sha256:release-old", effective: "2022-04-01", pages: { 1: cert({ gtl: ["S$800,000", "S$400,000"], gpa: ["S$450,000", "S$300,000"], lc: ["S$250,000", "S$150,000"] }, "01/04/2022") } },
  { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.otherAlex.id, members: [{ id: M.otherAlex.id }], insurer: "Harbourline Life", product: "Harbourline Civil Service Group Scheme - Certificate", policyNumber: "HL7700999", groupPolicyNumber: "GX55001", policyType: "Personal accident", role: "schedule", personal: true, hash: "sha256:release-other", effective: "2024-04-01", pages: { 1: cert({ gtl: ["S$2,000,000", "S$1"], gpa: ["S$900,000", "S$1"], lc: ["S$700,000", "S$1"] }).replace("Tan Hui Min Bea", "Someone Else Entirely") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

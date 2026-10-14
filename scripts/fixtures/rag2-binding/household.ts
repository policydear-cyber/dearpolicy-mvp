/**
 * V1.4: synthetic household for the person / product / benefit binding suite (scripts/rag2-binding-regressions.ts;
 * npm run rag2:binding-test). It mirrors the document STRUCTURE behind the reported post-PR #48 live answer ("<member>
 * died in a car accident in Japan, what can I do?" -> "The <scheme> lists separate Group Term Life and <member's name>
 * amounts"). The live conversation and its stored pages could not be read from this session, so this is a structural
 * reproduction, not the household's data: every insurer, scheme, person, masked ID, address, policy number, date and
 * amount is invented.
 *
 *  CERT      a group-insurance certificate LETTER: the insured member's name, address and salutation each on their
 *            own line above the roster (as a mailed certificate prints them), then one insured person per ROW under
 *            each product heading (Group Term Life, Group Personal Accident, Group Living Care, Group Living Care Plus).
 *  CERT_COLS the same roster as a PDF text layer often stores it: one cell per line (masked ID, name, amount, "As of",
 *            date) -- the person's name alone on a line.
 *  GTL_SUM   the scheme's Group Term Life product summary (reference): death benefit = the Sum Assured.
 *  GPA_SUM   the scheme's Group Personal Accident product summary (reference): accidental death = 100% of the Sum
 *            Insured if death occurs within 365 days of the Accident; worldwide cover.
 *  ENDORSE   an endorsement of the same policy number amending Michelle's Group Personal Accident amount from a later
 *            date: the certificate's and the endorsement's amounts are a conflict the view names, never resolves.
 *  CERT_OLD  the superseded 2020 certificate (other amounts): never a source.
 *  PET_WORD, PET_END  another insurer's pet-insurance wording and endorsement, linked to nobody.
 *  OTHER     another household's certificate naming a member of the same first name.
 */
import { row, type FxDoc, type FxMember } from "../rag2/household";

export const ACCOUNT = "00000000-0000-0000-0000-00000000f501";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000f502";
const id = (n: number) => "7f000000-0000-4000-8000-" + String(n).padStart(12, "0");

export const M = {
  darren: { id: id(1), name: "Darren Tan Kai Ming", pref: "Darren", rel: "self", notes: null, dob: "1980-03-21" },
  michelle: { id: id(2), name: "Michelle Ong Li Ting", pref: "Michelle", rel: "spouse", notes: "wife", dob: "1982-11-02" },
  otherDarren: { id: id(9), name: "Darren Tan", pref: "Darren", rel: "self", notes: null, dob: "1971-01-01", account: OTHER_ACCOUNT },
} satisfies Record<string, FxMember>;

const W = [14, 24, 16, 8];
const person = (masked: string, name: string, amount: string, date = "06/10/2022") => row([masked, name, amount, "As of", date], W);
const PRODUCTS: [string, string, [string, string]][] = [
  // One policy number on every product heading (as the scheme prints it): the products are told apart by their
  // headings, never collapsed into one by the shared number.
  ["GROUP TERM LIFE", "PSG-880100", ["S$1,000,000", "S$500,000"]],
  ["GROUP PERSONAL ACCIDENT", "PSG-880100", ["S$600,000", "S$300,000"]],
  ["GROUP LIVING CARE", "PSG-880100", ["S$350,000", "S$150,000"]],
  ["GROUP LIVING CARE PLUS", "PSG-880100", ["S$300,000", "S$100,000"]],
];
const NAMES: [string, string] = ["Tan Kai Ming, Darren", "Ong Li Ting, Michelle"];
const MASKED: [string, string] = ["S****771J", "S****402F"];
const LETTER = ["Meridian Life Ltd", "Group Insurance Department", "06 October 2022", "", NAMES[0], "Blk 000 Example Avenue 1 #00-00", "Singapore 000000", "", "Dear Sir/Madam,", ""];
const certRows = (oneCellPerLine: boolean, amounts = PRODUCTS.map((p) => p[2]), names = NAMES, date = "06/10/2022") => [
  "CERTIFICATE OF GROUP INSURANCE",
  "This is to certify that the person(s) named herein is/are insured with \"Meridian Life Ltd\" for cover(s) as indicated:",
  "PUBLIC SERVICE GROUP INSURANCE SCHEME (GROUP POLICY NO. PSG-8800)   Page 1 of 1",
  "Product, Policy Number, Particulars of Insured Person(s) and Sum Assured   Effective Date",
  ...PRODUCTS.flatMap(([product, no], k) => [
    `${product}(POLICY NO. ${no})`,
    ...[0, 1].flatMap((i) => (oneCellPerLine ? [MASKED[i], names[i], amounts[k][i], "As of", date] : [person(MASKED[i], names[i], amounts[k][i], date)])),
  ]),
].join("\n");

const GTL_P1 = [
  "Meridian Life Ltd - Public Service Group Term Life - Product Summary",
  "Death Benefit: the Sum Assured shown in the Certificate of Group Insurance is payable on the death of the Insured Person.",
  "Terminal Illness Benefit: the Sum Assured is payable once on diagnosis of a Terminal Illness.",
  "Claims: notify Meridian Life Ltd of a death within 6 months, with the death certificate.",
].join("\n");
const GPA_P1 = [
  "Meridian Life Ltd - Public Service Group Personal Accident - Product Summary",
  "Accidental Death: 100% of the Sum Insured if the Insured Person dies as a result of an Accident within 365 days of that Accident.",
  "Territorial limits: worldwide, 24 hours a day.",
  "Accident means a sudden, unforeseen and involuntary event caused by external, violent and visible means.",
].join("\n");
const ENDORSE_P1 = [
  "Meridian Life Ltd - Public Service Group Insurance Scheme - Endorsement No. 3 (Policy No. PSG-880100)",
  "With effect from 01/01/2024 the Group Personal Accident Sum Insured for Ong Li Ting, Michelle is amended to S$400,000.",
  "All other terms and conditions remain unchanged.",
].join("\n");
const PET_WORD_P1 = ["Lumen General - PawSafe Pet Insurance - Policy Wording", "We will pay veterinary fees up to S$4,000 per Policy Year for your Pet."].join("\n");
const PET_END_P1 = ["Lumen General - PawSafe Pet Insurance - Endorsement No. 1", "With effect from 1 March 2026 the Excess for each claim is amended to S$150."].join("\n");

const both = [{ id: M.darren.id }, { id: M.michelle.id }];
export const DOCS: FxDoc[] = [
  { key: "CERT", id: id(101), owner: M.darren.id, members: both, insurer: "Meridian Life Ltd", product: "PUBLIC SERVICE GROUP INSURANCE SCHEME", policyNumber: "PSG-880100", groupPolicyNumber: "PSG-8800", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:binding-cert", effective: "2022-10-06", documentDate: "2022-10-06", pages: { 1: [...LETTER, certRows(false)].join("\n") } },
  { key: "GTL_SUM", id: id(102), owner: M.darren.id, members: both, insurer: "Meridian Life Ltd", product: "Public Service Group Term Life - Product Summary", policyNumber: "PSG-880100", groupPolicyNumber: "PSG-8800", policyType: "Term life", role: "product_summary", personal: false, hash: "sha256:binding-gtl", pages: { 1: GTL_P1 } },
  { key: "GPA_SUM", id: id(103), owner: M.darren.id, members: both, insurer: "Meridian Life Ltd", product: "Public Service Group Personal Accident - Product Summary", policyNumber: "PSG-880100", groupPolicyNumber: "PSG-8800", policyType: "Personal accident", role: "product_summary", personal: false, hash: "sha256:binding-gpa", pages: { 1: GPA_P1 } },
  { key: "ENDORSE", id: id(106), owner: M.michelle.id, members: [{ id: M.michelle.id }], insurer: "Meridian Life Ltd", product: "Public Service Group Insurance Scheme - Endorsement No. 3", policyNumber: "PSG-880100", groupPolicyNumber: "PSG-8800", policyType: "Group insurance", role: "endorsement", personal: false, hash: "sha256:binding-endorse", effective: "2024-01-01", documentDate: "2024-01-01", pages: { 1: ENDORSE_P1 } },
  { key: "CERT_OLD", id: id(107), owner: M.darren.id, members: both, insurer: "Meridian Life Ltd", product: "PUBLIC SERVICE GROUP INSURANCE SCHEME (2020)", policyNumber: "PSG-880100", groupPolicyNumber: "PSG-8800", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:binding-cert-2020", effective: "2020-10-06", documentDate: "2020-10-06", superseded: true, pages: { 1: certRows(false, PRODUCTS.map(() => ["S$800,000", "S$450,000"] as [string, string]), NAMES, "06/10/2020") } },
  { key: "PET_WORD", id: id(104), owner: M.darren.id, members: [], insurer: "Lumen General", product: "PawSafe Pet Insurance - Policy Wording", policyNumber: "LG-PS-1201", policyType: "Pet", role: "policy_wording", personal: false, hash: "sha256:binding-pet-word", pages: { 1: PET_WORD_P1 } },
  { key: "PET_END", id: id(105), owner: M.darren.id, members: [], insurer: "Lumen General", product: "PawSafe Pet Insurance - Endorsement", policyNumber: "LG-PS-1201", policyType: "Pet", role: "endorsement", personal: false, hash: "sha256:binding-pet-end", pages: { 1: PET_END_P1 } },
  { key: "OTHER", id: id(201), account: OTHER_ACCOUNT, owner: M.otherDarren.id, members: [{ id: M.otherDarren.id }], insurer: "Meridian Life Ltd", product: "PUBLIC SERVICE GROUP INSURANCE SCHEME", policyNumber: "PSL-889999", groupPolicyNumber: "PSG-8800", policyType: "Group insurance", role: "schedule", personal: true, hash: "sha256:binding-other", pages: { 1: certRows(false, PRODUCTS.map(() => ["S$2,000,000", "S$0"] as [string, string]), ["Tan, Darren", "Nobody, None"]) } },
];
/** The same household with the certificate's text layer one cell per line (the name alone on a line). */
export const DOCS_COLS: FxDoc[] = DOCS.map((d) => (d.key === "CERT" ? { ...d, hash: "sha256:binding-cert-cols", pages: { 1: [...LETTER, certRows(true)].join("\n") } } : d));
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;

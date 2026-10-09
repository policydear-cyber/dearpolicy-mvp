/**
 * Live-model smoke (scripts/rag2-live): ONE new synthetic household, Lim, used only by the live harness. Every name,
 * insurer, product, policy number and figure is invented and appears nowhere else in the repository; nothing here is
 * a real person's document. Pages are stored text as ingestion stores it (space-aligned pdftotext-style columns, tabs).
 *
 *  Household L (Lim, ACCOUNT_L): Daniel (self -- the person typing), Grace (spouse), Kai (son), Mei (daughter).
 *    - SunHaven Family Accident Guard (Harbourline General Insurance): Adult / Child columns; accident-only cover, so a
 *      fracture's cause matters; covers accidents anywhere in the world but prints NO evacuation benefit.
 *    - CareDay Hospital Cash Plan (Meridian Mutual Assurance): Insured Adult / Insured Child columns; hospital cash for
 *      each complete period of 24 hours; illness and accident both covered.
 *    - KestrelShield Integrated Plan (Kestrel Health Insurance) for Daniel: base schedule (annual claim limit
 *      S$1,000,000) and Endorsement No. 1 effective 01 Jul 2026 raising it to S$1,500,000.
 *    - Round 6: PlayWell Junior Accident Cover (Tidewater Assurance) for Mei only: one "Sum insured" column; accident
 *      only; a dislocation benefit payable once diagnosed by a registered medical practitioner and confirmed by X-ray
 *      or MRI (an evidence condition, for the L3b paraphrase scenario).
 */
import { row } from "../rag2-adv/household";

export const ACCOUNT_L = "00000000-0000-0000-0000-00000000a401";
export const LIVE_ACCOUNT_NAME = "SYNTHETIC-DPTEST-rag2live Household Lim";
const id = (n: number) => "74000000-0000-4000-8000-" + String(n).padStart(12, "0");

export type LiveMember = { id: string; name: string; pref: string | null; rel: string; notes: string | null; dob: string | null; account: string };
export const L = {
  daniel: { id: id(1), name: "Daniel Lim Wen Jie", pref: "Daniel", rel: "self", notes: null, dob: "1980-03-11", account: ACCOUNT_L },
  grace: { id: id(2), name: "Grace Ong Pei Shan", pref: "Grace", rel: "spouse", notes: "wife", dob: "1983-08-22", account: ACCOUNT_L },
  kai: { id: id(3), name: "Kai Lim Jun Hao", pref: "Kai", rel: "child", notes: "son", dob: "2014-05-06", account: ACCOUNT_L },
  mei: { id: id(4), name: "Mei Lim Xin Hui", pref: "Mei", rel: "child", notes: "daughter", dob: "2018-11-30", account: ACCOUNT_L },
} satisfies Record<string, LiveMember>;
export type MemberKey = keyof typeof L;
export const MEMBERS: LiveMember[] = Object.values(L);

export type LiveDoc = {
  key: DocKey; id: string; account: string; owner: string; members: { id: string; tier?: string | null }[]; insurer: string; product: string; policyNumber: string;
  policyType: string; role: string; hash: string; effective: string; expiry: string; pages: Record<number, string>;
};
export type DocKey = "SUNHAVEN" | "CAREDAY" | "KESTREL" | "KESTREL_ENDT" | "PLAYWELL";

const SW = [56, 14, 14];
const SUNHAVEN_P1 = [
  row(["Harbourline General Insurance", "Policy HG-PA-771204"], [72]),
  "SunHaven Family Accident Guard - Policy Schedule",
  "",
  row(["Policy number", "HG-PA-771204"], [30]),
  row(["Policyholder", "Daniel Lim Wen Jie"], [30]),
  row(["Period of insurance", "01 Apr 2026 to 31 Mar 2027"], [30]),
  "",
  "Insured persons",
  row(["Name", "Category", "Date of birth"], [30, 14]),
  row(["Daniel Lim Wen Jie", "Adult", "11 Mar 1980"], [30, 14]),
  row(["Grace Ong Pei Shan", "Adult", "22 Aug 1983"], [30, 14]),
  row(["Kai Lim Jun Hao", "Child", "06 May 2014"], [30, 14]),
  row(["Mei Lim Xin Hui", "Child", "30 Nov 2018"], [30, 14]),
  "",
  "Schedule of benefits",
  row(["Benefit", "Adult", "Child"], SW),
  row(["Accident medical expenses (per accident)", "S$3,000", "S$1,500"], SW),
  row(["Fracture benefit (per fracture)", "S$1,200", "S$750"], SW),
  row(["Accidental dental treatment (per accident)", "S$800", "S$400"], SW),
  row(["Accidental death", "S$100,000", "S$20,000"], SW),
  "",
  row(["", "Page 1 of 2"], [72]),
].join("\n");
const SUNHAVEN_P2 = [
  "Section 2 - What is covered",
  "This policy covers Bodily Injury caused solely and directly by an Accident. A fracture caused by sickness, disease or a gradual or degenerative condition (such as osteoporosis or a bone tumour) is not covered.",
  "",
  "Fracture benefit is payable once per fracture confirmed by X-ray and certified by a registered medical practitioner.",
  "",
  "Accidental dental treatment pays the cost of treatment to sound natural teeth damaged by an Accident, up to the limit per accident shown in the Schedule.",
  "",
  "Section 4 - Where you are covered",
  "This policy covers Accidents anywhere in the world.",
  "",
  row(["", "Page 2 of 2"], [72]),
].join("\n");

const CW = [62, 16, 16];
const CAREDAY_P1 = [
  row(["Meridian Mutual Assurance", "Policy MM-HC-205518"], [72]),
  "CareDay Hospital Cash Plan - Certificate of Insurance",
  "",
  row(["Policy number", "MM-HC-205518"], [30]),
  row(["Policy owner", "Daniel Lim Wen Jie"], [30]),
  row(["Period of cover", "01 Feb 2026 to 31 Jan 2027"], [30]),
  "",
  "Insured members",
  row(["Name", "Cover type", "Date of birth"], [30, 18]),
  row(["Daniel Lim Wen Jie", "Insured Adult", "11 Mar 1980"], [30, 18]),
  row(["Grace Ong Pei Shan", "Insured Adult", "22 Aug 1983"], [30, 18]),
  row(["Kai Lim Jun Hao", "Insured Child", "06 May 2014"], [30, 18]),
  row(["Mei Lim Xin Hui", "Insured Child", "30 Nov 2018"], [30, 18]),
  "",
  "Benefit table",
  row(["Benefit", "Insured Adult", "Insured Child"], CW),
  row(["Hospital cash (each complete 24 hours, max 90 per year)", "S$100", "S$60"], CW),
  row(["ICU cash (each complete 24 hours, max 30 per year)", "S$200", "S$120"], CW),
].join("\n");
const CAREDAY_P2 = [
  "Conditions",
  "Hospital cash is payable for each complete period of 24 hours that the Insured Person is confined in hospital as an inpatient, counted from the time of admission. Any period shorter than 24 hours is not counted. Admission and discharge times are taken from the hospital's discharge summary.",
  "",
  "ICU cash is payable in the same way for each complete period of 24 hours spent in an intensive care unit, in addition to hospital cash.",
  "",
  "Illness and accident are both covered.",
].join("\n");

const KESTREL_P1 = [
  "Kestrel Health Insurance",
  "KestrelShield Integrated Plan - Policy Schedule",
  "Policy number: KH-IS-338861",
  "Life assured: Daniel Lim Wen Jie",
  "Policy year 01 Apr 2026 to 31 Mar 2027",
  "",
  "Benefit\tLimit",
  "Deductible (per policy year, private hospital)\tS$3,500",
  "Co-insurance\t10%",
  "Annual claim limit\tS$1,000,000",
].join("\n");
const KESTREL_ENDT_P1 = [
  "Kestrel Health Insurance",
  "Endorsement No. 1 to policy KH-IS-338861",
  "Effective date: 01 Jul 2026",
  "The policy schedule is hereby amended as follows.",
  "",
  "Benefit\tBefore\tAfter",
  "Annual claim limit\tS$1,000,000\tS$1,500,000",
  "",
  "All other terms of the policy remain unchanged.",
].join("\n");

const PW = [56, 14];
const PLAYWELL_P1 = [
  row(["Tidewater Assurance", "Certificate TA-JA-480327"], [72]),
  "PlayWell Junior Accident Cover - Certificate of Cover",
  "",
  row(["Certificate number", "TA-JA-480327"], [30]),
  row(["Parent or guardian", "Daniel Lim Wen Jie"], [30]),
  row(["Insured child", "Mei Lim Xin Hui"], [30]),
  row(["Period of cover", "01 Jun 2026 to 31 May 2027"], [30]),
  "",
  "Table of benefits",
  row(["Benefit", "Sum insured"], PW),
  row(["Dislocation benefit (per dislocation)", "S$600"], PW),
  row(["Burns benefit (per accident)", "S$900"], PW),
  row(["Outpatient physiotherapy (per accident)", "S$300"], PW),
].join("\n");
const PLAYWELL_P2 = [
  "General conditions",
  "This certificate covers Injury caused solely by an Accident while the insured child is covered.",
  "",
  "Dislocation benefit is payable once per dislocation that is diagnosed by a registered medical practitioner and confirmed by X-ray or MRI.",
  "",
  "Outpatient physiotherapy must be referred in writing by the treating doctor.",
].join("\n");

const all = [L.daniel, L.grace, L.kai, L.mei].map((m) => ({ id: m.id }));
export const DOCS: LiveDoc[] = [
  { key: "SUNHAVEN", id: id(101), account: ACCOUNT_L, owner: L.daniel.id, members: all, insurer: "Harbourline General Insurance", product: "SunHaven Family Accident Guard", policyNumber: "HG-PA-771204", policyType: "Personal Accident", role: "schedule", hash: "sha256:live-sunhaven", effective: "2026-04-01", expiry: "2027-03-31", pages: { 1: SUNHAVEN_P1, 2: SUNHAVEN_P2 } },
  { key: "CAREDAY", id: id(102), account: ACCOUNT_L, owner: L.daniel.id, members: all, insurer: "Meridian Mutual Assurance", product: "CareDay Hospital Cash Plan", policyNumber: "MM-HC-205518", policyType: "Hospital Cash", role: "schedule", hash: "sha256:live-careday", effective: "2026-02-01", expiry: "2027-01-31", pages: { 1: CAREDAY_P1, 2: CAREDAY_P2 } },
  { key: "KESTREL", id: id(103), account: ACCOUNT_L, owner: L.daniel.id, members: [{ id: L.daniel.id }], insurer: "Kestrel Health Insurance", product: "KestrelShield Integrated Plan", policyNumber: "KH-IS-338861", policyType: "Integrated Shield", role: "schedule", hash: "sha256:live-kestrel", effective: "2026-04-01", expiry: "2027-03-31", pages: { 1: KESTREL_P1 } },
  { key: "PLAYWELL", id: id(105), account: ACCOUNT_L, owner: L.daniel.id, members: [{ id: L.mei.id }], insurer: "Tidewater Assurance", product: "PlayWell Junior Accident Cover", policyNumber: "TA-JA-480327", policyType: "Personal Accident", role: "schedule", hash: "sha256:live-playwell", effective: "2026-06-01", expiry: "2027-05-31", pages: { 1: PLAYWELL_P1, 2: PLAYWELL_P2 } },
  { key: "KESTREL_ENDT", id: id(104), account: ACCOUNT_L, owner: L.daniel.id, members: [{ id: L.daniel.id }], insurer: "Kestrel Health Insurance", product: "KestrelShield Integrated Plan - Endorsement No. 1", policyNumber: "KH-IS-338861", policyType: "Integrated Shield", role: "endorsement", hash: "sha256:live-kestrel-endt1", effective: "2026-07-01", expiry: "2027-03-31", pages: { 1: KESTREL_ENDT_P1 } },
];
export const doc = (key: DocKey) => DOCS.find((d) => d.key === key)!;

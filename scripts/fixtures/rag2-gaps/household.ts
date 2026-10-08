/**
 * Agent G: synthetic households for scripts/rag2-gaps-regressions.ts (adult applicability, stepchild rows, the
 * claimed amount, corrections reaching the claim record, deleted / superseded sources). Two unrelated families with
 * different document wordings, so no behaviour is tuned to one set of names or phrases. All data is invented.
 */
export const ACCOUNT_L = "7a000000-0000-4000-8000-000000000001";
export const ACCOUNT_R = "7a000000-0000-4000-8000-000000000002";
const id = (n: number) => `7b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const did = (n: number) => `7c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export type GMember = { id: string; account: string; name: string; pref: string | null; rel: string; notes: string | null; dob: string | null };
export const M = {
  // The Lim family (Harbour / Kinship wording).
  daniel: { id: id(1), account: ACCOUNT_L, name: "Daniel Lim Wen Jie", pref: "Daniel", rel: "self", notes: null, dob: "1980-04-11" },
  grace: { id: id(2), account: ACCOUNT_L, name: "Grace Tan Hui Ling", pref: "Grace", rel: "spouse", notes: "wife", dob: "1983-08-02" },
  ivy: { id: id(3), account: ACCOUNT_L, name: "Ivy Lim Xin Yi", pref: "Ivy", rel: "child", notes: "daughter", dob: "2014-06-20" },
  marcus: { id: id(4), account: ACCOUNT_L, name: "Marcus Ong Jia Hao", pref: "Marcus", rel: "child", notes: "stepson", dob: "2012-01-15" },
  wei: { id: id(5), account: ACCOUNT_L, name: "Lim Wei Ming", pref: "Wei", rel: "sibling", notes: "brother", dob: null },
  // The Rahman family (Meridian wording).
  faridah: { id: id(11), account: ACCOUNT_R, name: "Faridah Rahman", pref: null, rel: "self", notes: null, dob: "1975-02-09" },
  imran: { id: id(12), account: ACCOUNT_R, name: "Imran Yusof", pref: "Imran", rel: "spouse", notes: "husband", dob: "1974-11-30" },
  zara: { id: id(13), account: ACCOUNT_R, name: "Zara Hamid", pref: "Zara", rel: "child", notes: "stepdaughter", dob: "2016-03-03" },
  adam: { id: id(14), account: ACCOUNT_R, name: "Adam Yusof", pref: "Adam", rel: "child", notes: "son", dob: null },
  nur: { id: id(15), account: ACCOUNT_R, name: "Nur Aisyah", pref: "Nur", rel: "dependant", notes: null, dob: null },
} satisfies Record<string, GMember>;

const pad = (cells: string[], w: number[]) => cells.map((c, i) => (i < cells.length - 1 ? c.padEnd(w[i] ?? 20) : c)).join("");
const W3 = [48, 18, 18];

export type GDoc = { key: string; id: string; account: string; owner: string; insurer: string; product: string; policyNumber: string; type: string; hash: string; members: string[]; pages: Record<number, string> };
export const DOCS: GDoc[] = [
  // Adult / Child columns; insured persons listed without a category; no definition of a Child.
  { key: "HARBOUR", id: did(1), account: ACCOUNT_L, owner: M.daniel.id, insurer: "Harbour Assurance", product: "Harbour Family PA", policyNumber: "HB-1001", type: "personal_accident", hash: "h-harbour-1",
    members: [M.grace.id, M.ivy.id, M.marcus.id, M.wei.id],
    pages: { 1: ["Harbour Assurance", "Harbour Family PA - Policy Schedule", "Insured persons: Daniel Lim Wen Jie; Grace Tan Hui Ling; Ivy Lim Xin Yi; Marcus Ong Jia Hao; Lim Wei Ming", "",
      pad(["Benefit", "Adult", "Child"], W3), pad(["Accidental medical expenses (per accident)", "S$2,000", "S$1,000"], W3), pad(["Daily hospital income", "S$100", "S$50"], W3), "", "Daily hospital income is paid for each night spent in hospital."].join("\n") } },
  // "Life Assured" / "Juvenile" headers.
  { key: "GUARD", id: did(2), account: ACCOUNT_L, owner: M.daniel.id, insurer: "Harbour Assurance", product: "Harbour Guardian Plan", policyNumber: "HB-2002", type: "personal_accident", hash: "h-guard-1",
    members: [M.grace.id, M.ivy.id],
    pages: { 1: ["Harbour Guardian Plan - Schedule of Benefits", "", pad(["Benefit", "Life Assured", "Juvenile"], W3), pad(["Fracture benefit", "S$1,500", "S$750"], W3)].join("\n") } },
  // Insured Adult / Insured Child; a definition that includes step-children who are named.
  { key: "KINSHIP", id: did(3), account: ACCOUNT_L, owner: M.daniel.id, insurer: "Kinship Insurance", product: "Kinship Hospital Cash", policyNumber: "KN-3003", type: "hospital_cash", hash: "h-kinship-1",
    members: [M.grace.id, M.ivy.id, M.marcus.id],
    pages: { 1: ["Kinship Hospital Cash - Certificate", "Insured under this certificate: Daniel Lim Wen Jie, Grace Tan Hui Ling, Ivy Lim Xin Yi and Marcus Ong Jia Hao.", "",
      pad(["Benefit", "Insured Adult", "Insured Child"], W3), pad(["Hospital cash per day", "S$120", "S$80"], W3)].join("\n"),
      2: ["Definitions", "Child means a natural, adopted or step-child of the Policyholder who is named in this Certificate.", "Hospital cash is payable for each complete period of 24 hours in hospital."].join("\n") } },
  // Rahman: Grown-up / Kid columns; \"Children\" defined as biological or adopted only, with an age limit.
  { key: "MERIDIAN_KIDS", id: did(11), account: ACCOUNT_R, owner: M.faridah.id, insurer: "Meridian General", product: "Meridian Kids Shield", policyNumber: "MG-11", type: "personal_accident", hash: "h-mkids-1",
    members: [M.imran.id, M.zara.id, M.adam.id, M.nur.id],
    pages: { 1: ["Meridian Kids Shield", "", pad(["Cover item", "Grown-up", "Kid"], W3), pad(["Accident outpatient treatment", "S$600", "S$400"], W3)].join("\n"),
      2: ["Dental cover", "", pad(["Cover item", "Senior", "Junior"], W3), pad(["Dental emergency treatment", "S$300", "S$200"], W3)].join("\n"),
      3: ["Meaning of words", "“Children” refers to the biological or legally adopted children of the Insured aged under 19.", "Cover ends on the policy anniversary after the 19th birthday."].join("\n") } },
  // Rahman: a definition that includes step-children, with an inclusive age limit, no naming condition.
  { key: "MERIDIAN_HOSP", id: did(12), account: ACCOUNT_R, owner: M.faridah.id, insurer: "Meridian General", product: "Meridian Family Hospital", policyNumber: "MG-12", type: "hospital_cash", hash: "h-mhosp-1",
    members: [M.imran.id, M.zara.id, M.adam.id],
    pages: { 1: ["Meridian Family Hospital - Schedule", "", pad(["Benefit", "Adult", "Child"], W3), pad(["Daily ward allowance", "S$150", "S$90"], W3)].join("\n"),
      2: ["Glossary", "Child includes a step-child or adopted child of the Insured, aged up to 18 years.", "The daily ward allowance is payable for each night spent in hospital."].join("\n") } },
  // Rahman: two documents printing the same row (an enrolment copy) -- one is deleted in the source tests.
  { key: "MERIDIAN_COPY", id: did(13), account: ACCOUNT_R, owner: M.faridah.id, insurer: "Meridian General", product: "Meridian Family Hospital (enrolment copy)", policyNumber: "MG-12", type: "hospital_cash", hash: "h-mcopy-1",
    members: [M.imran.id, M.zara.id, M.adam.id],
    pages: { 1: ["Meridian Family Hospital - Enrolment confirmation", "", pad(["Benefit", "Adult", "Child"], W3), pad(["Daily ward allowance", "S$150", "S$90"], W3)].join("\n") } },
];

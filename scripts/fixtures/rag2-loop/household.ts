/**
 * Synthetic household for the conversation-loop suites (npm run rag2:loop-demo / rag2:loop-test). It is the
 * lib/rag2 suite's household (scripts/fixtures/rag2/household.ts) plus, for this suite only:
 *  - a second son, Koh Jun Wei, insured as a child on the FamilyGuard Personal Accident plan (so "my son" has two
 *    candidates: Jun Hao and Jun Wei; Ryan is a stepson and never "my son");
 *  - an integrated hospital plan for Darren that prints a deductible (for the "what's my deductible?" side question).
 * Every insurer, product, person and number is invented.
 */
import { ACCOUNT, DOCS as BASE_DOCS, M as BASE_M, OTHER_ACCOUNT, row, type FxDoc, type FxMember } from "../rag2/household";

export { ACCOUNT, OTHER_ACCOUNT };
const id = (n: number) => "72000000-0000-4000-8000-" + String(n).padStart(12, "0");

export const M = {
  ...BASE_M,
  junwei: { id: id(9), name: "Koh Jun Wei", pref: "Jun Wei", rel: "child", notes: "son", dob: "2020-04-12" },
} satisfies Record<string, FxMember>;

const HOSP_P1 = [
  "Harbourline Health Insurance",
  "ShieldPlus Integrated Hospital Plan - Policy Schedule",
  "Policy number: HL-IP-330918",
  "Life assured: Darren Koh Wen Jie",
  "Policy year 01 Jul 2026 to 30 Jun 2027",
  "",
  "Benefit\tLimit",
  "Deductible (per policy year, Class B1 ward)\tS$3,500",
  "Co-insurance\t10%",
  "Annual claim limit\tS$1,000,000",
].join("\n");

function withJunWei(d: FxDoc): FxDoc {
  if (d.key !== "PA") return d;
  const p1 = d.pages[1];
  const junHao = row(["Koh Jun Hao", "Insured Child", "30 Jan 2017"], [34, 22]);
  if (!p1.includes(junHao)) throw new Error("the PA fixture changed: Jun Hao's insured-person row not found");
  return { ...d, members: [...d.members, { id: M.junwei.id }], pages: { ...d.pages, 1: p1.replace(junHao, junHao + "\n" + row(["Koh Jun Wei", "Insured Child", "12 Apr 2020"], [34, 22])) } };
}

export const DOCS: FxDoc[] = [
  ...BASE_DOCS.map(withJunWei),
  { key: "HOSP", id: id(113), owner: M.darren.id, members: [{ id: M.darren.id }], insurer: "Harbourline Health Insurance", product: "ShieldPlus Integrated Hospital Plan", policyNumber: "HL-IP-330918", policyType: "Integrated Shield", role: "schedule", personal: true, hash: "sha256:rag2-loop-hosp", effective: "2026-07-01", expiry: "2027-06-30", pages: { 1: HOSP_P1 } },
];

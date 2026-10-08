/**
 * Synthetic household for scripts/rag2-calc-regressions.ts (npm run rag2:calc-test). Every insurer, product, person
 * and number is invented; the wordings deliberately differ from the loop suite's (other day-count rules, waiting
 * periods, minimum stays, exclusions, deduction orders, currencies) so the calculators are exercised generally.
 */
import { row } from "../rag2/household";

export const ACCOUNT = "00000000-0000-0000-0000-00000000c301";
export const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000c302";
const id = (n: number) => "73000000-0000-4000-8000-" + String(n).padStart(12, "0");
export type Member = { id: string; name: string; pref: string; rel: string };
export const M = {
  ana: { id: id(1), name: "Ana Wong Mei Lin", pref: "Ana", rel: "self" },
  ben: { id: id(2), name: "Ben Wong Jia Le", pref: "Ben", rel: "child" },
  carl: { id: id(3), name: "Carl Wong Kai", pref: "Carl", rel: "spouse" },
} satisfies Record<string, Member>;
export type Doc = { key: string; id: string; owner: string; members: string[]; product: string; insurer: string; type: string; hash: string; pages: Record<number, string> };
const W = [40, 14, 14];

export const DOCS: Doc[] = [
  { key: "H24", id: id(101), owner: M.ana.id, members: [M.ana.id, M.ben.id], product: "HarbourCare Hospital Income", insurer: "Corallis Insurance", type: "Hospital income", hash: "sha256:calc-h24", pages: {
    1: ["Corallis Insurance", "HarbourCare Hospital Income - Schedule", "Insured: Ana Wong Mei Lin (adult); Ben Wong Jia Le (child)", "", row(["Benefit", "Adult", "Child"], W), row(["Daily hospital income", "S$120", "S$60"], W), row(["Maximum days per admission", "90 days", "90 days"], W)].join("\n"),
    2: ["Benefit conditions", "Daily hospital income is payable for each complete period of 24 hours in hospital as an inpatient."].join("\n") } },
  { key: "NIGHT", id: id(102), owner: M.ana.id, members: [M.ana.id], product: "Lumen Night Cash", insurer: "Lumen General", type: "Hospital cash", hash: "sha256:calc-night", pages: {
    1: ["Lumen General", "Lumen Night Cash - Policy Schedule", "Insured person: Ana Wong Mei Lin", "", row(["Benefit", "Amount"], [40]), row(["Night cash benefit (per night)", "S$200"], [40]), "", "Night cash benefit is paid for each night spent in hospital after the first 2 nights, up to 20 days per admission."].join("\n") } },
  { key: "FFD", id: id(103), owner: M.ana.id, members: [M.ana.id, M.ben.id], product: "Kestrel DayCare Cash", insurer: "Kestrel Assurance", type: "Hospital cash", hash: "sha256:calc-ffd", pages: {
    1: ["Kestrel Assurance", "Kestrel DayCare Cash - Schedule", "Insured: Ana Wong Mei Lin (adult); Ben Wong Jia Le (child)", row(["Benefit", "Child", "Adult"], W), row(["Hospital cash per day", "S$80", "S$150"], W), row(["ICU cash per day", "S$160", "S$300"], W), row(["Maximum days per admission", "30 days", "60 days"], W)].join("\n"),
    2: ["Kestrel DayCare Cash - conditions", "Hospital cash is payable from the first full day of admission.", "Hospital cash requires a minimum of 6 hours in hospital.", "Hospital cash is not payable for day surgery."].join("\n") } },
  { key: "PLAIN", id: id(104), owner: M.carl.id, members: [M.carl.id], product: "Orchid Hospital Allowance", insurer: "Orchid Mutual", type: "Hospital cash", hash: "sha256:calc-plain", pages: {
    1: ["Orchid Mutual", "Orchid Hospital Allowance - Schedule", "Insured: Carl Wong Kai", row(["Benefit", "Amount"], [40]), row(["Hospital allowance per day", "S$50"], [40])].join("\n") } },
  { key: "PA", id: id(105), owner: M.ana.id, members: [M.ana.id, M.ben.id], product: "Strata Family Accident", insurer: "Strata Insurance", type: "Personal accident", hash: "sha256:calc-pa", pages: {
    1: ["Strata Insurance", "Strata Family Accident - Schedule", row(["Benefit", "Insured Adult", "Insured Child"], [48, 16, 16]), row(["Accidental medical expenses (per policy year)", "S$3,000", "S$1,500"], [48, 16, 16]), row(["Accidental death", "S$100,000", "S$25,000"], [48, 16, 16])].join("\n"),
    2: ["Claims notes", "Fractures are reimbursed under accidental medical expenses up to S$800 per fracture."].join("\n") } },
  { key: "SHIELD", id: id(106), owner: M.carl.id, members: [M.carl.id], product: "Verdant Shield Plus", insurer: "Verdant Health", type: "Integrated Shield", hash: "sha256:calc-shield", pages: {
    1: ["Verdant Health", "Verdant Shield Plus - Policy Schedule", "Life assured: Carl Wong Kai", "", "Benefit\tLimit", "Deductible (per policy year)\tS$3,500", "Co-insurance\t10%", "Co-insurance cap (per policy year)\tS$3,000", "Annual claim limit\tS$1,000,000", "", "How a claim is worked out: the deductible applies first, then co-insurance on the balance."].join("\n") } },
  { key: "SHIELD2", id: id(107), owner: M.ana.id, members: [M.ana.id], product: "Aster Hospital Plan", insurer: "Aster Life", type: "Integrated Shield", hash: "sha256:calc-shield2", pages: {
    1: ["Aster Life", "Aster Hospital Plan - Schedule", "Life assured: Ana Wong Mei Lin", "", "Benefit\tLimit", "Deductible (per policy year)\tS$2,000", "Co-insurance\t10%", "Annual claim limit\tS$500,000"].join("\n") } },
  { key: "CI", id: id(108), owner: M.ana.id, members: [M.ana.id], product: "Mariner Critical Care", insurer: "Mariner Life", type: "Critical illness", hash: "sha256:calc-ci", pages: {
    1: ["Mariner Life", "Mariner Critical Care - Benefit Schedule", "Life assured: Ana Wong Mei Lin", "", "Benefit\tAmount", "Sum assured\tS$150,000", "Early stage critical illness\t25%", "Early stage cap\tS$50,000"].join("\n") } },
  { key: "TRAVEL", id: id(109), owner: M.ana.id, members: [M.ana.id], product: "Wayfarer Travel Guard", insurer: "Wayfarer Insurance", type: "Travel", hash: "sha256:calc-travel", pages: {
    1: ["Wayfarer Insurance", "Wayfarer Travel Guard - Schedule", "Insured: Ana Wong Mei Lin", "", "Benefit\tLimit", "Overseas medical expenses\tUS$50,000"].join("\n") } },
];

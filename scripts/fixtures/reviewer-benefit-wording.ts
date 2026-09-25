/**
 * Minimal, deterministic policy wording and claim evidence for the four
 * reviewer-backed benefit categories. Each wording page is written to be
 * read by the production wording parsers exactly as a real benefit summary
 * would be (lib/claims/death-evidence.ts, ci-evidence.ts,
 * disability-evidence.ts, travel-evidence.ts) -- no parser is bypassed.
 */
import singlifeDeathWording from "./singlife-death-wording.json";

export type WordingPage = { pageNumber: number; text: string };

export type BenefitCategoryFixture = {
  category: "accidental-death" | "critical-illness" | "disability" | "travel";
  route: "match" | "ci-match" | "disability-match" | "travel-match";
  claimEventType: "death" | "diagnosis" | "disability";
  facts: Record<string, unknown>;
  policy: { insurer: string; productName: string; groupPolicyNumber: string | null; category: string; amount: number | null; currency: string; pages: WordingPage[] };
  /** Wording with the benefit amount quoted in another currency. */
  otherCurrencyPages: WordingPage[];
  /** Assessment item id the calculator produces for this benefit. */
  itemId: string;
  /** Extra decision body fields naming the policy's own benefit row. */
  decisionScope: Record<string, string>;
  evidence: { documentType: string; payload: Record<string, unknown>; pages: WordingPage[] };
  expectedAmount: number;
  expectedCurrency: string;
};

const CAUSE = "Blunt force trauma from a road traffic accident";
const policeReport = {
  documentType: "police_report",
  payload: {
    deceasedName: "Tan Yi Chuen Desmond", otherNamesMentioned: [], personIdentifiers: [],
    dateOfDeath: "2026-09-14", statedCauseOfDeath: CAUSE, mannerOfDeath: "accident",
    issuingAuthority: "SPF", documentReference: "REF-1", documentType: "police_report",
    pageCitations: [{ field: "statedCauseOfDeath", pageStart: 1, pageEnd: 1, excerpt: CAUSE }], confidence: {},
  },
  pages: [{ pageNumber: 1, text: `Police report. Deceased: Tan Yi Chuen Desmond. Date of death 2026-09-14. Cause of death: ${CAUSE}.` }],
};
const DIAGNOSIS = "Malignant neoplasm of the colon, stage III";
const specialistMemo = (documentType: string) => ({
  documentType,
  payload: {
    deceasedName: null, otherNamesMentioned: [], personIdentifiers: [], dateOfDeath: null, statedCauseOfDeath: null, mannerOfDeath: null,
    patientName: "Tan Yi Chuen Desmond", exactDiagnosis: DIAGNOSIS, diagnosisDate: "2026-06-01", diseaseStage: "Stage III",
    issuingAuthority: "Mount Example Hospital", documentReference: "MEMO-7", documentType,
    pageCitations: [{ field: "exactDiagnosis", pageStart: 1, pageEnd: 1, excerpt: DIAGNOSIS }], confidence: {},
  },
  pages: [{ pageNumber: 1, text: `Specialist memo. Patient: Tan Yi Chuen Desmond. Diagnosis: ${DIAGNOSIS}. Date of diagnosis 2026-06-01.` }],
});

export const BENEFIT_FIXTURES: BenefitCategoryFixture[] = [
  {
    category: "accidental-death", route: "match", claimEventType: "death", itemId: "gpa-accidental-death",
    facts: { eventType: "death", death: true, deathDate: "2026-09-14", eventDate: "2026-09-14" },
    policy: { insurer: "Singlife", productName: "Group Personal Accident", groupPolicyNumber: "G007500", category: "Personal Accident", amount: 600000, currency: "SGD", pages: singlifeDeathWording.benefitSummary.pages },
    otherCurrencyPages: singlifeDeathWording.benefitSummary.pages,
    decisionScope: {}, evidence: policeReport, expectedAmount: 600000, expectedCurrency: "SGD",
  },
  {
    category: "critical-illness", route: "ci-match", claimEventType: "diagnosis", itemId: "ci-major-major-critical-illness",
    facts: { eventType: "diagnosis", diagnosisDate: "2026-06-01", eventDate: "2026-06-01" },
    policy: {
      insurer: "Singlife", productName: "Living Care", groupPolicyNumber: "G007500", category: "Critical Illness", amount: 200000, currency: "SGD",
      pages: [{ pageNumber: 4, text: "Group Living Care benefit summary. Critical Illness Benefit: 100% of the Sum Insured is payable upon diagnosis of a covered Critical Illness." }],
    },
    otherCurrencyPages: [{ pageNumber: 4, text: "Group Living Care benefit summary. Critical Illness Benefit: 100% of the Sum Insured is payable upon diagnosis of a covered Critical Illness, subject to a maximum of US$150,000." }],
    decisionScope: { benefitCode: "ci-major", illnessName: "Major Critical Illness" },
    evidence: specialistMemo("specialist_memo"), expectedAmount: 200000, expectedCurrency: "SGD",
  },
  {
    category: "disability", route: "disability-match", claimEventType: "disability", itemId: "tpd-lump-sum",
    facts: { eventType: "disability", eventDate: "2026-06-01" },
    policy: {
      insurer: "Singlife", productName: "Group Personal Accident", groupPolicyNumber: "G007500", category: "Personal Accident", amount: 300000, currency: "SGD",
      pages: [{ pageNumber: 7, text: "Group Personal Accident benefit summary. Total and Permanent Disability: 100% of the Sum Insured is payable." }],
    },
    otherCurrencyPages: [{ pageNumber: 7, text: "Group Personal Accident benefit summary. Total and Permanent Disability: 100% of the Sum Insured is payable, subject to a maximum of US$100,000." }],
    decisionScope: { benefitCode: "tpd-lump-sum", matchKey: "total_permanent_disability" },
    evidence: specialistMemo("medical_report"), expectedAmount: 300000, expectedCurrency: "SGD",
  },
  {
    category: "travel", route: "travel-match", claimEventType: "death", itemId: "travel-accidental-death",
    facts: { eventType: "death", death: true, deathDate: "2026-09-14", eventDate: "2026-09-14", tripDepartureDate: "2026-09-10", tripReturnDate: "2026-09-20" },
    policy: {
      insurer: "TravelSure", productName: "TravelSure Single Trip", groupPolicyNumber: null, category: "Travel", amount: null, currency: "SGD",
      pages: [{ pageNumber: 2, text: "TravelSure Single Trip policy wording. Accidental Death Benefit: we will pay S$150,000 if you die as a result of an accident during your trip." }],
    },
    otherCurrencyPages: [{ pageNumber: 2, text: "TravelSure Single Trip policy wording. Accidental Death Benefit: we will pay US$150,000 if you die as a result of an accident during your trip." }],
    decisionScope: {}, evidence: policeReport, expectedAmount: 150000, expectedCurrency: "SGD",
  },
];

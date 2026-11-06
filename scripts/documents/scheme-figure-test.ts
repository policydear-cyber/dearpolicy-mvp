/** Scheme and long-term-care summaries, and figures a page prints that are not the person's own cover (lib/documents/
 * own-figure): what another scheme pays inside a private schedule, a total with another plan, an example or projection, a
 * premium, an example person in a brochure, a sample page, a letter's greeting. And a scheme's own statement of one
 * person's cover is read as that person's cover. Made-up English documents only; no model, no network. Both engines:
 * intake (verifiedExtraction, then the type a re-read stores) and the benefit table (checkReading). */
import assert from "node:assert/strict";
import { verifiedExtraction } from "../../lib/rag/ingest";
import { printedDocumentRole, documentAuthority } from "../../lib/documents/intelligence";
import { checkReading } from "../../lib/benefit-table/check";
import { factCheckExtraction } from "../../lib/documents/fact-check";
import { amountOnlyInContext, personAsParticulars, specimenPage } from "../../lib/documents/own-figure";
import type { PolicyExtraction } from "../../lib/ai/extract-policy";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n" + (e as Error).message); }
}

type Cov = [string, number, string];
const raw = (o: { role: PolicyExtraction["documentRole"]; confirmed?: boolean; people: [string, Cov[]][]; product?: string; number?: string; premium?: number | null }): PolicyExtraction => ({
  documentType: null, documentRole: o.role, documentNotes: [], insurer: null, productName: o.product ?? null, productsMentioned: [], policyNumber: o.number ?? null, groupPolicyNumber: null,
  policyType: null, policyholder: null, personalCoverageConfirmed: o.confirmed ?? true, startDate: null, renewalOrExpiryDate: null,
  insuredPeople: o.people.map(([name, covs]) => ({ name, relationshipHint: null, coverages: covs.map(([category, amount, evidenceText]) => ({ category, productName: null, policyNumber: null, amount, currency: "SGD", notes: null, sourcePage: 1, evidenceText, evidenceVerified: true })) })),
  referenceCoverages: [], premium: { amount: o.premium ?? null, currency: o.premium ? "SGD" : null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
} as unknown as PolicyExtraction);
const pages = (...texts: string[]) => texts.map((text, i) => ({ pageNumber: i + 1, text }));
/** The cover amounts intake would show: every coverage amount, when the reading confirms personal cover. */
const shown = (r: PolicyExtraction, p: { pageNumber: number; text: string }[]) => {
  const v = verifiedExtraction(r, p);
  return v.personalCoverageConfirmed ? v.insuredPeople.flatMap((x) => x.coverages.map((c) => c.amount).filter((a): a is number => a != null)) : [];
};

// ---- the helper ----
const ctx: [string, number, string | null][] = [
  ["This plan works with HealthBase, the public hospital scheme, which pays up to S$120,000 a year.", 120000, "other_payer"],
  ["We pay the monthly benefit less any payout from SilverYears Care (currently S$640).", 640, "other_payer"],
  ["Monthly benefit: S$1,500", 1500, null],
  ["This plan pays S$1,500 a month on top of SilverYears Care.", 1500, null],
  ["This supplement pays on top of SilverYears Care, which currently pays S$640 a month.", 640, "other_payer"],
  ["Total monthly payout with SilverYears Care: S$2,140", 2140, "combined_total"],
  ["Combined payout including your scheme benefit S$2,140", 2140, "combined_total"],
  ["Your payout grows by 2% a year, to S$780 in 2035.", 780, "projection"],
  ["Example: a 40-year-old who claims in 2031 receives S$700 a month.", 700, "example"],
  ["Annual premium: S$298.40 (from MediSave)", 298.4, "premium"],
  ["Sum assured payable on death S$200,000", 200000, null],
  ["Premium S$1,200 Sum assured S$100,000", 100000, null],
  ["Hospital cash S$100 per day (see page 4)", 100, null],
];
for (const [line, n, want] of ctx) check(`context of ${n} in "${line}"`, () => assert.equal(amountOnlyInContext(line, n, { premium: true }), want));
check("a figure printed once as cover and once as a scheme's is cover", () => assert.equal(amountOnlyInContext("Monthly benefit: S$640\nSilverYears Care, which currently pays S$640 a month.", 640, { premium: true }), null));
const people: [string, string, boolean][] = [
  ["Name of insured: NADIA BINTE HASSAN", "Nadia binte Hassan", true], ["Insured\tOwen Tay", "Owen Tay", true], ["Life assured: MARK LIEW KOK WAI", "Mark Liew", true],
  ["Ms Fiona Chua\n22 Orchid Lane", "Fiona Chua", true], ["Policyholder   GRACE NG (S****123A)", "Grace Ng", true],
  ["Meet Mdm Lily Seah, 61, who now gets a payout every month.", "Lily Seah", false], ["Dear Mr Victor Ho", "Victor Ho", false],
  ["Example: Benjamin Foo, born 1990, claims in 2030.", "Benjamin Foo", false], ["After her fall, Lily Seah could no longer bathe.", "Lily Seah", false],
  ["Ken Lau, 38, chose S$900 a month.", "Ken Lau", false],
  ["Insured Person: Lim Wei Jie (NRIC S****567A)", "Lim Wei Jie", true], ["Insured Person: Lim Wei Jie, age 35", "Lim Wei Jie", true],
  ["Insured: Tan Mei Ling and Lim Wei Jie", "Lim Wei Jie", true], ["This is to certify that LIM WEI JIE is insured under this policy.", "Lim Wei Jie", true],
  ["Lim Wei Jie\tS$100,000\tS$250.00", "Lim Wei Jie", true], ["Dear MR VICTOR HO", "Victor Ho", false], ["Example: MR ALAN GOH is in hospital for 4 days.", "Alan Goh", false],
];
for (const [text, who, want] of people) check(`${who} as particulars in "${text.split("\n")[0]}": ${want}`, () => assert.equal(personAsParticulars(who, text), want));
// Critic r377: ordinary insured lines keep their person; real own figures stay; a sentence mentioning a sample is no sample.
for (const [text, who] of [["Name of Life Assured Lim Wei Jie", "Lim Wei Jie"], ["Name Of Insured Person Lim Wei Jie", "Lim Wei Jie"], ["Insured Child: Tan Xiao Ming, 5 years", "Tan Xiao Ming"],
  ["Insured Child: Tan Xiao Ming born 3 Mar 2019", "Tan Xiao Ming"], ["No Name Relationship Sum Insured\n1 Lee Mei Ling Spouse S$100,000", "Lee Mei Ling"], ["This is to certify that Lim Wei Jie is insured under the policy below.", "Lim Wei Jie"],
  ["Insured person name Lim Wei Jie, NRIC S1234567A", "Lim Wei Jie"], ["Insured: Lee Mei Ling Female 12/03/1985", "Lee Mei Ling"], ["Insured Lee Mei Ling 40", "Lee Mei Ling"], ["Policyholder : LIM, WEI JIE", "Lim Wei Jie"]])
  check(`${who} as particulars in "${text}"`, () => assert.equal(personAsParticulars(who, text), true));
for (const [line, n] of [["The sum assured will be paid on death: S$500,000", 500000], ["Your benefit will be S$100 per day", 100], ["Premium waiver: S$100,000 sum assured", 100000],
  ["Instalment premium protection S$5,000", 5000], ["Death benefit together with bonuses S$80,000", 80000]] as [string, number][])
  check(`own figure: "${line}"`, () => assert.equal(amountOnlyInContext(line, n, { premium: true }), null));
check("a projection with 'will be' and a later year", () => assert.equal(amountOnlyInContext("Your payout will be S$717 a month in 2030.", 717), "projection"));
check("a sentence mentioning a sample copy is no sample page", () => assert.equal(specimenPage("Dear Mr Lim\nWe enclose a sample copy of the policy wording for reference.\nLife Assured: Lim Wei Jie"), false));
check("intake: a template 'Coverage Summary' (placeholder person) is no personal schedule", () => assert.notEqual(printedDocumentRole(pages("COVERAGE SUMMARY\nPolicy No: 12345678\nInsured Person: Your Name Here\nSum insured S$100,000") as never), "personal_schedule"));
check("intake: a template with John Doe is no personal schedule", () => assert.notEqual(printedDocumentRole(pages("Coverage Summary\nPolicy No.: ABC-123456\nPolicyholder: John Doe") as never), "personal_schedule"));
check("a sample page", () => assert.equal(specimenPage("SilverYears Care\nSAMPLE STATEMENT\nName of insured: TEO AH BENG"), true));
check("a schedule is not a sample", () => assert.equal(specimenPage("Policy Schedule\nLife assured: OWEN TAY\nSum assured S$100,000"), false));

// ---- intake ----
const SCHEME_STATEMENT = "Elder Care Fund Board\nSilverYears Care\nStatement of Coverage\nName of insured: NADIA BINTE HASSAN\nPolicy number: SY-40917733\nCover start date: 1 July 2025\nMonthly payout if severely disabled: S$640\nAnnual premium: S$298.40 (paid from MediSave)\nYour payout grows by 2% a year, to S$780 in 2035.";
const SUPPLEMENT_SCHEDULE = "Brightwater Life\nGoldenCare Top-Up\nPolicy Schedule\nLife assured: MARK LIEW KOK WAI\nPolicy number: GTU-3304417\nMonthly benefit: S$1,500\nPremium: S$52.10 monthly\nThis plan pays on top of SilverYears Care, which currently pays S$640 a month.\nTotal monthly payout with SilverYears Care: S$2,140";
const HOSPITAL_SCHEDULE = "Brightwater Life\nBrightwater Hospital Prime\nPolicy Schedule\nLife assured: OWEN TAY\nPolicy number: BHP-7781902\nAnnual limit: S$2,000,000\nThis plan works with HealthBase, the public hospital scheme, which pays up to S$120,000 a year.";
const BROCHURE = "SilverYears Care\nA guide to the national long-term care scheme\nIf you can no longer do 3 of the 6 activities of daily living, SilverYears Care pays you every month.\nMeet Mdm Lily Seah, 61\nAfter her fall, Lily Seah could no longer bathe or dress. She now gets S$640 a month from SilverYears Care.";
const SAMPLE = "SilverYears Care\nReading your statement\nSAMPLE STATEMENT\nName of insured: TEO AH BENG\nPolicy number: SY-00000002\nMonthly payout if severely disabled: S$640";
const PREMIUM_NOTICE = "Elder Care Fund Board\n3 October 2026\nMr Victor Ho\n8 Cedar Walk, Singapore 654321\nDear Mr Victor Ho\nSilverYears Care premium notice\nPolicy number: SY-55110022\nYour premium for the coming year is S$331.60. It will be deducted from your MediSave account.";

check("intake: a scheme's statement of one person's cover is a personal schedule (item 5)", () => assert.equal(printedDocumentRole(pages(SCHEME_STATEMENT) as never), "personal_schedule"));
check("intake: 'Coverage Summary' with the person and number is a personal schedule", () => assert.equal(printedDocumentRole(pages(SCHEME_STATEMENT.replace("Statement of Coverage", "Coverage Summary")) as never), "personal_schedule"));
check("intake: a sample statement is no personal schedule", () => assert.notEqual(printedDocumentRole(pages(SAMPLE.replace("Reading your statement", "Statement of Coverage")) as never), "personal_schedule"));
check("intake: a group coverage summary (group number, no person) is no personal schedule", () => assert.notEqual(printedDocumentRole(pages("Coverage Summary\nGroup policy number: GP-200311\nAll eligible employees are covered for S$50,000.") as never), "personal_schedule"));
check("intake: the scheme statement's own payout is shown; its premium and projection are not", () => assert.deepEqual(shown(raw({ role: "personal_schedule", people: [["Nadia binte Hassan", [["Long-term care", 640, "Monthly payout if severely disabled: S$640"], ["Long-term care", 298.4, "Annual premium: S$298.40"], ["Long-term care", 780, "to S$780 in 2035"]]]] }), pages(SCHEME_STATEMENT)), [640]));
check("intake: personal proof once the type is printed", () => assert.equal(documentAuthority("personal_schedule", true).kind, "personal"));
check("intake: the supplement's own benefit is shown; the scheme's figure and the combined total are not (items 1, 4)", () => assert.deepEqual(shown(raw({ role: "personal_schedule", people: [["Mark Liew Kok Wai", [["Long-term care", 1500, "Monthly benefit: S$1,500"], ["Long-term care", 640, "which currently pays S$640 a month"], ["Long-term care", 2140, "Total monthly payout with SilverYears Care: S$2,140"]]]] }), pages(SUPPLEMENT_SCHEDULE)), [1500]));
check("intake: a public scheme's limit inside a private hospital schedule is not the person's (item 1)", () => assert.deepEqual(shown(raw({ role: "personal_schedule", people: [["Owen Tay", [["Hospitalisation", 2000000, "Annual limit: S$2,000,000"], ["Hospitalisation", 120000, "which pays up to S$120,000 a year"]]]] }), pages(HOSPITAL_SCHEDULE)), [2000000]));
check("intake: a brochure's example person gets no cover, however the reader read it", () => assert.deepEqual(shown(raw({ role: "personal_schedule", people: [["Lily Seah", [["Long-term care", 640, "She now gets S$640 a month"]]]] }), pages(BROCHURE)), []));
check("intake: a sample statement gives no one cover", () => assert.deepEqual(shown(raw({ role: "annual_statement", people: [["Teo Ah Beng", [["Long-term care", 640, "Monthly payout if severely disabled: S$640"]]]] }), pages(SAMPLE)), []));
check("intake: a premium notice's premium is never cover (item 3)", () => assert.deepEqual(shown(raw({ role: "premium_receipt", people: [["Victor Ho", [["Long-term care", 331.6, "Your premium for the coming year is S$331.60"]]]] }), pages(PREMIUM_NOTICE)), []));

// ---- benefit table ----
const reading = (text: string, person: string, product: string, sum: number | null, quote: string, benefits: Record<string, unknown>[] = []) =>
  checkReading({ id: "cccccccc-0000-0000-0000-000000000003", name: "doc.pdf", readable: true, pages: [{ page: 1, text }] }, {
    document: { kind: "personal_proof", product, insurer: null, namedPeople: [person], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person, product, cover: "Cover", plan: null, riderOf: null, policyNumber: null, sumInsured: sum, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote }],
    benefits: benefits.map((o) => ({ section: "BENEFITS", column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o })) } as never);
const covers = (r: ReturnType<typeof checkReading>) => r.covers.map((c) => [c.person, c.sumInsured]);
check("table: the scheme statement's cover is kept with its payout", () => assert.deepEqual(covers(reading(SCHEME_STATEMENT, "NADIA BINTE HASSAN", "SilverYears Care", 640, "Monthly payout if severely disabled: S$640")), [["NADIA BINTE HASSAN", 640]]));
check("table: the scheme's premium is not the cover's sum (item 3)", () => assert.deepEqual(covers(reading(SCHEME_STATEMENT, "NADIA BINTE HASSAN", "SilverYears Care", 298.4, "Annual premium: S$298.40 (paid from MediSave)")), [["NADIA BINTE HASSAN", null]]));
check("table: a public scheme's limit is not the private cover's sum (item 1)", () => assert.deepEqual(covers(reading(HOSPITAL_SCHEDULE, "OWEN TAY", "Brightwater Hospital Prime", 120000, "This plan works with HealthBase, the public hospital scheme, which pays up to S$120,000 a year.")), [["OWEN TAY", null]]));
check("table: the private cover's own sum is kept", () => assert.deepEqual(covers(reading(HOSPITAL_SCHEDULE, "OWEN TAY", "Brightwater Hospital Prime", 2000000, "Annual limit: S$2,000,000")), [["OWEN TAY", 2000000]]));
check("table: a combined total is not the supplement's sum (item 4)", () => assert.deepEqual(covers(reading(SUPPLEMENT_SCHEDULE, "MARK LIEW KOK WAI", "GoldenCare Top-Up", 2140, "Total monthly payout with SilverYears Care: S$2,140")), [["MARK LIEW KOK WAI", null]]));
check("table: a brochure's example person is no cover (item 2)", () => assert.deepEqual(covers(reading(BROCHURE, "Lily Seah", "SilverYears Care", 640, "She now gets S$640 a month from SilverYears Care.")), []));
check("table: a sample statement is no cover (item 2)", () => assert.deepEqual(covers(reading(SAMPLE, "TEO AH BENG", "SilverYears Care", 640, "Monthly payout if severely disabled: S$640")), []));
check("table: a generic letter's addressee is no cover (item 2)", () => assert.deepEqual(covers(reading("Care Support Office\nDear Mr Victor Ho\nThank you for asking about Care Support. Eligible persons get up to S$300 a month.", "Victor Ho", "Care Support", 300, "Eligible persons get up to S$300 a month.")), []));
check("table: a wording's worked example is no cover (item 2)", () => assert.deepEqual(covers(reading("Hospital Prime policy wording\nHow we pay a claim\nExample: Mr Alan Goh is in hospital for 4 days and his bill is S$12,000. We pay S$9,000.", "Alan Goh", "Hospital Prime", 9000, "We pay S$9,000.")), []));
check("table: a benefit figure that is the scheme's is kept without it (item 1)", () => {
  const r = reading(SUPPLEMENT_SCHEDULE, "MARK LIEW KOK WAI", "GoldenCare Top-Up", null, "Life assured: MARK LIEW KOK WAI", [{ benefit: "Scheme payout", pays: "per_period", period: "month", value: 640, quote: "This plan pays on top of SilverYears Care, which currently pays S$640 a month." }, { benefit: "Monthly benefit", pays: "per_period", period: "month", value: 1500, quote: "Monthly benefit: S$1,500" }]);
  assert.deepEqual(r.benefits.map((b) => [b.benefit, b.value]), [["Scheme payout", null], ["Monthly benefit", 1500]]);
});

// TE and Critic r377: the shapes are tied to a named other payer or a premium being paid; banners only; insured lists.
const A2: [string, string, boolean][] = [
  ["Insured persons: Tan Ah Kow, Lee Mei Ling and Tan Xiao Ming", "Tan Ah Kow", true], ["Insured persons: Tan Ah Kow, Lee Mei Ling and Tan Xiao Ming", "Lee Mei Ling", true],
  ["Insured persons: Tan Ah Kow, Lee Mei Ling and Tan Xiao Ming", "Tan Xiao Ming", true], ["Insured: Lim Wei Jie, born 3 March 1980", "Lim Wei Jie", true],
  ["Insured: Lee Mei Ling, Male, 45", "Lee Mei Ling", true], ["We hereby certify that Mr Lim Wei Jie, born 1 May 1980, is insured under this policy.", "Lim Wei Jie", true],
  ["This is to certify that Lim Wei Jie is insured.", "Lim Wei Jie", true], ["Lives assured: Tan Ah Kow & Lee Mei Ling", "Lee Mei Ling", true],
  ["Meet Mdm Lily Seah, 61", "Lily Seah", false], ["Example: Benjamin Foo, born 1990, claims.", "Benjamin Foo", false], ["Ken Lau, 38, chose S$900 a month.", "Ken Lau", false], ["Dear Mr Victor Ho", "Victor Ho", false],
];
for (const [t, w, want] of A2) check(`TE r377 particulars: ${w} in "${t}": ${want}`, () => assert.equal(personAsParticulars(w, t), want));
const B2: [string, boolean][] = [["SPECIMEN ONLY", true], ["SPECIMEN - NOT VALID FOR CLAIMS", true], ["Sample only - this is not an actual policy", true], ["FOR ILLUSTRATION PURPOSES ONLY. This document is not a policy.", false], ["DUMMY", true], ["*** SPECIMEN ***", true],
  ["A specimen policy contract is available at www.example.com", false], ["We enclose a sample copy of the wording.", false], ["Sample collection fee S$50", false], ["Sample tests: up to S$500", false], ["SYNTHETIC TEST DOCUMENT - fictional insurer and persons - not a real policy", false], ["Specimen signature", false]];
for (const [t, want] of B2) check(`TE r377 sample banner "${t}": ${want}`, () => assert.equal(specimenPage(t), want));
const D2: [string, number, string | null][] = [["Rider premium waiver sum assured: S$100,000", 100000, null], ["Death benefit (including return of premiums): S$250,000", 250000, null], ["Accident rider, which pays S$50,000 on accidental death", 50000, null],
  ["Payable on top of the death benefit: S$20,000", 20000, null], ["Combined limit for hospital and surgical, including outpatient: S$100,000", 100000, null], ["Sample tests: up to S$500", 500, null], ["The sum assured will be paid on death: S$500,000", 500000, null],
  ["This plan works with HealthBase, the public hospital scheme, which pays up to S$120,000 a year.", 120000, "other_payer"], ["We pay the benefit less any payout from SilverYears Care (currently S$640).", 640, "other_payer"],
  ["Total monthly payout with SilverYears Care: S$2,140", 2140, "combined_total"], ["Annual premium: S$298.40", 298.4, "premium"], ["Your premium for the coming year is S$331.60.", 331.6, "premium"], ["Premium (paid from MediSave): S$298.40", 298.4, "premium"],
  ["Example: a 40-year-old receives S$700 a month.", 700, "example"], ["Premium waiver benefit sum assured S$100,000", 100000, null], ["Instalment Protection Benefit S$5,000", 5000, null]];
for (const [t, n, want] of D2) check(`TE r377 context of ${n} in "${t}"`, () => assert.equal(amountOnlyInContext(t, n, { premium: true }), want));

// TE and Critic r377 round 2: an own rider is never "another payer"; waiver of premium is cover; banners are whole short lines.
const D3: [string, number, string | null][] = [["This plan works with the Hospital Cash Rider, which pays S$100 per day.", 100, null], ["Works with SilverCare Rider, which pays S$100 a day.", 100, null],
  ["We pay the benefit less any payout from MediCare Rider (currently S$500).", 500, null], ["Waiver of premium: S$100,000", 100000, null], ["Waiver of Premium Benefit S$50,000", 50000, null],
  ["Return of premium on death: S$12,000", 12000, null], ["This plan works with HealthBase, which pays up to S$120,000 a year.", 120000, "other_payer"]];
for (const [t, n, want] of D3) check(`r377b context of ${n} in "${t}"`, () => assert.equal(amountOnlyInContext(t, n, { premium: true }), want));
const B3: [string, boolean][] = [["SAMPLE POLICY SCHEDULE", true], ["Specimen Certificate of Insurance", true], ["MOCK-UP - NOT A REAL POLICY", true], ["EXAMPLE ONLY", false], ["VOID - SPECIMEN", true],
  ["TEST DOCUMENT - NOT FOR ISSUE", false], ["*** Sample schedule for training ***", true], ["Specimen Policy Schedule", true],
  ["Sample - Blood test: up to S$500", false], ["Sample Collection Benefit", false], ["Sample", true], ["Example: a 40-year-old receives S$700 a month.", false]];
for (const [t, want] of B3) check(`r377b sample banner "${t}": ${want}`, () => assert.equal(specimenPage(t), want));
check("r377b a lab-sample benefit line keeps the schedule real", () => assert.equal(specimenPage("Policy Schedule\nLife assured: OWEN TAY\nSample - Blood test: up to S$500\nSum assured S$100,000"), false));
const A3: [string, string, boolean][] = [["Covered person - Lim Wei Jie", "Lim Wei Jie", true], ["Covered persons: Tan Ah Kow, Lee Mei Ling", "Lee Mei Ling", true], ["Insured traveller: Lee Mei Ling", "Lee Mei Ling", true],
  ["Certificate No: TRV-204411\nTraveller(s): Tan Ah Kow, Lee Mei Ling", "Tan Ah Kow", true], ["Policy number: GH-55012\nCovered member: Tan Xiao Ming, 5", "Tan Xiao Ming", true]];
for (const [t, w, want] of A3) check(`r377b particulars: ${w} in "${t}": ${want}`, () => assert.equal(personAsParticulars(w, t), want));

// Critic r377c: notes, conditions and signature stamps on real schedules are no banner; an "illustrative" person is no one's.
const B4: [string, boolean][] = [["Void if altered", false], ["VOID IF NOT SIGNED", false], ["SPECIMEN SIGNATURE OF AUTHORISED OFFICER", false], ["Specimen signature: ____", false],
  ["Example only - see policy wording for full terms", false], ["Example: how a claim is paid", false], ["Previous policy: VOID", false], ["Mock-up of your member card below", false],
  ["Sample statement of account enclosed", false], ["VOID", false], ["DUMMY", false]];
for (const [t, want] of B4) check(`r377c banner "${t}" on a real schedule: ${want}`, () => assert.equal(specimenPage("POLICY SCHEDULE\nPolicy No. TL-100245\nLife Assured: Lim Wei Jie\nSum Assured S$500,000\n" + t), want));
check("r377c an illustrative covered person is no one's", () => assert.equal(personAsParticulars("Rosalind Teo", "Covered person: Rosalind Teo (illustrative)"), false));
check("r377c a covered-persons table keeps its row", () => assert.equal(personAsParticulars("Lee Mei Ling", "Covered Persons\tRelationship\nLee Mei Ling\tSpouse"), true));

// TE r377 round 3: a banner names the document itself and sits in the heading block or footer; the person's own scheme is
// never "another payer"; "Traveller" and "Covered member" count only on a page with its own policy or certificate number.
const REAL = "POLICY SCHEDULE\nPolicy No. TL-100245\nLife Assured: Lim Wei Jie\nSum Assured S$500,000\nNotes\nPlease keep this schedule with your policy.\nYour cover starts on the date shown.\n";
const B5: [string, string, boolean][] = [
  ["EXAMPLE ONLY above a worked example in the notes", REAL + "EXAMPLE ONLY\nIf you are in hospital for 4 days we pay S$400.\nClaims must be made within 90 days.\nCall us any time.\nThank you.", false],
  ["VOID IF ALTERED footer", REAL + "VOID IF ALTERED", false],
  ["SPECIMEN COLLECTION heading on a health schedule", "HEALTH SCHEDULE\nPolicy No. HS-22019\nInsured: Lim Wei Jie\nSPECIMEN COLLECTION\nUp to S$50 a visit", false],
  ["a body line SAMPLE far from the heading", REAL + "SAMPLE\nLab tests are covered.\nOne more line.\nAnother line.\nLast line.", false],
  ["a lone SAMPLE under the title", "POLICY SCHEDULE\nSAMPLE\nPolicy No. TL-000000\nLife Assured: Tan Ah Kow\nSum Assured S$500,000", true],
  ["SPECIMEN banner in the footer", REAL + "SPECIMEN - NOT VALID FOR CLAIMS", true],
  ["POLICY SCHEDULE (SPECIMEN) title: brackets are never the banner", "POLICY SCHEDULE (SPECIMEN)\nLife Assured: Tan Ah Kow\nSum Assured S$500,000", false],
  ["VOID - SPECIMEN title", "VOID - SPECIMEN\nPolicy Schedule\nLife Assured: Tan Ah Kow", true],
  ["a lone Sample cell between a label and its figure", "Life Assured: Lim Wei Jie\nSample\nS$50", false],
];
for (const [n, t, want] of B5) check(`r377 round 3 sample page: ${n}: ${want}`, () => assert.equal(specimenPage(t), want));
// The own scheme is the one the page's own heading names, never a reading's product (TE round 4).
const D4: [string, number, string, string | null][] = [
  ["Your SilverYears Care, the national long-term care scheme, which pays up to S$1,200 a month.", 1200, "", null],
  ["SilverYears Care, the national long-term care scheme, currently pays you S$640 a month.", 640, "", null],
  ["SilverYears Care, the national long-term care scheme, which currently pays S$640 a month.", 640, "Elder Care Fund Board\nSilverYears Care\nStatement of Coverage\n", null],
  ["This plan works with SilverYears Care, which currently pays S$640 a month.", 640, "SilverYears Care\nStatement of Coverage\n", null],
  ["This plan works with SilverYears Care, which currently pays S$640 a month.", 640, "Brightwater Life\nGoldenCare Top-Up\nPolicy Schedule\n", "other_payer"],
  ["SilverYears Care, the national long-term care scheme, which currently pays S$640 a month.", 640, "Brightwater Life\nGoldenCare Top-Up\nPolicy Schedule\n", "other_payer"],
  ["We pay the benefit less any payout from SilverYears Care (currently S$640).", 640, "Brightwater Life\nGoldenCare Top-Up\nPolicy Schedule\n", "other_payer"],
  ["This plan works with HealthBase, the public hospital scheme, which pays up to S$120,000 a year.", 120000, "Brightwater Life\nBrightwater Hospital Prime\nPolicy Schedule\n", "other_payer"]];
for (const [t, n, head, want] of D4) check(`r377 own scheme: ${n} in "${t}" under "${head.split("\n").filter(Boolean).join(" / ") || "no heading"}"`, () => assert.equal(amountOnlyInContext(head + t, n, { premium: true }), want));
check("table: a scheme figure in a supplement schedule is dropped even when the reading names the scheme as the product (round 4)", () => assert.deepEqual(covers(reading(SUPPLEMENT_SCHEDULE, "MARK LIEW KOK WAI", "SilverYears Care", 640, "which currently pays S$640 a month")), [["MARK LIEW KOK WAI", null]]));
check("table: a benefit's scheme figure is dropped even when the reading names the scheme as the product (round 4)", () => {
  const r = checkReading({ id: "cccccccc-0000-0000-0000-000000000004", name: "doc.pdf", readable: true, pages: [{ page: 1, text: SUPPLEMENT_SCHEDULE }] }, { document: { kind: "personal_proof", product: "SilverYears Care", insurer: null, namedPeople: ["MARK LIEW KOK WAI"], plan: null, periodFrom: null, periodTo: null }, covers: [],
    benefits: [{ benefit: "Scheme payout", section: "BENEFITS", column: null, pays: "per_period", period: "month", value: 640, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "This plan pays on top of SilverYears Care, which currently pays S$640 a month." }] } as never);
  assert.deepEqual(r.benefits.map((b) => b.value), [null]);
});
// Per page (Critic r377d): a pack's specimen appendix page does not clear the schedule; a page-1 heading banner clears all.
const PACK = (p2: string) => pages("POLICY SCHEDULE\nPolicy No. TL-100245\nLife Assured: Lim Wei Jie\nSum Assured S$500,000", p2);
const lim = () => raw({ role: "personal_schedule", people: [["Lim Wei Jie", [["Life", 500000, "Sum Assured S$500,000"]]]] });
check("intake (reader-typed): a SPECIMEN POLICY CONTRACT appendix page keeps the schedule's cover", () => assert.deepEqual(factCheckExtraction(lim(), PACK("SPECIMEN POLICY CONTRACT\nGeneral Conditions\n1. Definitions"), { roleFromReader: true }).extraction.insuredPeople.flatMap((p) => p.coverages.map((c) => c.amount)), [500000]));
check("intake (reader-typed): a SAMPLE LETTER page keeps the schedule's cover", () => assert.deepEqual(factCheckExtraction(lim(), PACK("SAMPLE LETTER\nTo: The Insurer\nI wish to nominate"), { roleFromReader: true }).extraction.insuredPeople.flatMap((p) => p.coverages.map((c) => c.amount)), [500000]));
check("intake (reader-typed): a page-1 SAMPLE heading sets the whole pack aside", () => assert.deepEqual(factCheckExtraction(lim(), pages("SAMPLE POLICY SCHEDULE\nPolicy No. TL-100245\nLife Assured: Lim Wei Jie", "Sum Assured S$500,000"), { roleFromReader: true }).extraction.insuredPeople.flatMap((p) => p.coverages.map((c) => c.amount)), []));
check("a lone Sample at the foot after the last figure is a row label", () => assert.equal(specimenPage("POLICY SCHEDULE\nPolicy No. TL-100245\nLife Assured: Lim Wei Jie\nSum Assured S$500,000\nSample"), false));
check("whole text: an appendix page's SPECIMEN COPY footer is no sample", () => assert.equal(specimenPage("POLICY SCHEDULE\nLife Assured: Lim Wei Jie\nSum Assured S$500,000\fGeneral Conditions\nThe policy pays S$1\nSPECIMEN COPY"), false));
check("brackets in a title are no banner", () => assert.equal(specimenPage("Policy Schedule (sample collection included)\nPolicy No. TL-1\nLife Assured: Lim Wei Jie"), false));
const A4: [string, string, boolean][] = [["How it works\nTraveller: Rosalind Teo, 34\nShe claims S$5,000 for a cancelled trip.", "Rosalind Teo", false],
  ["Family plan explained\nCovered member - Rosalind Teo", "Rosalind Teo", false], ["Certificate of Insurance\nCertificate No. TRV-88123\nTraveller: Rosalind Teo, 34", "Rosalind Teo", true],
  ["Group Health\nPolicy No: GH-55012\nCovered member - Rosalind Teo", "Rosalind Teo", true]];
for (const [t, w, want] of A4) check(`r377 round 3 weak label: ${w} in "${t.split("\n")[0]}": ${want}`, () => assert.equal(personAsParticulars(w, t), want));
check("table: the person's own scheme statement keeps its payout (round 3)", () => assert.deepEqual(covers(reading("Elder Care Fund Board\nSilverYears Care\nStatement of Coverage\nName of insured: NADIA BINTE HASSAN\nPolicy number: SY-40917733\nYour SilverYears Care, the national long-term care scheme, which pays S$640 a month if severely disabled.", "NADIA BINTE HASSAN", "SilverYears Care", 640, "which pays S$640 a month if severely disabled")), [["NADIA BINTE HASSAN", 640]]));

// TE r377 round 5: a sample word inside a title's brackets never sets aside the labelled insured under it.
const KESTREL = "Kestrel Health\nPolicy Schedule (sample collection included)\nInsured person: Priya Nair\nPolicy number: KH-41200\nAnnual limit: S$350,000";
check("round 5: a labelled insured under a title with a bracketed sample word is particulars", () => assert.equal(personAsParticulars("Priya Nair", KESTREL), true));
check("round 5: the table keeps that cover and its sum", () => assert.deepEqual(covers(reading(KESTREL, "Priya Nair", "Kestrel Health", 350000, "Annual limit: S$350,000")), [["Priya Nair", 350000]]));
check("round 5: an 'Example' heading line still sets aside the person under it", () => assert.equal(personAsParticulars("Ahmad Yusof", "Example\nAhmad Yusof, 40, male\nPremium S$1,200"), false));

console.log(`scheme-figure: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

/**
 * What kind of paper an upload is, decided by plain code from what it prints (lib/documents/intelligence.ts,
 * lib/documents/messy.ts, lib/ai/extract-policy.ts). Four layouts a real household library stored with the wrong
 * role, rebuilt here with invented names and numbers:
 *
 *   1 a group certificate's Part 2 "Highlights of Cover" on its own (the scheme's generic terms) was stored as a
 *     personal certificate;
 *   2 a cover letter sent with the policy ("Your policy is now ready", policy schedule on page 3) was stored as an
 *     insurer letter, so the schedule's cover and its insured person were dropped;
 *   3 a personal "travel insurance summary" (policy number, policyholder, dates) was stored as generic policy wording,
 *     so nobody was read as insured and no dates were kept;
 *   4 a document titled "Policy wording" that describes endorsements was stored as an endorsement.
 *
 * Each case has a negative control that must keep its old role. Pure: no database, no model.
 */
import assert from "node:assert/strict";
import type { PdfPage } from "@/lib/documents/pdf";

let cases = 0;
const failed: string[] = [];
async function t(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); cases++; console.log("  ok  " + name); }
  catch (error) { failed.push(name); console.error("  FAIL " + name + ": " + (error instanceof Error ? error.message.split("\n")[0] : String(error))); }
}

async function main() {
  const { deterministicDocumentRole, sanitizePolicyExtraction } = await import("@/lib/documents/intelligence");
  const { correspondenceRole } = await import("@/lib/documents/messy");
  const { detectHighConfidenceReferenceRole, buildCodeOnlyExtraction } = await import("@/lib/ai/extract-policy");
  const doc = (...texts: string[]): PdfPage[] => texts.map((text, i) => ({ pageNumber: i + 1, text } as PdfPage));

  // 1. Part 2 of a group certificate on its own
  const partTwo = doc(
    "POLICY OWNERS' PROTECTION SCHEME\nThese policies are protected under the Policy Owners' Protection Scheme.\nHARBOUR UNIONS GROUP INSURANCE SCHEME (GROUP POLICY NO. G123400)\nCERTIFICATE OF INSURANCE PART 2: HIGHLIGHTS OF COVER\nFor the purpose of Part 2 of this Certificate of Insurance, \"you\" means the Insured Person.",
    "4) Full Disclosure\nAll material facts up to the Effective Date of cover must be disclosed.\n5) Premium Rates\nPremium rates are specified in the relevant Policy.",
    "Group Personal Accident\nSimple Fracture\t25% of Sum Insured, up to S$5,000",
  );
  await t("1: Part 2 Highlights of Cover on its own is a benefits guide, not a certificate", () => {
    assert.equal(deterministicDocumentRole(partTwo, null), "benefit_guide");
    assert.equal(deterministicDocumentRole(partTwo, "certificate"), "benefit_guide", "a model saying certificate does not make generic terms personal");
    assert.equal(detectHighConfidenceReferenceRole(partTwo), "benefit_guide");
  });
  await t("1: Part 2 read as a certificate by the model confirms nobody's cover", () => {
    const raw = { ...buildCodeOnlyExtraction(partTwo), documentRole: "certificate" as const, personalCoverageConfirmed: true };
    const kept = sanitizePolicyExtraction(raw, partTwo);
    assert.equal(kept.documentRole, "benefit_guide");
    assert.equal(kept.personalCoverageConfirmed, false);
  });
  await t("1 control: a certificate with Part 1 particulars and Part 2 highlights stays a certificate", () => {
    const combined = doc(
      "CERTIFICATE OF GROUP INSURANCE\nHARBOUR UNIONS GROUP INSURANCE SCHEME (GROUP POLICY NO. G123400)\nProduct, Policy Number, Particulars of Insured Person(s) and Sum Assured\tEffective Date\nGROUP TERM LIFE (POLICY NO. 1234567)\nLim Wei Jie\tS$500,000\tAs of 01/02/2023",
      "CERTIFICATE OF INSURANCE PART 2: HIGHLIGHTS OF COVER\nGroup Term Life benefits.",
    );
    assert.equal(deterministicDocumentRole(combined, null), "certificate");
    assert.equal(detectHighConfidenceReferenceRole(combined), null);
  });

  await t("1 control (R51-2): a certificate printing Part 1 as Life Assured / Sum Assured / Effective Date stays a certificate", () => {
    const lifeAssured = doc(
      "CERTIFICATE OF INSURANCE\nLife Assured: Lim Wei Jie\nSum Assured S$500,000\nEffective Date 01/02/2023",
      "CERTIFICATE OF INSURANCE PART 2: HIGHLIGHTS OF COVER\nGroup Term Life benefits.",
    );
    assert.equal(deterministicDocumentRole(lifeAssured, null), "certificate");
    const nameLine = doc(
      "CERTIFICATE OF INSURANCE\nGROUP PERSONAL ACCIDENT\nLim Wei Jie\tS$600,000\tAs of 06/10/2022",
      "CERTIFICATE OF INSURANCE PART 2: HIGHLIGHTS OF COVER\nGroup Personal Accident benefits.",
    );
    assert.equal(deterministicDocumentRole(nameLine, null), "certificate");
  });

  await t("1/3 control (R53-1): definitions are not names", () => {
    const definitions = doc(
      "CERTIFICATE OF INSURANCE PART 2: HIGHLIGHTS OF COVER\nInsured Person: any member of the Scheme\nLife Assured: the person named in Part 1",
      "Plan A Sum Insured: S$100,000\nPlan B Sum Insured: S$50,000",
    );
    assert.equal(deterministicDocumentRole(definitions, null), "benefit_guide");
    const master = doc("Harbour Group Insurance Summary\nMaster Policy No. G123400\nInsured Person: any eligible employee of the company");
    assert.notEqual(deterministicDocumentRole(master, null), "personal_schedule");
    const definedHolder = doc("Your travel insurance summary\nPolicy number : TRV2026-00012345\nPolicyholder: means the person who bought this policy");
    assert.notEqual(deterministicDocumentRole(definedHolder, null), "personal_schedule");
  });

  // 2. A cover letter sent with the policy
  const letter = "Mr Lim Wei Jie\tCustomer Service\nBlk 1 Example Road\tHotline: (65) 6000 0000\n1 March 2026\nDear Mr Lim\nYour Example Critical Illness Policy is now ready\nHere's your policy document for your safekeeping.";
  const signOff = "Thank you for choosing Example Life.\nYours sincerely\nA Person\nHead of Operations";
  const schedule = "Example Life Ltd\nPolicy Schedule\nDetails of Policy\nPolicy Number\t: 77001234\tPolicy Issue Date\t: 01/03/2026\nPlan\t: Example Critical Illness\nAssured\t: Lim Wei Jie\nLife Assured\t: Lim Wei Jie\nSum Assured\t: 200,000.00";
  const welcomePack = doc(letter, signOff, schedule, "GENERAL PROVISIONS\n1. DEFINITIONS");
  await t("2: a letter enclosing its policy schedule is the policy, not correspondence", () => {
    assert.equal(correspondenceRole(welcomePack), null);
    assert.equal(deterministicDocumentRole(welcomePack, null), "personal_schedule");
    assert.equal(detectHighConfidenceReferenceRole(welcomePack), null, "goes to the personal reading, which names the insured");
  });
  await t("2: the enclosed schedule's insured person and cover survive sanitising", () => {
    const raw = { ...buildCodeOnlyExtraction(welcomePack), documentRole: "insurer_letter" as const, personalCoverageConfirmed: true,
      insuredPeople: [{ name: "Lim Wei Jie", relationshipHint: null, coverages: [{ category: "Critical Illness", productName: "Example Critical Illness", policyNumber: "77001234", amount: 200000, currency: "SGD", notes: null, sourcePage: 3, evidenceText: "Sum Assured\t: 200,000.00", evidenceVerified: false }] }] };
    const kept = sanitizePolicyExtraction(raw, welcomePack);
    assert.equal(kept.documentRole, "personal_schedule");
    assert.equal(kept.insuredPeople.length, 1);
    assert.equal(kept.insuredPeople[0].coverages.length, 1);
  });
  await t("2 control: a letter that only mentions the policy schedule is still a letter", () => {
    const plain = doc(letter.replace("Here's your policy document for your safekeeping.", "Your policy terms are changing from 1 April 2027."), signOff, "Questions and answers\nWhat changes?\nThe Policy Schedule you hold stays the same.");
    assert.equal(correspondenceRole(plain), "insurer_letter");
    const quoting = doc(letter, signOff + "\nPlease refer to the Policy Schedule we sent last year.");
    assert.equal(correspondenceRole(quoting), "insurer_letter", "a title deep inside a page is not an enclosed document");
  });

  // 3. A personal travel insurance summary
  const summary = doc("Your travel insurance summary\nPlease call +65-6000-0000 for Overseas Emergency Assistance.\nPolicy number\t: TRV2026-00012345\nAbout this policy\nPlan name\t: Business\tCoverage start date : 01/09/2026\nCoverage end date : 06/09/2026\nAbout you (As the policyholder)\nYour name\t: Lim Wei Jie\nWho is insured under this policy\nLim Wei Jie\nPlease refer to the policy wording for the specific terms, conditions and exclusions of this policy.");
  await t("3: a travel insurance summary naming its policyholder is a personal schedule", () => {
    assert.equal(deterministicDocumentRole(summary, null), "personal_schedule");
    assert.equal(deterministicDocumentRole(summary, "policy_wording"), "personal_schedule");
    assert.equal(detectHighConfidenceReferenceRole(summary), null, "not short-circuited as generic wording");
  });
  await t("3 control: a generic summary with no printed policy number stays reference", () => {
    const generic = doc("Travel insurance summary of benefits\nThe policyholder is the person named in the schedule. Policy number means the number on your schedule.\nTerms and conditions apply. Please read the policy wording.");
    assert.notEqual(deterministicDocumentRole(generic, null), "personal_schedule");
    assert.equal(detectHighConfidenceReferenceRole(generic), "policy_wording");
  });
  await t("3 control (R51-1): a group scheme summary with a group policy number and no named person is not personal", () => {
    const group = doc("Harbour Group Insurance Summary\nGroup Policy No. G123400\nThe Sum Insured is shown in your certificate.\nThe insured person means a member of the scheme.");
    assert.notEqual(deterministicDocumentRole(group, null), "personal_schedule");
    const noName = doc("Your travel insurance summary\nPolicy number : TRV2026-00012345\nPolicyholder:\nSum insured as stated.");
    assert.notEqual(deterministicDocumentRole(noName, null), "personal_schedule", "a policy number without a named person is not enough");
  });

  // 4. A policy wording that describes endorsements
  const wording = doc("Celebrate living\nExample Travel insurance\nPolicy wording\nThis is your contract for your insurance policy.", "Quick reference\nOptional covers\t22", "Insured person means the person named in the summary.\nAny endorsement we issue forms part of this policy.");
  await t("4: a document titled Policy wording stays wording though it mentions endorsements", () => {
    assert.equal(deterministicDocumentRole(wording, null), "policy_wording");
    assert.equal(deterministicDocumentRole(wording, "endorsement"), "policy_wording");
  });
  await t("4 control: an endorsement is still an endorsement", () => {
    const endorsement = doc("ENDORSEMENT NO. 2\nPolicy number: 77001234\nLife assured: Lim Wei Jie\nWith effect from 1 May 2026 the sum assured is S$250,000.");
    assert.equal(deterministicDocumentRole(endorsement, null), "endorsement");
    const late = doc("Example Life Ltd\nNotice to policyholder\nPolicy number: 77001234\nLife assured: Lim Wei Jie\nThis endorsement changes your effective date.");
    assert.equal(deterministicDocumentRole(late, null), "endorsement", "an endorsement not titled as wording keeps the old rule");
  });

  await t("TE-EXTRA controls: a group scheme summary naming its company policyholder; an endorsement citing the policy wording", () => {
    const group = doc("Harbour Unions group insurance summary\nGroup Policy No. G1234567\nPolicyholder : Harbour Unions Council\nPlease refer to the policy wording for the terms.");
    assert.notEqual(deterministicDocumentRole(group, null), "personal_schedule", "a group policy number is not a personal policy number");
  });
  await t("TE-EXTRA control 2: an endorsement citing the policy wording", () => {
    const endorsement = doc("Example Life Ltd\nNotice to policyholder\nPolicy number: 77001234\nLife assured: Lim Wei Jie\nThis endorsement changes your effective date.\nAll other terms of the policy wording stay the same.");
    assert.equal(deterministicDocumentRole(endorsement, null), "endorsement", "the words policy wording deep in an endorsement do not make it the wording");
  });

  if (failed.length) { console.error(`document role regressions FAILED: ${failed.length} of ${cases + failed.length}`); process.exit(1); }
  console.log(`document role regressions passed: ${cases} cases`);
}

main().catch((error) => { console.error(error); process.exit(1); });

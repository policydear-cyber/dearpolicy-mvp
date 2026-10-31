/**
 * A page that could not be checked against its image is left out of the facts a reading keeps, but it is still part of
 * the document. What KIND of document an upload is (schedule, wording, renewal notice) is decided on every page, as it is
 * when every page could be checked; which FACTS are kept is decided only on the checked pages.
 *
 * Before: a schedule whose particulars page could not be checked was decided on its benefit tables and exclusions alone,
 * which read like generic wording, and was stored as policy wording: the person's cover disappeared from their library.
 *
 * Made-up insurers, markets and layouts (HK$, RM, £); each case has a control. Pure: no database, no model, no network.
 */
import assert from "node:assert/strict";

delete process.env.ANTHROPIC_API_KEY; delete process.env.DEARPOLICY_ANTHROPIC_KEY;
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

let cases = 0;
const failed: string[] = [];
function t(name: string, fn: () => void) {
  try { fn(); cases++; console.log("  ok  " + name); }
  catch (error) { failed.push(name); console.error("  FAIL " + name + ": " + (error instanceof Error ? error.message.split("\n")[0] : String(error))); }
}

async function main() {
  const { verifiedExtraction } = await import("@/lib/rag/ingest");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");
  type Page = { pageNumber: number; text: string };
  const doc = (...texts: string[]): Page[] => texts.map((text, i) => ({ pageNumber: i + 1, text }));
  const reading = (over: Record<string, unknown>) => PolicyExtractionSchema.parse({
    documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: null, productName: null, productsMentioned: [],
    policyNumber: null, groupPolicyNumber: null, policyType: "Health", policyholder: null, personalCoverageConfirmed: true, startDate: null, renewalOrExpiryDate: null,
    insuredPeople: [], referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [],
    deductiblesAndCoinsurance: [], riders: [], ...over,
  });
  // The reading as stored when only `checked` pages could be checked, and as stored when every page could be.
  const read = (raw: ReturnType<typeof reading>, pages: Page[], unchecked: number[]) =>
    verifiedExtraction(raw, pages.filter((p) => !unchecked.includes(p.pageNumber)), { allPages: pages });

  // 1. HK$ hospital plan: page 1 holds the particulars; the rest is a benefit table, definitions and exclusions.
  const hk = doc(
    "Kowloon Bay Life (fictitious)\nCAREPLUS HOSPITAL PLAN\nPOLICY SCHEDULE\nPolicy number KBL-HP-551203\nPolicyholder\tChan Siu Ming\nLife assured\tChan Siu Ming\nPlan\tSemi-private\nAnnual limit\tHK$1,500,000",
    "SCHEDULE OF BENEFITS\nBenefit\tLimit\nRoom and board\tHK$2,400 per day\nSurgeon's fee\tAs charged, up to HK$120,000",
    "DEFINITIONS\nHospital means an establishment registered as a hospital.\nGENERAL EXCLUSIONS\n- Cosmetic treatment\n- Pre-existing conditions not declared",
  );
  const hkRaw = reading({ insurer: "Kowloon Bay Life (fictitious)", productName: "CarePlus Hospital Plan", policyNumber: "KBL-HP-551203",
    insuredPeople: [{ name: "Chan Siu Ming", relationshipHint: "self", coverages: [{ category: "Hospitalisation", productName: "CarePlus Hospital Plan", policyNumber: "KBL-HP-551203", amount: 1500000, currency: "HKD", notes: null, sourcePage: 1, evidenceText: "Annual limit\tHK$1,500,000", evidenceVerified: true }] }] });
  const hkAll = read(hkRaw, hk, []);
  t("1a: HK$ schedule read with every page checked is a personal schedule", () => assert.equal(hkAll.documentRole, "personal_schedule"));
  const hkPart = read(hkRaw, hk, [1]);
  t("1b: the same schedule with its particulars page unchecked is still the schedule, not wording", () => assert.equal(hkPart.documentRole, "personal_schedule"));
  t("1c: ...and nothing printed only on the unchecked page is kept as a fact", () => {
    assert.equal(hkPart.policyNumber, null, "policy number printed only on the unchecked page");
    assert.equal(hkPart.insuredPeople.flatMap((p) => p.coverages).some((c) => c.amount === 1500000 && c.evidenceVerified), false, "the annual limit on the unchecked page is not verified cover");
  });
  t("1d: control: the left-out pages on their own would read as wording (the case this fixes)", () => {
    assert.equal(verifiedExtraction(hkRaw, hk.filter((p) => p.pageNumber !== 1)).documentRole, "policy_wording");
  });

  // 2. RM medical card, particulars on the LAST page (mirror layout).
  const rm = doc(
    "TERMS AND CONDITIONS\n1. Definitions\nRoom and board means the daily charge for a standard room.\n2. General exclusions\nTreatment outside Malaysia unless an emergency.",
    "Benefit table\tRM\nRoom and board\tRM250 per day\nIntensive care\tAs charged",
    "Selat Melaka Insurans Berhad (fictitious)\nMEDICARD ESSENTIAL\nPOLICY SCHEDULE\nPolicy number SMI-MC-20994\nInsured person: Nurul Aina binti Hassan\nOverall annual limit RM150,000",
  );
  const rmRaw = reading({ insurer: "Selat Melaka Insurans Berhad (fictitious)", productName: "MediCard Essential", policyNumber: "SMI-MC-20994" });
  t("2a: RM schedule with its last (particulars) page unchecked keeps the role it has when every page is checked", () => {
    assert.equal(read(rmRaw, rm, []).documentRole, read(rmRaw, rm, [3]).documentRole);
    assert.equal(read(rmRaw, rm, [3]).documentRole, "personal_schedule");
  });

  // 3. £ policy wording with an unchecked page: still the wording (the change never turns wording into a schedule).
  const gb = doc(
    "Thames Mutual (fictitious)\nPOLICY WORDING\nHome Emergency Cover\nDefinitions\nYou means the policyholder named in the schedule.",
    "What is covered\nEmergency repairs up to £500 per claim\nWhat is not covered\nWear and tear",
    "General conditions\nYou must take reasonable care to prevent loss.",
  );
  const gbRaw = reading({ documentType: "Policy wording", documentRole: "policy_wording", personalCoverageConfirmed: false, insurer: "Thames Mutual (fictitious)", productName: "Home Emergency Cover" });
  t("3: £ wording with page 2 unchecked stays policy wording", () => {
    assert.equal(read(gbRaw, gb, [2]).documentRole, "policy_wording");
    assert.equal(read(gbRaw, gb, []).documentRole, "policy_wording");
  });

  // 4. A renewal notice whose second page is unchecked stays a renewal notice; one with every page left out of the
  //    facts still gets its role from its pages, but keeps no figure.
  const rn = doc(
    "Harbour Line General (fictitious)\nRENEWAL NOTICE\nDear Ms Ong,\nYour MotorSure policy HLG-MS-77120 renews on 1 March 2027.\nRenewal premium S$1,204.50",
    "Please pay by GIRO before the renewal date.",
  );
  const rnRaw = reading({ documentType: "Renewal notice", documentRole: "renewal_statement", personalCoverageConfirmed: false, premium: { amount: 1204.5, currency: "SGD", frequency: "annual" } });
  t("4: renewal notice with an unchecked page stays a renewal notice; a premium only on the unchecked page is not kept", () => {
    assert.equal(read(rnRaw, rn, [2]).documentRole, "renewal_statement");
    const none = read(rnRaw, rn, [1]);
    assert.equal(none.documentRole, "renewal_statement");
    assert.notEqual(none.premium.amount, 1204.5, "the premium is printed only on the unchecked page");
  });

  // 5. With no page left out the call is unchanged (allPages defaults to the checked pages).
  t("5: no allPages given = the old behaviour", () => assert.equal(verifiedExtraction(hkRaw, hk).documentRole, hkAll.documentRole));

  console.log(`\n${cases} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((error) => { console.error(error); process.exit(1); });

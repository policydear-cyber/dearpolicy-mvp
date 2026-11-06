/**
 * Amendments (lib/policies/amendments.ts): main's wording is kept as it is; a first title line on the closed amendment
 * list can also amend, behind a switch that ships off; and the reader's "endorsement" type is set aside only when the document shows no amendment of its
 * own, its first title is a plain schedule or certificate, and it prints an empty endorsement field ("Endorsements: Nil"). And a contents entry never names the document: its
 * topmost title line does (lib/documents/fact-check.ts). Made-up English documents, no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("an amending document is known by its own title or an amending sentence", async () => {
  const { amendmentWording } = await import("@/lib/policies/amendments");
  const letterhead = "Lionrock Assurance Ltd\n1 Example Place\nSingapore 048616\n";
  const amending: [string, string][] = [
    // Critic r375 H1: titles, a letter and a page-two title main caught. A first title line on the closed list amends only
  // with its own dated change (TE r375 Q1-Q4); without one, main's wording decides.
    ...["ENDORSEMENT SCHEDULE", "Endorsement Certificate", "Rider Endorsement", "Change of Sum Assured", "Reduction of Sum Assured", "Alteration of Policy",
      "Confirmation of Policy Changes", "Changes to your plan"].map((t) => [t, letterhead + t + "\nPolicy No. TL-1\nEffective 1 March 2026"] as [string, string]),
    ["a title below a long address block", letterhead + "Address line\n".repeat(10) + "Policy Alteration\nPolicy No. TL-1"],
    ["a title on page 2 behind a cover letter", letterhead + "Cover letter\n\fENDORSEMENT NO. 1\nPolicy No. TL-1"],
    ["a policy alteration notice", letterhead + "Policy Alteration Notice\nPolicy No. TL-1\nPlease keep this with your policy."],
    ["confirmation of change of sum assured", letterhead + "Confirmation of change of sum assured\nPolicy No. TL-1\nWith effect from 1 May 2026"],
    ["amendment to policy schedule", letterhead + "Amendment to Policy Schedule\nPolicy No. TL-1\nEffective date: 01/05/2026"],
    ["endorsement title with a dash", "Kestrel Life Assurance (made up)\nPolicy alteration (made up)\n\nENDORSEMENT NO. 2 - REDUCTION OF SUM ASSURED\nDate: 1 March 2026\nItem\tBefore\tAfter\nDeath sum assured\tS$300,000\tS$250,000"],
    ["endorsement to a policy number", "Endorsement No. 4 to policy KL-TL-100245\nEffective 1 May 2026\nThe sum assured is hereby amended as follows."],
    ["a notice of alteration", "Bramble General Insurance\nNOTICE OF POLICY ALTERATION\nDear Policyholder,\nWe have recorded your request."],
    ["changes to your policy", "Changes to your policy\nPolicy number HG-55120\nFrom 1 July 2026 your new premium is S$410.00 a year."],
    ["only a sentence: altered with effect from", "Policy number EQ-551204\nAt your request, the policy is altered with effect from 1 September 2026."],
    ["only a sentence: premium amended as follows", "Renewal letter\nThe premium is amended as follows from the next policy year."],
  ];
  for (const [why, text] of amending) assert.equal(amendmentWording(text, { firstTitleCatch: true }), true, why);
  for (const title of ["ENDORSEMENT SCHEDULE", "Change of Sum Assured", "Changes to your plan", "Amendment to Policy Schedule"])
    assert.equal(amendmentWording(letterhead + title + "\nPolicy No. TL-1", { firstTitleCatch: true }), false, title + " with no date of its own");
  const ordinary: [string, string][] = [
    // TE r375 Q1-Q4: an appendix that applies only if shown, a blank form, an option page, a brochure heading.
    ["an endorsements appendix", "ENDORSEMENT\nApplies only if shown in your schedule\nWar and terrorism exclusion\nThis policy does not cover loss caused by war."],
    ["a blank amendment form", "Amendment Schedule\nTo be completed by the policyholder\nPolicy number ____\nNew sum assured ____"],
    ["an option page", "Increase in sum assured option\nOn marriage or the birth of a child the sum assured can rise by up to S$50,000 without health questions."],
    ["a brochure heading", "Change of plan\nAt each renewal the plan can be moved up one level, subject to health questions.\nPlan Plus premium S$480 a year"],
    // TE r375 round 4 E4: a brochure page with an effective date and no policy number of its own.
    ["a dated brochure page", "Change of plan\nEffective date: 1 March 2026\nAt each renewal you can move up one plan level."],
    ["a dated title with no policy number", letterhead + "Changes to your plan\nEffective 1 March 2026\nYour new premium is S$410.00 a year."],
    // Critic r375 p375d: a quotation, a change subject to acceptance, a proposal, a brochure naming "policy 2026 holders".
    ["a quotation", "Change of Plan\nQuotation\nPolicy No. TW-88213\nThe new plan is effective from 1 January 2027."],
    ["subject to acceptance", "Changes to your cover\nPolicy No. TW-88213\nEffective 1 January 2027, subject to acceptance."],
    ["a proposal", "Change of Sum Assured\nProposal / Policy No.: P-77821\nRequested effective date: 1 January 2027"],
    ["a brochure for policy 2026 holders", "Change of plan\nAvailable to policy 2026 holders from 1 Jan 2027."],
    ["a dated option page", "Increase in sum assured option\nPolicy No. TL-1\nFrom 1 June 2026 you may raise the sum assured by S$50,000."],
    ["a booklet on the law", "The scheme is set up under the Act and the Regulations made under the Act (and any amendments made to them from time to time)."],
    ["a premium review clause", "Premiums are not guaranteed and may be increased with effect from the next renewal. The premium is reviewed every year."],
    // Critic r375 H2: a schedule's form lines and a booklet's standard clause.
    ["Endorsements: Nil", letterhead + "POLICY SCHEDULE\nPolicy No. TL-1\nEndorsements: Nil\nSum assured S$1,000,000"],
    ["Endorsements - E01", letterhead + "POLICY SCHEDULE\nPolicy No. TL-1\nEndorsements - E01 Terrorism exclusion"],
    ["Endorsement: Applicable", letterhead + "Policy Schedule\nPolicy No. TL-1\nEndorsement: Applicable"],
    ["Amendments: None", letterhead + "Policy Schedule\nPolicy No. TL-1\nAmendments: None"],
    ["a booklet's endorsement clause", letterhead + "Travel Insurance Booklet\nSection 9 Endorsements\nThis endorsement forms part of the policy and applies only if shown in the schedule."],
    ["a renewal notice", letterhead + "Renewal Notice\nPolicy No. TL-1\nYour premium will change."],
    // TE r375: empty values, a booklet's section heading, and "with effect from" without a date or "hereby".
    ["Endorsement: None", letterhead + "POLICY SCHEDULE\nEndorsement: None"],
    ["Alteration: none", letterhead + "Policy No. TL-1\nAlteration: none"],
    ["Endorsements - see attached", letterhead + "Policy No. TL-1\nEndorsements - see attached"],
    ["amendments this year: none", letterhead + "Annual statement\nAmendments to your policy this year: none"],
    ["a booklet's Endorsement heading", letterhead + "Harbourline Travel Booklet\nEndorsement\nTerrorism cover applies only if shown."],
    ["an illustration", letterhead + "Benefit illustration\nThe premium is reduced with effect from 1 March 2040."],
    ["a product summary", letterhead + "Product summary\nYour cover is increased with effect from the second policy year."],
    ["with effect from without a date", letterhead + "Renewal notice\nYour premium is changed with effect from your renewal date."],
    ["a title further down the first page", ["Orchard Health Plan", "Product summary", ...Array.from({ length: 30 }, (_, i) => `Benefit ${i + 1}\tS$${(i + 1) * 100}`), "Endorsement"].join("\n")],
  ];
  for (const [why, text] of ordinary) assert.equal(amendmentWording(text, { firstTitleCatch: true }), false, why);
  // Sentences and form lines this change leaves exactly as main reads them (wider sentence catches leak both ways and are
  // left for a later change): main's own wording decides, with no new catch and no new miss.
  const MAIN_AMENDS = /\bendorsement\s+(?:no\.?|number)\s*\d|\bpolicy (?:is|has been) altered\b|\bpolicy alteration\b|\b(?:reduction|increase) of (?:the )?sum (?:assured|insured)\b|\b(?:is|are|hereby|has been|have been) amended\b/i;
  const asMain: [string, string][] = [
    ["a letter: we have reduced", letterhead + "15 March 2026\nMr A Tan\n12 Example Road\nSingapore 123456\nDear Mr Tan\nRe: Policy No. TL-1\nWe have reduced your sum assured to S$500,000 as you requested."],
    ["the sum assured has been reduced", letterhead + "Policy No. TL-1\nThe sum assured has been reduced with effect from 1 March 2026."],
    ["a Before / After table", letterhead + "Policy No. TL-1\nItem\tBefore\tAfter\nDeath\tS$300,000\tS$250,000"],
    ["a letter: reduced from a date", letterhead + "Dear Ms Lim\nWe have reduced your sum assured to S$200,000 from 1 May 2026."],
    ["only a sentence: changes made", "Policyholder services\nPolicy number HG-55120\nPlease note that the following changes have been made to your policy:\nAnnual premium\tS$450.00\tS$410.00"],
    ["only a sentence: this endorsement", "Kestrel Life Assurance\nPolicy number KL-TL-100245\nThis endorsement forms part of the policy and should be kept with it."],
    ["a wording's general conditions", "Harbourline Travel Insurance\nPolicy wording\nGeneral conditions\nThis policy may be amended by endorsement. All endorsements form part of the policy.\nAny alteration to the policy must be agreed by us in writing.\nPolicy alteration: you may ask us to change your plan at renewal."],
    ["a contents list naming endorsements", "Harbourline Travel Insurance\nContents\nGeneral conditions ........ 4\nEndorsements ........ 14\nEndorsement - Terrorism exclusion\t15\nEndorsement No. 2 - Pandemic cover\t16"],
    ["a schedule listing the endorsements that apply", "Bramble Home Insurance\nPolicy schedule\nPolicy number BH-2210\nSum insured\tS$80,000\nEndorsements applying: Endorsement No. 1 (Flood), Endorsement No. 3 (Renovation)"],
    ["an alteration heading deep in a wording", "Orchard Health Plan\nPolicy wording\n\fSection 5\nPolicy alteration\nYou may ask us to alter the policy."],
    ["Endorsement No. 0", letterhead + "POLICY SCHEDULE\nPolicy No. TL-1\nEndorsement No. 0\nSum assured S$1,000,000"],
    ["amended as follows: none", letterhead + "POLICY SCHEDULE\nPolicy No. TL-1\nThe schedule is amended as follows: none"],
    // TE r375 round 2: an inflation clause, a claim letter, a projected-values age table.
    ["an inflation clause", "Orchard Life Plan\nPolicy wording\nInflation protection\nThe sum insured is hereby increased by 10% on each renewal."],
    ["a claim letter", "Claims department\nClaim decision\nDear Mr Tan\nWe have reduced the cover for this claim because the bill was not itemised."],
    ["a projected values table", "Projected values\nBefore age 65\tAfter age 65\nS$100,000\tS$50,000"],
  ];
  for (const [why, text] of asMain) assert.equal(amendmentWording(text), MAIN_AMENDS.test(text), why);
  for (const why of ["an inflation clause", "a claim letter", "a projected values table"]) assert.equal(amendmentWording(asMain.find((c) => c[0] === why)![1]), false, why);
  // As shipped the first-title catch is off (FIRST_TITLE_CATCH): every document reads exactly as on main, including the
  // brochure page and quotation shapes that kept slipping through it (TE r375 E11, Critic p375d Q1-Q5).
  const { FIRST_TITLE_CATCH } = await import("@/lib/policies/amendments");
  assert.equal(FIRST_TITLE_CATCH, false);
  const brochure = "Change of plan\nPolicy number LT-5520\nEffective date: 1 March 2026\nAt each renewal the plan can be moved up one level.\nPlan Plus premium S$480 a year";
  for (const [why, text] of [...amending, ...ordinary, ...asMain, ["a brochure page with a policy number", brochure] as [string, string]])
    assert.equal(amendmentWording(text), MAIN_AMENDS.test(text), why + " (as shipped)");
  // The reader's "endorsement" type still makes an amendment (a lost one leaves an old figure shown), unless the text
  // is a plain schedule or certificate with an empty endorsement field, no change word and no amendment evidence.
  const { endorsementTypeVetoed } = await import("@/lib/policies/amendments");
  for (const t of ["Policy No. TL-1\nSum assured S$500,000", "POLICY SCHEDULE (ENDORSED)\nPolicy No. TL-1\nSum assured S$500,000", "Policy Alteration Notice\nPolicy No. TL-1",
    // Critic r375 p375b: the document's own amendment evidence keeps the type, whatever its title or form lines.
    "Policy No. HL-9\nEndorsements: Nil\nThe sum assured is reduced to S$400,000 from 1 March 2026",
    "Amendment to Terms and Conditions\nPolicy No. HL-9\nClause 4 is replaced.",
    "Endorsement - Amended Benefit Summary\nPolicy No. HL-9\nHospital cash S$200",
    "Revised Policy Wording (Endorsement No. 3)\nPolicy No. HL-9",
    "Product Summary\nEndorsement No. 2\nPolicy No. HL-9",
    "Endorsement\nPolicy No. HL-9\nSum assured reduced to S$400,000\nAmendment fee: Nil",
    "ENDORSEMENT NO. 3\nPolicy No. HL-9\nEndorsement premium: Nil",
    "Policy No. HL-9\nPrevious endorsements: None\nNew sum assured S$400,000",
    // Critic r375 p375b V10: an endorsement title keeps the type over an empty "see attached" field.
    "Endorsement\nPolicy No. HL-9\nAlterations - see attached",
    // Critic r375 p375e: only a plain schedule or certificate with no change word is set aside.
    "AMENDED POLICY SCHEDULE\nPolicy No. TL-100245\nEndorsements: Nil\nSum assured: S$200,000\nIssued 1 March 2026",
    "Policy Schedule - Amended\nPolicy No. TL-100245\nAlterations: None\nDeath benefit S$300,000",
    "Supplementary Schedule\nPolicy No. TL-100245\nEndorsements: Nil\nHospital cash S$150 per day",
    "Rider Attachment Notice\nPolicy No. TL-100245\nEndorsements: N/A\nRider: Critical Illness S$100,000 added to your policy",
    "Policy Change Confirmation\nPolicy No. TL-100245\nEndorsements: Nil\nNew address: 12 Example Road",
    "POLICY SCHEDULE\nPolicy No. TL-100245\nEndorsements: Nil\nRider: Critical Illness S$100,000 added",
    "Policy No. TL-1\nEndorsements - see attached",
    // TE r375 round 3 V1: a typed endorsement titled "Benefit summary" with its own dated figure.
    "Benefit summary\nPolicy number LT-88123\nFrom 1 June 2026 your death benefit is S$250,000.",
    // TE r375 round 2 H6.
    "Revised benefit summary\nPolicy No. HL-9\nHospital cash S$200",
    // Titles never veto (Critic r375 p375c): a mistyped booklet stays an amender, as on main; re-issued, updated or
    // replacement wordings and summaries are amendments.
    "Travel Insurance Booklet\nEndorsement\nTerrorism", "Harbourline Policy Wording\nPolicy No. TL-1",
    "Updated Benefit Summary\nPolicy No. CF-2\nHospital cash S$200 per day (previously S$100)",
    "Replacement Policy Wording\nPolicy No. CF-2\nEffective 1 March 2026",
    "Re-issued Product Summary\nPolicy No. CF-2\nSum assured S$400,000 (was S$500,000)",
    "Policy Booklet\nThis booklet supersedes the booklet dated 1 Jan 2025.",
    "Benefit Summary\nEndorsements: Nil\nNew overall limit S$80,000 from 1 April 2026",
    "Terms and Conditions\nClause 5 now reads: the limit is S$5,000.",
    "Policy Wording\nWith effect from 1 March 2026 the sum assured becomes S$400,000."])
    assert.equal(endorsementTypeVetoed(t), false, t);
  for (const t of ["POLICY SCHEDULE\nPolicy No. TL-1\nEndorsements: Nil", "POLICY SCHEDULE\nPolicy No. HL-9\nEndorsements this year: Nil", "POLICY SCHEDULE\nPolicy No. TL-1\nEndorsements - see attached",
    // Critic r375 p375e W8: a reissued plain schedule with an empty endorsement field.
    "POLICY SCHEDULE\nPolicy No. TL-100245\nDate of issue: 1 March 2026\nEndorsements: Nil\nSum assured: S$200,000"])
    assert.equal(endorsementTypeVetoed(t), true, t);
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../lib/policies/amendments.ts", import.meta.url), "utf8");
  assert.match(src, /amendmentWording\(pages\.get\(d\.id\) \?\? ""\) \|\| \(d\.document_role === "endorsement" && !endorsementTypeVetoed/);
});

test("a contents entry never names the document; its topmost title line does", async () => {
  const { titleProductName, titleRoles } = await import("@/lib/documents/fact-check");
  const page = (pageNumber: number, text: string) => ({ pageNumber, text });
  // A contents page before the title: the title on the next page names the product.
  assert.equal(titleProductName([page(1, "Contents\nVoyager Plus - Policy schedule ........ 2\nClaims ........ 9"), page(2, "ORCHARD TRAVEL GUARD - POLICY SCHEDULE\nPolicy number OT-2290")]), "Orchard Travel Guard");
  // A contents entry with a page number after a tab, no "Contents" heading.
  assert.equal(titleProductName([page(1, "Bramble General Insurance\n1. Voyager Plus - Policy Schedule\t5\n2. Claims\t9"), page(5, "Kingfisher Home Shield - Policy Schedule")]), "Kingfisher Home Shield");
  // The topmost title line wins over a contents list below it.
  assert.equal(titleProductName([page(1, "MERIDIAN CARE PLUS - POLICY SCHEDULE\nTable of contents\nVoyager Plus - Policy schedule\t4")]), "Meridian Care Plus");
  // A contents box at the top of the cover ends at its first line that is no entry: the title below it names the document.
  assert.equal(titleProductName([page(1, "Contents\nSchedule\t2\nWording\t4\n\nOSPREY HOME GUARD - POLICY SCHEDULE\nPolicy number OH-881"), page(2, "Kestrel Motor Plus - Policy Schedule")]), "Osprey Home Guard");
  assert.equal(titleProductName([page(1, "Table of contents\nSchedule 2\nClaims p. 9\nOSPREY HOME GUARD - POLICY SCHEDULE")]), "Osprey Home Guard");
  // TE r375 round 2 N8: a title ending in a number below a contents box is the document's own, not an entry.
  assert.equal(titleProductName([page(1, "Contents\nSchedule 2\nWording 4\nSECURE LIFE 65\nPOLICY SCHEDULE\nPolicy number SL-65")]), "Secure Life 65");
  // Only contents: no name (fails closed).
  assert.equal(titleProductName([page(1, "Contents\nVoyager Plus - Policy schedule\npg 2\nClaims\npg 9")]), null);
  // Unchanged: a title over two lines.
  assert.equal(titleProductName([page(2, "Kestrel Life (made up)\nSHIELDCARE PREMIER - Integrated Shield Plan\nPOLICY SCHEDULE\nPolicy number\tKL-7730152")]), "Shieldcare Premier");
  // A contents entry naming an endorsement or a certificate does not make the document one.
  const roles = titleRoles([page(1, "Harbourline Travel Insurance\nContents\nEndorsements ........ 14\nCertificate of insurance ........ 2")]);
  assert.equal(roles.has("endorsement"), false);
  assert.equal(roles.has("certificate"), false);
  assert.equal(titleRoles([page(1, "Harbourline Travel Insurance\nEndorsement No. 2\nPolicy number HT-100")]).has("endorsement"), true);
});

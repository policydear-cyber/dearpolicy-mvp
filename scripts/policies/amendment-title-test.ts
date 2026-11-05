/**
 * Only a document that prints amendment wording of its own amends its policy (lib/policies/amendments.ts): an amendment
 * title among the first lines of its first page, or an amending sentence. An ordinary page (a wording, a schedule, a
 * booklet that mentions endorsements, a contents list) never does. And a contents entry never names the document: its
 * topmost title line does (lib/documents/fact-check.ts). Made-up English documents, no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("an amending document is known by its own title or an amending sentence", async () => {
  const { amendmentWording } = await import("@/lib/policies/amendments");
  const amending: [string, string][] = [
    ["endorsement title with a dash", "Kestrel Life Assurance (made up)\nPolicy alteration (made up)\n\nENDORSEMENT NO. 2 - REDUCTION OF SUM ASSURED\nDate: 1 March 2026\nItem\tBefore\tAfter\nDeath sum assured\tS$300,000\tS$250,000"],
    ["endorsement to a policy number", "Endorsement No. 4 to policy KL-TL-100245\nEffective 1 May 2026\nThe sum assured is hereby amended as follows."],
    ["a notice of alteration", "Bramble General Insurance\nNOTICE OF POLICY ALTERATION\nDear Policyholder,\nWe have recorded your request."],
    ["changes to your policy", "Changes to your policy\nPolicy number HG-55120\nYour new premium is S$410.00 a year."],
    ["only a sentence: changes made", "Policyholder services\nPolicy number HG-55120\nPlease note that the following changes have been made to your policy:\nAnnual premium\tS$450.00\tS$410.00"],
    ["only a sentence: this endorsement", "Kestrel Life Assurance\nPolicy number KL-TL-100245\nThis endorsement forms part of the policy and should be kept with it."],
    ["only a sentence: altered with effect from", "Policy number EQ-551204\nAt your request, the policy is altered with effect from 1 September 2026."],
    ["only a sentence: premium amended as follows", "Renewal letter\nThe premium is amended as follows from the next policy year."],
  ];
  for (const [why, text] of amending) assert.equal(amendmentWording(text), true, why);
  const ordinary: [string, string][] = [
    ["a wording's general conditions", "Harbourline Travel Insurance\nPolicy wording\nGeneral conditions\nThis policy may be amended by endorsement. All endorsements form part of the policy.\nAny alteration to the policy must be agreed by us in writing.\nPolicy alteration: you may ask us to change your plan at renewal."],
    ["a contents list naming endorsements", "Harbourline Travel Insurance\nContents\nGeneral conditions ........ 4\nEndorsements ........ 14\nEndorsement - Terrorism exclusion\t15\nEndorsement No. 2 - Pandemic cover\t16"],
    ["a schedule listing the endorsements that apply", "Bramble Home Insurance\nPolicy schedule\nPolicy number BH-2210\nSum insured\tS$80,000\nEndorsements applying: Endorsement No. 1 (Flood), Endorsement No. 3 (Renovation)"],
    ["a booklet on the law", "The scheme is set up under the Act and the Regulations made under the Act (and any amendments made to them from time to time)."],
    ["a premium review clause", "Premiums are not guaranteed and may be increased with effect from the next renewal. The premium is reviewed every year."],
    ["an alteration heading deep in a wording", "Orchard Health Plan\nPolicy wording\n\fSection 5\nPolicy alteration\nYou may ask us to alter the policy."],
    ["a title further down the first page", ["Orchard Health Plan", "Product summary", ...Array.from({ length: 12 }, (_, i) => `Benefit ${i + 1}\tS$${(i + 1) * 100}`), "Endorsement"].join("\n")],
  ];
  for (const [why, text] of ordinary) assert.equal(amendmentWording(text), false, why);
  // The reader's document type alone never makes an amendment: only the document's own wording does.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../lib/policies/amendments.ts", import.meta.url), "utf8");
  assert.match(src, /d\.d && amendmentWording\(pages\.get\(d\.id\) \?\? ""\)/);
  assert.doesNotMatch(src, /document_role === "endorsement"/);
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

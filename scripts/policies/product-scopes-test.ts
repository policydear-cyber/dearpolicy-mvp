/** Which product section a booklet page belongs to (pageProductScopes, lib/policies/inventory.ts), which names every
 * benefit read from that page (catalog-builder: policy_benefits.product_name). A product starts its section only from a
 * heading line, never from a sentence, a table row or a contents entry (live 3 Nov: Death, TPD and travel endorsement
 * rows stored as "Hospitalisation"). Pure; made-up booklets from several markets; no network.
 *   npm run policies:product-scopes-test */
import assert from "node:assert/strict";
import { pageProductScopes } from "@/lib/policies/inventory";
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
let passed = 0; const failed: string[] = [];
const t = (name: string, fn: () => void) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };
const scopes = (pages: string[], products: string[]) => { const m = pageProductScopes(pages.map((text, i) => ({ page_number: i + 1, text })), products); return pages.map((_, i) => (m.get(i + 1) ?? []).join("|")); };

t("a group booklet: contents entries start nothing; each product's heading starts its section; a benefit word used in a sentence never does", () => {
  const got = scopes([
    "Harbour Civil Service Group Insurance\nProduct Summaries\nContents\n1. Group Term Life\t2\n2. Group Personal Accident\t7\n3. Hospitalisation\t12",
    "Group Term Life\nThe Group Term Life Insurance provides cover on death or disability.\nKey Features",
    "Insurance Benefits\n• Death\t100% of Sum Insured\n• Daily Hospital Cash Benefit\tS$30 per day\nMax: 30 days of continuous hospitalisation\nNo Benefit is payable for hospitalisation due to pregnancy.",
    "GROUP PERSONAL ACCIDENT\nKey Features\n• Up to S$600,000 of cover",
    "Insurance Benefits\n• Death due to Accident\t100% of Sum Insured",
  ], ["Group Term Life", "Group Personal Accident", "Hospitalisation"]);
  assert.deepEqual(got, ["", "Group Term Life", "Group Term Life", "Group Personal Accident", "Group Personal Accident"]);
});
t("a travel wording whose reading listed a benefit as a product: table rows and labels above a figure name no section", () => {
  const got = scopes([
    "Travel insurance\nPolicy wording\nQuick reference\nTable of benefits\t3",
    "Table of benefits\nProtecting you and your health\nPremium\tBusiness\tFirst\nHospitalisation visit\nS$5,000\tS$7,500\tS$10,000",
    "Table of benefits\nHospitalisation\nS$50,000\tS$100,000\nOptional covers\nSports equipment protector",
    "Table of benefits\nHospitalisation\n€50.000\nHospitalisation\n50,000",
  ], ["Hospitalisation"]);
  assert.deepEqual(got, ["", "", "", ""]);
});
t("headings with numbering, section words and plan words count, in upper or lower case, and the fuller name wins", () => {
  const got = scopes([
    "2. Living Care Plus Rider\nWhat it covers",
    "Section 3 - LIVING CARE\nWhat it covers",
    "BENEFIT 1: Merlion Shield Plan\nSchedule",
    "PRODUCT SUMMARY: Kenanga Takaful Medik\nManfaat",
  ], ["Living Care", "Living Care Plus", "Merlion Shield", "Kenanga Takaful Medik"]);
  assert.deepEqual(got, ["Living Care Plus", "Living Care", "Merlion Shield", "Kenanga Takaful Medik"]);
});
t("a product name inside a longer line is not a heading (a sentence, a row with a figure, another product's line)", () => {
  const got = scopes([
    "About your plan\nYour Merlion Shield cover pays hospital bills.",
    "Benefits\nMerlion Shield\tS$1,000,000",
    "Merlion Shield Extra Care\nRider summary",
  ], ["Merlion Shield"]);
  assert.deepEqual(got, ["", "", ""]);
});
t("a section continues to later pages until another product's heading, and a heading followed by a section number or list still counts", () => {
  const got = scopes([
    "Rawat Inap Platinum\n1\nKey Features",
    "Benefits\n• Room and board\tRM 300 per day",
    "Exclusions\nNo benefit for cosmetic surgery.",
    "Accident Guard\n1. Who is covered",
  ], ["Rawat Inap Platinum", "Accident Guard"]);
  assert.deepEqual(got, ["Rawat Inap Platinum", "Rawat Inap Platinum", "Rawat Inap Platinum", "Accident Guard"]);
});
t("only the top of a page is read for its heading", () => {
  const got = scopes(["Benefits\n" + "x ".repeat(400) + "\nAccident Guard\n"], ["Accident Guard"]);
  assert.deepEqual(got, [""]);
});
const GTL = "Group Term Life\nKey Features";
t("a benefit the reading listed as a product never starts a section, whatever its layout; standing as a heading it ends the one before", () => {
  const P = ["Group Term Life", "Group Personal Accident", "Hospitalisation", "Critical Illness", "Rawat Inap", "住院保障"];
  for (const page of [
    "Hospitalisation Benefit\nWe pay a daily amount for each day in hospital.\nDeath\t100% of Sum Insured",
    "Hospitalisation\nUp to S$5,000 per stay\nDeath\tS$100,000",
    "Hospitalisation\nPlan A\tS$5,000\tPlan B\tS$7,500",
    "Hospitalisation:\nWhat we pay",
    "• Hospitalisation\nWe pay room and board.",
    "3. CRITICAL ILLNESS BENEFIT\nWhat we pay",
    "Manfaat Rawat Inap\nKami membayar",
    "住院保障\n我们支付",
  ]) assert.deepEqual(scopes([GTL, page], P), ["Group Term Life", ""], page.split("\n")[0]);
});
t("a product's heading in other common shapes starts its section", () => {
  const Q = ["Group Term Life", "Group Personal Accident"];
  for (const page of [
    "Group Personal Accident – Product Summary\nKey Features",
    "Group Personal Accident (Plan B)\nKey Features",
    "Group Personal Accident®\nKey Features",
    "Product Summary for Group Personal Accident\nKey Features",
    "Group Personal Accident Policy Wording\nKey Features",
    "Harbour Assurance\nGroup Personal Accident\nKey Features",
    "Ringkasan Produk: Group Personal Accident\nCiri-ciri",
    "Chapter 2: Group Personal Accident\nKey Features",
    "II. Group Personal Accident\nKey Features",
    "4.2 Group Personal Accident\nKey Features",
  ]) assert.deepEqual(scopes([GTL, page], Q), ["Group Term Life", "Group Personal Accident"], page.split("\n")[0]);
});
t("when another product is named but its heading is not recognised, the section ends (the document's plan names it), never carries on", () => {
  const Q = ["Group Term Life", "Group Personal Accident"];
  for (const page of [
    "Group Personal Accident\n100% of Sum Insured on death",
    "Group Personal Accident\nS$600,000 cover for each employee",
    "Your Group Personal Accident cover pays on accidental death.",
    "GROUP PERSONAL ACCIDENT INSURANCE FOR EMPLOYEES OF THE STATE\nKey Features",
  ]) assert.deepEqual(scopes([GTL, page, "Insurance Benefits\n• Death\t100% of Sum Insured"], Q), ["Group Term Life", "", ""], page.split("\n")[0]);
});
t("the section's own name in a sentence, a fuller name holding it, and a running header keep the section", () => {
  const header = "Harbour Civil Service Group Insurance";
  const got = scopes([
    header + "\nContents",
    header + "\nGroup Term Life\nKey Features",
    header + "\nThe Group Term Life Insurance pays on death.",
    header + "\nInsurance Benefits\n• Death\t100% of Sum Insured",
    header + "\nMerlion Shield Plus\nKey Features",
    header + "\nYour Merlion Shield Plus cover pays hospital bills.",
  ], [header, "Group Term Life", "Merlion Shield", "Merlion Shield Plus"]);
  assert.deepEqual(got, ["", "Group Term Life", "Group Term Life", "Group Term Life", "Merlion Shield Plus", "Merlion Shield Plus"]);
});
t("an insurer's brand before two products' headings, a Chinese translation, schedule words, PELAN, a bracket then a dash: each starts its section", () => {
  const Q = ["Group Term Life", "Group Personal Accident"], B = "\nBenefits\n• Death\tS$100,000";
  assert.deepEqual(scopes(["Harbourlife Group Term Life" + B, "Harbourlife Group Personal Accident" + B], Q), ["Group Term Life", "Group Personal Accident"]);
  assert.deepEqual(scopes(["團體定期人壽 Group Term Life" + B, "團體個人意外 Group Personal Accident" + B], Q), ["Group Term Life", "Group Personal Accident"]);
  assert.deepEqual(scopes(["Group Term Life Benefit Schedule" + B, "Group Personal Accident (GPA) – Key Features" + B], Q), ["Group Term Life", "Group Personal Accident"]);
  assert.deepEqual(scopes(["PELAN TAKAFUL MEDIK PRIMA\nCiri-ciri utama", "Bahagian 2: Takaful Hayat\nCiri-ciri utama"], ["Takaful Medik Prima", "Takaful Hayat"]), ["Takaful Medik Prima", "Takaful Hayat"]);
  // A word before only one product's name is not known to be a brand: that line is another product's, so the section ends.
  assert.deepEqual(scopes([GTL, "Dependants Group Personal Accident" + B], Q), ["Group Term Life", ""]);
});
t("a shorter benefit-word name's heading after a fuller product ends the fuller one's section", () => {
  assert.deepEqual(scopes(["Hospitalisation Plus\nKey Features", "Benefits\n• Room and board\tS$300 per day", "Hospitalisation\nKey Features", "Benefits\n• Room and board\tS$200 per day"],
    ["Hospitalisation", "Hospitalisation Plus"]), ["Hospitalisation Plus", "Hospitalisation Plus", "", ""]);
});
console.log(`\nproduct scopes: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);

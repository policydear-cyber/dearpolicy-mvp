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
console.log(`\nproduct scopes: ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);

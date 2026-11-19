/** headingIn (lib/policies/printed-heading.ts): the heading a letter prints names a kind of paper, never the addressee or a
 * handling line printed above it (Critic #564 MED-1). */
import assert from "node:assert/strict";
import { headingIn } from "@/lib/policies/printed-heading";

const cases: [string, string | null][] = [
  ["ORCHID LIFE INSURANCE PTE LTD\n19 November 2026\nPRIVATE AND CONFIDENTIAL\nMR TAN AH KOW\nBLK 123 ANG MO KIO AVE 4\nCONFIRMATION OF REINSTATEMENT\nDear Sir", "Confirmation of Reinstatement"],
  ["Orchid Life\n19 Nov 2026\nTAN AH KOW\n#05-12 ROSE COURT\nDear Sir\nNOTICE OF LAPSE", "Notice of Lapse"],
  ["Orchid Life Insurance Berhad (Singapore Branch)\nPolicy Services (fictional)\nCONFIRMATION OF REINSTATEMENT\nDate: 8 January 2026", "Confirmation of Reinstatement"],
  ["MS LEE SIEW LING\nPRIVATE AND CONFIDENTIAL\nDear Ms Lee, thank you.", null],
  ["POLICY SCHEDULE\nPolicy number 123", "Policy Schedule"],
  ["Orchid Life\nConfirmation of Reinstatement\nDear Ms Lee", "Confirmation of Reinstatement"],
  ["Orchid Life\nRE: POLICY LAPSE\nDear Sir", "Policy Lapse"],
  ["PATIENT TAN AH KOW BILL\nTAX INVOICE", "Tax Invoice"],
  ["UNTITLED DOCUMENT\nSTRICTLY CONFIDENTIAL\nTI-IE GREAT EASTEIRN LIFE\nJURONG WEST STREET", null],
  ["NOTICE TO MR CHUA BOON HUAT\nDear Sir", null],
  ["PAYMENT ADVICE FOR CHUA BOON HUAT", "Payment Advice"],
  ["LEE AH LIAN'S CLAIM\nBill To\nPayment Due Date\nStatement for Lee Ah Lian", null],
  ["Bill To\nPayment Due Date\nClaim Reference\nYour Claim", null],
  ["CLAIMS DEPARTMENT\nPAYMENT SERVICES UNIT\nCLAIM DECISION\nDear Sir", "Claim Decision"],
];
let failed = 0;
for (const [text, want] of cases) {
  try { assert.equal(headingIn(text), want); console.log("PASS", want); } catch (e) { failed++; console.log("FAIL", (e as Error).message); }
}
console.log(`printed-heading: ${cases.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);

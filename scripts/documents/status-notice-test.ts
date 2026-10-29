/**
 * A short letter about a policy's status (lapse notice, premium reminder, reinstatement, renewal notice, receipt) that
 * only mentions "your policy schedule" is that notice, never the schedule (lib/documents/messy.ts statusNotice). Filed
 * as a schedule, its sum assured would be read as cover and the notice would count as current evidence that the
 * policy is in force. Real schedules and packs keep their role. Made-up documents, no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const load = () => import("@/lib/documents/intelligence");
type Pages = Parameters<Awaited<ReturnType<typeof load>>["deterministicDocumentRole"]>[0];
const pages = (...texts: string[]) => texts.map((text, i) => ({ pageNumber: i + 1, text, extractionMethod: "text", legibility: "good" })) as unknown as Pages;
const letter = (body: string) => "Dear Mr Kumar\n" + body + "\nYours sincerely\nCustomer Service";

const NOTICES: [string, string, string][] = [
  ["lapse", letter("NOTICE OF LAPSE\nPolicy Number: 77001234\nYour policy lapsed on 1 March 2026. Please refer to your policy schedule.\nLife Assured: Ravi Kumar\nSum Assured: S$200,000"), "other"],
  ["reminder", letter("PREMIUM REMINDER\nPolicy No. 77001234\nAs shown in your policy schedule, premium S$99.00 was due on 1 March 2026.\nGrace period ends 31 March 2026"), "other"],
  ["reinstated", letter("Your policy has been reinstated with effect from 6 January 2026.\nPolicy schedule: no change. Policy Number 77001234\nLife Assured: Ravi Kumar"), "other"],
  ["certificate mention", letter("PREMIUM REMINDER\nPolicy No. 77001234\nPlease keep this with your certificate of insurance.\nInsured person: Ravi Kumar"), "other"],
  ["renewal", letter("RENEWAL NOTICE\nPolicy Number 77001234\nYour renewal premium is S$99.00. Your policy schedule is unchanged."), "renewal_statement"],
  ["receipt", letter("OFFICIAL RECEIPT\nPolicy Number 77001234\nWe received S$99.00. Please keep this with your policy schedule."), "premium_receipt"],
];

test("a status notice that mentions the policy schedule is never filed as the schedule", async () => {
  const { deterministicDocumentRole } = await load();
  for (const [name, text, role] of NOTICES) {
    // Whatever the model read ("other" is a notice chat still sees, never cover).
    for (const model of [null, "personal_schedule", "certificate", "endorsement", "insurer_letter", "renewal_statement"] as const)
      assert.equal(deterministicDocumentRole(pages(text), model), role, name + " / model " + model);
  }
});

const SCHEDULE = "Example Life Ltd\nPolicy Schedule\nPolicy Number\t: 77001234\tPolicy Issue Date\t: 01/03/2026\nPlan\t: Example Critical Illness\nLife Assured\t: Ravi Kumar\nSum Assured\t: 200,000.00\nGrace period: 30 days";

test("real schedules and packs keep their role", async () => {
  const { deterministicDocumentRole } = await load();
  // A schedule that prints its grace period.
  assert.equal(deterministicDocumentRole(pages(SCHEDULE), null), "personal_schedule");
  // A cover letter about the grace period with the schedule behind it.
  assert.equal(deterministicDocumentRole(pages(letter("Your policy is now ready. Note the 30-day grace period for premiums."), SCHEDULE), null), "personal_schedule");
  // A titled schedule that names its plan, on the same page as a letter about a reinstatement.
  assert.equal(deterministicDocumentRole(pages(letter("Your policy has been reinstated.") + "\nPOLICY SCHEDULE - Example Critical Illness\nPolicy Number : 77001234\nLife Assured : Ravi Kumar"), null), "personal_schedule");
  // A long document is never a short notice.
  assert.equal(deterministicDocumentRole(pages(letter("NOTICE OF LAPSE\nPlease refer to your policy schedule. Policy Number 77001234 Insured: Ravi Kumar"), "Terms", "Definitions", "General provisions"), null), "personal_schedule");
  // Neither a notice title nor a letter: the old rules decide, unchanged.
  assert.equal(deterministicDocumentRole(pages("Policy update\nPolicy Number: 77001234\nPremium reminder sent.\nPlease refer to your policy schedule.\nLife Assured: Ravi Kumar"), null), "personal_schedule");
});

test("a notice titled on its own line is a notice even without a letter's greeting and sign-off", async () => {
  const { deterministicDocumentRole } = await load();
  assert.equal(deterministicDocumentRole(pages("Example Life Ltd\nNOTICE OF LAPSE\nPolicy Number: 77001234\nPlease refer to your policy schedule.\nLife Assured: Ravi Kumar"), "personal_schedule"), "other");
  assert.equal(deterministicDocumentRole(pages("Premium Reminder - Example Life\nPolicy No. 77001234\nSee your policy schedule. Premium S$99.00 due 1 March 2026.\nInsured: Ravi Kumar"), "certificate"), "other");
  // A sentence that starts with the words is not a title ("Premium notice: we will send ..." is still checked as a letter).
  assert.equal(deterministicDocumentRole(pages("Example Life Ltd\nPolicy Schedule\nPremium notice will be sent yearly.\nPolicy Number : 77001234\nLife Assured : Ravi Kumar"), null), "personal_schedule");
});

test("TE #184: enclosed schedules under any title keep the pack; lapse wording beats payment words; MY and UK letters", async () => {
  const { deterministicDocumentRole } = await load();
  const reinstated = letter("Your policy has been reinstated. Your updated policy schedule is enclosed.");
  const sched = (title: string) => title + "\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nSum Assured: S$200,000\nGrace period: 30 days";
  for (const title of ["POLICY SCHEDULE / JADUAL POLISI", "YOUR POLICY SCHEDULE", "Policy Schedule: Example Term", "Example Term Policy Schedule"])
    assert.equal(deterministicDocumentRole(pages(reinstated, sched(title)), "personal_schedule"), "personal_schedule", title);
  assert.equal(deterministicDocumentRole(pages(reinstated, "CERTIFICATE OF INSURANCE\nPolicy Number: 77001234\nInsured Person: Ravi Kumar\nSum Assured: S$100,000"), null), "certificate");
  // A lapse notice that mentions the unpaid renewal premium, and a reminder that promises a receipt, are not payment records.
  assert.equal(deterministicDocumentRole(pages(letter("NOTICE OF LAPSE\nPolicy Number: 77001234\nAs the renewal premium of S$99.00 was not received, your policy lapsed. Refer to your policy schedule.")), null), "other");
  assert.equal(deterministicDocumentRole(pages(letter("PREMIUM REMINDER\nPolicy Number: 77001234\nAn official receipt will be sent once paid. See your policy schedule.")), null), "other");
  // Malaysian and UK letter shapes, and notice titles with a word in front.
  assert.equal(deterministicDocumentRole(pages("Tuan/Puan,\nYour policy has lapsed.\nPolicy Number: 77001234\nPlease refer to your policy schedule.\nYang benar,\nExample Takaful"), "personal_schedule"), "other");
  assert.equal(deterministicDocumentRole(pages("Dear Mr Kumar\nYour policy has lapsed.\nPolicy Number: 77001234\nYour policy schedule no longer applies.\nMany thanks\nExample Mutual"), "personal_schedule"), "other");
  for (const title of ["NOTIS PERINGATAN PREMIUM / PREMIUM REMINDER", "Lapse Notification", "Overdue Premium Notice", "Final Premium Reminder", "Reinstatement of your policy"])
    assert.equal(deterministicDocumentRole(pages("Example Life\n" + title + "\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nSee your policy schedule."), "personal_schedule"), "other", title);
});

test("Critic R330: a schedule or certificate named any way but a known reference keeps the old rules", async () => {
  const { deterministicDocumentRole } = await load();
  const reinstated = letter("Your policy has been reinstated with effect from 6 January 2026.");
  const body = "\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nSum Assured: S$200,000";
  for (const title of ["REVISED POLICY SCHEDULE", "Policy Schedule (Revised)", "POLICY SCHEDULE Page 1 of 1", "Example Life Assurance Policy Schedule", "POLICY SCHEDULE:"])
    assert.equal(deterministicDocumentRole(pages(reinstated, title + body), "personal_schedule"), "personal_schedule", title);
  assert.equal(deterministicDocumentRole(pages(reinstated, "Example Life\nPolicy Services\nBlock 1\nExample Road\n1 March 2026\nPolicy Schedule No. 2" + body), "personal_schedule"), "personal_schedule", "title at line 6");
  assert.equal(deterministicDocumentRole(pages(letter("Welcome! Please note the 30-day grace period for premiums.") + "\nYour Policy Schedule" + body), "personal_schedule"), "personal_schedule", "welcome letter");
  // A renewal notice that is also the certificate, a reinstatement that is an endorsement, and a receipt with a bare
  // "SCHEDULE" page never take the notice path: the old rules decide them, as on main.
  const { statusNotice } = await import("@/lib/documents/messy");
  for (const doc of [
    [letter("RENEWAL NOTICE\nRENEWAL CERTIFICATE NO. 2026-77\nInsured: Ravi Kumar\nPolicy Number 77001234")],
    [letter("RENEWAL NOTICE\nThis notice serves as your certificate of insurance.\nInsured: Ravi Kumar\nPolicy Number 77001234")],
    ["Notice of Reinstatement - Endorsement\nPolicy Number 77001234\nLife Assured: Ravi Kumar\nRevised Sum Assured: S$150,000"],
    ["OFFICIAL RECEIPT\nPolicy Number 77001234\nS$99.00 received", "SCHEDULE" + body],
  ]) assert.equal(statusNotice(doc.map((text) => ({ text }))), false, doc[0].slice(0, 50));
  // The kind comes from the notice's own title first.
  assert.equal(deterministicDocumentRole(pages("NOTICE OF LAPSE\nPolicy Number 77001234\nThe renewal premium was not received. Refer to your policy schedule."), null), "other");
  for (const title of ["NOTICE OF POLICY LAPSE", "Reminder: Premium Overdue", "PAYMENT ACKNOWLEDGEMENT"])
    assert.notEqual(deterministicDocumentRole(pages(title + "\nPolicy Number 77001234\nLife Assured: Ravi Kumar\nSee your policy schedule."), "personal_schedule"), "personal_schedule", title);
});

test("Critic R331 / TE round 2: terms a schedule prints are not events; receipts that record a payment stay receipts", async () => {
  const { deterministicDocumentRole } = await load();
  const { statusNotice } = await import("@/lib/documents/messy");
  const body = "\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nSum Assured: S$200,000";
  // Schedules and letters that print grace-period and reinstatement terms are not notices.
  for (const doc of [
    ["Dear Policyholder\nEXAMPLE TERM - YOUR SCHEDULE" + body + "\nReinstatement: a lapsed policy may be reinstated within 2 years\nThank you for choosing Example Life"],
    ["Dear Mr Kumar\nWe are pleased to send your policy details." + body + "\nGrace period: 30 days\nThank you"],
    [letter("Welcome to Example Life. A grace period of 30 days applies to each premium.") + body],
    ["Example Life\nENDORSEMENT NO. 3\nDear Mr Kumar\nThe grace period is extended to 60 days." + body + "\nYours sincerely\nExample Life"],
  ]) assert.equal(statusNotice(doc.map((text) => ({ text }))), false, doc[0].slice(0, 50));
  // A receipt for a reinstatement payment, or for a premium paid within the grace period, records that payment.
  assert.equal(deterministicDocumentRole(pages("OFFICIAL RECEIPT\nPolicy Number 77001234\nWe have received S$99.00 for the reinstatement of your policy. Keep this with your policy schedule."), "personal_schedule"), "premium_receipt");
  assert.equal(deterministicDocumentRole(pages("OFFICIAL RECEIPT\nPolicy Number 77001234\nPremium S$99.00 received within the grace period. See your policy schedule."), null), "premium_receipt");
  // A renewal notice that prints its grace period is still a renewal notice; an overdue one is not.
  assert.equal(deterministicDocumentRole(pages(letter("RENEWAL NOTICE\nPolicy Number 77001234\nYour renewal premium is S$99.00. A 30-day grace period applies. Your policy schedule is unchanged.")), null), "renewal_statement");
  assert.equal(deterministicDocumentRole(pages(letter("RENEWAL NOTICE\nPolicy Number 77001234\nYour renewal premium of S$99.00 has not been received. Refer to your policy schedule.")), null), "other");
});

test("Critic R332: a reference that points at an enclosed schedule is no reference; any other schedule mention blocks", async () => {
  const { statusNotice } = await import("@/lib/documents/messy");
  const details = "YOUR POLICY DETAILS\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nPlan: Example Term\nSum Assured: S$200,000";
  for (const doc of [
    [letter("Your policy has been reinstated. Please see the policy schedule attached."), details],
    [letter("Your policy has been reinstated. Please refer to the policy schedule enclosed."), details],
    [letter("Following reinstatement, the changes in your policy schedule are as follows:\nSum Assured : S$150,000")],
    [letter("Your policy has been reinstated. Your revised schedule follows."), details],
  ]) assert.equal(statusNotice(doc.map((text) => ({ text }))), false, doc[0].slice(14, 80));
  // References that end their sentence, and payment schedules, still let a notice through.
  assert.equal(statusNotice([{ text: letter("Your policy has lapsed on 1 March 2026. Please refer to your policy schedule for details. Your premium schedule stays monthly.") }]), true);
});

test("Critic R334: a letter whose page prints the policy's own particulars keeps today's rules unless titled as a notice", async () => {
  const { deterministicDocumentRole } = await load();
  const header = "Mr Ravi Kumar\nBlock 1\nExample Road\n#01-01\nSingapore 100001\n3 March 2026\nOur ref: EX/LAP/1\nYour ref: -\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nSum Assured: S$200,000\n";
  // Untitled, with a policy number, a named life assured and a sum assured on its page: default-safe, today's rules decide.
  assert.equal(deterministicDocumentRole(pages(header + letter("We write about your policy.\nYour policy has lapsed on 1 March 2026. Please refer to your policy schedule.")), "personal_schedule"), "personal_schedule");
  // Titled as a notice, it is one.
  assert.equal(deterministicDocumentRole(pages("NOTICE OF LAPSE\n" + header + letter("Your policy has lapsed on 1 March 2026. Please refer to your policy schedule.")), "personal_schedule"), "other");
  // A reinstatement letter followed by a page of policy particulars is a pack, whatever the letter says about it.
  const { statusNotice } = await import("@/lib/documents/messy");
  const details = "YOUR POLICY DETAILS\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nPlan: Example Term\nSum Assured: S$200,000";
  for (const body of ["Please see the policy schedule, which is attached.", "Please refer to the policy schedule; it is enclosed with this letter.", "Please refer to your policy schedule\n(attached).",
    "We enclose your updated details overleaf. Please refer to your policy schedule.", "", "Please refer to your policy schedule\nenclosed with this letter.", "Please refer to your policy schedule; a copy is enclosed.", "Please see your policy schedule, attached for reference."])
    assert.equal(statusNotice([{ text: letter("Your policy has been reinstated with effect from 1 November 2026. " + body) }, { text: details }]), false, body || "no mention");
});

test("TE round 4: a receipt that records a payment stays one whatever its footnotes promise; a promise-only form does not", async () => {
  const { deterministicDocumentRole } = await load();
  assert.equal(deterministicDocumentRole(pages("OFFICIAL RECEIPT\nPolicy Number 77001234\nReceived with thanks S$88.20 for the premium due 1 March 2026.\nA copy of this receipt will be sent to your registered email.\nSee your policy schedule."), null), "premium_receipt");
  assert.equal(deterministicDocumentRole(pages("OFFICIAL RECEIPT\nPolicy Number 77001234\nReceived with thanks S$88.20. Premiums not received by the due date may cause the policy to lapse. See your policy schedule."), null), "premium_receipt");
  assert.equal(deterministicDocumentRole(pages("OFFICIAL RECEIPT\nPolicy Number 77001234\nAmount due S$88.20\nAn official receipt will be issued once paid. See your policy schedule."), null), "other");
  // An untitled letter saying the premium is overdue is a status notice, never cover.
  assert.equal(deterministicDocumentRole(pages(letter("Policy Number 77001234\nYour premium of S$88.20 is overdue. Please refer to your policy schedule.\nLife Assured: Ravi Kumar")), "personal_schedule"), "other");
});

test("TE round 5: only a sentence that records a payment keeps a receipt", async () => {
  const { deterministicDocumentRole } = await load();
  const receipt = (body: string) => deterministicDocumentRole(pages("OFFICIAL RECEIPT\nPolicy Number 77001234\n" + body + "\nSee your policy schedule."), null);
  assert.notEqual(receipt("Premium of S$88.20 must be paid by 1 March 2026. A receipt will be issued once payment is received."), "premium_receipt");
  assert.notEqual(receipt("The payment of S$88.20 received on 1 March 2026 was dishonoured by your bank."), "premium_receipt");
  assert.equal(receipt("Amount Received\nS$88.20\nA copy of this receipt will be sent to your registered email."), "premium_receipt");
});

test("TE round 7: more receipt wordings; zero or reversed payments; a field line is no title beside particulars", async () => {
  const { deterministicDocumentRole } = await load();
  const receipt = (title: string, body: string) => deterministicDocumentRole(pages(title + "\nPolicy Number 77001234\n" + body + "\nA copy of this receipt will be sent to your registered email.\nSee your policy schedule."), null);
  assert.equal(receipt("OFFICIAL RECEIPT", "Received from Ravi Kumar the sum of S$88.20 being premium for March 2026."), "premium_receipt");
  assert.equal(receipt("PAYMENT ACKNOWLEDGEMENT", "We acknowledge receipt of S$88.20 for your premium."), "premium_receipt");
  assert.equal(receipt("OFFICIAL RECEIPT", "Thank you for your payment of £45.20 on 1 March 2026."), "premium_receipt");
  assert.notEqual(receipt("OFFICIAL RECEIPT", "Amount Received: S$0.00\nAmount Due: S$88.20\nAn official receipt will be issued once paid."), "premium_receipt");
  assert.notEqual(receipt("OFFICIAL RECEIPT", "Amount Received: S$88.20\nThis payment was reversed on 3 March 2026."), "premium_receipt");
  // "Premium Reminder - by email and SMS" is a field on a page of the policy's particulars, not a notice title.
  assert.equal(deterministicDocumentRole(pages("POLICY DETAILS\nPolicy Number: 77001234\nInsured Person: Ravi Kumar\nSum Insured: S$200,000\nPremium Reminder - by email and SMS"), "personal_schedule"), "personal_schedule");
  // A bare notice title, or one followed by its policy number, still outweighs the particulars.
  assert.equal(deterministicDocumentRole(pages("NOTICE OF LAPSE - 77001234\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nSum Assured: S$200,000\nYour policy lapsed on 1 March 2026."), "personal_schedule"), "other");
});

test("Critic R335: a later page that adds a figure or number of its own is no part of a notice, whatever its layout", async () => {
  const { statusNotice } = await import("@/lib/documents/messy");
  const reinstated = { text: letter("Your policy has been reinstated with effect from 1 November 2026. Please refer to your policy schedule.") };
  for (const page2 of [
    "Policy No : 77001234\nInsured Name : Ravi Kumar\nBasic Sum Assured : S$200,000",
    "Policy Number\t77001234\nLife Assured\tRavi Kumar\nCoverage\tS$200,000",
    "Policy Number\tLife Assured\tSum Assured\n77001234\tRavi Kumar\t200,000",
    "Benefit\tAmount\nDeath\tS$200,000\nTPD\tS$200,000",
  ]) assert.equal(statusNotice([reinstated, { text: page2 }]), false, page2.slice(0, 40));
  // A payment slip that repeats page 1's premium and policy number is still part of the notice.
  const reminder = { text: "PREMIUM REMINDER\nPolicy Number 77001234\nPremium S$88.20 was due on 1 March 2026. See your policy schedule." };
  assert.equal(statusNotice([reminder, { text: "PAYMENT SLIP\nPolicy Number 77001234\nAmount S$88.20\nPay by GIRO or PayNow." }]), true);
});

test("TE round 8: standard receipt footnotes about cheques, GIRO and refunds do not undo a recorded payment", async () => {
  const { deterministicDocumentRole } = await load();
  const receipt = (body: string) => deterministicDocumentRole(pages("OFFICIAL RECEIPT\nPolicy Number 77001234\nReceived with thanks S$88.20.\n" + body + "\nSee your policy schedule."), null);
  for (const footnote of ["Cheques returned unpaid will incur a charge of S$20.", "If your cheque is dishonoured, a charge of S$30 applies.", "Premiums are not refunded if you cancel after 30 days.", "Payments made by GIRO that are rejected by the bank will be charged RM 10."])
    assert.equal(receipt(footnote), "premium_receipt", footnote);
  assert.notEqual(receipt("Your payment of S$88.20 was dishonoured by your bank on 3 March 2026."), "premium_receipt");
  // A bilingual notice title beside the policy's particulars is still a title (TE S4).
  assert.equal(deterministicDocumentRole(pages("NOTIS PERINGATAN PREMIUM / PREMIUM REMINDER\nPolicy Number: 77001234\nLife Assured: Ravi Kumar\nSum Assured: RM 250,000\nPremium RM 180.00 was due on 1 March 2026."), "personal_schedule"), "other");
});

test("Critic R337: small sums on a later page still make it a pack; payment and notes pages stay part of a notice", async () => {
  const { statusNotice } = await import("@/lib/documents/messy");
  const reinstated = { text: letter("Your policy has been reinstated with effect from 1 November 2026. Please refer to your policy schedule.") };
  for (const page2 of [
    "Insured Name : Ravi Kumar\nBenefit\tAmount\nHospital cash\tS$200\nICU\tS$400",
    "Insured Name : Ravi Kumar\nPlan : Example Hospital Income\nUnits : 5\nBenefit per unit per day : S$50",
    "Insured Name : Ravi Kumar\nSum Assured (SGD) : 200000",
    "Insured Name : Ravi Kumar\nCoverage : SGD 200K",
  ]) assert.equal(statusNotice([reinstated, { text: page2 }]), false, page2.slice(0, 60));
  const lapse = { text: "LAPSE NOTICE\nPolicy Number: 77001234\nYour policy lapsed on 1 March 2026 as the premium of S$88.20 was not paid. Please refer to your policy schedule." };
  for (const page2 of [
    "PAYMENT SLIP\nPolicy Number: 77001234\nAmount: S$88.20\nPay by bank transfer to account 123-456789-0\nBiller code: 10045678",
    "Important notes\nA charge of S$20 applies to dishonoured cheques.\nCall our hotline 1800 123 4567 for help.",
    "How to pay\nSort code: 12-34-56\nAccount number: 12345678\nAmount: £45.20",
    "GIRO APPLICATION FORM\nForm No. GF-20231\nBank code: 7171\nPolicy Number: 77001234",
  ]) assert.equal(statusNotice([lapse, { text: page2 }]), true, page2.slice(0, 40));
});

test("TE round 11: payment pages in any layout stay part of a notice; an insured person or a new sum still makes a pack", async () => {
  const { statusNotice } = await import("@/lib/documents/messy");
  const reminder = { text: "Example Life Ltd\nPREMIUM REMINDER\nPolicy Number: KL-77001234\nPremium S$88.20 was due on 1 March 2026. See your policy schedule.\nSum Assured: S$200,000" };
  for (const page2 of [
    "Please detach and return with your payment\nPolicy Number: KL-77001234\nAmount: S$88.20\nBank account: 123-456789-0",
    "Ways to pay\nTo keep your cover in force, pay by bank transfer to account 123-456789-0.\nAmount: S$88.20",
    "How to pay\nPolicyholder: please quote biller code 10045678 when paying S$88.20 by AXS.",
    "PAYMENT SLIP\nPolicy Owner: Ravi Kumar\nPolicy Number: KL-77001234\nAmount: S$88.20\nBank account: 123-456789-0",
    // The same sum assured written another way ("S$200K") is page 1's figure.
    "Notes\nYour sum assured of S$200K is unchanged.",
  ]) assert.equal(statusNotice([reminder, { text: page2 }]), true, page2.slice(0, 40));
  for (const page2 of [
    "Payment by GIRO\nLife Assured: Ravi Kumar\nBank account: 123-456789-0\nAmount: S$88.20",
    "Please detach and return with your payment\nPolicy Number: KL-77001234\nAmount: S$88.20\nTotal Permanent Disability\tS$150,000",
    "Ways to pay\nBank account: 123-456789-0\nCover reference CV-44718 for Plan Harbour Term",
    "PAYMENT SLIP\nPolicy Number: KL-77001234\nAmount: S$88.20\nBenefit period : 30 days",
    "PAYMENT SLIP\nPolicy Number: KL-77001234\nAmount: S$88.20\nRider waiver premium benefit : S$5,000",
  ]) assert.equal(statusNotice([reminder, { text: page2 }]), false, page2.slice(0, 40));
  // Critic R338: a notes or terms page that adds a cover figure without a cover word is part of a pack.
  const reinstated = { text: letter("Your policy has been reinstated with effect from 1 November 2026. Please refer to your policy schedule.") };
  for (const page2 of [
    "IMPORTANT NOTES\nHospital cash\tS$200\nICU\tS$400",
    "TERMS AND CONDITIONS\nRider\tAmount\nCritical Illness Rider\tS$50,000",
    // Critic R340: what a policy pays out is no payment line.
    "IMPORTANT NOTES\nAmount payable on death : S$200,000",
    "IMPORTANT NOTES\nTotal payable on death\tS$250,000",
    "IMPORTANT NOTES\nPaid on diagnosis of a critical illness : S$50,000",
    // A currency stuck to a word or a figure is still money; only the letters of a word ("Term 20") are not RM.
    "IMPORTANT NOTES\nHospital cash TotalS$500",
    "IMPORTANT NOTES\nHospital cash RM500",
    "IMPORTANT NOTES\nHospital cash (SGD 500)",
    // Critic R339 M2: a units-only schedule page that prints its payment mode.
    "POLICY DETAILS\nPolicy Owner : Ravi Kumar\nPayment Mode : GIRO\nPlan : Example Hospital Income\nUnits : 5",
    // Critic R341: schedule rows without a figure.
    "POLICY DETAILS\nPolicy Owner : Ravi Kumar\nPayment Mode : GIRO\nPlan : Example Hospital Income Plan B\nRider : Example Critical Illness Rider",
    "POLICY DETAILS\nPolicy Owner\nPlan : Example Shield Plan A\nWard class : B1\nCoverage : As charged",
  ]) assert.equal(statusNotice([reinstated, { text: page2 }]), false, page2.slice(0, 40));
  // A sum to pay that page 1 does not print stays part of the notice.
  for (const page2 of [
    "PAYMENT SLIP\nPolicy Number: KL-77001234\nTotal amount payable: S$176.40\nPay by PayNow",
    // TE round 13: a new premium or a late-payment charge is no cover figure.
    "Important notes\nYour premium will be S$95.00 from 1 January 2027.",
    "Important notes\nInterest of S$3.20 is charged on premiums paid late.",
    // TE round 14: a sentence after a row label, PDF double spacing, or a bare plan name on a slip is no schedule row.
    "Important notes\nThe premium for your rider will be S$12.50 a month from 1 January 2027.",
    "Important notes\nBenefits: please refer to your policy schedule.",
    "Important notes\nBenefits  will cease if the premium is not paid within the grace period.",
    "PAYMENT SLIP\nPlan: Harbour Term 20\nPolicy Number: KL-77001234\nAmount: S$88.20\nBank account: 123-456789-0",
    "PAYMENT SLIP\nPolicy Number: KL-77001234\nAmount payable (2 months): S$176.40\nBank account: 123-456789-0",
    "PAYMENT SLIP\nPolicy Number: KL-77001234\nBasic premium: S$75.70\nRider premium: S$12.50\nTotal: S$88.20",
  ]) assert.equal(statusNotice([reminder, { text: page2 }]), true, page2.slice(0, 40));
  for (const page2 of ["Important notes\nPremium waiver benefit: S$5,000", "Important notes\nThe premium waiver sum is S$5,000"])
    assert.equal(statusNotice([reminder, { text: page2 }]), false, page2);
});

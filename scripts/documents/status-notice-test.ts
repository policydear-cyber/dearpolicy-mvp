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

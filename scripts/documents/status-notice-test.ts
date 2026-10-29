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

const NOTICES: [string, string, string | null][] = [
  ["lapse", letter("NOTICE OF LAPSE\nPolicy Number: 77001234\nYour policy lapsed on 1 March 2026. Please refer to your policy schedule.\nLife Assured: Ravi Kumar\nSum Assured: S$200,000"), null],
  ["reminder", letter("PREMIUM REMINDER\nPolicy No. 77001234\nAs shown in your policy schedule, premium S$99.00 was due on 1 March 2026.\nGrace period ends 31 March 2026"), null],
  ["reinstated", letter("Your policy has been reinstated with effect from 6 January 2026.\nPolicy schedule: no change. Policy Number 77001234\nLife Assured: Ravi Kumar"), null],
  ["certificate mention", letter("PREMIUM REMINDER\nPolicy No. 77001234\nPlease keep this with your certificate of insurance.\nInsured person: Ravi Kumar"), null],
  ["renewal", letter("RENEWAL NOTICE\nPolicy Number 77001234\nYour renewal premium is S$99.00. Your policy schedule is unchanged."), "renewal_statement"],
  ["receipt", letter("OFFICIAL RECEIPT\nPolicy Number 77001234\nWe received S$99.00. Please keep this with your policy schedule."), "premium_receipt"],
];

test("a status notice that mentions the policy schedule is never filed as the schedule", async () => {
  const { deterministicDocumentRole } = await load();
  for (const [name, text, role] of NOTICES) {
    assert.equal(deterministicDocumentRole(pages(text), null), role, name);
    // A model reading "personal_schedule", "certificate" or "insurer_letter" for it gives "other" (a notice chat still sees).
    for (const model of ["personal_schedule", "certificate", "endorsement", "insurer_letter"] as const)
      assert.equal(deterministicDocumentRole(pages(text), model), role ?? "other", name + " / model " + model);
    assert.equal(deterministicDocumentRole(pages(text), "renewal_statement"), role ?? "renewal_statement", name + " / model renewal_statement");
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

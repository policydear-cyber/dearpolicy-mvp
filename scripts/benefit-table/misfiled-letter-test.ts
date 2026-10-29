/**
 * A policy pack stored as a letter before today's role rules (lib/benefit-table/service.ts filedBeforeRoleRules): its cover
 * letter came first, so intake filed the whole pack as correspondence and never read its cover; chat leaves letters out.
 * Coverage now offers Read again for it ("table_unread"), and only for it: a real letter, bill, note, receipt or
 * statement stays "no_table". Made-up documents, no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const load = () => import("@/lib/benefit-table/service");
const pages = (...texts: string[]) => texts.map((text, i) => ({ page: i + 1, text }));

const LETTER = "Mr Ravi Kumar\tCustomer Service\nBlk 1 Example Road\tHotline: (65) 6000 0000\n1 March 2026\nDear Mr Kumar\nYour Example Critical Illness Policy is now ready\nHere's your policy document for your safekeeping.";
const SIGN_OFF = "Thank you for choosing Example Life.\nYours sincerely\nA Person\nHead of Operations";
const SCHEDULE = "Example Life Ltd\nPolicy Schedule\nDetails of Policy\nPolicy Number\t: 77001234\tPolicy Issue Date\t: 01/03/2026\nPlan\t: Example Critical Illness\nLife Assured\t: Ravi Kumar\nSum Assured\t: 200,000.00";
const PACK = pages(LETTER, SIGN_OFF, SCHEDULE, "GENERAL PROVISIONS\n1. DEFINITIONS");
const PLAIN_LETTER = pages(LETTER.replace("Here's your policy document for your safekeeping.", "Your policy terms are changing from 1 April 2027."), SIGN_OFF,
  "Questions and answers\nWhat changes?\nThe Policy Schedule you hold stays the same.");

const ready = (role: string, n: number, misfiled: boolean, quarantine = "scan_clean") =>
  ({ status: "ready", pages: n, live: false, misfiled, file: { document_role: role, quarantine } });

test("a pack stored as a letter that today's rules read as a schedule is offered Read again", async () => {
  const { filedBeforeRoleRules, documentState } = await load();
  assert.equal(filedBeforeRoleRules("insurer_letter", PACK), true);
  assert.equal(documentState(ready("insurer_letter", PACK.length, true), false), "table_unread");
});

test("a real letter, and payment or reference documents, are never re-filed this way", async () => {
  const { filedBeforeRoleRules, documentState } = await load();
  assert.equal(filedBeforeRoleRules("insurer_letter", PLAIN_LETTER), false);
  assert.equal(documentState(ready("insurer_letter", PLAIN_LETTER.length, false), false), "no_table");
  // Receipts and statements are payment evidence: their roles are not correspondence, even if their pages print a schedule.
  for (const role of ["premium_receipt", "renewal_statement", "annual_statement"]) assert.equal(filedBeforeRoleRules(role, PACK), false, role);
  // A document already filed as a schedule is not "misfiled", and no pages means nothing to judge.
  assert.equal(filedBeforeRoleRules("personal_schedule", PACK), false);
  assert.equal(filedBeforeRoleRules("insurer_letter", []), false);
  assert.equal(filedBeforeRoleRules(null, PACK), false);
});

test("Read again is offered only where it can run: not while reading, not on a held scan, not once read", async () => {
  const { documentState } = await load();
  assert.equal(documentState({ ...ready("insurer_letter", 4, true), live: true }, false), "waiting");
  assert.equal(documentState(ready("insurer_letter", 4, true, "scan_failed"), false), "no_table");
  assert.equal(documentState(ready("insurer_letter", 4, true), true), "read");
  assert.equal(documentState(ready("insurer_letter", 0, true), false), "no_table");
});

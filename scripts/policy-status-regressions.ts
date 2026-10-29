/**
 * A premium reminder's grace period, before and after the date it prints (lib/chat/policy-status.ts). After the date
 * the reminder cannot say whether the premium was paid: the status is neither "in force" nor "lapsed", and the sentence
 * says so and points to the insurer. Made-up documents only. No database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { printedStatus, statusSentence } from "@/lib/chat/policy-status";

const REMINDER = [{ page: 1, text: [
  "PREMIUM REMINDER",
  "Policy number HC-0042-7781",
  "Premium due date: 20 September 2026",
  "Monthly premium S$212.40",
  "Grace period ends 20 October 2026",
  "Your policy stays in force during the grace period.",
].join("\n") }];

test("before the grace date: in its grace period, with the unpaid premium", () => {
  const st = printedStatus(REMINDER, null, "2026-10-19");
  assert.equal(st.state, "grace");
  const s = statusSentence("Example Shield", st)!;
  assert.match(s, /is in its grace period \(page 1\): the premium of S\$212\.40 due on 20 September 2026 has not been received/);
  assert.match(s, /stays in force until 20 October 2026/);
});

test("on the grace date itself: still in its grace period", () => {
  assert.equal(printedStatus(REMINDER, null, "2026-10-20").state, "grace");
});

test("after the grace date: passed, never said to be lapsed or in force", () => {
  const st = printedStatus(REMINDER, null, "2026-10-29");
  assert.equal(st.state, "grace_passed");
  assert.equal(st.printed, "20 October 2026");
  assert.equal(st.page, 1);
  const s = statusSentence("Example Shield", st)!;
  assert.match(s, /Example Shield \(page 1\): the premium of S\$212\.40 due on 20 September 2026 had to be paid by 20 October 2026\./);
  assert.match(s, /That date has passed and the reminder cannot show whether it was; if not, the policy can lapse/);
  assert.match(s, /insurer can confirm whether it is still in force/);
  assert.doesNotMatch(s, /\blapsed\b|\bis in its grace period\b|\bstays in force\b|\bhas not been received\b/);
});

test("after the grace date with no amount printed: no figure invented", () => {
  const pages = [{ page: 2, text: "Grace period ending on 3 March 2026\nPlease pay promptly." }];
  const st = printedStatus(pages, null, "2026-04-01");
  assert.equal(st.state, "grace_passed");
  const s = statusSentence("Example Life", st)!;
  assert.match(s, /Example Life \(page 2\): an unpaid premium had to be paid by 3 March 2026\./);
  assert.doesNotMatch(s, /S\$|\d+\.\d\d/);
});

test("a lapse notice still reads as lapsed, and a document with neither reads as before", () => {
  assert.equal(printedStatus([{ page: 1, text: "Your policy lapsed on 17 March 2026." }], null, "2026-10-29").state, "lapsed");
  assert.equal(printedStatus([{ page: 1, text: "Period of insurance 1 June 2025 to 31 May 2027" }], null, "2026-10-29").state, "in_force");
  assert.equal(printedStatus([{ page: 1, text: "Period of insurance 1 June 2024 to 31 May 2025" }], null, "2026-10-29").state, "ended");
  assert.equal(printedStatus([{ page: 1, text: "Schedule of benefits" }], null, "2026-10-29").state, "unknown");
  assert.equal(statusSentence("X", { state: "unknown", date: null, printed: null, page: null, line: null }), null);
});

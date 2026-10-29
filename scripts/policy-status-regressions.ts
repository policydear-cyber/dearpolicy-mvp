/**
 * A premium reminder's grace period, before and after the date it prints (lib/chat/policy-status.ts). After the date
 * the reminder cannot say whether the premium was paid: the status is neither "in force" nor "lapsed", and the sentence
 * says so and points to the insurer. Made-up documents only. No database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { graceEndDates, printedPeriodStart, printedStatus, statusSentence, supersedePassedGrace, type PrintedStatus } from "@/lib/chat/policy-status";

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
  const pages = [{ page: 2, text: "Premium due date: 1 February 2026\nGrace period ending on 3 March 2026\nPlease pay promptly." }];
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

test("a wording's worked example is not a reminder (Critic R324 H2)", () => {
  const wording = [{ page: 7, text: [
    "Grace period",
    "We allow a grace period of 30 days. For example, if your premium is due on 1 March 2025, the grace period ends on 31 March 2025.",
  ].join("\n") }];
  assert.equal(printedStatus(wording, null, "2026-10-29").state, "unknown");
  const wrapped = [{ page: 7, text: "For example, if your premium is due on 1 March 2025, the\ngrace period ends on 31 March 2025." }];
  assert.equal(printedStatus(wrapped, null, "2026-10-29").state, "unknown");
  // A grace date with nothing due beside it is no reminder either.
  assert.equal(printedStatus([{ page: 1, text: "Grace period ends 31 March 2025" }], null, "2026-10-29").state, "unknown");
  // A reminder with an amount due in another currency is still one.
  assert.equal(printedStatus([{ page: 1, text: "Amount due RM 86.40\nGrace period ends 20 October 2026" }], null, "2026-10-29").state, "grace_passed");
});

const doc = (id: string, over: Partial<{ policy_number: string | null; product_name: string | null; owners: Set<string>; date: string | null }> = {}) =>
  ({ id, policy_number: "HC-0042-7781", product_name: "Example Shield", owners: new Set(["p1"]), date: "2026-09-25", ...over });
const passedOf = () => new Map<string, PrintedStatus>([["rem", printedStatus(REMINDER, null, "2026-10-29")]]);

test("a later renewal or receipt of the same policy wins over a passed reminder (Critic R324 H1)", () => {
  // Renewed schedule of the same policy number, dated after the grace date.
  let st = supersedePassedGrace(passedOf(), [doc("rem"), doc("sched", { date: "2026-11-01" })], new Map());
  assert.equal(st.get("rem")!.state, "unknown");
  // Same product for the same person, no policy number printed on the schedule.
  st = supersedePassedGrace(passedOf(), [doc("rem"), doc("sched", { policy_number: null, date: "2026-10-25" })], new Map());
  assert.equal(st.get("rem")!.state, "unknown");
  // A payment recorded after the grace date, on the reminder or on another document of the policy.
  assert.equal(supersedePassedGrace(passedOf(), [doc("rem"), doc("rcpt", { date: "2026-01-05" })], new Map([["rcpt", "2026-10-21"]])).get("rem")!.state, "unknown");
});

test("an older document, another person's plan or another policy does not override a passed reminder", () => {
  const keeps = (docs: ReturnType<typeof doc>[], paid = new Map<string, string | null>()) => assert.equal(supersedePassedGrace(passedOf(), docs, paid).get("rem")!.state, "grace_passed");
  keeps([doc("rem"), doc("old", { date: "2026-01-01" })]);
  keeps([doc("rem"), doc("old", { date: "2026-10-20" })]);
  keeps([doc("rem"), doc("other", { policy_number: "ZZ-1", product_name: "Other Plan", date: "2026-11-01" })]);
  keeps([doc("rem"), doc("theirs", { policy_number: null, owners: new Set(["p2"]), date: "2026-11-01" })]);
  keeps([doc("rem")], new Map([["rem", "2026-10-22"]])); // the reminder's own premium row is what it asks for, not a payment
  keeps([doc("rem"), doc("rcpt", { date: "2026-01-05" })], new Map([["rcpt", "2026-09-19"]])); // paid before it fell due: an earlier premium
  keeps([doc("rem"), doc("other", { policy_number: "ZZ-1", product_name: "Other Plan" })], new Map([["other", "2026-10-25"]]));
});

const notice = (graceLine: string, extra: string[] = []) => [{ page: 1, text: ["PREMIUM REMINDER", "Premium due date: 20 September 2026", ...extra, graceLine].join("\n") }];

test("grace end dates as notices print them (TE F4)", () => {
  for (const line of ["Grace period end date: 20 October 2026", "Grace period ends 20/10/2026", "Grace period ends 20 Oct 2026", "Grace period ends on 20th October 2026",
    "Your policy stays in force during the 30-day grace period, which ends on 20 October 2026", "A grace period of 30 days, ending 20 October 2026, applies",
    "The grace period expires on 20 October 2026", "Grace period: 20.10.2026", "Grace period until 20 Oct. 2026"]) {
    const st = printedStatus(notice(line), null, "2026-10-29");
    assert.equal(st.state, "grace_passed", line);
    assert.equal(st.date, "2026-10-20", line);
    assert.equal(st.printed, "20 October 2026", line);
  }
  // Wrapped onto the next line.
  assert.equal(printedStatus([{ page: 1, text: "Premium due date: 20 September 2026\nYour grace period ends on\n20 October 2026." }], null, "2026-10-29").date, "2026-10-20");
  // The date as printed is kept for finding the quoted line.
  assert.equal(printedStatus(notice("Grace period ends 20/10/2026"), null, "2026-10-29").datePrinted, "20/10/2026");
  // Not a grace end: a start date, a length only, an impossible date.
  assert.deepEqual(graceEndDates("The grace period of 30 days from 20 September 2026 applies."), []);
  assert.deepEqual(graceEndDates("A grace period of 30 days applies."), []);
  assert.deepEqual(graceEndDates("Grace period ends 31/13/2026"), []);
});

test("the unpaid amount is the premium line's own figure, never another figure on the page (TE F2)", () => {
  const withNeighbours = notice("Grace period ends 20 October 2026", ["Annual limit S$150,000 per policy year", "Premium waiver benefit S$50,000", "Monthly premium S$212.40"]);
  const st = printedStatus(withNeighbours, null, "2026-10-29");
  assert.equal(st.dueAmount, "S$212.40");
  assert.match(statusSentence("Example Shield", st)!, /the premium of S\$212\.40 due on 20 September 2026/);
  // Only neighbours with figures: no amount, said as "an unpaid premium".
  const noPremiumLine = printedStatus(notice("Grace period ends 20 October 2026", ["Annual limit S$150,000 per policy year", "Premium waiver benefit S$50,000"]), null, "2026-10-29");
  assert.equal(noPremiumLine.dueAmount, null);
  const s = statusSentence("Example Shield", noPremiumLine)!;
  assert.match(s, /an unpaid premium had to be paid by 20 October 2026/);
  assert.doesNotMatch(s, /150,000|50,000/);
  for (const line of ["Amount due: S$86.40", "Outstanding premium S$86.40 (incl. GST)", "Annual premium S$1,188.00"])
    assert.ok(printedStatus(notice("Grace period ends 20 October 2026", [line]), null, "2026-10-29").dueAmount, line);
  for (const line of ["Premium waiver benefit S$50,000", "Annual limit S$150,000", "Premium paid to date S$2,400.00", "Sum assured S$200,000 premium S$99.00"])
    assert.equal(printedStatus(notice("Grace period ends 20 October 2026", [line]), null, "2026-10-29").dueAmount, null, line);
});

test("TE R2: notice wording, other currencies, two numbers, payment inside the grace period, undated renewal", () => {
  // G1: a notice's own "If your premium is not paid" is not a worked example; "if your premium is due on" is.
  for (const t of ["Monthly premium S$99.00\nIf your premium is not paid, your grace period ends on 20 November 2026.", "Monthly premium S$99.00\nIf the premium remains unpaid,\nthe grace period ends on 20 November 2026."]) {
    assert.equal(printedStatus([{ page: 1, text: t }], null, "2026-11-01").state, "grace", t);
    assert.equal(printedStatus([{ page: 1, text: t }], null, "2026-11-25").state, "grace_passed", t);
  }
  assert.equal(printedStatus([{ page: 1, text: "Monthly premium S$99.00\nIf your premium is due on 1 March 2025, the grace period ends on 31 March 2025." }], null, "2026-10-29").state, "unknown");
  // G2: the same reminder in RM, £ or with "Amount payable" and no due-date line.
  for (const line of ["Monthly premium RM 180.00", "Monthly premium £45.20", "Amount payable: S$212.40"]) {
    const st = printedStatus([{ page: 1, text: line + "\nGrace period ends 20 October 2026" }], null, "2026-10-29");
    assert.equal(st.state, "grace_passed", line);
    assert.equal(st.dueAmount, line.match(/(?:RM|£|S\$)\s?[\d.]+/)![0], line);
  }
  // G3: same product, same person, a different printed number is another policy.
  assert.equal(supersedePassedGrace(passedOf(), [doc("rem"), doc("kt2", { policy_number: "KT-2-0002", date: "2026-11-01" })], new Map()).get("rem")!.state, "grace_passed");
  // G4: a receipt paid inside the grace period, or on its last day, counts.
  for (const day of ["2026-10-02", "2026-10-20"])
    assert.equal(supersedePassedGrace(passedOf(), [doc("rem"), doc("rcpt", { date: "2026-01-05" })], new Map([["rcpt", day]])).get("rem")!.state, "unknown", day);
});

test("TE R2 G5: an undated renewal is dated by the period it prints", () => {
  assert.equal(printedPeriodStart([{ page: 1, text: "RENEWAL SCHEDULE\nPeriod of insurance 19 October 2026 to 18 October 2027" }]), "2026-10-19");
  assert.equal(printedPeriodStart([{ page: 1, text: "Schedule of benefits" }]), null);
});

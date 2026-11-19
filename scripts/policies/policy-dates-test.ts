/** Policy dates (DC 19 Nov 2026): each policy's printed end date, a passed date asking for proof of renewal instead of
 * "ended", and a premium record of the same policy after that date showing it renewed. Invented households and insurers,
 * every date style the reader keeps. Pure functions; no database, no network.
 *   node --import tsx scripts/policies/policy-dates-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayOf, dayText, householdPolicyDates, sharingDocuments, policyDates, renewalAfter, type DatedContract, type DatedCover, type PaymentRecord } from "@/lib/policies/policy-dates";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const day = (iso: string) => Date.parse(iso + "T00:00:00Z") / 86_400_000;
const TODAY = day("2026-11-19");
const doc = (id: string, extra: Partial<DatedContract["documents"][number]> = {}) => ({ id, effective_date: null, renewal_or_expiry_date: null, policy_number: null, group_policy_number: null, ...extra });
const contract = (id: string, docs: DatedContract["documents"], extra: Partial<DatedContract> = {}): DatedContract => ({ id, ownerId: "p1", name: "Harbourline Term Protector", insurer: "Harbourline Assurance", documents: docs, ...extra });
const cover = (documentId: string, name: string, endDate: string | null, startDate: string | null = null, page = 2): DatedCover => ({ documentId, name, startDate, endDate, page });
const pay = (extra: Partial<PaymentRecord>): PaymentRecord => ({ policy_id: null, source_document_id: "r1", family_member_id: "p1", insurer: "Harbourline Assurance", policy_number: null, payment_date: null, period_start: null, period_end: null, created_at: null, ...extra });

test("every date style the reader keeps is read; anything else is not", () => {
  for (const [text, iso] of [["17-Nov-2101", "2101-11-17"], ["27 JUN 2112", "2112-06-27"], ["04/10/2026", "2026-10-04"], ["2026-10-04", "2026-10-04"], ["21 Sep 2092", "2092-09-21"], ["17 Nov. 2101", "2101-11-17"], ["5 October 2027", "2027-10-05"]])
    assert.equal(dayOf(text), day(iso), text);
  for (const text of ["", "Lifetime", "age 65", "31/02/2026", "Nov 2101", "17-Foo-2101", null]) assert.equal(dayOf(text), null, String(text));
  assert.equal(dayText(day("2101-11-17")), "17 Nov 2101");
});

test("the policy's last printed cover date; riders ending sooner are listed with their own dates", () => {
  const c = contract("k1", [doc("d1")]);
  const covers = [cover("d1", "Accelerated Terminal Illness", "17-Nov-2101", "17-Nov-2016"), cover("d1", "Accident Assist", "17-Nov-2066"), cover("d1", "Hospital Cash", "17-Nov-2061"), cover("d1", "Crisis Waiver", "17-Nov-2101")];
  const r = policyDates(c, covers, [], TODAY);
  assert.equal(r.state, "until"); assert.equal(r.endsOn, "2101-11-17"); assert.equal(r.endsText, "17 Nov 2101");
  assert.deepEqual(r.source, { documentId: "d1", page: 2 });
  assert.equal(r.startedOn, "2016-11-17");
  assert.deepEqual(r.sooner.map((s) => [s.name, s.endsText, s.ended]), [["Hospital Cash", "17 Nov 2061", false], ["Accident Assist", "17 Nov 2066", false]]);
});

test("a rider whose date has passed is listed as ended, and never ends the policy", () => {
  const r = policyDates(contract("k1", [doc("d1")]), [cover("d1", "Main plan", "27 JUN 2112"), cover("d1", "Waiver rider", "27 JUN 2020")], [], TODAY);
  assert.equal(r.state, "until"); assert.deepEqual(r.sooner.map((s) => [s.name, s.ended]), [["Waiver rider", true]]);
});

test("another document's covers never date this policy (another person's or product's schedule)", () => {
  const r = policyDates(contract("k1", [doc("d1")]), [cover("d2", "Other plan", "01/01/2030"), cover("d1", "Main", null)], [], TODAY);
  assert.equal(r.state, "no_date"); assert.equal(r.endsOn, null); assert.deepEqual(r.sooner, []);
});

test("no cover line dated: the document's own printed expiry date; none at all: 'no_date', never a guess", () => {
  const r = policyDates(contract("k1", [doc("d1", { renewal_or_expiry_date: "2027-03-31", effective_date: "2026-04-01" })]), [], [], TODAY);
  assert.equal(r.state, "until"); assert.equal(r.endsOn, "2027-03-31"); assert.deepEqual(r.source, { documentId: "d1", page: null }); assert.equal(r.startedOn, "2026-04-01");
  const none = policyDates(contract("k2", [doc("d2")]), [cover("d2", "Main", null)], [], TODAY);
  assert.equal(none.state, "no_date"); assert.equal(none.daysLeft, null); assert.equal(none.renewal, null);
});

test("a date within 60 days ends soon, with the days left; today itself still counts as cover", () => {
  const soon = policyDates(contract("k1", [doc("d1")]), [cover("d1", "Main", "31/12/2026")], [], TODAY);
  assert.equal(soon.state, "ends_soon"); assert.equal(soon.daysLeft, 42);
  assert.equal(policyDates(contract("k1", [doc("d1")]), [cover("d1", "Main", "19/11/2026")], [], TODAY).state, "ends_soon");
  assert.equal(policyDates(contract("k1", [doc("d1")]), [cover("d1", "Main", "19/01/2027")], [], TODAY).state, "until");
});

test("a passed date with no renewal evidence asks for proof, never 'ended'", () => {
  const r = policyDates(contract("k1", [doc("d1")]), [cover("d1", "Single Trip", "04/10/2026", "29/09/2026")], [], TODAY);
  assert.equal(r.state, "renewal_due"); assert.equal(r.endsText, "4 Oct 2026"); assert.ok(r.daysLeft! < 0); assert.equal(r.renewal, null);
});

test("a newer schedule of the same policy with a later date moves the date on", () => {
  const r = policyDates(contract("k1", [doc("old"), doc("new")]), [cover("old", "Shield", "31/03/2026"), cover("new", "Shield", "31/03/2027")], [], TODAY);
  assert.equal(r.state, "until"); assert.equal(r.endsOn, "2027-03-31"); assert.deepEqual(r.sooner, []);
});

test("a receipt of the same policy after the date: renewed, with the receipt's own period end when printed", () => {
  const c = contract("k1", [doc("d1", { policy_number: "HL-0042-77" })]);
  const covers = [cover("d1", "Family PA", "31/10/2026")];
  const withPeriod = policyDates(c, covers, [pay({ policy_number: "HL 0042 77", payment_date: "2026-10-28", period_start: "2026-11-01", period_end: "2027-10-31" })], TODAY);
  assert.equal(withPeriod.state, "renewed"); assert.equal(withPeriod.renewal?.paidText, "28 Oct 2026"); assert.equal(withPeriod.renewal?.untilText, "31 Oct 2027"); assert.equal(withPeriod.renewal?.documentId, "r1");
  const paidOnly = policyDates(c, covers, [pay({ policy_id: "d1", payment_date: "2026-11-03" })], TODAY);
  assert.equal(paidOnly.state, "renewed"); assert.equal(paidOnly.renewal?.paidText, "3 Nov 2026"); assert.equal(paidOnly.renewal?.until, null, "no period printed: no new end date");
});

test("a payment made before the date proves nothing, even uploaded after it (Critic MED-1, TE F1)", () => {
  const c = contract("k1", [doc("d1")]); const covers = [cover("d1", "Family PA", "31/10/2026")];
  const state = (p: Partial<PaymentRecord>) => policyDates(c, covers, [pay({ policy_id: "d1", ...p })], TODAY).state;
  assert.equal(state({ payment_date: "2026-10-20", created_at: "2026-10-21T02:00:00Z" }), "renewal_due");
  assert.equal(state({ payment_date: "2026-10-20", created_at: "2026-11-05T02:00:00Z" }), "renewal_due", "a monthly payer's last instalment, uploaded when asked");
  assert.equal(state({ payment_date: "2026-06-01", created_at: "2026-11-05T02:00:00Z" }), "renewal_due", "a payment months before is the old term's");
  assert.equal(state({ payment_date: "2026-10-31" }), "renewed", "paid on the renewal date, no period printed");
  assert.equal(state({ period_end: "2026-10-31", created_at: "2026-11-05T02:00:00Z" }), "renewal_due", "a period ending on the date is the old term");
  assert.equal(state({ period_start: "2025-11-01", period_end: "2026-11-01", payment_date: "2026-11-10" }), "renewal_due", "an old term printed one day past the schedule's end (Critic L1), paid late");
  assert.equal(state({ period_start: "2026-10-01", period_end: "2026-10-31", payment_date: "2026-09-28", created_at: "2026-11-19T02:00:00Z" }), "renewal_due", "a trip's own purchase receipt (TE F1)");
  assert.equal(state({ period_start: "2026-11-01", period_end: "2027-10-31", payment_date: "2026-10-20" }), "renewed", "next term paid early");
  assert.equal(state({ period_start: "2026-10-28" }), "renewal_due", "a start alone before the date (a monthly instalment) is not the next term");
  assert.equal(state({ period_start: "2026-10-31" }), "renewed", "a start alone on the date");
});

test("contracts sharing a document are flagged, so one answer never hides another policy on it (Critic MED-6)", () => {
  const shared = sharingDocuments([contract("k1", [doc("stmt"), doc("d1")]), contract("k2", [doc("stmt")]), contract("k3", [doc("d3")])]);
  assert.deepEqual([...shared].sort(), ["k1", "k2"]);
});

test("a group number counts only for a record naming the person; a short number alone needs both insurers (Critic L2, L3)", () => {
  const c = contract("k1", [doc("d1", { policy_number: "M-1", group_policy_number: "GRP-778812" })]); const covers = [cover("d1", "Group Term", "31/10/2026")];
  const after = { payment_date: "2026-11-02" };
  assert.equal(policyDates(c, covers, [pay({ ...after, policy_number: "GRP-778812", family_member_id: null })], TODAY).state, "renewal_due");
  assert.equal(policyDates(c, covers, [pay({ ...after, policy_number: "GRP-778812", family_member_id: "p1" })], TODAY).state, "renewed");
  assert.equal(policyDates(c, covers, [pay({ ...after, policy_number: "M-1", insurer: null })], TODAY).state, "renewal_due");
  assert.equal(policyDates(c, covers, [pay({ ...after, policy_number: "M-1" })], TODAY).state, "renewed");
});

test("another person's, another number's or another insurer's receipt never renews this policy", () => {
  const c = contract("k1", [doc("d1", { policy_number: "HL-0042-77" })]); const covers = [cover("d1", "Family PA", "31/10/2026")];
  const after = { payment_date: "2026-11-02" };
  assert.equal(policyDates(c, covers, [pay({ ...after, policy_id: "d1", family_member_id: "p2" })], TODAY).state, "renewal_due");
  assert.equal(policyDates(c, covers, [pay({ ...after, policy_number: "HL-0042-78" })], TODAY).state, "renewal_due");
  assert.equal(policyDates(c, covers, [pay({ ...after, policy_number: "HL-0042-77", insurer: "Serimas General" })], TODAY).state, "renewal_due");
  assert.equal(policyDates(c, covers, [pay({ ...after })], TODAY).state, "renewal_due", "a receipt naming no policy");
});

test("'I didn't renew it' counts only for the same policy and the same printed date, and a later receipt wins", () => {
  const c = contract("k1", [doc("d1", { policy_number: "HL-1" })]); const covers = [cover("d1", "Family PA", "31/10/2026")];
  assert.equal(policyDates(c, covers, [], TODAY, new Set(["k1|2026-10-31"])).state, "not_renewed");
  assert.equal(policyDates(c, covers, [], TODAY, new Set(["k1|2026-10-30"])).state, "renewal_due", "another date");
  assert.equal(policyDates(c, covers, [], TODAY, new Set(["k2|2026-10-31"])).state, "renewal_due", "another policy");
  assert.equal(policyDates(c, covers, [pay({ policy_id: "d1", payment_date: "2026-11-02" })], TODAY, new Set(["k1|2026-10-31"])).state, "renewed", "receipt after the date");
  assert.equal(policyDates(c, [cover("d1", "Family PA", "31/10/2027")], [], TODAY, new Set(["k1|2026-10-31"])).state, "until", "a newer schedule's date");
  assert.deepEqual(policyDates(c, covers, [], TODAY).documentIds, ["d1"]);
});

test("renewalAfter picks the record that runs furthest", () => {
  const end = day("2026-10-31");
  const r = renewalAfter([pay({ payment_date: "2026-11-02" }), pay({ source_document_id: "r2", period_end: "2027-10-31" })], end);
  assert.equal(r?.source_document_id, "r2");
});

test("the list: proof of renewal first, then the soonest end, then no date", () => {
  const list = householdPolicyDates([
    contract("none", [doc("n")], { name: "Zeta Plan" }), contract("far", [doc("f")], { name: "Alpha Life" }),
    contract("due", [doc("d")], { name: "Beta PA" }), contract("soon", [doc("s")], { name: "Gamma Shield" })],
    [cover("f", "x", "01/01/2060"), cover("d", "x", "01/10/2026"), cover("s", "x", "01/12/2026")], [], TODAY);
  assert.deepEqual(list.map((p) => p.key), ["due", "soon", "far", "none"]);
  const withAnswer = householdPolicyDates([contract("due", [doc("d")], { name: "Beta PA" }), contract("none", [doc("n")], { name: "Zeta Plan" })], [cover("d", "x", "01/10/2026")], [], TODAY, new Set(["due|2026-10-01"]));
  assert.deepEqual(withAnswer.map((p) => [p.key, p.state]), [["none", "no_date"], ["due", "not_renewed"]]);
});

test("Home shows the list and never the words 'Ended' or 'expired' for a passed date", () => {
  const ui = readFileSync("components/home-policy-dates.tsx", "utf8");
  assert.match(ui, /Upload proof of renewal/);
  assert.doesNotMatch(ui, />\s*Ended\s*</); assert.doesNotMatch(ui, /expired/i);
  assert.match(readFileSync("app/page.tsx", "utf8"), /<HomePolicyDates memberId=/);
});

if (failures.length) { console.error(failures.join("\n")); console.error(`${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`policy-dates: ${passed} passed`);

/** A cover's detail page summary (DC 18 Nov): Home's card says only Covered; the detail page names each policy's amount
 * and gives a total only where one confirmed figure is the whole cover. Separate policies are never added up, a figure
 * with no stated currency is never shown, and an unconfirmed line shows no amount. Pure function plus the page source.
 *   node --import tsx scripts/coverage/cover-summary-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coverSummary, type SummaryCover } from "@/lib/coverage/cover-summary";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const base: SummaryCover = { status: "covered", amount: null, displayAmount: null, currency: null, count: 1, policyNames: [], sources: [], parts: null };

test("not covered: no summary at all", () => {
  assert.equal(coverSummary({ ...base, status: "not_covered", amount: 100000, currency: "SGD" }), null);
  assert.equal(coverSummary({ ...base, status: "on_file", amount: 100000, currency: "SGD" }), null);
});
test("one confirmed figure: it is the total, and the policy that pays it is named", () => {
  const s = coverSummary({ ...base, amount: 300000, currency: "SGD", policyNames: ["EARLY CRITICAL ILLNESS PLUS"], sources: ["Early Critical Illness Plus"] })!;
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0].name, "Early Critical Illness Plus");
  assert.match(s.total!, /300,000/);
  assert.match(s.total!, /S\$|SGD/);
  assert.equal(s.why, null);
});
test("one figure paid per period keeps its period", () => {
  const s = coverSummary({ ...base, amount: 30, currency: "SGD", policyNames: ["Hospital Cash"], parts: [{ name: "Hospital Cash", amount: 30, currency: "SGD", period: "day" }] })!;
  assert.match(s.total!, /30.* a day$/);
  const d = coverSummary({ ...base, displayAmount: "S$2,400 a month", policyNames: ["Disability Income"] })!;
  assert.equal(d.total, "S$2,400 a month");
});
test("a single qualified part keeps its qualifier on the amount (TE PR 535 F2)", () => {
  const s = coverSummary({ ...base, amount: 250000, currency: "SGD", policyNames: ["Early CI"], parts: [{ name: "Early CI", amount: 250000, currency: "SGD", accelerates: true }] })!;
  assert.match(s.total!, /250,000/);
  assert.match(s.lines[0].notes.join(" "), /instead of the death benefit/);
});
test("the page clears an earlier cover's summary before loading another person's or cover's (TE PR 535 F1)", () => {
  const page = readFileSync("app/coverage/page.tsx", "utf8");
  assert.match(page, /useEffect\(\(\)=>\{setSummary\(null\);/);
  assert.match(page, /activeMember\?\.id!==member\)\{setSummary\(null\);return;\}/);
  assert.match(page, /catch\(\(\)=>\{if\(live\)setSummary\(null\);\}\)/);
});
test("the dashboard sends a partly confirmed figure only for one policy's one line (TE PR 542 F1)", () => {
  const route = readFileSync("app/api/dashboard/route.ts", "utf8");
  assert.match(route, /partialAmount:oneConfirmed\(category,row\)\?/);
  assert.match(route, /partialDisplay:oneConfirmed\(category,row\)\?/);
  assert.match(route, /const oneConfirmed=[^\n]*partial\(category\)&&!!row&&homeCardShowsAmount\([^\n]*reviewRequired:conflictCategories\.has\(category\)/);
});
test("a figure with no stated currency (or a bare $) is never shown", () => {
  for (const currency of [null, "$", ""]) {
    const s = coverSummary({ ...base, amount: 120000, currency, policyNames: ["Term Life"] })!;
    assert.equal(s.total, null, String(currency));
    assert.equal(s.lines[0].amount, null);
    assert.match(s.lines[0].notes.join(" "), /no currency/);
  }
  const d = coverSummary({ ...base, displayAmount: "120,000 (currency unknown)", policyNames: ["Term Life"] })!;
  assert.equal(d.total, null);
  const p = coverSummary({ ...base, count: 2, parts: [{ name: "A Life", amount: 1000, currency: null }, { name: "B Life", amount: 2000, currency: "SGD" }] })!;
  assert.equal(p.lines[0].amount, null);
  assert.match(p.lines[1].amount!, /2,000/);
});
test("separate policies are never added up: each listed, no total, and the page says why", () => {
  const c: SummaryCover = { ...base, amount: 600000, currency: "SGD", count: 2, policyNames: ["Term Life", "Group Term Life"],
    parts: [{ name: "Term Life", amount: 400000, currency: "SGD" }, { name: "GROUP TERM LIFE(POLICY NO.123)", amount: 200000, currency: "SGD" }] };
  const s = coverSummary(c)!;
  assert.equal(s.total, null);
  assert.deepEqual(s.lines.map((l) => l.name), ["Term Life", "Group Term Life"]);
  assert.match(s.lines[0].amount!, /400,000/); assert.match(s.lines[1].amount!, /200,000/);
  assert.ok(!JSON.stringify(s).includes("600,000"), "the summed figure never appears");
  assert.match(s.why!, /No total is shown/);
});
test("a part paid instead of the death benefit, a conditional part and an unconfirmed part say so", () => {
  const s = coverSummary({ ...base, count: 3, parts: [{ name: "Term Life", amount: 400000, currency: "SGD" },
    { name: "Terminal Illness", amount: 400000, currency: "SGD", accelerates: true, conditional: true }, { name: "Mortgage Plan", amount: null, currency: null }] })!;
  assert.match(s.lines[1].notes.join(" "), /instead of the death benefit/);
  assert.match(s.lines[1].notes.join(" "), /conditions apply/);
  assert.equal(s.lines[2].amount, null); assert.match(s.lines[2].notes.join(" "), /not confirmed/);
});
test("a partly confirmed cover shows its confirmed amount as a line, never as a total (DC 18 Nov)", () => {
  // The dashboard keeps a partial cover's figure off `amount` (route.ts) and sends it as partialAmount.
  const s = coverSummary({ ...base, amount: null, partialAmount: 1000000, currency: "SGD", partial: true, policyNames: ["Term Life"] })!;
  assert.equal(s.total, null);
  assert.match(s.lines[0].amount!, /1,000,000/);
  assert.match(s.lines[0].notes.join(" "), /confirmed in your document/);
  assert.match(s.why!, /not confirmed[^]*no total[^]*may not be all/);
  assert.doesNotMatch(s.why!, /show no amount here/);
  const d = coverSummary({ ...base, partialDisplay: "S$30 a day", currency: null, partial: true, policyNames: ["Hospital Cash"] })!;
  assert.equal(d.total, null); assert.equal(d.lines[0].amount, "S$30 a day");
});
test("a partly confirmed cover lists each part's confirmed amount, unconfirmed parts show none, and nothing is added up", () => {
  const s = coverSummary({ ...base, partial: true, count: 3, parts: [{ name: "A Life", amount: 1000000, currency: "SGD" },
    { name: "B Life", amount: 2000, currency: "SGD" }, { name: "C Life", amount: null, currency: null }] })!;
  assert.equal(s.total, null);
  assert.match(s.lines[0].amount!, /1,000,000/); assert.match(s.lines[1].amount!, /2,000/);
  assert.equal(s.lines[2].amount, null); assert.match(s.lines[2].notes.join(" "), /not confirmed/);
  assert.ok(!JSON.stringify(s).includes("1,002,000"));
  assert.match(s.why!, /may not be all/);
});
test("a partly confirmed cover still never shows a figure without a stated currency", () => {
  const s = coverSummary({ ...base, partialAmount: 1000000, currency: "$", partial: true, policyNames: ["Term Life"] })!;
  assert.equal(s.lines[0].amount, null); assert.equal(s.total, null);
  const d = coverSummary({ ...base, partialDisplay: "30 (currency unknown) a day", partial: true, policyNames: ["Hospital Cash"] })!;
  assert.equal(d.lines[0].amount, null);
});
test("a partly confirmed cover with several policies never shows a single amount from the combined figure", () => {
  // partialAmount for a lump-sum cover can be the dashboard's sum across policies: shown only when one policy is the cover.
  const s = coverSummary({ ...base, partialAmount: 3000, currency: "SGD", partial: true, count: 2, policyNames: ["A", "B"] })!;
  assert.ok(!JSON.stringify(s).includes("3,000"));
});
test("a policy printing several amounts shows none of them on its line", () => {
  const s = coverSummary({ ...base, reviewRequired: true, count: 1, policyNames: ["Policy A"], parts: [{ name: "Policy A", amount: 100000, currency: "SGD" }] })!;
  assert.equal(s.total, null); assert.equal(s.lines[0].amount, null);
  assert.match(s.lines[0].notes.join(" "), /more than one amount/);
});
test("a policy with several printed amounts gives no total", () => {
  const s = coverSummary({ ...base, amount: 100000, currency: "SGD", reviewRequired: true, policyNames: ["Term Life"] })!;
  assert.equal(s.total, null); assert.match(s.why!, /more than one amount/);
});
test("covered with no figures: the policies are named, each with its document", () => {
  const s = coverSummary({ ...base, count: 2, sources: ["Business Single Trip", "Annual Travel"] })!;
  assert.deepEqual(s.lines.map((l) => [l.name, l.amount]), [["Business Single Trip", null], ["Annual Travel", null]]);
  assert.equal(s.total, null); assert.match(s.why!, /more than one policy/);
});
test("the detail page shows the summary only for a covered cover, and Home shows no figure", () => {
  const page = readFileSync("app/coverage/page.tsx", "utf8");
  assert.match(page, /coverSummary\(c\)/);
  assert.match(page, /covered&&summary\?\.lines\.length/);
  assert.match(page, /api\/dashboard\?familyMemberId=.*&poll=1/, "a quiet fetch: opening a cover never starts a document read");
  const home = readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(home, /coverage-amount|formatMoney/);
});

console.log(`cover-summary: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(`  FAIL ${f}`); process.exit(1); }

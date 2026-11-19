/**
 * DC, 16 Nov 2026 ("unreadable"): rows of a printed figures table are shown as a table, never as raw quoted strings.
 * Headings only where the page prints one per column; otherwise none is made up and the printed heading lines are shown
 * as printed. Any insurer's layout. Made-up documents; no model, network or database.
 *   node --import tsx scripts/simple-answer/printed-table-test.ts
 */
import assert from "node:assert/strict";
import { cellsOf, dropQuoteFragments, tablesFromPrintedRows } from "@/lib/simple-chat/printed-table";
import type { AnswerStatement } from "@/components/answer-cards";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";

let passed = 0; const failures: string[] = [];
function t(name: string, fn: () => void) { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); console.log(`not ok - ${name}`); } }

const doc = (policyId: string, name: string, text: string) => ({ policyId, name, insurer: "Example Life", productName: name, policyNumber: null, documentType: null, documentRole: null, effectiveDate: null, expiryDate: null,
  uploadedAt: null, uploadedFor: null, linkedPeople: [], supersededAt: null, processingStatus: "ready", pages: [{ page: 4, text }] }) as unknown as HouseholdDocument;
// Multi-line headings over single-space rows (as the screenshot's illustration).
const ILLUSTRATION = ["Table 1: Illustration of surrender values", "End of Policy\tTotal Premiums\tGuaranteed\tIllustrated at 4.25% p.a.\tIllustrated at 3.00% p.a.",
  "Year/Age\tPaid To-date\tSurrender Value\tNon-Guaranteed Bonus\tTotal\tNon-Guaranteed Bonus\tTotal",
  "5/33 23,954 10,000 300 10,300 200 10,200", "10/38 47,909 28,175 1,585 29,760 2,850 31,025", "20/48 47,909 49,808 14,071 63,879 32,127 81,935", "25/53 47,909 52,157 19,280 71,437 46,491 98,648"].join("\n");
// One heading line, one heading per column, tab-separated cells.
const SCHEDULE = ["Premium schedule", "Policy Year\tAnnual Premium\tDeath Benefit\tSurrender Value", "1\t1,200.00\t100,000\t0", "2\t1,200.00\t100,000\t350", "3\t1,200.00\t100,000\t1,100"].join("\n");
const H = { accountId: "a", members: [], documents: [doc("D1", "READYBUILDER 10", ILLUSTRATION), doc("D2", "Term Plan", SCHEDULE)] } as unknown as Household;
const label = (d: HouseholdDocument) => d.name;
const pt = (id: string, docName: string, row: string, extra: Partial<AnswerStatement> = {}): AnswerStatement => ({ id, kind: "fact", text: `${docName} prints: “${row}”`, fullText: `${docName} prints: “${row}”`, conditions: [],
  personName: "Charmaine", amount: null, source: { policyName: docName, page: 4, citationIds: [`c-${id}`] }, ...extra });

t("cells: single-space figure rows split at each figure; a leading label stays whole; words are not a row", () => {
  assert.deepEqual(cellsOf("10/38 47,909 28,175 1,585 29,760 2,850 31,025"), ["10/38", "47,909", "28,175", "1,585", "29,760", "2,850", "31,025"]);
  assert.deepEqual(cellsOf("Death benefit 100,000 120,000 140,000"), ["Death benefit", "100,000", "120,000", "140,000"]);
  assert.equal(cellsOf("The bonus is not guaranteed and may be 0"), null);
});
t("the screenshot's case: three quoted rows become one table, in page order, cells as printed; no heading is guessed over multi-line headings", () => {
  const st = [pt("s1", "READYBUILDER 10", "20/48 47,909 49,808 14,071 63,879 32,127 81,935"), pt("s0", "READYBUILDER 10", "10/38 47,909 28,175 1,585 29,760 2,850 31,025"),
    pt("s2", "READYBUILDER 10", "25/53 47,909 52,157 19,280 71,437 46,491 98,648"), { id: "u", kind: "uncertainty", text: "The bonus columns are not guaranteed.", fullText: "The bonus columns are not guaranteed.", conditions: [] } as AnswerStatement];
  const out = tablesFromPrintedRows(st, H, label);
  assert.equal(out.length, 2);
  const tb = out[0].table!;
  assert.deepEqual(tb.rows.map((r) => r[0]), ["10/38", "20/48", "25/53"]);
  assert.deepEqual(tb.rows[0], ["10/38", "47,909", "28,175", "1,585", "29,760", "2,850", "31,025"]);
  // The nearest heading line has one heading per column; the group line over it is shown as printed, not bound.
  assert.deepEqual(tb.headers, ["Year/Age", "Paid To-date", "Surrender Value", "Non-Guaranteed Bonus", "Total", "Non-Guaranteed Bonus", "Total"]);
  assert.deepEqual(tb.printedAbove, ["End of Policy Total Premiums Guaranteed Illustrated at 4.25% p.a. Illustrated at 3.00% p.a."]);
  assert.ok(!out[0].text.includes("prints: “"), out[0].text);
  assert.match(out[0].text, /READYBUILDER 10, page 4/);
  assert.deepEqual(out[0].source!.citationIds.sort(), ["c-s0", "c-s1", "c-s2"]);
  assert.equal(out[1].id, "u");
});
t("headings are the page's own, when one heading line has one heading per column", () => {
  const out = tablesFromPrintedRows([pt("a", "Term Plan", "2 1,200.00 100,000 350"), pt("b", "Term Plan", "3 1,200.00 100,000 1,100")], H, label);
  assert.deepEqual(out[0].table!.headers, ["Policy Year", "Annual Premium", "Death Benefit", "Surrender Value"]);
  assert.deepEqual(out[0].table!.rows, [["2", "1,200.00", "100,000", "350"], ["3", "1,200.00", "100,000", "1,100"]]);
});
t("when the nearest heading line does not have one heading per column, none is bound and the heading lines are shown as printed", () => {
  const H2 = { ...H, documents: [doc("D1", "READYBUILDER 10", ILLUSTRATION.replace("Year/Age\tPaid To-date\tSurrender Value\tNon-Guaranteed Bonus\tTotal\tNon-Guaranteed Bonus\tTotal", "Year/Age Paid To-date Surrender Value"))] } as unknown as Household;
  const unbound = tablesFromPrintedRows([pt("s0", "READYBUILDER 10", "10/38 47,909 28,175 1,585 29,760 2,850 31,025")], H2, label)[0].table!;
  assert.equal(unbound.headers, null);
  assert.ok(unbound.printedAbove.some((l) => l.includes("Year/Age Paid To-date Surrender Value")), JSON.stringify(unbound.printedAbove));
});
t("Critic #505 L: two tables of the same width on one page stay two tables, each under its own headings", () => {
  const TWO = ["Guaranteed values", "Year\tPremiums\tDeath\tSurrender", "1\t1,000\t50,000\t0", "2\t2,000\t50,000\t500",
    "Non-guaranteed values at 4.25%", "Year\tBonus\tDeath\tSurrender", "1\t10\t50,010\t5", "2\t25\t50,025\t530"].join("\n");
  const H3 = { accountId: "a", members: [], documents: [doc("D3", "Saver", TWO)] } as unknown as Household;
  const out = tablesFromPrintedRows([pt("a", "Saver", "2 2,000 50,000 500"), pt("b", "Saver", "2 25 50,025 530")], H3, label);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((o) => o.table!.headers), [["Year", "Premiums", "Death", "Surrender"], ["Year", "Bonus", "Death", "Surrender"]]);
  assert.deepEqual(out.map((o) => o.table!.rows), [[["2", "2,000", "50,000", "500"]], [["2", "25", "50,025", "530"]]]);
});
// TE1 #505 F1/F2/F5: blank cells, partial rows and two-line headings.
const BLANKS = ["Table 2", "End of policy year\tAge\tTotal premiums paid\tGuaranteed surrender value\tNon-guaranteed at 4.25%",
  "5\t40\t12,000\t3,150.50\t4,020", "20\t55\t48,000\t\t31,200"].join("\n");
const SPACED = ["Table 2", "End of policy year   Age   Total premiums paid   Guaranteed surrender value   Non-guaranteed at 4.25%",
  "5   40   12,000   3,150.50   4,020", "20   55   48,000      31,200"].join("\n");
const TWO = ["Table 2", "End of\t\tTotal premiums\tGuaranteed\tNon-guaranteed", "policy year\tAge\tpaid\tsurrender value\tat 4.25%", "5\t40\t12,000\t3,150.50\t4,020"].join("\n");
const H2 = { accountId: "a", members: [], documents: [doc("B1", "Saver Tabs", BLANKS), doc("B2", "Saver Spaced", SPACED), doc("B3", "Saver Two", TWO)] } as unknown as Household;
t("TE1 #505 F1: a tab-printed blank cell stays blank, so a figure never moves into the column before it", () => {
  const out = tablesFromPrintedRows([pt("a", "Saver Tabs", "5 40 12,000 3,150.50 4,020"), pt("b", "Saver Tabs", "20 55 48,000 31,200")], H2, label);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].table!.headers, ["End of policy year", "Age", "Total premiums paid", "Guaranteed surrender value", "Non-guaranteed at 4.25%"]);
  assert.deepEqual(out[0].table!.rows[1], ["20", "55", "48,000", "", "31,200"]);
});
t("TE1 #505 F1: a row narrower than its table (a blank printed as spaces) is not drawn in the grid; the full rows are", () => {
  const out = tablesFromPrintedRows([pt("a", "Saver Spaced", "5 40 12,000 3,150.50 4,020"), pt("b", "Saver Spaced", "20 55 48,000 31,200")], H2, label);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].table!.rows, [["5", "40", "12,000", "3,150.50", "4,020"]]);
  assert.equal(out[1].table, undefined);
  assert.match(out[1].text, /prints: “20 55 48,000 31,200”/);
});
t("TE1 #505 F2: part of a printed row is never drawn as a table row", () => {
  const out = tablesFromPrintedRows([pt("a", "Saver Tabs", "40 12,000 3,150.50"), pt("b", "Saver Tabs", "12,000 3,150.50 4,020")], H2, label);
  assert.ok(out.every((o) => !o.table));
});
t("TE1 #505 F5: a heading printed over two tab-separated lines is joined column by column", () => {
  const out = tablesFromPrintedRows([pt("a", "Saver Two", "5 40 12,000 3,150.50 4,020")], H2, label);
  assert.deepEqual(out[0].table!.headers, ["End of policy year", "Age", "Total premiums paid", "Guaranteed surrender value", "Non-guaranteed at 4.25%"]);
  assert.deepEqual(out[0].table!.printedAbove, ["Table 2"]);
});
t("left alone: an amount card, a point with conditions, a point with its own words, a row not on the cited page, a row of words", () => {
  const st: AnswerStatement[] = [
    pt("x1", "READYBUILDER 10", "10/38 47,909 28,175 1,585 29,760 2,850 31,025", { amount: { text: "S$1", currencyResolved: true, illustration: false } }),
    pt("x2", "READYBUILDER 10", "10/38 47,909 28,175 1,585 29,760 2,850 31,025", { conditions: ["Only if all premiums are paid."] }),
    { ...pt("x3", "READYBUILDER 10", "x"), text: "Guaranteed surrender value is nil in years 1 and 2." },
    pt("x4", "Term Plan", "99/99 1 2 3 4"), // not on the cited page
    pt("x5", "READYBUILDER 10", "Table 1: Illustration of surrender values"),
  ];
  assert.deepEqual(tablesFromPrintedRows(st, H, label).map((s) => s.table ?? null), [null, null, null, null, null]);
});

t("a leftover quote that is a fragment or a bare label goes; a whole sentence, a printed row, a card and a point with conditions stay (live f954eb2, ask 8)", () => {
  const answer = { statements: [
    pt("f1", "READYBUILDER 10", "the death benefit payable under this policy will be the higher of:"),
    pt("f2", "Certificate of Insurance", "As of 06/10/2022"),
    pt("k1", "Term Plan", "The policy ends on the death of the life assured or when the full sum assured is paid."),
    pt("k2", "READYBUILDER 10", "5/33 23,954 10,000 300 10,300 200"),
    pt("k3", "Term Plan", "As of 06/10/2022", { conditions: ["Only while the policy is in force"] }),
    pt("k4", "Term Plan", "As of 06/10/2022", { amount: { text: "S$100,000", currencyResolved: true, illustration: false } as never }),
    { id: "k5", kind: "fact", text: "The policy covers death.", fullText: "", conditions: [] } as AnswerStatement,
    // A short whole sentence is an exclusion worth keeping (Critic #546 LOW-3); a short cut-off one is not.
    pt("k6", "Term Plan", "Cosmetic surgery is not covered."),
    pt("k7", "Term Plan", "Pre-existing conditions are excluded."),
    pt("f3", "Term Plan", "and is not covered."),
    pt("f4", "Term Plan", "Pre-existing conditions are excluded unless"),
  ] };
  const removed = dropQuoteFragments(answer);
  assert.deepEqual(answer.statements.map((s) => s.id), ["k1", "k2", "k3", "k4", "k5", "k6", "k7"]);
  assert.equal(removed.length, 4);
});

console.log(`printed table: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);

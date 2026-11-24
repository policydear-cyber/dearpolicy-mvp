/**
 * What the page check records about a held line: how many were held and whether each looked like an amount row or like
 * text around the table (a year or small number in a note). The kind is a label only: it never changes what is held.
 * Made-up insurer; every case has a control that can fail. Pure: no database, no model, no network.
 */
import assert from "node:assert/strict";
import { checkLines } from "@/lib/documents/layout-check";

let cases = 0;
const failed: string[] = [];
function t(name: string, fn: () => void) {
  try { fn(); cases++; console.log("  ok  " + name); }
  catch (error) { failed.push(name); console.error("  FAIL " + name + ": " + (error instanceof Error ? error.message.split("\n")[0] : String(error))); }
}
const body = "Benefit Details:\nBasic Plan\tStatus\tSum Assured\nHarbour Shield Plus\tIn Force\t100,000.00\nAccident Assist\tIn Force\t100,000.00\t15.98";
const image = body.replace(/\t/g, " ");

t("a benefit row the image does not print is held and counted as an amount row", () => {
  const c = checkLines(body + "\nMedical Reimbursement\tIn Force\t2,000.00", image, 3);
  assert.ok(c.held >= 1, "held");
  assert.match(c.log ?? "", /held 1 \(amount rows 1, other lines 0\)/);
});
t("a footnote with a year the image does not print is held and counted as another line", () => {
  const c = checkLines(body + "\nA policy with cover start date before the year 2012 is now known as Harbour Plus.", image, 3);
  assert.ok(c.held >= 1, "held, the kind never loosens it");
  assert.match(c.log ?? "", /held 1 \(amount rows 0, other lines 1\)/);
});
t("a real benefit written like a footnote stays held, never accepted", () => {
  for (const line of ["Hospital cash benefit is paid for up to 30 days in each policy year.", "Waiting period for this cover is 90 days from the start date."]) {
    const c = checkLines(body + "\n" + line, image, 3);
    assert.ok(c.held >= 1, line);
    assert.equal(c.text?.includes("30") || c.text?.includes("90"), false, "its figure is not used");
  }
});
t("a benefit row written as running text with an amount is counted as an amount row", () => {
  const c = checkLines(body + "\nThe accidental death benefit is S$50,000.00 for each insured person.", image, 3);
  assert.ok(c.held >= 1);
  assert.match(c.log ?? "", /amount rows 1/);
});
t("control: when everything is confirmed no held count is written", () => {
  const c = checkLines(body, image, 3);
  assert.equal(c.held, 0);
  assert.doesNotMatch(c.log ?? "", /held \d/);
});
console.log(`\n${cases} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);

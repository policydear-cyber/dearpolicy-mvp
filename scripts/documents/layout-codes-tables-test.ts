/** Page cross-check, two general rules (made-up documents, several markets; pure logic, no database, network or model):
 *  1. A printed code joined by underscores ("CC_1234_5678_9012") is a code word, never figures: an image reading that
 *     leaves such small print out no longer makes the page "read in part".
 *  2. Rows of figures only, right under their table's column header (a premium-rate table), are confirmed when the image
 *     reading prints the same rows line for line. Values printed apart from their labels (a scrambled page), rows wider
 *     than the header, a run the image prints differently or out of order, are still refused.
 *   npm run -s documents:layout-codes-tables-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { checkLines, NOT_CHECKED } = await import("@/lib/documents/layout-check");
  const confirmed = (text: string, image: string, page = 4) => {
    const r = checkLines(text, image, page);
    assert.equal(r.agree, true, `expected agreement, got: ${r.why} | ${r.log}\n${r.text}`);
    assert.ok(!(r.text ?? text).includes(NOT_CHECKED), `nothing masked:\n${r.text}`);
    assert.equal(r.text, text, "the stored text is the page as read");
  };
  const refused = (text: string, image: string, page = 4) => {
    const r = checkLines(text, image, page);
    assert.equal(r.agree, false, `expected refusal:\n${r.text}`);
    return r;
  };

  // ---- 1. Printed codes ----
  const body = "Policy Schedule\nSum Assured\t250,000.00\nAnnual Premium\t1,204.50";
  await test("K1 a print-run code in the footer the image leaves out", () => confirmed(
    `${body}\nSigned for the Company\nCC_2041_7716_0093\nExample Assurance Ltd, 1 Sample Road`,
    `${body}\nSigned for the Company\nExample Assurance Ltd, 1 Sample Road`));
  await test("K2 a form code mid-page, both readings print it", () => confirmed(
    `Contract Data\nFORM_B_2024 rev 3\nSum Covered\tRM 150,000.00`, `Contract Data\nFORM_B_2024 rev 3\nSum Covered\tRM 150,000.00`));
  await test("K3 a code the image reads with other digits still agrees (it is a code, not an amount)", () => confirmed(
    `${body}\nREF_88_12`, `${body}\nREF_88_17`));
  await test("K4 an amount written plainly is still compared: a missing amount is refused", () => {
    const r = refused(`${body}\nRider\t35,000.00\nCC_1_2`, `${body}\nCC_1_2`);
    assert.ok(r.text === null || r.text.split("\n").find((l) => l.startsWith("Rider"))!.includes(NOT_CHECKED));
  });
  await test("K5 underscores without digits are left alone (a blank to fill)", () => confirmed(
    "Declaration\nSigned ________ Date ________\nSum Insured\t£80,000.00", "Declaration\nSigned ________ Date ________\nSum Insured\t£80,000.00"));

  // ---- 2. Rate tables of figures only ----
  const header = "Coverage\tMonthly premium\tCoverage\tMonthly premium\namount (S$)\trates (S$)\tamount (S$)\trates (S$)";
  const rows = ["50,000\t11.40\t300,000\t58.20", "100,000\t21.10\t350,000\t66.90", "150,000\t30.80\t400,000\t75.60", "200,000\t40.50"];
  const page = (rs: string[]) => `Premium rates\nThis plan is not Medisave approved.\n${header}\n${rs.join("\n")}\nNote: rates exclude GST.\nPage 8 of 36`;
  await test("T1 S$ rate table: rows of figures under their two-line header, read alike", () => confirmed(page(rows),
    page(rows.map((r) => r.replace(/\t/g, " ")))));
  await test("T2 MYR table with spaces in the image reading", () => confirmed(
    "Kadar Caruman\nUmur\tLelaki\tPerempuan\n30\t120.50\t110.20\n31\t125.10\t114.70",
    "Kadar Caruman\nUmur Lelaki Perempuan\n30 120.50 110.20\n31 125.10 114.70"));
  await test("T3 a row the image prints with another figure: refused", () => { refused(page(rows), page([rows[0], "100,000\t21.10\t350,000\t69.90", rows[2], rows[3]])); });
  await test("T4 rows in another order in the image: refused", () => { refused(page(rows), page([rows[1], rows[0], rows[2], rows[3]])); });
  await test("T5 a row wider than its header: refused", () => {
    refused("Rates\nAge\tPremium\n30\t120.50\t9.99\n31\t125.10\t9.99", "Rates\nAge Premium\n30 120.50 9.99\n31 125.10 9.99");
  });
  await test("T6 scrambled page: labels above, lone values below (no header with cells) stay refused", () => {
    refused("Benefits\nDeath Benefit\nTotal Disability\nCritical Illness\n200,000.00\n200,000.00\n100,000.00",
      "Benefits\nDeath Benefit\nTotal Disability\nCritical Illness\n200,000.00\n200,000.00\n100,000.00");
  });
  await test("T7 the image prints a label beside the figures: refused (it is not the same row)", () => {
    refused("Rates\nSum\tPremium\n50,000\t11.40\n100,000\t21.10", "Rates\nSum Premium\nPlan A 50,000 11.40\nPlan B 100,000 21.10");
  });
  await test("T8 two identical rows each need their own image line", () => {
    refused("Rates\nSum\tPremium\n50,000\t11.40\n50,000\t11.40", "Rates\nSum Premium\n50,000 11.40");
  });

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`layout-codes-tables: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

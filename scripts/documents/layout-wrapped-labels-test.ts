/** Page cross-check: a schedule row whose label the text layer wraps or splits onto a line of its own (words only, right
 * above or below the row) is confirmed when the image reading prints the same row on one line, with the same words and
 * figures in the same order. Every figure must still match; a neighbour with figures, a wrong word, a split between two
 * figures, or a second row borrowing the same words is still refused and masked. Made-up documents in several markets.
 * Pure logic. No database, no network, no model.
 *   npm run -s documents:layout-wrapped-labels-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { checkLines, NOT_CHECKED } = await import("@/lib/documents/layout-check");
  const confirmed = (text: string, image: string, page = 2) => {
    const r = checkLines(text, image, page);
    assert.equal(r.agree, true, `expected agreement, got: ${r.why}\n${r.text}`);
    assert.ok(!(r.text ?? text).includes(NOT_CHECKED), `nothing masked:\n${r.text}`);
  };
  // Refused: the page does not agree, and the row's line loses its figures (masked, or the whole page left unchecked).
  const refused = (text: string, image: string, row: string, page = 2) => {
    const r = checkLines(text, image, page);
    assert.equal(r.agree, false, "expected the row to be refused");
    const line = r.text?.split("\n").find((l) => l.startsWith(row));
    assert.ok(r.text === null || (line !== undefined && line.includes(NOT_CHECKED) && !/\d/.test(line.replace(NOT_CHECKED, ""))), `"${row}" masked:\n${r.text}`);
  };

  // Positive: the label's second half wraps below the row (Singapore schedule, five columns).
  await test("W1 S$ schedule: 'Comprehensive Critical' + 'Illness Benefit' on the next line", () => confirmed(
    "Schedule of Benefits\nBenefit\tSum Assured\tPremium\tExpiry\nComprehensive Critical\t300,000.00\t269.05\t19/10/2036\nIllness Benefit\nTotal Premium\t269.05",
    "Schedule of Benefits\nBenefit\tSum Assured\tPremium\tExpiry\nComprehensive Critical Illness Benefit\t300,000.00\t269.05\t19/10/2036\nTotal Premium\t269.05"));
  // Positive: the currency word printed on its own line above the row (any market).
  await test("W2 premium row with ': Malaysian Ringgit' split onto the line above", () => confirmed(
    "Contract Details\n: Malaysian Ringgit\nMonthly Contribution\t: 182.40\tCurrency\nSum Covered\t: 250,000.00",
    "Contract Details\nMonthly Contribution\t: 182.40\t\tCurrency\t: Malaysian Ringgit\nSum Covered\t: 250,000.00"));
  // Positive: a UK schedule whose label wraps between words, before the figures (£ marks are left out of the compare).
  await test("W3 £ schedule: 'Accidental Death and' + 'Dismemberment' below", () => confirmed(
    "Your Cover\nAccidental Death and\t£150,000\nDismemberment\nHospital Cash per day\t£75",
    "Your Cover\nAccidental Death and Dismemberment\t£150,000\nHospital Cash per day\t£75"));
  // Positive: the first half of the label is the line above.
  await test("W4 RM schedule: 'Hospital and Surgical' above 'Benefit RM 500,000'", () => confirmed(
    "Benefits\nHospital and Surgical\nBenefit\tRM 500,000\nRoom and Board per day\tRM 300",
    "Benefits\nHospital and Surgical Benefit\tRM 500,000\nRoom and Board per day\tRM 300"));

  // Negative: a different figure on the image line still fails.
  await test("N1 wrapped label, image prints a different sum: refused", () => refused(
    "Schedule\nComprehensive Critical\t300,000.00\t269.05\nIllness Benefit",
    "Schedule\nComprehensive Critical Illness Benefit\t350,000.00\t269.05", "Comprehensive Critical"));
  // Negative: the neighbour line carries a figure, so it is a row of its own and is never joined.
  await test("N2 neighbour with a figure is not borrowed", () => refused(
    "Schedule\nComprehensive Critical\t300,000.00\nIllness Benefit 2\nTotal\t300,000.00",
    "Schedule\nComprehensive Critical Illness Benefit\t300,000.00\nTotal\t300,000.00", "Comprehensive Critical"));
  // Negative: words inserted between two figures are a different pairing.
  await test("N3 words only between two figures: refused", () => refused(
    "Schedule\nDeath\t100,000.00\t50,000.00\nAccidental",
    "Schedule\nDeath\t100,000.00 Accidental 50,000.00", "Death"));
  // Negative: the image prints other words on the line (the wrapped words are not the label's).
  await test("N4 the wrapped words differ from the image's label: refused", () => refused(
    "Schedule\nComprehensive Critical\t300,000.00\nIllness Rider",
    "Schedule\nComprehensive Critical Illness Benefit\t300,000.00", "Comprehensive Critical"));
  // Negative: a words line lends its words once, so two rows cannot both borrow it.
  await test("N5 one words line lent to one row only", () => {
    const r = checkLines(
      "Schedule\nCritical\t100,000.00\nIllness Benefit\nCritical\t100,000.00",
      "Schedule\nCritical Illness Benefit\t100,000.00\nCritical Illness Benefit\t100,000.00", 2);
    assert.equal(r.agree, false, "the second row must not borrow the same words");
  });
  // Negative: a words line two lines away is not the row's wrap.
  await test("N6 a words line that is not next to the row is not joined", () => refused(
    "Schedule\nComprehensive Critical\t300,000.00\nPremium Term\t10\nIllness Benefit",
    "Schedule\nComprehensive Critical Illness Benefit\t300,000.00\nPremium Term\t10", "Comprehensive Critical"));
  // Negative: a row under another shared heading in the image is not this row.
  await test("N7 same words under a different shared heading: refused", () => refused(
    "Life Assured A\nComprehensive Critical\t300,000.00\nIllness Benefit\nLife Assured B\nHospital Cash\t100",
    "Life Assured A\nHospital Cash\t100\nLife Assured B\nComprehensive Critical Illness Benefit\t300,000.00", "Comprehensive Critical"));
  // Control: rows that already match line for line are unchanged.
  await test("C1 one-line rows still agree", () => confirmed(
    "Schedule\nDeath Benefit\t200,000.00\nPremium\t120.00", "Schedule\nDeath Benefit\t200,000.00\nPremium\t120.00"));

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`layout-wrapped-labels: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

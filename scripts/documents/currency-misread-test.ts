/** A currency prefix's letter printed as a digit on a transcribed page ("S$20,000" read as "$520,000") is marked as not
 * checked, never repaired, and only where the same page prints that prefix elsewhere. The positive lines are Baidu
 * PaddleOCR's own reading of a made-up S$ travel schedule (50-document proof run, 14 Nov 2026); the controls are genuine
 * bare-dollar amounts from a made-up "$" schedule, and pages printing no prefixed currency.
 * Pure logic. No database, no network, no model.
 *   npm run -s documents:currency-misread-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => unknown) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { maskPrefixLetterMisreads } = await import("@/lib/documents/currency-misread");
  const { settleOcrFigures } = await import("@/lib/documents/messy");
  const { NOT_CHECKED } = await import("@/lib/documents/layout-check");
  const M = NOT_CHECKED;
  // A sentence on the same page that prints the prefix as it is (from the same reading).
  const sd = "The Company will reduce reasonable and customary charges for the Insured Person, up to S$28,000 in total.";

  // Positive: Baidu's reading of the schedule's table rows; the page prints "S$" elsewhere.
  test("P1 S$20,000 read as $520,000 and S$2,200 as $52,200", () => {
    const r = maskPrefixLetterMisreads(`${sd}\nRental vehicle excess\t$52,200\t$52,000,000\t80%\t$53,300\nLoss of travel documents\tNot covered\t$520,000\tNot covered`);
    assert.deepEqual(r.masked, ["$52,200", "$52,000,000", "$53,300", "$520,000"]);
    assert.equal(r.text, `${sd}\nRental vehicle excess\t${M}\t${M}\t80%\t${M}\nLoss of travel documents\tNot covered\t${M}\tNot covered`);
  });
  test("P2 short and malformed figures ($5500, $5768,823) and cents", () => {
    const r = maskPrefixLetterMisreads(`${sd}\nPermanent total disablement\t$5500\t$550,000\nEmergency medical evacuation\t$5768,823\t30%\nOverseas medical expenses\t$51,835,862\t$5660,000.75`);
    assert.deepEqual(r.masked, ["$5500", "$550,000", "$5768,823", "$51,835,862", "$5660,000.75"]);
    assert.ok(!/\$5/.test(r.text), "no $5 amount stays");
  });
  test("P3 a rate in running text, and a space after the sign", () => {
    const r = maskPrefixLetterMisreads(`${sd}\nBaggage delay (per 6 hours)\t$5990,000\t$5900 per day\nThe Insurer will pay up to $ 57,400 in total.`);
    assert.deepEqual(r.masked, ["$5990,000", "$5900", "$ 57,400"]);
    assert.ok(r.text.includes(`${M} per day`) && r.text.includes(`up to ${M} in total.`));
  });
  test("P4 any prefix carrying the letter (US$, SG$)", () => {
    assert.deepEqual(maskPrefixLetterMisreads("Death benefit US$100,000\nHospital cash\t$5250 per day").masked, ["$5250"]);
    assert.deepEqual(maskPrefixLetterMisreads("Death benefit SG$100,000\nHospital cash\t$5250 per day").masked, ["$5250"]);
  });

  // Negative: genuine bare-dollar schedule (no prefix on the page): every "$5..." is its own figure.
  test("N1 a bare-dollar page keeps its $5xx amounts", () => {
    const page = "Personal belongings in vehicle Up to $572,584.25 Up to $567,127.00 $531,331\nPolicy excess (young driver) $524.75 $860.25 $413,250.00\nexceed the Overall Limit, up to $520 in total.";
    const r = maskPrefixLetterMisreads(page);
    assert.deepEqual(r.masked, []); assert.equal(r.text, page);
  });
  // Negative: on an S$ page, an amount whose remaining digits are no amount cannot be a misread.
  test("N2 $500,000, $5,000, $50 and $5 stay on an S$ page", () => {
    const page = `${sd}\nup to $500,000 in total\nexcess $5,000\nfee $50 and $5 per claim\nrefund $5.50`;
    assert.deepEqual(maskPrefixLetterMisreads(page).masked, []);
  });
  test("N3 a prefix intact stays (S$520,000, US$520,000)", () => {
    const page = `${sd}\nLoss of travel documents\tS$520,000\tUS$520,000`;
    assert.equal(maskPrefixLetterMisreads(page).text, page);
  });
  test("N4 a prefix without the letter (HK$, NZ$, A$) and ISO codes (SGD) give no reason", () => {
    for (const lead of ["HK$28,000", "NZ$28,000", "A$28,000", "SGD 28,000", "S 28,000", "€28,000"])
      assert.deepEqual(maskPrefixLetterMisreads(`Overall limit ${lead}\nBaggage\t$520,000`).masked, [], lead);
  });
  test("N5 a dollar sign inside a word or after a letter is not a bare amount", () => {
    assert.deepEqual(maskPrefixLetterMisreads(`${sd}\nCode AB$520\tref X$5200\t$$520,000`).masked, []);
  });
  test("N6 the page's own prefix figure is never counted as a reason by itself", () => {
    assert.deepEqual(maskPrefixLetterMisreads("Baggage\t$520,000\tDelay\t$52,200").masked, []);
  });

  // In the reading: transcribed pages only, with a note; a page with a text layer is never touched.
  test("I1 settleOcrFigures marks a transcribed page and says so", () => {
    const ocr = { pageNumber: 4, text: `${sd}\nLoss of travel documents\tNot covered\t$520,000`, imageCount: 1, extractionMethod: "ocr" as const };
    const native = { pageNumber: 5, text: `${sd}\nLoss of travel documents\tNot covered\t$520,000`, imageCount: 0, extractionMethod: "native" as const };
    const out = settleOcrFigures([ocr, native]);
    assert.equal(out.pages[0].text, `${sd}\nLoss of travel documents\tNot covered\t${M}`);
    assert.equal(out.pages[1].text, native.text, "a page with a text layer is left to the page check");
    assert.equal(out.notes.length, 1);
    assert.match(out.notes[0], /^On page 4 the scan shows an amount \(“\$520,000”\) whose first digit may be the currency’s letter misread/);
  });
  test("I2 nothing to mark: no note, page unchanged", () => {
    const ocr = { pageNumber: 2, text: "Personal belongings in vehicle Up to $572,584.25", imageCount: 1, extractionMethod: "ocr" as const };
    const out = settleOcrFigures([ocr]);
    assert.equal(out.pages[0], ocr); assert.deepEqual(out.notes, []);
  });

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`currency-misread: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

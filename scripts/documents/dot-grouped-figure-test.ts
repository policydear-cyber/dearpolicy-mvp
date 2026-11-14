/** A thousands comma a scan printed as a dot ("S$935,542" read as "S$935.542") in a document whose figures are grouped
 * by commas is marked as not checked, never repaired; the figure check never reads such a figure as a smaller amount.
 * The style is the document's own: a dot-grouped document ("EUR 1.372.820,50") is left alone. The positive lines are
 * Baidu PaddleOCR's own readings of made-up schedules (50-document proof run, 14 Nov 2026).
 * Pure logic. No database, no network, no model.
 *   npm run -s documents:dot-grouped-figure-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => unknown) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { maskDotGroupedFigures, thousandsStyle } = await import("@/lib/documents/currency-misread");
  const { settleOcrFigures } = await import("@/lib/documents/messy");
  const { moneyPrinted } = await import("@/lib/documents/fact-check");
  const { NOT_CHECKED: M } = await import("@/lib/documents/layout-check");
  // The rest of a comma-grouped schedule (as the same reading prints it).
  const commaDoc = "Overseas medical expenses\tS$2,000,000\nBaggage\tS$3,000\nTravel delay\tS$1,500.50\nPersonal liability\tS$1,000,000";
  // A dot-grouped schedule: thousands by dots, decimals by commas.
  const dotDoc = "Krankheitskosten\tEUR 2.000.000\nGepäck\tEUR 3.000,00\nReiseverspätung\tEUR 1.500,50\nHaftpflicht\tEUR 1.000.000";

  test("S1 the document's style comes from its own figures", () => {
    assert.equal(thousandsStyle(commaDoc), "comma");
    assert.equal(thousandsStyle(dotDoc), "dot");
    assert.equal(thousandsStyle("Benefit S$500 and S$1,000"), "unknown", "one comma figure is too little to tell");
    assert.equal(thousandsStyle(`${commaDoc}\nup to S$935.542 in total\nup to S$1.372.820 in total`), "comma", "the misreads do not outvote the document");
  });

  // Positive: Baidu's own readings (S$, SGD, EUR, GBP, £), in a comma-grouped document.
  test("P1 one dot group or more after a currency mark is marked", () => {
    const page = "force at the date of the event, up to S$935.542 in total\nr has paid the premium on time. up to S$1.372.820 in total.\nnot exceed the Overall Limit, up to SGD 1.989.745 in total.\nIntensive care unit (per day)\tEUR 651.632\nup to GBP 48.000 in total\nrecovered from another insurer, up to £72.000 in total.";
    const r = maskDotGroupedFigures(page, "comma");
    assert.deepEqual(r.masked, ["S$935.542", "S$1.372.820", "SGD 1.989.745", "EUR 651.632", "GBP 48.000", "£72.000"]);
    assert.equal(r.text, `force at the date of the event, up to ${M} in total\nr has paid the premium on time. up to ${M} in total.\nnot exceed the Overall Limit, up to ${M} in total.\nIntensive care unit (per day)\t${M}\nup to ${M} in total\nrecovered from another insurer, up to ${M} in total.`);
  });
  test("P2 two dot groups with no mark are marked (never a decimal)", () => {
    const r = maskDotGroupedFigures("Personal liability\t1.372.820\tNot covered", "comma");
    assert.deepEqual(r.masked, ["1.372.820"]); assert.equal(r.text, `Personal liability\t${M}\tNot covered`);
  });

  // Negative controls.
  test("N1 ordinary amounts and cents stay (S$935.54, S$935,542, S$1,372,820.50)", () => {
    const page = "up to S$935.54 in total\nup to S$935,542 in total\nup to S$1,372,820.50.";
    assert.deepEqual(maskDotGroupedFigures(page, "comma").masked, []);
  });
  test("N2 decimals that are not money stay (0.125%, a factor of 1.375, 2.500 per cent, version 1.250)", () => {
    const page = "Interest of 0.125% a year\nmultiplied by a factor of 1.375\nloading of 2.500 per cent\nTable version 1.250";
    assert.deepEqual(maskDotGroupedFigures(page, "comma").masked, []);
  });
  test("N3 a dot-grouped document is left alone", () => {
    assert.deepEqual(maskDotGroupedFigures(`${dotDoc}\nbis zu EUR 1.372.820 insgesamt`, thousandsStyle(dotDoc)).masked, []);
  });
  test("N4 a document whose style is unknown is left alone", () => {
    assert.deepEqual(maskDotGroupedFigures("up to S$935.542 in total", thousandsStyle("up to S$935.542 in total")).masked, []);
  });
  test("N5 a word in capitals is not a currency code (AGE 1.375, NO. 1.250)", () => {
    assert.deepEqual(maskDotGroupedFigures("AGE 1.375 rate\nREF 1.250", "comma").masked, []);
  });
  test("N6 dates and references with dots are not figures (12.03.2026, 1.2.3)", () => {
    assert.deepEqual(maskDotGroupedFigures("Effective 12.03.2026, clause 1.2.3", "comma").masked, []);
  });

  // The figure check never reads a longer figure as a shorter amount.
  test("F1 S$935.542 is not printed S$935.54 or S$935.542; S$1.372.820 is not S$1.37", () => {
    assert.equal(moneyPrinted("up to S$935.542 in total", 935.54), false);
    assert.equal(moneyPrinted("up to S$935.542 in total", 935.542), false);
    assert.equal(moneyPrinted("up to S$1.372.820 in total", 1.37), false);
    assert.equal(moneyPrinted("up to S$1.372.820 in total", 1.372), false);
  });
  test("F2 ordinary figures still found (S$935.54, S$935.54. at a sentence end, S$935,542)", () => {
    assert.equal(moneyPrinted("up to S$935.54 in total", 935.54), true);
    assert.equal(moneyPrinted("up to S$935.54.", 935.54), true);
    assert.equal(moneyPrinted("up to S$935,542, and more", 935542), true);
    assert.equal(moneyPrinted("Premium S$120 per year", 120), true);
  });

  // In the reading: transcribed pages only, the style taken from the whole document, with a note.
  test("I1 settleOcrFigures marks a transcribed page of a comma-grouped document", () => {
    const native = { pageNumber: 1, text: commaDoc, imageCount: 0, extractionMethod: "native" as const };
    const ocr = { pageNumber: 2, text: "up to S$935.542 in total", imageCount: 1, extractionMethod: "ocr" as const };
    const out = settleOcrFigures([native, ocr]);
    assert.equal(out.pages[0], native);
    assert.equal(out.pages[1].text, `up to ${M} in total`);
    assert.equal(out.notes.length, 1);
    assert.match(out.notes[0], /^On page 2 the scan shows an amount \(“S\$935\.542”\) with a dot where this document puts a comma between thousands/);
  });
  test("I2 a dot-grouped document's transcribed page is unchanged, no note", () => {
    const ocr = { pageNumber: 1, text: `${dotDoc}\nbis zu EUR 1.372.820 insgesamt`, imageCount: 1, extractionMethod: "ocr" as const };
    const out = settleOcrFigures([ocr]);
    assert.equal(out.pages[0], ocr); assert.deepEqual(out.notes, []);
  });

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`dot-grouped-figure: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

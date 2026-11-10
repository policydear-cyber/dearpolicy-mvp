/** Pages stored turned (10 Nov). A landscape statement is often kept as a portrait page with /Rotate 90 (or 270), its
 * text drawn turned so the page shows upright. The text layer was read in the stored page's coordinates, so each table
 * column came out as one line ("StatusIn ForceIn Force", "Sum Assured100,000.002,000.00"), and the page-image check could
 * never confirm a figure: the household's schedules were "read in part" since October. Positions are now taken on the
 * page as it is shown. Made-up schedule, drawn on pages turned 0, 90, 180 and 270 degrees: every one reads the same rows.
 * A page whose text runs plainly left to right in the stored coordinates and that a viewer only turned (saved with
 * /Rotate) keeps the stored coordinates, as before: it reads the same rows too (Critic #401).
 * Pure logic. No database, no network, no model.
 *   npm run -s documents:turned-page-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const ROWS = [
  ["Component", "Status", "Sum Assured", "Premium"],
  ["Accident Assist", "In Force", "100,000.00", "15.98"],
  ["Medical Reimbursement", "In Force", "2,000.00", "0.00"],
  ["Hospital Cash", "Lapsed", "500.00", "3.10"],
];
const COLUMNS = [40, 175, 230, 305];

async function main() {
  const { PDFDocument, StandardFonts, degrees } = await import("pdf-lib");
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const { looksScrambled } = await import("@/lib/documents/layout-check");
  /** The schedule as shown, drawn on a page stored turned by `turn` degrees. */
  const turned = async (turn: 0 | 90 | 180 | 270) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(turn));
    // The shown page is 595 wide (842 for 90 and 270); rows go down from the top.
    const shownHeight = turn === 90 || turn === 270 ? 595 : 842;
    ROWS.forEach((row, r) => row.forEach((text, c) => {
      const x = COLUMNS[c], y = shownHeight - 100 - r * 20;
      const at = turn === 0 ? { x, y } : turn === 90 ? { x: 595 - y, y: x } : turn === 180 ? { x: 595 - x, y: 842 - y } : { x: y, y: 842 - x };
      page.drawText(text, { ...at, size: 10, font, rotate: degrees(turn) });
    }));
    return (await extractPdfPages(await doc.save()))[0];
  };
  const expected = ROWS.map((r) => r.join("\t")).join("\n");
  /** The schedule drawn plainly (left to right in the stored page), on a page a viewer then turned by `turn` degrees. */
  const viewerTurned = async (turn: 90 | 180 | 270) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(turn));
    ROWS.forEach((row, r) => row.forEach((text, c) => page.drawText(text, { x: COLUMNS[c], y: 842 - 100 - r * 20, size: 10, font })));
    return (await extractPdfPages(await doc.save()))[0];
  };

  for (const turn of [0, 90, 180, 270] as const) {
    await test(`a page stored turned ${turn} degrees reads row by row, each cell in its column`, async () => {
      const page = await turned(turn);
      assert.equal(page.text, expected);
      assert.ok(!looksScrambled(page.text), "nothing to check against the image");
      assert.deepEqual(page.lines?.[1].cells, ROWS[1]);
    });
  }
  for (const turn of [90, 180, 270] as const) {
    await test(`plain text on a page a viewer turned ${turn} degrees still reads row by row, as on main`, async () => {
      const page = await viewerTurned(turn);
      assert.equal(page.text, expected);
      assert.ok(!looksScrambled(page.text));
      assert.deepEqual(page.lines?.[1].cells, ROWS[1]);
    });
  }
  await test("a footer added plainly to a page turned 90 degrees is its own block after the table, every row kept", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(90));
    ROWS.forEach((row, r) => row.forEach((text, c) => {
      const y = 595 - 100 - r * 20;
      page.drawText(text, { x: 595 - y, y: COLUMNS[c], size: 10, font, rotate: degrees(90) });
    }));
    page.drawText("Annual Premium", { x: 60, y: 60, size: 10, font }); page.drawText("1,234.00", { x: 300, y: 60, size: 10, font });
    page.drawText("Next Due", { x: 60, y: 40, size: 10, font }); page.drawText("617.00", { x: 300, y: 40, size: 10, font });
    const got = (await extractPdfPages(await doc.save()))[0];
    assert.equal(got.text, `${expected}\nAnnual Premium\t1,234.00\nNext Due\t617.00`);
    assert.ok(!looksScrambled(got.text));
  });
  await test("the cells' left edges are the shown page's, the same whatever the turn", async () => {
    const upright = await turned(0);
    for (const turn of [90, 180, 270] as const) {
      const page = await turned(turn);
      assert.equal(page.lines!.length, upright.lines!.length);
      page.lines!.forEach((line, i) => {
        assert.deepEqual(line.rawCells ?? line.cells, upright.lines![i].rawCells ?? upright.lines![i].cells);
        (line.xs ?? []).forEach((x, c) => assert.ok(Math.abs(x - upright.lines![i].xs![c]) < 0.5, `turn ${turn} row ${i} cell ${c}: ${x}`));
      });
    }
  });

  console.log(`turned-page: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

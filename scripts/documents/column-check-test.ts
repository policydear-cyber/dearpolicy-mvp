/** Page cross-check: a text layer that gives each table column as one run (every cell of the column glued together, top
 * to bottom), while the image reading gives the rows. Line by line the two can never agree, so such pages were held back
 * whole ("read in part", 9 Nov). They are now checked column by column: each column's figures in the same row order in
 * both readings, the row labels in the same order, and each row's cells left to right as the page geometry places them.
 * A swapped figure, swapped columns, labels in another order, a misread figure, a missing row, or no geometry: still held.
 * Made-up documents. Pure logic. No database, no network, no model.
 *   npm run -s documents:column-check-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

type Line = { text: string; cells: string[]; xs?: number[] };
const line = (cells: string[], xs?: number[]): Line => ({ text: cells.join("\t"), cells, xs });

// A made-up Harbour Life schedule as its text layer gives it: every column one run, at its own left edge.
const TEXT_LINES: Line[] = [
  line(["Policy DetailsPolicy Number:ComponentAccidental DeathHospital Cash RiderWaiver of Premium"], [40]),
  line(["HL-5521"], [150]),
  line(["Plan Type:", "Harbour Shield Plus"], [300, 380]),
  line(["StatusIn ForceIn ForceIn Force"], [150]),
  line(["Sum Assured"], [230]),
  line(["200,000.00150.0020.70"], [230]),
  line(["Component Premium"], [310]),
  line(["12.508.203.10"], [310]),
  line(["Cover Start Date"], [390]),
  line(["01-Mar-201901-Mar-201901-Mar-2019"], [390]),
  line(["Harbour Life Assurance LtdReg. No 201001234K", "CONFIDENTIAL(Date Printed: 30-Nov-2024)"], [40, 400]),
];
const ROWS = [
  "Policy Number:\tHL-5521\tPlan Type:\tHarbour Shield Plus",
  "Component\tStatus\tSum Assured\tComponent Premium\tCover Start Date",
  "Accidental Death\tIn Force\t200,000.00\t12.50\t01-Mar-2019",
  "Hospital Cash Rider\tIn Force\t150.00\t8.20\t01-Mar-2019",
  "Waiver of Premium\tIn Force\t20.70\t3.10\t01-Mar-2019",
  "Harbour Life Assurance Ltd\tCONFIDENTIAL",
  "Reg. No 201001234K\t(Date Printed: 30-Nov-2024)",
];
const IMAGE = ["Policy Details", "", ...ROWS].join("\n");

async function main() {
  const { crossCheckPages, NOT_CHECKED } = await import("@/lib/documents/layout-check");
  const check = async (image: string, lines: Line[] = TEXT_LINES, geometry = true) => {
    const page: { pageNumber: number; text: string; extractionMethod: string; lines?: Line[]; unchecked?: boolean; partChecked?: boolean; uncheckedWhy?: string } =
      { pageNumber: 3, text: lines.map((l) => l.text).join("\n"), extractionMethod: "native", lines: geometry ? lines : undefined };
    const [out] = await crossCheckPages([page], [3], async () => [{ pageNumber: 3, text: image, extractionMethod: "ocr" }]);
    return out;
  };
  const kept = (out: Awaited<ReturnType<typeof check>>) => {
    assert.ok(!out.unchecked && !out.partChecked, `expected the page checked, got ${out.unchecked ? "unchecked" : "part checked"} (${out.uncheckedWhy}):\n${out.text}`);
    assert.ok(!out.text.includes(NOT_CHECKED), out.text);
  };
  const held = (out: Awaited<ReturnType<typeof check>>, figure: string) => {
    assert.ok(out.unchecked || out.partChecked, `expected the page held back:\n${out.text}`);
    assert.ok(!out.text.split("\n").some((l) => l.includes(figure) && !l.includes(NOT_CHECKED)), `${figure} must not be used:\n${out.text}`);
  };

  await test("a column-by-column text layer is confirmed against the image's rows, and stored as those rows", async () => {
    const out = await check(IMAGE);
    kept(out);
    for (const row of ROWS.slice(1)) assert.ok(out.text.split("\n").includes(row), `row stored: ${row}\n${out.text}`);
    assert.ok(!out.text.includes("200,000.00150.00"), "the glued column is gone");
  });
  await test("an image reader that prints the page twice (once without cells) still confirms it", async () => {
    kept(await check(ROWS.map((r) => r.replace(/\t/g, " ")).join("\n") + "\n\n" + IMAGE));
  });
  await test("two rows' amounts swapped in the image: held", async () => {
    held(await check(IMAGE.replace("200,000.00\t12.50", "150.00\t12.50").replace("Rider\tIn Force\t150.00", "Rider\tIn Force\t200,000.00")), "200,000.00");
  });
  await test("two columns swapped in the image (headings too): held, the page places them the other way", async () => {
    const swapped = IMAGE.split("\n").map((l) => { const c = l.split("\t"); if (c.length === 5) [c[2], c[3]] = [c[3], c[2]]; return c.join("\t"); }).join("\n");
    held(await check(swapped), "200,000.00");
  });
  await test("row labels in another order than the text prints them: held", async () => {
    held(await check(IMAGE.replace("Accidental Death\t", "@@\t").replace("Hospital Cash Rider\t", "Accidental Death\t").replace("@@\t", "Hospital Cash Rider\t")), "200,000.00");
  });
  await test("a figure the image reads differently: held", async () => {
    held(await check(IMAGE.replace("12.50", "12.80")), "200,000.00");
  });
  await test("a row the image leaves out: held", async () => {
    held(await check(IMAGE.replace("Hospital Cash Rider\tIn Force\t150.00\t8.20\t01-Mar-2019\n", "")), "200,000.00");
  });
  await test("figures that would only match if one were split: held", async () => {
    const lines = TEXT_LINES.map((l) => (l.text === "200,000.00150.0020.70" ? line(["200,000150.0020.70"], [230]) : l));
    held(await check(IMAGE.replace("200,000.00", "200,000"), lines), "200,000");
  });
  await test("no page geometry: nothing is confirmed column by column", async () => {
    held(await check(IMAGE, TEXT_LINES, false), "200,000.00");
  });

  console.log(`column-check: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

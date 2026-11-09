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
  line(["Policy DetailsPolicy Number:Servicing Adviser:ComponentAccidental DeathHospital Cash RiderWaiver of Premium"], [40]),
  line(["HL-5521Jane Doe [AD-778]"], [150]),
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
  "Servicing Adviser:\tJane Doe [AD-778]",
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

  await test("rows read row by row whose amounts the image pairs the other way: held (Critic P398 A1, C7)", async () => {
    held(await check("Death\t100,000.00\nTotal Disability\t200,000.00", [line(["Death", "200,000.00"], [40, 300]), line(["Total Disability", "100,000.00"], [40, 300])]), "100,000.00");
    held(await check("Death\t100,000.00\nTotal Disability\t200,000.00", [line(["Death"], [40]), line(["200,000.00"], [300]), line(["Total Disability"], [40]), line(["100,000.00"], [300])]), "100,000.00");
  });
  await test("a digit word beside a figure is never joined to it (Critic P398 B1)", async () => {
    held(await check("Hospital cash\t2,500.00\nICU cash\t300.00", [line(["Hospital cashICU cash"], [40]), line(["Option 2 500.00300.00"], [300])]), "2,500.00");
  });
  await test("headings printed again elsewhere on the page give no position: held (Critic P398 C5)", async () => {
    const lines = [line(["DeathTotal Disability"], [40]), line(["Premium"], [200]), line(["100.00200.00"], [200]), line(["Sum Assured"], [300]),
      line(["50,000.0060,000.00"], [300]), line(["Premium", "Sum Assured"], [500, 100])];
    held(await check("Benefit\tSum Assured\tPremium\nDeath\t100.00\t50,000.00\nTotal Disability\t200.00\t60,000.00\nPremium\tSum Assured", lines), "50,000.00");
  });
  await test("the same labels printed in two tables: a run found in two places could be either table's, so both are held (Critic P398 C1, E2)", async () => {
    const lines = [line(["DeathTotal Disability"], [40]), line(["100,000.00200,000.00"], [300]), line(["Accident"], [40]), line(["DeathTotal Disability"], [40]), line(["5,000.0010,000.00"], [300])];
    const out = await check("Death\t100,000.00\nTotal Disability\t200,000.00\nAccident\nDeath\t10,000.00\nTotal Disability\t5,000.00", lines);
    held(out, "100,000.00");
    held(out, "5,000.00");
  });
  await test("a word column the image prints in another row order (statuses swapped): held (Critic P398 E6)", async () => {
    const lines = [line(["DeathTotal Disability"], [40]), line(["In ForceLapsed"], [150]), line(["100,000.00200,000.00"], [300])];
    held(await check("Death\tLapsed\t100,000.00\nTotal Disability\tIn Force\t200,000.00", lines), "100,000.00");
    kept(await check("Death\tIn Force\t100,000.00\nTotal Disability\tLapsed\t200,000.00", lines));
  });

  // A travel schedule whose first benefit is not covered: the text column is "N.A." then two figures.
  const TRAVEL = [line(["BenefitTrip cancellationOverseas medicalBaggage"], [40]), line(["Limit"], [300]), line(["N.A.150,000.003,000.00"], [300])];
  await test("a word cell the image leaves out or blanks, so the figures shift a row: held (TE P398 C10, C11)", async () => {
    kept(await check("Benefit\tLimit\nTrip cancellation\tN.A.\nOverseas medical\t150,000.00\nBaggage\t3,000.00", TRAVEL));
    held(await check("Benefit\tLimit\nTrip cancellation\t150,000.00\nOverseas medical\t3,000.00\nBaggage\tN.A.", TRAVEL), "150,000.00");
    held(await check("Benefit\tLimit\nTrip cancellation\t\nOverseas medical\t150,000.00\nBaggage\t3,000.00", TRAVEL.map((l) => (l.text.startsWith("N.A.") ? line(["150,000.003,000.00"], [300]) : l))), "150,000.00");
    held(await check("Benefit\tLimit\nTrip cancellation\t\nOverseas medical\t150,000.00\nBaggage\t3,000.00", TRAVEL), "150,000.00");
  });
  await test("a run next to a row of the same table that prints no figure in that column could sit a row off: held (TE P398 C14)", async () => {
    const lines = [line(["PlanBasic planAccident riderHospital rider"], [40]), line(["Premium"], [200]), line(["120.5015.208.00"], [200]),
      line(["Start date"], [300]), line(["01-Mar-202101-Mar-2021"], [300]), line(["Not covered"], [300])];
    held(await check("Plan\tPremium\tStart date\nBasic plan\t120.50\t\nAccident rider\t15.20\t01-Mar-2021\nHospital rider\t8.00\t01-Mar-2021", lines), "01-Mar-2021");
  });
  await test("two tables under the same headings, the image swapping a column between them: held (TE P398 C17)", async () => {
    const lines = [line(["In-patientRoom and boardICU"], [40]), line(["Plan A"], [200]), line(["300.00900.00"], [200]), line(["Plan B"], [300]), line(["500.001,500.00"], [300]),
      line(["Out-patientGP visitSpecialist"], [40]), line(["Plan A"], [200]), line(["30.0080.00"], [200]), line(["Plan B"], [300]), line(["40.00120.00"], [300])];
    const out = await check("In-patient\tPlan A\tPlan B\nRoom and board\t300.00\t40.00\nICU\t900.00\t120.00\nOut-patient\tPlan A\tPlan B\nGP visit\t30.00\t500.00\nSpecialist\t80.00\t1,500.00", lines);
    held(out, "40.00");
    held(out, "500.00");
  });

  // A plain schedule: headings on one line, then each column as one run.
  const PLAN = (a = "200.005,000.00400.00", b = "300.008,000.00600.00") => [line(["Benefit", "Plan A", "Plan B"], [40, 260, 420]),
    line(["Daily hospital allowanceSurgical benefitIntensive care"], [40]), line([a], [260]), line([b], [420])];
  const PLAN_IMAGE = "Benefit\tPlan A\tPlan B\nDaily hospital allowance\t200.00\t300.00\nSurgical benefit\t5,000.00\t8,000.00\nIntensive care\t400.00\t600.00";
  await test("a heading word inside a row label (Benefit, Surgical benefit) does not hold the table (TE P398 C20)", async () => {
    kept(await check(PLAN_IMAGE, PLAN()));
  });
  await test("each column's heading glued before its run is that column's heading (TE P398 C24)", async () => {
    kept(await check(PLAN_IMAGE, [line(["Benefit"], [40]), PLAN()[1], line(["Plan A200.005,000.00400.00"], [260]), line(["Plan B300.008,000.00600.00"], [420])]));
    // One row: kept only with its own heading glued before each figure; swapped headings are held.
    kept(await check("Sum Assured\tPremium\n100,000.00\t50.00", [line(["Sum Assured100,000.00"], [40]), line(["Premium50.00"], [300])]));
    held(await check("Sum Assured\tPremium\n50.00\t100,000.00", [line(["Sum Assured100,000.00"], [40]), line(["Premium50.00"], [300])]), "100,000.00");
    // A glued heading ties its figure to the first row under it only (Critic P398 H1).
    held(await check("Benefit\tSum Assured\nDeath\t100,000.00\nTotal Disability\t200,000.00",
      [line(["BenefitDeath"], [40]), line(["Sum Assured200,000.00"], [300]), line(["Total Disability"], [40]), line(["100,000.00"], [300])]), "200,000.00");
  });
  await test("two tables whose last columns share a left edge, swapped by the image: each run is tied to its own table's text (TE P398 C25)", async () => {
    const lines = [line(["Benefit", "Plan A", "Plan B"], [40, 260, 420]), line(["Room and boardICU"], [40]), line(["300.00900.00"], [260]), line(["500.001,500.00"], [420]),
      line(["Service", "Standard", "Premier"], [40, 260, 420]), line(["GP visitSpecialist"], [40]), line(["30.0080.00"], [260]), line(["40.00120.00"], [420])];
    const image = (b1: string, b2: string, p1: string, p2: string) =>
      `Benefit\tPlan A\tPlan B\nRoom and board\t300.00\t${b1}\nICU\t900.00\t${b2}\nService\tStandard\tPremier\nGP visit\t30.00\t${p1}\nSpecialist\t80.00\t${p2}`;
    kept(await check(image("500.00", "1,500.00", "40.00", "120.00"), lines));
    const out = await check(image("40.00", "120.00", "500.00", "1,500.00"), lines);
    held(out, "500.00");
    held(out, "40.00");
    // The image leaves out the second table's heading row and swaps the last columns: its rows would fall under the first
    // table's headings, but the text's own heading over each run is not the image's (TE P398 C33).
    const noSecondHeading = image("40.00", "120.00", "500.00", "1,500.00").replace("Service\tStandard\tPremier\n", "");
    const out2 = await check(noSecondHeading, lines);
    held(out2, "500.00");
    held(out2, "40.00");
  });

  console.log(`column-check: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

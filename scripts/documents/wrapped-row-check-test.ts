/** Page cross-check: a row whose cells wrap onto two or more lines of the text layer, with figures on more than one of
 * them, is confirmed when the image reading prints the row on one line with exactly the same words and figures in the
 * same order. The text lines are joined column by column (where the page geometry places each cell) or in reading order
 * (where every line but one is a single cell). Before, each part was compared alone and the page's figures were all held
 * back although both readings print the same ones (TE-ACC-20261113 H2-A: an early-stage benefit hidden).
 *
 * General rule, so the cases are made-up schedules in several markets, layouts and currencies, plus negative controls: a
 * figure the image prints in another row, a different figure, a column swapped, a heading not shared, a merge of two rows
 * the image prints apart, one image row offered to two copies, a column join with no geometry. The text lines and their
 * cell positions in C1-C3 are what lib/documents/pdf.ts gives for the test engineer's made-up PDFs; the image readings are
 * reconstructions (the run kept no image reading). Pure logic. No database, no network, no model.
 *   npm run -s documents:wrapped-row-check-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

type Geo = (number[] | undefined)[];
async function main() {
  const { checkLines, crossCheckPages, NOT_CHECKED } = await import("@/lib/documents/layout-check");
  /** Two columns, a label at x=84 and a value at x=303; a line given as one cell is placed by the x given. */
  const geo = (text: string, single: number[] = []): Geo => text.split("\n").map((l, i) => {
    const n = l.split("\t").length;
    if (n === 1) return [single[i] ?? 78];
    return [84, 303, 480, 600].slice(0, n);
  });
  const agreed = (text: string, image: string, g?: Geo, page = 2) => {
    const r = checkLines(text, image, page, g);
    assert.equal(r.agree, true, `expected agreement, got: ${r.kind} ${r.why}\n${r.log}\n${r.text}`);
    assert.ok(!(r.text ?? "").includes(NOT_CHECKED), `nothing masked:\n${r.text}`);
    const out = r.text ?? text;
    assert.equal(out.split("\n").length, text.split("\n").length, `line count kept:\n${out}`);
    return out;
  };
  /** Refused: the page does not agree, and no line that prints `figure` keeps it unmasked. */
  const held = (text: string, image: string, figure: string, g?: Geo, page = 2) => {
    const r = checkLines(text, image, page, g);
    assert.equal(r.agree, false, `expected a refusal:\n${r.text}`);
    assert.ok(r.text === null || !r.text.split("\n").some((l) => l.includes(figure)), `"${figure}" held back:\n${r.text}`);
  };

  // ---- C: the reported pages, text and cell positions as pdf.ts gives them ------------------------------------------
  const ciText = [
    "BENEFIT PROVISIONS",
    "Benefit\tWhat is paid",
    "Late-stage critical illness\t100% of the Sum Covered, less any",
    "early-stage amount already paid",
    "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of",
    "RM 50,000, once per lifetime",
    "Angioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of",
    "coronary artery\tRM 25,000",
    "Hospital income (ICU)\tRM 300 per day of admission to an intensive",
    "care unit, up to 30 days per year",
    "Waiting period: no critical illness benefit is payable for an illness diagnosed within 90 days of the",
    "cover start date (1 April 2026).",
  ].join("\n");
  const ciGeo: Geo = [[78], [84, 303.64], [84, 303.64], [303.64], [84, 303.64], [303.64], [84, 303.64], [84, 303.64], [84, 303.64], [303.64], [78], [78]];
  const ciImage = [
    "BENEFIT PROVISIONS",
    "Benefit\tWhat is paid",
    "Late-stage critical illness\t100% of the Sum Covered, less any early-stage amount already paid",
    "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of RM 50,000, once per lifetime",
    "Angioplasty and other invasive treatment for coronary artery\t10% of the Sum Covered, up to a maximum of RM 25,000",
    "Hospital income (ICU)\tRM 300 per day of admission to an intensive care unit, up to 30 days per year",
    "Waiting period: no critical illness benefit is payable for an illness diagnosed within 90 days of the cover start date (1 April 2026).",
  ].join("\n");
  // Every row is shown but the one whose label AND amount both wrap with a figure on the label's second line ("coronary
  // artery\tRM 25,000"): by position that line cannot be told from a second row of its own, so it stays held (as on
  // main), and the page is read in part (Critic #446 R1/M1, TE A1/A3: two rows an image ran together never stored as one).
  await test("C1 RM CI provisions: every wrapped row confirmed and stored whole; the both-wrap row stays held", () => {
    const r = checkLines(ciText, ciImage, 2, ciGeo);
    const out = (r.text ?? "").split("\n");
    assert.ok(out.includes("Late-stage critical illness\t100% of the Sum Covered, less any early-stage amount already paid"), out.join("\n"));
    assert.ok(out.includes("Early-stage critical illness\t25% of the Sum Covered, up to a maximum of RM 50,000, once per lifetime"), out.join("\n"));
    assert.ok(out.includes("Hospital income (ICU)\tRM 300 per day of admission to an intensive care unit, up to 30 days per year"), out.join("\n"));
    assert.ok(out.includes("Waiting period: no critical illness benefit is payable for an illness diagnosed within 90 days of the cover start date (1 April 2026)."), out.join("\n"));
    assert.ok(!out.includes("RM 50,000, once per lifetime"), "the parts are emptied");
    assert.ok(!out.some((l) => /25,000|10%/.test(l)), `angioplasty held:\n${out.join("\n")}`);
    assert.equal(out.length, ciText.split("\n").length);
  });
  await test("C1b the same page through crossCheckPages: read in part, RM 50,000 shown, angioplasty held", async () => {
    const lines = ciText.split("\n").map((t, i) => ({ text: t, cells: t.split("\t"), xs: ciGeo[i] }));
    const page: { pageNumber: number; text: string; lines: typeof lines; unchecked?: boolean; partChecked?: boolean; uncheckedWhy?: string; checkLog?: string } = { pageNumber: 2, text: ciText, lines };
    const [p] = await crossCheckPages([page], [2], async () => [{ pageNumber: 2, text: ciImage, extractionMethod: "ocr" }]);
    assert.ok(!p.unchecked && p.partChecked, `${p.uncheckedWhy} ${p.checkLog}`);
    assert.ok(p.text.includes("RM 50,000, once per lifetime") && p.text.includes("RM 300 per day") && !p.text.includes("RM 25,000"), p.text);
  });
  await test("C2 GBP schedule: a date split across two lines ('18 February' / '2025)')", () => agreed(
    "Harbourline Assurance plc\nPolicy number: HPA-1\tPeriod of insurance: 1 March 2026 to 28 February 2027\tCurrency\nof this policy: Pounds sterling (GBP)\nDate of issue: 20 February 2026 (renewal schedule; replaces the schedule dated 18 February\n2025)\nInsured person\tSum Insured\nNgozi Okafor\tGBP 100,000",
    "Harbourline Assurance plc\nPolicy number: HPA-1\tPeriod of insurance: 1 March 2026 to 28 February 2027\tCurrency of this policy: Pounds sterling (GBP)\nDate of issue: 20 February 2026 (renewal schedule; replaces the schedule dated 18 February 2025)\nInsured person\tSum Insured\nNgozi Okafor\tGBP 100,000",
    [[183], [78, 219.7, 476.5], [78], [78], [78], [84, 303], [84, 303]]));
  await test("C3 bare-$ travel certificate: '$100 for every full 6 hours of delay, up to' / '$1,000'", () => agreed(
    "Benefit\tLimit per insured person\nTrip cancellation\t$5,000\nTravel delay\t$100 for every full 6 hours of delay, up to\n$1,000\nExcess: $150 per claim applies to medical expenses and baggage.",
    "Benefit\tLimit per insured person\nTrip cancellation\t$5,000\nTravel delay\t$100 for every full 6 hours of delay, up to $1,000\nExcess: $150 per claim applies to medical expenses and baggage.",
    [[84, 303], [84, 303], [84, 303], [303], [78]]));

  // ---- P: other markets and layouts --------------------------------------------------------------------------------
  await test("P1 S$ three columns, label and limit both wrap, no geometry needed for reading-order value wrap", () => agreed(
    "Benefit\tPlan A\nOutpatient cancer treatment\tS$15,000 per policy year, then 80% of\nthe next S$5,000\nHospital cash\tS$150",
    "Benefit\tPlan A\nOutpatient cancer treatment\tS$15,000 per policy year, then 80% of the next S$5,000\nHospital cash\tS$150"));
  await test("P2 EUR comma decimals, a value wrapping over three lines", () => agreed(
    "Leistung\tBetrag\nKrankenhaustagegeld\tEUR 50,00 pro Tag ab dem\n3. Tag, höchstens 30 Tage,\ninsgesamt EUR 1.500,00\nTodesfall\tEUR 25.000,00",
    "Leistung\tBetrag\nKrankenhaustagegeld\tEUR 50,00 pro Tag ab dem 3. Tag, höchstens 30 Tage, insgesamt EUR 1.500,00\nTodesfall\tEUR 25.000,00",
    geo("Leistung\tBetrag\nKrankenhaustagegeld\tEUR 50,00 pro Tag ab dem\n3. Tag, höchstens 30 Tage,\ninsgesamt EUR 1.500,00\nTodesfall\tEUR 25.000,00", [78, 78, 303, 303, 78])));
  await test("P3 IDR three-column table, middle column wraps with a figure on each line (by column)", () => {
    const text = "Manfaat\tBatas\tKeterangan\nRawat inap\tRp 1.000.000 per hari,\tmaks. 60 hari\nmaksimal Rp 60.000.000\tper tahun\nPembedahan\tRp 25.000.000\tper tindakan";
    const out = agreed(text,
      "Manfaat\tBatas\tKeterangan\nRawat inap\tRp 1.000.000 per hari, maksimal Rp 60.000.000\tmaks. 60 hari per tahun\nPembedahan\tRp 25.000.000\tper tindakan",
      [[84, 250, 420], [84, 250, 420], [250, 420], [84, 250, 420]]);
    assert.ok(out.split("\n").includes("Rawat inap\tRp 1.000.000 per hari, maksimal Rp 60.000.000\tmaks. 60 hari per tahun"), out);
  });
  await test("P4 a label centred over two lines: words-only line above, figures on the next two (by column)", () => agreed(
    "Benefit\tAmount\nPermanent disablement\nfrom accident\tHK$500,000, or 50% of\nHK$1,000,000 for loss of one limb\nDeath\tHK$1,000,000",
    "Benefit\tAmount\nPermanent disablement from accident\tHK$500,000, or 50% of HK$1,000,000 for loss of one limb\nDeath\tHK$1,000,000",
    [[84, 303], [84], [84, 303], [303], [84, 303]]));
  await test("P5 a sentence running onto the next line, no table at all (₱ figures)", () => agreed(
    "Claims\nNotify us within 30 days and we pay up to PHP 20,000 for\nambulance costs, plus PHP 500 per day of confinement.",
    "Claims\nNotify us within 30 days and we pay up to PHP 20,000 for ambulance costs, plus PHP 500 per day of confinement."));

  // ---- N: negative controls ----------------------------------------------------------------------------------------
  await test("N1 the image puts the wrapped cap in the next row: held", () => held(
    "Benefit\tLimit\nEarly-stage illness\t25% of the Sum Covered, up to a maximum of\nRM 50,000\nAngioplasty\t10% of the Sum Covered",
    "Benefit\tLimit\nEarly-stage illness\t25% of the Sum Covered, up to a maximum of\nAngioplasty\t10% of the Sum Covered RM 50,000",
    "50,000", [[84, 303], [84, 303], [303], [84, 303]]));
  await test("N2 the image prints another figure in the wrapped part: held", () => held(
    ciText, ciImage.replace("RM 50,000, once", "RM 5,000, once"), "50,000", ciGeo));
  await test("N3 the image prints the wrapped label part in the amount's column: held", () => held(
    "Benefit\tLimit\nAngioplasty and other\t10% of the Sum Covered, up to\ninvasive treatment\tRM 25,000\nICU\tRM 300",
    "Benefit\tLimit\nAngioplasty and other\t10% of the Sum Covered, up to RM 25,000 invasive treatment\nICU\tRM 300",
    "25,000", [[84, 303], [84, 303], [84, 303], [84, 303]]));
  await test("N4 two rows the image prints apart are never merged", () => {
    const r = checkLines("Benefit\tAmount\nDeath\tRM 200,000\nTPD\tRM 100,000", "Benefit\tAmount\nDeath\tRM 200,000\nTPD\tRM 100,000", 2, [[84, 303], [84, 303], [84, 303]]);
    assert.equal(r.agree, true);
    assert.ok(r.text === null || r.text.split("\n").includes("Death\tRM 200,000"), `${r.text}`);
    // And a line that matches on its own is not taken into the row above even when the image glues them.
    held("Benefit\tAmount\nDeath\tRM 200,000, up to\nTPD\tRM 100,000\nICU\tRM 300", "Benefit\tAmount\nDeath\tRM 200,000, up to TPD RM 100,000\nTPD\tRM 100,000\nICU\tRM 300",
      "200,000", [[84, 303], [84, 303], [84, 303], [84, 303]]);
  });
  await test("N5 the joined row sits under another heading in the image: held", () => held(
    "Section A\nBenefit\tLimit\nDental\tS$500 per visit, up to\nS$1,500 a year\nSection B\nOptical\tS$300",
    "Section B\nDental\tS$500 per visit, up to S$1,500 a year\nSection A\nBenefit\tLimit\nOptical\tS$300",
    "1,500", [[78], [84, 303], [84, 303], [303], [78], [84, 303]]));
  await test("N6 the image adds a figure the joined lines do not print: held", () => held(
    "Benefit\tLimit\nHospital cash\tGBP 50 per day from the third day,\nup to 30 days\nDeath\tGBP 10,000",
    "Benefit\tLimit\nHospital cash\tGBP 50 per day from the third day, up to 30 days, maximum GBP 1,500\nDeath\tGBP 10,000",
    "50 per day", [[84, 303], [84, 303], [303], [84, 303]]));
  await test("N14 a label and amount both wrapping, no page geometry: the label part with a figure stays held", () => held(
    "Benefit\tLimit\nAngioplasty and other\t10% of the Sum Covered, up to\ninvasive treatment\tRM 25,000\nICU\tRM 300",
    "Benefit\tLimit\nAngioplasty and other invasive treatment\t10% of the Sum Covered, up to RM 25,000\nICU\tRM 300", "25,000"));
  await test("N15 a lower-case second row under a row whose value runs on: never merged (by column and by slot)", () => {
    for (const g of [[[84, 303], [84, 303], [84, 303], [84, 303]], undefined] as (Geo | undefined)[]) {
      held("Benefit\tLimit\nHospital cash\tAUD 100 per day, up to\ndental\tAUD 500\nOptical\tAUD 250",
        "Benefit\tLimit\nHospital cash dental\tAUD 100 per day, up to AUD 500\nOptical\tAUD 250", "AUD 500", g);
    }
  });
  await test("N16 a cap the image prints at the start of the next row: held (TE #446 F1)", () => held(
    "Cover\tLimit\nTemporary accommodation\t10% of the building sum insured, up to\na maximum of AUD 65,000 per event\nStorm excess\tAUD 500 per claim",
    "Cover\tLimit\nTemporary accommodation\t10% of the building sum insured, up to\nStorm excess\ta maximum of AUD 65,000 per event AUD 500 per claim",
    "65,000", [[84, 234], [84, 234], [234], [84, 234]]));
  await test("N17 indented or centred label columns: a second row never joins (Critic #446 M1)", () => {
    held("Benefit\tAmount\nDeath\tRM 200,000\n- accidental death\tRM 400,000\nTPD\tRM 100,000\nICU\tRM 300",
      "Benefit\tAmount\nDeath\tRM 200,000\n- accidental death TPD\tRM 400,000 RM 100,000\nICU\tRM 300", "400,000", [[84, 303], [84, 303], [96, 303], [84, 303], [84, 303]]);
    held("Benefit\tAmount\nDeath\tRM 200,000\nTPD\tRM 100,000\nICU\tRM 300", "Benefit\tAmount\nDeath TPD\tRM 200,000 RM 100,000\nICU\tRM 300",
      "100,000", [[120, 303], [130, 303], [136, 303], [134, 303]]);
  });
  await test("P8 three columns, no geometry, a value part in a blank first slot ('\\t250' under 'up to AUD')", () => agreed(
    "Service\tBenefit\tAnnual limit\nOptical\t65% of the fee, up to AUD\tAUD 250 per person\n\t250\nDental\t60%\tAUD 800",
    "Service\tBenefit\tAnnual limit\nOptical\t65% of the fee, up to AUD 250\tAUD 250 per person\nDental\t60%\tAUD 800"));
  await test("N7 no page geometry, the image puts the label part in the amount's slot: held", () => held(
    "Benefit\tLimit\nAngioplasty and other\t10% of the Sum Covered, up to\ninvasive treatment\tRM 25,000\nICU\tRM 300",
    "Benefit\tLimit\nAngioplasty and other\t10% of the Sum Covered, up to invasive treatment RM 25,000\nICU\tRM 300", "25,000"));
  await test("N13 a label centred beside a value's second line joins once: a second label line below is its own row", () => {
    agreed("Rider\tBenefit\nPremiums waived after 6 months of\nWaiver\ttotal disability, up to 24 months,\nmaximum $2,400 a month\nChild\t$10,000",
      "Rider\tBenefit\nWaiver\tPremiums waived after 6 months of total disability, up to 24 months, maximum $2,400 a month\nChild\t$10,000",
      [[84, 204], [204], [84, 204], [204], [84, 204]]);
    held("Rider\tBenefit\nPremiums waived after 6 months\nWaiver\t$2,400 a month\nChild\t$10,000",
      "Rider\tBenefit\nWaiver Child\tPremiums waived after 6 months $2,400 a month $10,000", "10,000", [[84, 204], [204], [84, 204], [84, 204]]);
  });
  await test("N8 one image row confirms one joined row: a second copy of the row in the text stays held", () => {
    const r = checkLines("Benefit\tLimit\nCover\tRM 100\nRM 100\nCover\tRM 100\nICU\tRM 300",
      "Benefit\tLimit\nCover RM 100 RM 100\nICU\tRM 300", 2, [[84, 303], [84, 303], [303], [84, 303], [84, 303]]);
    assert.equal(r.agree, false);
    assert.equal(r.text?.split("\n")[3], `Cover\tRM ${NOT_CHECKED}`, `${r.text}`);
  });
  await test("N9 two cells of one line placed in the same column: no column join (held)", () => held(
    "Benefit\tLimit\nOutpatient\t80% up to\nS$1,000\tper year\nDeath\tS$300,000",
    "Benefit\tLimit\nOutpatient per year\t80% up to S$1,000\nDeath\tS$300,000", "1,000", [[84, 303], [84, 303], [303, 310], [84, 303]]));

  // Critic #446: a held row holds every line joined into it, and two complete rows are never joined.
  const masked = (text: string, image: string, g: Geo | undefined, rows: string[]) => {
    const r = checkLines(text, image, 2, g);
    assert.equal(r.agree, false, `expected a refusal:\n${r.text}`);
    for (const row of rows) {
      const line = r.text?.split("\n").find((l) => l.startsWith(row));
      assert.ok(r.text === null || (line !== undefined && !/\d/.test(line.split(NOT_CHECKED).join(""))), `"${row}" shows no figure:\n${r.text}`);
    }
  };
  await test("N10 a joined continuation whose row's own figure differs is held with it (no geometry)", () => masked(
    "Benefit\tLimit\nSurgery\tRM 5,000 per operation\nor for day surgery\nup to RM 50,000\na year\nDeath\tRM 100,000",
    "Benefit\tLimit\nSurgery\tRM 6,000 per operation\nor for day surgery up to RM 50,000 a year\nDeath\tRM 100,000",
    undefined, ["Surgery", "or for day surgery"]));
  await test("N11 a joined row whose held continuation follows it is held too (with and without geometry)", () => {
    const text = "Benefit\tLimit\nSurgery\tRM 5,000 per operation, up to\nRM 20,000 a year\nor RM 30,000 for day surgery\nDeath\tRM 100,000";
    const image = "Benefit\tLimit\nSurgery\tRM 5,000 per operation, up to RM 20,000 a year\nor RM 3,000 for day surgery\nDeath\tRM 100,000";
    masked(text, image, [[84, 303], [84, 303], [303], [303], [84, 303]], ["Surgery", "or RM"]);
    masked(text, image, undefined, ["Surgery", "or RM"]);
  });
  await test("N12 two complete rows an image reader ran together are not stored as one (by column and in reading order)", () => {
    held("Benefit\tAmount\nDeath\tRM 200,000\nTPD\tRM 100,000\nICU\tRM 300", "Benefit\tAmount\nDeath TPD\tRM 200,000 RM 100,000\nICU\tRM 300",
      "100,000", [[84, 303], [84, 303], [84, 303], [84, 303]]);
    held("Benefits\nDeath RM 200,000\nTPD RM 100,000\nICU RM 300", "Benefits\nDeath RM 200,000 TPD RM 100,000\nICU RM 300", "100,000");
    held("Leistungen\nTod EUR 20.000,00\nInvalidität EUR 50.000,00", "Leistungen\nTod EUR 20.000,00 Invalidität EUR 50.000,00", "50.000");
    held("Benefit\tAmount\nDeath\tRM 200,000\ne-hailing accident\tRM 10,000\nICU\tRM 300", "Benefit\tAmount\nDeath e-hailing accident\tRM 200,000 RM 10,000\nICU\tRM 300",
      "10,000", [[84, 303], [84, 303], [84, 303], [84, 303]]);
    held("Benefit\tAmount\nDeath\tRM 200,000\ne-hailing accident\tRM 10,000\nICU\tRM 300", "Benefit\tAmount\nDeath e-hailing accident\tRM 200,000 RM 10,000\nICU\tRM 300", "10,000");
  });
  await test("P6 a word hyphenated across the wrap ('peri-' / 'od') and a real hyphen ('early-' / 'stage')", () => {
    agreed("Benefit\tLimit\nPre-existing conditions\tRM 5,000 after a 12-month waiting peri-\nod, up to RM 10,000\nDeath\tRM 100,000",
      "Benefit\tLimit\nPre-existing conditions\tRM 5,000 after a 12-month waiting period, up to RM 10,000\nDeath\tRM 100,000");
    agreed("Benefit\tLimit\nCancer\t25% of the sum, for an early-\nstage cancer up to A$50,000\nDeath\tA$100,000",
      "Benefit\tLimit\nCancer\t25% of the sum, for an early-stage cancer up to A$50,000\nDeath\tA$100,000");
  });

  if (failures.length) { console.error(failures.join("\n\n")); console.error(`\n${failures.length} failed, ${passed} passed`); process.exit(1); }
  console.log(`wrapped-row-check: ${passed} passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

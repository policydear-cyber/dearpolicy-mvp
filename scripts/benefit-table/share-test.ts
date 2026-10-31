/** A percentage row whose amount is not worked out still says the share it pays, in its own words, and never an amount:
 * its maximum was cut off at reading ("10% of Prevailing Insured Amount, up to maximum"), or what it is a share of is not
 * stated with it. Made-up documents from several insurers, currencies and wordings; no household data, no model.
 *   npm run benefit-table:share-test */
import assert from "node:assert/strict";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main() {
  const { checkReading } = await import("@/lib/benefit-table/check");
  const { assembleTable, coverKeyOf, figureText, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  const { shortFigure } = await import("@/lib/benefit-table/headline");
  const { shareOf } = await import("@/lib/format/share-of");
  type Doc = Parameters<typeof checkReading>[0];

  const family = [{ id: "p1", display_name: "Nur Aisyah binti Rahman" }, { id: "p2", display_name: "Oliver Grant" }];
  const benefit = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "percent", value: null, percentOf: null, baseAmount: null, baseQuote: null,
    cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
  /** One person's policy: a schedule with their sum insured and a benefit page, linked to that cover. */
  const household = (o: { person: string; product: string; cover: string; sum: number; sumText: string; lines: string[]; benefits: Record<string, unknown>[] }) => {
    const sched: Doc = { id: "s-" + o.product, name: "Schedule.pdf", readable: true, pages: [{ page: 1, text: `POLICY SCHEDULE\n${o.cover}\n${o.person}\t${o.sumText}` }] };
    const terms: Doc = { id: "t-" + o.product, name: "Benefits.pdf", readable: true, pages: [{ page: 7, text: o.lines.join("\n") }] };
    const cover = { person: o.person, product: o.product, cover: o.cover, plan: null, riderOf: null, policyNumber: null, sumInsured: o.sum, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: `${o.person}\t${o.sumText}` };
    const meta = { kind: "personal_proof", product: o.product, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null };
    const a = checkReading(sched, { document: meta, covers: [cover], benefits: [] } as never);
    const b = checkReading(terms, { document: { ...meta, kind: "scheme_terms" }, covers: [], benefits: o.benefits.map((x) => benefit({ page: 7, section: o.cover, ...x })) } as never);
    const key = coverKeyOf({ product: o.product, cover: o.cover, plan: null });
    const table = assembleTable([a, b], family, [{ section: sectionKeyOf(terms.id, { section: o.cover, column: null }), cover: key, why: "its benefits" }]);
    return table.people.flatMap((p) => p.rows);
  };
  const row = (rows: ReturnType<typeof household>, name: string) => { const r = rows.find((x) => x.benefit === name); assert.ok(r, `row ${name}: ${rows.map((x) => x.benefit).join(", ")}`); return r!; };

  await test("a share cut off before its maximum keeps the share and says a maximum applies, never a worked-out amount (S$, a base in words)", () => {
    const rows = household({ person: "Oliver Grant", product: "HeartGuard", cover: "Double Critical Cover", sum: 250000, sumText: "S$250,000",
      lines: ["Double Critical Cover", "Angioplasty\t:\t10% of Prevailing Insured Amount, up to maximum", "Other conditions\t:\t100% of Prevailing Insured Amount"],
      benefits: [
        { benefit: "Angioplasty", value: 10, percentOf: "other", quote: "Angioplasty\t:\t10% of Prevailing Insured Amount, up to maximum" },
        { benefit: "Other conditions", value: 100, percentOf: "other", quote: "Other conditions\t:\t100% of Prevailing Insured Amount" },
      ] });
    const cut = row(rows, "Angioplasty");
    assert.equal(cut.figure.kind, "none");
    assert.deepEqual(shortFigure(cut), { text: "10% of Prevailing Insured Amount", note: "a maximum applies, but it was not captured from the page: see the document" });
    assert.match(figureText(cut.figure), /^10% of Prevailing Insured Amount, no amount worked out \(a maximum applies/);
    assert.doesNotMatch(JSON.stringify(cut.figure), /25,?000|250,?000|"amount"/);
    // A share of a base the page does not state keeps its share too, and still no amount.
    const other = row(rows, "Other conditions");
    assert.equal(other.figure.kind, "none");
    assert.equal(shortFigure(other).text, "100% of Prevailing Insured Amount");
  });

  await test("a share of the sum insured with its maximum cut off is never worked out on the person's sum, in RM and £ too", () => {
    for (const [cur, sum, sumText] of [["RM", 300000, "RM300,000"], ["£", 80000, "£80,000"]] as const) {
      const rows = household({ person: "Nur Aisyah binti Rahman", product: "Lindung " + cur, cover: "Penyakit Kritikal", sum, sumText,
        lines: ["Penyakit Kritikal", "Pembedahan kecil: 20% of the Sum Assured, subject to a maximum of"],
        benefits: [{ benefit: "Pembedahan kecil", value: 20, percentOf: "sum_insured", quote: "Pembedahan kecil: 20% of the Sum Assured, subject to a maximum of" }] });
      const r = row(rows, "Pembedahan kecil");
      assert.equal(r.figure.kind, "none", `${cur}: a worked-out figure for a share whose maximum was cut off`);
      assert.equal(shortFigure(r).text, "20% of the Sum Assured");
      assert.doesNotMatch(JSON.stringify(r.figure), new RegExp(String(sum * 0.2)));
    }
  });

  await test("a share whose maximum is read and checked keeps that maximum in its printed words; a worked-out row is unchanged", () => {
    const rows = household({ person: "Oliver Grant", product: "CareShield HK", cover: "Major Illness", sum: 500000, sumText: "HK$500,000",
      lines: ["Major Illness", "Carcinoma in situ: 25% of Basic Coverage Amount, up to HK$100,000", "Early stage: 20% of the sum insured, up to HK$50,000"],
      benefits: [
        { benefit: "Carcinoma in situ", value: 25, percentOf: "other", cap: 100000, capQuote: "up to HK$100,000", quote: "Carcinoma in situ: 25% of Basic Coverage Amount, up to HK$100,000" },
        { benefit: "Early stage", value: 20, percentOf: "sum_insured", cap: 50000, capQuote: "up to HK$50,000", quote: "Early stage: 20% of the sum insured, up to HK$50,000" },
      ] });
    const cis = row(rows, "Carcinoma in situ");
    assert.deepEqual(shortFigure(cis), { text: "25% of Basic Coverage Amount", note: "up to HK$100,000 (printed with it on p7)" });
    const early = row(rows, "Early stage");
    assert.equal(early.figure.kind, "worked_out");
    assert.equal(early.figure.kind === "worked_out" && early.figure.amount, 50000);
  });

  await test("no share is said when the row does not print one with one meaning", () => {
    for (const q of ["Hip 75% / Knee 50%, up to maximum", "Payout: 10% of the, up to maximum", "S$100 per day, up to maximum", "Up to 10%", "10 % of"]) assert.equal(shareOf(q), null, q);
    assert.deepEqual(shareOf("Rawatan: 10% daripada Jumlah Diinsuranskan, sehingga maksimum", { name: "Rawatan" }), { percent: 10, of: "Jumlah Diinsuranskan" });
    assert.deepEqual(shareOf("12,5 % of the Insured Sum (maximum"), { percent: 12.5, of: "the Insured Sum" });
    // "or" opens an alternative ("150% of the Death Benefit or S$X, whichever is higher"): not a cap opener, so no share.
    assert.equal(shareOf("pays 150% of the Death Benefit or"), null);
  });

  await test("a share is read only with closed lists: the whole phrase as printed, then the end or a cap opener (Critic's probes)", () => {
    // Anything after the phrase that is not a closed cap opener, a figure in the phrase, or more than six words: null.
    for (const q of ["10% of RM50,000, up to maximum", "10% of S$50,000 up to maximum", "10% of the first S$1,000 of the bill", "10% of first RM5,000",
      "10% of Sum Insured but not more than S$500", "10% of Sum Insured except Section 3", "10% of Sum Insured, once only",
      "10% of the Sum Insured multiplied by 2", "10% of Sum Insured times the number of years", "10% of Sum Insured reduced by any prior claim",
      "10% of USD 10,000", "10% of the Death Benefit Sum Insured Amount Payable Hereunder", "10 % of Sum Insured in excess of S$1,000",
      "10 per cent of Sum Insured", "10% of Sum Insured minus", "10% of Sum Insured excluding", "10% of Sum Insured or S$5,000, whichever is higher",
      "10% of Sum Insured\nRoom and board", "Pembedahan 20% dari Jumlah Diinsuranskan atau RM5,000", "10% of Sum Insured, payable once"])
      assert.equal(shareOf(q), null, q);
    // The phrase is kept whole, never cut: what is shown is exactly what the row prints.
    for (const [q, of] of [["10% of Sum Insured upon diagnosis", "Sum Insured upon diagnosis"], ["10% of Sum Insured minus claims paid", "Sum Insured minus claims paid"],
      ["10% of the reasonable and customary charges", "the reasonable and customary charges"], ["10% of the balance.", "the balance"],
      ["10% of the Sum Insured (max S$5,000)", "the Sum Insured"], ["10% of the Sum Insured, max. S$5,000", "the Sum Insured"],
      ["25% daripada Jumlah Diinsuranskan", "Jumlah Diinsuranskan"], ["30% dari Jumlah Diinsuranskan, maksimum RM10,000", "Jumlah Diinsuranskan"],
      ["15% of the Sum Assured not exceeding £20,000", "the Sum Assured"], ["10% of Annual Limit whichever is lower", "Annual Limit"],
      ["50% of the sum insured, capped at €40.000", "the sum insured"]] as const)
      assert.deepEqual(shareOf(q), { percent: Number(q.match(/^\D*(\d+)/)![1]), of }, q);
  });

  await test("a condition printed before the share, or a currency named as its base, gives no share (Critic M3, test engineer F1)", () => {
    for (const q of ["After 2 years, 10% of Sum Insured", "If hospitalised overseas, 10% of Sum Insured, up to maximum", "Only for the first claim: 10% of Sum Insured",
      "Selepas 2 tahun, 10% daripada Jumlah Diinsuranskan", "Where the child is under 5: 25% of the Sum Assured",
      "10% of RM", "10% of SGD, up to maximum", "Angioplasty : 10% of HKD", "10% of USD", "10% of IDR", "10% of Ringgit", "15% of Sum Insured dollars"])
      assert.equal(shareOf(q, { name: "Angioplasty" }), null, q);
    // The row's own name or heading, numbering, a bullet or a closed lead-in may come first.
    for (const [q, name] of [["Angioplasty\t:\t10% of Prevailing Insured Amount, up to maximum", "Angioplasty"], ["(b) Keyhole surgery – 20% of the Sum Assured", "Keyhole surgery"],
      ["• Pays 10% of the Sum Insured", null], ["We will pay 50% of the Basic Sum Assured, subject to a maximum", null], ["Bayaran: 25% daripada Jumlah Diinsuranskan", null],
      ["Early Critical Illness 25% of Basic Coverage Amount", "Early Critical Illness"]] as const)
      assert.ok(shareOf(q, { name }), q);
    assert.equal(shareOf("Minor surgery 15% of the sum insured", { name: "Dental" }), null, "another benefit's name is not this row's");
  });

  console.log(`benefit-table share: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

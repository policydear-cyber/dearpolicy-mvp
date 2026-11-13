/** Page cross-check: running text the text layer breaks over several lines and an image reader prints as one paragraph is
 * confirmed when the paragraph is exactly the lines' words and figures in the same order, under the same heading. In
 * running text only, one known image-reader letter slip is allowed in one word ("l" for "I", a stroke read twice beside
 * another, "rn" for "m"). Every figure must still match in place; tables stay word for word; any other letter, a second
 * slip, another order or another heading is refused and the line's figures masked. Made-up documents in several markets.
 * Pure logic. No database, no network, no model.
 *   npm run -s documents:sentence-paragraph-check-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { checkLines, NOT_CHECKED } = await import("@/lib/documents/layout-check");
  const confirmed = (text: string, image: string, page = 3, asPrinted = true) => {
    const r = checkLines(text, image, page);
    assert.equal(r.agree, true, `expected agreement, got: ${r.why}\n${r.text}`);
    assert.ok(!(r.text ?? text).includes(NOT_CHECKED), "nothing masked");
    if (asPrinted) assert.equal(r.text ?? text, text, "the text is stored as the text layer prints it");
  };
  // Refused: the page does not agree, and the line loses its figures (masked, or the whole page left unchecked).
  const refused = (text: string, image: string, line: string, page = 3) => {
    const r = checkLines(text, image, page);
    assert.equal(r.agree, false, "expected the line to be refused");
    const out = r.text?.split("\n").find((l) => l.startsWith(line));
    assert.ok(r.text === null || (out !== undefined && out.includes(NOT_CHECKED)), `"${line}" masked:\n${r.text}`);
  };
  const table = "Schedule of Cover\nPlan\tStatus\tSum Insured\tPremium\nHarbour Shield Plan\tIn Force\t25,000.00\t88.20";
  const s1 = "For Harbour Growth, the sum insured and premium amounts as shown include indexation from year 3 onwards (if applicable).";
  const s2 = "Note: Harbour Saver policies with cover starting before the year 2015 are now known as HarbourInvest Saver Plus";
  const text = `${table}\n${s1}\n${s2}\nExample Assurance Ltd\tPRIVATE`;
  const image = (para: string) => `${table}\n\n${para}\n\nExample Assurance Ltd\nPRIVATE`;

  // Positive: two sentences on two text lines, one paragraph in the image (S$ schedule).
  await test("P1 two sentences printed as one paragraph", () => confirmed(text, image(`${s1} ${s2}`)));
  // Positive: the same with a stroke read twice ("HarbourlInvest"), as live on 13 Nov.
  await test("P2 one doubled stroke in a word", () => confirmed(text, image(`${s1} ${s2.replace("HarbourInvest", "HarbourlInvest")}`)));
  // Positive: "l" read for "I" inside a word, and "rn" for "m", in a ringgit and a pound notice.
  await test("P3 l for I in one word", () => confirmed(
    "Notes\nBenefits under this policy are payable in Malaysian Ringgit from age 18 onwards only,\nand the waiting period of 30 days applies to Illness claims made in the first year.",
    "Notes\n\nBenefits under this policy are payable in Malaysian Ringgit from age 18 onwards only, and the waiting period of 30 days applies to lllness claims made in the first year."));
  await test("P4 rn for m in one word", () => confirmed(
    "Important\nThe premium of £45 a month is reviewed every 5 years from the commencement date of this plan.",
    "Important\n\nThe premiurn of £45 a month is reviewed every 5 years from the commencement date of this plan."));
  // Positive: a sentence wrapped over three lines (a rupiah notice), the middle line without a figure. Its continuation
  // lines start lower case, so the earlier joined-row rule (#446) already confirms it and stores the row joined.
  await test("P5 one sentence over three lines", () => confirmed(
    "Notes\nThe hospital cash benefit of Rp 500.000 per day is paid for at most 60 days\nin each policy year, and only for stays that the attending doctor\ncertifies as medically necessary after the first 2 days.",
    "Notes\n\nThe hospital cash benefit of Rp 500.000 per day is paid for at most 60 days in each policy year, and only for stays that the attending doctor certifies as medically necessary after the first 2 days.", 3, false));

  // Negative: another letter is not a known slip ("Saver" read "Sover"; "plan" read "pan").
  await test("N1 a letter outside the known slips", () => refused(text, image(`${s1} ${s2.replace("Saver policies", "Sover policies")}`), "Note:"));
  await test("N1b a dropped letter beside no other stroke", () => refused(
    "Notes\nThe plan pays 50 per cent of the sum insured when the insured person reaches age 70.",
    "Notes\n\nThe pan pays 50 per cent of the sum insured when the insured person reaches age 70.", "The plan"));
  // Negative: two known slips in two words of one paragraph.
  await test("N2 two known slips in two words", () => refused(text, image(`${s1.replace("indexation", "lndexation")} ${s2.replace("HarbourInvest", "HarbourlInvest")}`), "For Harbour"));
  // Negative: a figure differs (2016 for 2015): figures never take a slip.
  await test("N3 a figure differs", () => refused(text, image(`${s1} ${s2.replace("2015", "2016")}`), "Note:"));
  // Negative: the image prints the sentences in the other order.
  await test("N4 another order", () => refused(text, image(`${s2} ${s1}`), "For Harbour"));
  // Negative: a table row keeps word-for-word: "Hospltal" for "Hospital" in a tab row is refused.
  await test("N5 tables stay word for word", () => refused(
    "Schedule\nBenefit\tLimit\nHospital Cash per day\t150.00\nSurgical Benefit\t5,000.00",
    "Schedule\nBenefit\tLimit\nHospltal Cash per day\t150.00\nSurgical Benefit\t5,000.00", "Hospital Cash"));
  // Negative: a short line (not running text) takes no slip.
  await test("N6 a short line takes no slip", () => refused(
    "Cover\nDeath Benefit 100,000\nWaiting period 30 days\nPremium 120",
    "Cover\nDeath Beneflt 100,000\nWaiting period 30 days\nPremium 120", "Death Benefit"));
  // Negative: the paragraph is under another shared heading in the image.
  await test("N7 another heading", () => refused(
    `Notes A\n${s1}\n${s2}\nNotes B\nNo further notes are printed for this plan in year 1.`,
    `Notes A\nNo further notes are printed for this plan in year 1.\nNotes B\n${s1} ${s2}`, "For Harbour"));
  // Negative: a word added in the image ("not") is more than a letter.
  await test("N8 a word added", () => refused(text, image(`${s1} ${s2.replace("are now", "are not now")}`), "Note:"));
  // Negative: tab cells in the text lines are a table, never joined as running text.
  await test("N9 tab rows run together are not a paragraph", () => refused(
    "Schedule\nAccidental death benefit for each insured person\t100,000\nAccidental disability benefit for each insured person\t50,000",
    "Schedule\nAccidental death benefit for each insured person 100,000 Accidental disability benefit for each insured person 50,000", "Accidental death"));

  // Control: lines that already match one by one are unchanged.
  await test("C1 line-for-line still agrees", () => confirmed(text, image(`${s1}\n${s2}`)));

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`sentence-paragraph-check: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

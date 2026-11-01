/**
 * The r9 ingestion audit treats a stored condition as invented unless it is printed in the document or is a note
 * DearPolicy writes itself. This checks the own-note rule: DearPolicy's wordings pass, and a note that names a figure
 * passes only when the document prints that figure, so a note can never plant an amount. Pure: no database, no model.
 */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

async function main() {
  const { ownNote } = await import("./audit");
  const { PLAN_COLUMNS_NOTE } = await import("@/lib/insurance/scale-limit");
  const { shareCapNote } = await import("@/lib/policies/benefit-catalog");
  const page = "Early-stage cancers\t25% of the sum assured, up to S$25,000\nDental\tRM1,200 a year";
  let n = 0;
  const ok = (cond: boolean, what: string) => { assert.ok(cond, what); n++; };
  ok(ownNote(PLAN_COLUMNS_NOTE, page), "the plan-columns note is DearPolicy's own");
  ok(ownNote("DearPolicy read this as a yearly limit.", page), "the existing DearPolicy note prefix still passes");
  ok(ownNote(shareCapNote(25000, "SGD"), page), "a share-cap note whose cap is printed passes (S$)");
  ok(ownNote(shareCapNote(1200, "MYR"), page), "a share-cap note whose cap is printed passes (RM)");
  ok(!ownNote(shareCapNote(250000, "SGD"), page), "a share-cap note naming a figure the document does not print is invented");
  ok(!ownNote(shareCapNote(25000, "SGD"), "No figures on this page."), "a share-cap note on a page with no figure is invented");
  ok(!ownNote("Paid up to S$25,000 per claim, as agreed by phone.", page), "a look-alike sentence is not DearPolicy's note");
  ok(!ownNote("The document prints a different figure for each plan.", page), "a shortened plan-columns note is not DearPolicy's note");
  // A note names exactly one figure, and the page prints it whole (from the test engineer's probes).
  const sg = "Accidental death\t50% of the sum assured, up to S$75,000\nRoom and board\tS$1,936.50 a day";
  const rp = "Rawat inap\tmaksimum Rp4.250.000 per hari\nPembedahan\tRp25.000.000";
  ok(!ownNote("Paid up to S$75,000 and S$999,999, the cap this passage prints.", sg), "a second figure planted in the note");
  ok(!ownNote("Paid up to S$75,000 or 999,999, the cap this passage prints.", sg), "a bare figure planted after the cap");
  ok(!ownNote(shareCapNote(1936, "SGD"), sg), "S$1,936 is not printed by S$1,936.50: cents matter");
  ok(ownNote(shareCapNote(1936.5, "SGD"), sg), "S$1,936.50 printed and named passes");
  ok(!ownNote(shareCapNote(4250, "IDR"), rp), "4,250 is not printed by Rp4.250.000");
  ok(ownNote(shareCapNote(4250000, "IDR"), rp), "Rp4.250.000 (dot thousands) prints 4,250,000");
  ok(!ownNote(shareCapNote(18000, "EUR"), "Leistung\tbis zu €1.800 je Fall"), "€18,000 is not printed by €1.800");
  ok(!ownNote(shareCapNote(25000, "SGD") + " S$1,200", page), "a figure appended after DearPolicy's wording");
  console.log(`own-notes: ${n} checks passed`);
}
main().catch((error) => { console.error(error); process.exit(1); });

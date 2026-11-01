/**
 * The short answer's word budget counts what the household reads: the lines AND the limit cards shown beside them, and
 * it holds even when there are few lines. A line kept for a part of a several-part question is held only while it is the
 * last line for that part. Made-up policies in S$, RM and £; pure: no database, no model, no network.
 *   npm run chat:concise-budget-test
 */
import assert from "node:assert/strict";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
const t = (name: string, fn: () => void) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };
const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");

async function main() {
  const { conciseDetails, MONEY_CELL } = await import("@/lib/chat/policy-answer");
  type Card = { ownerName: string | null; benefitTitle: string; amountText: string };
  const card = (benefitTitle: string, amountText: string, ownerName: string | null = "Aminah"): Card => ({ ownerName, benefitTitle, amountText });

  t("few lines but over the budget once the cards are counted: the last lines move to 'more lines'", () => {
    const details = ["Lindung Plus — Death benefit: RM500,000 (page 2).", "Lindung Plus — Annual premium: RM2,400.00 (page 2).",
      "Lindung Plus — Accidental death " + words(80) + " (page 3).", "Lindung Plus — Hospital income " + words(80) + " (page 4).", "Lindung Plus — Rider " + words(40) + " (page 5)."];
    const limits = [card("Death benefit", "RM500,000"), card("Accidental death", "RM100,000"), card("Hospital income", "RM200 a day"), card("Rider", "RM50,000")];
    conciseDetails(details, limits, { cap: 8 });
    assert.match(details[details.length - 1], /^There (?:is 1 more line|are \d+ more lines) on this/);
    assert.ok(details.length <= 5);
    const visible = details.join("\n");
    assert.ok(limits.every((l) => visible.includes(l.benefitTitle)), "no card is left for a line that moved");
  });

  t("within the budget: nothing changes", () => {
    const details = ["Thames Term — Death benefit: £250,000 (page 1).", "Thames Term — Monthly premium: £18.40 (page 1)."];
    const before = [...details]; const limits = [card("Death benefit", "£250,000", "Oliver")];
    conciseDetails(details, limits, { cap: 5 });
    assert.deepEqual(details, before); assert.equal(limits.length, 1);
  });

  t("a several-part question keeps its only premium line and its only renewal line; a second death line can move", () => {
    const premium = /\bpremium\b/i, death = /\bdeath\b/i, renewal = /\brenew/i;
    const details = ["TermCare — Annual premium: S$1,204.50 (page 2).", "TermCare — Death benefit: S$600,000 (page 2).",
      "Group booklet — Group term life death " + words(110) + " (page 3).", "TermCare — Renewal date: 1 March 2027 (page 2).",
      "Group booklet — Accidental death " + words(110) + " (page 3)."];
    conciseDetails(details, [], { cap: 8, keep: [premium, death, renewal] });
    for (const re of [premium, death, renewal]) assert.ok(details.some((d) => re.test(d)), "a line for " + re);
    assert.ok(details.some((d) => /more line/.test(d)));
    assert.ok(details.join(" ").split(/\s+/).length <= 230);
    assert.ok(!details.some((d) => d.startsWith("Group booklet — Accidental death")), "the second death line moved");
  });

  t("the last line for a part is never moved, even over the budget", () => {
    const details = ["A — Premium " + words(120) + ".", "A — Death " + words(120) + ".", "A — Renewal " + words(120) + ".", "A — Death again " + words(10) + "."];
    conciseDetails(details, [], { cap: 8, keep: [/Premium/, /Death/, /Renewal/] });
    assert.ok(details.some((d) => d.startsWith("A — Premium")) && details.some((d) => d.startsWith("A — Renewal")) && details.some((d) => /^A — Death/.test(d)));
  });

  t("a question about one thing: lines within the line cap but past its smaller budget move to 'more lines'", () => {
    // Six lines (the cap of five plus one) of about 30 words each: 180+ words before the summary.
    const details = Array.from({ length: 6 }, (_, i) => `Harbour Shield — Post-hospital line ${i}: as charged, within 365 days ` + words(22) + ` (page ${i + 1}).`);
    conciseDetails(details, [], { cap: 5 });
    assert.match(details[details.length - 1], /more line/);
    assert.ok(details.join(" ").split(/\s+/).length <= 160, "lines and the note fit the one-thing budget: " + details.join(" ").split(/\s+/).length);
  });
  t("control: the same lines for an overview (cap 8) fit its larger budget and are left whole", () => {
    const details = Array.from({ length: 6 }, (_, i) => `Harbour Shield — Line ${i}: S$${i + 1},000 ` + words(25) + ".");
    const before = [...details];
    conciseDetails(details, [], { cap: 8 });
    assert.deepEqual(details, before);
  });

  t("a row printing one figure per column is seen in any market's money (RM, £, HK$, €, Rp, CHF), so it is never a card", () => {
    const cells = (row: string) => row.split(/\t| · |\s{3,}|\s\|\s/).filter((c) => MONEY_CELL.test(c)).length;
    for (const row of ["Hospital cash per day | RM100 | RM200 | RM300", "Hospital cash per day\t£100\t£200", "Room and board · HK$1,500 · HK$2,500",
      "Room & board €100 · €200", "Daily cash Rp100.000 | Rp200.000", "Tagegeld\t100 €\t200 €", "Taggeld\tCHF 1'250\tCHF 2'500", "Ward\tS$300\tS$500"])
      assert.ok(cells(row) >= 2, row);
    assert.equal(cells("Hospital cash per day: RM100 for up to 180 days"), 1);
    assert.equal(cells("Room and board as charged, up to 30 days"), 0);
  });

  t("a full list is never cut", () => {
    const details = Array.from({ length: 30 }, (_, i) => `Plan — Benefit ${i}: S$${i + 1},000 ` + words(20) + ".");
    conciseDetails(details, [], { cap: Infinity });
    assert.equal(details.length, 30);
  });

  console.log(`\nconcise budget: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

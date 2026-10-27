/** Test engineer, PR #148 at c446c2b / 450969f (A6 corrected for #149 c252ed5): how a confirmed line joins a cover (document AND sum) and when a sum-rule tile gives no
 * total. lumpSumParts and confirmedTotalComplete on the route's path. Made-up SG, MY and UK households; synthetic only.
 *   node --import tsx scripts/coverage/te-pr148c-test.ts */
import { categoryRows, confirmedTotalComplete, lumpSumParts, tileRows, type ConfirmedLine, type HeldCover } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";

let pass = 0, fail = 0; const notes: string[] = [];
function t(id: string, ok: boolean, detail: unknown, note = false) {
  if (ok) { pass++; console.log("ok " + id); return; }
  const line = `${id}: ${JSON.stringify(detail)}`;
  if (note) { notes.push(line); console.log("NOTE " + line); } else { fail++; console.log("FAIL " + line); }
}
type R = SummaryRow & { coverKey: string; product: string; cover: string; plan: string | null; source: { documentId: string } | null };
const MARKETS = [
  { m: "SG", cur: "SGD", sign: "S$", other: "USD" },
  { m: "MY", cur: "MYR", sign: "RM", other: "SGD" },
  { m: "UK", cur: "GBP", sign: "£", other: "EUR" },
] as const;

for (const { m, cur, sign, other } of MARKETS) {
  const row = (doc: string | null, coverKey: string, benefit: string, amount: number | null, o: Partial<SummaryRow> = {}): R => ({
    coverKey, product: coverKey, cover: coverKey, plan: null, source: doc ? { documentId: doc } : null, benefit, section: null, pays: "amount",
    figure: amount == null ? { kind: "none", why: "See the page" } : { kind: "printed", amount, currency: sign, unit: "lump_sum" },
    qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o } as R);
  const line = (name: string, docs: string[], amount: number | null): ConfirmedLine & { name: string } => ({ name, documentIds: docs, amount, currency: cur });
  const held = (coverKey: string, doc: string | null, sumInsured: number | null): HeldCover => ({ coverKey, name: coverKey, documentId: doc, sumInsured, currency: sign });
  const tile = (category: string, rows: R[], lines: (ConfirmedLine & { name: string })[] = [], h: HeldCover[] = []) => lumpSumParts(tileRows(categoryRows(category, rows)), lines, h);
  const show = (r: ReturnType<typeof tile>) => ({ total: r.total, parts: r.parts.map((p) => `${p.name}=${p.amount ?? "?"} ${p.currency ?? ""}`) });
  const D = "Death";

  // J: a line joins a cover by its document AND its sum.
  const j1 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 450000)], [line("Alder Whole Life", ["d1"], 400000)]);
  t(`${m} J1 the line's document prints another sum for its cover: no total`, j1.total === null, show(j1));
  const two = [row("d1", "Alder Whole Life", "Death Benefit", 300000), row("d1", "Alder Term Rider", "Death Benefit (term rider)", 100000)];
  const j2 = tile(D, two, [line("Alder Term Rider", ["d1"], 100000)]), j2r = tile(D, [...two].reverse(), [line("Alder Term Rider", ["d1"], 100000)]);
  t(`${m} J2 a document with two covers gives the line to the cover with its sum`, j2.total === 400000 && j2.parts.length === 2, show(j2));
  t(`${m} J3 the order covers come in does not matter`, JSON.stringify(show(j2)) === JSON.stringify(show(j2r)) || (j2.total === j2r.total && j2.parts.length === j2r.parts.length), [show(j2), show(j2r)]);
  const j4 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 300000), row("d1", "Alder Whole Life Plus", "Death Benefit", 300000)], [line("Alder Whole Life", ["d1"], 300000)]);
  t(`${m} J4 two covers on the line's document with the line's sum: no total`, j4.total === null, show(j4));
  const j5 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", null)], [line("Alder Whole Life", ["d1"], 300000)]);
  t(`${m} J5 the line's cover prints no sum and states none: no total`, j5.total === null, show(j5));
  const j6 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", null)], [line("Alder Whole Life", ["d1"], 300000)], [held("Alder Whole Life", "d1", 300000)]);
  t(`${m} J6 the line's cover prints no sum but states the line's sum insured: joined, total`, j6.total === 300000 && j6.parts.length === 1, show(j6));
  const j7 = tile(D, [row("a1", "Alder Whole Life", "Death Benefit", 300000), row("b1", "Birch Term Plan", "Death Benefit", 200000)], [line("Alder Whole Life", ["a1"], 300000), line("Birch Term Plan", ["b1"], 200000)]);
  t(`${m} J7 two policies, each line on its own document: total`, j7.total === 500000 && j7.parts.length === 2, show(j7));
  const j8 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 300000, { figure: { kind: "printed", amount: 300000, currency: other, unit: "lump_sum" } })], [line("Alder Whole Life", ["d1"], 300000)]);
  t(`${m} J8 the cover prints the line's number in another currency: never a total in the line's currency`, j8.total === null, show(j8), true);

  // A: a personal accident cover prints several sums (death, and a share for each injury); its sum insured names the line's
  // (450969f: the builder found a group PA losing its sum on c446c2b; no case here covered it).
  const pa = (doc: string) => [row(doc, "Group Personal Accident", "Accidental Death Benefit", 600000),
    row(doc, "Group Personal Accident", "Accidental dismemberment: loss of one hand", 300000),
    row(doc, "Group Personal Accident", "Accidental permanent disablement: fracture of hip", 3750)];
  const a1 = tile("Personal Accident", pa("g1"), [line("Group Personal Accident", ["g1"], 600000)], [held("Group Personal Accident", "g1", 600000)]);
  t(`${m} A1 a PA cover printing several sums, sum insured equal to the line: joined, total 600,000`, a1.total === 600000 && a1.parts.length === 1, show(a1));
  const a2 = tile("Personal Accident", pa("g1"), [line("Group Personal Accident", ["g1"], 600000)], [held("Group Personal Accident", "g1", 500000)]);
  t(`${m} A2 negative control: the sum insured differs from the line: no total`, a2.total === null, show(a2));
  const a3 = tile("Personal Accident", pa("g1"), [line("Group Personal Accident", ["g1"], 600000)]);
  t(`${m} A3 negative control: several sums and no stated sum insured: no total`, a3.total === null, show(a3));
  const a4 = tile("Personal Accident", [...pa("g1"), row("g1", "Group Travel Accident", "Accidental Death Benefit", 600000)], [line("Group Personal Accident", ["g1"], 600000)],
    [held("Group Personal Accident", "g1", 600000)]);
  t(`${m} A4 another cover on the same document with the line's sum: no total`, a4.total === null, show(a4));
  const a5 = tile("Personal Accident", [...pa("g1"), row("p2", "Birch Accident Plan", "Accidental Death Benefit", 200000)], [line("Group Personal Accident", ["g1"], 600000)],
    [held("Group Personal Accident", "g1", 600000), held("Birch Accident Plan", "p2", 200000)]);
  t(`${m} A5 the PA line plus another accident policy: total 800,000`, a5.total === 800000 && a5.parts.length === 2, show(a5));
  // Grader correction (TE, #149 c252ed5): A6 expected a PA cover printing several sums, with no line, to give no amount. Original
  // grade kept: A6 passed on #148 450969f and failed on #149 c252ed5 (600,000). Reason: #149 counts a lump sum equal to the
  // cover's own stated sum insured as that sum insured, and the tile labels it "Sum insured"; 600,000 is the stated sum
  // insured, so it is not "one of them" picked at random. A6 now expects the sum insured; A6b keeps the original intent
  // where no printed sum equals the stated sum insured.
  const a6 = tile("Personal Accident", pa("g1"), [], [held("Group Personal Accident", "g1", 600000)]);
  t(`${m} A6 no line: a cover printing several sums, one equal to its sum insured: the sum insured`, a6.total === 600000 && a6.parts[0]?.amount === 600000, show(a6));
  const a6b = tile("Personal Accident", pa("g1"), [], [held("Group Personal Accident", "g1", 450000)]);
  t(`${m} A6b no line: several sums, none equal to the sum insured: no amount, never one of them`, a6b.total === null && a6b.parts[0]?.amount === null, show(a6b));
  const a7 = tile(D, [row("d1", "Alder Whole Life", "Death Benefit", 450000)], [line("Alder Whole Life", ["d1"], 400000)], [held("Alder Whole Life", "d1", 400000)]);
  t(`${m} A7 printed sum differs from a sum insured equal to the line: the line stands alone, never 850,000`, a7.total !== 850000 && a7.parts.length === 1, show(a7));

  const a8 = tile(D, [row("a1", "Alder Term Plan", "Death Benefit", 100000), row("a2", "Alder Term Plan", "Death Benefit", 200000)], [line("Alder Term Plan", ["a1"], 100000)],
    [held("Alder Term Plan", "a1", 100000), held("Alder Term Plan", "a2", 200000)]);
  t(`${m} A8 two policies of one product with different sums insured, one line: never the line's 100,000 as the whole`, a8.total !== 100000, show(a8));

  // U: the unsure cases give parts but no total.
  const u1 = tile(D, [row("s1", "Group Term Life", "Death Benefit", 400000)], [line("Group Term Life Scheme", ["c1"], 400000)]);
  t(`${m} U1 a line with no cover here and a table-only cover with its sum: no total`, u1.total === null && u1.parts.length === 2, show(u1));
  const u2 = tile(D, [row("s1", "Birch Term Plan", "Death Benefit", 250000)], [line("Alder Whole Life", ["c1"], 400000)]);
  t(`${m} U2 negative control: a line with no cover here and a table-only cover with another sum: total`, u2.total === 650000, show(u2));
  const u3 = tile(D, [row("s1", "Group Term Life", "Death Benefit", 400000), row("s2", "GTL", "Death Benefit", 400000)]);
  t(`${m} U3 one cover read under two names (Group Term Life, GTL) with one sum: no total`, u3.total === null, show(u3));
  const u4 = tile(D, [row("s1", "Group Term Life (Policy No. G-1)", "Death Benefit", 400000), row("s2", "Group Term Life", "Death Benefit", 400000)]);
  t(`${m} U4 the same name with a policy number in brackets: no total`, u4.total === null, show(u4));
  const u5 = tile(D, [row("s1", "Alder Whole Life", "Death Benefit", 400000), row("s2", "Birch Term Plan", "Death Benefit", 400000)]);
  t(`${m} U5 negative control: two names, one sum: two policies, total`, u5.total === 800000, show(u5));
  const u6 = tile(D, [row("s1", "Group Term Life", "Death Benefit", 400000), row("s2", "GTL", "Death Benefit", 300000)]);
  t(`${m} U6 negative control: the same name with different sums: two parts, total`, u6.total === 700000, show(u6), true);
  // A free line (no cover) is read before a later line that owns the equal cover by document: safe (no total), never doubled.
  const u7 = tile(D, [row("b1", "Birch Term Plan", "Death Benefit", 100000)], [line("Alder Whole Life", ["c1"], 100000), line("Birch Term Plan", ["b1"], 100000)]);
  t(`${m} U7 a free line and an owned equal cover: never more than 200,000`, u7.total === null || u7.total === 200000, show(u7));
  t(`${m} U7b the same gives the right total (200,000), not just a safe one`, u7.total === 200000, show(u7), true);

  // K: confirmedTotalComplete (non-lump-sum tiles) with held covers.
  const k = (category: string, rows: R[], lines: ConfirmedLine[], h: HeldCover[] = []) => confirmedTotalComplete(tileRows(categoryRows(category, rows)), lines, h);
  const hc = (doc: string | null, key: string, amount: number) => row(doc, key, "Daily Hospital Cash Benefit", amount, { pays: "per_day", figure: { kind: "printed", amount, currency: sign, unit: "per_day" } });
  t(`${m} K1 a cover known only by its held document takes the line: complete`, k("Hospital Cash", [hc(null, "Alder Shield", 100)], [line("x", ["d1"], 100)], [held("Alder Shield", "d1", null)]), "false");
  t(`${m} K2 negative control: no held document: part of the cover`, !k("Hospital Cash", [hc(null, "Alder Shield", 100)], [line("x", ["d1"], 100)]), "true");
  t(`${m} K3 a held cover of another key does not lend its document`, !k("Hospital Cash", [hc(null, "Alder Shield", 100)], [line("x", ["d1"], 100)], [held("Birch Shield", "d1", null)]), "true");
  t(`${m} K4 an equal amount alone never joins (P148-1)`, !k("Hospital Cash", [hc("s1", "Alder Shield", 100)], [line("x", ["c1"], 100)]), "true");
}

console.log(`\nte pr148c: ${pass} passed, ${fail} failed, ${notes.length} notes`);
if (fail) process.exit(1);

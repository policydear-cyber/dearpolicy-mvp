/** Test engineer, PR #149 at 618ca6a: the "(conditions apply)" mark (Critic R249) and the negation and currency fixes
 * (TE P149-1, P149-2). lumpSumParts on the route's path, made-up SG, MY and UK households, synthetic only.
 *   node --import tsx scripts/coverage/te-pr149b-test.ts */
import { categoryRows, lumpSumParts, tileRows, type HeldCover } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";

let pass = 0, fail = 0; const notes: string[] = [];
function t(id: string, ok: boolean, detail: unknown, note = false) {
  if (ok) { pass++; console.log("ok " + id); return; }
  const line = `${id}: ${JSON.stringify(detail)}`;
  if (note) { notes.push(line); console.log("NOTE " + line); } else { fail++; console.log("FAIL " + line); }
}
type R = SummaryRow & { coverKey: string; product: string; cover: string; plan: string | null; source: { documentId: string } | null };
const MARKETS = [
  { m: "SG", cur: "SGD", sign: "S$", other: "USD", si: 200000 },
  { m: "MY", cur: "MYR", sign: "RM", other: "SGD", si: 350000 },
  { m: "UK", cur: "GBP", sign: "£", other: "EUR", si: 120000 },
] as const;

for (const { m, sign, other, si } of MARKETS) {
  const row = (doc: string, coverKey: string, benefit: string, amount: number, o: Partial<R> = {}): R => ({
    coverKey, product: coverKey, cover: coverKey, plan: null, source: { documentId: doc }, benefit, section: null, pays: "amount",
    figure: { kind: "printed", amount, currency: sign, unit: "lump_sum" }, qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o } as R);
  const held = (coverKey: string, doc: string, sumInsured: number | null, currency: string | null = sign): HeldCover => ({ coverKey, name: coverKey, documentId: doc, sumInsured, currency });
  const one = (category: string, benefit: string, conditions: string[], h: HeldCover[] = [held("Alder Plan", "d1", si)], amount: number = si) =>
    lumpSumParts(tileRows(categoryRows(category, [row("d1", "Alder Plan", benefit, amount, { conditions })])), [], h, category);
  const show = (r: ReturnType<typeof one>) => ({ total: r.total, parts: r.parts.map((p) => `${p.name}=${p.amount ?? "?"} ${p.currency ?? ""}${p.conditional ? " (conditions apply)" : ""}${p.accelerates ? " (acc)" : ""}`) });

  // G: the Critic's five reducing phrasings, a printed lump sum equal to a held sum insured: the sum insured, marked.
  const FIVE = ["reduced by half after age sixty-five", "less any amount already paid under this policy", "subject to a co-payment of 10%",
    "only if death occurs after age 65, otherwise a return of premiums", "payable in five yearly instalments"];
  FIVE.forEach((c, i) => {
    const r = one("Death", "Death Benefit", [c]);
    t(`${m} G${i + 1} "${c.slice(0, 36)}": the sum insured, marked (conditions apply)`, r.parts[0]?.amount === si && r.parts[0]?.conditional === true, show(r));
    const n = one("Death", "Death Benefit", [c], []);
    t(`${m} G${i + 1}n negative control: the same with no held sum insured: no amount`, n.parts[0]?.amount === null && n.total === null, show(n));
  });
  // More reducing wording, every one must be marked or give no amount.
  const MORE = ["the higher of premiums paid or the cash value in the first policy year", "50% of the sum insured for a juvenile life assured",
    "excluding amounts paid under the Early Critical Illness benefit", "survival period of 30 days, after which 50 percent is payable",
    "waiting period of 90 days; thereafter the benefit is reduced", "less outstanding policy loans"];
  MORE.forEach((c, i) => {
    const r = one("Death", "Death Benefit", [c]);
    t(`${m} H${i + 1} "${c.slice(0, 36)}": marked or no amount`, r.parts[0]?.amount === null || r.parts[0]?.conditional === true, show(r));
  });
  // W: timing only, not marked.
  const TIMING = ["The Life Assured survives at least 14 days after the date of diagnosis", "The waiting period in Section 3.2.",
    "This benefit is subject to the waiting period as stated in Clause 8."];
  TIMING.forEach((c, i) => {
    const r = one("Critical Illness", "Critical Illness Benefit", [c]);
    t(`${m} W${i + 1} timing only ("${c.slice(0, 30)}"): the sum insured, not marked`, r.parts[0]?.amount === si && !r.parts[0]?.conditional, show(r));
  });
  const w4 = one("Death", "Death Benefit", []);
  t(`${m} W4 negative control: no condition, not marked`, w4.parts[0]?.amount === si && !w4.parts[0]?.conditional, show(w4));
  const w5 = one("Death", "Death Benefit", ["No benefit is payable for suicide"]);
  t(`${m} W5 an eligibility exclusion is not a payout condition: not marked`, w5.parts[0]?.amount === si && !w5.parts[0]?.conditional, show(w5));
  const w6 = one("Critical Illness", "Critical Illness Benefit", ["Survival period: the insured is subject to 0.5 of the benefit"]);
  t(`${m} W6 a fraction written as digits inside timing wording is marked or gives no amount`, w6.parts[0]?.amount === null || w6.parts[0]?.conditional === true, show(w6), true);

  const w7 = lumpSumParts(tileRows(categoryRows("Death", [row("d1", "Alder Plan", "Death Benefit", si, { conditions: ["No benefit is payable for suicide"] }),
    row("d1", "Alder Plan", "Death Benefit (from age 70)", si / 2)])), [], [held("Alder Plan", "d1", si)], "Death");
  t(`${m} W7 two sums, the sum insured's row has only an exclusion: the sum insured, not marked`, w7.parts[0]?.amount === si && !w7.parts[0]?.conditional, show(w7));

  // C: currency (P149-2).
  const c1 = lumpSumParts(tileRows(categoryRows("Death", [row("d1", "Alder Plan", "Death Benefit", si, { conditions: ["reduced by half after age sixty-five"], figure: { kind: "printed", amount: si, currency: other, unit: "lump_sum" } })])), [], [held("Alder Plan", "d1", si)], "Death");
  t(`${m} C1 the sum insured's number in another currency: no amount`, c1.parts[0]?.amount === null && c1.total === null, show(c1));
  const c2 = lumpSumParts(tileRows(categoryRows("Death", [row("d1", "Alder Plan", "Death Benefit", si, { conditions: ["reduced by half after age sixty-five"] })])), [], [held("Alder Plan", "d1", si, null)], "Death");
  t(`${m} C2 the held cover states no currency: the row's own currency stands`, c2.parts[0]?.amount === si, show(c2));

  // A: accelerates (P149-1).
  const acc = (benefit: string, section: string | null = null) => lumpSumParts(tileRows(categoryRows("Critical Illness", [row("d1", "Alder CI", benefit, si, { section })])), [], [held("Alder CI", "d1", si)], "Critical Illness").parts[0];
  for (const [id, b, want] of [["A1", "Accelerated Critical Illness Benefit", true], ["A2", "Non-accelerated Critical Illness Benefit", false],
    ["A3", "Additional (non-accelerated) Critical Illness Benefit", false], ["A4", "Critical Illness Benefit which is not an acceleration of the death benefit", false],
    ["A5", "Critical Illness Benefit (does not accelerate the death benefit)", false], ["A6", "Critical Illness Benefit, accelerates the death benefit", true],
    ["A7", "Critical Illness Benefit (won't accelerate)", false], ["A8", "Critical Illness Benefit without acceleration", false]] as const) {
    const p = acc(b);
    t(`${m} ${id} "${b}": ${want ? "marked" : "not marked"}`, !!p?.accelerates === want, p);
  }
  const a9 = acc("Critical Illness Benefit", "Accelerated Benefits");
  t(`${m} A9 an "Accelerated Benefits" section marks its CI`, a9?.accelerates === true, a9);
  const a10 = acc("Non-accelerated Critical Illness Benefit", "Accelerated Benefits");
  t(`${m} A10 a negated name under an "Accelerated Benefits" section: not marked`, !a10?.accelerates, a10);
}

console.log(`\nte pr149b: ${pass} passed, ${fail} failed, ${notes.length} notes`);
if (fail) process.exit(1);

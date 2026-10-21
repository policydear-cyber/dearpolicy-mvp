/** Scores a benefit table (scripts/benefit-table/read.ts output) against a list of expected rows. The expectations live
 * outside git with the household's data.
 *   node --import tsx scripts/benefit-table/score.ts --table <dir>/table.json --gold <gold.json> [--out SCORES.md]
 *
 * Each check names a person and one of:
 *   cover     a cover of theirs matching `match` (product, cover, plan) with sum insured `amount` (or any, if null)
 *   row       a row of theirs matching `match` (benefit, section, cover, column) whose figure is `amount`
 *   no_row    no row of theirs matching `match` whose figure is `amount` (any figure, if amount is null)
 *   empty     no covers and no rows at all */
import { readFileSync, writeFileSync } from "node:fs";
import type { BenefitTable, TableRow } from "@/lib/benefit-table/assemble";
import { figureText } from "@/lib/benefit-table/assemble";

export type Check = { id: string; person: string; kind: "cover" | "row" | "no_row" | "empty"; match?: string; amount?: number | null; why?: string };
const amountOf = (r: TableRow) => (r.figure.kind === "none" ? null : r.figure.amount);
const rowText = (r: TableRow) => [r.benefit, r.section, r.cover, r.product, r.column].filter(Boolean).join(" · ");

export function score(table: BenefitTable, checks: Check[]) {
  return checks.map((c) => {
    const person = table.people.find((p) => p.name.toLowerCase().includes(c.person.toLowerCase()));
    if (!person) return { check: c, pass: false, found: "person not in the table" };
    const re = new RegExp(c.match ?? ".", "i");
    if (c.kind === "empty") {
      const pass = !person.covers.length && !person.rows.length;
      return { check: c, pass, found: pass ? "empty" : `${person.covers.length} covers, ${person.rows.length} rows` };
    }
    if (c.kind === "cover") {
      const hits = person.covers.filter((x) => re.test([x.product, x.cover, x.plan].filter(Boolean).join(" · ")));
      const ok = hits.find((x) => c.amount == null || x.sumInsured === c.amount);
      return { check: c, pass: !!ok, found: ok ? `${ok.cover} ${ok.sumInsured ?? ""}` : hits.map((x) => `${x.cover} ${x.sumInsured ?? "none"}`).join("; ") || "no matching cover" };
    }
    const hits = person.rows.filter((r) => re.test(rowText(r)));
    if (c.kind === "row") {
      const ok = hits.find((r) => amountOf(r) === c.amount);
      return { check: c, pass: !!ok, found: ok ? `${rowText(ok)}: ${figureText(ok.figure)}` : hits.slice(0, 4).map((r) => `${rowText(r)}: ${figureText(r.figure)}`).join("; ") || "no matching row" };
    }
    const bad = hits.filter((r) => c.amount == null || amountOf(r) === c.amount);
    return { check: c, pass: !bad.length, found: bad.length ? bad.slice(0, 3).map((r) => `${rowText(r)}: ${figureText(r.figure)}`).join("; ") : "none" };
  });
}

if (process.argv[1]?.endsWith("score.ts")) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const table = (JSON.parse(readFileSync(arg("--table")!, "utf8")) as { table: BenefitTable }).table;
  const checks = (JSON.parse(readFileSync(arg("--gold")!, "utf8")) as { checks: Check[] }).checks;
  const results = score(table, checks);
  const passed = results.filter((r) => r.pass).length;
  const md = [`# Benefit table scores`, "", `${passed} of ${results.length} checks pass.`, "", "| Check | Person | Kind | Expected | Pass | Found |", "|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.check.id} | ${r.check.person} | ${r.check.kind} | ${r.check.match ?? ""} ${r.check.amount ?? ""} | ${r.pass ? "pass" : "**FAIL**"} | ${r.found.replace(/\|/g, "/").slice(0, 300)} |`)].join("\n") + "\n";
  if (arg("--out")) writeFileSync(arg("--out")!, md);
  console.log(md);
}

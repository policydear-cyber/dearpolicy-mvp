/** TE #342 (blind): benefitRowsFromText on made-up two-column schedules where the line below is (a) its own benefit or
 * (b) the wrapped rest of the row above. Prints rows; diff main vs PR. Graded: a wrapped cap/condition split off into a
 * benefit of its own (a wrong amount) is WRONG; two benefits merged is LOSS. Pure. */
(async () => {
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  const rows = (t: string) => benefitRowsFromText(t).map((r: any) => [r.label, r.value]);
  const cases: [string, string, (r: string[][]) => "ok" | "WRONG" | "LOSS"][] = [];
  const hasLabel = (r: string[][], l: string) => r.some(([x]) => x === l);
  const valOf = (r: string[][], l: string) => r.find(([x]) => x.startsWith(l))?.[1] ?? "";
  for (const c of ["RM", "S$", "£", "HK$", "A$", "NZ$", "US$"]) {
    cases.push([`${c} own rows`, `POLICY SCHEDULE\n\nIntensive care\t${c} 600 per day\nSurgical fees\tAs charged, up to ${c} 30,000\nOutpatient\tUp to ${c} 1,000`,
      (r) => hasLabel(r, "Surgical fees") && !/30,000/.test(valOf(r, "Intensive care")) ? "ok" : "LOSS"]);
    cases.push([`${c} wrapped cap on capitalised line`, `POLICY SCHEDULE\n\nHearing loss in both\t50% of the Sum Insured\nEars, up to\t${c} 100,000\nDeath\t${c} 200,000`,
      (r) => hasLabel(r, "Ears, up to") ? "WRONG" : "ok"]);
    cases.push([`${c} wrapped label then amount`, `POLICY SCHEDULE\n\nLoss of speech and\t${c} 50,000\nHearing\t\nDeath\t${c} 200,000`,
      (r) => (hasLabel(r, "Hearing") && /50,000/.test(valOf(r, "Hearing"))) ? "WRONG" : "ok"]);
    cases.push([`${c} value ends with 'or'`, `POLICY SCHEDULE\n\nRoom and board\t${c} 250 per day or\nSingle room\t${c} 400 per day\nDeath\t${c} 200,000`,
      (r) => hasLabel(r, "Single room") && !/or$/.test(valOf(r, "Room and board")) ? "WRONG" : "ok"]);
    cases.push([`${c} cap on next line, capital`, `POLICY SCHEDULE\n\nHospital cash\t${c} 100 per day\nMaximum 30 days per year\t${c} 3,000\nDeath\t${c} 200,000`,
      (r) => (hasLabel(r, "Maximum 30 days per year") ? "WRONG" : "ok")]);
    cases.push([`${c} three own rows, lump sums`, `POLICY SCHEDULE\n\nDeath\t${c} 500,000\nTotal and Permanent Disability\t${c} 500,000\nCritical Illness\t${c} 250,000`,
      (r) => ["Death", "Total and Permanent Disability", "Critical Illness"].every((l) => hasLabel(r, l)) && valOf(r, "Death") === `${c} 500,000` ? "ok" : "LOSS"]);
    cases.push([`${c} sub-limit row`, `POLICY SCHEDULE\n\nOverseas medical\tUp to ${c} 200,000\nIncluding dental\tUp to ${c} 500\nDeath\t${c} 100,000`,
      (r) => "ok"]);
  }
  let wrong = 0, loss = 0;
  for (const [id, text, grade] of cases) { const r = rows(text); const g = grade(r); if (g === "WRONG") wrong++; if (g === "LOSS") loss++;
    console.log(`${g.padEnd(5)} ${id}: ${JSON.stringify(r)}`); }
  console.log(`TE pr342 rows: WRONG ${wrong} LOSS ${loss} of ${cases.length}`);
})().catch((e) => { console.error(e); process.exit(2); });

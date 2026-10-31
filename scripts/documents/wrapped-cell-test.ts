/**
 * A two-column benefit row whose name and amount both wrap onto the next printed line is read as one row: the left
 * cell finishes the name, the right one the amount, and the row is quoted cell by cell. Made-up pages from several
 * markets; no database, no network, no model.
 */
import test from "node:test";
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

test("a wrapped two-column row: the name and the amount each finish on the next line, in any currency", async () => {
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  const cases: [string, string, string][] = [
    ["(a) Keyhole Surgery and Other Minimally Invasive Treatment for\t:\t10% of Prevailing Insured Amount, up to maximum\nBlocked Arteries\tof S$25,000\n",
      "(a) Keyhole Surgery and Other Minimally Invasive Treatment for Blocked Arteries", "10% of Prevailing Insured Amount, up to maximum of S$25,000"],
    ["Early Stage Cancer Benefit payable upon\t20% of the Sum Assured, subject to a maximum\ndiagnosis\tof RM50,000\n",
      "Early Stage Cancer Benefit payable upon diagnosis", "20% of the Sum Assured, subject to a maximum of RM50,000"],
    ["Hearing Loss in\t15% of the Sum Insured, up to\nOne Ear\t£10,000\n", "Hearing Loss in One Ear", "15% of the Sum Insured, up to £10,000"],
  ];
  for (const [page, label, value] of cases) {
    const rows = benefitRowsFromText(page);
    assert.equal(rows.length, 1, page);
    assert.equal(rows[0].label, label);
    assert.equal(rows[0].value, value);
    // Quoted cell by cell: the name, then the whole amount.
    assert.equal(rows[0].line.replace(/\s+/g, " "), label + " " + value);
  }
});

test("a next line that is a row of its own, or a name that does not run on, is not joined; the cap is never lost", async () => {
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  // A new row with its own amount stays its own row.
  const two = benefitRowsFromText("(a) Angioplasty for\t:\t10% of Sum Insured\n(b) Bypass surgery\t:\t100% of Sum Insured\n");
  assert.deepEqual(two.map((r) => r.label), ["(a) Angioplasty for", "(b) Bypass surgery"]);
  // The name is finished: the line below only finishes the amount, and is still quoted with it.
  const done = benefitRowsFromText("Broken Hip\t10% of the Sum Insured, up to\nper event\tS$5,000\n");
  assert.equal(done.length, 1);
  assert.equal(done[0].label, "Broken Hip");
  assert.match(done[0].value, /S\$5,000/);
  assert.match(done[0].line, /S\$5,000/);
  assert.equal(fetches, 0);
});

test("the row read this way keeps its share only with its printed cap (Critic R416 rules unchanged)", async () => {
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  const [row] = benefitRowsFromText("(a) Keyhole Surgery and Other Minimally Invasive Treatment for\t:\t10% of Prevailing Insured Amount, up to maximum\nBlocked Arteries\tof S$25,000\n");
  assert.deepEqual(shareBound(row.line.replace(/\t/g, " "), row.label), { kind: "cap", amount: 25000, currency: "SGD" });
  // A name that changes the amount is still read with it.
  assert.equal(shareBound("Death benefit halved for children 50% of the Sum Insured, up to S$5,000", "Death benefit halved for children").kind, "unsure");
  assert.equal(shareBound("Other Treatment, for the first claim, 10% of the Sum Insured, up to S$5,000", "Other Treatment").kind, "unsure");
});

test("a row of its own below an amount that ends in ',', 'and' or 'up to' stays its own row (TE pr234 D1)", async () => {
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  for (const page of ["Broken Arm\tS$2,000 and\nBroken Leg\tup to S$3,000\n", "Loss of Speech\t50% of the Sum Insured,\nLoss of Hearing\t50% of the Sum Insured\n",
    "Hospital Cash for\tS$100 per day, up to\nIntensive Care Unit\tS$200 per day\n"])
    assert.equal(benefitRowsFromText(page).length, 2, page);
  // Malay: the name runs on after "untuk", the cap after "sehingga maksimum".
  const [row, ...rest] = benefitRowsFromText("Rawatan Angioplasti untuk\t10% daripada Jumlah Diinsuranskan, sehingga maksimum\nArteri Koronari\tRM20,000\n");
  assert.equal(rest.length, 0);
  assert.equal(row.label, "Rawatan Angioplasti untuk Arteri Koronari");
  assert.match(row.value, /RM20,000$/);
});

test("a name that names a limit or a scope is read with its share, never taken off (TE pr234 D2)", async () => {
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  for (const name of ["Combined Limit with Surgery", "Lifetime Limit", "Per Policy Year Limit", "Maximum Aggregate", "Benefit within Plan Limit", "Benefit up to Age Limit"]) {
    assert.equal(shareBound(name + " 50% of the Sum Insured", name).kind, "unsure", name);
    assert.equal(shareBound(name + " 10% of the Sum Insured, up to S$25,000", name).kind, "unsure", name);
  }
});

test("a name | amount row under an amount that stops mid-phrase is never swallowed; every cover keeps its own row (Critic H1)", async () => {
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  for (const [page, count] of [
    ["Hearing Loss\t15% of the Sum Insured, up to\nChild Benefit\tS$5,000\nDeath Benefit\t100% of the Sum Insured\n", 3],
    ["Loss of Sight\t50% of the Sum Insured or\nLoss of Speech\t50% of the Sum Insured\n", 2],
    ["Fracture of Leg\t10% of the Sum Insured, up to maximum\nFracture of Arm\tS$5,000\n", 2],
    ["Burns\t20% of the Sum Insured, subject to a maximum\nComa\tS$50,000\n", 2],
    ["Hearing Loss in\t15% of the Sum Insured, up to\nBoth Ears\tS$20,000\nOne Ear\tS$10,000\n", 3],
    ["Kehilangan Pendengaran dalam\t15% daripada Jumlah, sehingga\nKedua-dua Telinga\tRM20,000\nSatu Telinga\tRM10,000\n", 3],
    ["Accidental Death\t100% of the Sum Insured and\nPermanent Disability\tS$100,000\n", 2],
  ] as const) {
    const rows = benefitRowsFromText(page);
    assert.equal(rows.length, count, page);
    for (const row of rows) assert.ok(!/\t/.test(row.label), page);
  }
  // Words that cannot start an amount still finish the one above, whatever row follows.
  const rows = benefitRowsFromText("Angioplasty for\t10% of the Sum Insured, up to maximum\nCoronary Artery\tof £25,000\nHeart Attack\t£50,000\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "Angioplasty for Coronary Artery");
  assert.match(rows[0].value, /of £25,000$/);
  assert.equal(fetches, 0);
});

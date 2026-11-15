/** Scripted tests: a row's section read as its number plus its label ("3 Fracture of arm, wrist or leg") is the same section
 * as its bare number ("3"). Acceptance run TE-ACC-20261115-R4: this run's reader gave the long form where R3's gave the
 * bare number, and five parsers that took only a bare number lost three right figures: the compound-fracture double
 * (multiplier.ts), a child's 25% share of accidental death (check.ts ownLabelLine, ownNote; child-limit.ts) and hospital
 * cash for each person (check.ts ownNote, assemble.ts sectionNumber). Every parser now reads a section through one helper
 * (lib/benefit-table/section-id.ts): its leading number or code, and the rest as its label. A section with no leading
 * number is read as before, and a label never makes two sections one.
 * Made-up households only. No model, database or network.
 *   npm run benefit-table:section-label-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, ownLabelLine, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import { noteMultiple } from "@/lib/benefit-table/multiplier";
import { rowSectionCode, sectionIdOf } from "@/lib/benefit-table/section-id";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const NOW = new Date("2026-11-15T04:00:00Z");
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const ACC = "55555555-5555-4555-8555-555555555555";
const DOC = "eeeeeeee-0000-4000-8000-0000000000a4";
const PEOPLE = { a: "Amaka Bello", b: "Tunde Bello", c: "Zara Bello" };
const LABELS = ["Accidental death", "Permanent total disablement", "Fracture of arm, wrist or leg", "Fracture of skull, spine or pelvis", "Hospital cash", "Medical expenses"];
const CELL = "100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured.";
const CHILD = "For an insured child under 18, limited to 25% of the Sum Insured.";
const NOTE = "Note (a): a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident.";

/** How the reader writes row N's section: R3's bare number, R4's number plus label, and other printed forms. */
const STYLES: Record<string, ((n: number, label: string) => string | null) | undefined> = {
  bare: (n) => String(n),
  long: (n, l) => `${n} ${l}`,
  dotted: (n, l) => `${n}. ${l}`,
  dashed: (n, l) => `${n} – ${l}`,
  word: (n, l) => `Section ${n} ${l}`,
  colon: (n, l) => `SECTION ${n}: ${l.toUpperCase()}`,
};

/** A synthetic family accident schedule (the shape of the acceptance households, made-up insurer and people), read as the
 * R4 reader read it: the child's share as a condition on the death row, no column row, and each row's section written by
 * `style`. `note` is the footnote printed under row 3; `section` overrides one row's section. */
function schedule(style: (n: number, label: string) => string | null, o: { note?: string; section?: Record<number, string | null>; skullNote?: boolean } = {}) {
  const note = o.note ?? NOTE;
  const page1 = ["Northgate Assurance plc", "FAMILY PERSONAL ACCIDENT POLICY - SCHEDULE", "Policy number: NGA-0001-X\tPeriod of insurance: 1 March 2026 to 28 February 2027\tCurrency",
    "of this policy: Pounds sterling (GBP)", "Date of issue: 20 February 2026", "Insured person\tRelationship\tDate of birth\tSum Insured",
    `${PEOPLE.a}\tPolicyholder\t14/06/1984\tGBP 100,000`, `${PEOPLE.b}\tSpouse\t02/11/1982\tGBP 80,000`, `${PEOPLE.c}\tChild\t09/04/2017\tGBP 20,000`,
    "Annual premium: GBP 312.00, payable by monthly direct debit of GBP 26.00."].join("\n");
  const rows = [`1\tAccidental death\t${CELL}`, "2\tPermanent total disablement\t100% of the Sum Insured",
    "3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)", "4\tFracture of skull, spine or pelvis\t5% of the Sum Insured per accident",
    "5\tHospital cash\tGBP 50 per day in hospital, payable from the third consecutive day, up to 30 days per accident", "6\tMedical expenses\tUp to GBP 2,500 per accident, after an excess of GBP 100 per claim"];
  const noteLines = note.length > 100 ? [note.slice(0, note.lastIndexOf(" ", 100)), note.slice(note.lastIndexOf(" ", 100) + 1)] : [note];
  const page2 = ["TABLE OF BENEFITS (all amounts in GBP)", "Section\tBenefit\tAmount payable", ...rows, ...noteLines,
    "Exclusions: injury while taking part in motor racing or professional sport; self-inflicted injury.",
    "How to claim: notify Northgate Assurance within 30 days of the accident on 0800 000 0000", "(claims line) and send the completed claim form with the original hospital discharge summary."].join("\n");
  const product = "FAMILY PERSONAL ACCIDENT POLICY";
  const people = [[PEOPLE.a, "self", "Policyholder\t14/06/1984\tGBP 100,000", 100000], [PEOPLE.b, "spouse", "Spouse\t02/11/1982\tGBP 80,000", 80000], [PEOPLE.c, "child", "Child\t09/04/2017\tGBP 20,000", 20000]] as const;
  const d: Household["documents"][number] = { policyId: DOC, name: "Northgate-Family-PA-Schedule.pdf", insurer: "Northgate Assurance plc", productName: product, policyNumber: "NGA-0001-X", documentType: null,
    documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: people.map((p) => p[0]), supersededAt: null,
    processingStatus: "ready", pages: [page1, page2].map((text, i) => ({ page: i + 1, text })) };
  const house: Household = { accountId: ACC, members: people.map((p) => ({ name: p[0], relationship: p[1] })), documents: [d] };
  const family: FamilyMember[] = people.map((p, i) => ({ id: `m${i}`, display_name: p[0], relationship: p[1], date_of_birth: null }));
  const sec = (n: number) => (o.section && n in o.section ? o.section[n] : style(n, LABELS[n - 1]));
  const r = (x: Record<string, unknown>) => ({ cap: null, page: 2, basis: null, column: null, period: null, capQuote: null, baseQuote: null, baseAmount: null, percentOf: null, conditions: [], ...x });
  const benefits = [
    r({ pays: "percent", quote: rows[0], value: 100, benefit: LABELS[0], forWhom: "some_insured", section: sec(1), percentOf: "sum_insured", conditions: [CHILD] }),
    r({ pays: "percent", quote: rows[1], value: 100, benefit: LABELS[1], section: sec(2), percentOf: "sum_insured" }),
    r({ cap: 1500, pays: "percent", quote: rows[2], value: 2, benefit: LABELS[2], forWhom: "some_insured", section: sec(3), capQuote: "maximum GBP 1,500 per accident", percentOf: "sum_insured",
      conditions: ["note (a)", note] }),
    // skullNote: the reader also attaches note (a) to the skull row (section-label gate SL-H1).
    r({ pays: "percent", quote: rows[3], value: 5, benefit: LABELS[3], section: sec(4), percentOf: "sum_insured", conditions: o.skullNote ? [note] : [] }),
    // forWhom is given on rows 5 and 6 (R3's reading had it; R4's left it out, a separate cause of H1-C not tested here).
    r({ pays: "per_day", quote: rows[4], value: 50, benefit: LABELS[4], forWhom: "each_named_insured", fromDay: 3, maxDays: 30, section: sec(5),
      conditions: ["payable from the third consecutive day, up to 30 days per accident"] }),
    r({ pays: "up_to", quote: rows[5], value: 2500, benefit: LABELS[5], forWhom: "each_named_insured", section: sec(6), conditions: ["after an excess of GBP 100 per claim"] }),
  ];
  const src: SourceDoc = { id: d.policyId, name: d.name, readable: true, pages: d.pages };
  const reading = checkReading(src, { document: { kind: "personal_proof", plan: null, insurer: d.insurer, product, periodTo: "28 February 2027", periodFrom: "1 March 2026", namedPeople: people.map((p) => p[0]) },
    covers: people.map((p) => ({ asOf: "20 February 2026", page: 1, plan: null, cover: "Personal accident", quote: `${p[0]}\t${p[2]}`, person: p[0], endDate: "28 February 2027", product,
      startDate: "1 March 2026", sumInsured: p[3], policyNumber: "NGA-0001-X" })), benefits });
  const key = coverKeyOf({ product, cover: "Personal accident", plan: null, riderOf: null });
  const links = [...new Set(reading.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: key, why: "the schedule's table of benefits" }));
  const table = assembleTable([reading], family, links, [], NOW);
  return { house, rows: chatRows(table, house), reading, table };
}
type H = ReturnType<typeof schedule>;
/** Each person's figure for a benefit as the table shows it ("none" when none, "-" when the row is not theirs). */
const figs = (h: H, benefit: RegExp) => Object.values(PEOPLE).map((n) => {
  const rs = h.table.people.find((p) => p.name === n)?.rows.filter((x) => benefit.test(x.benefit)) ?? [];
  return rs.length ? rs.map((x) => x.figure.kind === "none" ? "none" : String(x.figure.amount)).join(",") : "-";
});
/** Every person's figure for every benefit: what must not differ between section styles. */
const all = (h: H) => LABELS.map((l) => `${l}: ${figs(h, new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).join(" / ")}`);
/** The scripted model's reply naming one person's row (with `note` as its "multiplierNote"), through the row step, the
 * chat's checks and the label check, as the app's turn does. */
function ask(h: H, person: string, benefit: RegExp, question: string, note = "", earlier: string[] = []) {
  const row = h.rows.find((r) => r.person === person && benefit.test(r.benefit) && r.figure.kind !== "none");
  if (!row) return { amounts: [] as string[], basis: "", leftOut: true };
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" }, multiplierNote: note }] };
  const before = [...earlier].reverse();
  const fromRows = amountsFromRows(raw, h.rows, h.house, NOW, question, before, false);
  const { answer, report } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question, ...before], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  const cards = kept.filter((s) => s.amount && s.personName === person);
  return { amounts: cards.map((s) => s.amount!.text), basis: cards[0]?.basis ?? "", leftOut: fromRows.report.dropped.length > 0 || report.dropped.some((d) => d.kind === "amount") };
}
const compound = (h: H) => ask(h, PEOPLE.c, /Fracture of arm/, "It was a compound fracture.", NOTE, ["Zara broke her arm at school. What can we claim?"]);
const death = (h: H, who: string) => ask(h, who, /Accidental death/, `If ${who.split(" ")[0]} died in an accident, how much would the policy pay?`);
const hospital = (h: H, who: string) => ask(h, who, /Hospital cash/, `${who.split(" ")[0]} was in hospital for 5 days after an accident. What does the policy pay?`);

/** What main (1063534a) gives for the schedule read with label-only sections (no number), recorded from main. */
const MAIN_LABEL_ONLY = {
  death: ["none", "none", "none"],
  hospital: ["-", "-", "-"],
  all: ["Accidental death: none / none / none", "Permanent total disablement: 100000 / 80000 / 20000", "Fracture of arm, wrist or leg: 1500 / 1500 / 400",
    "Fracture of skull, spine or pelvis: 5000 / 4000 / 1000", "Hospital cash: - / - / -", "Medical expenses: - / - / -"],
};
// ---------- The helper ----------
test("the helper reads a section's leading number or code, and the rest as its label", () => {
  const id = (s: string | null) => { const x = sectionIdOf(s); return x && [x.code, x.number, x.label]; };
  assert.deepEqual(id("3"), ["3", 3, ""]);
  assert.deepEqual(id("3."), ["3", 3, ""]);
  assert.deepEqual(id("Section 3"), ["3", 3, ""]);
  assert.deepEqual(id("3 Fracture of arm, wrist or leg"), ["3", 3, "Fracture of arm, wrist or leg"]);
  assert.deepEqual(id("3. Fracture of arm, wrist or leg"), ["3", 3, "Fracture of arm, wrist or leg"]);
  assert.deepEqual(id("3 – Fracture of arm, wrist or leg"), ["3", 3, "Fracture of arm, wrist or leg"]);
  assert.deepEqual(id("3) Fracture"), ["3", 3, "Fracture"]);
  assert.deepEqual(id("Section 3 Personal accident"), ["3", 3, "Personal accident"]);
  assert.deepEqual(id("SECTION 2 - MEDICAL BENEFITS"), ["2", 2, "MEDICAL BENEFITS"]);
  assert.deepEqual(id("BENEFIT 2: GROUP PERSONAL ACCIDENT"), ["2", 2, "GROUP PERSONAL ACCIDENT"]);
  assert.deepEqual(id("Item 4\tBurns"), ["4", 4, "Burns"]);
  assert.deepEqual(id("3.1 Simple fracture"), ["3.1", null, "Simple fracture"]);
  assert.deepEqual(id("3(a) Compound fracture"), ["3(a)", null, "Compound fracture"]);
  assert.deepEqual(id("2B Hospital cash"), ["2B", null, "Hospital cash"]);
  // No leading section number: null, and the caller keeps its own handling.
  for (const s of [null, "", "Personal accident", "A", "Section A", "Benefits", "24 hour accident cover", "18 years and over", "50% co-insurance", "1,000 cover",
    "2.5 times the sum insured", "2nd schedule", "2026 cover", "3 x sum insured", "100 days in hospital"])
    assert.equal(sectionIdOf(s), null, JSON.stringify(s));
});

// ---------- The three figures: R3's bare sections and R4's long sections give the same ----------
const bare = schedule(STYLES.bare!);
test("R3-style bare sections: £800 compound double, child £5,000, hospital cash for each person (the baseline)", () => {
  assert.match(compound(bare).basis, /this pays £800 \(double\)/);
  assert.deepEqual(compound(bare).amounts, ["£400"]);
  assert.deepEqual(figs(bare, /^Accidental death/), ["100000", "80000", "5000"]);
  assert.deepEqual(death(bare, PEOPLE.c).amounts, ["£5,000"]);
  assert.deepEqual(figs(bare, /^Hospital cash/), ["50", "50", "50"]);
  assert.deepEqual(bare.reading.plainBlockers, []);
  assert.deepEqual(bare.reading.lifeNotes, []);
});
for (const [name, style] of Object.entries(STYLES)) {
  if (name === "bare") continue;
  test(`${name} sections (${JSON.stringify(style!(3, LABELS[2]))}) give the same three figures as bare ones`, () => {
    const h = schedule(style!);
    // HIGH 1: the compound-fracture double (multiplier.ts noteMultiple).
    const c = compound(h);
    assert.deepEqual(c.amounts, ["£400"]);
    assert.match(c.basis, /this pays £800 \(double\)/, c.basis);
    assert.equal(c.basis, compound(bare).basis);
    // HIGH 2: the child's 25% share of accidental death (check.ts ownLabelLine; child-limit.ts).
    assert.deepEqual(figs(h, /^Accidental death/), ["100000", "80000", "5000"]);
    assert.deepEqual(death(h, PEOPLE.c).amounts, ["£5,000"]);
    assert.deepEqual(death(h, PEOPLE.a).amounts, ["£100,000"]);
    const ad = h.reading.benefits.find((b) => b.benefit === "Accidental death")!;
    assert.deepEqual([ad.childLimit?.percent, ad.childLimit?.belowAge], [25, 18]);
    // HIGH 3: note (a) is row 3's own (check.ts ownNote), and hospital cash shows for each person (assemble.ts sectionNumber).
    assert.deepEqual(h.reading.plainBlockers, []);
    assert.deepEqual(h.reading.lifeNotes, []);
    assert.deepEqual(figs(h, /^Hospital cash/), ["50", "50", "50"]);
    assert.deepEqual(hospital(h, PEOPLE.b).amounts, hospital(bare, PEOPLE.b).amounts);
    // And nothing else differs.
    assert.deepEqual(all(h), all(bare));
  });
}
test("noteMultiple: the same note and row give the same multiple with the section bare or with its label", () => {
  const own = "Fracture of arm, wrist or leg\n3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)";
  const others = "Accidental death\nPermanent total disablement\nFracture of skull, spine or pelvis\nHospital cash\nMedical expenses";
  const want = noteMultiple(NOTE, { own, section: "3", cap: 1500, others });
  assert.deepEqual([want?.times, want?.keepsCap], [2, true]);
  for (const style of Object.values(STYLES)) assert.deepEqual(noteMultiple(NOTE, { own, section: style!(3, LABELS[2]), cap: 1500, others }), want);
});

// ---------- Negative controls ----------
test("two different sections sharing a label word never match: a note naming Section 4 is not row 3's", () => {
  const own = "Fracture of arm, wrist or leg\n3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)";
  const other = NOTE.replace("Section 3", "Section 4");
  for (const style of Object.values(STYLES)) {
    // Row 3 under its own section never takes a note about Section 4, though both labels say "Fracture".
    assert.equal(noteMultiple(other, { own, section: style!(3, LABELS[2]), cap: 1500, others: "" }), null);
    // Row 4's long section shares the word "Fracture" with row 3's; a note naming Section 3 is still not row 4's.
    assert.equal(noteMultiple(NOTE, { own: own.replace(/3\t/, "4\t"), section: style!(4, LABELS[3]), cap: 1500, others: "" }), null);
  }
  for (const name of ["bare", "long", "word"]) {
    const h = schedule(STYLES[name]!, { note: other });
    // The note under row 3 names another section, so it is not row 3's own: it blocks the plain table, and no £800.
    assert.ok((h.reading.plainBlockers ?? []).length > 0, name);
    assert.doesNotMatch(compound(h).basis, /£800/, name);
  }
});
test("a line whose leading number is another section's is never the row's own line, whatever the section's label", () => {
  const line = `2\tAccidental death\t${CELL}`;
  for (const style of Object.values(STYLES)) {
    assert.equal(ownLabelLine(line, "Accidental death", style!(1, "Accidental death")), false);
    assert.equal(ownLabelLine(`1\tAccidental death\t${CELL}`, "Accidental death", style!(1, "Accidental death")), true);
  }
  // A section with a label that shares the benefit's words but another number: not the row's own line.
  assert.equal(ownLabelLine(`1\tAccidental death\t${CELL}`, "Accidental death", "2 Accidental death"), false);
});
test("a section with no leading number behaves as on main", () => {
  // No section number: a line led by a number is not provably the row's own (main: own is undefined).
  assert.equal(ownLabelLine(`1\tAccidental death\t${CELL}`, "Accidental death", "Accidental death"), false);
  assert.equal(ownLabelLine(`1\tAccidental death\t${CELL}`, "Accidental death", "Personal accident"), false);
  // A row with no section number: a note naming a section is never its own (main: sectionKey of the whole heading).
  const own = "Fracture of arm, wrist or leg\n3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)";
  for (const section of ["Fracture of arm, wrist or leg", "Personal accident", "Benefits"]) assert.equal(noteMultiple(NOTE, { own, section, cap: 1500, others: "" }), null, section);
  // The whole schedule with label-only sections: as on main, none of the three figures (and nothing new) shows.
  const h = schedule((_n, l) => l);
  assert.doesNotMatch(compound(h).basis, /£800/);
  assert.deepEqual(figs(h, /^Accidental death/), MAIN_LABEL_ONLY.death);
  assert.deepEqual(figs(h, /^Hospital cash/), MAIN_LABEL_ONLY.hospital);
  assert.deepEqual(all(h), MAIN_LABEL_ONLY.all);
});

// ---------- Section-label gate, round 1 ----------
/** Note (a) with no figure: nothing but its section number ties it to row 3. */
const BARE_NOTE = "Note (a): a compound fracture is paid at double the Section 3 amount.";
/** Cover headings and readings that carry the number 3 over row 4 (whose own line starts with 4). */
const HEADINGS_3 = ["Section 3 Personal accident", "SECTION 3 - FRACTURES", "Part 3 Fractures", "3 Personal accident", "3 Fracture of skull, spine or pelvis"];
const skull = (h: H, who: string) => ask(h, who, /Fracture of skull/, "It was a compound fracture of the skull.", BARE_NOTE, [`${who.split(" ")[0]} fractured her skull. What can we claim?`]);
test("SL-H1: a heading's number is never row 4's own: 'double the Section 3 amount' never doubles the skull row", () => {
  const SKULL = "Fracture of skull, spine or pelvis\n4\tFracture of skull, spine or pelvis\t5% of the Sum Insured per accident";
  for (const section of [...HEADINGS_3, "4 Fracture of skull, spine or pelvis", "4", "Personal accident"]) {
    assert.equal(noteMultiple(BARE_NOTE, { own: SKULL, section, cap: null, others: "" }), null, section);
    // With the skull row's line not read (no leading number), a heading carrying another label is still not its own.
    if (!/Fracture of skull/.test(section) && section !== "4") assert.equal(noteMultiple(BARE_NOTE, { own: "Fracture of skull, spine or pelvis\n5% of the Sum Insured per accident", section, cap: null, others: "" }), null, section);
    for (const who of [PEOPLE.c, PEOPLE.b]) {
      const h = schedule(STYLES.bare!, { note: BARE_NOTE, skullNote: true, section: { 4: section } });
      const a = skull(h, who);
      assert.doesNotMatch(a.basis, /double|£2,000|£8,000/, `${section} ${who}: ${a.basis}`);
    }
  }
  // The row's own line decides over the heading: "Section 3 Personal accident" over row 4's line "4\t..." is 4.
  assert.equal(rowSectionCode("Section 3 Personal accident", "Fracture of skull, spine or pelvis", "4\tFracture of skull, spine or pelvis\t5%"), "4");
  // With no line, a heading's code is the row's only when the heading's label is the row's own label, or there is none.
  assert.equal(rowSectionCode("Section 3 Personal accident", "Fracture of skull, spine or pelvis"), null);
  assert.equal(rowSectionCode("3 Fracture of skull, spine or pelvis", "Fracture of skull, spine or pelvis"), "3");
  assert.equal(rowSectionCode("Section 3", "Fracture of skull, spine or pelvis"), "3");
  assert.equal(rowSectionCode("Personal accident", "Fracture of skull, spine or pelvis", "4\tFracture"), null);
});
test("SL-H1: the arm row (its own line starts with 3) under the same headings keeps its own double, as with a bare 3", () => {
  const want = compound(schedule(STYLES.bare!, { skullNote: true })).basis;
  assert.match(want, /£800 \(double\)/);
  for (const section of ["Section 3 Personal accident", "SECTION 3 - FRACTURES", "Part 3 Fractures", "3 Fracture of arm, wrist or leg"])
    assert.equal(compound(schedule(STYLES.bare!, { skullNote: true, section: { 3: section } })).basis, want, section);
});
test("SL-L1: figure-like headings are never section codes", () => {
  for (const s of ["24-hour cover", "18-64 year olds", "2-day", "50 per day", "1 000 benefit", "6 Monthly benefit", "4 Wheel drive cover", "2 adults and 2 children", "2x Weekly benefit",
    "24 – hour cover", "3 daily benefit", "2 x sum insured", "5 per accident", "12 annual benefit", "3 thousand cover"])
    assert.equal(sectionIdOf(s), null, s);
  // And real codes still read.
  for (const [s, code] of [["3 X-ray benefit", "3"], ["2B Hospital cash", "2B"], ["SECTION 2 - MEDICAL BENEFITS", "2"], ["4 Burns", "4"]] as const) assert.equal(sectionIdOf(s)?.code, code, s);
});

// ---------- Report ----------
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`section-label-test: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`section-label-test: ${passed} passed, 0 failed`);

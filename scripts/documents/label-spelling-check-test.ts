/** Page cross-check: two readings of one printed line agree when only the spacing of its words or an I/l swap differs
 * (live 13 Nov: a schedule's two rider lines, "AccidentDeath&DismembermentIII" and "Medical Reimbursement III", were held
 * back as "[amount not checked]" on a re-read whose image reading printed every one of their figures, so both riders lost
 * their sums). Every figure must still match in place, and the letters must still be the same letters in the same order.
 * Made-up documents in several markets; pure logic, no database, network or model.
 *   npm run -s documents:label-spelling-check-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => unknown) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { checkLines, NOT_CHECKED } = await import("@/lib/documents/layout-check");
  /** The stored line that starts with `head`, after the check. */
  const stored = (text: string, image: string, head: string) => {
    const r = checkLines(text, image, 3);
    const out = r.agree ? text : r.text;
    return (out ?? "").split("\n").find((l) => l.startsWith(head)) ?? "(page unchecked)";
  };
  const kept = (text: string, image: string, head: string) => {
    const line = stored(text, image, head);
    assert.ok(!line.includes(NOT_CHECKED) && line !== "(page unchecked)", `expected "${head}" kept word for word, got: ${line}`);
  };
  const held = (text: string, image: string, head: string) => {
    const line = stored(text, image, head);
    assert.ok(line.includes(NOT_CHECKED) || line === "(page unchecked)", `expected "${head}" held back, got: ${line}`);
  };

  // A component table as several insurers print it: name, status, sum, premium, dates. Fictitious names and figures.
  const page = (rows: string[]) => [
    "Benefit Details:", "Policy Number:\t70112233\tPlan Type:\tHarbour Flexi Saver (Series 2)", "Basic Plan\tStatus\tSum Assured\tBasic Premium",
    "Harbour Flexi Saver\tIn Force\t24,000.00\t88.10", "Component\tStatus\tSum Assured\tComponent Premium\tCover Start Date\tCover Expiry Date",
    ...rows, "Example Assurance (Pte) Limited\tCONFIDENTIAL"].join("\n");
  const sp = (l: string) => l.replace(/\t/g, " ");
  const ATI = "Accelerated Terminal Illness\tIn Force\t24,000.00\t0.00\t02-Mar-2015\t02-Mar-2040";
  const ADD = "AccidentDeath&DismembermentIII\tManual Lapse\t10,000.00\t1.53\t02-Mar-2015\t02-Mar-2040";
  const MR = "Medical Reimbursement III\tManual Lapse\t1,000.00\t2.13\t02-Mar-2015\t02-Mar-2040";
  const text = page([ATI, ADD, MR]);

  // ---- Kept: the same line, spaced or spelled as an image reader prints it ----
  await test("K1 glued name in the text, spaced in the image", () => kept(text,
    page([sp(ATI), "Accident Death & Dismemberment III Manual Lapse 10,000.00 1.53 02-Mar-2015 02-Mar-2040", sp(MR)]), "AccidentDeath"));
  await test("K2 Roman numeral read as 'Ill'", () => kept(text,
    page([sp(ATI), sp(ADD), "Medical Reimbursement Ill Manual Lapse 1,000.00 2.13 02-Mar-2015 02-Mar-2040"]), "Medical Reimbursement"));
  await test("K3 Roman numeral read as 'IIl' and glued", () => kept(text,
    page([sp(ATI), "AccidentDeath&DismembermentIIl Manual Lapse 10,000.00 1.53 02-Mar-2015 02-Mar-2040", sp(MR)]), "AccidentDeath"));
  await test("K4 the numeral as one character (Ⅲ)", () => kept(text,
    page([sp(ATI), sp(ADD), "Medical Reimbursement Ⅲ Manual Lapse 1,000.00 2.13 02-Mar-2015 02-Mar-2040"]), "Medical Reimbursement"));
  await test("K5 spaced in the text, glued in the image", () => {
    const t = page([ATI, "Hospital Cash Plus II\tIn Force\t100.00\t3.20\t02-Mar-2015\t02-Mar-2040"]);
    kept(t, page([sp(ATI), "HospitalCashPlusII In Force 100.00 3.20 02-Mar-2015 02-Mar-2040"]), "Hospital Cash");
  });
  await test("K6 a ringgit schedule, 'Pelan Perubatan II' read as 'Pelan Perubatan Il'", () => {
    const t = "Jadual Polisi\nManfaat\tJumlah Diinsuranskan (RM)\nPelan Perubatan II\t150,000.00\nKematian\t200,000.00";
    kept(t, "Jadual Polisi\nManfaat Jumlah Diinsuranskan (RM)\nPelan Perubatan Il 150,000.00\nKematian 200,000.00", "Pelan Perubatan");
  });
  await test("K7 a pound schedule with a hyphenated name spaced differently", () => {
    const t = "Schedule\nIn-Patient Cover\t£ 50,000.00\nOut-Patient Cover\t£ 1,500.00";
    kept(t, "Schedule\nIn Patient Cover £50,000.00\nOutPatient Cover £1,500.00", "Out-Patient");
  });

  // ---- Held back: a different figure, other letters, or words moved across a figure ----
  await test("H1 same name, a different sum in the image", () => held(text,
    page([sp(ATI), "Accident Death & Dismemberment III Manual Lapse 100,000.00 1.53 02-Mar-2015 02-Mar-2040", sp(MR)]), "AccidentDeath"));
  await test("H2 a different numeral (II for III) is another rider", () => held(text,
    page([sp(ATI), sp(ADD), "Medical Reimbursement II Manual Lapse 1,000.00 2.13 02-Mar-2015 02-Mar-2040"]), "Medical Reimbursement"));
  await test("H3 two riders' sums swapped in the image", () => {
    const img = page([sp(ATI), "Accident Death & Dismemberment III Manual Lapse 1,000.00 2.13 02-Mar-2015 02-Mar-2040",
      "Medical Reimbursement III Manual Lapse 10,000.00 1.53 02-Mar-2015 02-Mar-2040"]);
    held(text, img, "AccidentDeath"); held(text, img, "Medical Reimbursement");
  });
  await test("H4 words in another order", () => {
    const t = page([ATI, "Accidental Death\tIn Force\t50,000.00\t4.00\t02-Mar-2015\t02-Mar-2040"]);
    held(t, page([sp(ATI), "Death Accidental In Force 50,000.00 4.00 02-Mar-2015 02-Mar-2040"]), "Accidental Death");
  });
  await test("H5 a word moved to the other side of a figure", () => {
    const t = "Schedule\nPlan A\t5,000.00\tBasic\nPlan B\t9,000.00\tBasic";
    held(t, "Schedule\nPlan 5,000.00 A Basic\nPlan B 9,000.00 Basic", "Plan A");
  });
  await test("H6 a line the image leaves out stays held", () => held(text, page([sp(ATI), sp(MR)]), "AccidentDeath"));
  await test("H7 other letters, not an I/l swap ('Ilness' is not 'Illness' read twice)", () => {
    const t = page(["Critical Illness\tIn Force\t30,000.00\t0.00\t02-Mar-2015\t02-Mar-2040"]);
    held(t, page(["Critical Ilness In Force 30,000.00 0.00 02-Mar-2015 02-Mar-2040"]), "Critical Illness");
  });

  await test("H8 'Plan L' and 'Plan I' swapped in the image are two plans, not one (Critic)", () => {
    const t = "Schedule\nPlan L\t300,000.00\nPlan I\t900,000.00";
    const img = "Schedule\nPlan I 300,000.00\nPlan L 900,000.00";
    held(t, img, "Plan L"); held(t, img, "Plan I");
  });
  await test("H9 'Rider LL' is not 'Rider II'", () => {
    const t = "Schedule\nRider LL\t5,000.00\nRider II\t8,000.00";
    const img = "Schedule\nRider II 5,000.00\nRider LL 8,000.00";
    held(t, img, "Rider LL"); held(t, img, "Rider II");
  });
  await test("H10 an all-lower-case 'lll' is not read as III (letters, not a mixed numeral)", () => {
    const t = page(["Plan III\tIn Force\t5,000.00\t0.00\t02-Mar-2015\t02-Mar-2040"]);
    held(t, page(["Plan lll In Force 5,000.00 0.00 02-Mar-2015 02-Mar-2040"]), "Plan III");
  });
  await test("H11 'Still Birth' is not 'StiII Birth' swapped with another plan", () => {
    const t = "Schedule\nStill Birth\t2,000.00\nStiII Birth\t4,000.00";
    held(t, "Schedule\nStiII Birth 2,000.00\nStill Birth 4,000.00", "Still Birth");
  });

  console.log(`label-spelling check: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

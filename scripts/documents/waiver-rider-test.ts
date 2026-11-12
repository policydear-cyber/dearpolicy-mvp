/** A premium-waiver rider is never a cover amount (Live tester, 12 Nov: two waiver riders on a schedule were stored as
 * "Critical Illness" and "Early Critical Illness" covers whose figure was the premium they waive). At intake the rider's
 * line is kept with no amount and a fixed note; the policy's real covers on the same page keep theirs. Made-up documents,
 * no database, network or model.
 *   npm run -s documents:waiver-rider-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { namesWaiverRider, WAIVER_RIDER_NOTE } = await import("@/lib/documents/waiver-rider");
  const FC = await import("@/lib/documents/fact-check");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");

  // ---- N: names
  const waivers = ["Crisis Waiver III", "Early Stage Crisis Waiver", "Waiver of Premium Rider", "Premium Waiver (TPD)", "Payor Benefit", "Payer Rider",
    "Premium Eraser", "Enhanced Payor Benefit II", "WAIVER OF PREMIUM - CRITICAL ILLNESS", "Pengecualian Premium Penyakit Kritikal", "保费豁免附加险"];
  for (const n of waivers) await test(`N waiver rider: ${n}`, () => assert.equal(namesWaiverRider(n), true, n));
  const covers = ["Critical Illness Plus", "Excess Waiver", "Waiver of Deductible", "Collision Damage Waiver", "Critical Illness Benefit with Premium Waiver",
    "Term Life incl. Waiver of Premium", "Sum assured S$100,000 (future premiums waived on diagnosis)", "Early Crisis Cover", "Premium Plan", "Payout Plan"];
  for (const n of covers) await test(`N not a waiver rider: ${n}`, () => assert.equal(namesWaiverRider(n), false, n));
  await test("N null and empty name nothing", () => { assert.equal(namesWaiverRider(null, undefined, ""), false); });

  // ---- I: intake (the fact check every reading passes through)
  const PERSON = "Tan Mei Ling Rachel";
  const page = [{ pageNumber: 2, text: [
    "POLICY SCHEDULE (fictitious)", `Life Assured\t${PERSON}`, "Benefit\tSum Assured (S$)\tAnnual Premium (S$)",
    "Lotus Life Protect\t100,000.00\t1,820.00", "Lotus Crisis Cover\t50,000.00\t610.40", "Lotus Crisis Waiver II\t-\t150.00",
    "Lotus Early Stage Crisis Waiver\t-\t160.08", "Waiver of Premium (Payor)\t-\t88.20",
  ].join("\n") }];
  const coverage = (category: string, productName: string | null, amount: number, evidenceText: string) =>
    ({ category, productName, policyNumber: null, amount, currency: "SGD", notes: null, sourcePage: 2, evidenceText, evidenceVerified: true });
  const extraction = (coverages: ReturnType<typeof coverage>[]) => PolicyExtractionSchema.parse({
    documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: "Lotus Life (fictitious)", productName: "Lotus Life Protect", productsMentioned: ["Lotus Life Protect"],
    policyNumber: "LL-0042", groupPolicyNumber: null, policyType: "Whole Life", policyholder: null, personalCoverageConfirmed: true, startDate: null, renewalOrExpiryDate: null,
    insuredPeople: [{ name: PERSON, relationshipHint: "self", coverages }],
    referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  });
  const checked = (c: ReturnType<typeof coverage>[]) => FC.factCheckExtraction(extraction(c), page).extraction.insuredPeople[0].coverages;

  await test("I1 a crisis waiver read as Critical Illness keeps its line, with no amount and the fixed note", () => {
    const [c] = checked([coverage("Critical Illness", "Lotus Crisis Waiver II", 150, "Lotus Crisis Waiver II\t-\t150.00")]);
    assert.equal(c.amount, null); assert.equal(c.category, "Critical Illness"); assert.ok((c.notes ?? "").includes(WAIVER_RIDER_NOTE), String(c.notes));
  });
  await test("I2 an early-stage crisis waiver with a decimal premium: no amount", () => {
    const [c] = checked([coverage("Early Critical Illness", "Lotus Early Stage Crisis Waiver", 160.08, "Lotus Early Stage Crisis Waiver\t-\t160.08")]);
    assert.equal(c.amount, null);
  });
  await test("I3 the rider's name only in its evidence line (the reader gave no product name): no amount", () => {
    const [c] = checked([coverage("Total Permanent Disability", null, 88.2, "Waiver of Premium (Payor)\t-\t88.20")]);
    assert.equal(c.amount, null);
  });
  await test("I4 the same page's real covers keep their sums (control)", () => {
    const cs = checked([coverage("Death", "Lotus Life Protect", 100000, "Lotus Life Protect\t100,000.00\t1,820.00"),
      coverage("Critical Illness", "Lotus Crisis Cover", 50000, "Lotus Crisis Cover\t50,000.00\t610.40"),
      coverage("Critical Illness", "Lotus Crisis Waiver II", 150, "Lotus Crisis Waiver II\t-\t150.00")]);
    assert.deepEqual(cs.map((c) => c.amount), [100000, 50000, null]);
  });
  await test("I5 a cover sold with a premium waiver keeps its own sum (control)", () => {
    const p = [{ pageNumber: 2, text: `POLICY SCHEDULE (fictitious)\nLife Assured\t${PERSON}\nCritical Illness Benefit with Premium Waiver\tS$80,000.00` }];
    const [c] = FC.factCheckExtraction(extraction([coverage("Critical Illness", "Critical Illness Benefit with Premium Waiver", 80000, "Critical Illness Benefit with Premium Waiver\tS$80,000.00")]), p).extraction.insuredPeople[0].coverages;
    assert.equal(c.amount, 80000);
  });

  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`waiver-rider: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

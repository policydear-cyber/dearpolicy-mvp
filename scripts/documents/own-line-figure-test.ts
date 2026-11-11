/**
 * A cover's figure is confirmed only on the line that names it. When the cited line is not found word for word, a page
 * line stands in for it only if it holds the citation's own words, never just the same figure: another cover's line
 * printing the same amount must not confirm it (TE #417 N11m). Made-up schedules; no database, network or model.
 * Run: node --import tsx scripts/documents/own-line-figure-test.ts
 */
export {};
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
const eq = <T,>(got: T, want: T, what: string) => { if (got === want) passed++; else failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

async function main() {
  const { crossCheckPages } = await import("@/lib/documents/layout-check");
  const { verifiedExtraction } = await import("@/lib/rag/ingest");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");
  const ext = (amount: number, currency: string, evidence: string, category: string) => PolicyExtractionSchema.parse({
    documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: "Heron Mutual (fictitious)", productName: "Heron Guard", productsMentioned: ["Heron Guard"],
    policyNumber: null, groupPolicyNumber: null, policyType: "Term Life", policyholder: null, personalCoverageConfirmed: true, startDate: null, renewalOrExpiryDate: null,
    insuredPeople: [{ name: "Wren Heron", relationshipHint: "self", coverages: [{ category, productName: null, policyNumber: null, amount, currency, notes: null, sourcePage: 1, evidenceText: evidence, evidenceVerified: true }] }],
    referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [] });
  const verified = async (text: string, image: string | null, e: ReturnType<typeof ext>) => {
    const pages = [{ pageNumber: 1, text, extractionMethod: "native" }];
    const checked = await crossCheckPages(pages, [1], async () => image == null ? null : [{ pageNumber: 1, text: image, extractionMethod: "ocr" }]);
    return verifiedExtraction(e, checked).insuredPeople[0]?.coverages[0]?.evidenceVerified ?? null;
  };
  const SIGNED = ["Heron Guard - Policy Schedule", "Life Assured\tWren Heron", "Death\tS$300,000.00", "Total and Permanent Disability\tS$300,000.00",
    "Critical Illness\tS$90,000.00", "Policy Term\t25 years"].join("\n");
  const BARE = SIGNED.replace(/S\$/g, "");

  // The page image prints a different Death figure, so the page check marks Death's figure as not checked. TPD prints
  // the same S$300,000 the reader gave for Death: it must not confirm Death's figure.
  eq(await verified(SIGNED, SIGNED.replace("Death\tS$300,000.00", "Death\tS$330,000.00"), ext(300000, "SGD", "Death\tS$300,000.00", "Death")), false,
    "F1 S$ on every line, image disagrees on Death, TPD prints the same figure");
  eq(await verified(BARE, "Currency: S$\n" + BARE.replace("Death\t300,000.00", "Death\t330,000.00"), ext(300000, "SGD", "Death\t300,000.00", "Death")), false,
    "F2 no currency in the text, image prints S$ and disagrees on Death, TPD prints the same figure");
  eq(await verified(SIGNED, SIGNED.replace("Critical Illness\tS$90,000.00", "Critical Illness\tS$95,000.00"), ext(90000, "SGD", "Critical Illness\tS$90,000.00", "Critical Illness")), false,
    "F3 image disagrees on Critical Illness (no other line prints its figure)");
  // A citation with no label is never matched to a line by its figure alone.
  eq(await verified(SIGNED, SIGNED.replace("Death\tS$300,000.00", "Death\tS$330,000.00"), ext(300000, "SGD", "300,000.00 300,000.00", "Death")), false,
    "F4 a citation of figures only");

  // Controls: the cover's own line still confirms.
  eq(await verified(SIGNED, SIGNED, ext(300000, "SGD", "Death\tS$300,000.00", "Death")), true, "K1 image agrees, the cited line is found");
  eq(await verified(SIGNED, SIGNED, ext(300000, "SGD", "Death benefit S$300,000.00", "Death")), true,
    "K2 the citation adds a word the line does not print: half its words and its figure are on the Death line");
  eq(await verified(SIGNED, SIGNED, ext(300000, "SGD", "Total Permanent Disability S$300,000.00", "Total Permanent Disability")), true,
    "K3 the citation drops a word of the label (and)");
  eq(await verified(BARE, "Currency: S$\n" + BARE, ext(300000, "SGD", "Death\t300,000.00", "Death")), true, "K4 no currency in the text, the image prints S$ and agrees");
  eq(await verified(SIGNED, SIGNED.replace("Death\tS$300,000.00", "Death\tS$330,000.00"), ext(90000, "SGD", "Critical Illness cover S$90,000.00", "Critical Illness")), true,
    "K5 the image disagrees on another line (Death): Critical Illness, cited loosely, still confirms on its own line");
}
main().then(() => {
  for (const f of failures) console.error("FAIL", f);
  console.log(`own line figure: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.error(e); process.exit(1); });

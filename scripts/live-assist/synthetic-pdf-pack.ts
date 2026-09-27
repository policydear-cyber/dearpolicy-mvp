/**
 * Writes the synthetic document pack for the human-assisted live test
 * (docs/human-assisted-live-test.md): three Living Care certificates (one
 * printing S$, one US$, one printing no currency), the Living Care wording
 * (Critical Illness benefit, Major Cancer definition, 90-day waiting period)
 * and a specialist memo.
 *
 * Every page is marked SYNTHETIC TEST DOCUMENT; every name, number and
 * organisation is invented (the insurer is explicitly fictitious). No
 * machine-readable test payload is embedded: on the live prototype these are
 * read by the real reading model, so results must be checked by eye.
 *
 *   npm run live-assist:pack -- --patient "Synthetic Patient 4f2a9c" --out ./synthetic-pack
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function pdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  pages.forEach((lines, index) => {
    const page = doc.addPage([595, 842]);
    page.drawText("SYNTHETIC TEST DOCUMENT - NOT A REAL INSURANCE DOCUMENT", { x: 48, y: 805, size: 9, font: bold });
    lines.forEach((line, i) => page.drawText(line, { x: 48, y: 770 - i * 20, size: 11, font: i === 0 ? bold : font }));
    page.drawText(`Page ${index + 1} of ${pages.length}`, { x: 48, y: 40, size: 9, font });
  });
  return doc.save();
}

async function main() {
  const patient = (arg("patient") ?? "").trim();
  const out = path.resolve(arg("out") ?? "./synthetic-pack");
  if (!/^Synthetic Patient [0-9a-f]{6}$/i.test(patient)) {
    throw new Error('--patient must look like "Synthetic Patient <last 6 characters of the run id>"');
  }
  await mkdir(out, { recursive: true });
  const insurer = "Synthetic Test Insurer (fictitious)";
  const certificate = (currencyText: string, policyNumber: string) => [
    ["Certificate of Insurance - Living Care", `Insurer: ${insurer}`, "Plan: Living Care (group critical illness)", `Policy number: ${policyNumber}`,
      "Group policy number: SYN-G-000001", `Insured person: ${patient}`, "Cover start date: 2020-01-01", "",
      "Schedule of benefits", `Critical Illness Benefit - sum insured: ${currencyText}`,
      "Benefits are payable in accordance with the Living Care policy wording."],
  ];
  const files: [string, string[][]][] = [
    ["living-care-certificate-sgd.pdf", certificate("S$200,000", "SYN-LC-SGD-0001")],
    ["living-care-certificate-usd.pdf", certificate("US$100,000", "SYN-LC-USD-0001")],
    ["living-care-certificate-no-currency.pdf", certificate("50,000", "SYN-LC-NOCCY-0001")],
    ["living-care-wording.pdf", [
      ["Living Care - Policy Wording", "Terms and Conditions", `Insurer: ${insurer}`, "This wording applies to every Living Care certificate."],
      ["Section 1 - Definitions", "Insured person: the person named on the certificate.", "Sum Insured: the amount shown on the certificate for the benefit."],
      ["Section 2 - General conditions", "Claims must be notified within 90 days of the event.", "The insurer decides every claim after assessment."],
      ["Section 3 - Critical Illness Benefit", "Critical Illness Benefit: 100% of the Sum Insured is payable upon diagnosis of a covered Critical Illness.",
        "Major Cancer: a malignant tumour characterised by the uncontrolled growth and spread of malignant cells", "with invasion and destruction of normal tissue, confirmed by histopathology."],
      ["Section 4 - Waiting period", "Living Care waiting period. A waiting period of 90 days applies to the Critical Illness Benefit", "from the cover start date."],
    ]],
    ["specialist-memo.pdf", [
      ["Specialist memo", "Synthetic Test Hospital (fictitious)", `Patient: ${patient}`, "Hospital case number: SYN-CASE-000001", "",
        "Diagnosis: Malignant neoplasm of the colon, stage III.", "Date of diagnosis: 2026-06-01.",
        "Histopathology of the resected specimen confirms invasive adenocarcinoma.", "Signed: Dr Synthetic Specialist (fictitious)"],
    ]],
  ];
  for (const [file, pages] of files) await writeFile(path.join(out, file), await pdf(pages));
  console.log(`wrote ${files.length} synthetic PDFs to ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

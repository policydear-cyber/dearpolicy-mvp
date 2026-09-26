import { PDFDocument, StandardFonts } from "pdf-lib";

/** One run id per test process: every synthetic name/file carries it, so
 * two runs never collide and cleanup can target exactly this run. */
export const RUN_ID = (process.env.E2E_RUN_ID ?? String(Date.now())).replace(/[^A-Za-z0-9]/g, "").slice(-12);
export const PREFIX = `SYNTHETIC-DPTEST-${RUN_ID}`;
export const name = (label: string) => `${PREFIX}-${label}`;

/** Marker the fake VirusTotal API treats as a malicious verdict. Plain text,
 * not malware: nothing real is ever uploaded anywhere. */
export const SYNTHETIC_MALWARE_MARKER = "SYNTHETIC-DPTEST-MALICIOUS-VERDICT-MARKER";
/** Marker the fake VirusTotal API never finishes analysing (poll budget). */
export const SYNTHETIC_PENDING_MARKER = "SYNTHETIC-DPTEST-SCAN-NEVER-COMPLETES-MARKER";

/** A small synthetic "policy wording" PDF. The wording/terms-and-conditions
 * phrasing makes DearPolicy classify it deterministically (no model call);
 * every line is invented. */
export async function syntheticWordingPdf(label: string, extraLines: string[] = []): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [
    [`${name(label)} Policy Wording`, "Terms and Conditions", "SYNTHETIC TEST DOCUMENT - NOT A REAL INSURANCE POLICY", "Insurer: Synthetic Test Insurer (fictitious)", ...extraLines],
    ["Section 1 - Hospitalisation Benefit", "We will reimburse eligible inpatient charges as charged, subject to the terms of this synthetic wording.", "Section 2 - Critical Illness Benefit", "We will pay 100% of the Sum Insured on diagnosis of a covered critical illness.", `Reference: ${name(label)}`],
  ];
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) => page.drawText(line, { x: 48, y: 780 - i * 22, size: 11, font }));
  }
  return Buffer.from(await doc.save());
}

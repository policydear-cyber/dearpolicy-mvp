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
/** Marker the fake VirusTotal API answers with a provider error (HTTP 500). */
export const SYNTHETIC_PROVIDER_ERROR_MARKER = "SYNTHETIC-DPTEST-SCAN-PROVIDER-ERROR-MARKER";

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
  const bytes = Buffer.from(await doc.save());
  // pdf-lib compresses page content, so a scan marker drawn on the page is
  // not visible in the raw bytes a scanner receives. Scanner markers are
  // therefore also appended as a trailing PDF comment (valid PDF).
  const markers = extraLines.filter((l) => l === SYNTHETIC_MALWARE_MARKER || l === SYNTHETIC_PENDING_MARKER || l === SYNTHETIC_PROVIDER_ERROR_MARKER);
  return markers.length ? Buffer.concat([bytes, Buffer.from(markers.map((m) => `\n%${m}\n`).join(""), "latin1")]) : bytes;
}

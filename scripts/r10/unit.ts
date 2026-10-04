/**
 * Round 10 unit controls for the reading fixes: plain code, no database, no
 * provider. Each control names the rule it holds and fails with what it saw.
 */
import type { PdfPage } from "@/lib/documents/pdf";

export async function unitControls(): Promise<string[]> {
  const fails: string[] = [];
  const check = (name: string, ok: boolean, saw: unknown) => { if (!ok) fails.push(name + " — saw " + JSON.stringify(saw).slice(0, 300)); };
  const M = await import("@/lib/documents/messy");
  const P = await import("@/lib/chat/printed-lines");
  const O = await import("@/lib/documents/ocr-hosted");
  const R = await import("@/lib/policies/benefit-rows");
  const E = await import("@/lib/documents/evidence");
  const D = await import("@/lib/ai/deterministic-model");
  const page = (pageNumber: number, text: string, extra: Partial<PdfPage> = {}): PdfPage => ({ pageNumber, text, extractionMethod: "ocr", ...extra } as PdfPage);

  // ---- what kind of paper an upload is, from what it prints
  const roles: [string, string[], string | null][] = [
    ["claim decision", ["Merlion Mutual Assurance\nClaim number: CLM-2026-1\nDear Mr Chua\nWe regret that we are unable to admit your claim.\nAmount claimed: S$24,816.40\nAmount payable: S$0.00\nYours sincerely"], "claim_decision"],
    ["hospital bill", ["FINAL BILL / TAX INVOICE\nBill number\tNHH-1\nPatient\tChua Boon Huat\nAdmission\t3 June 2026\nAmount payable by patient\tS$1,000.00"], "medical_bill"],
    ["insurer letter", ["Merlion Mutual Assurance\n15 August 2026\nDear Mr Chua\nYour premium will increase from 1 April 2027.\nYours sincerely"], "insurer_letter"],
    ["app screenshot", ["9:41 87%\nMy Policies\nTermGuard 65\nIn force\nSum assured S$500,000\nHome  Policies  Claims  Profile"], "app_screenshot"],
    ["family notes", ["Our insurance notes\nPapa - SilverShield, deductible about 3,000?\nMama - CareCash"], "personal_notes"],
    ["policy schedule", ["POLICY SCHEDULE\nPolicy number: MMA-SS-5520417\nLife assured: Chua Boon Huat\nDeductible\tS$3,500"], null],
    ["renewal notice letter", ["Dear Mr Chua\nThis renewal notice confirms your premium of S$486 is due.\nYours sincerely"], null],
  ];
  for (const [name, texts, want] of roles) {
    const got = M.correspondenceRole(texts.map((t, i) => page(i + 1, t)));
    check("correspondenceRole: " + name, got === want, got);
  }

  // ---- several policies in one file; pages out of order
  const bundle = [
    page(1, "CERTIFICATE OF INSURANCE\nPolicy number: SSI-PA-4410876\nInsured person: Lee Ah Lian\nPage 1 of 2"), page(2, "Benefits\nPage 2 of 2"),
    page(3, "POLICY SCHEDULE\nPolicy number: TBL-HW-1988\nLife assured: Chua Boon Huat\nPage 1 of 2"), page(4, "Values\nPage 2 of 2"),
  ];
  const segs = M.bundleSegments(bundle);
  check("bundleSegments: two policies in one file", segs?.length === 2 && segs[0].from === 1 && segs[0].to === 2 && segs[1].from === 3 && segs[1].to === 4, segs);
  const one = [page(1, "POLICY SCHEDULE\nPolicy number: MMA-SS-5520417\nLife assured: Chua Boon Huat\nPage 1 of 2"), page(2, "POLICY SCHEDULE (continued)\nPolicy number: MMA-SS-5520417\nLife assured: Chua Boon Huat\nPage 2 of 2")];
  check("bundleSegments: one policy repeating its number is not a bundle", M.bundleSegments(one) === null, M.bundleSegments(one));
  check("bundleSegments: a single page is not a bundle", M.bundleSegments([bundle[0]]) === null, null);
  const shuffled = [page(1, "Benefits\nPage 3 of 3"), page(2, "Schedule\nPage 1 of 3"), page(3, "Conditions\nPage 2 of 3")];
  check("printedOrder: pages 3,1,2 are read in printed order", JSON.stringify(M.printedOrder(shuffled)) === "[2,3,1]", M.printedOrder(shuffled));
  check("printedOrder: pages in order need nothing", M.printedOrder([shuffled[1], shuffled[2], shuffled[0]].map((p, i) => ({ ...p, pageNumber: i + 1 }))) === null, null);
  check("printedOrder: unlabelled pages are left alone", M.printedOrder([page(1, "a"), page(2, "b")]) === null, null);
  check("printedOrder: labels that disagree with the file are left alone", M.printedOrder([page(1, "Page 2 of 5"), page(2, "Page 1 of 5")]) === null, null);

  // ---- figures a scan prints unclearly: settled only when the document agrees; otherwise never a figure
  const settled = M.settleOcrFigures([page(1, "Sum assured\tS$50,000"), page(2, "Critical illness\t100% of sum assured, S$5O,000\nEarly stage cancer\tup to S$12,5OO")]);
  check("settleOcrFigures: S$5O,000 becomes S$50,000 when the document prints it clearly", settled.pages[1].text.includes("S$50,000") && !settled.pages[1].text.includes("S$5O,000"), settled.pages[1].text);
  check("settleOcrFigures: S$12,5OO with no agreeing figure is left verbatim", settled.pages[1].text.includes("S$12,5OO") && settled.unclear.some((u) => u.value === 12500), settled);
  check("settleOcrFigures: every change is noted", settled.notes.length === 2, settled.notes);
  const native = M.settleOcrFigures([page(1, "Limit S$5O,000", { extractionMethod: "native" }), page(2, "S$50,000", { extractionMethod: "native" })]);
  check("settleOcrFigures: a native text layer is never rewritten", native.pages[0].text === "Limit S$5O,000" && !native.notes.length, native);
  check("unclearFigures: a clean figure is not unclear", M.unclearFigures("S$12,500 and S$1,036.00").length === 0, M.unclearFigures("S$12,500"));
  const flagged = M.flagUnclearFigures("Early stage cancer: up to S$12,5OO");
  check("flagUnclearFigures: an unclear amount is said to be unclear", flagged === "Early stage cancer: up to an unclear amount (the scan shows “12,5OO”)", flagged);
  check("flagUnclearFigures: idempotent", M.flagUnclearFigures(flagged) === flagged, M.flagUnclearFigures(flagged));
  check("flagUnclearFigures: an unclear year", /the year is unclear on the scan: “2O18”/.test(M.flagUnclearFigures("Start date 1 July 2O18")), M.flagUnclearFigures("Start date 1 July 2O18"));
  check("flagUnclearFigures: an unclear policy number", /SSI-GY-77l0293 \(some characters are unclear on the scan\)/.test(M.flagUnclearFigures("Po1icy SSI-GY-77l0293")), M.flagUnclearFigures("SSI-GY-77l0293"));
  check("flagUnclearFigures: a clean policy number is untouched", M.flagUnclearFigures("Policy MMA-SS-5520417") === "Policy MMA-SS-5520417", null);
  // Every figure parser refuses the fragment before a confusable letter.
  const parsed = R.parseBenefitValue("S$5O,000");
  check("parseBenefitValue: S$5O,000 is not S$5", !parsed || (parsed as { value?: number }).value !== 5, parsed);
  check("amountAppears: S$1,O36.00 prints neither S$1 nor S$36", !E.amountAppears("Rider premium S$1,O36.00", 1, "money") && !E.amountAppears("Rider premium S$1,O36.00", 36, "money"), true);
  check("amountAppears: a clean figure still appears", E.amountAppears("up to S$12,500", 12500, "money"), false);

  // ---- a transcribed table's broken rows mended, words only
  const mended = M.mendOcrRows("Ear1y stage cancer\n25% of sum assured, up to\nS$12,5OO\nAngioplasty (once only)  10% of sum assured\nPo1icy SSI-GY-77l0293");
  check("mendOcrRows: label and its value lines joined into one row", mended.includes("Early stage cancer\t25% of sum assured, up to S$12,5OO"), mended);
  check("mendOcrRows: two spaces between cells become a tab", mended.includes("Angioplasty (once only)\t10% of sum assured"), mended);
  check("mendOcrRows: a policy number is never rewritten", mended.includes("SSI-GY-77l0293") && mended.includes("Policy"), mended);

  // ---- turned pages: which turns to try, at most three
  check("turnsToTry: reported 90° clockwise is turned back first", JSON.stringify(O.turnsToTry({ orientation: "sideways", rotation: 90 })) === "[270,90]", O.turnsToTry({ orientation: "sideways", rotation: 90 }));
  check("turnsToTry: upside down", JSON.stringify(O.turnsToTry({ orientation: "upside_down", rotation: 180 })) === "[180]", O.turnsToTry({ orientation: "upside_down", rotation: 180 }));
  check("turnsToTry: unknown orientation tries three turns at most", O.turnsToTry({ orientation: undefined, rotation: undefined } as never).length === 3, O.turnsToTry({} as never));
  const accepted = O.acceptTranscribedPages([1, 2], [{ pageNumber: 1, text: "", orientation: "sideways", rotation: 90 }, { pageNumber: 2, text: "notes", legibility: "poor" }, { pageNumber: 7, text: "x" }]);
  check("acceptTranscribedPages: keeps orientation and legibility, drops pages not asked for", accepted.length === 2 && (accepted[0] as { rotation?: number }).rotation === 90 && (accepted[1] as { legibility?: string }).legibility === "poor", accepted);

  // ---- lines quoted to the household
  check("withoutBarePercent: GST 9% loses its bare rate, keeps its amount", P.withoutBarePercent("Summary of charges — GST 9%: S$2,049.06") === "Summary of charges — GST: S$2,049.06", P.withoutBarePercent("Summary of charges — GST 9%: S$2,049.06"));
  check("withoutBarePercent: a rate cell beside an amount is dropped", P.withoutBarePercent("2024: Reversionary bonus rate 1.5%; Bonus added S$1,115.00") === "2024: Bonus added S$1,115.00", P.withoutBarePercent("2024: Reversionary bonus rate 1.5%; Bonus added S$1,115.00"));
  check("withoutBarePercent: a percentage of something is kept", P.withoutBarePercent("Early stage cancer: 25% of sum assured, up to S$12,500") === "Early stage cancer: 25% of sum assured, up to S$12,500", null);
  check("quoted: a zero amount reads as nil", P.quoted([{ line: "Loan outstanding: S$0.00", page: 1 }])[0] === "“Loan outstanding: nil” (page 1).", P.quoted([{ line: "Loan outstanding: S$0.00", page: 1 }]));
  const kv = P.piecesOf("Policyholder and life assured\tChua Boon Huat (date of birth 9 August 1947)\nPlan\tSilverShield Plan B (Class A ward)");
  check("piecesOf: a name with a date of birth is a value, not a column heading", kv.includes("Plan: SilverShield Plan B (Class A ward)"), kv);
  const table = P.piecesOf("Benefit\tAmount per day\tMaximum days per admission\nDaily hospital cash (normal ward)\tS$200\t365");
  check("piecesOf: each value under its column heading", table.includes("Daily hospital cash (normal ward): Amount per day S$200; Maximum days per admission 365"), table);
  const { earlierYearAsked } = await import("@/lib/chat/document-questions");
  const today = new Date("2026-10-04T00:00:00Z");
  check("earlierYearAsked: last year / an earlier year", earlierYearAsked("What was the premium last year?", today) && earlierYearAsked("What did the 2025 schedule cover?", today), null);
  check("earlierYearAsked: this year, or a date range, is not", !earlierYearAsked("What is the premium for 2026?", today) && !earlierYearAsked("Is he covered from 1 April 2025?", today), null);

  // ---- the reading stand-in: never in production, the same answer every time, a turned page read only upright
  check("stand-in: off in production", !D.deterministicModelEnabled({ DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "x", NODE_ENV: "production" } as never), true);
  check("stand-in: off on Vercel", !D.deterministicModelEnabled({ DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "x", VERCEL: "1" } as never), true);
  check("stand-in: off without a run id", !D.deterministicModelEnabled({ DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e" } as never), true);
  const { PDFDocument, degrees } = await import("pdf-lib");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  doc.addPage([100, 100]).drawImage(image, { x: 0, y: 0, width: 100, height: 100 });
  const bytes = await doc.save();
  const [[hash]] = await D.pageImageFingerprints(bytes);
  const registry = new Map([[hash, { text: "SCHEDULE OF BENEFITS\nSum assured\tS$50,000", rotation: 90, quality: "good" as const }]]);
  const g = globalThis as Record<string, unknown>;
  const previous = g[D.SYNTHETIC_OCR_REGISTRY];
  g[D.SYNTHETIC_OCR_REGISTRY] = registry;
  try {
    const ask = async (pdf: Uint8Array) => JSON.parse((await D.deterministicHostedDocumentText({ system: "", user: "pages in this order: 1", pdfBase64: Buffer.from(pdf).toString("base64") })).text).pages[0];
    const sideways = await ask(bytes);
    check("stand-in: a page fed in sideways comes back empty, turned", sideways.text === "" && sideways.orientation === "sideways" && sideways.rotation === 90, sideways);
    const turnedDoc = await PDFDocument.load(bytes); turnedDoc.getPage(0).setRotation(degrees(270));
    const upright = await ask(await turnedDoc.save());
    check("stand-in: the same page turned upright is read", upright.text.startsWith("SCHEDULE OF BENEFITS") && upright.orientation === "upright", upright);
    const again = await ask(await turnedDoc.save());
    check("stand-in: deterministic", JSON.stringify(again) === JSON.stringify(upright), again);
  } finally { g[D.SYNTHETIC_OCR_REGISTRY] = previous; }
  return fails;
}

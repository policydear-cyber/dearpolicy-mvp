import assert from "node:assert/strict";
import { mergeOcrPages, pagesNeedingOcr } from "@/lib/documents/ocr";
import type { PdfPage } from "@/lib/documents/pdf";

const pages: PdfPage[] = [
  { pageNumber: 1, text: "A complete selectable policy schedule with an insured person's name.", imageCount: 1, extractionMethod: "native" },
  { pageNumber: 2, text: "", imageCount: 1, extractionMethod: "native" },
  { pageNumber: 3, text: "", imageCount: 0, extractionMethod: "native" },
  { pageNumber: 4, text: "logo", imageCount: 2, extractionMethod: "native" },
];

assert.deepEqual(pagesNeedingOcr(pages), [2, 4], "Only image-backed pages without usable text should use OCR");
const merged = mergeOcrPages(pages, [
  { pageNumber: 2, text: "Death benefit: 100% of the Sum Insured" },
  { pageNumber: 4, text: "Policy number G007500" },
]);
assert.equal(merged[0].extractionMethod, "native");
assert.equal(merged[1].extractionMethod, "ocr");
assert.match(merged[1].text, /100%/);
assert.equal(merged[2].text, "");
assert.equal(merged[3].extractionMethod, "ocr");

// A PDF that needs OCR is read twice: once for text, once to render the
// image-backed pages. PDF.js transfers the buffer it is given, so the caller's
// bytes must survive that first pass or every scanned document fails with
// "Cannot perform Construct on a detached ArrayBuffer" after text extraction
// has already succeeded.
async function bufferSurvivesPdfRead(){
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const minimalPdf = Buffer.from(
    "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n", "latin1");
  const callerBytes = new Uint8Array(minimalPdf);
  const sizeBefore = callerBytes.byteLength;
  await extractPdfPages(callerBytes).catch(() => []);
  assert.equal(callerBytes.byteLength, sizeBefore, "Reading a PDF must not detach the caller's buffer");
  assert.doesNotThrow(() => { new Uint8Array(callerBytes); }, "The same bytes must still be usable for the OCR render pass");
}
bufferSurvivesPdfRead().then(()=>{
  console.log("DearPolicy OCR routing regressions passed (page selection, ordering, merge safety and buffer retention).");
}).catch(error=>{console.error(error);process.exitCode=1;});

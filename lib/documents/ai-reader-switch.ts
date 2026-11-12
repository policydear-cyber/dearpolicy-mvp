/** OCR_AI_READER=off (DC, 12 Nov: "it should run fully on paddleocr, how do i turn off the ai reader"): no page image is
 * read by the hosted AI reader, for any purpose -- a scanned or photographed page, or the image check of a text page.
 * Baidu's PaddleOCR is then the only image reader. A page Baidu gives no text for is never read by anything else: it is
 * marked not read and the document names it ("Page 3 is a scanned page that has not been read yet"), the reading job is
 * tried again while the document has no readable text, and a text page whose image check could not be made keeps what
 * it had (nothing gained, nothing lost). Unset, or any other value: the AI reader reads what Baidu could not (as before).
 * Turning text into the document's facts and rows is not page-image reading and is not affected. */
export function aiPageReaderOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(0|false|off|no)$/i.test(env.OCR_AI_READER?.trim() ?? "");
}

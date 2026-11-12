import { crossCheckPages } from "@/lib/documents/layout-check";
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

/** The image check of text pages whose figures did not verify, with the AI reader switched off, decided page by page
 * (Critic #435 H1): a page no image reader read (`notRead` in the reply) keeps its text exactly as it was, and only the
 * pages Baidu did read are checked against their image (crossCheckPages). A reply that failed outright (null) is checked
 * as before. `unread` names the pages kept, for the processing history. */
export async function crossCheckKeepingUnread<P extends Parameters<typeof crossCheckPages>[0][number]>(pages: P[], numbers: number[],
  got: Awaited<ReturnType<Parameters<typeof crossCheckPages>[2]>>): Promise<{ pages: P[]; unread: number[] }> {
  const unread = got ? numbers.filter((n) => (got.find((p) => p.pageNumber === n) as { notRead?: boolean } | undefined)?.notRead) : [];
  const check = numbers.filter((n) => !unread.includes(n));
  return { pages: check.length ? await crossCheckPages(pages, check, async () => got) : pages, unread };
}

import type { PdfPage } from "./pdf";

export type PolicyChunkDraft = {
  pageStart: number;
  pageEnd: number;
  heading: string | null;
  text: string;
};

const TARGET_CHARS = 1800;
const OVERLAP_CHARS = 250;

export function chunkPages(pages: PdfPage[]): PolicyChunkDraft[] {
  const chunks: PolicyChunkDraft[] = [];

  for (const page of pages) {
    const clean = page.text.trim();
    if (!clean) continue;

    if (clean.length <= TARGET_CHARS) {
      chunks.push({ pageStart: page.pageNumber, pageEnd: page.pageNumber, heading: null, text: clean });
      continue;
    }

    let start = 0;
    while (start < clean.length) {
      let end = Math.min(start + TARGET_CHARS, clean.length);
      if (end < clean.length) {
        const sentenceEnd = Math.max(clean.lastIndexOf(". ", end), clean.lastIndexOf("; ", end));
        if (sentenceEnd > start + TARGET_CHARS * 0.6) end = sentenceEnd + 1;
      }
      const text = clean.slice(start, end).trim();
      if (text) chunks.push({ pageStart: page.pageNumber, pageEnd: page.pageNumber, heading: null, text });
      if (end >= clean.length) break;
      start = Math.max(end - OVERLAP_CHARS, start + 1);
    }
  }

  return chunks;
}

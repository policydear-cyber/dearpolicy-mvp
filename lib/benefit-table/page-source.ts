/** The stored file's pages for the page-image figure check (image-check.ts): which pages had their words read by OCR, and
 * one page of the stored file as the checker is shown it (a one-page PDF cut from the stored PDF, or from the PDF an image
 * upload is turned into, exactly as the reading saw it). The file is read once per check, only when a page is asked for.
 * A page the file cannot give (file gone, unreadable, a Word document) gives null: its figures are not confirmed. */
import type { Db } from "./service";
import type { PageSource } from "./image-check";

export type PageFileTools = {
  readFile(storageKey: string): Promise<Uint8Array>;
  /** The stored bytes as a PDF (an image upload made into one, as at reading), or null for a file with no pages to show. */
  asPdf(bytes: Uint8Array): Promise<Uint8Array | null>;
  onePage(pdf: Uint8Array, page: number): Promise<Uint8Array>;
};

/** Pages whose stored words came from the file's own text layer (extraction method "native"). Every other page (OCR, a
 * part-checked page, a page stored before the method was recorded, or a page with no record at all) is checked against
 * the page, to be safe (Critic 2, R485 N1). */
export async function nativePagesOf(db: Db, accountId: string, policyId: string): Promise<number[]> {
  const rows = await db("SELECT page_number FROM policy_pages pp WHERE account_id=$1 AND policy_id=$2 AND to_jsonb(pp)->>'extraction_method' = 'native' ORDER BY page_number", [accountId, policyId]);
  return rows.map((r) => Number(r.page_number)).filter((n) => Number.isInteger(n) && n > 0);
}

export async function pageSourceFor(db: Db, accountId: string, policyId: string, tools: PageFileTools): Promise<PageSource> {
  const nativePages = await nativePagesOf(db, accountId, policyId);
  let pdf: Promise<Uint8Array | null> | null = null;
  const file = () => pdf ??= (async () => {
    const rows = await db(`SELECT storage_key FROM policies WHERE id=$1 AND account_id=$2`, [policyId, accountId]);
    const key = rows[0]?.storage_key == null ? "" : String(rows[0].storage_key);
    if (!key) return null;
    return tools.asPdf(await tools.readFile(key));
  })().catch(() => null);
  return {
    nativePages,
    async page(n) {
      const whole = await file();
      if (!whole) return null;
      try { return { kind: "pdf", mediaType: "application/pdf", data: Buffer.from(await tools.onePage(whole, n)).toString("base64") }; }
      catch { return null; }
    },
  };
}

/** The real file tools: the app's storage, the upload formats' own image-to-PDF step, and the OCR step's page cutter. */
export const realPageFileTools: PageFileTools = {
  async readFile(key) { const { readPolicyFile } = await import("@/lib/storage"); return new Uint8Array(await readPolicyFile(key)); },
  async asPdf(bytes) {
    const { sniffFileFormat, imageToPdf } = await import("@/lib/documents/formats");
    const s = sniffFileFormat(bytes);
    if (!s.ok || s.format === "docx") return null;
    return s.format === "pdf" ? bytes : new Uint8Array(await imageToPdf(bytes, s.format));
  },
  async onePage(pdf, page) { const { subsetPdf } = await import("@/lib/documents/ocr-hosted"); return new Uint8Array(await subsetPdf(pdf, [page])); },
};

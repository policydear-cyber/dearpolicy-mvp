/**
 * Step 2 prototype, end to end (test tooling, never run by the app):
 *   1. Reader 1: the app's own benefit reading (lib/benefit-table/service.ts readDocument) reads ONE page of Baidu's text
 *      (what our parser kept), as it would in production. No guards.
 *   2. Image checkers: each checker model sees only the PAGE IMAGE and is told only each row's label and column (never a
 *      figure), and copies the cell exactly as printed.
 *   3. A figure is ACCEPTED only when every checker's copy gives the same number as reader 1; otherwise it is FLAGGED
 *      (in the app: read again, then the household confirms). Scored against the made-up document's ground truth, for every
 *      subset of the checkers too (1, 2, 3 ... checkers), so the report can say how many checkers are worth it.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/ocr-proof/pipeline.ts <pages.txt> <outDir> <capUsd> [model,model,...]
 *   pages.txt: one "<doc> <page>" per line. Files: /mnt/project-files/ocr-proof/{pdf,truth,run-1/<doc>/parsed-pages.json}.
 *
 * Spend: before EVERY model call its worst case (whole prompt at the uncached input price, image included at its maximum
 * token size, plus every output token it may use) is added to the spend so far; if that could pass capUsd the call is not
 * made and the run stops (stopped: "cap"). Actual spend uses the API's own token counts. Each page's result is written as
 * it finishes (<outDir>/<doc>-p<page>.json), so a stopped run keeps what it did; pages already written are skipped.
 * Uses DEARPOLICY_ANTHROPIC_KEY.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { readDocument, checkStored, type Db, type StoredReading } from "@/lib/benefit-table/service";
import { anthropicTableModel, type TableModel, type TableCall } from "@/lib/benefit-table/model";
import { benefitTableModel } from "@/lib/benefit-table/flag";
import { priceFor } from "@/lib/ai/providers";
import type { SourceDoc } from "@/lib/benefit-table/check";

const ROOT = "/mnt/project-files/ocr-proof";
const [listPath, outDir, capArg, modelsArg] = process.argv.slice(2);
const capUsd = Number(capArg);
if (!listPath || !outDir || !(capUsd > 0)) throw new Error("usage: pipeline.ts <pages.txt> <outDir> <capUsd> [models]");
const checkers = (modelsArg ?? "claude-sonnet-5-5,claude-haiku-4-5,claude-opus-5-5").split(",");
mkdirSync(outDir, { recursive: true });
const ledgerPath = join(outDir, "spend.json");
const ledger: { spentUsd: number; worstAdmittedUsd: number; calls: number; stopped: string | null } =
  existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { spentUsd: 0, worstAdmittedUsd: 0, calls: 0, stopped: null };
const saveLedger = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
class CapReached extends Error {}

const price = (model: string) => priceFor({ provider: "anthropic", model }) ?? { input: 5, output: 25 };
/** Worst case of one call: ~3.5 characters a token, rounded up, plus the image at its largest (about 1,600 tokens for
 * an image scaled to fit 1,568 px), all at the uncached input price, plus every output token allowed. */
const worst = (model: string, chars: number, imageTokens: number, maxTokens: number) => {
  const p = price(model);
  return ((Math.ceil(chars / 3.5) + imageTokens) * p.input + maxTokens * p.output) / 1e6;
};
function admit(model: string, chars: number, imageTokens: number, maxTokens: number) {
  const w = worst(model, chars, imageTokens, maxTokens);
  if (ledger.spentUsd + w > capUsd) { ledger.stopped = "cap"; saveLedger(); throw new CapReached(`worst case US$${w.toFixed(4)} would pass the cap`); }
  ledger.worstAdmittedUsd += w; ledger.calls++;
}
const book = (model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0) => {
  const p = price(model);
  ledger.spentUsd += (input * p.input + output * p.output + cacheRead * (p.cachedInput ?? p.input) + cacheWrite * p.input * 1.25) / 1e6;
  saveLedger();
};

/** Reader 1 wrapped so every call is admitted on its worst case first and booked after. */
function admitted(m: TableModel): TableModel {
  return { choice: m.choice, async call(c: TableCall) {
    admit(m.choice.model, c.system.length + c.user.length + JSON.stringify(c.schema).length, 0, c.maxTokens);
    const r = await m.call(c);
    book(m.choice.model, r.input, r.output, r.cacheRead ?? 0, r.cacheWrite ?? 0);
    return r;
  } };
}

const api = new Anthropic({ apiKey: process.env.DEARPOLICY_ANTHROPIC_KEY });
const SYSTEM = "You check figures on an insurance document page against its image. For each requested table cell, find the row by its label and the column by its heading, and copy the cell EXACTLY as printed on the image: every character, the currency letters and symbols included (e.g. S$, US$, HK$, RM, €, £, ¥, ₹, SGD), digits, commas, decimals, % and words. Never guess, never correct, never convert. If you cannot see the cell, answer null.";
const SCHEMA = { type: "object", additionalProperties: false, required: ["cells"], properties: { cells: { type: "array", items: { type: "object", additionalProperties: false,
  required: ["n", "printed"], properties: { n: { type: "integer" }, printed: { type: ["string", "null"] } } } } } };
const num = (x: string | null | undefined) => { if (!x) return null; const m = x.replace(/,/g, "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const norm = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const tight = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

async function onePage(doc: string, page: number) {
  const out = join(outDir, `${doc}-p${page}.json`);
  if (existsSync(out)) return;
  const truth = JSON.parse(readFileSync(join(ROOT, "truth", `${doc}.json`), "utf8"));
  const ocr: string[] = JSON.parse(readFileSync(join(ROOT, "run-1", doc, "parsed-pages.json"), "utf8"));
  const pageText = ocr[page - 1] ?? "";
  const t0 = Date.now();
  // 1. Reader 1 on this page of Baidu's text.
  const DOC = "00000000-0000-4000-8000-0000000000d1", ACC = "00000000-0000-4000-8000-0000000000a1";
  let stored: StoredReading | null = null;
  const pages = [{ page, text: pageText }];
  const db: Db = async (sql, params) => {
    if (/FROM policies\s/.test(sql) && /original_filename/.test(sql)) return [{ id: DOC, original_filename: `${doc}.pdf`, processing_status: "ready", product_name: null, insurer: null,
      document_role: null, policy_number: null, quarantine_status: null, scan_result_detail: null, reading_live: false, scan_live: false, link_only: false, carried: false }];
    if (/FROM policy_pages/.test(sql)) return pages.map((p) => ({ policy_id: DOC, page_number: p.page, text: p.text }));
    if (/INSERT INTO benefit_readings/.test(sql)) { stored = JSON.parse(String(params[2])); return []; }
    return [];
  };
  const reader = admitted(anthropicTableModel(benefitTableModel()));
  await readDocument(db, reader, ACC, DOC, undefined, {});
  const sdoc: SourceDoc = { id: DOC, name: `${doc}.pdf`, readable: true, pages };
  const benefits = stored ? checkStored(sdoc, stored as StoredReading).benefits : [];

  // Ground-truth cells with a figure on this page.
  let header: string[] = [];
  const cells: { label: string; column: string; text: string; value: number }[] = [];
  for (const ln of truth.page_lines[page - 1].lines) {
    if (ln.kind === "table_header") header = ln.cells;
    if (ln.kind === "table_row") ln.cells.slice(1).forEach((c: string, i: number) => { const v = num(c); if (v != null) cells.push({ label: ln.cells[0], column: header[i + 1] ?? "", text: c, value: v }); });
  }
  // 2. Image checkers, blind.
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-r", "150", "-png", "-singlefile", join(ROOT, "pdf", `${doc}.pdf`), join(dir, "p")]);
  const img = readFileSync(join(dir, "p.png")).toString("base64");
  const questions = cells.map((c, i) => `${i + 1}. row "${c.label}", column "${c.column}"`).join("\n");
  const copies: Record<string, (string | null)[]> = {};
  const maxTokens = Math.min(8000, 300 + 60 * cells.length);
  for (const model of checkers) {
    const user = `Page ${page}. Copy these cells exactly as printed:\n${questions}`;
    admit(model, SYSTEM.length + user.length + JSON.stringify(SCHEMA).length, 1600, maxTokens);
    const r = await api.messages.create({ model, max_tokens: maxTokens, system: SYSTEM,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: img } }, { type: "text", text: user }] }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } } } as never) as unknown as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } };
    book(model, r.usage.input_tokens, r.usage.output_tokens);
    let got: { n: number; printed: string | null }[] = [];
    try { got = JSON.parse(r.content.find((c) => c.type === "text")?.text ?? "{}").cells ?? []; } catch { /* no copies: every cell flagged */ }
    copies[model] = cells.map((_, i) => got.find((g) => g.n === i + 1)?.printed ?? null);
  }
  // 3. Verdict per cell.
  const ocrT = tight(pageText);
  const rows = cells.map((c, i) => {
    const same = benefits.filter((b) => norm(b.benefit).includes(norm(c.label).slice(0, 14)) && (!b.column || !c.column || norm(b.column) === norm(c.column)));
    const r1 = same.map((b) => b.value).find((v) => v === c.value) ?? same.map((b) => b.value ?? b.cap).find((v) => v != null) ?? null;
    return { ...c, ocrExact: ocrT.includes(tight(c.text)), reader1: r1, copies: Object.fromEntries(checkers.map((m) => [m, copies[m][i]])) };
  });
  writeFileSync(out, JSON.stringify({ doc, page, mode: truth.mode, seconds: Math.round((Date.now() - t0) / 1000), checkers, rows }, null, 1));
  console.log(doc, page, `${rows.length} cells`, `spent US$${ledger.spentUsd.toFixed(4)}`);
}

(async () => {
  const list = readFileSync(listPath, "utf8").split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 2);
  try {
    for (const [doc, p] of list) await onePage(doc, Number(p));
    ledger.stopped = null; saveLedger();
  } catch (e) {
    if (e instanceof CapReached) console.log("STOPPED:", e.message);
    else throw e;
  }
  console.log(JSON.stringify(ledger));
})();

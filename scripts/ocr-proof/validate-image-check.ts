/**
 * Validation run for the page-image figure check (test tooling, never run by the app). It runs the app's own code end to
 * end on made-up scanned documents:
 *   1. reader 1, the app's own benefit reading (service.ts readDocument), reads Baidu's text of the document's figure pages
 *      (what our parser kept, run-1/<doc>/parsed-pages.json), as in production;
 *   2. the production image check (image-check.ts runImageCheck, through readDocument's GuardSetup kind "image") checks
 *      every figure against the page itself, cut from the made-up PDF by the production page cutter (page-source.ts);
 *   3. every figure is scored against the document's ground truth.
 * Bar (design, 14 Nov): 0 wrong figures accepted, and under 2% of right figures flagged.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/ocr-proof/validate-image-check.ts <docs> <pagesPerDoc> <outDir> <capUsd> [plan|fake]
 *   docs: comma-separated, e.g. ocr50_01,ocr50_02. Files: /mnt/project-files/ocr-proof/{pdf,truth,run-1/<doc>/parsed-pages.json}.
 *   plan: prints the pages and figures and spends nothing. fake: runs everything with stand-in models that copy the truth
 *   (no network, no spend), to prove the plumbing and the scoring.
 *
 * Spend (DC approved about US$40, 14 Nov): before EVERY model call its worst case (whole prompt at the uncached input
 * price at ~3.5 characters a token, the page at 4,600 tokens for a checker, plus every output token allowed) is added to
 * the spend so far; a call that could pass capUsd is not made and the run stops. Actual spend is booked from the API's own
 * token counts into <outDir>/spend.json, which a resumed run continues from; documents already written are skipped.
 * Uses DEARPOLICY_ANTHROPIC_KEY.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readDocument, checkStored, type Db, type StoredReading, type GuardSetup } from "@/lib/benefit-table/service";
import { anthropicTableModel, type TableModel, type TableCall, type TableReply } from "@/lib/benefit-table/model";
import { benefitTableModel } from "@/lib/benefit-table/flag";
import { imageCheckModels, supportsEffort } from "@/lib/benefit-table/guard-flag";
import { PAGE_TOKENS } from "@/lib/benefit-table/image-check";
import { realPageFileTools } from "@/lib/benefit-table/page-source";
import { claimsOf, type GuardRecord } from "@/lib/benefit-table/guards";
import { priceFor } from "@/lib/ai/providers";
import type { CheckedReading, SourceDoc } from "@/lib/benefit-table/check";

const ROOT = "/mnt/project-files/ocr-proof";
const [docsArg, perDocArg, outDir, capArg, mode] = process.argv.slice(2);
const capUsd = Number(capArg), perDoc = Number(perDocArg);
if (!docsArg || !(perDoc > 0) || !outDir || !(capUsd > 0)) throw new Error("usage: validate-image-check.ts <docs> <pagesPerDoc> <outDir> <capUsd> [plan|fake]");
const docs = docsArg.split(",").map((d) => d.trim()).filter(Boolean);
mkdirSync(outDir, { recursive: true });

// ---- The spend ledger: admitted on the worst case before a call, booked from the API's counts after it. ----
const ledgerPath = join(outDir, "spend.json");
type Ledger = { capUsd: number; spentUsd: number; worstAdmittedUsd: number; calls: number; stopped: string | null; byModel: Record<string, { calls: number; input: number; output: number; usd: number }> };
const ledger: Ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { capUsd, spentUsd: 0, worstAdmittedUsd: 0, calls: 0, stopped: null, byModel: {} };
ledger.capUsd = capUsd;
const saveLedger = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
class CapReached extends Error {}
const price = (model: string) => priceFor({ provider: "anthropic", model }) ?? { input: 5, output: 25 };
function admitted(m: TableModel, attachmentTokens: number, role: string): TableModel {
  return { choice: m.choice, async call(c: TableCall) {
    const p = price(m.choice.model);
    const extra = c.attachments?.length ? attachmentTokens * c.attachments.length : 0;
    const w = ((Math.ceil((c.system.length + c.user.length + JSON.stringify(c.schema).length) / 3.5) + extra) * p.input + c.maxTokens * p.output) / 1e6;
    if (ledger.spentUsd + w > capUsd) { ledger.stopped = `cap: a ${m.choice.model} call's worst case US$${w.toFixed(4)} would pass US$${capUsd}`; saveLedger(); throw new CapReached(ledger.stopped); }
    ledger.worstAdmittedUsd += w; ledger.calls++;
    const r: TableReply = await m.call(c);
    const usd = (r.input * p.input + r.output * p.output + (r.cacheRead ?? 0) * ((p as { cachedInput?: number }).cachedInput ?? p.input) + (r.cacheWrite ?? 0) * p.input * 1.25) / 1e6;
    ledger.spentUsd += usd;
    const b = (ledger.byModel[`${role} ${m.choice.model}`] ??= { calls: 0, input: 0, output: 0, usd: 0 });
    b.calls++; b.input += r.input + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0); b.output += r.output; b.usd += usd;
    saveLedger();
    return r;
  } };
}

// ---- Ground truth: every figure printed in a table cell, by page, row label and column. ----
type Cell = { page: number; label: string; column: string; text: string; value: number };
const num = (x: string) => { const m = x.replace(/,/g, "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const norm = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function truthCells(truth: { page_lines: { page: number; lines: { kind: string; cells: string[] }[] }[] }, pages: Set<number>): Cell[] {
  const out: Cell[] = [];
  for (const pg of truth.page_lines) {
    if (!pages.has(pg.page)) continue;
    let header: string[] = [];
    for (const ln of pg.lines) {
      if (ln.kind === "table_header") header = ln.cells;
      if (ln.kind === "table_row") ln.cells.slice(1).forEach((c, i) => { const v = num(c); if (v != null && /\d/.test(c)) out.push({ page: pg.page, label: ln.cells[0], column: header[i + 1] ?? "", text: c, value: v }); });
    }
  }
  return out;
}

/** Stand-in models for the fake mode: reader 1 replays nothing (no reading), so the fake mode builds its own reading. */
function fakeChecker(cells: Cell[]): TableModel {
  return { choice: { provider: "anthropic", model: "fake-checker" }, async call(c) {
    const page = Number(/^Page (\d+)/.exec(c.user)?.[1]);
    const answers = [...c.user.matchAll(/<q id="(q\d+)">([\s\S]*?)<\/q>/g)].map(([, id, q]) => {
      const row = /the row "([^"]+)"/.exec(q)?.[1], col = /in the column "([^"]+)"/.exec(q)?.[1];
      const hit = cells.find((x) => x.page === page && norm(x.label) === norm(row) && (!col || norm(x.column) === norm(col)));
      return { id, printed: hit?.text ?? null };
    });
    return { json: { answers }, stopReason: "end_turn", model: "fake-checker", input: 2000, output: 100, ms: 1 };
  } };
}

/** Each figure the reading uses (claimsOf's order), with the row it came from, scored against the truth. */
function score(checked: CheckedReading, record: GuardRecord | undefined, cells: Cell[]) {
  const claims = claimsOf(checked);
  const sources: { label: string; column: string | null; page: number; field: string }[] = [];
  for (const b of checked.benefits) {
    if (b.value != null) sources.push({ label: b.benefit, column: b.column, page: b.source.page, field: "value" });
    if (b.cap != null && b.capSource) sources.push({ label: b.benefit, column: b.column, page: b.capSource.page, field: "cap" });
  }
  for (const c of checked.covers) {
    if (c.sumInsured != null) sources.push({ label: c.cover, column: null, page: c.source.page, field: "sum_insured" });
    if (c.premium != null) sources.push({ label: c.cover, column: null, page: (c.premiumSource ?? c.source).page, field: "premium" });
  }
  const t = { figures: claims.length, matched: 0, unmatched: 0, rightAccepted: 0, rightFlagged: 0, wrongAccepted: 0, wrongCaught: 0, stillChecking: 0, caughtWithTruthOffered: 0 };
  const wrongAccepted: unknown[] = [], rightFlagged: unknown[] = [], unmatched: unknown[] = [];
  claims.forEach((c, i) => {
    const s = sources[i];
    const v = record?.verdicts[c.key];
    if (!v || v.status === "checking") { t.stillChecking++; return; }
    const same = cells.filter((x) => x.page === s.page && norm(s.label).includes(norm(x.label).slice(0, 14)) && (!s.column || !x.column || norm(s.column) === norm(x.column)));
    if (!same.length) { t.unmatched++; unmatched.push({ page: s.page, label: s.label, column: s.column, value: c.value, status: v.status }); return; }
    t.matched++;
    const right = same.some((x) => Math.abs(x.value - c.value) < 0.005);
    const accepted = v.status === "agreed" || v.status === "corrected";
    if (right && accepted) t.rightAccepted++;
    else if (right) { t.rightFlagged++; rightFlagged.push({ page: s.page, label: s.label, column: s.column, value: c.value, truth: same.map((x) => x.text), candidates: v.candidates }); }
    else if (accepted) { t.wrongAccepted++; wrongAccepted.push({ page: s.page, label: s.label, column: s.column, value: c.value, truth: same.map((x) => x.text), rounds: v.rounds }); }
    else { t.wrongCaught++; if (same.some((x) => v.candidates.some((n) => Math.abs(n - x.value) < 0.005))) t.caughtWithTruthOffered++; }
  });
  return { tally: t, wrongAccepted, rightFlagged: rightFlagged.slice(0, 50), unmatched: unmatched.slice(0, 50) };
}

async function oneDoc(doc: string) {
  const outPath = join(outDir, `${doc}.json`);
  if (existsSync(outPath)) { console.log(doc, "already done"); return; }
  const truth = JSON.parse(readFileSync(join(ROOT, "truth", `${doc}.json`), "utf8"));
  const ocr: string[] = JSON.parse(readFileSync(join(ROOT, "run-1", doc, "parsed-pages.json"), "utf8"));
  const figurePages = truth.page_lines.filter((p: { lines: { kind: string }[] }) => p.lines.some((l) => l.kind === "table_row")).map((p: { page: number }) => p.page).slice(0, perDoc) as number[];
  const pages = figurePages.map((n) => ({ page: n, text: ocr[n - 1] ?? "" }));
  const cells = truthCells(truth, new Set(figurePages));
  if (mode === "plan") { console.log(doc, truth.mode, `${figurePages.length} figure pages, ${cells.length} truth figures`); return; }
  const t0 = Date.now();
  const DOC = "00000000-0000-4000-8000-0000000000d1", ACC = "00000000-0000-4000-8000-0000000000a1";
  let stored: StoredReading | null = null;
  const db: Db = async (sql, params) => {
    if (/FROM policies\s/.test(sql) && /original_filename/.test(sql)) return [{ id: DOC, original_filename: `${doc}.pdf`, processing_status: "ready", product_name: null, insurer: null,
      document_role: null, policy_number: null, quarantine_status: null, scan_result_detail: null, reading_live: false, scan_live: false, link_only: false, carried: false }];
    if (/FROM policy_pages/.test(sql)) return pages.map((p) => ({ policy_id: DOC, page_number: p.page, text: p.text }));
    if (/INSERT INTO benefit_readings/.test(sql)) { stored = JSON.parse(String(params[2])); return []; }
    return [];
  };
  const pdf = new Uint8Array(readFileSync(join(ROOT, "pdf", `${doc}.pdf`)));
  // Every page here was read by Baidu: all of them are checked against the page, as scans are in production.
  const source = async () => ({ nativePages: [] as number[], page: async (n: number) => ({ kind: "pdf" as const, mediaType: "application/pdf", data: Buffer.from(await realPageFileTools.onePage(pdf, n)).toString("base64") }) });
  const [c1, c2] = imageCheckModels();
  const fake = mode === "fake";
  const checker = (choice: typeof c1, role: string) => admitted(fake ? fakeChecker(cells) : anthropicTableModel(choice, undefined, { effort: supportsEffort(choice.model) }), PAGE_TOKENS, role);
  const setup: GuardSetup = { kind: "image", first: { model: checker(c1, "checker1") }, second: { model: checker(c2, "checker2") }, capUsd: Infinity, source };
  let result: unknown;
  if (fake) {
    // No reader in the fake mode: reader 1's reading is made from the truth, with every 10th figure taken from the next
    // column of its row (a misread the page text cannot show: the figure is printed in the row).
    let n = 0;
    const misread = (c: Cell) => cells.find((x) => x !== c && x.page === c.page && x.label === c.label && Math.abs(x.value - c.value) > 0.005)?.value ?? c.value;
    const benefits = cells.map((c) => ({ section: "Benefits", column: c.column || null, benefit: c.label, pays: "amount", value: ++n % 10 === 0 ? misread(c) : c.value, period: null, basis: null,
      percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: c.page, quote: (pages.find((p) => p.page === c.page)?.text.split("\n").find((l) => l.includes(c.label)) ?? c.label) }));
    const json = { document: { kind: "scheme_terms", product: truth.product, namedPeople: [], plan: null }, covers: [], benefits };
    const reader: TableModel = { choice: { provider: "anthropic", model: "fake-reader" }, async call() { return { json, stopReason: "end_turn", model: "fake-reader", input: 1, output: 1, ms: 1 }; } };
    result = await readDocument(db, reader, ACC, DOC, undefined, {}, setup);
  } else {
    result = await readDocument(db, admitted(anthropicTableModel(benefitTableModel()), 0, "reader1"), ACC, DOC, undefined, {}, setup);
  }
  if (ledger.stopped) throw new CapReached(ledger.stopped);
  if (!stored) { writeFileSync(outPath, JSON.stringify({ doc, mode: truth.mode, result, note: "no reading stored" }, null, 1)); console.log(doc, "no reading", result); return; }
  const s = stored as StoredReading;
  const sdoc: SourceDoc = { id: DOC, name: `${doc}.pdf`, readable: true, pages };
  const checked = checkStored(sdoc, s);
  const sc = score(checked, s.guards, cells);
  const out = { doc, mode: truth.mode, pages: figurePages, truthFigures: cells.length, seconds: Math.round((Date.now() - t0) / 1000), result,
    check: { stopped: s.guards?.stopped ?? null, calls: s.guards?.calls ?? 0, spentUsd: s.guards?.spentUsd ?? 0 }, ...sc };
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(doc, truth.mode, JSON.stringify(sc.tally), `run spend so far US$${ledger.spentUsd.toFixed(2)}`);
}

(async () => {
  try {
    for (const d of docs) await oneDoc(d);
    if (mode !== "plan") { ledger.stopped = null; saveLedger(); }
  } catch (e) {
    if (e instanceof CapReached) console.log("STOPPED:", e.message);
    else throw e;
  }
  if (mode !== "plan") console.log(JSON.stringify({ spentUsd: ledger.spentUsd, calls: ledger.calls, stopped: ledger.stopped }));
})();

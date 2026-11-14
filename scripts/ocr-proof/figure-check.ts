/**
 * Step 2 prototype (test tooling, never run by the app): the app's OWN benefit reading (lib/benefit-table/service.ts
 * readDocument, reader 1) and its OWN figure guards (guards.ts + guard-run.ts: four more readers, five in all, must agree
 * on every figure) run on page text from a file, with a stand-in database, then every figure is scored against the
 * ground truth of a made-up document.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/ocr-proof/figure-check.ts <truth.json> <pages.json> <out.json> [firstPage] [lastPage] [capUsd]
 *
 * pages.json: an array of page texts (page 1 first), e.g. run-baidu.ts's parsed-pages.json (what our parser kept from
 * Baidu). Uses DEARPOLICY_ANTHROPIC_KEY. Spend is counted from the API's own token counts at the listed prices.
 * Cap: before each reader-1 call its worst case (whole prompt at the uncached input price, ~3.5 characters a token, plus
 * every output token allowed) is added to the spend so far; a call that could pass capUsd is not made and the run stops.
 * The guards keep their own cap (readDocument's guard budget, the same capUsd).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readDocument, checkStored, type Db, type StoredReading } from "@/lib/benefit-table/service";
import { applyGuards } from "@/lib/benefit-table/guards";
import { anthropicTableModel, type TableModel, type TableReply } from "@/lib/benefit-table/model";
import { benefitTableModel } from "@/lib/benefit-table/flag";
import { guardRoster, supportsEffort } from "@/lib/benefit-table/guard-flag";
import { priceFor, type ModelChoice } from "@/lib/ai/providers";
import type { SourceDoc } from "@/lib/benefit-table/check";

const [truthPath, pagesPath, outPath, firstArg, lastArg, capArg] = process.argv.slice(2);
const truth = JSON.parse(readFileSync(truthPath, "utf8"));
const allPages: string[] = JSON.parse(readFileSync(pagesPath, "utf8"));
const first = Number(firstArg ?? 1), last = Number(lastArg ?? allPages.length);
const pages = allPages.map((text, i) => ({ page: i + 1, text })).filter((p) => p.page >= first && p.page <= last);
const capUsd = Number(capArg ?? 0.6);

const DOC = "00000000-0000-4000-8000-0000000000d1", ACC = "00000000-0000-4000-8000-0000000000a1";
let stored: StoredReading | null = null;
// A stand-in database: one household, one document, its pages; the reading is captured instead of saved.
const db: Db = async (sql, params) => {
  if (/FROM policies\s/.test(sql) && /original_filename/.test(sql)) return [{ id: DOC, original_filename: `${truth.doc}.pdf`, processing_status: "ready",
    product_name: null, insurer: null, document_role: null, policy_number: null, quarantine_status: null, scan_result_detail: null, reading_live: false, scan_live: false, link_only: false, carried: false }];
  if (/FROM policy_pages/.test(sql)) return pages.map((p) => ({ policy_id: DOC, page_number: p.page, text: p.text }));
  if (/INSERT INTO benefit_readings/.test(sql)) { stored = JSON.parse(String(params[2])); return []; }
  return [];
};

const spend: Record<string, { calls: number; input: number; output: number; usd: number }> = {};
const usage = (choice: ModelChoice) => (what: string, r: TableReply) => {
  const p = priceFor(choice) ?? { input: 5, output: 25, cachedInput: 0.5 };
  const k = `${choice.model} ${what}`;
  const s = (spend[k] ??= { calls: 0, input: 0, output: 0, usd: 0 });
  s.calls++; s.input += r.input; s.output += r.output;
  s.usd += (r.input * p.input + r.output * p.output + (r.cacheRead ?? 0) * (p.cachedInput ?? p.input) + (r.cacheWrite ?? 0) * p.input * 1.25) / 1e6;
};

const spentSoFar = () => Object.values(spend).reduce((a, s) => a + s.usd, 0);
/** Reader 1 admitted on its worst case before every call (see the note at the top). */
function capped(m: TableModel): TableModel {
  return { choice: m.choice, async call(c) {
    const p = priceFor(m.choice) ?? { input: 5, output: 25 };
    const worst = (Math.ceil((c.system.length + c.user.length + JSON.stringify(c.schema).length) / 3.5) * p.input + c.maxTokens * p.output) / 1e6;
    if (spentSoFar() + worst > capUsd) throw new Error(`stopped: a reader call's worst case US$${worst.toFixed(4)} would pass the US$${capUsd} cap`);
    return m.call(c);
  } };
}

(async () => {
  const t0 = Date.now();
  const readerChoice = benefitTableModel();
  const reader = capped(anthropicTableModel(readerChoice));
  const guards = { readers: [{ model: reader, prompt: "direct" as const, onUsage: usage(readerChoice) },
    ...guardRoster().map((g) => ({ model: anthropicTableModel(g.choice, undefined, { effort: supportsEffort(g.choice.model) }), prompt: g.prompt, onUsage: usage(g.choice) }))], capUsd };
  const result = await readDocument(db, reader, ACC, DOC, usage(readerChoice), {}, guards);
  const seconds = Math.round((Date.now() - t0) / 1000);
  if (!stored) { writeFileSync(outPath, JSON.stringify({ result, seconds, spend }, null, 1)); console.log("no reading", result); return; }
  const doc: SourceDoc = { id: DOC, name: `${truth.doc}.pdf`, readable: true, pages };
  const s = stored as StoredReading;
  const checked = checkStored(doc, s);
  const guarded = applyGuards(checked, s.guards);

  // Ground truth: every money figure / percentage printed in a table cell or schedule line on the pages read.
  const num = (x: string) => { const m = x.replace(/,/g, "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
  type T = { page: number; label: string; column: string; text: string; value: number };
  const want: T[] = [];
  for (const pg of truth.page_lines) {
    if (pg.page < first || pg.page > last) continue;
    let header: string[] = [];
    for (const ln of pg.lines) {
      if (ln.kind === "table_header") header = ln.cells;
      if (ln.kind === "table_row") ln.cells.slice(1).forEach((c: string, i: number) => { const v = num(c); if (v != null && /\d/.test(c)) want.push({ page: pg.page, label: ln.cells[0], column: header[i + 1] ?? "", text: c, value: v }); });
    }
  }
  const norm = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const rows = (b: typeof guarded.benefits) => b.map((x) => ({ page: x.source.page, label: x.benefit, column: x.column, value: x.value, pays: x.pays, cap: x.cap }));
  const score = (bs: ReturnType<typeof rows>) => {
    let right = 0, wrong = 0, missing = 0; const wrongs: unknown[] = [], missed: unknown[] = [];
    for (const w of want) {
      const same = bs.filter((b) => b.page === w.page && norm(b.label).includes(norm(w.label).slice(0, 14)) && (!b.column || !w.column || norm(b.column) === norm(w.column)));
      if (!same.length) { missing++; missed.push(w); continue; }
      if (same.some((b) => b.value === w.value || b.cap === w.value)) right++; else { wrong++; wrongs.push({ want: w, got: same.map((b) => [b.value, b.cap, b.pays]) }); }
    }
    return { truthFigures: want.length, right, wrong, missing, wrongs: wrongs.slice(0, 30), missed: missed.slice(0, 30) };
  };
  const verdicts = Object.values(s.guards?.verdicts ?? {});
  const tally = verdicts.reduce<Record<string, number>>((a, v) => { a[v.status] = (a[v.status] ?? 0) + 1; return a; }, {});
  const usd = Object.values(spend).reduce((a, x) => a + x.usd, 0);
  const out = { doc: truth.doc, mode: truth.mode, pages: [first, last], seconds, usd: Math.round(usd * 10000) / 10000, spend, result,
    guardStopped: s.guards?.stopped ?? null, guardVerdicts: tally,
    reader1: score(rows(checked.benefits)), afterGuards: score(rows(guarded.benefits)),
    confirmAsked: verdicts.filter((v) => v.status === "confirm").map((v) => ({ page: v.page, line: v.line, candidates: v.candidates })) };
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ doc: out.doc, seconds, usd: out.usd, guardVerdicts: tally, reader1: { ...out.reader1, wrongs: undefined, missed: undefined }, afterGuards: { ...out.afterGuards, wrongs: undefined, missed: undefined } }));
})();

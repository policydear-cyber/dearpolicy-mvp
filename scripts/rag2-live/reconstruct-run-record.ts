/**
 * Rebuilds a courier run's missing summary record (run.json) from what the repository already holds about that run:
 * its LEDGER.json entry and its own responses.jsonl. Used once, for fx-live-2 (20 Oct), whose run.json was never
 * committed, so the ledger reconciliation (rag2:live-ledger L10) could not read it.
 *
 * It never writes a figure it cannot reproduce: the call count and the booked spend (the upper bound, no cached-input
 * discount, as fx-live-1's record books it) are recomputed from each recorded response's own usage with the price on
 * file, and must equal the ledger entry exactly, or nothing is written. The record says it was rebuilt, from what and
 * when, so it can never pass for one written at the time. An existing run.json is never overwritten.
 *   node --import tsx scripts/rag2-live/reconstruct-run-record.ts <run folder> <run_id>
 */
import fs from "node:fs";
import path from "node:path";
import { costUsd, type ModelChoice } from "@/lib/ai/providers";

export type LedgerEntry = { run_id: string; tested_code_sha: string; preflight: boolean; spent_usd: number; reserved_unsettled_usd: number; calls: number; refused: number; failed: number };

export function reconstructRunRecord(entry: LedgerEntry, responsesJsonl: string, opts: { model: string; folder: string; at: string }) {
  const choice: ModelChoice = { provider: "openai", model: opts.model };
  const lines = responsesJsonl.split("\n").filter((l) => l.trim());
  let upper = 0, estimate = 0, ok = 0, failed = 0;
  for (const line of lines) {
    const row = JSON.parse(line) as { status: number; response: string };
    if (row.status !== 200) { failed++; continue; }
    const body = JSON.parse(row.response) as { model?: string; usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } } };
    if (!body.usage) throw new Error("a recorded response has no usage: its cost cannot be reproduced");
    if (body.model && !body.model.startsWith(opts.model)) throw new Error(`a recorded response is from ${body.model}, not ${opts.model}`);
    const u = { input: body.usage.prompt_tokens, output: body.usage.completion_tokens };
    const up = costUsd(choice, u), est = costUsd(choice, { ...u, cached: body.usage.prompt_tokens_details?.cached_tokens ?? 0 });
    if (up == null || est == null) throw new Error(`no price on file for openai:${opts.model}`);
    upper += up; estimate += est; ok++;
  }
  const spent = Number(upper.toFixed(6)), est = Number(estimate.toFixed(6));
  if (ok !== entry.calls) throw new Error(`responses.jsonl holds ${ok} answered calls; the ledger books ${entry.calls}: refusing to write`);
  if (failed !== entry.failed) throw new Error(`responses.jsonl holds ${failed} failed calls; the ledger books ${entry.failed}: refusing to write`);
  if (spent !== entry.spent_usd) throw new Error(`the recorded usage costs US$${spent}; the ledger books US$${entry.spent_usd}: refusing to write`);
  if (entry.reserved_unsettled_usd !== 0) throw new Error("the ledger entry still holds an unsettled reservation: refusing to write");
  return {
    runId: entry.run_id, testedCodeSha: entry.tested_code_sha, model: opts.model, preflight: entry.preflight,
    budgetUsed: { spentUsd: spent, reservedUsd: 0, calls: ok, refusals: entry.refused, failed },
    estimatedCostUsd: est, upperBoundCostUsd: spent,
    reconstructed: true,
    reconstructedFrom: ["docs/rag-migration/live/LEDGER.json", path.posix.join(opts.folder, "responses.jsonl")],
    reconstructedAt: opts.at,
    note: "Summary record REBUILT after the run, not written at the time: the original run.json was never committed. Every figure is recomputed by scripts/rag2-live/reconstruct-run-record.ts from this folder's responses.jsonl (each response's own usage, priced with lib/ai/providers.ts) and equals the LEDGER.json entry exactly; spentUsd is the upper bound without the cached-input discount, estimatedCostUsd applies it. Neither is provider-billed. The full record is README.md, report.md and responses.jsonl in this folder.",
  };
}

if (process.argv[1] && /reconstruct-run-record\.ts$/.test(process.argv[1])) {
  const [folder, runId] = process.argv.slice(2);
  if (!folder || !runId) { console.error("usage: reconstruct-run-record.ts <run folder> <run_id>"); process.exit(2); }
  const out = path.join(folder, "run.json");
  if (fs.existsSync(out)) { console.error(`${out} already exists: never overwritten`); process.exit(1); }
  const ledger = JSON.parse(fs.readFileSync("docs/rag-migration/live/LEDGER.json", "utf8")) as { runs: LedgerEntry[] };
  const entries = ledger.runs.filter((r) => r.run_id === runId);
  if (entries.length !== 1) { console.error(`expected one ledger entry for ${runId}, found ${entries.length}`); process.exit(1); }
  const record = reconstructRunRecord(entries[0], fs.readFileSync(path.join(folder, "responses.jsonl"), "utf8"), { model: "gpt-6-luna", folder, at: new Date().toISOString().slice(0, 10) });
  fs.writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  console.log(`wrote ${out}: ${record.budgetUsed.calls} calls, US$${record.budgetUsed.spentUsd} (matches the ledger)`);
}

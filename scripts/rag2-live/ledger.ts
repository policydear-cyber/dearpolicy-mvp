/**
 * Live-model smoke: the CUMULATIVE ledger of the whole exercise (docs/rag-migration/live/LEDGER.json). All live runs
 * together stay within exercise_cap_usd (US$0.50): a run's cap is min(request cap, 0.50 - sum of every earlier run's
 * spent + reserved-but-unsettled); a run is refused when nothing remains or when its run_id was already used. Each run
 * appends its own entry, committed together with its results (.github/workflows/rag2-live-smoke.yml).
 *   node --import tsx scripts/rag2-live/ledger.ts plan   --ledger <LEDGER.json> --request <run-request.json>
 *   node --import tsx scripts/rag2-live/ledger.ts append --ledger <LEDGER.json> --run-id <id> --tested-sha <sha>
 *        --request-sha <sha> --cap <usd> --preflight <true|false> [--run-dir <RUN folder>]
 * `plan` writes run_id, scenarios, cap, remaining and preflight to $GITHUB_OUTPUT when it is set.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EXERCISE_CAP_USD = 0.5;
export type LedgerRun = {
  run_id: string; tested_code_sha: string; request_sha: string; at: string; preflight: boolean; run_cap_usd: number;
  spent_usd: number; reserved_unsettled_usd: number; calls: number; refused: number; failed: number; note?: string;
};
export type Ledger = { exercise_cap_usd: number; runs: LedgerRun[] };
export type RunRequest = { run_id: string; scenarios: string[]; run_cap_usd: number; preflight: boolean };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
export function remainingUsd(l: Ledger): number {
  const used = l.runs.reduce((n, r) => n + (Number(r.spent_usd) || 0) + (Number(r.reserved_unsettled_usd) || 0), 0);
  return round6(Math.min(l.exercise_cap_usd, EXERCISE_CAP_USD) - used);
}
/** kind "ingest" (scripts/ingest-live/run-request.json): no scenarios; the live ingestion test shares this ledger. */
export function validateRequest(r: any, kind: "rag2" | "ingest" = "rag2"): RunRequest {
  const fail = (m: string): never => { throw new Error("run-request.json refused: " + m); };
  if (typeof r?.run_id !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(r.run_id)) fail("run_id: 1-40 of A-Z a-z 0-9 . _ -");
  if (kind === "ingest") r = { ...r, scenarios: ["ingest"] };
  else if (!Array.isArray(r.scenarios) || !r.scenarios.length || !r.scenarios.every((s: unknown) => typeof s === "string" && /^L[1-6][a-z]?$/.test(s))) fail("scenarios: a non-empty list of scenario ids (L1..L6, optional letter suffix)");
  const cap = Number(r.run_cap_usd);
  if (!Number.isFinite(cap) || cap <= 0 || cap > EXERCISE_CAP_USD) fail("run_cap_usd must be > 0 and <= 0.50");
  if (typeof r.preflight !== "boolean") fail("preflight must be true or false");
  return { run_id: r.run_id, scenarios: r.scenarios, run_cap_usd: cap, preflight: r.preflight };
}
export function validateLedger(l: any): Ledger {
  if (!l || typeof l !== "object" || !Array.isArray(l.runs)) throw new Error("LEDGER.json: { exercise_cap_usd, runs: [] } expected");
  if (Number(l.exercise_cap_usd) !== EXERCISE_CAP_USD) throw new Error("LEDGER.json: exercise_cap_usd must be 0.50");
  return l as Ledger;
}
/** The cap this run may use, or why it may not start. */
export function planRun(l: Ledger, req: RunRequest): { ok: true; capUsd: number; remainingUsd: number } | { ok: false; reason: string } {
  const remaining = remainingUsd(l);
  const latest = l.runs[l.runs.length - 1];
  if (latest && latest.run_id === req.run_id) return { ok: false, reason: `run_id "${req.run_id}" is the latest ledger entry: pick a new run_id` };
  if (l.runs.some((r) => r.run_id === req.run_id)) return { ok: false, reason: `run_id "${req.run_id}" was already used` };
  if (remaining <= 0) return { ok: false, reason: `the exercise budget is used up: US$${remaining.toFixed(6)} of US$${l.exercise_cap_usd} remains` };
  return { ok: true, capUsd: round6(Math.min(remaining, req.run_cap_usd)), remainingUsd: remaining };
}
/** The ledger entry for a finished (or crashed) run. Without a run.json the spend is unknown: it is counted at the run's
 * whole cap, never at 0. */
export function entryFor(run: any | null, m: { runId: string; testedSha: string; requestSha: string; capUsd: number; preflight: boolean; at?: string }): LedgerRun {
  const base = { run_id: m.runId, tested_code_sha: m.testedSha, request_sha: m.requestSha, at: m.at ?? new Date().toISOString(), preflight: m.preflight, run_cap_usd: m.capUsd };
  const b = run?.budgetUsed;
  if (!b) return { ...base, spent_usd: m.preflight ? 0 : m.capUsd, reserved_unsettled_usd: 0, calls: 0, refused: 0, failed: 0, note: m.preflight ? "no run.json (preflight: no model call possible)" : "no run.json: spend unknown, counted at the run cap" };
  return { ...base, spent_usd: round6(Number(b.spentUsd) || 0), reserved_unsettled_usd: round6(Number(b.reservedUsd) || 0), calls: Number(b.calls) || 0, refused: Number(b.refusals) || 0, failed: Number(b.failed) || 0 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (n: string) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const need = (n: string) => arg(n) ?? (() => { throw new Error(`--${n} is required`); })();
  try {
    const cmd = process.argv[2];
    const ledgerPath = need("ledger");
    const ledger = validateLedger(JSON.parse(fs.readFileSync(ledgerPath, "utf8")));
    if (cmd === "plan") {
      const req = validateRequest(JSON.parse(fs.readFileSync(need("request"), "utf8")), arg("kind") === "ingest" ? "ingest" : "rag2");
      const p = planRun(ledger, req);
      if (!p.ok) throw new Error(p.reason);
      const out = { run_id: req.run_id, scenarios: req.scenarios.join(","), cap: String(p.capUsd), remaining: String(p.remainingUsd), preflight: String(req.preflight) };
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
      console.log(`run ${req.run_id}: scenarios ${out.scenarios}; exercise remaining US$${p.remainingUsd}; run cap US$${p.capUsd} (request ${req.run_cap_usd}); preflight ${req.preflight}`);
    } else if (cmd === "append") {
      const dir = arg("run-dir");
      const runJson = dir && fs.existsSync(path.join(dir, "run.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")) : null;
      const e = entryFor(runJson, { runId: need("run-id"), testedSha: need("tested-sha"), requestSha: need("request-sha"), capUsd: Number(need("cap")), preflight: need("preflight") === "true" });
      ledger.runs.push(e);
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
      console.log(`ledger: ${e.run_id} spent US$${e.spent_usd} (+${e.reserved_unsettled_usd} unsettled), ${e.calls} calls, ${e.refused} refused, ${e.failed} failed; exercise remaining US$${remainingUsd(ledger)}`);
    } else throw new Error("usage: ledger.ts plan|append ...");
  } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}

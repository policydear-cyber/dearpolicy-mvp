/** report.md for a live ingestion run (scripts/ingest-live/run.ts). Plain facts from the run folder; no judgement here. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const read = (dir: string, f: string) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; };
const usd = (n: unknown) => (typeof n === "number" ? "US$" + n.toFixed(6) : "-");
const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, "<br>");

/** The whole exercise's spend from docs/rag-migration/live/LEDGER.json (shared with the rag2 live smoke), with this run
 * added when the ledger does not list it yet (CI appends it after the report is written). */
export function exerciseSpendLine(run: any, ledgerPath = "docs/rag-migration/live/LEDGER.json"): string {
  let ledger: any = null;
  try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { return "**Exercise spend**: LEDGER.json not readable"; }
  const runs: any[] = ledger.runs ?? [];
  const used = (r: any) => (Number(r.spent_usd) || 0) + (Number(r.reserved_unsettled_usd) || 0);
  const listed = runs.some((r) => r.run_id === run.runId);
  const before = runs.filter((r) => r.run_id !== run.runId).reduce((n, r) => n + used(r), 0);
  const mine = listed ? used(runs.find((r) => r.run_id === run.runId)) : (Number(run.budgetUsed?.spentUsd) || 0) + (Number(run.budgetUsed?.reservedUsd) || 0);
  const cap = Number(ledger.exercise_cap_usd) || 0.5;
  return `**Exercise spend (LEDGER.json)**: ${usd(before + mine)} of US$${cap.toFixed(2)} -- ${runs.filter((r) => r.run_id !== run.runId).length} earlier run(s) ${usd(before)} + this run ${usd(mine)}${listed ? "" : " (not yet in the ledger)"}; ${usd(cap - before - mine)} left`;
}

export function writeIngestReport(dir: string): string {
  const run = read(dir, "run.json") ?? {};
  const uploads: any[] = read(dir, "uploads.json") ?? [];
  const linking: any[] = read(dir, "linking.json") ?? [];
  const transcript: any[] = read(dir, "transcript.json") ?? [];
  const verdict = read(dir, "verdict.json");
  const journey = read(dir, "journey.json");
  const L: string[] = [];
  L.push(exerciseSpendLine(run), "", `# Live ingestion test -- ${run.label ?? "run"}`, "");
  L.push(`- **Tested code**: \`${run.testedCodeSha ?? "?"}\` (request commit \`${run.requestSha ?? "-"}\`), tree \`${run.tree ?? "?"}\`, build ${run.buildId ?? "?"}`);
  L.push(`- **Models requested**: ${Object.entries(run.modelsRequested ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}; **provider-reported**: ${(run.providerModels ?? []).join(", ") || "none (no call sent)"}`);
  L.push(`- **Spend**: ${usd(run.budgetUsed?.spentUsd)} of a ${usd(run.budgetUsed?.capUsd)} run cap; ${run.budgetUsed?.calls ?? 0} calls sent, ${run.budgetUsed?.refusals ?? 0} refused, ${run.budgetUsed?.failed ?? 0} failed; reserved-unsettled ${usd(run.budgetUsed?.reservedUsd)}`);
  L.push(`- **Verdict**: ${verdict?.verdict ?? "not graded"}${verdict?.failed != null ? ` (${verdict.passed} checks passed, ${verdict.failed} failed)` : ""}`);
  if (run.preflightNote) L.push(`- **Preflight**: ${run.preflightNote}`);
  if (run.error) L.push(`- **Harness error**: ${run.error}`);
  if (journey?.failures?.length) L.push(`- **Journey problems**: ${journey.failures.map((f: string) => cell(f)).join("; ")}`);
  L.push("", "## Uploads (through the policies page; processing by request drain)", "", "| file | final | time to final | states | linked automatically | needs review | screenshots |", "|---|---|---|---|---|---|---|");
  for (const u of uploads) L.push(`| ${u.file} | ${u.finalStatus}${u.error ? "<br>" + cell(u.error) : ""} | ${Math.round((u.msToFinal ?? 0) / 1000)} s | ${cell(u.states.map((s: any) => `${s.state} @${Math.round(s.at / 1000)}s`).join(" → "))} | ${cell(u.linked.join(", ") || "nobody")} | ${u.needsReview ? cell(u.reviewReason ?? "yes") : "no"} | ${u.screenshots.map((s: string) => `[${path.basename(s)}](${s})`).join(" ")} |`);
  L.push("", "## Library and automatic person links", "", "| file | product | linked | detected names (matched) |", "|---|---|---|---|");
  for (const l of linking) L.push(`| ${l.file} | ${cell(l.product)} | ${cell(l.linked.join(", ") || "nobody")} | ${cell(l.detected.map((d: any) => `${d.name}${d.matched ? " → " + d.matched : ""}`).join("; "))} |`);
  L.push("", "Extracted page text per document: `extracted/` (after processing: `dump-processing/extracted/`). Stored records, jobs and provenance: `dump-processing/dump.json`, `dump-final/dump.json`.");
  L.push("", "## Conversation (in the browser)", "");
  for (const t of transcript) {
    L.push(`### ${t.id} -- ${t.phase} -- ${Math.round(t.ms / 1000)} s`, "", `**User** (${t.via}): ${cell(t.user)}`, "", `**DearPolicy**: ${t.error ? "[ERROR SHOWN] " + cell(t.error) : t.stuck ? "[no reply in time]" : cell(t.answer)}`, "");
    if (t.citationsShown?.length) L.push(`Sources shown: ${cell(t.citationsShown.join("; "))}`, "");
    if (t.pendingQuestion) L.push(`Asks: ${cell(t.pendingQuestion)}${t.unansweredFollowUp ? " (no fixture answer)" : ""}`, "");
    const lp = t.loop;
    if (lp) {
      L.push(`<details><summary>Loop: ${lp.outcome ?? "?"}, ${lp.steps ?? "?"} step(s)${lp.limit ? ", LIMIT " + cell(typeof lp.limit === "string" ? lp.limit : JSON.stringify(lp.limit)) : ""}, ${lp.usage ? `${lp.usage.input} in / ${lp.usage.output} out tokens` : "no usage"}, ${lp.latencyMs ?? "?"} ms</summary>`, "");
      L.push("| # | tool | ok | error / result | evidence |", "|---|---|---|---|---|");
      lp.toolCalls.forEach((c: any, k: number) => L.push(`| ${k + 1} | ${c.name} | ${c.ok ? "yes" : "**no**"} | ${cell(c.error ?? c.summary ?? (c.args ? JSON.stringify(c.args).slice(0, 160) : ""))} | ${c.evidence} |`));
      if (Array.isArray(lp.calls) && lp.calls.length) L.push("", `Per call (tokens in/out): ${lp.calls.map((c: any, k: number) => `${k + 1}: ${c.input ?? c.usage?.input ?? "?"}/${c.output ?? c.usage?.output ?? "?"}`).join("; ")}`);
      if (lp.gate?.length) L.push("", `Gate: ${cell(JSON.stringify(lp.gate).slice(0, 600))}`);
      if (lp.dropped?.length) L.push("", `Composer dropped: ${cell(JSON.stringify(lp.dropped).slice(0, 600))}`);
      L.push("", "</details>", "");
    } else if (!t.error && !t.stuck) L.push("_No loop trace stored for this turn._", "");
    L.push(`![${t.id}](${t.screenshot})`, "");
  }
  if (verdict?.checks?.length) {
    L.push("## Deterministic checks (EXPECTED.json, copied in after the conversations)", "", "| scope | check | result | detail |", "|---|---|---|---|");
    for (const c of verdict.checks) L.push(`| ${cell(c.scope)} | ${cell(c.check)} | ${c.ok ? "PASS" : "**FAIL**"} | ${cell(c.detail)} |`);
  }
  L.push("", "## Every provider request (process-wide fetch guard)", "", "| seq | kind | model → reported | provider request id | status / refused | in | cached | out | reasoning | reserved | charged | ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const c of run.httpCalls ?? []) L.push(`| ${c.seq} | ${c.kind ?? "-"}${c.pdf ? ` (pdf ${c.pdf.map((p: any) => p.pages + "p").join(",")})` : ""} | ${c.model ?? "-"} → ${c.providerModel ?? "-"} | ${c.providerRequestId ?? "-"} | ${c.refused ? "refused: " + cell(c.refused) : c.status ?? cell(c.error)} | ${c.usage?.input ?? 0} | ${c.usage?.cached ?? 0} | ${c.usage?.output ?? 0} | ${c.usage?.reasoning ?? "-"} | ${usd(c.reservedUsd)} | ${usd(c.chargedUsd)} | ${c.upstreamMs ?? "-"} |`);
  if (run.provenance?.length) {
    L.push("", "## App provenance (model_executions) joined to the guard's calls", "", "| operation | attempt | requested | resolved provider / model | provider request id | status | in | cached | out | cost | guard seq |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of run.provenance) L.push(`| ${r.operation} | ${r.attempt_index} | ${r.requested_provider}:${r.requested_model} | ${r.resolved_provider ?? "-"}:${r.resolved_model ?? "-"} | ${r.provider_request_id ?? "-"} | ${r.status}${r.error_category ? " (" + r.error_category + ")" : ""} | ${r.input_tokens} | ${r.cached_tokens} | ${r.output_tokens} | ${usd(r.cost_usd == null ? null : Number(r.cost_usd))} | ${r.guardSeq ?? "-"} |`);
  }
  return L.join("\n") + "\n";
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) { const d = process.argv[2]; fs.writeFileSync(path.join(d, "report.md"), writeIngestReport(d)); console.log("wrote " + path.join(d, "report.md")); }

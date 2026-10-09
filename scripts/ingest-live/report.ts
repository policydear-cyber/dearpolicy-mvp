/** report.md for a live ingestion run (scripts/ingest-live/run.ts). Plain facts from the run folder; no judgement here. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const read = (dir: string, f: string) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; };
const usd = (n: unknown) => (typeof n === "number" ? "US$" + n.toFixed(6) : "-");
const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, "<br>");

export function writeIngestReport(dir: string): string {
  const run = read(dir, "run.json") ?? {};
  const uploads: any[] = read(dir, "uploads.json") ?? [];
  const linking: any[] = read(dir, "linking.json") ?? [];
  const transcript: any[] = read(dir, "transcript.json") ?? [];
  const verdict = read(dir, "verdict.json");
  const journey = read(dir, "journey.json");
  const L: string[] = [];
  L.push(`# Live ingestion test -- ${run.label ?? "run"}`, "");
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

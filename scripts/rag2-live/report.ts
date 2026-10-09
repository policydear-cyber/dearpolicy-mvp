/**
 * Live-model smoke: the compact markdown report for one run (written next to run.json by scripts/rag2-live/run.ts).
 * Re-write it from a saved run:  node --import tsx scripts/rag2-live/report.ts docs/rag-migration/live/RUN-<timestamp>
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const usd = (n: number | null | undefined) => (n == null ? "-" : "US$" + n.toFixed(5));
const ms = (n: number | null | undefined) => (n == null ? "-" : (n / 1000).toFixed(1) + " s");
const cell = (t: unknown) => String(t ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function writeReport(run: any): string {
  const L: string[] = [];
  const plumbing = /PLUMBING/.test(run.label ?? "");
  L.push(`# ${run.preflight ? "PREFLIGHT" : plumbing ? "PLUMBING TEST" : "Live model run"}${run.runId ? " " + run.runId : ""} — ${run.startedAt}`);
  L.push("");
  if (run.preflight) L.push(`> **PREFLIGHT — no model call made; US$${(run.budgetUsed?.spentUsd ?? 0).toFixed(2)} spent.** Build, seed, server and the /api/chat path ran; the run-cap guard refused the first model call.${run.keyNote ? ` **${run.keyNote}** (the run was forced to preflight).` : ""}`, "", `- Stopped at: ${run.preflightStop?.detail ?? "before the first model call (no conversation reached the model)"}`);
  // What a reader needs first: the code and request tested, the models, the settings actually sent, every call.
  L.push(`- Tested code: \`${run.testedCodeSha ?? run.commit ?? "?"}\`; run request commit: \`${run.requestSha ?? "-"}\``);
  const mr = run.modelsRequested ?? {};
  L.push(`- Models requested: ${Object.entries(mr).map(([k, v]) => `${k}=\`${v ?? "(unset)"}\``).join(", ") || "`" + (run.model?.requested ?? "?") + "`"}; provider-reported: ${(run.providerModels ?? []).map((m: string) => "`" + m + "`").join(", ") || "none"}`);
  L.push(`- Request settings actually sent: ${(run.promptObserved?.settings ?? []).map((x: any) => "`" + JSON.stringify(x) + "`").join(" ") || "none (no model request was sent)"}`);
  if (run.availability) L.push(`- Model availability check (GET /v1/models/<model>, free): ${run.availability.status}${run.availability.id ? ` id \`${run.availability.id}\`` : ""}`);
  if (run.stoppedBeforeStart) L.push(`- **Stopped before any conversation:** ${run.stoppedBeforeStart}`);
  if (run.error) L.push(`- **Harness error:** ${cell(run.error)}`);
  const hc: any[] = run.httpCalls ?? [];
  if (hc.length) {
    L.push("", "| # | Scenario / turn | Model → reported | Status | Tokens in / out (cached, reasoning) | Reserved | Charged | Upstream |", "|---|---|---|---|---|---|---|---|");
    for (const c of hc) L.push(`| ${c.seq} | ${c.scenario ?? "-"} t${c.turn ?? "-"} | ${c.model ?? "-"} → ${c.providerModel ?? "-"} | ${c.refused ? "refused: " + cell(c.refused).slice(0, 80) : c.status ?? cell(c.error ?? "-")} | ${c.usage ? `${c.usage.input} / ${c.usage.output} (${c.usage.cached}, ${c.usage.reasoning ?? "-"})` : "-"} | ${usd(c.reservedUsd)} | ${usd(c.chargedUsd)} | ${ms(c.upstreamMs)} |`);
  } else L.push("- Model calls: none sent");
  L.push("");
  L.push(`- Mode: ${run.mode ?? "relay"}${run.mode === "direct" ? " (GitHub Actions; OpenAI called directly with the repository secret, never logged)" : " (loopback relay)"}`);
  if (plumbing) L.push("> **PLUMBING TEST — NOT MODEL RESULTS.** The \"model\" was a local fake OpenAI-compatible endpoint (scripts/rag2-live/plumbing_fake.py) behind the real relay and app path. Verdicts below only show that the harness, relay, accounting and checker work end to end.", "");
  L.push(`- Code: \`${run.commit?.slice(0, 7)}\` (tree \`${run.tree?.slice(0, 8)}\`${run.dirty ? ", **uncommitted changes**" : ""}); served build \`${run.buildId}\``);
  L.push(`- Model requested: \`${run.model?.requested}\`; provider-reported: ${(run.providerModels ?? []).map((m: string) => "`" + m + "`").join(", ") || "none"}; price on file US$${run.model?.pricePerMillion?.input}/M in, US$${run.model?.pricePerMillion?.output}/M out`);
  L.push(`- Request settings sent: ${(run.promptObserved?.settings ?? []).map((s: any) => "`" + JSON.stringify(s) + "`").join(" ") || "`" + JSON.stringify(run.model?.settings) + "` (expected)"}`);
  L.push(`- Prompt \`${run.prompt?.version}\`: system sha256 \`${run.prompt?.systemPromptSha256?.slice(0, 12)}\`, tool schema sha256 \`${run.prompt?.toolSchemaSha256?.slice(0, 12)}\` (${run.prompt?.tools} tools); what was sent ${!(run.promptObserved?.systemPromptSha256?.length) ? "-- nothing (no model call made)" : run.promptMatchesSource ? "matches the source" : "**differs from the source (the served build is not this commit's prompt/tools)**"}`);
  const b = run.budgetUsed ?? {};
  L.push(`- Budget: run cap ${usd(run.budget?.runCapUsd)}; spent ${usd(b.spentUsd)} over ${b.calls ?? 0} calls; refused ${b.refusals ?? 0}`);
  L.push("");
  L.push("| Scenario | Verdict | Failure stage | Turns | First useful | Total | Calls | Tokens in/out | Cost |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const c of run.conversations ?? []) {
    if (c.notRun) { L.push(`| ${c.scenario} ${cell(c.title)} | NOT RUN | ${cell(c.notRun)} | | | | | | |`); continue; }
    const v = c.verdict;
    L.push(`| ${c.scenario} ${cell(c.title)} | ${v?.verdict ?? "NO ANSWER"} | ${cell(v?.failureStage ?? v?.incomplete ?? "")} | ${c.turns?.length ?? 0} | ${ms(c.firstUsefulResponseMs)} | ${ms(c.totalMs)} | ${c.calls ?? 0} | ${c.tokens?.input ?? 0}/${c.tokens?.output ?? 0} | ${usd(c.costUsd)} |`);
  }
  L.push("");
  for (const c of run.conversations ?? []) {
    if (c.notRun) continue;
    L.push(`## ${c.scenario} — ${c.title}: ${c.verdict?.verdict ?? "NO ANSWER"}${c.verdict?.failureStage ? ` (${c.verdict.failureStage})` : ""}`);
    for (const t of c.turns ?? []) {
      L.push(`- **Turn ${t.turn}** — “${cell(t.user)}”`);
      L.push(`  - Answer: ${t.visible ? "“" + cell(t.visible).slice(0, 500) + "”" : t.error ?? t.jobError ?? "(none)"}`);
      const tr = c.saved?.traces?.[t.turn - 1];
      if (tr) L.push(`  - Tools: ${(tr.toolCalls ?? []).map((x: any) => x.name + (x.ok ? "" : "✗")).join(" → ") || "none"}; outcome ${tr.outcome}${tr.limit ? ` (limit ${tr.limit.kind})` : ""}; evidence ${(tr.evidenceChosen ?? []).join(", ") || "none"}`);
      L.push(`  - Time: accepted ${ms(t.timings?.acceptedMs)}, answer saved ${ms(t.timings?.firstAssistantPersistedMs)}, seen ${ms(t.timings?.answerSeenMs)}; model ${ms(t.timings?.modelMs)} (upstream ${ms(t.timings?.upstreamMs)}${run.mode === "direct" ? "" : " via the relay"}); ${t.calls?.length ?? 0} calls, ${t.tokens?.input ?? 0}/${t.tokens?.output ?? 0} tokens, ${usd(t.costUsd?.charged)}`);
    }
    const failed = (c.verdict?.checks ?? []).filter((k: any) => !k.ok);
    if (failed.length) { L.push("- Failed checks:"); for (const k of failed) L.push(`  - t${k.turn} [${k.stage}] ${cell(k.name)}: ${cell(k.detail).slice(0, 240)}`); }
    else if (c.verdict) L.push(`- All ${c.verdict.checks.length} checks passed.`);
    L.push("");
  }
  return L.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: report.ts <RUN directory>"); process.exit(1); }
  fs.writeFileSync(path.join(dir, "report.md"), writeReport(JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"))));
  console.log("wrote " + path.join(dir, "report.md"));
}

import path from "node:path";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* optional outside local dev */ }

/** Measures what one evidence-reading call actually costs on this machine.
 *
 * Reading a policy is one structured model call per evidence section, so the
 * product's responsiveness is that cost multiplied by the sections a question
 * needs. The decisive comparison is between a trivial output schema and the real
 * one: Ollama compiles the schema into a generation grammar, and bounded string
 * lengths and numeric ranges make that grammar enormous.
 * Read-only: touches no policies and no database. */
const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.LLM_MODEL ?? "qwen3:8b";
const gigabytes = (n: number) => (n / 1024 ** 3).toFixed(2) + " GB";
const seconds = (nanoseconds: number) => nanoseconds / 1e9;
const EVIDENCE = ("Benefit 3: Simple Fracture. We pay 25% of the S$5,000 benefit limit for a fracture of the wrist. " +
  "Ambulance costs are reimbursed up to S$500 per incident. Daily hospital cash of S$30 per day is payable after the 10th day, " +
  "maximum of 30 continuous days. The diagnosis must satisfy the defined illness. ").repeat(6).slice(0, 3300);

async function callOnce(format: unknown, outputTokens: number) {
  const response = await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: false, think: false, keep_alive: "5m", format,
      options: { temperature: 0, num_ctx: Number(process.env.LLM_CONTEXT_SIZE ?? 4096), num_batch: Number(process.env.LLM_NUM_BATCH ?? 256), num_predict: outputTokens },
      messages: [
        { role: "system", content: "Read insurance evidence for this contract. Extract benefits, observations and next steps using exact source quotes. Never calculate a payout." },
        { role: "user", content: JSON.stringify({ sources: [{ id: "source-a", pages: [1, 1], text: EVIDENCE }], confirmedCoverages: [{ id: "cover-a", product: "Group Personal Accident", amount: 600000, currency: "SGD" }] }) },
      ],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error("Ollama returned HTTP " + response.status + ": " + (await response.text()).slice(0, 200));
  return await response.json() as Record<string, number>;
}
async function timeVariant(label: string, format: unknown, outputTokens: number) {
  process.stdout.write("  " + label.padEnd(34));
  try {
    const result = await callOnce(format, outputTokens);
    const total = seconds(result.total_duration ?? 0);
    const rate = (result.eval_count ?? 0) / Math.max(1e-9, seconds(result.eval_duration ?? 0));
    console.log(total.toFixed(1) + "s   (" + (result.eval_count ?? 0) + " output tokens at " + rate.toFixed(1) + "/sec)");
    return total;
  } catch (error) {
    console.log("failed — " + (error instanceof Error ? error.message : String(error)));
    return Number.NaN;
  }
}

async function main() {
  const { z } = await import("zod");
  const { PolicyAnalysisSchema } = await import("../lib/chat/policy-analysis");
  const { readingOutputTokens } = await import("../lib/chat/policy-analysis");

  console.log("DearPolicy local model benchmark");
  console.log("Model: " + model + "   Ollama: " + base + "\n");
  try {
    const tags = await fetch(base + "/api/tags", { signal: AbortSignal.timeout(5000) });
    if (!tags.ok) throw new Error("HTTP " + tags.status);
  } catch {
    console.error("Could not reach Ollama at " + base + ". Start Ollama, then run this again.");
    process.exit(1);
  }

  console.log("Warming up (this loads the model)…");
  const warm = await callOnce({ type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, 32);
  console.log("  model load: " + seconds(warm.load_duration ?? 0).toFixed(1) + "s\n");

  const running = await (await fetch(base + "/api/ps")).json() as { models?: { name: string; size: number; size_vram: number }[] };
  const entry = running.models?.find(m => m.name.startsWith(model.split(":")[0]));
  if (entry) {
    const onGpu = entry.size_vram / Math.max(1, entry.size);
    console.log("Placement: " + gigabytes(entry.size_vram) + " of " + gigabytes(entry.size) + " in VRAM (" + Math.round(onGpu * 100) + "%)");
    console.log(onGpu < 0.98 ? "  ! Part of this model runs on the CPU — expect slow generation.\n" : "  ok Fully on the GPU.\n");
  }

  // Time is output tokens divided by generation rate. Nothing else moves the
  // needle much, so the benchmark reports the token count beside every timing.
  const outputTokens = readingOutputTokens();
  console.log("One evidence section (3,300 characters):");
  const trivial = await timeVariant("minimal output schema", { type: "object", properties: { benefits: { type: "array", items: { type: "string" } } }, required: ["benefits"] }, outputTokens);
  const real = await timeVariant("DearPolicy reading schema", z.toJSONSchema(PolicyAnalysisSchema), outputTokens);
  console.log("\n  Output budget: " + outputTokens + " tokens (RAG_READING_OUTPUT_TOKENS).");

  const windows = Number(process.env.RAG_MAX_EVIDENCE_WINDOWS ?? 8);
  console.log("  A question reading up to " + windows + " sections takes about " + Math.round(real * windows) + "s (RAG_MAX_EVIDENCE_WINDOWS).\n");

  if (!Number.isFinite(real)) console.log("VERDICT: the reading call failed — see the error above.");
  else if (real <= 10) console.log("VERDICT: healthy at " + real.toFixed(1) + "s per section.");
  else console.log("VERDICT: " + real.toFixed(1) + "s per section. Generation rate is fine; the cost is how many tokens the model writes."
    + "\n  Lower RAG_READING_OUTPUT_TOKENS (try 600) and RAG_MAX_EVIDENCE_WINDOWS (try 4) for faster, shallower answers."
    + (Number.isFinite(trivial) ? "\n  A minimal schema takes " + trivial.toFixed(1) + "s, so " + (real - trivial).toFixed(1) + "s of this is the extracted policy detail itself." : ""));
  await fetch(base + "/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: 0 }) }).catch(() => undefined);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

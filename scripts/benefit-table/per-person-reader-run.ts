/** The real reader on the made-up adversarial certificates (per-person-adversarial-cases.ts): does it mark a row
 * "each_named_insured" only when the page says so and nothing limits it to some of the people, and does the table then
 * show each person only their own figures? Each certificate is read alone with the production reading prompt and
 * schema; every section of a certificate is linked to that certificate's own cover (what the linker does for a
 * one-cover certificate). The verdict per case: OK, UNSAFE (someone shown a figure that is not theirs) or MISS.
 *
 *   Estimate (free):  node --import tsx scripts/benefit-table/per-person-reader-run.ts --max-usd 1 [--cases N3,N4]
 *   Paid:             ... --paid --run-id <id> --max-usd <cap> --out <dir outside the repo> [--cases ...]
 *   Replay (free):    ... --replay <dir>
 *
 * A call starts only if the run stays under the cap with the call's whole input and its maximum output. No retries. */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { priceFor, type ModelChoice } from "@/lib/ai/providers";
import { API_BASE_URL, apiKeyFromEnv } from "@/lib/simple-chat/model";
import { checkReading, type CheckedReading, type SourceDoc } from "@/lib/benefit-table/check";
import { assembleTable, coverKeyOf, figureText, sectionKeyOf } from "@/lib/benefit-table/assemble";
import { READING_PROMPT, READING_SCHEMA, renderDocument } from "@/lib/benefit-table/reading";
import { BASE_FAMILY, CASES, NAME, NOW, type Case, type Doc } from "./per-person-adversarial-cases";

const MAX_OUTPUT = 3_500;
const tokensOf = (s: string) => Math.ceil(s.length / 2.5);
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const paid = process.argv.includes("--paid"), replay = arg("--replay");
const choice = { provider: "anthropic", model: "claude-sonnet-5-5" } as ModelChoice;
const price = priceFor(choice)!;
const usdOf = (input: number, output: number) => (input * price.input + output * price.output) / 1e6;
const only = arg("--cases")?.split(",").map((s) => s.trim());
const cases = CASES.filter((k) => !only || only.includes(k.id));
const docKey = (k: Case, i: number) => `${k.id}-${i}`;
const sourceOf = (d: Doc): SourceDoc => ({ id: d.id, name: `${d.id}.pdf`, readable: true, pages: [{ page: 1, text: d.text }] });

async function read(d: Doc): Promise<{ json: unknown; input: number; output: number; stopReason: string | null }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: apiKeyFromEnv().key, baseURL: API_BASE_URL });
  const params = { model: choice.model, max_tokens: MAX_OUTPUT, system: READING_PROMPT, messages: [{ role: "user" as const, content: renderDocument({ name: `${d.id}.pdf`, pages: [{ page: 1, text: d.text }] }) }],
    output_config: { effort: "medium" as const, format: { type: "json_schema" as const, schema: READING_SCHEMA as Record<string, unknown> } } };
  const m = await (client as unknown as { messages: { stream(p: typeof params): { finalMessage(): Promise<{ content: { type: string; text?: string }[]; stop_reason: string | null; usage: { input_tokens?: number | null; output_tokens?: number | null } }> } } })
    .messages.stream(params).finalMessage();
  const text = m.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
  let json: unknown = null;
  try { json = m.stop_reason === "end_turn" ? JSON.parse(text) : null; } catch { json = null; }
  return { json, input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0, stopReason: m.stop_reason };
}

function grade(k: Case, readings: CheckedReading[]): { status: string; line: string } {
  const links = readings.flatMap((r) => {
    const key = r.covers[0] ? coverKeyOf(r.covers[0]) : null;
    const secs = new Set(r.benefits.map((b) => sectionKeyOf(r.documentId, b)));
    return key ? [...secs].map((section) => ({ section, cover: key, why: "the certificate's own cover" })) : [];
  });
  const t = assembleTable(readings, k.family ?? BASE_FAMILY, links, [], NOW);
  const got: Record<string, string[]> = {};
  for (const p of t.people) got[p.id] = p.rows.filter((x) => x.figure.kind !== "none").map((x) => `${x.benefit}=${figureText(x.figure)}`);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const issues: string[] = [];
  for (const id of Object.keys(NAME)) {
    if (k.safeOnly?.includes(id)) continue;
    const exp = k.expect[id] ?? [];
    const g = got[id] ?? [];
    const match = (e: string, x: string) => { const [name, fig] = e.split("="); const [xn, xf] = [x.split("=")[0], x.slice(x.indexOf("=") + 1)];
      return (norm(xn).includes(norm(name)) || norm(name).includes(norm(xn))) && (!fig || xf.replace(/[^0-9]/g, "").includes(fig.replace(/[^0-9]/g, ""))); };
    const extra = g.filter((x) => !exp.some((e) => match(e, x)) && !(k.safeOnly ?? []).some((s) => norm(x).startsWith(norm(s))));
    const missing = exp.filter((e) => !g.some((x) => match(e, x)));
    if (extra.length) issues.push(`UNSAFE ${id} got [${extra.join("; ")}]`);
    if (missing.length) issues.push(`MISS ${id} lacks [${missing.join("; ")}]`);
  }
  const marks = readings.flatMap((r) => r.benefits.map((b) => `${b.benefit}: ${b.forWhom ?? "-"}`)).join("; ");
  const status = issues.some((i) => i.startsWith("UNSAFE")) ? "UNSAFE" : issues.length ? "MISS" : "OK";
  return { status, line: `${status.padEnd(6)} ${k.id.padEnd(4)} ${k.what}\n        reader: ${marks}\n        shown: ${JSON.stringify(got)}${issues.length ? `\n        ${issues.join("\n        ")}` : ""}` };
}

async function main() {
  const docs = cases.flatMap((k) => k.docs.map((d, i) => ({ k, d, key: docKey(k, i), input: tokensOf(READING_PROMPT + renderDocument({ name: `${d.id}.pdf`, pages: [{ page: 1, text: d.text }] })) })));
  const maxUsd = Number(arg("--max-usd") ?? "1");
  const worst = docs.reduce((n, x) => n + usdOf(x.input, MAX_OUTPUT), 0);
  if (!paid && !replay) {
    console.log(`${cases.length} cases, ${docs.length} certificates, worst case US$${worst.toFixed(4)} (${choice.model}, max output ${MAX_OUTPUT}); cap US$${maxUsd}: ${worst <= maxUsd ? "all admitted" : "some would not start"}`);
    return;
  }
  const out = resolve(replay ?? arg("--out") ?? "");
  if (!replay && !arg("--out")) throw new Error("--out is required");
  mkdirSync(out, { recursive: true });
  if (realpathSync(out).startsWith(realpathSync(process.cwd()))) throw new Error("--out must be outside the repository");
  const runId = arg("--run-id");
  if (paid) {
    if (!runId) throw new Error("--run-id is required for a paid run");
    if (existsSync(resolve(out, "usage.json"))) throw new Error(`${out} already holds a run; use a new --run-id and --out`);
  }
  const usage: { doc: string; input: number; output: number; usd: number; stopReason: string | null }[] = [];
  let spent = 0;
  const raw = new Map<string, unknown>();
  for (const x of docs) {
    const file = resolve(out, `raw-${x.key}.json`);
    if (replay) { raw.set(x.key, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null); continue; }
    if (spent + usdOf(x.input, MAX_OUTPUT) > maxUsd) { console.log(`Stopped before ${x.key}: its worst case would pass the cap`); break; }
    const r = await read(x.d);
    const usd = usdOf(r.input, r.output);
    spent += usd;
    usage.push({ doc: x.key, input: r.input, output: r.output, usd, stopReason: r.stopReason });
    writeFileSync(file, JSON.stringify(r.json, null, 1));
    raw.set(x.key, r.json);
    console.log(`${x.key}: ${r.input} in, ${r.output} out, US$${usd.toFixed(4)}, ${r.stopReason}`);
  }
  if (paid) writeFileSync(resolve(out, "usage.json"), JSON.stringify({ runId, model: choice.model, spent, usage }, null, 1));
  const lines: string[] = [];
  const tally: Record<string, number> = {};
  for (const k of cases) {
    const readings = k.docs.map((d, i) => raw.get(docKey(k, i)) ? checkReading(sourceOf(d), raw.get(docKey(k, i)) as never) : null);
    if (readings.some((r) => !r)) { lines.push(`NOREAD ${k.id}`); tally.NOREAD = (tally.NOREAD ?? 0) + 1; continue; }
    const g = grade(k, readings as CheckedReading[]);
    tally[g.status] = (tally[g.status] ?? 0) + 1;
    lines.push(g.line);
  }
  const summary = `${runId ?? "replay"}: ${JSON.stringify(tally)}${paid ? `, spent US$${spent.toFixed(4)}` : ""}`;
  writeFileSync(resolve(out, replay ? "grade-replay.txt" : "grade.txt"), `${lines.join("\n")}\n${summary}\n`);
  console.log(lines.join("\n"));
  console.log(summary);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

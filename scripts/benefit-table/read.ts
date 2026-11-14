/** The benefit table's test reading: read each document of a household snapshot once, check the rows, link sections to
 * covers, and write each person's table. Nothing is written to the database.
 *
 *   Estimate (free):  node --import tsx scripts/benefit-table/read.ts --household-file snapshot.json [--max-usd 2]
 *   Paid:             ... --paid --model anthropic:claude-sonnet-5-5 --run-id <id> --max-usd <cap> --out <dir>
 *   Replay (free):    ... --replay <dir>   (re-runs today's checks and table on the recorded model output)
 *   Page check:       add --page-check to read again, one at a time, the pages whose figures the document's reading left
 *                     mostly unread (lib/benefit-table/completeness.ts); with --replay it re-uses the recorded page reads
 *   Part re-read:     ... --paid ... --only "<file>,<file>" --reuse <earlier dir>   (reads only those documents; the
 *                     others use the earlier run's recorded readings, which the output says)
 *
 * A call is admitted only if the run stays under the cap with its whole input and a maximum-length output. One call per
 * document plus one linking call, no retries. Output holds real household text, so --out must be outside git. */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { priceFor, type ModelChoice } from "@/lib/ai/providers";
import { API_BASE_URL, apiKeyFromEnv } from "@/lib/simple-chat/model";
import { checkReading, type CheckedReading, type SourceDoc } from "@/lib/benefit-table/check";
import { assembleTable, coversOf, figureText, sectionsOf, type BenefitTable, type FamilyMember } from "@/lib/benefit-table/assemble";
import { LINKING_PROMPT, LINKING_SCHEMA, READING_PROMPT, READING_SCHEMA, pageReadingNote, renderDocument, renderLinkingInput, type SectionLink } from "@/lib/benefit-table/reading";
import { mergeReadings, pagesToReread } from "@/lib/benefit-table/completeness";

export const READ_MAX_OUTPUT = 24_000;
export const LINK_MAX_OUTPUT = 8_000;
export const PAGE_MAX_OUTPUT = 8_000;
/** Tokens from characters, set to run high: DC's library read 561k characters as 216k tokens (2.6 per token). */
const tokensOf = (s: string) => Math.ceil(s.length / 2.5);
type Price = { input: number; output: number };
const usdOf = (p: Price, input: number, output: number) => (input * p.input + output * p.output) / 1e6;

type Snapshot = { accountId: string; members: { name: string; relationship: string }[];
  documents: { policyId: string; name: string; processingStatus?: string | null; pages: { page: number; text: string }[] }[] };
export const familyOf = (s: Snapshot): FamilyMember[] => s.members.map((m, i) => ({ id: `m${i}`, display_name: m.name.replace(/\s*\([^)]*\)\s*$/, "") }));
// people: the household's names, so the premium check refuses a page naming another member (as the app's service does).
export const sourcesOf = (s: Snapshot): SourceDoc[] => s.documents.map((d) => ({ id: d.policyId, name: d.name, readable: !d.processingStatus || d.processingStatus === "ready", pages: d.pages,
  people: familyOf(s).map((m) => m.display_name) }));

type Call = { system: string; user: string; schema: unknown; maxTokens: number };
type Reply = { json: unknown; stopReason: string | null; model: string; input: number; output: number; ms: number };
async function callModel(choice: ModelChoice, c: Call): Promise<Reply> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: apiKeyFromEnv().key, baseURL: API_BASE_URL });
  const started = Date.now();
  const params = { model: choice.model, max_tokens: c.maxTokens, system: c.system, messages: [{ role: "user" as const, content: c.user }],
    output_config: { effort: "medium" as const, format: { type: "json_schema" as const, schema: c.schema as Record<string, unknown> } } };
  const message = await (client as unknown as { messages: { stream(p: typeof params): { finalMessage(): Promise<{ content: { type: string; text?: string }[]; stop_reason: string | null; model: string; usage: { input_tokens?: number | null; output_tokens?: number | null } }> } } })
    .messages.stream(params).finalMessage();
  const text = message.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
  let json: unknown = null;
  try { json = message.stop_reason === "end_turn" ? JSON.parse(text) : null; } catch { json = null; }
  return { json, stopReason: message.stop_reason, model: message.model, input: message.usage.input_tokens ?? 0, output: message.usage.output_tokens ?? 0, ms: Date.now() - started };
}

export function tableMarkdown(table: BenefitTable, readings: CheckedReading[], header: string): string {
  const lines = [header, ""];
  for (const p of table.people) {
    lines.push(`## ${p.name}`, "");
    if (!p.covers.length && !p.rows.length) { lines.push("No cover in the uploaded documents names this person.", ""); continue; }
    lines.push("Covers (from a personal document):", "");
    for (const c of p.covers) lines.push(`- ${c.product} · ${c.cover}${c.riderOf ? ` (rider of ${c.riderOf})` : ""}${c.plan ? ` · plan ${c.plan}` : ""}${c.policyNumber ? ` · policy ${c.policyNumber}` : ""}: ${c.sumInsured == null ? "no sum insured printed" : `${c.currency ?? "currency not stated"} ${c.sumInsured.toLocaleString("en-US")}`}${c.premium != null ? `; premium ${c.premium.toLocaleString("en-US")}${c.premiumFrequency ? ` ${c.premiumFrequency}` : ""}` : ""}${c.asOf ? ` (as of ${c.asOf})` : ""}${c.startDate || c.endDate ? ` [${c.startDate ?? "?"} to ${c.endDate ?? "?"}]` : ""}. ${c.source.document} p${c.source.page}`);
    lines.push("", "| Cover | Benefit | Column | Figure | Conditions | Source |", "|---|---|---|---|---|---|");
    for (const r of p.rows) lines.push(`| ${r.cover} | ${r.benefit.replace(/\|/g, "/")} | ${r.column ?? ""} | ${figureText(r.figure).replace(/\|/g, "/")} | ${r.conditions.map((c) => c.replace(/\|/g, "/").slice(0, 120)).join("; ")} | ${r.source.document} p${r.source.page} |`);
    lines.push("");
  }
  lines.push("## Not on anyone's table", "");
  for (const u of table.unlinkedSections) lines.push(`- ${u.section.document}: ${u.section.section ?? "(no heading)"}${u.section.column ? ` [${u.section.column}]` : ""}, e.g. ${u.section.examples.join("; ")}. Why: ${u.why}`);
  for (const c of table.illustrationCovers) lines.push(`- In an illustration (a quotation), not proof of cover: ${c.cover} for ${c.person}, ${c.source.document} p${c.source.page}`);
  for (const c of table.unmatchedCovers) lines.push(`- Cover printed for ${c.person} (not a family member): ${c.cover}, ${c.source.document} p${c.source.page}`);
  for (const l of table.refusedLinks) lines.push(`- Link refused (${l.why}): ${l.link.section} -> ${l.link.cover}`);
  lines.push("", "## Rows the server dropped", "");
  for (const r of readings) for (const d of r.dropped) lines.push(`- ${r.document}: ${d.what}: ${d.why}`);
  return lines.join("\n") + "\n";
}

async function main() {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const file = arg("--household-file");
  if (!file) throw new Error("--household-file is required");
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  const family = familyOf(snapshot);
  const docs = sourcesOf(snapshot);
  const readable = docs.filter((d) => d.readable);
  const choice: ModelChoice = { provider: "anthropic", model: (arg("--model") ?? "anthropic:claude-sonnet-5-5").replace(/^anthropic:/, "") } as ModelChoice;
  const price = priceFor(choice);
  if (!price) throw new Error(`No price for ${choice.model}`);
  const maxUsd = Number(arg("--max-usd") ?? "2");
  const prompt = tokensOf(READING_PROMPT) + tokensOf(JSON.stringify(READING_SCHEMA));
  const worst = readable.map((d) => ({ d, input: prompt + tokensOf(renderDocument(d)) }));
  const linkWorst = tokensOf(LINKING_PROMPT) + 8_000;

  const replay = arg("--replay");
  const paid = process.argv.includes("--paid");
  if (!paid && !replay) {
    let total = 0;
    for (const w of worst) { const usd = usdOf(price, w.input, READ_MAX_OUTPUT); total += usd; console.log(`${w.d.name}: ${w.d.pages.length} pages, ~${w.input} input tokens, worst US$${usd.toFixed(4)}`); }
    const link = usdOf(price, linkWorst, LINK_MAX_OUTPUT); total += link;
    const inputOnly = usdOf(price, worst.reduce((n, w) => n + w.input, 0) + linkWorst, 0);
    console.log(`linking call: worst US$${link.toFixed(4)}`);
    console.log(`Every call at its maximum output: US$${total.toFixed(4)}. Input alone: US$${inputOnly.toFixed(4)}. Skipped (not readable): ${docs.filter((d) => !d.readable).map((d) => d.name).join(", ") || "none"}.`);
    console.log(`With --max-usd ${maxUsd}, a call starts only if the run stays under US$${maxUsd} at that call's maximum output.`);
    return;
  }

  const out = resolve(replay ?? arg("--out") ?? "");
  if (!replay && !arg("--out")) throw new Error("--out is required");
  const repo = realpathSync(resolve(process.cwd()));
  mkdirSync(out, { recursive: true });
  if (realpathSync(out).startsWith(repo)) throw new Error("--out must be outside the repository: the output holds household text");
  const rawPath = (id: string) => resolve(out, `raw-${id}.json`);
  let spent = 0;
  const log: string[] = [];
  const say = (m: string) => { console.log(m); log.push(m); };
  if (paid) {
    const runId = arg("--run-id");
    if (!runId) throw new Error("--run-id is required for a paid run");
    if (existsSync(resolve(out, "usage.json"))) throw new Error(`${out} already holds a run; use a new --run-id and --out`);
    say(`Run ${runId}: ${choice.model}, cap US$${maxUsd}, ${readable.length} documents, started ${new Date().toISOString()}`);
  }

  const readings: CheckedReading[] = [];
  const usage: { call: string; input: number; output: number; usd: number; ms: number; stopReason: string | null; model: string }[] = [];
  const only = arg("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const reuse = arg("--reuse");
  if (only && !reuse) throw new Error("--only needs --reuse <earlier run dir> for the other documents");
  for (const w of worst) {
    let reply: Reply;
    if (paid && only && !only.includes(w.d.name)) {
      const earlier = resolve(reuse!, `raw-${w.d.id}.json`);
      if (!existsSync(earlier)) { say(`${w.d.name}: not read, and no earlier reading to reuse`); continue; }
      reply = JSON.parse(readFileSync(earlier, "utf8")) as Reply;
      writeFileSync(rawPath(w.d.id), JSON.stringify({ ...reply, reusedFrom: earlier }, null, 1));
      say(`${w.d.name}: reused the reading recorded in ${earlier} (not read again)`);
    } else if (paid) {
      if (spent + usdOf(price, w.input, READ_MAX_OUTPUT) > maxUsd) { say(`Stopped before ${w.d.name}: its worst case would pass the cap`); break; }
      try {
        reply = await callModel(choice, { system: READING_PROMPT, user: renderDocument(w.d), schema: READING_SCHEMA, maxTokens: READ_MAX_OUTPUT });
      } catch (error) { say(`${w.d.name}: call failed: ${error instanceof Error ? error.message : String(error)}`); break; }
      writeFileSync(rawPath(w.d.id), JSON.stringify(reply, null, 1));
      const usd = usdOf(price, reply.input, reply.output);
      spent += usd;
      usage.push({ call: w.d.name, input: reply.input, output: reply.output, usd, ms: reply.ms, stopReason: reply.stopReason, model: reply.model });
      writeFileSync(resolve(out, "usage.json"), JSON.stringify({ spentUsd: spent, calls: usage }, null, 1));
      say(`${w.d.name}: ${(reply.ms / 1000).toFixed(1)} s, ${reply.input} in / ${reply.output} out, US$${usd.toFixed(4)} (total US$${spent.toFixed(4)}), stop ${reply.stopReason}`);
    } else {
      if (!existsSync(rawPath(w.d.id))) { say(`${w.d.name}: no recorded reading`); continue; }
      reply = JSON.parse(readFileSync(rawPath(w.d.id), "utf8")) as Reply;
    }
    let reading = checkReading(w.d, reply.json);
    if (process.argv.includes("--page-check")) {
      const headings = [...new Set(reading.benefits.map((b) => b.section).filter((h): h is string => !!h))];
      for (const f of pagesToReread(w.d, reading)) {
        const pagePath = resolve(out, `raw-${w.d.id}-p${f.page}.json`);
        let pageReply: Reply | null = null;
        const page = { name: w.d.name, pages: w.d.pages.filter((p) => p.page === f.page) };
        if (paid) {
          const input = prompt + tokensOf(renderDocument(page)) + 400;
          if (spent + usdOf(price, input, PAGE_MAX_OUTPUT) > maxUsd) { say(`${w.d.name} p${f.page}: page check stopped, its worst case would pass the cap`); continue; }
          try {
            pageReply = await callModel(choice, { system: READING_PROMPT, user: renderDocument(page) + pageReadingNote(f.page, headings), schema: READING_SCHEMA, maxTokens: PAGE_MAX_OUTPUT });
          } catch (error) { say(`${w.d.name} p${f.page}: call failed: ${error instanceof Error ? error.message : String(error)}`); continue; }
          writeFileSync(pagePath, JSON.stringify(pageReply, null, 1));
          const usd = usdOf(price, pageReply.input, pageReply.output);
          spent += usd;
          usage.push({ call: `${w.d.name} p${f.page}`, input: pageReply.input, output: pageReply.output, usd, ms: pageReply.ms, stopReason: pageReply.stopReason, model: pageReply.model });
          writeFileSync(resolve(out, "usage.json"), JSON.stringify({ spentUsd: spent, calls: usage }, null, 1));
        } else if (existsSync(pagePath)) pageReply = JSON.parse(readFileSync(pagePath, "utf8")) as Reply;
        if (!pageReply) continue;
        const before = reading.benefits.length + reading.covers.length;
        reading = mergeReadings(reading, checkReading(w.d, pageReply.json, { notesKind: reading.kind }));
        say(`${w.d.name} p${f.page} (${f.figureLines} figure lines, ${f.rowsRead} rows read): +${reading.benefits.length + reading.covers.length - before} rows${paid ? `, US$${usdOf(price, pageReply.input, pageReply.output).toFixed(4)} (total US$${spent.toFixed(4)}), stop ${pageReply.stopReason}` : ""}`);
      }
    }
    readings.push(reading);
  }

  const sections = sectionsOf(readings);
  const { types } = coversOf(readings, family);
  let links: SectionLink[] = [];
  const linksPath = resolve(out, "links.json");
  if (paid) {
    const input = tokensOf(LINKING_PROMPT) + tokensOf(renderLinkingInput(sections, types)) + tokensOf(JSON.stringify(LINKING_SCHEMA));
    if (!sections.length || !types.length) say("Linking skipped: no sections or no covers");
    else if (spent + usdOf(price, input, LINK_MAX_OUTPUT) > maxUsd) say("Linking stopped: its worst case would pass the cap");
    else {
      try {
        const reply = await callModel(choice, { system: LINKING_PROMPT, user: renderLinkingInput(sections, types), schema: LINKING_SCHEMA, maxTokens: LINK_MAX_OUTPUT });
        const usd = usdOf(price, reply.input, reply.output);
        spent += usd;
        usage.push({ call: "linking", input: reply.input, output: reply.output, usd, ms: reply.ms, stopReason: reply.stopReason, model: reply.model });
        writeFileSync(resolve(out, "usage.json"), JSON.stringify({ spentUsd: spent, calls: usage }, null, 1));
        writeFileSync(linksPath, JSON.stringify(reply, null, 1));
        say(`linking: ${(reply.ms / 1000).toFixed(1)} s, US$${usd.toFixed(4)} (total US$${spent.toFixed(4)}), stop ${reply.stopReason}`);
      } catch (error) { say(`linking: call failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  if (existsSync(linksPath)) links = ((JSON.parse(readFileSync(linksPath, "utf8")) as Reply).json as { links?: SectionLink[] } | null)?.links ?? [];

  const table = assembleTable(readings, family, links);
  writeFileSync(resolve(out, "table.json"), JSON.stringify({ table, readings, sections, coverTypes: types }, null, 1));
  writeFileSync(resolve(out, "TABLE.md"), tableMarkdown(table, readings, `# Benefit table${paid ? ` (run ${arg("--run-id")})` : " (replay)"}\n\nPrivate: real household data, never in git.`));
  if (paid) writeFileSync(resolve(out, "run.log"), log.join("\n") + "\n");
  console.log(`Wrote ${out}/TABLE.md. Spent US$${spent.toFixed(4)}.`);
}

if (process.argv[1]?.endsWith("read.ts")) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

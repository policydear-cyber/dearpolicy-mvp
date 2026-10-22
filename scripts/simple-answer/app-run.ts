/** Runs a question set through the app's own simple chat turn (lib/simple-chat/hook runSimpleChat): the same prompt,
 * structured answer, server checks and cards that ship, on a household snapshot, with nothing saved to the database.
 * The 20/21 Oct comparison runs used the free-text script (answer.ts) instead, which the server checks never saw.
 *
 *   Estimate (free):  node --import tsx scripts/simple-answer/app-run.ts --questions q.json --household-file snapshot.json
 *   Replay (free):    ... --replay <earlier results.json>   (re-checks the recorded model JSON with today's server checks)
 *   Paid:             ... --paid --model anthropic:claude-sonnet-5-5 --run-id <id> --max-usd <cap> --out <dir>
 *   Benefit table:    add --table <benefit-table run dir> to answer with the table that run read (scripts/benefit-table/read.ts):
 *                     its recorded model output is checked and assembled with today's code, nothing is read again
 *
 * A paid call is admitted only if it fits under the cap with no cache hit and a maximum-length answer. One call per turn,
 * no retries; a failed turn ends its conversation. Output holds real household text, so --out must be outside git. */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelChoice } from "@/lib/ai/providers";
import { priceFor } from "@/lib/ai/providers";
import type { ChatContext } from "@/lib/chat/workflow";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import { renderLibrary, type Household } from "@/lib/simple-chat/library";
import { callUsd, MAX_OUTPUT_TOKENS, modelFromChoice, type SimpleModel, type SimpleUsage, type Turn } from "@/lib/simple-chat/model";
import { SIMPLE_SYSTEM_PROMPT } from "@/lib/simple-chat/prompt";
import { answerAsText, type VerifyReport } from "@/lib/simple-chat/verify";
import type { StructuredAnswer } from "@/components/answer-cards";
import { AUTHORISED_CAP_USD, loadQuestions, type Question } from "./compare";
import { assembleTable, type BenefitTable } from "@/lib/benefit-table/assemble";
import { checkReading, type CheckedReading } from "@/lib/benefit-table/check";
import { mergeReadings } from "@/lib/benefit-table/completeness";
import type { SectionLink } from "@/lib/benefit-table/reading";
import { chatRows, renderTable } from "@/lib/benefit-table/chat";

export type AppTurn = { id: string; question: string; model?: string; json?: unknown; answer?: StructuredAnswer; text?: string; report?: VerifyReport; usage?: SimpleUsage; usd?: number; ms?: number; stopReason?: string | null; error?: string };

/** Tokens from characters, set to run high: DC's library read 561k characters as 216k tokens (2.6 per token). */
const tokensOf = (s: string) => Math.ceil(s.length / 2.5);

function contextFor(household: Household, conversationId: string, question: string): ChatContext {
  const family = household.members.map((m, i) => ({ id: `m${i}`, display_name: m.name.replace(/\s*\([^)]*\)\s*$/, ""), preferred_name: null, relationship: m.relationship }));
  return {
    request: { accountId: household.accountId, question, submittedQuestion: question },
    family, people: family, holdings: [], token: "app-run", chatPath: "simple",
    conversation: { id: conversationId, revision: 0, state: {}, family_member_id: null },
  } as unknown as ChatContext;
}

/** One question set through runSimpleChat. `model` is the real model (paid) or a replayer. */
export async function runSet(opts: { household: Household; questions: Question[]; model: SimpleModel; table?: BenefitTable | null; maxUsd?: number; price?: { input: number; output: number; cachedInput?: number } | null; onProgress?: (m: string) => void }) {
  const turns: AppTurn[] = [];
  let spent = 0, stoppedEarly = false;
  const prefix = prefixTokens(opts.household, opts.table ?? null);
  for (const q of opts.questions) {
    const history: Turn[] = [];
    for (let i = 0; i < q.turns.length; i++) {
      const id = q.turnIds?.[i] ?? `${q.id}.${i + 1}`;
      const question = q.turns[i];
      if (opts.price && opts.maxUsd != null) {
        const fresh = tokensOf(question) + history.reduce((n, t) => n + tokensOf(t.text), 0);
        if (spent + callUsd(opts.price, { input: fresh, cacheWrite: prefix, cacheRead: 0, output: MAX_OUTPUT_TOKENS }) > opts.maxUsd) { stoppedEarly = true; break; }
      }
      type Saved = { answer: StructuredAnswer; state: { simpleChat?: { turns: { report: VerifyReport }[] } } };
      const got: { reply?: Awaited<ReturnType<SimpleModel["call"]>>; saved?: Saved } = {};
      const model: SimpleModel = { choice: opts.model.choice, async call(args) { got.reply = await opts.model.call(args); return got.reply; } };
      const started = Date.now();
      try {
        await runSimpleChat(contextFor(opts.household, `app-run-${q.id}`, question), {}, {
          model, household: async () => opts.household, history: async () => history, ledger: false,
          save: (async (t: Saved) => { got.saved = t; }) as never, ...(opts.table ? { table: async () => opts.table! } : {}),
        });
      } catch (error) {
        turns.push({ id, question, error: String(error instanceof Error ? error.message : error), ms: Date.now() - started });
        break;
      }
      const r = got.reply!, s = got.saved!;
      const usd = opts.price ? callUsd(opts.price, r.usage) : 0;
      spent += usd;
      const text = answerAsText(s.answer);
      turns.push({ id, question, model: r.model, json: r.json, answer: s.answer, text, report: s.state.simpleChat?.turns.at(-1)?.report, usage: r.usage, usd, ms: Date.now() - started, stopReason: r.stopReason });
      history.push({ role: "user", text: question }, { role: "assistant", text });
      opts.onProgress?.(`${id}: ${((Date.now() - started) / 1000).toFixed(1)} s, US$${usd.toFixed(4)} (total US$${spent.toFixed(4)})`);
    }
    if (stoppedEarly) break;
  }
  return { turns, spentUsd: spent, stoppedEarly };
}

/** The cached prefix of every call: the prompt, the documents and, with the benefit table, its rows. */
function prefixTokens(household: Household, table: BenefitTable | null): number {
  return tokensOf(SIMPLE_SYSTEM_PROMPT) + tokensOf(renderLibrary(household)) + (table ? tokensOf(renderTable(chatRows(table, household))) : 0);
}

/** The table a benefit-table run read: its recorded model output (each document's reading and page re-reads), checked
 * and assembled with today's code for this household's members, as the app does, with the run's links. No model call. */
export function tableFromRun(dir: string, household: Household): BenefitTable {
  const readings: CheckedReading[] = [];
  for (const d of household.documents) {
    const raw = resolve(dir, `raw-${d.policyId}.json`);
    if (!existsSync(raw)) continue;
    const doc = { id: d.policyId, name: d.name, readable: d.processingStatus === "ready", pages: d.pages, people: household.members.map((m) => m.name.replace(/\s*\([^)]*\)\s*$/, "")) };
    let reading = checkReading(doc, (JSON.parse(readFileSync(raw, "utf8")) as { json: unknown }).json);
    for (const p of d.pages) {
      const pageRaw = resolve(dir, `raw-${d.policyId}-p${p.page}.json`);
      if (existsSync(pageRaw)) reading = mergeReadings(reading, checkReading(doc, (JSON.parse(readFileSync(pageRaw, "utf8")) as { json: unknown }).json));
    }
    readings.push(reading);
  }
  if (!readings.length) throw new Error(`${dir} holds no recorded readings for this household's documents`);
  const linksPath = resolve(dir, "links.json");
  const links = existsSync(linksPath) ? ((JSON.parse(readFileSync(linksPath, "utf8")) as { json?: { links?: SectionLink[] } }).json?.links ?? []) : [];
  const family = household.members.map((m, i) => ({ id: `m${i}`, display_name: m.name.replace(/\s*\([^)]*\)\s*$/, "") }));
  return assembleTable(readings, family, links);
}

/** A model that answers with the JSON an earlier run recorded, turn by turn, so today's server checks can be re-run free. */
export function replayModel(recorded: AppTurn[], choice: ModelChoice): SimpleModel {
  let i = 0;
  return { choice, async call() { const t = recorded[i++]; if (!t?.json) throw new Error("no recorded answer for this turn"); return { json: t.json, stopReason: t.stopReason ?? "end_turn", model: `replay:${t.model ?? "?"}`, usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } }; } };
}

/** The answers as one readable file for grading. */
export function asMarkdown(turns: AppTurn[], meta: Record<string, unknown>): string {
  const lines = ["# Simple chat (app path) answers", "", "```json", JSON.stringify(meta, null, 2), "```", ""];
  for (const t of turns) {
    lines.push(`## ${t.id}: ${t.question}`, "");
    if (t.error) { lines.push(`ERROR: ${t.error}`, ""); continue; }
    // The cards as the app shows them: amount, conditions and how an illustration was worked out (graders need all three).
    const a = t.answer as (StructuredAnswer & { statements?: { personName?: string | null; amount?: { text: string } | null; text: string; conditions?: string[]; basis?: string | null; source?: { policyName: string; page: number } | null }[] }) | undefined;
    if (a?.statements) {
      lines.push(a.bottomLine || a.summary || "");
      for (const s of a.statements) {
        lines.push(`- ${s.personName ? s.personName + ": " : ""}${s.amount ? s.amount.text + " — " : ""}${s.text}${s.source ? ` (${s.source.policyName}, page ${s.source.page})` : ""}`);
        for (const c of s.conditions ?? []) lines.push(`  - only if: ${c}`);
        if (s.basis) lines.push(`  - worked out: ${s.basis}`);
      }
      lines.push(...a.nextSteps.map((n) => `Next: ${n}`), ...a.questions.map((q) => q.text), "");
    } else lines.push(t.text ?? "", "");
    const dropped = [...(t.report?.dropped ?? []).map((d) => `${d.kind}: ${d.why}: ${d.text}`), ...(t.report?.sentencesLeftOut ?? []).map((x) => `money in prose: ${x}`), ...(t.report?.questionsLeftOut ?? []).map((x) => `extra question: ${x}`), ...(t.report?.conditionsLeftOut ?? []).map((x) => `unquoted condition: ${x}`)];
    if (dropped.length) lines.push("<details><summary>Left out by the server</summary>", "", ...dropped.map((d) => `- ${d}`), "", "</details>", "");
    lines.push(`_${t.ms != null ? (t.ms / 1000).toFixed(1) + " s" : ""}${t.usd ? ` · US$${t.usd.toFixed(4)}` : ""}_`, "");
  }
  return lines.join("\n");
}

function arg(argv: string[], name: string) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }
function outsideRepo(path: string) {
  const repo = realpathSync(resolve(__dirname, "../.."));
  const target = resolve(path);
  if (target === repo || target.startsWith(repo + "/")) throw new Error(`${path} is inside the git checkout; real household text must stay out of git`);
  return target;
}
function parseChoice(s: string): ModelChoice {
  const m = /^(anthropic|openai):(.+)$/.exec(s);
  if (!m) throw new Error(`--model must be anthropic:<model> or openai:<model>, not ${s}`);
  return { provider: m[1], model: m[2] } as ModelChoice;
}

async function main(argv: string[]) {
  const questionsPath = arg(argv, "--questions"), file = arg(argv, "--household-file");
  if (!questionsPath || !file) throw new Error("--questions and --household-file are required");
  const questions = loadQuestions(questionsPath);
  const household = JSON.parse(readFileSync(file, "utf8")) as Household;
  const choice = parseChoice(arg(argv, "--model") ?? "anthropic:claude-sonnet-5-5");
  const price = priceFor(choice);
  if (!price) throw new Error(`No price on file for ${choice.provider}:${choice.model} in lib/ai/providers.ts`);
  const tableDir = arg(argv, "--table");
  const table = tableDir ? tableFromRun(tableDir, household) : null;
  const rows = table ? chatRows(table, household).length : null;
  const prefix = prefixTokens(household, table);
  const calls = questions.reduce((n, q) => n + q.turns.length, 0);
  const expected = callUsd(price, { input: 0, cacheWrite: prefix, cacheRead: 0, output: 2500 }) + (calls - 1) * callUsd(price, { input: 1500, cacheWrite: 0, cacheRead: prefix, output: 2500 });
  console.log(JSON.stringify({ model: `${choice.provider}:${choice.model}`, calls, libraryTokens: prefix, ...(table ? { table: tableDir, tableRows: rows } : {}), expectedUsd: Number(expected.toFixed(2)) }, null, 1));

  const replay = arg(argv, "--replay");
  if (replay) {
    const recorded = (JSON.parse(readFileSync(replay, "utf8")) as { turns?: AppTurn[] }).turns;
    if (!Array.isArray(recorded) || !recorded.some((t) => t.json)) throw new Error(`${replay} holds no recorded app-path turns (an answer.ts results file has {meta, rows}, not turns)`);
    const result = await runSet({ household, questions, model: replayModel(recorded, choice), table });
    const out = outsideRepo(arg(argv, "--out") ?? resolve(replay, "../replay"));
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, "replay.json"), JSON.stringify({ turns: result.turns }, null, 2));
    writeFileSync(resolve(out, "answers.md"), asMarkdown(result.turns, { replayOf: replay, at: new Date().toISOString() }));
    const failed = result.turns.filter((t) => t.error);
    console.log(`Replayed ${result.turns.length} turns (${failed.length} failed); wrote ${out}/answers.md. Nothing was sent to a model.`);
    if (failed.length) { for (const t of failed) console.error(`${t.id}: ${t.error}`); process.exitCode = 1; }
    return;
  }
  if (!argv.includes("--paid")) { console.log("Estimate only. Nothing was sent to a model."); return; }
  const runId = arg(argv, "--run-id"), maxUsd = Number(arg(argv, "--max-usd"));
  if (!runId || !(maxUsd > 0)) throw new Error("--paid needs --run-id and --max-usd");
  if (maxUsd > AUTHORISED_CAP_USD) throw new Error(`--max-usd ${maxUsd} is above the authorised US$${AUTHORISED_CAP_USD}`);
  const out = outsideRepo(arg(argv, "--out") ?? `/mnt/project-files/ux-live/release-set/${runId}`);
  if (existsSync(resolve(out, "results.json"))) throw new Error(`${out} already holds a run; use a new --run-id`);
  mkdirSync(out, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = await runSet({ household, questions, model: modelFromChoice(choice), table, maxUsd, price, onProgress: console.log });
  const meta = { runId, startedAt, finishedAt: new Date().toISOString(), model: `${choice.provider}:${choice.model}`, path: "lib/simple-chat runSimpleChat", table: tableDir ?? null, tableRows: rows, spentUsd: result.spentUsd, stoppedEarly: result.stoppedEarly, maxUsd };
  writeFileSync(resolve(out, "results.json"), JSON.stringify({ meta, turns: result.turns }, null, 2));
  writeFileSync(resolve(out, "answers.md"), asMarkdown(result.turns, meta));
  console.log(`Spent US$${result.spentUsd.toFixed(4)}. Wrote ${out}/answers.md`);
  const failed = result.turns.filter((t) => t.error);
  if (failed.length) { for (const t of failed) console.error(`${t.id}: ${t.error}`); process.exitCode = 1; }
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => { console.error(String(error instanceof Error ? error.message : error)); process.exit(1); });

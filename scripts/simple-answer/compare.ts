/** Head-to-head runner: asks every question in a question set of (a) the simple baseline (answer.ts) and (b) the
 * current pipeline, and writes both answers side by side for grading, with time and cost per question.
 *
 *   Estimate only (default, no model call, no spend):
 *     node --import tsx scripts/simple-answer/compare.ts --questions set.json --household-file snapshot.json
 *   Real run (spends money; needs ANTHROPIC_API_KEY and an authorised cap):
 *     ... --paid --run-id simple-vs-current-01 --max-usd 5 --current live --storage-state state.json --out /mnt/project-files/...
 *
 * Household:  --household-file <snapshot.json>, or --account-id <uuid> to read DATABASE_URL read-only
 *             (add --snapshot-out <file> to keep that read for later runs).
 * Current:    --current none | file:<answers.json> (recorded {id: {turns:[{answer, ms}]}} or {id: "answer"})
 *             | live (drives the production chat in a browser with --storage-state, one new chat per question).
 * Output files can hold real household text, so --out and --snapshot-out must be outside the git checkout. */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { answerSimply, DEFAULT_MODEL, estimateTokens, MAX_OUTPUT_TOKENS, PRICES, renderLibrary, SYSTEM_PROMPT, costUsd, type ModelClient, type Turn } from "./answer";
import { loadHouseholdFromDb, loadHouseholdFromFile, type Household } from "./household";

/** DC's authorisation for the comparison run (decision card, 20 Oct 2026 12:15Z: "Opus, cap $10"). */
export const AUTHORISED_CAP_USD = 10;

export type Question = { id: string; turns: string[]; person?: string; notes?: string };
export function loadQuestions(path: string): Question[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const list: unknown[] = Array.isArray(raw) ? raw : raw?.questions;
  if (!Array.isArray(list) || !list.length) throw new Error(`${path} has no questions`);
  const out = list.map((q, i) => {
    const item = q as { id?: string; turns?: string[]; question?: string; person?: string; notes?: string };
    const turns = Array.isArray(item.turns) ? item.turns : item.question ? [item.question] : [];
    if (!turns.length || turns.some((t) => typeof t !== "string" || !t.trim())) throw new Error(`Question ${i + 1} has no text`);
    return { id: item.id ?? `q${String(i + 1).padStart(2, "0")}`, turns, person: item.person, notes: item.notes };
  });
  if (new Set(out.map((q) => q.id)).size !== out.length) throw new Error("Question ids must be unique");
  return out;
}

/** What one run would cost. "Expected" assumes the library is cached after the first request and ~1,500 output
 * tokens per answer (thinking included); "worst case" assumes no cache hits and every answer hitting the cap. */
export function estimateRun(household: Household, questions: Question[], model = DEFAULT_MODEL, typicalOutput = 1500) {
  const prefix = estimateTokens(SYSTEM_PROMPT) + estimateTokens(renderLibrary(household));
  let expected = 0, worst = 0, calls = 0, history = 0;
  for (const q of questions) {
    history = 0;
    for (const turn of q.turns) {
      const fresh = estimateTokens(turn) + history;
      expected += costUsd(model, { input: fresh, cacheWrite: calls === 0 ? prefix : 0, cacheRead: calls === 0 ? 0 : prefix, output: typicalOutput });
      worst += costUsd(model, { input: fresh + prefix, cacheWrite: 0, cacheRead: 0, output: MAX_OUTPUT_TOKENS });
      history += estimateTokens(turn) + typicalOutput;
      calls++;
    }
  }
  return { model, libraryTokens: prefix, documents: household.documents.length, pages: household.documents.reduce((n, d) => n + d.pages.length, 0), calls, expectedUsd: expected, worstCaseUsd: worst };
}

export type CurrentAnswer = { answer: string; ms: number | null; error?: string };
export type CurrentPipeline = { label: string; ask(q: Question): Promise<CurrentAnswer[]>; close?(): Promise<void> };

export function recordedCurrent(path: string): CurrentPipeline {
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, string | { turns?: { answer: string; ms?: number }[]; answer?: string; completeMs?: number }>;
  return {
    label: `recorded (${path})`,
    async ask(q) {
      const entry = data[q.id];
      if (entry == null) return q.turns.map(() => ({ answer: "", ms: null, error: "no recorded answer" }));
      if (typeof entry === "string") return [{ answer: entry, ms: null }];
      if (entry.turns) return entry.turns.map((t) => ({ answer: t.answer, ms: t.ms ?? null }));
      return [{ answer: entry.answer ?? "", ms: entry.completeMs ?? null }];
    },
  };
}

/** The production chat as a household sees it, using the same page selectors as the live site tester's turn.mjs. */
export async function liveCurrent(storageState: string, base = "https://dearpolicy-mvp.vercel.app"): Promise<CurrentPipeline> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, storageState });
  return {
    label: `live (${base})`,
    async ask(q) {
      const page = await ctx.newPage();
      const out: CurrentAnswer[] = [];
      try {
        await page.goto(base + "/chat", { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "New chat" }).click();
        await page.waitForTimeout(500);
        for (const turn of q.turns) {
          const before = await page.locator(".chat-window .message").count();
          await page.locator('textarea[aria-label="Message to DearPolicy"]').fill(turn);
          const t0 = Date.now();
          await page.getByRole("button", { name: /Send/ }).click();
          await page.waitForFunction((n) => document.querySelectorAll(".chat-window .message").length > n, before, { timeout: 15000 }).catch(() => {});
          let ms: number | null = null;
          for (const deadline = Date.now() + 180000; Date.now() < deadline; await page.waitForTimeout(250))
            if (!(await page.locator(".message-body.thinking").count())) { ms = Date.now() - t0; break; }
          await page.waitForTimeout(1500);
          const messages = await page.locator(".chat-window .message").allInnerTexts();
          out.push({ answer: messages[messages.length - 1] ?? "", ms, error: ms == null ? "no answer within 180 s" : undefined });
        }
      } catch (error) {
        out.push({ answer: "", ms: null, error: String(error) });
      } finally {
        await page.close();
      }
      return out;
    },
    async close() { await browser.close(); },
  };
}

export type RowResult = {
  id: string; person?: string; notes?: string;
  turns: { question: string; baseline: { answer: string; ms: number; costUsd: number; usage: unknown; stopReason: string | null } | { error: string }; current: CurrentAnswer | null }[];
};

export async function runComparison(opts: {
  household: Household; questions: Question[]; client: ModelClient; current: CurrentPipeline; model?: string;
  maxUsd: number; onProgress?: (msg: string) => void;
}): Promise<{ rows: RowResult[]; spentUsd: number; stoppedEarly: boolean }> {
  const model = opts.model ?? DEFAULT_MODEL;
  const rows: RowResult[] = [];
  let prefix = estimateTokens(SYSTEM_PROMPT) + estimateTokens(renderLibrary(opts.household));
  let spent = 0, stoppedEarly = false;
  for (const q of opts.questions) {
    const history: Turn[] = [];
    const row: RowResult = { id: q.id, person: q.person, notes: q.notes, turns: [] };
    for (const turn of q.turns) {
      // Admit a call only if it fits under the cap even with no cache hit and a maximum-length answer.
      const fresh = estimateTokens(turn) + history.reduce((n, t) => n + estimateTokens(t.text), 0);
      if (spent + costUsd(model, { input: prefix + fresh, cacheWrite: 0, cacheRead: 0, output: MAX_OUTPUT_TOKENS }) > opts.maxUsd) { stoppedEarly = true; break; }
      try {
        const a = await answerSimply(opts.client, opts.household, history, turn, model);
        spent += a.costUsd;
        // The estimate is a character heuristic; once a real count is back, admit later calls on whichever is larger.
        prefix = Math.max(prefix, a.usage.input + a.usage.cacheWrite + a.usage.cacheRead - fresh);
        row.turns.push({ question: turn, baseline: { answer: a.text, ms: a.ms, costUsd: a.costUsd, usage: a.usage, stopReason: a.stopReason }, current: null });
        history.push({ role: "user", text: turn }, { role: "assistant", text: a.text });
      } catch (error) {
        row.turns.push({ question: turn, baseline: { error: String(error) }, current: null });
        break; // a later turn without the earlier answer would not be the same conversation
      }
    }
    if (!row.turns.length) break;
    const current = await opts.current.ask({ ...q, turns: q.turns.slice(0, row.turns.length) });
    row.turns.forEach((t, i) => (t.current = current[i] ?? null));
    rows.push(row);
    if (stoppedEarly) break;
    opts.onProgress?.(`${q.id}: baseline ${row.turns.length}/${q.turns.length} turns, spent US$${spent.toFixed(4)}`);
  }
  return { rows, spentUsd: spent, stoppedEarly };
}

export function sideBySide(rows: RowResult[], meta: Record<string, unknown>): string {
  const lines = ["# Simple baseline vs current pipeline", "", "```json", JSON.stringify(meta, null, 2), "```", ""];
  for (const r of rows) {
    lines.push(`## ${r.id}${r.person ? ` (${r.person})` : ""}`, r.notes ? `_${r.notes}_` : "");
    r.turns.forEach((t, i) => {
      const b = "error" in t.baseline ? `ERROR: ${t.baseline.error}` : t.baseline.answer;
      const bm = "error" in t.baseline ? "" : ` · ${(t.baseline.ms / 1000).toFixed(1)} s · US$${t.baseline.costUsd.toFixed(4)}`;
      const c = t.current ? (t.current.error ? `ERROR: ${t.current.error}\n\n${t.current.answer}` : t.current.answer) : "(not asked)";
      const cm = t.current?.ms != null ? ` · ${(t.current.ms / 1000).toFixed(1)} s` : "";
      lines.push(`### Turn ${i + 1}: ${t.question}`, "", `**Simple baseline**${bm}`, "", b, "", `**Current pipeline**${cm}`, "", c, "",
        "Grade (baseline / current): correct person ☐☐ · amounts and conditions right ☐☐ · nothing unsupported ☐☐ · useful ☐☐", "");
    });
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

async function main(argv: string[]) {
  const questionsPath = arg(argv, "--questions");
  if (!questionsPath) throw new Error("--questions <file> is required");
  const questions = loadQuestions(questionsPath);
  const model = arg(argv, "--model") ?? DEFAULT_MODEL;
  if (!PRICES[model]) throw new Error(`No price on file for ${model}; add it to PRICES first`);
  const file = arg(argv, "--household-file"), accountId = arg(argv, "--account-id");
  if (!file && !accountId) throw new Error("--household-file or --account-id is required");
  const household = file ? loadHouseholdFromFile(file, accountId) : await loadHouseholdFromDb(accountId!);
  const snapshotOut = arg(argv, "--snapshot-out");
  if (snapshotOut) writeFileSync(outsideRepo(snapshotOut), JSON.stringify(household));
  const estimate = estimateRun(household, questions, model);
  console.log(JSON.stringify({ questions: questions.length, ...estimate }, null, 1));
  if (!argv.includes("--paid")) { console.log("Estimate only. Nothing was sent to a model."); return; }

  const runId = arg(argv, "--run-id"), maxUsd = Number(arg(argv, "--max-usd"));
  if (!runId || !(maxUsd > 0)) throw new Error("--paid needs --run-id and --max-usd");
  if (maxUsd > AUTHORISED_CAP_USD) throw new Error(`--max-usd ${maxUsd} is above the authorised US$${AUTHORISED_CAP_USD}; a higher cap needs a new authorisation and a code change`);
  if (estimate.worstCaseUsd > maxUsd) console.log(`Worst case US$${estimate.worstCaseUsd.toFixed(2)} exceeds the cap; the run stops once US$${maxUsd} is spent.`);
  const out = outsideRepo(arg(argv, "--out") ?? `/mnt/project-files/ux-live/release-set/${runId}`);
  if (existsSync(resolve(out, "results.json"))) throw new Error(`${out} already holds a run; use a new --run-id`);
  mkdirSync(out, { recursive: true });
  const currentArg = arg(argv, "--current") ?? "none";
  // Which build of the current app answered, e.g. the production deployment's commit, checked before the run.
  const currentBuild = arg(argv, "--current-build");
  if (currentArg !== "none" && !currentBuild) throw new Error("--current needs --current-build <commit that answered>");
  const current: CurrentPipeline = currentArg === "none" ? { label: "none", ask: async () => [] }
    : currentArg.startsWith("file:") ? recordedCurrent(currentArg.slice(5))
    : currentArg === "live" ? await liveCurrent(arg(argv, "--storage-state") ?? (() => { throw new Error("--current live needs --storage-state"); })())
    : (() => { throw new Error(`Unknown --current ${currentArg}`); })();
  const startedAt = new Date().toISOString();
  try {
    const result = await runComparison({ household, questions, client: new Anthropic() as unknown as ModelClient, current, model, maxUsd, onProgress: console.log });
    const meta = { runId, startedAt, finishedAt: new Date().toISOString(), model, current: current.label, currentBuild: currentBuild ?? null, householdAccountId: household.accountId, estimate, spentUsd: result.spentUsd, stoppedEarly: result.stoppedEarly };
    writeFileSync(resolve(out, "results.json"), JSON.stringify({ meta, rows: result.rows }, null, 2));
    writeFileSync(resolve(out, "side-by-side.md"), sideBySide(result.rows, meta));
    console.log(`Spent US$${result.spentUsd.toFixed(4)} on the baseline. Wrote ${out}/side-by-side.md`);
  } finally {
    await current.close?.();
  }
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => { console.error(String(error instanceof Error ? error.message : error)); process.exit(1); });

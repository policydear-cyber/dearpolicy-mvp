/**
 * V1 core-loop certification, in a real browser, against the LOCAL synthetic
 * stack only (fake VirusTotal, deterministic model stand-in, local Postgres).
 *
 *   family page -> policies page upload (every synthetic fixture format)
 *   -> chat (portfolio, coverage, fracture, injury fact-finding, amount,
 *   absent benefit, Marcus's travel) -> delete the relevant policy in the UI
 *   -> ask again -> reload and reopen the saved chat.
 *
 * Assertions are SOFT: every failure is collected and the test fails at the
 * end with the full list, so one defect never hides the next. Writes
 * e2e-results/v1-core-loop/{transcript,timings,uploads,policies-*}.json and
 * turn-N.png screenshots (synthetic pages only).
 *
 * Household B has no concurrent server on a 1 GB machine, so it runs as a
 * separate phase first (E2E_V1_PHASE=b, server started as user B, DATABASE_URL
 * unset so the global teardown does not remove B before phase A). Phase A
 * (default) then checks that nothing of B's appears on A's pages or APIs.
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { PREFIX } from "../support/synthetic";
import * as FX from "../support/v1-fixtures";

const OUT = path.resolve("e2e-results/v1-core-loop");
const B_STATE = path.resolve(".e2e-v1-b.json");
const PHASE = (process.env.E2E_V1_PHASE ?? "a").toLowerCase();
const BASE_B = process.env.E2E_BASE_URL_B ?? "http://localhost:3001";
const UPLOAD_READY_TIMEOUT_MS = Number(process.env.E2E_V1_UPLOAD_TIMEOUT_MS ?? 480_000);
const THINKING_LIMIT_MS = 180_000;
if (process.env.E2E_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } });

// ---- what must never be visible ------------------------------------------------
const LEAKS: [string, RegExp][] = [
  ["UUID", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["storage key/path", /storage_key|\.e2e-storage|\/households?\/[0-9a-f-]{8,}|sha256:/i],
  ["job id", /\bjob[_ ]?id\b|background_jobs|idempotency_key|lease_owner/i],
  ["model id", /gpt-|gemini|openai:|synthetic-e2e|dearpolicy-deterministic|claude-/i],
  ["rule count", /\b\d+ benefit rules?\b|benefit rules? read|Not applicable here/i],
  ["raw DB field", /\b(policy_benefits|policy_chunks|policy_pages|family_member_id|account_id|processing_status|extracted_json|formula_kind|formula_value|fact_key|evidence_verified|needs_review|document_role)\b/],
  ["Error:", /\bError:/],
];
const MONEY = /(?:S\$|US\$|SGD|USD|MYR|RM|EUR|€|£|\$)\s?\d/;
const CURRENCY_TOKENS = /S\$|US\$|SGD|USD|MYR|\bRM\b|EUR|€|£/g;

const failures: string[] = [];
function soft(ok: unknown, message: string) { if (!ok) failures.push(message); return !!ok; }
function leakCheck(text: string, where: string) {
  for (const [label, re] of LEAKS) { const m = text.match(re); soft(!m, `${where}: visible ${label} "${m?.[0]}"`); }
}
function mixedCurrencyCheck(text: string, where: string) {
  for (const line of text.split(/\n+/)) {
    if (!/total/i.test(line)) continue;
    const cur = new Set((line.match(CURRENCY_TOKENS) ?? []).map((c) => c.replace("SGD", "S$").replace("USD", "US$")));
    soft(cur.size <= 1, `${where}: mixed-currency total "${line.trim().slice(0, 160)}"`);
  }
}

// ---- fixtures (e2e/support/v1-fixtures.ts, written by the ingestion agent) --
type Fixture = { key: string; file: string; mimeType: string; format: string; owner: "Charmaine" | "Marcus"; household: "A" | "B"; role: string; product: string; buffer: Buffer; expected: FX.V1Fixture["expected"] };
async function loadFixtures(): Promise<Fixture[]> {
  return (await FX.generateV1Fixtures({ include: "all" })).map((f) => ({
    key: f.key, file: f.name, mimeType: f.mimeType, format: f.format, owner: f.member, household: f.household, role: f.role,
    product: f.expected.productName, buffer: f.buffer, expected: f.expected,
  }));
}
/** Household A gets one copy of each policy (the primaries); the same
 * policies in other formats would double-count in A's chat, so they are
 * uploaded to household B's matching members in phase B, together with B's
 * own isolation policy. */
const forPhaseB = (f: Fixture) => f.household === "B" || f.role !== "primary";
const isMarcus = (f: Fixture) => f.owner === "Marcus";

// ---- page helpers ------------------------------------------------------------------
type Policy = { id: string; original_filename: string; product_name: string | null; insurer: string | null; policy_number: string | null; processing_status: string; processing_stage?: string | null; quarantine_status: string; needs_review?: boolean; personal_coverage_confirmed?: boolean; processing_error?: string | null; processing_stalled?: boolean; linked_people: { id: string; name: string }[]; detected_people: { name: string; matchedFamilyMemberId?: string | null }[] };
async function api<T = any>(page: Page, p: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ p, init }) => {
    const headers: Record<string, string> = {};
    if (init?.body) headers["content-type"] = "application/json";
    const res = await fetch(p, { method: init?.method ?? "GET", headers, body: init?.body ? JSON.stringify(init.body) : undefined, cache: "no-store" });
    const text = await res.text(); let body: unknown = text; try { body = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, body: body as never };
  }, { p, init });
}
async function policies(page: Page): Promise<Policy[]> { return (await api<{ policies: Policy[] }>(page, "/api/policies")).body.policies ?? []; }
async function hideDevOverlay(page: Page) {
  await page.addInitScript(() => { const strip = () => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()); new MutationObserver(strip).observe(document, { childList: true, subtree: true }); strip(); });
}
async function db() {
  const url = process.env.E2E_V1_DB_URL ?? process.env.DATABASE_URL; if (!url) return null;
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) return null;
  const c = new Client({ connectionString: url }); await c.connect(); return c;
}
async function jobInfo(policyId: string) {
  const c = await db(); if (!c) return null;
  try {
    return (await c.query(`SELECT status, attempt_count, max_attempts, last_error_category FROM background_jobs WHERE job_type='policy_processing' AND idempotency_key=$1 ORDER BY created_at`, [policyId])).rows;
  } catch { return null; } finally { await c.end(); }
}

async function addPerson(page: Page, fullName: string, preferred: string, relationship: string) {
  await page.goto("/family");
  const existing = (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family ?? [];
  const found = existing.find((m) => m.display_name === fullName || m.display_name === preferred);
  if (found) return found.id;
  await page.locator("#fm-new-name").fill(fullName);
  await page.locator("#fm-new-relationship").selectOption(relationship);
  if (preferred && preferred !== fullName) await page.locator("#fm-new-preferred").fill(preferred);
  await page.getByRole("button", { name: "+ Add person" }).click();
  await expect(page.locator(".profile-add-panel .upload-status")).toHaveText("Profile added.", { timeout: 60_000 });
  const family = (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family ?? [];
  const m = family.find((x) => x.display_name === fullName || x.display_name === preferred);
  soft(m, `family: ${preferred} was not created through the Family page`);
  return m?.id ?? null;
}

type UploadRecord = { file: string; format: string; owner: string; policyId: string | null; msToReady: number | null; finalStatus: string; quarantine: string; statesSeen: string[]; retries: number | null; jobs: unknown; extractionFailure: string | null; needsReview: boolean; linked: string[]; ownerAction: string };
async function uploadAndWait(page: Page, f: Fixture, profileLabel: string | null, ownerName: string | null): Promise<UploadRecord> {
  await page.goto("/policies");
  if (profileLabel) await page.locator(".upload-form select").selectOption({ label: profileLabel }).catch(() => soft(false, `upload ${f.file}: profile hint "${profileLabel}" not offered`));
  await page.locator(".upload-form input[type=file]").setInputFiles({ name: f.file, mimeType: f.mimeType, buffer: f.buffer! });
  const started = Date.now();
  await page.getByRole("button", { name: "Upload & analyse" }).click();
  const statusOk = await expect(page.locator(".upload-panel .upload-status")).toContainText(/Upload received|received/i, { timeout: 120_000 }).then(() => true, () => false);
  const statusText = (await page.locator(".upload-panel .upload-status").innerText().catch(() => "")).trim();
  soft(statusOk, `upload ${f.file}: no "Upload received" confirmation (status: "${statusText}")`);
  const seen: string[] = [];
  let p: Policy | undefined; let ms: number | null = null;
  for (;;) {
    p = (await policies(page).catch(() => [] as Policy[])).find((x) => x.original_filename === f.file);
    if (p) { const s = `${p.quarantine_status}/${p.processing_status}${p.processing_stage ? ":" + p.processing_stage : ""}`; if (seen[seen.length - 1] !== s) seen.push(s); }
    if (p && ["ready", "failed", "error"].includes(p.processing_status)) { ms = p.processing_status === "ready" ? Date.now() - started : null; break; }
    if (p && (p.quarantine_status === "scan_rejected" || p.processing_stalled)) break;
    if (Date.now() - started > UPLOAD_READY_TIMEOUT_MS) break;
    await page.waitForTimeout(2000);
  }
  soft(p?.processing_status === "ready", `upload ${f.file} (${f.format}): not ready after ${Math.round((Date.now() - started) / 1000)}s; states ${seen.join(" -> ")}${p?.processing_error ? "; error: " + p.processing_error : ""}`);
  // What the person sees on the card.
  let ownerAction = "none needed";
  if (p) {
    await page.reload();
    const cardLoc = page.locator(".document-card").filter({ hasText: p.product_name ?? p.original_filename }).first();
    const cardText = await cardLoc.innerText().catch(() => "");
    leakCheck(cardText, `policies card ${f.file}`);
    if (ownerName && p.processing_status === "ready") {
      const linked = p.linked_people.some((l) => l.name.toLowerCase().includes(ownerName.toLowerCase().split(" ")[0]));
      if (!linked) {
        // Reference document or unmatched name: assign through the UI, as a person would.
        const declare = cardLoc.locator(".declare-owner button").filter({ hasText: new RegExp(`^${ownerName.split(" ")[0]}`, "i") });
        const matchSel = cardLoc.locator(".detected-row select").first();
        if (await declare.count()) { await declare.first().click(); ownerAction = "declared owner (reference document)"; }
        else if (await matchSel.count()) { await matchSel.selectOption({ label: ownerName }).catch(async () => { const opts = await matchSel.locator("option").allTextContents(); const o = opts.find((t) => t.toLowerCase().includes(ownerName.split(" ")[0].toLowerCase())); if (o) await matchSel.selectOption({ label: o }); }); ownerAction = "matched detected name"; }
        else ownerAction = "NO UI to assign owner";
        await page.waitForTimeout(1500);
        p = (await policies(page)).find((x) => x.id === p!.id) ?? p;
        soft(p.linked_people.some((l) => l.name.toLowerCase().includes(ownerName.toLowerCase().split(" ")[0])), `upload ${f.file}: could not link to ${ownerName} through the UI (${ownerAction})`);
      }
    }
  }
  const jobs = p ? await jobInfo(p.id) : null;
  const retries = Array.isArray(jobs) && jobs.length ? jobs.reduce((n: number, j: any) => n + Math.max(0, Number(j.attempt_count) - 1), 0) + (jobs.length - 1) : null;
  return {
    file: f.file, format: f.format, owner: f.owner, policyId: p?.id ?? null, msToReady: ms,
    finalStatus: p?.processing_status ?? "missing", quarantine: p?.quarantine_status ?? "missing", statesSeen: seen, retries, jobs,
    extractionFailure: p && p.processing_status !== "ready" ? (p.processing_error ?? p.processing_status) : null,
    needsReview: !!p?.needs_review, linked: p?.linked_people.map((l) => l.name) ?? [], ownerAction,
  };
}

// ---- chat helpers --------------------------------------------------------------------
type Turn = { turn: number; user: string; via: string; answer: string; citations: string[]; statedLimits: string[]; ms: number; screenshot: string; stuck: boolean; error: string | null; nextQuestion: string | null };
const transcript: Turn[] = [];
const answersLoc = (page: Page) => page.locator(".chat-window > .message.assistant:not(:has(.thinking))");
const lastAnswer = (page: Page) => answersLoc(page).last();

async function currentQuestion(page: Page): Promise<string | null> {
  const a = lastAnswer(page);
  // The one highlighted question the answer asks (".fact-question > strong");
  // the plan inside the collapsed "Show full assessment" is not what is asked.
  const q = a.locator(".fact-question > strong").first();
  if (!(await q.count())) return null;
  return (await q.innerText()).trim() || null;
}

async function turn(page: Page, user: string, via: string, act: () => Promise<void>, opts: { noMoneyYet?: boolean } = {}): Promise<Turn> {
  const n = transcript.length + 1;
  const before = await answersLoc(page).count();
  const errBefore = await page.locator(".message-inline-error, .chat-window > .alert.error").count();
  const started = Date.now();
  await act();
  let stuck = false; let error: string | null = null;
  for (;;) {
    const nowAnswers = await answersLoc(page).count();
    const thinking = await page.locator(".message-body.thinking").count();
    const errs = await page.locator(".message-inline-error, .chat-window > .alert.error").count();
    if (errs > errBefore && !thinking) { error = (await page.locator(".message-inline-error, .chat-window > .alert.error").last().innerText()).trim(); break; }
    if (nowAnswers > before && !thinking) break;
    if (Date.now() - started > THINKING_LIMIT_MS) { stuck = true; break; }
    await page.waitForTimeout(500);
  }
  const ms = Date.now() - started;
  const a = lastAnswer(page);
  const answer = error ? `[ERROR SHOWN] ${error}` : (await answersLoc(page).count()) > before ? (await a.innerText()).trim() : "";
  const citations = error || stuck ? [] : (await a.locator(".citations .citation").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  const statedLimits = error || stuck ? [] : (await a.locator(".policy-stated-limit em").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  const shot = path.join(OUT, `turn-${n}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  const nextQuestion = error || stuck ? null : await currentQuestion(page);
  const t: Turn = { turn: n, user, via, answer, citations, statedLimits, ms, screenshot: path.relative(process.cwd(), shot), stuck, error, nextQuestion };
  transcript.push(t);
  soft(!stuck, `turn ${n} "${user}": still thinking after ${THINKING_LIMIT_MS / 1000}s`);
  soft(!error, `turn ${n} "${user}": error shown: ${error}`);
  leakCheck(answer + "\n" + citations.join("\n"), `turn ${n} "${user}"`);
  mixedCurrencyCheck(answer, `turn ${n} "${user}"`);
  if (opts.noMoneyYet) soft(!MONEY.test(answer), `turn ${n} "${user}": amount shown before the facts/evidence were collected: "${answer.match(new RegExp(".{0,60}" + MONEY.source + ".{0,40}"))?.[0]}"`);
  if (MONEY.test(answer)) soft(citations.length + statedLimits.length > 0, `turn ${n} "${user}": amount shown with no cited evidence`);
  await writeFile(path.join(OUT, "transcript.json"), JSON.stringify(transcript, null, 2));
  return t;
}
async function ask(page: Page, text: string, opts: { noMoneyYet?: boolean } = {}) {
  return turn(page, text, "composer", async () => {
    await page.getByLabel("Message to DearPolicy").fill(text);
    await page.getByRole("button", { name: /send/i }).click();
  }, opts);
}
/** Answers the pending fact question the way a person would: a quick-reply
 * button when one is offered, otherwise the inline answer box, otherwise the
 * composer. */
async function answerPending(page: Page, pick: (question: string, options: string[]) => string, opts: { noMoneyYet?: boolean } = {}) {
  const a = lastAnswer(page);
  const q = (await currentQuestion(page)) ?? "";
  const buttons = a.locator(".quick-replies button:enabled");
  const options = (await buttons.allTextContents()).map((t) => t.trim());
  const choice = pick(q, options);
  if (options.includes(choice)) return turn(page, choice, `button (question: ${q})`, () => buttons.filter({ hasText: new RegExp(`^${choice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click(), opts);
  const inline = a.locator("input[aria-label='Your answer']");
  if (await inline.count()) {
    return turn(page, choice, `inline answer (question: ${q})`, async () => { await inline.fill(choice); await inline.press("Enter"); }, opts);
  }
  return turn(page, choice, `composer (question: ${q})`, async () => { await page.getByLabel("Message to DearPolicy").fill(choice); await page.getByRole("button", { name: /send/i }).click(); }, opts);
}
function pickAnswer(question: string, options: string[]): string {
  const find = (re: RegExp) => options.find((o) => re.test(o));
  if (/where/i.test(question)) return find(/singapore/i) ?? find(/local|in singapore/i) ?? (options[0] ?? "Singapore");
  if (/when|date/i.test(question)) return find(/week|recent|today|yesterday/i) ?? "2026-09-20";
  if (/treat|doctor|hospital|clinic|admit|a&e|emergency|x-ray|cast|surgery|see/i.test(question)) return find(/outpatient|clinic|a&e|emergency|doctor/i) ?? find(/hospital/i) ?? find(/yes/i) ?? (options[0] ?? "She went to A&E and had a cast put on as an outpatient.");
  if (/accident|illness/i.test(question)) return find(/accident/i) ?? "An accident.";
  return find(/^yes$/i) ?? options[0] ?? "Yes";
}

const historyLog: unknown[] = [];
async function reopenLatest(page: Page, titleHint: RegExp | null) {
  await page.goto("/chat");
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined); await expect(async () => { await page.locator("details.chat-history").evaluate((d) => { (d as HTMLDetailsElement).open = true; }); await page.locator(".history-open").first().waitFor({ state: "visible", timeout: 2_000 }); }).toPass({ timeout: 30_000 });
  const buttons = page.locator(".history-open");
  await expect(buttons.first()).toBeVisible({ timeout: 30_000 });
  const target = titleHint ? buttons.filter({ hasText: titleHint }).first() : buttons.first();
  const title = ((await (await target.count() ? target : buttons.first()).innerText()) || "").trim();
  await (await target.count() ? target : buttons.first()).click();
  await expect(answersLoc(page).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  historyLog.push({ opened: title, listed: (await buttons.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()), olderMessagesButton: await page.getByRole("button", { name: "Load older messages" }).count() });
  return title;
}

// ====================================================================================
const PEOPLE = [["Charmaine", "spouse"], ["Marcus", "self"]] as const;
async function uploadAll(page: Page, fx: Fixture[], people: Record<string, { relationship: string }>, timings: unknown[], outFile: string) {
  const records: UploadRecord[] = [];
  for (const f of fx) {
    const label = `${f.owner} · ${people[f.owner].relationship}`;
    const rec = await uploadAndWait(page, f, label, f.owner);
    records.push(rec);
    timings.push({ household: f.household, key: f.key, role: f.role, file: rec.file, format: rec.format, owner: f.owner, msToReady: rec.msToReady, status: `${rec.quarantine}/${rec.finalStatus}`, retries: rec.retries, standIn: f.expected.standIn });
    await writeFile(path.join(OUT, outFile), JSON.stringify(records, null, 2));
  }
  return records;
}

test.describe.serial("V1 core loop (phase B)", () => {
  test.skip(PHASE !== "b", "phase B runs only with E2E_V1_PHASE=b");
  test("B. household B: its own policy plus the other-format copies, on a separate server as user B", async ({ browser }) => {
    test.setTimeout(Number(process.env.E2E_V1_TEST_TIMEOUT_MS ?? 90 * 60_000));
    await mkdir(OUT, { recursive: true });
    const fx = (await loadFixtures()).filter(forPhaseB);
    expect(fx.some((f) => f.household === "B"), "a household-B fixture exists").toBe(true);
    const page = await (await browser.newContext({ baseURL: BASE_B })).newPage();
    await hideDevOverlay(page);
    await page.goto("/policies");
    const hh = await api(page, "/api/household");
    expect(String(hh.body.activeHouseholdName)).toContain(`${PREFIX}-Household-B`);
    for (const [who, rel] of PEOPLE) await addPerson(page, who, who, rel);
    const timings: unknown[] = [];
    // B's own policy first, then the format variants.
    fx.sort((a, b) => (a.household === "B" ? 0 : 1) - (b.household === "B" ? 0 : 1));
    await uploadAll(page, fx, Object.fromEntries(PEOPLE.map(([w, r]) => [w, { relationship: r }])), timings, "uploads-B.json");
    const all = await policies(page);
    await writeFile(path.join(OUT, "policies-B.json"), JSON.stringify(all, null, 2));
    await writeFile(path.join(OUT, "timings-B.json"), JSON.stringify(timings, null, 2));
    const own = fx.filter((f) => f.household === "B");
    await writeFile(B_STATE, JSON.stringify({ policies: all.filter((p) => own.some((f) => f.file === p.original_filename)).map((p) => ({ id: p.id, product_name: p.product_name, policy_number: p.policy_number, original_filename: p.original_filename })), allIds: all.map((p) => p.id) }, null, 2));
    await writeFile(path.join(OUT, "failures-B.json"), JSON.stringify(failures, null, 2));
    expect(failures, `\n${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`).toEqual([]);
  });
});

test.describe.serial("V1 core loop (phase A)", () => {
  test.skip(PHASE === "b", "phase A");
  test("A. family -> upload -> chat -> delete -> ask again -> reopen", async ({ page }) => {
    test.setTimeout(Number(process.env.E2E_V1_TEST_TIMEOUT_MS ?? 90 * 60_000));
    await mkdir(OUT, { recursive: true });
    await hideDevOverlay(page);
    const all = await loadFixtures();
    const fxA = all.filter((f) => !forPhaseB(f));
    const bState = existsSync(B_STATE) ? JSON.parse(readFileSync(B_STATE, "utf8")) as { policies: { id: string; product_name: string | null; policy_number: string | null; original_filename: string }[]; allIds: string[] } : null;
    // Strings only household B has (its product, policy number, file and its distinctive amounts).
    const bOwn = all.filter((f) => f.household === "B");
    const bMarkers = [...new Set([
      ...(bState?.policies ?? []).flatMap((p) => [p.product_name, p.policy_number, p.original_filename]),
      ...bOwn.flatMap((f) => [f.product, f.file, f.expected.policyNumber]),
    ].filter((s): s is string => !!s && s.length > 5))];
    const bAmounts = [/S\$\s?3,500\b/, /S\$\s?9,000\b/, /S\$\s?80,000\b/];
    const timings: Record<string, unknown> = { uploads: [], chat: [] };

    // 1. The synthetic household; family members through the Family page.
    await page.goto("/");
    const hh = await api(page, "/api/household");
    expect(String(hh.body.activeHouseholdName), "runs only inside this run's synthetic household").toContain(`${PREFIX}-Household-A`);
    const people: Record<string, { relationship: string; id: string | null }> = {};
    for (const [who, rel] of PEOPLE) people[who] = { relationship: rel, id: await addPerson(page, who, who, rel) };
    const familyText = await page.locator("main, body").first().innerText();
    leakCheck(familyText, "family page");

    // 2. Upload every household-A fixture through the Policies page.
    const uploads = await uploadAll(page, fxA, people, timings.uploads as unknown[], "uploads-A.json");
    const policiesA = await policies(page);
    await writeFile(path.join(OUT, "policies-A.json"), JSON.stringify(policiesA, null, 2));
    const policiesText = await page.locator("body").innerText();
    leakCheck(policiesText, "policies page");
    for (const m of bMarkers) soft(!policiesText.includes(m) && !JSON.stringify(policiesA).includes(m), `household B data "${m}" visible on A's policies page/API`);
    soft(bState, "household B phase did not run (no B state file): isolation checked by fixture strings only");
    for (const id of bState?.allIds ?? []) {
      const r = await api(page, `/api/policies/${id}`);
      soft([403, 404].includes(r.status), `A can read B's policy via /api/policies/<id>: HTTP ${r.status}`);
    }

    // 3-4. Chat turns.
    await page.goto("/chat");
    await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
    await ask(page, "What policies does Charmaine have?");
    await ask(page, "What is her hospital coverage?");
    const fracture1 = await ask(page, "Does she have a fracture benefit?");
    await ask(page, "Charmaine broke her arm.", { noMoneyYet: true });
    let t = await ask(page, "An accident.", { noMoneyYet: true });
    // Location, date and treatment questions -- answered through the answer buttons / inline answer.
    for (let i = 0; i < 7 && t.nextQuestion && !t.stuck && !t.error; i++) {
      const treatmentAnswered = transcript.some((x) => /treat|doctor|hospital|clinic|admit/i.test(x.via));
      const asked = t.nextQuestion;
      const repeated = transcript.length >= 2 && transcript[transcript.length - 2].nextQuestion === asked && /^(button|inline)/.test(t.via);
      t = await answerPending(page, repeated ? (_q, opts) => opts.find((o) => /^no$/i.test(o)) ?? opts[1] ?? "No" : pickAnswer, { noMoneyYet: !treatmentAnswered });
      soft(t.nextQuestion !== asked, `turn ${t.turn}: the same question was asked again after it was answered ("${asked}" answered "${t.user}")`);
    }
    const claim = await ask(page, "How much can she claim?");
    const dental = await ask(page, "What is her dental coverage?");
    soft(!/dental[^.]*\b(covered|benefit of|up to)\b/i.test(dental.answer) || /not (found|stated|covered|mentioned)|no dental|couldn.?t find|does not/i.test(dental.answer), `dental (absent from documents) answered as if covered: "${dental.answer.slice(0, 200)}"`);
    soft(!MONEY.test(dental.answer), `dental (absent) answer shows an amount`);
    const travel = await ask(page, "What does Marcus's travel policy cover overseas?");
    soft(/marcus/i.test(travel.answer) || travel.citations.length > 0, `Marcus travel: answer neither names Marcus nor cites a document`);
    for (const x of transcript) {
      for (const m of bMarkers) soft(!x.answer.includes(m) && !x.citations.join(" ").includes(m), `turn ${x.turn}: household B data "${m}" shown`);
      for (const re of bAmounts) soft(!re.test(x.answer), `turn ${x.turn}: household B's amount ${re.source} shown`);
    }
    const chatBody = await page.locator("body").innerText();
    for (const m of bMarkers) soft(!chatBody.includes(m), `household B data "${m}" on A's chat page`);

    // 6a. Reload and reopen from history. The chat currently on screen is
    // reopened first (whatever history entry is marked current), then the
    // Charmaine conversation; each must show the same last answer and the
    // same next question as before the reload.
    const beforeReopen = (await lastAnswer(page).innerText()).trim();
    const beforeQuestion = await currentQuestion(page);
    const beforeCount = await answersLoc(page).count();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined); await expect(async () => { await page.locator("details.chat-history").evaluate((d) => { (d as HTMLDetailsElement).open = true; }); await page.locator(".history-open").first().waitFor({ state: "visible", timeout: 2_000 }); }).toPass({ timeout: 30_000 });
    const currentTitle = (await page.locator(".history-open[aria-current=true]").first().innerText().catch(() => "")).trim();
    soft(currentTitle, "reopen: no history entry is marked as the current chat before reload");
    const lastCharmaineTurn = [...transcript].reverse().find((x) => !/marcus/i.test(x.user))!;
    await page.reload();
    const title1 = await reopenLatest(page, currentTitle ? new RegExp("^" + currentTitle.split("\n")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : null);
    const afterReopen = (await lastAnswer(page).innerText()).trim();
    const afterCount = await answersLoc(page).count();
    const reopen1 = { title: title1, currentTitle, beforeCount, afterCount, sameLastAnswer: afterReopen === beforeReopen, beforeQuestion, afterQuestion: await currentQuestion(page), beforeText: beforeReopen, afterText: afterReopen };
    soft(reopen1.sameLastAnswer, `reopen: last answer differs after reopening the current chat "${title1}"`);
    soft(reopen1.beforeQuestion === reopen1.afterQuestion, `reopen: next question changed ("${beforeQuestion}" -> "${reopen1.afterQuestion}")`);
    await page.screenshot({ path: path.join(OUT, "reopen-1.png"), fullPage: true });
    const titleC = await reopenLatest(page, /^What policies does Charmaine/);
    const cLast = (await lastAnswer(page).innerText()).trim();
    const reopen1c = { title: titleC, expectedFromTurn: lastCharmaineTurn.turn, sameLastAnswer: cLast === lastCharmaineTurn.answer, expectedQuestion: lastCharmaineTurn.nextQuestion, afterQuestion: await currentQuestion(page), afterCount: await answersLoc(page).count(), afterText: cLast };
    soft(reopen1c.sameLastAnswer, `reopen Charmaine chat: last answer differs from turn ${lastCharmaineTurn.turn}`);
    soft(reopen1c.expectedQuestion === reopen1c.afterQuestion, `reopen Charmaine chat: next question changed ("${reopen1c.expectedQuestion}" -> "${reopen1c.afterQuestion}")`);
    await page.screenshot({ path: path.join(OUT, "reopen-1-charmaine.png"), fullPage: true });

    // 5. Delete the policy the fracture answer relied on, through the Policies page.
    const fixtureWithFracture = fxA.find((f) => f.owner === "Charmaine" && f.expected.benefits.some((x) => /fracture/i.test(x.name)));
    const citedNames = fracture1.citations.join(" ");
    const target = policiesA.find((p) => fixtureWithFracture && p.original_filename === fixtureWithFracture.file)
      ?? policiesA.find((p) => p.product_name && citedNames.includes(p.product_name));
    soft(target, "could not identify the policy behind the fracture answer to delete");
    let deletedName: string | null = null;
    if (target) {
      deletedName = target.product_name ?? target.original_filename;
      await page.goto("/policies");
      const c = page.locator(".document-card").filter({ hasText: deletedName }).first();
      await c.getByRole("button", { name: "Delete" }).click();
      await c.getByRole("button", { name: "Confirm delete" }).click();
      soft(await expect(page.getByTestId("library-notice")).toContainText(/Deleted .*no longer used in answers/, { timeout: 60_000 }).then(() => true, () => false), `delete of "${deletedName}": no deletion confirmation`);
      soft(!(await policies(page)).some((p) => p.id === target.id), `deleted policy still listed by /api/policies`);
      await page.screenshot({ path: path.join(OUT, "after-delete-policies.png"), fullPage: true });
      // Any other household-A policy that carries the same fracture wording stays; record which.
      await writeFile(path.join(OUT, "policies-A-after-delete.json"), JSON.stringify(await policies(page), null, 2));
    }
    await reopenLatest(page, /^What policies does Charmaine/);
    const invalidated = await page.locator("[data-testid=answer-invalidated]").count();
    const fracture2 = await ask(page, "Does she have a fracture benefit?");
    if (deletedName) {
      soft(!fracture2.citations.join(" ").includes(deletedName) && !fracture2.statedLimits.join(" ").includes(deletedName), `after deletion the deleted policy "${deletedName}" is still cited`);
      soft(!fracture2.answer.includes(deletedName), `after deletion the deleted policy "${deletedName}" is still named in the answer`);
    }

    // 6b. Reload and reopen once more after the deletion.
    const lastBefore = (await lastAnswer(page).innerText()).trim();
    await page.reload();
    const title2 = await reopenLatest(page, /^What policies does Charmaine/);
    const lastAfter = (await lastAnswer(page).innerText()).trim();
    soft(lastAfter === lastBefore, `reopen after deletion: last answer differs`);
    await page.screenshot({ path: path.join(OUT, "reopen-2.png"), fullPage: true });

    timings.chat = transcript.map((x) => ({ turn: x.turn, user: x.user, via: x.via, ms: x.ms, stuck: x.stuck }));
    await writeFile(path.join(OUT, "timings.json"), JSON.stringify(timings, null, 2));
    await writeFile(path.join(OUT, "summary.json"), JSON.stringify({ historyLog, reopen1, reopen1c, reopen2: { title: title2, same: lastAfter === lastBefore, beforeText: lastBefore, afterText: lastAfter }, invalidatedMarkersAfterDelete: invalidated, deletedName, bMarkers, failures, claimTurn: claim.turn }, null, 2));
    expect(failures, `\n${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`).toEqual([]);
  });
});

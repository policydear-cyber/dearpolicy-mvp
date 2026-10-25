/**
 * V1.1 independent release evaluation -- the full browser journey, with REAL sessions.
 *
 * Stack: e2e/playwright.v11.config.ts (the owner/reviewer stack: next dev WITHOUT the development
 * identity, the test-only Auth stand-in e2e/support/fake-auth.mjs, fake VirusTotal, the job worker,
 * local Postgres, the deterministic model stand-in). Synthetic data only (e2e/support/v11-dataset.ts).
 *
 *   T0-8  sign-up, confirmation, sign-out, then sign-in with ONE click (the login defect)
 *   1     family: Josephine and Marcus through the Family page
 *   2     upload every household-A document through the Policies page (the 2025 HospitalShield
 *         edition supersedes the 2022 one through the upload API field -- no control exists in
 *         the page), processing to a terminal state, family linking
 *   3     factual questions from the evaluation set through the chat page
 *   4     the arm-fracture claim interview, answered with the page's own buttons / answer box,
 *         through its final response
 *   5     evidence review: operator-seeded critical-illness certificates (the owner/reviewer
 *         journey's fixture), claim evidence uploaded on the claim page, a DearPolicy reviewer
 *         signs in and records decisions, the owner sees the indicative estimate, then asks in chat
 *   6     reopened conversation
 *   7     deletion (AccidentGuard-M, through the Policies page) and the post-deletion question
 *   8     Task 0 rendered-page checks: claims list vs detail (T0-4), fracture claim action (T0-5),
 *         Benefits / Coverage / Documents pages (T0-6), Usage page (T0-7)
 *   9     household B (second owner, same printed name) + isolation, then both households deleted
 *         through the Household page
 * Output: e2e-results/v11-journey/{answers.json,transcript.md,transcript.json,timings.json,
 * task0-ui.json,journey.json} + one screenshot per chat turn. Score with
 * `node --import tsx scripts/v11-eval-run.ts --score e2e-results/v11-journey/answers.json`.
 * Assertions here are the journey's own hard checks; release gates are applied by the scorer.
 * Failures are collected (soft) so one defect never hides the next; the test fails at the end.
 */
import { test, expect, type Page, type Browser } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Client } from "pg";
import {
  api, emailFor, newPassword, recordHousehold, hardenNavigation, hideDevOverlay, outboxLink, authUserId, adminCreateUser,
  signUpThroughUi, signInThroughUi, signOutThroughUi, syntheticMemo, operator, reviewerAdmin, INDICATIVE_NOTICE,
} from "../support/journey";
import { renderDataset, PEOPLE, PREFIX, UPLOAD_ORDER, V11_QUESTIONS, type RenderedDoc, type EvalQuestion } from "../support/v11-dataset";

const OUT = path.resolve("e2e-results/v11-journey");
const SEED_FILE = path.resolve(".e2e-v11-seed.json");
if (process.env.E2E_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } });

type Cit = { doc: string | null; alt?: string[]; policyName: string; page: number | null };
type Turn = { step: string; qid: string | null; user: string; answer: string; citations: Cit[]; nextQuestion: string | null; ms: number; screenshot: string };
const failures: string[] = [];
const soft = (ok: unknown, msg: string) => { if (!ok) failures.push(msg); return !!ok; };
const turns: Turn[] = [];
const answers: { qid: string; visible: string; citations: Cit[]; ms: number; error?: string | null; nextQuestion?: string | null; extra?: Record<string, unknown> }[] = [];
const steps: { step: string; ms: number; note?: string }[] = [];
const journey: Record<string, unknown> = { prefix: PREFIX, started: new Date().toISOString() };
const task0: { id: string; pass: boolean; detail: string }[] = [];

async function db<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
/** Optional memory relief on a small machine: restart the local dev server between phases
 * (V11_RESTART_APP_CMD). Sessions live in the browser and the Auth stand-in, so nobody is signed out. */
async function restartApp(why: string, pages: Page[]) {
  const cmd = process.env.V11_RESTART_APP_CMD; if (!cmd) return;
  // Leave the app first: a page connected to the dev server reloads itself when the server comes back.
  for (const p of pages) await p.goto("about:blank").catch(() => undefined);
  const t0 = Date.now(); console.log(new Date().toISOString().slice(11, 19), "restart app: " + why);
  try { console.log(execSync(cmd, { encoding: "utf8", timeout: 240_000 }).trim()); } catch (e) { console.log("restart failed: " + (e as Error).message.split("\n")[0]); }
  steps.push({ step: "restart app (" + why + ")", ms: Date.now() - t0, note: "test-harness memory relief, not user time" });
}
const timed = async <T>(step: string, fn: () => Promise<T>, note?: string) => { const t0 = Date.now(); console.log(new Date().toISOString().slice(11, 19), "step: " + step); try { return await fn(); } finally { steps.push({ step, ms: Date.now() - t0, note }); } };

// ------------------------------------------------------------ chat helpers
const answersLoc = (page: Page) => page.locator(".chat-window > .message.assistant:not(:has(.thinking))");
async function waitForAnswer(page: Page, before: number, limitMs = 180_000) {
  const t0 = Date.now();
  for (;;) {
    const n = await answersLoc(page).count();
    const thinking = await page.locator(".message-body.thinking").count();
    const err = await page.locator(".message-inline-error, .chat-window > .alert.error").count();
    if (!thinking && (n > before || err)) return;
    if (Date.now() - t0 > limitMs) throw new Error(`no answer within ${limitMs / 1000}s`);
    await page.waitForTimeout(400);
  }
}
/** Everything the person can reach in the answer (collapsed sections opened), and its citations. */
async function readAnswer(page: Page, household: "A" | "B", docs: RenderedDoc[]) {
  const a = answersLoc(page).last();
  await a.evaluate((el) => el.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
  const visible = (await a.innerText()).trim();
  const raw = await a.locator(".citations .citation").evaluateAll((els) => els.map((e) => {
    const span = e.querySelector("span"); const small = span?.querySelector("small")?.textContent ?? "";
    return { name: (span?.textContent ?? e.textContent ?? "").replace(small, "").trim(), page: (e.querySelector("b")?.textContent ?? "").trim() };
  }));
  const limits = await a.locator(".policy-stated-limit em").allTextContents();
  // A visible citation names the product, not the document version: documents sharing a printed
  // product name (the 2022/2025 HospitalShield editions, the AccidentGuard schedule and its
  // endorsement) are all recorded as candidates ("alt"); the current document is the primary.
  const mapDoc = (name: string): { doc: string | null; alt: string[] } => {
    const pool = docs.filter((d) => name.includes(d.productName)).sort((x, y) => Number(y.household === household) - Number(x.household === household) || y.productName.length - x.productName.length);
    if (!pool.length) return { doc: null, alt: [] };
    const best = pool.filter((d) => d.productName === pool[0].productName);
    const primary = (best.find((d) => d.key === "accident") ?? best.find((d) => d.key === "hosp2025") ?? best[0]).key;
    return { doc: primary, alt: best.map((d) => d.key).filter((k) => k !== primary) };
  };
  const citations: Cit[] = [
    ...raw.map((c) => ({ ...mapDoc(c.name), policyName: c.name, page: Number(c.page.match(/\d+/)?.[0] ?? NaN) || null })),
    ...limits.map((t) => { const m = t.match(/From (.+?), page (\d+)/); return { ...(m ? mapDoc(m[1]) : { doc: null, alt: [] }), policyName: m?.[1] ?? t, page: m ? Number(m[2]) : null }; }),
  ];
  const nq = a.locator(".fact-question > strong");
  const next = (await nq.count()) ? await nq.first().innerText().catch(() => "") : "";
  return { visible, citations, nextQuestion: next.trim() || null };
}
const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);
async function chatTurn(page: Page, household: "A" | "B", docs: RenderedDoc[], step: string, qid: string | null, user: string, act: () => Promise<void>) {
  log(`chat ${qid ?? step}: ${user.slice(0, 80)}`);
  const before = await answersLoc(page).count();
  const t0 = Date.now();
  await act();
  let error: string | null = null;
  try { await waitForAnswer(page, before); } catch (e) { error = (e as Error).message; }
  const ms = Date.now() - t0;
  const errLoc = page.locator(".message-inline-error, .chat-window > .alert.error");
  const errText = (await errLoc.count()) ? await errLoc.last().innerText().catch(() => "") : "";
  const r = (await answersLoc(page).count()) > before ? await readAnswer(page, household, docs) : { visible: errText ? "[the page showed an error] " + errText : "", citations: [], nextQuestion: null };
  const shot = path.join(OUT, `turn-${String(turns.length + 1).padStart(2, "0")}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  log(`  -> ${ms} ms ${error ? "ERROR " + error : ""} ${r.visible.replace(/\s+/g, " ").slice(0, 160)}`);
  const t: Turn = { step, qid, user, answer: r.visible, citations: r.citations, nextQuestion: r.nextQuestion, ms, screenshot: path.relative(process.cwd(), shot) };
  turns.push(t);
  if (qid) answers.push({ qid, visible: r.visible, citations: r.citations, ms, error: error ?? (errText || null), nextQuestion: r.nextQuestion, extra: { sent: user } });
  await writeFile(path.join(OUT, "transcript.json"), JSON.stringify(turns, null, 2));
  return t;
}
const composer = (page: Page, text: string) => async () => { await page.getByLabel("Message to DearPolicy").fill(text); await page.getByRole("button", { name: /send/i }).click(); };
/** Answers the questions the claim interview asks, with the page's own buttons / answer box, until none is left. */
async function answerInterview(page: Page, docs: RenderedDoc[], step: string, replies: { match: string; reply: string }[], maxSteps = 10) {
  for (let i = 1; i <= maxSteps; i++) {
    const a = answersLoc(page).last();
    const qLoc = a.locator(".fact-question > strong");
    const question = (await qLoc.count()) ? (await qLoc.first().innerText().catch(() => "")).trim() : "";
    if (!question) return;
    const reply = replies.find((r) => new RegExp(r.match, "i").test(question))?.reply ?? "Not sure";
    const buttons = a.locator(".fact-question .quick-replies button:enabled");
    const options = (await buttons.allTextContents()).map((t) => t.trim());
    const option = options.find((o) => o.toLowerCase().startsWith(reply.toLowerCase()));
    const inline = a.locator(".fact-question input[aria-label='Your answer']");
    let act: () => Promise<void>;
    if (option) act = () => buttons.filter({ hasText: option }).first().click();
    else if (await inline.count()) act = async () => { await inline.first().fill(reply); await inline.first().press("Enter"); };
    else act = composer(page, reply);
    await chatTurn(page, "A", docs, step, null, option ?? reply, act);
  }
}
async function newChat(page: Page) { await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined); }

// ------------------------------------------------------------ uploads
type Policy = { id: string; original_filename: string; product_name: string | null; processing_status: string; quarantine_status: string; processing_error: string | null; processing_message: string | null; linked_people: { id: string; name: string }[] };
async function policies(page: Page): Promise<Policy[]> { return (await api<{ policies: Policy[] }>(page, "/api/policies")).body.policies ?? []; }
async function uploadDoc(page: Page, d: RenderedDoc, profileLabel: string, supersedesId?: string) {
  const t0 = Date.now();
  if (supersedesId) {
    // No page control exists for "this replaces an older version"; the upload route's own field is used.
    const res = await page.evaluate(async ({ b64, name, type, member, supersedes }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fd = new FormData(); fd.append("file", new File([bin], name, { type })); fd.append("familyMemberId", member); fd.append("supersedesPolicyId", supersedes);
      const r = await fetch("/api/policies/upload", { method: "POST", body: fd }); return { status: r.status, body: await r.text() };
    }, { b64: d.buffer.toString("base64"), name: d.fileName, type: d.mimeType, member: String(journey[`member:${d.person}`]), supersedes: supersedesId });
    soft(res.status < 300, `upload ${d.key} (superseding) returned HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  } else {
    await page.goto("/policies");
    await page.locator(".upload-form select").selectOption({ label: profileLabel }).catch(() => soft(false, `profile hint "${profileLabel}" not offered`));
    await page.locator(".upload-form input[type=file]").setInputFiles({ name: d.fileName, mimeType: d.mimeType, buffer: d.buffer });
    await page.getByRole("button", { name: "Upload & analyse" }).click();
    await expect(page.locator(".upload-panel .upload-status")).toContainText(/received/i, { timeout: 120_000 });
  }
  const states: string[] = [];
  let p: Policy | undefined;
  for (;;) {
    p = (await policies(page)).find((x) => x.original_filename === d.fileName);
    if (p) { const s = `${p.quarantine_status}/${p.processing_status}`; if (states.at(-1) !== s) states.push(s); }
    if (p && ["ready", "failed"].includes(p.processing_status)) break;
    if (Date.now() - t0 > 300_000) break;
    await page.waitForTimeout(1500);
  }
  const ms = Date.now() - t0;
  const attempts = p ? await db((c) => c.query<{ a: number }>(`SELECT coalesce(max(attempt_count),0)::int a FROM background_jobs WHERE job_type='policy_processing' AND idempotency_key=$1`, [p!.id])).then((r) => r.rows[0].a).catch(() => null) : null;
  return { p, ms, states, attempts };
}

// ======================================================================================
test.describe.serial("V1.1 release journey", () => {
  test.setTimeout(Number(process.env.V11_JOURNEY_TIMEOUT_MS ?? 90 * 60_000));
  let owner: Page;
  let docs: RenderedDoc[] = [];
  const ownerEmail = emailFor("v11-owner"), ownerPassword = newPassword();
  const ownerBEmail = emailFor("v11-owner-b"), ownerBPassword = newPassword();
  const reviewerEmail = emailFor("v11-reviewer"), reviewerPassword = newPassword();
  const ids: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    await mkdir(OUT, { recursive: true });
    owner = hardenNavigation(await (await browser.newContext()).newPage());
    await hideDevOverlay(owner);
    docs = await renderDataset();
  });

  test("the whole journey", async ({ browser }: { browser: Browser }) => {
    // ---------------- T0-8: sign-up, confirmation, sign-out, ONE-click sign-in
    await timed("sign-up + confirmation", async () => {
      await signUpThroughUi(owner, { email: ownerEmail, password: ownerPassword, household: `${PREFIX}-Household-A` });
      await owner.goto(await outboxLink(ownerEmail));
      await owner.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/api/"), { timeout: 60_000 });
    });
    const hh = await api<{ activeHouseholdId: string; activeHouseholdName: string }>(owner, "/api/household");
    ids.household = hh.body.activeHouseholdId; recordHousehold(ids.household); journey.householdA = ids.household;
    expect(hh.body.activeHouseholdName).toContain(PREFIX);
    ids.ownerUser = await authUserId(ownerEmail);
    await signOutThroughUi(owner);
    {
      await owner.goto("/login");
      await owner.locator("#dp-email").fill(ownerEmail);
      await owner.locator("input[type=password]").fill(ownerPassword);
      const t0 = Date.now();
      await owner.getByRole("button", { name: /sign in/i }).click();
      const oneClick = await owner.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).then(() => true, () => false);
      let clicks = 1;
      if (!oneClick) { clicks++; await owner.getByRole("button", { name: /sign in/i }).click().catch(() => undefined); await owner.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }); }
      const ms = Date.now() - t0;
      task0.push({ id: "T0-8", pass: oneClick, detail: oneClick ? `signed in with one click in ${ms} ms` : `the first click did not sign in within 20 s; a second click was needed (${ms} ms total)` });
      steps.push({ step: "sign-in", ms, note: `${clicks} click(s)` });
      await owner.waitForLoadState("load").catch(() => undefined);
    }

    // ---------------- 1. family
    await timed("family (2 people)", async () => {
      await owner.goto("/family");
      for (const key of ["josephine", "marcus"] as const) {
        const p = PEOPLE[key];
        await owner.locator("#fm-new-name").fill(p.fullName);
        await owner.locator("#fm-new-relationship").selectOption(p.relationship);
        await owner.locator("#fm-new-preferred").fill(p.preferred);
        await owner.getByRole("button", { name: "+ Add person" }).click();
        await expect(owner.locator(".profile-add-panel [role=status]")).toHaveText("Profile added.", { timeout: 60_000 });
      }
    });
    const family = (await api<{ family: { id: string; display_name: string }[] }>(owner, "/api/family")).body.family;
    for (const key of ["josephine", "marcus"] as const) journey[`member:${key}`] = family.find((f) => f.display_name === PEOPLE[key].fullName)?.id;

    // ---------------- 2. uploads (household A)
    const uploads: Record<string, unknown>[] = [];
    for (const key of UPLOAD_ORDER) {
      const d = docs.find((x) => x.key === key)!;
      if (d.household !== "A") continue;
      const person = d.person ?? "marcus";
      const label = `${PEOPLE[person].fullName} · ${PEOPLE[person].relationship}`;
      const r = await timed(`upload ${d.format} ${d.key}`, () => uploadDoc(owner, d, label, d.supersedes ? ids[`policy:${d.supersedes}`] : undefined));
      if (r.p) ids[`policy:${d.key}`] = r.p.id;
      const expectedTerminal = d.lifecycle === "unreadable" ? "failed" : "ready";
      soft(r.p?.processing_status === expectedTerminal, `upload ${d.key}: ended ${r.p?.quarantine_status}/${r.p?.processing_status} (expected ${expectedTerminal}); states ${r.states.join(" -> ")}`);
      let linked = !d.person || d.lifecycle === "unreadable" || !!r.p?.linked_people.some((l) => l.name === PEOPLE[d.person!].fullName);
      let ownerAction = "none";
      if (!linked && r.p) {
        await owner.goto("/policies");
        const card = owner.locator(".document-card").filter({ hasText: r.p.product_name ?? r.p.original_filename }).first();
        // PR #77: open the one-line "Covers" picker first ("Choose" when nobody is linked yet). Was: the chips were shown open.
        const opener = card.getByTestId("covers-picker").getByRole("button", { name: /^(?:Change|Choose)$/ });
        // The card renders after the page loads; wait for its picker line before deciding it is already open.
        await card.getByTestId("covers-picker").waitFor({ timeout: 10_000 }).catch(() => {});
        if (await opener.isVisible().catch(() => false)) await opener.click();
        const declare = card.locator(".declare-owner button").filter({ hasText: PEOPLE[d.person!].fullName });
        const match = card.locator(".detected-row select").first();
        if (await declare.count()) { await declare.first().click(); ownerAction = "declared owner in the page"; }
        else if (await match.count()) { await match.selectOption({ label: PEOPLE[d.person!].fullName }).catch(() => undefined); ownerAction = "matched the detected name in the page"; }
        await owner.waitForTimeout(1500);
        linked = !!(await policies(owner)).find((x) => x.id === r.p!.id)?.linked_people.some((l) => l.name === PEOPLE[d.person!].fullName);
      }
      soft(linked, `upload ${d.key}: not linked to ${d.person} (owner action: ${ownerAction})`);
      uploads.push({ key: d.key, format: d.format, file: d.fileName, ms: r.ms, states: r.states, attempts: r.attempts, status: r.p?.processing_status, message: r.p?.processing_message, error: r.p?.processing_error, linked, ownerAction });
    }
    journey.uploads = uploads;
    await owner.goto("/policies");
    await owner.screenshot({ path: path.join(OUT, "documents-page.png"), fullPage: true });

    await restartApp("before chat", [owner]);
    // ---------------- 3/4. factual questions and the claim interview (evaluation set, phase "pre")
    let conv = "";
    let lastT: Turn | null = null;
    const pre = V11_QUESTIONS.filter((q) => q.household === "A" && q.phase === "pre" && q.mode !== "provider_quota_failure");
    for (const q of pre) {
      if (q.conversation !== conv) { await newChat(owner); conv = q.conversation; }
      if (!q.mode) { lastT = await chatTurn(owner, "A", docs, q.tags.includes("claim_interview") ? "claim interview" : "factual question", q.id, q.text, composer(owner, q.text)); continue; }
      if (q.mode === "interview") {
        for (let i = 1; i <= q.interview!.maxSteps; i++) {
          const a = answersLoc(owner).last();
          const qLoc = a.locator(".fact-question > strong");
          const question = (await qLoc.count()) ? (await qLoc.first().innerText().catch(() => "")).trim() : "";
          if (!question) break;
          const reply = q.interview!.replies.find((r) => new RegExp(r.match, "i").test(question))?.reply ?? "Not sure";
          const buttons = a.locator(".fact-question .quick-replies button:enabled");
          const options = (await buttons.allTextContents()).map((t) => t.trim());
          const option = options.find((o) => o.toLowerCase().startsWith(reply.toLowerCase()));
          const inline = a.locator(".fact-question input[aria-label='Your answer']");
          let sent = reply;
          let act: () => Promise<void>;
          if (option) { sent = option; act = () => buttons.filter({ hasText: option }).first().click(); }
          else if (await inline.count()) act = async () => { await inline.first().fill(reply); await inline.first().press("Enter"); };
          else act = composer(owner, reply);
          lastT = await chatTurn(owner, "A", docs, "claim interview", `${q.id}.${i}`, sent, act);
          answers.at(-1)!.extra = { ...(answers.at(-1)!.extra ?? {}), question };
        }
        const finished = !(await answersLoc(owner).last().locator(".fact-question > strong").count());
        if (answers.at(-1)?.qid.startsWith(q.id + ".")) answers.at(-1)!.extra = { ...(answers.at(-1)!.extra ?? {}), finished };
        continue;
      }
      if (q.mode === "interview_final" && lastT) { const last = answers.at(-1)!; answers.push({ ...last, qid: q.id, extra: { ...(last.extra ?? {}), finalOf: last.qid } }); continue; }
      if (q.mode === "reopen") {
        // 6. reopened conversation (history), compared with what was on screen
        const before = await answersLoc(owner).last().innerText();
        const nextBefore = lastT?.nextQuestion ?? null;
        const t0 = Date.now();
        await owner.reload();
        await owner.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined); await expect(async () => { await owner.locator("details.chat-history").evaluate((d) => { (d as HTMLDetailsElement).open = true; }); await owner.locator(".history-open").first().waitFor({ state: "visible", timeout: 2_000 }); }).toPass({ timeout: 30_000 });
        await owner.locator(".history-open").filter({ hasText: /broke her arm/i }).first().click().catch(() => owner.locator(".history-open").first().click());
        await expect(answersLoc(owner).first()).toBeVisible({ timeout: 60_000 });
        await owner.waitForTimeout(1000);
        await answersLoc(owner).last().evaluate((el) => el.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
        const after = await answersLoc(owner).last().innerText();
        const nqa = answersLoc(owner).last().locator(".fact-question > strong");
        const nextAfter = (await nqa.count()) ? ((await nqa.first().innerText().catch(() => "")).trim() || null) : null;
        const events = await db((c) => c.query(`SELECT id,status,event_summary FROM claim_sessions WHERE account_id=$1`, [ids.household])).then((r) => r.rows);
        const sent = answers.filter((x) => /^Q1[2-6]/.test(x.qid)).map((x) => String(x.extra?.sent ?? "").trim());
        answers.push({ qid: q.id, visible: after, citations: [], ms: Date.now() - t0, nextQuestion: nextAfter,
          extra: { sameLastAnswer: after.trim() === before.trim(), sameNextQuestion: nextAfter === nextBefore, claimEvents: events.length,
            eventNamedAnAccident: events.some((e) => /^an accident\.?$/i.test(String(e.event_summary ?? "").trim())),
            eventsNamedAfterReplies: events.map((e) => String(e.event_summary ?? "").trim()).filter((s) => s && sent.includes(s)) } });
        await owner.screenshot({ path: path.join(OUT, "reopened-conversation.png"), fullPage: true });
        steps.push({ step: "reopen conversation", ms: Date.now() - t0 });
        ids.fractureClaim = String(events.find((e) => /arm|fracture|injur|accident/i.test(String(e.event_summary ?? "")))?.id ?? events[0]?.id ?? "");
      }
    }

    // ---------------- 8a. Task 0 rendered pages: claims list vs detail, fracture claim action
    await owner.goto("/claims");
    await owner.screenshot({ path: path.join(OUT, "claims-list.png"), fullPage: true });
    const entries = owner.locator(".claim-session-entry");
    const listText = (await entries.allInnerTexts()).join("\n---\n");
    journey.claimsList = listText;
    if (ids.fractureClaim) {
      const entry = entries.filter({ has: owner.locator(`a[href*="${ids.fractureClaim}"]`) }).first();
      const entryText = (await entry.innerText().catch(() => "")) || listText;
      await owner.goto(`/claims/${ids.fractureClaim}`);
      const hasEstimate = await owner.getByTestId("indicative-estimate").getAttribute("data-has-estimate").catch(() => null);
      const detailText = await owner.locator("main").innerText();
      await owner.screenshot({ path: path.join(OUT, "claim-detail-fracture.png"), fullPage: true });
      // The status badge (data-testid="claim-status" since V1.1; the badge text before it).
      const badge = entry.locator("[data-testid=claim-status], .claim-session-status").first();
      const statusText = (await badge.count()) ? await badge.innerText().catch(() => "") : entryText.split("\n").slice(0, 6).join(" ");
      const listSaysReady = /assessment ready|\bready\b/i.test(statusText);
      task0.push({ id: "T0-4", pass: !(listSaysReady && hasEstimate !== "yes"), detail: `list: "${entryText.replace(/\s+/g, " ").slice(0, 160)}" / detail data-has-estimate=${hasEstimate} ("${(detailText.match(/No estimate yet[^.]*\./) ?? [""])[0]}")` });
      const death = entryText.match(/death certificate|coroner/i);
      task0.push({ id: "T0-5", pass: !death, detail: death ? `the fracture claim's list action says: "${entryText.split("\n").find((l) => /death certificate|coroner/i.test(l))}"` : "no death documents in the fracture claim's list entry" });
    } else { task0.push({ id: "T0-4", pass: false, detail: "no claim event was recorded for the fracture interview" }); task0.push({ id: "T0-5", pass: false, detail: "no claim event to check" }); }

    await restartApp("before evidence review", [owner]);
    // ---------------- 5. evidence review (operator-seeded critical-illness fixture, as in the owner/reviewer journey)
    const out = operator("e2e/support/seed-claim-fixture.ts", [], { E2E_SEED_USER_ID: ids.ownerUser, E2E_SEED_FILE: SEED_FILE });
    soft(/seeded synthetic claim fixtures/.test(out), "operator claim fixture seeded");
    const seed = JSON.parse(readFileSync(SEED_FILE, "utf8")) as { patient: string; patientName: string };
    await newChat(owner);
    await chatTurn(owner, "A", docs, "evidence review: claim question", null, `${seed.patientName} was diagnosed with Malignant neoplasm of the colon on 2026-06-01. How much can we claim?`,
      composer(owner, `${seed.patientName} was diagnosed with Malignant neoplasm of the colon on 2026-06-01. How much can we claim?`));
    // Since V1.1 the claim is recorded once the interview has its facts: answer it through the page.
    await answerInterview(owner, docs, "evidence review: claim interview", [
      { match: "specialist|oncologist", reply: "Yes" }, { match: "when|date", reply: "2026-06-01" }, { match: "hospital|admitted", reply: "No" },
      { match: "stage|spread|severity", reply: "Not sure" }, { match: "symptom|before the (?:cover|policy)|first", reply: "No" }, { match: ".", reply: "Not sure" }]);
    const history = await api<{ conversations: { id: string }[] }>(owner, "/api/chat/history?scope=all");
    for (const c of history.body.conversations ?? []) {
      const msgs = await api<{ messages: { answer_json?: { claimSessionId?: string } | null }[] }>(owner, `/api/chat/history/${c.id}`);
      const claimId = msgs.body.messages?.map((m) => m.answer_json?.claimSessionId ?? "").filter(Boolean).at(-1) ?? "";
      if (!claimId) continue;
      const claim = await api<{ claim: { family_member_id: string } }>(owner, `/api/claims/${claimId}`);
      if (claim.body.claim?.family_member_id === seed.patient) { ids.ciClaim = claimId; ids.ciConversation = c.id; break; }
    }
    soft(ids.ciClaim, "the chat recorded the critical-illness claim");
    if (ids.ciClaim) {
      await timed("evidence upload", async () => {
        await owner.goto(`/claims/${ids.ciClaim}`);
        await owner.locator("select").first().selectOption("specialist_memo");
        await owner.locator("input[type=file]").setInputFiles({ name: `${PREFIX}-memo.pdf`, mimeType: "application/pdf", buffer: await syntheticMemo(seed.patientName) });
        await owner.getByRole("button", { name: /^upload$/i }).click();
        for (let i = 0; i < 240; i++) {
          const d = (await api<{ documents: { original_filename: string; status: string; id: string }[] }>(owner, `/api/claims/evidence?familyMemberId=${seed.patient}&claimSessionId=${ids.ciClaim}`)).body.documents ?? [];
          const memo = d.find((x) => x.original_filename === `${PREFIX}-memo.pdf`);
          if (memo?.status === "needs_review") { ids.memo = memo.id; break; }
          await owner.waitForTimeout(1000);
        }
      });
      soft(ids.memo, "the evidence memo reached needs_review");
      await timed("reviewer decisions", async () => {
        ids.reviewerUser = await adminCreateUser(reviewerEmail, reviewerPassword);
        reviewerAdmin(["provision", "--user", ids.reviewerUser, "--label", `${PREFIX}-Reviewer`, "--operator", "e2e-operator"]);
        reviewerAdmin(["assign", "--reviewer", ids.reviewerUser, "--household", ids.household, "--claim", ids.ciClaim, "--hours", "2", "--operator", "e2e-operator"]);
        const reviewer = hardenNavigation(await (await browser.newContext()).newPage());
        await reviewer.goto("/login");
        await reviewer.locator("#dp-email").fill(reviewerEmail);
        await reviewer.locator("input[type=password]").fill(reviewerPassword);
        await reviewer.getByRole("button", { name: /sign in/i }).click();
        await reviewer.waitForURL(/\/reviewer$/, { timeout: 60_000 });
        await reviewer.getByRole("link").filter({ hasText: seed.patientName }).first().click();
        await reviewer.waitForURL(/\/reviewer\/assignments\//, { timeout: 180_000 });
        await expect(reviewer.getByText(`${PREFIX}-memo.pdf`)).toBeVisible({ timeout: 60_000 });
        for (const route of ["match", "ci-match", "disability-match", "travel-match"]) await api(reviewer, `/api/claims/evidence/${ids.memo}/${route}`, { method: "POST", body: {} }).catch(() => undefined);
        const card = reviewer.locator(".action-card").filter({ hasText: `${PREFIX}-memo.pdf` });
        for (const number of [`${PREFIX}-LC-SGD`, `${PREFIX}-LC-USD`]) {
          const option = await card.locator("select option").filter({ hasText: number }).getAttribute("value").catch(() => null);
          if (!option) { soft(false, `reviewer: no decision option for ${number}`); continue; }
          await card.locator("select").selectOption(option);
          await card.getByLabel(/^Matches/).check();
          await card.locator("textarea").fill("Synthetic review against the cited definition.");
          await card.getByRole("button", { name: "Record decision" }).click();
          await expect(card.locator("textarea")).toHaveValue("", { timeout: 60_000 });
        }
        await reviewer.screenshot({ path: path.join(OUT, "reviewer-decisions.png"), fullPage: true });
        await reviewer.context().close();
      });
      await owner.goto(`/claims/${ids.ciClaim}`);
      const est = owner.getByTestId("indicative-estimate");
      const hasEstimate = await expect(est).toHaveAttribute("data-has-estimate", "yes", { timeout: 90_000 }).then(() => true, () => false);
      soft(hasEstimate, "after the reviewer's decisions the claim page shows an indicative estimate");
      journey.claimPageEstimate = await est.innerText().catch(() => "");
      soft(/Indicative estimate/.test(String(journey.claimPageEstimate)) || (await owner.getByTestId("indicative-estimate-notice").innerText().catch(() => "")) === INDICATIVE_NOTICE, "the estimate carries the indicative notice");
      await owner.screenshot({ path: path.join(OUT, "claim-estimate.png"), fullPage: true });
      // The final answer in chat, in the same claim conversation.
      await owner.goto("/chat");
      await owner.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined); await expect(async () => { await owner.locator("details.chat-history").evaluate((d) => { (d as HTMLDetailsElement).open = true; }); await owner.locator(".history-open").first().waitFor({ state: "visible", timeout: 2_000 }); }).toPass({ timeout: 30_000 });
      await owner.locator(".history-open").filter({ hasText: /Malignant|diagnosed/i }).first().click().catch(() => undefined);
      await owner.waitForTimeout(1000);
      const fin = await chatTurn(owner, "A", docs, "final answer after evidence review", null, "How much can we claim now?", composer(owner, "How much can we claim now?"));
      journey.finalAnswer = fin.answer;
      soft(/200,000|100,000/.test(fin.answer), "the chat's final answer after review gives the reviewed indicative amounts (per currency)");
      soft(!/300,000|350,000/.test(fin.answer), "the chat's final answer never adds SGD and USD together");
    }

    await restartApp("before deletion and page checks", [owner]);
    // ---------------- 7. deletion and post-deletion question
    await timed("delete AccidentGuard-M", async () => {
      await owner.goto("/policies");
      const p = (await policies(owner)).find((x) => x.id === ids["policy:accidentMarcus"]);
      const card = owner.locator(".document-card").filter({ hasText: p?.product_name ?? `${PREFIX}-AccidentGuard-M` }).first();
      await card.getByRole("button", { name: "Delete" }).click();
      await card.getByRole("button", { name: "Confirm delete" }).click();
      await expect(owner.getByTestId("library-notice")).toContainText(/Deleted .*no longer used in answers/, { timeout: 60_000 });
    });
    await newChat(owner);
    for (const q of V11_QUESTIONS.filter((x) => x.household === "A" && x.phase === "post")) await chatTurn(owner, "A", docs, "after deletion", q.id, q.text, composer(owner, q.text));

    // ---------------- 8b. Task 0: Benefits / Coverage / Documents pages, Usage page
    {
      const REPAIR = /re-?analy[sz]e|re-read all|confirm (?:this|the) (?:table )?heading|fix (?:a|this|the) row|confirm on the Benefits page/i;
      const found: string[] = [];
      for (const [label, url] of [["Benefits", "/schedule"], ["Coverage", "/ledger"], ["Documents", "/policies"]] as const) {
        await owner.goto(url); await owner.waitForTimeout(1500);
        await owner.screenshot({ path: path.join(OUT, `page-${label.toLowerCase()}.png`), fullPage: true });
        const text = await owner.locator("main").innerText().catch(() => "");
        const m = text.match(new RegExp(`.{0,60}(?:${REPAIR.source}).{0,60}`, "gi")) ?? [];
        for (const x of m.slice(0, 4)) found.push(`${label}: "${x.replace(/\s+/g, " ").trim()}"`);
      }
      task0.push({ id: "T0-6", pass: !found.length, detail: found.length ? found.join(" | ") : "no repair instructions on the Benefits, Coverage and Documents pages" });
      const nav = await owner.locator("nav").first().innerText().catch(() => "");
      await owner.goto("/usage"); await owner.waitForTimeout(2000);
      const usage = await owner.locator("main").innerText().catch(() => "");
      await owner.screenshot({ path: path.join(OUT, "page-usage.png"), fullPage: true });
      const stop = usage.match(/hard stop at \$([\d.]+)/i);
      const noCalls = /no model calls yet/i.test(usage);
      const inNav = /\bUsage\b/.test(nav);
      task0.push({ id: "T0-7", pass: !noCalls && !(stop && Math.abs(Number(stop[1]) - 5) > 0.001), detail: `Usage in household navigation: ${inNav ? "yes" : "no"}; page says "No model calls yet": ${noCalls}; hard stop shown: ${stop ? "$" + stop[1] : "none"} (owner's provider cap $5/month); page text: "${usage.replace(/\s+/g, " ").slice(0, 400)}"` });
    }

    await restartApp("before household B", [owner]);
    // ---------------- 9. household B and isolation
    await timed("household B", async () => {
      await adminCreateUser(ownerBEmail, ownerBPassword);
      const other = hardenNavigation(await (await browser.newContext()).newPage());
      await hideDevOverlay(other);
      await signInThroughUi(other, ownerBEmail, ownerBPassword);
      const hb = await api<{ activeHouseholdId: string; activeHouseholdName: string }>(other, "/api/household");
      ids.householdB = hb.body.activeHouseholdId; recordHousehold(ids.householdB); journey.householdB = ids.householdB;
      await other.goto("/family");
      const p = PEOPLE.josephineB;
      await other.locator("#fm-new-name").fill(p.fullName);
      await other.locator("#fm-new-relationship").selectOption(p.relationship);
      await other.locator("#fm-new-preferred").fill(p.preferred);
      await other.getByRole("button", { name: "+ Add person" }).click();
      await expect(other.locator(".profile-add-panel [role=status]")).toHaveText("Profile added.", { timeout: 60_000 });
      const famB = (await api<{ family: { id: string; display_name: string }[] }>(other, "/api/family")).body.family;
      journey["member:josephineB"] = famB[0]?.id;
      const d = docs.find((x) => x.key === "otherHouseholdAccident")!;
      const r = await uploadDoc(other, d, `${p.fullName} · ${p.relationship}`);
      soft(r.p?.processing_status === "ready", `household B upload ended ${r.p?.processing_status}`);
      (journey.uploads as unknown[]).push({ key: d.key, format: d.format, file: d.fileName, ms: r.ms, states: r.states, attempts: r.attempts, status: r.p?.processing_status, household: "B" });
      await newChat(other);
      for (const q of V11_QUESTIONS.filter((x) => x.household === "B")) await chatTurn(other, "B", docs, "household B", q.id, q.text, composer(other, q.text));
      // B cannot read A's documents or claims.
      for (const id of [ids["policy:accident"], ids["policy:hosp2025"]].filter(Boolean)) soft([403, 404].includes((await api(other, `/api/policies/${id}`)).status), `household B could read A's policy ${id}`);
      if (ids.fractureClaim) soft([401, 403, 404].includes((await api(other, `/api/claims/${ids.fractureClaim}`)).status), "household B could read A's claim");
      (globalThis as { __ownerB?: Page }).__ownerB = other;
    });

    // ---------------- write results (before household deletion so the transcript exists even if deletion fails)
    const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
    const group = (f: (t: Turn) => boolean) => { const xs = turns.filter(f).map((t) => t.ms); return { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: Math.max(0, ...xs) }; };
    const up = (journey.uploads as { ms: number; format: string }[]).map((u) => u.ms);
    const timings = { factual: group((t) => t.step === "factual question" || t.step === "after deletion" || t.step === "household B"), interview: group((t) => t.step === "claim interview"),
      allChat: group(() => true), uploadToTerminal: { n: up.length, p50: pct(up, 0.5), p95: pct(up, 0.95), max: Math.max(0, ...up) }, steps };
    journey.finished = new Date().toISOString();
    await writeFile(path.join(OUT, "timings.json"), JSON.stringify(timings, null, 2));
    await writeFile(path.join(OUT, "answers.json"), JSON.stringify({ source: "browser journey (e2e/tests/v11-journey.spec.ts)", prefix: PREFIX, deletedDocs: ["accidentMarcus"], supersededDocs: ["hosp2022"], answers }, null, 2));
    await writeFile(path.join(OUT, "task0-ui.json"), JSON.stringify(task0, null, 2));
    await writeFile(path.join(OUT, "journey.json"), JSON.stringify({ ...journey, ids: { householdA: ids.household, householdB: ids.householdB } , failures }, null, 2));
    const strip = (s: string) => s.replaceAll(`${PREFIX}-`, "").replace(/\n{3,}/g, "\n\n");
    const md = [`# DearPolicy — what the household saw (browser journey, ${PREFIX})`, "", "Synthetic data only. Product names shown without the test prefix.", "",
      ...turns.flatMap((t, i) => [`## ${i + 1}. ${t.step}${t.qid ? ` (${t.qid})` : ""}`, "", `**You:** ${strip(t.user)}`, "", "**DearPolicy:**", "", ...strip(t.answer).split("\n").map((l) => "> " + l), "",
        `Sources shown: ${t.citations.map((c) => `${strip(c.policyName)} p.${c.page}`).join("; ") || "none"} · ${(t.ms / 1000).toFixed(1)} s · screenshot ${path.basename(t.screenshot)}`, ""])].join("\n");
    await writeFile(path.join(OUT, "transcript.md"), md);

    // ---------------- 9b. delete both households through the Household page
    for (const [page, email, password] of [[owner, ownerEmail, ownerPassword], [(globalThis as { __ownerB?: Page }).__ownerB!, ownerBEmail, ownerBPassword]] as const) {
      if (!page) continue;
      await page.goto("/household");
      const hhName = String((await api(page, "/api/household")).body.activeHouseholdName);
      if (!hhName.toLowerCase().includes(PREFIX.toLowerCase())) { soft(false, `refusing to delete a non-synthetic household "${hhName}"`); continue; }
      await page.getByLabel("Household name").fill(hhName);
      await page.getByRole("button", { name: "Permanently delete household" }).click();
      // "Permanently delete household" lands on its own confirmation page (app/household/deleted).
      await page.waitForURL((u) => u.pathname === "/household/deleted", { timeout: 60_000 }).catch(() => soft(false, `household ${hhName} deletion did not reach its confirmation page (${email})`));
      void password;
    }
    await writeFile(path.join(OUT, "journey.json"), JSON.stringify({ ...journey, ids: { householdA: ids.household, householdB: ids.householdB }, failures }, null, 2));
    expect(failures, `\n${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`).toEqual([]);
  });
});
export type { EvalQuestion };

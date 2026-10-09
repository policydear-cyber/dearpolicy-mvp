/**
 * Live ingestion journey (scripts/ingest-live/run.ts starts the server and this spec): the REAL app, one fresh
 * synthetic account, a real browser. Everything the household does goes through the app's own pages:
 *   family page (members from HOUSEHOLD.json) -> policies page upload of every source PDF (no profile hint: names are
 *   linked automatically) -> processing watched through the page's own status polling (which drives the request
 *   drain) -> library -> chat questions (QUESTIONS.json), answering the chat's own follow-up questions from the fixture
 *   -> reopen the conversation from history and ask a follow-up -> delete one source on the policies page -> ask again.
 * No database writes. Writes <OUT>/screenshots/*.png, uploads.json, linking.json, transcript.json, journey.json.
 * PREFLIGHT (INGEST_LIVE_PREFLIGHT=1): every model request is refused by the server's guard (US$0); the journey stops
 * after the uploads have stopped moving and one chat turn has shown what the household sees.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { readHousehold, readQuestions, sourceFiles, type Question } from "../../scripts/ingest-live/fixture";

const OUT = path.resolve(process.env.INGEST_LIVE_OUT ?? "e2e-results/ingest-live");
const FIXTURE = path.resolve(process.env.INGEST_LIVE_FIXTURE ?? "scripts/ingest-live/fixture");
const PREFLIGHT = process.env.INGEST_LIVE_PREFLIGHT === "1";
const READY_MS = Number(process.env.INGEST_LIVE_READY_TIMEOUT_MS ?? (PREFLIGHT ? 150_000 : 900_000));
const THINK_MS = Number(process.env.INGEST_LIVE_THINK_MS ?? 240_000);
const SHOTS = path.join(OUT, "screenshots");
const failures: string[] = [];
const soft = (ok: unknown, m: string) => { if (!ok) failures.push(m); return !!ok; };
const write = (f: string, v: unknown) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(v, null, 2));
let shotN = 0;
async function shot(page: Page, name: string) { const f = `${String(++shotN).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: path.join(SHOTS, f), fullPage: true }); return `screenshots/${f}`; }

type Policy = { id: string; original_filename: string; product_name: string | null; processing_status: string; processing_stage?: string | null; processing_message?: string | null; processing_error?: string | null; processing_stalled?: boolean; quarantine_status: string; needs_review?: boolean; review_reason?: string | null; linked_people: { id: string; name: string }[]; detected_people: { name: string; matchedFamilyMemberId?: string | null }[] };
async function api<T = any>(page: Page, p: string): Promise<{ status: number; body: T }> {
  return page.evaluate(async (p) => { const r = await fetch(p, { cache: "no-store" }); const t = await r.text(); let b: unknown = t; try { b = JSON.parse(t); } catch { /* text */ } return { status: r.status, body: b as never }; }, p);
}
const policies = async (page: Page) => (await api<{ policies: Policy[] }>(page, "/api/policies")).body.policies ?? [];
/** The policies page with its document cards rendered (a screenshot right after navigation shows only the loading state). */
async function policiesPage(page: Page, cards: number) {
  await page.goto("/policies");
  if (cards > 0) await expect(page.locator(".document-card")).toHaveCount(cards, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

test("live ingestion journey", async ({ page }) => {
  test.setTimeout(Number(process.env.INGEST_LIVE_TEST_TIMEOUT_MS ?? 75 * 60_000));
  fs.mkdirSync(SHOTS, { recursive: true });
  const household = readHousehold(FIXTURE);
  const qs = readQuestions(FIXTURE);
  const journey: Record<string, unknown> = { preflight: PREFLIGHT, startedAt: new Date().toISOString(), steps: [] as unknown[] };
  const step = (name: string, extra: Record<string, unknown> = {}) => { (journey.steps as unknown[]).push({ name, at: new Date().toISOString(), ...extra }); write("journey.json", { ...journey, failures }); };

  // 1. Household members, through the Family page.
  const members: Record<string, string> = {};
  for (const m of household) {
    await page.goto("/family");
    const existing = (await api<{ family: { id: string; display_name: string; relationship: string }[] }>(page, "/api/family")).body.family ?? [];
    const found = existing.find((x) => x.display_name === m.displayName);
    if (found) { members[m.displayName] = found.id; continue; }
    await page.locator("#fm-new-name").fill(m.displayName);
    await page.locator("#fm-new-relationship").selectOption(m.relationship);
    if (m.dateOfBirth) await page.locator("#fm-new-dob").fill(m.dateOfBirth);
    if (m.preferredName) await page.locator("#fm-new-preferred").fill(m.preferredName);
    await page.getByRole("button", { name: "+ Add person" }).click();
    soft(await expect(page.locator(".profile-add-panel .upload-status")).toHaveText("Profile added.", { timeout: 60_000 }).then(() => true, () => false), `family: "${m.displayName}" not confirmed as added`);
    const after = (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family ?? [];
    const made = after.find((x) => x.display_name === m.displayName);
    if (soft(made, `family: "${m.displayName}" was not created through the Family page`)) members[m.displayName] = made!.id;
  }
  await shot(page, "family");
  write("members.json", members);
  step("household members added", { members: Object.keys(members).length });

  // 2. Uploads, through the Policies page, one at a time, no profile hint.
  const uploads: any[] = [];
  for (const [i, file] of sourceFiles(FIXTURE, qs.uploadOrder).entries()) {
    await page.goto("/policies");
    await page.locator("#up-profile").selectOption("").catch(() => undefined);
    await page.locator(".upload-form input[type=file]").setInputFiles(path.join(FIXTURE, "source", file));
    const t0 = Date.now();
    await page.getByRole("button", { name: "Upload & analyse" }).click();
    const received = await expect(page.locator(".upload-panel .upload-status")).toContainText(/received/i, { timeout: 120_000 }).then(() => true, () => false);
    soft(received, `upload ${file}: no "Upload received" confirmation`);
    const rec: any = { file, uploadedAt: new Date(t0).toISOString(), screenshots: [await shot(page, `upload-${i + 1}-received`)], states: [] as { at: number; state: string; message: string | null }[] };
    let p: Policy | undefined, processingShot = false;
    for (;;) {
      p = (await policies(page).catch(() => [] as Policy[])).find((x) => x.original_filename === file);
      if (p) {
        const s = `${p.quarantine_status}/${p.processing_status}${p.processing_stage ? ":" + p.processing_stage : ""}`;
        if (rec.states[rec.states.length - 1]?.state !== s) rec.states.push({ at: Date.now() - t0, state: s, message: p.processing_message ?? null });
        if (!processingShot && !["ready", "failed", "error"].includes(p.processing_status)) { await policiesPage(page, i + 1); rec.screenshots.push(await shot(page, `upload-${i + 1}-processing`)); processingShot = true; }
      }
      if (p && ["ready", "failed", "error"].includes(p.processing_status)) break;
      if (p && (p.quarantine_status === "scan_rejected" || p.processing_stalled)) break;
      if (Date.now() - t0 > READY_MS) break;
      await page.waitForTimeout(2500);
    }
    await policiesPage(page, i + 1);
    rec.screenshots.push(await shot(page, `upload-${i + 1}-final`));
    Object.assign(rec, { policyId: p?.id ?? null, productName: p?.product_name ?? null, finalStatus: p ? `${p.quarantine_status}/${p.processing_status}` : "missing", msToFinal: Date.now() - t0,
      ready: p?.processing_status === "ready", error: p?.processing_error ?? null, message: p?.processing_message ?? null, needsReview: !!p?.needs_review, reviewReason: p?.review_reason ?? null,
      linked: p?.linked_people.map((l) => l.name) ?? [], detected: p?.detected_people ?? [] });
    if (!PREFLIGHT) soft(rec.ready, `upload ${file}: not ready after ${Math.round(rec.msToFinal / 1000)} s (${rec.states.map((s: any) => s.state).join(" -> ")})${rec.error ? "; " + rec.error : ""}`);
    uploads.push(rec);
    write("uploads.json", uploads);
  }
  step("uploads finished", { ready: uploads.filter((u) => u.ready).length, of: uploads.length });

  // 3. The library, and who each document was linked to automatically.
  await policiesPage(page, uploads.length);
  await shot(page, "library");
  const lib = await policies(page);
  write("linking.json", lib.map((p) => ({ file: p.original_filename, policyId: p.id, product: p.product_name, linked: p.linked_people.map((l) => l.name), detected: p.detected_people.map((d) => ({ name: d.name, matched: d.matchedFamilyMemberId ? Object.entries(members).find(([, id]) => id === d.matchedFamilyMemberId)?.[0] ?? "(another id)" : null })), needsReview: !!p.needs_review, reviewReason: p.review_reason ?? null })));

  // The harness dumps the database (read only) now, after processing and before any question.
  fs.writeFileSync(path.join(OUT, ".processing-done"), new Date().toISOString());
  for (const until = Date.now() + 120_000; Date.now() < until && !fs.existsSync(path.join(OUT, ".dump-done"));) await page.waitForTimeout(1000);
  soft(fs.existsSync(path.join(OUT, ".dump-done")), "the harness did not dump the database after processing");

  // 4. Conversation.
  const transcript: any[] = [];
  const answers = () => page.locator(".chat-window > .message.assistant:not(:has(.thinking))");
  async function pendingQuestion() { const q = answers().last().locator(".fact-question > strong").first(); return (await q.count()) ? (await q.innerText()).trim() : null; }
  async function turn(q: Question, phase: string, user: string, via: string, act: () => Promise<void>) {
    const before = await answers().count();
    const errSel = ".message-inline-error, .chat-window > .alert.error";
    const errBefore = await page.locator(errSel).count();
    const t0 = Date.now();
    await act();
    let stuck = false, error: string | null = null;
    for (;;) {
      const thinking = await page.locator(".message-body.thinking").count();
      if ((await page.locator(errSel).count()) > errBefore && !thinking) { error = (await page.locator(errSel).last().innerText()).trim(); break; }
      if ((await answers().count()) > before && !thinking) break;
      if (Date.now() - t0 > THINK_MS) { stuck = true; break; }
      await page.waitForTimeout(500);
    }
    const a = answers().last();
    const answer = (await answers().count()) > before ? (await a.innerText()).trim() : "";
    const citations = (await a.locator(".citations .citation").allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, " ").trim());
    const t: any = { id: q.id, phase, user, via, answer, error, stuck, citationsShown: citations, pendingQuestion: error || stuck ? null : await pendingQuestion(), ms: Date.now() - t0, at: new Date(t0).toISOString(), screenshot: await shot(page, `chat-${q.id}-${transcript.filter((x) => x.id === q.id).length + 1}`) };
    transcript.push(t);
    write("transcript.json", transcript);
    if (!PREFLIGHT) { soft(!stuck, `${q.id} "${user}": still thinking after ${THINK_MS / 1000} s`); soft(!error, `${q.id} "${user}": error shown: ${error}`); }
    return t;
  }
  async function ask(q: Question, phase: string) {
    let t = await turn(q, phase, q.text, "composer", async () => { await page.getByLabel("Message to DearPolicy").fill(q.text); await page.getByRole("button", { name: /send/i }).click(); });
    // The chat's own follow-up questions (a person to choose, a fact to give), answered from the fixture.
    for (let n = 0; n < 4 && t.pendingQuestion && !t.error && !t.stuck; n++) {
      const rule = q.answers.find((r) => r.when.test(t.pendingQuestion!));
      if (!rule) { t.unansweredFollowUp = true; write("transcript.json", transcript); break; }
      const last = answers().last();
      const buttons = last.locator(".quick-replies button:enabled");
      const options = (await buttons.allTextContents()).map((s) => s.trim());
      const pick = options.find((o) => o.toLowerCase() === rule.reply.toLowerCase()) ?? options.find((o) => rule.reply.toLowerCase().includes(o.toLowerCase()) && o.length > 2);
      const inline = last.locator("input[aria-label='Your answer']");
      if (pick) t = await turn(q, phase, pick, `button (asked: ${t.pendingQuestion})`, () => buttons.filter({ hasText: pick }).first().click());
      else if (await inline.count()) t = await turn(q, phase, rule.reply, `inline answer (asked: ${t.pendingQuestion})`, async () => { await inline.fill(rule.reply); await inline.press("Enter"); });
      else t = await turn(q, phase, rule.reply, `composer (asked: ${t.pendingQuestion})`, async () => { await page.getByLabel("Message to DearPolicy").fill(rule.reply); await page.getByRole("button", { name: /send/i }).click(); });
    }
  }
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
  for (const q of PREFLIGHT ? qs.conversation.slice(0, 1) : qs.conversation) await ask(q, "conversation");
  step("conversation asked", { turns: transcript.length });

  if (!PREFLIGHT) {
    // 5. Reopen the saved conversation from history and ask a follow-up.
    await page.goto("/chat");
    await page.locator("details.chat-history > summary").click();
    await expect(page.locator(".history-open").first()).toBeVisible({ timeout: 30_000 });
    const opened = (await page.locator(".history-open").first().innerText()).trim();
    await page.locator(".history-open").first().click();
    await expect(answers().first()).toBeVisible({ timeout: 60_000 });
    await shot(page, "reopened");
    soft((await answers().count()) >= qs.conversation.length, `reopened conversation shows ${await answers().count()} answers`);
    for (const q of qs.reopen) await ask(q, "reopen");
    step("reopened and followed up", { opened });

    // 6. Delete one source on the Policies page, then ask again.
    if (qs.deleteSource) {
      const target = (await policies(page)).find((p) => p.original_filename === qs.deleteSource);
      if (soft(target, `delete: ${qs.deleteSource} is not in the library`)) {
        await policiesPage(page, uploads.length);
        const card = page.locator(".document-card").filter({ hasText: target!.product_name ?? target!.original_filename }).first();
        await card.getByRole("button", { name: "Delete" }).click();
        await card.getByRole("button", { name: "Confirm delete" }).click();
        soft(await expect(page.locator(".upload-panel .upload-status")).toContainText("was deleted", { timeout: 60_000 }).then(() => true, () => false), `delete ${qs.deleteSource}: no "was deleted" confirmation`);
        soft(!(await policies(page)).some((p) => p.id === target!.id), `delete ${qs.deleteSource}: still listed`);
        await policiesPage(page, uploads.length - 1);
        await shot(page, "after-delete-library");
        write("deleted.json", { file: qs.deleteSource, policyId: target!.id, at: new Date().toISOString() });
        await page.goto("/chat");
        if (!qs.afterDeleteSameConversation) await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
        else { await page.locator("details.chat-history > summary").click(); await page.locator(".history-open").first().click(); await expect(answers().first()).toBeVisible({ timeout: 60_000 }); }
        for (const q of qs.afterDelete) await ask(q, "after_delete");
        step("deleted a source and asked again", { file: qs.deleteSource });
      }
    }
  }
  journey.finishedAt = new Date().toISOString();
  write("journey.json", { ...journey, failures });
  expect(failures, failures.join("\n")).toEqual([]);
});

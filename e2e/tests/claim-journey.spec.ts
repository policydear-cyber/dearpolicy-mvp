/**
 * Synthetic browser claim journey (Phase 6). Real Chromium, real Next.js,
 * real PostgreSQL; the only stand-in is the deterministic model
 * (lib/ai/deterministic-model.ts), which cannot run in production.
 * Synthetic data only -- see e2e/support/seed-claim-fixture.ts.
 *
 * Covered here: a factual policy question is answered with the policy's own
 * cited page; every claim category enters fact-finding with no amount;
 * "how much can I claim?" gives no estimate, any policy-stated limit carries
 * the approved label and notice and is never totalled; evidence is uploaded
 * through the Claims page, scanned, read and reviewed through the reviewer
 * UI, and only then does an indicative estimate appear -- per currency, with
 * the wording cited, never for a cover whose currency the certificate does
 * not write, never after a negative decision, never from a flagged file;
 * deleting the policy an answer relied on invalidates the saved answer; the
 * answer is not readable from another household.
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PREFIX, SYNTHETIC_MALWARE_MARKER } from "../support/synthetic";

const BASE_B = process.env.E2E_BASE_URL_B ?? "http://localhost:3001";
const FORBIDDEN = /potential payout|potential reimbursement|claimable amount|expected payout|estimated settlement|amount you will receive|approved amount|estimated claim amount/i;
const LIMIT_LABEL = "Policy-stated coverage limit";
const LIMIT_NOTICE = "This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.";

const INDICATIVE_NOTICE = "Indicative estimate based on the policies, facts and reviewed evidence currently on file. The insurer determines eligibility and the final amount after assessment.";
const MONEY = /(?:S\$|US\$|SGD|USD)\s?\d/;
type Seed = { household: string; claimant: string; patient: string; patientName: string; policyIds: Record<"sgd" | "usd" | "unstated", string> };
const seed = (): Seed => JSON.parse(readFileSync(path.resolve(".e2e-seed.json"), "utf8"));
const STATE = path.resolve(".e2e-state.json");

async function api<T = unknown>(page: Page, url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ url, init }) => {
    const headers: Record<string, string> = { ...(init?.headers ?? {}) };
    if (init?.body) headers["content-type"] = "application/json";
    const res = await fetch(url, { method: init?.method ?? "GET", headers, body: init?.body ? JSON.stringify(init.body) : undefined, cache: "no-store" });
    const text = await res.text(); let body: unknown = text; try { body = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, body: body as never };
  }, { url, init });
}

/** While a fact is still needed the open question is the turn and the full assessment sits behind "Show full
 * assessment" (app/chat/page.tsx): the question must be shown, then the assessment is opened to read it. */
async function openAssessment(answer: import("@playwright/test").Locator) {
  const collapsed = answer.getByTestId("assessment-details");
  if (!(await collapsed.count())) return;
  await expect(answer.locator(".fact-question").first()).toBeVisible();
  await collapsed.locator("summary").click();
}

/** Sends one message through the chat UI and returns the new answer bubble. */
async function ask(page: Page, text: string) {
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  const before = await answers.count();
  await page.getByLabel("Message to DearPolicy").fill(text);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  return answers.nth(before);
}

/** A synthetic specialist memo whose page carries its own synthetic
 * extraction for the deterministic reader (never a real document). */
async function syntheticMemo(patientName: string, extraLines: string[] = []): Promise<Buffer> {
  const DIAGNOSIS = "Malignant neoplasm of the colon, stage III";
  const payload = {
    deceasedName: null, otherNamesMentioned: [], personIdentifiers: [{ label: "Hospital case number", value: `${PREFIX}-CASE-0001` }], dateOfDeath: null, statedCauseOfDeath: null, mannerOfDeath: null,
    patientName, exactDiagnosis: DIAGNOSIS, diagnosisDate: "2026-06-01", diseaseStage: "Stage III",
    issuingAuthority: "Synthetic Test Hospital", documentReference: `${PREFIX}-MEMO`, documentType: "specialist_memo",
    pageCitations: [{ field: "exactDiagnosis", pageStart: 1, pageEnd: 1, excerpt: DIAGNOSIS }], confidence: {},
  };
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const lines = [`Specialist memo. SYNTHETIC TEST DOCUMENT. Patient: ${patientName}.`, `Hospital case number ${PREFIX}-CASE-0001.`, `Diagnosis: ${DIAGNOSIS}. Date of diagnosis 2026-06-01.`, ...extraLines];
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 790 - i * 20, size: 10, font }));
  // The synthetic extraction, wrapped so every line fits on the page (a PDF
  // text layer keeps only what is drawn), ending in the end marker.
  const encoded = `DPTEST-EXTRACTION:${Buffer.from(JSON.stringify(payload)).toString("base64")}:DPTEST-END`;
  (encoded.match(/.{1,110}/g) ?? []).forEach((chunk, i) => page.drawText(chunk, { x: 20, y: 700 - i * 9, size: 7, font }));
  const bytes = Buffer.from(await doc.save());
  const markers = extraLines.filter((l) => l === SYNTHETIC_MALWARE_MARKER);
  return markers.length ? Buffer.concat([bytes, Buffer.from(markers.map((m) => `\n%${m}\n`).join(""), "latin1")]) : bytes;
}

function reviewerAdmin(args: string[]) {
  return execFileSync("node", ["--import", "tsx", "scripts/claim-reviewer-admin.ts", ...args], { encoding: "utf8", env: process.env });
}

test.describe.serial("synthetic claim journey", () => {
  let page: Page;
  let conversationId = "";

  test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); });

  test("2-5. \"How much can I claim?\" starts fact-finding with no estimate; a policy-stated limit is labelled and never totalled", async () => {
    await page.goto("/chat");
    await page.getByLabel("Message to DearPolicy").fill(`${PREFIX}-Claimant here. I was diagnosed with stage 2 breast cancer. How much can I claim?`);
    await page.getByRole("button", { name: /send/i }).click();
    // While a fact is still needed, the open question is the turn: it is shown first, and the full assessment
    // (fact-finding plan, preliminary notice) sits behind "Show full assessment" (app/chat/page.tsx).
    const answer = page.locator(".fact-question, .preliminary-assessment, .fact-finding").first();
    await expect(answer).toBeVisible({ timeout: 180_000 });
    const collapsed = page.getByTestId("assessment-details").last();
    if (await collapsed.count()) {
      await expect(page.locator(".fact-question").last()).toBeVisible();
      await collapsed.locator("summary").click();
    }
    // The claim interview asks its facts one at a time first (here: the diagnosis date). A preliminary assessment --
    // and its notice -- appears only once there are claim cards; a card never appears without the notice.
    const cards = await page.locator(".claim-result").count();
    if (cards) await expect(page.getByTestId("preliminary-assessment")).toBeVisible();
    else await expect(page.locator(".fact-question").last()).toBeVisible();
    await expect(page.getByTestId("fact-finding")).toBeVisible();
    await expect(page.getByTestId("fact-finding")).toContainText(/Critical illness/i);
    await expect(page.getByTestId("fact-finding")).toContainText(/Specialist's diagnosis report/i);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(FORBIDDEN);
    // No claim card and no total carries a figure before reviewed evidence.
    for (const text of await page.locator(".claim-item, .claim-card, .claim-result").allInnerTexts()) expect(text).not.toMatch(/S\$\s?\d|SGD\s?\d/);
    expect(await page.locator(".potential-totals, [data-testid=potential-totals]").count()).toBe(0);
    const limits = page.getByTestId("policy-stated-limits");
    if (await limits.count()) {
      await expect(limits).toContainText(LIMIT_LABEL);
      await expect(limits).toContainText(LIMIT_NOTICE);
    }
    const history = await api<{ conversations: { id: string }[] }>(page, "/api/chat/history?scope=all");
    conversationId = history.body.conversations?.[0]?.id ?? "";
    expect(conversationId).not.toBe("");
  });

  test("9. reopening the saved answer re-serves it through the boundary", async () => {
    type Saved = { claimItems?: { amountText: string | null }[]; potentialPayoutTotals?: unknown[]; summary?: string; answer?: Saved };
    const saved = await api<{ messages: { answer_json?: Saved | null }[] }>(page, `/api/chat/history/${conversationId}`);
    expect(saved.status).toBe(200);
    let checked = 0;
    for (const m of saved.body.messages ?? []) {
      const a = m.answer_json?.answer ?? m.answer_json;
      if (!a?.claimItems) continue;
      checked++;
      expect(a.claimItems.every((i) => i.amountText === null)).toBe(true);
      expect(a.potentialPayoutTotals ?? []).toEqual([]);
      expect(a.summary ?? "").not.toMatch(FORBIDDEN);
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("13. another household cannot read this answer", async ({ browser }) => {
    const other = await (await browser.newContext({ baseURL: BASE_B })).newPage();
    await other.goto(`${BASE_B}/chat`);
    const res = await api(other, `/api/chat/history/${conversationId}`);
    expect([403, 404]).toContain(res.status);
    await other.context().close();
  });

  test("1. a factual policy question is answered from the policy's own cited page", async () => {
    const { patientName } = seed();
    await page.goto("/chat");
    await page.getByRole("button", { name: "New chat" }).click();
    const answer = await ask(page, `${patientName}: what is the waiting period for critical illness on the Living Care plan?`);
    await expect(answer).toContainText("90 days");
    // A factual answer may state a printed figure (V1.1: with its page and whether it is confirmed current), never an
    // estimate. Each money figure must sit on a line that cites its page, in the currency its document writes:
    // S$200,000 (SGD schedule) and US$100,000 (USD schedule) only; the schedule that writes no currency ("50,000") is
    // never shown as an amount, and nothing is totalled.
    const text1 = await answer.innerText();
    for (const l of text1.split("\n").filter((x) => MONEY.test(x))) {
      expect(l, "a money figure cites its page").toMatch(/\(page \d+/);
      expect(l, "only the amounts the documents print with their currency").toMatch(/S\$200,000|US\$100,000/);
    }
    expect(text1).not.toMatch(/(?<![$\d,])50,000\b/);
    expect(text1).not.toMatch(/\b(?:300|250|150),000\b|total/i);
    const citations = answer.locator("details.citations");
    await expect(citations).toContainText("Living Care");
    await expect(citations).toContainText("Page 5");
    expect(await answer.innerText()).not.toMatch(FORBIDDEN);
    const history = await api<{ conversations: { id: string; title: string }[] }>(page, "/api/chat/history?scope=all");
    const factual = history.body.conversations.find((c) => /waiting period/i.test(c.title))?.id ?? history.body.conversations[0]?.id;
    writeFileSync(STATE, JSON.stringify({ factualConversationId: factual, claimConversationId: conversationId }));
  });

  test("6. every claim category enters fact-finding through the UI, with no amount", async () => {
    const claimant = `${PREFIX}-Claimant`;
    // Each is a separate event, so each starts its own chat (a follow-up in the
    // same chat is, correctly, treated as more facts about the same event).
    const cases: [string, RegExp[]][] = [
      // The claimant's only cover is the critical-illness plan: no hospital-cash plan is opened for a benefit they do
      // not have (lib/chat/fact-finding-chat.ts), so that is checked too (below).
      [`${claimant} was admitted to hospital on 2026-08-02. What can be claimed?`, [/Medical reimbursement/i]],
      [`${claimant}'s flight was delayed 9 hours on the trip. Can we claim?`, [/Travel/i]],
      [`${claimant} is unable to work since 2026-07-01 after an injury. What can be claimed?`, [/Disability/i]],
      // The death plan is labelled "Death" (any cause; the accidental-death definition is a reviewer check).
      [`${PREFIX}-Relative died in a road accident on 2026-09-01. What can we claim?`, [/· Death\b/, /Death certificate/]],
      [`${claimant} was diagnosed with stage 2 breast cancer on 2026-06-01. How much can I claim?`, [/Critical illness/i]],
    ];
    for (const [message, categories] of cases) {
      await page.goto("/chat");
      await page.getByRole("button", { name: "New chat" }).click();
      const answer = await ask(page, message);
      await openAssessment(answer);
      const plan = answer.getByTestId("fact-finding");
      // On failure, show what the assistant actually said (synthetic data only).
      await expect(plan, `${message}\n--- answer ---\n${(await answer.innerText()).slice(0, 1500)}`).toBeVisible();
      for (const category of categories) await expect(plan, message).toContainText(category);
      if (/admitted to hospital/.test(message)) await expect(plan, message).not.toContainText(/Hospital cash/i);
      await expect(plan).toContainText(/Information needed|Evidence needed|Reviewer assessment needed/);
      const text = await answer.innerText();
      expect(text, message).not.toMatch(FORBIDDEN);
      expect(text, message).not.toMatch(/\b(?:figures?|amounts?)\b[^.]{0,20}\bestimate\b/i);
      for (const card of await answer.locator(".claim-item, .claim-card, .claim-result").allInnerTexts()) expect(card).not.toMatch(MONEY);
      expect(await answer.getByTestId("indicative-estimate").count()).toBe(0);
    }
  });

  test("7-12, 14. evidence -> scan -> reading -> reviewer UI -> indicative estimate: cited, per currency, never for an unstated currency, a negative decision or a flagged file", async ({ browser }) => {
    const s = seed();
    // The claim is recorded from the chat, which itself shows no estimate.
    await page.goto("/chat");
    await page.getByRole("button", { name: "New chat" }).click();
    const answer = await ask(page, `${s.patientName} was diagnosed with Malignant neoplasm of the colon on 2026-06-01. How much can we claim?`);
    expect(await answer.innerText()).not.toMatch(MONEY);
    const history = await api<{ conversations: { id: string }[] }>(page, "/api/chat/history?scope=all");
    let claimId = "";
    for (const c of history.body.conversations) {
      const msgs = await api<{ messages: { answer_json?: { claimSessionId?: string } | null }[] }>(page, `/api/chat/history/${c.id}`);
      claimId = msgs.body.messages.map((m) => m.answer_json?.claimSessionId ?? "").filter(Boolean).at(-1) ?? "";
      if (claimId) { const facts = await api<{ claim: { family_member_id: string } }>(page, `/api/claims/${claimId}`); if (facts.body.claim?.family_member_id === s.patient) break; claimId = ""; }
    }
    expect(claimId, "the chat recorded the claim").not.toBe("");

    // Before any evidence: no estimate.
    await page.goto(`/claims/${claimId}`);
    const panel = page.getByTestId("indicative-estimate");
    await expect(panel).toHaveAttribute("data-has-estimate", "no");
    await expect(page.getByTestId("indicative-estimate-notice")).toHaveText(INDICATIVE_NOTICE);

    // Upload the synthetic memo, and a synthetic flagged file, through the Claims page.
    const upload = async (name: string, bytes: Buffer) => {
      await page.locator("select").first().selectOption("specialist_memo");
      await page.locator("input[type=file]").setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
      await page.getByRole("button", { name: /^upload$/i }).click();
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 60_000 });
    };
    await upload(`${PREFIX}-memo.pdf`, await syntheticMemo(s.patientName));
    await upload(`${PREFIX}-flagged-memo.pdf`, await syntheticMemo(s.patientName, [SYNTHETIC_MALWARE_MARKER]));
    type Doc = { id: string; original_filename: string; status: string };
    const docs = async () => (await api<{ documents: Doc[] }>(page, `/api/claims/evidence?familyMemberId=${s.patient}&claimSessionId=${claimId}`)).body.documents ?? [];
    let memo: Doc | undefined, flagged: Doc | undefined;
    for (let i = 0; i < 180; i++) {
      const all = await docs();
      memo = all.find((d) => d.original_filename === `${PREFIX}-memo.pdf`);
      flagged = all.find((d) => d.original_filename === `${PREFIX}-flagged-memo.pdf`);
      if (memo?.status === "needs_review" && flagged?.status === "rejected") break;
      await page.waitForTimeout(1000);
    }
    expect(memo?.status, "the memo was scanned clean, read with verified provenance and awaits review").toBe("needs_review");
    expect(flagged?.status, "the flagged file is rejected at the scan and never read").toBe("rejected");
    await page.reload();
    await expect(page.getByTestId("indicative-estimate")).toHaveAttribute("data-has-estimate", "no");

    // An operator assigns the claim to a provisioned reviewer (user B, who is not in household A).
    try { reviewerAdmin(["provision", "--user", process.env.E2E_USER_B!, "--label", `${PREFIX}-Reviewer`, "--operator", "e2e"]); } catch { /* already provisioned */ }
    reviewerAdmin(["assign", "--reviewer", process.env.E2E_USER_B!, "--household", s.household, "--claim", claimId, "--hours", "2", "--operator", "e2e"]);

    const reviewer = await (await browser.newContext({ baseURL: BASE_B })).newPage();
    await reviewer.goto(`${BASE_B}/reviewer`);
    await reviewer.getByRole("link").filter({ hasText: s.patientName }).first().click();
    // The assignment page may compile on first use (next dev); wait for the navigation itself.
    await reviewer.waitForURL(/\/reviewer\/assignments\//, { timeout: 180_000 });
    await reviewer.waitForLoadState("networkidle").catch(() => undefined);
    // On failure, show what the reviewer actually sees (synthetic data only).
    const reviewerView = async () => `${reviewer.url()}\n${(await reviewer.locator("main").innerText().catch(() => "")).slice(0, 2500)}`;
    await expect(reviewer.getByText(`${PREFIX}-memo.pdf`), await reviewerView()).toBeVisible();
    const card = reviewer.locator(".action-card").filter({ hasText: `${PREFIX}-memo.pdf` });
    await expect(card).toContainText("reading provenance verified");
    const decide = async (policyNumber: string, choice: RegExp) => {
      const option = await card.locator("select option").filter({ hasText: policyNumber }).getAttribute("value");
      await card.locator("select").selectOption(option!);
      await card.getByLabel(choice).check();
      await card.locator("textarea").fill("Synthetic review against the cited definition.");
      await card.getByRole("button", { name: "Record decision" }).click();
      // Saved: the form finishes "Recording…", shows no error, and resets
      // (a failed save keeps the reason and shows an alert instead).
      await expect(card.getByRole("button", { name: "Record decision" })).toBeVisible({ timeout: 30_000 });
      await expect(card.getByRole("alert"), `${policyNumber}: ${(await card.getByRole("alert").allInnerTexts()).join(" | ")}`).toHaveCount(0);
      await expect(card.locator("textarea")).toHaveValue("");
    };

    // A negative decision never produces an amount.
    await decide(`${PREFIX}-LC-SGD`, /Does not match/);
    await page.reload();
    await expect(page.getByTestId("indicative-estimate")).toHaveAttribute("data-has-estimate", "no");
    expect(await page.getByTestId("indicative-estimate").innerText()).not.toMatch(MONEY);

    // Matches on all three covers: SGD and USD are estimated separately; the
    // cover whose certificate writes no currency never gets an amount.
    await decide(`${PREFIX}-LC-SGD`, /^Matches/);
    await decide(`${PREFIX}-LC-USD`, /^Matches/);
    await decide(`${PREFIX}-LC-NOCCY`, /^Matches/);
    await reviewer.context().close();

    await page.reload();
    const estimate = page.getByTestId("indicative-estimate");
    await expect(estimate).toHaveAttribute("data-has-estimate", "yes", { timeout: 30_000 });
    await expect(page.getByTestId("indicative-estimate-notice")).toHaveText(INDICATIVE_NOTICE);
    const sgd = estimate.locator('[data-testid=indicative-benefit][data-currency="SGD"]');
    const usd = estimate.locator('[data-testid=indicative-benefit][data-currency="USD"]');
    await expect(sgd).toHaveCount(1); await expect(usd).toHaveCount(1);
    await expect(sgd).toContainText("200,000"); await expect(sgd).toContainText("page 4");
    await expect(usd).toContainText("100,000"); await expect(usd).toContainText("page 4");
    const noAmount = estimate.locator('[data-testid=indicative-benefit][data-status="no_amount"]');
    expect(await noAmount.count()).toBeGreaterThanOrEqual(1);
    for (const row of await noAmount.allInnerTexts()) { expect(row).not.toMatch(/50,000/); expect(row).not.toMatch(MONEY); }
    await expect(estimate.locator('[data-testid=indicative-benefit][data-status="included"]')).toHaveCount(2);
    const totals = estimate.getByTestId("indicative-total");
    await expect(totals).toHaveCount(2);
    expect((await totals.allInnerTexts()).join(" ")).not.toMatch(/300,000|350,000/);
    await expect(estimate.locator('[data-testid=indicative-total][data-currency="SGD"]')).toContainText("200,000");
    await expect(estimate.locator('[data-testid=indicative-total][data-currency="USD"]')).toContainText("100,000");
    const state = JSON.parse(readFileSync(STATE, "utf8"));
    writeFileSync(STATE, JSON.stringify({ ...state, claimId }));
  });

  test("15. deleting the policy an answer relied on invalidates the saved answer and removes it from the estimate", async () => {
    const s = seed();
    const state = JSON.parse(readFileSync(STATE, "utf8")) as { factualConversationId: string; claimId: string };
    const before = await api<{ messages: { answer_json?: { citations?: { policyId: string }[]; invalidated?: unknown } | null }[] }>(page, `/api/chat/history/${state.factualConversationId}`);
    expect(before.body.messages.some((m) => m.answer_json?.citations?.some((c) => c.policyId === s.policyIds.sgd)), "the factual answer cited the SGD policy").toBe(true);
    const removed = await api(page, `/api/policies/${s.policyIds.sgd}`, { method: "DELETE" });
    expect([200, 202, 204]).toContain(removed.status);
    for (let i = 0; i < 60; i++) {
      const listed = await api<{ policies: { id: string }[] }>(page, "/api/policies");
      if (!listed.body.policies.some((p) => p.id === s.policyIds.sgd)) break;
      await page.waitForTimeout(1000);
    }
    const after = await api<{ messages: { answer_json?: { citations?: unknown[]; invalidated?: unknown; summary?: string } | null }[] }>(page, `/api/chat/history/${state.factualConversationId}`);
    const answers = after.body.messages.map((m) => m.answer_json).filter(Boolean);
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) { expect(a!.invalidated).toBeTruthy(); expect(a!.citations ?? []).toEqual([]); expect(a!.summary ?? "").not.toMatch(/90 days/); }
    // Reopened in the UI, the answer says it is out of date and cites nothing.
    await page.goto("/chat");
    await page.locator("details.chat-history summary").click();
    await page.locator("button.history-open").filter({ hasText: /waiting period/i }).first().click();
    await expect(page.getByTestId("answer-invalidated").first()).toBeVisible();
    await expect(page.locator(".message.assistant details.citations")).toHaveCount(0);
    // The estimate no longer counts the deleted cover.
    await page.goto(`/claims/${state.claimId}`);
    const estimate = page.getByTestId("indicative-estimate");
    await expect(estimate.locator('[data-testid=indicative-benefit][data-currency="SGD"]')).toHaveCount(0);
    await expect(estimate.locator('[data-testid=indicative-total][data-currency="SGD"]')).toHaveCount(0);
  });
});

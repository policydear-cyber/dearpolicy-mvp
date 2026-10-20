/**
 * Owner/reviewer browser journey with REAL session handling.
 *
 * Unlike e2e/tests/* (which use the development identity), this suite runs
 * the app with no development identity at all: every request is
 * authenticated by the app's own Supabase Auth code (@supabase/ssr in
 * middleware.ts and lib/supabase/server.ts, the /api/auth/* routes)
 * talking to the test-only Auth/Admin stand-in e2e/support/fake-auth.mjs,
 * which cannot start in production. Real Chromium, real Next.js, real
 * PostgreSQL, the real job worker, the real VirusTotal adapter against a
 * local fake, and the deterministic model stand-in. Synthetic data only.
 *
 * One household owner signs up and confirms by email; a second owner and a
 * DearPolicy reviewer are created by the operator procedure (Auth Admin
 * API + scripts/claim-reviewer-admin.ts). Every numbered step below maps to
 * the owner/reviewer journey requirements; see e2e/README.md.
 */
import { test, expect, type Page, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { PREFIX, name, syntheticWordingPdf, SYNTHETIC_MALWARE_MARKER, SYNTHETIC_PENDING_MARKER, SYNTHETIC_PROVIDER_ERROR_MARKER } from "../support/synthetic";
import {
  api, emailFor, newPassword, recordHousehold, hardenNavigation, outboxLink, authUserId, expireSessions, adminCreateUser, fakeAuthStats,
  signUpThroughUi, signInThroughUi, signOutThroughUi, syntheticMemo, unreadablePdf, operator, reviewerAdmin,
  FORBIDDEN, MONEY, INDICATIVE_NOTICE, FAKE_SERVICES,
} from "../support/journey";

type Policy = { id: string; original_filename: string; product_name: string | null; processing_status: string; quarantine_status: string; scan_result_detail: string | null; processing_error: string | null; linked_people: { id: string; name: string }[] };
type Seed = { household: string; patient: string; patientName: string; policyIds: Record<"sgd" | "usd" | "unstated", string> };

const SEED_FILE = path.resolve(".e2e-auth-seed.json");
const seed = (): Seed => JSON.parse(readFileSync(SEED_FILE, "utf8"));

async function db<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
async function policies(page: Page): Promise<Policy[]> { return (await api<{ policies: Policy[] }>(page, "/api/policies")).body.policies ?? []; }
async function waitForPolicy(page: Page, file: string, done: (p: Policy) => boolean, timeoutMs = 240_000): Promise<Policy> {
  const started = Date.now();
  const seen = new Set<string>();
  for (;;) {
    const p = (await policies(page)).find((x) => x.original_filename === file);
    if (p) seen.add(`${p.quarantine_status}/${p.processing_status}`);
    if (p && done(p)) return p;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${file}; states seen: ${[...seen].join(" -> ")}`);
    await page.waitForTimeout(1500);
  }
}
const card = (page: Page, p: Policy) => page.locator(".document-card").filter({ hasText: p.product_name ?? p.original_filename });

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

test.describe.serial("owner and reviewer journey with real sessions", () => {
  test.setTimeout(480_000);
  let owner: Page;
  const ownerEmail = emailFor("owner");
  const ownerPassword = newPassword();
  const household = name("Owner-Household");
  const self = name("Owner");
  const child = name("Child");
  const files = {
    clean: `${name("wording-clean")}.pdf`, flagged: `${name("wording-flagged")}.pdf`, delayed: `${name("wording-delayed")}.pdf`,
    failedScan: `${name("wording-scan-error")}.pdf`, unreadable: `${name("unreadable")}.pdf`,
  };
  const ids: Record<string, string> = {};
  const reviewerEmail = emailFor("reviewer");
  const reviewerPassword = newPassword();
  const ownerBEmail = emailFor("owner-b");
  const ownerBPassword = newPassword();

  test.beforeAll(async ({ browser }) => { owner = hardenNavigation(await (await browser.newContext()).newPage()); });

  test("1. sign-up form validation: the form and the server both refuse bad input", async () => {
    await owner.goto("/signup");
    const submit = owner.getByRole("button", { name: "Create household" });
    await expect(submit).toBeDisabled();
    await owner.getByLabel("Email").fill(ownerEmail);
    await owner.getByLabel("Password").fill("short");
    await expect(submit, "a password under 8 characters keeps the button disabled").toBeDisabled();
    await owner.getByLabel("Email").fill("not-an-email");
    await owner.getByLabel("Password").fill(ownerPassword);
    let posted = false;
    owner.on("request", (r) => { if (r.url().endsWith("/api/auth/signup")) posted = true; });
    await submit.click();
    expect(await owner.getByLabel("Email").evaluate((el) => (el as HTMLInputElement).validity.typeMismatch), "the browser flags the malformed email").toBe(true);
    await owner.waitForTimeout(500);
    expect(posted, "a malformed email never reaches the server").toBe(false);
    // The server enforces the same rules for anything that bypasses the form.
    const badEmail = await api(owner, "/api/auth/signup", { method: "POST", body: { email: "not-an-email", password: ownerPassword } });
    expect(badEmail.status).toBe(400);
    const shortPassword = await api(owner, "/api/auth/signup", { method: "POST", body: { email: ownerEmail, password: "short" } });
    expect(shortPassword.status).toBe(400);
    expect(JSON.stringify(shortPassword.body)).toMatch(/at least 8 characters/);
  });

  test("2. sign-up leaves the account pending email confirmation; sign-in is refused until confirmed", async ({ browser }: { browser: Browser }) => {
    await signUpThroughUi(owner, { email: ownerEmail, password: ownerPassword, household });
    expect((await (await fetch(`${process.env.E2E_FAKE_AUTH_URL ?? "http://127.0.0.1:4020"}/__test/outbox?email=${encodeURIComponent(ownerEmail)}`)).json()).count).toBe(1);
    // Not signed in yet: protected pages send the person to sign in.
    await owner.goto("/family");
    await expect(owner).toHaveURL(/\/login\?next=%2Ffamily/);
    // Sign-in before confirming fails with the generic message (no account enumeration).
    await owner.locator("#dp-email").fill(ownerEmail);
    await owner.locator("input[type=password]").fill(ownerPassword);
    await owner.getByRole("button", { name: /sign in/i }).click();
    await expect(owner.locator(".alert[role=alert]")).toContainText("Incorrect email or password.");
    await expect(owner).toHaveURL(/\/login/);
    // Signing up again with the same email is refused. (Done from another
    // browser: a second sign-up attempt replaces this browser's pending
    // email-link verifier, exactly as with real Supabase Auth.)
    const again = await (await browser.newContext()).newPage();
    await again.goto("/signup");
    await again.getByLabel("Email").fill(ownerEmail);
    await again.getByLabel("Password").fill(newPassword());
    await again.getByRole("button", { name: "Create household" }).click();
    await expect(again.locator(".alert[role=alert]")).toContainText(/already registered/i);
    await again.context().close();
  });

  test("3-4. the confirmation link signs the owner in and the first household exists, owned by them", async () => {
    const link = await outboxLink(ownerEmail);
    await owner.goto(link);
    await owner.waitForURL((u) => u.hostname === "localhost" && !u.pathname.startsWith("/login") && !u.pathname.startsWith("/api/"), { timeout: 60_000 });
    const hh = await api<{ activeHouseholdName: string; activeHouseholdId: string; memberships: { householdId: string; role: string }[] }>(owner, "/api/household");
    expect(hh.status).toBe(200);
    expect(hh.body.activeHouseholdName).toBe(household);
    expect(hh.body.memberships).toHaveLength(1);
    expect(hh.body.memberships[0].role).toBe("owner");
    ids.household = hh.body.activeHouseholdId;
    recordHousehold(ids.household);
    ids.ownerUser = await authUserId(ownerEmail);
    await owner.goto("/household");
    await expect(owner.getByLabel("Name", { exact: true })).toHaveValue(household);
    // The same link cannot be used twice.
    const reuse = await owner.context().newPage();
    await reuse.goto(link);
    await expect(reuse).toHaveURL(/\/login\?error=/);
    await reuse.close();
  });

  test("5. sign-out ends the session; protected pages and APIs refuse; sign-in returns to the requested page", async () => {
    await owner.goto("/");
    await signOutThroughUi(owner);
    const denied = await api(owner, "/api/family");
    expect(denied.status).toBe(401);
    await owner.goto("/family");
    await expect(owner).toHaveURL(/\/login\?next=%2Ffamily/);
    await owner.locator("#dp-email").fill(ownerEmail);
    await owner.locator("input[type=password]").fill(ownerPassword);
    await owner.getByRole("button", { name: /sign in/i }).click();
    await owner.waitForURL(/\/family$/);
    expect((await api(owner, "/api/family")).status).toBe(200);
  });

  test("6. an expired session is treated as signed out and the person signs in again", async () => {
    expect(await expireSessions(ownerEmail)).toBeGreaterThan(0);
    await owner.goto("/policies");
    await expect(owner).toHaveURL(/\/login\?next=%2Fpolicies/);
    expect((await api(owner, "/api/policies")).status).toBe(401);
    await signInThroughUi(owner, ownerEmail, ownerPassword, "/policies");
    await expect(owner).toHaveURL(/\/policies$/);
  });

  test("7. family members: add, edit and keep them in the household", async () => {
    await owner.goto("/family");
    for (const [who, relationship] of [[self, "self"], [child, "child"]] as const) {
      await owner.getByLabel("Full name").first().fill(who);
      await owner.locator("#fm-new-relationship").selectOption(relationship);
      await owner.getByRole("button", { name: "+ Add person" }).click();
      await expect(owner.locator(".profile-add-panel [role=status]")).toHaveText("Profile added.");
    }
    const family = (await api<{ family: { id: string; display_name: string }[] }>(owner, "/api/family")).body.family;
    for (const who of [self, child]) ids[who] = family.find((f) => f.display_name === who)!.id;
    // Edit the child's preferred name; the Save button reports the save.
    const childCard = owner.locator(".profile-card").filter({ has: owner.locator(`input[value="${child}"]`) });
    await childCard.getByLabel("Preferred name").fill("Syn Child");
    await childCard.getByRole("button", { name: "Save" }).click();
    await expect(childCard.getByRole("button", { name: "Saved" })).toBeVisible();
    const after = (await api<{ family: { id: string; preferred_name: string | null }[] }>(owner, "/api/family")).body.family;
    expect(after.find((f) => f.id === ids[child])?.preferred_name).toBe("Syn Child");
  });

  test("8-9. policy upload: clean, flagged, delayed and failed scans, and an extraction failure; linking a ready policy", async () => {
    const before = await (await fetch(`${FAKE_SERVICES}/__stats`)).json();
    await owner.goto("/policies");
    const uploads: [string, string, Buffer][] = [
      [files.clean, `${child} · child`, await syntheticWordingPdf("wording-clean")],
      [files.flagged, `${self} · self`, await syntheticWordingPdf("wording-flagged", [SYNTHETIC_MALWARE_MARKER])],
      [files.delayed, `${self} · self`, await syntheticWordingPdf("wording-delayed", [SYNTHETIC_PENDING_MARKER])],
      [files.failedScan, `${self} · self`, await syntheticWordingPdf("wording-scan-error", [SYNTHETIC_PROVIDER_ERROR_MARKER])],
      [files.unreadable, `${self} · self`, unreadablePdf("unreadable")],
    ];
    for (const [file, profile, buffer] of uploads) {
      await owner.locator(".upload-form select").selectOption({ label: profile });
      await owner.locator(".upload-form input[type=file]").setInputFiles({ name: file, mimeType: "application/pdf", buffer });
      await owner.getByRole("button", { name: "Upload & analyse" }).click();
      await expect(owner.locator(".upload-panel .upload-status")).toContainText("Upload received");
    }
    const clean = await waitForPolicy(owner, files.clean, (p) => p.processing_status === "ready");
    const flagged = await waitForPolicy(owner, files.flagged, (p) => p.quarantine_status === "scan_rejected");
    const delayed = await waitForPolicy(owner, files.delayed, (p) => p.quarantine_status === "scan_pending" && !!p.scan_result_detail);
    const failedScan = await waitForPolicy(owner, files.failedScan, (p) => p.quarantine_status === "scan_pending");
    // A failed scan attempt leaves the document held, records a fixed,
    // classified reason for the household and keeps any raw detail server-side.
    await expect.poll(async () => (await db((c) => c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM policy_document_audit_log WHERE policy_id=$1 AND action='scan_attempt_failed'`, [failedScan.id]))).rows[0].n,
      { timeout: 180_000, intervals: [1500] }).toBeGreaterThan(0);
    const failedRows = await db((c) => c.query<{ reason: string; diag: number }>(
      `SELECT a.reason, (SELECT count(*)::int FROM processing_failure_diagnostics d WHERE d.resource_id=a.policy_id) AS diag
         FROM policy_document_audit_log a WHERE a.policy_id=$1 AND a.action='scan_attempt_failed' LIMIT 1`, [failedScan.id]));
    expect(failedRows.rows[0].reason).toBe("The malware scan could not be completed; the document stays on hold.");
    expect(failedRows.rows[0].diag, "the raw failure is kept only in the service-only diagnostics table").toBeGreaterThan(0);
    const unreadable = await waitForPolicy(owner, files.unreadable, (p) => p.processing_status === "failed");
    Object.assign(ids, { clean: clean.id, flagged: flagged.id, delayed: delayed.id, failedScan: failedScan.id, unreadable: unreadable.id });

    expect(clean.quarantine_status).toBe("scan_clean");
    for (const held of [flagged, delayed, failedScan]) expect(held.processing_status, held.original_filename).not.toBe("ready");
    expect((await policies(owner)).find((p) => p.id === failedScan.id)!.processing_status, "a document whose scan failed is never processed").not.toBe("ready");
    const after = await (await fetch(`${FAKE_SERVICES}/__stats`)).json();
    expect(after.submissions - before.submissions).toBeGreaterThanOrEqual(4);
    expect(after.providerErrors - before.providerErrors).toBeGreaterThanOrEqual(1);

    // What the person sees: plain, classified states; never provider or pipeline internals.
    await owner.reload();
    await expect(card(owner, clean)).toContainText("Ready");
    await expect(card(owner, flagged)).toContainText("Rejected by malware scan");
    await expect(card(owner, delayed)).toContainText(/Waiting for malware scan|On hold/);
    await expect(card(owner, failedScan)).not.toContainText("Ready");
    // Expectation change (Test engineer, PR #65 round): was toContainText("Analysis stopped"). Households see "This document
    // could not be read" (data-testid document-unreadable); "Analysis stopped" is the operator page's wording. Fails the same on main ca6af69.
    await expect(card(owner, unreadable).getByTestId("document-unreadable")).toContainText("This document could not be read");
    await expect(owner.locator("main")).not.toContainText(/VirusTotal analysis|malicious=|syn-malicious-|InternalError|synthetic provider failure|Error: /);
    const raw = JSON.stringify(await policies(owner));
    expect(raw, "household-readable policy rows carry only classified failure text").not.toMatch(/InternalError|synthetic provider failure|at \S+ \(|Error: /);
    // Raw detail, if kept at all, lives only in the service-only diagnostics table.
    const diagnostics = await db((c) => c.query<{ n: number }>(`SELECT count(*)::int AS n FROM processing_failure_diagnostics WHERE account_id=$1`, [ids.household]));
    test.info().annotations.push({ type: "server-only diagnostics rows", description: String(diagnostics.rows[0].n) });

    // Retry: the household card offers "Try reading it again" only when no page was read; otherwise it says to
    // upload a clearer copy. Either way the document is never marked ready.
    // Expectation change (Test engineer, PR #65 round): was a click on a "Re-analyse" button, then "for re-analysis" in
    // .upload-status. Households have had no Re-analyse button since before main ca6af69 (it is the operator page's);
    // this step fails the same on main.
    const unreadableCard = card(owner, unreadable);
    const retry = unreadableCard.getByRole("button", { name: "Try reading it again" });
    if (await retry.count()) {
      await retry.click();
      await expect(owner.getByTestId("library-notice")).toContainText("again");
    } else {
      await expect(unreadableCard.getByTestId("document-unreadable")).toContainText(/clearer copy/);
    }
    for (let i = 0; i < 10; i++) {
      expect((await policies(owner)).find((p) => p.id === unreadable.id)!.processing_status, "an unreadable document is never marked ready").not.toBe("ready");
      await owner.waitForTimeout(2000);
    }

    // Link the ready policy to the child through the UI.
    await owner.reload();
    await card(owner, clean).getByRole("button", { name: child, exact: true }).click();
    await expect(owner.getByTestId("library-notice")).toContainText("Saved");
    const linked = (await policies(owner)).find((p) => p.id === clean.id)!;
    expect(linked.linked_people.map((l) => l.id)).toContain(ids[child]);
    expect(linked.linked_people.map((l) => l.id)).not.toContain(ids[self]);
  });

  test("10. operator step: synthetic certificates for the claim steps (local database, this household only)", async () => {
    const out = operator("e2e/support/seed-claim-fixture.ts", [], { E2E_SEED_USER_ID: ids.ownerUser, E2E_SEED_FILE: SEED_FILE });
    expect(out).toMatch(/seeded synthetic claim fixtures/);
    expect(seed().household).toBe(ids.household);
  });

  test("11. a factual chat question is answered from the policy's own cited page, with no amount", async () => {
    const { patientName } = seed();
    await owner.goto("/chat");
    await owner.getByRole("button", { name: "New chat" }).click();
    const answer = await ask(owner, `${patientName}: what is the waiting period for critical illness on the Living Care plan?`);
    await expect(answer).toContainText("90 days");
    const text = await answer.innerText();
    expect(text).not.toMatch(MONEY);
    expect(text).not.toMatch(FORBIDDEN);
    const citations = answer.locator("details.citations");
    await expect(citations).toContainText("Living Care");
    await expect(citations).toContainText("Page 5");
    const history = await api<{ conversations: { id: string; title: string }[] }>(owner, "/api/chat/history?scope=all");
    ids.factualConversation = history.body.conversations.find((c) => /waiting period/i.test(c.title))?.id ?? history.body.conversations[0].id;
  });

  test("12. every claim category enters deterministic fact-finding, with no amount", async () => {
    const claimant = `${PREFIX}-Claimant`;
    const cases: [string, RegExp[]][] = [
      [`${claimant} was admitted to hospital on 2026-08-02. What can be claimed?`, [/Hospital cash/i, /Medical reimbursement/i]],
      [`${claimant}'s flight was delayed 9 hours on the trip. Can we claim?`, [/Travel/i]],
      [`${claimant} is unable to work since 2026-07-01 after an injury. What can be claimed?`, [/Disability/i]],
      [`${PREFIX}-Relative died in a road accident on 2026-09-01. What can we claim?`, [/Accidental death/i]],
      [`${claimant} was diagnosed with stage 2 breast cancer on 2026-06-01. How much can I claim?`, [/Critical illness/i]],
    ];
    for (const [message, categories] of cases) {
      await owner.goto("/chat");
      await owner.getByRole("button", { name: "New chat" }).click();
      const answer = await ask(owner, message);
      const plan = answer.getByTestId("fact-finding");
      await expect(plan, message).toBeVisible();
      for (const category of categories) await expect(plan, message).toContainText(category);
      await expect(plan).toContainText(/Information needed|Evidence needed|Reviewer assessment needed/);
      const text = await answer.innerText();
      expect(text, message).not.toMatch(FORBIDDEN);
      for (const c of await answer.locator(".claim-item, .claim-card").allInnerTexts()) expect(c, message).not.toMatch(MONEY);
      expect(await answer.getByTestId("indicative-estimate").count()).toBe(0);
    }
  });

  test("13. claim evidence: upload through the Claims page; clean, flagged and unreadable documents; no estimate before review", async () => {
    const s = seed();
    await owner.goto("/chat");
    await owner.getByRole("button", { name: "New chat" }).click();
    const answer = await ask(owner, `${s.patientName} was diagnosed with Malignant neoplasm of the colon on 2026-06-01. How much can we claim?`);
    expect(await answer.innerText()).not.toMatch(MONEY);
    const history = await api<{ conversations: { id: string }[] }>(owner, "/api/chat/history?scope=all");
    for (const c of history.body.conversations) {
      const msgs = await api<{ messages: { answer_json?: { claimSessionId?: string } | null }[] }>(owner, `/api/chat/history/${c.id}`);
      const claimId = msgs.body.messages.map((m) => m.answer_json?.claimSessionId ?? "").filter(Boolean).at(-1) ?? "";
      if (!claimId) continue;
      const claim = await api<{ claim: { family_member_id: string } }>(owner, `/api/claims/${claimId}`);
      if (claim.body.claim?.family_member_id === s.patient) { ids.claim = claimId; break; }
    }
    expect(ids.claim, "the chat recorded the claim").toBeTruthy();

    await owner.goto(`/claims/${ids.claim}`);
    await expect(owner.getByTestId("indicative-estimate")).toHaveAttribute("data-has-estimate", "no");
    await expect(owner.getByTestId("indicative-estimate-notice")).toHaveText(INDICATIVE_NOTICE);
    const upload = async (file: string, bytes: Buffer) => {
      await owner.locator("select").first().selectOption("specialist_memo");
      await owner.locator("input[type=file]").setInputFiles({ name: file, mimeType: "application/pdf", buffer: bytes });
      await owner.getByRole("button", { name: /^upload$/i }).click();
      await expect(owner.getByText(file).first()).toBeVisible({ timeout: 60_000 });
    };
    const memo = `${PREFIX}-memo.pdf`, flagged = `${PREFIX}-flagged-memo.pdf`, unread = `${PREFIX}-unreadable-memo.pdf`;
    await upload(memo, await syntheticMemo(s.patientName));
    await upload(flagged, await syntheticMemo(s.patientName, { extraLines: [SYNTHETIC_MALWARE_MARKER] }));
    await upload(unread, await syntheticMemo(s.patientName, { withExtraction: false, tag: "no-extraction" }));
    type Doc = { id: string; original_filename: string; status: string };
    let docs: Doc[] = [];
    for (let i = 0; i < 240; i++) {
      docs = (await api<{ documents: Doc[] }>(owner, `/api/claims/evidence?familyMemberId=${s.patient}&claimSessionId=${ids.claim}`)).body.documents ?? [];
      const st = (f: string) => docs.find((d) => d.original_filename === f)?.status;
      if (st(memo) === "needs_review" && st(flagged) === "rejected" && st(unread) === "failed") break;
      await owner.waitForTimeout(1000);
    }
    const status = (f: string) => docs.find((d) => d.original_filename === f)?.status;
    expect(status(memo), "the memo was scanned clean, read with verified provenance and awaits review").toBe("needs_review");
    expect(status(flagged), "the flagged file is rejected at the scan and never read").toBe("rejected");
    expect(status(unread), "a document the reader cannot read fails, visibly and without internals").toBe("failed");
    ids.memo = docs.find((d) => d.original_filename === memo)!.id;
    await owner.reload();
    await expect(owner.getByTestId("indicative-estimate")).toHaveAttribute("data-has-estimate", "no");
    await expect(owner.locator("main")).not.toContainText(/DeterministicModelUnavailableError|Error: /);
  });

  test("14-17. reviewer: operator provisioning, sign-in without a household, decisions, and per-currency indicative estimates", async ({ browser }: { browser: Browser }) => {
    const s = seed();
    // Operator: Auth Admin API user, then the reviewer operator CLI.
    ids.reviewerUser = await adminCreateUser(reviewerEmail, reviewerPassword);
    reviewerAdmin(["provision", "--user", ids.reviewerUser, "--label", `${PREFIX}-Reviewer`, "--operator", "e2e-operator"]);
    const assignOut = reviewerAdmin(["assign", "--reviewer", ids.reviewerUser, "--household", ids.household, "--claim", ids.claim, "--hours", "2", "--operator", "e2e-operator"]);
    ids.assignment = JSON.parse(assignOut.slice(assignOut.indexOf("{"))).assignmentId;
    expect(ids.assignment).toMatch(/^[0-9a-f-]{36}$/);

    const reviewer = hardenNavigation(await (await browser.newContext()).newPage());
    await reviewer.goto("/login");
    await reviewer.locator("#dp-email").fill(reviewerEmail);
    await reviewer.locator("input[type=password]").fill(reviewerPassword);
    await reviewer.getByRole("button", { name: /sign in/i }).click();
    await reviewer.waitForURL(/\/reviewer$/, { timeout: 60_000 });
    // A reviewer-only account gets no household of its own and sees no household data.
    const memberships = await db((c) => c.query<{ n: number }>(`SELECT count(*)::int AS n FROM household_members WHERE user_id=$1`, [ids.reviewerUser]));
    expect(memberships.rows[0].n, "signing in did not create a household for the reviewer").toBe(0);
    expect([401, 403, 404]).toContain((await api(reviewer, "/api/policies")).status);
    expect([401, 403, 404]).toContain((await api(reviewer, `/api/claims/${ids.claim}`)).status);
    expect([403, 404]).toContain((await api(reviewer, "/api/reviewer/assignments/00000000-0000-4000-8000-000000000000")).status);

    await reviewer.getByRole("link").filter({ hasText: s.patientName }).first().click();
    await reviewer.waitForURL(/\/reviewer\/assignments\//, { timeout: 180_000 });
    await reviewer.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await expect(reviewer.getByText(`${PREFIX}-memo.pdf`)).toBeVisible({ timeout: 60_000 });
    // `next dev` compiles each route on its first request; warm the decision
    // routes (an empty body is refused with a JSON error, never recorded) so
    // the first real decision is not the compile request.
    for (const route of ["match", "ci-match", "disability-match", "travel-match"]) {
      for (let i = 0; i < 5; i++) {
        const warm = await api(reviewer, `/api/claims/evidence/${ids.memo}/${route}`, { method: "POST", body: {} });
        if (typeof warm.body === "object") break;
        test.info().annotations.push({ type: "decision route warm-up", description: `${route}: HTTP ${warm.status} ${String(warm.body).replace(/\s+/g, " ").match(/<title>[^<]*<\/title>|<h1[^>]*>[^<]*<\/h1>|<h2[^>]*>[^<]*<\/h2>/g)?.join(" ") ?? ""}` });
        await reviewer.waitForTimeout(2000);
      }
    }
    const decisionCard = reviewer.locator(".action-card").filter({ hasText: `${PREFIX}-memo.pdf` });
    await expect(decisionCard).toContainText("reading provenance verified");
    const decide = async (policyNumber: string, choice: RegExp) => {
      const option = await decisionCard.locator("select option").filter({ hasText: policyNumber }).getAttribute("value");
      await decisionCard.locator("select").selectOption(option!);
      await decisionCard.getByLabel(choice).check();
      await decisionCard.locator("textarea").fill("Synthetic review against the cited definition.");
      const saved = reviewer.waitForResponse((r) => r.request().method() === "POST" && /\/api\/claims\/evidence\/[^/]+\/[a-z-]*match$/.test(new URL(r.url()).pathname), { timeout: 60_000 });
      await decisionCard.getByRole("button", { name: "Record decision" }).click();
      const response = await saved;
      const detail = `${policyNumber} ${choice}: HTTP ${response.status()} ${(await response.text().catch(() => "")).slice(0, 300)} | ${(await decisionCard.getByRole("alert").allInnerTexts()).join(" | ")}`;
      await expect(decisionCard.getByRole("button", { name: "Record decision" })).toBeVisible({ timeout: 30_000 });
      await expect(decisionCard.getByRole("alert"), detail).toHaveCount(0);
      await expect(decisionCard.locator("textarea")).toHaveValue("");
    };
    const estimate = owner.getByTestId("indicative-estimate");
    const noEstimate = async (why: string) => {
      await owner.goto(`/claims/${ids.claim}`);
      await expect(estimate, why).toHaveAttribute("data-has-estimate", "no", { timeout: 90_000 });
      expect(await estimate.innerText(), why).not.toMatch(MONEY);
    };

    await decide(`${PREFIX}-LC-SGD`, /Does not match/);
    await noEstimate("a negative decision never produces an amount");
    await decide(`${PREFIX}-LC-USD`, /Needs further review/);
    await noEstimate("needs further review or evidence never produces an amount");
    await decide(`${PREFIX}-LC-SGD`, /^Matches/);
    await decide(`${PREFIX}-LC-USD`, /^Matches/);
    await decide(`${PREFIX}-LC-NOCCY`, /^Matches/);
    await expect(decisionCard).toContainText(/does not match/i);
    await expect(decisionCard).toContainText(/superseded/i);
    await reviewer.context().close();

    await owner.goto(`/claims/${ids.claim}`);
    await expect(estimate).toHaveAttribute("data-has-estimate", "yes", { timeout: 90_000 });
    await expect(owner.getByTestId("indicative-estimate-notice")).toHaveText(INDICATIVE_NOTICE);
    const sgd = estimate.locator('[data-testid=indicative-benefit][data-currency="SGD"]');
    const usd = estimate.locator('[data-testid=indicative-benefit][data-currency="USD"]');
    await expect(sgd).toHaveCount(1); await expect(usd).toHaveCount(1);
    await expect(sgd).toContainText("200,000"); await expect(sgd).toContainText("page 4");
    await expect(usd).toContainText("100,000"); await expect(usd).toContainText("page 4");
    // Currency separation: one total per currency, never a combined figure.
    const totals = estimate.getByTestId("indicative-total");
    await expect(totals).toHaveCount(2);
    await expect(estimate.locator('[data-testid=indicative-total][data-currency="SGD"]')).toContainText("200,000");
    await expect(estimate.locator('[data-testid=indicative-total][data-currency="USD"]')).toContainText("100,000");
    expect((await totals.allInnerTexts()).join(" ")).not.toMatch(/300,000|350,000/);
    // Blocked benefits are shown as "no amount" -- absent, never zero.
    const blocked = estimate.locator('[data-testid=indicative-benefit][data-status="no_amount"]');
    expect(await blocked.count()).toBeGreaterThanOrEqual(1);
    for (const row of await blocked.allInnerTexts()) {
      expect(row).not.toMatch(MONEY);
      expect(row).not.toMatch(/50,000/);
      expect(row, "a blocked benefit never shows a zero amount").not.toMatch(/(?:S\$|US\$|SGD|USD|\$)\s?0(?:\.00)?\b/);
    }
    expect((await totals.allInnerTexts()).join(" ")).not.toMatch(/(?:S\$|US\$|SGD|USD|\$)\s?0(?:\.00)?\b/);
    await expect(estimate.locator('[data-testid=indicative-benefit][data-status="included"]')).toHaveCount(2);
  });

  test("18. cross-household isolation: another owner can neither see nor act on this household's data", async ({ browser }: { browser: Browser }) => {
    await adminCreateUser(ownerBEmail, ownerBPassword);
    const other = hardenNavigation(await (await browser.newContext()).newPage());
    await signInThroughUi(other, ownerBEmail, ownerBPassword);
    const theirs = await api<{ activeHouseholdId: string }>(other, "/api/household");
    expect(theirs.body.activeHouseholdId).not.toBe(ids.household);
    ids.householdB = theirs.body.activeHouseholdId;
    recordHousehold(ids.householdB);
    expect((await policies(other)).map((p) => p.id)).not.toContain(ids.clean);
    const fam = (await api<{ family: { display_name: string }[] }>(other, "/api/family")).body.family ?? [];
    expect(fam.map((f) => f.display_name)).not.toContain(self);
    for (const pathName of [`/api/claims/${ids.claim}`, `/api/claims/${ids.claim}/indicative`, `/api/chat/history/${ids.factualConversation}`,
      `/api/claims/evidence?familyMemberId=${seed().patient}&claimSessionId=${ids.claim}`]) {
      const res = await api(other, pathName);
      expect([403, 404], pathName).toContain(res.status);
      expect(JSON.stringify(res.body), pathName).not.toMatch(/Living Care|200,000|100,000/);
    }
    expect([403, 404]).toContain((await api(other, `/api/policies/${ids.clean}`, { method: "DELETE" })).status);
    expect([403, 404]).toContain((await api(other, `/api/family/${ids[child]}`, { method: "DELETE" })).status);
    expect([401, 403]).toContain((await api(other, "/api/reviewer/assignments")).status);
    await other.goto("/reviewer");
    await expect(other.locator(".alert[role=alert]")).toContainText(/only for assigned DearPolicy reviewers|Not an active/i);
    expect((await policies(owner)).map((p) => p.id), "nothing changed for the owner").toContain(ids.clean);
    (globalThis as { __ownerB?: Page }).__ownerB = other;
  });

  test("19. export: a recently signed-in owner downloads only this household's synthetic data", async () => {
    // Sensitive actions need a recent sign-in: sign in again first.
    await owner.goto("/");
    await signOutThroughUi(owner);
    await signInThroughUi(owner, ownerEmail, ownerPassword, "/household");
    const panel = owner.getByTestId("household-export");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await panel.getByRole("button", { name: /prepare my download/i }).click();
    const link = owner.getByTestId("household-export-download");
    await expect(link).toBeVisible({ timeout: 240_000 });
    const exportId = ((await link.getAttribute("href")) ?? "").match(/export\/([0-9a-f-]{36})\/download/)?.[1];
    expect(exportId).toBeTruthy();
    const download = await owner.evaluate(async (id) => {
      const res = await fetch(`/api/household/export/${id}/download`, { cache: "no-store" });
      const buf = new Uint8Array(await res.arrayBuffer());
      let text = ""; for (const b of buf) text += String.fromCharCode(b);
      return { status: res.status, text };
    }, exportId);
    expect(download.status).toBe(200);
    expect(download.text).toContain(self);
    expect(download.text).not.toContain(ownerBEmail);
    expect(download.text).not.toMatch(/"storage_key"|\.e2e-storage|[?&](token|X-Amz-Signature|sig)=|service_role|refresh_token|access_token/i);
    const other = (globalThis as { __ownerB?: Page }).__ownerB!;
    expect([403, 404], "another household cannot download this export").toContain((await api(other, `/api/household/export/${exportId}/download`)).status);
  });

  test("20. deleting claim evidence removes what was estimated from it", async () => {
    await owner.goto(`/claims/${ids.claim}`);
    const doc = owner.locator(".action-card").filter({ hasText: `${PREFIX}-memo.pdf` });
    await doc.getByRole("button", { name: `Delete ${PREFIX}-memo.pdf` }).click();
    await expect(doc.getByRole("note")).toContainText("cannot be undone");
    await doc.getByRole("button", { name: `Confirm delete ${PREFIX}-memo.pdf` }).click();
    await expect(owner.getByRole("status").filter({ hasText: "was deleted" })).toBeVisible({ timeout: 60_000 });
    await expect(owner.locator(".action-card").filter({ hasText: `${PREFIX}-memo.pdf` })).toHaveCount(0);
    await owner.reload();
    await expect(owner.getByTestId("indicative-estimate")).toHaveAttribute("data-has-estimate", "no", { timeout: 30_000 });
    expect(await owner.getByTestId("indicative-estimate").innerText()).not.toMatch(MONEY);
  });

  test("21. deleting a policy invalidates the saved answer that relied on it", async () => {
    const s = seed();
    const before = await api<{ messages: { answer_json?: { citations?: { policyId: string }[] } | null }[] }>(owner, `/api/chat/history/${ids.factualConversation}`);
    expect(before.body.messages.some((m) => m.answer_json?.citations?.some((c) => c.policyId === s.policyIds.sgd))).toBe(true);
    const removed = await api(owner, `/api/policies/${s.policyIds.sgd}`, { method: "DELETE" });
    expect([200, 202, 204]).toContain(removed.status);
    const after = await api<{ messages: { answer_json?: { citations?: unknown[]; invalidated?: unknown; summary?: string } | null }[] }>(owner, `/api/chat/history/${ids.factualConversation}`);
    const answers = after.body.messages.map((m) => m.answer_json).filter(Boolean);
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) { expect(a!.invalidated).toBeTruthy(); expect(a!.citations ?? []).toEqual([]); expect(a!.summary ?? "").not.toMatch(/90 days/); }
    // The flagged upload is deleted through the Documents page's two-step confirmation.
    await owner.goto("/policies");
    const flagged = (await policies(owner)).find((p) => p.id === ids.flagged)!;
    const c = card(owner, flagged);
    await c.getByRole("button", { name: "Delete" }).click();
    await c.getByRole("button", { name: "Confirm delete" }).click();
    await expect(owner.getByTestId("library-notice")).toContainText(/Deleted .*no longer used in answers/);
    expect((await policies(owner)).map((p) => p.id)).not.toContain(ids.flagged);
  });

  test("22. deleting a family member through the Family page (refused while documents are linked)", async () => {
    await owner.goto("/family");
    const childCard = () => owner.locator(".profile-card").filter({ has: owner.locator(`input[value="${child}"]`) });
    await childCard().getByRole("button", { name: `Delete ${child}` }).click();
    await childCard().getByRole("button", { name: `Confirm delete ${child}` }).click();
    await expect(owner.locator(".profile-add-panel [role=status]")).toContainText("has linked documents or activity");
    expect(((await api<{ family: { id: string }[] }>(owner, "/api/family")).body.family ?? []).map((f) => f.id)).toContain(ids[child]);
    // Remove the child's document first, then the profile.
    await owner.goto("/policies");
    const clean = (await policies(owner)).find((p) => p.id === ids.clean)!;
    await card(owner, clean).getByRole("button", { name: "Delete" }).click();
    await card(owner, clean).getByRole("button", { name: "Confirm delete" }).click();
    await expect(owner.getByTestId("library-notice")).toContainText(/Deleted .*no longer used in answers/);
    await owner.goto("/family");
    await childCard().getByRole("button", { name: `Delete ${child}` }).click();
    await childCard().getByRole("button", { name: `Confirm delete ${child}` }).click();
    await expect(owner.locator(".profile-add-panel [role=status]")).toContainText(`Removed ${child}`);
    const family = (await api<{ family: { id: string }[] }>(owner, "/api/family")).body.family ?? [];
    expect(family.map((f) => f.id)).not.toContain(ids[child]);
  });

  test("23. deleting both households leaves nothing readable, and the owners can sign out", async () => {
    for (const [page, email, password] of [[owner, ownerEmail, ownerPassword], [(globalThis as { __ownerB?: Page }).__ownerB!, ownerBEmail, ownerBPassword]] as const) {
      await page.goto("/");
      await signOutThroughUi(page);
      await signInThroughUi(page, email, password, "/household");
      const hhName = String((await api(page, "/api/household")).body.activeHouseholdName);
      expect(hhName.toLowerCase(), "only ever delete a synthetic household").toContain(PREFIX.toLowerCase());
      await page.getByLabel("Household name").fill(hhName);
      await page.getByRole("button", { name: "Permanently delete household" }).click();
      await page.waitForURL((u) => u.pathname === "/household/deleted", { timeout: 60_000 }); // its own confirmation page
      expect((await api(page, "/api/policies")).status).toBe(404);
    }
    for (const id of [ids.factualConversation]) expect([401, 403, 404]).toContain((await api(owner, `/api/chat/history/${id}`)).status);
    expect([401, 403, 404]).toContain((await api(owner, `/api/claims/${ids.claim}/indicative`)).status);
    await signOutThroughUi(owner);
    const stats = await fakeAuthStats();
    test.info().annotations.push({ type: "fake auth", description: JSON.stringify({ signups: stats.signups, confirmations: stats.confirmations, passwordGrants: stats.passwordGrants, pkceGrants: stats.pkceGrants, refreshGrants: stats.refreshGrants, logouts: stats.logouts, expired: stats.expired }) });
  });
});

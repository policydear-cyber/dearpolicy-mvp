/**
 * Document-ingestion browser journey (prototype document-safety mode).
 * Real Chromium, real Next.js, real PostgreSQL, real upload/queue/OCR/
 * extraction/verification/linking/indexing/chat code; the only stand-in is
 * the deterministic model (lib/ai/deterministic-model.ts), which cannot run
 * in production. The app under test runs with
 * MALWARE_SCANNING_INTENTIONALLY_DISABLED=true and NO scanner configured,
 * and WITHOUT the standalone jobs worker -- documents advance only through
 * the bounded request drain that authenticated status polling triggers.
 * Synthetic local data only; see e2e/support/ingestion-fixtures.ts.
 */
import { test, expect, type Page, type Browser } from "@playwright/test";
import {
  PREFIX, personName, certificatePdf, wordingPdf, scannedPdf, imageBytes, docxBytes,
  corruptedPng, gifBytes, exeBytes, zipBytes, heicBytes, oversizedPdf,
} from "../support/ingestion-fixtures";

const BASE_B = process.env.E2E_BASE_URL_B ?? "http://localhost:3001";
/** Language the prototype UI must never use about an unscanned file. */
const SCAN_CLAIMS = /security scan passed|scan passed|malware[- ]free|virus[- ]free|safe file|virustotal|scanned and clean/i;
const PROTOTYPE_RECEIVED = "Document received — reading and extracting information.";
const NOT_SCANNED_DETAIL = "Not scanned: malware scanning is intentionally disabled in this prototype build.";

type ApiPolicy = {
  id: string; original_filename: string; product_name: string | null; insurer: string | null;
  policy_number: string | null; document_role: string | null; personal_coverage_confirmed: boolean;
  processing_status: string; processing_stage: string | null; processing_message: string | null;
  processing_error: string | null; quarantine_status: string; scan_result_detail: string | null;
  needs_review: boolean; review_reason: string | null; page_count: number | null;
  linked_people: { id: string; name: string; relationship: string; source: string }[];
  detected_people: { name: string; matchedFamilyMemberId: string | null }[];
};
type PoliciesResponse = { policies: ApiPolicy[]; documentSafetyMode: string };

async function api<T = unknown>(page: Page, url: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ url, init }) => {
    const headers: Record<string, string> = {};
    if (init?.body) headers["content-type"] = "application/json";
    const res = await fetch(url, { method: init?.method ?? "GET", headers, body: init?.body ? JSON.stringify(init.body) : undefined, cache: "no-store" });
    const text = await res.text(); let body: unknown = text; try { body = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, body: body as never };
  }, { url, init });
}

/** Every authenticated poll here runs the app's own bounded request drain --
 * exactly how the Hobby prototype advances work with no worker running. */
async function policies(page: Page): Promise<PoliciesResponse> {
  const res = await api<PoliciesResponse>(page, "/api/policies");
  expect(res.status).toBe(200);
  return res.body;
}

async function findByFilename(page: Page, filename: string): Promise<ApiPolicy | undefined> {
  return (await policies(page)).policies.find((p) => p.original_filename === filename);
}

/** Polls (drain-driven) until the uploaded document reaches a terminal
 * processing state; asserts along the way it is never labelled scanned. */
async function waitForProcessed(page: Page, filename: string, timeoutMs = 240_000): Promise<ApiPolicy> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await findByFilename(page, filename);
    if (found) {
      expect(found.quarantine_status, `${filename} must never be recorded as malware-scanned`).not.toBe("scan_clean");
      expect(found.quarantine_status).not.toBe("scan_rejected");
      if (found.processing_status === "ready" || found.processing_status === "failed") return found;
    }
    if (Date.now() > deadline) throw new Error(`${filename} still not processed: ${JSON.stringify(found ? { status: found.processing_status, stage: found.processing_stage, error: found.processing_error, quarantine: found.quarantine_status } : "not listed")}`);
    await page.waitForTimeout(1_500);
  }
}

async function uploadDocument(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, memberName?: string) {
  await page.goto("/policies");
  if (memberName) {
    // Option labels read "<name> · <relationship>", loaded asynchronously;
    // if the one-shot family fetch was lost (slow dev compile), reload
    // instead of waiting on a select that will never fill.
    const select = page.locator(".upload-form select").first();
    const option = select.locator("option", { hasText: memberName });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const found = await expect(option).toHaveCount(1, { timeout: 10_000 }).then(() => true, () => false);
      if (found) break;
      if (attempt === 3) throw new Error(`family option ${memberName} never appeared`);
      await page.reload();
    }
    await select.selectOption(await option.getAttribute("value") ?? "");
  }
  // Under next dev the change handler can attach a beat after the input
  // renders; if the file did not register (submit stays disabled), set it
  // again rather than hanging on a permanently disabled button.
  const input = page.locator('.upload-form input[type="file"]');
  const submit = page.getByRole("button", { name: /upload & analyse/i });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await input.setInputFiles(file);
    const enabled = await expect(submit).toBeEnabled({ timeout: 4_000 }).then(() => true, () => false);
    if (enabled) break;
    if (attempt === 4) throw new Error("upload submit never became enabled");
    await page.waitForTimeout(500);
  }
  await submit.click();
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

// Person names that pass the real person-name sanitizer (no digit runs)
// while still carrying this run's marker as letters.
const ALEX = personName("Alex");
const BELLA = personName("Bella");
const CASEY = personName("Casey");

test.describe.serial("document ingestion in prototype document-safety mode", () => {
  let page: Page;
  let certId = "";

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    await page.goto("/policies");
    // Two synthetic family profiles the linking cases match against.
    for (const displayName of [ALEX, BELLA]) {
      const created = await api(page, "/api/family", { method: "POST", body: { displayName, relationship: displayName === ALEX ? "self" : "spouse" } });
      expect([200, 201]).toContain(created.status);
    }
  });

  test("1. prototype mode is announced by the API and the page never claims a scan", async () => {
    const body = await policies(page);
    expect(body.documentSafetyMode).toBe("not_scanned_prototype");
    await page.goto("/policies");
    expect(await page.locator("body").innerText()).not.toMatch(SCAN_CLAIMS);
  });

  test("2. a text-PDF certificate uploads, is recorded not_scanned_prototype, and processes to ready through the request drain alone", async () => {
    const buffer = await certificatePdf({ label: "Family-Shield", policyNumber: `${PREFIX}-PN-001`, insuredNames: [ALEX] });
    await uploadDocument(page, { name: "certificate.pdf", mimeType: "application/pdf", buffer }, ALEX);

    // The card appears with the prototype wording, never antivirus language.
    await expect(page.locator(".document-card").filter({ hasText: "certificate.pdf" }).first()).toBeVisible({ timeout: 30_000 });
    // The gate cascade (uploaded -> quarantined -> scan_pending ->
    // not_scanned_prototype) runs right after the upload response; poll until
    // it settles, asserting it never passes through a scanned/clean state.
    let listed = await findByFilename(page, "certificate.pdf");
    expect(listed).toBeTruthy();
    for (let i = 0; i < 40 && listed!.quarantine_status !== "not_scanned_prototype"; i += 1) {
      expect(["uploaded", "quarantined", "scan_pending", "not_scanned_prototype"]).toContain(listed!.quarantine_status);
      await page.waitForTimeout(1_000);
      listed = await findByFilename(page, "certificate.pdf");
    }
    expect(listed!.quarantine_status).toBe("not_scanned_prototype");
    expect(listed!.scan_result_detail ?? "").not.toMatch(SCAN_CLAIMS);

    const ready = await waitForProcessed(page, "certificate.pdf");
    certId = ready.id;
    expect(ready.processing_status).toBe("ready");
    expect(ready.quarantine_status).toBe("not_scanned_prototype");
    expect(ready.page_count).toBe(2);
    expect(ready.document_role).toBe("certificate");
    expect(ready.personal_coverage_confirmed).toBe(true);
    expect(ready.insurer).toBe("Synthetic Test Insurer");
    expect(ready.policy_number).toBe(`${PREFIX}-PN-001`);

    // Confident single-member match: the detected name equals the family
    // profile, so it is auto-matched -- and shown, never silent.
    expect(ready.detected_people).toEqual([{ name: ALEX, matchedFamilyMemberId: expect.any(String) }]);
    await page.goto("/policies");
    // A ready card is titled by its detected product name, not the filename.
    const card = page.locator(".document-card").filter({ hasText: `${PREFIX}-Family-Shield` }).first();
    await expect(card).toContainText("Named insured people found");
    await expect(card).toContainText(ALEX);
    await expect(card).toContainText("Matched ✓");
    expect(await card.innerText()).not.toMatch(SCAN_CLAIMS);
  });

  test("3. the details panel reviews the extraction with citations and hides internals", async () => {
    await page.goto("/policies");
    const card = page.locator(".document-card").filter({ hasText: `${PREFIX}-Family-Shield` }).first();
    await card.getByRole("button", { name: "Details" }).click();
    const panel = page.locator('[data-testid="policy-details"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-testid="detail-insurer"]')).toHaveText("Synthetic Test Insurer");
    await expect(panel.locator('[data-testid="detail-policy-number"]')).toHaveText(`${PREFIX}-PN-001`);
    await expect(panel.locator('[data-testid="detail-expiry"]')).toContainText("2027-01-01");
    const coverage = panel.locator('[data-testid="detail-coverage"]').first();
    await expect(coverage).toContainText("Critical Illness");
    await expect(coverage).toContainText("page 1");
    await expect(coverage).toContainText("source-verified");
    const panelText = await panel.innerText();
    expect(panelText).not.toMatch(SCAN_CLAIMS);
    expect(panelText).not.toMatch(/storage[_ ]key|\.e2e-storage|stack trace/i);

    // The review API itself never exposes storage keys, prompts or raw errors.
    const review = await api<{ document: Record<string, unknown> }>(page, `/api/policies/${certId}`);
    expect(review.status).toBe(200);
    expect(JSON.stringify(review.body)).not.toMatch(/storage_key|storageKey|system prompt|providerRequestId/i);
  });

  test("4. format matrix: every genuinely supported format uploads and processes", async () => {
    test.setTimeout(20 * 60_000);
    const matrix: { name: string; mimeType: string; buffer: Buffer }[] = [
      { name: "scanned-policy.pdf", mimeType: "application/pdf", buffer: await scannedPdf(2) },
      { name: "photo-page.jpg", mimeType: "image/jpeg", buffer: await imageBytes("jpeg") },
      { name: "photo-page.png", mimeType: "image/png", buffer: await imageBytes("png") },
      { name: "photo-page.webp", mimeType: "image/webp", buffer: await imageBytes("webp") },
      { name: "photo-page.tiff", mimeType: "image/tiff", buffer: await imageBytes("tiff") },
      { name: "wording.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await docxBytes("Docx-Wording") },
    ];
    for (const file of matrix) {
      await uploadDocument(page, file);
      const done = await waitForProcessed(page, file.name);
      expect(done.processing_status, `${file.name} must reach ready`).toBe("ready");
      expect(done.quarantine_status).toBe("not_scanned_prototype");
    }
    // The scanned PDF (no text layer) was read by the deterministic OCR
    // stand-in: both pages transcribed, then classified from that text as
    // generic wording (the transcript is wording-style), pages preserved.
    const scanned = await findByFilename(page, "scanned-policy.pdf");
    expect(scanned!.page_count).toBe(2);
    expect(scanned!.document_role).toBe("policy_wording");
    expect(scanned!.personal_coverage_confirmed).toBe(false);
    // Images are normalised to one-page scanned documents and OCRed the same way.
    for (const name of ["photo-page.jpg", "photo-page.png", "photo-page.webp", "photo-page.tiff"]) {
      const image = await findByFilename(page, name);
      expect(image!.page_count, `${name} page count`).toBe(1);
      expect(image!.document_role, `${name} classified from its OCR transcript`).toBe("policy_wording");
    }
    // The DOCX text is parsed natively (no OCR) and classified as wording.
    const docx = await findByFilename(page, "wording.docx");
    expect(docx!.document_role).toBe("policy_wording");
    expect(docx!.personal_coverage_confirmed).toBe(false);
  });

  test("5. rejected uploads: wrong, dangerous or unreadable files are refused with the accepted-formats message", async () => {
    test.setTimeout(10 * 60_000);
    const before = (await policies(page)).policies.length;
    const cases: { file: { name: string; mimeType: string; buffer: Buffer }; expectStatus: RegExp }[] = [
      { file: { name: "corrupted.png", mimeType: "image/png", buffer: corruptedPng() }, expectStatus: /could not be read|corrupted/i },
      { file: { name: "renamed-photo.pdf", mimeType: "application/pdf", buffer: await imageBytes("png") }, expectStatus: /do(es)? not match|signature/i },
      { file: { name: "animation.gif", mimeType: "image/gif", buffer: gifBytes() }, expectStatus: /PDF, JPEG, PNG, WebP, TIFF|accepted|supported/i },
      { file: { name: "photo.heic", mimeType: "image/heic", buffer: heicBytes() }, expectStatus: /HEIC|export|JPEG/i },
      { file: { name: "statement.exe", mimeType: "application/octet-stream", buffer: exeBytes() }, expectStatus: /executable|not.*accepted|cannot/i },
      { file: { name: "documents.zip", mimeType: "application/zip", buffer: await zipBytes() }, expectStatus: /archive|zip/i },
    ];
    for (const { file, expectStatus } of cases) {
      await uploadDocument(page, file);
      const status = page.locator(".upload-status");
      await expect(status, `${file.name} must be refused`).toBeVisible({ timeout: 30_000 });
      await expect(status).toContainText(expectStatus);
      expect(await status.innerText()).not.toMatch(/Error:|TypeError|stack|ENOENT/);
    }
    // Oversized: over the 50MB limit, refused before any processing.
    // (Playwright caps in-memory upload buffers at 50MB, so this one file
    // goes through a real temp file on disk.)
    const { writeFileSync, rmSync } = await import("node:fs");
    const pathMod = await import("node:path");
    // logs/ is recreated by the run script for every run, so the 50MB file
    // never accumulates across runs the way a temp dir would.
    const hugePath = pathMod.resolve("logs", "huge-upload-fixture.pdf");
    writeFileSync(hugePath, oversizedPdf());
    try {
      await page.goto("/policies");
      await page.locator('.upload-form input[type="file"]').setInputFiles(hugePath);
      await page.getByRole("button", { name: /upload & analyse/i }).click();
      await expect(page.locator(".upload-status")).toContainText(/50\s?MB|too large|limit/i, { timeout: 120_000 });
    } finally {
      rmSync(hugePath, { force: true });
    }
    // None of the refused files became a document.
    expect((await policies(page)).policies.length).toBe(before);
  });

  test("6. ambiguous name needs manual confirmation; manual linking works and is audited; correction controls record corrections", async () => {
    const buffer = await certificatePdf({ label: "Ambiguous", policyNumber: `${PREFIX}-PN-002`, insuredNames: [CASEY] });
    await uploadDocument(page, { name: "ambiguous.pdf", mimeType: "application/pdf", buffer });
    const done = await waitForProcessed(page, "ambiguous.pdf");
    expect(done.processing_status).toBe("ready");

    // No family profile is named Casey: nothing is linked automatically and
    // no member is invented; the document asks for review instead.
    expect(done.detected_people).toEqual([{ name: CASEY, matchedFamilyMemberId: null }]);
    expect(done.linked_people).toEqual([]);
    expect(done.needs_review).toBe(true);
    expect(done.review_reason ?? "").toMatch(/not linked to a family profile/);

    // Manual confirmation through the UI: match Casey to Bella's profile.
    await page.goto("/policies");
    const card = page.locator(".document-card").filter({ hasText: `${PREFIX}-Ambiguous` }).first();
    await expect(card).toContainText("still need matching");
    await card.locator(".detected-row select").selectOption({ label: BELLA });
    await expect(card.locator(".detected-row .matched")).toContainText("Matched ✓", { timeout: 30_000 });
    const linked = await findByFilename(page, "ambiguous.pdf");
    expect(linked!.linked_people.map((p) => p.name)).toEqual([BELLA]);
    expect(linked!.needs_review).toBe(false);

    // Correction controls: fix the insurer through the details panel; the
    // correction is applied and recorded.
    await card.getByRole("button", { name: "Details" }).click();
    const panel = page.locator('[data-testid="policy-details"]');
    await panel.getByLabel("Field to correct").selectOption("insurer");
    await panel.getByLabel("Corrected value").fill(`${PREFIX} Corrected Insurer`);
    await panel.getByRole("button", { name: /save correction/i }).click();
    await expect(panel.locator('[data-testid="detail-insurer"]')).toHaveText(`${PREFIX} Corrected Insurer`, { timeout: 30_000 });
    const review = await api<{ corrections: { field_name: string }[] }>(page, `/api/policies/${linked!.id}`);
    expect(review.body.corrections.some((c) => c.field_name === "insurer")).toBe(true);
  });

  test("7. one certificate can cover multiple family members", async () => {
    const buffer = await certificatePdf({ label: "Multi", policyNumber: `${PREFIX}-PN-003`, insuredNames: [ALEX, BELLA], amounts: [100000, 75000] });
    await uploadDocument(page, { name: "multi-member.pdf", mimeType: "application/pdf", buffer });
    const done = await waitForProcessed(page, "multi-member.pdf");
    expect(done.processing_status).toBe("ready");
    expect(done.detected_people.map((d) => ({ name: d.name, matched: Boolean(d.matchedFamilyMemberId) }))).toEqual([
      { name: ALEX, matched: true }, { name: BELLA, matched: true },
    ]);
    expect(done.linked_people.map((p) => p.name).sort()).toEqual([ALEX, BELLA]);
  });

  test("8. another household cannot see or link this household's documents", async ({ browser }: { browser: Browser }) => {
    const other = await (await browser.newContext()).newPage();
    await other.goto(`${BASE_B}/policies`);
    const theirs = await api<PoliciesResponse>(other, `${BASE_B}/api/policies`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.policies.map((p) => p.original_filename)).not.toContain("certificate.pdf");
    // Their own family profile id must not let them link OUR policy.
    const created = await api<{ member: { id: string } }>(other, `${BASE_B}/api/family`, { method: "POST", body: { displayName: personName("Stranger"), relationship: "self" } });
    expect(created.status).toBe(201);
    const strangerMember = created.body.member.id;
    const attempt = await api(other, `${BASE_B}/api/policies/link-person`, { method: "POST", body: { policyId: certId, detectedName: ALEX, familyMemberId: strangerMember } });
    expect(attempt.status).toBe(404);
    // And our document is unchanged.
    const mine = await findByFilename(page, "certificate.pdf");
    expect(mine!.linked_people.map((p) => p.name)).toEqual([ALEX]);
    await other.context().close();
  });

  test("9. re-analyse works in prototype mode and never rewrites the safety record", async () => {
    await page.goto("/policies");
    const card = page.locator(".document-card").filter({ hasText: `${PREFIX}-Family-Shield` }).first();
    await card.getByRole("button", { name: "Re-analyse" }).click();
    const done = await waitForProcessed(page, "certificate.pdf");
    expect(done.processing_status).toBe("ready");
    expect(done.quarantine_status).toBe("not_scanned_prototype");
    expect(done.detected_people).toEqual([{ name: ALEX, matchedFamilyMemberId: expect.any(String) }]);
  });

  test("10. a permanent extraction failure shows a safe next action, not internals", async () => {
    // A personalised-looking document with no readable facts: the stand-in
    // extractor deliberately refuses it, exactly like a provider failure.
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([595, 842]);
    ["Certificate of Insurance", "Particulars of Insured", "Sum Insured: see schedule", "Effective Date 2025-01-01", `Ref ${PREFIX}-FAIL`].forEach((line, i) => p.drawText(line, { x: 40, y: 800 - i * 18, size: 10, font }));
    const buffer = Buffer.from(await doc.save());
    await uploadDocument(page, { name: "unreadable-facts.pdf", mimeType: "application/pdf", buffer });
    const done = await waitForProcessed(page, "unreadable-facts.pdf");
    expect(done.processing_status).toBe("failed");
    await page.goto("/policies");
    const card = page.locator(".document-card").filter({ hasText: "unreadable-facts.pdf" }).first();
    await expect(card).toContainText("Analysis stopped");
    await expect(card).toContainText(/Re-analyse/);
    const text = await card.innerText();
    expect(text).not.toMatch(/DeterministicModelUnavailable|stack|Error:/);
    // Still honestly unscanned, still deletable, never "clean".
    expect(done.quarantine_status).toBe("not_scanned_prototype");
  });

  test("11. related documents connect without merging policies or duplicating benefits", async () => {
    test.setTimeout(15 * 60_000);
    // Matching wording booklet for the same product family.
    await uploadDocument(page, { name: "family-shield-wording.pdf", mimeType: "application/pdf", buffer: await wordingPdf("Family-Shield") });
    const wording = await waitForProcessed(page, "family-shield-wording.pdf");
    expect(wording.processing_status).toBe("ready");
    expect(wording.personal_coverage_confirmed).toBe(false);

    // A rider endorsement and a premium notice for the SAME policy number.
    const rider = await certificatePdf({ label: "Family-Shield-Rider", policyNumber: `${PREFIX}-PN-001`, insuredNames: [ALEX], amounts: [20000] });
    await uploadDocument(page, { name: "rider.pdf", mimeType: "application/pdf", buffer: rider });
    expect((await waitForProcessed(page, "rider.pdf")).processing_status).toBe("ready");

    const coveragesBefore = await api<{ coverages: unknown[] }>(page, `/api/policies/${certId}`);

    // An unrelated receipt-style document must not merge into the policy.
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([595, 842]);
    [`${PREFIX} Synthetic Clinic`, "Bill / Receipt", "SYNTHETIC TEST DOCUMENT", `Received from ${ALEX}: SGD 180 for outpatient consultation.`, "This is a medical bill, not an insurance policy."].forEach((line, i) => p.drawText(line, { x: 40, y: 800 - i * 18, size: 10, font }));
    await uploadDocument(page, { name: "medical-bill.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
    const bill = await waitForProcessed(page, "medical-bill.pdf");
    // A bill is never personal policy proof, whatever happens to it.
    expect(bill.personal_coverage_confirmed).toBe(false);

    // The distinct uploads remain distinct documents (no merging)...
    const all = (await policies(page)).policies.map((x) => x.original_filename);
    for (const f of ["certificate.pdf", "family-shield-wording.pdf", "rider.pdf", "medical-bill.pdf"]) expect(all).toContain(f);
    // ...and none of them duplicated the certificate's own benefits.
    const coveragesAfter = await api<{ coverages: unknown[] }>(page, `/api/policies/${certId}`);
    expect(coveragesAfter.body.coverages.length).toBe(coveragesBefore.body.coverages.length);
  });

  test("12. chat answers the ten retrieval questions from the documents, with citations, and never invents missing facts", async () => {
    test.setTimeout(25 * 60_000);
    await page.goto("/chat");
    await page.getByRole("button", { name: "New chat" }).click();

    // Q1 Who is insured? -- answered for the correct member, correct policy.
    const who = await ask(page, `Which policies cover ${ALEX}?`);
    await expect(who).toContainText(new RegExp(ALEX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(who).toContainText(/Family-Shield/);

    // Q2 policy number: stated on the certificate, quoted from it.
    const number = await ask(page, "What is the policy number printed on the certificate?");
    expect(await number.innerText()).toContain(`${PREFIX}-PN-001`);

    // Q7 expiry: the certificate's own expiry sentence is quoted.
    const expiry = await ask(page, "When does the certificate expire? What is the expiry date?");
    expect(await expiry.innerText()).toContain("2027-01-01");

    // Q3 benefits, Q4 sum insured, Q5 currency: from the certificate, cited.
    const benefits = await ask(page, "What benefits are included and what is the sum insured?");
    const benefitsText = await benefits.innerText();
    expect(benefitsText).toMatch(/Critical Illness/i);
    expect(benefitsText).toMatch(/100,000/);
    expect(benefitsText).toMatch(/SGD/);
    expect(benefitsText).not.toMatch(SCAN_CLAIMS);

    // Q6 exclusions / waiting period: quoted from the certificate's own page.
    const waiting = await ask(page, "What is the waiting period for the critical illness benefit?");
    await expect(waiting).toContainText(/90 days/);
    await expect(waiting.locator("details.citations")).toBeVisible();
    await waiting.locator("details.citations summary").click();
    await expect(waiting.locator(".citation").first()).toContainText(/Page 1/);

    const exclusions = await ask(page, "What exclusions apply to this cover?");
    await expect(exclusions).toContainText(/pre-existing/i);

    // Q8 premium.
    const premium = await ask(page, "How much premium is payable each month for this cover?");
    await expect(premium).toContainText(/55/);

    // Q9 endowment maturity: NOT in any uploaded document. The answer must
    // say so and must not fill the gap from general insurance knowledge.
    const maturity = await ask(page, "When does my endowment plan mature and what is the maturity amount?");
    const maturityText = await maturity.innerText();
    expect(maturityText).not.toMatch(/matures on|maturity date is|maturity amount is [A-Z]{3}? ?[\d,]+/i);
    expect(maturityText).toMatch(/no|not|couldn.t|don.t|upload|missing|endowment/i);

    // Q10 claim documents: stated on the certificate page.
    const claimDocs = await ask(page, "What is the list of documents needed to make a claim?");
    await expect(claimDocs).toContainText(/claim form|medical report|certificate/i);

    // OCR provenance is proven in the format-matrix test: a scanned upload
    // has no text layer at all, so reaching a wording classification with
    // its page count preserved is only possible if the OCR transcript was
    // stored and read. Chat retrieval deliberately searches only contracts
    // and their linked reference material, so an unlinked scanned booklet
    // is not quotable here -- and must not be.
  });

  test("13. a deleted document stops being cited; a reopened chat stays safe", async () => {
    test.setTimeout(15 * 60_000);
    // Delete the ambiguous certificate (Bella's) through the UI's two-step delete.
    await page.goto("/policies");
    const card = page.locator(".document-card").filter({ hasText: `${PREFIX}-Ambiguous` }).first();
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    await card.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.locator(".document-card").filter({ hasText: `${PREFIX}-Ambiguous` })).toHaveCount(0, { timeout: 60_000 });

    // A fresh question must not cite the deleted document.
    await page.goto("/chat");
    await page.getByRole("button", { name: "New chat" }).click();
    const after = await ask(page, `Which policies cover ${BELLA}?`);
    const text = await after.innerText();
    expect(text).not.toContain(`${PREFIX}-PN-002`);
    expect(text).not.toContain(`${PREFIX}-Ambiguous`);

    // Reopen the earlier conversation from history: the saved answer is
    // re-served, not silently re-computed into something new.
    const history = await api<{ conversations: { id: string; title: string }[] }>(page, "/api/chat/history?scope=all");
    expect(history.body.conversations.length).toBeGreaterThan(0);
    await page.locator("details.chat-history summary").click();
    await page.locator(".history-open").first().click();
    await expect(page.locator(".message.assistant").first()).toBeVisible({ timeout: 60_000 });
    expect(await page.locator("body").innerText()).not.toMatch(SCAN_CLAIMS);
  });
});

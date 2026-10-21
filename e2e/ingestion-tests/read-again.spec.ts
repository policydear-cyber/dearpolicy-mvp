/**
 * Test engineer, PR #87: "Read again" on a ready document, in a real browser on the synthetic stack (dev identity,
 * household A, fake VirusTotal, deterministic model). Synthetic data only.
 *
 *   two people -> upload a certificate naming two people (one is linked by hand, one is "Not in my family"; the
 *   synthetic extraction block only fits two names) -> the stored role is spoiled to a product summary, as a wrong first read would leave it
 *   -> "Read again" arms only (Cancel leaves it alone) -> "Confirm read again" -> ready again
 *   -> same document id, links kept, the dismissed name still dismissed, the hand-linked name not asked again,
 *      role re-derived as a certificate.
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { certificatePdf, personName, name } from "../support/ingestion-fixtures";

if (process.env.E2E_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } });

type Policy = { id: string; original_filename: string; product_name: string | null; processing_status: string; document_role: string | null; personal_coverage_confirmed: boolean;
  linked_people: { id: string; name: string; source: string }[]; detected_people: { name: string; matchedFamilyMemberId: string | null }[] };

async function api<T = any>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ path, init }) => {
    const headers: Record<string, string> = {};
    if (init?.body) headers["content-type"] = "application/json";
    const res = await fetch(path, { method: init?.method ?? "GET", headers, body: init?.body ? JSON.stringify(init.body) : undefined, cache: "no-store" });
    const text = await res.text();
    let body: unknown = text; try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: body as never };
  }, { path, init });
}
const policies = async (page: Page) => (await api<{ policies: Policy[] }>(page, "/api/policies")).body.policies ?? [];
async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  try { return (await db.query(text, params)).rows as T[]; } finally { await db.end(); }
}

test.describe.serial("Read again on a ready document", () => {
  let page: Page;
  const owner = personName("Rowan"), helper = name("Kit-Profile");
  const printedHelper = personName("Kitty"), stranger = personName("Stranger");
  const file = `${name("read-again")}.pdf`;
  const ids: Record<string, string> = {};
  let doc: Policy;
  const card = () => page.locator(`[data-policy-id="${doc.id}"]`);

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage(); await page.goto("/");
    const started = await api(page, "/api/household/start", { method: "POST", body: { name: name("ReadAgain-Household") } });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
  });
  test.afterAll(async () => {
    if (doc) await api(page, `/api/policies/${doc.id}`, { method: "DELETE" });
    for (const id of Object.values(ids)) await api(page, `/api/family/${id}`, { method: "DELETE" });
  });

  test("set up: a ready certificate, one name linked by hand, one not in the family", async () => {
    await page.goto("/family");
    for (const [who, rel] of [[owner, "spouse"], [helper, "child"]] as const) {
      await page.locator("#fm-new-name").fill(who);
      await page.locator("#fm-new-relationship").selectOption(rel);
      await page.getByRole("button", { name: "+ Add person" }).click();
      await expect(page.locator(".profile-add-panel [role=status]")).toContainText("Profile added");
    }
    for (const m of (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family) if (m.display_name === owner || m.display_name === helper) ids[m.display_name] = m.id;
    expect(Object.keys(ids)).toHaveLength(2);

    await page.goto("/policies");
    const opt = (await page.locator(".upload-form select").first().locator("option").allTextContents()).find((t) => t.includes(owner));
    if (opt) await page.locator(".upload-form select").first().selectOption({ label: opt });
    await page.locator(".upload-form input[type=file]").setInputFiles({ name: file, mimeType: "application/pdf",
      buffer: await certificatePdf({ label: "read-again", policyNumber: "RA-1001", insuredNames: [printedHelper, stranger], amounts: [80000, 60000] }) });
    await page.getByRole("button", { name: /Upload/ }).first().click();
    await expect.poll(async () => (await policies(page)).find((p) => p.original_filename === file)?.processing_status, { timeout: 240_000, intervals: [1500] }).toBe("ready");
    doc = (await policies(page)).find((p) => p.original_filename === file)!;
    expect(doc.document_role).toBe("certificate");

    // Link the second printed name by hand, and answer "Not in my family" for the third, in the card itself.
    await page.goto("/policies");
    await card().locator(`select[id="who-${doc.id}-${printedHelper}"]`).selectOption({ label: helper });
    await expect.poll(async () => (await policies(page)).find((p) => p.id === doc.id)!.linked_people.map((l) => l.id), { timeout: 30_000 }).toContain(ids[helper]);
    await page.goto("/policies");
    await card().locator(`select[id="who-${doc.id}-${stranger}"]`).selectOption("__not_family");
    await expect(page.getByTestId("library-notice")).toContainText("not in your family", { timeout: 30_000 });
    expect(await sql("SELECT 1 FROM policy_name_dismissals WHERE policy_id=$1", [doc.id]), "the dismissal is stored, not device-only").toHaveLength(1);
    await page.reload();
    await expect(card()).toBeVisible();
    await expect(card()).not.toContainText(`“${stranger}” is named in it`);
    await expect(card()).not.toContainText(`“${printedHelper}” is named in it`);
  });

  test("Read again arms only; Cancel leaves the document alone", async () => {
    const before = (await sql<{ u: string }>("SELECT updated_at::text u FROM policies WHERE id=$1", [doc.id]))[0].u;
    await page.goto("/policies");
    await card().getByRole("button", { name: "Read again", exact: true }).click();
    await expect(card().getByRole("button", { name: "Confirm read again" })).toBeVisible();
    await card().getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(card().getByRole("button", { name: "Read again", exact: true })).toBeVisible();
    await page.waitForTimeout(3000);
    const after = await sql<{ u: string; s: string }>("SELECT updated_at::text u,processing_status s FROM policies WHERE id=$1", [doc.id]);
    expect(after[0]).toEqual({ u: before, s: "ready" });
  });

  test("Confirm read again: same document, links and dismissal kept, role re-derived", async () => {
    // A wrong first read, as the button is meant to fix: the type was taken for a product summary.
    await sql("UPDATE policies SET document_role='product_summary' WHERE id=$1", [doc.id]);
    const linksBefore = await sql<{ family_member_id: string; source: string }>("SELECT family_member_id::text,source FROM policy_members WHERE policy_id=$1 ORDER BY family_member_id", [doc.id]);
    await page.goto("/policies");
    await card().getByRole("button", { name: "Read again", exact: true }).click();
    await card().getByRole("button", { name: "Confirm read again" }).click();
    await expect.poll(async () => (await sql<{ r: string; s: string }>("SELECT document_role r,processing_status s FROM policies WHERE id=$1", [doc.id]))[0], { timeout: 240_000, intervals: [1500] })
      .toEqual({ r: "certificate", s: "ready" });

    const all = (await policies(page)).filter((p) => p.original_filename === file);
    expect.soft(all.map((p) => p.id), "one document, the same id").toEqual([doc.id]);
    const now = all[0];
    expect.soft(now.document_role).toBe("certificate");
    const linksAfter = await sql<{ family_member_id: string; source: string }>("SELECT family_member_id::text,source FROM policy_members WHERE policy_id=$1 ORDER BY family_member_id", [doc.id]);
    expect.soft(linksAfter, "every link is kept, with its source").toEqual(linksBefore);
    expect.soft(await sql("SELECT 1 FROM policy_name_dismissals WHERE policy_id=$1", [doc.id]), "the dismissal is kept").toHaveLength(1);
    expect.soft(now.detected_people.map((p) => p.name), "the dismissed name is not offered again").not.toContain(stranger);
    expect.soft(now.detected_people.filter((p) => !p.matchedFamilyMemberId).map((p) => p.name), "no linked name is asked about again").toEqual([]);

    await page.goto("/policies");
    await expect.soft(card()).toContainText("Ready");
    await expect.soft(card()).not.toContainText(`“${stranger}” is named in it`);
    await expect.soft(card()).not.toContainText(`“${printedHelper}” is named in it`);
  });

  test("TE-EXTRA: the 20-an-hour re-read limit refuses the 21st, with the household's message, and leaves the document ready", async () => {
    // The re-read above used one of this household's 20. Every request counts, so 19 more (for a document id that does
    // not exist: no reading is queued) use up the hour.
    const statuses: number[] = [];
    for (let n = 0; n < 19; n++) statuses.push((await api(page, "/api/policies/reprocess", { method: "POST", body: { policyId: "00000000-0000-4000-8000-0000000000" + String(10 + n) } })).status);
    expect(statuses.every((s) => s === 404), `the 19 requests: ${statuses.join(",")}`).toBe(true);
    const before = (await sql<{ u: string }>("SELECT updated_at::text u FROM policies WHERE id=$1", [doc.id]))[0].u;
    const refused = await api<{ error: string }>(page, "/api/policies/reprocess", { method: "POST", body: { policyId: doc.id } });
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/Too many documents read again/);
    // The button shows the refusal and the document stays as it was.
    await page.goto("/policies");
    await card().getByRole("button", { name: "Read again", exact: true }).click();
    await card().getByRole("button", { name: "Confirm read again" }).click();
    await expect(page.getByTestId("library-notice")).toContainText("Too many documents read again", { timeout: 30_000 });
    await page.waitForTimeout(2000);
    expect((await sql<{ u: string; s: string }>("SELECT updated_at::text u,processing_status s FROM policies WHERE id=$1", [doc.id]))[0]).toEqual({ u: before, s: "ready" });
  });
});

test.describe.serial("Read again after a correction: the name moved from one person to another", () => {
  let page: Page;
  const printed = personName("Morgan"), wrong = printed, right = name("Morgan-Real");
  const file = `${name("read-again-fix")}.pdf`;
  const ids: Record<string, string> = {};
  let doc: Policy;
  const card = () => page.locator(`[data-policy-id="${doc.id}"]`);
  const links = async () => sql<{ family_member_id: string; source: string }>("SELECT family_member_id::text,source FROM policy_members WHERE policy_id=$1 ORDER BY family_member_id", [doc.id]);

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage(); await page.goto("/");
    const started = await api(page, "/api/household/start", { method: "POST", body: { name: name("ReadAgainFix-Household") } });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    // The same household as above, whose hour of re-reads the limit test used up: start a fresh hour.
    await sql("DELETE FROM rate_limit_buckets WHERE limiter_name='policy-reprocess'");
  });
  test.afterAll(async () => {
    if (doc) await api(page, `/api/policies/${doc.id}`, { method: "DELETE" });
    for (const id of Object.values(ids)) await api(page, `/api/family/${id}`, { method: "DELETE" });
  });

  test("TE-EXTRA: the reading matches the printed name to A; the household removes A and links the name to B by hand", async () => {
    await page.goto("/family");
    for (const [who, rel] of [[wrong, "spouse"], [right, "child"]] as const) {
      await page.locator("#fm-new-name").fill(who);
      await page.locator("#fm-new-relationship").selectOption(rel);
      await page.getByRole("button", { name: "+ Add person" }).click();
      await expect(page.locator(".profile-add-panel [role=status]")).toContainText("Profile added");
    }
    for (const m of (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family) if (m.display_name === wrong || m.display_name === right) ids[m.display_name] = m.id;
    expect(Object.keys(ids)).toHaveLength(2);
    await page.goto("/policies");
    await page.locator(".upload-form input[type=file]").setInputFiles({ name: file, mimeType: "application/pdf",
      buffer: await certificatePdf({ label: "read-again-fix", policyNumber: "RA-2002", insuredNames: [printed], amounts: [90000] }) });
    await page.getByRole("button", { name: /Upload/ }).first().click();
    await expect.poll(async () => (await policies(page)).find((p) => p.original_filename === file)?.processing_status, { timeout: 240_000, intervals: [1500] }).toBe("ready");
    doc = (await policies(page)).find((p) => p.original_filename === file)!;
    expect((await links()).filter((l) => l.family_member_id === ids[wrong]).map((l) => l.source), "the reading matched the printed name to A").toEqual(["ai_name_match"]);

    // Remove A (the covers picker's save; a document must cover someone, so the save names B), then answer
    // "Who is this?" with B on the card.
    const removed = await api(page, "/api/policies/link-person", { method: "POST", body: { policyId: doc.id, assignments: [{ familyMemberId: ids[right], planTier: null }] } });
    expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300);
    expect((await links()).map((l) => l.family_member_id), "A is removed").not.toContain(ids[wrong]);
    await page.goto("/policies");
    await card().locator(`select[id="who-${doc.id}-${printed}"]`).selectOption({ label: right });
    await expect.poll(async () => (await links()).map((l) => `${l.family_member_id}:${l.source}`), { timeout: 30_000 }).toEqual([`${ids[right]}:user_declared`]);
  });

  test("TE-EXTRA: Read again keeps B, does not bring A back, and does not ask about the name", async () => {
    await sql("UPDATE policies SET document_role='product_summary' WHERE id=$1", [doc.id]);
    await page.goto("/policies");
    await card().getByRole("button", { name: "Read again", exact: true }).click();
    await card().getByRole("button", { name: "Confirm read again" }).click();
    await expect.poll(async () => (await sql<{ r: string; s: string }>("SELECT document_role r,processing_status s FROM policies WHERE id=$1", [doc.id]))[0], { timeout: 240_000, intervals: [1500] })
      .toEqual({ r: "certificate", s: "ready" });
    expect.soft((await links()).map((l) => `${l.family_member_id}:${l.source}`), "only B, as the household's own link").toEqual([`${ids[right]}:user_declared`]);
    const covers = await sql<{ family_member_id: string; amount: string }>("SELECT family_member_id::text,amount::text FROM policy_coverages WHERE policy_id=$1", [doc.id]);
    expect.soft(covers.map((c) => c.family_member_id), "the certificate's cover is B's, not A's").toEqual([ids[right]]);
    const now = (await policies(page)).find((p) => p.id === doc.id)!;
    expect.soft(now.detected_people.map((p) => [p.name, p.matchedFamilyMemberId]), "the printed name stays matched to B").toEqual([[printed, ids[right]]]);
    await page.goto("/policies");
    await expect.soft(card()).not.toContainText(`“${printed}” is named in it`);
  });
});

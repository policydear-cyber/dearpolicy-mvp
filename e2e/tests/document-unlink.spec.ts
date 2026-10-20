/**
 * PR #67: removing a person from a document unlinks them, in a real browser on the synthetic stack (browser-e2e.yml:
 * dev identity, household A, fake VirusTotal, deterministic model). Synthetic data only.
 *
 *   add two people -> upload a wording for the first -> tick the second in "Who does this document cover?"
 *   -> their answer uses the document (control) -> untick them -> reload: still unticked, not linked
 *   -> their answer no longer uses the document; the first person's still does.
 *
 * Fails on main ca6af69: the untick says "Saved" but the reading's own link stays.
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { name, syntheticWordingPdf } from "../support/synthetic";

if (process.env.E2E_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } });

type Policy = { id: string; original_filename: string; product_name: string | null; processing_status: string; linked_people: { id: string; name: string; source?: string }[] };

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
/** Who the picker can show as covered (matching-wording links are not shown there). */
const covered = (p: Policy) => p.linked_people.filter((l) => l.source !== "scheme_reference_match").map((l) => l.id).sort();

test.describe.serial("removing a person from a document", () => {
  let page: Page;
  const owner = name("Unlink-Owner"), other = name("Unlink-Other");
  const label = "unlink-wording", file = `${name(label)}.pdf`, title = `${name(label)} Policy Wording`;
  const ids: Record<string, string> = {};
  let doc: Policy;

  /** A synchronous answer for one person, as JSON text, and whether it cites this document. */
  async function answerFor(personId: string, who: string) {
    const res = await api(page, "/api/chat", { method: "POST", body: { familyMemberId: personId, scope: "member", question: `What does ${who}'s cover pay for a hospital stay?`, asynchronous: false } });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const text = JSON.stringify(res.body);
    return { text, usesDoc: text.includes(doc.id) || text.includes(title) || text.includes(file) };
  }
  /** The covers chip for one person on this document's card; opens the picker first if it is folded to one line. */
  async function chip(who: string) {
    await page.goto("/policies");
    const card = page.locator(".document-card").filter({ hasText: doc.product_name ?? file }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    const change = card.getByTestId("covers-picker").getByRole("button", { name: "Change" });
    if (await change.isVisible().catch(() => false)) await change.click();
    return card.locator(".declare-owner button").filter({ hasText: who }).first();
  }

  test.beforeAll(async ({ browser }) => { page = await (await browser.newContext()).newPage(); await page.goto("/"); });
  test.afterAll(async () => {
    if (doc) await api(page, `/api/policies/${doc.id}`, { method: "DELETE" });
    for (const id of Object.values(ids)) await api(page, `/api/family/${id}`, { method: "DELETE" });
  });

  test("set up: two people and a ready document covering both", async () => {
    await page.goto("/family");
    for (const [who, rel] of [[owner, "spouse"], [other, "child"]] as const) {
      await page.locator("#fm-new-name").fill(who);
      await page.locator("#fm-new-relationship").selectOption(rel);
      await page.getByRole("button", { name: "+ Add person" }).click();
      await expect(page.locator(".profile-add-panel [role=status]")).toContainText("Profile added");
    }
    for (const m of (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family) if (m.display_name === owner || m.display_name === other) ids[m.display_name] = m.id;
    expect(Object.keys(ids)).toHaveLength(2);

    await page.goto("/policies");
    await page.locator(".upload-form select").first().selectOption({ label: `${owner} · spouse` }).catch(async () => {
      const opt = (await page.locator(".upload-form select").first().locator("option").allTextContents()).find((t) => t.includes(owner));
      if (opt) await page.locator(".upload-form select").first().selectOption({ label: opt });
    });
    await page.locator(".upload-form input[type=file]").setInputFiles({ name: file, mimeType: "application/pdf", buffer: await syntheticWordingPdf(label) });
    await page.getByRole("button", { name: /Upload/ }).first().click();
    await expect.poll(async () => (await policies(page)).find((p) => p.original_filename === file)?.processing_status, { timeout: 240_000, intervals: [1500] }).toBe("ready");
    doc = (await policies(page)).find((p) => p.original_filename === file)!;

    // The household ticks the first person. The second is linked the way a reading links a name it matched
    // (policy_members.source 'ai_name_match'), written straight to the local synthetic database: this is the link the
    // old save never removed. The synthetic wording is a reference document, so this stack's reading links nobody itself.
    const ownerChip = await chip(owner);
    if ((await ownerChip.getAttribute("aria-pressed")) !== "true") {
      await ownerChip.click();
      await expect(ownerChip).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    }
    const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
    try {
      const acct = (await db.query<{ account_id: string }>("SELECT account_id FROM policies WHERE id=$1", [doc.id])).rows[0].account_id;
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'ai_name_match',0.95) ON CONFLICT DO NOTHING", [doc.id, ids[other], acct]);
    } finally { await db.end(); }
    await expect(await chip(other)).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await expect.poll(async () => covered((await policies(page)).find((p) => p.id === doc.id)!), { timeout: 30_000 }).toEqual([ids[owner], ids[other]].sort());
  });

  test("control: before the change, the second person's answer uses the document", async () => {
    const a = await answerFor(ids[other], other);
    expect(a.usesDoc, `answer for ${other} before unlinking:\n${a.text.slice(0, 1500)}`).toBe(true);
  });

  test("untick the second person, reload: they stay unlinked and their answers stop using the document", async () => {
    const otherChip = await chip(other);
    await otherChip.click();
    await expect(otherChip).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
    await expect(page.getByTestId("library-notice")).toContainText("Saved", { timeout: 30_000 });

    await page.reload();
    const after = await chip(other);
    await expect(after).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
    await expect(await chip(owner)).toHaveAttribute("aria-pressed", "true");
    expect(covered((await policies(page)).find((p) => p.id === doc.id)!), "after reload the library says the document covers only the first person").toEqual([ids[owner]]);

    const gone = await answerFor(ids[other], other);
    expect(gone.usesDoc, `answer for ${other} after unlinking still uses the document:\n${gone.text.slice(0, 1500)}`).toBe(false);
    const kept = await answerFor(ids[owner], owner);
    expect(kept.usesDoc, `answer for ${owner} after unlinking someone else no longer uses the document:\n${kept.text.slice(0, 1500)}`).toBe(true);
  });
});

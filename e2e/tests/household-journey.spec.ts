/**
 * Synthetic household journey in a real browser. Synthetic data only; see
 * e2e/README.md for the stack and for what this does NOT cover.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page, type Browser } from "@playwright/test";
import { name, syntheticWordingPdf, SYNTHETIC_MALWARE_MARKER, SYNTHETIC_PENDING_MARKER, PREFIX } from "../support/synthetic";

const BASE_B = process.env.E2E_BASE_URL_B ?? "http://localhost:3001";
const FAKE = process.env.E2E_FAKE_SERVICES_URL ?? "http://127.0.0.1:4010";

type Policy = { id: string; original_filename: string; product_name: string | null; processing_status: string; quarantine_status: string; scan_result_detail: string | null; linked_people: { id: string; name: string }[] };

/** API call made FROM the page, so it carries the browser's own origin and
 * session exactly like the app's UI does (the CSRF gate requires both). */
async function api<T = any>(page: Page, path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ path, init }) => {
    const headers: Record<string, string> = { ...(init?.headers ?? {}) };
    if (init?.body) headers["content-type"] = "application/json";
    const res = await fetch(path, { method: init?.method ?? "GET", headers, body: init?.body ? JSON.stringify(init.body) : undefined, cache: "no-store" });
    const text = await res.text();
    let body: unknown = text; try { body = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: res.status, body: body as never };
  }, { path, init });
}

async function policies(page: Page): Promise<Policy[]> { return (await api<{ policies: Policy[] }>(page, "/api/policies")).body.policies ?? []; }
async function waitForPolicy(page: Page, file: string, done: (p: Policy) => boolean, seen: Set<string>, timeoutMs = 180_000): Promise<Policy> {
  const started = Date.now();
  for (;;) {
    const p = (await policies(page)).find((x) => x.original_filename === file);
    if (p) seen.add(`${p.quarantine_status}/${p.processing_status}`);
    if (p && done(p)) return p;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${file}; states seen: ${[...seen].join(" -> ")}`);
    await page.waitForTimeout(1000);
  }
}
const card = (page: Page, p: Policy) => page.locator(".document-card").filter({ hasText: p.product_name ?? p.original_filename });

test.describe.serial("synthetic household journey", () => {
  let page: Page;
  const parent = name("Parent");
  const child = name("Child");
  const files = { a: `${name("wording-A")}.pdf`, b: `${name("wording-B")}.pdf`, bad: `${name("flagged")}.pdf`, pending: `${name("scan-pending")}.pdf` };
  const ids: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    // Live mode only (never in CI): sign in through the real login page.
    if (process.env.E2E_LOGIN_EMAIL_A) {
      await page.goto("/login");
      await page.locator("#dp-email").fill(process.env.E2E_LOGIN_EMAIL_A);
      await page.locator("input[type=password]").fill(process.env.E2E_LOGIN_PASSWORD_A ?? "");
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    }
  });

  test("1-2. the app opens for the synthetic household owner", async () => {
    const res = await page.goto("/");
    expect(res?.status()).toBeLessThan(400);
    const household = await api(page, "/api/household");
    expect(household.status).toBe(200);
    // Every run works only inside a synthetic household. This is also the
    // safety check that stops the final household deletion from ever running
    // against a real household in live mode.
    expect(String(household.body.activeHouseholdName)).toMatch(/^SYNTHETIC-DPTEST-/);
    if (!process.env.E2E_LOGIN_EMAIL_A) expect(String(household.body.activeHouseholdName)).toContain(PREFIX);
  });

  test("3-4. add two synthetic family members through the Family page", async () => {
    await page.goto("/family");
    for (const [who, relationship] of [[parent, "parent"], [child, "child"]] as const) {
      await page.locator(".profile-add-panel input[required]").fill(who);
      await page.locator(".profile-add-panel select").selectOption(relationship);
      await page.getByRole("button", { name: "+ Add person" }).click();
      await expect(page.locator(".profile-add-panel .upload-status")).toHaveText("Profile added.");
    }
    const family = (await api<{ family: { id: string; display_name: string }[] }>(page, "/api/family")).body.family;
    for (const who of [parent, child]) {
      const m = family.find((f) => f.display_name === who);
      expect(m, `${who} was created`).toBeTruthy();
      ids[who] = m!.id;
    }
  });

  test("5-6. upload synthetic PDFs; each is scanned by the VirusTotal adapter and reaches ready, rejected or on-hold", async () => {
    const before = await (await fetch(`${FAKE}/__stats`)).json();
    await page.goto("/policies");
    const uploads: [string, string, Buffer][] = [
      [files.a, `${parent} · parent`, await syntheticWordingPdf("wording-A")],
      [files.b, `${child} · child`, await syntheticWordingPdf("wording-B", ["Second synthetic document for the child profile."])],
      [files.bad, `${parent} · parent`, await syntheticWordingPdf("flagged", [SYNTHETIC_MALWARE_MARKER])],
      [files.pending, `${parent} · parent`, await syntheticWordingPdf("scan-pending", [SYNTHETIC_PENDING_MARKER])],
    ];
    for (const [file, profile, buffer] of uploads) {
      await page.locator(".upload-form select").selectOption({ label: profile });
      await page.locator(".upload-form input[type=file]").setInputFiles({ name: file, mimeType: "application/pdf", buffer });
      await page.getByRole("button", { name: "Upload and read" }).click();
      await expect(page.locator(".upload-panel .upload-status")).toContainText("DearPolicy is reading it now");
    }

    const seenA = new Set<string>(), seenB = new Set<string>(), seenBad = new Set<string>(), seenPending = new Set<string>();
    const a = await waitForPolicy(page, files.a, (p) => p.processing_status === "ready", seenA);
    const b = await waitForPolicy(page, files.b, (p) => p.processing_status === "ready", seenB);
    const bad = await waitForPolicy(page, files.bad, (p) => p.quarantine_status === "scan_rejected", seenBad);
    // The fake never finishes this analysis; the adapter's poll budget runs out and the file must stay held.
    const pending = await waitForPolicy(page, files.pending, (p) => p.quarantine_status === "scan_pending" && !!p.scan_result_detail, seenPending);
    Object.assign(ids, { a: a.id, b: b.id, bad: bad.id, pending: pending.id });
    test.info().annotations.push({ type: "observed states", description: `A: ${[...seenA].join(" -> ")} | B: ${[...seenB].join(" -> ")} | flagged: ${[...seenBad].join(" -> ")} | pending: ${[...seenPending].join(" -> ")}` });

    expect(a.quarantine_status).toBe("scan_clean");
    expect(b.quarantine_status).toBe("scan_clean");
    expect(bad.processing_status).not.toBe("ready");
    expect(pending.processing_status).not.toBe("ready");

    // The REAL adapter was exercised: four submissions reached the fake VirusTotal API with the synthetic key.
    const after = await (await fetch(`${FAKE}/__stats`)).json();
    expect(after.submissions - before.submissions).toBeGreaterThanOrEqual(4);
    expect(after.verdicts.malicious - before.verdicts.malicious).toBeGreaterThanOrEqual(1);
    expect(after.verdicts.pending - before.verdicts.pending).toBeGreaterThanOrEqual(1);
    expect(after.rejectedAuth).toBe(0);

    // What the person sees.
    await page.reload();
    await expect(card(page, a)).toContainText("Ready");
    await expect(card(page, bad)).toContainText("Rejected by malware scan");
    await expect(card(page, pending)).toContainText(/Waiting for malware scan|On hold/);
    await expect(card(page, pending)).not.toContainText("Ready");
    // Provider internals never render.
    await expect(page.locator("body")).not.toContainText(/VirusTotal analysis|malicious=|syn-malicious-/);
  });

  test("7. link each ready policy to the intended family member through the UI", async () => {
    const all = await policies(page);
    for (const [pid, who] of [[ids.a, parent], [ids.b, child]] as const) {
      const p = all.find((x) => x.id === pid)!;
      const c = card(page, p);
      // PR #77: the people chips sit behind the covers picker's "Choose" (or "Change") button; open it first.
      // Was: the chip was clicked directly.
      const opener = c.getByTestId("covers-picker").getByRole("button", { name: /^(?:Change|Choose)$/ });
      // The card renders after the page loads; wait for its picker line before deciding it is already open.
      await c.getByTestId("covers-picker").waitFor({ timeout: 10_000 }).catch(() => {});
      if (await opener.isVisible()) await opener.click();
      await c.getByRole("button", { name: who, exact: true }).click();
      // The confirmation is shown with the library it changed (the library notice), not under the upload form.
      await expect(page.getByTestId("library-notice")).toContainText("Saved");
      // PR #65: the tick is a mark beside the name (aria-hidden), so the chip's state is read from aria-pressed.
      // Was: await expect(c.getByRole("button", { name: `${who} ✓` })).toBeVisible();
      await expect(c.locator(".declare-owner button[aria-pressed=true]").filter({ hasText: who })).toBeVisible();
    }
    const linked = await policies(page);
    expect(linked.find((x) => x.id === ids.a)!.linked_people.map((l) => l.id)).toContain(ids[parent]);
    expect(linked.find((x) => x.id === ids.b)!.linked_people.map((l) => l.id)).toContain(ids[child]);
    expect(linked.find((x) => x.id === ids.a)!.linked_people.map((l) => l.id)).not.toContain(ids[child]);
  });

  test("19. another household cannot discover or act on this household's data", async ({ browser }: { browser: Browser }) => {
    test.skip(!!process.env.E2E_LOGIN_EMAIL_A && !process.env.E2E_BASE_URL_B, "live mode without a second synthetic household");
    const other = await (await browser.newContext({ baseURL: BASE_B })).newPage();
    await other.goto("/policies");
    const theirHousehold = await api(other, "/api/household");
    expect(String(theirHousehold.body.activeHouseholdName)).toContain(`${PREFIX}-Household-B`);
    const theirPolicies = await policies(other);
    expect(theirPolicies.map((p) => p.id)).not.toContain(ids.a);
    const theirFamily = (await api<{ family: { display_name: string }[] }>(other, "/api/family")).body.family ?? [];
    expect(theirFamily.map((f) => f.display_name)).not.toContain(parent);
    await expect(other.locator("body")).not.toContainText(PREFIX + "-wording-A");
    // Acting on a foreign object is indistinguishable from a missing one, and changes nothing.
    const del = await api(other, `/api/policies/${ids.a}`, { method: "DELETE" });
    expect([403, 404]).toContain(del.status);
    const link = await api(other, "/api/policies/link-person", { method: "POST", body: { policyId: ids.a, familyMemberId: ids[parent], declared: true } });
    expect([400, 403, 404]).toContain(link.status);
    const famDel = await api(other, `/api/family/${ids[parent]}`, { method: "DELETE" });
    expect([403, 404]).toContain(famDel.status);
    expect((await policies(page)).map((p) => p.id)).toContain(ids.a);
    await other.context().close();
  });

  test("20. household export through the Household page's download button contains only this household's synthetic data", async () => {
    await page.goto("/household");
    const panel = page.getByTestId("household-export");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /prepare my download/i }).click();
    const link = page.getByTestId("household-export-download");
    await expect(link).toBeVisible({ timeout: 180_000 });
    const exportId = ((await link.getAttribute("href")) ?? "").match(/export\/([0-9a-f-]{36})\/download/)?.[1];
    expect(exportId).toBeTruthy();
    const download = await page.evaluate(async (id) => {
      const res = await fetch(`/api/household/export/${id}/download`, { cache: "no-store" });
      const buf = new Uint8Array(await res.arrayBuffer());
      let text = ""; for (const b of buf) text += String.fromCharCode(b);
      return { status: res.status, type: res.headers.get("content-type"), text };
    }, exportId);
    expect(download.status).toBe(200);
    expect(download.text).toContain(parent);
    expect(download.text).not.toContain(`${PREFIX}-Household-B`);
    // No storage keys, local paths, signed URLs or tokens in what the household downloads.
    expect(download.text).not.toMatch(/"storage_key"|\.e2e-storage|[?&](token|X-Amz-Signature|sig)=|service_role/i);
  });

  test("21-22. delete a policy, a family member and the household; deleted data disappears", async () => {
    await page.goto("/policies");
    const all = await policies(page);
    const bad = all.find((p) => p.id === ids.bad)!;
    const c = card(page, bad);
    await c.getByRole("button", { name: "Delete" }).click();
    await c.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByTestId("library-notice")).toContainText(/Deleted .*no longer used in answers/);
    expect((await policies(page)).map((p) => p.id)).not.toContain(ids.bad);

    // Negative control (PR #77): while the child's document is still in the library, Family refuses to remove them and
    // sends the household to Documents instead; nothing is deleted.
    await page.goto("/family");
    const linkedCard = page.locator(".profile-card").filter({ has: page.locator(`input[value="${child}"]`) });
    await linkedCard.getByRole("button", { name: "Delete" }).click();
    await expect(linkedCard.getByRole("alert")).toContainText(`${child} is still linked to a document`);
    await expect(linkedCard.getByRole("link", { name: "Go to Documents" })).toHaveAttribute("href", "/policies");
    await expect(linkedCard.getByRole("button", { name: /Confirm delete/ })).toHaveCount(0);
    await linkedCard.getByRole("button", { name: "Cancel" }).click();
    expect(((await api<{ family: { id: string }[] }>(page, "/api/family")).body.family ?? []).map((f) => f.id)).toContain(ids[child]);
    await page.goto("/policies");

    // Remove the child's policy, then the child's profile, through the UI.
    const b = (await policies(page)).find((p) => p.id === ids.b)!;
    const cb = card(page, b);
    await cb.getByRole("button", { name: "Delete" }).click();
    await cb.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByTestId("library-notice")).toContainText(/Deleted .*no longer used in answers/);
    // PR #77: the notice above can still be the first deletion's, so wait for this document to leave the library before
    // leaving the page (leaving earlier could cut the request off). Was: went straight to /family.
    await expect.poll(async () => (await policies(page)).map((p) => p.id), { timeout: 30_000 }).not.toContain(ids.b);
    await page.goto("/family");
    const childCard = page.locator(".profile-card").filter({ has: page.locator(`input[value="${child}"]`) });
    await childCard.getByRole("button", { name: "Delete" }).click();
    await childCard.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.locator(".profile-add-panel .upload-status")).toContainText(`Removed ${child}`);
    const familyAfter = (await api<{ family: { id: string }[] }>(page, "/api/family")).body.family ?? [];
    expect(familyAfter.map((f) => f.id)).not.toContain(ids[child]);
    // Deleted data is gone from the policy list the chat and claims read from.
    expect((await policies(page)).map((p) => p.id)).not.toContain(ids.b);

    await page.goto("/household");
    const householdName = String((await api(page, "/api/household")).body.activeHouseholdName);
    await page.getByPlaceholder(householdName, { exact: true }).fill(householdName);
    await page.getByRole("button", { name: "Permanently delete household" }).click();
    // "Permanently delete household" lands on its own confirmation page (app/household/deleted).
    await page.waitForURL((u) => u.pathname === "/household/deleted");
    await expect(page.getByTestId("household-deleted")).toContainText("Your household has been deleted.");
    const after = await api(page, "/api/policies");
    expect(after.status).toBe(404);
    const fam = await api(page, "/api/family");
    expect(JSON.stringify(fam.body)).not.toContain(parent);
    // Deleting the household removes its saved chat answers and claim
    // estimates: none can be reopened as current cover.
    const statePath = path.resolve(".e2e-state.json");
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { factualConversationId?: string; claimConversationId?: string; claimId?: string };
      for (const id of [state.factualConversationId, state.claimConversationId].filter(Boolean)) {
        const res = await api(page, `/api/chat/history/${id}`);
        expect([401, 403, 404], `saved chat ${id}`).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toMatch(/Living Care|Critical Illness Plan|90 days/);
      }
      if (state.claimId) expect([401, 403, 404]).toContain((await api(page, `/api/claims/${state.claimId}/indicative`)).status);
    }
  });
});

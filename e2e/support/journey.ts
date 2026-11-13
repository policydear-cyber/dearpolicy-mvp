/**
 * Shared helpers for the owner/reviewer browser journey (e2e/auth-tests).
 * Synthetic data only. The app under test runs with REAL Supabase Auth code
 * pointed at the test-only stand-in (e2e/support/fake-auth.mjs); nothing
 * here can reach a real Auth project, database or storage bucket.
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PREFIX, SYNTHETIC_MALWARE_MARKER } from "./synthetic";

export const FAKE_AUTH = process.env.E2E_FAKE_AUTH_URL ?? "http://127.0.0.1:4020";
export const FAKE_SERVICES = process.env.E2E_FAKE_SERVICES_URL ?? "http://127.0.0.1:4010";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "synthetic-e2e-anon-key";
const SERVICE_KEY = process.env.FAKE_AUTH_SERVICE_KEY ?? "synthetic-e2e-service-role-key";

/** Every synthetic account's email carries the run prefix; cleanup deletes
 * only accounts whose email contains it. */
export const emailFor = (role: string) => `${PREFIX.toLowerCase()}-${role}@example.test`;
/** A fresh random password per account, held in memory only -- never
 * printed, logged or written to disk. */
export const newPassword = () => `Syn-${randomBytes(18).toString("base64url")}`;

export const FORBIDDEN = /potential payout|potential reimbursement|claimable amount|expected payout|estimated settlement|amount you will receive|approved amount|estimated claim amount/i;
export const MONEY = /(?:S\$|US\$|SGD|USD)\s?\d/;
export const INDICATIVE_NOTICE = "Indicative estimate based on the policies, facts and reviewed evidence currently on file. The insurer determines eligibility and the final amount after assessment.";

/** API call with the page's own session cookie and the app's own origin
 * (the CSRF gate requires both), exactly as the app's UI sends it. Uses the
 * browser context's request client rather than an in-page fetch, so a page
 * that is mid-navigation cannot swallow the request. */
export async function api<T = any>(page: Page, path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T }> {
  const base = process.env.E2E_AUTH_BASE_URL ?? "http://localhost:3100";
  const url = new URL(path, base).toString();
  const headers: Record<string, string> = { origin: new URL(base).origin, ...(init?.headers ?? {}) };
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  const send = () => page.context().request.fetch(url, {
    method: init?.method ?? "GET", headers, data: init?.body !== undefined ? JSON.stringify(init.body) : undefined, maxRedirects: 0, timeout: 120_000,
  });
  let res;
  try {
    res = await send();
  } catch (error) {
    // Playwright's request error includes the full request, session cookie
    // and all: never let that reach a log. A connection reset (the local dev
    // server restarting its worker under memory pressure) is retried once,
    // after the server answers its health check again, for idempotent reads only.
    const first = String(error instanceof Error ? error.message : error).split("\n")[0];
    if (!/ECONNRESET|socket hang up|ECONNREFUSED/.test(first) || (init?.method ?? "GET") !== "GET") throw new Error(`api ${init?.method ?? "GET"} ${path}: ${first}`);
    await waitForAppHealthy();
    try { res = await send(); } catch (again) { throw new Error(`api GET ${path}: ${String(again instanceof Error ? again.message : again).split("\n")[0]}`); }
  }
  const text = await res.text();
  let body: unknown = text; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status(), body: body as T };
}

/** Records a synthetic household id for the global teardown, which must
 * find the stored files of households the journey deletes in the app
 * (their database rows are gone by then). Identifiers only. */
export const RUN_HOUSEHOLDS_FILE = path.resolve(".e2e-auth-households");
export function recordHousehold(id: string | null | undefined) {
  if (id && /^[0-9a-f-]{36}$/.test(id)) appendFileSync(RUN_HOUSEHOLDS_FILE, `${id}\n`);
}

/** The Next.js development-mode indicator floats over the bottom-left of the
 * page and would intercept taps on the phone layout's bottom navigation. It
 * does not exist in production builds; remove it in tests whenever it is
 * (re)attached. */
export async function hideDevOverlay(page: Page) {
  await page.addInitScript(() => {
    const strip = () => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove());
    new MutationObserver(strip).observe(document, { childList: true, subtree: true });
    strip();
  });
}

async function waitForAppHealthy() {
  const base = process.env.E2E_AUTH_BASE_URL ?? "http://localhost:3100";
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(new URL("/api/health", base))).ok) return; } catch { /* restarting */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** The local `next dev` server restarts its worker under memory pressure on
 * small machines; a navigation that hits that restart is retried once after
 * the server is healthy again. Assertions are never retried. */
export function hardenNavigation(page: Page): Page {
  const original = page.goto.bind(page);
  page.goto = (async (url: string, options?: Parameters<Page["goto"]>[1]) => {
    try {
      return await original(url, options);
    } catch (error) {
      if (!/ERR_CONNECTION_(RESET|REFUSED)|ERR_EMPTY_RESPONSE|ERR_CONNECTION_CLOSED/.test(String(error))) throw error;
      await waitForAppHealthy();
      return original(url, options);
    }
  }) as Page["goto"];
  return page;
}

// ---- the test-only Auth stand-in ------------------------------------------------
export async function outboxLink(email: string): Promise<string> {
  const r = await (await fetch(`${FAKE_AUTH}/__test/outbox?email=${encodeURIComponent(email)}`)).json();
  if (!r.latest?.link) throw new Error("no confirmation email was sent");
  return r.latest.link as string;
}
export async function authUserId(email: string): Promise<string> {
  const r = await fetch(`${FAKE_AUTH}/__test/users?email=${encodeURIComponent(email)}`);
  if (!r.ok) throw new Error("synthetic auth user not found");
  return (await r.json()).id as string;
}
export async function expireSessions(email: string): Promise<number> {
  return (await (await fetch(`${FAKE_AUTH}/__test/expire?email=${encodeURIComponent(email)}`, { method: "POST" })).json()).expired;
}
export async function fakeAuthStats(): Promise<Record<string, number>> {
  return (await fetch(`${FAKE_AUTH}/__test/stats`)).json();
}

/** The operator procedure: an auto-confirmed synthetic user created through
 * the Supabase Auth Admin API (supabase-js, service key), as the human-
 * assisted live procedure does -- here against the local stand-in. */
export async function adminCreateUser(email: string, password: string): Promise<string> {
  if (!email.includes(PREFIX.toLowerCase())) throw new Error("refusing to create a user outside this run's synthetic namespace");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(FAKE_AUTH, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`admin createUser failed: ${error?.message ?? "no user"}`);
  if (data.user.email !== email) throw new Error("admin createUser returned a different email");
  return data.user.id;
}
export async function adminDeleteSyntheticUsers(): Promise<{ deleted: number; refused: number }> {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(FAKE_AUTH, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`admin listUsers failed: ${error.message}`);
  let deleted = 0, refused = 0;
  for (const user of data.users) {
    // Refuse to delete anything whose email lacks this run's exact identifier.
    if (!(user.email ?? "").includes(PREFIX.toLowerCase())) { refused++; continue; }
    const { error: delError } = await admin.auth.admin.deleteUser(user.id);
    if (delError) throw new Error(`admin deleteUser failed: ${delError.message}`);
    deleted++;
  }
  return { deleted, refused };
}
void ANON_KEY;

// ---- the sign-up, confirmation and sign-in UI -----------------------------------
export async function signUpThroughUi(page: Page, args: { email: string; password: string; household: string }) {
  await page.goto("/signup");
  await page.getByLabel("Household name (optional)").fill(args.household);
  await page.getByLabel("Email").fill(args.email);
  await page.getByLabel("Password").fill(args.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Open the link we sent to finish creating your account");
}
export async function signInThroughUi(page: Page, email: string, password: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.locator("#dp-email").fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  // The login page navigates and then refreshes; let both settle before the
  // caller issues requests from this page.
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}
export async function signOutThroughUi(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 60_000 });
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

// ---- synthetic documents --------------------------------------------------------
/** A synthetic specialist memo whose page carries its own synthetic
 * extraction for the deterministic reader. `withExtraction: false` gives a
 * memo the reader cannot read (the extraction-failure path). */
export async function syntheticMemo(patientName: string, opts: { extraLines?: string[]; withExtraction?: boolean; tag?: string } = {}): Promise<Buffer> {
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
  const extra = opts.extraLines ?? [];
  const lines = [`Specialist memo. SYNTHETIC TEST DOCUMENT ${opts.tag ?? ""}. Patient: ${patientName}.`, `Hospital case number ${PREFIX}-CASE-0001.`, `Diagnosis: ${DIAGNOSIS}. Date of diagnosis 2026-06-01.`, ...extra];
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 790 - i * 20, size: 10, font }));
  if (opts.withExtraction !== false) {
    const encoded = `DPTEST-EXTRACTION:${Buffer.from(JSON.stringify(payload)).toString("base64")}:DPTEST-END`;
    (encoded.match(/.{1,110}/g) ?? []).forEach((chunk, i) => page.drawText(chunk, { x: 20, y: 700 - i * 9, size: 7, font }));
  }
  const bytes = Buffer.from(await doc.save());
  const markers = extra.filter((l) => l === SYNTHETIC_MALWARE_MARKER);
  return markers.length ? Buffer.concat([bytes, Buffer.from(markers.map((m) => `\n%${m}\n`).join(""), "latin1")]) : bytes;
}
/** Starts like a PDF (passes the upload's magic-byte check) but cannot be
 * parsed: the document-reading failure path. */
export function unreadablePdf(label: string): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.7\n", "latin1"), Buffer.from(`${PREFIX}-${label} synthetic unreadable body `.repeat(40), "latin1"), randomBytes(512)]);
}

// ---- operator procedures (local synthetic database only) ------------------------
export function operator(script: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error("operator procedures run against the local synthetic database only");
  return execFileSync("node", ["--import", "tsx", script, ...args], { encoding: "utf8", env: { ...process.env, ...extraEnv } });
}
export const reviewerAdmin = (args: string[]) => operator("scripts/claim-reviewer-admin.ts", args);

/** Page-level checks that must hold on every screen of the journey. */
export async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${where}: no horizontal page scroll`).toBeLessThanOrEqual(1);
}

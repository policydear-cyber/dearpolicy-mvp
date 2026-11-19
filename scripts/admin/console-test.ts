/**
 * Admin console (/admin): who may open it, and what it reads.
 *
 *   npm run -s admin:console-test
 *
 * Offline: PGlite with the production schema and made-up households (no network, no keys). Covers:
 * - the allow-list: unset means nobody; an unconfirmed address, another address, a signed-out visitor are refused;
 *   case and spaces don't matter; the guard on every page and the layout gives "page not found" to anyone else;
 * - the data: counts per household, read and unreadable documents, deleted households and documents left out,
 *   another household's documents never counted, a household that isn't there is not found, tables not set up yet
 *   (plans, auth) show as unavailable instead of failing;
 * - what is never read or shown: file names, storage keys, policy numbers, document text, chat text and the raw
 *   failure detail (the rendered pages are checked for planted markers).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

process.env.DEV_AUTH_ENABLED = "1";
const A = "00000000-0000-0000-0000-0000000ad0a1", B = "00000000-0000-0000-0000-0000000ad0b2", GONE = "00000000-0000-0000-0000-0000000ad0c3";
const USER_A = "71000000-0000-4000-8000-000000000001", USER_A2 = "71000000-0000-4000-8000-000000000002", USER_B = "71000000-0000-4000-8000-000000000003";
const PERSON_A = "72000000-0000-4000-8000-000000000001", PERSON_B = "72000000-0000-4000-8000-000000000002", PERSON_GONE = "72000000-0000-4000-8000-000000000003";
const pid = (n: number) => "73000000-0000-4000-8000-" + String(n).padStart(12, "0");
const MARKERS = ["SECRET-FILENAME-MARKER", "SECRET-STORAGE-MARKER", "SECRET-POLICYNO-MARKER", "SECRET-DETAIL-MARKER", "SECRET-CHAT-MARKER", "SECRET-EXTRACT-MARKER"];

const user = (email: string | null, confirmed = true) => ({ id: USER_A, email, emailConfirmedAt: confirmed ? "2026-11-01T00:00:00Z" : null, lastSignInAt: null });

test("the allow-list fails closed and matches confirmed addresses only", async () => {
  const { adminEmails, isAdminUser } = await import("@/lib/admin/access");
  assert.equal(adminEmails({} as unknown as NodeJS.ProcessEnv).size, 0);
  assert.equal(isAdminUser(user("owner@example.com"), {} as unknown as NodeJS.ProcessEnv), false, "unset: nobody");
  assert.equal(isAdminUser(user("owner@example.com"), { ADMIN_EMAILS: " , " } as unknown as NodeJS.ProcessEnv), false, "empty: nobody");
  const env = { ADMIN_EMAILS: " Owner@Example.com , second@example.org,not-an-address" } as unknown as NodeJS.ProcessEnv;
  assert.deepEqual([...adminEmails(env)].sort(), ["owner@example.com", "second@example.org"]);
  assert.equal(isAdminUser(user("owner@example.com"), env), true);
  assert.equal(isAdminUser(user("OWNER@EXAMPLE.COM"), env), true, "case doesn't matter");
  assert.equal(isAdminUser(user("owner@example.com", false), env), false, "an unconfirmed address is refused");
  assert.equal(isAdminUser(user("someone@example.com"), env), false, "another address is refused");
  assert.equal(isAdminUser(user("owner@example.com.evil.test"), env), false, "no partial match");
  assert.equal(isAdminUser(user(null), env), false);
  assert.equal(isAdminUser(null, env), false, "signed out");
});

const isNotFound = (e: unknown) => {
  const err = e as { digest?: string; message?: string };
  return String(err?.digest ?? err?.message ?? "").includes("NEXT_HTTP_ERROR_FALLBACK;404") || String(err?.message ?? "").includes("NEXT_NOT_FOUND");
};

test("the guard gives 'page not found' to anyone not on the list", async () => {
  const { requireAdminOrNotFound } = await import("@/lib/admin/access");
  delete process.env.ADMIN_EMAILS;
  await assert.rejects(requireAdminOrNotFound(), isNotFound, "unset: not found");
  process.env.ADMIN_EMAILS = "owner@example.com";
  await assert.rejects(requireAdminOrNotFound(), isNotFound, "the dev session's address isn't on the list");
  process.env.ADMIN_EMAILS = "owner@example.com, dev@localhost";
  assert.equal((await requireAdminOrNotFound()).email, "dev@localhost");
  delete process.env.ADMIN_EMAILS;
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
}

test("every admin page and the layout check the allow-list themselves", () => {
  const files = filesUnder("app/admin").filter((f) => /(page|layout)\.tsx$/.test(f));
  assert.ok(files.length >= 3, files.join(", "));
  for (const f of files) assert.match(readFileSync(f, "utf8"), /await requireAdminOrNotFound\(\)/, `${f} calls requireAdminOrNotFound()`);
  // No API route: the console is server-rendered pages only, so there is nothing a browser can call for its data.
  assert.equal(filesUnder("app/api").some((f) => f.includes(`${path.sep}admin${path.sep}`)), false);
});

test("the console's queries never select contents, file names or raw error text", () => {
  const src = readFileSync("lib/admin/console.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const column of ["original_filename", "storage_key", "policy_number", "extracted_json", "reading_cache", "processing_error", "processing_message",
    "last_error_message", "answer_json", "citations", "scan_result_detail", "display_name", "date_of_birth", "notes", "payload"]) {
    assert.doesNotMatch(src, new RegExp(`\\b${column}\\b`), `${column} is never read`);
  }
  assert.doesNotMatch(src, /\bdetail\b/, "the raw failure detail is never read");
  assert.doesNotMatch(src, /\bm\.content\b|\bcontent\b/, "chat text is never read");
});

// ---- Database --------------------------------------------------------------------------------------------------

let ready: Promise<import("@electric-sql/pglite").PGlite> | null = null;
async function database(withAuth: boolean) {
  ready ??= (async () => {
    const { installDatabase } = await import("../r6/fixture");
    const db = await installDatabase();
    if (withAuth) {
      await db.exec(`CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz NOT NULL DEFAULT now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz);`);
    }
    await db.query("INSERT INTO accounts(id,name) VALUES($1,'Tan household'),($2,'Lim household'),($3,'Gone household')", [A, B, GONE]);
    await db.query("UPDATE accounts SET lifecycle_state='soft_deleted' WHERE id=$1", [GONE]);
    await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')", [A, USER_A, USER_A2, B, USER_B]);
    await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Tan Mei Ling','self'),($3,$4,'Lim Wei Jie','self'),($5,$6,'Gone Person','self')",
      [PERSON_A, A, PERSON_B, B, PERSON_GONE, GONE]);
    const add = (n: number, account: string, person: string, status: string, opts: { superseded?: boolean; deleted?: boolean } = {}) => db.query(
      `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,original_filename,storage_key,file_hash,processing_status,quarantine_status,superseded_at,extracted_json,processing_error)
       VALUES($1,$2,$3,'Example Insurance','Example Shield','SECRET-POLICYNO-MARKER',$4,'SECRET-STORAGE-MARKER',$5,$6,'scan_clean',$7,'{"x":"SECRET-EXTRACT-MARKER"}'::jsonb,'SECRET-DETAIL-MARKER')`,
      [pid(n), account, person, `SECRET-FILENAME-MARKER-${n}.pdf`, `h-${n}`, status, opts.superseded ? new Date() : null])
      .then(() => opts.deleted ? db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [pid(n)]) : undefined);
    await add(1, A, PERSON_A, "ready");
    await add(2, A, PERSON_A, "ready");
    await add(3, A, PERSON_A, "failed");
    await add(4, A, PERSON_A, "queued");
    await add(5, A, PERSON_A, "ready", { superseded: true });
    await add(6, A, PERSON_A, "ready", { deleted: true });
    for (let n = 20; n < 23; n++) await add(n, B, PERSON_B, "ready");
    await add(30, GONE, PERSON_GONE, "ready");
    await db.query(`INSERT INTO processing_failure_diagnostics(account_id,resource_type,resource_id,failure_code,error_class,detail) VALUES($1,'policy_document',$2,'extraction_failed','ProviderError','SECRET-DETAIL-MARKER')`, [A, pid(3)]);
    await db.query(`INSERT INTO chat_conversations(id,account_id,family_member_id,title) VALUES($1,$2,$3,'t')`, [pid(90), A, PERSON_A]).catch(() => undefined);
    await db.query(`INSERT INTO chat_messages(account_id,family_member_id,role,content,conversation_id) VALUES($1,$2,'user','SECRET-CHAT-MARKER',$3),($1,$2,'user','SECRET-CHAT-MARKER',$3)`, [A, PERSON_A, pid(90)]).catch(() => undefined);
    if (withAuth) {
      await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at,last_sign_in_at) VALUES($1,'tan@example.com',now(),now()),($2,'tan2@example.com',NULL,NULL),($3,'lim@example.com',now(),now())`, [USER_A, USER_A2, USER_B]);
    }
    return db;
  })();
  return ready;
}

test("households: counts per household, deleted ones left out, plans table not set up yet", async () => {
  await database(true);
  const C = await import("@/lib/admin/console");
  const list = await C.readHouseholds();
  assert.ok(list.ok, JSON.stringify(list));
  if (!list.ok) return;
  // Other test setups (CI's dev account) may add households of their own; only ours are checked here.
  const ids = list.data.rows.map((h) => h.id);
  assert.ok(ids.includes(A) && ids.includes(B), "both active households are listed");
  assert.ok(!ids.includes(GONE), "the deleted household is left out");
  const a = list.data.rows.find((h) => h.id === A)!;
  assert.deepEqual([a.members, a.people, a.documents, a.documentsRead, a.documentsUnreadable, a.documentsInProgress], [2, 1, 4, 2, 1, 1],
    "replaced and deleted documents don't count; another household's never do");
  assert.equal(a.ownerEmail, "tan@example.com");
  assert.equal(a.plan, "free");
  assert.equal(list.data.plansStored, false);
  const b = list.data.rows.find((h) => h.id === B)!;
  assert.deepEqual([b.documents, b.documentsRead, b.documentsUnreadable], [3, 3, 0]);

  const totals = await C.readTotals();
  assert.ok(totals.ok);
  if (totals.ok) {
    // Totals agree with the per-household rows (which already prove replaced, deleted and other households' documents drop out).
    const rows = list.data.rows;
    const sum = (f: (h: (typeof rows)[number]) => number) => rows.reduce((n, h) => n + f(h), 0);
    assert.equal(totals.data.households, rows.length);
    assert.deepEqual([totals.data.documents, totals.data.documentsRead, totals.data.documentsUnreadable, totals.data.documentsInProgress],
      [sum((h) => h.documents), sum((h) => h.documentsRead), sum((h) => h.documentsUnreadable), sum((h) => h.documentsInProgress)],
      "the deleted household's document isn't in the totals");
    assert.ok(totals.data.documents >= 7);
    assert.deepEqual([totals.data.accounts, totals.data.confirmedAccounts, totals.data.signups7d], [3, 2, 3]);
  }
  const days = await C.readSignupsByDay();
  assert.ok(days.ok);
  if (days.ok) {
    assert.equal(days.data.length, 14);
    assert.equal(days.data.reduce((n, d) => n + d.households, 0), list.data.rows.length, "only active households");
    assert.equal(days.data.reduce((n, d) => n + (d.accounts ?? 0), 0), 3);
  }
});

test("one household: not found for another id, a deleted one or a non-id; documents metadata only", async () => {
  await database(true);
  const C = await import("@/lib/admin/console");
  assert.equal(await C.readHouseholdDetail("not-an-id"), null);
  assert.equal(await C.readHouseholdDetail("00000000-0000-0000-0000-0000000ad0ff"), null);
  assert.equal(await C.readHouseholdDetail(GONE), null, "a deleted household isn't shown");
  const d = await C.readHouseholdDetail(A);
  assert.equal(d?.name, "Tan household");
  const docs = await C.readHouseholdDocuments(A);
  assert.ok(docs.ok);
  if (docs.ok) {
    assert.equal(docs.data.length, 5, "current and replaced, not deleted, never another household's");
    assert.ok(docs.data.every((x) => !JSON.stringify(x).includes("SECRET")));
  }
  const members = await C.readHouseholdMembers(A);
  assert.ok(members.ok);
  if (members.ok) assert.deepEqual(members.data.map((m) => [m.email, m.role, m.confirmed]), [["tan@example.com", "owner", true], ["tan2@example.com", "member", false]]);
  const failures = await C.readHouseholdFailures(A);
  assert.ok(failures.ok);
  if (failures.ok) assert.deepEqual(failures.data.map((f) => [f.failureCode, f.errorClass]), [["extraction_failed", "ProviderError"]]);
  const none = await C.readHouseholdFailures(B);
  assert.ok(none.ok && none.data.length === 0, "another household's failures never show");
});

test("the rendered pages show no file names, storage keys, policy numbers, contents or raw failure text", async () => {
  await database(true);
  process.env.ADMIN_EMAILS = "dev@localhost";
  try {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const overview = (await import("@/app/admin/page")).default;
    const household = (await import("@/app/admin/households/[id]/page")).default;
    const html1 = renderToStaticMarkup(await overview());
    const html2 = renderToStaticMarkup(await household({ params: Promise.resolve({ id: A }) }));
    for (const html of [html1, html2]) for (const m of MARKERS) assert.ok(!html.includes(m), `${m} is not on the page`);
    assert.match(html1, /Tan household/);
    assert.match(html1, /tan@example\.com/);
    assert.match(html1, /extraction_failed/);
    assert.match(html2, /Example Shield/);
    assert.match(html2, /Couldn’t be read/);
    await assert.rejects(household({ params: Promise.resolve({ id: GONE }) }), isNotFound, "a deleted household is not found");
    delete process.env.ADMIN_EMAILS;
    await assert.rejects(overview(), isNotFound, "the page itself refuses when the allow-list doesn't match");
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
});

test("times from the database show in Singapore time", async () => {
  const { when } = await import("@/lib/admin/format");
  assert.equal(when("2026-11-18 16:49:58.123+00"), "19 Nov 2026, 00:49");
  assert.equal(when("2026-11-18T16:49:58Z"), "19 Nov 2026, 00:49");
  assert.equal(when("2026-11-18 16:49:58+0530"), "18 Nov 2026, 19:19");
  assert.equal(when(null), "—");
  assert.equal(when("not a date"), "—");
});

test("Test engineer findings on #553: id case, members without an account row, deleted households, missing tables", async () => {
  const db = await database(true);
  const C = await import("@/lib/admin/console");
  const { pseudonymizeId } = await import("@/lib/telemetry/pseudonymize");
  const { ensureProvenanceSchema } = await import("@/lib/ai/provenance");
  await ensureProvenanceSchema();
  await db.query(`INSERT INTO model_executions(correlation_id,attempt_group_id,operation,role,household_ref,requested_provider,requested_model,requested_capability,requested_at,resolved_provider,status,cost_usd)
    VALUES('c',gen_random_uuid(),'chat_reply','chat',$1,'anthropic','m','text',now(),'anthropic','succeeded',0.5)`, [pseudonymizeId(A)]);

  // An upper-case id in the address still finds the household's spend (F3).
  process.env.ADMIN_EMAILS = "dev@localhost";
  try {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const household = (await import("@/app/admin/households/[id]/page")).default;
    const html = renderToStaticMarkup(await household({ params: Promise.resolve({ id: A.toUpperCase() }) }));
    assert.match(html, /US\$0\.50/, "spend shown for an upper-case id");
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
  const list = await C.readHouseholds();
  assert.ok(list.ok && list.data.rows.find((h) => h.id === A)!.spendUsd === 0.5);

  // A member with no Supabase Auth row shows "—", not "Not yet" (F4).
  const ghost = "71000000-0000-4000-8000-0000000000ff";
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'member')", [B, ghost]);
  const members = await C.readHouseholdMembers(B);
  assert.ok(members.ok);
  if (members.ok) assert.equal(members.data.find((m) => m.email === null)?.confirmed, null);

  // Newest accounts never link to a deleted household (F6).
  const gone = "71000000-0000-4000-8000-0000000000ee";
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'gone@example.com',now())", [gone]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [GONE, gone]);
  const recent = await C.readRecentSignups();
  assert.ok(recent.ok && recent.data);
  if (recent.ok && recent.data) assert.equal(recent.data.find((u) => u.email === "gone@example.com")?.householdId, null);

  // Limits on and the question-count table missing: "not available", never a made-up 0 (F7).
  process.env.DEARPOLICY_PLAN_LIMITS = "on";
  try {
    const q = await C.readHouseholdQuestions(A);
    assert.equal(q.ok, false);
  } finally {
    delete process.env.DEARPOLICY_PLAN_LIMITS;
  }

  // No model_executions table: usage shows "not set up" and the page view does not create it (F5).
  await db.exec("ALTER TABLE model_executions RENAME TO model_executions_moved");
  try {
    const usage = await C.readHouseholdUsage(A);
    assert.equal(usage.ok, false);
    const back = (await db.query<{ present: boolean }>("SELECT to_regclass('public.model_executions') IS NOT NULL AS present")).rows[0];
    assert.equal(back?.present, false, "no table was created by reading");
  } finally {
    await db.exec("ALTER TABLE model_executions_moved RENAME TO model_executions");
  }

  // No chat tables: the households list still shows (cosmetic note from the Test engineer).
  await db.exec("ALTER TABLE chat_messages RENAME TO chat_messages_moved");
  try {
    const l = await C.readHouseholds();
    assert.ok(l.ok, "households list survives a missing chat table");
  } finally {
    await db.exec("ALTER TABLE chat_messages_moved RENAME TO chat_messages");
  }
});

test("Test engineer re-check on #553: no DDL on a usage view; the overview shows — when the questions table is missing", async () => {
  const db = await database(true);
  const C = await import("@/lib/admin/console");
  const { ensureProvenanceSchema } = await import("@/lib/ai/provenance");
  await ensureProvenanceSchema();
  // A: with the table there, a fresh server instance's first household view must not run the schema script.
  await db.exec("DROP INDEX IF EXISTS idx_model_executions_correlation");
  (globalThis as { __dearpolicyProvenanceSchema?: unknown }).__dearpolicyProvenanceSchema = undefined;
  const usage = await C.readHouseholdUsage(A);
  assert.ok(usage.ok);
  const idx = (await db.query<{ present: boolean }>("SELECT to_regclass('public.idx_model_executions_correlation') IS NOT NULL AS present")).rows[0];
  assert.equal(idx?.present, false, "the usage read ran no CREATE INDEX");

  // B: limits off and no chat table, or limits on and no count table: "—", never 0.
  await db.exec("ALTER TABLE chat_messages RENAME TO chat_messages_moved");
  try {
    const l = await C.readHouseholds();
    assert.ok(l.ok && !l.data.questionsAvailable && l.data.rows.every((h) => h.questionsThisMonth === null));
  } finally {
    await db.exec("ALTER TABLE chat_messages_moved RENAME TO chat_messages");
  }
  process.env.DEARPOLICY_PLAN_LIMITS = "on";
  try {
    const l = await C.readHouseholds();
    assert.ok(l.ok && !l.data.questionsAvailable && l.data.rows.every((h) => h.questionsThisMonth === null));
  } finally {
    delete process.env.DEARPOLICY_PLAN_LIMITS;
  }
  const ok = await C.readHouseholds();
  assert.ok(ok.ok && ok.data.questionsAvailable && ok.data.rows.find((h) => h.id === A)!.questionsThisMonth === 2, "with the chat table, A's two questions show");
});

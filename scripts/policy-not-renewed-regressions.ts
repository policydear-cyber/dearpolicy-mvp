/** Scripted database tests for "I didn't renew it" (sql/policy-not-renewed.sql, lib/policies/not-renewed.ts,
 * app/api/policies/dates and ./not-renewed, Home's cards in app/api/dashboard, and the library sent to chat), on a throwaway
 * in-memory Postgres (PGlite) with every migration applied in the runbook's order. Two made-up households.
 *
 * Covers: before the file is applied (no answer offered, writes refused, nothing else changes); the owner answers for a
 * policy whose printed end date has passed, and Home's cards leave it out of current cover while the chat library says so;
 * Undo puts it back; a member (not the owner) may not answer; an answer for a policy whose date has not passed, another
 * person's policy or another household is refused; a renewal receipt after the date wins over the answer; and browser
 * roles can read only their own household's answers and write none.
 *   npm run -s policies:not-renewed-test */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE|BENEFIT_TABLE/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

const MIGRATIONS = [
  "sql/schema.sql", "sql/benefit-catalog.sql", "sql/cover-conditions.sql", "sql/coverage-ledger.sql", "sql/model-usage.sql",
  "sql/chat-upgrade.sql", "sql/claim-composition.sql", "sql/claim-evidence.sql", "sql/critical-illness.sql", "sql/disability.sql",
  "sql/model-provenance.sql", "sql/rate-limit.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/claim-reviewers.sql",
  "sql/processing-failure-diagnostics.sql", "sql/storage-purge.sql", "sql/household-rls.sql", "sql/infrastructure-rls.sql",
  "sql/policy-member-exclusions.sql", "sql/detected-name-dismissals.sql",
];

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function main() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(`
    CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;`);
  for (const file of MIGRATIONS) await db.exec(await readFile(path.resolve(file), "utf8"));

  let lock = Promise.resolve();
  const serial = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = lock; let release!: () => void; lock = new Promise<void>((r) => { release = r; });
    await prev; try { return await fn(); } finally { release(); }
  };
  const run = async (text: string, params: unknown[] = []) => {
    if (!params.length) { const res = await db.exec(text); const last = res[res.length - 1]; return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number })?.affectedRows ?? last?.rows?.length ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  pool.query = ((text: string, params: unknown[] = []) => serial(() => run(text, params))) as typeof pool.query;
  // A transaction holds the lock from BEGIN to COMMIT/ROLLBACK, as one connection would.
  pool.connect = (async () => {
    let held: (() => void) | null = null;
    return {
      query: async (text: string, params: unknown[] = []) => {
        const sql = text.trim();
        if (/^BEGIN/i.test(sql)) { const prev = lock; lock = new Promise<void>((r) => { held = r; }); await prev; return run(text, params); }
        if (held) { const r = await run(text, params).finally(() => { if (/^(COMMIT|ROLLBACK)/i.test(sql)) { held!(); held = null; } }); return r; }
        return serial(() => run(text, params));
      },
      release: () => { if (held) { held(); held = null; } },
    };
  }) as typeof pool.connect;

  const ownerA = id("b9900000", 1), memberA = id("b9900000", 2), ownerB = id("b9900000", 3);
  const A = id("a9900000", 1), B = id("a9900000", 2);
  const jane = id("d9900000", 1), john = id("d9900000", 2), bPerson = id("d9900000", 3);
  const trip = id("f9900000", 1), life = id("f9900000", 2), johnPa = id("f9900000", 3), bDoc = id("f9900000", 4);
  await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'A'),($2,'B')`, [A, B]);
  await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`, [A, ownerA, memberA, B, ownerB]);
  await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$4,'Jane Doe','self'),($2,$4,'John Doe','spouse'),($3,$5,'Bea Lim','self')`, [jane, john, bPerson, A, B]);
  // A personal schedule (authority 90, confirmed) with a printed end date.
  const doc = (pid: string, acct: string, person: string, product: string, number: string, ends: string) => pool.query(
    `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,file_hash,quarantine_status,renewal_or_expiry_date)
     VALUES($1,$2,$3,'Bluewater General',$4,$5,'personal_schedule',true,90,'ready','Schedule.pdf','k',$6,'scan_clean',$7::date)`, [pid, acct, person, product, number, 'sha256:' + pid, ends]);
  await doc(trip, A, jane, "Bluewater Single Trip", "BW-1001", "2026-10-04");
  await doc(life, A, jane, "Bluewater Term Life", "BW-2002", "2061-06-30");
  await doc(johnPa, A, john, "Bluewater Family PA", "BW-3003", "2026-09-30");
  await doc(bDoc, B, bPerson, "Bluewater Single Trip", "BW-1001", "2026-10-04");
  await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3),($4,$2,$3),($5,$6,$3),($7,$8,$9)`, [trip, jane, A, life, johnPa, john, bDoc, bPerson, B]);
  // Home's cards read schedule lines: one travel line for the trip, one death line for the life policy.
  await pool.query(`INSERT INTO policy_coverages(policy_id,account_id,family_member_id,category,amount,currency,evidence_text,source_page,evidence_verified)
    VALUES($1,$3,$4,'Travel',50000,'SGD','Overseas medical expenses S$50,000',1,true),($2,$3,$4,'Death',200000,'SGD','Death S$200,000',1,true)`, [trip, life, A, jane]);

  const notRenewed = await import("@/lib/policies/not-renewed");
  const { GET } = await import("@/app/api/policies/dates/route");
  const { POST } = await import("@/app/api/policies/dates/not-renewed/route");
  const { readHousehold } = await import("@/lib/simple-chat/library");
  const { loadHousehold } = await import("@/lib/simple-chat/library");
  const asUser = (userId: string) => { process.env.DEV_AUTH_ENABLED = "1"; process.env.DEV_ACCOUNT_ID = userId; };
  const req = (url: string, method: string, household: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
    method, headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}`, "content-type": "application/json", origin: "http://localhost" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const dates = async (acct: string, member: string) => (await (await GET(req(`/api/policies/dates?member=${member}`, "GET", acct))).json()) as { policies: { key: string; name: string; state: string; endsOn: string | null; documentIds: string[] }[]; canAnswer: boolean };
  const answer = (acct: string, body: unknown) => POST(req("/api/policies/dates/not-renewed", "POST", acct, body));
  const byName = (list: { name: string }[], name: string) => list.find((p) => p.name === name) as { key: string; state: string; endsOn: string | null } | undefined;
  void readHousehold;

  await test("R1 before the file is applied: dates show, no answer is offered, and answering is refused", async () => {
    notRenewed.resetNotRenewedReady(); asUser(ownerA);
    const d = await dates(A, jane);
    assert.equal(d.canAnswer, false);
    assert.equal(byName(d.policies, "Bluewater Single Trip")?.state, "renewal_due");
    assert.equal(byName(d.policies, "Bluewater Term Life")?.state, "until");
    const trip0 = byName(d.policies, "Bluewater Single Trip")!;
    assert.equal((await answer(A, { member: jane, key: trip0.key, endsOn: trip0.endsOn, notRenewed: true })).status, 409);
  });
  await test("R2 a policy key never carries the policy number", async () => {
    asUser(ownerA);
    for (const p of (await dates(A, jane)).policies) { assert.match(p.key, /^[0-9a-f]{24}$/); assert.ok(!p.key.includes("BW")); }
  });

  await db.exec(await readFile(path.resolve("sql/policy-not-renewed.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/policy-not-renewed.sql"), "utf8")); // twice is harmless
  notRenewed.resetNotRenewedReady();

  await test("A1 the owner may answer; a member sees the dates but may not", async () => {
    asUser(memberA);
    const m = await dates(A, jane);
    assert.equal(m.canAnswer, false);
    const t = byName(m.policies, "Bluewater Single Trip")!;
    assert.equal((await answer(A, { member: jane, key: t.key, endsOn: t.endsOn, notRenewed: true })).status, 403);
    asUser(ownerA);
    assert.equal((await dates(A, jane)).canAnswer, true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM policy_not_renewed")).rows[0].n, 0);
  });
  await test("A2 refused: a date not yet passed, another person's policy, a wrong date, an unknown key, another household", async () => {
    asUser(ownerA);
    const d = await dates(A, jane);
    const lifeP = byName(d.policies, "Bluewater Term Life")!, t = byName(d.policies, "Bluewater Single Trip")!;
    assert.equal((await answer(A, { member: jane, key: lifeP.key, endsOn: lifeP.endsOn, notRenewed: true })).status, 409, "date not passed");
    assert.equal((await answer(A, { member: john, key: t.key, endsOn: t.endsOn, notRenewed: true })).status, 409, "Jane's policy under John");
    assert.equal((await answer(A, { member: jane, key: t.key, endsOn: "2026-10-05", notRenewed: true })).status, 409, "another date");
    assert.equal((await answer(A, { member: jane, key: "0".repeat(24), endsOn: t.endsOn, notRenewed: true })).status, 409, "unknown key");
    asUser(ownerB);
    assert.equal((await answer(B, { member: jane, key: t.key, endsOn: t.endsOn, notRenewed: true })).status, 409, "household B naming A's person");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM policy_not_renewed")).rows[0].n, 0);
  });
  await test("A3 the database itself refuses a row naming another household's person", async () => {
    await assert.rejects(pool.query("INSERT INTO policy_not_renewed(account_id,family_member_id,contract_key,ends_on) VALUES($1,$2,'x','2026-10-04')", [B, jane]));
  });
  await test("A4 'I didn't renew it': the policy shows as not renewed; Jane's other policy and John's are unchanged", async () => {
    asUser(ownerA);
    const t = byName((await dates(A, jane)).policies, "Bluewater Single Trip")!;
    const res = await answer(A, { member: jane, key: t.key, endsOn: t.endsOn, notRenewed: true });
    assert.equal(res.status, 200, await res.clone().text());
    const after = await dates(A, jane);
    assert.equal(byName(after.policies, "Bluewater Single Trip")?.state, "not_renewed");
    assert.equal(byName(after.policies, "Bluewater Term Life")?.state, "until");
    assert.equal(byName((await dates(A, john)).policies, "Bluewater Family PA")?.state, "renewal_due");
    // Household B's policy with the same number and insurer is its own.
    asUser(ownerB);
    assert.equal(byName((await dates(B, bPerson)).policies, "Bluewater Single Trip")?.state, "renewal_due");
  });
  await test("A5 Home's cards leave the not-renewed policy out of current cover; the other policy stays", async () => {
    asUser(ownerA);
    const { GET: dash } = await import("@/app/api/dashboard/route");
    const res = await dash(req(`/api/dashboard?familyMemberId=${jane}&poll=1`, "GET", A));
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json() as { coverages: { category: string; status: string }[] };
    const status = new Map(body.coverages.map((c) => [c.category, c.status]));
    assert.notEqual(status.get("Travel"), "covered");
    assert.equal(status.get("Death"), "covered");
  });
  await test("A6 the library sent to chat marks the policy's document as the household's own statement, and only that one", async () => {
    const h = await loadHousehold(A);
    const said = new Map(h.documents.map((d) => [d.policyId, d.householdSaid ?? null]));
    assert.match(said.get(trip) ?? "", /^not renewed after 4 Oct 2026 for /);
    assert.equal(said.get(life), null); assert.equal(said.get(johnPa), null);
    const { renderDocument } = await import("@/lib/simple-chat/library");
    const i = h.documents.findIndex((d) => d.policyId === trip);
    assert.match(renderDocument(h.documents[i], i), /household_said="not renewed after 4 Oct 2026 for [^"]+, as the household told DearPolicy"/);
  });
  await test("A7 Undo puts it back as current cover", async () => {
    asUser(ownerA);
    const t = byName((await dates(A, jane)).policies, "Bluewater Single Trip")!;
    assert.equal((await answer(A, { member: jane, key: t.key, endsOn: t.endsOn, notRenewed: false })).status, 200);
    assert.equal(byName((await dates(A, jane)).policies, "Bluewater Single Trip")?.state, "renewal_due");
    const { GET: dash } = await import("@/app/api/dashboard/route");
    const body = await (await dash(req(`/api/dashboard?familyMemberId=${jane}&poll=1`, "GET", A))).json() as { coverages: { category: string; status: string }[] };
    assert.equal(body.coverages.find((c) => c.category === "Travel")?.status, "covered");
    assert.equal((await loadHousehold(A)).documents.find((d) => d.policyId === trip)?.householdSaid ?? null, null);
  });
  await test("A8 a renewal receipt after the date wins over the household's answer", async () => {
    asUser(ownerA);
    const t = byName((await dates(A, jane)).policies, "Bluewater Single Trip")!;
    assert.equal((await answer(A, { member: jane, key: t.key, endsOn: t.endsOn, notRenewed: true })).status, 200);
    await pool.query(`INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,policy_number,amount,currency,payment_date,period_end) VALUES($1,$2,$3,'Bluewater General','BW-1001',80,'SGD','2026-11-02','2027-11-01')`, [A, null, jane]);
    const after = byName((await dates(A, jane)).policies, "Bluewater Single Trip")!;
    assert.equal(after.state, "renewed");
    assert.equal((await answer(A, { member: jane, key: t.key, endsOn: t.endsOn, notRenewed: false })).status, 409, "nothing to undo while renewed");
  });
  await test("B1 browser roles read only their own household's answers and write none", async () => {
    const rls = await db.query<{ rowsecurity: boolean }>("SELECT relrowsecurity AS rowsecurity FROM pg_class WHERE relname='policy_not_renewed'");
    assert.equal(rls.rows[0].rowsecurity, true);
    const grants = await db.query<{ privilege_type: string }>("SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='policy_not_renewed' AND grantee IN ('anon','authenticated')");
    assert.deepEqual(grants.rows.map((r) => r.privilege_type), ["SELECT"]);
  });

  await test("J1 a joint document: the answer for one person is that person's only, in chat and its amounts (TE F2, F3)", async () => {
    asUser(ownerA);
    const fam = id("f9900000", 9);
    await doc(fam, A, jane, "Bluewater Family Trip", "BW-9009", "2026-11-07");
    await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$4),($1,$3,$4)`, [fam, jane, john, A]);
    const t = byName((await dates(A, jane)).policies, "Bluewater Family Trip")!;
    assert.equal(t.state, "renewal_due");
    assert.equal((await answer(A, { member: jane, key: t.key, endsOn: t.endsOn, notRenewed: true })).status, 200);
    const h = await loadHousehold(A);
    const d = h.documents.find((x) => x.policyId === fam)!;
    assert.deepEqual(d.notRenewedFor?.map((x) => x.person), ["Jane Doe"]);
    assert.equal(d.householdSaid, "not renewed after 7 Nov 2026 for Jane Doe");
    const { dropNotRenewedAmounts } = await import("@/lib/simple-chat/hook");
    const reply = { citations: [{ chunkId: "c1", policyId: fam }], statements: [
      { id: "s1", kind: "benefit_terms", text: "Death benefit S$100,000", personName: "Jane Doe", amount: { text: "S$100,000" }, source: { citationIds: ["c1"] } },
      { id: "s2", kind: "benefit_terms", text: "Death benefit S$100,000", personName: "John Doe", amount: { text: "S$100,000" }, source: { citationIds: ["c1"] } },
      { id: "s3", kind: "benefit_terms", text: "Medical S$150,000", personName: "Jane Doe", amount: { text: "S$150,000" }, source: { citationIds: ["c1"] } },
      { id: "s4", kind: "benefit_terms", text: "Baggage S$3,000", personName: "Jane Doe (Jane)", amount: { text: "S$3,000" }, source: { citationIds: ["c1"] } },
      { id: "s5", kind: "benefit_terms", text: "Delay S$500", personName: "Someone Else", amount: { text: "S$500" }, source: { citationIds: ["c1"] } },
      { id: "s6", kind: "benefit_terms", text: "Cancellation S$5,000", personName: null, amount: { text: "S$5,000" }, source: { citationIds: ["c1"] } }],
      bottomLine: "Your documents list this benefit for Jane Doe. The amount is shown below." as string | null };
    const unnamed = structuredClone(reply.statements[5]);
    const left = dropNotRenewedAmounts(reply, h, "Jane Doe");
    assert.deepEqual(left, ["Death benefit S$100,000", "Medical S$150,000", "Baggage S$3,000", "Delay S$500", "Cancellation S$5,000"], "the 'Display (Preferred)' form and a name that resolves to no one both go (Critic MED-7); an unnamed one in Jane's chat too (TE F3c)");
    assert.match(reply.bottomLine ?? "", /^Here is what your documents say\. .*not renewed after 7 Nov 2026 for Jane Doe/, "the bottom line no longer promises the dropped amount (TE F3b)");
    const forNoOne = { citations: reply.citations, statements: [unnamed] };
    assert.deepEqual(dropNotRenewedAmounts(forNoOne, h, null), [], "unnamed, in a chat for no one, on a joint document John still holds: kept");
    assert.deepEqual(reply.statements.map((x) => [x.personName, x.amount ? "amount" : x.kind]), [["Jane Doe", "fact"], ["John Doe", "amount"]]);
    assert.match(reply.statements[0].text, /not renewed after 7 Nov 2026 for Jane Doe, as the household told DearPolicy/);
    assert.equal((await answer(A, { member: jane, key: t.key, endsOn: t.endsOn, notRenewed: false })).status, 200);
  });
  if (failures.length) { console.error(failures.join("\n\n")); console.error(`${failures.length} failed, ${passed} passed`); process.exit(1); }
  console.log(`policy-not-renewed: ${passed} passed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

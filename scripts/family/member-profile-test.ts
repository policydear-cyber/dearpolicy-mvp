/**
 * Member profile (sql/member-profile.sql, lib/household/member-profile.ts): what the Family page collects and how the
 * answer pipeline uses it. Scripted tests (evidence category 1), no model and no network.
 *
 * Part A (pure): sex parsing and the "details still missing" list; sex settles "my daughter" / "my son" when the
 * relationship word does not (memberRelation); the profile's date of birth settles an insured child or adult under a
 * child limit only when the schedule's own line prints nothing to say, and a printed date of birth or relationship wins.
 * Part B (routes, PGlite): /api/family works BEFORE the migration is applied (no sex field, nothing breaks), and after it
 * saves, keeps, clears and rejects a sex, and one household cannot change another's member.
 * The chat's people module is checked in scripts/rag2-member-sex-test.ts.
 * Made-up people only.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseSex, profileGaps, genderOfSex, resetSexColumnCache } from "@/lib/household/member-profile";
import { memberRelation } from "@/lib/claims/person";
import { householdLife, personStatusWhy, provenAdult } from "@/lib/benefit-table/child-limit";

let passed = 0, failed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`ok - ${name}`); }
  catch (e) { failed++; console.log(`not ok - ${name}\n   ${(e as Error).message.split("\n").slice(0, 4).join("\n   ")}`); }
}

const DAY = 86_400_000;
const day = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / DAY);
// The period of insurance a status must hold on (today and each printed end).
const DAYS = [day("2026-11-17"), day("2026-07-01"), day("2027-06-30")];

async function partA() {
  await check("sex: female / male / prefer not to say accepted, anything else refused, missing keeps what is stored", () => {
    assert.equal(parseSex("Female"), "female");
    assert.equal(parseSex(" male "), "male");
    assert.equal(parseSex("unspecified"), "unspecified");
    assert.equal(parseSex(""), null);
    assert.equal(parseSex(null), null);
    assert.equal(parseSex(undefined), undefined);
    assert.equal(parseSex("x"), "invalid");
    assert.equal(parseSex(1), "invalid");
    assert.equal(genderOfSex("unspecified"), null);
  });
  await check("missing details: relationship, date of birth and preferred name always, sex only once it can be saved", () => {
    assert.deepEqual(profileGaps({ relationship: "child", date_of_birth: null, sex: null, preferred_name: null }, true), ["date of birth", "sex", "preferred name"]);
    assert.deepEqual(profileGaps({ relationship: "child", date_of_birth: null, sex: null, preferred_name: "Sam" }, false), ["date of birth"]);
    assert.deepEqual(profileGaps({ relationship: "", date_of_birth: "2015-03-02", sex: "female", preferred_name: "  " }, true), ["relationship", "preferred name"], "blank words are gaps");
    assert.deepEqual(profileGaps({ relationship: "child", date_of_birth: "2015-03-02", sex: "unspecified", preferred_name: "Sam" }, true), [], "prefer not to say is an answer");
  });
  await check("sex on the profile settles a 'child' as a daughter; relation words still work without it", () => {
    assert.equal(memberRelation("child", null).gender, null);
    assert.equal(memberRelation("child", null, "female").gender, "f");
    assert.equal(memberRelation("parent", null, "male").gender, "m");
    assert.equal(memberRelation("child", "son", null).gender, "m");
    assert.equal(memberRelation("child", "son", "unspecified").gender, "m", "prefer not to say: the words");
    assert.equal(memberRelation("child", null, "female").relation, "child", "sex never changes the relation");
  });

  const limit18 = { belowAge: 18 }, ageless = { belowAge: null };
  const blank = { birth: null, relationship: null };
  await check("profile date of birth: the household's child aged 9, nothing printed: still not settled (the schedule decides a child's share)", () => {
    const life = householdLife(blank, { relationship: "child", date_of_birth: "2017-04-09" }).life!;
    assert.equal(personStatusWhy(life, limit18, DAYS).status, null);
    assert.equal(personStatusWhy(life, ageless, DAYS).status, null);
  });
  await check("profile date of birth: a mistyped year (1917 for 2017) never makes a child an adult", () => {
    const life = householdLife(blank, { relationship: "child", date_of_birth: "1917-04-09" }).life!;
    assert.equal(personStatusWhy(life, ageless, DAYS).status, null);
    const sib = householdLife(blank, { relationship: "sibling", date_of_birth: "1880-04-09" }).life!;
    assert.equal(personStatusWhy(sib, ageless, DAYS).status, null);
  });
  await check("sex: a recorded 'son' saved as female stays a son (the words win)", () => {
    assert.equal(memberRelation("son", null, "female").gender, "m");
  });
  await check("profile date of birth: a parent aged 61, nothing printed: not the insured child", () => {
    const life = householdLife(blank, { relationship: "parent", date_of_birth: "1965-01-20" }).life!;
    assert.deepEqual(personStatusWhy(life, ageless, DAYS), { status: "not_child" });
    assert.equal(provenAdult(life, 18, DAYS).adult, true);
  });
  await check("negative control: a sibling with no date of birth stays unsettled (a relationship alone proves nothing)", () => {
    const out = householdLife(blank, { relationship: "sibling", date_of_birth: null });
    assert.equal(out.life?.household ?? null, null);
    assert.equal(personStatusWhy(out.life, ageless, DAYS).status, null);
  });
  await check("negative control: the printed date of birth wins over the profile (printed adult, profile says 9)", () => {
    const life = householdLife({ birth: "1990-02-01", relationship: null }, { relationship: "child", date_of_birth: "2017-04-09" }).life!;
    assert.deepEqual(personStatusWhy(life, limit18, DAYS), { status: "not_child" });
  });
  await check("negative control: a printed adult relationship wins (printed Spouse, profile says child aged 9)", () => {
    const life = householdLife({ birth: null, relationship: "Spouse" }, { relationship: "child", date_of_birth: "2017-04-09" }).life!;
    assert.notEqual(personStatusWhy(life, ageless, DAYS).status, "child");
  });
  await check("negative control: a child turning 18 inside the period of insurance is not settled either way", () => {
    const life = householdLife(blank, { relationship: "child", date_of_birth: "2009-01-15" }).life!;
    assert.equal(personStatusWhy(life, limit18, DAYS).status, null);
  });
  await check("negative control: the household's child aged 20 under an 'under 18' limit stays unsettled (may be a dependant up to 25)", () => {
    const life = householdLife(blank, { relationship: "child", date_of_birth: "2006-03-03" }).life!;
    assert.equal(personStatusWhy(life, limit18, DAYS).status, null);
  });
  await check("unchanged: the account holder with no date of birth is still not the child (as before)", () => {
    const life = householdLife(blank, { relationship: "self", date_of_birth: null }).life!;
    assert.deepEqual(personStatusWhy(life, ageless, DAYS), { status: "not_child" });
  });
  await check("negative control: a malformed date of birth on file adds nothing", () => {
    assert.equal(householdLife(blank, { relationship: "child", date_of_birth: "17/04/2017" }).life?.household ?? null, null);
  });
}

async function partB() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const { NextRequest } = await import("next/server");
  const { ACTIVE_HOUSEHOLD_COOKIE } = await import("@/lib/auth/request-context");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const f of ["sql/schema.sql", "sql/household-rls.sql", "sql/lifecycle.sql"]) await db.exec(await readFile(path.resolve(f), "utf8"));
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  let tail = Promise.resolve();
  const acquire = async () => { let release!: () => void; const prev = tail; tail = new Promise<void>((r) => { release = r; }); await prev; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length) { const rs = await db.exec(text); const last = rs[rs.length - 1]; return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  pool.query = (async (t: string, p: unknown[] = []) => { const rel = await acquire(); try { return await execute(t, p); } finally { rel(); } }) as typeof pool.query;
  pool.connect = (async () => { const rel = await acquire(); return { query: execute, release: rel } as never; }) as typeof pool.connect;

  const asUser = (id: string) => { process.env.DEV_AUTH_ENABLED = "1"; process.env.DEV_ACCOUNT_ID = id; };
  const req = (url: string, household: string, method = "GET", body?: unknown) => new NextRequest(url, { method, headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${household}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const seed = async (owner: string, name: string) => {
    const h = (await pool.query<{ id: string }>(`INSERT INTO accounts(id,name) VALUES (gen_random_uuid(),$1) RETURNING id`, [name])).rows[0].id;
    await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES ($1,$2,'owner')`, [h, owner]);
    return h;
  };
  const ownerA = "e0000000-0000-4000-8000-0000000000a1", ownerB = "e0000000-0000-4000-8000-0000000000b1";
  const hA = await seed(ownerA, "Household A"), hB = await seed(ownerB, "Household B");
  const { GET, POST } = await import("@/app/api/family/route");
  const { PATCH } = await import("@/app/api/family/[id]/route");
  const patch = (id: string, h: string, body: unknown) => PATCH(req(`http://localhost/api/family/${id}`, h, "PATCH", body), { params: Promise.resolve({ id }) });

  resetSexColumnCache();
  asUser(ownerA);
  let tanId = "";
  await check("before the migration: the Family page loads with no sex field, and adding a person still works", async () => {
    const res = await POST(req("http://localhost/api/family", hA, "POST", { displayName: "Tan Mei Ling", relationship: "self", dateOfBirth: "1988-06-01", sex: "female" }));
    assert.equal(res.status, 201);
    tanId = (await res.json()).member.id;
    const list = await (await GET(req("http://localhost/api/family", hA))).json();
    assert.equal(list.profile.sexField, false);
    assert.equal(list.family[0].sex, null);
  });

  await db.exec(await readFile(path.resolve("sql/member-profile.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/member-profile.sql"), "utf8")); // runs twice safely
  resetSexColumnCache();
  let kidId = "";
  await check("after the migration: a new member's sex is saved and listed, with the sex field on", async () => {
    const res = await POST(req("http://localhost/api/family", hA, "POST", { displayName: "Lim Xin Yi", relationship: "child", dateOfBirth: "2017-04-09", sex: "female" }));
    assert.equal(res.status, 201);
    const body = await res.json(); kidId = body.member.id;
    assert.equal(body.member.sex, "female");
    const list = await (await GET(req("http://localhost/api/family", hA))).json();
    assert.equal(list.profile.sexField, true);
    assert.equal(list.family.find((m: { id: string }) => m.id === kidId).sex, "female");
  });
  await check("an existing member completes their details: sex and date of birth saved together", async () => {
    const res = await patch(tanId, hA, { displayName: "Tan Mei Ling", relationship: "self", dateOfBirth: "1988-06-01", sex: "unspecified" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).member.sex, "unspecified");
  });
  await check("a save that does not send a sex (an older page) keeps the stored one", async () => {
    const res = await patch(kidId, hA, { displayName: "Lim Xin Yi", relationship: "child", dateOfBirth: "2017-04-09", preferredName: "Yi Yi" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).member.sex, "female");
  });
  await check("a sex that is not one of the choices is refused, and nothing is changed", async () => {
    const res = await patch(kidId, hA, { displayName: "Changed Name", relationship: "child", sex: "robot" });
    assert.equal(res.status, 400);
    const row = (await pool.query<{ display_name: string; sex: string }>(`SELECT display_name, sex FROM family_members WHERE id=$1`, [kidId])).rows[0];
    assert.equal(row.display_name, "Lim Xin Yi"); assert.equal(row.sex, "female");
  });
  await check("a date of birth before 1900 is refused as a typo", async () => {
    const res = await patch(kidId, hA, { displayName: "Lim Xin Yi", relationship: "child", dateOfBirth: "1817-04-09" });
    assert.equal(res.status, 400);
  });
  await check("the database refuses any other value too", async () => {
    await assert.rejects(pool.query(`UPDATE family_members SET sex='other' WHERE id=$1`, [kidId]));
  });
  await check("household isolation: another household can neither see nor change this member", async () => {
    asUser(ownerB);
    const list = await (await GET(req("http://localhost/api/family", hB))).json();
    assert.equal(list.family.length, 0);
    const res = await patch(kidId, hB, { displayName: "Taken", relationship: "child", sex: "male" });
    assert.equal(res.status, 404);
    const row = (await pool.query<{ sex: string }>(`SELECT sex FROM family_members WHERE id=$1`, [kidId])).rows[0];
    assert.equal(row.sex, "female");
    asUser(ownerA);
  });
}

async function main() {
  await partA();
  await partB();
  console.log(`\nmember-profile: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  process.exit(0);
}
void main().catch((e) => { console.error(e); process.exit(1); });

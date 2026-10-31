/**
 * Invite-only sign-up (lib/auth/signup-gate.ts). Off by default: with DEARPOLICY_SIGNUP_MODE unset anyone can sign up,
 * exactly as before. With DEARPOLICY_SIGNUP_MODE=invite a new household is made only for an invited email (on
 * DEARPOLICY_INVITED_EMAILS, an "@domain" entry, or a pending in-app household invitation), and it fails closed: no email,
 * or an error while checking invitations, means no household. A person already in a household is never affected.
 * Made-up people and domains; a fake database; no network.
 *   npm run auth:signup-gate-test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (() => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };

type Db = { member?: string; invitation?: boolean; invitationError?: boolean };
function fakePool(db: Db) {
  const log: string[] = [];
  const client = {
    async query(text: string, params: unknown[] = []) {
      log.push(text.trim().split(/\s+/).slice(0, 4).join(" "));
      if (/from household_members/.test(text)) return { rows: db.member ? [{ household_id: db.member }] : [] };
      if (/from household_invitations/.test(text)) {
        if (db.invitationError) throw new Error("relation is not reachable");
        assert.match(text, /accepted_at is null/); assert.match(text, /revoked_at is null/); assert.match(text, /expires_at > now\(\)/);
        assert.equal(params[0], String(params[0]).toLowerCase());
        return { rows: db.invitation ? [{ "?column?": 1 }] : [] };
      }
      if (/^insert into accounts/.test(text.trim())) return { rows: [{ id: "hh-new" }] };
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, log, created: () => log.some((l) => l.startsWith("insert into accounts")) };
}

async function main() {
  const { signupMode, onInvitedList, mayCreateHousehold, SignupClosedError } = await import("@/lib/auth/signup-gate");
  const { ensureDefaultHousehold } = await import("@/lib/household/repo");
  const setEnv = (mode: string | undefined, list?: string) => {
    if (mode === undefined) delete process.env.DEARPOLICY_SIGNUP_MODE; else process.env.DEARPOLICY_SIGNUP_MODE = mode;
    if (list === undefined) delete process.env.DEARPOLICY_INVITED_EMAILS; else process.env.DEARPOLICY_INVITED_EMAILS = list;
  };
  const ensure = (db: Db, email: string | null | undefined) => {
    const f = fakePool(db);
    return { f, run: ensureDefaultHousehold("00000000-0000-4000-8000-000000000001", "Lim household", f.pool as never, { email }) };
  };

  await t("off by default: unset or 'open' is open; any other value is invite-only (fails closed)", () => {
    for (const v of [undefined, "", " ", "open", " OPEN "]) assert.equal(signupMode({ DEARPOLICY_SIGNUP_MODE: v }), "open", String(v));
    for (const v of ["invite", "Invite", "invite-only", "closed", "true", "opn"]) assert.equal(signupMode({ DEARPOLICY_SIGNUP_MODE: v }), "invite", v);
  });
  await t("open mode: a new household is made exactly as before, even with no email given", async () => {
    setEnv(undefined);
    const { f, run } = ensure({}, undefined);
    assert.equal(await run, "hh-new"); assert.ok(f.created());
    assert.ok(!f.log.some((l) => /household_invitations/.test(l)), "open mode checks nothing");
  });
  await t("invite mode: an email that is not invited gets no household, and nothing is written", async () => {
    setEnv("invite", "nur.aisyah@contoh.my, @family-lim.sg");
    const { f, run } = ensure({}, "stranger@example.org");
    await assert.rejects(run, SignupClosedError); assert.ok(!f.created());
  });
  await t("invite mode: an invited address (any case) or an invited domain gets a household", async () => {
    setEnv("invite", "nur.aisyah@contoh.my;\n@family-lim.sg");
    for (const email of ["Nur.Aisyah@Contoh.MY", "wei.jie@family-lim.sg"]) {
      const { f, run } = ensure({}, email);
      assert.equal(await run, "hh-new", email); assert.ok(f.created());
    }
  });
  await t("a domain entry covers only that exact domain, never a lookalike or a subdomain", () => {
    const env = { DEARPOLICY_INVITED_EMAILS: "@family-lim.sg" };
    assert.equal(onInvitedList("a@family-lim.sg", env), true);
    for (const e of ["a@evil-family-lim.sg", "a@x.family-lim.sg", "a@family-lim.sg.evil.com", "family-lim.sg", "@family-lim.sg", "", null])
      assert.equal(onInvitedList(e, env), false, String(e));
  });
  await t("invite mode: a pending in-app household invitation lets that email sign up", async () => {
    setEnv("invite", "");
    const { f, run } = ensure({ invitation: true }, "Tan.Mei.Ling@Example.COM");
    assert.equal(await run, "hh-new"); assert.ok(f.created());
  });
  await t("fails closed: an error while checking invitations, or no email, means no household", async () => {
    setEnv("invite", "nur.aisyah@contoh.my");
    const a = ensure({ invitationError: true }, "invited.maybe@example.com");
    await assert.rejects(a.run, SignupClosedError); assert.ok(!a.f.created());
    for (const email of [null, undefined, "", "not-an-email"]) {
      const b = ensure({ invitation: true }, email);
      await assert.rejects(b.run, SignupClosedError, String(email)); assert.ok(!b.f.created());
    }
    assert.equal(await mayCreateHousehold("someone@example.com", null), false, "no database to check: no");
  });
  await t("a person already in a household is never affected by invite mode", async () => {
    setEnv("invite", "");
    const { f, run } = ensure({ member: "hh-existing" }, "stranger@example.org");
    assert.equal(await run, "hh-existing"); assert.ok(!f.created());
    assert.ok(!f.log.some((l) => /household_invitations/.test(l)));
  });
  await t("every place that creates a household passes the person's verified email and turns a closed sign-up into a clear refusal", () => {
    for (const f of ["app/api/auth/signup/route.ts", "app/api/auth/signin/route.ts", "app/api/auth/callback/route.ts", "app/api/household/start/route.ts"]) {
      const src = readFileSync(f, "utf8");
      assert.match(src, /ensureDefaultHousehold\([^;]*\{\s*email:/, f + " passes the email");
      assert.match(src, /SignupClosedError/, f + " handles a closed sign-up");
    }
    const signup = readFileSync("app/api/auth/signup/route.ts", "utf8");
    assert.ok(signup.indexOf("invitedToSignUp(") > 0 && signup.indexOf("invitedToSignUp(") < signup.indexOf("auth.signUp("), "sign-up checks the invitation before any account is made");
    assert.match(signup, /invitedToSignUp\(email\)\.catch\(\(\) => false\)/, "an error while checking is a no");
    for (const f of ["app/api/auth/signin/route.ts", "app/api/auth/callback/route.ts"]) assert.match(readFileSync(f, "utf8"), /signOut\(/, f + " leaves no session behind");
    assert.match(readFileSync("app/login/page.tsx", "utf8"), /invite_only:/);
  });
  await t("the sign-up pre-check fails closed too: a database that cannot be reached means no account", async () => {
    const { invitedToSignUp } = await import("@/lib/household/repo");
    setEnv("invite", "");
    const broken = { connect: async () => { throw new Error("connection refused"); } };
    assert.equal(await invitedToSignUp("someone@example.com", broken as never), false);
    assert.equal(await invitedToSignUp("someone@example.com", fakePool({ invitationError: true }).pool as never), false);
    assert.equal(await invitedToSignUp("invited@example.com", fakePool({ invitation: true }).pool as never), true);
    setEnv(undefined);
    assert.equal(await invitedToSignUp("anyone@example.com", broken as never), true, "open mode checks nothing, as before");
  });
  await t("no request left this machine", () => assert.equal(fetches, 0));

  console.log(`\nsignup gate: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

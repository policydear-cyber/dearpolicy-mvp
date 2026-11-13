/**
 * An invitation link opened while signed out keeps its token through sign-in and sign-up (lib/auth/invite-return.ts),
 * and the owner's pending-invitations list shows when each invitation expires. No network, no database, no model.
 *   npm run auth:invite-return-test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { inviteReturnPath, safeInviteNext } from "../../lib/auth/invite-return";
import { sameSitePath } from "../../lib/auth/same-site-path";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY|SUPABASE|DEV_AUTH/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const TOKEN = randomBytes(32).toString("base64url"); // the shape createInvitation() issues
const read = (f: string) => readFileSync(f, "utf8");

test("the helper carries exactly /invite?token=<token> and nothing else", () => {
  assert.equal(inviteReturnPath(TOKEN), `/invite?token=${TOKEN}`);
  assert.equal(inviteReturnPath(`  ${TOKEN} `), `/invite?token=${TOKEN}`);
  for (const bad of [null, undefined, "", "short", "has space in it 12345678901", "a/b/c/d/e/f/g/h/i/j/k/l", "x".repeat(129), `${TOKEN}&next=//evil.example`, "%2F%2Fevil.example.com.abc"])
    assert.equal(inviteReturnPath(bad), null, String(bad));
  assert.equal(safeInviteNext(`/invite?token=${TOKEN}`), `/invite?token=${TOKEN}`);
  for (const bad of ["/", "/family", "//evil.example", "https://evil.example/invite?token=" + TOKEN, `/invite?token=${TOKEN}&next=//evil.example`,
    `/invite?token=${TOKEN}#x`, `/invite/?token=${TOKEN}`, `/invite?Token=${TOKEN}`, `/invite?token=${TOKEN}/../family`, `\\invite?token=${TOKEN}`,
    `/\\evil.example/invite?token=${TOKEN}`, `/invite?token=`, ` /invite?token=${TOKEN}`, `/invite?token=${TOKEN}\n`, 42, null, [`/invite?token=${TOKEN}`]])
    assert.equal(safeInviteNext(bad), null, String(bad));
});

test("signed out, an invitation link goes to sign-in with the token kept in the return address only", async () => {
  const { middleware } = await import("../../middleware");
  const go = async (path: string) => {
    const res = await middleware(new NextRequest("http://localhost" + path));
    assert.ok(res.status === 307 || res.status === 308, `${path} -> ${res.status}`);
    return new URL(res.headers.get("location") ?? "");
  };
  const ok = await go(`/invite?token=${TOKEN}`);
  assert.equal(ok.pathname, "/login");
  assert.deepEqual([...ok.searchParams.keys()], ["next"], "the token is not a query of the sign-in page itself");
  assert.equal(ok.searchParams.get("next"), `/invite?token=${TOKEN}`);
  assert.equal(safeInviteNext(ok.searchParams.get("next")), `/invite?token=${TOKEN}`);
  // Extra or malformed input never rides along.
  for (const [path, next] of [
    [`/invite?token=${TOKEN}&next=//evil.example`, `/invite?token=${TOKEN}`],
    [`/invite?next=//evil.example&token=${TOKEN}`, `/invite?token=${TOKEN}`],
    ["/invite?token=bad", "/invite"],
    ["/invite", "/invite"],
    [`/family?token=${TOKEN}`, "/family"],
    ["/policies?next=//evil.example", "/policies"],
  ] as const) {
    const u = await go(path);
    assert.deepEqual([...u.searchParams.keys()], ["next"], path);
    assert.equal(u.searchParams.get("next"), next, path);
  }
});

test("sign-in, sign-up, the emailed link and the first password all keep the invitation, through the same check", () => {
  const login = read("app/login/page.tsx");
  assert.match(login, /const inviteNext = safeInviteNext\(params\.get\("next"\)\);/);
  assert.match(login, /href=\{inviteNext \? `\/signup\?next=\$\{encodeURIComponent\(inviteNext\)\}` : "\/signup"\}/);
  // After sign-in the existing same-site `next` handling returns to /invite?token=... (unchanged).
  assert.match(login, /window\.location\.assign\(sameSitePath\(params\.get\("next"\)\)/);
  const page = read("app/signup/page.tsx"), form = read("app/signup/SignupForm.tsx");
  assert.doesNotMatch(page, /searchParams/, "the page stays synchronous; the form reads the address itself");
  assert.match(form, /setInviteNext\(safeInviteNext\(new URLSearchParams\(window\.location\.search\)\.get\("next"\)\)\)/);
  assert.match(form, /\.\.\.\(inviteNext \? \{ next: inviteNext \} : \{\}\)/);
  assert.match(form, /window\.location\.assign\(inviteNext \?\? "\/"\)/);
  assert.match(form, /href=\{inviteNext \? `\/login\?next=\$\{encodeURIComponent\(inviteNext\)\}` : "\/login"\}/);
  const api = read("app/api/auth/signup/route.ts");
  assert.match(api, /const inviteNext = safeInviteNext\(body\.next\);/);
  assert.equal((api.match(/emailRedirectTo: `\$\{origin\}\/api\/auth\/callback\$\{carry\}`/g) ?? []).length, 2, "both emailed links (sign-up and the proof link) carry it");
  assert.match(login, /body: JSON\.stringify\(\{ email, password, \.\.\.\(inviteNext \? \{ next: inviteNext \} : \{\}\) \}\)/, "the scripted sign-in tells the route too");
  const signin = read("app/api/auth/signin/route.ts");
  assert.match(signin, /const inviteNext = safeInviteNext\(next\);/);
  assert.match(signin, /emailRedirectTo: `\$\{origin\}\/api\/auth\/callback\$\{carry\}`, shouldCreateUser: false/, "an unproven invitee signing in is emailed a link back to the join page");
  const cb = read("app/api/auth/callback/route.ts");
  assert.match(cb, /const inviteNext = safeInviteNext\(url\.searchParams\.get\("next"\)\);/);
  assert.match(cb, /new URL\("\/update-password\?first=1" \+ \(inviteNext \? `&next=\$\{encodeURIComponent\(inviteNext\)\}` : ""\), url\.origin\)/);
  const up = read("app/update-password/page.tsx");
  assert.match(up, /next = safeInviteNext\(new URLSearchParams\(window\.location\.search\)\.get\("next"\)\);/);
  assert.match(up, /router\.push\(next \?\? "\/"\)/);
  // The join page reads the token from its own address.
  assert.match(read("app/invite/page.tsx"), /useState\(params\.get\("token"\) \?\? ""\)/);
});

test("the pending-invitations list reads the fields the API sends (Expires was always blank)", () => {
  const repo = read("lib/household/repo.ts");
  const typeSrc = repo.slice(repo.indexOf("export type InvitationSummary = {"), repo.indexOf("};", repo.indexOf("export type InvitationSummary = {")));
  const sent = new Set([...typeSrc.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]));
  assert.ok(sent.has("expiresAt") && sent.has("email"), [...sent].join(","));
  const panel = read("components/household-access.tsx");
  const used = new Set([...panel.matchAll(/\binvitation\.(\w+)/g)].map((m) => m[1]));
  for (const field of used) assert.ok(sent.has(field), `the panel reads invitation.${field}, which the API does not send`);
  assert.ok(used.has("expiresAt"));
  assert.match(panel, /<label>Expires<\/label><span>\{sgDate\(invitation\.expiresAt\)\}<\/span>/);
  assert.match(read("app/api/household/invitations/route.ts"), /const invitations = await listInvitations\(ctx\.userId, ctx\.householdId\);\n\s+return NextResponse\.json\(\{ invitations \}\);/);
});

test("after sign-in, only a path on this site: tab, newline and backslash tricks are refused everywhere", () => {
  for (const good of ["/", "/family", "/invite?token=" + TOKEN, "/claims/abc?x=1#y", "/%2F%2Fevil.example"]) assert.equal(sameSitePath(good), good, good);
  for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r//evil.example", "\t//evil.example", "https://evil.example",
    "javascript:alert(1)", "", " /family", "/\u0000x", "\\\\evil.example", null, 1, ["/"]]) assert.equal(sameSitePath(bad), null, JSON.stringify(bad));
  const login = read("app/login/page.tsx"), signin = read("app/api/auth/signin/route.ts"), cb = read("app/api/auth/callback/route.ts");
  for (const [f, src] of [["login", login], ["signin", signin], ["callback", cb]] as const) {
    assert.match(src, /import \{ sameSitePath \} from "@\/lib\/auth\/same-site-path";/, f);
    assert.doesNotMatch(src, /startsWith\("\/\/"\)/, `${f} has no prefix-only check left`);
  }
  assert.match(signin, /const next = sameSitePath\(body\.next\);/);
  assert.match(cb, /return sameSitePath\(next\) \?\? "\/";/);
});

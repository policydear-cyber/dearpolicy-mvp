/** Scripted tests for the Turnstile bot check (lib/security/turnstile.ts) and where the routes use it. Fake Cloudflare, no
 * network. Also reads the route sources to prove the email-link and PKCE routes do not use it.
 *   npm run security:turnstile-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callerIp, turnstileOn, turnstilePasses, TURNSTILE_VERIFY_URL } from "@/lib/security/turnstile";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.stack : String(e)}`); } }
const ON = { TURNSTILE_SECRET_KEY: "s3cret", TURNSTILE_SITE_KEY: "site" } as never;
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

async function main() {
  await test("off unless both keys are set; off passes everything, even no token", async () => {
    assert.equal(turnstileOn({} as never), false);
    assert.equal(turnstileOn({ TURNSTILE_SECRET_KEY: "x" } as never), false);
    assert.equal(turnstileOn({ TURNSTILE_SITE_KEY: "x" } as never), false);
    assert.equal(turnstileOn(ON), true);
    assert.equal(turnstileOn({ TURNSTILE_SECRET_KEY: "x", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "x" } as never), true, "older name still works");
    assert.match(readFileSync("next.config.ts", "utf8"), /NEXT_PUBLIC_TURNSTILE_SITE_KEY: process\.env\.TURNSTILE_SITE_KEY/, "build hands the key to the browser");
    assert.equal(await turnstilePasses(undefined, null, { env: { TURNSTILE_SECRET_KEY: "x" } as never, fetchImpl: async () => { throw new Error("must not call"); } }), true);
  });
  await test("on: a token Cloudflare accepts passes, and the request carries secret, token and address", async () => {
    let url = "", body = "";
    const ok = await turnstilePasses("tok", "1.2.3.4", { env: ON, fetchImpl: async (u, init) => { url = u; body = String(init.body); return new Response(JSON.stringify({ success: true })); } });
    assert.equal(ok, true); assert.equal(url, TURNSTILE_VERIFY_URL);
    const p = new URLSearchParams(body);
    assert.deepEqual([p.get("secret"), p.get("response"), p.get("remoteip")], ["s3cret", "tok", "1.2.3.4"]);
  });
  await test("on: missing, empty, non-string and oversized tokens are refused without asking Cloudflare", async () => {
    const never = async () => { throw new Error("must not call"); };
    for (const t of [undefined, null, "", 5, "x".repeat(3000)]) assert.equal(await turnstilePasses(t, null, { env: ON, fetchImpl: never as never }), false);
  });
  await test("on: rejected token, error status, bad JSON, network error and timeout all refuse", async () => {
    assert.equal(await turnstilePasses("t", null, { env: ON, fetchImpl: reply({ success: false, "error-codes": ["timeout-or-duplicate"] }) }), false);
    assert.equal(await turnstilePasses("t", null, { env: ON, fetchImpl: reply({ success: true }, 500) }), false);
    assert.equal(await turnstilePasses("t", null, { env: ON, fetchImpl: async () => new Response("<html>") }), false);
    assert.equal(await turnstilePasses("t", null, { env: ON, fetchImpl: async () => { throw new Error("down"); } }), false);
    assert.equal(await turnstilePasses("t", null, { env: ON, timeoutMs: 5, fetchImpl: (_u, init) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted")))) }), false);
  });
  await test("success must be exactly true", async () => {
    assert.equal(await turnstilePasses("t", null, { env: ON, fetchImpl: reply({ success: "true" }) }), false);
  });
  await test("callerIp takes the first forwarded address", () => {
    assert.equal(callerIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } })), "9.9.9.9");
    assert.equal(callerIp(new Request("http://x")), null);
  });
  await test("the check guards sign-up, upload start and the form upload; the emailed-link and PKCE routes never use it", () => {
    const src = (p: string) => readFileSync(p, "utf8");
    for (const p of ["app/api/auth/signup/route.ts", "app/api/policies/upload/start/route.ts", "app/api/policies/upload/route.ts"]) assert.match(src(p), /turnstilePasses\(/, p);
    for (const p of ["app/api/auth/callback/route.ts", "app/api/auth/confirm/route.ts", "app/api/auth/signin/route.ts", "app/api/auth/reset-password/route.ts", "app/api/auth/update-password/route.ts", "app/confirm/page.tsx", "lib/auth/email-link.ts"]) {
      try { assert.doesNotMatch(src(p), /turnstile/i, p); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
    }
    // sign-up refuses before it reads invitations or creates anything
    const s = src("app/api/auth/signup/route.ts");
    assert.ok(s.indexOf("turnstilePasses(") < s.indexOf("invitedToSignUp(email)") && s.indexOf("turnstilePasses(") < s.indexOf("supabase.auth.signUp"));
  });
  await test("the page's security policy lets Turnstile's script, frame and call through", () => {
    const cfg = readFileSync("next.config.ts", "utf8");
    assert.match(cfg, /script-src[^"]*https:\/\/challenges\.cloudflare\.com/);
    assert.match(cfg, /"frame-src https:\/\/challenges\.cloudflare\.com"/);
    assert.match(cfg, /connect-src[^"]*https:\/\/challenges\.cloudflare\.com/);
  });
}
main().then(() => {
  if (failures.length) { console.error(failures.join("\n\n")); console.error(`\n${failures.length} failed, ${passed} passed`); process.exit(1); }
  console.log(`${passed} passed`);
}, (e) => { console.error(e); process.exit(1); });

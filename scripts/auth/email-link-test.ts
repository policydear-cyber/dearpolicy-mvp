/**
 * Emailed links work in any browser (lib/auth/email-link.ts, app/confirm, app/api/auth/confirm, app/api/auth/callback).
 *
 * Live 18 Nov: a new household signed up, opened the confirmation email on an iPhone (Gmail's own browser) and got
 * "That link has expired or has already been used". Auth log: /verify 303 user_signedup (address confirmed), then no
 * /token call: the callback's code exchange stopped before the network because this browser held no PKCE code
 * verifier (it lives in a cookie of the browser that signed up).
 *
 * Runs the real @supabase/ssr + supabase-js client with a fake network: no Supabase project, no email. Scripted test.
 *   npm run auth:email-link-test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { emailLinkNext, isMissingCodeVerifier, otherBrowserDestination, parseEmailLinkType, parseTokenHash } from "@/lib/auth/email-link";

let passed = 0;
const failed: string[] = [];
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };

const SUPABASE = "https://project.supabase.invalid";
const ORIGIN = "https://dearpolicy.example";
const HASH = "pkce_" + "a1".repeat(28);

/** A browser's cookie jar (empty = a browser that never asked for the link) and the network calls the client makes. */
function browser(cookies: { name: string; value: string }[] = [], respond?: (url: string, body: unknown) => Response) {
  const jar = new Map(cookies.map((c) => [c.name, c.value]));
  const calls: { url: string; body: unknown }[] = [];
  const client = createServerClient(SUPABASE, "anon-key", {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const c of list) { if (c.value) jar.set(c.name, c.value); else jar.delete(c.name); } },
    },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body });
        return respond ? respond(url, body) : new Response(JSON.stringify({ msg: "unexpected" }), { status: 500 });
      },
    },
  });
  return { client, jar, calls };
}

function sessionResponse() {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: "u-1", aud: "authenticated", email: "new.household@example.org", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return new Response(JSON.stringify({ access_token: "header.eyJzdWIiOiJ1LTEiLCJleHAiOjk5OTk5OTk5OTl9.sig", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r-1", user }), { status: 200, headers: { "content-type": "application/json" } });
}

async function main() {
  await t("REPRODUCTION: the code link opened in a browser that did not sign up fails before any network call, with the verifier-missing error", async () => {
    const b = browser();
    const { data, error } = await b.client.auth.exchangeCodeForSession("0b6c1f0e-4d0e-4f9b-9f6a-2b8f6d1c2e3a");
    assert.equal(data.user, null);
    assert.ok(error, "an error");
    assert.equal(b.calls.length, 0, "no /token call, as in the live auth log");
    assert.equal(isMissingCodeVerifier(error), true, "recognised as 'opened in another browser'");
  });

  await t("the callback says 'confirmed, sign in' for that case (and the reset page for a reset link), never 'expired'", () => {
    assert.equal(otherBrowserDestination("/"), "/login?notice=email_confirmed");
    assert.equal(otherBrowserDestination("/invite?token=abc"), "/login?notice=email_confirmed");
    assert.equal(otherBrowserDestination("/update-password"), "/reset-password?error=other_browser");
    const cb = readFileSync("app/api/auth/callback/route.ts", "utf8");
    assert.ok(cb.indexOf("isMissingCodeVerifier(error)") > 0 && cb.indexOf("isMissingCodeVerifier(error)") < cb.indexOf('"/login?error=invalid_or_expired_link", url.origin));\n  }'), "checked before the generic expired message");
    assert.match(readFileSync("app/login/page.tsx", "utf8"), /email_confirmed: "Your email address is confirmed\. Sign in with your email and password\."/);
    assert.match(readFileSync("app/reset-password/page.tsx", "utf8"), /other_browser: /);
  });

  await t("negative control: a real expired/used code (verifier present, auth service refuses) is NOT treated as 'opened elsewhere'", async () => {
    const b = browser([{ name: "sb-project-auth-token-code-verifier", value: JSON.stringify("verifier-123/signup") }],
      () => new Response(JSON.stringify({ code: "flow_state_expired", msg: "invalid flow state, flow state has expired" }), { status: 400, headers: { "content-type": "application/json" } }));
    const { error } = await b.client.auth.exchangeCodeForSession("0b6c1f0e-4d0e-4f9b-9f6a-2b8f6d1c2e3a");
    assert.ok(error);
    assert.equal(isMissingCodeVerifier(error), false);
    assert.equal(isMissingCodeVerifier(null), false);
    assert.equal(isMissingCodeVerifier(new Error("x")), false);
  });

  await t("a link Supabase already refused (error_code, no code) says expired, not 'incomplete'", () => {
    const cb = readFileSync("app/api/auth/callback/route.ts", "utf8");
    assert.match(cb, /if \(url\.searchParams\.get\("error_code"\) \|\| url\.searchParams\.get\("error"\)\)/);
  });

  await t("THE FIX: a token_hash link signs in a browser with no cookies at all, and stores the session in that browser", async () => {
    const b = browser([], (url) => (url.startsWith(SUPABASE + "/auth/v1/verify") ? sessionResponse() : new Response("{}", { status: 404 })));
    const { data, error } = await b.client.auth.verifyOtp({ token_hash: HASH, type: "email" });
    assert.equal(error, null);
    assert.equal(data.user?.id, "u-1");
    assert.equal(b.calls.length, 1);
    assert.match(b.calls[0].url, /\/auth\/v1\/verify$/);
    assert.equal((b.calls[0].body as { token_hash: string }).token_hash, HASH);
    assert.ok([...b.jar.keys()].some((k) => /auth-token/.test(k) && !/code-verifier/.test(k)), "a session cookie is written: " + [...b.jar.keys()].join(","));
  });

  await t("negative control: a used or expired token_hash is refused and leaves no session", async () => {
    const b = browser([], () => new Response(JSON.stringify({ code: "otp_expired", msg: "Email link is invalid or has expired" }), { status: 403, headers: { "content-type": "application/json" } }));
    const { data, error } = await b.client.auth.verifyOtp({ token_hash: HASH, type: "recovery" });
    assert.ok(error);
    assert.equal(data.user, null);
    assert.equal([...b.jar.keys()].filter((k) => /auth-token/.test(k)).length, 0);
  });

  await t("opening the link spends nothing: /confirm only shows a button; only its POST checks the token", () => {
    const page = readFileSync("app/confirm/page.tsx", "utf8");
    assert.doesNotMatch(page, /verifyOtp|supabase|exchangeCodeForSession/i);
    assert.match(page, /<form method="post" action="\/api\/auth\/confirm"/);
    const route = readFileSync("app/api/auth/confirm/route.ts", "utf8");
    assert.match(route, /export async function POST/);
    assert.doesNotMatch(route, /export async function GET/);
    assert.match(route, /verifyOtp\(\{ token_hash: tokenHash, type \}\)/);
    assert.match(route, /NextResponse\.redirect\(new URL\(path, origin\), 303\)/, "after a form POST, a 303 so the browser GETs the next page");
    const mw = readFileSync("middleware.ts", "utf8");
    assert.match(mw, /"\/confirm",\n\s+"\/api\/auth\/confirm",/, "reachable before signing in, like the callback");
  });

  await t("a reset link always goes on to choose a new password; others go where the link says, on this site only", () => {
    const route = readFileSync("app/api/auth/confirm/route.ts", "utf8");
    assert.match(route, /const next = reset \? "\/update-password" : rawNext \?\? "\/";/);
  });

  await t("only well-formed link types and token hashes are accepted", () => {
    for (const ok of ["email", "signup", "magiclink", "recovery"]) assert.equal(parseEmailLinkType(ok), ok);
    for (const bad of ["invite", "email_change", "sms", "", null, 1, "EMAIL"]) assert.equal(parseEmailLinkType(bad), null, String(bad));
    assert.equal(parseTokenHash(HASH), HASH);
    assert.equal(parseTokenHash("d".repeat(56)), "d".repeat(56));
    for (const bad of ["", "short", "a b c d e f g h i j k l", "<script>alert(1)</script>xxxxxxxx", "x".repeat(300), null]) assert.equal(parseTokenHash(bad), null, String(bad));
  });

  await t("`next` stays on this site: a path, or this site's own callback/confirm address unwrapped; anything else is dropped", () => {
    const invite = "/invite?token=" + "A".repeat(43);
    assert.equal(emailLinkNext("/family", ORIGIN), "/family");
    assert.equal(emailLinkNext(`${ORIGIN}/api/auth/callback?next=${encodeURIComponent(invite)}`, ORIGIN), invite);
    assert.equal(emailLinkNext(`${ORIGIN}/api/auth/callback`, ORIGIN), null);
    assert.equal(emailLinkNext(`${ORIGIN}/confirm?next=%2Fupdate-password`, ORIGIN), "/update-password");
    for (const bad of ["https://evil.example/api/auth/callback?next=/family", `${ORIGIN}/elsewhere?next=/family`, `${ORIGIN}/api/auth/callback?next=//evil.example`,
      "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, 3]) assert.equal(emailLinkNext(bad, ORIGIN), null, String(bad));
  });

  console.log(`email links: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}

void main();

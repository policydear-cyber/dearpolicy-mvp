#!/usr/bin/env node
/**
 * TEST-ONLY local stand-in for Supabase Auth (GoTrue) and its Admin API.
 *
 * The browser owner/reviewer journey points the UNCHANGED application --
 * @supabase/ssr in middleware.ts, lib/supabase/server.ts and the
 * /api/auth/* route handlers -- at this server instead of a real Supabase
 * project, so sign-up, the email-confirmation link (PKCE), sign-in,
 * session refresh, sign-out and session expiry all run through the same
 * code production runs. Deterministic: no clock tricks, no randomness in
 * outcomes (tokens are random but opaque).
 *
 * It cannot run anywhere near production:
 *   - it refuses to start unless DEARPOLICY_TEST_AUTH_ADAPTER=fake-gotrue;
 *   - it refuses to start when NODE_ENV=production or VERCEL / VERCEL_ENV
 *     is set;
 *   - it binds to 127.0.0.1 only;
 * and lib/launch/guards.ts's checkTestAdaptersNotInProduction refuses to
 * start a production server whose Auth URL is a loopback address or that
 * carries DEARPOLICY_TEST_AUTH_ADAPTER at all.
 *
 * Synthetic users only. Nothing here is persisted: every user, session and
 * email lives in this process's memory and disappears when it exits.
 *
 * Endpoints (GoTrue-compatible subset under /auth/v1):
 *   POST /signup, GET /verify, POST /token?grant_type=password|pkce|refresh_token,
 *   GET /user, POST /logout, POST /recover,
 *   POST|GET /admin/users, GET|DELETE /admin/users/:id   (service key only)
 * Test controls (never part of GoTrue):
 *   GET /__health, GET /__test/outbox?email=, GET /__test/users?email=,
 *   POST /__test/expire?email=  (expires every session of that user),
 *   GET /__test/stats
 */
import http from "node:http";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

export const TEST_AUTH_ADAPTER_FLAG = "DEARPOLICY_TEST_AUTH_ADAPTER";
export const TEST_AUTH_ADAPTER_VALUE = "fake-gotrue";

export function fakeAuthStartRefusal(env = process.env) {
  if ((env[TEST_AUTH_ADAPTER_FLAG] ?? "").trim() !== TEST_AUTH_ADAPTER_VALUE) {
    return `refusing to start: ${TEST_AUTH_ADAPTER_FLAG}=${TEST_AUTH_ADAPTER_VALUE} is required (test-only Auth stand-in).`;
  }
  if (env.NODE_ENV === "production" || (env.VERCEL ?? "").trim() || (env.VERCEL_ENV ?? "").trim()) {
    return "refusing to start: the test-only Auth stand-in never runs in a production or Vercel-hosted environment.";
  }
  return null;
}

const refusal = fakeAuthStartRefusal();
if (refusal) {
  console.error(`fake-auth: ${refusal}`);
  process.exit(78);
}

const PORT = Number(process.env.FAKE_AUTH_PORT ?? 4020);
const PUBLIC_URL = `http://127.0.0.1:${PORT}`;
const ANON_KEY = process.env.FAKE_AUTH_ANON_KEY ?? "synthetic-e2e-anon-key";
const SERVICE_KEY = process.env.FAKE_AUTH_SERVICE_KEY ?? "synthetic-e2e-service-role-key";
const JWT_SECRET = "synthetic-e2e-jwt-secret-not-a-real-secret";
const ACCESS_TTL_S = Number(process.env.FAKE_AUTH_ACCESS_TTL_S ?? 3600);
const MIN_PASSWORD = 8;

/** @type {Map<string, any>} id -> user */
const users = new Map();
/** @type {Map<string, any>} session id -> { userId, refresh, revoked, expired } */
const sessions = new Map();
const refreshIndex = new Map(); // refresh token -> session id
const confirmTokens = new Map(); // token -> { userId, challenge, method, redirectTo, used }
const authCodes = new Map(); // code -> { userId, challenge, method, used }
const outbox = []; // { email, type, link, at }
const stats = { signups: 0, confirmations: 0, passwordGrants: 0, pkceGrants: 0, refreshGrants: 0, logouts: 0, expired: 0, adminCreates: 0, adminDeletes: 0, rejectedKey: 0 };

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const now = () => Math.floor(Date.now() / 1000);

function sign(payload) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [head, body, sig] = String(token ?? "").split(".");
  if (!head || !body || !sig) return null;
  const expected = b64url(createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest());
  if (expected !== sig) return null;
  try { return JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return null; }
}

function publicUser(u) {
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at, confirmation_sent_at: u.confirmation_sent_at,
    last_sign_in_at: u.last_sign_in_at, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.user_metadata ?? {},
    identities: [], created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false,
  };
}

function issueSession(user) {
  const sid = randomUUID();
  const refresh = b64url(randomBytes(24));
  const iat = now();
  const exp = iat + ACCESS_TTL_S;
  const access = sign({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat, exp, session_id: sid, aal: "aal1", amr: [{ method: "password", timestamp: iat }] });
  sessions.set(sid, { userId: user.id, refresh, revoked: false, expired: false });
  refreshIndex.set(refresh, sid);
  return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL_S, expires_at: exp, refresh_token: refresh, user: publicUser(user) };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const authError = (res, status, error_code, msg) => send(res, status, { code: status, error_code, msg });

function bearer(req) { return (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim(); }
function sessionFromAccess(req) {
  const claims = verify(bearer(req));
  if (!claims || claims.role !== "authenticated") return { error: "bad_jwt" };
  const s = sessions.get(claims.session_id);
  if (!s || s.revoked) return { error: "session_not_found" };
  if (s.expired || claims.exp <= now()) return { error: "bad_jwt", expired: true };
  const user = users.get(claims.sub);
  if (!user) return { error: "user_not_found" };
  return { claims, session: s, user, sid: claims.session_id };
}
function findByEmail(email) { for (const u of users.values()) if (u.email === email) return u; return null; }
function withQuery(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
function createUser({ email, password, confirmed }) {
  const at = new Date().toISOString();
  const u = { id: randomUUID(), email, password_hash: createHash("sha256").update(`${email}\0${password}`).digest("hex"),
    email_confirmed_at: confirmed ? at : null, confirmation_sent_at: confirmed ? null : at, last_sign_in_at: null,
    created_at: at, updated_at: at, user_metadata: {} };
  users.set(u.id, u);
  return u;
}
const passwordMatches = (u, password) => u.password_hash === createHash("sha256").update(`${u.email}\0${password}`).digest("hex");

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", PUBLIC_URL);
    let body = {};
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch { body = {}; }
    const p = url.pathname;

    if (p === "/__health") return send(res, 200, { ok: true, testOnly: true });
    if (p === "/__test/stats") return send(res, 200, { ...stats, users: users.size, activeSessions: [...sessions.values()].filter((s) => !s.revoked && !s.expired).length });
    if (p === "/__test/outbox") {
      const email = String(url.searchParams.get("email") ?? "").toLowerCase();
      const mails = outbox.filter((m) => m.email === email);
      return send(res, 200, { count: mails.length, latest: mails.at(-1) ?? null });
    }
    if (p === "/__test/users") {
      const u = findByEmail(String(url.searchParams.get("email") ?? "").toLowerCase());
      return send(res, u ? 200 : 404, u ? { id: u.id, confirmed: !!u.email_confirmed_at } : { error: "not found" });
    }
    if (p === "/__test/expire" && req.method === "POST") {
      const u = findByEmail(String(url.searchParams.get("email") ?? "").toLowerCase());
      if (!u) return send(res, 404, { error: "not found" });
      let n = 0;
      for (const [sid, s] of sessions) if (s.userId === u.id && !s.revoked) { s.expired = true; s.revoked = true; refreshIndex.delete(s.refresh); n++; void sid; }
      stats.expired += n;
      return send(res, 200, { expired: n });
    }

    if (!p.startsWith("/auth/v1/")) return send(res, 404, { error: "unknown fake endpoint" });
    const route = p.slice("/auth/v1".length);

    // GoTrue requires the project's apikey on every call, except the email link.
    const apikey = String(req.headers.apikey ?? "");
    if (route !== "/verify" && apikey !== ANON_KEY && apikey !== SERVICE_KEY) { stats.rejectedKey++; return authError(res, 401, "no_api_key", "Invalid API key"); }

    if (route.startsWith("/admin/")) {
      if (bearer(req) !== SERVICE_KEY) { stats.rejectedKey++; return authError(res, 403, "not_admin", "User not allowed"); }
      if (route === "/admin/users" && req.method === "POST") {
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authError(res, 400, "validation_failed", "Unable to validate email address: invalid format");
        if (findByEmail(email)) return authError(res, 422, "email_exists", "A user with this email address has already been registered");
        if (password.length < MIN_PASSWORD) return authError(res, 422, "weak_password", "Password should be at least 8 characters.");
        const u = createUser({ email, password, confirmed: body.email_confirm === true });
        stats.adminCreates++;
        return send(res, 200, publicUser(u));
      }
      if (route === "/admin/users" && req.method === "GET") return send(res, 200, { users: [...users.values()].map(publicUser), aud: "authenticated" });
      const m = /^\/admin\/users\/([0-9a-f-]{36})$/.exec(route);
      if (m && req.method === "GET") { const u = users.get(m[1]); return u ? send(res, 200, publicUser(u)) : authError(res, 404, "user_not_found", "User not found"); }
      if (m && req.method === "DELETE") {
        const u = users.get(m[1]);
        if (!u) return authError(res, 404, "user_not_found", "User not found");
        users.delete(u.id);
        for (const s of sessions.values()) if (s.userId === u.id) { s.revoked = true; refreshIndex.delete(s.refresh); }
        stats.adminDeletes++;
        return send(res, 200, {});
      }
      return authError(res, 404, "not_found", "unknown admin endpoint");
    }

    if (route === "/signup" && req.method === "POST") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authError(res, 400, "validation_failed", "Unable to validate email address: invalid format");
      if (password.length < MIN_PASSWORD) return authError(res, 422, "weak_password", "Password should be at least 8 characters.");
      if (findByEmail(email)) return authError(res, 422, "user_already_exists", "User already registered");
      const u = createUser({ email, password, confirmed: false });
      const token = b64url(randomBytes(18));
      const redirectTo = url.searchParams.get("redirect_to") ?? "";
      confirmTokens.set(token, { userId: u.id, challenge: body.code_challenge ?? null, method: body.code_challenge_method ?? null, redirectTo, used: false });
      outbox.push({ email, type: "signup", at: new Date().toISOString(),
        link: `${PUBLIC_URL}/auth/v1/verify?token=${encodeURIComponent(token)}&type=signup&redirect_to=${encodeURIComponent(redirectTo)}` });
      stats.signups++;
      return send(res, 200, publicUser(u));
    }

    if (route === "/verify" && req.method === "GET") {
      const token = String(url.searchParams.get("token") ?? "");
      const redirectTo = String(url.searchParams.get("redirect_to") ?? "");
      const entry = confirmTokens.get(token);
      if (!redirectTo.startsWith("http://localhost:") && !redirectTo.startsWith("http://127.0.0.1:")) return authError(res, 400, "validation_failed", "redirect_to not allowed");
      if (!entry || entry.used) {
        res.writeHead(303, { location: withQuery(redirectTo, { error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" }) });
        return res.end();
      }
      entry.used = true;
      const u = users.get(entry.userId);
      if (!u) return authError(res, 404, "user_not_found", "User not found");
      u.email_confirmed_at = new Date().toISOString();
      stats.confirmations++;
      const code = randomUUID();
      authCodes.set(code, { userId: u.id, challenge: entry.challenge, method: entry.method, used: false });
      res.writeHead(303, { location: withQuery(redirectTo, { code }) });
      return res.end();
    }

    if (route === "/token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = findByEmail(String(body.email ?? "").trim().toLowerCase());
        if (!u || !passwordMatches(u, String(body.password ?? ""))) return authError(res, 400, "invalid_credentials", "Invalid login credentials");
        if (!u.email_confirmed_at) return authError(res, 400, "email_not_confirmed", "Email not confirmed");
        u.last_sign_in_at = new Date().toISOString();
        stats.passwordGrants++;
        return send(res, 200, issueSession(u));
      }
      if (grant === "pkce") {
        const entry = authCodes.get(String(body.auth_code ?? ""));
        if (!entry || entry.used) return authError(res, 404, "flow_state_not_found", "invalid flow state, no valid flow state found");
        const verifier = String(body.code_verifier ?? "");
        const derived = entry.method === "s256" || entry.method === "S256" ? b64url(createHash("sha256").update(verifier).digest()) : verifier;
        if (!entry.challenge || derived !== entry.challenge) return authError(res, 403, "bad_code_verifier", "code challenge does not match previously saved code verifier");
        entry.used = true;
        const u = users.get(entry.userId);
        if (!u) return authError(res, 404, "user_not_found", "User not found");
        u.last_sign_in_at = new Date().toISOString();
        stats.pkceGrants++;
        return send(res, 200, issueSession(u));
      }
      if (grant === "refresh_token") {
        const sid = refreshIndex.get(String(body.refresh_token ?? ""));
        const s = sid ? sessions.get(sid) : null;
        if (!s || s.revoked) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        const u = users.get(s.userId);
        if (!u) return authError(res, 400, "user_not_found", "User not found");
        s.revoked = true; refreshIndex.delete(s.refresh);
        stats.refreshGrants++;
        return send(res, 200, issueSession(u));
      }
      return authError(res, 400, "unsupported_grant_type", "unsupported grant_type");
    }

    if (route === "/user" && req.method === "GET") {
      const r = sessionFromAccess(req);
      if (r.error) return authError(res, r.error === "user_not_found" ? 403 : 401, r.error, r.expired ? "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired" : "Auth session missing!");
      return send(res, 200, publicUser(r.user));
    }

    if (route === "/logout" && req.method === "POST") {
      const r = sessionFromAccess(req);
      if (!r.error) {
        const scope = url.searchParams.get("scope") ?? "global";
        for (const [sid, s] of sessions) {
          if (s.userId !== r.user.id) continue;
          if (scope === "local" && sid !== r.sid) continue;
          if (scope === "others" && sid === r.sid) continue;
          s.revoked = true; refreshIndex.delete(s.refresh);
        }
        stats.logouts++;
      }
      return send(res, 204, undefined);
    }

    if (route === "/recover" && req.method === "POST") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (findByEmail(email)) outbox.push({ email, type: "recovery", at: new Date().toISOString(), link: `${PUBLIC_URL}/auth/v1/verify?type=recovery` });
      return send(res, 200, {});
    }

    return authError(res, 404, "not_found", "unknown fake auth endpoint");
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake-auth (TEST ONLY): listening on 127.0.0.1:${PORT}`));

/**
 * The public site's auth boundary (middleware.ts). Signed out, a visitor may open the landing page ("/", served from
 * /welcome), the Learn library and the crawler files, plus the sign-in pages that were already open. Every other page
 * still goes to sign-in, and every API still answers 401 (or 403 for a cross-site call), whatever the visitor sends.
 * The public pages are static text: nothing they import reads a session, household, document or chat, or calls a
 * service. No network, no database, no model.
 *   npm run public-site:auth-boundary-test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY|SUPABASE|DEV_AUTH|SITE_URL|VERCEL/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

const ORIGIN = "http://localhost";
const at = (p: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(ORIGIN + p, { method: init.method ?? "GET", headers: init.headers });
const load = async () => (await import("../../middleware")).middleware;
const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");
/** The request headers middleware forwards to the page (Next.js's x-middleware-request-* convention). */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const isLoginRedirect = (res: Response) => (res.status === 307 || res.status === 308) && /\/login\?next=/.test(res.headers.get("location") ?? "");

/** Every page route in app/, with a sample value in each dynamic segment. */
function pageRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) { if (d.name !== "api") walk(path.join(dir, d.name)); continue; }
      if (d.name !== "page.tsx") continue;
      const rel = path.relative("app", dir).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
      out.push("/" + rel.map((s) => (s.startsWith("[") ? "sample-1" : s)).join("/"));
    }
  };
  walk("app");
  return out.map((p) => (p === "/" ? "/" : p.replace(/\/$/, ""))).sort();
}
/** Every API route in app/api/, with a sample value in each dynamic segment. */
function apiRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) walk(path.join(dir, d.name));
      else if (d.name === "route.ts") out.push("/" + path.relative("app", dir).split(path.sep).map((s) => (s.startsWith("[") ? "sample-1" : s)).join("/"));
    }
  };
  walk("app/api");
  return out.sort();
}

const SIGN_IN_PAGES = new Set(["/login", "/signup", "/reset-password", "/privacy"]);
const PUBLIC_PAGES = ["/", "/learn", "/learn/making-a-claim", "/learn/sg-medishield-life", "/learn/terms", "/learn/no-such-guide"];
/** API routes that were already reachable signed out before this change (sign-in, health, signed callbacks). */
const OPEN_APIS = new Set(["/api/auth/signup", "/api/auth/signin", "/api/auth/callback", "/api/auth/reset-password", "/api/health",
  "/api/policies/scan-callback", "/api/internal/jobs/run"]);

test("signed out, the landing page and Learn are served, and say there is no session", async () => {
  const middleware = await load();
  for (const p of PUBLIC_PAGES) {
    const res = await middleware(at(p));
    assert.equal(res.status, 200, `${p} is served, got ${res.status} ${res.headers.get("location") ?? ""}`);
    assert.equal(forwarded(res, "x-dearpolicy-signed-in"), "0", `${p} tells the layout there is no session`);
  }
  // "/" is the landing page for a visitor without a session; the address bar keeps "/".
  assert.match(rewriteOf(await middleware(at("/"))) ?? "", /\/welcome$/);
  assert.equal(rewriteOf(await middleware(at("/learn"))), null);
  for (const p of ["/robots.txt", "/sitemap.xml"]) assert.equal((await middleware(at(p))).status, 200, p);
});

test("a visitor cannot claim a session by sending the hint header themselves", async () => {
  const middleware = await load();
  for (const p of ["/", "/learn"]) {
    const res = await middleware(at(p, { headers: { "x-dearpolicy-signed-in": "1" } }));
    assert.equal(forwarded(res, "x-dearpolicy-signed-in"), "0", p);
  }
  assert.match(rewriteOf(await middleware(at("/", { headers: { "x-dearpolicy-signed-in": "1" } }))) ?? "", /\/welcome$/, "still the landing page, not the Portfolio");
  // The hint opens nothing that was closed.
  for (const p of ["/policies", "/chat", "/family"]) assert.ok(isLoginRedirect(await middleware(at(p, { headers: { "x-dearpolicy-signed-in": "1" } }))), p);
  const api = await middleware(at("/api/dashboard", { headers: { "x-dearpolicy-signed-in": "1" } }));
  assert.equal(api.status, 401);
});

test("the hint is set on every page middleware lets through, never taken from the visitor", async () => {
  const middleware = await load();
  // Signed out, the sign-in pages say "no session" too, so a click from /login or /privacy to "/" draws the public frame.
  for (const p of ["/login", "/signup", "/reset-password", "/privacy"]) {
    assert.equal(forwarded(await middleware(at(p, { headers: { "x-dearpolicy-signed-in": "1" } })), "x-dearpolicy-signed-in"), "0", p);
  }
  process.env.DEV_AUTH_ENABLED = "1";
  try {
    for (const p of ["/policies", "/chat", "/learn/x/y", "/login"]) {
      assert.equal(forwarded(await middleware(at(p, { headers: { "x-dearpolicy-signed-in": "0" } })), "x-dearpolicy-signed-in"), "1", p);
    }
  } finally { delete process.env.DEV_AUTH_ENABLED; }
});

test("signed out, every other page still goes to sign-in", async () => {
  const middleware = await load();
  const pages = pageRoutes();
  assert.ok(pages.length >= 25, `found ${pages.length} pages`);
  const checked: string[] = [];
  for (const p of pages) {
    if (SIGN_IN_PAGES.has(p) || p === "/" || p === "/learn" || p.startsWith("/learn/") || p === "/welcome") continue;
    assert.ok(isLoginRedirect(await middleware(at(p))), `${p} must send a signed-out visitor to sign-in`);
    checked.push(p);
  }
  for (const p of ["/policies", "/chat", "/family", "/records", "/coverage", "/claims", "/operator", "/reviewer", "/usage", "/household"]) assert.ok(checked.includes(p), `${p} was checked`);
});

test("only one level below /learn is public, and nothing that only looks like Learn", async () => {
  const middleware = await load();
  for (const p of ["/learn/x/y", "/learn/making-a-claim/edit", "/learning", "/learn-more", "/learn/UPPER", "/learn/a.b", "/learnx/terms",
    "/learn/%2e%2e/policies", "/learn/..%2fpolicies", "/welcome/x", "/policies/learn", "/chat/learn/terms", "/sitemap.xml/x", "/robots.txt.bak"]) {
    const res = await middleware(at(p));
    assert.ok(isLoginRedirect(res) || res.status === 404, `${p} must stay closed, got ${res.status}`);
    assert.notEqual(forwarded(res, "x-dearpolicy-signed-in"), "0", `${p} is not treated as a public page`);
  }
});

test("/welcome opened directly sends the visitor to /", async () => {
  const middleware = await load();
  for (const p of ["/welcome", "/welcome?x=1"]) {
    const res = await middleware(at(p));
    assert.equal(res.status, 308);
    assert.equal(new URL(res.headers.get("location") ?? "").pathname + new URL(res.headers.get("location") ?? "").search, "/");
  }
});

test("signed out, every API still refuses (401), and a cross-site write is blocked (403)", async () => {
  const middleware = await load();
  const apis = apiRoutes();
  assert.ok(apis.length >= 50, `found ${apis.length} API routes`);
  for (const p of apis) {
    if (OPEN_APIS.has(p)) continue;
    for (const method of ["GET", "POST", "DELETE"]) {
      const sameSite = await middleware(at(p, { method, headers: { origin: ORIGIN } }));
      assert.equal(sameSite.status, 401, `${method} ${p} signed out must be 401, got ${sameSite.status}`);
      // The Origin check covers every state-changing method (lib/http/csrf.ts); a cross-site GET is refused as signed out.
      const cross = await middleware(at(p, { method, headers: { origin: "https://evil.example" } }));
      assert.equal(cross.status, method === "GET" ? 401 : 403, `${method} ${p} cross-site, got ${cross.status}`);
    }
  }
  // Public-looking API paths are not public either.
  for (const p of ["/api/learn", "/api/learn/terms", "/api/welcome", "/api/robots.txt", "/api/sitemap.xml", "/api/"]) {
    assert.equal((await middleware(at(p, { headers: { origin: ORIGIN } }))).status, 401, p);
  }
});

test("signed in (development sign-in), / is the household's Portfolio and the layout is told there is a session", async () => {
  const middleware = await load();
  process.env.DEV_AUTH_ENABLED = "1";
  try {
    const home = await middleware(at("/"));
    assert.equal(home.status, 200);
    assert.equal(rewriteOf(home), null, "no landing page for a signed-in household");
    assert.equal(forwarded(home, "x-dearpolicy-signed-in"), "1");
    assert.equal(forwarded(await middleware(at("/learn/terms")), "x-dearpolicy-signed-in"), "1");
  } finally { delete process.env.DEV_AUTH_ENABLED; }
});

// ---- The public pages are static: nothing they reach reads private data or calls a service. ----
const ENTRY_FILES = ["app/welcome/page.tsx", "app/learn/page.tsx", "app/learn/[slug]/page.tsx", "app/robots.ts", "app/sitemap.ts", "components/public/PublicShell.tsx"];
const FORBIDDEN_MODULE = /^(?:lib\/(?:db|supabase|household|auth|ai|chat|claims|coverage|benefit|documents|policies|storage|jobs|telemetry|rag|ingest)|app\/api)/;
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.join(path.dirname(from), spec) : null;
  if (!base) return null; // a package (react, next): not ours
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (existsSync(cand) && !cand.endsWith("/") && /\.(tsx?|css)$/.test(cand)) return path.normalize(cand);
  return null;
}
function reachable(): string[] {
  const seen = new Set<string>();
  const todo = [...ENTRY_FILES];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith(".css")) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^"';]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
      const next = resolveImport(f, m[1] ?? m[2]);
      if (next) todo.push(next);
    }
  }
  return [...seen].sort();
}

test("the public pages reach no database, session, household, document, chat or model code, and call nothing", () => {
  const files = reachable();
  assert.ok(files.includes("lib/learn/content.ts") && files.includes("components/icons.tsx"), "the walk follows imports");
  for (const f of files) {
    assert.doesNotMatch(f, FORBIDDEN_MODULE, `${f} must not be reachable from a public page`);
    if (f.endsWith(".css")) continue;
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|EventSource|WebSocket|next\/headers|cookies\(\)|localStorage|sessionStorage/, `${f} calls a service or reads a session`);
    if (f !== "lib/public-site/site.ts") assert.doesNotMatch(src, /process\.env/, `${f} reads the server's settings`);
  }
});

test("robots.txt lets crawlers read only the landing page and Learn; the sitemap lists only public pages", async () => {
  const robots = (await import("../../app/robots")).default();
  const rule = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
  assert.deepEqual(rule.allow, ["/$", "/learn", "/_next/static/", "/dearpolicy-logo.png", "/icon.png"]);
  assert.deepEqual(rule.disallow, ["/"]);
  assert.equal(robots.sitemap, "https://dearpolicy-mvp.vercel.app/sitemap.xml");
  const urls = (await import("../../app/sitemap")).default().map((e) => new URL(e.url).pathname);
  assert.ok(urls.length >= 10, `${urls.length} urls`);
  for (const u of urls) assert.ok(u === "/" || u === "/learn" || /^\/learn\/[a-z0-9-]+$/.test(u), u);
  const middleware = await load();
  for (const u of urls) assert.equal((await middleware(at(u))).status, 200, `${u} from the sitemap is public`);
  const { siteUrl } = await import("../../lib/public-site/site");
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://www.example.com/" }), "https://www.example.com");
  assert.equal(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "dp.example.com" }), "https://dp.example.com");
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: "not a url" }), "https://dearpolicy-mvp.vercel.app");
});

test("the landing page keeps the marketing rules: no promised payouts, accuracy figures, advice or endorsement claims", () => {
  const page = readFileSync("app/welcome/page.tsx", "utf8");
  const shell = readFileSync("components/public/PublicShell.tsx", "utf8");
  const text = (page + shell).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const bad of [/\d+\s*%\s*accura/i, /\baccurate\b/i, /guarantee/i, /\bwill (?:be )?pa(?:y|id)\b/i, /best polic/i, /underinsured/i,
    /bank[- ]grade/i, /endorsed|approved by|partner(?:ed)? with/i, /\bMAS\b|CPF Board|\bMOH\b/, /\bfree\b(?! *<)/i]) {
    if (bad.source === "\\bfree\\b(?! *<)") continue; // "Learn the basics, free" is about the library, which is free
    assert.doesNotMatch(text, bad, String(bad));
  }
  assert.doesNotMatch(text.replace(/isn&rsquo;t financial advice|isn\\u2019t financial advice|isn’t financial advice|not financial advice/g, ""), /\badvice\b|\badviser\b/i, "the only 'advice' is saying it is not advice");
  assert.match(shell, /It is not financial advice and does not decide claims\. Your insurer decides what is paid\./);
  assert.match(page, /made-up family and insurer/);
  assert.match(page, /href="\/signup"/);
  assert.match(page, /href="\/login"/);
  assert.equal(fetches, 0);
});

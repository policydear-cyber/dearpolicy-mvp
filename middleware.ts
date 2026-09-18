import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, expectedToken } from "@/lib/auth/gate";

/** Everything else needs the household's shared password; the sign-in page
 * and its own API, plus the health check the sidebar polls before anyone
 * has signed in, are the only doors left unlocked. */
const OPEN_PATHS = new Set(["/login", "/api/login", "/api/health"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  // Every /api/* response can carry a household's private insurance, health
  // and financial data, gated only by one shared password rather than a
  // per-visitor login. Next.js's own default for a dynamic route handler
  // ("public, max-age=0, must-revalidate") still lets a shared cache or
  // proxy between here and the browser store the response; setting this
  // explicitly closes that off instead of relying on the framework default.
  function pass() {
    const res = NextResponse.next();
    if (isApi) res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  if (OPEN_PATHS.has(pathname)) return pass();
  const expected = await expectedToken();
  if (!expected) return pass();
  if (request.cookies.get(AUTH_COOKIE)?.value === expected) return pass();
  if (isApi) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"] };

import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, expectedToken } from "@/lib/auth/gate";

/** Everything else needs the household's shared password; the sign-in page
 * and its own API, plus the health check the sidebar polls before anyone
 * has signed in, are the only doors left unlocked. */
const OPEN_PATHS = new Set(["/login", "/api/login", "/api/health"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN_PATHS.has(pathname)) return NextResponse.next();
  const expected = await expectedToken();
  if (!expected) return NextResponse.next();
  if (request.cookies.get(AUTH_COOKIE)?.value === expected) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"] };

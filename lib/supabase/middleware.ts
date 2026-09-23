/**
 * Session refresh for middleware.ts. `@supabase/ssr`'s documented Next.js
 * middleware pattern: build a client bound to the *request's* cookies for
 * reading, mirror every cookie write onto a fresh NextResponse, and call
 * supabase.auth.getUser() (not getSession()) so the JWT is actually
 * re-verified against Supabase rather than trusting an unverified cookie
 * payload -- getSession() alone would let a tampered/expired cookie pass
 * until the next real Auth API round trip.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireSupabaseClientEnv } from "./env";

export async function refreshSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = requireSupabaseClientEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

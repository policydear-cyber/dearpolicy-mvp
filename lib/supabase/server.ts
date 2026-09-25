/**
 * Cookie-bound Supabase Auth client for use in Server Components, Route
 * Handlers and Server Actions. This is an AUTH-ONLY client -- it talks to
 * Supabase's GoTrue Auth API to read/refresh the signed-in user's session,
 * never used to query application tables directly (that goes through
 * lib/db/authz-client.ts's createUserSupabaseClient(), which enforces RLS at
 * the Postgres level over the existing `pg` connection). Keeping these
 * concerns in two separate modules means the service-role key (in
 * lib/supabase/service.ts) is never in scope here at all.
 */
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseClientEnv } from "./env";

/** Server Components can read cookies but not write them (Next.js throws if
 * you try) -- middleware.ts is what actually persists a refreshed session
 * cookie back to the browser. Route Handlers and Server Actions CAN write
 * cookies, so `readonly: true` should only be passed from a Server
 * Component render path. */
export async function createSupabaseServerClient(options: { readonly?: boolean } = {}) {
  const { url, anonKey } = requireSupabaseClientEnv();
  const cookieStore = await cookies();

  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      if (options.readonly) return;
      try {
        for (const { name, value, options: cookieOptions } of cookiesToSet) {
          cookieStore.set(name, value, cookieOptions);
        }
      } catch {
        // Called from a Server Component render (not a Route Handler/Server
        // Action) -- Next.js forbids mutating cookies there. Session refresh
        // still happens (middleware.ts refreshes the cookie on every
        // request), so this is safe to swallow rather than crash the render.
      }
    },
  };

  return createServerClient(url, anonKey, { cookies: cookieMethods });
}

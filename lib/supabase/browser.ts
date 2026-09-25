/**
 * Browser-side Supabase Auth client, for client components that call
 * supabase.auth.signInWithPassword() / signUp() / signOut() / onAuthStateChange()
 * directly rather than round-tripping through a Route Handler. Uses only the
 * public anon key -- safe to ship in the client bundle.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseClientEnv } from "./env";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function createSupabaseBrowserClient() {
  if (client) return client;
  const { url, anonKey } = requireSupabaseClientEnv({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  client = createBrowserClient(url, anonKey);
  return client;
}
